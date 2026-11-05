/**
 * CATÀLEG DE TARIFES · utilitats pures (servidor i navegador).
 * - Adaptador de les ofertes verificades actuals del CRM (taula `offers`) al model de versions.
 * - Validació de versions abans d'activar-les.
 * - Clau de deduplicació i detecció de canvis de preu.
 */
import type { Offer as CrmOffer } from "@/core/types";
import { applyCommercial } from "./commercial";
import { normalizeTariff, periodsOf } from "./engine";
import { emptySheet, offerVersionSchema, type OfferVersion } from "./types";
import { finalPrices } from "./final-prices";
import { permanenceIssues } from "./permanence";

export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "x";

/** Clau natural d'un producte: comercialitzadora + nom + peatge + tipus d'energia. */
export const productKey = (o: Pick<OfferVersion, "supplierName" | "productName" | "accessTariff" | "energyType">) =>
  `${slug(o.supplierName)}|${slug(o.productName)}|${normalizeTariff(o.accessTariff)}|${o.energyType}`;

/** Ofertes verificades del CRM (€/kW·dia, sense impostos) com a versions del catàleg (només lectura). */
export function fromCrmOffer(o: CrmOffer): OfferVersion {
  const gas = o.tipo === "gas" || /^RL/i.test(o.tarifa);
  const per = periodsOf(o.tarifa, gas ? "gas" : "luz");
  const energy = [...o.energia.slice(0, 6), null, null, null, null, null, null].slice(0, 6);
  const filled = energy.slice(0, per.energy).filter((x) => x != null);
  const single = !gas && filled.length > 0 && filled.every((x) => x === filled[0]) && per.energy > 1;
  const idx = /index/i.test(o.meta?.tipoPrecio ?? "");
  return {
    ...emptySheet(),
    id: `crm:${o.id}`,
    supplierId: `crm:${slug(o.comercializadora)}`,
    supplierName: o.comercializadora,
    productId: `crm:${o.id}`,
    productName: o.nombre,
    version: 1,
    energyType: gas ? "gas" : "luz",
    accessTariff: normalizeTariff(o.tarifa) ?? o.tarifa,
    segments: [o.meta?.residencial !== false ? "residencial" : null, o.meta?.pyme !== false ? "pyme" : null].filter(Boolean) as OfferVersion["segments"],
    contractType: idx ? "indexat" : single ? "fix24h" : "periodes",
    energy: gas ? Array(6).fill(null) : energy,
    energy24h: gas ? (o.energia[0] ?? null) : single ? (filled[0] as number) : null,
    power: [...o.potencia.slice(0, 6), null, null, null, null, null, null].slice(0, 6),
    powerUnit: "eur_kw_dia",
    gasFixedEurDay: gas ? (o.fijoDia ?? null) : null,
    fees: o.cuotaFijaMes ? [{ concept: "Quota fixa", eurMonth: o.cuotaFijaMes }] : [],
    // Les indexades del CRM porten el preu mitjà d'un mes com a referència
    indexedReference: idx ? { energy, note: `Preu mitjà indicat a l'oferta${o.meta?.mesIndexado ? ` (${o.meta.mesIndexado})` : ""}.`, asOf: o.meta?.mesIndexado ?? null } : null,
    permanenceMonths: null,
    penalty: null,
    durationMonths: null,
    priceGuaranteeMonths: null,
    eligibility: { minKwh: o.meta?.consumoMin ?? null, maxKwh: o.meta?.consumoMax || null, minKw: o.meta?.potenciaMin ?? null, maxKw: o.meta?.potenciaMax || null, territories: null, notes: o.meta?.ambito ?? null },
    validFrom: null,
    validTo: o.validaHasta && o.validaHasta < "9999-01-01" ? o.validaHasta : null, // 9999-12-31 = sense caducitat
    source: "Ofertes verificades del CRM",
    publishedAt: null,
    status: o.verificada ? "activa" : "esborrany",
    conditions: [o.notas, ...(o.ventajas ?? [])].filter(Boolean).join("\n") || null,
    origin: "crm",
  };
}

export interface VersionCheck {
  ok: boolean; // es pot activar
  errors: string[];
  warnings: string[];   // cal revisar-ho abans d'activar-la automàticament
  info: string[];       // informatiu: no impedeix activar-la (p. ex. sense data de fi de vigència)
}

