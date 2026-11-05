import "server-only";
/**
 * FASE 8.2 · RECLAMACIONS A COMERCIALITZADORES (servidor).
 * - Accés: Direcció i l'administració autoritzada (permís «economia», finStaff) i la persona interna assignada a una
 *   reclamació concreta. Mai comercials, caps d'equip ni col·laboradors. Ho torna a comprovar la RLS (migració 018).
 * - El servidor recalcula SEMPRE les diferències abans de crear una reclamació: només hi entra el que és reclamable
 *   (regla aprovada, termini vençut, sense excepcions) i que no és ja en una reclamació activa.
 * - Res no s'envia sense la confirmació explícita de l'usuari (`confirm: true`) i amb el seu propi compte de correu.
 * - La IA només proposa hipòtesis i només si Direcció ha registrat les garanties de confidencialitat.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AWAITING, CLAIM_STATUSES, CLAIM_STATUS_LABEL, ITEM_KIND_LABEL, ITEM_KIND_LABEL_ES, buildClaimEmail, canTransition, claimKpis, detectDiscrepancies, explainDiscrepancy, matchRegularizations,
  type ActiveRef, type ClaimStatus, type ContractIn, type DiscRow, type ItemKind, type Lang, type LineIn, type OpenItem, type RetailerTerms, type RuleLite,
} from "@/core/claims";
import { buildClaimPdf } from "@/core/claim-pdf";
import { D, money } from "@/core/commissions";
import { matchesRetailer, norm, type ClawRule } from "@/core/retailers";
import { sniffDoc } from "@/core/crm";
import { env } from "./env";
import { adminClient, HttpError } from "./supabase";
import { isStaffRole, parse, type U } from "./crm";
import { finStaff, hasPerm, secLog } from "./permissions";
import { notify } from "./sales";

type PgError = { code?: string; message?: string } | null;
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.string().regex(/^\d+(\.\d{1,2})?$/, "Import no vàlid");
const today = () => new Date().toISOString().slice(0, 10);
const BUCKET = "fin-claims";
const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

function fail(e: PgError, fallback = "No s'ha pogut desar"): never {
  const m = e?.message ?? "";
  if (e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "42883" || /does not exist|schema cache|Could not find/i.test(m)) throw new HttpError(503, "Falta aplicar la migració supabase/migrations/018_reclamacions.sql a Supabase");
  if (e?.code === "23505") throw new HttpError(409, /fin_claim_items_active_uq|item_key/.test(m) ? "Alguna de les diferències ja forma part d'una altra reclamació activa" : "Aquest registre ja existeix (s'ha evitat un duplicat)");
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) throw new HttpError(403, /^(Reclamació|Només|Registre|Una )/.test(m) ? m : "No tens permís per fer aquesta acció");
  if (e?.code === "23514" || e?.code === "P0001") throw new HttpError(400, /violates check constraint/i.test(m) ? "Hi ha dades amb un format no vàlid" : m);
  console.error("[reclamacions]", e?.code, m.slice(0, 200));
  throw new HttpError(500, fallback);
}

/* ======================================================================= accés */

/** Direcció o administració amb permís «economia». */
async function staff(u: U, action: "read" | "edit" = "read") {
  if (!(await finStaff(u, action))) throw new HttpError(403, action === "edit" ? "No tens autorització per gestionar reclamacions econòmiques (la concedeix Direcció)" : "Les reclamacions a comercialitzadores són dades econòmiques restringides: cal autorització de Direcció");
}
/** Staff econòmic, o la persona interna a qui s'ha assignat aquesta reclamació. */
async function claimAccess(u: U, id: string, action: "read" | "edit" = "read") {
  if (!uuid.safeParse(id).success) throw new HttpError(404, "Reclamació no trobada");
  if (await finStaff(u, action)) return "staff" as const;
  if (isStaffRole(u.profile.role)) {
    const c = await u.sb.from("fin_claims").select("assigned_to").eq("id", id).maybeSingle();
    if (c.error) fail(c.error);
    if (c.data?.assigned_to === u.user.id) return "assignee" as const;
  }
  throw new HttpError(403, "No tens accés a aquesta reclamació");
}
const event = async (u: U, claimId: string, e: Record<string, unknown>) => {
  const r = await u.sb.from("fin_claim_events").insert({ claim_id: claimId, user_id: u.user.id, user_name: u.profile.name, ...e });
  if (r.error) fail(r.error, "No s'ha pogut registrar a l'historial");
};

/* ======================================================================= dades d'una comercialitzadora i període */

export interface Loaded {
  retailer: string; retailerRow: { id: string; trade_name: string; aliases: string[]; legal_name: string | null } | null;
  lines: (LineIn & { statement_received: string })[];
  /** Fase 14: totes les línies de la comercialitzadora (de qualsevol període), per a l'historial de cada comissió. */
  allLines: (LineIn & { statement_received: string })[]; contracts: ContractIn[]; rules: Map<string, RuleLite>; otherRules: RuleLite[];
  terms: RetailerTerms; clawRules: ClawRule[]; claimed: Map<string, ActiveRef>; settled: Set<string>;
}
const periodOf = (s: { period_to: string | null; received_at: string }) => (s.period_to ?? s.received_at).slice(0, 10);

