import "server-only";
import { finStaff, hasPerm } from "./permissions";
/**
 * CRM FASE 2 · gestió comercial (servidor). Totes les dades es llegeixen i s'escriuen amb la sessió de l'usuari
 * (RLS). El client de servei només s'usa per detectar duplicats globals, enviar notificacions internes a altres
 * usuaris i executar les automatitzacions.
 */
import { z } from "zod";
import { activityInput, checkTaxId, normalizeEmail, normalizePhone, safeSearch } from "@/core/crm";
import { CALL_OUTCOMES, LEAD_STATUSES, OPEN_STAGES, SERVICES, STAGES, STAGE_LABEL, STAGE_PROBABILITY, TASK_KINDS, computeKpis, leadInput, moveInput, opportunityInput, type Opportunity, type Stage } from "@/core/sales";
import { adminClient, HttpError } from "./supabase";
import { auditEvent, dbError, isStaffRole, parse, type U } from "./crm";

const uuid = z.string().uuid();
const names = async (u: U) => new Map(((await u.sb.from("profiles").select("id,name")).data ?? []).map((p) => [p.id as string, p.name as string]));

/** Avís intern a un altre usuari (no es pot fer amb la RLS de qui l'envia). */
export async function notify(userId: string | null | undefined, n: { kind: string; title: string; body?: string | null; link?: { view: string; params: Record<string, string> } | null; ruleKey?: string | null }) {
  if (!userId) return;
  const { error } = await adminClient().from("crm_notifications").upsert({ user_id: userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, rule_key: n.ruleKey ?? `manual:${crypto.randomUUID()}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
  if (error) console.warn("[comercial] avís no enviat:", error.code);
}

/* ======================================================================= leads */

const leadList = z.object({ q: z.string().max(100).optional().default(""), status: z.enum(LEAD_STATUSES).optional(), owner: z.string().max(60).optional(), service: z.enum(SERVICES).optional(), page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(10).max(100).default(25) });

export async function listLeads(u: U, raw: Record<string, string>) {
  const q = parse(leadList, raw);
  let query = u.sb.from("crm_leads").select("*", { count: "exact" });
  const s = safeSearch(q.q);
  if (s) query = query.ilike("search", `%${s}%`);
  if (q.status) query = query.eq("status", q.status);
  else query = query.in("status", ["nou", "contactat", "qualificat"]);
  if (q.owner === "cap") query = query.is("owner_id", null);
  else if (q.owner && uuid.safeParse(q.owner).success) query = query.eq("owner_id", q.owner);
  if (q.service) query = query.contains("services", [q.service]);
  const from = (q.page - 1) * q.size;
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, from + q.size - 1);
  if (error) dbError(error, "No s'han pogut carregar els leads");
  const n = await names(u);
  const ids = (data ?? []).map((l) => l.id);
  const opps = ids.length ? (await u.sb.from("crm_opportunities").select("lead_id,stage").in("lead_id", ids)).data ?? [] : [];
  return { rows: (data ?? []).map((l) => ({ ...l, owner_name: l.owner_id ? n.get(l.owner_id) ?? null : null, opportunities: opps.filter((o) => o.lead_id === l.id).length })), total: count ?? 0, page: q.page, size: q.size };
}

export async function getLead(u: U, id: string) {
  if (!uuid.safeParse(id).success) throw new HttpError(404, "Lead no trobat");
  const l = await u.sb.from("crm_leads").select("*").eq("id", id).maybeSingle();
  if (!l.data) throw new HttpError(404, "Aquest lead no existeix o no tens permís per veure'l");
  const [acts, opps, tasks, n, canEdit] = await Promise.all([
    u.sb.from("crm_activities").select("*").eq("lead_id", id).order("at", { ascending: false }).limit(100),
    u.sb.from("crm_opportunities").select("*").eq("lead_id", id).order("created_at"),
    u.sb.from("crm_tasks").select("*").eq("lead_id", id).order("due_at"),
    names(u),
    u.sb.rpc("crm_can_edit_lead", { p_lead: id }),
  ]);
  return { lead: { ...l.data, owner_name: l.data.owner_id ? n.get(l.data.owner_id) ?? null : null }, activities: acts.data ?? [], opportunities: opps.data ?? [], tasks: tasks.data ?? [], canEdit: !!canEdit.data, isStaff: isStaffRole(u.profile.role) };
}

export async function leadAction(u: U, b: { action: string; id?: string; data?: unknown; ownerId?: string | null; reason?: string | null; clientId?: string | null }) {
  const staff = isStaffRole(u.profile.role);
  if (b.action === "create" || b.action === "update") {
    const l = parse(leadInput, b.data);
    if (b.action === "create") {
      const row = {
        ...l,
        // Fase 8.1: el Cap d'equip assigna el lead a un comercial del seu equip (la RLS ho comprova)
        owner_id: staff ? l.owner_id ?? null : u.profile.role === "comercial" ? u.user.id : u.profile.role === "cap_equip" ? l.owner_id ?? u.user.id : null,
        collaborator_id: u.profile.role === "colaborador" ? u.user.id : null,
        created_by: u.user.id,
      };
      const { data, error } = await u.sb.from("crm_leads").insert(row).select("id").single();
      if (error) dbError(error, "No s'ha pogut crear el lead");
      if (row.owner_id && row.owner_id !== u.user.id) await notify(row.owner_id, { kind: "assignacio", title: `T'han assignat un lead: ${l.name}`, link: { view: "leads", params: { id: data.id } } });
      return { id: data.id as string };
    }
    const patch: Record<string, unknown> = { ...l };
    delete patch.owner_id;
    const { data, error } = await u.sb.from("crm_leads").update(patch).eq("id", b.id!).select("id");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquest lead");
    return { id: b.id! };
  }
  if (b.action === "assign") {
    if (!staff) throw new HttpError(403, "Només Administració o Direcció poden assignar leads");
    const { data, error } = await u.sb.from("crm_leads").update({ owner_id: b.ownerId ?? null }).eq("id", b.id!).select("id,name");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(404, "Lead no trobat");
    await u.sb.from("crm_opportunities").update({ owner_id: b.ownerId ?? null }).eq("lead_id", b.id!).is("client_id", null);
    await notify(b.ownerId, { kind: "assignacio", title: `T'han assignat un lead: ${data[0].name}`, link: { view: "leads", params: { id: b.id! } }, ruleKey: `assignacio:lead:${b.id}:${b.ownerId}` });
    return { ok: true };
  }
  if (b.action === "discard" || b.action === "reopen") {
    const { data, error } = await u.sb.from("crm_leads").update(b.action === "discard" ? { status: "descartat", discard_reason: b.reason ?? null } : { status: "contactat", discard_reason: null }).eq("id", b.id!).select("id");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquest lead");
    return { ok: true };
  }
  if (b.action === "convert") return convertLead(u, b.id!, b.clientId ?? null);
  throw new HttpError(400, "Acció no vàlida");
}

