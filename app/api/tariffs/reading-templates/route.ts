import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { aiSuggestRules, createTemplate, decideRule, duplicateTemplate, getTemplate, learnRule, listRules, listTemplates, markImported, previousRead, recordRead, restoreVersion, saveVersion, setActive, verifyTemplate } from "@/server/tariff-templates";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Plantilles de lectura IA per comercialitzadora (Fase 11, migració 023; Fase 12, migració 024). Només administració;
 * verificar i aprovar regles, Direcció.
 * GET  ?r=list[&retailer=&supplier=&defs=1] | get&id=[&version=] | previous&id= | rules[&id=&supplier=]
 * POST { action: create | version | verify | active | duplicate | restore | read | imported | learn | decideRule | aiSuggest, data }
 */
export const GET = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.r === "get") return getTemplate(u, p);
  if (p.r === "previous") return previousRead(u, p);
  if (p.r === "rules") return listRules(u, p);
  return listTemplates(u, p);
});

const body = z.object({ action: z.enum(["create", "version", "verify", "active", "duplicate", "restore", "read", "imported", "learn", "decideRule", "aiSuggest"]), data: z.unknown() });
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) throw new HttpError(400, "Petició no vàlida");
  const d = b.data.data;
  switch (b.data.action) {
    case "create": return createTemplate(u, d);
    case "version": return saveVersion(u, d);
    case "verify": return verifyTemplate(u, d);
    case "active": return setActive(u, d);
    case "duplicate": return duplicateTemplate(u, d);
    case "restore": return restoreVersion(u, d);
    case "read": return recordRead(u, d);
    case "imported": return markImported(u, d);
    case "learn": return learnRule(u, d);
    case "decideRule": return decideRule(u, d);
    case "aiSuggest": return aiSuggestRules(u, d);
  }
});
