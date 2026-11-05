"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, parseISO, toISODate, today } from "@/core/dates";
import { expiry } from "@/core/insights";
import { titleCase } from "@/core/templates";
import { useApp } from "@/data/store";
import { Button, Tabs, cn } from "../components/ui";

type Mode = "mes" | "semana" | "dia";
interface Ev { id: string; date: string; label: string; kind: "venc" | "vencido" | "tarea" | "atrasada"; contractId: string | null }

const KIND: Record<Ev["kind"], { cls: string; label: string }> = {
  venc: { cls: "bg-pend/10 text-pend border-pend/25", label: "Renovació prevista" },
  vencido: { cls: "bg-lost/10 text-lost border-lost/25", label: "Contracte vençut" },
  tarea: { cls: "bg-cont/10 text-cont border-cont/25", label: "Trucada / seguiment" },
  atrasada: { cls: "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/25", label: "Tasca endarrerida" },
};
const WD = ["dl.", "dt.", "dc.", "dj.", "dv.", "ds.", "dg."];

export function CalendarioView() {
  const { contracts, snap, open } = useApp();
  const [mode, setMode] = useState<Mode>("mes");
  const [cursor, setCursor] = useState(today());
  const ref = today();

  const events = useMemo(() => {
    const out: Ev[] = [];
    for (const c of contracts) {
      const e = expiry(c);
      if (!e || (c.crm.status !== "pendiente" && c.crm.status !== "contactado")) continue;
      out.push({ id: "v" + c.id, date: e, label: titleCase(c.cliente), kind: e < ref ? "vencido" : "venc", contractId: c.id });
    }
    const ids = new Set(contracts.map((c) => c.id));
    for (const t of snap!.tasks) {
      if (t.done || (t.contractId && !ids.has(t.contractId))) continue;
      const c = t.contractId ? contracts.find((x) => x.id === t.contractId) : null;
      out.push({ id: "t" + t.id, date: t.due < ref ? ref : t.due, label: `${t.title}${c ? ` · ${titleCase(c.cliente)}` : ""}`, kind: t.due < ref ? "atrasada" : "tarea", contractId: t.contractId });
    }
    const m = new Map<string, Ev[]>();
    for (const e of out) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date)!.push(e); }
    return m;
  }, [contracts, snap, ref]);

  const days = useMemo(() => {
    const d = parseISO(cursor);
    if (mode === "dia") return [cursor];
    if (mode === "semana") {
      const mon = addDays(cursor, -((d.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    }
    const first = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
    const start = addDays(first, -((parseISO(first).getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor, mode]);

  const step = (n: number) => setCursor(mode === "mes" ? addMonths(cursor, n) : addDays(cursor, n * (mode === "semana" ? 7 : 1)));
  const title = mode === "mes"
    ? parseISO(cursor).toLocaleDateString("ca-ES", { month: "long", year: "numeric" })
    : mode === "semana" ? `Setmana del ${parseISO(days[0]).toLocaleDateString("ca-ES", { day: "numeric", month: "short" })}` : parseISO(cursor).toLocaleDateString("ca-ES", { weekday: "long", day: "numeric", month: "long" });
  const month = parseISO(cursor).getMonth();

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => step(-1)} aria-label="Anterior"><ChevronLeft size={15} /></Button>
        <Button size="sm" onClick={() => setCursor(today())}>Avui</Button>
        <Button size="sm" onClick={() => step(1)} aria-label="Següent"><ChevronRight size={15} /></Button>
        <h2 className="ml-1 text-lg font-semibold">{title.charAt(0).toUpperCase() + title.slice(1)}</h2>
        <div className="ml-auto"><Tabs value={mode} onChange={setMode} items={[{ id: "dia", label: "Dia" }, { id: "semana", label: "Setmana" }, { id: "mes", label: "Mes" }]} /></div>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-[11.5px] text-muted">
        {Object.entries(KIND).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm border", v.cls)} />{v.label}</span>)}
      </div>

      {mode === "dia" ? (
        <div className="space-y-2">
          {(events.get(cursor) ?? []).map((e) => <EvChip key={e.id} e={e} big onClick={() => e.contractId && open(e.contractId)} />)}
          {!(events.get(cursor) ?? []).length && <p className="py-10 text-center text-sm text-muted">No hi ha res programat aquest dia.</p>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="grid grid-cols-7 bg-elevated text-center text-[11.5px] font-medium text-muted">{WD.map((w) => <div key={w} className="py-2">{w}</div>)}</div>
          <div className="grid grid-cols-7 gap-px bg-line">
            {days.map((d) => {
              const evs = events.get(d) ?? [];
              const max = mode === "mes" ? 3 : 12;
              return (
                <div key={d} className={cn("bg-surface p-1.5", mode === "mes" ? "min-h-[104px]" : "min-h-[360px]", mode === "mes" && parseISO(d).getMonth() !== month && "bg-elevated/60 text-muted")}>
                  <button onClick={() => { setCursor(d); setMode("dia"); }} className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[12px] tnum hover:bg-ink/5", d === ref && "bg-brand font-semibold text-white")}>{parseISO(d).getDate()}</button>
                  <div className="space-y-0.5">
                    {evs.slice(0, max).map((e) => <EvChip key={e.id} e={e} onClick={() => e.contractId && open(e.contractId)} />)}
                    {evs.length > max && <button onClick={() => { setCursor(d); setMode("dia"); }} className="px-1 text-[10.5px] font-medium text-muted hover:text-ink">+{evs.length - max} més</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EvChip({ e, onClick, big }: { e: Ev; onClick: () => void; big?: boolean }) {
  return (
    <button onClick={onClick} title={`${KIND[e.kind].label}: ${e.label}`} className={cn("block w-full truncate rounded border text-left font-medium", KIND[e.kind].cls, big ? "px-3 py-2 text-[13px]" : "px-1.5 py-0.5 text-[10.5px]")}>
      {big && <span className="mr-2 text-[11px] opacity-70">{KIND[e.kind].label}</span>}{e.label}
    </button>
  );
}
