/**
 * Base normativa de peajes y cargos (España). Cada valor lleva su fuente.
 *
 * - Peajes T&D 2026: Resolución CNMC de 18/12/2025 (BOE-A-2025-26348), Anexos I, II y III.
 * - Cargos 2026: Orden TED/1524/2025, de 23/12/2025 (BOE-A-2025-26705). Segmentos 1..6 = 2.0TD, 3.0TD, 6.1TD, 6.2TD, 6.3TD, 6.4TD.
 * - Metodología de excesos: art. 9.4 Circular 3/2020 CNMC, modificada por Circular 1/2025 (en vigor 01/04/2025).
 * - Derechos de acometida: RD 1048/2013 (importes BT).
 *
 * Los precios son configurables en la plataforma (Ajustes) para nuevas resoluciones.
 */

export type TariffCode = "2.0TD" | "3.0TD" | "6.1TD" | "6.2TD" | "6.3TD" | "6.4TD";
export const TARIFFS: TariffCode[] = ["2.0TD", "3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD"];

export type P6 = [number, number, number, number, number, number];

export interface Source {
  label: string;
  ref: string;
  url?: string;
}

export const SOURCES = {
  peajes2026: {
    label: "Peajes T&D 2026",
    ref: "Resolución CNMC 18/12/2025 · BOE-A-2025-26348",
    url: "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-26348",
  },
  cargos2026: {
    label: "Cargos 2026",
    ref: "Orden TED/1524/2025 · BOE-A-2025-26705",
    url: "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-26705",
  },
  excesos: {
    label: "Facturación de excesos",
    ref: "Circular 3/2020 art. 9.4, mod. Circular 1/2025 · BOE-A-2025-2044",
    url: "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-2044",
  },
  derechos: { label: "Derechos de acometida", ref: "RD 1048/2013 (importes BT)" },
} satisfies Record<string, Source>;

/** Número de periodos de potencia por peaje. */
export function powerPeriods(t: TariffCode): number {
  return t === "2.0TD" ? 2 : 6;
}
/** Número de periodos de energía por peaje. */
export function energyPeriods(t: TariffCode): number {
  return t === "2.0TD" ? 3 : 6;
}

const z = 0;
export interface RegulatedSet {
  id: string;
  label: string;
  validFrom: string;
  validTo: string;
  /** Término de potencia del peaje T&D (€/kW·año). */
  peajePot: Record<TariffCode, P6>;
  /** Término de potencia de los cargos (€/kW·año). */
  cargoPot: Record<TariffCode, P6>;
  /** tep 4-5 (€/kW·día) — puntos de medida tipo 4 y 5 con maxímetro. */
  excess45: Record<TariffCode, P6>;
  /** tep 1-3 (€/kW) — puntos de medida tipo 1, 2 y 3 (curva cuartohoraria). */
  excess13: Record<TariffCode, P6>;
  /** Reactiva inductiva P1–P5 (€/kVArh). */
  reactive: { cosFrom: number; price: number }[];
  sources: Source[];
}

