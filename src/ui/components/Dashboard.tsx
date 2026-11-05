"use client";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BarChart3, ChevronUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addMonths, today } from "@/core/dates";
import { expiry } from "@/core/insights";
import { useApp } from "@/data/store";
import { EASE_OUT, cn } from "./ui";
import { useKpis } from "../selectors";

const TILES: { k: string; label: string; tone?: string; primary?: boolean }[] = [
  { k: "proximos", label: "Propers a renovar", primary: true },
  { k: "semana", label: "Vencen aquesta setmana", tone: "text-lost" },
  { k: "mes", label: "Vencen en 30 dies", tone: "text-pend" },
  { k: "sin_contactar", label: "Pendents de contactar" },
  { k: "propuestas", label: "Propostes enviades" },
  { k: "contactados", label: "Contactats", tone: "text-cont" },
  { k: "renovados", label: "Renovacions", tone: "text-ren" },
  { k: "perdidos", label: "Perduts", tone: "text-lost" },
];

export function Dashboard() {
  const kpis = useKpis();
  const { filter, set } = useApp();
  const [charts, setCharts] = useState(false);
  return (
    <div className="px-4 pt-4 sm:px-6">
      <div className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-9">
        {TILES.map((t) => {
          const active = filter.kpi === t.k;
          return (
            <button
              key={t.k}
              onClick={() => set("filter", { ...filter, kpi: active ? null : t.k })}
              aria-pressed={active}
              className={cn(
                "pressable group min-w-[128px] shrink-0 rounded-xl border px-3 py-2.5 text-left sm:min-w-0",
                active ? "border-ink bg-ink text-surface" : "border-line bg-surface hover:border-ink/25",
                t.primary && "lg:col-span-1"
              )}
            >
              <div className={cn("text-[26px] font-semibold leading-none tracking-tight tnum", !active && t.tone)}>{(kpis.counts[t.k] ?? 0).toLocaleString("ca-ES")}</div>
              <div className={cn("mt-1.5 text-[11.5px] leading-tight", active ? "text-surface/75" : "text-muted")}>{t.label}</div>
            </button>
          );
        })}
        <button onClick={() => setCharts(!charts)} className={cn("pressable flex min-w-[150px] shrink-0 items-center justify-between rounded-xl border border-line bg-surface px-3 py-2.5 text-left hover:border-ink/25 sm:min-w-0")}>
          <div>
            <div className="text-[26px] font-semibold leading-none tracking-tight tnum">{kpis.exito === null ? "—" : `${kpis.exito}%`}</div>
            <div className="mt-1.5 text-[11.5px] leading-tight text-muted">Èxit (renov./tancats)</div>
          </div>
          {charts ? <ChevronUp size={16} className="text-muted" /> : <BarChart3 size={16} className="text-muted" />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {charts && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: EASE_OUT }} className="overflow-hidden">
            <Charts />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const MONTHS = ["gen", "febr", "març", "abr", "maig", "juny", "jul", "ag", "set", "oct", "nov", "des"];

function Charts() {
  const { contracts, snap } = useApp();
  const data = useMemo(() => {
    const start = today().slice(0, 7);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(start + "-01", i).slice(0, 7));
    const m = new Map(months.map((k) => [k, { mes: MONTHS[Number(k.slice(5)) - 1] + " " + k.slice(2, 4), abiertos: 0, renovados: 0, perdidos: 0 }]));
    for (const c of contracts) {
      const e = expiry(c)?.slice(0, 7);
      const row = e ? m.get(e) : undefined;
      if (!row) continue;
      if (c.crm.status === "renovado") row.renovados++;
      else if (c.crm.status === "no_renueva") row.perdidos++;
      else row.abiertos++;
    }
    return [...m.values()];
  }, [contracts]);
  const funnel = useMemo(() => {
    const acts = snap?.activities ?? [];
    const contacted = new Set(acts.filter((a) => ["whatsapp", "email", "call"].includes(a.type)).map((a) => a.contractId));
    const proposals = new Set(acts.filter((a) => a.type === "pdf").map((a) => a.contractId));
    return [
      { etapa: "En finestra", n: contracts.filter((c) => c.crm.status !== "renovado" && c.crm.status !== "no_renueva").length, fill: "rgb(var(--pend))" },
      { etapa: "Contactats", n: contracts.filter((c) => c.crm.status === "contactado" || contacted.has(c.id)).length, fill: "rgb(var(--cont))" },
      { etapa: "Amb proposta", n: proposals.size, fill: "rgb(var(--brand))" },
      { etapa: "Renovats", n: contracts.filter((c) => c.crm.status === "renovado").length, fill: "rgb(var(--ren))" },
    ];
  }, [contracts, snap?.activities]);
  const axis = { fontSize: 11, fill: "rgb(var(--muted))" };
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border border-line bg-surface p-3 lg:col-span-2">
        <p className="mb-2 text-xs font-medium text-muted">Venciments dels propers 12 mesos</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ left: -18, right: 4, top: 4 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
            <XAxis dataKey="mes" tick={axis} tickLine={false} axisLine={false} />
            <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgb(var(--ink) / 0.04)" }} contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="abiertos" name="Per gestionar" stackId="a" fill="rgb(var(--pend))" radius={[0, 0, 0, 0]} />
            <Bar dataKey="renovados" name="Renovats" stackId="a" fill="rgb(var(--ren))" />
            <Bar dataKey="perdidos" name="Perduts" stackId="a" fill="rgb(var(--lost))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="rounded-xl border border-line bg-surface p-3">
        <p className="mb-2 text-xs font-medium text-muted">Conversió comercial</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={funnel} layout="vertical" margin={{ left: 10, right: 44 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="etapa" tick={axis} tickLine={false} axisLine={false} width={90} />
            <Tooltip cursor={{ fill: "rgb(var(--ink) / 0.04)" }} contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="n" name="Contractes" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: "rgb(var(--ink))" }}>
              {funnel.map((f) => <Cell key={f.etapa} fill={f.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
