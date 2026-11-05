/**
 * CONEIXEMENT VALIDAT PER COMERCIALITZADORA (dades, no codi de lectura).
 *
 * No hi ha un lector per empresa: hi ha un únic lector (`tariff-table.ts` per a taules, `xlsx-template.ts` per a
 * blocs) i, per a cada comercialitzadora, un paquet de coneixement amb la pestanya on són els preus i les regles que
 * Direcció ha explicat. Aquestes regles tenen `source: "direccio"` i estan aprovades. Les regles que el CRM proposa
 * per analogia queden SENSE APROVAR (la tarifa surt «a revisar» fins que algú les confirma).
 *
 * Les correccions que es fan després (xat, exemples) es desen a la plantilla (versió nova) i a la biblioteca de
 * regles de Supabase; no modifiquen aquest fitxer.
 */
import type { ReadingRule } from "./tariff-table";
import type { WorkbookGrid } from "./xlsx-template";

export interface KnowledgePack {
  id: string;
  supplier: string;
  label: string;
  layout: "taula" | "blocs";
  sheetName: string | null;
  complementarySheets: string[];
  ignoredSheets: string[];
  rules: ReadingRule[];
  notes: string[];
}

const nrm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const D = (id: string, title: string, match: ReadingRule["match"], set: ReadingRule["set"], explanation: string, extra: Partial<ReadingRule> = {}): ReadingRule => ({
  id: `iberdrola:${id}`, title, scope: "plantilla", match, set, explanation, source: "direccio", approved: true, approvedBy: "Direcció", approvedAt: "2026-11-03", ...extra,
  ...(extra.source && extra.source !== "direccio" ? { approvedBy: extra.approved === false ? null : "Capçalera del document" } : {}),
});
const SIX = ["3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD"];

/** IBERDROLA · Excel «Hoja de Precios» · pestanya «Energía» (regles explicades per Direcció). */
export const IBERDROLA: KnowledgePack = {
  id: "iberdrola-energia",
  supplier: "Iberdrola",
  label: "Iberdrola · Hoja de Precios (pestanya «Energía»)",
  layout: "taula",
  sheetName: "Energía",
  complementarySheets: ["PYS"],
  ignoredSheets: ["Portada", "old"],
  notes: [
    "La pestanya «Energía» és la font obligatòria. «Portada» no s'utilitza per als preus; «PYS» només com a documentació de serveis i descomptes; «old» no és el catàleg.",
    "Els preus de potència de C–H són €/kW any; els d'energia I–N són €/kWh, excepte en els productes indexats, on el valor és el marge.",
    "Els preus de l'Excel són SENSE descompte: el descompte de la columna O s'aplica després (preus originals conservats).",
  ],
  rules: [
    D("classificacio-fixa", "Preus €/kWh del full: tarifa FIXA", {}, { classification: "fixa" }, "Els preus de les columnes I–N són €/kWh fixos del full de preus. Només els productes OMIE i «Indexada» són indexats.", { scope: "general", source: "document" }),
    D("potencia-any", "Potència en €/kW any", { energyType: "luz" }, { powerUnit: "eur_kw_any" }, "La capçalera de C–H és «TERMINO DE POTENCIA (€/kW año)».", { source: "document" }),
    // 2.0TD
    D("20td-1", "2.0TD · un preu: P1 = P2 = P3", { tariffs: ["2.0TD"], priceCount: 1 }, { mapping: ["A", "A", "A"] }, "És una tarifa 24 hores: P1 = P2 = P3 = preu final amb descomptes."),
    D("20td-2", "2.0TD · dos preus: P1 = P2 = primer, P3 = segon", { tariffs: ["2.0TD"], priceCount: 2 }, { mapping: ["A", "A", "B"] }, "Correspondència comercial: P1 = primer preu, P2 = primer preu, P3 = segon preu."),
    D("20td-3", "2.0TD · tres preus: P1, P2, P3", { tariffs: ["2.0TD"], priceCount: 3 }, { mapping: ["A", "B", "C"] }, "P1 = primer preu, P2 = segon, P3 = tercer."),
    D("20td-hores-promocionades", "2.0TD amb hores promocionades: confirmar l'horari", { tariffs: ["2.0TD"], priceCount: 2, product: ["ahorro inteligente 8 horas", "plan solar", "vehiculo electrico", "estancias verdes"] },
      { review: "Producte amb hores promocionades (columnes «No Prom.» / «Prom.»): s'aplica la regla de dos preus de Direcció (P1 = P2 = primer, P3 = segon), però cal confirmar l'horari real; no es confon amb una tarifa de dos preus convencional." },
      "Quan hi ha hores promocionades especials, cal conservar el calendari real.", { source: "document", approved: false }),
    // 3.0TD i 6.xTD
    D("6p-1", "3.0TD / 6.xTD · preu únic: P1 = … = P6", { tariffs: SIX, priceCount: 1 }, { mapping: ["A", "A", "A", "A", "A", "A"] }, "Producte fix de preu únic: P1 = P2 = P3 = P4 = P5 = P6, amb els descomptes corresponents."),
    D("impulsa-negocios", "Impulsa Negocios: P1–P5 promocionat, P6 no promocionat", { tariffs: ["3.0TD"], priceCount: 2, product: "impulsa negocios" },
      { mapping: ["B", "B", "B", "B", "B", "A"], schedule: { promoted: "B", notPromoted: "A", windows: [{ days: "dl_dv", from: 8, to: 17 }], source: "NUEVOS PLANES 3.0.pdf: dilluns a divendres de 08:00 a 16:59" } },
      "Correspondència comercial confirmada per Direcció. Fila 68: 0,387 no promocionat i 0,188 promocionat, 20 % s/Te → 0,150400 (P1–P5) i 0,309600 (P6). El +5 % condicionat no s'inclou."),
    D("impulsa-nocturna", "Impulsa Nocturna: P1–P5 no promocionat, P6 promocionat", { tariffs: ["3.0TD"], priceCount: 2, product: "impulsa nocturna" },
      { mapping: ["A", "A", "A", "A", "A", "B"], schedule: { promoted: "B", notPromoted: "A", windows: [{ days: "tots", from: 22, to: 24 }, { days: "tots", from: 0, to: 8 }], source: "NUEVOS PLANES 3.0.pdf: de 22:00 a 07:59 (dies segons el PDF)" } },
      "Correspondència comercial confirmada per Direcció. Fila 69: 0,387 i 0,170, 20 % s/Te → 0,309600 (P1–P5) i 0,136000 (P6)."),
    D("impulsa-solar", "Impulsa Solar: estimació ponderada 19:00–08:59", { tariffs: ["3.0TD"], priceCount: 2, product: "impulsa solar" },
      { weighted: true, schedule: { promoted: "B", notPromoted: "A", windows: [{ days: "tots", from: 19, to: 24 }, { days: "tots", from: 0, to: 9 }], source: "NUEVOS PLANES 3.0.pdf: de 19:00 a 08:59 (dies segons el PDF)" } },
      "Es conserva el calendari contractual. Sense corba horària, els P1–P6 són una estimació ponderada per hores promocionades i no promocionades de cada període."),
    D("impulsa-ve", "Impulsa Vehículo Eléctrico: estimació ponderada 01:00–06:59", { tariffs: ["3.0TD"], priceCount: 2, product: "impulsa vehiculo electrico" },
      { weighted: true, schedule: { promoted: "B", notPromoted: "A", windows: [{ days: "tots", from: 1, to: 7 }], source: "NUEVOS PLANES 3.0.pdf: de 01:00 a 06:59 (dies segons el PDF)" } },
      "Mateix sistema de lectura i ponderació que Impulsa Solar."),
    // indexades
    D("plan-omie", "Plan OMIE: INDEXADA, el valor és el marge", { product: "plan omie" }, { classification: "indexada", valueIsMargin: true },
      "Tots els Plan OMIE són indexats. El valor és el marge d'Iberdrola per energia (0,034 €/kWh = 34 €/MWh), no un preu final."),
    D("gas-indexada", "Gas «Indexada»: INDEXADA, valor com a marge (per analogia)", { energyType: "gas", product: "indexada" }, { classification: "indexada", valueIsMargin: true },
      "El nom diu «Indexada». Per analogia amb el Plan OMIE, el valor 0,015 es tracta com a marge. Cal confirmar-ho.", { source: "document", approved: false }),
    D("gas-terme-fix", "Gas: unitat del terme fix per confirmar", { energyType: "gas" },
      { review: "Gas: la columna C té la capçalera de potència elèctrica (€/kW any). La unitat del terme fix de gas no consta al full: cal confirmar-la abans de comparar." },
      "El full no indica la unitat del terme fix de gas.", { source: "document", approved: true }),
  ],
};

