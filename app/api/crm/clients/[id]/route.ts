import { getClient, updateClient } from "@/server/crm";
import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";
const idOf = (req: Request) => decodeURIComponent(new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "");

/** Fitxa completa del client (només el que la RLS permet veure a l'usuari). */
export const GET = handler(async (req) => getClient(await requireInternal(), idOf(req)));

export const PATCH = handler(async (req) => updateClient(await requireInternal(), idOf(req), await req.json().catch(() => null)));
