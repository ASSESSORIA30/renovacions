import "server-only";
/**
 * FACTURACIÓ PRÒPIA (servidor). Tot amb la sessió de l'usuari: la RLS (has_perm('facturacio', …)) i les funcions de la
 * migració 026 decideixen què es pot fer. Aquí es tornen a validar els permisos per donar missatges clars.
 *  - Numeració, emissió, cobraments i rectificatives: funcions transaccionals de la base de dades (mai des d'aquí).
 *  - Una liquidació es pot convertir en esborrany de factura: l'import surt del resum determinista (bill_statement_summary).
 */
import { z } from "zod";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { parseBankGrid, parseNorma43, suggest, unpaidAnalysis, type BankRead, type OpenInvoice } from "@/core/bank";
import { gridFromBytes } from "@/core/settlement-reader";
import { D, money } from "@/core/commissions";
import { DISPLAY_STATUS_LABEL, PAYMENT_METHODS, normName, proposalFromStatement, validTaxId, type DisplayStatus } from "@/core/billing";
import { buildInvoicePdf, type InvoicePdfInput } from "@/core/invoice-pdf";
import { HttpError } from "./supabase";
import { parse, type U } from "./crm";
import { finStaff, requirePerm } from "./permissions";

type PgError = { code?: string; message?: string } | null;
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no vàlida");
const num = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".").trim()).refine((v) => /^-?\d+(\.\d+)?$/.test(v), "Número no vàlid");
const opt = (max = 300) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const MIGRATION = "Falta aplicar la migració supabase/migrations/026_facturacio.sql a Supabase";
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

function fail(e: PgError, fallback = "No s'ha pogut desar"): never {
  const m = e?.message ?? "";
  if (e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST202" || /does not exist|schema cache|Could not find/i.test(m)) throw new HttpError(503, MIGRATION);
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) throw new HttpError(403, /No tens|no es pot|ja és emesa|Només|Una factura/i.test(m) ? m : "No tens permís per fer aquesta acció");
  if (e?.code === "23505") {
    if (/bill_clients_nif_uq/.test(m)) throw new HttpError(409, "Ja existeix un client de facturació amb aquest NIF/CIF");
    if (/bill_payments_idempotency/.test(m)) throw new HttpError(409, "Aquest cobrament ja està registrat (mateixa referència, import i data)");
    if (/ja s'ha facturat/.test(m)) throw new HttpError(409, m);
    throw new HttpError(409, "Registre duplicat");
  }
  if (e?.code === "23503") throw new HttpError(409, "Aquest registre té factures o dades relacionades: no es pot eliminar (arxiva'l)");
  if (e?.code === "23514" || e?.code === "P0002" || e?.code === "P0001") throw new HttpError(400, m || "Dades no vàlides");
  console.error("[facturacio]", e?.code, m.slice(0, 200));
  throw new HttpError(500, fallback);
}
const access = (u: U, action: "read" | "edit" | "approve" = "read") => requirePerm(u, "facturacio", action);

/* ======================================================================= panell */

type Row = { id: string; invoice_no: string | null; issue_date: string | null; due_date: string | null; client_id: string; client_name: string; client_nif: string; base: string; vat: string; total: string; paid: string; pending: string; status: string; display_status: DisplayStatus; kind: string; origin: string; payment_unknown: boolean; concept: string | null; period_label: string | null; needs_review: boolean; sent_at: string | null; series: string };
const LIST_COLS = "id,invoice_no,issue_date,due_date,client_id,client_name,client_nif,base,vat,total,paid,pending,status,display_status,kind,origin,payment_unknown,concept,period_label,needs_review,sent_at,series,created_at";

export async function dashboard(u: U, raw: Record<string, string>) {
  await access(u);
  const year = Number(raw.year) || new Date().getFullYear();
  const client = raw.client && uuid.safeParse(raw.client).success ? raw.client : null;
  let q = u.sb.from("bill_invoices_v").select(LIST_COLS).neq("status", "esborrany").gte("issue_date", `${year - 1}-01-01`).lte("issue_date", `${year}-12-31`);
  if (client) q = q.eq("client_id", client);
  const all = await q.limit(5000);
  if (all.error) fail(all.error);
  const rows = (all.data ?? []) as unknown as Row[];
  const cur = rows.filter((x) => x.issue_date?.startsWith(String(year)));
  const prev = rows.filter((x) => x.issue_date?.startsWith(String(year - 1)));
  const month = new Date().toISOString().slice(0, 7);
  const sum = (xs: Row[], k: "base" | "vat" | "total" | "paid" | "pending") => money(xs.reduce((s, x) => s.plus(x[k] ?? 0), D(0)));
  let oq = u.sb.from("bill_invoices_v").select("pending,display_status,due_date").in("display_status", ["pendent_cobrament", "parcialment_cobrada", "vencuda"]);
  if (client) oq = oq.eq("client_id", client);
  const open = await oq.limit(5000);
  if (open.error) fail(open.error);
  const opens = (open.data ?? []) as { pending: string; display_status: string }[];
  const overdue = opens.filter((x) => x.display_status === "vencuda");
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    return { month: m, current: Number(sum(cur.filter((x) => x.issue_date?.slice(5, 7) === m), "base")), previous: Number(sum(prev.filter((x) => x.issue_date?.slice(5, 7) === m), "base")) };
  });
  const byClient = new Map<string, { name: string; base: ReturnType<typeof D>; n: number }>();
  for (const x of cur) { const c = byClient.get(x.client_id) ?? { name: x.client_name, base: D(0), n: 0 }; c.base = c.base.plus(x.base); c.n++; byClient.set(x.client_id, c); }
  const [drafts, gaps, review, unknown] = await Promise.all([
    u.sb.from("bill_invoices").select("id", { count: "exact", head: true }).eq("status", "esborrany"),
    u.sb.from("bill_number_gaps").select("invoice_no,status,notes").eq("status", "pendent_verificar"),
    u.sb.from("bill_clients").select("id", { count: "exact", head: true }).eq("needs_review", true).eq("status", "actiu"),
    u.sb.from("bill_invoices").select("id", { count: "exact", head: true }).eq("payment_unknown", true),
  ]);
  const next = await u.sb.from("bill_series").select("last_number").eq("code", "ORD").eq("year", new Date().getFullYear()).maybeSingle();
  return {
    year,
    kpis: {
      month: sum(cur.filter((x) => x.issue_date?.startsWith(month)), "total"), year: sum(cur, "total"), base: sum(cur, "base"), vat: sum(cur, "vat"),
      pending: money(opens.reduce((s, x) => s.plus(x.pending), D(0))), paid: sum(cur, "paid"),
      overdue: overdue.length, overdueAmount: money(overdue.reduce((s, x) => s.plus(x.pending), D(0))),
      previousYear: sum(prev, "base"), count: cur.length,
    },
    months,
    topClients: [...byClient.entries()].map(([id, c]) => ({ id, name: c.name, base: money(c.base), n: c.n })).sort((a, b) => Number(b.base) - Number(a.base)).slice(0, 8),
    alerts: { drafts: drafts.count ?? 0, gaps: gaps.data ?? [], clientsToReview: review.count ?? 0, paymentUnknown: unknown.count ?? 0 },
    nextNumber: `${String(new Date().getFullYear() % 100).padStart(2, "0")}-${String((next.data?.last_number ?? 0) + 1).padStart(3, "0")}`,
  };
}

