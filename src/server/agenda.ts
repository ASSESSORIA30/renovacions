import "server-only";
/**
 * AGENDA (Fase 10) · servidor.
 *  - La RLS de la 020 decideix què veu i què pot modificar cadascú; aquí es valida, s'avisa i es calcula.
 *  - Les tasques NO es dupliquen: es llegeixen de crm_tasks (gestor de tasques) i s'hi actuen amb /api/work.
 *  - La disponibilitat de l'equip es calcula amb la service role però NOMÉS retorna ocupat/lliure de les cites
 *    personals que l'usuari no pot veure (sense títol ni detalls).
 */
import { z } from "zod";
import {
  EVENT_KINDS, PRIORITIES, STATUSES, TZ, dueReminders, expandEvent, findConflicts, reminderText, suggestSlots,
  type AgendaEventRow, type Busy, type EventKind, type Recurrence,
} from "@/core/agenda";
import { hasPerm } from "./permissions";
import { notify } from "./sales";
import { adminClient, HttpError } from "./supabase";
import type { U } from "./crm";

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42883" || /does not exist|Could not find/i.test(e.message ?? ""));
const need020 = () => new HttpError(503, "Falta aplicar la migració 020_agenda.sql a Supabase");
function fail(e: { code?: string; message?: string }, msg = "Error de l'agenda"): never {
  if (isMissing(e)) throw need020();
  if (e.code === "42501" || /row-level security/i.test(e.message ?? "")) throw new HttpError(403, "No tens permís per fer aquest canvi a l'agenda");
  if (e.code === "23514") throw new HttpError(400, "Dades no vàlides (comprova les dates i els camps)");
  throw new HttpError(500, msg);
}
const ASSIGNERS = ["admin", "cap_administrativa", "cap_equip"];
const internal = (u: U) => { if (u.profile.role === "colaborador") throw new HttpError(403, "L'agenda és de l'equip intern"); };

const EVENT_COLS = "id,owner_id,created_by,created_by_name,updated_by_name,title,description,kind,scope,starts_at,ends_at,all_day,timezone,location,priority,status,client_id,contract_id,renewal_id,incident_id,task_id,recurrence,exdates,recurrence_parent_id,recurrence_original_start,reminders,channels,external_source,external_id,version,created_at,updated_at,agenda_participants(user_id,user_name,response),crm_clients(id,name)";
type Row = AgendaEventRow & {
  created_by: string; created_by_name: string | null; updated_by_name: string | null; description: string | null; location: string | null; timezone: string;
  client_id: string | null; contract_id: string | null; renewal_id: string | null; incident_id: string | null; task_id: string | null;
  recurrence_parent_id: string | null; channels: string[]; external_source: string | null; external_id: string | null; version: number; updated_at: string;
  agenda_participants: { user_id: string; user_name: string | null; response: string }[] | null;
  crm_clients: { id: string; name: string } | { id: string; name: string }[] | null;
};
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] ?? null : x ?? null);

async function people(u: U) {
  const { data } = await u.sb.from("profiles").select("id,name,role").neq("role", "colaborador").order("name");
  return (data ?? []) as { id: string; name: string; role: string }[];
}
async function canEditRow(u: U, r: Row) {
  return r.owner_id === u.user.id || r.created_by === u.user.id || (r.scope === "compartida" && (await hasPerm(u, "agenda", "approve")));
}

/* ======================================================================= llista per a les vistes */

