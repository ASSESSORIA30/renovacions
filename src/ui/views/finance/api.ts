"use client";
/** Client de l'API de control econòmic (CRM Fase 4). */
import { ApiError } from "../crm/api";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new ApiError(0, "No hi ha connexió amb el servidor."); }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
const get = <T>(r: string, p: Record<string, string | undefined> = {}) => call<T>(`/api/finance?${new URLSearchParams({ r, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string> })}`);
export const fApi = {
  get,
  act: <T = { ok?: boolean; id?: string }>(action: string, b: Record<string, unknown> = {}) => call<T>("/api/finance", { method: "POST", body: JSON.stringify({ action, ...b }) }),
  pdfUrl: (id: string) => `/api/finance?r=pdf&id=${encodeURIComponent(id)}`,
};

export interface Calc { id: string; layer: "proveidor" | "comercial" | "collaborador"; beneficiary_id: string | null; rule_id: string | null; rule_key: string | null; rule_version: number | null; status: string; amount: string | null; breakdown: { label: string; value: string; source?: string }[]; formula: string | null; is_current: boolean; created_at: string }
export interface Ledger { id: string; contract_id: string | null; layer: string; beneficiary_id: string | null; kind: string; amount: string; period: string; description: string; settlement_id: string | null; created_by_name: string | null; created_at: string; settlement?: { id: string; code: string; status: string } | null }
export interface Payout { beneficiary_id: string | null; beneficiary_name: string | null; estimated: string | null; status: string | null; accrued: string; adjustments: string; settled: string; pending: string }
export interface ContractEcon {
  contract: { id: string; client_id: string; retailer: string; product: string | null; status: string; start_date: string | null; end_date: string | null };
  client: { id: string; name: string; origin: string | null };
  supply: { cups: string; annual_kwh: number | null; power_kw: (number | null)[] | null } | null;
  expedient: { id: string; code: string } | null;
  economics: { segment: string | null; product_modality: string | null; eligible_mwh: string | null; energy_increment_eur_kwh: string | null; power_increment_eur_kw_day: string | null; economic_months: number; econ_status: string; cancelled_at: string | null; cancel_reason: string | null; settlement_deferred_until?: string | null; settlement_deferral_reason?: string | null } | null;
  /** Fase 14: historial de comissions amb els quatre estats separats. */
  commissionHistory?: {
    states: { prevista: { amount: string | null; status: string | null }; liquidada: string; regularitzacions: string; cobrada: string; reclamada: string; recuperada: string };
    lines: { id: string; received_at: string | null; reference: string | null; retailer: string | null; origin: string | null; movement: string | null; concept: string | null; doc_status: string | null; kind: string; amount: string; expected: string | null; difference: string | null; match_status: string; collected: string; collected_at: string | null; claim: string[] }[];
    claims: { id: string; claim_id: string; code: string | null; claim_status: string | null; kind: string; claimed: string; recovered: string; status: string }[];
  } | null;
  owner: { id: string; name: string | null } | null; collaborator: { id: string; name: string | null } | null;
  facts: { segment: string | null; service: string | null; refDate: string; annualKwh: number | null; months: number } | null;
  calculations: Calc[]; ledger: Ledger[];
  summary: { provider: { estimated: string | null; estimatedStatus: string | null; accrued: string; invoiced: string; confirmed: string; collected: string; adjustments: string }; margin: { status: string; value: string | null; estimated: string | null; note: string }; costs: string } | null;
  payouts: { comercial: Payout | null; collaborador: Payout | null };
  statementLines: { id: string; amount: string; kind: string; match_status: string; expected_amount: string | null; difference: string | null; concept: string | null; fin_provider_statements: { retailer: string; reference: string; received_at: string } | null }[];
  costs: { id: string; concept: string; amount: string; cost_date: string }[];
  legacy: { finance: { commission_eur: number | null; commission_paid_at: string | null } | null; record: { estimated_eur: number | null; accrual_status: string; payment_status: string } | null } | null;
  permissions: { staff: boolean; canManageRules: boolean };
}
export const eur = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : Number(v).toLocaleString("ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtD = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("ca-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const ym = (d = new Date()) => d.toISOString().slice(0, 7);
