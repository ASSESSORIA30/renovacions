"use client";
/** GESTOR D'INCIDÈNCIES (Fase 7): prioritat (fins a urgent), responsable, termini, escalat i historial. */
import { IncidentAgendaActions } from "../agenda/Incident";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, ExternalLink, Loader2, MessageSquare, RefreshCw, Search, TriangleAlert, X } from "lucide-react";
import { useApp } from "@/data/store";
import { Button, Notice, cn } from "../../components/ui";
import { Avatar } from "../sales/shared";
import { INC_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE, PageHead, Pill, api, fdate, fdt } from "./shared";
import { ExportButton } from "../../components/ExportButton";

type Inc = { id: string; title: string; description: string | null; kind: string; category: string | null; status: string; priority: string; external_ref: string | null; assigned_to: string | null; assigned_name: string | null; opened_at: string; closed_at: string | null; due_at: string | null; escalation_level: number; resolution: string | null; client_id: string; expedient_id: string | null; crm_clients: { name: string } | null; crm_expedients: { code: string } | null };
type List = { incidents: Inc[]; total: number; page: number; pageSize: number; canEscalate: boolean; people: { id: string; name: string }[] };
const KIND: Record<string, string> = { incidencia: "Incidència", reclamacio: "Reclamació", consulta: "Consulta" };

