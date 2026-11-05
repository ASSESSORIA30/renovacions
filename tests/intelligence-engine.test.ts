/**
 * FASE 5 · Motor del servidor de punta a punta amb un client Supabase en memòria:
 * anàlisi de la cartera, idempotència, tasques i avisos, bloqueig, propostes, acceptació i copilot.
 * (La RLS real es prova a tests/db/crm-ia-rls.test.ts amb PostgreSQL.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, requireUser: async () => { throw new Error("no"); }, handler: () => () => null };
});
vi.mock("@/server/sips", () => ({ readCache: async () => [] }));
vi.mock("@/server/mailer", () => ({ smtpReady: async () => false, sendCorporateMail: async () => ({ accepted: [] }) }));

const plus = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const C1 = "00000000-0000-0000-0000-0000000000c1", A = "00000000-0000-0000-0000-00000000000a";
const RULES = [
  { key: "ai_motor", enabled: true, params: { renewal_days: [120, 90, 60, 30, 15], min_saving_eur: 60, min_saving_pct: 5, expensive_pct: 15, inactive_days: 365, proposal_days: 7, min_power_saving_eur: 100, max_comparisons: 400, max_attempts: 3 } },
  { key: "ai_puntuacio", enabled: true, params: { weights: { venciment: 20, estalvi: 25, volum: 10, qualitat_dades: 10, conversio: 10, antiguitat_proposta: 10, ultima_activitat: 5, seguiment: 10 }, business_weights: { comissio: 70, marge: 30 } } },
  { key: "ai_sas_escenari", enabled: false, params: { min_eur_kwh: 0.01, max_eur_kwh: 0.015, retailers: ["Iberdrola"], justification: "", source: "", as_of: null } },
  { key: "ai_esborranys_auto", enabled: false, params: { min_score: 75, max_per_run: 20 } },
  { key: "ai_retencio", enabled: true, params: {} },
];
const offerData = (id: string, name: string, e: number[], p: Record<string, unknown> = {}) => ({ id, supplierId: `s-${id}`, supplierName: name, productId: `p-${id}`, productName: `Prod ${id}`, version: 1, energyType: "luz", accessTariff: "2.0TD", segments: ["residencial", "pyme"], contractType: "periodes", energy: [...e, null, null, null], energy24h: null, power: [0.1, 0.05, null, null, null, null], powerUnit: "eur_kw_dia", gasFixedEurDay: null, taxTreatment: "sense_impostos", sas: { mode: "inclos", eurKwh: null }, fees: [], discounts: [], permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: plus(200), source: `Tarifa ${name} (test)`, publishedAt: null, status: "activa", conditions: null, origin: "manual", ...p });

function seed() {
  const clients = [
    { id: "c1", name: "Forn SL", status: "actiu", owner_id: C1, commercial_opt_out: false, contact_preference: "qualsevol", province: "Lleida", tags: [], archived_at: null },
    { id: "c2", name: "Taller Perdut", status: "inactiu", owner_id: C1, commercial_opt_out: false, contact_preference: "telefon", province: "Lleida", tags: [], archived_at: null },
    { id: "c3", name: "No Molestar SL", status: "inactiu", owner_id: C1, commercial_opt_out: true, contact_preference: "cap", province: "Lleida", tags: [], archived_at: null },
  ];
  const sup = (id: string, client: string, p: Record<string, unknown> = {}) => ({ id, client_id: client, cups: `ES00314000000000${id.slice(-2).padStart(2, "0")}AB`, energy_type: "luz", access_tariff: "2.0TD", power_kw: [4.6, 4.6], annual_kwh: 3000, period_kwh: [1000, 800, 1200], province: "Lleida", current_retailer: "Endesa", address: "C/ Major 1", data_source: "sips", archived_at: null, ...p });
  return {
    crm_automation_rules: RULES,
    profiles: [{ id: A, name: "Direcció", email: "a@a30.com", role: "admin" }, { id: C1, name: "Comercial 1", email: "c1@a30.com", role: "comercial" }],
    crm_clients: clients,
    crm_supplies: [sup("s01", "c1"), sup("s02", "c1"), sup("s03", "c1", { access_tariff: null, power_kw: null })],
    crm_contracts: [
      { id: "k1", client_id: "c1", supply_id: "s01", retailer: "Endesa", product: "One", end_date: plus(50), start_date: "2025-12-20", status: "actiu", owner_id: C1, access_tariff: "2.0TD", expedient_id: null },
      { id: "k2", client_id: "c1", supply_id: "s02", retailer: "Endesa", product: "Cara", end_date: plus(300), start_date: "2026-01-01", status: "actiu", owner_id: C1, access_tariff: "2.0TD", expedient_id: null },
      { id: "k3", client_id: "c2", supply_id: null, retailer: "Naturgy", product: null, end_date: "2025-01-01", start_date: "2024-01-01", status: "finalitzat", owner_id: C1, access_tariff: null, expedient_id: null },
      { id: "k4", client_id: "c3", supply_id: null, retailer: "Naturgy", product: null, end_date: "2025-01-01", start_date: "2024-01-01", status: "finalitzat", owner_id: C1, access_tariff: null, expedient_id: null },
    ],
    crm_expedient_terms: [{ id: "t1", conditions: { price_type: "periodes", energy_eur_kwh: [0.24, 0.19, 0.14], power_eur_kw_day: [0.1, 0.05], power_unit: "eur_kw_dia", permanence_months: null }, captured_at: "2025-12-15T10:00:00Z" }],
    crm_expedients: [{ id: "e1", code: "EXP-2025-00007", contract_id: "k1", accepted_terms_id: "t1" }, { id: "e2", code: "EXP-2026-00001", contract_id: "k2", accepted_terms_id: "t2" }],
    comparisons: [],
    crm_opportunities: [{ id: "o1", client_id: "c1", title: "Gas Forn", stage: "proposta_enviada", proposal_sent_at: new Date(Date.now() - 12 * 86_400_000).toISOString(), last_activity_at: new Date(Date.now() - 12 * 86_400_000).toISOString(), owner_id: C1, service: "gas", supply_id: null, won_at: null, lost_reason: null }],
    crm_activities: [{ client_id: "c2", opportunity_id: null, at: "2024-06-01T10:00:00Z", type: "trucada" }],
    crm_leads: [],
    tariff_versions: [
      { id: "v1", product_id: "pA", version: 1, status: "activa", data: offerData("v1", "Nufri", [0.2, 0.15, 0.1]) },
      { id: "v2", product_id: "pB", version: 1, status: "activa", data: offerData("v2", "Iberdrola", [0.21, 0.16, 0.11], { sas: { mode: "variable", eurKwh: null } }) },
      { id: "v3", product_id: "pC", version: 1, status: "activa", data: offerData("v3", "Repsol", [0.215, 0.165, 0.115]) },
      { id: "v4", product_id: "pD", version: 1, status: "activa", data: offerData("v4", "Vella", [0.1, 0.1, 0.1], { validTo: plus(-5) }) },
    ],
    offers: [],
    fin_rules: [{ id: "r1", rule_key: "nufri_mwh", version: 1, name: "Nufri per MWh", layer: "proveidor", retailer: "Nufri", product: null, service: null, segment: null, beneficiary_id: null, kind: "per_mwh", value: 10, unit: "eur_mwh", tiers: null, conditions: {}, base_formula: null, base_validated: true, valid_from: "2026-01-01", valid_to: null, status: "aprovada", notes: null }],
  };
}
// les condicions de k2 provenen d'un altre expedient (més cares)
const withK2Terms = (s: ReturnType<typeof seed>) => ({ ...s, crm_expedient_terms: [...s.crm_expedient_terms, { id: "t2", conditions: { price_type: "periodes", energy_eur_kwh: [0.3, 0.25, 0.2], power_eur_kw_day: [0.12, 0.06], power_unit: "eur_kw_dia" }, captured_at: "2026-01-01T10:00:00Z" }] });

const userOf = (sb: ReturnType<typeof fakeSupabase>, id = C1, role = "comercial") => ({ sb, user: { id }, profile: { id, name: "Comercial 1", email: "c1@a30.com", role, code: "C1" } }) as never;

describe("Motor d'oportunitats (servidor) · 1, 2, 3, 8, 9, 15, 17 i 18", () => {
  beforeEach(() => { state.sb = fakeSupabase(withK2Terms(seed()), { crm_can_edit_client: () => true, ai_purge_expired: () => 0 }); });

  it("analitza la cartera i detecta oportunitats justificades amb fonts", async () => {
    const { runIntelligence } = await import("@/server/intelligence");
    const r = await runIntelligence("manual", { userId: A });
    expect(r).toMatchObject({ errors: 0 });
    const opps = state.sb.db.ai_opportunities;
    const kinds = opps.map((o) => o.kind).sort();
    expect(kinds).toEqual(["contracte_car", "dades_incompletes", "proposta_sense_resposta", "recuperacio", "renovacio", "tarifa_caducada", "venda_creuada"]);
    // renovació amb comparativa i preu actual conegut (condicions de l'expedient)
    const ren = opps.find((o) => o.kind === "renovacio")!;
    expect(ren).toMatchObject({ milestone: 60, saving_status: "estimat", owner_id: C1, data_quality: "complet" });
    const rec = state.sb.db.ai_recommendations.find((x) => x.opportunity_id === ren.id)!;
    expect((rec.alternatives as { supplier: string }[]).map((a) => a.supplier)).toEqual(["Nufri", "Iberdrola", "Repsol"]); // 3 alternatives per cost; la caducada, fora
    expect((rec.current_cost as { source: string }).source).toContain("EXP-2025-00007");
    expect(rec.tariff_snapshot_id).toBeTruthy();
    // l'oposició comercial es respecta: cap acció de recuperació per a c3
    expect(opps.some((o) => o.client_id === "c3")).toBe(false);
    // comissió estimada (capa proveïdor) i mai cobrada
    expect(state.sb.db.ai_opportunity_economics.find((e) => e.opportunity_id === ren.id && e.layer === "proveidor")).toMatchObject({ amount: "30.00", status: "estimat", collection_status: "no_meritat" });
    // tasques i avisos interns, sense cap enviament a clients
    expect(state.sb.db.crm_tasks.filter((t) => String(t.rule_key).startsWith("ai:renovacio"))).toHaveLength(1);
    expect(state.sb.db.crm_notifications.some((n) => n.rule_key === `ai:${ren.dedupe_key}:60`)).toBe(true);
    expect(state.sb.db.crm_notifications.filter((n) => String(n.rule_key).startsWith("ai:tarifa_caducada")).map((n) => n.user_id)).toEqual([A]);
    expect(state.sb.db.ai_analysis_runs[0]).toMatchObject({ status: "ok", trigger: "manual" });
    expect(state.sb.db.comparison_deliveries ?? []).toHaveLength(0);
  });

  it("idempotent: una segona execució no duplica oportunitats, tasques, avisos ni recomanacions", async () => {
    const { runIntelligence } = await import("@/server/intelligence");
    await runIntelligence("manual");
    const count = (t: string) => (state.sb.db[t] ?? []).length;
    const before = { o: count("ai_opportunities"), t: count("crm_tasks"), n: count("crm_notifications"), r: count("ai_recommendations"), e: count("ai_opportunity_economics") };
    const r2 = await runIntelligence("cron");
    expect(r2).toMatchObject({ stats: expect.objectContaining({ noves: 0 }) });
    expect({ o: count("ai_opportunities"), t: count("crm_tasks"), n: count("crm_notifications"), r: count("ai_recommendations"), e: count("ai_opportunity_economics") }).toEqual(before);
    expect(count("tariff_snapshots")).toBe(1); // mateix catàleg → mateixa instantània
  });

  it("una sola execució alhora; les oportunitats que ja no es detecten caduquen; les descartades no es reobren", async () => {
    const { runIntelligence } = await import("@/server/intelligence");
    state.sb.db.ai_analysis_runs = [{ id: "busy", status: "en_curs", started_at: new Date().toISOString(), attempts: 1 }];
    expect(await runIntelligence("manual")).toEqual({ skipped: "Ja hi ha una anàlisi en curs" });
    state.sb.db.ai_analysis_runs = [];
    await runIntelligence("manual");
    const cross = state.sb.db.ai_opportunities.find((o) => o.kind === "venda_creuada")!;
    cross.status = "descartada"; cross.status_reason = "No interessa";
    state.sb.db.crm_contracts.find((k) => k.id === "k1")!.status = "finalitzat"; // renovat/finalitzat
    await runIntelligence("manual");
    expect(state.sb.db.ai_opportunities.find((o) => o.kind === "renovacio")!.status).toBe("caducada");
    expect(cross.status).toBe("descartada");
  });

  it("el cron no s'executa si el motor està desactivat i s'atura després d'errors repetits", async () => {
    const { runIntelligence } = await import("@/server/intelligence");
    state.sb.db.crm_automation_rules.find((r) => r.key === "ai_motor")!.enabled = false;
    expect(await runIntelligence("cron")).toEqual({ skipped: "Motor desactivat" });
    state.sb.db.crm_automation_rules.find((r) => r.key === "ai_motor")!.enabled = true;
    state.sb.db.ai_analysis_runs = [{ id: "e", status: "error", attempts: 3, started_at: new Date().toISOString() }];
    expect(await runIntelligence("cron")).toEqual({ skipped: "Massa errors consecutius" });
  });
});

describe("Propostes i contractació (servidor) · 10, 11 i 16", () => {
  beforeEach(() => { state.sb = fakeSupabase(withK2Terms(seed()), { crm_can_edit_client: () => true, ai_purge_expired: () => 0 }); });

  it("prepara la proposta: comparativa desada, PDF a la fitxa del client com a esborrany i estat actualitzat", async () => {
    const { runIntelligence, prepareProposal } = await import("@/server/intelligence");
    await runIntelligence("manual");
    const ren = state.sb.db.ai_opportunities.find((o) => o.kind === "renovacio")!;
    const r = await prepareProposal(userOf(state.sb), ren.id as string);
    const doc = state.sb.db.crm_documents.find((d) => d.id === r.documentId)!;
    expect(doc).toMatchObject({ client_id: "c1", supply_id: "s01", category: "proposta", mime: "application/pdf" });
    expect(doc.title).toMatch(/ESBORRANY/);
    expect(state.sb.db.ai_proposal_drafts[0]).toMatchObject({ status: "esborrany", client_id: "c1", document_id: r.documentId, comparison_id: r.comparisonId });
    expect(state.sb.db.comparisons.find((c) => c.id === r.comparisonId)).toMatchObject({ crm_client_id: "c1", crm_supply_id: "s01", status: "esborrany" });
    expect(ren.status).toBe("proposta_preparada");
    expect(r.pdfInput.analysis.alternatives).toHaveLength(3);
  });

  it("no prepara propostes amb tarifes que han caducat des de l'anàlisi", async () => {
    const { runIntelligence, prepareProposal } = await import("@/server/intelligence");
    await runIntelligence("manual");
    const ren = state.sb.db.ai_opportunities.find((o) => o.kind === "renovacio")!;
    const rec = state.sb.db.ai_recommendations.find((x) => x.opportunity_id === ren.id)!;
    (rec.alternatives as { validTo: string }[])[0].validTo = "2020-01-01";
    await expect(prepareProposal(userOf(state.sb), ren.id as string)).rejects.toThrow(/caducades/);
  });

  it("acceptar crea UNA oportunitat comercial (o vincula l'oberta) sense duplicar client ni CUPS", async () => {
    const { runIntelligence, acceptOpportunity } = await import("@/server/intelligence");
    await runIntelligence("manual");
    const ren = state.sb.db.ai_opportunities.find((o) => o.kind === "renovacio")!;
    const a = await acceptOpportunity(userOf(state.sb), ren.id as string);
    expect(a.created).toBe(true);
    const b = await acceptOpportunity(userOf(state.sb), ren.id as string);
    expect(b).toEqual({ crmOpportunityId: a.crmOpportunityId, created: false });
    expect(state.sb.db.crm_opportunities.filter((o) => o.ai_opportunity_id === ren.id)).toHaveLength(1);
    expect(state.sb.db.crm_opportunities.find((o) => o.id === a.crmOpportunityId)).toMatchObject({ client_id: "c1", supply_id: "s01", stage: "estudi", service: "llum_empresa" });
    expect(state.sb.db.crm_clients).toHaveLength(3);
    expect(state.sb.db.crm_supplies).toHaveLength(3);
    // una oportunitat oberta existent per al mateix client, subministrament i servei es reutilitza
    const car = state.sb.db.ai_opportunities.find((o) => o.kind === "contracte_car")!;
    state.sb.db.crm_opportunities.push({ id: "o-open", client_id: "c1", supply_id: "s02", service: "llum_empresa", stage: "contactat", ai_opportunity_id: null });
    expect(await acceptOpportunity(userOf(state.sb), car.id as string)).toEqual({ crmOpportunityId: "o-open", created: false });
  });
});

describe("Copilot (servidor) · 12, 14 i 19", () => {
  beforeEach(() => { state.sb = fakeSupabase(withK2Terms(seed()), { crm_can_edit_client: () => true, ai_purge_expired: () => 0 }); });

  it("sense clau d'IA respon en mode regles, amb fonts, i registra l'ús i l'eina", async () => {
    const { copilotChat } = await import("@/server/copilot");
    const r = await copilotChat(userOf(state.sb), { message: "Quins contractes vencen els propers mesos? venciments del trimestre" });
    expect(r.mode).toBe("rules");
    expect(r.notice).toMatch(/clau d'IA/);
    expect(r.text).toMatch(/Endesa/);
    expect(r.sources[0].label).toMatch(/Contractes/);
    expect(state.sb.db.ai_usage).toHaveLength(1);
    expect(state.sb.db.ai_usage[0]).toMatchObject({ input_tokens: 0, output_tokens: 0, model: "regles" });
    expect(state.sb.db.ai_tool_executions[0]).toMatchObject({ tool: "contractes_que_vencen", status: "executada", sensitive: false });
  });

  it("accions sensibles: queden proposades; només s'executen amb el testimoni correcte i una sola vegada", async () => {
    const { runIntelligence } = await import("@/server/intelligence");
    await runIntelligence("manual");
    const ren = state.sb.db.ai_opportunities.find((o) => o.kind === "renovacio")!;
    const { copilotChat, confirmAction } = await import("@/server/copilot");
    const r = await copilotChat(userOf(state.sb), { message: "Prepara una proposta per a aquest client", context: { opportunityId: ren.id } });
    expect(r.pending).toHaveLength(1);
    expect(r.text).toMatch(/PROPOSADA/);
    expect(state.sb.db.ai_proposal_drafts ?? []).toHaveLength(0); // encara no s'ha fet res
    const exec = state.sb.db.ai_tool_executions.find((x) => x.id === r.pending[0].id)!;
    expect(exec.status).toBe("proposada");
    expect(exec.confirm_hash).not.toBe(r.pending[0].token); // només es desa el hash
    await expect(confirmAction(userOf(state.sb), { id: r.pending[0].id, token: "x".repeat(32), decision: "confirmar" })).rejects.toThrow(/no vàlida/);
    await expect(confirmAction(userOf(state.sb, "00000000-0000-0000-0000-0000000000c2"), { id: r.pending[0].id, token: r.pending[0].token, decision: "confirmar" })).rejects.toThrow(/no trobada/);
    const ok = await confirmAction(userOf(state.sb), { id: r.pending[0].id, token: r.pending[0].token, decision: "confirmar" });
    expect(ok.status).toBe("executada");
    expect(state.sb.db.ai_proposal_drafts).toHaveLength(1);
    await expect(confirmAction(userOf(state.sb), { id: r.pending[0].id, token: r.pending[0].token, decision: "confirmar" })).rejects.toThrow(/ja s'ha resolt/);
  });

  it("control de costos: límit per minut (429) i pressupost esgotat → mode regles", async () => {
    const { copilotChat } = await import("@/server/copilot");
    const now = new Date().toISOString();
    state.sb.db.ai_usage = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, user_id: C1, kind: "copilot", input_tokens: 0, output_tokens: 0, cost_eur: 0, created_at: now }));
    await expect(copilotChat(userOf(state.sb), { message: "Quins contractes vencen aquest mes?" })).rejects.toThrow(/Massa consultes/);
    state.sb.db.ai_usage = [{ id: 1, user_id: "altre", kind: "copilot", input_tokens: 10, output_tokens: 10, cost_eur: 31, created_at: new Date(Date.now() - 3600_000).toISOString() }];
    const r = await copilotChat(userOf(state.sb), { message: "Quins contractes vencen aquest mes?" });
    expect(r.mode).toBe("rules");
    expect(r.notice).toMatch(/pressupost mensual/);
  });
});
