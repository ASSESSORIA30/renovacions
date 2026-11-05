/**
 * Fase 8.2 · Reclamacions a comercialitzadores.
 * Lògica pura (detecció, hipòtesis, regularitzacions, correu i PDF) i servidor amb un Supabase en memòria
 * (permisos, duplicats, només reclamables, enviament amb confirmació, assignació i notificacions).
 * La RLS i els disparadors reals es proven a tests/db/reclamacions-rls.test.ts. Dades totalment fictícies.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";
import { buildClaimEmail, claimKpis, detectDiscrepancies, explainDiscrepancy, keyForLine, keyForPending, matchRegularizations, type ContractIn, type DetectInput, type LineIn, type RuleLite } from "@/core/claims";
import { buildClaimPdf } from "@/core/claim-pdf";

/* ================================================================== dades: Iberdrola liquida 200 contractes en un mes */
const RULE: RuleLite = { id: "r-ib", rule_key: "ib_3td", version: 2, name: "Iberdrola 3.0TD · €/MWh", status: "aprovada", kind: "per_mwh", value: 10, unit: "eur_mwh", product: null, retailer: "Iberdrola", conditions: { accrual_event: "activacio", tariff: "3.0TD", source: { document: "Contracte d'agència 2026", version: 1, page: 4, excerpt: "Comisión de 10 €/MWh para peaje 3.0TD" } }, valid_from: "2026-01-01", valid_to: null };
const RULE_20: RuleLite = { ...RULE, id: "r-ib20", rule_key: "ib_20td", name: "Iberdrola 2.0TD · €/MWh", value: 6, conditions: { accrual_event: "activacio", tariff: "2.0TD", source: { document: "Contracte d'agència 2026", page: 4, excerpt: "6 €/MWh 2.0TD" } } };
const RULE_SIM: RuleLite = { ...RULE, id: "r-sim", status: "pendent_aprovacio" };
const cid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const contract = (i: number, extra: Partial<ContractIn> = {}): ContractIn => ({
  id: cid(i), client_id: `cl-${i}`, client_name: `EMPRESA FICTÍCIA ${i} SL`, retailer: "Iberdrola", product: "Plan Empresa", status: "actiu", cups: `ES00000000000${String(i).padStart(5, "0")}AB`,
  activated_at: "2026-09-10", econ_status: "actiu", cancelled_at: null, tariff: "3.0TD", eligible_mwh: 20, annual_kwh: 20000, province: "Lleida",
  calc: { amount: "200.00", status: "calculat", rule_id: "r-ib", rule_key: "ib_3td", rule_version: 2 }, ...extra,
});
const line = (i: number, amount: string, extra: Partial<LineIn> = {}): LineIn => ({
  id: `l-${i}`, statement_id: "st-1", reference: "IB-2026-09", received_at: "2026-10-05", period_from: "2026-09-01", period_to: "2026-09-30", line_no: i,
  cups: contract(i).cups, external_ref: `EXT-${i}`, contract_ref: `IB${i}`, client_name: null, concept: "Comisión alta", amount, kind: "comissio", match_status: "identificat", contract_id: cid(i), expected_amount: "200.00", ...extra,
});
function scenario(over: Partial<DetectInput> = {}): DetectInput {
  const contracts: ContractIn[] = [], lines: LineIn[] = [];
  for (let i = 1; i <= 175; i++) { contracts.push(contract(i)); lines.push(line(i, "200.00")); }                // correctes
  for (let i = 176; i <= 190; i++) { contracts.push(contract(i)); lines.push(line(i, "120.00")); }              // 15 per sota (−80 €)
  for (let i = 191; i <= 197; i++) contracts.push(contract(i, { activated_at: "2026-08-01" }));                  // 7 pendents (activats a l'agost)
  for (let i = 198; i <= 200; i++) { contracts.push(contract(i, { activated_at: "2026-01-15", cancelled_at: "2026-09-20", econ_status: "anullat" })); lines.push(line(i, "-200.00", { kind: "retrocessio", concept: "Baja anticipada" })); }
  return {
    retailer: "Iberdrola", from: "2026-08-01", to: "2026-09-30", today: "2026-11-02", lines, contracts,
    settledContracts: new Set(lines.filter((l) => l.kind === "comissio").map((l) => l.contract_id!)), rules: new Map([[RULE.id, RULE], [RULE_20.id, RULE_20], [RULE_SIM.id, RULE_SIM]]),
    terms: { paymentDays: 60, claimDays: null }, clawRules: [{ id: "cw", name: "Baixa anticipada", version: 1, trigger: "baixa_anticipada", risk_months: 6, start_event: "activacio", mode: "total", pct: null, penalty_eur: null, formula: null, valid_from: "2026-01-01", valid_to: null, product: null, status: "aprovada" }],
    claimed: new Map(), ...over,
  };
}

