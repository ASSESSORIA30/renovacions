/**
 * Energy cost comparison. Pure, deterministic and explicit about assumptions.
 * Never invents prices: every € figure comes from inputs (current prices typed by the user,
 * offer prices from the verified offers table, taxes from Settings).
 */
import type { Offer, Settings } from "./types";

export const PERIODS: Record<string, { energy: number; power: number }> = {
  "2.0TD": { energy: 3, power: 2 },
  "3.0TD": { energy: 6, power: 6 },
  "6.1TD": { energy: 6, power: 6 },
};

export function periodsFor(tarifa?: string | null) {
  const t = (tarifa ?? "").toUpperCase();
  const k = Object.keys(PERIODS).find((p) => t.includes(p.replace("TD", "")));
  if (k) return { ...PERIODS[k], gas: false, key: k };
  if (/RL/.test(t)) return { energy: 1, power: 0, gas: true, key: t.replace(/.*(RL\d).*/, "$1") };
  return { energy: 1, power: 1, gas: false, key: t || "—" };
}

export interface PriceSet {
  energia: (number | null)[]; // €/kWh
  potencia: (number | null)[]; // €/kW·día
  cuotaFijaMes?: number | null; // €/mes
  fijoDia?: number | null; // €/día (gas)
}

export interface CompareInput {
  tarifa: string | null;
  kwhPorPeriodo: (number | null)[];
  kwPorPeriodo: (number | null)[];
  actual: PriceSet;
  propuesta: Offer;
  settings: Settings;
  dias?: number;
  lang?: "ca" | "es";
  /**
   * Mecanisme d'ajust (SAS / RDL 10/2022) en €/kWh sobre tot el consum, quan correspongui.
   * Només s'aplica si `incluir` és cert; llavors els dos valors són obligatoris (0 és vàlid).
   */
  ajuste?: { incluir: boolean; actual: number | null; propuesta: number | null };
}

export interface CostBreakdown {
  energia: number;
  /** Mecanisme d'ajust (0 si no s'inclou). */
  ajuste: number;
  potencia: number;
  fijo: number;
  iee: number;
  alquiler: number;
  baseIva: number;
  iva: number;
  total: number;
  sinImpuestos: number;
}

export type CompareResult =
  | { ok: true; actual: CostBreakdown; nuevo: CostBreakdown; ahorro: number; ahorroSinImpuestos: number; ahorroPct: number; hipotesis: string[] }
  | { ok: false; faltan: string[] };

export function compare(i: CompareInput): CompareResult {
  const per = periodsFor(i.tarifa);
  const dias = i.dias ?? 365;
  const faltan: string[] = [];
  const kwh = i.kwhPorPeriodo.slice(0, per.energy);
  const kw = i.kwPorPeriodo.slice(0, per.power);
  kwh.forEach((v, n) => v == null && faltan.push(`Consum P${n + 1} (kWh)`));
  kw.forEach((v, n) => v == null && faltan.push(`Potència P${n + 1} (kW)`));
  for (let n = 0; n < per.energy; n++) {
    if (i.actual.energia[n] == null) faltan.push(`Preu energia actual P${n + 1}`);
    if (i.propuesta.energia[n] == null) faltan.push(`Preu energia oferta P${n + 1}`);
  }
  for (let n = 0; n < per.power; n++) {
    if (i.actual.potencia[n] == null) faltan.push(`Preu potència actual P${n + 1}`);
    if (i.propuesta.potencia[n] == null) faltan.push(`Preu potència oferta P${n + 1}`);
  }
  if (i.ajuste?.incluir) {
    if (i.ajuste.actual == null) faltan.push("Mecanisme d'ajust actual (€/kWh)");
    if (i.ajuste.propuesta == null) faltan.push("Mecanisme d'ajust de l'oferta (€/kWh)");
  }
  if (faltan.length) return { ok: false, faltan };
  const totalKwh = kwh.reduce<number>((a, v) => a + (v ?? 0), 0);

  const cost = (p: PriceSet, ajusteKwh: number): CostBreakdown => {
    const energia = kwh.reduce<number>((a, v, n) => a + (v ?? 0) * (p.energia[n] ?? 0), 0);
    const ajuste = i.ajuste?.incluir ? totalKwh * ajusteKwh : 0;
    const potencia = kw.reduce<number>((a, v, n) => a + (v ?? 0) * (p.potencia[n] ?? 0) * dias, 0);
    const fijo = (p.cuotaFijaMes ?? 0) * 12 * (dias / 365) + (p.fijoDia ?? 0) * dias;
    const iee = per.gas ? 0 : ((energia + ajuste + potencia) * i.settings.iee) / 100;
    const alquiler = i.settings.alquilerContadorMes * 12 * (dias / 365);
    const sinImpuestos = energia + ajuste + potencia + fijo + alquiler;
    const baseIva = sinImpuestos + iee;
    const iva = (baseIva * i.settings.iva) / 100;
    return { energia, ajuste, potencia, fijo, iee, alquiler, baseIva, iva, total: baseIva + iva, sinImpuestos };
  };
  const a = cost(i.actual, i.ajuste?.actual ?? 0);
  const b = cost({ energia: i.propuesta.energia, potencia: i.propuesta.potencia, cuotaFijaMes: i.propuesta.cuotaFijaMes, fijoDia: i.propuesta.fijoDia }, i.ajuste?.propuesta ?? 0);
  const ahorro = a.total - b.total;
  return {
    ok: true,
    actual: a,
    nuevo: b,
    ahorro,
    ahorroSinImpuestos: a.sinImpuestos - b.sinImpuestos,
    ahorroPct: a.total ? (ahorro / a.total) * 100 : 0,
    hipotesis: hypotheses(i, per, kwh, kw, dias),
  };
}

