import "server-only";
/**
 * CRM FASE 3 · CONTRACTACIÓ I TRAMITACIONS (servidor).
 * Lectures i escriptures amb la sessió de l'usuari (RLS). El client de servei només s'usa per:
 *   - desar fitxers al bucket privat (com a la Fase 1),
 *   - registrar l'enviament a signatura i els avisos verificats del proveïdor (la base de dades no deixa que cap
 *     usuari marqui una signatura electrònica com a signada),
 *   - publicar el contracte activat al motor de renovacions i enviar avisos interns.
 */
import { assertRetailerOperational } from "./retailers";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CLIENT_KIND_LABEL, safeSearch, type ClientKind } from "@/core/crm";
import {
  EXP_STATUSES, OPEN_EXP_STATUSES, PROCEDURE_LABEL, activationInput, checkMove, conditionsFromOffer, conditionsRows, contractingKpis, customerTypeOf, dataPresent,
  docProgress, expedientInput, moveExpInput, renderTemplate, serviceLabel, termsInput, templateVariables, DATA_FIELDS, type Conditions, type DataField, type Snap, type ExpStatus, type Expedient, type Requirement,
} from "@/core/contracting";
import { buildContractPdf } from "@/core/contract-pdf";
import { SERVICES } from "@/core/sales";
import { adminClient, HttpError } from "./supabase";
import { auditEvent, isStaffRole, legacyFor, parse, publishToRenewals, type U } from "./crm";
import { documentBytes, storeServerPdf } from "./crm-docs";
import { notify } from "./sales";
import { eventsUrl, providerById, signatureProvider, signatureStatus } from "./signature";

const uuid = z.string().uuid();
type PgError = { code?: string; message?: string } | null;

/** Errors de la base de dades: els missatges dels triggers (en català) arriben tal qual a l'usuari. */
export function expError(e: PgError, fallback = "No s'ha pogut desar"): never {
  const m = e?.message ?? "";
  if (e?.code === "42P01" || e?.code === "PGRST205" || /does not exist|schema cache/i.test(m)) throw new HttpError(409, "Falta aplicar la migració supabase/migrations/010_crm_contractacio.sql a Supabase");
  if (e?.code === "23514" && !/violates check constraint/i.test(m)) throw new HttpError(400, m);
  if (e?.code === "23514") throw new HttpError(400, "Hi ha dades amb un format no vàlid");
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) {
    throw new HttpError(403, /^(Només|Cal|Una |Aquestes|Registre|No es pot|Per registrar|Un expedient)/.test(m) ? m : "No tens permís per fer aquesta acció");
  }
  if (e?.code === "23505") throw new HttpError(409, "Registre duplicat");
  console.error("[contractacio]", e?.code, m.slice(0, 200));
  throw new HttpError(500, fallback);
}
const names = async (u: U) => new Map(((await u.sb.from("profiles").select("id,name,code,email")).data ?? []).map((p) => [p.id as string, p as { id: string; name: string; code: string | null; email: string }]));
const staffOf = (u: U) => isStaffRole(u.profile.role);
const canManage = (u: U) => ["admin", "cap_administrativa"].includes(u.profile.role);
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function event(u: U, expedientId: string, type: string, title: string, extra: { justification?: string | null; detail?: Record<string, unknown> | null } = {}) {
  const { error } = await u.sb.from("crm_expedient_events").insert({ expedient_id: expedientId, type, title, user_id: u.user.id, user_name: u.profile.name, justification: extra.justification ?? null, detail: extra.detail ?? null });
  if (error) console.warn("[contractacio] historial no registrat:", error.code);
}
async function load(u: U, id: string) {
  if (!uuid.safeParse(id).success) throw new HttpError(404, "Expedient no trobat");
  const r = await u.sb.from("crm_expedients").select("*").eq("id", id).maybeSingle();
  if (r.error) expError(r.error);
  if (!r.data) throw new HttpError(404, "Aquest expedient no existeix o no tens permís per veure'l");
  return r.data as Expedient;
}
async function canEdit(u: U, id: string) {
  const r = await u.sb.rpc("crm_can_edit_expedient", { p_id: id });
  return !!r.data;
}

/* ======================================================================= llistat, Kanban i panell */

const listQuery = z.object({
  q: z.string().max(100).optional().default(""),
  status: z.string().max(400).optional(),               // un o diversos separats per comes
  service: z.enum(SERVICES).optional(),
  owner: z.string().max(60).optional(),
  retailer: z.string().max(120).optional(),
  priority: z.enum(["baixa", "mitjana", "alta"]).optional(),
  client: z.string().uuid().optional(),
  closed: z.enum(["0", "1"]).optional(),
});

export async function listExpedients(u: U, raw: Record<string, string>) {
  const q = parse(listQuery, raw);
  let query = u.sb.from("crm_expedients").select("*, crm_clients(name,tax_id,city,province), crm_supplies(cups)").order("position").order("created_at", { ascending: false }).limit(800);
  const statuses = (q.status ?? "").split(",").filter((s): s is ExpStatus => (EXP_STATUSES as readonly string[]).includes(s));
  if (statuses.length) query = query.in("status", statuses);
  else if (q.closed !== "1") query = query.or(`status.in.(${OPEN_EXP_STATUSES.join(",")}),status_changed_at.gte.${new Date(Date.now() - 45 * 86_400_000).toISOString()}`);
  if (q.service) query = query.eq("service", q.service);
  if (q.owner === "cap") query = query.is("owner_id", null);
  else if (q.owner && uuid.safeParse(q.owner).success) query = query.eq("owner_id", q.owner);
  if (q.retailer) query = query.ilike("retailer", q.retailer);
  if (q.priority) query = query.eq("priority", q.priority);
  if (q.client) query = query.eq("client_id", q.client);
  const { data, error } = await query;
  if (error) expError(error, "No s'han pogut carregar els expedients");
  let rows = (data ?? []) as (Expedient & { crm_clients: { name: string; tax_id: string | null; city: string | null; province: string | null } | null; crm_supplies: { cups: string } | null })[];
  const s = safeSearch(q.q).toLowerCase();
  if (s) rows = rows.filter((r) => [r.code, r.retailer, r.product, r.external_ref, r.crm_clients?.name, r.crm_clients?.tax_id, r.crm_supplies?.cups].some((x) => x?.toLowerCase().includes(s)));
  const ids = rows.map((r) => r.id);
  const reqs: Pick<Requirement, "expedient_id" | "mandatory" | "status">[] = [];
  for (let i = 0; i < ids.length; i += 200) reqs.push(...(((await u.sb.from("crm_expedient_requirements").select("expedient_id,mandatory,status").in("expedient_id", ids.slice(i, i + 200))).data ?? []) as typeof reqs));
  const n = await names(u);
  const now = Date.now();
  return {
    rows: rows.map(({ crm_clients: c, crm_supplies: sp, ...r }) => {
      const p = docProgress(reqs.filter((x) => x.expedient_id === r.id));
      return { ...r, client_name: c?.name ?? null, client_tax_id: c?.tax_id ?? null, province: c?.province ?? null, cups: sp?.cups ?? null, owner_name: r.owner_id ? n.get(r.owner_id)?.name ?? null : null,
        docs: p, days_in_status: Math.floor((now - new Date(r.status_changed_at).getTime()) / 86_400_000) };
    }),
    isStaff: staffOf(u),
  };
}

