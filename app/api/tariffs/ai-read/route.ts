import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { finStaff, requireInternal } from "@/server/permissions";
import { stripNufriCommissions } from "@/comparator/nufri-reader";
import { readTariffFile } from "@/server/tariff-ai";
import { env } from "@/server/env";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";
export const maxDuration = 300;

const body = z.object({
  path: z.string().max(300).optional(),
  text: z.string().max(200_000).optional(),
  fileName: z.string().min(1).max(200),
  supplierHint: z.string().max(120).nullable().optional(),
});

export const GET = handler(async () => {
  await requireInternal({ staff: true });
  return { ai: !!env.anthropicKey };
});

/** Llegeix amb IA el fitxer de tarifes d'una comercialitzadora. No desa res: retorna una proposta per revisar. */
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success || (!p.data.path && p.data.text == null)) throw new HttpError(400, "Petició no vàlida");
  const r = await readTariffFile(u.user.id, p.data);
  // les comissions de l'annex de Nufri només les veu Direcció o l'Administració autoritzada (permís «economia»)
  if ("nufri" in r && r.nufri && !(await finStaff(u))) return { ...r, nufri: stripNufriCommissions(r.nufri) };
  return r;
});