export const REGULATED_2026: RegulatedSet = {
  id: "REG-2026",
  label: "Peajes CNMC 2026 + Cargos 2026",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  peajePot: {
    "2.0TD": [23.324952, 0.44377, z, z, z, z],
    "3.0TD": [14.935084, 7.894323, 2.502996, 1.907795, 0.535313, 0.535313],
    "6.1TD": [23.946498, 12.687713, 4.747747, 3.339695, 0.070979, 0.062703],
    "6.2TD": [16.786379, 9.455297, 2.502855, 1.521894, 0.059359, 0.052513],
    "6.3TD": [10.397365, 6.258717, 2.096386, 1.366437, 0.044362, 0.038723],
    "6.4TD": [6.606205, 3.935625, 0.987554, 0.686109, 0.020376, 0.013971],
  },
  cargoPot: {
    "2.0TD": [4.379461, 0.281653, z, z, z, z],
    "3.0TD": [5.441843, 2.723298, 1.978538, 1.978538, 1.978538, 0.906974],
    "6.1TD": [5.64887, 2.826996, 2.054134, 2.054134, 2.054134, 0.941478],
    "6.2TD": [3.317209, 1.660371, 1.206258, 1.206258, 1.206258, 0.552868],
    "6.3TD": [2.656027, 1.329146, 0.965679, 0.965679, 0.965679, 0.442671],
    "6.4TD": [1.29924, 0.650162, 0.472451, 0.472451, 0.472451, 0.21654],
  },
  excess45: {
    "2.0TD": [0.279426, 0.005316, z, z, z, z],
    "3.0TD": [0.171373, 0.090584, 0.028721, 0.021891, 0.006142, 0.006142],
    "6.1TD": [0.275735, 0.146094, 0.054668, 0.038455, 0.000817, 0.000722],
    "6.2TD": [0.173206, 0.097562, 0.025825, 0.015703, 0.000612, 0.000542],
    "6.3TD": [0.238584, 0.143616, 0.048105, 0.031355, 0.001018, 0.000889],
    "6.4TD": [0.186364, 0.111026, 0.027859, 0.019355, 0.000575, 0.000394],
  },
  excess13: {
    "2.0TD": [2.96885, 0.056473, z, z, z, z],
    "3.0TD": [3.325715, 1.757877, 0.557353, 0.424794, 0.119179, 0.119179],
    "6.1TD": [3.431797, 1.818277, 0.680379, 0.478581, 0.010172, 0.008984],
    "6.2TD": [3.243495, 1.826897, 0.483612, 0.294055, 0.011467, 0.010143],
    "6.3TD": [3.063808, 1.844204, 0.617738, 0.402624, 0.013069, 0.011406],
    "6.4TD": [2.736629, 1.630338, 0.409096, 0.284221, 0.008441, 0.005787],
  },
  reactive: [
    { cosFrom: 0.95, price: 0 },
    { cosFrom: 0.8, price: 0.041554 },
    { cosFrom: 0, price: 0.062332 },
  ],
  sources: [SOURCES.peajes2026, SOURCES.cargos2026, SOURCES.excesos],
};

/** Término de potencia ATR regulado (peaje + cargo), €/kW·año. */
export function regulatedPowerPrice(set: RegulatedSet, t: TariffCode): P6 {
  return set.peajePot[t].map((v, i) => round6(v + set.cargoPot[t][i])) as P6;
}

export const ACOMETIDA_BT = {
  extensionEurKW: 17.374714,
  accesoEurKW: 19.703137,
  engancheEur: 9.04476,
  verificacionEur: 8.011716,
};

/* ---------- Normalización ---------- */

const CODE_MAP: Record<string, TariffCode> = {
  "018": "2.0TD",
  "019": "3.0TD",
  "020": "6.1TD",
  "021": "6.2TD",
  "022": "6.3TD",
  "023": "6.4TD",
};

export function normalizeTariff(raw: unknown): { code: TariffCode | null; variant?: string } {
  if (raw == null) return { code: null };
  const s = String(raw).toUpperCase().replace(/\s+/g, "").replace(",", ".");
  if (CODE_MAP[s]) return { code: CODE_MAP[s] };
  const m = /^(2\.0|3\.0|6\.1|6\.2|6\.3|6\.4)(A|TD)?(VE)?/.exec(s);
  if (!m) return { code: null };
  if (m[3]) return { code: null, variant: `${m[1]}TDVE` }; // recarga VE: estructura distinta
  if (m[2] === "A") return { code: null, variant: `${m[1]}A (tarifa derogada)` };
  return { code: `${m[1]}TD` as TariffCode };
}

/* ---------- Calendario de temporadas (peninsular) ---------- */

const NON_PENINSULAR = ["baleares", "illesbalears", "balears", "laspalmas", "santacruzdetenerife", "ceuta", "melilla"];

export function isPeninsular(provincia: string | null): boolean | null {
  if (!provincia) return null;
  const p = provincia
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return !NON_PENINSULAR.some((x) => p.includes(x));
}

/**
 * Periodos de potencia presentes en cada mes (0 = enero).
 * 6 periodos, península (Circular 3/2020): alta (ene, feb, jul, dic) P1,P2,P6;
 * media-alta (mar, nov) P2,P3,P6; media (jun, ago, sep) P3,P4,P6; baja (abr, may, oct) P4,P5,P6.
 * 2.0TD: P1 (punta+llano) y P2 (valle) todos los meses.
 * Fuera de la península se devuelve null (calendario no implementado → envolvente anual).
 */
