"use client";
/**
 * CENTRE DE CONTROL DE DIRECCIÓ (Fase 7). Mateixos indicadors per a totes les persones de Direcció; cada una
 * personalitza el seu panell (ordre, mida, widgets, període, filtres desats) i es guarda per identificador d'usuari.
 * Totes les xifres surten de Supabase amb les definicions documentades (botó «Definicions»).
 */
import { AgendaSummaryCard } from "../agenda/Summary";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BookOpen, Check, Filter, Gauge, GripVertical, LayoutTemplate, Plus, RefreshCw, RotateCcw, Save, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import { KPI, PERIOD_LABEL, WIDGET, WIDGETS, type KpiDef, type Layout } from "@/core/control";
import { useApp, type View } from "@/data/store";
import { Button, Modal, Notice, cn } from "../../components/ui";
import { Panel, PageHead, Skeleton, Stat, api, eur, fdate, fmtUnit, num } from "./shared";

type Data = {
  range: { from: string; to: string }; kpis: Record<string, number | null>; economic: boolean; definitions: KpiDef[];
  series: { commercial: { month: string; contractes: number; mwh: number; leads: number; propostes: number }[]; economic: { month: string; estimat: number; meritat: number; confirmat: number; cobrat: number; comissions: number }[] | null };
  team: { id: string; name: string; role: string; contractes_introduits: number; contractes_activats: number; tasques_finalitzades: number; tasques_pendents: number; incidencies_resoltes: number; leads_treballats: number; propostes_enviades: number }[];
  workload: { id: string; name: string; role: string; open: number; overdue: number; blocked: number; urgent: number }[];
  byCommercial: { id: string; name: string; contracts: number; mwh: number; leads: number; proposals: number; won: number }[];
  collaborators: { id: string; name: string; leads: number; inProgress: number; activated: number }[];
  objectives: { user_id: string; name: string; metric: string; target: number; actual: number | null }[];
  ai: { id: string; title: string; kind: string; score: number }[];
  alerts: { id: string; kind: string; title: string; body: string | null; created_at: string; link: { view: View; params: Record<string, string> } | null }[];
  renewals: { id: string; client_id: string; retailer: string; end_date: string; owner: string | null }[];
  funnel: { stage: string; count: number }[];
  options: { owners: { id: string; name: string }[]; responsibles: { id: string; name: string }[]; retailers: string[]; products: string[] };
  templates: { id: string; label: string; help: string }[];
};
const ROLE: Record<string, string> = { admin: "Direcció", cap_administrativa: "Cap administrativa", cap_equip: "Cap d'equip", administrativa: "Administrativa", comercial: "Comercial" };
const METRIC: Record<string, string> = { guanyades: "Oportunitats guanyades", mwh: "MWh", oportunitats: "Oportunitats noves", comissio: "Comissió" };
const STAGE: Record<string, string> = { nou: "Nou", contactat: "Contactat", qualificat: "Qualificat", proposta_enviada: "Proposta enviada", negociacio: "Negociació" };
const SPAN: Record<number, string> = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-2 lg:col-span-3", 4: "col-span-2 lg:col-span-4" };
const KPI_LINK: Record<string, [View, Record<string, string>]> = {
  tramitacio: ["tramitacions", {}], expedients_pendents: ["tramitacions", {}], documentacio_incompleta: ["tramitacions", {}], bloquejats: ["panell-cap", {}], activats: ["contractacio", {}],
  renovacions_urgents: ["kanban", {}], renovacions_120: ["kanban", {}], incidencies_obertes: ["incidencies", {}], incidencies_urgents: ["incidencies", {}],
  tasques_vencudes: ["tasques", { scope: "totes", status: "vencudes" }], tasques_pendents: ["tasques", { scope: "totes" }], tasques_bloquejades: ["tasques", { scope: "totes", status: "bloquejades" }],
  leads: ["leads", {}], oportunitats: ["pipeline", {}], propostes: ["pipeline", {}], ia_oportunitats: ["ia", {}],
  comissions_previstes: ["economia", {}], comissions_meritades: ["economia", {}], comissions_confirmades: ["economia", {}], comissions_cobrades: ["economia", {}], pendent_cobrar: ["economia", {}], liquidacions_pendents: ["liquidacions", {}], pagaments: ["liquidacions", {}], marge_previst: ["economia", { tab: "rendibilitat" }], marge_realitzat: ["economia", { tab: "rendibilitat" }], rendibilitat: ["economia", { tab: "rendibilitat" }],
};

