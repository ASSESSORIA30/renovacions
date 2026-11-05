"use client";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { EChartsOption } from "echarts";
import { Calculator, CheckCircle2, Cpu, FileDown, Gauge, ListChecks, RotateCcw, ShieldCheck, Sparkles, Table2, TrendingDown, Wand2 } from "lucide-react";
import { toast } from "@/energy/compat/toast";
import type { Supply } from "@/energy/lib/types";
import { useStore } from "@/energy/lib/store";
import { DAYS_IN_MONTH, SOURCES, checkRules, periodsInMonth, isPeninsular, regulatedPowerPrice, tariffRules, type TariffCode } from "@/energy/lib/tariffs";
import { evaluate, runOptimizer, type OptimizerInput, type PeriodMaxTable, type ScenarioResult } from "@/energy/lib/optimizer";
import { MONTHS_SHORT } from "@/energy/lib/columns";
import { cn, fmt, todayIso } from "@/energy/lib/format";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, Field, InfoTip, NumInput, QualityBadge, Select, Slider, Input } from "../ui";
import { Chart, PeriodBars, useTokens } from "../charts";
import { Provenance } from "./common";

export function usePowerPrices(s: Supply, t: TariffCode) {
  const settings = useStore((st) => st.settings);
  const offers = useStore((st) => st.offers);
  const [source, setSource] = useState<string>("regulado");
  const [margin, setMargin] = useState<number>(settings.marginPowerEurKWyr);
  const [custom, setCustom] = useState<number[]>(() => [...regulatedPowerPrice(settings.regulated, t)]);
  const [date, setDate] = useState<string>(todayIso());
  const matching = offers.filter((o) => o.tarifa === t);
  let prices: number[];
  let label: string;
  let validTo: string | undefined;
  let origin: string;
  if (source === "custom") {
    prices = custom;
    label = "Precios personalizados";
    origin = "Introducidos por el usuario";
  } else if (source.startsWith("offer:")) {
    const o = matching.find((x) => `offer:${x.id}` === source);
    prices = o ? o.potencia : [...regulatedPowerPrice(settings.regulated, t)];
    label = o ? `${o.comercializadora} · ${o.nombre}` : "Oferta no encontrada";
    validTo = o?.validTo || undefined;
    origin = o?.origen ?? "";
  } else {
    prices = regulatedPowerPrice(settings.regulated, t).map((v) => v + (v > 0 ? margin : 0));
    label = `ATR regulado ${settings.regulated.label}${margin ? ` + margen ${fmt.n(margin, 2)} €/kW·año` : ""}`;
    validTo = settings.regulated.validTo;
    origin = settings.regulated.sources.map((x) => x.ref).join(" · ");
  }
  const outOfDate = (validTo && date > validTo) || (source === "regulado" && date < settings.regulated.validFrom);
  return { source, setSource, margin, setMargin, custom, setCustom, date, setDate, prices, label, validTo, origin, matching, outOfDate };
}

