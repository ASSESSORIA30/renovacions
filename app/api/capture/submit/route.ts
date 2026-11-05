import { after } from "next/server";
import { HttpError } from "@/server/supabase";
import { readDocument, submit } from "@/server/capture";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Formulari PÚBLIC de la landing (multipart). No llegeix cap dada privada: valida, limita, desa i respon.
 * La lectura de la factura es fa en segon pla (after): si falla, el lead i el document ja estan desats.
 */
export async function POST(req: Request) {
  try {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 11 * 1024 * 1024) return Response.json({ ok: false, error: "El fitxer supera els 10 MB" }, { status: 413 });
    const fd = await req.formData();
    const fields: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string" && k !== "utm") fields[k] = v;
    fields.acceptPrivacy = fd.get("acceptPrivacy") === "true";
    fields.acceptCommercial = fd.get("acceptCommercial") === "true";
    fields.acceptWhatsapp = fd.get("acceptWhatsapp") === "true";
    try { fields.utm = JSON.parse(String(fd.get("utm") ?? "{}")); } catch { fields.utm = {}; }
    const file = fd.get("factura");
    const f = file && typeof file !== "string" && file.size > 0 ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || "factura" } : null;
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "0.0.0.0";
    const r = await submit({ fields, file: f, ip });
    if (r.ok && r.documentId && !r.duplicate) after(() => readDocument(r.documentId!).then(() => undefined).catch(() => undefined));
    // resposta neutra: no exposa identificadors interns ni l'estat del lead
    return Response.json(r.ok ? { ok: true, reference: r.submissionId?.slice(0, 8).toUpperCase() } : { ok: false, error: r.error, fieldErrors: r.fieldErrors }, { status: r.ok ? 200 : 400 });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[captació] formulari:", (e as Error).message?.slice(0, 160));
    return Response.json({ ok: false, error: status === 500 ? "No s'ha pogut enviar. Torna-ho a provar o truca'ns." : (e as Error).message }, { status });
  }
}
