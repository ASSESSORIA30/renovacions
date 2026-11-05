/**
 * EXTRACTES BANCARIS (lògica pura): lectura i proposta de conciliació amb les factures emeses.
 *  - Formats: Norma 43 (AEB/CSB, el fitxer estàndard dels bancs espanyols) i Excel/CSV amb capçaleres
 *    (Fecha / F. valor / Concepto / Importe / Saldo, o Cargo i Abono per separat).
 *  - Només els ingressos (imports positius) poden cobrar factures. Res es concilia sol: es proposa i algú ho confirma.
 *  - Proposta: import exacte del pendent + número de factura o nom/CIF del client al concepte; també combinacions
 *    de 2 o 3 factures del mateix client que sumen l'ingrés.
 */
import { D, money } from "./commissions";
import { fnv, parseDate, parseDecimal, type Cell, type WorkbookGrid } from "./settlement-reader";

export interface BankMovement { opDate: string; valueDate: string | null; amount: string; concept: string; reference: string | null; balance: string | null; account: string | null; hash: string }
export interface BankRead { format: "norma43" | "taula"; account: string | null; from: string | null; to: string | null; movements: BankMovement[]; errors: string[]; warnings: string[] }

const yymmdd = (s: string) => (/^\d{6}$/.test(s) ? `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}` : null);
const hashOf = (account: string | null, m: Omit<BankMovement, "hash" | "account">, seq: number) => fnv([account ?? "", m.opDate, m.valueDate ?? "", m.amount, m.concept.toUpperCase().replace(/\s+/g, " "), m.reference ?? "", m.balance ?? "", seq].join("|"));

