import { metaLeadgenWebhook, verifyChallenge } from "@/server/marketing";
import { HttpError } from "@/server/supabase";

export const runtime = "nodejs";
/** Meta Lead Ads. GET: verificació de la subscripció. POST: esdeveniments «leadgen» signats (X-Hub-Signature-256). */
export async function GET(req: Request) {
  const c = verifyChallenge(new URL(req.url).searchParams);
  return c ? new Response(c, { status: 200 }) : new Response("Forbidden", { status: 403 });
}
export async function POST(req: Request) {
  try { return Response.json(await metaLeadgenWebhook(await req.text(), req.headers.get("x-hub-signature-256"))); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: e instanceof HttpError ? e.status : 500 }); }
}
