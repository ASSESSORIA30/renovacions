import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { publicEvent } from "@/server/comparisons";

/** Portal privat de propostes: el client indica interès o demana aclariments (sense sessió; token + límits). */
const body = z.object({ token: z.string().min(20).max(64), kind: z.enum(["interes", "aclariment"]), offerId: z.string().max(80).optional(), message: z.string().max(1500).optional(), contact: z.string().max(200).optional() });
export const POST = handler(async (req) => {
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  return await publicEvent(p.data.token, p.data.kind, p.data);
});
