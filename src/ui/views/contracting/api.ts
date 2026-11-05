"use client";
/** Client de l'API de contractació (CRM Fase 3). */
import type { CrmDocument } from "@/core/crm";
import type { Expedient, ExpStatus, Requirement, Terms } from "@/core/contracting";
import { ApiError } from "../crm/api";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(0, "No hi ha connexió amb el servidor.");
  }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
const get = <T>(r: string, p: Record<string, string | undefined> = {}) =>
  call<T>(`/api/crm/contracting?${new URLSearchParams({ r, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string> })}`);
const post = <T = { ok?: boolean; id?: string }>(b: Record<string, unknown>) => call<T>("/api/crm/contracting", { method: "POST", body: JSON.stringify(b) });

export type Progress = { total: number; done: number; pending: number; rejected: number; pct: number };
export type ExpRow = Expedient & { client_name: string | null; client_tax_id: string | null; province: string | null; cups: string | null; owner_name: string | null; docs: Progress; days_in_status: number };
export type MiniRow = Pick<ExpRow, "id" | "code" | "client_name" | "retailer" | "service" | "status" | "owner_name" | "days_in_status" | "docs" | "expected_activation_date" | "next_action" | "priority"> & { signature?: string | null; activated_at?: string | null };
export interface SignatureInfo { provider: string | null; label: string | null; configured: boolean; missing: string[]; sandbox: boolean | null; available: { id: string; label: string }[] }
export interface Dashboard {
  kpis: { byStatus: Record<ExpStatus, number>; open: number; activatedMonth: number; avgDaysToActivate: number | null; stale: number; docsPending: number; byService: Record<string, number> };
  docsPending: MiniRow[]; signaturePending: MiniRow[]; readyToSend: MiniRow[]; overdue: MiniRow[]; incidents: MiniRow[]; activated: MiniRow[];
  unassigned: number; signature: SignatureInfo; isStaff: boolean;
}
export interface SigRequest { id: string; provider: string; provider_request_id: string | null; status: string; signers: { name: string; email?: string }[]; manual_justification: string | null; sent_at: string | null; completed_at: string | null; signed_document_id: string | null; evidence_document_id: string | null; generated_document_id: string | null; error: string | null; created_at: string; events: { id: number; type: string; occurred_at: string | null; received_at: string; verified: boolean }[] }
export interface Generated { id: string; template_id: string; template_version: number; document_id: string; version: number; status: string; generated_by_name: string | null; generated_at: string; accepted_at: string | null; signed_document_id: string | null }
export interface ExpEvent { id: number; at: string; user_name: string | null; type: string; title: string; from_status: string | null; to_status: string | null; justification: string | null }
export interface Commission { estimated_eur: number | null; annual_kwh: number | null; accrual_status: string; payment_status: string; accrued_at: string | null; paid_at: string | null; paid_eur: number | null; retailer_ref: string | null; settlement_ref: string | null; notes: string | null; contract_id: string | null }
export interface Template { id: string; name: string; description: string | null; origin: "intern" | "comercialitzadora"; retailer: string | null; services: string[]; version: number; status: string; body?: string; source_note?: string | null; authorized_at?: string | null }
export interface ExpDetail {
  expedient: Expedient & { owner_name: string | null; collaborator_name: string | null; activation_confirmed_name: string | null };
  client: { id: string; kind: string; name: string; trade_name: string | null; tax_id: string | null; phone: string | null; email: string | null; address: string | null; postal_code: string | null; city: string | null; province: string | null; contact_name: string | null; owner_id: string | null; status: string };
  contacts: { id: string; name: string; role: string | null; phone: string | null; email: string | null; is_primary: boolean }[];
  supply: { id: string; cups: string; energy_type: string; address: string | null; city: string | null; holder_name: string | null; current_retailer: string | null; access_tariff: string | null; power_kw: (number | null)[] | null; annual_kwh: number | null } | null;
  terms: Terms[]; requirements: Requirement[];
  documents: Pick<CrmDocument, "id" | "category" | "title" | "original_name" | "created_at" | "sensitive" | "version">[];
  generated: Generated[]; signatures: SigRequest[]; events: ExpEvent[];
  refs: { id: string; system: string; ref: string; label: string | null; created_at: string }[];
  incidents: { id: string; title: string; status: string; priority: string; opened_at: string; external_ref: string | null }[];
  tasks: { id: string; title: string; status: string; due_at: string | null; assigned_name: string | null; source?: string }[];
  commission: Commission | null;
  contract: { id: string; retailer: string; product: string | null; status: string; start_date: string | null; end_date: string | null } | null;
  previousContract: { id: string; retailer: string; product: string | null; status: string; start_date: string | null; end_date: string | null } | null;
  opportunity: { id: string; title: string; stage: string; comparison_id: string | null; commission_eur: number | null; annual_kwh: number | null } | null;
  templates: Template[];
  comparisons: { id: string; created_at: string; status: string; offers: { id: string; label: string; version: number }[]; best: string | null }[];
  progress: Progress;
  permissions: { canEdit: boolean; isStaff: boolean; canManage: boolean; isAdmin: boolean };
  signature: SignatureInfo;
}

export const cApi = {
  list: (p: Record<string, string | undefined> = {}) => get<{ rows: ExpRow[]; isStaff: boolean }>("list", p),
  dashboard: () => get<Dashboard>("dashboard"),
  exp: (id: string) => get<ExpDetail>("exp", { id }),
  templates: () => get<{ templates: Template[]; canManage: boolean; isAdmin: boolean }>("templates"),
  reqConfig: () => get<{ rows: ReqConfig[]; canManage: boolean }>("requirements"),
  signature: () => get<SignatureInfo>("signature"),
  act: <T = { ok?: boolean; id?: string }>(action: string, b: Record<string, unknown> = {}) => post<T>({ action, ...b }),
};
export interface ReqConfig { id: string; name: string; description: string | null; kind: "document" | "dada" | "manual"; doc_category: string | null; data_field: string | null; services: string[]; retailers: string[]; customer_types: string[]; procedure_types: string[]; mandatory: boolean; active: boolean; sort: number; is_example: boolean }

export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("ca-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("ca-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const todayStr = () => new Date().toISOString().slice(0, 10);
