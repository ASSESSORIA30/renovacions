"use client";
/** LA MEVA JORNADA: el que cada comercial ha de fer avui, i el calendari (dia, setmana, mes). */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle, FileSignature, Handshake, Loader2, Phone, Plus, RefreshCw, Send, Sparkles, Target, Users } from "lucide-react";
import { TASK_KIND_LABEL } from "@/core/sales";
import { daysUntil, fmtDate } from "@/core/dates";
import { expiry } from "@/core/insights";
import { formatPhone } from "@/core/crm";
import { useApp, type View } from "@/data/store";
import { isStaff } from "@/core/roles";
import { titleCase } from "@/core/templates";
import { supabaseConfigured } from "@/data/browserSupabase";
import { Button, Empty, Notice, cn } from "../../components/ui";
import { crmApi } from "../crm/api";
import { salesApi, eur, type AgendaEvent, type Jornada } from "./api";
import { ServiceChip, StagePill, TaskForm } from "./shared";

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
const nav = (l: { view: string; params: Record<string, string> }) => useApp.getState().navigate(l.view as View, l.params);

export function JornadaView() {
  const me = useApp((s) => s.snap!.me);
  const contracts = useApp((s) => s.contracts);
  const [d, setD] = useState<Jornada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState(false);
  const load = useCallback(async () => { try { setD(await salesApi.jornada()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { if (supabaseConfigured) void load(); }, [load]);
  const done = async (id: string) => { await crmApi.action({ entity: "task", action: "complete", id }); void load(); };

  // Renovacions del mòdul existent (Excel): les que veu el comercial i vencen en 30 dies o menys.
  const legacy = useMemo(() => isStaff(me.role) ? [] : contracts.filter((c) => (c.crm.status === "pendiente" || c.crm.status === "contactado") && (daysUntil(expiry(c)) ?? 999) <= 30 && (daysUntil(expiry(c)) ?? -1) >= 0).sort((a, b) => (expiry(a) ?? "").localeCompare(expiry(b) ?? "")).slice(0, 8), [contracts, me.role]);
  const hour = new Date().getHours();
  const hi = hour < 13 ? "Bon dia" : hour < 20 ? "Bona tarda" : "Bona nit";

  if (!supabaseConfigured) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<CalendarDays size={26} />} title="La jornada necessita la base de dades" /></div>;
  const counts = d ? [
    { label: "Tasques vençudes", n: d.overdue.length, tone: d.overdue.length ? "text-lost" : "" },
    { label: "Trucades", n: d.calls.length, tone: "" },
    { label: "Reunions", n: d.meetings.length, tone: "" },
    { label: "Propostes per seguir", n: d.proposals.length, tone: "" },
    { label: "Renovacions (30 dies)", n: d.renewals.length + legacy.length, tone: d.renewals.length + legacy.length ? "text-pend" : "" },
  ] : [];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{hi}, {me.name.split(" ")[0]}</h2>
          <p className="text-[13px] text-muted">{new Date().toLocaleDateString("ca-ES", { weekday: "long", day: "numeric", month: "long" })} · la teva jornada comercial</p>
        </div>
        <div className="flex gap-2"><Button onClick={() => load()}><RefreshCw size={14} /> Actualitza</Button><Button variant="primary" onClick={() => setTask(true)}><Plus size={15} /> Tasca</Button></div>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      {!d && !error ? <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-elevated" />)}</div> : d && (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
            {counts.map((c) => <div key={c.label} className="rounded-2xl border border-line bg-surface p-3.5"><p className="text-[12px] text-muted">{c.label}</p><p className={cn("text-2xl font-semibold tnum", c.tone)}>{c.n}</p></div>)}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Block title="Tasques vençudes" icon={<AlarmClock size={16} className="text-lost" />} empty="Cap tasca vençuda. Bona feina!">
              {d.overdue.map((t) => <TaskRow key={t.id} t={t} onDone={done} />)}
            </Block>
            <Block title="Trucades i seguiments" icon={<Phone size={16} className="text-brand" />} empty="No tens trucades programades per als propers 7 dies.">
              {d.tasks.filter((t) => t.kind !== "reunio" && !d.overdue.includes(t)).slice(0, 10).map((t) => <TaskRow key={t.id} t={t} onDone={done} />)}
            </Block>
            <Block title="Reunions" icon={<Handshake size={16} className="text-violet-500" />} empty="Cap reunió a l'agenda.">
              {d.meetings.map((t) => <TaskRow key={t.id} t={t} onDone={done} />)}
            </Block>
            <Block title="Propostes per seguir" icon={<Send size={16} className="text-amber-500" />} empty="No tens propostes pendents de resposta.">
              {d.proposals.map((o) => (
                <button key={o.id} onClick={() => nav({ view: "oportunitat", params: { id: o.id } })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.04]">
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{o.party_name}</p><p className="flex items-center gap-1.5 text-[11px] text-muted"><ServiceChip s={o.service} short /> {eur(o.commission_eur)}{o.proposal_sent_at ? ` · enviada ${fmtDate(o.proposal_sent_at.slice(0, 10))}` : ""}</p></div>
                  <StagePill s={o.stage} />
                </button>
              ))}
            </Block>
            <Block title="Per contactar" icon={<Users size={16} className="text-sky-500" />} empty="Cap lead ni client pendent de contactar.">
              {d.leads.map((l) => (
                <button key={l.id} onClick={() => nav({ view: "leads", params: { id: l.id } })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.04]">
                  <Target size={14} className="shrink-0 text-muted" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{l.company || l.name}</p><p className="text-[11px] text-muted">Lead · {l.status === "nou" ? "sense primer contacte" : "contactat"} · {formatPhone(l.phone) || l.email}</p></div>
                </button>
              ))}
              {d.clients.map((c) => (
                <button key={c.id} onClick={() => nav({ view: "client", params: { id: c.id, tab: "activitat" } })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.04]">
                  <Users size={14} className="shrink-0 text-muted" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{c.name}</p><p className={cn("text-[11px]", c.next_follow_up < new Date().toISOString().slice(0, 10) ? "text-lost" : "text-muted")}>Client · seguiment {fmtDate(c.next_follow_up)}</p></div>
                </button>
              ))}
            </Block>
            <Block title="Renovacions urgents" icon={<FileSignature size={16} className="text-pend" />} empty="Cap contracte venç en els propers 30 dies.">
              {d.renewals.map((k) => (
                <button key={k.id} onClick={() => nav({ view: "client", params: { id: k.client_id, tab: "contractes" } })} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.04]">
                  <span className="min-w-0"><span className="block truncate font-medium">{k.client_name}</span><span className="text-[11px] text-muted">{k.retailer}{k.product ? ` · ${k.product}` : ""}</span></span>
                  <span className="shrink-0 text-[12px] font-medium text-pend">{daysUntil(k.end_date)} d</span>
                </button>
              ))}
              {legacy.map((c) => (
                <button key={c.id} onClick={() => { useApp.getState().navigate("kanban"); useApp.getState().open(c.id); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.04]">
                  <span className="min-w-0"><span className="block truncate font-medium">{titleCase(c.cliente)}</span><span className="text-[11px] text-muted">Renovacions · {c.comercializadora}</span></span>
                  <span className="shrink-0 text-[12px] font-medium text-pend">{daysUntil(expiry(c))} d</span>
                </button>
              ))}
            </Block>
          </div>
          {d.newOpps.length > 0 && (
            <section className="rounded-2xl border border-brand/30 bg-brand/[0.03] p-4">
              <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><Sparkles size={16} className="text-brand" /> Noves oportunitats assignades</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {d.newOpps.slice(0, 9).map((o) => (
                  <button key={o.id} onClick={() => nav({ view: "oportunitat", params: { id: o.id } })} className="rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-ink/25">
                    <p className="truncate font-medium">{o.party_name}</p>
                    <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><ServiceChip s={o.service} short /> {o.next_action ?? "Fes el primer contacte"}</p>
                  </button>
                ))}
              </div>
            </section>
          )}
          <Calendar />
        </>
      )}
      {task && <TaskForm link={{}} defaultKind="trucada" onClose={() => setTask(false)} onSaved={() => { setTask(false); void load(); }} />}
    </div>
  );
}

