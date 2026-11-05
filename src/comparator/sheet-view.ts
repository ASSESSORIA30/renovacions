/**
 * Fase 3 · Full de comparació en 4 columnes (ACTUAL | OPCIÓ 1 | OPCIÓ 2 | OPCIÓ 3).
 * Model de presentació compartit: el PDF el dibuixa i els tests el comproven contra el resultat del motor.
 * Aquí NO es recalcula cap import: tot surt del Snapshot (CostResult i el seu detall per període).
 */
import { periodsOf, surplusKwh } from "./engine";
import { snapshotPermanenceLabel, permanenceIssues } from "./permanence";
import { presentationOrder, type Snapshot } from "./snapshot";
import { SURPLUS_MODE_LABEL, type CostResult, type OfferEvaluation, type PriceSheet } from "./types";

export type Lang = "ca" | "es";
const TXT = {
  ca: {
    titleLuz: "COMPARATIVA DE TARIFES ELÈCTRIQUES", titleGas: "COMPARATIVA DE TARIFES DE GAS", access: "Tarifa d'accés", periods: (n: number) => (n === 1 ? "1 període" : `${n} períodes`),
    actual: "ACTUAL", option: (i: number) => `OPCIÓ ${i}`, best: "MILLOR OPCIÓ", noCurrent: "Sense preus actuals",
    energy: "ENERGIA", power: "POTÈNCIA", fixedGas: "TERME FIX", adjust: "DESCOMPTES\nI SAS", surplus: "EXCEDENTS /\nAUTO-\nCONSUM", other: "ALTRES\nCONCEPTES", conditions: "CONDICIONS",
    period: "Període", kwh: "Consum (kWh)", kw: "Potència (kW)", days: "Dies", priceKwh: "Preu (€/kWh)", priceKw: "Preu (€/kW·dia)", priceDay: "Preu (€/dia)", amount: "Import (€)",
    totalEnergy: "Total energia", totalPower: "Total potència", totalFixed: "Total terme fix", single: "Preu únic", fixedRow: (d: number) => `Terme fix (${d} dies)`,
    discE: "Descompte sobre energia", discP: "Descompte sobre potència", discO: "Altres descomptes", sas: "SAS / SSAA", fees: "Quotes i serveis addicionals",
    sasInc: "Inclòs al preu", sasExc: "No aplicable", sasNo: "No quantificat",
    surKwh: "Excedents (kWh)", surMode: "Modalitat", surPrice: "Preu compensació (€/kWh)", surComp: "Import compensat", surBat: "Bateria virtual",
    notInf: "No informat", pending: "Pendent", noComp: "No compensa", toBattery: "al saldo", fee: "quota", lost: "no compensats",
    rent: "Lloguer d'equips de mesura", base: "Base imposable", perm: "Permanència", type: "Tipus · vigència", penalty: "Penalització", until: "fins al", noEnd: "sense data de fi",
    total: (p: string) => `TOTAL FACTURA (${p})`, saving: "ESTALVI RESPECTE DE LA COMERCIALITZADORA ACTUAL", ref: "Referència", more: "Més car",
    pAnnual: "anual", pAnnualized: "anual, estimació", pBilled: (d: number) => `període facturat · ${d} dies`, analyzed: "Període analitzat",
    from: "Del", to: "al", estimated: "* Import estimat (indexada, SAS variable o excedents estimats).", notCalc: "No calculable", missing: "Falta",
    clientData: "DADES DEL SUBMINISTRAMENT", client: "Client", cups: "CUPS", totalKwh: "CONSUM TOTAL", contracted: "POTÈNCIA CONTRACTADA", currentRetailer: "COMERCIALITZADORA ACTUAL",
    excluded: "No elegible", disclaimer: "Imports calculats amb les dades i hipòtesis indicades. No són estalvis garantits: els consums i preus reals poden variar.",
  },
  es: {
    titleLuz: "COMPARATIVA DE TARIFAS ELÉCTRICAS", titleGas: "COMPARATIVA DE TARIFAS DE GAS", access: "Tarifa de acceso", periods: (n: number) => (n === 1 ? "1 periodo" : `${n} periodos`),
    actual: "ACTUAL", option: (i: number) => `OPCIÓN ${i}`, best: "MEJOR OPCIÓN", noCurrent: "Sin precios actuales",
    energy: "ENERGÍA", power: "POTENCIA", fixedGas: "TÉRMINO FIJO", adjust: "DESCUENTOS\nY SAS", surplus: "EXCEDENTES /\nAUTO-\nCONSUMO", other: "OTROS\nCONCEPTOS", conditions: "CONDICIONES",
    period: "Periodo", kwh: "Consumo (kWh)", kw: "Potencia (kW)", days: "Días", priceKwh: "Precio (€/kWh)", priceKw: "Precio (€/kW·día)", priceDay: "Precio (€/día)", amount: "Importe (€)",
    totalEnergy: "Total energía", totalPower: "Total potencia", totalFixed: "Total término fijo", single: "Precio único", fixedRow: (d: number) => `Término fijo (${d} días)`,
    discE: "Descuento sobre energía", discP: "Descuento sobre potencia", discO: "Otros descuentos", sas: "SAS / SSAA", fees: "Cuotas y servicios adicionales",
    sasInc: "Incluido en el precio", sasExc: "No aplicable", sasNo: "No cuantificado",
    surKwh: "Excedentes (kWh)", surMode: "Modalidad", surPrice: "Precio compensación (€/kWh)", surComp: "Importe compensado", surBat: "Batería virtual",
    notInf: "No informado", pending: "Pendiente", noComp: "No compensa", toBattery: "al saldo", fee: "cuota", lost: "no compensados",
    rent: "Alquiler de equipos de medida", base: "Base imponible", perm: "Permanencia", type: "Tipo · vigencia", penalty: "Penalización", until: "hasta el", noEnd: "sin fecha de fin",
    total: (p: string) => `TOTAL FACTURA (${p})`, saving: "AHORRO RESPECTO A LA COMERCIALIZADORA ACTUAL", ref: "Referencia", more: "Más caro",
    pAnnual: "anual", pAnnualized: "anual, estimación", pBilled: (d: number) => `periodo facturado · ${d} días`, analyzed: "Periodo analizado",
    from: "Del", to: "al", estimated: "* Importe estimado (indexada, SAS variable o excedentes estimados).", notCalc: "No calculable", missing: "Falta",
    clientData: "DATOS DEL SUMINISTRO", client: "Cliente", cups: "CUPS", totalKwh: "CONSUMO TOTAL", contracted: "POTENCIA CONTRATADA", currentRetailer: "COMERCIALIZADORA ACTUAL",
    excluded: "No elegible", disclaimer: "Importes calculados con los datos e hipótesis indicados. No son ahorros garantizados: los consumos y precios reales pueden variar.",
  },
} as const;
const MODE_ES: Record<string, string> = { no_informada: "No informada", sense: "Sin compensación", fix: "Precio fijo", periodes: "Por periodos", indexat: "Indexada", bateria: "Batería virtual" };
const CT: Record<Lang, Record<string, string>> = {
  ca: { fix24h: "Fix 24 h", periodes: "Fix per períodes", indexat: "Indexat", mixt: "Mixt" },
  es: { fix24h: "Fijo 24 h", periodes: "Fijo por periodos", indexat: "Indexado", mixt: "Mixto" },
};

