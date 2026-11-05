/**
 * LECTOR LOCAL DE LA «TARIFA OPEN» D'ENDESA (3.0TD i 6.1TD) — sense IA, a partir del text del PDF.
 *
 * Extreu del document: peatge, vigència comercial, trams de potència, preus Plana / Día / Laboral / Fin de Semana /
 * Noche / Horas No Open (amb descomptes inclosos), preu base sense descompte, terme de potència i els horaris
 * descrits per a cada modalitat. Després genera les sis xifres P1–P6 de cada modalitat:
 *   · Plana: el mateix preu a tots els períodes.
 *   · Día i Noche: PREU ESTIMAT PER PONDERACIÓ HORÀRIA (hores Open / No Open reals de cada període).
 *   · Laboral i Fin de Semana: regla de conversió per períodes aprovada per Direcció.
 * Si la regla interna no coincideix amb l'horari del document, es mostra la discrepància i l'oferta queda en
 * esborrany fins que Direcció l'aprova (biblioteca de regles).
 * El tram de preus es tria SEMPRE per la potència contractada P6 (criteri de Direcció).
 */
import { slug } from "./catalog";
import {
  DEFAULT_CALENDAR, DIRECCIO_RULES, MODALITIES, MODALITY_LABEL, compareRules, countHours, describeRule, weightedPrices,
  type CalendarConfig, type Discrepancy, type Modality, type OpenRule, type WeightedPrice, type Window,
} from "./open-calendar";
import { emptySheet, type OfferVersion } from "./types";

export interface OpenBracket { label: string; minKw: number | null; maxKw: number | null; prices: Record<Modality, number>; noOpen: number; base: number | null }
export interface OpenDocument {
  supplier: "Endesa";
  product: "Open";
  tariff: string; // 3.0TD / 6.1TD
  docVersion: string | null; // p. ex. «07 · V1» (del nom del fitxer)
  validFrom: string | null;
  validTo: string | null;
  maxKw: number | null;
  brackets: OpenBracket[];
  power: (number | null)[]; // €/kW·any amb descomptes
  schedules: Record<Modality, { text: string; rule: OpenRule | null }>;
  impliedDiscounts: Record<Modality | "no_open", number | null>; // % sobre el preu base (primer tram)
  generalDiscountPct: number | null;
  page: number;
  warnings: string[];
}

const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const iso = (d: string) => { const [dd, mm, yy] = d.split("/"); return `${yy}-${mm}-${dd}`; };

/** És un document de la Tarifa Open d'Endesa? */
export function isEndesaOpen(text: string): boolean {
  return /Tarifa\s+Open\s+\d\.\dTD/i.test(text) && /Modalidad\s+de\s+Horas\s+Open/i.test(text);
}

/** Interpreta la descripció d'horari d'una modalitat (frases d'Endesa). Retorna null si no s'entén. */
export function parseSchedule(desc: string): OpenRule | null {
  const d = desc.replace(/\s+/g, " ").trim();
  if (/Los 24h del día los 365 días/i.test(d)) return { mode: "plana" };
  const hasWeekend = /s[áa]bados,?\s+domingos/i.test(d);
  const windows: Window[] = [];
  if (/^Las 24h del día de s[áa]bados/i.test(d)) return { mode: "horari", windows: [{ days: "festiu", from: 0, to: 24 }] };
  for (const part of d.split(/,\s*y\s+/i)) {
    const m = part.match(/(\d{1,2})h\s+a\s+(\d{1,2})h\s*(.*)$/i);
    if (!m) return null;
    const from = Number(m[1]), to = Number(m[2]), rest = m[3].toLowerCase();
    if (!(from >= 0 && to <= 24 && from < to)) return null;
    const days = /todos los d[ií]as/.test(rest) ? "tots"
      : /s[áa]bados/.test(rest) ? "festiu"
      : /lunes a viernes/.test(rest) ? (/excepto/.test(rest) || hasWeekend ? "laborable" : "dl_dv")
      : null;
    if (!days) return null;
    windows.push({ days, from, to });
  }
  return windows.length ? { mode: "horari", windows } : null;
}