/** Possibles clients existents per a un lead (NIF/CIF a tota la base; telèfon i correu entre els que l'usuari veu). */
export async function leadMatches(u: U, id: string) {
  const l = (await u.sb.from("crm_leads").select("tax_id,phone,email,name").eq("id", id).maybeSingle()).data;
  if (!l) throw new HttpError(404, "Lead no trobat");
  const out: { id: string; name: string; reason: string; visible: boolean }[] = [];
  if (l.tax_id) {
    const hit = (await adminClient().from("crm_clients").select("id,name").eq("tax_id", l.tax_id).is("archived_at", null).limit(1)).data?.[0];
    if (hit) {
      const mine = await u.sb.from("crm_clients").select("id").eq("id", hit.id).maybeSingle();
      out.push(mine.data ? { id: hit.id, name: hit.name, reason: "mateix NIF/CIF", visible: true } : { id: "", name: "Client d'un altre usuari", reason: "mateix NIF/CIF", visible: false });
    }
  }
  for (const [field, value, reason] of [["phone", l.phone, "mateix telèfon"], ["email", l.email, "mateix correu"]] as const) {
    if (!value) continue;
    for (const r of (await u.sb.from("crm_clients").select("id,name").eq(field, value).is("archived_at", null).limit(3)).data ?? []) if (!out.some((x) => x.id === r.id)) out.push({ id: r.id, name: r.name, reason, visible: true });
  }
  return { matches: out };
}

/**
 * Converteix un lead en client sense duplicar: si s'indica `clientId` (o el NIF/CIF ja és d'un client visible) s'hi
 * vincula; si no, se'n crea un de nou amb les dades del lead. Les oportunitats i l'activitat del lead passen al client.
 */
