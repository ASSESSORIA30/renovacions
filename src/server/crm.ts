import "server-only";
/**
 * CRM FASE 1 · servei de servidor.
 * Totes les lectures i escriptures de dades del CRM es fan AMB LA SESSIÓ DE L'USUARI (`u.sb`): la RLS de Supabase
 * decideix què pot veure i modificar. El client de servei (`adminClient`) només s'usa per a:
 *   - comprovar duplicats globals (NIF/CIF, CUPS) sense revelar dades d'altres usuaris,
 *   - registrar esdeveniments d'auditoria,
 *   - publicar els contractes al sistema de renovacions existent (taula `contracts`, escrita només pel servidor),
 *   - la importació inicial des de la cartera (només Administració/Direcció).
 */
import { assertRetailerOperational } from "./retailers";
import {
  activityInput, clientInput, contactInput, incidentInput, contractInput, financeInput, listQuery, safeSearch, supplyInput, taskInput,
  CONTRACT_STATUS_LABEL, MASKED, maskId, type CrmClientDetail, type CrmContract, type ListQuery,
} from "@/core/crm";
import type { SourceContract } from "@/core/types";
import { adminClient, HttpError, type requireUser } from "./supabase";
import type { z } from "zod";
import { clientOwnerIndex } from "./crm-owner-filter";

export type U = Awaited<ReturnType<typeof requireUser>>;
type PgError = { code?: string; message?: string; details?: string } | null;

const STAFF = ["admin", "cap_administrativa", "administrativa"];
export const isStaffRole = (r: string) => STAFF.includes(r);

/** Converteix errors de PostgreSQL/RLS en missatges entenedors (sense filtrar detalls interns). */
export function dbError(e: PgError, fallback = "No s'ha pogut desar"): never {
  const m = e?.message ?? "";
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) {
    const own = /Només|Contracte tancat|conservació/i.test(m) ? m : "No tens permís per fer aquesta acció";
    throw new HttpError(403, own);
  }
  if (e?.code === "23505") {
    if (/crm_clients_tax_id_uq/.test(m)) throw new HttpError(409, "Ja existeix un client amb aquest NIF/CIF");
    if (/crm_supplies_cups_uq/.test(m)) throw new HttpError(409, "Aquest CUPS ja està donat d'alta en un altre client");
    if (/crm_contacts_primary_uq/.test(m)) throw new HttpError(409, "Ja hi ha un contacte principal");
    throw new HttpError(409, "Registre duplicat");
  }
  if (e?.code === "23514") throw new HttpError(400, "Hi ha dades amb un format no vàlid");
  if (e?.code === "42P01" || /does not exist|schema cache/i.test(m)) throw new HttpError(409, "Falta aplicar la migració supabase/migrations/008_crm_clients360.sql a Supabase");
  console.error("[crm]", e?.code, m.slice(0, 200));
  throw new HttpError(500, fallback);
}

export function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.output<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, [...new Set(r.error.issues.map((i) => i.message))].join(" · "));
  return r.data;
}

/** Auditoria explícita (descàrregues, pujades, accions massives). Mai inclou dades personals. */
export async function auditEvent(u: U | null, e: { clientId?: string | null; entity: string; entityId: string; action: string; fields?: string[] | null; detail?: Record<string, unknown> | null }) {
  const { error } = await adminClient().from("crm_audit_events").insert({ user_id: u?.user.id ?? null, user_name: u?.profile.name ?? "Sistema", client_id: e.clientId ?? null, entity: e.entity, entity_id: e.entityId, action: e.action, fields: e.fields ?? null, detail: e.detail ?? null });
  if (error) console.warn("[crm] auditoria no registrada:", error.code);
}

async function systemActivity(u: U, clientId: string, type: string, title: string, extra: Record<string, unknown> = {}) {
  const { error } = await u.sb.from("crm_activities").insert({ client_id: clientId, type, title, user_id: u.user.id, user_name: u.profile.name, ...extra });
  if (error) console.warn("[crm] activitat no registrada:", error.code);
}

/* ======================================================================= clients */

const LIST_COLUMNS = "id,kind,name,trade_name,tax_id,status,city,province,sector,owner_id,owner_name,phone,email,priority,next_follow_up,supplies_count,luz_count,gas_count,active_contracts,next_renewal,last_activity_at,created_at,registered_at,tags";

