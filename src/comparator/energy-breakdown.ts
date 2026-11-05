/**
 * ENERGIA DESGLOSSADA A LES FACTURES (lògica pura). Moltes comercialitzadores (sobretot indexades) separen el preu de
 * l'energia en conceptes: energia lliure, ATR (peatges i càrrecs), ajustos, descomptes… Aquí:
 *  1. es llegeixen els components per període, distingint PREUS (€/kWh) d'IMPORTS (€);
 *  2. es reconstrueix el preu unitari total de cada període sense comptar res dues vegades;
 *  3. si no es pot reconstruir amb certesa, el període queda «pendent de revisió».
 * Es conserven els valors originals de cada component (traçabilitat) i els calculats.
 */
import Decimal from "decimal.js-light";

export const ENERGY_CONCEPTS = ["lliure", "atr", "peatges", "carrecs", "ajust", "descompte", "altres", "energia"] as const;
export type EnergyConcept = (typeof ENERGY_CONCEPTS)[number];
export const ENERGY_CONCEPT_LABEL: Record<EnergyConcept, string> = {
  lliure: "Energia lliure", atr: "ATR (peatges i càrrecs)", peatges: "Peatges", carrecs: "Càrrecs", ajust: "Ajustos i serveis del sistema", descompte: "Descompte", altres: "Altres conceptes variables", energia: "Terme d'energia (total)",
};
/** Conceptes que SUMEN al preu de l'energia (el descompte resta; «energia» és un total, no un component). */
const ADDITIVE: EnergyConcept[] = ["lliure", "atr", "peatges", "carrecs", "ajust", "altres"];

export interface EnergyComponent {
  period: number; // 1..6
  concept: EnergyConcept;
  label: string;
  kwh: number | null;
  /** Preu unitari tal com consta a la factura (€/kWh) */
  unitPrice: number | null;
  /** Import tal com consta a la factura (€) */
  amount: number | null;
  page: number | null;
  method: "text" | "ia" | "manual";
  /** Valors originals llegits (no canvien quan l'usuari corregeix) */
  original?: { kwh: number | null; unitPrice: number | null; amount: number | null } | null;
}

export interface PeriodBreakdown {
  period: number;
  total: number | null;
  status: "reconstruit" | "directe" | "pendent";
  parts: { concept: EnergyConcept; label: string; unitPrice: number | null; calculated: boolean }[];
  note: string | null;
}

