import "server-only";
/**
 * REGULARITZACIÓ HISTÒRICA DE COMISSIONS (migració 059).
 *
 * Revisa TOTS els contractes d'energia sense cap càlcul de comissió (no només els recents) en dues fases:
 *   1. «dry_run» (obligatòria): NO escriu res a l'economia. Classifica cada contracte i en desa el registre:
 *        calculable · pendent_dades · pendent_regla · protegit · conflicte
 *   2. «apply»: només a partir d'una revisió completada. Torna a comprovar cada contracte (protecció i absència de
 *      càlcul) i hi executa el motor existent. Només crea instantànies de càlcul (estimacions): mai moviments,
 *      meritacions, liquidacions, factures ni pagaments. Els protegits i els conflictes no es toquen mai.
 * Tot és paginat (lots petits, cursor per id), idempotent (un contracte que ja té càlcul s'omet) i queda registrat a
 * `fin_regularization_runs` i `fin_regularization_items`. Només Direcció ho pot executar.
 */
import { z } from "zod";
import { isEnergyService, type ContractService } from "@/core/multiservice";
import { runCalculation } from "./finance";
import { contractProtection, resolvePending } from "./commission-auto";
import { finStaff } from "./permissions";
import { adminClient, HttpError } from "./supabase";
import type { U } from "./crm";

type SB = ReturnType<typeof adminClient>;
export const REG_CATEGORIES = ["calculable", "pendent_dades", "pendent_regla", "protegit", "conflicte"] as const;
export type RegCategory = (typeof REG_CATEGORIES)[number];
export const REG_CATEGORY_LABEL: Record<RegCategory, string> = {
  calculable: "Calculable (regla aprovada i dades suficients)", pendent_dades: "Pendent de dades", pendent_regla: "Pendent de regla",
  protegit: "Protegit (liquidacions, cobraments o pagaments)", conflicte: "Conflicte, retrocessió o import històric",
};
const ENERGY: ContractService[] = ["llum_residencial", "llum_empresa", "gas"];

const input = z.object({
  mode: z.enum(["dry_run", "apply"]),
  runId: z.string().uuid().optional(),            // continuar una execució ja començada (pàgina següent)
  dryRunId: z.string().uuid().optional(),         // apply: revisió prèvia completada en què es basa
  after: z.string().uuid().nullable().optional(), // cursor: últim contracte processat
  limit: z.number().int().min(1).max(100).optional(),
});

function regError(e: { code?: string; message?: string } | null): never {
  if (e?.code === "42P01" || e?.code === "PGRST205" || /fin_regularization|fin_calc_pending|schema cache/i.test(e?.message ?? "")) throw new HttpError(409, "Falta aplicar la migració 059_calcul_automatic_comissions.sql a Supabase");
  console.error("[regularitzacio]", e?.code, (e?.message ?? "").slice(0, 200));
  throw new HttpError(500, "No s'ha pogut registrar la regularització");
}

/** Classificació d'un contracte sense escriure res (també la fa servir «apply» per tornar-ho a comprovar). */
export async function classifyContract(sb: SB, actorId: string, contractId: string) {
  const prot = await contractProtection(sb, contractId);
  if (prot.protected.length) return { category: "protegit" as RegCategory, reasons: [...prot.protected, ...prot.conflicts], provider: null };
  if (prot.conflicts.length) return { category: "conflicte" as RegCategory, reasons: prot.conflicts, provider: null };
  const r = await runCalculation(sb, actorId, contractId, { dryRun: true });
  const p = r.results.find((x) => x.layer === "proveidor") ?? null;
  const category: RegCategory = p?.status === "calculat" ? "calculable" : p?.status === "pendent_dades" ? "pendent_dades" : "pendent_regla";
  const reasons = category === "calculable" ? [`Regla: ${p?.rule ?? "?"}`]
    : p?.status === "simulacio" ? [`La regla «${p.rule ?? "?"}» està pendent d'aprovació de Direcció`]
    : [p?.formula || "Sense regla aplicable"];
  if (!r.collaborator) reasons.push("Sense col·laborador (es calcula igualment la comissió del proveïdor)");
  return { category, reasons, provider: p, layers: r.results };
}

export async function regularizeCommissions(u: U, raw: unknown) {
  if (u.profile.role !== "admin" || !(await finStaff(u, "edit"))) throw new HttpError(403, "Només Direcció pot executar la regularització de comissions");
  const p = input.safeParse(raw);
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  const sb = adminClient();
  return b.mode === "dry_run" ? dryRunPage(sb, u, b) : applyPage(sb, u, b);
}

