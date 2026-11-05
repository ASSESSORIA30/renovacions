/**
 * FILTRES D'OFERTES (purs, compartits pel catàleg, la selecció d'ofertes de la comparativa i la llista d'ofertes del CRM).
 */
import { normalizeTariff, powerPerDay } from "./engine";
import { permanenceOf } from "./permanence";
import type { ContractType, OfferVersion, Segment, TariffStatus } from "./types";

export const TARIFF_ORDER = ["2.0TD", "3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD", ...Array.from({ length: 11 }, (_, i) => `RL.${i + 1}`)];

export type Validity = "vigents" | "caduquen30" | "caducades" | "sense_data";
export type SortKey = "comercialitzadora" | "preu_energia" | "preu_potencia" | "vigencia" | "recents";
export type Origin = OfferVersion["origin"];

export interface OfferFilters {
  q: string;
  supplier: string; // "" = totes
  tariff: string;
  energyType: "" | "luz" | "gas";
  contractType: "" | ContractType;
  status: "" | TariffStatus;
  segment: "" | Segment;
  permanence: "" | "sense" | "amb";
  validity: "" | Validity;
  origin: "" | Origin;
  sort: SortKey;
}

export const EMPTY_FILTERS: OfferFilters = { q: "", supplier: "", tariff: "", energyType: "", contractType: "", status: "", segment: "", permanence: "", validity: "", origin: "", sort: "comercialitzadora" };

export const VALIDITY_LABEL: Record<Validity, string> = { vigents: "Vigents", caduquen30: "Caduquen en 30 dies", caducades: "Caducades", sense_data: "Sense data de fi" };
export const SORT_LABEL: Record<SortKey, string> = { comercialitzadora: "Comercialitzadora", preu_energia: "Preu energia (menor)", preu_potencia: "Preu potència (menor)", vigencia: "Caduca abans", recents: "Publicades més recentment" };
export const ORIGIN_LABEL: Record<Origin, string> = { manual: "Alta manual", excel: "Importada (fitxer)", api: "Connector API", crm: "Ofertes del CRM" };

/** Nombre de filtres actius (sense comptar l'ordenació). */
export const activeFilters = (f: OfferFilters) => (Object.keys(EMPTY_FILTERS) as (keyof OfferFilters)[]).filter((k) => k !== "sort" && f[k] !== EMPTY_FILTERS[k]).length;

/** Preu d'energia representatiu (€/kWh): preu únic o P1 (o referència si és indexada). */
export function energyRef(o: OfferVersion): number | null {
  if (o.energy24h != null) return o.energy24h;
  const list = o.contractType === "indexat" ? (o.indexedReference?.energy ?? []) : o.energy;
  return list.find((x) => x != null) ?? null;
}

/** Preu de potència P1 normalitzat a €/kW·dia (o terme fix del gas en €/dia). */
export function powerRef(o: OfferVersion): number | null {
  const p = o.power.find((x) => x != null);
  if (p != null) return powerPerDay(p, o.powerUnit).toNumber();
  return o.gasFixedEurDay;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function matchesValidity(o: OfferVersion, v: Validity, today: string): boolean {
  const to = o.validTo;
  if (v === "sense_data") return !to;
  if (v === "caducades") return !!to && to < today;
  if (v === "caduquen30") return !!to && to >= today && to <= addDays(today, 30);
  return (!to || to >= today) && (!o.validFrom || o.validFrom <= today);
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function applyOfferFilters<T extends OfferVersion>(items: T[], f: OfferFilters, today = new Date().toISOString().slice(0, 10)): T[] {
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  const out = items.filter((o) => {
    if (f.supplier && fold(o.supplierName) !== fold(f.supplier)) return false;
    if (f.tariff && normalizeTariff(o.accessTariff) !== f.tariff) return false;
    if (f.energyType && o.energyType !== f.energyType) return false;
    if (f.contractType && o.contractType !== f.contractType) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.segment && !o.segments.includes(f.segment)) return false;
    // «sense» només quan consta expressament (mai si és desconeguda); «amb» inclou la durada pendent
    if (f.permanence === "sense" && permanenceOf(o).status !== "sense") return false;
    if (f.permanence === "amb" && permanenceOf(o).status !== "amb") return false;
    if (f.validity && !matchesValidity(o, f.validity, today)) return false;
    if (f.origin && o.origin !== f.origin) return false;
    if (words.length) {
      const hay = fold(`${o.supplierName} ${o.productName} ${o.accessTariff} ${o.conditions ?? ""} ${o.source ?? ""}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const nullsLast = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b);
  const byName = (a: T, b: T) => a.supplierName.localeCompare(b.supplierName, "ca") || a.productName.localeCompare(b.productName, "ca") || TARIFF_ORDER.indexOf(normalizeTariff(a.accessTariff) ?? "") - TARIFF_ORDER.indexOf(normalizeTariff(b.accessTariff) ?? "");
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    comercialitzadora: byName,
    preu_energia: (a, b) => nullsLast(energyRef(a), energyRef(b)) || byName(a, b),
    preu_potencia: (a, b) => nullsLast(powerRef(a), powerRef(b)) || byName(a, b),
    vigencia: (a, b) => (a.validTo ?? "9999").localeCompare(b.validTo ?? "9999") || byName(a, b),
    recents: (a, b) => (b.publishedAt ?? b.validFrom ?? "").localeCompare(a.publishedAt ?? a.validFrom ?? "") || byName(a, b),
  };
  return out.sort(cmp[f.sort] ?? byName);
}

/** Valors disponibles per als desplegables (només els que existeixen a les dades). */
export function filterOptions(items: OfferVersion[]) {
  const suppliers = [...new Map(items.map((o) => [fold(o.supplierName), o.supplierName])).values()].sort((a, b) => a.localeCompare(b, "ca"));
  const tariffs = [...new Set(items.map((o) => normalizeTariff(o.accessTariff)).filter((t): t is string => !!t))].sort((a, b) => TARIFF_ORDER.indexOf(a) - TARIFF_ORDER.indexOf(b));
  const origins = [...new Set(items.map((o) => o.origin))];
  const contractTypes = [...new Set(items.map((o) => o.contractType))];
  return { suppliers, tariffs, origins, contractTypes, hasGas: items.some((o) => o.energyType === "gas"), hasLuz: items.some((o) => o.energyType === "luz") };
}