const rangeQ = z.object({
  from: iso, to: iso,
  view: z.enum(["personal", "compartida", "combinada"]).default("combinada"),
  users: z.string().max(4000).optional(),         // ids separats per comes
  kinds: z.string().max(400).optional(),
  tasks: z.enum(["0", "1"]).default("1"),
});
export type AgendaItem = {
  id: string; occurrenceId: string; source: "event" | "task"; title: string; kind: EventKind; scope: "personal" | "compartida";
  start: string; end: string; allDay: boolean; status: string; priority: string; ownerId: string | null; ownerName: string | null;
  participants: { userId: string; name: string | null; response: string }[]; client: { id: string; name: string } | null;
  contractId: string | null; renewalId: string | null; incidentId: string | null; taskId: string | null;
  recurring: boolean; recurrence: Recurrence | null; reminders: number[]; location: string | null; description: string | null;
  canEdit: boolean; external: string | null; createdByName: string | null; version: number | null;
};

export async function listAgenda(u: U, raw: Record<string, string>) {
  internal(u);
  const q0 = rangeQ.parse(raw);
  const from = new Date(q0.from), to = new Date(q0.to);
  const q = { ...q0, from: from.toISOString(), to: to.toISOString() }; // ISO en UTC per als filtres de PostgREST
  if (to.getTime() - from.getTime() > 100 * 86400000 || to <= from) throw new HttpError(400, "Rang de dates no vàlid (màxim 100 dies)");
  const users = (q.users ?? "").split(",").map((x) => x.trim()).filter((x) => uuid.safeParse(x).success);
  const kinds = (q.kinds ?? "").split(",").filter((k) => (EVENT_KINDS as readonly string[]).includes(k)) as EventKind[];
  const me = u.user.id;
  const [evs, staff, ppl] = await Promise.all([
    u.sb.from("agenda_events").select(EVENT_COLS).lt("starts_at", q.to).or(`ends_at.gte.${q.from},recurrence.not.is.null`).order("starts_at").limit(3000),
    hasPerm(u, "agenda", "approve"),
    people(u),
  ]);
  if (evs.error) fail(evs.error);
  const names = new Map(ppl.map((p) => [p.id, p.name]));
  const rows = (evs.data ?? []) as unknown as Row[];
  const mine = (r: Row) => r.owner_id === me || (r.agenda_participants ?? []).some((p) => p.user_id === me);
  const items: AgendaItem[] = [];
  for (const r of rows) {
    if (q.view === "personal" && !mine(r)) continue;
    if (q.view === "compartida" && r.scope !== "compartida") continue;
    if (users.length && !users.includes(r.owner_id) && !(r.agenda_participants ?? []).some((p) => users.includes(p.user_id))) continue;
    if (kinds.length && !kinds.includes(r.kind)) continue;
    const canEdit = r.owner_id === me || r.created_by === me || (r.scope === "compartida" && staff);
    for (const o of expandEvent(r, from, to)) {
      items.push({
        id: r.id, occurrenceId: o.occurrenceId, source: "event", title: r.title, kind: r.kind, scope: r.scope, start: o.start, end: o.end, allDay: r.all_day,
        status: r.status, priority: r.priority, ownerId: r.owner_id, ownerName: names.get(r.owner_id) ?? null,
        participants: (r.agenda_participants ?? []).map((p) => ({ userId: p.user_id, name: p.user_name ?? names.get(p.user_id) ?? null, response: p.response })),
        client: one(r.crm_clients), contractId: r.contract_id, renewalId: r.renewal_id, incidentId: r.incident_id, taskId: r.task_id,
        recurring: o.recurring, recurrence: r.recurrence, reminders: r.reminders ?? [], location: r.location, description: r.description,
        canEdit, external: r.external_source, createdByName: r.created_by_name, version: r.version,
      });
    }
  }
  // tasques del gestor de tasques (mateixa taula; sense duplicar)
  if (q.tasks === "1" && (!kinds.length || kinds.includes("tasca"))) {
    let t = u.sb.from("crm_tasks").select("id,title,notes,due_at,status,priority,kind,assigned_to,assigned_name,client_id,contract_id,incident_id,duration_min,crm_clients(id,name)").gte("due_at", q.from).lt("due_at", q.to).neq("status", "cancellada").limit(2000);
    if (q.view === "personal") t = t.eq("assigned_to", me);
    if (users.length) t = t.in("assigned_to", users);
    const tr = await t;
    if (!tr.error) {
      for (const x of (tr.data ?? []) as unknown as { id: string; title: string; notes: string | null; due_at: string; status: string; priority: string | null; assigned_to: string | null; assigned_name: string | null; client_id: string | null; contract_id: string | null; incident_id: string | null; duration_min: number | null; crm_clients: { id: string; name: string } | { id: string; name: string }[] | null }[]) {
        const end = new Date(new Date(x.due_at).getTime() + Math.max(15, x.duration_min ?? 30) * 60000).toISOString();
        items.push({
          id: x.id, occurrenceId: `task:${x.id}`, source: "task", title: x.title, kind: "tasca", scope: x.assigned_to === me ? "personal" : "compartida",
          start: x.due_at, end, allDay: false, status: x.status, priority: x.priority ?? "normal", ownerId: x.assigned_to, ownerName: x.assigned_name ?? (x.assigned_to ? names.get(x.assigned_to) ?? null : null),
          participants: [], client: one(x.crm_clients), contractId: x.contract_id, renewalId: null, incidentId: x.incident_id, taskId: x.id,
          recurring: false, recurrence: null, reminders: [], location: null, description: x.notes, canEdit: x.assigned_to === me || staff, external: null, createdByName: null, version: null,
        });
      }
    }
  }
  items.sort((a, b) => a.start.localeCompare(b.start));
  return { items, people: ppl, me, canAssign: ASSIGNERS.includes(u.profile.role), tz: TZ };
}

