import { reportPdf } from "@/server/reports";
import { HttpError, requireUser } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Descàrrega d'informes en PDF dins de l'abast de qui els demana (els col·laboradors, només les seves operacions). */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const base = await requireUser();
    const u = base.profile.role === "colaborador" ? base : await requireInternal();
    const r = await reportPdf(u, sp.get("kind") ?? "diari");
    return new Response(Buffer.from(r.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${r.filename}"`, "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status });
  }
}
