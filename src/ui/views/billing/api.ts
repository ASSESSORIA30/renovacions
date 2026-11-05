"use client";
/** Client de l'API de facturació. */
import { useApp } from "@/data/store";
import type { DisplayStatus } from "@/core/billing";
import { ApiError } from "../crm/api";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new ApiError(0, "No hi ha connexió amb el servidor."); }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
const qs = (p: Record<string, string | undefined>) => new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string>).toString();
export const bApi = {
  get: <T,>(r: string, p: Record<string, string | undefined> = {}) => call<T>(`/api/billing?${qs({ r, ...p })}`),
  act: <T = { ok?: boolean; id?: string },>(action: string, b: { id?: string; data?: unknown } = {}) => call<T>("/api/billing", { method: "POST", body: JSON.stringify({ action, ...b }) }),
  pdfUrl: (id: string, inline = false) => `/api/billing?${qs({ r: "pdf", id, inline: inline ? "1" : undefined })}`,
  zipUrl: (ids: string[]) => `/api/billing?${qs({ r: "zip", ids: ids.join(",") })}`,
  xlsxUrl: (p: Record<string, string | undefined>) => `/api/billing?${qs({ r: "xlsx", ...p })}`,
};
export const toast = (title: string, body?: string, tone: "ok" | "err" | "info" = "ok") => useApp.getState().toast({ title, body, tone });
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const eur = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : Number(v).toLocaleString("ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtD = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

export interface InvoiceRow { id: string; invoice_no: string | null; issue_date: string | null; due_date: string | null; client_id: string; client_name: string; client_nif: string; base: string; vat: string; total: string; paid: string; pending: string; status: string; display_status: DisplayStatus; kind: "ordinaria" | "rectificativa"; origin: string; payment_unknown: boolean; concept: string | null; period_label: string | null; needs_review: boolean; sent_at: string | null; series: string }
export interface BillClient { id: string; legal_name: string; trade_name: string | null; nif: string; address: string | null; postal_code: string | null; city: string | null; province: string | null; country: string; contact_name: string | null; phone: string | null; billing_email: string | null; payment_method: string; due_days: number | null; order_ref_label: string | null; order_ref: string | null; retailer_name: string | null; notes: string | null; status: "actiu" | "inactiu" | "arxivat"; needs_review: boolean; review_notes: string | null; invoices?: number; invoiced?: string; pending?: string; last_invoice?: string | null; nif_valid?: boolean }
export interface Line { description: string; quantity: string; unitPrice: string; vatRate: string; vatExemption: string }
