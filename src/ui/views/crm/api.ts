"use client";
/** Client de les APIs del CRM (Clients 360°). Mateixa sessió Supabase que la resta de la plataforma. */
import type { CrmClientDetail, CrmClientRow, CrmDocument, DocCategory } from "@/core/crm";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

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
const post = <T>(url: string, body: unknown, method = "POST") => call<T>(url, { method, body: JSON.stringify(body) });

export const crmReady = () => supabaseConfigured;

export interface ListResult { rows: CrmClientRow[]; total: number; page: number; size: number; counters: { actiu: number; potencial: number; inactiu: number } }
export interface Facets { collaborators: { id: string; name: string }[]; cities: string[]; provinces: string[]; sectors: string[]; origins: string[]; users: { id: string; name: string; role: string; code: string | null }[] }

export type RenewalDocs =
  | { linked: false; documents: []; permissions: null; client: null; contractId: null; supplyId: null }
  | { linked: true; client: { id: string; name: string }; contractId: string | null; supplyId: string | null; documents: (CrmDocument & { related: boolean })[]; permissions: { canUpload: boolean; canEdit: boolean; canSeeSensitive: boolean } };

export const crmApi = {
  list: (p: Record<string, string | number | undefined>) => {
    // la paginació comença per 1: mai s'envia page=0 (abans es podia enviar en tornar a la llista o en buidar-la)
    if (p.page !== undefined) p = { ...p, page: Math.max(1, Math.floor(Number(p.page) || 1)) };
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return call<ListResult>(`/api/crm/clients?${qs}`);
  },
  facets: () => call<Facets>("/api/crm/clients?facets=1"),
  check: (p: { taxId?: string | null; phone?: string | null; email?: string | null; exclude?: string | null }) =>
    call<{ taxId: null | { visible: boolean; id?: string; name?: string }; similar: { id: string; name: string; reason: string }[] }>(`/api/crm/clients?check=1&${new URLSearchParams(Object.entries(p).filter(([, v]) => v).map(([k, v]) => [k, String(v)]))}`),
  create: (data: unknown) => post<{ id: string }>("/api/crm/clients", data),
  get: (id: string) => call<CrmClientDetail>(`/api/crm/clients/${encodeURIComponent(id)}`),
  update: (id: string, data: unknown) => post<{ id: string }>(`/api/crm/clients/${encodeURIComponent(id)}`, data, "PATCH"),
  action: <T = { id?: string; ok?: boolean }>(body: Record<string, unknown>) => post<T>("/api/crm/action", body),
  search: (q: string) => call<{ results: { kind: "client" | "supply" | "expedient"; id: string; title: string; sub: string; status: string | null }[] }>(`/api/crm/search?q=${encodeURIComponent(q)}`),
  importPortfolio: (dryRun: boolean) => post<{ dryRun: boolean; stats: Record<string, number>; created?: { clients: number; supplies: number; contracts: number } }>("/api/crm/import", { dryRun }),
  myTasks: () => call<{ tasks: { id: string; title: string; due_at: string | null; client_id: string | null; crm_clients: { name: string } | null }[] }>("/api/crm/tasks"),
  docLimits: () => call<{ types: string[]; maxBytes: number }>("/api/crm/documents"),
  docUrl: (id: string, opts: { version?: number; download?: boolean } = {}) => call<{ url: string; name: string; mime: string }>(`/api/crm/documents?id=${id}${opts.version ? `&version=${opts.version}` : ""}${opts.download ? "&download=1" : ""}`),
  renewalDocs: (renewalId: string, cups?: string | null) =>
    call<RenewalDocs>(`/api/crm/documents?renewal=${encodeURIComponent(renewalId)}${cups ? `&cups=${encodeURIComponent(cups)}` : ""}`),
  docAction: (body: Record<string, unknown>) => post<{ ok: boolean }>("/api/crm/documents", { step: "action", ...body }),
};

/** Puja un fitxer al bucket privat amb URL signada (mostrant el progrés) i el registra al servidor. */
export async function uploadDocument(
  file: File,
  meta: { clientId: string; documentId?: string | null; category?: DocCategory; title?: string; description?: string | null; supplyId?: string | null; contractId?: string | null; expedientId?: string | null },
  onProgress: (pct: number) => void,
) {
  const req = await post<{ ticket: string; path: string; token: string; signedUrl: string; documentId: string; version: number }>("/api/crm/documents", {
    step: "request", clientId: meta.clientId, documentId: meta.documentId ?? null, fileName: file.name, size: file.size, category: meta.category,
  });
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", req.signedUrl);
    x.setRequestHeader("x-upsert", "false");
    x.setRequestHeader("content-type", file.type || "application/octet-stream");
    x.setRequestHeader("cache-control", "max-age=3600");
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anon) x.setRequestHeader("apikey", anon);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 95));
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new ApiError(x.status, "No s'ha pogut pujar el fitxer")));
    x.onerror = () => reject(new ApiError(0, "S'ha perdut la connexió durant la pujada"));
    x.send(file);
  }).catch(async (e) => {
    // alternativa: client oficial de Supabase (sense progrés)
    const r = await browserSupabase().storage.from("crm-documents").uploadToSignedUrl(req.path, req.token, file, { contentType: file.type || undefined });
    if (r.error) throw e;
  });
  onProgress(97);
  const done = await post<{ id: string; version: number }>("/api/crm/documents", {
    step: "finalize", ticket: req.ticket, category: meta.category, title: meta.title, description: meta.description ?? null, supplyId: meta.supplyId ?? null, contractId: meta.contractId ?? null, expedientId: meta.expedientId ?? null,
  });
  onProgress(100);
  return done;
}