/** Validació completa abans d'activar una versió. Les incompletes o ambigües queden en esborrany. */
export function checkVersion(o: OfferVersion): VersionCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = offerVersionSchema.safeParse(o);
  if (!parsed.success) for (const i of parsed.error.issues) errors.push(`${i.path.join(".")}: ${i.message}`);
  const per = periodsOf(o.accessTariff, o.energyType);
  if (!per.known) errors.push(`Peatge d'accés no reconegut: «${o.accessTariff}»`);
  if (o.energyType === "gas") {
    if (o.energy24h == null) errors.push("Falta el preu de l'energia del gas (€/kWh)");
    if (o.gasFixedEurDay == null) errors.push("Falta el terme fix del gas (€/dia)");
  } else {
    if (o.contractType === "fix24h") {
      if (o.energy24h == null) errors.push("Falta el preu únic d'energia (fix 24 h)");
    } else if (o.contractType === "indexat") {
      if (!o.indexedReference?.energy.some((x) => x != null)) warnings.push("Indexada sense preus de referència: no es podrà calcular el cost.");
    } else {
      for (let i = 0; i < per.energy; i++) if (o.energy[i] == null) errors.push(`Falta el preu d'energia P${i + 1}`);
    }
    for (let i = 0; i < per.power; i++) if (o.power[i] == null) errors.push(`Falta el preu de potència P${i + 1}`);
  }
  // Rangs plausibles (detecten errors d'unitats)
  for (const p of [...o.energy, o.energy24h]) if (p != null && (p <= 0 || p > 1)) errors.push(`Preu d'energia fora de rang (${p} €/kWh): revisa les unitats`);
  const lim = o.powerUnit === "eur_kw_dia" ? 1 : o.powerUnit === "eur_kw_mes" ? 30 : 365;
  for (const p of o.power) if (p != null && (p < 0 || p > lim)) errors.push(`Preu de potència fora de rang (${p} ${o.powerUnit}): revisa la unitat`);
  if (o.validFrom && o.validTo && o.validFrom > o.validTo) errors.push("La data d'inici és posterior a la de fi");
  // Classificació pendent (p. ex. «Variable» de Naturgy): no s'activa fins que algú confirmi si és fixa o indexada
  if (o.template?.classification === "pendent") errors.push("Classificació pendent: cal confirmar si és una tarifa fixa (preu revisable) o indexada");
  // Informatiu: un document de tarifes sense data de fi no és cap error (les tarifes es substitueixen per versions)
  const info: string[] = [];
  if (!o.validTo) info.push("Sense data de fi de vigència");
  if (!o.source) info.push("Sense font de publicació");
  if (o.sas.mode === "variable" && o.sas.eurKwh == null) warnings.push("SAS variable sense valor estimat");
  // Fase 2: la permanència obligatòria (fixes 3.0TD/6.1TD) s'ha de configurar; no impedeix desar però sí activar i emetre
  warnings.push(...permanenceIssues(o));
  if (o.energyType === "luz" && (!o.surplus || o.surplus.mode === "no_informada")) info.push("Compensació d'excedents no informada");
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings, info };
}

/** Ha canviat algun preu o condició econòmica? (crea una versió nova si és així) */
export function priceChanged(a: OfferVersion, b: OfferVersion): boolean {
  const pick = (o: OfferVersion) => JSON.stringify([o.contractType, o.energy, o.energy24h, o.power, o.powerUnit, o.gasFixedEurDay, o.taxTreatment, o.sas, o.fees, o.discounts, o.indexedReference, o.permanenceMonths, o.permanence ?? null, o.surplus ?? null, o.eligibility, o.validFrom, o.validTo]);
  return pick(a) !== pick(b);
}

export function newVersionFrom(o: OfferVersion, patch: Partial<OfferVersion> = {}): OfferVersion {
  return { ...structuredClone(o), ...patch, id: crypto.randomUUID(), version: o.version + 1, status: "esborrany", origin: patch.origin ?? o.origin };
}

/* ======================================================================= CATÀLEG COM A ÚNICA FONT (unificació) */

/** Sense data de caducitat a l'antic model d'ofertes. */
export const NO_EXPIRY = "9999-12-31";

/**
 * Una versió es pot proposar en una comparativa NOVA si: és del catàleg (no de l'antiga taula d'ofertes), està activa,
 * és vigent avui i té les dades mínimes per calcular. La compatibilitat amb el subministrament i els criteris del client
 * els aplica el motor (`eligibility`).
 */
export function selectableForNew(o: OfferVersion, today = new Date().toISOString().slice(0, 10), opts: { demo?: boolean } = {}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // mode demostració (sense servidor ni catàleg versionat): les ofertes de la demo són l'únic catàleg disponible
  if (!opts.demo && (o.origin === "crm" || o.id.startsWith("crm:"))) reasons.push("Oferta de l'antic apartat «Propostes» (no és del catàleg)");
  if (o.status !== "activa") reasons.push(`Estat «${o.status}»`);
  if (o.validTo && o.validTo < today) reasons.push(`Caducada el ${o.validTo}`);
  if (o.validFrom && o.validFrom > today) reasons.push(`Vigent a partir del ${o.validFrom}`);
  const chk = checkVersion(o);
  if (!chk.ok) reasons.push(...chk.errors.slice(0, 3));
  return { ok: reasons.length === 0, reasons };
}

