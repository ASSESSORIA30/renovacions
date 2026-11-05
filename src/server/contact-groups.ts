import "server-only";
/**
 * AGRUPACIÓ PER CONTACTE · servei de servidor (migració 029).
 *
 * Tot es llegeix i s'escriu AMB LA SESSIÓ DE L'USUARI (`u.sb`): la RLS decideix què pot veure. Abans de qualsevol acció
 * sobre diversos contractes es comprova que l'usuari els pot veure TOTS (si en falta un, es rebutja sense dir quin).
 * El client de servei (`adminClient`) només s'usa per respectar les oposicions i preferències de contacte dels clients
 * (obligació de protecció de dades) i mai retorna dades que l'usuari no pugui veure.
 *
 * Reutilitza: el sistema d'activitats de renovacions (`activities`), els PDF de proposta (`documents` + Storage), el
 * correu corporatiu o el correu propi de l'usuari (SMTP) i WhatsApp (enllaç wa.me o Cloud API). No hi ha cap sistema
 * de missatgeria nou.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { holderKey, normEmail, normPhone, recipientKey, commFingerprint, isGenericEmail } from "@/core/contact-groups";
import { contactAllowed, waDigits, waLink } from "@/core/messages";
import type { CrmState, SourceContract } from "@/core/types";
import { explainSmtpError } from "@/core/mail";
import { sendCorporateMail, smtpReady } from "./mailer";
import { sendCloudText, sendFromMyMailbox } from "./comms";
import { env } from "./env";
import { secLog } from "./permissions";
import { HttpError, adminClient } from "./supabase";
import { dbError, parse, type U } from "./crm";

type PgErr = { code?: string; message?: string } | null;
const isMissing = (e: PgErr) => !!e && (e.code === "42P01" || /does not exist|schema cache/i.test(e.message ?? ""));
export const MIGRATION_029 = "Falta aplicar la migració 029_agrupacio_contactes.sql a Supabase";
const internal = (u: U) => { if (u.profile.role === "colaborador") throw new HttpError(403, "Només per a l'equip intern"); };
const MAX_CONTRACTS = 200;
const MAX_ATTACH_BYTES = 15_000_000;

/** Identificador d'activitat determinista (operació + contracte): un reintent no duplica l'activitat. */
export function activityIdFor(opId: string, contractId: string) {
  const h = createHash("sha1").update(`${opId}|${contractId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

async function pages<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: PgErr }>): Promise<{ rows: T[]; error: PgErr }> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) return { rows, error };
    const list = (data ?? []) as T[];
    rows.push(...list);
    if (list.length < 1000) return { rows, error: null };
  }
}

type Visible = { id: string; data: SourceContract; crm: Partial<CrmState> | null };
/** Contractes visibles per l'usuari (RLS). Si en falta algun, es rebutja l'operació sense revelar quin. */
async function requireVisible(u: U, ids: string[]): Promise<Map<string, Visible>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) throw new HttpError(400, "Cal seleccionar almenys un contracte");
  if (uniq.length > MAX_CONTRACTS) throw new HttpError(400, `Com a màxim ${MAX_CONTRACTS} contractes per operació`);
  const [k, s] = await Promise.all([
    u.sb.from("contracts").select("id,data").in("id", uniq),
    u.sb.from("crm_state").select("contract_id,data").in("contract_id", uniq),
  ]);
  if (k.error) dbError(k.error);
  const st = new Map(((s.data ?? []) as { contract_id: string; data: CrmState }[]).map((r) => [r.contract_id, r.data]));
  const out = new Map(((k.data ?? []) as { id: string; data: SourceContract }[]).map((r) => [r.id, { id: r.id, data: { ...r.data, id: r.id }, crm: st.get(r.id) ?? null }]));
  if (uniq.some((id) => !out.has(id))) throw new HttpError(403, "No tens permís sobre tots els contractes seleccionats");
  return out;
}
const phoneOf = (v: Visible) => v.crm?.telefonoOverride ?? v.data.telefono;
const emailOf = (v: Visible) => v.crm?.emailOverride ?? v.data.email;

/* ======================================================================= dades per calcular els grups */

export async function groupData(u: U) {
  internal(u);
  const [links, auths, contracts, supplies, contacts, ccc] = await Promise.all([
    pages<{ id: string; kind: "unir" | "separar"; contract_a: string; contract_b: string; reason: string | null; created_by_name: string | null; created_at: string }>((a, b) => u.sb.from("renewal_contact_links").select("id,kind,contract_a,contract_b,reason,created_by_name,created_at").is("revoked_at", null).order("created_at").range(a, b)),
    pages<{ contact_key: string; holder_key: string; basis: string; granted_by_name: string | null; granted_at: string }>((a, b) => u.sb.from("renewal_contact_authorizations").select("contact_key,holder_key,basis,granted_by_name,granted_at").is("revoked_at", null).range(a, b)),
    pages<{ id: string; cups: string | null }>((a, b) => u.sb.from("contracts").select("id,cups").eq("removed_from_source", false).range(a, b)),
    pages<{ cups20: string; client_id: string }>((a, b) => u.sb.from("crm_supplies").select("cups20,client_id").is("archived_at", null).range(a, b)),
    pages<{ id: string; client_id: string; is_primary: boolean }>((a, b) => u.sb.from("crm_contacts").select("id,client_id,is_primary").range(a, b)),
    pages<{ contact_id: string; client_id: string; status: string }>((a, b) => u.sb.from("crm_contact_clients").select("contact_id,client_id,status").is("revoked_at", null).range(a, b)),
  ]);
  const migrationMissing = isMissing(links.error) || isMissing(auths.error);
  // Clients 360°: contracte (per CUPS) → client → contacte principal i persones relacionades confirmades
  const clientByCups = new Map(supplies.rows.map((s) => [s.cups20, s.client_id]));
  const contactsOf = new Map<string, Set<string>>();
  const add = (client: string, contact: string) => (contactsOf.get(client) ?? contactsOf.set(client, new Set()).get(client)!).add(contact);
  for (const k of contacts.rows) if (k.is_primary) add(k.client_id, k.id);
  const own = new Map(contacts.rows.map((k) => [k.id, k.client_id]));
  for (const r of ccc.rows) if (r.status === "confirmada") { add(r.client_id, r.contact_id); const o = own.get(r.contact_id); if (o) add(o, r.contact_id); }
  const c360: Record<string, string[]> = {};
  for (const c of contracts.rows) {
    const client = c.cups ? clientByCups.get(c.cups.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)) : undefined;
    const set = client ? contactsOf.get(client) : undefined;
    if (set?.size) c360[c.id] = [...set];
  }
  return { links: links.rows, authorizations: auths.rows, c360, migrationMissing };
}

/* ======================================================================= unir / separar */

const linkInput = z.object({ kind: z.enum(["unir", "separar"]), a: z.string().min(1).max(200), b: z.string().min(1).max(200), reason: z.string().trim().max(500).nullable().optional() });

export async function saveLink(u: U, raw: unknown) {
  internal(u);
  const b = parse(linkInput, raw);
  if (b.a === b.b) throw new HttpError(400, "Un contracte no es pot unir amb si mateix");
  const [x, y] = b.a < b.b ? [b.a, b.b] : [b.b, b.a];
  const vis = await requireVisible(u, [x, y]);
  // la decisió anterior sobre la mateixa parella es revoca (queda a l'historial)
  const prev = await u.sb.from("renewal_contact_links").update({ revoked_at: new Date().toISOString() }).eq("contract_a", x).eq("contract_b", y).is("revoked_at", null).select("id");
  if (prev.error) { if (isMissing(prev.error)) throw new HttpError(503, MIGRATION_029); dbError(prev.error); }
  const { data, error } = await u.sb.from("renewal_contact_links").insert({ kind: b.kind, contract_a: x, contract_b: y, reason: b.reason ?? null, created_by: u.user.id, created_by_name: u.profile.name }).select("id,kind,contract_a,contract_b,reason,created_by_name,created_at").single();
  if (error) { if (isMissing(error)) throw new HttpError(503, MIGRATION_029); dbError(error); }
  const name = (id: string) => vis.get(id)!.data.cliente;
  const verb = b.kind === "unir" ? "unit" : "separat";
  await u.sb.from("activities").insert([
    { id: activityIdFor(data!.id as string, x), contract_id: x, type: "note", by_name: u.profile.name, title: `Agrupació per contacte: ${verb} manualment amb ${name(y)}`, body: b.reason ?? null, meta: { linkId: data!.id, kind: b.kind } },
    { id: activityIdFor(data!.id as string, y), contract_id: y, type: "note", by_name: u.profile.name, title: `Agrupació per contacte: ${verb} manualment amb ${name(x)}`, body: b.reason ?? null, meta: { linkId: data!.id, kind: b.kind } },
  ]);
  await secLog(u, `agrupacio-${b.kind}`, "renewal_contact_links", data!.id as string, { contracts: 2 });
  return { link: data };
}

export async function revokeLink(u: U, id: string) {
  internal(u);
  const { data, error } = await u.sb.from("renewal_contact_links").update({ revoked_at: new Date().toISOString() }).eq("id", z.string().uuid().parse(id)).is("revoked_at", null).select("id,contract_a,contract_b,kind");
  if (error) { if (isMissing(error)) throw new HttpError(503, MIGRATION_029); dbError(error); }
  if (!data?.length) throw new HttpError(404, "Decisió no trobada o ja revocada");
  await secLog(u, "agrupacio-revoca", "renewal_contact_links", id, null);
  return { ok: true };
}

/* ======================================================================= activitat conjunta (trucada, visita, comunicació…) */

type ActRow = { id: string; contract_id: string; type: string; at: string; by_name: string; title: string; body: string | null; delivery: string | null; meta: Record<string, unknown> };
const toActivity = (r: ActRow) => ({ id: r.id, contractId: r.contract_id, type: r.type, at: r.at, by: r.by_name, title: r.title, body: r.body ?? undefined, delivery: r.delivery ?? undefined, meta: r.meta });

async function writeActivities(u: U, rows: ActRow[]) {
  const { error } = await u.sb.from("activities").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) dbError(error, "No s'ha pogut registrar l'activitat als contractes");
  return rows.map(toActivity);
}

const KIND_LABEL: Record<string, string> = { trucada: "Trucada", visita: "Visita", reunio: "Reunió", nota: "Nota", comunicacio: "Comunicació" };
const activityInput = z.object({
  opId: z.string().uuid(), kind: z.enum(["trucada", "visita", "reunio", "nota", "comunicacio"]), channel: z.enum(["whatsapp", "email", "telefon", "presencial", "altre"]).nullable().optional(),
  contractIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_CONTRACTS), contactName: z.string().trim().max(200).nullable().optional(), recipient: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(), outcome: z.string().trim().max(500).nullable().optional(), at: z.string().datetime({ offset: true }).optional(),
});

/** Una sola trucada, visita o comunicació associada a diversos contractes (sistema d'activitats existent). */
export async function registerGroupActivity(u: U, raw: unknown) {
  internal(u);
  const b = parse(activityInput, raw);
  const ids = [...new Set(b.contractIds)];
  await requireVisible(u, ids);
  const existing = await u.sb.from("renewal_group_ops").select("id,status").eq("id", b.opId).maybeSingle();
  if (existing.error && isMissing(existing.error)) throw new HttpError(503, MIGRATION_029);
  if (existing.data) return { id: b.opId, existed: true, activities: [] };
  const at = b.at ?? new Date().toISOString();
  const ins = await u.sb.from("renewal_group_ops").insert({ id: b.opId, kind: b.kind, channel: b.channel ?? null, contact_name: b.contactName ?? null, recipient: b.recipient ?? null, contract_ids: ids, status: "registrat", notes: b.notes ?? null, outcome: b.outcome ?? null, at, created_by: u.user.id, created_by_name: u.profile.name });
  if (ins.error) { if (ins.error.code === "23505") return { id: b.opId, existed: true, activities: [] }; if (isMissing(ins.error)) throw new HttpError(503, MIGRATION_029); dbError(ins.error); }
  const type = b.kind === "trucada" ? "call" : b.kind === "comunicacio" && (b.channel === "email" || b.channel === "whatsapp") ? b.channel : "note";
  const title = `${KIND_LABEL[b.kind]} conjunta${b.contactName ? ` amb ${b.contactName}` : ""} (${ids.length} ${ids.length === 1 ? "contracte" : "contractes"})${b.outcome ? ` · ${b.outcome}` : ""}`;
  const activities = await writeActivities(u, ids.map((id) => ({ id: activityIdFor(b.opId, id), contract_id: id, type, at, by_name: u.profile.name, title, body: b.notes ?? null, delivery: type === "email" || type === "whatsapp" || type === "call" ? "enviado" : null, meta: { groupOpId: b.opId, kind: b.kind, channel: b.channel ?? null, contact: b.contactName ?? null, contracts: ids.length } })));
  return { id: b.opId, existed: false, activities };
}

/** Comunicacions i activitats conjuntes on apareix un contracte (només les que inclouen contractes visibles). */
export async function listOps(u: U, contractId: string) {
  internal(u);
  await requireVisible(u, [contractId]);
  const { data, error } = await u.sb.from("renewal_group_ops").select("id,kind,channel,contact_name,recipient,contract_ids,subject,body,attachments,status,error,outcome,notes,at,created_by_name,confirmed_at").contains("contract_ids", [contractId]).order("at", { ascending: false }).limit(50);
  if (error) { if (isMissing(error)) return { ops: [], migrationMissing: true }; dbError(error); }
  return { ops: data ?? [], migrationMissing: false };
}

/* ======================================================================= «Contactar tots»: comprovacions prèvies */

const sendBase = z.object({
  contractIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_CONTRACTS),
  channel: z.enum(["whatsapp", "email"]),
  recipient: z.string().trim().min(3).max(200),
});

type Holder = { key: string; name: string; contracts: string[]; authorized: boolean; via: "propi" | "autoritzacio" | "clients360" | null };

export async function preflight(u: U, raw: unknown) {
  internal(u);
  const b = parse(sendBase, raw);
  const ids = [...new Set(b.contractIds)];
  const vis = await requireVisible(u, ids);
  const rk = recipientKey(b.channel, b.recipient);
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (!rk) blocking.push(b.channel === "email" ? "El correu del destinatari no és vàlid" : "El telèfon del destinatari no és vàlid per a WhatsApp");
  if (b.channel === "email" && isGenericEmail(b.recipient)) warnings.push("El correu és genèric (p. ex. info@): pot llegir-lo més d'una persona");

  // titulars i autoritzacions
  const holders = new Map<string, Holder>();
  for (const v of vis.values()) {
    const k = holderKey(v.data);
    const h = holders.get(k) ?? { key: k, name: v.data.cliente, contracts: [], authorized: false, via: null };
    h.contracts.push(v.id);
    holders.set(k, h);
  }
  const ownMatch = (v: Visible) => (b.channel === "email" ? normEmail(emailOf(v)) === normEmail(b.recipient) : normPhone(phoneOf(v)) === normPhone(b.recipient));
  if (rk) {
    const auth = await u.sb.from("renewal_contact_authorizations").select("holder_key").eq("contact_key", rk).in("holder_key", [...holders.keys()]).is("revoked_at", null);
    if (auth.error && isMissing(auth.error)) throw new HttpError(503, MIGRATION_029);
    const authorized = new Set(((auth.data ?? []) as { holder_key: string }[]).map((r) => r.holder_key));
    const by360 = await clients360Authorized(u, [...holders.keys()], b.channel, b.recipient);
    for (const h of holders.values()) {
      if (authorized.has(h.key)) { h.authorized = true; h.via = "autoritzacio"; continue; }
      if (by360.has(h.key)) { h.authorized = true; h.via = "clients360"; continue; }
      // amb un sol titular, n'hi ha prou que el destinatari sigui la dada de contacte que consta al seu contracte
      if (holders.size === 1 && h.contracts.some((id) => ownMatch(vis.get(id)!))) { h.authorized = true; h.via = "propi"; }
    }
  }
  const pending = [...holders.values()].filter((h) => !h.authorized);
  if (pending.length) blocking.push(holders.size > 1
    ? `Els contractes són de ${holders.size} titulars diferents: cal registrar que el destinatari està autoritzat a rebre informació de ${pending.map((h) => h.name).join(", ")}`
    : `El destinatari no és la dada de contacte que consta al contracte de ${pending[0].name}: cal registrar-ne l'autorització`);

  // oposicions i preferències de contacte dels clients (Clients 360°)
  const pref = await clientPreferences(vis);
  for (const p of pref) {
    const r = contactAllowed(p.contact_preference, p.commercial_opt_out, b.channel, "comercial");
    if (!r.ok) blocking.push(`${p.name}: ${r.reason}`);
    else if (r.warning) warnings.push(`${p.name}: ${r.warning}`);
  }

  // duplicats: mateix contacte, mateix canal, mateixos contractes
  const fp = commFingerprint(b.channel, b.recipient, ids);
  let lastSent: { at: string; by: string | null; status: string } | null = null;
  if (fp) {
    const prev = await u.sb.from("renewal_group_ops").select("at,created_by_name,status").eq("fingerprint", fp).in("status", ["enviat", "registrat", "intent"]).order("at", { ascending: false }).limit(1);
    const r = (prev.data ?? [])[0] as { at: string; created_by_name: string | null; status: string } | undefined;
    if (r) lastSent = { at: r.at, by: r.created_by_name, status: r.status };
  }

  // propostes PDF disponibles (última versió de cada contracte)
  const docs = await u.sb.from("documents").select("id,contract_id,version,file_name,ahorro_anual,created_at").in("contract_id", ids).order("version", { ascending: false });
  const latest = new Map<string, { id: string; contract_id: string; version: number; file_name: string; ahorro_anual: number | null }>();
  for (const d of (docs.data ?? []) as { id: string; contract_id: string; version: number; file_name: string; ahorro_anual: number | null }[]) if (!latest.has(d.contract_id)) latest.set(d.contract_id, d);

  // remitent
  const wa = await u.sb.from("user_whatsapp").select("mode,default_number_id").eq("user_id", u.user.id).maybeSingle();
  const sender = { corporateMail: await smtpReady().catch(() => false), whatsappMode: (wa.data?.mode === "cloud" && wa.data.default_number_id && env.waToken ? "cloud" : "enllac") as "cloud" | "enllac" };

  return { ok: !blocking.length, blocking, warnings, holders: [...holders.values()], lastSent, fingerprint: fp, recipientKey: rk, docs: [...latest.values()], sender };
}

/** Titulars per als quals una persona de Clients 360° amb aquest telèfon/correu està relacionada i autoritzada. */
async function clients360Authorized(u: U, holderKeys: string[], channel: "whatsapp" | "email", recipient: string) {
  const out = new Set<string>();
  const cifs = holderKeys.filter((k) => k.startsWith("cif:")).map((k) => k.slice(4));
  if (!cifs.length) return out;
  const cl = await u.sb.from("crm_clients").select("id,tax_id").in("tax_id", cifs);
  const clients = (cl.data ?? []) as { id: string; tax_id: string }[];
  if (!clients.length) return out;
  const clientIds = clients.map((c) => c.id);
  const match = (k: { phone: string | null; email: string | null }) => (channel === "email" ? !!k.email && normEmail(k.email) === normEmail(recipient) : !!k.phone && normPhone(k.phone) === normPhone(recipient));
  const [own, rel] = await Promise.all([
    u.sb.from("crm_contacts").select("id,client_id,phone,email").in("client_id", clientIds),
    u.sb.from("crm_contact_clients").select("contact_id,client_id,authorized,status").in("client_id", clientIds).is("revoked_at", null),
  ]);
  const okClients = new Set<string>();
  for (const k of (own.data ?? []) as { client_id: string; phone: string | null; email: string | null }[]) if (match(k)) okClients.add(k.client_id);
  const relRows = ((rel.data ?? []) as { contact_id: string; client_id: string; authorized: boolean; status: string }[]).filter((r) => r.authorized && r.status === "confirmada");
  if (relRows.length) {
    const ks = await u.sb.from("crm_contacts").select("id,phone,email").in("id", relRows.map((r) => r.contact_id));
    const good = new Set(((ks.data ?? []) as { id: string; phone: string | null; email: string | null }[]).filter(match).map((k) => k.id));
    for (const r of relRows) if (good.has(r.contact_id)) okClients.add(r.client_id);
  }
  for (const c of clients) if (okClients.has(c.id)) out.add(`cif:${c.tax_id.toUpperCase().replace(/[^A-Z0-9]/g, "")}`);
  return out;
}

/** Oposicions i preferències dels clients vinculats (per CUPS). Es llegeixen amb el client de servei per complir-les sempre. */
async function clientPreferences(vis: Map<string, Visible>) {
  const cups = [...new Set([...vis.values()].map((v) => v.data.cups?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)).filter(Boolean) as string[])];
  if (!cups.length) return [];
  try {
    const sb = adminClient();
    const s = await sb.from("crm_supplies").select("cups20,client_id").in("cups20", cups).is("archived_at", null);
    const ids = [...new Set(((s.data ?? []) as { client_id: string }[]).map((r) => r.client_id))];
    if (!ids.length) return [];
    const c = await sb.from("crm_clients").select("id,contact_preference,commercial_opt_out").in("id", ids);
    const byCups = new Map(((s.data ?? []) as { cups20: string; client_id: string }[]).map((r) => [r.cups20, r.client_id]));
    const prefs = new Map(((c.data ?? []) as { id: string; contact_preference: string | null; commercial_opt_out: boolean | null }[]).map((r) => [r.id, r]));
    const out: { name: string; contact_preference: string | null; commercial_opt_out: boolean | null }[] = [];
    const seen = new Set<string>();
    for (const v of vis.values()) {
      const id = v.data.cups ? byCups.get(v.data.cups.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)) : undefined;
      const p = id ? prefs.get(id) : undefined;
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push({ name: v.data.cliente, contact_preference: p.contact_preference, commercial_opt_out: p.commercial_opt_out }); }
    }
    return out;
  } catch { return []; } // sense clau de servei (entorn de proves): s'aplica el que l'usuari pugui veure
}

