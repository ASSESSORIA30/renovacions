import "server-only";
/**
 * INTEL·LIGÈNCIA IA (servidor).
 *
 * Motor d'oportunitats (`runIntelligence`): llegeix la cartera amb el client de servei, detecta oportunitats amb
 * el nucli pur (`@/core/intelligence`), calcula comparatives deterministes amb el catàleg vigent i ho desa de
 * manera idempotent (clau `dedupe_key`). Només crea oportunitats, tasques i avisos INTERNS; mai envia res a clients.
 *
 * Accions de les persones (`u.sb`, amb RLS): consultar, revisar, descartar, acceptar (→ oportunitat comercial de
 * la Fase 2, sense duplicats), preparar propostes PDF (esborrany a la fitxa del client), aprovar-les i enviar-les
 * (només es marca «enviada» si el servidor de correu ho confirma).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { latestPerProduct } from "@/comparator/catalog";
import { buildSnapshot } from "@/comparator/snapshot";
import { DEFAULT_WEIGHTS, ENGINE_VERSION, type OfferVersion, type PriceSheet, type TariffStatus } from "@/comparator/types";
import {
  AI_KIND_LABEL, OPEN_AI_STATUSES, PENDING_PRICE, analyseSupply, businessValue, classifySaving, contactAllowed, daysBetween, detectCrossSell,
  detectExpiredTariffs, detectIncomplete, detectRecovery, detectRenewals, detectUnanswered, estimateEconomics, motorParams, narrativeFromAnalysis,
  powerCandidate, proposalValidUntil, scoreOpportunity, sheetFromConditions, supplyGaps, dataQualityOf, supplyInputFrom,
  type AiKind, type Analysis, type Candidate, type ClientRow, type ContractRow, type CurrentConditions, type MotorParams, type OppRow, type SasConfig, type ScoreWeights, type SupplyRow,
} from "@/core/intelligence";
import { buildProposalPdf } from "@/core/proposal-pdf";
import type { RuleRow } from "@/core/commissions";
import { deriveSegment } from "@/core/commissions";
import type { Service } from "@/core/sales";
import { adminClient, HttpError, type requireUser } from "./supabase";
import { DOCS_BUCKET } from "./crm-docs";

type U = Awaited<ReturnType<typeof requireUser>>;
type SB = ReturnType<typeof adminClient>;
type DbErr = { code?: string; message?: string } | null;

const isMissing = (e: DbErr) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703" || /does not exist|schema cache|could not find/i.test(e.message ?? ""));
const today = () => new Date().toISOString().slice(0, 10);
const eurTxt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const STAFF = ["admin", "cap_administrativa", "administrativa"];
const isStaff = (u: U) => STAFF.includes(u.profile.role);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
async function all<T>(build: (from: number) => PromiseLike<{ data: unknown; error: DbErr }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await withRetry(() => build(from));
    if (error) throw Object.assign(new Error(error.message ?? "error"), { code: error.code });
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Reintents controlats per a errors transitoris (xarxa, límit de connexions): 3 intents amb espera creixent. */
async function withRetry<T extends { error: DbErr }>(fn: () => PromiseLike<T>, attempts = 3): Promise<T> {
  let last: T | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    const code = last.error?.code ?? "";
    const transient = !!last.error && (/^(08|53|57P)/.test(code) || /fetch failed|timeout|ECONNRESET|503|502/i.test(last.error.message ?? ""));
    if (!transient) return last;
    await new Promise((r) => setTimeout(r, 300 * 2 ** i));
  }
  return last!;
}

/* ======================================================================= regles */

type RuleRec = { key: string; enabled: boolean; params: Record<string, unknown> };
async function aiRules(sb: SB) {
  const { data, error } = await sb.from("crm_automation_rules").select("key,enabled,params").in("key", ["ai_motor", "ai_puntuacio", "ai_sas_escenari", "ai_esborranys_auto", "ai_retencio"]);
  if (error) throw error;
  const by = new Map(((data ?? []) as RuleRec[]).map((r) => [r.key, r]));
  const sasRow = by.get("ai_sas_escenari");
  const sp = (sasRow?.params ?? {}) as Partial<SasConfig>;
  const sas: SasConfig = { enabled: !!sasRow?.enabled, min_eur_kwh: Number(sp.min_eur_kwh ?? 0.01), max_eur_kwh: Number(sp.max_eur_kwh ?? 0.015), retailers: Array.isArray(sp.retailers) ? sp.retailers.map(String) : [], justification: String(sp.justification ?? ""), source: String(sp.source ?? ""), as_of: sp.as_of ? String(sp.as_of) : null };
  const score = (by.get("ai_puntuacio")?.params ?? {}) as { weights?: Partial<ScoreWeights>; business_weights?: { comissio?: number; marge?: number } };
  return {
    motorEnabled: by.get("ai_motor")?.enabled ?? false,
    motor: motorParams(by.get("ai_motor")?.params as Partial<MotorParams>),
    weights: score.weights ?? {},
    businessWeights: score.business_weights ?? { comissio: 70, marge: 30 },
    sas,
    autoDrafts: { enabled: by.get("ai_esborranys_auto")?.enabled ?? false, ...((by.get("ai_esborranys_auto")?.params ?? {}) as { min_score?: number; max_per_run?: number }) },
    retention: { enabled: by.get("ai_retencio")?.enabled ?? true },
  };
}

/* ======================================================================= catàleg i instantània */

type VRow = { id: string; product_id: string; version: number; status: TariffStatus; data: OfferVersion };
export async function catalogOffers(sb: SB): Promise<OfferVersion[]> {
  const rows = await all<VRow>((f) => sb.from("tariff_versions").select("id,product_id,version,status,data").order("version", { ascending: false }).range(f, f + 999)).catch((e) => {
    if (isMissing(e)) return [] as VRow[];
    throw e;
  });
  // única font: el catàleg (una versió per producte, la vigent). L'antiga taula `offers` ja no s'hi barreja.
  return latestPerProduct(rows.map((r) => ({ ...r.data, id: r.id, productId: r.product_id, version: r.version, status: r.status }) as OfferVersion));
}

/** Instantània del catàleg usat (mateix contingut → mateixa fila). Permet reproduir qualsevol anàlisi històrica. */
async function snapshotCatalog(sb: SB, offers: OfferVersion[], asOf: string) {
  const sorted = [...offers].sort((a, b) => a.id.localeCompare(b.id));
  const hash = sha(sorted);
  const versions = sorted.map((o) => ({ id: o.id, supplier: o.supplierName, product: o.productName, version: o.version, validFrom: o.validFrom, validTo: o.validTo, source: o.source, status: o.status }));
  await sb.from("tariff_snapshots").upsert({ sha256: hash, as_of: asOf, versions, offers: sorted, offer_count: sorted.length }, { onConflict: "sha256", ignoreDuplicates: true });
  const { data } = await sb.from("tariff_snapshots").select("id").eq("sha256", hash).single();
  return (data?.id as string | undefined) ?? null;
}

/* ======================================================================= motor */

interface Loaded {
  contracts: (ContractRow & { expedient_id?: string | null })[];
  supplies: (SupplyRow & { address: string | null; data_source: string })[];
  clients: ClientRow[];
  opps: (OppRow & { stage: string })[];
  lastOppActivity: Record<string, string>;
  conditions: Map<string, { conditions: CurrentConditions; label: string; date: string | null }>; // per contracte
  comparisonCurrent: Map<string, { sheet: PriceSheet; retailer: string | null; label: string; date: string }>; // per subministrament
  rules: RuleRow[];
}

