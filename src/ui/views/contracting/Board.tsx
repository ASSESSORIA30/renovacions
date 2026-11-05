"use client";
/** KANBAN DE TRAMITACIONS: expedients de contractació. Les transicions es validen abans de moure (i a la base de dades). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CalendarClock, Clock, FileStack, Filter, Lock, Plus, Search, X } from "lucide-react";
import { EXP_STATUSES, EXP_STATUS_COLOR, EXP_STATUS_LABEL, SALES_STATUSES, allowedTransitions, needsJustification, type ExpStatus } from "@/core/contracting";
import { PRIORITIES, PRIORITY_LABEL } from "@/core/crm";
import { SERVICES, SERVICE_LABEL } from "@/core/sales";
import { isStaff } from "@/core/roles";
import { useApp } from "@/data/store";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";
import { Badge, Button, Empty, Notice, cn } from "../../components/ui";
import { Avatar, ServiceChip, useFacets } from "../sales/shared";
import { cApi, type ExpRow } from "./api";
import { ActivationDialog, DocMeter, MoveDialog, NewExpedientWizard } from "./shared";
import { ExportButton } from "../../components/ExportButton";

type F = { q: string; owner: string; service: string; retailer: string; priority: string; province: string };
const EMPTY: F = { q: "", owner: "", service: "", retailer: "", priority: "", province: "" };

export function BoardView() {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const facets = useFacets();
  const [f, setF] = useState<F>(() => { try { return { ...EMPTY, ...JSON.parse(sessionStorage.getItem("a30.tramitacions") ?? "{}") }; } catch { return EMPTY; } });
  const [rows, setRows] = useState<ExpRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ExpRow | null>(null);
  const [dialog, setDialog] = useState<{ e: ExpRow; to: ExpStatus } | null>(null);
  const [activate, setActivate] = useState<ExpRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [more, setMore] = useState(false);
  const toast = useApp((s) => s.toast);
  const busy = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor));

  const load = useCallback(async () => {
    try { const r = await cApi.list({ owner: f.owner, service: f.service, priority: f.priority }); setRows(r.rows); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [f.owner, f.service, f.priority]);
  useEffect(() => { try { sessionStorage.setItem("a30.tramitacions", JSON.stringify(f)); } catch { /* */ } }, [f]);
  useEffect(() => { if (supabaseConfigured) void load(); }, [load]);
  useEffect(() => {
    if (!supabaseConfigured) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => { if (!busy.current) void load(); }, 400); };
    const ch = browserSupabase().channel("crm-expedients").on("postgres_changes", { event: "*", schema: "public", table: "crm_expedients" }, refresh).subscribe();
    const iv = setInterval(refresh, 60_000);
    return () => { clearInterval(iv); if (t) clearTimeout(t); void browserSupabase().removeChannel(ch); };
  }, [load]);

  const shown = useMemo(() => {
    const s = f.q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!s || [r.code, r.client_name, r.client_tax_id, r.retailer, r.product, r.cups, r.external_ref].some((x) => x?.toLowerCase().includes(s)))
      && (!f.retailer || r.retailer === f.retailer) && (!f.province || r.province === f.province));
  }, [rows, f.q, f.retailer, f.province]);
  const cols = useMemo(() => Object.fromEntries(EXP_STATUSES.map((s) => [s, shown.filter((r) => r.status === s)])) as Record<ExpStatus, ExpRow[]>, [shown]);
  const retailers = useMemo(() => [...new Set((rows ?? []).map((r) => r.retailer))].sort(), [rows]);
  const provinces = useMemo(() => [...new Set((rows ?? []).map((r) => r.province).filter(Boolean))].sort() as string[], [rows]);
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || isStaff(u.role as never));
  const activeFilters = (Object.keys(EMPTY) as (keyof F)[]).filter((k) => k !== "q" && f[k]).length;

  /** Valida la transició abans d'obrir cap diàleg (la base de dades ho torna a comprovar). */
  const tryMove = (e: ExpRow, to: ExpStatus) => {
    if (e.status === to) return;
    if (!allowedTransitions(e.status).includes(to)) { toast({ title: "Transició no permesa", body: `De «${EXP_STATUS_LABEL[e.status]}» no es pot passar a «${EXP_STATUS_LABEL[to]}».`, tone: "err" }); return; }
    if (!staff && !(SALES_STATUSES.includes(to) && SALES_STATUSES.includes(e.status))) { toast({ title: "Només Administració", body: `La tramitació a partir de «${EXP_STATUS_LABEL[to]}» la gestiona Administració.`, tone: "err" }); return; }
    if (to === "documentacio_completa" && e.docs.pending + e.docs.rejected > 0) { toast({ title: "Falta documentació obligatòria", body: `${e.docs.pending} document(s) pendent(s). Obre l'expedient per completar-los.`, tone: "err" }); return; }
    if (to === "activat") { setActivate(e); return; }
    if (needsJustification(e.status, to) || to === "enviat" || to === "rebutjat" || to === "signat") { setDialog({ e, to }); return; }
    void quickMove(e, to);
  };
  const quickMove = async (e: ExpRow, to: ExpStatus) => {
    const prev = rows;
    busy.current = true;
    setRows((r) => (r ?? []).map((x) => (x.id === e.id ? { ...x, status: to, days_in_status: 0 } : x)));
    try {
      const r = await cApi.act<{ version: number; status: ExpStatus }>("move", { id: e.id, data: { status: to, version: e.version } });
      setRows((rs) => (rs ?? []).map((x) => (x.id === e.id ? { ...x, version: r.version, status: r.status } : x)));
    } catch (err) {
      setRows(prev);
      toast({ title: "No s'ha pogut moure", body: err instanceof Error ? err.message : String(err), tone: "err" });
      void load();
    } finally { busy.current = false; }
  };
  const onEnd = (ev: DragEndEvent) => {
    const e = rows?.find((x) => x.id === ev.active.id);
    setActive(null);
    const to = ev.over?.id as ExpStatus | undefined;
    if (e && to) tryMove(e, to);
  };

  if (!supabaseConfigured) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<FileStack size={26} />} title="La contractació necessita la base de dades" body="Aquest desplegament no té Supabase configurat." /></div>;

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Tramitacions</h2>
          <p className="text-[13px] text-muted">{(() => { const n = shown.filter((r) => r.status !== "activat" && r.status !== "rebutjat").length; return `${n} ${n === 1 ? "expedient obert" : "expedients oberts"}`; })()} · arrossega per canviar d&apos;estat</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input h-9 w-60 pl-8" placeholder="Codi, client, NIF, CUPS, referència…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Cerca expedients" /></div>
          <button onClick={() => setMore(!more)} className={cn("pressable flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px]", more || activeFilters ? "border-brand/60 text-brand" : "border-line text-muted")}><Filter size={14} /> Filtres{activeFilters ? ` (${activeFilters})` : ""}</button>
          <ExportButton set="expedients" visible={shown.map((r) => r.id)} />
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> Nou expedient</Button>
        </div>
      </div>
      {more && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2.5">
          {staff && <select className="input h-9 w-auto text-[12.5px]" aria-label="Responsable" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}><option value="">Tots els responsables</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value="cap">Sense responsable</option></select>}
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Servei" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">Tots els serveis</option>{SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Comercialitzadora" value={f.retailer} onChange={(e) => setF({ ...f, retailer: e.target.value })}><option value="">Totes les comercialitzadores</option>{retailers.map((r) => <option key={r}>{r}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Província" value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}><option value="">Totes les províncies</option>{provinces.map((p) => <option key={p}>{p}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Prioritat" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">Totes les prioritats</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
          {activeFilters > 0 && <button className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" onClick={() => setF({ ...EMPTY, q: f.q })}><X size={13} /> Neteja</button>}
        </div>
      )}
      {error && <Notice tone="red">{error}</Notice>}
      {!rows && !error ? (
        <div className="flex gap-3 overflow-hidden">{EXP_STATUSES.slice(0, 6).map((s) => <div key={s} className="h-[60vh] w-72 shrink-0 animate-pulse rounded-2xl bg-elevated" />)}</div>
      ) : rows && rows.length === 0 ? (
        <Empty icon={<FileStack size={26} />} title="Encara no hi ha expedients" body="Obre un expedient des d'una oportunitat guanyada, des de la fitxa del client o amb el botó «Nou expedient»." action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={13} /> Nou expedient</Button>} />
      ) : (
        <DndContext sensors={sensors} onDragStart={(e) => setActive(rows!.find((x) => x.id === e.active.id) ?? null)} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
          <div className="scroll-thin -mx-1 flex min-h-0 flex-1 gap-3 overflow-x-auto px-1 pb-3">
            {EXP_STATUSES.map((s) => <Column key={s} status={s} items={cols[s]} dragging={active} staff={staff} />)}
          </div>
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}>{active && <Card e={active} overlay />}</DragOverlay>
        </DndContext>
      )}
      {dialog && <MoveDialog exp={dialog.e} to={dialog.to} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); }} />}
      {activate && <ActivationDialog exp={activate} onClose={() => setActivate(null)} onDone={() => { setActivate(null); void load(); }} />}
      {creating && <NewExpedientWizard onClose={() => setCreating(false)} />}
    </div>
  );
}

