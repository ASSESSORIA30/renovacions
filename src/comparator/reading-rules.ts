/**
 * ENSENYAR A LA IA (part pura, testejable): xat de correccions, aprenentatge per exemple i impacte abans/després.
 *
 *  · `parseRuleChat`: interpreta frases com «El Plan OMIE és indexat i el preu que apareix és el marge»,
 *    «En Impulsa Negocios P1–P5 són promocionats», «Quan hi ha dos preus en 2.0TD, el primer correspon a P1 i P2 i el
 *    segon a P3», «El descompte de la columna O afecta energia i potència», «Aquest import és €/kW/any»,
 *    «Has confós el preu promocionat amb el no promocionat», «Aplica aquesta correcció a tots els productes equivalents».
 *    Retorna una REGLA proposada (mai s'aplica sola): l'usuari veu l'abans/després i decideix l'abast.
 *  · `inferFromExample`: l'usuari introdueix els P1–P6 correctes d'una tarifa; es busca quina regla reutilitzable ho
 *    explica (quina columna va a cada període i si porta el descompte). Si no n'hi ha cap, es guarden els valors
 *    manuals només per a aquell producte.
 *  · `withScope`: adapta una regla a l'abast triat (document, producte, plantilla, general).
 *  · `readDiff`: diferències d'interpretació entre dues lectures (per mostrar l'abans/després).
 */
import Decimal from "decimal.js-light";
import { z } from "zod";
import { TARGET_LABEL } from "./tariff-discounts";
import { LETTERS, SCOPE_LABEL, type Letter, type ReadingRule, type RuleScope, type RuleSet } from "./tariff-table";
import { norm, type Product, type ReadResult } from "./xlsx-template";

let seq = 0;
export const newRuleId = (prefix: string) => `${prefix}:${Date.now().toString(36)}-${(++seq).toString(36)}`;
/** Etiqueta curta d'una columna de preu: «Prom.», «No Prom.», «Punta»… (o la lletra). */
export function shortHeader(h: string | undefined, l: string): string {
  const parts = (h ?? "").split(" · ");
  return parts.find((x) => /prom/i.test(x)) ?? parts.find((x) => /punta|llano|valle/i.test(x)) ?? `preu ${l}`;
}
const pl = (letters: Letter[] | null | undefined, p: Product) => (letters ?? []).map((l, i) => `P${i + 1}=${shortHeader(p.interp?.source.find((s) => s.letter === l)?.header, l)}`).join(", ");

/** Lletres del preu promocionat i del no promocionat segons les capçaleres de la fila (p. ex. «No Prom.» / «Prom.»). */
export function promLetters(p: Product): { prom: Letter | null; noProm: Letter | null } {
  let prom: Letter | null = null, noProm: Letter | null = null;
  for (const s of p.interp?.source ?? []) {
    const h = norm(s.header);
    if (/no prom/.test(h)) noProm = noProm ?? s.letter; else if (/prom/.test(h)) prom = prom ?? s.letter;
  }
  if (!prom && !noProm && (p.interp?.source.length ?? 0) === 2) { noProm = "A"; prom = "B"; }
  return { prom, noProm };
}

export interface ChatContext { product: Product | null; products: Product[]; last: ReadingRule | null; author?: string | null }
export interface ChatProposal { rule: ReadingRule | null; reply: string; understood: boolean; widened?: boolean }

