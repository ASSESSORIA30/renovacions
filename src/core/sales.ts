/**
 * CRM FASE 2 · gestió comercial: model compartit (navegador i servidor), indicadors i motor d'automatitzacions (pur).
 */
import { z } from "zod";
import { checkTaxId, normalizeEmail, normalizePhone, provinceFromPostalCode, PRIORITIES, type Priority } from "./crm";

/* ------------------------------------------------------------------ catàlegs */

export const SERVICES = ["llum_residencial", "llum_empresa", "gas", "fibra_telefonia", "assegurances", "alarmes"] as const;
export type Service = (typeof SERVICES)[number];
export const SERVICE_LABEL: Record<Service, string> = {
  llum_residencial: "Electricitat residencial", llum_empresa: "Electricitat empreses", gas: "Gas natural", fibra_telefonia: "Fibra i telefonia", assegurances: "Assegurances", alarmes: "Alarmes",
};
export const SERVICE_SHORT: Record<Service, string> = { llum_residencial: "Llum resid.", llum_empresa: "Llum empresa", gas: "Gas", fibra_telefonia: "Fibra/tel.", assegurances: "Assegurances", alarmes: "Alarmes" };
export const SERVICE_COLOR: Record<Service, string> = { llum_residencial: "#f59e0b", llum_empresa: "#d97706", gas: "#0ea5e9", fibra_telefonia: "#8b5cf6", assegurances: "#10b981", alarmes: "#ef4444" };
/** Serveis amb consum energètic (tenen sentit els kWh/MWh). */
export const ENERGY_SERVICES: Service[] = ["llum_residencial", "llum_empresa", "gas"];

export const STAGES = ["nou_lead", "contactat", "factura_sollicitada", "estudi", "proposta_enviada", "negociacio", "guanyat", "perdut"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  nou_lead: "Nou lead", contactat: "Contactat", factura_sollicitada: "Factura sol·licitada", estudi: "Estudi en curs", proposta_enviada: "Proposta enviada", negociacio: "Negociació", guanyat: "Guanyat", perdut: "Perdut",
};
export const STAGE_COLOR: Record<Stage, string> = {
  nou_lead: "#64748b", contactat: "#0ea5e9", factura_sollicitada: "#6366f1", estudi: "#8b5cf6", proposta_enviada: "#f59e0b", negociacio: "#f97316", guanyat: "#16a34a", perdut: "#dc2626",
};
/** Probabilitat per defecte quan una oportunitat arriba a l'etapa (si no se n'ha fixat cap). */
export const STAGE_PROBABILITY: Record<Stage, number> = { nou_lead: 10, contactat: 20, factura_sollicitada: 30, estudi: 40, proposta_enviada: 55, negociacio: 70, guanyat: 100, perdut: 0 };
export const OPEN_STAGES: Stage[] = ["nou_lead", "contactat", "factura_sollicitada", "estudi", "proposta_enviada", "negociacio"];
export const isClosed = (s: Stage) => s === "guanyat" || s === "perdut";

