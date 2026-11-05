import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { applyProviderState } from "@/server/contracting";
import { providerById, verifyWebhookToken } from "@/server/signature";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Avisos del proveïdor de signatura electrònica.
 * 1. Autenticació: testimoni HMAC per sol·licitud a l'URL (comparació en temps constant). Sense testimoni vàlid → 401.
 * 2. Idempotència: cada avís es registra una sola vegada (empremta del cos).
 * 3. Verificació: l'estat es consulta SEMPRE a l'API del proveïdor; el contingut de l'avís no decideix res.
 * No es registren dades personals ni el cos complet de l'avís.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const requestId = url.searchParams.get("r") ?? "";
  const token = url.searchParams.get("t") ?? "";
  const p = providerById(provider);
  if (!p || !/^[0-9a-f-]{36}$/i.test(requestId) || !token || !verifyWebhookToken(requestId, token)) {
    return NextResponse.json({ error: "No autoritzat" }, { status: 401 });
  }
  const raw = (await req.text()).slice(0, 200_000);
  const ev = p.parseEvent(raw, req.headers.get("content-type"));
  try {
    const r = await applyProviderState(requestId, ev, createHash("sha256").update(raw).digest("hex"));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[signatura] webhook:", String(e instanceof Error ? e.message : e).slice(0, 160));
    return NextResponse.json({ error: "No s'ha pogut processar" }, { status: 500 });   // el proveïdor reintentarà
  }
}