/* ======================================================================= llistat de factures */

export async function listInvoices(u: U, raw: Record<string, string>) {
  await access(u);
  const size = Math.min(500, Math.max(10, Number(raw.size) || 100));
  const page = Math.max(0, Number(raw.page) || 0);
  let q = u.sb.from("bill_invoices_v").select(LIST_COLS, { count: "exact" });
  const st = raw.status ?? "";
  if (st === "esborranys") q = q.eq("status", "esborrany");
  else if (st === "pendents") q = q.in("display_status", ["pendent_cobrament", "parcialment_cobrada", "vencuda"]);
  else if (st === "vencudes") q = q.eq("display_status", "vencuda");
  else if (st === "cobrades") q = q.eq("status", "cobrada");
  else if (st === "rectificatives") q = q.or("kind.eq.rectificativa,status.eq.rectificada");
  else if (st === "no_consta") q = q.eq("payment_unknown", true);
  else if (st === "emeses") q = q.neq("status", "esborrany");
  if (raw.client && uuid.safeParse(raw.client).success) q = q.eq("client_id", raw.client);
  if (raw.year && /^\d{4}$/.test(raw.year)) q = q.gte("issue_date", `${raw.year}-01-01`).lte("issue_date", `${raw.year}-12-31`);
  if (raw.from && day.safeParse(raw.from).success) q = q.gte("issue_date", raw.from);
  if (raw.to && day.safeParse(raw.to).success) q = q.lte("issue_date", raw.to);
  if (raw.min && !Number.isNaN(Number(raw.min))) q = q.gte("total", Number(raw.min));
  if (raw.max && !Number.isNaN(Number(raw.max))) q = q.lte("total", Number(raw.max));
  if (raw.period) q = q.ilike("period_label", `%${raw.period.replace(/[%_,()]/g, " ").trim()}%`);
  if (raw.q) {
    const s = raw.q.replace(/[%_,()]/g, " ").trim();
    if (s) q = q.or(`invoice_no.ilike.%${s}%,client_name.ilike.%${s}%,client_nif.ilike.%${s}%,concept.ilike.%${s}%`);
  }
  q = st === "esborranys" ? q.order("created_at", { ascending: false }) : q.order("issue_date", { ascending: false, nullsFirst: true }).order("invoice_no", { ascending: false });
  const r = await q.range(page * size, page * size + size - 1);
  if (r.error) fail(r.error);
  const rows = (r.data ?? []) as unknown as Row[];
  return { rows, total: r.count ?? rows.length, page, size, sums: { base: money(rows.reduce((s, x) => s.plus(x.base), D(0))), total: money(rows.reduce((s, x) => s.plus(x.total), D(0))), pending: money(rows.filter((x) => x.status !== "esborrany" && !x.payment_unknown).reduce((s, x) => s.plus(x.pending), D(0))) } };
}

/* ======================================================================= fitxa de factura */

