"use client";
/** Client de l'API d'Intel·ligència IA (CRM Fase 5). */
import { ApiError } from "../crm/api";
import type { AiKind, Alternative, Evidence, OneOffCost, SasScenario, ScoreFactor } from "@/core/intelligence";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new ApiError(0, "No hi ha connexió amb el servidor."); }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
const qs = (p: Record<string, string | undefined>) => new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string>).toString();
export const aiApi = {
  get: <T>(r: string, p: Record<string, string | undefined> = {}) => call<T>(`/api/ai/intelligence?${qs({ r, ...p })}`),
  act: <T = { ok?: boolean }>(action: string, b: Record<string, unknown> = {}) => call<T>("/api/ai/intelligence", { method: "POST", body: JSON.stringify({ action, ...b }) }),
  copilot: <T>(b: Record<string, unknown>) => call<T>("/api/ai/copilot", { method: "POST", body: JSON.stringify(b) }),
  copilotGet: <T>(r: string, p: Record<string, string> = {}) => call<T>(`/api/ai/copilot?${qs({ r, ...p })}`),
};

export interface OppItem {
  id: string; kind: AiKind; status: string; title: string; summary: string | null; score: number; business_value: number | null; potential_saving_eur: string | null; saving_status: "estimat" | "pendent_preu_actual" | "no_aplicable";
  due_date: string | null; milestone: number | null; data_quality: string; owner_id: string | null; client_id: string | null; crm_opportunity_id: string | null; annual_kwh: string | null; contact_allowed: boolean; detected_at: string;
  crm_clients: { name: string; province: string | null } | null; crm_supplies: { cups: string; access_tariff: string | null; current_retailer: string | null; province: string | null } | null; crm_contracts: { retailer: string; end_date: string | null } | null;
}
export interface Run { id: string; trigger: string; status: string; stats: Record<string, number>; errors: string[]; started_at: string; finished_at: string | null; attempts: number }
export interface Dash {
  migrated: boolean;
  kpis: { detected: number; highPriority: number; renewals: number; savingEstimated: number; savingCount: number; pendingPrice: number; commission: { scope: "a3" | "own"; amount: number | null; simulations: number }; proposalsPrepared: number; proposalsSent: number; suggestedTasks: number; energyAlerts: number; clientsWithoutData: number } | null;
  items: OppItem[]; total?: number;
  ranking: { clientId: string; name: string; score: number; count: number; saving: number; kinds: AiKind[] }[];
  savingsByKind: { kind: AiKind; label: string; estimated: number; pending: number }[];
  calendar: { date: string; title: string; kind: string; id: string; type: "oportunitat" | "tasca" }[];
  runs: Run[]; owners: { id: string; name: string }[]; canRun?: boolean; canConfigure?: boolean;
}
export interface Recommendation { id: string; created_at: string; engine_version: string; tariff_snapshot_id: string | null; inputs: { cups?: string; currentRetailer?: string | null; currentSource?: { label: string; date: string | null } | null; supply?: { kwhTotal: number | null; accessTariff: string | null; kw: (number | null)[] } }; current_cost: { known: boolean; label: string; annualCost: number | null; source: string | null; date: string | null } | null; alternatives: Alternative[]; sas_scenario: SasScenario[] | null; one_off_costs: OneOffCost[]; hypotheses: string[]; missing: string[]; narrative: string | null; narrative_source: string | null }
export interface Draft { id: string; status: string; valid_until: string; created_at: string; approved_at: string | null; sent_at: string | null; document_id: string | null; comparison_id: string | null }
export interface Econ { layer: "proveidor" | "comercial" | "marge"; amount: string | null; status: string; formula: string | null; rule_ref: { rule_key: string; version: number; status: string } | null; collection_status: string }
export interface Detail {
  opportunity: OppItem & { evidence: Evidence[]; score_factors: ScoreFactor[]; status_reason: string | null; contract_id: string | null; supply_id: string | null; crm_clients: { id: string; name: string; province: string | null; commercial_opt_out: boolean; contact_preference: string } | null; crm_supplies: { id: string; cups: string; access_tariff: string | null; annual_kwh: number | null; power_kw: (number | null)[] | null; current_retailer: string | null; address: string | null; energy_type: string } | null; crm_contracts: { id: string; retailer: string; product: string | null; end_date: string | null; status: string } | null };
  recommendation: Recommendation | null; history: Recommendation[]; scores: { score: number; business_value: number | null; computed_at: string }[];
  economics: Econ[]; drafts: Draft[]; tariffSnapshot: { id: string; taken_at: string; as_of: string; offer_count: number; sha256: string } | null; canEdit: boolean; canSeeInternal: boolean;
}

export const eur = (v: number | string | null | undefined, dp = 2) => (v == null || v === "" ? "—" : Number(v).toLocaleString("ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const fdate = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("ca-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");
