import "server-only";
/**
 * FASE 14 · AUDITOR DE COMISSIONS (servidor).
 * Reutilitza el carregador de reclamacions (Fase 8.2: contractes, regles aprovades, terminis, retrocessions i
 * diferències ja reclamades) i hi afegeix el que cal per a la conciliació de doble sentit: la traçabilitat de cada
 * línia (pestanya i fila), els cobraments reals per línia, els ajornaments, les renovacions i els imports reclamats.
 * Accés: Direcció i l'administració autoritzada (permís «economia»). Tot es llegeix amb la sessió de l'usuari (RLS).
 */
import { z } from "zod";
import { AUDIT_ALERT_LABEL, AUDIT_RULE_KEY, auditCommissions, type AuditContract, type AuditLine, type AuditResult, type ClaimItemLite } from "@/core/commission-audit";
import { D, money } from "@/core/commissions";
import { norm } from "@/core/retailers";
import { adminClient, HttpError } from "./supabase";
import { parse, type U } from "./crm";
import { finStaff } from "./permissions";

type SB = U["sb"] | ReturnType<typeof adminClient>;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); };

async function chunked<T>(sb: SB, table: string, cols: string, col: string, vals: string[], eq: [string, unknown][] = []): Promise<{ rows: T[]; missing: boolean }> {
  const rows: T[] = [];
  for (let i = 0; i < vals.length; i += 300) {
    let q = sb.from(table).select(cols).in(col, vals.slice(i, i + 300));
    for (const [k, v] of eq) q = q.eq(k, v as never);
    const r = await q;
    if (r.error) { if (/does not exist|schema cache|Could not find/i.test(r.error.message ?? "") || ["42703", "42P01", "PGRST204", "PGRST205"].includes(r.error.code ?? "")) return { rows, missing: true }; throw new HttpError(500, "No s'han pogut carregar les dades de l'auditoria"); }
    rows.push(...((r.data ?? []) as T[]));
  }
  return { rows, missing: false };
}

interface Params { retailer: string; from: string; to: string; defaultDays?: number; collectDays?: number }

