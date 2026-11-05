import { z } from "zod";
import { agenda, convertLead, createSalesTask, getLead, getOpportunity, jornada, leadAction, leadMatches, listLeads, listNotifications, listOpportunities, oppAction, performance, readNotifications, salesActivity, setTarget } from "@/server/sales";
import { maybeRunAutomations } from "@/server/automations";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CRM comercial (Fase 2). GET ?r=leads|lead|opps|opp|jornada|agenda|kpis|notifications|matches
 * Tot es llegeix amb la sessió de l'usuari: la RLS decideix què pot veure.
 */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "leads": return listLeads(u, p);
    case "lead": return getLead(u, p.id ?? "");
    case "matches": return leadMatches(u, p.id ?? "");
    case "opps": return listOpportunities(u, p);
    case "opp": return getOpportunity(u, p.id ?? "");
    case "jornada": {
      await maybeRunAutomations(); // avisos frescos (com a màxim cada 30 minuts)
      return jornada(u);
    }
    case "agenda": {
      const ok = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).safeParse(p);
      if (!ok.success) throw new HttpError(400, "Període no vàlid");
      return agenda(u, ok.data.from, ok.data.to, p.user || null);
    }
    case "kpis": {
      const ok = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}/) }).safeParse(p);
      if (!ok.success) throw new HttpError(400, "Període no vàlid");
      return performance(u, ok.data.from, ok.data.to);
    }
    case "notifications": return listNotifications(u);
    default: throw new HttpError(400, "Petició no vàlida");
  }
});

const uuid = z.string().uuid();
const body = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("lead"), action: z.enum(["create", "update", "assign", "discard", "reopen", "convert"]), id: uuid.optional(), data: z.unknown().optional(), ownerId: uuid.nullable().optional(), reason: z.string().max(300).nullable().optional(), clientId: uuid.nullable().optional() }),
  z.object({ entity: z.literal("opp"), action: z.enum(["create", "update", "move", "assign", "link", "register_sent"]), id: uuid.optional(), data: z.unknown().optional(), ownerId: uuid.nullable().optional(), comparisonId: uuid.nullable().optional(), contractId: uuid.nullable().optional(), channel: z.enum(["email", "whatsapp", "presencial"]).nullable().optional(), note: z.string().max(2000).nullable().optional() }),
  z.object({ entity: z.literal("activity"), clientId: uuid.nullable().optional(), leadId: uuid.nullable().optional(), opportunityId: uuid.nullable().optional(), data: z.unknown(), outcome: z.string().max(40).nullable().optional() }),
  z.object({ entity: z.literal("task"), data: z.unknown() }),
  z.object({ entity: z.literal("notifications"), ids: z.union([z.array(uuid).max(200), z.literal("all")]) }),
  z.object({ entity: z.literal("target"), userId: uuid, period: z.string(), metric: z.string(), target: z.number().nullable() }),
  z.object({ entity: z.literal("convert"), leadId: uuid, clientId: uuid.nullable().optional() }),
]);

export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  switch (b.entity) {
    case "lead": return leadAction(u, b);
    case "opp": return oppAction(u, b);
    case "activity": return salesActivity(u, b);
    case "task": return createSalesTask(u, b.data);
    case "notifications": return readNotifications(u, b.ids);
    case "target": return setTarget(u, b);
    case "convert": return convertLead(u, b.leadId, b.clientId ?? null);
  }
});
