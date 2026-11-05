import { env, integrations, sipsEnv } from "@/server/env";
import { HttpError, handler } from "@/server/supabase";
import { enrichPending } from "@/server/sips";
import { runGoogleSync } from "@/server/sync";
import { syncAllConnectors } from "@/server/connectors";
import { expireOutdated } from "@/server/tariffs";
import { purgeExpiredInvoices } from "@/server/invoices";
import { runAutomations } from "@/server/automations";
import { processPendingCapture } from "@/server/capture";
import { syncGoogleAdsCosts } from "@/server/marketing";

export const maxDuration = 120;
export const preferredRegion = "cdg1";

/**
 * Vercel Cron (vercel.json). Protegit amb CRON_SECRET.
 * 1) Google Drive → contracts.  2) Enriquiment SIPS d'un lot limitat (no bloqueja si el portal falla).
 * Un cron no garanteix hora exacta ni pot processar tota la base de dades: es treballa per lots.
 */
export const GET = handler(async (req) => {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) throw new HttpError(401, "No autoritzat");
  const started = Date.now();
  const google = integrations().googleSync ? await runGoogleSync().then((result) => ({ ok: true, result })).catch((e) => ({ ok: false, error: String(e) })) : { skipped: true };
  // CRM comercial: tasques i avisos automàtics (idempotent)
  const automations = await runAutomations("cron").then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: String(e) }));
  const budget = Math.max(5_000, 90_000 - (Date.now() - started));
  const sips = await enrichPending(sipsEnv().cronLimit, budget).then((result) => ({ ok: true, result })).catch((e) => ({ ok: false, error: String(e) }));
  // Comparatives: caducitat de tarifes, connectors API autoritzats i retenció de factures.
  const tariffs = await expireOutdated().then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: String(e) }));
  const connectors = await syncAllConnectors().catch((e) => [{ ok: false, error: String(e) }]);
  const invoices = await purgeExpiredInvoices().catch((e) => ({ ok: false, error: String(e) }));
  // Captació (Fase 6): reintents de sol·licituds i lectures, anonimització i costos de Google Ads (si hi ha credencials)
  const capture = await processPendingCapture().catch((e) => ({ ok: false, error: String(e) }));
  const ads = await syncGoogleAdsCosts().catch((e) => ({ status: "error", error: String(e) }));
  return { google, automations, sips, tariffs, connectors, invoices, capture, ads };
});
