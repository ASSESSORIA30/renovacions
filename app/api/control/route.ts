import { z } from "zod";
import { alertsAction, alertsCenter } from "@/server/alerts";
import { capPanel, commercialPanel, controlCenter, getLayout, myDay, productivityReport, qualityReport, resetLayout, reviewQuality, reviewQualityBulk, saveLayout } from "@/server/control";
import { HttpError, handler, requireUser } from "@/server/supabase";
import { requireInternal, sessionInfo } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Centre de Control i panells per rol (Fase 7). Tot amb la sessió de l'usuari (RLS) i comprovació de permisos. */
export const GET = handler(async (req) => {
  const sp = new URL(req.url).searchParams;
  const r = sp.get("r") ?? "control";
  const raw = Object.fromEntries(sp.entries());
  // la sessió la pot consultar qualsevol usuari (també un col·laborador, per redirigir-lo al portal)
  if (r === "session") return sessionInfo(await requireUser());
  const u = await requireInternal();
  switch (r) {
    case "control": return controlCenter(u, raw);
    case "cap": return capPanel(u);
    case "jornada": return myDay(u);
    case "comercial": return commercialPanel(u);
    case "productivitat": return productivityReport(u, raw);
    case "qualitat": return qualityReport(u);
    case "alertes": return alertsCenter(u);
    case "layout": return getLayout(u, sp.get("scope") ?? "control");
    default: throw new HttpError(400, "Petició desconeguda");
  }
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("layout_save"), layout: z.unknown(), scope: z.string().max(30).optional() }),
  z.object({ action: z.literal("layout_reset"), template: z.string().max(40), scope: z.string().max(30).optional() }),
  z.object({ action: z.literal("quality_review"), data: z.unknown() }),
  z.object({ action: z.literal("quality_review_bulk"), data: z.unknown() }),
  z.object({ action: z.literal("alerts"), op: z.enum(["run", "retry_capture"]) }),
]);

export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  if (b.action === "layout_save") return saveLayout(u, b.layout, b.scope);
  if (b.action === "layout_reset") return resetLayout(u, b.template, b.scope);
  if (b.action === "quality_review") return reviewQuality(u, b.data);
  if (b.action === "quality_review_bulk") return reviewQualityBulk(u, b.data);
  return alertsAction(u, b.op);
});
