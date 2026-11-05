"use client";
/** Targeta agrupada del Kanban: una persona de contacte i el seu conjunt de renovacions pròximes. */
import { memo, useMemo } from "react";
import { CalendarRange, Flame, Layers, Mail, Phone, Send, Users, Zap } from "lucide-react";
import { summarize, type KanbanItem } from "@/core/contact-groups";
import { fmtDateShort } from "@/core/dates";
import { LEVEL_META } from "@/core/priority";
import { titleCase } from "@/core/templates";
import type { Status } from "@/core/types";
import { useApp } from "@/data/store";
import { STATUS_META } from "../selectors";
import { Badge, cn } from "./ui";

type GroupItem = Extract<KanbanItem, { kind: "group" }>;

const level = (score: number) => (score >= 75 ? "critica" : score >= 55 ? "alta" : score >= 35 ? "media" : "baja") as keyof typeof LEVEL_META;

export const GroupCard = memo(function GroupCard({ item, dragging, overlay }: { item: GroupItem; dragging?: boolean; overlay?: boolean }) {
  const priority = useApp((s) => s.priority);
  const s = useMemo(() => summarize(item.all, priority), [item.all, priority]);
  const here = item.contracts.length;
  const others = item.all.length - here;
  const tone = STATUS_META[item.status].color;
  const open = () => useApp.getState().set("groupPanel", { contractIds: item.all.map((c) => c.id), focusStatus: item.status });
  const contactAll = (e: React.MouseEvent) => { e.stopPropagation(); useApp.getState().set("contactAll", { contractIds: item.all.map((c) => c.id), preselected: item.contracts.map((c) => c.id) }); };
  const lvl = s.priority > 0 ? level(s.priority) : null;
  return (
    <article
      onClick={open}
      data-testid="group-card"
      aria-label={`Grup de ${s.total} contractes de ${s.contactName ?? "un mateix contacte"}`}
      className={cn(
        "card-hover group relative cursor-pointer select-none rounded-xl border border-line bg-surface p-3 shadow-card transition-[border-color,opacity,box-shadow] duration-150",
        "before:absolute before:inset-x-2 before:-bottom-1 before:h-2 before:rounded-b-xl before:border before:border-t-0 before:border-line before:bg-surface/80 before:content-['']",
        dragging && "opacity-30",
        overlay && "rotate-[1.5deg] cursor-grabbing shadow-lift ring-1 ring-ink/10",
      )}
    >
      <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: tone }} aria-hidden />
      <header className="flex items-start gap-2 pl-1">
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-brand/10 text-brand"><Users size={13} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold leading-tight">{s.contactName ? titleCase(s.contactName) : "Mateix contacte"}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
            {s.phone && <span className="inline-flex items-center gap-1"><Phone size={11} /> {s.phone}</span>}
            {s.email && <span className="inline-flex min-w-0 items-center gap-1 truncate"><Mail size={11} className="shrink-0" /> <span className="truncate">{s.email}</span></span>}
          </p>
        </div>
        {lvl && <span title={`Prioritat del grup: ${LEVEL_META[lvl].label.toLowerCase()} (la més alta dels seus contractes)`} className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset tnum", LEVEL_META[lvl].cls)}>{s.priority}</span>}
      </header>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-1 text-[11.5px]">
        <Badge tone="violet"><Layers size={11} /> {s.total} contractes</Badge>
        {s.luz > 0 && <Badge tone="amber"><Zap size={11} /> {s.luz} llum</Badge>}
        {s.gas > 0 && <Badge tone="orange"><Flame size={11} /> {s.gas} gas</Badge>}
        {s.holders > 1 && <Badge tone="blue">{s.holders} titulars</Badge>}
      </div>

      <p className="mt-2 flex items-center gap-1.5 pl-1 text-[11.5px] text-ink/80 tnum">
        <CalendarRange size={12} className="text-muted" /> {fmtDateShort(s.first)} → {fmtDateShort(s.last)}
      </p>

      <div className="mt-1.5 flex flex-wrap gap-1 pl-1">
        {(Object.entries(s.statuses) as [Status, number][]).map(([st, n]) => (
          <span key={st} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium" style={{ background: STATUS_META[st].soft, color: STATUS_META[st].color }}>{n} {STATUS_META[st].label.toLowerCase()}</span>
        ))}
      </div>
      {others > 0 && <p className="mt-1 pl-1 text-[10.5px] text-muted">{here} en aquesta columna · {others} en {others === 1 ? "una altra" : "altres"}</p>}

      <p className="mt-1.5 truncate pl-1 text-[11px] text-muted">Responsable: <span className="font-medium text-ink/70">{s.owners.map(titleCase).join(", ")}</span></p>
      <footer className="mt-2 flex items-center justify-end gap-2 border-t border-line/70 pl-1 pt-2">
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={contactAll} className="pressable inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-brand hover:bg-brand/10" aria-label="Contactar tots"><Send size={12} /> Contactar tots</button>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); open(); }} className="pressable rounded-md px-1.5 py-1 text-[11px] font-medium text-ink/80 hover:bg-ink/[0.06]">Veure contractes</button>
        </div>
      </footer>
    </article>
  );
});
