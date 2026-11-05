import { z } from "zod";
import { bulkAssign, commentIncident, commentTask, createIncident, createTask, getIncident, getTask, listIncidents, listTasks, updateIncident, updateTask } from "@/server/work";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";

/** Gestor global de tasques i d'incidències (Fase 7). */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const sp = new URL(req.url).searchParams;
  const raw = Object.fromEntries(sp.entries());
  const r = sp.get("r") ?? "tasks";
  if (r === "tasks") return listTasks(u, raw);
  if (r === "task") return getTask(u, sp.get("id") ?? "");
  if (r === "incidents") return listIncidents(u, raw);
  if (r === "incident") return getIncident(u, sp.get("id") ?? "");
  throw new HttpError(400, "Petició desconeguda");
});

const body = z.object({ action: z.enum(["task_create", "task_update", "task_comment", "task_assign", "incident_create", "incident_update", "incident_comment"]), id: z.string().max(64).optional(), ids: z.array(z.string()).max(200).optional(), assignee: z.string().max(64).optional(), data: z.unknown().optional(), note: z.string().max(2000).optional() });

export const POST = handler(async (req) => {
  const u = await requireInternal();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  switch (b.action) {
    case "task_create": return createTask(u, b.data);
    case "task_update": return updateTask(u, b.id ?? "", b.data);
    case "task_comment": return commentTask(u, b.id ?? "", b.note ?? "");
    case "task_assign": return bulkAssign(u, b.ids ?? [], b.assignee ?? "");
    case "incident_create": return createIncident(u, b.data);
    case "incident_update": return updateIncident(u, b.id ?? "", b.data);
    case "incident_comment": return commentIncident(u, b.id ?? "", b.note ?? "");
  }
});
