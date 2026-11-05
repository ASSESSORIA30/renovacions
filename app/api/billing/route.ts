import { z } from "zod";
import {
  bankConfirm, bankConfirmHigh, bankOverview, bankSetStatus, bankUpload, createRectification, dashboard, deleteBillingClient, deleteDraft, draftFromStatement, exportXlsx, getInvoice, getSettings, importBillingClients, invoicePdf, invoicesZip,
  issueInvoice, listBillingClients, listInvoices, markHistoricPaid, registerPayment, resolveGap, reviewInvoice, saveBillingClient, saveDraft, saveSettings, sendInvoice, statementsToBill,
} from "@/server/billing";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Facturació pròpia d'Assessoria 3.0.
 * GET ?r=dashboard|invoices|invoice|clients|settings|statements|bank|pdf|zip|xlsx
 * Sessió de l'usuari: la RLS (mòdul «facturacio») decideix què pot veure i fer. Els col·laboradors no hi tenen accés.
 */
export async function GET(req: Request) {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.r === "pdf" || p.r === "zip" || p.r === "xlsx") {
    try {
      const u = await requireInternal();
      const f = p.r === "pdf" ? await invoicePdf(u, p.id ?? "").then((x) => ({ bytes: x.pdf, fileName: x.fileName, type: "application/pdf" }))
        : p.r === "zip" ? await invoicesZip(u, p.ids ?? "").then((x) => ({ ...x, type: "application/zip" }))
        : await exportXlsx(u, p).then((x) => ({ ...x, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      return new Response(f.bytes as BodyInit, { headers: { "content-type": f.type, "content-disposition": `${p.inline ? "inline" : "attachment"}; filename="${f.fileName}"`, "cache-control": "no-store" } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status });
    }
  }
  return get(req);
}

const get = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "dashboard": return dashboard(u, p);
    case "invoices": return listInvoices(u, p);
    case "invoice": return getInvoice(u, p.id ?? "");
    case "clients": return listBillingClients(u, p);
    case "settings": return getSettings(u);
    case "statements": return statementsToBill(u);
    case "bank": return bankOverview(u, p);
    default: throw new HttpError(400, "Petició no vàlida");
  }
});

const body = z.object({
  action: z.enum(["draft_save", "draft_delete", "issue", "payment", "historic_paid", "rectify", "review", "send", "client_save", "client_delete", "clients_import", "settings_save", "gap_resolve", "from_statement", "bank_upload", "bank_confirm", "bank_confirm_high", "bank_status"]),
  id: z.string().uuid().optional(),
  data: z.unknown().optional(),
});
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  const id = () => { if (!b.id) throw new HttpError(400, "Falta l'identificador"); return b.id; };
  switch (b.action) {
    case "draft_save": return saveDraft(u, b.data, b.id);
    case "draft_delete": return deleteDraft(u, id());
    case "issue": return issueInvoice(u, id(), b.data);
    case "payment": return registerPayment(u, id(), b.data);
    case "historic_paid": return markHistoricPaid(u, b.data);
    case "rectify": return createRectification(u, id(), b.data);
    case "review": return reviewInvoice(u, id(), b.data);
    case "send": return sendInvoice(u, id(), b.data);
    case "client_save": return saveBillingClient(u, b.data, b.id);
    case "client_delete": return deleteBillingClient(u, id());
    case "clients_import": return importBillingClients(u, b.data);
    case "settings_save": return saveSettings(u, b.data);
    case "gap_resolve": return resolveGap(u, b.data);
    case "from_statement": return draftFromStatement(u, b.data);
    case "bank_upload": return bankUpload(u, b.data);
    case "bank_confirm": return bankConfirm(u, b.data);
    case "bank_confirm_high": return bankConfirmHigh(u);
    case "bank_status": return bankSetStatus(u, b.data);
  }
});
