/**
 * PLANTILLES DE LECTURA D'EXCEL PER COMERCIALITZADORA (part pura, servidor i navegador, testejable).
 *
 * Una plantilla descriu COM està fet un tipus de document (on són els blocs de productes, quines columnes són
 * potència, energia de cada variant, límits de consum, descomptes…). Es proposa automàticament a partir d'un Excel
 * de mostra (`proposeTemplate`), l'usuari la corregeix (editor de columnes o xat → `TemplateOp`) i Direcció la
 * verifica. Després s'aplica als Excel nous equivalents (`applyTemplate`) comprovant-ne abans l'estructura: si ha
 * canviat de manera incompatible, NO s'aplica i es demana revisió.
 *
 * Principis: les cel·les buides o amb error NO són zeros (són «sense dada»); es conserven les unitats originals;
 * cada valor llegit porta la cel·la d'origen (p. ex. «OCT26_3_VP!L20») per poder-lo comprovar; la paraula «Variable»
 * no fa indexat un producte (es classifica PENDENT fins que algú ho confirma).
 */
import { normalizeOfferUnits } from "./units";
import { slug } from "./catalog";
import { emptySheet, type OfferVersion, type PowerUnit } from "./types";
import { applyTable, checkTable, tableChecks, type Interpretation, type ReadingRule, type TableDef, type TableExtras } from "./tariff-table";
import { tableProductsToOffers } from "./table-offers";

/* ======================================================================= model del full */

export type CellT = "n" | "s" | "e" | "b" | "z";
export interface CellV { v: number | string | boolean | null; t: CellT }
export interface SheetGrid { name: string; rows: number; cols: number; cells: (CellV | null)[][]; merges: string[]; hidden?: number[] }
export interface WorkbookGrid { fileName: string; sheets: SheetGrid[] }

type XlsxLike = {
  read: (data: ArrayBuffer | Uint8Array, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, Record<string, unknown>> };
  utils: { decode_range: (r: string) => { s: { r: number; c: number }; e: { r: number; c: number } }; encode_cell: (c: { r: number; c: number }) => string; encode_range: (r: unknown) => string };
};

/** Excel → graella de valors (es llegeixen els valors calculats, no les fórmules). Màx. 400 files × 80 columnes per full. */
export function gridFromXlsx(XLSX: XlsxLike, data: ArrayBuffer | Uint8Array, fileName: string): WorkbookGrid {
  // cellStyles: per saber quines files estan ocultes (no es llegeixen fórmules: només els valors calculats)
  const wb = XLSX.read(data, { type: "array", cellDates: true, cellFormula: false, cellStyles: true });
  const sheets: SheetGrid[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = (ws["!ref"] as string | undefined) ?? "A1:A1";
    const r = XLSX.utils.decode_range(ref);
    const rows = Math.min(400, r.e.r + 1), cols = Math.min(80, r.e.c + 1);
    const cells: (CellV | null)[][] = [];
    for (let i = 0; i < rows; i++) {
      const row: (CellV | null)[] = [];
      for (let j = 0; j < cols; j++) {
        const c = ws[XLSX.utils.encode_cell({ r: i, c: j })] as { t?: string; v?: unknown; w?: string } | undefined;
        if (!c || c.v == null || c.v === "") { row.push(null); continue; }
        if (c.t === "e") row.push({ v: c.w ?? "#ERROR", t: "e" });
        // es treu el soroll de coma flotant de l'Excel (0,21031000000000002 → 0,21031): 14 xifres significatives
        else if (c.t === "n") row.push({ v: Number((c.v as number).toPrecision(14)), t: "n" });
        else if (c.t === "b") row.push({ v: c.v as boolean, t: "b" });
        else if (c.v instanceof Date) { const d = c.v; row.push({ v: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, t: "s" }); }
        else row.push({ v: String(c.v), t: "s" });
      }
      cells.push(row);
    }
    const merges = ((ws["!merges"] as unknown[]) ?? []).map((m) => XLSX.utils.encode_range(m));
    const hidden = ((ws["!rows"] as ({ hidden?: boolean } | undefined)[] | undefined) ?? []).map((x, i) => (x?.hidden ? i : -1)).filter((i) => i >= 0 && i < rows);
    return { name, rows, cols, cells, merges, ...(hidden.length ? { hidden } : {}) };
  });
  return { fileName, sheets };
}

export const colIdx = (c: string) => c.toUpperCase().split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
export const colName = (i: number) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const cell = (g: SheetGrid, r: number, c: number) => g.cells[r]?.[c] ?? null;
const text = (g: SheetGrid, r: number, c: number) => { const x = cell(g, r, c); return x && x.t === "s" ? String(x.v) : ""; };
export const addr = (g: SheetGrid, r: number, c: number) => `${g.name}!${colName(c)}${r + 1}`;

/* ======================================================================= definició de plantilla */

