import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * Diagnòstic de configuració.
 * Fase 8: SENSE sessió de Direcció només respon «ok» (per a monitors de disponibilitat): no revela recomptes,
 * noms de fitxers, servidors SMTP, models ni missatges d'error interns, i no fa cap crida a proveïdors externs
 * (evita que un anònim provoqui costos o enumeri la configuració). El detall complet és només per a Direcció.
 */
export async function GET() {
  const { requireInternal } = await import("@/server/permissions");
  try {
    await requireInternal({ admin: true });
  } catch {
    return Response.json({ ok: true, at: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  }
  const checks: Record<string, { ok: boolean; detail: string }> = {};
  const set = (k: string, ok: boolean, detail: string) => (checks[k] = { ok, detail });

  // --- Supabase
  const hasSb = !!(env.supabaseUrl && env.supabaseAnon);
  set("supabase_env", hasSb && !!env.supabaseService, !hasSb ? "Falten NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY" : !env.supabaseService ? "Falta SUPABASE_SERVICE_ROLE_KEY" : "Variables presents");
  if (hasSb && env.supabaseService) {
    try {
      // same client and key handling as the sync job (works with legacy JWT keys and new sb_secret_ keys)
      const { adminClient } = await import("@/server/supabase");
      const sb = adminClient();
      const t = await sb.from("contracts").select("id", { count: "exact", head: true });
      if (t.error) {
        const missing = /does not exist|schema cache|not find/i.test(t.error.message);
        set("supabase_schema", false, missing ? "Les taules no existeixen: executa supabase/migrations/001_init.sql" : `Error de Supabase: ${t.error.message.slice(0, 120)}`);
      } else {
        set("supabase_schema", true, `Taules creades · ${t.count ?? 0} contractes`);
        const a2 = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
        const admins = a2.count ?? 0;
        const c6 = await sb.from("tariff_versions").select("id", { count: "exact", head: true });
        if (c6.error) set("comparatives", false, "Falta la migració supabase/migrations/006_comparatives_ia.sql");
        else {
          const { data: buckets } = await sb.storage.listBuckets();
          const names = new Set((buckets ?? []).map((b) => b.name));
          const okB = names.has("invoices") && names.has("proposals");
          set("comparatives", okB, okB ? `Taules i espais privats creats · ${c6.count ?? 0} versions de tarifa` : "Falten els espais privats «invoices» / «proposals» (torna a executar la migració 006)");
        }
        set("supabase_admin", admins > 0, admins > 0 ? `${admins} administrador(s)` : "No hi ha usuaris: crea el primer a Supabase → Authentication (serà administrador)");
      }
    } catch (e) {
      set("supabase_schema", false, `No s'ha pogut connectar amb Supabase (${e instanceof Error ? e.message : e})`);
    }
  }

  // --- Google
  if (!env.googleSa) set("google", false, "Falta GOOGLE_SERVICE_ACCOUNT_JSON");
  else if (!env.crmFileId && !process.env.SOURCE_CRM_FOLDER_ID) set("google", false, "Falta SOURCE_CRM_FILE_ID o SOURCE_CRM_FOLDER_ID");
  else {
    try {
      const creds = JSON.parse(env.googleSa);
      const { readDriveMeta } = await import("@/server/google");
      const files: string[] = [];
      for (const [label, id] of [["CRM", env.crmFileId], ["registre diari", env.diarioFileId]] as const) {
        if (!id) continue;
        try { files.push(`${label}: ${(await readDriveMeta(id)).name}`); }
        catch (e) { throw new Error(`Sense accés al fitxer ${label}. Comparteix-lo amb ${creds.client_email} (${e instanceof Error ? e.message.slice(0, 80) : e})`); }
      }
      if (process.env.SOURCE_CRM_FOLDER_ID) {
        const { latestInFolder } = await import("@/server/google");
        const f = await latestInFolder(process.env.SOURCE_CRM_FOLDER_ID, process.env.SOURCE_CRM_PREFIX ?? "Contratos_");
        files.push(f ? `Última exportació del CRM a la carpeta: ${f.name}` : "No hi ha fitxers «Contratos_…» a la carpeta");
      }
      set("google", true, files.join(" · ") || "Credencials vàlides");
    } catch (e) {
      set("google", false, e instanceof SyntaxError ? "GOOGLE_SERVICE_ACCOUNT_JSON no és un JSON vàlid" : e instanceof Error ? e.message : String(e));
    }
  }

  // --- Correu (configuració del CRM o variables SMTP_*)
  try {
    const { mailConfig, readMailRow } = await import("@/server/mailer");
    const [cfg, row] = await Promise.all([mailConfig(), readMailRow()]);
    if (cfg) set("smtp", true, `${cfg.source === "crm" ? "Configurat al CRM" : "Variables SMTP_* de Vercel"} · ${cfg.host}:${cfg.port} · remitent ${cfg.fromEmail}${row?.last_test_at ? ` · última prova ${row.last_test_ok ? "correcta" : "amb error"}` : ""}`);
    else if (row?.enabled && row.password_enc) set("smtp", false, "La contrasenya desada no es pot desxifrar: torna-la a introduir a Configuració → Correu");
    else set("smtp", false, "Sense configurar: ves a Configuració → Correu");
  } catch (e) {
    set("smtp", false, `No s'ha pogut comprovar (${e instanceof Error ? e.message.slice(0, 80) : e})`);
  }

  // --- AI (validates the key with a free models request)
  if (!env.anthropicKey) set("ai", false, "Falta ANTHROPIC_API_KEY");
  else {
    try {
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01" }, cache: "no-store" });
      set("ai", r.ok, r.ok ? `Clau vàlida · model ${env.anthropicModel}` : r.status === 401 ? "La clau ANTHROPIC_API_KEY no és vàlida" : `El proveïdor ha respost ${r.status}`);
    } catch (e) {
      set("ai", false, `No s'ha pogut contactar amb el proveïdor d'IA (${e instanceof Error ? e.message : e})`);
    }
  }
  const invAi = process.env.INVOICE_AI_ENABLED === "true";
  set("invoice_ai", invAi && !!env.anthropicKey, !invAi ? "Desactivada: defineix INVOICE_AI_ENABLED=true i torna a desplegar (només es llegeixen PDF digitals)" : !env.anthropicKey ? "INVOICE_AI_ENABLED=true però falta ANTHROPIC_API_KEY" : "Activada · factures escanejades i fotos");
  set("cron", !!env.cronSecret, env.cronSecret ? "CRON_SECRET definit" : "Falta CRON_SECRET (la sincronització diària automàtica no s'executarà)");
  // --- SIPS i calendaris (només configuració: la prova real de connexió es fa a demanda des de Configuració → Integracions)
  {
    const { sipsMissing } = await import("@/server/sips");
    const miss = sipsMissing();
    set("sips", !miss.length, miss.length ? `Falten ${miss.join(", ")} (portal SIPS)` : "Credencials presents · fes «Prova la connexió» per verificar-les");
    const { calendarConfig } = await import("@/server/calendar");
    const cal = calendarConfig();
    set("calendar_google", cal.google.ready, cal.google.ready ? "OAuth de Google configurat" : `Falten ${cal.google.missing.join(", ")}`);
    set("calendar_microsoft", cal.microsoft.ready, cal.microsoft.ready ? "OAuth de Microsoft configurat" : `Falten ${cal.microsoft.missing.join(", ")}`);
  }

  return Response.json({ checks, at: new Date().toISOString() });
}
