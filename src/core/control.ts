/**
 * CENTRE DE CONTROL, SUPERVISIÓ I QUALITAT (Fase 7) · lògica pura i definicions.
 *
 * - KPI_DEFS: definició única de cada indicador. El servidor calcula els valors amb les mateixes funcions que fan
 *   servir els mòduls d'origen (economia de la Fase 4, comercial de la Fase 2, contractació de la Fase 3), de manera
 *   que una xifra no pot dir una cosa al Centre de Control i una altra al mòdul.
 * - Widgets i plantilles de panell (es guarden per identificador d'usuari, mai per nom).
 * - Planificador d'escalats (tasques vençudes, incidències urgents, errors d'integració) i detectors de qualitat.
 * Res d'aquest fitxer inventa dades: si una font no existeix, el valor és `null` i la interfície diu «sense dades».
 */
import { z } from "zod";

/* ======================================================================= períodes */

export type PeriodKey = "avui" | "setmana" | "mes" | "trimestre" | "any" | "personalitzat";
export const PERIOD_LABEL: Record<PeriodKey, string> = { avui: "Avui", setmana: "Aquesta setmana", mes: "Aquest mes", trimestre: "Aquest trimestre", any: "Aquest any", personalitzat: "Personalitzat" };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Rang [from, to] (dates incloses, AAAA-MM-DD) d'un període relatiu a `now` (setmana de dilluns a diumenge). */
export function periodRange(p: PeriodKey, now = new Date(), custom?: { from?: string; to?: string }) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (p === "personalitzat" && custom?.from && custom?.to) return { from: custom.from, to: custom.to };
  if (p === "avui") return { from: iso(d), to: iso(d) };
  if (p === "setmana") { const dow = (d.getUTCDay() + 6) % 7; const a = new Date(d); a.setUTCDate(d.getUTCDate() - dow); const b = new Date(a); b.setUTCDate(a.getUTCDate() + 6); return { from: iso(a), to: iso(b) }; }
  if (p === "trimestre") { const q = Math.floor(d.getUTCMonth() / 3) * 3; return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), q, 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), q + 3, 0))) }; }
  if (p === "any") return { from: `${d.getUTCFullYear()}-01-01`, to: `${d.getUTCFullYear()}-12-31` };
  return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) };
}
export const inRange = (s: string | null | undefined, r: { from: string; to: string }) => !!s && s.slice(0, 10) >= r.from && s.slice(0, 10) <= r.to;

/* ======================================================================= definicions dels indicadors */

export type KpiGroup = "comercial" | "administratiu" | "economic" | "equip" | "qualitat";
export type KpiDef = { id: string; label: string; group: KpiGroup; unit: "n" | "mwh" | "eur" | "pct"; def: string; source: string; economic?: boolean };

