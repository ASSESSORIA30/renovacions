"use client";
import { useViewState } from "../useViewState";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownWideNarrow, CalendarClock, CalendarDays, ChevronDown, Inbox, Layers, LayoutList, X } from "lucide-react";
import { GROUP_WINDOWS, columnCounts, type KanbanItem } from "@/core/contact-groups";
import type { Status } from "@/core/types";
import { useApp } from "@/data/store";
import { loadGroupData } from "@/data/groupsApi";
import { ContractCard } from "../components/ContractCard";
import { GroupCard } from "../components/GroupCard";
import { Dashboard } from "../components/Dashboard";
import { Button, EASE_OUT, Empty, cn } from "../components/ui";
import { KPI_FILTERS, STATUSES, STATUS_META, useKanbanItems } from "../selectors";

export function KanbanView() {
  const { items: cols, grouped, window } = useKanbanItems();
  const { smartSort, set, filter, snap, byId } = useApp();
  const groupsLoaded = useApp((s) => s.groups.loaded);
  const migrationMissing = useApp((s) => s.groups.migrationMissing);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => { if (!groupsLoaded) void loadGroupData(); }, [groupsLoaded]);
  const itemById = useMemo(() => { const m = new Map<string, KanbanItem>(); for (const s of STATUSES) for (const it of cols[s]) m.set(it.id, it); return m; }, [cols]);
  const [overCol, setOverCol] = useState<Status | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const onStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onEnd = (e: DragEndEvent) => {
    setActiveId(null);
    setOverCol(null);
    const to = e.over?.id as Status | undefined;
    const it = itemById.get(String(e.active.id));
    if (it?.kind === "group") {
      // un grup no es mou sencer sense confirmació: es tria quins contractes s'hi apliquen
      if (to && to !== it.status) set("groupMove", { contractIds: it.all.map((x) => x.id), preselected: it.contracts.map((x) => x.id), to });
      return;
    }
    const c = byId[String(e.active.id)];
    if (!to || !c || c.crm.status === to) return;
    if (to === "renovado" || to === "no_renueva") set("closeDialog", { contractId: c.id, to });
    else void useApp.getState().move(c.id, to);
  };

  const activeItem = activeId ? itemById.get(activeId) ?? null : null;
  const activeStatus: Status | null = activeItem ? (activeItem.kind === "group" ? activeItem.status : activeItem.contract.crm.status) : null;

  return (
    <div className="flex h-full flex-col">
      <Dashboard />
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-1 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {filter.kpi && (
            <button onClick={() => set("filter", { ...filter, kpi: null })} className="pressable inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-medium text-surface">
              Filtre actiu: {KPI_FILTERS[filter.kpi].label} · mostra-ho tot <X size={12} />
            </button>
          )}
          <p className="text-xs text-muted">
            A Pendents hi ha els que vencen en els propers {snap?.settings.horizonteDias} dies o ja han vençut. La resta són a Cartera.
          </p>
        </div>
        <Button size="sm" onClick={() => useApp.getState().navigate("agenda", {})} title="Obre l'agenda; amb «Enrere» tornes al Kanban amb els mateixos filtres"><CalendarDays size={14} /> Agenda</Button>
        <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line p-0.5 text-[12px]" role="radiogroup" aria-label="Tipus de vista">
          <button role="radio" aria-checked={grouped} onClick={() => set("groupView", true)} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1", grouped ? "bg-ink/[0.07] font-medium" : "text-muted")} title="Una targeta per contacte quan té diverses renovacions pròximes"><Layers size={13} /> Vista agrupada</button>
          <button role="radio" aria-checked={!grouped} onClick={() => set("groupView", false)} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1", !grouped ? "bg-ink/[0.07] font-medium" : "text-muted")}><LayoutList size={13} /> Vista individual</button>
        </div>
        {grouped && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Els contractes del mateix contacte s'agrupen si el primer i l'últim venciment no se separen més d'aquests dies">
            Agrupa si vencen dins de
            <select className="input h-7 w-auto py-0 text-[12px]" value={window} onChange={(e) => set("groupWindow", Number(e.target.value))} aria-label="Finestra d'agrupació">
              {GROUP_WINDOWS.map((w) => <option key={w} value={w}>{w} dies</option>)}
            </select>
          </label>
        )}
        <Button size="sm" variant={smartSort ? "primary" : "secondary"} onClick={() => set("smartSort", !smartSort)} title="Reordena les targetes de cada columna segons la puntuació 0–100">
          {smartSort ? <ArrowDownWideNarrow size={14} /> : <CalendarClock size={14} />}
          {smartSort ? "Prioritat intel·ligent" : "Per data de venciment"}
        </Button>
        </div>
      </div>
      {grouped && migrationMissing && <p className="px-4 pb-2 text-[11.5px] text-muted sm:px-6">Agrupació automàtica activa. Per unir o separar grups manualment i registrar comunicacions conjuntes cal aplicar la migració 029 a Supabase.</p>}

      <DndContext sensors={sensors} onDragStart={onStart} onDragOver={(e) => setOverCol((e.over?.id as Status) ?? null)} onDragEnd={onEnd} onDragCancel={() => { setActiveId(null); setOverCol(null); }}>
        <div className="scroll-thin flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-6 sm:px-6 lg:grid lg:snap-none lg:grid-cols-4 lg:overflow-x-visible">
          {STATUSES.map((s) => (
            <Column key={s} status={s} items={cols[s]} grouped={grouped} highlight={!!activeItem && overCol === s && activeStatus !== s} dragging={!!activeItem} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}>
          {activeItem ? <div className="w-[300px]">{activeItem.kind === "group" ? <GroupCard item={activeItem} overlay /> : <ContractCard c={activeItem.contract} overlay />}</div> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

const PAGE = 40;

function Column({ status, items, grouped, highlight, dragging }: { status: Status; items: KanbanItem[]; grouped: boolean; highlight: boolean; dragging: boolean }) {
  const { setNodeRef } = useDroppable({ id: status });
  const [limit, setLimit] = useViewState(`kanban.limit.${status}`, PAGE);
  const meta = STATUS_META[status];
  const shown = useMemo(() => items.slice(0, limit), [items, limit]);
  const counts = useMemo(() => columnCounts(items), [items]);
  return (
    <section
      ref={setNodeRef}
      aria-label={meta.label}
      className={cn(
        "flex min-h-[300px] w-[86vw] shrink-0 snap-start flex-col rounded-2xl border bg-elevated/60 transition-[border-color,background-color,box-shadow] duration-200 sm:w-[340px] lg:w-auto lg:min-w-0",
        highlight ? "shadow-[0_0_0_3px_var(--ring)]" : "border-line",
      )}
      style={{ ...(highlight ? { borderColor: meta.color, background: meta.soft } : {}), ["--ring" as string]: meta.soft }}
    >
      <header className="sticky top-0 z-[1] flex items-center gap-2 rounded-t-2xl px-3.5 pb-2 pt-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
        <h2 className="text-[13px] font-semibold">{meta.label}</h2>
        <motion.span key={`${counts.cards}-${counts.contracts}`} initial={{ scale: 0.85, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25, ease: EASE_OUT }}
          className="ml-auto shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tnum" style={{ background: meta.soft, color: meta.color }}
          title={grouped && counts.groups ? `${counts.cards} targetes (${counts.groups} agrupades) · ${counts.contracts} contractes reals` : `${counts.contracts} contractes`}
          data-testid={`count-${status}`}>
          {grouped && counts.groups ? `${counts.cards.toLocaleString("ca-ES")} targ. · ${counts.contracts.toLocaleString("ca-ES")} contr.` : counts.contracts.toLocaleString("ca-ES")}
        </motion.span>
      </header>
      <p className="px-3.5 pb-2 text-[11px] text-muted">{meta.hint}</p>
      <div className="scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-3 lg:max-h-[calc(100vh-330px)]">
        <AnimatePresence initial={false}>
          {shown.map((it) => <DraggableCard key={it.id} item={it} />)}
        </AnimatePresence>
        {items.length === 0 && !dragging && <Empty icon={<Inbox size={22} />} title="Res per aquí" body={status === "pendiente" ? "No hi ha contractes a la finestra de renovació amb aquests filtres." : "Arrossega una targeta a aquesta columna."} />}
        {dragging && items.length === 0 && <div className="flex-1 rounded-xl border-2 border-dashed" style={{ borderColor: meta.color, opacity: 0.4 }} />}
        {items.length > limit && (
          <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)} className="mt-1">
            <ChevronDown size={14} /> Mostra'n {Math.min(PAGE, items.length - limit)} més de {items.length - limit}
          </Button>
        )}
      </div>
    </section>
  );
}

function DraggableCard({ item }: { item: KanbanItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="touch-manipulation outline-none"
      aria-roledescription="Targeta arrossegable"
    >
      {item.kind === "group" ? <GroupCard item={item} dragging={isDragging} /> : <ContractCard c={item.contract} dragging={isDragging} />}
    </motion.div>
  );
}
