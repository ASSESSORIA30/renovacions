/**
 * Model unificat de dades energètiques d'un subministrament.
 *
 * Pont entre:
 *  - la fila de 97 columnes del SIPS (portal o Excel) → `Supply` de cups2 (parseRows),
 *  - la taula `sips_cache` de Supabase (columnes estructurades + `raw` jsonb),
 *  - el resum que fa servir el CRM (targetes del Kanban, generador d'ofertes).
 *
 * Mòdul pur: es fa servir al servidor, al navegador i als tests.
 * Regla: un valor absent és `null`, mai 0. Els totals anuals no es reparteixen per períodes.
 */
import { FIELD_HEADERS, energyOf, type Cell } from "./sips-engine";
import { annualActive, parseRows } from "./parse";
import type { Supply } from "./types";

export type EnergySource = "sips" | "excel" | "crm" | "manual" | "calculat";

export const SOURCE_LABEL: Record<EnergySource, string> = {
  sips: "SIPS",
  excel: "Excel SIPS",
  crm: "CRM",
  manual: "Manual",
  calculat: "Calculat",
};

export type AvailabilityLevel = "completa" | "parcial" | "minima" | "sense";

export interface DataAvailability {
  level: AvailabilityLevel;
  annualKwh: boolean;
  monthsKwh: number; // 0–12
  monthsMaxKw: number; // 0–12
  monthsReactive: number; // 0–12
  powers: number; // potències contractades informades (0–6)
  technical: boolean; // tensió / tipus de punt de mesura / distribuïdora
}

/** Fila de `public.sips_cache` (migració 004). */
export interface SipsCacheRow {
  cups: string; // base de 20 caràcters (clau)
  returned_cups: string | null; // CUPS complet retornat pel portal (22)
  energy_type: "luz" | "gas" | null;
  annual_kwh: number | null;
  tariff: string | null;
  address: string | null;
  status: "found" | "not_found" | "error";
  error: string | null;
  consulted_at: string;
  raw: Record<string, Cell> | null;
  distributor: string | null;
  retailer: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  voltage_v: number | null;
  contracted_power_kw: (number | null)[];
  monthly_kwh: (number | null)[];
  monthly_max_kw: (number | null)[];
  monthly_reactive_kvarh: (number | null)[];
  annual_reactive_kvarh: number | null;
  max_power_year_kw: number | null;
  max_power_bie_kw: number | null;
  max_power_apm_kw: number | null;
  last_reading_date: string | null;
  data_availability: DataAvailability | null;
  source: "sips" | "excel";
  source_detail: string | null;
}

/** Resum lleuger per al CRM (Kanban, fitxa del contracte, generador d'ofertes). */
export interface SipsSummary {
  cups: string;
  returned_cups: string | null;
  annual_kwh: number | null;
  tariff: string | null;
  address: string | null;
  status: "found" | "not_found" | "error";
  consulted_at: string;
  error?: string | null;
  energy_type?: "luz" | "gas" | null;
  contracted_power_kw?: (number | null)[] | null;
  monthly_kwh?: (number | null)[] | null;
  max_power_year_kw?: number | null;
  retailer?: string | null;
  distributor?: string | null;
  data_availability?: DataAvailability | null;
  source?: "sips" | "excel" | null;
  source_detail?: string | null;
}

export const SUMMARY_COLUMNS =
  "cups,returned_cups,energy_type,annual_kwh,tariff,address,status,consulted_at,error,contracted_power_kw,monthly_kwh,max_power_year_kw,retailer,distributor,data_availability,source,source_detail";
export const LEGACY_SUMMARY_COLUMNS = "cups,returned_cups,annual_kwh,tariff,address,status,consulted_at,error";

export function cupsBase(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[\s\-.]/g, "").slice(0, 20);
}

export const HEADERS = FIELD_HEADERS.map(([, h]) => h);

/** Fila de 97 columnes → objecte {capçalera: valor}. */
export function recordFromRow(headers: Cell[], row: Cell[]): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  headers.forEach((h, i) => {
    if (h != null && String(h).trim() !== "") out[String(h).trim()] = row[i] ?? null;
  });
  return out;
}

/** Objecte {capçalera: valor} → Supply de cups2 (mateix importador que l'Excel). */
export function supplyFromRecord(
  record: Record<string, Cell>,
  meta: { file: string; sheet?: string; importedAt?: string; origin?: Supply["source"]["origin"] },
): Supply | null {
  const headers = Array.from(new Set([...HEADERS, ...Object.keys(record)]));
  const { supplies } = parseRows([headers, headers.map((h) => record[h] ?? null)], { file: meta.file, sheet: meta.sheet ?? "SIPS", importedAt: meta.importedAt });
  const s = supplies[0];
  if (!s) return null;
  if (meta.origin) s.source.origin = meta.origin;
  return s;
}

const known = (a: (number | null)[]) => a.filter((x) => x != null).length;

/** Tipus d'energia d'un subministrament de cups2 (camp «Tipo Energía»). */
export function supplyEnergy(s: Pick<Supply, "tipoEnergia">): "luz" | "gas" | null {
  return energyOf(s.tipoEnergia);
}
export const isGasSupply = (s: Pick<Supply, "tipoEnergia">) => supplyEnergy(s) === "gas";

