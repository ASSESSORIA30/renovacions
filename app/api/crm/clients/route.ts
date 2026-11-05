import { checkTaxId, normalizeEmail, normalizePhone } from "@/core/crm";
import { checkDuplicates, clientFacets, createClient, listClients } from "@/server/crm";
import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

export const runtime = "nodejs";

/** GET: llistat paginat al servidor (?q, status, owner, city, province, sector, service, sort, page, size),
 *  ?facets=1 (valors dels filtres) o ?check=1 (duplicats per NIF/CIF, telèfon o correu). */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.facets) return clientFacets(u);
  if (p.check) {
    const tax = checkTaxId(p.taxId);
    return checkDuplicates(u, { taxId: tax.valid ? tax.value : null, phone: normalizePhone(p.phone).value, email: normalizeEmail(p.email).value, excludeId: p.exclude || null });
  }
  return listClients(u, p);
});

export const POST = handler(async (req) => {
  const u = await requireInternal();
  return createClient(u, await req.json().catch(() => null));
});
