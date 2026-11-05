"use client";
import { useMemo, useState } from "react";
import { Waves, Calculator, AlertTriangle, BarChart3 } from "lucide-react";
import type { Supply } from "@/energy/lib/types";
import { useStore } from "@/energy/lib/store";
import { analyzeReactive, compensationSizing, COMPENSATION_MISSING_DATA } from "@/energy/lib/reactive";
import { MONTHS } from "@/energy/lib/columns";
import { cn, fmt } from "@/energy/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, Field, NumInput, QualityBadge, Slider, Switch, InfoTip } from "../ui";
import { MonthlyBars, RatioLine } from "../charts";
import { GLOSSARY, Provenance } from "./common";

const RISK = {
  alto: ["critical", "Riesgo alto"],
  medio: ["warning", "Riesgo medio"],
  bajo: ["blue", "Riesgo bajo"],
  sin_riesgo: ["good", "Sin riesgo aparente"],
  no_aplica: ["neutral", "No se factura en esta tarifa"],
  sd: ["neutral", "Sin datos"],
} as const;

export function ReactiveModule({ s }: { s: Supply }) {
  const settings = useStore((st) => st.settings);
  const [useHyp, setUseHyp] = useState(settings.reactiveShareOutsideP6 != null);
  const [share, setShare] = useState(settings.reactiveShareOutsideP6 ?? 0.5);
  const r = useMemo(() => analyzeReactive(s, { shareOutsideP6: useHyp ? share : null, table: settings.regulated.reactive }), [s, useHyp, share, settings.regulated.reactive]);
  const worst = r.months.filter((m) => m.cos != null).sort((a, b) => (a.cos ?? 1) - (b.cos ?? 1))[0];
  const [pKW, setPKW] = useState<number | null>(s.potAnual ?? null);
  const [cos1, setCos1] = useState<number | null>(worst?.cos ? Math.round(worst.cos * 1000) / 1000 : 0.85);
  const [cos2, setCos2] = useState<number | null>(0.98);
  const [cost, setCost] = useState<number | null>(null);
  const comp = compensationSizing({ pKW: pKW ?? 0, cos1: cos1 ?? 0.9, cos2: cos2 ?? 0.98, costPerKVAr: cost ?? 0, annualPenalty: r.estimateTotal });
  const [tone, label] = RISK[r.risk];

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--s2)_40%,transparent)] bg-gradient-to-br from-[color-mix(in_srgb,var(--s2)_12%,transparent)] via-transparent to-transparent p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--s2)]">
              <Waves className="size-4" /> Reactive Energy
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Análisis de reactiva</h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-3">{r.applies.why}</p>
          </div>
          <Badge tone={tone} className="px-3 py-1 text-xs">
            {r.risk === "alto" || r.risk === "medio" ? <AlertTriangle /> : null}
            {label}
          </Badge>
        </div>
      </div>
      <Provenance s={s} compact />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <div className="text-xs text-fg-3">Reactiva anual</div>
          <div className="num mt-1 text-3xl font-semibold">{fmt.n(s.erAnual)}</div>
          <div className="text-xs text-fg-3">kVArh · columna E.R. Anual</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-1 text-xs text-fg-3">
            Relación R/A anual <InfoTip>Reactiva / activa del total anual (incluye P6). Solo orientativa: la penalización se calcula por periodo.</InfoTip>
          </div>
          <div className="num mt-1 text-3xl font-semibold">{fmt.pct(r.annualRatio, 1)}</div>
          <div className="text-xs text-fg-3">cos φ medio {fmt.n(r.annualCos, 3)}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-fg-3">Meses con mayor reactiva</div>
          <div className="mt-2 space-y-1 text-sm">
            {r.top.map((m) => (
              <div key={m.month} className="flex justify-between">
                <span>{MONTHS[m.month]}</span>
                <span className="num text-fg-2">
                  {fmt.n(m.r)} kVArh · {fmt.pct(m.ratio)}
                </span>
              </div>
            ))}
            {!r.top.length && <span className="text-fg-3">Sin datos mensuales</span>}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between text-xs text-fg-3">
            Coste anual estimado <QualityBadge q={useHyp ? "orientativo" : "rango"} />
          </div>
          {r.applies.applies === false ? (
            <div className="num mt-1 text-3xl font-semibold">0 €</div>
          ) : useHyp ? (
            <div className="num mt-1 text-3xl font-semibold text-[var(--s2)]">{fmt.eur(r.estimateTotal)}</div>
          ) : (
            <div className="num mt-1 text-xl font-semibold">0 € – {fmt.eur(r.boundTotal)}</div>
          )}
          <div className="text-xs text-fg-3">{useHyp ? `Hipótesis: ${fmt.pct(share)} de la energía fuera de P6, R/A uniforme` : "Rango sin hipótesis (todo en P6 ↔ todo penalizado a 0,062332)"}</div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<BarChart3 />} title="Reactiva mensual" subtitle="kVArh" right={<InfoTip>{GLOSSARY.reactiva.text}</InfoTip>} />
          <CardBody>
            <MonthlyBars values={s.erMensual} unit="kVArh" name="Reactiva" color="s2" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Waves />} title="Relación reactiva / activa mensual" subtitle="% · umbral de penalización 33 % (cos φ 0,95) y tramo alto 75 % (cos φ 0,80)" />
          <CardBody>
            <RatioLine values={r.months.map((m) => m.ratio)} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Detalle mensual y estimación" subtitle="Los totales mensuales incluyen P6, donde no se penaliza: la cifra exacta requiere activa y reactiva por periodo (facturas o curva)." />
        <CardBody className="space-y-4">
          {r.applies.applies !== false && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={useHyp} onCheckedChange={setUseHyp} /> Aplicar hipótesis orientativa
              </label>
              {useHyp && (
                <div className="flex min-w-[260px] flex-1 items-center gap-3">
                  <span className="text-xs text-fg-3">Energía fuera de P6</span>
                  <Slider min={0} max={1} step={0.05} value={[share]} onValueChange={([v]) => setShare(v)} />
                  <span className="num w-12 text-sm">{fmt.pct(share)}</span>
                </div>
              )}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-2/60 text-fg-3">
                <tr>
                  {["Mes", "Activa kWh", "Reactiva kVArh", "R/A", "cos φ", "Tramo", "Máx. sin hipótesis", useHyp ? "Estimación" : ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-right first:text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.months.map((m) => (
                  <tr key={m.month} className="border-t border-border">
                    <td className="px-3 py-1.5">{MONTHS[m.month]}</td>
                    <td className="num px-3 py-1.5 text-right">{fmt.n(m.a)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmt.n(m.r)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmt.pct(m.ratio, 1)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmt.n(m.cos, 3)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Badge tone={m.band === "alto" ? "critical" : m.band === "medio" ? "warning" : m.band === "ok" ? "good" : "neutral"}>{m.band === "ok" ? "≤ 33 %" : m.band === "medio" ? "33–75 %" : m.band === "alto" ? "> 75 %" : "s/d"}</Badge>
                    </td>
                    <td className="num px-3 py-1.5 text-right">{fmt.eur(m.boundMax, 2)}</td>
                    <td className="num px-3 py-1.5 text-right">{useHyp ? fmt.eur(m.estimate, 2) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-fg-3">
            Precios reactiva inductiva P1–P5: {settings.regulated.reactive.map((x) => `cos φ ≥ ${x.cosFrom}: ${x.price} €/kVArh`).join(" · ")} (Anexo III Resolución CNMC peajes 2026). Editables en Ajustes.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={<Calculator />} title="Calculadora orientativa de compensación" subtitle="Qc = P · (tan φ₁ − tan φ₂)" />
        <CardBody className="grid gap-5 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Potencia activa de referencia (kW)" hint="Por defecto la Pot. Anual registrada (punta). Ajusta a la potencia media de funcionamiento.">
              <NumInput value={pKW} onChange={setPKW} />
            </Field>
            <Field label="cos φ actual" hint={worst ? `Peor mes: ${MONTHS[worst.month]} (${fmt.n(worst.cos, 3)})` : undefined}>
              <NumInput value={cos1} onChange={setCos1} />
            </Field>
            <Field label="cos φ objetivo">
              <NumInput value={cos2} onChange={setCos2} />
            </Field>
            <Field label="Coste instalado (€/kVAr)" hint="Introduce el presupuesto del instalador.">
              <NumInput value={cost} onChange={setCost} placeholder="p. ej. presupuesto" />
            </Field>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border p-3">
                <div className="text-[11px] text-fg-3">Batería necesaria</div>
                <div className="num text-xl font-semibold">{fmt.n(comp.qc, 1)} kVAr</div>
              </div>
              <div className="rounded-xl border border-border p-3">
                <div className="text-[11px] text-fg-3">Inversión</div>
                <div className="num text-xl font-semibold">{cost ? fmt.eur(comp.capex) : "—"}</div>
              </div>
              <div className="rounded-xl border border-border p-3">
                <div className="text-[11px] text-fg-3">Retorno</div>
                <div className={cn("num text-xl font-semibold")}>{comp.paybackYears != null ? `${fmt.n(comp.paybackYears, 1)} años` : "—"}</div>
              </div>
            </div>
            {!useHyp && <Callout tone="info">El retorno requiere una estimación de penalización: activa la hipótesis o introduce datos por periodo.</Callout>}
            <div className="rounded-xl border border-border p-4 text-xs">
              <div className="font-medium">Datos técnicos que faltan para dimensionar</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-fg-3">
                {COMPENSATION_MISSING_DATA.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
