import "server-only";
/**
 * GESTOR DOCUMENTAL DEL CRM (servidor).
 * Flux de pujada (els fitxers no passen per Vercel, que limita el cos a 4,5 MB):
 *   1. `requestUpload`: el servidor comprova permisos, tipus i mida; FIXA la ruta (`<client>/<document>/v<n>-<uuid>.<ext>`)
 *      i retorna una URL de pujada signada d'un sol ús + un tiquet signat (HMAC) amb totes les dades.
 *   2. El navegador puja el fitxer directament al bucket privat `crm-documents`.
 *   3. `finalizeUpload`: verifica el tiquet, descarrega el fitxer, comprova el contingut real (bytes màgics i
 *      estructura interna d'Office), la mida i l'empremta SHA-256, i només llavors crea el registre (amb la RLS de l'usuari).
 *      Si alguna comprovació falla, el fitxer s'esborra.
 * Descàrregues: només amb URL signades de 60 s generades després de comprovar l'accés (RLS) i sempre auditades.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DOC_CATEGORIES, SENSITIVE_CATEGORIES, allowedDocTypes, extOf, retainUntil, safeFileName, sniffDoc, zipKindOk, DOC_CATEGORY_LABEL, type DocCategory } from "@/core/crm";
import { env } from "./env";
import { adminClient, HttpError } from "./supabase";
import { auditEvent, dbError, isStaffRole, parse, type U } from "./crm";

export const DOCS_BUCKET = "crm-documents";
export const maxDocBytes = () => Math.min(Math.max(Number(process.env.CRM_DOCS_MAX_MB ?? 25) || 25, 1), 50) * 1024 * 1024;
export const docTypes = () => allowedDocTypes(process.env.CRM_DOCS_EXTRA_TYPES);

const ticketKey = () => createHash("sha256").update(`crm-upload|${process.env.SETTINGS_ENCRYPTION_KEY || env.supabaseService}`).digest();
type Ticket = { u: string; c: string; d: string; v: number; p: string; e: string; n: string; s: number; exp: number; nw: boolean };
const sign = (t: Ticket) => {
  const body = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${body}.${createHmac("sha256", ticketKey()).update(body).digest("base64url")}`;
};
function verify(ticket: string, userId: string): Ticket {
  const [body, mac] = ticket.split(".");
  if (!body || !mac) throw new HttpError(400, "Tiquet de pujada no vàlid");
  const expect = createHmac("sha256", ticketKey()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) throw new HttpError(400, "Tiquet de pujada no vàlid");
  const t = JSON.parse(Buffer.from(body, "base64url").toString()) as Ticket;
  if (t.u !== userId) throw new HttpError(403, "Aquesta pujada no és teva");
  if (t.exp < Date.now()) throw new HttpError(410, "La pujada ha caducat. Torna-ho a provar.");
  return t;
}

const requestSchema = z.object({
  clientId: z.string().uuid(),
  documentId: z.string().uuid().nullable().optional(),       // per pujar una versió nova
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  category: z.enum(DOC_CATEGORIES).optional(),
});

async function canSensitive(u: U, clientId: string) {
  const r = await u.sb.rpc("crm_can_see_sensitive", { p_client: clientId });
  return !!r.data;
}

export async function requestUpload(u: U, raw: unknown) {
  const b = parse(requestSchema, raw);
  const ext = extOf(b.fileName);
  const types = docTypes();
  if (!types[ext]) throw new HttpError(415, `Tipus de fitxer no admès (.${ext || "?"}). Admesos: ${Object.keys(types).join(", ")}`);
  if (b.size > maxDocBytes()) throw new HttpError(413, `El fitxer supera el màxim de ${Math.round(maxDocBytes() / 1024 / 1024)} MB`);
  const client = await u.sb.from("crm_clients").select("id").eq("id", b.clientId).maybeSingle();
  if (!client.data) throw new HttpError(404, "Aquest client no existeix o no tens permís per veure'l");
  let docId = b.documentId ?? null;
  let version = 1;
  if (docId) {
    const d = await u.sb.from("crm_documents").select("id,client_id,version,category").eq("id", docId).maybeSingle();
    if (!d.data || d.data.client_id !== b.clientId) throw new HttpError(404, "Document no trobat");
    const editable = await u.sb.rpc("crm_can_edit_client", { p_client: b.clientId });
    if (!editable.data) throw new HttpError(403, "No tens permís per pujar versions noves d'aquest document");
    version = d.data.version + 1;
  } else {
    if (b.category && SENSITIVE_CATEGORIES.includes(b.category) && !(await canSensitive(u, b.clientId))) throw new HttpError(403, "No tens permís per pujar documents identificatius o bancaris d'aquest client");
    docId = randomUUID();
  }
  // Ruta fixada pel servidor: cap part prové del nom de fitxer de l'usuari.
  const path = `${b.clientId}/${docId}/v${version}-${randomUUID()}.${ext}`;
  const { data, error } = await adminClient().storage.from(DOCS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    if (/not found/i.test(error?.message ?? "")) throw new HttpError(409, "Falta el bucket crm-documents: aplica la migració 008");
    throw new HttpError(502, "No s'ha pogut preparar la pujada");
  }
  const ticket = sign({ u: u.user.id, c: b.clientId, d: docId, v: version, p: path, e: ext, n: safeFileName(b.fileName), s: b.size, exp: Date.now() + 30 * 60_000, nw: !b.documentId });
  return { ticket, path, token: data.token, signedUrl: data.signedUrl, documentId: docId, version };
}

const finalizeSchema = z.object({
  ticket: z.string().min(10).max(4000),
  category: z.enum(DOC_CATEGORIES).optional(),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  supplyId: z.string().uuid().nullable().optional(),
  contractId: z.string().uuid().nullable().optional(),
  expedientId: z.string().uuid().nullable().optional(),     // pujat des d'un expedient de contractació (Fase 3)
});

async function inspect(bytes: Uint8Array, ext: string) {
  const sniff = sniffDoc(bytes, ext);
  if (!sniff.ok) return sniff.reason ?? "Contingut no vàlid";
  if (sniff.zip) {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.keys(zip.files);
      if (entries.length > 5000) return "El fitxer comprimit té massa elements";
      const mimetype = zip.file("mimetype") ? await zip.file("mimetype")!.async("string") : null;
      if (!zipKindOk(ext, entries, mimetype)) return "El contingut no correspon a l'extensió del fitxer";
      if (ext !== "zip" && entries.some((e) => /vbaProject\.bin$/i.test(e))) return "No s'admeten documents amb macros";
    } catch {
      return "El fitxer està malmès o no es pot llegir";
    }
  }
  return null;
}

export async function finalizeUpload(u: U, raw: unknown) {
  const b = parse(finalizeSchema, raw);
  const t = verify(b.ticket, u.user.id);
  const admin = adminClient();
  const remove = () => admin.storage.from(DOCS_BUCKET).remove([t.p]).then(() => undefined, () => undefined);
  const dl = await admin.storage.from(DOCS_BUCKET).download(t.p);
  if (dl.error || !dl.data) throw new HttpError(404, "No s'ha rebut el fitxer. Torna'l a pujar.");
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maxDocBytes()) { await remove(); throw new HttpError(413, "Mida de fitxer no vàlida"); }
  const bad = await inspect(bytes, t.e);
  if (bad) { await remove(); throw new HttpError(415, bad); }
  const mime = docTypes()[t.e];
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const meta = { original_name: t.n, mime, size_bytes: bytes.byteLength, sha256, storage_path: t.p };
  try {
    if (t.nw) {
      const category = (b.category ?? "altres") as DocCategory;
      if (SENSITIVE_CATEGORIES.includes(category) && !(await canSensitive(u, t.c))) throw new HttpError(403, "No tens permís per pujar documents identificatius o bancaris d'aquest client");
      if (b.expedientId) {
        const e = await u.sb.from("crm_expedients").select("client_id").eq("id", b.expedientId).maybeSingle();
        if (e.data?.client_id !== t.c) throw new HttpError(400, "L'expedient no és d'aquest client");
      }
      const ins = await u.sb.from("crm_documents").insert({
        id: t.d, client_id: t.c, supply_id: b.supplyId ?? null, contract_id: b.contractId ?? null, ...(b.expedientId ? { expedient_id: b.expedientId } : {}), category, title: b.title || t.n.replace(/\.[^.]+$/, ""), description: b.description ?? null,
        ...meta, version: 1, retain_until: retainUntil(category), uploaded_by: u.user.id, uploaded_by_name: u.profile.name,
      }).select("id").single();
      if (ins.error) dbError(ins.error, "No s'ha pogut registrar el document");
    } else {
      const cur = await u.sb.from("crm_documents").select("version").eq("id", t.d).maybeSingle();
      if (!cur.data || cur.data.version + 1 !== t.v) throw new HttpError(409, "Algú altre ha pujat una versió nova mentrestant. Torna-ho a provar.");
      const up = await u.sb.from("crm_documents").update({ ...meta, version: t.v }).eq("id", t.d).select("id");
      if (up.error) dbError(up.error);
      if (!up.data?.length) throw new HttpError(403, "No tens permís per pujar versions noves d'aquest document");
    }
    const v = await u.sb.from("crm_document_versions").insert({ document_id: t.d, version: t.v, ...meta, uploaded_by: u.user.id, uploaded_by_name: u.profile.name });
    if (v.error) dbError(v.error);
  } catch (e) {
    await remove();
    throw e;
  }
  await auditEvent(u, { clientId: t.c, entity: "documents", entityId: t.d, action: t.nw ? "upload" : "upload-version", detail: { version: t.v, size: bytes.byteLength, ext: t.e } });
  await u.sb.from("crm_activities").insert({ client_id: t.c, type: "document", title: t.nw ? `Document pujat: ${b.title || t.n}` : `Nova versió (v${t.v}) de document`, user_id: u.user.id, user_name: u.profile.name, meta: { documentId: t.d, version: t.v } });
  return { id: t.d, version: t.v, sha256 };
}

/** URL signada de 60 s per veure o descarregar (comprovant abans l'accés amb la RLS de l'usuari). */
export async function documentUrl(u: U, id: string, opts: { version?: number | null; download?: boolean }) {
  const d = await u.sb.from("crm_documents").select("id,client_id,version,storage_path,original_name,category,sensitive,mime").eq("id", id).maybeSingle();
  if (!d.data) throw new HttpError(404, "Document no trobat o sense permís");
  let path = d.data.storage_path as string;
  let name = d.data.original_name as string;
  let version = d.data.version as number;
  if (opts.version && opts.version !== d.data.version) {
    const v = await u.sb.from("crm_document_versions").select("storage_path,original_name,version").eq("document_id", id).eq("version", opts.version).maybeSingle();
    if (!v.data) throw new HttpError(404, "Versió no trobada");
    path = v.data.storage_path; name = v.data.original_name; version = v.data.version;
  }
  if (!path.startsWith(`${d.data.client_id}/${id}/`)) throw new HttpError(400, "Ruta de document no vàlida");
  const s = await adminClient().storage.from(DOCS_BUCKET).createSignedUrl(path, 60, opts.download ? { download: safeFileName(name) } : undefined);
  if (s.error || !s.data) throw new HttpError(502, "No s'ha pogut obrir el document");
  await auditEvent(u, { clientId: d.data.client_id, entity: "documents", entityId: id, action: opts.download ? "download" : "view", detail: { version, sensitive: d.data.sensitive } });
  return { url: s.data.signedUrl, name, mime: d.data.mime, expiresIn: 60 };
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), id: z.string().uuid(), category: z.enum(DOC_CATEGORIES), title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable().optional(), supplyId: z.string().uuid().nullable().optional(), contractId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal("archive"), id: z.string().uuid() }),
  z.object({ action: z.literal("restore"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
]);

export async function documentAction(u: U, raw: unknown) {
  const b = parse(actionSchema, raw);
  const d = await u.sb.from("crm_documents").select("id,client_id,category,retain_until,title").eq("id", b.id).maybeSingle();
  if (!d.data) throw new HttpError(404, "Document no trobat o sense permís");
  if (b.action === "delete") {
    if (!isStaffRole(u.profile.role)) throw new HttpError(403, "Només Administració o Direcció poden eliminar documents");
    if (d.data.retain_until && d.data.retain_until > new Date().toISOString().slice(0, 10)) throw new HttpError(403, `Conservació obligatòria fins al ${d.data.retain_until}: es pot arxivar però no eliminar`);
    const versions = await u.sb.from("crm_document_versions").select("storage_path").eq("document_id", b.id);
    const del = await u.sb.from("crm_documents").delete().eq("id", b.id).select("id");
    if (del.error) dbError(del.error);
    if (!del.data?.length) throw new HttpError(403, "No tens permís per eliminar aquest document");
    const paths = (versions.data ?? []).map((v) => v.storage_path as string).filter((p) => p.startsWith(`${d.data!.client_id}/${b.id}/`));
    if (paths.length) await adminClient().storage.from(DOCS_BUCKET).remove(paths);
    await auditEvent(u, { clientId: d.data.client_id, entity: "documents", entityId: b.id, action: "delete", detail: { versions: paths.length, category: d.data.category } });
    return { ok: true };
  }
  let patch: Record<string, unknown>;
  if (b.action === "update") {
    if (SENSITIVE_CATEGORIES.includes(b.category) && !(await canSensitive(u, d.data.client_id))) throw new HttpError(403, "No tens permís per classificar documents com a identificatius o bancaris");
    patch = { category: b.category, title: b.title, description: b.description ?? null, supply_id: b.supplyId ?? null, contract_id: b.contractId ?? null };
    // en reclassificar com a contractual, s'aplica la conservació obligatòria (mai s'escurça)
    const keep = retainUntil(b.category, new Date());
    if (keep && (!d.data.retain_until || keep > d.data.retain_until)) patch.retain_until = keep;
  } else patch = { status: b.action === "archive" ? "arxivat" : "actiu" };
  const r = await u.sb.from("crm_documents").update(patch).eq("id", b.id).select("id");
  if (r.error) dbError(r.error);
  if (!r.data?.length) throw new HttpError(403, "No tens permís per modificar aquest document");
  if (b.action === "update" && b.category !== d.data.category) await auditEvent(u, { clientId: d.data.client_id, entity: "documents", entityId: b.id, action: "reclassify", detail: { from: DOC_CATEGORY_LABEL[d.data.category as DocCategory], to: DOC_CATEGORY_LABEL[b.category] } });
  return { ok: true };
}

/** Desa al client el PDF d'una comparativa (mòdul existent) com a document de categoria «Proposta comercial». */
export async function attachComparisonPdf(u: U, p: { clientId: string; bytes: Uint8Array; fileName: string; title: string; supplyId?: string | null }) {
  const id = randomUUID();
  const path = `${p.clientId}/${id}/v1-${randomUUID()}.pdf`;
  const up = await adminClient().storage.from(DOCS_BUCKET).upload(path, p.bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) { console.warn("[crm] no s'ha pogut desar la proposta a la fitxa:", up.error.message); return null; }
  const sha256 = createHash("sha256").update(p.bytes).digest("hex");
  const meta = { original_name: safeFileName(p.fileName), mime: "application/pdf", size_bytes: p.bytes.byteLength, sha256, storage_path: path };
  const ins = await u.sb.from("crm_documents").insert({ id, client_id: p.clientId, supply_id: p.supplyId ?? null, category: "proposta", title: p.title, ...meta, version: 1, uploaded_by: u.user.id, uploaded_by_name: u.profile.name }).select("id");
  if (ins.error || !ins.data?.length) { await adminClient().storage.from(DOCS_BUCKET).remove([path]); return null; }
  await u.sb.from("crm_document_versions").insert({ document_id: id, version: 1, ...meta, uploaded_by: u.user.id, uploaded_by_name: u.profile.name });
  await auditEvent(u, { clientId: p.clientId, entity: "documents", entityId: id, action: "upload", detail: { source: "comparativa" } });
  return id;
}

/**
 * Desa al gestor documental un PDF generat pel servidor (documents de contractació, documents signats i evidències).
 * Amb `u` el registre es crea amb la RLS de l'usuari; sense (webhook de signatura verificat) el crea el servidor.
 */
export async function storeServerPdf(u: U | null, p: { clientId: string; bytes: Uint8Array; fileName: string; title: string; category: DocCategory; supplyId?: string | null; contractId?: string | null; expedientId?: string | null; byName?: string }) {
  const id = randomUUID();
  const admin = adminClient();
  const path = `${p.clientId}/${id}/v1-${randomUUID()}.pdf`;
  const up = await admin.storage.from(DOCS_BUCKET).upload(path, p.bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) throw new HttpError(502, "No s'ha pogut desar el PDF al gestor documental");
  const sha256 = createHash("sha256").update(p.bytes).digest("hex");
  const meta = { original_name: safeFileName(p.fileName), mime: "application/pdf", size_bytes: p.bytes.byteLength, sha256, storage_path: path };
  const by = u ? { uploaded_by: u.user.id, uploaded_by_name: u.profile.name } : { uploaded_by: null, uploaded_by_name: p.byName ?? "Sistema" };
  const db = u ? u.sb : admin;
  const ins = await db.from("crm_documents").insert({ id, client_id: p.clientId, supply_id: p.supplyId ?? null, contract_id: p.contractId ?? null, expedient_id: p.expedientId ?? null, category: p.category, title: p.title, ...meta, version: 1, retain_until: retainUntil(p.category), ...by }).select("id");
  if (ins.error || !ins.data?.length) {
    await admin.storage.from(DOCS_BUCKET).remove([path]);
    if (ins.error) dbError(ins.error, "No s'ha pogut registrar el document");
    throw new HttpError(403, "No tens permís per desar documents d'aquest client");
  }
  await db.from("crm_document_versions").insert({ document_id: id, version: 1, ...meta, ...by });
  await auditEvent(u, { clientId: p.clientId, entity: "documents", entityId: id, action: "generate", detail: { category: p.category, size: p.bytes.byteLength } });
  return { id, sha256 };
}

/** Bytes d'un document del gestor (només servidor; l'accés s'ha de comprovar abans amb la RLS). */
export async function documentBytes(storagePath: string) {
  const dl = await adminClient().storage.from(DOCS_BUCKET).download(storagePath);
  if (dl.error || !dl.data) throw new HttpError(404, "No s'ha trobat el fitxer");
  return new Uint8Array(await dl.data.arrayBuffer());
}

/**
 * Documents del client vinculat a un contracte de RENOVACIONS (fitxa lateral del Kanban).
 * El contracte de renovacions pot ser `crm:<uuid>` (contracte del CRM) o un id importat de Google Drive
 * (`crm_contracts.legacy_contract_id`). Si no hi ha relació directa, es busca pel CUPS (`crm_supplies.cups20`).
 * Totes les consultes es fan amb la sessió de l'usuari: la RLS decideix què pot veure (els DNI/NIE i bancaris
 * només els veu qui hi té permís). Si no es troba el client, es retorna `linked: false` (no és un error).
 */
export async function documentsForRenewal(u: U, renewalId: string, cupsRaw?: string | null) {
  const id = renewalId.trim();
  if (!id || id.length > 200) throw new HttpError(400, "Contracte no vàlid");
  const sb = u.sb;
  let crmContract: { id: string; client_id: string; retailer: string | null } | null = null;
  const crmId = id.startsWith("crm:") ? id.slice(4) : null;
  if (crmId) {
    if (!z.string().uuid().safeParse(crmId).success) throw new HttpError(400, "Contracte no vàlid");
    const r = await sb.from("crm_contracts").select("id,client_id,retailer").eq("id", crmId).maybeSingle();
    if (r.error) dbError(r.error, "No s'han pogut carregar els documents");
    crmContract = r.data;
  } else {
    const r = await sb.from("crm_contracts").select("id,client_id,retailer").eq("legacy_contract_id", id).order("created_at", { ascending: false }).limit(1);
    if (r.error) dbError(r.error, "No s'han pogut carregar els documents");
    crmContract = r.data?.[0] ?? null;
  }
  let clientId = crmContract?.client_id ?? null;
  let supplyId: string | null = null;
  const cups = (cupsRaw ?? "").toUpperCase().replace(/[\s.\-]/g, "");
  if (/^ES[0-9]{16}[A-Z]{2}/.test(cups)) {
    const s = await sb.from("crm_supplies").select("id,client_id").eq("cups20", cups.slice(0, 20)).is("archived_at", null).limit(1);
    if (!s.error && s.data?.[0]) { supplyId = s.data[0].id; clientId ??= s.data[0].client_id; }
  }
  if (!clientId) return { linked: false as const, documents: [], permissions: null, client: null, contractId: null, supplyId: null };
  const [client, docs, canEdit, canSens] = await Promise.all([
    sb.from("crm_clients").select("id,name").eq("id", clientId).maybeSingle(),
    sb.from("crm_documents").select("id,client_id,supply_id,contract_id,category,sensitive,title,description,original_name,mime,size_bytes,version,status,retain_until,uploaded_by_name,created_at,updated_at").eq("client_id", clientId).eq("status", "actiu").order("created_at", { ascending: false }).limit(500),
    sb.rpc("crm_can_edit_client", { p_client: clientId }),
    sb.rpc("crm_can_see_sensitive", { p_client: clientId }),
  ]);
  if (!client.data) return { linked: false as const, documents: [], permissions: null, client: null, contractId: null, supplyId: null };
  if (docs.error) dbError(docs.error, "No s'han pogut carregar els documents");
  const all = docs.data ?? [];
  // primer els del contracte o del CUPS d'aquesta renovació; després la resta del client
  const rel = (d: { contract_id: string | null; supply_id: string | null }) => (crmContract && d.contract_id === crmContract.id) || (supplyId && d.supply_id === supplyId);
  const documents = [...all.filter(rel), ...all.filter((d) => !rel(d))].map((d) => ({ ...d, related: !!rel(d) }));
  return {
    linked: true as const,
    client: { id: client.data.id as string, name: client.data.name as string },
    contractId: crmContract?.id ?? null,
    supplyId,
    documents,
    permissions: { canUpload: true, canEdit: !!canEdit.data, canSeeSensitive: !!canSens.data },
  };
}
