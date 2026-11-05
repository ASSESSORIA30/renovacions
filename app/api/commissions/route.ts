import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

/** Comissions i marges per producte. Només administradors (RLS + comprovació). Mai surten al PDF ni al rànquing. */
export const GET = handler(async () => {
  const u = await requireInternal({ admin: true });
  const { data, error } = await u.sb.from("offer_commissions").select("*");
  if (error) throw error;
  return { rows: data ?? [] };
});
const body = z.object({ productId: z.string().uuid(), companyEurMwh: z.number().min(0).nullable(), companyFixedEur: z.number().min(0).nullable(), salespersonPct: z.number().min(0).max(100).nullable(), notes: z.string().max(500).nullable() });
export const POST = handler(async (req) => {
  const u = await requireInternal({ admin: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Dades no vàlides");
  const b = p.data;
  const { error } = await u.sb.from("offer_commissions").upsert({ product_id: b.productId, company_eur_mwh: b.companyEurMwh, company_fixed_eur: b.companyFixedEur, salesperson_pct: b.salespersonPct, notes: b.notes, updated_by: u.user.id, updated_at: new Date().toISOString() });
  if (error) throw error;
  return { ok: true };
});
