import "server-only";
/**
 * CENTRE D'ALERTES I AUTOMATITZACIONS (Fase 7) · servidor.
 * Consolida en un sol lloc les automatitzacions de totes les fases: regles actives, últimes execucions, errors,
 * reintents, tasques i avisos generats, i l'estat real de cada integració (sense simular cap connexió).
 * consolidationAutomations(): escalats de tasques vençudes i incidències urgents, i errors d'integració.
 */
import { planEscalations, OPEN_TASK } from "@/core/control";
import { env, integrations, sipsEnv } from "./env";
import { HttpError, adminClient } from "./supabase";
import { hasPerm, requirePerm } from "./permissions";
import type { U } from "./crm";

type SB = ReturnType<typeof adminClient>;
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "42703" || /does not exist|Could not find/i.test(e.message ?? ""));

/** Executat dins de runAutomations(): idempotent (claus úniques per tasca/incidència i nivell). */
export async function consolidationAutomations(sb: SB, now: Date, rules: { key: string; enabled?: boolean; params: Record<string, unknown> }[]) {
  const active = rules.filter((r) => ["tasca_vencuda", "incidencia_urgent", "error_integracio"].includes(r.key));
  if (!active.length) return { notifications: [], taskLevels: [], incidentLevels: [] };
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const [tasks, incs, roles, syncs, runs, hooks, reads, ai] = await Promise.all([
    sb.from("crm_tasks").select("id,title,status,due_at,assigned_to,escalation_level").in("status", [...OPEN_TASK]).lt("due_at", now.toISOString()).limit(5000),
    sb.from("crm_incidents").select("id,title,status,priority,opened_at,due_at,assigned_to,escalation_level,closed_at").not("status", "in", "(resolta,tancada)").in("priority", ["alta", "urgent"]).limit(2000),
    sb.from("profiles").select("id,role").in("role", ["admin", "cap_administrativa"]),
    sb.from("sync_runs").select("at,origin,error,ok").eq("ok", false).gte("at", since).limit(50),
    sb.from("crm_automation_runs").select("started_at,error,ok").eq("ok", false).gte("started_at", since).limit(50),
    sb.from("cap_webhook_events").select("received_at,provider,error,status").eq("status", "error").gte("received_at", since).limit(50),
    sb.from("cap_invoice_readings").select("updated_at,error,status,attempts").eq("status", "error").gte("updated_at", since).limit(50),
    sb.from("ai_analysis_runs").select("started_at,status,errors").eq("status", "error").gte("started_at", since).limit(20),
  ]);
  if (tasks.error && isMissing(tasks.error)) return { notifications: [], taskLevels: [], incidentLevels: [] };
  const R = (roles.data ?? []) as { id: string; role: string }[];
  const failures = [
    ...((syncs.data ?? []) as { at: string; origin: string; error: string | null }[]).map((x) => ({ source: `Sincronització (${x.origin})`, at: x.at, error: x.error ?? "Error" })),
    ...((runs.data ?? []) as { started_at: string; error: string | null }[]).map((x) => ({ source: "Automatitzacions", at: x.started_at, error: x.error ?? "Error" })),
    ...((hooks.data ?? []) as { received_at: string; provider: string; error: string | null }[]).map((x) => ({ source: `Webhook ${x.provider}`, at: x.received_at, error: x.error ?? "Error" })),
    ...((reads.data ?? []) as { updated_at: string; error: string | null; attempts: number }[]).filter((x) => x.attempts >= 3).map((x) => ({ source: "Lectura de factures", at: x.updated_at, error: x.error ?? "Error de lectura" })),
    ...((ai.data ?? []) as { started_at: string; errors: unknown }[]).map((x) => ({ source: "Motor d'IA", at: x.started_at, error: JSON.stringify(x.errors).slice(0, 160) })),
  ];
  return planEscalations({
    now, rules: active, tasks: (tasks.data ?? []) as never, incidents: (incs.data ?? []) as never,
    capIds: R.filter((r) => r.role === "cap_administrativa").map((r) => r.id), direccioIds: R.filter((r) => r.role === "admin").map((r) => r.id), failures,
  });
}

