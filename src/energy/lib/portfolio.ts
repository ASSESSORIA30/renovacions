"use client";
import { useMemo } from "react";
import { useStore } from "./store";
import { supplyAlerts, type Alert } from "./alerts";
import { scoreSupply } from "./scoring";
import { runOptimizer } from "./optimizer";
import { regulatedPowerPrice } from "./tariffs";
import { annualActive, maxContracted, maxMonthlyDemand } from "./parse";
import type { Supply } from "./types";

export interface PortfolioRow {
  s: Supply;
  annual: number | null;
  maxPc: number | null;
  maxDemand: number | null;
  util: number | null;
  ra: number | null;
  score: number;
  alerts: Alert[];
  critical: number;
  saving: number | null;
  autoconsumo: boolean;
}

export function usePortfolio() {
  const supplies = useStore((s) => s.supplies);
  const settings = useStore((s) => s.settings);
  return useMemo<PortfolioRow[]>(
    () =>
      supplies.map((s) => {
        const alerts = supplyAlerts(s, settings.alerts);
        const maxPc = maxContracted(s);
        const maxDemand = maxMonthlyDemand(s);
        let saving: number | null = null;
        if (s.tarifa) {
          const r = runOptimizer(
            { supply: s, tariff: s.tarifa, prices: regulatedPowerPrice(settings.regulated, s.tarifa).map((v) => v + (v > 0 ? settings.marginPowerEurKWyr : 0)), excess45: settings.regulated.excess45[s.tarifa], modCosts: settings.modCosts },
            { only: "equilibrado" },
          );
          saving = r.ok ? (r.scenarios[0]?.netSavingLB ?? null) : null;
        }
        const ac = (s.autoconsumo ?? "").trim();
        return {
          s,
          annual: annualActive(s).value,
          maxPc,
          maxDemand,
          util: maxPc && maxDemand != null ? maxDemand / maxPc : null,
          ra: s.eaAnual && s.erAnual != null && s.eaAnual > 0 ? s.erAnual / s.eaAnual : null,
          score: scoreSupply(s, settings.scoring).score,
          alerts,
          critical: alerts.filter((a) => a.severity === "critica" || a.severity === "alta").length,
          saving,
          autoconsumo: !!ac && !/^(no|0|sin|00)/i.test(ac),
        };
      }),
    [supplies, settings],
  );
}
