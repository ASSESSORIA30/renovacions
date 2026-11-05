import "server-only";
/**
 * EQUIPS COMERCIALS I PANELL DEL CAP D'EQUIP (Fase 8.1) · servidor.
 * - Tot es llegeix AMB LA SESSIÓ DE L'USUARI: la RLS (migració 016) limita el Cap d'equip als comercials del seu equip.
 * - La gestió d'equips (crear, assignar Cap, moure comercials, cartera) és només de Direcció i queda auditada (sec_audit).
 * - Comissions dels comercials de l'equip: només amb el permís «comissions_equip» i només la capa «comercial».
 */
import { z } from "zod";
import { teamDashboard, type TCommission, type TContract, type TOpp, type TTarget, type TTask } from "@/core/teams";
import { HttpError } from "./supabase";
import { hasPerm, requirePerm } from "./permissions";
import type { U } from "./crm";

const uuid = z.string().uuid();
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42883" || /does not exist|Could not find/i.test(e.message ?? ""));
const MIGRATION = "Falta aplicar la migració 016_equips.sql";
function fail(e: { code?: string; message?: string } | null, msg = "Error de consulta"): never {
  if (isMissing(e)) throw new HttpError(503, MIGRATION);
  if (e?.code === "42501" || /row-level security/i.test(e?.message ?? "")) throw new HttpError(403, "No tens permís per fer aquesta operació");
  if (e?.code === "23505") throw new HttpError(409, "Ja existeix (nom d'equip duplicat o comercial ja assignat)");
  if (e?.code === "23514" || e?.code === "P0001") throw new HttpError(400, e.message ?? msg);
  throw new HttpError(500, e?.message ?? msg);
}
const adminOnly = (u: U) => { if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció gestiona els equips comercials"); };

/* ======================================================================= PANELL DEL CAP D'EQUIP */

export async function teamPanel(u: U, raw: Record<string, string> = {}, now = new Date()) {
  await requirePerm(u, "panell_equip");
  const isAdmin = u.profile.role === "admin";
  if (!isAdmin && u.profile.role !== "cap_equip") throw new HttpError(403, "Aquest panell és per al Cap d'equip");
  let tq = u.sb.from("crm_teams").select("id,name,lead_id,active").eq("active", true).order("name");
  if (!isAdmin) tq = tq.eq("lead_id", u.user.id);
  else if (raw.team && uuid.safeParse(raw.team).success) tq = tq.eq("id", raw.team);
  const teams = await tq;
  if (teams.error) fail(teams.error);
  const T = (teams.data ?? []) as { id: string; name: string; lead_id: string | null }[];
  const teamIds = T.map((t) => t.id);
  const mem = teamIds.length ? await u.sb.from("crm_team_members").select("user_id,team_id,joined_at").is("left_at", null).in("team_id", teamIds) : { data: [], error: null };
  if (mem.error) fail(mem.error);
  const ids = [...new Set((mem.data ?? []).map((m) => m.user_id as string))];
  const ppl = ids.length ? ((await u.sb.from("profiles").select("id,name").in("id", ids)).data ?? []) as { id: string; name: string }[] : [];
  const members = ids.map((id) => ({ id, name: ppl.find((p) => p.id === id)?.name ?? "—" })).sort((a, b) => a.name.localeCompare(b.name));
  const canCommissions = isAdmin || (await hasPerm(u, "comissions_equip"));
  const month = now.toISOString().slice(0, 7);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();
  const since60 = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  if (!ids.length) return { teams: T, members, empty: true, canCommissions, ...teamDashboard({ now, members, contracts: [], opps: [], tasks: [], targets: [], lastActivity: {}, commissions: canCommissions ? [] : null }), leads: [], expedients: [] };

  const [contracts, opps, tasks, targets, acts, leads, exps, comm] = await Promise.all([
    u.sb.from("crm_contracts").select("id,owner_id,status,signed_at,created_at,end_date,crm_supplies!crm_contracts_supply_id_fkey(annual_kwh)").in("owner_id", ids).or(`created_at.gte.${since},status.in.(actiu,renovacio_pendent)`).limit(10000),
    u.sb.from("crm_opportunities").select("owner_id,stage,won_at,lost_at,created_at,mwh,commission_eur").in("owner_id", ids).limit(10000),
    u.sb.from("crm_tasks").select("id,title,assigned_to,status,due_at").in("assigned_to", ids).in("status", ["pendent", "en_curs", "bloquejada"]).limit(5000),
    u.sb.from("crm_targets").select("user_id,metric,target").in("user_id", ids).eq("period", month),
    u.sb.from("crm_activities").select("user_id,created_at").in("user_id", ids).gte("created_at", since60).order("created_at", { ascending: false }).limit(5000),
    u.sb.from("crm_leads").select("id,name,company,status,owner_id,created_at").in("owner_id", [...ids, u.user.id]).in("status", ["nou", "contactat", "qualificat"]).order("created_at", { ascending: false }).limit(200),
    u.sb.from("crm_expedients").select("id,code,status,retailer,owner_id,status_changed_at").in("owner_id", ids).not("status", "in", "(activat,rebutjat)").order("status_changed_at", { ascending: true }).limit(200),
    canCommissions ? u.sb.from("fin_ledger").select("beneficiary_id,kind,amount,period").eq("layer", "comercial").in("beneficiary_id", ids).gte("period", `${month}-01`).limit(10000) : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [contracts, opps, tasks]) if (r.error) fail(r.error);
  const lastActivity: Record<string, string | null> = {};
  for (const a of (acts.data ?? []) as { user_id: string; created_at: string }[]) if (!lastActivity[a.user_id]) lastActivity[a.user_id] = a.created_at;
  const C: TContract[] = ((contracts.data ?? []) as (Omit<TContract, "kwh"> & { crm_supplies: { annual_kwh: number | null } | { annual_kwh: number | null }[] | null })[])
    .map(({ crm_supplies, ...c }) => ({ ...c, kwh: one(crm_supplies)?.annual_kwh ?? null }));
  const name = new Map(members.map((m) => [m.id, m.name]));
  const d = teamDashboard({
    now, members, contracts: C, opps: (opps.data ?? []) as TOpp[], tasks: (tasks.data ?? []) as TTask[], targets: (targets.data ?? []) as TTarget[],
    lastActivity, commissions: canCommissions ? ((comm.data ?? []) as TCommission[]) : null,
  });
  return {
    teams: T, members, empty: false, canCommissions, ...d,
    leads: ((leads.data ?? []) as { id: string; name: string; company: string | null; status: string; owner_id: string | null; created_at: string }[]).map((l) => ({ ...l, owner: l.owner_id ? name.get(l.owner_id) ?? (l.owner_id === u.user.id ? u.profile.name : "—") : null })),
    expedients: ((exps.data ?? []) as { id: string; code: string | null; status: string; retailer: string; owner_id: string | null; status_changed_at: string }[]).map((e) => ({ ...e, owner: e.owner_id ? name.get(e.owner_id) ?? "—" : null })),
  };
}

/** Assignar un lead a un comercial de l'equip (la RLS i el disparador impedeixen sortir de l'equip). */
export async function assignLead(u: U, raw: unknown) {
  const b = z.object({ leadId: uuid, ownerId: uuid }).parse(raw);
  if (u.profile.role !== "cap_equip" && u.profile.role !== "admin") throw new HttpError(403, "Només el Cap d'equip o Direcció");
  const { data, error } = await u.sb.from("crm_leads").update({ owner_id: b.ownerId }).eq("id", b.leadId).select("id");
  if (error) fail(error, "No s'ha pogut assignar el lead");
  if (!data?.length) throw new HttpError(403, "Aquest lead no és del teu equip");
  return { ok: true };
}

/* ======================================================================= GESTIÓ D'EQUIPS (Direcció) */

export async function listTeams(u: U) {
  if (!["admin", "cap_administrativa", "administrativa"].includes(u.profile.role)) throw new HttpError(403, "Només Direcció i Administració consulten els equips");
  const [teams, members, portfolio, people] = await Promise.all([
    u.sb.from("crm_teams").select("id,name,lead_id,active,notes,created_at").order("active", { ascending: false }).order("name"),
    u.sb.from("crm_team_members").select("id,team_id,user_id,joined_at,left_at,note").order("joined_at", { ascending: false }),
    u.sb.from("crm_team_clients").select("team_id,client_id,assigned_at,crm_clients(name)"),
    u.sb.from("profiles").select("id,name,role").in("role", ["cap_equip", "comercial"]).order("name"),
  ]);
  if (teams.error) fail(teams.error);
  return {
    teams: teams.data ?? [], members: members.data ?? [],
    portfolio: ((portfolio.data ?? []) as { team_id: string; client_id: string; assigned_at: string; crm_clients: { name: string } | { name: string }[] | null }[]).map((p) => ({ team_id: p.team_id, client_id: p.client_id, assigned_at: p.assigned_at, name: one(p.crm_clients)?.name ?? "—" })),
    people: people.data ?? [], canEdit: u.profile.role === "admin",
  };
}

const teamInput = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(120), lead_id: uuid.nullable(), active: z.boolean().default(true), notes: z.string().trim().max(1000).nullable().optional() });
export async function saveTeam(u: U, raw: unknown) {
  adminOnly(u);
  const b = teamInput.parse(raw);
  const row = { name: b.name, lead_id: b.lead_id, active: b.active, notes: b.notes ?? null };
  const r = b.id ? await u.sb.from("crm_teams").update(row).eq("id", b.id).select("id").single() : await u.sb.from("crm_teams").insert(row).select("id").single();
  if (r.error) fail(r.error, "No s'ha pogut desar l'equip");
  return { id: r.data!.id as string };
}

export async function moveMember(u: U, raw: unknown) {
  adminOnly(u);
  const b = z.object({ userId: uuid, teamId: uuid.nullable(), note: z.string().trim().max(300).nullable().optional() }).parse(raw);
  const { error } = await u.sb.rpc("crm_team_move", { p_user: b.userId, p_team: b.teamId, p_note: b.note ?? null });
  if (error) fail(error, "No s'ha pogut moure el comercial");
  return { ok: true };
}

export async function setPortfolio(u: U, raw: unknown) {
  adminOnly(u);
  const b = z.object({ teamId: uuid, clientId: uuid, op: z.enum(["add", "remove"]) }).parse(raw);
  const r = b.op === "add"
    ? await u.sb.from("crm_team_clients").upsert({ team_id: b.teamId, client_id: b.clientId }, { onConflict: "team_id,client_id" })
    : await u.sb.from("crm_team_clients").delete().eq("team_id", b.teamId).eq("client_id", b.clientId);
  if (r.error) fail(r.error, "No s'ha pogut actualitzar la cartera");
  return { ok: true };
}
