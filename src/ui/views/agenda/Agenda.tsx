"use client";
/**
 * AGENDA (Fase 10): personal, compartida i combinada, en vista mensual, setmanal o diària, i disponibilitat de l'equip.
 * Conserva la data, la vista i els filtres en sortir-ne (per exemple, per obrir un client des d'una cita).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, ExternalLink, Link2, ListTodo, Loader2, Lock, MapPin, Plug, RefreshCw, Repeat, Trash2, Users, X,
} from "lucide-react";
import {
  EVENT_KINDS, KIND_COLOR, KIND_LABEL, PRIORITY_LABEL, STATUS_LABEL, TZ, addDaysLocal, describeRecurrence, localDate, localParts, mondayOf, overlaps, reminderLabel, startOfLocalDay, zonedToUtc,
  type EventKind, type Priority, type EventStatus,
} from "@/core/agenda";
import { supabaseConfigured } from "@/data/browserSupabase";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, cn } from "../../components/ui";
import { useViewState } from "../../useViewState";
import { agendaApi, useComposer, type Availability, type Item, type ListResult } from "./api";

type Mode = "personal" | "compartida" | "combinada" | "disponibilitat";
type Period = "mes" | "setmana" | "dia";
const MODES: [Mode, string][] = [["personal", "La meva agenda"], ["compartida", "Agenda compartida"], ["combinada", "Vista combinada"], ["disponibilitat", "Disponibilitat de l'equip"]];
const HOURS = { from: 7, to: 21 };
const HOUR_PX = 48;
const fmtT = (iso: string) => new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fmtDay = (date: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ca-ES", { timeZone: "UTC", ...o }).format(new Date(`${date}T12:00:00Z`));
const PRIO_MARK: Record<string, string> = { urgent: "border-l-red-500", alta: "border-l-amber-500", normal: "border-l-transparent", baixa: "border-l-transparent" };

function rangeOf(period: Period, date: string) {
  if (period === "dia") return { from: date, days: 1 };
  if (period === "setmana") return { from: mondayOf(date), days: 7 };
  const first = `${date.slice(0, 7)}-01`;
  return { from: mondayOf(first), days: 42 };
}

export function AgendaView() {
  const params = useApp((s) => s.params);
  const me = useApp((s) => s.snap?.me);
  const [mode, setMode] = useViewState<Mode>("agenda.mode", "combinada");
  const [period, setPeriod] = useViewState<Period>("agenda.period", "setmana");
  const [date, setDate] = useViewState<string>("agenda.date", localDate(new Date()));
  const [users, setUsers] = useViewState<string[]>("agenda.users", []);
  const [kinds, setKinds] = useViewState<EventKind[]>("agenda.kinds", []);
  const [data, setData] = useState<ListResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  const [connect, setConnect] = useState(false);
  const saved = useComposer((s) => s.saved);

  // enllaços dels avisos: ?date=YYYY-MM-DD&event=…
  useEffect(() => { if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) setDate(params.date); }, [params.date, setDate]);
  useEffect(() => { if (params.calendar) setConnect(true); }, [params.calendar]);

  const r = rangeOf(period, date);
  const fromIso = startOfLocalDay(r.from).toISOString();
  const toIso = startOfLocalDay(addDaysLocal(r.from, r.days)).toISOString();
  const load = useCallback(async () => {
    if (!supabaseConfigured) { setData({ items: [], people: [], me: me?.id ?? "", canAssign: false }); setErr("L'agenda necessita Supabase (en mode local no hi ha dades del servidor)."); return; }
    if (mode === "disponibilitat") return;
    setLoading(true);
    try { const d = await agendaApi.list({ from: fromIso, to: toIso, view: mode, ...(users.length ? { users: users.join(",") } : {}), ...(kinds.length ? { kinds: kinds.join(",") } : {}) }); setData(d); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [fromIso, toIso, mode, users, kinds, me?.id]);
  useEffect(() => { void load(); }, [load, saved]);
  useEffect(() => { if (params.event && data) { const it = data.items.find((x) => x.id === params.event); if (it) setOpen(it); } }, [params.event, data]);

  const step = (n: number) => setDate(period === "dia" ? addDaysLocal(date, n) : period === "setmana" ? addDaysLocal(date, 7 * n) : (() => { const [y, m] = date.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return t.toISOString().slice(0, 10); })());
  const title = period === "mes" ? fmtDay(`${date.slice(0, 7)}-15`, { month: "long", year: "numeric" }) : period === "setmana" ? `${fmtDay(r.from, { day: "numeric", month: "short" })} – ${fmtDay(addDaysLocal(r.from, 6), { day: "numeric", month: "short", year: "numeric" })}` : fmtDay(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const newAt = (startIso?: string) => useComposer.getState().open({ starts_at: startIso, scope: mode === "compartida" ? "compartida" : "personal" });

  return (
    <div className="mx-auto max-w-[1500px] space-y-3 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><CalendarDays size={20} className="text-brand" /> Agenda</h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setConnect(true)}><Plug size={13} /> Connectar calendari</Button>
          <Button size="sm" variant="primary" onClick={() => newAt()}><CalendarPlus size={14} /> Nova cita</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Agenda">
        {MODES.map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cn("pressable rounded-lg px-3 py-1.5 text-[13px] font-medium", mode === k ? "bg-ink text-surface" : "text-muted hover:bg-ink/[0.05] hover:text-ink")}>{l}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2">
        <Button size="sm" onClick={() => setDate(localDate(new Date()))}>Avui</Button>
        <button aria-label="Anterior" onClick={() => step(-1)} className="rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink"><ChevronLeft size={16} /></button>
        <button aria-label="Següent" onClick={() => step(1)} className="rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink"><ChevronRight size={16} /></button>
        <span className="min-w-[180px] text-[14px] font-semibold first-letter:uppercase" aria-live="polite">{title}</span>
        {loading && <Loader2 size={14} className="animate-spin text-muted" />}
        <div className="ml-auto flex items-center gap-2">
          {mode !== "disponibilitat" && <PeopleFilter people={data?.people ?? []} value={users} onChange={setUsers} />}
          <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Període">
            {(["mes", "setmana", "dia"] as Period[]).map((p) => <button key={p} role="radio" aria-checked={period === p} onClick={() => setPeriod(p)} className={cn("rounded-md px-2.5 py-1 text-[12.5px] capitalize", period === p ? "bg-ink/[0.08] font-semibold" : "text-muted")}>{p}</button>)}
          </div>
        </div>
      </div>
      {mode !== "disponibilitat" && (
        <div className="flex flex-wrap gap-1.5" aria-label="Filtra per tipus">
          {EVENT_KINDS.map((k) => { const on = !kinds.length || kinds.includes(k); return (
            <button key={k} aria-pressed={kinds.includes(k)} onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px]", kinds.includes(k) ? "border-brand bg-brand/10 text-brand" : "border-line", !on && "opacity-50")}>
              <span className={cn("h-2 w-2 rounded-full", KIND_COLOR[k].dot)} />{KIND_LABEL[k]}
            </button>); })}
          {kinds.length > 0 && <button onClick={() => setKinds([])} className="text-[11.5px] text-muted hover:text-ink">Treu els filtres</button>}
        </div>
      )}
      {err && <Notice tone={/020/.test(err) ? "amber" : "red"}>{err}</Notice>}
      {mode === "disponibilitat" ? <TeamAvailability date={date} period={period} /> : !data ? <div className="h-[520px] animate-pulse rounded-2xl bg-elevated" /> : period === "mes"
        ? <MonthGrid from={r.from} month={date.slice(0, 7)} items={data.items} onOpen={setOpen} onDay={(d) => { setDate(d); setPeriod("dia"); }} onNew={(d) => newAt(zonedToUtc(...(d.split("-").map(Number) as [number, number, number]), 9, 0).toISOString())} />
        : <TimeGrid from={r.from} days={r.days} items={data.items} onOpen={setOpen} onNew={newAt} />}
      {open && <EventDetail item={open} me={data?.me ?? me?.id ?? ""} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); void load(); }} />}
      {connect && <CalendarConnect onClose={() => { setConnect(false); if (params.calendar) useApp.getState().navigate("agenda", {}, { replace: true }); }} flash={params.calendar ? { ok: params.calendar === "ok", msg: params.msg ?? "" } : null} onSynced={() => void load()} />}
    </div>
  );
}

function PeopleFilter({ people, value, onChange }: { people: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open}><Users size={13} /> {value.length ? `${value.length} persona${value.length > 1 ? "es" : ""}` : "Tothom"}</Button>
      {open && (
        <div className="absolute right-0 top-10 z-30 max-h-80 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lift">
          <button className="w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-ink/[0.05]" onClick={() => { onChange([]); setOpen(false); }}>Tothom</button>
          {people.map((p) => <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-ink/[0.05]"><input type="checkbox" checked={value.includes(p.id)} onChange={() => onChange(value.includes(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])} />{p.name}</label>)}
        </div>
      )}
    </div>
  );
}

/* ======================================================================= vista mensual */

