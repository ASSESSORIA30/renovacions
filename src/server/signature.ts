import "server-only";
/**
 * SIGNATURA ELECTRÒNICA · arquitectura d'adaptadors.
 *
 * - Cada proveïdor implementa `SignatureProvider`. L'actiu es tria amb SIGNATURE_PROVIDER.
 * - Sense credencials, la integració queda identificada com a PENDENT: es poden preparar sol·licituds,
 *   però no s'envien ni se simula cap signatura.
 * - Webhooks autenticats: l'URL d'avís porta un testimoni HMAC per sol·licitud (`t`), que el servidor comprova
 *   en temps constant. Després, l'esdeveniment es VERIFICA consultant l'estat a l'API del proveïdor: mai es dona
 *   una signatura per bona només pel contingut de l'avís.
 * - Les credencials només existeixen al servidor (variables d'entorn de Vercel).
 *
 * Adaptador inclòs: Signaturit (API REST v3, https://docs.signaturit.com). Implementat segons la documentació
 * pública; s'ha de validar amb un compte de proves (SIGNATURIT_ENV=sandbox) abans d'usar-lo en producció.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export type ProviderStatus = "enviada" | "oberta" | "signada" | "rebutjada" | "caducada" | "cancellada" | "error";
export interface Signer { name: string; email: string; phone?: string | null }
export interface CreateResult { providerRequestId: string; documentIds: string[] }
export interface RemoteState { status: ProviderStatus; completedAt: string | null; documentIds: string[]; detail: Record<string, unknown> }

export interface SignatureProvider {
  id: string;
  label: string;
  /** Variables d'entorn que falten per poder enviar (buit = configurat). */
  missing(): string[];
  create(p: { pdf: Uint8Array; fileName: string; signers: Signer[]; subject: string; message: string; eventsUrl: string; expireDays: number }): Promise<CreateResult>;
  state(providerRequestId: string): Promise<RemoteState>;
  signedPdf(providerRequestId: string, documentId: string): Promise<Uint8Array>;
  evidence(providerRequestId: string, documentId: string): Promise<Uint8Array>;
  cancel(providerRequestId: string): Promise<void>;
  /** Tipus d'esdeveniment i identificador únic a partir del cos de l'avís (no s'hi confia per decidir l'estat). */
  parseEvent(body: string, contentType: string | null): { type: string; eventId: string; occurredAt: string | null };
}

/* ------------------------------------------------------------------ Signaturit */

const signaturit: SignatureProvider = {
  id: "signaturit",
  label: "Signaturit",
  missing: () => (process.env.SIGNATURIT_API_TOKEN ? [] : ["SIGNATURIT_API_TOKEN"]),
  async create(p) {
    const form = new FormData();
    form.append("files[0]", new Blob([p.pdf as BlobPart], { type: "application/pdf" }), p.fileName);
    p.signers.forEach((s, i) => {
      form.append(`recipients[${i}][name]`, s.name);
      form.append(`recipients[${i}][email]`, s.email);
      if (s.phone) form.append(`recipients[${i}][phone]`, s.phone.replace(/^\+/, ""));
    });
    form.append("subject", p.subject);
    form.append("body", p.message);
    form.append("events_url", p.eventsUrl);
    form.append("delivery_type", "email");
    form.append("expire_time", String(p.expireDays));
    const j = await sigFetch<{ id: string; documents?: { id: string }[] }>("/signatures.json", { method: "POST", body: form });
    if (!j.id) throw new Error("Resposta del proveïdor sense identificador");
    return { providerRequestId: j.id, documentIds: (j.documents ?? []).map((d) => d.id) };
  },
  async state(id) {
    const j = await sigFetch<{ id: string; documents?: { id: string; status: string; events?: { type: string; created_at: string }[] }[] }>(`/signatures/${encodeURIComponent(id)}.json`);
    const docs = j.documents ?? [];
    const st = docs.map((d) => d.status);
    const map = (s: string): ProviderStatus => (s === "completed" ? "signada" : s === "declined" ? "rebutjada" : s === "expired" ? "caducada" : s === "canceled" ? "cancellada" : s === "error" ? "error" : s === "signing" ? "oberta" : "enviada");
    // la sol·licitud només és signada quan TOTS els documents ho estan
    const status: ProviderStatus = docs.length && st.every((s) => s === "completed") ? "signada" : map(st.find((s) => s !== "completed") ?? "ready");
    const completedAt = status === "signada" ? docs.flatMap((d) => d.events ?? []).filter((e) => e.type === "document_completed").map((e) => e.created_at).sort().pop() ?? new Date().toISOString() : null;
    return { status, completedAt, documentIds: docs.map((d) => d.id), detail: { statuses: st } };
  },
  signedPdf: (id, doc) => sigBytes(`/signatures/${encodeURIComponent(id)}/documents/${encodeURIComponent(doc)}/download/signed`),
  evidence: (id, doc) => sigBytes(`/signatures/${encodeURIComponent(id)}/documents/${encodeURIComponent(doc)}/download/audit_trail`),
  async cancel(id) { await sigFetch(`/signatures/${encodeURIComponent(id)}/cancel.json`, { method: "PATCH" }); },
  parseEvent(body, ct) {
    let type = "desconegut", occurredAt: string | null = null;
    try {
      const o = ct?.includes("json") ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
      type = String(o.type ?? o.event ?? "desconegut").slice(0, 60);
      occurredAt = typeof o.created_at === "string" ? o.created_at : null;
    } catch { /* cos no vàlid: només es registra l'empremta */ }
    return { type, occurredAt, eventId: createHash("sha256").update(body).digest("hex") };
  },
};