export const CLASSIFICATIONS = ["fixa", "indexada", "mixta", "pendent"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASSIFICATION_LABEL: Record<Classification, string> = { fixa: "FIXA", indexada: "INDEXADA", mixta: "MIXTA", pendent: "PENDENT" };

export interface VariantDef {
  label: string; // ONE, SUPRA, M, Base…
  letter: string | null; // sufix del codi (M / B / A)
  codeCol: string | null; // columna amb el codi comercial de la variant
  energyCols: string[]; // P1..Pn (llum) o una sola columna (gas: terme variable)
  energyUnit: string; // tal com el document: «€/kWh»
  discountCol: string | null; // descompte (unitats del document)
  discountLabel: string | null;
  marginCol: string | null; // marge d'una indexada
  adjustCol: string | null; // valor numèric al costat (sense identificar)
}
export interface BlockDef {
  id: string;
  title: string;
  kind: "productes" | "serveis";
  energyType: "luz" | "gas";
  anchor: { col: string; text: string }; // text normalitzat amb què comença el títol
  headerOffset: number; // fila de capçalera (P1…P6 o etiquetes) respecte del títol
  dataOffset: number; // primera fila de dades respecte del títol
  classification: Classification;
  classificationNote: string | null;
  singlePrice: boolean; // preu únic 24 h (energia només a P1)
  excluded: boolean; // bloc que no s'importa (p. ex. preus no publicats)
  cols: { code: string | null; productCode: string | null; tariff: string | null; name: string | null; consumptionMax: string | null; fixedTerm: string | null; price: string | null };
  units: { power: string | null; fixedTerm: string | null; consumption: string | null; price: string | null };
  power: string[]; // columnes P1..P6
  variants: VariantDef[];
  expected: { dr: number; col: string; text: string }[]; // capçaleres esperades (empremta)
  rowOverrides: Record<string, { energyType?: "luz" | "gas"; excluded?: boolean }>; // per codi de producte
}
export interface TemplateDef {
  schema: 1;
  supplier: string;
  name: string;
  docType: "xlsx";
  sheet: { pattern: string; example: string }; // nom del full de preus
  validity: { sheetNamePattern: string | null; logSheet: string | null };
  options: { emptyIsNull: true; errorIsNull: true };
  blocks: BlockDef[];
  notes: string[];
  /** Fase 12: «taula» = una fila per tarifa (p. ex. Iberdrola, pestanya «Energía»); per defecte, «blocs» (Naturgy). */
  layout?: "blocs" | "taula";
  table?: TableDef | null;
  /** Paquet de coneixement validat de la comercialitzadora (reading-knowledge.ts). */
  knowledge?: string | null;
  /** Regles de lectura apreses (xat, exemples) desades amb aquesta versió de la plantilla. */
  rules?: ReadingRule[];
}

/* ======================================================================= detecció automàtica (proposta) */

const TARIFF_RE = /^(2\.?0|3\.?0|6\.?[1-4]|6\.?x)\s?td|^rl\.?\s?\d{1,2}/i;
export function normTariff(raw: unknown): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/\s+/g, "");
  let m = s.match(/^(2|3|6)\.?([0-4X])TD/);
  if (m) return `${m[1]}.${m[2] === "X" ? "1" : m[2]}TD`;
  m = s.match(/^RL\.?(\d{1,2})/);
  return m ? `RL.${Number(m[1])}` : null;
}
function periodRuns(g: SheetGrid, r: number): { start: number; n: number }[] {
  const out: { start: number; n: number }[] = [];
  let c = 0;
  while (c < g.cols) {
    if (norm(text(g, r, c)) === "p1") {
      let n = 1;
      while (norm(text(g, r, c + n)) === `p${n + 1}`) n++;
      if (n >= 2) out.push({ start: c, n });
      c += n;
    } else c++;
  }
  return out;
}
const unitOf = (t: string) => { const m = t.match(/\(([^)]*€[^)]*)\)/); return m ? m[1].trim() : null; };
const powerUnitCode = (u: string | null) => { const n = norm(u); return /dia/.test(n) ? "eur_kw_dia" : /mes/.test(n) ? "eur_kw_mes" : /ano|any|year/.test(n) ? "eur_kw_any" : null; };
function classify(title: string): { c: Classification; single: boolean; note: string | null } {
  const t = norm(title);
  const single = /24 ?h/.test(t);
  if (/index|pass ?pool|omie|formula/.test(t)) return { c: "indexada", single, note: "El títol indica indexació: cal la fórmula contractual (marge, pèrdues, peatges)." };
  if (/fijo|fix|compromiso|estable/.test(t)) return { c: "fixa", single, note: single ? "Preu únic 24 h (energia a P1)." : null };
  if (/variable/.test(t)) return { c: "pendent", single, note: "«Variable» no vol dir indexat: confirma si és un preu revisable (fix per període) o una fórmula indexada." };
  return { c: "pendent", single, note: "Classificació no deduïble del títol." };
}
function variantLabel(...texts: string[]): string | null {
  const t = norm(texts.join(" "));
  if (/\bsupra\b/.test(t)) return "SUPRA";
  if (/\bone\b/.test(t)) return "ONE";
  return null;
}
function findTitleUp(g: SheetGrid, from: number, minRow: number): { r: number; c: number; t: string } | null {
  for (let r = from; r >= Math.max(0, minRow); r--) for (let c = 1; c <= 3; c++) {
    const t = text(g, r, c);
    if (t && /^(plan|contrato|tarifa|producto|temporada|precio|oferta|gas|luz)/i.test(t.trim()) && t.length > 4 && !/termino|consumo/i.test(norm(t))) return { r, c, t: t.trim() };
  }
  return null;
}
function dataRows(g: SheetGrid, start: number, keyCols: number[]): number[] {
  const rows: number[] = [];
  for (let r = start; r < g.rows; r++) {
    const any = keyCols.some((c) => cell(g, r, c) != null);
    if (!any) { if (rows.length) break; if (r - start > 2) break; continue; }
    rows.push(r);
  }
  return rows;
}
function sectionOf(g: SheetGrid, r: number): "luz" | "gas" | "serveis" | null {
  for (let i = r; i >= 0; i--) for (let c = 0; c < 3; c++) {
    const t = norm(text(g, i, c));
    if (t === "electricidad" || t === "electricitat" || t === "luz") return "luz";
    if (t === "gas") return "gas";
    if (t === "servicios" || t === "serveis") return "serveis";
  }
  return null;
}
function expectedHeaders(g: SheetGrid, titleRow: number, headerRow: number, fromCol: number, toCol: number) {
  const out: BlockDef["expected"] = [];
  for (let r = titleRow; r <= headerRow; r++) for (let c = fromCol; c <= toCol; c++) {
    const t = text(g, r, c);
    if (t) out.push({ dr: r - titleRow, col: colName(c), text: norm(t) });
  }
  return out;
}
/** Columnes descriptives d'un bloc a partir de les dades. */
function describeCols(g: SheetGrid, rows: number[], before: number, headerRow: number) {
  const vals = (c: number) => rows.map((r) => cell(g, r, c)).filter(Boolean) as CellV[];
  let tariff: number | null = null, name: number | null = null, code: number | null = null, product: number | null = null, consumption: number | null = null;
  for (let c = 0; c < before; c++) {
    const v = vals(c);
    if (!v.length) continue;
    if (tariff == null && v.every((x) => x.t === "s" && TARIFF_RE.test(String(x.v).trim()))) { tariff = c; continue; }
    if (v.every((x) => x.t === "s") && v.some((x) => /[a-z]{3,}\s/i.test(String(x.v)) && String(x.v).length > 8) && name == null) { name = c; continue; }
    if (code == null && v.every((x) => x.t === "s" && /^[A-Z0-9]{6,}$/.test(String(x.v)))) { code = c; continue; }
    if (product == null && v.every((x) => (x.t === "s" && /^[A-Z]\d{4}$/.test(String(x.v))) || x.t === "n")) { product = c; continue; }
  }
  for (let c = 0; c < before; c++) for (let r = headerRow - 2; r <= headerRow; r++) if (/consumo|consum/.test(norm(text(g, r, c)))) consumption = c;
  return { tariff, name, code, product, consumption };
}

let seq = 0;
const bid = (t: string) => `${norm(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "bloc"}-${++seq}`;

