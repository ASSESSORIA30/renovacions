import "server-only";
/**
 * CENTRE DE CONTROL I PANELLS PER ROL (Fase 7) · servidor.
 * Tot es llegeix AMB LA SESSIÓ DE L'USUARI (RLS): cada panell només pot mostrar el que la persona pot veure.
 * Els indicadors econòmics reutilitzen el càlcul del Panell econòmic (Fase 4) i només es calculen amb el permís
 * «economia»; els comercials veuen únicament les seves comissions (myCommissions).
 * Les preferències de cada panell es guarden per identificador d'usuari (user_dashboard_prefs).
 */
import { z } from "zod";
import {
  DEFAULT_TEMPLATE, KPI_DEFS, OPEN_TASK, TEMPLATES, commercialSeries, detectQuality, inRange, layoutSchema, operationalKpis, periodRange, productivity, sanitizeLayout,
  type CContract, type CExpedient, type CIncident, type CLead, type COpp, type CTask, type PeriodKey, type QualityIssue,
} from "@/core/control";
import { HttpError } from "./supabase";
import { finStaff, hasPerm, requirePerm } from "./permissions";
import type { U } from "./crm";

type Q<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>;
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST200" || e.code === "PGRST205" || /does not exist|Could not find/i.test(e.message ?? ""));

/** Llegeix en pàgines de 1.000 (màx. `cap` files) per no carregar milers de files d'un cop. */
async function pages<T>(build: (from: number, to: number) => Q<T>, cap = 20_000, strict = false): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build(from, from + 999);
    // `strict`: un error de relació (PGRST200/201) en una taula base NO es pot convertir en «0 contractes».
    if (error) { if (!strict && isMissing(error)) return out; throw new HttpError(500, error.message ?? "Error de consulta"); }
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
/*
 * Fase 8.1 · crm_contracts ↔ crm_supplies tenen DUES claus foranes (pg_constraint):
 *   - crm_contracts.supply_id          → crm_supplies  [crm_contracts_supply_id_fkey]      subministrament DEL contracte (N:1)
 *   - crm_supplies.current_contract_id → crm_contracts [crm_supplies_current_contract_fk]  contracte vigent del subministrament
 * Sense `!constraint`, PostgREST retorna PGRST201 i el Centre de Control i la Supervisió no carregaven.
 * Els KPI (MWh) necessiten el subministrament del contracte: `crm_supplies!crm_contracts_supply_id_fkey(...)`,
 * que retorna UN objecte per contracte i no duplica files. Ho vigila tests/db/embed-ambiguity.test.ts.
 */

export const filtersSchema = z.object({
  period: z.enum(["avui", "setmana", "mes", "trimestre", "any", "personalitzat"]).default("mes"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  owner: z.string().uuid().optional(),
  retailer: z.string().max(80).optional(),
  product: z.string().max(80).optional(),
  responsible: z.string().uuid().optional(),
});
type Filters = z.infer<typeof filtersSchema>;
const clean = (raw: Record<string, string>) => Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v != null));

/* ======================================================================= càrrega de dades operatives (RLS) */

export async function loadOps(u: U, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)).toISOString();
  const sinceD = since.slice(0, 10);
  const [contracts, expedients, leads, opps, tasks, incidents, ai] = await Promise.all([
    pages<{ id: string; client_id: string; status: string; signed_at: string | null; created_at: string; updated_at: string | null; end_date: string | null; retailer: string; product: string | null; owner_id: string | null; created_by: string | null; crm_supplies: { annual_kwh: number | null } | { annual_kwh: number | null }[] | null }>((a, b) =>
      u.sb.from("crm_contracts").select("id,client_id,status,signed_at,created_at,updated_at,end_date,retailer,product,owner_id,created_by,crm_supplies!crm_contracts_supply_id_fkey(annual_kwh)").or(`created_at.gte.${since},signed_at.gte.${sinceD},status.in.(actiu,renovacio_pendent)`).order("created_at", { ascending: false }).range(a, b), 20_000, true),
    pages<CExpedient & { code: string | null; client_id: string }>((a, b) =>
      u.sb.from("crm_expedients").select("id,code,client_id,status,status_changed_at,activated_at,last_event_at,owner_id,created_by,retailer,service,collaborator_id,created_at").or(`status.not.in.(activat,rebutjat),status_changed_at.gte.${since}`).range(a, b)),
    pages<CLead>((a, b) => u.sb.from("crm_leads").select("id,created_at,owner_id,collaborator_id,status,first_contact_at").or(`created_at.gte.${since},status.eq.nou`).range(a, b)),
    pages<COpp & { title: string; last_activity_at: string | null; service: string | null }>((a, b) => u.sb.from("crm_opportunities").select("id,title,stage,created_at,proposal_sent_at,won_at,lost_at,owner_id,mwh,last_activity_at,service").range(a, b)),
    pages<CTask & { assigned_name: string | null; started_at: string | null; client_id: string | null; expedient_id: string | null }>((a, b) =>
      u.sb.from("crm_tasks").select("id,title,status,due_at,assigned_to,assigned_name,created_by,completed_at,area,kind,priority,escalation_level,created_at,started_at,client_id,expedient_id").or(`status.in.(${OPEN_TASK.join(",")}),completed_at.gte.${since}`).range(a, b)),
    pages<CIncident & { client_id: string; assigned_name: string | null }>((a, b) =>
      u.sb.from("crm_incidents").select("id,title,status,priority,opened_at,closed_at,assigned_to,assigned_name,due_at,escalation_level,client_id").or(`status.not.in.(resolta,tancada),closed_at.gte.${since}`).range(a, b)),
    u.sb.from("ai_opportunities").select("id", { count: "exact", head: true }).eq("status", "nova").then((r) => (r.error ? null : r.count ?? 0), () => null),
  ]);
  return {
    contracts: contracts.map((c) => ({ ...c, kwh: one(c.crm_supplies)?.annual_kwh ?? null })) as (CContract & { client_id: string })[],
    expedients, leads, opps, tasks, incidents, aiPending: ai as number | null,
  };
}
type Ops = Awaited<ReturnType<typeof loadOps>>;

