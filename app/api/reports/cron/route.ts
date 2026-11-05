import { env } from "@/server/env";
import { sendScheduledReports } from "@/server/reports";
import { HttpError, handler } from "@/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Vercel Cron: informes automàtics als destinataris interns configurats per Direcció. Protegit amb CRON_SECRET. */
export const GET = handler(async (req) => {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) throw new HttpError(401, "No autoritzat");
  return sendScheduledReports();
});
