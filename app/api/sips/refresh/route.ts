import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { assertCupsAccess, audit, rateLimit, refreshSips } from "@/server/sips";
import { sipsEnv } from "@/server/env";
import { isValidCups } from "@/core/sips";
import { cupsBase } from "@/energy/lib/sips-record";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";
export const maxDuration = 30;

/** Actualització manual d'un CUPS des de la fitxa o el generador d'ofertes. */
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const { cups, force = true } = (await req.json().catch(() => ({}))) as { cups?: string; force?: boolean };
  const base = cupsBase(cups);
  if (!isValidCups(base)) throw new HttpError(400, "CUPS no vàlid: calen 20 o 22 caràcters (llum o gas).");
  await assertCupsAccess(u, base);
  await rateLimit(u, ["refresh"], sipsEnv().rateRefresh);
  const entry = await refreshSips(String(cups), { force: !!force });
  await audit(u, "refresh", { cups: base }, entry.status === "found" ? 1 : 0, entry.status !== "error", entry.error ?? undefined);
  return { entry };
});
