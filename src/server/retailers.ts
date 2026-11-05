import "server-only";
/**
 * COMERCIALITZADORES (Fase 8.1) · servidor.
 *
 * Seguretat:
 *  - Accés: Direcció i, amb autorització de Direcció (mòdul «comercialitzadores»), Cap administrativa / Administrativa.
 *    Es comprova aquí i a la RLS (retailer_access). Comercials, caps d'equip i col·laboradors: mai.
 *  - Fitxers al bucket PRIVAT `retailer-contracts`: pujada amb URL signada d'un sol ús + tiquet HMAC; el servidor
 *    comprova el contingut real (bytes màgics / estructura DOCX), la mida i l'empremta SHA-256. Descàrrega amb URL de 60 s.
 *  - IA: els contractes NOMÉS s'envien al proveïdor d'IA si Direcció ha configurat i confirmat les garanties de
 *    confidencialitat (sec_settings «ia_contractes»). Sense això, el sistema fa servir el lector LOCAL (res surt del servidor).
 *  - La IA només proposa: tot queda «pendent» o «revisió manual» fins que Direcció ho aprova (retailer_approve_term).
 */
import { PdfProblem, preparePdf } from "./pdf-prepare";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { extOf, safeFileName, sniffDoc, zipKindOk } from "@/core/crm";
import { localExtract, matchesRetailer, missedByAi, reviewStatusOf, riskExposure, underpayments, type ClawRule, type ExtractedTerm } from "@/core/retailers";
import { docxText, pdfText, sheetText, type DocText } from "./doc-text";
import { callTool, type Content } from "./ai-reader";
import { READER_SYSTEM, READER_TOOL, VERIFY_SYSTEM, VERIFY_TOOL, expandTerms, parseReaderOutput, parseVerifyOutput, verifyContext } from "@/core/condition-reader";
import { env } from "./env";
import { imageForAi } from "./invoices";
import { finStaff, hasPerm, secLog } from "./permissions";
import { HttpError, adminClient } from "./supabase";
import type { U } from "./crm";

export const BUCKET = "retailer-contracts";
const MAX_BYTES = 25 * 1024 * 1024;
const TYPES: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const uuid = z.string().uuid();
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42883" || e.code === "PGRST202" || /does not exist|Could not find/i.test(e.message ?? ""));
function fail(e: { code?: string; message?: string } | null, msg = "Error de base de dades"): never {
  if (isMissing(e)) throw new HttpError(503, "Falta aplicar la migració 017_comercialitzadores.sql");
  if (e?.code === "42501" || /row-level security/i.test(e?.message ?? "")) throw new HttpError(403, e?.message && !/row-level/.test(e.message) ? e.message : "No tens permís per fer aquesta operació");
  if (e?.code === "23505") throw new HttpError(409, "Ja existeix (nom o document duplicat)");
  if (e?.code === "23514" || e?.code === "P0001" || e?.code === "P0002" || e?.code === "23503") throw new HttpError(400, e.message ?? msg);
  throw new HttpError(500, e?.message ?? msg);
}

/** Mateixa regla que retailer_access() a la base de dades. */
export async function retailerAccess(u: U, action: "read" | "edit" | "approve" = "read") {
  if (u.profile.role === "admin") return true;
  if (!["cap_administrativa", "administrativa"].includes(u.profile.role)) return false;
  return hasPerm(u, "comercialitzadores", action);
}
async function need(u: U, action: "read" | "edit" | "approve" = "read") {
  if (!(await retailerAccess(u, action))) throw new HttpError(403, "Les comercialitzadores només són accessibles per a Direcció i l'administració autoritzada");
}
const adminOnly = (u: U, what = "Només Direcció pot fer aquesta operació") => { if (u.profile.role !== "admin") throw new HttpError(403, what); };

/* ======================================================================= estat operatiu (Fase 10) */

/** Estats que treuen la comercialitzadora dels selectors per a feina nova (contractes, expedients i comparatives). */
export const NON_OPERATIONAL = ["inactiva", "arxivada"] as const;
export type RetailerIndexRow = { id: string; trade_name: string; aliases: string[] | null; status: string };

/** Índex de noms i estats (servidor). Si la 017 no hi és, retorna una llista buida i no bloqueja res. */
export async function retailerIndex(): Promise<RetailerIndexRow[]> {
  try {
    const r = await adminClient().from("retailers").select("id,trade_name,aliases,status");
    return r.error ? [] : ((r.data ?? []) as RetailerIndexRow[]);
  } catch { return []; }
}
/** La comercialitzadora (pel nom lliure del CRM) està desactivada o arxivada? Retorna la fitxa o null. */
export function blockedRetailer(name: string | null | undefined, idx: RetailerIndexRow[]) {
  if (!name) return null;
  return idx.find((r) => (NON_OPERATIONAL as readonly string[]).includes(r.status) && matchesRetailer(name, r)) ?? null;
}
/** Error clar per a contractes, expedients i comparatives nous amb una comercialitzadora fora d'ús. */
export async function assertRetailerOperational(name: string | null | undefined) {
  const b = blockedRetailer(name, await retailerIndex());
  if (b) throw new HttpError(400, `La comercialitzadora «${b.trade_name}» està ${b.status === "arxivada" ? "arxivada" : "desactivada"}: no es pot fer servir per a contractes o comparatives nous. Direcció la pot reactivar a Comercialitzadores. Els contractes històrics es conserven.`);
}
/** Noms per als selectors operatius: només actives o pendents (mai contractes ni condicions). */
export async function retailerOptions(u: U) {
  if (u.profile.role === "colaborador") throw new HttpError(403, "Sense accés");
  const idx = await retailerIndex();
  return { options: idx.filter((r) => !(NON_OPERATIONAL as readonly string[]).includes(r.status)).map((r) => ({ name: r.trade_name, aliases: r.aliases ?? [], status: r.status })).sort((a, b) => a.name.localeCompare(b.name, "ca")), blocked: idx.filter((r) => (NON_OPERATIONAL as readonly string[]).includes(r.status)).map((r) => ({ name: r.trade_name, aliases: r.aliases ?? [], status: r.status })) };
}

const statusBody = z.object({ status: z.enum(["activa", "pendent", "suspesa", "inactiva", "arxivada"]), note: z.string().trim().max(500).nullable().optional() });
/** Activar, desactivar, arxivar o reactivar (Direcció). No esborra res; queda registrat qui i quan (021 + sec_audit). */
export async function setRetailerStatus(u: U, id: string, raw: unknown) {
  adminOnly(u, "Només Direcció pot activar, desactivar o arxivar comercialitzadores");
  const b = statusBody.parse(raw);
  const r = await u.sb.from("retailers").update({ status: b.status, status_note: b.note ?? null }).eq("id", uuid.parse(id)).select("id,status,status_changed_at,status_changed_by_name").maybeSingle();
  if (r.error) {
    if (/status_note|status_chk|arxivada/i.test(r.error.message ?? "") || r.error.code === "42703" || r.error.code === "23514") throw new HttpError(503, "Falta aplicar la migració 021_comercialitzadores_estat.sql");
    fail(r.error, "No s'ha pogut canviar l'estat");
  }
  if (!r.data) throw new HttpError(404, "Comercialitzadora no trobada");
  return { ok: true, ...r.data };
}

