import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { canSearchExternal, sipsConnectionTest, sipsMissing, audit } from "@/server/sips";
import { sipsEnv } from "@/server/env";

export const dynamic = "force-dynamic";

/** Estat del buscador per a la interfície. Només booleans: mai credencials. */
export const GET = handler(async () => {
  const u = await requireInternal();
  const e = sipsEnv();
  return {
    available: true,
    configured: !!(e.user && e.pass),
    missing: sipsMissing(),
    credentials: !!(e.user && e.pass),
    external: canSearchExternal(u.profile.role),
    ttlDays: e.ttlDays,
    staff: ["admin", "cap_administrativa", "administrativa"].includes(u.profile.role),
  };
});

/** Prova de connexió real amb el portal (Direcció i Administració). No consulta cap CUPS. */
export const POST = handler(async () => {
  const u = await requireInternal({ staff: true });
  const r = await sipsConnectionTest();
  await audit(u, "connection_test", { code: r.code }, null, r.ok, r.ok ? undefined : r.code);
  return r;
});