/* ======================================================================= desar, eliminar, respondre */

const recurrenceZ = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]), interval: z.number().int().min(1).max(52).optional(),
  byweekday: z.array(z.number().int().min(1).max(7)).max(7).optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), count: z.number().int().min(1).max(500).nullable().optional(),
}).nullable().optional();
const saveZ = z.object({
  id: uuid.optional(), version: z.number().int().optional(),
  mode: z.enum(["all", "this"]).default("all"), occurrenceStart: iso.optional(),
  title: z.string().trim().min(1).max(200), description: z.string().trim().max(5000).nullable().optional(),
  kind: z.enum(EVENT_KINDS).default("cita"), scope: z.enum(["personal", "compartida"]).default("personal"),
  starts_at: iso, ends_at: iso, all_day: z.boolean().default(false), location: z.string().trim().max(300).nullable().optional(),
  priority: z.enum(PRIORITIES).default("normal"), status: z.enum(STATUSES).default("programada"),
  owner_id: uuid.optional(), participants: z.array(uuid).max(30).default([]),
  client_id: uuid.nullable().optional(), contract_id: uuid.nullable().optional(), renewal_id: z.string().trim().max(200).nullable().optional(),
  incident_id: uuid.nullable().optional(), task_id: uuid.nullable().optional(),
  recurrence: recurrenceZ, reminders: z.array(z.number().int().min(0).max(10080)).max(5).default([15]),
  channels: z.array(z.enum(["crm", "email", "whatsapp"])).max(3).default(["crm"]),
  force: z.boolean().default(false),
});