/** Tot el que depèn d'una comercialitzadora (per decidir si es pot eliminar físicament). */
export async function retailerDependencies(u: U, id: string) {
  await need(u);
  const rid = uuid.parse(id);
  const sb = adminClient();
  const r = await sb.from("retailers").select("id,trade_name,aliases,status").eq("id", rid).maybeSingle();
  if (r.error) fail(r.error);
  if (!r.data) throw new HttpError(404, "Comercialitzadora no trobada");
  const names = [r.data.trade_name, ...((r.data.aliases as string[] | null) ?? [])].filter(Boolean) as string[];
  const count = async (label: string, q: PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>) => {
    const x = await q;
    return { label, count: x.error ? (isMissing(x.error) ? 0 : -1) : x.count ?? 0 };
  };
  const byName = (table: string, col: string) => {
    const or = names.map((n) => `${col}.ilike.${n.replace(/[%,()*\\]/g, " ").trim()}%`).join(",");
    return sb.from(table).select("id", { count: "exact", head: true }).or(or);
  };
  const deps = await Promise.all([
    count("Documents i contractes de col·laboració", sb.from("retailer_documents").select("id", { count: "exact", head: true }).eq("retailer_id", rid)),
    count("Lectures de condicions", sb.from("retailer_extractions").select("id", { count: "exact", head: true }).eq("retailer_id", rid)),
    count("Condicions llegides", sb.from("retailer_terms").select("id", { count: "exact", head: true }).eq("retailer_id", rid)),
    count("Regles de retrocessió", sb.from("retailer_clawback_rules").select("id", { count: "exact", head: true }).eq("retailer_id", rid)),
    count("Regles de comissió", sb.from("fin_rules").select("id", { count: "exact", head: true }).eq("retailer_id", rid)),
    count("Contactes de liquidacions", sb.from("retailer_contacts").select("id", { count: "exact", head: true }).eq("retailer_id", rid)),
    count("Reclamacions", sb.from("fin_claims").select("id", { count: "exact", head: true }).eq("retailer_id", rid)),
    count("Contractes del CRM", byName("crm_contracts", "retailer")),
    count("Liquidacions rebudes", byName("fin_provider_statements", "retailer")),
  ]);
  const total = deps.reduce((a, d) => a + Math.max(0, d.count), 0);
  const unknown = deps.some((d) => d.count < 0);
  return { retailer: r.data, deps: deps.filter((d) => d.count !== 0), total, safe: total === 0 && !unknown };
}

/** Eliminació física: només Direcció, sense cap dependència i amb el nom escrit com a segona confirmació. */
export async function deleteRetailer(u: U, id: string, raw: unknown) {
  adminOnly(u, "Només Direcció pot eliminar comercialitzadores");
  const b = z.object({ confirmName: z.string().trim().min(1).max(200), confirmed: z.literal(true) }).parse(raw);
  const d = await retailerDependencies(u, id);
  if (!d.safe) throw new HttpError(409, `No es pot eliminar: té ${d.total} registre(s) relacionat(s) (${d.deps.map((x) => `${x.label}: ${x.count < 0 ? "?" : x.count}`).join(", ")}). Desactiva-la o arxiva-la per conservar-ne l'historial.`);
  if (b.confirmName.toLowerCase() !== String(d.retailer.trade_name).toLowerCase()) throw new HttpError(400, "El nom escrit no coincideix amb el de la comercialitzadora");
  await secLog(u, "comercialitzadora_eliminada", "retailers", id, { name: d.retailer.trade_name, status: d.retailer.status });
  const del = await adminClient().from("retailers").delete().eq("id", d.retailer.id);
  if (del.error) {
    if (del.error.code === "23503") throw new HttpError(409, "La base de dades ha detectat registres relacionats: no s'ha eliminat. Desactiva-la o arxiva-la.");
    fail(del.error, "No s'ha pogut eliminar");
  }
  return { ok: true };
}

/* ======================================================================= garanties de confidencialitat de la IA */

export type AiPolicy = { enabled: boolean; provider: "anthropic"; dpa_reference: string | null; zero_retention: boolean; no_training: boolean; confirmed_by: string | null; confirmed_at: string | null; note: string | null };
const DEFAULT_POLICY: AiPolicy = { enabled: false, provider: "anthropic", dpa_reference: null, zero_retention: false, no_training: false, confirmed_by: null, confirmed_at: null, note: null };
export async function aiPolicy(): Promise<AiPolicy> {
  try {
    const { data } = await adminClient().from("sec_settings").select("value").eq("key", "ia_contractes").maybeSingle();
    return { ...DEFAULT_POLICY, ...((data?.value as Partial<AiPolicy>) ?? {}) };
  } catch { return DEFAULT_POLICY; }
}
export async function setAiPolicy(u: U, raw: unknown) {
  adminOnly(u, "Només Direcció configura l'enviament de contractes a la IA");
  const b = z.object({ enabled: z.boolean(), dpa_reference: z.string().trim().max(300).nullable().optional(), zero_retention: z.boolean().default(false), no_training: z.boolean().default(false), note: z.string().trim().max(1000).nullable().optional() }).parse(raw);
  if (b.enabled && (!b.dpa_reference || !b.no_training)) throw new HttpError(400, "Per activar-ho cal indicar la referència de l'acord de tractament de dades (DPA) amb el proveïdor i confirmar que les dades no s'usen per entrenar models");
  const value: AiPolicy = { ...DEFAULT_POLICY, enabled: b.enabled, dpa_reference: b.dpa_reference ?? null, zero_retention: b.zero_retention, no_training: b.no_training, note: b.note ?? null, confirmed_by: u.profile.name, confirmed_at: new Date().toISOString() };
  const { error } = await u.sb.from("sec_settings").upsert({ key: "ia_contractes", value, updated_by: u.user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) fail(error);
  await secLog(u, b.enabled ? "ia_contractes_activada" : "ia_contractes_desactivada", "sec_settings", "ia_contractes", { dpa: !!b.dpa_reference, zero_retention: b.zero_retention, no_training: b.no_training });
  return { ok: true, policy: value };
}

/* ======================================================================= fitxes */

const retailerInput = z.object({
  trade_name: z.string().trim().min(1).max(120), legal_name: z.string().trim().max(200).nullable().optional(), tax_id: z.string().trim().max(20).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).default([]), website: z.string().trim().max(300).nullable().optional(),
  contact_name: z.string().trim().max(160).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), email: z.string().trim().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  services: z.array(z.enum(["llum", "gas", "fibra", "assegurances", "altres"])).max(5).default([]),
  // l'estat de la fitxa: en editar no es toca si no s'envia (activar/desactivar/arxivar es fa amb set_status, només Direcció)
  status: z.enum(["activa", "pendent", "suspesa", "inactiva"]).optional(),
  special_conditions: z.string().trim().max(5000).nullable().optional(), notes: z.string().trim().max(5000).nullable().optional(),
});

export async function listRetailers(u: U) {
  await need(u);
  const [r, docs, terms, policy] = await Promise.all([
    u.sb.from("retailers").select("*").order("trade_name"),
    u.sb.from("retailer_documents").select("retailer_id,status,valid_to,renewal_notice_days"),
    u.sb.from("retailer_terms").select("retailer_id,review_status"),
    aiPolicy(),
  ]);
  if (r.error) fail(r.error);
  const today = new Date().toISOString().slice(0, 10);
  return {
    rows: (r.data ?? []).map((x) => {
      const d = (docs.data ?? []).filter((y) => y.retailer_id === x.id);
      const live = d.filter((y) => y.status === "vigent");
      const soon = live.filter((y) => y.valid_to && new Date(y.valid_to).getTime() - Date.now() <= (y.renewal_notice_days ?? 60) * 86_400_000 && y.valid_to >= today);
      return { ...x, documents: d.length, vigents: live.length, venciments: soon.length, pendents: (terms.data ?? []).filter((t) => t.retailer_id === x.id && ["pendent", "revisio_manual"].includes(t.review_status)).length };
    }),
    ai: { configured: !!env.anthropicKey, policy }, canEdit: await retailerAccess(u, "edit"), canApprove: u.profile.role === "admin", economic: await finStaff(u),
  };
}

