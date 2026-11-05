import "server-only";
/**
 * GESTOR GLOBAL DE TASQUES I D'INCIDÈNCIES (Fase 7) · servidor.
 * Unifica les tasques de totes les fases (manuals, automàtiques, de leads, oportunitats, expedients i renovacions).
 * La RLS decideix què veu cadascú; la base de dades impedeix reassignar tasques d'altres sense permís (trigger
 * crm_task_guard) i guarda l'historial (crm_task_events). Aquí només es valida i s'avisa la persona responsable.
 */
import { z } from "zod";
import { OPEN_TASK } from "@/core/control";
import { HttpError } from "./supabase";
import { hasPerm, requirePerm } from "./permissions";
import { notify } from "./sales";
import type { U } from "./crm";

const uuid = z.string().uuid();
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "42703" || /does not exist|Could not find/i.test(e.message ?? ""));
const dbErr = (e: { code?: string; message?: string }, fallback: string): never => {
  if (e.code === "42501" || /row-level security/i.test(e.message ?? "")) throw new HttpError(403, /reassignar|escalat/i.test(e.message ?? "") ? e.message! : "No tens permís per fer aquest canvi");
  if (e.code === "23514") throw new HttpError(400, "Valor no vàlid");
  if (isMissing(e)) throw new HttpError(503, "Falta aplicar la migració 014_consolidacio.sql");
  throw new HttpError(400, fallback);
};

export const TASK_STATUS = ["pendent", "en_curs", "bloquejada", "feta", "cancellada"] as const;
export const PRIORITIES = ["baixa", "normal", "alta", "urgent"] as const;
export const AREAS = ["administrativa", "comercial", "direccio", "externa"] as const;
const KINDS = ["trucada", "reunio", "seguiment", "tramitacio", "renovacio", "altres", "documentacio", "incidencia", "comissio", "sollicitud_externa"] as const;

const taskCreate = z.object({
  title: z.string().trim().min(1, "Falta el títol").max(200),
  notes: opt(z.string().trim().max(4000)),
  due_at: opt(z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((d) => `${d}T17:00:00.000Z`))),
  priority: z.enum(PRIORITIES).default("normal"),
  area: opt(z.enum(AREAS)),
  kind: z.enum(KINDS).default("altres"),
  assigned_to: opt(uuid),
  client_id: opt(uuid), contract_id: opt(uuid), expedient_id: opt(uuid), lead_id: opt(uuid), opportunity_id: opt(uuid), incident_id: opt(uuid), settlement_id: opt(uuid),
  partner_visible: z.boolean().default(false),
});
const taskPatch = z.object({
  status: z.enum(TASK_STATUS).optional(), priority: z.enum(PRIORITIES).optional(), area: opt(z.enum(AREAS)),
  title: z.string().trim().min(1).max(200).optional(), notes: opt(z.string().trim().max(4000)),
  due_at: opt(z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((d) => `${d}T17:00:00.000Z`))),
  assigned_to: opt(uuid), blocked_reason: opt(z.string().trim().max(500)),
});

const SELECT = "id,title,notes,status,priority,area,kind,due_at,assigned_to,assigned_name,created_by,created_at,updated_at,completed_at,started_at,blocked_reason,escalation_level,partner_visible,source,client_id,contract_id,expedient_id,lead_id,opportunity_id,incident_id,crm_clients(name),crm_expedients(code),crm_leads(name),crm_opportunities(title)";