// es-ES no agrupa els milers de 4 xifres (2850): es fa servir el format català, que té els mateixos separadors
const loc = (l: Lang) => (l === "es" ? "ca-ES" : "ca-ES");
export const fmtEur = (n: number | null | undefined, l: Lang) => (n == null ? "—" : (Object.is(n, -0) ? 0 : n).toLocaleString(loc(l), { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtNum = (n: number | null | undefined, d: number, l: Lang, min = 0) => (n == null ? "—" : n.toLocaleString(loc(l), { minimumFractionDigits: min, maximumFractionDigits: d }));
const fmtDate = (s: string | null | undefined, l: Lang) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString(loc(l), { day: "2-digit", month: "2-digit", year: "numeric" }) : null);

export interface SheetColumn { role: string; supplier: string; product: string; best: boolean; calculable: boolean; eligible: boolean; estimated: boolean; note: string | null }
/** Fila amb preu i import per columna (blocs d'energia, potència i terme fix). */
export interface PricedRow { label: string; qty: string; cells: { price: string; amount: string }[] }
/** Fila amb un sol valor per columna (descomptes, excedents, altres, condicions). */
export interface ValueRow { label: string; qty?: string; values: string[]; warn?: boolean[] }
export interface PricedBlock { kind: "priced"; id: "energia" | "potencia" | "fix_gas"; title: string; head: [string, string, string, string]; rows: PricedRow[]; total: { label: string; qty: string; amounts: string[]; values: (number | null)[] } }
export interface ValueBlock { kind: "values"; id: "ajustos" | "excedents" | "altres" | "condicions"; title: string; rows: ValueRow[] }
export type SheetBlock = PricedBlock | ValueBlock;

export interface ComparisonSheet {
  lang: Lang;
  title: string;
  subtitle: { label: string; tariff: string; periods: string };
  info: { client: string; cups: string; tariff: string; period: string; kwhTotal: string; power: string; retailer: string };
  columns: SheetColumn[];
  blocks: SheetBlock[];
  periodLabel: string;
  totals: { label: string; values: (number | null)[]; text: string[] };
  savings: { label: string; values: (number | null)[]; pct: (number | null)[]; text: string[] };
  bestIndex: number | null;
  notes: string[];
}

function sasCell(sheet: PriceSheet | null, c: CostResult | null, l: Lang): string {
  const t = TXT[l];
  if (!sheet) return "—";
  if (sheet.sas.mode === "inclos") return t.sasInc;
  if (sheet.sas.mode === "exclos") return t.sasExc;
  if (c && c.sas > 0) return `${fmtEur(c.sas, l)} *`;
  return t.sasNo;
}

/** Text del període del resultat: mai «mensual» si el càlcul no és mensual. */
export function periodLabel(s: Pick<Snapshot, "supply">, l: Lang): string {
  const t = TXT[l];
  return s.supply.basis === "anual" ? t.pAnnual : s.supply.basis === "anualitzat" ? t.pAnnualized : t.pBilled(s.supply.days);
}

export function comparisonSheet(s: Snapshot, l: Lang = "ca"): ComparisonSheet {
  const t = TXT[l];
  const gas = s.supply.energyType === "gas";
  const per = periodsOf(s.supply.accessTariff, s.supply.energyType);
  const alts = presentationOrder(s);
  const cur = s.result.current;
  type Col = { sheet: PriceSheet | null; cost: CostResult | null; ev: OfferEvaluation | null };
  const cols: Col[] = [{ sheet: s.current, cost: cur, ev: null }, ...alts.map((e) => ({ sheet: e.offer as PriceSheet, cost: e.cost, ev: e }))];
  const bestIndex = alts.length && alts[0].cost.ok && alts[0].eligibility.eligible && s.result.ranked[0]?.offer.id === alts[0].offer.id ? 1 : null;

  const columns: SheetColumn[] = cols.map((c, i) => ({
    role: i === 0 ? t.actual : t.option(i),
    supplier: i === 0 ? (s.currentRetailer || s.currentLabel || "—") : c.ev!.offer.supplierName,
    product: i === 0 ? (s.current ? CT[l][s.current.contractType] ?? "" : t.noCurrent) : c.ev!.offer.productName,
    best: bestIndex === i,
    calculable: !!c.cost?.ok,
    eligible: i === 0 || !!c.ev?.eligibility.eligible,
    estimated: c.cost?.quality === "estimat",
    note: !c.cost ? (i === 0 ? t.noCurrent : null) : !c.cost.ok ? `${t.notCalc}: ${t.missing.toLowerCase()} ${c.cost.missing.slice(0, 2).join(", ")}` : c.ev && !c.ev.eligibility.eligible ? `${t.excluded}: ${c.ev.eligibility.reasons[0] ?? ""}` : null,
  }));

  const kwhKnown = s.supply.kwh.slice(0, per.energy).every((x) => x != null);
  const kwhTotal = s.supply.kwhTotal ?? (kwhKnown ? s.supply.kwh.slice(0, per.energy).reduce<number>((a, x) => a + (x as number), 0) : null);
  const blocks: SheetBlock[] = [];
  const hasLine = (c: CostResult | null, key: string) => !!c?.lines.some((x) => x.key === key);
  const sub = (c: CostResult | null, key: "energia" | "potencia" | "fix_gas", v: (c: CostResult) => number) => (c && hasLine(c, key) ? v(c) : null);
  const star = (c: CostResult | null, key: string) => (c?.lines.some((x) => x.key === key && x.estimated) ? " *" : "");

  /* ---- Energia */
  const perPeriod = !gas && per.energy > 1 && kwhKnown;
  const eRows: PricedRow[] = [];
  const rawPrice = (sh: PriceSheet | null, i: number | null): number | null => {
    if (!sh) return null;
    if (sh.contractType === "fix24h" || gas || i == null) return sh.energy24h ?? (gas ? sh.energy[0] : null);
    return (sh.contractType === "indexat" ? sh.indexedReference?.energy[i] : sh.energy[i]) ?? sh.energy24h ?? null;
  };
  const eCell = (c: Col, period: number | null) => {
    const d = c.cost?.detail;
    if (d) {
      const x = period == null ? d.energy.find((e) => e.period == null) ?? (d.energy.length === 1 ? d.energy[0] : undefined) : d.energy.find((e) => e.period === period);
      if (x) return { price: fmtNum(x.price, 6, l, 6), amount: fmtEur(x.amount, l) + (x.amount != null ? star(c.cost, "energia") : "") };
      if (period == null && d.energy.length && d.single === false) return { price: "—", amount: "—" };
    }
    return { price: fmtNum(rawPrice(c.sheet, period == null ? null : period - 1), 6, l, 6), amount: "—" };
  };
  if (perPeriod) for (let i = 0; i < per.energy; i++) eRows.push({ label: `P${i + 1}`, qty: fmtNum(s.supply.kwh[i], 0, l), cells: cols.map((c) => eCell(c, i + 1)) });
  else eRows.push({ label: gas ? (l === "es" ? "Variable" : "Variable") : per.energy === 1 ? "P1" : t.single, qty: fmtNum(kwhTotal, 0, l), cells: cols.map((c) => eCell(c, null)) });
  const eVals = cols.map((c) => sub(c.cost, "energia", (x) => x.energy));
  blocks.push({ kind: "priced", id: "energia", title: t.energy, head: [t.period, t.kwh, t.priceKwh, t.amount], rows: eRows, total: { label: t.totalEnergy, qty: fmtNum(kwhTotal, 0, l), amounts: eVals.map((v, i) => fmtEur(v, l) + (v != null ? star(cols[i].cost, "energia") : "")), values: eVals } });

  /* ---- Potència o terme fix del gas */
  if (per.power > 0) {
    const pRows: PricedRow[] = Array.from({ length: per.power }, (_, i) => ({
      label: `P${i + 1}`,
      qty: fmtNum(s.supply.kw[i], 3, l),
      cells: cols.map((c) => {
        const x = c.cost?.detail?.power.find((p) => p.period === i + 1);
        return x ? { price: fmtNum(x.price, 6, l, 6), amount: fmtEur(x.amount, l) } : { price: c.sheet?.power[i] != null && c.sheet.powerUnit === "eur_kw_dia" ? fmtNum(c.sheet.power[i], 6, l, 6) : "—", amount: "—" };
      }),
    }));
    const pVals = cols.map((c) => sub(c.cost, "potencia", (x) => x.power));
    blocks.push({ kind: "priced", id: "potencia", title: t.power, head: [t.period, t.kw, t.priceKw, t.amount], rows: pRows, total: { label: t.totalPower, qty: "", amounts: pVals.map((v) => fmtEur(v, l)), values: pVals } });
  } else if (gas) {
    const gVals = cols.map((c) => c.cost?.detail?.gasFixed?.amount ?? null);
    blocks.push({
      kind: "priced", id: "fix_gas", title: t.fixedGas, head: ["", t.days, t.priceDay, t.amount],
      rows: [{ label: l === "es" ? "Fijo" : "Fix", qty: String(s.supply.days), cells: cols.map((c) => ({ price: fmtNum(c.cost?.detail?.gasFixed?.price ?? c.sheet?.gasFixedEurDay ?? null, 6, l, 6), amount: fmtEur(c.cost?.detail?.gasFixed?.amount ?? null, l) })) }],
      total: { label: t.totalFixed, qty: "", amounts: gVals.map((v) => fmtEur(v, l)), values: gVals },
    });
  }

  /* ---- Descomptes, SAS i serveis */
  const neg = (v: number | null | undefined) => (v ? `−${fmtEur(v, l)}` : "—");
  const adj: ValueRow[] = [];
  const dE = cols.map((c) => c.cost?.detail?.discountEnergy ?? null);
  const dP = cols.map((c) => c.cost?.detail?.discountPower ?? null);
  const dO = cols.map((c) => (c.cost?.detail ? c.cost.detail.discountOther : c.cost?.discounts ?? null));
  if (dE.some((v) => v)) adj.push({ label: t.discE, values: dE.map(neg) });
  if (dP.some((v) => v)) adj.push({ label: t.discP, values: dP.map(neg) });
  if (dO.some((v) => v)) adj.push({ label: t.discO, values: dO.map(neg) });
  if (!gas) adj.push({ label: t.sas, values: cols.map((c) => sasCell(c.sheet, c.cost, l)) });
  const fees = cols.map((c) => (c.cost?.detail ? c.cost.detail.fees : null));
  if (fees.some((v) => v)) adj.push({ label: t.fees, values: fees.map((v) => (v ? fmtEur(v, l) : "—")) });
  if (adj.length) blocks.push({ kind: "values", id: "ajustos", title: t.adjust, rows: adj });

  /* ---- Excedents (només si n'hi ha) */
  const sk = surplusKwh(s.supply);
  if (sk > 0) {
    const modeOf = (c: Col) => {
      const m = c.cost?.surplus?.mode ?? c.sheet?.surplus?.mode ?? "no_informada";
      return l === "es" ? MODE_ES[m] : SURPLUS_MODE_LABEL[m];
    };
    blocks.push({
      kind: "values", id: "excedents", title: t.surplus, rows: [
        { label: t.surKwh, values: cols.map((c) => (c.cost?.surplus ? fmtNum(c.cost.surplus.kwh, 0, l) : "—")) },
        { label: t.surMode, values: cols.map((c, i) => (!c.cost ? "—" : i === 0 && !c.sheet?.surplus ? (s.supply.surplus?.currentMode && s.supply.surplus.currentMode !== "no_informada" ? (l === "es" ? MODE_ES[s.supply.surplus.currentMode] : SURPLUS_MODE_LABEL[s.supply.surplus.currentMode]) : l === "es" ? "Según factura" : "Segons factura") : modeOf(c))) },
        { label: t.surPrice, values: cols.map((c) => { const x = c.cost?.surplus; if (!x) return "—"; if (x.status === "no_compensa") return t.noComp; if (x.priceEurKwh != null) return fmtNum(x.priceEurKwh, 6, l, 6); return x.status === "pendent" ? t.pending : t.notInf; }) },
        { label: t.surComp, values: cols.map((c) => { const x = c.cost?.surplus; if (!x) return "—"; if (x.status === "no_informada") return t.notInf; if (x.status === "pendent") return t.pending; return x.compensationEur ? `−${fmtEur(x.compensationEur, l)}${x.estimated ? " *" : ""}` : "0,00"; }) },
        { label: t.surBat, values: cols.map((c) => { const x = c.cost?.surplus; if (!x) return "—"; if (x.toBatteryEur > 0 || x.batteryFeeEur > 0) return [x.toBatteryEur > 0 ? `${fmtEur(x.toBatteryEur, l)} ${t.toBattery}` : null, x.batteryFeeEur ? `${t.fee} ${fmtEur(x.batteryFeeEur, l)}` : null].filter(Boolean).join(" · "); return x.lostEur > 0 ? `${fmtEur(x.lostEur, l)} ${t.lost}` : "—"; }) },
      ],
    });
  }

  /* ---- Altres conceptes i impostos */
  const ieeLabel = cols.map((c) => c.cost?.lines.find((x) => x.key === "iee" || x.key === "hidrocarburs")).find(Boolean);
  const ieePct = !gas ? ` (${fmtNum(s.taxes.ieePct, 8, l)} %)` : "";
  const vatLine = cols.map((c) => c.cost?.lines.find((x) => x.key === "impost_indirecte")).find(Boolean);
  const other: ValueRow[] = [];
  if (cols.some((c) => c.cost?.rent)) other.push({ label: t.rent, values: cols.map((c) => (c.cost ? fmtEur(c.cost.rent, l) : "—")) });
  other.push({ label: (ieeLabel?.label ?? (gas ? "Impost d'hidrocarburs" : "Impost elèctric")) + ieePct, values: cols.map((c) => (c.cost?.ok ? fmtEur(c.cost.iee, l) : "—")) });
  other.push({ label: t.base, values: cols.map((c) => (c.cost?.ok ? fmtEur(c.cost.vatBase, l) : "—")) });
  other.push({ label: vatLine?.label ?? "IVA", values: cols.map((c) => (c.cost?.ok ? fmtEur(c.cost.vat, l) : "—")) });
  if (l === "es") for (const r of other) r.label = r.label.replace("Impost elèctric", "Impuesto eléctrico").replace("Impost d'hidrocarburs", "Impuesto de hidrocarburos").replace("Lloguer", "Alquiler");
  blocks.push({ kind: "values", id: "altres", title: t.other, rows: other });

  /* ---- Condicions */
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const permVals = cols.map((c, i) => (i === 0 ? "—" : cap(snapshotPermanenceLabel(c.ev!.offer, s.engineVersion, l).replace(/^Permanencia: /, "").replace(/^Permanència: /, ""))));
  const permWarn = cols.map((c, i) => i > 0 && !/^1\.0\./.test(s.engineVersion) && permanenceIssues(c.ev!.offer).length > 0);
  const typeVals = cols.map((c, i) => {
    if (!c.sheet) return "—";
    const ct = CT[l][c.sheet.contractType] ?? "";
    if (i === 0) return ct;
    const to = fmtDate(c.ev!.offer.validTo, l);
    return `${ct} · ${to ? `${t.until} ${to}` : t.noEnd}`;
  });
  const cond: ValueRow[] = [{ label: t.perm, values: permVals, warn: permWarn }, { label: t.type, values: typeVals }];
  if (alts.some((e) => e.offer.permanence?.penalty || e.offer.penalty)) cond.push({ label: t.penalty, values: cols.map((c, i) => (i === 0 ? "—" : (c.ev!.offer.permanence?.penalty ?? c.ev!.offer.penalty ?? "—").slice(0, 60))) });
  blocks.push({ kind: "values", id: "condicions", title: t.conditions, rows: cond });

  /* ---- Totals i estalvi */
  const pl = periodLabel(s, l);
  const totals = cols.map((c) => (c.cost?.ok ? c.cost.total : null));
  const savings = cols.map((c, i) => (i === 0 ? null : c.ev?.saving ?? null));
  const pct = cols.map((c, i) => (i === 0 ? null : c.ev?.savingPct ?? null));

  const from = fmtDate(s.supply.periodFrom ?? null, l), to = fmtDate(s.supply.periodTo ?? null, l);
  const periodTxt = from && to ? `${t.from} ${from} ${t.to} ${to} (${s.supply.days} ${l === "es" ? "días" : "dies"})` : s.supply.basis === "anual" ? (l === "es" ? "Consumo anual (365 días)" : "Consum anual (365 dies)") : s.supply.basis === "anualitzat" ? (l === "es" ? `Anualizado desde ${s.supply.days} días (estimación)` : `Anualitzat des de ${s.supply.days} dies (estimació)`) : `${s.supply.days} ${l === "es" ? "días facturados" : "dies facturats"}`;
  const kws = s.supply.kw.slice(0, per.power).filter((x): x is number => x != null);
  const power = !kws.length ? "—" : kws.every((k) => k === kws[0]) ? `${fmtNum(kws[0], 3, l)} kW` : kws.map((k, i) => `P${i + 1} ${fmtNum(k, 2, l)}`).join(" · ") + " kW";

  const notes: string[] = [];
  if (cols.some((c) => c.cost?.quality === "estimat") || blocks.some((b) => JSON.stringify(b).includes(" *"))) notes.push(t.estimated);
  columns.forEach((c) => { if (c.note) notes.push(`${c.role} · ${c.supplier}: ${c.note}`); });
  notes.push(t.disclaimer);

  return {
    lang: l,
    title: gas ? t.titleGas : t.titleLuz,
    subtitle: { label: t.access, tariff: s.supply.accessTariff ?? "—", periods: `(${t.periods(per.energy)})` },
    info: { client: s.client.name ?? "—", cups: s.cups ?? "—", tariff: s.supply.accessTariff ?? "—", period: periodTxt, kwhTotal: kwhTotal != null ? `${fmtNum(kwhTotal, 0, l)} kWh` : "—", power: gas ? `${s.supply.days} ${l === "es" ? "días" : "dies"}` : power, retailer: s.currentRetailer || s.currentLabel || "—" },
    columns, blocks, periodLabel: pl,
    totals: { label: t.total(pl), values: totals, text: totals.map((v, i) => (v == null ? (i === 0 && !cur ? t.noCurrent : t.notCalc) : `${fmtEur(v, l)} €`)) },
    savings: { label: t.saving, values: savings, pct, text: savings.map((v, i) => (i === 0 ? t.ref : v == null ? "—" : `${v >= 0 ? "" : `${t.more} `}${fmtEur(Math.abs(v), l)} €`)) },
    bestIndex,
    notes,
  };
}
