"use client";
/**
 * PANELL DEL CAP D'EQUIP (Fase 8.1). Mostra només el que la RLS deixa veure: els comercials del seu equip.
 * Les comissions apareixen només si Direcció ha autoritzat «Comissions de l'equip».
 */
import { AgendaSummaryCard } from "../agenda/Summary";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, RefreshCw, Target, UserPlus, UsersRound } from "lucide-react";
import { useApp } from "@/data/store";
import { Button, Notice, cn } from "../../components/ui";
import { Avatar } from "../sales/shared";
import { EXP_STATUS_LABEL, Panel, PageHead, Skeleton, Stat, eur, fdate, num } from "../consolidacio/shared";
import { TaskQuickCreate } from "../consolidacio/Tasks";
import { ApiError } from "../crm/api";

type Obj = { metric: string; label: string; target: number; actual: number | null; pct: number | null; reached: boolean };
type Member = { id: string; name: string; contractesMes: number; mwhMes: number; senseConsum: number; conversio: number | null; oportunitatsObertes: number; renovacions: number; tasquesVencudes: number; objectives: Obj[]; lastActivity: string | null; inactiu: boolean; diesSenseActivitat: number | null; comissio: number | null };
type Data = {
  teams: { id: string; name: string }[]; members: { id: string; name: string }[]; empty: boolean; canCommissions: boolean; month: string;
  kpis: { contractesMes: number; mwhMes: number; contractesSenseConsum: number; conversio: number | null; oportunitatsObertes: number; renovacionsPendents: number; tasquesVencudes: number; objectius: { assolits: number; total: number }; comissionsAutoritzades: number | null; comercialsInactius: number };
  perMember: Member[]; series: { month: string; contractes: number; mwh: number; guanyades: number }[];
  alerts: { kind: string; userId: string; taskId?: string; text: string }[];
  overdueTasks: { id: string; title: string; assigned_to: string | null; due_at: string | null }[];
  leads: { id: string; name: string; company: string | null; status: string; owner_id: string | null; owner: string | null; created_at: string }[];
  expedients: { id: string; code: string | null; status: string; retailer: string; owner: string | null; status_changed_at: string }[];
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json" } }).catch(() => { throw new ApiError(0, "No hi ha connexió amb el servidor."); });
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
export const teamsApi = {
  get: <T,>(r: string) => call<T>(`/api/teams?r=${r}`),
  act: <T = { ok: boolean }>(action: string, data: unknown) => call<T>("/api/teams", { method: "POST", body: JSON.stringify({ action, data }) }),
};

const chartBox = "h-52";
const axis = { fontSize: 11, stroke: "rgb(var(--muted))", tickLine: false, axisLine: false } as const;

export function TeamPanelView() {
  const go = useApp((s) => s.navigate);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); try { setD(await teamsApi.get<Data>("panel")); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const assign = async (leadId: string, ownerId: string) => {
    try { await teamsApi.act("lead_assign", { leadId, ownerId }); setMsg("Lead assignat"); void load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  if (err) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="red">{err}</Notice><div className="mt-4"><AgendaSummaryCard /></div></div>;
  const k = d?.kpis;
  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<UsersRound size={16} />} title={d?.teams.length ? `El meu equip · ${d.teams.map((t) => t.name).join(", ")}` : "El meu equip"} sub="Rendiment, objectius, oportunitats, renovacions i tasques dels comercials del teu equip. Només hi veus el teu equip." tone="from-indigo-600 to-sky-500">
        <Button size="sm" variant="primary" onClick={() => setTask("")} disabled={!d?.members.length}><UserPlus size={13} /> Assigna una tasca</Button>
        <Button size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={13} className={cn(busy && "animate-spin")} /> Actualitza</Button>
      </PageHead>
      <AgendaSummaryCard />
      {msg && <Notice tone="blue">{msg}</Notice>}
      {!d || !k ? <Skeleton /> : d.empty ? (
        <Notice tone="amber">Encara no tens cap comercial assignat. Direcció crea els equips a «Administració › Equips comercials».</Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Contractes del mes" value={num(k.contractesMes)} />
            <Stat label="MWh captats (mes)" value={num(k.mwhMes, 1)} hint="Consum anual dels subministraments dels contractes del mes. Els contractes sense consum no sumen." sub={k.contractesSenseConsum ? `${k.contractesSenseConsum} sense consum` : undefined} />
            <Stat label="Objectius assolits" value={k.objectius.total ? `${k.objectius.assolits}/${k.objectius.total}` : "—"} tone={k.objectius.total && k.objectius.assolits === k.objectius.total ? "green" : undefined} />
            <Stat label="Conversió (mes)" value={k.conversio == null ? "—" : `${num(k.conversio, 1)} %`} hint="Guanyades ÷ (guanyades + perdudes) del mes" />
            <Stat label="Oportunitats obertes" value={num(k.oportunitatsObertes)} onClick={() => go("pipeline")} />
            <Stat label="Renovacions pendents (120 dies)" value={num(k.renovacionsPendents)} tone={k.renovacionsPendents ? "amber" : undefined} onClick={() => go("kanban")} />
            <Stat label="Tasques vençudes" value={num(k.tasquesVencudes)} tone={k.tasquesVencudes ? "red" : "green"} onClick={() => go("tasques")} />
            <Stat label="Comercials sense activitat" value={num(k.comercialsInactius)} tone={k.comercialsInactius ? "amber" : "green"} hint="5 o més dies laborables sense activitat registrada al CRM" />
            <Stat label="Comissions comercials autoritzades (mes)" value={k.comissionsAutoritzades == null ? "No autoritzat" : eur(k.comissionsAutoritzades)} hint="Només la capa comercial dels teus comercials, si Direcció ho ha autoritzat" />
            <Stat label="Contractes pendents de tramitació" value={num(d.expedients.length)} onClick={() => go("tramitacions")} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Contractes per mes (equip)">
              <div className={chartBox}><ResponsiveContainer><BarChart data={d.series} margin={{ left: -18, right: 4, top: 4 }} barCategoryGap={6}><CartesianGrid stroke="rgb(var(--line))" vertical={false} /><XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip cursor={{ fill: "rgb(var(--ink) / 0.05)" }} formatter={(v) => [num(Number(v)), "Contractes"]} labelFormatter={(m) => String(m)} /><Bar dataKey="contractes" name="Contractes" fill="rgb(var(--brand))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Panel>
            <Panel title="MWh captats per mes (equip)">
              <div className={chartBox}><ResponsiveContainer><BarChart data={d.series} margin={{ left: -10, right: 4, top: 4 }} barCategoryGap={6}><CartesianGrid stroke="rgb(var(--line))" vertical={false} /><XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} {...axis} /><YAxis {...axis} /><Tooltip cursor={{ fill: "rgb(var(--ink) / 0.05)" }} formatter={(v) => [`${num(Number(v), 1)} MWh`, "MWh"]} labelFormatter={(m) => String(m)} /><Bar dataKey="mwh" name="MWh" fill="#4f46e5" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Panel>
          </div>

          <Panel title="Rendiment per comercial" action={<span className="text-[11.5px] text-muted">{d.month}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[12.5px]">
                <thead className="text-left text-[11.5px] text-muted"><tr><th className="py-1.5">Comercial</th><th className="text-right">Contractes</th><th className="text-right">MWh</th><th className="text-right">Conversió</th><th className="text-right">Oport. obertes</th><th className="text-right">Renovacions</th><th className="text-right">Tasques vençudes</th><th className="pl-3">Objectius</th><th className="text-right">Última activitat</th>{d.canCommissions && <th className="text-right">Comissió</th>}</tr></thead>
                <tbody className="divide-y divide-line">
                  {d.perMember.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2"><span className="flex items-center gap-2"><Avatar name={m.name} size={24} />{m.name}</span></td>
                      <td className="text-right tnum">{m.contractesMes}</td>
                      <td className="text-right tnum">{num(m.mwhMes, 1)}</td>
                      <td className="text-right tnum">{m.conversio == null ? "—" : `${num(m.conversio, 1)} %`}</td>
                      <td className="text-right tnum">{m.oportunitatsObertes}</td>
                      <td className="text-right tnum">{m.renovacions}</td>
                      <td className={cn("text-right tnum", m.tasquesVencudes && "font-semibold text-red-600")}>{m.tasquesVencudes}</td>
                      <td className="pl-3">{m.objectives.length ? <div className="space-y-1">{m.objectives.map((o) => <div key={o.metric} title={`${o.label}: ${o.actual ?? "—"} de ${o.target}`} className="flex items-center gap-2"><span className="w-24 truncate text-[11px] text-muted">{o.label}</span><span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/[0.07]"><span className={cn("block h-full rounded-full", o.reached ? "bg-emerald-500" : "bg-brand")} style={{ width: `${Math.min(100, o.pct ?? 0)}%` }} /></span><span className="text-[11px] tnum">{o.pct == null ? "—" : `${num(o.pct)} %`}</span></div>)}</div> : <span className="text-[11.5px] text-muted">Sense objectius</span>}</td>
                      <td className={cn("text-right text-[11.5px]", m.inactiu ? "font-semibold text-amber-600" : "text-muted")}>{m.lastActivity ? fdate(m.lastActivity) : "Cap"}{m.inactiu ? " ⚠" : ""}</td>
                      {d.canCommissions && <td className="text-right tnum">{m.comissio == null ? "—" : eur(m.comissio)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted">Els objectius es fixen a «Comercial › Rendiment comercial». ⚠ = 5 o més dies laborables sense activitat registrada.</p>
          </Panel>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title={<span className="flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-500" /> Alertes</span>} empty={!d.alerts.length && "Cap alerta: tothom té activitat i cap tasca vençuda"}>
              <ul className="space-y-1.5 text-[12.5px]">{d.alerts.slice(0, 20).map((a, i) => <li key={i}><button className="text-left hover:text-brand" onClick={() => (a.taskId ? go("tasques", { id: a.taskId }) : undefined)}>{a.text}</button></li>)}</ul>
            </Panel>
            <Panel title="Leads per assignar o redistribuir" empty={!d.leads.length && "Cap lead obert"}>
              <ul className="divide-y divide-line">
                {d.leads.slice(0, 30).map((l) => (
                  <li key={l.id} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                    <button className="min-w-0 flex-1 truncate text-left hover:text-brand" onClick={() => go("leads", { id: l.id })}>{l.company || l.name}</button>
                    <select aria-label="Assignar a" className="rounded-lg border border-line bg-surface px-1.5 py-1 text-[12px]" value={l.owner_id ?? ""} onChange={(e) => e.target.value && void assign(l.id, e.target.value)}>
                      <option value="">—</option>
                      {d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Contractes pendents de tramitació" empty={!d.expedients.length && "Cap expedient pendent"}>
              <ul className="divide-y divide-line">{d.expedients.slice(0, 25).map((e) => <li key={e.id}><button onClick={() => go("expedient", { id: e.id })} className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] hover:text-brand"><span className="font-mono text-[11.5px]">{e.code ?? "—"}</span><span className="min-w-0 flex-1 truncate text-muted">{e.retailer} · {EXP_STATUS_LABEL[e.status] ?? e.status}{e.owner ? ` · ${e.owner}` : ""}</span><span className="text-[11.5px] text-muted tnum">{fdate(e.status_changed_at)}</span></button></li>)}</ul>
            </Panel>
          </div>
          {!d.canCommissions && <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><Target size={12} /> Les comissions dels comercials no es mostren: Direcció les pot autoritzar a «Usuaris i permisos › Comissions de l&apos;equip».</p>}
        </>
      )}
      <TaskQuickCreate open={task !== null} onClose={() => setTask(null)} onDone={() => void load()} people={d?.members ?? []} area="comercial" />
    </div>
  );
}
