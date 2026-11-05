/**
 * CONVERSIÓ D'UNITATS DE TARIFES (determinista, sense IA).
 *
 * Unitats internes del CRM (les que fa servir el comparador):
 *   - Potència:            €/kW·dia   (una conversió per a cada període P1–P6)
 *   - Energia:             €/kWh
 *   - Terme fix del gas:   €/client·dia  (camp `gasFixedEurDay`: un import per subministrament i dia; NO és per kW)
 *
 * Política de dies: 365 dies l'any, que és la base amb què el comparador prorrateja la potència i el terme fix
 * (motor: €/kW·any ÷ 365, €/kW·mes × 12 ÷ 365). No es fa servir 360 ni 366.
 * Quota mensual: es considera una quota contractual de 12 mensualitats → × 12 ÷ 365.
 *
 * Només es converteixen magnituds equivalents: €/kW·any → €/kW·dia sí; €/kW·any → €/client·dia NO (caldria la potència
 * de referència i la fórmula contractual). Si la unitat és incompatible o no es reconeix, el valor no es converteix i
 * es retorna el motiu perquè la tarifa quedi pendent de revisió. Mai no es posa un zero en lloc d'un valor desconegut.
 * Aritmètica decimal: no hi ha errors de coma flotant en la conversió.
 */
import Decimal from "decimal.js-light";
import type { PowerUnit, PriceSheet } from "./types";

export type Quantity = "potencia" | "energia" | "terme_fix_gas";
export interface ParsedUnit {
  raw: string;
  currency: "eur" | "cent";
  per: "kw" | "kwh" | "mwh" | "client" | null;     // magnitud a què es refereix el preu
  time: "dia" | "mes" | "any" | null;               // període del preu
}
export interface Converted { ok: boolean; value: number | null; original: number | null; from: string; to: string; factor: string; formula: string; reason?: string }

export const TARGET_UNIT: Record<Quantity, string> = { potencia: "€/kW·dia", energia: "€/kWh", terme_fix_gas: "€/client·dia" };
const DAYS = 365;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Interpreta una unitat tal com l'escriu el document («€/kW.día», «€/kW y año», «c€/kWh», «€/MWh», «€/día/cliente», «eur_kw_any»…). */
export function parseUnit(raw: string | null | undefined): ParsedUnit | null {
  if (!raw || !String(raw).trim()) return null;
  const s = fold(String(raw)).replace(/_/g, "/").replace(/\beur(o|os)?\b/g, "€");
  const cent = /(c€|cent|cts?\b|centim|centimo)/.test(s);
  if (!/€/.test(s) && !cent) return null;
  const per: ParsedUnit["per"] = /\bmwh\b/.test(s) ? "mwh" : /\bkwh\b/.test(s) ? "kwh" : /\bkw\b/.test(s) ? "kw" : /(client|suministro|subministrament|contrato|contracte|cups|punto)/.test(s) ? "client" : null;
  const time: ParsedUnit["time"] = /(\bdia\b|\bday\b|\/d\b|diari)/.test(s) ? "dia" : /(\bmes\b|mensual|month)/.test(s) ? "mes" : /(\bany\b|\bano\b|anual|year|\/a\b)/.test(s) ? "any" : null;
  return { raw: String(raw).trim(), currency: cent ? "cent" : "eur", per, time };
}

const timeFactor = (t: ParsedUnit["time"]): { f: Decimal; txt: string } | null =>
  t === "dia" ? { f: new Decimal(1), txt: "" } : t === "any" ? { f: new Decimal(1).div(DAYS), txt: ` ÷ ${DAYS}` } : t === "mes" ? { f: new Decimal(12).div(DAYS), txt: ` × 12 ÷ ${DAYS}` } : null;