const num = (s: string) => {
  let t = s.trim().replace(/[^\d,.\-]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // 1.289 kWh = mil dos-cents…
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** Concepte d'un text (capçalera o línia). L'ordre importa: «energía libre» abans que «energía». */
export function conceptOf(text: string): EnergyConcept | null {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/descuento|bonificaci|descompte|dto\.?\s/.test(t)) return "descompte";
  if (/ajuste|servicios? de ajuste|ssaa|mecanismo de ajuste|\bsas\b|tope del gas|ajust/.test(t)) return "ajust";
  if (/energia\s+(libre|lliure)|termino\s+(de\s+)?energia\s+libre|coste\s+(de\s+(la\s+)?)?energia(\s+en)?\s+mercado|energia\s+(de\s+)?mercado|precio\s+mercado|omie/.test(t)) return "lliure";
  if (/\batr\b|peajes?\s+(de\s+acceso\s+)?y\s+cargos|peatges\s+i\s+carrecs/.test(t)) return "atr";
  if (/\bpeajes?\b|\bpeatges?\b/.test(t)) return "peatges";
  if (/\bcargos?\b|\bcarrecs?\b/.test(t)) return "carrecs";
  if (/energia\s+(activa|consumida)|termino\s+(de\s+)?energia|t\.\s*energia|consumo de energia/.test(t)) return "energia";
  return null;
}

const PRICE = String.raw`(\d+[.,]\d{3,6})\s*(?:€|eur|euros?)?\s*\/\s*kWh`;
const KWH = String.raw`([\d.]+(?:,\d+)?)\s*kWh`;
const AMOUNT = String.raw`(-?[\d.]+,\d{2})\s*€`;

/**
 * Llegeix els components d'energia del text de la factura. Formats habituals:
 *   «Término Energía ATR» + línies «P3: 1.289 kWh × 0,019279 €/kWh = 24,85 €»
 *   «Energía libre P3 1.289 kWh x 0,214655 €/kWh 276,69 €» (concepte i dades a la mateixa línia)
 *   «P3 Peajes 24,85 €» (només import: el preu es calcula si es coneix el consum)
 */
export function parseEnergyComponents(pages: string[]): EnergyComponent[] {
  const out: EnergyComponent[] = [];
  pages.forEach((raw, pi) => {
    let section: EnergyConcept | null = null;
    for (const line0 of raw.replace(/ /g, " ").split(/\n/)) {
      const line = line0.trim();
      if (!line) continue;
      const pm = /\b(?:P|Periodo\s*|Per[ií]ode\s*)([1-6])\b/i.exec(line);
      const own = conceptOf(line.replace(/\b(?:P|Periodo\s*)[1-6]\b.*$/i, "")) ?? (pm ? null : conceptOf(line));
      if (!pm) {
        // capçalera de secció (sense dades de període): «Término Energía ATR», «Energía libre»…
        const c = conceptOf(line);
        if (c) section = c;
        else if (/potencia|impuesto|iva|alquiler|total|excedent/i.test(line)) section = null;
        continue;
      }
      const concept = own ?? conceptOf(line) ?? section;
      if (!concept) continue;
      const period = Number(pm[1]);
      const after = line.slice(pm.index);
      if (/\bkW\b(?!h)|potencia/i.test(after) && !/kWh/i.test(after)) continue; // línia de potència
      const p = new RegExp(PRICE, "i").exec(after);
      const k = new RegExp(KWH, "i").exec(after);
      // import: l'últim «xx,yy €» que no sigui el preu (€/kWh)
      const amounts = [...after.matchAll(new RegExp(AMOUNT + String.raw`(?!\s*\/)`, "gi"))].map((m) => num(m[1]));
      const amount = amounts.length ? amounts[amounts.length - 1] : null;
      const unitPrice = p ? num(p[1]) : null;
      const kwh = k ? num(k[1]) : null;
      if (unitPrice == null && amount == null) continue;
      const neg = concept === "descompte";
      const c: EnergyComponent = { period, concept, label: line.slice(0, 120), kwh, unitPrice: unitPrice != null && neg ? Math.abs(unitPrice) : unitPrice, amount: amount != null && neg ? Math.abs(amount) : amount, page: pi + 1, method: "text" };
      c.original = { kwh: c.kwh, unitPrice: c.unitPrice, amount: c.amount };
      out.push(c);
    }
  });
  return out;
}

const r6 = (d: Decimal) => Number(d.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
const close = (a: number, b: number, tol = 0.000_05) => Math.abs(a - b) <= tol;

/** Preu unitari d'un component: el de la factura o, si només hi ha l'import, import ÷ consum (si es coneix). */
function unitOf(c: EnergyComponent, kwh: number | null): { v: number | null; calculated: boolean } {
  if (c.unitPrice != null) return { v: c.unitPrice, calculated: false };
  const base = c.kwh ?? kwh;
  if (c.amount != null && base != null && base > 0) return { v: r6(new Decimal(c.amount).div(base)), calculated: true };
  return { v: null, calculated: false };
}

/**
 * Reconstrueix el preu total de cada període. Regles anti doble comptabilització:
 *  - Si hi ha ATR i també peatges/càrrecs, aquests són el detall de l'ATR: s'ignoren si en sumen el mateix; si no quadren → pendent.
 *  - Si hi ha un «terme d'energia» total i també components, el total només s'accepta si coincideix amb la suma.
 *  - Sense energia lliure (o total) no hi ha preu complet: pendent.
 *  - Els descomptes en €/kWh resten; els descomptes en € sense base de consum no es reparteixen (pendent).
 */
export function reconstructEnergyPrices(components: EnergyComponent[], kwhByPeriod: (number | null)[] = []): PeriodBreakdown[] {
  const periods = [...new Set(components.map((c) => c.period))].sort();
  return periods.map((period) => {
    const cs = components.filter((c) => c.period === period);
    const kwh = cs.map((c) => c.kwh).find((x) => x != null) ?? kwhByPeriod[period - 1] ?? null;
    const parts: PeriodBreakdown["parts"] = [];
    const pending = (note: string): PeriodBreakdown => ({ period, total: null, status: "pendent", parts, note });
    const kwhs = [...new Set(cs.map((c) => c.kwh).filter((x) => x != null))];
    if (kwhs.length > 1) return pending(`Els components de P${period} tenen consums diferents (${kwhs.join(" / ")} kWh): revisa'ls`);
    const total = cs.filter((c) => c.concept === "energia");
    const comps = cs.filter((c) => ADDITIVE.includes(c.concept));
    const discounts = cs.filter((c) => c.concept === "descompte");
    for (const c of [...comps, ...discounts, ...total]) { const u = unitOf(c, kwh); parts.push({ concept: c.concept, label: c.label, unitPrice: u.v, calculated: u.calculated }); }
    if (!comps.length) {
      if (total.length === 1) { const u = unitOf(total[0], kwh); return u.v != null ? { period, total: u.v, status: "directe", parts, note: null } : pending(`P${period}: no es pot calcular el preu (falta el consum)`); }
      return pending(`P${period}: no s'ha trobat el preu de l'energia`);
    }
    // ATR + peatges/càrrecs: detall de l'ATR
    const atr = comps.filter((c) => c.concept === "atr");
    let used = comps;
    if (atr.length) {
      const detail = comps.filter((c) => c.concept === "peatges" || c.concept === "carrecs");
      if (detail.length) {
        const a = atr.reduce((s, c) => s + (unitOf(c, kwh).v ?? NaN), 0);
        const d = detail.reduce((s, c) => s + (unitOf(c, kwh).v ?? NaN), 0);
        if (!Number.isFinite(a) || !Number.isFinite(d) || !close(a, d)) return pending(`P${period}: l'ATR i els peatges/càrrecs no quadren (possible doble comptabilització)`);
        used = comps.filter((c) => c.concept !== "peatges" && c.concept !== "carrecs");
      }
    }
    if (!used.some((c) => c.concept === "lliure" || c.concept === "altres") && !total.length) return pending(`P${period}: només hi ha peatges/càrrecs; falta el preu de l'energia lliure`);
    let sum = new Decimal(0);
    for (const c of used) {
      const u = unitOf(c, kwh);
      if (u.v == null) return pending(`P${period}: «${c.label.slice(0, 40)}» només té import i no se'n coneix el consum`);
      sum = sum.plus(u.v);
    }
    for (const c of discounts) {
      if (c.unitPrice != null) sum = sum.minus(c.unitPrice);
      else if (c.amount != null && (c.kwh ?? kwh)) sum = sum.minus(new Decimal(c.amount).div((c.kwh ?? kwh)!));
      else return pending(`P${period}: descompte sense base de consum; revisa'l`);
    }
    const t = r6(sum);
    if (total.length) {
      const tv = unitOf(total[0], kwh).v;
      if (tv != null && !close(tv, t)) return pending(`P${period}: el terme d'energia (${tv}) no coincideix amb la suma dels components (${t})`);
    }
    return { period, total: t, status: "reconstruit", parts, note: null };
  });
}

/* ------------------------------------------------------------------ excedents a la factura */

export interface InvoiceSurplus { kwh: number | null; priceEurKwh: number | null; compensationEur: number | null; battery: boolean; batteryBalanceEur: number | null; page: number | null }

/** Excedents, preu i import compensat, i bateria virtual (saldo), si la factura en parla. */
export function parseInvoiceSurplus(pages: string[]): InvoiceSurplus | null {
  let out: InvoiceSurplus | null = null;
  pages.forEach((raw, pi) => {
    for (const line of raw.replace(/ /g, " ").split(/\n/)) {
      const t = line.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const isSurplus = /excedent|energia\s+(vertida|exportada|excedentaria|autoconsumo\s+excedentaria)|compensacion\s+(simplificada|de\s+excedentes)/.test(t);
      const isBattery = /bateria\s+virtual|monedero\s+solar|hucha\s+solar|saldo\s+solar/.test(t);
      if (!isSurplus && !isBattery) continue;
      out ??= { kwh: null, priceEurKwh: null, compensationEur: null, battery: false, batteryBalanceEur: null, page: pi + 1 };
      if (isBattery) {
        out.battery = true;
        const a = new RegExp(AMOUNT, "i").exec(line);
        if (a && /saldo|acumulad|disponible/.test(t)) out.batteryBalanceEur = Math.abs(num(a[1]) ?? 0);
      }
      if (isSurplus) {
        const k = new RegExp(KWH, "i").exec(line);
        const p = new RegExp(PRICE, "i").exec(line);
        const amounts = [...line.matchAll(new RegExp(AMOUNT + String.raw`(?!\s*\/)`, "gi"))].map((m) => num(m[1]));
        if (k && out.kwh == null) out.kwh = Math.abs(num(k[1]) ?? 0);
        if (p && out.priceEurKwh == null) out.priceEurKwh = num(p[1]);
        if (amounts.length && out.compensationEur == null) out.compensationEur = Math.abs(amounts[amounts.length - 1] ?? 0);
      }
    }
  });
  return out;
}