export async function saveRetailer(u: U, raw: unknown, id?: string) {
  await need(u, "edit");
  const b = retailerInput.parse(raw);
  if (id) {
    const cur = await u.sb.from("retailers").select("status").eq("id", uuid.parse(id)).maybeSingle();
    // una comercialitzadora desactivada o arxivada només la reactiva Direcció (set_status), no l'edició de la fitxa
    if (cur.data && b.status && b.status !== cur.data.status && (["inactiva", "arxivada"].includes(cur.data.status as string) || b.status === "inactiva") && u.profile.role !== "admin") delete b.status;
    if (cur.data?.status === "arxivada") delete b.status;
  }
  const r = id ? await u.sb.from("retailers").update(b).eq("id", uuid.parse(id)).select("id").single() : await u.sb.from("retailers").insert({ ...b, status: b.status ?? "pendent" }).select("id").single();
  if (r.error) fail(r.error, "No s'ha pogut desar la comercialitzadora");
  return { id: r.data!.id as string };
}

export async function getRetailer(u: U, id: string) {
  await need(u);
  if (!id?.trim()) throw new HttpError(400, "Falta l'identificador de la comercialitzadora");
  const p = uuid.safeParse(id.trim());
  if (!p.success) throw new HttpError(400, "Identificador de comercialitzadora no vàlid");
  const rid = p.data;
  const r = await u.sb.from("retailers").select("*").eq("id", rid).maybeSingle();
  if (r.error) fail(r.error);
  if (!r.data) throw new HttpError(404, "Comercialitzadora no trobada");
  const names = [r.data.trade_name as string, ...((r.data.aliases as string[]) ?? [])];
  const [docs, ex, terms, rules, claws, policy] = await Promise.all([
    u.sb.from("retailer_documents").select("*").eq("retailer_id", rid).order("created_at", { ascending: false }),
    u.sb.from("retailer_extractions").select("*").eq("retailer_id", rid).order("created_at", { ascending: false }).limit(50),
    u.sb.from("retailer_terms").select("*").eq("retailer_id", rid).order("created_at", { ascending: true }).limit(2000),
    u.sb.from("fin_rules").select("id,rule_key,version,name,product,service,segment,kind,value,unit,tiers,conditions,base_formula,base_validated,valid_from,valid_to,status,retailer,retailer_id,source_document_id,approved_at").eq("layer", "proveidor").order("rule_key").order("version", { ascending: false }),
    u.sb.from("retailer_clawback_rules").select("*").eq("retailer_id", rid).order("rule_key").order("version", { ascending: false }),
    aiPolicy(),
  ]);
  const ruleRows = ((rules.data ?? []) as { retailer_id: string | null; retailer: string | null }[]).filter((x) => x.retailer_id === rid || (x.retailer && matchesRetailer(x.retailer, { trade_name: names[0], aliases: names.slice(1) })));
  let logoUrl: string | null = null;
  if (r.data.logo_path) logoUrl = (await adminClient().storage.from(BUCKET).createSignedUrl(r.data.logo_path, 600)).data?.signedUrl ?? null;
  // risc econòmic per producte (només amb permís econòmic): contractes vius d'aquesta comercialitzadora amb la comissió prevista
  let productContracts: { product: string | null; start: string | null; expected: number }[] | null = null;
  if (await finStaff(u)) {
    const ks = await u.sb.from("crm_contracts").select("id,retailer,product,status,start_date,signed_at").in("status", ["actiu", "renovacio_pendent"]).limit(20000);
    const mine = ((ks.data ?? []) as { id: string; retailer: string; product: string | null; start_date: string | null; signed_at: string | null }[]).filter((k) => matchesRetailer(k.retailer, { trade_name: names[0], aliases: names.slice(1) }));
    const calc = new Map<string, number>();
    for (let i = 0; i < mine.length; i += 300) {
      const c = await u.sb.from("fin_calculations").select("contract_id,amount,status").eq("layer", "proveidor").eq("is_current", true).in("contract_id", mine.slice(i, i + 300).map((k) => k.id));
      for (const x of (c.data ?? []) as { contract_id: string; amount: string | null; status: string }[]) if (x.status === "calculat" && x.amount != null) calc.set(x.contract_id, Number(x.amount));
    }
    productContracts = mine.map((k) => ({ product: k.product, start: k.start_date ?? k.signed_at, expected: calc.get(k.id) ?? 0 }));
  }
  return {
    productContracts,
    retailer: { ...r.data, logoUrl }, documents: docs.data ?? [], extractions: ex.data ?? [], terms: terms.data ?? [], rules: ruleRows, clawbacks: claws.data ?? [],
    ai: { configured: !!env.anthropicKey, policy }, canEdit: await retailerAccess(u, "edit"), canApprove: u.profile.role === "admin",
  };
}

/* ======================================================================= pujada segura */

const ticketKey = () => createHash("sha256").update(`retailer-upload|${process.env.SETTINGS_ENCRYPTION_KEY || env.supabaseService}`).digest();
type Ticket = { u: string; r: string; p: string; e: string; n: string; s: number; k: "document" | "logo"; exp: number };
const sign = (t: Ticket) => { const b = Buffer.from(JSON.stringify(t)).toString("base64url"); return `${b}.${createHmac("sha256", ticketKey()).update(b).digest("base64url")}`; };
function verify(ticket: string, userId: string): Ticket {
  const [b, mac] = ticket.split(".");
  if (!b || !mac) throw new HttpError(400, "Tiquet de pujada no vàlid");
  const want = createHmac("sha256", ticketKey()).update(b).digest(), got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(400, "Tiquet de pujada no vàlid");
  const t = JSON.parse(Buffer.from(b, "base64url").toString()) as Ticket;
  if (t.u !== userId) throw new HttpError(403, "Aquesta pujada no és teva");
  if (t.exp < Date.now()) throw new HttpError(410, "La pujada ha caducat. Torna-ho a provar.");
  return t;
}

export async function requestUpload(u: U, raw: unknown) {
  await need(u, "edit");
  const b = z.object({ retailerId: uuid, fileName: z.string().min(1).max(255), size: z.number().int().positive(), purpose: z.enum(["document", "logo"]).default("document") }).parse(raw);
  const ext = extOf(b.fileName);
  const allowed = b.purpose === "logo" ? ["png", "jpg", "jpeg"] : Object.keys(TYPES);
  if (!allowed.includes(ext)) throw new HttpError(415, `Format no admès (.${ext || "?"}). Admesos: ${allowed.join(", ").toUpperCase()}`);
  if (b.size > (b.purpose === "logo" ? 2 * 1024 * 1024 : MAX_BYTES)) throw new HttpError(413, b.purpose === "logo" ? "El logo supera els 2 MB" : "El fitxer supera els 25 MB");
  const r = await u.sb.from("retailers").select("id").eq("id", b.retailerId).maybeSingle();
  if (!r.data) throw new HttpError(404, "Comercialitzadora no trobada");
  const path = `${b.retailerId}/${b.purpose === "logo" ? "logo-" : ""}${randomUUID()}.${ext}`;
  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new HttpError(/not found/i.test(error?.message ?? "") ? 409 : 502, /not found/i.test(error?.message ?? "") ? "Falta el bucket retailer-contracts: aplica la migració 017" : "No s'ha pogut preparar la pujada");
  return { ticket: sign({ u: u.user.id, r: b.retailerId, p: path, e: ext, n: safeFileName(b.fileName), s: b.size, k: b.purpose, exp: Date.now() + 30 * 60_000 }), path, token: data.token, signedUrl: data.signedUrl };
}