/* ======================================================================= «Contactar tots»: enviament */

const sendInput = sendBase.extend({
  opId: z.string().uuid(),
  contactName: z.string().trim().max(200).nullable().optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().min(1).max(20000),
  templateId: z.string().max(60).nullable().optional(),
  attachDocIds: z.array(z.string().uuid()).max(MAX_CONTRACTS).default([]),
  confirmed: z.literal(true, { errorMap: () => ({ message: "Cal confirmar explícitament l'enviament" }) }),
  confirmResend: z.boolean().optional(),
  waMode: z.enum(["enllac", "cloud"]).optional(),
});

const DELIVERY: Record<string, string> = { enviat: "enviado", registrat: "enviado", intent: "preparado", preparat: "preparado", error: "error" };

export async function sendGroup(u: U, raw: unknown) {
  internal(u);
  const b = parse(sendInput, raw);
  if (b.channel === "email" && !b.subject) throw new HttpError(400, "Falta l'assumpte del correu");
  const ids = [...new Set(b.contractIds)];

  // idempotència: si l'operació ja existeix, es retorna el seu estat i NO es torna a enviar
  const prev = await u.sb.from("renewal_group_ops").select("id,status,error,provider_ref").eq("id", b.opId).maybeSingle();
  if (prev.error && isMissing(prev.error)) throw new HttpError(503, MIGRATION_029);
  if (prev.data) return { id: b.opId, status: prev.data.status as string, error: prev.data.error as string | null, existed: true, activities: [] };

  const pf = await preflight(u, { contractIds: ids, channel: b.channel, recipient: b.recipient });
  if (pf.blocking.length) throw new HttpError(409, pf.blocking.join(" · "));
  if (pf.lastSent && !b.confirmResend) throw new HttpError(409, `DUPLICAT: ja es va enviar aquesta comunicació el ${new Date(pf.lastSent.at).toLocaleString("ca-ES")}. Confirma el reenviament si cal.`);

  // adjunts: només propostes dels contractes seleccionats
  const docs = b.attachDocIds.length ? await u.sb.from("documents").select("id,contract_id,file_name,storage_path").in("id", b.attachDocIds) : { data: [], error: null };
  const docRows = (docs.data ?? []) as { id: string; contract_id: string; file_name: string; storage_path: string }[];
  if (docRows.length !== new Set(b.attachDocIds).size || docRows.some((d) => !ids.includes(d.contract_id))) throw new HttpError(400, "Algun document adjunt no correspon als contractes seleccionats");

  let attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  let links: { contractId: string; fileName: string; url: string }[] = [];
  if (b.channel === "email" && docRows.length) {
    let total = 0;
    for (const d of docRows) {
      const f = await u.sb.storage.from("documents").download(d.storage_path);
      if (f.error || !f.data) throw new HttpError(409, `No s'ha pogut adjuntar ${d.file_name}: no s'ha enviat res`);
      const content = Buffer.from(await f.data.arrayBuffer());
      total += content.length;
      if (total > MAX_ATTACH_BYTES) throw new HttpError(413, "Els adjunts superen 15 MB: tria menys propostes");
      attachments.push({ filename: d.file_name, content, contentType: "application/pdf" });
    }
  }
  if (b.channel === "whatsapp" && docRows.length) {
    // enllaços segurs i temporals (7 dies) als PDF; mai es publiquen fitxers
    links = [];
    for (const d of docRows) {
      const s = await u.sb.storage.from("documents").createSignedUrl(d.storage_path, 60 * 60 * 24 * 7);
      if (s.error || !s.data?.signedUrl) throw new HttpError(409, `No s'ha pogut generar l'enllaç segur de ${d.file_name}: no s'ha enviat res`);
      links.push({ contractId: d.contract_id, fileName: d.file_name, url: s.data.signedUrl });
    }
  }
  const body = links.length ? `${b.body.trimEnd()}\n\n${links.map((l) => `${l.fileName}: ${l.url}`).join("\n")}` : b.body;

  // es reserva l'identificador ABANS d'enviar: un segon clic o un reintent concurrent no torna a enviar
  const claim = await u.sb.from("renewal_group_ops").insert({
    id: b.opId, kind: "comunicacio", channel: b.channel, contact_name: b.contactName ?? null, recipient: b.recipient, contract_ids: ids, fingerprint: pf.fingerprint,
    template_id: b.templateId ?? null, subject: b.subject ?? null, body, attachments: docRows.map((d) => ({ id: d.id, contractId: d.contract_id, fileName: d.file_name })), status: "preparat", at: new Date().toISOString(),
    created_by: u.user.id, created_by_name: u.profile.name,
  });
  if (claim.error) {
    if (claim.error.code === "23505") return { id: b.opId, status: "preparat", existed: true, activities: [] };
    dbError(claim.error, "No s'ha pogut registrar la comunicació");
  }

  let status: "enviat" | "intent" | "error" = "error";
  let error: string | null = null;
  let providerRef: string | null = null;
  let wa: string | null = null;
  if (b.channel === "email") {
    try {
      if (await smtpReady()) {
        const info = await sendCorporateMail({ to: b.recipient, subject: b.subject!, text: body, attachments }, u.profile);
        providerRef = info.messageId ?? null;
        status = (info.accepted?.length ?? 0) > 0 ? "enviat" : "error";
        if (status === "error") error = "El servidor SMTP no ha acceptat el destinatari";
      } else {
        const r = await sendFromMyMailbox(u, { to: b.recipient, subject: b.subject!, text: body, attachments });
        providerRef = r.messageId; status = r.accepted ? "enviat" : "error"; error = r.error;
      }
    } catch (e) {
      status = "error";
      error = e instanceof HttpError ? e.message : explainSmtpError(e as Parameters<typeof explainSmtpError>[0]);
    }
  } else {
    const to = waDigits(b.recipient);
    if (!to) { status = "error"; error = "Telèfon no vàlid per a WhatsApp"; }
    else if ((b.waMode ?? pf.sender.whatsappMode) === "cloud") {
      try { providerRef = await sendCloudText(u, to, body, null); status = providerRef ? "enviat" : "error"; if (!providerRef) error = "Meta no ha acceptat el missatge de WhatsApp"; }
      catch (e) { status = "error"; error = e instanceof Error ? e.message : String(e); }
    } else {
      // mode enllaç: s'obre WhatsApp amb el text; NO consta com a enviat fins que l'usuari ho confirma
      status = "intent"; wa = waLink(to, body);
    }
  }
  attachments = [];
  await u.sb.from("renewal_group_ops").update({ status, error, provider_ref: providerRef }).eq("id", b.opId);

  const n = ids.length;
  const what = b.channel === "email" ? "correu" : "WhatsApp";
  const title = status === "enviat" ? `Comunicació conjunta per ${what} (${n} ${n === 1 ? "contracte" : "contractes"})${b.subject ? `: ${b.subject}` : ""}`
    : status === "intent" ? `WhatsApp conjunt preparat (${n} ${n === 1 ? "contracte" : "contractes"}) · pendent de confirmar l'enviament`
    : `Comunicació conjunta per ${what} NO enviada`;
  const activities = await writeActivities(u, ids.map((id) => ({
    id: activityIdFor(b.opId, id), contract_id: id, type: b.channel, at: new Date().toISOString(), by_name: u.profile.name, title,
    body: status === "error" ? error : body.slice(0, 2000), delivery: DELIVERY[status],
    meta: { groupOpId: b.opId, to: b.recipient, contracts: n, attachments: docRows.filter((d) => d.contract_id === id).map((d) => d.file_name), messageId: providerRef },
  })));
  await secLog(u, "comunicacio-conjunta", "renewal_group_ops", b.opId, { channel: b.channel, contracts: n, status, attachments: docRows.length });
  return { id: b.opId, status, error, existed: false, waLink: wa, activities };
}

