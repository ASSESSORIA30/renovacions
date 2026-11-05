import "server-only";
/**
 * Fase 8 · COMUNICACIONS PER USUARI: correu propi (SMTP), WhatsApp (enllaç o Cloud API amb número autoritzat) i
 * sol·licituds de ressenya i de protecció de dades des de la fitxa del client.
 * - Les credencials SMTP es xifren (AES-256-GCM) i només les llegeix aquest mòdul; mai es retornen al navegador.
 * - Un correu només es marca «enviat» si el servidor SMTP l'ha acceptat; un WhatsApp per enllaç queda com a «intent»
 *   (s'ha obert l'aplicació) fins que l'usuari confirma que l'ha enviat («registrat»).
 * - Obrir l'enllaç de protecció de dades MAI marca l'autorització com a signada: cal una confirmació registrada.
 */
import { z } from "zod";
import { explainSmtpError } from "@/core/mail";
import { contactAllowed, waDigits, type Lang } from "@/core/messages";
import { createTransport, keyMaterial } from "./mailer";
import { open, seal } from "./secret-box";
import { env } from "./env";
import { HttpError, adminClient } from "./supabase";
import type { U } from "./crm";

const PURPOSE = "user-mail-smtp-password";
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || /does not exist|schema cache/i.test(e.message ?? ""));
const migrationError = () => new HttpError(503, "Falta aplicar la migració 015_comunicacions.sql a Supabase");
const internal = (u: U) => { if (u.profile.role === "colaborador") throw new HttpError(403, "Només per a l'equip intern"); };

/* ======================================================================= el meu perfil: correu */

type MailRow = { user_id: string; provider: string; from_name: string; from_email: string; reply_to: string | null; signature: string | null; host: string | null; port: number | null; security: string | null; username: string | null; password_enc: string | null; enabled: boolean; last_test_at: string | null; last_test_ok: boolean | null; last_test_error: string | null; revoked_at: string | null; updated_at: string };
async function mailRow(userId: string) {
  const { data, error } = await adminClient().from("user_mail_accounts").select("*").eq("user_id", userId).maybeSingle();
  if (error) { if (isMissing(error)) throw migrationError(); throw new HttpError(500, "No s'ha pogut llegir la configuració de correu"); }
  return data as MailRow | null;
}
/** Vista pública de la configuració (sense credencials). */
const safe = (r: MailRow | null) => r && { provider: r.provider, from_name: r.from_name, from_email: r.from_email, reply_to: r.reply_to, signature: r.signature, host: r.host, port: r.port, security: r.security, username: r.username, hasPassword: !!r.password_enc, enabled: r.enabled && !r.revoked_at, last_test_at: r.last_test_at, last_test_ok: r.last_test_ok, last_test_error: r.last_test_error, revoked_at: r.revoked_at, updated_at: r.updated_at };

export async function myComms(u: U) {
  internal(u);
  const [mail, wa, numbers] = await Promise.all([
    mailRow(u.user.id),
    u.sb.from("user_whatsapp").select("mode,phone_e164,display_name,default_number_id,updated_at").eq("user_id", u.user.id).maybeSingle(),
    u.sb.from("wa_business_numbers").select("id,display_phone,label,active"),
  ]);
  return { mail: safe(mail), whatsapp: wa.data ?? null, numbers: (numbers.data ?? []).filter((n) => n.active), cloudConfigured: !!env.waToken, oauth: { google: false, microsoft: false, note: "Preparat: cal registrar l'aplicació OAuth a Google Workspace / Microsoft 365 (pendent de configuració externa)" } };
}

const mailInput = z.object({
  provider: z.enum(["smtp", "google_oauth", "microsoft_oauth"]).default("smtp"),
  from_name: z.string().trim().min(1, "Falta el nom del remitent").max(120),
  from_email: z.string().trim().toLowerCase().email("Adreça de correu no vàlida").max(160),
  reply_to: z.string().trim().toLowerCase().email("Correu de resposta no vàlid").max(160).nullable().optional().or(z.literal("").transform(() => null)),
  signature: z.string().max(4000).nullable().optional(),
  host: z.string().trim().max(160).regex(/^[a-z0-9.-]+$/i, "Servidor no vàlid").nullable().optional(),
  port: z.coerce.number().int().min(1).max(65535).nullable().optional(),
  security: z.enum(["ssl", "starttls", "none"]).nullable().optional(),
  username: z.string().trim().max(160).nullable().optional(),
  password: z.string().max(400).optional(),          // buit = es conserva la desada
});