export async function load(u: U, retailer: string, from: string, to: string): Promise<Loaded> {
  const sb = u.sb;
  const rr = await sb.from("retailers").select("id,trade_name,aliases,legal_name");
  const retailers = rr.error ? [] : ((rr.data ?? []) as { id: string; trade_name: string; aliases: string[] | null; legal_name: string | null }[]);
  const retailerRow = retailers.find((r) => matchesRetailer(retailer, { trade_name: r.trade_name, aliases: r.aliases ?? [] })) ?? null;
  const same = (name: string | null | undefined) => norm(name ?? "") === norm(retailer) || (!!retailerRow && matchesRetailer(name, { trade_name: retailerRow.trade_name, aliases: retailerRow.aliases ?? [] }));

  const st = await sb.from("fin_provider_statements").select("id,retailer,reference,received_at,period_from,period_to").order("received_at", { ascending: false }).limit(2000);
  if (st.error) fail(st.error, "No s'han pogut carregar les liquidacions");
  const mine = ((st.data ?? []) as { id: string; retailer: string; reference: string; received_at: string; period_from: string | null; period_to: string | null }[]).filter((s) => same(s.retailer));
  const inPeriod = mine.filter((s) => periodOf(s) >= from && periodOf(s) <= to);
  const allIds = mine.map((s) => s.id);
  const lines: Loaded["lines"] = [];
  const allLines: Loaded["allLines"] = [];
  const settled = new Set<string>();
  for (let i = 0; i < allIds.length; i += 200) {
    const r = await sb.from("fin_statement_lines").select("id,statement_id,line_no,cups,external_ref,contract_ref,client_name,concept,amount,kind,match_status,contract_id,expected_amount,line_hash").in("statement_id", allIds.slice(i, i + 200)).limit(20000);
    if (r.error) fail(r.error, "No s'han pogut carregar les línies de liquidació");
    for (const l of (r.data ?? []) as Omit<LineIn, "reference" | "received_at" | "period_from" | "period_to">[]) {
      if (l.contract_id && l.kind === "comissio" && !["duplicat", "descartat"].includes(l.match_status)) settled.add(l.contract_id);
      const s = inPeriod.find((x) => x.id === l.statement_id);
      if (s) lines.push({ ...l, reference: s.reference, received_at: s.received_at, period_from: s.period_from, period_to: s.period_to, statement_received: s.received_at });
      const a = mine.find((x) => x.id === l.statement_id);
      if (a) allLines.push({ ...l, reference: a.reference, received_at: a.received_at, period_from: a.period_from, period_to: a.period_to, statement_received: a.received_at });
    }
  }

  // contractes d'aquesta comercialitzadora (pel nom o pels àlies) amb el càlcul vigent de la capa proveïdor
  const ks = await sb.from("crm_contracts").select("id,client_id,supply_id,retailer,product,status,start_date,signed_at,access_tariff,expedient_id").neq("status", "esborrany").limit(20000);
  if (ks.error) fail(ks.error, "No s'han pogut carregar els contractes");
  const lineContracts = new Set(allLines.map((l) => l.contract_id).filter(Boolean) as string[]);
  const K = ((ks.data ?? []) as { id: string; client_id: string; supply_id: string | null; retailer: string; product: string | null; status: string; start_date: string | null; signed_at: string | null; access_tariff: string | null; expedient_id: string | null }[])
    .filter((k) => same(k.retailer) || lineContracts.has(k.id));
  const ids = K.map((k) => k.id);
  const chunk = async <T,>(table: string, cols: string, col: string, vals: string[], eq: [string, unknown][] = []) => {
    const out: T[] = [];
    for (let i = 0; i < vals.length; i += 300) {
      let q = sb.from(table).select(cols).in(col, vals.slice(i, i + 300));
      for (const [k, v] of eq) q = q.eq(k, v as never);
      const r = await q;
      if (r.error) { if (/does not exist|schema cache/i.test(r.error.message ?? "")) return out; fail(r.error); }
      out.push(...((r.data ?? []) as T[]));
    }
    return out;
  };
  const [clients, supplies, econ, calcs, exps] = await Promise.all([
    chunk<{ id: string; name: string }>("crm_clients", "id,name", "id", [...new Set(K.map((k) => k.client_id))]),
    chunk<{ id: string; cups: string; annual_kwh: number | null; access_tariff: string | null; province: string | null }>("crm_supplies", "id,cups,annual_kwh,access_tariff,province", "id", K.map((k) => k.supply_id).filter(Boolean) as string[]),
    chunk<{ contract_id: string; econ_status: string; cancelled_at: string | null; eligible_mwh: string | null }>("fin_contract_economics", "contract_id,econ_status,cancelled_at,eligible_mwh", "contract_id", ids),
    chunk<{ contract_id: string; amount: string | null; status: string; rule_id: string | null; rule_key: string | null; rule_version: number | null }>("fin_calculations", "contract_id,amount,status,rule_id,rule_key,rule_version", "contract_id", ids, [["layer", "proveidor"], ["is_current", true]]),
    chunk<{ contract_id: string | null; activated_at: string | null }>("crm_expedients", "contract_id,activated_at", "contract_id", ids),
  ]);
  const cur = new Map(calcs.map((c) => [c.contract_id, c]));
  const contracts: ContractIn[] = K.map((k) => {
    const s = supplies.find((x) => x.id === k.supply_id);
    const e = econ.find((x) => x.contract_id === k.id);
    const x = exps.find((y) => y.contract_id === k.id && y.activated_at);
    const c = cur.get(k.id) ?? null;
    return {
      id: k.id, client_id: k.client_id, client_name: clients.find((cl) => cl.id === k.client_id)?.name ?? null, retailer: k.retailer, product: k.product, status: k.status,
      cups: s?.cups ?? null, activated_at: x?.activated_at ?? k.start_date ?? null, econ_status: e?.econ_status ?? "actiu", cancelled_at: e?.cancelled_at ?? null,
      tariff: k.access_tariff ?? s?.access_tariff ?? null, eligible_mwh: e?.eligible_mwh ?? null, annual_kwh: s?.annual_kwh ?? null, province: s?.province ?? null,
      calc: c ? { amount: c.amount, status: c.status, rule_id: c.rule_id, rule_key: c.rule_key, rule_version: c.rule_version } : null,
    };
  });

  // regles (les aplicades als càlculs + les altres aprovades de la capa proveïdor d'aquesta comercialitzadora)
  const rs = await sb.from("fin_rules").select("id,rule_key,version,name,status,kind,value,unit,product,retailer,tiers,conditions,valid_from,valid_to,layer").eq("layer", "proveidor").limit(5000);
  if (rs.error) fail(rs.error);
  const allRules = (rs.data ?? []) as RuleLite[];
  const rules = new Map(allRules.map((r) => [r.id, r]));
  const otherRules = allRules.filter((r) => r.status === "aprovada" && same(r.retailer));

  // condicions de pagament i retrocessions aprovades (només números i regles; mai el contracte)
  let terms: RetailerTerms = { paymentDays: null, claimDays: null };
  let clawRules: ClawRule[] = [];
  if (retailerRow) {
    const admin = adminClient();
    const [t, c] = await Promise.all([
      admin.from("retailer_terms").select("field,value,unit,page,excerpt,valid_from,valid_to,retailer_documents(title,version)").eq("retailer_id", retailerRow.id).eq("review_status", "aprovada").in("field", ["termini_pagament", "termini_reclamacio"]),
      admin.from("retailer_clawback_rules").select("*").eq("retailer_id", retailerRow.id).eq("status", "aprovada"),
    ]);
    const T = (t.data ?? []) as { field: string; value: string | number | null; page: number | null; excerpt: string; valid_from: string | null; valid_to: string | null; retailer_documents: { title: string; version: number } | { title: string; version: number }[] | null }[];
    const pick = (f: string) => T.filter((x) => x.field === f && x.value != null && (!x.valid_to || x.valid_to >= from)).sort((a, b) => String(b.valid_from ?? "").localeCompare(String(a.valid_from ?? "")))[0];
    const p = pick("termini_pagament"), r = pick("termini_reclamacio");
    const ref = (x: typeof p) => x ? { label: `${one(x.retailer_documents)?.title ?? "Contracte"}${x.page ? `, pàg. ${x.page}` : ""}`, document: one(x.retailer_documents)?.title ?? null, page: x.page, excerpt: x.excerpt } : null;
    terms = { paymentDays: p ? Number(p.value) : null, claimDays: r ? Number(r.value) : null, paymentRef: ref(p), claimRef: ref(r) };
    clawRules = (c.data ?? []) as ClawRule[];
  }

  // diferències ja reclamades
  const cl = await sb.from("fin_claims").select("id,code,status,retailer").limit(5000);
  if (cl.error) fail(cl.error);
  const myClaims = ((cl.data ?? []) as { id: string; code: string; status: ClaimStatus; retailer: string }[]).filter((c) => same(c.retailer));
  const claimed = new Map<string, ActiveRef>();
  if (myClaims.length) {
    const it = await chunk<{ claim_id: string; item_key: string; status: string; active: boolean }>("fin_claim_items", "claim_id,item_key,status,active", "claim_id", myClaims.map((c) => c.id));
    for (const i of it) {
      if (["retirada", "traspassada"].includes(i.status)) continue;
      const c = myClaims.find((x) => x.id === i.claim_id)!;
      const prev = claimed.get(i.item_key);
      if (!prev || i.active) claimed.set(i.item_key, { claim_id: c.id, code: c.code, status: c.status, item_status: i.status });
    }
  }
  return { retailer: retailerRow?.trade_name ?? retailer, retailerRow: retailerRow ? { ...retailerRow, aliases: retailerRow.aliases ?? [] } : null, lines, allLines, contracts, rules, otherRules, terms, clawRules, claimed, settled };
}

const detect = (d: Loaded, from: string, to: string, minEur?: string) =>
  detectDiscrepancies({ retailer: d.retailer, from, to, today: today(), lines: d.lines, settledContracts: d.settled, contracts: d.contracts, rules: d.rules, terms: d.terms, clawRules: d.clawRules, claimed: d.claimed, minEur });

/* ======================================================================= panell i discrepàncies */

const overviewQ = z.object({ retailer: z.string().trim().max(120).optional().default(""), from: day.optional(), to: day.optional(), min: amount.optional() });
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10); };
const monthEnd = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10); };

export async function claimsOverview(u: U, raw: Record<string, string>) {
  const isStaff = await finStaff(u);
  if (!isStaff) {
    // persona assignada: només veu les seves reclamacions
    if (!isStaffRole(u.profile.role)) throw new HttpError(403, "Les reclamacions a comercialitzadores són dades econòmiques restringides");
    const mine = await u.sb.from("fin_claims").select("*").eq("assigned_to", u.user.id).order("created_at", { ascending: false });
    if (mine.error) fail(mine.error);
    return { scope: "assignee" as const, retailers: [], rows: [], kpis: null, claims: mine.data ?? [], terms: null, from: null, to: null, retailer: null, people: [], canEdit: false };
  }
  const q = parse(overviewQ, raw);
  const from = q.from ?? monthStart(), to = q.to ?? monthEnd();
  if (to < from) throw new HttpError(400, "El període no és vàlid");
  const st = await u.sb.from("fin_provider_statements").select("retailer,received_at,period_to").limit(5000);
  if (st.error) fail(st.error, "No s'han pogut carregar les liquidacions");
  const S = (st.data ?? []) as { retailer: string; received_at: string; period_to: string | null }[];
  const names = [...new Map(S.map((s) => [norm(s.retailer), s.retailer])).values()].sort((a, b) => a.localeCompare(b, "ca"));
  const targets = q.retailer ? [q.retailer] : [...new Set(S.filter((s) => periodOf(s) >= from && periodOf(s) <= to).map((s) => s.retailer))];
  const rows: DiscRow[] = [];
  let terms: RetailerTerms | null = null;
  for (const r of targets.slice(0, 30)) {
    const d = await load(u, r, from, to);
    rows.push(...detect(d, from, to, q.min));
    if (q.retailer) terms = d.terms;
  }
  const cl = await u.sb.from("fin_claims").select("*").order("created_at", { ascending: false }).limit(1000);
  if (cl.error) fail(cl.error);
  const claims = (cl.data ?? []) as (Record<string, unknown> & { status: ClaimStatus; retailer: string; total_claimed: string; total_recognized: string; total_recovered: string; items_count: number })[];
  const scoped = q.retailer ? claims.filter((c) => norm(c.retailer) === norm(q.retailer)) : claims;
  const people = ((await u.sb.from("profiles").select("id,name,role").in("role", ["admin", "cap_administrativa", "administrativa"])).data ?? []) as { id: string; name: string; role: string }[];
  return { scope: "staff" as const, retailers: names, from, to, retailer: q.retailer || null, rows, kpis: claimKpis(rows, scoped), claims: scoped, terms, people, canEdit: await finStaff(u, "edit") };
}