export async function listTasks(u: U, raw: Record<string, string>) {
  await requirePerm(u, "tasques");
  const q = z.object({
    scope: z.enum(["meves", "creades", "equip", "totes", "externes"]).default("meves"),
    status: z.enum(["obertes", "vencudes", "bloquejades", "fetes", "totes", ...TASK_STATUS]).default("obertes"),
    priority: z.enum(PRIORITIES).optional(), area: z.enum(AREAS).optional(), assignee: uuid.optional(),
    q: z.string().max(80).optional(), page: z.coerce.number().int().min(0).max(500).default(0),
  }).parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const supervise = u.profile.role === "admin" || (await hasPerm(u, "tasques", "approve"));
  if ((q.scope === "equip" || q.scope === "totes") && !supervise) throw new HttpError(403, "Només Direcció i la Cap administrativa supervisen les tasques de l'equip");
  let s = u.sb.from("crm_tasks").select(SELECT, { count: "exact" });
  if (q.scope === "meves") s = s.eq("assigned_to", u.user.id);
  if (q.scope === "creades") s = s.eq("created_by", u.user.id);
  if (q.scope === "externes") s = s.eq("partner_visible", true);
  // la Cap administrativa supervisa l'àrea administrativa; Direcció ho veu tot
  if (q.scope === "equip" && u.profile.role !== "admin") s = s.or("area.eq.administrativa,area.is.null");
  const now = new Date().toISOString();
  if (q.status === "obertes") s = s.in("status", [...OPEN_TASK]);
  else if (q.status === "vencudes") s = s.in("status", [...OPEN_TASK]).lt("due_at", now);
  else if (q.status === "bloquejades") s = s.eq("status", "bloquejada");
  else if (q.status === "fetes") s = s.eq("status", "feta");
  else if (q.status !== "totes") s = s.eq("status", q.status);
  if (q.priority) s = s.eq("priority", q.priority);
  if (q.area) s = s.eq("area", q.area);
  if (q.assignee) s = s.eq("assigned_to", q.assignee);
  if (q.q) s = s.ilike("title", `%${q.q.replace(/[%_,()]/g, " ")}%`);
  const size = 50;
  const { data, error, count } = await s.order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).range(q.page * size, q.page * size + size - 1);
  if (error) dbErr(error, "No s'han pogut llegir les tasques");
  const people = supervise ? ((await u.sb.from("profiles").select("id,name,role").in("role", ["admin", "cap_administrativa", "cap_equip", "administrativa", "comercial"])).data ?? []) : [];
  return { tasks: data ?? [], total: count ?? 0, page: q.page, pageSize: size, canSupervise: supervise, canAssign: supervise, people };
}

export async function getTask(u: U, id: string) {
  await requirePerm(u, "tasques");
  const [t, ev] = await Promise.all([
    u.sb.from("crm_tasks").select(SELECT).eq("id", uuid.parse(id)).maybeSingle(),
    u.sb.from("crm_task_events").select("id,at,user_name,type,from_value,to_value,note").eq("task_id", id).order("at"),
  ]);
  if (t.error) dbErr(t.error, "No s'ha pogut llegir la tasca");
  if (!t.data) throw new HttpError(404, "Tasca no trobada o sense permís");
  return { task: t.data, events: ev.data ?? [] };
}