export async function getInvoice(u: U, id: string) {
  await access(u);
  if (!uuid.safeParse(id).success) throw new HttpError(400, "Factura no vàlida");
  const r = await u.sb.from("bill_invoices_v").select("*").eq("id", id).maybeSingle();
  if (r.error) fail(r.error);
  if (!r.data) throw new HttpError(404, "Factura no trobada");
  const [lines, pays, mails, stm, events, rect, client, orig] = await Promise.all([
    u.sb.from("bill_invoice_lines").select("id,line_no,description,quantity,unit_price,vat_rate,vat_exemption,amount").eq("invoice_id", id).order("line_no"),
    u.sb.from("bill_payments").select("id,amount,paid_at,method,reference,notes,created_at").eq("invoice_id", id).order("paid_at"),
    u.sb.from("bill_email_log").select("id,to_email,cc,subject,status,error,sent_at").eq("invoice_id", id).order("sent_at", { ascending: false }),
    u.sb.from("bill_invoice_statements").select("statement_id,amount").eq("invoice_id", id),
    u.sb.from("bill_events").select("id,at,actor_name,action,detail").eq("invoice_id", id).order("at", { ascending: false }).limit(50),
    u.sb.from("bill_invoices").select("id,invoice_no,status,total,issue_date").eq("rectifies_id", id),
    u.sb.from("bill_clients").select("*").eq("id", r.data.client_id).maybeSingle(),
    r.data.rectifies_id ? u.sb.from("bill_invoices").select("id,invoice_no,issue_date").eq("id", r.data.rectifies_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const x of [lines, pays, mails, stm, events, rect]) if (x.error) fail(x.error);
  // liquidacions vinculades (només si l'usuari també té accés a la conciliació)
  let statements: { id: string; retailer: string; reference: string; amount: string }[] = [];
  const ids = (stm.data ?? []).map((s) => s.statement_id as string);
  if (ids.length && (await finStaff(u))) {
    const s = await u.sb.from("fin_provider_statements").select("id,retailer,reference").in("id", ids);
    statements = (s.data ?? []).map((x) => ({ ...(x as { id: string; retailer: string; reference: string }), amount: String((stm.data ?? []).find((y) => y.statement_id === x.id)?.amount ?? "0") }));
  }
  return { invoice: r.data, lines: lines.data ?? [], payments: pays.data ?? [], emails: mails.data ?? [], statements, statementLinks: stm.data ?? [], events: events.data ?? [], rectifications: rect.data ?? [], client: client.data, original: orig.data };
}

const lineQ = z.object({
  description: z.string().trim().min(1, "Cada línia necessita una descripció").max(1000),
  quantity: num, unitPrice: num,
  vatRate: num.refine((v) => Number(v) >= 0 && Number(v) <= 100, "Tipus d'IVA no vàlid"),
  vatExemption: opt(300),
});
const draftQ = z.object({
  clientId: uuid,
  concept: z.string().trim().min(2, "Escriu el concepte").max(500),
  periodLabel: opt(120), periodFrom: day.nullish(), periodTo: day.nullish(), issueDate: day.nullish(), dueDate: day.nullish(),
  orderRefLabel: opt(40), orderRef: opt(120), notes: opt(2000), internalNotes: opt(2000),
  origin: z.enum(["manual", "liquidacio"]).default("manual"),
  lines: z.array(lineQ).min(1, "Afegeix almenys una línia").max(100),
  statements: z.array(z.object({ statementId: uuid, amount: num })).max(20).default([]),
});

export async function saveDraft(u: U, raw: unknown, id?: string) {
  await access(u, "edit");
  const b = parse(draftQ, raw);
  const fields = {
    client_id: b.clientId, concept: b.concept, period_label: b.periodLabel, period_from: b.periodFrom ?? null, period_to: b.periodTo ?? null,
    issue_date: b.issueDate ?? null, due_date: b.dueDate ?? null, order_ref_label: b.orderRefLabel, order_ref: b.orderRef, notes: b.notes, internal_notes: b.internalNotes,
  };
  let invId = id;
  if (invId) {
    if (!uuid.safeParse(invId).success) throw new HttpError(400, "Factura no vàlida");
    const cur = await u.sb.from("bill_invoices").select("status").eq("id", invId).maybeSingle();
    if (cur.error) fail(cur.error);
    if (!cur.data) throw new HttpError(404, "Factura no trobada");
    if (cur.data.status !== "esborrany") throw new HttpError(409, "La factura ja és emesa: no es pot modificar. Fes una rectificativa.");
    const up = await u.sb.from("bill_invoices").update(fields).eq("id", invId);
    if (up.error) fail(up.error);
    const del = await u.sb.from("bill_invoice_lines").delete().eq("invoice_id", invId);
    if (del.error) fail(del.error);
    const ds = await u.sb.from("bill_invoice_statements").delete().eq("invoice_id", invId);
    if (ds.error) fail(ds.error);
  } else {
    const ins = await u.sb.from("bill_invoices").insert({ ...fields, origin: b.origin, kind: "ordinaria" }).select("id").single();
    if (ins.error) fail(ins.error);
    invId = ins.data.id as string;
  }
  const li = await u.sb.from("bill_invoice_lines").insert(b.lines.map((l, i) => ({ invoice_id: invId, line_no: i + 1, description: l.description, quantity: l.quantity, unit_price: l.unitPrice, vat_rate: l.vatRate, vat_exemption: l.vatExemption })));
  if (li.error) fail(li.error);
  if (b.statements.length) {
    const s = await u.sb.from("bill_invoice_statements").insert(b.statements.map((s) => ({ invoice_id: invId, statement_id: s.statementId, amount: s.amount })));
    if (s.error) fail(s.error);
  }
  return { ok: true, id: invId };
}

export async function deleteDraft(u: U, id: string) {
  await access(u, "edit");
  const r = await u.sb.from("bill_invoices").delete().eq("id", id).eq("status", "esborrany").select("id");
  if (r.error) fail(r.error);
  if (!r.data?.length) throw new HttpError(409, "Només es poden eliminar esborranys. Una factura emesa es corregeix amb una rectificativa.");
  return { ok: true };
}

export async function issueInvoice(u: U, id: string, raw: unknown) {
  await access(u, "approve");
  const b = parse(z.object({ issueDate: day.nullish() }), raw ?? {});
  const r = await u.sb.rpc("bill_issue_invoice", { p_id: id, p_issue_date: b.issueDate ?? null });
  if (r.error) fail(r.error, "No s'ha pogut emetre la factura");
  const inv = r.data as { invoice_no: string; total: string };
  return { ok: true, number: inv.invoice_no, total: inv.total };
}

const payQ = z.object({ amount: num, paidAt: day, method: z.enum(PAYMENT_METHODS).default("transferencia"), reference: opt(120), notes: opt(500) });
export async function registerPayment(u: U, id: string, raw: unknown) {
  await access(u, "approve");
  const b = parse(payQ, raw);
  if (D(b.amount).isZero()) throw new HttpError(400, "L'import no pot ser 0");
  const r = await u.sb.rpc("bill_register_payment", { p_invoice: id, p_amount: b.amount, p_date: b.paidAt, p_method: b.method, p_ref: b.reference, p_notes: b.notes });
  if (r.error) fail(r.error, "No s'ha pogut registrar el cobrament");
  return { ok: true, status: (r.data as { status: string }).status };
}

/** Històric de l'Excel: marcar diverses factures com a cobrades del tot (es registra un cobrament per a cadascuna). */
export async function markHistoricPaid(u: U, raw: unknown) {
  await access(u, "approve");
  const b = parse(z.object({ ids: z.array(uuid).min(1).max(300), paidAt: day.nullish(), reference: opt(120) }), raw);
  const r = await u.sb.from("bill_invoices").select("id,invoice_no,issue_date,total,paid,status,payment_unknown").in("id", b.ids);
  if (r.error) fail(r.error);
  let done = 0; const skipped: string[] = [];
  for (const x of r.data ?? []) {
    const pending = D(x.total).minus(x.paid);
    if (!x.payment_unknown || x.status === "esborrany" || x.status === "rectificada" || pending.isZero()) { skipped.push(x.invoice_no ?? x.id); continue; }
    const p = await u.sb.rpc("bill_register_payment", { p_invoice: x.id, p_amount: pending.toFixed(2), p_date: b.paidAt ?? x.issue_date, p_method: "transferencia", p_ref: b.reference ?? "Regularització històric Excel", p_notes: "Marcada com a cobrada des de la revisió de l'històric" });
    if (p.error) skipped.push(x.invoice_no ?? x.id); else done++;
  }
  return { ok: true, done, skipped };
}

export async function createRectification(u: U, id: string, raw: unknown) {
  await access(u, "edit");
  const b = parse(z.object({ reason: z.string().trim().min(5, "Explica el motiu de la rectificació").max(500) }), raw);
  const r = await u.sb.rpc("bill_create_rectification", { p_original: id, p_reason: b.reason });
  if (r.error) fail(r.error, "No s'ha pogut preparar la rectificativa");
  return { ok: true, id: r.data as string };
}

export async function reviewInvoice(u: U, id: string, raw: unknown) {
  await access(u, "edit");
  const b = parse(z.object({ reviewed: z.boolean(), internalNotes: opt(2000) }), raw);
  const patch: Record<string, unknown> = { needs_review: !b.reviewed };
  if (b.internalNotes !== null) patch.internal_notes = b.internalNotes;
  const r = await u.sb.from("bill_invoices").update(patch).eq("id", id);
  if (r.error) fail(r.error);
  return { ok: true };
}

/* ======================================================================= PDF, ZIP i correu */

async function settings(u: U) {
  const s = await u.sb.from("bill_settings").select("*").eq("id", 1).maybeSingle();
  if (s.error) fail(s.error);
  if (!s.data) throw new HttpError(409, "Falta la configuració de l'emissor (Facturació › Configuració)");
  return s.data as Record<string, string | null>;
}

export async function invoicePdf(u: U, id: string) {
  const d = await getInvoice(u, id);
  const i = d.invoice as Record<string, unknown> & { invoice_no: string | null; status: string; kind: "ordinaria" | "rectificativa" };
  const cfg = await settings(u);
  const draft = i.status === "esborrany";
  const issuer = (draft ? null : (i.issuer_snapshot as InvoicePdfInput["issuer"] | null)) ?? { name: cfg.issuer_name!, nif: cfg.issuer_nif!, address: cfg.issuer_address!, postal_code: cfg.issuer_postal_code!, city: cfg.issuer_city!, province: cfg.issuer_province, iban: cfg.iban };
  const cl = d.client as Record<string, string | null> | null;
  const client = (draft ? null : (i.client_snapshot as InvoicePdfInput["client"] | null)) ?? { legal_name: cl?.legal_name ?? "", nif: cl?.nif ?? "", address: cl?.address ?? null, postal_code: cl?.postal_code ?? null, city: cl?.city ?? null, province: cl?.province ?? null };
  const pdf = buildInvoicePdf({
    number: i.invoice_no, kind: i.kind, draft, issueDate: (i.issue_date as string | null) ?? null, dueDate: (i.due_date as string | null) ?? null,
    issuer: { ...issuer, email: cfg.issuer_email, phone: cfg.issuer_phone }, client,
    concept: i.concept as string | null, periodLabel: i.period_label as string | null, orderRefLabel: i.order_ref_label as string | null, orderRef: i.order_ref as string | null, notes: i.notes as string | null,
    rectifies: d.original ? { number: (d.original as { invoice_no: string }).invoice_no, date: (d.original as { issue_date: string | null }).issue_date, reason: i.rectification_reason as string | null } : null,
    lines: (d.lines as InvoicePdfInput["lines"]).map((l) => ({ ...l, quantity: String(l.quantity), unit_price: String(l.unit_price), vat_rate: String(l.vat_rate), amount: String(l.amount) })),
    breakdown: ((i.vat_breakdown as { rate: string; base: string; vat: string }[]) ?? []).map((b) => ({ rate: String(b.rate), base: String(b.base), vat: String(b.vat) })),
    base: String(i.base), vat: String(i.vat), total: String(i.total), footer: cfg.footer_text, logo: cfg.logo_path?.startsWith("data:image/png") ? cfg.logo_path : null,
  });
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
  return { pdf, fileName: `Factura_${i.invoice_no ?? "esborrany"}_${safe(String(client.legal_name))}.pdf`, invoice: i, client };
}

export async function invoicesZip(u: U, idsRaw: string) {
  await access(u);
  const ids = idsRaw.split(",").filter((x) => uuid.safeParse(x).success).slice(0, 200);
  if (!ids.length) throw new HttpError(400, "Selecciona almenys una factura");
  const zip = new JSZip();
  for (const id of ids) { const { pdf, fileName } = await invoicePdf(u, id); zip.file(fileName, pdf); }
  return { bytes: await zip.generateAsync({ type: "uint8array" }), fileName: `Factures_${new Date().toISOString().slice(0, 10)}.zip` };
}

const mailQ = z.object({ to: z.string().trim().email("Correu del destinatari no vàlid"), cc: z.array(z.string().trim().email()).max(5).default([]), subject: z.string().trim().min(3).max(300), body: z.string().trim().min(5).max(20000), saveAsDefault: z.boolean().default(false) });
export async function sendInvoice(u: U, id: string, raw: unknown) {
  await access(u, "edit");
  const b = parse(mailQ, raw);
  const { pdf, fileName, invoice } = await invoicePdf(u, id);
  if (invoice.status === "esborrany") throw new HttpError(409, "Emet la factura abans d'enviar-la");
  const { sendFromMyMailbox } = await import("./comms");
  const res = await sendFromMyMailbox(u, { to: b.to, cc: b.cc, subject: b.subject, text: b.body, attachments: [{ filename: fileName, content: Buffer.from(pdf), contentType: "application/pdf" }] });
  const log = await u.sb.from("bill_email_log").insert({ invoice_id: id, to_email: b.to, cc: b.cc.join(", ") || null, subject: b.subject, status: res.accepted ? "acceptat" : "error", provider_message_id: res.messageId, error: res.error });
  if (log.error) console.warn("[facturacio] enviament no registrat:", log.error.code);
  if (!res.accepted) {
    await u.sb.from("bill_invoices").update({ last_email_status: "error" }).eq("id", id);
    throw new HttpError(502, `No s'ha enviat: ${res.error}`);
  }
  // només es marca com a enviada quan el servidor de correu ha acceptat el missatge
  await u.sb.from("bill_invoices").update({ sent_at: new Date().toISOString(), last_email_status: "acceptat" }).eq("id", id);
  if (b.saveAsDefault) await u.sb.from("bill_clients").update({ billing_email: b.to }).eq("id", invoice.client_id as string);
  return { ok: true, from: res.from };
}

/* ======================================================================= exportacions */

export async function exportXlsx(u: U, raw: Record<string, string>) {
  const list = await listInvoices(u, { ...raw, size: "500", page: "0" });
  const rows = list.rows.filter((x) => x.status !== "esborrany");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Assessoria 3.0 CRM";
  const ws = wb.addWorksheet("Factures");
  ws.columns = [
    { header: "Número", key: "n", width: 12 }, { header: "Data", key: "d", width: 12 }, { header: "Venciment", key: "v", width: 12 }, { header: "Client", key: "c", width: 40 },
    { header: "NIF/CIF", key: "nif", width: 13 }, { header: "Concepte", key: "con", width: 40 }, { header: "Període", key: "p", width: 18 }, { header: "Base", key: "b", width: 13 },
    { header: "IVA", key: "i", width: 12 }, { header: "Total", key: "t", width: 13 }, { header: "Cobrat", key: "pa", width: 13 }, { header: "Pendent", key: "pe", width: 13 }, { header: "Estat", key: "s", width: 20 },
  ];
  for (const x of rows) ws.addRow({ n: x.invoice_no, d: x.issue_date, v: x.due_date, c: x.client_name, nif: x.client_nif, con: x.concept, p: x.period_label, b: Number(x.base), i: Number(x.vat), t: Number(x.total), pa: Number(x.paid), pe: Number(x.pending), s: DISPLAY_STATUS_LABEL[x.display_status] });
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15803D" } };
  for (const k of ["b", "i", "t", "pa", "pe"]) ws.getColumn(k).numFmt = '#,##0.00 "€"';
  // resum mensual i d'IVA (per trimestre i tipus)
  const m = wb.addWorksheet("Resum mensual");
  m.columns = [{ header: "Mes", key: "m", width: 10 }, { header: "Factures", key: "n", width: 10 }, { header: "Base", key: "b", width: 14 }, { header: "IVA", key: "i", width: 14 }, { header: "Total", key: "t", width: 14 }];
  const byMonth = new Map<string, { n: number; b: ReturnType<typeof D>; i: ReturnType<typeof D>; t: ReturnType<typeof D> }>();
  for (const x of rows) { const k = x.issue_date?.slice(0, 7) ?? "—"; const a = byMonth.get(k) ?? { n: 0, b: D(0), i: D(0), t: D(0) }; a.n++; a.b = a.b.plus(x.base); a.i = a.i.plus(x.vat); a.t = a.t.plus(x.total); byMonth.set(k, a); }
  for (const [k, a] of [...byMonth.entries()].sort()) m.addRow({ m: k, n: a.n, b: Number(money(a.b)), i: Number(money(a.i)), t: Number(money(a.t)) });
  m.getRow(1).font = { bold: true };
  const v = wb.addWorksheet("IVA repercutit");
  v.columns = [{ header: "Trimestre", key: "q", width: 12 }, { header: "Tipus IVA", key: "r", width: 10 }, { header: "Base", key: "b", width: 14 }, { header: "Quota", key: "i", width: 14 }];
  const ids = rows.map((x) => x.id);
  const vb = new Map<string, { b: ReturnType<typeof D>; i: ReturnType<typeof D> }>();
  for (let k = 0; k < ids.length; k += 200) {
    const r = await u.sb.from("bill_invoices").select("issue_date,vat_breakdown").in("id", ids.slice(k, k + 200));
    if (r.error) fail(r.error);
    for (const x of r.data ?? []) {
      const q = `${String(x.issue_date).slice(0, 4)}-T${Math.floor((Number(String(x.issue_date).slice(5, 7)) - 1) / 3) + 1}`;
      for (const b of (x.vat_breakdown as { rate: string; base: string; vat: string }[]) ?? []) { const key = `${q}|${Number(b.rate)}`; const a = vb.get(key) ?? { b: D(0), i: D(0) }; a.b = a.b.plus(b.base); a.i = a.i.plus(b.vat); vb.set(key, a); }
    }
  }
  for (const [k, a] of [...vb.entries()].sort()) { const [q, r] = k.split("|"); v.addRow({ q, r: `${r} %`, b: Number(money(a.b)), i: Number(money(a.i)) }); }
  v.getRow(1).font = { bold: true };
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), fileName: `Facturacio_${new Date().toISOString().slice(0, 10)}.xlsx` };
}

