import { z } from "zod";
import { confirmAction, conversationMessages, conversations, copilotChat, usageSummary } from "@/server/copilot";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Copilot IA. GET ?r=conversations|messages|usage · POST {action: "chat"|"confirm"}. Claus i model només al servidor. */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.r === "conversations") return conversations(u);
  if (p.r === "messages") return conversationMessages(u, z.string().uuid().parse(p.id));
  if (p.r === "usage") return usageSummary(u);
  throw new HttpError(400, "Consulta desconeguda");
});

export const POST = handler(async (req) => {
  const u = await requireInternal();
  const b = (await req.json()) as Record<string, unknown>;
  if (b.action === "confirm") return confirmAction(u, z.object({ id: z.string().uuid(), token: z.string().min(10).max(100), decision: z.enum(["confirmar", "rebutjar"]) }).parse(b));
  return copilotChat(u, b);
});
