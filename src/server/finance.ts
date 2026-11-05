import "server-only";
/**
 * CRM FASE 4 · CONTROL ECONÒMIC (servidor).
 * Totes les lectures i escriptures es fan amb la sessió de l'usuari (RLS). La base de dades garanteix:
 * immutabilitat de regles aprovades, càlculs, moviments i pagaments; idempotència (claus úniques); bloqueig de
 * liquidacions aprovades; aprovació només per Direcció i mai de la pròpia liquidació.
 * El client de servei només s'usa per a les alertes (motor d'automatitzacions) i per sincronitzar l'estat de la
 * comissió de l'expedient (Fase 3), i per enviar avisos interns a altres usuaris.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import * as XLSX from "xlsx";
import {
  D, CALC_STATUS_LABEL, LEDGER_KIND_LABEL, computeCommission, contributionMargin, deriveSegment, incentiveDelta, lastMonths, lineFingerprint, money, monthOf,
  periodRange, pickRule, planFinanceAlerts, reconcile, retrocession, ruleApplies, tierAmount, type Facts, type FinAlertInput, type Layer, type ParsedLine, type RuleRow,
} from "@/core/commissions";
import { buildSettlementPdf } from "@/core/settlement-pdf";
import { cupsBase, gridFromBytes, movementFingerprint, normCups, readSettlement, type ReadResult } from "@/core/settlement-reader";
import { matchesRetailer, norm as normName } from "@/core/retailers";
import { SERVICES, type Service } from "@/core/sales";
import { adminClient, HttpError } from "./supabase";
import { commercialCommission, levelOf, marginOf, selectionOf } from "@/comparator/commercial";
import { periodsOf } from "@/comparator/engine";
import type { Snapshot } from "@/comparator/snapshot";
import { isStaffRole, parse, publishToRenewals, type U } from "./crm";
import { finStaff, hasPerm } from "./permissions";
import { notify } from "./sales";

type PgError = { code?: string; message?: string } | null;
type SB = U["sb"] | ReturnType<typeof adminClient>;
const uuid = z.string().uuid();
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);

export function finError(e: PgError, fallback = "No s'ha pogut desar"): never {
  const m = e?.message ?? "";
  if (e?.code === "42703" || e?.code === "PGRST204" || /column .* does not exist|Could not find the '.*' column|fin_register_receipt_net|fin_receipt_allocations/i.test(m)) throw new HttpError(409, "Falta aplicar la migració supabase/migrations/025_auditor_comissions.sql a Supabase");
  if (e?.code === "42P01" || e?.code === "PGRST205" || /does not exist|schema cache/i.test(m)) throw new HttpError(409, "Falta aplicar la migració supabase/migrations/011_crm_economia.sql a Supabase");
  if (e?.code === "23514" && !/violates check constraint/i.test(m)) throw new HttpError(400, m);
  if (e?.code === "23514") throw new HttpError(400, "Hi ha dades amb un format no vàlid");
  if (e?.code === "23505") throw new HttpError(409, /duplicat/i.test(m) ? m : "Aquest registre ja existeix (s'ha evitat un duplicat)");
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) throw new HttpError(403, /^(Només|Ningú|Regla|Els |Liquidació|Aquest|Una )/.test(m) ? m : "No tens permís per fer aquesta acció");
  console.error("[economia]", e?.code, m.slice(0, 200));
  throw new HttpError(500, fallback);
}
/** Fase 7: dades econòmiques restringides → Direcció o persones autoritzades per Direcció (mòdul «economia»). */
const staffOnly = async (u: U, action: "read" | "edit" = "read") => {
  if (!(await finStaff(u, action))) throw new HttpError(403, action === "edit" ? "No tens autorització per modificar dades econòmiques (la concedeix Direcció)" : "Les dades econòmiques són restringides: cal autorització de Direcció");
};
const canManageRules = async (u: U) => u.profile.role === "admin" || (isStaffRole(u.profile.role) && (await hasPerm(u, "comissions", "edit")));
const names = async (sb: SB) => new Map(((await sb.from("profiles").select("id,name,role,code,email")).data ?? []).map((p) => [p.id as string, p as { id: string; name: string; role: string; code: string | null; email: string }]));
async function all<T>(build: (from: number) => PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) finError(error, "No s'han pogut carregar les dades");
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000 || out.length >= 20000) break;
  }
  return out;
}
const sum = (xs: (string | number | null | undefined)[]) => money(xs.reduce<ReturnType<typeof D>>((a, x) => a.plus(D(x ?? 0)), D(0)));

/* ======================================================================= context del contracte */

/** Configuració comercial vinculada al contracte en formalitzar-lo (matriu Nufri). Congelada: no canvia amb el catàleg. */
export interface CommercialEcon {
  scheme: "nufri"; catalog_version_id: string | null; catalog_version: number | null; product_id: string | null; tariff: string | null;
  level: string; level_label: string; margin: string | null; margin_eur_kw_year: number | null;
  power_kw: (number | null)[]; annual_kwh: number | null; prices: { energy: (number | null)[]; energy24h: number | null; power: (number | null)[] };
  forecast: { energy: string | null; power: string | null; total: string | null; collaborator: string | null; remainder: string | null; status: string; rule_id: string | null; rule_version: number | null };
  collaborator_id: string | null; collaborator_pct: string | null; collaborator_rule_id: string | null; collaborator_rule_version: number | null;
  linked_at: string; linked_by: string | null; comparison_id: string | null;
}
interface Ctx {
  contract: { id: string; client_id: string; supply_id: string | null; retailer: string; product: string | null; status: string; start_date: string | null; end_date: string | null; signed_at: string | null; owner_id: string | null; expedient_id: string | null; previous_contract_id?: string | null };
  client: { id: string; name: string; kind: string; owner_id: string | null; collaborator_id: string | null; origin: string | null };
  supply: { cups: string; energy_type: string; annual_kwh: number | null; power_kw: (number | null)[] | null; access_tariff?: string | null } | null;
  exp: { id: string; code: string; service: Service; customer_type: string; owner_id: string | null; collaborator_id: string | null; activated_at: string | null } | null;
  econ: { segment: string | null; product_modality: string | null; eligible_mwh: string | null; energy_increment_eur_kwh: string | null; power_increment_eur_kw_day: string | null; economic_months: number; econ_status: string; cancelled_at: string | null; cancel_reason: string | null; notes: string | null; commercial?: CommercialEcon | null } | null;
  owner: string | null; collaborator: string | null; service: Service | null; refDate: string;
}
async function context(sb: SB, contractId: string): Promise<Ctx> {
  if (!uuid.safeParse(contractId).success) throw new HttpError(404, "Contracte no trobat");
  const k = (await sb.from("crm_contracts").select("id,client_id,supply_id,retailer,product,status,start_date,end_date,signed_at,owner_id,expedient_id,previous_contract_id").eq("id", contractId).maybeSingle()).data as Ctx["contract"] | null;
  if (!k) throw new HttpError(404, "Contracte no trobat o sense permís");
  const [c, s, e, econ] = await Promise.all([
    sb.from("crm_clients").select("id,name,kind,owner_id,collaborator_id,origin").eq("id", k.client_id).single(),
    k.supply_id ? sb.from("crm_supplies").select("cups,energy_type,annual_kwh,power_kw,access_tariff").eq("id", k.supply_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("crm_expedients").select("id,code,service,customer_type,owner_id,collaborator_id,activated_at").or(`contract_id.eq.${k.id}${k.expedient_id ? `,id.eq.${k.expedient_id}` : ""}`).limit(1),
    sb.from("fin_contract_economics").select("*").eq("contract_id", k.id).maybeSingle(),
  ]);
  const client = c.data as Ctx["client"];
  const supply = s.data as Ctx["supply"];
  const exp = (e.data?.[0] ?? null) as Ctx["exp"];
  const service: Service | null = exp?.service ?? (supply ? (supply.energy_type === "gas" ? "gas" : client.kind === "particular" ? "llum_residencial" : "llum_empresa") : null);
  return {
    contract: k, client, supply, exp, econ: (econ.data ?? null) as Ctx["econ"],
    owner: k.owner_id ?? exp?.owner_id ?? client.owner_id, collaborator: exp?.collaborator_id ?? client.collaborator_id,
    service, refDate: exp?.activated_at ?? k.start_date ?? k.signed_at ?? today(),
  };
}

async function ledgerFor(sb: SB, contractId: string) {
  const r = await sb.from("fin_ledger").select("*").eq("contract_id", contractId).order("created_at");
  if (r.error) finError(r.error);
  return (r.data ?? []) as LedgerRow[];
}
interface LedgerRow { id: string; contract_id: string | null; client_id: string | null; layer: Layer; beneficiary_id: string | null; kind: string; amount: string; period: string; description: string; calculation_id: string | null; rule_id: string | null; statement_line_id: string | null; settlement_id: string | null; idempotency_key: string; created_by_name: string | null; created_at: string }

function facts(ctx: Ctx, providerAmount: string | null, providerSource: Facts["providerAmountSource"]): Facts {
  const e = ctx.econ;
  return {
    retailer: ctx.contract.retailer, product: e?.product_modality || ctx.contract.product, service: ctx.service,
    segment: (e?.segment as Facts["segment"]) ?? deriveSegment(ctx.service, ctx.exp?.customer_type ?? ctx.client.kind, ctx.supply?.annual_kwh ?? null),
    refDate: ctx.refDate,
    annualKwh: e?.commercial?.annual_kwh ?? ctx.supply?.annual_kwh ?? null, annualKwhSource: e?.commercial?.annual_kwh != null ? "Consum anual de la comparativa formalitzada" : ctx.supply ? `Consum anual del subministrament ${ctx.supply.cups}` : "—",
    eligibleMwh: e?.eligible_mwh ?? null, energyIncrementEurKwh: e?.energy_increment_eur_kwh ?? null, powerIncrementEurKwDay: e?.power_increment_eur_kw_day ?? null,
    powerKw: e?.commercial?.power_kw ?? ctx.supply?.power_kw ?? null, months: e?.economic_months ?? 12,
    powerMarginEurKwYear: e?.commercial?.margin_eur_kw_year ?? null,
    providerAmount, providerAmountSource: providerSource,
    // Fase 8.1: perquè les regles de les comercialitzadores per renovació o per peatge s'apliquin correctament
    isRenewal: ctx.contract.previous_contract_id === undefined ? null : !!ctx.contract.previous_contract_id, tariff: e?.commercial?.tariff ?? ctx.supply?.access_tariff ?? null,
  };
}
const loadRules = async (sb: SB) => {
  const r = await sb.from("fin_rules").select("*").in("status", ["aprovada", "pendent_aprovacio"]);
  if (r.error) finError(r.error);
  return (r.data ?? []) as RuleRow[];
};

/* ======================================================================= càlcul i meritació */

export async function calculateContract(u: U, contractId: string) {
  await staffOnly(u, "edit");
  const ctx = await context(u.sb, contractId);
  const rules = await loadRules(u.sb);
  const ledger = await ledgerFor(u.sb, contractId);
  const confirmed = sum(ledger.filter((l) => l.layer === "proveidor" && l.kind === "confirmacio").map((l) => l.amount));
  const out: { layer: Layer; beneficiary: string | null; status: string; amount: string | null }[] = [];
  let providerEstimate: string | null = null;
  const layers: { layer: Layer; who: string | null }[] = [{ layer: "proveidor", who: null }, { layer: "comercial", who: ctx.owner }, { layer: "collaborador", who: ctx.collaborator }];
  for (const { layer, who } of layers) {
    if (layer !== "proveidor" && !who) continue;
    const f = facts(ctx, D(confirmed).gt(0) ? confirmed : providerEstimate, D(confirmed).gt(0) ? "confirmat" : providerEstimate ? "estimat" : null);
    const { rule, simulation, conflict } = pickRule(rules, f, layer, who);
    const res = conflict.length ? { status: "pendent_configuracio" as const, amount: null, formula: `Conflicte: hi ha ${conflict.length} regles igual d'específiques (${conflict.map((r) => r.name).join(", ")}). Cal concretar-les.`, breakdown: [] }
      : rule ? computeCommission(rule, f, simulation) : { status: "sense_regla" as const, amount: null, formula: "No hi ha cap regla aplicable per a aquesta capa", breakdown: [] };
    if (layer === "proveidor" && res.amount && res.status === "calculat") providerEstimate = res.amount;
    const inputs = { ...f, owner: ctx.owner, collaborator: ctx.collaborator };
    const calc_hash = sha({ rule: rule?.id ?? null, inputs, status: res.status, amount: res.amount });
    const base = u.sb.from("fin_calculations");
    const existing = await base.select("id,is_current").eq("contract_id", contractId).eq("layer", layer).eq("calc_hash", calc_hash).limit(5);
    const match = (existing.data ?? []).find(() => true);
    let id: string;
    if (match) {
      id = match.id;
      if (!match.is_current) await u.sb.from("fin_calculations").update({ is_current: true }).eq("id", id);
    } else {
      const ins = await u.sb.from("fin_calculations").insert({ contract_id: contractId, layer, beneficiary_id: who, rule_id: rule?.id ?? null, rule_key: rule?.rule_key ?? null, rule_version: rule?.version ?? null, status: res.status, amount: res.amount, inputs, breakdown: res.breakdown, formula: res.formula, calc_hash, created_by: u.user.id }).select("id").single();
      if (ins.error) finError(ins.error, "No s'ha pogut desar el càlcul");
      id = ins.data.id;
    }
    await u.sb.from("fin_calculations").update({ is_current: false }).eq("contract_id", contractId).eq("layer", layer).eq("is_current", true).neq("id", id);
    out.push({ layer, beneficiary: who, status: res.status, amount: res.amount });
  }
  return { results: out };
}

export async function accrueContract(u: U, contractId: string) {
  await staffOnly(u, "edit");
  const ctx = await context(u.sb, contractId);
  if (ctx.econ && ctx.econ.econ_status !== "actiu") throw new HttpError(400, "El contracte està anul·lat o penalitzat: no es merita.");
  const calcs = ((await u.sb.from("fin_calculations").select("*").eq("contract_id", contractId).eq("is_current", true)).data ?? []) as { id: string; layer: Layer; beneficiary_id: string | null; rule_id: string | null; status: string; amount: string | null; formula: string | null }[];
  if (!calcs.length) throw new HttpError(400, "Calcula primer les comissions del contracte.");
  const ruleIds = calcs.map((c) => c.rule_id).filter(Boolean) as string[];
  const rules = ruleIds.length ? (((await u.sb.from("fin_rules").select("id,conditions,name").in("id", ruleIds)).data ?? []) as { id: string; conditions: { accrual_event?: string }; name: string }[]) : [];
  const ledger = await ledgerFor(u.sb, contractId);
  const active = ["actiu", "renovacio_pendent", "finalitzat"].includes(ctx.contract.status);
  const collected = ledger.some((l) => l.layer === "proveidor" && l.kind === "cobrament");
  const created: string[] = [], skipped: { layer: string; reason: string }[] = [];
  for (const c of calcs) {
    if (c.status !== "calculat" || c.amount == null) { skipped.push({ layer: c.layer, reason: CALC_STATUS_LABEL[c.status as keyof typeof CALC_STATUS_LABEL] ?? c.status }); continue; }
    const ev = rules.find((r) => r.id === c.rule_id)?.conditions?.accrual_event ?? "activacio";
    if (ev === "activacio" && !active) { skipped.push({ layer: c.layer, reason: "El contracte encara no està activat" }); continue; }
    if (ev === "cobrament_proveidor" && !collected) { skipped.push({ layer: c.layer, reason: "Pendent del cobrament del proveïdor" }); continue; }
    const mine = ledger.filter((l) => l.layer === c.layer && l.beneficiary_id === c.beneficiary_id && ["meritacio", "regularitzacio"].includes(l.kind));
    const booked = sum(mine.map((l) => l.amount));
    const delta = incentiveDelta(c.amount, booked);
    if (D(delta).isZero()) { skipped.push({ layer: c.layer, reason: "Ja meritat" }); continue; }
    const first = !mine.some((l) => l.kind === "meritacio");
    const row = {
      contract_id: contractId, client_id: ctx.contract.client_id, layer: c.layer, beneficiary_id: c.layer === "proveidor" ? null : c.beneficiary_id,
      kind: first ? "meritacio" : "regularitzacio", amount: first ? c.amount : delta, period: today(),
      description: `${first ? "Meritació" : "Regularització"} · ${c.formula ?? ""}`.slice(0, 300), calculation_id: c.id, rule_id: c.rule_id,
      idempotency_key: first ? `merit:${c.layer}:${contractId}:${c.beneficiary_id ?? "-"}` : `regul:${c.id}`, created_by: u.user.id, created_by_name: u.profile.name,
    };
    const ins = await u.sb.from("fin_ledger").insert(row).select("id").single();
    if (ins.error) { if (ins.error.code === "23505") { skipped.push({ layer: c.layer, reason: "Ja meritat" }); continue; } finError(ins.error); }
    created.push(ins.data!.id);
  }
  await syncLegacy(contractId);
  return { created: created.length, skipped };
}

const econInput = z.object({
  segment: z.enum(["residencial", "pime", "gran_consum"]).nullable().optional(),
  product_modality: z.string().trim().max(80).nullable().optional(),
  eligible_mwh: z.string().regex(/^\d+(\.\d{1,3})?$/, "MWh no vàlids").nullable().optional(),
  energy_increment_eur_kwh: z.string().regex(/^\d+(\.\d{1,6})?$/, "Increment d'energia no vàlid").nullable().optional(),
  power_increment_eur_kw_day: z.string().regex(/^\d+(\.\d{1,6})?$/, "Increment de potència no vàlid").nullable().optional(),
  economic_months: z.number().int().min(1).max(120).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  // Fase 14: ajornament contractual de la liquidació (mentre duri no es considera pendent ni reclamable)
  settlement_deferred_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  settlement_deferral_reason: z.string().trim().max(500).nullable().optional(),
});
export async function saveEconomics(u: U, contractId: string, raw: unknown) {
  await staffOnly(u, "edit");
  await context(u.sb, contractId);
  const b = parse(econInput, raw);
  const r = await u.sb.from("fin_contract_economics").upsert({ contract_id: contractId, ...b, updated_by: u.user.id }, { onConflict: "contract_id" }).select("contract_id");
  if (r.error) finError(r.error);
  return calculateContract(u, contractId);
}

/** Anul·lació o penalització: reverteix el que no s'ha liquidat i aplica la retrocessió aprovada sobre el que ja s'ha liquidat. */
export async function cancelContract(u: U, contractId: string, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ status: z.enum(["anullat", "penalitzat"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3, "Indica el motiu").max(500) }), raw);
  const ctx = await context(u.sb, contractId);
  if (ctx.econ?.econ_status === b.status) throw new HttpError(409, "El contracte ja consta com a " + b.status);
  const up = await u.sb.from("fin_contract_economics").upsert({ contract_id: contractId, econ_status: b.status, cancelled_at: b.date, cancel_reason: b.reason, updated_by: u.user.id }, { onConflict: "contract_id" });
  if (up.error) finError(up.error);
  const ledger = await ledgerFor(u.sb, contractId);
  const setIds = [...new Set(ledger.map((l) => l.settlement_id).filter(Boolean))] as string[];
  const settled = setIds.length ? (((await u.sb.from("fin_settlements").select("id,status").in("id", setIds)).data ?? []) as { id: string; status: string }[]) : [];
  const locked = new Set(settled.filter((s) => s.status === "aprovada" || s.status === "pagada").map((s) => s.id));
  const rules = await loadRules(u.sb);
  const f = facts(ctx, null, null);
  const actions: string[] = [], warnings: string[] = [];
  const groups = new Map<string, LedgerRow[]>();
  for (const l of ledger) { const k = `${l.layer}|${l.beneficiary_id ?? "-"}`; groups.set(k, [...(groups.get(k) ?? []), l]); }
  for (const [k, rows] of groups) {
    const [layer, benef] = k.split("|") as [Layer, string];
    const earn = rows.filter((l) => ["meritacio", "regularitzacio", "bonificacio", "ajustament", "anullacio", "retrocessio"].includes(l.kind));
    if (layer === "proveidor") {
      const net = sum(earn.filter((l) => l.kind !== "bonificacio").map((l) => l.amount));
      if (D(net).gt(0)) {
        await insertLedger(u, { contract_id: contractId, client_id: ctx.contract.client_id, layer, beneficiary_id: null, kind: "anullacio", amount: money(D(net).neg()), description: `Anul·lació de la meritació del proveïdor · ${b.reason}`, idempotency_key: `anul:proveidor:${contractId}:${b.status}` });
        actions.push(`Proveïdor: anul·lació de ${net} € meritats`);
      }
      continue;
    }
    const lockedAmt = sum(earn.filter((l) => l.settlement_id && locked.has(l.settlement_id)).map((l) => l.amount));
    const open = sum(earn.filter((l) => !l.settlement_id || !locked.has(l.settlement_id)).map((l) => l.amount));
    if (!D(open).isZero()) {
      await insertLedger(u, { contract_id: contractId, client_id: ctx.contract.client_id, layer, beneficiary_id: benef, kind: "anullacio", amount: money(D(open).neg()), description: `Anul·lació (no liquidat) · ${b.reason}`, idempotency_key: `anul:${layer}:${contractId}:${benef}:${b.status}` });
      actions.push(`${layer}: anul·lació de ${open} € encara no liquidats`);
    }
    if (D(lockedAmt).gt(0)) {
      const rr = rules.filter((r) => r.kind === "retrocessio" && r.status === "aprovada" && ruleApplies({ ...r, kind: "fix_contracte" } as RuleRow, f, layer, benef))
        .sort((a, c) => c.version - a.version)[0] ?? null;
      const ret = retrocession(rr, lockedAmt, ctx.exp?.activated_at ?? ctx.contract.start_date, b.date);
      if (ret.amount) {
        await insertLedger(u, { contract_id: contractId, client_id: ctx.contract.client_id, layer, beneficiary_id: benef, kind: "retrocessio", amount: ret.amount, rule_id: rr!.id, description: `Retrocessió · ${ret.reason}`, idempotency_key: `retro:${layer}:${contractId}:${benef}:${b.status}` });
        actions.push(`${layer}: retrocessió de ${ret.amount} € (${ret.reason})`);
      } else {
        warnings.push(`${layer}: ${lockedAmt} € ja liquidats. ${ret.reason}`);
        const staff = ((await u.sb.from("profiles").select("id").in("role", ["admin", "cap_administrativa"])).data ?? []).map((x) => x.id as string);
        for (const s of staff) await notify(s, { kind: "economia", title: `Contracte anul·lat amb comissió ja liquidada: ${ctx.client.name}`, body: `${lockedAmt} € liquidats. ${ret.reason}`, link: { view: "economia", params: { contract: contractId } }, ruleKey: `fin_cancel_paid:${contractId}:${benef}` });
      }
    }
  }
  if (b.status === "anullat" && !["anullat", "finalitzat"].includes(ctx.contract.status)) {
    await u.sb.from("crm_contracts").update({ status: "anullat", notes: `Anul·lat el ${b.date}: ${b.reason}` }).eq("id", contractId);
    await publishToRenewals(contractId);
  }
  await syncLegacy(contractId);
  return { actions, warnings };
}