export async function listClients(u: U, raw: Record<string, string>) {
  const q: ListQuery = parse(listQuery, raw);
  let query = u.sb.from("crm_clients_list").select(LIST_COLUMNS, { count: "exact" }).is("archived_at", null);
  const s = safeSearch(q.q);
  if (s) {
    const cups = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    query = /^ES\d{4,}/.test(cups) ? query.ilike("cups_list", `%${cups}%`) : query.ilike("search", `%${s}%`);
  }
  // Match imported owners through each legacy contract (not just crm_clients.collaborator_id).
  // This also works for cap_partners without a login account, and existing imported clients.
  const ownerIndex = await clientOwnerIndex(u);
  if (q.collaborator) {
    const matching = [...ownerIndex.clientKeys].filter(([, keys]) => q.collaborator === "unlinked" ? [...keys].some(k => k.startsWith("unlinked:") || k.startsWith("ambiguous:")) : keys.has(q.collaborator!)).map(([id]) => id);
    if (!matching.length) return { rows: [], total: 0, page: q.page, size: q.size, counters: { actiu: 0, potencial: 0, inactiu: 0 } };
    query = query.in("id", matching);
  }
  if (q.status) query = query.eq("status", q.status);
  if (q.owner === "cap") query = query.is("owner_id", null);
  else if (q.owner && /^[0-9a-f-]{36}$/.test(q.owner)) query = query.eq("owner_id", q.owner);
  if (q.city) query = query.ilike("city", q.city.replace(/[%_]/g, ""));
  if (q.province) query = query.ilike("province", q.province.replace(/[%_]/g, ""));
  if (q.sector) query = query.ilike("sector", q.sector.replace(/[%_]/g, ""));
  if (q.service === "luz") query = query.gt("luz_count", 0);
  if (q.service === "gas") query = query.gt("gas_count", 0);
  if (q.service === "cap") query = query.eq("supplies_count", 0);
  query =
    q.sort === "alta" ? query.order("created_at", { ascending: false })
    : q.sort === "renovacio" ? query.order("next_renewal", { ascending: true, nullsFirst: false }).order("name")
    : q.sort === "activitat" ? query.order("last_activity_at", { ascending: false, nullsFirst: false }).order("name")
    : query.order("name", { ascending: true });
  const from = (q.page - 1) * q.size;
  const { data, error, count } = await query.range(from, from + q.size - 1);
  if (error) dbError(error, "No s'han pogut carregar els clients");
  // comptadors globals (clients visibles per a l'usuari)
  const counter = async (status: string) => {
    const r = await u.sb.from("crm_clients").select("id", { count: "exact", head: true }).is("archived_at", null).eq("status", status);
    return r.count ?? 0;
  };
  const [actiu, potencial, inactiu] = await Promise.all([counter("actiu"), counter("potencial"), counter("inactiu")]);
  return { rows: (data ?? []).map(row => ({ ...row, owner_labels: [...(ownerIndex.clientKeys.get(row.id) ?? [])].map(k => ownerIndex.labels.get(k) ?? k).sort() })), total: count ?? 0, page: q.page, size: q.size, counters: { actiu, potencial, inactiu } };
}

/** Valors existents per als filtres (dels clients que l'usuari pot veure). */
export async function clientFacets(u: U) {
  const { data, error } = await u.sb.from("crm_clients").select("city,province,sector,origin").is("archived_at", null).limit(10000);
  if (error) dbError(error);
  const uniq = (k: "city" | "province" | "sector" | "origin") => [...new Set((data ?? []).map((r) => (r[k] as string | null)?.trim()).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "ca"));
  const users = await u.sb.from("profiles").select("id,name,role,code").order("name");
  const ownerIndex = await clientOwnerIndex(u);
  const available = new Set([...ownerIndex.clientKeys.values()].flatMap(keys => [...keys]));
  const collaborators = [...ownerIndex.labels.entries()].filter(([key]) => available.has(key) && !key.startsWith("unlinked:") && !key.startsWith("ambiguous:")).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ca"));
  if ([...available].some(key => key.startsWith("unlinked:") || key.startsWith("ambiguous:"))) collaborators.push({ id: "unlinked", name: "Sense vincular / Revisar" });
  return { cities: uniq("city"), provinces: uniq("province"), sectors: uniq("sector"), origins: uniq("origin"), users: users.data ?? [], collaborators };
}

/** Comprova si ja existeix un client amb el mateix NIF/CIF (a tota la base de dades) i coincidències visibles per telèfon o correu. */
export async function checkDuplicates(u: U, p: { taxId?: string | null; phone?: string | null; email?: string | null; excludeId?: string | null }) {
  const out: { taxId: null | { visible: boolean; id?: string; name?: string }; similar: { id: string; name: string; reason: string }[] } = { taxId: null, similar: [] };
  if (p.taxId) {
    const { data } = await adminClient().from("crm_clients").select("id").eq("tax_id", p.taxId).is("archived_at", null).limit(1);
    const hit = data?.[0];
    if (hit && hit.id !== p.excludeId) {
      const mine = await u.sb.from("crm_clients").select("id,name").eq("id", hit.id).maybeSingle();
      out.taxId = mine.data ? { visible: true, id: mine.data.id, name: mine.data.name } : { visible: false };
    }
  }
  for (const [field, value, reason] of [["phone", p.phone, "mateix telèfon"], ["email", p.email, "mateix correu"]] as const) {
    if (!value) continue;
    const { data } = await u.sb.from("crm_clients").select("id,name").eq(field, value).is("archived_at", null).limit(3);
    for (const r of data ?? []) if (r.id !== p.excludeId && !out.similar.some((s) => s.id === r.id)) out.similar.push({ id: r.id, name: r.name, reason });
  }
  return out;
}

export async function createClient(u: U, raw: unknown) {
  const c = parse(clientInput, raw);
  const dup = await checkDuplicates(u, { taxId: c.tax_id });
  if (dup.taxId) {
    throw new HttpError(409, dup.taxId.visible ? `Ja existeix el client «${dup.taxId.name}» amb aquest NIF/CIF` : "Ja hi ha un client amb aquest NIF/CIF assignat a un altre usuari. Demana a Administració que te'l comparteixi.");
  }
  const staff = isStaffRole(u.profile.role);
  const row = {
    ...c,
    registered_at: c.registered_at ?? new Date().toISOString().slice(0, 10),
    owner_id: staff ? c.owner_id ?? null : u.profile.role === "comercial" ? u.user.id : null,
    collaborator_id: staff ? c.collaborator_id ?? null : u.profile.role === "colaborador" ? u.user.id : null,
    status: u.profile.role === "colaborador" ? "potencial" : c.status,
    created_by: u.user.id,
  };
  if (row.legal_rep_tax_id === MASKED) row.legal_rep_tax_id = null;
  let { data, error } = await u.sb.from("crm_clients").insert(row).select("id").single();
  if (error && missingColumn(error)) {
    const rest: Record<string, unknown> = { ...row };
    for (const k of NAV_FIELDS) delete rest[k];
    ({ data, error } = await u.sb.from("crm_clients").insert(rest).select("id").single());
  }
  if (error || !data) dbError(error, "No s'ha pogut crear el client");
  await systemActivity(u, data.id, "canvi", "Client donat d'alta");
  return { id: data.id as string };
}