export async function dashboard(u: U) {
  const { rows } = await listExpedients(u, { closed: "1" });
  const today = new Date().toISOString().slice(0, 10);
  const recent = rows.filter((r) => OPEN_EXP_STATUSES.includes(r.status) || Date.now() - new Date(r.status_changed_at).getTime() < 90 * 86_400_000);
  const sigs = recent.length ? ((await u.sb.from("crm_signature_requests").select("id,expedient_id,status,sent_at,provider").in("expedient_id", recent.map((r) => r.id).slice(0, 500)).in("status", ["preparada", "pendent_configuracio", "enviada", "oberta"])).data ?? []) : [];
  const pick = (r: (typeof rows)[number]) => ({ id: r.id, code: r.code, client_name: r.client_name, retailer: r.retailer, service: r.service, status: r.status, owner_name: r.owner_name, days_in_status: r.days_in_status, docs: r.docs, expected_activation_date: r.expected_activation_date, next_action: r.next_action, priority: r.priority });
  return {
    kpis: contractingKpis(recent.map((r) => ({ ...r, docs_pending: OPEN_EXP_STATUSES.includes(r.status) ? r.docs.pending : 0 }))),
    docsPending: recent.filter((r) => r.status === "pendent_documentacio" || (OPEN_EXP_STATUSES.includes(r.status) && r.docs.rejected > 0)).map(pick).slice(0, 12),
    signaturePending: recent.filter((r) => r.status === "pendent_signatura").map((r) => ({ ...pick(r), signature: sigs.find((s) => s.expedient_id === r.id)?.status ?? null })).slice(0, 12),
    readyToSend: recent.filter((r) => r.status === "signat").map(pick).slice(0, 12),
    overdue: recent.filter((r) => ["enviat", "en_tramitacio"].includes(r.status) && r.expected_activation_date && r.expected_activation_date < today).map(pick).slice(0, 12),
    incidents: recent.filter((r) => r.status === "incidencia").map(pick).slice(0, 12),
    activated: recent.filter((r) => r.status === "activat").sort((a, b) => (b.activated_at ?? "").localeCompare(a.activated_at ?? "")).map((r) => ({ ...pick(r), activated_at: r.activated_at })).slice(0, 8),
    unassigned: recent.filter((r) => !r.owner_id && OPEN_EXP_STATUSES.includes(r.status)).length,
    signature: signatureStatus(),
    isStaff: staffOf(u),
  };
}

/* ======================================================================= fitxa */

async function syncDataRequirements(u: U, exp: Expedient, reqs: Requirement[], src: Parameters<typeof dataPresent>[1]) {
  const changes = reqs.filter((r) => r.kind === "dada" && r.data_field && (DATA_FIELDS as readonly string[]).includes(r.data_field) && (r.status === "pendent" || r.status === "aportat"))
    .map((r) => ({ r, next: dataPresent(r.data_field as DataField, src) ? "aportat" : "pendent" }))
    .filter((x) => x.next !== x.r.status);
  for (const c of changes) {
    const { error } = await u.sb.from("crm_expedient_requirements").update({ status: c.next }).eq("id", c.r.id);
    if (!error) c.r.status = c.next as Requirement["status"];
  }
}

export async function getExpedient(u: U, id: string) {
  const e = await load(u, id);
  const [client, contacts, supply, terms, reqs, docs, gen, sigs, events, refs, incidents, tasks, comm, edit, contract, prevContract, opp, n, templates] = await Promise.all([
    u.sb.from("crm_clients").select("id,kind,name,trade_name,tax_id,phone,email,address,postal_code,city,province,contact_name,owner_id,status").eq("id", e.client_id).maybeSingle(),
    u.sb.from("crm_contacts").select("id,name,role,phone,email,is_primary").eq("client_id", e.client_id).order("is_primary", { ascending: false }),
    e.supply_id ? u.sb.from("crm_supplies").select("id,cups,energy_type,address,postal_code,city,province,holder_name,current_retailer,access_tariff,power_kw,annual_kwh,current_contract_id").eq("id", e.supply_id).maybeSingle() : Promise.resolve({ data: null }),
    u.sb.from("crm_expedient_terms").select("*").eq("expedient_id", id).order("version", { ascending: false }),
    u.sb.from("crm_expedient_requirements").select("*").eq("expedient_id", id).order("created_at"),
    u.sb.from("crm_documents").select("id,category,title,original_name,created_at,sensitive,status,version,expedient_id,supply_id").eq("client_id", e.client_id).eq("status", "actiu").order("created_at", { ascending: false }),
    u.sb.from("crm_generated_documents").select("*").eq("expedient_id", id).order("version", { ascending: false }),
    u.sb.from("crm_signature_requests").select("*").eq("expedient_id", id).order("created_at", { ascending: false }),
    u.sb.from("crm_expedient_events").select("*").eq("expedient_id", id).order("at", { ascending: false }).order("id", { ascending: false }).limit(300),
    u.sb.from("crm_expedient_refs").select("*").eq("expedient_id", id).order("created_at"),
    u.sb.from("crm_incidents").select("*").eq("expedient_id", id).order("opened_at", { ascending: false }),
    u.sb.from("crm_tasks").select("*").eq("expedient_id", id).order("status").order("due_at"),
    u.sb.from("crm_commission_records").select("*").eq("expedient_id", id).maybeSingle(),
    canEdit(u, id),
    e.contract_id ? u.sb.from("crm_contracts").select("id,retailer,product,status,start_date,end_date,previous_contract_id").eq("id", e.contract_id).maybeSingle() : Promise.resolve({ data: null }),
    e.previous_contract_id ? u.sb.from("crm_contracts").select("id,retailer,product,status,start_date,end_date").eq("id", e.previous_contract_id).maybeSingle() : Promise.resolve({ data: null }),
    e.opportunity_id ? u.sb.from("crm_opportunities").select("id,title,stage,comparison_id,commission_eur,annual_kwh").eq("id", e.opportunity_id).maybeSingle() : Promise.resolve({ data: null }),
    names(u),
    u.sb.from("crm_doc_templates").select("id,name,description,origin,retailer,services,version,status").eq("status", "autoritzada").order("name"),
  ]);
  if (!client.data) throw new HttpError(404, "Client no trobat");
  const requirements = (reqs.data ?? []) as Requirement[];
  if (edit) await syncDataRequirements(u, e, requirements, { client: client.data, supply: supply.data });
  const sigIds = (sigs.data ?? []).map((s) => s.id);
  const sigEvents = sigIds.length ? ((await u.sb.from("crm_signature_events").select("id,request_id,type,occurred_at,received_at,verified").in("request_id", sigIds).order("received_at", { ascending: false })).data ?? []) : [];
  const nm = (x: string | null) => (x ? n.get(x)?.name ?? null : null);
  const comparisons = e.client_id ? ((await u.sb.from("comparisons").select("id,created_at,status,snapshot,crm_opportunity_id").or(`crm_client_id.eq.${e.client_id}${e.opportunity_id ? `,crm_opportunity_id.eq.${e.opportunity_id}` : ""}`).order("created_at", { ascending: false }).limit(10)).data ?? []) : [];
  return {
    expedient: { ...e, owner_name: nm(e.owner_id), collaborator_name: nm(e.collaborator_id), activation_confirmed_name: nm(e.activation_confirmed_by) },
    client: client.data, contacts: contacts.data ?? [], supply: supply.data,
    terms: terms.data ?? [], requirements, documents: docs.data ?? [], generated: gen.data ?? [],
    signatures: (sigs.data ?? []).map((s) => ({ ...s, events: sigEvents.filter((x) => x.request_id === s.id) })),
    events: events.data ?? [], refs: refs.data ?? [], incidents: incidents.data ?? [], tasks: tasks.data ?? [], commission: comm.data ?? null,
    contract: contract.data, previousContract: prevContract.data, opportunity: opp.data,
    templates: (templates.data ?? []).filter((t) => (!t.services?.length || t.services.includes(e.service)) && (!t.retailer || t.retailer.toLowerCase() === e.retailer.toLowerCase())),
    comparisons: comparisons.map((k) => {
      const snap = k.snapshot as { offers?: { id: string; supplierName: string; productName: string; version: number }[]; result?: { ranked?: { offer: { id: string } }[] } } | null;
      return { id: k.id, created_at: k.created_at, status: k.status, offers: (snap?.offers ?? []).map((o) => ({ id: o.id, label: `${o.supplierName} · ${o.productName}`, version: o.version })), best: snap?.result?.ranked?.[0]?.offer.id ?? null };
    }),
    progress: docProgress(requirements),
    permissions: { canEdit: edit, isStaff: staffOf(u), canManage: canManage(u), isAdmin: u.profile.role === "admin" },
    signature: signatureStatus(),
  };
}

