import { z } from "zod";
import {
  activateExpedient, addIncident, addNote, addReference, cancelSignature, captureTerms, createExpedient, createRenewal, dashboard, generateDocument, getExpedient, listExpedients,
  listRequirementConfig, listTemplates, manualSignature, markGenerated, moveExpedient, prepareSignature, refreshSignature, requirementAction, saveRequirementConfig, saveTemplate,
  sendSignature, setTemplateStatus, updateCommission, updateExpedient,
} from "@/server/contracting";
import { signatureStatus } from "@/server/signature";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Contractació (CRM Fase 3). GET ?r=list|dashboard|exp|templates|requirements|signature
 * Tot es llegeix i s'escriu amb la sessió de l'usuari (RLS).
 */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "list": return listExpedients(u, p);
    case "dashboard": return dashboard(u);
    case "exp": return getExpedient(u, p.id ?? "");
    case "templates": return listTemplates(u);
    case "requirements": return listRequirementConfig(u);
    case "signature": return signatureStatus();
    default: throw new HttpError(400, "Petició no vàlida");
  }
});

const uuid = z.string().uuid();
const body = z.object({
  action: z.enum(["create", "update", "terms", "requirement", "move", "activate", "renewal", "reference", "note", "incident", "commission", "generate", "generated", "sig_prepare", "sig_send", "sig_refresh", "sig_manual", "sig_cancel", "template_save", "template_status", "req_config_save"]),
  id: uuid.optional(),
  data: z.unknown().optional(),
  terms: z.unknown().optional(),
  version: z.number().int().positive().optional(),
  templateId: uuid.optional(),
  generatedId: uuid.optional(),
  requestId: uuid.optional(),
  status: z.string().max(30).optional(),
  reason: z.string().max(500).optional(),
});

export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  const need = <T>(v: T | undefined, what = "Falta l'identificador"): T => { if (v === undefined) throw new HttpError(400, what); return v; };
  switch (b.action) {
    case "create": return createExpedient(u, b.data, b.terms);
    case "update": return updateExpedient(u, need(b.id), b.data, b.version);
    case "terms": return captureTerms(u, need(b.id), b.data);
    case "requirement": return requirementAction(u, need(b.id), b.data);
    case "move": return moveExpedient(u, need(b.id), b.data);
    case "activate": return activateExpedient(u, need(b.id), b.data);
    case "renewal": return createRenewal(u, need(b.id));
    case "reference": return addReference(u, need(b.id), b.data);
    case "note": return addNote(u, need(b.id), b.data);
    case "incident": return addIncident(u, need(b.id), b.data);
    case "commission": return updateCommission(u, need(b.id), b.data);
    case "generate": return generateDocument(u, need(b.id), need(b.templateId, "Tria la plantilla"));
    case "generated": return markGenerated(u, need(b.id), need(b.generatedId), b.status === "anullat" ? "anullat" : "acceptat");
    case "sig_prepare": return prepareSignature(u, need(b.id), b.data);
    case "sig_send": return sendSignature(u, need(b.id), need(b.requestId));
    case "sig_refresh": return refreshSignature(u, need(b.id), need(b.requestId));
    case "sig_manual": return manualSignature(u, need(b.id), b.data);
    case "sig_cancel": return cancelSignature(u, need(b.id), need(b.requestId), b.reason ?? "");
    case "template_save": return saveTemplate(u, b.data, b.id);
    case "template_status": return setTemplateStatus(u, need(b.id), (["autoritzada", "retirada", "esborrany"].includes(b.status ?? "") ? b.status : "esborrany") as "autoritzada");
    case "req_config_save": return saveRequirementConfig(u, b.data, b.id);
  }
});