export async function saveEvent(u: U, raw: unknown) {
  internal(u);
  const b = saveZ.parse(raw);
  if (new Date(b.ends_at) < new Date(b.starts_at)) throw new HttpError(400, "L'hora de final no pot ser anterior a la d'inici");
  if (!(await hasPerm(u, "agenda", "edit"))) throw new HttpError(403, "No tens permís per crear cites");
  const owner = b.owner_id ?? u.user.id;
  if (owner !== u.user.id && !ASSIGNERS.includes(u.profile.role)) throw new HttpError(403, "Només Direcció, la Cap administrativa o el Cap d'equip poden posar cites a l'agenda d'una altra persona. Pots afegir-la com a participant.");
  // correu i WhatsApp només quan hi hagi una integració real configurada: de moment només l'avís del CRM
  const channels = ["crm"];
  const participants = [...new Set(b.participants.filter((p) => p !== owner))];

  // coincidències horàries (no s'avisa de les absències ni de les cites cancel·lades)
  if (!b.force && b.status !== "cancellada" && b.kind !== "recordatori") {
    const busy = await busyFor([owner, ...participants], b.starts_at, b.ends_at, u);
    const conflicts = findConflicts({ start: b.starts_at, end: b.ends_at }, [owner, ...participants], busy, b.id ?? null);
    if (conflicts.length) {
      const ppl = new Map((await people(u)).map((p) => [p.id, p.name]));
      return { needsConfirm: true as const, conflicts: conflicts.map((c) => ({ userId: c.userId, name: ppl.get(c.userId) ?? "Algú", start: c.start, end: c.end, title: c.private ? null : c.title ?? null, kind: c.private ? null : c.kind ?? null })) };
    }
  }

  const row = {
    owner_id: owner, title: b.title, description: b.description ?? null, kind: b.kind, scope: b.scope, starts_at: b.starts_at, ends_at: b.ends_at, all_day: b.all_day,
    location: b.location ?? null, priority: b.priority, status: b.status, client_id: b.client_id ?? null, contract_id: b.contract_id ?? null, renewal_id: b.renewal_id ?? null,
    incident_id: b.incident_id ?? null, task_id: b.task_id ?? null, recurrence: b.recurrence ?? null, reminders: [...new Set(b.reminders)].sort((x, y) => x - y), channels,
    updated_by_name: u.profile.name,
  };
  let id = b.id;
  if (b.id && b.mode === "this" && b.occurrenceStart) {
    // edició d'UNA ocurrència d'una sèrie: s'exclou de la sèrie i es crea com a cita pròpia
    const m = await u.sb.from("agenda_events").select("id,exdates,recurrence").eq("id", b.id).maybeSingle();
    if (m.error) fail(m.error);
    if (!m.data) throw new HttpError(404, "Cita no trobada o sense accés");
    const ex = [...new Set([...((m.data.exdates as string[] | null) ?? []), new Date(b.occurrenceStart).toISOString()])];
    const up = await u.sb.from("agenda_events").update({ exdates: ex, updated_by_name: u.profile.name }).eq("id", b.id).select("id");
    if (up.error) fail(up.error);
    if (!up.data?.length) throw new HttpError(403, "No pots modificar aquesta cita");
    const ins = await u.sb.from("agenda_events").insert({ ...row, recurrence: null, recurrence_parent_id: b.id, recurrence_original_start: b.occurrenceStart, created_by: u.user.id, created_by_name: u.profile.name }).select("id").single();
    if (ins.error) fail(ins.error, "No s'ha pogut desar la cita");
    id = ins.data.id as string;
  } else if (b.id) {
    let q = u.sb.from("agenda_events").update(row).eq("id", b.id);
    if (b.version) q = q.eq("version", b.version);
    const up = await q.select("id,version");
    if (up.error) fail(up.error, "No s'ha pogut desar la cita");
    if (!up.data?.length) {
      const cur = await u.sb.from("agenda_events").select("version,updated_by_name").eq("id", b.id).maybeSingle();
      if (cur.data && b.version && cur.data.version !== b.version) throw new HttpError(409, `${cur.data.updated_by_name ?? "Una altra persona"} ha modificat aquesta cita mentrestant. Torna-la a obrir per veure els canvis.`);
      throw new HttpError(403, "No pots modificar aquesta cita");
    }
  } else {
    const ins = await u.sb.from("agenda_events").insert({ ...row, created_by: u.user.id, created_by_name: u.profile.name }).select("id").single();
    if (ins.error) fail(ins.error, "No s'ha pogut crear la cita");
    id = ins.data.id as string;
  }

  // participants: es conserven les respostes dels que ja hi eren
  const cur = await u.sb.from("agenda_participants").select("user_id").eq("event_id", id!);
  const had = new Set(((cur.data ?? []) as { user_id: string }[]).map((x) => x.user_id));
  const add = participants.filter((p) => !had.has(p));
  const del = [...had].filter((p) => !participants.includes(p));
  const ppl = new Map((await people(u)).map((p) => [p.id, p.name]));
  if (add.length) {
    const r = await u.sb.from("agenda_participants").insert(add.map((p) => ({ event_id: id, user_id: p, user_name: ppl.get(p) ?? null })));
    if (r.error) fail(r.error, "No s'han pogut afegir els participants");
  }
  if (del.length) await u.sb.from("agenda_participants").delete().eq("event_id", id!).in("user_id", del);

  // avisos: a qui s'ha convidat i a qui li han posat la cita a l'agenda
  const when = new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(b.starts_at));
  const link = { view: "agenda", params: { date: b.starts_at.slice(0, 10), event: id! } };
  for (const p of add) await notify(p, { kind: "agenda", title: `${u.profile.name} t'ha convidat: ${b.title}`, body: when, link, ruleKey: `agenda_inv:${id}:${p}` });
  if (owner !== u.user.id && !b.id) await notify(owner, { kind: "agenda", title: `${u.profile.name} t'ha assignat: ${b.title}`, body: when, link, ruleKey: `agenda_asg:${id}:${owner}` });
  return { id: id!, ok: true };
}

