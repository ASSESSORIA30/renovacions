/**
 * Builds demo/seed.json from the two source workbooks using the SAME importer as the app.
 * Usage: tsx scripts/build-seed.ts <crm.xlsx> <diario.xlsx> [today]
 * The seed contains real client data → it is git-ignored and only used for the private demo build.
 */
import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "node:fs";
import { importContracts, pickSheets, type Sheet } from "../src/core/importer";

const [crmPath, diarioPath, todayArg] = process.argv.slice(2);
const load = (p: string): Sheet[] => {
  const wb = XLSX.read(readFileSync(p), { type: "buffer", cellDates: true });
  return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) as unknown[][] }));
};
const crmSheets = load(crmPath);
const diarioSheets = diarioPath ? load(diarioPath) : [];
const { crm } = pickSheets(crmSheets);
const { diario } = pickSheets(diarioSheets);
if (!crm) throw new Error("No CRM sheet found");
const today = todayArg ?? new Date().toISOString().slice(0, 10);
const { contracts, report } = importContracts({ today, crm: { sheet: crm }, diario: { sheets: diario } });
// strip nulls/false to shrink the payload
const slim = contracts.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== false)));
writeFileSync("demo/seed.json", JSON.stringify({ importedAt: new Date().toISOString(), today, report, contracts: slim }));
console.log(JSON.stringify(report, null, 1));
