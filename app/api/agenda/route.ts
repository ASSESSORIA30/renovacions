import { z } from "zod";
import { agendaSummary, availability, deleteEvent, generateReminders, linkedEvents, listAgenda, respond, saveEvent, setEventStatus } from "@/server/agenda";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AGENDA (Fase 10). Sessió de l'usuari: la RLS de la 020 decideix què veu i què pot canviar cadascú.
 * GET  ?r=list&from&to&view&users&kinds · ?r=availability&users&from&to&duration · ?r=summary · ?r=linked&(client|contract|renewal|incident)
 * POST {action: save|delete|respond|status|tick, data}
 */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r ?? "list") {
    case "list": return listAgenda(u, p);
    case "availability": return availability(u, p);
    case "summary": return agendaSummary(u);
    case "linked": return linkedEvents(u, p);
    default: throw new HttpError(400, "Petició no vàlida");
  }
});

const body = z.object({ action: z.enum(["save", "delete", "respond", "status", "tick"]), data: z.unknown().optional() });
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, "Petició no vàlida");
  switch (b.data.action) {
    case "save": return saveEvent(u, b.data.data);
    case "delete": return deleteEvent(u, b.data.data);
    case "respond": return respond(u, b.data.data);
    case "status": return setEventStatus(u, b.data.data);
    // amb el CRM obert: genera els recordatoris pendents de l'usuari (sense duplicats)
    case "tick": return generateReminders({ userId: u.user.id });
  }
});