/**
 * Una versió per producte: la més recent ACTIVA (la vigent per a comparatives noves). Si cap no és activa, la més recent.
 * Així una tarifa apareix una sola vegada encara que tingui moltes versions o un esborrany posterior.
 */
export function latestPerProduct<T extends Pick<OfferVersion, "productId" | "version" | "status">>(rows: T[]): T[] {
  const best = new Map<string, T>();
  const rank = (r: T) => (r.status === "activa" ? 1 : 0);
  for (const r of rows) {
    const cur = best.get(r.productId);
    if (!cur || rank(r) > rank(cur) || (rank(r) === rank(cur) && r.version > cur.version)) best.set(r.productId, r);
  }
  return [...best.values()];
}

/**
 * Versió del catàleg en el format antic d'ofertes, per als mòduls que encara el fan servir (renovacions: anàlisi de la
 * fitxa i proposta PDF de renovació). Els preus són els FINALS del catàleg (amb el descompte base aplicat una sola
 * vegada) i en €/kW·dia. L'identificador és el de la versió (traçabilitat). No és una segona font: es deriva del catàleg.
 */
export function toCrmOffer(o: OfferVersion, today = new Date().toISOString().slice(0, 10)): CrmOffer {
  const gas = o.energyType === "gas";
  const per = periodsOf(o.accessTariff, o.energyType);
  const fp = finalPrices(o);
  const toDay = (v: number | null) => (v == null ? null : o.powerUnit === "eur_kw_any" ? v / 365 : o.powerUnit === "eur_kw_mes" ? (v * 12) / 365 : v);
  const ref = o.contractType === "indexat" ? o.indexedReference?.energy ?? [] : [];
  const energia = gas ? [fp.energy24h] : Array.from({ length: Math.max(1, per.energy) }, (_, i) => (o.contractType === "indexat" ? ref[i] ?? null : fp.energy24h ?? fp.energy[i] ?? null));
  return {
    id: o.id,
    comercializadora: o.supplierName,
    nombre: `${o.productName} (v${o.version})`,
    tarifa: o.accessTariff,
    energia,
    potencia: gas ? [] : Array.from({ length: Math.max(1, per.power) }, (_, i) => toDay(fp.power[i] ?? null)),
    cuotaFijaMes: o.fees.filter((f) => !f.optional).reduce((a, f) => a + f.eurMonth, 0) || null,
    fijoDia: gas ? o.gasFixedEurDay : null,
    validaHasta: o.validTo ?? NO_EXPIRY,
    verificada: selectableForNew(o, today).ok,
    verificadaPor: "Catàleg de tarifes",
    notas: o.conditions,
    ventajas: [],
    tipo: gas ? "gas" : "luz",
    meta: {
      origen: "plantilla",
      tipoPrecio: o.contractType === "indexat" ? "Indexado" : o.contractType === "fix24h" ? "Fijo 24h" : "Fijo",
      residencial: o.segments.includes("residencial"), pyme: o.segments.includes("pyme"),
      potenciaMin: o.eligibility.minKw, potenciaMax: o.eligibility.maxKw, consumoMin: o.eligibility.minKwh, consumoMax: o.eligibility.maxKwh,
    },
  };
}

/* ------------------------------------------------------------ migració de les ofertes antigues («Propostes») */

export type LegacyClass = "ja_al_cataleg" | "vigent" | "caducada" | "incompleta" | "duplicada";
export const LEGACY_LABEL: Record<LegacyClass, string> = {
  ja_al_cataleg: "Ja existeix al catàleg", vigent: "Antiga però vigent (es pot incorporar)", caducada: "Caducada", incompleta: "Incompleta", duplicada: "Duplicada dins de Propostes",
};
export interface LegacyRow { id: string; label: string; productKey: string; cls: LegacyClass; usedInHistory: number; issues: string[]; catalogVersionId: string | null; importable: boolean }

/**
 * Classifica les ofertes de l'antic apartat «Propostes» comparant-les amb el catàleg. No modifica res.
 * `usedIn` = quantes comparatives històriques contenen cada oferta (per l'identificador «crm:<id>»).
 */
