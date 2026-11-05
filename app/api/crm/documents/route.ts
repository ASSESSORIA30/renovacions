import { z } from "zod";
import { documentAction, documentUrl, documentsForRenewal, docTypes, finalizeUpload, maxDocBytes, requestUpload } from "@/server/crm-docs";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET ?renewal=<id del contracte de renovacions>&cups=… → documents del client vinculat.
 *  GET ?id=…&version=…&download=1 → URL signada de 60 s (després de comprovar l'accés). Sense id: tipus i mida admesos. */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const p = new URL(req.url).searchParams;
  const renewal = p.get("renewal");
  if (renewal) return documentsForRenewal(u, renewal, p.get("cups"));
  const id = p.get("id");
  if (!id) return { types: Object.keys(docTypes()), maxBytes: maxDocBytes() };
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Document no vàlid");
  return documentUrl(u, id, { version: p.get("version") ? Number(p.get("version")) : null, download: p.get("download") === "1" });
});

/** POST { step: "request" | "finalize" | "action", … } */
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const b = (await req.json().catch(() => null)) as { step?: string } | null;
  if (b?.step === "request") return requestUpload(u, b);
  if (b?.step === "finalize") return finalizeUpload(u, b);
  if (b?.step === "action") return documentAction(u, b);
  throw new HttpError(400, "Petició no vàlida");
});
