/**
 * NUFRI → CATÀLEG DE TARIFES (mateix model de tarifes, sense catàleg paral·lel).
 *
 *  - Un producte per peatge i modalitat d'energia (p. ex. «Nufri 3.0TD · Seis precios · 30% descuento») amb la MATRIU
 *    COMERCIAL: nivells d'energia (FUJI…ROYAL G) × marges de potència (BOE…), amb els preus PUBLICATS de cada combinació.
 *    Així no hi ha desenes de productes duplicats: el nivell i el marge es trien a la comparativa.
 *  - Les comissions NO viatgen a la tarifa: es proposen com a regles (capa «proveïdor») pendents d'aprovació de Direcció.
 *  - Les modalitats indexades s'importen com a ESBORRANY amb la fórmula literal: sense dades de mercat no són calculables.
 *  - El terme fix del gas només es converteix a €/dia si la unitat està confirmada (pel document o per Direcció).
 */
import { checkVersion, productKey } from "./catalog";
import { toInternal } from "./units";
import { emptySheet, emptySurplus, type CommercialMatrix, type OfferVersion, type SurplusConfig } from "./types";
import type { AiTariffItem } from "./tariff-ai";
import type { NufriDoc, NufriElecTable, NufriVariant } from "./nufri-reader";

export type NufriGroup = "2.0TD" | "3.0TD" | "indexada" | "gas_fix" | "gas_indexat";
export const NUFRI_GROUP_LABEL: Record<NufriGroup, string> = { "2.0TD": "Electricitat 2.0TD", "3.0TD": "Electricitat 3.0TD", indexada: "Electricitat indexada", gas_fix: "Gas · modalitat fixa 12 mesos", gas_indexat: "Gas · modalitat indexada" };
export interface NufriItem extends AiTariffItem { group: NufriGroup; approvals: string[] }
/** Unitats admeses per confirmar el terme fix del gas (no se n'assumeix cap). */
export const GAS_FIXED_UNITS = { mes: "€/cliente/mes", any: "€/cliente/año", dia: "€/cliente/día" } as const;
export const GAS_FIXED_UNIT_LABEL: Record<"mes" | "any" | "dia", string> = { mes: "€/client·mes", any: "€/client·any", dia: "€/client·dia" };
export type GasFixedUnit = keyof typeof GAS_FIXED_UNITS;

const pad6 = <T,>(xs: (T | null)[]) => Array.from({ length: 6 }, (_, i) => xs[i] ?? null);

function base(p: Partial<OfferVersion>): OfferVersion {
  return {
    ...emptySheet(), id: crypto.randomUUID(), supplierId: "sup:nufri", supplierName: "Nufri", productId: "", productName: "", version: 1,
    energyType: "luz", accessTariff: "2.0TD", segments: ["residencial", "pyme"], permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: null,
    eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
    validFrom: null, validTo: null, source: null, publishedAt: null, status: "esborrany", conditions: null, origin: "excel", ...p,
  };
}