function bracketOf(label: string): { minKw: number | null; maxKw: number | null } {
  const l = label.replace(/\s+/g, "").replace(",", ".");
  let m = l.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)kW$/i);
  if (m) return { minKw: Number(m[1]), maxKw: Number(m[2]) };
  m = l.match(/^<(\d+(?:\.\d+)?)kW$/i);
  if (m) return { minKw: null, maxKw: Number(m[1]) };
  m = l.match(/^>(\d+(?:\.\d+)?)kW$/i);
  if (m) return { minKw: Number(m[1]), maxKw: null };
  return { minKw: null, maxKw: null };
}

/** Llegeix el document a partir del text de les pàgines (capa de text del PDF). */
export function parseEndesaOpen(pages: string[], fileName = ""): OpenDocument {
  const warnings: string[] = [];
  const pageIdx = Math.max(0, pages.findIndex((p) => isEndesaOpen(p)));
  const text = pages[pageIdx] ?? pages.join("\n");
  const flat = text.replace(/\s+/g, " ");
  const tariff = (flat.match(/Tarifa\s+Open\s+(\d\.\d)TD/i)?.[1] ?? "") + "TD";
  const vm = flat.match(/desde el (\d{2}\/\d{2}\/\d{4}) hasta el (\d{2}\/\d{2}\/\d{4})/i);
  const maxKw = Number(flat.match(/TD hasta (\d+)\s*kW/i)?.[1] ?? NaN);
  const vf = fileName.match(/OPEN[_-](\d+)[_-]V(\d+)/i);

  // Trams: «15-30 kW 0,196239 0,183659 0,171080 0,120762 0,095603 0,233977»
  const brackets: OpenBracket[] = [];
  const rowRe = /^\s*([<>]?\s*\d+(?:-\d+)?\s*kW)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s+(\d+,\d+)\s*$/gim;
  for (const m of text.matchAll(rowRe)) {
    const v = m.slice(2, 8).map(num);
    const [plana, dia, laboral, cap, nit, noOpen] = v;
    brackets.push({ label: m[1].replace(/\s+/g, " ").replace(/(\d)kW/, "$1 kW"), ...bracketOf(m[1]), prices: { plana, dia, laboral, cap_de_setmana: cap, nit }, noOpen, base: null });
  }
  if (!brackets.length) warnings.push("No s'ha trobat la taula de preus per trams de potència");
  for (const b of brackets) {
    if (!(b.noOpen > Math.max(...Object.values(b.prices)))) warnings.push(`Tram ${b.label}: el preu No Open no és el més alt; revisa l'ordre de les columnes`);
    if (!(b.prices.plana >= b.prices.dia && b.prices.dia >= b.prices.laboral)) warnings.push(`Tram ${b.label}: ordre de preus inesperat (Plana ≥ Día ≥ Laboral)`);
  }
  // Preu base sense descompte per tram: «15 kW < Pc ≤ 30 kW 0,251588», «Pc ≤ 30 kW 0,225162», «Pc > 100 kW 0,251088»
  const baseRe = /(?:(\d+)\s*kW\s*<\s*)?Pc\s*([≤<>]=?)\s*(\d+)\s*kW\s+(\d+,\d+)/gi;
  const bases: { lo: number | null; hi: number | null; v: number }[] = [];
  for (const m of flat.matchAll(baseRe)) {
    const lo = m[1] ? Number(m[1]) : m[2].startsWith(">") ? Number(m[3]) : null;
    const hi = m[2].startsWith(">") ? null : Number(m[3]);
    bases.push({ lo, hi, v: num(m[4]) });
  }
  for (const b of brackets) b.base = bases.find((x) => (x.hi ?? Infinity) === (b.maxKw ?? Infinity) && (b.minKw == null || x.lo == null || x.lo === b.minKw))?.v ?? null;
  // El document diu el tram inferior obert («15-30 kW») però la taula base el defineix com «15 kW < Pc ≤ 30 kW».
  // Potència: «P1: 21,876927 P2: … €/kW y año»
  const pm = flat.match(/P1:\s*(\d+,\d+)\s*P2:\s*(\d+,\d+)\s*P3:\s*(\d+,\d+)\s*P4:\s*(\d+,\d+)\s*P5:\s*(\d+,\d+)\s*P6:\s*(\d+,\d+)\s*€\/kW y año/i);
  const power = pm ? pm.slice(1, 7).map(num) : Array(6).fill(null);
  if (!pm) warnings.push("No s'ha trobat el terme de potència en €/kW i any");

  // Horaris de cada modalitat: entre «Elige tu Modalidad de Horas Open» i la primera fila de preus
  const start = flat.search(/Elige tu Modalidad de Horas Open/i);
  const firstRow = brackets.length ? flat.indexOf(brackets[0].label.replace(" kW", "")) : -1;
  const section = start >= 0 ? flat.slice(start, firstRow > start ? firstRow : start + 1200) : "";
  // Sensible a majúscules: cada descripció comença per «De …», «Las 24h…» o «Los 24h…» (dins d'una frase, «de 18h a…» va en minúscula)
  const descs = section.match(/(Los 24h del día los 365 días al año|Las 24h del día de .+?nacionales\.?|De \d{1,2}h a \d{1,2}h .+?(?=\s(?:De \d{1,2}h a|Las 24h|Los 24h|<|>|\d+-\d+\s*kW)|$))/g) ?? [];
  const schedules = {} as OpenDocument["schedules"];
  MODALITIES.forEach((mod, i) => {
    const t = (descs[i] ?? "").trim();
    schedules[mod] = { text: t, rule: t ? parseSchedule(t) : null };
    if (!t) warnings.push(`No s'ha trobat l'horari de la modalitat ${MODALITY_LABEL[mod]}`);
    else if (!schedules[mod].rule) warnings.push(`No s'ha pogut interpretar l'horari de ${MODALITY_LABEL[mod]}: «${t}»`);
  });

  const b0 = brackets[0];
  const pct = (p: number | undefined) => (b0?.base && p != null ? Math.round((1 - p / b0.base) * 10_000) / 100 : null);
  const impliedDiscounts = { plana: pct(b0?.prices.plana), dia: pct(b0?.prices.dia), laboral: pct(b0?.prices.laboral), cap_de_setmana: pct(b0?.prices.cap_de_setmana), nit: pct(b0?.prices.nit), no_open: pct(b0?.noOpen) };
  const gm = flat.match(/Y además:\s*(\d+)\s*%/i) ?? flat.match(/(\d+)\s*%\s*Durante 1 año las 24h/i) ?? flat.match(/Durante 1 año las 24h del día los 365 días\s*Y además:\s*(\d+)\s*%/i);
  if (!/TD$/.test(tariff) || tariff === "TD") warnings.push("No s'ha identificat el peatge d'accés");
  if (!vm) warnings.push("No s'ha trobat la vigència comercial de l'oferta");
  return {
    supplier: "Endesa", product: "Open", tariff, docVersion: vf ? `${vf[1]} · V${vf[2]}` : null,
    validFrom: vm ? iso(vm[1]) : null, validTo: vm ? iso(vm[2]) : null, maxKw: Number.isFinite(maxKw) ? maxKw : null,
    brackets, power, schedules, impliedDiscounts, generalDiscountPct: gm ? Number(gm[1]) : null, page: pageIdx + 1, warnings,
  };
}

