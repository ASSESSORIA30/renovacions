/**
 * COMPARADOR FIX vs INDEXAT AMB ESCENARIS DE MERCAT (part pura, servidor i navegador, testejable).
 *
 *  · Cada oferta indexada porta la SEVA fórmula contractual (`IndexedFormula`): índex de referència, pèrdues,
 *    serveis d'ajust, marge (fee), altres components i costos regulats (peatges i càrrecs) si no van inclosos.
 *    No hi ha una fórmula comuna: si a l'oferta li falta un component imprescindible, el resultat és INCOMPLET.
 *  · El preu de mercat és una HIPÒTESI de l'usuari (escenari central per període, en €/MWh) i els escenaris
 *    baixista i alcista són desplaçaments configurables (%). No són previsions oficials.
 *  · El cost de cada escenari el calcula el mateix motor de sempre (`computeCost`): potència, impostos, lloguer…
 *  · Punt d'equilibri: el preu mitjà de mercat a partir del qual la indexada deixa de ser més barata que la fixa
 *    (es troba numèricament, sense suposar linealitat).
 */
import { computeCost } from "./engine";
import { SIX_PERIOD_TARIFFS, holidaySet, periodOf } from "./open-calendar";
import { DEFAULT_TAXES, type CostResult, type OfferVersion, type PriceSheet, type SupplyInput, type TaxConfig } from "./types";

export const INDEXES = ["OMIE", "OMIP", "PVPC", "MIBGAS", "TTF", "altres"] as const;
export type IndexName = (typeof INDEXES)[number];

/** Fórmula d'una oferta indexada: preu P = ((índex + SSAA + altres) × (1 + pèrdues P) + marge) / 1000 + regulats P  [€/kWh] */
export interface IndexedFormula {
  index: IndexName;
  /** Com s'aplica l'índex: preu horari, mitjana per període o mitjana mensual (informatiu per a les hipòtesis). */
  granularity: "horari" | "periodes" | "mensual";
  /** Pèrdues de xarxa (%) per període P1..P6; null = no indicades. */
  lossesPct: (number | null)[] | null;
  /** Serveis d'ajust i altres costos del sistema (€/MWh), si es repercuteixen a part. */
  ssaaEurMWh: number | null;
  /** Marge comercial / fee de la comercialitzadora (€/MWh). */
  marginEurMWh: number | null;
  /** Altres components (€/MWh): pagaments per capacitat, garanties d'origen… */
  otherEurMWh: number | null;
  /** Peatges i càrrecs (€/kWh) per període. Imprescindibles si `regulatedIncluded` és fals. */
  regulatedEurKwh: (number | null)[] | null;
  regulatedIncluded: boolean;
  /** Text literal de la fórmula al contracte (per traçabilitat). */
  contractText: string | null;
}

export const emptyFormula = (): IndexedFormula => ({ index: "OMIE", granularity: "horari", lossesPct: null, ssaaEurMWh: null, marginEurMWh: null, otherEurMWh: null, regulatedEurKwh: null, regulatedIncluded: false, contractText: null });

/** Components que falten per poder calcular (llista buida = es pot calcular). */
export function formulaMissing(f: IndexedFormula | null | undefined, periods: number): string[] {
  if (!f) return ["La fórmula contractual de l'oferta indexada"];
  const m: string[] = [];
  if (f.marginEurMWh == null) m.push("Marge comercial (€/MWh)");
  if (!f.lossesPct || f.lossesPct.slice(0, periods).some((x) => x == null)) m.push("Pèrdues per període (%)");
  if (!f.regulatedIncluded && (!f.regulatedEurKwh || f.regulatedEurKwh.slice(0, periods).some((x) => x == null))) m.push("Peatges i càrrecs per període (€/kWh)");
  return m;
}

/** Preus d'energia (€/kWh) per període d'una oferta indexada per a uns preus de mercat (€/MWh per període). */
export function indexedPrices(f: IndexedFormula, market: number[], periods: number): (number | null)[] {
  return Array.from({ length: 6 }, (_, i) => {
    if (i >= periods) return null;
    const idx = market[i] ?? market[0];
    if (idx == null) return null;
    const loss = (f.lossesPct?.[i] ?? 0) / 100;
    const reg = f.regulatedIncluded ? 0 : f.regulatedEurKwh?.[i] ?? 0;
    const eurMWh = (idx + (f.ssaaEurMWh ?? 0) + (f.otherEurMWh ?? 0)) * (1 + loss) + (f.marginEurMWh ?? 0);
    return Math.round((eurMWh / 1000 + reg) * 1e6) / 1e6;
  });
}

/* ======================================================================= escenaris */

