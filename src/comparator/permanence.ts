/**
 * PERMANÈNCIA (lògica pura). Regla comercial d'Assessoria 3.0, configurable per Direcció: les tarifes de preu FIX
 * 3.0TD i 6.1TD del catàleg han de tenir permanència. Mai es mostra «Sense permanència» si és obligatòria o si no
 * consta expressament que no n'hi ha; mai s'inventa una durada.
 */
import { normalizeTariff } from "./engine";
import { DEFAULT_PERMANENCE_RULE, type OfferVersion, type PermanenceInfo, type PermanenceRule } from "./types";

type O = Pick<OfferVersion, "permanenceMonths" | "permanence" | "accessTariff" | "contractType" | "energyType">;

/** Permanència normalitzada: la detallada si n'hi ha; si no, «amb» quan consten mesos, i «no informada» en cas contrari. */
export function permanenceOf(o: O): PermanenceInfo {
  if (o.permanence) return { ...o.permanence, months: o.permanence.months ?? (o.permanence.status === "amb" ? o.permanenceMonths ?? null : null) };
  if (o.permanenceMonths != null && o.permanenceMonths > 0) return { status: "amb", months: o.permanenceMonths, startNote: null, cancellation: null, penalty: null, source: null, exception: null };
  return { status: "no_informada", months: null, startNote: null, cancellation: null, penalty: null, source: null, exception: null };
}

/** La regla de permanència obligatòria s'aplica a aquesta tarifa? (fixa 3.0TD / 6.1TD per defecte) */
export function permanenceRequired(o: O, rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): boolean {
  if (!rule.enabled || o.energyType === "gas") return false;
  const t = normalizeTariff(o.accessTariff);
  return !!t && rule.tariffs.map((x) => normalizeTariff(x)).includes(t) && rule.contractTypes.includes(o.contractType);
}

/** Incidències que impedeixen activar la tarifa o emetre definitivament una proposta amb ella. */
export function permanenceIssues(o: O, rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): string[] {
  const p = permanenceOf(o);
  const out: string[] = [];
  if (p.status === "amb" && (p.months == null || p.months <= 0)) out.push("Permanència sense durada: cal indicar els mesos segons les condicions");
  if (permanenceRequired(o, rule) && !p.exception) {
    if (p.status === "sense") out.push("Tarifa fixa 3.0TD/6.1TD sense permanència: la regla d'Assessoria 3.0 l'exigeix (o cal una excepció documentada per Direcció)");
    if (p.status === "no_informada") out.push("Permanència obligatòria pendent de configurar (tarifa fixa 3.0TD/6.1TD)");
  }
  return out;
}

/** Text per a la pantalla i el PDF. */
export function permanenceLabel(o: O, lang: "ca" | "es" = "ca", rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): string {
  const p = permanenceOf(o);
  const ca = lang === "ca";
  if (p.status === "amb" && p.months) return ca ? `Permanència: ${p.months} mesos` : `Permanencia: ${p.months} meses`;
  if (permanenceRequired(o, rule) && !p.exception) return ca ? "Permanència obligatòria: pendent de confirmar" : "Permanencia obligatoria: pendiente de confirmar";
  if (p.status === "amb") return ca ? "Permanència: durada pendent de confirmar" : "Permanencia: duración pendiente de confirmar";
  if (p.status === "sense") return ca ? "Sense permanència" : "Sin permanencia";
  return ca ? "Permanència: no informada" : "Permanencia: no informada";
}

/** Text de permanència d'una oferta dins d'una comparativa: les emeses amb el motor 1.0.x conserven el text original. */
export function snapshotPermanenceLabel(o: O, engineVersion: string, lang: "ca" | "es" = "ca", rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): string {
  if (/^1\.0\./.test(engineVersion)) {
    const ca = lang === "ca";
    return o.permanenceMonths ? (ca ? `Permanència: ${o.permanenceMonths} mesos` : `Permanencia: ${o.permanenceMonths} meses`) : ca ? "Sense permanència" : "Sin permanencia";
  }
  return permanenceLabel(o, lang, rule);
}