export const LEAD_STATUSES = ["nou", "contactat", "qualificat", "convertit", "descartat"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { nou: "Nou", contactat: "Contactat", qualificat: "Qualificat", convertit: "Convertit en client", descartat: "Descartat" };
export const LEAD_STATUS_TONE: Record<LeadStatus, "blue" | "amber" | "violet" | "green" | "zinc"> = { nou: "blue", contactat: "amber", qualificat: "violet", convertit: "green", descartat: "zinc" };

export const TASK_KINDS = ["trucada", "reunio", "seguiment", "tramitacio", "renovacio", "altres"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_KIND_LABEL: Record<TaskKind, string> = { trucada: "Trucada", reunio: "Reunió", seguiment: "Seguiment", tramitacio: "Tramitació", renovacio: "Renovació", altres: "Altres" };

export const CALL_OUTCOMES = ["contactat", "no_contesta", "interessat", "no_interessat", "demana_trucar", "envia_factura"] as const;
export const CALL_OUTCOME_LABEL: Record<(typeof CALL_OUTCOMES)[number], string> = { contactat: "Contactat", no_contesta: "No contesta", interessat: "Interessat", no_interessat: "No interessat", demana_trucar: "Demana que el truquem", envia_factura: "Enviarà la factura" };

export const LOST_REASONS = ["Preu", "Es queda amb la seva comercialitzadora", "Permanència vigent", "No respon", "No és el moment", "Ha triat un competidor", "Altres"];

/* ------------------------------------------------------------------ tipus */

export interface Lead {
  id: string; kind: "particular" | "autonom" | "empresa"; name: string; company: string | null; contact_name: string | null; tax_id: string | null; phone: string | null; email: string | null;
  address: string | null; postal_code: string | null; city: string | null; province: string | null; origin: string | null; services: Service[]; notes: string | null; status: LeadStatus;
  discard_reason: string | null; owner_id: string | null; collaborator_id: string | null; converted_client_id: string | null; converted_at: string | null; first_contact_at: string | null; created_at: string; updated_at: string;
  owner_name?: string | null;
}
export interface Opportunity {
  id: string; lead_id: string | null; client_id: string | null; supply_id: string | null; title: string; service: Service; stage: Stage; owner_id: string | null; collaborator_id: string | null;
  annual_kwh: number | null; mwh: number | null; commission_eur: number | null; probability: number | null; priority: Priority; next_action: string | null; next_action_at: string | null;
  expected_close: string | null; province: string | null; lost_reason: string | null; comparison_id: string | null; contract_id: string | null; notes: string | null; position: number; version: number;
  stage_changed_at: string; proposal_sent_at: string | null; won_at: string | null; lost_at: string | null; last_activity_at: string; created_at: string; updated_at: string;
  /** afegits pel servidor */
  party_name?: string | null; owner_name?: string | null;
}

/* ------------------------------------------------------------------ entrades */

const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const optNum = z.union([z.number(), z.string()]).nullable().optional().transform((v, ctx) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) { ctx.addIssue({ code: "custom", message: "Número no vàlid" }); return z.NEVER; }
  return n;
});

export const leadInput = z
  .object({
    kind: z.enum(["particular", "autonom", "empresa"]).default("empresa"),
    name: z.string().trim().min(1, "Falta el nom").max(200),
    company: optText(200),
    contact_name: optText(160),
    tax_id: optText(30),
    phone: optText(40),
    email: optText(200),
    address: optText(300),
    postal_code: optText(10),
    city: optText(120),
    province: optText(120),
    origin: optText(120),
    services: z.array(z.enum(SERVICES)).max(6).default([]),
    notes: optText(5000),
    owner_id: z.string().uuid().nullable().optional(),
  })
  .transform((l, ctx) => {
    const tax = checkTaxId(l.tax_id);
    if (!tax.valid) ctx.addIssue({ code: "custom", path: ["tax_id"], message: tax.message ?? "Identificador fiscal no vàlid" });
    const p = normalizePhone(l.phone);
    if (!p.valid) ctx.addIssue({ code: "custom", path: ["phone"], message: "Telèfon no vàlid" });
    const e = normalizeEmail(l.email);
    if (!e.valid) ctx.addIssue({ code: "custom", path: ["email"], message: "Correu electrònic no vàlid" });
    if (!p.value && !e.value) ctx.addIssue({ code: "custom", path: ["phone"], message: "Indica almenys un telèfon o un correu per poder contactar" });
    const cp = l.postal_code?.replace(/\s/g, "") || null;
    return { ...l, tax_id: tax.value, phone: p.value, email: e.value, postal_code: cp, province: l.province ?? provinceFromPostalCode(cp), services: [...new Set(l.services)] };
  });