/* ======================================================================= clients de facturació */

const clientQ = z.object({
  legal_name: z.string().trim().min(2, "Escriu la raó social").max(200), trade_name: opt(200), nif: z.string().trim().max(20).default(""),
  address: opt(300), postal_code: opt(10), city: opt(120), province: opt(120), country: z.string().trim().max(60).default("España"),
  contact_name: opt(120), phone: opt(40), billing_email: z.string().trim().email("Correu de facturació no vàlid").max(200).nullish().or(z.literal("")).transform((v) => v || null),
  payment_method: z.enum(["transferencia", "domiciliacio", "confirming", "compensacio", "altres"]).default("transferencia"),
  due_days: z.coerce.number().int().min(0).max(365).nullish(), order_ref_label: opt(40), order_ref: opt(120), retailer_name: opt(200), notes: opt(2000),
  status: z.enum(["actiu", "inactiu", "arxivat"]).default("actiu"), needs_review: z.boolean().default(false), review_notes: opt(500),
});

export async function listBillingClients(u: U, raw: Record<string, string>) {
  await access(u);
  let q = u.sb.from("bill_clients").select("*").order("legal_name");
  if (raw.status && ["actiu", "inactiu", "arxivat"].includes(raw.status)) q = q.eq("status", raw.status);
  else if (raw.status !== "tots") q = q.neq("status", "arxivat");
  if (raw.q) { const s = raw.q.toLowerCase().replace(/[%_,()]/g, " ").trim(); if (s) q = q.ilike("search", `%${s}%`); }
  const r = await q.limit(1000);
  if (r.error) fail(r.error);
  const ids = (r.data ?? []).map((c) => c.id as string);
  const inv = ids.length ? await u.sb.from("bill_invoices_v").select("client_id,total,pending,status,issue_date,payment_unknown").in("client_id", ids).neq("status", "esborrany") : { data: [], error: null };
  if (inv.error) fail(inv.error);
  const agg = new Map<string, { n: number; total: ReturnType<typeof D>; pending: ReturnType<typeof D>; last: string | null }>();
  for (const x of inv.data ?? []) {
    const a = agg.get(x.client_id) ?? { n: 0, total: D(0), pending: D(0), last: null };
    a.n++; a.total = a.total.plus(x.total); if (!x.payment_unknown) a.pending = a.pending.plus(x.pending); if (!a.last || (x.issue_date && x.issue_date > a.last)) a.last = x.issue_date;
    agg.set(x.client_id, a);
  }
  return { rows: (r.data ?? []).map((c) => { const a = agg.get(c.id); return { ...c, invoices: a?.n ?? 0, invoiced: money(a?.total ?? 0), pending: money(a?.pending ?? 0), last_invoice: a?.last ?? null, nif_valid: validTaxId(c.nif) }; }) };
}

