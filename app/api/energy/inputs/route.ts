import { handler, adminClient, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { assertCupsAccess } from "@/server/sips";
import { isValidCups } from "@/core/sips";
import { cupsBase } from "@/energy/lib/sips-record";

export const dynamic = "force-dynamic";

const nums = (a: unknown, len: number) =>
  Array.isArray(a) && a.length <= len && a.every((x) => x === null || (typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 1e9));

/**
 * Dades energètiques introduïdes manualment (de factures): kWh per període i maxímetres per període.
 * Mai les sobreescriu el SIPS. Taula `energy_inputs` (RLS sense polítiques: només servidor).
 */
export const GET = handler(async (req) => {
  const u = await requireInternal();
  const base = cupsBase(new URL(req.url).searchParams.get("cups"));
  if (!isValidCups(base)) throw new HttpError(400, "CUPS no vàlid.");
  await assertCupsAccess(u, base);
  const { data, error } = await adminClient().from("energy_inputs").select("*").eq("cups", base).maybeSingle();
  if (error && /does not exist|schema cache/i.test(error.message)) return { inputs: null, missingTable: true };
  if (error) throw error;
  return { inputs: data };
});

export const PUT = handler(async (req) => {
  const u = await requireInternal();
  const b = (await req.json().catch(() => ({}))) as { cups?: string; invoiceKwh?: unknown; invoiceSource?: string; periodMax?: unknown };
  const base = cupsBase(b.cups);
  if (!isValidCups(base)) throw new HttpError(400, "CUPS no vàlid.");
  await assertCupsAccess(u, base);
  const patch: Record<string, unknown> = { cups: base, updated_at: new Date().toISOString(), updated_by: u.user.id, updated_by_name: u.profile.name };
  if (b.invoiceKwh !== undefined) {
    if (b.invoiceKwh !== null && !nums(b.invoiceKwh, 6)) throw new HttpError(400, "Consums per període no vàlids.");
    patch.invoice_kwh = b.invoiceKwh;
    patch.invoice_source = b.invoiceSource ? String(b.invoiceSource).slice(0, 200) : null;
  }
  if (b.periodMax !== undefined) {
    if (b.periodMax !== null && !(Array.isArray(b.periodMax) && b.periodMax.length === 12 && b.periodMax.every((m) => nums(m, 6)))) throw new HttpError(400, "Maxímetres no vàlids.");
    patch.period_max = b.periodMax;
  }
  const { error } = await adminClient().from("energy_inputs").upsert(patch, { onConflict: "cups" });
  if (error) throw new HttpError(500, /does not exist|schema cache/i.test(error.message) ? "Falta la taula energy_inputs: executa la migració 005." : error.message);
  return { ok: true };
});
