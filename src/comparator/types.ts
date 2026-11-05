/**
 * COMPARATIVES IA · contractes de dades.
 * Regla general: `null` = dada desconeguda (mai 0 silenciós). Els imports són € amb 2 decimals.
 */
import { z } from "zod";
import type { OpenMeta } from "./endesa-open";
import type { IndexedFormula } from "./market";

export const PERIODS = [1, 2, 3, 4, 5, 6] as const;
export type P6<T> = [T, T, T, T, T, T];
export type Num = number | null;

export const POWER_UNITS = ["eur_kw_dia", "eur_kw_mes", "eur_kw_any"] as const;
export type PowerUnit = (typeof POWER_UNITS)[number];
export const POWER_UNIT_LABEL: Record<PowerUnit, string> = { eur_kw_dia: "€/kW·dia", eur_kw_mes: "€/kW·mes", eur_kw_any: "€/kW·any" };

export const CONTRACT_TYPES = ["fix24h", "periodes", "indexat", "mixt"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = { fix24h: "Fix 24 hores", periodes: "Discriminació per períodes", indexat: "Indexat", mixt: "Mixt" };

export const SEGMENTS = ["residencial", "pyme", "industrial"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SAS_MODES = ["inclos", "exclos", "variable"] as const;
export type SasMode = (typeof SAS_MODES)[number];
export const SAS_LABEL: Record<SasMode, string> = { inclos: "SAS inclòs al preu", exclos: "SAS no aplicable / exclòs", variable: "SAS variable (a part)" };

export const TARIFF_STATUSES = ["esborrany", "activa", "caducada", "arxivada"] as const;
export type TariffStatus = (typeof TARIFF_STATUSES)[number];

export const TAX_TREATMENTS = ["sense_impostos", "amb_iee", "amb_iee_iva"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export const TERRITORIES = ["peninsula", "balears", "canaries", "ceuta", "melilla"] as const;
export type Territory = (typeof TERRITORIES)[number];

export type EnergyType = "luz" | "gas";

/* ------------------------------------------------------------ excedents fotovoltaics (Fase 2) */

/** Modalitat de compensació d'excedents d'una tarifa. «no_informada» ≠ «sense»: mai s'assumeix que no compensa. */
export const SURPLUS_MODES = ["no_informada", "sense", "fix", "periodes", "indexat", "bateria"] as const;
export type SurplusMode = (typeof SURPLUS_MODES)[number];
export const SURPLUS_MODE_LABEL: Record<SurplusMode, string> = {
  no_informada: "Compensació no informada", sense: "Sense compensació d'excedents", fix: "Compensació a preu fix", periodes: "Compensació per períodes", indexat: "Compensació indexada o variable", bateria: "Bateria virtual",
};
/** Mecanisme: la compensació simplificada té límits legals; la venda d'excedents i altres mecanismes es tracten a part. */
export const SURPLUS_MECHANISMS = ["compensacio_simplificada", "venda", "altres"] as const;
export type SurplusMechanism = (typeof SURPLUS_MECHANISMS)[number];
export const SURPLUS_MECHANISM_LABEL: Record<SurplusMechanism, string> = { compensacio_simplificada: "Compensació simplificada", venda: "Venda d'excedents", altres: "Altres mecanismes" };

export interface SurplusConfig {
  mode: SurplusMode;
  mechanism: SurplusMechanism | null;
  /** Preu únic €/kWh (fix, indexat de referència o bateria) */
  eurKwh: Num;
  /** Preus per període €/kWh (modalitat «periodes») */
  periodEurKwh: Num[];
  /** Fórmula o referència del preu variable (text del contracte) */
  formula: string | null;
  validFrom: string | null;
  validTo: string | null;
  battery: { enabled: boolean; feeEurMonth: Num; accumulation: string | null; usage: string | null; expiry: string | null } | null;
  /** Limitacions contractuals de compensació (text) i si el saldo sobrant es pot aplicar a altres conceptes */
  limits: string | null;
  notes: string | null;
  source: "document" | "manual" | "ia" | "excel" | null;
}
export const emptySurplus = (mode: SurplusMode = "no_informada"): SurplusConfig => ({ mode, mechanism: mode === "no_informada" || mode === "sense" ? null : "compensacio_simplificada", eurKwh: null, periodEurKwh: Array(6).fill(null), formula: null, validFrom: null, validTo: null, battery: null, limits: null, notes: null, source: null });

/** Excedents del subministrament (separats del consum de xarxa). */
export interface SupplySurplus {
  kwhTotal: Num;
  monthly: Num[] | null;
  byPeriod: Num[] | null;
  /** Import compensat a la factura actual (€, positiu) i modalitat actual */
  currentCompensationEur: Num;
  currentMode: SurplusMode | null;
  battery: boolean;
  batteryBalanceEur: Num;
  /** Valors estimats (no llegits de la factura) */
  estimated: boolean;
}

/* ------------------------------------------------------------ permanència (Fase 2) */

export const PERMANENCE_STATUSES = ["amb", "sense", "no_informada"] as const;
export type PermanenceStatus = (typeof PERMANENCE_STATUSES)[number];
export interface PermanenceInfo {
  status: PermanenceStatus;
  months: Num;
  startNote: string | null;
  cancellation: string | null;
  penalty: string | null;
  /** Font contractual (document, clàusula…) */
  source: string | null;
  /** Excepció documentada a la regla de permanència obligatòria (només Direcció) */
  exception: string | null;
}
/** Regla comercial configurable per Direcció: tarifes fixes 3.0TD i 6.1TD amb permanència obligatòria. */
export interface PermanenceRule { enabled: boolean; tariffs: string[]; contractTypes: ContractType[] }
export const DEFAULT_PERMANENCE_RULE: PermanenceRule = { enabled: true, tariffs: ["3.0TD", "6.1TD"], contractTypes: ["fix24h", "periodes"] };

export interface Discount {
  concept: string;
  pct: Num; // % sobre la base indicada
  eurYear: Num; // import fix anual (es prorrateja pels dies)
  base: "energia" | "potencia" | "total_sense_impostos";
}
export interface Fee {
  concept: string;
  eurMonth: number;
  optional?: boolean; // serveis opcionals: no s'inclouen al cost
}

/** Preus d'un contracte (actual o oferta). */
export interface PriceSheet {
  contractType: ContractType;
  energy: Num[]; // €/kWh P1..P6 (gas: només P1)
  energy24h: Num; // €/kWh preu únic (fix 24 h o gas)
  power: Num[]; // P1..P6 en `powerUnit`
  powerUnit: PowerUnit;
  gasFixedEurDay: Num; // terme fix de gas €/dia
  taxTreatment: TaxTreatment;
  sas: { mode: SasMode; eurKwh: Num };
  fees: Fee[];
  discounts: Discount[];
  /** Només indexades: preus de referència estimats per període (metodologia indicada a `note`). */
  indexedReference?: { energy: Num[]; note: string; asOf: string | null } | null;
  /** Tarifes «Open» (Endesa): preus contractuals Open / No Open i ponderació horària que ha donat `energy`. */
  open?: OpenMeta | null;
  /** Ofertes indexades/mixtes: fórmula contractual pròpia de la comercialitzadora (comparador fix vs indexat). */
  formula?: IndexedFormula | null;
  /** Origen de la lectura: plantilla de lectura (comercialitzadora, versió) i classificació FIXA/INDEXADA/MIXTA/PENDENT. */
  template?: {
    templateId: string | null; name: string; version: number; classification: "fixa" | "indexada" | "mixta" | "pendent"; variant: string | null; code: string | null;
    /** Fase 12: referència a l'arxiu, pestanya, fila i cel·les d'origen. */
    origin?: { file: string; sheet: string; row: number; cells: string[] } | null;
    /** Preus originals (sense descompte) i text de descomptes del document, per al simulador. */
    original?: { energy: Num[]; power: Num[]; powerUnit: PowerUnit | null } | null;
    discountText?: string | null;
    interpStatus?: "interpretada" | "revisar" | "pendent" | "fallida" | null;
    rules?: string[];
  } | null;
  /** Compensació d'excedents de la tarifa (catàleg) o del contracte actual. Sense valor = no informada. */
  surplus?: SurplusConfig | null;
  /** Unitats originals del document i conversions aplicades (els preus de dalt ja són en unitats internes). */
  units?: {
    power?: { values: Num[]; unit: string } | null;
    energy?: { values: Num[]; unit: string } | null;
    gasFixed?: { value: Num; unit: string } | null;
    formulas: string[];
  } | null;
}

/** Versió d'una tarifa del catàleg (immutable un cop usada en una proposta emesa). */
/**
 * Matriu comercial d'una tarifa (p. ex. Nufri): nivells d'energia i marges de potència (BOE) amb els preus PUBLICATS
 * de cada combinació. Només conté preus i noms: els imports de comissió viuen a les regles (capa econòmica, restringida).
 */
export interface CommercialMatrix {
  scheme: "nufri";
  levels: { id: string; label: string; energy: Num[]; energy24h: Num; /** preus sense descompte (variants amb descompte publicat; els de dalt ja són finals) */ original?: { energy: Num[]; energy24h: Num } | null }[];
  margins: { id: string; label: string; eurKwYear: number; power: Num[] }[];
  default: { level: string; margin: string | null };
  /** Document d'origen (versió de l'annex) */
  source: string | null;
  /** Data de l'annex (aaaa-mm-dd): una importació d'un annex més antic no pot substituir-ne un de més recent */
  annexDate?: string | null;
  /** % de descompte publicat que ja porten els preus (cap descompte addicional) */
  discountPct?: number | null;
}

export interface OfferVersion extends PriceSheet {
  id: string;
  /** Matriu comercial (nivell d'energia × marge BOE). Els preus de la versió són els de la combinació per defecte. */
  commercial?: CommercialMatrix | null;
  supplierId: string;
  supplierName: string;
  supplierLogo?: string | null;
  productId: string;
  productName: string;
  version: number;
  energyType: EnergyType;
  accessTariff: string; // 2.0TD, 3.0TD, 6.1TD… o RL.x
  segments: Segment[];
  permanenceMonths: Num;
  /** Permanència detallada (Fase 2). Si no hi és, es deriva de `permanenceMonths`. */
  permanence?: PermanenceInfo | null;
  penalty: string | null;
  durationMonths: Num;
  priceGuaranteeMonths: Num;
  eligibility: { minKwh: Num; maxKwh: Num; minKw: Num; maxKw: Num; territories: Territory[] | null; notes: string | null };
  validFrom: string | null;
  validTo: string | null;
  source: string | null;
  publishedAt: string | null;
  status: TariffStatus;
  conditions: string | null;
  origin: "manual" | "excel" | "api" | "crm";
}

export type ValueSource = "factura" | "sips" | "crm" | "manual" | "calculat" | null;

/** Dades del subministrament per al càlcul. */
export interface SupplyInput {
  energyType: EnergyType;
  accessTariff: string | null;
  territory: Territory;
  segment: Segment | null;
  /** Dies del període de càlcul (365 = any). */
  days: number;
  basis: "anual" | "periode_facturat" | "anualitzat";
  kwh: Num[]; // per període
  kwhTotal: Num; // total del període de càlcul
  kw: Num[]; // potència contractada per període
  meterRentEurMonth: Num;
  /** Habitatge amb ≤ 10 kW (afecta l'IGIC de Canàries). */
  residentialLowPower?: boolean;
  /** Corba de consum horari real (data local, hora 0–23, kWh). Només per a tarifes amb franges (Open). */
  hourly?: { date: string; hour: number; kwh: number }[] | null;
  sources?: { kwh?: ValueSource; kw?: ValueSource; prices?: ValueSource };
  /** Excedents fotovoltaics (separats del consum de xarxa). */
  surplus?: SupplySurplus | null;
  /** Dates del període facturat (només informatives, de la factura). */
  periodFrom?: string | null;
  periodTo?: string | null;
}

/** Fiscalitat configurable (valors per defecte a revisar quan canviï la normativa). */
export interface TaxConfig {
  ieePct: number;
  ieeMinEurMWh: number; // mínim de l'impost elèctric (€/MWh)
  gasHydrocarbonEurKwh: number; // impost d'hidrocarburs del gas natural
  vat: Record<Territory, { label: string; pct: number; lowPowerResidentialPct?: number }>;
}

export const DEFAULT_TAXES: TaxConfig = {
  ieePct: 5.11269632,
  ieeMinEurMWh: 1,
  gasHydrocarbonEurKwh: 0.00234,
  vat: {
    peninsula: { label: "IVA", pct: 21 },
    balears: { label: "IVA", pct: 21 },
    canaries: { label: "IGIC", pct: 3, lowPowerResidentialPct: 0 },
    ceuta: { label: "IPSI", pct: 1 },
    melilla: { label: "IPSI", pct: 1 },
  },
};

export type LineKey = "energia" | "sas" | "potencia" | "fix_gas" | "quotes" | "descomptes" | "excedents" | "bateria" | "iee" | "hidrocarburs" | "lloguer" | "impost_indirecte";

/** Resultat de la compensació d'excedents d'un escenari. */
export interface SurplusResult {
  kwh: number;
  priceEurKwh: Num;
  mode: SurplusMode;
  status: "aplicada" | "no_compensa" | "no_informada" | "pendent";
  /** Valor econòmic dels excedents (abans de límits) */
  valueEur: number;
  /** Import compensat a la factura (després del límit) */
  compensationEur: number;
  /** Sobrant que va a la bateria virtual (no redueix aquesta factura) */
  toBatteryEur: number;
  /** Sobrant que es perd pel límit (sense bateria) */
  lostEur: number;
  batteryFeeEur: number;
  limited: boolean;
  estimated: boolean;
  note: string | null;
}

export interface CostLine {
  key: LineKey;
  label: string;
  formula: string;
  amount: number;
  estimated: boolean;
}

export interface CostResult {
  ok: boolean;
  missing: string[];
  lines: CostLine[];
  energy: number;
  sas: number;
  power: number;
  fixed: number;
  discounts: number;
  subtotal: number; // sense impostos ni lloguer
  iee: number;
  rent: number;
  vatBase: number;
  vat: number;
  totalExTax: number; // subtotal + lloguer (sense impostos)
  total: number; // amb impostos
  quality: "exacte" | "estimat" | "incomplet";
  notes: string[];
  /** Excedents (només si el subministrament en té) */
  surplus?: SurplusResult | null;
  /** Detall per període (motor ≥ 1.1.0): el mateix càlcul que els totals, per a la taula de la pantalla i del PDF. */
  detail?: CostDetail | null;
}

/** Imports per període. `price` és el preu efectiu sense impostos aplicat (€/kWh, €/kW·dia o €/dia). */
export interface CostDetail {
  energy: { period: number | null; kwh: number | null; price: number | null; amount: number | null }[];
  power: { period: number; kw: number | null; price: number | null; amount: number | null }[];
  gasFixed: { days: number; price: number | null; amount: number | null } | null;
  discountEnergy: number;
  discountPower: number;
  discountOther: number;
  fees: number;
  single: boolean;
  ieeLabel: string | null;
  vatLabel: string;
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
}

export interface OfferEvaluation {
  offer: OfferVersion;
  eligibility: Eligibility;
  cost: CostResult;
  saving: Num; // € (amb impostos) respecte de l'actual
  savingPct: Num;
  scores: { price: number; stability: number; permanence: number; variability: number; total: number } | null;
  tags: string[];
}

export interface RankingWeights {
  price: number;
  stability: number;
  permanence: number;
  variability: number;
}
export const DEFAULT_WEIGHTS: RankingWeights = { price: 0.7, stability: 0.1, permanence: 0.1, variability: 0.1 };

export const ENGINE_VERSION = "1.1.0";

/* ------------------------------------------------------------- esquemes zod */

const num = z.number().finite().nullable();
const nonNeg = z.number().finite().min(0).nullable();

export const priceSheetSchema = z.object({
  contractType: z.enum(CONTRACT_TYPES),
  energy: z.array(nonNeg).max(6),
  energy24h: nonNeg,
  power: z.array(nonNeg).max(6),
  powerUnit: z.enum(POWER_UNITS),
  gasFixedEurDay: nonNeg,
  taxTreatment: z.enum(TAX_TREATMENTS),
  sas: z.object({ mode: z.enum(SAS_MODES), eurKwh: nonNeg }),
  fees: z.array(z.object({ concept: z.string().max(120), eurMonth: z.number().finite().min(0), optional: z.boolean().optional() })).max(20),
  discounts: z
    .array(z.object({ concept: z.string().max(120), pct: z.number().finite().min(0).max(100).nullable(), eurYear: nonNeg, base: z.enum(["energia", "potencia", "total_sense_impostos"]) }))
    .max(10),
  indexedReference: z.object({ energy: z.array(nonNeg).max(6), note: z.string().max(500), asOf: z.string().nullable() }).nullable().optional(),
  open: z.object({
    supplier: z.string().max(80), product: z.string().max(80), modality: z.enum(["plana", "dia", "laboral", "cap_de_setmana", "nit"]), docVersion: z.string().max(40).nullable(),
    openPrice: z.number().finite().min(0), noOpenPrice: z.number().finite().min(0),
    bracket: z.object({ label: z.string().max(60), minKw: z.number().finite().nullable(), maxKw: z.number().finite().nullable() }),
    rule: z.union([
      z.object({ mode: z.literal("plana") }),
      z.object({ mode: z.literal("horari"), windows: z.array(z.object({ days: z.enum(["tots", "dl_dv", "laborable", "festiu"]), from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) })).min(1).max(8) }),
      z.object({ mode: z.literal("periodes"), openPeriods: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])).max(6) }),
    ]),
    ruleSource: z.enum(["direccio", "document", "biblioteca", "xat"]), approved: z.boolean(),
    reference: z.object({ from: z.string().max(10), to: z.string().max(10) }),
    periods: z.array(z.object({ period: z.number().int(), open: z.number(), noOpen: z.number(), total: z.number(), price: z.number() })).max(6),
    estimated: z.literal(true),
    label: z.string().max(120).optional(),
    kind: z.enum(["ponderada", "comercial"]).optional(),
  }).nullable().optional(),
  formula: z.object({
    index: z.enum(["OMIE", "OMIP", "PVPC", "MIBGAS", "TTF", "altres"]), granularity: z.enum(["horari", "periodes", "mensual"]),
    lossesPct: z.array(z.number().finite().min(0).max(100).nullable()).max(6).nullable(),
    ssaaEurMWh: z.number().finite().min(-100).max(500).nullable(), marginEurMWh: z.number().finite().min(-100).max(500).nullable(), otherEurMWh: z.number().finite().min(-100).max(500).nullable(),
    regulatedEurKwh: z.array(z.number().finite().min(0).max(1).nullable()).max(6).nullable(), regulatedIncluded: z.boolean(), contractText: z.string().max(2000).nullable(),
  }).nullable().optional(),
  template: z.object({
    templateId: z.string().max(60).nullable(), name: z.string().max(120), version: z.number().int().min(1), classification: z.enum(["fixa", "indexada", "mixta", "pendent"]), variant: z.string().max(40).nullable(), code: z.string().max(60).nullable(),
    origin: z.object({ file: z.string().max(300), sheet: z.string().max(120), row: z.number().int().min(1), cells: z.array(z.string().max(40)).max(40) }).nullable().optional(),
    original: z.object({ energy: z.array(nonNeg).max(6), power: z.array(nonNeg).max(6), powerUnit: z.enum(POWER_UNITS).nullable() }).nullable().optional(),
    discountText: z.string().max(500).nullable().optional(),
    interpStatus: z.enum(["interpretada", "revisar", "pendent", "fallida"]).nullable().optional(),
    rules: z.array(z.string().max(160)).max(20).optional(),
  }).nullable().optional(),
  surplus: z.object({
    mode: z.enum(SURPLUS_MODES), mechanism: z.enum(SURPLUS_MECHANISMS).nullable(), eurKwh: z.number().finite().min(0).max(1).nullable(), periodEurKwh: z.array(z.number().finite().min(0).max(1).nullable()).max(6),
    formula: z.string().max(1000).nullable(), validFrom: z.string().max(10).nullable(), validTo: z.string().max(10).nullable(),
    battery: z.object({ enabled: z.boolean(), feeEurMonth: z.number().finite().min(0).max(1000).nullable(), accumulation: z.string().max(1000).nullable(), usage: z.string().max(1000).nullable(), expiry: z.string().max(500).nullable() }).nullable(),
    limits: z.string().max(1000).nullable(), notes: z.string().max(2000).nullable(), source: z.enum(["document", "manual", "ia", "excel"]).nullable(),
  }).nullable().optional(),
  units: z.object({
    power: z.object({ values: z.array(nonNeg).max(6), unit: z.string().max(40) }).nullable().optional(),
    energy: z.object({ values: z.array(nonNeg).max(6), unit: z.string().max(40) }).nullable().optional(),
    gasFixed: z.object({ value: nonNeg, unit: z.string().max(40) }).nullable().optional(),
    formulas: z.array(z.string().max(200)).max(20),
  }).nullable().optional(),
});