/** Hipòtesis sobre el motiu d'una diferència (locals; amb IA només si Direcció ha registrat les garanties). */
export async function explainRow(u: U, raw: unknown) {
  await staff(u);
  const b = parse(z.object({ retailer: z.string().trim().min(1).max(120), from: day, to: day, key: z.string().min(3).max(200), ai: z.boolean().default(false) }), raw);
  const d = await load(u, b.retailer, b.from, b.to);
  const row = detect(d, b.from, b.to).find((r) => r.key === b.key);
  if (!row) throw new HttpError(404, "Aquesta diferència ja no existeix (potser s'ha conciliat). Torna a carregar.");
  const k = row.contractId ? d.contracts.find((c) => c.id === row.contractId) ?? null : null;
  const l = row.lineId ? d.lines.find((x) => x.id === row.lineId) ?? null : null;
  const local = explainDiscrepancy({ row, rule: row.ruleId ? d.rules.get(row.ruleId) ?? null : null, otherRules: d.otherRules, contract: k, line: l ? { concept: l.concept, received_at: l.received_at, period_from: l.period_from, period_to: l.period_to, kind: l.kind } : null, clawRules: d.clawRules });
  const { aiPolicy } = await import("./retailers");
  const policy = await aiPolicy();
  const aiAvailable = policy.enabled && !!env.anthropicKey;
  const aiReason = aiAvailable ? null : !env.anthropicKey ? "No hi ha cap proveïdor d'IA configurat al servidor." : "Direcció encara no ha registrat les garanties de confidencialitat per enviar dades contractuals a la IA.";
  let ai: { text: string; model: string } | null = null;
  if (b.ai) {
    if (!aiAvailable) throw new HttpError(409, aiReason!);
    // Només dades estructurades i els fragments de les regles APROVADES (cap document sencer, cap dada personal del client)
    const ctx = {
      diferencia: { tipus: row.kind, prevista: row.expected, liquidada: row.settled, diferencia: row.difference, descripcio: row.reason },
      regla: row.ruleRef, contracte: k && { producte: k.product, peatge: k.tariff, activacio: k.activated_at, estat_economic: k.econ_status, mwh_elegibles: k.eligible_mwh, consum_anual_kwh: k.annual_kwh, provincia: k.province },
      linia: l && { concepte: l.concept, liquidacio: l.reference, periode: [l.period_from, l.period_to] },
      altres_regles: d.otherRules.slice(0, 15).map((r) => ({ nom: r.name, tipus: r.kind, valor: r.value, unitat: r.unit, producte: r.product, condicions: r.conditions })),
      hipotesis_locals: local.hypotheses.map((h) => ({ motiu: h.label, detall: h.detail, confianca: h.confidence })),
    };
    const prompt = `Ets l'analista de comissions d'Assessoria 3.0. Explica en català, breument (màx. 8 línies), per què pot existir aquesta diferència entre el que ha liquidat la comercialitzadora i el que preveu la regla aprovada.
Regles estrictes: fes servir NOMÉS el JSON; presenta-ho SEMPRE com a hipòtesi («podria ser», «cal verificar»), mai com un fet; cita la regla o el fragment contractual que ho suporta; si no hi ha prou dades, respon exactament «Motiu pendent de revisió» i què caldria comprovar. Motius possibles: comissió geogràfica, tarifa aplicada incorrectament, MWh comissionables diferents, campanya no aplicada, incentiu pendent, activació fora del període, retrocessió contractual, duplicació o regularització, condicions de meritació no complertes.
JSON:
${JSON.stringify(ctx)}`;
    const { complete } = await import("./ai");
    await secLog(u, "reclamacio_ia", "fin_statement_lines", row.lineId ?? row.contractId, { provider: policy.provider, model: env.anthropicModel, dpa: policy.dpa_reference });
    ai = { text: await complete(prompt, 500), model: env.anthropicModel };
  }
  return { row, local, ai, aiAvailable, aiReason };
}

/* ======================================================================= creació */

const createQ = z.object({
  retailer: z.string().trim().min(1).max(120), from: day, to: day, keys: z.array(z.string().min(3).max(200)).min(1, "Selecciona almenys una diferència").max(2000),
  parentId: uuid.nullable().optional(), assignedTo: uuid.nullable().optional(), lang: z.enum(["ca", "es"]).default("es"), responseDays: z.number().int().min(5).max(120).default(30),
});
async function assertAssignable(u: U, userId: string | null | undefined) {
  if (!userId) return null;
  const p = await u.sb.from("profiles").select("id,name,role").eq("id", userId).maybeSingle();
  if (!p.data || !["admin", "cap_administrativa", "administrativa"].includes(p.data.role as string)) throw new HttpError(400, "Només es pot assignar a Direcció o a l'equip d'administració");
  return p.data as { id: string; name: string; role: string };
}
async function defaultContact(u: U, retailerId: string | null) {
  if (!retailerId) return null;
  const r = await u.sb.from("retailer_contacts").select("id,name,email,role,is_default").eq("retailer_id", retailerId).eq("role", "liquidacions");
  const xs = (r.data ?? []) as { id: string; name: string; email: string | null; is_default: boolean }[];
  return xs.find((x) => x.is_default) ?? xs[0] ?? null;
}
const groupReasons = (items: { kind: ItemKind; claimed_amount: string }[], lang: Lang) => {
  const m = new Map<ItemKind, { count: number; amount: ReturnType<typeof D> }>();
  for (const i of items) { const c = m.get(i.kind) ?? { count: 0, amount: D(0) }; m.set(i.kind, { count: c.count + 1, amount: c.amount.plus(i.claimed_amount) }); }
  return [...m.entries()].map(([k, v]) => ({ label: (lang === "es" ? ITEM_KIND_LABEL_ES : ITEM_KIND_LABEL)[k], count: v.count, amount: money(v.amount) }));
};

export async function createClaim(u: U, raw: unknown) {
  await staff(u, "edit");
  const b = parse(createQ, raw);
  if (b.to < b.from) throw new HttpError(400, "El període no és vàlid");
  const assignee = await assertAssignable(u, b.assignedTo);
  const d = await load(u, b.retailer, b.from, b.to);
  const rows = detect(d, b.from, b.to);
  type Parent = { id: string; code: string; status: ClaimStatus; retailer: string };
  let parent: Parent | null = null;
  if (b.parentId) {
    const p = await u.sb.from("fin_claims").select("id,code,status,retailer").eq("id", b.parentId).maybeSingle();
    if (!p.data) throw new HttpError(404, "Reclamació anterior no trobada");
    parent = p.data as Parent;
    if (norm(parent.retailer) !== norm(d.retailer) && norm(parent!.retailer) !== norm(b.retailer)) throw new HttpError(400, "Una ampliació ha de ser de la mateixa comercialitzadora");
  }
  const wanted = new Set(b.keys);
  const chosen = rows.filter((r) => wanted.has(r.key));
  const missing = b.keys.filter((k) => !chosen.some((r) => r.key === k));
  if (missing.length) throw new HttpError(409, `${missing.length} diferència(es) ja no existeixen o han canviat. Torna a carregar la llista.`);
  const bad = chosen.filter((r) => r.eligibility !== "reclamable" || D(r.claimable).lte(0));
  if (bad.length) throw new HttpError(400, `No es poden reclamar ${bad.length} diferència(es) que no són reclamables (${bad.slice(0, 3).map((r) => r.reason).join(" · ")}).`);
  const dup = chosen.filter((r) => r.status !== "pendent" && !(parent && r.claim?.claim_id === parent.id));
  if (dup.length) throw new HttpError(409, `${dup.length} diferència(es) ja formen part d'una reclamació (${[...new Set(dup.map((r) => r.claim?.code))].join(", ")}). Per tornar-les a reclamar, crea una ampliació o un seguiment d'aquella reclamació.`);

  const contact = await defaultContact(u, d.retailerRow?.id ?? null);
  const ins = await u.sb.from("fin_claims").insert({ retailer: d.retailer, retailer_id: d.retailerRow?.id ?? null, period_from: b.from, period_to: b.to, parent_id: parent?.id ?? null, assigned_to: assignee?.id ?? null, contact_id: contact?.id ?? null, contact_name: contact?.name ?? null, contact_email: contact?.email ?? null, created_by: u.user.id }).select("id,code").single();
  if (ins.error) fail(ins.error);
  const claimId = ins.data.id as string, code = ins.data.code as string;
  try {
    // ampliació o seguiment: la diferència es traspassa des de la reclamació anterior
    const moved = chosen.filter((r) => parent && r.claim?.claim_id === parent.id).map((r) => r.key);
    if (moved.length) {
      const m = await u.sb.from("fin_claim_items").update({ status: "traspassada" }).eq("claim_id", parent!.id).in("item_key", moved);
      if (m.error) fail(m.error);
    }
    const items = chosen.map((r) => {
      const k = r.contractId ? d.contracts.find((c) => c.id === r.contractId) ?? null : null;
      const l = r.lineId ? d.lines.find((x) => x.id === r.lineId) ?? null : null;
      const ex = explainDiscrepancy({ row: r, rule: r.ruleId ? d.rules.get(r.ruleId) ?? null : null, otherRules: d.otherRules, contract: k, line: l && { concept: l.concept, received_at: l.received_at, period_from: l.period_from, period_to: l.period_to, kind: l.kind }, clawRules: d.clawRules });
      return {
        claim_id: claimId, item_key: r.key, kind: r.itemKind!, statement_line_id: r.lineId, contract_id: r.contractId, client_id: r.clientId, cups: r.cups, external_ref: r.reference, contract_ref: r.contractRef, client_name: r.client,
        expected_amount: r.expected ?? "0.00", settled_amount: r.settled, claimed_amount: r.claimable, reason_code: ex.top.code, reason_text: r.reason,
        reason_source: ex.needsReview ? "pendent_revisio" : "regla", rule_id: r.ruleId && uuid.safeParse(r.ruleId).success ? r.ruleId : null, rule_ref: r.ruleRef || r.facts ? { ...(r.ruleRef ?? { label: "" }), facts: r.facts ?? null } : null,
      };
    });
    for (let i = 0; i < items.length; i += 300) { const r = await u.sb.from("fin_claim_items").insert(items.slice(i, i + 300)); if (r.error) fail(r.error); }
    const total = money(items.reduce((s, i) => s.plus(i.claimed_amount), D(0)));
    const mail = buildClaimEmail({ lang: b.lang, code, retailer: d.retailer, contactName: contact?.name ?? null, periodFrom: b.from, periodTo: b.to, total, count: items.length, byReason: groupReasons(items, b.lang), senderName: u.profile.name, senderEmail: u.profile.email ?? null, responseDays: b.responseDays });
    const up = await u.sb.from("fin_claims").update({ email_subject: mail.subject, email_body: mail.body, notes: `lang:${b.lang}` }).eq("id", claimId);
    if (up.error) fail(up.error);
  } catch (e) {
    await u.sb.from("fin_claims").delete().eq("id", claimId);   // esborrany a mig crear: es desfà
    if (b.parentId) await u.sb.from("fin_claim_items").update({ status: "reclamada" }).eq("claim_id", b.parentId).eq("status", "traspassada");
    throw e;
  }
  if (parent) await event(u, parent.id, { kind: "nota", body: `Seguiment / ampliació creada: ${code}`, ref_id: claimId });
  if (assignee && assignee.id !== u.user.id) await notify(assignee.id, { kind: "economia", title: `T'han assignat la reclamació ${code}`, body: `${d.retailer} · ${chosen.length} contracte(s)`, link: { view: "reclamacions", params: { id: claimId } }, ruleKey: `rec_assign:${claimId}:${assignee.id}` });
  return { id: claimId, code, items: chosen.length };
}

