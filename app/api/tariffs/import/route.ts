import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { saveVersion } from "@/server/tariffs";
import { checkVersion } from "@/comparator/catalog";
import { offerVersionSchema, type OfferVersion } from "@/comparator/types";

export const maxDuration = 60;

const body = z.object({
  fileName: z.string().max(200),
  supplierName: z.string().max(120).nullable(),
  mapping: z.record(z.string(), z.string()),
  counts: z.record(z.string(), z.number()),
  report: z.array(z.object({ row: z.number(), status: z.string(), errors: z.array(z.string()), warnings: z.array(z.string()) })).max(5000),
  offers: z.array(z.unknown()).max(2000),
  activateComplete: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  /** Lector IA: les tarifes amb dades que falten es desen igualment com a ESBORRANY per completar-les al catàleg. */
  keepIncompleteAsDraft: z.boolean().default(false),
  /** Tarifes que s'han de desar com a esborrany encara que siguin completes (tenen avisos per revisar). */
  keepDraftIds: z.array(z.string().max(80)).max(2000).default([]),
});

/**
 * Confirma una importació revisada. Les tarifes entren com a ESBORRANY; només s'activen les completes i
 * sense avisos si l'administrador ho demana explícitament. Es registra qui ha importat i l'informe.
 */
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Importació no vàlida");
  const b = p.data;
  const run = await u.sb.from("tariff_import_runs").insert({ file_name: b.fileName, supplier_name: b.supplierName, mapping: b.mapping, dry_run: b.dryRun, counts: b.counts, report: b.report, created_by_name: u.profile.name }).select("id").single();
  if (run.error) throw run.error;
  if (b.dryRun) return { runId: run.data.id, saved: 0, activated: 0 };
  let saved = 0, activated = 0, rejected = 0;
  const reasons: string[] = [];
  for (const raw of b.offers) {
    const o = offerVersionSchema.safeParse(raw);
    if (!o.success) { rejected++; continue; }
    const v = o.data as OfferVersion;
    const check = checkVersion(v);
    if (!check.ok && !b.keepIncompleteAsDraft) { rejected++; continue; }
    // Les dades informatives (p. ex. sense data de fi) no impedeixen activar; els avisos sí.
    const activate = b.activateComplete && check.ok && check.warnings.length === 0 && !b.keepDraftIds.includes(v.id);
    try {
      await saveVersion(u, { ...v, status: activate ? "activa" : "esborrany" }, { origin: "excel", importRunId: run.data.id });
    } catch (e) {
      // p. ex. un annex més antic que el del catàleg: no se substitueix, es compta com a rebutjada amb el motiu
      if (e instanceof HttpError && e.status === 409) { rejected++; reasons.push(e.message); continue; }
      throw e;
    }
    saved++;
    if (activate) activated++;
  }
  return { runId: run.data.id, saved, activated, rejected, reasons };
});

export const GET = handler(async () => {
  const u = await requireInternal({ staff: true });
  const { data, error } = await u.sb.from("tariff_import_runs").select("id,file_name,supplier_name,dry_run,counts,created_by_name,created_at").order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return { runs: data ?? [] };
});