function Column({ status, items, dragging, staff }: { status: ExpStatus; items: ExpRow[]; dragging: ExpRow | null; staff: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const allowed = dragging ? allowedTransitions(dragging.status).includes(status) && (staff || (SALES_STATUSES.includes(status) && SALES_STATUSES.includes(dragging.status))) : true;
  const closed = status === "activat" || status === "rebutjat";
  return (
    <section ref={setNodeRef} aria-label={EXP_STATUS_LABEL[status]} className={cn("flex w-72 shrink-0 flex-col rounded-2xl border bg-elevated/50 transition-colors", closed && "w-64",
      dragging && dragging.status !== status ? (allowed ? (isOver ? "border-brand bg-brand/[0.05]" : "border-dashed border-brand/40") : "border-transparent opacity-50") : "border-transparent")}>
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: EXP_STATUS_COLOR[status] }} />
        <h3 className="text-[13px] font-semibold">{EXP_STATUS_LABEL[status]}</h3>
        <span className="rounded-full bg-ink/[0.06] px-1.5 text-[11px] text-muted tnum">{items.length}</span>
        {dragging && dragging.status !== status && !allowed && <Lock size={12} className="ml-auto text-muted" aria-label="No permès" />}
      </header>
      <div className="scroll-thin flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {items.map((e) => <Draggable key={e.id} e={e} />)}
        {!items.length && <p className="px-2 py-6 text-center text-[11.5px] text-muted">Cap expedient</p>}
      </div>
    </section>
  );
}