export const KPI_DEFS: KpiDef[] = [
  // comercials
  { id: "contractes_dia", label: "Contractes del dia", group: "comercial", unit: "n", def: "Contractes del CRM (crm_contracts) amb data de signatura avui; si no hi ha data de signatura, la data d'alta. No compta esborranys ni anul·lats.", source: "crm_contracts" },
  { id: "contractes_setmana", label: "Contractes de la setmana", group: "comercial", unit: "n", def: "Igual que «del dia», de dilluns a diumenge de la setmana actual.", source: "crm_contracts" },
  { id: "contractes_mes", label: "Contractes del mes", group: "comercial", unit: "n", def: "Igual que «del dia», del mes natural actual.", source: "crm_contracts" },
  { id: "contractes_periode", label: "Contractes del període", group: "comercial", unit: "n", def: "Contractes signats (o donats d'alta) dins del període seleccionat, sense esborranys ni anul·lats.", source: "crm_contracts" },
  { id: "activats", label: "Contractes activats", group: "comercial", unit: "n", def: "Expedients activats dins del període (data d'activació confirmada; si no n'hi ha, la del canvi d'estat).", source: "crm_expedients.activated_at" },
  { id: "anullats", label: "Contractes anul·lats", group: "comercial", unit: "n", def: "Contractes en estat «anul·lat» actualitzats dins del període i expedients «rebutjats» dins del període.", source: "crm_contracts, crm_expedients" },
  { id: "mwh", label: "MWh contractats", group: "comercial", unit: "mwh", def: "Suma del consum anual (kWh ÷ 1.000) dels subministraments dels contractes del període. Si el contracte no té subministrament amb consum, no suma (no s'estima).", source: "crm_contracts → crm_supplies.annual_kwh" },
  { id: "leads", label: "Leads nous", group: "comercial", unit: "n", def: "Leads creats dins del període (qualsevol canal).", source: "crm_leads" },
  { id: "oportunitats", label: "Oportunitats obertes", group: "comercial", unit: "n", def: "Oportunitats en una etapa oberta ara mateix (no guanyades ni perdudes).", source: "crm_opportunities" },
  { id: "propostes", label: "Propostes enviades", group: "comercial", unit: "n", def: "Oportunitats amb data d'enviament de proposta dins del període.", source: "crm_opportunities.proposal_sent_at" },
  { id: "conversio", label: "Taxa de conversió", group: "comercial", unit: "pct", def: "Oportunitats guanyades ÷ (guanyades + perdudes) tancades dins del període. Sense tancaments, no es calcula.", source: "crm_opportunities" },
  { id: "ia_oportunitats", label: "Oportunitats detectades per IA", group: "comercial", unit: "n", def: "Oportunitats del motor d'IA (Fase 5) pendents de revisar.", source: "ai_opportunities" },
  // administratius
  { id: "expedients_pendents", label: "Expedients pendents", group: "administratiu", unit: "n", def: "Expedients no activats ni rebutjats (pendents de documentació, signatura, enviament o en tramitació).", source: "crm_expedients" },
  { id: "tramitacio", label: "En tramitació", group: "administratiu", unit: "n", def: "Expedients en estat enviat o en tramitació a la comercialitzadora.", source: "crm_expedients" },
  { id: "documentacio_incompleta", label: "Documentació incompleta", group: "administratiu", unit: "n", def: "Expedients en estat «pendent de documentació».", source: "crm_expedients" },
  { id: "bloquejats", label: "Contractes bloquejats", group: "administratiu", unit: "n", def: "Expedients en «incidència» o sense cap moviment des de fa més de 7 dies (sense comptar activats ni rebutjats).", source: "crm_expedients" },
  { id: "renovacions_urgents", label: "Renovacions urgents", group: "administratiu", unit: "n", def: "Contractes actius o pendents de renovar que vencen en els propers 30 dies.", source: "crm_contracts.end_date" },
  { id: "renovacions_120", label: "Renovacions (120 dies)", group: "administratiu", unit: "n", def: "Contractes actius o pendents de renovar que vencen en els propers 120 dies.", source: "crm_contracts.end_date" },
  { id: "incidencies_obertes", label: "Incidències obertes", group: "administratiu", unit: "n", def: "Incidències no resoltes ni tancades.", source: "crm_incidents" },
  { id: "incidencies_urgents", label: "Incidències urgents", group: "administratiu", unit: "n", def: "Incidències obertes amb prioritat urgent o alta.", source: "crm_incidents" },
  { id: "tasques_pendents", label: "Tasques pendents", group: "administratiu", unit: "n", def: "Tasques pendents, en curs o bloquejades.", source: "crm_tasks" },
  { id: "tasques_vencudes", label: "Tasques vençudes", group: "administratiu", unit: "n", def: "Tasques obertes amb data límit anterior a ara.", source: "crm_tasks" },
  { id: "tasques_bloquejades", label: "Tasques bloquejades", group: "administratiu", unit: "n", def: "Tasques en estat «bloquejada».", source: "crm_tasks" },
  { id: "contractes_introduits_avui", label: "Contractes introduïts avui", group: "administratiu", unit: "n", def: "Contractes donats d'alta avui al CRM (data d'alta, no de signatura).", source: "crm_contracts.created_at" },
  // econòmics (només amb permís «economia»; mateixa funció que el Panell econòmic de la Fase 4)
  { id: "comissions_previstes", label: "Comissions previstes", group: "economic", unit: "eur", economic: true, def: "Comissió calculada pel motor de regles (capa proveïdor) dels contractes iniciats al període. És una previsió, no un import confirmat.", source: "fin_calculations" },
  { id: "comissions_meritades", label: "Comissions meritades", group: "economic", unit: "eur", economic: true, def: "Moviments de meritació, regularització i anul·lació (capa proveïdor) del període.", source: "fin_ledger" },
  { id: "comissions_confirmades", label: "Comissions confirmades", group: "economic", unit: "eur", economic: true, def: "Imports confirmats per la comercialitzadora (conciliació) dins del període.", source: "fin_ledger (confirmacio)" },
  { id: "comissions_cobrades", label: "Comissions cobrades", group: "economic", unit: "eur", economic: true, def: "Cobraments reals registrats i conciliats dins del període.", source: "fin_ledger (cobrament)" },
  { id: "pendent_cobrar", label: "Pendent de cobrar", group: "economic", unit: "eur", economic: true, def: "Acumulat meritat o confirmat que encara no s'ha cobrat (no només el període).", source: "fin_ledger" },
  { id: "liquidacions_pendents", label: "Liquidacions pendents", group: "economic", unit: "n", economic: true, def: "Liquidacions en esborrany, revisió o aprovades sense pagar del tot.", source: "fin_settlements" },
  { id: "pagaments", label: "Pagaments efectuats", group: "economic", unit: "eur", economic: true, def: "Pagaments a comercials i col·laboradors registrats dins del període.", source: "fin_payments" },
  { id: "marge_previst", label: "Marge previst", group: "economic", unit: "eur", economic: true, def: "Comissions previstes − comissions a pagar previstes − costos del període.", source: "Fase 4 · dashboard" },
  { id: "marge_realitzat", label: "Marge realitzat", group: "economic", unit: "eur", economic: true, def: "Cobrat − comissions a pagar meritades − costos del període.", source: "Fase 4 · dashboard" },
  { id: "rendibilitat", label: "Rendibilitat", group: "economic", unit: "pct", economic: true, def: "Marge realitzat ÷ cobrat del període. Sense cobraments, no es calcula.", source: "Fase 4 · dashboard" },
  // reclamacions a comercialitzadores (Fase 8.2)
  { id: "reclamacions_obertes", label: "Reclamacions obertes", group: "economic", unit: "n", economic: true, def: "Reclamacions a comercialitzadores que no estan resoltes ni rebutjades (inclou esborranys).", source: "fin_claims" },
  { id: "reclamacions_pendent", label: "Reclamat pendent de resposta", group: "economic", unit: "eur", economic: true, def: "Import reclamat − import recuperat de les reclamacions enviades que esperen resposta o són en revisió.", source: "fin_claims" },
  { id: "reclamacions_recuperat", label: "Recuperat per reclamacions", group: "economic", unit: "eur", economic: true, def: "Imports recuperats registrats a les reclamacions (regularitzacions confirmades per Administració).", source: "fin_claim_recoveries" },
  // qualitat
  { id: "qualitat_incidencies", label: "Problemes de qualitat de dades", group: "qualitat", unit: "n", def: "Nombre de problemes detectats pel revisor de qualitat (pendents de revisió humana).", source: "detectors de qualitat" },
];
export const KPI = Object.fromEntries(KPI_DEFS.map((k) => [k.id, k])) as Record<string, KpiDef>;