export async function saveMailAccount(u: U, raw: unknown) {
  internal(u);
  const b = mailInput.parse(raw);
  if (b.provider !== "smtp") throw new HttpError(400, "Les connexions OAuth (Google, Microsoft) estan preparades però pendents de configurar l'aplicació al proveïdor. De moment, fes servir SMTP.");
  if (!b.host || !b.port || !b.security || !b.username) throw new HttpError(400, "Per a SMTP calen servidor, port, tipus de connexió i usuari");
  const cur = await mailRow(u.user.id);
  const password_enc = b.password ? seal(b.password, keyMaterial(), PURPOSE) : cur?.password_enc ?? null;
  if (!password_enc) throw new HttpError(400, "Falta la contrasenya (o contrasenya d'aplicació) SMTP");
  const row = { user_id: u.user.id, provider: b.provider, from_name: b.from_name, from_email: b.from_email, reply_to: b.reply_to ?? null, signature: b.signature ?? null, host: b.host, port: b.port, security: b.security, username: b.username, password_enc, enabled: true, revoked_at: null, updated_at: new Date().toISOString(),
    // qualsevol canvi de servidor o credencial obliga a tornar a provar la connexió
    ...(b.password || cur?.host !== b.host || cur?.port !== b.port || cur?.username !== b.username ? { last_test_ok: null, last_test_at: null, last_test_error: null } : {}) };
  const { error } = await adminClient().from("user_mail_accounts").upsert(row, { onConflict: "user_id" });
  if (error) throw new HttpError(400, "No s'ha pogut desar la configuració de correu");
  return { ok: true, mail: safe(await mailRow(u.user.id)) };
}

function transportFor(r: MailRow) {
  const password = r.password_enc ? open(r.password_enc, keyMaterial(), PURPOSE) : null;
  if (!password) throw new HttpError(400, "La contrasenya desada no es pot desxifrar: torna-la a introduir");
  return createTransport({ host: r.host!, port: r.port!, security: r.security as "ssl" | "starttls" | "none", username: r.username!, password });
}

export async function testMailAccount(u: U) {
  internal(u);
  const r = await mailRow(u.user.id);
  if (!r || !r.enabled || r.revoked_at) throw new HttpError(400, "Primer desa la configuració de correu");
  let ok = false, err: string | null = null;
  try { await transportFor(r).verify(); ok = true; } catch (e) { err = e instanceof HttpError ? e.message : explainSmtpError(e as Parameters<typeof explainSmtpError>[0]); }
  await adminClient().from("user_mail_accounts").update({ last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_error: err }).eq("user_id", u.user.id);
  return { ok, error: err };
}

export async function revokeMailAccount(u: U) {
  internal(u);
  const { error } = await adminClient().from("user_mail_accounts").update({ password_enc: null, enabled: false, revoked_at: new Date().toISOString(), last_test_ok: null }).eq("user_id", u.user.id);
  if (error) throw new HttpError(400, "No s'ha pogut revocar");
  return { ok: true };
}

/* ======================================================================= el meu perfil: WhatsApp */

