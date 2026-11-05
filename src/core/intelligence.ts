/**
 * INTEL·LIGÈNCIA COMERCIAL (Fase 5) · nucli pur i determinista (sense xarxa ni base de dades).
 *
 *  · Detectors d'oportunitats a partir de files de la cartera (contractes, subministraments, clients…).
 *  · Anàlisi energètica reutilitzant el motor del comparador (`computeCost`/`runComparison`).
 *  · Selecció de les 3 millors alternatives pel COST ANUAL TOTAL estimat; la comissió no és cap entrada.
 *  · Escenari de sensibilitat SAS només quan està configurat i justificat (font i data obligatòries).
 *  · Puntuació 0-100 de prioritat de servei, amb factors explicats; la rendibilitat interna va a part.
 *
 * Regla d'or: si una dada no es coneix, no s'inventa. El preu actual desconegut es mostra com
 * «Pendent de factura o condicions actuals» i l'estalvi queda sense calcular.
 */
import { computeCost, normalizeTariff, periodsOf } from "@/comparator/engine";
import { runComparison } from "@/comparator/ranking";
import { DEFAULT_TAXES, ENGINE_VERSION, type CostResult, type OfferVersion, type PowerUnit, type PriceSheet, type SupplyInput, type TaxConfig } from "@/comparator/types";
import { computeCommission, money, pickRule, type Facts, type RuleRow } from "./commissions";
import type { Service } from "./sales";

/* ================================================================== constants */

export const PENDING_PRICE = "Pendent de factura o condicions actuals";
export const PROPOSAL_MESSAGE = "Experiència des de 2013 gestionant subministraments, amb atenció personalitzada i recerca de les millors condicions per als nostres clients.";
export const AI_ENGINE_VERSION = `ia-1.0.0+comparador-${ENGINE_VERSION}`;

export const AI_KINDS = ["renovacio", "estalvi", "contracte_car", "potencia", "recuperacio", "venda_creuada", "proposta_sense_resposta", "dades_incompletes", "tarifa_caducada"] as const;
export type AiKind = (typeof AI_KINDS)[number];
export const AI_KIND_LABEL: Record<AiKind, string> = {
  renovacio: "Renovació",
  estalvi: "Possible estalvi",
  contracte_car: "Contracte potencialment car",
  potencia: "Optimització de potència",
  recuperacio: "Recuperació de client",
  venda_creuada: "Venda creuada (comprovar interès)",
  proposta_sense_resposta: "Proposta sense resposta",
  dades_incompletes: "Dades incompletes",
  tarifa_caducada: "Tarifa caducada",
};
export const AI_STATUSES = ["nova", "revisada", "proposta_preparada", "acceptada", "guanyada", "descartada", "caducada"] as const;
export type AiStatus = (typeof AI_STATUSES)[number];
export const AI_STATUS_LABEL: Record<AiStatus, string> = { nova: "Nova", revisada: "Revisada", proposta_preparada: "Proposta preparada", acceptada: "Acceptada", guanyada: "Guanyada", descartada: "Descartada", caducada: "Caducada" };
export const OPEN_AI_STATUSES: AiStatus[] = ["nova", "revisada", "proposta_preparada", "acceptada"];
export const DRAFT_STATUS_LABEL = { esborrany: "Esborrany", aprovada: "Aprovada", enviada: "Enviada", acceptada: "Acceptada", rebutjada: "Rebutjada", anullada: "Anul·lada" } as const;
export type DraftStatus = keyof typeof DRAFT_STATUS_LABEL;

export interface MotorParams {
  renewal_days: number[];
  min_saving_eur: number;
  min_saving_pct: number;
  expensive_pct: number;
  inactive_days: number;
  proposal_days: number;
  min_power_saving_eur: number;
  max_comparisons: number;
  max_attempts: number;
}
export const DEFAULT_MOTOR: MotorParams = { renewal_days: [120, 90, 60, 30, 15], min_saving_eur: 60, min_saving_pct: 5, expensive_pct: 15, inactive_days: 365, proposal_days: 7, min_power_saving_eur: 100, max_comparisons: 400, max_attempts: 3 };
export function motorParams(p: Partial<MotorParams> | null | undefined): MotorParams {
  const m = { ...DEFAULT_MOTOR, ...(p ?? {}) };
  m.renewal_days = [...new Set((m.renewal_days ?? DEFAULT_MOTOR.renewal_days).filter((d) => Number.isFinite(d) && d > 0 && d <= 365))].sort((a, b) => b - a);
  if (!m.renewal_days.length) m.renewal_days = DEFAULT_MOTOR.renewal_days;
  return m;
}

/* ================================================================== utilitats */

const DAY = 86_400_000;
export const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / DAY);
const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const eur = (n: number) => `${n.toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const year = (iso: string) => iso.slice(0, 4);

export interface Evidence { label: string; value: string; source: string; date: string | null }

export interface Candidate {
  kind: AiKind;
  dedupeKey: string;
  clientId: string | null;
  supplyId?: string | null;
  contractId?: string | null;
  ownerId?: string | null;
  title: string;
  summary: string;
  evidence: Evidence[];
  milestone?: number | null;
  dueDate?: string | null;
  service?: Service | null;
  dataQuality: "complet" | "parcial" | "incomplet";
  contactAllowed?: boolean;
  /** factors de puntuació específics del detector */
  signals?: Partial<ScoreInput>;
}

/* ================================================================== 4.1 renovacions */

/** Finestra de renovació vigent: la més petita que encara inclou els dies que falten (120→90→60→30→15). */
export function renewalMilestone(endDate: string, today: string, days: number[] = DEFAULT_MOTOR.renewal_days): number | null {
  const left = daysBetween(today, endDate);
  const sorted = [...days].sort((a, b) => a - b);
  if (left < 0) return left >= -30 ? 0 : null; // vençut fa menys d'un mes: encara és renovació (0 = vençut)
  return sorted.find((d) => left <= d) ?? null;
}
export const renewalKey = (contractId: string, endDate: string) => `renovacio:${contractId}:${endDate}`;

export interface ContractRow { id: string; client_id: string; supply_id: string | null; retailer: string; product: string | null; end_date: string | null; start_date?: string | null; status: string; owner_id: string | null; client_owner_id?: string | null; client_name?: string | null; access_tariff?: string | null }

export function detectRenewals(contracts: ContractRow[], today: string, days: number[] = DEFAULT_MOTOR.renewal_days): Candidate[] {
  const out: Candidate[] = [];
  for (const k of contracts) {
    if (!k.end_date || !["actiu", "renovacio_pendent"].includes(k.status)) continue;
    const m = renewalMilestone(k.end_date, today, days);
    if (m == null) continue;
    const left = daysBetween(today, k.end_date);
    out.push({
      kind: "renovacio",
      dedupeKey: renewalKey(k.id, k.end_date),
      clientId: k.client_id, supplyId: k.supply_id, contractId: k.id, ownerId: k.owner_id ?? k.client_owner_id ?? null,
      title: `Renovació ${k.retailer}${k.client_name ? ` · ${k.client_name}` : ""}`,
      summary: left >= 0 ? `El contracte amb ${k.retailer} venç d'aquí a ${left} dies (${k.end_date}). Cal revisar les condicions abans del venciment.` : `El contracte amb ${k.retailer} va vèncer el ${k.end_date} i encara consta actiu.`,
      evidence: [{ label: "Data de venciment", value: k.end_date, source: "Contracte (CRM)", date: k.end_date }, { label: "Comercialitzadora actual", value: k.retailer + (k.product ? ` · ${k.product}` : ""), source: "Contracte (CRM)", date: null }],
      milestone: m, dueDate: k.end_date, dataQuality: "parcial",
      signals: { daysToDue: left },
    });
  }
  return out;
}