const NAV_FIELDS = ["contact_role", "legal_rep_name", "legal_rep_tax_id", "legal_rep_role", "contact_is_legal_rep"] as const;
/** Si la migració 019 encara no s'ha aplicat, es desa la resta de dades del client sense els camps nous. */
const missingColumn = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST204" || e.code === "42703" || /column .* (does not exist|of 'crm_clients')|Could not find the '.*' column/i.test(e.message ?? ""));
const EDITABLE_CLIENT_FIELDS = ["kind", "name", "trade_name", "tax_id", "tax_id_type", "sector", "status", "registered_at", "contact_name", ...NAV_FIELDS, "phone", "phone2", "email", "address", "postal_code", "city", "province", "notes", "origin", "tags", "priority", "next_follow_up"] as const;

export async function updateClient(u: U, id: string, raw: unknown) {
  const c = parse(clientInput, raw);
  if (c.tax_id) {
    const dup = await checkDuplicates(u, { taxId: c.tax_id, excludeId: id });
    if (dup.taxId) throw new HttpError(409, dup.taxId.visible ? `El NIF/CIF ja és del client «${dup.taxId.name}»` : "Aquest NIF/CIF ja és d'un altre client de la base de dades");
  }
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_CLIENT_FIELDS) patch[k] = (c as Record<string, unknown>)[k] ?? null;
  patch.tags = c.tags;
  patch.status = c.status;
  patch.kind = c.kind;
  patch.priority = c.priority;
  if (!patch.registered_at) delete patch.registered_at;
  if (isStaffRole(u.profile.role)) {
    patch.owner_id = c.owner_id ?? null;
    patch.collaborator_id = c.collaborator_id ?? null;
  }
  if (patch.legal_rep_tax_id === MASKED) delete patch.legal_rep_tax_id;     // no s'ha tocat el DNI/NIE emmascarat
  patch.contact_is_legal_rep = c.contact_is_legal_rep;
  let { data, error } = await u.sb.from("crm_clients").update(patch).eq("id", id).select("id");
  if (error && missingColumn(error)) {
    for (const k of NAV_FIELDS) delete patch[k];
    ({ data, error } = await u.sb.from("crm_clients").update(patch).eq("id", id).select("id"));
  }
  if (error) dbError(error);
  if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquest client");
  return { id };
}