export async function deleteEvent(u: U, raw: unknown) {
  internal(u);
  const b = z.object({ id: uuid, mode: z.enum(["all", "this"]).default("all"), occurrenceStart: iso.optional() }).parse(raw);
  const m = await u.sb.from("agenda_events").select("id,exdates,recurrence,owner_id,created_by,scope").eq("id", b.id).maybeSingle();
  if (m.error) fail(m.error);
  if (!m.data) throw new HttpError(404, "Cita no trobada o sense accés");
  if (!(await canEditRow(u, m.data as unknown as Row))) throw new HttpError(403, "Només el responsable o qui l'ha creada poden eliminar aquesta cita");
  if (b.mode === "this" && m.data.recurrence && b.occurrenceStart) {
    const ex = [...new Set([...((m.data.exdates as string[] | null) ?? []), new Date(b.occurrenceStart).toISOString()])];
    const up = await u.sb.from("agenda_events").update({ exdates: ex, updated_by_name: u.profile.name }).eq("id", b.id).select("id");
    if (up.error) fail(up.error);
    return { ok: true, scope: "this" };
  }
  // abans d'esborrar: es treuen les còpies dels calendaris externs connectats (Google/Outlook)
  try { const { removeRemoteCopies } = await import("./calendar"); await removeRemoteCopies(b.id); } catch { /* no bloqueja */ }
  const del = await u.sb.from("agenda_events").delete().eq("id", b.id).select("id");
  if (del.error) fail(del.error);
  if (!del.data?.length) throw new HttpError(403, "No pots eliminar aquesta cita");
  return { ok: true, scope: "all" };
}

export async function respond(u: U, raw: unknown) {
  internal(u);
  const b = z.object({ id: uuid, response: z.enum(["accepta", "rebutja", "pendent"]) }).parse(raw);
  const r = await u.sb.from("agenda_participants").update({ response: b.response }).eq("event_id", b.id).eq("user_id", u.user.id).select("event_id");
  if (r.error) fail(r.error);
  if (!r.data?.length) throw new HttpError(404, "No ets participant d'aquesta cita");
  return { ok: true };
}

export async function setEventStatus(u: U, raw: unknown) {
  internal(u);
  const b = z.object({ id: uuid, status: z.enum(STATUSES) }).parse(raw);
  const r = await u.sb.from("agenda_events").update({ status: b.status, updated_by_name: u.profile.name }).eq("id", b.id).select("id");
  if (r.error) fail(r.error);
  if (!r.data?.length) throw new HttpError(403, "No pots modificar aquesta cita");
  return { ok: true };
}

