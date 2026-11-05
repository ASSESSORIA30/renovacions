"use client";
/**
 * POWER OPTIMIZER · vista de cartera. Fa servir el motor de cups2 (runOptimizer, via usePortfolio)
 * amb els preus ATR regulats de Configuració. Els imports són cotes mínimes preliminars, no estalvis garantits.
 */
import { useMemo, useState } from "react";
import { ArrowRight, Cpu, Gauge } from "lucide-react";
import { usePortfolio } from "@/energy/lib/portfolio";
import { useStore } from "@/energy/lib/store";
import { fmt } from "@/energy/lib/format";
import { Badge, Button, Callout, Card, Empty, Kpi } from "@/energy/components/ui";
import { PageTitle } from "@/energy/components/shell";
import { useApp } from "@/data/store";

export function OptimizerView() {
  const rows = usePortfolio();
  const settings = useStore((s) => s.settings);
  const [only, setOnly] = useState<"oportunitats" | "tots">("oportunitats");
  const list = useMemo(() => {
    const r = rows.filter((x) => x.s.tarifa && x.maxPc != null);
    return (only === "oportunitats" ? r.filter((x) => (x.saving ?? 0) > 0 || (x.util != null && x.util < settings.alerts.oversizeUtilPct / 100)) : r).sort((a, b) => (b.saving ?? -1) - (a.saving ?? -1));
  }, [rows, only, settings.alerts.oversizeUtilPct]);
  const total = list.reduce((a, r) => a + Math.max(0, r.saving ?? 0), 0);
  const noData = rows.filter((r) => !r.s.tarifa || r.maxPc == null).length;

  return (
    <div className="space-y-5">
      <PageTitle icon={<Cpu />} title="Power Optimizer" subtitle="Potència contractada vs. màximes registrades · escenari Equilibrat amb preus ATR regulats" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi accent label="Estalvi mínim estimat (cota)" value={fmt.eur(total)} sub="Suma de l'escenari Equilibrat · preliminar" hint="Cota inferior calculada amb les màximes mensuals agregades (pitjor cas per període). Cal validar-la amb factures o maxímetres per període." />
        <Kpi label="Subministraments analitzables" value={fmt.n(rows.length - noData)} sub={`${fmt.n(noData)} sense tarifa o potència`} icon={<Gauge />} />
        <Kpi label="Amb possible sobredimensionament" value={fmt.n(rows.filter((r) => r.util != null && r.util < settings.alerts.oversizeUtilPct / 100).length)} sub={`Utilització < ${settings.alerts.oversizeUtilPct} %`} icon={<Cpu />} />
      </div>
      <Callout tone="info" title="Hipòtesis del càlcul">
        Les màximes del SIPS són mensuals i agregades: per a cada període es fa servir una cota superior segons el calendari de temporades, i els excessos es valoren en el pitjor cas. Per això l&apos;estalvi és un <b>mínim</b> i no un import garantit. Amb maxímetres per període de factura (a la fitxa) el càlcul usa la mesura.
      </Callout>
      <div className="flex gap-2">
        {(["oportunitats", "tots"] as const).map((k) => (
          <Button key={k} size="sm" variant={only === k ? "default" : "outline"} onClick={() => setOnly(k)}>
            {k === "oportunitats" ? "Només oportunitats" : "Tots"}
          </Button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={<Cpu />} title="No hi ha subministraments per optimitzar">
          Calen dades SIPS amb tarifa i potències. Consulta CUPS al Buscador SIPS o importa l&apos;Excel.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-3">
                <tr>
                  <th className="px-3 py-2.5 text-left">Subministrament</th>
                  <th className="px-3 py-2.5 text-left">Tarifa</th>
                  <th className="px-3 py-2.5 text-right">Pot. contractada màx.</th>
                  <th className="px-3 py-2.5 text-right">Demanda màx.</th>
                  <th className="px-3 py-2.5 text-right">Utilització</th>
                  <th className="px-3 py-2.5 text-right">Estalvi mínim/any</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 300).map((r) => (
                  <tr key={r.s.cups} className="border-t border-border hover:bg-surface-2/50">
                    <td className="max-w-[320px] px-3 py-2.5">
                      <div className="truncate font-medium">{r.s.direccion ?? r.s.cups}</div>
                      <div className="num truncate text-[11px] text-fg-3">{r.s.cups} · {r.s.localidad ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2.5"><Badge tone="blue">{r.s.tarifa}</Badge></td>
                    <td className="num px-3 py-2.5 text-right">{fmt.kw(r.maxPc)}</td>
                    <td className="num px-3 py-2.5 text-right">{fmt.kw(r.maxDemand)}</td>
                    <td className="num px-3 py-2.5 text-right">{fmt.pct(r.util)}</td>
                    <td className="num px-3 py-2.5 text-right font-medium">{r.saving == null ? "—" : fmt.eur(r.saving)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => useApp.getState().navigate("fitxa", { cups: r.s.cups, tab: "optimizer" }, { returnTo: { view: "optimizer", params: {}, label: "Tornar al Power Optimizer" } })}>
                        Simula <ArrowRight />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
