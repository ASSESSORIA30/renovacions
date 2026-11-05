import { z } from "zod";
import {
  authorizeClaim,
  addAttachment, addReminder, addTask, attachmentUrl, claimPdf, claimsOverview, createClaim, deleteContact, deleteDraft, doneReminder, explainRow, followUp, getClaim, incidentFromItem,
  listContacts, markSentExternally, registerRecovery, registerResponse, removeItem, reviewLink, saveContact, sendClaim, setClaimStatus, updateClaim,
} from "@/server/claims";
import { handler, HttpError, requireUser } from "@/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Reclamacions a comercialitzadores (Fase 8.2).
 * GET ?r=overview|claim|pdf|attachment|contacts
 * Tot amb la sessió de l'usuari: el servidor comprova el permís «economia» (o l'assignació) i la RLS ho torna a comprovar.
 */
export async function GET(req: Request) {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.r === "pdf") {
    try {
      const u = await requireUser();
      const { pdf, fileName } = await claimPdf(u, p.id ?? "", p.lang);
      return new Response(pdf as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `${p.inline ? "inline" : "attachment"}; filename="${fileName}"`, "cache-control": "no-store" } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status });
    }
  }
  return get(req);
}
const get = handler(async (req) => {
  const u = await requireUser();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "overview": return claimsOverview(u, p);
    case "claim": return getClaim(u, p.id ?? "");
    case "attachment": return attachmentUrl(u, p.id ?? "");
    case "contacts": return listContacts(u, p.retailer ?? "");
    default: throw new HttpError(400, "Petició no vàlida");
  }
});

const body = z.object({
  action: z.enum(["explain", "create", "follow_up", "update", "status", "delete", "remove_item", "send", "sent_external", "response", "attachment", "reminder", "reminder_done", "task", "recovery", "link", "contact_save", "contact_delete", "incident", "authorize"]),
  id: z.string().uuid().optional(),
  ref: z.string().uuid().optional(),
  data: z.unknown().optional(),
});
export const POST = handler(async (req) => {
  const u = await requireUser();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  const id = () => { if (!b.id) throw new HttpError(400, "Falta l'identificador"); return b.id; };
  const ref = () => { if (!b.ref) throw new HttpError(400, "Falta l'identificador"); return b.ref; };
  switch (b.action) {
    case "explain": return explainRow(u, b.data);
    case "create": return createClaim(u, b.data);
    case "follow_up": return followUp(u, id());
    case "update": return updateClaim(u, id(), b.data);
    case "status": return setClaimStatus(u, id(), b.data);
    case "delete": return deleteDraft(u, id());
    case "remove_item": return removeItem(u, id(), ref());
    case "send": return sendClaim(u, id(), b.data);
    case "sent_external": return markSentExternally(u, id(), b.data);
    case "response": return registerResponse(u, id(), b.data);
    case "attachment": return addAttachment(u, id(), b.data);
    case "reminder": return addReminder(u, id(), b.data);
    case "reminder_done": return doneReminder(u, id(), ref());
    case "task": return addTask(u, id(), b.data);
    case "recovery": return registerRecovery(u, id(), b.data);
    case "link": return reviewLink(u, id(), b.data);
    case "contact_save": return saveContact(u, b.data, b.id);
    case "contact_delete": return deleteContact(u, id());
    case "incident": return incidentFromItem(u, id(), ref());
    case "authorize": return authorizeClaim(u, id(), b.data);
  }
});
