"use client";
import Link from "@/energy/compat/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, Radar, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useStore } from "@/energy/lib/store";
import { usePortfolio, type PortfolioRow } from "@/energy/lib/portfolio";
import { TARIFFS } from "@/energy/lib/tariffs";
import { cn, fmt } from "@/energy/lib/format";
import { Badge, Button, Card, Empty, Field, Input, NumInput, Select, InfoTip } from "@/energy/components/ui";
import { PageTitle } from "@/energy/components/shell";

type SortKey = "score" | "annual" | "maxPc" | "util" | "ra" | "saving" | "critical" | "cups";

const COLS: { k: SortKey | null; l: string; right?: boolean; hint?: string }[] = [
  { k: "score", l: "Score", hint: "Puntuación comercial 0–100 según criterios configurables en Ajustes. No es ahorro." },
  { k: "cups", l: "Suministro" },
  { k: null, l: "Tarifa" },
  { k: null, l: "Comercializadora" },
  { k: "annual", l: "Consumo", right: true },
  { k: "maxPc", l: "Pot. máx.", right: true },
  { k: "util", l: "Utilización", right: true, hint: "Máxima registrada / mayor potencia contratada (agregado)." },
  { k: "ra", l: "R/A", right: true },
  { k: "saving", l: "Ahorro pot. mín.", right: true, hint: "Escenario Equilibrado con ATR regulado: cota inferior preliminar." },
  { k: "critical", l: "Alertas", right: true },
  { k: null, l: "CRM" },
];