async function insertLedger(u: U, row: Record<string, unknown>) {
  const r = await u.sb.from("fin_ledger").insert({ period: today(), ...row, created_by: u.user.id, created_by_name: u.profile.name }).select("id").single();
  if (r.error) { if (r.error.code === "23505") return null; finError(r.error); }
  return r.data!.id as string;
}

const manualInput = z.object({
  contract_id: uuid.nullable().optional(),
  layer: z.enum(["proveidor", "comercial", "collaborador"]),
  beneficiary_id: uuid.nullable().optional(),
  kind: z.enum(["ajustament", "bonificacio", "regularitzacio", "retrocessio", "facturacio", "confirmacio"]),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Import no vàlid (fins a 2 decimals)").refine((v) => !D(v).isZero(), "L'import no pot ser zero"),
  description: z.string().trim().min(3, "Explica el motiu").max(300),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  key: z.string().uuid(),                        // evita duplicats per doble clic
});
export async function manualEntry(u: U, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(manualInput, raw);
  if (b.layer !== "proveidor" && !b.beneficiary_id) throw new HttpError(400, "Indica el comercial o el col·laborador");
  if (b.layer !== "proveidor" && ["facturacio", "confirmacio"].includes(b.kind)) throw new HttpError(400, "Aquest tipus de moviment només existeix a la capa del proveïdor");
  if (b.layer === "proveidor" && b.kind === "bonificacio") throw new HttpError(400, "Les bonificacions són de comercials o col·laboradors");
  let client: string | null = null;
  if (b.contract_id) client = (await context(u.sb, b.contract_id)).contract.client_id;
  const id = await insertLedger(u, { contract_id: b.contract_id ?? null, client_id: client, layer: b.layer, beneficiary_id: b.layer === "proveidor" ? null : b.beneficiary_id, kind: b.kind, amount: money(b.amount), period: b.period ?? today(), description: b.description, idempotency_key: `manual:${b.key}` });
  if (b.contract_id) await syncLegacy(b.contract_id);
  return { id, duplicate: id === null };
}

export async function addCost(u: U, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ contract_id: uuid.nullable().optional(), client_id: uuid.nullable().optional(), concept: z.string().trim().min(1).max(200), amount: z.string().regex(/^\d+(\.\d{1,2})?$/), cost_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(500).nullable().optional() }), raw);
  const r = await u.sb.from("fin_costs").insert({ ...b, created_by: u.user.id }).select("id").single();
  if (r.error) finError(r.error);
  return { id: r.data.id };
}

/* ======================================================================= fitxa econòmica del contracte */

