"use client";
/** KANBAN COMERCIAL (captació): Nou lead → … → Guanyat / Perdut. Independent del Kanban de renovacions. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CalendarClock, Clock, Filter, Flame, Plus, Search, Trophy, X, XCircle, Zap } from "lucide-react";
import { PRIORITIES, PRIORITY_LABEL } from "@/core/crm";
import { LOST_REASONS, OPEN_STAGES, SERVICES, SERVICE_LABEL, STAGES, STAGE_COLOR, STAGE_LABEL, daysSince, type Stage } from "@/core/sales";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { salesApi, eur, mwh, type OppRow } from "./api";
import { Avatar, OppForm, ServiceChip, useFacets } from "./shared";
import { ExportButton } from "../../components/ExportButton";

type F = { q: string; owner: string; service: string; province: string; priority: string; stage: string };
const EMPTY: F = { q: "", owner: "", service: "", province: "", priority: "", stage: "" };

export function PipelineView() {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const facets = useFacets();
  const [f, setF] = useState<F>(() => { try { return { ...EMPTY, ...JSON.parse(sessionStorage.getItem("a30.pipeline") ?? "{}") }; } catch { return EMPTY; } });
  const [rows, setRows] = useState<OppRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<OppRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [lose, setLose] = useState<{ o: OppRow; position: number } | null>(null);
  const [won, setWon] = useState<OppRow | null>(null);
  const [more, setMore] = useState(false);
  const toast = useApp((s) => s.toast);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor));
  const busyMove = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await salesApi.opps({ owner: f.owner, service: f.service, priority: f.priority, province: f.province });
      setRows(r.rows);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [f.owner, f.service, f.priority, f.province]);
  useEffect(() => { try { sessionStorage.setItem("a30.pipeline", JSON.stringify(f)); } catch { /* */ } }, [f]);
  useEffect(() => { if (supabaseConfigured) void load(); }, [load]);

  // Coherència entre usuaris: canvis en temps real (Supabase Realtime, amb la RLS) i, com a reserva, actualització cada 60 s.
  useEffect(() => {
    if (!supabaseConfigured) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => { if (!busyMove.current) void load(); }, 400); };
    const ch = browserSupabase().channel("crm-opps").on("postgres_changes", { event: "*", schema: "public", table: "crm_opportunities" }, refresh).subscribe();
    const iv = setInterval(refresh, 60_000);
    return () => { clearInterval(iv); if (t) clearTimeout(t); void browserSupabase().removeChannel(ch); };
  }, [load]);

  const shown = useMemo(() => {
    const s = f.q.trim().toLowerCase();
    return (rows ?? []).filter((o) => (!s || `${o.title} ${o.party_name ?? ""}`.toLowerCase().includes(s)) && (!f.stage || o.stage === f.stage));
  }, [rows, f.q, f.stage]);
  const cols = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, shown.filter((o) => o.stage === s).sort((a, b) => a.position - b.position)])) as Record<Stage, OppRow[]>, [shown]);
  const open = shown.filter((o) => OPEN_STAGES.includes(o.stage));
  const totals = { n: open.length, mwh: open.reduce((a, o) => a + (o.mwh ?? 0), 0), comm: open.reduce((a, o) => a + (o.commission_eur ?? 0) * ((o.probability ?? 0) / 100), 0) };
  const provinces = useMemo(() => [...new Set((rows ?? []).map((o) => o.province).filter(Boolean))].sort() as string[], [rows]);
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || isStaff(u.role as never));
  const activeFilters = (Object.keys(EMPTY) as (keyof F)[]).filter((k) => k !== "q" && f[k]).length;

  const move = async (o: OppRow, stage: Stage, lostReason?: string) => {
    const target = cols[stage];
    const position = (target.length ? target[target.length - 1].position : 0) + 1;
    const prev = rows;
    busyMove.current = true;
    setRows((r) => (r ?? []).map((x) => (x.id === o.id ? { ...x, stage, position } : x)));
    try {
      const r = await salesApi.opp_<{ version: number; stage: Stage }>("move", { id: o.id, data: { stage, version: o.version, position, lost_reason: lostReason ?? null } });
      setRows((rs) => (rs ?? []).map((x) => (x.id === o.id ? { ...x, version: r.version, stage: r.stage } : x)));
      if (stage === "guanyat") setWon({ ...o, stage, version: r.version });
    } catch (e) {
      setRows(prev);
      toast({ title: "No s'ha pogut moure", body: e instanceof Error ? e.message : String(e), tone: "err" });
      void load();
    } finally { busyMove.current = false; }
  };
  const onEnd = (e: DragEndEvent) => {
    const o = rows?.find((x) => x.id === e.active.id);
    setActive(null);
    const stage = e.over?.id as Stage | undefined;
    if (!o || !stage || stage === o.stage) return;
    if (!staff && o.owner_id !== me.id) { toast({ title: "Només el responsable o Administració poden moure aquesta oportunitat", tone: "err" }); return; }
    if (stage === "perdut") { setLose({ o, position: 0 }); return; }
    void move(o, stage);
  };

  if (!supabaseConfigured) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<Trophy size={26} />} title="El CRM comercial necessita la base de dades" body="Aquest desplegament no té Supabase configurat." /></div>;

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Oportunitats</h2>
          <p className="text-[13px] text-muted">{totals.n} obertes · {mwh(totals.mwh)} · {eur(totals.comm)} de comissió ponderada</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input h-9 w-56 pl-8" placeholder="Cerca client o oportunitat…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Cerca oportunitats" />
          </div>
          <button onClick={() => setMore(!more)} className={cn("pressable flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px]", more || activeFilters ? "border-brand/60 text-brand" : "border-line text-muted")}><Filter size={14} /> Filtres{activeFilters ? ` (${activeFilters})` : ""}</button>
          <ExportButton set="oportunitats" visible={shown.map((o) => o.id)} />
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> Nova oportunitat</Button>
        </div>
      </div>
      {more && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2.5">
          {staff && <select className="input h-9 w-auto text-[12.5px]" aria-label="Comercial" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}><option value="">Tots els comercials</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value="cap">Sense assignar</option></select>}
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Servei" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">Tots els serveis</option>{SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Província" value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}><option value="">Totes les províncies</option>{provinces.map((p) => <option key={p}>{p}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Prioritat" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">Totes les prioritats</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Estat" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">Tots els estats</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
          {activeFilters > 0 && <button className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" onClick={() => setF({ ...EMPTY, q: f.q })}><X size={13} /> Neteja</button>}
        </div>
      )}
      {error && <Notice tone="red">{error}</Notice>}
      {!rows && !error ? (
        <div className="flex gap-3 overflow-hidden">{STAGES.slice(0, 6).map((s) => <div key={s} className="h-[60vh] w-72 shrink-0 animate-pulse rounded-2xl bg-elevated" />)}</div>
      ) : rows && rows.length === 0 ? (
        <Empty icon={<Trophy size={26} />} title="Encara no hi ha oportunitats" body="Crea'n una a partir d'un client o d'un lead i segueix-la fins a tancar-la." action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={13} /> Nova oportunitat</Button>} />
      ) : (
        <DndContext sensors={sensors} onDragStart={(e) => setActive(rows!.find((x) => x.id === e.active.id) ?? null)} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
          <div className="scroll-thin -mx-1 flex min-h-0 flex-1 gap-3 overflow-x-auto px-1 pb-3">
            {STAGES.map((s) => <Column key={s} stage={s} items={cols[s]} dragging={!!active && active.stage !== s} me={me.id} />)}
          </div>
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}>{active && <Card o={active} overlay me={me.id} />}</DragOverlay>
        </DndContext>
      )}
      {creating && <OppForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); void load(); useApp.getState().navigate("oportunitat", { id }); }} />}
      {lose && <LoseDialog o={lose.o} onClose={() => setLose(null)} onConfirm={(reason) => { const o = lose.o; setLose(null); void move(o, "perdut", reason); }} />}
      {won && (
        <Modal open onClose={() => setWon(null)} title="Oportunitat guanyada 🎉" footer={<><Button variant="ghost" onClick={() => setWon(null)}>Més tard</Button><Button variant="primary" onClick={() => { const id = won.id; setWon(null); useApp.getState().navigate("oportunitat", { id }); }}>Obre-la per tramitar</Button></>}>
          <p className="text-[13px]">«{won.title}» s&apos;ha marcat com a guanyada. S&apos;ha creat una tasca de tramitació. Des de la fitxa de l&apos;oportunitat pots convertir el lead en client (si encara no ho és) i obrir l&apos;expedient de contractació sense duplicar dades.</p>
        </Modal>
      )}
    </div>
  );
}