export async function saveWhatsapp(u: U, raw: unknown) {
  internal(u);
  const b = z.object({ mode: z.enum(["enllac", "cloud"]), phone: z.string().max(30).nullable().optional(), display_name: z.string().trim().max(120).nullable().optional(), default_number_id: z.string().uuid().nullable().optional() }).parse(raw);
  const d = b.phone ? waDigits(b.phone) : null;
  if (b.phone && !d) throw new HttpError(400, "Número de WhatsApp no vàlid (format internacional, p. ex. +34 600 000 000)");
  if (b.mode === "cloud" && !b.default_number_id) throw new HttpError(400, "Per enviar amb WhatsApp Business Cloud API cal triar un número empresarial que Direcció t'hagi autoritzat");
  if (b.default_number_id) {
    const { data } = await u.sb.from("wa_number_access").select("number_id").eq("number_id", b.default_number_id).eq("user_id", u.user.id).maybeSingle();
    if (!data) throw new HttpError(403, "No tens autoritzat aquest número empresarial");
  }
  const { error } = await u.sb.from("user_whatsapp").upsert({ user_id: u.user.id, mode: b.mode, phone_e164: d ? `+${d}` : null, display_name: b.display_name ?? null, default_number_id: b.default_number_id ?? null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) { if (isMissing(error)) throw migrationError(); throw new HttpError(error.code === "42501" ? 403 : 400, error.code === "42501" ? "No tens autoritzat aquest número empresarial" : "No s'ha pogut desar"); }
  return { ok: true };
}

/** Direcció: números empresarials (Cloud API) i qui els pot fer servir. */
export async function manageBusinessNumbers(u: U, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció gestiona els números empresarials");
  const b = z.discriminatedUnion("op", [
    z.object({ op: z.literal("add"), phone_number_id: z.string().regex(/^\d{6,30}$/, "Identificador de número no vàlid"), display_phone: z.string().max(30), label: z.string().trim().min(1).max(80) }),
    z.object({ op: z.literal("grant"), number_id: z.string().uuid(), user_id: z.string().uuid(), on: z.boolean() }),
    z.object({ op: z.literal("active"), number_id: z.string().uuid(), active: z.boolean() }),
  ]).parse(raw);
  if (b.op === "add") { const { error } = await u.sb.from("wa_business_numbers").insert({ phone_number_id: b.phone_number_id, display_phone: b.display_phone, label: b.label, created_by: u.user.id }); if (error) throw new HttpError(400, error.code === "23505" ? "Aquest número ja existeix" : "No s'ha pogut desar"); }
  if (b.op === "grant") { const q = b.on ? u.sb.from("wa_number_access").upsert({ number_id: b.number_id, user_id: b.user_id, granted_by: u.user.id }, { onConflict: "number_id,user_id" }) : u.sb.from("wa_number_access").delete().eq("number_id", b.number_id).eq("user_id", b.user_id); const { error } = await q; if (error) throw new HttpError(400, "No s'ha pogut desar"); }
  if (b.op === "active") { const { error } = await u.sb.from("wa_business_numbers").update({ active: b.active }).eq("id", b.number_id); if (error) throw new HttpError(400, "No s'ha pogut desar"); }
  return listBusinessNumbers(u);
}
export async function listBusinessNumbers(u: U) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció gestiona els números empresarials");
  const [nums, acc, ppl] = await Promise.all([u.sb.from("wa_business_numbers").select("*").order("created_at"), u.sb.from("wa_number_access").select("number_id,user_id"), u.sb.from("profiles").select("id,name,role").neq("role", "colaborador")]);
  return { numbers: nums.data ?? [], access: acc.data ?? [], people: ppl.data ?? [] };
}

/* ======================================================================= fitxa de client: comunicacions */

async function clientFor(u: U, id: string) {
  const { data } = await u.sb.from("crm_clients").select("id,name,email,phone,contact_preference,commercial_opt_out").eq("id", z.string().uuid().parse(id)).maybeSingle();
  if (!data) throw new HttpError(404, "Client no trobat o sense permís");
  return data as { id: string; name: string; email: string | null; phone: string | null; contact_preference: string | null; commercial_opt_out: boolean | null };
}