function Block({ title, icon, empty, children }: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
      <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">{icon} {title}</h3>
      {items.length ? <div className="max-h-72 space-y-0.5 overflow-y-auto">{children}</div> : <p className="py-3 text-muted">{empty}</p>}
    </section>
  );
}

function TaskRow({ t, onDone }: { t: Jornada["tasks"][number]; onDone: (id: string) => void }) {
  const late = t.due_at && t.due_at < new Date().toISOString();
  const link: { view: string; params: Record<string, string> } | null = t.opportunity_id ? { view: "oportunitat", params: { id: t.opportunity_id } } : t.client_id ? { view: "client", params: { id: t.client_id, tab: "activitat" } } : t.lead_id ? { view: "leads", params: { id: t.lead_id } } : null;
  return (
    <div className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-ink/[0.03]">
      <button aria-label={`Marca «${t.title}» com a feta`} onClick={() => onDone(t.id)} className="mt-0.5 text-muted hover:text-ren"><Circle size={15} /></button>
      <button className="min-w-0 flex-1 text-left" onClick={() => link && nav(link)} disabled={!link}>
        <p className="truncate font-medium">{t.title}</p>
        <p className={cn("text-[11px]", late ? "font-medium text-lost" : "text-muted")}>{TASK_KIND_LABEL[t.kind as keyof typeof TASK_KIND_LABEL] ?? t.kind} · {t.due_at ? `${new Date(t.due_at).toLocaleDateString("ca-ES", { day: "numeric", month: "short" })} ${hhmm(t.due_at)}` : "sense data"}{t.source === "automatica" ? " · automàtica" : ""}</p>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ calendari */

type Mode = "dia" | "setmana" | "mes";
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const KIND_COLOR: Record<AgendaEvent["kind"], string> = { tasca: "#0ea5e9", oportunitat: "#f59e0b", venciment: "#dc2626" };

export function Calendar() {
  const [mode, setMode] = useState<Mode>("setmana");
  const [ref, setRef] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState<AgendaEvent[] | null>(null);
  const range = useMemo(() => {
    if (mode === "dia") return { from: ref, to: addDays(ref, 1) };
    if (mode === "setmana") { const s = startOfWeek(ref); return { from: s, to: addDays(s, 7) }; }
    const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const s = startOfWeek(first);
    return { from: s, to: addDays(s, 42) };
  }, [mode, ref]);
  useEffect(() => { setEvents(null); salesApi.agenda(range.from.toISOString(), range.to.toISOString()).then((r) => setEvents(r.events)).catch(() => setEvents([])); }, [range]);
  const step = (n: number) => setRef(mode === "dia" ? addDays(ref, n) : mode === "setmana" ? addDays(ref, 7 * n) : new Date(ref.getFullYear(), ref.getMonth() + n, 1));
  const days = Array.from({ length: Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) }, (_, i) => addDays(range.from, i));
  const of = (d: Date) => (events ?? []).filter((e) => (e.allDay ? sameDay(new Date(e.at.slice(0, 10) + "T12:00:00"), d) : sameDay(new Date(e.at), d)));
  const today = startOfDay(new Date());
  const title = mode === "mes" ? ref.toLocaleDateString("ca-ES", { month: "long", year: "numeric" }) : mode === "setmana" ? `${range.from.toLocaleDateString("ca-ES", { day: "numeric", month: "short" })} – ${addDays(range.to, -1).toLocaleDateString("ca-ES", { day: "numeric", month: "short", year: "numeric" })}` : ref.toLocaleDateString("ca-ES", { weekday: "long", day: "numeric", month: "long" });

  const Ev = ({ e, compact }: { e: AgendaEvent; compact?: boolean }) => (
    <button onClick={() => nav(e.link)} title={e.title} className={cn("flex w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-left text-[11px] hover:brightness-95", e.done && "line-through opacity-60")} style={{ background: `${KIND_COLOR[e.kind]}1a`, color: KIND_COLOR[e.kind] }}>
      {!e.allDay && !compact && <span className="shrink-0 font-semibold tnum">{hhmm(e.at)}</span>}<span className="truncate">{e.title}</span>
    </button>
  );
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold"><CalendarClock size={16} className="text-brand" /> Agenda</h3>
        <div className="ml-2 flex items-center gap-1"><Button size="sm" variant="ghost" aria-label="Anterior" onClick={() => step(-1)}><ChevronLeft size={15} /></Button><Button size="sm" onClick={() => setRef(today)}>Avui</Button><Button size="sm" variant="ghost" aria-label="Següent" onClick={() => step(1)}><ChevronRight size={15} /></Button></div>
        <span className="text-[13px] inline-block font-medium first-letter:uppercase">{title}</span>
        {!events && <Loader2 size={14} className="animate-spin text-muted" />}
        <div className="ml-auto flex rounded-xl border border-line p-0.5 text-[12px]">{(["dia", "setmana", "mes"] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("rounded-lg px-2.5 py-1 capitalize", mode === m ? "bg-ink/[0.07] font-medium" : "text-muted")}>{m}</button>)}</div>
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-muted">{(Object.keys(KIND_COLOR) as AgendaEvent["kind"][]).map((k) => <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{k === "tasca" ? "Tasques i reunions" : k === "oportunitat" ? "Pròximes accions" : "Venciments"}</span>)}</div>
      {mode === "dia" ? (
        <div className="divide-y divide-line rounded-xl border border-line">
          {of(ref).length === 0 ? <p className="px-3 py-6 text-center text-[12.5px] text-muted">Res a l&apos;agenda aquest dia.</p> : of(ref).map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]"><span className="w-12 shrink-0 font-semibold tnum text-muted">{e.allDay ? "Tot el dia" : hhmm(e.at)}</span><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] }} /><button className={cn("flex-1 truncate text-left hover:underline", e.done && "text-muted line-through")} onClick={() => nav(e.link)}>{e.title}</button>{e.done ? <CheckCircle2 size={14} className="text-ren" /> : null}</div>
          ))}
        </div>
      ) : (
        <div className={cn("grid gap-px overflow-hidden rounded-xl border border-line bg-line", "grid-cols-7")}>
          {["dl", "dt", "dc", "dj", "dv", "ds", "dg"].map((w) => <div key={w} className="bg-elevated px-2 py-1 text-center text-[11px] font-medium uppercase text-muted">{w}</div>)}
          {days.map((d) => {
            const list = of(d);
            const out = mode === "mes" && d.getMonth() !== ref.getMonth();
            return (
              <div key={d.toISOString()} className={cn("min-h-[92px] bg-surface p-1.5", mode === "setmana" && "min-h-[180px]", out && "bg-elevated/40")}>
                <button onClick={() => { setRef(d); setMode("dia"); }} className={cn("mb-1 grid h-6 w-6 place-items-center rounded-full text-[11.5px] tnum", sameDay(d, today) ? "bg-brand font-semibold text-white" : out ? "text-muted/60" : "text-muted hover:bg-ink/[0.06]")}>{d.getDate()}</button>
                <div className="space-y-0.5">
                  {list.slice(0, mode === "mes" ? 3 : 8).map((e) => <Ev key={e.id} e={e} compact={mode === "mes"} />)}
                  {list.length > (mode === "mes" ? 3 : 8) && <button className="px-1.5 text-[10.5px] text-muted hover:text-ink" onClick={() => { setRef(d); setMode("dia"); }}>+{list.length - (mode === "mes" ? 3 : 8)} més</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