function applyFilters(o: Ops, f: Filters): Ops {
  const own = (x: { owner_id: string | null }) => !f.owner || x.owner_id === f.owner;
  const ret = (r: string | null | undefined) => !f.retailer || (r ?? "").toLowerCase() === f.retailer.toLowerCase();
  const prod = (p: string | null | undefined) => !f.product || (p ?? "").toLowerCase() === f.product.toLowerCase();
  const resp = (x: string | null | undefined) => !f.responsible || x === f.responsible;
  return {
    ...o,
    contracts: o.contracts.filter((c) => own(c) && ret(c.retailer) && prod(c.product)),
    expedients: o.expedients.filter((e) => own(e) && ret(e.retailer) && (!f.product || prod(e.service)) && resp(e.owner_id)),
    leads: o.leads.filter(own),
    opps: o.opps.filter((x) => own(x) && (!f.product || prod(x.service))),
    tasks: o.tasks.filter((t) => resp(t.assigned_to)),
    incidents: o.incidents.filter((i) => resp(i.assigned_to)),
  };
}

async function people(u: U) {
  const { data } = await u.sb.from("profiles").select("id,name,role");
  return (data ?? []) as { id: string; name: string; role: string }[];
}

/* ======================================================================= economia (Fase 4, mateix càlcul) */

async function economic(u: U, range: { from: string; to: string }, f: Filters) {
  if (!(await finStaff(u))) return null;
  const fin = await import("./finance");
  const d = await fin.dashboard(u, clean({ from: range.from, to: range.to, owner: f.owner ?? "", retailer: f.retailer ?? "" }) as Record<string, string>).catch((e: Error) => { if (/migraci|does not exist/i.test(e.message)) return null; throw e; });
  if (!d) return null;
  const sets = await u.sb.from("fin_settlements").select("status,approved_amount,total_gross,paid_amount");
  const pend = ((sets.data ?? []) as { status: string; approved_amount: string | null; total_gross: string; paid_amount: string | null }[])
    .filter((s) => ["esborrany", "revisio"].includes(s.status) || (s.status === "aprovada" && Number(s.paid_amount ?? 0) < Number(s.approved_amount ?? s.total_gross))).length;
  const k = d.kpis;
  const collected = Number(k.collected);
  return {
    comissions_previstes: Number(k.estimated), comissions_meritades: Number(k.accrued), comissions_confirmades: Number(k.confirmed), comissions_cobrades: collected,
    pendent_cobrar: Number(k.pending), liquidacions_pendents: pend, pagaments: Number(k.payoutsComercial) + Number(k.payoutsCollab),
    marge_previst: Number(k.marginForecast), marge_realitzat: Number(k.marginRealized), rendibilitat: collected > 0 ? Math.round((Number(k.marginRealized) / collected) * 1000) / 10 : null,
    ...((await import("./claims").then((c) => c.claimsKpisForControl(u)).catch(() => null)) ?? { reclamacions_obertes: null, reclamacions_pendent: null, reclamacions_recuperat: null }),
    series: d.series,
  };
}

/* ======================================================================= preferències del panell (per usuari) */

export async function getLayout(u: U, scope = "control") {
  const economicOk = await finStaff(u);
  const { data, error } = await u.sb.from("user_dashboard_prefs").select("layout,updated_at").eq("user_id", u.user.id).maybeSingle();
  if (error && !isMissing(error)) throw new HttpError(500, error.message);
  const stored = (data?.layout as Record<string, unknown> | undefined)?.[scope];
  return { layout: sanitizeLayout(stored ?? TEMPLATES[DEFAULT_TEMPLATE].layout, { economic: economicOk }), saved: !!stored, updatedAt: data?.updated_at ?? null, migrated: !error };
}