export async function clientComms(u: U, clientId: string) {
  internal(u);
  const c = await clientFor(u, clientId);
  const [reqs, acts, my] = await Promise.all([
    u.sb.from("client_requests").select("*").eq("client_id", c.id).order("requested_at", { ascending: false }).limit(50),
    u.sb.from("crm_activities").select("id,type,title,body,at,delivery,user_name,meta").eq("client_id", c.id).in("type", ["email", "whatsapp"]).order("at", { ascending: false }).limit(50),
    myComms(u).catch(() => null),
  ]);
  if (reqs.error && isMissing(reqs.error)) throw migrationError();
  const R = (reqs.data ?? []) as { kind: string; status: string; requested_at: string }[];
  const lastReview = R.find((r) => r.kind === "ressenya" && r.status === "enviada") ?? R.find((r) => r.kind === "ressenya");
  const data = R.find((r) => r.kind === "proteccio_dades");
  return {
    client: { id: c.id, name: c.name, email: c.email, phone: c.phone, contact_preference: c.contact_preference, commercial_opt_out: !!c.commercial_opt_out },
    requests: reqs.data ?? [], history: acts.data ?? [],
    review: { last: lastReview?.requested_at ?? null, status: lastReview?.status ?? null },
    dataProtection: { status: data?.status ?? "pendent", at: data?.requested_at ?? null },
    sender: my ? { mail: my.mail && my.mail.enabled ? { from: `${my.mail.from_name} <${my.mail.from_email}>`, tested: my.mail.last_test_ok } : null, whatsapp: my.whatsapp, cloudConfigured: my.cloudConfigured } : null,
  };
}

const reqInput = z.object({
  clientId: z.string().uuid(), kind: z.enum(["ressenya", "proteccio_dades"]), language: z.enum(["ca", "es"]),
  channel: z.enum(["whatsapp", "email", "copiat", "manual"]), recipient: z.string().max(200).nullable().optional(), message: z.string().max(4000).optional(),
  legal_basis: z.enum(["consentiment", "execucio_contracte", "obligacio_legal", "interes_legitim"]).nullable().optional(),
  reminderDays: z.number().int().min(1).max(60).nullable().optional(),
});

/** Registra una sol·licitud (quan l'usuari confirma l'acció: copiat, WhatsApp obert, correu enviat…). */
export async function registerRequest(u: U, raw: unknown, delivery: "intent" | "registrat" | "enviat" | "error" = "intent") {
  internal(u);
  const b = reqInput.parse(raw);
  const c = await clientFor(u, b.clientId);
  if (b.channel === "whatsapp" || b.channel === "email") {
    const p = contactAllowed(c.contact_preference, c.commercial_opt_out, b.channel, b.kind === "ressenya" ? "comercial" : "servei");
    if (!p.ok) throw new HttpError(409, p.reason!);
  }
  const status = b.kind === "ressenya" ? (delivery === "enviat" || delivery === "registrat" ? "enviada" : "preparada") : "sollicitada";
  const { data, error } = await u.sb.from("client_requests").insert({
    client_id: c.id, kind: b.kind, language: b.language, channel: b.channel, status, recipient: b.recipient ?? null, message: b.message ?? null, delivery,
    legal_basis: b.kind === "proteccio_dades" ? b.legal_basis ?? "consentiment" : null, requested_by: u.user.id, requested_by_name: u.profile.name,
  }).select("id").single();
  if (error) { if (isMissing(error)) throw migrationError(); throw new HttpError(error.code === "23505" ? 409 : error.code === "42501" ? 403 : 400, error.code === "23505" ? "Ja s'ha registrat aquesta sol·licitud fa menys de 2 minuts (s'evita un duplicat)" : error.code === "42501" ? "No pots modificar aquest client" : "No s'ha pogut registrar la sol·licitud"); }
  const label = b.kind === "ressenya" ? "Sol·licitud de ressenya Google" : "Sol·licitud d'autorització de dades";
  await u.sb.from("crm_activities").insert({ client_id: c.id, type: b.channel === "email" ? "email" : b.channel === "whatsapp" ? "whatsapp" : "nota", title: `${label} (${b.language === "ca" ? "català" : "castellà"} · ${b.channel})`, body: b.message?.slice(0, 2000) ?? null, delivery: b.channel === "email" || b.channel === "whatsapp" ? delivery : null, user_id: u.user.id, user_name: u.profile.name, meta: { request_id: data.id, kind: b.kind, recipient: b.recipient ?? null } });
  if (b.reminderDays) {
    await u.sb.from("crm_tasks").insert({ client_id: c.id, title: b.kind === "ressenya" ? `Recordatori: ressenya de ${c.name}` : `Comprovar l'autorització de dades de ${c.name}`, due_at: new Date(Date.now() + b.reminderDays * 86_400_000).toISOString(), assigned_to: u.user.id, assigned_name: u.profile.name, created_by: u.user.id, kind: "seguiment", source: "manual" });
  }
  return { id: data.id as string, status };
}

