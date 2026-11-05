/**
 * Puntuación comercial transparente (0–100). Mide PRIORIDAD COMERCIAL, no ahorro.
 * Cada criterio tiene un peso configurable y aporta puntos explicados.
 */
import { annualActive, maxContracted, maxMonthlyDemand } from "./parse";
import type { Supply } from "./types";

export interface ScoringConfig {
  consumoUmbralKWh: number;
  wConsumo: number;
  wTarifa: number;
  wReactiva: number;
  wSobredim: number;
  wPermanencia: number;
  wAutoconsumo: number;
  penalNoContratable: number;
  penalImpagos: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  consumoUmbralKWh: 100000,
  wConsumo: 35,
  wTarifa: 15,
  wReactiva: 15,
  wSobredim: 15,
  wPermanencia: 10,
  wAutoconsumo: 10,
  penalNoContratable: 60,
  penalImpagos: 25,
};

export interface ScoreItem {
  key: string;
  label: string;
  points: number;
  max: number;
  why: string;
}

export function scoreSupply(s: Supply, cfg: ScoringConfig = DEFAULT_SCORING, today = new Date().toISOString().slice(0, 10)) {
  const items: ScoreItem[] = [];
  const a = annualActive(s).value;
  const fc = a != null && cfg.consumoUmbralKWh > 0 ? Math.min(1, a / cfg.consumoUmbralKWh) : 0;
  items.push({ key: "consumo", label: "Consumo anual", points: cfg.wConsumo * fc, max: cfg.wConsumo, why: a != null ? `${Math.round(a).toLocaleString("es-ES")} kWh vs umbral ${cfg.consumoUmbralKWh.toLocaleString("es-ES")} kWh` : "Sin dato" });
  const ft = s.tarifa === "6.1TD" || s.tarifa?.startsWith("6.") ? 1 : s.tarifa === "3.0TD" ? 0.8 : 0;
  items.push({ key: "tarifa", label: "Tarifa", points: cfg.wTarifa * ft, max: cfg.wTarifa, why: s.tarifa ?? "Desconocida" });
  const ratio = s.eaAnual && s.erAnual != null && s.eaAnual > 0 && s.tarifa !== "2.0TD" ? s.erAnual / s.eaAnual : 0;
  const fr = ratio > 0.33 ? Math.min(1, (ratio - 0.33) / 0.42 + 0.4) : 0;
  items.push({ key: "reactiva", label: "Reactiva", points: cfg.wReactiva * fr, max: cfg.wReactiva, why: ratio ? `R/A ${(ratio * 100).toFixed(0)} %` : "Sin exceso aparente" });
  const mc = maxContracted(s);
  const md = maxMonthlyDemand(s);
  const util = mc && md != null ? md / mc : null;
  const fs = util != null && util < 0.85 ? Math.min(1, (0.85 - util) / 0.45) : 0;
  items.push({ key: "sobredim", label: "Margen de potencia", points: cfg.wSobredim * fs, max: cfg.wSobredim, why: util != null ? `Utilización máx. ${(util * 100).toFixed(0)} % (cota)` : "Sin dato" });
  const yrs = s.fUltCambioComer ? (Date.parse(today) - Date.parse(s.fUltCambioComer)) / (365.25 * 86400000) : null;
  const fp = yrs == null ? 0.5 : Math.min(1, yrs / 3);
  items.push({ key: "permanencia", label: "Tiempo con comercializadora", points: cfg.wPermanencia * fp, max: cfg.wPermanencia, why: yrs == null ? "Fecha desconocida (0,5)" : `${yrs.toFixed(1)} años desde el último cambio` });
  const ac = (s.autoconsumo ?? "").trim();
  const sinAuto = !ac || /^(no|0|sin|00)/i.test(ac);
  items.push({ key: "autoconsumo", label: "Potencial autoconsumo", points: sinAuto && (a ?? 0) > 20000 ? cfg.wAutoconsumo : 0, max: cfg.wAutoconsumo, why: sinAuto ? "Sin autoconsumo registrado" : `Autoconsumo: ${ac}` });
  if (s.contratable === false) items.push({ key: "nocontr", label: "No contratable", points: -cfg.penalNoContratable, max: 0, why: s.motivoNoContratable ?? "Indicado en origen" });
  if (s.impagos && !/^(no|n|0|sin|false|-)$/i.test(s.impagos.trim())) items.push({ key: "impagos", label: "Impagos", points: -cfg.penalImpagos, max: 0, why: s.impagos });
  const maxTotal = items.reduce((t, i) => t + i.max, 0) || 1;
  const raw = items.reduce((t, i) => t + i.points, 0);
  const score = Math.max(0, Math.min(100, Math.round((raw / maxTotal) * 100)));
  return { score, items, util };
}
