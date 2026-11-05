/**
 * ENERGY MARKET — comparador comercial de ofertas.
 *
 * Calidad de datos de consumo por periodo:
 *  - "factura": kWh por periodo introducidos desde facturas → coste exacto según oferta.
 *  - "hipotesis": reparto % introducido por el comercial → orientativo.
 *  - "rango": sin reparto → se calcula el rango garantizado [mín, máx] del
 *    término de energía (todo el consumo al precio más bajo / más alto).
 */
import { energyPeriods, powerPeriods, type TariffCode } from "./tariffs";
import type { Supply } from "./types";
import { annualActive } from "./parse";

export interface Offer {
  id: string;
  comercializadora: string;
  nombre: string;
  tarifa: TariffCode;
  energia: number[]; // €/kWh P1..P6 (2.0TD: 3)
  potencia: number[]; // €/kW·año P1..P6 (2.0TD: 2)
  sas: { applies: boolean; eurPerKWh: number | null; note: string };
  servicios: { nombre: string; eurMes: number }[];
  alquilerEurMes: number;
  ieePct: number;
  ivaPct: number;
  validFrom: string;
  validTo: string;
  condiciones: string;
  origen: string;
  esActual?: boolean;
}

export type ConsumptionMode = "rango" | "hipotesis" | "factura";

export interface ConsumptionScenario {
  mode: ConsumptionMode;
  annualKWh: number;
  /** kWh por periodo (factura) o fracciones (hipótesis, suman 1). */
  values: number[];
  label: string;
}

export interface OfferCost {
  offer: Offer;
  energyMin: number;
  energyMax: number;
  energy: number | null; // exacto/orientativo
  sas: number;
  power: number;
  services: number;
  rental: number;
  iee: number;
  iva: number;
  totalMin: number;
  totalMax: number;
  total: number | null;
  quality: "exacto" | "orientativo" | "rango";
  issues: string[];
}

export const IEE_DEFAULT = 5.11269632;
export const IVA_DEFAULT = 21;

export function costOffer(offer: Offer, supply: Supply, sc: ConsumptionScenario, opts?: { today?: string }): OfferCost {
  const issues: string[] = [];
  const t = offer.tarifa;
  const ne = energyPeriods(t);
  const np = powerPeriods(t);
  if (supply.tarifa && supply.tarifa !== t) issues.push(`La oferta es para ${t} y el suministro tiene ${supply.tarifa}.`);
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);
  if (offer.validTo && offer.validTo < today) issues.push("Oferta fuera de su fecha de validez.");
  const prices = offer.energia.slice(0, ne);
  const pc = supply.potContratada.slice(0, np).map((x) => x ?? 0);
  if (supply.potContratada.slice(0, np).some((x) => x == null)) issues.push("Faltan potencias contratadas: término de potencia incompleto.");
  const power = pc.reduce((a, v, i) => a + v * (offer.potencia[i] ?? 0), 0);
  const A = sc.annualKWh;
  const energyMin = A * Math.min(...prices);
  const energyMax = A * Math.max(...prices);
  let energy: number | null = null;
  let quality: OfferCost["quality"] = "rango";
  if (sc.mode === "factura") {
    energy = sc.values.slice(0, ne).reduce((a, k, i) => a + k * prices[i], 0);
    quality = "exacto";
    const sum = sc.values.slice(0, ne).reduce((a, b) => a + b, 0);
    if (A > 0 && Math.abs(sum - A) / A > 0.05) issues.push("Los kWh por periodo de la factura difieren > 5 % del consumo anual del SIPS.");
  } else if (sc.mode === "hipotesis") {
    energy = sc.values.slice(0, ne).reduce((a, f, i) => a + f * A * prices[i], 0);
    quality = "orientativo";
  }
  const sasKWh = sc.mode === "factura" ? sc.values.slice(0, ne).reduce((a, b) => a + b, 0) : A;
  const sas = offer.sas.applies && offer.sas.eurPerKWh != null ? offer.sas.eurPerKWh * sasKWh : 0;
  if (offer.sas.applies && offer.sas.eurPerKWh == null) issues.push("La oferta aplica ajuste SAS sin valor estimado: no incluido.");
  const services = offer.servicios.reduce((a, s) => a + s.eurMes * 12, 0);
  const rental = offer.alquilerEurMes * 12;
  const tax = (e: number) => {
    const iee = ((e + sas + power) * offer.ieePct) / 100;
    const iva = ((e + sas + power + iee + rental + services) * offer.ivaPct) / 100;
    return { iee, iva, total: e + sas + power + iee + rental + services + iva };
  };
  const tMin = tax(energyMin);
  const tMax = tax(energyMax);
  const tE = energy != null ? tax(energy) : null;
  return {
    offer,
    energyMin,
    energyMax,
    energy,
    sas,
    power,
    services,
    rental,
    iee: tE?.iee ?? tMin.iee,
    iva: tE?.iva ?? tMin.iva,
    totalMin: tMin.total,
    totalMax: tMax.total,
    total: tE?.total ?? null,
    quality,
    issues,
  };
}

export function defaultScenario(s: Supply): ConsumptionScenario {
  const a = annualActive(s).value ?? 0;
  return { mode: "rango", annualKWh: a, values: [], label: "Sin reparto por periodos (rango garantizado)" };
}

/** Comparación honesta: ahorro solo si ambos costes son del mismo tipo (exacto/orientativo). */
export function savingVs(current: OfferCost, alt: OfferCost) {
  if (current.total != null && alt.total != null) return { kind: current.quality === "exacto" ? "exacto" : "orientativo", value: current.total - alt.total } as const;
  // Con rangos: ahorro garantizado si el máximo de la alternativa < mínimo del actual
  const guaranteed = current.totalMin - alt.totalMax;
  const possible = current.totalMax - alt.totalMin;
  return { kind: "rango", min: guaranteed, max: possible } as const;
}

export function blankOffer(t: TariffCode = "3.0TD"): Offer {
  return {
    id: crypto.randomUUID(),
    comercializadora: "",
    nombre: "",
    tarifa: t,
    energia: Array(6).fill(0),
    potencia: Array(6).fill(0),
    sas: { applies: false, eurPerKWh: null, note: "" },
    servicios: [],
    alquilerEurMes: 0,
    ieePct: IEE_DEFAULT,
    ivaPct: IVA_DEFAULT,
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: "",
    condiciones: "",
    origen: "Introducida manualmente",
  };
}
