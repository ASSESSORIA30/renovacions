"use client";
/**
 * Panells per rol (Fase 7): Supervisió administrativa (Cap administrativa), La meva jornada (administrativa) i
 * Panell comercial. Cada panell només mostra el que la persona pot veure (RLS al servidor). Sense dades inventades.
 */
import { AgendaSummaryCard } from "../agenda/Summary";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, CalendarCheck, CheckCircle2, ClipboardCheck, FileStack, Phone, RefreshCw, Sunrise, Target, UserPlus } from "lucide-react";
import { useApp, type View } from "@/data/store";
import { Button, Notice, cn } from "../../components/ui";
import { Avatar } from "../sales/shared";
import { EXP_STATUS_LABEL, INC_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE, Panel, PageHead, Pill, Skeleton, Stat, TASK_STATUS_LABEL, TASK_STATUS_TONE, api, eur, fdate, fdt, isOverdue, num, one } from "./shared";
import { TaskQuickCreate } from "./Tasks";

function useData<T>(r: string) {
  const [d, setD] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setD(await api.control<T>(r)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }, [r]);
  useEffect(() => { void load(); }, [load]);
  return { d, err, busy, load };
}

type TaskRow = { id: string; title: string; status: string; priority?: string | null; due_at: string | null; kind?: string | null; assignee?: string | null; assigned_to?: string | null; client_id?: string | null; crm_clients?: { name: string } | { name: string }[] | null; blocked_reason?: string | null };
function TaskList({ rows, go, empty, showAssignee }: { rows: TaskRow[]; go: (v: View, p?: Record<string, string>) => void; empty: string; showAssignee?: boolean }) {
  if (!rows.length) return <p className="py-5 text-center text-[12.5px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((t) => (
        <li key={t.id}>
          <button onClick={() => go("tasques", { id: t.id })} className="flex w-full items-center gap-2 py-2 text-left hover:text-brand">
            {showAssignee && <Avatar name={t.assignee} size={22} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium">{t.title}</p>
              <p className="truncate text-[11.5px] text-muted">{one(t.crm_clients)?.name ?? ""}{t.blocked_reason ? ` · ${t.blocked_reason}` : ""}</p>
            </div>
            {t.priority && t.priority !== "normal" && <Pill className={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill>}
            {t.status !== "pendent" && <Pill className={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Pill>}
            <span className={cn("w-16 shrink-0 text-right text-[11.5px] tnum", isOverdue(t.due_at, t.status) ? "font-semibold text-red-600" : "text-muted")}>{fdate(t.due_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
type Exp = { id: string; code: string | null; status: string; retailer: string | null; owner: string | null; since: string };
function ExpList({ rows, go, empty }: { rows: Exp[]; go: (v: View, p?: Record<string, string>) => void; empty: string }) {
  if (!rows.length) return <p className="py-5 text-center text-[12.5px] text-muted">{empty}</p>;
  return <ul className="divide-y divide-line">{rows.map((e) => <li key={e.id}><button onClick={() => go("expedient", { id: e.id })} className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] hover:text-brand"><span className="font-mono text-[11.5px]">{e.code ?? "—"}</span><span className="min-w-0 flex-1 truncate text-muted">{e.retailer} · {EXP_STATUS_LABEL[e.status] ?? e.status}{e.owner ? ` · ${e.owner}` : " · sense responsable"}</span><span className="text-[11.5px] text-muted tnum">{fdate(e.since)}</span></button></li>)}</ul>;
}

/* ======================================================================= SUPERVISIÓ ADMINISTRATIVA (Cap administrativa) */

type Cap = {
  kpis: Record<string, number>; team: { id: string; name: string; role: string; open: number; overdue: number; blocked: number; doneWeek: number; expedients: number; load: number }[]; assignees: { id: string; name: string }[];
  overdue: TaskRow[]; unassigned: TaskRow[]; review: Exp[]; incomplete: Exp[]; blocked: Exp[];
  renewals: { id: string; client_id: string; retailer: string; end_date: string; owner: string | null }[];
  incidents: { id: string; title: string; status: string; priority: string; opened_at: string; assigned_name: string | null }[];
  recent: { id: number; at: string; user_name: string; type: string; to_value: string | null; crm_tasks: { title: string } | { title: string }[] | null }[]; economicAccess: boolean;
};
export function CapPanelView() {
  const go = useApp((s) => s.navigate);
  const { d, err, busy, load } = useData<Cap>("cap");
  const [assign, setAssign] = useState(false);
  if (err) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="red">{err}</Notice><div className="mt-4"><AgendaSummaryCard /></div></div>;
  const k = d?.kpis;
  const maxLoad = Math.max(1, ...(d?.team ?? []).map((t) => t.load));
  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<ClipboardCheck size={16} />} title="Supervisió administrativa" sub="Coordinació del departament: contractes, tramitacions, renovacions, documentació, incidències i càrrega de cada persona." tone="from-sky-600 to-cyan-500">
        <Button size="sm" variant="primary" onClick={() => setAssign(true)}><UserPlus size={13} /> Assigna una tasca</Button>
        <Button size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={13} className={cn(busy && "animate-spin")} /> Actualitza</Button>
      </PageHead>
      <AgendaSummaryCard />
      {!d || !k ? <Skeleton /> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Contractes introduïts avui" value={num(k.contractes_introduits_avui)} />
            <Stat label="Pendents de revisar" value={num(k.pendents_revisar)} tone={k.pendents_revisar ? "amber" : undefined} />
            <Stat label="Expedients incomplets" value={num(k.expedients_incomplets)} tone={k.expedients_incomplets ? "amber" : undefined} onClick={() => go("tramitacions")} />
            <Stat label="Contractes bloquejats" value={num(k.contractes_bloquejats)} tone={k.contractes_bloquejats ? "red" : undefined} hint="Expedients en incidència o sense moviment des de fa més de 7 dies" />
            <Stat label="Tasques pendents" value={num(k.tasques_admin_obertes)} onClick={() => go("tasques", { scope: "equip" })} />
            <Stat label="Tasques vençudes" value={num(k.tasques_admin_vencudes)} tone={k.tasques_admin_vencudes ? "red" : "green"} onClick={() => go("tasques", { scope: "equip", status: "vencudes" })} />
            <Stat label="Renovacions urgents (30 dies)" value={num(k.renovacions_urgents)} tone={k.renovacions_urgents ? "amber" : undefined} onClick={() => go("kanban")} />
            <Stat label="Incidències obertes" value={num(k.incidencies_obertes)} onClick={() => go("incidencies")} />
            <Stat label="Incidències urgents" value={num(k.incidencies_urgents)} tone={k.incidencies_urgents ? "red" : undefined} onClick={() => go("incidencies", { priority: "urgent" })} />
            <Stat label="En tramitació" value={num(k.tramitacio)} onClick={() => go("tramitacions")} />
            <Stat label="Renovacions (120 dies)" value={num(k.renovacions_120)} />
            <Stat label="Tasques bloquejades" value={num(k.tasques_bloquejades)} tone={k.tasques_bloquejades ? "red" : undefined} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Treball i càrrega de cada persona" className="lg:col-span-2" empty={!d.team.length && "Encara no hi ha cap persona amb rol d'administració. Direcció la pot afegir des d'Usuaris i permisos."}>
              <div className="space-y-2.5">
                {d.team.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <Avatar name={p.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between text-[12.5px]"><button className="font-medium hover:text-brand" onClick={() => go("tasques", { scope: "equip", assignee: p.id })}>{p.name}</button><span className="text-muted tnum">{p.open} tasques · {p.expedients} expedients · {p.doneWeek} fetes aquesta setmana</span></div>
                      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-ink/[0.06]"><div className="bg-red-500" style={{ width: `${(p.overdue / maxLoad) * 100}%` }} /><div className="bg-amber-500" style={{ width: `${(p.blocked / maxLoad) * 100}%` }} /><div className="bg-brand" style={{ width: `${((p.load - p.overdue - p.blocked) / maxLoad) * 100}%` }} /></div>
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-500" />vençudes <span className="mx-2 inline-block h-2 w-2 rounded-full bg-amber-500" />bloquejades <span className="mx-2 inline-block h-2 w-2 rounded-full bg-brand" />resta de càrrega</p>
              </div>
            </Panel>
            <Panel title="Activitat recent de l'equip" empty={!d.recent.length && "Encara no hi ha activitat registrada"}>
              <ul className="space-y-1.5">{d.recent.map((r) => <li key={r.id} className="text-[12px]"><b>{r.user_name}</b> <span className="text-muted">{r.type === "estat" ? `→ ${TASK_STATUS_LABEL[r.to_value ?? ""] ?? r.to_value}` : r.type}</span> · {one(r.crm_tasks)?.title}<span className="block text-[11px] text-muted">{fdt(r.at)}</span></li>)}</ul>
            </Panel>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title={<span className="flex items-center gap-1.5"><AlertTriangle size={14} className="text-red-500" /> Tasques vençudes</span>} action={<button className="text-[12px] text-brand" onClick={() => go("tasques", { scope: "equip", status: "vencudes" })}>Totes</button>}><TaskList rows={d.overdue} go={go} empty="Cap tasca vençuda" showAssignee /></Panel>
            <Panel title="Contractes bloquejats"><ExpList rows={d.blocked} go={go} empty="Cap expedient bloquejat" /></Panel>
            <Panel title="Pendents de revisar"><ExpList rows={d.review} go={go} empty="Res pendent de revisió" /></Panel>
            <Panel title="Expedients incomplets"><ExpList rows={d.incomplete} go={go} empty="Cap expedient amb documentació pendent" /></Panel>
            <Panel title="Renovacions urgents" empty={!d.renewals.length && "Cap renovació en els propers 30 dies"}><ul className="divide-y divide-line">{d.renewals.map((r) => <li key={r.id}><button onClick={() => go("client", { id: r.client_id, tab: "contractes" })} className="flex w-full justify-between py-2 text-[12.5px] hover:text-brand"><span>{r.retailer}{r.owner ? <span className="text-muted"> · {r.owner}</span> : null}</span><span className="text-muted tnum">{fdate(r.end_date)}</span></button></li>)}</ul></Panel>
            <Panel title="Incidències" action={<button className="text-[12px] text-brand" onClick={() => go("incidencies")}>Gestor</button>} empty={!d.incidents.length && "Cap incidència oberta"}><ul className="divide-y divide-line">{d.incidents.map((i) => <li key={i.id}><button onClick={() => go("incidencies", { id: i.id })} className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] hover:text-brand"><span className="min-w-0 flex-1 truncate">{i.title}</span><Pill className={PRIORITY_TONE[i.priority]}>{PRIORITY_LABEL[i.priority]}</Pill><span className="text-[11.5px] text-muted">{INC_STATUS_LABEL[i.status]}</span></button></li>)}</ul></Panel>
          </div>
          {d.unassigned.length > 0 && <Panel title="Tasques sense responsable"><TaskList rows={d.unassigned} go={go} empty="" /></Panel>}
          {!d.economicAccess && <p className="text-[11.5px] text-muted">Les comissions i liquidacions no es mostren en aquest panell: Direcció les pot autoritzar a Usuaris i permisos.</p>}
        </>
      )}
      <TaskQuickCreate open={assign} onClose={() => setAssign(false)} onDone={() => void load()} people={d?.assignees ?? []} area="administrativa" />
    </div>
  );
}

/* ======================================================================= LA MEVA JORNADA (administrativa) */

type Day = { today: TaskRow[]; overdue: TaskRow[]; pending: TaskRow[]; done: { id: string; title: string; completed_at: string }[]; expedients: { id: string; code: string; status: string; retailer: string; next_action: string | null; next_action_at: string | null; crm_clients: { name: string } | null }[]; toProcess: number; renewals: { id: string; client_id: string; retailer: string; end_date: string; crm_clients: { name: string } | null }[]; incidents: { id: string; title: string; status: string; priority: string; crm_clients: { name: string } | null }[]; alerts: { id: string; title: string; body: string | null; link: { view: View; params: Record<string, string> } | null }[]; recent: { id: number; at: string; type: string; to_value: string | null; crm_tasks: { title: string } | null }[] };
export function MyDayView() {
  const go = useApp((s) => s.navigate);
  const me = useApp((s) => s.snap?.me);
  const { d, err, busy, load } = useData<Day>("jornada");
  const [create, setCreate] = useState(false);
  const done = async (id: string) => { await api.workAct("task_update", { id, data: { status: "feta" } }); void load(); };
  if (err) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="red">{err}</Notice><div className="mt-4"><AgendaSummaryCard /></div></div>;
  const hour = new Date().getHours();
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<Sunrise size={16} />} title="La meva jornada" sub={`${hour < 14 ? "Bon dia" : "Bona tarda"}${me ? `, ${me.name.split(" ")[0]}` : ""}. La teva feina d'avui, ordenada per urgència.`} tone="from-amber-500 to-orange-500">
        <Button size="sm" variant="primary" onClick={() => setCreate(true)}><CalendarCheck size={13} /> Nova tasca</Button>
        <Button size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={13} className={cn(busy && "animate-spin")} /></Button>
      </PageHead>
      <AgendaSummaryCard />
      {!d ? <Skeleton /> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Tasques d'avui" value={d.today.length} />
            <Stat label="Vençudes" value={d.overdue.length} tone={d.overdue.length ? "red" : "green"} />
            <Stat label="Pendents" value={d.pending.length} />
            <Stat label="Contractes per tramitar" value={d.toProcess} tone={d.toProcess ? "amber" : undefined} onClick={() => go("tramitacions")} />
            <Stat label="Incidències assignades" value={d.incidents.length} onClick={() => go("incidencies", { mine: "1" })} />
            <Stat label="Fetes avui" value={d.done.length} tone="green" />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Ara mateix" className="lg:col-span-2">
              {[...d.overdue, ...d.today].length === 0 ? <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-muted"><CheckCircle2 size={16} className="text-emerald-500" /> No tens res vençut ni per a avui.</p> : (
                <ul className="divide-y divide-line">
                  {[...d.overdue, ...d.today].map((t) => (
                    <li key={t.id} className="flex items-center gap-2 py-2">
                      <button aria-label="Marca com a feta" onClick={() => void done(t.id)} className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line hover:border-emerald-500 hover:bg-emerald-500/10" />
                      <button onClick={() => go("tasques", { id: t.id })} className="min-w-0 flex-1 text-left"><p className="truncate text-[13px] font-medium">{t.title}</p><p className="truncate text-[11.5px] text-muted">{one(t.crm_clients)?.name ?? ""}</p></button>
                      {t.priority && t.priority !== "normal" && <Pill className={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill>}
                      <span className={cn("text-[11.5px] tnum", isOverdue(t.due_at, t.status) ? "font-semibold text-red-600" : "text-muted")}>{fdate(t.due_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Alertes" empty={!d.alerts.length && "Cap alerta nova"}><ul className="space-y-1">{d.alerts.map((a) => <li key={a.id}><button className="w-full rounded-lg px-1 py-1 text-left hover:bg-ink/[0.04]" onClick={() => a.link && go(a.link.view, a.link.params)}><p className="truncate text-[12.5px] font-medium">{a.title}</p>{a.body && <p className="truncate text-[11.5px] text-muted">{a.body}</p>}</button></li>)}</ul></Panel>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Els meus expedients" action={<button className="text-[12px] text-brand" onClick={() => go("tramitacions")}>Tauler</button>} empty={!d.expedients.length && "No tens expedients assignats"}>
              <ul className="divide-y divide-line">{d.expedients.slice(0, 12).map((e) => <li key={e.id}><button onClick={() => go("expedient", { id: e.id })} className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] hover:text-brand"><span className="font-mono text-[11.5px]">{e.code}</span><span className="min-w-0 flex-1 truncate text-muted">{e.crm_clients?.name} · {EXP_STATUS_LABEL[e.status]}</span>{e.next_action_at && <span className="text-[11px] text-muted">{fdate(e.next_action_at)}</span>}</button></li>)}</ul>
            </Panel>
            <Panel title="Renovacions" empty={!d.renewals.length && "Cap renovació propera dels teus contractes"}><ul className="divide-y divide-line">{d.renewals.slice(0, 12).map((r) => <li key={r.id}><button onClick={() => go("client", { id: r.client_id, tab: "contractes" })} className="flex w-full justify-between py-2 text-[12.5px] hover:text-brand"><span className="truncate">{r.crm_clients?.name} · {r.retailer}</span><span className="text-muted tnum">{fdate(r.end_date)}</span></button></li>)}</ul></Panel>
            <Panel title="Incidències" empty={!d.incidents.length && "Cap incidència assignada"}><ul className="divide-y divide-line">{d.incidents.map((i) => <li key={i.id}><button onClick={() => go("incidencies", { id: i.id })} className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] hover:text-brand"><span className="min-w-0 flex-1 truncate">{i.title}<span className="text-muted"> · {i.crm_clients?.name}</span></span><Pill className={PRIORITY_TONE[i.priority]}>{PRIORITY_LABEL[i.priority]}</Pill></button></li>)}</ul></Panel>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Pendents (sense data o més endavant)"><TaskList rows={d.pending.slice(0, 15)} go={go} empty="Cap tasca pendent més endavant" /></Panel>
            <Panel title="Activitat recent" empty={!d.recent.length && "Encara no hi ha activitat"}><ul className="space-y-1">{d.recent.map((r) => <li key={r.id} className="text-[12px]"><span className="text-muted">{fdt(r.at)}</span> · {r.crm_tasks?.title} <span className="text-muted">({r.type === "estat" ? TASK_STATUS_LABEL[r.to_value ?? ""] ?? r.to_value : r.type})</span></li>)}</ul></Panel>
          </div>
        </>
      )}
      <TaskQuickCreate open={create} onClose={() => setCreate(false)} onDone={() => void load()} people={[]} area="administrativa" />
    </div>
  );
}

/* ======================================================================= PANELL COMERCIAL */

type Com = {
  kpis: { leads: number; leadsNous: number; clients: number; oportunitats: number; propostesPendents: number; trucadesAvui: number; tasques: number; contractesMes: number; guanyadesMes: number; mwhMes: number };
  leads: { id: string; name: string; status: string; created_at: string }[]; proposals: { id: string; title: string; proposal_sent_at: string | null }[];
  today: TaskRow[]; targets: { metric: string; target: number; actual: number | null }[];
  commissions: { estimated: number | null; accrued: number | null; pending: number | null } | null;
  series: { month: string; contractes: number; guanyades: number; mwh: number }[];
};
const METRIC: Record<string, string> = { guanyades: "Oportunitats guanyades", mwh: "MWh", oportunitats: "Oportunitats noves", comissio: "Comissió (€)" };
export function CommercialPanelView() {
  const go = useApp((s) => s.navigate);
  const { d, err, busy, load } = useData<Com>("comercial");
  if (err) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="red">{err}</Notice><div className="mt-4"><AgendaSummaryCard /></div></div>;
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<Target size={16} />} title="Panell comercial" sub="Els teus leads, oportunitats, agenda i resultats. Només dades pròpies: sense marges globals ni comissions d'altres persones." tone="from-violet-600 to-fuchsia-500">
        <Button size="sm" variant="primary" onClick={() => go("leads", { new: "1" })}><UserPlus size={13} /> Nou lead</Button>
        <Button size="sm" onClick={() => go("jornada")}><CalendarCheck size={13} /> Agenda</Button>
        <Button size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={13} className={cn(busy && "animate-spin")} /></Button>
      </PageHead>
      <AgendaSummaryCard />
      {!d ? <Skeleton /> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Leads assignats" value={d.kpis.leads} sub={`${d.kpis.leadsNous} nous`} onClick={() => go("leads")} />
            <Stat label="Clients" value={d.kpis.clients} onClick={() => go("clients")} />
            <Stat label="Oportunitats obertes" value={d.kpis.oportunitats} onClick={() => go("pipeline")} />
            <Stat label="Propostes pendents" value={d.kpis.propostesPendents} tone={d.kpis.propostesPendents ? "amber" : undefined} />
            <Stat label="Trucades d'avui" value={d.kpis.trucadesAvui} />
            <Stat label="Tasques obertes" value={d.kpis.tasques} onClick={() => go("tasques")} />
            <Stat label="Contractes del mes" value={d.kpis.contractesMes} tone="green" />
            <Stat label="Guanyades del mes" value={d.kpis.guanyadesMes} />
            <Stat label="MWh del mes" value={`${num(d.kpis.mwhMes, 1)}`} />
            <Stat label="Les meves comissions (mes)" value={d.commissions ? eur(d.commissions.accrued) : "—"} sub={d.commissions ? `Pendent de liquidar: ${eur(d.commissions.pending)}` : "Sense dades de comissions"} onClick={() => go("economia", { tab: "ranquing" })} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Resultats mensuals" className="lg:col-span-2">
              <div className="h-56"><ResponsiveContainer><BarChart data={d.series} margin={{ left: -18, right: 4, top: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} /><XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="contractes" name="Contractes" fill="rgb(var(--brand))" radius={[4, 4, 0, 0]} /><Bar dataKey="guanyades" name="Guanyades" fill="#8b5cf6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Panel>
            <Panel title="Objectius del mes" empty={!d.targets.length && "Direcció encara no t'ha fixat objectius aquest mes"}>
              <div className="space-y-2.5">{d.targets.map((t) => { const pct = t.actual == null || !t.target ? 0 : Math.min(100, (t.actual / t.target) * 100); return <div key={t.metric}><div className="mb-0.5 flex justify-between text-[12.5px]"><span>{METRIC[t.metric] ?? t.metric}</span><span className="tnum text-muted">{t.metric === "comissio" ? eur(t.actual) : num(t.actual, 1)} / {t.metric === "comissio" ? eur(t.target) : num(t.target, 1)}</span></div><div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-violet-500")} style={{ width: `${pct}%` }} /></div></div>; })}</div>
            </Panel>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title={<span className="flex items-center gap-1.5"><Phone size={13} /> Avui i endarrerit</span>}><TaskList rows={d.today} go={go} empty="Res pendent per avui" /></Panel>
            <Panel title="Leads per treballar" action={<button className="text-[12px] text-brand" onClick={() => go("leads")}>Tots</button>} empty={!d.leads.length && "Cap lead obert"}><ul className="divide-y divide-line">{d.leads.map((l) => <li key={l.id}><button onClick={() => go("leads", { id: l.id })} className="flex w-full items-center justify-between py-2 text-left text-[12.5px] hover:text-brand"><span className="truncate">{l.name}</span><span className="text-[11.5px] text-muted">{l.status === "nou" ? "Nou" : l.status} · {fdate(l.created_at)}</span></button></li>)}</ul></Panel>
            <Panel title="Propostes pendents de resposta" empty={!d.proposals.length && "Cap proposta pendent"}><ul className="divide-y divide-line">{d.proposals.map((o) => <li key={o.id}><button onClick={() => go("oportunitat", { id: o.id })} className="flex w-full items-center justify-between py-2 text-left text-[12.5px] hover:text-brand"><span className="truncate">{o.title}</span><span className="flex items-center gap-1 text-[11.5px] text-muted">{fdate(o.proposal_sent_at)} <ArrowRight size={11} /></span></button></li>)}</ul></Panel>
          </div>
          <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><FileStack size={12} /> Les comissions mostrades són només les teves (càlcul de la Fase 4). Les previstes no són imports confirmats.</p>
        </>
      )}
    </div>
  );
}
