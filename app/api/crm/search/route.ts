import { globalSearch } from "@/server/crm";
import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";

/** Cercador global: clients (nom, NIF/CIF, telèfon, correu, població) i subministraments per CUPS. */
export const GET = handler(async (req) => { const sp = new URL(req.url).searchParams; return globalSearch(await requireInternal(), sp.get("q") ?? "", sp.get("limit")); });
