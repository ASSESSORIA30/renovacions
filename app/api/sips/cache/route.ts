import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { readCache, visibleCupsSet } from "@/server/sips";

export const dynamic = "force-dynamic";

/**
 * Dades SIPS desades dels contractes VISIBLES per a l'usuari (RLS de `contracts`).
 * - Sense paràmetres: resum per al Kanban i el generador d'ofertes.
 * - `?full=1&offset=0&limit=500`: inclou les 97 columnes (`raw`) per als mòduls energètics.
 * La service role només s'utilitza després de filtrar pels CUPS visibles.
 */
export const GET = handler(async (req) => {
  const { sb } = await requireInternal();
  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "1";
  const keys = [...(await visibleCupsSet(sb))].sort();
  if (!full) return { rows: await readCache(keys), total: keys.length };
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 500));
  const slice = keys.slice(offset, offset + limit);
  return { rows: await readCache(slice, true), total: keys.length, offset, limit, next: offset + limit < keys.length ? offset + limit : null };
});