export async function saveBillingClient(u: U, raw: unknown, id?: string) {
  await access(u, "edit");
  const b = parse(clientQ, raw);
  if (b.nif && !validTaxId(b.nif) && !b.needs_review) { b.needs_review = true; b.review_notes = b.review_notes ?? `El NIF/CIF «${b.nif}» no supera la validació`; }
  const r = id ? await u.sb.from("bill_clients").update(b).eq("id", id).select("id").single() : await u.sb.from("bill_clients").insert(b).select("id").single();
  if (r.error) fail(r.error);
  return { ok: true, id: r.data.id as string, warning: b.nif && !validTaxId(b.nif) ? "El NIF/CIF no supera la validació: el client queda marcat per revisar i no s'hi podran emetre factures fins que es corregeixi." : null };
}

/** Eliminar només si no té factures; si en té, es proposa arxivar-lo (l'historial es conserva). */
export async function deleteBillingClient(u: U, id: string) {
  await access(u, "edit");
  const n = await u.sb.from("bill_invoices").select("id", { count: "exact", head: true }).eq("client_id", id);
  if (n.error) fail(n.error);
  if ((n.count ?? 0) > 0) throw new HttpError(409, `Aquest client té ${n.count} factura(es): no es pot eliminar. Arxiva'l i se'n conservarà l'historial.`);
  const r = await u.sb.from("bill_clients").delete().eq("id", id);
  if (r.error) fail(r.error);
  return { ok: true };
}