/** Auditoria d'una comercialitzadora en un període (activacions i liquidacions rebudes dins del període). */
export async function auditRetailer(u: U, p: Params): Promise<AuditResult & { retailer: string; terms: { paymentDays: number | null; claimDays: number | null }; warnings: string[] }> {
  const { load } = await import("./claims");
  const d = await load(u, p.retailer, p.from, p.to);
  const sb = u.sb;
  const warnings: string[] = [];
  const lineIds = [...new Set(d.allLines.map((l) => l.id))];
  const contractIds = d.contracts.map((c) => c.id);
  const stIds = [...new Set(d.allLines.map((l) => l.statement_id))];
  const [extra, ledger, alloc, econ, prev, files] = await Promise.all([
    chunked<{ id: string; movement: string | null; event_date: string | null; source_sheet: string | null; source_row: number | null; match_confidence: string | null; match_reason: string | null; match_candidates: unknown[] | null }>(sb, "fin_statement_lines", "id,movement,event_date,source_sheet,source_row,match_confidence,match_reason,match_candidates", "id", lineIds),
    chunked<{ statement_line_id: string; amount: string }>(sb, "fin_ledger", "statement_line_id,amount", "statement_line_id", lineIds, [["kind", "cobrament"]]),
    chunked<{ statement_line_id: string; amount: string }>(sb, "fin_receipt_allocations", "statement_line_id,amount", "statement_line_id", lineIds, [["mode", "compensada"]]),
    chunked<{ contract_id: string; settlement_deferred_until: string | null; settlement_deferral_reason: string | null }>(sb, "fin_contract_economics", "contract_id,settlement_deferred_until,settlement_deferral_reason", "contract_id", contractIds),
    chunked<{ id: string; previous_contract_id: string | null }>(sb, "crm_contracts", "id,previous_contract_id", "id", contractIds),
    chunked<{ id: string; file_name: string | null }>(sb, "fin_provider_statements", "id,file_name", "id", stIds),
  ]);
  if (extra.missing || alloc.missing || econ.missing) warnings.push("Falta aplicar la migració 025: no es mostren la pestanya i la fila d'origen, les compensacions ni els ajornaments.");
  const ex = new Map(extra.rows.map((x) => [x.id, x]));
  const cob = new Map<string, string>(); for (const x of ledger.rows) cob.set(x.statement_line_id, money(D(cob.get(x.statement_line_id) ?? 0).plus(x.amount)));
  const comp = new Map<string, string>(); for (const x of alloc.rows) comp.set(x.statement_line_id, money(D(comp.get(x.statement_line_id) ?? 0).plus(x.amount)));
  const fileOf = new Map(files.rows.map((f) => [f.id, f.file_name]));
  const enrich = (l: (typeof d.allLines)[number]): AuditLine => {
    const e = ex.get(l.id);
    return { ...l, movement: e?.movement ?? null, event_date: e?.event_date ?? null, source_sheet: e?.source_sheet ?? null, source_row: e?.source_row ?? null, file_name: fileOf.get(l.statement_id) ?? null, match_confidence: e?.match_confidence ?? null, match_reason: e?.match_reason ?? null, candidates: Array.isArray(e?.match_candidates) ? e!.match_candidates!.length : 0, collected: cob.get(l.id) ?? "0.00", compensated: comp.get(l.id) ?? "0.00" };
  };
  const ren = new Map(prev.rows.map((x) => [x.id, !!x.previous_contract_id]));
  const def = new Map(econ.rows.map((x) => [x.contract_id, x]));
  const contracts: AuditContract[] = d.contracts.map((c) => ({ ...c, is_renewal: ren.get(c.id) ?? false, deferred_until: def.get(c.id)?.settlement_deferred_until ?? null, deferral_reason: def.get(c.id)?.settlement_deferral_reason ?? null }));
  // imports reclamats (les reclamacions de la comercialitzadora)
  const cl = await sb.from("fin_claims").select("id,code,status,retailer").limit(5000);
  const claims = ((cl.data ?? []) as { id: string; code: string; status: string; retailer: string }[]).filter((c) => norm(c.retailer) === norm(d.retailer) || norm(c.retailer) === norm(p.retailer));
  const items = await chunked<{ claim_id: string; item_key: string; contract_id: string | null; statement_line_id: string | null; claimed_amount: string; recovered_amount: string; status: string; active: boolean }>(sb, "fin_claim_items", "claim_id,item_key,contract_id,statement_line_id,claimed_amount,recovered_amount,status,active", "claim_id", claims.map((c) => c.id));
  const claimItems: ClaimItemLite[] = items.rows.map((i) => { const c = claims.find((x) => x.id === i.claim_id)!; return { ...i, claim_code: c.code, claim_status: c.status }; });
  const res = auditCommissions({
    retailer: d.retailer, from: p.from, to: p.to, today: today(),
    lines: d.lines.map(enrich), allLines: d.allLines.map(enrich), contracts, settledContracts: d.settled, rules: d.rules, terms: d.terms, clawRules: d.clawRules, claimed: d.claimed,
    claimItems, defaultPaymentDays: p.defaultDays, collectDays: p.collectDays,
  });
  return { ...res, retailer: d.retailer, terms: { paymentDays: d.terms.paymentDays, claimDays: d.terms.claimDays }, warnings };
}

