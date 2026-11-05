/**
 * POWER OPTIMIZER — motor de optimización de potencia.
 *
 * Principio: nunca se inventa la demanda por periodo. Con los datos del Excel
 * (máxima mensual agregada) se construye una COTA SUPERIOR rigurosa de la demanda
 * de cada periodo usando el calendario de temporadas: un periodo P solo existe en
 * ciertos meses, así que su demanda máxima no puede superar la máxima de esos meses.
 *
 *   UB_p = max{ M_m : P_p está presente en el mes m }
 *
 * Los excesos se evalúan en el PEOR CASO (la máxima del mes pudo ocurrir en
 * cualquiera de los periodos del mes), por lo que el ahorro neto calculado es una
 * cota inferior: ahorro_real ≥ (coste_pot_actual − coste_pot_nuevo) − excesos_peor_caso_nuevo.
 *
 * Si el usuario introduce maxímetros por periodo (facturas), se usan en su lugar.
 *
 * El problema es separable por periodo salvo la restricción P1 ≤ … ≤ P6, por lo que
 * se resuelve de forma exacta sobre una rejilla con programación dinámica
 * (prefijo mínimo), explorando todas las combinaciones factibles.
 */
import { maxContracted } from "./parse";
import {
  ACOMETIDA_BT,
  DAYS_IN_MONTH,
  checkRules,
  controlMode,
  isPeninsular,
  periodsInMonth,
  tariffRules,
  type ControlMode,
  type TariffCode,
} from "./tariffs";
import type { Supply } from "./types";

export type PeriodMaxTable = (number | null)[][]; // [12][6] maxímetros por periodo (facturas)

export interface DemandModel {
  tariff: TariffCode;
  n: number;
  monthly: (number | null)[];
  monthsKnown: number;
  /** periodos presentes por mes (null = sin calendario → todos) */
  monthPeriods: number[][];
  /** demanda por mes y periodo usada en el cálculo (peor caso o medida) */
  demand: (number | null)[][];
  ub: (number | null)[];
  basis: "medida_periodo" | "temporadas" | "envolvente" | "anual" | "none";
  notes: string[];
}

export function buildDemandModel(s: Supply, tariff: TariffCode, periodMax?: PeriodMaxTable): DemandModel {
  const n = tariffRules(tariff).periods;
  const pen = isPeninsular(s.provincia);
  const notes: string[] = [];
  const monthly = s.potMensual.slice(0, 12);
  const monthsKnown = monthly.filter((x) => x != null).length;
  const monthPeriods: number[][] = [];
  const demand: (number | null)[][] = [];
  let basis: DemandModel["basis"] = "temporadas";
  let usedPeriodTable = false;

  for (let m = 0; m < 12; m++) {
    const cal = periodsInMonth(tariff, m, pen);
    const ps = cal ?? Array.from({ length: n }, (_, i) => i + 1);
    if (!cal) basis = "envolvente";
    monthPeriods.push(ps);
    const row: (number | null)[] = Array(n).fill(null);
    const pm = periodMax?.[m];
    const hasPM = pm && pm.slice(0, n).some((x) => x != null);
    for (const p of ps) {
      if (hasPM && pm![p - 1] != null) {
        row[p - 1] = pm![p - 1];
        usedPeriodTable = true;
      } else row[p - 1] = monthly[m];
    }
    demand.push(row);
  }

  if (!cal0(tariff, pen)) notes.push("Suministro fuera de la península o provincia desconocida: se usa la envolvente anual en todos los periodos.");
  if (monthsKnown === 0) {
    if (s.potAnual != null) {
      basis = "anual";
      notes.push("Sin máximas mensuales: se usa la Pot. Anual como cota de todos los periodos.");
      for (let m = 0; m < 12; m++) for (const p of monthPeriods[m]) demand[m][p - 1] = demand[m][p - 1] ?? s.potAnual;
    } else basis = "none";
  } else if (monthsKnown < 12) notes.push(`Solo ${monthsKnown} de 12 meses con máxima registrada: los meses sin dato no se pueden evaluar.`);
  if (usedPeriodTable) {
    basis = "medida_periodo";
    notes.push("Se usan los maxímetros por periodo introducidos (facturas) donde existen.");
  }

  const ub: (number | null)[] = Array(n).fill(null);
  for (let m = 0; m < 12; m++)
    for (let p = 0; p < n; p++) {
      const d = demand[m][p];
      if (d != null) ub[p] = Math.max(ub[p] ?? 0, d);
    }
  return { tariff, n, monthly, monthsKnown, monthPeriods, demand, ub, basis, notes };
}

function cal0(t: TariffCode, pen: boolean | null) {
  return periodsInMonth(t, 0, pen) != null;
}

