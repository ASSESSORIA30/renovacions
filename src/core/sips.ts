/**
 * Utilitats SIPS compartides pel CRM (sense dependències de servidor).
 * El model complet de dades energètiques és a `@/energy/lib/sips-record`.
 */
import type { SipsSummary } from "@/energy/lib/sips-record";

/** Resum de `sips_cache` que fa servir el CRM. Compatible amb la versió anterior (camps nous opcionals). */
export type SipsEntry = SipsSummary;

/**
 * Normalitza un CUPS: majúscules, sense espais/guions/punts i sense el sufix opcional de
 * frontera (els 2 darrers caràcters d'un CUPS de 22). Clau de `sips_cache`.
 */
export function normalizedCups(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[\s.\-]/g, "").replace(/[^A-Z0-9]/g, "").replace(/^(.{20})[A-Z0-9]{2}$/, "$1");
}

/**
 * CUPS vàlid de format (ES + 16 xifres + 2 lletres), amb o sense sufix. Serveix per a LLUM i GAS:
 * tots dos fan servir el mateix format; el tipus el diu el SIPS (TipoEnergia).
 */
export function isValidCups(raw: string | null | undefined): boolean {
  return /^ES[0-9]{16}[A-Z]{2}$/.test(normalizedCups(raw));
}
/** @deprecated Nom antic: accepta també CUPS de gas. Fes servir isValidCups. */
export const isElectricCups = isValidCups;

/** Contractes amb CUPS consultable al SIPS: llum, gas i dual. */
export const hasSipsCups = (c: { tipo: string; cups: string | null }) => (c.tipo === "luz" || c.tipo === "gas" || c.tipo === "dual") && isValidCups(c.cups);

/** Font del consum anual que es mostra a la targeta: CRM (o manual) té prioritat; si no n'hi ha, SIPS. */
export function consumptionSource(crmKwh: number | null, manual: boolean, sips: SipsEntry | null): { kwh: number | null; source: "crm" | "manual" | "sips" | null } {
  if (crmKwh != null) return { kwh: crmKwh, source: manual ? "manual" : "crm" };
  if (sips?.status === "found" && sips.annual_kwh != null) return { kwh: sips.annual_kwh, source: "sips" };
  return { kwh: null, source: null };
}

export const fmtMWh = (kwh: number | null | undefined, d = 1) =>
  kwh == null ? "—" : `${(kwh / 1000).toLocaleString("ca-ES", { minimumFractionDigits: d, maximumFractionDigits: d })} MWh`;