/* ======================================================================= disponibilitat */

/**
 * Ocupació d'unes persones en un rang. Les cites que l'usuari no pot veure surten com a «Ocupat» (private=true),
 * sense títol. Inclou les tasques amb hora (crm_tasks.due_at + duration_min) com a ocupació.
 */
export async function busyFor(userIds: string[], fromIso: string, toIso: string, u: U): Promise<Busy[]> {
  const ids = [...new Set(userIds)].filter((x) => uuid.safeParse(x).success).slice(0, 40);
  if (!ids.length) return [];
  const sb = adminClient();
  const from = new Date(new Date(fromIso).getTime() - 86400000).toISOString();
  const [own, part] = await Promise.all([
    sb.from("agenda_events").select("id,owner_id,created_by,title,kind,scope,starts_at,ends_at,all_day,status,priority,recurrence,exdates,reminders").in("owner_id", ids).lt("starts_at", toIso).or(`ends_at.gte.${from},recurrence.not.is.null`).neq("status", "cancellada"),
    sb.from("agenda_participants").select("user_id,response,agenda_events!inner(id,owner_id,created_by,title,kind,scope,starts_at,ends_at,all_day,status,priority,recurrence,exdates,reminders)").in("user_id", ids).neq("response", "rebutja"),
  ]);
  if (own.error) fail(own.error);
  const meVisible = new Set<string>();
  // cites que l'usuari pot veure en detall (RLS): les seves, les compartides, o on participa
  const vis = await u.sb.from("agenda_events").select("id").lt("starts_at", toIso).or(`ends_at.gte.${from},recurrence.not.is.null`).limit(5000);
  for (const v of (vis.data ?? []) as { id: string }[]) meVisible.add(v.id);
  const out: Busy[] = [];
  const add = (userId: string, e: AgendaEventRow & { created_by: string }) => {
    if (e.status === "cancellada") return;
    for (const o of expandEvent(e, new Date(fromIso), new Date(toIso))) {
      const priv = !meVisible.has(e.id);
      out.push({ userId, start: o.start, end: o.end, eventId: o.occurrenceId, title: priv ? null : e.title, kind: priv ? undefined : e.kind, private: priv });
    }
  };
  for (const e of (own.data ?? []) as unknown as (AgendaEventRow & { created_by: string })[]) add(e.owner_id, e);
  for (const p of (part.data ?? []) as unknown as { user_id: string; agenda_events: AgendaEventRow & { created_by: string } }[]) if (p.agenda_events) add(p.user_id, one(p.agenda_events)!);
  const tasks = await sb.from("crm_tasks").select("id,title,assigned_to,due_at,duration_min,status").in("assigned_to", ids).gte("due_at", from).lt("due_at", toIso).in("status", ["pendent", "en_curs"]);
  for (const t of (tasks.data ?? []) as { id: string; title: string; assigned_to: string; due_at: string; duration_min: number | null }[]) {
    if (!t.duration_min) continue; // les tasques sense durada no bloquegen l'agenda
    out.push({ userId: t.assigned_to, start: t.due_at, end: new Date(new Date(t.due_at).getTime() + t.duration_min * 60000).toISOString(), eventId: `task:${t.id}`, title: null, kind: "tasca", private: true });
  }
  return out;
}

/** Persones de les quals coneixem l'agenda (tenen cites als darrers/propers 60 dies o un calendari connectat). */
async function knownUsers(ids: string[]) {
  const sb = adminClient();
  const a = new Date(Date.now() - 60 * 86400000).toISOString(), b = new Date(Date.now() + 60 * 86400000).toISOString();
  const [e, c] = await Promise.all([
    sb.from("agenda_events").select("owner_id").in("owner_id", ids).gte("starts_at", a).lte("starts_at", b).limit(2000),
    sb.from("calendar_connections").select("user_id").in("user_id", ids).eq("status", "connectat"),
  ]);
  return new Set([...((e.data ?? []) as { owner_id: string }[]).map((x) => x.owner_id), ...((c.data ?? []) as { user_id: string }[]).map((x) => x.user_id)]);
}