const ORD: Record<string, Letter> = { primer: "A", primero: "A", segon: "B", segundo: "B", tercer: "C", tercero: "C" };
function mappingFromText(n: string, p: Product | null, periods: number): Letter[] | null {
  const out: (Letter | null)[] = Array(periods).fill(null);
  const pr = p ? promLetters(p) : { prom: "B" as Letter, noProm: "A" as Letter };
  let any = false;
  // «P1–P5 (són) promocionats», «P6 no promocionat», «P1 = primer preu»
  const re = /p([1-6])(?:\s*(?:-|–|a|fins a|hasta|al)\s*p([1-6]))?\s*(?:=|son|són|es|és|:|correspon(?:en)? a(?:l)?|corresponde(?:n)? al?)?\s*(?:el |la |els |les )?(no\s+)?(promocionat|promocionad|promocionado|prom\b|primer|primero|segon|segundo|tercer|tercero)/g;
  for (const m of n.matchAll(re)) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    const word = m[4];
    const letter = /prom/.test(word) ? (m[3] ? pr.noProm : pr.prom) : ORD[word];
    if (!letter) continue;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i <= periods; i++) { out[i - 1] = letter; any = true; }
  }
  // «el primer correspon a P1 i P2 i el segon a P3»
  for (const m of n.matchAll(/(primer|primero|segon|segundo|tercer|tercero)[^.;]*?((?:p[1-6](?:\s*(?:i|y|,|-|–)\s*)?)+)/g)) {
    const letter = ORD[m[1]];
    for (const q of m[2].matchAll(/p([1-6])/g)) { const i = Number(q[1]); if (i <= periods) { out[i - 1] = letter; any = true; } }
  }
  if (!any) return null;
  // la resta de períodes: l'altre preu (només quan hi ha promocionat / no promocionat)
  const used = new Set(out.filter(Boolean));
  if (out.some((x) => x == null) && used.size === 1 && pr.prom && pr.noProm) {
    const other = used.has(pr.prom) ? pr.noProm : pr.prom;
    for (let i = 0; i < periods; i++) if (!out[i]) out[i] = other;
  }
  return out.every(Boolean) ? (out as Letter[]) : null;
}

function base(title: string, set: RuleSet, match: ReadingRule["match"], scope: RuleScope, explanation: string, author: string | null | undefined, columns: string[] = []): ReadingRule {
  return { id: newRuleId("xat"), title, scope, match, set, explanation, source: "xat", approved: false, createdBy: author ?? null, columns };
}
const productMatch = (p: Product): ReadingRule["match"] => ({ product: p.name, tariffs: p.tariff ? [p.tariff] : null, priceCount: p.interp?.priceCount ?? null });

