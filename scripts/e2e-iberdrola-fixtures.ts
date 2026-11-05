/**
 * Genera documents de prova derivats de l'Excel real d'Iberdrola (només preus de tarifes, cap dada personal):
 *  · IBERDROLA_HASTA_30.11.xlsx  → mateix format, alguns preus canviats (lectura del «mes següent»)
 *  · IBERDROLA_FORMAT_NOU.xlsx   → capçaleres canviades (la plantilla NO s'ha d'aplicar)
 *  · IBERDROLA_SENSE_ENERGIA.xlsx → la pestanya «Energía» s'ha reanomenat (cal triar-la a mà)
 * Ús: npx tsx scripts/e2e-iberdrola-fixtures.ts
 */
import * as XLSX from "xlsx";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { applyTemplate, gridFromXlsx, productsToOffers } from "../src/comparator/xlsx-template";
import { proposeTable } from "../src/comparator/tariff-table";

const SRC = "tests/fixtures/iberdrola/IBERDROLA_HASTA_15.11.xlsx";
const OUT = ["tests/fixtures/iberdrola"];
const load = () => XLSX.read(readFileSync(SRC), { type: "buffer", cellStyles: true });
const save = (wb: XLSX.WorkBook, name: string) => { const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true, compression: true }); for (const d of OUT) { mkdirSync(d, { recursive: true }); writeFileSync(`${d}/${name}`, buf); } };
const set = (ws: XLSX.WorkSheet, a: string, v: number | string) => { ws[a] = typeof v === "number" ? { t: "n", v } : { t: "s", v }; };

{ // mes següent: preus nous
  const wb = load();
  const ws = wb.Sheets["Energía"];
  set(ws, "J68", 0.185); set(ws, "I14", 0.229412); set(ws, "I73", 0.329); set(ws, "I80", 0.025);
  set(wb.Sheets["Portada"], "E7", "16 de noviembre de 2026");
  save(wb, "IBERDROLA_HASTA_30.11.xlsx");
}
{ // format nou: la columna de descomptes canvia de nom i la de producte també
  const wb = load();
  const ws = wb.Sheets["Energía"];
  set(ws, "O2", "CONDICIONES"); set(ws, "B2", "TARIFA"); set(ws, "I5", "Base");
  save(wb, "IBERDROLA_FORMAT_NOU.xlsx");
}
{ // sense la pestanya «Energía»
  const wb = load();
  const i = wb.SheetNames.indexOf("Energía");
  wb.SheetNames[i] = "Precios";
  wb.Sheets["Precios"] = wb.Sheets["Energía"];
  delete wb.Sheets["Energía"];
  save(wb, "IBERDROLA_SENSE_ENERGIA.xlsx");
}
console.log("Documents de prova d'Iberdrola generats");

// Fitxers de les proves Playwright: definició proposada, exemple desat (graella), lectura de referència i catàleg
{
  const wbg = gridFromXlsx(XLSX as never, readFileSync(SRC), "IBERDROLA_HASTA_15.11.xlsx");
  const def = proposeTable(wbg, { supplier: "Iberdrola", name: "Hoja de Precios", knowledge: "iberdrola-energia" }).def!;
  mkdirSync("e2e/iberdrola", { recursive: true });
  writeFileSync("e2e/iberdrola/def.json", JSON.stringify(def));
  writeFileSync("e2e/iberdrola/grid.json", JSON.stringify(wbg));
  const read = applyTemplate(wbg, def);
  writeFileSync("e2e/iberdrola/read.json", JSON.stringify({ products: read.products, validity: read.validity }));
  const offers = productsToOffers(read, def, { templateId: "tpl-ib", version: 2, fileName: "IBERDROLA_HASTA_15.11.xlsx", today: "2026-11-03" });
  const pick = (n: string) => ({ ...offers.find((o) => o.offer.productName === n)!.offer, status: "activa" as const });
  writeFileSync("e2e/iberdrola/catalog.json", JSON.stringify({ versions: [pick("3.0TD Impulsa Negocios"), pick("3.0TD Empresa Plus"), pick("3.0TD Plan OMIE 1")], crm: [], migrated: true }));
  console.log("Fitxers e2e d'Iberdrola generats:", read.products.length, "tarifes");
}