export function classifyLegacy(offers: CrmOffer[], catalog: Pick<OfferVersion, "id" | "supplierName" | "productName" | "accessTariff" | "energyType">[], usedIn: Record<string, number> = {}, today = new Date().toISOString().slice(0, 10)): LegacyRow[] {
  const byKey = new Map(catalog.map((c) => [productKey(c), c.id]));
  const seen = new Map<string, string>();
  return offers.map((o) => {
    const v = fromCrmOffer(o);
    const key = productKey(v);
    const chk = checkVersion({ ...v, status: "activa" });
    const used = usedIn[o.id] ?? 0;
    let cls: LegacyClass;
    if (byKey.has(key)) cls = "ja_al_cataleg";
    else if (seen.has(key)) cls = "duplicada";
    else if (o.validaHasta && o.validaHasta < today) cls = "caducada";
    else if (!chk.ok || !o.verificada) cls = "incompleta";
    else cls = "vigent";
    if (!seen.has(key)) seen.set(key, o.id);
    return { id: o.id, label: `${o.comercializadora} · ${o.nombre || "Sense nom"} · ${o.tarifa}`, productKey: key, cls, usedInHistory: used, issues: [...(o.verificada ? [] : ["No marcada com a disponible"]), ...chk.errors.slice(0, 4)], catalogVersionId: byKey.get(key) ?? null, importable: cls === "vigent" };
  });
}

/** Versió del catàleg creada a partir d'una oferta antiga vàlida (origen traçable). */
export function legacyToVersion(o: CrmOffer): OfferVersion {
  const v = fromCrmOffer(o);
  return { ...v, id: crypto.randomUUID(), supplierId: `sup:${slug(v.supplierName)}`, productId: "", origin: "manual", status: "activa", source: `Migrat de l'antic apartat «Propostes» (oferta ${o.id})` };
}

/* ------------------------------------------------------------ ajustos puntuals d'una comparativa */

/**
 * Canvis que només afecten UNA comparativa (mai la tarifa del catàleg):
 *  - `discountsOff`: descomptes desactivats (índex a `discounts`, o «doc» per al descompte del document ja inclòs al preu)
 *  - `sas`: afegir o treure el SAS quan la tarifa NO el porta inclòs, amb el valor i la justificació.
 */
export interface OfferAdjustment {
  discountsOff?: (number | "doc")[];
  sas?: { enabled: boolean; eurKwh: number | null; justification: string } | null;
  /** Combinació comercial triada (nivell d'energia i marge BOE) d'una tarifa amb matriu comercial. */
  commercial?: { level: string; margin: string | null } | null;
}
export type Adjustments = Record<string, OfferAdjustment>;

export function discountKeys(o: OfferVersion): { key: number | "doc"; label: string }[] {
  const out: { key: number | "doc"; label: string }[] = [];
  if (o.template?.original && o.contractType !== "indexat") {
    const fp = finalPrices(o);
    if (fp.energyPct || fp.powerPct) out.push({ key: "doc", label: o.template.discountText ?? `Descompte del document (${[fp.energyPct ? `${fp.energyPct} % energia` : "", fp.powerPct ? `${fp.powerPct} % potència` : ""].filter(Boolean).join(" · ")})` });
  }
  o.discounts.forEach((d, i) => out.push({ key: i, label: `${d.concept}${d.pct != null ? ` (${d.pct} % ${d.base === "energia" ? "energia" : d.base === "potencia" ? "potència" : "total"})` : ""}${d.eurYear != null ? ` (${d.eurYear} €/any)` : ""}` }));
  return out;
}

/** Aplica els ajustos a una CÒPIA de la versió. El SAS inclòs al preu mai s'afegeix de nou. */
export function applyAdjustment(o: OfferVersion, a: OfferAdjustment | undefined | null): OfferVersion {
  if (!a || (!a.discountsOff?.length && !a.sas && !a.commercial)) return o;
  const c: OfferVersion = a.commercial && o.commercial ? applyCommercial(o, a.commercial) : structuredClone(o);
  const off = new Set(a.discountsOff ?? []);
  if (off.has("doc") && c.template?.original && c.contractType !== "indexat") {
    const fp = finalPrices(o);
    if (fp.original) { c.energy = [...fp.original.energy]; c.energy24h = fp.original.energy24h; c.power = [...fp.original.power]; }
    c.template = { ...c.template, original: null, discountText: null };
  }
  c.discounts = c.discounts.filter((_, i) => !off.has(i));
  if (a.sas && c.sas.mode !== "inclos") c.sas = a.sas.enabled ? { mode: "variable", eurKwh: a.sas.eurKwh } : { mode: "exclos", eurKwh: null };
  return c;
}

export function applyAdjustments(offers: OfferVersion[], adj: Adjustments | null | undefined): OfferVersion[] {
  return offers.map((o) => applyAdjustment(o, adj?.[o.id]));
}
