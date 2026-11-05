import type { ImportReport } from "@/core/importer";
import type { SourceContract } from "@/core/types";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { upsertSource } from "@/server/sync";

export const maxDuration = 60;

/** Manual Excel import (parsed in the browser with the same importer). Admin only. */
export const POST = handler(async (req) => {
  await requireInternal({ staff: true });
  const body = (await req.json()) as { contracts: SourceContract[]; report: ImportReport; origin: string };
  if (!Array.isArray(body.contracts) || body.contracts.length > 50000) throw new HttpError(400, "Dades d'importació no vàlides");
  for (const c of body.contracts) if (typeof c.id !== "string" || typeof c.cliente !== "string") throw new HttpError(400, "Contracte sense id o client");
  return upsertSource(body.contracts.map((c) => ({ ...c, source: "real" as const })), body.report, body.origin.slice(0, 200));
});
