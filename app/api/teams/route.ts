import { z } from "zod";
import { assignLead, listTeams, moveMember, saveTeam, setPortfolio, teamPanel } from "@/server/teams";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Equips comercials i panell del Cap d'equip (Fase 8.1). Sessió de l'usuari (RLS) i permisos al servidor. */
export const GET = handler(async (req) => {
  const sp = new URL(req.url).searchParams;
  const u = await requireInternal();
  switch (sp.get("r") ?? "panel") {
    case "panel": return teamPanel(u, Object.fromEntries(sp.entries()));
    case "list": return listTeams(u);
    default: throw new HttpError(400, "Petició desconeguda");
  }
});

const body = z.object({ action: z.enum(["team_save", "member_move", "portfolio", "lead_assign"]), data: z.unknown() });
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const { action, data } = p.data;
  if (action === "team_save") return saveTeam(u, data);
  if (action === "member_move") return moveMember(u, data);
  if (action === "portfolio") return setPortfolio(u, data);
  return assignLead(u, data);
});