export async function contractEconomics(u: U, contractId: string) {
  const staff = await finStaff(u);
  const ctx = await context(u.sb, contractId);       // la RLS del contracte decideix si el pot veure
  const [calcs, ledger, lines, costs, n, legacy, rec] = await Promise.all([
    u.sb.from("fin_calculations").select("*").eq("contract_id", contractId).order("created_at", { ascending: false }),
    ledgerFor(u.sb, contractId),
    staff ? u.sb.from("fin_statement_lines").select("*, fin_provider_statements(retailer,reference,received_at,file_name)").eq("contract_id", contractId) : Promise.resolve({ data: [] }),
    staff ? u.sb.from("fin_costs").select("*").eq("contract_id", contractId) : Promise.resolve({ data: [] }),
    names(u.sb),
    staff ? u.sb.from("crm_contract_finance").select("*").eq("contract_id", contractId).maybeSingle() : Promise.resolve({ data: null }),
    ctx.exp && staff ? u.sb.from("crm_commission_records").select("*").eq("expedient_id", ctx.exp.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (calcs.error) finError(calcs.error);
  const allCalcs = (calcs.data ?? []) as { id: string; layer: Layer; beneficiary_id: string | null; rule_id: string | null; rule_key: string | null; rule_version: number | null; status: string; amount: string | null; breakdown: unknown; formula: string | null; is_current: boolean; created_at: string; inputs: unknown }[];
  const isCollab = u.profile.role === "colaborador";
  const visibleCalcs = allCalcs.map((c) => (isCollab ? { ...c, breakdown: [], inputs: null, formula: c.status === "calculat" ? "Import segons les condicions pactades" : c.formula } : c));
  const L = (layer: Layer, kinds: string[]) => sum(ledger.filter((l) => l.layer === layer && kinds.includes(l.kind)).map((l) => l.amount));
  const cur = (layer: Layer) => allCalcs.find((c) => c.layer === layer && c.is_current);
  const provEst = cur("proveidor");
  const payoutsAccrued = money(D(L("comercial", ["meritacio", "regularitzacio", "bonificacio", "ajustament", "anullacio", "retrocessio"])).plus(L("collaborador", ["meritacio", "regularitzacio", "bonificacio", "ajustament", "anullacio", "retrocessio"])));
  const payoutsEst = money(D(cur("comercial")?.amount ?? 0).plus(cur("collaborador")?.amount ?? 0));
  const costTotal = sum(((costs.data ?? []) as { amount: string }[]).map((c) => c.amount));
  const summary = staff ? {
    provider: {
      estimated: provEst?.amount ?? null, estimatedStatus: provEst?.status ?? null,
      accrued: L("proveidor", ["meritacio", "regularitzacio", "anullacio"]), invoiced: L("proveidor", ["facturacio"]), confirmed: L("proveidor", ["confirmacio"]),
      collected: L("proveidor", ["cobrament"]), adjustments: L("proveidor", ["ajustament", "retrocessio"]),
    },
    margin: contributionMargin({ providerCollected: L("proveidor", ["cobrament"]), providerEstimated: provEst?.status === "calculat" ? provEst.amount : null, providerConfirmed: L("proveidor", ["confirmacio"]), payouts: payoutsAccrued, payoutsEstimated: payoutsEst, costs: costTotal, hasProviderRule: !!provEst && provEst.status === "calculat", hasPayoutCalc: !!cur("comercial") }),
    costs: costTotal,
  } : null;
  const setIds = [...new Set(ledger.map((l) => l.settlement_id).filter(Boolean))] as string[];
  const settlements = setIds.length ? (((await u.sb.from("fin_settlements").select("id,code,status").in("id", setIds)).data ?? []) as { id: string; code: string; status: string }[]) : [];
  const payout = (layer: "comercial" | "collaborador") => {
    const rows = ledger.filter((l) => l.layer === layer);
    if (!rows.length && !cur(layer)) return null;
    const benef = cur(layer)?.beneficiary_id ?? rows[0]?.beneficiary_id ?? null;
    return {
      beneficiary_id: benef, beneficiary_name: benef ? n.get(benef)?.name ?? null : null,
      estimated: cur(layer)?.amount ?? null, status: cur(layer)?.status ?? null,
      accrued: sum(rows.filter((l) => ["meritacio", "regularitzacio", "bonificacio"].includes(l.kind)).map((l) => l.amount)),
      adjustments: sum(rows.filter((l) => ["ajustament", "anullacio", "retrocessio"].includes(l.kind)).map((l) => l.amount)),
      settled: sum(rows.filter((l) => l.settlement_id && settlements.find((s) => s.id === l.settlement_id && ["aprovada", "pagada"].includes(s.status))).map((l) => l.amount)),
      pending: sum(rows.filter((l) => !l.settlement_id || !settlements.find((s) => s.id === l.settlement_id && ["aprovada", "pagada"].includes(s.status))).map((l) => l.amount)),
    };
  };
  // Fase 14: historial de comissions del contracte amb els quatre estats separats (prevista, liquidada, cobrada, reclamada)
  let commissionHistory: unknown = null;
  if (staff) {
    type HL = { id: string; amount: string; kind: string; match_status: string; expected_amount: string | null; difference: string | null; concept: string | null; movement?: string | null; source_sheet?: string | null; source_row?: number | null; event_date?: string | null; doc_status?: string | null; fin_provider_statements: { retailer: string; reference: string; received_at: string; file_name: string | null } | null };
    const HLs = ((lines.data ?? []) as HL[]).sort((a, b) => String(a.fin_provider_statements?.received_at ?? "").localeCompare(String(b.fin_provider_statements?.received_at ?? "")));
    const cobs = ledger.filter((l) => l.kind === "cobrament" && l.statement_line_id);
    const items = await u.sb.from("fin_claim_items").select("id,claim_id,kind,claimed_amount,recovered_amount,status,statement_line_id,fin_claims(code,status)").eq("contract_id", contractId);
    type CI = { id: string; claim_id: string; kind: string; claimed_amount: string; recovered_amount: string; status: string; statement_line_id: string | null; fin_claims: { code: string; status: string } | { code: string; status: string }[] | null };
    const CIs = (items.error ? [] : (items.data ?? []) as CI[]).filter((i) => !["retirada", "traspassada"].includes(i.status));
    const live = HLs.filter((l) => !["duplicat", "descartat"].includes(l.match_status));
    commissionHistory = {
      states: {
        prevista: { amount: provEst?.status === "calculat" || provEst?.status === "simulacio" ? provEst.amount : null, status: provEst?.status ?? null },
        liquidada: sum(live.filter((l) => l.kind === "comissio").map((l) => l.amount)),
        regularitzacions: sum(live.filter((l) => l.kind !== "comissio").map((l) => l.amount)),
        cobrada: sum(cobs.map((l) => l.amount)),
        reclamada: sum(CIs.map((i) => i.claimed_amount)), recuperada: sum(CIs.map((i) => i.recovered_amount)),
      },
      lines: HLs.map((l) => {
        const c = cobs.filter((x) => x.statement_line_id === l.id);
        return {
          id: l.id, received_at: l.fin_provider_statements?.received_at ?? null, reference: l.fin_provider_statements?.reference ?? null, retailer: l.fin_provider_statements?.retailer ?? null,
          origin: l.source_sheet ? `${l.fin_provider_statements?.file_name ?? "document"} / ${l.source_sheet} / fila ${l.source_row}` : l.fin_provider_statements?.file_name ?? null,
          movement: l.movement ?? null, concept: l.concept, doc_status: l.doc_status ?? null, kind: l.kind, amount: l.amount, expected: l.expected_amount, difference: l.difference, match_status: l.match_status,
          collected: sum(c.map((x) => x.amount)), collected_at: c.map((x) => x.period).sort().pop() ?? null,
          claim: CIs.filter((i) => i.statement_line_id === l.id).map((i) => (Array.isArray(i.fin_claims) ? i.fin_claims[0] : i.fin_claims)?.code).filter(Boolean),
        };
      }),
      claims: CIs.map((i) => { const c = Array.isArray(i.fin_claims) ? i.fin_claims[0] : i.fin_claims; return { id: i.id, claim_id: i.claim_id, code: c?.code ?? null, claim_status: c?.status ?? null, kind: i.kind, claimed: i.claimed_amount, recovered: i.recovered_amount, status: i.status }; }),
    };
  }
  return {
    commissionHistory,
    contract: ctx.contract, client: ctx.client, supply: ctx.supply, expedient: ctx.exp, economics: staff ? ctx.econ : null,
    owner: ctx.owner ? { id: ctx.owner, name: n.get(ctx.owner)?.name ?? null } : null,
    collaborator: ctx.collaborator ? { id: ctx.collaborator, name: n.get(ctx.collaborator)?.name ?? null } : null,
    facts: staff ? facts(ctx, null, null) : null,
    calculations: visibleCalcs.filter((c) => staff || c.layer !== "proveidor"),
    ledger: ledger.map((l) => ({ ...l, settlement: settlements.find((s) => s.id === l.settlement_id) ?? null })),
    summary, payouts: { comercial: payout("comercial"), collaborador: payout("collaborador") },
    statementLines: lines.data ?? [], costs: costs.data ?? [], legacy: staff ? { finance: legacy.data, record: rec.data } : null,
    permissions: { staff, canManageRules: await canManageRules(u) },
  };
}

/** Estat de la comissió de l'expedient (Fase 3) a partir dels moviments reals (servidor). */
async function syncLegacy(contractId: string) {
  const sb = adminClient();
  const k = (await sb.from("crm_contracts").select("expedient_id").eq("id", contractId).maybeSingle()).data;
  const exp = k?.expedient_id ?? (await sb.from("crm_expedients").select("id").eq("contract_id", contractId).limit(1)).data?.[0]?.id;
  if (!exp) return;
  const l = ((await sb.from("fin_ledger").select("kind,amount,period").eq("contract_id", contractId).eq("layer", "proveidor")).data ?? []) as { kind: string; amount: string; period: string }[];
  const econ = (await sb.from("fin_contract_economics").select("econ_status").eq("contract_id", contractId).maybeSingle()).data;
  const accrued = sum(l.filter((x) => ["meritacio", "regularitzacio", "anullacio", "confirmacio"].includes(x.kind)).map((x) => x.amount));
  const confirmed = sum(l.filter((x) => x.kind === "confirmacio").map((x) => x.amount));
  const collected = sum(l.filter((x) => x.kind === "cobrament").map((x) => x.amount));
  const lastPaid = l.filter((x) => x.kind === "cobrament").map((x) => x.period).sort().pop() ?? null;
  const patch = {
    accrual_status: econ?.econ_status === "anullat" ? "anullada" : D(accrued).gt(0) ? "meritada" : "pendent",
    payment_status: D(collected).lte(0) ? "pendent" : D(collected).gte(D(confirmed).gt(0) ? confirmed : accrued) ? "cobrada" : "parcial",
    paid_at: D(collected).gt(0) ? lastPaid : null, paid_eur: D(collected).gt(0) ? collected : null,
  };
  await sb.from("crm_commission_records").update(patch).eq("expedient_id", exp);
}

/* ======================================================================= regles */

const ruleInput = z.object({
  rule_key: z.string().regex(/^[a-z0-9_]{3,60}$/, "Identificador: minúscules, números i guions baixos").optional(),
  name: z.string().trim().min(1).max(160),
  layer: z.enum(["proveidor", "comercial", "collaborador", "incentiu"]),
  retailer: z.string().trim().max(120).nullable().optional(),
  product: z.string().trim().max(120).nullable().optional(),
  service: z.enum(SERVICES).nullable().optional(),
  segment: z.enum(["residencial", "pime", "gran_consum"]).nullable().optional(),
  beneficiary_id: uuid.nullable().optional(),
  kind: z.enum(["fix_contracte", "per_mwh", "energia_potencia", "pct_marge", "pct_increment_preu", "pct_comissio_rebuda", "trams_volum", "bonificacio", "regularitzacio", "retrocessio"]),
  value: z.string().regex(/^\d+(\.\d{1,6})?$/, "Valor no vàlid").nullable().optional(),
  tiers: z.array(z.object({ threshold: z.number().positive(), amount: z.number().min(0) })).max(20).nullable().optional(),
  conditions: z.record(z.unknown()).default({}),
  base_formula: z.string().trim().max(1000).nullable().optional(),
  base_validated: z.boolean().default(false),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export async function listRules(u: U) {
  const r = await u.sb.from("fin_rules").select("*").order("layer").order("rule_key").order("version", { ascending: false });
  if (r.error) finError(r.error);
  const n = await names(u.sb);
  return { rules: (r.data ?? []).map((x) => ({ ...x, approved_by_name: x.approved_by ? n.get(x.approved_by)?.name ?? null : null, beneficiary_name: x.beneficiary_id ? n.get(x.beneficiary_id)?.name ?? null : null })), canManage: await canManageRules(u), isDirector: u.profile.role === "admin", users: [...n.values()].filter((p) => ["comercial", "colaborador"].includes(p.role)).map((p) => ({ id: p.id, name: p.name, role: p.role })) };
}
/** Desa una regla. Si l'última versió ja està aprovada (o retirada), en crea una de nova (les aprovades no es modifiquen). */
export async function saveRule(u: U, raw: unknown, id?: string) {
  if (!(await canManageRules(u))) throw new HttpError(403, "Només Direcció o la cap d'Administració gestionen les regles");
  const b = parse(ruleInput, raw);
  const row = { ...b, retailer: b.retailer || null, product: b.product || null, unit: { per_mwh: "eur_mwh", energia_potencia: "eur_mwh", pct_marge: "pct", pct_increment_preu: "pct", pct_comissio_rebuda: "pct", retrocessio: "pct" }[b.kind as string] ?? "eur", tiers: b.kind === "trams_volum" ? b.tiers ?? [] : null, value: b.kind === "trams_volum" ? null : b.value ?? null };
  if (id) {
    const cur = (await u.sb.from("fin_rules").select("*").eq("id", id).maybeSingle()).data;
    if (!cur) throw new HttpError(404, "Regla no trobada");
    if (cur.status === "esborrany" || cur.status === "pendent_aprovacio") {
      const r = await u.sb.from("fin_rules").update({ ...row, rule_key: cur.rule_key }).eq("id", id).select("id,version").single();
      if (r.error) finError(r.error);
      return r.data;
    }
    const last = (await u.sb.from("fin_rules").select("version").eq("rule_key", cur.rule_key).order("version", { ascending: false }).limit(1)).data?.[0]?.version ?? cur.version;
    const r = await u.sb.from("fin_rules").insert({ ...row, rule_key: cur.rule_key, version: last + 1, status: "pendent_aprovacio", created_by: u.user.id }).select("id,version").single();
    if (r.error) finError(r.error);
    return r.data;
  }
  const key = b.rule_key ?? `${(b.retailer ?? b.layer).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)}_${randomUUID().slice(0, 6)}`;
  const r = await u.sb.from("fin_rules").insert({ ...row, rule_key: key, version: 1, status: "pendent_aprovacio", created_by: u.user.id }).select("id,version").single();
  if (r.error) finError(r.error);
  return r.data;
}
/**
 * Propostes de regla d'un lector local (p. ex. annex de Nufri): queden PENDENTS d'aprovació de Direcció.
 * Idempotent: si la darrera versió de la mateixa clau ja té el mateix valor, no es duplica; si el valor canvia,
 * se'n crea una versió nova (les aprovades no es modifiquen).
 */
export async function proposeRules(u: U, raw: unknown) {
  if (!(await canManageRules(u))) throw new HttpError(403, "Només Direcció o la cap d'Administració gestionen les regles");
  const list = parse(z.array(ruleInput.extend({ rule_key: z.string().regex(/^[a-z0-9_]{3,60}$/) })).min(1).max(300), raw);
  let created = 0, versioned = 0, unchanged = 0;
  for (const p of list) {
    const last = ((await u.sb.from("fin_rules").select("id,value,status,version").eq("rule_key", p.rule_key).order("version", { ascending: false }).limit(1)).data ?? [])[0] as { id: string; value: string | null; status: string; version: number } | undefined;
    if (last && last.status !== "retirada" && last.value != null && D(last.value).eq(D(p.value ?? 0))) { unchanged++; continue; }
    if (last) { await saveRule(u, p, last.id); versioned++; } else { await saveRule(u, p); created++; }
  }
  return { created, versioned, unchanged };
}

export async function setRuleStatus(u: U, id: string, status: "aprovada" | "retirada" | "pendent_aprovacio" | "esborrany") {
  if (status === "aprovada" && u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot aprovar regles de comissió");
  if (!(await canManageRules(u))) throw new HttpError(403, "Sense permís");
  const r = await u.sb.from("fin_rules").update({ status }).eq("id", id).select("id,status");
  if (r.error) finError(r.error);
  if (!r.data?.length) throw new HttpError(404, "Regla no trobada");
  return r.data[0];
}
/** Simulador: calcula amb una regla i unes dades d'exemple (no desa res). */
export async function simulate(u: U, raw: unknown) {
  await staffOnly(u);
  const b = parse(z.object({ ruleId: uuid, facts: z.record(z.unknown()) }), raw);
  const rule = (await u.sb.from("fin_rules").select("*").eq("id", b.ruleId).maybeSingle()).data as RuleRow | null;
  if (!rule) throw new HttpError(404, "Regla no trobada");
  const f = { retailer: "", product: null, service: null, segment: null, refDate: today(), annualKwh: null, annualKwhSource: "Simulació", eligibleMwh: null, energyIncrementEurKwh: null, powerIncrementEurKwDay: null, powerKw: null, months: 12, providerAmount: null, providerAmountSource: "estimat", ...b.facts } as Facts;
  if (rule.kind === "trams_volum") {
    const value = Number((b.facts as { value?: number }).value ?? 0);
    const t = tierAmount(rule.tiers ?? [], value, ((rule.conditions as { policy?: string }).policy as "maxim") ?? "maxim");
    return { status: "simulacio", amount: t.amount, formula: t.reached ? `Tram assolit: ${t.reached.threshold} → ${t.reached.amount} € (només el més alt)` : "Cap tram assolit", breakdown: [{ label: "Valor del període", value: String(value) }, ...(t.next ? [{ label: "Tram següent", value: `${t.next.threshold} → ${t.next.amount} €` }] : [])] };
  }
  const r = computeCommission(rule, f, rule.status !== "aprovada");
  return { ...r, status: r.status === "calculat" ? "simulacio" : r.status };
}

/* ======================================================================= incentius per trams */

export async function computeIncentives(u: U, month: string, onlyUser?: string) {
  await staffOnly(u);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "Període no vàlid");
  const from = `${month}-01`, to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const rules = ((await u.sb.from("fin_rules").select("*").eq("layer", "incentiu").eq("status", "aprovada")).data ?? []) as RuleRow[];
  const live = rules.filter((r) => r.kind === "trams_volum" && r.valid_from <= to && (!r.valid_to || r.valid_to >= from) && ((r.conditions as { period?: string }).period ?? "mes") === "mes");
  if (!live.length) return { created: 0, results: [] as { rule: string; user: string; value: number; amount: string }[] };
  const contracts = await all<{ id: string; client_id: string; retailer: string; product: string | null; status: string; start_date: string | null; signed_at: string | null; owner_id: string | null; supply_id: string | null; crm_clients: { owner_id: string | null; kind: string } | null; crm_supplies: { annual_kwh: number | null; energy_type: string } | null }>((f) =>
    u.sb.from("crm_contracts").select("id,client_id,retailer,product,status,start_date,signed_at,owner_id,supply_id,crm_clients(owner_id,kind),crm_supplies!crm_contracts_supply_id_fkey(annual_kwh,energy_type)").or(`start_date.gte.${from},signed_at.gte.${from}`).range(f, f + 999));
  const ids = contracts.map((c) => c.id);
  const exps = ids.length ? (((await u.sb.from("crm_expedients").select("contract_id,service,customer_type,activated_at,owner_id").in("contract_id", ids.slice(0, 1000))).data ?? []) as { contract_id: string; service: Service; customer_type: string; activated_at: string | null; owner_id: string | null }[]) : [];
  const econ = ids.length ? (((await u.sb.from("fin_contract_economics").select("contract_id,segment,eligible_mwh,econ_status").in("contract_id", ids.slice(0, 1000))).data ?? []) as { contract_id: string; segment: string | null; eligible_mwh: string | null; econ_status: string }[]) : [];
  const merits = ((await u.sb.from("fin_ledger").select("contract_id,beneficiary_id,period").eq("layer", "comercial").eq("kind", "meritacio").gte("period", from).lte("period", to)).data ?? []) as { contract_id: string; beneficiary_id: string; period: string }[];
  const booked = ((await u.sb.from("fin_ledger").select("beneficiary_id,amount,idempotency_key").eq("kind", "bonificacio").like("idempotency_key", `bonus:%:${month}:%`)).data ?? []) as { beneficiary_id: string; amount: string; idempotency_key: string }[];
  const per = new Map<string, { rule: RuleRow; user: string; value: ReturnType<typeof D> }>();
  for (const k of contracts) {
    const e = exps.find((x) => x.contract_id === k.id);
    const ec = econ.find((x) => x.contract_id === k.id);
    if (ec && ec.econ_status !== "actiu") continue;
    const owner = k.owner_id ?? e?.owner_id ?? k.crm_clients?.owner_id ?? null;
    if (!owner || (onlyUser && owner !== onlyUser)) continue;
    const service = e?.service ?? (k.crm_supplies ? (k.crm_supplies.energy_type === "gas" ? "gas" : k.crm_clients?.kind === "particular" ? "llum_residencial" : "llum_empresa") : null);
    const segment = (ec?.segment as Facts["segment"]) ?? deriveSegment(service, e?.customer_type ?? k.crm_clients?.kind ?? null, k.crm_supplies?.annual_kwh ?? null);
    for (const r of live) {
      const c = r.conditions as { basis?: string; metric?: string };
      const basis = c.basis ?? "activat";
      const date = basis === "signat" ? k.signed_at : basis === "meritat" ? merits.find((m) => m.contract_id === k.id && m.beneficiary_id === owner)?.period ?? null : e?.activated_at ?? (["actiu", "renovacio_pendent"].includes(k.status) ? k.start_date : null);
      if (!date || date < from || date > to) continue;
      if (r.retailer && r.retailer.toLowerCase() !== k.retailer.toLowerCase()) continue;
      if (r.service && r.service !== service) continue;
      if (r.segment && r.segment !== segment) continue;
      if (r.product && !(k.product ?? "").toLowerCase().includes(r.product.toLowerCase())) continue;
      if (r.beneficiary_id && r.beneficiary_id !== owner) continue;
      const key = `${r.rule_key}|${owner}`;
      const add = c.metric === "mwh" ? D(ec?.eligible_mwh ?? (k.crm_supplies?.annual_kwh != null ? D(k.crm_supplies.annual_kwh).div(1000) : 0)) : D(1);
      const cur = per.get(key) ?? { rule: r, user: owner, value: D(0) };
      cur.value = cur.value.plus(add);
      per.set(key, cur);
    }
  }
  let created = 0;
  const results: { rule: string; user: string; value: number; amount: string }[] = [];
  const keys = new Set([...per.keys(), ...booked.map((b) => { const [, rk, user] = b.idempotency_key.split(":"); return `${rk}|${user}`; })]);
  for (const key of keys) {
    const [rk, user] = key.split("|");
    if (onlyUser && user !== onlyUser) continue;
    const rule = per.get(key)?.rule ?? live.find((r) => r.rule_key === rk);
    if (!rule) continue;
    const value = per.get(key)?.value ?? D(0);
    const t = tierAmount(rule.tiers ?? [], value.toString(), ((rule.conditions as { policy?: string }).policy as "maxim" | "acumulat") ?? "maxim");
    const already = sum(booked.filter((b) => b.idempotency_key.startsWith(`bonus:${rk}:${month}:${user}:`)).map((b) => b.amount));
    const delta = incentiveDelta(t.amount, already);
    results.push({ rule: rule.name, user, value: value.toNumber(), amount: t.amount });
    if (D(delta).isZero()) continue;
    const id = await insertLedger(u, { layer: "comercial", beneficiary_id: user, kind: "bonificacio", amount: delta, period: to, rule_id: rule.id, description: `${rule.name} · ${month}: ${value.toString()} ${((rule.conditions as { metric?: string }).metric ?? "contractes") === "mwh" ? "MWh" : "contractes"} → ${t.amount} €${D(already).isZero() ? "" : ` (ja comptabilitzats ${already} €)`}`, idempotency_key: `bonus:${rk}:${month}:${user}:${t.amount}` });
    if (id) {
      created++;
      if (t.reached) await notify(user, { kind: "economia", title: `Objectiu assolit: ${rule.name}`, body: `${month}: tram ${t.reached.threshold} → ${t.reached.amount} € (pendent de liquidació i aprovació)`, link: { view: "liquidacions", params: {} }, ruleKey: `fin_goal:${rk}:${user}:${month}:${t.reached.threshold}` });
    }
  }
  return { created, results };
}

/* ======================================================================= liquidacions */

export async function listSettlements(u: U, raw: Record<string, string>) {
  let q = u.sb.from("fin_settlements").select("*").order("period_to", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  if (raw.kind === "comercial" || raw.kind === "collaborador") q = q.eq("kind", raw.kind);
  if (raw.status) q = q.eq("status", raw.status);
  if (raw.beneficiary && uuid.safeParse(raw.beneficiary).success) q = q.eq("beneficiary_id", raw.beneficiary);
  const r = await q;
  if (r.error) finError(r.error);
  const n = await names(u.sb);
  const staff = await finStaff(u);
  // moviments pendents de liquidar (per veure el saldo abans de preparar la liquidació)
  const pend = ((await u.sb.from("fin_ledger").select("beneficiary_id,layer,amount").in("layer", ["comercial", "collaborador"]).is("settlement_id", null)).data ?? []) as { beneficiary_id: string; layer: string; amount: string }[];
  const pendingBy = new Map<string, string>();
  for (const p of pend) pendingBy.set(`${p.layer}|${p.beneficiary_id}`, money(D(pendingBy.get(`${p.layer}|${p.beneficiary_id}`) ?? 0).plus(p.amount)));
  return {
    rows: (r.data ?? []).map((s) => ({ ...s, beneficiary_name: n.get(s.beneficiary_id)?.name ?? null, pending: money(D(s.approved_amount ?? s.total_gross).minus(s.paid_amount)) })),
    unsettled: [...pendingBy.entries()].map(([k, v]) => { const [layer, id] = k.split("|"); return { layer, beneficiary_id: id, name: n.get(id)?.name ?? null, amount: v }; }),
    people: staff ? [...n.values()].filter((p) => ["comercial", "colaborador", "admin", "cap_administrativa", "administrativa"].includes(p.role)).map((p) => ({ id: p.id, name: p.name, role: p.role })) : [],
    isStaff: staff, isDirector: u.profile.role === "admin", me: u.user.id,
  };
}

export async function buildSettlement(u: U, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ kind: z.enum(["comercial", "collaborador"]), beneficiary: uuid, month: z.string().regex(/^\d{4}-\d{2}$/), notes: z.string().max(500).nullable().optional() }), raw);
  const from = `${b.month}-01`, to = new Date(Date.UTC(Number(b.month.slice(0, 4)), Number(b.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if (b.kind === "comercial") await computeIncentives(u, b.month, b.beneficiary);
  const r = await u.sb.rpc("fin_build_settlement", { p_kind: b.kind, p_beneficiary: b.beneficiary, p_from: from, p_to: to, p_notes: b.notes ?? null });
  if (r.error) finError(r.error, "No s'ha pogut preparar la liquidació");
  const id = r.data as string;
  const lines = await u.sb.from("fin_settlement_lines").select("id", { count: "exact", head: true }).eq("settlement_id", id);
  if (!lines.count) {
    await u.sb.from("fin_settlements").delete().eq("id", id);
    throw new HttpError(400, "No hi ha cap comissió meritada pendent de liquidar per a aquesta persona fins al final del període.");
  }
  return { id };
}

export async function getSettlement(u: U, id: string) {
  if (!uuid.safeParse(id).success) throw new HttpError(404, "Liquidació no trobada");
  const s = (await u.sb.from("fin_settlements").select("*").eq("id", id).maybeSingle()).data;
  if (!s) throw new HttpError(404, "Aquesta liquidació no existeix o no tens permís per veure-la");
  const [lines, pays, n, audit] = await Promise.all([
    u.sb.from("fin_settlement_lines").select("*, crm_contracts(retailer,product,crm_clients(name))").eq("settlement_id", id).order("category"),
    u.sb.from("fin_payments").select("*").eq("settlement_id", id).order("paid_at"),
    names(u.sb),
    (await finStaff(u)) ? u.sb.from("fin_audit").select("*").eq("entity_id", id).order("at") : Promise.resolve({ data: [] }),
  ]);
  type LineRow = { id: string; contract_id: string | null; category: string; description: string; amount: string; crm_contracts: { retailer: string; product: string | null; crm_clients: { name: string } | null } | null };
  return {
    settlement: { ...s, beneficiary_name: n.get(s.beneficiary_id)?.name ?? null, approved_by_name: s.approved_by ? n.get(s.approved_by)?.name ?? null : null, reviewed_by_name: s.reviewed_by ? n.get(s.reviewed_by)?.name ?? null : null, pending: money(D(s.approved_amount ?? s.total_gross).minus(s.paid_amount)) },
    lines: ((lines.data ?? []) as LineRow[]).map(({ crm_contracts: k, ...l }) => ({ ...l, client_name: k?.crm_clients?.name ?? null, retailer: k?.retailer ?? null })),
    payments: pays.data ?? [], audit: audit.data ?? [],
    permissions: { staff: await finStaff(u), director: u.profile.role === "admin", own: s.beneficiary_id === u.user.id },
  };
}

export async function settlementStatus(u: U, id: string, status: "revisio" | "esborrany" | "aprovada" | "anullada") {
  await staffOnly(u, "edit");
  if (status === "esborrany" || status === "revisio") await u.sb.rpc("fin_refresh_settlement", { p_id: id });
  const r = await u.sb.from("fin_settlements").update({ status }).eq("id", id).select("id,status,beneficiary_id,code,approved_amount");
  if (r.error) finError(r.error);
  if (!r.data?.length) throw new HttpError(404, "Liquidació no trobada");
  const s = r.data[0];
  if (status === "aprovada") await notify(s.beneficiary_id, { kind: "economia", title: `Liquidació ${s.code} aprovada`, body: `Import aprovat: ${s.approved_amount} €`, link: { view: "liquidacio", params: { id } }, ruleKey: `fin_approved:${id}` });
  if (status === "revisio") {
    const dirs = ((await u.sb.from("profiles").select("id").eq("role", "admin")).data ?? []).map((x) => x.id as string);
    for (const d of dirs) if (d !== s.beneficiary_id) await notify(d, { kind: "economia", title: `Liquidació ${s.code} pendent d'aprovació`, link: { view: "liquidacio", params: { id } }, ruleKey: `fin_review:${id}` });
  }
  return s;
}
export async function deleteDraft(u: U, id: string) {
  await staffOnly(u, "edit");
  const r = await u.sb.from("fin_settlements").delete().eq("id", id).in("status", ["esborrany", "revisio"]).select("id");
  if (r.error) finError(r.error);
  if (!r.data?.length) throw new HttpError(409, "Només es poden eliminar liquidacions en esborrany o revisió");
  return { ok: true };
}
export async function registerPayment(u: U, id: string, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Import no vàlid"), paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.enum(["transferencia", "nomina", "efectiu", "altres"]).default("transferencia"), reference: z.string().trim().min(1, "Indica la referència del pagament").max(120) }), raw);
  if (b.paid_at > today()) throw new HttpError(400, "La data de pagament no pot ser futura");
  const r = await u.sb.from("fin_payments").insert({ settlement_id: id, amount: money(b.amount), paid_at: b.paid_at, method: b.method, reference: b.reference, idempotency_key: `${id}|${b.reference.toLowerCase()}`, created_by: u.user.id }).select("id").single();
  if (r.error) finError(r.error, "No s'ha pogut registrar el pagament");
  return { id: r.data.id };
}
export async function settlementPdf(u: U, id: string) {
  const d = await getSettlement(u, id);
  const s = d.settlement;
  const pdf = buildSettlementPdf({
    code: s.code, kind: s.kind, beneficiary: s.beneficiary_name ?? "—", periodFrom: s.period_from, periodTo: s.period_to, status: s.status,
    totals: { fixed: s.total_fixed, variable: s.total_variable, bonus: s.total_bonus, cancellations: s.total_cancellations, adjustments: s.total_adjustments, gross: s.total_gross, approved: s.approved_amount, paid: s.paid_amount, pending: s.pending },
    lines: d.lines.map((l) => ({ contract: l.retailer, client: l.client_name ? `${l.client_name}${l.retailer ? ` · ${l.retailer}` : ""}` : null, category: l.category, description: l.description, amount: l.amount })),
    payments: (d.payments as { paid_at: string; amount: string; method: string; reference: string }[]),
    approvedBy: s.approved_by_name, approvedAt: s.approved_at, generatedBy: u.profile.name, generatedAt: new Date(),
  });
  if (await finStaff(u)) await u.sb.from("fin_audit").insert({ user_id: u.user.id, user_name: u.profile.name, entity: "liquidacio", entity_id: id, action: "pdf" }).then(() => undefined, () => undefined);
  return { pdf, fileName: `${s.code}-${(s.beneficiary_name ?? "").replace(/[^\w]+/g, "_")}.pdf` };
}

/* ======================================================================= col·laboradors */

export async function collaborators(u: U) {
  const n = await names(u.sb);
  const staff = await finStaff(u);
  if (!staff && u.profile.role !== "colaborador") throw new HttpError(403, "Sense permís");
  const ids = staff ? [...n.values()].filter((p) => p.role === "colaborador").map((p) => p.id) : [u.user.id];
  const [terms, calcs, ledger, sets, clients] = await Promise.all([
    u.sb.from("fin_collaborator_terms").select("*").in("user_id", ids),
    u.sb.from("fin_calculations").select("beneficiary_id,amount,status").eq("layer", "collaborador").eq("is_current", true).in("beneficiary_id", ids),
    u.sb.from("fin_ledger").select("beneficiary_id,kind,amount").eq("layer", "collaborador").in("beneficiary_id", ids),
    u.sb.from("fin_settlements").select("beneficiary_id,status,approved_amount,paid_amount").eq("kind", "collaborador").in("beneficiary_id", ids),
    staff ? u.sb.from("crm_clients").select("id,collaborator_id").in("collaborator_id", ids) : Promise.resolve({ data: [] }),
  ]);
  return {
    rows: ids.map((id) => {
      const L = ((ledger.data ?? []) as { beneficiary_id: string; kind: string; amount: string }[]).filter((x) => x.beneficiary_id === id);
      const S = ((sets.data ?? []) as { beneficiary_id: string; status: string; approved_amount: string | null; paid_amount: string }[]).filter((x) => x.beneficiary_id === id && ["aprovada", "pagada"].includes(x.status));
      return {
        id, name: n.get(id)?.name ?? "—", email: n.get(id)?.email ?? null, terms: (terms.data ?? []).find((t) => t.user_id === id) ?? null,
        clients: ((clients.data ?? []) as { collaborator_id: string }[]).filter((c) => c.collaborator_id === id).length,
        forecast: sum(((calcs.data ?? []) as { beneficiary_id: string; amount: string | null; status: string }[]).filter((c) => c.beneficiary_id === id && c.status === "calculat").map((c) => c.amount)),
        accrued: sum(L.map((x) => x.amount)), approved: sum(S.map((x) => x.approved_amount)), paid: sum(S.map((x) => x.paid_amount)),
        balance: money(D(sum(S.map((x) => x.approved_amount))).minus(sum(S.map((x) => x.paid_amount)))),
      };
    }),
    canManage: await canManageRules(u),
  };
}
export async function saveCollaboratorTerms(u: U, userId: string, raw: unknown) {
  if (!(await canManageRules(u))) throw new HttpError(403, "Només Direcció o la cap d'Administració modifiquen les condicions");
  const b = parse(z.object({ legal_name: z.string().trim().max(160).nullable().optional(), tax_id: z.string().trim().max(20).nullable().optional(), billing_email: z.string().trim().max(160).nullable().optional(), conditions: z.string().trim().max(4000).nullable().optional(), active: z.boolean().default(true) }), raw);
  const r = await u.sb.from("fin_collaborator_terms").upsert({ user_id: userId, ...b, updated_by: u.user.id }, { onConflict: "user_id" });
  if (r.error) finError(r.error);
  return { ok: true };
}

/* ======================================================================= conciliació */

const stmtInput = z.object({
  retailer: z.string().trim().min(1).max(120), reference: z.string().trim().min(1).max(120),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  received_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), declared_total: z.string().regex(/^-?\d+(\.\d{1,2})?$/).nullable().optional(), notes: z.string().max(1000).nullable().optional(),
  rectifies_id: uuid.nullable().optional(), net_settlement: z.boolean().optional(), force: z.boolean().optional(),
  lines: z.array(z.object({ cups: z.string().max(26).nullable().optional(), external_ref: z.string().max(120).nullable().optional(), contract_ref: z.string().max(120).nullable().optional(), client_name: z.string().max(200).nullable().optional(), concept: z.string().max(200).nullable().optional(), amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Import no vàlid") })).max(5000).default([]),
});
type FileIn = { name: string; base64: string };
/** Fase 14: lectura de TOTES les pestanyes amb el lector multicomercialitzadora (Gana, Niba i genèric). */
function readFile(file: FileIn): { bytes: Buffer; sha: string; read: ReadResult } {
  const bytes = Buffer.from(file.base64, "base64");
  if (bytes.byteLength > 5 * 1024 * 1024) throw new HttpError(413, "El fitxer supera 5 MB");
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new HttpError(415, "Formats admesos: XLSX, XLS o CSV. Els PDF de liquidació encara s'han d'entrar a mà.");
  let read: ReadResult;
  try { read = readSettlement(gridFromBytes(XLSX as never, bytes, file.name)); }
  catch { throw new HttpError(400, "No s'ha pogut obrir el fitxer: comprova que és un Excel o CSV vàlid."); }
  return { bytes, sha: createHash("sha256").update(bytes).digest("hex"), read };
}
async function sameFile(u: U, retailer: string, sha: string) {
  const r = await u.sb.from("fin_provider_statements").select("id,reference,received_at,retailer,file_sha256").eq("file_sha256", sha).limit(5);
  if (r.error) return null;                                   // sense la 025: no es pot comprovar (ho farà la base de dades)
  return ((r.data ?? []) as { id: string; reference: string; received_at: string; retailer: string }[]).find((x) => normName(x.retailer) === normName(retailer)) ?? null;
}
/** Previsualització: comercialitzadora detectada, pestanyes, moviments, subtotals i avisos. No desa res. */
export async function previewStatement(u: U, raw: unknown, file?: FileIn) {
  await staffOnly(u, "edit");
  if (!file) throw new HttpError(400, "Tria el fitxer");
  const b = parse(z.object({ retailer: z.string().trim().max(120).optional() }), raw ?? {});
  const { sha, read } = readFile(file);
  const retailer = b.retailer || read.supplier?.name || "";
  const dup = retailer ? await sameFile(u, retailer, sha) : null;
  // canvi de format respecte de l'última liquidació importada de la mateixa comercialitzadora
  let formatChanged: boolean | null = null;
  if (retailer) {
    const prev = await u.sb.from("fin_provider_statements").select("retailer,format_signature,received_at").not("format_signature", "is", null).order("received_at", { ascending: false }).limit(50);
    const last = ((prev.data ?? []) as { retailer: string; format_signature: string }[]).find((x) => normName(x.retailer) === normName(retailer));
    formatChanged = last ? last.format_signature !== read.signature : null;
  }
  return {
    supplier: read.supplier, format: read.format, retailer, sheets: read.sheets, byMovement: read.byMovement, total: read.total, count: read.movements.length,
    errors: read.errors, warnings: [...read.warnings, ...(formatChanged ? ["L'estructura del document és diferent de l'última liquidació d'aquesta comercialitzadora: revisa la lectura abans d'importar-la."] : [])],
    formatChanged, duplicateOf: dup,
    movements: read.movements.slice(0, 400).map((m) => ({ sheet: m.sheet, row: m.row, cups: m.cups ?? (m.phone ? `Tel. ${m.phone}` : m.cupsRaw), gross: m.gross, movement: m.movement, kind: m.kind, energy: m.energy, product: m.product ?? m.tariff, eventDate: m.eventDate, docStatus: m.docStatus, amount: m.amount, unit: m.unit, flags: m.flags })),
  };
}

export async function createStatement(u: U, raw: unknown, file?: FileIn) {
  await staffOnly(u, "edit");
  const b = parse(stmtInput, raw);
  type Row = Record<string, unknown> & { amount: string };
  let rows: Row[] = b.lines.map((l, i) => {
    const pl: ParsedLine = { line_no: i + 1, cups: l.cups?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null, external_ref: l.external_ref || null, contract_ref: l.contract_ref || null, client_name: l.client_name || null, concept: l.concept || null, amount: money(l.amount), kind: D(l.amount).lt(0) ? "retrocessio" : "comissio" };
    return { ...pl, line_hash: sha(lineFingerprint(b.retailer, pl, b.period_to ?? null)) };
  });
  let warnings: string[] = [];
  let meta: Record<string, unknown> = {};
  if (file) {
    const { sha: fileSha, read } = readFile(file);
    if (!read.movements.length) throw new HttpError(400, read.errors.join(" · ") || "No s'ha trobat cap moviment amb import");
    if (read.errors.length && !b.force) throw new HttpError(422, `Revisa la lectura abans d'importar: ${read.errors.join(" · ")}`);
    const dup = await sameFile(u, b.retailer, fileSha);
    if (dup) throw new HttpError(409, `Aquest fitxer ja s'ha importat (liquidació ${dup.reference} del ${dup.received_at}). No s'ha duplicat cap moviment.`);
    rows = read.movements.map((m, i) => ({
      // fibra i mòbil: el document porta el telèfon a la columna del CUPS → es desa com a referència externa, no com a CUPS
      line_no: i + 1, cups: m.cups ?? (m.phone ? null : m.cupsRaw ? m.cupsRaw.slice(0, 26) : null), contract_ref: null, external_ref: m.phone ?? null, client_name: null, concept: m.concept.slice(0, 200), amount: m.amount, kind: m.kind,
      line_hash: sha(movementFingerprint(b.retailer, m, b.period_to ?? null)),
      source_sheet: m.sheet, source_row: m.row, movement: m.movement, energy: m.energy, product: m.product ?? m.tariff, event_date: m.eventDate, activation_date: m.dates.activation,
      doc_status: m.docStatus, unit_qty: m.unit?.qty ?? null, unit_price: m.unit?.price ?? null, stable_key: m.stableKey, flags: m.flags,
    }));
    warnings = [...read.warnings, ...(read.errors.length ? [`Importat amb avisos de lectura: ${read.errors.join(" · ")}`] : [])];
    meta = { file_sha256: fileSha, supplier_format: read.format, format_signature: read.signature, read_summary: { supplier: read.supplier, sheets: read.sheets, byMovement: read.byMovement, total: read.total, errors: read.errors } };
  }
  if (b.rectifies_id) meta.rectifies_id = b.rectifies_id;
  if (b.net_settlement != null) meta.net_settlement = b.net_settlement;
  const ins = await u.sb.from("fin_provider_statements").insert({ retailer: b.retailer, reference: b.reference, period_from: b.period_from ?? null, period_to: b.period_to ?? null, received_at: b.received_at ?? today(), declared_total: b.declared_total ?? null, notes: b.notes ?? null, source: file ? "fitxer" : "manual", file_name: file?.name ?? null, created_by: u.user.id, ...meta }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") throw new HttpError(409, /file/i.test(ins.error.message ?? "") ? "Aquest fitxer ja s'ha importat per a aquesta comercialitzadora." : `Ja s'ha registrat una liquidació de ${b.retailer} amb la referència ${b.reference} (possible duplicat).`);
    finError(ins.error);
  }
  const id = ins.data.id as string;
  try {
    for (let i = 0; i < rows.length; i += 500) { const r = await u.sb.from("fin_statement_lines").insert(rows.slice(i, i + 500).map((x) => ({ ...x, statement_id: id }))); if (r.error) finError(r.error); }
  } catch (e) {
    await u.sb.from("fin_provider_statements").delete().eq("id", id);      // importació a mitges: es desfà sencera
    throw e;
  }
  const declared = b.declared_total != null ? D(b.declared_total) : null;
  const total = sum(rows.map((l) => l.amount));
  if (declared && !declared.minus(total).abs().lte("0.01")) warnings.push(`El total declarat (${money(declared)} €) no coincideix amb la suma de línies (${total} €).`);
  const m = await autoMatch(u, id);
  // Fase 8.2: regularitzacions que poden correspondre a reclamacions obertes (proposta; sempre amb revisió humana)
  const reg = await import("./claims").then((c) => c.proposeRegularizations(u, id)).catch(() => ({ proposals: 0 }));
  return { id, lines: rows.length, total, warnings, ...m, regularizations: reg.proposals };
}

const addD = (d: string, n: number) => { const x = new Date(`${d.slice(0, 10)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
type KCand = { id: string; retailer: string; status: string; start_date: string | null; end_date: string | null; product: string | null; previous_contract_id: string | null; supply_id: string | null; client: string | null };
type Match = { contractId: string | null; confidence: "inequivoca" | "probable" | "multiple" | "cap"; reason: string; candidates: { id: string; label: string; suggested?: boolean }[] };
/* ----------------------------------------------------------------------- dades per identificar (en bloc) */

type SupRow = { id: string; cups: string; cups20: string | null; client_id: string; energy_type: string; archived_at: string | null; client: string | null };
type MatchCtx = { supplies: Map<string, SupRow[]>; contracts: Map<string, KCand[]>; calcs: Map<string, { amount: string | null; status: string; breakdown?: unknown }> };
/** Repeteix una consulta per blocs d'identificadors (evita URL massa llargues i una consulta per línia). */
async function inChunks<T>(build: (vals: string[]) => PromiseLike<{ data: unknown; error: PgError }>, vals: string[], size = 150): Promise<T[]> {
  const out: T[] = [];
  const uniq = [...new Set(vals.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += size) {
    const r = await build(uniq.slice(i, i + size));
    if (r.error) finError(r.error, "No s'han pogut carregar les dades per identificar les línies");
    out.push(...((r.data ?? []) as T[]));
  }
  return out;
}
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
/**
 * Carrega d'una vegada tot el que cal per identificar unes línies: subministraments pel CUPS (columna indexada
 * cups20 = els 20 primers caràcters, amb sufix 0F/1P o sense), els seus contractes i el càlcul vigent de cada contracte.
 * Abans es feien diverses consultes per línia i una liquidació de 86 línies superava el temps màxim (error 504).
 */
async function loadMatchCtx(u: U, cupsList: (string | null)[]): Promise<MatchCtx> {
  const bases = cupsList.map((c) => (c ? cupsBase(normCups(c) ?? c.toUpperCase().replace(/[^A-Z0-9]/g, "")) : null)).filter((x): x is string => !!x);
  const sups = await inChunks<Omit<SupRow, "client"> & { crm_clients: { name: string } | { name: string }[] | null }>((v) => u.sb.from("crm_supplies").select("id,cups,cups20,client_id,energy_type,archived_at,crm_clients(name)").in("cups20", v), bases);
  const supplies = new Map<string, SupRow[]>();
  for (const x of sups) {
    const b = cupsBase(normCups(x.cups) ?? x.cups.toUpperCase().replace(/[^A-Z0-9]/g, ""))!;
    const row: SupRow = { id: x.id, cups: x.cups, cups20: x.cups20, client_id: x.client_id, energy_type: x.energy_type, archived_at: x.archived_at, client: one(x.crm_clients)?.name ?? null };
    supplies.set(b, [...(supplies.get(b) ?? []), row].sort((a, c) => Number(!!a.archived_at) - Number(!!c.archived_at)));
  }
  const ks = await inChunks<Omit<KCand, "client"> & { crm_clients: { name: string } | { name: string }[] | null }>((v) => u.sb.from("crm_contracts").select("id,retailer,status,start_date,end_date,product,previous_contract_id,supply_id,crm_clients(name)").in("supply_id", v).neq("status", "esborrany"), sups.map((x) => x.id));
  const contracts = new Map<string, KCand[]>();
  for (const { crm_clients: c, ...k } of ks) if (k.supply_id) contracts.set(k.supply_id, [...(contracts.get(k.supply_id) ?? []), { ...k, client: one(c)?.name ?? null }].sort((a, b) => String(b.start_date ?? "").localeCompare(String(a.start_date ?? ""))));
  const cs = await inChunks<{ contract_id: string; amount: string | null; status: string; breakdown: unknown }>((v) => u.sb.from("fin_calculations").select("contract_id,amount,status,breakdown").in("contract_id", v).eq("layer", "proveidor").eq("is_current", true), ks.map((k) => k.id));
  return { supplies, contracts, calcs: new Map(cs.map((c) => [c.contract_id, { amount: c.amount, status: c.status, breakdown: c.breakdown }])) };
}

/**
 * Fase 14 · Vinculació amb nivells de confiança. Ordre: referència de la comercialitzadora → CUPS normalitzat (amb o
 * sense el sufix 0F/1P) → comercialitzadora → tipus de moviment (alta o renovació) → dates → producte.
 * Només es vincula automàticament quan queda UN sol contracte. Si n'hi ha diversos, es proposa o es demana triar.
 */
async function matchLine(u: U, ctx: MatchCtx, retailer: { name: string; row: { trade_name: string; aliases: string[] | null } | null }, l: { cups: string | null; external_ref: string | null; contract_ref: string | null; movement?: string | null; event_date?: string | null; activation_date?: string | null; product?: string | null }): Promise<Match> {
  if (l.contract_ref && uuid.safeParse(l.contract_ref).success) {
    const k = (await u.sb.from("crm_contracts").select("id").eq("id", l.contract_ref).maybeSingle()).data;
    if (k) return { contractId: k.id as string, confidence: "inequivoca", reason: "Identificador del contracte al CRM", candidates: [] };
  }
  if (l.external_ref) {
    const ref = l.external_ref.trim();
    const e = (await u.sb.from("crm_expedients").select("contract_id").or(`external_ref.eq.${ref},activation_ref.eq.${ref}`).not("contract_id", "is", null).limit(2)).data ?? [];
    const r2 = e.length ? null : (await u.sb.from("crm_expedient_refs").select("crm_expedients(contract_id)").eq("ref", ref).limit(2)).data?.[0] as { crm_expedients: { contract_id: string | null } | null } | undefined;
    const ids = [...new Set([...e.map((x) => x.contract_id as string), r2?.crm_expedients?.contract_id].filter(Boolean) as string[])];
    if (ids.length === 1) return { contractId: ids[0], confidence: "inequivoca", reason: `Referència de la comercialitzadora ${ref}`, candidates: [] };
  }
  const cups = normCups(l.cups) ?? l.cups;
  if (!cups && l.external_ref && /^[6789]\d{8}$/.test(l.external_ref.trim())) return { contractId: null, confidence: "cap", reason: `Línia de telecomunicacions (tel. ${l.external_ref.trim()}): cap expedient del CRM té aquest número com a referència. Assigna-la a mà.`, candidates: [] };
  if (!cups) return { contractId: null, confidence: "cap", reason: "La línia no té CUPS ni cap referència per identificar el contracte.", candidates: [] };
  const same = ctx.supplies.get(cupsBase(cups)!) ?? [];
  if (!same.length) return { contractId: null, confidence: "cap", reason: `Cap subministrament del CRM té el CUPS ${cups}.`, candidates: [] };
  const all: KCand[] = same.flatMap((x) => ctx.contracts.get(x.id) ?? []);
  const mine = all.filter((k) => normName(k.retailer) === normName(retailer.name) || (retailer.row && matchesRetailer(k.retailer, retailer.row)));
  const label = (k: KCand) => `${k.client ?? "—"} · ${k.retailer}${k.product ? ` · ${k.product}` : ""} · ${k.previous_contract_id ? "renovació" : "alta"} · des del ${k.start_date ?? "—"}`;
  if (!mine.length) return { contractId: null, confidence: "cap", reason: `El CUPS és al CRM, però cap contracte és de ${retailer.name}${all.length ? ` (n'hi ha ${all.length} d'altres comercialitzadores)` : ""}.`, candidates: [] };
  const why = [`CUPS ${cups}`, retailer.name];
  let pool = mine;
  if (pool.length > 1 && l.movement === "renovacio" && pool.some((k) => k.previous_contract_id)) { pool = pool.filter((k) => k.previous_contract_id); why.push("contracte de renovació"); }
  if (pool.length > 1 && l.movement === "alta" && pool.some((k) => !k.previous_contract_id)) { pool = pool.filter((k) => !k.previous_contract_id); why.push("contracte d'alta (no renovació)"); }
  const act = l.activation_date ?? (l.movement === "alta" ? l.event_date : null);
  if (pool.length > 1 && act && l.movement !== "renovacio") {
    const near = pool.filter((k) => k.start_date && k.start_date >= addD(act, -45) && k.start_date <= addD(act, 45));
    if (near.length) { pool = near; why.push(`inici del contracte proper a l'activació (${act})`); }
  }
  if (pool.length > 1 && l.event_date && (l.movement === "retrocessio" || l.movement === "baixa")) {
    const live = pool.filter((k) => (!k.start_date || k.start_date <= l.event_date!) && (!k.end_date || k.end_date >= addD(l.event_date!, -45)));
    if (live.length) { pool = live; why.push(`vigent en la data de baixa (${l.event_date})`); }
  }
  if (pool.length === 1) return { contractId: pool[0].id, confidence: "inequivoca", reason: why.join(" · "), candidates: [] };
  const byProduct = l.product ? pool.filter((k) => k.product && (normName(k.product).includes(normName(l.product!)) || normName(l.product!).includes(normName(k.product)))) : [];
  if (byProduct.length === 1) return { contractId: null, confidence: "probable", reason: `${pool.length} contractes compatibles; proposta pel producte «${l.product}». Cal confirmar-la.`, candidates: pool.map((k) => ({ id: k.id, label: label(k), suggested: k.id === byProduct[0].id })) };
  return { contractId: null, confidence: "multiple", reason: `${pool.length} contractes compatibles amb ${why.join(" · ")}: tria'n un (no s'assigna automàticament).`, candidates: pool.slice(0, 10).map((k) => ({ id: k.id, label: label(k) })) };
}
/** Actualitza una línia; si la 025 encara no és aplicada, ho torna a provar sense les columnes noves. */
async function updLine(u: U, id: string, patch: Record<string, unknown>, extra: Record<string, unknown>) {
  const r = await u.sb.from("fin_statement_lines").update({ ...patch, ...extra }).eq("id", id);
  if (r.error && Object.keys(extra).length) { const r2 = await u.sb.from("fin_statement_lines").update(patch).eq("id", id); if (r2.error) finError(r2.error); }
  else if (r.error) finError(r.error);
}
/** Executa tasques amb un màxim de `n` alhora (les actualitzacions de línies no s'esperen una a una). */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}

/**
 * CONFIGURACIÓ COMERCIAL VINCULADA AL CONTRACTE (matriu Nufri). En activar l'expedient, es congela: tarifa i versió
 * del catàleg, nivell d'energia, marge BOE, potències, consum anual, preus acceptats, comissió prevista (energia i
 * potència per separat, amb la regla vigent) i el col·laborador amb el seu percentatge. No es reescriu mai: els canvis
 * posteriors del catàleg o de les regles no modifiquen retroactivament el contracte.
 */
export async function linkCommercialToContract(contractId: string, expedientId: string, userId: string | null): Promise<CommercialEcon | null> {
  const sb = adminClient();
  const cur = (await sb.from("fin_contract_economics").select("commercial").eq("contract_id", contractId).maybeSingle()).data as { commercial?: CommercialEcon | null } | null;
  if (cur?.commercial) return cur.commercial; // ja vinculada: no es toca
  const e = (await sb.from("crm_expedients").select("id,client_id,accepted_terms_id,comparison_id,collaborator_id").eq("id", expedientId).maybeSingle()).data as { id: string; client_id: string; accepted_terms_id: string | null; comparison_id: string | null; collaborator_id: string | null } | null;
  if (!e) return null;
  const terms = e.accepted_terms_id ? (await sb.from("crm_expedient_terms").select("comparison_id,conditions").eq("id", e.accepted_terms_id).maybeSingle()).data as { comparison_id: string | null; conditions: { offer_ref?: { offer_id?: string } | null } } | null : null;
  const compId = terms?.comparison_id ?? e.comparison_id;
  if (!compId) return null;
  const k = (await sb.from("comparisons").select("id,snapshot").eq("id", compId).maybeSingle()).data as { id: string; snapshot: Snapshot } | null;
  if (!k) return null;
  const snap = k.snapshot;
  const offerId = terms?.conditions?.offer_ref?.offer_id ?? snap.result?.ranked?.[0]?.offer.id ?? null;
  const o = snap.offers?.find((x) => x.id === offerId);
  if (!o?.commercial) return null;
  const sel = selectionOf(o, snap.adjustments?.[o.id]?.commercial ?? null)!;
  const level = levelOf(o.commercial, sel.level);
  const margin = marginOf(o.commercial, sel.margin);
  const s = snap.supply;
  const per = periodsOf(s.accessTariff, s.energyType);
  const kwhSum = s.kwh.slice(0, per.energy).every((x) => x != null) ? s.kwh.slice(0, per.energy).reduce<number>((a, x) => a + (x ?? 0), 0) : s.kwhTotal;
  const annualKwh = kwhSum == null ? null : s.basis === "anual" ? kwhSum : Math.round((kwhSum * 365) / s.days);
  // regla vigent del nivell (energia €/MWh) i percentatge del col·laborador
  const key = `nufri_${o.energyType === "gas" ? `gas_${(o.accessTariff ?? "").replace(/\W/g, "").toLowerCase()}_${level.id.toLowerCase()}_fix` : `llum_${level.id.toLowerCase()}`}`;
  const rule = ((await sb.from("fin_rules").select("id,version,value,status").eq("rule_key", key).in("status", ["aprovada", "pendent_aprovacio"]).order("version", { ascending: false }).limit(1)).data ?? [])[0] as { id: string; version: number; value: string | null; status: string } | undefined;
  const client = (await sb.from("crm_clients").select("collaborator_id").eq("id", e.client_id).maybeSingle()).data as { collaborator_id: string | null } | null;
  const collaboratorId = e.collaborator_id ?? client?.collaborator_id ?? null;
  const cRules = collaboratorId ? ((await sb.from("fin_rules").select("id,version,value,beneficiary_id").eq("layer", "collaborador").eq("status", "aprovada").eq("kind", "pct_comissio_rebuda").order("version", { ascending: false })).data ?? []) as { id: string; version: number; value: string | null; beneficiary_id: string | null }[] : [];
  const cRule = cRules.find((r) => r.beneficiary_id === collaboratorId) ?? cRules.find((r) => !r.beneficiary_id) ?? null;
  const c = commercialCommission({ annualKwh, kw: s.kw, accessTariff: s.accessTariff, energyType: s.energyType, energyEurMwh: rule?.value != null ? Number(rule.value) : null, marginEurKwYear: margin?.eurKwYear ?? null, collaboratorPct: cRule?.value != null ? Number(cRule.value) : null });
  const commercial: CommercialEcon = {
    scheme: "nufri", catalog_version_id: o.id, catalog_version: o.version, product_id: o.productId || null, tariff: o.accessTariff,
    level: level.id, level_label: level.label, margin: margin?.id ?? null, margin_eur_kw_year: margin?.eurKwYear ?? null,
    power_kw: s.kw.slice(0, Math.max(1, per.power)), annual_kwh: annualKwh, prices: { energy: o.energy, energy24h: o.energy24h, power: o.power },
    forecast: { energy: c.energy, power: c.power, total: c.total, collaborator: c.collaborator, remainder: c.remainder, status: !rule ? "sense_regla" : rule.status === "aprovada" ? "previst" : "pendent_aprovacio_regla", rule_id: rule?.id ?? null, rule_version: rule?.version ?? null },
    collaborator_id: collaboratorId, collaborator_pct: cRule?.value ?? null, collaborator_rule_id: cRule?.id ?? null, collaborator_rule_version: cRule?.version ?? null,
    linked_at: new Date().toISOString(), linked_by: userId, comparison_id: k.id,
  };
  const prev = (await sb.from("fin_contract_economics").select("contract_id,product_modality").eq("contract_id", contractId).maybeSingle()).data as { product_modality: string | null } | null;
  const row = { contract_id: contractId, commercial, ...(prev?.product_modality ? {} : { product_modality: level.label }), updated_by: userId };
  const r = prev ? await sb.from("fin_contract_economics").update(row).eq("contract_id", contractId) : await sb.from("fin_contract_economics").insert(row);
  if (r.error) finError(r.error, "No s'ha pogut vincular la configuració comercial al contracte");
  return commercial;
}

/**
 * Import esperat d'una línia de liquidació: si la línia és només d'energia o només de potència (matriu Nufri) i el
 * càlcul previst té els dos components separats, es compara amb el component corresponent; si no, amb el total.
 */
export function expectedFor(calc: { amount: string | null; breakdown?: unknown }, concept: string | null): string | null {
  const lines = Array.isArray(calc.breakdown) ? (calc.breakdown as { component?: string; value?: string }[]) : [];
  const comp = (k: "energia" | "potencia") => {
    const v = lines.find((x) => x.component === k)?.value;
    return v ? v.replace(/\s*€$/, "").trim() : null;
  };
  const c = (concept ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/potencia|\bboe\b|termino de potencia/.test(c) && !/energia/.test(c)) return comp("potencia") ?? calc.amount;
  if (/energia/.test(c) && !/potencia/.test(c)) return comp("energia") ?? calc.amount;
  return calc.amount;
}

export async function autoMatch(u: U, statementId: string) {
  await staffOnly(u, "edit");
  const st = (await u.sb.from("fin_provider_statements").select("*").eq("id", statementId).maybeSingle()).data;
  if (!st) throw new HttpError(404, "Liquidació del proveïdor no trobada");
  const rr = await u.sb.from("retailers").select("trade_name,aliases");
  const retailerRow = ((rr.data ?? []) as { trade_name: string; aliases: string[] | null }[]).find((r) => matchesRetailer(st.retailer as string, r)) ?? null;
  const lines = ((await u.sb.from("fin_statement_lines").select("*").eq("statement_id", statementId).order("line_no")).data ?? []) as { id: string; line_no: number; cups: string | null; contract_ref: string | null; external_ref: string | null; amount: string; kind: string; contract_id: string | null; match_status: string; line_hash: string; movement?: string | null; event_date?: string | null; activation_date?: string | null; product?: string | null; match_confidence?: string | null }[];
  const open = lines.filter((l) => !["conciliat", "descartat"].includes(l.match_status));
  // duplicats: totes les línies amb les mateixes empremtes, en una sola consulta per bloc
  const same = await inChunks<{ id: string; statement_id: string; line_no: number; match_status: string; line_hash: string }>((v) => u.sb.from("fin_statement_lines").select("id,statement_id,line_no,match_status,line_hash").in("line_hash", v).neq("match_status", "descartat"), open.map((l) => l.line_hash));
  const ctx = await loadMatchCtx(u, open.map((l) => l.cups));
  const known = open.map((l) => l.contract_id).filter((x): x is string => !!x && !ctx.calcs.has(x));
  for (const c of await inChunks<{ contract_id: string; amount: string | null; status: string; breakdown: unknown }>((v) => u.sb.from("fin_calculations").select("contract_id,amount,status,breakdown").in("contract_id", v).eq("layer", "proveidor").eq("is_current", true), known)) ctx.calcs.set(c.contract_id, { amount: c.amount, status: c.status, breakdown: c.breakdown });
  const counts: Record<string, number> = {};
  const add = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  for (const l of lines) if (["conciliat", "descartat"].includes(l.match_status)) add(l.match_status);
  const jobs: { id: string; patch: Record<string, unknown>; extra: Record<string, unknown> }[] = [];
  for (const l of open) {
    const original = same.find((x) => x.line_hash === l.line_hash && x.id !== l.id && (x.statement_id !== statementId || x.line_no < l.line_no));
    if (original) {
      jobs.push({ id: l.id, patch: { match_status: "duplicat", duplicate_of: original.id }, extra: { match_reason: original.statement_id === statementId ? "Mateix moviment repetit dins del document" : "Mateix moviment ja present en una altra liquidació" } });
      add("duplicat"); continue;
    }
    let contractId = l.contract_id;
    let m: Match | null = null;
    if (!contractId) { m = await matchLine(u, ctx, { name: st.retailer as string, row: retailerRow }, l); contractId = m.contractId; }
    const extra = m ? { match_confidence: m.confidence, match_reason: m.reason, match_candidates: m.candidates } : {};
    if (!contractId) {
      const k = m && m.candidates.length ? "pendent" : "no_identificat";
      jobs.push({ id: l.id, patch: { match_status: k, contract_id: null }, extra }); add(k); continue;
    }
    const calc = ctx.calcs.get(contractId);
    // energia i potència es concilien per separat quan la liquidació les separa (matriu Nufri)
    const expected = l.kind === "comissio" && calc?.status === "calculat" ? expectedFor(calc, (l as { concept?: string | null }).concept ?? null) : null;
    const rc = l.kind === "comissio" ? reconcile(l.amount, expected) : { status: "identificat" as const, difference: null };
    jobs.push({ id: l.id, patch: { contract_id: contractId, expected_amount: expected, difference: rc.difference, match_status: rc.status }, extra });
    add(rc.status);
  }
  await pool(jobs, 8, (j) => updLine(u, j.id, j.patch, j.extra));
  await refreshStatementStatus(u, statementId);
  return { matched: counts };
}
async function refreshStatementStatus(u: U, statementId: string) {
  const ls = ((await u.sb.from("fin_statement_lines").select("match_status").eq("statement_id", statementId)).data ?? []) as { match_status: string }[];
  const done = ls.filter((l) => ["conciliat", "descartat", "duplicat"].includes(l.match_status)).length;
  await u.sb.from("fin_provider_statements").update({ status: ls.length && done === ls.length ? "conciliada" : done ? "en_conciliacio" : "registrada" }).eq("id", statementId);
}

export async function resolveLine(u: U, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ lineId: uuid, action: z.enum(["conciliar", "assignar", "descartar", "reobrir"]), contractId: uuid.nullable().optional(), note: z.string().trim().max(500).optional() }), raw);
  const l = (await u.sb.from("fin_statement_lines").select("*, fin_provider_statements(retailer,reference,received_at)").eq("id", b.lineId).maybeSingle()).data as ({ id: string; statement_id: string; amount: string; kind: string; contract_id: string | null; match_status: string; difference: string | null; client_name: string | null; fin_provider_statements: { retailer: string; reference: string; received_at: string } }) | null;
  if (!l) throw new HttpError(404, "Línia no trobada");
  if (l.match_status === "conciliat" && b.action !== "reobrir") throw new HttpError(409, "Aquesta línia ja està conciliada");
  if (b.action === "assignar") {
    if (!b.contractId) throw new HttpError(400, "Tria el contracte");
    await updLine(u, l.id, { contract_id: b.contractId, match_status: "pendent", note: b.note ?? null }, { match_confidence: "manual", match_reason: `Assignada manualment per ${u.profile.name}`, match_candidates: [] });
    await autoMatch(u, l.statement_id);
    return { ok: true };
  }
  if (b.action === "descartar") {
    if (!b.note) throw new HttpError(400, "Indica per què es descarta la línia");
    await u.sb.from("fin_statement_lines").update({ match_status: "descartat", note: b.note, resolved_by: u.user.id, resolved_at: new Date().toISOString() }).eq("id", l.id);
    await refreshStatementStatus(u, l.statement_id);
    return { ok: true };
  }
  if (b.action === "reobrir") {
    if (l.match_status === "conciliat") throw new HttpError(409, "Una línia conciliada ja té moviments: registra un ajustament en lloc de reobrir-la.");
    await u.sb.from("fin_statement_lines").update({ match_status: "pendent", note: b.note ?? null }).eq("id", l.id);
    await autoMatch(u, l.statement_id);
    return { ok: true };
  }
  if (!l.contract_id) throw new HttpError(400, "Assigna primer la línia a un contracte");
  if (l.match_status === "duplicat") throw new HttpError(409, "Línia marcada com a duplicada: revisa-la abans de conciliar.");
  if (l.match_status === "diferencia" && !b.note) throw new HttpError(400, `Hi ha una diferència de ${l.difference} € respecte de l'estimat: indica el motiu per conciliar-la.`);
  const k = (await u.sb.from("crm_contracts").select("client_id,owner_id").eq("id", l.contract_id).single()).data!;
  const kind = l.kind === "comissio" ? "confirmacio" : l.kind;
  // Fase 14: un import zero és un moviment documental vàlid, però no genera cap moviment econòmic
  if (D(l.amount).isZero()) {
    await u.sb.from("fin_statement_lines").update({ match_status: "conciliat", note: b.note ?? "Import zero: sense moviment econòmic", resolved_by: u.user.id, resolved_at: new Date().toISOString() }).eq("id", l.id);
    await refreshStatementStatus(u, l.statement_id);
    return { ok: true };
  }
  await insertLedger(u, { contract_id: l.contract_id, client_id: k.client_id, layer: "proveidor", kind, amount: l.amount, period: l.fin_provider_statements.received_at, statement_line_id: l.id, description: `${kind === "confirmacio" ? "Comissió comunicada" : kind === "retrocessio" ? "Retrocessió comunicada" : "Ajust comunicat"} per ${l.fin_provider_statements.retailer} · ${l.fin_provider_statements.reference}${b.note ? ` · ${b.note}` : ""}`, idempotency_key: `conf:${l.id}` });
  await u.sb.from("fin_statement_lines").update({ match_status: "conciliat", note: b.note ?? null, resolved_by: u.user.id, resolved_at: new Date().toISOString() }).eq("id", l.id);
  if (kind === "retrocessio") {
    const staff = ((await u.sb.from("profiles").select("id").in("role", ["admin", "cap_administrativa"])).data ?? []).map((x) => x.id as string);
    for (const s of staff) await notify(s, { kind: "economia", title: `Possible retrocessió: ${l.client_name ?? "contracte"}`, body: `${l.fin_provider_statements.retailer} comunica ${l.amount} €. Revisa la comissió comercial.`, link: { view: "economia", params: { contract: l.contract_id } }, ruleKey: `fin_retro:${l.id}` });
    if (k.owner_id) await notify(k.owner_id, { kind: "economia", title: `Possible retrocessió: ${l.client_name ?? "contracte"}`, body: "Administració ho revisarà abans de cap descompte.", link: { view: "liquidacions", params: {} }, ruleKey: `fin_retro:${l.id}` });
  }
  await refreshStatementStatus(u, l.statement_id);
  await syncLegacy(l.contract_id);
  return { ok: true };
}

/* ======================================================================= Fase 14.4 · conciliar-ho tot */

/**
 * Concilia d'un sol cop totes les línies identificades d'una liquidació (mateix efecte que «Concilia» línia a línia).
 * Les que tenen diferència respecte de la comissió prevista només s'hi inclouen si es demana, amb un motiu comú.
 * Mai no es concilien les línies sense contracte, duplicades, per triar contracte o descartades.
 * Conciliar NO vol dir cobrar: el cobrament es confirma després amb la referència bancària.
 */
export async function conciliateAll(u: U, statementId: string, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ includeDifferences: z.boolean().default(false), note: z.string().trim().max(500).optional() }), raw);
  if (b.includeDifferences && (!b.note || b.note.length < 3)) throw new HttpError(400, "Indica el motiu de les diferències per conciliar-les (s'aplicarà a totes).");
  const st = (await u.sb.from("fin_provider_statements").select("id,retailer,reference,received_at").eq("id", statementId).maybeSingle()).data as { id: string; retailer: string; reference: string; received_at: string } | null;
  if (!st) throw new HttpError(404, "Liquidació del proveïdor no trobada");
  type L = { id: string; amount: string; kind: string; contract_id: string | null; match_status: string; client_name: string | null };
  const all = ((await u.sb.from("fin_statement_lines").select("id,amount,kind,contract_id,match_status,client_name").eq("statement_id", statementId)).data ?? []) as L[];
  const ok = (l: L) => !!l.contract_id && (l.match_status === "identificat" || (b.includeDifferences && l.match_status === "diferencia"));
  const todo = all.filter(ok);
  const skipped = { diferencia: all.filter((l) => l.match_status === "diferencia" && !b.includeDifferences).length, sense_contracte: all.filter((l) => !l.contract_id && !["descartat", "duplicat", "conciliat"].includes(l.match_status)).length, duplicat: all.filter((l) => l.match_status === "duplicat").length };
  if (!todo.length) return { conciliated: 0, amount: "0.00", skipped };
  const ks = await inChunks<{ id: string; client_id: string; owner_id: string | null }>((v) => u.sb.from("crm_contracts").select("id,client_id,owner_id").in("id", v), todo.map((l) => l.contract_id!));
  const kmap = new Map(ks.map((k) => [k.id, k]));
  const usable = todo.filter((l) => kmap.has(l.contract_id!));
  // moviments econòmics (el mateix que «Concilia»), per blocs; la clau d'idempotència evita duplicats si es repeteix
  const rows = usable.filter((l) => !D(l.amount).isZero()).map((l) => {
    const kind = l.kind === "comissio" ? "confirmacio" : l.kind;
    const note = l.match_status === "diferencia" ? b.note : null;
    return { contract_id: l.contract_id, client_id: kmap.get(l.contract_id!)!.client_id, layer: "proveidor", kind, amount: l.amount, period: st.received_at, statement_line_id: l.id,
      description: `${kind === "confirmacio" ? "Comissió comunicada" : kind === "retrocessio" ? "Retrocessió comunicada" : "Ajust comunicat"} per ${st.retailer} · ${st.reference}${note ? ` · ${note}` : ""} (conciliació conjunta)`,
      idempotency_key: `conf:${l.id}`, created_by: u.user.id, created_by_name: u.profile.name };
  });
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const r = await u.sb.from("fin_ledger").insert(chunk);
    if (r.error) {
      if (r.error.code !== "23505") finError(r.error);
      await pool(chunk, 6, async (x) => { await insertLedger(u, x); });             // algun ja existia: d'un en un (s'ignoren els repetits)
    }
  }
  const now = new Date().toISOString();
  const plain = usable.filter((l) => l.match_status === "identificat").map((l) => l.id);
  const diff = usable.filter((l) => l.match_status === "diferencia").map((l) => l.id);
  for (let i = 0; i < plain.length; i += 150) { const r = await u.sb.from("fin_statement_lines").update({ match_status: "conciliat", resolved_by: u.user.id, resolved_at: now }).in("id", plain.slice(i, i + 150)); if (r.error) finError(r.error); }
  for (let i = 0; i < diff.length; i += 150) { const r = await u.sb.from("fin_statement_lines").update({ match_status: "conciliat", note: b.note ?? null, resolved_by: u.user.id, resolved_at: now }).in("id", diff.slice(i, i + 150)); if (r.error) finError(r.error); }
  // avisos de retrocessió (com a la conciliació d'una línia)
  const retros = usable.filter((l) => l.kind === "retrocessio" && !D(l.amount).isZero());
  if (retros.length) {
    const staff = ((await u.sb.from("profiles").select("id").in("role", ["admin", "cap_administrativa"])).data ?? []).map((x) => x.id as string);
    await pool(retros, 4, async (l) => {
      for (const sId of staff) await notify(sId, { kind: "economia", title: `Possible retrocessió: ${l.client_name ?? "contracte"}`, body: `${st.retailer} comunica ${l.amount} €. Revisa la comissió comercial.`, link: { view: "economia", params: { contract: l.contract_id! } }, ruleKey: `fin_retro:${l.id}` });
      const owner = kmap.get(l.contract_id!)?.owner_id;
      if (owner) await notify(owner, { kind: "economia", title: `Possible retrocessió: ${l.client_name ?? "contracte"}`, body: "Administració ho revisarà abans de cap descompte.", link: { view: "liquidacions", params: {} }, ruleKey: `fin_retro:${l.id}` });
    });
  }
  await refreshStatementStatus(u, statementId);
  await pool([...new Set(usable.map((l) => l.contract_id!))], 6, (c) => syncLegacy(c));
  return { conciliated: usable.length, amount: sum(usable.map((l) => l.amount)), skipped };
}

/* ======================================================================= Fase 14.2 · contractes que falten */

type LineForK = { id: string; line_no: number; cups: string | null; amount: string; kind: string; contract_id: string | null; match_status: string; movement?: string | null; event_date?: string | null; activation_date?: string | null; product?: string | null; energy?: string | null; source_sheet?: string | null; source_row?: number | null };
const RETRO = ["retrocessio", "baixa"];
/** Un contracte actiu necessita data de fi: la liquidació no la diu, s'estima a 12 mesos (es diu a les notes). */
const plusYear = (d: string | null) => { if (!d) return null; const x = new Date(`${d}T12:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + 1); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const END_NOTE = " Data de fi estimada a 12 mesos de l'activació (la liquidació no la indica): revisa-la.";
/** Nom de la comercialitzadora tal com és al CRM (fitxa de comercialitzadora), o el de la liquidació. */
async function canonicalRetailer(u: U, name: string) {
  const rr = await u.sb.from("retailers").select("trade_name,aliases");
  return ((rr.data ?? []) as { trade_name: string; aliases: string[] | null }[]).find((r) => matchesRetailer(name, r))?.trade_name ?? name;
}
/** Subministrament del CRM per al CUPS (amb el sufix 0F/1P o sense). */
async function supplyFor(u: U, cups: string) {
  const base = cupsBase(normCups(cups) ?? cups)!;
  const r = ((await u.sb.from("crm_supplies").select("id,cups,client_id,energy_type,archived_at,crm_clients(name)").eq("cups20", base).limit(5)).data ?? []) as { id: string; cups: string; client_id: string; energy_type: string; archived_at: string | null; crm_clients: { name: string } | { name: string }[] | null }[];
  return r.filter((x) => cupsBase(normCups(x.cups) ?? x.cups.toUpperCase().replace(/[^A-Z0-9]/g, "")) === base).sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at))[0] ?? null;
}

/**
 * Proposta: línies de la liquidació el CUPS de les quals és al CRM però sense cap contracte d'aquesta comercialitzadora
 * (habitualment, un canvi de comercialitzadora que encara no s'ha registrat al CRM). No es crea res.
 */
export async function missingContracts(u: U, statementId: string) {
  await staffOnly(u);
  const st = (await u.sb.from("fin_provider_statements").select("id,retailer,reference").eq("id", statementId).maybeSingle()).data as { id: string; retailer: string; reference: string } | null;
  if (!st) throw new HttpError(404, "Liquidació del proveïdor no trobada");
  const retailer = await canonicalRetailer(u, st.retailer);
  const lines = ((await u.sb.from("fin_statement_lines").select("*").eq("statement_id", statementId).order("line_no")).data ?? []) as LineForK[];
  const open = lines.filter((l) => !l.contract_id && l.cups && !["conciliat", "descartat", "duplicat"].includes(l.match_status));
  const groups = new Map<string, LineForK[]>();
  for (const l of open) { const k = cupsBase(normCups(l.cups) ?? l.cups)!; groups.set(k, [...(groups.get(k) ?? []), l]); }
  const proposals: { cups: string; supplyId: string; clientId: string; client: string; energy: string; current: { id: string; retailer: string; status: string; start_date: string | null; end_date: string | null }[]; lines: { id: string; line_no: number; movement: string | null; amount: string; origin: string | null }[]; status: "actiu" | "finalitzat"; start: string | null; end: string | null; product: string | null }[] = [];
  const notInCrm: { cups: string; lines: number[] }[] = [];
  const ctx = await loadMatchCtx(u, [...groups.keys()]);
  for (const [cups, ls] of groups) {
    const sup0 = (ctx.supplies.get(cups) ?? [])[0];
    if (!sup0) { notInCrm.push({ cups, lines: ls.map((l) => l.line_no) }); continue; }
    const sup = { ...sup0, crm_clients: sup0.client ? { name: sup0.client } : null };
    const ks = ctx.contracts.get(sup.id) ?? [];
    if (ks.some((k) => normName(k.retailer) === normName(retailer) || normName(k.retailer) === normName(st.retailer))) continue;   // ja n'hi ha: es resol tornant a identificar
    const live = ls.filter((l) => !RETRO.includes(l.movement ?? "") && l.kind !== "retrocessio");
    const ref = (live[0] ?? ls[0]);
    const start = ls.map((l) => l.activation_date ?? (RETRO.includes(l.movement ?? "") ? null : l.event_date)).filter(Boolean).sort()[0] ?? null;
    const end = live.length ? null : ls.map((l) => l.event_date).filter(Boolean).sort().pop() ?? null;
    proposals.push({
      cups: sup.cups, supplyId: sup.id, clientId: sup.client_id, client: (Array.isArray(sup.crm_clients) ? sup.crm_clients[0]?.name : sup.crm_clients?.name) ?? "—", energy: sup.energy_type,
      current: ks, lines: ls.map((l) => ({ id: l.id, line_no: l.line_no, movement: l.movement ?? null, amount: money(l.amount), origin: l.source_sheet ? `${l.source_sheet} · fila ${l.source_row}` : null })),
      status: live.length ? "actiu" : "finalitzat", start, end, product: ref.product ?? null,
    });
  }
  return { retailer, reference: st.reference, proposals, notInCrm };
}

/**
 * Crea al CRM els contractes de la comercialitzadora que falten (un per CUPS) i torna a identificar la liquidació.
 * Les altes i renovacions creen un contracte ACTIU des de la data d'activació; si només hi ha retrocomissions,
 * el contracte es crea FINALITZAT a la data de baixa. El contracte anterior (d'una altra comercialitzadora) només es
 * tanca si es demana expressament. Tot queda a l'activitat del client.
 */
export async function createMissingContracts(u: U, statementId: string, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ cups: z.array(z.string().max(30)).min(1, "Tria almenys un contracte").max(2000), closePrevious: z.boolean().default(false), rematch: z.boolean().default(true) }), raw);
  const { retailer, reference, proposals } = await missingContracts(u, statementId);
  const want = new Set(b.cups.map((c) => cupsBase(normCups(c) ?? c)));
  const { contractAction } = await import("./crm");
  const created: { cups: string; contractId: string; client: string }[] = [];
  const failed: { cups: string; reason: string }[] = [];
  for (const p of proposals.filter((x) => want.has(cupsBase(normCups(x.cups) ?? x.cups)))) {
    try {
      const r = await contractAction(u, { action: "create", clientId: p.clientId, data: {
        supply_id: p.supplyId, retailer, product: p.product, start_date: p.start, end_date: p.status === "actiu" ? plusYear(p.start ?? today()) : p.end, status: p.status,
        notes: `Creat des de la liquidació ${retailer} ${reference} (${p.lines.map((l) => l.origin ?? `línia ${l.line_no}`).join(", ")}): la comercialitzadora hi liquida comissions d'aquest CUPS.${p.status === "actiu" ? END_NOTE : ""}`,
      } });
      created.push({ cups: p.cups, contractId: r.id as string, client: p.client });
      if (b.closePrevious && p.status === "actiu") {
        for (const k of p.current.filter((x) => ["actiu", "renovacio_pendent"].includes(x.status))) {
          await u.sb.from("crm_contracts").update({ status: "finalitzat", end_date: k.end_date && p.start && k.end_date < p.start ? k.end_date : p.start }).eq("id", k.id);
          const { publishToRenewals } = await import("./crm");
          await publishToRenewals(k.id);
        }
      }
    } catch (e) { failed.push({ cups: p.cups, reason: e instanceof Error ? e.message : "Error" }); }
  }
  // La pantalla envia els contractes per blocs i demana tornar a identificar només al final (evita esperes de >60 s)
  const m = b.rematch ? await autoMatch(u, statementId) : { matched: {} as Record<string, number> };
  return { created: created.length, failed, ...m };
}