/** Importació des d'Excel/CSV (llegit al navegador): no es dupliquen NIF existents. */
export async function importBillingClients(u: U, raw: unknown) {
  await access(u, "edit");
  const rows = parse(z.array(z.record(z.string(), z.unknown())).min(1).max(2000), raw);
  const ex = await u.sb.from("bill_clients").select("nif_norm,legal_name");
  if (ex.error) fail(ex.error);
  const have = new Set((ex.data ?? []).map((x) => x.nif_norm as string).filter(Boolean));
  const names = new Set((ex.data ?? []).map((x) => normName(x.legal_name as string)));
  const created: string[] = [], skipped: { name: string; reason: string }[] = [];
  for (const row of rows) {
    const g = (...k: string[]) => { for (const key of Object.keys(row)) if (k.includes(normName(key))) { const v = row[key]; return v == null ? null : String(v).trim() || null; } return null; };
    const name = g("CLIENT", "RAOSOCIAL", "RAZONSOCIAL", "EMPRESA", "NOM", "NOMBRE");
    const nif = (g("CIF", "NIF", "NIFCIF", "CIFNIF") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!name) { skipped.push({ name: "(sense nom)", reason: "Falta la raó social" }); continue; }
    if (nif && have.has(nif)) { skipped.push({ name, reason: `Ja existeix (NIF ${nif})` }); continue; }
    if (!nif && names.has(normName(name))) { skipped.push({ name, reason: "Ja existeix un client amb aquest nom" }); continue; }
    const cp = g("CP", "CODIPOSTAL", "CODIGOPOSTAL");
    const valid = nif ? validTaxId(nif) : false;
    const r = await u.sb.from("bill_clients").insert({
      legal_name: name, nif, address: g("ADRECA", "DIRECCION", "DOMICILI", "DOMICILIO"), postal_code: cp, city: g("POBLACIO", "POBLACION", "CIUTAT", "CIUDAD", "MUNICIPI"),
      province: g("PROVINCIA"), billing_email: g("EMAIL", "CORREU", "CORREO", "EMAILFACTURACIO")?.toLowerCase() ?? null, phone: g("TELEFON", "TELEFONO"),
      needs_review: !valid || (cp ? !/^\d{5}$/.test(cp) : true), review_notes: [!valid && "NIF/CIF absent o no vàlid", cp && !/^\d{5}$/.test(cp) && `Codi postal «${cp}» no vàlid`, !cp && "Falta el codi postal"].filter(Boolean).join("; ") || null,
      notes: "Importat des de fitxer",
    });
    if (r.error) skipped.push({ name, reason: r.error.code === "23505" ? "Ja existeix" : "No s'ha pogut desar" });
    else { created.push(name); if (nif) have.add(nif); names.add(normName(name)); }
  }
  return { ok: true, created: created.length, skipped };
}

/* ======================================================================= configuració i numeració */

export async function getSettings(u: U) {
  await access(u);
  const [s, gaps, series] = await Promise.all([
    u.sb.from("bill_settings").select("*").eq("id", 1).maybeSingle(),
    u.sb.from("bill_number_gaps").select("*").order("year").order("number"),
    u.sb.from("bill_series").select("*").order("year", { ascending: false }),
  ]);
  if (s.error) fail(s.error);
  return { settings: s.data, gaps: gaps.data ?? [], series: series.data ?? [], canEdit: u.profile.role === "admin" };
}

const settingsQ = z.object({
  issuer_name: z.string().trim().min(2).max(200), issuer_nif: z.string().trim().min(8).max(20), issuer_address: z.string().trim().min(3).max(300),
  issuer_postal_code: z.string().trim().regex(/^\d{5}$/, "Codi postal no vàlid"), issuer_city: z.string().trim().min(2).max(120), issuer_province: opt(120),
  issuer_email: z.string().trim().email().nullish().or(z.literal("")).transform((v) => v || null), issuer_phone: opt(40),
  iban: z.string().trim().max(40).regex(/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,34}$/i, "IBAN no vàlid").nullish().or(z.literal("")).transform((v) => (v ? v.toUpperCase() : null)),
  default_vat_rate: num.refine((v) => Number(v) >= 0 && Number(v) <= 100), default_due_days: z.coerce.number().int().min(0).max(365),
  footer_text: opt(500), email_subject_tpl: opt(300), email_body_tpl: opt(5000),
  logo_path: z.string().max(600_000).regex(/^data:image\/png;base64,/, "El logotip ha de ser un PNG").nullish().or(z.literal("")).transform((v) => v || null),
});
export async function saveSettings(u: U, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot canviar les dades de l'emissor i el compte bancari");
  const b = parse(settingsQ, raw);
  if (!validTaxId(b.issuer_nif)) throw new HttpError(400, "El CIF de l'emissor no és vàlid");
  const r = await u.sb.from("bill_settings").upsert({ id: 1, ...b, updated_by: u.user.id, updated_at: new Date().toISOString() });
  if (r.error) fail(r.error);
  return { ok: true };
}

export async function resolveGap(u: U, raw: unknown) {
  await access(u, "approve");
  const b = parse(z.object({ series: z.string().max(10), year: z.number().int(), number: z.number().int(), status: z.enum(["anullada", "localitzada", "verificada"]), notes: z.string().trim().min(3, "Explica què s'ha comprovat").max(500) }), raw);
  const r = await u.sb.from("bill_number_gaps").update({ status: b.status, notes: b.notes, resolved_by: u.user.id, resolved_at: new Date().toISOString() }).eq("series", b.series).eq("year", b.year).eq("number", b.number);
  if (r.error) fail(r.error);
  return { ok: true };
}

/* ======================================================================= liquidacions → factura */

type Summary = { lines: number; positives: string; negatives: string; billable: string; invoiced: string; drafts: string; pending: string; doubtful: number };

export async function statementsToBill(u: U) {
  await access(u);
  if (!(await finStaff(u))) return { rows: [], allowed: false };
  const s = await u.sb.from("fin_provider_statements").select("id,retailer,reference,period_from,period_to,received_at,status,declared_total").order("received_at", { ascending: false }).limit(200);
  if (s.error) fail(s.error);
  const clients = await u.sb.from("bill_clients").select("id,legal_name,trade_name,retailer_name,status").neq("status", "arxivat");
  if (clients.error) fail(clients.error);
  const rows = [];
  for (const st of s.data ?? []) {
    const m = await u.sb.rpc("bill_statement_summary", { p_statement: st.id });
    if (m.error) fail(m.error);
    const sum = one(m.data as Summary[]) as Summary | null;
    if (!sum) continue;
    const client = matchClient(st.retailer as string, clients.data ?? []);
    rows.push({ ...st, summary: sum, client, state: D(sum.pending).lte(0) ? (D(sum.invoiced).gt(0) ? "facturada" : "sense_import") : D(sum.invoiced).gt(0) ? "parcial" : "pendent" });
  }
  return { rows, allowed: true };
}

