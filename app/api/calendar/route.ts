import { z } from "zod";
import { authUrl, calendarStatus, disconnect, makeState, setMode, syncMine } from "@/server/calendar";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Calendaris externs de l'usuari (Google / Outlook). Mai retorna tokens. */
export const GET = handler(async () => calendarStatus(await requireInternal()));

const body = z.object({ action: z.enum(["connect", "mode", "disconnect", "sync"]), data: z.unknown().optional() });
export async function POST(req: Request) {
  try {
    const u = await requireInternal();
    const b = body.safeParse(await req.json().catch(() => null));
    if (!b.success) throw new HttpError(400, "Petició no vàlida");
    if (b.data.action === "connect") {
      const d = z.object({ provider: z.enum(["google", "microsoft"]), mode: z.enum(["lectura", "exportacio", "bidireccional"]).default("lectura"), confirm: z.boolean().default(false) }).parse(b.data.data);
      if (d.mode === "bidireccional" && !d.confirm) throw new HttpError(400, "La sincronització bidireccional necessita la teva autorització expressa.");
      const state = makeState(u.user.id, d.provider, d.mode);
      const url = authUrl(d.provider, d.mode, state);
      // el «state» viatja també en una galeta httpOnly: el retorn només s'accepta des d'aquest navegador
      return Response.json({ url }, { headers: { "Set-Cookie": `a30_cal_state=${state}; Path=/api/calendar; HttpOnly; Secure; SameSite=Lax; Max-Age=900` } });
    }
    const out = b.data.action === "mode" ? await setMode(u, b.data.data) : b.data.action === "disconnect" ? await disconnect(u, b.data.data) : await syncMine(u, b.data.data);
    return Response.json(out);
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return Response.json({ error: "Dades no vàlides" }, { status: 400 });
    return Response.json({ error: "Error intern" }, { status: 500 });
  }
}
