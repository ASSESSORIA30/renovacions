/** Correu corporatiu: tipus i validació compartits (navegador i servidor). Sense secrets. */
import { z } from "zod";

export const MAIL_SECURITY = ["starttls", "ssl", "none"] as const;
export type MailSecurity = (typeof MAIL_SECURITY)[number];
export const REPLY_TO_MODES = ["usuari", "remitent", "fixa"] as const;
export type ReplyToMode = (typeof REPLY_TO_MODES)[number];

export const MAIL_PRESETS: { id: string; label: string; host: string; port: number; security: MailSecurity; note: string }[] = [
  { id: "ionos", label: "IONOS", host: "smtp.ionos.es", port: 587, security: "starttls", note: "Usuari: l'adreça de correu completa. Contrasenya: la del compte de correu." },
  { id: "m365", label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, security: "starttls", note: "Cal tenir activat «SMTP autenticat» per a aquest compte al centre d'administració de Microsoft 365. Si el compte té verificació en dos passos, fes servir una contrasenya d'aplicació." },
  { id: "google", label: "Google Workspace / Gmail", host: "smtp.gmail.com", port: 465, security: "ssl", note: "Cal una contrasenya d'aplicació (Compte de Google → Seguretat → Contrasenyes d'aplicació). La contrasenya normal no funciona." },
  { id: "arsys", label: "Arsys", host: "smtp.serviciodecorreo.es", port: 465, security: "ssl", note: "Usuari: l'adreça de correu completa." },
  { id: "hostinger", label: "Hostinger", host: "smtp.hostinger.com", port: 465, security: "ssl", note: "Usuari: l'adreça de correu completa." },
  { id: "altre", label: "Un altre proveïdor", host: "", port: 587, security: "starttls", note: "Demana al teu proveïdor el servidor SMTP, el port i el tipus de seguretat." },
];

export const SECURITY_LABEL: Record<MailSecurity, string> = { starttls: "STARTTLS (587)", ssl: "SSL/TLS (465)", none: "Sense xifrar" };
export const REPLY_TO_LABEL: Record<ReplyToMode, string> = { usuari: "A la persona que envia el correu", remitent: "A l'adreça del remitent", fixa: "A una adreça fixa" };

const email = z.string().trim().toLowerCase().email("Adreça de correu no vàlida").max(200);

export const mailSettingsInput = z
  .object({
    enabled: z.boolean().default(true),
    host: z.string().trim().min(3, "Falta el servidor SMTP").max(200).regex(/^[a-z0-9.-]+$/i, "Servidor no vàlid (només el nom, sense http:// ni espais)"),
    port: z.coerce.number().int().min(1).max(65535),
    security: z.enum(MAIL_SECURITY),
    username: z.string().trim().min(1, "Falta l'usuari").max(200),
    /** buit = conserva la contrasenya desada */
    password: z.string().max(300).optional().default(""),
    fromName: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
    fromEmail: email,
    replyToMode: z.enum(REPLY_TO_MODES).default("usuari"),
    replyTo: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
    bccSender: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.replyToMode === "fixa" && !(v.replyTo && email.safeParse(v.replyTo).success)) ctx.addIssue({ code: "custom", path: ["replyTo"], message: "Indica una adreça de resposta vàlida" });
    if (v.security === "ssl" && v.port === 587) ctx.addIssue({ code: "custom", path: ["port"], message: "El port 587 va amb STARTTLS, no amb SSL" });
    if (v.security === "starttls" && v.port === 465) ctx.addIssue({ code: "custom", path: ["port"], message: "El port 465 va amb SSL/TLS, no amb STARTTLS" });
  });
export type MailSettingsInput = z.input<typeof mailSettingsInput>;

/** El que veu el navegador: mai la contrasenya. */
export interface MailSettingsView {
  source: "crm" | "entorn" | null;
  enabled: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  hasPassword: boolean;
  passwordUnreadable: boolean;
  fromName: string | null;
  fromEmail: string;
  replyToMode: ReplyToMode;
  replyTo: string | null;
  bccSender: boolean;
  lastTest: { at: string; ok: boolean; error: string | null } | null;
  updatedAt: string | null;
  updatedByName: string | null;
  envConfigured: boolean;
}

/** Tradueix els errors de nodemailer a missatges entenedors (sense revelar credencials). */
export function explainSmtpError(e: { code?: string; responseCode?: number; response?: string; message?: string } | null | undefined): string {
  const code = e?.code ?? "";
  const resp = `${e?.response ?? ""} ${e?.message ?? ""}`;
  if (/SmtpClientAuthentication is disabled|5\.7\.139/i.test(resp)) return "Microsoft 365 té desactivat l'SMTP autenticat per a aquest compte. Activa'l a Microsoft 365 → Usuaris → el compte → Correu → «SMTP autenticat».";
  if (/Application-specific password required|InvalidSecondFactor|5\.7\.9/i.test(resp)) return "El compte demana una contrasenya d'aplicació (té la verificació en dos passos activada).";
  if (code === "EAUTH" || e?.responseCode === 535 || e?.responseCode === 534) return "Usuari o contrasenya incorrectes. Revisa'ls; si el compte té verificació en dos passos, cal una contrasenya d'aplicació.";
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || /timeout/i.test(resp)) return "No s'ha pogut connectar amb el servidor dins del temps d'espera. Revisa el servidor i el port.";
  if (code === "EDNS" || /ENOTFOUND|getaddrinfo/i.test(resp)) return "El servidor SMTP no existeix. Revisa el nom (p. ex. smtp.ionos.es).";
  if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(resp)) return "El servidor ha refusat la connexió en aquest port. Prova 587 amb STARTTLS o 465 amb SSL/TLS.";
  if (code === "ESOCKET" || /wrong version number|ssl3_get_record|tls/i.test(resp)) return "Error de xifrat: el tipus de seguretat no coincideix amb el port (587 → STARTTLS, 465 → SSL/TLS).";
  if (code === "EENVELOPE" || e?.responseCode === 550 || e?.responseCode === 553 || e?.responseCode === 554) return "El servidor no deixa enviar amb aquest remitent. L'adreça del remitent ha de ser la del compte (o un àlies autoritzat).";
  return `El servidor de correu ha retornat un error${e?.responseCode ? ` (${e.responseCode})` : ""}. Revisa la configuració.`;
}

/** Capçalera From: «Nom <adreça>» o només l'adreça. */
export const fromHeader = (c: { fromName: string | null; fromEmail: string }) => (c.fromName ? { name: c.fromName, address: c.fromEmail } : c.fromEmail);

/** A qui van les respostes del client segons la configuració. */
export function replyToFor(c: { replyToMode: ReplyToMode; replyTo: string | null }, user?: { email?: string | null; name?: string | null } | null) {
  if (c.replyToMode === "fixa" && c.replyTo) return c.replyTo;
  if (c.replyToMode === "usuari" && user?.email) return user.name ? { name: user.name, address: user.email } : user.email;
  return undefined;
}
