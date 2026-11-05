import { exportCatalog, exportCount, exportMeta, exportXlsx } from "@/server/exports";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Exportacions a Excel.
 * GET ?r=catalog | meta&entity=… | count&entity=…&filtres | xlsx&entity=…&filtres
 * Sessió de l'usuari: la RLS i els permisos de cada mòdul decideixen què es pot exportar.
 */
export async function GET(req: Request) {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.r === "xlsx") {
    try {
      const f = await exportXlsx(await requireInternal(), p.entity ?? "", p);
      return new Response(f.bytes as BodyInit, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${f.fileName}"`, "cache-control": "no-store" } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status });
    }
  }
  return get(req);
}
/** Mateixa exportació amb molts identificadors (selecció o files visibles d'una pantalla): el cos és JSON. */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => null)) as { entity?: string; params?: Record<string, string>; ids?: string[] } | null;
    if (!b?.entity) throw new HttpError(400, "Petició no vàlida");
    const raw: Record<string, string> = { ...(b.params ?? {}), ...(Array.isArray(b.ids) && b.ids.length ? { ids: b.ids.slice(0, 5000).map(String).join(",") } : {}) };
    const f = await exportXlsx(await requireInternal(), b.entity, raw);
    return new Response(f.bytes as BodyInit, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${f.fileName}"`, "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status });
  }
}
const get = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "catalog": return exportCatalog(u);
    case "meta": return exportMeta(u, p.entity ?? "");
    case "count": return exportCount(u, p.entity ?? "", p);
    default: throw new HttpError(400, "Petició no vàlida");
  }
});
