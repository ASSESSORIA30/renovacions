"use client";
/** Client de l'API de comercialitzadores (Fase 8.1). */
import { browserSupabase } from "@/data/browserSupabase";
import { ApiError } from "../crm/api";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new ApiError(0, "No hi ha connexió amb el servidor."); }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
export const rApi = {
  get: <T,>(r: string, p: Record<string, string> = {}) => call<T>(`/api/retailers?${new URLSearchParams({ r, ...p })}`),
  act: <T = { ok: boolean }>(action: string, data: unknown = {}, id?: string) => call<T>("/api/retailers", { method: "POST", body: JSON.stringify({ action, id, data }) }),
};

/** Puja un fitxer al bucket privat amb URL signada i el registra (el servidor en comprova el contingut real). */
export async function uploadRetailerFile(file: File, meta: { retailerId: string; purpose?: "document" | "logo"; title?: string; kind?: string; supersedesId?: string | null; parentId?: string | null; validFrom?: string | null; validTo?: string | null }, onProgress: (p: number) => void) {
  const req = await rApi.act<{ ticket: string; path: string; token: string; signedUrl: string }>("upload_request", { retailerId: meta.retailerId, fileName: file.name, size: file.size, purpose: meta.purpose ?? "document" });
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", req.signedUrl);
    x.setRequestHeader("x-upsert", "false");
    x.setRequestHeader("content-type", file.type || "application/octet-stream");
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anon) x.setRequestHeader("apikey", anon);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 90));
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new ApiError(x.status, "No s'ha pogut pujar el fitxer")));
    x.onerror = () => reject(new ApiError(0, "S'ha perdut la connexió durant la pujada"));
    x.send(file);
  }).catch(async (e) => {
    const r = await browserSupabase().storage.from("retailer-contracts").uploadToSignedUrl(req.path, req.token, file, { contentType: file.type || undefined });
    if (r.error) throw e;
  });
  onProgress(95);
  const done = await rApi.act<{ id?: string; version?: number; logo?: boolean }>("upload_finalize", { ticket: req.ticket, title: meta.title, kind: meta.kind ?? "contracte", supersedesId: meta.supersedesId ?? null, parentId: meta.parentId ?? null, validFrom: meta.validFrom ?? null, validTo: meta.validTo ?? null });
  onProgress(100);
  return done;
}

export type Retailer = { status_changed_at?: string | null; status_changed_by_name?: string | null; status_note?: string | null; id: string; trade_name: string; legal_name: string | null; tax_id: string | null; aliases: string[]; website: string | null; contact_name: string | null; phone: string | null; email: string | null; services: string[]; status: string; special_conditions: string | null; notes: string | null; logo_path: string | null; logoUrl?: string | null };
export type AiInfo = { configured: boolean; policy: { enabled: boolean; dpa_reference: string | null; zero_retention: boolean; no_training: boolean; confirmed_by: string | null; confirmed_at: string | null; note: string | null } };
export type Doc = { id: string; kind: string; title: string; version: number; supersedes_id: string | null; parent_id: string | null; valid_from: string | null; valid_to: string | null; renewal_notice_days: number; status: string; original_name: string | null; size_bytes: number | null; created_at: string };
export type Extraction = { id: string; document_id: string; status: string; method: string; model: string | null; ocr_used: boolean; pages: number | null; warnings: string[]; error: string | null; summary: Record<string, unknown> | null; created_at: string };
export type Term = {
  id: string; extraction_id: string; document_id: string; category: string; field: string; product: string | null; tariff: string | null; service: string | null; period_label: string | null;
  value: string | number | null; unit: string | null; tiers: { threshold: number; amount: number }[] | null; formula: string | null; conditions: Record<string, unknown>;
  valid_from: string | null; valid_to: string | null; page: number | null; excerpt: string; excerpt_found: boolean; interpretation: string | null; confidence: string | number;
  ambiguous: boolean; ambiguity_reason: string | null; source: string; review_status: string; review_note: string | null; original: Record<string, unknown> | null; applied_rule_id: string | null; applied_clawback_id: string | null; reviewed_at: string | null;
};
export const STATUS_LABEL: Record<string, string> = { activa: "Activa", pendent: "Pendent", suspesa: "Suspesa", inactiva: "Desactivada", arxivada: "Arxivada" };
export const STATUS_TONE: Record<string, string> = { activa: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", pendent: "bg-amber-500/14 text-amber-800 dark:text-amber-300", suspesa: "bg-red-500/12 text-red-700 dark:text-red-300", inactiva: "bg-ink/[0.06] text-muted", arxivada: "bg-ink/[0.10] text-muted line-through decoration-ink/30" };
/** Filtres del llistat: actives (inclou pendents i suspeses, que encara són operatives), desactivades, arxivades, totes. */
export type StatusFilter = "actives" | "desactivades" | "arxivades" | "totes";
export const inFilter = (status: string, f: StatusFilter) => f === "totes" || (f === "desactivades" ? status === "inactiva" : f === "arxivades" ? status === "arxivada" : !["inactiva", "arxivada"].includes(status));
export const DOC_STATUS: Record<string, string> = { esborrany: "Esborrany", en_revisio: "En revisió", vigent: "Vigent", substituit: "Substituït", vencut: "Vençut", anullat: "Anul·lat" };
export const SERVICES: Record<string, string> = { llum: "Llum", gas: "Gas", fibra: "Fibra", assegurances: "Assegurances", altres: "Altres" };