export async function saveLayout(u: U, raw: unknown, scope = "control") {
  const parsed = layoutSchema.parse(raw);
  const layout = sanitizeLayout(parsed, { economic: await finStaff(u) });
  const { data: cur } = await u.sb.from("user_dashboard_prefs").select("layout").eq("user_id", u.user.id).maybeSingle();
  const next = { ...((cur?.layout as Record<string, unknown>) ?? {}), [scope]: layout };
  const { error } = await u.sb.from("user_dashboard_prefs").upsert({ user_id: u.user.id, layout: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new HttpError(isMissing(error) ? 503 : 400, isMissing(error) ? "Falta aplicar la migració 014_consolidacio.sql" : error.message);
  return { ok: true, layout };
}

export async function resetLayout(u: U, template: string, scope = "control") {
  const t = TEMPLATES[template] ?? TEMPLATES[DEFAULT_TEMPLATE];
  return saveLayout(u, t.layout, scope);
}

/* ======================================================================= CENTRE DE CONTROL (Direcció) */

export async function controlCenter(u: U, raw: Record<string, string>, now = new Date()) {
  await requirePerm(u, "centre_control");
  const f = filtersSchema.parse(clean(raw));
  const range = periodRange(f.period as PeriodKey, now, { from: f.from, to: f.to });
  const [all, ppl] = await Promise.all([loadOps(u, now), people(u)]);
  const o = applyFilters(all, f);
  const kpis = operationalKpis({ now, range, ...o });
  const econ = await economic(u, range, f);
  const name = new Map(ppl.map((p) => [p.id, p.name]));
  const team = ppl.filter((p) => ["admin", "cap_administrativa", "administrativa", "comercial"].includes(p.role));
  const prod = productivity({
    range, people: team,
    contracts: o.contracts, activations: o.expedients.filter((e) => e.status === "activat").map((e) => ({ user_id: e.owner_id, at: e.activated_at ?? e.status_changed_at })),
    expedientEvents: [], tasks: o.tasks, incidents: o.incidents, leads: o.leads, proposals: o.opps, renewals: [],
  });
  const t0 = now.toISOString();
  const workload = team.map((p) => {
    const open = o.tasks.filter((t) => t.assigned_to === p.id && (OPEN_TASK as readonly string[]).includes(t.status));
    return { id: p.id, name: p.name, role: p.role, open: open.length, overdue: open.filter((t) => t.due_at && t.due_at < t0).length, blocked: open.filter((t) => t.status === "bloquejada").length, urgent: open.filter((t) => t.priority === "urgent").length };
  }).filter((w) => w.open > 0 || ["administrativa", "cap_administrativa", "comercial"].includes(w.role));
  // resultats per col·laborador (operacions, no comissions: aquestes van al bloc econòmic)
  const collabIds = [...new Set([...o.leads.map((l) => l.collaborator_id), ...o.expedients.map((e) => e.collaborator_id)].filter(Boolean))] as string[];
  const collaborators = collabIds.map((id) => ({
    id, name: name.get(id) ?? "Col·laborador",
    leads: o.leads.filter((l) => l.collaborator_id === id && inRange(l.created_at, range)).length,
    inProgress: o.expedients.filter((e) => e.collaborator_id === id && !["activat", "rebutjat"].includes(e.status)).length,
    activated: o.expedients.filter((e) => e.collaborator_id === id && e.status === "activat" && inRange(e.activated_at ?? e.status_changed_at, range)).length,
  })).sort((a, b) => b.activated - a.activated || b.leads - a.leads).slice(0, 12);
  const byCommercial = ppl.filter((p) => p.role === "comercial").map((p) => ({
    id: p.id, name: p.name,
    contracts: o.contracts.filter((c) => c.owner_id === p.id && !["esborrany", "anullat"].includes(c.status) && inRange(c.signed_at ?? c.created_at, range)).length,
    mwh: Math.round(o.contracts.filter((c) => c.owner_id === p.id && !["esborrany", "anullat"].includes(c.status) && inRange(c.signed_at ?? c.created_at, range)).reduce((s, c) => s + (c.kwh ?? 0), 0) / 10) / 100,
    leads: o.leads.filter((l) => l.owner_id === p.id && inRange(l.created_at, range)).length,
    proposals: o.opps.filter((x) => x.owner_id === p.id && inRange(x.proposal_sent_at, range)).length,
    won: o.opps.filter((x) => x.owner_id === p.id && x.stage === "guanyat" && inRange(x.won_at, range)).length,
  }));
  const month = now.toISOString().slice(0, 7);
  const tg = await u.sb.from("crm_targets").select("user_id,metric,target").eq("period", month);
  const monthR = periodRange("mes", now);
  const actual = (uid: string, metric: string) => {
    const won = all.opps.filter((x) => x.owner_id === uid && x.stage === "guanyat" && inRange(x.won_at, monthR));
    if (metric === "guanyades") return won.length;
    if (metric === "mwh") return Math.round(won.reduce((s, x) => s + Number(x.mwh ?? 0), 0) * 100) / 100;
    if (metric === "oportunitats") return all.opps.filter((x) => x.owner_id === uid && inRange(x.created_at, monthR)).length;
    return null;
  };
  const objectives = ((tg.data ?? []) as { user_id: string; metric: string; target: number }[]).filter((t) => econ || t.metric !== "comissio").map((t) => ({ ...t, name: name.get(t.user_id) ?? "—", actual: actual(t.user_id, t.metric) }));
  const aiTop = await u.sb.from("ai_opportunities").select("id,title,kind,score,client_id,owner_id,detected_at").eq("status", "nova").order("score", { ascending: false }).limit(6).then((r) => r.data ?? [], () => []);
  const notes = await u.sb.from("crm_notifications").select("id,kind,title,body,link,created_at,read_at").eq("user_id", u.user.id).is("read_at", null).order("created_at", { ascending: false }).limit(12);
  const in120 = new Date(now.getTime() + 120 * 86_400_000).toISOString().slice(0, 10);
  const renewals = o.contracts.filter((c) => ["actiu", "renovacio_pendent"].includes(c.status) && c.end_date && c.end_date >= t0.slice(0, 10) && c.end_date <= in120).sort((a, b) => a.end_date!.localeCompare(b.end_date!)).slice(0, 12).map((c) => ({ id: c.id, client_id: c.client_id, retailer: c.retailer, end_date: c.end_date, owner: c.owner_id ? name.get(c.owner_id) ?? null : null }));
  const funnel = ["nou", "contactat", "qualificat", "proposta_enviada", "negociacio"].map((s) => ({ stage: s, count: o.opps.filter((x) => x.stage === s).length }));
  const opts = {
    owners: ppl.filter((p) => p.role === "comercial" || p.role === "admin").map((p) => ({ id: p.id, name: p.name })),
    responsibles: team.map((p) => ({ id: p.id, name: p.name })),
    retailers: [...new Set(all.contracts.map((c) => c.retailer).filter(Boolean))].sort(),
    products: [...new Set([...all.contracts.map((c) => c.product), ...all.expedients.map((e) => e.service)].filter(Boolean) as string[])].sort(),
  };
  return {
    range, period: f.period, filters: f, kpis: { ...kpis, ...(econ ?? {}) }, economic: !!econ, definitions: KPI_DEFS.filter((k) => !k.economic || econ),
    series: { commercial: commercialSeries(now, o.contracts, o.leads, o.opps), economic: econ?.series ?? null },
    team: prod, workload, byCommercial, collaborators, objectives, ai: aiTop, alerts: notes.data ?? [], renewals, funnel, options: opts,
    layout: await getLayout(u), templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, help: t.help })),
  };
}

