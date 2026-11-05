import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { assertCupsAccess, readCache } from "@/server/sips";
import { isValidCups } from "@/core/sips";
import { cupsBase } from "@/energy/lib/sips-record";

export const dynamic = "force-dynamic";

/** Dades desades d'un CUPS (sense consultar el portal). La fitxa decideix si cal actualitzar. */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const base = cupsBase(new URL(req.url).searchParams.get("cups"));
  if (!isValidCups(base)) throw new HttpError(400, "CUPS no vàlid (llum o gas).");
  const { inCrm } = await assertCupsAccess(u, base);
  const [entry] = await readCache([base], true);
  // Fase 8: subministraments del CRM (Clients 360°) amb aquest CUPS que l'usuari pot veure
  const { data: crm } = await u.sb.from("crm_supplies").select("id,client_id,data_source,data_updated_at,crm_clients(name)").eq("cups20", base).is("archived_at", null).limit(5);
  return { entry: entry ?? null, inCrm: inCrm || !!crm?.length, crmSupplies: crm ?? [] };
});