/**
 * Una línia concreta: crea el contracte de la comercialitzadora per al client triat. Si el CUPS encara no és al CRM,
 * se li afegeix com a subministrament nou (amb el CUPS de la liquidació). Després es torna a identificar.
 */
export async function createContractForLine(u: U, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ lineId: uuid, clientId: uuid }), raw);
  const l0 = (await u.sb.from("fin_statement_lines").select("*").eq("id", b.lineId).maybeSingle()).data as (LineForK & { statement_id: string }) | null;
  if (!l0) throw new HttpError(404, "Línia no trobada");
  const stRow = (await u.sb.from("fin_provider_statements").select("id,retailer,reference").eq("id", l0.statement_id).single()).data as { id: string; retailer: string; reference: string };
  const l = { ...l0, fin_provider_statements: stRow };
  if (!l.cups) throw new HttpError(400, "La línia no té CUPS: assigna-la a un contracte existent");
  if (["conciliat", "descartat"].includes(l.match_status)) throw new HttpError(409, "Aquesta línia ja està resolta");
  const retailer = await canonicalRetailer(u, l.fin_provider_statements.retailer);
  const { contractAction, supplyAction } = await import("./crm");
  let sup = await supplyFor(u, l.cups);
  if (sup && sup.client_id !== b.clientId) throw new HttpError(409, `Aquest CUPS ja és d'un altre client del CRM («${(Array.isArray(sup.crm_clients) ? sup.crm_clients[0]?.name : sup.crm_clients?.name) ?? "—"}»).`);
  if (!sup) {
    const energy = l.energy === "gas" || /^ES02[1-3]/.test(l.cups) ? "gas" : "luz";
    const r = await supplyAction(u, { action: "create", clientId: b.clientId, data: { cups: normCups(l.cups) ?? l.cups, energy_type: energy } });
    sup = { id: (r as { id: string }).id, cups: l.cups, client_id: b.clientId, energy_type: energy, archived_at: null, crm_clients: null };
  }
  const retro = RETRO.includes(l.movement ?? "") || l.kind === "retrocessio";
  const k = await contractAction(u, { action: "create", clientId: b.clientId, data: {
    supply_id: sup.id, retailer, product: l.product ?? null, start_date: l.activation_date ?? (retro ? null : l.event_date ?? null), end_date: retro ? l.event_date ?? null : plusYear(l.activation_date ?? l.event_date ?? today()), status: retro ? "finalitzat" : "actiu",
    notes: `Creat des de la liquidació ${retailer} ${l.fin_provider_statements.reference}${l.source_sheet ? ` (${l.source_sheet} · fila ${l.source_row})` : ""}.${retro ? "" : END_NOTE}`,
  } });
  await autoMatch(u, l.statement_id);
  return { contractId: k.id as string };
}