export interface MarketInput {
  /** Escenari central: preu de mercat per període (€/MWh). Hipòtesi de l'usuari o d'una font autoritzada. */
  central: (number | null)[];
  lowPct: number; // p. ex. -20 (baixista)
  highPct: number; // p. ex. +20 (alcista)
  source: string; // d'on surt la hipòtesi (manual, OMIP… amb data)
  note?: string | null;
}
export const DEFAULT_SCENARIO_PCT = { low: -20, high: 20 } as const;

export type ScenarioKey = "baixista" | "central" | "alcista";
export interface IndexedScenarioResult { scenario: ScenarioKey; factor: number; avgMarket: number; prices: (number | null)[]; cost: CostResult; savingVsCurrent: number | null; diffVsFixed: number | null }
export interface IndexedResult {
  offerId: string; name: string; supplier: string; missing: string[]; complete: boolean;
  scenarios: IndexedScenarioResult[];
  /** Preu mitjà de mercat (€/MWh) on el cost iguala el de la millor fixa; null si no hi ha creuament en 0–1000 €/MWh. */
  breakEvenMarket: number | null;
  /** Variació del cost anual per cada +1 €/MWh de mercat (€). */
  sensitivityPerEurMWh: number | null;
  /** Diferència de cost entre l'escenari alcista i el baixista (€): exposició al mercat. */
  riskRange: number | null;
}
export interface MarketAnalysis {
  input: MarketInput;
  kwhTotal: number | null;
  kwhSource: "periodes" | "corba_horaria";
  current: { cost: number | null; ok: boolean };
  bestFixed: { offerId: string; name: string; supplier: string; cost: number; savingVsCurrent: number | null } | null;
  fixed: { offerId: string; name: string; supplier: string; cost: number | null; ok: boolean }[];
  indexed: IndexedResult[];
  curve: { market: number; fixed: number | null; indexed: Record<string, number | null> }[];
  hypotheses: string[];
  warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const isIndexed = (o: OfferVersion) => o.contractType === "indexat" || o.contractType === "mixt";
const avgWeighted = (prices: (number | null)[], kwh: (number | null)[], periods: number) => {
  let a = 0, w = 0;
  for (let i = 0; i < periods; i++) { const p = prices[i] ?? prices[0]; const k = kwh[i] ?? 0; if (p != null && k > 0) { a += p * k; w += k; } }
  if (w > 0) return a / w;
  const xs = prices.slice(0, periods).filter((x): x is number => x != null);
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
};

/** Full de preus d'una indexada per a un factor sobre l'escenari central. */
function sheetFor(o: OfferVersion, f: IndexedFormula, central: (number | null)[], factor: number, periods: number): PriceSheet {
  const market = central.map((x) => (x == null ? null : x * factor)) as number[];
  const prices = indexedPrices(f, market, periods);
  // es calcula com un preu per períodes (els components ja hi són tots): no s'hi tornen a sumar descomptes ni SAS
  return { ...o, contractType: "periodes", energy: prices, energy24h: null, indexedReference: null, sas: o.sas.mode === "variable" ? o.sas : { mode: "inclos", eurKwh: null } };
}

/** Anàlisi fix vs indexat per a un subministrament, amb escenaris i punt d'equilibri. */
export function analyzeMarket(p: { supply: SupplyInput; current: PriceSheet | null; offers: OfferVersion[]; market: MarketInput; taxes?: TaxConfig; periods: number }): MarketAnalysis {
  const taxes = p.taxes ?? DEFAULT_TAXES;
  p = { ...p, supply: withHourlyPeriods(p.supply) };
  const warnings: string[] = [];
  const hypotheses: string[] = [
    `Escenari central de mercat: ${p.market.central.slice(0, p.periods).map((x, i) => `P${i + 1} ${x ?? "—"}`).join(" · ")} €/MWh (${p.market.source || "hipòtesi manual"}).`,
    `Escenari baixista: ${p.market.lowPct > 0 ? "+" : ""}${p.market.lowPct} % · alcista: +${p.market.highPct} % sobre el central. Són hipòtesis configurables, no previsions oficials.`,
  ];
  const s = p.supply;
  if (s.hourly?.length) hypotheses.push(`Consum repartit per períodes a partir de la corba horària real (${s.hourly.length} hores).`);
  else hypotheses.push("Consum per períodes P1–P6 (sense corba horària): el cost de la indexada és una estimació amb preus mitjans per període.");
  const currentCost = p.current ? computeCost(p.current, s, taxes, { current: true }) : null;
  const fixed = p.offers.filter((o) => !isIndexed(o)).map((o) => { const c = computeCost(o, s, taxes); return { offerId: o.id, name: o.productName, supplier: o.supplierName, cost: c.ok ? c.total : null, ok: c.ok }; });
  const bf = fixed.filter((x) => x.ok && x.cost != null).sort((a, b) => a.cost! - b.cost!)[0] ?? null;
  const bestFixed = bf ? { offerId: bf.offerId, name: bf.name, supplier: bf.supplier, cost: bf.cost!, savingVsCurrent: currentCost?.ok ? r2(currentCost.total - bf.cost!) : null } : null;
  const centralAvg = avgWeighted(p.market.central, s.kwh, p.periods);
  if (!(centralAvg > 0)) warnings.push("Falta l'escenari central de mercat (€/MWh): no es poden calcular les indexades.");

  const indexed: IndexedResult[] = p.offers.filter(isIndexed).map((o) => {
    const f = (o as OfferVersion & { formula?: IndexedFormula | null }).formula ?? null;
    const missing = [...formulaMissing(f, p.periods), ...(centralAvg > 0 ? [] : ["Escenari central de mercat"])];
    const base: IndexedResult = { offerId: o.id, name: o.productName, supplier: o.supplierName, missing, complete: !missing.length, scenarios: [], breakEvenMarket: null, sensitivityPerEurMWh: null, riskRange: null };
    if (!f || !(centralAvg > 0)) return base;
    const costAt = (factor: number) => computeCost(sheetFor(o, f, p.market.central, factor, p.periods), s, taxes);
    const sc: [ScenarioKey, number][] = [["baixista", 1 + p.market.lowPct / 100], ["central", 1], ["alcista", 1 + p.market.highPct / 100]];
    base.scenarios = sc.map(([scenario, factor]) => {
      const cost = costAt(factor);
      const prices = sheetFor(o, f, p.market.central, factor, p.periods).energy;
      return { scenario, factor, avgMarket: r2(centralAvg * factor), prices, cost, savingVsCurrent: currentCost?.ok && cost.ok ? r2(currentCost.total - cost.total) : null, diffVsFixed: bestFixed && cost.ok ? r2(bestFixed.cost - cost.total) : null };
    });
    const c1 = costAt(1), c2 = costAt(1 + 10 / centralAvg); // +10 €/MWh
    if (c1.ok && c2.ok) base.sensitivityPerEurMWh = r2((c2.total - c1.total) / 10);
    const lo = base.scenarios[0].cost, hi = base.scenarios[2].cost;
    if (lo.ok && hi.ok) base.riskRange = r2(hi.total - lo.total);
    // punt d'equilibri amb la millor fixa (bisecció sobre el factor; mercat 0–1000 €/MWh)
    if (bestFixed && c1.ok) {
      const g = (factor: number) => { const c = costAt(factor); return c.ok ? c.total - bestFixed.cost : NaN; };
      let a = 0, b = 1000 / centralAvg;
      const ga = g(a), gb = g(b);
      if (Number.isFinite(ga) && Number.isFinite(gb) && ga <= 0 && gb >= 0) {
        for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (g(m) <= 0) a = m; else b = m; }
        base.breakEvenMarket = r2(centralAvg * (a + b) / 2);
      }
    }
    if (o.contractType === "mixt") warnings.push(`${o.productName}: oferta mixta; només es fa variar la part indexada segons la fórmula indicada.`);
    return base;
  });

