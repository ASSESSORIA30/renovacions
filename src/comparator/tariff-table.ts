/**
 * LECTOR UNIVERSAL DE TAULES DE TARIFES + MOTOR DE REGLES APRESES (part pura, servidor i navegador, testejable).
 *
 * Un sol lector per a totes les comercialitzadores. El que canvia per a cadascuna és la PLANTILLA (on és la taula,
 * quines columnes són potència, energia, descomptes…) i el CONEIXEMENT: regles validades per Direcció, corregides
 * des del xat o deduïdes d'exemples aprovats (`ReadingRule`). No s'entrena cap model: l'aprenentatge és memòria
 * persistent de regles (es desa a Supabase amb la versió de la plantilla).
 *
 *  1. El parser llegeix TOTES les files de la taula (sense IA, sense límit de context) i conserva la cel·la d'origen.
 *  2. Les regles interpreten cada fila: quants preus té, a quins períodes P1–P6 corresponen, si és fixa o indexada,
 *     si el valor és un marge, quin horari promocionat té i quins descomptes de la columna de condicions s'apliquen.
 *  3. Cada tarifa queda INTERPRETADA, A REVISAR, PENDENT o FALLIDA (no s'inventa cap distribució P1–P6).
 *  4. Les estimacions per ponderació horària s'identifiquen sempre com a estimacions.
 */
import Decimal from "decimal.js-light";
import { countHours, defaultReference, describeRule, weightedPrices, type OpenRule, type Window } from "./open-calendar";
import { applyPct, basePct, hasYear2, parseDiscount, type DiscountTarget, type ParsedDiscount } from "./tariff-discounts";
import { addr, colIdx, colName, norm, normTariff, type CellV, type Classification, type Compatibility, type Issue, type Product, type ReadResult, type ReadValue, type SheetGrid, type TemplateDef, type WorkbookGrid } from "./xlsx-template";
import { knowledgeFor } from "./reading-knowledge";

/* ======================================================================= definició de la plantilla de taula */

export interface TableDef {
  /** Nom exacte de la pestanya de preus (p. ex. «Energía», amb accent). */
  sheetName: string;
  /** Si la pestanya no hi és: error i selecció manual. Mai no es canvia de pestanya en silenci. */
  sheetRequired: boolean;
  headerRow: number; // 1-based
  periodRow: number;
  subHeaderRows: number[];
  firstDataRow: number;
  stopText: string | null;
  cols: { name: string; power: string[]; energy: string[]; discount: string | null; surplus: string | null; duration: string | null; powerDay: string[]; extra: { col: string; label: string }[] };
  units: { power: string | null; energy: string | null; powerDay: string | null };
  /** Capçaleres de cada columna (principal · secundàries), p. ex. I: «TERMINO DE ENERGIA · P1 · Punta · No Prom. · Tramo 1». */
  colHeaders: Record<string, string>;
  /** Empremta: textos de capçalera que han de coincidir perquè la plantilla sigui compatible. */
  expected: { cell: string; text: string }[];
  complementarySheets: string[];
  ignoredSheets: string[];
}

/* ======================================================================= regles de lectura (coneixement) */

export type Letter = "A" | "B" | "C" | "D" | "E" | "F";
export const LETTERS: Letter[] = ["A", "B", "C", "D", "E", "F"];
export interface PromotedSchedule {
  /** Columna (lletra relativa a la primera columna d'energia) del preu promocionat i del no promocionat. */
  promoted: Letter;
  notPromoted: Letter;
  windows: Window[];
  source: string;
}
export type RuleScope = "document" | "producte" | "plantilla" | "general";
export const SCOPE_LABEL: Record<RuleScope, string> = { document: "Només aquest document", producte: "Aquest producte", plantilla: "Aquesta plantilla (productes equivalents)", general: "Regla general de la comercialitzadora" };
export interface RuleSet {
  classification?: Classification;
  /** El valor de la columna d'energia és el MARGE d'una indexada (no un preu final). */
  valueIsMargin?: boolean;
  /** Preu de cada període P1..Pn: lletra de la columna d'energia (A = primera columna d'energia). */
  mapping?: Letter[];
  schedule?: PromotedSchedule;
  /** Calcular P1–P6 per ponderació horària de l'horari promocionat (estimació). */
  weighted?: boolean;
  discountOn?: DiscountTarget[];
  ignoreDiscount?: boolean;
  powerUnit?: "eur_kw_any" | "eur_kw_dia" | "eur_kw_mes";
  review?: string;
  pending?: string;
  manual?: { energy: (number | null)[]; note: string };
  exclude?: boolean;
  /** Descompte dubtós confirmat per una persona (la tarifa deixa d'estar «a revisar» per aquest motiu). */
  discountConfirmed?: string;
  /** Gas: unitat del terme fix confirmada. */
  gasFixedUnit?: "eur_dia" | "eur_mes" | "eur_any";
}
export interface ReadingRule {
  id: string;
  title: string;
  scope: RuleScope;
  match: { tariffs?: string[] | null; product?: string | string[] | null; priceCount?: number | null; energyType?: "luz" | "gas" | null; row?: number | null; discount?: string | null };
  set: RuleSet;
  explanation: string;
  source: "direccio" | "document" | "xat" | "exemple" | "ia" | "manual";
  approved: boolean;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdBy?: string | null;
  columns?: string[];
  example?: { product: string; row: number; expected: (number | null)[]; explanation?: string | null } | null;
}
const SCOPE_RANK: Record<RuleScope, number> = { general: 0, plantilla: 1, producte: 2, document: 3 };

/* ======================================================================= interpretació d'una fila */

