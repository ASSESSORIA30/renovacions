/**
 * MOTOR DE CÀLCUL DE COMPARATIVES (determinista, independent de la IA).
 *
 * Política numèrica:
 *  - Aritmètica decimal (decimal.js-light), sense coma flotant en els imports.
 *  - Cada línia es redondeja a cèntims (ROUND_HALF_UP). Els totals són la suma de línies redondejades
 *    i els impostos es calculen sobre bases redondejades: pantalla i PDF quadren al cèntim.
 *  - Potència sempre normalitzada a €/kW·dia × dies del període (no es barregen unitats).
 *  - Sense consum per períodes no es reparteix cap total: el càlcul queda «incomplet».
 */
import Decimal from "decimal.js-light";
import { effectiveFromHourly } from "./open-calendar";
import {
  DEFAULT_TAXES,
  type CostDetail,
  type CostLine,
  type CostResult,
  type Eligibility,
  type Num,
  type OfferVersion,
  type PowerUnit,
  type PriceSheet,
  type SupplyInput,
  type SurplusMode,
  type SurplusResult,
  type TaxConfig,
} from "./types";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

const D = (n: number | string) => new Decimal(n);
const cents = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const num = (d: Decimal) => Number(cents(d).toFixed(2));
const fmt = (n: number, d = 6) => n.toLocaleString("es-ES", { maximumFractionDigits: d });

/** Nombre de períodes d'energia i de potència per peatge. */
export function periodsOf(tariff: string | null | undefined, energyType: "luz" | "gas" = "luz"): { energy: number; power: number; known: boolean } {
  if (energyType === "gas" || /^RL/i.test(tariff ?? "")) return { energy: 1, power: 0, known: true };
  const t = normalizeTariff(tariff);
  if (t === "2.0TD") return { energy: 3, power: 2, known: true };
  if (t && /^(3\.0|6\.[1-4])TD$/.test(t)) return { energy: 6, power: 6, known: true };
  return { energy: 6, power: 6, known: false };
}

export function normalizeTariff(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = t.toUpperCase().replace(/\s/g, "");
  const m = /([236])[.,]?([0-4])\s*(TD|A|DHA)?/.exec(s);
  if (/^RL[.]?(\d{1,2})/.test(s)) return `RL.${/^RL[.]?(\d{1,2})/.exec(s)![1]}`;
  if (!m) return s;
  return `${m[1]}.${m[2]}TD`;
}

/** €/kW·dia a partir de qualsevol unitat de potència. */
export function powerPerDay(price: number, unit: PowerUnit): Decimal {
  const p = D(price);
  if (unit === "eur_kw_dia") return p;
  if (unit === "eur_kw_mes") return p.times(12).div(365);
  return p.div(365);
}

/** Factor per treure impostos inclosos en preus (si l'oferta els publica amb impostos). */
function taxDivisor(sheet: PriceSheet, ieePct: number, vatPct: number): Decimal {
  if (sheet.taxTreatment === "amb_iee") return D(1).plus(D(ieePct).div(100));
  if (sheet.taxTreatment === "amb_iee_iva") return D(1).plus(D(ieePct).div(100)).times(D(1).plus(D(vatPct).div(100)));
  return D(1);
}

export function vatFor(s: SupplyInput, taxes: TaxConfig) {
  const v = taxes.vat[s.territory];
  const pct = v.lowPowerResidentialPct != null && s.residentialLowPower ? v.lowPowerResidentialPct : v.pct;
  return { label: v.label, pct };
}

/** Consum total del període: el total explícit o la suma dels períodes (només si tots són coneguts). */
export function totalKwh(s: SupplyInput, energyPeriods: number): Num {
  if (s.kwhTotal != null) return s.kwhTotal;
  const v = s.kwh.slice(0, energyPeriods);
  return v.length === energyPeriods && v.every((x) => x != null) ? v.reduce<number>((a, x) => a + (x as number), 0) : null;
}

/**
 * Cost d'un full de preus per a un subministrament. Retorna un desglossament auditable.
 * Si falten dades necessàries, `ok = false` i `missing` diu què cal; no s'inventa res.
 */