  // corba per al gràfic: de 0 a 2× el central
  const curve: MarketAnalysis["curve"] = [];
  if (centralAvg > 0) {
    for (let k = 0; k <= 20; k++) {
      const factor = (k / 10);
      const pt: MarketAnalysis["curve"][number] = { market: r2(centralAvg * factor), fixed: bestFixed?.cost ?? null, indexed: {} };
      for (const o of p.offers.filter(isIndexed)) {
        const f = (o as OfferVersion & { formula?: IndexedFormula | null }).formula;
        if (!f || formulaMissing(f, p.periods).length) { pt.indexed[o.id] = null; continue; }
        const c = computeCost(sheetFor(o, f, p.market.central, factor, p.periods), s, taxes);
        pt.indexed[o.id] = c.ok ? r2(c.total) : null;
      }
      curve.push(pt);
    }
  }
  if (!p.offers.some(isIndexed)) warnings.push("No hi ha cap oferta indexada seleccionada.");
  if (!bestFixed) warnings.push("No hi ha cap oferta fixa calculable per comparar.");
  const kwhTotal = s.kwh.slice(0, p.periods).every((x) => x != null) ? s.kwh.slice(0, p.periods).reduce<number>((a, x) => a + (x as number), 0) : s.kwhTotal;
  return { input: p.market, kwhTotal, kwhSource: s.hourly?.length ? "corba_horaria" : "periodes", current: { cost: currentCost?.ok ? currentCost.total : null, ok: !!currentCost?.ok }, bestFixed, fixed, indexed, curve, hypotheses, warnings };
}

/**
 * Clients 3.0TD/6.xTD amb corba horària real: el consum de cada període P1–P6 es calcula a partir de la corba
 * (calendari oficial) en lloc de fer servir el repartiment aproximat.
 */
