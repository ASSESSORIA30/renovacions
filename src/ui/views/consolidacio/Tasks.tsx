"use client";
/**
 * GESTOR GLOBAL DE TASQUES (Fase 7). Una sola llista per a les tasques de totes les fases, amb estat, prioritat,
 * responsable, venciment, vincles (client, expedient, lead, oportunitat, incidència) i historial complet.
 * Direcció supervisa totes; la Cap administrativa, les administratives; cadascú gestiona les seves.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, ListTodo, Loader2, MessageSquare, Plus, RefreshCw, Search, UserPlus, X } from "lucide-react";
import { useApp, type View } from "@/data/store";
import { Button, Modal, Notice, Tabs, cn } from "../../components/ui";
import { Avatar } from "../sales/shared";
import { PRIORITY_LABEL, PRIORITY_TONE, PageHead, Pill, TASK_STATUS_LABEL, TASK_STATUS_TONE, api, fdate, fdt, isOverdue } from "./shared";
import { ExportButton } from "../../components/ExportButton";

type Task = {
  id: string; title: string; notes: string | null; status: string; priority: string; area: string | null; kind: string; due_at: string | null; assigned_to: string | null; assigned_name: string | null; created_at: string; completed_at: string | null;
  blocked_reason: string | null; escalation_level: number; partner_visible: boolean; source: string; client_id: string | null; expedient_id: string | null; lead_id: string | null; opportunity_id: string | null; incident_id: string | null;
  crm_clients: { name: string } | null; crm_expedients: { code: string } | null; crm_leads: { name: string } | null; crm_opportunities: { title: string } | null;
};
type List = { tasks: Task[]; total: number; page: number; pageSize: number; canSupervise: boolean; canAssign: boolean; people: { id: string; name: string; role: string }[] };
const AREA_LABEL: Record<string, string> = { administrativa: "Administrativa", comercial: "Comercial", direccio: "Direcció", externa: "Sol·licitud externa" };
const KIND_LABEL: Record<string, string> = { trucada: "Trucada", reunio: "Reunió", seguiment: "Seguiment", tramitacio: "Tramitació", renovacio: "Renovació", altres: "Altres", documentacio: "Documentació", incidencia: "Incidència", comissio: "Comissió", sollicitud_externa: "Sol·licitud externa" };
type Scope = "meves" | "creades" | "equip" | "totes" | "externes";

export function TasksView() {
  const params = useApp((s) => s.params);
  const role = useApp((s) => s.snap?.me.role);
  const meId = useApp((s) => s.snap?.me.id ?? "");
  const [scope, setScope] = useState<Scope>((params.scope as Scope) ?? "meves");
  const [f, setF] = useState({ status: params.status ?? "obertes", priority: "", area: "", assignee: params.assignee ?? "", q: "" });
  const [page, setPage] = useState(0);
  const [d, setD] = useState<List | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(params.id ?? null);
  const [create, setCreate] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setD(await api.work<List>("tasks", { scope, ...f, page })); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [scope, f, page]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (params.id) setOpen(params.id); }, [params.id]);
  const assign = async (to: string) => { await api.workAct("task_assign", { ids: sel, assignee: to }); setSel([]); void load(); };
  const scopes: { id: Scope; label: string }[] = [{ id: "meves", label: "Les meves" }, { id: "creades", label: "Creades per mi" }, ...(d?.canSupervise ? [{ id: "equip" as const, label: role === "admin" ? "Equip" : "Equip administratiu" }, ...(role === "admin" ? [{ id: "totes" as const, label: "Totes" }] : [])] : []), ...(role !== "comercial" ? [{ id: "externes" as const, label: "Sol·licituds externes" }] : [])];
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<ListTodo size={16} />} title="Tasques" sub="Totes les tasques del CRM en un sol lloc: manuals, automàtiques, de renovacions, expedients, leads i incidències." tone="from-indigo-600 to-sky-500">
        <ExportButton set="tasques" ids={sel.length ? sel : undefined} params={{
          q: f.q, f_priority: f.priority, f_area: f.area, owner: scope === "meves" ? "me" : f.assignee,
          l_created_by: scope === "creades" ? meId : "", x_externes: scope === "externes" ? "1" : "",
          ...(["obertes", "vencudes", "bloquejades", "fetes"].includes(f.status) ? { x_group: f.status } : f.status && f.status !== "totes" ? { status: f.status } : {}),
        }} />
        <Button size="sm" variant="primary" onClick={() => setCreate(true)}><Plus size={13} /> Nova tasca</Button>
        <Button size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={13} className={cn(busy && "animate-spin")} /></Button>
      </PageHead>
      <Tabs value={scope} onChange={(v) => { setScope(v); setPage(0); setSel([]); }} items={scopes} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="input h-9 w-56 pl-8 text-[12.5px]" placeholder="Cerca per títol" aria-label="Cerca tasques" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(0); }} /></div>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Estat" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(0); }}>
          <option value="obertes">Obertes</option><option value="vencudes">Vençudes</option><option value="bloquejades">Bloquejades</option><option value="pendent">Pendents</option><option value="en_curs">En curs</option><option value="fetes">Finalitzades</option><option value="cancellada">Cancel·lades</option><option value="totes">Totes</option>
        </select>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Prioritat" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">Qualsevol prioritat</option>{["urgent", "alta", "normal", "baixa"].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Àrea" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}><option value="">Totes les àrees</option>{Object.entries(AREA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {d?.canSupervise && (scope === "equip" || scope === "totes") && <select className="input h-9 w-auto text-[12.5px]" aria-label="Responsable" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}><option value="">Tothom</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {d && <span className="ml-auto text-[12px] text-muted">{d.total} tasques</span>}
      </div>
      {sel.length > 0 && d?.canAssign && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand/[0.05] px-3 py-2 text-[12.5px]">
          <b>{sel.length} seleccionades</b><span className="text-muted">Reassigna a:</span>
          {d.people.filter((p) => p.role !== "comercial" || role === "admin").map((p) => <button key={p.id} onClick={() => void assign(p.id)} className="rounded-lg border border-line bg-surface px-2 py-1 hover:border-brand hover:text-brand">{p.name}</button>)}
          <button className="ml-auto text-muted" onClick={() => setSel([])}><X size={14} /></button>
        </div>
      )}
      {err && <Notice tone="red">{err}</Notice>}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {!d ? <div className="h-64 animate-pulse bg-elevated" /> : !d.tasks.length ? <p className="py-14 text-center text-[13px] text-muted">Cap tasca amb aquests filtres.</p> : (
          <table className="w-full text-[12.5px]">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted"><tr>{d.canAssign && <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Selecciona-les totes" checked={sel.length === d.tasks.length} onChange={(e) => setSel(e.target.checked ? d.tasks.map((t) => t.id) : [])} /></th>}<th className="px-3 py-2 font-medium">Tasca</th><th className="hidden px-3 font-medium md:table-cell">Vinculada a</th><th className="px-3 font-medium">Responsable</th><th className="px-3 font-medium">Estat</th><th className="px-3 text-right font-medium">Venciment</th></tr></thead>
            <tbody>
              {d.tasks.map((t) => (
                <tr key={t.id} className={cn("cursor-pointer border-b border-line last:border-0 hover:bg-ink/[0.025]", open === t.id && "bg-brand/[0.04]")} onClick={() => setOpen(t.id)}>
                  {d.canAssign && <td className="px-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Selecciona ${t.title}`} checked={sel.includes(t.id)} onChange={(e) => setSel(e.target.checked ? [...sel, t.id] : sel.filter((x) => x !== t.id))} /></td>}
                  <td className="max-w-[340px] px-3 py-2.5"><p className="flex items-center gap-1.5 truncate font-medium">{t.escalation_level > 0 && <AlertTriangle size={12} className="shrink-0 text-red-500" aria-label="Escalada" />}{t.title}</p><p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">{KIND_LABEL[t.kind] ?? t.kind}{t.area ? ` · ${AREA_LABEL[t.area]}` : ""}{t.source === "automatica" ? " · automàtica" : ""}{t.priority !== "normal" && <Pill className={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill>}</p></td>
                  <td className="hidden max-w-[220px] truncate px-3 text-muted md:table-cell">{t.crm_clients?.name ?? t.crm_leads?.name ?? t.crm_opportunities?.title ?? (t.crm_expedients ? t.crm_expedients.code : "—")}</td>
                  <td className="px-3"><span className="flex items-center gap-1.5"><Avatar name={t.assigned_name} size={20} /><span className="hidden truncate lg:inline">{t.assigned_name ?? "Sense assignar"}</span></span></td>
                  <td className="px-3"><Pill className={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Pill></td>
                  <td className={cn("px-3 text-right tnum", isOverdue(t.due_at, t.status) ? "font-semibold text-red-600" : "text-muted")}>{fdate(t.due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {d && d.total > d.pageSize && <div className="flex items-center justify-end gap-2 text-[12.5px]"><Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span className="text-muted">Pàgina {page + 1} de {Math.ceil(d.total / d.pageSize)}</span><Button size="sm" disabled={(page + 1) * d.pageSize >= d.total} onClick={() => setPage(page + 1)}>Següent</Button></div>}
      {open && <TaskDrawer id={open} onClose={() => setOpen(null)} onChange={() => void load()} people={d?.people ?? []} canAssign={!!d?.canAssign} />}
      <TaskQuickCreate open={create} onClose={() => setCreate(false)} onDone={() => void load()} people={d?.people ?? []} />
    </div>
  );
}

type Detail = { task: Task; events: { id: number; at: string; user_name: string | null; type: string; from_value: string | null; to_value: string | null; note: string | null }[] };
const EV: Record<string, string> = { creada: "Creada", estat: "Estat", assignacio: "Reassignada", prioritat: "Prioritat", venciment: "Venciment", comentari: "Comentari", escalada: "Escalada", bloqueig: "Bloquejada" };
function TaskDrawer({ id, onClose, onChange, people, canAssign }: { id: string; onClose: () => void; onChange: () => void; people: { id: string; name: string }[]; canAssign: boolean }) {
  const go = useApp((s) => s.navigate);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.work<Detail>("task", { id }).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const patch = async (data: Record<string, unknown>) => {
    setBusy(true);
    try { await api.workAct("task_update", { id, data }); await load(); onChange(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const t = d?.task;
  const link = (v: View, p: Record<string, string>) => () => go(v, p);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface p-5 shadow-lift" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Detall de la tasca">
        <div className="mb-3 flex items-start justify-between gap-2"><h3 className="text-[16px] font-semibold leading-snug">{t?.title ?? "Tasca"}</h3><button aria-label="Tanca" onClick={onClose} className="rounded p-1 text-muted hover:text-ink"><X size={16} /></button></div>
        {err && <Notice tone="red">{err}</Notice>}
        {!t ? <Loader2 className="mx-auto mt-10 animate-spin text-muted" /> : (
          <div className="space-y-4">
            {t.notes && <p className="whitespace-pre-wrap rounded-xl bg-elevated p-3 text-[12.5px]">{t.notes}</p>}
            <div className="grid grid-cols-2 gap-2 text-[12.5px]">
              <label className="space-y-1"><span className="text-[11px] text-muted">Estat</span><select className="input h-9" disabled={busy} value={t.status} onChange={(e) => { const s = e.target.value; if (s === "bloquejada") { const r = prompt("Per què està bloquejada?"); if (r) void patch({ status: s, blocked_reason: r }); } else void patch({ status: s }); }}>{Object.entries(TASK_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="space-y-1"><span className="text-[11px] text-muted">Prioritat</span><select className="input h-9" disabled={busy} value={t.priority} onChange={(e) => void patch({ priority: e.target.value })}>{["urgent", "alta", "normal", "baixa"].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
              <label className="space-y-1"><span className="text-[11px] text-muted">Venciment</span><input type="date" className="input h-9" disabled={busy} value={t.due_at?.slice(0, 10) ?? ""} onChange={(e) => void patch({ due_at: e.target.value || null })} /></label>
              <label className="space-y-1"><span className="text-[11px] text-muted">Responsable</span>
                {canAssign ? <select className="input h-9" disabled={busy} value={t.assigned_to ?? ""} onChange={(e) => void patch({ assigned_to: e.target.value || null })}><option value="">Sense assignar</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <p className="flex h-9 items-center gap-1.5"><Avatar name={t.assigned_name} size={20} />{t.assigned_name ?? "Sense assignar"}</p>}
              </label>
            </div>
            {t.status === "bloquejada" && t.blocked_reason && <Notice tone="red">Bloquejada: {t.blocked_reason}</Notice>}
            {t.escalation_level > 0 && <Notice tone="amber">Tasca escalada {t.escalation_level === 2 ? "a Direcció" : "a la Cap administrativa"} per retard.</Notice>}
            <div className="flex flex-wrap gap-1.5 text-[12px]">
              {t.client_id && <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:text-brand" onClick={link("client", { id: t.client_id })}>Client: {t.crm_clients?.name} <ExternalLink size={11} /></button>}
              {t.expedient_id && <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:text-brand" onClick={link("expedient", { id: t.expedient_id })}>Expedient {t.crm_expedients?.code} <ExternalLink size={11} /></button>}
              {t.lead_id && <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:text-brand" onClick={link("leads", { id: t.lead_id })}>Lead: {t.crm_leads?.name} <ExternalLink size={11} /></button>}
              {t.opportunity_id && <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:text-brand" onClick={link("oportunitat", { id: t.opportunity_id })}>Oportunitat <ExternalLink size={11} /></button>}
              {t.incident_id && <button className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:text-brand" onClick={link("incidencies", { id: t.incident_id })}>Incidència <ExternalLink size={11} /></button>}
              {t.partner_visible && <Pill className="bg-violet-500/12 text-violet-700">Visible per al col·laborador</Pill>}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Historial</p>
              <ol className="space-y-1.5 border-l border-line pl-3">
                {d.events.map((e) => (
                  <li key={e.id} className="text-[12px]"><span className="font-medium">{EV[e.type] ?? e.type}</span>{e.type === "comentari" ? <span className="block whitespace-pre-wrap rounded-lg bg-elevated px-2 py-1">{e.note}</span> : e.type === "estat" || e.type === "bloqueig" ? <> · {TASK_STATUS_LABEL[e.from_value ?? ""] ?? e.from_value} → <b>{TASK_STATUS_LABEL[e.to_value ?? ""] ?? e.to_value}</b>{e.note ? ` (${e.note})` : ""}</> : e.type === "venciment" ? <> · {fdate(e.from_value)} → {fdate(e.to_value)}</> : e.from_value || e.to_value ? <> · {e.from_value ?? "—"} → <b>{e.to_value ?? "—"}</b></> : null}<span className="block text-[11px] text-muted">{e.user_name ?? "Sistema"} · {fdt(e.at)}</span></li>
                ))}
              </ol>
              <form className="mt-2 flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await api.workAct("task_comment", { id, note }); setNote(""); void load(); }}>
                <input className="input h-9 flex-1 text-[12.5px]" placeholder="Afegeix un comentari…" aria-label="Comentari" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" type="submit"><MessageSquare size={13} /></Button>
              </form>
            </div>
            <p className="text-[11px] text-muted">Creada el {fdt(t.created_at)}{t.completed_at ? ` · finalitzada el ${fdt(t.completed_at)}` : ""}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Crear / assignar una tasca (també des dels panells). */