async function loadPortfolio(sb: SB, scopeClient: string | null): Promise<Loaded> {
  const byClient = (q: Q, col = "client_id"): Q => (scopeClient ? q.eq(col, scopeClient) : q);
  type CRaw = ContractRow & { crm_clients: { name: string; owner_id: string | null } | { name: string; owner_id: string | null }[] | null; expedient_id?: string | null };
  const [contractsRaw, suppliesRaw, clientsRaw, oppsRaw] = await Promise.all([
    all<CRaw>((f) => byClient(sb.from("crm_contracts").select("id,client_id,supply_id,retailer,product,end_date,start_date,status,owner_id,access_tariff,expedient_id,crm_clients(name,owner_id)")).range(f, f + 999)),
    all<SupplyRow & { address: string | null; data_source: string; crm_clients: { name: string; owner_id: string | null } | { name: string; owner_id: string | null }[] | null }>((f) => byClient(sb.from("crm_supplies").select("id,client_id,cups,energy_type,access_tariff,power_kw,annual_kwh,period_kwh,province,current_retailer,address,data_source,crm_clients(name,owner_id)").is("archived_at", null)).range(f, f + 999)),
    all<{ id: string; name: string; status: string; owner_id: string | null; commercial_opt_out: boolean | null; contact_preference: string | null; province: string | null; tags: string[] | null }>((f) => byClient(sb.from("crm_clients").select("id,name,status,owner_id,commercial_opt_out,contact_preference,province,tags").is("archived_at", null), "id").range(f, f + 999)),
    all<OppRow & { stage: string; won_at: string | null; lost_reason: string | null }>((f) => byClient(sb.from("crm_opportunities").select("id,client_id,title,stage,proposal_sent_at,last_activity_at,owner_id,service,supply_id,won_at,lost_reason")).range(f, f + 999)),
  ]);
  const contracts = contractsRaw.map((k) => {
    const c = one(k.crm_clients);
    return { ...k, client_owner_id: c?.owner_id ?? null, client_name: c?.name ?? null };
  });
  const supplies = suppliesRaw.map((s) => ({ ...s, owner_id: one(s.crm_clients)?.owner_id ?? null, client_name: one(s.crm_clients)?.name ?? null }));

  // última activitat humana per client i per oportunitat (2 anys)
  const since = new Date(Date.now() - 730 * 86_400_000).toISOString();
  const acts = await all<{ client_id: string | null; opportunity_id: string | null; at: string }>((f) => byClient(sb.from("crm_activities").select("client_id,opportunity_id,at").neq("type", "canvi").gte("at", since).order("at", { ascending: false })).range(f, f + 999));
  const lastClient: Record<string, string> = {}, lastOpp: Record<string, string> = {};
  for (const a of acts) {
    if (a.client_id && !lastClient[a.client_id]) lastClient[a.client_id] = a.at;
    if (a.opportunity_id && !lastOpp[a.opportunity_id]) lastOpp[a.opportunity_id] = a.at;
  }
  // interès registrat: serveis dels leads convertits i oportunitats perdudes per «més endavant»
  const leads = await all<{ converted_client_id: string | null; services: Service[] }>((f) => byClient(sb.from("crm_leads").select("converted_client_id,services").not("converted_client_id", "is", null), "converted_client_id").range(f, f + 999)).catch(() => []);
  const interests = new Map<string, Set<Service>>();
  for (const l of leads) if (l.converted_client_id) for (const s of l.services ?? []) (interests.get(l.converted_client_id) ?? interests.set(l.converted_client_id, new Set()).get(l.converted_client_id)!).add(s);
  for (const o of oppsRaw) if (o.client_id && o.stage === "perdut" && o.service && /m[eé]s endavant|futur|ara no/i.test(o.lost_reason ?? "")) (interests.get(o.client_id) ?? interests.set(o.client_id, new Set()).get(o.client_id)!).add(o.service);

  const kwhByClient = new Map<string, number>();
  for (const s of supplies) if (s.annual_kwh != null) kwhByClient.set(s.client_id, (kwhByClient.get(s.client_id) ?? 0) + Number(s.annual_kwh));
  const supplyById = new Map(supplies.map((s) => [s.id, s]));
  const clients: ClientRow[] = clientsRaw.map((c) => {
    const ks = contracts.filter((k) => k.client_id === c.id);
    const active = ks.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status));
    const services = new Set<Service>();
    for (const k of active) { const s = k.supply_id ? supplyById.get(k.supply_id) : null; services.add(s?.energy_type === "gas" ? "gas" : "llum_empresa"); }
    for (const o of oppsRaw) if (o.client_id === c.id && o.stage === "guanyat" && o.service) services.add(o.service);
    return {
      id: c.id, name: c.name, status: c.status, owner_id: c.owner_id, commercial_opt_out: !!c.commercial_opt_out, contact_preference: c.contact_preference ?? "qualsevol", province: c.province,
      last_activity_at: lastClient[c.id] ?? null, active_contracts: active.length, ended_contracts: ks.filter((k) => k.status === "finalitzat").length,
      annual_kwh: kwhByClient.get(c.id) ?? null, services: [...services], interests: [...(interests.get(c.id) ?? [])], tags: c.tags ?? [],
    };
  });

  // condicions actuals: (1) condicions acceptades a l'expedient que va originar el contracte (Fase 3)
  const conditions = new Map<string, { conditions: CurrentConditions; label: string; date: string | null }>();
  const contractIds = contracts.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status)).map((k) => k.id);
  for (let i = 0; i < contractIds.length; i += 200) {
    const { data, error } = await sb.from("crm_expedients").select("code,contract_id,accepted_terms_id,crm_expedient_terms!crm_exp_terms_fk(conditions,captured_at)").in("contract_id", contractIds.slice(i, i + 200)).not("accepted_terms_id", "is", null);
    if (error) { if (isMissing(error)) break; throw error; }
    for (const e of (data ?? []) as unknown as { code: string; contract_id: string; crm_expedient_terms: { conditions: CurrentConditions; captured_at: string } | { conditions: CurrentConditions; captured_at: string }[] | null }[]) {
      const t = Array.isArray(e.crm_expedient_terms) ? e.crm_expedient_terms[0] : e.crm_expedient_terms;
      if (t) conditions.set(e.contract_id, { conditions: t.conditions, label: `Condicions acceptades a l'expedient ${e.code}`, date: t.captured_at.slice(0, 10) });
    }
  }
  // (2) preus actuals llegits d'una factura en una comparativa anterior del mateix subministrament
  const comparisonCurrent = new Map<string, { sheet: PriceSheet; retailer: string | null; label: string; date: string }>();
  const supplyIds = supplies.map((s) => s.id);
  for (let i = 0; i < supplyIds.length; i += 200) {
    const { data } = await sb.from("comparisons").select("crm_supply_id,created_at,snapshot->current,snapshot->currentRetailer,snapshot->currentLabel,mode").in("crm_supply_id", supplyIds.slice(i, i + 200)).order("created_at", { ascending: false });
    for (const c of (data ?? []) as unknown as { crm_supply_id: string; created_at: string; current: PriceSheet | null; currentRetailer: string | null; currentLabel: string | null; mode: string }[]) {
      if (c.current && !comparisonCurrent.has(c.crm_supply_id)) comparisonCurrent.set(c.crm_supply_id, { sheet: c.current, retailer: c.currentRetailer, label: `Comparativa del ${c.created_at.slice(0, 10)}${c.mode === "factura" ? " (preus de factura)" : ""}${c.currentLabel ? ` · ${c.currentLabel}` : ""}`, date: c.created_at.slice(0, 10) });
    }
  }
  const rulesRes = await sb.from("fin_rules").select("*").in("status", ["aprovada", "pendent_aprovacio"]);
  return { contracts, supplies, clients, opps: oppsRaw, lastOppActivity: lastOpp, conditions, comparisonCurrent, rules: isMissing(rulesRes.error) ? [] : ((rulesRes.data ?? []) as RuleRow[]) };
}

interface Built { cand: Candidate; analysis: Analysis | null; analysisInputs: Record<string, unknown> | null; saving: number | null; savingStatus: "estimat" | "pendent_preu_actual" | "no_aplicable"; annualKwh: number | null; quality: Candidate["dataQuality"] }

function analyseFor(L: Loaded, supply: Loaded["supplies"][number], contract: Loaded["contracts"][number] | null, offers: OfferVersion[], day: string, sas: SasConfig) {
  const { input, missing } = supplyInputFrom(supply, { kwh: supply.data_source === "sips" ? "sips" : supply.data_source === "factura" ? "factura" : "crm", kw: supply.data_source === "sips" ? "sips" : "crm" });
  const terms = contract ? L.conditions.get(contract.id) : undefined;
  const fromTerms = terms ? sheetFromConditions(terms.conditions, supply.energy_type) : { sheet: null, missing: ["Condicions actuals"] };
  const cmp = L.comparisonCurrent.get(supply.id);
  const retailer = contract?.retailer ?? supply.current_retailer ?? null;
  const cmpUsable = cmp && (!retailer || !cmp.retailer || cmp.retailer.trim().toLowerCase() === retailer.trim().toLowerCase());
  const current = fromTerms.sheet ?? (cmpUsable ? cmp!.sheet : null);
  const currentSource = fromTerms.sheet ? { label: terms!.label, date: terms!.date } : cmpUsable ? { label: cmp!.label, date: cmp!.date } : null;
  const tc = terms?.conditions as (CurrentConditions & { permanence_months?: number | null; penalty?: string | null }) | undefined;
  const analysis = analyseSupply({ supply: input, supplyMissing: missing, current, currentMissing: fromTerms.missing, currentRetailer: retailer, currentSource, currentContract: contract ? { endDate: contract.end_date, startDate: contract.start_date ?? null, permanenceMonths: tc?.permanence_months ?? null, penalty: tc?.penalty ?? null } : null, offers, today: day, sas });
  const inputs = { supply: input, supplyId: supply.id, cups: supply.cups, contractId: contract?.id ?? null, current, currentSource, currentRetailer: retailer, sas: analysis.sasScenarios.length ? sas : null };
  return { analysis, inputs, gaps: supplyGaps(supply) };
}

/**
 * Executa el motor. Idempotent: les oportunitats es identifiquen per `dedupe_key`, les recomanacions per hash
 * d'entrades, les tasques i avisos per `rule_key`. Una sola execució alhora (índex únic sobre «en_curs»).
 */