export async function convertLead(u: U, id: string, clientId: string | null) {
  const l = (await u.sb.from("crm_leads").select("*").eq("id", id).maybeSingle()).data;
  if (!l) throw new HttpError(404, "Lead no trobat");
  if (l.converted_client_id) return { clientId: l.converted_client_id as string, created: false };
  let target = clientId;
  if (target) {
    const vis = await u.sb.from("crm_clients").select("id").eq("id", target).maybeSingle();
    if (!vis.data) throw new HttpError(403, "No pots vincular el lead a aquest client");
  } else if (l.tax_id) {
    const hit = (await adminClient().from("crm_clients").select("id").eq("tax_id", l.tax_id).is("archived_at", null).limit(1)).data?.[0];
    if (hit) {
      const vis = await u.sb.from("crm_clients").select("id").eq("id", hit.id).maybeSingle();
      if (!vis.data) throw new HttpError(409, "Ja hi ha un client amb aquest NIF/CIF assignat a un altre usuari. Demana a Administració que te'l comparteixi o que faci la conversió.");
      target = hit.id;
    }
  }
  let created = false;
  if (!target) {
    const tax = checkTaxId(l.tax_id);
    const { data, error } = await u.sb.from("crm_clients").insert({
      kind: l.kind, name: l.company && l.kind === "empresa" ? l.company : l.name, trade_name: null, tax_id: tax.valid ? tax.value : null, tax_id_type: tax.valid ? tax.type : null,
      status: "potencial", contact_name: l.contact_name ?? (l.company ? l.name : null), phone: normalizePhone(l.phone).value, email: normalizeEmail(l.email).value,
      address: l.address, postal_code: l.postal_code, city: l.city, province: l.province, notes: l.notes, origin: l.origin,
      owner_id: isStaffRole(u.profile.role) ? l.owner_id : u.profile.role === "comercial" ? u.user.id : null,
      collaborator_id: l.collaborator_id ?? (u.profile.role === "colaborador" ? u.user.id : null), tags: [], priority: "mitjana", created_by: u.user.id,
    }).select("id").single();
    if (error) dbError(error, "No s'ha pogut crear el client");
    target = data.id as string;
    created = true;
  }
  const upd = await u.sb.from("crm_leads").update({ status: "convertit", converted_client_id: target, converted_at: new Date().toISOString() }).eq("id", id).select("id");
  if (upd.error) dbError(upd.error);
  // Les oportunitats i l'historial del lead passen a la fitxa del client (sense copiar dades).
  await u.sb.from("crm_opportunities").update({ client_id: target }).eq("lead_id", id).is("client_id", null);
  await adminClient().from("crm_activities").update({ client_id: target }).eq("lead_id", id).is("client_id", null);
  await adminClient().from("crm_tasks").update({ client_id: target }).eq("lead_id", id).is("client_id", null);
  // Fase 6: les factures captades es copien a la fitxa del client i la comparativa preliminar s'hi vincula
  await import("./capture").then((m) => m.onLeadConverted(id, target)).catch((e) => console.warn("[captació] vincle amb el client:", (e as Error).message?.slice(0, 120)));
  await u.sb.from("crm_activities").insert({ client_id: target, lead_id: id, type: "canvi", title: created ? `Client creat a partir del lead «${l.name}»` : `Lead «${l.name}» vinculat a aquest client`, user_id: u.user.id, user_name: u.profile.name });
  return { clientId: target, created };
}

/* ======================================================================= oportunitats */

const oppList = z.object({ owner: z.string().max(60).optional(), service: z.enum(SERVICES).optional(), province: z.string().max(120).optional(), priority: z.enum(["baixa", "mitjana", "alta"]).optional(), stage: z.enum(STAGES).optional(), q: z.string().max(100).optional(), closedDays: z.coerce.number().int().min(0).max(365).default(30) });

async function withParties(u: U, rows: Opportunity[]) {
  const n = await names(u);
  const cids = [...new Set(rows.map((o) => o.client_id).filter(Boolean))] as string[];
  const lids = [...new Set(rows.filter((o) => !o.client_id).map((o) => o.lead_id).filter(Boolean))] as string[];
  const [cs, ls] = await Promise.all([
    cids.length ? u.sb.from("crm_clients").select("id,name,province").in("id", cids) : Promise.resolve({ data: [] as { id: string; name: string; province: string | null }[] }),
    lids.length ? u.sb.from("crm_leads").select("id,name,company,province").in("id", lids) : Promise.resolve({ data: [] as { id: string; name: string; company: string | null; province: string | null }[] }),
  ]);
  const cm = new Map((cs.data ?? []).map((c) => [c.id, c]));
  const lm = new Map((ls.data ?? []).map((l) => [l.id, l]));
  return rows.map((o) => {
    const c = o.client_id ? cm.get(o.client_id) : null;
    const l = !c && o.lead_id ? lm.get(o.lead_id) : null;
    return { ...o, party_name: c?.name ?? (l ? l.company || l.name : null), party_kind: c ? "client" : "lead", province: o.province ?? c?.province ?? l?.province ?? null, owner_name: o.owner_id ? n.get(o.owner_id) ?? null : null };
  });
}

export async function listOpportunities(u: U, raw: Record<string, string>) {
  const q = parse(oppList, raw);
  const since = new Date(Date.now() - q.closedDays * 86_400_000).toISOString();
  let query = u.sb.from("crm_opportunities").select("*").or(`stage.in.(${OPEN_STAGES.join(",")}),won_at.gte.${since},lost_at.gte.${since}`);
  if (q.owner === "cap") query = query.is("owner_id", null);
  else if (q.owner && uuid.safeParse(q.owner).success) query = query.eq("owner_id", q.owner);
  if (q.service) query = query.eq("service", q.service);
  if (q.priority) query = query.eq("priority", q.priority);
  if (q.stage) query = query.eq("stage", q.stage);
  const { data, error } = await query.order("position").order("updated_at", { ascending: false }).limit(1500);
  if (error) dbError(error, "No s'han pogut carregar les oportunitats");
  let rows = await withParties(u, (data ?? []) as Opportunity[]);
  if (q.province) rows = rows.filter((o) => (o.province ?? "").toLowerCase() === q.province!.toLowerCase());
  const s = safeSearch(q.q ?? "");
  if (s) rows = rows.filter((o) => safeSearch(`${o.title} ${o.party_name ?? ""}`).includes(s));
  return { rows };
}