/* ======================================================================= widgets i plantilles */

export type WidgetKind = "kpi" | "serie_comercial" | "serie_economica" | "equip" | "collaboradors" | "alertes" | "tasques_equip" | "objectius" | "ia" | "qualitat" | "embut" | "renovacions";
export type WidgetDef = { id: string; kind: WidgetKind; label: string; kpi?: string; economic?: boolean; defaultSize: 1 | 2 | 3 | 4 };
export const WIDGETS: WidgetDef[] = [
  ...KPI_DEFS.filter((k) => k.group !== "qualitat").map((k) => ({ id: `kpi:${k.id}`, kind: "kpi" as const, label: k.label, kpi: k.id, economic: k.economic, defaultSize: 1 as const })),
  { id: "serie_comercial", kind: "serie_comercial", label: "Evolució comercial (12 mesos)", defaultSize: 2 },
  { id: "serie_economica", kind: "serie_economica", label: "Evolució de comissions (12 mesos)", economic: true, defaultSize: 2 },
  { id: "equip", kind: "equip", label: "Activitat de l'equip", defaultSize: 2 },
  { id: "collaboradors", kind: "collaboradors", label: "Resultats de col·laboradors", defaultSize: 2 },
  { id: "alertes", kind: "alertes", label: "Alertes operatives", defaultSize: 2 },
  { id: "tasques_equip", kind: "tasques_equip", label: "Càrrega de treball", defaultSize: 2 },
  { id: "objectius", kind: "objectius", label: "Objectius comercials", defaultSize: 2 },
  { id: "ia", kind: "ia", label: "Oportunitats de la IA", defaultSize: 2 },
  { id: "qualitat", kind: "qualitat", label: "Qualitat de dades", defaultSize: 2 },
  { id: "embut", kind: "embut", label: "Embut comercial", defaultSize: 2 },
  { id: "renovacions", kind: "renovacions", label: "Renovacions properes", defaultSize: 2 },
];
export const WIDGET = Object.fromEntries(WIDGETS.map((w) => [w.id, w])) as Record<string, WidgetDef>;

export const layoutSchema = z.object({
  template: z.string().max(40).optional(),
  widgets: z.array(z.object({ id: z.string().max(60), size: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) })).max(60),
  period: z.enum(["avui", "setmana", "mes", "trimestre", "any", "personalitzat"]).default("mes"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  filters: z.object({ owner: z.string().max(64).optional(), retailer: z.string().max(80).optional(), product: z.string().max(80).optional(), responsible: z.string().max(64).optional() }).default({}),
  saved: z.array(z.object({ name: z.string().min(1).max(60), period: z.string().max(20), from: z.string().max(10).optional(), to: z.string().max(10).optional(), filters: z.record(z.string().max(80)) })).max(20).default([]),
});
export type Layout = z.infer<typeof layoutSchema>;

const W = (ids: string[], big: string[] = []): Layout["widgets"] => ids.map((id) => ({ id, size: (big.includes(id) ? 2 : WIDGET[id]?.defaultSize ?? 1) as 1 | 2 | 3 | 4 }));

/** Plantilles inicials. S'assignen a una persona per identificador d'usuari (sec_settings / preferències), no al codi. */
export const TEMPLATES: Record<string, { label: string; help: string; layout: Layout }> = {
  direccio_comercial: {
    label: "Direcció · comercial i econòmic",
    help: "Contractes, MWh, evolució comercial, comercials, col·laboradors, comissions, rendibilitat, objectius i IA.",
    layout: { template: "direccio_comercial", period: "mes", filters: {}, saved: [], widgets: W(["kpi:contractes_dia", "kpi:contractes_setmana", "kpi:contractes_mes", "kpi:mwh", "serie_comercial", "equip", "collaboradors", "kpi:comissions_meritades", "kpi:comissions_cobrades", "kpi:marge_realitzat", "kpi:rendibilitat", "objectius", "ia", "serie_economica"]) },
  },
  direccio_operativa: {
    label: "Direcció · operativa i administració",
    help: "Expedients, contractes pendents i bloquejats, renovacions, incidències, tasques, càrrega i qualitat de dades.",
    layout: { template: "direccio_operativa", period: "setmana", filters: {}, saved: [], widgets: W(["kpi:tramitacio", "kpi:expedients_pendents", "kpi:bloquejats", "kpi:renovacions_urgents", "kpi:incidencies_obertes", "kpi:tasques_vencudes", "alertes", "tasques_equip", "equip", "renovacions", "qualitat", "kpi:documentacio_incompleta"]) },
  },
  complet: {
    label: "Complet",
    help: "Tots els blocs principals de cada àrea.",
    layout: { template: "complet", period: "mes", filters: {}, saved: [], widgets: W(["kpi:contractes_mes", "kpi:mwh", "kpi:leads", "kpi:propostes", "kpi:conversio", "kpi:activats", "kpi:expedients_pendents", "kpi:bloquejats", "kpi:incidencies_obertes", "kpi:tasques_vencudes", "kpi:comissions_previstes", "kpi:comissions_meritades", "kpi:comissions_confirmades", "kpi:comissions_cobrades", "kpi:liquidacions_pendents", "kpi:marge_realitzat", "serie_comercial", "serie_economica", "embut", "equip", "collaboradors", "tasques_equip", "alertes", "qualitat"]) },
  },
};
export const DEFAULT_TEMPLATE = "complet";