export const opportunityInput = z
  .object({
    title: z.string().trim().min(1, "Falta el títol").max(200),
    service: z.enum(SERVICES),
    lead_id: z.string().uuid().nullable().optional(),
    client_id: z.string().uuid().nullable().optional(),
    supply_id: z.string().uuid().nullable().optional(),
    owner_id: z.string().uuid().nullable().optional(),
    annual_kwh: optNum,
    commission_eur: optNum,
    probability: z.coerce.number().int().min(0).max(100).nullable().optional(),
    priority: z.enum(PRIORITIES).default("mitjana"),
    next_action: optText(200),
    next_action_at: z.string().datetime({ offset: true }).nullable().optional(),
    expected_close: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null),
    notes: optText(5000),
  })
  .superRefine((o, ctx) => {
    if (!o.lead_id && !o.client_id) ctx.addIssue({ code: "custom", path: ["client_id"], message: "L'oportunitat ha de ser d'un lead o d'un client" });
    if (o.annual_kwh != null && !ENERGY_SERVICES.includes(o.service)) ctx.addIssue({ code: "custom", path: ["annual_kwh"], message: "El consum només s'aplica a electricitat i gas" });
  });

export const moveInput = z.object({
  id: z.string().uuid(),
  stage: z.enum(STAGES),
  version: z.number().int().min(1),
  position: z.number().finite().optional(),
  lost_reason: z.string().trim().max(300).nullable().optional(),
});

/* ------------------------------------------------------------------ indicadors */

export interface Kpis {
  leadsNew: number; openOpps: number; proposalsSent: number; won: number; lost: number; conversion: number | null;
  mwhOpen: number; mwhWeighted: number; commissionOpen: number; commissionWeighted: number; commissionWon: number; mwhWon: number; pendingTasks: number; overdueTasks: number;
}
type KOpp = Pick<Opportunity, "stage" | "mwh" | "commission_eur" | "probability" | "proposal_sent_at" | "won_at" | "lost_at" | "created_at" | "owner_id">;

/** Indicadors d'un període [from, to) a partir de les dades que l'usuari pot veure. */
export function computeKpis(p: { opps: KOpp[]; leads: { created_at: string }[]; tasks: { due_at: string | null; status: string }[]; from: string; to: string; now?: string }): Kpis {
  const inP = (d: string | null | undefined) => !!d && d >= p.from && d < p.to;
  const open = p.opps.filter((o) => OPEN_STAGES.includes(o.stage));
  const prob = (o: KOpp) => (o.probability ?? STAGE_PROBABILITY[o.stage]) / 100;
  const won = p.opps.filter((o) => o.stage === "guanyat" && inP(o.won_at));
  const lost = p.opps.filter((o) => o.stage === "perdut" && inP(o.lost_at));
  const now = p.now ?? new Date().toISOString();
  const pend = p.tasks.filter((t) => t.status === "pendent");
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    leadsNew: p.leads.filter((l) => inP(l.created_at)).length,
    openOpps: open.length,
    proposalsSent: p.opps.filter((o) => inP(o.proposal_sent_at)).length,
    won: won.length,
    lost: lost.length,
    conversion: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 1000) / 10 : null,
    mwhOpen: r1(open.reduce((a, o) => a + (o.mwh ?? 0), 0)),
    mwhWeighted: r1(open.reduce((a, o) => a + (o.mwh ?? 0) * prob(o), 0)),
    commissionOpen: r2(open.reduce((a, o) => a + (o.commission_eur ?? 0), 0)),
    commissionWeighted: r2(open.reduce((a, o) => a + (o.commission_eur ?? 0) * prob(o), 0)),
    commissionWon: r2(won.reduce((a, o) => a + (o.commission_eur ?? 0), 0)),
    mwhWon: r1(won.reduce((a, o) => a + (o.mwh ?? 0), 0)),
    pendingTasks: pend.length,
    overdueTasks: pend.filter((t) => t.due_at && t.due_at < now).length,
  };
}

export const daysSince = (iso: string | null | undefined, now = new Date()) => (iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000) : null);

/* ------------------------------------------------------------------ automatitzacions (planificador pur i idempotent) */

export const RULE_KEYS = ["proposta_sense_resposta", "venciment_contracte", "lead_sense_contacte", "oportunitat_inactiva", "proposta_acceptada", "preparar_renovacio"] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export interface Rule { key: RuleKey; enabled: boolean; params: Record<string, unknown> }