function Chip({ it, onOpen }: { it: Item; onOpen: (i: Item) => void }) {
  const c = KIND_COLOR[it.kind];
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(it); }} title={`${KIND_LABEL[it.kind]} · ${it.title}`}
      className={cn("flex w-full items-center gap-1 truncate rounded-md border-l-2 px-1.5 py-0.5 text-left text-[11px]", c.bg, c.text, PRIO_MARK[it.priority], ["cancellada", "feta"].includes(it.status) && "line-through opacity-60")}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.dot)} />{!it.allDay && <span className="shrink-0 tnum opacity-80">{fmtT(it.start)}</span>}<span className="truncate">{it.title}</span>
      {it.scope === "personal" && it.source === "event" && <Lock size={9} className="ml-auto shrink-0 opacity-50" />}
    </button>
  );
}

function MonthGrid({ from, month, items, onOpen, onDay, onNew }: { from: string; month: string; items: Item[]; onOpen: (i: Item) => void; onDay: (d: string) => void; onNew: (d: string) => void }) {
  const today = localDate(new Date());
  const byDay = useMemo(() => { const m = new Map<string, Item[]>(); for (const it of items) { const d = localDate(it.start); m.set(d, [...(m.get(d) ?? []), it]); } return m; }, [items]);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-semibold uppercase tracking-wide text-muted">{["dl", "dt", "dc", "dj", "dv", "ds", "dg"].map((d) => <div key={d} className="py-1.5">{d}</div>)}</div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => addDaysLocal(from, i)).map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <div key={d} role="gridcell" onDoubleClick={() => onNew(d)} className={cn("min-h-[104px] border-b border-r border-line p-1", d.slice(0, 7) !== month && "bg-ink/[0.02] text-muted")}>
              <div className="mb-0.5 flex items-center justify-between">
                <button onClick={() => onDay(d)} className={cn("grid h-6 w-6 place-items-center rounded-full text-[12px] hover:bg-ink/[0.06]", d === today && "bg-brand font-semibold text-white")} aria-label={`Obre el dia ${d}`}>{Number(d.slice(8))}</button>
                <button onClick={() => onNew(d)} className="rounded px-1 text-[13px] text-muted opacity-0 hover:text-ink focus:opacity-100 [div:hover>div>&]:opacity-100" aria-label={`Nova cita el ${d}`}>+</button>
              </div>
              <div className="space-y-0.5">{list.slice(0, 3).map((it) => <Chip key={it.occurrenceId} it={it} onOpen={onOpen} />)}{list.length > 3 && <button onClick={() => onDay(d)} className="text-[11px] text-muted hover:text-ink">+{list.length - 3} més</button>}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ======================================================================= vistes setmanal i diària */

function lanes(list: Item[]) {
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const out: { it: Item; lane: number; of: number }[] = [];
  let group: { it: Item; lane: number }[] = [];
  let groupEnd = 0;
  const flush = () => { const n = Math.max(1, ...group.map((g) => g.lane + 1)); for (const g of group) out.push({ ...g, of: n }); group = []; };
  for (const it of sorted) {
    const s = new Date(it.start).getTime();
    if (group.length && s >= groupEnd) { flush(); groupEnd = 0; }
    const used = new Set(group.filter((g) => new Date(g.it.end).getTime() > s).map((g) => g.lane));
    let lane = 0; while (used.has(lane)) lane++;
    group.push({ it, lane });
    groupEnd = Math.max(groupEnd, new Date(it.end).getTime());
  }
  flush();
  return out;
}

function TimeGrid({ from, days, items, onOpen, onNew }: { from: string; days: number; items: Item[]; onOpen: (i: Item) => void; onNew: (iso: string) => void }) {
  const dates = Array.from({ length: days }, (_, i) => addDaysLocal(from, i));
  const today = localDate(new Date());
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const hours = Array.from({ length: HOURS.to - HOURS.from }, (_, i) => HOURS.from + i);
  const pos = (iso: string) => { const p = localParts(iso); return ((p.h - HOURS.from) * 60 + p.mi) * (HOUR_PX / 60); };
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <div className="min-w-[720px]">
        <div className="grid border-b border-line" style={{ gridTemplateColumns: `56px repeat(${days}, minmax(0,1fr))` }}>
          <div />
          {dates.map((d) => (
            <div key={d} className={cn("border-l border-line px-2 py-1.5 text-[12px]", d === today && "bg-brand/[0.06]")}>
              <span className="font-semibold capitalize">{fmtDay(d, { weekday: "short" })}</span> <span className={cn("tnum", d === today && "font-bold text-brand")}>{Number(d.slice(8))}</span>
              <div className="mt-1 space-y-0.5">{items.filter((it) => it.allDay && localDate(it.start) <= d && localDate(new Date(new Date(it.end).getTime() - 1)) >= d).map((it) => <Chip key={it.occurrenceId} it={it} onOpen={onOpen} />)}</div>
            </div>
          ))}
        </div>
        <div className="scroll-thin relative max-h-[640px] overflow-y-auto pt-2">
          <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days}, minmax(0,1fr))` }}>
            <div>{hours.map((h) => <div key={h} className="relative border-b border-line/60 pr-1.5 text-right text-[10.5px] text-muted tnum" style={{ height: HOUR_PX }}><span className="relative -top-2">{String(h).padStart(2, "0")}:00</span></div>)}</div>
            {dates.map((d) => {
              const list = items.filter((it) => !it.allDay && localDate(it.start) === d);
              const [y, m, dd] = d.split("-").map(Number);
              return (
                <div key={d} className={cn("relative border-l border-line", d === today && "bg-brand/[0.025]")}>
                  {hours.map((h) => <button key={h} type="button" aria-label={`Nova cita el ${d} a les ${h}:00`} onClick={() => onNew(zonedToUtc(y, m, dd, h, 0).toISOString())} className="block w-full border-b border-line/60 hover:bg-brand/[0.04]" style={{ height: HOUR_PX }} />)}
                  {d === today && (() => { const p = pos(now.toISOString()); return p >= 0 && p <= hours.length * HOUR_PX ? <div className="pointer-events-none absolute left-0 right-0 z-10 h-0.5 bg-red-500" style={{ top: p }} aria-hidden /> : null; })()}
                  {lanes(list).map(({ it, lane, of }) => {
                    const top = Math.max(0, pos(it.start)), h = Math.max(20, pos(it.end) - pos(it.start));
                    const c = KIND_COLOR[it.kind];
                    return (
                      <button key={it.occurrenceId} type="button" onClick={() => onOpen(it)} title={`${KIND_LABEL[it.kind]} · ${it.title}`}
                        className={cn("absolute z-[5] overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm", c.bg, c.text, PRIO_MARK[it.priority] === "border-l-transparent" ? "border-l-current/40" : PRIO_MARK[it.priority], ["cancellada", "feta"].includes(it.status) && "opacity-55 line-through")}
                        style={{ top, height: h, left: `calc(${(lane / of) * 100}% + 2px)`, width: `calc(${100 / of}% - 4px)` }}>
                        <span className="block truncate font-semibold">{it.title}</span>
                        <span className="block truncate opacity-80">{fmtT(it.start)}–{fmtT(it.end)}{it.ownerName && it.source === "event" ? ` · ${it.ownerName}` : ""}</span>
                        {h > 44 && it.client && <span className="block truncate opacity-80">{it.client.name}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================= detall */

function EventDetail({ item: it, me, onClose, onChanged }: { item: Item; me: string; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const [resched, setResched] = useState(false);
  const [newDue, setNewDue] = useState(() => { const p = localParts(it.start); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}T${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`; });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(null);
    try { await fn(); useApp.getState().toast({ title: ok, tone: "ok" }); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const mine = it.participants.find((p) => p.userId === me);
  const go = (fn: () => void) => { onClose(); fn(); };
  const c = KIND_COLOR[it.kind];
  const occStart = it.recurring ? it.start : undefined;
  const edit = () => go(() => useComposer.getState().open({
    id: it.id, occurrenceStart: occStart, title: it.title, kind: it.kind, scope: it.scope, starts_at: it.start, ends_at: it.end, all_day: it.allDay, location: it.location ?? "",
    priority: it.priority, status: it.status, owner_id: it.ownerId ?? undefined, participants: it.participants.map((p) => p.userId), client: it.client, contract_id: it.contractId,
    renewal_id: it.renewalId, incident_id: it.incidentId, task_id: it.taskId, recurrence: it.recurrence, reminders: it.reminders, description: it.description ?? "", version: it.version,
  }));
  return (
    <Modal open onClose={onClose} width="max-w-xl" title={<span className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full", c.dot)} />{it.title}</span>}
      footer={<div className="flex w-full flex-wrap items-center gap-2">
        {it.source === "task" ? <>
          {!["feta", "cancellada"].includes(it.status) && <Button disabled={busy} onClick={() => void run(() => agendaApi.work("task_update", it.id, { status: "feta" }), "Tasca completada")}><Check size={14} /> Completada</Button>}
          <Button disabled={busy} onClick={() => setResched(!resched)}>Reprograma</Button>
        </> : it.canEdit && !it.external ? <>
          {it.status !== "feta" && <Button disabled={busy} onClick={() => void run(() => agendaApi.act("status", { id: it.id, status: "feta" }), "Marcada com a feta")}><Check size={14} /> Feta</Button>}
          <Button disabled={busy} onClick={edit}>Edita</Button>
          <Button variant="ghost" className="text-lost" disabled={busy} onClick={() => setDel(true)}><Trash2 size={14} /> Elimina</Button>
        </> : null}
        {mine && it.source === "event" && <span className="flex gap-1.5">
          <Button size="sm" variant={mine.response === "accepta" ? "primary" : "secondary"} disabled={busy} onClick={() => void run(() => agendaApi.act("respond", { id: it.id, response: "accepta" }), "Has acceptat la cita")}>Accepto</Button>
          <Button size="sm" variant={mine.response === "rebutja" ? "primary" : "secondary"} disabled={busy} onClick={() => void run(() => agendaApi.act("respond", { id: it.id, response: "rebutja" }), "Has rebutjat la cita")}>No hi aniré</Button>
        </span>}
        <Button variant="ghost" className="ml-auto" onClick={onClose}>Tanca</Button>
      </div>}>
      <div className="space-y-3 text-[13px]">
        {err && <Notice tone="red">{err}</Notice>}
        <div className="flex flex-wrap gap-1.5">
          <Badge>{KIND_LABEL[it.kind]}</Badge>
          <Badge tone={it.scope === "personal" ? "zinc" : "blue"}>{it.scope === "personal" ? "Personal" : "Compartida"}</Badge>
          {it.source === "event" && <Badge tone={it.status === "cancellada" ? "red" : it.status === "feta" ? "green" : "zinc"}>{STATUS_LABEL[it.status as EventStatus] ?? it.status}</Badge>}
          {it.source === "task" && <Badge tone={it.status === "feta" ? "green" : "zinc"}>Tasca · {it.status}</Badge>}
          {it.priority !== "normal" && <Badge tone={it.priority === "urgent" ? "red" : it.priority === "alta" ? "orange" : "zinc"}>Prioritat {PRIORITY_LABEL[it.priority as Priority]?.toLowerCase() ?? it.priority}</Badge>}
          {it.external && <Badge tone="blue">{it.external === "google" ? "Google Calendar" : "Outlook"}</Badge>}
        </div>
        <p className="capitalize">{new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(it.start))}{it.allDay ? " · tot el dia" : ` · ${fmtT(it.start)}–${fmtT(it.end)}`}</p>
        {it.recurring && <p className="flex items-center gap-1.5 text-muted"><Repeat size={13} /> {describeRecurrence(it.recurrence)}</p>}
        {it.location && <p className="flex items-center gap-1.5"><MapPin size={13} className="text-muted" /> {it.location}</p>}
        {it.ownerName && <p><span className="text-muted">Responsable:</span> {it.ownerName}{it.createdByName && it.createdByName !== it.ownerName ? <span className="text-muted"> · creada per {it.createdByName}</span> : null}</p>}
        {it.participants.length > 0 && <p><span className="text-muted">Participants:</span> {it.participants.map((p) => `${p.name ?? "—"}${p.response === "accepta" ? " ✓" : p.response === "rebutja" ? " ✗" : " ?"}`).join(", ")}</p>}
        {it.reminders.length > 0 && <p className="text-muted">Recordatoris: {it.reminders.map(reminderLabel).join(", ")} abans</p>}
        {it.description && <p className="whitespace-pre-wrap rounded-lg bg-ink/[0.03] p-2.5">{it.description}</p>}
        {(it.client || it.renewalId || it.incidentId) && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {it.client && <Button size="sm" onClick={() => go(() => useApp.getState().navigate("client", { id: it.client!.id }))}><ExternalLink size={13} /> {it.client.name}</Button>}
            {it.renewalId && useApp.getState().byId[it.renewalId] && <Button size="sm" onClick={() => go(() => useApp.getState().open(it.renewalId!))}><Link2 size={13} /> Contracte de renovació</Button>}
            {it.incidentId && it.client && <Button size="sm" onClick={() => go(() => useApp.getState().navigate("client", { id: it.client!.id, tab: "incidencies" }))}><Link2 size={13} /> Incidència</Button>}
          </div>
        )}
        {resched && it.source === "task" && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-2.5">
            <label className="block"><span className="label">Nova data i hora</span><input className="input" type="datetime-local" value={newDue} onChange={(e) => setNewDue(e.target.value)} /></label>
            <Button size="sm" variant="primary" disabled={busy || !newDue} onClick={() => { const [d, t] = newDue.split("T"); const [y, m, dd] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number); void run(() => agendaApi.work("task_update", it.id, { due_at: zonedToUtc(y, m, dd, h, mi).toISOString() }), "Tasca reprogramada"); }}>Desa</Button>
          </div>
        )}
        {del && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/[0.05] p-2.5" role="alertdialog" aria-label="Eliminar la cita">
            <span className="text-[12.5px] font-medium">Segur que vols eliminar-la?</span>
            <Button size="sm" variant="ghost" onClick={() => setDel(false)}>No</Button>
            {it.recurring && <Button size="sm" disabled={busy} onClick={() => void run(() => agendaApi.act("delete", { id: it.id, mode: "this", occurrenceStart: it.start }), "Ocurrència eliminada")}>Només aquesta</Button>}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => agendaApi.act("delete", { id: it.id, mode: "all" }), "Cita eliminada")}>{it.recurring ? "Tota la sèrie" : "Sí, elimina-la"}</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ======================================================================= disponibilitat de l'equip */