export function ControlCenterView() {
  const go = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [saved, setSaved] = useState<Layout | null>(null);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [defs, setDefs] = useState(false);
  const [filters, setFilters] = useState(false);

  useEffect(() => {
    api.control<{ layout: Layout }>("layout").then((r) => { setLayout(r.layout); setSaved(r.layout); }).catch((e) => setErr(e.message));
  }, []);
  const q = useMemo(() => layout && ({ period: layout.period, from: layout.period === "personalitzat" ? layout.from : undefined, to: layout.period === "personalitzat" ? layout.to : undefined, ...layout.filters }), [layout]);
  const load = useCallback(async () => {
    if (!q) return;
    setBusy(true);
    try { setD(await api.control<Data>("control", q)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  const dirty = JSON.stringify(layout) !== JSON.stringify(saved);
  const persist = async (l = layout) => {
    if (!l) return;
    try { const r = await api.controlAct<{ layout: Layout }>("layout_save", { layout: l }); setLayout(r.layout); setSaved(r.layout); toast({ title: "Panell desat", body: "Només s'ha canviat el teu panell.", tone: "ok" }); }
    catch (e) { toast({ title: "No s'ha pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const reset = async (template: string) => {
    if (!confirm("Vols restaurar aquest panell predeterminat? Es perdrà la teva personalització actual.")) return;
    try { const r = await api.controlAct<{ layout: Layout }>("layout_reset", { template }); setLayout(r.layout); setSaved(r.layout); toast({ title: "Panell restaurat", tone: "ok" }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!layout || !e.over || e.active.id === e.over.id) return;
    const ids = layout.widgets.map((w) => w.id);
    setLayout({ ...layout, widgets: arrayMove(layout.widgets, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))) });
  };
  const setW = (id: string, patch: Partial<{ size: 1 | 2 | 3 | 4 }> | null) => layout && setLayout({ ...layout, widgets: patch === null ? layout.widgets.filter((w) => w.id !== id) : layout.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const add = (id: string) => layout && setLayout({ ...layout, widgets: [...layout.widgets, { id, size: WIDGET[id].defaultSize }] });

  if (err && !d) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="red">{err}</Notice><div className="mt-4"><AgendaSummaryCard /></div></div>;
  if (!layout) return <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6"><Skeleton /></div>;
  const f = layout.filters;
  const nf = Object.values(f).filter(Boolean).length;
  const available = WIDGETS.filter((w) => !layout.widgets.some((x) => x.id === w.id) && (!w.economic || d?.economic));

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<Gauge size={16} />} title="Centre de Control" sub={d ? `Dades reals de Supabase · ${fdate(d.range.from)} – ${fdate(d.range.to)}${d.economic ? "" : " · sense indicadors econòmics (cal autorització)"}` : "Carregant…"}>
        <Button size="sm" variant="ghost" onClick={() => setDefs(true)}><BookOpen size={13} /> Definicions</Button>
        <Button size="sm" onClick={() => void load()} disabled={busy}><RefreshCw size={13} className={cn(busy && "animate-spin")} /> Actualitza</Button>
        <Button size="sm" variant={edit ? "primary" : "secondary"} onClick={() => setEdit(!edit)}><SlidersHorizontal size={13} /> {edit ? "Acaba" : "Personalitza"}</Button>
      </PageHead>
      <AgendaSummaryCard />

      {/* període i filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line bg-surface p-0.5" role="tablist" aria-label="Període">
          {(["avui", "setmana", "mes", "trimestre", "any", "personalitzat"] as const).map((p) => (
            <button key={p} role="tab" aria-selected={layout.period === p} onClick={() => setLayout({ ...layout, period: p })} className={cn("rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium", layout.period === p ? "bg-ink text-surface" : "text-muted hover:text-ink")}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
        {layout.period === "personalitzat" && (
          <>
            <input type="date" aria-label="Des de" className="input h-9 w-auto text-[12.5px]" value={layout.from ?? ""} onChange={(e) => setLayout({ ...layout, from: e.target.value })} />
            <input type="date" aria-label="Fins a" className="input h-9 w-auto text-[12.5px]" value={layout.to ?? ""} onChange={(e) => setLayout({ ...layout, to: e.target.value })} />
          </>
        )}
        <button onClick={() => setFilters(!filters)} className={cn("pressable flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px]", filters || nf ? "border-brand/60 text-brand" : "border-line text-muted")}><Filter size={13} /> Filtres{nf ? ` (${nf})` : ""}</button>
        {layout.saved.map((s) => (
          <span key={s.name} className="inline-flex items-center rounded-xl border border-line bg-surface text-[12px]">
            <button className="flex items-center gap-1 px-2.5 py-1.5 hover:text-brand" onClick={() => setLayout({ ...layout, period: s.period as Layout["period"], from: s.from, to: s.to, filters: s.filters })}><Star size={11} /> {s.name}</button>
            {edit && <button aria-label={`Elimina ${s.name}`} className="pr-2 text-muted hover:text-red-600" onClick={() => setLayout({ ...layout, saved: layout.saved.filter((x) => x.name !== s.name) })}><X size={11} /></button>}
          </span>
        ))}
        {dirty && <Button size="sm" variant="primary" className="ml-auto" onClick={() => void persist()}><Save size={13} /> Desa el meu panell</Button>}
      </div>
      {filters && d && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2.5">
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Comercial" value={f.owner ?? ""} onChange={(e) => setLayout({ ...layout, filters: { ...f, owner: e.target.value || undefined } })}><option value="">Tots els comercials</option>{d.options.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Comercialitzadora" value={f.retailer ?? ""} onChange={(e) => setLayout({ ...layout, filters: { ...f, retailer: e.target.value || undefined } })}><option value="">Totes les comercialitzadores</option>{d.options.retailers.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Producte" value={f.product ?? ""} onChange={(e) => setLayout({ ...layout, filters: { ...f, product: e.target.value || undefined } })}><option value="">Tots els productes</option>{d.options.products.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Responsable" value={f.responsible ?? ""} onChange={(e) => setLayout({ ...layout, filters: { ...f, responsible: e.target.value || undefined } })}><option value="">Tots els responsables</option>{d.options.responsibles.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          {nf > 0 && <button className="flex items-center gap-1 text-[12px] text-muted" onClick={() => setLayout({ ...layout, filters: {} })}><X size={12} /> Neteja</button>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { const name = prompt("Nom per a aquests filtres (p. ex. «Nufri aquest mes»)")?.trim(); if (name) setLayout({ ...layout, saved: [...layout.saved.filter((x) => x.name !== name), { name: name.slice(0, 60), period: layout.period, from: layout.from, to: layout.to, filters: Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string> }].slice(-20) }); }}><Star size={13} /> Desa els filtres</Button>
        </div>
      )}

      {edit && (
        <div className="space-y-2 rounded-2xl border border-dashed border-brand/50 bg-brand/[0.03] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-medium">Mode personalització:</span><span className="text-muted">arrossega els blocs per moure&apos;ls, canvia&apos;n la mida o treu-los. Els canvis només afecten el teu panell.</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {d?.templates.map((t) => <Button key={t.id} size="sm" variant="ghost" title={t.help} onClick={() => void reset(t.id)}><LayoutTemplate size={13} /> {t.label}</Button>)}
              <Button size="sm" variant="ghost" onClick={() => setLayout(saved)} disabled={!dirty}><RotateCcw size={13} /> Descarta</Button>
            </div>
          </div>
          {available.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {available.map((w) => <button key={w.id} onClick={() => add(w.id)} className="pressable inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[11.5px] hover:border-brand/60 hover:text-brand"><Plus size={11} /> {w.label}</button>)}
            </div>
          )}
        </div>
      )}
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <Skeleton /> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={layout.widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-flow-dense grid-cols-2 gap-3 lg:grid-cols-4">
              {layout.widgets.map((w) => (
                <Sortable key={w.id} id={w.id} size={w.size} edit={edit} onSize={(size) => setW(w.id, { size })} onRemove={() => setW(w.id, null)}>
                  <Widget id={w.id} d={d} go={go} />
                </Sortable>
              ))}
              {!layout.widgets.length && <div className="col-span-2 lg:col-span-4"><Notice tone="blue">El teu panell és buit. Prem «Personalitza» per afegir-hi indicadors o restaura un panell predeterminat.</Notice></div>}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Modal open={defs} onClose={() => setDefs(false)} title="Definicions dels indicadors" width="max-w-3xl">
        <p className="mb-3 text-[12.5px] text-muted">Cada indicador té una sola definició i es calcula igual a totes les pantalles (Centre de Control, panells, informes i mòduls d&apos;origen).</p>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {(["comercial", "administratiu", "economic"] as const).map((g) => (
            <div key={g}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g === "comercial" ? "Comercials" : g === "administratiu" ? "Administratius" : "Econòmics"}</p>
              <dl className="divide-y divide-line rounded-xl border border-line">
                {(d?.definitions ?? []).filter((k) => k.group === g).map((k) => <div key={k.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[200px_1fr]"><dt className="text-[12.5px] font-medium">{k.label}</dt><dd className="text-[12px] text-muted">{k.def} <span className="text-muted/70">· Font: {k.source}</span></dd></div>)}
              </dl>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function Sortable({ id, size, edit, onSize, onRemove, children }: { id: string; size: number; edit: boolean; onSize: (s: 1 | 2 | 3 | 4) => void; onRemove: () => void; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !edit });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(SPAN[size], "relative min-w-0", isDragging && "z-10 opacity-80", edit && "rounded-2xl ring-1 ring-brand/30")} data-widget={id}>
      {edit && (
        <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-lift">
          <button aria-label="Arrossega" className="cursor-grab rounded p-1 text-muted hover:text-ink active:cursor-grabbing" {...attributes} {...listeners}><GripVertical size={12} /></button>
          {([1, 2, 3, 4] as const).map((s) => <button key={s} aria-label={`Mida ${s}`} onClick={() => onSize(s)} className={cn("rounded px-1.5 text-[10.5px] font-semibold", size === s ? "bg-ink text-surface" : "text-muted hover:text-ink")}>{s}</button>)}
          <button aria-label="Treu el bloc" onClick={onRemove} className="rounded p-1 text-muted hover:text-red-600"><Trash2 size={12} /></button>
        </div>
      )}
      <div className={cn("h-full", edit && "pointer-events-none select-none")}>{children}</div>
    </div>
  );
}

function Widget({ id, d, go }: { id: string; d: Data; go: (v: View, p?: Record<string, string>) => void }) {
  const w = WIDGET[id];
  if (!w) return null;
  if (w.kind === "kpi") {
    const k = KPI[w.kpi!];
    const v = d.kpis[k.id];
    const link = KPI_LINK[k.id];
    const tone = (["tasques_vencudes", "bloquejats", "incidencies_urgents"].includes(k.id) && (v ?? 0) > 0) ? "red" : (["renovacions_urgents", "documentacio_incompleta"].includes(k.id) && (v ?? 0) > 0) ? "amber" : undefined;
    return <Stat label={k.label} value={fmtUnit(v, k.unit)} hint={k.def} tone={tone} onClick={link ? () => go(link[0], link[1]) : undefined} sub={k.id === "mwh" && (d.kpis.mwh_sense_consum ?? 0) > 0 ? `${d.kpis.mwh_sense_consum} contractes sense consum informat` : k.economic && k.id === "comissions_previstes" ? "Previsió, no confirmat" : undefined} />;
  }
  if (w.kind === "serie_comercial") return (
    <Panel title="Evolució comercial (12 mesos)" className="h-full">
      <div className="h-56"><ResponsiveContainer><ComposedChart data={d.series.commercial} margin={{ left: -18, right: 4, top: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} /><XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} fontSize={11} /><YAxis yAxisId="a" fontSize={11} allowDecimals={false} /><YAxis yAxisId="b" orientation="right" fontSize={11} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar yAxisId="a" dataKey="contractes" name="Contractes" fill="rgb(var(--brand))" radius={[4, 4, 0, 0]} /><Line yAxisId="b" dataKey="mwh" name="MWh" stroke="#f59e0b" strokeWidth={2} dot={false} /><Line yAxisId="a" dataKey="propostes" name="Propostes" stroke="#6366f1" strokeWidth={1.5} dot={false} /></ComposedChart></ResponsiveContainer></div>
    </Panel>
  );
  if (w.kind === "serie_economica") return (
    <Panel title="Evolució de comissions (12 mesos)" className="h-full" empty={!d.series.economic ? "Sense accés a dades econòmiques" : false}>
      <div className="h-56"><ResponsiveContainer><AreaChart data={d.series.economic ?? []} margin={{ left: -6, right: 4, top: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} /><XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} fontSize={11} /><YAxis fontSize={11} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} /><Tooltip formatter={(v) => eur(Number(v))} /><Legend wrapperStyle={{ fontSize: 11 }} /><Area dataKey="meritat" name="Meritat" stroke="#0ea5e9" fill="#0ea5e922" /><Area dataKey="cobrat" name="Cobrat" stroke="rgb(var(--brand))" fill="rgb(var(--brand) / 0.15)" /><Area dataKey="estimat" name="Previst" stroke="#a1a1aa" fill="none" strokeDasharray="4 3" /></AreaChart></ResponsiveContainer></div>
    </Panel>
  );
  if (w.kind === "equip") return (
    <Panel title="Activitat de l'equip (període)" className="h-full" empty={!d.team.length && "Sense persones a l'equip"}>
      <div className="-mx-1 overflow-x-auto"><table className="w-full text-[12px]"><thead className="text-left text-[11px] text-muted"><tr><th className="px-1 py-1 font-medium">Persona</th><th className="px-1 text-right font-medium">Contractes</th><th className="px-1 text-right font-medium">Tasques fetes</th><th className="px-1 text-right font-medium">Pendents</th><th className="px-1 text-right font-medium">Incidències</th><th className="px-1 text-right font-medium">Propostes</th></tr></thead>
        <tbody>{d.team.map((p) => <tr key={p.id} className="border-t border-line"><td className="px-1 py-1.5"><span className="font-medium">{p.name}</span> <span className="text-muted">· {ROLE[p.role] ?? p.role}</span></td><td className="px-1 text-right tnum">{p.contractes_introduits}</td><td className="px-1 text-right tnum">{p.tasques_finalitzades}</td><td className="px-1 text-right tnum">{p.tasques_pendents}</td><td className="px-1 text-right tnum">{p.incidencies_resoltes}</td><td className="px-1 text-right tnum">{p.propostes_enviades}</td></tr>)}</tbody></table></div>
      {d.byCommercial.length > 0 && <div className="mt-3 border-t border-line pt-2"><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Per comercial</p>{d.byCommercial.map((c) => <div key={c.id} className="flex items-center justify-between py-0.5 text-[12px]"><span>{c.name}</span><span className="tnum text-muted">{c.contracts} contractes · {num(c.mwh, 1)} MWh · {c.won} guanyades · {c.leads} leads</span></div>)}</div>}
    </Panel>
  );
  if (w.kind === "collaboradors") return (
    <Panel title="Resultats de col·laboradors" className="h-full" empty={!d.collaborators.length && "Cap col·laborador amb operacions"}>
      <div className="space-y-1">{d.collaborators.map((c) => <div key={c.id} className="flex items-center justify-between rounded-lg px-1 py-1 text-[12.5px] hover:bg-ink/[0.03]"><span className="truncate font-medium">{c.name}</span><span className="tnum text-[12px] text-muted">{c.leads} leads · {c.inProgress} en curs · <b className="text-ink">{c.activated}</b> activats</span></div>)}</div>
    </Panel>
  );
  if (w.kind === "alertes") return (
    <Panel title="Alertes operatives" className="h-full" empty={!d.alerts.length && "Cap alerta pendent"}>
      <ul className="space-y-1">{d.alerts.slice(0, 8).map((a) => <li key={a.id}><button onClick={() => a.link && go(a.link.view, a.link.params)} className="w-full rounded-lg px-1.5 py-1 text-left hover:bg-ink/[0.04]"><p className={cn("truncate text-[12.5px] font-medium", a.kind === "escalat" && "text-red-600 dark:text-red-400")}>{a.title}</p>{a.body && <p className="truncate text-[11.5px] text-muted">{a.body}</p>}</button></li>)}</ul>
    </Panel>
  );
  if (w.kind === "tasques_equip") {
    const max = Math.max(1, ...d.workload.map((x) => x.open));
    return (
      <Panel title="Càrrega de treball" className="h-full" empty={!d.workload.length && "Sense tasques obertes"} action={<button className="text-[12px] text-brand" onClick={() => go("tasques", { scope: "totes" })}>Tasques</button>}>
        <div className="space-y-2">{d.workload.map((x) => <div key={x.id}><div className="mb-0.5 flex justify-between text-[12px]"><span className="font-medium">{x.name}</span><span className="tnum text-muted">{x.open} obertes{x.overdue ? <b className="text-red-600"> · {x.overdue} vençudes</b> : ""}{x.blocked ? ` · ${x.blocked} bloquejades` : ""}</span></div><div className="flex h-2 overflow-hidden rounded-full bg-ink/[0.06]"><div className="bg-red-500" style={{ width: `${(x.overdue / max) * 100}%` }} /><div className="bg-brand" style={{ width: `${((x.open - x.overdue) / max) * 100}%` }} /></div></div>)}</div>
      </Panel>
    );
  }
  if (w.kind === "objectius") return (
    <Panel title="Objectius comercials del mes" className="h-full" empty={!d.objectives.length && "No hi ha objectius definits per a aquest mes (Rendiment → Objectius)"}>
      <div className="space-y-2">{d.objectives.map((o) => { const pct = o.actual == null || !o.target ? 0 : Math.min(100, (o.actual / o.target) * 100); return <div key={`${o.user_id}-${o.metric}`}><div className="mb-0.5 flex justify-between text-[12px]"><span><b>{o.name}</b> · {METRIC[o.metric] ?? o.metric}</span><span className="tnum text-muted">{o.actual == null ? "—" : num(o.actual, 1)} / {num(o.target, 1)}</span></div><div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-brand")} style={{ width: `${pct}%` }} /></div></div>; })}</div>
    </Panel>
  );
  if (w.kind === "ia") return (
    <Panel title="Oportunitats detectades per la IA" className="h-full" empty={!d.ai.length && "Cap oportunitat nova pendent de revisar"} action={<button className="text-[12px] text-brand" onClick={() => go("ia")}>Obre</button>}>
      <ul className="space-y-1">{d.ai.map((a) => <li key={a.id}><button onClick={() => go("ia-oportunitat", { id: a.id })} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-ink/[0.04]"><span className="grid h-7 w-9 shrink-0 place-items-center rounded-md bg-brand/10 text-[11.5px] font-semibold text-brand tnum">{a.score}</span><span className="truncate text-[12.5px]">{a.title}</span></button></li>)}</ul>
    </Panel>
  );
  if (w.kind === "embut") {
    const max = Math.max(1, ...d.funnel.map((x) => x.count));
    return <Panel title="Embut comercial (obertes)" className="h-full"><div className="space-y-1.5">{d.funnel.map((x) => <div key={x.stage} className="flex items-center gap-2 text-[12px]"><span className="w-28 shrink-0 text-muted">{STAGE[x.stage]}</span><div className="h-5 flex-1 overflow-hidden rounded-md bg-ink/[0.05]"><div className="h-full rounded-md bg-brand/70" style={{ width: `${(x.count / max) * 100}%` }} /></div><span className="w-8 text-right tnum">{x.count}</span></div>)}</div></Panel>;
  }
  if (w.kind === "renovacions") return (
    <Panel title="Renovacions (120 dies)" className="h-full" empty={!d.renewals.length && "Cap venciment en els propers 120 dies"} action={<button className="text-[12px] text-brand" onClick={() => go("kanban")}>Kanban</button>}>
      <ul className="divide-y divide-line">{d.renewals.map((r) => <li key={r.id}><button onClick={() => go("client", { id: r.client_id, tab: "contractes" })} className="flex w-full items-center justify-between py-1.5 text-left text-[12.5px] hover:text-brand"><span className="truncate">{r.retailer}{r.owner ? <span className="text-muted"> · {r.owner}</span> : null}</span><span className="tnum text-muted">{fdate(r.end_date)}</span></button></li>)}</ul>
    </Panel>
  );
  if (w.kind === "qualitat") return <QualityWidget go={go} />;
  return null;
}

function QualityWidget({ go }: { go: (v: View, p?: Record<string, string>) => void }) {
  const [q, setQ] = useState<{ open: number; issues: { kind: string; severity: string; review: unknown }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.control<typeof q>("qualitat").then(setQ).catch((e) => setErr(e.message)); }, []);
  const by: Record<string, number> = {};
  for (const i of q?.issues ?? []) if (!i.review) by[i.kind] = (by[i.kind] ?? 0) + 1;
  return (
    <Panel title="Qualitat de dades" className="h-full" action={<button className="text-[12px] text-brand" onClick={() => go("qualitat")}>Revisa</button>}>
      {err ? <p className="text-[12px] text-muted">{err}</p> : !q ? <div className="h-16 animate-pulse rounded-xl bg-elevated" /> : (
        <>
          <p className="text-[22px] font-semibold tnum">{q.open} <span className="text-[12.5px] font-normal text-muted">problemes pendents de revisar</span></p>
          <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(by).map(([k, n]) => <span key={k} className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-[11.5px]">{k.replace(/_/g, " ")}: <b>{n}</b></span>)}{!Object.keys(by).length && <span className="flex items-center gap-1 text-[12px] text-emerald-600"><Check size={13} /> Tot revisat</span>}</div>
        </>
      )}
    </Panel>
  );
}