async function openRun(sb: SB, u: U, mode: "dry_run" | "apply", runId: string | undefined, basedOn: string | null) {
  if (runId) {
    const r = await sb.from("fin_regularization_runs").select("*").eq("id", runId).maybeSingle();
    if (r.error) regError(r.error);
    if (!r.data || r.data.mode !== mode) throw new HttpError(404, "Execució no trobada");
    if (r.data.status !== "en_curs") throw new HttpError(409, "Aquesta execució ja està tancada");
    return r.data as { id: string; counts: Record<string, number>; based_on: string | null };
  }
  const ins = await sb.from("fin_regularization_runs").insert({ mode, status: "en_curs", started_by: u.user.id, started_by_name: u.profile.name, based_on: basedOn, counts: {} }).select("*").single();
  if (ins.error) regError(ins.error);
  return ins.data as { id: string; counts: Record<string, number>; based_on: string | null };
}
async function closePage(sb: SB, runId: string, counts: Record<string, number>, cursor: string | null, done: boolean) {
  const up = await sb.from("fin_regularization_runs").update({ counts, cursor, status: done ? "completat" : "en_curs", finished_at: done ? new Date().toISOString() : null }).eq("id", runId);
  if (up.error) regError(up.error);
}
const bump = (c: Record<string, number>, k: string) => { c[k] = (c[k] ?? 0) + 1; };

