import { z } from "zod";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { clientComms, listBusinessNumbers, confirmRequestSent, manageBusinessNumbers, myComms, registerRequest, revokeMailAccount, saveMailAccount, saveWhatsapp, sendClientEmail, sendClientWhatsapp, testMailAccount, updateDataRequest } from "@/server/comms";

export const runtime = "nodejs";
export const maxDuration = 45;

/** Fase 8 · Comunicacions: el meu perfil (correu i WhatsApp) i accions de la fitxa del client. */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const sp = new URL(req.url).searchParams;
  if (sp.get("r") === "client") return clientComms(u, sp.get("id") ?? "");
  if (sp.get("r") === "numbers") return listBusinessNumbers(u);
  return myComms(u);
});

const body = z.object({ action: z.enum(["mail_save", "mail_test", "mail_revoke", "wa_save", "wa_numbers", "request", "request_update", "request_confirm", "send_email", "send_whatsapp"]), id: z.string().max(64).optional(), data: z.unknown() });
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const { action, data, id } = p.data;
  switch (action) {
    case "mail_save": return saveMailAccount(u, data);
    case "mail_test": return testMailAccount(u);
    case "mail_revoke": return revokeMailAccount(u);
    case "wa_save": return saveWhatsapp(u, data);
    case "wa_numbers": return manageBusinessNumbers(u, data);
    case "request": return registerRequest(u, data, (data as { delivery?: "intent" | "registrat" })?.delivery === "registrat" ? "registrat" : "intent");
    case "request_update": return updateDataRequest(u, id ?? "", data);
    case "request_confirm": return confirmRequestSent(u, id ?? "");
    case "send_email": return sendClientEmail(u, data);
    case "send_whatsapp": return sendClientWhatsapp(u, data);
  }
});