/** Seguiment: nova reclamació amb les diferències encara no recuperades d'una reclamació anterior. */
export async function followUp(u: U, parentId: string) {
  await staff(u, "edit");
  const p = await u.sb.from("fin_claims").select("*").eq("id", uuid.parse(parentId)).maybeSingle();
  if (!p.data) throw new HttpError(404, "Reclamació no trobada");
  const parent = p.data as { id: string; code: string; status: ClaimStatus; retailer: string; retailer_id: string | null; period_from: string; period_to: string; assigned_to: string | null; contact_id: string | null; contact_name: string | null; contact_email: string | null; notes: string | null };
  if (["esborrany", "pendent_enviament"].includes(parent.status)) throw new HttpError(400, "Primer envia la reclamació; per afegir-hi diferències, edita l'esborrany");
  const it = await u.sb.from("fin_claim_items").select("*").eq("claim_id", parent.id).in("status", ["reclamada", "parcial", "rebutjada"]);
  if (it.error) fail(it.error);
  type Item = { id: string; item_key: string; kind: ItemKind; statement_line_id: string | null; contract_id: string | null; client_id: string | null; cups: string | null; external_ref: string | null; contract_ref: string | null; client_name: string | null; expected_amount: string; settled_amount: string; claimed_amount: string; recovered_amount: string; recognized_amount: string; reason_code: string; reason_text: string; reason_source: string; rule_id: string | null; rule_ref: unknown };
  const pending = ((it.data ?? []) as Item[])
    .map((i) => ({ ...i, rest: D(i.claimed_amount).minus(i.recovered_amount) })).filter((i) => i.rest.gt(0));
  if (!pending.length) throw new HttpError(400, "No queda cap import pendent de recuperar en aquesta reclamació");
  const lang = (parent.notes ?? "").includes("lang:ca") ? "ca" : "es";
  const ins = await u.sb.from("fin_claims").insert({ retailer: parent.retailer, retailer_id: parent.retailer_id, period_from: parent.period_from, period_to: parent.period_to, parent_id: parent.id, assigned_to: parent.assigned_to, contact_id: parent.contact_id, contact_name: parent.contact_name, contact_email: parent.contact_email, created_by: u.user.id, notes: `lang:${lang}` }).select("id,code").single();
  if (ins.error) fail(ins.error);
  const id = ins.data.id as string, code = ins.data.code as string;
  const mv = await u.sb.from("fin_claim_items").update({ status: "traspassada" }).in("id", pending.map((i) => i.id));
  if (mv.error) { await u.sb.from("fin_claims").delete().eq("id", id); fail(mv.error); }
  const rows = pending.map((i) => ({
    claim_id: id, item_key: i.item_key, kind: i.kind as ItemKind, statement_line_id: i.statement_line_id ?? null, contract_id: i.contract_id ?? null, client_id: i.client_id ?? null,
    cups: i.cups ?? null, external_ref: i.external_ref ?? null, contract_ref: i.contract_ref ?? null, client_name: i.client_name ?? null, expected_amount: i.expected_amount, settled_amount: i.settled_amount,
    claimed_amount: money(i.rest), reason_code: i.reason_code, reason_text: `${String(i.reason_text)} · Seguiment de ${parent.code}`, reason_source: i.reason_source, rule_id: i.rule_id ?? null, rule_ref: i.rule_ref ?? null,
  }));
  const r = await u.sb.from("fin_claim_items").insert(rows);
  if (r.error) { await u.sb.from("fin_claim_items").update({ status: "reclamada" }).in("id", pending.map((i) => i.id)); await u.sb.from("fin_claims").delete().eq("id", id); fail(r.error); }
  const total = money(rows.reduce((s, i) => s.plus(i.claimed_amount), D(0)));
  const mail = buildClaimEmail({ lang, code, retailer: parent.retailer, contactName: parent.contact_name, periodFrom: parent.period_from, periodTo: parent.period_to, total, count: rows.length, byReason: groupReasons(rows as { kind: ItemKind; claimed_amount: string }[], lang), senderName: u.profile.name, senderEmail: u.profile.email ?? null, responseDays: 30 });
  await u.sb.from("fin_claims").update({ email_subject: `${mail.subject} (${lang === "es" ? "seguimiento de" : "seguiment de"} ${parent.code})`, email_body: mail.body }).eq("id", id);
  await event(u, parent.id, { kind: "nota", body: `Seguiment creat: ${code}`, ref_id: id });
  return { id, code, items: rows.length };
}

/* ======================================================================= expedient */

export async function getClaim(u: U, id: string) {
  const role = await claimAccess(u, id);
  const c = await u.sb.from("fin_claims").select("*").eq("id", id).maybeSingle();
  if (c.error) fail(c.error);
  if (!c.data) throw new HttpError(404, "Reclamació no trobada");
  const [items, events, reminders, recoveries, links, contacts, people, children] = await Promise.all([
    u.sb.from("fin_claim_items").select("*").eq("claim_id", id).order("created_at"),
    u.sb.from("fin_claim_events").select("*").eq("claim_id", id).order("at", { ascending: false }),
    u.sb.from("fin_claim_reminders").select("*").eq("claim_id", id).order("remind_at"),
    u.sb.from("fin_claim_recoveries").select("*").eq("claim_id", id).order("received_at"),
    u.sb.from("fin_claim_links").select("*, fin_statement_lines(amount,concept,cups,fin_provider_statements(reference,received_at))").eq("claim_id", id).order("created_at", { ascending: false }),
    c.data.retailer_id ? u.sb.from("retailer_contacts").select("*").eq("retailer_id", c.data.retailer_id).order("name") : Promise.resolve({ data: [], error: null }),
    u.sb.from("profiles").select("id,name,role").in("role", ["admin", "cap_administrativa", "administrativa"]),
    u.sb.from("fin_claims").select("id,code,status").eq("parent_id", id),
  ]);
  for (const r of [items, events, reminders, recoveries]) if (r.error) fail(r.error);
  const parent = c.data.parent_id ? (await u.sb.from("fin_claims").select("id,code,status").eq("id", c.data.parent_id).maybeSingle()).data : null;
  const lang: Lang = String(c.data.notes ?? "").includes("lang:ca") ? "ca" : "es";
  return {
    claim: { ...c.data, lang }, items: items.data ?? [], events: (events.data ?? []).map((e) => ({ ...e, attachment_path: e.attachment_path ? true : null })),
    reminders: reminders.data ?? [], recoveries: recoveries.data ?? [], links: links.data ?? [], contacts: contacts.data ?? [], people: people.data ?? [], parent, children: children.data ?? [],
    permissions: { role, canEdit: role === "staff" ? await finStaff(u, "edit") : true, canManage: role === "staff" && (await finStaff(u, "edit")), transitions: CLAIM_STATUSES.filter((s) => canTransition(c.data.status as ClaimStatus, s)) },
  };
}

