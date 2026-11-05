import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { createShare, editRecommendation, explain, getComparison, logWhatsapp, revokeShare, sendEmail, storePdf } from "@/server/comparisons";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), id: z.string().uuid() }),
  z.object({ action: z.literal("explain"), id: z.string().uuid(), lang: z.enum(["ca", "es"]).default("ca") }),
  z.object({ action: z.literal("recommendation"), id: z.string().uuid(), text: z.string().max(6000) }),
  z.object({ action: z.literal("pdf"), id: z.string().uuid(), kind: z.enum(["resum", "detallada"]), lang: z.enum(["ca", "es"]), base64: z.string() }),
  z.object({ action: z.literal("send"), id: z.string().uuid(), to: z.string().max(200), subject: z.string().max(300), body: z.string().max(20000), documentId: z.string().uuid(), confirmed: z.boolean() }),
  z.object({ action: z.literal("whatsapp"), id: z.string().uuid(), phone: z.string().max(40).nullable() }),
  z.object({ action: z.literal("share"), id: z.string().uuid(), days: z.number().int().min(1).max(30).default(15) }),
  z.object({ action: z.literal("revoke"), shareId: z.string().uuid() }),
]);

export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  switch (b.action) {
    case "get": {
      const c = await getComparison(u, b.id);
      const [{ data: docs }, { data: deliveries }, { data: shares }] = await Promise.all([
        u.sb.from("comparison_documents").select("*").eq("comparison_id", b.id).order("created_at", { ascending: false }),
        u.sb.from("comparison_deliveries").select("*").eq("comparison_id", b.id).order("created_at", { ascending: false }),
        u.sb.from("comparison_shares").select("id,expires_at,revoked_at,views,last_view_at,created_at").eq("comparison_id", b.id).order("created_at", { ascending: false }),
      ]);
      return { comparison: c, documents: docs ?? [], deliveries: deliveries ?? [], shares: shares ?? [] };
    }
    case "explain":
      return { recommendation: await explain(u, b.id, b.lang) };
    case "recommendation":
      return { recommendation: await editRecommendation(u, b.id, b.text) };
    case "pdf":
      return await storePdf(u, b.id, b.kind, b.lang, b.base64);
    case "send":
      return await sendEmail(u, b.id, b);
    case "whatsapp":
      await logWhatsapp(u, b.id, b.phone);
      return { ok: true };
    case "share": {
      const s = await createShare(u, b.id, b.days);
      return { ...s, url: `${new URL(req.url).origin}/p/${s.token}` };
    }
    case "revoke":
      return await revokeShare(u, b.shareId);
  }
});