const finalizeInput = z.object({
  ticket: z.string().min(10).max(4000), title: z.string().trim().max(200).optional(), kind: z.enum(["contracte", "annex", "tarifes", "condicions", "altres"]).default("contracte"),
  parentId: uuid.nullable().optional(), supersedesId: uuid.nullable().optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  renewalNoticeDays: z.number().int().min(0).max(730).optional(),
});
export async function finalizeUpload(u: U, raw: unknown) {
  await need(u, "edit");
  const b = finalizeInput.parse(raw);
  const t = verify(b.ticket, u.user.id);
  const admin = adminClient();
  const remove = () => admin.storage.from(BUCKET).remove([t.p]).then(() => undefined, () => undefined);
  const dl = await admin.storage.from(BUCKET).download(t.p);
  if (dl.error || !dl.data) throw new HttpError(404, "No s'ha rebut el fitxer. Torna'l a pujar.");
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) { await remove(); throw new HttpError(413, "Mida de fitxer no vàlida"); }
  const sniff = sniffDoc(bytes, t.e);
  if (!sniff.ok) { await remove(); throw new HttpError(415, sniff.reason ?? "Contingut no vàlid"); }
  if (sniff.zip) {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.keys(zip.files);
      if (!zipKindOk(t.e, entries, null) || entries.some((e) => /vbaProject\.bin$/i.test(e))) { await remove(); throw new HttpError(415, "El document (DOCX/XLSX) no és vàlid o conté macros"); }
    } catch (e) { await remove(); if (e instanceof HttpError) throw e; throw new HttpError(415, "El fitxer està malmès"); }
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (t.k === "logo") {
    const up = await u.sb.from("retailers").update({ logo_path: t.p }).eq("id", t.r).select("id");
    if (up.error || !up.data?.length) { await remove(); fail(up.error, "No s'ha pogut desar el logo"); }
    return { ok: true, logo: true };
  }
  let version = 1;
  if (b.supersedesId) {
    const prev = await u.sb.from("retailer_documents").select("id,retailer_id,version").eq("id", b.supersedesId).maybeSingle();
    if (!prev.data || prev.data.retailer_id !== t.r) { await remove(); throw new HttpError(400, "El document que substitueix no és d'aquesta comercialitzadora"); }
    version = prev.data.version + 1;
  }
  const ins = await u.sb.from("retailer_documents").insert({
    retailer_id: t.r, kind: b.kind, parent_id: b.parentId ?? null, supersedes_id: b.supersedesId ?? null, title: b.title || t.n.replace(/\.[^.]+$/, ""), version,
    valid_from: b.validFrom ?? null, valid_to: b.validTo ?? null, renewal_notice_days: b.renewalNoticeDays ?? 60, status: "en_revisio",
    storage_path: t.p, original_name: t.n, mime: TYPES[t.e], size_bytes: bytes.byteLength, sha256,
  }).select("id").single();
  if (ins.error) { await remove(); if (ins.error.code === "23505") throw new HttpError(409, "Aquest mateix fitxer ja s'ha pujat per a aquesta comercialitzadora"); fail(ins.error); }
  return { id: ins.data!.id as string, version, sha256 };
}

export async function documentUrl(u: U, id: string, download = false) {
  await need(u);
  const d = await u.sb.from("retailer_documents").select("id,retailer_id,storage_path,original_name").eq("id", uuid.parse(id)).maybeSingle();
  if (!d.data?.storage_path) throw new HttpError(404, "Document no trobat");
  if (!d.data.storage_path.startsWith(`${d.data.retailer_id}/`)) throw new HttpError(400, "Ruta no vàlida");
  const s = await adminClient().storage.from(BUCKET).createSignedUrl(d.data.storage_path, 60, download ? { download: safeFileName(d.data.original_name ?? "contracte") } : undefined);
  if (s.error || !s.data) throw new HttpError(502, "No s'ha pogut obrir el document");
  await secLog(u, download ? "contracte_comercialitzadora_descarregat" : "contracte_comercialitzadora_consultat", "retailer_documents", id, null);
  return { url: s.data.signedUrl, expiresIn: 60 };
}

export async function updateDocument(u: U, id: string, raw: unknown) {
  await need(u, "edit");
  const b = z.object({ title: z.string().trim().min(1).max(200).optional(), status: z.enum(["esborrany", "en_revisio", "vencut", "anullat"]).optional(), valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), renewal_notice_days: z.number().int().min(0).max(730).optional(), auto_renewal: z.boolean().nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() }).parse(raw);
  const { data, error } = await u.sb.from("retailer_documents").update(b).eq("id", uuid.parse(id)).select("id");
  if (error) fail(error);
  if (!data?.length) throw new HttpError(404, "Document no trobat");
  return { ok: true };
}
export async function activateDocument(u: U, id: string) {
  adminOnly(u, "Només Direcció activa un contracte com a vigent");
  const { error } = await u.sb.rpc("retailer_activate_document", { p_doc: uuid.parse(id) });
  if (error) fail(error);
  return { ok: true };
}

/* ======================================================================= ANÀLISI (lectura intel·ligent) */

/** Extreu el text d'un document (sense xarxa). */
async function docText(bytes: Uint8Array, ext: string): Promise<DocText> {
  try {
    if (ext === "pdf") return await pdfText(bytes);
    if (ext === "docx") return await docxText(bytes);
    if (ext === "xlsx" || ext === "csv") return await sheetText(bytes, ext);
    return { kind: "image", pages: [], chars: 0, scanned: true, tables: 0 };
  } catch (e) {
    if (e instanceof PdfProblem) throw e; // motiu concret: protegit, malmès o no és un PDF
    throw new HttpError(422, "No s'ha pogut llegir el document (malmès o protegit amb contrasenya)");
  }
}
/** Contingut que rep la IA: el PDF original (amb OCR si és escanejat), la imatge o el text extret (DOCX, Excel). */
async function aiContent(bytes: Uint8Array, ext: string, text: DocText): Promise<Content[]> {
  if (ext === "pdf") return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from((await preparePdf(bytes)).bytes).toString("base64") } }];
  if (ext === "docx" || ext === "xlsx" || ext === "csv") return [{ type: "text", text: text.pages.map((p, i) => `<pagina n="${i + 1}">\n${p}\n</pagina>`).join("\n") }];
  const img = await imageForAi(bytes, TYPES[ext]);
  return [{ type: "image", source: { type: "base64", media_type: img.media, data: img.data.toString("base64") } }];
}
async function loadDoc(u: U, id: string) {
  const d = await u.sb.from("retailer_documents").select("id,retailer_id,storage_path,original_name,mime,title,version").eq("id", uuid.parse(id)).maybeSingle();
  if (!d.data?.storage_path) throw new HttpError(404, "Document no trobat");
  const ext = extOf(d.data.original_name ?? d.data.storage_path);
  const dl = await adminClient().storage.from(BUCKET).download(d.data.storage_path);
  if (dl.error || !dl.data) throw new HttpError(404, "No s'ha trobat el fitxer al bucket");
  return { doc: d.data as { id: string; retailer_id: string; storage_path: string; original_name: string | null; title: string; version: number }, ext, bytes: new Uint8Array(await dl.data.arrayBuffer()) };
}
const termRow = (t: ExtractedTerm, exId: string, documentId: string, retailerId: string) => ({
  extraction_id: exId, document_id: documentId, retailer_id: retailerId, category: t.category, field: t.field, product: t.product, tariff: t.tariff, service: t.service, segment: t.segment,
  period_label: t.period_label, value: t.value, unit: t.unit, tiers: t.tiers, formula: t.formula, conditions: t.conditions ?? {}, valid_from: t.valid_from, valid_to: t.valid_to,
  page: t.page, excerpt: t.excerpt.slice(0, 1500), excerpt_found: t.excerpt_found, interpretation: t.interpretation, confidence: Math.round(t.confidence * 1000) / 1000,
  ambiguous: t.ambiguous, ambiguity_reason: t.ambiguity_reason, source: t.source, review_status: reviewStatusOf(t),
});
// temps màxim de cada lectura (la ruta té maxDuration = 300 s): es deixa marge per desar els resultats
const AI_BUDGET_MS = 250_000;