const updateQ = z.object({
  email_subject: z.string().trim().max(300).optional(), email_body: z.string().max(20000).optional(), contact_id: uuid.nullable().optional(), contact_name: z.string().trim().max(160).nullable().optional(),
  contact_email: z.string().trim().email("Correu no vàlid").max(200).nullable().optional().or(z.literal("").transform(() => null)), assigned_to: uuid.nullable().optional(), response_due: day.nullable().optional(), lang: z.enum(["ca", "es"]).optional(),
});
export async function updateClaim(u: U, id: string, raw: unknown) {
  const role = await claimAccess(u, id, "edit");
  const b = parse(updateQ, raw);
  if (b.assigned_to !== undefined && role !== "staff") throw new HttpError(403, "Només Direcció o l'administració autoritzada pot reassignar una reclamació");
  const cur = (await u.sb.from("fin_claims").select("id,code,retailer,assigned_to,notes,status").eq("id", id).single()).data!;
  const patch: Record<string, unknown> = {};
  for (const k of ["email_subject", "email_body", "contact_name", "contact_email", "response_due"] as const) if (b[k] !== undefined) patch[k] = b[k];
  if (b.contact_id !== undefined) {
    patch.contact_id = b.contact_id;
    if (b.contact_id) {
      const ct = (await u.sb.from("retailer_contacts").select("name,email").eq("id", b.contact_id).maybeSingle()).data;
      if (!ct) throw new HttpError(404, "Contacte no trobat");
      patch.contact_name = ct.name; patch.contact_email = ct.email;
    }
  }
  if (b.lang) patch.notes = `lang:${b.lang}`;
  let assignee: Awaited<ReturnType<typeof assertAssignable>> = null;
  if (b.assigned_to !== undefined) { assignee = await assertAssignable(u, b.assigned_to); patch.assigned_to = b.assigned_to; }
  if (!Object.keys(patch).length) return { ok: true };
  const r = await u.sb.from("fin_claims").update(patch).eq("id", id);
  if (r.error) fail(r.error);
  if (assignee && assignee.id !== cur.assigned_to && assignee.id !== u.user.id) await notify(assignee.id, { kind: "economia", title: `T'han assignat la reclamació ${cur.code}`, body: cur.retailer as string, link: { view: "reclamacions", params: { id } }, ruleKey: `rec_assign:${id}:${assignee.id}` });
  return { ok: true };
}

export async function setClaimStatus(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(z.object({ status: z.enum(CLAIM_STATUSES), note: z.string().trim().max(2000).optional() }), raw);
  const cur = (await u.sb.from("fin_claims").select("status").eq("id", id).single()).data!;
  if (!canTransition(cur.status as ClaimStatus, b.status)) throw new HttpError(400, `No es pot passar de «${CLAIM_STATUS_LABEL[cur.status as ClaimStatus]}» a «${CLAIM_STATUS_LABEL[b.status]}»`);
  if (b.status === "enviada") throw new HttpError(400, "Per marcar-la com a enviada, fes servir «Enviar» o «Registrar enviament extern»");
  const r = await u.sb.from("fin_claims").update({ status: b.status }).eq("id", id);
  if (r.error) fail(r.error);
  if (b.note) await event(u, id, { kind: "nota", body: b.note });
  return { ok: true };
}

export async function deleteDraft(u: U, id: string) {
  await staff(u, "edit");
  const c = (await u.sb.from("fin_claims").select("status").eq("id", uuid.parse(id)).maybeSingle()).data;
  if (!c) throw new HttpError(404, "Reclamació no trobada");
  if (c.status !== "esborrany") throw new HttpError(400, "Només es poden eliminar esborranys");
  const r = await u.sb.from("fin_claims").delete().eq("id", id);
  if (r.error) fail(r.error);
  return { ok: true };
}

export async function removeItem(u: U, id: string, itemId: string) {
  await staff(u, "edit");
  const r = await u.sb.from("fin_claim_items").delete().eq("id", uuid.parse(itemId)).eq("claim_id", id);
  if (r.error) fail(r.error);
  return { ok: true };
}

/* ======================================================================= autorització (Fase 14) */

/** Cap reclamació no surt sense revisió i autorització (ho torna a exigir la base de dades, migració 025). */
function assertAuthorized(c: Record<string, unknown>) {
  if (!("authorized_at" in c)) throw new HttpError(409, "Falta aplicar la migració supabase/migrations/025_auditor_comissions.sql: sense ella no es pot autoritzar ni enviar cap reclamació.");
  if (!c.authorized_at) throw new HttpError(409, "Cal que Direcció (o qui tingui permís d'aprovació a Economia) revisi i autoritzi la reclamació abans d'enviar-la.");
}
export async function authorizeClaim(u: U, id: string, raw: unknown) {
  await staff(u, "edit");
  const b = parse(z.object({ authorize: z.boolean(), note: z.string().trim().max(500).optional() }), raw);
  const c = (await u.sb.from("fin_claims").select("*").eq("id", uuid.parse(id)).maybeSingle()).data as Record<string, unknown> | null;
  if (!c) throw new HttpError(404, "Reclamació no trobada");
  if (!("authorized_at" in c)) throw new HttpError(409, "Falta aplicar la migració supabase/migrations/025_auditor_comissions.sql");
  if (!["esborrany", "pendent_enviament"].includes(c.status as string)) throw new HttpError(409, "Aquesta reclamació ja s'ha enviat");
  if (b.authorize) {
    const can = u.profile.role === "admin" || (await hasPerm(u, "economia", "approve"));
    if (!can) throw new HttpError(403, "Només Direcció o qui tingui permís d'aprovació a Economia pot autoritzar una reclamació");
    if (u.profile.role !== "admin" && c.created_by === u.user.id) throw new HttpError(403, "Una reclamació l'ha d'autoritzar una persona diferent de qui l'ha preparada");
    if (!Number(c.items_count)) throw new HttpError(400, "La reclamació no té cap diferència");
    if (!c.contact_email) throw new HttpError(400, "Indica i desa el correu del destinatari abans d'autoritzar-la: s'autoritza el correu complet.");
  }
  const r = await u.sb.from("fin_claims").update(b.authorize ? { authorized_at: new Date().toISOString(), authorization_note: b.note ?? null } : { authorized_at: null, authorization_note: null }).eq("id", id);
  if (r.error) fail(r.error);
  await event(u, id, { kind: "nota", body: b.authorize ? `Reclamació revisada i AUTORITZADA per enviar${b.note ? `: ${b.note}` : ""}.` : `Autorització retirada${b.note ? `: ${b.note}` : ""}.` });
  if (b.authorize && c.created_by && c.created_by !== u.user.id) await notify(c.created_by as string, { kind: "economia", title: `Reclamació ${c.code} autoritzada`, body: "Ja es pot enviar a la comercialitzadora.", link: { view: "reclamacions", params: { id } }, ruleKey: `rec_auth:${id}:${Date.now()}` });
  return { ok: true };
}

/* ======================================================================= PDF i enviament */

async function pdfFor(u: U, id: string, langOverride?: Lang) {
  const { claim, items } = await getClaim(u, id);
  const lang = langOverride ?? claim.lang;
  const active = (items as { status: string; kind: ItemKind; client_name: string | null; cups: string | null; external_ref: string | null; contract_ref: string | null; expected_amount: string; settled_amount: string; claimed_amount: string; reason_text: string; rule_ref: { label: string; excerpt?: string | null; facts?: Record<string, unknown> | null } | null }[]).filter((i) => !["retirada", "traspassada"].includes(i.status));
  let legal: string | null = null;
  if (claim.retailer_id) legal = ((await adminClient().from("retailers").select("legal_name").eq("id", claim.retailer_id).maybeSingle()).data?.legal_name as string | null) ?? null;
  const bytes = buildClaimPdf({
    lang, code: claim.code as string, retailer: claim.retailer as string, retailerLegal: legal, periodFrom: claim.period_from as string, periodTo: claim.period_to as string, generatedAt: new Date(), generatedBy: u.profile.name,
    contactName: claim.contact_name as string | null, draft: ["esborrany"].includes(claim.status as string),
    items: active.map((i) => ({ kind: i.kind, client: i.client_name, cups: i.cups, reference: i.external_ref, contractRef: i.contract_ref, expected: i.expected_amount, settled: i.settled_amount, claimed: i.claimed_amount, reason: i.reason_text, ruleRef: i.rule_ref?.label ? i.rule_ref : null, facts: (i.rule_ref?.facts ?? null) as never })),
    total: money(active.reduce((s, i) => s.plus(i.claimed_amount), D(0))),
  });
  return { bytes, fileName: `${claim.code}_${String(claim.retailer).replace(/[^\w]+/g, "_")}.pdf`, claim };
}
export async function claimPdf(u: U, id: string, lang?: string) {
  const r = await pdfFor(u, id, lang === "ca" || lang === "es" ? lang : undefined);
  return { pdf: r.bytes, fileName: r.fileName };
}

