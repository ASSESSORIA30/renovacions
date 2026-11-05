import { z } from "zod";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import {
  authorize, clientRelations, confirmGroupWhatsapp, groupData, linkContactClient, listOps, preflight, registerGroupActivity, revokeLink, saveLink, sendGroup, unlinkContactClient,
} from "@/server/contact-groups";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Agrupació de renovacions per contacte (migració 029): dades per calcular els grups, decisions d'unir/separar,
 * activitat conjunta, «Contactar tots» i relacions persona ↔ client de Clients 360°.
 * Totes les comprovacions de permisos es fan al servidor i a la RLS de Supabase.
 */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const sp = new URL(req.url).searchParams;
  switch (sp.get("r")) {
    case "ops": return listOps(u, sp.get("contract") ?? "");
    case "client": return clientRelations(u, sp.get("id") ?? "");
    default: return groupData(u);
  }
});

const body = z.object({
  action: z.enum(["link", "unlink", "activity", "preflight", "send", "confirm_wa", "authorize", "contact_link", "contact_unlink"]),
  id: z.string().max(64).optional(),
  data: z.unknown(),
});
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const { action, data, id } = p.data;
  switch (action) {
    case "link": return saveLink(u, data);
    case "unlink": return revokeLink(u, id ?? "");
    case "activity": return registerGroupActivity(u, data);
    case "preflight": return preflight(u, data);
    case "send": return sendGroup(u, data);
    case "confirm_wa": return confirmGroupWhatsapp(u, id ?? "");
    case "authorize": return authorize(u, data);
    case "contact_link": return linkContactClient(u, data);
    case "contact_unlink": return unlinkContactClient(u, id ?? "");
  }
});