export async function registerReceipt(u: U, statementId: string, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Import no vàlid"), received_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), bank_reference: z.string().trim().min(1, "Indica la referència bancària").max(120), notes: z.string().max(500).nullable().optional(), net: z.boolean().default(true) }), raw);
  if (b.received_at > today()) throw new HttpError(400, "La data del cobrament no pot ser futura");
  // Fase 14: per defecte el cobrament és NET (la comercialitzadora descompta les retrocomissions de la mateixa liquidació)
  const r = await u.sb.rpc(b.net ? "fin_register_receipt_net" : "fin_register_receipt", { p_statement: statementId, p_amount: b.amount, p_date: b.received_at, p_ref: b.bank_reference, p_notes: b.notes ?? null });
  if (r.error) { if (r.error.code === "23505") throw new HttpError(409, "Aquest cobrament ja està registrat (mateixa referència, import i data)."); finError(r.error); }
  const rec = (await u.sb.from("fin_provider_receipts").select("allocated,amount").eq("id", r.data).single()).data!;
  const contracts = ((await u.sb.from("fin_ledger").select("contract_id").eq("receipt_id", r.data)).data ?? []).map((x) => x.contract_id as string);
  for (const c of [...new Set(contracts)]) await syncLegacy(c);
  return { id: r.data, allocated: rec.allocated, unallocated: money(D(rec.amount).minus(rec.allocated)) };
}

