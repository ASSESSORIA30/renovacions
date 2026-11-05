import { z } from "zod";
import { runAutomations } from "@/server/automations";
import { auditEvent } from "@/server/crm";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Regles d'automatització: les veu l'equip d'administració; les modifica i executa Direcció. */
export const GET = handler(async () => {
  const u = await requireInternal({ staff: true });
  const [rules, runs] = await Promise.all([
    u.sb.from("crm_automation_rules").select("*").order("key"),
    u.sb.from("crm_automation_runs").select("*").order("started_at", { ascending: false }).limit(15),
  ]);
  if (rules.error) throw new HttpError(409, "Falta aplicar la migració 009_crm_comercial.sql");
  return { rules: rules.data ?? [], runs: runs.data ?? [], canEdit: u.profile.role === "admin" };
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), key: z.string().max(60), enabled: z.boolean(), params: z.record(z.string(), z.union([z.number().min(0).max(3650), z.array(z.number().min(1).max(3650)).max(6)])) }),
  z.object({ action: z.literal("run") }),
]);

export const POST = handler(async (req) => {
  const u = await requireInternal({ admin: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  if (p.data.action === "run") return runAutomations("manual");
  const { data, error } = await u.sb.from("crm_automation_rules").update({ enabled: p.data.enabled, params: p.data.params, updated_by: u.user.id, updated_at: new Date().toISOString() }).eq("key", p.data.key).select("key");
  if (error || !data?.length) throw new HttpError(403, "No s'ha pogut desar la regla");
  await auditEvent(u, { entity: "automations", entityId: p.data.key, action: "configuracio", detail: { enabled: p.data.enabled, params: p.data.params } });
  return { ok: true };
});
