import "server-only";
/**
 * MOTOR D'AUTOMATITZACIONS (servidor, client de servei).
 * Llegeix les regles actives, calcula què cal crear amb `planAutomations` (pur) i ho insereix amb una clau única
 * (`rule_key`): la base de dades rebutja els duplicats, de manera que el procés és idempotent.
 * S'executa amb el cron diari de Vercel, quan algú obre «La meva jornada» (com a màxim cada 30 minuts),
 * en guanyar una oportunitat i a demanda des de Configuració → Automatitzacions.
 * Només crea tasques i avisos INTERNS: no envia correus ni WhatsApp a clients.
 */
import { OPEN_STAGES, planAutomations, type Rule, type RuleKey } from "@/core/sales";
import { OPEN_EXP_STATUSES, planExpedientAutomations, type ExpRuleKey } from "@/core/contracting";
import { adminClient } from "./supabase";

const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? ""));

async function all<T>(build: (from: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw Object.assign(new Error(error.message ?? "error"), { code: error.code });
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export async function runAutomations(trigger: "cron" | "manual" | "jornada" | "event", opts: { onlyRules?: (RuleKey | ExpRuleKey)[] } = {}) {
  const sb = adminClient();
  const run = await sb.from("crm_automation_runs").insert({ trigger }).select("id").single();
  if (run.error) {
    if (isMissing(run.error)) return { skipped: "Falta la migració 009" };
    throw run.error;
  }
  try {
    const rules = ((await sb.from("crm_automation_rules").select("key,enabled,params")).data ?? []) as Rule[];
    const active = rules.filter((r) => r.enabled && (!opts.onlyRules || (opts.onlyRules as string[]).includes(r.key)));
    if (!active.length) {
      await sb.from("crm_automation_runs").update({ finished_at: new Date().toISOString(), ok: true, detail: { note: "cap regla activa" } }).eq("id", run.data.id);
      return { tasks: 0, notifications: 0 };
    }
    const now = new Date();
    const since = new Date(now.getTime() - 120 * 86_400_000).toISOString();
    const [opps, leads, contracts, staff, profiles] = await Promise.all([
      all<{ id: string; title: string; stage: string; owner_id: string | null; client_id: string | null; lead_id: string | null; proposal_sent_at: string | null; won_at: string | null; last_activity_at: string; contract_id: string | null }>((f) =>
        sb.from("crm_opportunities").select("id,title,stage,owner_id,client_id,lead_id,proposal_sent_at,won_at,last_activity_at,contract_id").or(`stage.in.(${OPEN_STAGES.join(",")}),won_at.gte.${since}`).range(f, f + 999)),
      all<{ id: string; name: string; status: string; owner_id: string | null; created_at: string; first_contact_at: string | null }>((f) =>
        sb.from("crm_leads").select("id,name,status,owner_id,created_at,first_contact_at").eq("status", "nou").range(f, f + 999)),
      all<{ id: string; client_id: string; retailer: string; end_date: string | null; status: string; owner_id: string | null; legacy_contract_id: string | null; created_at: string; crm_clients: { name: string; owner_id: string | null } | { name: string; owner_id: string | null }[] | null }>((f) =>
        sb.from("crm_contracts").select("id,client_id,retailer,end_date,status,owner_id,legacy_contract_id,created_at,crm_clients(name,owner_id)").in("status", ["actiu", "renovacio_pendent"]).not("end_date", "is", null).range(f, f + 999)),
      sb.from("profiles").select("id").in("role", ["admin", "cap_administrativa"]),
      sb.from("profiles").select("id,name"),
    ]);
    // última activitat feta per una persona (no els canvis automàtics) de les propostes enviades
    const proposalIds = opps.filter((o) => o.stage === "proposta_enviada").map((o) => o.id);
    const lastActivity: Record<string, string> = {};
    for (let i = 0; i < proposalIds.length; i += 300) {
      const { data } = await sb.from("crm_activities").select("opportunity_id,at").in("opportunity_id", proposalIds.slice(i, i + 300)).neq("type", "canvi").order("at", { ascending: false });
      for (const a of data ?? []) if (a.opportunity_id && !lastActivity[a.opportunity_id]) lastActivity[a.opportunity_id] = a.at;
    }
    const plan = planAutomations({
      now,
      rules: active,
      opps: opps as Parameters<typeof planAutomations>[0]["opps"],
      lastActivity,
      leads: leads as Parameters<typeof planAutomations>[0]["leads"],
      contracts: contracts.map((k) => {
        const c = Array.isArray(k.crm_clients) ? k.crm_clients[0] : k.crm_clients;
        return { id: k.id, client_id: k.client_id, retailer: k.retailer, end_date: k.end_date, status: k.status, owner_id: k.owner_id, client_owner_id: c?.owner_id ?? null, client_name: c?.name ?? null, legacy: !!k.legacy_contract_id, created_at: k.created_at };
      }),
      staffIds: (staff.data ?? []).map((s) => s.id as string),
    });
    const nameOf = new Map((profiles.data ?? []).map((p) => [p.id as string, p.name as string]));
    let tasks = 0, notifications = 0;
    for (let i = 0; i < plan.tasks.length; i += 200) {
      const rows = plan.tasks.slice(i, i + 200).map((t) => ({ ...t, assigned_name: nameOf.get(t.assigned_to) ?? null, source: "automatica", status: "pendent" }));
      const r = await sb.from("crm_tasks").upsert(rows, { onConflict: "rule_key", ignoreDuplicates: true }).select("id,assigned_to,title,opportunity_id,client_id");
      if (r.error) throw r.error;
      tasks += r.data?.length ?? 0;
      // cada tasca nova genera també un avís al responsable
      const notes = (r.data ?? []).map((t) => ({ user_id: t.assigned_to, kind: "tasca", title: `Nova tasca automàtica: ${t.title}`, link: t.opportunity_id ? { view: "oportunitat", params: { id: t.opportunity_id } } : t.client_id ? { view: "client", params: { id: t.client_id, tab: "activitat" } } : { view: "jornada", params: {} }, rule_key: `tasca:${t.id}` }));
      if (notes.length) await sb.from("crm_notifications").upsert(notes, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
    }
    for (let i = 0; i < plan.notifications.length; i += 200) {
      const r = await sb.from("crm_notifications").upsert(plan.notifications.slice(i, i + 200), { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      notifications += r.data?.length ?? 0;
    }
    // Fase 3: expedients de contractació (si la migració 010 és aplicada)
    const exp = await expedientPlan(sb, now, active, (staff.data ?? []).map((s) => s.id as string));
    for (let i = 0; i < exp.tasks.length; i += 200) {
      const rows = exp.tasks.slice(i, i + 200).map((t) => ({ ...t, assigned_name: nameOf.get(t.assigned_to) ?? null, source: "automatica", status: "pendent", created_by: null }));
      const r = await sb.from("crm_tasks").upsert(rows, { onConflict: "rule_key", ignoreDuplicates: true }).select("id,assigned_to,title,expedient_id");
      if (r.error) throw r.error;
      tasks += r.data?.length ?? 0;
      const notes = (r.data ?? []).map((t) => ({ user_id: t.assigned_to, kind: "tasca", title: `Nova tasca automàtica: ${t.title}`, link: { view: "expedient", params: { id: t.expedient_id } }, rule_key: `tasca:${t.id}` }));
      if (notes.length) await sb.from("crm_notifications").upsert(notes, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
    }
    for (let i = 0; i < exp.notifications.length; i += 200) {
      const r = await sb.from("crm_notifications").upsert(exp.notifications.slice(i, i + 200), { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      notifications += r.data?.length ?? 0;
    }
    // cada automatització d'expedient queda a l'historial (una sola vegada: rule_key únic)
    for (let i = 0; i < exp.events.length; i += 200) {
      await sb.from("crm_expedient_events").upsert(exp.events.slice(i, i + 200).map((e) => ({ ...e, type: "automatitzacio", user_id: null, user_name: "Automatització" })), { onConflict: "rule_key", ignoreDuplicates: true });
    }
    // Fase 4: alertes econòmiques (si la migració 011 és aplicada)
    const { financeAutomations } = await import("./finance");
    const fin = await financeAutomations(sb, now, active, await financeRecipients(sb, (staff.data ?? []).map((s) => s.id as string)));
    for (let i = 0; i < fin.length; i += 200) {
      const r = await sb.from("crm_notifications").upsert(fin.slice(i, i + 200), { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      notifications += r.data?.length ?? 0;
    }
    // Fase 6: avisos de captació i col·laboradors (si la migració 013 és aplicada)
    const { captureAutomations } = await import("./marketing");
    const cap = await captureAutomations(sb, now, active, (staff.data ?? []).map((s) => s.id as string));
    for (let i = 0; i < cap.length; i += 200) {
      const r = await sb.from("crm_notifications").upsert(cap.slice(i, i + 200), { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      notifications += r.data?.length ?? 0;
    }
    // Fase 8.1: venciments i infrapagaments de comercialitzadores, i avisos als caps d'equip (si 016/017 són aplicades)
    const { fase81Automations } = await import("./automations-fase81");
    const f81 = await fase81Automations(sb, now, active).catch((e) => { console.error("[automatitzacions 8.1]", e instanceof Error ? e.message : e); return []; });
    for (let i = 0; i < f81.length; i += 200) {
      const r = await sb.from("crm_notifications").upsert(f81.slice(i, i + 200), { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      notifications += r.data?.length ?? 0;
    }
    // Fase 8.2: recordatoris i reclamacions a comercialitzadores sense resposta (si la 018 és aplicada)
    const { claimsAutomations } = await import("./claims");
    const rec = await claimsAutomations(sb, now, active).catch((e) => { console.error("[automatitzacions reclamacions]", e instanceof Error ? e.message : e); return []; });
    for (let i = 0; i < rec.length; i += 200) {
      const r = await sb.from("crm_notifications").upsert(rec.slice(i, i + 200), { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      notifications += r.data?.length ?? 0;
    }
    // Fase 14: alertes de l'auditor de comissions (si la 025 és aplicada)
    const { auditAutomations } = await import("./commission-audit");
    const aud = await auditAutomations(sb, now, active, await financeRecipients(sb, (staff.data ?? []).map((s) => s.id as string))).catch((e) => { console.error("[automatitzacions auditor]", e instanceof Error ? e.message : e); return []; });
    for (let i = 0; i < aud.length; i += 200) {
      const r = await sb.from("crm_notifications").upsert(aud.slice(i, i + 200), { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      notifications += r.data?.length ?? 0;
    }
    // Fase 7: escalats (tasques vençudes, incidències urgents) i errors d'integració (si la migració 014 és aplicada)
    const { consolidationAutomations } = await import("./alerts");
    const esc = await consolidationAutomations(sb, now, active);
    for (let i = 0; i < esc.notifications.length; i += 200) {
      const r = await sb.from("crm_notifications").upsert(esc.notifications.slice(i, i + 200), { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      notifications += r.data?.length ?? 0;
    }
    for (const t of esc.taskLevels) await sb.from("crm_tasks").update({ escalation_level: t.level }).eq("id", t.id).lt("escalation_level", t.level);
    for (const x of esc.incidentLevels) await sb.from("crm_incidents").update({ escalation_level: x.level, escalated_at: now.toISOString() }).eq("id", x.id).lt("escalation_level", x.level);
    await sb.from("crm_automation_runs").update({ finished_at: new Date().toISOString(), ok: true, tasks_created: tasks, notifications_created: notifications, detail: { planned: { tasks: plan.tasks.length + exp.tasks.length, notifications: plan.notifications.length + exp.notifications.length + fin.length + cap.length + esc.notifications.length }, escalations: { tasks: esc.taskLevels.length, incidents: esc.incidentLevels.length }, finance: fin.map((f) => f.rule_key).slice(0, 200), rules: active.map((r) => r.key) } }).eq("id", run.data.id);
    return { tasks, notifications };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("crm_automation_runs").update({ finished_at: new Date().toISOString(), ok: false, error: msg.slice(0, 300) }).eq("id", run.data.id);
    console.error("[automatitzacions]", msg.slice(0, 200));
    throw e;
  }
}

/** Executa les automatitzacions si fa més de 30 minuts de l'última execució (per tenir avisos frescos sense un cron freqüent). */
export async function maybeRunAutomations() {
  const sb = adminClient();
  const { data, error } = await sb.from("crm_automation_runs").select("started_at").neq("trigger", "event").order("started_at", { ascending: false }).limit(1);
  if (error) return null;
  const last = data?.[0]?.started_at;
  if (last && Date.now() - new Date(last).getTime() < 30 * 60_000) return null;
  return runAutomations("jornada").catch(() => null);
}

async function expedientPlan(sb: ReturnType<typeof adminClient>, now: Date, active: Rule[], staffIds: string[]) {
  const empty = { tasks: [], notifications: [], events: [] } as ReturnType<typeof planExpedientAutomations>;
  if (!active.some((r) => r.key.startsWith("exp_"))) return empty;
  const since = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const ex = await sb.from("crm_expedients").select("id,code,client_id,status,owner_id,status_changed_at,last_event_at,retailer,crm_clients(name)").or(`status.in.(${OPEN_EXP_STATUSES.join(",")}),status_changed_at.gte.${since}`).limit(5000);
  if (ex.error) { if (isMissing(ex.error)) return empty; throw ex.error; }
  const ids = (ex.data ?? []).map((e) => e.id as string);
  const sigs: { id: string; expedient_id: string; status: string; sent_at: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 300) sigs.push(...(((await sb.from("crm_signature_requests").select("id,expedient_id,status,sent_at").in("expedient_id", ids.slice(i, i + 300)).in("status", ["enviada", "oberta"])).data ?? []) as typeof sigs));
  return planExpedientAutomations({
    now, rules: active, staffIds, signatures: sigs,
    expedients: (ex.data ?? []).map((e) => {
      const c = Array.isArray(e.crm_clients) ? e.crm_clients[0] : e.crm_clients;
      return { id: e.id, code: e.code, client_id: e.client_id, status: e.status, owner_id: e.owner_id, status_changed_at: e.status_changed_at, last_event_at: e.last_event_at, retailer: e.retailer, client_name: (c as { name?: string } | null)?.name ?? null };
    }),
  });
}

/**
 * Fase 7: els avisos econòmics només van a qui pot veure dades econòmiques (Direcció i persones autoritzades).
 * Sense la migració 014, es manté el comportament anterior (Direcció i Cap administrativa).
 */
async function financeRecipients(sb: ReturnType<typeof adminClient>, staffIds: string[]) {
  const [roles, users, people] = await Promise.all([
    sb.from("role_permissions").select("role,can_read,can_edit,can_approve").eq("module", "economia"),
    sb.from("user_permissions").select("user_id,can_read,can_edit,can_approve").eq("module", "economia"),
    sb.from("profiles").select("id,role").in("id", staffIds.length ? staffIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  if (roles.error || users.error) return staffIds;
  const roleOk = new Map((roles.data ?? []).map((r) => [r.role as string, !!(r.can_read || r.can_edit || r.can_approve)]));
  const userOk = new Map((users.data ?? []).map((r) => [r.user_id as string, !!(r.can_read || r.can_edit || r.can_approve)]));
  return ((people.data ?? []) as { id: string; role: string }[]).filter((p) => p.role === "admin" || (userOk.get(p.id) ?? roleOk.get(p.role) ?? false)).map((p) => p.id);
}