export async function listStatements(u: U) {
  await staffOnly(u);
  const r = await u.sb.from("fin_provider_statements").select("*").order("received_at", { ascending: false }).limit(200);
  if (r.error) finError(r.error);
  const ids = (r.data ?? []).map((s) => s.id);
  const lines = ids.length ? (((await u.sb.from("fin_statement_lines").select("statement_id,amount,match_status").in("statement_id", ids)).data ?? []) as { statement_id: string; amount: string; match_status: string }[]) : [];
  const recs = ids.length ? (((await u.sb.from("fin_provider_receipts").select("statement_id,amount,allocated").in("statement_id", ids)).data ?? []) as { statement_id: string; amount: string; allocated: string }[]) : [];
  return {
    rows: (r.data ?? []).map((s) => {
      const L = lines.filter((l) => l.statement_id === s.id);
      return { ...s, lines: L.length, total: sum(L.map((l) => l.amount)), conciliated: sum(L.filter((l) => l.match_status === "conciliat").map((l) => l.amount)), collected: sum(recs.filter((x) => x.statement_id === s.id).map((x) => x.allocated)), issues: L.filter((l) => ["diferencia", "duplicat", "no_identificat"].includes(l.match_status)).length };
    }),
  };
}
export async function getStatement(u: U, id: string) {
  await staffOnly(u);
  const s = (await u.sb.from("fin_provider_statements").select("*").eq("id", id).maybeSingle()).data;
  if (!s) throw new HttpError(404, "Liquidació del proveïdor no trobada");
  const [lines, recs] = await Promise.all([
    u.sb.from("fin_statement_lines").select("*, crm_contracts(retailer,product,crm_clients(name))").eq("statement_id", id).order("line_no"),
    u.sb.from("fin_provider_receipts").select("*").eq("statement_id", id).order("received_at"),
  ]);
  const cob = ((await u.sb.from("fin_ledger").select("statement_line_id,amount").eq("kind", "cobrament").in("statement_line_id", (lines.data ?? []).map((l) => l.id).slice(0, 1000))).data ?? []) as { statement_line_id: string; amount: string }[];
  const al = await u.sb.from("fin_receipt_allocations").select("statement_line_id,amount,mode").in("statement_line_id", (lines.data ?? []).map((l) => l.id).slice(0, 1000));
  const allocs = (al.error ? [] : al.data ?? []) as { statement_line_id: string; amount: string; mode: string }[];
  type Row = { id: string; amount: string; crm_contracts: { retailer: string; product: string | null; crm_clients: { name: string } | null } | null };
  return {
    statement: s,
    lines: ((lines.data ?? []) as Row[]).map(({ crm_contracts: k, ...l }) => ({ ...l, contract_label: k ? `${k.crm_clients?.name ?? "—"} · ${k.retailer}${k.product ? ` · ${k.product}` : ""}` : null, collected: sum(cob.filter((c) => c.statement_line_id === l.id).map((c) => c.amount)), compensated: sum(allocs.filter((c) => c.statement_line_id === l.id && c.mode === "compensada").map((c) => c.amount)) })),
    receipts: recs.data ?? [],
  };
}