export function IncidentsView() {
  const params = useApp((s) => s.params);
  const [f, setF] = useState({ status: "obertes", priority: params.priority ?? "", mine: params.mine ?? "", q: "" });
  const [d, setD] = useState<List | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(params.id ?? null);
  const [page, setPage] = useState(0);
  const load = useCallback(async () => { setBusy(true); try { setD(await api.work<List>("incidents", { ...f, page })); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }, [f, page]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<TriangleAlert size={16} />} title="Incidències" sub="Incidències, reclamacions i consultes de clients. Les urgents s'escalen automàticament a la Cap administrativa i després a Direcció." tone="from-rose-600 to-orange-500">
        <ExportButton set="incidencies" params={{ q: f.q, f_priority: f.priority, owner: f.mine === "1" ? "me" : "", ...(f.status === "obertes" ? { x_group: "obertes" } : f.status && f.status !== "totes" ? { status: f.status } : {}) }} />
        <Button size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={13} className={cn(busy && "animate-spin")} /></Button>
      </PageHead>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="input h-9 w-56 pl-8 text-[12.5px]" placeholder="Cerca per títol" aria-label="Cerca incidències" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Estat" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="obertes">Obertes</option>{Object.entries(INC_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="totes">Totes</option></select>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Prioritat" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">Qualsevol prioritat</option>{["urgent", "alta", "mitjana", "baixa"].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={f.mine === "1"} onChange={(e) => setF({ ...f, mine: e.target.checked ? "1" : "" })} /> Només les meves</label>
        {d && <span className="ml-auto text-[12px] text-muted">{d.total} incidències</span>}
      </div>
      {err && <Notice tone="red">{err}</Notice>}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {!d ? <div className="h-64 animate-pulse bg-elevated" /> : !d.incidents.length ? <p className="py-14 text-center text-[13px] text-muted">Cap incidència amb aquests filtres.</p> : (
          <table className="w-full text-[12.5px]">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2 font-medium">Incidència</th><th className="hidden px-3 font-medium md:table-cell">Client</th><th className="px-3 font-medium">Prioritat</th><th className="px-3 font-medium">Estat</th><th className="px-3 font-medium">Responsable</th><th className="px-3 text-right font-medium">Oberta</th></tr></thead>
            <tbody>{d.incidents.map((i) => (
              <tr key={i.id} onClick={() => setOpen(i.id)} className={cn("cursor-pointer border-b border-line last:border-0 hover:bg-ink/[0.025]", open === i.id && "bg-brand/[0.04]")}>
                <td className="max-w-[320px] px-3 py-2.5"><p className="flex items-center gap-1.5 truncate font-medium">{i.escalation_level > 0 && <ArrowUpCircle size={13} className="shrink-0 text-red-500" aria-label="Escalada" />}{i.title}</p><p className="text-[11px] text-muted">{KIND[i.kind]}{i.category ? ` · ${i.category}` : ""}{i.external_ref ? ` · ref. ${i.external_ref}` : ""}</p></td>
                <td className="hidden max-w-[200px] truncate px-3 text-muted md:table-cell">{i.crm_clients?.name}</td>
                <td className="px-3"><Pill className={PRIORITY_TONE[i.priority]}>{PRIORITY_LABEL[i.priority]}</Pill></td>
                <td className="px-3">{INC_STATUS_LABEL[i.status]}</td>
                <td className="px-3"><span className="flex items-center gap-1.5"><Avatar name={i.assigned_name} size={20} /><span className="hidden lg:inline">{i.assigned_name ?? "—"}</span></span></td>
                <td className="px-3 text-right tnum text-muted">{fdate(i.opened_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {d && d.total > d.pageSize && <div className="flex items-center justify-end gap-2 text-[12.5px]"><Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><Button size="sm" disabled={(page + 1) * d.pageSize >= d.total} onClick={() => setPage(page + 1)}>Següent</Button></div>}
      <p className="text-[11.5px] text-muted">Per obrir una incidència nova, fes-ho des de la fitxa del client o de l&apos;expedient (així queda vinculada correctament).</p>
      {open && <IncidentDrawer id={open} onClose={() => setOpen(null)} onChange={() => void load()} people={d?.people ?? []} canEscalate={!!d?.canEscalate} />}
    </div>
  );
}

type Detail = { incident: Inc; events: { id: number; at: string; user_name: string | null; type: string; from_value: string | null; to_value: string | null; note: string | null }[]; tasks: { id: string; title: string; status: string; assigned_name: string | null }[] };
function IncidentDrawer({ id, onClose, onChange, people, canEscalate }: { id: string; onClose: () => void; onChange: () => void; people: { id: string; name: string }[]; canEscalate: boolean }) {
  const go = useApp((s) => s.navigate);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => api.work<Detail>("incident", { id }).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const patch = async (data: Record<string, unknown>) => { try { await api.workAct("incident_update", { id, data }); await load(); onChange(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const i = d?.incident;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface p-5 shadow-lift" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Detall de la incidència">
        <div className="mb-3 flex items-start justify-between gap-2"><h3 className="text-[16px] font-semibold">{i?.title ?? "Incidència"}</h3><button aria-label="Tanca" onClick={onClose} className="rounded p-1 text-muted hover:text-ink"><X size={16} /></button></div>
        {err && <Notice tone="red">{err}</Notice>}
        {!i ? <Loader2 className="mx-auto mt-10 animate-spin text-muted" /> : (
          <div className="space-y-4 text-[12.5px]">
            {i.description && <p className="whitespace-pre-wrap rounded-xl bg-elevated p-3">{i.description}</p>}
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1"><span className="text-[11px] text-muted">Estat</span><select className="input h-9" value={i.status} onChange={(e) => { const s = e.target.value; if (s === "resolta" || s === "tancada") { const r = prompt("Com s'ha resolt?", i.resolution ?? ""); if (r) void patch({ status: s, resolution: r }); } else void patch({ status: s }); }}>{Object.entries(INC_STATUS_LABEL).filter(([k]) => k !== "tancada" || canEscalate).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="space-y-1"><span className="text-[11px] text-muted">Prioritat</span><select className="input h-9" value={i.priority} onChange={(e) => void patch({ priority: e.target.value })}>{["urgent", "alta", "mitjana", "baixa"].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
              <label className="space-y-1"><span className="text-[11px] text-muted">Responsable</span>{people.length ? <select className="input h-9" value={i.assigned_to ?? ""} onChange={(e) => void patch({ assigned_to: e.target.value || null })}><option value="">Sense assignar</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <p className="flex h-9 items-center">{i.assigned_name ?? "Sense assignar"}</p>}</label>
              <label className="space-y-1"><span className="text-[11px] text-muted">Termini</span><input type="date" className="input h-9" value={i.due_at?.slice(0, 10) ?? ""} onChange={(e) => void patch({ due_at: e.target.value ? `${e.target.value}T17:00:00.000Z` : null })} /></label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:text-brand" onClick={() => go("client", { id: i.client_id })}>Client: {i.crm_clients?.name} <ExternalLink size={11} /></button>
              {i.expedient_id && <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:text-brand" onClick={() => go("expedient", { id: i.expedient_id! })}>Expedient {i.crm_expedients?.code} <ExternalLink size={11} /></button>}
              {!["resolta", "tancada"].includes(i.status) && <IncidentAgendaActions incident={{ id: i.id, title: i.title }} client={i.client_id ? { id: i.client_id, name: i.crm_clients?.name ?? "" } : null} assignee={i.assigned_to} />}
              {i.escalation_level < 2 && !["resolta", "tancada"].includes(i.status) && <Button size="sm" variant="secondary" onClick={() => { if (confirm(i.escalation_level === 0 ? "Escalar a la Cap administrativa?" : "Escalar a Direcció?")) void patch({ escalate: true }); }}><ArrowUpCircle size={13} /> Escala</Button>}
            </div>
            {i.escalation_level > 0 && <Notice tone="amber">Escalada {i.escalation_level === 2 ? "a Direcció" : "a la Cap administrativa"}.</Notice>}
            {i.resolution && <Notice tone="green">Resolució: {i.resolution}</Notice>}
            {d.tasks.length > 0 && <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Tasques vinculades</p>{d.tasks.map((t) => <button key={t.id} className="block w-full truncate py-0.5 text-left hover:text-brand" onClick={() => go("tasques", { id: t.id })}>{t.title} · <span className="text-muted">{t.assigned_name}</span></button>)}</div>}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Historial</p>
              <ol className="space-y-1.5 border-l border-line pl-3">{d.events.map((e) => <li key={e.id}><b>{e.type === "comentari" ? "Comentari" : e.type === "estat" ? "Estat" : e.type === "assignacio" ? "Reassignada" : e.type === "escalada" ? "Escalada" : e.type === "prioritat" ? "Prioritat" : "Creada"}</b>{e.type === "comentari" ? <span className="block rounded-lg bg-elevated px-2 py-1">{e.note}</span> : e.from_value || e.to_value ? <> · {INC_STATUS_LABEL[e.from_value ?? ""] ?? e.from_value ?? "—"} → {INC_STATUS_LABEL[e.to_value ?? ""] ?? e.to_value}</> : null}{e.note && e.type !== "comentari" ? ` (${e.note})` : ""}<span className="block text-[11px] text-muted">{e.user_name ?? "Sistema"} · {fdt(e.at)}</span></li>)}</ol>
              <form className="mt-2 flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await api.workAct("incident_comment", { id, note }); setNote(""); void load(); }}><input className="input h-9 flex-1" placeholder="Afegeix un comentari…" aria-label="Comentari" value={note} onChange={(e) => setNote(e.target.value)} /><Button size="sm" type="submit"><MessageSquare size={13} /></Button></form>
            </div>
            <p className="text-[11px] text-muted">Oberta el {fdt(i.opened_at)}{i.closed_at ? ` · tancada el ${fdt(i.closed_at)}` : ""}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