export async function getOpportunity(u: U, id: string) {
  if (!uuid.safeParse(id).success) throw new HttpError(404, "Oportunitat no trobada");
  const o = (await u.sb.from("crm_opportunities").select("*").eq("id", id).maybeSingle()).data as Opportunity | null;
  if (!o) throw new HttpError(404, "Aquesta oportunitat no existeix o no tens permís per veure-la");
  const [full] = await withParties(u, [o]);
  const [acts, tasks, cmps, supplies, client, lead, contract, canEdit] = await Promise.all([
    u.sb.from("crm_activities").select("*").eq("opportunity_id", id).order("at", { ascending: false }).limit(200),
    u.sb.from("crm_tasks").select("*").eq("opportunity_id", id).order("status").order("due_at"),
    u.sb.from("comparisons").select("id,created_at,status,cups,created_by_name,snapshot").or(`crm_opportunity_id.eq.${id}${o.comparison_id ? `,id.eq.${o.comparison_id}` : ""}`).order("created_at", { ascending: false }),
    o.client_id ? u.sb.from("crm_supplies").select("id,cups,energy_type,access_tariff,annual_kwh,current_retailer,archived_at").eq("client_id", o.client_id) : Promise.resolve({ data: [] }),
    o.client_id ? u.sb.from("crm_clients").select("id,name,tax_id,phone,email,city,status,owner_id").eq("id", o.client_id).maybeSingle() : Promise.resolve({ data: null }),
    o.lead_id ? u.sb.from("crm_leads").select("id,name,company,phone,email,city,status,tax_id").eq("id", o.lead_id).maybeSingle() : Promise.resolve({ data: null }),
    o.contract_id ? u.sb.from("crm_contracts").select("id,retailer,product,status,end_date").eq("id", o.contract_id).maybeSingle() : Promise.resolve({ data: null }),
    u.sb.rpc("crm_can_edit_opportunity", { p_opp: id }),
  ]);
  // expedient de contractació (Fase 3), si la migració 010 és aplicada
  const exp = await u.sb.from("crm_expedients").select("id,code,status").eq("opportunity_id", id).neq("status", "rebutjat").order("created_at", { ascending: false }).limit(1);
  return {
    opportunity: full,
    activities: acts.data ?? [],
    tasks: tasks.data ?? [],
    comparisons: (cmps.data ?? []).map((k) => {
      const snap = k.snapshot as { result?: { ranked?: { saving?: number | null; offer?: { supplierName?: string; productName?: string } }[] } } | null;
      const best = snap?.result?.ranked?.[0];
      return { id: k.id, created_at: k.created_at, status: k.status, cups: k.cups, created_by_name: k.created_by_name, saving: best?.saving ?? null, best: best?.offer ? `${best.offer.supplierName} · ${best.offer.productName}` : null };
    }),
    supplies: (supplies.data ?? []).filter((s: { archived_at: string | null }) => !s.archived_at),
    client: client.data,
    lead: lead.data,
    contract: contract.data,
    expedient: exp.error ? null : exp.data?.[0] ?? null,
    canEdit: !!canEdit.data,
    isStaff: isStaffRole(u.profile.role),
  };
}