export function computeCost(sheet: PriceSheet, s: SupplyInput, taxes: TaxConfig = DEFAULT_TAXES, opts: { current?: boolean } = {}): CostResult {
  const per = periodsOf(s.accessTariff, s.energyType);
  const missing: string[] = [];
  const notes: string[] = [];
  const lines: CostLine[] = [];
  let estimated = false;
  const days = D(s.days);
  const yearFrac = days.div(365);
  const vat = vatFor(s, taxes);
  const div = taxDivisor(sheet, taxes.ieePct, vat.pct);
  if (!per.known) missing.push("Tarifa d'accés del subministrament");
  if (sheet.taxTreatment !== "sense_impostos") notes.push(`Els preus publicats inclouen ${sheet.taxTreatment === "amb_iee" ? "l'impost elèctric" : "l'impost elèctric i l'IVA"}: s'han convertit a preus sense impostos abans de calcular.`);

  /* ---- Energia */
  let energy = D(0);
  const kwhAll = totalKwh(s, per.energy);
  const detE: CostDetail["energy"] = [];
  const detP: CostDetail["power"] = [];
  const r2 = (d: Decimal) => Number(d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
  const r6 = (d: Decimal) => Number(d.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
  const single = sheet.contractType === "fix24h" || s.energyType === "gas" || (sheet.energy24h != null && sheet.energy.every((x) => x == null));
  if (sheet.contractType === "indexat" && !sheet.indexedReference?.energy?.some((x) => x != null) && sheet.energy24h == null) {
    missing.push("Preus de referència de l'oferta indexada (sense metodologia ni dades no es pot calcular)");
  } else if (single) {
    const p = sheet.energy24h ?? sheet.energy[0];
    if (p == null) missing.push("Preu d'energia (€/kWh)");
    if (kwhAll == null) missing.push("Consum total del període (kWh)");
    if (p != null && kwhAll != null) {
      energy = cents(D(kwhAll).times(D(p).div(div)));
      const pe = r6(D(p).div(div));
      // preu únic: s'aplica al consum de cada període (si es coneix el repartiment) o al total
      const byP = s.energyType !== "gas" && per.energy > 1 && s.kwh.slice(0, per.energy).every((x) => x != null);
      if (byP) for (let i = 0; i < per.energy; i++) detE.push({ period: i + 1, kwh: s.kwh[i]!, price: pe, amount: r2(D(s.kwh[i]!).times(D(p).div(div))) });
      else detE.push({ period: null, kwh: kwhAll, price: pe, amount: num(energy) });
      lines.push({ key: "energia", label: "Terme d'energia", formula: `${fmt(kwhAll, 0)} kWh × ${fmt(p)} €/kWh`, amount: num(energy), estimated: false });
    }
  } else if (sheet.open && sheet.open.modality !== "plana" && s.hourly && s.hourly.length) {
    // Tarifa Open amb CONSUM HORARI REAL: preu Open o No Open a cada hora segons el calendari contractual
    const o = sheet.open;
    const r = effectiveFromHourly(s.accessTariff ?? "", o.rule, { open: o.openPrice, noOpen: o.noOpenPrice }, s.hourly);
    energy = cents(D(r.cost).div(div));
    estimated = true;
    lines.push({ key: "energia", label: "Terme d'energia (distribució horària real)", formula: r.periods.filter((x) => x.kwh > 0).map((x) => `P${x.period} ${fmt(x.kwh, 0)} kWh (${fmt(x.openKwh, 0)} Open) → ${fmt(x.price ?? 0)} €/kWh`).join(" + "), amount: num(energy), estimated: true });
    notes.push(`Càlcul amb la distribució horària real del consum (${r.hours} hores): preu Open ${fmt(o.openPrice)} i No Open ${fmt(o.noOpenPrice)} €/kWh aplicats hora a hora. És una estimació, no una factura definitiva.`);
    if (r.skipped) notes.push(`S'han descartat ${r.skipped} hores de la corba amb dades no vàlides.`);
  } else {
    const prices = sheet.contractType === "indexat" ? (sheet.indexedReference?.energy ?? []) : sheet.energy;
    if (sheet.open && sheet.open.label) {
      if (sheet.open.kind !== "comercial") estimated = true;
      notes.push(sheet.open.kind === "comercial"
        ? `${sheet.open.label}: correspondència comercial P1–P6 validada per Direcció (promocionat ${fmt(sheet.open.openPrice)} / no promocionat ${fmt(sheet.open.noOpenPrice)} €/kWh). Amb corba horària es calcula segons l'horari contractual.`
        : `${sheet.open.label}: preus P1–P6 ESTIMATS per ponderació horària (promocionat ${fmt(sheet.open.openPrice)} / no promocionat ${fmt(sheet.open.noOpenPrice)} €/kWh). L'estalvi calculat és estimat: el preu efectiu depèn de quan consumeix el client.`);
    } else if (sheet.open && sheet.open.modality !== "plana") {
      estimated = true;
      notes.push(`Tarifa Open ${sheet.open.modality === "nit" ? "Noche" : sheet.open.modality === "dia" ? "Día" : sheet.open.modality === "laboral" ? "Laboral" : "Fin de Semana"}: preus P1–P6 ESTIMATS per ponderació horària (Open ${fmt(sheet.open.openPrice)} / No Open ${fmt(sheet.open.noOpenPrice)} €/kWh). L'estalvi calculat és estimat: el preu efectiu depèn de quan consumeix el client.`);
    }
    if (sheet.contractType === "indexat") {
      estimated = true;
      notes.push(`Oferta indexada: preus de referència estimats${sheet.indexedReference?.asOf ? ` (${sheet.indexedReference.asOf})` : ""}. ${sheet.indexedReference?.note ?? ""} El cost real variarà amb el mercat.`);
    }
    const parts: string[] = [];
    let acc = D(0);
    let ok = true;
    for (let i = 0; i < per.energy; i++) {
      const k = s.kwh[i] ?? null;
      const p = prices[i] ?? null;
      if (k == null) {
        missing.push(`Consum P${i + 1} (kWh)`);
        ok = false;
      }
      if (p == null) {
        missing.push(`Preu energia P${i + 1} (€/kWh)`);
        ok = false;
      }
      if (k != null && p != null) {
        acc = acc.plus(D(k).times(D(p).div(div)));
        parts.push(`P${i + 1} ${fmt(k, 0)}×${fmt(p)}`);
      }
      detE.push({ period: i + 1, kwh: k, price: p == null ? null : r6(D(p).div(div)), amount: k != null && p != null ? r2(D(k).times(D(p).div(div))) : null });
    }
    if (ok) {
      energy = cents(acc);
      const openEst = !!sheet.open && sheet.open.modality !== "plana" && sheet.open.kind !== "comercial";
      lines.push({ key: "energia", label: openEst ? "Terme d'energia (preu estimat per ponderació horària)" : "Terme d'energia", formula: parts.join(" + "), amount: num(energy), estimated: sheet.contractType === "indexat" || openEst });
    }
  }

  /* ---- SAS / mecanisme d'ajust */
  let sas = D(0);
  if (sheet.sas.mode === "variable") {
    if (sheet.sas.eurKwh == null) {
      estimated = true;
      notes.push("SAS variable sense valor estimat: no s'ha quantificat (el cost real serà superior).");
    } else if (kwhAll != null) {
      sas = cents(D(kwhAll).times(D(sheet.sas.eurKwh).div(div)));
      estimated = true;
      lines.push({ key: "sas", label: "Mecanisme d'ajust (SAS) estimat", formula: `${fmt(kwhAll, 0)} kWh × ${fmt(sheet.sas.eurKwh)} €/kWh`, amount: num(sas), estimated: true });
    } else missing.push("Consum total (per al SAS)");
  }

  /* ---- Potència */
  let power = D(0);
  if (per.power > 0) {
    const parts: string[] = [];
    let acc = D(0);
    let ok = true;
    for (let i = 0; i < per.power; i++) {
      const k = s.kw[i] ?? null;
      const p = sheet.power[i] ?? null;
      if (k == null) {
        missing.push(`Potència contractada P${i + 1} (kW)`);
        ok = false;
      }
      if (p == null) {
        missing.push(`Preu potència P${i + 1}`);
        ok = false;
      }
      if (k != null && p != null) {
        acc = acc.plus(D(k).times(powerPerDay(p, sheet.powerUnit).div(div)).times(days));
        parts.push(`P${i + 1} ${fmt(k, 3)} kW×${fmt(p)}`);
      }
      detP.push({ period: i + 1, kw: k, price: p == null ? null : r6(powerPerDay(p, sheet.powerUnit).div(div)), amount: k != null && p != null ? r2(D(k).times(powerPerDay(p, sheet.powerUnit).div(div)).times(days)) : null });
    }
    if (ok) {
      power = cents(acc);
      lines.push({ key: "potencia", label: "Terme de potència", formula: `(${parts.join(" + ")}) ${sheet.powerUnit === "eur_kw_dia" ? "€/kW·dia" : sheet.powerUnit === "eur_kw_mes" ? "€/kW·mes → dia" : "€/kW·any → dia"} × ${s.days} dies`, amount: num(power), estimated: false });
    }
  }

  /* ---- Terme fix de gas */
  let fixedGas = D(0);
  if (s.energyType === "gas") {
    if (sheet.gasFixedEurDay == null) missing.push("Terme fix del gas (€/dia)");
    else {
      fixedGas = cents(D(sheet.gasFixedEurDay).div(div).times(days));
      lines.push({ key: "fix_gas", label: "Terme fix", formula: `${fmt(sheet.gasFixedEurDay)} €/dia × ${s.days} dies`, amount: num(fixedGas), estimated: false });
    }
  }

  /* ---- Quotes i serveis (no opcionals) */
  const fees = sheet.fees.filter((f) => !f.optional);
  let fixed = fixedGas;
  if (fees.length) {
    const f = cents(fees.reduce((a, x) => a.plus(D(x.eurMonth).times(12).times(yearFrac)), D(0)));
    fixed = fixed.plus(f);
    lines.push({ key: "quotes", label: "Quotes i serveis", formula: fees.map((x) => `${x.concept} ${fmt(x.eurMonth, 2)} €/mes`).join(" + "), amount: num(f), estimated: false });
  }
  const optional = sheet.fees.filter((f) => f.optional);
  if (optional.length) notes.push(`Serveis opcionals no inclosos: ${optional.map((x) => `${x.concept} (${fmt(x.eurMonth, 2)} €/mes)`).join(", ")}.`);

  /* ---- Descomptes (cada un una sola vegada sobre la seva base) */
  let disc = D(0);
  const discParts: string[] = [];
  let discEnergy = D(0);
  let discPower = D(0);
  for (const d of sheet.discounts) {
    const base = d.base === "energia" ? energy : d.base === "potencia" ? power : energy.plus(sas).plus(power).plus(fixed);
    let v = D(0);
    if (d.pct != null) v = v.plus(base.times(D(d.pct).div(100)));
    if (d.eurYear != null) v = v.plus(D(d.eurYear).times(yearFrac));
    v = cents(v);
    if (v.isZero()) continue;
    disc = disc.plus(v);
    if (d.base === "energia") discEnergy = discEnergy.plus(v);
    if (d.base === "potencia") discPower = discPower.plus(v);
    discParts.push(`${d.concept}${d.pct != null ? ` ${fmt(d.pct, 2)} % s/ ${d.base.replace(/_/g, " ")}` : ""}${d.eurYear != null ? ` ${fmt(d.eurYear, 2)} €/any` : ""}`);
  }
  if (!disc.isZero()) lines.push({ key: "descomptes", label: "Descomptes", formula: discParts.join(" + "), amount: -num(disc), estimated: false });

  /* ---- Excedents fotovoltaics (compensació sobre el terme d'energia, amb el límit legal) */
  const sur = surplusFor(sheet, s, energy.minus(discEnergy), div, yearFrac, !!opts.current);
  let compensation = D(0);
  if (sur) {
    compensation = D(sur.compensationEur);
    if (sur.compensationEur > 0) lines.push({ key: "excedents", label: "Compensació d'excedents", formula: sur.note ?? "", amount: -sur.compensationEur, estimated: sur.estimated });
    if (sur.batteryFeeEur > 0) {
      fixed = fixed.plus(D(sur.batteryFeeEur));
      lines.push({ key: "bateria", label: "Bateria virtual (cost de gestió)", formula: `${fmt(sheet.surplus?.battery?.feeEurMonth ?? 0, 2)} €/mes × ${fmt(num(yearFrac.times(12)), 2)} mesos`, amount: sur.batteryFeeEur, estimated: false });
    }
    if (sur.estimated) estimated = true;
    if (sur.status === "no_informada") notes.push("Compensació d'excedents no informada per aquesta tarifa: no s'ha descomptat (no s'assumeix que sigui zero).");
    if (sur.status === "pendent") notes.push(sur.note ?? "Compensació d'excedents pendent de dades.");
    if (sur.toBatteryEur > 0) notes.push(`Bateria virtual: ${fmt(sur.toBatteryEur, 2)} € d'excedents per sobre del límit queden com a saldo acumulat (no redueixen aquest import).`);
    if (sur.lostEur > 0) notes.push(`Límit de compensació: ${fmt(sur.lostEur, 2)} € d'excedents no es poden compensar en aquest període (no hi ha bateria virtual).`);
  }

  const subtotal = energy.plus(sas).plus(power).plus(fixed).minus(disc).minus(compensation);

  /* ---- Impost elèctric o d'hidrocarburs */
  let iee = D(0);
  if (s.energyType === "luz") {
    const base = energy.plus(sas).plus(power).minus(discEnergy).minus(discPower).minus(compensation);
    const byPct = base.times(D(taxes.ieePct).div(100));
    const byMin = kwhAll != null ? D(kwhAll).div(1000).times(taxes.ieeMinEurMWh) : D(0);
    iee = cents(byMin.gt(byPct) ? byMin : byPct);
    lines.push({
      key: "iee",
      label: "Impost elèctric",
      formula: byMin.gt(byPct) ? `mínim ${fmt(taxes.ieeMinEurMWh, 2)} €/MWh × ${fmt((kwhAll ?? 0) / 1000, 3)} MWh` : `${fmt(taxes.ieePct, 8)} % × ${fmt(num(base), 2)} €`,
      amount: num(iee),
      estimated: false,
    });
  } else if (kwhAll != null) {
    iee = cents(D(kwhAll).times(taxes.gasHydrocarbonEurKwh));
    lines.push({ key: "hidrocarburs", label: "Impost d'hidrocarburs", formula: `${fmt(kwhAll, 0)} kWh × ${fmt(taxes.gasHydrocarbonEurKwh)} €/kWh`, amount: num(iee), estimated: false });
  }

  /* ---- Lloguer d'equips (igual a tots els escenaris) */
  let rent = D(0);
  if (s.meterRentEurMonth != null && s.meterRentEurMonth > 0) {
    rent = cents(D(s.meterRentEurMonth).times(12).times(yearFrac));
    lines.push({ key: "lloguer", label: "Lloguer d'equips de mesura", formula: `${fmt(s.meterRentEurMonth, 2)} €/mes × ${fmt(num(yearFrac.times(12)), 2)} mesos`, amount: num(rent), estimated: false });
  }

  /* ---- Impost indirecte (IVA / IGIC / IPSI) */
  const vatBase = subtotal.plus(iee).plus(rent);
  const vatAmount = cents(vatBase.times(D(vat.pct).div(100)));
  lines.push({ key: "impost_indirecte", label: `${vat.label} ${fmt(vat.pct, 2)} %`, formula: `${fmt(vat.pct, 2)} % × ${fmt(num(vatBase), 2)} €`, amount: num(vatAmount), estimated: false });

  const ok = missing.length === 0;
  return {
    ok,
    missing: [...new Set(missing)],
    lines,
    energy: num(energy),
    sas: num(sas),
    power: num(power),
    fixed: num(fixed),
    discounts: num(disc),
    subtotal: num(subtotal),
    iee: num(iee),
    rent: num(rent),
    vatBase: num(vatBase),
    vat: num(vatAmount),
    totalExTax: num(subtotal.plus(rent)),
    total: num(vatBase.plus(vatAmount)),
    quality: !ok ? "incomplet" : estimated || s.basis === "anualitzat" ? "estimat" : "exacte",
    notes,
    surplus: sur,
    detail: {
      energy: detE,
      power: detP,
      gasFixed: s.energyType === "gas" ? { days: s.days, price: sheet.gasFixedEurDay == null ? null : r6(D(sheet.gasFixedEurDay).div(div)), amount: sheet.gasFixedEurDay == null ? null : num(fixedGas) } : null,
      discountEnergy: num(discEnergy),
      discountPower: num(discPower),
      discountOther: num(disc.minus(discEnergy).minus(discPower)),
      fees: num(fixed.minus(fixedGas).minus(D(sur?.batteryFeeEur ?? 0))),
      single,
      ieeLabel: lines.find((l) => l.key === "iee" || l.key === "hidrocarburs")?.label ?? null,
      vatLabel: lines.find((l) => l.key === "impost_indirecte")?.label ?? "IVA",
    },
  };
}

/** kWh excedentaris del subministrament (0 si no n'hi ha). */
export function surplusKwh(s: SupplyInput): number {
  const x = s.surplus;
  if (!x) return 0;
  if (x.kwhTotal != null) return x.kwhTotal;
  if (x.byPeriod?.some((v) => v != null)) return x.byPeriod.reduce<number>((a, v) => a + (v ?? 0), 0);
  if (x.monthly?.some((v) => v != null)) return x.monthly.reduce<number>((a, v) => a + (v ?? 0), 0);
  return 0;
}

/**
 * Compensació d'excedents d'un escenari (tarifa del catàleg o contracte actual).
 *  - Compensació simplificada: el valor dels excedents es descompta del terme d'energia del període i MAI el pot
 *    superar (límit legal). Sense bateria virtual, el sobrant es perd; amb bateria, queda com a saldo (no redueix
 *    aquesta factura) i se'n mostra l'import a part. El cost de gestió de la bateria s'afegeix al cost.
 *  - «no_informada»: no es calcula i s'avisa (mai es posa zero). «sense»: la tarifa no compensa.
 *  - Contracte actual sense preu conegut: s'usa l'import compensat de la factura si es compara el mateix període.
 */
export function surplusFor(sheet: PriceSheet, s: SupplyInput, energyNet: Decimal, div: Decimal = D(1), yearFrac: Decimal = D(1), isCurrent = false): SurplusResult | null {
  const kwh = surplusKwh(s);
  if (!(kwh > 0)) return null;
  const cfg = sheet.surplus ?? null;
  const base = { kwh, priceEurKwh: null as Num, mode: (cfg?.mode ?? "no_informada") as SurplusMode, valueEur: 0, compensationEur: 0, toBatteryEur: 0, lostEur: 0, batteryFeeEur: 0, limited: false, estimated: false, note: null as string | null };
  const battery = !!cfg?.battery?.enabled || cfg?.mode === "bateria";
  const fee = battery && cfg?.battery?.feeEurMonth ? num(D(cfg.battery.feeEurMonth).times(12).times(yearFrac)) : 0;
  // contracte actual: import real de la factura quan no es coneix el preu
  if (isCurrent && (!cfg || cfg.mode === "no_informada") && s.surplus?.currentCompensationEur != null && s.basis === "periode_facturat") {
    return { ...base, status: "aplicada", compensationEur: s.surplus.currentCompensationEur, valueEur: s.surplus.currentCompensationEur, note: "Import compensat a la factura actual" };
  }
  if (!cfg || cfg.mode === "no_informada") return { ...base, status: "no_informada", note: "Compensació no informada" };
  if (cfg.mode === "sense") return { ...base, status: "no_compensa", note: "La tarifa no compensa excedents", batteryFeeEur: 0 };
  let value: Decimal | null = null;
  let price: Num = null;
  let estimated = cfg.mode === "indexat";
  if (cfg.mode === "periodes") {
    const bp = s.surplus?.byPeriod;
    const prices = cfg.periodEurKwh ?? [];
    if (bp?.some((v) => v != null) && bp.every((v, i) => v == null || v === 0 || prices[i] != null)) {
      value = bp.reduce((a, v, i) => a.plus(D(v ?? 0).times(D(prices[i] ?? 0))), D(0));
      price = kwh ? Number(value.div(kwh).toDecimalPlaces(6)) : null;
    } else {
      const known = prices.filter((x) => x != null) as number[];
      if (known.length && known.every((x) => x === known[0])) { price = known[0]; value = D(kwh).times(price); }
      else return { ...base, status: "pendent", note: "Compensació per períodes: cal el repartiment dels excedents per període", batteryFeeEur: fee };
    }
  } else {
    price = cfg.eurKwh;
    if (price == null) return { ...base, status: cfg.mode === "indexat" ? "pendent" : "no_informada", note: cfg.mode === "indexat" ? `Compensació indexada sense preu de referència${cfg.formula ? ` (${cfg.formula})` : ""}: no quantificada` : "Preu d'excedents no informat", batteryFeeEur: fee };
    value = D(kwh).times(D(price));
  }
  value = cents(value.div(div));
  const cap = energyNet.gt(0) ? cents(energyNet) : D(0);
  const simplified = (cfg.mechanism ?? "compensacio_simplificada") === "compensacio_simplificada";
  const comp = simplified && value.gt(cap) ? cap : value;
  const rest = value.minus(comp);
  if (cfg.mode === "indexat") estimated = true;
  return {
    ...base, priceEurKwh: price, status: "aplicada", valueEur: num(value), compensationEur: num(comp), limited: rest.gt(0),
    toBatteryEur: battery ? num(rest) : 0, lostEur: battery ? 0 : num(rest), batteryFeeEur: fee, estimated,
    note: `${fmt(kwh, 0)} kWh × ${price != null ? `${fmt(price)} €/kWh` : "preus per període"}${rest.gt(0) ? ` (límit: terme d'energia ${fmt(num(cap), 2)} €)` : ""}`,
  };
}

/** Elegibilitat d'una versió de tarifa per a un subministrament en una data. */
export function eligibility(o: OfferVersion, s: SupplyInput, today = new Date().toISOString().slice(0, 10)): Eligibility {
  const reasons: string[] = [];
  if (o.status !== "activa") reasons.push(`Tarifa en estat «${o.status}»`);
  if (o.validTo && o.validTo < today) reasons.push(`Caducada el ${o.validTo}`);
  if (o.validFrom && o.validFrom > today) reasons.push(`Vigent a partir del ${o.validFrom}`);
  if (o.energyType !== s.energyType) reasons.push(o.energyType === "gas" ? "Oferta de gas" : "Oferta de llum");
  const a = normalizeTariff(o.accessTariff);
  const b = normalizeTariff(s.accessTariff);
  if (b && a !== b) reasons.push(`Peatge ${o.accessTariff} ≠ ${s.accessTariff}`);
  if (s.segment && !o.segments.includes(s.segment)) reasons.push(`No disponible per al segment ${s.segment}`);
  const per = periodsOf(s.accessTariff, s.energyType);
  const kwh = totalKwh(s, per.energy);
  const annualKwh = kwh != null ? (kwh * 365) / s.days : null;
  const e = o.eligibility;
  if (annualKwh != null && e.minKwh != null && annualKwh < e.minKwh) reasons.push(`Consum anual inferior al mínim (${e.minKwh} kWh)`);
  if (annualKwh != null && e.maxKwh != null && e.maxKwh > 0 && annualKwh > e.maxKwh) reasons.push(`Consum anual superior al màxim (${e.maxKwh} kWh)`);
  const kws = s.kw.filter((x): x is number => x != null);
  const maxKw = kws.length ? Math.max(...kws) : null;
  if (maxKw != null && e.minKw != null && maxKw < e.minKw) reasons.push(`Potència inferior al mínim (${e.minKw} kW)`);
  if (maxKw != null && e.maxKw != null && e.maxKw > 0 && maxKw > e.maxKw) reasons.push(`Potència superior al màxim (${e.maxKw} kW)`);
  if (e.territories?.length && !e.territories.includes(s.territory)) reasons.push(`No disponible a ${s.territory}`);
  // Tarifa Open: el tram de preus es tria SEMPRE per la potència contractada P6 (criteri de Direcció); no es barregen trams
  if (o.open && !o.open.label) {
    const p6 = s.kw[5] ?? null;
    const b = o.open.bracket;
    if (p6 == null) reasons.push("Cal la potència contractada P6 per triar el tram de preus");
    else if ((b.minKw != null && !(p6 > b.minKw)) || (b.maxKw != null && p6 > b.maxKw)) reasons.push(`Tram per a ${b.label}: la P6 contractada és ${p6} kW`);
    if (!o.open.approved) reasons.push("Conversió pendent de validar per Direcció");
  } else if (o.open && !o.open.approved) reasons.push("Conversió pendent de validar per Direcció");
  return { eligible: reasons.length === 0, reasons };
}