/* ================================================================== 4.6 propostes sense resposta */

export interface OppRow { id: string; client_id: string | null; title: string; stage: string; proposal_sent_at: string | null; last_activity_at: string | null; owner_id: string | null; service?: Service | null; supply_id?: string | null }
export function detectUnanswered(opps: OppRow[], lastHumanActivity: Record<string, string>, today: string, days: number): Candidate[] {
  const out: Candidate[] = [];
  for (const o of opps) {
    if (o.stage !== "proposta_enviada" || !o.proposal_sent_at || !o.client_id) continue;
    const age = daysBetween(o.proposal_sent_at, today);
    const last = lastHumanActivity[o.id];
    if (age < days || (last && last > o.proposal_sent_at)) continue;
    out.push({
      kind: "proposta_sense_resposta",
      dedupeKey: `proposta_sense_resposta:${o.id}:${o.proposal_sent_at.slice(0, 10)}`,
      clientId: o.client_id, supplyId: o.supply_id ?? null, ownerId: o.owner_id, service: o.service ?? null,
      title: `Proposta sense resposta · ${o.title}`,
      summary: `La proposta es va enviar fa ${age} dies i no hi ha cap activitat posterior registrada.`,
      evidence: [{ label: "Proposta enviada", value: o.proposal_sent_at.slice(0, 10), source: "Oportunitat comercial", date: o.proposal_sent_at.slice(0, 10) }],
      dueDate: today, dataQuality: "parcial",
      signals: { proposalAgeDays: age, lastActivityDays: last ? daysBetween(last, today) : age, needsFollowUp: true, conversion: 0.5 },
    });
  }
  return out;
}

/* ================================================================== 4.4 recuperació de clients */

export interface ClientRow { id: string; name: string; status: string; owner_id: string | null; commercial_opt_out: boolean; contact_preference: string; province?: string | null; last_activity_at: string | null; active_contracts: number; ended_contracts: number; annual_kwh: number | null; services: Service[]; interests?: Service[]; tags?: string[] }

export const contactAllowed = (c: Pick<ClientRow, "commercial_opt_out" | "contact_preference">) => !c.commercial_opt_out && c.contact_preference !== "cap";

export function detectRecovery(clients: ClientRow[], today: string, inactiveDays: number): Candidate[] {
  const out: Candidate[] = [];
  for (const c of clients) {
    if (!contactAllowed(c)) continue; // oposició comercial o «no contactar»: mai es proposa acció comercial
    if (c.active_contracts > 0 || c.status === "baixa" && c.ended_contracts === 0) continue;
    if (!(c.status === "inactiu" || c.ended_contracts > 0)) continue;
    const since = c.last_activity_at ? daysBetween(c.last_activity_at, today) : null;
    if (since != null && since < inactiveDays) continue;
    out.push({
      kind: "recuperacio",
      dedupeKey: `recuperacio:${c.id}:${year(today)}`,
      clientId: c.id, ownerId: c.owner_id,
      title: `Recuperar client · ${c.name}`,
      summary: `${c.ended_contracts ? `Té ${c.ended_contracts} contracte(s) finalitzat(s) i cap d'actiu. ` : "Client inactiu. "}${since != null ? `Últim contacte fa ${since} dies.` : "Sense contactes registrats."}${c.contact_preference !== "qualsevol" ? ` Preferència de contacte: ${c.contact_preference}.` : ""}`,
      evidence: [
        { label: "Contractes finalitzats", value: String(c.ended_contracts), source: "Contractes (CRM)", date: null },
        { label: "Últim contacte", value: c.last_activity_at?.slice(0, 10) ?? "Cap", source: "Activitat (CRM)", date: c.last_activity_at?.slice(0, 10) ?? null },
        ...(c.annual_kwh ? [{ label: "Consum anual conegut", value: `${Math.round(c.annual_kwh).toLocaleString("ca-ES")} kWh`, source: "Subministraments (CRM/SIPS)", date: null }] : []),
      ],
      dataQuality: c.annual_kwh ? "parcial" : "incomplet",
      contactAllowed: true,
      signals: { annualKwh: c.annual_kwh, lastActivityDays: since, relationship: c.ended_contracts > 0 ? 1 : 0.5, conversion: c.ended_contracts > 0 ? 0.4 : 0.2 },
    });
  }
  return out;
}

/* ================================================================== 4.5 venda creuada */

export const CROSS_SELL_GROUPS: { key: string; label: string; services: Service[] }[] = [
  { key: "electricitat", label: "Electricitat", services: ["llum_residencial", "llum_empresa"] },
  { key: "gas", label: "Gas", services: ["gas"] },
  { key: "fibra", label: "Fibra i telefonia", services: ["fibra_telefonia"] },
  { key: "assegurances", label: "Assegurances", services: ["assegurances"] },
  { key: "alarmes", label: "Alarmes", services: ["alarmes"] },
];

/**
 * Venda creuada: el client ja té algun servei actiu. No s'assumeix necessitat: l'oportunitat és per COMPROVAR
 * l'interès. Si hi ha interès registrat (lead, oportunitat perduda per «més endavant», etiqueta «interes:…»),
 * es prioritza i es cita la font. Mai per a clients amb oposició comercial.
 */