export interface AutoInput {
  now: Date;
  rules: Rule[];
  opps: Pick<Opportunity, "id" | "title" | "stage" | "owner_id" | "client_id" | "lead_id" | "proposal_sent_at" | "won_at" | "last_activity_at" | "contract_id">[];
  /** última activitat (no automàtica) per oportunitat */
  lastActivity: Record<string, string>;
  leads: Pick<Lead, "id" | "name" | "status" | "owner_id" | "created_at" | "first_contact_at">[];
  /** Contractes del CRM. Els importats de la cartera (`legacy`) ja tenen les alertes del mòdul de Renovacions i s'ometen. */
  contracts: { id: string; client_id: string; retailer: string; end_date: string | null; status: string; owner_id: string | null; client_owner_id: string | null; client_name: string | null; legacy: boolean; created_at: string }[];
  staffIds: string[];
}
export interface PlannedTask { rule_key: string; title: string; kind: TaskKind; due_at: string; assigned_to: string; client_id: string | null; lead_id: string | null; opportunity_id: string | null; contract_id: string | null; notes: string | null }
export interface PlannedNotification { rule_key: string; user_id: string; kind: string; title: string; body: string | null; link: { view: string; params: Record<string, string> } }

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y.getTime()) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Calcula les tasques i avisos que corresponen ara. Cada element porta una `rule_key` única: la base de dades
 * en rebutja els duplicats, de manera que executar-ho moltes vegades no repeteix res.
 */