export interface OptimizerInput {
  supply: Supply;
  tariff: TariffCode;
  prices: number[]; // €/kW·año por periodo
  excess45: number[]; // €/kW·día
  modCosts?: { extensionEurKW: number; accesoEurKW: number; fixedEur: number };
  periodMax?: PeriodMaxTable;
  maxKWOverride?: number | null;
}

export interface Evaluation {
  pc: number[];
  powerCost: number;
  excessWorst: number;
  excessComputable: boolean;
  belowDemand: number[]; // periodos donde Pc < demanda cota
  violations: string[];
  modCost: number;
  modBreakdown: { label: string; eur: number }[];
}

function modCost(s: Supply, current: number[], pc: number[], costs = defaultModCosts()) {
  const changed = pc.some((v, i) => Math.abs(v - (current[i] ?? 0)) > 1e-9);
  const br: { label: string; eur: number }[] = [];
  if (!changed) return { total: 0, br };
  const maxNew = Math.max(...pc);
  const curMax = Math.max(0, ...current);
  const acc = s.derechosAcceso ?? curMax;
  const ext = s.derechosExtension ?? curMax;
  const extraAcc = Math.max(0, maxNew - acc);
  const extraExt = Math.max(0, maxNew - ext);
  if (extraAcc > 0) br.push({ label: `Derechos de acceso (${extraAcc.toFixed(1)} kW sobre reconocidos)`, eur: extraAcc * costs.accesoEurKW });
  if (extraExt > 0) br.push({ label: `Derechos de extensión (${extraExt.toFixed(1)} kW sobre reconocidos)`, eur: extraExt * costs.extensionEurKW });
  if (costs.fixedEur > 0) br.push({ label: "Gestión / enganche (fijo configurable)", eur: costs.fixedEur });
  return { total: br.reduce((a, b) => a + b.eur, 0), br };
}

export function defaultModCosts() {
  return { extensionEurKW: ACOMETIDA_BT.extensionEurKW, accesoEurKW: ACOMETIDA_BT.accesoEurKW, fixedEur: ACOMETIDA_BT.engancheEur };
}

export function evaluate(inp: OptimizerInput, dm: DemandModel, pc: number[], mode: ControlMode, marginPct = 0): Evaluation {
  const n = dm.n;
  const v = pc.slice(0, n);
  const powerCost = v.reduce((a, x, i) => a + x * (inp.prices[i] ?? 0), 0);
  let excess = 0;
  const below = new Set<number>();
  for (let m = 0; m < 12; m++)
    for (const p of dm.monthPeriods[m]) {
      const d = dm.demand[m][p - 1];
      if (d == null) continue;
      const dd = d * (1 + marginPct / 100);
      const over = dd - v[p - 1];
      if (over > 1e-9) {
        below.add(p);
        if (mode === "maximetro45") excess += (inp.excess45[p - 1] ?? 0) * over * DAYS_IN_MONTH[m];
      }
    }
  const violations = checkRules(inp.tariff, v);
  const cap = inp.maxKWOverride ?? inp.supply.potMaxBIE;
  if (cap != null && v.some((x) => x > cap + 1e-9)) violations.push(`Supera la potencia máxima técnica (BIE ${cap} kW).`);
  if (mode === "icp" && below.size) violations.push(`Con control por ICP, P${[...below].join(", P")} queda por debajo de la demanda registrada: riesgo de cortes.`);
  const current = inp.supply.potContratada.slice(0, n).map((x) => x ?? 0);
  const mc = modCost(inp.supply, current, v, inp.modCosts);
  return {
    pc: v,
    powerCost,
    excessWorst: excess,
    excessComputable: mode === "maximetro45" || below.size === 0,
    belowDemand: [...below].sort(),
    violations,
    modCost: mc.total,
    modBreakdown: mc.br,
  };
}

export interface ScenarioDef {
  key: "conservador" | "equilibrado" | "maximo";
  label: string;
  marginPct: number;
  allowExcess: boolean;
  description: string;
}

export function scenarioDefs(mode: ControlMode): ScenarioDef[] {
  const ex = mode === "maximetro45";
  return [
    {
      key: "conservador",
      label: "Conservador",
      marginPct: 10,
      allowExcess: false,
      description: "Cubre la demanda cota de cada periodo +10 %. Sin excesos en el peor caso.",
    },
    {
      key: "equilibrado",
      label: "Equilibrado",
      marginPct: 5,
      allowExcess: ex,
      description: ex
        ? "Minimiza término de potencia + excesos en el peor caso sobre demanda +5 %."
        : "Cubre la demanda cota +5 %. Sin excesos (control ICP o tipo 1-3 sin curva).",
    },
    {
      key: "maximo",
      label: "Máximo ahorro",
      marginPct: 0,
      allowExcess: ex,
      description: ex
        ? "Óptimo económico sin margen: admite excesos si compensan, valorados en el peor caso."
        : "Ajuste exacto a la demanda cota, sin margen y sin excesos.",
    },
  ];
}

