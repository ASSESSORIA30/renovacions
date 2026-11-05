import { z } from "zod";
import { leadDocumentUrl, preliminaryProposal, processPendingCapture, reviewReading, withdrawConsent } from "@/server/capture";
import { assignManual, captureDashboard, captureLead, importCosts, integrationStatus, listRules, saveCampaign, saveRule, sendWhatsapp, setDuplicateStatus, syncGoogleAdsCosts } from "@/server/marketing";
import { addLink, createPartner, decideAttribution, listPartners, setLinkActive, updatePartner } from "@/server/partners";
import {
  addException, approveRule, editPartner, bulkPartners, commissionOverview, commissionProfile, confirmImport, enableAccounts, exportPartners, getLevels, grantPortalAccess, listImports,
  previewImport, retireRule, saveLevels, setGeneral, setManager, undoImport,
} from "@/server/collaborators";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Captació i màrqueting (intern).
 * GET  ?r=dashboard|lead|partners|rules|integrations|doc|collab_overview|collab_profile|collab_levels|collab_imports|collab_export
 * POST action=review|collab_preview|collab_import|collab_undo|collab_enable|collab_portal|collab_general|collab_exception|collab_retire|collab_approve|collab_levels|collab_bulk|collab_manager|preliminary|assign|duplicate|attribution|partner_create|partner_update|link_add|link_toggle|campaign_save|costs_import|rule_save|wa_send|consent_withdraw|reprocess|google_sync
 */
const id = z.string().uuid();
export async function GET(req: Request) {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.r === "collab_export") {
    try {
      const f = await exportPartners(await requireInternal(), p.ids ?? "");
      return new Response(f.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${f.fileName}"`, "cache-control": "no-store" } });
    } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status: e instanceof HttpError ? e.status : 500 }); }
  }
  return get(req);
}
const get = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "dashboard": return captureDashboard(u, p);
    case "lead": return captureLead(u, id.parse(p.id));
    case "partners": return listPartners(u);
    case "collab_overview": return commissionOverview(u);
    case "collab_profile": return commissionProfile(u, id.parse(p.id));
    case "collab_levels": return getLevels(u);
    case "collab_imports": return listImports(u);
    case "rules": return listRules(u);
    case "integrations": return integrationStatus();
    case "doc": return leadDocumentUrl(u, id.parse(p.id));
    default: throw new HttpError(400, "Consulta desconeguda");
  }
});

export const POST = handler(async (req) => {
  const u = await requireInternal();
  const b = (await req.json()) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (b.action) {
    case "review": return reviewReading(u, id.parse(b.id), b.patch);
    case "preliminary": return preliminaryProposal(u, id.parse(b.id));
    case "assign": return assignManual(u, id.parse(b.leadId), id.parse(b.userId), s(b.reason));
    case "duplicate": return setDuplicateStatus(u, id.parse(b.leadId), z.enum(["duplicat_confirmat", "revisat_no_duplicat"]).parse(b.status));
    case "attribution": return decideAttribution(u, id.parse(b.id), z.enum(["vigent", "rebutjada"]).parse(b.decision), s(b.reason));
    case "partner_create": return createPartner(u, b.data, new URL(req.url).origin);
    case "partner_update": return updatePartner(u, id.parse(b.id), b.data);
    case "link_add": return addLink(u, id.parse(b.partnerId), { label: s(b.label), channel: b.channel === "qr" ? "qr" : "recomanacio", code: s(b.code) || undefined });
    case "link_toggle": return setLinkActive(u, id.parse(b.id), !!b.active);
    case "collab_preview": return previewImport(u, b.data);
    case "collab_import": return confirmImport(u, b.data);
    case "collab_undo": return undoImport(u, id.parse(b.id));
    case "collab_enable": return enableAccounts(u, b.data);
    case "collab_portal": return grantPortalAccess(u, id.parse(b.id), new URL(req.url).origin);
    case "collab_general": return setGeneral(u, b.data);
    case "collab_exception": return addException(u, b.data);
    case "collab_retire": return retireRule(u, id.parse(b.id));
    case "collab_approve": return approveRule(u, id.parse(b.id));
    case "collab_levels": return saveLevels(u, b.data);
    case "collab_bulk": return bulkPartners(u, b.data);
    case "collab_manager": return setManager(u, b.data);
    case "collab_edit": return editPartner(u, id.parse(b.id), b.data);
    case "campaign_save": return saveCampaign(u, b.data);
    case "costs_import": return importCosts(u, id.parse(b.campaignId), b.rows);
    case "rule_save": return saveRule(u, b.data);
    case "wa_send": return sendWhatsapp(u, b.data);
    case "consent_withdraw": return withdrawConsent(u, id.parse(b.id));
    case "reprocess":
      if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció");
      return processPendingCapture();
    case "google_sync":
      if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció");
      return syncGoogleAdsCosts();
    default: throw new HttpError(400, "Acció desconeguda");
  }
});