function Draggable({ e }: { e: ExpRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: e.id });
  return <div ref={setNodeRef} {...listeners} {...attributes} className={cn("touch-none", isDragging && "opacity-30")}><Card e={e} /></div>;
}

function Card({ e, overlay }: { e: ExpRow; overlay?: boolean }) {
  const closed = e.status === "activat" || e.status === "rebutjat";
  const next = e.next_action_at ? new Date(e.next_action_at) : null;
  const late = (next && next < new Date()) || (!!e.expected_activation_date && e.expected_activation_date < new Date().toISOString().slice(0, 10) && !closed);
  return (
    <article onClick={() => !overlay && useApp.getState().navigate("expedient", { id: e.id })}
      className={cn("cursor-pointer rounded-xl border border-line bg-surface p-3 shadow-card transition-shadow hover:border-ink/20", overlay && "rotate-[1.5deg] shadow-lift", e.priority === "alta" && !closed && "border-l-[3px] border-l-lost")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{e.client_name ?? "—"}</p>
          <p className="truncate text-[11.5px] text-muted"><span className="font-mono">{e.code}</span> · {e.retailer}</p>
        </div>
        <Avatar name={e.owner_name} size={22} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ServiceChip s={e.service} short />
        {e.priority === "alta" && !closed && <Badge tone="red">Alta</Badge>}
        {!e.owner_id && <Badge tone="amber">Sense responsable</Badge>}
      </div>
      {!closed && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
          <DocMeter p={e.docs} compact />
          <span className={cn("flex items-center gap-1", e.days_in_status >= 7 ? "font-medium text-pend" : "text-muted")} title="Dies en aquest estat"><Clock size={12} />{e.days_in_status} d</span>
        </div>
      )}
      {(e.next_action || late) && !closed && <p className={cn("mt-2 flex items-center gap-1 truncate border-t border-line pt-2 text-[11px]", late ? "font-medium text-lost" : "text-muted")}><CalendarClock size={12} className="shrink-0" />{e.next_action ?? "Activació prevista vençuda"}</p>}
      {e.status === "rebutjat" && e.rejection_reason && <p className="mt-1.5 truncate text-[11px] text-muted">{e.rejection_reason}</p>}
    </article>
  );
}