/**
 * LECTURA IA UNIFICADA (1a passada): comissions, decomissions i retrocessions del document SENCER, relacionades entre si
 * i amb els productes. La 2a passada (comprovació de coherència) és `verifyExtraction`, que la pantalla llança tot seguit.
 */
export async function analyzeDocument(u: U, id: string, raw: unknown) {
  await need(u, "edit");
  const { mode } = z.object({ mode: z.enum(["auto", "local"]).default("auto") }).parse(raw ?? {});
  const policy = await aiPolicy();
  const useAi = mode === "auto" && policy.enabled && !!env.anthropicKey;
  const { doc, ext, bytes } = await loadDoc(u, id);
  const text = await docText(bytes, ext);
  const ex = await u.sb.from("retailer_extractions").insert({ document_id: doc.id, retailer_id: doc.retailer_id, status: "processant", method: useAi ? "ia" : "local", provider: useAi ? policy.provider : null, model: useAi ? env.anthropicModel : null, ocr_used: text.scanned && useAi, pages: text.pages.length || null, text_chars: text.chars }).select("id").single();
  if (ex.error) fail(ex.error);
  const exId = ex.data!.id as string;
  const finish = (patch: Record<string, unknown>) => u.sb.from("retailer_extractions").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", exId);
  try {
    if (text.scanned && !useAi) {
      const why = !env.anthropicKey ? "no hi ha cap proveïdor d'IA configurat al servidor" : !policy.enabled ? "Direcció encara no ha confirmat les garanties de confidencialitat per enviar contractes a la IA" : "s'ha triat la lectura local";
      await finish({ status: "error", error: `Document escanejat o imatge: cal OCR i ${why}. Pots introduir les condicions a mà o activar la IA amb garanties.` });
      return { id: exId, status: "error", terms: 0, needsOcr: true };
    }
    let terms: ExtractedTerm[];
    let summary: Record<string, unknown> | null = null;
    const warnings: string[] = [];
    if (useAi) {
      await secLog(u, "contracte_enviat_ia", "retailer_documents", doc.id, { provider: policy.provider, model: env.anthropicModel, dpa: policy.dpa_reference, pages: text.pages.length, ocr: text.scanned });
      const ai = await callTool({ system: READER_SYSTEM, content: await aiContent(bytes, ext, text), tool: READER_TOOL, maxTokens: 32000, budgetMs: AI_BUDGET_MS, instruction: "Llegeix el document sencer i registra totes les condicions amb l'eina registrar_condicions, relacionades entre si i amb els productes." });
      const out = parseReaderOutput(ai.input);
      // una resposta buida NO és una extracció correcta
      if (!out.terms.length) throw new HttpError(422, `La IA ha respost però no ha extret cap condició${out.rejected.length ? ` (${out.rejected.length} descartades per format no vàlid: ${[...new Set(out.rejected)].slice(0, 2).join("; ")})` : ""}. Torna-ho a provar o introdueix-les a mà (diagnòstic ${ai.diag})`);
      const x = expandTerms(out, { pages: text.pages, textAvailable: !text.scanned && text.kind !== "image" });
      terms = x.terms;
      warnings.push(...x.warnings);
      if (ai.truncated) warnings.push("La resposta de la IA s'ha tallat abans d'acabar: s'han desat les condicions completes. La comprovació de coherència buscarà les que faltin.");
      if (out.contradictions.length) warnings.push(`${out.contradictions.length} contradicció(ns) entre apartats del document: ${out.contradictions.map((c) => c.description).slice(0, 3).join(" · ")}`);
      summary = { ...out.summary, products: out.products, contradictions: out.contradictions, reader: { products: out.products, terms: out.terms }, verification: { status: "pendent" }, tokens: ai.usage, diag: ai.diag, response_mode: ai.mode };
      if (!text.scanned && text.kind !== "image") { const extra = missedByAi(terms, localExtract(text.pages)); if (extra.length) warnings.push(`${extra.length} condicions detectades pel lector local que la IA no havia proposat (marcades per revisar)`); terms = [...terms, ...extra]; }
    } else {
      terms = localExtract(text.pages);
      warnings.push(policy.enabled ? "Lectura local triada manualment (sense IA)." : "Lectura LOCAL sense IA: detecta els patrons habituals (€/MWh, €/kWh, imports fixos, %, retrocessions, permanències, vigència). Revisa que no falti cap clàusula.");
    }
    if (text.tables) warnings.push(`El document té ${text.tables} taula(es) o full(s): revisa que cada fila s'hagi interpretat bé.`);
    if (!terms.length) warnings.push("No s'ha detectat cap condició econòmica. Revisa el document a mà.");
    for (let i = 0; i < Math.min(terms.length, 600); i += 200) {
      const ins = await u.sb.from("retailer_terms").insert(terms.slice(i, Math.min(i + 200, 600)).map((t) => termRow(t, exId, doc.id, doc.retailer_id)));
      if (ins.error) fail(ins.error, "No s'han pogut desar les condicions extretes");
    }
    await finish({ status: "completada", summary, warnings });
    return { id: exId, status: "completada", terms: terms.length, manual: terms.filter((t) => reviewStatusOf(t) === "revisio_manual").length, method: useAi ? "ia" : "local", verify: useAi };
  } catch (e) {
    await finish({ status: "error", error: e instanceof Error ? e.message.slice(0, 500) : "Error desconegut" });
    throw e;
  }
}

/**
 * COMPROVACIÓ DE COHERÈNCIA (2a passada): la IA torna a llegir el document amb la llista de condicions extretes i
 * busca les que falten, abasts incorrectes, excepcions no aplicades, valors mal llegits i contradiccions.
 * Les condicions afectades passen a «REVISIÓ MANUAL NECESSÀRIA»; les noves s'afegeixen marcades per revisar.
 */