/* ======================================================================= PANELL DE CAP ADMINISTRATIVA */

export async function capPanel(u: U, now = new Date()) {
  await requirePerm(u, "panell_cap");
  const [o, ppl] = await Promise.all([loadOps(u, now), people(u)]);
  const range = periodRange("setmana", now);
  const kpis = operationalKpis({ now, range, ...o });
  const t0 = now.toISOString();
  const admins = ppl.filter((p) => ["administrativa", "cap_administrativa"].includes(p.role));
  const name = new Map(ppl.map((p) => [p.id, p.name]));
  const isAdminTask = (t: CTask) => t.area === "administrativa" || (!t.area && (["tramitacio", "documentacio", "renovacio", "incidencia"].includes(t.kind ?? "") || admins.some((a) => a.id === t.assigned_to)));
  const adminTasks = o.tasks.filter(isAdminTask);
  const open = adminTasks.filter((t) => (OPEN_TASK as readonly string[]).includes(t.status));
  const team = admins.map((p) => {
    const mine = open.filter((t) => t.assigned_to === p.id);
    const done = adminTasks.filter((t) => t.assigned_to === p.id && t.status === "feta" && inRange(t.completed_at, range)).length;
    const exps = o.expedients.filter((e) => e.owner_id === p.id && !["activat", "rebutjat"].includes(e.status)).length;
    return { id: p.id, name: p.name, role: p.role, open: mine.length, overdue: mine.filter((t) => t.due_at && t.due_at < t0).length, blocked: mine.filter((t) => t.status === "bloquejada").length, doneWeek: done, expedients: exps, load: mine.length + exps };
  });
  const review = o.expedients.filter((e) => ["documentacio_completa", "signat"].includes(e.status));
  const incomplete = o.expedients.filter((e) => e.status === "pendent_documentacio");
  const blocked = o.expedients.filter((e) => !["activat", "rebutjat"].includes(e.status) && (e.status === "incidencia" || (now.getTime() - new Date(e.last_event_at ?? e.status_changed_at).getTime()) / 86_400_000 > 7));
  const in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const urgentRenewals = o.contracts.filter((c) => ["actiu", "renovacio_pendent"].includes(c.status) && c.end_date && c.end_date >= t0.slice(0, 10) && c.end_date <= in30);
  const exp = (e: (typeof o.expedients)[number]) => ({ id: e.id, code: e.code, status: e.status, retailer: e.retailer, owner: e.owner_id ? name.get(e.owner_id) ?? null : null, since: e.last_event_at ?? e.status_changed_at });
  const recent = await u.sb.from("crm_task_events").select("id,task_id,at,user_name,type,from_value,to_value,crm_tasks(title)").order("at", { ascending: false }).limit(15).then((r) => r.data ?? [], () => []);
  return {
    kpis: { ...kpis, pendents_revisar: review.length, expedients_incomplets: incomplete.length, contractes_bloquejats: blocked.length, tasques_admin_obertes: open.length, tasques_admin_vencudes: open.filter((t) => t.due_at && t.due_at < t0).length, renovacions_urgents: urgentRenewals.length },
    team, assignees: admins.map((p) => ({ id: p.id, name: p.name })),
    overdue: open.filter((t) => t.due_at && t.due_at < t0).sort((a, b) => a.due_at!.localeCompare(b.due_at!)).slice(0, 25).map((t) => ({ ...t, assignee: t.assigned_to ? name.get(t.assigned_to) ?? null : null })),
    unassigned: open.filter((t) => !t.assigned_to).slice(0, 25),
    review: review.slice(0, 20).map(exp), incomplete: incomplete.slice(0, 20).map(exp), blocked: blocked.slice(0, 20).map(exp),
    renewals: urgentRenewals.slice(0, 20).map((c) => ({ id: c.id, client_id: c.client_id, retailer: c.retailer, end_date: c.end_date, owner: c.owner_id ? name.get(c.owner_id) ?? null : null })),
    incidents: o.incidents.filter((i) => !["resolta", "tancada"].includes(i.status)).sort((a, b) => (a.priority === "urgent" ? -1 : 0) - (b.priority === "urgent" ? -1 : 0)).slice(0, 20),
    recent,
    economicAccess: await finStaff(u),
  };
}