/** Optimización exacta sobre rejilla (DP con prefijo mínimo para P1 ≤ … ≤ P6). */
export function optimize(inp: OptimizerInput, dm: DemandModel, mode: ControlMode, def: ScenarioDef) {
  const rules = tariffRules(inp.tariff);
  const n = dm.n;
  const step = rules.step;
  const mf = 1 + def.marginPct / 100;
  const allowExcess = def.allowExcess && mode === "maximetro45";
  const ubMax = Math.max(0, ...dm.ub.map((x) => x ?? 0));
  const curMax = maxContracted(inp.supply) ?? 0;
  const cap = inp.maxKWOverride ?? inp.supply.potMaxBIE;
  let hi = Math.max(ubMax * mf * 1.3, curMax, rules.minOneAboveKW != null ? rules.minOneAboveKW + step : 0, step * 2);
  if (rules.maxKW != null) hi = Math.min(hi, rules.maxKW);
  const capNote: string[] = [];
  if (cap != null && cap > 0) {
    if (cap < ubMax * mf) capNote.push(`La BIE (${cap} kW) es inferior a la demanda cota con margen: se ignora el tope BIE para ofrecer una solución.`);
    else hi = Math.min(hi, cap);
  }
  const G = Math.max(1, Math.floor(hi / step + 1e-9));
  const grid = Array.from({ length: G }, (_, i) => round(step * (i + 1), step));

  const cost: number[][] = [];
  for (let p = 0; p < n; p++) {
    const months: { d: number; days: number }[] = [];
    for (let m = 0; m < 12; m++)
      if (dm.monthPeriods[m].includes(p + 1) && dm.demand[m][p] != null) months.push({ d: dm.demand[m][p]! * mf, days: DAYS_IN_MONTH[m] });
    const need = dm.ub[p] != null ? dm.ub[p]! * mf : 0;
    cost.push(
      grid.map((v) => {
        let c = v * (inp.prices[p] ?? 0);
        if (allowExcess) {
          for (const { d, days } of months) if (d > v) c += (inp.excess45[p] ?? 0) * (d - v) * days;
        } else if (v + 1e-9 < need) return Infinity;
        return c;
      }),
    );
  }
  // P6 > 15 kW en 3.0TD (con monotonía basta con el último periodo)
  if (rules.minOneAboveKW != null)
    cost[n - 1] = cost[n - 1].map((c, i) => (grid[i] > rules.minOneAboveKW! ? c : Infinity));

  let pc: number[];
  if (!rules.monotone) {
    pc = cost.map((row) => grid[argmin(row)]);
  } else {
    const best: number[][] = [];
    const arg: number[][] = [];
    best[0] = cost[0].slice();
    for (let p = 1; p < n; p++) {
      best[p] = [];
      arg[p] = [];
      let pm = Infinity;
      let pa = 0;
      for (let i = 0; i < G; i++) {
        if (best[p - 1][i] < pm) {
          pm = best[p - 1][i];
          pa = i;
        }
        best[p][i] = cost[p][i] + pm;
        arg[p][i] = pa;
      }
    }
    let i = argmin(best[n - 1]);
    pc = Array(n);
    for (let p = n - 1; p >= 0; p--) {
      pc[p] = grid[i];
      if (p > 0) i = arg[p][i];
    }
  }
  const feasible = pc.every((v) => Number.isFinite(v));
  return { pc, feasible, notes: capNote };
}

function argmin(a: number[]) {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] < a[b]) b = i;
  return b;
}
function round(x: number, step: number) {
  const k = 1 / step;
  return Math.round(x * k) / k;
}

/* ---------- Diagnóstico completo ---------- */

export interface ScenarioResult extends Evaluation {
  def: ScenarioDef;
  feasible: boolean;
  powerSaving: number;
  netSavingLB: number;
  paybackMonths: number | null;
  reductionKW: number[];
  notes: string[];
}

export interface Confidence {
  score: number;
  level: "Media (preliminar)" | "Baja" | "Muy baja" | "Alta";
  reasons: string[];
  needed: string[];
}

export interface OptimizerResult {
  ok: boolean;
  reason?: string;
  tariff: TariffCode;
  mode: ReturnType<typeof controlMode>;
  dm: DemandModel;
  current: Evaluation;
  scenarios: ScenarioResult[];
  confidence: Confidence;
  utilization: (number | null)[];
}

