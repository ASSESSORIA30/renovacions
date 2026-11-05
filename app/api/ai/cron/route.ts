import { env } from "@/server/env";
import { runIntelligence } from "@/server/intelligence";
import { HttpError, handler } from "@/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = "cdg1";

/**
 * Vercel Cron diari del motor d'oportunitats (vercel.json). Protegit amb CRON_SECRET.
 * Idempotent: si es repeteix, no duplica oportunitats, tasques ni avisos. Una sola execució alhora.
 */
export const GET = handler(async (req) => {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) throw new HttpError(401, "No autoritzat");
  return runIntelligence("cron");
});