function Column({ stage, items, dragging, me }: { stage: Stage; items: OppRow[]; dragging: boolean; me: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const closed = stage === "guanyat" || stage === "perdut";
  const comm = items.reduce((a, o) => a + (o.commission_eur ?? 0), 0);
  return (
    <section ref={setNodeRef} aria-label={STAGE_LABEL[stage]} className={cn("flex w-72 shrink-0 flex-col rounded-2xl border bg-elevated/50 transition-colors", closed && "w-64", isOver ? "border-brand bg-brand/[0.05]" : dragging ? "border-dashed border-line" : "border-transparent")}>
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_COLOR[stage] }} />
        <h3 className="text-[13px] font-semibold">{STAGE_LABEL[stage]}</h3>
        <span className="rounded-full bg-ink/[0.06] px-1.5 text-[11px] text-muted tnum">{items.length}</span>
        {comm > 0 && <span className="ml-auto text-[11px] text-muted tnum">{eur(comm)}</span>}
      </header>
      <div className="scroll-thin flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {items.map((o) => <Draggable key={o.id} o={o} me={me} />)}
        {!items.length && <p className="px-2 py-6 text-center text-[11.5px] text-muted">{closed ? "Arrossega-hi les tancades" : "Cap oportunitat"}</p>}
      </div>
    </section>
  );
}

