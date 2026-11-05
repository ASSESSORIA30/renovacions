/**
 * Còpia completa i immutable d'una comparativa: dades, ofertes (amb els preus d'aquell moment),
 * fiscalitat, ponderacions i resultat del motor. La pantalla i el PDF llegeixen sempre d'aquí.
 */
import { runComparison, type ComparisonRun } from "./ranking";
import { analyzeMarket, type MarketAnalysis, type MarketInput } from "./market";
import { periodsOf } from "./engine";
import { applyAdjustments, type Adjustments } from "./catalog";
import { DEFAULT_TAXES, DEFAULT_WEIGHTS, ENGINE_VERSION, type OfferVersion, type PriceSheet, type RankingWeights, type SupplyInput, type TaxConfig } from "./types";

export interface ClientInfo {
  name: string | null;
  taxId: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  logo?: string | null;
}

export interface Snapshot {
  engineVersion: string;
  computedAt: string;
  today: string;
  mode: "factura" | "cups" | "cups_preus" | "manual" | "massiva";
  client: ClientInfo;
  cups: string | null;
  supply: SupplyInput;
  current: PriceSheet | null;
  currentLabel: string | null;
  currentRetailer: string | null;
  offers: OfferVersion[];
  taxes: TaxConfig;
  weights: RankingWeights;
  observations: string | null;
  dataNotes: string[];
  result: ComparisonRun;
  /** Hipòtesis de mercat indicades per l'usuari i comparador fix vs indexat calculat amb elles. */
  market?: MarketInput | null;
  marketAnalysis?: MarketAnalysis | null;
  /** Ajustos puntuals d'aquesta comparativa (descomptes desactivats, SAS). Les `offers` ja els porten aplicats. */
  adjustments?: Adjustments | null;
  /** Versions del catàleg tal com eren, SENSE els ajustos (només si n'hi ha): per reobrir sense aplicar-los dues vegades. */
  baseOffers?: OfferVersion[] | null;
  /** Traçabilitat: versió exacta del catàleg de cada alternativa (identificador, producte i número de versió). */
  catalogRefs?: { id: string; productId: string; version: number; supplierName: string; productName: string }[];
}

/** Les 3 alternatives en l'ordre de presentació: primer les classificades, després les no calculables. */
export function presentationOrder(s: Snapshot) {
  const ranked = s.result.ranked;
  const rest = s.result.evaluations.filter((e) => !ranked.includes(e) && !ranked.some((r) => r.offer.id === e.offer.id));
  return [...ranked, ...rest].slice(0, 3);
}

export interface SnapshotInput {
  mode: Snapshot["mode"];
  client?: ClientInfo;
  clientName?: string | null;
  cups?: string | null;
  supply: SupplyInput;
  current: PriceSheet | null;
  currentLabel?: string | null;
  currentRetailer?: string | null;
  offers: OfferVersion[];
  taxes?: TaxConfig | unknown;
  weights?: RankingWeights;
  observations?: string | null;
  dataNotes?: string[];
  market?: MarketInput | null;
  adjustments?: Adjustments | null;
}

/** Executa el motor i congela el resultat. El servidor el torna a executar en desar (no es confia en el navegador). */
export function buildSnapshot(p: SnapshotInput, today = new Date().toISOString().slice(0, 10)): Snapshot {
  const taxes = (p.taxes as TaxConfig) ?? DEFAULT_TAXES;
  const weights = p.weights ?? DEFAULT_WEIGHTS;
  // els ajustos s'apliquen a una còpia de cada versió: la pantalla, el PDF i el desat fan servir el mateix resultat
  const offers = applyAdjustments(p.offers, p.adjustments);
  const run = runComparison({ supply: p.supply, current: p.current ?? null, offers, taxes, weights, today });
  return {
    engineVersion: ENGINE_VERSION,
    computedAt: new Date().toISOString(),
    today,
    mode: p.mode,
    client: p.client ?? { name: p.clientName ?? null, taxId: null, address: null, email: null, phone: null },
    cups: p.cups ?? null,
    supply: p.supply,
    current: p.current ?? null,
    currentLabel: p.currentLabel ?? null,
    currentRetailer: p.currentRetailer ?? null,
    offers,
    taxes,
    weights,
    observations: p.observations ?? null,
    dataNotes: p.dataNotes ?? [],
    result: run,
    market: p.market ?? null,
    marketAnalysis: p.market && p.market.central.some((x) => x != null) ? analyzeMarket({ supply: p.supply, current: p.current ?? null, offers, market: p.market, taxes, periods: periodsOf(p.supply.accessTariff, p.supply.energyType).energy }) : null,
    adjustments: p.adjustments && Object.keys(p.adjustments).length ? p.adjustments : null,
    baseOffers: p.adjustments && Object.keys(p.adjustments).length ? p.offers : null,
    catalogRefs: p.offers.map((o) => ({ id: o.id, productId: o.productId, version: o.version, supplierName: o.supplierName, productName: o.productName })),
  };
}
