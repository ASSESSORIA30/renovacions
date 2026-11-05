/**
 * PREU FINAL AMB DESCOMPTE (part pura, servidor i navegador, testejable).
 *
 * El catàleg de tarifes i l'editor mostren el preu que pagarà el client amb el descompte base ja aplicat, i el
 * preu original (sense descompte) al costat. Hi ha dues maneres de tenir una tarifa amb descompte al catàleg:
 *  · Llegida amb plantilla o amb el lector de tarifes: els preus desats JA són finals i l'original viatja a
 *    `template.original` (no es torna a aplicar el descompte).
 *  · Amb descomptes percentuals a `discounts` (camp «Descompte energia (%)» de l'editor): els preus desats són
 *    els originals i el final = original × (1 − %), amb sis decimals (el motor de comparació fa el mateix sobre el cost).
 * Els descomptes sobre el total o en euros anuals no es poden expressar per kWh: es mostren com a nota.
 */
import Decimal from "decimal.js-light";
import { applyPct } from "./tariff-discounts";
import type { Num, OfferVersion, PowerUnit } from "./types";

export interface FinalPrices {
  /** Preus finals (amb el descompte base aplicat), en unitats internes. */
  energy: Num[];
  energy24h: Num;
  power: Num[];
  /** Preus originals sense descompte (null si la tarifa no té cap descompte sobre el preu unitari). */
  original: { energy: Num[]; energy24h: Num; power: Num[] } | null;
  /** Percentatge total de descompte sobre energia (gas: terme variable) i sobre potència. */
  energyPct: number;
  powerPct: number;
  /** Text del descompte (document o editor) per mostrar-lo. */
  label: string | null;
  notes: string[];
}

type Src = Pick<OfferVersion, "energy" | "energy24h" | "power" | "powerUnit" | "discounts" | "template" | "energyType" | "contractType">;

const perDay = (v: Num, u: PowerUnit | null | undefined): Num => (v == null ? null : u === "eur_kw_any" ? v / 365 : u === "eur_kw_mes" ? (v * 12) / 365 : v);

/** % que separa un preu final d'un original (0 si no n'hi ha o si les unitats no quadren). */
function pctBetween(orig: Num, fin: Num): number {
  if (orig == null || fin == null || orig <= 0 || fin < 0 || fin > orig) return 0;
  const p = Number(new Decimal(1).minus(new Decimal(fin).dividedBy(orig)).times(100).toDecimalPlaces(2).toString());
  return p >= 0.01 ? p : 0;
}

export function finalPrices(o: Src): FinalPrices {
  const gas = o.energyType === "gas";
  const notes: string[] = [];
  let energy = [...o.energy];
  let energy24h = o.energy24h;
  let power = [...o.power];
  // 1) Preus ja finals (plantilla o lector): l'original és a template.original
  const t = o.template;
  let origEnergy: Num[] = [...o.energy];
  let origE24: Num = o.energy24h;
  let origPower: Num[] = [...o.power];
  const orig = t?.original;
  if (orig && o.contractType !== "indexat") {
    const oe = orig.energy;
    origEnergy = Array.from({ length: 6 }, (_, i) => (o.energy[i] != null ? oe[i] ?? null : null));
    origE24 = o.energy24h != null ? oe.find((x) => x != null) ?? null : null;
    origPower = Array.from({ length: 6 }, (_, i) => {
      if (o.power[i] == null) return null;
      const v = orig.power[i] ?? null;
      const from = orig.powerUnit ?? o.powerUnit;
      if (from === o.powerUnit) return v;
      // l'original pot estar en €/kW·any o €/kW·mes i el final ja convertit a €/kW·dia
      return o.powerUnit === "eur_kw_dia" ? perDay(v, from) : null;
    });
  }
  // 2) Descomptes percentuals de l'editor (s'apliquen sobre el preu desat, com fa el motor)
  const pctOn = (base: "energia" | "potencia") => o.discounts.filter((d) => d.base === base && d.pct != null && d.pct > 0).reduce((a, d) => a + (d.pct ?? 0), 0);
  const ePct = o.contractType === "indexat" ? 0 : pctOn("energia");
  const pPct = gas ? 0 : pctOn("potencia");
  if (ePct) { energy = energy.map((v) => applyPct(v, ePct)); energy24h = applyPct(energy24h, ePct); }
  if (pPct) power = power.map((v) => applyPct(v, pPct));
  for (const d of o.discounts) {
    if (d.base === "total_sense_impostos" && d.pct) notes.push(`${d.concept}: ${d.pct} % sobre el total de la factura (s'aplica al cost, no al preu per kWh).`);
    if (d.eurYear) notes.push(`${d.concept}: ${d.eurYear} €/any (s'aplica al cost, no al preu per kWh).`);
  }
  if (o.contractType === "indexat" && pctOn("energia")) notes.push("Tarifa indexada: el descompte s'aplica al cost estimat, no a un preu fix.");

  // percentatge total, comparant el preu final amb l'original
  const firstPair = (a: Num[], b: Num[]) => { const i = a.findIndex((x, j) => x != null && b[j] != null); return i < 0 ? [null, null] as const : [a[i], b[i]] as const; };
  const [eo, ef] = energy24h != null ? [origE24, energy24h] as const : firstPair(origEnergy, energy);
  const [po, pf] = firstPair(origPower, power);
  const energyPct = pctBetween(eo, ef);
  const powerPct = pctBetween(po, pf);
  const has = energyPct > 0 || powerPct > 0;
  const editorLabel = [ePct ? `${ePct} % ${gas ? "terme variable" : "energia"}` : null, pPct ? `${pPct} % potència` : null].filter(Boolean).join(" · ");
  const label = [t?.discountText ?? null, editorLabel || null].filter(Boolean).join(" · ") || null;
  return {
    energy, energy24h, power,
    original: has ? { energy: energyPct ? origEnergy : energy, energy24h: energyPct ? origE24 : energy24h, power: powerPct ? origPower : power } : null,
    energyPct, powerPct, label, notes,
  };
}
