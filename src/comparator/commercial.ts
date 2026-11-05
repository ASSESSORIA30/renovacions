/**
 * MATRIU COMERCIAL (nivell d'energia × marge de potència BOE) · lògica pura.
 *
 *  - Els preus que pagarà el client surten SEMPRE de la taula publicada al document (cap increment aproximat).
 *  - La comissió es calcula amb la regla confirmada per Direcció per a Nufri:
 *      · energia  = MWh × €/MWh del nivell (FUJI, GOLDEN, GALA, GALAXY, ROYAL G…)
 *      · potència = (suma dels kW contractats de TOTS els períodes del peatge) × marge BOE (€/kW·any)
 *    Les dues parts es mantenen separades. Aquesta fórmula és específica de l'esquema «nufri»: no s'aplica mai
 *    automàticament a altres comercialitzadores.
 *  - El cost per al client es calcula amb el motor de comparatives existent (`computeCost`): no hi ha un segon motor.
 */
import Decimal from "decimal.js-light";
import { computeCost, periodsOf } from "./engine";
import type { CommercialMatrix, CostResult, OfferVersion, SupplyInput } from "./types";

export interface CommercialSelection { level: string; margin: string | null }

const pad6 = <T,>(xs: (T | null)[]) => Array.from({ length: 6 }, (_, i) => xs[i] ?? null);

export function levelOf(m: CommercialMatrix, id: string | null | undefined) {
  return m.levels.find((l) => l.id === id) ?? m.levels.find((l) => l.id === m.default.level) ?? m.levels[0];
}
export function marginOf(m: CommercialMatrix, id: string | null | undefined) {
  if (!m.margins.length) return null;
  return m.margins.find((x) => x.id === id) ?? m.margins.find((x) => x.id === m.default.margin) ?? m.margins[0];
}

/** Combinació efectiva (la triada o, si no n'hi ha, la per defecte). */
export function selectionOf(o: Pick<OfferVersion, "commercial">, sel?: Partial<CommercialSelection> | null): CommercialSelection | null {
  const m = o.commercial;
  if (!m) return null;
  return { level: levelOf(m, sel?.level).id, margin: marginOf(m, sel?.margin)?.id ?? null };
}

/** Versió de la tarifa amb els preus PUBLICATS de la combinació triada (no modifica l'original). */
export function applyCommercial(o: OfferVersion, sel: Partial<CommercialSelection> | null | undefined): OfferVersion {
  const c: OfferVersion = structuredClone(o);
  const m = o.commercial;
  if (!m) return c;
  const lv = levelOf(m, sel?.level);
  const mg = marginOf(m, sel?.margin);
  if (c.contractType === "fix24h" || o.energyType === "gas") c.energy24h = lv.energy24h ?? lv.energy[0] ?? null;
  else c.energy = pad6(lv.energy);
  if (mg) { c.power = pad6(mg.power); c.powerUnit = "eur_kw_dia"; }
  // preus amb descompte publicat: l'original del nivell triat viatja a template.original (no es torna a descomptar)
  if (lv.original && c.template) c.template = { ...c.template, original: { energy: pad6(lv.original.energy24h != null && (c.contractType === "fix24h" || o.energyType === "gas") ? [lv.original.energy24h] : lv.original.energy), power: c.power, powerUnit: "eur_kw_dia" } };
  const suffix = ` · ${lv.label}`;
  const base = o.commercial!.levels.reduce((name, l) => (name.endsWith(` · ${l.label}`) ? name.slice(0, -(` · ${l.label}`).length) : name), o.productName);
  c.productName = `${base}${suffix}`;
  return c;
}

/* ------------------------------------------------------------------ comissió */

export interface CommissionInput {
  /** Consum anual (kWh) */
  annualKwh: number | null;
  /** Potències contractades P1–P6 (kW) */
  kw: (number | null)[];
  /** Peatge (per saber quants períodes de potència compten: 2.0TD → 2, 3.0TD → 6) */
  accessTariff: string | null;
  energyType?: "luz" | "gas";
  /** €/MWh del nivell d'energia (de la regla aprovada o del document) */
  energyEurMwh: number | null;
  /** Marge BOE (€/kW·any) */
  marginEurKwYear: number | null;
  /** Mesos de càlcul (12 = un any de contracte) */
  months?: number;
  /** % del col·laborador sobre la comissió que cobra Assessoria 3.0 */
  collaboratorPct?: number | null;
}
export interface CommissionResult {
  mwh: string | null;
  kwSum: string;
  energy: string | null;
  power: string | null;
  total: string | null;
  collaborator: string | null;
  remainder: string | null;
  formulaEnergy: string;
  formulaPower: string;
  missing: string[];
}
const D = (v: number | string) => new Decimal(v);
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const fmt = (d: Decimal, dp = 3) => Number(d.toDecimalPlaces(dp).toString()).toLocaleString("ca-ES", { maximumFractionDigits: dp });

