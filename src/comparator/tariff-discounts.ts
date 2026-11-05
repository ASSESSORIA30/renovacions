/**
 * DESCOMPTES DELS DOCUMENTS DE TARIFES (part pura, servidor i navegador, testejable).
 *
 *  · `parseDiscount` interpreta el text d'una columna de descomptes (p. ex. la columna O de l'Excel d'Iberdrola):
 *      «15% s/Te»                    → 15 % només sobre energia
 *      «15% s/Te y Tp»               → 15 % sobre energia i potència
 *      «s/ dto»                      → sense descompte
 *      «dto 0,02€/Kwh si consumo >40MWh/a» → 0,02 €/kWh CONDICIONAT a més de 40 MWh/any
 *      «20% s/Te 1º año y 10% s/Te 2º año» → descompte per anys
 *      «(+5% PyS Tier 1 +2% PyS Tier 2)»   → descomptes CONDICIONATS a serveis (no s'apliquen sols)
 *  · Els preus originals es conserven; el preu final = original × (1 − %) amb precisió decimal (sis decimals).
 *  · Mai s'aplica un descompte condicionat automàticament ni un descompte sobre potència si només és d'energia.
 *  · Si no consta si dos descomptes s'acumulen (suma) o s'apliquen un darrere l'altre (successius), es mostren les
 *    dues opcions i la fórmula queda PENDENT DE VALIDACIÓ.
 *  · `simulateDiscounts` és el SIMULADOR: sense descompte, amb el descompte base, amb promocions condicionades,
 *    elegibilitat per consum, cost dels serveis, primer i segon any i estalvi net estimat.
 */
import Decimal from "decimal.js-light";

export type DiscountTarget = "energia" | "potencia" | "terme_fix" | "terme_variable";
export const TARGET_LABEL: Record<DiscountTarget, string> = { energia: "energia", potencia: "potència", terme_fix: "terme fix", terme_variable: "terme variable" };
export type DiscountCondition =
  | { type: "servei"; id: string; label: string }
  | { type: "consum"; id: string; label: string; minMWh: number }
  | { type: "calendari"; id: string; label: string }
  | { type: "altres"; id: string; label: string };
export interface DiscountPart {
  kind: "pct" | "eur_kwh" | "bonus";
  value: number;
  on: DiscountTarget[];
  /** Any de contracte al qual s'aplica (null = tots els anys). */
  year: number | null;
  condition: DiscountCondition | null;
  label: string;
}
export interface ParsedDiscount {
  raw: string;
  none: boolean;
  restriction: string | null;
  /** Descomptes sense condició (els que donen el «preu final»). */
  base: DiscountPart[];
  /** Descomptes condicionats: només s'apliquen al simulador si es marquen. */
  conditional: DiscountPart[];
  /** Dubtes que afecten el preu final (base): la tarifa queda «a revisar». */
  ambiguous: string[];
  /** Dubtes que només afecten els descomptes condicionats (simulador). */
  conditionalNotes: string[];
  unparsed: string | null;
}

const n = (s: string) => Number(s.replace(",", "."));
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const normd = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function targetsOf(t: string, fallback: DiscountTarget[]): DiscountTarget[] {
  const x = normd(t);
  if (/tf\s*\/\s*tv/.test(x)) return ["terme_fix", "terme_variable"];
  const e = /\bte\b|energia|t\.e\b/.test(x), p = /\btp\b|potencia/.test(x);
  if (e && p) return ["energia", "potencia"];
  if (p) return ["potencia"];
  if (e) return ["energia"];
  return fallback;
}
function conditionOf(t: string): DiscountCondition | null {
  const x = normd(t);
  const tier = x.match(/tier\s*([12])/);
  if (tier) return { type: "servei", id: `tier${tier[1]}`, label: `Productes i serveis Tier ${tier[1]}` };
  if (/uuee/.test(x)) return { type: "servei", id: "uuee", label: "Urgències Elèctriques Negocis (UUEE)" };
  if (/\bacp\b/.test(x)) return { type: "servei", id: "acp", label: "Assistent Comunitat de Propietaris (ACP)" };
  if (/est\.?\s*verdes/.test(x)) return { type: "servei", id: "estverdes", label: "Servei Estancias Verdes" };
  const c = x.match(/consumo\s*>\s*(\d+(?:[.,]\d+)?)\s*mwh/);
  if (c) return { type: "consum", id: `consum${n(c[1])}`, label: `Consum anual superior a ${n(c[1])} MWh`, minMWh: n(c[1]) };
  if (/julio|agosto|juliol|agost/.test(x)) return { type: "calendari", id: "estiu", label: "Només juliol i agost" };
  if (/vacacional|fines? de semana/.test(x)) return { type: "calendari", id: "vacances", label: "Dies de vacances i caps de setmana" };
  return null;
}