export function withHourlyPeriods(s: SupplyInput): SupplyInput {
  if (!s.hourly?.length || !s.accessTariff || !SIX_PERIOD_TARIFFS.includes(s.accessTariff)) return s;
  const dates = s.hourly.map((h) => h.date).sort();
  const hol = holidaySet(dates[0], dates[dates.length - 1]);
  const kwh = [0, 0, 0, 0, 0, 0];
  for (const h of s.hourly) {
    const [y, m, d] = h.date.split("-").map(Number);
    const p = periodOf({ date: h.date, month: m, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), hour: h.hour, utc: 0 }, hol);
    kwh[p - 1] += h.kwh;
  }
  return { ...s, kwh: kwh.map((x) => Math.round(x)), kwhTotal: Math.round(kwh.reduce((a, x) => a + x, 0)) };
}

/** Diferències derivades per mostrar al client (mensual i per MWh). */
export function perUnit(diffYear: number | null, kwh: number | null, days = 365) {
  if (diffYear == null) return { month: null, perMWh: null };
  return { month: r2((diffYear * 30.4167) / days), perMWh: kwh ? r2(diffYear / (kwh / 1000)) : null };
}

/* ======================================================================= recomanació explicada (sense IA) */

const eur = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions)} €`);
/**
 * Conclusions basades NOMÉS en les xifres calculades. Mai recomana una indexada només perquè sigui més barata en
 * l'escenari favorable: cal que també ho sigui a l'escenari central i que el risc alcista sigui assumible.
 */
export function explainMarket(a: MarketAnalysis): { bullets: string[]; verdict: "fixa" | "indexada" | "indiferent" | "incomplet" } {
  const out: string[] = [];
  const ok = a.indexed.filter((x) => x.complete && x.scenarios.length);
  if (!a.bestFixed || !ok.length) {
    out.push(!a.bestFixed ? "No hi ha cap oferta fixa calculable." : "Cap oferta indexada té la fórmula completa: falten " + a.indexed.flatMap((x) => x.missing).filter((v, i, s) => s.indexOf(v) === i).join(", ") + ".");
    return { bullets: out, verdict: "incomplet" };
  }
  const bf = a.bestFixed;
  out.push(`Millor fixa: ${bf.supplier} · ${bf.name}, ${eur(bf.cost)}/any. És la de preu més previsible: el cost no depèn del mercat durant la vigència.`);
  let best: IndexedResult | null = null;
  for (const x of ok) {
    const [lo, mid, hi] = x.scenarios;
    out.push(`${x.supplier} · ${x.name}: ${eur(lo.cost.total)} (baixista) · ${eur(mid.cost.total)} (central) · ${eur(hi.cost.total)} (alcista). Diferència amb la fixa a l'escenari central: ${mid.diffVsFixed != null && mid.diffVsFixed >= 0 ? `estalvia ${eur(mid.diffVsFixed)}` : `costa ${eur(-(mid.diffVsFixed ?? 0))} més`}.`);
    if (x.sensitivityPerEurMWh != null) out.push(`Exposició al mercat: cada +1 €/MWh de mercat són ${eur(x.sensitivityPerEurMWh)} més a l'any; entre l'escenari baixista i l'alcista hi ha ${eur(x.riskRange)} de diferència.`);
    if (x.breakEvenMarket != null) out.push(`Punt d'equilibri: la indexada és més barata que la fixa mentre el mercat estigui per sota de ${x.breakEvenMarket.toLocaleString("ca-ES")} €/MWh de mitjana (central: ${mid.avgMarket.toLocaleString("ca-ES")} €/MWh).`);
    if ((mid.diffVsFixed ?? -1) > 0 && (!best || (mid.diffVsFixed ?? 0) > (best.scenarios[1].diffVsFixed ?? 0))) best = x;
  }
  const cheapLow = ok.filter((x) => (x.scenarios[0].diffVsFixed ?? -1) > 0);
  if (!best) {
    out.push(cheapLow.length ? "La indexada només surt més barata a l'escenari baixista: no és suficient per recomanar-la; la fixa és l'opció prudent." : "La fixa és més econòmica en tots els escenaris calculats.");
    return { bullets: out, verdict: "fixa" };
  }
  const alc = best.scenarios[2].diffVsFixed ?? -1;
  if (alc >= 0) {
    out.push(`${best.name} és més barata que la fixa fins i tot a l'escenari alcista. Tot i així, el cost real dependrà del mercat: revisa permanència i condicions abans de decidir.`);
    return { bullets: out, verdict: "indexada" };
  }
  out.push(`${best.name} estalvia a l'escenari central però costaria ${eur(-alc)} més que la fixa a l'alcista. Decisió segons la tolerància al risc del client: amb aversió al risc, la fixa.`);
  return { bullets: out, verdict: "indiferent" };
}
