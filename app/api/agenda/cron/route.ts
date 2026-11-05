import { env } from "@/server/env";
import { generateReminders } from "@/server/agenda";
import { syncAllCalendars } from "@/server/calendar";
import { HttpError, handler } from "@/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Tasca programada de l'agenda (sense cap sessió oberta): recordatoris de tothom i sincronització dels calendaris
 * connectats. Protegida amb CRON_SECRET (capçalera Authorization: Bearer …). La crida Vercel (diària) i, si es
 * vol més freqüència (recordatoris de 5-15 minuts), Supabase pg_cron cada 5 minuts (vegeu FASE10_INFORME.md).
 */
export const GET = handler(async (req) => {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) throw new HttpError(401, "No autoritzat");
  const reminders = await generateReminders();
  const calendars = await syncAllCalendars().catch((e) => ({ error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
  return { reminders, calendars };
});
