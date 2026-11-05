"use client";
/**
 * Formulari de cita de l'AGENDA (crear i editar). S'obre des de l'Agenda i des de tot el CRM (useComposer).
 * Avisa de coincidències horàries abans de desar i mostra la disponibilitat de les persones triades.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, HelpCircle, Loader2, Lock, Repeat, Search, Users, X } from "lucide-react";
import {
  EVENT_KINDS, KIND_COLOR, KIND_LABEL, PRIORITIES, PRIORITY_LABEL, REMINDER_PRESETS, STATUSES, STATUS_LABEL, availabilityOf, describeRecurrence, localDate, localParts, reminderLabel, zonedToUtc,
  type EventKind, type Recurrence,
} from "@/core/agenda";
import { supabaseConfigured } from "@/data/browserSupabase";
import { useApp } from "@/data/store";
import { Button, Modal, Notice, cn } from "../../components/ui";
import { agendaApi, markSaved, useComposer, type Availability, type Conflict, type Person, type Prefill } from "./api";

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (iso: string) => { const p = localParts(iso); return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` }; };
const fromLocalInput = (date: string, time: string) => { const [y, m, d] = date.split("-").map(Number); const [h, mi] = (time || "00:00").split(":").map(Number); return zonedToUtc(y, m, d, h, mi).toISOString(); };
const WD = ["dl", "dt", "dc", "dj", "dv", "ds", "dg"];

let peopleCache: Promise<Person[]> | null = null;
function usePeople() {
  const [p, setP] = useState<Person[]>([]);
  useEffect(() => {
    if (!supabaseConfigured) return;
    peopleCache ??= agendaApi.list({ from: new Date().toISOString(), to: new Date(Date.now() + 86400000).toISOString(), view: "personal", tasks: "0" }).then((r) => r.people).catch(() => { peopleCache = null; return []; });
    void peopleCache.then(setP);
  }, []);
  return p;
}

export function AgendaComposer() {
  const prefill = useComposer((s) => s.prefill);
  if (!prefill) return null;
  return <EventForm key={JSON.stringify(prefill).slice(0, 200)} prefill={prefill} onClose={() => useComposer.getState().close()} />;
}

function EventForm({ prefill, onClose }: { prefill: Prefill; onClose: () => void }) {
  const me = useApp((s) => s.snap?.me);
  const people = usePeople();
  const canAssign = !!me && ["admin", "cap_administrativa", "cap_equip"].includes(me.role);
  const start0 = prefill.starts_at ?? (() => { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return d.toISOString(); })();
  const end0 = prefill.ends_at ?? new Date(new Date(start0).getTime() + (prefill.kind === "trucada" ? 15 : 60) * 60000).toISOString();
  const s0 = toLocalInput(start0), e0 = toLocalInput(end0);
  const [f, setF] = useState({
    title: prefill.title ?? "", kind: (prefill.kind ?? "cita") as EventKind, scope: prefill.scope ?? "personal",
    date: s0.date, time: s0.time, endDate: e0.date, endTime: e0.time, allDay: !!prefill.all_day, location: prefill.location ?? "",
    priority: prefill.priority ?? "normal", status: prefill.status ?? "programada", owner: prefill.owner_id ?? me?.id ?? "",
    participants: prefill.participants ?? [], description: prefill.description ?? "", reminders: prefill.reminders ?? [15],
    recurrence: (prefill.recurrence ?? null) as Recurrence | null,
  });
  const [client, setClient] = useState(prefill.client ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [custom, setCustom] = useState("");
  const editing = !!prefill.id;
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setConflicts(null); };
  const startIso = f.allDay ? fromLocalInput(f.date, "00:00") : fromLocalInput(f.date, f.time);
  const endIso = f.allDay ? fromLocalInput(f.endDate, "23:59") : fromLocalInput(f.endDate, f.endTime);
  const who = useMemo(() => [...new Set([f.owner, ...f.participants].filter(Boolean))], [f.owner, f.participants]);

  // disponibilitat de les persones triades per a aquest dia (ocupat / lliure / sense informació)
  useEffect(() => {
    if (!supabaseConfigured || !who.length || !f.date) { setAvail(null); return; }
    const t = setTimeout(() => {
      const from = fromLocalInput(f.date, "00:00"), to = new Date(new Date(from).getTime() + 86400000).toISOString();
      const dur = Math.max(15, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
      agendaApi.availability({ users: who, from, to, duration: Math.min(600, dur) }).then(setAvail).catch(() => setAvail(null));
    }, 350);
    return () => clearTimeout(t);
  }, [who, f.date, startIso, endIso]);
  const known = useMemo(() => new Set((avail?.users ?? []).filter((u) => u.known).map((u) => u.id)), [avail]);
  const busyOther = useMemo(() => (avail?.busy ?? []).filter((b) => !prefill.id || (b.eventId ?? "").split("@")[0] !== prefill.id), [avail, prefill.id]);

  const save = async (force = false, mode: "all" | "this" = prefill.mode ?? "all") => {
    if (!f.title.trim()) return setErr("Cal un títol.");
    if (new Date(endIso) < new Date(startIso)) return setErr("L'hora de final no pot ser anterior a la d'inici.");
    setBusy(true); setErr(null);
    try {
      const r = await agendaApi.act<{ ok?: boolean; id?: string; needsConfirm?: boolean; conflicts?: Conflict[] }>("save", {
        id: prefill.id, version: prefill.version ?? undefined, mode, occurrenceStart: prefill.occurrenceStart,
        title: f.title.trim(), kind: f.kind, scope: f.scope, starts_at: startIso, ends_at: endIso, all_day: f.allDay, location: f.location || null,
        priority: f.priority, status: f.status, owner_id: f.owner || undefined, participants: f.participants, description: f.description || null,
        client_id: client?.id ?? null, contract_id: prefill.contract_id ?? null, renewal_id: prefill.renewal_id ?? null, incident_id: prefill.incident_id ?? null, task_id: prefill.task_id ?? null,
        recurrence: f.recurrence, reminders: f.reminders, force,
      });
      if (r.needsConfirm) { setConflicts(r.conflicts ?? []); return; }
      useApp.getState().toast({ title: editing ? "Cita actualitzada" : "Cita creada", body: f.title, tone: "ok" });
      markSaved();
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? (id === me?.id ? me?.name : "—");
  const stateOf = (id: string) => availabilityOf(id, { start: startIso, end: endIso }, busyOther, known);
  const recurring = !!prefill.id && !!prefill.recurrence && !!prefill.occurrenceStart;

  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={<span className="flex items-center gap-2"><CalendarClock size={16} className="text-brand" />{editing ? "Edita la cita" : "Nova cita"}{prefill.context ? <span className="text-[12.5px] font-normal text-muted">· {prefill.context}</span> : null}</span>}
      footer={conflicts ? (
        <div className="flex w-full flex-wrap items-center gap-2" role="alertdialog" aria-label="Coincidència horària">
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-amber-700 dark:text-amber-300"><AlertTriangle size={14} /> Coincidència horària</span>
          <Button variant="ghost" className="ml-auto" onClick={() => setConflicts(null)}>Canvia l&apos;hora</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save(true)}>Desa igualment</Button>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" className="ml-auto" onClick={onClose}>Cancel·la</Button>
          {recurring ? <>
            <Button disabled={busy} onClick={() => void save(false, "this")}>Desa només aquesta</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save(false, "all")}>{busy && <Loader2 size={14} className="animate-spin" />} Desa tota la sèrie</Button>
          </> : <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy && <Loader2 size={14} className="animate-spin" />} {editing ? "Desa els canvis" : "Crea la cita"}</Button>}
        </div>
      )}>
      <div className="space-y-4 text-[13px]">
        {conflicts && (
          <Notice tone="amber">
            <b>Aquesta franja coincideix amb altres activitats:</b>
            <ul className="mt-1 list-disc pl-5">{conflicts.map((c, i) => <li key={i}>{c.name}: {c.title ? `«${c.title}»` : "ocupat (cita privada)"} · {new Date(c.start).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" })}–{new Date(c.end).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" })}</li>)}</ul>
            <span className="mt-1 block">Pots canviar l&apos;hora o desar-la igualment si és intencionat.</span>
          </Notice>
        )}
        {err && <Notice tone="red">{err}</Notice>}
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipus d'activitat">
          {EVENT_KINDS.filter((k) => k !== "tasca").map((k) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => set({ kind: k })}
              className={cn("pressable inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium", f.kind === k ? `${KIND_COLOR[k].bg} ${KIND_COLOR[k].text} border-transparent ring-2 ring-brand/30` : "border-line text-muted hover:text-ink")}>
              <span className={cn("h-2 w-2 rounded-full", KIND_COLOR[k].dot)} />{KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <label className="block"><span className="label">Títol *</span><input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={f.kind === "trucada" ? "Trucar per la renovació" : f.kind === "visita" ? "Visita comercial" : "Títol de la cita"} autoFocus /></label>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block"><span className="label">Inici</span><span className="flex gap-1.5"><input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value, ...(e.target.value > f.endDate ? { endDate: e.target.value } : {}) })} />{!f.allDay && <input className="input w-28" type="time" step={300} value={f.time} onChange={(e) => {
            const dur = new Date(endIso).getTime() - new Date(startIso).getTime();
            const ns = fromLocalInput(f.date, e.target.value); const ne = toLocalInput(new Date(new Date(ns).getTime() + Math.max(dur, 900000)).toISOString());
            set({ time: e.target.value, endDate: ne.date, endTime: ne.time });
          }} />}</span></label>
          <label className="block"><span className="label">Final</span><span className="flex gap-1.5"><input className="input" type="date" value={f.endDate} min={f.date} onChange={(e) => set({ endDate: e.target.value })} />{!f.allDay && <input className="input w-28" type="time" step={300} value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} />}</span></label>
          <label className="mt-6 flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} /> Tot el dia</label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="label">Agenda</span>
            <select className="input" value={f.scope} onChange={(e) => set({ scope: e.target.value as "personal" | "compartida" })}>
              <option value="personal">Personal (privada)</option><option value="compartida">Compartida (equip)</option>
            </select>
          </label>
          <label className="block"><span className="label">Prioritat</span><select className="input" value={f.priority} onChange={(e) => set({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
          <label className="block"><span className="label">Estat</span><select className="input" value={f.status} onChange={(e) => set({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        </div>
        {f.scope === "personal" && <p className="-mt-2 flex items-center gap-1.5 text-[11.5px] text-muted"><Lock size={11} /> La resta de l&apos;equip només veurà que estàs ocupat/da, sense el títol ni els detalls.</p>}

        <section className="space-y-2 rounded-xl border border-line p-3">
          <h4 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted"><Users size={13} /> Persones</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Responsable</span>
              <select className="input" value={f.owner} disabled={!canAssign} onChange={(e) => set({ owner: e.target.value, participants: f.participants.filter((p) => p !== e.target.value) })}>
                {me && <option value={me.id}>{me.name} (jo)</option>}
                {canAssign && people.filter((p) => p.id !== me?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {!canAssign && <span className="mt-1 block text-[11px] text-muted">Per assignar-la a una altra persona, afegeix-la com a participant.</span>}
            </label>
            <label className="block"><span className="label">Afegeix participants</span>
              <select className="input" value="" onChange={(e) => { if (e.target.value) set({ participants: [...new Set([...f.participants, e.target.value])] }); }}>
                <option value="">Tria una persona…</option>
                {people.filter((p) => p.id !== f.owner && !f.participants.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Disponibilitat">
            {who.map((id) => {
              const st = avail ? stateOf(id) : null;
              return (
                <li key={id} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]", st === "ocupat" ? "border-red-500/40 bg-red-500/[0.06]" : st === "disponible" ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-line")}>
                  {st === "ocupat" ? <AlertTriangle size={12} className="text-red-600" /> : st === "disponible" ? <CheckCircle2 size={12} className="text-emerald-600" /> : <HelpCircle size={12} className="text-muted" />}
                  {nameOf(id)}<span className="text-muted">· {st === "ocupat" ? "ocupat/da" : st === "disponible" ? "disponible" : st === "sense_informacio" ? "sense informació" : "…"}</span>
                  {id !== f.owner && <button type="button" aria-label={`Treu ${nameOf(id)}`} onClick={() => set({ participants: f.participants.filter((p) => p !== id) })} className="text-muted hover:text-ink"><X size={11} /></button>}
                </li>
              );
            })}
          </ul>
          {avail && avail.suggestions.length > 0 && who.some((id) => stateOf(id) === "ocupat") && (
            <div className="text-[12px]"><span className="text-muted">Franges lliures per a tothom:</span>
              <span className="ml-1 inline-flex flex-wrap gap-1">{avail.suggestions.map((s) => { const a = toLocalInput(s.start), b = toLocalInput(s.end); return (
                <button key={s.start} type="button" onClick={() => set({ date: a.date, time: a.time, endDate: b.date, endTime: b.time })} className="rounded-md border border-line px-2 py-0.5 hover:border-brand hover:text-brand" title={s.uncertain.length ? "Algú no té informació d'agenda: confirma-ho" : undefined}>
                  {a.date === f.date ? "" : `${a.date.slice(8)}/${a.date.slice(5, 7)} `}{a.time}–{b.time}{s.uncertain.length ? " ?" : ""}
                </button>); })}</span>
            </div>
          )}
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <ClientPicker value={client} onChange={setClient} />
          <label className="block"><span className="label">Lloc</span><input className="input" value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="Adreça, videotrucada…" /></label>
        </div>
        {(prefill.renewal_id || prefill.contract_id || prefill.incident_id || prefill.task_id) && (
          <p className="text-[11.5px] text-muted">Vinculada a: {[prefill.renewal_id && "contracte de renovació", prefill.contract_id && "contracte", prefill.incident_id && "incidència", prefill.task_id && "tasca"].filter(Boolean).join(", ")}.</p>
        )}

        <section className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted"><Repeat size={13} /> Repetició</h4>
            <select className="input" value={f.recurrence?.freq ?? ""} disabled={recurring && false} onChange={(e) => set({ recurrence: e.target.value ? { freq: e.target.value as Recurrence["freq"], interval: 1, byweekday: e.target.value === "weekly" ? [localParts(startIso).wd] : undefined } : null })}>
              <option value="">No es repeteix</option><option value="daily">Cada dia</option><option value="weekly">Cada setmana</option><option value="monthly">Cada mes</option><option value="yearly">Cada any</option>
            </select>
            {f.recurrence && <div className="mt-2 space-y-2">
              {f.recurrence.freq === "weekly" && <div className="flex gap-1">{WD.map((w, i) => { const on = f.recurrence!.byweekday?.includes(i + 1); return <button key={w} type="button" aria-pressed={on} onClick={() => set({ recurrence: { ...f.recurrence!, byweekday: on ? (f.recurrence!.byweekday ?? []).filter((x) => x !== i + 1) : [...(f.recurrence!.byweekday ?? []), i + 1] } })} className={cn("h-7 w-8 rounded-md border text-[11.5px]", on ? "border-brand bg-brand/10 text-brand" : "border-line text-muted")}>{w}</button>; })}</div>}
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span>Cada</span><input className="input h-8 w-16" type="number" min={1} max={52} value={f.recurrence.interval ?? 1} onChange={(e) => set({ recurrence: { ...f.recurrence!, interval: Math.max(1, Number(e.target.value) || 1) } })} />
                <span>· fins al</span><input className="input h-8 w-40" type="date" value={f.recurrence.until ?? ""} min={f.date} onChange={(e) => set({ recurrence: { ...f.recurrence!, until: e.target.value || null, count: null } })} />
              </div>
              <p className="text-[11.5px] text-muted">{describeRecurrence(f.recurrence)}</p>
            </div>}
          </div>
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted"><Clock size={13} /> Recordatoris</h4>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_PRESETS.map((p) => { const on = f.reminders.includes(p.min); return <button key={p.min} type="button" aria-pressed={on} onClick={() => set({ reminders: on ? f.reminders.filter((x) => x !== p.min) : [...f.reminders, p.min].slice(0, 5) })} className={cn("rounded-full border px-2.5 py-1 text-[12px]", on ? "border-brand bg-brand/10 text-brand" : "border-line text-muted")}>{p.label}</button>; })}
              {f.reminders.filter((m) => !REMINDER_PRESETS.some((p) => p.min === m)).map((m) => <button key={m} type="button" onClick={() => set({ reminders: f.reminders.filter((x) => x !== m) })} className="rounded-full border border-brand bg-brand/10 px-2.5 py-1 text-[12px] text-brand">{reminderLabel(m)} ×</button>)}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[12px]">
              <input className="input h-8 w-20" inputMode="numeric" placeholder="min" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} aria-label="Antelació personalitzada en minuts" />
              <Button size="sm" type="button" disabled={!custom || Number(custom) > 10080} onClick={() => { set({ reminders: [...new Set([...f.reminders, Number(custom)])].slice(0, 5) }); setCustom(""); }}>Afegeix</Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">Avís dins del CRM. Correu i WhatsApp: disponibles quan estiguin configurats el correu SMTP i WhatsApp Cloud.</p>
          </div>
        </section>
        <label className="block"><span className="label">Notes</span><textarea className="input min-h-[70px]" value={f.description} onChange={(e) => set({ description: e.target.value })} /></label>
      </div>
    </Modal>
  );
}

/** Cerca de clients (només els que l'usuari pot veure, per la RLS del cercador). */
function ClientPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2 || !supabaseConfigured) { setHits([]); return; }
    const t = setTimeout(() => fetch(`/api/crm/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { results: [] })).then((j: { results: { kind: string; id: string; title: string }[] }) => setHits(j.results.filter((x) => x.kind === "client").slice(0, 6))).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <label className="relative block"><span className="label">Client</span>
      {value ? (
        <span className="flex h-9 items-center gap-2 rounded-lg border border-line px-2.5"><span className="min-w-0 flex-1 truncate">{value.name}</span><button type="button" aria-label="Treu el client" onClick={() => onChange(null)} className="text-muted hover:text-ink"><X size={13} /></button></span>
      ) : (
        <span className="relative block"><Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca un client…" /></span>
      )}
      {hits.length > 0 && !value && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-line bg-surface p-1 shadow-lift">
          {hits.map((h) => <li key={h.id}><button type="button" className="w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-ink/[0.05]" onClick={() => { onChange({ id: h.id, name: h.title }); setQ(""); setHits([]); }}>{h.title}</button></li>)}
        </ul>
      )}
    </label>
  );
}

/** Data local d'avui (Madrid). */
export const todayLocal = () => localDate(new Date());