export function detectCrossSell(clients: ClientRow[], today: string): Candidate[] {
  const out: Candidate[] = [];
  for (const c of clients) {
    if (!contactAllowed(c) || c.active_contracts === 0) continue;
    const has = new Set(c.services);
    const missing = CROSS_SELL_GROUPS.filter((g) => !g.services.some((s) => has.has(s)));
    if (!missing.length || missing.length === CROSS_SELL_GROUPS.length) continue;
    const interest = new Set([...(c.interests ?? []), ...(c.tags ?? []).filter((t) => t.startsWith("interes:")).map((t) => t.slice(8) as Service)]);
    const withInterest = missing.filter((g) => g.services.some((s) => interest.has(s)) || interest.has(g.key as Service));
    out.push({
      kind: "venda_creuada",
      dedupeKey: `venda_creuada:${c.id}:${year(today)}`,
      clientId: c.id, ownerId: c.owner_id,
      title: `Comprovar interès en altres serveis · ${c.name}`,
      summary: withInterest.length
        ? `Interès registrat en: ${withInterest.map((g) => g.label).join(", ")}. Cal confirmar-lo amb el client abans de preparar cap oferta.`
        : `Té ${c.services.length ? "serveis actius" : "contractes actius"} però no consta ${missing.map((g) => g.label.toLowerCase()).join(", ")}. No s'ha de suposar que els necessita: només comprovar-ho en el proper contacte.`,
      evidence: [
        { label: "Serveis actius", value: CROSS_SELL_GROUPS.filter((g) => g.services.some((s) => has.has(s))).map((g) => g.label).join(", ") || "—", source: "Contractes i oportunitats guanyades (CRM)", date: null },
        { label: "Interès registrat", value: withInterest.map((g) => g.label).join(", ") || "Cap", source: "Leads, oportunitats i etiquetes (CRM)", date: null },
      ],
      dataQuality: "parcial", contactAllowed: true,
      signals: { conversion: withInterest.length ? 0.5 : 0.1, relationship: 1, lastActivityDays: c.last_activity_at ? daysBetween(c.last_activity_at, today) : null },
    });
  }
  return out;
}

/* ================================================================== dades incompletes */

export interface SupplyRow { id: string; client_id: string; cups: string; energy_type: "luz" | "gas"; access_tariff: string | null; power_kw: (number | null)[] | null; annual_kwh: number | null; period_kwh: (number | null)[] | null; province: string | null; current_retailer: string | null; owner_id?: string | null; client_name?: string | null }

export function supplyGaps(s: SupplyRow): string[] {
  const g: string[] = [];
  if (!normalizeTariff(s.access_tariff)) g.push("Tarifa d'accés");
  if (s.energy_type === "luz" && !(s.power_kw ?? []).some((x) => x != null && x > 0)) g.push("Potències contractades");
  if (s.annual_kwh == null && !(s.period_kwh ?? []).some((x) => x != null)) g.push("Consum anual");
  if (!s.current_retailer) g.push("Comercialitzadora actual");
  return g;
}
export function dataQualityOf(gaps: string[], currentKnown: boolean): "complet" | "parcial" | "incomplet" {
  if (!gaps.length && currentKnown) return "complet";
  if (gaps.length <= 1) return "parcial";
  return "incomplet";
}

export function detectIncomplete(supplies: SupplyRow[], contractsWithoutEnd: ContractRow[]): Candidate[] {
  const out: Candidate[] = [];
  for (const s of supplies) {
    const gaps = supplyGaps(s);
    if (!gaps.length) continue;
    out.push({
      kind: "dades_incompletes", dedupeKey: `dades_incompletes:supply:${s.id}`,
      clientId: s.client_id, supplyId: s.id, ownerId: s.owner_id ?? null,
      title: `Completar dades · ${s.cups}`,
      summary: `Falten dades per poder analitzar el subministrament: ${gaps.join(", ")}.`,
      evidence: gaps.map((g) => ({ label: "Dada que falta", value: g, source: "Subministrament (CRM)", date: null })),
      dataQuality: "incomplet", signals: { needsFollowUp: true },
    });
  }
  for (const k of contractsWithoutEnd) {
    out.push({
      kind: "dades_incompletes", dedupeKey: `dades_incompletes:contract:${k.id}`,
      clientId: k.client_id, supplyId: k.supply_id, contractId: k.id, ownerId: k.owner_id ?? k.client_owner_id ?? null,
      title: `Contracte sense data de venciment · ${k.retailer}`,
      summary: "Sense data de venciment no es pot preparar la renovació a temps.",
      evidence: [{ label: "Dada que falta", value: "Data de venciment", source: "Contracte (CRM)", date: null }],
      dataQuality: "incomplet", signals: { needsFollowUp: true },
    });
  }
  return out;
}

/* ================================================================== tarifes caducades */

export function isOfferValid(o: Pick<OfferVersion, "status" | "validFrom" | "validTo">, today: string) {
  return o.status === "activa" && (!o.validTo || o.validTo >= today) && (!o.validFrom || o.validFrom <= today);
}
export function detectExpiredTariffs(offers: OfferVersion[], today: string): Candidate[] {
  return offers
    .filter((o) => o.validTo && o.validTo < today && (o.status === "activa" || (o.status === "caducada" && daysBetween(o.validTo, today) <= 30)))
    .map((o) => ({
      kind: "tarifa_caducada" as const, dedupeKey: `tarifa_caducada:${o.id}`, clientId: null,
      title: `Tarifa caducada · ${o.supplierName} ${o.productName} v${o.version}`,
      summary: `La validesa va acabar el ${o.validTo}. S'exclou de les comparatives i de les propostes; cal publicar-ne una versió nova o arxivar-la al catàleg.`,
      evidence: [{ label: "Vàlida fins", value: o.validTo!, source: o.source ?? "Catàleg de tarifes", date: o.validTo }],
      dataQuality: "complet" as const, signals: { needsFollowUp: true },
    }));
}

/* ================================================================== condicions actuals */

export interface CurrentConditions { energy_eur_kwh?: (number | null)[] | null; power_eur_kw_day?: (number | null)[] | null; power_unit?: string | null; gas_fixed_eur_day?: number | null; price_type?: string | null; monthly_fee_eur?: number | null; discount_pct?: number | null; permanence_months?: number | null; penalty?: string | null }

