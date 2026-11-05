import { z } from "zod";
import {
  acceptOpportunity, analyseClient, clientContactPrefs, dashboard, listOpportunities, decideDraft, draftPdfUrl, getSettings, opportunityDetail, prepareProposal, runIntelligence, saveSetting, sendDraft, setStatus,
} from "@/server/intelligence";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Intel·ligència IA (CRM Fase 5).
 * GET  ?r=dashboard|list|opportunity|settings|pdf
 * POST action=run|analyse|status|accept|prepare|draft|send|setting|contact
 * Lectures amb la sessió de l'usuari (RLS). El motor complet només el pot llançar l'equip d'administració.
 */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "dashboard": return dashboard(u, p);
    case "list": return listOpportunities(u, p);
    case "opportunity": return opportunityDetail(u, z.string().uuid().parse(p.id));
    case "settings": return getSettings(u);
    case "pdf": return draftPdfUrl(u, z.string().uuid().parse(p.id));
    default: throw new HttpError(400, "Consulta desconeguda");
  }
});

const id = z.string().uuid();
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const b = (await req.json()) as Record<string, unknown>;
  switch (b.action) {
    case "run":
      if (!["admin", "cap_administrativa", "administrativa"].includes(u.profile.role)) throw new HttpError(403, "Només l'equip d'administració pot llançar l'anàlisi completa");
      return runIntelligence("manual", { userId: u.user.id });
    case "analyse": return analyseClient(u, id.parse(b.clientId));
    case "status": return setStatus(u, id.parse(b.id), z.enum(["revisada", "descartada", "nova"]).parse(b.status), typeof b.reason === "string" ? b.reason : null);
    case "accept": return acceptOpportunity(u, id.parse(b.id));
    case "prepare": { const r = await prepareProposal(u, id.parse(b.id)); return { draftId: r.draftId, documentId: r.documentId, comparisonId: r.comparisonId, reference: r.reference }; }
    case "draft": return decideDraft(u, id.parse(b.id), z.enum(["aprova", "anulla", "acceptada", "rebutjada"]).parse(b.decision));
    case "send": return sendDraft(u, id.parse(b.id), z.object({ to: z.string().max(200), subject: z.string().min(1).max(300), body: z.string().max(20000), confirmed: z.boolean() }).parse(b));
    case "setting": return saveSetting(u, z.object({ key: z.string().max(40), enabled: z.boolean().optional(), params: z.unknown().optional() }).parse(b));
    case "contact": return clientContactPrefs(u, id.parse(b.clientId), z.object({ optOut: z.boolean(), preference: z.string() }).parse(b));
    default: throw new HttpError(400, "Acció desconeguda");
  }
});
