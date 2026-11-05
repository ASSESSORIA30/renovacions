import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { libraryDecide, libraryFor, libraryPropose, openChat } from "@/server/tariff-open";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Lector de tarifes · Tarifa Open (Fase 10.1).
 * GET  ?supplier=&product=&tariff=&version=      → regles de la biblioteca (aprovades i pendents) per a un document
 * POST { action: "propose" | "decide" | "chat", data }
 * Només administració (is_staff); aprovar o rebutjar, només Direcció.
 */
export const GET = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const p = Object.fromEntries(new URL(req.url).searchParams);
  return libraryFor(u, { supplier: p.supplier, product: p.product, tariff: p.tariff || null, version: p.version || null });
});

const body = z.object({ action: z.enum(["propose", "decide", "chat"]), data: z.unknown() });
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, "Petició no vàlida");
  if (b.data.action === "propose") return libraryPropose(u, b.data.data);
  if (b.data.action === "decide") return libraryDecide(u, b.data.data);
  return openChat(u, b.data.data);
});