/* ======================================================================= tram per potència P6 */

/** Tram de preus segons la potència contractada P6 (límit inferior exclòs, superior inclòs). */
export function bracketForP6(doc: Pick<OpenDocument, "brackets">, p6Kw: number | null | undefined): OpenBracket | null {
  if (p6Kw == null || !Number.isFinite(p6Kw)) return null;
  return doc.brackets.find((b) => (b.minKw == null || p6Kw > b.minKw) && (b.maxKw == null || p6Kw <= b.maxKw)) ?? null;
}

/* ======================================================================= conversió a P1–P6 */

export type RuleSource = "direccio" | "document" | "biblioteca" | "xat";
export interface ModalityRule { rule: OpenRule; source: RuleSource; approved: boolean; note?: string | null }
export interface OpenConversion {
  modality: Modality;
  bracket: OpenBracket;
  openPrice: number;
  noOpenPrice: number;
  rule: ModalityRule;
  documentRule: OpenRule | null;
  periods: WeightedPrice[];
  discrepancies: Discrepancy[];
  /** Cal la validació de Direcció abans de fer servir la conversió com a condició comercial. */
  needsApproval: boolean;
  reference: { from: string; to: string };
  totalHours: number;
  dstDays: { date: string; hours: number }[];
  holidays: string[];
}

