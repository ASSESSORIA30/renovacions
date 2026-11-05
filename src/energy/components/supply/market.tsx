"use client";
import Link from "@/energy/compat/link";
import { useMemo, useState } from "react";
import { FileDown, Store, Plus, Trophy } from "lucide-react";
import { toast } from "@/energy/compat/toast";
import type { Supply } from "@/energy/lib/types";
import { emptyOpp, useStore } from "@/energy/lib/store";
import { costOffer, savingVs, type ConsumptionScenario, type OfferCost } from "@/energy/lib/market";
import { annualActive } from "@/energy/lib/parse";
import { energyPeriods } from "@/energy/lib/tariffs";
import { cn, fmt, todayIso } from "@/energy/lib/format";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Empty, Field, NumInput, QualityBadge, Select } from "../ui";
import { Provenance } from "./common";

export function MarketModule({ s }: { s: Supply }) {
  const offers = useStore((st) => st.offers);
  const invoice = useStore((st) => st.invoices[s.cups]);
  const setInvoice = useStore((st) => st.setInvoice);
  const opp = useStore((st) => st.crm[s.cups]) ?? emptyOpp(s.cups);
  const updateOpp = useStore((st) => st.updateOpp);
  const settings = useStore((st) => st.settings);
  const t = s.tarifa;
  const ne = t ? energyPeriods(t) : 6;
  const annual = annualActive(s).value ?? 0;
  const [mode, setMode] = useState<ConsumptionScenario["mode"]>(invoice ? "factura" : "rango");
  const [hyp, setHyp] = useState<number[]>(() => Array(ne).fill(Math.round(100 / ne)));
  const [inv, setInv] = useState<(number | null)[]>(() => invoice?.kWhByPeriod ?? Array(ne).fill(null));
  const matching = offers.filter((o) => o.tarifa === t);

  const sc: ConsumptionScenario = useMemo(() => {
    if (mode === "factura") return { mode, annualKWh: annual, values: inv.map((x) => x ?? 0), label: "kWh por periodo desde facturas" };
    if (mode === "hipotesis") {
      const tot = hyp.reduce((a, b) => a + b, 0) || 1;
      return { mode, annualKWh: annual, values: hyp.map((x) => x / tot), label: `Hipótesis de reparto: ${hyp.map((x, i) => `P${i + 1} ${x}%`).join(" · ")}` };
    }
    return { mode: "rango", annualKWh: annual, values: [], label: "Sin reparto por periodos: rango garantizado" };
  }, [mode, annual, inv, hyp]);

  const costs = useMemo(() => matching.map((o) => costOffer(o, s, sc, { today: todayIso() })), [matching, s, sc]);
  const current = costs.find((c) => c.offer.id === opp.currentOfferId);
  const sorted = [...costs].sort((a, b) => (a.total ?? (a.totalMin + a.totalMax) / 2) - (b.total ?? (b.totalMin + b.totalMax) / 2));
  const lo = Math.min(...costs.map((c) => c.totalMin), Infinity);
  const hi = Math.max(...costs.map((c) => c.totalMax), 0);
  const invSum = inv.reduce<number>((a, b) => a + (b ?? 0), 0);

  async function pdf() {
    const { comparisonPdf } = await import("@/energy/lib/pdf");
    await comparisonPdf({ s, costs: sorted, current, scenario: sc, logo: settings.logoDataUrl, author: settings.userName });
    updateOpp(s.cups, (o) => ({ ...o, proposals: [{ id: crypto.randomUUID(), date: new Date().toISOString(), author: settings.userName, kind: "comparativa", summary: `Comparativa de ${sorted.length} ofertas (${sc.mode})`, estSavingEur: current && sorted[0] ? (savingVs(current, sorted[0]).kind !== "rango" ? (savingVs(current, sorted[0]) as { value: number }).value : null) : null }, ...o.proposals] }));
    toast.success("Informe PDF generado");
  }

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-accent-2/30 bg-gradient-to-br from-accent-2/10 via-transparent to-transparent p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">
              <Store className="size-4" /> Energy Market
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Comparador comercial</h2>
            <p className="mt-1 text-sm text-fg-3">
              {matching.length} ofertas para {t ?? "?"} · consumo anual {fmt.kwh(annual)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/mercado">
                <Plus /> Gestionar ofertas
              </Link>
            </Button>
            <Button onClick={pdf} disabled={!costs.length}>
              <FileDown /> Informe PDF para cliente
            </Button>
          </div>
        </div>
      </div>
      <Provenance s={s} compact />

      <Card>
        <CardHeader title="Escenario de consumo" subtitle="La calidad del dato determina si el coste es exacto, orientativo o un rango" right={<QualityBadge q={mode === "factura" ? "exacto" : mode === "hipotesis" ? "orientativo" : "rango"} />} />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["rango", "Sin reparto (rango garantizado)"],
                ["factura", "kWh por periodo de facturas"],
                ["hipotesis", "Hipótesis de reparto"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className={cn("rounded-lg border px-3 py-1.5 text-sm", mode === k ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-3 hover:text-fg")}>
                {l}
              </button>
            ))}
          </div>
          {mode === "rango" && <Callout tone="info">El Excel solo trae consumos mensuales totales. Se muestra el coste mínimo y máximo posible (todo el consumo al precio más barato / más caro). Para una comparativa fiable aporta facturas o la curva de carga.</Callout>}
          {mode === "factura" && (
            <div className="space-y-2">
              <div className={cn("grid gap-2", ne === 3 ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-6")}>
                {inv.map((v, i) => (
                  <Field key={i} label={`P${i + 1} kWh/año`}>
                    <NumInput value={v} onChange={(x) => setInv(inv.map((y, j) => (j === i ? x : y)))} />
                  </Field>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-fg-3">
                <span>
                  Suma {fmt.kwh(invSum)} · SIPS {fmt.kwh(annual)} ({annual ? fmt.pct(invSum / annual - 1, 1) : "—"})
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setInvoice(s.cups, { kWhByPeriod: inv, source: "Facturas introducidas manualmente", date: new Date().toISOString() });
                    toast.success("Consumos por periodo guardados en la ficha");
                  }}
                >
                  Guardar en la ficha
                </Button>
              </div>
            </div>
          )}
          {mode === "hipotesis" && (
            <div className={cn("grid gap-2", ne === 3 ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-6")}>
              {hyp.map((v, i) => (
                <Field key={i} label={`P${i + 1} %`}>
                  <NumInput value={v} onChange={(x) => setHyp(hyp.map((y, j) => (j === i ? (x ?? 0) : y)))} />
                </Field>
              ))}
              <p className="col-span-full text-xs text-warning">Hipótesis del comercial: no es un consumo medido. Se normaliza al 100 %.</p>
            </div>
          )}
          <Field label="Condiciones actuales del cliente (para calcular el ahorro)" className="max-w-md">
            <Select value={opp.currentOfferId ?? ""} onChange={(e) => updateOpp(s.cups, (o) => ({ ...o, currentOfferId: e.target.value || undefined }))}>
              <option value="">— Sin definir —</option>
              {matching.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.comercializadora} · {o.nombre}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {!matching.length ? (
        <Empty icon={<Store />} title={`No hay ofertas ${t ?? ""} registradas`}>
          Añade tarifas de comercializadoras en <Link className="text-accent underline" href="/mercado">Energy Market</Link> para comparar.
        </Empty>
      ) : (
        <Card>
          <CardHeader icon={<Trophy />} title="Ranking de ofertas" subtitle={`Coste anual con impuestos configurados · ${sc.label}`} />
          <CardBody className="space-y-3">
            {sorted.map((c, idx) => (
              <OfferRow key={c.offer.id} c={c} idx={idx} lo={lo} hi={hi} current={current} />
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function OfferRow({ c, idx, lo, hi, current }: { c: OfferCost; idx: number; lo: number; hi: number; current?: OfferCost }) {
  const span = hi - lo || 1;
  const sv = current && current.offer.id !== c.offer.id ? savingVs(current, c) : null;
  return (
    <div className={cn("rounded-xl border p-4", idx === 0 ? "border-accent/50 bg-accent/5" : "border-border")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="num text-xs text-fg-3">#{idx + 1}</span>
            <span className="font-medium">{c.offer.comercializadora}</span>
            <span className="text-sm text-fg-3">{c.offer.nombre}</span>
            {current?.offer.id === c.offer.id && <Badge tone="blue">Actual</Badge>}
            <QualityBadge q={c.quality} />
          </div>
          <div className="mt-1 text-[11px] text-fg-3">
            Energía {c.energy != null ? fmt.eur(c.energy) : `${fmt.eur(c.energyMin)}–${fmt.eur(c.energyMax)}`} · Potencia {fmt.eur(c.power)} {c.sas ? `· SAS ${fmt.eur(c.sas)}` : ""} {c.services ? `· Servicios ${fmt.eur(c.services)}` : ""} · IEE {c.offer.ieePct}% · IVA {c.offer.ivaPct}% · válida hasta {fmt.date(c.offer.validTo)}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-xl font-semibold">{c.total != null ? fmt.eur(c.total) : `${fmt.eur(c.totalMin)} – ${fmt.eur(c.totalMax)}`}</div>
          {sv && (
            <div className={cn("num text-xs", sv.kind === "rango" ? "text-fg-3" : sv.value > 0 ? "text-good" : "text-critical")}>
              {sv.kind === "rango" ? `Ahorro entre ${fmt.eur(sv.min)} y ${fmt.eur(sv.max)} (${sv.min > 0 ? "garantizado" : "no garantizado"})` : `${sv.value > 0 ? "Ahorro" : "Sobrecoste"} ${fmt.eur(Math.abs(sv.value))}/año (${sv.kind})`}
            </div>
          )}
        </div>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-surface-2">
        <div className="absolute h-2 rounded-full bg-gradient-to-r from-accent-2 to-accent" style={{ left: `${((c.totalMin - lo) / span) * 100}%`, width: `${Math.max(1.5, ((c.totalMax - c.totalMin) / span) * 100)}%` }} />
        {c.total != null && <div className="absolute -top-1 h-4 w-1 rounded bg-fg" style={{ left: `${((c.total - lo) / span) * 100}%` }} />}
      </div>
      {c.issues.map((i) => (
        <p key={i} className="mt-2 text-[11px] text-warning">
          {i}
        </p>
      ))}
    </div>
  );
}