/** Interpreta un missatge del xat i proposa una regla (no l'aplica). */
export function parseRuleChat(msg: string, ctx: ChatContext): ChatProposal {
  const n = norm(msg).replace(/[«»"“”]/g, "");
  const p = ctx.product;
  const sel = p ? `«${p.name}» (fila ${p.row})` : null;
  const cols = p ? [...(p.interp?.source.map((s) => s.col) ?? [])] : [];
  // ampliar l'abast de l'última correcció
  if (/(aplica|aplicar|aplicala|aplica-la).*(tots|todos|totes|todas).*(equivalent|igual|mateix|similar)/.test(n) || /productes equivalents|productos equivalentes/.test(n)) {
    if (!ctx.last) return { rule: null, understood: false, reply: "Encara no hi ha cap correcció per ampliar. Primer explica'm la correcció d'una tarifa." };
    const r = withScope(ctx.last, "plantilla", ctx.products.find((x) => norm(x.name) === norm(String(Array.isArray(ctx.last!.match.product) ? ctx.last!.match.product[0] : ctx.last!.match.product ?? ""))) ?? p);
    const affected = ctx.products.filter((x) => matchesProduct(r, x)).length;
    return { rule: r, understood: true, widened: true, reply: `Proposo aplicar «${ctx.last.title}» a tots els productes equivalents (${r.match.tariffs?.join(", ") ?? "tots els peatges"}${r.match.priceCount ? `, ${r.match.priceCount} preus` : ""}): ${affected} tarifes afectades. Revisa l'abans/després i tria on la guardes.` };
  }
  // indexada / OMIE / marge
  if (/omie/.test(n) && /index/.test(n)) {
    return { rule: base("Plan OMIE: INDEXADA, el valor és el marge", { classification: "indexada", valueIsMargin: true }, { product: "plan omie" }, "plantilla", msg, ctx.author, ["I"]), understood: true, reply: "Entès: tots els Plan OMIE són INDEXATS i el valor de la columna d'energia és el marge (€/kWh → €/MWh), no un preu final." };
  }
  if (/(es|son|és|són) (una )?(tarifa )?(indexat|indexada|indexado)/.test(n) || /\bindexad[ao]\b.*\bmarge|\bmarge\b.*\bindexad/.test(n)) {
    if (!p) return needProduct();
    return { rule: base(`${p.name}: INDEXADA${/marge|margen/.test(n) ? " (valor = marge)" : ""}`, { classification: "indexada", valueIsMargin: /marge|margen/.test(n) || undefined }, productMatch(p), "producte", msg, ctx.author, cols), understood: true, reply: `Entès: ${sel} és INDEXADA${/marge|margen/.test(n) ? " i el valor és el marge" : ""}.` };
  }
  if (/(es|és|son|són) (una )?(tarifa )?(fix|fixa|fija|fijo)\b/.test(n)) {
    if (!p) return needProduct();
    return { rule: base(`${p.name}: FIXA`, { classification: "fixa", valueIsMargin: false }, productMatch(p), "producte", msg, ctx.author, cols), understood: true, reply: `Entès: ${sel} és una tarifa FIXA.` };
  }
  // intercanvi promocionat / no promocionat
  if (/confos|confus|confundid|al reves|intercanvi|intercambi/.test(n) && /prom/.test(n)) {
    if (!p) return needProduct();
    const cur = p.interp?.mapping;
    const { prom, noProm } = promLetters(p);
    if (!cur || !prom || !noProm) return { rule: null, understood: false, reply: `${sel} no té una correspondència de preus promocionats que es pugui intercanviar.` };
    const swapped = cur.map((l) => (l === prom ? noProm : l === noProm ? prom : l));
    return { rule: base(`${p.name}: promocionat ↔ no promocionat`, { mapping: swapped }, productMatch(p), "producte", msg, ctx.author, cols), understood: true, reply: `Proposo intercanviar-los: ${pl(swapped, p)}.` };
  }
  // correspondència de preus a períodes
  const generic2td = /2\.?0 ?td/.test(n) && /(dos|2) preus|(dos|2) precios/.test(n);
  if (/p[1-6]/.test(n) && (/prom|primer|segon|tercer|primero|segundo|tercero/.test(n))) {
    const periods = generic2td ? 3 : p?.interp?.periods ?? 6;
    const target = generic2td ? null : p;
    const m = mappingFromText(n, target, periods);
    if (!m) return { rule: null, understood: false, reply: "No he pogut deduir a quin preu correspon cada període. Escriu-ho com «P1–P5 promocionat i P6 no promocionat» o «el primer preu correspon a P1 i P2 i el segon a P3»." };
    if (generic2td) return { rule: base("2.0TD · dos preus: P1 = P2 = primer, P3 = segon", { mapping: m }, { tariffs: ["2.0TD"], priceCount: 2 }, "plantilla", msg, ctx.author), understood: true, reply: `Entès: en 2.0TD amb dos preus, ${m.map((l, i) => `P${i + 1} = ${l === "A" ? "primer" : l === "B" ? "segon" : "tercer"}`).join(", ")}.` };
    // producte esmentat al text (p. ex. «En Impulsa Negocios…») o el seleccionat
    const named = ctx.products.find((x) => n.includes(norm(x.name).replace(/^[0-9.]+td(_\d)?\s+/, "")) && norm(x.name).replace(/^[0-9.]+td(_\d)?\s+/, "").length > 6) ?? p;
    if (!named) return needProduct();
    return { rule: base(`${named.name}: ${pl(m, named)}`, { mapping: m }, productMatch(named), "producte", msg, ctx.author, named.interp?.source.map((s) => s.col)), understood: true, reply: `Proposo per a «${named.name}»: ${pl(m, named)}.` };
  }
  // descomptes
  if (/descompte|descuento|columna o|\bdto\b/.test(n) && /(energia|potencia)/.test(n)) {
    const both = /(energia|te)\s*(i|y|and)\s*(potencia|tp)|potencia\s*(i|y)\s*energia/.test(n);
    const onlyE = /nomes|solo|unicament|exclusivament/.test(n) && /energia/.test(n) && !both;
    const on = both ? ["energia", "potencia"] as const : onlyE ? ["energia"] as const : null;
    if (!on) return { rule: null, understood: false, reply: "Digues si el descompte afecta «energia i potència» o «només energia»." };
    if (!p) return needProduct();
    return { rule: base(`${p.name}: descompte sobre ${on.map((t) => TARGET_LABEL[t]).join(" i ")}`, { discountOn: [...on] }, productMatch(p), "producte", msg, ctx.author, ["O"]), understood: true, reply: `Entès: el descompte de la columna O de ${sel} s'aplica sobre ${on.map((t) => TARGET_LABEL[t]).join(" i ")}.` };
  }
  if (/(sense|sin) (descompte|descuento|dto)/.test(n) && /(preu|precio|import)/.test(n)) {
    if (!p) return needProduct();
    return { rule: base(`${p.name}: preu original sense descompte`, { ignoreDiscount: false }, productMatch(p), "producte", msg, ctx.author, ["O"]), understood: true, reply: `Entès: el preu de l'Excel de ${sel} és sense descompte; s'hi aplica el descompte base de la columna O.` };
  }
  if (/(ja|ya) (inclou|incluye|porta|lleva)|preu final|precio final/.test(n)) {
    if (!p) return needProduct();
    return { rule: base(`${p.name}: el preu ja és final`, { ignoreDiscount: true }, productMatch(p), "producte", msg, ctx.author, ["O"]), understood: true, reply: `Entès: el preu de ${sel} ja inclou el descompte; no se n'hi aplica cap.` };
  }
  // confirmar un descompte dubtós («el descompte del 2n any és correcte», «confirmo el descompte»)
  if (/(descompte|descuento|dto)/.test(n) && /(correcte|correcto|confirm|esta be|esta bien|es bo|es bueno)/.test(n)) {
    if (!p) return needProduct();
    return { rule: base(`${p.name}: descompte confirmat`, { discountConfirmed: `«${p.discountLabel ?? ""}» confirmat des del xat` }, { ...productMatch(p), discount: p.discountLabel ?? null }, "producte", msg, ctx.author, ["O"]), understood: true, reply: `Entès: la interpretació del descompte «${p.discountLabel}» és correcta. (Amb «aplica-ho a tots els equivalents» es confirma a totes les tarifes amb el mateix text.)` };
  }
  // gas: unitat del terme fix
  if (/(terme fix|termino fijo|terme fixe)/.test(n) && /(mes|any|ano|dia)/.test(n)) {
    const unit = /\bmes\b/.test(n) ? "eur_mes" : /\bdia\b/.test(n) ? "eur_dia" : "eur_any";
    return { rule: base(`Gas: terme fix en ${unit === "eur_mes" ? "€/mes" : unit === "eur_dia" ? "€/dia" : "€/any"}`, { gasFixedUnit: unit, review: "" }, { energyType: "gas" }, "plantilla", msg, ctx.author, ["C"]), understood: true, reply: `Entès: el terme fix del gas (columna C) és en ${unit === "eur_mes" ? "€/mes" : unit === "eur_dia" ? "€/dia" : "€/any"}.` };
  }
  // unitats
  if (/kw\s*\/?\s*(any|ano|year)|kw any|kw ano/.test(n)) {
    return { rule: base("Potència en €/kW any", { powerUnit: "eur_kw_any" }, p ? productMatch(p) : { energyType: "luz" }, p ? "producte" : "plantilla", msg, ctx.author, ["C", "D", "E", "F", "G", "H"]), understood: true, reply: "Entès: els imports de potència són €/kW any (no €/kWh)." };
  }
  if (/kw\s*\/?\s*dia|kw dia/.test(n)) return { rule: base("Potència en €/kW dia", { powerUnit: "eur_kw_dia" }, p ? productMatch(p) : { energyType: "luz" }, p ? "producte" : "plantilla", msg, ctx.author), understood: true, reply: "Entès: els imports de potència són €/kW dia." };
  if (/(no|ni) (l'?|la |lo )?import|exclou|excluye|no es tarifa|no és tarifa/.test(n)) {
    if (!p) return needProduct();
    return { rule: base(`${p.name}: no s'importa`, { exclude: true }, productMatch(p), "producte", msg, ctx.author), understood: true, reply: `Entès: ${sel} no s'importarà.` };
  }
  if (/pendent|pendiente|no ho se|no lo se/.test(n)) {
    if (!p) return needProduct();
    return { rule: base(`${p.name}: pendent de revisió`, { pending: "Marcada com a pendent des del xat." }, productMatch(p), "producte", msg, ctx.author), understood: true, reply: `D'acord: ${sel} queda PENDENT.` };
  }
  if (/malament|mal interpret|incorrect|erroni/.test(n)) {
    return { rule: null, understood: false, reply: `${sel ? `Què hi ha de malament a ${sel}? ` : "Selecciona la tarifa i "}explica-m'ho amb una frase com «P1–P5 promocionat i P6 no promocionat», «és indexada i el valor és el marge», «el descompte afecta energia i potència» o «aquest preu ja és final». També pots fer servir «Ensenyar amb un exemple» i escriure els P1–P6 correctes.` };
  }
  return { rule: null, understood: false, reply: "No ho he entès prou bé per proposar una regla. Prova amb: «P1–P5 promocionat i P6 no promocionat», «el Plan OMIE és indexat i el valor és el marge», «el descompte de la columna O afecta energia i potència», «aquest import és €/kW/any», «aplica-ho a tots els productes equivalents», o ensenya-m'ho amb un exemple." };
}
const needProduct = (): ChatProposal => ({ rule: null, understood: false, reply: "Selecciona primer la tarifa a la taula central (clica la fila) i torna-m'ho a dir." });

/** La regla s'aplicaria a aquest producte? (mateixos criteris que el motor). */
export function matchesProduct(r: ReadingRule, p: Product): boolean {
  const m = r.match;
  if (m.tariffs?.length && !(p.tariff && m.tariffs.includes(p.tariff))) return false;
  if (m.priceCount != null && m.priceCount !== p.interp?.priceCount) return false;
  if (m.energyType && m.energyType !== p.energyType) return false;
  if (m.row != null && m.row !== p.row) return false;
  if (m.discount != null && norm(m.discount) !== norm(p.discountLabel)) return false;
  if (m.product) { const n = norm(p.name); const list = Array.isArray(m.product) ? m.product : [m.product]; if (!list.some((x) => n.includes(norm(x)))) return false; }
  return true;
}

/** Adapta una regla a l'abast triat. «plantilla» i «general» = productes equivalents (mateix peatge i nombre de preus). */
export function withScope(r: ReadingRule, scope: RuleScope, p: Product | null): ReadingRule {
  const out: ReadingRule = { ...r, id: r.scope === scope ? r.id : newRuleId(r.source), scope, match: { ...r.match } };
  if (scope === "document" && p) out.match = { ...out.match, row: p.row, product: p.name };
  if (scope === "producte" && p) out.match = { product: p.name, tariffs: p.tariff ? [p.tariff] : null, priceCount: p.interp?.priceCount ?? null };
  if ((scope === "plantilla" || scope === "general") && r.set.discountConfirmed) out.match = { discount: r.match.discount ?? p?.discountLabel ?? null };
  else if ((scope === "plantilla" || scope === "general") && p && !r.set.classification && !r.set.valueIsMargin && r.match.product && !Array.isArray(r.match.product) && norm(r.match.product) === norm(p.name)) {
    out.match = { tariffs: p.tariff ? [p.tariff] : null, priceCount: p.interp?.priceCount ?? null };
  }
  out.title = r.title.replace(/ · (només aquest document|aquest producte|productes equivalents|regla general)$/, "") + ` · ${scope === "document" ? "només aquest document" : scope === "producte" ? "aquest producte" : scope === "plantilla" ? "productes equivalents" : "regla general"}`;
  return out;
}

/* ======================================================================= aprendre d'un exemple */

export interface ExampleInput { expected: (number | null)[]; explanation: string; discountApplied: boolean | null; author?: string | null }
export interface ExampleResult { rule: ReadingRule; explained: boolean; detail: string[]; general: ReadingRule | null }
const close = (a: number, b: number) => Math.abs(a - b) <= 5e-7;
const disc = (v: number, pct: number) => Number(new Decimal(v).times(new Decimal(100).minus(pct)).dividedBy(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());

/** Compara la lectura amb l'exemple validat i busca la regla reutilitzable que l'explica. */
export function inferFromExample(p: Product, ex: ExampleInput): ExampleResult {
  const it = p.interp!;
  const periods = it.periods;
  const exp = ex.expected.slice(0, periods);
  const detail: string[] = [];
  const pct = it.energyPct || (it.discount.base.find((b) => b.kind === "pct" && b.on.includes("energia"))?.value ?? 0);
  const tryMode = (withDisc: boolean): Letter[] | null => {
    const out: Letter[] = [];
    for (let i = 0; i < periods; i++) {
      const e = exp[i];
      if (e == null) return null;
      const hit = it.source.find((s) => close(withDisc ? disc(s.v, pct) : s.v, e));
      if (!hit) return null;
      out.push(hit.letter);
    }
    return out;
  };
  const order: boolean[] = ex.discountApplied === false ? [false] : ex.discountApplied === true ? [true] : [true, false];
  let mapping: Letter[] | null = null, withDisc = true;
  for (const m of order) { mapping = tryMode(m); if (mapping) { withDisc = m; break; } }
  const exampleMeta = { product: p.name, row: p.row, expected: ex.expected.slice(0, 6), explanation: ex.explanation || null };
  if (mapping) {
    const set: RuleSet = { mapping, ...(withDisc ? {} : { ignoreDiscount: true }) };
    const before = it.energyFinal.slice(0, periods);
    detail.push(`La lectura actual donava ${before.map((v) => v ?? "—").join(" · ")}; l'exemple diu ${exp.join(" · ")}.`);
    detail.push(`Regla que ho explica: ${pl(mapping, p)}${withDisc ? ` amb el descompte base (${pct} % s/energia)` : " sense descompte"}.`);
    const rule: ReadingRule = { id: newRuleId("exemple"), title: `${p.name}: ${pl(mapping, p)}${withDisc ? "" : " (sense descompte)"}`, scope: "producte", match: productMatch(p), set, explanation: ex.explanation || "Deduïda d'un exemple validat.", source: "exemple", approved: false, createdBy: ex.author ?? null, columns: it.source.map((s) => s.col), example: exampleMeta };
    const general = withScope({ ...rule, source: "exemple" }, "plantilla", p);
    general.title = `${p.tariff ?? ""} · ${it.priceCount} preus: ${mapping.map((l, i) => `P${i + 1}=${l}`).join(" ")}${withDisc ? "" : " (sense descompte)"} · productes equivalents`;
    return { rule, explained: true, detail, general };
  }
  detail.push("Cap combinació de columnes i descompte explica tots els valors de l'exemple. Es guarden com a valors manuals validats només per a aquest producte (no es generalitzen).");
  const rule: ReadingRule = { id: newRuleId("exemple"), title: `${p.name}: valors manuals validats`, scope: "producte", match: productMatch(p), set: { manual: { energy: Array.from({ length: 6 }, (_, i) => (i < periods ? ex.expected[i] ?? null : null)), note: ex.explanation || "valors introduïts a mà" } }, explanation: ex.explanation || "Valors manuals validats.", source: "exemple", approved: false, createdBy: ex.author ?? null, columns: it.source.map((s) => s.col), example: exampleMeta };
  return { rule, explained: false, detail, general: null };
}

/* ======================================================================= abans / després */

export interface InterpChange { key: string; row: number; name: string; fields: { field: string; before: string; after: string }[] }
const fmtArr = (a: (number | null)[] | undefined, n: number) => (a ?? []).slice(0, n).map((v) => (v == null ? "—" : String(v))).join(" · ");
export function readDiff(a: ReadResult, b: ReadResult): InterpChange[] {
  const before = new Map(a.products.map((p) => [p.key, p]));
  const out: InterpChange[] = [];
  for (const p of b.products) {
    const q = before.get(p.key);
    if (!q?.interp || !p.interp) continue;
    const x = q.interp, y = p.interp;
    const n = Math.max(x.periods, y.periods);
    const f: InterpChange["fields"] = [];
    if (x.status !== y.status) f.push({ field: "estat", before: x.status, after: y.status });
    if (x.classification !== y.classification) f.push({ field: "tipus", before: x.classification, after: y.classification });
    if (fmtArr(x.energyFinal, n) !== fmtArr(y.energyFinal, n)) f.push({ field: "energia final", before: fmtArr(x.energyFinal, n), after: fmtArr(y.energyFinal, n) });
    if (fmtArr(x.powerFinal, 6) !== fmtArr(y.powerFinal, 6)) f.push({ field: "potència final", before: fmtArr(x.powerFinal, 6), after: fmtArr(y.powerFinal, 6) });
    if ((x.margin?.eurMWh ?? null) !== (y.margin?.eurMWh ?? null)) f.push({ field: "marge €/MWh", before: String(x.margin?.eurMWh ?? "—"), after: String(y.margin?.eurMWh ?? "—") });
    if (f.length) out.push({ key: p.key, row: p.row, name: p.name, fields: f });
  }
  return out;
}

export const describeScope = (s: RuleScope) => SCOPE_LABEL[s];
export const lettersFor = (n: number) => LETTERS.slice(0, n);

/** Fragments de files per a la IA (mai el document sencer): cada bloc cap dins del límit de caràcters. */
export function chunkForAi(products: Product[], maxChars = 12000): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [], size = 0;
  for (const p of products) {
    const line = JSON.stringify({ fila: p.row, producte: p.name, peatge: p.tariff, preus: p.interp?.source.map((s) => ({ col: s.col, capcalera: s.header, valor: s.v })), descompte: p.discountLabel, estat: p.interp?.status, motius: p.interp?.reasons.slice(0, 3) });
    if (size + line.length > maxChars && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(line); size += line.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Valida la resposta de la IA: només es queden les propostes amb un format conegut (la resta es descarta). */
export function parseAiRuleProposals(text: string): { row: number; title: string; set: Record<string, unknown>; explanation: string }[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let j: unknown;
  try { j = JSON.parse(m[0]); } catch { return []; }
  const item = z.object({ fila: z.number().int(), title: z.string().max(300), explanation: z.string().max(2000).default(""), set: z.object({ mapping: z.array(z.enum(["A", "B", "C", "D", "E", "F"])).min(1).max(6).optional(), classification: z.enum(["fixa", "indexada", "mixta"]).optional(), valueIsMargin: z.boolean().optional(), discountOn: z.array(z.enum(["energia", "potencia"])).max(2).optional(), pending: z.string().max(500).optional() }).strict() });
  const p = z.object({ rules: z.array(z.unknown()).max(100) }).safeParse(j);
  if (!p.success) return [];
  return p.data.rules.map((x) => item.safeParse(x)).filter((x) => x.success).map((x) => { const d = (x as { data: z.infer<typeof item> }).data; return { row: d.fila, title: d.title, set: d.set, explanation: d.explanation }; });
}

/* ======================================================================= Excel amb la interpretació correcta */

export interface ReferenceRow { name: string; expected: (number | null)[]; product: Product | null; actual: (number | null)[]; ok: boolean; sourceRow: number }
/**
 * Compara la lectura amb un Excel de referència (interpretació correcta preparada per l'assessoria): cerca una columna
 * de producte i les columnes P1…P6 i, per a cada fila, la tarifa amb el mateix nom. Serveix per validar i per ensenyar.
 */
export function compareWithReference(read: ReadResult, ref: { sheets: { name: string; rows: number; cols: number; cells: ({ v: unknown; t: string } | null)[][] }[] }): { rows: ReferenceRow[]; error: string | null } {
  for (const g of ref.sheets) {
    for (let r = 0; r < Math.min(g.rows, 30); r++) {
      const head = (g.cells[r] ?? []).map((c) => norm(c?.v));
      const nameC = head.findIndex((h) => /^(producte|producto|productos|tarifa|nom|nombre)$/.test(h));
      const pC = [1, 2, 3, 4, 5, 6].map((k) => head.findIndex((h) => h === `p${k}` || h === `p${k} energia` || h === `energia p${k}`));
      if (nameC < 0 || pC[0] < 0) continue;
      const rows: ReferenceRow[] = [];
      for (let i = r + 1; i < g.rows; i++) {
        const name = String(g.cells[i]?.[nameC]?.v ?? "").trim();
        if (!name) continue;
        const expected = pC.map((c) => { if (c < 0) return null; const v = g.cells[i]?.[c]?.v; const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")); return v == null || v === "" || !Number.isFinite(n) ? null : n; });
        const product = read.products.find((p) => norm(p.name) === norm(name)) ?? null;
        const per = product?.interp?.periods ?? expected.filter((x) => x != null).length;
        const actual = product?.interp ? product.interp.energyFinal.slice(0, per) : [];
        const ok = !!product && expected.slice(0, per).every((e, k) => e == null || (actual[k] != null && Math.abs((actual[k] as number) - e) <= 5e-7));
        rows.push({ name, expected: expected.slice(0, per), product, actual, ok, sourceRow: i + 1 });
      }
      return { rows, error: null };
    }
  }
  return { rows: [], error: "No s'ha trobat cap taula amb una columna «Producte» i columnes P1…P6." };
}