function Draggable({ o, me }: { o: OppRow; me: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: o.id });
  return <div ref={setNodeRef} {...listeners} {...attributes} className={cn("touch-none", isDragging && "opacity-30")}><Card o={o} me={me} /></div>;
}

function Card({ o, overlay }: { o: OppRow; overlay?: boolean; me: string }) {
  const idle = daysSince(o.last_activity_at) ?? 0;
  const next = o.next_action_at ? new Date(o.next_action_at) : null;
  const late = next && next < new Date();
  const closed = o.stage === "guanyat" || o.stage === "perdut";
  return (
    <article
      onClick={() => !overlay && useApp.getState().navigate("oportunitat", { id: o.id })}
      className={cn("cursor-pointer rounded-xl border border-line bg-surface p-3 shadow-card transition-shadow hover:border-ink/20", overlay && "rotate-[1.5deg] shadow-lift", o.priority === "alta" && !closed && "border-l-[3px] border-l-lost")}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{o.party_name ?? "—"}</p>
          <p className="truncate text-[11.5px] text-muted">{o.title}</p>
        </div>
        <Avatar name={o.owner_name} size={22} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ServiceChip s={o.service} short />
        {o.party_kind === "lead" && <Badge tone="blue">Lead</Badge>}
        {o.priority === "alta" && !closed && <Badge tone="red">Alta</Badge>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11.5px]">
        <span className="flex items-center gap-1 text-muted">{o.service === "gas" ? <Flame size={12} /> : <Zap size={12} />}{o.mwh != null ? mwh(o.mwh) : "—"}</span>
        <span className="text-right font-medium tnum">{eur(o.commission_eur)}{o.probability != null && !closed ? <span className="font-normal text-muted"> · {o.probability}%</span> : null}</span>
      </div>
      {!closed && (
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[11px]">
          <span className={cn("flex items-center gap-1", late ? "font-medium text-lost" : "text-muted")}><CalendarClock size={12} />{next ? next.toLocaleDateString("ca-ES", { day: "numeric", month: "short" }) : "Sense pròxim contacte"}</span>
          <span className={cn("flex items-center gap-1", idle >= 7 ? "font-medium text-pend" : "text-muted")} title="Dies sense activitat"><Clock size={12} />{idle} d</span>
        </div>
      )}
      {o.stage === "perdut" && o.lost_reason && <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted"><XCircle size={11} /> {o.lost_reason}</p>}
    </article>
  );
}

function LoseDialog({ o, onClose, onConfirm }: { o: OppRow; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const final = reason === "Altres" ? other.trim() : reason;
  return (
    <Modal open onClose={onClose} title={`Marcar com a perduda · ${o.party_name ?? o.title}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!final} onClick={() => onConfirm(final)}>Marca com a perduda</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">El motiu queda a l&apos;historial i serveix per analitzar les pèrdues.</p>
        <div className="flex flex-wrap gap-1.5">{LOST_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={cn("rounded-full border px-3 py-1 text-[12.5px]", reason === r ? "border-lost bg-lost/[0.06] text-lost" : "border-line text-muted")}>{r}</button>)}</div>
        {reason === "Altres" && <input className="input" autoFocus placeholder="Explica el motiu" value={other} onChange={(e) => setOther(e.target.value)} />}
      </div>
    </Modal>
  );
}