function matchClient(retailer: string, clients: { id: unknown; legal_name: unknown; trade_name: unknown; retailer_name: unknown }[]) {
  const r = normName(retailer);
  if (!r) return null;
  const hit = clients.find((c) => normName(c.retailer_name as string) === r)
    ?? clients.find((c) => { const n = normName(c.legal_name as string), t = normName(c.trade_name as string); return (n && (n.startsWith(r) || r.startsWith(n))) || (t && (t === r)); })
    ?? clients.find((c) => { const n = normName(c.legal_name as string); return r.length >= 5 && n.includes(r); });
  return hit ? { id: hit.id as string, name: hit.legal_name as string } : null;
}

/** Proposta (sense desar) o esborrany a partir d'una liquidació. */
export async function draftFromStatement(u: U, raw: unknown) {
  await access(u, "edit");
  if (!(await finStaff(u))) throw new HttpError(403, "Cal accés a la conciliació per facturar una liquidació");
  const b = parse(z.object({ statementId: uuid, clientId: uuid.nullish(), vatRate: num.default("21"), confirm: z.boolean().default(false), amount: num.nullish() }), raw);
  const st = await u.sb.from("fin_provider_statements").select("id,retailer,reference,period_from,period_to").eq("id", b.statementId).maybeSingle();
  if (st.error) fail(st.error);
  if (!st.data) throw new HttpError(404, "Liquidació no trobada");
  const m = await u.sb.rpc("bill_statement_summary", { p_statement: b.statementId });
  if (m.error) fail(m.error);
  const sum = one(m.data as Summary[]) as Summary;
  const clients = await u.sb.from("bill_clients").select("id,legal_name,trade_name,retailer_name,status,needs_review,review_notes,nif").neq("status", "arxivat");
  if (clients.error) fail(clients.error);
  const client = b.clientId ? (clients.data ?? []).find((c) => c.id === b.clientId) ?? null : (() => { const h = matchClient(st.data.retailer, clients.data ?? []); return h ? (clients.data ?? []).find((c) => c.id === h.id) ?? null : null; })();
  const proposal = proposalFromStatement(st.data, { pending: b.amount ?? sum.pending, negatives: sum.negatives, doubtful: sum.doubtful }, b.vatRate);
  if (b.amount && D(b.amount).gt(sum.pending)) proposal.warnings.push(`L'import indicat supera el pendent de facturar (${money(D(sum.pending))} €).`);
  if (D(sum.drafts).gt(0)) proposal.warnings.push(`Ja hi ha esborranys vinculats a aquesta liquidació per ${money(D(sum.drafts))} €.`);
  if (!client) proposal.warnings.push(`No s'ha trobat el client de facturació de «${st.data.retailer}»: tria'l o crea'l (i omple «Nom a les liquidacions»).`);
  else if (client.needs_review) proposal.warnings.push(`La fitxa de ${client.legal_name} està marcada per revisar: ${client.review_notes ?? ""}`);
  const result = { statement: st.data, summary: sum, client: client ? { id: client.id as string, name: client.legal_name as string, nif: client.nif as string } : null, proposal };
  if (!b.confirm) return result;
  if (!client) throw new HttpError(400, "Tria el client de facturació abans de generar l'esborrany");
  if (D(proposal.base).lte(0)) throw new HttpError(409, "Aquesta liquidació no té cap import pendent de facturar");
  if (D(proposal.base).gt(sum.pending)) throw new HttpError(409, "L'import supera el pendent de facturar de la liquidació");
  const saved = await saveDraft(u, {
    clientId: client.id, concept: proposal.concept, periodLabel: proposal.periodLabel, periodFrom: st.data.period_from, periodTo: st.data.period_to, origin: "liquidacio",
    lines: [{ description: `Comissions liquidació ${st.data.retailer} · ref. ${st.data.reference}`, quantity: "1", unitPrice: proposal.base, vatRate: b.vatRate }],
    statements: [{ statementId: st.data.id, amount: proposal.base }],
  });
  return { ...result, draftId: saved.id };
}

/* ======================================================================= extractes bancaris */