/** Interpreta el text de descomptes d'una tarifa. No inventa: el que no entén queda a `unparsed` / `ambiguous`. */
export function parseDiscount(raw: string | null | undefined, energyType: "luz" | "gas" = "luz"): ParsedDiscount {
  const text = clean(String(raw ?? ""));
  const out: ParsedDiscount = { raw: text, none: false, restriction: null, base: [], conditional: [], ambiguous: [], conditionalNotes: [], unparsed: null };
  if (!text) { out.none = true; return out; }
  const x = normd(text);
  const defTargets: DiscountTarget[] = energyType === "gas" ? ["terme_variable"] : ["energia"];
  if (/^s\s*\/\s*dto/.test(x)) {
    out.none = true;
    const r = text.match(/\(([^)]*)\)/);
    out.restriction = r ? clean(r[1]) : null;
    return out;
  }
  // parèntesis = condicionats; la resta = base, anys i altres
  const parens = [...text.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const outside = clean(text.replace(/\([^)]*\)/g, " | "));
  let rest = outside;
  const consumed: string[] = [];

  // 1) import fix per kWh condicionat a consum
  const eur = outside.match(/dto\s*(\d+(?:[.,]\d+)?)\s*€\s*\/\s*kwh\s*(si[^|]*)?/i);
  if (eur) {
    const cond = conditionOf(eur[2] ?? "") ?? (eur[2] ? { type: "altres" as const, id: "altres", label: clean(eur[2]) } : null);
    const part: DiscountPart = { kind: "eur_kwh", value: n(eur[1]), on: ["energia"], year: null, condition: cond, label: clean(eur[0]) };
    (cond ? out.conditional : out.base).push(part);
    consumed.push(eur[0]);
  }
  // 2) bo en euros (no és un descompte sobre el preu)
  const bonus = outside.match(/(\d+(?:[.,]\d+)?)\s*€\s+en\s+([^|]+)/i);
  if (bonus && !eur) {
    out.base.push({ kind: "bonus", value: n(bonus[1]), on: [], year: null, condition: null, label: clean(bonus[0]) });
    out.ambiguous.push(`«${clean(bonus[0])}» és un bo d'import fix: no modifica els preus i no s'aplica als P1–P6.`);
    consumed.push(bonus[0]);
  }
  // 3) llista d'escalons «10% / 15% / 20% … Te» → descompte per anys (pendent de confirmar)
  const steps = outside.match(/((?:\d+(?:[.,]\d+)?\s*%\s*\/\s*)+\d+(?:[.,]\d+)?\s*%)\s*([^|]*)/);
  if (steps) {
    const vals = [...steps[1].matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => n(m[1]));
    const on = targetsOf(steps[2], defTargets);
    vals.forEach((v, i) => out.base.push({ kind: "pct", value: v, on, year: i + 1, condition: null, label: `${v}% (any ${i + 1})` }));
    out.ambiguous.push(`«${clean(steps[0])}»: s'interpreta com un descompte creixent per anys (${vals.map((v, i) => `${i + 1}r any ${v} %`).join(", ")}). Cal confirmar-ho amb les condicions comercials.`);
    consumed.push(steps[0]);
  }
  // 4) percentatges amb any explícit, condició de calendari o base
  for (const seg of outside.split("|").map(clean).filter(Boolean)) {
    if (consumed.some((c) => c.includes(seg) || seg.includes(clean(c)))) { if (!/\d+\s*%/.test(seg.replace(consumed.join(" "), ""))) continue; }
    for (const m of seg.matchAll(/\+?\s*(\d+(?:[.,]\d+)?)\s*%\s*(s\/\s*)?([^%+]*?)(?=(?:\s+y\s+|\s*\+\s*)\d+(?:[.,]\d+)?\s*%|$)/gi)) {
      if (steps && steps[0].includes(m[0].trim())) continue;
      const body = m[3] ?? "";
      const value = n(m[1]);
      const on = targetsOf(body, defTargets);
      const yr = normd(body).match(/(\d)\s*(?:º|o|r|n)?\s*(?:ano|any)|(\d)\s*ano/);
      const year = yr ? Number(yr[1] ?? yr[2]) : null;
      const cond = conditionOf(body);
      const part: DiscountPart = { kind: "pct", value, on, year, condition: cond, label: clean(m[0].replace(/^\+/, "")) };
      if (cond) out.conditional.push(part); else out.base.push(part);
      if (year === 2 && !out.base.some((b) => b.year === 1) && out.base.some((b) => b.year == null && b !== part)) {
        out.ambiguous.push(`«${part.label}»: descompte del 2n any. S'interpreta que el 1r any s'aplica el descompte base i el 2n any aquest (no s'acumulen). Pendent de validar.`);
      }
      rest = rest.replace(m[0], " ");
    }
  }
  // 5) condicionats dins de parèntesis
  for (const p of parens) {
    for (const m of p.matchAll(/\+?\s*(\d+(?:[.,]\d+)?)\s*%\s*([^+]*)/g)) {
      const body = clean(m[2]);
      const cond = conditionOf(body) ?? { type: "altres" as const, id: `cond-${normd(body).replace(/[^a-z0-9]+/g, "-").slice(0, 20)}`, label: body || "Condició no especificada" };
      const explicit = /\bte\b|\btp\b|tf\s*\/\s*tv/i.test(body);
      const mainOn = out.base.find((b) => b.kind === "pct")?.on ?? defTargets;
      out.conditional.push({ kind: "pct", value: n(m[1]), on: explicit ? targetsOf(body, mainOn) : mainOn, year: null, condition: cond, label: clean(m[0].replace(/^\+/, "")) + (body.includes("*") ? " (veure nota *)" : "") });
      if (!explicit && out.base.some((b) => b.kind === "pct")) out.conditionalNotes.push(`«${clean(m[0].replace(/^\+/, ""))}»: s'aplica sobre els mateixos termes que el descompte base (${mainOn.map((t) => TARGET_LABEL[t]).join(" i ")}). Pendent de confirmar.`);
    }
  }
  const leftover = clean(rest.replace(/\|/g, " ").replace(eur?.[0] ?? "\u0000", " ").replace(bonus?.[0] ?? "\u0000", " ").replace(steps?.[0] ?? "\u0000", " ")).replace(/^[+\s]+|[+\s]+$/g, "");
  if (leftover && !/^(y|i|\+)$/i.test(leftover) && /[a-z]{3,}/i.test(leftover) && !out.base.length && !out.conditional.length) out.unparsed = leftover;
  if (!out.base.length && !out.conditional.length && !out.none) out.unparsed = out.unparsed ?? text;
  if (out.base.filter((b) => b.kind === "pct" && b.year == null).length > 1) out.ambiguous.push("Hi ha més d'un descompte base: no consta si s'acumulen o s'apliquen successivament (fórmula pendent de validació).");
  return out;
}

