import { after } from "next/server";
import { readDocument, submit } from "@/server/capture";
import { PORTAL_CONSENT, portalData, portalMessage, portalUpdateContact } from "@/server/partners";
import { handler, HttpError, requireUser } from "@/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Portal del col·laborador: només dades pròpies (RLS + comprovació de rol). */
export const GET = handler(async () => portalData(await requireUser()));

export const POST = handler(async (req) => {
  const u = await requireUser();
  if (u.profile.role !== "colaborador") throw new HttpError(403, "El portal és per a col·laboradors");
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const fd = await req.formData();
    const fields: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string") fields[k] = v;
    if (fd.get("clientAuthorized") !== "true") throw new HttpError(400, "Cal confirmar que el client t'ha autoritzat a facilitar les dades");
    fields.acceptPrivacy = true;
    fields.acceptCommercial = false;
    fields.acceptWhatsapp = false;
    const file = fd.get("factura");
    const f = file && typeof file !== "string" && file.size > 0 ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || "factura" } : null;
    const r = await submit({ fields, file: f, ip: "portal", by: u, forcedChannel: "collaborador", consentText: PORTAL_CONSENT });
    if (r.ok && r.documentId && !r.duplicate) after(() => readDocument(r.documentId!).then(() => undefined).catch(() => undefined));
    if (!r.ok) throw new HttpError(400, Object.values(r.fieldErrors ?? {})[0] ?? r.error ?? "Dades no vàlides");
    return { ok: true, status: r.status, duplicate: !!r.duplicate };
  }
  const b = (await req.json()) as Record<string, unknown>;
  if (b.action === "contact") return portalUpdateContact(u, b.data);
  if (b.action === "message") return portalMessage(u, b.data);
  throw new HttpError(400, "Acció desconeguda");
});