export function periodsInMonth(t: TariffCode, month: number, peninsular: boolean | null): number[] | null {
  if (t === "2.0TD") return [1, 2];
  if (peninsular !== true) return null;
  const alta = [0, 1, 6, 11];
  const mediaAlta = [2, 10];
  const media = [5, 7, 8];
  if (alta.includes(month)) return [1, 2, 6];
  if (mediaAlta.includes(month)) return [2, 3, 6];
  if (media.includes(month)) return [3, 4, 6];
  return [4, 5, 6];
}

/* ---------- Restricciones de contratación ---------- */

export interface TariffRules {
  periods: number;
  monotone: boolean; // Pn+1 >= Pn
  maxKW: number | null;
  minOneAboveKW: number | null; // al menos un periodo por encima
  step: number;
  notes: string[];
}

export function tariffRules(t: TariffCode): TariffRules {
  if (t === "2.0TD")
    return {
      periods: 2,
      monotone: false,
      maxKW: 15,
      minOneAboveKW: null,
      step: 0.1,
      notes: ["Potencia ≤ 15 kW en todos los periodos.", "P1 y P2 pueden contratarse con valores distintos."],
    };
  return {
    periods: 6,
    monotone: true,
    maxKW: null,
    minOneAboveKW: t === "3.0TD" ? 15 : null,
    step: 1,
    notes: [
      "La potencia de cada periodo debe ser ≥ a la del periodo anterior (P1 ≤ P2 ≤ … ≤ P6).",
      ...(t === "3.0TD" ? ["Al menos un periodo debe superar 15 kW."] : ["Tensión de suministro > 1 kV."]),
    ],
  };
}

export function checkRules(t: TariffCode, pc: number[]): string[] {
  const r = tariffRules(t);
  const v = pc.slice(0, r.periods);
  const errs: string[] = [];
  if (v.some((x) => !(x > 0))) errs.push("Todas las potencias deben ser > 0.");
  if (r.monotone) for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1] - 1e-9) errs.push(`P${i + 1} < P${i}: incumple P1 ≤ … ≤ P6.`);
  if (r.maxKW != null && v.some((x) => x > r.maxKW! + 1e-9)) errs.push(`Supera el máximo de ${r.maxKW} kW del peaje.`);
  if (r.minOneAboveKW != null && !v.some((x) => x > r.minOneAboveKW!)) errs.push(`Ningún periodo supera ${r.minOneAboveKW} kW.`);
  return errs;
}

/* ---------- Control de potencia y tipo de medida ---------- */

export type ControlMode = "icp" | "maximetro45" | "cuartohorario13";

export function inferMeterType(maxPc: number | null): number | null {
  if (maxPc == null) return null;
  if (maxPc <= 15) return 5;
  if (maxPc <= 50) return 4;
  if (maxPc <= 450) return 3;
  return 2;
}

export function controlMode(
  t: TariffCode,
  tipoPM: number | null,
  ctrlPotencia: string | null,
  maxPc: number | null,
): { mode: ControlMode; meterType: number | null; inferred: boolean; explanation: string } {
  const inferred = tipoPM == null;
  const tpm = tipoPM ?? inferMeterType(maxPc);
  const ctrl = (ctrlPotencia ?? "").toUpperCase();
  const isMax = /MAX/.test(ctrl);
  if (tpm != null && tpm <= 3)
    return {
      mode: "cuartohorario13",
      meterType: tpm,
      inferred,
      explanation: "Punto tipo 1-3: excesos sobre registros cuartohorarios (tep 1-3 · √Σ(Pdj−Pcp)²).",
    };
  if (tpm === 5 && !isMax)
    return {
      mode: "icp",
      meterType: tpm,
      inferred,
      explanation:
        "Punto tipo 5 con control por ICP/contador telegestionado: superar la potencia corta el suministro; no se facturan excesos.",
    };
  return {
    mode: "maximetro45",
    meterType: tpm,
    inferred,
    explanation: "Punto tipo 4/5 con maxímetro: excesos = tep 4-5 (€/kW·día) × (Pd − Pc) × días.",
  };
}

export function round6(x: number) {
  return Math.round(x * 1e6) / 1e6;
}
export function round2(x: number) {
  return Math.round(x * 100) / 100;
}
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