/** Pàgina de revisió: contractes d'energia per ordre d'id, només els que no tenen cap càlcul (o el tenen pendent per error). */
async function dryRunPage(sb: SB, u: U, b: z.infer<typeof input>) {
  const run = await openRun(sb, u, "dry_run", b.runId, null);
  const limit = b.limit ?? 50;
  let q = sb.from("crm_contracts").select("id,service").in("service", ENERGY).order("id").limit(limit);
  if (b.after) q = q.gt("id", b.after);
  const page = await q;
  if (page.error) regError(page.error);
  const ids = ((page.data ?? []) as { id: string; service: string }[]).filter((k) => isEnergyService(k.service as ContractService)).map((k) => k.id);
  const [calcs, pend] = ids.length ? await Promise.all([
    sb.from("fin_calculations").select("contract_id").in("contract_id", ids),
    sb.from("fin_calc_pending").select("contract_id,status").in("contract_id", ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (calcs.error) regError(calcs.error);
  if (pend.error) regError(pend.error);
  const withCalc = new Set(((calcs.data ?? []) as { contract_id: string }[]).map((c) => c.contract_id));
  const failed = new Set(((pend.data ?? []) as { contract_id: string; status: string }[]).filter((x) => x.status === "error").map((x) => x.contract_id));
  const counts = { ...run.counts };
  const items: { contract_id: string; category: RegCategory; reasons: string[]; provider_status: string | null; provider_amount: string | null }[] = [];
  for (const id of ids) {
    bump(counts, "revisats");
    if (withCalc.has(id) && !failed.has(id)) { bump(counts, "ja_calculats"); continue; }
    let c: Awaited<ReturnType<typeof classifyContract>>;
    try { c = await classifyContract(sb, u.user.id, id); }
    catch (e) { c = { category: "conflicte", reasons: [`Error en revisar: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)], provider: null }; }
    bump(counts, c.category);
    items.push({ contract_id: id, category: c.category, reasons: c.reasons, provider_status: c.provider?.status ?? null, provider_amount: c.provider?.amount ?? null });
  }
  if (items.length) {
    const ins = await sb.from("fin_regularization_items").upsert(items.map((i) => ({ run_id: run.id, ...i, action: "revisat" })), { onConflict: "run_id,contract_id" });
    if (ins.error) regError(ins.error);
  }
  const last = ids.length ? ids[ids.length - 1] : (page.data?.length ? (page.data[page.data.length - 1] as { id: string }).id : null);
  const done = (page.data?.length ?? 0) < limit;
  await closePage(sb, run.id, counts, last, done);
  return { runId: run.id, mode: "dry_run", done, nextCursor: done ? null : last, counts, items };
}

/** Pàgina d'aplicació: només els contractes que la revisió prèvia ha classificat com a calculables o pendents. */
async function applyPage(sb: SB, u: U, b: z.infer<typeof input>) {
  if (!b.dryRunId && !b.runId) throw new HttpError(400, "Primer cal fer la revisió en mode simulació (dry-run) i indicar-la");
  let dryRunId = b.dryRunId ?? null;
  if (b.runId && !dryRunId) dryRunId = ((await sb.from("fin_regularization_runs").select("based_on").eq("id", b.runId).maybeSingle()).data as { based_on: string | null } | null)?.based_on ?? null;
  const dr = await sb.from("fin_regularization_runs").select("id,mode,status,finished_at").eq("id", dryRunId ?? "").maybeSingle();
  if (dr.error) regError(dr.error);
  const d = dr.data as { mode: string; status: string; finished_at: string | null } | null;
  if (!d || d.mode !== "dry_run" || d.status !== "completat") throw new HttpError(409, "Cal una revisió en mode simulació COMPLETADA abans d'aplicar la regularització");
  if (d.finished_at && Date.now() - new Date(d.finished_at).getTime() > 7 * 86_400_000) throw new HttpError(409, "La revisió té més de 7 dies: torna-la a fer abans d'aplicar");
  const run = await openRun(sb, u, "apply", b.runId, dryRunId);
  if (run.based_on !== dryRunId) throw new HttpError(409, "Aquesta aplicació es basa en una altra revisió");
  const limit = b.limit ?? 25;
  let q = sb.from("fin_regularization_items").select("contract_id,category").eq("run_id", dryRunId!).in("category", ["calculable", "pendent_dades", "pendent_regla"]).order("contract_id").limit(limit);
  if (b.after) q = q.gt("contract_id", b.after);
  const page = await q;
  if (page.error) regError(page.error);
  const rows = (page.data ?? []) as { contract_id: string; category: RegCategory }[];
  const counts = { ...run.counts };
  const items: Record<string, unknown>[] = [];
  for (const r of rows) {
    bump(counts, "revisats");
    let action: string, category: RegCategory = r.category, reasons: string[] = [], status: string | null = null, amount: string | null = null;
    try {
      // idempotència i seguretat: es torna a comprovar TOT just abans d'escriure
      const has = await sb.from("fin_calculations").select("id").eq("contract_id", r.contract_id).limit(1);
      const pend = (await sb.from("fin_calc_pending").select("status").eq("contract_id", r.contract_id).maybeSingle()).data as { status: string } | null;
      if (has.data?.length && pend?.status !== "error") { action = "omes_ja_calculat"; reasons = ["Ja té càlcul"]; }
      else {
        const c = await classifyContract(sb, u.user.id, r.contract_id);
        category = c.category; reasons = c.reasons;
        if (c.category === "protegit" || c.category === "conflicte") action = "omes_protegit";
        else {
          const res = await runCalculation(sb, u.user.id, r.contract_id);
          await resolvePending(sb, r.contract_id);
          const p = res.results.find((x) => x.layer === "proveidor");
          status = p?.status ?? null; amount = p?.amount ?? null;
          action = p?.status === "calculat" ? "regularitzat" : "marcat_pendent";
        }
      }
    } catch (e) { action = "error"; reasons = [(e instanceof Error ? e.message : String(e)).slice(0, 300)]; }
    bump(counts, action);
    items.push({ run_id: run.id, contract_id: r.contract_id, category, reasons, provider_status: status, provider_amount: amount, action });
  }
  if (items.length) {
    const ins = await sb.from("fin_regularization_items").upsert(items, { onConflict: "run_id,contract_id" });
    if (ins.error) regError(ins.error);
  }
  const last = rows.length ? rows[rows.length - 1].contract_id : null;
  const done = rows.length < limit;
  await closePage(sb, run.id, counts, last, done);
  return { runId: run.id, mode: "apply", dryRunId, done, nextCursor: done ? null : last, counts, items };
}

/** Llistat de les execucions i detall d'una (per a la pantalla de Direcció). */
export async function regularizationRuns(u: U, runId?: string) {
  if (u.profile.role !== "admin" || !(await finStaff(u))) throw new HttpError(403, "Només Direcció pot veure la regularització de comissions");
  const sb = adminClient();
  const runs = await sb.from("fin_regularization_runs").select("*").order("started_at", { ascending: false }).limit(20);
  if (runs.error) regError(runs.error);
  if (!runId) return { runs: runs.data ?? [] };
  const items = await sb.from("fin_regularization_items").select("contract_id,category,reasons,provider_status,provider_amount,action,crm_contracts(retailer,product,service,client_id,crm_clients(name))").eq("run_id", runId).order("category").limit(2000);
  if (items.error) regError(items.error);
  return { runs: runs.data ?? [], items: items.data ?? [] };
}