const unitOf = (u: string | null | undefined): PowerUnit => (u === "eur_kw_mes" || u === "eur_kw_any" ? u : "eur_kw_dia");

/** Condicions acceptades (Fase 3) → full de preus del comparador. Si falten preus, retorna null (no s'inventa res). */
export function sheetFromConditions(c: CurrentConditions | null | undefined, energyType: "luz" | "gas"): { sheet: PriceSheet | null; missing: string[] } {
  if (!c) return { sheet: null, missing: ["Condicions actuals"] };
  const energy = (c.energy_eur_kwh ?? []).map((x) => (x == null ? null : Number(x)));
  const power = (c.power_eur_kw_day ?? []).map((x) => (x == null ? null : Number(x)));
  const missing: string[] = [];
  if (!energy.some((x) => x != null)) missing.push("Preu actual de l'energia");
  if (energyType === "luz" && !power.some((x) => x != null)) missing.push("Preu actual de la potència");
  if (c.price_type === "indexat") missing.push("Fórmula de l'indexat actual");
  if (missing.length) return { sheet: null, missing };
  const single = energy.filter((x) => x != null).length === 1 && energy[0] != null;
  return {
    sheet: {
      contractType: c.price_type === "mixt" ? "mixt" : single ? "fix24h" : "periodes",
      energy: single ? [] : energy, energy24h: single ? energy[0] : null,
      power, powerUnit: unitOf(c.power_unit),
      gasFixedEurDay: c.gas_fixed_eur_day ?? null,
      taxTreatment: "sense_impostos",
      sas: { mode: "exclos", eurKwh: null },
      fees: c.monthly_fee_eur ? [{ concept: "Quota mensual", eurMonth: c.monthly_fee_eur }] : [],
      discounts: c.discount_pct ? [{ concept: "Descompte pactat", pct: c.discount_pct, eurYear: null, base: "energia" }] : [],
    },
    missing: [],
  };
}

/** Subministrament del CRM → entrada del comparador (any complet). */
export function supplyInputFrom(s: SupplyRow, sources: { kwh: "sips" | "crm" | "factura" | "manual"; kw: "sips" | "crm" | "factura" | "manual" } = { kwh: "crm", kw: "crm" }): { input: SupplyInput | null; missing: string[] } {
  const tariff = normalizeTariff(s.access_tariff);
  const per = periodsOf(tariff, s.energy_type);
  const missing: string[] = [];
  if (!tariff || !per.known) missing.push("Tarifa d'accés");
  const kwh = (s.period_kwh ?? []).slice(0, per.energy).map((x) => (x == null ? null : Number(x)));
  const total = s.annual_kwh != null ? Number(s.annual_kwh) : kwh.some((x) => x != null) ? kwh.reduce<number>((a, b) => a + (b ?? 0), 0) : null;
  if (total == null) missing.push("Consum anual");
  const kw = (s.power_kw ?? []).slice(0, per.power).map((x) => (x == null ? null : Number(x)));
  if (s.energy_type === "luz" && !kw.some((x) => x != null && x > 0)) missing.push("Potències contractades");
  if (missing.length) return { input: null, missing };
  const province = norm(s.province);
  const territory = /tenerife|palmas|canari/.test(province) ? "canaries" : /balear|mallorca|illes/.test(province) ? "balears" : province === "ceuta" ? "ceuta" : province === "melilla" ? "melilla" : "peninsula";
  return {
    input: {
      energyType: s.energy_type, accessTariff: tariff, territory, segment: null, days: 365, basis: "anual",
      kwh: kwh.some((x) => x != null) ? kwh : [], kwhTotal: total, kw, meterRentEurMonth: null,
      sources: { kwh: sources.kwh, kw: sources.kw, prices: null },
    },
    missing: [],
  };
}

/* ================================================================== SAS */

export interface SasConfig { enabled: boolean; min_eur_kwh: number; max_eur_kwh: number; retailers: string[]; justification: string; source: string; as_of: string | null }
export interface SasScenario { offerId: string; retailer: string; minEurKwh: number; maxEurKwh: number; extraMinEur: number; extraMaxEur: number; totalMinEur: number; totalMaxEur: number; source: string; asOf: string; justification: string; label: string }

/** El SAS s'aplica només si: escenari activat, font i data informades, comercialitzadora inclosa i l'oferta el factura a part sense valor. */
export function sasScenarioFor(offer: OfferVersion, supply: SupplyInput, cfg: SasConfig | null | undefined, taxes: TaxConfig = DEFAULT_TAXES): SasScenario | null {
  if (!cfg?.enabled || !cfg.source?.trim() || !cfg.as_of) return null;
  if (offer.energyType !== "luz" || offer.sas.mode !== "variable" || offer.sas.eurKwh != null) return null;
  const name = norm(offer.supplierName);
  if (!cfg.retailers.some((r) => norm(r) && (name === norm(r) || name.includes(norm(r))))) return null;
  const lo = Math.min(cfg.min_eur_kwh, cfg.max_eur_kwh), hi = Math.max(cfg.min_eur_kwh, cfg.max_eur_kwh);
  const low = computeCost({ ...offer, sas: { mode: "variable", eurKwh: lo } }, supply, taxes);
  const high = computeCost({ ...offer, sas: { mode: "variable", eurKwh: hi } }, supply, taxes);
  if (!low.ok || !high.ok) return null;
  return {
    offerId: offer.id, retailer: offer.supplierName, minEurKwh: lo, maxEurKwh: hi,
    extraMinEur: low.sas, extraMaxEur: high.sas, totalMinEur: low.total, totalMaxEur: high.total,
    source: cfg.source.trim(), asOf: cfg.as_of, justification: cfg.justification,
    label: "Escenari de sensibilitat: no és un cost regulat confirmat",
  };
}

/* ================================================================== anàlisi i 3 alternatives */