function sigBase() {
  return process.env.SIGNATURIT_ENV === "production" ? "https://api.signaturit.com/v3" : "https://api.sandbox.signaturit.com/v3";
}
async function sigFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(sigBase() + path, { ...init, headers: { Authorization: `Bearer ${process.env.SIGNATURIT_API_TOKEN}`, ...(init.headers ?? {}) }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`El proveïdor de signatura ha respost ${r.status}`);
  return (await r.json().catch(() => ({}))) as T;
}
async function sigBytes(path: string) {
  const r = await fetch(sigBase() + path, { headers: { Authorization: `Bearer ${process.env.SIGNATURIT_API_TOKEN}` }, cache: "no-store", signal: AbortSignal.timeout(40_000) });
  if (!r.ok) throw new Error(`No s'ha pogut descarregar el document (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

/* ------------------------------------------------------------------ selecció i webhooks */

const PROVIDERS: Record<string, SignatureProvider> = { signaturit };

export function signatureProvider(): SignatureProvider | null {
  const id = (process.env.SIGNATURE_PROVIDER ?? "").trim().toLowerCase();
  return PROVIDERS[id] ?? null;
}
export function providerById(id: string) { return PROVIDERS[id] ?? null; }

/** Estat de la integració per a la interfície (sense revelar cap secret). */
export function signatureStatus() {
  const p = signatureProvider();
  const appUrl = appBaseUrl();
  const missing = p ? [...p.missing(), ...(appUrl ? [] : ["APP_URL"])] : ["SIGNATURE_PROVIDER"];
  return {
    provider: p?.id ?? null,
    label: p?.label ?? null,
    configured: !!p && missing.length === 0,
    missing,
    sandbox: p?.id === "signaturit" ? process.env.SIGNATURIT_ENV !== "production" : null,
    available: Object.values(PROVIDERS).map((x) => ({ id: x.id, label: x.label })),
  };
}

export function appBaseUrl() {
  const u = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return u.replace(/\/$/, "");
}

const hookKey = () => createHash("sha256").update(`crm-signature|${process.env.SIGNATURE_WEBHOOK_SECRET || process.env.SETTINGS_ENCRYPTION_KEY || env.supabaseService}`).digest();
export const webhookToken = (requestId: string) => createHmac("sha256", hookKey()).update(requestId).digest("base64url");
export function verifyWebhookToken(requestId: string, token: string) {
  const a = Buffer.from(webhookToken(requestId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function eventsUrl(providerId: string, requestId: string) {
  return `${appBaseUrl()}/api/signature/webhook/${providerId}?r=${requestId}&t=${webhookToken(requestId)}`;
}
