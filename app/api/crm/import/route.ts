import { importPortfolio } from "@/server/crm-import";
import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Importació inicial de la cartera existent al CRM (Administració/Direcció). { dryRun: true } només compta. */
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const b = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  return importPortfolio(u, b.dryRun !== false);
});
