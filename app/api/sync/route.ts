import { integrations } from "@/server/env";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { runGoogleSync } from "@/server/sync";

export const maxDuration = 60;

/** Manual "Sincronizar ahora" (admin or comercial; the job itself uses the service role). */
export const POST = handler(async () => {
  await requireInternal();
  if (!integrations().googleSync) throw new HttpError(400, "La sincronització amb Google no està configurada");
  return runGoogleSync();
});