function PriceEditor({ pp, n }: { pp: ReturnType<typeof usePowerPrices>; n: number }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Origen de precios de potencia" className="sm:col-span-2">
          <Select value={pp.source} onChange={(e) => pp.setSource(e.target.value)}>
            <option value="regulado">ATR regulado (peajes + cargos) configurado en la plataforma</option>
            {pp.matching.map((o) => (
              <option key={o.id} value={`offer:${o.id}`}>
                Oferta: {o.comercializadora} · {o.nombre}
              </option>
            ))}
            <option value="custom">Personalizado</option>
          </Select>
        </Field>
        <Field label="Fecha de aplicación">
          <Input type="date" value={pp.date} onChange={(e) => pp.setDate(e.target.value)} />
        </Field>
      </div>
      {pp.source === "regulado" && (
        <Field label="Margen comercial sobre ATR (€/kW·año, aplicado a cada periodo)" hint="0 = solo componente regulada. Introduce el margen de la comercializadora para un coste completo.">
          <NumInput value={pp.margin} onChange={(v) => pp.setMargin(v ?? 0)} />
        </Field>
      )}
      <div className={cn("grid gap-2", n === 2 ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-6")}>
        {Array.from({ length: n }, (_, i) => (
          <Field key={i} label={`P${i + 1} €/kW·año`}>
            {pp.source === "custom" ? (
              <NumInput value={pp.custom[i]} onChange={(v) => pp.setCustom(pp.custom.map((x, j) => (j === i ? (v ?? 0) : x)))} />
            ) : (
              <div className="num flex h-9 items-center rounded-lg border border-border bg-surface-2/60 px-3 text-sm">{fmt.n(pp.prices[i], 4)}</div>
            )}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
        <span>Fuente: {pp.origin || "—"}</span>
        {pp.validTo && <Badge tone={pp.outOfDate ? "critical" : "neutral"}>Válido hasta {fmt.date(pp.validTo)}</Badge>}
      </div>
      {pp.outOfDate && <Callout tone="warning">La fecha de aplicación queda fuera de la vigencia de estos precios. Actualiza la tarifa en Ajustes o en Energy Market.</Callout>}
    </div>
  );
}

function PeriodMaxDialog({ s, n, open, onOpenChange }: { s: Supply; n: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const stored = useStore((st) => st.periodMax[s.cups]);
  const setPeriodMax = useStore((st) => st.setPeriodMax);
  const [t, setT] = useState<PeriodMaxTable>(() => stored ?? Array.from({ length: 12 }, () => Array(6).fill(null)));
  const pen = isPeninsular(s.provincia);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Maxímetros por periodo (desde facturas)" description="Introduce la potencia máxima demandada por periodo y mes tal como figura en las facturas. Solo se habilitan los periodos existentes en cada temporada.">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg-3">
              <th className="p-1 text-left">Mes</th>
              {Array.from({ length: n }, (_, i) => (
                <th key={i} className="p-1">
                  P{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MONTHS_SHORT.map((m, mi) => {
              const ps = s.tarifa ? periodsInMonth(s.tarifa, mi, pen) : null;
              return (
                <tr key={m}>
                  <td className="p-1 text-fg-2">{m}</td>
                  {Array.from({ length: n }, (_, p) => {
                    const enabled = !ps || ps.includes(p + 1);
                    return (
                      <td key={p} className="p-1">
                        <NumInput disabled={!enabled} className="h-8 text-xs" value={t[mi][p]} onChange={(v) => setT(t.map((r, i) => (i === mi ? r.map((x, j) => (j === p ? v : x)) : r)))} placeholder={enabled ? "kW" : "—"} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setPeriodMax(s.cups, null);
            onOpenChange(false);
            toast("Maxímetros eliminados");
          }}
        >
          Borrar
        </Button>
        <Button
          onClick={() => {
            setPeriodMax(s.cups, t);
            onOpenChange(false);
            toast.success("Maxímetros guardados: el cálculo usa la medida por periodo");
          }}
        >
          Guardar
        </Button>
      </div>
    </Dialog>
  );
}

function SeasonChart({ s, t, pc, n }: { s: Supply; t: TariffCode; pc: number[]; n: number }) {
  const tk = useTokens();
  const pen = isPeninsular(s.provincia);
  const option = useMemo<EChartsOption>(() => {
    const labels = MONTHS_SHORT.map((m, i) => {
      const ps = periodsInMonth(t, i, pen);
      return `${m} · ${ps ? ps.map((p) => `P${p}`).join(" ") : "P1–P" + n}`;
    });
    const minPc = MONTHS_SHORT.map((_, i) => {
      const ps = periodsInMonth(t, i, pen) ?? Array.from({ length: n }, (_, k) => k + 1);
      return Math.min(...ps.map((p) => pc[p - 1] ?? Infinity));
    });
    return {
      animationDuration: 600,
      grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: tk.fg2, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      tooltip: { trigger: "axis", backgroundColor: tk.surface, borderColor: tk.border, textStyle: { color: tk.fg, fontSize: 12 }, valueFormatter: (v: unknown) => (v == null || v === "-" ? "Sin dato" : `${fmt.n(Number(v), 1)} kW`) },
      xAxis: { type: "category", data: labels, axisLabel: { color: tk.fg3, fontSize: 10, interval: 0, formatter: (v: string) => v.split(" · ")[0] }, axisLine: { lineStyle: { color: tk.border } }, axisTick: { show: false } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: tk.border, type: [3, 4] } }, axisLabel: { color: tk.fg3, fontSize: 11 } },
      series: [
        { name: "Máxima registrada del mes (sin periodo)", type: "bar", data: s.potMensual.map((v) => v ?? "-"), barMaxWidth: 24, itemStyle: { color: tk.s1, borderRadius: [4, 4, 0, 0] } },
        { name: "Menor potencia contratada entre los periodos del mes", type: "line", step: "middle", data: minPc, symbol: "none", lineStyle: { color: tk.s4, width: 2 }, itemStyle: { color: tk.s4 } },
      ],
    };
  }, [tk, s, t, pc, n, pen]);
  return <Chart option={option} height={280} />;
}

function Metric({ label, value, sub, tone, hint }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "neutral"; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex items-center gap-1 text-[11px] text-fg-3">
        {label} {hint && <InfoTip>{hint}</InfoTip>}
      </div>
      <div className={cn("num mt-1 text-lg font-semibold", tone === "good" && "text-good", tone === "bad" && "text-critical")}>{value}</div>
      {sub && <div className="text-[11px] text-fg-3">{sub}</div>}
    </div>
  );
}

export function PowerOptimizer({ s }: { s: Supply }) {
  const t = s.tarifa;
  if (!t)
    return (
      <Callout tone="warning" title="Tarifa no reconocida">
        El valor de la columna Tarifa (“{s.tarifaRaw ?? "vacío"}”) no corresponde a un peaje 2.0TD, 3.0TD o 6.xTD. No se aplica una fórmula genérica: corrige la tarifa en el origen para habilitar el optimizador.
      </Callout>
    );
  return <PowerOptimizerInner s={s} t={t} />;
}

function PowerOptimizerInner({ s, t }: { s: Supply; t: TariffCode }) {
  const settings = useStore((st) => st.settings);
  const periodMax = useStore((st) => st.periodMax[s.cups]);
  const updateOpp = useStore((st) => st.updateOpp);
  const rules = tariffRules(t);
  const n = rules.periods;
  const pp = usePowerPrices(s, t);
  const [pmOpen, setPmOpen] = useState(false);
  const [chosen, setChosen] = useState<ScenarioResult["def"]["key"]>("equilibrado");
  const current = s.potContratada.slice(0, n).map((x) => x ?? 0);
  const [sim, setSim] = useState<number[]>(current);

  const inp: OptimizerInput = useMemo(
    () => ({ supply: s, tariff: t, prices: pp.prices, excess45: settings.regulated.excess45[t], modCosts: settings.modCosts, periodMax }),
    [s, t, pp.prices, settings.regulated, settings.modCosts, periodMax],
  );
  const res = useMemo(() => runOptimizer(inp, { priceValidTo: pp.validTo, today: pp.date }), [inp, pp.validTo, pp.date]);
  const simEval = useMemo(() => (res.ok ? evaluate(inp, res.dm, sim, res.mode.mode, 0) : null), [inp, res, sim]);
  const sliderMax = Math.max(rules.maxKW ?? 0, ...current.map((x) => x * 1.6), (s.potMaxBIE ?? 0) * 1.05, ...(res.dm.ub.map((x) => (x ?? 0) * 1.5) as number[]), 10);
  const best = res.scenarios.find((x) => x.def.key === chosen);
  const simSaving = simEval ? res.current.powerCost - simEval.powerCost : 0;
  const simNet = simEval ? simSaving - simEval.excessWorst : 0;
  const quality = res.dm.basis === "medida_periodo" ? "medido" : "cota";
  const anyRules = checkRules(t, sim);

  async function pdf(sc: ScenarioResult) {
    const { optimizationPdf } = await import("@/energy/lib/pdf");
    await optimizationPdf({ s, res, sc, prices: pp.prices, priceLabel: pp.label, priceOrigin: pp.origin, date: pp.date, logo: settings.logoDataUrl, author: settings.userName });
    updateOpp(s.cups, (o) => ({ ...o, proposals: [{ id: crypto.randomUUID(), date: new Date().toISOString(), author: settings.userName, kind: "optimizacion", summary: `${sc.def.label}: ${sc.pc.map((v, i) => `P${i + 1} ${v}`).join(" · ")}`, estSavingEur: sc.netSavingLB }, ...o.proposals] }));
    toast.success("PDF generado y propuesta registrada en la ficha");
  }

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/10 via-transparent to-accent-2/10 p-6">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              <Cpu className="size-4" /> Power Optimizer
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Optimización inteligente de potencia</h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-3">
              Metodología {t} · {res.mode.explanation} Base: {SOURCES.excesos.ref}.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ConfidenceMeter score={res.confidence.score} level={res.confidence.level} />
            <Button variant="outline" size="sm" onClick={() => setPmOpen(true)}>
              <Table2 /> {periodMax ? "Editar maxímetros por periodo" : "Introducir maxímetros de facturas"}
            </Button>
          </div>
        </div>
      </div>
      <Provenance s={s} compact />

      {res.dm.basis !== "medida_periodo" && (
        <Callout tone="warning" title="Diagnóstico preliminar: el Excel no incluye máximos por periodo">
          Las columnas Pot. Enero…Diciembre son máximas mensuales agregadas. Para cada periodo se usa una <b>cota superior</b> (la máxima de los meses en que ese periodo existe según el calendario de temporadas). Los excesos se valoran en el <b>peor caso</b> y el ahorro mostrado es un <b>mínimo garantizado</b> si la demanda se repite. Para una optimización exacta aporta maxímetros por periodo (facturas) o la curva cuartohoraria.
        </Callout>
      )}

      {/* A. Diagnóstico */}
      <Card>
        <CardHeader icon={<Gauge />} title="A · Diagnóstico inicial" subtitle={`Tarifa ${t} · ${rules.notes.join(" ")}`} right={<QualityBadge q={quality} />} />
        <CardBody className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2/60 text-[11px] text-fg-3">
                  <tr>
                    <th className="px-3 py-2 text-left">Periodo</th>
                    <th className="px-3 py-2 text-right">Contratada</th>
                    <th className="px-3 py-2 text-right">
                      Demanda {quality === "medido" ? "medida" : "cota"} <InfoTip>Máxima de los meses en los que existe el periodo. Es un límite superior: la demanda real del periodo puede ser menor.</InfoTip>
                    </th>
                    <th className="px-3 py-2 text-right">Utilización</th>
                  </tr>
                </thead>
                <tbody>
                  {current.map((c, i) => {
                    const u = res.utilization[i];
                    return (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">P{i + 1}</td>
                        <td className="num px-3 py-2 text-right">{fmt.kw(c)}</td>
                        <td className="num px-3 py-2 text-right">{fmt.kw(res.dm.ub[i])}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                              <div className={cn("h-full rounded-full", u != null && u > 1 ? "bg-critical" : "bg-accent")} style={{ width: `${Math.min(100, (u ?? 0) * 100)}%` }} />
                            </div>
                            <span className="num w-12 text-xs">{u != null ? `≤ ${fmt.pct(u)}` : "—"}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Pot. anual registrada" value={fmt.kw(s.potAnual)} />
              <Metric label="Pot. máx. BIE" value={fmt.kw(s.potMaxBIE)} sub={s.potAnual && s.potMaxBIE ? `Margen técnico ${fmt.pct(1 - s.potAnual / s.potMaxBIE)}` : undefined} hint="Límite autorizado, no medido." />
              <Metric label="Pot. máx. APM" value={fmt.kw(s.potMaxAPM)} />
              <Metric label="Control de potencia" value={res.mode.mode === "icp" ? "ICP / contador" : "Maxímetro"} sub={`${s.ctrlPotencia ?? "s/d"} · tipo PM ${res.mode.meterType ?? "?"}${res.mode.inferred ? " (inferido)" : ""}`} />
              <Metric label="Máximas mensuales" value={`${res.dm.monthsKnown}/12`} sub={res.dm.basis === "temporadas" ? "Cota por temporadas" : res.dm.basis} />
              <Metric label="Coste potencia actual" value={fmt.eur(res.current.powerCost)} sub="€/año con precios seleccionados" />
            </div>
            {res.current.excessWorst > 0 && (
              <Callout tone="critical" title="Riesgo de excesos con la potencia actual">
                En el peor caso los excesos podrían alcanzar {fmt.eur(res.current.excessWorst)} /año (periodos {res.current.belowDemand.map((p) => `P${p}`).join(", ")}).
              </Callout>
            )}
            {res.dm.notes.map((x) => (
              <Callout key={x} tone="info">
                {x}
              </Callout>
            ))}
          </div>
          <div>
            <div className="mb-2 text-xs text-fg-3">Máxima registrada por mes vs. potencia contratada más baja entre los periodos presentes ese mes (calendario de temporadas {isPeninsular(s.provincia) ? "peninsular" : "no aplicado"}).</div>
            <SeasonChart s={s} t={t} pc={current} n={n} />
          </div>
        </CardBody>
      </Card>

      {/* B. Simulador */}
      <Card>
        <CardHeader
          icon={<Calculator />}
          title="B · Simulador interactivo"
          subtitle="Mueve cada periodo: el coste se recalcula al instante"
          right={
            <Button variant="ghost" size="sm" onClick={() => setSim(current)}>
              <RotateCcw /> Restablecer
            </Button>
          }
        />
        <CardBody className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
          <div className="space-y-4">
            {sim.map((v, i) => (
              <div key={i} className="grid grid-cols-[40px_1fr_96px] items-center gap-3">
                <span className="text-sm font-semibold">P{i + 1}</span>
                <div>
                  <Slider min={rules.step} max={Math.ceil(sliderMax)} step={rules.step} value={[v]} onValueChange={([x]) => setSim(sim.map((y, j) => (j === i ? x : y)))} />
                  <div className="mt-1 flex justify-between text-[10px] text-fg-3">
                    <span>Actual {fmt.n(current[i], 1)}</span>
                    <span>Cota demanda {fmt.n(res.dm.ub[i], 1)}</span>
                  </div>
                </div>
                <NumInput value={v} onChange={(x) => x != null && setSim(sim.map((y, j) => (j === i ? x : y)))} className="h-8 text-right" />
              </div>
            ))}
            {rules.monotone && (
              <Button variant="secondary" size="sm" onClick={() => setSim(sim.map((_, i) => Math.max(...sim.slice(0, i + 1))))}>
                Ajustar a P1 ≤ … ≤ P6
              </Button>
            )}
            <div className="border-t border-border pt-4">
              <PriceEditor pp={pp} n={n} />
            </div>
          </div>
          {simEval && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Potencia actual (máx.)" value={fmt.kw(Math.max(...current))} sub={`${fmt.n(current.reduce((a, b) => a + b, 0), 1)} kW·periodo`} />
                <Metric label="Potencia simulada (máx.)" value={fmt.kw(Math.max(...sim))} sub={`${fmt.n(sim.reduce((a, b) => a + b, 0), 1)} kW·periodo`} />
                <Metric label="Coste anual potencia actual" value={fmt.eur(res.current.powerCost)} />
                <Metric label="Coste anual simulado" value={fmt.eur(simEval.powerCost)} tone={simEval.powerCost < res.current.powerCost ? "good" : "neutral"} />
                <Metric
                  label="Excesos estimados (peor caso)"
                  value={res.mode.mode === "maximetro45" ? fmt.eur(simEval.excessWorst) : simEval.belowDemand.length ? "No calculable" : fmt.eur(0)}
                  tone={simEval.excessWorst > 0 || simEval.belowDemand.length ? "bad" : "neutral"}
                  hint={res.mode.mode === "maximetro45" ? "tep 4-5 × (demanda − contratada) × días, asumiendo que la máxima del mes ocurrió en el periodo." : "Tipo 1-3: requiere curva cuartohoraria; ICP: superar implica corte."}
                />
                <Metric label="Ahorro neto anual (mínimo)" value={fmt.eur(simNet)} tone={simNet > 0 ? "good" : simNet < 0 ? "bad" : "neutral"} hint="Ahorro en término de potencia − excesos en el peor caso." />
                <Metric label="Costes de modificación" value={fmt.eur(simEval.modCost)} sub={simEval.modBreakdown.map((b) => b.label).join(" · ") || "Sin cambios"} />
                <Metric label="Recuperación" value={simNet > 0 ? (simEval.modCost === 0 ? "Inmediata" : `${fmt.n((simEval.modCost / simNet) * 12, 1)} meses`) : "—"} />
              </div>
              {[...anyRules, ...simEval.violations.filter((x) => !anyRules.includes(x))].map((v) => (
                <Callout key={v} tone="critical">
                  {v}
                </Callout>
              ))}
              {simEval.belowDemand.length > 0 && res.mode.mode !== "icp" && (
                <Callout tone="warning">
                  P{simEval.belowDemand.join(", P")} por debajo de la demanda {quality}. {res.mode.mode === "cuartohorario13" ? "Para tipo 1-3 los excesos dependen de cada cuarto de hora: no se cuantifican sin curva." : "Excesos valorados en el peor caso."}
                </Callout>
              )}
              <PeriodBars
                n={n}
                height={220}
                series={[
                  { name: "Actual", values: current, color: "s1" },
                  { name: "Simulada", values: sim, color: "s3" },
                  { name: `Demanda ${quality}`, values: res.dm.ub, color: "s4", dashed: true },
                ]}
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* C/D. Escenarios */}
      <Card>
        <CardHeader icon={<Wand2 />} title="C · Motor de optimización · D · Tres escenarios" subtitle="Búsqueda exacta en rejilla (programación dinámica) sobre todas las combinaciones que cumplen las reglas del peaje, la BIE y el control de potencia." />
        <CardBody>
          {!res.ok ? (
            <Callout tone="warning">{res.reason}</Callout>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {res.scenarios.map((sc, idx) => (
                <motion.button
                  key={sc.def.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08 }}
                  onClick={() => setChosen(sc.def.key)}
                  className={cn("relative rounded-2xl border p-5 text-left transition", chosen === sc.def.key ? "border-accent bg-accent/5 shadow-[0_0_0_1px_rgb(var(--accent))]" : "border-border bg-surface-2/40 hover:border-border-strong")}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-semibold">
                      {sc.def.key === "conservador" ? <ShieldCheck className="size-4 text-accent-2" /> : sc.def.key === "equilibrado" ? <Sparkles className="size-4 text-accent" /> : <TrendingDown className="size-4 text-good" />}
                      {sc.def.label}
                    </span>
                    {chosen === sc.def.key && <CheckCircle2 className="size-4 text-accent" />}
                  </div>
                  <p className="mt-1 text-xs text-fg-3">{sc.def.description}</p>
                  <div className="mt-4 text-[11px] text-fg-3">Ahorro neto anual mínimo</div>
                  <div className={cn("num text-3xl font-semibold tracking-tight", sc.netSavingLB > 0 ? "text-good" : "text-fg-2")}>{fmt.eur(sc.netSavingLB)}</div>
                  <div className={cn("mt-3 grid gap-1", n === 2 ? "grid-cols-2" : "grid-cols-6")}>
                    {sc.pc.map((v, i) => (
                      <div key={i} className="rounded-md bg-bg-elev/70 px-1 py-1.5 text-center">
                        <div className="text-[9px] text-fg-3">P{i + 1}</div>
                        <div className="num text-xs font-medium">{fmt.n(v, rules.step < 1 ? 1 : 0)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-1 text-[11px] text-fg-2">
                    <div className="flex justify-between">
                      <span>Término de potencia</span>
                      <span className="num">{fmt.eur(sc.powerCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Excesos (peor caso)</span>
                      <span className="num">{fmt.eur(sc.excessWorst)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Modificación</span>
                      <span className="num">{fmt.eur(sc.modCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Recuperación</span>
                      <span className="num">{sc.paybackMonths != null ? `${fmt.n(sc.paybackMonths, 1)} meses` : "—"}</span>
                    </div>
                  </div>
                  {sc.notes.map((x) => (
                    <p key={x} className="mt-2 text-[11px] text-warning">
                      {x}
                    </p>
                  ))}
                  <div className="mt-3 flex gap-2">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSim(sc.pc);
                        toast("Escenario cargado en el simulador");
                      }}
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-fg-2 hover:text-fg"
                    >
                      Llevar al simulador
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* E. Resultados */}
      {best && (
        <Card>
          <CardHeader
            icon={<ListChecks />}
            title="E · Potencia actual vs. propuesta"
            subtitle={`Escenario ${best.def.label} · precios: ${pp.label}`}
            right={
              <Button onClick={() => pdf(best)}>
                <FileDown /> PDF de la propuesta
              </Button>
            }
          />
          <CardBody className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-fg-3">Potencia actual</div>
                {current.map((v, i) => (
                  <div key={i} className="mt-2 flex justify-between text-sm">
                    <span className="text-fg-3">P{i + 1}</span>
                    <span className="num">{fmt.kw(v)}</span>
                  </div>
                ))}
                <div className="mt-3 border-t border-border pt-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-3">Coste/año</span>
                    <span className="num">{fmt.eur(res.current.powerCost)}</span>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-accent/40 bg-accent/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-accent">Potencia propuesta</div>
                {best.pc.map((v, i) => (
                  <div key={i} className="mt-2 flex justify-between text-sm">
                    <span className="text-fg-3">P{i + 1}</span>
                    <span className="num">
                      {fmt.kw(v)}
                      <span className={cn("ml-1 text-[10px]", best.reductionKW[i] > 0 ? "text-good" : best.reductionKW[i] < 0 ? "text-serious" : "text-fg-3")}>
                        {best.reductionKW[i] > 0 ? `−${fmt.n(best.reductionKW[i], 1)}` : best.reductionKW[i] < 0 ? `+${fmt.n(-best.reductionKW[i], 1)}` : "="}
                      </span>
                    </span>
                  </div>
                ))}
                <div className="mt-3 border-t border-border pt-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-3">Coste/año</span>
                    <span className="num">{fmt.eur(best.powerCost + best.excessWorst)}</span>
                  </div>
                </div>
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-2">
                <Metric label="Ahorro económico (mín.)" value={fmt.eur(best.netSavingLB)} tone={best.netSavingLB > 0 ? "good" : "neutral"} />
                <Metric label="Reducción de potencia" value={`${fmt.n(best.reductionKW.reduce((a, b) => a + b, 0), 1)} kW`} sub="suma de periodos" />
                <Metric label="Costes del cambio" value={fmt.eur(best.modCost)} />
              </div>
            </div>
            <div className="space-y-4">
              <PeriodBars
                n={n}
                series={[
                  { name: "Actual", values: current, color: "s1" },
                  { name: "Propuesta", values: best.pc, color: "s3" },
                  { name: `Demanda ${quality}`, values: res.dm.ub, color: "s4", dashed: true },
                ]}
              />
              <div className="rounded-xl border border-border p-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-fg">Nivel de confianza: {res.confidence.level}</span>
                  <span className="num text-fg-3">{res.confidence.score}/100</span>
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-fg-3">
                  {res.confidence.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="mt-3 font-medium text-fg">Datos adicionales necesarios</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-fg-3">
                  {res.confidence.needed.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
      <p className="text-[11px] text-fg-3">
        Excesos tipo 4-5: tep (€/kW·día) × (Pd − Pc) × días del mes ({DAYS_IN_MONTH.reduce((a, b) => a + b)} días/año). Precios: {SOURCES.peajes2026.ref} · {SOURCES.cargos2026.ref}. Derechos: {SOURCES.derechos.ref} (configurables en Ajustes). Restricción de un cambio de potencia cada 12 meses según condiciones de la distribuidora: verificar fecha del último movimiento ({fmt.date(s.fUltMovContrato)}).
      </p>
      <PeriodMaxDialog s={s} n={n} open={pmOpen} onOpenChange={setPmOpen} />
    </div>
  );
}

function ConfidenceMeter({ score, level }: { score: number; level: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-elev/70 px-3 py-2">
      <div className="relative size-10">
        <svg viewBox="0 0 36 36" className="size-10 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="rgb(var(--border))" strokeWidth="3" />
          <motion.circle cx="18" cy="18" r="15" fill="none" stroke="rgb(var(--accent))" strokeWidth="3" strokeLinecap="round" strokeDasharray={94.2} initial={{ strokeDashoffset: 94.2 }} animate={{ strokeDashoffset: 94.2 * (1 - score / 100) }} transition={{ duration: 0.9 }} />
        </svg>
        <span className="num absolute inset-0 grid place-items-center text-[10px] font-semibold">{score}</span>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-fg-3">Confianza</div>
        <div className="text-xs font-medium">{level}</div>
      </div>
    </div>
  );
}