/* ======================================================================= creació i condicions */

export async function createExpedient(u: U, raw: unknown, termsRaw?: unknown) {
  const b = parse(expedientInput, raw);
  const staff = staffOf(u);
  const c = await u.sb.from("crm_clients").select("id,kind,owner_id,collaborator_id,name").eq("id", b.client_id).maybeSingle();
  if (!c.data) throw new HttpError(404, "Client no trobat o sense permís");
  if (b.supply_id) {
    const s = await u.sb.from("crm_supplies").select("client_id,archived_at").eq("id", b.supply_id).maybeSingle();
    if (!s.data || s.data.client_id !== b.client_id) throw new HttpError(400, "El subministrament no és d'aquest client");
    if (s.data.archived_at) throw new HttpError(400, "El subministrament està arxivat");
  }
  let comparisonId = b.comparison_id ?? null;
  let previousContract: string | null = null;
  if (b.opportunity_id) {
    const o = await u.sb.from("crm_opportunities").select("id,client_id,stage,comparison_id,renewal_of_contract_id,title").eq("id", b.opportunity_id).maybeSingle();
    if (!o.data) throw new HttpError(404, "Oportunitat no trobada");
    if (o.data.client_id !== b.client_id) throw new HttpError(400, "L'oportunitat no és d'aquest client. Converteix primer el lead en client.");
    if (o.data.stage !== "guanyat") throw new HttpError(400, "Només es pot obrir un expedient d'una oportunitat guanyada (proposta acceptada).");
    const dup = await u.sb.from("crm_expedients").select("code").eq("opportunity_id", b.opportunity_id).neq("status", "rebutjat").limit(1);
    if (dup.data?.length) throw new HttpError(409, `Aquesta oportunitat ja té l'expedient ${dup.data[0].code}`);
    comparisonId = comparisonId ?? o.data.comparison_id ?? null;
    previousContract = o.data.renewal_of_contract_id ?? null;
  }
  const owner = staff ? (b.owner_id ?? c.data.owner_id ?? null) : u.user.id;
  if (!staff && u.profile.role !== "comercial") throw new HttpError(403, "No tens permís per crear expedients");
  await assertRetailerOperational(b.retailer); // Fase 10: no s'obren expedients amb comercialitzadores desactivades o arxivades
  const ins = await u.sb.from("crm_expedients").insert({
    client_id: b.client_id, supply_id: b.supply_id ?? null, opportunity_id: b.opportunity_id ?? null, comparison_id: comparisonId, previous_contract_id: previousContract,
    service: b.service, procedure_type: b.procedure_type, customer_type: customerTypeOf(c.data.kind), retailer: b.retailer, product: b.product ?? null,
    owner_id: owner, collaborator_id: c.data.collaborator_id ?? null, priority: b.priority, expected_signature_date: b.expected_signature_date ?? null,
    expected_activation_date: b.expected_activation_date ?? null, next_action: b.next_action ?? null, internal_notes: b.internal_notes ?? null, created_by: u.user.id,
  }).select("id,code").single();
  if (ins.error) expError(ins.error, "No s'ha pogut crear l'expedient");
  const id = ins.data.id as string;
  const seeded = await u.sb.rpc("crm_expedient_seed_requirements", { p_id: id });
  if (seeded.error) console.warn("[contractacio] requisits no creats:", seeded.error.code);
  if (termsRaw) await captureTerms(u, id, termsRaw);
  await u.sb.from("crm_activities").insert({ client_id: b.client_id, supply_id: b.supply_id ?? null, opportunity_id: b.opportunity_id ?? null, expedient_id: id, type: "canvi", title: `Expedient de contractació ${ins.data.code} obert (${b.retailer})`, user_id: u.user.id, user_name: u.profile.name });
  if (owner && owner !== u.user.id) await notify(owner, { kind: "expedient", title: `${u.profile.name} t'ha assignat l'expedient ${ins.data.code}`, body: c.data.name, link: { view: "expedient", params: { id } }, ruleKey: `exp_assign:${id}:${owner}` });
  return { id, code: ins.data.code as string };
}

export async function captureTerms(u: U, id: string, raw: unknown) {
  const e = await load(u, id);
  const t = parse(termsInput, raw);
  let conditions = t.conditions, retailer = t.retailer ?? e.retailer, product = t.product ?? e.product, annual = t.annual_kwh ?? null, estimated = t.estimated_annual_eur ?? null;
  if (t.source === "comparativa") {
    if (!t.comparison_id) throw new HttpError(400, "Tria la comparativa");
    const k = await u.sb.from("comparisons").select("id,snapshot,status,crm_client_id").eq("id", t.comparison_id).maybeSingle();
    if (!k.data) throw new HttpError(404, "Comparativa no trobada o sense permís");
    if (k.data.crm_client_id && k.data.crm_client_id !== e.client_id) throw new HttpError(400, "La comparativa és d'un altre client");
    const c = conditionsFromOffer(k.data.snapshot as Snap, t.offer_id ?? null);
    if (!c) throw new HttpError(400, "No s'ha trobat l'oferta dins la comparativa");
    ({ conditions, retailer, product, annual_kwh: annual, estimated } = { ...c, annual_kwh: c.annual_kwh, estimated: c.estimated });
  }
  const last = await u.sb.from("crm_expedient_terms").select("version").eq("expedient_id", id).order("version", { ascending: false }).limit(1);
  const version = (last.data?.[0]?.version ?? 0) + 1;
  const record = { source: t.source, comparison_id: t.comparison_id ?? null, retailer, product: product ?? null, service: e.service, conditions, annual_kwh: annual, estimated_annual_eur: estimated, notes: t.notes ?? null };
  const ins = await u.sb.from("crm_expedient_terms").insert({ expedient_id: id, version, ...record, sha256: sha(record), captured_by: u.user.id, captured_by_name: u.profile.name }).select("id").single();
  if (ins.error) expError(ins.error, "No s'han pogut desar les condicions");
  const up = await u.sb.from("crm_expedients").update({ accepted_terms_id: ins.data.id, retailer, product: product ?? null, comparison_id: t.comparison_id ?? e.comparison_id }).eq("id", id).select("id");
  if (up.error) expError(up.error);
  await event(u, id, "condicions", `Condicions acceptades desades (v${version}) · ${retailer}${product ? ` · ${product}` : ""}`, { detail: { version, source: t.source } });
  return { id: ins.data.id as string, version };
}

