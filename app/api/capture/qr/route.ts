import { qrFor } from "@/server/partners";
import { HttpError, requireUser } from "@/server/supabase";

export const runtime = "nodejs";
/** QR descarregable d'un enllaç de referència (equip o col·laborador propietari). */
export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const q = new URL(req.url).searchParams;
    const fmt = q.get("format") === "png" ? "png" : "svg";
    const r = await qrFor(u, q.get("code") ?? "", fmt, new URL(req.url).origin);
    return new Response(new Uint8Array(r.body), { headers: { "content-type": r.type, "content-disposition": `attachment; filename="QR-${(q.get("code") ?? "").toUpperCase()}.${fmt}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof HttpError ? e.status : 500 });
  }
}
