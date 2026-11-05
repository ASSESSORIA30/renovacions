"use client";
/** Client de l'API del CRM comercial (Fase 2). */
import type { CrmActivity, CrmTask } from "@/core/crm";
import type { Kpis, Lead, Opportunity, Stage } from "@/core/sales";
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
const get = <T>(r: string, p: Record<string, string | number | undefined> = {}) =>
  call<T>(`/api/crm/sales?${new URLSearchParams({ r, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])) })}`);
const post = <T = { ok?: boolean; id?: string }>(b: Record<string, unknown>) => call<T>("/api/crm/sales", { method: "POST", body: JSON.stringify(b) });

export type OppRow = Opportunity & { party_name: string | null; party_kind: "client" | "lead"; owner_name: string | null };
export type LeadRow = Lead & { opportunities: number };
export interface OppDetail {
  opportunity: OppRow;
  activities: CrmActivity[];
  tasks: (CrmTask & { kind?: string; source?: string })[];
  comparisons: { id: string; created_at: string; status: string; cups: string | null; created_by_name: string | null; saving: number | null; best: string | null }[];
  supplies: { id: string; cups: string; energy_type: string; access_tariff: string | null; annual_kwh: number | null; current_retailer: string | null }[];
  client: { id: string; name: string; tax_id: string | null; phone: string | null; email: string | null; city: string | null; status: string; owner_id: string | null } | null;
  lead: { id: string; name: string; company: string | null; phone: string | null; email: string | null; city: string | null; status: string; tax_id: string | null } | null;
  contract: { id: string; retailer: string; product: string | null; status: string; end_date: string | null } | null;
  expedient?: { id: string; code: string; status: string } | null;
  canEdit: boolean;
  isStaff: boolean;
}
export interface Jornada {
  tasks: (CrmTask & { kind: string; source: string; lead_id: string | null; opportunity_id: string | null })[];
  overdue: Jornada["tasks"];
  calls: Jornada["tasks"];
  meetings: Jornada["tasks"];
  proposals: OppRow[];
  newOpps: OppRow[];
  leads: { id: string; name: string; company: string | null; phone: string | null; email: string | null; status: string; created_at: string; first_contact_at: string | null; services: string[] }[];
  clients: { id: string; name: string; phone: string | null; next_follow_up: string; status: string }[];
  renewals: { id: string; client_id: string; retailer: string; product: string | null; end_date: string; client_name: string | null }[];
}
export interface AgendaEvent { id: string; kind: "tasca" | "oportunitat" | "venciment"; title: string; at: string; allDay: boolean; done?: boolean; taskKind?: string; durationMin?: number | null; link: { view: string; params: Record<string, string> } }
export interface Performance {
  kpis: Kpis;
  byService: Record<string, { open: number; won: number }>;
  funnel: { stage: Stage; label: string; count: number }[];
  team: { id: string; name: string; kpis: Kpis }[];
  targets: { user_id: string; period: string; metric: string; target: number; name: string | null }[];
  isStaff: boolean;
  me: string;
}
export interface Notification { id: string; kind: string; title: string; body: string | null; link: { view: string; params: Record<string, string> } | null; read_at: string | null; created_at: string }

export const salesApi = {
  leads: (p: Record<string, string | number | undefined>) => get<{ rows: LeadRow[]; total: number; page: number; size: number }>("leads", p),
  lead: (id: string) => get<{ lead: Lead; activities: CrmActivity[]; opportunities: Opportunity[]; tasks: CrmTask[]; canEdit: boolean; isStaff: boolean }>("lead", { id }),
  matches: (id: string) => get<{ matches: { id: string; name: string; reason: string; visible: boolean }[] }>("matches", { id }),
  opps: (p: Record<string, string | number | undefined>) => get<{ rows: OppRow[] }>("opps", p),
  opp: (id: string) => get<OppDetail>("opp", { id }),
  jornada: () => get<Jornada>("jornada"),
  agenda: (from: string, to: string, user?: string) => get<{ events: AgendaEvent[] }>("agenda", { from, to, user }),
  kpis: (from: string, to: string) => get<Performance>("kpis", { from, to }),
  notifications: () => get<{ items: Notification[]; unread: number }>("notifications"),
  lead_: (action: string, b: Record<string, unknown> = {}) => post({ entity: "lead", action, ...b }),
  opp_: <T = { ok?: boolean; id?: string; version?: number; stage?: Stage }>(action: string, b: Record<string, unknown> = {}) => post<T>({ entity: "opp", action, ...b }),
  activity: (b: Record<string, unknown>) => post({ entity: "activity", ...b }),
  task: (data: Record<string, unknown>) => post({ entity: "task", data }),
  convert: (leadId: string, clientId?: string | null) => post<{ clientId: string; created: boolean }>({ entity: "convert", leadId, clientId: clientId ?? null }),
  read: (ids: string[] | "all") => post({ entity: "notifications", ids }),
  target: (b: { userId: string; period: string; metric: string; target: number | null }) => post({ entity: "target", ...b }),
  rules: () => call<{ rules: { key: string; name: string; description: string | null; enabled: boolean; params: Record<string, unknown>; updated_at: string }[]; runs: { id: number; started_at: string; finished_at: string | null; trigger: string; tasks_created: number; notifications_created: number; ok: boolean | null; error: string | null }[]; canEdit: boolean }>("/api/crm/automations"),
  saveRule: (b: { key: string; enabled: boolean; params: Record<string, unknown> }) => call("/api/crm/automations", { method: "POST", body: JSON.stringify({ action: "update", ...b }) }),
  runRules: () => call<{ tasks: number; notifications: number }>("/api/crm/automations", { method: "POST", body: JSON.stringify({ action: "run" }) }),
};

export const eur = (n: number | null | undefined, d = 0) => (n == null ? "—" : n.toLocaleString("ca-ES", { style: "currency", currency: "EUR", maximumFractionDigits: d }));
export const mwh = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("ca-ES", { maximumFractionDigits: 1 })} MWh`);
