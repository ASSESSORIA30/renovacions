"use client";
/** Client de l'API de captació i màrqueting (Fase 6). */
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
export const capApi = {
  get: <T>(r: string, p: Record<string, string | undefined> = {}) => call<T>(`/api/capture?${qs({ r, ...p })}`),
  act: <T = { ok?: boolean }>(action: string, b: Record<string, unknown> = {}) => call<T>("/api/capture", { method: "POST", body: JSON.stringify({ action, ...b }) }),
  openDoc: async (id: string) => { const r = await call<{ url: string }>(`/api/capture?r=doc&id=${id}`); window.open(r.url, "_blank", "noopener"); },
};
export const eur = (v: number | string | null | undefined, dp = 2) => (v == null || v === "" ? "—" : Number(v).toLocaleString("ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const fdate = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("ca-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const fdt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