export function TaskQuickCreate({ open, onClose, onDone, people, area, preset }: { open: boolean; onClose: () => void; onDone: () => void; people: { id: string; name: string }[]; area?: string; preset?: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    try {
      await api.workAct("task_create", { data: { title: String(f.get("title") ?? ""), notes: String(f.get("notes") ?? "") || null, due_at: String(f.get("due") ?? "") || null, priority: String(f.get("priority") ?? "normal"), kind: String(f.get("kind") ?? "altres"), area: String(f.get("area") ?? "") || null, assigned_to: String(f.get("assignee") ?? "") || null, ...(preset ?? {}) } });
      onDone(); onClose();
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={<span className="flex items-center gap-2"><UserPlus size={15} /> Nova tasca</span>}>
      <form onSubmit={submit} className="space-y-3 text-[13px]">
        {err && <Notice tone="red">{err}</Notice>}
        <input name="title" required maxLength={200} className="input" placeholder="Què cal fer?" aria-label="Títol" autoFocus />
        <textarea name="notes" className="input min-h-[70px]" placeholder="Descripció (opcional)" aria-label="Descripció" />
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-[11px] text-muted">Venciment</span><input name="due" type="date" className="input h-9" /></label>
          <label className="space-y-1"><span className="text-[11px] text-muted">Prioritat</span><select name="priority" className="input h-9" defaultValue="normal">{["urgent", "alta", "normal", "baixa"].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
          <label className="space-y-1"><span className="text-[11px] text-muted">Tipus</span><select name="kind" className="input h-9" defaultValue={area === "administrativa" ? "tramitacio" : "altres"}>{Object.entries(KIND_LABEL).filter(([k]) => k !== "sollicitud_externa").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="space-y-1"><span className="text-[11px] text-muted">Àrea</span><select name="area" className="input h-9" defaultValue={area ?? ""}><option value="">—</option>{Object.entries(AREA_LABEL).filter(([k]) => k !== "externa").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        {people.length > 0 && <label className="block space-y-1"><span className="text-[11px] text-muted">Responsable</span><select name="assignee" className="input h-9" defaultValue=""><option value="">Jo mateix/a</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel·la</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Crea la tasca</Button></div>
      </form>
    </Modal>
  );
}