export function RadarView() {
  const rows = usePortfolio();
  const crm = useStore((s) => s.crm);
  const [q, setQ] = useState("");
  const [minKWh, setMinKWh] = useState<number | null>(null);
  const [tariffs, setTariffs] = useState<string[]>([]);
  const [reactive, setReactive] = useState(false);
  const [oversize, setOversize] = useState<number | null>(null);
  const [comer, setComer] = useState("");
  const [loc, setLoc] = useState("");
  const [auto, setAuto] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: "score", asc: false });
  const [page, setPage] = useState(0);
  const PER = 50;

  const comers = useMemo(() => [...new Set(rows.map((r) => r.s.comercializadora).filter(Boolean))].sort() as string[], [rows]);
  const locs = useMemo(() => [...new Set(rows.map((r) => r.s.localidad).filter(Boolean))].sort() as string[], [rows]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    const f = rows.filter((r) => {
      const s = r.s;
      if (ql && !`${s.cups} ${s.direccion} ${s.localidad} ${s.cp} ${s.comercializadora} ${s.cnae}`.toLowerCase().includes(ql)) return false;
      if (minKWh != null && (r.annual ?? 0) < minKWh) return false;
      if (tariffs.length && !tariffs.includes(s.tarifa ?? "")) return false;
      if (reactive && !((r.ra ?? 0) > 0.33 && s.tarifa !== "2.0TD")) return false;
      if (oversize != null && !(r.util != null && r.util * 100 < oversize)) return false;
      if (comer && s.comercializadora !== comer) return false;
      if (loc && s.localidad !== loc) return false;
      if (auto === "si" && !r.autoconsumo) return false;
      if (auto === "no" && r.autoconsumo) return false;
      if (status === "contratable" && s.contratable === false) return false;
      if (status === "nocontratable" && s.contratable !== false) return false;
      if (status === "criticas" && !r.alerts.some((a) => a.severity === "critica")) return false;
      if (status === "bie" && !r.alerts.some((a) => a.rule.startsWith("bie") || a.rule.startsWith("apm"))) return false;
      if (status === "marcadas" && !crm[s.cups]?.marked) return false;
      return true;
    });
    const val = (r: PortfolioRow) => (sort.k === "cups" ? r.s.cups : ((r[sort.k] as number | null) ?? -Infinity));
    return f.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "string" ? x.localeCompare(String(y)) : (x as number) - (y as number);
      return sort.asc ? c : -c;
    });
  }, [rows, q, minKWh, tariffs, reactive, oversize, comer, loc, auto, status, sort, crm]);

  const view = filtered.slice(page * PER, page * PER + PER);
  const reset = () => {
    setQ("");
    setMinKWh(null);
    setTariffs([]);
    setReactive(false);
    setOversize(null);
    setComer("");
    setLoc("");
    setAuto("");
    setStatus("");
  };

  function exportRows() {
    const head = ["Score", "CUPS", "Dirección", "Localidad", "Provincia", "Tarifa", "Comercializadora", "Distribuidora", "Consumo anual kWh", "Pot. máx. contratada kW", "Máx. registrada kW", "Utilización", "R/A anual", "Ahorro potencia mín. € (preliminar)", "Alertas críticas/altas", "Autoconsumo", "Contratable", "Estado CRM", "Responsable", "Origen"];
    return [
      head,
      ...filtered.map((r) => [r.score, r.s.cups, r.s.direccion, r.s.localidad, r.s.provincia, r.s.tarifa ?? r.s.tarifaRaw, r.s.comercializadora, r.s.distribuidora, r.annual, r.maxPc, r.maxDemand, r.util, r.ra, r.saving != null ? Math.round(r.saving) : null, r.critical, r.s.autoconsumo, r.s.contratableRaw, crm[r.s.cups]?.status ?? "", crm[r.s.cups]?.owner ?? "", r.s.source.demo ? "DEMO" : r.s.source.file]),
    ];
  }
  async function xlsx() {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    await writeExcelFile(exportRows().map((r) => r.map((v) => (v == null ? null : v)))).toFile(`Radar_Assessoria30_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  function csv() {
    const body = exportRows()
      .map((r) => r.map((v) => (v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : `"${String(v).replace(/"/g, '""')}"`)).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `Radar_Assessoria30_${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!rows.length) return <Empty icon={<Radar />} title="Sin suministros">Importa un Excel SIPS para activar el radar.</Empty>;

  return (
    <div className="space-y-5">
      <PageTitle
        icon={<Radar />}
        title="Radar comercial"
        subtitle={`${fmt.n(filtered.length)} de ${fmt.n(rows.length)} suministros`}
        right={
          <div className="flex gap-2">
            <Button variant="outline" onClick={csv}>
              <Download /> CSV
            </Button>
            <Button onClick={xlsx}>
              <FileSpreadsheet /> Exportar Excel
            </Button>
          </div>
        }
      />
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="size-4 text-accent" /> Filtros
          </span>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw /> Limpiar
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Field label="Buscar" className="xl:col-span-2">
            <Input placeholder="CUPS, dirección, CP, CNAE…" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
          </Field>
          <Field label="Consumo anual mínimo (kWh)">
            <NumInput value={minKWh} onChange={(v) => (setMinKWh(v), setPage(0))} placeholder="p. ej. 100000" />
          </Field>
          <Field label="Sobredimensionamiento: utilización <">
            <NumInput value={oversize} onChange={(v) => (setOversize(v), setPage(0))} placeholder="% p. ej. 60" />
          </Field>
          <Field label="Comercializadora">
            <Select value={comer} onChange={(e) => (setComer(e.target.value), setPage(0))}>
              <option value="">Todas</option>
              {comers.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Localidad">
            <Select value={loc} onChange={(e) => (setLoc(e.target.value), setPage(0))}>
              <option value="">Todas</option>
              {locs.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Autoconsumo">
            <Select value={auto} onChange={(e) => setAuto(e.target.value)}>
              <option value="">Todos</option>
              <option value="si">Con autoconsumo</option>
              <option value="no">Sin autoconsumo</option>
            </Select>
          </Field>
          <Field label="Situación técnica / administrativa">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas</option>
              <option value="contratable">Contratables</option>
              <option value="nocontratable">No contratables</option>
              <option value="criticas">Con alertas críticas</option>
              <option value="bie">BIE/APM caducado o próximo</option>
              <option value="marcadas">Marcadas en CRM</option>
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-3">
            {TARIFFS.map((t) => (
              <button key={t} onClick={() => setTariffs(tariffs.includes(t) ? tariffs.filter((x) => x !== t) : [...tariffs, t])} className={cn("h-9 rounded-lg border px-3 text-xs", tariffs.includes(t) ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-3")}>
                {t}
              </button>
            ))}
            <button onClick={() => setReactive(!reactive)} className={cn("h-9 rounded-lg border px-3 text-xs", reactive ? "border-[var(--s2)] bg-[color-mix(in_srgb,var(--s2)_12%,transparent)] text-fg" : "border-border text-fg-3")}>
              Reactiva elevada (&gt;33 %)
            </button>
          </div>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wider text-fg-3">
              <tr>
                {COLS.map((c) => (
                  <th key={c.l} className={cn("px-3 py-3 font-medium", c.right ? "text-right" : "text-left")}>
                    <span className={cn("inline-flex items-center gap-1", c.k && "cursor-pointer hover:text-fg")} onClick={() => c.k && setSort({ k: c.k, asc: sort.k === c.k ? !sort.asc : false })}>
                      {c.l}
                      {c.hint && <InfoTip>{c.hint}</InfoTip>}
                      {sort.k === c.k && (sort.asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((r) => {
                const o = crm[r.s.cups];
                return (
                  <tr key={r.s.cups} className="border-t border-border transition hover:bg-surface-2/50">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${r.score}%` }} />
                        </div>
                        <span className="num text-xs font-semibold">{r.score}</span>
                      </div>
                    </td>
                    <td className="max-w-[280px] px-3 py-2.5">
                      <Link href={`/suministro/?cups=${encodeURIComponent(r.s.cups)}`} className="block truncate font-medium hover:text-accent">
                        {r.s.direccion ?? "—"}
                      </Link>
                      <div className="num truncate text-[11px] text-fg-3">
                        {r.s.cups} · {r.s.localidad}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone="blue">{r.s.tarifa ?? r.s.tarifaRaw ?? "?"}</Badge>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 text-xs text-fg-2">{r.s.comercializadora}</td>
                    <td className="num whitespace-nowrap px-3 py-2.5 text-right">{fmt.n((r.annual ?? 0) / 1000, 1)} MWh</td>
                    <td className="num whitespace-nowrap px-3 py-2.5 text-right">{fmt.kw(r.maxPc)}</td>
                    <td className={cn("num whitespace-nowrap px-3 py-2.5 text-right", r.util != null && r.util < 0.6 && "text-good")}>{fmt.pct(r.util)}</td>
                    <td className={cn("num whitespace-nowrap px-3 py-2.5 text-right", (r.ra ?? 0) > 0.33 && r.s.tarifa !== "2.0TD" && "text-[var(--s2)]")}>{fmt.pct(r.ra)}</td>
                    <td className={cn("num whitespace-nowrap px-3 py-2.5 text-right", (r.saving ?? 0) > 0 && "text-good")}>{fmt.eur(r.saving)}</td>
                    <td className="px-3 py-2.5 text-right">{r.critical > 0 ? <Badge tone="critical">{r.critical}</Badge> : <span className="text-fg-3">—</span>}</td>
                    <td className="px-3 py-2.5 text-xs">{o ? <Badge tone={o.marked ? "accent" : "neutral"}>{o.status}{o.owner ? ` · ${o.owner}` : ""}</Badge> : <span className="text-fg-3">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-fg-3">
          <span>
            {fmt.n(page * PER + 1)}–{fmt.n(Math.min(filtered.length, (page + 1) * PER))} de {fmt.n(filtered.length)}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * PER >= filtered.length} onClick={() => setPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
