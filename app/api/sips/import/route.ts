import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { audit, importExcelRows } from "@/server/sips";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Desa a Supabase un Excel SIPS importat al navegador (per lots de fins a 500 files). Només equip d'administració. */
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const b = (await req.json().catch(() => ({}))) as { file?: string; rows?: unknown };
  if (!Array.isArray(b.rows) || b.rows.length < 2) throw new HttpError(400, "No hi ha files per importar.");
  if (b.rows.length > 501) throw new HttpError(413, "Envia lots de fins a 500 files.");
  const rows = (b.rows as unknown[][]).map((r) => (Array.isArray(r) ? r.slice(0, 200).map((v) => (v == null || typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 500))) : []));
  const file = String(b.file ?? "Excel SIPS").slice(0, 120);
  const r = await importExcelRows(rows as (string | number | boolean | null)[][], file);
  await audit(u, "import", { file, rows: rows.length - 1 }, r.saved, true);
  return r;
});