export interface Alternative {
  rank: number;
  offerId: string; supplier: string; product: string; version: number;
  validFrom: string | null; validTo: string | null; source: string | null;
  contractType: string; accessTariff: string;
  annualCost: number; annualCostExTax: number;
  recurring: { energy: number; sas: number; power: number; fixed: number; discounts: number; taxes: number; rent: number };
  saving: number | null; savingPct: number | null; savingLabel: string;
  permanenceMonths: number | null; priceGuaranteeMonths: number | null; penalty: string | null;
  sas: { mode: string; eurKwh: number | null; label: string };
  quality: CostResult["quality"]; notes: string[];
  reasons: string[]; tags: string[];
}
export interface OneOffCost { concept: string; amount: number | null; note: string }
export interface Analysis {
  ok: boolean;
  reason: string | null;
  engineVersion: string;
  asOf: string;
  current: { known: boolean; label: string; retailer: string | null; annualCost: number | null; quality: CostResult["quality"] | null; source: string | null; date: string | null };
  alternatives: Alternative[];
  evaluated: number;
  excluded: { offerId: string; supplier: string; product: string; reasons: string[] }[];
  sasScenarios: SasScenario[];
  oneOff: OneOffCost[];
  hypotheses: string[];
  missing: string[];
}

const ORD = ["Primera", "Segona", "Tercera"];

export interface AnalyseInput {
  supply: SupplyInput | null;
  supplyMissing?: string[];
  current: PriceSheet | null;
  currentMissing?: string[];
  currentRetailer: string | null;
  currentSource?: { label: string; date: string | null } | null;
  currentContract?: { endDate: string | null; permanenceMonths?: number | null; startDate?: string | null; penalty?: string | null } | null;
  offers: OfferVersion[];
  today: string;
  sas?: SasConfig | null;
  taxes?: TaxConfig;
}

/**
 * Calcula totes les tarifes vigents i elegibles i en tria 3 pel cost anual total (amb impostos).
 * Desempat: sense permanència, després preu garantit més llarg. Les comissions no hi intervenen.
 */
export function analyseSupply(p: AnalyseInput): Analysis {
  const taxes = p.taxes ?? DEFAULT_TAXES;
  const base: Analysis = {
    ok: false, reason: null, engineVersion: AI_ENGINE_VERSION, asOf: p.today,
    current: { known: false, label: PENDING_PRICE, retailer: p.currentRetailer, annualCost: null, quality: null, source: p.currentSource?.label ?? null, date: p.currentSource?.date ?? null },
    alternatives: [], evaluated: 0, excluded: [], sasScenarios: [], oneOff: [], hypotheses: [], missing: [...(p.supplyMissing ?? [])],
  };
  if (!p.supply) {
    base.reason = `Dades insuficients per comparar: ${(p.supplyMissing ?? ["dades del subministrament"]).join(", ")}.`;
    return base;
  }
  const s = p.supply;
  const valid: OfferVersion[] = [];
  for (const o of p.offers) {
    if (o.energyType !== s.energyType) continue;
    if (!isOfferValid(o, p.today)) {
      base.excluded.push({ offerId: o.id, supplier: o.supplierName, product: o.productName, reasons: [o.validTo && o.validTo < p.today ? `Caducada el ${o.validTo}` : `Estat ${o.status}`] });
      continue;
    }
    valid.push(o);
  }
  const run = runComparison({ supply: s, current: p.current, offers: valid, taxes, today: p.today });
  base.evaluated = run.evaluations.length;
  for (const e of run.evaluations) if (!e.eligibility.eligible || !e.cost.ok) base.excluded.push({ offerId: e.offer.id, supplier: e.offer.supplierName, product: e.offer.productName, reasons: e.eligibility.eligible ? e.cost.missing.map((m) => `Falta: ${m}`) : e.eligibility.reasons });
  const currentOk = !!run.current?.ok;
  if (currentOk) base.current = { ...base.current, known: true, label: p.currentSource?.label ?? "Condicions actuals", annualCost: run.current!.total, quality: run.current!.quality };
  else base.missing.push(...(p.currentMissing?.length ? p.currentMissing : ["Preus actuals"]));
  // Si hi ha un escenari SAS justificat per a l'oferta, el cost inclou el MÍNIM de l'escenari com a estimació
  // (marcada com a estimada): així no es afavoreix una oferta per ometre un component que se sap que es cobrarà.
  const pool = run.evaluations
    .filter((e) => e.eligibility.eligible && e.cost.ok)
    .map((e) => {
      const sc = sasScenarioFor(e.offer, s, p.sas, taxes);
      return sc ? { ...e, cost: computeCost({ ...e.offer, sas: { mode: "variable", eurKwh: sc.minEurKwh } }, s, taxes), sasScenario: sc } : { ...e, sasScenario: null as SasScenario | null };
    })
    .sort((a, b) => a.cost.total - b.cost.total || (a.offer.permanenceMonths ?? 0) - (b.offer.permanenceMonths ?? 0) || (b.offer.priceGuaranteeMonths ?? 0) - (a.offer.priceGuaranteeMonths ?? 0) || a.offer.id.localeCompare(b.offer.id));
  if (!pool.length) {
    const why = [...new Set(base.excluded.flatMap((x) => x.reasons))].slice(0, 3);
    base.reason = valid.length ? `Cap tarifa vigent és elegible o calculable amb les dades disponibles${why.length ? ` (${why.join("; ")})` : ""}.` : "No hi ha tarifes vigents al catàleg per a aquest tipus de subministrament.";
    return base;
  }
  const best = pool[0].cost.total;
  base.sasScenarios = pool.slice(0, 3).map((e) => e.sasScenario).filter((x): x is SasScenario => !!x);
  base.alternatives = pool.slice(0, 3).map((e, i) => {
    const c = e.cost;
    const saving = currentOk ? r2(run.current!.total - c.total) : null;
    const savingPct = saving != null && run.current!.total > 0 ? r2((saving / run.current!.total) * 100) : null;
    const reasons: string[] = [i === 0 ? "Cost anual total més baix de les tarifes vigents i elegibles" : `${ORD[i]} opció per cost anual total (+${eur(r2(c.total - best))} respecte de la primera)`];
    if (saving != null) reasons.push(saving > 0 ? `Estalvi estimat de ${eur(saving)} l'any (${savingPct} %) respecte de les condicions actuals` : `No millora el cost actual (${eur(-saving)} més l'any)`);
    else reasons.push(`Estalvi: ${PENDING_PRICE.toLowerCase()}`);
    reasons.push(e.offer.permanenceMonths ? `Permanència de ${e.offer.permanenceMonths} mesos${e.offer.penalty ? ` (${e.offer.penalty})` : ""}` : "Sense permanència");
    if (e.offer.priceGuaranteeMonths) reasons.push(`Preu garantit ${e.offer.priceGuaranteeMonths} mesos`);
    if (e.offer.contractType === "indexat" || e.offer.contractType === "mixt") reasons.push("Preu exposat al mercat (indexat/mixt): el cost real pot variar");
    if (e.offer.sas.mode === "variable" && e.offer.sas.eurKwh == null) {
      const sc = e.sasScenario;
      reasons.push(sc ? `Inclou una estimació del SAS de ${sc.minEurKwh} €/kWh (mínim de l'escenari; no és un cost regulat confirmat): amb el màxim seria ${eur(sc.totalMaxEur)}` : "El SAS es factura a part i no és dins d'aquest cost: el cost real serà superior");
    }
    if (c.quality !== "exacte") reasons.push("Inclou valors estimats: vegeu les notes del càlcul");
    return {
      rank: i + 1,
      offerId: e.offer.id, supplier: e.offer.supplierName, product: e.offer.productName, version: e.offer.version,
      validFrom: e.offer.validFrom, validTo: e.offer.validTo, source: e.offer.source,
      contractType: e.offer.contractType, accessTariff: e.offer.accessTariff,
      annualCost: c.total, annualCostExTax: c.totalExTax,
      recurring: { energy: c.energy, sas: c.sas, power: c.power, fixed: c.fixed, discounts: c.discounts, taxes: r2(c.iee + c.vat), rent: c.rent },
      saving, savingPct, savingLabel: saving != null ? eur(saving) : PENDING_PRICE,
      permanenceMonths: e.offer.permanenceMonths, priceGuaranteeMonths: e.offer.priceGuaranteeMonths, penalty: e.offer.penalty,
      sas: { mode: e.offer.sas.mode, eurKwh: e.sasScenario ? e.sasScenario.minEurKwh : e.offer.sas.eurKwh, label: e.offer.sas.mode === "inclos" ? "Inclòs al preu" : e.offer.sas.mode === "exclos" ? "No aplicable" : e.sasScenario ? `A part · inclòs com a estimació mínima de l'escenari (${e.sasScenario.minEurKwh} €/kWh)` : e.offer.sas.eurKwh != null ? `A part (estimat ${e.offer.sas.eurKwh} €/kWh)` : "A part, sense valor publicat (no inclòs al total)" },
      quality: c.quality, notes: c.notes, reasons, tags: e.tags,
    };
  });
  // costos únics (no recurrents): penalització per sortir abans d'hora del contracte actual
  const cc = p.currentContract;
  if (cc?.permanenceMonths && cc.startDate) {
    const until = new Date(Date.parse(cc.startDate) + 0);
    until.setUTCMonth(until.getUTCMonth() + cc.permanenceMonths);
    const untilIso = until.toISOString().slice(0, 10);
    if (untilIso > p.today) {
      const fixed = cc.penalty?.match(/(\d+(?:[.,]\d+)?)\s*€/);
      base.oneOff.push({ concept: "Penalització per sortida anticipada del contracte actual", amount: fixed ? Number(fixed[1].replace(",", ".")) : null, note: `Permanència vigent fins al ${untilIso}${cc.penalty ? `: ${cc.penalty}` : ". Import no informat: cal revisar-lo al contracte."}` });
    }
  }
  base.hypotheses = [
    `Consum anual de ${Math.round(s.kwhTotal ?? 0).toLocaleString("ca-ES")} kWh (font: ${s.sources?.kwh ?? "CRM"}) i ${s.days} dies de càlcul.`,
    s.kwh.some((x) => x != null) ? "Distribució per períodes segons les dades del subministrament." : "Sense distribució per períodes: s'aplica el consum total segons el tipus de tarifa.",
    `Impostos amb la configuració vigent del comparador (impost elèctric ${taxes.ieePct} %, ${taxes.vat[s.territory].label} ${taxes.vat[s.territory].pct} %).`,
    `Tarifes vigents al catàleg a ${p.today}; ${base.excluded.length} tarifa(es) excloses (caducades, no elegibles o incompletes).`,
    "L'ordre de les alternatives depèn només del cost anual estimat per al client; les comissions no hi intervenen.",
    ...(currentOk ? [`Preus actuals: ${p.currentSource?.label ?? "condicions registrades"}${p.currentSource?.date ? ` (${p.currentSource.date})` : ""}.`] : [`Preu actual desconegut: ${PENDING_PRICE}. No es calcula cap estalvi.`]),
    ...(base.alternatives.some((a) => a.sas.mode === "variable" && a.sas.eurKwh == null) ? ["Algunes ofertes facturen el SAS a part sense valor publicat: no s'inclou al cost anual."] : []),
  ];
  base.ok = true;
  return base;
}