const sendQ = z.object({
  confirm: z.literal(true, { errorMap: () => ({ message: "Cal confirmar l'enviament" }) }),
  to: z.string().trim().email("Correu del destinatari no vàlid"), cc: z.array(z.string().trim().email()).max(5).default([]),
  subject: z.string().trim().min(3).max(300), body: z.string().trim().min(20).max(20000), lang: z.enum(["ca", "es"]).optional(), responseDays: z.number().int().min(5).max(120).default(30),
});
export async function sendClaim(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(sendQ, raw);
  const { bytes, fileName, claim } = await pdfFor(u, id, b.lang);
  if (!["esborrany", "pendent_enviament"].includes(claim.status as string)) throw new HttpError(409, "Aquesta reclamació ja s'ha enviat");
  if (!Number(claim.items_count)) throw new HttpError(400, "La reclamació no té cap diferència");
  assertAuthorized(claim);
  // Fase 14: s'envia exactament el correu autoritzat (assumpte, text i destinatari)
  if ((claim.email_subject ?? "").trim() !== b.subject || (claim.email_body ?? "").trim() !== b.body || (claim.contact_email ?? "").trim().toLowerCase() !== b.to.toLowerCase()) {
    throw new HttpError(409, "El correu no és el que es va autoritzar. Desa els canvis (assumpte, text o destinatari) i demana una nova autorització abans d'enviar-lo.");
  }
  const { sendFromMyMailbox } = await import("./comms");
  const res = await sendFromMyMailbox(u, { to: b.to, cc: b.cc, subject: b.subject, text: b.body, attachments: [{ filename: fileName, content: Buffer.from(bytes), contentType: "application/pdf" }] });
  if (!res.accepted) {
    await event(u, id, { kind: "correu", body: `Correu NO enviat a ${b.to}: ${res.error}` });
    throw new HttpError(502, `No s'ha enviat: ${res.error}`);
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  // còpia exacta del PDF enviat (si no es pot desar, l'enviament ja s'ha fet i queda registrat igualment)
  let path: string | null = `${id}/enviat-${sha.slice(0, 12)}.pdf`;
  try { const up = await adminClient().storage.from(BUCKET).upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true }); if (up.error) path = null; } catch { path = null; }
  const due = new Date(Date.now() + b.responseDays * 86_400_000).toISOString().slice(0, 10);
  const up = await u.sb.from("fin_claims").update({ status: "enviada", sent_channel: "crm", response_due: due, pdf_sha256: sha }).eq("id", id);
  if (up.error) fail(up.error);
  await event(u, id, { kind: "enviament", body: `Enviada per correu a ${b.to}${b.cc.length ? ` (cc: ${b.cc.join(", ")})` : ""} des de ${res.from}. Resposta esperada abans del ${due}.`, attachment_path: path, attachment_name: path ? fileName : null, attachment_mime: path ? "application/pdf" : null, attachment_size: path ? bytes.byteLength : null });
  await u.sb.from("fin_claims").update({ status: "pendent_resposta" }).eq("id", id);
  return { ok: true, messageId: res.messageId, from: res.from, responseDue: due };
}

/** Enviament fet fora del CRM (p. ex. pel portal de la comercialitzadora). */
export async function markSentExternally(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(z.object({ sent_at: day, channel: z.string().trim().min(2).max(120), note: z.string().trim().max(1000).optional(), responseDays: z.number().int().min(5).max(120).default(30) }), raw);
  if (b.sent_at > today()) throw new HttpError(400, "La data d'enviament no pot ser futura");
  const cur = (await u.sb.from("fin_claims").select("*").eq("id", id).single()).data!;
  if (!["esborrany", "pendent_enviament"].includes(cur.status as string)) throw new HttpError(409, "Aquesta reclamació ja s'ha enviat");
  assertAuthorized(cur);
  const due = new Date(new Date(`${b.sent_at}T12:00:00Z`).getTime() + b.responseDays * 86_400_000).toISOString().slice(0, 10);
  const r = await u.sb.from("fin_claims").update({ status: "enviada", sent_channel: "extern", sent_at: `${b.sent_at}T12:00:00Z`, response_due: due }).eq("id", id);
  if (r.error) fail(r.error);
  await event(u, id, { kind: "enviament", body: `Enviament registrat manualment (${b.channel}) el ${b.sent_at}.${b.note ? ` ${b.note}` : ""}` });
  await u.sb.from("fin_claims").update({ status: "pendent_resposta" }).eq("id", id);
  return { ok: true };
}

/* ======================================================================= seguiment */

const responseQ = z.object({
  status: z.enum(["en_revisio", "acceptada_total", "acceptada_parcial", "rebutjada"]), received_at: day, text: z.string().trim().min(3, "Resumeix la resposta").max(5000),
  items: z.array(z.object({ id: uuid, recognized: amount, status: z.enum(["reclamada", "acceptada", "parcial", "rebutjada"]), note: z.string().trim().max(500).optional() })).max(2000).default([]),
});
export async function registerResponse(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(responseQ, raw);
  if (b.received_at > today()) throw new HttpError(400, "La data de la resposta no pot ser futura");
  const cur = (await u.sb.from("fin_claims").select("status").eq("id", id).single()).data!;
  const all = ((await u.sb.from("fin_claim_items").select("id,claimed_amount,status").eq("claim_id", id)).data ?? []) as { id: string; claimed_amount: string; status: string }[];
  for (const i of b.items) {
    const it = all.find((x) => x.id === i.id);
    if (!it) throw new HttpError(404, "Línia no trobada en aquesta reclamació");
    if (D(i.recognized).gt(it.claimed_amount)) throw new HttpError(400, "L'import reconegut no pot superar el reclamat");
  }
  // acceptada totalment → totes les línies reconegudes per l'import reclamat (si no s'ha detallat)
  const detail = b.status === "acceptada_total" && !b.items.length ? all.filter((x) => !["retirada", "traspassada"].includes(x.status)).map((x) => ({ id: x.id, recognized: x.claimed_amount, status: "acceptada" as const, note: undefined })) : b.items;
  for (const i of detail) {
    const r = await u.sb.from("fin_claim_items").update({ recognized_amount: i.recognized, status: i.status, response_note: i.note ?? null }).eq("id", i.id).eq("claim_id", id);
    if (r.error) fail(r.error);
  }
  if (cur.status !== b.status) {
    if (!canTransition(cur.status as ClaimStatus, b.status)) throw new HttpError(400, `No es pot passar de «${CLAIM_STATUS_LABEL[cur.status as ClaimStatus]}» a «${CLAIM_STATUS_LABEL[b.status]}»`);
    const r = await u.sb.from("fin_claims").update({ status: b.status, responded_at: `${b.received_at}T12:00:00Z` }).eq("id", id);
    if (r.error) fail(r.error);
  }
  await event(u, id, { kind: "resposta", body: `Resposta de la comercialitzadora (${b.received_at}): ${b.text}`, status_to: b.status });
  return { ok: true };
}

const EXT: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", csv: "text/csv", eml: "message/rfc822", txt: "text/plain" };
export async function addAttachment(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(z.object({ name: z.string().trim().min(1).max(200), base64: z.string().min(4).max(4_200_000, "El fitxer supera 3 MB"), note: z.string().trim().max(1000).optional() }), raw);
  const ext = (b.name.split(".").pop() ?? "").toLowerCase();
  if (!EXT[ext]) throw new HttpError(415, `Tipus no admès. Admesos: ${Object.keys(EXT).join(", ")}`);
  const bytes = new Uint8Array(Buffer.from(b.base64, "base64"));
  if (!bytes.byteLength || bytes.byteLength > 3 * 1024 * 1024) throw new HttpError(413, "El fitxer ha de tenir entre 1 byte i 3 MB (límit de Vercel per petició)");
  if (["pdf", "jpg", "jpeg", "png", "xlsx", "docx"].includes(ext)) { const s = sniffDoc(bytes, ext); if (!s.ok) throw new HttpError(415, s.reason ?? "Contingut no vàlid"); }
  const path = `${id}/${randomUUID()}.${ext}`;
  const up = await adminClient().storage.from(BUCKET).upload(path, Buffer.from(bytes), { contentType: EXT[ext], upsert: false });
  if (up.error) throw new HttpError(/not found/i.test(up.error.message) ? 409 : 502, /not found/i.test(up.error.message) ? "Falta el bucket fin-claims: aplica la migració 018" : "No s'ha pogut desar el justificant");
  await event(u, id, { kind: "justificant", body: b.note ?? null, attachment_path: path, attachment_name: b.name.replace(/[^\w.\- ()]/g, "_"), attachment_mime: EXT[ext], attachment_size: bytes.byteLength });
  return { ok: true };
}
export async function attachmentUrl(u: U, eventId: string) {
  const e = (await u.sb.from("fin_claim_events").select("claim_id,attachment_path,attachment_name").eq("id", uuid.parse(eventId)).maybeSingle()).data;
  if (!e?.attachment_path) throw new HttpError(404, "Document no trobat");
  await claimAccess(u, e.claim_id as string);
  const s = await adminClient().storage.from(BUCKET).createSignedUrl(e.attachment_path as string, 60, { download: (e.attachment_name as string) ?? true });
  if (s.error || !s.data) throw new HttpError(404, "El fitxer ja no és a l'emmagatzematge");
  return { url: s.data.signedUrl };
}