export async function oppAction(u: U, b: { action: string; id?: string; data?: unknown; ownerId?: string | null; comparisonId?: string | null; contractId?: string | null; channel?: string | null; note?: string | null }) {
  const staff = isStaffRole(u.profile.role);
  if (b.action === "create") {
    const o = parse(opportunityInput, b.data);
    let province: string | null = null;
    let owner = staff ? o.owner_id ?? null : u.profile.role === "comercial" ? u.user.id : null;
    if (o.lead_id) {
      const l = (await u.sb.from("crm_leads").select("province,owner_id,converted_client_id").eq("id", o.lead_id).maybeSingle()).data;
      if (!l) throw new HttpError(403, "No pots crear oportunitats per a aquest lead");
      province = l.province;
      if (staff && !o.owner_id) owner = l.owner_id;
      if (l.converted_client_id && !o.client_id) o.client_id = l.converted_client_id;
    }
    if (o.client_id) {
      const c = (await u.sb.from("crm_clients").select("province,owner_id").eq("id", o.client_id).maybeSingle()).data;
      if (!c) throw new HttpError(403, "No pots crear oportunitats per a aquest client");
      province = c.province ?? province;
      if (staff && !o.owner_id) owner = c.owner_id;
    }
    const { data, error } = await u.sb.from("crm_opportunities").insert({
      ...o, owner_id: owner, collaborator_id: u.profile.role === "colaborador" ? u.user.id : null, province, probability: o.probability ?? STAGE_PROBABILITY.nou_lead, created_by: u.user.id, position: Date.now() / 1000,
    }).select("id").single();
    if (error) dbError(error, "No s'ha pogut crear l'oportunitat");
    await u.sb.from("crm_activities").insert({ client_id: o.client_id ?? null, lead_id: o.client_id ? null : o.lead_id ?? null, opportunity_id: data.id, type: "canvi", title: `Nova oportunitat: ${o.title}`, user_id: u.user.id, user_name: u.profile.name });
    if (o.lead_id) await u.sb.from("crm_leads").update({ status: "qualificat" }).eq("id", o.lead_id).in("status", ["nou", "contactat"]);
    if (owner && owner !== u.user.id) await notify(owner, { kind: "assignacio", title: `Nova oportunitat assignada: ${o.title}`, link: { view: "oportunitat", params: { id: data.id } }, ruleKey: `assignacio:opp:${data.id}:${owner}` });
    return { id: data.id as string };
  }
  if (!b.id || !uuid.safeParse(b.id).success) throw new HttpError(400, "Falta l'oportunitat");

  if (b.action === "update") {
    const o = parse(opportunityInput, b.data);
    const patch: Record<string, unknown> = { ...o };
    delete patch.lead_id; delete patch.owner_id;
    if (staff && o.owner_id !== undefined) patch.owner_id = o.owner_id;
    const { data, error } = await u.sb.from("crm_opportunities").update(patch).eq("id", b.id).select("id,owner_id,title");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquesta oportunitat");
    return { ok: true };
  }
  if (b.action === "move") {
    const m = parse(moveInput, { ...(b.data as object), id: b.id });
    if (m.stage === "perdut" && !m.lost_reason) throw new HttpError(400, "Indica el motiu de la pèrdua");
    const cur = (await u.sb.from("crm_opportunities").select("stage,version,probability,title,owner_id,client_id,lead_id").eq("id", b.id).maybeSingle()).data;
    if (!cur) throw new HttpError(404, "Oportunitat no trobada");
    if (cur.version !== m.version) throw new HttpError(409, "Algú altre ha modificat aquesta oportunitat. S'ha actualitzat el tauler.");
    const patch: Record<string, unknown> = { stage: m.stage };
    if (m.position != null) patch.position = m.position;
    if (m.stage === "perdut") patch.lost_reason = m.lost_reason;
    // la probabilitat segueix l'etapa si no s'havia ajustat a mà
    if (cur.stage !== m.stage && (cur.probability == null || cur.probability === STAGE_PROBABILITY[cur.stage as Stage])) patch.probability = STAGE_PROBABILITY[m.stage];
    const { data, error } = await u.sb.from("crm_opportunities").update(patch).eq("id", b.id).eq("version", m.version).select("id,version,stage");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(409, "No s'ha pogut moure: algú altre l'ha modificada o no tens permís.");
    if (m.stage === "guanyat" && cur.stage !== "guanyat") {
      const { runAutomations } = await import("./automations");
      await runAutomations("event", { onlyRules: ["proposta_acceptada"] }).catch(() => undefined);
    }
    return { id: b.id, version: data[0].version as number, stage: data[0].stage as Stage };
  }
  if (b.action === "assign") {
    if (!staff) throw new HttpError(403, "Només Administració o Direcció poden reassignar oportunitats");
    const { data, error } = await u.sb.from("crm_opportunities").update({ owner_id: b.ownerId ?? null }).eq("id", b.id).select("title");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(404, "Oportunitat no trobada");
    await notify(b.ownerId, { kind: "assignacio", title: `Nova oportunitat assignada: ${data[0].title}`, link: { view: "oportunitat", params: { id: b.id } }, ruleKey: `assignacio:opp:${b.id}:${b.ownerId}` });
    return { ok: true };
  }
  if (b.action === "link") {
    const patch: Record<string, unknown> = {};
    if (b.comparisonId !== undefined) patch.comparison_id = b.comparisonId;
    if (b.contractId !== undefined) {
      if (b.contractId) {
        const k = await u.sb.from("crm_contracts").select("id").eq("id", b.contractId).maybeSingle();
        if (!k.data) throw new HttpError(403, "Contracte no trobat");
      }
      patch.contract_id = b.contractId;
    }
    const { data, error } = await u.sb.from("crm_opportunities").update(patch).eq("id", b.id).select("id,client_id,lead_id,title");
    if (error) dbError(error);
    if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquesta oportunitat");
    if (b.contractId) await u.sb.from("crm_activities").insert({ client_id: data[0].client_id, lead_id: data[0].client_id ? null : data[0].lead_id, opportunity_id: b.id, contract_id: b.contractId, type: "canvi", title: `Contracte creat a partir de l'oportunitat «${data[0].title}»`, user_id: u.user.id, user_name: u.profile.name });
    return { ok: true };
  }
  if (b.action === "register_sent") {
    // Enviament fet per l'usuari fora de la plataforma: queda com a «registrat a mà», mai com a «enviat» confirmat.
    const o = (await u.sb.from("crm_opportunities").select("stage,version,client_id,lead_id,title").eq("id", b.id).maybeSingle()).data;
    if (!o) throw new HttpError(404, "Oportunitat no trobada");
    const channel = b.channel === "whatsapp" ? "whatsapp" : b.channel === "presencial" ? "reunio" : "email";
    const ins = await u.sb.from("crm_activities").insert({ client_id: o.client_id, lead_id: o.client_id ? null : o.lead_id, opportunity_id: b.id, type: channel, title: `Proposta enviada (${channel === "reunio" ? "en mà" : channel === "whatsapp" ? "WhatsApp" : "correu"})`, body: b.note ?? null, delivery: channel === "reunio" ? null : "registrat", user_id: u.user.id, user_name: u.profile.name });
    if (ins.error) dbError(ins.error);
    if (STAGES.indexOf(o.stage as Stage) < STAGES.indexOf("proposta_enviada")) await u.sb.from("crm_opportunities").update({ stage: "proposta_enviada" }).eq("id", b.id).eq("version", o.version);
    return { ok: true };
  }
  throw new HttpError(400, "Acció no vàlida");
}