/** WhatsApp per enllaç: l'usuari confirma que l'ha enviat («L'he enviat») → passa a «registrat». */
export async function confirmGroupWhatsapp(u: U, opId: string) {
  internal(u);
  const id = z.string().uuid().parse(opId);
  const { data, error } = await u.sb.from("renewal_group_ops").update({ status: "registrat" }).eq("id", id).eq("status", "intent").eq("created_by", u.user.id).select("id,contract_ids").maybeSingle();
  if (error) dbError(error);
  if (!data) throw new HttpError(409, "Aquesta comunicació ja estava confirmada o no és teva");
  const ids = data.contract_ids as string[];
  const title = `WhatsApp conjunt enviat (${ids.length} ${ids.length === 1 ? "contracte" : "contractes"}) · confirmat per l'usuari`;
  const upd = await u.sb.from("activities").update({ delivery: "enviado", title }).in("id", ids.map((c) => activityIdFor(id, c))).select("id,contract_id,type,at,by_name,title,body,delivery,meta");
  return { id, status: "registrat", activities: ((upd.data ?? []) as ActRow[]).map(toActivity) };
}

/* ======================================================================= autoritzacions */

const authInput = z.object({
  contactKey: z.string().regex(/^(tel:[0-9]{9,15}|email:[^@\s]+@[^@\s]+)$/, "Destinatari no vàlid"), holderKey: z.string().regex(/^(cif:[A-Z0-9]{8,}|ct:.+)$/, "Titular no vàlid"),
  basis: z.enum(["consentiment", "execucio_contracte", "interes_legitim", "representacio", "altre"]), note: z.string().trim().min(3, "Explica com s'ha verificat l'autorització").max(1000),
});
export async function authorize(u: U, raw: unknown) {
  internal(u);
  const b = parse(authInput, raw);
  const ex = await u.sb.from("renewal_contact_authorizations").select("id").eq("contact_key", b.contactKey).eq("holder_key", b.holderKey).is("revoked_at", null).maybeSingle();
  if (ex.error && isMissing(ex.error)) throw new HttpError(503, MIGRATION_029);
  if (ex.data) return { id: ex.data.id as string, existed: true };
  const { data, error } = await u.sb.from("renewal_contact_authorizations").insert({ contact_key: b.contactKey, holder_key: b.holderKey, basis: b.basis, note: b.note, granted_by: u.user.id, granted_by_name: u.profile.name }).select("id").single();
  if (error) dbError(error, "No s'ha pogut registrar l'autorització");
  await secLog(u, "autoritzacio-destinatari", "renewal_contact_authorizations", data!.id as string, { basis: b.basis });
  return { id: data!.id as string, existed: false };
}

