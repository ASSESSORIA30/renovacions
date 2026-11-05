import { z } from "zod";
import { auditLog, permissionMatrix, requireInternal, setRolePermission, setSecurity, setUserPermission } from "@/server/permissions";
import { HttpError, handler } from "@/server/supabase";

export const runtime = "nodejs";

/** Rols, permisos per mòdul, seguretat (MFA) i auditoria. Només Direcció (comprovat aquí i per la RLS). */
export const GET = handler(async (req) => {
  const u = await requireInternal({ admin: true });
  const sp = new URL(req.url).searchParams;
  if (sp.get("r") === "audit") return auditLog(u, Object.fromEntries(sp.entries()));
  return permissionMatrix(u);
});

const body = z.object({ action: z.enum(["role", "user", "security"]), data: z.unknown() });
export const POST = handler(async (req) => {
  const u = await requireInternal({ admin: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  if (p.data.action === "role") return setRolePermission(u, p.data.data);
  if (p.data.action === "user") return setUserPermission(u, p.data.data);
  return setSecurity(u, p.data.data);
});