const updateInput = expedientInput.pick({ product: true, priority: true, expected_signature_date: true, expected_activation_date: true, next_action: true, internal_notes: true, owner_id: true, supply_id: true, procedure_type: true })
  .extend({ next_action_at: z.string().datetime({ offset: true }).nullable().optional() }).partial();

export async function updateExpedient(u: U, id: string, raw: unknown, version?: number) {
  const e = await load(u, id);
  const b = parse(updateInput, raw);
  if (b.owner_id !== undefined && b.owner_id !== e.owner_id && !staffOf(u)) throw new HttpError(403, "Només Administració o Direcció poden canviar el responsable");
  if (b.supply_id && b.supply_id !== e.supply_id) {
    const s = await u.sb.from("crm_supplies").select("client_id").eq("id", b.supply_id).maybeSingle();
    if (s.data?.client_id !== e.client_id) throw new HttpError(400, "El subministrament no és d'aquest client");
  }
  let q = u.sb.from("crm_expedients").update(b).eq("id", id);
  if (version) q = q.eq("version", version);
  const r = await q.select("id,version");
  if (r.error) expError(r.error);
  if (!r.data?.length) throw new HttpError(version ? 409 : 403, version ? "Algú altre ha modificat aquest expedient. Recarrega'l." : "No tens permís per modificar aquest expedient");
  if (b.owner_id && b.owner_id !== e.owner_id) await notify(b.owner_id, { kind: "expedient", title: `T'han assignat l'expedient ${e.code}`, link: { view: "expedient", params: { id } }, ruleKey: `exp_assign:${id}:${b.owner_id}` });
  if (b.supply_id !== undefined && b.supply_id !== e.supply_id) {
    await u.sb.rpc("crm_expedient_seed_requirements", { p_id: id });
    await event(u, id, "nota", "Subministrament (CUPS) associat a l'expedient");
  }
  return { ok: true, version: r.data[0].version as number };
}

/* ======================================================================= documentació */

const reqAction = z.object({
  id: uuid,
  action: z.enum(["attach", "status", "add"]),
  documentId: uuid.nullable().optional(),
  status: z.enum(["pendent", "aportat", "validat", "rebutjat", "no_aplica"]).optional(),
  reason: z.string().trim().max(500).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  mandatory: z.boolean().optional(),
});

export async function requirementAction(u: U, expedientId: string, raw: unknown) {
  const e = await load(u, expedientId);
  const b = parse(reqAction, raw);
  if (b.action === "add") {
    if (!staffOf(u)) throw new HttpError(403, "Només Administració pot afegir requisits a un expedient");
    const r = await u.sb.from("crm_expedient_requirements").insert({ expedient_id: e.id, name: b.name ?? "Requisit", kind: "manual", mandatory: b.mandatory ?? true }).select("id");
    if (r.error) expError(r.error);
    await event(u, e.id, "requisit", `Requisit afegit: ${b.name}`);
    return { ok: true };
  }
  const cur = (await u.sb.from("crm_expedient_requirements").select("*").eq("id", b.id).eq("expedient_id", e.id).maybeSingle()).data as Requirement | null;
  if (!cur) throw new HttpError(404, "Requisit no trobat");
  let patch: Record<string, unknown>;
  let title: string;
  if (b.action === "attach") {
    if (!b.documentId) {
      patch = { document_id: null, status: "pendent" };
      title = `Document desvinculat: ${cur.name}`;
    } else {
      const d = await u.sb.from("crm_documents").select("id,client_id,category,title").eq("id", b.documentId).maybeSingle();
      if (!d.data || d.data.client_id !== e.client_id) throw new HttpError(400, "El document no és d'aquest client o no tens permís per veure'l");
      patch = { document_id: b.documentId, status: "aportat", reject_reason: null };
      title = `Document aportat: ${cur.name} (${d.data.title})`;
    }
  } else {
    if (!b.status) throw new HttpError(400, "Indica l'estat");
    if ((b.status === "validat" || b.status === "rebutjat") && !staffOf(u)) throw new HttpError(403, "Només Administració pot validar o rebutjar documentació");
    if (b.status === "aportat" && cur.kind === "document" && !cur.document_id) throw new HttpError(400, "Adjunta o tria primer el document");
    if (b.status === "rebutjat" && !b.reason) throw new HttpError(400, "Indica per què es rebutja");
    patch = { status: b.status, reject_reason: b.status === "rebutjat" ? b.reason : null, note: b.status === "no_aplica" ? b.reason ?? null : cur.note };
    title = `${cur.name}: ${{ pendent: "pendent", aportat: "aportat", validat: "validat", rebutjat: "rebutjat", no_aplica: "no s'aplica" }[b.status]}`;
  }
  const r = await u.sb.from("crm_expedient_requirements").update(patch).eq("id", cur.id).select("id");
  if (r.error) expError(r.error);
  if (!r.data?.length) throw new HttpError(403, "No tens permís per modificar la documentació d'aquest expedient");
  await event(u, e.id, "requisit", title, { justification: b.status === "rebutjat" || b.status === "no_aplica" ? b.reason ?? null : null });
  if (b.status === "rebutjat" && e.owner_id && e.owner_id !== u.user.id) await notify(e.owner_id, { kind: "expedient", title: `Document rebutjat a ${e.code}: ${cur.name}`, body: b.reason ?? null, link: { view: "expedient", params: { id: e.id } }, ruleKey: `exp_reqrej:${cur.id}:${Date.now()}` });
  return { ok: true };
}

/* ======================================================================= estat i tramitació */

export async function moveExpedient(u: U, id: string, raw: unknown) {
  const e = await load(u, id);
  const b = parse(moveExpInput, raw);
  if (b.version !== e.version) throw new HttpError(409, "Algú altre ha modificat aquest expedient. S'ha recarregat l'estat actual.");
  if (b.status === "activat") throw new HttpError(400, "L'activació es registra amb el formulari d'activació (data real, origen i referència).");
  const staff = staffOf(u);
  const sentAt = b.sent_at ? (b.sent_at.length === 10 ? `${b.sent_at}T12:00:00Z` : b.sent_at) : e.sent_at;
  const patch: Record<string, unknown> = { status: b.status, status_note: b.note ?? null };
  if (b.position !== undefined) patch.position = b.position;
  if (b.status === "enviat") Object.assign(patch, { sent_at: sentAt, sent_to: b.sent_to ?? e.sent_to ?? e.retailer, external_ref: b.external_ref ?? e.external_ref });
  if (b.status === "rebutjat") patch.rejection_reason = b.rejection_reason ?? e.rejection_reason;
  const [reqs, signed] = await Promise.all([
    u.sb.from("crm_expedient_requirements").select("mandatory,status").eq("expedient_id", id),
    u.sb.from("crm_signature_requests").select("id").eq("expedient_id", id).eq("status", "signada").limit(1),
  ]);
  const why = checkMove(b.status, {
    staff, requirements: (reqs.data ?? []) as Requirement[], signed: !!signed.data?.length, note: b.note,
    exp: { ...e, sent_at: (patch.sent_at as string | undefined) ?? e.sent_at, sent_to: (patch.sent_to as string | undefined) ?? e.sent_to, rejection_reason: (patch.rejection_reason as string | undefined) ?? e.rejection_reason },
  });
  if (why) throw new HttpError(400, why);
  const r = await u.sb.from("crm_expedients").update(patch).eq("id", id).eq("version", b.version).select("id,version,status");
  if (r.error) expError(r.error);
  if (!r.data?.length) throw new HttpError(409, "Algú altre ha modificat aquest expedient. S'ha recarregat l'estat actual.");
  if (b.status === "enviat" && b.external_ref) await u.sb.from("crm_expedient_refs").insert({ expedient_id: id, system: "comercialitzadora", ref: b.external_ref, label: "Referència d'enviament", created_by: u.user.id });
  if (b.status === "incidencia") {
    await u.sb.from("crm_incidents").insert({ client_id: e.client_id, supply_id: e.supply_id, expedient_id: id, kind: "incidencia", category: "alta/canvi", title: `${e.code}: ${b.note}`.slice(0, 200), status: "oberta", priority: "alta", assigned_to: e.owner_id, created_by: u.user.id });
  }
  if (b.status === "rebutjat") {
    const { runAutomations } = await import("./automations");
    await runAutomations("event", { onlyRules: ["exp_rebuig"] }).catch(() => null);
  }
  await auditEvent(u, { clientId: e.client_id, entity: "expedients", entityId: id, action: "status", detail: { from: e.status, to: b.status } });
  return { id, version: r.data[0].version as number, status: r.data[0].status as ExpStatus };
}

