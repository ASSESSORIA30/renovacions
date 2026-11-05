import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { importLegacy, legacyReport, listCatalog, permanenceRule, savePermanenceRule, saveVersion, setStatus } from "@/server/tariffs";
import { TARIFF_STATUSES } from "@/comparator/types";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const u = await requireInternal();
  const sp = new URL(req.url).searchParams;
  if (sp.get("r") === "rule") return await permanenceRule(u.sb as never);
  if (sp.get("r") === "legacy") return await legacyReport(await requireInternal({ staff: true }));
  return await listCatalog(u, { allVersions: new URL(req.url).searchParams.get("all") === "1" });
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), offer: z.unknown() }),
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(TARIFF_STATUSES) }),
  z.object({ action: z.literal("permanence_rule"), rule: z.unknown() }),
  z.object({ action: z.literal("import_legacy"), ids: z.array(z.string().min(1).max(100)).min(1).max(500) }),
]);

/** Alta, edició (crea versió nova si ja s'ha usat o activat) i canvi d'estat. Només equip d'administració. */
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  if (p.data.action === "save") return await saveVersion(u, p.data.offer, { origin: "manual" });
  if (p.data.action === "permanence_rule") return await savePermanenceRule(u, p.data.rule);
  if (p.data.action === "import_legacy") return await importLegacy(u, p.data.ids);
  return await setStatus(p.data.id, p.data.status);
});