export type InterpStatus = "interpretada" | "revisar" | "pendent" | "fallida";
export const INTERP_LABEL: Record<InterpStatus, string> = { interpretada: "Interpretada", revisar: "A revisar", pendent: "Pendent", fallida: "Fallida" };
export interface SourcePrice { letter: Letter; col: string; header: string; v: number; cell: string }
export interface Interpretation {
  status: InterpStatus;
  reasons: string[];
  classification: Classification;
  periods: number;
  priceCount: number;
  source: SourcePrice[];
  mapping: Letter[] | null;
  energyOriginal: (number | null)[];
  energyFinal: (number | null)[];
  energyFinalYear2: (number | null)[] | null;
  powerOriginal: (number | null)[];
  powerFinal: (number | null)[];
  powerUnit: "eur_kw_any" | "eur_kw_dia" | "eur_kw_mes" | null;
  powerDayOriginal: (number | null)[];
  powerDayFinal: (number | null)[];
  discount: ParsedDiscount;
  energyPct: number;
  powerPct: number;
  energyPctYear2: number | null;
  margin: { eurKwh: number; eurMWh: number; cell: string } | null;
  schedule: (PromotedSchedule & { text: string }) | null;
  estimate: { reference: { from: string; to: string }; periods: { period: number; open: number; noOpen: number; total: number; price: number }[] } | null;
  manual: boolean;
  discountConfirmed: string | null;
  gasFixedUnit: "eur_dia" | "eur_mes" | "eur_any" | null;
  rules: { id: string; title: string; source: ReadingRule["source"]; scope: RuleScope; approved: boolean }[];
  section: string | null;
  eligibility: { minKw: number | null; maxKw: number | null };
  extra: Record<string, string>;
  hidden: boolean;
}

/* ======================================================================= utilitats */

