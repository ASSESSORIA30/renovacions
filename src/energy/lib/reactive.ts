/**
 * REACTIVE ENERGY — análisis de energía reactiva.
 *
 * Regla (Circular 3/2020 y Anexo III Resolución peajes 2026): se factura la
 * reactiva inductiva de P1–P5 que exceda el 33 % de la activa del mismo periodo
 * (cos φ < 0,95), a 0,041554 €/kVArh (0,80 ≤ cos φ < 0,95) o 0,062332 €/kVArh
 * (cos φ < 0,80). No se aplica en P6 ni a suministros en BT ≤ 15 kW (2.0TD).
 *
 * El Excel trae activa y reactiva MENSUALES TOTALES (incluyen P6) → la
 * penalización exacta no es calculable. Se ofrecen:
 *  - un rango sin hipótesis [0, R × 0,062332] por mes;
 *  - una estimación orientativa bajo hipótesis explícitas (ratio R/A uniforme
 *    entre periodos y % de energía fuera de P6 indicado por el usuario).
 */
import type { TariffCode } from "./tariffs";
import { REGULATED_2026 } from "./tariffs";
import type { Supply } from "./types";

export interface ReactiveMonth {
  month: number;
  a: number | null;
  r: number | null;
  ratio: number | null; // R/A
  cos: number | null;
  band: "ok" | "medio" | "alto" | "sd";
  boundMax: number | null; // € sin hipótesis
  estimate: number | null; // € con hipótesis
}

export function cosPhi(a: number, r: number): number | null {
  if (a <= 0 && r <= 0) return null;
  return a / Math.sqrt(a * a + r * r);
}

export function bandFor(ratio: number | null): ReactiveMonth["band"] {
  if (ratio == null) return "sd";
  if (ratio <= 0.33) return "ok";
  if (ratio <= 0.75) return "medio";
  return "alto";
}

export function priceForCos(cos: number | null, table = REGULATED_2026.reactive): number {
  if (cos == null) return 0;
  for (const t of table) if (cos >= t.cosFrom) return t.price;
  return table[table.length - 1].price;
}

export function reactiveApplies(t: TariffCode | null): { applies: boolean | null; why: string } {
  if (t == null) return { applies: null, why: "Tarifa desconocida." };
  if (t === "2.0TD") return { applies: false, why: "En 2.0TD (BT ≤ 15 kW) no se factura la energía reactiva." };
  return { applies: true, why: `En ${t} se factura la reactiva inductiva de P1–P5 por encima del 33 % de la activa del periodo.` };
}

export function analyzeReactive(s: Supply, opts: { shareOutsideP6: number | null; table?: typeof REGULATED_2026.reactive }) {
  const table = opts.table ?? REGULATED_2026.reactive;
  const maxPrice = Math.max(...table.map((t) => t.price));
  const applies = reactiveApplies(s.tarifa);
  const months: ReactiveMonth[] = s.eaMensual.map((a, m) => {
    const r = s.erMensual[m];
    if (a == null || r == null) return { month: m, a, r, ratio: null, cos: null, band: "sd", boundMax: null, estimate: null };
    const ratio = a > 0 ? r / a : null;
    const cos = cosPhi(a, r);
    const boundMax = applies.applies ? r * maxPrice : 0;
    let estimate: number | null = null;
    if (applies.applies && opts.shareOutsideP6 != null) {
      const excess = Math.max(0, r - 0.33 * a) * opts.shareOutsideP6;
      estimate = excess * priceForCos(cos, table);
    } else if (applies.applies === false) estimate = 0;
    return { month: m, a, r, ratio, cos, band: bandFor(ratio), boundMax, estimate };
  });
  const known = months.filter((x) => x.ratio != null);
  const sumA = known.reduce((s, x) => s + (x.a ?? 0), 0);
  const sumR = known.reduce((s, x) => s + (x.r ?? 0), 0);
  const annualRatio = s.eaAnual && s.erAnual != null && s.eaAnual > 0 ? s.erAnual / s.eaAnual : sumA > 0 ? sumR / sumA : null;
  const top = [...known].sort((a, b) => (b.r ?? 0) - (a.r ?? 0)).slice(0, 3);
  const risk: "sin_riesgo" | "bajo" | "medio" | "alto" | "no_aplica" | "sd" =
    applies.applies === false
      ? "no_aplica"
      : known.length === 0
        ? "sd"
        : known.some((m) => m.band === "alto")
          ? "alto"
          : known.some((m) => m.band === "medio")
            ? "medio"
            : annualRatio != null && annualRatio > 0.25
              ? "bajo"
              : "sin_riesgo";
  const estimateTotal = opts.shareOutsideP6 != null && known.length ? months.reduce((s, m) => s + (m.estimate ?? 0), 0) : null;
  const boundTotal = known.length ? months.reduce((s, m) => s + (m.boundMax ?? 0), 0) : null;
  return { applies, months, annualRatio, annualCos: annualRatio != null ? 1 / Math.sqrt(1 + annualRatio ** 2) : null, top, risk, estimateTotal, boundTotal, monthsKnown: known.length };
}

/** Batería de condensadores orientativa: Qc = P · (tan φ1 − tan φ2). */
export function compensationSizing(input: { pKW: number; cos1: number; cos2: number; costPerKVAr: number; annualPenalty: number | null }) {
  const tan = (c: number) => Math.tan(Math.acos(Math.min(1, Math.max(0.01, c))));
  const qc = Math.max(0, input.pKW * (tan(input.cos1) - tan(input.cos2)));
  const capex = qc * input.costPerKVAr;
  const payback = input.annualPenalty && input.annualPenalty > 0 && capex > 0 ? capex / input.annualPenalty : null;
  return { qc, capex, paybackYears: payback };
}

export const COMPENSATION_MISSING_DATA = [
  "Curva de carga activa/reactiva por periodo (mín. 1 mes, ideal 12)",
  "Factor de potencia por periodo P1–P5 de las facturas",
  "Distorsión armónica (THD-I / THD-U) para decidir filtros de rechazo",
  "Esquema unifilar, tensión de servicio y potencia del transformador (si AT)",
  "Existencia y estado de baterías de condensadores actuales",
  "Perfil de cargas (motores, variadores, iluminación) y régimen de funcionamiento",
];