export async function activateExpedient(u: U, id: string, raw: unknown) {
  if (!staffOf(u)) throw new HttpError(403, "Només Administració pot confirmar activacions");
  const e = await load(u, id);
  const b = parse(activationInput, raw);
  if (b.activated_at > new Date().toISOString().slice(0, 10)) throw new HttpError(400, "La data d'activació no pot ser futura: registra-la quan sigui efectiva.");
  const r = await u.sb.rpc("crm_activate_expedient", { p_id: id, p_activated_at: b.activated_at, p_start: b.start_date, p_end: b.end_date ?? null, p_source: b.source, p_ref: b.ref ?? null, p_note: b.note ?? null });
  if (r.error) expError(r.error, "No s'ha pogut registrar l'activació");
  const contractId = r.data as string;
  // vincle amb el contracte de l'Excel (si n'hi ha) perquè no es dupliquin targetes al Kanban de renovacions
  const s = e.supply_id ? (await u.sb.from("crm_supplies").select("cups").eq("id", e.supply_id).maybeSingle()).data : null;
  const legacy = await legacyFor(s?.cups ?? null);
  if (legacy) await adminClient().from("crm_contracts").update({ legacy_contract_id: legacy }).eq("id", contractId);
  await publishToRenewals(contractId);
  // matriu comercial (Nufri): nivell, marge BOE, preus i comissió prevista queden vinculats al contracte (congelats)
  await import("./finance").then((f) => f.linkCommercialToContract(contractId, id, u.user.id)).catch((err) => console.warn("[contractacio] configuració comercial no vinculada:", err instanceof Error ? err.message : err));
  const after = await load(u, id);
  if (after.previous_contract_id) await publishToRenewals(after.previous_contract_id);
  await u.sb.from("crm_activities").insert({ client_id: e.client_id, supply_id: e.supply_id, contract_id: contractId, expedient_id: id, type: "canvi", title: `Contracte activat: ${e.retailer}${e.product ? ` · ${e.product}` : ""} (${e.code})`, user_id: u.user.id, user_name: u.profile.name });
  let renewalId: string | null = null;
  if (b.create_renewal) renewalId = (await createRenewal(u, id)).id;
  const { runAutomations } = await import("./automations");
  await runAutomations("event", { onlyRules: ["exp_activat", "preparar_renovacio"] }).catch(() => null);
  return { contractId, renewalOpportunityId: renewalId, publishedToRenewals: !!b.end_date && !legacy };
}

/** Oportunitat de renovació a partir del contracte activat (el contracte històric no es modifica). */
export async function createRenewal(u: U, id: string) {
  const e = await load(u, id);
  if (!e.contract_id) throw new HttpError(400, "Encara no hi ha cap contracte activat en aquest expedient");
  const exists = await u.sb.from("crm_opportunities").select("id").eq("renewal_of_contract_id", e.contract_id).limit(1);
  if (exists.data?.length) return { id: exists.data[0].id as string, existed: true };
  const k = (await u.sb.from("crm_contracts").select("end_date,retailer").eq("id", e.contract_id).maybeSingle()).data;
  const close = k?.end_date ? new Date(new Date(k.end_date).getTime() - 30 * 86_400_000).toISOString().slice(0, 10) : null;
  const ins = await u.sb.from("crm_opportunities").insert({
    client_id: e.client_id, supply_id: e.supply_id, title: `Renovació · ${e.retailer}${e.product ? ` · ${e.product}` : ""}`, service: e.service, owner_id: e.owner_id ?? (u.profile.role === "comercial" ? u.user.id : null),
    stage: "nou_lead", priority: "mitjana", expected_close: close, next_action: k?.end_date ? `Preparar la renovació abans del ${k.end_date}` : "Preparar la renovació", renewal_of_contract_id: e.contract_id, created_by: u.user.id,
  }).select("id").single();
  if (ins.error) expError(ins.error, "No s'ha pogut crear l'oportunitat de renovació");
  await event(u, id, "renovacio", "Oportunitat de renovació creada", { detail: { opportunityId: ins.data.id } });
  return { id: ins.data.id as string, existed: false };
}

export async function addReference(u: U, id: string, raw: unknown) {
  const e = await load(u, id);
  const b = parse(z.object({ system: z.enum(["comercialitzadora", "distribuidora", "signatura", "portal", "altres"]), ref: z.string().trim().min(1).max(120), label: z.string().trim().max(120).optional() }), raw);
  const r = await u.sb.from("crm_expedient_refs").insert({ expedient_id: e.id, system: b.system, ref: b.ref, label: b.label || null, created_by: u.user.id }).select("id");
  if (r.error) expError(r.error);
  await event(u, e.id, "referencia", `Referència externa (${b.system}): ${b.ref}`);
  return { ok: true };
}

export async function addNote(u: U, id: string, raw: unknown) {
  const e = await load(u, id);
  const b = parse(z.object({ text: z.string().trim().min(1).max(2000), kind: z.enum(["nota", "enviament"]).default("nota") }), raw);
  await event(u, e.id, b.kind, b.text.slice(0, 200), { detail: b.text.length > 200 ? { text: b.text } : null });
  return { ok: true };
}

export async function addIncident(u: U, id: string, raw: unknown) {
  const e = await load(u, id);
  const b = parse(z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional(), priority: z.enum(["baixa", "mitjana", "alta"]).default("alta"), external_ref: z.string().trim().max(120).optional() }), raw);
  const r = await u.sb.from("crm_incidents").insert({ client_id: e.client_id, supply_id: e.supply_id, expedient_id: e.id, kind: "incidencia", category: "alta/canvi", title: b.title, description: b.description || null, priority: b.priority, external_ref: b.external_ref || null, status: "oberta", assigned_to: e.owner_id, created_by: u.user.id }).select("id").single();
  if (r.error) expError(r.error);
  await event(u, e.id, "incidencia", `Incidència registrada: ${b.title}`, { detail: { incidentId: r.data.id } });
  return { id: r.data.id as string };
}

