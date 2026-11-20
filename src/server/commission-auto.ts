import "server-only";
/**
 * CÀLCUL AUTOMÀTIC DE COMISSIONS EN DESAR UN CONTRACTE D'ENERGIA (migració 059).
 *
 * Abans, `contractAction` (crm.ts) desava el contracte però no cridava mai el motor de comissions: el càlcul només es
 * feia si algú d'Administració premia «Calcula» a la fitxa econòmica. Ara, després de desar (alta, renovació o edició):
 *   1. es comprova que el contracte no estigui protegit (moviments, liquidacions, cobraments, pagaments o històrics);
 *   2. s'executa el MOTOR EXISTENT (`runCalculation` de finance.ts): proveïdor primer, després comercial i col·laborador;
 *   3. es desa la instantània a `fin_calculations` (idempotent: mateixes dades → mateix registre, sense duplicats).
 *
 * El càlcul el fa el servidor (client de servei) perquè un comercial pot crear contractes però no té permís d'escriure
 * a `fin_calculations`. Els imports surten EXCLUSIVAMENT de les regles aprovades i de les dades desades: l'usuari no en
 * pot enviar cap. Mai es creen moviments (`fin_ledger`), liquidacions, factures ni pagaments.
 *
 * Si el càlcul falla, el contracte queda desat igualment i es registra a `fin_calc_pending` (pendent de càlcul, amb
 * l'error) perquè es pugui reintentar amb seguretat (botó «Calcula» o regularització). L'error no s'amaga.
 */
import { isEnergyService, type ContractService } from "@/core/multiservice";
import { runCalculation, type CalcLayerResult } from "./finance";
import { adminClient } from "./supabase";

type SB = ReturnType<typeof adminClient>;

export type ProtectionCategory = "protegit" | "conflicte";
export interface Protection { protected: string[]; conflicts: string[] }

/**
 * Fonts econòmiques que fan que un contracte NO es pugui calcular automàticament (es revisa a mà):
 *  - protegit: moviments al llibre (meritacions, confirmacions, cobraments…), línies de liquidació, extractes del
 *    proveïdor vinculats, comissió manual/meritada/liquidada/cobrada a `crm_contract_finance` o `crm_commission_records`;
 *  - conflicte: liquidacions històriques importades, retrocessions o anul·lacions, contracte anul·lat o penalitzat, o
 *    servei incoherent amb el tipus d'energia del CUPS.
 */
export async function contractProtection(sb: SB, contractId: string): Promise<Protection> {
  const [k, ledger, slines, stmt, fin, rec, hist, econ] = await Promise.all([
    sb.from("crm_contracts").select("id,service,supply_id,expedient_id").eq("id", contractId).maybeSingle(),
    sb.from("fin_ledger").select("id,kind,settlement_id").eq("contract_id", contractId).limit(200),
    sb.from("fin_settlement_lines").select("id").eq("contract_id", contractId).limit(1),
    sb.from("fin_statement_lines").select("id,match_status").eq("contract_id", contractId).limit(50),
    sb.from("crm_contract_finance").select("commission_eur,commission_paid_at,commission_status,settlement_ref").eq("contract_id", contractId).maybeSingle(),
    sb.from("crm_commission_records").select("accrual_status,payment_status,paid_eur,estimated_eur").eq("contract_id", contractId).limit(20),
    sb.from("fin_hist_lines").select("id,movement_kind").eq("contract_id", contractId).limit(50),
    sb.from("fin_contract_economics").select("econ_status").eq("contract_id", contractId).maybeSingle(),
  ]);
  for (const r of [k, ledger, slines, stmt, fin, rec, hist, econ]) if (r.error) throw new Error(`No s'ha pogut comprovar la protecció econòmica (${r.error.code ?? "?"})`);
  const p: string[] = [], c: string[] = [];
  const L = (ledger.data ?? []) as { kind: string; settlement_id: string | null }[];
  if (L.length) p.push(`Té ${L.length} moviment(s) econòmic(s) registrats (${[...new Set(L.map((l) => l.kind))].join(", ")})`);
  if (L.some((l) => l.settlement_id)) p.push("Inclòs en una liquidació");
  if (slines.data?.length) p.push("Té línies de liquidació");
  if (stmt.data?.length) p.push("Vinculat a un extracte o confirmació del proveïdor");
  const f = fin.data as { commission_eur: number | null; commission_paid_at: string | null; commission_status: string | null; settlement_ref: string | null } | null;
  if (f?.commission_paid_at) p.push("Comissió marcada com a cobrada o pagada");
  if (f?.settlement_ref) p.push("Té referència de liquidació");
  if (f && ["meritada", "liquidada", "cobrada"].includes(f.commission_status ?? "")) p.push(`Comissió en estat «${f.commission_status}»`);
  if (f?.commission_eur != null) p.push("Té un import de comissió informat manualment");
  for (const r of (rec.data ?? []) as { accrual_status: string; payment_status: string; paid_eur: number | null }[]) {
    if (r.accrual_status === "meritada") p.push("Comissió de l'expedient meritada");
    if (["cobrada", "parcial", "impagada"].includes(r.payment_status) || r.paid_eur != null) p.push("Comissió de l'expedient amb cobrament registrat");
  }
  const H = (hist.data ?? []) as { movement_kind: string }[];
  if (H.length) c.push(`Té ${H.length} import(s) de liquidacions històriques del CRM antic`);
  if (H.some((h) => h.movement_kind === "retrocessio")) c.push("Té retrocessions històriques");
  if (L.some((l) => ["retrocessio", "anullacio"].includes(l.kind))) c.push("Té retrocessions o anul·lacions");
  if (f?.commission_status === "retrocedida") c.push("Comissió retrocedida");
  const e = econ.data as { econ_status: string } | null;
  if (e && e.econ_status !== "actiu") c.push(`Contracte ${e.econ_status} econòmicament`);
  const kk = k.data as { service: string | null; supply_id: string | null } | null;
  if (kk?.supply_id) {
    const s = (await sb.from("crm_supplies").select("energy_type").eq("id", kk.supply_id).maybeSingle()).data as { energy_type: string } | null;
    if (s && kk.service && isEnergyService(kk.service as ContractService) && (s.energy_type === "gas") !== (kk.service === "gas"))
      c.push(`Servei del contracte («${kk.service}») incoherent amb el CUPS (${s.energy_type === "gas" ? "gas" : "electricitat"})`);
  }
  return { protected: [...new Set(p)], conflicts: [...new Set(c)] };
}

