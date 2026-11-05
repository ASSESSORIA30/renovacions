/**
 * Fase 14.1 · LECTOR LOCAL DE DOCUMENTS DE TARIFES CONEGUTS (sense IA, sense límit de tarifes).
 *
 * Quan es carrega al catàleg un Excel d'una comercialitzadora amb format conegut per blocs (Naturgy «Productos
 * Captación PYMES»), es llegeix SENCER amb el lector determinista de plantilles: no cal cap plantilla desada a
 * Supabase ni cap clau d'IA, i no hi ha l'error «massa tarifes». Si Direcció ja té una plantilla verificada per a
 * aquest format, es fa servir aquella definició (amb les seves correccions).
 *  - Cada família de productes es processa per separat i se'n dona el recompte (progrés per famílies).
 *  - Les famílies «Variable» queden PENDENTS (no s'activen) fins que algú confirmi si són fixes o indexades.
 *  - Les cel·les #N/A o buides no són zeros: la tarifa queda incompleta (esborrany).
 *  - Unitats: potència → €/kW·dia, energia → €/kWh, terme fix del gas → €/client·dia (conversió determinista).
 *  - Els serveis (SVG, SVE, SVS, Batería Virtual) i el full «Seguimiento info» no són tarifes: es mostren a part.
 */
import { detectSupplier } from "./reading-knowledge";
import { toReviewItems, type AiTariffItem } from "./tariff-ai";
import { applyTemplate, productsToOffers, proposeTemplate, type Classification, type TemplateDef, type WorkbookGrid } from "./xlsx-template";
import type { OfferVersion } from "./types";

export interface Family { id: string; title: string; energyType: "luz" | "gas"; classification: Classification; excluded: boolean; products: number; complete: number; incomplete: number; pending: boolean }
export interface KnownRead {
  supplier: string; template: string; source: "plantilla_verificada" | "lector_integrat"; sheet: string | null; validity: string | null;
  families: Family[]; services: { name: string; price: number | null; unit: string | null; cell: string }[]; metadataSheets: string[];
  items: AiTariffItem[]; warnings: string[]; def: TemplateDef;
}

/** Nom de la plantilla a partir del document (p. ex. «NC-Productos-Captacion-PYMES-…» → «Captación PYMES»). */
export function templateLabel(fileName: string): string {
  const f = fileName.replace(/[_-]+/g, " ");
  if (/captaci[oó]n\s+pymes/i.test(f)) return "Captación PYMES";
  if (/captaci[oó]n\s+hogar|residencial/i.test(f)) return "Captación Hogar";
  return "Full de preus";
}

export function readKnownWorkbook(wb: WorkbookGrid, opts: { existing: OfferVersion[]; def?: TemplateDef | null; classification?: Record<string, Classification>; today?: string }): KnownRead | null {
  const det = detectSupplier(wb);
  if (!det || det.pack.layout !== "blocs") return null;
  const label = templateLabel(wb.fileName);
  const base = opts.def && opts.def.layout !== "taula" ? opts.def : proposeTemplate(wb, { supplier: det.supplier, name: label }).def;
  const def: TemplateDef = { ...base, blocks: base.blocks.map((b) => (opts.classification?.[b.id] ? { ...b, classification: opts.classification[b.id], classificationNote: `Confirmat a la revisió: ${opts.classification[b.id]}` } : b)) };
  const read = applyTemplate(wb, def);
  const offers = productsToOffers(read, def, { templateId: null, version: 1, fileName: wb.fileName, today: opts.today });
  const items = toReviewItems(offers.map((o) => ({ offer: o.offer, warnings: o.warnings, page: o.product.row, conversions: (o.offer.units?.formulas ?? []) })), opts.existing);
  const families: Family[] = def.blocks.filter((b) => b.kind === "productes").map((b) => {
    const mine = items.filter((_, i) => offers[i].product.blockId === b.id);
    return { id: b.id, title: b.title, energyType: b.energyType, classification: b.classification, excluded: b.excluded, products: mine.length, complete: mine.filter((x) => x.status !== "incompleta").length, incomplete: mine.filter((x) => x.status === "incompleta").length, pending: b.classification === "pendent" };
  });
  return {
    supplier: det.supplier, template: `${det.supplier} · ${label}`, source: opts.def ? "plantilla_verificada" : "lector_integrat", sheet: read.sheet, validity: read.validity.label,
    families, services: read.services.map((s) => ({ name: s.name, price: s.price.v, unit: s.unit, cell: s.price.cell })), metadataSheets: wb.sheets.map((s) => s.name).filter((n) => n !== read.sheet),
    items, warnings: read.issues.filter((i) => i.level === "critica").map((i) => i.text), def,
  };
}
