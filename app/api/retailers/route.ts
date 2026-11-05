import { z } from "zod";
import {
  activateDocument, addManualTerm, deleteRetailer, retailerDependencies, retailerOptions, setRetailerStatus, aiPolicy, analyzeDocument, verifyExtraction, aiReaderCheck, applyClawback, documentUrl, editTerm, finalizeUpload, getRetailer, listRetailers,
  requestUpload, retailerAccess, retailerDashboard, reviewTerms, saveRetailer, setAiPolicy, updateDocument,
} from "@/server/retailers";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
// la lectura amb IA d'un contracte llarg pot trigar més d'un minut (cal un pla de Vercel que ho permeti)
export const maxDuration = 300;

/** Comercialitzadores (Fase 8.1). Sessió de l'usuari (RLS) + comprovació de permisos al servidor. */
export const GET = handler(async (req) => {
  const sp = new URL(req.url).searchParams;
  const u = await requireInternal();
  const id = sp.get("id") ?? "";
  switch (sp.get("r") ?? "list") {
    case "list": return listRetailers(u);
    case "get": return getRetailer(u, id);
    case "options": return retailerOptions(u);
    case "deps": return retailerDependencies(u, id);
    case "dashboard": return retailerDashboard(u, Object.fromEntries(sp.entries()));
    case "doc_url": return documentUrl(u, id, sp.get("download") === "1");
    case "ai_policy": if (!(await retailerAccess(u))) throw new HttpError(403, "Sense accés"); return aiPolicy();
    default: throw new HttpError(400, "Petició desconeguda");
  }
});

const body = z.object({
  action: z.enum(["save", "upload_request", "upload_finalize", "analyze", "doc_update", "doc_activate", "review", "term_edit", "term_add", "clawback_apply", "ai_policy", "verify", "ai_check", "set_status", "delete"]),
  id: z.string().uuid().optional(), data: z.unknown(),
});
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const { action, id, data } = p.data;
  const need = () => { if (!id) throw new HttpError(400, "Falta l'identificador"); return id; };
  switch (action) {
    case "save": return saveRetailer(u, data, id);
    case "upload_request": return requestUpload(u, data);
    case "upload_finalize": return finalizeUpload(u, data);
    case "analyze": return analyzeDocument(u, need(), data);
    case "doc_update": return updateDocument(u, need(), data);
    case "doc_activate": return activateDocument(u, need());
    case "review": return reviewTerms(u, data);
    case "term_edit": return editTerm(u, need(), data);
    case "term_add": return addManualTerm(u, data);
    case "clawback_apply": return applyClawback(u, data);
    case "ai_policy": return setAiPolicy(u, data);
    case "set_status": return setRetailerStatus(u, need(), data);
    case "delete": return deleteRetailer(u, need(), data);
    case "verify": return verifyExtraction(u, need());
    case "ai_check": return aiReaderCheck(u, data);
  }
});