/* ======================================================================= activitat i tasques (leads/oportunitats) */

export async function salesActivity(u: U, b: { clientId?: string | null; leadId?: string | null; opportunityId?: string | null; data?: unknown; outcome?: string | null }) {
  const a = parse(activityInput, b.data);
  if (b.outcome && !(CALL_OUTCOMES as readonly string[]).includes(b.outcome)) throw new HttpError(400, "Resultat no vàlid");
  let clientId = b.clientId ?? null, leadId = b.leadId ?? null;
  if (b.opportunityId) {
    const o = (await u.sb.from("crm_opportunities").select("client_id,lead_id").eq("id", b.opportunityId).maybeSingle()).data;
    if (!o) throw new HttpError(404, "Oportunitat no trobada");
    clientId = clientId ?? o.client_id; leadId = clientId ? null : leadId ?? o.lead_id;
  }
  if (!clientId && !leadId) throw new HttpError(400, "L'activitat ha de ser d'un client o d'un lead");
  const { data, error } = await u.sb.from("crm_activities").insert({ ...a, at: a.at ?? new Date().toISOString(), client_id: clientId, lead_id: clientId ? null : leadId, opportunity_id: b.opportunityId ?? null, outcome: b.outcome ?? null, user_id: u.user.id, user_name: u.profile.name }).select("id").single();
  if (error) dbError(error);
  return { id: data.id as string };
}

const salesTask = z.object({
  title: z.string().trim().min(1, "Falta el títol").max(200),
  kind: z.enum(TASK_KINDS).default("seguiment"),
  notes: z.string().trim().max(2000).nullable().optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  duration_min: z.coerce.number().int().min(5).max(600).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
  opportunity_id: z.string().uuid().nullable().optional(),
});

export async function createSalesTask(u: U, raw: unknown) {
  const t = parse(salesTask, raw);
  let clientId = t.client_id ?? null, leadId = t.lead_id ?? null;
  if (t.opportunity_id) {
    const o = (await u.sb.from("crm_opportunities").select("client_id,lead_id").eq("id", t.opportunity_id).maybeSingle()).data;
    if (!o) throw new HttpError(404, "Oportunitat no trobada");
    clientId = clientId ?? o.client_id; leadId = clientId ? null : leadId ?? o.lead_id;
  }
  const assignee = t.assigned_to ?? u.user.id;
  const n = await names(u);
  const { data, error } = await u.sb.from("crm_tasks").insert({ ...t, client_id: clientId, lead_id: leadId, assigned_to: assignee, assigned_name: n.get(assignee) ?? null, created_by: u.user.id, source: "manual" }).select("id").single();
  if (error) dbError(error, "No s'ha pogut crear la tasca");
  if (assignee !== u.user.id) await notify(assignee, { kind: "tasca", title: `${u.profile.name} t'ha assignat una tasca: ${t.title}`, body: t.due_at ? `Venç el ${new Date(t.due_at).toLocaleString("ca-ES")}` : null, link: t.opportunity_id ? { view: "oportunitat", params: { id: t.opportunity_id } } : clientId ? { view: "client", params: { id: clientId, tab: "activitat" } } : { view: "jornada", params: {} }, ruleKey: `tasca:${data.id}` });
  return { id: data.id as string };
}

/* ======================================================================= la meva jornada i agenda */