/* ======================================================================= LA MEVA JORNADA (administrativa) */

export async function myDay(u: U, now = new Date()) {
  if (!(await hasPerm(u, "jornada_admin")) && !(await hasPerm(u, "panell_cap"))) await requirePerm(u, "jornada_admin");
  const me = u.user.id;
  const today = now.toISOString().slice(0, 10), t0 = now.toISOString();
  const in120 = new Date(now.getTime() + 120 * 86_400_000).toISOString().slice(0, 10);
  const [tasks, done, exps, incs, renew, notes, recent] = await Promise.all([
    u.sb.from("crm_tasks").select("id,title,notes,status,priority,due_at,kind,client_id,expedient_id,lead_id,incident_id,blocked_reason,crm_clients(name)").eq("assigned_to", me).in("status", [...OPEN_TASK]).order("due_at", { ascending: true, nullsFirst: false }).limit(300),
    u.sb.from("crm_tasks").select("id,title,completed_at,kind").eq("assigned_to", me).eq("status", "feta").gte("completed_at", `${today}T00:00:00Z`).order("completed_at", { ascending: false }).limit(50),
    u.sb.from("crm_expedients").select("id,code,status,retailer,service,next_action,next_action_at,status_changed_at,last_event_at,crm_clients(name)").eq("owner_id", me).not("status", "in", "(activat,rebutjat)").order("next_action_at", { ascending: true, nullsFirst: false }).limit(200),
    u.sb.from("crm_incidents").select("id,title,status,priority,opened_at,due_at,client_id,crm_clients(name)").eq("assigned_to", me).not("status", "in", "(resolta,tancada)").order("opened_at").limit(100),
    u.sb.from("crm_contracts").select("id,client_id,retailer,end_date,status,crm_clients(name)").in("status", ["actiu", "renovacio_pendent"]).gte("end_date", today).lte("end_date", in120).or(`owner_id.eq.${me},created_by.eq.${me}`).order("end_date").limit(100),
    u.sb.from("crm_notifications").select("id,kind,title,body,link,created_at").eq("user_id", me).is("read_at", null).order("created_at", { ascending: false }).limit(20),
    u.sb.from("crm_task_events").select("id,at,type,to_value,crm_tasks(title)").eq("user_id", me).order("at", { ascending: false }).limit(15),
  ]);
  for (const r of [tasks, exps, incs]) if (r.error && !isMissing(r.error)) throw new HttpError(500, r.error.message);
  const T = (tasks.data ?? []) as { id: string; due_at: string | null; status: string }[];
  const E = (exps.data ?? []) as { status: string }[];
  return {
    today: T.filter((t) => t.due_at && t.due_at.slice(0, 10) === today),
    overdue: T.filter((t) => t.due_at && t.due_at < t0 && t.due_at.slice(0, 10) !== today),
    pending: T.filter((t) => !t.due_at || t.due_at.slice(0, 10) > today),
    done: done.data ?? [],
    expedients: exps.data ?? [],
    toProcess: E.filter((e) => ["pendent_documentacio", "documentacio_completa", "signat", "pendent_signatura"].includes(e.status)).length,
    renewals: renew.data ?? [], incidents: incs.data ?? [], alerts: notes.data ?? [], recent: recent.data ?? [],
  };
}

/* ======================================================================= PANELL COMERCIAL */