function TeamAvailability({ date, period }: { date: string; period: Period }) {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [sel, setSel] = useViewState<string[]>("agenda.avail.users", []);
  const [dur, setDur] = useState(60);
  const [d, setD] = useState<Availability | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const day = period === "dia" ? date : date;
  const from = startOfLocalDay(day).toISOString(), to = startOfLocalDay(addDaysLocal(day, 1)).toISOString();
  useEffect(() => { if (!supabaseConfigured) return; agendaApi.list({ from, to, view: "personal", tasks: "0" }).then((r) => { setPeople(r.people); if (!sel.length) setSel(r.people.slice(0, 8).map((p) => p.id)); }).catch((e) => setErr(String(e instanceof Error ? e.message : e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sel.length) return; agendaApi.availability({ users: sel, from, to, duration: dur }).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, [sel, from, to, dur]);
  const hours = Array.from({ length: 12 }, (_, i) => 8 + i);
  const [y, m, dd] = day.split("-").map(Number);
  const x0 = zonedToUtc(y, m, dd, 8, 0).getTime(), span = 12 * 3600000;
  const pct = (iso: string) => Math.min(100, Math.max(0, ((new Date(iso).getTime() - x0) / span) * 100));
  return (
    <div className="space-y-3">
      {err && <Notice tone="red">{err}</Notice>}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-muted">Persones:</span>
        <PeopleFilter people={people} value={sel} onChange={setSel} />
        <span className="ml-2 text-muted">Durada de la reunió:</span>
        <select className="input h-8 w-auto py-0" value={dur} onChange={(e) => setDur(Number(e.target.value))}>{[15, 30, 45, 60, 90, 120].map((x) => <option key={x} value={x}>{x} min</option>)}</select>
        <span className="ml-auto flex items-center gap-3 text-[11.5px] text-muted"><span className="flex items-center gap-1"><span className="h-3 w-5 rounded bg-red-500/30" /> Ocupat</span><span className="flex items-center gap-1"><span className="h-3 w-5 rounded bg-emerald-500/15" /> Disponible</span><span className="flex items-center gap-1"><span className="h-3 w-5 rounded bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,.08)_3px,rgba(0,0,0,.08)_6px)]" /> Sense informació</span></span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-3">
        <div className="min-w-[720px]">
          <div className="ml-40 flex text-[10.5px] text-muted">{hours.map((h) => <span key={h} className="flex-1 border-l border-line/60 pl-1 tnum">{h}:00</span>)}</div>
          {(d?.users ?? []).map((u) => (
            <div key={u.id} className="mt-1.5 flex items-center">
              <span className="w-40 truncate pr-2 text-[12.5px] font-medium">{u.name}{!u.known && <span className="block text-[10.5px] font-normal text-muted">sense informació d&apos;agenda</span>}</span>
              <div className={cn("relative h-8 flex-1 rounded-md", u.known ? "bg-emerald-500/10" : "bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,.05)_4px,rgba(0,0,0,.05)_8px)]")}>
                {(d?.busy ?? []).filter((b) => b.userId === u.id && overlaps(b, { start: new Date(x0).toISOString(), end: new Date(x0 + span).toISOString() })).map((b, i) => (
                  <span key={i} className="absolute top-0.5 bottom-0.5 overflow-hidden rounded bg-red-500/30 px-1 text-[10.5px] leading-7 text-red-900 dark:text-red-100" style={{ left: `${pct(b.start)}%`, width: `${Math.max(1, pct(b.end) - pct(b.start))}%` }} title={b.private ? "Ocupat" : b.title ?? "Ocupat"}>{b.private ? "Ocupat" : b.title}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {d && d.suggestions.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-3 text-[12.5px]">
          <p className="mb-2 font-semibold">Franges lliures per a tothom ({dur} min)</p>
          <div className="flex flex-wrap gap-1.5">{d.suggestions.map((s) => (
            <button key={s.start} onClick={() => useComposer.getState().open({ kind: "reunio", scope: "compartida", starts_at: s.start, ends_at: s.end, participants: sel })} className="rounded-lg border border-line px-2.5 py-1 hover:border-brand hover:text-brand">
              <span className="capitalize">{new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, weekday: "short", day: "numeric" }).format(new Date(s.start))}</span> {fmtT(s.start)}–{fmtT(s.end)}{s.uncertain.length ? " · a confirmar" : ""}
            </button>))}</div>
          <p className="mt-1.5 text-[11px] text-muted">«A confirmar»: alguna persona no té informació d&apos;agenda (ni cites ni calendari connectat).</p>
        </div>
      )}
    </div>
  );
}

/* ======================================================================= calendaris externs */

type CalStatus = { migrated: boolean; providers: Record<"google" | "microsoft", { configured: boolean; missing: string[] }>; redirectUris: Record<string, string> | null; connections: { provider: "google" | "microsoft"; account_email: string | null; mode: string; status: string; last_sync_at: string | null; last_error: string | null }[] };
const MODE_LABEL: Record<string, string> = { lectura: "Només consultar les cites externes", exportacio: "Exportar les cites del CRM", bidireccional: "Sincronització bidireccional" };

function CalendarConnect({ onClose, flash, onSynced }: { onClose: () => void; flash: { ok: boolean; msg: string } | null; onSynced: () => void }) {
  const [s, setS] = useState<CalStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<Record<string, string>>({ google: "lectura", microsoft: "lectura" });
  const [confirm, setConfirm] = useState<Record<string, boolean>>({});
  const load = () => fetch("/api/calendar", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setS(j); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { if (supabaseConfigured) void load(); else setErr("Cal Supabase per connectar calendaris."); }, []);
  const post = async (action: string, data: unknown) => {
    const r = await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
    return j;
  };
  const act = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={<span className="flex items-center gap-2"><Plug size={16} /> Connectar calendari</span>}>
      <div className="space-y-3 text-[13px]">
        {flash && <Notice tone={flash.ok ? "green" : "red"}>{flash.msg}</Notice>}
        {err && <Notice tone="red">{err}</Notice>}
        {!s ? !err && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Carregant…</p> : (["google", "microsoft"] as const).map((p) => {
          const cfg = s.providers[p];
          const c = s.connections.find((x) => x.provider === p && x.status !== "revocat");
          const label = p === "google" ? "Google Calendar" : "Outlook / Microsoft 365";
          return (
            <section key={p} className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{label}</span>
                {c?.status === "connectat" ? <Badge tone="green">Connectat{c.account_email ? ` · ${c.account_email}` : ""}</Badge> : c?.status === "error" ? <Badge tone="red">Cal tornar a connectar</Badge> : <Badge>No connectat</Badge>}
              </div>
              {!cfg.configured ? (
                <p className="text-[12px] text-muted">No disponible encara: falten variables a Vercel ({cfg.missing.join(", ")}). Direcció les ha de configurar amb una aplicació OAuth{p === "google" ? " de Google Cloud" : " d'Azure (Microsoft Entra)"}{s.redirectUris ? <> amb l&apos;adreça de retorn <code className="break-all text-[11px]">{s.redirectUris[p]}</code></> : null}.</p>
              ) : c && c.status !== "revocat" ? (
                <>
                  <p className="text-[12px] text-muted">Mode: {MODE_LABEL[c.mode]}{c.last_sync_at ? ` · última sincronització ${new Date(c.last_sync_at).toLocaleString("ca-ES")}` : ""}</p>
                  {c.last_error && <p className="text-[12px] text-amber-700 dark:text-amber-300">{c.last_error}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="input h-8 w-auto py-0 text-[12.5px]" value={mode[p] === "lectura" && c.mode !== "lectura" ? c.mode : mode[p]} onChange={(e) => setMode({ ...mode, [p]: e.target.value })}>{Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    {mode[p] === "bidireccional" && <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={!!confirm[p]} onChange={(e) => setConfirm({ ...confirm, [p]: e.target.checked })} /> Autoritzo la sincronització bidireccional</label>}
                    <Button size="sm" disabled={!!busy || (mode[p] === "bidireccional" && !confirm[p])} onClick={() => void act(`mode-${p}`, async () => { const j = await post("mode", { provider: p, mode: mode[p], confirm: !!confirm[p] }); if (j.reconnect) { const k = await post("connect", { provider: p, mode: mode[p], confirm: !!confirm[p] }); location.href = k.url; } else await load(); })}>Canvia el mode</Button>
                    <Button size="sm" disabled={!!busy} onClick={() => void act(`sync-${p}`, async () => { const j = await post("sync", { provider: p }); const r = j.results?.[0]; useApp.getState().toast({ title: "Sincronització feta", body: r ? `${r.imported} importades · ${r.updated} actualitzades · ${r.pushed} exportades${r.errors.length ? ` · errors: ${r.errors[0]}` : ""}` : undefined, tone: r?.errors?.length ? "err" : "ok" }); await load(); onSynced(); })}>{busy === `sync-${p}` ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sincronitza ara</Button>
                    <Button size="sm" variant="ghost" className="text-lost" disabled={!!busy} onClick={() => void act(`dis-${p}`, async () => { await post("disconnect", { provider: p }); await load(); onSynced(); })}><X size={13} /> Desconnecta</Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input h-8 w-auto py-0 text-[12.5px]" value={mode[p]} onChange={(e) => setMode({ ...mode, [p]: e.target.value })}>{Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  {mode[p] === "bidireccional" && <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={!!confirm[p]} onChange={(e) => setConfirm({ ...confirm, [p]: e.target.checked })} /> Autoritzo la sincronització bidireccional</label>}
                  <Button size="sm" variant="primary" disabled={!!busy || (mode[p] === "bidireccional" && !confirm[p])} onClick={() => void act(`con-${p}`, async () => { const j = await post("connect", { provider: p, mode: mode[p], confirm: !!confirm[p] }); location.href = j.url; })}>Connecta {label}</Button>
                </div>
              )}
            </section>
          );
        })}
        <p className="text-[11.5px] text-muted"><ListTodo size={11} className="mr-1 inline" />Les cites personals s&apos;envien com a privades. Les importades només les veus tu i, per a la resta de l&apos;equip, compten com a «ocupat». Si una cita canvia als dos llocs alhora, es manté la del CRM.</p>
      </div>
    </Modal>
  );
}