/** Converteix un valor a la unitat interna del CRM, comprovant que les magnituds són equivalents. */
export function toInternal(value: number | null, unit: string | ParsedUnit | null | undefined, quantity: Quantity): Converted {
  const u = typeof unit === "string" || unit == null ? parseUnit(unit as string | null) : unit;
  const to = TARGET_UNIT[quantity];
  const from = u?.raw ?? String(unit ?? "");
  const fail = (reason: string): Converted => ({ ok: false, value: null, original: value, from, to, factor: "—", formula: "—", reason });
  if (value == null || !Number.isFinite(value)) return { ok: value == null, value: null, original: value, from, to, factor: "—", formula: "—", reason: value == null ? undefined : "Valor no numèric" };
  if (!u) return fail(`Unitat no reconeguda («${from || "buida"}»): no es converteix.`);
  let f = u.currency === "cent" ? new Decimal(1).div(100) : new Decimal(1);
  let txt = u.currency === "cent" ? " ÷ 100 (cèntims)" : "";
  if (quantity === "energia") {
    if (u.time) return fail(`«${from}» no és un preu d'energia (porta un període de temps).`);
    if (u.per === "mwh") { f = f.div(1000); txt += " ÷ 1.000 (MWh → kWh)"; }
    else if (u.per !== "kwh") return fail(`«${from}» no és un preu d'energia per kWh o MWh.`);
  } else if (quantity === "potencia") {
    if (u.per !== "kw") return fail(`«${from}» no és un terme de potència per kW.`);
    const t = timeFactor(u.time);
    if (!t) return fail(`«${from}»: no s'indica si és per dia, mes o any.`);
    f = f.times(t.f); txt += t.txt;
  } else {
    if (u.per === "kw") return fail(`«${from}» és per kW: no es pot convertir a €/client·dia sense la potència de referència i la fórmula contractual.`);
    if (u.per === "kwh" || u.per === "mwh") return fail(`«${from}» és un preu d'energia, no un terme fix.`);
    const t = timeFactor(u.time);
    if (!t) return fail(`«${from}»: no s'indica si el terme fix és per dia, mes o any.`);
    f = f.times(t.f); txt += t.txt;
  }
  const v = new Decimal(value).times(f);
  // Sense conversió (factor 1) es conserva el valor exacte del document; amb conversió, tota la precisió decimal
  return { ok: true, value: f.eq(1) ? value : Number(v.toString()), original: value, from, to, factor: f.toString(), formula: txt ? `${value} ${from}${txt} = ${v.toDecimalPlaces(10).toString()} ${to}` : `${value} ${to} (sense conversió)` };
}

/** Converteix una sèrie P1–P6 (cada període per separat). */
export function seriesToInternal(values: (number | null)[], unit: string | null | undefined, quantity: Quantity): { values: (number | null)[]; ok: boolean; reason?: string; formula?: string } {
  const out = values.map((v) => toInternal(v, unit ?? null, quantity));
  const bad = out.find((x) => !x.ok);
  return { values: out.map((x) => x.value), ok: !bad, reason: bad?.reason, formula: out.find((x) => x.original != null)?.formula };
}

/** Factors per mostrar un valor intern en una altra unitat al formulari (sense tornar-lo a convertir mai). */
export const ENERGY_INPUT_UNITS = { eur_kwh: { label: "€/kWh", unit: "€/kWh" }, eur_mwh: { label: "€/MWh", unit: "€/MWh" }, cent_kwh: { label: "c€/kWh", unit: "c€/kWh" } } as const;
export const GAS_FIXED_INPUT_UNITS = { dia: { label: "€/client·dia", unit: "€/cliente/día" }, mes: { label: "€/client·mes", unit: "€/cliente/mes" }, any: { label: "€/client·any", unit: "€/cliente/año" } } as const;
/** Valor intern → valor en la unitat triada (inversa exacta de toInternal). */
export function fromInternal(internal: number | null, unit: string, quantity: Quantity): number | null {
  if (internal == null) return null;
  const one = toInternal(1, unit, quantity);
  if (!one.ok || one.value == null) return null;
  return Number(new Decimal(internal).div(one.factor).toDecimalPlaces(8).toString());
}