export async function commercialPanel(u: U, now = new Date()) {
  await requirePerm(u, "panell_comercial");
  const me = u.user.id;
  const today = now.toISOString().slice(0, 10);
  const month = periodRange("mes", now);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();
  const [leads, clients, opps, tasks, contracts, targets] = await Promise.all([
    u.sb.from("crm_leads").select("id,name,status,created_at,first_contact_at,services,capture_channel").eq("owner_id", me).in("status", ["nou", "contactat", "qualificat"]).order("created_at", { ascending: false }).limit(200),
    u.sb.from("crm_clients").select("id", { count: "exact", head: true }).eq("owner_id", me).is("archived_at", null),
    u.sb.from("crm_opportunities").select("id,title,stage,mwh,proposal_sent_at,won_at,lost_at,created_at,last_activity_at,service").eq("owner_id", me).limit(2000),
    u.sb.from("crm_tasks").select("id,title,status,priority,due_at,kind,client_id,lead_id,opportunity_id").eq("assigned_to", me).in("status", [...OPEN_TASK]).order("due_at", { ascending: true, nullsFirst: false }).limit(200),
    u.sb.from("crm_contracts").select("id,status,signed_at,created_at,retailer,crm_supplies!crm_contracts_supply_id_fkey(annual_kwh)").eq("owner_id", me).gte("created_at", since).limit(5000),
    u.sb.from("crm_targets").select("metric,target").eq("user_id", me).eq("period", today.slice(0, 7)),
  ]);
  const O = (opps.data ?? []) as unknown as (COpp & { title: string })[];
  const T = (tasks.data ?? []) as { id: string; due_at: string | null; kind: string }[];
  // Fase 8.1: abans un error de relació deixava els contractes i MWh del comercial a 0 sense avisar.
  if (contracts.error) throw new HttpError(500, contracts.error.message ?? "Error carregant els contractes");
  const C = ((contracts.data ?? []) as { status: string; signed_at: string | null; created_at: string; crm_supplies: { annual_kwh: number | null } | { annual_kwh: number | null }[] | null }[]).filter((c) => !["esborrany", "anullat"].includes(c.status));
  const wonMonth = O.filter((o) => o.stage === "guanyat" && inRange(o.won_at, month));
  const cMonth = C.filter((c) => inRange(c.signed_at ?? c.created_at, month));
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const series = months.map((m) => ({ month: m, contractes: C.filter((c) => (c.signed_at ?? c.created_at).startsWith(m)).length, guanyades: O.filter((o) => o.won_at?.startsWith(m)).length, mwh: Math.round(C.filter((c) => (c.signed_at ?? c.created_at).startsWith(m)).reduce((s, c) => s + (one(c.crm_supplies)?.annual_kwh ?? 0), 0) / 10) / 100 }));
  // comissions pròpies (mai d'altres ni marges globals): la mateixa funció que «Les meves comissions» de la Fase 4
  let commissions: { estimated: number | null; accrued: number | null; pending: number | null } | null = null;
  try {
    const fin = await import("./finance");
    const com = await fin.myCommissions(u);
    const n = (v: unknown) => Number(v ?? 0);
    commissions = {
      estimated: com.calculations.filter((c: { status: string }) => c.status === "calculat").reduce((a: number, c: { amount: unknown }) => a + n(c.amount), 0),
      accrued: (com.ledger as { kind: string; amount: string; period: string }[]).filter((l) => l.kind === "meritacio" && inRange(l.period, month)).reduce((a, l) => a + n(l.amount), 0),
      pending: n(com.pending),
    };
  } catch { commissions = null; }
  const tg = (targets.data ?? []) as { metric: string; target: number }[];
  const actual: Record<string, number> = { guanyades: wonMonth.length, mwh: Math.round(wonMonth.reduce((s, o) => s + Number(o.mwh ?? 0), 0) * 100) / 100, oportunitats: O.filter((o) => inRange(o.created_at, month)).length, comissio: commissions?.accrued ?? 0 };
  return {
    kpis: {
      leads: (leads.data ?? []).length, leadsNous: (leads.data ?? []).filter((l) => l.status === "nou").length, clients: clients.count ?? 0,
      oportunitats: O.filter((o) => !["guanyat", "perdut"].includes(o.stage)).length, propostesPendents: O.filter((o) => o.stage === "proposta_enviada").length,
      trucadesAvui: T.filter((t) => t.kind === "trucada" && t.due_at?.slice(0, 10) === today).length, tasques: T.length,
      contractesMes: cMonth.length, guanyadesMes: wonMonth.length, mwhMes: Math.round(cMonth.reduce((s, c) => s + (one(c.crm_supplies)?.annual_kwh ?? 0), 0) / 10) / 100,
    },
    leads: (leads.data ?? []).slice(0, 15), proposals: O.filter((o) => o.stage === "proposta_enviada").slice(0, 15),
    today: T.filter((t) => t.due_at && t.due_at.slice(0, 10) <= today).slice(0, 20),
    targets: tg.map((t) => ({ ...t, actual: actual[t.metric] ?? null })), commissions, series,
  };
}

/* ======================================================================= PRODUCTIVITAT (activitat registrada) */