/** Estat real de les integracions (només si hi ha configuració; no es fa cap crida simulada). */
export async function integrationsStatus() {
  const i = integrations();
  const sips = sipsEnv();
  const sipsOk = !!(sips.user && sips.pass);
  const { integrationStatus } = await import("./marketing");
  const cap = integrationStatus();
  const { smtpReady } = await import("./mailer");
  const smtp = await smtpReady().catch(() => false);
  return [
    { id: "supabase", label: "Supabase (base de dades)", ok: i.supabase, note: i.supabase ? "Connectat (URL, clau pública i clau de servei definides)" : "Falten variables de Supabase" },
    { id: "cron", label: "Tasques programades (Vercel Cron)", ok: !!env.cronSecret, note: env.cronSecret ? "CRON_SECRET definit" : "Falta CRON_SECRET: les automatitzacions només s'executen manualment o en obrir la jornada" },
    { id: "smtp", label: "Correu (SMTP)", ok: smtp, note: smtp ? "Configurat" : "Pendent: sense SMTP no s'envien informes ni correus" },
    { id: "ia", label: "IA (Anthropic)", ok: i.ai, note: i.ai ? `Model ${env.anthropicModel}` : "Pendent: falta ANTHROPIC_API_KEY (el motor funciona en mode regles)" },
    { id: "sips", label: "SIPS", ok: sipsOk, note: sipsOk ? "Credencials al servidor" : "Pendent de credencials" },
    { id: "google", label: "Google Drive (importació opcional)", ok: i.googleSync, note: i.googleSync ? "Configurat" : "No configurat (no és necessari: el CRM no depèn d'Excel)" },
    { id: "signatura", label: "Signatura electrònica", ok: !!process.env.SIGNATURE_PROVIDER, note: process.env.SIGNATURE_PROVIDER ? `Proveïdor ${process.env.SIGNATURE_PROVIDER}` : "Pendent: es fa servir la signatura manual registrada" },
    ...Object.entries(cap).filter(([k]) => k !== "landing").map(([k, v]) => ({ id: k, label: v.label, ok: v.ok, note: v.note })),
  ];
}

export async function alertsCenter(u: U) {
  if (!(await hasPerm(u, "configuracio")) && !(await hasPerm(u, "panell_cap"))) throw new HttpError(403, "El centre d'alertes és per a Direcció i la Cap administrativa");
  const sb = u.sb;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [rules, runs, notes, subs, reads, hooks, syncs, ai, reports] = await Promise.all([
    sb.from("crm_automation_rules").select("key,name,description,enabled,params,updated_at").order("key"),
    sb.from("crm_automation_runs").select("id,started_at,finished_at,trigger,tasks_created,notifications_created,ok,error").order("started_at", { ascending: false }).limit(30),
    sb.from("crm_notifications").select("kind,created_at").gte("created_at", since).limit(5000),
    sb.from("cap_submissions").select("id,channel,status,attempts,error,received_at").eq("status", "error").order("received_at", { ascending: false }).limit(20),
    sb.from("cap_invoice_readings").select("id,status,attempts,error,updated_at").eq("status", "error").order("updated_at", { ascending: false }).limit(20),
    sb.from("cap_webhook_events").select("id,provider,status,error,received_at").in("status", ["error", "pendent_credencials"]).order("received_at", { ascending: false }).limit(20),
    sb.from("sync_runs").select("id,at,origin,ok,error,added,updated").order("at", { ascending: false }).limit(10),
    sb.from("ai_analysis_runs").select("id,started_at,finished_at,status,attempts,trigger").order("started_at", { ascending: false }).limit(10),
    sb.from("report_runs").select("kind,period_key,status,error,at").order("at", { ascending: false }).limit(20),
  ]);
  const runRows = (runs.data ?? []) as { ok: boolean | null; started_at: string; tasks_created: number; notifications_created: number }[];
  const byKind: Record<string, number> = {};
  for (const n of (notes.data ?? []) as { kind: string }[]) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  return {
    rules: rules.data ?? [], runs: runRows, lastRun: runRows[0] ?? null,
    stats: { errors7d: runRows.filter((r) => r.ok === false && r.started_at >= since).length, tasks7d: runRows.filter((r) => r.started_at >= since).reduce((a, r) => a + (r.tasks_created ?? 0), 0), notifications7d: Object.values(byKind).reduce((a, b) => a + b, 0), byKind },
    retries: { submissions: subs.data ?? [], readings: reads.data ?? [], webhooks: hooks.data ?? [] },
    syncs: syncs.data ?? [], ai: ai.data ?? [], reports: reports.data ?? [],
    integrations: await integrationsStatus(),
    canRun: await hasPerm(u, "configuracio", "edit"),
  };
}

export async function alertsAction(u: U, action: string) {
  await requirePerm(u, "configuracio", "edit");
  if (action === "run") { const { runAutomations } = await import("./automations"); return runAutomations("manual"); }
  if (action === "retry_capture") { const { processPendingCapture } = await import("./capture"); return processPendingCapture(); }
  throw new HttpError(400, "Acció desconeguda");
}