export async function runIntelligence(trigger: "cron" | "manual" | "event", opts: { userId?: string | null; clientId?: string | null } = {}) {
  const sb = adminClient();
  const day = today();
  let cfg: Awaited<ReturnType<typeof aiRules>>;
  try { cfg = await aiRules(sb); } catch (e) { if (isMissing(e as DbErr)) return { skipped: "Falta la migració 012" }; throw e; }
  if (trigger === "cron" && !cfg.motorEnabled) return { skipped: "Motor desactivat" };
  // bloqueig caducat (procés interromput): s'allibera després de 30 minuts
  await sb.from("ai_analysis_runs").update({ status: "error", finished_at: new Date().toISOString(), errors: ["Bloqueig caducat: execució interrompuda"] }).eq("status", "en_curs").lt("started_at", new Date(Date.now() - 30 * 60_000).toISOString());
  const prev = await sb.from("ai_analysis_runs").select("status,attempts").neq("status", "omesa").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const attempts = prev.data?.status === "error" ? Math.min(10, (prev.data.attempts as number) + 1) : 1;
  if (trigger === "cron" && attempts > cfg.motor.max_attempts) {
    await sb.from("ai_analysis_runs").insert({ trigger, status: "omesa", attempts: Math.min(10, attempts), errors: [`Massa errors consecutius (${attempts - 1}): cal revisar-ho manualment`], finished_at: new Date().toISOString() });
    return { skipped: "Massa errors consecutius" };
  }
  const run = await sb.from("ai_analysis_runs").insert({ trigger, scope: opts.clientId ? { client_id: opts.clientId } : {}, attempts, started_by: opts.userId ?? null }).select("id").single();
  if (run.error) {
    if (run.error.code === "23505") return { skipped: "Ja hi ha una anàlisi en curs" };
    throw run.error;
  }
  const runId = run.data.id as string;
  const errors: string[] = [];
  const stats = { candidats: 0, noves: 0, actualitzades: 0, comparatives: 0, recomanacions: 0, tasques: 0, avisos: 0, caducades: 0, esborranys: 0, purgades: 0, omeses_oposicio: 0 };
  try {
    const offers = await catalogOffers(sb);
    const snapshotId = await snapshotCatalog(sb, offers, day);
    await sb.from("ai_analysis_runs").update({ tariff_snapshot_id: snapshotId }).eq("id", runId);
    const L = await loadPortfolio(sb, opts.clientId ?? null);
    const clientById = new Map(L.clients.map((c) => [c.id, c]));
    const supplyById = new Map(L.supplies.map((s) => [s.id, s]));
    const built: Built[] = [];
    let comparisons = 0;
    const analyse = (supply: Loaded["supplies"][number], contract: Loaded["contracts"][number] | null) => {
      if (comparisons >= cfg.motor.max_comparisons) return null;
      comparisons++;
      return analyseFor(L, supply, contract, offers, day, cfg.sas);
    };

    // 1. renovacions (amb comparativa del subministrament si n'hi ha dades)
    const renewals = detectRenewals(L.contracts, day, cfg.motor.renewal_days);
    const renewalSupplies = new Set<string>();
    for (const c of renewals) {
      const k = L.contracts.find((x) => x.id === c.contractId)!;
      const s = k.supply_id ? supplyById.get(k.supply_id) : undefined;
      let a: ReturnType<typeof analyseFor> | null = null;
      if (s) { renewalSupplies.add(s.id); a = analyse(s, k); }
      const top = a?.analysis.alternatives[0];
      built.push({ cand: { ...c, service: s?.energy_type === "gas" ? "gas" : "llum_empresa", evidence: [...c.evidence, ...(a ? [{ label: "Preus actuals", value: a.analysis.current.known ? `${a.analysis.current.label}` : PENDING_PRICE, source: a.analysis.current.source ?? "—", date: a.analysis.current.date }] : [])] }, analysis: a?.analysis ?? null, analysisInputs: a?.inputs ?? null, saving: top?.saving ?? null, savingStatus: top ? (top.saving != null ? "estimat" : "pendent_preu_actual") : "no_aplicable", annualKwh: s?.annual_kwh ?? null, quality: a ? dataQualityOf(a.gaps, a.analysis.current.known) : "incomplet" });
    }
    // 2-3. estalvi i contractes cars (contractes actius fora de la finestra de renovació, amb preu actual conegut)
    for (const k of L.contracts) {
      if (!["actiu", "renovacio_pendent"].includes(k.status) || !k.supply_id || renewalSupplies.has(k.supply_id)) continue;
      const s = supplyById.get(k.supply_id);
      if (!s || (!L.conditions.has(k.id) && !L.comparisonCurrent.has(s.id))) continue;
      const a = analyse(s, k);
      if (!a) break;
      const kind = classifySaving(a.analysis, cfg.motor);
      if (!kind) continue;
      const top = a.analysis.alternatives[0];
      built.push({
        cand: {
          kind, dedupeKey: `estalvi:${s.id}:${k.id}`, clientId: k.client_id, supplyId: s.id, contractId: k.id, ownerId: k.owner_id ?? k.client_owner_id ?? null, service: s.energy_type === "gas" ? "gas" : "llum_empresa",
          title: `${kind === "contracte_car" ? "Contracte potencialment car" : "Possible estalvi"} · ${k.client_name ?? s.cups}`,
          summary: `Amb les tarifes vigents, ${top.supplier} ${top.product} costaria ${eurTxt(top.annualCost)} l'any: estalvi estimat de ${eurTxt(top.saving)} (${top.savingPct?.toLocaleString("ca-ES")} %) respecte de les condicions actuals amb ${k.retailer}.`,
          evidence: [{ label: "Cost anual actual estimat", value: eurTxt(a.analysis.current.annualCost), source: a.analysis.current.source ?? "Condicions actuals", date: a.analysis.current.date }, { label: "Millor alternativa", value: `${top.supplier} ${top.product} v${top.version}`, source: top.source ?? "Catàleg de tarifes", date: top.validFrom }],
          dataQuality: "complet", signals: {},
        },
        analysis: a.analysis, analysisInputs: a.inputs, saving: top.saving, savingStatus: "estimat", annualKwh: s.annual_kwh, quality: dataQualityOf(a.gaps, true),
      });
    }
    // 4. potència (optimitzador existent sobre dades SIPS desades)
    try {
      const { readCache } = await import("./sips");
      const { cupsBase, supplyFromRecord } = await import("@/energy/lib/sips-record");
      const { runOptimizer } = await import("@/energy/lib/optimizer");
      const { REGULATED_2026, regulatedPowerPrice } = await import("@/energy/lib/tariffs");
      const elec = L.supplies.filter((s) => s.energy_type === "luz");
      const cache = await readCache([...new Set(elec.map((s) => cupsBase(s.cups)))], true);
      const byCups = new Map(cache.map((c) => [cupsBase(c.cups), c]));
      for (const s of elec) {
        const raw = byCups.get(cupsBase(s.cups))?.raw;
        if (!raw) continue;
        const sup = supplyFromRecord(raw as Record<string, string | number | null>, { file: "sips_cache", origin: "crm" });
        if (!sup?.tarifa) continue;
        const r = runOptimizer({ supply: sup, tariff: sup.tarifa, prices: regulatedPowerPrice(REGULATED_2026, sup.tarifa), excess45: REGULATED_2026.excess45[sup.tarifa], modCosts: { extensionEurKW: 17.374714, accesoEurKW: 19.703137, fixedEur: 9.04476 } }, { only: "equilibrado", today: day });
        const sc = r.scenarios[0];
        const c = powerCandidate(s, { ok: r.ok && !!sc?.feasible, reason: r.reason, currentKw: sup.potContratada.slice(0, sc?.pc.length ?? 0), proposedKw: sc?.pc ?? [], netSavingLB: sc?.netSavingLB ?? 0, confidenceLevel: r.confidence.level, confidenceReasons: r.confidence.reasons, needed: r.confidence.needed, violations: sc?.violations.length ?? 0 }, day, cfg.motor.min_power_saving_eur);
        if (c) built.push({ cand: { ...c, service: "llum_empresa" }, analysis: null, analysisInputs: null, saving: null, savingStatus: "no_aplicable", annualKwh: s.annual_kwh, quality: c.dataQuality });
      }
    } catch (e) {
      errors.push(`Optimització de potència: ${(e as Error).message?.slice(0, 160)}`);
    }
    // 5-8. recuperació, venda creuada, propostes sense resposta, dades incompletes
    const optedOut = L.clients.filter((c) => !contactAllowed(c)).length;
    stats.omeses_oposicio = optedOut;
    for (const c of [...detectRecovery(L.clients, day, cfg.motor.inactive_days), ...detectCrossSell(L.clients, day)]) built.push({ cand: c, analysis: null, analysisInputs: null, saving: null, savingStatus: "no_aplicable", annualKwh: clientById.get(c.clientId!)?.annual_kwh ?? null, quality: c.dataQuality });
    for (const c of detectUnanswered(L.opps, L.lastOppActivity, day, cfg.motor.proposal_days)) built.push({ cand: c, analysis: null, analysisInputs: null, saving: null, savingStatus: "no_aplicable", annualKwh: c.supplyId ? supplyById.get(c.supplyId)?.annual_kwh ?? null : null, quality: c.dataQuality });
    const activeClients = new Set(L.contracts.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status)).map((k) => k.client_id));
    for (const c of detectIncomplete(L.supplies.filter((s) => activeClients.has(s.client_id)), L.contracts.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status) && !k.end_date))) built.push({ cand: c, analysis: null, analysisInputs: null, saving: null, savingStatus: "no_aplicable", annualKwh: null, quality: "incomplet" });
    // 9. tarifes caducades (només en anàlisis completes)
    if (!opts.clientId) for (const c of detectExpiredTariffs(offers, day)) built.push({ cand: c, analysis: null, analysisInputs: null, saving: null, savingStatus: "no_aplicable", annualKwh: null, quality: "complet" });
    stats.candidats = built.length;
    stats.comparatives = comparisons;

    const persisted = await persist(sb, runId, snapshotId, built, L, cfg, day, stats, errors);
    // tancament: oportunitats noves que ja no es detecten → caducades (només anàlisi completa)
    if (!opts.clientId && !errors.length) {
      // si s'ha arribat al límit de comparatives, les d'estalvi no analitzades no es tanquen
      let q = sb.from("ai_opportunities").update({ status: "caducada", status_reason: "Ja no es detecta en l'última anàlisi" }).eq("status", "nova").neq("last_run_id", runId);
      if (comparisons >= cfg.motor.max_comparisons) q = q.not("kind", "in", "(estalvi,contracte_car)");
      const stale = await q.select("id");
      stats.caducades = stale.data?.length ?? 0;
    }
    // esborranys automàtics (desactivat per defecte; mai s'envien)
    if (cfg.autoDrafts.enabled && !opts.clientId) {
      const top = persisted.filter((p) => p.score >= (cfg.autoDrafts.min_score ?? 75) && p.hasAlternatives && p.isNew).slice(0, cfg.autoDrafts.max_per_run ?? 20);
      for (const p of top) {
        try { await prepareProposal(null, p.id); stats.esborranys++; } catch (e) { errors.push(`Esborrany ${p.id}: ${(e as Error).message.slice(0, 120)}`); }
      }
    }
    if (cfg.retention.enabled && !opts.clientId) {
      const purge = await sb.rpc("ai_purge_expired");
      stats.purgades = (purge.data as number | null) ?? 0;
    }
    await sb.from("ai_analysis_runs").update({ status: errors.length ? "parcial" : "ok", stats, errors: errors.slice(0, 50), finished_at: new Date().toISOString() }).eq("id", runId);
    return { runId, stats, errors: errors.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("ai_analysis_runs").update({ status: "error", stats, errors: [...errors, msg.slice(0, 300)].slice(0, 50), finished_at: new Date().toISOString() }).eq("id", runId);
    console.error("[intel·ligència]", msg.slice(0, 200));
    throw e;
  }
}