const q = z.object({ retailer: z.string().trim().max(120).optional().default(""), from: day.optional(), to: day.optional() });
/** Panell de l'auditor: una comercialitzadora o totes les que tenen liquidacions o contractes en el període. */
export async function auditOverview(u: U, raw: Record<string, string>) {
  if (!(await finStaff(u))) throw new HttpError(403, "L'auditor de comissions conté dades econòmiques restringides: cal autorització de Direcció");
  const b = parse(q, raw);
  const from = b.from ?? yearAgo(), to = b.to ?? today();
  if (to < from) throw new HttpError(400, "El període no és vàlid");
  const rules = (((await u.sb.from("crm_automation_rules").select("key,enabled,params").like("key", "audit_%")).data ?? []) as { key: string; enabled: boolean; params: Record<string, unknown> }[]);
  const param = (k: string, n: string) => { const v = rules.find((r) => r.key === k)?.params?.[n]; return typeof v === "number" && v >= 0 ? v : undefined; };
  const st = await u.sb.from("fin_provider_statements").select("retailer").limit(5000);
  const ks = await u.sb.from("crm_contracts").select("retailer").neq("status", "esborrany").limit(20000);
  const names = [...new Map([...(st.data ?? []), ...(ks.data ?? [])].map((x) => [norm(x.retailer as string), x.retailer as string])).values()].sort((a, c) => a.localeCompare(c, "ca"));
  const targets = b.retailer ? [b.retailer] : [...new Map(((st.data ?? []) as { retailer: string }[]).map((x) => [norm(x.retailer), x.retailer])).values()].slice(0, 30);
  const results: Awaited<ReturnType<typeof auditRetailer>>[] = [];
  for (const r of targets) results.push(await auditRetailer(u, { retailer: r, from, to, defaultDays: param("audit_pendent_liquidar", "default_days"), collectDays: param("audit_cobrament_fora_termini", "days") }));
  const sum = (f: (x: AuditResult["kpis"]) => string) => money(results.reduce((a, x) => a.plus(f(x.kpis)), D(0)));
  const kpis = {
    prevista: sum((k) => k.prevista), liquidada: sum((k) => k.liquidada), cobrada: sum((k) => k.cobrada), reclamada: sum((k) => k.reclamada), recuperada: sum((k) => k.recuperada),
    pendentLiquidar: sum((k) => k.pendentLiquidar), pendentCobrar: sum((k) => k.pendentCobrar), retrocomissions: sum((k) => k.retrocomissions), diferencies: sum((k) => k.diferencies), claimable: sum((k) => k.claimable),
    senseContracte: { count: results.reduce((a, x) => a + x.kpis.senseContracte.count, 0), amount: sum((k) => k.senseContracte.amount) },
    counts: Object.fromEntries(Object.keys(AUDIT_ALERT_LABEL).map((a) => [a, results.reduce((n, x) => n + (x.kpis.counts as Record<string, number>)[a], 0)])),
  };
  return {
    from, to, retailer: b.retailer || null, retailers: names, kpis,
    groups: results.map((r) => ({ retailer: r.retailer, terms: r.terms, kpis: r.kpis, warnings: r.warnings, commissions: r.commissions, lines: r.lines, alerts: r.alerts, claimable: r.discrepancies.filter((x) => x.selectable).map((x) => ({ key: x.key, amount: x.claimable, kind: x.kind, client: x.client, cups: x.cups, reason: x.reason })) })),
    alertsEnabled: Object.fromEntries(Object.entries(AUDIT_RULE_KEY).map(([a, k]) => [a, rules.find((r) => r.key === k)?.enabled ?? false])),
    canEdit: await finStaff(u, "edit"),
  };
}

/** Motor d'automatitzacions (cron diari): avisos a Direcció i a l'administració autoritzada, una sola vegada per cas. */
export async function auditAutomations(sb: ReturnType<typeof adminClient>, now: Date, rules: { key: string; enabled: boolean; params: Record<string, unknown> }[], staffIds: string[]) {
  const on = (k: string) => rules.find((r) => r.key === k && r.enabled);
  if (!Object.values(AUDIT_RULE_KEY).some((k) => on(k)) || !staffIds.length) return [];
  const probe = await sb.from("fin_receipt_allocations").select("id").limit(1);
  if (probe.error) return [];                                     // sense la 025 no s'avisa
  const u = { sb, user: { id: "00000000-0000-0000-0000-000000000000" }, profile: { role: "admin", name: "Automatització" } } as unknown as U;
  const st = await sb.from("fin_provider_statements").select("retailer").limit(5000);
  const targets = [...new Map(((st.data ?? []) as { retailer: string }[]).map((x) => [norm(x.retailer), x.retailer])).values()].slice(0, 30);
  const from = new Date(now); from.setUTCFullYear(from.getUTCFullYear() - 1);
  const param = (k: string, n: string) => { const v = on(k)?.params?.[n]; return typeof v === "number" && v >= 0 ? v : undefined; };
  const out: { user_id: string; kind: string; title: string; body: string; link: { view: string; params: Record<string, string> }; rule_key: string }[] = [];
  for (const r of targets) {
    const res = await auditRetailer(u, { retailer: r, from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), defaultDays: param("audit_pendent_liquidar", "default_days"), collectDays: param("audit_cobrament_fora_termini", "days") }).catch(() => null);
    if (!res) continue;
    const min = Number(on("audit_liquidada_inferior")?.params?.min_eur ?? 1);
    for (const a of res.alerts) {
      if (!on(AUDIT_RULE_KEY[a.type])) continue;
      if (a.type === "liquidada_inferior" && D(a.amount).lt(min)) continue;
      for (const s of staffIds) out.push({ user_id: s, kind: "economia", title: a.title, body: `${AUDIT_ALERT_LABEL[a.type]} · ${a.detail}`.slice(0, 500), link: { view: "auditor", params: { retailer: res.retailer } }, rule_key: `audit:${a.key}` });
    }
  }
  return out;
}
