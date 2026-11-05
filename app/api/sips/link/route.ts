import { z } from "zod";
import { HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { assertCupsAccess, audit, rateLimit, refreshSips, sipsErrorResponse } from "@/server/sips";
import { sipsEnv } from "@/server/env";
import { isValidCups } from "@/core/sips";
import { cupsBase } from "@/energy/lib/sips-record";
import { normalizeTariff } from "@/comparator/engine";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";
export const maxDuration = 30;

/**
 * Fase 8 · Vincula les dades SIPS d'un CUPS al subministrament del CRM (Clients 360°).
 * Consulta el portal (o la memòria cau vigent), desa les dades autoritzades amb DATA I ORIGEN
 * (data_source = 'sips', data_updated_at) i ho anota a l'activitat del client. Només subministraments que
 * l'usuari pot editar (RLS). No inventa cap valor: els camps que el SIPS no retorna no es toquen.
 */
export async function POST(req: Request) {
  try {
    const u = await requireInternal();
    const b = z.object({ cups: z.string().min(20).max(30), force: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
    if (!b.success) throw new HttpError(400, "Petició no vàlida");
    const base = cupsBase(b.data.cups);
    if (!isValidCups(base)) throw new HttpError(400, "CUPS no vàlid");
    await assertCupsAccess(u, base);
    await rateLimit(u, ["refresh", "link"], sipsEnv().rateRefresh);
    const entry = await refreshSips(base, { force: !!b.data.force });
    if (entry.status !== "found") throw new HttpError(404, entry.error ?? "El SIPS no retorna dades per a aquest CUPS");
    const patch: Record<string, unknown> = { data_source: "sips", data_updated_at: new Date().toISOString() };
    if (entry.annual_kwh != null) patch.annual_kwh = Math.round(entry.annual_kwh);
    const t = normalizeTariff(entry.tariff);
    if (t) patch.access_tariff = t;
    if (entry.contracted_power_kw?.some((x) => x != null)) patch.power_kw = entry.contracted_power_kw.slice(0, 6);
    if (entry.retailer) patch.current_retailer = entry.retailer;
    if (entry.address) patch.address = entry.address;
    const { data, error } = await u.sb.from("crm_supplies").update(patch).eq("cups20", base).is("archived_at", null).select("id,client_id");
    if (error) throw new HttpError(400, "No s'ha pogut actualitzar el subministrament");
    if (!data?.length) throw new HttpError(403, "No hi ha cap subministrament del CRM amb aquest CUPS que puguis modificar");
    for (const s of data) {
      await u.sb.from("crm_activities").insert({ client_id: s.client_id, supply_id: s.id, type: "canvi", title: "Dades SIPS vinculades al subministrament", body: `Origen: ${entry.source_detail ?? "Portal SIPS"} · consulta del ${new Date(entry.consulted_at).toLocaleString("ca-ES", { timeZone: "Europe/Madrid" })}`, user_id: u.user.id, user_name: u.profile.name, meta: { cups: base, fields: Object.keys(patch) } });
    }
    await audit(u, "link", { cups: base }, data.length, true);
    return Response.json({ updated: data.length, clientIds: [...new Set(data.map((s) => s.client_id))], consultedAt: entry.consulted_at, fields: Object.keys(patch).filter((k) => !["data_source", "data_updated_at"].includes(k)) });
  } catch (e) {
    return sipsErrorResponse(e);
  }
}