/** NATURGY · Captación PYMES (plantilla de blocs de la Fase 11; el coneixement s'hi desa com a correccions). */
export const NATURGY: KnowledgePack = {
  id: "naturgy-pymes", supplier: "Naturgy", label: "Naturgy · Productos Captación PYMES", layout: "blocs", sheetName: null, complementarySheets: [], ignoredSheets: [], rules: [],
  notes: ["«Variable» no vol dir indexat: es classifica PENDENT fins que es confirma.", "Les variants M, ONE i SUPRA es mantenen separades."],
};

export const KNOWLEDGE: KnowledgePack[] = [IBERDROLA, NATURGY];
export const knowledgeFor = (id: string | null | undefined) => (id ? KNOWLEDGE.find((k) => k.id === id) ?? null : null);

/** Detecta la comercialitzadora i el paquet de coneixement d'un Excel (nom del fitxer, pestanyes i textos). */
export function detectSupplier(wb: WorkbookGrid): { supplier: string; pack: KnowledgePack; evidence: string } | null {
  const names = wb.sheets.map((s) => s.name);
  const file = nrm(wb.fileName);
  const textHas = (re: RegExp) => wb.sheets.some((s) => s.cells.some((row) => row.some((c) => c && c.t === "s" && re.test(nrm(c.v)))));
  if (/iberdrola/.test(file) || (names.includes("Energía") && names.includes("PYS")) || textHas(/\biberdrola\b/)) {
    return { supplier: "Iberdrola", pack: IBERDROLA, evidence: /iberdrola/.test(file) ? "nom del fitxer" : names.includes("Energía") && names.includes("PYS") ? "pestanyes «Energía» i «PYS»" : "text «Iberdrola» al document" };
  }
  if (/naturgy/.test(file) || names.some((n) => /^[A-Z]{3}\d{2}_\d+_[A-Z]+$/.test(n)) || textHas(/\bnaturgy\b/)) return { supplier: "Naturgy", pack: NATURGY, evidence: /naturgy/.test(file) ? "nom del fitxer" : "format de pestanya «MESAA_n_XX»" };
  return null;
}