/** Regla efectiva: la de la biblioteca (aprovada) > Direcció. La del document només s'usa si l'escull Direcció. */
export function effectiveRules(library: Partial<Record<Modality, ModalityRule>> = {}): Record<Modality, ModalityRule> {
  return Object.fromEntries(MODALITIES.map((m) => [m, library[m] ?? { rule: DIRECCIO_RULES[m], source: "direccio" as const, approved: m === "plana" }])) as Record<Modality, ModalityRule>;
}

export function convertModality(doc: OpenDocument, bracket: OpenBracket, modality: Modality, rule: ModalityRule, ref: { from: string; to: string }, cfg: CalendarConfig = DEFAULT_CALENDAR): OpenConversion {
  const openPrice = bracket.prices[modality];
  const noOpenPrice = modality === "plana" ? openPrice : bracket.noOpen;
  const prices = { open: openPrice, noOpen: noOpenPrice };
  const counts = countHours(doc.tariff, rule.rule, ref, cfg);
  const periods = weightedPrices(counts, prices, rule.rule);
  const documentRule = doc.schedules[modality]?.rule ?? null;
  const discrepancies = documentRule && modality !== "plana" ? compareRules(doc.tariff, rule.rule, documentRule, ref, prices, cfg) : [];
  return {
    modality, bracket, openPrice, noOpenPrice, rule, documentRule, periods, discrepancies,
    // Cal validació de Direcció si la regla interna no coincideix amb l'horari del document (o si no s'ha pogut llegir)
    needsApproval: !rule.approved && modality !== "plana" && (discrepancies.length > 0 || !documentRule),
    reference: ref, totalHours: counts.totalHours, dstDays: counts.dstDays, holidays: counts.holidays,
  };
}

/** Metadades Open que viatgen amb l'oferta al catàleg (per al comparador i per explicar el càlcul). */
export interface OpenMeta {
  supplier: string; product: string; modality: Modality; docVersion: string | null;
  openPrice: number; noOpenPrice: number;
  bracket: { label: string; minKw: number | null; maxKw: number | null };
  rule: OpenRule; ruleSource: RuleSource; approved: boolean;
  reference: { from: string; to: string };
  periods: { period: number; open: number; noOpen: number; total: number; price: number }[];
  estimated: true;
  /** Fase 12 (altres comercialitzadores): nom del producte per als textos i tipus de P1–P6 (ponderació o correspondència comercial). */
  label?: string;
  kind?: "ponderada" | "comercial";
}

export const ESTIMATE_LABEL = "PREU ESTIMAT PER PONDERACIÓ HORÀRIA";
export const ESTIMATE_NOTE = "Aquest preu és una estimació calculada segons les hores Open i No Open de cada període. El preu efectiu dependrà de la distribució horària real del consum del client.";

