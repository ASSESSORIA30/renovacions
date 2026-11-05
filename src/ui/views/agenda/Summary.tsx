"use client";
/**
 * Fase 10 · Resum de tasques i cites per als panells d'inici: tasques d'avui, vençudes, pròximes cites, activitats
 * assignades, renovacions que necessiten seguiment i incidències amb tasques. Dades del gestor de tasques i de
 * l'agenda (sense cap base de dades nova). Accions ràpides: completar, reprogramar, obrir client/contracte, assignar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, ChevronRight, Clock, ExternalLink, Loader2, UserRoundPlus } from "lucide-react";
import { KIND_COLOR, KIND_LABEL, TZ, zonedToUtc } from "@/core/agenda";
import { daysUntil } from "@/core/dates";
import { expiry } from "@/core/insights";
import { titleCase } from "@/core/templates";
import { supabaseConfigured } from "@/data/browserSupabase";
import { useApp } from "@/data/store";
import { Button, cn } from "../../components/ui";
import { agendaApi, useComposer, type Item, type Person } from "./api";

type Task = { id: string; title: string; due_at: string | null; status: string; priority: string | null; kind: string | null; client: { id: string; name: string } | null; contract_id: string | null; incident: { id: string; title: string } | null; assigned_name: string | null };
type Sum = { today: Task[]; overdue: Task[]; assigned: Task[]; incidentTasks: Task[]; upcoming: Item[]; assignedEvents: Item[]; agendaMissing: boolean; canAssign: boolean };
const fmt = (iso: string | null, o: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }) => (iso ? new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, ...o }).format(new Date(iso)) : "—");
const plusDays = (iso: string | null, n: number) => { const base = iso ? new Date(iso) : new Date(); const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Math.max(base.getTime(), Date.now()) + n * 86400000)).split("-").map(Number); const h = iso ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso))) : 10; return zonedToUtc(p[0], p[1], p[2], h || 10, 0).toISOString(); };

export function AgendaSummaryCard() {
  const [d, setD] = useState<Sum | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"avui" | "vencudes" | "cites" | "assignades" | "renovacions" | "incidencies">("avui");
  const [people, setPeople] = useState<Person[]>([]);
  const saved = useComposer((s) => s.saved);
  const contracts = useApp((s) => s.contracts);
  const load = useCallback(() => { if (!supabaseConfigured) return; agendaApi.summary().then((x) => { setD(x as unknown as Sum); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(() => { load(); }, [load, saved]);
  useEffect(() => { if (d?.canAssign && !people.length) agendaApi.list({ from: new Date().toISOString(), to: new Date(Date.now() + 3600000).toISOString(), view: "personal", tasks: "0" }).then((r) => setPeople(r.people)).catch(() => undefined); }, [d?.canAssign, people.length]);
  // renovacions que necessiten seguiment: pendents/contactades que vencen en 30 dies o ja han vençut (dades del Kanban)
  const renewals = useMemo(() => contracts.filter((c) => ["pendiente", "contactado"].includes(c.crm.status) && (daysUntil(expiry(c)) ?? 999) <= 30).sort((a, b) => (daysUntil(expiry(a)) ?? 0) - (daysUntil(expiry(b)) ?? 0)).slice(0, 12), [contracts]);
  if (!supabaseConfigured) return null;
  const tabs = [
    { id: "avui" as const, label: "Avui", n: d?.today.length ?? 0 },
    { id: "vencudes" as const, label: "Vençudes", n: d?.overdue.length ?? 0, alert: true },
    { id: "cites" as const, label: "Pròximes cites", n: d?.upcoming.length ?? 0 },
    { id: "assignades" as const, label: "Assignades", n: (d?.assigned.length ?? 0) + (d?.assignedEvents.length ?? 0) },
    { id: "renovacions" as const, label: "Renovacions", n: renewals.length },
    { id: "incidencies" as const, label: "Incidències", n: d?.incidentTasks.length ?? 0 },
  ];
  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label="Tasques i agenda">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><CalendarClock size={15} className="text-brand" /> Tasques i agenda</h3>
        <Button size="sm" className="ml-auto" onClick={() => useApp.getState().navigate("agenda", {})}>Obre l&apos;agenda <ChevronRight size={13} /></Button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1" role="tablist">
        {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("rounded-lg px-2.5 py-1 text-[12px] font-medium", tab === t.id ? "bg-ink/[0.08] text-ink" : "text-muted hover:text-ink")}>{t.label} <span className={cn("tnum", t.alert && t.n > 0 && "font-bold text-lost")}>{t.n}</span></button>)}
      </div>
      {err && <p className="text-[12px] text-lost">{err}</p>}
      {!d ? !err && <div className="h-24 animate-pulse rounded-xl bg-elevated" /> : (
        <div className="max-h-80 overflow-y-auto">
          {tab === "avui" && <TaskList rows={d.today} empty="Cap tasca per a avui." canAssign={d.canAssign} people={people} onDone={load} />}
          {tab === "vencudes" && <TaskList rows={d.overdue} empty="No tens tasques vençudes. 👍" overdue canAssign={d.canAssign} people={people} onDone={load} />}
          {tab === "assignades" && <>
            <TaskList rows={d.assigned} empty="" canAssign={d.canAssign} people={people} onDone={load} />
            <EventList rows={d.assignedEvents} empty={d.assigned.length ? "" : "Ningú no t'ha assignat activitats noves."} />
          </>}
          {tab === "cites" && (d.agendaMissing ? <p className="text-[12.5px] text-muted">L&apos;agenda s&apos;activarà quan s&apos;apliqui la migració 020.</p> : <EventList rows={d.upcoming} empty="Cap cita en els propers 7 dies." />)}
          {tab === "incidencies" && <TaskList rows={d.incidentTasks} empty="Cap incidència pendent amb tasques." canAssign={d.canAssign} people={people} onDone={load} />}
          {tab === "renovacions" && (renewals.length ? (
            <ul className="divide-y divide-line text-[12.5px]">{renewals.map((c) => { const dd = daysUntil(expiry(c)); return (
              <li key={c.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{titleCase(c.cliente)}</span>
                <span className={cn("text-[11.5px]", (dd ?? 0) < 0 ? "text-lost" : "text-muted")}>{dd == null ? "—" : dd < 0 ? `vençut fa ${-dd} d` : `venç en ${dd} d`}</span>
                <Button size="sm" variant="ghost" onClick={() => useComposer.getState().open({ kind: "seguiment", title: `Seguiment renovació ${titleCase(c.cliente)}`, renewal_id: c.id, starts_at: plusDays(null, 1), ends_at: new Date(new Date(plusDays(null, 1)).getTime() + 1800000).toISOString(), context: titleCase(c.cliente) })}><CalendarClock size={12} /> Programa</Button>
                <Button size="sm" variant="ghost" onClick={() => { useApp.getState().navigate("kanban", {}); useApp.getState().open(c.id); }}><ExternalLink size={12} /></Button>
              </li>); })}</ul>
          ) : <p className="text-[12.5px] text-muted">Cap renovació urgent pendent de seguiment.</p>)}
        </div>
      )}
    </section>
  );
}

function TaskList({ rows, empty, overdue, canAssign, people, onDone }: { rows: Task[]; empty: string; overdue?: boolean; canAssign: boolean; people: Person[]; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState<string | null>(null);
  const act = async (id: string, data: Record<string, unknown>, ok: string) => {
    setBusy(id);
    try { await agendaApi.work("task_update", id, data); useApp.getState().toast({ title: ok, tone: "ok" }); onDone(); }
    catch (e) { useApp.getState().toast({ title: "No s'ha pogut fer", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  if (!rows.length) return empty ? <p className="text-[12.5px] text-muted">{empty}</p> : null;
  return (
    <ul className="divide-y divide-line text-[12.5px]">
      {rows.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5">
          <button aria-label={`Completa ${t.title}`} title="Marca-la com a feta" disabled={busy === t.id} onClick={() => void act(t.id, { status: "feta" }, "Tasca completada")} className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line hover:border-ren hover:text-ren">{busy === t.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}</button>
          <button onClick={() => useApp.getState().navigate("tasques", { id: t.id })} className="min-w-0 flex-1 truncate text-left font-medium hover:text-brand" title="Detall de la tasca">{t.title}</button>
          {t.priority === "urgent" || t.priority === "alta" ? <AlertTriangle size={12} className={t.priority === "urgent" ? "text-lost" : "text-amber-500"} aria-label={`Prioritat ${t.priority}`} /> : null}
          <span className={cn("flex items-center gap-1 text-[11.5px]", overdue ? "text-lost" : "text-muted")}><Clock size={11} />{fmt(t.due_at, overdue ? { day: "numeric", month: "short" } : { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="flex gap-1">
            <button className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-ink" disabled={busy === t.id} onClick={() => void act(t.id, { due_at: plusDays(t.due_at, 1) }, "Reprogramada per a demà")} title="Reprograma-la per a demà">+1 d</button>
            {t.client && <button className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-ink" onClick={() => useApp.getState().navigate("client", { id: t.client!.id })} title="Obre el client">{t.client.name.slice(0, 18)}</button>}
            {t.contract_id && t.client && <button className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-ink" onClick={() => useApp.getState().navigate("client", { id: t.client!.id, tab: "contractes" })}>Contracte</button>}
            {canAssign && <button aria-label="Assigna a una altra persona" className="rounded-md border border-line px-1.5 py-0.5 text-muted hover:text-ink" onClick={() => setAssign(assign === t.id ? null : t.id)}><UserRoundPlus size={11} /></button>}
          </span>
          {assign === t.id && (
            <select className="input h-8 w-full py-0 text-[12px]" defaultValue="" onChange={(e) => { if (e.target.value) { setAssign(null); void act(t.id, { assigned_to: e.target.value }, "Tasca reassignada"); } }} aria-label="Nova persona responsable">
              <option value="">Assigna a…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </li>
      ))}
    </ul>
  );
}

function EventList({ rows, empty }: { rows: Item[]; empty: string }) {
  if (!rows.length) return empty ? <p className="text-[12.5px] text-muted">{empty}</p> : null;
  return (
    <ul className="divide-y divide-line text-[12.5px]">
      {rows.map((it) => (
        <li key={it.occurrenceId}><button className="flex w-full items-center gap-2 py-1.5 text-left hover:text-brand" onClick={() => useApp.getState().navigate("agenda", { date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(it.start)), event: it.id })}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", KIND_COLOR[it.kind].dot)} />
          <span className="min-w-0 flex-1 truncate font-medium">{it.title}{it.client ? <span className="font-normal text-muted"> · {it.client.name}</span> : null}</span>
          <span className="shrink-0 text-[11.5px] capitalize text-muted">{KIND_LABEL[it.kind]} · {fmt(it.start, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </button></li>
      ))}
    </ul>
  );
}
