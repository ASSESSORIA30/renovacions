import "server-only";
/**
 * CORREU CORPORATIU (servidor).
 * Configuració: la que l'administrador ha desat a Configuració → Correu (taula `mail_settings`, contrasenya xifrada);
 * si no n'hi ha, les variables SMTP_* de Vercel. La contrasenya no surt mai d'aquest mòdul ni es registra als logs.
 */
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { fromHeader, replyToFor, type MailSecurity, type ReplyToMode } from "@/core/mail";
export { fromHeader, replyToFor };
import { env } from "./env";
import { open, seal } from "./secret-box";
import { adminClient } from "./supabase";

export interface MailConfig {
  source: "crm" | "entorn";
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password: string;
  fromName: string | null;
  fromEmail: string;
  replyToMode: ReplyToMode;
  replyTo: string | null;
  bccSender: boolean;
}

export const MAIL_PURPOSE = "mail-smtp-password";
export const keyMaterial = () => process.env.SETTINGS_ENCRYPTION_KEY || env.supabaseService;
export const sealPassword = (p: string) => seal(p, keyMaterial(), MAIL_PURPOSE);
export const openPassword = (s: string) => open(s, keyMaterial(), MAIL_PURPOSE);

export type MailRow = {
  enabled: boolean; host: string; port: number; security: MailSecurity; username: string; password_enc: string | null;
  from_name: string | null; from_email: string; reply_to_mode: ReplyToMode; reply_to: string | null; bcc_sender: boolean;
  last_test_at: string | null; last_test_ok: boolean | null; last_test_error: string | null; updated_at: string | null; updated_by_name: string | null;
};

const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|not find/i.test(e.message ?? ""));

/** Fila desada al CRM (null si no n'hi ha o si la migració 007 encara no s'ha aplicat). */
export async function readMailRow(): Promise<MailRow | null> {
  if (!env.supabaseUrl || !env.supabaseService) return null;
  const { data, error } = await adminClient().from("mail_settings").select("*").eq("id", 1).maybeSingle();
  if (error) {
    if (!isMissing(error)) console.warn("[correu] no s'ha pogut llegir la configuració:", error.message);
    return null;
  }
  return (data as MailRow | null) ?? null;
}

export function envMailConfig(): MailConfig | null {
  if (!(env.smtpHost && env.smtpUser && env.smtpPass)) return null;
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(env.smtpFrom);
  return {
    source: "entorn", host: env.smtpHost, port: env.smtpPort, security: env.smtpPort === 465 ? "ssl" : "starttls",
    username: env.smtpUser, password: env.smtpPass, fromName: m ? m[1].trim() || null : null, fromEmail: m ? m[2].trim() : env.smtpFrom || env.smtpUser,
    replyToMode: "usuari", replyTo: null, bccSender: false,
  };
}

let cache: { at: number; cfg: MailConfig | null } | null = null;
export const invalidateMailCache = () => { cache = null; transport = null; };

/** Configuració activa: la del CRM (si està activada i la contrasenya es pot desxifrar) o la de l'entorn. */
export async function mailConfig(): Promise<MailConfig | null> {
  if (cache && Date.now() - cache.at < 30_000) return cache.cfg;
  const row = await readMailRow();
  let cfg: MailConfig | null = null;
  if (row?.enabled && row.password_enc) {
    const password = openPassword(row.password_enc);
    if (password != null) cfg = { source: "crm", host: row.host, port: row.port, security: row.security, username: row.username, password, fromName: row.from_name, fromEmail: row.from_email, replyToMode: row.reply_to_mode, replyTo: row.reply_to, bccSender: row.bcc_sender };
    else console.warn("[correu] la contrasenya desada no es pot desxifrar (ha canviat la clau del servidor): cal tornar-la a introduir");
  }
  cfg ??= envMailConfig();
  cache = { at: Date.now(), cfg };
  return cfg;
}

export const smtpReady = async () => !!(await mailConfig());

export function createTransport(c: Pick<MailConfig, "host" | "port" | "security" | "username" | "password">): Transporter {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.security === "ssl",
    requireTLS: c.security === "starttls",
    ignoreTLS: c.security === "none",
    auth: { user: c.username, pass: c.password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

let transport: { key: string; t: Transporter } | null = null;

/**
 * Envia un correu amb el compte corporatiu. `user` = qui l'envia (per a la resposta).
 * Retorna només si el servidor SMTP l'ha acceptat.
 */
export async function sendCorporateMail(msg: Omit<SendMailOptions, "from" | "replyTo">, user?: { email?: string | null; name?: string | null } | null) {
  const c = await mailConfig();
  if (!c) throw Object.assign(new Error("El correu corporatiu no està configurat (Configuració → Correu)."), { status: 400 });
  const key = `${c.source}|${c.host}|${c.port}|${c.security}|${c.username}|${c.password.length}`;
  if (!transport || transport.key !== key) transport = { key, t: createTransport(c) };
  return transport.t.sendMail({ ...msg, from: fromHeader(c), replyTo: replyToFor(c, user), ...(c.bccSender ? { bcc: c.fromEmail } : {}) });
}