/** Data de l'annex d'una tarifa del catàleg amb matriu comercial (o null). */
export function annexDateOf(o: Pick<OfferVersion, "commercial" | "validFrom">): string | null {
  if (!o.commercial) return null;
  if (o.commercial.annexDate) return o.commercial.annexDate;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(o.commercial.source ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : o.validFrom ?? null;
}

function conditionsText(doc: NufriDoc, t: NufriElecTable | null): string {
  const c = doc.conditions;
  return [
    `Annex ${doc.version ?? "—"}${doc.conditionsVersion ? ` (${doc.conditionsVersion})` : ""}.`,
    c.validUntilNote ? `Validesa: activacions a partir del ${c.validFrom ?? "—"} · ${c.validUntilNote}.` : null,
    c.maxAnnualKwh ? `Contractes fins a ${c.maxAnnualKwh / 1000} MWh de consum anual.` : null,
    c.newClientsOnly ? "Només clients sense contracte vigent amb Energía Nufri (o en procés d'activació)." : null,
    c.nonTelemeteredOnly ? "Només punts NO telemesurats." : null,
    c.customOffer ? `RL.4 de més de 200 MWh/any: oferta i comissió personalitzades (${c.customOffer}).` : null,
    t ? (t.greenIncluded === true ? "Inclou energia 100 % renovable amb GdO." : t.greenIncluded === false ? "Els preus NO inclouen l'energia verda." : null) : null,
    c.sasIncluded === false ? "Els preus no inclouen el mecanisme d'ajust (RDL 3/2023): es factura a part." : null,
    c.reserveVirtual.note,
    "Nufri es reserva l'acceptació del contracte. Retribució segons el contracte d'agents.",
  ].filter(Boolean).join("\n");
}

function surplusOf(t: NufriElecTable, doc: NufriDoc): SurplusConfig {
  if (t.surplus.fixEurMwh == null) return emptySurplus("no_informada");
  return {
    ...emptySurplus("fix"), mechanism: "compensacio_simplificada", eurKwh: t.surplus.fixEurMwh / 1000, validFrom: doc.annexDate,
    limits: t.surplus.scope, source: "document",
    notes: [t.surplus.indexed ? `Alternativa indexada: ${t.surplus.indexed} (es conserva la fórmula; no és un preu fix)` : null, doc.conditions.reserveVirtual.note].filter(Boolean).join(" · ").slice(0, 1000) || null,
  };
}

function matrixOf(t: NufriElecTable, v: NufriVariant, doc: NufriDoc): CommercialMatrix {
  const baseV = v.baseOf ? t.variants.find((x) => x.id === v.baseOf) : null;
  const levels = v.levels.map((l) => {
    const o = baseV?.levels.find((x) => x.id === l.id);
    return { id: l.id, label: l.label, energy: pad6(l.energy), energy24h: l.energy24h, original: o ? { energy: pad6(o.energy), energy24h: o.energy24h } : null };
  });
  return {
    scheme: "nufri", levels, margins: t.margins.map((m) => ({ id: m.id, label: m.label, eurKwYear: m.eurKwYear, power: pad6(m.power) })),
    default: { level: levels[0].id, margin: t.margins[0]?.id ?? null }, source: doc.version, annexDate: doc.annexDate, discountPct: v.discountPct,
  };
}

/** Tarifes del catàleg (esborrany) a partir de l'annex, agrupades per a la previsualització. */
export function nufriItems(doc: NufriDoc, ctx: { fileName: string; existing: OfferVersion[]; supplierName?: string | null; gasFixedUnit?: GasFixedUnit | null }): NufriItem[] {
  const src = `Annex Nufri ${doc.version ?? ""} · ${ctx.fileName}`.slice(0, 300);
  const supplierName = ctx.supplierName?.trim() || "Nufri";
  const out: NufriItem[] = [];
  const push = (group: NufriGroup, offer: OfferVersion, warnings: string[], approvals: string[] = [], page: number | null = null) => {
    const check = checkVersion(offer);
    out.push({ group, offer, warnings: [...new Set([...warnings, ...check.warnings])], errors: check.errors, approvals, page, confidence: "alta", notes: null, status: "nova", previous: null, conversions: [] });
  };
  for (const t of doc.elec) {
    for (const v of t.variants) {
      if (!v.levels.length) continue;
      const matrix = matrixOf(t, v, doc);
      const lv = matrix.levels[0];
      const w: string[] = [];
      if (t.tariff === "3.0TD") w.push("Permanència: l'annex no la indica. Les tarifes fixes 3.0TD n'han de tenir (o una excepció de Direcció) abans d'activar-les.");
      if (v.discountPct) w.push(`Preus publicats amb el ${v.discountPct} % de descompte JA aplicat (l'original es conserva a part; no s'aplica cap descompte més). Confirma'n les condicions.`);
      if (doc.conditions.powerCommissionNote) w.push("La comissió per terme de potència exigeix mantenir la potència inicial durant el contracte.");
      push(t.tariff, base({
        supplierName, accessTariff: t.tariff, productName: `Nufri ${t.tariff} · ${v.label}`,
        segments: t.tariff === "2.0TD" ? ["residencial", "pyme"] : ["pyme", "industrial"],
        contractType: v.single ? "fix24h" : "periodes",
        energy: v.single ? Array(6).fill(null) : pad6(lv.energy), energy24h: v.single ? lv.energy24h : null,
        power: pad6(matrix.margins[0]?.power ?? []), powerUnit: "eur_kw_dia",
        sas: { mode: "variable", eurKwh: null },
        surplus: surplusOf(t, doc),
        template: v.discountPct && lv.original ? { templateId: null, name: "Lector local Nufri", version: 1, classification: "fixa", variant: v.label, code: null, original: { energy: pad6(v.single ? [lv.original.energy24h] : lv.original.energy), power: pad6(matrix.margins[0]?.power ?? []), powerUnit: "eur_kw_dia" }, discountText: `${v.discountPct} % de descompte publicat a l'annex (preu ja descomptat)` } : null,
        eligibility: { minKwh: null, maxKwh: doc.conditions.maxAnnualKwh, minKw: null, maxKw: null, territories: null, notes: doc.conditions.maxAnnualKwh ? `Contractes fins a ${doc.conditions.maxAnnualKwh / 1000} MWh de consum anual` : null },
        validFrom: doc.annexDate, publishedAt: doc.annexDate, source: src, conditions: conditionsText(doc, t), commercial: matrix,
      }), w, [], v.levels[0]?.origin.page ?? null);
    }
  }
  if (doc.indexed?.rows.length) {
    for (const tariff of ["2.0TD", "3.0TD"] as const) {
      const t = doc.elec.find((x) => x.tariff === tariff) ?? null;
      const ix = doc.indexed;
      push("indexada", base({
        supplierName, accessTariff: tariff, productName: `Nufri ${tariff} · Indexada`, contractType: "indexat",
        segments: tariff === "2.0TD" ? ["residencial", "pyme"] : ["pyme", "industrial"], power: pad6(t?.margins[0]?.power ?? []), powerUnit: "eur_kw_dia",
        sas: { mode: "variable", eurKwh: null }, surplus: t ? { ...surplusOf(t, doc), mode: "indexat", eurKwh: null, formula: ix.surplusIndexed ?? t.surplus.indexed } : emptySurplus("no_informada"),
        formula: { index: "OMIE", granularity: "horari", lossesPct: null, ssaaEurMWh: null, marginEurMWh: null, otherEurMWh: null, regulatedEurKwh: null, regulatedIncluded: false, contractText: `${ix.formula ?? ""} · K = ${ix.k ?? "—"} (coeficient)`.slice(0, 1000) },
        eligibility: { minKwh: null, maxKwh: doc.conditions.maxAnnualKwh, minKw: null, maxKw: null, territories: null, notes: null },
        validFrom: doc.annexDate, publishedAt: doc.annexDate, source: src,
        conditions: [conditionsText(doc, t), `CO disponibles (€/MWh): ${ix.rows.map((r) => r.coEurMwh).join(", ")}.`, ...ix.greenNotes, ...ix.components.map((c) => `${c.code}: ${c.description}`)].join("\n").slice(0, 4000),
      }), ["Indexada: sense dades de mercat no es pot calcular (no s'inventa cap preu). Cal completar la fórmula i triar el CO abans d'activar-la."], [], ix.rows[0]?.origin.page ?? null);
    }
  }
  for (const g of doc.gas) {
    const unit = g.fixedTerm.unit ? null : ctx.gasFixedUnit ?? null;
    const conv = g.fixedTerm.unit ? toInternal(g.fixedTerm.value, g.fixedTerm.unit, "terme_fix_gas") : unit ? toInternal(g.fixedTerm.value, GAS_FIXED_UNITS[unit], "terme_fix_gas") : null;
    const approvals = !g.fixedTerm.unit && !unit ? [`Terme fix ${g.fixedTerm.value.toLocaleString("ca-ES")} sense unitat al document: confirma-la abans d'activar.`] : [];
    const levels = g.levels.map((l) => ({ id: l.id, label: l.label, energy: pad6([l.fixed]), energy24h: l.fixed }));
    const common = {
      supplierName, energyType: "gas" as const, accessTariff: g.tariff, power: Array(6).fill(null), sas: { mode: "exclos" as const, eurKwh: null },
      gasFixedEurDay: conv?.value ?? null,
      units: { gasFixed: { value: g.fixedTerm.value, unit: g.fixedTerm.unit ?? (unit ? GAS_FIXED_UNITS[unit] : "no indicada al document") }, formulas: conv?.ok && conv.formula !== "—" ? [`Terme fix: ${conv.formula}`] : [] },
      eligibility: { minKwh: g.minKwh, maxKwh: g.maxKwh, minKw: null, maxKw: null, territories: null, notes: "Només punts no telemesurats" },
      segments: ["residencial", "pyme"] as OfferVersion["segments"], validFrom: doc.annexDate, publishedAt: doc.annexDate, source: src, conditions: conditionsText(doc, null),
    };
    push("gas_fix", base({
      ...common, productName: `Nufri Gas ${g.tariff} · Fijo 12 meses`, contractType: "fix24h", energy: Array(6).fill(null), energy24h: levels[0]?.energy24h ?? null, priceGuaranteeMonths: 12,
      commercial: { scheme: "nufri", levels, margins: [], default: { level: levels[0]?.id ?? "", margin: null }, source: doc.version, annexDate: doc.annexDate },
    }), [unit ? `Terme fix confirmat com a ${GAS_FIXED_UNITS[unit]} (convertit a €/dia).` : ""].filter(Boolean), approvals, g.origin.page);
    if (doc.gasIndexedFormula && g.levels.some((l) => l.c != null)) {
      push("gas_indexat", base({
        ...common, productName: `Nufri Gas ${g.tariff} · Indexada`, contractType: "indexat", energy: Array(6).fill(null), energy24h: null,
        formula: { index: "MIBGAS", granularity: "mensual", lossesPct: null, ssaaEurMWh: null, marginEurMWh: null, otherEurMWh: null, regulatedEurKwh: null, regulatedIncluded: true, contractText: `${doc.gasIndexedFormula.text} · ${g.levels.map((l) => `${l.label}: C = ${l.c ?? "—"}`).join(" · ")}`.slice(0, 1000) },
        conditions: [common.conditions, `Fórmula: ${doc.gasIndexedFormula.text} (PVB = índex; ${doc.gasIndexedFormula.multiplier} = coeficient; C = constant per nivell, no és una comissió).`, doc.gasIndexedFormula.pvbDefinition ? `PVB: ${doc.gasIndexedFormula.pvbDefinition}` : null].filter(Boolean).join("\n").slice(0, 4000),
      }), ["Indexada: el preu depèn del PVB (MIBGAS). Per simular-la cal un PVB de referència i el resultat és estimat."], approvals, g.origin.page);
    }
  }
  // estat respecte del catàleg: nova / preus nous / sense canvis / annex més antic (no substitueix mai un de més recent)
  const byKey = new Map(ctx.existing.map((e) => [productKey(e), e]));
  const sig = (o: OfferVersion) => JSON.stringify([o.contractType, o.energy, o.energy24h, o.power, o.gasFixedEurDay, o.commercial ?? null, o.surplus ?? null]);
  for (const it of out) {
    const prev = byKey.get(productKey(it.offer));
    if (prev) {
      it.previous = prev;
      it.offer.productId = prev.productId;
      it.offer.supplierId = prev.supplierId;
      it.offer.version = prev.version + 1;
      const pd = annexDateOf(prev), nd = annexDateOf(it.offer);
      if (pd && nd && nd < pd) { it.errors = [...it.errors, `Annex més antic (${nd}) que el del catàleg (${pd}): no pot substituir-lo.`]; it.status = "incompleta"; continue; }
    }
    it.status = it.errors.length ? "incompleta" : prev && sig(prev) === sig(it.offer) ? "sense_canvis" : it.warnings.length || it.approvals.length ? "revisio" : prev ? "modificada" : "nova";
  }
  return out;
}

/* ------------------------------------------------------------------ propostes de regla de comissió */

export interface RuleProposal {
  rule_key: string; name: string; layer: "proveidor"; retailer: string; product: string; service: "gas" | null; kind: "per_mwh" | "energia_potencia";
  value: string; conditions: Record<string, unknown>; valid_from: string; notes: string;
}

/**
 * Regles de la capa «proveïdor» que es proposen a Direcció (pendents d'aprovació). Energia i potència per separat:
 *  · llum, nivell d'energia → «energia_potencia»: €/MWh del nivell + marge BOE triat al contracte × suma dels kW
 *    contractats de tots els períodes (regla confirmada per Direcció per a Nufri).
 *  · llum indexada → «per_mwh» per CO · gas → «per_mwh» per peatge, nivell i modalitat (fixa / indexada).
 */
export function nufriRuleProposals(doc: NufriDoc, retailer = "Nufri"): RuleProposal[] {
  const out: RuleProposal[] = [];
  const from = doc.annexDate ?? new Date().toISOString().slice(0, 10);
  const src = doc.version ?? "annex";
  const seen = new Set<string>();
  for (const e of doc.elec) for (const v of e.variants) for (const l of v.levels) {
    if (l.eurMwh == null || seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({
      rule_key: `nufri_llum_${l.id.toLowerCase()}`.slice(0, 60), name: `Nufri · ${l.label} (energia ${l.eurMwh} €/MWh + marge BOE de potència)`, layer: "proveidor", retailer, product: l.label, service: null,
      kind: "energia_potencia", value: String(l.eurMwh), conditions: { power_margin: "boe", scheme: "nufri", source: src }, valid_from: from,
      notes: `Annex ${src}: energia = MWh × ${l.eurMwh} €/MWh; potència = suma dels kW contractats de tots els períodes × marge BOE (€/kW·any).`,
    });
  }
  for (const r of (doc.indexed?.rows ?? []).filter((x): x is typeof x & { commissionEurMwh: number } => x.commissionEurMwh != null)) out.push({
    rule_key: `nufri_llum_index_co${r.coEurMwh}`, name: `Nufri · Indexada CO ${r.coEurMwh} €/MWh (${r.commissionEurMwh} €/MWh)`, layer: "proveidor", retailer, product: "Indexada", service: null,
    kind: "per_mwh", value: String(r.commissionEurMwh), conditions: { co_eur_mwh: r.coEurMwh, scheme: "nufri", source: src }, valid_from: from,
    notes: `Annex ${src}: comissió ${r.commissionEurMwh} €/MWh amb CO = ${r.coEurMwh} €/MWh.`,
  });
  for (const g of doc.gas) for (const l of g.levels) for (const [mod, val] of [["fixa", l.fixedCommission], ["indexada", l.indexedCommission]] as const) {
    if (val == null) continue;
    out.push({
      rule_key: `nufri_gas_${g.tariff.replace(/\W/g, "").toLowerCase()}_${l.id.toLowerCase()}_${mod === "fixa" ? "fix" : "idx"}`.slice(0, 60), name: `Nufri Gas ${g.tariff} · ${l.label} · ${mod} (${val} €/MWh)`, layer: "proveidor", retailer, product: l.label, service: "gas",
      kind: "per_mwh", value: String(val), conditions: { tariff: g.tariff, modality: mod, scheme: "nufri", source: src }, valid_from: from,
      notes: `Annex ${src}: comissió comercial ${val} €/MWh (${g.tariff}, modalitat ${mod}).`,
    });
  }
  return out;
}
