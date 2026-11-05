"use client";
import { useViewState } from "../useViewState";
import { useMemo } from "react";
import { ArrowUpDown, Download } from "lucide-react";
import { daysUntil, fmtDate, relDays } from "@/core/dates";
import { expiry } from "@/core/insights";
import { LEVEL_META, consumption } from "@/core/priority";
import { titleCase } from "@/core/templates";
import type { Contract, Status } from "@/core/types";
import { useApp } from "@/data/store";
import { Button, SupplierMark, cn } from "../components/ui";
import { STATUSES, STATUS_META, useFiltered } from "../selectors";
import { ExportButton } from "../components/ExportButton";
import { downloadCsv } from "./csv";

type SortKey = "venc" | "prio" | "cliente" | "consumo";

export function CarteraView() {
  const all = useFiltered();
  const { priority, open, filter, set, contracts } = useApp();
  const [status, setStatus] = useViewState<Status | "">("cartera.status", "");
  const [sort, setSort] = useViewState<SortKey>("cartera.sort", "venc");
  const [limit, setLimit] = useViewState("cartera.limit", 100);
  const comerciales = useMemo(() => [...new Set(contracts.map((c) => c.comercial))].sort(), [contracts]);
  const rows = useMemo(() => {
    const r = all.filter((c) => !status || c.crm.status === status);
    const k: Record<SortKey, (a: Contract, b: Contract) => number> = {
      venc: (a, b) => (expiry(a) ?? "9").localeCompare(expiry(b) ?? "9"),
      prio: (a, b) => (priority[b.id]?.score ?? 0) - (priority[a.id]?.score ?? 0),
      cliente: (a, b) => a.cliente.localeCompare(b.cliente),
      consumo: (a, b) => (consumption(b) ?? 0) - (consumption(a) ?? 0),
    };
    return [...r].sort(k[sort]);
  }, [all, status, sort, priority]);

  const exportCsv = () => downloadCsv(`cartera_${new Date().toISOString().slice(0, 10)}.csv`, rows.map((c) => ({
    Client: c.cliente, CIF: c.cif, CUPS: c.cups, Poblacio: c.poblacion, Telefon: c.crm.telefonoOverride ?? c.telefono, Correu: c.crm.emailOverride ?? c.email,
    Tipus: c.tipo, Comercialitzadora: c.comercializadora, Tarifa: c.tarifa, ConsumKWh: consumption(c), Venciment: expiry(c), Estat: STATUS_META[c.crm.status].label,
    Prioritat: priority[c.id]?.score, Comercial: c.comercial, ProperaAccio: c.crm.proximaAccion, DataProperaAccio: c.crm.proximaAccionFecha,
  })));

  const Th = ({ k, children, className }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("whitespace-nowrap px-3 py-2 text-left text-[11.5px] font-medium text-muted", className)}>
      {k ? <button onClick={() => setSort(k)} className={cn("inline-flex items-center gap-1 hover:text-ink", sort === k && "text-ink")}>{children}<ArrowUpDown size={11} /></button> : children}
    </th>
  );

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value as Status | "")}><option value="">Tots els estats</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
        <select className="input h-9 w-auto" value={filter.tipo ?? ""} onChange={(e) => set("filter", { ...filter, tipo: e.target.value || null })}><option value="">Llum, gas i telefonia</option><option value="luz">Llum</option><option value="gas">Gas</option><option value="telefonia">Telefonia</option></select>
        {comerciales.length > 1 && <select className="input h-9 w-auto" value={filter.comercial ?? ""} onChange={(e) => set("filter", { ...filter, comercial: e.target.value || null })}><option value="">Tots els comercials</option>{comerciales.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select>}
        <span className="text-[12px] text-muted tnum">{rows.length.toLocaleString("ca-ES")} contractes</span>
        <span className="ml-auto flex gap-2"><ExportButton fileName="cartera" rows={() => rows.map((c) => ({
          Client: c.cliente, CIF: c.cif, CUPS: c.cups, Poblacio: c.poblacion, Telefon: c.crm.telefonoOverride ?? c.telefono, Correu: c.crm.emailOverride ?? c.email,
          Tipus: c.tipo, Comercialitzadora: c.comercializadora, Tarifa: c.tarifa, ConsumKWh: consumption(c), Venciment: expiry(c), Estat: STATUS_META[c.crm.status].label,
          Prioritat: priority[c.id]?.score, Comercial: c.comercial, ProperaAccio: c.crm.proximaAccion, DataProperaAccio: c.crm.proximaAccionFecha,
        }))} /><Button size="sm" onClick={exportCsv}><Download size={13} /> CSV</Button></span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead className="border-b border-line bg-elevated"><tr>
            <Th k="cliente">Client</Th><Th>Subministrament</Th><Th k="consumo" className="text-right">Consum</Th><Th k="venc">Venciment</Th><Th>Estat</Th><Th k="prio">Prioritat</Th><Th>Comercial</Th>
          </tr></thead>
          <tbody>
            {rows.slice(0, limit).map((c) => {
              const d = daysUntil(expiry(c));
              const p = priority[c.id];
              const openSt = c.crm.status === "pendiente" || c.crm.status === "contactado";
              return (
                <tr key={c.id} onClick={() => open(c.id)} className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-ink/[0.025]">
                  <td className="max-w-[260px] px-3 py-2"><p className="truncate font-medium">{titleCase(c.cliente)}</p><p className="truncate text-[11px] text-muted">{c.poblacion} · {c.cif}</p></td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><SupplierMark name={c.comercializadora} size={20} /><div><p>{c.tarifa ?? "—"}</p><p className="font-mono text-[10.5px] text-muted">{c.cups ? `…${c.cups.slice(-8)}` : "—"}</p></div></div></td>
                  <td className="px-3 py-2 text-right tnum">{consumption(c) ? `${Math.round(consumption(c)!).toLocaleString("ca-ES")} kWh` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2"><p className="tnum">{fmtDate(expiry(c))}</p>{openSt && <p className={cn("text-[11px]", d !== null && d <= 7 ? "text-lost" : d !== null && d <= 30 ? "text-pend" : "text-muted")}>{relDays(d)}</p>}</td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[c.crm.status].color }} />{STATUS_META[c.crm.status].label}</span></td>
                  <td className="px-3 py-2">{p && p.level !== "cerrado" ? <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset tnum", LEVEL_META[p.level].cls)}>{p.score} · {LEVEL_META[p.level].label}</span> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2 text-muted">{titleCase(c.comercial)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > limit && <div className="border-t border-line p-2 text-center"><Button size="sm" variant="ghost" onClick={() => setLimit(limit + 200)}>Mostra'n 200 més (en queden {rows.length - limit})</Button></div>}
      </div>
    </div>
  );
}
