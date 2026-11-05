/**
 * AVALUACIÓ I CLASSIFICACIÓ D'OFERTES (primera capa, verificable).
 * Criteris i ponderacions transparents. Les comissions NO són una entrada d'aquest mòdul:
 * la conveniència per al client no pot dependre de la remuneració.
 */
import { computeCost, eligibility } from "./engine";
import { DEFAULT_TAXES, DEFAULT_WEIGHTS, type CostResult, type OfferEvaluation, type OfferVersion, type PriceSheet, type RankingWeights, type SupplyInput, type TaxConfig } from "./types";

export function stabilityOf(o: OfferVersion): number {
  if (o.contractType === "indexat") return 0;
  if (o.contractType === "mixt") return 0.5;
  const g = o.priceGuaranteeMonths ?? 0;
  return g >= 24 ? 1 : g >= 12 ? 0.9 : 0.7;
}
export function variabilityExposure(o: OfferVersion): number {
  // 0 = cap exposició, 1 = màxima
  let v = o.contractType === "indexat" ? 1 : o.contractType === "mixt" ? 0.5 : 0;
  if (o.sas.mode === "variable") v = Math.min(1, v + 0.3);
  return v;
}

export interface ComparisonRun {
  current: CostResult | null;
  evaluations: OfferEvaluation[]; // totes, amb motiu d'exclusió
  ranked: OfferEvaluation[]; // elegibles i calculables, ordenades
  highlights: { cheapest: string | null; mostStable: string | null; noPermanence: string | null; bestSaving: string | null; leastVariable: string | null };
}

export function runComparison(input: {
  supply: SupplyInput;
  current: PriceSheet | null;
  offers: OfferVersion[];
  taxes?: TaxConfig;
  weights?: RankingWeights;
  today?: string;
}): ComparisonRun {
  const taxes = input.taxes ?? DEFAULT_TAXES;
  const w = normalizeWeights(input.weights ?? DEFAULT_WEIGHTS);
  const current = input.current ? computeCost(input.current, input.supply, taxes, { current: true }) : null;
  const evaluations: OfferEvaluation[] = input.offers.map((offer) => {
    const el = eligibility(offer, input.supply, input.today);
    const cost = computeCost(offer, input.supply, taxes);
    const saving = current?.ok && cost.ok ? round2(current.total - cost.total) : null;
    return { offer, eligibility: el, cost, saving, savingPct: saving != null && current && current.total > 0 ? round2((saving / current.total) * 100) : null, scores: null, tags: [] };
  });
  const ok = evaluations.filter((e) => e.eligibility.eligible && e.cost.ok);
  const minCost = ok.length ? Math.min(...ok.map((e) => e.cost.total)) : 0;
  for (const e of ok) {
    const price = e.cost.total > 0 ? minCost / e.cost.total : 0;
    const stability = stabilityOf(e.offer);
    const permanence = e.offer.permanenceMonths ? 0 : 1;
    const variability = 1 - variabilityExposure(e.offer);
    e.scores = { price, stability, permanence, variability, total: round4(price * w.price + stability * w.stability + permanence * w.permanence + variability * w.variability) };
  }
  const ranked = [...ok].sort((a, b) => b.scores!.total - a.scores!.total || a.cost.total - b.cost.total);
  const pick = (f: (e: OfferEvaluation) => number) => (ok.length ? [...ok].sort((a, b) => f(b) - f(a) || a.cost.total - b.cost.total)[0].offer.id : null);
  const highlights = {
    cheapest: pick((e) => -e.cost.total),
    mostStable: pick((e) => stabilityOf(e.offer)),
    noPermanence: ok.filter((e) => !e.offer.permanenceMonths).sort((a, b) => a.cost.total - b.cost.total)[0]?.offer.id ?? null,
    bestSaving: current?.ok ? pick((e) => e.saving ?? -Infinity) : null,
    leastVariable: pick((e) => -variabilityExposure(e.offer)),
  };
  const TAG = { cheapest: "Més econòmica", mostStable: "Preu més estable", noPermanence: "Sense permanència", bestSaving: "Més estalvi", leastVariable: "Menys exposició a preus variables" } as const;
  for (const [k, id] of Object.entries(highlights)) if (id) evaluations.find((e) => e.offer.id === id)?.tags.push(TAG[k as keyof typeof TAG]);
  return { current, evaluations, ranked, highlights };
}

export function normalizeWeights(w: RankingWeights): RankingWeights {
  const s = w.price + w.stability + w.permanence + w.variability;
  if (!(s > 0)) return DEFAULT_WEIGHTS;
  return { price: w.price / s, stability: w.stability / s, permanence: w.permanence / s, variability: w.variability / s };
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