export async function verifyExtraction(u: U, extractionId: string) {
  await need(u, "edit");
  const e = await u.sb.from("retailer_extractions").select("id,document_id,retailer_id,status,method,summary,warnings").eq("id", uuid.parse(extractionId)).maybeSingle();
  if (!e.data) throw new HttpError(404, "Lectura no trobada");
  const sum = (e.data.summary ?? {}) as Record<string, unknown> & { reader?: { products: unknown[]; terms: unknown[] }; verification?: { status: string } };
  if (e.data.method !== "ia" || !sum.reader) throw new HttpError(400, "Aquesta lectura no és de la IA");
  if (sum.verification?.status === "feta") return { ok: true, already: true };
  const policy = await aiPolicy();
  if (!policy.enabled || !env.anthropicKey) throw new HttpError(409, "La IA no està activada amb garanties");
  const { doc, ext, bytes } = await loadDoc(u, e.data.document_id as string);
  const text = await docText(bytes, ext);
  const prev = parseReaderOutput(sum.reader);
  const ai = await callTool({
    system: VERIFY_SYSTEM, content: await aiContent(bytes, ext, text), tool: VERIFY_TOOL, maxTokens: 16000, budgetMs: AI_BUDGET_MS,
    instruction: `Condicions ja extretes (JSON):\n${verifyContext(prev)}\n\nFes la comprovació de coherència i registra-la amb l'eina registrar_comprovacio.`,
  });
  const v = parseVerifyOutput(ai.input);
  const warnings = [...((e.data.warnings as string[]) ?? []), ...v.warnings];
  // 1) condicions que faltaven
  const added = expandTerms({ summary: {}, products: [...prev.products, ...v.newProducts.filter((p) => !prev.products.some((x) => x.key === p.key))], terms: v.missing, contradictions: [], warnings: [], rejected: [] }, { pages: text.pages, textAvailable: !text.scanned && text.kind !== "image" })
    .terms.map((t) => ({ ...t, ambiguous: true, confidence: Math.min(t.confidence, 0.6), conditions: { ...t.conditions, added_by_verification: true }, ambiguity_reason: ["Afegida a la comprovació de coherència: la primera lectura no l'havia detectat", t.ambiguity_reason].filter(Boolean).join(" · ") }));
  if (added.length) {
    const ins = await u.sb.from("retailer_terms").insert(added.map((t) => termRow(t, e.data!.id as string, doc.id, doc.retailer_id)));
    if (ins.error) fail(ins.error, "No s'han pogut desar les condicions afegides");
  }
  // 2) problemes i contradiccions → les condicions afectades queden per revisar
  const notes = new Map<string, string[]>();
  for (const i of v.issues) notes.set(i.term, [...(notes.get(i.term) ?? []), `Comprovació de coherència (${i.kind}): ${i.description}${i.pages.length ? ` (pàg. ${i.pages.join(", ")})` : ""}`]);
  for (const c of v.contradictions) for (const t of c.terms) notes.set(t, [...(notes.get(t) ?? []), `Contradicció: ${c.description}`]);
  let flagged = 0;
  if (notes.size) {
    const rows = ((await u.sb.from("retailer_terms").select("id,conditions,ambiguity_reason,review_status").eq("extraction_id", e.data.id)).data ?? []) as { id: string; conditions: Record<string, unknown> | null; ambiguity_reason: string | null; review_status: string }[];
    for (const r of rows) {
      const n = notes.get(String(r.conditions?.group ?? ""));
      if (!n || !["pendent", "revisio_manual"].includes(r.review_status)) continue;
      const up = await u.sb.from("retailer_terms").update({ ambiguous: true, review_status: "revisio_manual", ambiguity_reason: [r.ambiguity_reason, ...n].filter(Boolean).join(" · ").slice(0, 2000), conditions: { ...(r.conditions ?? {}), verification: n } }).eq("id", r.id);
      if (!up.error) flagged++;
    }
  }
  if (ai.truncated) warnings.push("La comprovació de coherència s'ha tallat abans d'acabar: revisa el document a mà per si falta alguna condició.");
  const verification = { status: "feta", at: new Date().toISOString(), added: added.length, issues: v.issues.length, flagged, contradictions: v.contradictions.length, tokens: ai.usage };
  await u.sb.from("retailer_extractions").update({ summary: { ...sum, verification, contradictions: [...((sum.contradictions as unknown[]) ?? []), ...v.contradictions] }, warnings: [...warnings, `Comprovació de coherència feta: ${added.length} condició(ns) afegida(es), ${flagged} marcada(es) per revisar.`] }).eq("id", e.data.id);
  return { ok: true, ...verification };
}

/* ======================================================================= revisió i aprovació */

const patchInput = z.object({
  field: z.string().min(2).max(40).optional(), product: z.string().max(80).nullable().optional(), tariff: z.string().max(30).nullable().optional(), service: z.string().max(40).nullable().optional(),
  value: z.number().finite().nullable().optional(), unit: z.enum(["eur", "eur_mwh", "eur_kwh", "pct", "mesos", "dies"]).nullable().optional(), formula: z.string().max(500).nullable().optional(),
  tiers: z.array(z.object({ threshold: z.number(), amount: z.number() })).max(30).nullable().optional(), conditions: z.record(z.unknown()).optional(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), note: z.string().max(1000).optional(),
}).strict();

