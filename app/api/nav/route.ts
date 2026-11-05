import { z } from "zod";
import { draftClose, draftGet, draftSave, draftsForClient, recentClear, recentList, recentTouch, resolveRenewal, supplyPoint } from "@/server/navigation";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";

/**
 * Fase 9 · Navegació i context.
 * GET ?r=resolve&renewal=…&cups=… | supply&cups=… | recent | draft&(id|contract|client[&supply]|cups) | drafts&client=…
 * Sessió de l'usuari: la RLS decideix què pot veure cadascú.
 */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "resolve": return resolveRenewal(u, p.renewal ?? "", p.cups);
    case "supply": return supplyPoint(u, p.cups ?? "");
    case "recent": return recentList(u);
    case "draft": return draftGet(u, p);
    case "drafts": return draftsForClient(u, p.client ?? "");
    default: throw new HttpError(400, "Petició no vàlida");
  }
});

const body = z.object({ action: z.enum(["recent_touch", "recent_clear", "draft_save", "draft_close"]), data: z.unknown().optional() });
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, "Petició no vàlida");
  switch (b.data.action) {
    case "recent_touch": return recentTouch(u, b.data.data);
    case "recent_clear": return recentClear(u);
    case "draft_save": return draftSave(u, b.data.data);
    case "draft_close": return draftClose(u, b.data.data);
  }
});