export async function getClient(u: U, id: string): Promise<CrmClientDetail> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Client no trobat");
  const sb = u.sb;
  const c = await sb.from("crm_clients").select("*").eq("id", id).maybeSingle();
  if (c.error) dbError(c.error);
  // Mateixa resposta tant si no existeix com si no hi tens accés (no es revela l'existència).
  if (!c.data) throw new HttpError(404, "Aquest client no existeix o no tens permís per veure'l");
  const [contacts, assignments, supplies, contracts, documents, activities, tasks, audit, comparisons, incidents, canEdit, canSensitive, profiles] = await Promise.all([
    sb.from("crm_contacts").select("*").eq("client_id", id).order("is_primary", { ascending: false }).order("name"),
    sb.from("crm_client_assignments").select("user_id,role").eq("client_id", id),
    sb.from("crm_supplies").select("*").eq("client_id", id).order("archived_at", { ascending: true, nullsFirst: true }).order("created_at"),
    sb.from("crm_contracts").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    sb.from("crm_documents").select("id,client_id,supply_id,contract_id,category,sensitive,title,description,original_name,mime,size_bytes,version,status,retain_until,uploaded_by_name,created_at,updated_at").eq("client_id", id).order("created_at", { ascending: false }),
    sb.from("crm_activities").select("*").eq("client_id", id).order("at", { ascending: false }).limit(200),
    sb.from("crm_tasks").select("*").eq("client_id", id).order("status").order("due_at", { ascending: true, nullsFirst: false }),
    sb.from("crm_audit_events").select("id,at,user_name,entity,entity_id,action,fields,detail").eq("client_id", id).order("at", { ascending: false }).limit(100),
    sb.from("comparisons").select("id,created_at,status,cups,client_name,created_by_name,snapshot").eq("crm_client_id", id).order("created_at", { ascending: false }).limit(50),
    sb.from("crm_incidents").select("*").eq("client_id", id).order("opened_at", { ascending: false }),
    sb.rpc("crm_can_edit_client", { p_client: id }),
    sb.rpc("crm_can_see_sensitive", { p_client: id }),
    sb.from("profiles").select("id,name"),
  ]);
  for (const r of [contacts, assignments, supplies, contracts, documents, activities, tasks]) if (r.error) dbError(r.error);
  const names = new Map((profiles.data ?? []).map((p) => [p.id as string, p.name as string]));
  const contractIds = (contracts.data ?? []).map((k) => k.id as string);
  const finance = contractIds.length ? await sb.from("crm_contract_finance").select("*").in("contract_id", contractIds) : { data: [] };
  const fin = new Map((finance.data ?? []).map((f) => [f.contract_id as string, f]));
  // Oportunitats comercials (Fase 2). Si la migració 009 no s'ha aplicat, simplement no n'hi ha.
  const opps = await sb.from("crm_opportunities").select("id,title,service,stage,commission_eur,mwh,owner_id,next_action_at,updated_at").eq("client_id", id).order("updated_at", { ascending: false });
  const exps = await sb.from("crm_expedients").select("id,code,status,service,retailer,product,created_at,activated_at").eq("client_id", id).order("created_at", { ascending: false });
  const docIdList = (documents.data ?? []).map((d) => d.id as string);
  const docIds = new Set(docIdList);
  const versions = docIdList.length ? await sb.from("crm_document_versions").select("document_id,version,original_name,size_bytes,uploaded_by_name,created_at").in("document_id", docIdList).order("version", { ascending: false }) : { data: [] };
  const byDoc = new Map<string, { version: number; original_name: string; size_bytes: number; uploaded_by_name: string | null; created_at: string }[]>();
  for (const v of versions.data ?? []) if (docIds.has(v.document_id)) byDoc.set(v.document_id, [...(byDoc.get(v.document_id) ?? []), v]);
  const staff = isStaffRole(u.profile.role);
  // DNI/NIE del representant legal: sencer només per a qui pot veure dades sensibles del client
  const clientRow = { ...c.data, legal_rep_tax_id: canSensitive.data ? c.data.legal_rep_tax_id ?? null : maskId(c.data.legal_rep_tax_id) };
  const draftsRes = await sb.from("comparison_drafts").select("id,context_key,contract_id,crm_supply_id,cups,client_name,step,created_by_name,updated_by_name,updated_at").eq("crm_client_id", id).eq("status", "obert").order("updated_at", { ascending: false }).limit(50);
  const drafts = draftsRes.error ? [] : draftsRes.data ?? [];
  const today = new Date().toISOString().slice(0, 10), in120 = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  const live = (contracts.data ?? []).filter((k) => ["actiu", "renovacio_pendent"].includes(k.status as string));
  const summary = {
    activeContracts: live.length,
    pendingRenewals: live.filter((k) => k.status === "renovacio_pendent" || (k.end_date && k.end_date >= today && k.end_date <= in120)).length,
    openIncidents: (incidents.data ?? []).filter((x) => !["resolta", "tancada"].includes(x.status as string)).length,
    comparisonsInProgress: (comparisons.data ?? []).filter((x) => x.status === "esborrany").length + drafts.length,
  };
  return {
    summary, drafts,
    client: { ...clientRow, owner_name: c.data.owner_id ? names.get(c.data.owner_id) ?? null : null, collaborator_name: c.data.collaborator_id ? names.get(c.data.collaborator_id) ?? null : null },
    contacts: contacts.data ?? [],
    assignments: (assignments.data ?? []).map((a) => ({ ...a, name: names.get(a.user_id) ?? null })),
    supplies: supplies.data ?? [],
    contracts: (contracts.data ?? []).map((k) => ({ ...k, finance: fin.get(k.id) ?? null })) as CrmContract[],
    documents: (documents.data ?? []).map((d) => ({ ...d, versions: byDoc.get(d.id) ?? [] })),
    activities: activities.data ?? [],
    tasks: tasks.data ?? [],
    audit: audit.data ?? [],
    comparisons: (comparisons.data ?? []).map((k) => {
      const snap = k.snapshot as { offers?: { id: string; supplierName: string; productName: string }[]; result?: { ranked?: { saving?: number | null; offer?: { id: string } }[] } } | null;
      return { id: k.id, created_at: k.created_at, status: k.status, cups: k.cups, client_name: k.client_name, created_by_name: k.created_by_name, saving: snap?.result?.ranked?.[0]?.saving ?? null,
        offers: (snap?.offers ?? []).map((o) => ({ id: o.id, label: `${o.supplierName} · ${o.productName}` })), best: snap?.result?.ranked?.[0]?.offer?.id ?? null };
    }),
    incidents: incidents.data ?? [],
    opportunities: (opps.error ? [] : opps.data ?? []).map((o) => ({ ...o, owner_name: o.owner_id ? names.get(o.owner_id) ?? null : null })),
    expedients: exps.error ? undefined : exps.data ?? [],
    permissions: { canEdit: !!canEdit.data, canSeeSensitive: !!canSensitive.data, isStaff: staff, canAssign: staff, canDeleteDocs: staff },
  } as CrmClientDetail;
}

/* ======================================================================= contactes, assignacions */

export async function contactAction(u: U, b: { action: "create" | "update" | "delete"; clientId: string; id?: string; data?: unknown }) {
  if (b.action === "delete") {
    const { data, error } = await u.sb.from("crm_contacts").delete().eq("id", b.id!).eq("client_id", b.clientId).select("id");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(403, "No tens permís per eliminar aquest contacte");
    return { ok: true };
  }
  const c = parse(contactInput, b.data);
  if (c.is_primary) await u.sb.from("crm_contacts").update({ is_primary: false }).eq("client_id", b.clientId).neq("id", b.id ?? "00000000-0000-0000-0000-000000000000");
  const q = b.action === "create" ? u.sb.from("crm_contacts").insert({ ...c, client_id: b.clientId }).select("id") : u.sb.from("crm_contacts").update(c).eq("id", b.id!).eq("client_id", b.clientId).select("id");
  const { data, error } = await q;
  if (error) dbError(error);
  if (!data?.length) throw new HttpError(403, "No tens permís per modificar els contactes d'aquest client");
  return { id: data[0].id as string };
}

export async function assignmentAction(u: U, b: { action: "add" | "remove"; clientId: string; userId: string; role?: string }) {
  if (!isStaffRole(u.profile.role)) throw new HttpError(403, "Només Administració o Direcció poden compartir clients");
  const r = b.action === "add"
    ? await u.sb.from("crm_client_assignments").upsert({ client_id: b.clientId, user_id: b.userId, role: b.role ?? "comercial" })
    : await u.sb.from("crm_client_assignments").delete().eq("client_id", b.clientId).eq("user_id", b.userId);
  if (r.error) dbError(r.error);
  return { ok: true };
}

/* ======================================================================= subministraments */