export const offerVersionSchema = priceSheetSchema.extend({
  id: z.string(),
  supplierId: z.string(),
  supplierName: z.string().min(1).max(120),
  supplierLogo: z.string().max(400_000).nullable().optional(),
  productId: z.string(),
  productName: z.string().min(1).max(160),
  version: z.number().int().min(1),
  energyType: z.enum(["luz", "gas"]),
  accessTariff: z.string().min(2).max(20),
  segments: z.array(z.enum(SEGMENTS)).min(1),
  permanenceMonths: num,
  commercial: z.object({
    scheme: z.literal("nufri"),
    levels: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(60), energy: z.array(num).max(6), energy24h: num, original: z.object({ energy: z.array(num).max(6), energy24h: num }).nullable().optional() })).min(1).max(12),
    margins: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(60), eurKwYear: z.number().finite().min(0).max(100), power: z.array(num).max(6) })).max(12),
    default: z.object({ level: z.string().max(40), margin: z.string().max(40).nullable() }),
    source: z.string().max(200).nullable(),
    annexDate: z.string().max(10).nullable().optional(),
    discountPct: z.number().min(0).max(100).nullable().optional(),
  }).nullable().optional(),
  permanence: z.object({
    status: z.enum(PERMANENCE_STATUSES), months: z.number().int().min(0).max(120).nullable(), startNote: z.string().max(300).nullable(), cancellation: z.string().max(1000).nullable(),
    penalty: z.string().max(1000).nullable(), source: z.string().max(300).nullable(), exception: z.string().max(500).nullable(),
  }).nullable().optional(),
  penalty: z.string().max(500).nullable(),
  durationMonths: num,
  priceGuaranteeMonths: num,
  eligibility: z.object({ minKwh: nonNeg, maxKwh: nonNeg, minKw: nonNeg, maxKw: nonNeg, territories: z.array(z.enum(TERRITORIES)).nullable(), notes: z.string().max(500).nullable() }),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  source: z.string().max(300).nullable(),
  publishedAt: z.string().nullable(),
  status: z.enum(TARIFF_STATUSES),
  conditions: z.string().max(4000).nullable(),
  origin: z.enum(["manual", "excel", "api", "crm"]),
});