/** Valida i neteja un panell desat: treu widgets desconeguts o econòmics si l'usuari no hi té accés, i duplicats. */
export function sanitizeLayout(raw: unknown, opts: { economic: boolean }): Layout {
  const parsed = layoutSchema.safeParse(raw);
  const base = parsed.success ? parsed.data : TEMPLATES[DEFAULT_TEMPLATE].layout;
  const seen = new Set<string>();
  const widgets = base.widgets.filter((w) => {
    const def = WIDGET[w.id];
    if (!def || seen.has(w.id) || (def.economic && !opts.economic)) return false;
    seen.add(w.id);
    return true;
  });
  return { ...base, widgets };
}

/* ======================================================================= càlcul d'indicadors operatius (sense economia) */

export const OPEN_TASK = ["pendent", "en_curs", "bloquejada"] as const;
export const EXP_DONE = ["activat", "rebutjat"];
export const EXP_PROCESSING = ["enviat", "en_tramitacio"];
export type CContract = { id: string; status: string; signed_at: string | null; created_at: string; updated_at?: string | null; end_date: string | null; retailer: string; product: string | null; owner_id: string | null; created_by: string | null; kwh: number | null; client_id: string };
export type CExpedient = { id: string; status: string; status_changed_at: string; activated_at?: string | null; last_event_at?: string | null; owner_id: string | null; created_by?: string | null; retailer: string | null; service?: string | null; collaborator_id?: string | null; created_at: string };
export type CLead = { id: string; created_at: string; owner_id: string | null; collaborator_id: string | null; status: string; first_contact_at: string | null };
export type COpp = { id: string; stage: string; created_at: string; proposal_sent_at: string | null; won_at: string | null; lost_at: string | null; owner_id: string | null; mwh: number | null };
export type CTask = { id: string; status: string; due_at: string | null; assigned_to: string | null; created_by?: string | null; completed_at: string | null; area?: string | null; kind?: string | null; priority?: string | null; escalation_level?: number; title?: string; created_at?: string };
export type CIncident = { id: string; status: string; priority: string; opened_at: string; closed_at: string | null; assigned_to: string | null; due_at?: string | null; escalation_level?: number; title?: string };

const LIVE = (c: CContract) => !["esborrany", "anullat"].includes(c.status);
const signDay = (c: CContract) => (c.signed_at ?? c.created_at).slice(0, 10);
const daysBetween = (a: string, b: Date) => (b.getTime() - new Date(a).getTime()) / 86_400_000;