/**
 * Repartiment amb els col·laboradors d'una liquidació (consulta, no desa res). Fa servir el MATEIX motor que el càlcul
 * del contracte (context, fets i selecció de regla): la base és l'import de la línia (comissió confirmada pel proveïdor).
 * Les retrocessions es mostren a part i sempre «cal revisió»: no es repercuteixen automàticament al col·laborador.
 */
export async function collaboratorSplit(u: U, statementId: string) {
  await staffOnly(u);
  const lines = ((await u.sb.from("fin_statement_lines").select("id,line_no,amount,kind,match_status,contract_id,concept").eq("statement_id", statementId).order("line_no")).data ?? []) as { id: string; line_no: number; amount: string; kind: string; match_status: string; contract_id: string | null; concept: string | null }[];
  const rules = await loadRules(u.sb);
  const n = await names(u.sb);
  const ctxs = new Map<string, Ctx | null>();
  type SplitRow = { lineId: string; lineNo: number; contractId: string; client: string; base: string; collaboratorId: string | null; collaborator: string | null; pct: string | null; rule: string | null; simulation: boolean; collaboratorAmount: string | null; remainder: string; retro: boolean; review: boolean; note: string | null; forecast: string | null; accrued: string; settled: string };
  const out: SplitRow[] = [];
  for (const l of lines) {
    if (!l.contract_id || ["duplicat", "descartat"].includes(l.match_status)) continue;
    if (!ctxs.has(l.contract_id)) ctxs.set(l.contract_id, await context(u.sb, l.contract_id).catch(() => null));
    const ctx = ctxs.get(l.contract_id);
    if (!ctx) continue;
    const who = ctx.collaborator;
    const row: SplitRow = { lineId: l.id, lineNo: l.line_no, contractId: l.contract_id, client: ctx.client.name, base: money(D(l.amount)), collaboratorId: who, collaborator: who ? n.get(who)?.name ?? "—" : null, pct: null, rule: null, simulation: false, collaboratorAmount: null, remainder: money(D(l.amount)), retro: D(l.amount).lt(0), review: false, note: null, forecast: null, accrued: "0.00", settled: "0.00" };
    if (!who) { out.push({ ...row, note: "Sense col·laborador al contracte" }); continue; }
    const f = facts(ctx, money(D(l.amount).abs()), "confirmat");
    const { rule, simulation, conflict } = pickRule(rules, f, "collaborador", who);
    const [calc, led] = await Promise.all([
      u.sb.from("fin_calculations").select("amount,status").eq("contract_id", l.contract_id).eq("layer", "collaborador").eq("is_current", true).maybeSingle(),
      u.sb.from("fin_ledger").select("amount,settlement_id").eq("contract_id", l.contract_id).eq("layer", "collaborador"),
    ]);
    row.forecast = calc.data?.status === "calculat" ? (calc.data.amount as string) : null;
    row.accrued = sum(((led.data ?? []) as { amount: string }[]).map((x) => x.amount));
    row.settled = sum(((led.data ?? []) as { amount: string; settlement_id: string | null }[]).filter((x) => x.settlement_id).map((x) => x.amount));
    if (conflict.length) { out.push({ ...row, review: true, note: `Conflicte entre ${conflict.length} regles igual d'específiques` }); continue; }
    if (!rule) { out.push({ ...row, review: true, note: "El col·laborador no té cap percentatge configurat" }); continue; }
    const res = computeCommission(rule, f, simulation);
    const amt = res.amount ? (row.retro ? money(D(res.amount).neg()) : res.amount) : null;
    out.push({
      ...row, pct: rule.kind === "pct_comissio_rebuda" ? D(rule.value ?? 0).toString() : null, rule: rule.name, simulation,
      collaboratorAmount: amt, remainder: amt ? money(D(l.amount).minus(amt)) : row.remainder,
      review: row.retro || simulation, note: row.retro ? "Retrocessió: import proporcional orientatiu. No es descompta al col·laborador sense revisar l'acord." : simulation ? "Percentatge pendent d'aprovació de Direcció" : null,
    });
  }
  const t = (k: "base" | "collaboratorAmount" | "remainder", retro: boolean) => sum(out.filter((x) => x.retro === retro).map((x) => x[k]));
  return { rows: out, totals: { base: t("base", false), collaborator: t("collaboratorAmount", false), remainder: t("remainder", false), retroBase: t("base", true), retroCollaborator: t("collaboratorAmount", true) } };
}

/* ======================================================================= panell, rendibilitat i rànquing */