export const supplySchema = z.object({
  energyType: z.enum(["luz", "gas"]),
  accessTariff: z.string().nullable(),
  territory: z.enum(TERRITORIES),
  segment: z.enum(SEGMENTS).nullable(),
  days: z.number().int().min(1).max(400),
  basis: z.enum(["anual", "periode_facturat", "anualitzat"]),
  kwh: z.array(nonNeg).max(6),
  kwhTotal: nonNeg,
  kw: z.array(nonNeg).max(6),
  meterRentEurMonth: nonNeg,
  residentialLowPower: z.boolean().optional(),
  hourly: z.array(z.object({ date: z.string().max(10), hour: z.number().int().min(0).max(23), kwh: z.number().finite().min(0) })).max(9000).nullable().optional(),
  sources: z.record(z.string(), z.string().nullable()).optional(),
  surplus: z.object({
    kwhTotal: nonNeg, monthly: z.array(nonNeg).max(12).nullable(), byPeriod: z.array(nonNeg).max(6).nullable(), currentCompensationEur: nonNeg, currentMode: z.enum(SURPLUS_MODES).nullable(),
    battery: z.boolean(), batteryBalanceEur: nonNeg, estimated: z.boolean(),
  }).nullable().optional(),
  periodFrom: z.string().max(10).nullable().optional(),
  periodTo: z.string().max(10).nullable().optional(),
});

export function emptySheet(): PriceSheet {
  return {
    contractType: "periodes",
    energy: Array(6).fill(null),
    energy24h: null,
    power: Array(6).fill(null),
    powerUnit: "eur_kw_dia",
    gasFixedEurDay: null,
    taxTreatment: "sense_impostos",
    sas: { mode: "inclos", eurKwh: null },
    fees: [],
    discounts: [],
    indexedReference: null,
  };
}
