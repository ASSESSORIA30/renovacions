import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

/** Plantilles de mapatge d'importació per comercialitzadora. */
export const GET = handler(async () => {
  const u = await requireInternal({ staff: true });
  const { data, error } = await u.sb.from("tariff_import_templates").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return { templates: data ?? [] };
});
const body = z.object({ name: z.string().min(1).max(120), supplierName: z.string().max(120).nullable(), headerRow: z.number().int().min(0).max(50), mapping: z.record(z.string(), z.string()), defaultPowerUnit: z.string().max(20).nullable() });
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Plantilla no vàlida");
  const { data, error } = await u.sb.from("tariff_import_templates").insert({ name: p.data.name, supplier_name: p.data.supplierName, header_row: p.data.headerRow, mapping: p.data.mapping, default_power_unit: p.data.defaultPowerUnit }).select("*").single();
  if (error) throw error;
  return { template: data };
});
