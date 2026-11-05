import { track } from "@/server/capture";

export const runtime = "nodejs";
/** Mètriques anònimes de la landing (visita, formulari iniciat/enviat). Sense IP ni cookies de tercers. */
export async function POST(req: Request) {
  try { return Response.json(await track(await req.json())); } catch { return Response.json({ ok: false }); }
}
