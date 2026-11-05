import "server-only";
import type { Integrations } from "@/core/types";

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseService: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  googleSa: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
  crmFileId: process.env.SOURCE_CRM_FILE_ID ?? "",
  diarioFileId: process.env.SOURCE_DIARIO_FILE_ID ?? "",
  writebackSheetId: process.env.WRITEBACK_SHEET_ID ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
  waToken: process.env.WHATSAPP_TOKEN ?? "",
  waPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
};

const num = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(max, Math.max(min, n)) : d;
};

/** Configuració del motor SIPS (només servidor). Les credencials no surten mai d'aquest mòdul. */
export function sipsEnv() {
  return {
    base: (process.env.SIPS_BASE_URL || "https://eas.renovaenergy.es").replace(/\/$/, ""),
    user: process.env.SIPS_USER ?? "",
    pass: process.env.SIPS_PASSWORD ?? "",
    /** Dies que una consulta correcta es considera vigent (TTL). */
    ttlDays: num(process.env.SIPS_TTL_DAYS, 7, 1, 90),
    /** Hores mínimes abans de reintentar un CUPS amb error (es duplica a cada error, fins a 7 dies). */
    errorRetryHours: num(process.env.SIPS_ERROR_RETRY_HOURS, 24, 1, 168),
    /** CUPS màxims per execució automàtica (cron) i concurrència amb el portal. */
    cronLimit: num(process.env.SIPS_CRON_LIMIT, 12, 1, 200),
    concurrency: num(process.env.SIPS_CONCURRENCY, 2, 1, 4),
    /** Consultes màximes per usuari i minut. */
    rateSearch: num(process.env.SIPS_RATE_SEARCH_PER_MIN, 20, 1, 200),
    rateRefresh: num(process.env.SIPS_RATE_REFRESH_PER_MIN, 30, 1, 200),
    /** Rols que poden consultar subministraments externs (fora del CRM). Per defecte, l'equip d'administració. */
    externalRoles: (process.env.SIPS_EXTERNAL_ROLES || "admin,cap_administrativa,administrativa")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

/** Comprova les variables mínimes de Supabase i retorna un missatge entenedor (sense valors). */
export function supabaseEnvProblem(): string | null {
  const missing = [
    !env.supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !env.supabaseAnon && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean);
  if (missing.length) return `Supabase no està configurat en aquest desplegament: falta ${missing.join(" i ")}. Defineix-les a Vercel (Production i Preview) i torna a desplegar: les variables NEXT_PUBLIC_ s'incorporen durant la compilació.`;
  if (!/^https:\/\/.+/.test(env.supabaseUrl)) return "NEXT_PUBLIC_SUPABASE_URL no té un format vàlid (ha de començar per https://).";
  return null;
}

export function integrations(): Integrations {
  return {
    supabase: !!(env.supabaseUrl && env.supabaseAnon && env.supabaseService),
    googleSync: !!(env.googleSa && (env.crmFileId || process.env.SOURCE_CRM_FOLDER_ID)),
    smtp: !!(env.smtpHost && env.smtpUser && env.smtpPass),
    ai: !!env.anthropicKey,
    whatsappCloud: !!(env.waToken && env.waPhoneId),
  };
}

/** Fase 6 · captació i màrqueting (només servidor). Sense credencials, la integració queda «pendent». */
export function captureEnv() {
  return {
    hashSalt: process.env.CAPTURE_HASH_SALT || process.env.CRON_SECRET || "assessoria30-captacio",
    appUrl: (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, ""),
    publicUrl: (process.env.NEXT_PUBLIC_LANDING_URL || process.env.APP_URL || "").replace(/\/$/, ""),
    metaAppSecret: process.env.META_APP_SECRET ?? "",
    metaVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
    metaPageToken: process.env.META_PAGE_ACCESS_TOKEN ?? "",
    googleAds: {
      developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
      customerId: (process.env.GOOGLE_ADS_CUSTOMER_ID ?? "").replace(/\D/g, ""),
      loginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "").replace(/\D/g, ""),
      clientId: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
      refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "",
    },
    /** Lectura de factures captades amb IA: requereix INVOICE_AI_ENABLED=true (mateix interruptor que el comparador). */
    autoProposal: process.env.CAPTURE_AUTO_PRELIMINARY !== "false",
  };
}