/** Canvi d'estat de l'autorització de dades. «Completada» exigeix una evidència o una nota de confirmació. */
export async function updateDataRequest(u: U, id: string, raw: unknown) {
  internal(u);
  const b = z.object({ status: z.enum(["sollicitada", "formulari_enviat", "completada", "rebutjada", "caducada"]), note: z.string().trim().max(1000).optional(), evidence_document_id: z.string().uuid().nullable().optional(), legal_basis: z.enum(["consentiment", "execucio_contracte", "obligacio_legal", "interes_legitim"]).optional(), expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(raw);
  const { data: r } = await u.sb.from("client_requests").select("id,client_id,kind,evidence_document_id").eq("id", z.string().uuid().parse(id)).maybeSingle();
  if (!r || r.kind !== "proteccio_dades") throw new HttpError(404, "Sol·licitud no trobada");
  if (b.status === "completada" && !b.evidence_document_id && !r.evidence_document_id && !b.note) throw new HttpError(400, "Per marcar-la com a signada cal adjuntar l'evidència o explicar com s'ha confirmat (obrir l'enllaç no n'hi ha prou)");
  if (b.evidence_document_id) {
    const { data: doc } = await u.sb.from("crm_documents").select("id,client_id").eq("id", b.evidence_document_id).maybeSingle();
    if (!doc || doc.client_id !== r.client_id) throw new HttpError(400, "L'evidència ha de ser un document d'aquest client");
  }
  const patch: Record<string, unknown> = { status: b.status, note: b.note ?? null, ...(b.evidence_document_id !== undefined ? { evidence_document_id: b.evidence_document_id } : {}), ...(b.legal_basis ? { legal_basis: b.legal_basis } : {}), ...(b.expires_at !== undefined ? { expires_at: b.expires_at } : {}) };
  if (b.status === "completada") Object.assign(patch, { confirmed_by: u.user.id, confirmed_at: new Date().toISOString() });
  const { data, error } = await u.sb.from("client_requests").update(patch).eq("id", id).select("id").maybeSingle();
  if (error || !data) throw new HttpError(error?.code === "23514" ? 400 : 403, "No s'ha pogut actualitzar l'estat");
  await u.sb.from("crm_activities").insert({ client_id: r.client_id, type: "canvi", title: `Autorització de dades: ${b.status.replace("_", " ")}`, body: b.note ?? null, user_id: u.user.id, user_name: u.profile.name, meta: { request_id: id, evidence: b.evidence_document_id ?? r.evidence_document_id ?? null } });
  return { ok: true };
}

/** Correu des del compte personal de l'usuari. «Enviat» només si el servidor SMTP l'ha acceptat. */
export async function sendClientEmail(u: U, raw: unknown) {
  internal(u);
  const b = z.object({ clientId: z.string().uuid(), to: z.string().trim().email("Correu del client no vàlid"), subject: z.string().trim().min(1).max(300), body: z.string().min(1).max(20000), kind: z.enum(["ressenya", "proteccio_dades", "proposta", "documentacio", "recordatori", "lliure"]), language: z.enum(["ca", "es"]).default("ca"), legal_basis: z.enum(["consentiment", "execucio_contracte", "obligacio_legal", "interes_legitim"]).nullable().optional() }).parse(raw);
  const c = await clientFor(u, b.clientId);
  const p = contactAllowed(c.contact_preference, c.commercial_opt_out, "email", ["ressenya", "proposta"].includes(b.kind) ? "comercial" : "servei");
  if (!p.ok) throw new HttpError(409, p.reason!);
  const r = await mailRow(u.user.id);
  if (!r || !r.enabled || r.revoked_at || !r.password_enc) throw new HttpError(400, "Configura el teu correu a «El meu perfil → Comunicacions → Email» abans d'enviar");
  const text = r.signature ? `${b.body}\n\n--\n${r.signature}` : b.body;
  let accepted = false, messageId: string | null = null, err: string | null = null;
  try {
    const info = await transportFor(r).sendMail({ from: { name: r.from_name, address: r.from_email }, replyTo: r.reply_to ?? undefined, to: b.to, subject: b.subject, text });
    accepted = (info.accepted?.length ?? 0) > 0; messageId = info.messageId ?? null;
    if (!accepted) err = "El servidor SMTP no ha acceptat el destinatari";
  } catch (e) { err = e instanceof HttpError ? e.message : explainSmtpError(e as Parameters<typeof explainSmtpError>[0]); }
  const delivery = accepted ? "enviat" : "error";
  let registered = false;
  if (b.kind === "ressenya" || b.kind === "proteccio_dades") {
    // el correu ja ha sortit: si el registre falla (p. ex. duplicat de menys de 2 min) igualment queda constància a l'historial
    if (accepted) registered = await registerRequest(u, { clientId: c.id, kind: b.kind, language: b.language as Lang, channel: "email", recipient: b.to, message: b.body, legal_basis: b.legal_basis ?? null }, "enviat").then(() => true, () => false);
  }
  if (!registered) {
    await u.sb.from("crm_activities").insert({ client_id: c.id, type: "email", title: `${accepted ? "Correu enviat" : "Correu NO enviat"}: ${b.subject}`, body: accepted ? b.body.slice(0, 2000) : err, delivery, user_id: u.user.id, user_name: u.profile.name, meta: { from: r.from_email, to: b.to, messageId, kind: b.kind } });
  }
  if (!accepted) throw new HttpError(502, `No s'ha enviat: ${err}`);
  return { ok: true, messageId, from: r.from_email };
}

/** WhatsApp Business Cloud API amb el número empresarial autoritzat de l'usuari. */
export async function sendClientWhatsapp(u: U, raw: unknown) {
  internal(u);
  const b = z.object({ clientId: z.string().uuid(), to: z.string().max(30), body: z.string().min(1).max(4096), kind: z.enum(["ressenya", "proteccio_dades", "lliure"]), language: z.enum(["ca", "es"]).default("ca") }).parse(raw);
  const c = await clientFor(u, b.clientId);
  const p = contactAllowed(c.contact_preference, c.commercial_opt_out, "whatsapp", b.kind === "ressenya" ? "comercial" : "servei");
  if (!p.ok) throw new HttpError(409, p.reason!);
  const to = waDigits(b.to);
  if (!to) throw new HttpError(400, "Telèfon del client no vàlid per a WhatsApp");
  const wamid = await sendCloudText(u, to, b.body, c.id);
  await u.sb.from("crm_activities").insert({ client_id: c.id, type: "whatsapp", title: wamid ? "WhatsApp acceptat per Meta (pendent de lliurament)" : "WhatsApp NO enviat", body: b.body.slice(0, 2000), delivery: wamid ? "enviat" : "error", user_id: u.user.id, user_name: u.profile.name, meta: { wamid, kind: b.kind } });
  if (!wamid) throw new HttpError(502, "Meta no ha acceptat el missatge de WhatsApp");
  // el missatge ja l'ha acceptat Meta (i consta a l'historial): un error de registre no el converteix en fallit
  if (b.kind !== "lliure") await registerRequest(u, { clientId: c.id, kind: b.kind, language: b.language, channel: "whatsapp", recipient: `+${to}`, message: b.body }, "enviat").catch(() => null);
  return { ok: true, status: "acceptat" };
}

/**
 * Envia un text per WhatsApp Business Cloud API amb el número empresarial autoritzat de l'usuari i en desa el registre
 * a cap_whatsapp_messages. Retorna l'identificador de Meta (wamid) o null si Meta no l'ha acceptat.
 * Llança error si l'usuari no té configurat el mode Cloud, si no hi ha número autoritzat o si s'està fora de la
 * finestra de 24 h (Meta només accepta plantilles aprovades). Reutilitzat per «Contactar tots».
 */
export async function sendCloudText(u: U, to: string, body: string, clientId: string | null): Promise<string | null> {
  const { data: cfg } = await u.sb.from("user_whatsapp").select("mode,default_number_id").eq("user_id", u.user.id).maybeSingle();
  if (!cfg || cfg.mode !== "cloud" || !cfg.default_number_id) throw new HttpError(400, "No tens configurat l'enviament amb WhatsApp Business Cloud API: fes servir «Obre WhatsApp»");
  const { data: acc } = await u.sb.from("wa_number_access").select("number_id, wa_business_numbers(phone_number_id,active)").eq("number_id", cfg.default_number_id).eq("user_id", u.user.id).maybeSingle();
  const num = (Array.isArray(acc?.wa_business_numbers) ? acc?.wa_business_numbers[0] : acc?.wa_business_numbers) as { phone_number_id: string; active: boolean } | undefined;
  if (!num?.active) throw new HttpError(403, "No tens autoritzat cap número empresarial actiu");
  if (!env.waToken) throw new HttpError(503, "WhatsApp Business Cloud API pendent de configurar (WHATSAPP_TOKEN)");
  // fora de la finestra de 24 h, Meta només permet plantilles aprovades: no s'intenta enviar text lliure
  const { data: last } = await adminClient().from("cap_whatsapp_messages").select("created_at").eq("direction", "entrant").eq("phone", `+${to}`).order("created_at", { ascending: false }).limit(1);
  const lastIn = (last?.[0] as { created_at?: string } | undefined)?.created_at ?? null;
  if (!lastIn || Date.now() - Date.parse(lastIn) > 24 * 3600_000) throw new HttpError(409, "El client no t'ha escrit en les últimes 24 h: WhatsApp només permet enviar-li una plantilla aprovada per Meta. Fes servir «Obre WhatsApp» (mode enllaç).");
  const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(num.phone_number_id)}/messages`, { method: "POST", headers: { authorization: `Bearer ${env.waToken}`, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: true } }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  const wamid = (j as { messages?: { id: string }[] }).messages?.[0]?.id ?? null;
  await adminClient().from("cap_whatsapp_messages").insert({ client_id: clientId, direction: "sortint", wa_message_id: wamid, phone: `+${to}`, body, status: wamid ? "acceptat" : "fallit", status_at: new Date().toISOString(), error: wamid ? null : "Meta no ha acceptat el missatge", created_by: u.user.id });
  return wamid;
}

/** Confirmació manual d'un WhatsApp obert amb l'enllaç («L'he enviat»): passa de «intent» a «registrat». */
export async function confirmRequestSent(u: U, id: string) {
  internal(u);
  const { data, error } = await u.sb.from("client_requests").update({ delivery: "registrat", status: "enviada" }).eq("id", z.string().uuid().parse(id)).eq("kind", "ressenya").select("id").maybeSingle();
  if (error || !data) throw new HttpError(403, "No s'ha pogut confirmar");
  return { ok: true };
}

/**
 * Fase 8.2 · Envia un correu amb el compte SMTP propi de l'usuari (p. ex. una reclamació a una comercialitzadora).
 * No llança error si el servidor SMTP el rebutja: retorna `accepted: false` i el motiu, perquè qui crida ho registri.
 * No afegeix la signatura del perfil (el cos ja inclou la signatura corporativa).
 */
export async function sendFromMyMailbox(u: U, msg: { to: string; cc?: string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer; contentType: string }[] }) {
  internal(u);
  const r = await mailRow(u.user.id);
  if (!r || !r.enabled || r.revoked_at || !r.password_enc) throw new HttpError(400, "Configura el teu correu a «El meu perfil → Comunicacions → Email» abans d'enviar");
  try {
    const info = await transportFor(r).sendMail({ from: { name: r.from_name, address: r.from_email }, replyTo: r.reply_to ?? undefined, to: msg.to, cc: msg.cc?.length ? msg.cc : undefined, subject: msg.subject, text: msg.text, attachments: msg.attachments });
    const accepted = (info.accepted?.length ?? 0) > 0;
    return { accepted, messageId: info.messageId ?? null, from: r.from_email, error: accepted ? null : "El servidor SMTP no ha acceptat el destinatari" };
  } catch (e) {
    return { accepted: false, messageId: null, from: r.from_email, error: e instanceof HttpError ? e.message : explainSmtpError(e as Parameters<typeof explainSmtpError>[0]) };
  }
}