export function planAutomations(a: AutoInput): { tasks: PlannedTask[]; notifications: PlannedNotification[] } {
  const rule = (k: RuleKey) => a.rules.find((r) => r.key === k && r.enabled);
  const tasks: PlannedTask[] = [];
  const notifications: PlannedNotification[] = [];
  const now = a.now;
  const today = dayStr(now);

  const r1 = rule("proposta_sense_resposta");
  if (r1) {
    const days = num(r1.params.days, 3);
    for (const o of a.opps) {
      if (o.stage !== "proposta_enviada" || !o.proposal_sent_at || !o.owner_id) continue;
      const sent = new Date(o.proposal_sent_at);
      if (addDays(sent, days) > now) continue;
      const last = a.lastActivity[o.id];
      if (last && last > o.proposal_sent_at) continue;
      tasks.push({ rule_key: `proposta_sense_resposta:${o.id}:${o.proposal_sent_at.slice(0, 10)}`, title: `Seguiment de la proposta: ${o.title}`, kind: "seguiment", due_at: now.toISOString(), assigned_to: o.owner_id, client_id: o.client_id, lead_id: o.client_id ? null : o.lead_id, opportunity_id: o.id, contract_id: null, notes: `Proposta enviada fa ${days} dies o més sense cap resposta registrada.` });
    }
  }

  const r2 = rule("venciment_contracte");
  if (r2) {
    const marks = (Array.isArray(r2.params.days) ? r2.params.days : [90, 60, 30]).map((x) => num(x, 0)).filter((x) => x > 0).sort((x, y) => y - x);
    for (const k of a.contracts) {
      if (k.legacy || !k.end_date || !["actiu", "renovacio_pendent"].includes(k.status)) continue;
      const left = Math.ceil((new Date(`${k.end_date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
      if (left < 0) continue;
      const mark = [...marks].reverse().find((m) => left <= m); // el llindar més petit ja assolit
      if (mark == null) continue;
      const user = k.owner_id ?? k.client_owner_id;
      const users = user ? [user] : a.staffIds;
      for (const u of users) notifications.push({ rule_key: `venciment_contracte:${k.id}:${mark}`, user_id: u, kind: "venciment", title: `Contracte que venç en ${left} dies`, body: `${k.client_name ?? "Client"} · ${k.retailer} · venç el ${k.end_date}`, link: { view: "client", params: { id: k.client_id, tab: "contractes" } } });
      // Fase 7: el primer avís de venciment també crea la tasca de renovació (una sola per contracte i data de
      // venciment: comparteix la clau amb «Preparar la renovació», de manera que mai n'hi ha dues)
      const assignee = user ?? a.staffIds[0];
      if (assignee) tasks.push({ rule_key: `preparar_renovacio:${k.id}:${k.end_date}`, title: `Renovació: ${k.client_name ?? "client"} (${k.retailer}) venç el ${k.end_date}`, kind: "renovacio", due_at: addDays(now, Math.min(7, Math.max(0, left - 15))).toISOString(), assigned_to: assignee, client_id: k.client_id, lead_id: null, opportunity_id: null, contract_id: k.id, notes: `Avís automàtic a ${mark} dies del venciment.` });
    }
  }

  const r3 = rule("lead_sense_contacte");
  if (r3) {
    const hours = num(r3.params.hours, 24);
    for (const l of a.leads) {
      if (l.status !== "nou" || l.first_contact_at) continue;
      if (new Date(l.created_at).getTime() + hours * 3_600_000 > now.getTime()) continue;
      for (const u of l.owner_id ? [l.owner_id] : a.staffIds) notifications.push({ rule_key: `lead_sense_contacte:${l.id}`, user_id: u, kind: "lead", title: `Lead sense primer contacte: ${l.name}`, body: l.owner_id ? `Fa més de ${hours} h que es va donar d'alta i encara no s'hi ha contactat.` : "Lead sense comercial assignat.", link: { view: "leads", params: { id: l.id } } });
    }
  }

  const r4 = rule("oportunitat_inactiva");
  if (r4) {
    const days = num(r4.params.days, 7);
    for (const o of a.opps) {
      if (isClosed(o.stage) || !o.owner_id) continue;
      if (addDays(new Date(o.last_activity_at), days) > now) continue;
      notifications.push({ rule_key: `oportunitat_inactiva:${o.id}:${isoWeek(now)}`, user_id: o.owner_id, kind: "inactiva", title: `Oportunitat sense activitat: ${o.title}`, body: `Fa ${daysSince(o.last_activity_at, now)} dies sense cap activitat.`, link: { view: "oportunitat", params: { id: o.id } } });
    }
  }

  const r5 = rule("proposta_acceptada");
  if (r5) {
    const due = num(r5.params.due_days, 2);
    for (const o of a.opps) {
      if (o.stage !== "guanyat" || o.contract_id || !o.owner_id || !o.won_at) continue;
      tasks.push({ rule_key: `proposta_acceptada:${o.id}`, title: `Tramitar el contracte: ${o.title}`, kind: "tramitacio", due_at: addDays(new Date(o.won_at), due).toISOString(), assigned_to: o.owner_id, client_id: o.client_id, lead_id: o.client_id ? null : o.lead_id, opportunity_id: o.id, contract_id: null, notes: "Proposta acceptada: recull la documentació i tramita l'alta amb la comercialitzadora." });
    }
  }

  const r6 = rule("preparar_renovacio");
  if (r6) {
    const before = num(r6.params.days_before, 90);
    for (const k of a.contracts) {
      // només contractes activats al CRM durant els últims 30 dies (no la cartera importada)
      if (k.legacy || k.status !== "actiu" || !k.end_date || new Date(k.created_at) < addDays(now, -30)) continue;
      const user = k.owner_id ?? k.client_owner_id;
      if (!user) continue;
      const due = addDays(new Date(`${k.end_date}T09:00:00Z`), -before);
      tasks.push({ rule_key: `preparar_renovacio:${k.id}:${k.end_date}`, title: `Preparar la renovació: ${k.client_name ?? "client"} (${k.retailer})`, kind: "renovacio", due_at: (due < now ? now : due).toISOString(), assigned_to: user, client_id: k.client_id, lead_id: null, opportunity_id: null, contract_id: k.id, notes: `El contracte venç el ${k.end_date}.` });
    }
  }
  // una sola tasca per clau (la renovació la poden proposar dues regles; la base de dades també rebutja duplicats)
  const seen = new Set<string>();
  return { tasks: tasks.filter((t) => (seen.has(t.rule_key) ? false : (seen.add(t.rule_key), true))), notifications };
}
