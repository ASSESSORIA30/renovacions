/**
 * Context que rep la IA per redactar la recomanació: només resultats calculats i condicions.
 * Sense nom, NIF, adreça, correu, telèfon ni CUPS del client (minimització de dades personals).
 */
import type { Snapshot } from "./snapshot";

/** Dades que rep la IA: resultats calculats i condicions, SENSE nom, NIF, adreça ni contacte. */
export function aiContext(s: Snapshot) {
  return {
    subministrament: { energia: s.supply.energyType, peatge: s.supply.accessTariff, territori: s.supply.territory, dies: s.supply.days, base: s.supply.basis, consumKwh: s.supply.kwhTotal ?? s.supply.kwh },
    contracteActual: s.result.current ? { total: s.result.current.total, sensseImpostos: s.result.current.totalExTax, qualitat: s.result.current.quality } : null,
    ofertes: s.result.evaluations.map((e) => ({
      id: e.offer.id,
      comercialitzadora: e.offer.supplierName,
      producte: e.offer.productName,
      tipus: e.offer.contractType,
      elegible: e.eligibility.eligible,
      motiusExclusio: e.eligibility.reasons,
      calculable: e.cost.ok,
      falta: e.cost.missing,
      total: e.cost.ok ? e.cost.total : null,
      estalvi: e.saving,
      estalviPct: e.savingPct,
      qualitat: e.cost.quality,
      sas: e.offer.sas.mode,
      permanenciaMesos: e.offer.permanenceMonths,
      garantiaPreuMesos: e.offer.priceGuaranteeMonths,
      vigencia: e.offer.validTo,
      condicions: e.offer.conditions?.slice(0, 600) ?? null,
      etiquetes: e.tags,
      puntuacio: e.scores?.total ?? null,
    })),
    ordre: s.result.ranked.map((e) => e.offer.id),
    notes: s.dataNotes,
    // Fase 11: comparació fix vs indexat (hipòtesis de mercat visibles; cap xifra nova)
    fixVsIndexat: s.marketAnalysis ? {
      hipotesis: s.marketAnalysis.hypotheses,
      avisos: s.marketAnalysis.warnings,
      millorFixa: s.marketAnalysis.bestFixed,
      indexades: s.marketAnalysis.indexed.map((x) => ({ producte: x.name, comercialitzadora: x.supplier, completa: x.complete, falta: x.missing, escenaris: x.scenarios.map((e) => ({ escenari: e.scenario, mercatMitjaEurMWh: e.avgMarket, total: e.cost.ok ? e.cost.total : null, diferenciaAmbFixa: e.diffVsFixed })), puntEquilibriEurMWh: x.breakEvenMarket, sensibilitatEurPerEurMWh: x.sensitivityPerEurMWh, rangRisc: x.riskRange })),
    } : null,
  };
}

