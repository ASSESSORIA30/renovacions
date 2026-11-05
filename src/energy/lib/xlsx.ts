/**
 * Lectura de .xlsx (navegador y Node) con exceljs. Se usa exceljs porque la
 * exportación del portal SIPS está comprimida con descriptores de datos ZIP que
 * otros lectores en streaming no aceptan.
 */
import ExcelJS from "exceljs";

export type RawCell = string | number | boolean | Date | null;

function cellValue(v: ExcelJS.CellValue): RawCell {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
  }
  return String(v);
}

export async function readWorkbook(data: ArrayBuffer | Uint8Array, preferred = "Page1") {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const ws = wb.getWorksheet(preferred) ?? wb.worksheets[0];
  if (!ws) throw new Error("El fichero no contiene hojas.");
  const width = ws.getRow(1).cellCount;
  const rows: RawCell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const out: RawCell[] = [];
    for (let c = 1; c <= width; c++) out.push(cellValue(row.getCell(c).value));
    rows[n - 1] = out;
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = Array(width).fill(null);
  return { sheet: ws.name, rows, sheets: wb.worksheets.map((w) => w.name) };
}