async function persist(sb: SB, runId: string, snapshotId: string | null, built: Built[], L: Loaded, cfg: Awaited<ReturnType<typeof aiRules>>, day: string, stats: Record<string, number>, errors: string[]) {
  const out: { id: string; score: number; hasAlternatives: boolean; isNew: boolean }[] = [];
  const keys = built.map((b) => b.cand.dedupeKey);
  const existing = new Map<string, { id: string; status: string; score: number; milestone: number | null }>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await sb.from("ai_opportunities").select("id,dedupe_key,status,score,milestone").in("dedupe_key", keys.slice(i, i + 200));
    if (error) throw error;
    for (const r of data ?? []) existing.set(r.dedupe_key as string, { id: r.id as string, status: r.status as string, score: r.score as number, milestone: r.milestone as number | null });
  }
  const clientById = new Map(L.clients.map((c) => [c.id, c]));
  const staffIds = ((await sb.from("profiles").select("id").in("role", ["admin", "cap_administrativa"])).data ?? []).map((p) => p.id as string);
  const oppByKey = new Map(L.opps.map((o) => [o.id, o]));
  for (const b of built) {
    const c = b.cand;
    try {
      const client = c.clientId ? clientById.get(c.clientId) : undefined;
      const allowed = client ? contactAllowed(client) : true;
      const top = b.analysis?.alternatives[0] ?? null;
      const owner = c.ownerId ?? client?.owner_id ?? null;
      const linked = c.kind === "proposta_sense_resposta" ? oppByKey.get(c.dedupeKey.split(":")[1]) : undefined;
      const si = {
        ...c.signals,
        daysToDue: c.signals?.daysToDue ?? (c.dueDate ? daysBetween(day, c.dueDate) : null),
        savingEur: b.saving, savingPct: top?.savingPct ?? null,
        annualKwh: b.annualKwh, dataQuality: b.quality,
        lastActivityDays: c.signals?.lastActivityDays ?? (client?.last_activity_at ? daysBetween(client.last_activity_at, day) : null),
        needsFollowUp: c.signals?.needsFollowUp ?? (c.kind === "renovacio"),
        conversion: c.signals?.conversion ?? (linked ? 0.5 : null),
      };
      const sc = scoreOpportunity(si, cfg.weights);
      const econ = top ? estimateEconomics(L.rules, top, { service: c.service ?? null, segment: deriveSegment(c.service ?? null, null, b.annualKwh), annualKwh: b.annualKwh, today: day, ownerId: owner }) : [];
      const prov = econ.find((e) => e.layer === "proveidor"), marge = econ.find((e) => e.layer === "marge");
      const bv = businessValue({ providerEur: prov?.amount != null ? Number(prov.amount) : null, marginEur: marge?.amount != null ? Number(marge.amount) : null }, cfg.businessWeights);
      const prevRow = existing.get(c.dedupeKey);
      const row = {
        kind: c.kind, dedupe_key: c.dedupeKey, client_id: c.clientId, supply_id: c.supplyId ?? null, contract_id: c.contractId ?? null, owner_id: owner,
        title: c.title.slice(0, 200), summary: c.summary, evidence: c.evidence, milestone: c.milestone ?? null, due_date: c.dueDate ?? null,
        potential_saving_eur: b.saving, saving_status: b.savingStatus, annual_kwh: b.annualKwh, data_quality: b.quality,
        score: sc.score, business_value: bv, score_factors: sc.factors, service: c.service ?? null, contact_allowed: allowed,
        last_run_id: runId, last_seen_at: new Date().toISOString(),
      };
      let id: string;
      let isNew = false;
      if (prevRow) {
        id = prevRow.id;
        const closed = ["descartada", "guanyada", "caducada"].includes(prevRow.status);
        // les tancades no es reobren; una «caducada» que torna a aparèixer es reactiva com a nova
        const patch = closed && prevRow.status !== "caducada" ? { last_seen_at: row.last_seen_at, last_run_id: runId } : { ...row, ...(prevRow.status === "caducada" ? { status: "nova", status_reason: null } : {}) };
        const u = await sb.from("ai_opportunities").update(patch).eq("id", id);
        if (u.error) throw u.error;
        stats.actualitzades++;
        if (closed && prevRow.status !== "caducada") continue;
      } else {
        const ins = await sb.from("ai_opportunities").upsert({ ...row, first_run_id: runId }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
        if (ins.error) throw ins.error;
        if (!ins.data?.length) continue; // creada per una execució concurrent
        id = ins.data[0].id as string;
        isNew = true;
        stats.noves++;
        await log(sb, runId, "ai_motor", `detectada:${c.dedupeKey}`, "ai_opportunities", id, "detectada", { kind: c.kind, score: sc.score });
      }
      if (!prevRow || prevRow.score !== sc.score) await sb.from("opportunity_scores").insert({ opportunity_id: id, run_id: runId, score: sc.score, business_value: bv, factors: sc.factors, weights: cfg.weights });
      if (b.analysis && b.analysisInputs) {
        const inputHash = sha({ inputs: b.analysisInputs, snapshotId, engine: b.analysis.engineVersion, day });
        const rec = await sb.from("ai_recommendations").upsert({
          opportunity_id: id, run_id: runId, tariff_snapshot_id: snapshotId, engine_version: b.analysis.engineVersion, input_hash: inputHash, inputs: b.analysisInputs,
          current_cost: b.analysis.current.known ? b.analysis.current : null, alternatives: b.analysis.alternatives, sas_scenario: b.analysis.sasScenarios.length ? b.analysis.sasScenarios : null,
          one_off_costs: b.analysis.oneOff, hypotheses: b.analysis.hypotheses, missing: [...new Set(b.analysis.missing)], narrative: narrativeFromAnalysis(b.analysis, client?.name ?? null), narrative_source: "plantilla",
        }, { onConflict: "opportunity_id,input_hash", ignoreDuplicates: true }).select("id");
        if (rec.error) throw rec.error;
        stats.recomanacions += rec.data?.length ?? 0;
      }
      if (econ.length) await sb.from("ai_opportunity_economics").upsert(econ.map((e) => ({ opportunity_id: id, layer: e.layer, beneficiary_id: e.beneficiary_id, amount: e.amount, status: e.status, rule_ref: e.rule_ref, formula: e.formula, collection_status: "no_meritat", computed_at: new Date().toISOString() })), { onConflict: "opportunity_id,layer" });

      // tasques i avisos interns (idempotents per rule_key)
      const link = { view: "ia-oportunitat", params: { id } };
      if (c.kind === "renovacio" && owner) {
        const t = await sb.from("crm_tasks").upsert({ rule_key: `ai:${c.dedupeKey}`, client_id: c.clientId, contract_id: c.contractId, title: `Preparar la renovació: ${c.title}`.slice(0, 200), notes: `${c.summary}\nOportunitat detectada per Intel·ligència IA.`, due_at: new Date(Date.parse(c.dueDate!) - Math.min(30, Math.max(0, daysBetween(day, c.dueDate!) - 1)) * 86_400_000).toISOString(), assigned_to: owner, kind: "renovacio", source: "automatica", status: "pendent", created_by: null }, { onConflict: "rule_key", ignoreDuplicates: true }).select("id");
        if (t.error && !isMissing(t.error)) throw t.error;
        stats.tasques += t.data?.length ?? 0;
        const n = await sb.from("crm_notifications").upsert({ user_id: owner, kind: "ia", title: `Renovació a ${c.milestone === 0 ? "vençut" : `${c.milestone} dies`}: ${c.title}`.slice(0, 200), body: c.summary, link, rule_key: `ai:${c.dedupeKey}:${c.milestone}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
        stats.avisos += n.data?.length ?? 0;
      } else if ((c.kind === "estalvi" || c.kind === "contracte_car") && owner && isNew && sc.score >= 60 && allowed) {
        const t = await sb.from("crm_tasks").upsert({ rule_key: `ai:${c.dedupeKey}`, client_id: c.clientId, contract_id: c.contractId, title: `Revisar ${AI_KIND_LABEL[c.kind].toLowerCase()}: ${c.title}`.slice(0, 200), notes: c.summary, due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), assigned_to: owner, kind: "seguiment", source: "automatica", status: "pendent", created_by: null }, { onConflict: "rule_key", ignoreDuplicates: true }).select("id");
        stats.tasques += t.data?.length ?? 0;
      } else if (c.kind === "tarifa_caducada") {
        for (const s of staffIds) {
          const n = await sb.from("crm_notifications").upsert({ user_id: s, kind: "ia", title: c.title.slice(0, 200), body: c.summary, link: { view: "ia", params: { kind: "tarifa_caducada" } }, rule_key: `ai:${c.dedupeKey}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
          stats.avisos += n.data?.length ?? 0;
        }
      } else if (isNew && owner && (c.kind === "potencia" || c.kind === "dades_incompletes")) {
        const n = await sb.from("crm_notifications").upsert({ user_id: owner, kind: "ia", title: `${AI_KIND_LABEL[c.kind]}: ${c.title}`.slice(0, 200), body: c.summary, link, rule_key: `ai:${c.dedupeKey}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true }).select("id");
        stats.avisos += n.data?.length ?? 0;
      }
      out.push({ id, score: sc.score, hasAlternatives: !!top, isNew });
    } catch (e) {
      errors.push(`${c.dedupeKey}: ${(e as Error).message?.slice(0, 160)}`);
    }
  }
  return out;
}

async function log(sb: SB, runId: string | null, rule: string, key: string, entity: string, entityId: string | null, action: string, detail: unknown, outcome: "ok" | "omesa" | "error" = "ok") {
  await sb.from("ai_automation_logs").upsert({ run_id: runId, rule_key: rule, idempotency_key: key, entity, entity_id: entityId, action, outcome, detail }, { onConflict: "idempotency_key", ignoreDuplicates: true });
}

/* ======================================================================= consultes (RLS) */

export const filtersSchema = z.object({
  owner: z.string().max(60).optional(), client: z.string().max(100).optional(), retailer: z.string().max(100).optional(), tariff: z.string().max(20).optional(),
  province: z.string().max(60).optional(), kwhMin: z.coerce.number().min(0).optional(), kwhMax: z.coerce.number().min(0).optional(), savingMin: z.coerce.number().optional(),
  dueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().max(30).optional(), kind: z.string().max(40).optional(), clientId: z.string().uuid().optional(),
});
export type Filters = z.infer<typeof filtersSchema>;

type OppList = {
  id: string; kind: AiKind; status: string; title: string; summary: string | null; score: number; business_value: number | null; potential_saving_eur: string | null; saving_status: string;
  due_date: string | null; milestone: number | null; data_quality: string; owner_id: string | null; client_id: string | null; supply_id: string | null; contract_id: string | null; crm_opportunity_id: string | null;
  annual_kwh: string | null; contact_allowed: boolean; detected_at: string; service: string | null;
  crm_clients: { name: string; province: string | null } | null; crm_supplies: { cups: string; access_tariff: string | null; current_retailer: string | null; province: string | null } | null; crm_contracts: { retailer: string; end_date: string | null } | null;
};
const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function listOpportunities(u: U, raw: Record<string, string>) {
  const f = filtersSchema.parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "")));
  let q = u.sb.from("ai_opportunities").select("id,kind,status,title,summary,score,business_value,potential_saving_eur,saving_status,due_date,milestone,data_quality,owner_id,client_id,supply_id,contract_id,crm_opportunity_id,annual_kwh,contact_allowed,detected_at,service,crm_clients(name,province),crm_supplies(cups,access_tariff,current_retailer,province),crm_contracts(retailer,end_date)");
  if (f.status === "obertes" || !f.status) q = q.in("status", OPEN_AI_STATUSES);
  else if (f.status !== "totes") q = q.eq("status", f.status);
  if (f.kind) q = q.eq("kind", f.kind);
  if (f.clientId) q = q.eq("client_id", f.clientId);
  if (f.owner === "meu") q = q.eq("owner_id", u.user.id);
  else if (f.owner && /^[0-9a-f-]{36}$/.test(f.owner)) q = q.eq("owner_id", f.owner);
  if (f.dueFrom) q = q.gte("due_date", f.dueFrom);
  if (f.dueTo) q = q.lte("due_date", f.dueTo);
  if (f.savingMin != null) q = q.gte("potential_saving_eur", f.savingMin);
  if (f.kwhMin != null) q = q.gte("annual_kwh", f.kwhMin);
  if (f.kwhMax != null) q = q.lte("annual_kwh", f.kwhMax);
  const { data, error } = await q.order("score", { ascending: false }).order("detected_at", { ascending: false }).limit(2000);
  if (error) {
    if (isMissing(error)) return { migrated: false, items: [] as OppList[] };
    throw new HttpError(500, "No s'han pogut carregar les oportunitats");
  }
  const items = ((data ?? []) as unknown as OppList[]).filter((o) => {
    if (f.client && !norm(o.crm_clients?.name).includes(norm(f.client))) return false;
    if (f.retailer && !norm(o.crm_contracts?.retailer ?? o.crm_supplies?.current_retailer).includes(norm(f.retailer))) return false;
    if (f.tariff && norm(o.crm_supplies?.access_tariff) !== norm(f.tariff)) return false;
    if (f.province && !norm(o.crm_supplies?.province ?? o.crm_clients?.province).includes(norm(f.province))) return false;
    return true;
  });
  return { migrated: true, items };
}

export async function dashboard(u: U, raw: Record<string, string>) {
  const { migrated, items } = await listOpportunities(u, raw);
  if (!migrated) return { migrated, kpis: null, items: [], ranking: [], savingsByKind: [], calendar: [], runs: [], owners: [] };
  const ids = items.map((i) => i.id);
  // comissions potencials visibles (RLS: staff totes; comercial només la seva capa)
  const econ: { opportunity_id: string; layer: string; amount: string | null; status: string; beneficiary_id: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 300) econ.push(...(((await u.sb.from("ai_opportunity_economics").select("opportunity_id,layer,amount,status,beneficiary_id").in("opportunity_id", ids.slice(i, i + 300))).data ?? []) as typeof econ));
  const drafts = ((await u.sb.from("ai_proposal_drafts").select("id,status,opportunity_id").in("status", ["esborrany", "aprovada", "enviada"])).data ?? []) as { status: string }[];
  const tasks = (await u.sb.from("crm_tasks").select("id,title,due_at,client_id,assigned_to,rule_key").eq("status", "pendent").like("rule_key", "ai:%").order("due_at").limit(200)).data ?? [];
  const sumEstimated = (layer: string) => econ.filter((e) => e.layer === layer && e.amount != null && (e.status === "estimat" || e.status === "simulacio")).reduce((a, e) => a + Number(e.amount), 0);
  const savings = items.filter((i) => i.saving_status === "estimat" && i.potential_saving_eur != null && Number(i.potential_saving_eur) > 0);
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const kpis = {
    detected: items.length,
    highPriority: items.filter((i) => i.score >= 70).length,
    renewals: items.filter((i) => i.kind === "renovacio").length,
    savingEstimated: Math.round(savings.reduce((a, i) => a + Number(i.potential_saving_eur), 0) * 100) / 100,
    savingCount: savings.length,
    pendingPrice: items.filter((i) => i.saving_status === "pendent_preu_actual").length,
    commission: isStaff(u)
      ? { scope: "a3" as const, amount: econ.some((e) => e.layer === "proveidor" && e.amount != null) ? Math.round(sumEstimated("proveidor") * 100) / 100 : null, simulations: econ.filter((e) => e.layer === "proveidor" && e.status === "simulacio").length }
      : { scope: "own" as const, amount: econ.some((e) => e.layer === "comercial" && e.beneficiary_id === u.user.id && e.amount != null) ? Math.round(econ.filter((e) => e.layer === "comercial" && e.beneficiary_id === u.user.id && e.amount != null).reduce((a, e) => a + Number(e.amount), 0) * 100) / 100 : null, simulations: econ.filter((e) => e.layer === "comercial" && e.status === "simulacio").length },
    proposalsPrepared: drafts.filter((d) => d.status === "esborrany" || d.status === "aprovada").length,
    proposalsSent: drafts.filter((d) => d.status === "enviada").length,
    suggestedTasks: tasks.length,
    energyAlerts: items.filter((i) => i.kind === "potencia" || i.kind === "tarifa_caducada").length,
    clientsWithoutData: new Set(items.filter((i) => i.kind === "dades_incompletes").map((i) => i.client_id)).size,
  };
  const byClient = new Map<string, { clientId: string; name: string; score: number; count: number; saving: number; kinds: AiKind[] }>();
  for (const i of items) {
    if (!i.client_id) continue;
    const r = byClient.get(i.client_id) ?? { clientId: i.client_id, name: i.crm_clients?.name ?? "—", score: 0, count: 0, saving: 0, kinds: [] };
    r.score = Math.max(r.score, i.score); r.count++; if (i.saving_status === "estimat" && i.potential_saving_eur) r.saving += Number(i.potential_saving_eur);
    if (!r.kinds.includes(i.kind)) r.kinds.push(i.kind);
    byClient.set(i.client_id, r);
  }
  const savingsByKind = (["renovacio", "estalvi", "contracte_car"] as AiKind[]).map((k) => ({ kind: k, label: AI_KIND_LABEL[k], estimated: Math.round(savings.filter((i) => i.kind === k).reduce((a, i) => a + Number(i.potential_saving_eur), 0) * 100) / 100, pending: items.filter((i) => i.kind === k && i.saving_status === "pendent_preu_actual").length }));
  const calendar = [
    ...items.filter((i) => i.due_date && i.due_date <= in60).map((i) => ({ date: i.due_date!, title: i.title, kind: i.kind as string, id: i.id, type: "oportunitat" as const })),
    ...tasks.filter((t) => t.due_at && (t.due_at as string).slice(0, 10) <= in60).map((t) => ({ date: (t.due_at as string).slice(0, 10), title: t.title as string, kind: "tasca", id: t.id as string, type: "tasca" as const })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 80);
  const runs = isStaff(u) ? ((await u.sb.from("ai_analysis_runs").select("id,trigger,status,stats,errors,started_at,finished_at,attempts").order("started_at", { ascending: false }).limit(8)).data ?? []) : [];
  const owners = ((await u.sb.from("profiles").select("id,name,role").in("role", ["admin", "comercial", "cap_administrativa", "administrativa"])).data ?? []).map((p) => ({ id: p.id as string, name: p.name as string }));
  return { migrated, kpis, items: items.slice(0, 300), total: items.length, ranking: [...byClient.values()].sort((a, b) => b.score - a.score || b.saving - a.saving).slice(0, 10), savingsByKind, calendar, runs, owners, canRun: isStaff(u), canConfigure: u.profile.role === "admin" };
}

export async function opportunityDetail(u: U, id: string) {
  const { data: o, error } = await u.sb.from("ai_opportunities").select("*,crm_clients(id,name,province,commercial_opt_out,contact_preference),crm_supplies(id,cups,access_tariff,annual_kwh,power_kw,current_retailer,address,energy_type),crm_contracts(id,retailer,product,end_date,status)").eq("id", id).maybeSingle();
  if (error && isMissing(error)) throw new HttpError(400, "Falta aplicar la migració 012");
  if (!o) throw new HttpError(404, "Oportunitat no trobada o sense permís");
  const [recs, scores, econ, drafts] = await Promise.all([
    u.sb.from("ai_recommendations").select("*").eq("opportunity_id", id).order("created_at", { ascending: false }).limit(5),
    u.sb.from("opportunity_scores").select("score,business_value,factors,computed_at").eq("opportunity_id", id).order("computed_at", { ascending: false }).limit(10),
    u.sb.from("ai_opportunity_economics").select("*").eq("opportunity_id", id),
    u.sb.from("ai_proposal_drafts").select("*").eq("opportunity_id", id).order("created_at", { ascending: false }),
  ]);
  const snapId = (recs.data?.[0]?.tariff_snapshot_id as string | null) ?? null;
  const snap = snapId ? (await u.sb.from("tariff_snapshots").select("id,taken_at,as_of,offer_count,sha256").eq("id", snapId).maybeSingle()).data : null;
  const canEdit = o.client_id ? !!(await u.sb.rpc("crm_can_edit_client", { p_client: o.client_id })).data : isStaff(u);
  return { opportunity: o, recommendation: recs.data?.[0] ?? null, history: recs.data ?? [], scores: scores.data ?? [], economics: econ.data ?? [], drafts: drafts.data ?? [], tariffSnapshot: snap, canEdit, canSeeInternal: isStaff(u) };
}

/* ======================================================================= accions */

async function assertCanEdit(u: U, clientId: string | null) {
  if (!clientId) { if (!isStaff(u)) throw new HttpError(403, "Només per a l'equip d'administració"); return; }
  const r = await u.sb.rpc("crm_can_edit_client", { p_client: clientId });
  if (!r.data) throw new HttpError(403, "No tens permís per actuar sobre aquest client");
}

export async function setStatus(u: U, id: string, status: "revisada" | "descartada" | "nova", reason: string | null) {
  const { data, error } = await u.sb.from("ai_opportunities").update({ status, status_reason: reason?.slice(0, 300) || null }).eq("id", id).select("id,status");
  if (error) throw new HttpError(400, error.message.replace(/^.*?: /, ""));
  if (!data?.length) throw new HttpError(403, "No tens permís per modificar aquesta oportunitat");
  await log(adminClient(), null, "usuari", `estat:${id}:${status}:${Date.now()}`, "ai_opportunities", id, `estat_${status}`, { by: u.user.id, reason });
  return data[0];
}

/** Re-analitza el client de l'oportunitat (anàlisi manual des del panell). */
export async function analyseClient(u: U, clientId: string) {
  await assertCanEdit(u, clientId);
  return runIntelligence("manual", { userId: u.user.id, clientId });
}

/**
 * Acceptar: crea l'oportunitat comercial (Fase 2) o vincula la que ja hi ha oberta per al mateix client, subministrament i servei.
 * No es creen clients, CUPS ni contractes: es reutilitzen els existents.
 */
export async function acceptOpportunity(u: U, id: string, comparisonId: string | null = null) {
  const { data: o } = await u.sb.from("ai_opportunities").select("id,client_id,supply_id,contract_id,title,service,annual_kwh,owner_id,crm_opportunity_id,status,kind").eq("id", id).maybeSingle();
  if (!o) throw new HttpError(404, "Oportunitat no trobada");
  if (!o.client_id) throw new HttpError(400, "Aquesta alerta no és d'un client");
  await assertCanEdit(u, o.client_id);
  if (o.crm_opportunity_id) return { crmOpportunityId: o.crm_opportunity_id as string, created: false };
  const service = (o.service as Service | null) ?? "llum_empresa";
  let q = u.sb.from("crm_opportunities").select("id,ai_opportunity_id").eq("client_id", o.client_id).eq("service", service).not("stage", "in", "(guanyat,perdut)");
  q = o.supply_id ? q.eq("supply_id", o.supply_id) : q.is("supply_id", null);
  const open = (await q.limit(1)).data?.[0];
  let crmId: string, created = false;
  if (open && !open.ai_opportunity_id) {
    crmId = open.id as string;
    const l = await adminClient().from("crm_opportunities").update({ ai_opportunity_id: id }).eq("id", crmId);
    if (l.error) throw new HttpError(409, "No s'ha pogut vincular l'oportunitat existent");
  } else {
    const ins = await u.sb.from("crm_opportunities").insert({
      client_id: o.client_id, supply_id: o.supply_id, title: (o.title as string).slice(0, 200), service, stage: "estudi", owner_id: o.owner_id ?? u.user.id,
      annual_kwh: o.annual_kwh, comparison_id: comparisonId, ai_opportunity_id: id, priority: "alta", next_action: "Revisar la comparativa i la proposta preparada",
      notes: `Creada des d'Intel·ligència IA (${AI_KIND_LABEL[o.kind as AiKind]}).`,
    }).select("id").single();
    if (ins.error) {
      if (ins.error.code === "23505") {
        const again = (await u.sb.from("crm_opportunities").select("id").eq("ai_opportunity_id", id).maybeSingle()).data;
        if (again) return { crmOpportunityId: again.id as string, created: false };
      }
      throw new HttpError(403, "No s'ha pogut crear l'oportunitat comercial");
    }
    crmId = ins.data.id as string; created = true;
  }
  const up = await u.sb.from("ai_opportunities").update({ status: "acceptada", crm_opportunity_id: crmId, status_reason: "Acceptada pel comercial" }).eq("id", id).select("id");
  if (up.error || !up.data?.length) throw new HttpError(409, "No s'ha pogut actualitzar l'oportunitat detectada");
  await u.sb.from("crm_activities").insert({ client_id: o.client_id, opportunity_id: crmId, type: "nota", title: `Oportunitat acceptada des d'Intel·ligència IA: ${o.title}`.slice(0, 200), user_id: u.user.id, user_name: u.profile.name });
  await log(adminClient(), null, "usuari", `acceptada:${id}`, "ai_opportunities", id, "acceptada", { crmOpportunityId: crmId, created });
  return { crmOpportunityId: crmId, created };
}

/* ======================================================================= propostes */

/**
 * Prepara una proposta: desa la comparativa (taula `comparisons`, reutilitzable des del comparador i la contractació),
 * genera el PDF amb la marca d'esborrany i el guarda a la fitxa documental del client. `u = null` → procés automàtic.
 */
export async function prepareProposal(u: U | null, oppId: string) {
  const sb = adminClient();
  const db = u ? u.sb : sb;
  const { data: o } = await db.from("ai_opportunities").select("id,client_id,supply_id,contract_id,owner_id,crm_opportunity_id,status,title").eq("id", oppId).maybeSingle();
  if (!o) throw new HttpError(404, "Oportunitat no trobada");
  if (!o.client_id) throw new HttpError(400, "No és una oportunitat de client");
  if (u) await assertCanEdit(u, o.client_id);
  if (["descartada", "guanyada", "caducada"].includes(o.status)) throw new HttpError(400, "L'oportunitat està tancada");
  const rec = (await db.from("ai_recommendations").select("*").eq("opportunity_id", oppId).order("created_at", { ascending: false }).limit(1)).data?.[0];
  if (!rec) throw new HttpError(400, "Encara no hi ha cap comparativa calculada per a aquesta oportunitat. Completa les dades i torna a analitzar.");
  const alternatives = rec.alternatives as Analysis["alternatives"];
  if (!alternatives?.length) throw new HttpError(400, "No hi ha alternatives vigents i calculables: no es pot preparar la proposta.");
  // les tarifes han de seguir vigents avui
  const day = today();
  const expired = alternatives.filter((a) => a.validTo && a.validTo < day);
  if (expired.length) throw new HttpError(409, `Hi ha tarifes caducades des de l'anàlisi (${expired.map((e) => e.supplier).join(", ")}): torna a analitzar el client.`);
  const snap = (await sb.from("tariff_snapshots").select("offers").eq("id", rec.tariff_snapshot_id).maybeSingle()).data;
  const offers = ((snap?.offers ?? []) as OfferVersion[]).filter((x) => alternatives.some((a) => a.offerId === x.id));
  const inputs = rec.inputs as { supply: NonNullable<ReturnType<typeof supplyInputFrom>["input"]>; cups: string; current: PriceSheet | null; currentSource: { label: string; date: string | null } | null; currentRetailer: string | null };
  const [{ data: client }, { data: supply }, ownerP] = await Promise.all([
    sb.from("crm_clients").select("name").eq("id", o.client_id).single(),
    o.supply_id ? sb.from("crm_supplies").select("cups,address,access_tariff,annual_kwh,power_kw,energy_type").eq("id", o.supply_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("profiles").select("name,email").eq("id", (u?.user.id ?? o.owner_id) as string).maybeSingle(),
  ]);
  const analysis: Analysis = { ok: true, reason: null, engineVersion: rec.engine_version, asOf: (rec.created_at as string).slice(0, 10), current: rec.current_cost ?? { known: false, label: PENDING_PRICE, retailer: inputs.currentRetailer, annualCost: null, quality: null, source: null, date: null }, alternatives, evaluated: alternatives.length, excluded: [], sasScenarios: rec.sas_scenario ?? [], oneOff: rec.one_off_costs ?? [], hypotheses: rec.hypotheses ?? [], missing: rec.missing ?? [] };
  const validUntil = proposalValidUntil(analysis, day);
  // 1) comparativa al mòdul existent (mateix motor, mateixes ofertes copiades)
  let comparisonId: string | null = null;
  if (offers.length) {
    const snapshot = buildSnapshot({ mode: "cups", clientName: client?.name ?? null, cups: inputs.cups, supply: inputs.supply, current: inputs.current, currentLabel: inputs.currentSource?.label ?? null, currentRetailer: inputs.currentRetailer, offers, weights: DEFAULT_WEIGHTS, dataNotes: [`Preparada des d'Intel·ligència IA (${rec.id}).`] }, day);
    const ins = await sb.from("comparisons").insert({ cups: inputs.cups, client_name: client?.name ?? null, mode: "cups", engine_version: ENGINE_VERSION, snapshot, status: "esborrany", created_by: u?.user.id ?? null, created_by_name: u?.profile.name ?? "Intel·ligència IA", crm_client_id: o.client_id, crm_supply_id: o.supply_id, crm_opportunity_id: o.crm_opportunity_id }).select("id").single();
    if (!ins.error) comparisonId = ins.data.id as string;
  }
  // 2) PDF amb marca d'esborrany a la fitxa documental del client
  const reference = `PROP-${day.replace(/-/g, "")}-${oppId.slice(0, 6).toUpperCase()}`;
  const terms = inputs.current;
  const owner = ownerP.data as { name?: string; email?: string | null } | null;
  const pdfInput = {
    draft: true, reference, client: { name: client?.name ?? "Client" },
    supply: { cups: supply?.cups ?? inputs.cups ?? null, address: supply?.address ?? null, accessTariff: supply?.access_tariff ?? inputs.supply.accessTariff, annualKwh: supply?.annual_kwh ?? inputs.supply.kwhTotal, powerKw: supply?.power_kw ?? inputs.supply.kw, energyType: (supply?.energy_type ?? inputs.supply.energyType) as "luz" | "gas" },
    currentRetailer: inputs.currentRetailer,
    currentPrices: terms ? { energy: terms.energy.some((x) => x != null) ? terms.energy : [terms.energy24h], power: terms.power, powerUnit: terms.powerUnit, source: inputs.currentSource?.label ?? null, date: inputs.currentSource?.date ?? null } : null,
    analysis, validUntil, contact: { name: owner?.name ?? "Assessoria 3.0", email: owner?.email ?? null, phone: null }, generatedAt: new Date(),
  };
  const bytes = buildProposalPdf(pdfInput);
  const { storeServerPdf } = await import("./crm-docs");
  const doc = await storeServerPdf(u, { clientId: o.client_id, supplyId: o.supply_id, contractId: o.contract_id, bytes, fileName: `${reference}-esborrany.pdf`, title: `Proposta ${reference} (ESBORRANY)`, category: "proposta", byName: "Intel·ligència IA" });
  const draft = await sb.from("ai_proposal_drafts").insert({ opportunity_id: oppId, recommendation_id: rec.id, client_id: o.client_id, comparison_id: comparisonId, document_id: doc.id, status: "esborrany", valid_until: validUntil, alternatives, created_by: u?.user.id ?? null }).select("id").single();
  if (draft.error) throw draft.error;
  if (["nova", "revisada"].includes(o.status)) await sb.from("ai_opportunities").update({ status: "proposta_preparada" }).eq("id", oppId);
  await log(sb, null, u ? "usuari" : "ai_esborranys_auto", `esborrany:${draft.data.id}`, "ai_proposal_drafts", draft.data.id as string, "esborrany", { documentId: doc.id, comparisonId, by: u?.user.id ?? "sistema" });
  if (!u && o.owner_id) await sb.from("crm_notifications").upsert({ user_id: o.owner_id, kind: "ia", title: `Esborrany de proposta preparat: ${o.title}`.slice(0, 200), body: "Revisa'l i aprova'l abans d'enviar-lo.", link: { view: "ia-oportunitat", params: { id: oppId } }, rule_key: `ai:esborrany:${draft.data.id}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
  return { draftId: draft.data.id as string, documentId: doc.id, comparisonId, reference, pdfInput };
}

/** Aprovar → nova versió del PDF sense marca d'esborrany. Acceptada/rebutjada → resposta del client. */
export async function decideDraft(u: U, draftId: string, action: "aprova" | "anulla" | "acceptada" | "rebutjada") {
  const { data: d } = await u.sb.from("ai_proposal_drafts").select("*").eq("id", draftId).maybeSingle();
  if (!d) throw new HttpError(404, "Proposta no trobada");
  const status = action === "aprova" ? "aprovada" : action === "anulla" ? "anullada" : action;
  const up = await u.sb.from("ai_proposal_drafts").update({ status }).eq("id", draftId).select("id,status");
  if (up.error) throw new HttpError(400, up.error.message.replace(/^.*?: /, ""));
  if (!up.data?.length) throw new HttpError(403, "No tens permís per modificar aquesta proposta");
  const sb = adminClient();
  if (status === "aprovada" && d.document_id) await finalizePdf(u, d);
  if (status === "acceptada") {
    const r = await acceptOpportunity(u, d.opportunity_id, d.comparison_id);
    if (d.comparison_id) await sb.from("comparisons").update({ crm_opportunity_id: r.crmOpportunityId }).eq("id", d.comparison_id).is("crm_opportunity_id", null);
    const o = (await u.sb.from("crm_opportunities").select("stage,version").eq("id", r.crmOpportunityId).maybeSingle()).data;
    if (o && !["guanyat", "perdut", "negociacio"].includes(o.stage)) await u.sb.from("crm_opportunities").update({ stage: "negociacio", comparison_id: d.comparison_id }).eq("id", r.crmOpportunityId).eq("version", o.version);
    await log(sb, null, "usuari", `resposta:${draftId}:acceptada`, "ai_proposal_drafts", draftId, "acceptada", { crmOpportunityId: r.crmOpportunityId });
    return { status, crmOpportunityId: r.crmOpportunityId };
  }
  if (status === "rebutjada") await u.sb.from("ai_opportunities").update({ status: "descartada", status_reason: "Proposta rebutjada pel client" }).eq("id", d.opportunity_id).not("status", "in", "(guanyada,descartada)");
  await log(sb, null, "usuari", `resposta:${draftId}:${status}`, "ai_proposal_drafts", draftId, status, { by: u.user.id });
  return { status };
}

async function finalizePdf(u: U, d: { id: string; opportunity_id: string; document_id: string; client_id: string }) {
  const sb = adminClient();
  const doc = (await sb.from("crm_documents").select("id,title,version,storage_path").eq("id", d.document_id).maybeSingle()).data;
  if (!doc) return;
  // es regenera amb les mateixes dades congelades de la recomanació (no es recalcula res)
  const draft = await prepareProposalPdfOnly(d.opportunity_id, d.id);
  if (!draft) return;
  const { randomUUID } = await import("node:crypto");
  const path = `${d.client_id}/${doc.id}/v${doc.version + 1}-${randomUUID()}.pdf`;
  const up = await sb.storage.from(DOCS_BUCKET).upload(path, draft, { contentType: "application/pdf", upsert: false });
  if (up.error) return;
  const meta = { original_name: `${(doc.title as string).replace(/ \(ESBORRANY\)$/, "").replace(/[^\p{L}\p{N}-]+/gu, "-")}.pdf`, mime: "application/pdf", size_bytes: draft.byteLength, sha256: sha(Buffer.from(draft).toString("base64")), storage_path: path };
  await sb.from("crm_document_versions").insert({ document_id: doc.id, version: doc.version + 1, ...meta, uploaded_by: u.user.id, uploaded_by_name: u.profile.name });
  await sb.from("crm_documents").update({ ...meta, version: doc.version + 1, title: (doc.title as string).replace(" (ESBORRANY)", " (aprovada)") }).eq("id", doc.id);
}

async function prepareProposalPdfOnly(oppId: string, draftId: string): Promise<Uint8Array | null> {
  const sb = adminClient();
  const d = (await sb.from("ai_proposal_drafts").select("recommendation_id,valid_until,client_id,created_by,created_at").eq("id", draftId).single()).data;
  const rec = d ? (await sb.from("ai_recommendations").select("*").eq("id", d.recommendation_id).single()).data : null;
  const o = (await sb.from("ai_opportunities").select("supply_id,owner_id").eq("id", oppId).single()).data;
  if (!d || !rec || !o) return null;
  const inputs = rec.inputs as { supply: { accessTariff: string | null; kwhTotal: number | null; kw: (number | null)[]; energyType: "luz" | "gas" }; cups: string; current: PriceSheet | null; currentSource: { label: string; date: string | null } | null; currentRetailer: string | null };
  const [client, supply, owner] = await Promise.all([
    sb.from("crm_clients").select("name").eq("id", d.client_id).single(),
    o.supply_id ? sb.from("crm_supplies").select("cups,address,access_tariff,annual_kwh,power_kw,energy_type").eq("id", o.supply_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("profiles").select("name,email").eq("id", (d.created_by ?? o.owner_id) as string).maybeSingle(),
  ]);
  const t = inputs.current;
  return buildProposalPdf({
    draft: false, reference: `PROP-${(d.created_at as string).slice(0, 10).replace(/-/g, "")}-${oppId.slice(0, 6).toUpperCase()}`, client: { name: client.data?.name ?? "Client" },
    supply: { cups: supply.data?.cups ?? inputs.cups, address: supply.data?.address ?? null, accessTariff: supply.data?.access_tariff ?? inputs.supply.accessTariff, annualKwh: supply.data?.annual_kwh ?? inputs.supply.kwhTotal, powerKw: supply.data?.power_kw ?? inputs.supply.kw, energyType: (supply.data?.energy_type ?? inputs.supply.energyType) as "luz" | "gas" },
    currentRetailer: inputs.currentRetailer,
    currentPrices: t ? { energy: t.energy.some((x) => x != null) ? t.energy : [t.energy24h], power: t.power, powerUnit: t.powerUnit, source: inputs.currentSource?.label ?? null, date: inputs.currentSource?.date ?? null } : null,
    analysis: { ok: true, reason: null, engineVersion: rec.engine_version, asOf: (rec.created_at as string).slice(0, 10), current: rec.current_cost ?? { known: false, label: PENDING_PRICE, retailer: inputs.currentRetailer, annualCost: null, quality: null, source: null, date: null }, alternatives: rec.alternatives, evaluated: rec.alternatives.length, excluded: [], sasScenarios: rec.sas_scenario ?? [], oneOff: rec.one_off_costs ?? [], hypotheses: rec.hypotheses ?? [], missing: rec.missing ?? [] },
    validUntil: d.valid_until, contact: { name: owner.data?.name ?? "Assessoria 3.0", email: owner.data?.email ?? null, phone: null }, generatedAt: new Date(),
  });
}

/** Enviament per correu d'una proposta APROVADA. Només es registra «enviada» si el servidor SMTP l'accepta. */
export async function sendDraft(u: U, draftId: string, b: { to: string; subject: string; body: string; confirmed: boolean }) {
  if (!b.confirmed) throw new HttpError(400, "Cal confirmar l'enviament");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.to)) throw new HttpError(400, "Correu de destinació no vàlid");
  const { data: d } = await u.sb.from("ai_proposal_drafts").select("*").eq("id", draftId).maybeSingle();
  if (!d) throw new HttpError(404, "Proposta no trobada");
  if (d.status !== "aprovada") throw new HttpError(400, "Només es poden enviar propostes aprovades");
  await assertCanEdit(u, d.client_id);
  const { smtpReady, sendCorporateMail } = await import("./mailer");
  if (!(await smtpReady())) throw new HttpError(400, "El correu corporatiu no està configurat (Configuració → Correu): pots descarregar el PDF i enviar-lo manualment.");
  const doc = (await u.sb.from("crm_documents").select("storage_path,original_name").eq("id", d.document_id).maybeSingle()).data;
  if (!doc) throw new HttpError(404, "No s'ha trobat el PDF de la proposta");
  const { documentBytes } = await import("./crm-docs");
  const bytes = await documentBytes(doc.storage_path);
  const sb = adminClient();
  try {
    const info = await sendCorporateMail({ to: b.to, subject: b.subject.slice(0, 300), text: b.body.slice(0, 20000), attachments: [{ filename: doc.original_name, content: Buffer.from(bytes), contentType: "application/pdf" }] }, u.profile);
    const accepted = (info.accepted?.length ?? 0) > 0;
    if (d.comparison_id) await sb.from("comparison_deliveries").insert({ comparison_id: d.comparison_id, channel: "email", recipient: b.to, subject: b.subject, status: accepted ? "enviat" : "error", message_id: info.messageId, created_by: u.user.id });
    if (!accepted) throw new HttpError(502, "El servidor de correu no ha acceptat el missatge");
    await sb.from("ai_proposal_drafts").update({ status: "enviada" }).eq("id", draftId);
    const o = (await sb.from("ai_opportunities").select("crm_opportunity_id").eq("id", d.opportunity_id).single()).data;
    await u.sb.from("crm_activities").insert({ client_id: d.client_id, opportunity_id: o?.crm_opportunity_id ?? null, type: "email", title: `Proposta enviada per correu: ${b.subject}`.slice(0, 200), delivery: "enviat", user_id: u.user.id, user_name: u.profile.name, meta: { to: b.to, draftId, messageId: info.messageId } });
    if (o?.crm_opportunity_id) {
      const c = (await u.sb.from("crm_opportunities").select("stage,version").eq("id", o.crm_opportunity_id).maybeSingle()).data;
      if (c && ["nou_lead", "contactat", "factura_sollicitada", "estudi"].includes(c.stage)) await u.sb.from("crm_opportunities").update({ stage: "proposta_enviada", proposal_sent_at: new Date().toISOString() }).eq("id", o.crm_opportunity_id).eq("version", c.version);
    }
    await log(sb, null, "usuari", `enviada:${draftId}`, "ai_proposal_drafts", draftId, "enviada", { to: b.to, messageId: info.messageId });
    return { accepted, messageId: info.messageId };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const { explainSmtpError } = await import("@/core/mail");
    throw new HttpError(502, `No s'ha enviat: ${explainSmtpError(e as Parameters<typeof explainSmtpError>[0])}`);
  }
}

export async function draftPdfUrl(u: U, draftId: string) {
  const { data: d } = await u.sb.from("ai_proposal_drafts").select("document_id").eq("id", draftId).maybeSingle();
  if (!d?.document_id) throw new HttpError(404, "Proposta no trobada");
  const doc = (await u.sb.from("crm_documents").select("storage_path").eq("id", d.document_id).maybeSingle()).data;
  if (!doc) throw new HttpError(404, "Document no trobat");
  const s = await adminClient().storage.from(DOCS_BUCKET).createSignedUrl(doc.storage_path, 120);
  if (s.error) throw new HttpError(502, "No s'ha pogut obrir el PDF");
  return { url: s.data.signedUrl };
}

/* ======================================================================= configuració (Direcció) */

const sasSchema = z.object({ min_eur_kwh: z.number().min(0.001).max(0.05), max_eur_kwh: z.number().min(0.001).max(0.05), retailers: z.array(z.string().trim().min(2).max(80)).max(10), justification: z.string().trim().max(500), source: z.string().trim().max(300), as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });
const weightsSchema = z.object({ weights: z.record(z.string(), z.number().min(0).max(100)), business_weights: z.object({ comissio: z.number().min(0).max(100), marge: z.number().min(0).max(100) }) });
const motorSchema = z.object({ renewal_days: z.array(z.number().int().min(1).max(365)).min(1).max(8), min_saving_eur: z.number().min(0), min_saving_pct: z.number().min(0).max(100), expensive_pct: z.number().min(0).max(100), inactive_days: z.number().int().min(30).max(3650), proposal_days: z.number().int().min(1).max(90), min_power_saving_eur: z.number().min(0), max_comparisons: z.number().int().min(1).max(5000), max_attempts: z.number().int().min(1).max(10) });

export async function getSettings(u: U) {
  const { data } = await u.sb.from("crm_automation_rules").select("key,name,description,enabled,params,updated_at").like("key", "ai_%").order("key");
  return { rules: data ?? [], canEdit: u.profile.role === "admin" };
}
export async function saveSetting(u: U, b: { key: string; enabled?: boolean; params?: unknown }) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot configurar la intel·ligència");
  const schema = b.key === "ai_sas_escenari" ? sasSchema : b.key === "ai_puntuacio" ? weightsSchema : b.key === "ai_motor" ? motorSchema : b.key === "ai_esborranys_auto" ? z.object({ min_score: z.number().int().min(0).max(100), max_per_run: z.number().int().min(1).max(100) }) : b.key === "ai_retencio" ? z.object({ conversation_days: z.number().int().min(1).max(3650), tool_days: z.number().int().min(30).max(3650) }) : null;
  if (!schema) throw new HttpError(400, "Regla desconeguda");
  const cur = (await u.sb.from("crm_automation_rules").select("enabled,params").eq("key", b.key).single()).data;
  if (!cur) throw new HttpError(404, "Regla no trobada");
  const params = b.params !== undefined ? schema.parse(b.params) : cur.params;
  const enabled = b.enabled ?? cur.enabled;
  if (b.key === "ai_sas_escenari" && enabled) {
    const p = params as z.infer<typeof sasSchema>;
    if (!p.source || !p.as_of || !p.justification || !p.retailers.length) throw new HttpError(400, "Per activar l'escenari SAS cal indicar comercialitzadores, justificació, font i data dels valors.");
  }
  const { error } = await u.sb.from("crm_automation_rules").update({ enabled, params, updated_by: u.user.id, updated_at: new Date().toISOString() }).eq("key", b.key);
  if (error) throw new HttpError(403, "No s'ha pogut desar la configuració");
  await log(adminClient(), null, "configuracio", `config:${b.key}:${Date.now()}`, "crm_automation_rules", null, "configuracio", { key: b.key, enabled, by: u.user.id });
  return { ok: true };
}

export async function clientContactPrefs(u: U, clientId: string, b: { optOut: boolean; preference: string }) {
  const pref = z.enum(["qualsevol", "telefon", "email", "whatsapp", "presencial", "cap"]).parse(b.preference);
  const { data, error } = await u.sb.from("crm_clients").update({ commercial_opt_out: b.optOut, opt_out_at: b.optOut ? new Date().toISOString() : null, contact_preference: pref }).eq("id", clientId).select("id");
  if (error || !data?.length) throw new HttpError(403, "No tens permís per modificar aquest client");
  // oposició: les oportunitats comercials obertes del client es marquen com a no contactables
  if (b.optOut || pref === "cap") await adminClient().from("ai_opportunities").update({ contact_allowed: false }).eq("client_id", clientId);
  return { ok: true };
}
