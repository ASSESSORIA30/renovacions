"use client";
/**
 * Client de les APIs energètiques de la plataforma (mateixa sessió Supabase que el CRM:
 * cap clau d'accés addicional ni credencial al navegador).
 */
import type { SearchInput } from "./lib/sips-engine";
import type { AnnualConsumption } from "./lib/sips-consumption";
import type { SipsSummary } from "./lib/sips-record";
import type { PeriodMaxTable } from "./lib/optimizer";

export type RawCell = string | number | boolean | null;
export type CacheEntry = SipsSummary & { raw?: Record<string, RawCell> | null };

export interface SipsStatus {
  available: boolean;
  configured: boolean;
  credentials: boolean;
  external: boolean;
  ttlDays: number;
  staff: boolean;
}

export interface SipsResult {
  annualConsumptions?: Record<string, AnnualConsumption>;
  total: number;
  rows: RawCell[][];
  consultedAt: string;
  source: string;
}

export interface EnergyInputs {
  cups: string;
  invoice_kwh: (number | null)[] | null;
  invoice_source: string | null;
  period_max: PeriodMaxTable | null;
  updated_at: string;
  updated_by_name: string | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new Error("No hi ha connexió amb el servidor.");
  }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida del servidor (${r.status})` }));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `Error ${r.status}`), { status: r.status, code: j.code as string | undefined });
  return j as T;
}

export const energyApi = {
  status: () => call<SipsStatus>("/api/sips/status"),
  search: (q: SearchInput) => call<SipsResult>("/api/sips/search", { method: "POST", body: JSON.stringify(q) }),
  summary: () => call<{ rows: CacheEntry[]; total: number }>("/api/sips/cache"),
  full: (offset = 0, limit = 500) => call<{ rows: CacheEntry[]; total: number; next: number | null }>(`/api/sips/cache?full=1&offset=${offset}&limit=${limit}`),
  supply: (cups: string) => call<{ entry: CacheEntry | null; inCrm: boolean; crmSupplies?: { id: string; client_id: string; data_source: string; data_updated_at: string; crm_clients: { name: string } | null }[] }>(`/api/sips/supply?cups=${encodeURIComponent(cups)}`),
  link: (cups: string, force = false) => call<{ updated: number; clientIds: string[]; consultedAt: string; fields: string[] }>("/api/sips/link", { method: "POST", body: JSON.stringify({ cups, force }) }),
  refresh: (cups: string, force = true) => call<{ entry: CacheEntry }>("/api/sips/refresh", { method: "POST", body: JSON.stringify({ cups, force }) }),
  enrich: () => call<{ candidates: number; due: number; updated: number; failed: number; pending: number }>("/api/sips/enrich", { method: "POST" }),
  importRows: (file: string, rows: RawCell[][]) => call<{ saved: number; skipped: number; invalid: number }>("/api/sips/import", { method: "POST", body: JSON.stringify({ file, rows }) }),
  getInputs: (cups: string) => call<{ inputs: EnergyInputs | null; missingTable?: boolean }>(`/api/energy/inputs?cups=${encodeURIComponent(cups)}`),
  saveInputs: (cups: string, patch: { invoiceKwh?: (number | null)[] | null; invoiceSource?: string; periodMax?: PeriodMaxTable | null }) =>
    call<{ ok: boolean }>("/api/energy/inputs", { method: "PUT", body: JSON.stringify({ cups, ...patch }) }),
};

/** Les APIs del servidor només existeixen si hi ha Supabase (sessió). En mode local no es criden. */
export const serverEnabled = () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
