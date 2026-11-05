import { handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { saveComparison } from "@/server/comparisons";

export const dynamic = "force-dynamic";

/** Llista de comparatives visibles (RLS: pròpies, de l'equip o de contractes visibles). */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const url = new URL(req.url);
  let q = u.sb.from("comparisons").select("id,contract_id,cups,client_name,mode,status,created_at,issued_at,created_by_name,snapshot->result->ranked->0->offer->>supplierName,snapshot->result->ranked->0->saving").order("created_at", { ascending: false }).limit(Math.min(200, Number(url.searchParams.get("limit")) || 100));
  const contract = url.searchParams.get("contract");
  if (contract) q = q.eq("contract_id", contract);
  const { data, error } = await q;
  if (error) throw error;
  return { rows: data ?? [] };
});

/** Desa (esborrany) o emet una comparativa. El servidor recalcula el resultat amb el mateix motor. */
export const POST = handler(async (req) => {
  const u = await requireInternal();
  return { comparison: await saveComparison(u, await req.json().catch(() => null)) };
});
