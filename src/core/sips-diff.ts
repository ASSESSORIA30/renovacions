/**
 * Fase 9 · Importar dades del SIPS a una comparativa sense trepitjar res.
 * Compara camp a camp el que ja hi ha a la comparativa amb el que retorna el SIPS i proposa què importar:
 *  - camps buits o que ja venien del SIPS/CRM → marcats per importar;
 *  - camps introduïts a mà o llegits de la factura → NO marcats (cal que l'usuari ho confirmi expressament).
 */
export type DiffSource = "factura" | "sips" | "crm" | "manual" | "calculat" | null;

export interface SipsValues {
  tariff: string | null;
  powerKw: (number | null)[] | null;
  annualKwh: number | null;
  retailer: string | null;
  address: string | null;
  cups: string | null;
}
export interface CurrentValues extends SipsValues {
  sources: Record<string, DiffSource>;
}
export type DiffKey = "tariff" | "powerKw" | "annualKwh" | "retailer" | "address" | "cups";
export interface DiffRow { key: DiffKey; label: string; current: string; sips: string; source: DiffSource; protectedValue: boolean; defaultOn: boolean }

const LABEL: Record<DiffKey, string> = { tariff: "Tarifa d'accés", powerKw: "Potències contractades", annualKwh: "Consum anual", retailer: "Comercialitzadora actual", address: "Adreça del subministrament", cups: "CUPS" };
const SOURCE_KEY: Record<DiffKey, string> = { tariff: "tariff", powerKw: "kw", annualKwh: "kwhTotal", retailer: "retailer", address: "address", cups: "cups" };

const fmtKw = (a: (number | null)[] | null) => {
  const v = (a ?? []).map((x) => (x == null ? null : Math.round(x * 1000) / 1000));
  while (v.length && v[v.length - 1] == null) v.pop();
  return v.length ? v.map((x, i) => `P${i + 1} ${x ?? "—"}`).join(" · ") : "";
};
const fmtKwh = (n: number | null) => (n == null ? "" : `${Math.round(n).toLocaleString("ca-ES", { useGrouping: "always" } as Intl.NumberFormatOptions)} kWh`);
const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

function show(key: DiffKey, v: SipsValues): string {
  switch (key) {
    case "powerKw": return fmtKw(v.powerKw);
    case "annualKwh": return fmtKwh(v.annualKwh);
    default: return (v[key] as string | null) ?? "";
  }
}

/** Files on el SIPS aporta un valor diferent del que ja hi ha (els valors iguals o buits al SIPS no surten). */
export function sipsDiff(current: CurrentValues, sips: SipsValues): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const key of Object.keys(LABEL) as DiffKey[]) {
    const s = show(key, sips);
    if (!s) continue;
    const c = show(key, current);
    if (c && (key === "annualKwh" ? current.annualKwh != null && sips.annualKwh != null && Math.round(current.annualKwh) === Math.round(sips.annualKwh) : norm(c) === norm(s))) continue;
    const source = current.sources[SOURCE_KEY[key]] ?? null;
    const protectedValue = !!c && (source === "manual" || source === "factura" || source === null);
    rows.push({ key, label: LABEL[key], current: c, sips: s, source, protectedValue, defaultOn: !c || !protectedValue });
  }
  return rows;
}