export function runOptimizer(inp: OptimizerInput, opts?: { priceValidTo?: string; today?: string; only?: ScenarioDef["key"] }): OptimizerResult {
  const s = inp.supply;
  const t = inp.tariff;
  const mode = controlMode(t, s.tipoPM, s.ctrlPotencia, maxContracted(s));
  const dm = buildDemandModel(s, t, inp.periodMax);
  const n = dm.n;
  const curPc = s.potContratada.slice(0, n);
  const confidence = assessConfidence(s, dm, mode, opts);
  const utilization = dm.ub.map((u, i) => (u != null && curPc[i] ? u / curPc[i]! : null));
  const empty: Evaluation = {
    pc: [],
    powerCost: 0,
    excessWorst: 0,
    excessComputable: false,
    belowDemand: [],
    violations: [],
    modCost: 0,
    modBreakdown: [],
  };
  if (curPc.some((x) => x == null))
    return { ok: false, reason: "Faltan potencias contratadas en algún periodo.", tariff: t, mode, dm, current: empty, scenarios: [], confidence, utilization };
  if (dm.basis === "none")
    return { ok: false, reason: "No hay potencias registradas (mensuales ni anual): no es posible optimizar.", tariff: t, mode, dm, current: empty, scenarios: [], confidence, utilization };

  const current = evaluate(inp, dm, curPc as number[], mode.mode, 0);
  const scenarios = scenarioDefs(mode.mode)
    .filter((d) => !opts?.only || d.key === opts.only)
    .map((def) => {
    const o = optimize(inp, dm, mode.mode, def);
    const ev = evaluate(inp, dm, o.pc, mode.mode, 0);
    const powerSaving = current.powerCost - ev.powerCost;
    const netSavingLB = powerSaving - ev.excessWorst;
    return {
      ...ev,
      def,
      feasible: o.feasible,
      powerSaving,
      netSavingLB,
      paybackMonths: netSavingLB > 0 ? (ev.modCost / netSavingLB) * 12 : null,
      reductionKW: ev.pc.map((v, i) => (curPc[i] as number) - v),
      notes: o.notes,
    } satisfies ScenarioResult;
  });
  return { ok: true, tariff: t, mode, dm, current, scenarios, confidence, utilization };
}

export function assessConfidence(s: Supply, dm: DemandModel, mode: ReturnType<typeof controlMode>, opts?: { priceValidTo?: string; today?: string }): Confidence {
  const reasons: string[] = [];
  const needed: string[] = [];
  let score = 70;
  if (dm.basis === "medida_periodo") {
    score = 85;
    reasons.push("Maxímetros por periodo introducidos desde facturas.");
  } else {
    reasons.push("El Excel solo contiene máximas mensuales agregadas (sin desglose P1–P6): la demanda por periodo se acota por temporadas.");
    needed.push("Maxímetros por periodo de las últimas 12 facturas");
  }
  if (dm.basis === "envolvente") {
    score -= 15;
    reasons.push("Sin calendario de temporadas aplicable: envolvente anual.");
  }
  if (dm.basis === "anual") {
    score -= 30;
    reasons.push("Solo se dispone de la potencia anual.");
  }
  if (dm.monthsKnown < 12) {
    score -= (12 - dm.monthsKnown) * 4;
    reasons.push(`${12 - dm.monthsKnown} meses sin máxima registrada.`);
  }
  if (mode.inferred) {
    score -= 10;
    reasons.push("Tipo de punto de medida inferido a partir de la potencia.");
    needed.push("Confirmar tipo de punto de medida y sistema de control");
  }
  if (mode.mode === "cuartohorario13") {
    score -= 10;
    reasons.push("Tipo 1-3: los excesos dependen de la curva cuartohoraria, no disponible.");
    needed.push("Curva de carga cuartohoraria de 12 meses (distribuidora / Datadis)");
  }
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);
  if (opts?.priceValidTo && opts.priceValidTo < today) {
    score -= 10;
    reasons.push("Los precios de potencia seleccionados han superado su fecha de validez.");
  }
  if (s.fUltLectura) {
    const age = (Date.parse(today) - Date.parse(s.fUltLectura)) / 86400000;
    if (age > 90) {
      score -= 10;
      reasons.push(`Última lectura con ${Math.round(age)} días de antigüedad.`);
    }
  }
  if (s.source.demo) reasons.push("Datos sintéticos de demostración.");
  needed.push("Últimas 12 facturas para contrastar potencias facturadas");
  score = Math.max(0, Math.min(100, score));
  const level: Confidence["level"] = dm.basis === "medida_periodo" && score >= 75 ? "Alta" : score >= 55 ? "Media (preliminar)" : score >= 30 ? "Baja" : "Muy baja";
  return { score, level, reasons, needed: [...new Set(needed)] };
}