describe("detectDiscrepancies · exemple Iberdrola (200 contractes)", () => {
  it("175 correctes, 15 per sota, 7 pendents i 3 retrocessions a revisar", () => {
    const rows = detectDiscrepancies(scenario());
    const n = (k: string) => rows.filter((r) => r.kind === k).length;
    expect(n("correcte")).toBe(175);
    expect(n("inferior")).toBe(15);
    expect(n("pendent_liquidacio")).toBe(7);
    expect(n("retrocessio")).toBe(3);
  });
  it("les diferències es calculen amb precisió (cèntims, sense coma flotant)", () => {
    const rows = detectDiscrepancies(scenario({ lines: [line(1, "199.99")], contracts: [contract(1, { calc: { amount: "200.10", status: "calculat", rule_id: "r-ib", rule_key: "ib_3td", rule_version: 2 } })], settledContracts: new Set([cid(1)]) }));
    expect(rows[0]).toMatchObject({ kind: "inferior", expected: "200.10", settled: "199.99", difference: "-0.11", eligibility: "revisio" });   // per sota del mínim d'1 €
    const r2 = detectDiscrepancies(scenario({ lines: [line(1, "0.10")], contracts: [contract(1, { calc: { amount: "0.30", status: "calculat", rule_id: "r-ib", rule_key: "ib_3td", rule_version: 2 } })], settledContracts: new Set([cid(1)]), minEur: "0.01" }));
    expect(r2[0]).toMatchObject({ difference: "-0.20", claimable: "0.20" });
  });
  it("els 15 per sota són reclamables per 80 € cadascun, amb la referència contractual", () => {
    const rows = detectDiscrepancies(scenario()).filter((r) => r.kind === "inferior");
    expect(rows.every((r) => r.eligibility === "reclamable" && r.claimable === "80.00" && r.selectable)).toBe(true);
    expect(rows[0].ruleRef).toMatchObject({ document: "Contracte d'agència 2026", page: 4, excerpt: "Comisión de 10 €/MWh para peaje 3.0TD" });
  });
  it("els pendents només són reclamables si ha vençut el termini de pagament aprovat", () => {
    const vencut = detectDiscrepancies(scenario()).filter((r) => r.kind === "pendent_liquidacio");
    expect(vencut.every((r) => r.eligibility === "reclamable" && r.claimable === "200.00")).toBe(true);           // 1 d'agost + 60 dies < 2 de novembre
    const dins = detectDiscrepancies(scenario({ today: "2026-09-20" })).filter((r) => r.kind === "pendent_liquidacio");
    expect(dins.every((r) => r.eligibility === "no_reclamable" && r.claimable === "0.00" && /termini de pagament/.test(r.reason))).toBe(true);
    const sense = detectDiscrepancies(scenario({ terms: { paymentDays: null, claimDays: null } })).filter((r) => r.kind === "pendent_liquidacio");
    expect(sense.every((r) => r.eligibility === "revisio" && !r.selectable)).toBe(true);
  });
  it("excepcions: contracte anul·lat, meritació no automàtica o excepcions a la regla → no es reclamen automàticament", () => {
    const anul = detectDiscrepancies(scenario({ contracts: [contract(191, { activated_at: "2026-08-01", econ_status: "anullat", cancelled_at: "2026-08-20" })], lines: [] }));
    expect(anul[0]).toMatchObject({ eligibility: "no_reclamable", claimable: "0.00" });
    const cobr = { ...RULE, conditions: { ...RULE.conditions, accrual_event: "cobrament_client" } };
    const r = detectDiscrepancies(scenario({ rules: new Map([[RULE.id, cobr]]), contracts: [contract(176)], lines: [line(176, "120.00")] }));
    expect(r[0]).toMatchObject({ kind: "inferior", eligibility: "revisio", claimable: "0.00" });
    const exc = { ...RULE, conditions: { ...RULE.conditions, exceptions: "No es meriten els contractes amb impagaments" } };
    expect(detectDiscrepancies(scenario({ rules: new Map([[RULE.id, exc]]), contracts: [contract(176)], lines: [line(176, "120.00")] }))[0].eligibility).toBe("revisio");
  });
  it("sense regla aprovada (simulació) no es reclama", () => {
    const r = detectDiscrepancies(scenario({ contracts: [contract(1, { calc: { amount: "200.00", status: "simulacio", rule_id: "r-sim", rule_key: "x", rule_version: 1 } })], lines: [line(1, "100.00")] }));
    expect(r[0]).toMatchObject({ kind: "sense_regla", eligibility: "revisio", claimable: "0.00" });
  });
  it("retrocessions: dins del període de risc són conformes; fora, reclamables", () => {
    const dins = detectDiscrepancies(scenario({ contracts: [contract(198, { activated_at: "2026-06-01", cancelled_at: "2026-09-20", econ_status: "anullat" })], lines: [line(198, "-200.00", { kind: "retrocessio", concept: "Baja anticipada" })] }));
    expect(dins[0]).toMatchObject({ kind: "retrocessio", eligibility: "no_reclamable" });
    const fora = detectDiscrepancies(scenario()).filter((r) => r.kind === "retrocessio");
    expect(fora.every((r) => r.eligibility === "reclamable" && r.claimable === "200.00" && /fora del període de risc/.test(r.reason))).toBe(true);
  });
  it("duplicats, no identificats i línies ja reclamades no són seleccionables", () => {
    const claimed = new Map([[keyForLine("l-176"), { claim_id: "c1", code: "REC-2026-0001", status: "pendent_resposta" as const, item_status: "reclamada" }]]);
    const rows = detectDiscrepancies(scenario({ claimed, lines: [...scenario().lines, line(500, "50.00", { match_status: "duplicat" }), line(501, "50.00", { match_status: "no_identificat", contract_id: null })] }));
    expect(rows.find((r) => r.key === "line:l-500")).toMatchObject({ kind: "duplicat", selectable: false });
    expect(rows.find((r) => r.key === "line:l-501")).toMatchObject({ kind: "no_identificat", selectable: false });
    expect(rows.find((r) => r.key === "line:l-176")).toMatchObject({ status: "reclamada", selectable: false, claim: { code: "REC-2026-0001" } });
  });
  it("indicadors del panell", () => {
    const rows = detectDiscrepancies(scenario());
    const k = claimKpis(rows, [{ status: "pendent_resposta", total_claimed: "500.00", total_recognized: "0", total_recovered: "120.00", items_count: 3 }, { status: "resolta", total_claimed: "100.00", total_recognized: "100", total_recovered: "100.00", items_count: 1 }]);
    expect(k).toMatchObject({ claimable: "3200.00", claimed: "600.00", recovered: "220.00", awaiting: "380.00", contracts: 25, open: 1, resolved: 1 });   // 15×80 + 7×200 + 3×200
  });
});