export type AutoState = "calculat" | "pendent" | "protegit" | "error" | "no_aplica";
export interface AutoCalcOutcome { state: AutoState; message: string; results?: CalcLayerResult[] }

/** Resum llegible del resultat (el motiu concret quan queda pendent; mai un zero inventat). */
export function summarize(results: CalcLayerResult[]): AutoCalcOutcome {
  const prov = results.find((r) => r.layer === "proveidor");
  if (prov?.status === "calculat") return { state: "calculat", message: "Comissió calculada automàticament amb la regla aprovada.", results };
  const why = prov?.status === "simulacio" ? `La regla «${prov.rule ?? "?"}» encara no està aprovada per Direcció (només simulació).` : prov?.formula || "Sense resultat del proveïdor";
  return { state: "pendent", message: `Comissió pendent: ${why}`, results };
}

async function markPending(sb: SB, contractId: string, source: string, error: string) {
  try {
    const cur = (await sb.from("fin_calc_pending").select("attempts").eq("contract_id", contractId).maybeSingle()).data as { attempts: number } | null;
    await sb.from("fin_calc_pending").upsert({ contract_id: contractId, status: "error", source, last_error: error.slice(0, 500), attempts: (cur?.attempts ?? 0) + 1, updated_at: new Date().toISOString() }, { onConflict: "contract_id" });
  } catch (e) { console.error("[comissions] no s'ha pogut registrar el càlcul pendent:", e instanceof Error ? e.message : e); }
}
export async function resolvePending(sb: SB, contractId: string) {
  try { await sb.from("fin_calc_pending").update({ status: "resolt", updated_at: new Date().toISOString() }).eq("contract_id", contractId).neq("status", "resolt"); } catch { /* taula no aplicada encara: res a resoldre */ }
}

/**
 * Càlcul automàtic després de desar un contracte. MAI llança: el contracte ja és desat i el resultat (o l'error) es
 * retorna perquè la interfície el mostri. `actorId` queda com a autor de la instantània.
 */
export async function autoCalculateContract(actorId: string, contractId: string, source: "alta" | "renovacio" | "edicio"): Promise<AutoCalcOutcome> {
  const sb = adminClient();
  try {
    const k = (await sb.from("crm_contracts").select("id,service").eq("id", contractId).maybeSingle()).data as { service: string | null } | null;
    if (!k) return { state: "no_aplica", message: "Contracte no trobat" };
    if (k.service && !isEnergyService(k.service as ContractService)) return { state: "no_aplica", message: "Multiservei: comissió prevista per regles de servei" };
    const prot = await contractProtection(sb, contractId);
    if (prot.protected.length || prot.conflicts.length) {
      return { state: "protegit", message: `No s'ha recalculat automàticament: ${[...prot.protected, ...prot.conflicts].join(" · ")}. Es conserva tal com està.` };
    }
    const r = await runCalculation(sb, actorId, contractId);
    await resolvePending(sb, contractId);
    return summarize(r.results);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[comissions] càlcul automàtic fallit", contractId, msg.slice(0, 200));
    await markPending(sb, contractId, source, msg);
    return { state: "error", message: `El contracte s'ha desat, però la comissió ha quedat pendent de càlcul: ${msg}. Es pot reintentar des de la fitxa econòmica («Calcula»).` };
  }
}
