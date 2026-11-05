"use client";
/**
 * AGENDA integrada al CRM (Fase 10): accions ràpides i cites vinculades per a la fitxa 360º, els contractes,
 * el Kanban de renovacions i les incidències. Sempre obren el mateix formulari de l'agenda (useComposer).
 */
import { useEffect, useState } from "react";
import { CalendarClock, CalendarPlus, PhoneCall, Repeat2, UserRoundCheck, Bell } from "lucide-react";
import { KIND_COLOR, KIND_LABEL, TZ, zonedToUtc, type EventKind } from "@/core/agenda";
import { supabaseConfigured } from "@/data/browserSupabase";
import { useApp } from "@/data/store";
import { cn } from "../../components/ui";
import { agendaApi, useComposer, type Prefill } from "./api";

type Action = { kind: EventKind; label: string; title: string; icon: React.ReactNode; minutes?: number; scope?: "personal" | "compartida"; daysAhead?: number };
/** Inici per defecte: demà a les 10:00 (hora de Madrid). */
const tomorrowAt = (h = 10, days = 1) => { const n = new Date(Date.now() + days * 86400000); const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(n).split("-").map(Number); return zonedToUtc(p[0], p[1], p[2], h, 0).toISOString(); };

export const CLIENT_ACTIONS = (name: string): Action[] => [
  { kind: "cita", label: "Crear cita", title: `Cita amb ${name}`, icon: <CalendarPlus size={13} /> },
  { kind: "trucada", label: "Programar trucada", title: `Trucar a ${name}`, icon: <PhoneCall size={13} />, minutes: 15 },
  { kind: "seguiment", label: "Programar seguiment", title: `Seguiment de ${name}`, icon: <Repeat2 size={13} />, minutes: 30, daysAhead: 7 },
];
export const CONTRACT_ACTIONS = (name: string): Action[] => [
  { kind: "recordatori", label: "Crear recordatori", title: `Recordatori: ${name}`, icon: <Bell size={13} />, minutes: 15 },
  { kind: "seguiment", label: "Programar renovació", title: `Renovació de ${name}`, icon: <Repeat2 size={13} />, minutes: 30 },
  { kind: "visita", label: "Assignar visita", title: `Visita a ${name}`, icon: <UserRoundCheck size={13} />, minutes: 60, scope: "compartida" },
  { kind: "seguiment", label: "Crear seguiment", title: `Seguiment de ${name}`, icon: <CalendarClock size={13} />, minutes: 30, daysAhead: 7 },
];

export function AgendaQuickActions({ actions, base, compact = false }: { actions: Action[]; base: Prefill; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Agenda">
      {actions.map((a) => (
        <button key={a.label} type="button" onClick={() => { const st = tomorrowAt(10, a.daysAhead ?? 1); useComposer.getState().open({ ...base, kind: a.kind, title: a.title, scope: a.scope ?? base.scope ?? "personal", starts_at: st, ends_at: new Date(new Date(st).getTime() + (a.minutes ?? 60) * 60000).toISOString() }); }}
          className={cn("pressable inline-flex items-center gap-1 rounded-full border border-line font-medium text-muted hover:border-brand/40 hover:text-brand", compact ? "px-2.5 py-1 text-[11.5px]" : "px-3 py-1.5 text-[12px]")}>
          {a.icon}{a.label}
        </button>
      ))}
    </div>
  );
}

/** Pròximes cites i recordatoris vinculats (client, contracte, targeta del Kanban o incidència). */
export function LinkedAgenda({ filter, empty = "Cap cita programada." }: { filter: Record<string, string>; empty?: string }) {
  const [rows, setRows] = useState<{ id: string; title: string; kind: EventKind; starts_at: string; status: string }[] | null>(null);
  const [migrated, setMigrated] = useState(true);
  const saved = useComposer((s) => s.saved);
  const key = JSON.stringify(filter);
  useEffect(() => {
    if (!supabaseConfigured) { setRows([]); return; }
    let alive = true;
    agendaApi.linked(filter).then((r) => { if (alive) { setRows(r.events); setMigrated(r.migrated); } }).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [key, saved]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div className="h-10 animate-pulse rounded-lg bg-elevated" />;
  if (!migrated) return <p className="text-[12px] text-muted">L&apos;agenda s&apos;activarà quan s&apos;apliqui la migració 020.</p>;
  const now = Date.now();
  const next = rows.filter((r) => new Date(r.starts_at).getTime() >= now - 3600000 && r.status !== "cancellada").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = rows.filter((r) => !next.includes(r)).slice(0, 3);
  if (!next.length && !past.length) return <p className="text-[12px] text-muted">{empty}</p>;
  const go = (r: { id: string; starts_at: string }) => useApp.getState().navigate("agenda", { date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(r.starts_at)), event: r.id });
  const fmt = (iso: string) => new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return (
    <ul className="space-y-1 text-[12.5px]">
      {[...next.slice(0, 5), ...past].map((r) => (
        <li key={r.id}><button type="button" onClick={() => go(r)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.04]", !next.includes(r) && "opacity-60")}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", KIND_COLOR[r.kind]?.dot)} />
          <span className="min-w-0 flex-1 truncate">{r.title}</span>
          <span className="shrink-0 text-[11px] text-muted">{KIND_LABEL[r.kind]} · {fmt(r.starts_at)}</span>
        </button></li>
      ))}
    </ul>
  );
}