/* ======================================================================= Clients 360°: persona ↔ diversos clients */

export async function clientRelations(u: U, clientId: string) {
  internal(u);
  const id = z.string().uuid().parse(clientId);
  const own = await u.sb.from("crm_contacts").select("id,client_id,name,phone,email,is_primary").eq("client_id", id);
  if (own.error) dbError(own.error);
  const ownContacts = (own.data ?? []) as { id: string; client_id: string; name: string; phone: string | null; email: string | null; is_primary: boolean }[];
  const ownIds = ownContacts.map((k) => k.id);
  const [toThis, fromThis] = await Promise.all([
    u.sb.from("crm_contact_clients").select("id,contact_id,client_id,role,status,authorized,basis,note,created_by_name,created_at,confirmed_at").eq("client_id", id).is("revoked_at", null),
    ownIds.length ? u.sb.from("crm_contact_clients").select("id,contact_id,client_id,role,status,authorized,basis,note,created_by_name,created_at,confirmed_at").in("contact_id", ownIds).is("revoked_at", null) : Promise.resolve({ data: [], error: null }),
  ]);
  if (toThis.error && isMissing(toThis.error)) return { contacts: ownContacts, links: [], detected: [], migrationMissing: true };
  type L = { id: string; contact_id: string; client_id: string; role: string | null; status: string; authorized: boolean; basis: string | null; note: string | null; created_by_name: string | null; created_at: string; confirmed_at: string | null };
  const links = [...((toThis.data ?? []) as L[]), ...((fromThis.data ?? []) as L[])];
  // noms (només els visibles)
  const allContacts = await pages<{ id: string; client_id: string; name: string; phone: string | null; email: string | null }>((a, b) => u.sb.from("crm_contacts").select("id,client_id,name,phone,email").range(a, b));
  const clientIds = [...new Set([...links.map((l) => l.client_id), ...allContacts.rows.map((k) => k.client_id)])];
  const names = new Map<string, string>();
  for (let i = 0; i < clientIds.length; i += 300) {
    const r = await u.sb.from("crm_clients").select("id,name,tax_id").in("id", clientIds.slice(i, i + 300));
    for (const c of (r.data ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
  }
  const contactById = new Map(allContacts.rows.map((k) => [k.id, k]));
  const linked = new Set(links.map((l) => `${l.contact_id}|${l.client_id}`));
  // coincidències detectades automàticament: una persona d'aquest client amb el mateix telèfon o correu que una persona d'un altre client
  const detected: { contactId: string; contactName: string; otherContactId: string; otherContactName: string; clientId: string; clientName: string; reason: "telefon" | "email" }[] = [];
  for (const mine of ownContacts) {
    const p = normPhone(mine.phone), e = normEmail(mine.email);
    for (const k of allContacts.rows) {
      if (k.client_id === id || !names.has(k.client_id)) continue;
      const reason = p && normPhone(k.phone) === p ? "telefon" : e && !isGenericEmail(e) && normEmail(k.email) === e ? "email" : null;
      if (!reason || linked.has(`${mine.id}|${k.client_id}`)) continue;
      detected.push({ contactId: mine.id, contactName: mine.name, otherContactId: k.id, otherContactName: k.name, clientId: k.client_id, clientName: names.get(k.client_id)!, reason });
    }
  }
  return {
    contacts: ownContacts,
    links: links.filter((l) => names.has(l.client_id) && contactById.has(l.contact_id)).map((l) => ({ ...l, client_name: names.get(l.client_id)!, contact_name: contactById.get(l.contact_id)!.name, own: l.client_id !== id })),
    detected: detected.slice(0, 100),
    migrationMissing: false,
  };
}

const ccInput = z.object({ contactId: z.string().uuid(), clientId: z.string().uuid(), role: z.string().trim().max(120).nullable().optional(), authorized: z.boolean().default(false), basis: z.enum(["consentiment", "execucio_contracte", "interes_legitim", "representacio", "altre"]).nullable().optional(), note: z.string().trim().max(1000).nullable().optional() });
export async function linkContactClient(u: U, raw: unknown) {
  internal(u);
  const b = parse(ccInput, raw);
  if (b.authorized && !b.basis) throw new HttpError(400, "Per autoritzar l'enviament d'informació cal indicar-ne la base");
  const { data, error } = await u.sb.from("crm_contact_clients").insert({ contact_id: b.contactId, client_id: b.clientId, role: b.role ?? null, status: "confirmada", authorized: b.authorized, basis: b.basis ?? null, note: b.note ?? null, created_by: u.user.id, created_by_name: u.profile.name }).select("id").single();
  if (error) { if (isMissing(error)) throw new HttpError(503, MIGRATION_029); if (/ja és contacte/.test(error.message ?? "")) throw new HttpError(400, "Aquesta persona ja és contacte d'aquest client"); dbError(error, "No s'ha pogut relacionar"); }
  await secLog(u, "persona-client-relaciona", "crm_contact_clients", data!.id as string, { authorized: b.authorized });
  return { id: data!.id as string };
}
export async function unlinkContactClient(u: U, id: string) {
  internal(u);
  const { data, error } = await u.sb.from("crm_contact_clients").update({ revoked_at: new Date().toISOString() }).eq("id", z.string().uuid().parse(id)).is("revoked_at", null).select("id");
  if (error) dbError(error);
  if (!data?.length) throw new HttpError(403, "No pots modificar aquesta relació");
  await secLog(u, "persona-client-separa", "crm_contact_clients", id, null);
  return { ok: true };
}
