/**
 * Recomanació base (sense IA), redactada a partir dels resultats verificats del motor.
 * Serveix de text per defecte i de comprovació: la IA no pot contradir-ne les xifres.
 */
import type { Snapshot } from "./snapshot";

const eur = (n: number, lang: "ca" | "es") => n.toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { style: "currency", currency: "EUR" });
const pct = (n: number, lang: "ca" | "es") => n.toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { maximumFractionDigits: 1 });

export function ruleRecommendation(s: Snapshot, lang: "ca" | "es" = "ca"): string {
  const es = lang === "es";
  const best = s.result.ranked[0];
  if (!best) return es ? "Ninguna de las ofertas seleccionadas es elegible y calculable con los datos disponibles. Revise los datos que faltan." : "Cap de les ofertes seleccionades és elegible i calculable amb les dades disponibles. Revisa les dades que falten.";
  const parts: string[] = [];
  const name = `${best.offer.supplierName} · ${best.offer.productName}`;
  parts.push(es ? `Recomendamos ${name}, con un coste estimado de ${eur(best.cost.total, lang)} (impuestos incluidos) para el periodo calculado.` : `Recomanem ${name}, amb un cost de ${eur(best.cost.total, lang)} (impostos inclosos) per al període calculat.`);
  if (best.saving != null && s.result.current?.ok) {
    parts.push(best.saving > 0
      ? es ? `Frente al contrato actual (${eur(s.result.current.total, lang)}) supone un ahorro de ${eur(best.saving, lang)} (${pct(best.savingPct ?? 0, lang)} %).` : `Respecte del contracte actual (${eur(s.result.current.total, lang)}) suposa un estalvi de ${eur(best.saving, lang)} (${pct(best.savingPct ?? 0, lang)} %).`
      : es ? `No mejora el coste del contrato actual (${eur(s.result.current.total, lang)}): conviene valorar mantenerlo.` : `No millora el cost del contracte actual (${eur(s.result.current.total, lang)}): convé valorar mantenir-lo.`);
  } else parts.push(es ? "No se dispone de los precios actuales, por lo que no se indica ahorro respecto al contrato vigente." : "No es disposa dels preus actuals, per això no s'indica estalvi respecte del contracte vigent.");
  if (best.tags.length) parts.push((es ? "Destaca por: " : "Destaca per: ") + best.tags.join(", ").toLowerCase() + ".");
  if (best.offer.contractType === "indexat") parts.push(es ? "Es una tarifa indexada: el coste real variará con el mercado." : "És una tarifa indexada: el cost real variarà amb el mercat.");
  if (best.offer.permanenceMonths) parts.push(es ? `Tiene permanencia de ${best.offer.permanenceMonths} meses.` : `Té permanència de ${best.offer.permanenceMonths} mesos.`);
  if (best.offer.sas.mode === "variable") parts.push(es ? "El mecanismo de ajuste (SAS) se factura aparte y puede variar." : "El mecanisme d'ajust (SAS) es factura a part i pot variar.");
  if (best.cost.quality === "estimat" || s.supply.basis === "anualitzat") parts.push(es ? "Los importes son estimados." : "Els imports són estimats.");
  return parts.join(" ");
}