describe("explainDiscrepancy · hipòtesis, mai fets", () => {
  const row = (settled: string) => ({ kind: "inferior" as const, expected: "200.00", settled, difference: "x", lineId: "l" });
  it("MWh comissionables diferents", () => {
    const r = explainDiscrepancy({ row: row("150.00"), rule: RULE, otherRules: [], contract: contract(1), line: null, clawRules: [] });
    expect(r.top.code).toBe("mwh");
    expect(r.top.detail).toMatch(/15,000 MWh/);
  });
  it("tarifa aplicada incorrectament (l'import coincideix amb la regla d'un altre peatge)", () => {
    const r = explainDiscrepancy({ row: row("120.00"), rule: RULE, otherRules: [RULE, RULE_20], contract: contract(1), line: null, clawRules: [] });
    expect(r.hypotheses.map((h) => h.code)).toContain("tarifa");
    expect(r.top.code).toBe("tarifa");
    expect(r.top.refs.some((x) => x.excerpt === "6 €/MWh 2.0TD")).toBe(true);
  });
  it("activació fora del període i regularització pel concepte", () => {
    const r = explainDiscrepancy({ row: row("200.00"), rule: RULE, otherRules: [], contract: contract(1, { activated_at: "2026-07-02", eligible_mwh: 20 }), line: { concept: "Regularización julio", received_at: "2026-10-05", period_from: "2026-09-01", period_to: "2026-09-30", kind: "comissio" }, clawRules: [] });
    expect(r.hypotheses.map((h) => h.code)).toEqual(expect.arrayContaining(["activacio", "regularitzacio"]));
  });
  it("sense prou informació → «Motiu pendent de revisió»", () => {
    const r = explainDiscrepancy({ row: row("180.00"), rule: { ...RULE, kind: "fix_contracte", value: 200 }, otherRules: [], contract: contract(1, { eligible_mwh: null, annual_kwh: null }), line: null, clawRules: [] });
    expect(r.needsReview).toBe(true);
    expect(r.top.label).toBe("Motiu pendent de revisió");
  });
});