export async function supplyAction(u: U, b: { action: "create" | "update" | "archive" | "restore"; clientId: string; id?: string; data?: unknown }) {
  if (b.action === "archive" || b.action === "restore") {
    const { data, error } = await u.sb.from("crm_supplies").update({ archived_at: b.action === "archive" ? new Date().toISOString() : null, status: b.action === "archive" ? "baixa" : "actiu" }).eq("id", b.id!).eq("client_id", b.clientId).select("id");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquest subministrament");
    return { ok: true };
  }
  const s = parse(supplyInput, b.data);
  // CUPS ja donat d'alta (a qualsevol client): s'informa sense revelar dades d'altres usuaris
  const { data: hits } = await adminClient().from("crm_supplies").select("id,client_id").eq("cups20", s.cups.slice(0, 20)).is("archived_at", null).limit(1);
  const hit = hits?.[0];
  if (hit && hit.id !== b.id) {
    const visible = await u.sb.from("crm_clients").select("name").eq("id", hit.client_id).maybeSingle();
    throw new HttpError(409, hit.client_id === b.clientId ? "Aquest CUPS ja és d'aquest client" : visible.data ? `Aquest CUPS ja és del client «${visible.data.name}»` : "Aquest CUPS ja està donat d'alta en un client d'un altre usuari");
  }
  const row = { ...s, client_id: b.clientId, data_updated_at: new Date().toISOString() };
  const q = b.action === "create" ? u.sb.from("crm_supplies").insert(row).select("id") : u.sb.from("crm_supplies").update(row).eq("id", b.id!).eq("client_id", b.clientId).select("id");
  const { data, error } = await q;
  if (error) dbError(error);
  if (!data?.length) throw new HttpError(403, "No tens permís per modificar els subministraments d'aquest client");
  if (b.action === "create") await systemActivity(u, b.clientId, "canvi", `Nou subministrament ${s.energy_type === "gas" ? "de gas" : "d'electricitat"}: ${s.cups}`, { supply_id: data[0].id });
  return { id: data[0].id as string };
}

/* ======================================================================= contractes */

const LIVE = ["actiu", "renovacio_pendent"];

/** Contracte de la taula de renovacions (Excel/sincronització) amb el mateix CUPS, si n'hi ha. */
export async function legacyFor(cups: string | null | undefined) {
  if (!cups) return null;
  const { data } = await adminClient().from("contracts").select("id,removed_from_source").ilike("cups", `${cups.slice(0, 20)}%`).eq("removed_from_source", false).limit(1);
  return data?.[0]?.id as string | undefined ?? null;
}

/**
 * Publica un contracte del CRM al sistema de renovacions (taula `contracts`), perquè surti al Kanban, al calendari
 * i al dashboard. Només si no hi ha ja un contracte de l'Excel per al mateix CUPS (no es dupliquen targetes).
 * Quan el contracte es tanca o s'anul·la, es retira del Kanban (removed_from_source).
 */