const dashQuery = z.object({
  g: z.enum(["dia", "setmana", "mes", "trimestre", "any"]).default("mes"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  owner: z.string().optional(), collaborator: z.string().optional(), retailer: z.string().max(120).optional(), product: z.string().max(120).optional(),
  client: z.string().optional(), cstatus: z.string().max(30).optional(), pay: z.enum(["", "cobrat", "parcial", "pendent"]).optional(),
});
interface Scope {
  contracts: Map<string, { id: string; client_id: string; client_name: string; retailer: string; product: string | null; status: string; start_date: string | null; owner: string | null; collaborator: string | null; origin: string | null }>;
  calcs: { contract_id: string; layer: Layer; beneficiary_id: string | null; amount: string | null; status: string; created_at: string }[];
  ledger: LedgerRow[];
}
async function scope(u: U, q: z.infer<typeof dashQuery>): Promise<Scope> {
  const rows = await all<{ id: string; client_id: string; retailer: string; product: string | null; status: string; start_date: string | null; owner_id: string | null; crm_clients: { name: string; owner_id: string | null; collaborator_id: string | null; origin: string | null } | null }>((f) => {
    let x = u.sb.from("crm_contracts").select("id,client_id,retailer,product,status,start_date,owner_id,crm_clients(name,owner_id,collaborator_id,origin)").range(f, f + 999);
    if (q.retailer) x = x.ilike("retailer", q.retailer);
    if (q.product) x = x.ilike("product", `%${q.product}%`);
    if (q.client && uuid.safeParse(q.client).success) x = x.eq("client_id", q.client);
    if (q.cstatus) x = x.eq("status", q.cstatus);
    return x;
  });
  const contracts = new Map<string, Scope["contracts"] extends Map<string, infer V> ? V : never>();
  for (const k of rows) {
    const owner = k.owner_id ?? k.crm_clients?.owner_id ?? null, collaborator = k.crm_clients?.collaborator_id ?? null;
    if (q.owner && owner !== q.owner) continue;
    if (q.collaborator && collaborator !== q.collaborator) continue;
    contracts.set(k.id, { id: k.id, client_id: k.client_id, client_name: k.crm_clients?.name ?? "—", retailer: k.retailer, product: k.product, status: k.status, start_date: k.start_date, owner, collaborator, origin: k.crm_clients?.origin ?? null });
  }
  const [calcs, ledger] = await Promise.all([
    all<Scope["calcs"][number]>((f) => u.sb.from("fin_calculations").select("contract_id,layer,beneficiary_id,amount,status,created_at").eq("is_current", true).range(f, f + 999)),
    all<LedgerRow>((f) => u.sb.from("fin_ledger").select("*").range(f, f + 999)),
  ]);
  let L = ledger.filter((l) => (l.contract_id ? contracts.has(l.contract_id) : !q.retailer && !q.product && !q.client && (!q.owner || l.beneficiary_id === q.owner) && (!q.collaborator || l.beneficiary_id === q.collaborator)));
  const C = calcs.filter((c) => contracts.has(c.contract_id));
  if (q.pay) {
    const st = (id: string) => { const col = sum(L.filter((l) => l.contract_id === id && l.kind === "cobrament").map((l) => l.amount)); const exp = sum(L.filter((l) => l.contract_id === id && l.layer === "proveidor" && ["confirmacio", "meritacio"].includes(l.kind)).map((l) => l.amount)); return D(col).lte(0) ? "pendent" : D(col).gte(exp) ? "cobrat" : "parcial"; };
    for (const id of [...contracts.keys()]) if (st(id) !== q.pay) contracts.delete(id);
    L = L.filter((l) => !l.contract_id || contracts.has(l.contract_id));
  }
  return { contracts, calcs: C.filter((c) => contracts.has(c.contract_id)), ledger: L };
}

export async function dashboard(u: U, raw: Record<string, string>) {
  await staffOnly(u);
  const q = parse(dashQuery, raw);
  const range = q.from && q.to ? { from: q.from, to: q.to } : periodRange(q.g);
  const s = await scope(u, q);
  const inP = (d: string | null) => !!d && d >= range.from && d <= range.to;
  const P = s.ledger.filter((l) => inP(l.period));
  const byKind = (layer: Layer | Layer[], kinds: string[], rows = P) => sum(rows.filter((l) => (Array.isArray(layer) ? layer.includes(l.layer) : l.layer === layer) && kinds.includes(l.kind)).map((l) => l.amount));
  const estContracts = s.calcs.filter((c) => c.layer === "proveidor" && c.status === "calculat" && inP(s.contracts.get(c.contract_id)?.start_date ?? c.created_at.slice(0, 10)));
  const estPayout = s.calcs.filter((c) => c.layer !== "proveidor" && c.status === "calculat" && inP(s.contracts.get(c.contract_id)?.start_date ?? c.created_at.slice(0, 10)));
  const payments = ((await u.sb.from("fin_payments").select("amount,paid_at,fin_settlements(kind,beneficiary_id)").gte("paid_at", range.from).lte("paid_at", range.to)).data ?? []) as unknown as { amount: string; paid_at: string; fin_settlements: { kind: string; beneficiary_id: string } | null }[];
  const pays = payments.filter((p) => (!q.owner || p.fin_settlements?.beneficiary_id === q.owner) && (!q.collaborator || p.fin_settlements?.beneficiary_id === q.collaborator));
  const costs = ((await u.sb.from("fin_costs").select("amount,cost_date,contract_id").gte("cost_date", range.from).lte("cost_date", range.to)).data ?? []) as { amount: string; contract_id: string | null }[];
  const costT = sum(costs.filter((c) => !c.contract_id || s.contracts.has(c.contract_id)).map((c) => c.amount));
  const accruedA = byKind("proveidor", ["meritacio", "regularitzacio", "anullacio"]);
  const confirmedA = byKind("proveidor", ["confirmacio"]);
  const collectedA = byKind("proveidor", ["cobrament"]);
  const payoutAccrued = byKind(["comercial", "collaborador"], ["meritacio", "regularitzacio", "bonificacio", "ajustament", "anullacio", "retrocessio"]);
  // pendent de cobrar (acumulat, no només el període): el que s'ha meritat o confirmat i encara no s'ha cobrat
  const allA = s.ledger.filter((l) => l.layer === "proveidor");
  const pendingByContract = [...s.contracts.keys()].map((id) => {
    const rows = allA.filter((l) => l.contract_id === id);
    const owed = D(sum(rows.filter((l) => l.kind === "confirmacio").map((l) => l.amount))).gt(0) ? sum(rows.filter((l) => ["confirmacio", "retrocessio", "ajustament"].includes(l.kind)).map((l) => l.amount)) : sum(rows.filter((l) => ["meritacio", "regularitzacio", "anullacio"].includes(l.kind)).map((l) => l.amount));
    return { id, pending: money(D(owed).minus(sum(rows.filter((l) => l.kind === "cobrament").map((l) => l.amount)))) };
  }).filter((x) => D(x.pending).gt(0));
  const unsettled = s.ledger.filter((l) => l.layer !== "proveidor" && !l.settlement_id);
  const months = lastMonths(12);
  const series = months.map((m) => {
    const rows = s.ledger.filter((l) => monthOf(l.period) === m);
    return {
      month: m,
      estimat: Number(sum(s.calcs.filter((c) => c.layer === "proveidor" && c.status === "calculat" && monthOf(s.contracts.get(c.contract_id)?.start_date ?? c.created_at) === m).map((c) => c.amount))),
      meritat: Number(byKind("proveidor", ["meritacio", "regularitzacio", "anullacio"], rows)), confirmat: Number(byKind("proveidor", ["confirmacio"], rows)), cobrat: Number(byKind("proveidor", ["cobrament"], rows)),
      comissions: Number(byKind(["comercial", "collaborador"], ["meritacio", "regularitzacio", "bonificacio", "ajustament", "anullacio", "retrocessio"], rows)),
    };
  });
  const last3 = series.slice(-3).map((x) => x.cobrat);
  const n = await names(u.sb);
  const pendingTop = pendingByContract.sort((a, b) => Number(b.pending) - Number(a.pending)).slice(0, 10).map((x) => { const c = s.contracts.get(x.id)!; return { contract_id: x.id, client: c.client_name, retailer: c.retailer, pending: x.pending }; });
  const groupUnsettled = new Map<string, { beneficiary_id: string; name: string | null; layer: string; amount: ReturnType<typeof D>; count: number }>();
  for (const l of unsettled) { const k = `${l.layer}|${l.beneficiary_id}`; const g = groupUnsettled.get(k) ?? { beneficiary_id: l.beneficiary_id!, name: n.get(l.beneficiary_id!)?.name ?? null, layer: l.layer, amount: D(0), count: 0 }; g.amount = g.amount.plus(l.amount); g.count++; groupUnsettled.set(k, g); }
  const alerts = await liveAlerts(u.sb, s);
  return {
    range, granularity: q.g,
    kpis: {
      estimated: sum(estContracts.map((c) => c.amount)), accrued: accruedA, invoiced: byKind("proveidor", ["facturacio"]), confirmed: confirmedA, collected: collectedA,
      pending: sum(pendingByContract.map((x) => x.pending)),
      payoutsComercial: sum(pays.filter((p) => p.fin_settlements?.kind === "comercial").map((p) => p.amount)), payoutsCollab: sum(pays.filter((p) => p.fin_settlements?.kind === "collaborador").map((p) => p.amount)),
      payoutsAccrued: payoutAccrued,
      marginForecast: money(D(sum(estContracts.map((c) => c.amount))).minus(sum(estPayout.map((c) => c.amount))).minus(costT)),
      marginRealized: money(D(collectedA).minus(payoutAccrued).minus(costT)),
      adjustments: byKind(["proveidor", "comercial", "collaborador"], ["ajustament", "retrocessio", "regularitzacio"]),
      pendingSettlementContracts: new Set(unsettled.map((l) => l.contract_id).filter(Boolean)).size + pendingByContract.length,
      simulations: s.calcs.filter((c) => c.status === "simulacio").length, pendingConfig: s.calcs.filter((c) => c.status === "pendent_configuracio" || c.status === "pendent_dades").length,
      costs: costT,
    },
    series, forecast: { nextMonth: money(last3.reduce((a, b) => a + b, 0) / Math.max(1, last3.length)), method: "Mitjana dels cobraments dels 3 últims mesos (orientativa)", pendingToCollect: sum(pendingByContract.map((x) => x.pending)) },
    pendingCollection: pendingTop,
    unsettled: [...groupUnsettled.values()].map((g) => ({ ...g, amount: money(g.amount) })).sort((a, b) => Number(b.amount) - Number(a.amount)),
    alerts,
    filters: { retailers: [...new Set([...s.contracts.values()].map((c) => c.retailer))].sort(), people: [...n.values()].filter((p) => ["comercial", "colaborador"].includes(p.role)).map((p) => ({ id: p.id, name: p.name, role: p.role })) },
  };
}

const GROUPS = ["client", "contracte", "comercial", "collaborador", "comercialitzadora", "producte", "canal", "periode"] as const;
export async function profitability(u: U, raw: Record<string, string>) {
  await staffOnly(u);
  const group = (GROUPS as readonly string[]).includes(raw.group) ? (raw.group as (typeof GROUPS)[number]) : "client";
  const q = parse(dashQuery, raw);
  const s = await scope(u, q);
  const costs = ((await u.sb.from("fin_costs").select("amount,contract_id,client_id")).data ?? []) as { amount: string; contract_id: string | null; client_id: string | null }[];
  const n = await names(u.sb);
  const keyOf = (c: Scope["contracts"] extends Map<string, infer V> ? V : never) => {
    switch (group) {
      case "client": return [c.client_id, c.client_name];
      case "contracte": return [c.id, `${c.client_name} · ${c.retailer}${c.product ? ` · ${c.product}` : ""}`];
      case "comercial": return [c.owner ?? "-", c.owner ? n.get(c.owner)?.name ?? "—" : "Sense comercial"];
      case "collaborador": return [c.collaborator ?? "-", c.collaborator ? n.get(c.collaborator)?.name ?? "—" : "Sense col·laborador"];
      case "comercialitzadora": return [c.retailer.toLowerCase(), c.retailer];
      case "producte": return [`${c.retailer}|${c.product ?? ""}`, `${c.retailer} · ${c.product ?? "sense producte"}`];
      case "canal": return [c.origin ?? "-", c.origin ?? "Sense canal informat"];
      case "periode": return [(c.start_date ?? "sense data").slice(0, 7), (c.start_date ?? "Sense data").slice(0, 7)];
    }
  };
  const groups = new Map<string, { key: string; label: string; contracts: number; estimated: ReturnType<typeof D>; collected: ReturnType<typeof D>; confirmed: ReturnType<typeof D>; payouts: ReturnType<typeof D>; payoutsEst: ReturnType<typeof D>; costs: ReturnType<typeof D>; missing: number }>();
  for (const c of s.contracts.values()) {
    const [k, label] = keyOf(c);
    const g = groups.get(k) ?? { key: k, label, contracts: 0, estimated: D(0), collected: D(0), confirmed: D(0), payouts: D(0), payoutsEst: D(0), costs: D(0), missing: 0 };
    const L = s.ledger.filter((l) => l.contract_id === c.id);
    const prov = s.calcs.find((x) => x.contract_id === c.id && x.layer === "proveidor");
    g.contracts++;
    if (prov?.status === "calculat") g.estimated = g.estimated.plus(prov.amount ?? 0); else g.missing++;
    g.collected = g.collected.plus(sum(L.filter((l) => l.kind === "cobrament").map((l) => l.amount)));
    g.confirmed = g.confirmed.plus(sum(L.filter((l) => l.kind === "confirmacio").map((l) => l.amount)));
    g.payouts = g.payouts.plus(sum(L.filter((l) => l.layer !== "proveidor").map((l) => l.amount)));
    g.payoutsEst = g.payoutsEst.plus(sum(s.calcs.filter((x) => x.contract_id === c.id && x.layer !== "proveidor" && x.status === "calculat").map((x) => x.amount)));
    g.costs = g.costs.plus(sum(costs.filter((x) => x.contract_id === c.id).map((x) => x.amount)));
    groups.set(k, g);
  }
  const rows = [...groups.values()].map((g) => {
    const m = contributionMargin({ providerCollected: money(g.collected), providerEstimated: g.missing === g.contracts ? null : money(g.estimated), providerConfirmed: money(g.confirmed), payouts: money(g.payouts), payoutsEstimated: money(g.payoutsEst), costs: money(g.costs), hasProviderRule: g.missing < g.contracts, hasPayoutCalc: true });
    return { key: g.key, label: g.label, contracts: g.contracts, estimated: money(g.estimated), confirmed: money(g.confirmed), collected: money(g.collected), payouts: money(g.payouts), costs: money(g.costs), margin: m.value, marginEstimated: m.estimated, status: g.missing && m.status === "real" ? "estimat" : m.status, incomplete: g.missing };
  }).sort((a, b) => Number(b.margin ?? b.marginEstimated ?? 0) - Number(a.margin ?? a.marginEstimated ?? 0));
  return { group, rows, note: "Marge de contribució = ingressos cobrats − comissions i incentius atribuïbles − costos directes registrats. No és el benefici net: no inclou despeses generals, nòmines ni altres costos." };
}

export async function ranking(u: U, raw: Record<string, string>) {
  const month = /^\d{4}-\d{2}$/.test(raw.month ?? "") ? raw.month : new Date().toISOString().slice(0, 7);
  const from = `${month}-01`, to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const staff = await finStaff(u);
  const sb = u.sb;
  const n = await names(sb);
  const people = staff ? [...n.values()].filter((p) => p.role === "comercial") : [n.get(u.user.id)!].filter(Boolean);
  const ids = people.map((p) => p.id);
  const [ledger, calcs, opps, targets, oldTargets] = await Promise.all([
    sb.from("fin_ledger").select("beneficiary_id,kind,amount,contract_id").eq("layer", "comercial").in("beneficiary_id", ids).gte("period", from).lte("period", to),
    sb.from("fin_calculations").select("beneficiary_id,amount,status,contract_id,inputs,created_at").eq("layer", "comercial").eq("is_current", true).in("beneficiary_id", ids),
    sb.from("crm_opportunities").select("owner_id,stage,won_at,lost_at,annual_kwh").in("owner_id", ids).or(`won_at.gte.${from},lost_at.gte.${from}`),
    sb.from("fin_targets").select("*").eq("period", month),
    sb.from("crm_targets").select("*").eq("period", month).in("user_id", ids),
  ]);
  type C = { beneficiary_id: string; amount: string | null; status: string; contract_id: string; inputs: { refDate?: string; eligibleMwh?: string | null; annualKwh?: number | null }; created_at: string };
  const C = ((calcs.data ?? []) as C[]).filter((c) => (c.inputs?.refDate ?? c.created_at).slice(0, 10) >= from && (c.inputs?.refDate ?? c.created_at).slice(0, 10) <= to);
  const rows = people.map((p) => {
    const mine = C.filter((c) => c.beneficiary_id === p.id);
    const L = ((ledger.data ?? []) as { beneficiary_id: string; kind: string; amount: string }[]).filter((l) => l.beneficiary_id === p.id);
    const O = ((opps.data ?? []) as { owner_id: string; stage: string; won_at: string | null; lost_at: string | null }[]).filter((o) => o.owner_id === p.id);
    const won = O.filter((o) => o.stage === "guanyat" && o.won_at && o.won_at.slice(0, 10) <= to).length, lost = O.filter((o) => o.stage === "perdut").length;
    const mwh = mine.reduce((a, c) => a.plus(c.inputs?.eligibleMwh ?? (c.inputs?.annualKwh != null ? D(c.inputs.annualKwh).div(1000) : 0)), D(0));
    const t = [...((targets.data ?? []) as { scope: string; user_id: string | null; metric: string; target: string }[]).filter((x) => x.scope === "comercial" && x.user_id === p.id), ...((oldTargets.data ?? []) as { user_id: string; metric: string; target: string }[]).filter((x) => x.user_id === p.id).map((x) => ({ ...x, metric: x.metric === "guanyades" ? "contractes" : x.metric === "comissio" ? "comissio_generada" : x.metric }))];
    return {
      id: p.id, name: p.name, contracts: mine.length, mwh: money(mwh), generated: sum(mine.filter((c) => c.status === "calculat").map((c) => c.amount)),
      accrued: sum(L.filter((l) => ["meritacio", "regularitzacio"].includes(l.kind)).map((l) => l.amount)), bonus: sum(L.filter((l) => l.kind === "bonificacio").map((l) => l.amount)),
      conversion: won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : null, targets: t.map((x) => ({ metric: x.metric, target: String(x.target) })),
    };
  }).sort((a, b) => Number(b.accrued) - Number(a.accrued) || Number(b.generated) - Number(a.generated));
  const evolution = staff ? lastMonths(6).map((m) => ({ month: m })) : [];
  return { month, rows, isStaff: staff, teamTargets: staff ? ((targets.data ?? []) as { scope: string }[]).filter((x) => x.scope !== "comercial") : [], evolution };
}

export async function setTarget(u: U, raw: unknown) {
  await staffOnly(u, "edit");
  const b = parse(z.object({ scope: z.enum(["comercial", "equip", "producte"]), user_id: uuid.nullable().optional(), product: z.string().max(120).nullable().optional(), service: z.enum(SERVICES).nullable().optional(), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), metric: z.enum(["contractes", "mwh", "comissio_generada", "comissio_meritada"]), target: z.number().min(0).nullable() }), raw);
  let q = u.sb.from("fin_targets").delete().eq("scope", b.scope).eq("period", b.period).eq("metric", b.metric);
  q = b.user_id ? q.eq("user_id", b.user_id) : q.is("user_id", null);
  q = b.product ? q.eq("product", b.product) : q.is("product", null);
  q = b.service ? q.eq("service", b.service) : q.is("service", null);
  await q;
  if (b.target == null) return { ok: true };
  const r = await u.sb.from("fin_targets").insert({ scope: b.scope, user_id: b.scope === "comercial" ? b.user_id : null, product: b.product ?? null, service: b.service ?? null, period: b.period, metric: b.metric, target: b.target, updated_by: u.user.id });
  if (r.error) finError(r.error);
  return { ok: true };
}

/** Les meves comissions (comercials i col·laboradors): càlculs propis i moviments pendents de liquidar. Sense marges. */
export async function myCommissions(u: U) {
  const [calcs, ledger] = await Promise.all([
    u.sb.from("fin_calculations").select("id,contract_id,layer,amount,status,formula,created_at,crm_contracts(retailer,product,crm_clients(name))").in("layer", ["comercial", "collaborador"]).eq("beneficiary_id", u.user.id).eq("is_current", true).order("created_at", { ascending: false }).limit(300),
    u.sb.from("fin_ledger").select("id,contract_id,kind,amount,period,description,settlement_id").in("layer", ["comercial", "collaborador"]).eq("beneficiary_id", u.user.id).order("period", { ascending: false }).limit(500),
  ]);
  type CR = { id: string; contract_id: string; amount: string | null; status: string; formula: string | null; created_at: string; crm_contracts: { retailer: string; product: string | null; crm_clients: { name: string } | null } | null };
  const isCollab = u.profile.role === "colaborador";
  return {
    calculations: ((calcs.data ?? []) as unknown as CR[]).map(({ crm_contracts: k, ...c }) => ({ ...c, formula: isCollab ? null : c.formula, label: k ? `${k.crm_clients?.name ?? "—"} · ${k.retailer}` : "—" })),
    ledger: ledger.data ?? [],
    pending: sum(((ledger.data ?? []) as { amount: string; settlement_id: string | null }[]).filter((l) => !l.settlement_id).map((l) => l.amount)),
    kinds: LEDGER_KIND_LABEL,
  };
}

/* ======================================================================= alertes */

async function alertInput(sb: SB, now: Date, s?: Scope): Promise<Omit<FinAlertInput, "rules" | "staffIds" | "now">> {
  const sc = s ?? { contracts: new Map(), calcs: (((await sb.from("fin_calculations").select("contract_id,layer,beneficiary_id,amount,status,created_at").eq("is_current", true).eq("layer", "proveidor").eq("status", "calculat").limit(5000)).data ?? []) as Scope["calcs"]), ledger: (((await sb.from("fin_ledger").select("*").limit(20000)).data ?? []) as LedgerRow[]) };
  const confirmedContracts = new Set(sc.ledger.filter((l) => l.layer === "proveidor" && ["confirmacio", "cobrament"].includes(l.kind)).map((l) => l.contract_id));
  const staleCalc = sc.calcs.filter((c) => c.layer === "proveidor" && c.status === "calculat" && !confirmedContracts.has(c.contract_id));
  const names2 = staleCalc.length ? ((await sb.from("crm_contracts").select("id,retailer,crm_clients(name)").in("id", staleCalc.map((c) => c.contract_id).slice(0, 500))).data ?? []) as unknown as { id: string; retailer: string; crm_clients: { name: string } | null }[] : [];
  const lines = ((await sb.from("fin_statement_lines").select("id,amount,expected_amount,difference,match_status,kind,contract_id,client_name,fin_provider_statements(retailer)").in("match_status", ["diferencia", "duplicat", "conciliat"]).limit(2000)).data ?? []) as unknown as { id: string; amount: string; expected_amount: string | null; difference: string | null; match_status: string; kind: string; contract_id: string | null; client_name: string | null; fin_provider_statements: { retailer: string } | null }[];
  const sets = ((await sb.from("fin_settlements").select("id,code,status,kind,beneficiary_id,approved_amount,paid_amount,updated_at,approved_at").in("status", ["revisio", "aprovada", "pagada"]).limit(2000)).data ?? []) as { id: string; code: string; status: string; kind: string; beneficiary_id: string; approved_amount: string | null; paid_amount: string; updated_at: string; approved_at: string | null }[];
  const econ = ((await sb.from("fin_contract_economics").select("contract_id,econ_status").neq("econ_status", "actiu")).data ?? []) as { contract_id: string }[];
  const lockedSets = new Set(sets.filter((x) => ["aprovada", "pagada"].includes(x.status)).map((x) => x.id));
  const cancelledPaid: FinAlertInput["cancelledPaid"] = [];
  for (const e of econ) {
    const L = sc.ledger.filter((l) => l.contract_id === e.contract_id && l.layer !== "proveidor" && l.settlement_id && lockedSets.has(l.settlement_id));
    const by = new Map<string, ReturnType<typeof D>>();
    for (const l of L) by.set(l.beneficiary_id!, (by.get(l.beneficiary_id!) ?? D(0)).plus(l.amount));
    const retro = sc.ledger.filter((l) => l.contract_id === e.contract_id && l.kind === "retrocessio" && l.layer !== "proveidor");
    for (const [b, v] of by) if (v.gt(0) && !retro.some((r) => r.beneficiary_id === b)) cancelledPaid.push({ contract_id: e.contract_id, client_name: null, beneficiary_id: b, amount: money(v) });
  }
  const pays = ((await sb.from("fin_payments").select("id,settlement_id,amount,paid_at").limit(5000)).data ?? []) as { id: string; settlement_id: string; amount: string; paid_at: string }[];
  const dupPay = new Map<string, number>();
  for (const p of pays) { const s2 = sets.find((x) => x.id === p.settlement_id); const k = `${s2?.beneficiary_id}|${p.amount}|${p.paid_at}`; dupPay.set(k, (dupPay.get(k) ?? 0) + 1); }
  return {
    stale: staleCalc.map((c) => { const k = names2.find((x) => x.id === c.contract_id); return { contract_id: c.contract_id, client_name: k?.crm_clients?.name ?? null, retailer: k?.retailer ?? "", since: c.created_at }; }),
    differences: lines.filter((l) => l.match_status === "diferencia" && l.difference != null).map((l) => ({ line_id: l.id, retailer: l.fin_provider_statements?.retailer ?? "", amount: l.amount, expected: l.expected_amount ?? "0", difference: l.difference! })),
    cancelledPaid,
    duplicates: [...lines.filter((l) => l.match_status === "duplicat").map((l) => ({ key: `line:${l.id}`, label: `Línia de ${l.fin_provider_statements?.retailer ?? "proveïdor"} repetida (${l.amount} €)` })), ...[...dupPay.entries()].filter(([, c]) => c > 1).map(([k]) => ({ key: `pay:${k}`, label: `Pagaments amb el mateix import i data (${k.split("|")[1]} €, ${k.split("|")[2]})` }))],
    pendingApproval: sets.filter((x) => x.status === "revisio").map((x) => ({ id: x.id, code: x.code, since: x.updated_at })),
    collabBalance: sets.filter((x) => x.kind === "collaborador" && x.status === "aprovada" && D(x.approved_amount ?? 0).gt(x.paid_amount)).map((x) => ({ id: x.id, code: x.code, beneficiary_id: x.beneficiary_id, balance: money(D(x.approved_amount ?? 0).minus(x.paid_amount)), since: x.approved_at ?? x.updated_at })),
    achieved: [],
    retrocessions: lines.filter((l) => l.match_status === "conciliat" && l.kind === "retrocessio" && l.contract_id).map((l) => ({ line_id: l.id, contract_id: l.contract_id!, beneficiary_id: null, amount: l.amount, client_name: l.client_name })),
  };
}
async function liveAlerts(sb: SB, s: Scope) {
  const rules = (((await sb.from("crm_automation_rules").select("key,enabled,params").like("key", "fin_%")).data ?? []) as FinAlertInput["rules"]);
  const input = await alertInput(sb, new Date(), s);
  return planFinanceAlerts({ ...input, now: new Date(), rules, staffIds: ["me"] }).map((a) => ({ key: a.rule_key, title: a.title, body: a.body, link: a.link }));
}
/** Motor d'automatitzacions: avisos econòmics idempotents (rule_key únic per usuari). */
export async function financeAutomations(sb: ReturnType<typeof adminClient>, now: Date, rules: FinAlertInput["rules"], staffIds: string[]) {
  if (!rules.some((r) => r.key.startsWith("fin_") && r.enabled)) return [];
  const probe = await sb.from("fin_ledger").select("id").limit(1);
  if (probe.error) return [];
  const input = await alertInput(sb, now);
  return planFinanceAlerts({ ...input, now, rules, staffIds });
}