/** Classifica el resultat: contracte car (≥ expensive_pct), estalvi (≥ mínims) o res. Sense preu actual → null. */
export function classifySaving(a: Analysis, m: Pick<MotorParams, "min_saving_eur" | "min_saving_pct" | "expensive_pct">): "contracte_car" | "estalvi" | null {
  const top = a.alternatives[0];
  if (!a.ok || !top || top.saving == null || top.savingPct == null) return null;
  if (top.savingPct >= m.expensive_pct && top.saving >= m.min_saving_eur) return "contracte_car";
  if (top.saving >= m.min_saving_eur && top.savingPct >= m.min_saving_pct) return "estalvi";
  return null;
}

/* ================================================================== potència (mòdul existent) */

export interface PowerSummary { ok: boolean; reason?: string; currentKw: (number | null)[]; proposedKw: number[]; netSavingLB: number; confidenceLevel: string; confidenceReasons: string[]; needed: string[]; violations: number }

/** Mai una reducció definitiva: només suggeriment pendent de validació tècnica, i només amb confiança suficient. */
export function powerCandidate(s: SupplyRow, p: PowerSummary, today: string, minEur: number): Candidate | null {
  if (!p.ok || p.netSavingLB < minEur || p.violations > 0) return null;
  if (p.confidenceLevel === "Muy baja" || p.confidenceLevel === "Baja") return null;
  const changes = p.proposedKw.map((v, i) => `P${i + 1}: ${p.currentKw[i] ?? "—"} → ${v} kW`).join(" · ");
  return {
    kind: "potencia", dedupeKey: `potencia:${s.id}:${year(today)}`,
    clientId: s.client_id, supplyId: s.id, ownerId: s.owner_id ?? null,
    title: `Revisar potències · ${s.cups}`,
    summary: `Possible ajust de potències amb un estalvi net estimat (cota inferior) de ${eur(r2(p.netSavingLB))} l'any. Pendent de validació tècnica: no és una recomanació definitiva.`,
    evidence: [
      { label: "Ajust suggerit", value: changes, source: "Optimitzador de potències (escenari equilibrat)", date: today },
      { label: "Confiança", value: p.confidenceLevel, source: "Optimitzador de potències", date: today },
      ...p.needed.map((n) => ({ label: "Cal validar", value: n, source: "Optimitzador de potències", date: null })),
      { label: "Abans de modificar", value: "Revisar maxímetre/ICP, restriccions contractuals i drets d'accés; l'ajust el valida un tècnic", source: "Criteri intern", date: null },
    ],
    dataQuality: p.confidenceLevel === "Alta" ? "complet" : "parcial",
    signals: { powerSavingEur: p.netSavingLB },
  };
}