export function operationalKpis(d: { now: Date; range: { from: string; to: string }; contracts: CContract[]; expedients: CExpedient[]; leads: CLead[]; opps: COpp[]; tasks: CTask[]; incidents: CIncident[]; aiPending?: number | null }) {
  const today = periodRange("avui", d.now), week = periodRange("setmana", d.now), month = periodRange("mes", d.now);
  const live = d.contracts.filter(LIVE);
  const inP = live.filter((c) => inRange(signDay(c), d.range));
  const openExp = d.expedients.filter((e) => !EXP_DONE.includes(e.status));
  const blocked = openExp.filter((e) => e.status === "incidencia" || daysBetween(e.last_event_at ?? e.status_changed_at, d.now) > 7);
  const in30 = new Date(d.now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10), in120 = new Date(d.now.getTime() + 120 * 86_400_000).toISOString().slice(0, 10), t0 = d.now.toISOString().slice(0, 10);
  const renewable = d.contracts.filter((c) => ["actiu", "renovacio_pendent"].includes(c.status) && c.end_date && c.end_date >= t0);
  const openT = d.tasks.filter((t) => (OPEN_TASK as readonly string[]).includes(t.status));
  const openI = d.incidents.filter((i) => !["resolta", "tancada"].includes(i.status));
  const won = d.opps.filter((o) => o.stage === "guanyat" && inRange(o.won_at, d.range)).length;
  const lost = d.opps.filter((o) => o.stage === "perdut" && inRange(o.lost_at, d.range)).length;
  const kwh = inP.reduce((s, c) => s + (c.kwh ?? 0), 0);
  return {
    contractes_dia: live.filter((c) => inRange(signDay(c), today)).length,
    contractes_setmana: live.filter((c) => inRange(signDay(c), week)).length,
    contractes_mes: live.filter((c) => inRange(signDay(c), month)).length,
    contractes_periode: inP.length,
    contractes_introduits_avui: d.contracts.filter((c) => inRange(c.created_at, today)).length,
    activats: d.expedients.filter((e) => e.status === "activat" && inRange(e.activated_at ?? e.status_changed_at, d.range)).length,
    anullats: d.contracts.filter((c) => c.status === "anullat" && inRange(c.updated_at ?? c.created_at, d.range)).length + d.expedients.filter((e) => e.status === "rebutjat" && inRange(e.status_changed_at, d.range)).length,
    mwh: Math.round(kwh / 10) / 100,
    mwh_sense_consum: inP.filter((c) => c.kwh == null).length,
    leads: d.leads.filter((l) => inRange(l.created_at, d.range)).length,
    oportunitats: d.opps.filter((o) => !["guanyat", "perdut"].includes(o.stage)).length,
    propostes: d.opps.filter((o) => inRange(o.proposal_sent_at, d.range)).length,
    conversio: won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : null,
    ia_oportunitats: d.aiPending ?? null,
    expedients_pendents: openExp.length,
    tramitacio: openExp.filter((e) => EXP_PROCESSING.includes(e.status)).length,
    documentacio_incompleta: openExp.filter((e) => e.status === "pendent_documentacio").length,
    bloquejats: blocked.length,
    renovacions_urgents: renewable.filter((c) => c.end_date! <= in30).length,
    renovacions_120: renewable.filter((c) => c.end_date! <= in120).length,
    incidencies_obertes: openI.length,
    incidencies_urgents: openI.filter((i) => ["urgent", "alta"].includes(i.priority)).length,
    tasques_pendents: openT.length,
    tasques_vencudes: openT.filter((t) => t.due_at && new Date(t.due_at) < d.now).length,
    tasques_bloquejades: openT.filter((t) => t.status === "bloquejada").length,
  };
}
export type OperationalKpis = ReturnType<typeof operationalKpis>;

/** Sèrie mensual (12 mesos) de contractes, MWh, leads i propostes. */
export function commercialSeries(now: Date, contracts: CContract[], leads: CLead[], opps: COpp[]) {
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 7)); }
  return months.map((m) => {
    const cs = contracts.filter((c) => LIVE(c) && signDay(c).startsWith(m));
    return { month: m, contractes: cs.length, mwh: Math.round(cs.reduce((s, c) => s + (c.kwh ?? 0), 0) / 10) / 100, leads: leads.filter((l) => l.created_at.startsWith(m)).length, propostes: opps.filter((o) => o.proposal_sent_at?.startsWith(m)).length };
  });
}

/* ======================================================================= productivitat (activitat registrada, sense monitoratge) */

export type ProdInput = {
  range: { from: string; to: string };
  people: { id: string; name: string; role: string }[];
  contracts: { created_by: string | null; created_at: string }[];
  activations: { user_id: string | null; at: string }[];          // esdeveniments d'activació d'expedients
  expedientEvents: { user_id: string | null; at: string; type: string }[];
  tasks: { assigned_to: string | null; status: string; completed_at: string | null; created_at?: string; kind?: string | null; started_at?: string | null }[];
  incidents: { assigned_to: string | null; status: string; closed_at: string | null }[];
  leads: { owner_id: string | null; first_contact_at: string | null }[];
  proposals: { owner_id: string | null; proposal_sent_at: string | null }[];
  renewals: { user_id: string | null; at: string }[];              // tasques de renovació fetes o expedients de renovació
};

export function productivity(p: ProdInput) {
  const r = p.range;
  const row = (id: string) => {
    const done = p.tasks.filter((t) => t.assigned_to === id && t.status === "feta" && inRange(t.completed_at, r));
    // temps de gestió: només quan la tasca té inici i final registrats (dada fiable); altrament no es mostra
    const timed = done.filter((t) => t.started_at && t.completed_at).map((t) => (new Date(t.completed_at!).getTime() - new Date(t.started_at!).getTime()) / 3_600_000).filter((h) => h >= 0 && h < 24 * 60);
    return {
      contractes_introduits: p.contracts.filter((c) => c.created_by === id && inRange(c.created_at, r)).length,
      contractes_activats: p.activations.filter((a) => a.user_id === id && inRange(a.at, r)).length,
      expedients_tramitats: new Set(p.expedientEvents.filter((e) => e.user_id === id && inRange(e.at, r) && ["estat", "enviament", "signatura"].includes(e.type)).map((e) => `${e.at.slice(0, 10)}:${e.type}`)).size,
      tasques_finalitzades: done.length,
      tasques_pendents: p.tasks.filter((t) => t.assigned_to === id && (OPEN_TASK as readonly string[]).includes(t.status)).length,
      renovacions_gestionades: p.renewals.filter((x) => x.user_id === id && inRange(x.at, r)).length + done.filter((t) => t.kind === "renovacio").length,
      incidencies_resoltes: p.incidents.filter((i) => i.assigned_to === id && ["resolta", "tancada"].includes(i.status) && inRange(i.closed_at, r)).length,
      leads_treballats: p.leads.filter((l) => l.owner_id === id && inRange(l.first_contact_at, r)).length,
      propostes_enviades: p.proposals.filter((o) => o.owner_id === id && inRange(o.proposal_sent_at, r)).length,
      hores_mitjanes_tasca: timed.length >= 3 ? Math.round((timed.reduce((a, b) => a + b, 0) / timed.length) * 10) / 10 : null,
      tasques_amb_temps: timed.length,
    };
  };
  return p.people.map((x) => ({ ...x, ...row(x.id) }));
}

