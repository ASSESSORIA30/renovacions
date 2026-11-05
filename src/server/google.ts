import "server-only";
import { google } from "googleapis";
import * as XLSX from "xlsx";
import type { Sheet } from "@/core/importer";
import { env } from "./env";

function auth(scopes: string[]) {
  const creds = JSON.parse(env.googleSa);
  return new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes });
}

function drive() {
  return google.drive({ version: "v3", auth: auth(["https://www.googleapis.com/auth/drive.readonly"]) });
}

export async function readDriveMeta(fileId: string) {
  const r = await drive().files.get({ fileId, fields: "id, name, mimeType, modifiedTime", supportsAllDrives: true });
  return { id: r.data.id!, name: r.data.name ?? fileId, modifiedTime: r.data.modifiedTime ?? "" };
}

/** Newest file in a Drive folder whose name contains `prefix` (e.g. the daily "Contratos_YYYYMMDD_HHMMSS.xlsx" export). */
export async function latestInFolder(folderId: string, prefix: string) {
  const r = await drive().files.list({
    q: `'${folderId.replace(/'/g, "")}' in parents and name contains '${prefix.replace(/'/g, "")}' and trashed = false`,
    orderBy: "modifiedTime desc", pageSize: 1, fields: "files(id, name, modifiedTime)",
    supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives",
  });
  const f = r.data.files?.[0];
  return f ? { id: f.id!, name: f.name!, modifiedTime: f.modifiedTime ?? "" } : null;
}

/**
 * Reads a Drive file as sheets. Works for both native Google Sheets (exported as xlsx)
 * and .xlsx files stored in Drive (downloaded as-is), which is the current situation.
 */
export async function readDriveSpreadsheet(fileId: string): Promise<{ name: string; modifiedTime: string; sheets: Sheet[] }> {
  const d = drive();
  const meta = await d.files.get({ fileId, fields: "name, mimeType, modifiedTime", supportsAllDrives: true });
  const isNative = meta.data.mimeType === "application/vnd.google-apps.spreadsheet";
  const res = isNative
    ? await d.files.export({ fileId, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { responseType: "arraybuffer" })
    : await d.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  const wb = XLSX.read(new Uint8Array(res.data as ArrayBuffer), { type: "array", cellDates: true });
  return {
    name: meta.data.name ?? fileId,
    modifiedTime: meta.data.modifiedTime ?? "",
    sheets: wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) as unknown[][] })),
  };
}

/**
 * Bidirectional part: writes the CRM status into an "ESTADO CRM" column of a NATIVE Google Sheet,
 * matching rows by CUPS. (Cells of .xlsx files in Drive cannot be edited through the API —
 * convert the sheet to Google Sheets format and set WRITEBACK_SHEET_ID to enable this.)
 */
export async function writeBackStatuses(sheetId: string, tab: string, byCups: Map<string, string>) {
  const sheets = google.sheets({ version: "v4", auth: auth(["https://www.googleapis.com/auth/spreadsheets"]) });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${tab}'` });
  const rows = data.values ?? [];
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim().toUpperCase().startsWith("CUPS")));
  if (headerIdx < 0) return { updated: 0 };
  const header = rows[headerIdx].map((c) => String(c).trim().toUpperCase());
  const cupsCol = header.findIndex((h) => h.startsWith("CUPS"));
  let statusCol = header.indexOf("ESTADO CRM");
  const updates: { range: string; values: string[][] }[] = [];
  const col = (n: number) => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  if (statusCol < 0) {
    statusCol = header.length;
    updates.push({ range: `'${tab}'!${col(statusCol)}${headerIdx + 1}`, values: [["ESTADO CRM"]] });
  }
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cups = String(rows[i][cupsCol] ?? "").trim().toUpperCase();
    const st = byCups.get(cups);
    if (st && rows[i][statusCol] !== st) updates.push({ range: `'${tab}'!${col(statusCol)}${i + 1}`, values: [[st]] });
  }
  for (let i = 0; i < updates.length; i += 500) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: "RAW", data: updates.slice(i, i + 500) } });
  }
  return { updated: updates.length };
}