const cellAt = (g: SheetGrid, r: number, c: number): CellV | null => g.cells[r]?.[c] ?? null;
const textAt = (g: SheetGrid, r: number, c: number) => { const x = cellAt(g, r, c); return x && (x.t === "s" || x.t === "n") ? String(x.v).trim() : ""; };
const unitIn = (t: string) => { const m = t.match(/\(([^)]*€[^)]*)\)/); return m ? m[1].trim() : null; };
const r6 = (v: Decimal) => Number(v.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
export function powerUnitOf(u: string | null): "eur_kw_any" | "eur_kw_dia" | "eur_kw_mes" | null {
  const x = norm(u);
  return /dia/.test(x) ? "eur_kw_dia" : /mes/.test(x) ? "eur_kw_mes" : /ano|any|year/.test(x) ? "eur_kw_any" : null;
}
function periodRunsAt(g: SheetGrid, r: number): { start: number; n: number }[] {
  const out: { start: number; n: number }[] = [];
  let c = 0;
  while (c < g.cols) {
    if (norm(textAt(g, r, c)) === "p1") { let n = 1; while (norm(textAt(g, r, c + n)) === `p${n + 1}`) n++; if (n >= 2) out.push({ start: c, n }); c += n; } else c++;
  }
  return out;
}
const isPeriodsCount = (tariff: string | null, gas: boolean) => (gas ? 1 : tariff === "2.0TD" ? 3 : 6);

/* ======================================================================= proposta automàtica */

export interface TableProposal { def: TemplateDef | null; notes: string[]; error: string | null; sheets: string[]; detectedSheet: string | null }

/** Detecta la taula de tarifes. Si el coneixement de la comercialitzadora fixa una pestanya i no hi és: error (selecció manual). */
export function proposeTable(wb: WorkbookGrid, opts: { supplier: string; name: string; sheet?: string | null; knowledge?: string | null }): TableProposal {
  const kn = knowledgeFor(opts.knowledge ?? null);
  const sheets = wb.sheets.map((s) => s.name);
  const wanted = opts.sheet ?? kn?.sheetName ?? null;
  let g: SheetGrid | null = null;
  if (wanted) {
    g = wb.sheets.find((s) => s.name === wanted) ?? null;
    if (!g) return { def: null, notes: [], sheets, detectedSheet: null, error: `No existeix la pestanya «${wanted}» (pestanyes del document: ${sheets.join(", ")}). Tria manualment la pestanya correcta.` };
  } else {
    g = wb.sheets.map((s) => ({ s, score: tableScore(s) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)[0]?.s ?? null;
    if (!g) return { def: null, notes: [], sheets, detectedSheet: null, error: "No s'ha trobat cap taula de tarifes (capçaleres P1…P6 amb potència i energia). Tria la pestanya manualment." };
  }
  const t = detectTable(g);
  if (!t) return { def: null, notes: [], sheets, detectedSheet: g.name, error: `La pestanya «${g.name}» no té una taula de tarifes reconeixible (capçaleres P1…P6 de potència i energia).` };
  const notes: string[] = [];
  if (kn) notes.push(`Coneixement aplicat: ${kn.label} (${kn.rules.length} regles validades).`);
  const def: TemplateDef = {
    schema: 1, supplier: opts.supplier, name: opts.name, docType: "xlsx",
    sheet: { pattern: `^${g.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, example: g.name },
    validity: { sheetNamePattern: null, logSheet: null },
    options: { emptyIsNull: true, errorIsNull: true }, blocks: [], notes: [],
    layout: "taula", table: { ...t, sheetName: g.name, sheetRequired: !!kn || !!opts.sheet, complementarySheets: kn?.complementarySheets ?? [], ignoredSheets: kn?.ignoredSheets ?? [] },
    knowledge: kn?.id ?? null, rules: [],
  };
  return { def, notes, error: null, sheets, detectedSheet: g.name };
}
function tableScore(g: SheetGrid): number {
  let s = 0;
  for (let r = 0; r < Math.min(g.rows, 40); r++) { s += periodRunsAt(g, r).length * 3; for (let c = 0; c < g.cols; c++) if (/termino de (potencia|energia)|productos?/.test(norm(textAt(g, r, c)))) s += 2; }
  return s;
}
function detectTable(g: SheetGrid): Omit<TableDef, "sheetName" | "sheetRequired" | "complementarySheets" | "ignoredSheets"> | null {
  let periodRow = -1;
  for (let r = 0; r < Math.min(g.rows, 60); r++) if (periodRunsAt(g, r).length >= 2) { periodRow = r; break; }
  if (periodRow < 0) return null;
  let headerRow = -1, nameCol = -1;
  for (let r = periodRow - 1; r >= Math.max(0, periodRow - 6) && headerRow < 0; r--) for (let c = 0; c < g.cols; c++) if (/^productos?$|^producto|^tarifa$|^plan$/.test(norm(textAt(g, r, c)))) { headerRow = r; nameCol = c; break; }
  if (headerRow < 0) { headerRow = periodRow - 1; nameCol = 1; }
  // primera fila de dades: la primera amb text a la columna del nom després de les capçaleres
  let firstData = -1;
  for (let r = periodRow + 1; r < g.rows; r++) if (textAt(g, r, nameCol) && cellAt(g, r, nameCol)?.t === "s") { firstData = r; break; }
  if (firstData < 0) return null;
  const headerAbove = (c: number) => { const out: string[] = []; for (let r = headerRow; r < periodRow; r++) for (let k = c; k >= 0; k--) { const t = textAt(g, r, k); if (t) { out.push(t); break; } } return out.join(" "); };
  const runs = periodRunsAt(g, periodRow);
  let power: string[] = [], energy: string[] = [], powerDay: string[] = [];
  let pu: string | null = null, eu: string | null = null, pdu: string | null = null;
  for (const run of runs) {
    const h = headerAbove(run.start);
    const cols = Array.from({ length: run.n }, (_, k) => colName(run.start + k));
    if (/potencia/.test(norm(h)) && /dia/.test(norm(h)) && !powerDay.length) { powerDay = cols; pdu = unitIn(h); }
    else if (/potencia/.test(norm(h)) && !power.length) { power = cols; pu = unitIn(h); }
    else if (/energia/.test(norm(h)) && !energy.length) { energy = cols; eu = unitIn(h); }
  }
  if (!energy.length) return null;
  const subHeaderRows: number[] = [];
  for (let r = periodRow + 1; r < firstData; r++) {
    const vals = Array.from({ length: g.cols }, (_, c) => cellAt(g, r, c)).filter(Boolean) as CellV[];
    if (vals.length) subHeaderRows.push(r);
  }
  const used = new Set([nameCol, ...[...power, ...energy, ...powerDay].map(colIdx)]);
  let discount: string | null = null, surplus: string | null = null, duration: string | null = null;
  const extra: { col: string; label: string }[] = [];
  for (let c = 0; c < g.cols; c++) {
    if (used.has(c)) continue;
    const h = textAt(g, headerRow, c);
    if (!h) continue;
    const n = norm(h);
    if (/descuento|dto|descompte/.test(n) && !discount) discount = colName(c);
    else if (/excedent/.test(n) && !surplus) surplus = colName(c);
    else if (/duracion|durada/.test(n) && !duration) duration = colName(c);
    else if (/potencia/.test(n) && /dia/.test(n) && !powerDay.length) { powerDay = [colName(c), colName(c + 1)].filter((x) => textAt(g, periodRow, colIdx(x))); pdu = unitIn(h) ?? textAt(g, subHeaderRows[subHeaderRows.length - 1] ?? periodRow, c) ?? null; }
    else extra.push({ col: colName(c), label: h });
  }
  const tableCols = [nameCol, ...power.map(colIdx), ...energy.map(colIdx), ...powerDay.map(colIdx), ...[discount, surplus, duration].filter(Boolean).map((x) => colIdx(x!)), ...extra.map((x) => colIdx(x.col))];
  const colHeaders: Record<string, string> = {};
  const expected: TableDef["expected"] = [];
  for (const c of tableCols) {
    const parts: string[] = [];
    for (let r = headerRow; r < firstData; r++) {
      const x = cellAt(g, r, c);
      if (!x || x.t !== "s") continue; // la fila d'índexs numèrics (1, 2, 3…) no és capçalera
      parts.push(String(x.v).trim());
      expected.push({ cell: `${colName(c)}${r + 1}`, text: norm(x.v) });
    }
    if (energy.includes(colName(c)) || power.includes(colName(c))) { const h = headerAbove(c); if (h && !parts.includes(h)) parts.unshift(h); }
    colHeaders[colName(c)] = parts.join(" · ");
  }
  let stop: string | null = null;
  for (let r = firstData; r < g.rows; r++) { const t = norm(textAt(g, r, nameCol)); if (/productos y servicios|servicios que dan descuento|productes i serveis/.test(t)) { stop = t; break; } }
  return {
    headerRow: headerRow + 1, periodRow: periodRow + 1, subHeaderRows: subHeaderRows.map((r) => r + 1), firstDataRow: firstData + 1, stopText: stop,
    cols: { name: colName(nameCol), power, energy, discount, surplus, duration, powerDay, extra },
    units: { power: pu, energy: eu, powerDay: pdu }, colHeaders, expected,
  };
}

/* ======================================================================= estructura */

export function checkTable(wb: WorkbookGrid, def: TemplateDef, opts: { sheet?: string | null } = {}): { sheet: SheetGrid | null; compatibility: Compatibility; needsSheet: boolean } {
  const t = def.table!;
  const name = opts.sheet ?? t.sheetName;
  const g = wb.sheets.find((s) => s.name === name) ?? null;
  if (!g) {
    return { sheet: null, needsSheet: true, compatibility: { status: "incompatible", differences: [`No existeix la pestanya «${name}» (pestanyes del document: ${wb.sheets.map((s) => s.name).join(", ")}). Tria manualment la pestanya correcta: no es canvia de pestanya automàticament.`] } };
  }
  const diffs: string[] = [];
  for (const e of t.expected) {
    const m = e.cell.match(/^([A-Z]+)(\d+)$/)!;
    const got = norm(textAt(g, Number(m[2]) - 1, colIdx(m[1])));
    if (got !== e.text) diffs.push(`A ${g.name}!${e.cell} s'esperava «${e.text}» i hi ha «${got || "(buit)"}».`);
  }
  if (!textAt(g, t.firstDataRow - 1, colIdx(t.cols.name))) diffs.push(`La primera fila de dades (${t.firstDataRow}) no té el nom del producte a la columna ${t.cols.name}.`);
  const minor: string[] = [];
  const known = new Set(t.expected.map((e) => e.cell));
  for (let c = 0; c < g.cols; c++) {
    const cn = colName(c);
    const h = textAt(g, t.headerRow - 1, c);
    if (h && cellAt(g, t.headerRow - 1, c)?.t === "s" && !known.has(`${cn}${t.headerRow}`)) minor.push(`Columna nova a la capçalera: ${cn} «${h}».`);
  }
  if (opts.sheet && opts.sheet !== t.sheetName) minor.push(`Pestanya triada manualment: «${opts.sheet}» (la plantilla esperava «${t.sheetName}»).`);
  return { sheet: g, needsSheet: false, compatibility: { status: diffs.length ? "incompatible" : minor.length ? "canvis_menors" : "compatible", differences: [...diffs, ...minor] } };
}

/* ======================================================================= regles: selecció i fusió */

function matches(r: ReadingRule, p: { name: string; tariff: string | null; priceCount: number; energyType: "luz" | "gas"; row: number; discount: string }): boolean {
  const m = r.match;
  if (m.tariffs?.length && !(p.tariff && m.tariffs.includes(p.tariff))) return false;
  if (m.priceCount != null && m.priceCount !== p.priceCount) return false;
  if (m.energyType && m.energyType !== p.energyType) return false;
  if (m.row != null && m.row !== p.row) return false;
  if (m.discount != null && norm(m.discount) !== norm(p.discount)) return false;
  if (m.product) { const n = norm(p.name); const list = Array.isArray(m.product) ? m.product : [m.product]; if (!list.some((x) => n.includes(norm(x)))) return false; }
  return true;
}
/** Regles efectives d'una plantilla: coneixement validat + regles apreses (versió) + regles extra (document / generals). */
export function effectiveRules(def: TemplateDef, extra: ReadingRule[] = []): ReadingRule[] {
  const kn = knowledgeFor(def.knowledge ?? null);
  // una regla del coneixement que s'ha aprovat (o substituït) a la plantilla queda reemplaçada per la de la plantilla
  const own = new Set([...(def.rules ?? []), ...extra].map((r) => r.id));
  const all = [...(kn?.rules ?? []).filter((r) => !own.has(r.id)), ...(def.rules ?? []), ...extra];
  return all.map((r, i) => ({ r, i })).sort((a, b) => SCOPE_RANK[a.r.scope] - SCOPE_RANK[b.r.scope] || a.i - b.i).map((x) => x.r);
}

/* ======================================================================= aplicar la plantilla de taula */

export interface TableReadOptions { force?: boolean; sheet?: string | null; extraRules?: ReadingRule[]; reference?: { from: string; to: string }; today?: Date }
export interface TableCounts { identified: number; interpreted: number; review: number; pending: number; failed: number }
export interface TableExtras { counts: TableCounts; hiddenRows: number[]; ignoredCols: string[]; complementary: { tiers: Record<string, string[]>; notes: string[] }; dataRange: string | null; needsSheet: boolean; sheets: string[] }

function readCell(g: SheetGrid, r: number, col: string): ReadValue {
  const c = colIdx(col);
  const x = cellAt(g, r, c);
  const a = addr(g, r, c);
  if (!x) return { v: null, cell: a };
  if (x.t === "e") return { v: null, cell: a, error: `Error ${x.v} (no és zero)` };
  if (x.t === "n") return { v: x.v as number, cell: a };
  const s = String(x.v).trim();
  const num = Number(s.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+([.,]\d+)?$/.test(s) && Number.isFinite(num)) return { v: /,/.test(s) || !/\.\d{3}$/.test(s) ? Number(s.replace(",", ".")) : num, cell: a };
  return { v: null, cell: a, error: `Text «${s.slice(0, 30)}» on s'esperava un número` };
}

export function applyTable(wb: WorkbookGrid, def: TemplateDef, opts: TableReadOptions = {}): ReadResult {
  const t = def.table!;
  const st = checkTable(wb, def, { sheet: opts.sheet });
  const issues: Issue[] = [];
  const extras: TableExtras = { counts: { identified: 0, interpreted: 0, review: 0, pending: 0, failed: 0 }, hiddenRows: [], ignoredCols: [], complementary: { tiers: {}, notes: [] }, dataRange: null, needsSheet: st.needsSheet, sheets: wb.sheets.map((s) => s.name) };
  const base: ReadResult = { sheet: st.sheet?.name ?? "", compatibility: st.compatibility, products: [], services: [], issues, validity: { label: null, month: null, version: null, from: null, logEntry: null }, blocks: [], stats: { fields: 0, validated: 0, errors: 0 }, table: extras };
  if (!st.sheet) { issues.push({ level: "critica", text: st.compatibility.differences[0] }); return base; }
  if (st.compatibility.status === "incompatible" && !opts.force) {
    issues.push({ level: "critica", text: "S'ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura." });
    for (const d of st.compatibility.differences) issues.push({ level: "critica", text: d });
    return base;
  }
  const g = st.sheet;
  const rules = effectiveRules(def, opts.extraRules);
  const nameC = colIdx(t.cols.name);
  const tableCols = new Set([nameC, ...[...t.cols.power, ...t.cols.energy, ...t.cols.powerDay].map(colIdx), ...[t.cols.discount, t.cols.surplus, t.cols.duration].filter(Boolean).map((x) => colIdx(x!)), ...t.cols.extra.map((x) => colIdx(x.col))]);
  const hidden = new Set(g.hidden ?? []);
  const reference = opts.reference ?? defaultReference(opts.today ?? new Date());
  let section: { label: string; gas: boolean; minKw: number | null; maxKw: number | null } = { label: "", gas: false, minKw: null, maxKw: null };
  let sub: { label: string; minKw: number | null; maxKw: number | null } | null = null;
  let lastRow = t.firstDataRow - 1;
  let fields = 0, validated = 0, errors = 0;
  const seenKeys = new Map<string, number>();
  const ignored = new Set<number>();
  let stopAt = g.rows;
  for (let r = t.firstDataRow - 1; r < g.rows; r++) {
    const name = textAt(g, r, nameC);
    if (t.stopText && name && norm(name).startsWith(t.stopText.slice(0, 30))) { stopAt = r; break; }
    // columnes amb dades fora de la taula (columnes auxiliars, fórmules de control…): s'ignoren però s'informa
    for (let c = 0; c < g.cols; c++) if (!tableCols.has(c) && cellAt(g, r, c) != null && c > nameC) ignored.add(c);
    const power = t.cols.power.map((c) => readCell(g, r, c));
    const energySrc = t.cols.energy.map((c) => readCell(g, r, c));
    const hasNum = [...power, ...energySrc].some((x) => x.v != null || x.error);
    if (!name && !hasNum) continue;
    if (name && !hasNum) {
      // fila de secció: «ELECTRICIDAD - 2.0TD [P1 =< 15kW]», «2.0TD _ 2 P1 <= 10kW», «GAS - RL1 a RL6»
      const n = norm(name);
      const max = n.match(/(?:<=|=<|<)\s*(\d+(?:[.,]\d+)?)\s*kw/), min = n.match(/(?<![<=])>\s*(\d+(?:[.,]\d+)?)\s*kw/);
      if (/^(electricidad|electricitat|gas)\b/.test(n)) { section = { label: name, gas: /^gas\b/.test(n), minKw: min ? Number(min[1].replace(",", ".")) : null, maxKw: max ? Number(max[1].replace(",", ".")) : null }; sub = null; }
      else sub = { label: name, minKw: min ? Number(min[1].replace(",", ".")) : null, maxKw: max ? Number(max[1].replace(",", ".")) : null };
      continue;
    }
    lastRow = r;
    const tariffRaw = name.split(/\s+/)[0] ?? null;
    const tariff = normTariff(name);
    const gas = section.gas || /^RL\./.test(tariff ?? "");
    const powerDay = t.cols.powerDay.map((c) => readCell(g, r, c));
    const disc = t.cols.discount ? textAt(g, r, colIdx(t.cols.discount)) : "";
    const extra: Record<string, string> = {};
    if (t.cols.surplus) extra["Preu excedents"] = textAt(g, r, colIdx(t.cols.surplus));
    if (t.cols.duration) extra["Durada"] = textAt(g, r, colIdx(t.cols.duration));
    for (const x of t.cols.extra) { const v = textAt(g, r, colIdx(x.col)); if (v) extra[x.label] = v; }
    const interp = interpretRow({ g, r, name, tariff, gas, power, energySrc, powerDay, disc, def, rules, reference, section: sub?.label ?? section.label, eligibility: { minKw: sub?.minKw ?? section.minKw, maxKw: sub?.maxKw ?? section.maxKw }, extra, hidden: hidden.has(r) });
    for (const x of [...power, ...energySrc, ...powerDay]) {
      if (x.error) { fields++; errors++; continue; }
      if (x.v == null) continue;
      fields++;
      const isE = energySrc.includes(x);
      if (x.v >= 0 && (!isE || (x.v > 0 && x.v <= 2))) validated++;
    }
    const k0 = norm(name);
    const dup = seenKeys.get(k0) ?? 0;
    seenKeys.set(k0, dup + 1);
    const warnings = [...interp.reasons];
    const p: Product = {
      key: dup ? `${k0}#${dup + 1}` : k0, blockId: norm(sub?.label ?? section.label).replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "taula", block: sub?.label ?? section.label, row: r + 1,
      energyType: gas ? "gas" : "luz", classification: interp.classification, singlePrice: interp.priceCount === 1,
      code: null, productCode: null, tariff, tariffRaw, name, variant: "Base", consumptionMax: null,
      power: gas ? [] : power, powerUnit: gas ? null : t.units.power, energy: gas ? energySrc.slice(0, 1) : energySrc, energyUnit: t.units.energy ?? "€/kWh",
      fixedTerm: gas ? power[0] : null, fixedTermUnit: gas ? null : null, discount: null, discountLabel: disc || null,
      margin: interp.margin ? { v: interp.margin.eurKwh, cell: interp.margin.cell } : null, adjust: null, warnings, interp,
    };
    if (interp.status === "fallida") issues.push({ level: "critica", text: `Fila ${r + 1} «${name}»: ${interp.reasons[0] ?? "no s'ha pogut llegir"}`, cell: addr(g, r, nameC) });
    base.products.push(p);
  }
  // informació complementària després de la taula (llistes de serveis que donen descompte)
  let tier: string | null = null;
  for (let r = stopAt + 1; r < Math.min(g.rows, stopAt + 40); r++) {
    const name = textAt(g, r, nameC);
    if (!name) continue;
    const tm = norm(name).match(/^tier\s*(\d)/);
    if (tm) { tier = `Tier ${tm[1]}`; extras.complementary.tiers[tier] = []; const note = textAt(g, r, nameC + 1); if (note) extras.complementary.notes.push(note); continue; }
    if (/productos y servicios/.test(norm(name))) break;
    if (tier) extras.complementary.tiers[tier].push(name);
  }
  extras.hiddenRows = [...hidden].filter((r) => r >= t.headerRow - 1 && r <= lastRow).map((r) => r + 1);
  const hiddenAfter = [...hidden].filter((r) => r > lastRow);
  if (hiddenAfter.length) issues.push({ level: "avis", text: `${hiddenAfter.length} files ocultes després de la taula (a partir de la fila ${hiddenAfter[0] + 1}, llistat de productes i serveis): no són tarifes i no s'importen.` });
  extras.ignoredCols = [...ignored].sort((a, b) => a - b).map(colName);
  extras.dataRange = `${t.cols.name}${t.firstDataRow}:${t.cols.powerDay[t.cols.powerDay.length - 1] ?? t.cols.energy[t.cols.energy.length - 1]}${lastRow + 1}`;
  const ps = base.products.map((p) => p.interp!);
  extras.counts = { identified: ps.length, interpreted: ps.filter((x) => x.status === "interpretada").length, review: ps.filter((x) => x.status === "revisar").length, pending: ps.filter((x) => x.status === "pendent").length, failed: ps.filter((x) => x.status === "fallida").length };
  if (extras.ignoredCols.length) issues.push({ level: "avis", text: `Columnes auxiliars amb dades fora de la taula (${extras.ignoredCols.join(", ")}): no s'utilitzen.` });
  if (extras.hiddenRows.length) issues.push({ level: "avis", text: `Files ocultes dins de la taula o les capçaleres: ${extras.hiddenRows.join(", ")}. Es llegeixen igualment i es marquen.` });
  for (const d of st.compatibility.differences) issues.push({ level: st.compatibility.status === "incompatible" ? "critica" : "avis", text: d });
  base.validity = tableValidity(wb, def);
  base.stats = { fields, validated, errors };
  return base;
}

/** Vigència: data d'actualització (Portada) i data final si el nom del fitxer la indica («HASTA_15.11»). */
function tableValidity(wb: WorkbookGrid, def: TemplateDef): ReadResult["validity"] {
  const MES: Record<string, string> = { enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12" };
  let from: string | null = null;
  for (const s of wb.sheets) {
    if (from) break;
    for (let r = 0; r < Math.min(s.rows, 30) && !from; r++) for (let c = 0; c < s.cols && !from; c++) {
      if (!/actualizacion|actualitzacio/.test(norm(textAt(s, r, c)))) continue;
      for (let k = c + 1; k < s.cols; k++) {
        const v = textAt(s, r, k);
        const m = norm(v).match(/(\d{1,2}) de ([a-z]+) de (\d{4})/);
        if (m && MES[m[2]]) { from = `${m[3]}-${MES[m[2]]}-${m[1].padStart(2, "0")}`; break; }
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { from = v; break; }
      }
    }
  }
  const h = norm(wb.fileName).match(/hasta[ _-]*(\d{1,2})[._-](\d{1,2})/);
  const to = h && from ? `${from.slice(0, 4)}-${h[2].padStart(2, "0")}-${h[1].padStart(2, "0")}` : null;
  const label = [from ? `Actualitzat el ${from.split("-").reverse().join("/")}` : null, to ? `vigent fins al ${to.split("-").reverse().join("/")} (nom del fitxer)` : null].filter(Boolean).join(" · ") || null;
  void def;
  return { label, month: from ? from.slice(0, 7) : null, version: null, from, logEntry: to };
}

/* ======================================================================= interpretació d'una fila */

interface RowCtx {
  g: SheetGrid; r: number; name: string; tariff: string | null; gas: boolean;
  power: ReadValue[]; energySrc: ReadValue[]; powerDay: ReadValue[]; disc: string;
  def: TemplateDef; rules: ReadingRule[]; reference: { from: string; to: string };
  section: string | null; eligibility: { minKw: number | null; maxKw: number | null }; extra: Record<string, string>; hidden: boolean;
}
export function interpretRow(x: RowCtx): Interpretation {
  const t = x.def.table!;
  const reasons: string[] = [];
  const source: SourcePrice[] = [];
  x.energySrc.forEach((v, i) => { if (v.v != null) source.push({ letter: LETTERS[i], col: t.cols.energy[i], header: t.colHeaders[t.cols.energy[i]] ?? t.cols.energy[i], v: v.v, cell: v.cell }); });
  const priceCount = source.length;
  const periods = isPeriodsCount(x.tariff, x.gas);
  const applied = x.rules.filter((rl) => matches(rl, { name: x.name, tariff: x.tariff, priceCount, energyType: x.gas ? "gas" : "luz", row: x.r + 1, discount: x.disc }));
  const set: RuleSet = {};
  for (const rl of applied) Object.assign(set, rl.set);
  const discount = parseDiscount(x.disc, x.gas ? "gas" : "luz");
  const out: Interpretation = {
    status: "interpretada", reasons, classification: set.classification ?? "pendent", periods, priceCount, source, mapping: null,
    energyOriginal: Array(6).fill(null), energyFinal: Array(6).fill(null), energyFinalYear2: null,
    powerOriginal: x.gas ? [] : x.power.map((v) => v.v), powerFinal: [], powerUnit: x.gas ? null : set.powerUnit ?? powerUnitOf(t.units.power),
    powerDayOriginal: x.powerDay.map((v) => v.v), powerDayFinal: [], discount, energyPct: 0, powerPct: 0, energyPctYear2: null,
    margin: null, schedule: null, estimate: null, manual: false, discountConfirmed: set.discountConfirmed ?? null, gasFixedUnit: set.gasFixedUnit ?? null,
    rules: applied.map((rl) => ({ id: rl.id, title: rl.title, source: rl.source, scope: rl.scope, approved: rl.approved })),
    section: x.section, eligibility: x.eligibility, extra: x.extra, hidden: x.hidden,
  };
  const errs = [...x.power, ...x.energySrc].filter((v) => v.error);
  if (errs.length) { out.status = "fallida"; reasons.push(...errs.map((v) => `${v.cell}: ${v.error}`)); }
  if (!priceCount && !errs.length) { out.status = "fallida"; reasons.push("No hi ha cap preu d'energia a la fila."); }
  if (set.exclude) { out.status = "pendent"; reasons.push("Exclosa per una regla de lectura."); }
  if (out.status === "fallida") return out;
  for (const rl of applied) if (!rl.approved) reasons.push(`Regla pendent d'aprovar: «${rl.title}».`);
  if (x.hidden) reasons.push("Fila oculta a l'Excel.");

  // descomptes base (columna de condicions) · energia i potència per separat
  const eT: DiscountTarget = x.gas ? "terme_variable" : "energia", pT: DiscountTarget = x.gas ? "terme_fix" : "potencia";
  let ePct = basePct(discount, eT, 1), pPct = basePct(discount, pT, 1);
  let e2: number | null = hasYear2(discount) ? basePct(discount, eT, 2) : null;
  if (set.discountOn) {
    const all = discount.base.filter((b) => b.kind === "pct" && (b.year == null || b.year === 1)).reduce((a, b) => Math.max(a, b.value), 0);
    ePct = set.discountOn.includes(eT) ? (ePct || all) : 0;
    pPct = set.discountOn.includes(pT) ? (pPct || all) : 0;
  }
  if (set.ignoreDiscount) { ePct = 0; pPct = 0; e2 = null; reasons.push("Regla: el preu de l'Excel ja és final (no s'aplica el descompte)."); }
  out.energyPct = ePct; out.powerPct = pPct; out.energyPctYear2 = e2;
  if (set.discountConfirmed) reasons.push(`Descompte confirmat: ${set.discountConfirmed}`);
  else {
    if (discount.unparsed) reasons.push(`Descompte no interpretat: «${discount.unparsed}».`);
    for (const a of discount.ambiguous) reasons.push(a);
  }

  // indexada: el valor és el marge (no és un preu final)
  if (set.valueIsMargin) {
    const m = source[0];
    if (m) out.margin = { eurKwh: m.v, eurMWh: r6(new Decimal(m.v).times(1000)), cell: m.cell };
    out.classification = "indexada";
    reasons.push("Indexada: el valor és el MARGE de la comercialitzadora, no un preu final. Falta la fórmula contractual completa (índex, pèrdues, peatges i serveis d'ajust): demana-la a la comercialitzadora per poder comparar.");
    out.powerFinal = out.powerOriginal.map((v) => applyPct(v, pPct));
    out.powerDayFinal = out.powerDayOriginal.map((v) => applyPct(v, pPct));
    if (x.gas) out.powerFinal = [applyPct(x.power[0]?.v ?? null, pPct)];
    return finish(out, set);
  }

  // correspondència preus → períodes
  let mapping: Letter[] | null = set.mapping ? set.mapping.slice(0, periods) : null;
  if (!mapping) {
    if (priceCount === 1) mapping = Array(periods).fill(source[0].letter);
    else if (priceCount === periods && source.every((s, i) => s.letter === LETTERS[i])) mapping = LETTERS.slice(0, periods);
  }
  const byLetter = new Map(source.map((s) => [s.letter, s.v]));
  if (set.manual) {
    out.energyOriginal = Array.from({ length: 6 }, (_, i) => (i < periods ? set.manual!.energy[i] ?? null : null));
    out.energyFinal = out.energyOriginal.slice();
    out.manual = true;
    reasons.push(`Valors validats manualment: ${set.manual.note}`);
  } else if (set.weighted && set.schedule) {
    if (periods !== 6) { out.status = "pendent"; reasons.push(`La ponderació horària només es pot calcular en peatges de 6 períodes (no ${x.tariff}).`); }
    else {
      const prom = byLetter.get(set.schedule.promoted), noProm = byLetter.get(set.schedule.notPromoted);
      if (prom == null || noProm == null) { out.status = "pendent"; reasons.push("Falta el preu promocionat o el no promocionat."); }
      else {
        const rule: OpenRule = { mode: "horari", windows: set.schedule.windows };
        const counts = countHours(x.tariff!, rule, x.reference);
        const w = weightedPrices(counts, { open: prom, noOpen: noProm }, rule);
        out.energyOriginal = w.map((p) => p.price);
        out.estimate = { reference: x.reference, periods: w.map((p) => ({ period: p.period, open: p.open, noOpen: p.noOpen, total: p.total, price: p.price })) };
        reasons.push(`PREU ESTIMAT PER PONDERACIÓ HORÀRIA (${x.reference.from} – ${x.reference.to}): cada període barreja hores promocionades i no promocionades. No és el preu efectiu real del client.`);
      }
    }
  } else if (mapping) {
    out.mapping = mapping;
    out.energyOriginal = Array.from({ length: 6 }, (_, i) => (i < periods ? byLetter.get(mapping![i]) ?? null : null));
    if (out.energyOriginal.slice(0, periods).some((v) => v == null)) { out.status = "pendent"; reasons.push("La regla de correspondència apunta a una columna sense preu."); }
  } else {
    out.status = "pendent";
    reasons.push(`No hi ha cap regla validada per a ${priceCount} preus en ${x.tariff ?? "aquest peatge"}: no s'inventa la distribució P1–P${periods}. Ensenya-la amb un exemple o amb el xat.`);
  }
  if (out.classification === "indexada" && !out.manual) reasons.push("Indexada sense regla de marge: els valors es llegeixen com a preus de referència; confirma-ho.");
  if (set.schedule) out.schedule = { ...set.schedule, text: describeRule({ mode: "horari", windows: set.schedule.windows }).replace(/No Open/g, "No promocionat").replace(/Open/g, "Promocionat") + ` (${set.schedule.source})` };
  if (out.mapping && set.schedule && !set.weighted) reasons.push(`Correspondència comercial P1–P6 de Direcció. L'horari contractual real es conserva a part: ${out.schedule!.text}.`);
  out.energyFinal = out.manual ? out.energyFinal : out.energyOriginal.map((v) => applyPct(v, ePct));
  out.energyFinalYear2 = e2 != null && !out.manual ? out.energyOriginal.map((v) => applyPct(v, e2!)) : null;
  out.powerFinal = x.gas ? [applyPct(x.power[0]?.v ?? null, pPct)] : out.powerOriginal.map((v) => applyPct(v, pPct));
  out.powerDayFinal = out.powerDayOriginal.map((v) => applyPct(v, pPct));
  return finish(out, set);
}
function finish(out: Interpretation, set: RuleSet): Interpretation {
  if (out.status === "fallida") return out;
  if (out.classification === "pendent" && out.status === "interpretada") { out.status = "pendent"; out.reasons.push("Classificació PENDENT (fixa / indexada / mixta)."); }
  if (set.pending && out.status !== "pendent") { out.status = "pendent"; out.reasons.push(set.pending); }
  if (out.status === "interpretada" && (set.review || (out.classification === "indexada" && !out.margin) || (!out.discountConfirmed && (out.discount.ambiguous.length || out.discount.unparsed)) || out.hidden || out.rules.some((r) => !r.approved))) {
    out.status = "revisar";
    if (set.review) out.reasons.push(set.review);
  }
  return out;
}

/* ======================================================================= comprovacions per verificar (taula) */

export function tableChecks(def: TemplateDef, read: ReadResult | null): { id: string; label: string; ok: boolean; detail: string }[] {
  const ps = read?.products ?? [];
  const c = read?.table?.counts;
  const crit = read?.issues.filter((i) => i.level === "critica") ?? [];
  const t = def.table;
  return [
    { id: "lectura", label: "Prova amb un document real", ok: !!read && read.compatibility.status !== "incompatible" && ps.length > 0, detail: read ? `${read.sheet}: ${ps.length} tarifes, estructura ${read.compatibility.status.replace("_", " ")}` : "Encara no s'ha provat amb cap document" },
    { id: "columnes", label: "Columnes identificades", ok: !!t && t.cols.energy.length > 0 && t.cols.power.length > 0 && !!t.cols.discount, detail: t ? `Nom ${t.cols.name} · potència ${t.cols.power[0]}–${t.cols.power[t.cols.power.length - 1]} · energia ${t.cols.energy[0]}–${t.cols.energy[t.cols.energy.length - 1]} · descomptes ${t.cols.discount ?? "—"}` : "—" },
    { id: "productes", label: "Productes identificats", ok: ps.length > 0 && ps.every((p) => p.name && (p.tariff || p.energyType === "gas")), detail: `${ps.length} tarifes; sense peatge: ${ps.filter((p) => !p.tariff).length}` },
    { id: "preus", label: "Preus comprovats amb les cel·les", ok: !!read && read.stats.errors === 0 && read.stats.validated > 0 && read.stats.validated === read.stats.fields, detail: read ? `${read.stats.validated} de ${read.stats.fields} valors dins de rang; ${read.stats.errors} amb error` : "—" },
    { id: "interpretacio", label: "Totes les tarifes interpretades (cap pendent, a revisar o fallida)", ok: !!c && c.identified > 0 && c.interpreted === c.identified, detail: c ? `${c.interpreted} interpretades · ${c.review} a revisar · ${c.pending} pendents · ${c.failed} fallides` : "—" },
    { id: "descomptes", label: "Descomptes interpretats", ok: ps.length > 0 && ps.every((p) => p.interp?.discountConfirmed || (!p.interp?.discount.unparsed && !p.interp?.discount.ambiguous.length)), detail: `${ps.filter((p) => !p.interp?.discountConfirmed && (p.interp?.discount.unparsed || p.interp?.discount.ambiguous.length)).length} amb descompte dubtós sense confirmar` },
    { id: "formules", label: "Indexades amb marge reconegut", ok: ps.filter((p) => p.classification === "indexada").every((p) => p.interp?.margin), detail: `${ps.filter((p) => p.classification === "indexada").length} indexades` },
    { id: "regles", label: "Regles aplicades aprovades", ok: ps.every((p) => p.interp?.rules.every((r) => r.approved)), detail: `${new Set(ps.flatMap((p) => p.interp?.rules.filter((r) => !r.approved).map((r) => r.title) ?? [])).size} regles sense aprovar` },
    { id: "errors", label: "Sense errors crítics pendents", ok: !!read && !crit.length, detail: crit.length ? crit.slice(0, 3).map((x) => x.text).join(" · ") : "Cap" },
  ];
}