/** Percentatge base (sense condicions) que s'aplica a un terme en un any concret. */
export function basePct(d: ParsedDiscount, target: DiscountTarget, year = 1): number {
  const pcts = d.base.filter((b) => b.kind === "pct" && b.on.includes(target));
  const exact = pcts.filter((b) => b.year === year);
  if (exact.length) return exact.reduce((a, b) => a + b.value, 0);
  // any 2 o posteriors sense descompte específic: només els que valen per a tots els anys
  return pcts.filter((b) => b.year == null).reduce((a, b) => a + b.value, 0);
}
/** Té descompte específic per a l'any 2? (si no, el 2n any es repeteix el base). */
export const hasYear2 = (d: ParsedDiscount) => d.base.some((b) => b.year != null && b.year >= 2);

/** Preu amb descompte percentual (sis decimals, arrodoniment a la meitat). */
export function applyPct(v: number | null, pct: number): number | null {
  if (v == null) return null;
  if (!pct) return v;
  return Number(new Decimal(v).times(new Decimal(100).minus(pct)).dividedBy(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
}
const sub = (v: number | null, eur: number) => (v == null ? null : Number(new Decimal(v).minus(eur).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()));
/** Combina dos percentatges: «suma» (20 + 5 = 25 %) o «successiu» (1 − 0,8 × 0,95 = 24 %). */
export function combinePct(pcts: number[], mode: "suma" | "successiu"): number {
  if (mode === "suma") return pcts.reduce((a, b) => a + b, 0);
  const keep = pcts.reduce((a, p) => a.times(new Decimal(100).minus(p).dividedBy(100)), new Decimal(1));
  return Number(new Decimal(1).minus(keep).times(100).toDecimalPlaces(6).toString());
}

/** Opcions del simulador generades a partir del document (no se n'ofereix cap que no hi aparegui). */
export function simulatorOptions(d: ParsedDiscount): { id: string; label: string; type: DiscountCondition["type"]; part: DiscountPart }[] {
  const seen = new Set<string>();
  const out: { id: string; label: string; type: DiscountCondition["type"]; part: DiscountPart }[] = [];
  for (const p of d.conditional) {
    if (!p.condition || seen.has(p.condition.id)) continue;
    seen.add(p.condition.id);
    out.push({ id: p.condition.id, label: `${p.label} — ${p.condition.label}`, type: p.condition.type, part: p });
  }
  return out;
}

export interface SimInput {
  energy: (number | null)[]; // preus originals P1..P6 (€/kWh)
  power: (number | null)[]; // preus originals de potència P1..P6
  powerUnit: "eur_kw_any" | "eur_kw_dia" | "eur_kw_mes";
  discount: ParsedDiscount;
  energyType?: "luz" | "gas";
}
export interface SimOptions {
  year: 1 | 2;
  conditions: string[]; // ids de condicions marcades (serveis contractats, calendari…)
  annualMWh: number | null;
  consumptionKwh?: (number | null)[] | null; // per període
  powerKw?: (number | null)[] | null;
  serviceCostEurMonth?: number | null;
  combination: "suma" | "successiu";
}
export interface SimResult {
  noDiscount: { energy: (number | null)[]; power: (number | null)[] };
  base: { energy: (number | null)[]; power: (number | null)[] };
  final: { energy: (number | null)[]; power: (number | null)[] };
  applied: { label: string; on: DiscountTarget[]; value: string }[];
  notEligible: { label: string; reason: string }[];
  pendingFormula: string | null;
  cost: { noDiscount: number | null; base: number | null; final: number | null; services: number; netSaving: number | null } | null;
  notes: string[];
}
const yearFactor = (u: SimInput["powerUnit"]) => (u === "eur_kw_dia" ? 365 : u === "eur_kw_mes" ? 12 : 1);

/** SIMULADOR DE DESCOMPTES. Cap condició s'aplica si no s'ha marcat; l'elegibilitat per consum es comprova. */
export function simulateDiscounts(inp: SimInput, o: SimOptions): SimResult {
  const d = inp.discount;
  const notes: string[] = [];
  const applied: SimResult["applied"] = [];
  const notEligible: SimResult["notEligible"] = [];
  const eTarget: DiscountTarget = inp.energyType === "gas" ? "terme_variable" : "energia";
  const pTarget: DiscountTarget = inp.energyType === "gas" ? "terme_fix" : "potencia";
  const eBase = basePct(d, eTarget, o.year), pBase = basePct(d, pTarget, o.year);
  if (o.year === 2 && !hasYear2(d) && (eBase || pBase)) notes.push("El document no indica cap descompte específic per al 2n any: es repeteix el del 1r any.");
  if (eBase) applied.push({ label: `Descompte base${o.year === 2 && hasYear2(d) ? " (2n any)" : ""}`, on: [eTarget], value: `${eBase} %` });
  if (pBase) applied.push({ label: "Descompte base", on: [pTarget], value: `${pBase} %` });
  const ePcts = eBase ? [eBase] : [], pPcts = pBase ? [pBase] : [];
  let eurKwh = 0;
  for (const opt of simulatorOptions(d)) {
    const p = opt.part;
    const on = o.conditions.includes(opt.id);
    if (p.condition?.type === "consum") {
      const ok = o.annualMWh != null && o.annualMWh > p.condition.minMWh;
      if (!ok) { notEligible.push({ label: opt.label, reason: o.annualMWh == null ? "Cal indicar el consum anual" : `El consum (${o.annualMWh} MWh/any) no supera ${p.condition.minMWh} MWh` }); continue; }
    } else if (!on) continue;
    if (p.condition?.type === "calendari") { notes.push(`«${opt.label}» només s'aplica en uns dies concrets: no es pot traduir a un preu P1–P6 fix (es mostra a part).`); continue; }
    if (p.kind === "eur_kwh") { eurKwh += p.value; applied.push({ label: opt.label, on: p.on, value: `${p.value} €/kWh` }); continue; }
    if (p.on.includes(eTarget)) ePcts.push(p.value);
    if (p.on.includes(pTarget)) pPcts.push(p.value);
    applied.push({ label: opt.label, on: p.on, value: `${p.value} %` });
  }
  const multi = ePcts.length > 1 || pPcts.length > 1;
  const ePct = combinePct(ePcts, o.combination), pPct = combinePct(pPcts, o.combination);
  const pendingFormula = multi
    ? `Descomptes combinats: suma ${combinePct(ePcts, "suma")} % · successius ${combinePct(ePcts, "successiu")} % sobre energia. El document no diu quina s'aplica: fórmula PENDENT DE VALIDACIÓ (ara: ${o.combination === "suma" ? "suma" : "successius"}).`
    : null;
  const res: SimResult = {
    noDiscount: { energy: inp.energy, power: inp.power },
    base: { energy: inp.energy.map((v) => applyPct(v, eBase)), power: inp.power.map((v) => applyPct(v, pBase)) },
    final: { energy: inp.energy.map((v) => sub(applyPct(v, ePct), eurKwh)), power: inp.power.map((v) => applyPct(v, pPct)) },
    applied, notEligible, pendingFormula, cost: null, notes,
  };
  const kwh = o.consumptionKwh ?? null, kw = o.powerKw ?? null;
  if (kwh?.some((x) => x != null && x > 0)) {
    const f = yearFactor(inp.powerUnit);
    const cost = (e: (number | null)[], p: (number | null)[]) => {
      let t = new Decimal(0);
      e.forEach((v, i) => { if (v != null && kwh[i]) t = t.plus(new Decimal(v).times(kwh[i]!)); });
      p.forEach((v, i) => { if (v != null && kw?.[i]) t = t.plus(new Decimal(v).times(kw[i]!).times(f)); });
      return Number(t.toDecimalPlaces(2).toString());
    };
    const services = Number(new Decimal(o.serviceCostEurMonth ?? 0).times(12).toDecimalPlaces(2).toString());
    const c0 = cost(res.noDiscount.energy, res.noDiscount.power), c1 = cost(res.base.energy, res.base.power), c2 = cost(res.final.energy, res.final.power);
    res.cost = { noDiscount: c0, base: c1, final: c2, services, netSaving: Number(new Decimal(c0).minus(c2).minus(services).toDecimalPlaces(2).toString()) };
    notes.push("Cost anual estimat d'energia i potència sense impostos ni lloguer. L'estalvi net descompta el cost dels serveis que calen per al descompte.");
  }
  return res;
}
