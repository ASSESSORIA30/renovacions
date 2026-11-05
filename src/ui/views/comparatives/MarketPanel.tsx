"use client";
/**
 * COMPARADOR FIX vs INDEXAT (Fase 11) dins del pas «Comparativa».
 * L'usuari indica la hipòtesi de mercat (escenari central per període, €/MWh, i els % baixista/alcista) i el motor
 * calcula, amb la fórmula de cada indexada, el cost de cada escenari, el punt d'equilibri i la sensibilitat.
 * Tot queda a la comparativa desada (el servidor ho recalcula) i al PDF.
 */
import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { DEFAULT_SCENARIO_PCT, explainMarket, perUnit, type MarketAnalysis, type MarketInput } from "@/comparator/market";
import { Badge, Button, Notice, cn } from "../../components/ui";
import { useWizard } from "./state";

const eur = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));
const COLORS = ["#0f766e", "#7c3aed", "#db2777", "#ea580c"];
const SC_LABEL = { baixista: "Indexada — baixista", central: "Indexada — central", alcista: "Indexada — alcista" } as const;

export function MarketPanel({ analysis, periods, indexedSelected, readOnly }: { analysis: MarketAnalysis | null | undefined; periods: number; indexedSelected: boolean; readOnly: boolean }) {
  const w = useWizard();
  const m = w.market;
  const set = (p: Partial<MarketInput>) => w.set({ market: { ...(m ?? { central: Array(6).fill(null), lowPct: DEFAULT_SCENARIO_PCT.low, highPct: DEFAULT_SCENARIO_PCT.high, source: "Hipòtesi manual" }), ...p } });
  const expl = useMemo(() => (analysis ? explainMarket(analysis) : null), [analysis]);
  if (!m) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-4 text-[12.5px]" data-testid="market-off">
        <TrendingUp size={16} className="text-brand" />
        <span className="min-w-0 flex-1">{indexedSelected ? "Has triat una oferta indexada: compara-la amb les fixes en tres escenaris de mercat." : "Compara tarifes fixes amb indexades en escenaris de mercat (cal seleccionar alguna oferta indexada amb la seva fórmula)."}</span>
        {!readOnly && <Button size="sm" variant="primary" onClick={() => set({})}>Activa els escenaris de mercat</Button>}
      </section>
    );
  }
  const a = analysis;
  const ix = a?.indexed ?? [];
  const chart = (a?.curve ?? []).map((p) => ({ market: p.market, fixa: p.fixed, ...Object.fromEntries(ix.map((x) => [x.offerId, p.indexed[x.offerId]])) }));
  const kwh = a?.kwhTotal ?? null;
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" data-testid="market-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><TrendingUp size={15} className="text-brand" /> Fix vs indexat · escenaris de mercat</h3>
        {!readOnly && <Button size="sm" variant="ghost" onClick={() => w.set({ market: null })}>Treu els escenaris</Button>}
      </div>
      <div className="grid gap-2 rounded-xl bg-elevated/60 p-3 text-[12px] lg:grid-cols-[2fr_1fr]">
        <div>
          <p className="mb-1 font-medium">Escenari central del mercat (€/MWh) per període</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: periods }, (_, i) => (
              <label key={i} className="block w-20"><span className="text-[10.5px] text-muted">P{i + 1}</span>
                <input className="input h-8 py-0 tnum" inputMode="decimal" disabled={readOnly} defaultValue={m.central[i] ?? ""} key={`${i}-${m.central[i]}`} aria-label={`Mercat P${i + 1}`}
                  onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value.replace(",", ".")); const c = [...m.central]; c[i] = Number.isFinite(v) ? v : null; set({ central: c }); }} /></label>
            ))}
            {!readOnly && <label className="block w-28"><span className="text-[10.5px] text-muted">Mateix a tots</span>
              <input className="input h-8 py-0 tnum" inputMode="decimal" placeholder="€/MWh" aria-label="Mercat a tots els períodes" onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); if (e.target.value && Number.isFinite(v)) set({ central: Array.from({ length: 6 }, (_, i) => (i < periods ? v : null)) }); }} /></label>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-[10.5px] text-muted">Baixista (%)</span><input className="input h-8 py-0 tnum" type="number" max={0} min={-90} disabled={readOnly} value={m.lowPct} onChange={(e) => set({ lowPct: Math.min(0, Number(e.target.value) || 0) })} aria-label="Escenari baixista" /></label>
          <label className="block"><span className="text-[10.5px] text-muted">Alcista (%)</span><input className="input h-8 py-0 tnum" type="number" min={0} max={300} disabled={readOnly} value={m.highPct} onChange={(e) => set({ highPct: Math.max(0, Number(e.target.value) || 0) })} aria-label="Escenari alcista" /></label>
          <label className="col-span-2 block"><span className="text-[10.5px] text-muted">Font de la hipòtesi</span><input className="input h-8 py-0" disabled={readOnly} value={m.source} onChange={(e) => set({ source: e.target.value.slice(0, 200) })} placeholder="p. ex. OMIP Cal-27 a 03/11/2026 · manual" aria-label="Font de la hipòtesi" /></label>
        </div>
      </div>
      <p className="text-[11px] text-muted">Els escenaris són hipòtesis configurables, no previsions oficials. Cada indexada es calcula amb la SEVA fórmula (marge, pèrdues, serveis d&apos;ajust, peatges); si en falta algun component, el resultat surt com a incomplet.</p>
      {a?.warnings.map((x, i) => <Notice key={i}>{x}</Notice>)}
      {a && (
        <>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-[12.5px]" data-testid="market-table">
              <thead className="bg-elevated text-left text-[10.5px] uppercase text-muted"><tr><th className="px-3 py-2">Tipus de tarifa</th><th className="text-right">Cost anual</th><th className="text-right">Estalvi respecte de l&apos;actual</th><th className="text-right">Diferència mensual</th><th className="px-3 text-right">Diferència per MWh</th></tr></thead>
              <tbody className="tnum">
                <tr className="border-t border-line"><td className="px-3 py-1.5">Tarifa actual</td><td className="text-right">{eur(a.current.cost)}</td><td className="text-right text-muted">Referència</td><td /><td /></tr>
                <tr className="border-t border-line"><td className="px-3 py-1.5">Millor fixa{a.bestFixed ? ` · ${a.bestFixed.supplier} ${a.bestFixed.name}` : ""} <Badge tone="green">contractual</Badge></td><td className="text-right">{eur(a.bestFixed?.cost)}</td><td className="text-right">{eur(a.bestFixed?.savingVsCurrent)}</td><td className="text-right">{eur(perUnit(a.bestFixed?.savingVsCurrent ?? null, kwh).month)}</td><td className="px-3 text-right">{eur(perUnit(a.bestFixed?.savingVsCurrent ?? null, kwh).perMWh)}</td></tr>
                {ix.map((x) => x.complete ? x.scenarios.map((s) => (
                  <tr key={`${x.offerId}-${s.scenario}`} className={cn("border-t border-line", s.scenario === "central" && "bg-brand/[0.04]")}>
                    <td className="px-3 py-1.5">{SC_LABEL[s.scenario]} · {x.supplier} {x.name} <span className="text-[10.5px] text-muted">({s.avgMarket.toLocaleString("ca-ES")} €/MWh)</span> <Badge tone="amber">estimat</Badge></td>
                    <td className="text-right">{s.cost.ok ? eur(s.cost.total) : "—"}</td>
                    <td className="text-right">{eur(s.savingVsCurrent)}</td>
                    <td className="text-right">{eur(perUnit(s.savingVsCurrent, kwh).month)}</td>
                    <td className="px-3 text-right">{eur(perUnit(s.savingVsCurrent, kwh).perMWh)}</td>
                  </tr>
                )) : (
                  <tr key={x.offerId} className="border-t border-line"><td className="px-3 py-1.5" colSpan={5}><AlertTriangle size={12} className="mr-1 inline text-red-600" />{x.supplier} {x.name}: INCOMPLET — falta {x.missing.join(", ")}.</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {chart.length > 0 && ix.some((x) => x.complete) && (
            <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
              <div className="h-64 rounded-xl border border-line p-2" data-testid="market-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ left: 8, right: 16, top: 8 }}>
                    <CartesianGrid stroke="rgb(var(--line))" />
                    <XAxis dataKey="market" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} tickFormatter={(v) => `${Math.round(Number(v))}`} label={{ value: "Preu mitjà de mercat (€/MWh)", position: "insideBottom", offset: -2, fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} tickFormatter={(v) => `${Math.round(Number(v) / 100) / 10}k €`} width={56} />
                    <Tooltip formatter={(v) => eur(Number(v))} labelFormatter={(v) => `Mercat ${Number(v).toLocaleString("ca-ES")} €/MWh`} contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 10, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="fixa" name="Millor fixa" stroke="#0f766e" strokeWidth={2} dot={false} isAnimationActive={false} />
                    {ix.filter((x) => x.complete).map((x, i) => <Line key={x.offerId} type="monotone" dataKey={x.offerId} name={`${x.supplier} ${x.name}`} stroke={COLORS[(i + 1) % COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
                    {ix.filter((x) => x.breakEvenMarket != null).map((x) => <ReferenceLine key={x.offerId} x={x.breakEvenMarket!} stroke="#ea580c" strokeDasharray="4 3" label={{ value: `Equilibri ${x.breakEvenMarket!.toLocaleString("ca-ES")} €/MWh`, fontSize: 10, fill: "#ea580c", position: "top" }} />)}
                    {ix.filter((x) => x.complete).flatMap((x, i) => x.scenarios.filter((s) => s.cost.ok).map((s) => <ReferenceDot key={`${x.offerId}${s.scenario}`} x={s.avgMarket} y={s.cost.total} r={4} fill={COLORS[(i + 1) % COLORS.length]} stroke="none" />))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 text-[12.5px]">
                {ix.filter((x) => x.complete).map((x) => (
                  <div key={x.offerId} className="rounded-xl border border-line p-3">
                    <p className="font-semibold">{x.supplier} · {x.name}</p>
                    <p>Punt d&apos;equilibri: {x.breakEvenMarket != null ? <b>{x.breakEvenMarket.toLocaleString("ca-ES")} €/MWh</b> : "no es creua amb la fixa entre 0 i 1.000 €/MWh"}</p>
                    <p>Sensibilitat: {eur(x.sensitivityPerEurMWh)} a l&apos;any per cada +1 €/MWh</p>
                    <p>Risc (alcista − baixista): <b>{eur(x.riskRange)}</b></p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {expl && (
            <div className="rounded-xl border border-line p-3 text-[12.5px]" data-testid="market-explain">
              <p className="mb-1 font-semibold">Anàlisi {expl.verdict === "fixa" ? "· la fixa és l'opció prudent" : expl.verdict === "indexada" ? "· la indexada guanya també a l'escenari alcista" : expl.verdict === "indiferent" ? "· depèn del risc que vulgui assumir el client" : "· dades incompletes"}</p>
              <ul className="list-disc space-y-0.5 pl-5">{expl.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
              <p className="mt-2 text-[11px] text-muted">Hipòtesis: {a.hypotheses.join(" ")}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