/** Norma 43: registres de 80 caràcters (11 capçalera, 22 moviment, 23 concepte, 33 final de compte, 88 final). */
export function parseNorma43(text: string): BankRead {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter(Boolean);
  const out: BankRead = { format: "norma43", account: null, from: null, to: null, movements: [], errors: [], warnings: [] };
  let cur: Omit<BankMovement, "hash"> | null = null;
  const seen = new Map<string, number>();
  const push = () => {
    if (!cur) return;
    const k = [cur.opDate, cur.amount, cur.concept].join("|");
    const n = (seen.get(k) ?? 0) + 1; seen.set(k, n);
    out.movements.push({ ...cur, concept: cur.concept.trim().replace(/\s+/g, " "), hash: hashOf(cur.account, cur, n) });
    cur = null;
  };
  for (const l of lines) {
    const t = l.slice(0, 2);
    if (t === "11") {
      push();
      out.account = `${l.slice(2, 6)}${l.slice(6, 10)}${l.slice(10, 20)}`;
      out.from = yymmdd(l.slice(20, 26)); out.to = yymmdd(l.slice(26, 32));
    } else if (t === "22") {
      push();
      const sign = l[27] === "1" ? -1 : 1;
      const cents = l.slice(28, 42);
      if (!/^\d{14}$/.test(cents)) { out.errors.push(`Moviment il·legible: «${l.slice(0, 42)}»`); continue; }
      const ref1 = l.slice(52, 64).trim(), ref2 = l.slice(64, 80).trim();
      cur = { opDate: yymmdd(l.slice(10, 16)) ?? "", valueDate: yymmdd(l.slice(16, 22)), amount: money(D(cents).div(100).times(sign)), concept: [ref2, ref1].filter(Boolean).join(" "), reference: l.slice(42, 52).trim().replace(/^0+$/, "") || ref1 || null, balance: null, account: out.account };
    } else if (t === "23" && cur) {
      cur.concept = `${cur.concept} ${l.slice(4, 42).trim()} ${l.slice(42, 80).trim()}`;
    } else if (t === "33") push();
  }
  push();
  if (!out.movements.length) out.errors.push("No s'ha trobat cap moviment (registres 22) al fitxer Norma 43.");
  return out;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const txt = (c: Cell | undefined) => (c == null ? "" : String(c).trim());
type Col = "date" | "value" | "concept" | "extra" | "amount" | "debit" | "credit" | "balance" | "ref";
const HEAD: [Col, RegExp][] = [
  ["value", /^(f |fecha |data )?valor$|^fecha valor$|^data valor$/],
  ["date", /^(fecha|data|f)( de)?( operacion| operacio| oper| movimiento| moviment)?$/],
  ["concept", /^(concepto|concepte|descripcion|descripcio|movimiento|moviment|detalle|detall|concepto comun)$/],
  ["extra", /^(mas datos|mes dades|observaciones|observacions|concepto propio|informacion adicional|beneficiario|ordenante)$/],
  ["amount", /^(importe|import|cantidad|quantitat|importe eur|import eur)$/],
  ["debit", /^(cargo|carrec|debe|deure|cargos)$/],
  ["credit", /^(abono|abonament|haber|haver|abonos)$/],
  ["balance", /^(saldo|saldo disponible|saldo contable)$/],
  ["ref", /^(referencia|referencia 1|ref|numero documento|n documento)$/],
];

/** Excel o CSV exportat de la banca en línia: es busca la fila de capçaleres (data + import o càrrec/abonament). */
export function parseBankGrid(wb: WorkbookGrid): BankRead {
  const out: BankRead = { format: "taula", account: null, from: null, to: null, movements: [], errors: [], warnings: [] };
  for (const sh of wb.sheets) {
    let head: { at: number; map: Partial<Record<Col, number>> } | null = null;
    for (let r = 0; r < Math.min(sh.rows.length, 30) && !head; r++) {
      const map: Partial<Record<Col, number>> = {};
      (sh.rows[r] ?? []).forEach((c, i) => { const h = fold(txt(c)); for (const [k, re] of HEAD) if (re.test(h) && map[k] == null) { map[k] = i; break; } });
      if (map.date != null && (map.amount != null || map.credit != null)) head = { at: r, map };
      // IBAN a les primeres files
      for (const c of sh.rows[r] ?? []) { const m = txt(c).replace(/\s/g, "").match(/ES\d{22}/); if (m && !out.account) out.account = m[0]; }
    }
    if (!head) continue;
    const m = head.map;
    const seen = new Map<string, number>();
    for (let r = head.at + 1; r < sh.rows.length; r++) {
      const row = sh.rows[r] ?? [];
      const date = parseDate(row[m.date!]);
      if (!date) continue;
      let amount: string | null = null;
      if (m.amount != null) amount = parseDecimal(row[m.amount]);
      else {
        const cr = parseDecimal(row[m.credit!]), db = m.debit != null ? parseDecimal(row[m.debit]) : null;
        amount = cr != null && !D(cr).isZero() ? D(cr).abs().toString() : db != null ? D(db).abs().neg().toString() : null;
      }
      if (amount == null) continue;
      const concept = [m.concept != null ? txt(row[m.concept]) : "", m.extra != null ? txt(row[m.extra]) : ""].filter(Boolean).join(" · ");
      const mv = { opDate: date, valueDate: m.value != null ? parseDate(row[m.value]) : null, amount: money(amount), concept, reference: m.ref != null ? txt(row[m.ref]) || null : null, balance: m.balance != null ? (parseDecimal(row[m.balance]) != null ? money(parseDecimal(row[m.balance])!) : null) : null, account: out.account };
      const k = [mv.opDate, mv.amount, mv.concept, mv.balance].join("|");
      const n = (seen.get(k) ?? 0) + 1; seen.set(k, n);
      out.movements.push({ ...mv, hash: hashOf(out.account, mv, n) });
    }
    break;
  }
  if (!out.movements.length) out.errors.push("No s'ha reconegut cap moviment. Cal una fila de capçaleres amb la data i l'import (o càrrec i abonament).");
  const ds = out.movements.map((x) => x.opDate).sort();
  out.from = ds[0] ?? null; out.to = ds[ds.length - 1] ?? null;
  return out;
}

/* ======================================================================= proposta de conciliació */

export interface OpenInvoice { id: string; invoice_no: string; issue_date: string; due_date: string | null; client_id: string; client_name: string; client_nif: string; pending: string; payment_unknown: boolean }
export interface Suggestion { invoices: { id: string; invoice_no: string; amount: string }[]; score: number; confidence: "alta" | "mitjana" | "baixa"; reasons: string[] }

const tokens = (s: string) => fold(s).split(" ").filter((w) => w.length >= 4 && !["sociedad", "limitada", "anonima", "energia", "assessoria", "transferencia", "factura", "recibo", "pago"].includes(w));
function mentions(concept: string, inv: OpenInvoice) {
  const c = fold(concept), raw = concept.toUpperCase().replace(/\s/g, "");
  const reasons: string[] = []; let score = 0;
  const [yy, nnn] = inv.invoice_no.replace(/^R/, "").split("-");
  if (new RegExp(`(^|[^0-9])${yy}[-/ .]?${nnn}([^0-9]|$)`).test(raw) || new RegExp(`(^|[^0-9])${nnn}[-/ .]${yy}([^0-9]|$)`).test(raw)) { score += 60; reasons.push(`El concepte esmenta la factura ${inv.invoice_no}`); }
  const nif = inv.client_nif.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (nif.length >= 8 && raw.includes(nif)) { score += 40; reasons.push("El concepte porta el CIF del client"); }
  else {
    const t = tokens(inv.client_name);
    const hit = t.filter((w) => c.includes(w));
    if (t.length && hit.length >= Math.min(2, t.length)) { score += 30; reasons.push(`El concepte esmenta «${hit.join(" ")}»`); }
    else if (hit.length) { score += 12; reasons.push(`Coincidència parcial del nom («${hit.join(" ")}»)`); }
  }
  return { score, reasons };
}

/** Propostes per a un ingrés: factures obertes amb el mateix import (o 2-3 del mateix client que el sumen). */
export function suggest(mv: Pick<BankMovement, "amount" | "concept" | "opDate">, open: OpenInvoice[]): Suggestion[] {
  if (D(mv.amount).lte(0)) return [];
  const eq = (a: string | ReturnType<typeof D>, b: string) => D(a).minus(b).abs().lte("0.01");
  const out: Suggestion[] = [];
  const before = open.filter((i) => i.issue_date <= mv.opDate);
  for (const inv of before) {
    if (!eq(inv.pending, mv.amount)) continue;
    const m = mentions(mv.concept, inv);
    let score = 40 + m.score;
    const reasons = [`Import exacte del pendent (${money(inv.pending)} €)`, ...m.reasons];
    if (inv.due_date) { const days = Math.abs((Date.parse(mv.opDate) - Date.parse(inv.due_date)) / 86_400_000); if (days <= 15) { score += 8; reasons.push("Data propera al venciment"); } }
    out.push({ invoices: [{ id: inv.id, invoice_no: inv.invoice_no, amount: money(inv.pending) }], score, confidence: "baixa", reasons });
  }
  // combinacions de 2 o 3 factures del mateix client (pagaments agrupats)
  const byClient = new Map<string, OpenInvoice[]>();
  for (const i of before) byClient.set(i.client_id, [...(byClient.get(i.client_id) ?? []), i]);
  for (const list of byClient.values()) {
    const l = list.slice(0, 12);
    for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) {
      const two = D(l[a].pending).plus(l[b].pending);
      if (eq(two, mv.amount)) out.push(combo([l[a], l[b]], mv.concept));
      for (let c = b + 1; c < l.length; c++) if (eq(two.plus(l[c].pending), mv.amount)) out.push(combo([l[a], l[b], l[c]], mv.concept));
    }
  }
  for (const s of out) s.confidence = s.score >= 90 ? "alta" : s.score >= 60 ? "mitjana" : "baixa";
  out.sort((x, y) => y.score - x.score);
  // si n'hi ha més d'una amb la mateixa puntuació màxima, cap no és «alta» (cal triar)
  if (out.length > 1 && out[0].score === out[1].score) for (const s of out) if (s.confidence === "alta") s.confidence = "mitjana";
  return out.slice(0, 5);
}
function combo(list: OpenInvoice[], concept: string): Suggestion {
  const ms = list.map((i) => mentions(concept, i));
  const named = ms.some((m) => m.score >= 30);
  return {
    invoices: list.map((i) => ({ id: i.id, invoice_no: i.invoice_no, amount: money(i.pending) })),
    score: 25 + Math.max(...ms.map((m) => m.score)), confidence: "baixa",
    reasons: [`La suma de ${list.length} factures de ${list[0].client_name} (${list.map((i) => i.invoice_no).join(" + ")}) coincideix amb l'ingrés`, ...(named ? ["El concepte esmenta el client"] : [])],
  };
}

/** Factures obertes que l'extracte no explica: vençudes i sense cap ingrés que hi encaixi. */
export function unpaidAnalysis(open: OpenInvoice[], coveredIds: Set<string>, to: string | null) {
  const ref = to ?? new Date().toISOString().slice(0, 10);
  return open.filter((i) => !coveredIds.has(i.id)).map((i) => ({
    ...i, overdue: !!i.due_date && i.due_date < ref, daysOverdue: i.due_date ? Math.max(0, Math.round((Date.parse(ref) - Date.parse(i.due_date)) / 86_400_000)) : 0,
  })).sort((a, b) => b.daysOverdue - a.daysOverdue || a.issue_date.localeCompare(b.issue_date));
}
