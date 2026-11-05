import { myTasks } from "@/server/crm";
import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";

/** Tasques pendents del CRM assignades a l'usuari. */
export const GET = handler(async () => myTasks(await requireInternal()));
