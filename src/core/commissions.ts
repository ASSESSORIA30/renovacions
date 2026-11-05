/**
 * CRM FASE 4 · MOTOR DE COMISSIONS (pur, sense dependències de servidor).
 *
 * - Aritmètica decimal (decimal.js-light): mai coma flotant en imports. Arrodoniment final a cèntims, mig cap amunt
 *   (ROUND_HALF_UP), una sola vegada per import calculat. Les bases intermèdies es mantenen amb tota la precisió.
 * - Dues capes separades: «proveidor» (el que la comercialitzadora paga a Assessoria 3.0) i «comercial»/«collaborador»
 *   (el que Assessoria 3.0 paga). Una regla només s'aplica a la seva capa.
 * - Una regla percentual sense base validada no calcula: «Pendent de configuració». Si falten dades: «Pendent de dades».
 * - Només les regles APROVADES donen càlculs definitius; amb una regla pendent el resultat és una SIMULACIÓ.
 */
import Decimal from "decimal.js-light";
import type { Service } from "./sales";

type Dv = Decimal | string | number;

export const D = (v: Dv | null | undefined) => new Decimal(v == null || v === "" ? 0 : v);
/** Import a cèntims (mig cap amunt), com a text per no perdre precisió en JSON. */
export const money = (v: Dv) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const num = (v: string | number | null | undefined) => (v == null || v === "" ? null : Number(v));
export const eurFmt = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : Number(v).toLocaleString("ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export const LAYERS = ["proveidor", "comercial", "collaborador", "incentiu"] as const;
export type Layer = (typeof LAYERS)[number];
export const LAYER_LABEL: Record<Layer, string> = { proveidor: "Proveïdor → Assessoria 3.0", comercial: "Assessoria 3.0 → comercial", collaborador: "Assessoria 3.0 → col·laborador", incentiu: "Incentius per trams" };
export const KINDS = ["fix_contracte", "per_mwh", "energia_potencia", "pct_marge", "pct_increment_preu", "pct_comissio_rebuda", "pct_energia", "pct_potencia", "trams_volum", "bonificacio", "regularitzacio", "retrocessio"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  fix_contracte: "Import fix per contracte", per_mwh: "Import per MWh", energia_potencia: "€/MWh del nivell + marge de potència (€/kW·any × kW)", pct_marge: "% sobre marge / valor afegit", pct_increment_preu: "% sobre increment de preu",
  pct_comissio_rebuda: "% sobre la comissió rebuda", pct_energia: "% sobre el terme d'energia", pct_potencia: "% sobre el terme de potència", trams_volum: "Trams de volum", bonificacio: "Bonificació", regularitzacio: "Regularització", retrocessio: "Retrocessió",
};
export const UNIT_OF: Record<Kind, "eur" | "eur_mwh" | "pct"> = {
  fix_contracte: "eur", per_mwh: "eur_mwh", energia_potencia: "eur_mwh", pct_marge: "pct", pct_increment_preu: "pct", pct_comissio_rebuda: "pct", pct_energia: "pct", pct_potencia: "pct", trams_volum: "eur", bonificacio: "eur", regularitzacio: "eur", retrocessio: "pct",
};
export const PCT_KINDS: Kind[] = ["pct_marge", "pct_increment_preu", "pct_comissio_rebuda", "pct_energia", "pct_potencia"];
export const SEGMENTS = ["residencial", "pime", "gran_consum"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_LABEL: Record<Segment, string> = { residencial: "Residencial", pime: "Pime", gran_consum: "Gran consumidor" };
export const RULE_STATUS_LABEL = { esborrany: "Esborrany", pendent_aprovacio: "Pendent d'aprovació", aprovada: "Aprovada", retirada: "Retirada" } as const;
export const CALC_STATUS_LABEL = { calculat: "Calculat", simulacio: "Simulació (regla no aprovada)", pendent_configuracio: "Pendent de configuració", pendent_dades: "Pendent de dades", sense_regla: "Sense regla aplicable" } as const;
export type CalcStatus = keyof typeof CALC_STATUS_LABEL;
export const LEDGER_KIND_LABEL = {
  meritacio: "Meritació", confirmacio: "Confirmat pel proveïdor", facturacio: "Facturat", cobrament: "Cobrament", bonificacio: "Bonificació", ajustament: "Ajustament",
  regularitzacio: "Regularització", retrocessio: "Retrocessió", anullacio: "Anul·lació",
} as const;
export type LedgerKind = keyof typeof LEDGER_KIND_LABEL;
export const SETTLEMENT_STATUS_LABEL = { esborrany: "Esborrany", revisio: "En revisió", aprovada: "Aprovada", pagada: "Pagada", anullada: "Anul·lada" } as const;
export type SettlementStatus = keyof typeof SETTLEMENT_STATUS_LABEL;
export const MATCH_LABEL = { pendent: "Pendent", identificat: "Identificat", conciliat: "Conciliat", diferencia: "Amb diferència", duplicat: "Duplicat", no_identificat: "No identificat", descartat: "Descartat" } as const;
export type MatchStatus = keyof typeof MATCH_LABEL;

export interface Tier { threshold: number; amount: number }
export interface RuleRow {
  id: string; rule_key: string; version: number; name: string; layer: Layer; retailer: string | null; product: string | null; service: Service | null; segment: Segment | null;
  beneficiary_id: string | null; kind: Kind; value: string | number | null; unit: string; tiers: Tier[] | null; conditions: Record<string, unknown>;
  base_formula: string | null; base_validated: boolean; valid_from: string; valid_to: string | null; status: keyof typeof RULE_STATUS_LABEL; notes: string | null;
}

/** Fets del contracte que fa servir el motor. Cada valor indica d'on surt (traçabilitat). */
export interface Facts {
  retailer: string; product: string | null; service: Service | null; segment: Segment | null; refDate: string;
  annualKwh: number | string | null; annualKwhSource: string;
  eligibleMwh: number | string | null;                 // volum elegible pactat (si no, consum anual)
  energyIncrementEurKwh: number | string | null; powerIncrementEurKwDay: number | string | null; powerKw: (number | null)[] | null;
  months: number;
  providerAmount: string | null; providerAmountSource: "confirmat" | "estimat" | null;
  /** Fase 8.1 (opcionals): renovació o alta nova, peatge d'accés i imports facturats d'energia/potència del període. */
  isRenewal?: boolean | null; tariff?: string | null; energyAmountEur?: number | string | null; powerAmountEur?: number | string | null;
  /** Matriu comercial (Nufri): marge de potència triat al contracte (€/kW·any, p. ex. BOE+2 → 2). */
  powerMarginEurKwYear?: number | string | null;
}
export interface BreakdownLine { label: string; value: string; source?: string; /** component conciliable per separat */ component?: "energia" | "potencia" }
export interface CalcResult { status: CalcStatus; amount: string | null; formula: string; breakdown: BreakdownLine[]; missing?: string[]; components?: { energy: string; power: string } }

/* ------------------------------------------------------------------ selecció de la regla aplicable */

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const wordIn = (hay: string, needle: string) => {
  let i = hay.indexOf(needle);
  const w = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  while (i >= 0) { if (!w(hay[i - 1]) && !w(hay[i + needle.length])) return true; i = hay.indexOf(needle, i + 1); }
  return false;
};
export function ruleApplies(r: RuleRow, f: Pick<Facts, "retailer" | "product" | "service" | "segment" | "refDate" | "isRenewal" | "tariff">, layer: Layer, beneficiaryId: string | null) {
  if (r.layer !== layer) return false;
  if (r.retailer && norm(r.retailer) !== norm(f.retailer)) return false;
  // producte com a paraula sencera: «GALA» no ha de coincidir amb «GALAXY»
  if (r.product && !wordIn(norm(f.product), norm(r.product))) return false;
  if (r.service && r.service !== f.service) return false;
  if (r.segment && r.segment !== f.segment) return false;
  if (r.beneficiary_id && r.beneficiary_id !== beneficiaryId) return false;
  if (r.valid_from > f.refDate || (r.valid_to && r.valid_to < f.refDate)) return false;
  // Fase 8.1: condicions extretes dels contractes de comercialitzadores (només restringeixen si el fet és conegut)
  const c = (r.conditions ?? {}) as { applies_to?: string; tariff?: string };
  if (c.applies_to === "renovacio" && f.isRenewal === false) return false;
  if (c.applies_to === "alta_nova" && f.isRenewal === true) return false;
  if (c.tariff && f.tariff && norm(c.tariff).replace(/\s/g, "") !== norm(f.tariff).replace(/\s/g, "")) return false;
  return r.status === "aprovada" || r.status === "pendent_aprovacio";
}
const specificity = (r: RuleRow) => (r.beneficiary_id ? 16 : 0) + (r.product ? 8 : 0) + (r.retailer ? 4 : 0) + (r.segment ? 2 : 0) + (r.service ? 1 : 0);

/**
 * Regla aplicable: la més específica; a igualtat, la versió més recent. Les aprovades tenen prioritat sobre les pendents.
 * Si dues regles diferents tenen la mateixa especificitat, es retorna el conflicte (no es tria a l'atzar).
 */
export function pickRule(rules: RuleRow[], f: Facts, layer: Layer, beneficiaryId: string | null): { rule: RuleRow | null; simulation: boolean; conflict: RuleRow[] } {
  const ok = rules.filter((r) => ruleApplies(r, f, layer, beneficiaryId) && !["trams_volum", "retrocessio", "regularitzacio"].includes(r.kind));
  const pick = (list: RuleRow[]) => {
    if (!list.length) return null;
    const best = Math.max(...list.map(specificity));
    const top = list.filter((r) => specificity(r) === best);
    const byKey = new Map<string, RuleRow>();
    for (const r of top) { const cur = byKey.get(r.rule_key); if (!cur || r.version > cur.version) byKey.set(r.rule_key, r); }
    return [...byKey.values()];
  };
  const approved = pick(ok.filter((r) => r.status === "aprovada"));
  if (approved?.length) return { rule: approved.length === 1 ? approved[0] : null, simulation: false, conflict: approved.length > 1 ? approved : [] };
  const pending = pick(ok.filter((r) => r.status === "pendent_aprovacio"));
  if (pending?.length) return { rule: pending.length === 1 ? pending[0] : null, simulation: true, conflict: pending.length > 1 ? pending : [] };
  return { rule: null, simulation: false, conflict: [] };
}

/* ------------------------------------------------------------------ càlcul */

const fmt = (d: Decimal, dp = 6) => d.toDecimalPlaces(dp).toString();
export function eligibleMwh(f: Facts): { mwh: Decimal | null; source: string } {
  if (f.eligibleMwh != null && f.eligibleMwh !== "") return { mwh: D(f.eligibleMwh), source: "Volum elegible pactat (fitxa econòmica)" };
  if (f.annualKwh != null && f.annualKwh !== "") return { mwh: D(f.annualKwh).div(1000).times(f.months).div(12), source: `${f.annualKwhSource}${f.months !== 12 ? ` · prorratejat a ${f.months} mesos` : ""}` };
  return { mwh: null, source: "—" };
}

export function computeCommission(rule: RuleRow, f: Facts, simulation = false): CalcResult {
  const v = D(rule.value);
  const br: BreakdownLine[] = [{ label: "Regla", value: `${rule.name} (v${rule.version}${simulation ? ", pendent d'aprovació" : ""})` }];
  const ok = (amount: Decimal, formula: string): CalcResult => ({ status: simulation ? "simulacio" : "calculat", amount: money(amount), formula, breakdown: [...br, { label: "Import", value: money(amount) + " €" }] });
  const missing = (m: string[]): CalcResult => ({ status: "pendent_dades", amount: null, formula: "Falten dades per calcular", breakdown: br, missing: m });
  if (PCT_KINDS.includes(rule.kind) && (!rule.base_validated || !rule.base_formula?.trim())) {
    return { status: "pendent_configuracio", amount: null, formula: "Pendent de configuració: la base de càlcul del percentatge no està validada.", breakdown: br };
  }
  switch (rule.kind) {
    case "fix_contracte":
    case "bonificacio":
    case "regularitzacio":
      br.push({ label: "Import per contracte", value: `${money(v)} €`, source: "Regla" });
      return ok(v, `${money(v)} € per contracte`);
    case "per_mwh": {
      const { mwh, source } = eligibleMwh(f);
      if (!mwh) return missing(["MWh elegibles o consum anual"]);
      br.push({ label: "MWh elegibles", value: fmt(mwh, 3), source }, { label: "Import per MWh", value: `${fmt(v)} €/MWh`, source: "Regla" });
      return ok(mwh.times(v), `${fmt(mwh, 3)} MWh × ${fmt(v)} €/MWh`);
    }
    case "energia_potencia": {
      // Nivell d'energia (€/MWh de la regla) + marge de potència: suma dels kW de TOTS els períodes del peatge × €/kW·any
      const { mwh, source } = eligibleMwh(f);
      const need: string[] = [];
      if (!mwh) need.push("MWh elegibles o consum anual");
      const margin = f.powerMarginEurKwYear;
      if (margin == null || margin === "") need.push("Marge de potència triat (BOE)");
      const n = /^2\.0/.test((f.tariff ?? "").replace(/\s/g, "")) ? 2 : 6;
      const kw = (f.powerKw ?? []).slice(0, n).reduce((a, x) => a.plus(x ?? 0), D(0));
      if (margin != null && margin !== "" && D(margin).gt(0) && kw.isZero()) need.push("Potències contractades");
      if (need.length) return missing(need);
      const e = mwh!.times(v);
      const p = kw.times(D(margin)).times(f.months).div(12);
      const ce = money(e), cp = money(p);
      br.push(
        { label: "MWh elegibles", value: fmt(mwh!, 3), source }, { label: "Nivell d'energia", value: `${fmt(v)} €/MWh`, source: "Regla" },
        { label: "Comissió d'energia", value: `${ce} €`, component: "energia" },
        { label: "kW contractats (suma de períodes)", value: fmt(kw, 3), source: "Subministrament" }, { label: "Marge de potència", value: `${fmt(D(margin))} €/kW·any`, source: "Contracte" },
        { label: "Comissió de potència", value: `${cp} €`, component: "potencia" },
      );
      const total = D(ce).plus(cp);
      const m12 = f.months !== 12 ? ` × ${f.months}/12` : "";
      return { ...ok(total, `${fmt(mwh!, 3)} MWh × ${fmt(v)} €/MWh + ${fmt(kw, 3)} kW × ${fmt(D(margin))} €/kW·any${m12}`), components: { energy: ce, power: cp } };
    }
    case "pct_marge":
    case "pct_increment_preu": {
      const c = rule.conditions as { include_energy?: boolean; include_power?: boolean };
      const withEnergy = c.include_energy !== false;
      const withPower = rule.kind === "pct_marge" && c.include_power === true;
      const need: string[] = [];
      const { mwh, source } = eligibleMwh(f);
      if (withEnergy && (f.energyIncrementEurKwh == null || f.energyIncrementEurKwh === "")) need.push("Increment pactat d'energia (€/kWh)");
      if (withEnergy && !mwh) need.push("kWh elegibles");
      if (withPower && (f.powerIncrementEurKwDay == null || f.powerIncrementEurKwDay === "")) need.push("Increment pactat de potència (€/kW·dia)");
      if (withPower && !f.powerKw?.some((x) => x != null && x > 0)) need.push("Potències contractades");
      if (need.length) return missing(need);
      let base = D(0);
      const parts: string[] = [];
      if (withEnergy) {
        const kwh = mwh!.times(1000);
        const e = D(f.energyIncrementEurKwh).times(kwh);
        br.push({ label: "kWh elegibles", value: fmt(kwh, 0), source }, { label: "Increment d'energia", value: `${fmt(D(f.energyIncrementEurKwh))} €/kWh`, source: "Fitxa econòmica" }, { label: "Valor afegit energia", value: `${money(e)} €` });
        base = base.plus(e); parts.push(`${fmt(D(f.energyIncrementEurKwh))} €/kWh × ${fmt(kwh, 0)} kWh`);
      }
      if (withPower) {
        const kw = (f.powerKw ?? []).reduce((a, x) => a.plus(x ?? 0), D(0));
        const days = D(365).times(f.months).div(12);
        const p = D(f.powerIncrementEurKwDay).times(kw).times(days);
        br.push({ label: "kW contractats (suma de períodes)", value: fmt(kw, 3), source: "Subministrament" }, { label: "Dies del període", value: fmt(days, 2) }, { label: "Increment de potència", value: `${fmt(D(f.powerIncrementEurKwDay))} €/kW·dia`, source: "Fitxa econòmica" }, { label: "Valor afegit potència", value: `${money(p)} €` });
        base = base.plus(p); parts.push(`${fmt(D(f.powerIncrementEurKwDay))} €/kW·dia × ${fmt(kw, 3)} kW × ${fmt(days, 2)} dies`);
      }
      br.push({ label: "Base (valor afegit)", value: `${money(base)} €`, source: rule.base_formula ?? undefined }, { label: "Percentatge", value: `${fmt(v, 4)} %`, source: "Regla" });
      return ok(base.times(v).div(100), `${fmt(v, 4)} % × (${parts.join(" + ")})`);
    }
    case "pct_comissio_rebuda": {
      if (!f.providerAmount) return missing(["Comissió del proveïdor (confirmada o estimada)"]);
      br.push({ label: "Comissió del proveïdor", value: `${f.providerAmount} €`, source: f.providerAmountSource === "confirmat" ? "Confirmada pel proveïdor" : "Estimada (capa proveïdor)" }, { label: "Percentatge", value: `${fmt(v, 4)} %`, source: "Regla" });
      return ok(D(f.providerAmount).times(v).div(100), `${fmt(v, 4)} % × ${f.providerAmount} €`);
    }
    case "pct_energia":
    case "pct_potencia": {
      const amt = rule.kind === "pct_energia" ? f.energyAmountEur : f.powerAmountEur;
      const label = rule.kind === "pct_energia" ? "Import facturat del terme d'energia" : "Import facturat del terme de potència";
      if (amt == null || amt === "") return missing([label]);
      br.push({ label, value: `${money(D(amt))} €`, source: rule.base_formula ?? undefined }, { label: "Percentatge", value: `${fmt(v, 4)} %`, source: "Regla" });
      return ok(D(amt).times(v).div(100), `${fmt(v, 4)} % × ${money(D(amt))} €`);
    }
    default:
      return { status: "sense_regla", amount: null, formula: "Aquest tipus de regla no s'aplica per contracte", breakdown: br };
  }
}

/* ------------------------------------------------------------------ trams i incentius */

/** Política per defecte: només el tram més alt assolit («maxim»). «acumulat» suma tots els trams assolits. */
export function tierAmount(tiers: Tier[], value: number | string, policy: "maxim" | "acumulat" = "maxim"): { amount: string; reached: Tier | null; next: Tier | null } {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const v = D(value);
  const reachedAll = sorted.filter((t) => v.gte(t.threshold));
  const reached = reachedAll[reachedAll.length - 1] ?? null;
  const next = sorted.find((t) => v.lt(t.threshold)) ?? null;
  const amount = policy === "acumulat" ? reachedAll.reduce((a, t) => a.plus(t.amount), D(0)) : D(reached?.amount ?? 0);
  return { amount: money(amount), reached, next };
}
/** Diferència a registrar respecte del que ja s'ha comptabilitzat (idempotent: si coincideix, no cal cap moviment). */
export const incentiveDelta = (target: string, booked: string) => money(D(target).minus(booked));

/** Retrocessió per anul·lació: només dins la finestra de la regla i sobre l'import ja liquidat. */
export function retrocession(rule: RuleRow | null, settledAmount: string, activatedAt: string | null, cancelledAt: string): { amount: string | null; reason: string } {
  if (!rule) return { amount: null, reason: "No hi ha cap regla de retrocessió aprovada: no es descompta res automàticament (cal revisar-ho)." };
  if (D(settledAmount).lte(0)) return { amount: null, reason: "No hi ha cap import liquidat a retrocedir." };
  const months = Number((rule.conditions as { months?: number }).months ?? 12);
  if (activatedAt) {
    const limit = new Date(`${activatedAt}T12:00:00Z`); limit.setUTCMonth(limit.getUTCMonth() + months);
    if (new Date(`${cancelledAt}T12:00:00Z`) > limit) return { amount: null, reason: `Anul·lació fora del termini de retrocessió (${months} mesos).` };
  }
  return { amount: money(D(settledAmount).times(D(rule.value)).div(100).neg()), reason: `${D(rule.value).toString()} % de ${settledAmount} € (anul·lat dins de ${months} mesos)` };
}

/* ------------------------------------------------------------------ segment */

export function deriveSegment(service: string | null, customerKind: string | null, annualKwh: number | null): Segment | null {
  if (!service) return null;
  if (customerKind === "particular" && (service === "llum_residencial" || service === "gas")) return "residencial";
  if (service === "llum_residencial") return "residencial";
  if (annualKwh == null) return customerKind === "particular" ? "residencial" : "pime";
  return annualKwh >= 1_000_000 ? "gran_consum" : "pime";
}

/* ------------------------------------------------------------------ conciliació */

export interface ParsedLine { line_no: number; cups: string | null; contract_ref: string | null; external_ref: string | null; client_name: string | null; concept: string | null; amount: string; kind: "comissio" | "retrocessio" | "ajustament" | "regularitzacio" }
const HEAD = {
  cups: /^(cups|codi cups|c[oó]digo cups)$/i,
  amount: /^(import|importe|comisi[oó]n?|comissi[oó]|amount|total|import comissi[oó]|importe comisi[oó]n)$/i,
  external_ref: /^(refer[eè]ncia|referencia|ref\.?|n[uú]m(ero)?\.? (de )?(contrato|contracte|solicitud|sol·licitud)|contrato|contracte|id contrato)$/i,
  client_name: /^(client|cliente|titular|raz[oó]n social|nom|nombre)$/i,
  concept: /^(concepte|concepto|descripci[oó]|detalle|detall|tipus|tipo)$/i,
  contract_ref: /^(id crm|contracte crm|crm)$/i,
};
/** Converteix "1.234,56", "-12,5", "1,234.56" o 1234.56 a import amb 2 decimals. */
export function parseAmount(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? money(v) : null;
  let s = String(v ?? "").trim().replace(/[€\s]/g, "");
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-+]/g, "");
  if (/,\d{1,6}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return money(neg ? `-${s}` : s);
}
export function parseStatementRows(rows: Record<string, unknown>[]): { lines: ParsedLine[]; errors: string[]; columns: Partial<Record<keyof typeof HEAD, string>> } {
  const errors: string[] = [];
  if (!rows.length) return { lines: [], errors: ["El fitxer no té files"], columns: {} };
  const keys = Object.keys(rows[0]);
  const columns: Partial<Record<keyof typeof HEAD, string>> = {};
  for (const [field, re] of Object.entries(HEAD) as [keyof typeof HEAD, RegExp][]) {
    const k = keys.find((x) => re.test(x.trim()));
    if (k) columns[field] = k;
  }
  if (!columns.amount) return { lines: [], errors: ["No s'ha trobat la columna de l'import (Import, Importe, Comisión…)"], columns };
  if (!columns.cups && !columns.external_ref && !columns.contract_ref) errors.push("No hi ha cap columna d'identificació (CUPS o referència): les línies quedaran sense identificar.");
  const lines: ParsedLine[] = [];
  rows.forEach((r, i) => {
    const amount = parseAmount(r[columns.amount!]);
    if (amount == null) { if (Object.values(r).some((x) => String(x ?? "").trim())) errors.push(`Fila ${i + 2}: import no vàlid`); return; }
    if (amount === "0.00") return;
    const s = (k?: string) => (k ? String(r[k] ?? "").trim() || null : null);
    const concept = s(columns.concept);
    const cups = s(columns.cups)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? null;
    const kind = D(amount).lt(0) ? (/(regulari)/i.test(concept ?? "") ? "regularitzacio" : "retrocessio") : /(ajust)/i.test(concept ?? "") ? "ajustament" : "comissio";
    lines.push({ line_no: lines.length + 1, cups, contract_ref: s(columns.contract_ref), external_ref: s(columns.external_ref), client_name: s(columns.client_name), concept, amount, kind });
  });
  return { lines, errors, columns };
}
/** Empremta per detectar línies duplicades (el mateix import del mateix contracte i concepte en dues liquidacions). */
export const lineFingerprint = (retailer: string, l: Pick<ParsedLine, "cups" | "external_ref" | "contract_ref" | "amount" | "concept">, period: string | null) =>
  [norm(retailer), l.cups ?? "", norm(l.external_ref), norm(l.contract_ref), l.amount, norm(l.concept), period ?? ""].join("|");

export function reconcile(amount: string, expected: string | null, tolerance = "0.01"): { status: MatchStatus; difference: string | null } {
  if (expected == null) return { status: "identificat", difference: null };
  const diff = D(amount).minus(expected);
  return { status: diff.abs().lte(tolerance) ? "identificat" : "diferencia", difference: money(diff) };
}

/* ------------------------------------------------------------------ marge de contribució */

export interface MarginInput { providerCollected: string; providerEstimated: string | null; providerConfirmed: string; payouts: string; payoutsEstimated: string | null; costs: string; hasProviderRule: boolean; hasPayoutCalc: boolean }
/**
 * Marge de contribució = ingressos confirmats (cobrats) − comissions i incentius atribuïbles − costos directes registrats.
 * No és el benefici net (no inclou despeses generals ni nòmines). Si falta informació, el marge és «estimat» o «incomplet».
 */
export function contributionMargin(m: MarginInput): { status: "real" | "estimat" | "incomplet"; value: string | null; estimated: string | null; note: string } {
  const real = money(D(m.providerCollected).minus(m.payouts).minus(m.costs));
  const est = m.providerEstimated != null ? money(D(m.providerEstimated).minus(m.payoutsEstimated ?? m.payouts).minus(m.costs)) : null;
  if (D(m.providerCollected).gt(0)) return { status: "real", value: real, estimated: est, note: "Ingressos cobrats − comissions atribuïbles − costos directes registrats" };
  if (!m.hasProviderRule || m.providerEstimated == null) return { status: "incomplet", value: null, estimated: null, note: "Falta la comissió del proveïdor (regla o liquidació): no es pot calcular el marge." };
  return { status: "estimat", value: null, estimated: est, note: "Encara no s'ha cobrat res: marge estimat a partir de les comissions previstes." };
}

/* ------------------------------------------------------------------ alertes (pures) */

export interface FinAlertInput {
  now: Date;
  rules: { key: string; enabled: boolean; params: Record<string, unknown> }[];
  staffIds: string[];
  stale: { contract_id: string; client_name: string | null; retailer: string; since: string }[];                 // estimat sense confirmar
  differences: { line_id: string; retailer: string; amount: string; expected: string; difference: string }[];
  cancelledPaid: { contract_id: string; client_name: string | null; beneficiary_id: string; amount: string }[];
  duplicates: { key: string; label: string }[];
  pendingApproval: { id: string; code: string; since: string }[];
  collabBalance: { id: string; code: string; beneficiary_id: string; balance: string; since: string }[];
  achieved: { key: string; user_id: string; label: string }[];
  retrocessions: { line_id: string; contract_id: string; beneficiary_id: string | null; amount: string; client_name: string | null }[];
}
export interface FinAlert { rule_key: string; user_id: string; kind: "economia"; title: string; body: string | null; link: { view: string; params: Record<string, string> } }
const days = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 86_400_000;
export function planFinanceAlerts(a: FinAlertInput): FinAlert[] {
  const out: FinAlert[] = [];
  const on = (k: string) => a.rules.find((r) => r.key === k && r.enabled);
  const p = (k: string, n: string, d: number) => { const v = on(k)?.params?.[n]; return typeof v === "number" && v >= 0 ? v : d; };
  const staff = (rk: string, title: string, body: string | null, link: FinAlert["link"]) => a.staffIds.forEach((u) => out.push({ rule_key: rk, user_id: u, kind: "economia", title, body, link }));
  if (on("fin_sense_liquidar")) for (const s of a.stale) if (days(s.since, a.now) >= p("fin_sense_liquidar", "days", 90))
    staff(`fin_stale:${s.contract_id}`, `Comissió prevista sense liquidar: ${s.client_name ?? "—"}`, `${s.retailer} encara no ha confirmat la comissió.`, { view: "economia", params: { contract: s.contract_id } });
  if (on("fin_diferencia")) for (const d of a.differences) if (D(d.difference).abs().gte(p("fin_diferencia", "min_eur", 5)))
    staff(`fin_diff:${d.line_id}`, `Diferència amb ${d.retailer}: ${d.difference} €`, `Comunicat ${d.amount} € · estimat ${d.expected} €`, { view: "conciliacio", params: {} });
  if (on("fin_anullat_pagat")) for (const c of a.cancelledPaid)
    staff(`fin_cancel_paid:${c.contract_id}:${c.beneficiary_id}`, `Contracte anul·lat amb comissió ja liquidada: ${c.client_name ?? "—"}`, `${c.amount} € liquidats. Revisa la retrocessió.`, { view: "economia", params: { contract: c.contract_id } });
  if (on("fin_pagament_duplicat")) for (const d of a.duplicates) staff(`fin_dup:${d.key}`, "Possible duplicat", d.label, { view: "conciliacio", params: {} });
  if (on("fin_liquidacio_pendent")) for (const s of a.pendingApproval) if (days(s.since, a.now) >= p("fin_liquidacio_pendent", "days", 3))
    staff(`fin_pending:${s.id}`, `Liquidació ${s.code} pendent d'aprovació`, null, { view: "liquidacio", params: { id: s.id } });
  if (on("fin_collaborador_saldo")) for (const s of a.collabBalance) if (days(s.since, a.now) >= p("fin_collaborador_saldo", "days", 15))
    staff(`fin_collab_bal:${s.id}`, `Saldo pendent amb un col·laborador (${s.code})`, `${s.balance} € per pagar`, { view: "liquidacio", params: { id: s.id } });
  if (on("fin_objectiu_assolit")) for (const x of a.achieved) {
    out.push({ rule_key: `fin_goal:${x.key}`, user_id: x.user_id, kind: "economia", title: `Objectiu assolit: ${x.label}`, body: null, link: { view: "liquidacions", params: {} } });
    staff(`fin_goal:${x.key}`, `Objectiu assolit: ${x.label}`, null, { view: "economia", params: {} });
  }
  if (on("fin_possible_retrocessio")) for (const r of a.retrocessions) {
    staff(`fin_retro:${r.line_id}`, `Possible retrocessió: ${r.client_name ?? "—"}`, `La comercialitzadora comunica ${r.amount} €.`, { view: "economia", params: { contract: r.contract_id } });
    if (r.beneficiary_id) out.push({ rule_key: `fin_retro:${r.line_id}`, user_id: r.beneficiary_id, kind: "economia", title: `Possible retrocessió: ${r.client_name ?? "—"}`, body: "Administració ho revisarà abans de cap descompte.", link: { view: "liquidacions", params: {} } });
  }
  const seen = new Set<string>();
  return out.filter((x) => { const k = `${x.user_id}|${x.rule_key}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ------------------------------------------------------------------ períodes */

export type Granularity = "dia" | "setmana" | "mes" | "trimestre" | "any";
export function periodRange(g: Granularity, ref = new Date()): { from: string; to: string } {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (g === "dia") return { from: iso(d), to: iso(d) };
  if (g === "setmana") { const dow = (d.getUTCDay() + 6) % 7; const a = new Date(d); a.setUTCDate(d.getUTCDate() - dow); const b = new Date(a); b.setUTCDate(a.getUTCDate() + 6); return { from: iso(a), to: iso(b) }; }
  if (g === "mes") return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) };
  if (g === "trimestre") { const q = Math.floor(d.getUTCMonth() / 3) * 3; return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), q, 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), q + 3, 0))) }; }
  return { from: `${d.getUTCFullYear()}-01-01`, to: `${d.getUTCFullYear()}-12-31` };
}
export const monthOf = (iso: string) => iso.slice(0, 7);
export function lastMonths(n: number, ref = new Date()) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}