describe("matchRegularizations", () => {
  const items = [
    { id: "i1", claim_id: "c1", claim_status: "pendent_resposta" as const, item_key: keyForLine("l-176"), kind: "infraliquidacio" as const, contract_id: cid(176), cups: contract(176).cups, claimed_amount: "80.00", recovered_amount: "0.00" },
    { id: "i2", claim_id: "c1", claim_status: "pendent_resposta" as const, item_key: keyForPending(cid(191)), kind: "pendent_liquidacio" as const, contract_id: cid(191), cups: contract(191).cups, claimed_amount: "200.00", recovered_amount: "0.00" },
    { id: "i3", claim_id: "c2", claim_status: "esborrany" as const, item_key: "x", kind: "infraliquidacio" as const, contract_id: cid(177), cups: null, claimed_amount: "80.00", recovered_amount: "0.00" },
  ];
  it("proposa regularitzacions per contracte, import i concepte; ignora esborranys i línies normals", () => {
    const p = matchRegularizations([
      { id: "n1", contract_id: cid(176), cups: null, amount: "80.00", kind: "regularitzacio", concept: "Regularización comisión septiembre", match_status: "identificat" },
      { id: "n2", contract_id: cid(191), cups: null, amount: "200.00", kind: "comissio", concept: "Comisión alta", match_status: "identificat" },
      { id: "n3", contract_id: cid(177), cups: null, amount: "80.00", kind: "regularitzacio", concept: "Regularización", match_status: "identificat" },
      { id: "n4", contract_id: cid(176), cups: null, amount: "33.00", kind: "comissio", concept: "Comisión renovación", match_status: "identificat" },
    ], items);
    expect(p.map((x) => [x.statement_line_id, x.item_id])).toEqual([["n1", "i1"], ["n2", "i2"]]);
    expect(p[0].confidence).toBeGreaterThan(0.9);
  });
});

