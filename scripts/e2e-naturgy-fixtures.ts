/**
 * Genera, a partir de l'Excel REAL de Naturgy (tests/fixtures/naturgy), els fitxers de les proves Playwright:
 * la definició de plantilla proposada, la lectura de referència, un segon Excel equivalent, un Excel amb el format
 * canviat i un catàleg amb una fixa real i una indexada DE PROVA (fórmula inventada, només per a la prova).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as XLSX from "xlsx";
import { applyOps, applyTemplate, gridFromXlsx, productsToOffers, proposeTemplate } from "../src/comparator/xlsx-template";
import { emptyFormula } from "../src/comparator/market";

const SRC = "tests/fixtures/naturgy/NC-Productos-Captacion-PYMES-20261029-VP.xlsx";
const bytes = readFileSync(SRC);
mkdirSync("e2e/naturgy", { recursive: true });
const variant = (edit: (wb: XLSX.WorkBook) => void) => { const wb = XLSX.read(bytes, { type: "buffer", cellDates: true }); edit(wb); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer; };
writeFileSync("e2e/naturgy/NC-Productos-Captacion-PYMES-20261128-VP.xlsx", variant((w) => {
  const ws = w.Sheets.OCT26_3_VP; (ws.L20 as { v: number }).v = 0.2801;
  w.SheetNames[0] = "NOV26_1_VP"; w.Sheets.NOV26_1_VP = ws; delete w.Sheets.OCT26_3_VP;
}));
writeFileSync("e2e/naturgy/NC-format-canviat.xlsx", variant((w) => { (w.Sheets.OCT26_3_VP.L16 as { v: string }).v = "Plan Fijo Luz\nTÉRMINO ENERGÍA (€/MWh)"; }));
const wb = gridFromXlsx(XLSX as never, bytes, "NC-Productos-Captacion-PYMES-20261029-VP.xlsx");
const { def } = proposeTemplate(wb, { supplier: "Naturgy", name: "Captación PYMES Excel" });
const id = (t: string) => def.blocks.find((b) => b.title.startsWith(t))!.id;
const fixedDef = applyOps(def, [{ op: "setClassification", block: id("PLAN VARIABLE LUZ"), value: "fixa" }, { op: "setClassification", block: id("PLAN VARIABLE GAS"), value: "fixa" }]);
writeFileSync("e2e/naturgy/def.json", JSON.stringify(fixedDef));
const read = applyTemplate(wb, fixedDef);
writeFileSync("e2e/naturgy/read.json", JSON.stringify({ products: read.products, validity: read.validity }));
const offers = productsToOffers(read, fixedDef, { templateId: "tpl-naturgy", version: 2, fileName: "naturgy.xlsx", today: "2026-11-03" });
const fixed = { ...offers.find((o) => o.product.code === "E000930TDM")!.offer, id: "naturgy-fijo-30-m", status: "activa", validFrom: "2026-10-01" };
const indexed = { ...fixed, id: "indexada-prova", supplierId: "sup:prova", supplierName: "Comercialitzadora de prova", productName: "Indexada de prova (fórmula inventada)", contractType: "indexat", energy: Array(6).fill(null), template: null,
  formula: { ...emptyFormula(), lossesPct: [16, 15, 14, 13, 12, 10], ssaaEurMWh: 15, marginEurMWh: 12, otherEurMWh: 2, regulatedEurKwh: [0.042, 0.033, 0.019, 0.013, 0.007, 0.004], contractText: "PROVA" } };
writeFileSync("e2e/naturgy/catalog.json", JSON.stringify({ versions: [fixed, indexed], crm: [], migrated: true }));
console.log("fixtures Naturgy generades:", read.products.length, "productes");
