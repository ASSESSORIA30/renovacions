import { env, integrations } from "@/server/env";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

/**
 * WhatsApp Business Platform (Cloud API) — prepared for a later phase.
 * Business-initiated messages require an APPROVED template. Delivery receipts arrive via webhook
 * (not implemented yet) and would update activities.delivery to "entregado".
 * Until then the UI uses wa.me links (status "preparado").
 */
export const POST = handler(async (req) => {
  const { sb } = await requireInternal();
  if (!integrations().whatsappCloud) throw new HttpError(400, "WhatsApp Business Platform no configurat");
  const b = (await req.json()) as { to: string; template: string; lang?: string; params: string[]; contractId: string };
  const { data: c } = await sb.from("contracts").select("id").eq("id", b.contractId).maybeSingle();
  if (!c) throw new HttpError(403, "Sense accés a aquest contracte");
  const r = await fetch(`https://graph.facebook.com/v21.0/${env.waPhoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.waToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: b.to.replace(/[^\d]/g, ""),
      type: "template",
      template: { name: b.template, language: { code: b.lang ?? "es" }, components: [{ type: "body", parameters: b.params.map((text) => ({ type: "text", text })) }] },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new HttpError(502, j?.error?.message ?? "Error de WhatsApp");
  return { id: j.messages?.[0]?.id, accepted: true };
});