export function availabilityOf(s: Supply): DataAvailability {
  const a: DataAvailability = {
    annualKwh: annualActive(s).value != null,
    monthsKwh: known(s.eaMensual),
    monthsMaxKw: known(s.potMensual),
    monthsReactive: known(s.erMensual),
    powers: known(s.potContratada),
    technical: s.tension != null || s.tipoPM != null || !!s.distribuidora,
    level: "sense",
  };
  const gas = isGasSupply(s); // el gas no té potències ni màximes: la completesa és el consum
  a.level =
    gas
      ? a.annualKwh && a.monthsKwh === 12 ? "completa" : a.annualKwh && a.monthsKwh > 0 ? "parcial" : a.annualKwh ? "minima" : "sense"
      : a.annualKwh && a.monthsKwh === 12 && a.powers > 0 && a.monthsMaxKw >= 6
      ? "completa"
      : a.annualKwh && (a.monthsKwh > 0 || a.powers > 0)
        ? "parcial"
        : a.annualKwh || a.powers > 0
          ? "minima"
          : "sense";
  return a;
}

/** Construeix la fila de sips_cache a partir del registre de 97 camps. */
export function cacheRowFromRecord(
  cups: string,
  record: Record<string, Cell>,
  meta: { source: "sips" | "excel"; sourceDetail: string; consultedAt?: string },
): SipsCacheRow {
  const consultedAt = meta.consultedAt ?? new Date().toISOString();
  const s = supplyFromRecord(record, { file: meta.sourceDetail, importedAt: consultedAt });
  const base = cupsBase(cups);
  if (!s) return emptyRow(base, "not_found", null, consultedAt, meta);
  return {
    cups: base,
    returned_cups: s.cups,
    energy_type: supplyEnergy(s),
    annual_kwh: annualActive(s).value,
    tariff: s.tarifa ?? s.tarifaRaw,
    address: s.direccion,
    status: "found",
    error: null,
    consulted_at: consultedAt,
    raw: record,
    distributor: s.distribuidora,
    retailer: s.comercializadora,
    postal_code: s.cp,
    city: s.localidad,
    province: s.provincia,
    voltage_v: s.tension,
    contracted_power_kw: s.potContratada,
    monthly_kwh: s.eaMensual,
    monthly_max_kw: s.potMensual,
    monthly_reactive_kvarh: s.erMensual,
    annual_reactive_kvarh: s.erAnual,
    max_power_year_kw: s.potAnual,
    max_power_bie_kw: s.potMaxBIE,
    max_power_apm_kw: s.potMaxAPM,
    last_reading_date: s.fUltLectura,
    data_availability: availabilityOf(s),
    source: meta.source,
    source_detail: meta.sourceDetail,
  };
}

export function emptyRow(
  cups: string,
  status: "not_found" | "error",
  error: string | null,
  consultedAt: string,
  meta: { source: "sips" | "excel"; sourceDetail: string },
): SipsCacheRow {
  return {
    cups: cupsBase(cups),
    returned_cups: null,
    energy_type: null,
    annual_kwh: null,
    tariff: null,
    address: null,
    status,
    error,
    consulted_at: consultedAt,
    raw: null,
    distributor: null,
    retailer: null,
    postal_code: null,
    city: null,
    province: null,
    voltage_v: null,
    contracted_power_kw: Array(6).fill(null),
    monthly_kwh: Array(12).fill(null),
    monthly_max_kw: Array(12).fill(null),
    monthly_reactive_kvarh: Array(12).fill(null),
    annual_reactive_kvarh: null,
    max_power_year_kw: null,
    max_power_bie_kw: null,
    max_power_apm_kw: null,
    last_reading_date: null,
    data_availability: null,
    source: meta.source,
    source_detail: meta.sourceDetail,
  };
}

/** Columnes existents abans de la migració 004 (per si encara no s'ha executat). */
export function legacyRow(r: SipsCacheRow) {
  const { cups, returned_cups, annual_kwh, tariff, address, status, error, consulted_at } = r;
  return { cups, returned_cups, annual_kwh, tariff, address, status, error, consulted_at };
}

export function isFresh(consultedAt: string | null | undefined, status: string | null | undefined, ttlDays: number, errorRetryHours: number, now = Date.now()) {
  if (!consultedAt) return false;
  const age = now - new Date(consultedAt).getTime();
  return status === "found" || status === "not_found" ? age < ttlDays * 86_400_000 : age < errorRetryHours * 3_600_000;
}

export const AVAILABILITY_META: Record<AvailabilityLevel, { label: string; hint: string; tone: "green" | "blue" | "amber" | "zinc" }> = {
  completa: { label: "Dades completes", hint: "Consum anual, 12 mesos, potències i màximes", tone: "green" },
  parcial: { label: "Dades parcials", hint: "Falten mesos o màximes de potència", tone: "blue" },
  minima: { label: "Dades mínimes", hint: "Només el total anual o les potències", tone: "amber" },
  sense: { label: "Sense dades", hint: "El SIPS no ha retornat informació útil", tone: "zinc" },
};