export async function reviewTerms(u: U, raw: unknown) {
  const b = z.object({ ids: z.array(uuid).min(1).max(600), action: z.enum(["approve", "reject", "manual"]), patch: patchInput.optional(), confirmManual: z.boolean().default(false), baseValidated: z.boolean().default(false), note: z.string().max(1000).optional() }).parse(raw);
  if (b.action === "approve") adminOnly(u, "Només Direcció aprova condicions econòmiques");
  else await need(u, "edit");
  if (b.patch && b.ids.length > 1) throw new HttpError(400, "Les correccions s'apliquen a una condició cada vegada");
  const results: { id: string; ok: boolean; error?: string; result?: unknown }[] = [];
  for (const id of b.ids) {
    if (b.action === "approve") {
      const patch = { ...(b.patch ?? {}), ...(b.note ? { note: b.note } : {}) };
      const { data, error } = await u.sb.rpc("retailer_approve_term", { p_term: id, p_patch: patch, p_confirm_manual: b.confirmManual, p_base_validated: b.baseValidated });
      results.push(error ? { id, ok: false, error: error.message } : { id, ok: true, result: data });
    } else {
      const { data, error } = await u.sb.from("retailer_terms").update(b.action === "reject" ? { review_status: "rebutjada", review_note: b.note ?? null } : { review_status: "revisio_manual", ambiguous: true, review_note: b.note ?? null }).eq("id", id).select("id");
      results.push(error ? { id, ok: false, error: error.message } : { id, ok: !!data?.length, ...(data?.length ? {} : { error: "No trobada" }) });
    }
  }
  return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

export async function editTerm(u: U, id: string, raw: unknown) {
  await need(u, "edit");
  const { note, ...p } = patchInput.parse(raw);
  if (p.conditions) {
    // es fusionen amb les condicions existents (no se'n perd cap: mode, inici del còmput, excepcions…)
    const cur = await u.sb.from("retailer_terms").select("conditions").eq("id", uuid.parse(id)).maybeSingle();
    p.conditions = { ...((cur.data?.conditions as Record<string, unknown>) ?? {}), ...p.conditions };
  }
  const { data, error } = await u.sb.from("retailer_terms").update({ ...p, ...(note ? { review_note: note } : {}) }).eq("id", uuid.parse(id)).select("id");
  if (error) fail(error);
  if (!data?.length) throw new HttpError(404, "Condició no trobada");
  return { ok: true };
}

/** Condició introduïda a mà per Direcció (p. ex. documents escanejats sense IA). Exigeix el fragment del contracte. */
export async function addManualTerm(u: U, raw: unknown) {
  await need(u, "edit");
  const b = patchInput.omit({ note: true }).extend({ documentId: uuid, category: z.enum(["remuneracio", "retrocessio", "penalitzacio", "permanencia", "vigencia", "pagament", "altres"]), field: z.string().min(2).max(40), excerpt: z.string().trim().min(3).max(1500), page: z.number().int().min(1).max(2000).nullable().optional() }).parse(raw);
  const d = await u.sb.from("retailer_documents").select("id,retailer_id").eq("id", b.documentId).maybeSingle();
  if (!d.data) throw new HttpError(404, "Document no trobat");
  const ex = await u.sb.from("retailer_extractions").insert({ document_id: d.data.id, retailer_id: d.data.retailer_id, status: "completada", method: "local", warnings: ["Condició introduïda manualment"], finished_at: new Date().toISOString() }).select("id").single();
  if (ex.error) fail(ex.error);
  const { documentId: _d, ...t } = b;
  void _d;
  const ins = await u.sb.from("retailer_terms").insert({ ...t, extraction_id: ex.data!.id, document_id: d.data.id, retailer_id: d.data.retailer_id, conditions: t.conditions ?? {}, source: "manual", excerpt_found: false, confidence: 1, ambiguous: false, review_status: "revisio_manual", interpretation: "Introduïda manualment" }).select("id").single();
  if (ins.error) fail(ins.error);
  return { id: ins.data!.id as string };
}

export async function applyClawback(u: U, raw: unknown) {
  adminOnly(u, "Només Direcció registra retrocessions definitives");
  const b = z.object({ contractId: uuid, ruleId: uuid, amount: z.number().positive().max(1_000_000), statementLineId: uuid.nullable().optional(), evidence: z.string().trim().max(500).nullable().optional() }).parse(raw);
  const { data, error } = await u.sb.rpc("retailer_apply_clawback", { p_contract: b.contractId, p_rule: b.ruleId, p_amount: b.amount, p_statement_line: b.statementLineId ?? null, p_evidence: b.evidence ?? null });
  if (error) { if (error.code === "23505") throw new HttpError(409, "Aquesta retrocessió ja està registrada"); fail(error); }
  return { id: data as string };
}

/* ======================================================================= PANELL ECONÒMIC */

type Calc = { contract_id: string; amount: string | null; status: string; created_at: string };
type Led = { contract_id: string | null; kind: string; amount: string; period: string; statement_line_id: string | null };
export async function retailerDashboard(u: U, raw: Record<string, string> = {}, now = new Date()) {
  await need(u);
  if (!(await finStaff(u))) throw new HttpError(403, "El panell econòmic de comercialitzadores és una dada econòmica restringida (Direcció o permís «economia»)");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(raw.from ?? "") ? raw.from : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const in90 = new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
  const page = async <T,>(q: (a: number, b: number) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>) => {
    const out: T[] = [];
    for (let a = 0; a < 20_000; a += 1000) { const { data, error } = await q(a, a + 999); if (error) fail(error); const rows = (data ?? []) as T[]; out.push(...rows); if (rows.length < 1000) break; }
    return out;
  };
  const [rs, contracts, calcs, ledger, lines, claws, docs] = await Promise.all([
    u.sb.from("retailers").select("id,trade_name,aliases,status").order("trade_name"),
    page<{ id: string; retailer: string; product: string | null; status: string; start_date: string | null; signed_at: string | null; end_date: string | null; created_at: string; crm_supplies: { annual_kwh: number | null } | { annual_kwh: number | null }[] | null }>((a, b) =>
      u.sb.from("crm_contracts").select("id,retailer,product,status,start_date,signed_at,end_date,created_at,crm_supplies!crm_contracts_supply_id_fkey(annual_kwh)").or(`created_at.gte.${from},status.in.(actiu,renovacio_pendent)`).range(a, b)),
    page<Calc>((a, b) => u.sb.from("fin_calculations").select("contract_id,amount,status,created_at").eq("layer", "proveidor").eq("is_current", true).range(a, b)),
    page<Led>((a, b) => u.sb.from("fin_ledger").select("contract_id,kind,amount,period,statement_line_id").eq("layer", "proveidor").range(a, b)),
    page<{ id: string; amount: string; expected_amount: string | null; difference: string | null; kind: string; match_status: string; contract_id: string | null; fin_provider_statements: { retailer: string; reference: string; received_at: string } | { retailer: string; reference: string; received_at: string }[] | null }>((a, b) =>
      u.sb.from("fin_statement_lines").select("id,amount,expected_amount,difference,kind,match_status,contract_id,fin_provider_statements(retailer,reference,received_at)").range(a, b)),
    u.sb.from("retailer_clawback_rules").select("*").eq("status", "aprovada"),
    u.sb.from("retailer_documents").select("id,retailer_id,title,valid_to,renewal_notice_days,status").eq("status", "vigent"),
  ]);
  if (rs.error) fail(rs.error);
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x) ?? null;
  const R = (rs.data ?? []) as { id: string; trade_name: string; aliases: string[]; status: string }[];
  const owner = (name: string | null | undefined) => R.find((r) => matchesRetailer(name, r))?.id ?? null;
  const n = (x: string | number | null | undefined) => Number(x ?? 0);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const byContract = new Map(contracts.map((c) => [c.id, { ...c, retailer_id: owner(c.retailer), kwh: one(c.crm_supplies)?.annual_kwh ?? null }]));
  const calcBy = new Map(calcs.filter((c) => c.status === "calculat").map((c) => [c.contract_id, n(c.amount)]));
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const live = (s: string) => !["esborrany", "anullat"].includes(s);

  const perRetailer = R.map((r) => {
    const ks = [...byContract.values()].filter((c) => c.retailer_id === r.id);
    const ids = new Set(ks.map((k) => k.id));
    const L = ledger.filter((l) => l.contract_id && ids.has(l.contract_id));
    const sumK = (k: string) => r2(L.filter((l) => l.kind === k).reduce((s, l) => s + n(l.amount), 0));
    const expected = r2(ks.reduce((s, k) => s + (calcBy.get(k.id) ?? 0), 0));
    const accrued = sumK("meritacio"), invoiced = sumK("facturacio"), collected = sumK("cobrament"), applied = Math.abs(sumK("retrocessio"));
    const base = Math.max(accrued, invoiced);
    const rules = ((claws.data ?? []) as (ClawRule & { retailer_id: string })[]).filter((c) => c.retailer_id === r.id);
    const exposure = riskExposure(ks.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status)).map((k) => ({ id: k.id, retailer_id: r.id, start: k.start_date ?? k.signed_at, commission: L.filter((l) => l.contract_id === k.id && l.kind === "cobrament").reduce((s, l) => s + n(l.amount), 0) || (calcBy.get(k.id) ?? 0) })), rules, today);
    const myLines = lines.filter((l) => (l.contract_id && ids.has(l.contract_id)) || owner(one(l.fin_provider_statements)?.retailer) === r.id);
    const under = underpayments(myLines.map((l) => ({ id: l.id, amount: l.amount, expected_amount: l.expected_amount, kind: l.kind })));
    const products = new Map<string, { contractes: number; mwh: number; esperat: number }>();
    for (const k of ks.filter((x) => live(x.status))) {
      const p = k.product?.trim() || "Sense producte";
      const cur = products.get(p) ?? { contractes: 0, mwh: 0, esperat: 0 };
      products.set(p, { contractes: cur.contractes + 1, mwh: cur.mwh + (k.kwh ?? 0) / 1000, esperat: cur.esperat + (calcBy.get(k.id) ?? 0) });
    }
    return {
      id: r.id, name: r.trade_name, status: r.status,
      esperades: expected, meritades: accrued, facturades: invoiced, cobrades: collected, pendents: r2(Math.max(0, base - collected)),
      retrocessionsPotencials: exposure.total, retrocessionsAplicades: applied,
      contractesActivats: ks.filter((k) => ["actiu", "renovacio_pendent", "finalitzat"].includes(k.status) && (k.start_date ?? "") >= from).length,
      contractesActius: ks.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status)).length,
      mwh: Math.round(ks.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status)).reduce((s, k) => s + (k.kwh ?? 0), 0) / 100) / 10,
      productes: [...products.entries()].map(([p, v]) => ({ producte: p, contractes: v.contractes, mwh: Math.round(v.mwh * 10) / 10, esperat: r2(v.esperat) })).sort((a, b) => b.esperat - a.esperat),
      evolucio: months.map((m) => ({ month: m, cobrat: r2(L.filter((l) => l.kind === "cobrament" && l.period.startsWith(m)).reduce((s, l) => s + n(l.amount), 0)), contractes: ks.filter((k) => live(k.status) && (k.signed_at ?? k.created_at).startsWith(m)).length })),
      renovacions: ks.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status) && k.end_date && k.end_date >= today && k.end_date <= in90).length,
      diferencies: myLines.filter((l) => l.match_status === "diferencia").length, infrapagaments: under,
    };
  });
  const tot = (k: "esperades" | "meritades" | "facturades" | "cobrades" | "pendents" | "retrocessionsPotencials" | "retrocessionsAplicades") => r2(perRetailer.reduce((s, x) => s + x[k], 0));
  const agreementAlerts = ((docs.data ?? []) as { id: string; retailer_id: string; title: string; valid_to: string | null; renewal_notice_days: number }[])
    .filter((d) => d.valid_to && d.valid_to >= today && new Date(`${d.valid_to}T12:00:00Z`).getTime() - now.getTime() <= d.renewal_notice_days * 86_400_000)
    .map((d) => ({ kind: "venciment" as const, retailerId: d.retailer_id, text: `«${d.title}» (${R.find((r) => r.id === d.retailer_id)?.trade_name ?? "—"}) venç el ${d.valid_to}` }));
  const payAlerts = perRetailer.flatMap((r) => r.infrapagaments.length ? [{ kind: "infrapagament" as const, retailerId: r.id, text: `${r.name}: ${r.infrapagaments.length} línies liquidades per sota del pactat (−${r.infrapagaments.reduce((s, x) => s + x.gap, 0).toFixed(2)} €)` }] : []);
  const unmatched = contracts.filter((c) => !owner(c.retailer)).length;
  return {
    from, totals: { esperades: tot("esperades"), meritades: tot("meritades"), facturades: tot("facturades"), cobrades: tot("cobrades"), pendents: tot("pendents"), retrocessionsPotencials: tot("retrocessionsPotencials"), retrocessionsAplicades: tot("retrocessionsAplicades") },
    perRetailer, alerts: [...payAlerts, ...agreementAlerts], unmatchedContracts: unmatched,
  };
}