export const fmtN = (n: number, d = 0) => n.toLocaleString("ca-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtEUR = (n: number) => n.toLocaleString("ca-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

function hypotheses(i: CompareInput, per: ReturnType<typeof periodsFor>, kwh: (number | null)[], kw: (number | null)[], dias: number): string[] {
  const es = i.lang === "es";
  const idx = i.propuesta.meta?.tipoPrecio && /index/i.test(i.propuesta.meta.tipoPrecio);
  const mes = i.propuesta.meta?.mesIndexado;
  return [
    es ? `Periodo de cálculo: ${dias} días.` : `Període de càlcul: ${dias} dies.`,
    `${es ? "Consumo por periodo" : "Consum per període"} (kWh): ${kwh.map((v, n) => `P${n + 1} ${fmtN(v ?? 0)}`).join(" · ")}.`,
    per.power
      ? `${es ? "Potencia contratada" : "Potència contractada"} (kW): ${kw.map((v, n) => `P${n + 1} ${fmtN(v ?? 0, 2)}`).join(" · ")}.`
      : es ? "Gas: sin término de potencia; término fijo en €/día." : "Gas: sense terme de potència; terme fix en €/dia.",
    ...(idx ? [es ? `Oferta indexada: el precio de energía es el precio medio${mes ? ` de ${mes}` : ""}; la factura real variará con el mercado.` : `Oferta indexada: el preu de l'energia és el preu mitjà${mes ? ` de ${mes}` : ""}; la factura real variarà amb el mercat.`] : []),
    per.gas
      ? es ? "Impuesto de hidrocarburos no incluido (no configurado)." : "Impost d'hidrocarburs no inclòs (no configurat)."
      : es ? `Impuesto eléctrico: ${i.settings.iee}% sobre energía + potencia.` : `Impost elèctric: ${i.settings.iee}% sobre energia + potència.`,
    es ? `Alquiler de equipos: ${fmtN(i.settings.alquilerContadorMes, 2)} €/mes (igual en ambos escenarios).` : `Lloguer d'equips: ${fmtN(i.settings.alquilerContadorMes, 2)} €/mes (igual en tots dos escenaris).`,
    `IVA: ${i.settings.iva}%.`,
    ...(i.ajuste?.incluir
      ? [es ? `Mecanismo de ajuste incluido: actual ${fmtN(i.ajuste.actual ?? 0, 6)} €/kWh, propuesta ${fmtN(i.ajuste.propuesta ?? 0, 6)} €/kWh sobre el consumo total; su valor real varía cada mes.` : `Mecanisme d'ajust inclòs: actual ${fmtN(i.ajuste.actual ?? 0, 6)} €/kWh, proposta ${fmtN(i.ajuste.propuesta ?? 0, 6)} €/kWh sobre el consum total; el valor real varia cada mes.`]
      : []),
    es ? "Precios actuales introducidos manualmente a partir de la factura; precios propuestos de la oferta seleccionada." : "Preus actuals introduïts manualment a partir de la factura; preus proposats de l'oferta seleccionada.",
    i.ajuste?.incluir
      ? es ? "No incluye servicios adicionales, excesos de potencia ni reactiva salvo que estén incluidos en los precios." : "No inclou serveis addicionals, excessos de potència ni reactiva tret que estiguin inclosos als preus."
      : es ? "No incluye servicios adicionales, mecanismos de ajuste, excesos de potencia ni reactiva salvo que estén incluidos en los precios." : "No inclou serveis addicionals, mecanismes d'ajust, excessos de potència ni reactiva tret que estiguin inclosos als preus.",
  ];
}