/* ======================================================================= escalats i alertes (idempotents) */

export type Notice = { user_id: string; kind: string; title: string; body?: string | null; link: { view: string; params: Record<string, string> }; rule_key: string };
export type EscalationPlan = { notifications: Notice[]; taskLevels: { id: string; level: number }[]; incidentLevels: { id: string; level: number }[] };

/**
 * Tasques vençudes: avís al responsable (nivell 0); als N1 dies s'escala a la Cap administrativa (nivell 1) i als N2 a
 * Direcció (nivell 2). Cada avís porta una clau única (tasca + nivell) i la base de dades rebutja duplicats.
 * Incidències urgents/altes obertes: avís al responsable i a la Cap; si passa el termini (o les hores configurades) → Direcció.
 */
export function planEscalations(a: {
  now: Date;
  rules: { key: string; params: Record<string, unknown> }[];
  tasks: CTask[]; incidents: CIncident[];
  capIds: string[]; direccioIds: string[];
  failures: { source: string; at: string; error: string }[];
}): EscalationPlan {
  const out: EscalationPlan = { notifications: [], taskLevels: [], incidentLevels: [] };
  const rule = (k: string) => a.rules.find((r) => r.key === k);
  const t = rule("tasca_vencuda");
  if (t) {
    const [d1, d2] = ((t.params.escalate_days as number[] | undefined) ?? [2, 5]).map(Number);
    for (const x of a.tasks) {
      if (!(OPEN_TASK as readonly string[]).includes(x.status) || !x.due_at) continue;
      const late = daysBetween(x.due_at, a.now);
      if (late <= 0) continue;
      const level = late >= d2 ? 2 : late >= d1 ? 1 : 0;
      const link = { view: "tasques", params: { id: x.id } };
      const title = x.title ?? "Tasca";
      if (x.assigned_to) out.notifications.push({ user_id: x.assigned_to, kind: "tasca", title: `Tasca vençuda: ${title}`, body: `Venç el ${x.due_at.slice(0, 10)}.`, link, rule_key: `t_venc:${x.id}:0` });
      if (level >= 1) for (const u of a.capIds) if (u !== x.assigned_to) out.notifications.push({ user_id: u, kind: "escalat", title: `Escalat: tasca vençuda fa ${Math.floor(late)} dies`, body: title, link, rule_key: `t_venc:${x.id}:1` });
      if (level >= 2 || (level >= 1 && !a.capIds.length)) for (const u of a.direccioIds) if (u !== x.assigned_to) out.notifications.push({ user_id: u, kind: "escalat", title: `Escalat a Direcció: tasca vençuda fa ${Math.floor(late)} dies`, body: title, link, rule_key: `t_venc:${x.id}:2` });
      const effective = level >= 1 && !a.capIds.length ? 2 : level;
      if (effective > (x.escalation_level ?? 0)) out.taskLevels.push({ id: x.id, level: effective });
    }
  }
  const inc = rule("incidencia_urgent");
  if (inc) {
    const [h1, h2] = ((inc.params.hours as number[] | undefined) ?? [4, 24]).map(Number);
    for (const i of a.incidents) {
      if (["resolta", "tancada"].includes(i.status) || !["urgent", "alta"].includes(i.priority)) continue;
      const age = (a.now.getTime() - new Date(i.opened_at).getTime()) / 3_600_000;
      const limit = i.priority === "urgent" ? h1 : h2;
      const overdue = (i.due_at && new Date(i.due_at) < a.now) || age >= (i.priority === "urgent" ? h2 : h2 * 2);
      const link = { view: "incidencies", params: { id: i.id } };
      const title = i.title ?? "Incidència";
      if (age >= 0) {
        const who = new Set([...(i.assigned_to ? [i.assigned_to] : []), ...a.capIds]);
        if (!who.size) a.direccioIds.forEach((u) => who.add(u));
        for (const u of who) out.notifications.push({ user_id: u, kind: "incidencia", title: `Incidència ${i.priority === "urgent" ? "urgent" : "d'alta prioritat"}: ${title}`, body: i.assigned_to ? null : "Sense responsable assignat.", link, rule_key: `inc:${i.id}:0` });
      }
      if (age >= limit && overdue) {
        for (const u of a.direccioIds) out.notifications.push({ user_id: u, kind: "escalat", title: `Escalat a Direcció: ${title}`, body: `Oberta fa ${Math.floor(age)} h sense resoldre.`, link, rule_key: `inc:${i.id}:2` });
        if ((i.escalation_level ?? 0) < 2) out.incidentLevels.push({ id: i.id, level: 2 });
      } else if (age >= limit && (i.escalation_level ?? 0) < 1) out.incidentLevels.push({ id: i.id, level: 1 });
    }
  }
  const err = rule("error_integracio");
  if (err) {
    const day = a.now.toISOString().slice(0, 10);
    const bySource = new Map<string, { at: string; error: string; n: number }>();
    for (const f of a.failures) {
      const hours = Number(err.params.hours ?? 24);
      if ((a.now.getTime() - new Date(f.at).getTime()) / 3_600_000 > hours) continue;
      const cur = bySource.get(f.source);
      bySource.set(f.source, { at: cur && cur.at > f.at ? cur.at : f.at, error: cur?.error ?? f.error, n: (cur?.n ?? 0) + 1 });
    }
    for (const [source, f] of bySource) for (const u of a.direccioIds) out.notifications.push({ user_id: u, kind: "integracio", title: `Error d'integració: ${source}`, body: `${f.n} error${f.n > 1 ? "s" : ""}. Últim: ${f.error.slice(0, 160)}`, link: { view: "centre-alertes", params: {} }, rule_key: `int:${source}:${day}` });
  }
  return out;
}