export async function jornada(u: U) {
  const me = u.user.id;
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [tasks, opps, leads, clients, contracts] = await Promise.all([
    u.sb.from("crm_tasks").select("*").eq("assigned_to", me).eq("status", "pendent").or(`due_at.lte.${in7},due_at.is.null`).order("due_at", { ascending: true, nullsFirst: false }).limit(200),
    u.sb.from("crm_opportunities").select("*").eq("owner_id", me).in("stage", OPEN_STAGES).order("next_action_at", { ascending: true, nullsFirst: false }).limit(300),
    u.sb.from("crm_leads").select("id,name,company,phone,email,status,created_at,first_contact_at,services").eq("owner_id", me).in("status", ["nou", "contactat"]).order("created_at").limit(100),
    u.sb.from("crm_clients").select("id,name,phone,next_follow_up,status").eq("owner_id", me).lte("next_follow_up", today).is("archived_at", null).order("next_follow_up").limit(100),
    u.sb.from("crm_contracts").select("id,client_id,retailer,product,end_date,status,crm_clients(name,owner_id)").in("status", ["actiu", "renovacio_pendent"]).gte("end_date", today).lte("end_date", in30).order("end_date").limit(200),
  ]);
  const myContracts = (contracts.data ?? []).filter((k) => {
    const c = (Array.isArray(k.crm_clients) ? k.crm_clients[0] : k.crm_clients) as { name: string; owner_id: string | null } | null;
    return c?.owner_id === me;
  }).map((k) => ({ ...k, client_name: ((Array.isArray(k.crm_clients) ? k.crm_clients[0] : k.crm_clients) as { name: string } | null)?.name ?? null }));
  const oppRows = await withParties(u, (opps.data ?? []) as Opportunity[]);
  const t = tasks.data ?? [];
  return {
    tasks: t,
    overdue: t.filter((x) => x.due_at && x.due_at < now.toISOString()),
    calls: t.filter((x) => x.kind === "trucada"),
    meetings: t.filter((x) => x.kind === "reunio"),
    proposals: oppRows.filter((o) => o.stage === "proposta_enviada" || o.stage === "negociacio"),
    newOpps: oppRows.filter((o) => o.stage === "nou_lead" || o.created_at >= weekAgo),
    leads: leads.data ?? [],
    clients: clients.data ?? [],
    renewals: myContracts,
  };
}

/** Esdeveniments del calendari: tasques (amb hora), properes accions d'oportunitats i venciments de contractes. */
export async function agenda(u: U, from: string, to: string, userId: string | null) {
  const who = userId && (isStaffRole(u.profile.role) || u.profile.role === "cap_equip") ? userId : u.user.id;
  const [tasks, opps, contracts] = await Promise.all([
    u.sb.from("crm_tasks").select("id,title,kind,due_at,duration_min,status,client_id,lead_id,opportunity_id,assigned_name").eq("assigned_to", who).gte("due_at", from).lt("due_at", to).neq("status", "cancellada").limit(1000),
    u.sb.from("crm_opportunities").select("id,title,next_action,next_action_at,stage").eq("owner_id", who).gte("next_action_at", from).lt("next_action_at", to).limit(500),
    u.sb.from("crm_contracts").select("id,client_id,retailer,end_date,status,owner_id,crm_clients(name,owner_id)").in("status", ["actiu", "renovacio_pendent"]).gte("end_date", from.slice(0, 10)).lt("end_date", to.slice(0, 10)).limit(500),
  ]);
  type E = { id: string; kind: "tasca" | "oportunitat" | "venciment"; title: string; at: string; allDay: boolean; done?: boolean; taskKind?: string; durationMin?: number | null; link: { view: string; params: Record<string, string> } };
  const ev: E[] = [];
  for (const t of tasks.data ?? []) ev.push({ id: t.id, kind: "tasca", title: t.title, at: t.due_at, allDay: false, done: t.status === "feta", taskKind: t.kind, durationMin: t.duration_min, link: t.opportunity_id ? { view: "oportunitat", params: { id: t.opportunity_id } } : t.client_id ? { view: "client", params: { id: t.client_id, tab: "activitat" } } : t.lead_id ? { view: "leads", params: { id: t.lead_id } } : { view: "jornada", params: {} } });
  for (const o of opps.data ?? []) ev.push({ id: `o-${o.id}`, kind: "oportunitat", title: `${o.next_action ?? "Pròxima acció"} · ${o.title}`, at: o.next_action_at!, allDay: false, link: { view: "oportunitat", params: { id: o.id } } });
  for (const k of contracts.data ?? []) {
    const c = (Array.isArray(k.crm_clients) ? k.crm_clients[0] : k.crm_clients) as { name: string; owner_id: string | null } | null;
    if ((k.owner_id ?? c?.owner_id) !== who) continue;
    ev.push({ id: `k-${k.id}`, kind: "venciment", title: `Venç: ${c?.name ?? "client"} (${k.retailer})`, at: `${k.end_date}T00:00:00.000Z`, allDay: true, link: { view: "client", params: { id: k.client_id, tab: "contractes" } } });
  }
  return { events: ev.sort((a, b) => a.at.localeCompare(b.at)) };
}

/* ======================================================================= indicadors */

