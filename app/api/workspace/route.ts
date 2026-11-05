import { z } from "zod";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";

/**
 * Fase 8 · Espai de treball persistent de cada usuari (mòdul energètic: ofertes, configuració, factures i màxims).
 * Abans només es guardava al navegador; ara es desa a Supabase (RLS: cada usuari només el seu) i es recupera en
 * qualsevol navegador o dispositiu. Control de concurrència per versió: si un altre dispositiu ha desat abans,
 * es retorna 409 amb la versió actual perquè el client la fusioni.
 */
const KEY = z.string().regex(/^[a-z0-9_.-]{1,60}$/);
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const key = KEY.parse(new URL(req.url).searchParams.get("key") ?? "");
  const { data, error } = await u.sb.from("user_workspace").select("data,version,updated_at").eq("user_id", u.user.id).eq("key", key).maybeSingle();
  if (error) throw new HttpError(/does not exist|schema cache/i.test(error.message) ? 503 : 500, /does not exist|schema cache/i.test(error.message) ? "Falta aplicar la migració 015_comunicacions.sql" : "No s'ha pogut llegir l'espai de treball");
  return data ?? { data: null, version: 0, updated_at: null };
});

export const PUT = handler(async (req) => {
  const u = await requireInternal();
  const b = z.object({ key: KEY, data: z.record(z.unknown()), version: z.number().int().min(0) }).parse(await req.json());
  if (JSON.stringify(b.data).length > 3_000_000) throw new HttpError(413, "L'espai de treball és massa gran per desar-lo (màxim 3 MB)");
  const cur = await u.sb.from("user_workspace").select("data,version,updated_at").eq("user_id", u.user.id).eq("key", b.key).maybeSingle();
  if (cur.error) throw new HttpError(500, "No s'ha pogut desar");
  if (cur.data && cur.data.version !== b.version) return Response.json({ conflict: true, ...cur.data }, { status: 409 });
  const next = { user_id: u.user.id, key: b.key, data: b.data, version: (cur.data?.version ?? 0) + 1, updated_at: new Date().toISOString() };
  if (cur.data) {
    // escriptura condicional (compare-and-set): si entre la lectura i l'escriptura un altre dispositiu ha desat, 0 files → 409
    const { data: upd, error } = await u.sb.from("user_workspace").update({ data: next.data, version: next.version, updated_at: next.updated_at }).eq("user_id", u.user.id).eq("key", b.key).eq("version", b.version).select("version");
    if (error) throw new HttpError(400, "No s'ha pogut desar l'espai de treball");
    if (!upd?.length) {
      const now = await u.sb.from("user_workspace").select("data,version,updated_at").eq("user_id", u.user.id).eq("key", b.key).maybeSingle();
      return Response.json({ conflict: true, ...(now.data ?? {}) }, { status: 409 });
    }
  } else {
    const { error } = await u.sb.from("user_workspace").insert(next);
    if (error?.code === "23505") return Response.json({ conflict: true, ...((await u.sb.from("user_workspace").select("data,version,updated_at").eq("user_id", u.user.id).eq("key", b.key).maybeSingle()).data ?? {}) }, { status: 409 });
    if (error) throw new HttpError(400, "No s'ha pogut desar l'espai de treball");
  }
  return { version: next.version, updated_at: next.updated_at };
});