export async function availability(u: U, raw: Record<string, string>) {
  internal(u);
  const q = z.object({ users: z.string().min(1).max(4000), from: iso, to: iso, duration: z.coerce.number().int().min(5).max(600).optional() }).parse(raw);
  const ids = q.users.split(",").filter((x) => uuid.safeParse(x).success).slice(0, 40);
  if (new Date(q.to).getTime() - new Date(q.from).getTime() > 31 * 86400000) throw new HttpError(400, "Rang massa llarg (màxim 31 dies)");
  const [busy, known, ppl] = await Promise.all([busyFor(ids, q.from, q.to, u), knownUsers(ids), people(u)]);
  const names = new Map(ppl.map((p) => [p.id, p.name]));
  return {
    users: ids.map((id) => ({ id, name: names.get(id) ?? "—", known: known.has(id) })),
    busy,
    suggestions: q.duration ? suggestSlots({ userIds: ids, busy, known, durationMin: q.duration, fromIso: new Date(Math.max(Date.now(), new Date(q.from).getTime())).toISOString(), max: 6 }) : [],
  };
}

/* ======================================================================= resum per al dashboard */

export async function agendaSummary(u: U) {
  internal(u);
  const me = u.user.id;
  const now = new Date();
  const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  const [y, m, d] = todayLocal.split("-").map(Number);
  const { zonedToUtc } = await import("@/core/agenda");
  const dayStart = zonedToUtc(y, m, d, 0, 0).toISOString();
  const dayEnd = zonedToUtc(y, m, d + 1, 0, 0).toISOString();
  const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString();
  const open = ["pendent", "en_curs", "bloquejada"];
  const tcols = "id,title,due_at,status,priority,kind,client_id,contract_id,incident_id,assigned_to,assigned_name,created_by,crm_clients(id,name)";
  const [today, overdue, assigned, incidents] = await Promise.all([
    u.sb.from("crm_tasks").select(tcols).eq("assigned_to", me).in("status", open).gte("due_at", dayStart).lt("due_at", dayEnd).order("due_at").limit(50),
    u.sb.from("crm_tasks").select(tcols).eq("assigned_to", me).in("status", open).lt("due_at", dayStart).order("due_at").limit(50),
    u.sb.from("crm_tasks").select(tcols).eq("assigned_to", me).neq("created_by", me).in("status", open).order("created_at", { ascending: false }).limit(20),
    u.sb.from("crm_tasks").select(`${tcols},crm_incidents!crm_tasks_incident_id_fkey(id,title,status)`).not("incident_id", "is", null).in("status", open).eq("assigned_to", me).limit(20),
  ]);
  let upcoming: AgendaItem[] = [];
  let agendaMissing = false;
  try { upcoming = (await listAgenda(u, { from: now.toISOString(), to: weekEnd, view: "personal", tasks: "0" })).items.filter((x) => x.status !== "cancellada").slice(0, 12); }
  catch (e) { if (e instanceof HttpError && e.status === 503) agendaMissing = true; else throw e; }
  const assignedEvents = upcoming.filter((x) => x.ownerId === me && x.createdByName && x.createdByName !== u.profile.name);
  const map = (r: { data: unknown } ) => ((r.data ?? []) as Record<string, unknown>[]).map((t) => ({ ...t, client: one(t.crm_clients as { id: string; name: string } | null), incident: one((t as { crm_incidents?: unknown }).crm_incidents as { id: string; title: string; status: string } | null) }));
  return {
    today: map(today), overdue: map(overdue), assigned: map(assigned), incidentTasks: map(incidents).filter((t) => t.incident && !["resolta", "tancada"].includes((t.incident as { status: string }).status)),
    upcoming, assignedEvents, agendaMissing, canAssign: ASSIGNERS.includes(u.profile.role) || (await hasPerm(u, "tasques", "approve")),
  };
}