export async function performance(u: U, from: string, to: string) {
  // Fase 8.1: el Cap d'equip veu el rendiment del seu equip (la RLS ja limita les files als seus comercials)
  const staff = isStaffRole(u.profile.role) || u.profile.role === "cap_equip";
  const [opps, leads, tasks, targets, n] = await Promise.all([
    u.sb.from("crm_opportunities").select("stage,mwh,commission_eur,probability,proposal_sent_at,won_at,lost_at,created_at,owner_id,service").limit(20000),
    u.sb.from("crm_leads").select("created_at,owner_id").gte("created_at", from).lt("created_at", to).limit(20000),
    u.sb.from("crm_tasks").select("due_at,status,assigned_to").eq("status", "pendent").limit(20000),
    u.sb.from("crm_targets").select("*").eq("period", from.slice(0, 7)),
    names(u),
  ]);
  for (const r of [opps, leads, tasks]) if (r.error) dbError(r.error);
  const O = opps.data ?? [], L = leads.data ?? [], T = tasks.data ?? [];
  // Un comercial només veu les seves dades (i la RLS ja filtra el que no pot veure).
  const mine = <X extends { owner_id?: string | null; assigned_to?: string | null }>(xs: X[]) => xs.filter((x) => (x.owner_id ?? x.assigned_to) === u.user.id);
  const scope = staff ? { opps: O, leads: L, tasks: T } : { opps: mine(O), leads: mine(L), tasks: mine(T) };
  const total = computeKpis({ ...scope, from, to } as Parameters<typeof computeKpis>[0]);
  const byService: Record<string, { open: number; won: number }> = {};
  for (const o of scope.opps) {
    byService[o.service] ??= { open: 0, won: 0 };
    if (OPEN_STAGES.includes(o.stage as Stage)) byService[o.service].open++;
    if (o.stage === "guanyat" && o.won_at && o.won_at >= from && o.won_at < to) byService[o.service].won++;
  }
  const funnel = OPEN_STAGES.map((s) => ({ stage: s, label: STAGE_LABEL[s], count: scope.opps.filter((o) => o.stage === s).length }));
  const owners = staff ? [...new Set(O.map((o) => o.owner_id).filter(Boolean))] as string[] : [u.user.id];
  const team = staff ? owners.map((id) => ({ id, name: n.get(id) ?? "—", kpis: computeKpis({ opps: O.filter((o) => o.owner_id === id), leads: L.filter((l) => l.owner_id === id), tasks: T.filter((t) => t.assigned_to === id), from, to } as Parameters<typeof computeKpis>[0]) })).sort((a, b) => b.kpis.won - a.kpis.won || b.kpis.commissionWeighted - a.kpis.commissionWeighted) : [];
  const tg = (targets.data ?? []).filter((t) => staff || t.user_id === u.user.id);
  // Fase 7: les comissions de l'equip són dades econòmiques restringides (el comercial sempre veu les seves)
  const econ = u.profile.role === "cap_equip" ? await hasPerm(u, "comissions_equip") : !staff || (await finStaff(u));
  const strip = <K extends object>(k: K) => (econ ? k : { ...k, commissionOpen: null, commissionWeighted: null, commissionWon: null });
  return { kpis: strip(total), byService, funnel, team: team.map((t) => ({ ...t, kpis: strip(t.kpis) })), targets: tg.filter((t) => econ || t.metric !== "comissio").map((t) => ({ ...t, name: n.get(t.user_id) ?? null })), isStaff: staff, economic: econ, me: u.user.id };
}

export async function setTarget(u: U, b: { userId: string; period: string; metric: string; target: number | null }) {
  // el Cap d'equip fixa objectius als comercials del seu equip (la RLS impedeix fer-ho fora de l'equip o per a si mateix)
  if (!isStaffRole(u.profile.role) && u.profile.role !== "cap_equip") throw new HttpError(403, "Només Direcció, Administració o el Cap d'equip poden fixar objectius");
  const ok = z.object({ userId: uuid, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), metric: z.enum(["guanyades", "mwh", "comissio", "oportunitats"]), target: z.number().min(0).nullable() }).safeParse(b);
  if (!ok.success) throw new HttpError(400, "Objectiu no vàlid");
  const r = b.target == null
    ? await u.sb.from("crm_targets").delete().eq("user_id", b.userId).eq("period", b.period).eq("metric", b.metric)
    : await u.sb.from("crm_targets").upsert({ user_id: b.userId, period: b.period, metric: b.metric, target: b.target, updated_by: u.user.id, updated_at: new Date().toISOString() });
  if (r.error) dbError(r.error);
  await auditEvent(u, { entity: "targets", entityId: `${b.userId}:${b.period}:${b.metric}`, action: "objectiu", detail: { target: b.target } });
  return { ok: true };
}

/* ======================================================================= notificacions */

export async function listNotifications(u: U) {
  const { data, error } = await u.sb.from("crm_notifications").select("id,kind,title,body,link,read_at,created_at").order("created_at", { ascending: false }).limit(50);
  if (error) dbError(error);
  return { items: data ?? [], unread: (data ?? []).filter((x) => !x.read_at).length };
}
export async function readNotifications(u: U, ids: string[] | "all") {
  const q = u.sb.from("crm_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  const { error } = ids === "all" ? await q.eq("user_id", u.user.id) : await q.in("id", ids.filter((x) => uuid.safeParse(x).success));
  if (error) dbError(error);
  return { ok: true };
}