/* ======================================================================= qualitat i integritat de dades */

export type QualityIssue = { kind: string; severity: "alta" | "mitjana" | "baixa"; title: string; detail: string; entity: string; ids: string[]; link?: { view: string; params: Record<string, string> }; /** motiu pel qual el cas s'ignora automàticament (no és un error de dades) */ autoIgnore?: string };
/** Nota que acompanya els duplicats ignorats automàticament. */
export const SAME_CONTACT_NOTE = "Ignorat automàticament: mateix telèfon i mateix correu (la mateixa persona amb diversos subministraments o empreses)";
export const QUALITY_LABEL: Record<string, string> = {
  client_duplicat: "Clients duplicats", cups_duplicat: "CUPS duplicats", contracte_sense_titular: "Contractes sense titular", expedient_sense_responsable: "Expedients sense responsable",
  document_sense_vincle: "Documents sense vinculació", data_incorrecta: "Dates incorrectes", comissio_duplicada: "Comissions duplicades", liquidacio_incoherent: "Liquidacions incoherents",
  oportunitat_abandonada: "Oportunitats abandonades", tasca_sense_responsable: "Tasques sense responsable",
};

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const phoneKey = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^34(?=\d{9}$)/, "");
const emailKey = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Detecta problemes. NO fusiona ni esborra res: només proposa la revisió a una persona. */
export function detectQuality(d: {
  now: Date;
  clients: { id: string; name: string; tax_id: string | null; phone: string | null; email: string | null; archived_at: string | null }[];
  supplies: { id: string; cups: string; client_id: string; archived_at: string | null }[];
  contracts: { id: string; client_id: string | null; status: string; start_date: string | null; end_date: string | null; signed_at: string | null; owner_id: string | null }[];
  expedients: { id: string; code: string | null; status: string; owner_id: string | null }[];
  documents: { id: string; client_id: string | null; supply_id: string | null; contract_id: string | null; expedient_id: string | null; category: string }[];
  ledger: { id: string; contract_id: string | null; layer: string; kind: string; beneficiary_id: string | null; amount: string | number; period: string | null; idempotency_key?: string | null }[] | null;
  settlements: { id: string; code: string | null; status: string; total_gross: string | number; approved_amount: string | number | null; paid_amount?: string | number | null; lines_total?: number | null }[] | null;
  opps: { id: string; title: string; stage: string; last_activity_at: string | null; owner_id: string | null }[];
  tasks: { id: string; title: string; status: string; assigned_to: string | null }[];
}): QualityIssue[] {
  const out: QualityIssue[] = [];
  const live = d.clients.filter((c) => !c.archived_at);
  const group = <T,>(xs: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of xs) { const k = key(x); if (!k) continue; m.set(k, [...(m.get(k) ?? []), x]); } return [...m.values()].filter((g) => g.length > 1); };
  const reported = new Set<string>();
  for (const [label, key] of [["NIF/CIF", (c: (typeof live)[number]) => norm(c.tax_id)], ["telèfon", (c: (typeof live)[number]) => (phoneKey(c.phone).length >= 9 ? phoneKey(c.phone) : "")], ["correu", (c: (typeof live)[number]) => (c.email ?? "").trim().toLowerCase()]] as const) {
    for (const g of group(live, key)) {
      const sig = g.map((c) => c.id).sort().join(",");
      if (reported.has(sig)) continue;
      reported.add(sig);
      // mateix telèfon I mateix correu (i NIF diferent o buit): és la mateixa persona de contacte amb diverses empreses o
      // subministraments, no un duplicat. Es manté a la llista com a «ignorat automàticament» (es pot consultar).
      const samePerson = label !== "NIF/CIF" && phoneKey(g[0].phone).length >= 9 && !!emailKey(g[0].email)
        && g.every((c) => phoneKey(c.phone) === phoneKey(g[0].phone) && emailKey(c.email) === emailKey(g[0].email))
        && new Set(g.map((c) => norm(c.tax_id)).filter(Boolean)).size === g.filter((c) => norm(c.tax_id)).length;
      out.push({ kind: "client_duplicat", severity: label === "NIF/CIF" ? "alta" : "mitjana", title: `${g.length} clients amb el mateix ${samePerson ? "telèfon i correu" : label}`, detail: g.map((c) => c.name).join(" · "), entity: "crm_clients", ids: g.map((c) => c.id), link: { view: "client", params: { id: g[0].id } }, ...(samePerson ? { autoIgnore: SAME_CONTACT_NOTE } : {}) });
    }
  }
  // un CUPS pot estar a dos clients durant un canvi de titular; es marca per revisar, no s'unifica
  for (const g of group(d.supplies.filter((s) => !s.archived_at), (s) => s.cups.slice(0, 20))) {
    const clients = new Set(g.map((s) => s.client_id));
    out.push({ kind: "cups_duplicat", severity: clients.size > 1 ? "alta" : "mitjana", title: `CUPS ${g[0].cups.slice(0, 20)} repetit ${g.length} vegades`, detail: clients.size > 1 ? `A ${clients.size} clients diferents (possible canvi de titular)` : "Al mateix client", entity: "crm_supplies", ids: g.map((s) => s.id), link: { view: "client", params: { id: g[0].client_id } } });
  }
  for (const c of d.contracts) {
    if (!c.client_id) out.push({ kind: "contracte_sense_titular", severity: "alta", title: "Contracte sense titular", detail: c.id, entity: "crm_contracts", ids: [c.id] });
    const bad = (c.start_date && c.end_date && c.end_date < c.start_date) || (c.signed_at && c.start_date && c.start_date < c.signed_at.slice(0, 10) && daysBetween(c.start_date, new Date(c.signed_at)) > 366)
      || (c.end_date && c.end_date > `${d.now.getUTCFullYear() + 10}`) || (c.start_date && c.start_date < "1990");
    if (bad) out.push({ kind: "data_incorrecta", severity: "mitjana", title: "Dates de contracte incoherents", detail: `inici ${c.start_date ?? "—"} · fi ${c.end_date ?? "—"} · signatura ${c.signed_at?.slice(0, 10) ?? "—"}`, entity: "crm_contracts", ids: [c.id], link: c.client_id ? { view: "client", params: { id: c.client_id, tab: "contractes" } } : undefined });
  }
  for (const e of d.expedients) if (!e.owner_id && !EXP_DONE.includes(e.status)) out.push({ kind: "expedient_sense_responsable", severity: "alta", title: `Expedient ${e.code ?? ""} sense responsable`, detail: `Estat: ${e.status}`, entity: "crm_expedients", ids: [e.id], link: { view: "expedient", params: { id: e.id } } });
  for (const doc of d.documents) if (!doc.client_id && !doc.supply_id && !doc.contract_id && !doc.expedient_id) out.push({ kind: "document_sense_vincle", severity: "baixa", title: "Document sense vinculació", detail: doc.category, entity: "crm_documents", ids: [doc.id] });
  if (d.ledger) {
    // mateix contracte, capa, beneficiari, tipus, període i import → possible duplicat (la clau d'idempotència ja evita els tècnics)
    for (const g of group(d.ledger.filter((l) => ["meritacio", "cobrament", "confirmacio"].includes(l.kind)), (l) => [l.contract_id, l.layer, l.beneficiary_id ?? "-", l.kind, l.period, Number(l.amount).toFixed(2)].join("|"))) {
      out.push({ kind: "comissio_duplicada", severity: "alta", title: `Possible comissió duplicada (${g[0].kind})`, detail: `${g.length} moviments iguals de ${Number(g[0].amount).toFixed(2)} € al període ${g[0].period}`, entity: "fin_ledger", ids: g.map((l) => l.id) });
    }
  }
  if (d.settlements) for (const s of d.settlements) {
    const paid = Number(s.paid_amount ?? 0), approved = s.approved_amount == null ? null : Number(s.approved_amount), gross = Number(s.total_gross);
    const reasons: string[] = [];
    if (s.status === "pagada" && approved != null && Math.abs(paid - approved) > 0.005) reasons.push(`pagada però el pagat (${paid.toFixed(2)}) no coincideix amb l'aprovat (${approved.toFixed(2)})`);
    if (approved != null && paid - approved > 0.005) reasons.push("s'ha pagat més de l'aprovat");
    if (s.lines_total != null && Math.abs(s.lines_total - gross) > 0.005 && s.status !== "anullada") reasons.push(`les línies sumen ${s.lines_total.toFixed(2)} i el total és ${gross.toFixed(2)}`);
    if (reasons.length) out.push({ kind: "liquidacio_incoherent", severity: "alta", title: `Liquidació ${s.code ?? ""} incoherent`, detail: reasons.join("; "), entity: "fin_settlements", ids: [s.id], link: { view: "liquidacio", params: { id: s.id } } });
  }
  for (const o of d.opps) if (!["guanyat", "perdut"].includes(o.stage) && o.last_activity_at && daysBetween(o.last_activity_at, d.now) > 30) out.push({ kind: "oportunitat_abandonada", severity: "baixa", title: `Oportunitat sense activitat: ${o.title}`, detail: `${Math.floor(daysBetween(o.last_activity_at, d.now))} dies sense activitat`, entity: "crm_opportunities", ids: [o.id], link: { view: "oportunitat", params: { id: o.id } } });
  for (const t of d.tasks) if (!t.assigned_to && (OPEN_TASK as readonly string[]).includes(t.status)) out.push({ kind: "tasca_sense_responsable", severity: "mitjana", title: `Tasca sense responsable: ${t.title}`, detail: `Estat: ${t.status}`, entity: "crm_tasks", ids: [t.id], link: { view: "tasques", params: { id: t.id } } });
  const rank = { alta: 0, mitjana: 1, baixa: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