export async function addReminder(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(z.object({ at: z.string().datetime({ offset: true }).or(day), userId: uuid.optional(), note: z.string().trim().max(500).optional() }), raw);
  const at = b.at.length === 10 ? `${b.at}T08:00:00Z` : b.at;
  if (new Date(at).getTime() < Date.now() - 60_000) throw new HttpError(400, "El recordatori ha de ser en el futur");
  const who = b.userId ? (await assertAssignable(u, b.userId))!.id : u.user.id;
  const r = await u.sb.from("fin_claim_reminders").insert({ claim_id: id, remind_at: at, user_id: who, note: b.note ?? null, created_by: u.user.id }).select("id").single();
  if (r.error) fail(r.error);
  await event(u, id, { kind: "recordatori", body: `Recordatori el ${at.slice(0, 10)}${b.note ? `: ${b.note}` : ""}`, ref_id: r.data.id });
  return { ok: true };
}
export async function doneReminder(u: U, id: string, reminderId: string) {
  await claimAccess(u, id, "edit");
  const r = await u.sb.from("fin_claim_reminders").update({ done_at: new Date().toISOString() }).eq("id", uuid.parse(reminderId)).eq("claim_id", id);
  if (r.error) fail(r.error);
  return { ok: true };
}

export async function addTask(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(z.object({ title: z.string().trim().min(3).max(200), due: day.optional(), assignedTo: uuid.optional() }), raw);
  const c = (await u.sb.from("fin_claims").select("code,retailer").eq("id", id).single()).data!;
  const who = b.assignedTo ? await assertAssignable(u, b.assignedTo) : { id: u.user.id, name: u.profile.name, role: u.profile.role };
  const t = await u.sb.from("crm_tasks").insert({ title: `${b.title} · ${c.code}`, notes: `Reclamació ${c.code} a ${c.retailer}`, due_at: b.due ? `${b.due}T09:00:00Z` : null, assigned_to: who!.id, assigned_name: who!.name, created_by: u.user.id }).select("id").single();
  if (t.error) fail(t.error, "No s'ha pogut crear la tasca");
  await event(u, id, { kind: "tasca", body: `Tasca «${b.title}» per a ${who!.name}${b.due ? ` (venç el ${b.due})` : ""}`, ref_id: t.data.id });
  if (who!.id !== u.user.id) await notify(who!.id, { kind: "tasca", title: `Nova tasca: ${b.title}`, body: `Reclamació ${c.code} · ${c.retailer}`, link: { view: "reclamacions", params: { id } }, ruleKey: `rec_task:${t.data.id}` });
  return { ok: true, taskId: t.data.id };
}

const recoveryQ = z.object({ amount, received_at: day, itemId: uuid.nullable().optional(), statementLineId: uuid.nullable().optional(), reference: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional() });
export async function registerRecovery(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(recoveryQ, raw);
  if (b.received_at > today()) throw new HttpError(400, "La data no pot ser futura");
  if (D(b.amount).lte(0)) throw new HttpError(400, "L'import ha de ser positiu");
  const c = (await u.sb.from("fin_claims").select("status,total_claimed,total_recovered").eq("id", id).single()).data!;
  if (["esborrany", "pendent_enviament"].includes(c.status as string)) throw new HttpError(400, "Encara no s'ha enviat la reclamació");
  if (b.itemId) {
    const it = (await u.sb.from("fin_claim_items").select("claimed_amount,recovered_amount").eq("id", b.itemId).eq("claim_id", id).maybeSingle()).data;
    if (!it) throw new HttpError(404, "Línia no trobada en aquesta reclamació");
    if (D(it.recovered_amount).plus(b.amount).gt(D(it.claimed_amount).plus("0.01"))) throw new HttpError(400, `L'import recuperat superaria el reclamat per a aquest contracte (${it.claimed_amount} €)`);
  }
  const key = ["rec", id, b.itemId ?? "", b.statementLineId ?? "", b.amount, b.received_at, (b.reference ?? "").toLowerCase()].join("|");
  const r = await u.sb.from("fin_claim_recoveries").insert({ claim_id: id, item_id: b.itemId ?? null, statement_line_id: b.statementLineId ?? null, amount: b.amount, received_at: b.received_at, reference: b.reference ?? null, note: b.note ?? null, idempotency_key: key, created_by: u.user.id });
  if (r.error) { if (r.error.code === "23505") throw new HttpError(409, "Aquest import ja s'ha registrat (mateix import, data i referència)"); fail(r.error); }
  return { ok: true };
}

export async function reviewLink(u: U, id: string, raw: unknown) {
  await claimAccess(u, id, "edit");
  const b = parse(z.object({ linkId: uuid, accept: z.boolean(), amount: amount.optional() }), raw);
  const l = (await u.sb.from("fin_claim_links").select("*, fin_statement_lines(amount,fin_provider_statements(reference,received_at))").eq("id", b.linkId).eq("claim_id", id).maybeSingle()).data as { id: string; item_id: string | null; statement_line_id: string; amount: string; status: string; fin_statement_lines: { amount: string; fin_provider_statements: { reference: string; received_at: string } | null } | null } | null;
  if (!l) throw new HttpError(404, "Proposta no trobada");
  if (l.status !== "proposada") throw new HttpError(409, "Aquesta proposta ja s'ha revisat");
  if (b.accept) {
    let amt = D(b.amount ?? l.amount);
    if (l.item_id) {
      const it = (await u.sb.from("fin_claim_items").select("claimed_amount,recovered_amount").eq("id", l.item_id).single()).data!;
      const rest = D(it.claimed_amount).minus(it.recovered_amount);
      if (amt.gt(rest)) amt = rest;
    }
    if (amt.lte(0)) throw new HttpError(400, "No queda import pendent de recuperar en aquesta línia");
    const st = one(l.fin_statement_lines?.fin_provider_statements);
    await registerRecovery(u, id, { amount: money(amt), received_at: (st?.received_at ?? today()).slice(0, 10), itemId: l.item_id, statementLineId: l.statement_line_id, reference: st?.reference ?? undefined, note: "Regularització vinculada a una liquidació" });
  }
  const r = await u.sb.from("fin_claim_links").update({ status: b.accept ? "confirmada" : "descartada", reviewed_by: u.user.id, reviewed_at: new Date().toISOString() }).eq("id", l.id);
  if (r.error) fail(r.error);
  await event(u, id, { kind: "regularitzacio", body: b.accept ? "Regularització confirmada i registrada com a import recuperat" : "Proposta de regularització descartada", ref_id: l.statement_line_id });
  return { ok: true };
}