async function nameOf(u: U, id: string | null | undefined) {
  if (!id) return null;
  const { data } = await u.sb.from("profiles").select("name").eq("id", id).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

export async function createTask(u: U, raw: unknown) {
  await requirePerm(u, "tasques", "edit");
  const t = taskCreate.parse(raw);
  const supervise = u.profile.role === "admin" || (await hasPerm(u, "tasques", "approve"));
  const assignee = t.assigned_to ?? u.user.id;
  if (assignee !== u.user.id && !supervise && !t.client_id && !t.lead_id) throw new HttpError(403, "Només Direcció i la Cap administrativa assignen tasques a altres persones");
  if (t.partner_visible && !["admin", "cap_administrativa", "administrativa"].includes(u.profile.role)) throw new HttpError(403, "Només l'equip intern crea sol·licituds externes");
  if (t.settlement_id && !(await hasPerm(u, "economia"))) throw new HttpError(403, "Vincular una liquidació requereix accés a les dades econòmiques");
  const row = { ...t, assigned_to: assignee, assigned_name: await nameOf(u, assignee), created_by: u.user.id, source: "manual", status: "pendent", area: t.area ?? (t.partner_visible ? "externa" : null), kind: t.partner_visible ? "sollicitud_externa" : t.kind };
  const { data, error } = await u.sb.from("crm_tasks").insert(row).select("id").single();
  if (error) dbErr(error, "No s'ha pogut crear la tasca");
  if (assignee !== u.user.id) await notify(assignee, { kind: "tasca", title: `Nova tasca assignada: ${t.title}`, body: `Assignada per ${u.profile.name}${t.due_at ? ` · venç el ${t.due_at.slice(0, 10)}` : ""}`, link: { view: "tasques", params: { id: data!.id } }, ruleKey: `tasca_assignada:${data!.id}:${assignee}` });
  return { id: data!.id as string };
}

export async function updateTask(u: U, id: string, raw: unknown) {
  await requirePerm(u, "tasques", "edit");
  const p = taskPatch.parse(raw);
  if (p.status === "bloquejada" && !p.blocked_reason) throw new HttpError(400, "Indica per què està bloquejada");
  const patch: Record<string, unknown> = { ...p };
  if (p.assigned_to !== undefined) patch.assigned_name = await nameOf(u, p.assigned_to);
  if (p.status === "feta") patch.completed_at = new Date().toISOString();
  if (p.status && ["pendent", "en_curs", "bloquejada"].includes(p.status)) patch.completed_at = null;
  const { data, error } = await u.sb.from("crm_tasks").update(patch).eq("id", uuid.parse(id)).select("id,title,assigned_to").maybeSingle();
  if (error) dbErr(error, "No s'ha pogut desar la tasca");
  if (!data) throw new HttpError(403, "No tens permís per modificar aquesta tasca");
  if (p.assigned_to && p.assigned_to !== u.user.id) await notify(p.assigned_to, { kind: "tasca", title: `T'han assignat una tasca: ${data.title}`, body: `Per ${u.profile.name}`, link: { view: "tasques", params: { id } }, ruleKey: `tasca_assignada:${id}:${p.assigned_to}:${Date.now()}` });
  return { ok: true };
}

export async function commentTask(u: U, id: string, note: string) {
  await requirePerm(u, "tasques");
  const n = z.string().trim().min(1).max(2000).parse(note);
  const { error } = await u.sb.from("crm_task_events").insert({ task_id: uuid.parse(id), user_id: u.user.id, user_name: u.profile.name, type: "comentari", note: n });
  if (error) dbErr(error, "No s'ha pogut afegir el comentari");
  return { ok: true };
}

/** Assignació massiva (Direcció / Cap administrativa). */
export async function bulkAssign(u: U, ids: string[], assignee: string) {
  if (!(u.profile.role === "admin" || (await hasPerm(u, "tasques", "approve")))) throw new HttpError(403, "Només Direcció i la Cap administrativa reassignen tasques");
  const list = z.array(uuid).min(1).max(200).parse(ids);
  const name = await nameOf(u, uuid.parse(assignee));
  const { data, error } = await u.sb.from("crm_tasks").update({ assigned_to: assignee, assigned_name: name }).in("id", list).select("id");
  if (error) dbErr(error, "No s'han pogut reassignar");
  if (data?.length) await notify(assignee, { kind: "tasca", title: `T'han assignat ${data.length} tasques`, body: `Per ${u.profile.name}`, link: { view: "tasques", params: {} }, ruleKey: `tasques_massiu:${assignee}:${Date.now()}` });
  return { updated: data?.length ?? 0 };
}

/* ======================================================================= incidències */

const INC_STATUS = ["oberta", "en_curs", "esperant_tercers", "resolta", "tancada"] as const;
const INC_PRIORITY = ["baixa", "mitjana", "alta", "urgent"] as const;
const INC_SELECT = "id,title,description,kind,category,status,priority,external_ref,assigned_to,assigned_name,opened_at,closed_at,due_at,escalation_level,escalated_at,resolution,client_id,contract_id,expedient_id,supply_id,created_by,crm_clients(name),crm_expedients(code)";

export async function listIncidents(u: U, raw: Record<string, string>) {
  await requirePerm(u, "incidencies");
  const q = z.object({ status: z.enum(["obertes", "totes", ...INC_STATUS]).default("obertes"), priority: z.enum(INC_PRIORITY).optional(), mine: z.enum(["1"]).optional(), q: z.string().max(80).optional(), page: z.coerce.number().int().min(0).max(500).default(0) })
    .parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  let s = u.sb.from("crm_incidents").select(INC_SELECT, { count: "exact" });
  if (q.status === "obertes") s = s.not("status", "in", "(resolta,tancada)");
  else if (q.status !== "totes") s = s.eq("status", q.status);
  if (q.priority) s = s.eq("priority", q.priority);
  if (q.mine) s = s.eq("assigned_to", u.user.id);
  if (q.q) s = s.ilike("title", `%${q.q.replace(/[%_,()]/g, " ")}%`);
  const size = 50;
  const { data, error, count } = await s.order("opened_at", { ascending: false }).range(q.page * size, q.page * size + size - 1);
  if (error) dbErr(error, "No s'han pogut llegir les incidències");
  const canManage = await hasPerm(u, "incidencies", "approve");
  const people = canManage ? ((await u.sb.from("profiles").select("id,name,role").in("role", ["admin", "cap_administrativa", "cap_equip", "administrativa", "comercial"])).data ?? []) : [];
  return { incidents: data ?? [], total: count ?? 0, page: q.page, pageSize: size, canEscalate: canManage, people };
}

export async function getIncident(u: U, id: string) {
  await requirePerm(u, "incidencies");
  const [i, ev, tasks] = await Promise.all([
    u.sb.from("crm_incidents").select(INC_SELECT).eq("id", uuid.parse(id)).maybeSingle(),
    u.sb.from("crm_incident_events").select("id,at,user_name,type,from_value,to_value,note").eq("incident_id", id).order("at"),
    u.sb.from("crm_tasks").select("id,title,status,assigned_name,due_at").eq("incident_id", id),
  ]);
  if (i.error) dbErr(i.error, "No s'ha pogut llegir la incidència");
  if (!i.data) throw new HttpError(404, "Incidència no trobada o sense permís");
  return { incident: i.data, events: ev.data ?? [], tasks: tasks.data ?? [] };
}

export async function createIncident(u: U, raw: unknown) {
  await requirePerm(u, "incidencies", "edit");
  const b = z.object({ client_id: uuid, title: z.string().trim().min(1).max(200), description: opt(z.string().trim().max(4000)), kind: z.enum(["incidencia", "reclamacio", "consulta"]).default("incidencia"), category: opt(z.string().max(60)), priority: z.enum(INC_PRIORITY).default("mitjana"), assigned_to: opt(uuid), due_at: opt(z.string().datetime({ offset: true })), contract_id: opt(uuid), expedient_id: opt(uuid), external_ref: opt(z.string().max(80)) }).parse(raw);
  const { data, error } = await u.sb.from("crm_incidents").insert({ ...b, assigned_name: await nameOf(u, b.assigned_to), created_by: u.user.id }).select("id").single();
  if (error) dbErr(error, "No s'ha pogut crear la incidència");
  if (b.assigned_to && b.assigned_to !== u.user.id) await notify(b.assigned_to, { kind: "incidencia", title: `Incidència assignada: ${b.title}`, body: `Prioritat ${b.priority}`, link: { view: "incidencies", params: { id: data!.id } }, ruleKey: `inc_assignada:${data!.id}:${b.assigned_to}` });
  return { id: data!.id as string };
}

export async function updateIncident(u: U, id: string, raw: unknown) {
  await requirePerm(u, "incidencies", "edit");
  const p = z.object({ status: z.enum(INC_STATUS).optional(), priority: z.enum(INC_PRIORITY).optional(), assigned_to: opt(uuid), due_at: opt(z.string().datetime({ offset: true })), resolution: opt(z.string().trim().max(2000)), external_ref: opt(z.string().max(80)), escalate: z.boolean().optional() }).parse(raw);
  if ((p.status === "resolta" || p.status === "tancada") && !p.resolution) throw new HttpError(400, "Explica com s'ha resolt");
  if (p.status === "tancada" && !(await hasPerm(u, "incidencies", "approve"))) throw new HttpError(403, "Només la Cap administrativa o Direcció tanquen incidències");
  const { escalate, ...rest } = p;
  const patch: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (p.assigned_to !== undefined) patch.assigned_name = await nameOf(u, p.assigned_to);
  if (p.status) patch.closed_at = ["resolta", "tancada"].includes(p.status) ? new Date().toISOString() : null;
  if (escalate) {
    // qualsevol persona que gestiona la incidència pot demanar ajuda: nivell 1 → Cap administrativa, nivell 2 → Direcció
    const cur = await u.sb.from("crm_incidents").select("escalation_level,title").eq("id", id).maybeSingle();
    const level = Math.min(2, Number(cur.data?.escalation_level ?? 0) + 1);
    patch.escalation_level = level; patch.escalated_at = new Date().toISOString();
    const role = level === 1 ? "cap_administrativa" : "admin";
    const { data: to } = await u.sb.from("profiles").select("id").eq("role", role);
    for (const r of to ?? []) await notify(r.id as string, { kind: "escalat", title: `Incidència escalada${level === 2 ? " a Direcció" : ""}: ${cur.data?.title ?? ""}`, body: `Per ${u.profile.name}`, link: { view: "incidencies", params: { id } }, ruleKey: `inc_escalada:${id}:${level}:${r.id}` });
  }
  const { data, error } = await u.sb.from("crm_incidents").update(patch).eq("id", uuid.parse(id)).select("id").maybeSingle();
  if (error) dbErr(error, "No s'ha pogut desar la incidència");
  if (!data) throw new HttpError(403, "No tens permís per modificar aquesta incidència");
  return { ok: true };
}

export async function commentIncident(u: U, id: string, note: string) {
  await requirePerm(u, "incidencies");
  const { error } = await u.sb.from("crm_incident_events").insert({ incident_id: uuid.parse(id), user_id: u.user.id, user_name: u.profile.name, type: "comentari", note: z.string().trim().min(1).max(2000).parse(note) });
  if (error) dbErr(error, "No s'ha pogut afegir el comentari");
  return { ok: true };
}
