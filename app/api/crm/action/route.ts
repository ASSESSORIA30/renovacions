import { z } from "zod";
import { activityAction, assignmentAction, bulkAction, contactAction, contractAction, incidentAction, supplyAction, taskAction } from "@/server/crm";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";

const uuid = z.string().uuid();
const body = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("contact"), action: z.enum(["create", "update", "delete"]), clientId: uuid, id: uuid.optional(), data: z.unknown().optional() }),
  z.object({ entity: z.literal("supply"), action: z.enum(["create", "update", "archive", "restore"]), clientId: uuid, id: uuid.optional(), data: z.unknown().optional() }),
  z.object({ entity: z.literal("contract"), action: z.enum(["create", "update", "renew", "finance"]), clientId: uuid, id: uuid.optional(), data: z.unknown().optional() }),
  z.object({ entity: z.literal("activity"), action: z.enum(["create", "update"]), clientId: uuid, id: uuid.optional(), data: z.unknown().optional() }),
  z.object({ entity: z.literal("task"), action: z.enum(["create", "complete", "reopen", "cancel"]), clientId: uuid.nullable().optional(), id: uuid.optional(), data: z.unknown().optional() }),
  z.object({ entity: z.literal("incident"), action: z.enum(["create", "update"]), clientId: uuid, id: uuid.optional(), data: z.unknown().optional() }),
  z.object({ entity: z.literal("assignment"), action: z.enum(["add", "remove"]), clientId: uuid, userId: uuid, role: z.enum(["comercial", "suport", "colaborador"]).optional() }),
  z.object({ entity: z.literal("bulk"), action: z.enum(["assign", "status", "archive"]), ids: z.array(uuid).min(1).max(500), value: z.string().max(60).nullable().optional() }),
]);

/** Accions del CRM. Totes passen per la RLS de l'usuari (vegeu src/server/crm.ts). */
export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  const needsId = (b.entity !== "bulk" && b.entity !== "assignment" && !["create"].includes(b.action)) || (b.entity === "contract" && b.action === "renew");
  if (needsId && !("id" in b && b.id)) throw new HttpError(400, "Falta l'identificador");
  switch (b.entity) {
    case "contact": return contactAction(u, b);
    case "supply": return supplyAction(u, b);
    case "contract": return contractAction(u, b);
    case "activity": return activityAction(u, b);
    case "task": return taskAction(u, b);
    case "incident": return incidentAction(u, b);
    case "assignment": return assignmentAction(u, b);
    case "bulk": return bulkAction(u, b);
  }
});