/* ================================================================== puntuació 0-100 */

export interface ScoreInput {
  daysToDue: number | null;
  savingEur: number | null;
  savingPct: number | null;
  annualKwh: number | null;
  dataQuality: "complet" | "parcial" | "incomplet";
  conversion: number | null;          // 0-1, només si hi ha evidència (etapa, interès registrat…)
  proposalAgeDays: number | null;
  lastActivityDays: number | null;
  needsFollowUp: boolean;
  powerSavingEur: number | null;
  relationship: number | null;
}
export type ScoreWeights = Record<"venciment" | "estalvi" | "volum" | "qualitat_dades" | "conversio" | "antiguitat_proposta" | "ultima_activitat" | "seguiment", number>;
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = { venciment: 20, estalvi: 25, volum: 10, qualitat_dades: 10, conversio: 10, antiguitat_proposta: 10, ultima_activitat: 5, seguiment: 10 };
export interface ScoreFactor { key: string; label: string; weight: number; value: number; points: number; explanation: string; applicable: boolean }

export function scoreOpportunity(si: Partial<ScoreInput>, weights: Partial<ScoreWeights> = DEFAULT_SCORE_WEIGHTS): { score: number; factors: ScoreFactor[] } {
  const w = { ...DEFAULT_SCORE_WEIGHTS, ...weights };
  const f: ScoreFactor[] = [];
  // un factor sense dades que no correspon al cas (p. ex. antiguitat de proposta en una renovació) no puntua ni resta
  const add = (key: keyof ScoreWeights, label: string, value: number, explanation: string, applicable = true) => f.push({ key, label, weight: Math.max(0, w[key] ?? 0), value: applicable ? Math.max(0, Math.min(1, value)) : 0, points: 0, explanation: applicable ? explanation : `${explanation} (no aplicable)`, applicable });
  const d = si.daysToDue;
  add("venciment", "Proximitat del venciment", d == null ? 0 : d <= 15 ? 1 : d <= 30 ? 0.85 : d <= 60 ? 0.6 : d <= 90 ? 0.4 : d <= 120 ? 0.25 : 0.05, d == null ? "Sense data de venciment rellevant" : d < 0 ? `Vençut fa ${-d} dies` : `Venç d'aquí a ${d} dies`, d != null);
  const sv = si.savingPct != null ? Math.min(1, Math.max(0, si.savingPct) / 20) * 0.7 + Math.min(1, Math.max(0, si.savingEur ?? 0) / 1000) * 0.3 : si.powerSavingEur != null ? Math.min(1, si.powerSavingEur / 1000) * 0.6 : 0;
  add("estalvi", "Estalvi potencial (estimat)", sv, si.savingPct != null ? `Estalvi estimat ${si.savingEur != null ? eur(si.savingEur) : "—"} (${si.savingPct.toLocaleString("ca-ES")} %)` : si.powerSavingEur != null ? `Estalvi de potència estimat ${eur(si.powerSavingEur)} (cota inferior)` : "Estalvi desconegut (sense preu actual o no aplicable): no puntua");
  add("volum", "Volum energètic", si.annualKwh ? Math.min(1, Math.log10(Math.max(1, si.annualKwh)) / 6) : 0, si.annualKwh ? `${Math.round(si.annualKwh).toLocaleString("ca-ES")} kWh/any` : "Consum desconegut");
  add("qualitat_dades", "Qualitat de les dades", si.dataQuality === "complet" ? 1 : si.dataQuality === "parcial" ? 0.5 : 0.15, si.dataQuality === "complet" ? "Dades completes i preu actual conegut" : si.dataQuality === "parcial" ? "Dades parcials" : "Dades incompletes");
  add("conversio", "Probabilitat de conversió (evidència)", si.conversion ?? 0, si.conversion != null ? `Basada en evidències registrades (${Math.round(si.conversion * 100)} %)` : "Sense evidències suficients: no es fan prediccions opaques", si.conversion != null);
  const pa = si.proposalAgeDays;
  add("antiguitat_proposta", "Antiguitat de la proposta", pa == null ? 0 : pa >= 14 ? 1 : pa >= 7 ? 0.7 : pa >= 3 ? 0.4 : 0.1, pa == null ? "Sense proposta pendent" : `Proposta enviada fa ${pa} dies`, pa != null);
  const la = si.lastActivityDays;
  add("ultima_activitat", "Última activitat", la == null ? 0.5 : la >= 180 ? 1 : la >= 60 ? 0.7 : la >= 14 ? 0.4 : 0.1, la == null ? "Sense activitat registrada" : `Últim contacte fa ${la} dies`);
  add("seguiment", "Necessitat de seguiment", si.needsFollowUp ? 1 : 0, si.needsFollowUp ? "Requereix una acció de seguiment" : "Sense seguiment pendent");
  const total = f.filter((x) => x.applicable).reduce((a, x) => a + x.weight, 0) || 1;
  for (const x of f) x.points = x.applicable ? Math.round(((x.weight * x.value * 100) / total) * 10) / 10 : 0;
  return { score: Math.max(0, Math.min(100, Math.round(f.reduce((a, x) => a + x.points, 0)))), factors: f };
}

/** Rendibilitat interna (separada de la puntuació): només sobre comissions i marge ESTIMATS amb regles. */
export function businessValue(e: { providerEur: number | null; marginEur: number | null }, weights: { comissio?: number; marge?: number } = { comissio: 70, marge: 30 }): number | null {
  if (e.providerEur == null && e.marginEur == null) return null;
  const wc = weights.comissio ?? 70, wm = weights.marge ?? 30;
  const c = e.providerEur != null ? Math.min(1, e.providerEur / 500) : 0;
  const m = e.marginEur != null ? Math.min(1, Math.max(0, e.marginEur) / 300) : 0;
  return Math.round(((c * wc + m * wm) / (wc + wm || 1)) * 100);
}