const BANK_MIGRATION = "Falta aplicar la migració supabase/migrations/028_conciliacio_bancaria.sql a Supabase";
const bankFail = (e: PgError): never => { if (e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST202" || /does not exist|schema cache|Could not find/i.test(e?.message ?? "")) throw new HttpError(503, BANK_MIGRATION); return fail(e); };

export function readBankFile(name: string, bytes: Buffer): BankRead {
  const head = bytes.subarray(0, 200).toString("latin1");
  if (/^11\d{18}/.test(head) || /\.(n43|aeb|csb|q43)$/i.test(name)) return parseNorma43(bytes.toString("latin1"));
  return parseBankGrid(gridFromBytes(XLSX as never, bytes, name));
}

const bankUploadQ = z.object({ file: z.object({ name: z.string().max(200), base64: z.string().max(7_500_000) }) });
export async function bankUpload(u: U, raw: unknown) {
  await access(u, "edit");
  const b = parse(bankUploadQ, raw);
  const bytes = Buffer.from(b.file.base64, "base64");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const read = readBankFile(b.file.name, bytes);
  if (!read.movements.length) throw new HttpError(400, read.errors.join(" · ") || "No s'ha reconegut cap moviment");
  const dup = await u.sb.from("bill_bank_imports").select("id,created_at").eq("file_sha256", sha).maybeSingle();
  if (dup.error) bankFail(dup.error);
  if (dup.data) throw new HttpError(409, `Aquest extracte ja es va pujar el ${String(dup.data.created_at).slice(0, 10)}. No s'ha duplicat cap moviment.`);
  const imp = await u.sb.from("bill_bank_imports").insert({ file_name: b.file.name, file_sha256: sha, format: read.format, account: read.account, period_from: read.from, period_to: read.to, movements: read.movements.length, created_by: u.user.id }).select("id").single();
  if (imp.error) bankFail(imp.error);
  let added = 0;
  for (let i = 0; i < read.movements.length; i += 500) {
    const chunk = read.movements.slice(i, i + 500).map((m) => ({ import_id: imp.data!.id, account: m.account, op_date: m.opDate, value_date: m.valueDate, amount: m.amount, concept: m.concept.slice(0, 500), reference: m.reference?.slice(0, 120) ?? null, balance: m.balance, movement_hash: m.hash }));
    const r = await u.sb.from("bill_bank_movements").upsert(chunk, { onConflict: "movement_hash", ignoreDuplicates: true }).select("id");
    if (r.error) bankFail(r.error);
    added += r.data?.length ?? 0;
  }
  await u.sb.from("bill_bank_imports").update({ new_movements: added }).eq("id", imp.data!.id);
  const credits = read.movements.filter((m) => D(m.amount).gt(0));
  return { ok: true, format: read.format, account: read.account, from: read.from, to: read.to, movements: read.movements.length, added, repeated: read.movements.length - added, credits: credits.length, creditTotal: money(credits.reduce((s2, m) => s2.plus(m.amount), D(0))), warnings: read.warnings };
}

async function openInvoices(u: U): Promise<OpenInvoice[]> {
  const r = await u.sb.from("bill_invoices_v").select("id,invoice_no,issue_date,due_date,client_id,client_name,client_nif,pending,payment_unknown,kind,status").eq("kind", "ordinaria").in("status", ["emesa", "parcialment_cobrada"]).gt("pending", 0).limit(5000);
  if (r.error) fail(r.error);
  return (r.data ?? []) as OpenInvoice[];
}

export async function bankOverview(u: U, raw: Record<string, string>) {
  await access(u);
  const st = ["pendent", "conciliat", "ignorat"].includes(raw.status) ? raw.status : "pendent";
  let q = u.sb.from("bill_bank_movements").select("*").order("op_date", { ascending: false }).limit(1000);
  if (raw.kind !== "tots") q = q.gt("amount", 0);
  if (raw.status !== "tots") q = q.eq("status", st);
  const [mv, imps, open, pendingAll] = await Promise.all([
    q, u.sb.from("bill_bank_imports").select("*").order("created_at", { ascending: false }).limit(20), openInvoices(u),
    u.sb.from("bill_bank_movements").select("id,op_date,amount,concept,status").eq("status", "pendent").gt("amount", 0).limit(5000),
  ]);
  if (mv.error) bankFail(mv.error);
  type Mv = { id: string; op_date: string; amount: string; concept: string; status: string };
  const rows = (mv.data ?? []) as (Mv & Record<string, unknown>)[];
  const matched = rows.filter((x) => x.status === "conciliat").map((x) => x.id);
  const links = matched.length ? ((await u.sb.from("bill_bank_matches").select("movement_id,invoice_id,amount,bill_invoices(invoice_no)").in("movement_id", matched)).data ?? []) : [];
  // propostes per a tots els ingressos pendents (per a l'anàlisi de factures sense cobrar)
  const covered = new Set<string>();
  const sugg = new Map<string, ReturnType<typeof suggest>>();
  for (const m of (pendingAll.data ?? []) as Mv[]) {
    const s = suggest({ amount: String(m.amount), concept: m.concept, opDate: m.op_date }, open);
    sugg.set(m.id, s);
    for (const x of s) for (const i of x.invoices) covered.add(i.id);
  }
  const lastTo = ((imps.data ?? []) as { period_to: string | null }[]).map((x) => x.period_to).filter(Boolean).sort().pop() ?? null;
  const unpaid = unpaidAnalysis(open, covered, lastTo);
  return {
    imports: imps.data ?? [], period: { to: lastTo },
    rows: rows.map((x) => ({ ...x, suggestions: sugg.get(x.id) ?? [], matches: (links as unknown as { movement_id: string; invoice_id: string; amount: string; bill_invoices: { invoice_no: string } | null }[]).filter((l) => l.movement_id === x.id).map((l) => ({ invoiceId: l.invoice_id, invoiceNo: l.bill_invoices?.invoice_no ?? null, amount: l.amount })) })),
    unpaid,
    summary: {
      pendingCredits: (pendingAll.data ?? []).length,
      withoutInvoice: [...sugg.values()].filter((s) => !s.length).length,
      highConfidence: [...sugg.values()].filter((s) => s[0]?.confidence === "alta").length,
      unpaidCount: unpaid.length, unpaidOverdue: unpaid.filter((x) => x.overdue && !x.payment_unknown).length,
      unpaidAmount: money(unpaid.filter((x) => !x.payment_unknown).reduce((a, x) => a.plus(x.pending), D(0))),
      historicUnknown: unpaid.filter((x) => x.payment_unknown).length,
    },
  };
}

const confirmQ = z.object({ movementId: uuid, invoices: z.array(z.object({ invoiceId: uuid, amount: num })).min(1).max(10) });
export async function bankConfirm(u: U, raw: unknown) {
  await access(u, "approve");
  const b = parse(confirmQ, raw);
  const r = await u.sb.rpc("bill_bank_confirm", { p_movement: b.movementId, p_invoices: b.invoices.map((i) => ({ invoice_id: i.invoiceId, amount: i.amount })) });
  if (r.error) bankFail(r.error);
  return { ok: true };
}

/** Confirma d'una vegada les propostes de confiança alta (import exacte i factura o client esmentats al concepte). */
export async function bankConfirmHigh(u: U) {
  await access(u, "approve");
  const ov = await bankOverview(u, { status: "pendent" });
  const used = new Set<string>();
  let done = 0; const skipped: string[] = [];
  for (const m of ov.rows) {
    const top = (m.suggestions as ReturnType<typeof suggest>)[0];
    if (!top || top.confidence !== "alta") continue;
    if (top.invoices.some((i) => used.has(i.id))) { skipped.push(`${m.op_date} ${m.amount} €: la factura també encaixa amb un altre ingrés`); continue; }
    const r = await u.sb.rpc("bill_bank_confirm", { p_movement: m.id, p_invoices: top.invoices.map((i) => ({ invoice_id: i.id, amount: i.amount })) });
    if (r.error) { skipped.push(`${m.op_date} ${m.amount} €: ${r.error.message}`); continue; }
    top.invoices.forEach((i) => used.add(i.id)); done++;
  }
  return { ok: true, done, skipped };
}

export async function bankSetStatus(u: U, raw: unknown) {
  await access(u, "edit");
  const b = parse(z.object({ movementId: uuid, status: z.enum(["pendent", "ignorat"]), note: opt(300) }), raw);
  const cur = await u.sb.from("bill_bank_movements").select("status").eq("id", b.movementId).maybeSingle();
  if (cur.error) bankFail(cur.error);
  if (cur.data?.status === "conciliat") throw new HttpError(409, "Un moviment conciliat ja té el cobrament registrat a la factura: no es pot canviar");
  const r = await u.sb.from("bill_bank_movements").update({ status: b.status, note: b.note, resolved_by: u.user.id, resolved_at: new Date().toISOString() }).eq("id", b.movementId);
  if (r.error) bankFail(r.error);
  return { ok: true };
}
