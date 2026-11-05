import { HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { audit, cacheSearchRows, canSearchExternal, isCupsVisible, rateLimit, searchSips, sipsErrorResponse } from "@/server/sips";
import { SipsError } from "@/energy/lib/sips-engine";
import { isValidCups } from "@/core/sips";
import { sipsEnv } from "@/server/env";
import { cupsBase } from "@/energy/lib/sips-record";
import type { SearchInput } from "@/energy/lib/sips-engine";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";
export const maxDuration = 30;

/**
 * Buscador SIPS (mode CUPS o codi postal + adreça). Retorna les 97 columnes de l'exportació.
 * - CUPS d'un contracte visible: qualsevol usuari autenticat.
 * - Subministraments externs i cerca per adreça: rols de SIPS_EXTERNAL_ROLES.
 * Limitat per usuari i minut, i registrat a sips_audit.
 */
export async function POST(req: Request) {
  try { return Response.json(await search(req)); } catch (e) { return sipsErrorResponse(e); }
}

async function search(req: Request) {
  const u = await requireInternal();
  const b = (await req.json().catch(() => ({}))) as SearchInput;
  const q: SearchInput = {
    energia: b.energia === "luz" || b.energia === "gas" || b.energia === "totes" ? b.energia : undefined,
    cups: typeof b.cups === "string" ? b.cups.slice(0, 40) : undefined,
    cp: typeof b.cp === "string" ? b.cp.slice(0, 5) : undefined,
    direccion: typeof b.direccion === "string" ? b.direccion.slice(0, 120) : undefined,
    tarifa: typeof b.tarifa === "string" && b.tarifa ? b.tarifa : undefined,
    minKWh: b.minKWh != null && Number(b.minKWh) > 0 ? Number(b.minKWh) : undefined,
    skip: Math.max(0, Number(b.skip) || 0),
    take: Math.min(100, Math.max(1, Number(b.take) || 50)),
  };
  if (!q.cups && !q.cp) throw new HttpError(400, "Introdueix un CUPS o un codi postal de 5 xifres.");
  if (q.cups && !isValidCups(cupsBase(q.cups))) throw new SipsError(400, "CUPS no vàlid: calen 20 o 22 caràcters (ES + 16 xifres + 2 lletres [+ sufix]).", "cups_invalid");
  if (!sipsEnv().user || !sipsEnv().pass) throw new SipsError(503, "Buscador SIPS no configurat: falten SIPS_USER o SIPS_PASSWORD al servidor (Vercel → Environment Variables).", "no_configurat");
  const external = canSearchExternal(u.profile.role);
  if (!external) {
    if (!q.cups) throw new HttpError(403, "La cerca per adreça està reservada als rols autoritzats per a subministraments externs.");
    if (!(await isCupsVisible(u.sb, cupsBase(q.cups)))) throw new HttpError(403, "Només pots consultar CUPS dels teus contractes.");
  }
  await rateLimit(u, ["search"], sipsEnv().rateSearch);
  try {
    const r = await searchSips(q);
    if (q.cups && r.rows.length > 1) await cacheSearchRows(r.rows).catch((e) => console.warn("[sips] cache", e));
    await audit(u, "search", { ...q, mode: q.cups ? "cups" : "adreca" }, r.total, true);
    return r;
  } catch (e) {
    await audit(u, "search", q, null, false, e instanceof SipsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
    throw e;
  }
}