/** En registrar una liquidació nova: proposa regularitzacions vinculables a reclamacions obertes (revisió humana). */
export async function proposeRegularizations(u: U, statementId: string) {
  if (!(await finStaff(u, "edit"))) return { proposals: 0 };
  const lines = await u.sb.from("fin_statement_lines").select("id,contract_id,cups,amount,kind,concept,match_status").eq("statement_id", statementId);
  if (lines.error || !lines.data?.length) return { proposals: 0 };
  const st = (await u.sb.from("fin_provider_statements").select("retailer,reference").eq("id", statementId).maybeSingle()).data;
  const cl = await u.sb.from("fin_claims").select("id,code,status,retailer,assigned_to").in("status", ["enviada", "pendent_resposta", "en_revisio", "acceptada_total", "acceptada_parcial"]);
  if (cl.error) return { proposals: 0 };                                   // migració 018 no aplicada: no fa res
  const claims = ((cl.data ?? []) as { id: string; code: string; status: ClaimStatus; retailer: string; assigned_to: string | null }[]).filter((c) => !st || norm(c.retailer) === norm(st.retailer as string));
  if (!claims.length) return { proposals: 0 };
  const it = await u.sb.from("fin_claim_items").select("id,claim_id,item_key,kind,contract_id,cups,claimed_amount,recovered_amount,status").in("claim_id", claims.map((c) => c.id)).in("status", ["reclamada", "acceptada", "parcial"]);
  const items: OpenItem[] = ((it.data ?? []) as (Omit<OpenItem, "claim_status"> & { status: string })[]).map((i) => ({ ...i, claim_status: claims.find((c) => c.id === i.claim_id)!.status }));
  const props = matchRegularizations(lines.data as never, items);
  if (!props.length) return { proposals: 0 };
  const r = await u.sb.from("fin_claim_links").upsert(props.map((p) => ({ ...p, status: "proposada" })), { onConflict: "statement_line_id,item_id", ignoreDuplicates: true }).select("claim_id");
  const created = (r.data ?? []) as { claim_id: string }[];
  const admins = ((await adminClient().from("profiles").select("id").eq("role", "admin")).data ?? []).map((p) => p.id as string);
  for (const c of claims.filter((x) => created.some((p) => p.claim_id === x.id))) {
    const n = created.filter((p) => p.claim_id === c.id).length;
    for (const who of new Set([c.assigned_to, ...admins].filter(Boolean) as string[])) await notify(who, { kind: "economia", title: `Possible regularització de ${c.code}`, body: `${n} línia(es) de la liquidació ${st?.reference ?? ""} poden correspondre a aquesta reclamació. Cal revisar-les.`, link: { view: "reclamacions", params: { id: c.id } }, ruleKey: `rec_reg:${c.id}:${statementId}` });
  }
  return { proposals: created.length };
}

/* ======================================================================= contactes i incidències */

const contactQ = z.object({ retailer_id: uuid, name: z.string().trim().min(1).max(160), email: z.string().trim().email("Correu no vàlid").max(200).nullable().optional().or(z.literal("").transform(() => null)), phone: z.string().trim().max(40).nullable().optional(), role: z.enum(["liquidacions", "comercial", "juridic", "altres"]).default("liquidacions"), is_default: z.boolean().default(false), notes: z.string().trim().max(1000).nullable().optional() });
export async function listContacts(u: U, retailerName: string) {
  await staff(u);
  const rr = await u.sb.from("retailers").select("id,trade_name,aliases");
  if (rr.error) return { retailer: null, contacts: [] };
  const r = ((rr.data ?? []) as { id: string; trade_name: string; aliases: string[] | null }[]).find((x) => matchesRetailer(retailerName, { trade_name: x.trade_name, aliases: x.aliases ?? [] })) ?? null;
  if (!r) return { retailer: null, contacts: [] };
  const c = await u.sb.from("retailer_contacts").select("*").eq("retailer_id", r.id).order("name");
  if (c.error) fail(c.error);
  return { retailer: { id: r.id, name: r.trade_name }, contacts: c.data ?? [] };
}
export async function saveContact(u: U, raw: unknown, id?: string) {
  await staff(u, "edit");
  const b = parse(contactQ, raw);
  if (b.is_default) await u.sb.from("retailer_contacts").update({ is_default: false }).eq("retailer_id", b.retailer_id).eq("role", b.role);
  const r = id ? await u.sb.from("retailer_contacts").update(b).eq("id", uuid.parse(id)).select("id").single() : await u.sb.from("retailer_contacts").insert({ ...b, created_by: u.user.id }).select("id").single();
  if (r.error) fail(r.error);
  return { id: r.data.id };
}
export async function deleteContact(u: U, id: string) {
  await staff(u, "edit");
  const r = await u.sb.from("retailer_contacts").delete().eq("id", uuid.parse(id));
  if (r.error) fail(r.error);
  return { ok: true };
}

/** Obre una incidència del client (Clients 360°) vinculada a una línia de la reclamació. */
export async function incidentFromItem(u: U, id: string, itemId: string) {
  await claimAccess(u, id, "edit");
  const it = (await u.sb.from("fin_claim_items").select("client_id,contract_id,cups,claimed_amount,kind,fin_claims(code,retailer)").eq("id", uuid.parse(itemId)).eq("claim_id", id).maybeSingle()).data as { client_id: string | null; contract_id: string | null; claimed_amount: string; kind: ItemKind; fin_claims: { code: string; retailer: string } | null } | null;
  if (!it) throw new HttpError(404, "Línia no trobada");
  if (!it.client_id) throw new HttpError(400, "Aquesta línia no està vinculada a cap client del CRM");
  const c = one(it.fin_claims);
  const r = await u.sb.from("crm_incidents").insert({ client_id: it.client_id, contract_id: it.contract_id, kind: "reclamacio", category: "comissions", title: `${ITEM_KIND_LABEL[it.kind]} (${c?.retailer ?? ""})`, description: `Reclamació ${c?.code ?? ""}: ${it.claimed_amount} € reclamats a la comercialitzadora.`, external_ref: c?.code ?? null, priority: "mitjana", created_by: u.user.id }).select("id").single();
  if (r.error) fail(r.error, "No s'ha pogut crear la incidència");
  await event(u, id, { kind: "nota", body: `Incidència oberta al client per a la línia de ${it.claimed_amount} €`, ref_id: r.data.id });
  return { id: r.data.id };
}

/* ======================================================================= Centre de Control i avisos automàtics */

/** Indicadors per al Centre de Control (només amb permís econòmic; null si la migració no és aplicada). */
export async function claimsKpisForControl(u: U) {
  if (!(await finStaff(u))) return null;
  const r = await u.sb.from("fin_claims").select("status,total_claimed,total_recovered").limit(5000);
  if (r.error) return null;
  const rows = (r.data ?? []) as { status: ClaimStatus; total_claimed: string; total_recovered: string }[];
  return {
    reclamacions_obertes: rows.filter((c) => !["resolta", "rebutjada"].includes(c.status)).length,
    reclamacions_pendent: Number(money(rows.filter((c) => AWAITING.includes(c.status)).reduce((s, c) => s.plus(D(c.total_claimed).minus(c.total_recovered)), D(0)))),
    reclamacions_recuperat: Number(money(rows.reduce((s, c) => s.plus(c.total_recovered), D(0)))),
  };
}

type SB = ReturnType<typeof adminClient>;
type Rule = { key: string; enabled: boolean; params: Record<string, unknown> };
type Note = { user_id: string; kind: string; title: string; body: string | null; link: { view: string; params: Record<string, string> }; rule_key: string };
/** Executat pel motor d'automatitzacions (cron diari). Si la 018 no és aplicada, no fa res. */
export async function claimsAutomations(sb: SB, now: Date, rules: Rule[]): Promise<Note[]> {
  const on = (k: string) => rules.find((r) => r.key === k && r.enabled);
  const out: Note[] = [];
  if (on("reclamacio_recordatori")) {
    const r = await sb.from("fin_claim_reminders").select("id,claim_id,user_id,note,remind_at,fin_claims(code,retailer)").is("done_at", null).is("notified_at", null).lte("remind_at", now.toISOString()).limit(500);
    if (!r.error) {
      for (const x of (r.data ?? []) as { id: string; claim_id: string; user_id: string; note: string | null; fin_claims: { code: string; retailer: string } | { code: string; retailer: string }[] | null }[]) {
        const c = one(x.fin_claims);
        out.push({ user_id: x.user_id, kind: "economia", title: `Recordatori: reclamació ${c?.code ?? ""}`, body: `${c?.retailer ?? ""}${x.note ? ` · ${x.note}` : ""}`, link: { view: "reclamacions", params: { id: x.claim_id } }, rule_key: `rec_rem:${x.id}` });
      }
      const ids = (r.data ?? []).map((x) => x.id as string);
      if (ids.length) await sb.from("fin_claim_reminders").update({ notified_at: now.toISOString() }).in("id", ids);
    }
  }
  const late = on("reclamacio_sense_resposta");
  if (late) {
    const days = Number(late.params?.days ?? 30);
    const r = await sb.from("fin_claims").select("id,code,retailer,sent_at,response_due,assigned_to,created_by,total_claimed").in("status", ["enviada", "pendent_resposta"]).limit(1000);
    if (!r.error) {
      const admins = ((await sb.from("profiles").select("id").eq("role", "admin")).data ?? []).map((p) => p.id as string);
      const t = now.toISOString().slice(0, 10);
      for (const c of (r.data ?? []) as { id: string; code: string; retailer: string; sent_at: string | null; response_due: string | null; assigned_to: string | null; created_by: string | null; total_claimed: string }[]) {
        const due = c.response_due ?? (c.sent_at ? new Date(new Date(c.sent_at).getTime() + days * 86_400_000).toISOString().slice(0, 10) : null);
        if (!due || due >= t) continue;
        for (const who of new Set([c.assigned_to ?? c.created_by, ...admins].filter(Boolean) as string[])) out.push({ user_id: who, kind: "economia", title: `${c.retailer} no ha respost la reclamació ${c.code}`, body: `Resposta esperada abans del ${due} · ${c.total_claimed} € reclamats.`, link: { view: "reclamacions", params: { id: c.id } }, rule_key: `rec_late:${c.id}:${due}` });
      }
    }
  }
  return out;
}