/** Una oferta del catàleg per modalitat i tram (els trams amb els mateixos preus s'agrupen). */
export function openToOffers(doc: OpenDocument, rules: Record<Modality, ModalityRule>, ref: { from: string; to: string }, opts: { fileName: string; today?: string; cfg?: CalendarConfig } ): { offer: OfferVersion; conversion: OpenConversion }[] {
  const out: { offer: OfferVersion; conversion: OpenConversion }[] = [];
  // agrupa trams contigus amb preus idèntics
  const groups: OpenBracket[] = [];
  for (const b of doc.brackets) {
    const last = groups[groups.length - 1];
    if (last && JSON.stringify(last.prices) === JSON.stringify(b.prices) && last.noOpen === b.noOpen) groups[groups.length - 1] = { ...last, maxKw: b.maxKw, label: `${last.label} + ${b.label}` };
    else groups.push({ ...b });
  }
  for (const b of groups) {
    const range = b.minKw == null ? `P6 ≤ ${b.maxKw} kW` : b.maxKw == null ? `P6 > ${b.minKw} kW` : `P6 ${b.minKw}–${b.maxKw} kW`;
    for (const m of MODALITIES) {
      const conv = convertModality(doc, b, m, rules[m], ref, opts.cfg);
      const meta: OpenMeta = {
        supplier: doc.supplier, product: doc.product, modality: m, docVersion: doc.docVersion, openPrice: conv.openPrice, noOpenPrice: conv.noOpenPrice,
        bracket: { label: range, minKw: b.minKw, maxKw: b.maxKw }, rule: conv.rule.rule, ruleSource: conv.rule.source, approved: !conv.needsApproval,
        reference: ref, periods: conv.periods.map((p) => ({ period: p.period, open: p.open, noOpen: p.noOpen, total: p.total, price: p.price })), estimated: true,
      };
      const offer: OfferVersion = {
        ...emptySheet(),
        id: crypto.randomUUID(),
        supplierId: `sup:${slug(doc.supplier)}`,
        supplierName: doc.supplier,
        productId: "",
        productName: `Open ${MODALITY_LABEL[m]} · ${range}`,
        version: 1,
        energyType: "luz",
        accessTariff: doc.tariff,
        segments: ["pyme", "industrial"],
        contractType: "periodes",
        energy: conv.periods.map((p) => p.price),
        energy24h: null,
        power: doc.power,
        powerUnit: "eur_kw_any",
        taxTreatment: "sense_impostos",
        // Preus amb els descomptes ja inclosos: no s'hi afegeix cap descompte (no es duplica) ni cap SAS sense regla validada
        sas: { mode: "inclos", eurKwh: null },
        discounts: [],
        fees: [],
        permanenceMonths: 12,
        penalty: doc.tariff === "6.1TD" ? "Penalització per resolució anticipada segons OMIP + 20 €/MWh sobre l'energia pendent (vegeu el document)." : "20 % de l'energia pendent del primer any, al preu sense descomptes (vegeu el document).",
        durationMonths: 12,
        priceGuaranteeMonths: null,
        eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: doc.maxKw, territories: ["peninsula"], notes: `Tram de preus per potència contractada ${range}.` },
        validFrom: doc.validFrom,
        validTo: doc.validTo,
        source: `Lector Endesa Open · ${opts.fileName.slice(0, 160)} · pàg. ${doc.page}`.slice(0, 300),
        publishedAt: opts.today ?? new Date().toISOString().slice(0, 10),
        status: "esborrany",
        conditions: [
          m === "plana" ? `Preu Plana ${conv.openPrice} €/kWh a tots els períodes.` : `${ESTIMATE_LABEL}. ${ESTIMATE_NOTE}`,
          `Preu contractual Open: ${conv.openPrice} €/kWh · No Open: ${conv.noOpenPrice} €/kWh (descomptes inclosos).`,
          `Regla: ${describeRule(conv.rule.rule)} (${conv.rule.source === "biblioteca" ? "biblioteca de regles" : conv.rule.source === "document" ? "horari del document" : conv.rule.source === "xat" ? "correcció del xat" : "regla de Direcció"}${conv.needsApproval ? ", pendent de validar per Direcció" : ""}).`,
          `Període de referència: ${ref.from} – ${ref.to} (${conv.totalHours} h).`,
        ].join("\n"),
        origin: "excel",
        open: meta,
      };
      out.push({ offer, conversion: conv });
    }
  }
  return out;
}