const commissionInput = z.object({
  estimated_eur: z.number().finite().min(0).nullable().optional(),
  accrual_status: z.enum(["pendent", "meritada", "anullada", "no_aplica"]).optional(),
  payment_status: z.enum(["pendent", "cobrada", "parcial", "impagada", "no_aplica"]).optional(),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paid_eur: z.number().finite().min(0).nullable().optional(),
  retailer_ref: z.string().trim().max(120).nullable().optional(),
  settlement_ref: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export async function updateCommission(u: U, id: string, raw: unknown) {
  if (!staffOf(u)) throw new HttpError(403, "Només Administració o Direcció poden modificar les dades de comissió");
  const e = await load(u, id);
  const b = parse(commissionInput, raw);
  const r = await u.sb.from("crm_commission_records").update(b).eq("expedient_id", e.id).select("id");
  if (r.error) expError(r.error);
  if (!r.data?.length) throw new HttpError(404, "Registre de comissió no trobat");
  await event(u, e.id, "comissio", "Dades de comissió actualitzades", { detail: { fields: Object.keys(b) } });
  return { ok: true };
}

/* ======================================================================= plantilles i documents generats */

const templateInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  origin: z.enum(["intern", "comercialitzadora"]),
  retailer: z.string().trim().max(120).nullable().optional(),
  services: z.array(z.enum(SERVICES)).max(6).default([]),
  body: z.string().min(1).max(60000),
  source_note: z.string().trim().max(500).nullable().optional(),
}).refine((t) => t.origin === "intern" || !!t.source_note, { message: "Indica d'on prové el model de la comercialitzadora (qui el facilita i quan)", path: ["source_note"] });