/* ======================================================================= tarifa completa */

const POWER_UNIT_TEXT: Record<PowerUnit, string> = { eur_kw_dia: "€/kW·dia", eur_kw_mes: "€/kW·mes", eur_kw_any: "€/kW·any" };

/**
 * Normalitza les unitats d'una tarifa a les internes del CRM i en conserva les originals a `units`.
 *  - Potència en €/kW·mes o €/kW·any → €/kW·dia, període per període.
 *  - Energia en €/MWh o c€/kWh (si s'indica `energyUnit`) → €/kWh, també a la referència de les indexades.
 *  - Terme fix del gas amb unitat (`gasFixed`) → €/client·dia; si és per kW o desconeguda, queda buit amb el motiu.
 * És idempotent: una tarifa que ja és en unitats internes no es torna a convertir (mai dues conversions).
 */
export function normalizeOfferUnits<T extends PriceSheet>(o: T, input: { energyUnit?: string | null; gasFixed?: { value: number | null; unit: string | null } | null } = {}): { offer: T; conversions: string[]; problems: string[] } {
  const conversions: string[] = [], problems: string[] = [];
  const units: NonNullable<PriceSheet["units"]> = { ...(o.units ?? {}), formulas: [...(o.units?.formulas ?? [])] };
  let next: T = { ...o };
  if (o.powerUnit !== "eur_kw_dia" && o.power.some((x) => x != null)) {
    const r = seriesToInternal(o.power, POWER_UNIT_TEXT[o.powerUnit], "potencia");
    if (r.ok) {
      units.power = { values: [...o.power], unit: POWER_UNIT_TEXT[o.powerUnit] };
      next = { ...next, power: r.values, powerUnit: "eur_kw_dia" };
      if (r.formula) conversions.push(`Potència: ${r.formula} (cada període P1–P6)`);
    } else problems.push(`Potència: ${r.reason}`);
  }
  const eu = input.energyUnit?.trim();
  const eParsed = eu ? parseUnit(eu) : null;
  if (eu && !(eParsed && eParsed.per === "kwh" && eParsed.currency === "eur" && !eParsed.time)) {
    const all = [...o.energy, o.energy24h, ...(o.indexedReference?.energy ?? [])];
    const test = toInternal(1, eu, "energia");
    if (!test.ok) problems.push(`Energia: ${test.reason}`);
    else if (all.some((x) => x != null)) {
      units.energy = { values: o.energy24h != null ? [o.energy24h] : [...o.energy], unit: eu };
      const conv = (x: number | null) => toInternal(x, eu, "energia").value;
      next = { ...next, energy: o.energy.map(conv), energy24h: conv(o.energy24h), indexedReference: o.indexedReference ? { ...o.indexedReference, energy: o.indexedReference.energy.map(conv) } : o.indexedReference };
      conversions.push(`Energia: ${toInternal(all.find((x) => x != null)!, eu, "energia").formula}`);
    }
  }
  if (input.gasFixed && input.gasFixed.value != null) {
    const r = toInternal(input.gasFixed.value, input.gasFixed.unit, "terme_fix_gas");
    units.gasFixed = { value: input.gasFixed.value, unit: input.gasFixed.unit ?? "" };
    if (r.ok) { next = { ...next, gasFixedEurDay: r.value }; if (r.factor !== "1") conversions.push(`Terme fix: ${r.formula}`); }
    else { next = { ...next, gasFixedEurDay: null }; problems.push(`Terme fix del gas: ${r.reason}`); }
  }
  units.formulas = [...new Set([...units.formulas, ...conversions])].slice(0, 20);
  if (units.power || units.energy || units.gasFixed || units.formulas.length) next = { ...next, units };
  return { offer: next, conversions, problems };
}