export async function publishToRenewals(contractId: string) {
  const sb = adminClient();
  const { data: k } = await sb.from("crm_contracts").select("*").eq("id", contractId).maybeSingle();
  if (!k) return;
  const id = `crm:${k.id}`;
  if (!LIVE.includes(k.status) || !k.end_date || k.legacy_contract_id) {
    await sb.from("contracts").update({ removed_from_source: true }).eq("id", id);
    return;
  }
  const [{ data: c }, { data: s }] = await Promise.all([
    sb.from("crm_clients").select("*").eq("id", k.client_id).single(),
    k.supply_id ? sb.from("crm_supplies").select("*").eq("id", k.supply_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!c) return;
  const ids = [k.owner_id ?? c.owner_id, c.collaborator_id].filter(Boolean) as string[];
  const { data: people } = ids.length ? await sb.from("profiles").select("id,code,email").in("id", ids) : { data: [] as { id: string; code: string | null; email: string }[] };
  const owner = people?.find((p) => p.id === (k.owner_id ?? c.owner_id));
  const collab = people?.find((p) => p.id === c.collaborator_id);
  const powers = (s?.power_kw ?? null) as (number | null)[] | null;
  const src: SourceContract = {
    id, cups: s?.cups ?? null, cif: c.tax_id, cliente: c.name, clienteOriginal: c.trade_name, direccion: s?.address ?? c.address, poblacion: s?.city ?? c.city, provincia: s?.province ?? c.province, cp: s?.postal_code ?? c.postal_code,
    telefono: c.phone, email: c.email, tipo: s?.energy_type === "gas" ? "gas" : "luz", comercializadora: k.retailer, comercializadoraAnterior: null, tarifa: k.access_tariff ?? s?.access_tariff ?? null,
    producto: k.product, precioContratado: null, consumoAnual: s?.annual_kwh ?? null, potencia: powers ? Math.max(0, ...powers.filter((x): x is number => x != null)) || null : null, potencias: powers,
    estadoOrigen: "CRM", estadoAlta: CONTRACT_STATUS_LABEL[k.status as keyof typeof CONTRACT_STATUS_LABEL] ?? k.status, tipoAlta: null, excedentes: null, observaciones: k.notes, comentario: null, comentarioLlamada: null,
    renovat2026: null, representante: c.contact_name, captador: collab?.code ?? null, comercial: owner?.code ?? "SIN ASIGNAR", colaborador: collab?.email?.toLowerCase() ?? null,
    fechaInicio: k.start_date ?? k.signed_at, fechaInicioFuente: null, vencimientoOriginal: k.end_date, vencimiento: k.end_date, renovacionTacita: false, fechaBaja: null,
    contratosPrevios: 0, registrosDiarios: 0, status: "pendiente", motivoRechazo: null, source: "real",
  };
  const { createHash } = await import("node:crypto");
  const { error } = await sb.from("contracts").upsert({ id, cups: src.cups, comercial: src.comercial, captador: src.captador?.toUpperCase() ?? null, colaborador: src.colaborador, data: src, source_hash: createHash("sha1").update(JSON.stringify(src)).digest("hex"), updated_at: new Date().toISOString(), removed_from_source: false });
  if (error) console.warn("[crm] no s'ha pogut publicar a renovacions:", error.code);
}

export async function contractAction(u: U, b: { action: "create" | "update" | "renew" | "finance"; clientId: string; id?: string; data?: unknown }) {
  if (b.action === "finance") {
    if (!isStaffRole(u.profile.role)) throw new HttpError(403, "Només Administració o Direcció poden modificar les dades econòmiques");
    const f = parse(financeInput, b.data);
    const { error } = await u.sb.from("crm_contract_finance").upsert({ contract_id: b.id!, ...f, updated_by: u.user.id, updated_at: new Date().toISOString() });
    if (error) dbError(error);
    return { ok: true };
  }
  const k = parse(contractInput, b.data);
  const staff = isStaffRole(u.profile.role);
  let supplyCups: string | null = null;
  if (k.supply_id) {
    const s = await u.sb.from("crm_supplies").select("id,cups,client_id").eq("id", k.supply_id).maybeSingle();
    if (!s.data || s.data.client_id !== b.clientId) throw new HttpError(400, "El subministrament no és d'aquest client");
    supplyCups = s.data.cups;
  }
  const base = { ...k, owner_id: staff ? k.owner_id ?? null : undefined };
  if (!staff) delete (base as Record<string, unknown>).owner_id;

  if (b.action === "update") {
    const { data, error } = await u.sb.from("crm_contracts").update(base).eq("id", b.id!).eq("client_id", b.clientId).select("id,supply_id,status");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquest contracte");
    if (k.supply_id && LIVE.includes(k.status)) await u.sb.from("crm_supplies").update({ current_contract_id: b.id }).eq("id", k.supply_id);
    await publishToRenewals(b.id!);
    return { id: b.id! };
  }

  // create / renew: sempre un registre NOU (l'anterior es conserva a l'historial)
  let previous: { id: string; status: string } | null = null;
  if (b.action === "renew") {
    const p = await u.sb.from("crm_contracts").select("id,status,client_id").eq("id", b.id!).maybeSingle();
    if (!p.data || p.data.client_id !== b.clientId) throw new HttpError(404, "Contracte anterior no trobat");
    previous = p.data;
  }
  // Fase 10: una comercialitzadora desactivada o arxivada no es pot fer servir per a contractes nous
  await assertRetailerOperational(k.retailer);
  const legacy = await legacyFor(supplyCups);
  const ownerDefault = staff ? k.owner_id ?? null : u.profile.role === "comercial" ? u.user.id : null;
  const { data, error } = await u.sb.from("crm_contracts").insert({ ...base, owner_id: ownerDefault, client_id: b.clientId, previous_contract_id: previous?.id ?? null, legacy_contract_id: legacy, created_by: u.user.id }).select("id").single();
  if (error) dbError(error, "No s'ha pogut crear el contracte");
  if (previous && LIVE.includes(previous.status) && LIVE.includes(k.status)) {
    await u.sb.from("crm_contracts").update({ status: "finalitzat" }).eq("id", previous.id);
    await publishToRenewals(previous.id);
  }
  if (k.supply_id && LIVE.includes(k.status)) await u.sb.from("crm_supplies").update({ current_contract_id: data.id, current_retailer: k.retailer }).eq("id", k.supply_id);
  if (LIVE.includes(k.status)) await u.sb.from("crm_clients").update({ status: "actiu" }).eq("id", b.clientId).eq("status", "potencial");
  await systemActivity(u, b.clientId, "canvi", `${previous ? "Renovació" : "Nou contracte"}: ${k.retailer}${k.product ? ` · ${k.product}` : ""} (${CONTRACT_STATUS_LABEL[k.status]})`, { contract_id: data.id, supply_id: k.supply_id ?? null });
  await publishToRenewals(data.id);
  return { id: data.id as string, legacy };
}

/* ======================================================================= activitat i tasques */

export async function activityAction(u: U, b: { action: "create" | "update"; clientId: string; id?: string; data?: unknown }) {
  const a = parse(activityInput, b.data);
  const row = { ...a, at: a.at ?? new Date().toISOString() };
  const q = b.action === "create"
    ? u.sb.from("crm_activities").insert({ ...row, client_id: b.clientId, user_id: u.user.id, user_name: u.profile.name }).select("id")
    : u.sb.from("crm_activities").update(row).eq("id", b.id!).eq("client_id", b.clientId).select("id");
  const { data, error } = await q;
  if (error) dbError(error);
  if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquesta activitat");
  return { id: data[0].id as string };
}

export async function taskAction(u: U, b: { action: "create" | "complete" | "reopen" | "cancel"; clientId?: string | null; id?: string; data?: unknown }) {
  if (b.action !== "create") {
    const patch = b.action === "complete" ? { status: "feta", completed_at: new Date().toISOString() } : b.action === "cancel" ? { status: "cancellada", completed_at: null } : { status: "pendent", completed_at: null };
    const { data, error } = await u.sb.from("crm_tasks").update(patch).eq("id", b.id!).select("id,client_id,title");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquesta tasca");
    if (b.action === "complete" && data[0].client_id) await systemActivity(u, data[0].client_id, "tasca", `Tasca feta: ${data[0].title}`);
    return { ok: true };
  }
  const t = parse(taskInput, b.data);
  const assignee = t.assigned_to ?? u.user.id;
  const { data: p } = await u.sb.from("profiles").select("name").eq("id", assignee).maybeSingle();
  const { data, error } = await u.sb.from("crm_tasks").insert({ ...t, client_id: b.clientId ?? null, assigned_to: assignee, assigned_name: p?.name ?? null, created_by: u.user.id }).select("id").single();
  if (error) dbError(error, "No s'ha pogut crear la tasca");
  if (b.clientId) {
    await systemActivity(u, b.clientId, "tasca", `Tasca: ${t.title}`, { meta: { taskId: data.id, due: t.due_at ?? null, assignedTo: p?.name ?? null } });
    if (t.due_at) {
      const day = t.due_at.slice(0, 10);
      await u.sb.from("crm_clients").update({ next_follow_up: day }).eq("id", b.clientId).or(`next_follow_up.is.null,next_follow_up.gt.${day}`);
    }
  }
  return { id: data.id as string };
}

export async function myTasks(u: U) {
  const { data, error } = await u.sb.from("crm_tasks").select("*, crm_clients(name)").eq("assigned_to", u.user.id).eq("status", "pendent").order("due_at", { ascending: true, nullsFirst: false }).limit(100);
  if (error) dbError(error);
  return { tasks: data ?? [] };
}

/* ======================================================================= incidències (estructura base) */

export async function incidentAction(u: U, b: { action: "create" | "update"; clientId: string; id?: string; data?: unknown }) {
  const i = parse(incidentInput, b.data);
  const closed = i.status === "resolta" || i.status === "tancada";
  const q = b.action === "create"
    ? u.sb.from("crm_incidents").insert({ ...i, client_id: b.clientId, created_by: u.user.id, closed_at: closed ? new Date().toISOString() : null }).select("id")
    : u.sb.from("crm_incidents").update({ ...i, closed_at: closed ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", b.id!).eq("client_id", b.clientId).select("id");
  const { data, error } = await q;
  if (error) dbError(error);
  if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquesta incidència");
  if (b.action === "create") await systemActivity(u, b.clientId, "canvi", `Nova ${i.kind === "reclamacio" ? "reclamació" : i.kind === "consulta" ? "consulta" : "incidència"}: ${i.title}`);
  return { id: data[0].id as string };
}

/* ======================================================================= accions massives */

export async function bulkAction(u: U, b: { ids: string[]; action: "assign" | "status" | "archive"; value?: string | null }) {
  const ids = [...new Set(b.ids)].filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 500);
  if (!ids.length) throw new HttpError(400, "Cap client seleccionat");
  if ((b.action === "assign" || b.action === "archive") && !isStaffRole(u.profile.role)) throw new HttpError(403, "Només Administració o Direcció poden reassignar o arxivar clients");
  const patch = b.action === "assign" ? { owner_id: b.value || null } : b.action === "archive" ? { archived_at: new Date().toISOString() } : { status: b.value };
  if (b.action === "status" && !["potencial", "actiu", "inactiu", "baixa"].includes(String(b.value))) throw new HttpError(400, "Estat no vàlid");
  const { data, error } = await u.sb.from("crm_clients").update(patch).in("id", ids).select("id");
  if (error) dbError(error);
  await auditEvent(u, { entity: "clients", entityId: `${data?.length ?? 0} clients`, action: `massiva:${b.action}`, detail: { count: data?.length ?? 0 } });
  return { updated: data?.length ?? 0, skipped: ids.length - (data?.length ?? 0) };
}

/* ======================================================================= cerca global */

/** NIF/NIE de persones: als resultats de cerca només es mostren les 4 últimes posicions (els CIF d'empresa, sencers). */
const personalId = (t: string | null) => (t && /^([0-9]{8}|[XYZ][0-9]{7})[A-Z]$/.test(t) ? maskId(t) : t);

export async function globalSearch(u: U, q: string, limitRaw?: string | null) {
  const s = safeSearch(q);
  if (s.length < 2) return { results: [], more: {} };
  // Fase 7: paginació simple per tipus (es demanen `limit + 1` files per saber si n'hi ha més) i més fonts:
  // leads, oportunitats, adreces, contractes (per CUPS o referència d'expedient) i col·laboradors.
  const limit = Math.min(50, Math.max(4, Number(limitRaw) || 8));
  const cups = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isCups = /^ES\d{4,}/.test(cups);
  const digits = s.replace(/\D/g, "");
  const { hasPerm } = await import("./permissions");
  const seePartners = await hasPerm(u, "colaboradors");
  const none = Promise.resolve({ data: [] as never[] });
  type Owner = { name: string } | { name: string }[] | null;
  const ownerName = (x: Owner) => (Array.isArray(x) ? x[0] : x)?.name ?? "";
  // Fase 9: telèfons escrits amb espais o prefix (el text de cerca els desa només amb xifres), contactes,
  // representants legals i incidències (pel títol o la referència externa).
  const phoneQ = digits.length >= 6 && digits.length >= s.replace(/\s/g, "").length - 4 ? digits.replace(/^(0034|34)(?=\d{9}$)/, "") : null;
  const [contactsR, repsR, incR] = await Promise.all([
    isCups ? none : u.sb.from("crm_contacts").select("client_id,name,phone,email,crm_clients(name)").or(`name.ilike.%${s}%,email.ilike.%${s}%${phoneQ ? `,phone.ilike.%${phoneQ}%` : ""}`).limit(limit + 1),
    isCups || s.length < 3 ? none : u.sb.from("crm_clients").select("id,name,legal_rep_name").ilike("legal_rep_name", `%${s}%`).is("archived_at", null).limit(limit + 1).then((r) => (r.error ? { data: [] } : r)),
    isCups || s.length < 3 ? none : u.sb.from("crm_incidents").select("id,client_id,title,external_ref,status,crm_clients(name)").or(`title.ilike.%${s}%,external_ref.ilike.%${s}%`).limit(limit + 1),
  ]);
  const [clients, addr, supplies, leads, opps, exps, partners] = await Promise.all([
    isCups ? none : u.sb.from("crm_clients").select("id,name,tax_id,city,status").or(`search.ilike.%${s}%${phoneQ ? `,search.ilike.%${phoneQ}%` : ""}`).is("archived_at", null).order("name").limit(limit + 1),
    isCups || s.length < 4 ? none : u.sb.from("crm_clients").select("id,name,address,city,status").ilike("address", `%${s}%`).is("archived_at", null).limit(limit + 1),
    cups.length >= 6 ? u.sb.from("crm_supplies").select("id,cups,energy_type,client_id,address,crm_clients(name)").ilike("cups", `%${cups}%`).is("archived_at", null).limit(limit + 1)
      : s.length >= 4 ? u.sb.from("crm_supplies").select("id,cups,energy_type,client_id,address,crm_clients(name)").ilike("address", `%${s}%`).is("archived_at", null).limit(limit + 1) : none,
    isCups ? none : u.sb.from("crm_leads").select("id,name,status,city").ilike("search", `%${digits.length >= 6 ? digits : s}%`).limit(limit + 1),
    isCups ? none : u.sb.from("crm_opportunities").select("id,title,stage,crm_clients(name)").ilike("title", `%${s}%`).limit(limit + 1),
    /^(EXP-?)?\d{4}-?\d{1,5}$/i.test(s.replace(/\s/g, "")) || /^EXP/i.test(s) || s.length >= 5
      ? u.sb.from("crm_expedients").select("id,code,retailer,external_ref,crm_clients(name)").or(`code.ilike.%${s.toUpperCase().replace(/\s/g, "")}%,external_ref.ilike.%${s}%`).limit(limit + 1) : none,
    seePartners && !isCups ? u.sb.from("cap_partners").select("id,name,company,kind,email,phone").or(`name.ilike.%${s}%,company.ilike.%${s}%,email.ilike.%${s}%${digits.length >= 6 ? `,phone.ilike.%${digits}%` : ""}`).limit(limit + 1) : none,
  ]);
  const cut = <T,>(r: { data: T[] | null }) => (r.data ?? []).slice(0, limit);
  const more = { contacts: (contactsR.data ?? []).length > limit, incidents: (incR.data ?? []).length > limit, clients: (clients.data ?? []).length > limit, addresses: (addr.data ?? []).length > limit, supplies: (supplies.data ?? []).length > limit, leads: (leads.data ?? []).length > limit, opportunities: (opps.data ?? []).length > limit, expedients: (exps.data ?? []).length > limit, partners: (partners.data ?? []).length > limit };
  const seen = new Set<string>();
  const uniq = <T extends { kind: string; id: string }>(x: T) => (seen.has(`${x.kind}:${x.id}`) ? false : (seen.add(`${x.kind}:${x.id}`), true));
  return {
    results: [
      ...cut(clients as { data: { id: string; name: string; tax_id: string | null; city: string | null; status: string }[] | null }).map((c) => ({ kind: "client" as const, id: c.id, title: c.name, sub: [personalId(c.tax_id), c.city].filter(Boolean).join(" · "), status: c.status })),
      ...cut(contactsR as { data: { client_id: string; name: string; phone: string | null; email: string | null; crm_clients: Owner }[] | null }).map((x) => ({ kind: "client" as const, id: x.client_id, title: ownerName(x.crm_clients) || x.name, sub: `Contacte: ${x.name}${x.email ? ` · ${x.email}` : ""}`, status: null })),
      ...cut(repsR as { data: { id: string; name: string; legal_rep_name: string | null }[] | null }).map((x) => ({ kind: "client" as const, id: x.id, title: x.name, sub: `Representant legal: ${x.legal_rep_name ?? ""}`, status: null })),
      ...cut(incR as { data: { id: string; client_id: string; title: string; external_ref: string | null; status: string; crm_clients: Owner }[] | null }).map((x) => ({ kind: "incident" as const, id: x.client_id, title: x.title, sub: `Incidència · ${ownerName(x.crm_clients)}${x.external_ref ? ` · ref. ${x.external_ref}` : ""}`, status: x.status })),
      ...cut(addr as { data: { id: string; name: string; address: string | null; city: string | null; status: string }[] | null }).map((c) => ({ kind: "client" as const, id: c.id, title: c.name, sub: [c.address, c.city].filter(Boolean).join(" · "), status: c.status })),
      ...cut(supplies as { data: { id: string; cups: string; energy_type: string; client_id: string; address: string | null; crm_clients: Owner }[] | null }).map((x) => ({ kind: "supply" as const, id: x.client_id, title: x.cups, sub: `${x.energy_type === "gas" ? "Gas" : "Llum"} · ${ownerName(x.crm_clients)}${x.address ? ` · ${x.address}` : ""}`, status: null })),
      ...cut(exps as { data: { id: string; code: string; retailer: string; external_ref: string | null; crm_clients: Owner }[] | null }).map((x) => ({ kind: "expedient" as const, id: x.id, title: x.code, sub: `${ownerName(x.crm_clients)} · ${x.retailer}${x.external_ref ? ` · ref. ${x.external_ref}` : ""}`, status: null })),
      ...cut(leads as { data: { id: string; name: string; status: string; city: string | null }[] | null }).map((l) => ({ kind: "lead" as const, id: l.id, title: l.name, sub: ["Lead", l.city].filter(Boolean).join(" · "), status: l.status })),
      ...cut(opps as { data: { id: string; title: string; stage: string; crm_clients: Owner }[] | null }).map((o) => ({ kind: "opportunity" as const, id: o.id, title: o.title, sub: `Oportunitat · ${ownerName(o.crm_clients)}`, status: o.stage })),
      ...cut(partners as { data: { id: string; name: string; company: string | null; kind: string; email: string | null }[] | null }).map((p) => ({ kind: "partner" as const, id: p.id, title: p.name, sub: ["Col·laborador", p.company, p.email].filter(Boolean).join(" · "), status: null })),
    ].filter(uniq),
    more,
    limit,
  };
}