/* ======================================================================= DIAGNÒSTIC REAL DEL LECTOR IA */

type Step = { id: string; label: string; ok: boolean | null; detail: string; ms?: number };
/**
 * Diagnòstic per a Direcció, contra el proveïdor d'IA REAL (no simula res). Tres passos, cadascun en una petició:
 *  - config: clau, model disponible, garanties de confidencialitat i OCR;
 *  - read: lectura real del contracte de prova (24 pàgines) i comprovació del que ha d'haver trobat;
 *  - verify: segona passada (coherència) sobre la lectura anterior.
 * No desa res a la base de dades i no envia cap document del client: només el contracte de prova fictici.
 */
export async function aiReaderCheck(u: U, raw: unknown) {
  adminOnly(u, "Només Direcció pot executar el diagnòstic del lector IA");
  const b = z.object({ step: z.enum(["config", "read", "verify"]), reader: z.unknown().optional() }).parse(raw ?? {});
  const policy = await aiPolicy();
  const key = env.anthropicKey;
  if (b.step === "config") {
    const steps: Step[] = [];
    steps.push({ id: "key", label: "Clau del proveïdor d'IA (ANTHROPIC_API_KEY)", ok: !!key && key.startsWith("sk-ant-"),
      detail: !key ? "No configurada. Crea-la a console.anthropic.com → API Keys i posa-la a Vercel → Settings → Environment Variables → ANTHROPIC_API_KEY (Production i Preview). Després torna a desplegar."
        : key.startsWith("sk-ant-") ? "Configurada al servidor (no es mostra)." : "Configurada, però no té el format d'una clau d'Anthropic (ha de començar per «sk-ant-»). Revisa que no hi hagis posat el nom del model." });
    let modelOk: boolean | null = null, modelDetail = "No s'ha pogut comprovar (falta la clau).";
    if (key) {
      const t0 = Date.now();
      try {
        const r = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(env.anthropicModel)}`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, cache: "no-store" });
        modelOk = r.ok;
        modelDetail = r.ok ? `Model «${env.anthropicModel}» disponible per a aquesta clau (${Date.now() - t0} ms).` : r.status === 401 ? "La clau no és vàlida o s'ha revocat (401)." : r.status === 404 ? `El model «${env.anthropicModel}» no existeix o no està disponible per a aquesta clau. Revisa ANTHROPIC_MODEL.` : `Resposta ${r.status} del proveïdor.`;
      } catch (e) { modelOk = false; modelDetail = `No hi ha connexió amb el proveïdor d'IA: ${(e as Error).message}`; }
    }
    steps.push({ id: "model", label: `Connexió i model (${env.anthropicModel})`, ok: modelOk, detail: modelDetail });
    steps.push({ id: "policy", label: "Garanties de confidencialitat registrades per Direcció", ok: policy.enabled, detail: policy.enabled ? `Activades (DPA: ${policy.dpa_reference ?? "—"}) per ${policy.confirmed_by ?? "—"}.` : "Pendents: Administració → Comercialitzadores → «Garanties IA». Sense això no s'envia cap contracte a la IA (ni s'hi fa OCR)." });
    steps.push({ id: "ocr", label: "OCR de documents escanejats i imatges", ok: !!key && policy.enabled, detail: key && policy.enabled ? "Disponible: els PDF escanejats i les imatges els llegeix la IA directament (visió)." : "No disponible fins que la clau i les garanties estiguin configurades. Els PDF amb text, Word i Excel es poden llegir amb el lector local." });
    return { steps, ready: steps.every((s) => s.ok) };
  }
  if (!key || !policy.enabled) throw new HttpError(409, "Primer cal que la configuració (clau i garanties) estigui correcta");
  const { buildTestContractPdf, checkTestReading } = await import("@/core/test-contract");
  const pdf = buildTestContractPdf();
  const text = await pdfText(pdf);
  const content: Content[] = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } }];
  if (b.step === "read") {
    const t0 = Date.now();
    await secLog(u, "diagnostic_lector_ia", "retailer_documents", null, { step: "read", model: env.anthropicModel });
    const ai = await callTool({ system: READER_SYSTEM, content, tool: READER_TOOL, maxTokens: 32000, budgetMs: AI_BUDGET_MS, instruction: "Llegeix el document sencer i registra totes les condicions amb l'eina registrar_condicions, relacionades entre si i amb els productes." });
    const out = parseReaderOutput(ai.input);
    const { terms, warnings } = expandTerms(out, { pages: text.pages, textAvailable: true });
    const checks = checkTestReading(terms);
    return {
      ms: Date.now() - t0, diag: ai.diag, mode: ai.mode, truncated: ai.truncated, tokens: ai.usage, pages: text.pages.length,
      products: out.products.map((p) => `${p.name}${p.tariff ? ` (${p.tariff})` : ""}`), terms: terms.length, rejected: out.rejected.length, warnings,
      checks, passed: checks.filter((c) => c.ok).length,
      sample: terms.map((t) => ({ category: t.category, field: t.field, product: t.product, value: t.value, unit: t.unit, page: t.page, risk_months: t.conditions.risk_months ?? null, mode: t.conditions.mode ?? null, exceptions: t.conditions.exceptions ?? null, ambiguous: t.ambiguous })),
      reader: { products: out.products, terms: out.terms },
    };
  }
  const prev = parseReaderOutput(b.reader ?? {});
  if (!prev.terms.length) throw new HttpError(400, "Primer cal fer la lectura de prova");
  const t0 = Date.now();
  const ai = await callTool({ system: VERIFY_SYSTEM, content, tool: VERIFY_TOOL, maxTokens: 16000, budgetMs: AI_BUDGET_MS, instruction: `Condicions ja extretes (JSON):\n${verifyContext(prev)}\n\nFes la comprovació de coherència i registra-la amb l'eina registrar_comprovacio.` });
  const v = parseVerifyOutput(ai.input);
  return { ms: Date.now() - t0, diag: ai.diag, mode: ai.mode, truncated: ai.truncated, tokens: ai.usage, missing: v.missing.map((t) => `${t.category}/${t.field} ${t.value ?? ""} (pàg. ${t.pages.join(", ") || "—"})`), issues: v.issues.map((i) => `${i.term} · ${i.kind}: ${i.description}`), contradictions: v.contradictions.map((c) => c.description) };
}
