import { z } from "zod";
import { explainSmtpError, mailSettingsInput, type MailSettingsView } from "@/core/mail";
import { env } from "@/server/env";
import { createTransport, envMailConfig, fromHeader, invalidateMailCache, openPassword, readMailRow, sealPassword, type MailRow } from "@/server/mailer";
import { adminClient, handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CONFIGURACIÓ DEL CORREU (només administradors).
 * La contrasenya s'envia una sola vegada en desar, es xifra al servidor i mai es retorna al navegador.
 */

function view(row: MailRow | null): MailSettingsView {
  const envCfg = envMailConfig();
  if (row) {
    const unreadable = !!row.password_enc && openPassword(row.password_enc) == null;
    return {
      source: row.enabled && row.password_enc && !unreadable ? "crm" : envCfg ? "entorn" : null,
      enabled: row.enabled, host: row.host, port: row.port, security: row.security, username: row.username,
      hasPassword: !!row.password_enc && !unreadable, passwordUnreadable: unreadable,
      fromName: row.from_name, fromEmail: row.from_email, replyToMode: row.reply_to_mode, replyTo: row.reply_to, bccSender: row.bcc_sender,
      lastTest: row.last_test_at ? { at: row.last_test_at, ok: !!row.last_test_ok, error: row.last_test_error } : null,
      updatedAt: row.updated_at, updatedByName: row.updated_by_name, envConfigured: !!envCfg,
    };
  }
  return {
    source: envCfg ? "entorn" : null, enabled: true,
    host: envCfg?.host ?? "", port: envCfg?.port ?? 587, security: envCfg?.security ?? "starttls", username: envCfg?.username ?? "",
    hasPassword: false, passwordUnreadable: false, fromName: envCfg?.fromName ?? null, fromEmail: envCfg?.fromEmail ?? "",
    replyToMode: "usuari", replyTo: null, bccSender: false, lastTest: null, updatedAt: null, updatedByName: null, envConfigured: !!envCfg,
  };
}

async function migrated() {
  const { error } = await adminClient().from("mail_settings").select("id", { head: true, count: "exact" });
  if (error) throw new HttpError(409, "Falta aplicar la migració supabase/migrations/007_correu_smtp.sql a Supabase.");
}

const tests = new Map<string, number[]>();
function limitTests(userId: string) {
  const now = Date.now();
  const recent = (tests.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 5) throw new HttpError(429, "Massa proves seguides. Espera un minut.");
  tests.set(userId, [...recent, now]);
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), settings: z.unknown() }),
  z.object({ action: z.literal("test"), settings: z.unknown().optional(), to: z.string().trim().email().max(200).optional() }),
  z.object({ action: z.literal("enable"), enabled: z.boolean() }),
  z.object({ action: z.literal("delete") }),
]);

export const GET = handler(async () => {
  await requireInternal({ admin: true });
  if (!env.supabaseService) throw new HttpError(503, "Supabase no està configurat al servidor.");
  await migrated();
  return view(await readMailRow());
});

export const POST = handler(async (req) => {
  const u = await requireInternal({ admin: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  await migrated();
  const sb = adminClient();
  const b = p.data;
  const row = await readMailRow();

  if (b.action === "delete") {
    await sb.from("mail_settings").delete().eq("id", 1);
    invalidateMailCache();
    return view(null);
  }
  if (b.action === "enable") {
    if (!row) throw new HttpError(404, "Encara no hi ha cap configuració desada");
    await sb.from("mail_settings").update({ enabled: b.enabled, updated_by: u.user.id, updated_by_name: u.profile.name, updated_at: new Date().toISOString() }).eq("id", 1);
    invalidateMailCache();
    return view(await readMailRow());
  }

  const parse = (raw: unknown) => {
    const s = mailSettingsInput.safeParse(raw);
    if (!s.success) throw new HttpError(400, s.error.issues.map((i) => i.message).join(" · "));
    return s.data;
  };

  if (b.action === "save") {
    const s = parse(b.settings);
    const savedPass = row?.password_enc && openPassword(row.password_enc) != null ? row.password_enc : null;
    if (!s.password && !savedPass) throw new HttpError(400, "Falta la contrasenya del compte de correu");
    const password_enc = s.password ? sealPassword(s.password) : savedPass;
    const r = await sb.from("mail_settings").upsert({
      id: 1, enabled: s.enabled, host: s.host.toLowerCase(), port: s.port, security: s.security, username: s.username, password_enc,
      from_name: s.fromName, from_email: s.fromEmail, reply_to_mode: s.replyToMode, reply_to: s.replyToMode === "fixa" ? s.replyTo : null, bcc_sender: s.bccSender,
      // canviar la configuració invalida la prova anterior
      last_test_at: null, last_test_ok: null, last_test_error: null,
      updated_by: u.user.id, updated_by_name: u.profile.name, updated_at: new Date().toISOString(),
    });
    if (r.error) throw r.error;
    invalidateMailCache();
    return view(await readMailRow());
  }

  // --- test: amb els valors del formulari (sense desar) o amb la configuració desada
  limitTests(u.user.id);
  let cfg: { host: string; port: number; security: "starttls" | "ssl" | "none"; username: string; password: string; fromName: string | null; fromEmail: string };
  const testingSaved = b.settings === undefined;
  if (!testingSaved) {
    const s = parse(b.settings);
    const password = s.password || (row?.password_enc ? openPassword(row.password_enc) : null);
    if (!password) throw new HttpError(400, "Escriu la contrasenya per fer la prova");
    cfg = { host: s.host, port: s.port, security: s.security, username: s.username, password, fromName: s.fromName, fromEmail: s.fromEmail };
  } else {
    const password = row?.password_enc ? openPassword(row.password_enc) : null;
    if (!row || !password) throw new HttpError(400, "No hi ha cap configuració desada per provar");
    cfg = { host: row.host, port: row.port, security: row.security, username: row.username, password, fromName: row.from_name, fromEmail: row.from_email };
  }
  const to = b.to ?? u.profile.email;
  const started = Date.now();
  const t = createTransport(cfg);
  try {
    await t.verify();
    const info = await t.sendMail({
      from: fromHeader(cfg),
      to,
      subject: "Prova del correu corporatiu · Assessoria 3.0",
      text: `Aquest és un correu de prova enviat des de Configuració → Correu per ${u.profile.name}.\n\nSi l'has rebut, el CRM ja pot enviar propostes i comparatives amb aquest compte.\n\nServidor: ${cfg.host}:${cfg.port}\nRemitent: ${cfg.fromEmail}`,
    });
    if (testingSaved) await sb.from("mail_settings").update({ last_test_at: new Date().toISOString(), last_test_ok: true, last_test_error: null }).eq("id", 1);
    return { ok: true, to, accepted: (info.accepted?.length ?? 0) > 0, ms: Date.now() - started };
  } catch (e) {
    const why = explainSmtpError(e as Parameters<typeof explainSmtpError>[0]);
    if (testingSaved) await sb.from("mail_settings").update({ last_test_at: new Date().toISOString(), last_test_ok: false, last_test_error: why.slice(0, 300) }).eq("id", 1);
    console.warn("[correu] prova fallida:", (e as { code?: string }).code ?? "error"); // sense credencials
    return { ok: false, to, error: why };
  } finally {
    t.close();
  }
});
