/**
 * Unitats de comissions, decomissions i retroccessions: una sola font per mostrar-les correctament.
 * Una comissió variable per energia es mostra SEMPRE amb la seva unitat (€/MWh, €/kWh), mai com a «€».
 */
export const UNIT_TEXT: Record<string, string> = {
  eur: "€", eur_contracte: "€/contracte", eur_mwh: "€/MWh", eur_kwh: "€/kWh", eur_kw_any: "€/kW·any", eur_kw_dia: "€/kW·dia",
  eur_mes: "€/mes", pct: "%", mesos: "mesos", dies: "dies",
};

/** Etiqueta llegible d'una unitat interna (si no es coneix, es retorna tal qual). */
export const unitLabel = (unit: string | null | undefined) => (unit ? UNIT_TEXT[unit] ?? unit : "");

/** Valor amb la seva unitat, en format català: «8 €/MWh», «0,008 €/kWh», «12,5 %», «50 €/contracte». */
export function formatUnitValue(value: number | string | null | undefined, unit: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const digits = unit === "eur_kwh" ? 6 : unit === "pct" ? 2 : 4;
  const txt = n.toLocaleString("ca-ES", { maximumFractionDigits: digits, useGrouping: "always" } as Intl.NumberFormatOptions);
  const u = unitLabel(unit);
  return u ? `${txt} ${u}` : txt;
}

/** Substitueix codis interns d'unitat dins d'un text ja desat (p. ex. avisos antics: «8 eur_mwh vs 10 eur_mwh»). */
export function humanizeUnits(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\b(eur_contracte|eur_mwh|eur_kwh|eur_kw_any|eur_kw_dia|eur_mes|eur|pct|mesos|dies)\b/g, (m, _u, off: number, s: string) => {
    // «eur», «pct», «mesos» i «dies» només quan van just després d'un número (no es toquen paraules del text)
    if (["eur", "pct", "mesos", "dies"].includes(m) && !/\d\s*$/.test(s.slice(Math.max(0, off - 12), off))) return m;
    return UNIT_TEXT[m];
  });
}