/* ======================================================================= recordatoris */

/** Genera els avisos pendents (dins del CRM). Sense `userId`: per a tothom (tasca programada del servidor). */
export async function generateReminders(opts: { userId?: string; now?: string } = {}) {
  const sb = adminClient();
  const now = opts.now ?? new Date().toISOString();
  const horizon = new Date(new Date(now).getTime() + 8 * 86400000).toISOString();
  const past = new Date(new Date(now).getTime() - 86400000).toISOString();
  let q = sb.from("agenda_events").select("id,owner_id,title,kind,scope,starts_at,ends_at,all_day,status,priority,recurrence,exdates,reminders,agenda_participants(user_id,response)")
    .lt("starts_at", horizon).or(`ends_at.gte.${past},recurrence.not.is.null`).not("status", "in", "(cancellada,feta)").limit(5000);
  if (opts.userId) {
    const parts = await sb.from("agenda_participants").select("event_id").eq("user_id", opts.userId).limit(2000);
    const ids = ((parts.data ?? []) as { event_id: string }[]).map((p) => p.event_id);
    q = ids.length ? q.or(`owner_id.eq.${opts.userId},id.in.(${ids.join(",")})`) : q.eq("owner_id", opts.userId);
  }
  const r = await q;
  if (r.error) { if (isMissing(r.error)) return { sent: 0, migrated: false }; throw new HttpError(500, "No s'han pogut llegir les cites"); }
  const events = ((r.data ?? []) as unknown as (AgendaEventRow & { agenda_participants: { user_id: string; response: string }[] | null })[]).map((e) => ({ ...e, participants: e.agenda_participants ?? [] }));
  let due = dueReminders(events, now);
  if (opts.userId) due = due.filter((x) => x.userId === opts.userId);
  if (!due.length) return { sent: 0, migrated: true };
  const rows = due.map((x) => { const t = reminderText(x); return { user_id: x.userId, kind: "agenda_recordatori", title: t.title, body: t.body, link: { view: "agenda", params: { date: x.occurrenceStart.slice(0, 10), event: x.eventId } }, rule_key: x.ruleKey }; });
  // unique (user_id, rule_key): un mateix recordatori no es crea mai dues vegades, encara que dues execucions coincideixin
  const ins = await sb.from("crm_notifications").upsert(rows, { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
  if (ins.error) throw new HttpError(500, "No s'han pogut desar els recordatoris");
  return { sent: ins.data?.length ?? 0, migrated: true };
}

/** Vincles d'una fitxa (client, contracte, incidència, targeta del Kanban): pròximes cites i recordatoris. */
export async function linkedEvents(u: U, raw: Record<string, string>) {
  internal(u);
  const q = z.object({ client: uuid.optional(), contract: uuid.optional(), renewal: z.string().max(200).optional(), incident: uuid.optional() }).parse(raw);
  let s = u.sb.from("agenda_events").select("id,title,kind,scope,starts_at,ends_at,status,priority,owner_id,recurrence,exdates,reminders").order("starts_at", { ascending: false }).limit(50);
  if (q.client) s = s.eq("client_id", q.client);
  else if (q.contract) s = s.eq("contract_id", q.contract);
  else if (q.renewal) s = s.eq("renewal_id", q.renewal);
  else if (q.incident) s = s.eq("incident_id", q.incident);
  else throw new HttpError(400, "Falta el vincle");
  const r = await s;
  if (r.error) { if (isMissing(r.error)) return { events: [], migrated: false }; fail(r.error); }
  return { events: r.data ?? [], migrated: true };
}