export async function listTemplates(u: U) {
  const r = await u.sb.from("crm_doc_templates").select("*").order("status").order("name");
  if (r.error) expError(r.error);
  return { templates: r.data ?? [], canManage: canManage(u), isAdmin: u.profile.role === "admin" };
}
export async function saveTemplate(u: U, raw: unknown, id?: string) {
  if (!canManage(u)) throw new HttpError(403, "Només Direcció o la cap d'Administració gestionen les plantilles");
  const b = parse(templateInput, raw);
  const { unknown } = templateVariables(b.body);
  if (unknown.length) throw new HttpError(400, `Variables desconegudes a la plantilla: ${unknown.map((x) => `{{${x}}}`).join(", ")}`);
  const row = { ...b, retailer: b.retailer || null, description: b.description || null, source_note: b.source_note || null };
  const r = id ? await u.sb.from("crm_doc_templates").update(row).eq("id", id).select("id,version,status").single() : await u.sb.from("crm_doc_templates").insert({ ...row, created_by: u.user.id }).select("id,version,status").single();
  if (r.error) expError(r.error);
  return r.data;
}
export async function setTemplateStatus(u: U, id: string, status: "autoritzada" | "retirada" | "esborrany") {
  if (status === "autoritzada" && u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot autoritzar plantilles");
  if (!canManage(u)) throw new HttpError(403, "Sense permís");
  const r = await u.sb.from("crm_doc_templates").update({ status }).eq("id", id).select("id,status,version");
  if (r.error) expError(r.error);
  if (!r.data?.length) throw new HttpError(404, "Plantilla no trobada");
  return r.data[0];
}

async function templateVars(u: U, e: Expedient) {
  const [c, s, terms, owner] = await Promise.all([
    u.sb.from("crm_clients").select("*").eq("id", e.client_id).single(),
    e.supply_id ? u.sb.from("crm_supplies").select("*").eq("id", e.supply_id).maybeSingle() : Promise.resolve({ data: null }),
    e.accepted_terms_id ? u.sb.from("crm_expedient_terms").select("*").eq("id", e.accepted_terms_id).maybeSingle() : Promise.resolve({ data: null }),
    e.owner_id ? u.sb.from("profiles").select("name,code,email").eq("id", e.owner_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cl = c.data!;
  const sp = s.data as { cups: string; address: string | null; postal_code: string | null; city: string | null; holder_name: string | null; access_tariff: string | null; power_kw: (number | null)[] | null; annual_kwh: number | null } | null;
  const t = terms.data as { conditions: Conditions; annual_kwh: number | null; estimated_annual_eur: number | null; retailer: string; product: string | null; captured_at: string; version: number; id: string } | null;
  const nf = (n: number | null | undefined, d = 0) => (n == null ? null : n.toLocaleString("ca-ES", { maximumFractionDigits: d }));
  const vars: Record<string, string | null> = {
    "client.nom": cl.name, "client.nif": cl.tax_id, "client.tipus": CLIENT_KIND_LABEL[cl.kind as ClientKind] ?? null, "client.adreca": cl.address, "client.cp": cl.postal_code,
    "client.poblacio": cl.city, "client.provincia": cl.province, "client.telefon": cl.phone, "client.email": cl.email, "client.contacte": cl.contact_name,
    "subministrament.cups": sp?.cups ?? null, "subministrament.adreca": sp ? [sp.address, sp.postal_code, sp.city].filter(Boolean).join(", ") || null : null,
    "subministrament.titular": sp?.holder_name ?? null, "subministrament.tarifa": sp?.access_tariff ?? null,
    "subministrament.potencies": sp?.power_kw?.length ? sp.power_kw.map((p, i) => (p == null ? null : `P${i + 1} ${nf(p, 3)}`)).filter(Boolean).join(" · ") : null,
    "subministrament.consum": nf(sp?.annual_kwh ?? t?.annual_kwh ?? null),
    "expedient.codi": e.code, "expedient.servei": serviceLabel(e.service), "expedient.tramit": PROCEDURE_LABEL[e.procedure_type],
    "producte.nom": t?.product ?? e.product, "producte.comercialitzadora": t?.retailer ?? e.retailer,
    "condicions.text": t?.conditions.text ?? null,
    "condicions.permanencia": t?.conditions.permanence_months != null ? (t.conditions.permanence_months ? `${t.conditions.permanence_months} mesos` : "Sense permanència") : null,
    "condicions.import_estimat": t?.estimated_annual_eur != null ? `${nf(t.estimated_annual_eur, 2)} €/any (estimació)` : null,
    "condicions.data_acceptacio": t ? new Date(t.captured_at).toLocaleDateString("ca-ES") : null,
    "comercial.nom": owner.data?.name ?? null, "comercial.codi": owner.data?.code ?? null, "comercial.email": owner.data?.email ?? null,
    "data.generacio": new Date().toLocaleDateString("ca-ES", { timeZone: "Europe/Madrid" }),
  };
  return { vars, table: t ? conditionsRows(t.conditions, { annual_kwh: t.annual_kwh, estimated_annual_eur: t.estimated_annual_eur }) : [], termsId: t?.id ?? null, supply: sp };
}

export async function generateDocument(u: U, id: string, templateId: string) {
  const e = await load(u, id);
  if (!(await canEdit(u, id))) throw new HttpError(403, "No tens permís per generar documents en aquest expedient");
  const t = (await u.sb.from("crm_doc_templates").select("*").eq("id", templateId).maybeSingle()).data;
  if (!t) throw new HttpError(404, "Plantilla no trobada");
  if (t.status !== "autoritzada") throw new HttpError(400, "Aquesta plantilla no està autoritzada. Només es poden fer servir plantilles facilitades o autoritzades per Direcció.");
  if (t.services?.length && !t.services.includes(e.service)) throw new HttpError(400, "La plantilla no és per a aquest servei");
  const { vars, table, termsId } = await templateVars(u, e);
  const out = renderTemplate(t.body, vars, table);
  if (!out.ok) {
    const { VAR_LABEL } = await import("@/core/contracting");
    throw new HttpError(400, `Falten dades per generar el document: ${out.missing.map((k) => VAR_LABEL[k] ?? k).join(", ")}${out.unknown.length ? ` · variables desconegudes: ${out.unknown.join(", ")}` : ""}`);
  }
  const last = await u.sb.from("crm_generated_documents").select("version").eq("expedient_id", id).order("version", { ascending: false }).limit(1);
  const version = (last.data?.[0]?.version ?? 0) + 1;
  const now = new Date();
  const pdf = buildContractPdf(out.blocks, { title: `${t.name} · ${e.code}`, code: e.code, templateName: t.name, templateVersion: t.version, generatedAt: now, generatedBy: u.profile.name, documentVersion: version, origin: t.origin });
  const doc = await storeServerPdf(u, { clientId: e.client_id, supplyId: e.supply_id, expedientId: id, bytes: pdf, category: "contracte", fileName: `${e.code}-${t.name}-v${version}.pdf`, title: `${t.name} · ${e.code} · v${version}` });
  const ins = await u.sb.from("crm_generated_documents").insert({ expedient_id: id, template_id: t.id, template_version: t.version, terms_id: termsId, document_id: doc.id, version, data_sha256: sha({ vars, table }), generated_by: u.user.id, generated_by_name: u.profile.name }).select("id").single();
  if (ins.error) expError(ins.error, "No s'ha pogut registrar el document generat");
  await u.sb.from("crm_generated_documents").update({ status: "substituit" }).eq("expedient_id", id).eq("template_id", t.id).in("status", ["generat", "acceptat"]).neq("id", ins.data.id);
  await event(u, id, "document", `Document generat: ${t.name} (v${version}, plantilla v${t.version})`, { detail: { generatedId: ins.data.id, documentId: doc.id } });
  return { id: ins.data.id as string, documentId: doc.id, version };
}

export async function markGenerated(u: U, id: string, genId: string, status: "acceptat" | "anullat") {
  await load(u, id);
  const r = await u.sb.from("crm_generated_documents").update(status === "acceptat" ? { status, accepted_by: u.user.id, accepted_at: new Date().toISOString() } : { status }).eq("id", genId).eq("expedient_id", id).select("id,version");
  if (r.error) expError(r.error);
  if (!r.data?.length) throw new HttpError(403, "Sense permís");
  await event(u, id, "document", `Document v${r.data[0].version} ${status === "acceptat" ? "revisat i acceptat per enviar" : "anul·lat"}`);
  return { ok: true };
}

/* ======================================================================= signatura */

const signerSchema = z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().toLowerCase().email("Correu del signant no vàlid"), phone: z.string().trim().max(30).nullable().optional() });

export async function prepareSignature(u: U, id: string, raw: unknown) {
  await load(u, id);
  const b = parse(z.object({ generatedId: uuid, signers: z.array(signerSchema).min(1).max(5) }), raw);
  const g = await u.sb.from("crm_generated_documents").select("id,status,document_id").eq("id", b.generatedId).eq("expedient_id", id).maybeSingle();
  if (!g.data) throw new HttpError(404, "Document generat no trobat");
  if (["substituit", "anullat"].includes(g.data.status)) throw new HttpError(400, "Aquest document ja no és vigent. Genera'n o tria'n un de vigent.");
  const p = signatureProvider();
  const st = signatureStatus();
  const ins = await u.sb.from("crm_signature_requests").insert({ expedient_id: id, generated_document_id: g.data.id, provider: p?.id ?? "pendent", status: st.configured ? "preparada" : "pendent_configuracio", signers: b.signers, created_by: u.user.id }).select("id").single();
  if (ins.error) expError(ins.error);
  await event(u, id, "signatura", `Sol·licitud de signatura preparada (${b.signers.map((s) => s.name).join(", ")})${st.configured ? "" : " · integració de signatura pendent de configurar"}`);
  return { id: ins.data.id as string, configured: st.configured, missing: st.missing };
}

export async function sendSignature(u: U, id: string, requestId: string) {
  const e = await load(u, id);
  if (!(await canEdit(u, id))) throw new HttpError(403, "Sense permís");
  const st = signatureStatus();
  const p = signatureProvider();
  if (!st.configured || !p) throw new HttpError(409, `La integració de signatura electrònica no està configurada (falta: ${st.missing.join(", ")}). No s'ha enviat res.`);
  const s = (await u.sb.from("crm_signature_requests").select("*").eq("id", requestId).eq("expedient_id", id).maybeSingle()).data;
  if (!s) throw new HttpError(404, "Sol·licitud no trobada");
  if (!["preparada", "pendent_configuracio", "error"].includes(s.status)) throw new HttpError(409, "Aquesta sol·licitud ja s'ha enviat");
  const g = (await u.sb.from("crm_generated_documents").select("document_id,version").eq("id", s.generated_document_id).maybeSingle()).data;
  const d = g ? (await u.sb.from("crm_documents").select("storage_path,original_name").eq("id", g.document_id).maybeSingle()).data : null;
  if (!d) throw new HttpError(404, "No s'ha trobat el document per signar");
  const bytes = await documentBytes(d.storage_path);
  const admin = adminClient();
  try {
    const res = await p.create({ pdf: bytes, fileName: d.original_name, signers: s.signers, subject: `Documentació per signar · ${e.code}`, message: "Assessoria 3.0 us envia la documentació de contractació per signar electrònicament.", eventsUrl: eventsUrlFor(p.id, s.id), expireDays: 15 });
    await admin.from("crm_signature_requests").update({ provider: p.id, provider_request_id: res.providerRequestId, status: "enviada", sent_at: new Date().toISOString(), error: null }).eq("id", s.id);
  } catch (err) {
    await admin.from("crm_signature_requests").update({ status: "error", error: String(err instanceof Error ? err.message : err).slice(0, 300) }).eq("id", s.id);
    throw new HttpError(502, "El proveïdor de signatura no ha acceptat la sol·licitud. Revisa la configuració i torna-ho a provar.");
  }
  await u.sb.from("crm_generated_documents").update({ status: "enviat_signatura" }).eq("id", s.generated_document_id);
  if (e.status === "documentacio_completa") await u.sb.from("crm_expedients").update({ status: "pendent_signatura" }).eq("id", id);
  await event(u, id, "signatura", `Enviat a signar amb ${p.label}`);
  return { ok: true };
}
const eventsUrlFor = (provider: string, requestId: string) => eventsUrl(provider, requestId);

/** Consulta l'estat al proveïdor i aplica el resultat (també ho fa el webhook). */
export async function refreshSignature(u: U, id: string, requestId: string) {
  await load(u, id);
  const s = (await u.sb.from("crm_signature_requests").select("id").eq("id", requestId).eq("expedient_id", id).maybeSingle()).data;
  if (!s) throw new HttpError(404, "Sol·licitud no trobada");
  return applyProviderState(requestId, { type: "consulta_manual", eventId: `manual:${requestId}:${Date.now()}`, occurredAt: null }, null);
}

/**
 * Aplica l'estat REAL consultat al proveïdor (servidor, client de servei). Si està signada, descarrega el document
 * signat i les evidències al gestor documental i mou l'expedient a «Signat».
 */
export async function applyProviderState(requestId: string, ev: { type: string; eventId: string; occurredAt: string | null }, payloadSha: string | null) {
  const admin = adminClient();
  const s = (await admin.from("crm_signature_requests").select("*").eq("id", requestId).maybeSingle()).data;
  if (!s || !s.provider_request_id) throw new HttpError(404, "Sol·licitud no trobada");
  const p = providerById(s.provider);
  if (!p || p.missing().length) throw new HttpError(409, "Proveïdor de signatura no configurat");
  const logged = await admin.from("crm_signature_events").insert({ request_id: s.id, provider: s.provider, provider_event_id: ev.eventId, type: ev.type, occurred_at: ev.occurredAt, payload_sha256: payloadSha, verified: false }).select("id").single();
  if (logged.error?.code === "23505") return { duplicate: true };
  const state = await p.state(s.provider_request_id);
  if (logged.data) await admin.from("crm_signature_events").insert({ request_id: s.id, provider: s.provider, provider_event_id: `${ev.eventId}:verificat`, type: `estat_${state.status}`, occurred_at: new Date().toISOString(), verified: true, detail: state.detail });
  if (state.status === s.status || s.status === "signada") return { status: s.status };
  const e = (await admin.from("crm_expedients").select("*").eq("id", s.expedient_id).single()).data as Expedient;
  const patch: Record<string, unknown> = { status: state.status, last_event_at: new Date().toISOString() };
  if (state.status === "signada") {
    const docId = state.documentIds[0];
    const signed = await p.signedPdf(s.provider_request_id, docId);
    const sd = await storeServerPdf(null, { clientId: e.client_id, supplyId: e.supply_id, expedientId: e.id, bytes: signed, category: "contracte_signat", fileName: `${e.code}-signat.pdf`, title: `Contracte signat · ${e.code}`, byName: `Signatura electrònica (${p.label})` });
    let evidenceId: string | null = null;
    try {
      const ev2 = await p.evidence(s.provider_request_id, docId);
      evidenceId = (await storeServerPdf(null, { clientId: e.client_id, expedientId: e.id, bytes: ev2, category: "altres", fileName: `${e.code}-evidencies-signatura.pdf`, title: `Evidències de signatura · ${e.code}`, byName: `Signatura electrònica (${p.label})` })).id;
    } catch (err) { console.warn("[signatura] evidències no descarregades:", String(err).slice(0, 120)); }
    Object.assign(patch, { completed_at: state.completedAt, signed_document_id: sd.id, evidence_document_id: evidenceId });
    if (s.generated_document_id) await admin.from("crm_generated_documents").update({ status: "signat", signed_document_id: sd.id }).eq("id", s.generated_document_id);
  }
  await admin.from("crm_signature_requests").update(patch).eq("id", s.id);
  await admin.from("crm_expedient_events").insert({ expedient_id: e.id, user_id: null, user_name: `Signatura electrònica (${p.label})`, type: "signatura", title: `Signatura: ${state.status} (verificat amb el proveïdor)`, detail: { requestId: s.id } });
  if (state.status === "signada" && e.status === "pendent_signatura") {
    await admin.from("crm_expedients").update({ status: "signat", status_note: "Signatura confirmada pel proveïdor" }).eq("id", e.id);
  }
  if (e.owner_id) await notify(e.owner_id, { kind: "expedient", title: `${e.code}: signatura ${state.status}`, link: { view: "expedient", params: { id: e.id } }, ruleKey: `exp_sigstate:${s.id}:${state.status}` });
  return { status: state.status };
}

export async function manualSignature(u: U, id: string, raw: unknown) {
  if (!staffOf(u)) throw new HttpError(403, "Només Administració pot registrar una signatura manuscrita");
  const e = await load(u, id);
  const b = parse(z.object({ documentId: uuid, justification: z.string().trim().min(10, "Explica com i quan s'ha signat (mínim 10 caràcters)").max(1000), signer: z.string().trim().min(2).max(160), generatedId: uuid.nullable().optional() }), raw);
  const d = await u.sb.from("crm_documents").select("id,client_id,category").eq("id", b.documentId).maybeSingle();
  if (!d.data || d.data.client_id !== e.client_id) throw new HttpError(400, "El document signat no és d'aquest client");
  if (d.data.category !== "contracte_signat") await u.sb.from("crm_documents").update({ category: "contracte_signat" }).eq("id", b.documentId);
  const ins = await u.sb.from("crm_signature_requests").insert({ expedient_id: id, generated_document_id: b.generatedId ?? null, provider: "manual", status: "signada", signers: [{ name: b.signer }], manual_justification: b.justification, signed_document_id: b.documentId, created_by: u.user.id }).select("id").single();
  if (ins.error) expError(ins.error);
  if (b.generatedId) await u.sb.from("crm_generated_documents").update({ status: "signat", signed_document_id: b.documentId }).eq("id", b.generatedId).eq("expedient_id", id);
  await event(u, id, "signatura", `Signatura manuscrita registrada (${b.signer})`, { justification: b.justification });
  return { id: ins.data.id as string };
}

export async function cancelSignature(u: U, id: string, requestId: string, reason: string) {
  await load(u, id);
  if (!(await canEdit(u, id))) throw new HttpError(403, "Sense permís");
  const s = (await u.sb.from("crm_signature_requests").select("*").eq("id", requestId).eq("expedient_id", id).maybeSingle()).data;
  if (!s) throw new HttpError(404, "Sol·licitud no trobada");
  if (s.status === "signada") throw new HttpError(409, "Una signatura confirmada no es pot cancel·lar");
  const p = providerById(s.provider);
  if (p && s.provider_request_id && ["enviada", "oberta"].includes(s.status)) await p.cancel(s.provider_request_id).catch(() => null);
  const r = await u.sb.from("crm_signature_requests").update({ status: "cancellada" }).eq("id", s.id).select("id");
  if (r.error) expError(r.error);
  await event(u, id, "signatura", "Sol·licitud de signatura cancel·lada", { justification: reason || null });
  return { ok: true };
}

/* ======================================================================= configuració de requisits */

const reqConfigInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  kind: z.enum(["document", "dada", "manual"]),
  doc_category: z.string().max(40).nullable().optional(),
  data_field: z.enum(DATA_FIELDS).nullable().optional(),
  services: z.array(z.enum(SERVICES)).default([]),
  retailers: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  customer_types: z.array(z.enum(["particular", "autonom", "empresa"])).default([]),
  procedure_types: z.array(z.string().max(40)).default([]),
  mandatory: z.boolean().default(true),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(10000).default(100),
});
export async function listRequirementConfig(u: U) {
  const r = await u.sb.from("crm_doc_requirements").select("*").order("sort").order("name");
  if (r.error) expError(r.error);
  return { rows: r.data ?? [], canManage: canManage(u) };
}
export async function saveRequirementConfig(u: U, raw: unknown, id?: string) {
  if (!canManage(u)) throw new HttpError(403, "Només Direcció o la cap d'Administració configuren els requisits");
  const b = parse(reqConfigInput, raw);
  const row = { ...b, doc_category: b.kind === "document" ? b.doc_category ?? "altres" : null, data_field: b.kind === "dada" ? b.data_field ?? null : null, is_example: false, updated_by: u.user.id };
  if (row.kind === "dada" && !row.data_field) throw new HttpError(400, "Tria quina dada de la fitxa s'ha de comprovar");
  const r = id ? await u.sb.from("crm_doc_requirements").update(row).eq("id", id).select("id") : await u.sb.from("crm_doc_requirements").insert(row).select("id");
  if (r.error) expError(r.error);
  return { ok: true };
}