/** Suma dels kW contractats de tots els períodes de potència del peatge (2.0TD: P1+P2; 3.0TD: P1…P6). */
export function kwSum(kw: (number | null)[], accessTariff: string | null, energyType: "luz" | "gas" = "luz"): Decimal {
  const n = periodsOf(accessTariff, energyType).power || kw.length;
  return kw.slice(0, n).reduce<Decimal>((a, x) => a.plus(x ?? 0), D(0));
}

export function commercialCommission(inp: CommissionInput): CommissionResult {
  const months = D(inp.months ?? 12);
  const missing: string[] = [];
  const mwh = inp.annualKwh != null ? D(inp.annualKwh).div(1000).times(months).div(12) : null;
  if (inp.energyEurMwh != null && mwh == null) missing.push("Consum anual (kWh)");
  const kw = kwSum(inp.kw, inp.accessTariff, inp.energyType ?? "luz");
  const power = inp.marginEurKwYear == null ? null : kw.times(inp.marginEurKwYear).times(months).div(12);
  if (inp.marginEurKwYear != null && kw.isZero()) missing.push("Potències contractades (kW)");
  const energy = inp.energyEurMwh != null && mwh ? mwh.times(inp.energyEurMwh) : null;
  const total = energy || power ? (energy ?? D(0)).plus(power ?? D(0)) : null;
  const pct = inp.collaboratorPct ?? null;
  const collaborator = total && pct != null ? total.times(pct).div(100) : null;
  const m12 = months.eq(12) ? "" : ` × ${fmt(months, 2)}/12 mesos`;
  return {
    mwh: mwh ? mwh.toDecimalPlaces(3).toString() : null,
    kwSum: kw.toString(),
    energy: energy ? money(energy) : null,
    power: power ? money(power) : null,
    total: total ? money(total) : null,
    collaborator: collaborator ? money(collaborator) : null,
    // el que queda per a Assessoria 3.0 es calcula a partir dels imports ja arrodonits (cap cèntim perdut)
    remainder: total ? money(D(money(total)).minus(collaborator ? money(collaborator) : 0)) : null,
    formulaEnergy: inp.energyEurMwh == null ? "Sense nivell d'energia" : mwh ? `${fmt(mwh)} MWh × ${fmt(D(inp.energyEurMwh), 2)} €/MWh` : "Falta el consum anual",
    formulaPower: inp.marginEurKwYear == null ? "Sense marge de potència" : `${fmt(kw)} kW (suma de períodes) × ${fmt(D(inp.marginEurKwYear), 2)} €/kW·any${m12}`,
    missing,
  };
}

/* ------------------------------------------------------------------ simulador de marges */

export interface MarginRow {
  margin: { id: string; label: string; eurKwYear: number };
  /** Preus de potència publicats (€/kW·dia) */
  power: (number | null)[];
  /** Cost de potència del client i cost total (motor de comparatives) */
  clientPower: number | null;
  clientTotal: number | null;
  /** Diferència de cost total respecte de la primera modalitat (BOE) */
  diffVsBase: number | null;
  /** Diferència del cost de potència respecte de la primera modalitat (BOE) */
  diffPowerVsBase: number | null;
  commission: CommissionResult;
  selected: boolean;
  cost: CostResult;
}

/**
 * Taula de totes les modalitats BOE amb els MATEIXOS dies, potències i consums. El cost del client surt del motor
 * de comparatives; la comissió, de `commercialCommission`.
 */
export function marginTable(o: OfferVersion, supply: SupplyInput, opts: { level: string | null; selected: string | null; energyEurMwh: number | null; collaboratorPct: number | null; annualKwh: number | null; months?: number }): MarginRow[] {
  const m = o.commercial;
  if (!m) return [];
  const margins = m.margins.length ? m.margins : [null];
  const rows = margins.map((mg) => {
    const v = applyCommercial(o, { level: opts.level ?? m.default.level, margin: mg?.id ?? null });
    const cost = computeCost(v, supply);
    return {
      margin: mg ? { id: mg.id, label: mg.label, eurKwYear: mg.eurKwYear } : { id: "-", label: "—", eurKwYear: 0 },
      power: v.power,
      clientPower: cost.lines.some((l) => l.key === "potencia") ? cost.power : null,
      clientTotal: cost.ok ? cost.total : null,
      diffVsBase: null as number | null,
      diffPowerVsBase: null as number | null,
      commission: commercialCommission({ annualKwh: opts.annualKwh, kw: supply.kw, accessTariff: supply.accessTariff, energyType: supply.energyType, energyEurMwh: opts.energyEurMwh, marginEurKwYear: mg ? mg.eurKwYear : null, months: opts.months, collaboratorPct: opts.collaboratorPct }),
      selected: (mg?.id ?? null) === (opts.selected ?? m.default.margin),
      cost,
    };
  });
  const base = rows[0]?.clientTotal;
  const baseP = rows[0]?.clientPower;
  for (const r of rows) {
    r.diffVsBase = base != null && r.clientTotal != null ? Number(D(r.clientTotal).minus(base).toFixed(2)) : null;
    r.diffPowerVsBase = baseP != null && r.clientPower != null ? Number(D(r.clientPower).minus(baseP).toFixed(2)) : null;
  }
  return rows;
}
