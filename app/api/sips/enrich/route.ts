import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { enrichPending } from "@/server/sips";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";
export const maxDuration = 60;

/** Enriquiment manual («Actualitza ara») dels contractes pendents. Només equip d'administració. */
export const POST = handler(async () => {
  await requireInternal({ staff: true });
  return enrichPending(undefined, 45_000);
});