describe("correu i PDF", () => {
  it("l'esborrany de correu inclou assumpte, total, motius i signatura corporativa (castellà i català)", () => {
    const e = buildClaimEmail({ lang: "es", code: "REC-2026-0007", retailer: "Iberdrola", contactName: "Dpto. Liquidaciones", periodFrom: "2026-09-01", periodTo: "2026-09-30", total: "3200.00", count: 25, byReason: [{ label: "Comisión inferior a la pactada", count: 15, amount: "1200.00" }], senderName: "Usuària Demo", senderEmail: "admin@exemple.test", responseDays: 30 });
    expect(e.subject).toMatch(/Iberdrola.*REC-2026-0007/);
    expect(e.body).toMatch(/3\.?200,00\s€/);
    expect(e.body).toMatch(/Estimado\/a Dpto\. Liquidaciones/);
    expect(e.body).toMatch(/Assessoria 3\.0 · Departamento de Administración/);
    expect(e.body).toMatch(/REC-2026-0007/);
    const ca = buildClaimEmail({ lang: "ca", code: "REC-1", retailer: "Nufri", contactName: null, periodFrom: "2026-09-01", periodTo: "2026-09-30", total: "10", count: 1, byReason: [], senderName: "X", senderEmail: null, responseDays: 15 });
    expect(ca.body).toMatch(/^Bon dia,/);
    expect(ca.body).toMatch(/15 dies/);
  });
  it("el PDF es genera (logotip, contractes, total i referències) i és un PDF vàlid", () => {
    const pdf = buildClaimPdf({ lang: "es", code: "REC-2026-0007", retailer: "Iberdrola", periodFrom: "2026-09-01", periodTo: "2026-09-30", generatedAt: new Date("2026-11-02T10:00:00Z"), generatedBy: "Usuària Demo", draft: false,
      items: Array.from({ length: 40 }, (_, i) => ({ kind: "infraliquidacio" as const, client: `EMPRESA FICTÍCIA ${i} SL`, cups: `ES00000000000${String(i).padStart(5, "0")}AB`, reference: `EXT-${i}`, contractRef: null, expected: "200.00", settled: "120.00", claimed: "80.00", reason: "Liquidat 120,00 € quan la regla en preveu 200,00 €", ruleRef: { label: "Regla «Iberdrola 3.0TD» v2 · Contracte d'agència 2026, pàg. 4", excerpt: "Comisión de 10 €/MWh" } })), total: "3200.00" });
    const txt = Buffer.from(pdf).toString("latin1");
    expect(txt.startsWith("%PDF-")).toBe(true);
    expect(pdf.byteLength).toBeGreaterThan(20_000);
    expect(txt).toContain("REC-2026-0007");
    expect(txt).toMatch(/\/Type \/Page\b/);
    expect((txt.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/* ================================================================== servidor */
vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
const sent: unknown[] = [];
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => null };
});
vi.mock("@/server/comms", () => ({ sendFromMyMailbox: async (_u: unknown, m: unknown) => { sent.push(m); return { accepted: true, messageId: "<id@test>", from: "admin@exemple.test", error: null }; } }));

const ADMIN = "00000000-0000-4000-8000-0000000000ad", ADM2 = "00000000-0000-4000-8000-0000000000b2", COM = "00000000-0000-4000-8000-0000000000c1";
function user(id: string, role: string, perms: { module: string; can_read: boolean; can_edit: boolean; can_approve: boolean }[] = []) {
  const sb = { ...state.sb, rpc: async (name: string, args: unknown) => (name === "my_permissions" ? { data: perms, error: null } : state.sb.rpc(name, args)) };
  return { sb, user: { id }, profile: { id, name: role, email: `${role}@exemple.test`, role, code: null } } as never;
}
function seedDb() {
  const s = scenario();
  const statements = [{ id: "00000000-0000-4000-8000-00000000057a", retailer: "Iberdrola", reference: "IB-2026-09", received_at: "2026-10-05", period_from: "2026-09-01", period_to: "2026-09-30" }];
  return {
    profiles: [{ id: ADMIN, name: "Direcció", role: "admin" }, { id: ADM2, name: "Administrativa", role: "administrativa" }, { id: COM, name: "Comercial", role: "comercial" }],
    fin_provider_statements: statements,
    fin_statement_lines: s.lines.map((l) => ({ ...l, statement_id: statements[0].id })),
    crm_contracts: s.contracts.map((k) => ({ id: k.id, client_id: k.client_id, supply_id: null, retailer: "Iberdrola", product: k.product, status: k.status, start_date: k.activated_at, signed_at: null, access_tariff: k.tariff, expedient_id: null })),
    crm_clients: s.contracts.map((k) => ({ id: k.client_id, name: k.client_name })),
    fin_contract_economics: s.contracts.map((k) => ({ contract_id: k.id, econ_status: k.econ_status, cancelled_at: k.cancelled_at, eligible_mwh: k.eligible_mwh })),
    fin_calculations: s.contracts.map((k) => ({ contract_id: k.id, layer: "proveidor", is_current: true, ...k.calc })),
    fin_rules: [{ ...RULE, layer: "proveidor" }],
    retailers: [{ id: "00000000-0000-4000-8000-0000000000e1", trade_name: "Iberdrola", aliases: [], legal_name: "Iberdrola Clientes SAU" }],
    retailer_terms: [{ retailer_id: "00000000-0000-4000-8000-0000000000e1", review_status: "aprovada", field: "termini_pagament", value: 60, unit: "dies", page: 7, excerpt: "Se abonarán en 60 días", valid_from: "2026-01-01", valid_to: null, retailer_documents: { title: "Contracte d'agència 2026", version: 1 } }],
    retailer_clawback_rules: s.clawRules.map((c) => ({ ...c, retailer_id: "00000000-0000-4000-8000-0000000000e1" })),
    retailer_contacts: [{ id: "00000000-0000-4000-8000-0000000000f1", retailer_id: "00000000-0000-4000-8000-0000000000e1", name: "Dpto. Liquidaciones", email: "liquidaciones@exemple.test", role: "liquidacions", is_default: true }],
    fin_claims: [], fin_claim_items: [], fin_claim_events: [], crm_notifications: [],
  };
}
const claims = () => import("@/server/claims");
const Q = { retailer: "Iberdrola", from: "2026-08-01", to: "2026-09-30" };

describe("servidor · reclamacions", () => {
  beforeEach(() => { state.sb = fakeSupabase(seedDb() as never); sent.length = 0; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-02T10:00:00Z")); });

  it("permisos: comercial i administrativa sense «economia» no hi accedeixen; Direcció sí", async () => {
    const c = await claims();
    await expect(c.claimsOverview(user(COM, "comercial"), Q)).rejects.toMatchObject({ status: 403 });
    const adm = await c.claimsOverview(user(ADM2, "administrativa"), Q);                    // sense permís: només «les meves» (cap)
    expect(adm).toMatchObject({ scope: "assignee", rows: [], kpis: null });
    const o = await c.claimsOverview(user(ADMIN, "admin"), Q);
    expect(o.rows.filter((r) => r.selectable)).toHaveLength(25);
    expect(o.kpis).toMatchObject({ claimable: "3200.00", contracts: 25 });
    expect(o.terms).toMatchObject({ paymentDays: 60 });
  });

  it("crea una reclamació només amb diferències reclamables; rebutja duplicats i no reclamables", async () => {
    const c = await claims();
    const o = await c.claimsOverview(user(ADMIN, "admin"), Q);
    const keys = o.rows.filter((r) => r.selectable).map((r) => r.key);
    const correct = o.rows.find((r) => r.kind === "correcte")!.key;
    await expect(c.createClaim(user(ADMIN, "admin"), { ...Q, keys: [...keys.slice(0, 2), correct] })).rejects.toMatchObject({ status: 400 });
    const r = await c.createClaim(user(ADMIN, "admin"), { ...Q, keys, assignedTo: ADM2, lang: "es" });
    expect(r.items).toBe(25);
    const items = state.sb.db.fin_claim_items as { claimed_amount: string; rule_ref: { excerpt?: string } | null; kind: string }[];
    expect(items.reduce((s, i) => s + Number(i.claimed_amount), 0)).toBe(3200);
    expect(items.filter((i) => i.kind === "infraliquidacio")[0].rule_ref?.excerpt).toMatch(/10 €\/MWh/);
    const claim = (state.sb.db.fin_claims as { contact_email: string; email_subject: string; email_body: string; assigned_to: string }[])[0];
    expect(claim).toMatchObject({ contact_email: "liquidaciones@exemple.test", assigned_to: ADM2 });
    expect(claim.email_body).toMatch(/3\.?200,00\s€/);
    // la persona assignada rep la notificació a la campaneta
    expect((state.sb.db.crm_notifications as { user_id: string; link: { view: string } }[]).find((n) => n.user_id === ADM2)).toMatchObject({ link: { view: "reclamacions" } });
    // segona reclamació amb les mateixes diferències → no (ja són en una reclamació)
    (state.sb.db.fin_claim_items as { active: boolean; status: string }[]).forEach((i) => { i.active = true; i.status = "reclamada"; });
    await expect(c.createClaim(user(ADMIN, "admin"), { ...Q, keys: keys.slice(0, 1) })).rejects.toMatchObject({ status: 409 });
  });

  it("no es pot assignar a un comercial", async () => {
    const c = await claims();
    const keys = (await c.claimsOverview(user(ADMIN, "admin"), Q)).rows.filter((r) => r.selectable).map((r) => r.key);
    await expect(c.createClaim(user(ADMIN, "admin"), { ...Q, keys, assignedTo: COM })).rejects.toMatchObject({ status: 400 });
  });

  it("enviament: exigeix confirmació, adjunta el PDF i deixa la reclamació pendent de resposta; la persona assignada hi accedeix", async () => {
    const c = await claims();
    const keys = (await c.claimsOverview(user(ADMIN, "admin"), Q)).rows.filter((r) => r.selectable).map((r) => r.key);
    const { id } = await c.createClaim(user(ADMIN, "admin"), { ...Q, keys, assignedTo: ADM2 });
    (state.sb.db.fin_claims as { id: string; items_count: number; code: string }[])[0].items_count = 25;        // (ho fa el disparador real)
    Object.assign((state.sb.db.fin_claims as object[])[0], { code: "REC-2026-0001", status: "esborrany" });   // (valors per defecte i codi: base de dades real)
    await expect(c.sendClaim(user(ADMIN, "admin"), id, { to: "liquidaciones@exemple.test", subject: "Reclamación", body: "x".repeat(30) })).rejects.toMatchObject({ status: 400 });
    expect(sent).toHaveLength(0);
    const ass = user(ADM2, "administrativa");                                                                 // assignada, sense permís global
    const det = await c.getClaim(ass, id);
    expect(det.permissions.role).toBe("assignee");
    // Fase 14: cap enviament sense revisió i autorització, i s'envia exactament el correu autoritzat
    Object.assign((state.sb.db.fin_claims as object[])[0], { authorized_at: null, contact_email: "liquidaciones@exemple.test", email_subject: "Reclamación de comisiones", email_body: "Cuerpo del correo de reclamación." });
    const mail = { confirm: true, to: "liquidaciones@exemple.test", subject: "Reclamación de comisiones", body: "Cuerpo del correo de reclamación." };
    await expect(c.sendClaim(ass, id, mail)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/autoritz/) });
    await expect(c.authorizeClaim(ass, id, { authorize: true })).rejects.toMatchObject({ status: 403 });       // sense permís d'economia
    await c.authorizeClaim(user(ADMIN, "admin"), id, { authorize: true, note: "Revisada" });
    expect((state.sb.db.fin_claims as { authorized_at: string | null }[])[0].authorized_at).toBeTruthy();
    await expect(c.sendClaim(ass, id, { ...mail, body: "Un altre text diferent de l'autoritzat." })).rejects.toMatchObject({ status: 409 });
    expect(sent).toHaveLength(0);
    const r = await c.sendClaim(ass, id, mail);
    expect(r.ok).toBe(true);
    const m = sent[0] as { attachments: { filename: string; content: Buffer }[] };
    expect(m.attachments[0].filename).toMatch(/^REC-2026-0001_Iberdrola\.pdf$/);
    expect(m.attachments[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    expect((state.sb.db.fin_claims as { status: string }[])[0].status).toBe("pendent_resposta");
    expect((state.sb.db.fin_claim_events as { kind: string }[]).some((e) => e.kind === "enviament")).toBe(true);
    // un comercial no hi accedeix encara que en conegui l'identificador
    await expect(c.getClaim(user(COM, "comercial"), id)).rejects.toMatchObject({ status: 403 });
  });

  it("una liquidació nova amb una regularització genera una proposta per revisar i avisa", async () => {
    const c = await claims();
    const keys = (await c.claimsOverview(user(ADMIN, "admin"), Q)).rows.filter((r) => r.selectable).map((r) => r.key);
    const { id } = await c.createClaim(user(ADMIN, "admin"), { ...Q, keys, assignedTo: ADM2 });
    (state.sb.db.fin_claims as { status: string }[])[0].status = "pendent_resposta";
    (state.sb.db.fin_claim_items as { status: string; recovered_amount: string }[]).forEach((i) => { i.status = "reclamada"; i.recovered_amount = "0.00"; });
    state.sb.db.fin_provider_statements.push({ id: "00000000-0000-4000-8000-00000000057b", retailer: "Iberdrola", reference: "IB-2026-10", received_at: "2026-11-01" });
    state.sb.db.fin_statement_lines.push({ id: "00000000-0000-4000-8000-0000000a0001", statement_id: "00000000-0000-4000-8000-00000000057b", contract_id: cid(176), cups: null, amount: "80.00", kind: "regularitzacio", concept: "Regularización septiembre", match_status: "identificat" });
    const r = await c.proposeRegularizations(user(ADMIN, "admin"), "00000000-0000-4000-8000-00000000057b");
    expect(r.proposals).toBe(1);
    expect((state.sb.db.fin_claim_links as { claim_id: string; status: string }[])[0]).toMatchObject({ claim_id: id, status: "proposada" });
    expect((state.sb.db.crm_notifications as { user_id: string; title: string }[]).some((n) => n.user_id === ADM2 && /regularització/.test(n.title))).toBe(true);
  });

  it("avisos automàtics: recordatoris vençuts i reclamacions sense resposta", async () => {
    const c = await claims();
    state.sb.db.fin_claims.push({ id: "00000000-0000-4000-8000-00000000c1a1", code: "REC-2026-0009", retailer: "Iberdrola", status: "pendent_resposta", sent_at: "2026-09-01T10:00:00Z", response_due: "2026-10-01", assigned_to: ADM2, total_claimed: "80.00" });
    state.sb.db.fin_claim_reminders = [{ id: "00000000-0000-4000-8000-0000000e0001", claim_id: "00000000-0000-4000-8000-00000000c1a1", user_id: ADM2, note: "Trucar", remind_at: "2026-11-01T08:00:00Z", done_at: null, notified_at: null }];
    const notes = await c.claimsAutomations(state.sb as never, new Date("2026-11-02T05:00:00Z"), [{ key: "reclamacio_recordatori", enabled: true, params: {} }, { key: "reclamacio_sense_resposta", enabled: true, params: { days: 30 } }]);
    expect(notes.map((n) => n.rule_key)).toEqual(expect.arrayContaining(["rec_rem:00000000-0000-4000-8000-0000000e0001", "rec_late:00000000-0000-4000-8000-00000000c1a1:2026-10-01"]));
    expect((state.sb.db.fin_claim_reminders as { notified_at: string | null }[])[0].notified_at).not.toBeNull();
  });
});