export async function productivityReport(u: U, raw: Record<string, string>, now = new Date()) {
  const f = filtersSchema.parse(clean(raw));
  const range = periodRange(f.period as PeriodKey, now, { from: f.from, to: f.to });
  const global = u.profile.role === "admin";
  const team = !global && (await hasPerm(u, "productivitat"));
  if (u.profile.role === "colaborador") throw new HttpError(403, "Els col·laboradors consulten les seves operacions al portal");
  const ppl = await people(u);
  // abast: Direcció → tothom de l'equip intern; Cap administrativa → equip administratiu; la resta → només ella mateixa
  const scope = ppl.filter((p) => (global ? ["admin", "cap_administrativa", "administrativa", "comercial"].includes(p.role) : team ? ["administrativa", "cap_administrativa"].includes(p.role) || p.id === u.user.id : p.id === u.user.id))
    .filter((p) => !raw.person || p.id === raw.person);
  const ids = scope.map((p) => p.id);
  if (!ids.length) return { range, rows: [], scope: global ? "global" : team ? "equip" : "propi" };
  const since = `${range.from}T00:00:00Z`, until = `${range.to}T23:59:59Z`;
  const [contracts, evs, tasks, incs, leads, opps] = await Promise.all([
    pages<{ created_by: string | null; created_at: string }>((a, b) => u.sb.from("crm_contracts").select("created_by,created_at").in("created_by", ids).gte("created_at", since).lte("created_at", until).range(a, b)),
    pages<{ user_id: string | null; at: string; type: string; to_status: string | null }>((a, b) => u.sb.from("crm_expedient_events").select("user_id,at,type,to_status").in("user_id", ids).gte("at", since).lte("at", until).range(a, b)),
    pages<{ assigned_to: string | null; status: string; completed_at: string | null; kind: string | null; started_at: string | null }>((a, b) => u.sb.from("crm_tasks").select("assigned_to,status,completed_at,kind,started_at").in("assigned_to", ids).or(`status.in.(${OPEN_TASK.join(",")}),completed_at.gte.${since}`).range(a, b)),
    pages<{ assigned_to: string | null; status: string; closed_at: string | null }>((a, b) => u.sb.from("crm_incidents").select("assigned_to,status,closed_at").in("assigned_to", ids).gte("closed_at", since).range(a, b)),
    pages<{ owner_id: string | null; first_contact_at: string | null }>((a, b) => u.sb.from("crm_leads").select("owner_id,first_contact_at").in("owner_id", ids).gte("first_contact_at", since).lte("first_contact_at", until).range(a, b)),
    pages<{ owner_id: string | null; proposal_sent_at: string | null }>((a, b) => u.sb.from("crm_opportunities").select("owner_id,proposal_sent_at").in("owner_id", ids).gte("proposal_sent_at", since).lte("proposal_sent_at", until).range(a, b)),
  ]);
  const rows = productivity({
    range, people: scope, contracts, tasks, incidents: incs, leads, proposals: opps,
    activations: evs.filter((e) => e.type === "estat" && e.to_status === "activat").map((e) => ({ user_id: e.user_id, at: e.at })),
    expedientEvents: evs.map((e) => ({ user_id: e.user_id, at: e.at, type: e.type })),
    renewals: [],
  });
  return { range, rows, scope: global ? "global" : team ? "equip" : "propi", note: "Només activitat professional registrada al CRM (tasques, expedients, incidències, leads, propostes i contractes). No hi ha cap monitoratge de pantalla, teclat ni temps de connexió. El temps de gestió només es mostra amb 3 o més tasques amb inici i final registrats." };
}

/* ======================================================================= QUALITAT DE DADES */

export const sigOf = (i: Pick<QualityIssue, "kind" | "ids">) => `${i.kind}:${[...i.ids].sort().join(",")}`.slice(0, 900);