/** Proposa una plantilla a partir d'un Excel de mostra (sense IA: estructura, capçaleres i dades). */
export function proposeTemplate(wb: WorkbookGrid, opts: { supplier: string; name: string }): { def: TemplateDef; notes: string[] } {
  seq = 0;
  const notes: string[] = [];
  // full de preus: el que té més capçaleres P1…P6 o «término»
  const score = (g: SheetGrid) => { let s = 0; for (let r = 0; r < g.rows; r++) { s += periodRuns(g, r).length * 3; for (let c = 0; c < g.cols; c++) if (/termino|precio/.test(norm(text(g, r, c)))) s++; } return s; };
  const g = [...wb.sheets].sort((a, b) => score(b) - score(a))[0];
  const blocks: BlockDef[] = [];
  const used = new Set<number>();
  // 1) blocs amb períodes (llum)
  for (let r = 0; r < g.rows; r++) {
    const runs = periodRuns(g, r);
    if (!runs.length) continue;
    const title = findTitleUp(g, r - 1, r - 6);
    if (!title || used.has(title.r)) continue;
    used.add(title.r);
    const rows = dataRows(g, r + 1, [0, 1, 2, 3]);
    const first = runs[0].start;
    const dc = describeCols(g, rows, first, r);
    let power: string[] = [], powerUnit: string | null = null;
    const variants: VariantDef[] = [];
    for (const run of runs) {
      const above: string[] = [];
      for (let i = title.r; i < r; i++) for (let c = run.start - 1; c < run.start + run.n; c++) { const t = text(g, i, c); if (t) above.push(t); }
      const joined = above.join(" ");
      const cols = Array.from({ length: run.n }, (_, k) => colName(run.start + k));
      if (/potencia/.test(norm(joined)) && !power.length) { power = cols; powerUnit = unitOf(joined) ?? null; continue; }
      {
        let letter: string | null = null;
        for (let i = title.r; i < r; i++) { const t = text(g, i, run.start).trim(); if (/^[A-Z]$/.test(t)) letter = t; }
        const left = run.start - 1;
        const leftVals = rows.map((x) => cell(g, x, left)).filter(Boolean) as CellV[];
        const leftIsCode = leftVals.length > 0 && leftVals.every((x) => x.t === "s" && /^[A-Z0-9]{6,}$/.test(String(x.v)));
        const leftIsNum = leftVals.length > 0 && leftVals.every((x) => x.t === "n");
        const label = variantLabel(joined) ?? letter ?? "Base";
        variants.push({
          label, letter, codeCol: variants.length === 0 ? (dc.code != null ? colName(dc.code) : null) : leftIsCode ? colName(left) : null,
          energyCols: cols, energyUnit: unitOf(joined) ?? "€/kWh", discountCol: null, discountLabel: null, marginCol: null,
          adjustCol: variants.length > 0 && leftIsNum ? colName(left) : null,
        });
      }
    }
    const cl = classify(title.t);
    const sec = sectionOf(g, title.r);
    const allErr = rows.length > 0 && rows.every((x) => variants.every((v) => v.energyCols.every((c) => { const k = cell(g, x, colIdx(c)); return !k || k.t === "e"; })));
    const block: BlockDef = {
      id: bid(title.t), title: title.t, kind: "productes", energyType: sec === "gas" ? "gas" : "luz",
      anchor: { col: colName(title.c), text: norm(title.t) }, headerOffset: r - title.r, dataOffset: (rows[0] ?? r + 1) - title.r,
      classification: cl.c, classificationNote: cl.note, singlePrice: cl.single, excluded: false,
      cols: { code: dc.code != null ? colName(dc.code) : null, productCode: dc.product != null ? colName(dc.product) : null, tariff: dc.tariff != null ? colName(dc.tariff) : null, name: dc.name != null ? colName(dc.name) : null, consumptionMax: dc.consumption != null ? colName(dc.consumption) : null, fixedTerm: null, price: null },
      units: { power: powerUnit, fixedTerm: null, consumption: dc.consumption != null ? "kWh/any" : null, price: null },
      power, variants, expected: expectedHeaders(g, title.r, r, 0, Math.max(...runs.map((x) => x.start + x.n))), rowOverrides: {},
    };
    if (allErr) { block.excluded = true; notes.push(`«${title.t}»: totes les cel·les de preus tenen error (#N/A). Es proposa no importar-lo fins que el document publiqui preus (es pot tornar a incloure).`); }
    blocks.push(block);
  }
  // 2) blocs de gas: «PRECIO TÉRMINO FIJO» + «PRECIO TÉRMINO VARIABLE»
  for (let r = 0; r < g.rows; r++) {
    let fixedCol = -1;
    const priceCols: number[] = [];
    for (let c = 0; c < g.cols; c++) { const t = norm(text(g, r, c)); if (/termino fijo/.test(t)) fixedCol = c; if (/termino variable/.test(t)) priceCols.push(c); }
    if (fixedCol < 0 || !priceCols.length) continue;
    const title = findTitleUp(g, r - 1, r - 5);
    if (!title || used.has(title.r)) continue;
    used.add(title.r);
    const rows = dataRows(g, r + 1, [0, 1, 2, 3]).filter((x) => normTariff(text(g, x, 2) || text(g, x, 1)) || cell(g, x, fixedCol)?.t === "n");
    const dc = describeCols(g, rows, fixedCol, r);
    const cl = classify(title.t);
    const variants: VariantDef[] = priceCols.map((pc) => {
      const dcol = pc - 1;
      const head: string[] = [];
      for (let i = title.r; i < r; i++) for (const c of [dcol, pc]) { const t = text(g, i, c); if (t) head.push(t); }
      let letter: string | null = null;
      for (let i = title.r; i < r; i++) { const t = text(g, i, pc).trim(); if (/^[A-Z]$/.test(t)) letter = t; }
      const disc = head.find((t) => /dto|desc/i.test(t)) ?? null;
      return { label: variantLabel(...head) ?? letter ?? "Base", letter, codeCol: null, energyCols: [colName(pc)], energyUnit: unitOf(text(g, r, pc)) ?? "€/kWh", discountCol: colName(dcol), discountLabel: disc ? disc.replace(/\s+/g, " ").trim() : null, marginCol: null, adjustCol: null };
    });
    blocks.push({
      id: bid(title.t), title: title.t, kind: "productes", energyType: "gas",
      anchor: { col: colName(title.c), text: norm(title.t) }, headerOffset: r - title.r, dataOffset: (rows[0] ?? r + 2) - title.r,
      classification: cl.c, classificationNote: cl.note, singlePrice: true, excluded: false,
      cols: { code: dc.code != null ? colName(dc.code) : null, productCode: dc.product != null ? colName(dc.product) : null, tariff: dc.tariff != null ? colName(dc.tariff) : null, name: dc.name != null ? colName(dc.name) : null, consumptionMax: dc.consumption != null ? colName(dc.consumption) : null, fixedTerm: colName(fixedCol), price: null },
      units: { power: null, fixedTerm: unitOf(text(g, r, fixedCol)), consumption: dc.consumption != null ? "kWh/any" : null, price: null },
      power: [], variants, expected: expectedHeaders(g, title.r, r, 0, Math.max(...priceCols) + 1), rowOverrides: {},
    });
  }
  // 3) serveis complementaris
  for (let r = 0; r < g.rows; r++) {
    if (!["servicios", "serveis"].includes(norm(text(g, r, 1)))) continue;
    let head = -1, price = -1;
    for (let i = r + 1; i < r + 5; i++) for (let c = 0; c < g.cols; c++) if (/sin impuestos|sense impostos/.test(norm(text(g, i, c)))) { head = i; price = c; }
    if (head < 0) continue;
    const rows = dataRows(g, head + 1, [2]);
    blocks.push({
      id: bid("serveis"), title: text(g, r, 1).trim(), kind: "serveis", energyType: "luz",
      anchor: { col: "B", text: norm(text(g, r, 1)) }, headerOffset: head - r, dataOffset: (rows[0] ?? head + 1) - r,
      classification: "fixa", classificationNote: "Serveis complementaris (no són tarifes d'energia).", singlePrice: true, excluded: false,
      cols: { code: null, productCode: null, tariff: null, name: "C", consumptionMax: null, fixedTerm: null, price: colName(price) },
      units: { power: null, fixedTerm: null, consumption: null, price: `€ (${text(g, head, price).trim().toLowerCase()})` },
      power: [], variants: [], expected: expectedHeaders(g, r, head, 0, price + 1), rowOverrides: {},
    });
  }
  const sm = g.name.match(/^([A-Z]{3})(\d{2})_(\d+)_([A-Z]+)$/);
  const log = wb.sheets.find((s) => /seguimiento|historial|log/i.test(s.name))?.name ?? null;
  if (!blocks.length) notes.push("No s'ha reconegut cap bloc de productes: cal ensenyar l'estructura amb l'editor o el xat.");
  for (const b of blocks) if (b.classification === "pendent") notes.push(`«${b.title}»: classificació PENDENT. ${b.classificationNote ?? ""}`);
  return {
    def: {
      schema: 1, supplier: opts.supplier, name: opts.name, docType: "xlsx",
      sheet: { pattern: sm ? "^[A-Z]{3}\\d{2}_\\d+_" + sm[4] + "$" : `^${g.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, example: g.name },
      validity: { sheetNamePattern: sm ? "^([A-Z]{3})(\\d{2})_(\\d+)_" : null, logSheet: log },
      options: { emptyIsNull: true, errorIsNull: true }, blocks, notes: [],
    },
    notes,
  };
}

/* ======================================================================= aplicar una plantilla */

export interface ReadValue { v: number | null; cell: string; error?: string }
export interface Product {
  key: string; blockId: string; block: string; row: number; energyType: "luz" | "gas"; classification: Classification; singlePrice: boolean;
  code: string | null; productCode: string | null; tariff: string | null; tariffRaw: string | null; name: string; variant: string;
  consumptionMax: number | null; power: ReadValue[]; powerUnit: string | null; energy: ReadValue[]; energyUnit: string;
  fixedTerm: ReadValue | null; fixedTermUnit: string | null; discount: ReadValue | null; discountLabel: string | null; margin: ReadValue | null; adjust: ReadValue | null;
  warnings: string[];
  /** Plantilles de taula: interpretació (preus originals, descomptes, P1–P6 finals, regles aplicades). */
  interp?: Interpretation;
}
export interface Service { name: string; price: ReadValue; unit: string | null }
export interface Issue { level: "critica" | "avis"; text: string; cell?: string }
export interface Compatibility { status: "compatible" | "canvis_menors" | "incompatible"; differences: string[] }
export interface ReadResult {
  sheet: string; compatibility: Compatibility; products: Product[]; services: Service[]; issues: Issue[];
  validity: { label: string | null; month: string | null; version: string | null; from: string | null; logEntry: string | null };
  blocks: { id: string; title: string; found: boolean; row: number | null; rows: number; excluded: boolean }[];
  stats: { fields: number; validated: number; errors: number };
  table?: TableExtras;
}

const MONTHS: Record<string, string> = { ENE: "01", JAN: "01", FEB: "02", MAR: "03", ABR: "04", APR: "04", MAY: "05", JUN: "06", JUL: "07", AGO: "08", AUG: "08", SEP: "09", SET: "09", OCT: "10", NOV: "11", DIC: "12", DEC: "12" };

/** Comprova l'estructura del document contra la plantilla (pestanyes, títols, capçaleres i columnes). */
export function checkStructure(wb: WorkbookGrid, def: TemplateDef): { sheet: SheetGrid | null; compatibility: Compatibility; anchors: Record<string, number | null> } {
  if (def.layout === "taula" && def.table) { const t = checkTable(wb, def); return { sheet: t.sheet, compatibility: t.compatibility, anchors: {} }; }
  const diffs: string[] = [];
  let minor = false;
  const re = new RegExp(def.sheet.pattern);
  let sheet = wb.sheets.find((s) => re.test(s.name)) ?? null;
  if (!sheet) {
    sheet = wb.sheets.find((s) => s.name === def.sheet.example) ?? null;
    if (!sheet) {
      // pot ser que només hagi canviat el nom: es busca el full on hi ha els títols dels blocs
      sheet = wb.sheets.find((s) => def.blocks.some((b) => findAnchor(s, b) != null)) ?? null;
      if (sheet) { minor = true; diffs.push(`El full de preus es diu «${sheet.name}» (la plantilla esperava el patró ${def.sheet.pattern}).`); }
    }
  }
  if (!sheet) return { sheet: null, compatibility: { status: "incompatible", differences: [`No hi ha cap full compatible (s'esperava ${def.sheet.example}).`] }, anchors: {} };
  const anchors: Record<string, number | null> = {};
  for (const b of def.blocks) {
    const r = findAnchor(sheet, b);
    anchors[b.id] = r;
    if (r == null) { if (!b.excluded) diffs.push(`No es troba el bloc «${b.title}» (columna ${b.anchor.col}).`); continue; }
    for (const e of b.expected) {
      const got = norm(text(sheet, r + e.dr, colIdx(e.col)));
      if (got !== e.text) diffs.push(`«${b.title}»: a ${e.col}${r + e.dr + 1} s'esperava «${e.text}» i hi ha «${got || "(buit)"}».`);
    }
  }
  // blocs nous que la plantilla no coneix
  const known = new Set(Object.values(anchors).filter((x) => x != null));
  for (let r = 0; r < sheet.rows; r++) {
    if (known.has(r) || !periodRuns(sheet, r + 3).length) continue;
    const t = text(sheet, r, 2);
    if (t && /^(plan|contrato|tarifa)/i.test(t.trim()) && !def.blocks.some((b) => norm(t).startsWith(b.anchor.text))) { minor = true; diffs.push(`Bloc nou no previst a la plantilla: «${t.trim()}» (fila ${r + 1}).`); }
  }
  const hard = diffs.some((d) => /No es troba|s'esperava/.test(d));
  return { sheet, compatibility: { status: hard ? "incompatible" : minor || diffs.length ? "canvis_menors" : "compatible", differences: diffs }, anchors };
}
function findAnchor(g: SheetGrid, b: BlockDef): number | null {
  const c = colIdx(b.anchor.col);
  for (let r = 0; r < g.rows; r++) if (norm(text(g, r, c)).startsWith(b.anchor.text)) return r;
  return null;
}

function readNum(g: SheetGrid, r: number, col: string | null): ReadValue | null {
  if (!col) return null;
  const c = colIdx(col);
  const x = cell(g, r, c);
  const a = addr(g, r, c);
  if (!x) return { v: null, cell: a };
  if (x.t === "e") return { v: null, cell: a, error: `Error ${x.v} (no és zero)` };
  if (x.t === "n") return { v: x.v as number, cell: a };
  const n = Number(String(x.v).replace(",", "."));
  return Number.isFinite(n) && String(x.v).trim() !== "" ? { v: n, cell: a } : { v: null, cell: a, error: `Text «${String(x.v).slice(0, 30)}» on s'esperava un número` };
}

/** Aplica la plantilla al document. Si l'estructura és incompatible, NO llegeix preus (cal revisar la plantilla). */
export function applyTemplate(wb: WorkbookGrid, def: TemplateDef, opts: { force?: boolean; sheet?: string | null; extraRules?: ReadingRule[]; reference?: { from: string; to: string } } = {}): ReadResult {
  if (def.layout === "taula" && def.table) return applyTable(wb, def, opts);
  const st = checkStructure(wb, def);
  const issues: Issue[] = [];
  const empty: ReadResult = { sheet: st.sheet?.name ?? "", compatibility: st.compatibility, products: [], services: [], issues, validity: { label: null, month: null, version: null, from: null, logEntry: null }, blocks: def.blocks.map((b) => ({ id: b.id, title: b.title, found: st.anchors[b.id] != null, row: st.anchors[b.id] != null ? st.anchors[b.id]! + 1 : null, rows: 0, excluded: b.excluded })), stats: { fields: 0, validated: 0, errors: 0 } };
  if (!st.sheet) { issues.push({ level: "critica", text: "No s'ha trobat el full de preus." }); return empty; }
  if (st.compatibility.status === "incompatible" && !opts.force) {
    issues.push({ level: "critica", text: "S'ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura." });
    return empty;
  }
  const g = st.sheet;
  const products: Product[] = [];
  const services: Service[] = [];
  let fields = 0, validated = 0, errors = 0;
  for (const b of def.blocks) {
    const a = st.anchors[b.id];
    const info = empty.blocks.find((x) => x.id === b.id)!;
    if (a == null || b.excluded) continue;
    const keyCols = [b.cols.code, b.cols.tariff, b.cols.name].filter(Boolean).map((c) => colIdx(c!));
    const rows = dataRows(g, a + b.dataOffset, keyCols.length ? keyCols : [2]);
    info.rows = rows.length;
    if (b.kind === "serveis") {
      for (const r of rows) {
        const name = text(g, r, colIdx(b.cols.name ?? "C")).trim();
        const price = readNum(g, r, b.cols.price);
        if (!name || !price) continue;
        services.push({ name, price, unit: b.units.price });
      }
      continue;
    }
    for (const r of rows) {
      const code = b.cols.code ? String(cell(g, r, colIdx(b.cols.code))?.v ?? "") || null : null;
      const productCode = b.cols.productCode ? String(cell(g, r, colIdx(b.cols.productCode))?.v ?? "") || null : null;
      const ov = b.rowOverrides[code ?? ""] ?? b.rowOverrides[String(r + 1)] ?? {};
      if (ov.excluded) continue;
      const tariffRaw = b.cols.tariff ? text(g, r, colIdx(b.cols.tariff)).trim() || null : null;
      const name = (b.cols.name ? text(g, r, colIdx(b.cols.name)) : "").replace(/\s+/g, " ").trim() || b.title;
      const cons = readNum(g, r, b.cols.consumptionMax);
      const power = b.power.map((c) => readNum(g, r, c)!);
      const fixedTerm = readNum(g, r, b.cols.fixedTerm);
      const energyType = ov.energyType ?? b.energyType;
      for (const v of b.variants) {
        const energy = v.energyCols.map((c) => readNum(g, r, c)!);
        const vcode = v.codeCol ? String(cell(g, r, colIdx(v.codeCol))?.v ?? "") || null : null;
        const w: string[] = [];
        const all = [...power, ...energy, ...(fixedTerm ? [fixedTerm] : [])];
        // camps = cel·les amb contingut (les buides són «sense dada», no compten); validats = número dins de rang
        for (const x of all) {
          if (x.error) { fields++; errors++; w.push(`${x.cell}: ${x.error}`); continue; }
          if (x.v == null) continue;
          fields++;
          const isEnergy = energy.includes(x);
          if (x.v >= 0 && (!isEnergy || (x.v > 0 && x.v <= 2))) validated++;
        }
        if (energy.every((x) => x.v == null)) { if (energy.some((x) => x.error)) issues.push({ level: "critica", text: `«${name}» (${v.label}): preus amb error a ${energy.find((x) => x.error)!.cell}.`, cell: energy[0].cell }); continue; }
        // coherència: preus d'energia en els primers períodes o, si no, avís (no es mouen de columna)
        const firstFilled = energy.findIndex((x) => x.v != null);
        if (!b.singlePrice && firstFilled > 0) w.push(`Hi ha preus a partir de P${firstFilled + 1} però no a P1: comprova les columnes (${energy[0].cell}).`);
        for (const x of energy) if (x.v != null && (x.v <= 0 || x.v > 2)) w.push(`${x.cell}: ${x.v} €/kWh fora del rang habitual`);
        const disc = readNum(g, r, v.discountCol);
        const adj = readNum(g, r, v.adjustCol);
        if (adj?.v != null) w.push(`${adj.cell}: valor ${adj.v} sense identificar al costat de la variant ${v.label} (possible descompte o ajust); no s'aplica.`);
        products.push({
          key: `${vcode ?? code ?? `${productCode}-${tariffRaw}`}|${v.label}`, blockId: b.id, block: b.title, row: r + 1, energyType, classification: b.classification, singlePrice: b.singlePrice,
          code: vcode ?? code, productCode, tariff: normTariff(tariffRaw ?? code), tariffRaw, name, variant: v.label,
          consumptionMax: cons?.v != null && cons.v < 9e9 ? cons.v : null, power, powerUnit: b.units.power, energy, energyUnit: v.energyUnit,
          fixedTerm, fixedTermUnit: b.units.fixedTerm, discount: disc?.v != null ? disc : null, discountLabel: v.discountLabel, margin: readNum(g, r, v.marginCol), adjust: adj?.v != null ? adj : null, warnings: w,
        });
      }
    }
  }
  for (const d of st.compatibility.differences) issues.push({ level: st.compatibility.status === "incompatible" ? "critica" : "avis", text: d });
  for (const b of def.blocks) if (!b.excluded && b.classification === "pendent") issues.push({ level: "avis", text: `«${b.title}»: classificació PENDENT (${b.classificationNote ?? "cal confirmar-la"}).` });
  // vigència
  let month: string | null = null, version: string | null = null, label: string | null = null;
  if (def.validity.sheetNamePattern) { const m = g.name.match(new RegExp(def.validity.sheetNamePattern)); if (m) { month = MONTHS[m[1]] ? `20${m[2]}-${MONTHS[m[1]]}` : null; version = m[3]; label = `${m[1]} 20${m[2]} · versió ${m[3]}`; } }
  let from: string | null = null, logEntry: string | null = null;
  const lg = def.validity.logSheet ? wb.sheets.find((s) => s.name === def.validity.logSheet) : null;
  if (lg) for (let r = 0; r < lg.rows; r++) { const d = text(lg, r, 1); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!from || d >= from)) { from = d; logEntry = text(lg, r, 3).trim() || null; } }
  return { ...empty, products, services, issues, validity: { label, month, version, from, logEntry }, stats: { fields, validated, errors } };
}

/* ======================================================================= comprovacions per verificar */

export interface TemplateCheck { id: string; label: string; ok: boolean; detail: string }
/** Requisits per poder marcar una plantilla com a VERIFICADA (la confiança de la IA no n'és cap). */
export function templateChecks(def: TemplateDef, read: ReadResult | null): TemplateCheck[] {
  if (def.layout === "taula") return tableChecks(def, read);
  const active = def.blocks.filter((b) => !b.excluded && b.kind === "productes");
  const p = read?.products ?? [];
  const pend = active.filter((b) => b.classification === "pendent");
  const idx = active.filter((b) => b.classification === "indexada" || b.classification === "mixta");
  const crit = read?.issues.filter((i) => i.level === "critica") ?? [];
  const noUnits = active.filter((b) => (b.power.length && !b.units.power) || (b.energyType === "gas" && b.cols.fixedTerm && !b.units.fixedTerm));
  return [
    { id: "lectura", label: "Prova amb un document real", ok: !!read && read.compatibility.status !== "incompatible" && p.length > 0, detail: read ? `${read.sheet}: ${p.length} productes, estructura ${read.compatibility.status.replace("_", " ")}` : "Encara no s'ha provat amb cap document" },
    { id: "productes", label: "Productes identificats", ok: p.length > 0 && p.every((x) => x.name && (x.tariff || x.energyType === "gas")), detail: `${p.length} productes; sense peatge: ${p.filter((x) => !x.tariff).length}` },
    { id: "preus", label: "Preus de potència i energia comprovats amb les cel·les", ok: !!read && read.stats.errors === 0 && read.stats.validated > 0 && read.stats.validated === read.stats.fields, detail: read ? `${read.stats.validated} de ${read.stats.fields} valors comprovats amb la cel·la i dins de rang; ${read.stats.errors} amb error` : "—" },
    { id: "classificacio", label: "Tarifes FIXES / INDEXADES / MIXTES diferenciades", ok: !pend.length, detail: pend.length ? `Pendents: ${pend.map((b) => b.title).join(", ")}` : "Tots els blocs classificats" },
    { id: "variants", label: "Variants comercials identificades", ok: active.every((b) => b.variants.length > 0 && b.variants.every((v) => v.label)), detail: active.map((b) => `${b.title}: ${b.variants.map((v) => v.label).join("/") || "cap"}`).join(" · ") },
    { id: "unitats", label: "Unitats originals conservades", ok: !noUnits.length, detail: noUnits.length ? `Sense unitat: ${noUnits.map((b) => b.title).join(", ")}` : "Unitats del document registrades" },
    { id: "formules", label: "Fórmules indexades reconegudes", ok: idx.every((b) => b.variants.some((v) => v.marginCol)), detail: idx.length ? `${idx.length} blocs indexats/mixtos` : "No n'hi ha (no aplica)" },
    { id: "trams", label: "Trams de potència i consum comprovats", ok: active.every((b) => !!b.cols.tariff || !!b.cols.consumptionMax), detail: "Peatge i límit de consum de cada bloc" },
    { id: "errors", label: "Sense errors crítics pendents", ok: !!read && !crit.length, detail: crit.length ? crit.slice(0, 3).map((x) => x.text).join(" · ") : "Cap" },
  ];
}
export const validatedPct = (read: ReadResult | null) => (read && read.stats.fields ? Math.round((read.stats.validated / read.stats.fields) * 1000) / 10 : 0);

/* ======================================================================= correccions (editor i xat) */

export type TemplateOp =
  | { op: "setPower"; block: string; cols: string[]; unit?: string | null }
  | { op: "setVariantEnergy"; block: string; variant: string; cols: string[] }
  | { op: "addVariant"; block: string; variant: string; cols: string[]; codeCol?: string | null }
  | { op: "renameVariant"; block: string; from: string; to: string }
  | { op: "setClassification"; block: string; value: Classification; singlePrice?: boolean; note?: string | null }
  | { op: "setColumn"; block: string; field: keyof BlockDef["cols"]; col: string | null }
  | { op: "setMargin"; block: string; variant: string; col: string | null }
  | { op: "setDiscount"; block: string; variant: string; col: string | null; label?: string | null }
  | { op: "rowEnergyType"; block: string; key: string; value: "luz" | "gas" }
  | { op: "excludeBlock"; block: string; value: boolean }
  | { op: "excludeRow"; block: string; key: string }
  | { op: "emptyIsNull" };

/** Aplica correccions sobre una còpia de la plantilla (la definició original no es toca). */
export function applyOps(def: TemplateDef, ops: TemplateOp[]): TemplateDef {
  const d: TemplateDef = JSON.parse(JSON.stringify(def));
  for (const o of ops) {
    if (o.op === "emptyIsNull") { d.options.emptyIsNull = true; continue; }
    const b = d.blocks.find((x) => x.id === o.block);
    if (!b) continue;
    const v = "variant" in o ? b.variants.find((x) => x.label === o.variant) : undefined;
    switch (o.op) {
      case "setPower": b.power = o.cols; if (o.unit !== undefined) b.units.power = o.unit; break;
      case "setVariantEnergy": if (v) v.energyCols = o.cols; else b.variants.push({ label: o.variant, letter: null, codeCol: null, energyCols: o.cols, energyUnit: "€/kWh", discountCol: null, discountLabel: null, marginCol: null, adjustCol: null }); break;
      case "addVariant": if (!v) b.variants.push({ label: o.variant, letter: null, codeCol: o.codeCol ?? null, energyCols: o.cols, energyUnit: "€/kWh", discountCol: null, discountLabel: null, marginCol: null, adjustCol: null }); break;
      case "renameVariant": { const x = b.variants.find((y) => y.label === o.from); if (x) x.label = o.to; break; }
      case "setClassification": b.classification = o.value; if (o.singlePrice !== undefined) b.singlePrice = o.singlePrice; b.classificationNote = o.note ?? `Classificació confirmada: ${CLASSIFICATION_LABEL[o.value]}`; break;
      case "setColumn": b.cols[o.field] = o.col; break;
      case "setMargin": if (v) v.marginCol = o.col; break;
      case "setDiscount": if (v) { v.discountCol = o.col; if (o.label !== undefined) v.discountLabel = o.label; } break;
      case "rowEnergyType": b.rowOverrides[o.key] = { ...(b.rowOverrides[o.key] ?? {}), energyType: o.value }; break;
      case "excludeBlock": b.excluded = o.value; break;
      case "excludeRow": b.rowOverrides[o.key] = { ...(b.rowOverrides[o.key] ?? {}), excluded: true }; break;
    }
  }
  return d;
}
export function describeOp(o: TemplateOp, def: TemplateDef): string {
  const t = (id: string) => def.blocks.find((b) => b.id === id)?.title ?? id;
  switch (o.op) {
    case "setPower": return `«${t(o.block)}»: potència P1–P${o.cols.length} a les columnes ${o.cols[0]}–${o.cols[o.cols.length - 1]}`;
    case "setVariantEnergy": return `«${t(o.block)}»: energia de la variant ${o.variant} a ${o.cols.join(", ")}`;
    case "addVariant": return `«${t(o.block)}»: variant nova ${o.variant} (${o.cols.join(", ")})`;
    case "renameVariant": return `«${t(o.block)}»: la variant ${o.from} és ${o.to}`;
    case "setClassification": return `«${t(o.block)}»: ${CLASSIFICATION_LABEL[o.value]}${o.singlePrice ? " (preu únic)" : ""}`;
    case "setColumn": return `«${t(o.block)}»: ${o.field} → ${o.col ?? "cap"}`;
    case "setMargin": return `«${t(o.block)}»: marge de la variant ${o.variant} a ${o.col}`;
    case "setDiscount": return `«${t(o.block)}»: descompte de la variant ${o.variant} a ${o.col}`;
    case "rowEnergyType": return `«${t(o.block)}»: la fila ${o.key} és de ${o.value === "gas" ? "gas" : "llum"}`;
    case "excludeBlock": return `«${t(o.block)}»: ${o.value ? "no s'importa" : "s'importa"}`;
    case "excludeRow": return `«${t(o.block)}»: la fila ${o.key} no s'importa`;
    case "emptyIsNull": return "Les cel·les buides no són zeros (sense dada)";
  }
}

/** Interpreta una instrucció del xat d'ensenyament (català o castellà) sobre el bloc i la selecció actuals. */
export function parseTeaching(msg: string, ctx: { def: TemplateDef; block: string | null; cols: string[]; rowKey: string | null }): TemplateOp[] {
  const m = msg.trim();
  const n = norm(m);
  const b = ctx.def.blocks.find((x) => x.id === ctx.block) ?? null;
  const range = m.match(/\b([A-Z]{1,2})\s*(?:-|–|a|fins a|al|hasta)\s*([A-Z]{1,2})\b/);
  const single = m.match(/\bcolumna\s+([A-Z]{1,2})\b/i);
  const expand = (a: string, z: string) => { const out: string[] = []; for (let i = colIdx(a); i <= colIdx(z); i++) out.push(colName(i)); return out; };
  const cols = range ? expand(range[1], range[2]) : single ? [single[1].toUpperCase()] : ctx.cols;
  const vName = /\bsupra\b/.test(n) ? "SUPRA" : /\bone\b/.test(n) ? "ONE" : (n.match(/variant(?:e)?\s+([a-z0-9]{1,8})\b/)?.[1]?.toUpperCase() ?? null);
  const ops: TemplateOp[] = [];
  if (/buid|vacia|vacias|en blanc/.test(n) && /zero|cero/.test(n)) return [{ op: "emptyIsNull" }];
  if (!b) return [];
  if (/potencia/.test(n) && cols.length) return [{ op: "setPower", block: b.id, cols, unit: /dia/.test(n) ? "€/kW·día" : /mes/.test(n) ? "€/kW·mes" : /any|ano/.test(n) ? "€/kW·any" : b.units.power }];
  if (/marge|margen|fee/.test(n) && cols.length) return [{ op: "setMargin", block: b.id, variant: vName ?? b.variants[0]?.label ?? "Base", col: cols[0] }];
  if (/descompte|descuento|dto/.test(n) && cols.length) return [{ op: "setDiscount", block: b.id, variant: vName ?? b.variants[0]?.label ?? "Base", col: cols[0] }];
  if (/(no s'importa|no importar|ignora|exclou)/.test(n)) return ctx.rowKey && /fila/.test(n) ? [{ op: "excludeRow", block: b.id, key: ctx.rowKey }] : [{ op: "excludeBlock", block: b.id, value: true }];
  if (/fila/.test(n) && /gas/.test(n) && ctx.rowKey) return [{ op: "rowEnergyType", block: b.id, key: ctx.rowKey, value: "gas" }];
  const cls: Classification | null = /\bmixt/.test(n) ? "mixta" : /\bindexa/.test(n) ? "indexada" : /\bfix|\bfij/.test(n) ? "fixa" : /pendent|pendiente/.test(n) ? "pendent" : null;
  if (cls && /(producte|producto|bloc|tarifa|aquest|aquesta|es |és )/.test(n) && !/energia/.test(n)) {
    ops.push({ op: "setClassification", block: b.id, value: cls, singlePrice: /24 ?h|preu unic|precio unico/.test(n) ? true : undefined, note: `Ensenyat al xat: «${m.slice(0, 160)}»` });
    return ops;
  }
  if (/energ/.test(n) && cols.length) {
    const target = vName ?? (ctx.cols.length ? b.variants.find((v) => v.energyCols.some((c) => ctx.cols.includes(c)))?.label : null) ?? "Base";
    return b.variants.some((v) => v.label === target) ? [{ op: "setVariantEnergy", block: b.id, variant: target, cols }] : [{ op: "addVariant", block: b.id, variant: target, cols }];
  }
  if (/variant|variante/.test(n) && vName && ctx.cols.length) {
    const cur = b.variants.find((v) => v.energyCols.some((c) => ctx.cols.includes(c)));
    if (cur && cur.label !== vName) return [{ op: "renameVariant", block: b.id, from: cur.label, to: vName }];
  }
  return ops;
}

/* ======================================================================= comparació entre lectures */

export interface ReadDiff { added: Product[]; removed: Product[]; changed: { key: string; name: string; variant: string; fields: { field: string; before: number | string | null; after: number | string | null }[] }[]; validity: { before: string | null; after: string | null } | null }
export function diffReads(prev: { products: Product[]; validity?: ReadResult["validity"] } | null, next: ReadResult): ReadDiff {
  const before = new Map((prev?.products ?? []).map((p) => [p.key, p]));
  const after = new Map(next.products.map((p) => [p.key, p]));
  const changed: ReadDiff["changed"] = [];
  for (const [k, p] of after) {
    const q = before.get(k);
    if (!q) continue;
    const fields: ReadDiff["changed"][number]["fields"] = [];
    p.energy.forEach((x, i) => { if ((q.energy[i]?.v ?? null) !== x.v) fields.push({ field: `energia P${i + 1}`, before: q.energy[i]?.v ?? null, after: x.v }); });
    p.power.forEach((x, i) => { if ((q.power[i]?.v ?? null) !== x.v) fields.push({ field: `potència P${i + 1}`, before: q.power[i]?.v ?? null, after: x.v }); });
    if ((q.fixedTerm?.v ?? null) !== (p.fixedTerm?.v ?? null)) fields.push({ field: "terme fix", before: q.fixedTerm?.v ?? null, after: p.fixedTerm?.v ?? null });
    if ((q.margin?.v ?? null) !== (p.margin?.v ?? null)) fields.push({ field: "marge", before: q.margin?.v ?? null, after: p.margin?.v ?? null });
    if (q.classification !== p.classification) fields.push({ field: "tipus (fixa/indexada)", before: q.classification, after: p.classification });
    if (q.consumptionMax !== p.consumptionMax) fields.push({ field: "límit de consum", before: q.consumptionMax, after: p.consumptionMax });
    if (fields.length) changed.push({ key: k, name: p.name, variant: p.variant, fields });
  }
  const vb = prev?.validity?.label ?? prev?.validity?.from ?? null, va = next.validity.label ?? next.validity.from ?? null;
  return { added: [...after.values()].filter((p) => !before.has(p.key)), removed: [...before.values()].filter((p) => !after.has(p.key)), changed, validity: vb !== va ? { before: vb, after: va } : null };
}

/* ======================================================================= lectura → ofertes del catàleg */


const POWER_UNIT: Record<string, PowerUnit> = { eur_kw_dia: "eur_kw_dia", eur_kw_mes: "eur_kw_mes", eur_kw_any: "eur_kw_any" };
/**
 * Converteix els productes llegits en versions del catàleg (sempre ESBORRANY: s'activen després de revisar-les).
 * Els preus ja porten els descomptes de cada variant; no s'hi afegeix cap descompte ni SAS.
 */
export function productsToOffers(read: ReadResult, def: TemplateDef, meta: { templateId: string | null; version: number; fileName: string; today?: string }): { offer: OfferVersion; product: Product; warnings: string[] }[] {
  if (def.layout === "taula") return tableProductsToOffers(read, def, meta);
  const out: { offer: OfferVersion; product: Product; warnings: string[] }[] = [];
  const prevMax = new Map<string, number>();
  for (const p of read.products) {
    const w = [...p.warnings];
    const gas = p.energyType === "gas";
    const e = p.energy.map((x) => x.v);
    const tierKey = `${p.blockId}|${p.variant}`;
    const minKwh = gas ? prevMax.get(tierKey) ?? null : null;
    if (gas && p.consumptionMax != null) prevMax.set(tierKey, p.consumptionMax);

    const contractType = p.classification === "indexada" ? "indexat" : p.classification === "mixta" ? "mixt" : gas || p.singlePrice ? "fix24h" : "periodes";
    if (p.classification === "pendent") w.push("Classificació PENDENT (fixa / indexada): no es pot activar fins que es confirmi.");
    if (p.classification === "indexada" || p.classification === "mixta") w.push("Oferta indexada: cal afegir la fórmula contractual (marge, pèrdues, peatges) per poder-la comparar.");
    const pu = POWER_UNIT[powerUnitCode(p.powerUnit) ?? ""] ?? "eur_kw_dia";
    if (!gas && p.power.length && !powerUnitCode(p.powerUnit)) w.push(`Unitat de potència no reconeguda («${p.powerUnit}»).`);
    const cells = [...p.power, ...p.energy, ...(p.fixedTerm ? [p.fixedTerm] : [])].filter((x) => x.v != null).map((x) => x.cell);
    const offer: OfferVersion = {
      ...emptySheet(),
      id: crypto.randomUUID(),
      supplierId: `sup:${slug(def.supplier)}`,
      supplierName: def.supplier,
      productId: "",
      productName: `${p.name} · ${p.variant}`.slice(0, 160),
      version: 1,
      energyType: gas ? "gas" : "luz",
      accessTariff: p.tariff ?? p.tariffRaw ?? "",
      segments: ["pyme"],
      contractType,
      energy: gas || contractType === "fix24h" ? Array(6).fill(null) : Array.from({ length: 6 }, (_, i) => e[i] ?? null),
      energy24h: gas || contractType === "fix24h" ? e.find((x) => x != null) ?? null : null,
      power: gas ? Array(6).fill(null) : Array.from({ length: 6 }, (_, i) => p.power[i]?.v ?? null),
      powerUnit: pu,
      gasFixedEurDay: null,                                     // es posa a normalizeOfferUnits (amb conversió d'unitats)
      taxTreatment: "sense_impostos",
      sas: { mode: "inclos", eurKwh: null },
      fees: [], discounts: [],
      permanenceMonths: null, penalty: null, durationMonths: null, priceGuaranteeMonths: null,
      eligibility: { minKwh, maxKwh: p.consumptionMax, minKw: null, maxKw: null, territories: null, notes: null },
      validFrom: read.validity.from, validTo: null,
      source: `Plantilla «${def.name}» v${meta.version} · ${meta.fileName.slice(0, 120)} · ${read.sheet} fila ${p.row}`.slice(0, 300),
      publishedAt: meta.today ?? new Date().toISOString().slice(0, 10),
      status: "esborrany",
      conditions: [
        `Tipus: ${CLASSIFICATION_LABEL[p.classification]}${p.singlePrice && !gas ? " · preu únic 24 h" : ""}. Variant ${p.variant}${p.code ? ` (codi ${p.code})` : ""}.`,
        p.discountLabel ? `Descompte de la variant (ja inclòs al preu): ${p.discountLabel}${p.discount?.v != null ? ` [${p.discount.v} a ${p.discount.cell}]` : ""}.` : null,
        p.consumptionMax != null ? `Consum fins a ${p.consumptionMax.toLocaleString("ca-ES")} kWh/any.` : null,
        read.validity.label ? `Vigència del document: ${read.validity.label}${read.validity.from ? ` (des de ${read.validity.from})` : ""}.` : null,
        `Cel·les d'origen: ${cells.slice(0, 14).join(", ")}${cells.length > 14 ? "…" : ""}.`,
        ...w.map((x) => `Avís: ${x}`),
      ].filter(Boolean).join("\n").slice(0, 4000),
      origin: "excel",
      template: { templateId: meta.templateId, name: def.name, version: meta.version, classification: p.classification, variant: p.variant, code: p.code, origin: { file: meta.fileName.slice(0, 300), sheet: read.sheet ?? "", row: p.row, cells: cells.slice(0, 40) } },
    };
    // Unitats: potència → €/kW·dia, energia → €/kWh i terme fix del gas → €/client·dia (conversió determinista, conserva l'original)
    const n = normalizeOfferUnits(offer, { energyUnit: p.energyUnit || null, gasFixed: gas && p.fixedTerm?.v != null ? { value: p.fixedTerm.v, unit: p.fixedTermUnit ?? null } : null });
    w.push(...n.problems);
    if (n.conversions.length || n.problems.length) n.offer.conditions = [n.offer.conditions, ...n.conversions.map((x) => `Conversió: ${x}`), ...n.problems.map((x) => `Avís: ${x}`)].filter(Boolean).join("\n").slice(0, 4000);
    out.push({ offer: n.offer, product: p, warnings: w });
  }
  return out;
}
