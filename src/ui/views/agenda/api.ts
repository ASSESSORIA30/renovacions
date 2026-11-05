"use client";
/** Client de l'API de l'agenda (Fase 10). */
import { create } from "zustand";
import type { EventKind, Recurrence } from "@/core/agenda";

export type Item = {
  id: string; occurrenceId: string; source: "event" | "task"; title: string; kind: EventKind; scope: "personal" | "compartida";
  start: string; end: string; allDay: boolean; status: string; priority: string; ownerId: string | null; ownerName: string | null;
  participants: { userId: string; name: string | null; response: string }[]; client: { id: string; name: string } | null;
  contractId: string | null; renewalId: string | null; incidentId: string | null; taskId: string | null;
  recurring: boolean; recurrence: Recurrence | null; reminders: number[]; location: string | null; description: string | null;
  canEdit: boolean; external: string | null; createdByName: string | null; version: number | null;
};
export type Person = { id: string; name: string; role: string };
export type ListResult = { items: Item[]; people: Person[]; me: string; canAssign: boolean };
export type { Busy } from "@/core/agenda";
import type { Busy } from "@/core/agenda";
export type Availability = { users: { id: string; name: string; known: boolean }[]; busy: Busy[]; suggestions: { start: string; end: string; uncertain: string[] }[] };
export type Conflict = { userId: string; name: string; start: string; end: string; title: string | null; kind: string | null };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new Error("No hi ha connexió amb el servidor."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}
export const agendaApi = {
  list: (p: Record<string, string>) => call<ListResult>(`/api/agenda?${new URLSearchParams({ r: "list", ...p })}`),
  availability: (p: { users: string[]; from: string; to: string; duration?: number }) => call<Availability>(`/api/agenda?${new URLSearchParams({ r: "availability", users: p.users.join(","), from: p.from, to: p.to, ...(p.duration ? { duration: String(p.duration) } : {}) })}`),
  linked: (p: Record<string, string>) => call<{ events: { id: string; title: string; kind: EventKind; starts_at: string; ends_at: string; status: string; priority: string }[]; migrated: boolean }>(`/api/agenda?${new URLSearchParams({ r: "linked", ...p })}`),
  summary: () => call<Record<string, unknown>>("/api/agenda?r=summary"),
  act: <T = { ok: boolean }>(action: string, data: unknown) => call<T>("/api/agenda", { method: "POST", body: JSON.stringify({ action, data }) }),
  work: (action: string, id: string, data: unknown) => call<{ ok?: boolean }>("/api/work", { method: "POST", body: JSON.stringify({ action, id, data }) }),
};

/** Formulari de cita obert des de qualsevol pantalla (fitxa 360º, Kanban, contractes, incidències…). */
export type Prefill = Partial<{
  id: string; occurrenceStart: string; mode: "all" | "this"; title: string; kind: EventKind; scope: "personal" | "compartida"; starts_at: string; ends_at: string; all_day: boolean;
  location: string; priority: string; status: string; owner_id: string; participants: string[]; client: { id: string; name: string } | null; contract_id: string | null;
  renewal_id: string | null; incident_id: string | null; task_id: string | null; recurrence: Recurrence | null; reminders: number[]; description: string; version: number | null; context: string;
}>;
export const useComposer = create<{ prefill: Prefill | null; open: (p?: Prefill) => void; close: () => void; saved: number }>((set) => ({
  prefill: null, saved: 0,
  open: (p = {}) => set({ prefill: p }),
  close: () => set({ prefill: null }),
}));
export const markSaved = () => useComposer.setState((s) => ({ saved: s.saved + 1 }));