export async function qualityReport(u: U, now = new Date()) {
  if (!(await hasPerm(u, "configuracio")) && !(await hasPerm(u, "panell_cap"))) throw new HttpError(403, "La revisió de qualitat és per a Direcció i la Cap administrativa");
  const econ = await finStaff(u);
  const [clients, supplies, contracts, expedients, documents, opps, tasks, reviews] = await Promise.all([
    pages<{ id: string; name: string; tax_id: string | null; phone: string | null; email: string | null; archived_at: string | null }>((a, b) => u.sb.from("crm_clients").select("id,name,tax_id,phone,email,archived_at").is("archived_at", null).range(a, b), 50_000),
    pages<{ id: string; cups: string; client_id: string; archived_at: string | null }>((a, b) => u.sb.from("crm_supplies").select("id,cups,client_id,archived_at").is("archived_at", null).range(a, b), 50_000),
    pages<{ id: string; client_id: string | null; status: string; start_date: string | null; end_date: string | null; signed_at: string | null; owner_id: string | null }>((a, b) => u.sb.from("crm_contracts").select("id,client_id,status,start_date,end_date,signed_at,owner_id").range(a, b), 50_000),
    pages<{ id: string; code: string | null; status: string; owner_id: string | null }>((a, b) => u.sb.from("crm_expedients").select("id,code,status,owner_id").range(a, b)),
    pages<{ id: string; client_id: string | null; supply_id: string | null; contract_id: string | null; expedient_id: string | null; category: string }>((a, b) => u.sb.from("crm_documents").select("id,client_id,supply_id,contract_id,expedient_id,category").range(a, b), 50_000),
    pages<{ id: string; title: string; stage: string; last_activity_at: string | null; owner_id: string | null }>((a, b) => u.sb.from("crm_opportunities").select("id,title,stage,last_activity_at,owner_id").not("stage", "in", "(guanyat,perdut)").range(a, b)),
    pages<{ id: string; title: string; status: string; assigned_to: string | null }>((a, b) => u.sb.from("crm_tasks").select("id,title,status,assigned_to").in("status", [...OPEN_TASK]).is("assigned_to", null).range(a, b)),
    u.sb.from("dq_reviews").select("signature,status,note,reviewed_at,reviewed_by").then((r) => r.data ?? [], () => []),
  ]);
  let ledger = null, settlements = null;
  if (econ) {
    ledger = await pages<{ id: string; contract_id: string | null; layer: string; kind: string; beneficiary_id: string | null; amount: string; period: string | null }>((a, b) => u.sb.from("fin_ledger").select("id,contract_id,layer,kind,beneficiary_id,amount,period").range(a, b), 50_000);
    const sets = await pages<{ id: string; code: string | null; status: string; total_gross: string; approved_amount: string | null; paid_amount: string | null }>((a, b) => u.sb.from("fin_settlements").select("id,code,status,total_gross,approved_amount,paid_amount").range(a, b));
    const lines = await pages<{ settlement_id: string; amount: string }>((a, b) => u.sb.from("fin_settlement_lines").select("settlement_id,amount").range(a, b), 100_000);
    const tot = new Map<string, number>();
    for (const l of lines) tot.set(l.settlement_id, (tot.get(l.settlement_id) ?? 0) + Number(l.amount));
    settlements = sets.map((s) => ({ ...s, lines_total: tot.has(s.id) ? Math.round(tot.get(s.id)! * 100) / 100 : null }));
  }
  const issues = detectQuality({ now, clients, supplies, contracts, expedients, documents, ledger, settlements, opps, tasks });
  const rev = new Map((reviews as { signature: string; status: string; note: string | null; reviewed_at: string }[]).map((r) => [r.signature, r]));
  const rows = issues.map((i) => {
    const signature = sigOf(i);
    // una revisió humana sempre té prioritat; si no n'hi ha, els casos «mateixa persona» queden ignorats automàticament
    const review = rev.get(signature) ?? (i.autoIgnore ? { signature, status: "ignorat", note: i.autoIgnore, reviewed_at: now.toISOString(), auto: true } : null);
    return { ...i, signature, review };
  });
  return { issues: rows, open: rows.filter((r) => !r.review).length, economicChecks: econ, canReview: (await hasPerm(u, "configuracio", "edit")) || (await hasPerm(u, "panell_cap", "edit")) };
}

/** «Ignora tots»: marca de cop com a ignorats els casos pendents que l'usuari té a la llista (amb el filtre aplicat). */
export async function reviewQualityBulk(u: U, raw: unknown) {
  const b = z.object({ items: z.array(z.object({ signature: z.string().min(3).max(900), kind: z.string().max(40) })).min(1).max(2000), status: z.literal("ignorat"), note: z.string().max(1000).optional() }).parse(raw);
  if (!((await hasPerm(u, "configuracio", "edit")) || (await hasPerm(u, "panell_cap", "edit")))) throw new HttpError(403, "Sense permís per revisar la qualitat de dades");
  const at = new Date().toISOString();
  const uniq = [...new Map(b.items.map((i) => [i.signature, i])).values()];
  // els casos que ja tenen una revisió (feta per una persona) es conserven tal com estan
  const done = new Set<string>();
  for (let i = 0; i < uniq.length; i += 200) {
    const { data } = await u.sb.from("dq_reviews").select("signature").in("signature", uniq.slice(i, i + 200).map((x) => x.signature));
    for (const r of (data ?? []) as { signature: string }[]) done.add(r.signature);
  }
  const rows = uniq.filter((i) => !done.has(i.signature)).map((i) => ({ signature: i.signature, kind: i.kind, status: b.status, note: b.note ?? "Ignorat en bloc («Ignora tots»)", reviewed_by: u.user.id, reviewed_at: at }));
  for (let i = 0; i < rows.length; i += 500) {
    // només s'escriuen els que encara no tenen revisió: no es trepitgen decisions anteriors
    const { error } = await u.sb.from("dq_reviews").upsert(rows.slice(i, i + 500), { onConflict: "signature", ignoreDuplicates: true });
    if (error) throw new HttpError(400, error.message);
  }
  return { ok: true, ignored: rows.length, kept: done.size };
}

export async function reviewQuality(u: U, raw: unknown) {
  const b = z.object({ signature: z.string().min(3).max(900), kind: z.string().max(40), status: z.enum(["revisat", "ignorat", "corregit"]).nullable(), note: z.string().max(1000).optional() }).parse(raw);
  if (!((await hasPerm(u, "configuracio", "edit")) || (await hasPerm(u, "panell_cap", "edit")))) throw new HttpError(403, "Sense permís per revisar la qualitat de dades");
  if (b.status === null) {
    const { error } = await u.sb.from("dq_reviews").delete().eq("signature", b.signature);
    if (error) throw new HttpError(400, error.message);
    return { ok: true };
  }
  const { error } = await u.sb.from("dq_reviews").upsert({ signature: b.signature, kind: b.kind, status: b.status, note: b.note ?? null, reviewed_by: u.user.id, reviewed_at: new Date().toISOString() }, { onConflict: "signature" });
  if (error) throw new HttpError(400, error.message);
  return { ok: true };
}
