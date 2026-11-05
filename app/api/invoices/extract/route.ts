import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { extractInvoice, invoiceAiEnabled } from "@/server/invoices";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";
export const maxDuration = 120;

export const GET = handler(async () => {
  await requireInternal();
  return { ai: invoiceAiEnabled(), maxBytes: 10 * 1024 * 1024 };
});

/** Llegeix una factura ja pujada al bucket privat de l'usuari (`<uid>/<fitxer>`). */
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const b = (await req.json().catch(() => ({}))) as { path?: string; fileName?: string };
  if (!b.path) throw new HttpError(400, "Falta el fitxer");
  return await extractInvoice(u.user.id, b.path, b.fileName ?? "factura");
});