/* ================================================================== comissions (Fase 4) */

export interface EconomicsRow { layer: "proveidor" | "comercial" | "marge"; beneficiary_id: string | null; amount: string | null; status: "estimat" | "simulacio" | "pendent_configuracio" | "pendent_dades" | "sense_regla"; rule_ref: { rule_key: string; version: number; status: string } | null; formula: string }

/**
 * Comissió potencial de l'alternativa recomanada (ja triada). Sempre ESTIMADA: mai meritada ni cobrada.
 * Aquesta funció no pot canviar l'ordre de les alternatives (no les rep).
 */
export function estimateEconomics(rules: RuleRow[], alt: Pick<Alternative, "supplier" | "product"> | null, f: { service: Service | null; segment: Facts["segment"]; annualKwh: number | null; today: string; ownerId: string | null }): EconomicsRow[] {
  if (!alt) return [];
  const facts: Facts = { retailer: alt.supplier, product: alt.product, service: f.service, segment: f.segment, refDate: f.today, annualKwh: f.annualKwh, annualKwhSource: "Consum anual del subministrament", eligibleMwh: null, energyIncrementEurKwh: null, powerIncrementEurKwDay: null, powerKw: null, months: 12, providerAmount: null, providerAmountSource: null };
  const one = (layer: "proveidor" | "comercial", benef: string | null): EconomicsRow => {
    const { rule, simulation, conflict } = pickRule(rules, facts, layer, benef);
    if (!rule) return { layer, beneficiary_id: benef, amount: null, status: "sense_regla", rule_ref: null, formula: conflict.length ? "Diverses regles aplicables: cal resoldre-ho a Regles" : "Sense regla aplicable" };
    const c = computeCommission(rule, layer === "comercial" ? { ...facts, providerAmount: null } : facts, simulation);
    const status = c.status === "calculat" ? "estimat" : c.status === "simulacio" ? "simulacio" : c.status === "pendent_configuracio" ? "pendent_configuracio" : c.status === "pendent_dades" ? "pendent_dades" : "sense_regla";
    return { layer, beneficiary_id: benef, amount: c.amount, status, rule_ref: { rule_key: rule.rule_key, version: rule.version, status: rule.status }, formula: c.formula };
  };
  const prov = one("proveidor", null);
  const com = one("comercial", f.ownerId);
  const margin: EconomicsRow = prov.amount != null && com.amount != null
    ? { layer: "marge", beneficiary_id: null, amount: money(Number(prov.amount) - Number(com.amount)), status: prov.status === "estimat" && com.status === "estimat" ? "estimat" : "simulacio", rule_ref: null, formula: "Comissió potencial Assessoria 3.0 − comissió comercial (sense costos ni col·laboradors)" }
    : { layer: "marge", beneficiary_id: null, amount: null, status: "pendent_dades", rule_ref: null, formula: "Falten comissions calculables" };
  return [prov, com, margin];
}

/* ================================================================== redacció */

/** Text de la recomanació a partir de l'anàlisi (plantilla determinista: només números calculats). */
export function narrativeFromAnalysis(a: Analysis, clientName: string | null): string {
  if (!a.ok) return a.reason ?? "No s'ha pogut analitzar el subministrament.";
  const t = a.alternatives[0];
  const parts = [`Per a ${clientName ?? "el client"} s'han calculat ${a.evaluated} tarifes vigents; les tres més econòmiques per cost anual total són: ${a.alternatives.map((x) => `${x.supplier} ${x.product} (${eur(x.annualCost)})`).join(", ")}.`];
  parts.push(a.current.known && t.saving != null ? (t.saving > 0 ? `Respecte de les condicions actuals (${eur(a.current.annualCost!)}), la primera opció representa un estalvi estimat de ${eur(t.saving)} l'any.` : "Cap alternativa millora el cost actual: es recomana mantenir les condicions o negociar-les.") : `Estalvi: ${PENDING_PRICE}.`);
  if (a.sasScenarios.length) parts.push("Algunes ofertes inclouen un escenari de sensibilitat del SAS, que no és un cost regulat confirmat.");
  if (a.oneOff.length) parts.push("Hi ha costos únics a considerar (vegeu el detall).");
  return parts.join(" ");
}

/** Tots els números d'un text redactat per la IA han d'existir a l'anàlisi; si no, es descarta el text. */
export function numbersGrounded(text: string, a: Analysis): boolean {
  const allowed = new Set<string>();
  const addN = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    for (const v of [n, Math.round(n), Math.abs(n), Math.round(Math.abs(n))]) { allowed.add(String(v)); allowed.add(v.toFixed(2)); }
  };
  addN(a.current.annualCost); addN(a.evaluated); addN(a.excluded.length);
  for (const x of a.alternatives) { addN(x.annualCost); addN(x.saving); addN(x.savingPct); addN(x.permanenceMonths); addN(x.priceGuaranteeMonths); addN(x.rank); addN(x.version); addN(x.annualCostExTax); }
  for (const s of a.sasScenarios) { addN(s.minEurKwh); addN(s.maxEurKwh); addN(s.extraMinEur); addN(s.extraMaxEur); addN(s.totalMinEur); addN(s.totalMaxEur); }
  for (const year of ["2013", a.asOf.slice(0, 4)]) allowed.add(year);
  const found = text.replace(/(\d)\.(\d{3})/g, "$1$2").match(/\d+(?:[.,]\d+)?/g) ?? [];
  return found.every((n) => { const v = n.replace(",", "."); return allowed.has(v) || allowed.has(String(Number(v))) || allowed.has(Number(v).toFixed(2)) || Number(v) <= 3; });
}

/* ================================================================== proposta */

export const proposalValidUntil = (a: Analysis, today: string, days = 15): string => {
  const limit = new Date(Date.parse(today) + days * DAY).toISOString().slice(0, 10);
  const ends = a.alternatives.map((x) => x.validTo).filter((x): x is string => !!x);
  return [limit, ...ends].sort()[0];
};

export const PROPOSAL_ADVANTAGES = [
  "Comparativa calculada amb les tarifes vigents del catàleg autoritzat i amb el detall de cada component.",
  "Gestió completa del canvi o renovació per part d'Assessoria 3.0, sense talls de subministrament.",
  "Seguiment del contracte i avís abans de cada venciment.",
];
