/**
 * Fase 14 · AUDITOR DE COMISSIONS (lògica pura): conciliació de doble sentit, quatre estats separats i set alertes.
 * Dades fictícies (CUPS inventats).
 */
import { describe, expect, it } from "vitest";
import { allocateNetReceipt, auditCommissions, type AuditContract, type AuditInput, type AuditLine } from "@/core/commission-audit";
import type { RuleLite } from "@/core/claims";

const TODAY = "2026-11-03";
const rule = (id: string, value: number, extra: Partial<RuleLite> = {}): RuleLite => ({ id, rule_key: `gana_${id}`, version: 1, name: `Gana ${id}`, status: "aprovada", kind: "fix_contracte", value, unit: "eur", product: null, retailer: "Gana Energía", conditions: {}, valid_from: "2025-01-01", valid_to: null, layer: "proveidor", ...extra });
const K = (id: string, activated: string, amount: number | null, extra: Partial<AuditContract> = {}): AuditContract => ({
  id, client_id: `c-${id}`, client_name: `Client ${id}`, retailer: "Gana Energía", product: "Tarifa 24 horas", status: "actiu", cups: `ES00310000000000${id.padStart(2, "0")}AA`,
  activated_at: activated, econ_status: "actiu", cancelled_at: null, is_renewal: false, deferred_until: null, deferral_reason: null,
  calc: amount == null ? null : { amount: amount.toFixed(2), status: "calculat", rule_id: amount === 40 ? "r40" : "r100", rule_key: "gana", rule_version: 1 }, ...extra,
});
let n = 0;
const L = (contract: string | null, amount: string, received: string, extra: Partial<AuditLine> = {}): AuditLine => ({
  id: `l${++n}`, statement_id: "s1", reference: "GANA-2026-10", received_at: received, period_from: null, period_to: null, line_no: n, cups: null, external_ref: null, contract_ref: null, client_name: null, concept: "Alta llum · Altas LUZ",
  amount, kind: Number(amount) < 0 ? "retrocessio" : "comissio", match_status: contract ? "conciliat" : "no_identificat", contract_id: contract, expected_amount: null,
  movement: "alta", event_date: null, source_sheet: "Altas LUZ", source_row: n + 1, file_name: "75368.xlsx", match_confidence: contract ? "inequivoca" : "cap", match_reason: null, candidates: 0, collected: "0.00", compensated: "0.00", ...extra,
});

const contracts = [
  K("1", "2026-06-01", 100),                                              // liquidada i cobrada
  K("2", "2026-05-01", 100),                                              // no liquidada, termini vençut
  K("3", "2026-10-20", 100),                                              // encara dins del termini
  K("4", "2026-04-01", 100, { deferred_until: "2027-01-31", deferral_reason: "Clàusula 7.2: pagament al tancament de campanya" }),
  K("5", "2026-06-15", 100),                                              // liquidada per sota
  K("6", "2026-07-01", 40, { is_renewal: true }),                         // renovació cobrada parcialment
  K("7", "2026-06-20", 100),                                              // liquidada i no cobrada fora de termini
  K("8", "2026-03-01", 100),                                              // liquidada tard
  K("9", "2025-12-01", 100, { calc: null }),                              // retrocomissió sense regla ni comissió liquidada
];
const lines = [
  L("1", "100.00", "2026-07-10", { collected: "100.00" }),
  L("5", "85.00", "2026-08-10"),
  L("6", "40.00", "2026-09-10", { movement: "renovacio", collected: "20.00" }),
  L("7", "100.00", "2026-08-01"),
  L("8", "100.00", "2026-07-15", { collected: "100.00" }),
  L("9", "-32.50", "2026-10-15", { movement: "retrocessio" }),
  L(null, "70.00", "2026-10-15"),                                         // sense contracte
  L(null, "40.00", "2026-10-15", { match_status: "pendent", candidates: 2, match_confidence: "multiple" }),   // ambigua
  L("1", "100.00", "2026-10-15", { match_status: "duplicat" }),           // duplicada
];
const input = (extra: Partial<AuditInput> = {}): AuditInput => ({
  retailer: "Gana Energía", from: "2025-11-03", to: TODAY, today: TODAY, lines, contracts, settledContracts: new Set(),
  rules: new Map([["r100", rule("r100", 100)], ["r40", rule("r40", 40, { conditions: { applies_to: "renovacio" } })]]),
  terms: { paymentDays: 60, claimDays: null }, clawRules: [], claimed: new Map(), claimItems: [], collectDays: 30, ...extra,
});
const res = auditCommissions(input());
const row = (id: string) => res.commissions.find((c) => c.contractId === id)!;

describe("del CRM cap a la comercialitzadora", () => {
  it("comissió liquidada correctament i cobrada: quatre estats separats", () => {
    const r = row("1");
    expect([r.prevista.amount, r.liquidada.amount, r.cobrada.amount, r.reclamada.amount]).toEqual(["100.00", "100.00", "100.00", "0.00"]);
    expect(r.situations).toEqual(expect.arrayContaining(["correcta", "cobrada"]));
    expect(r.alerts).toEqual([]);
  });
  it("activada i no liquidada passat el termini de pagament aprovat → pendent de liquidar i reclamable", () => {
    expect(row("2").situations).toContain("pendent_liquidar");
    const a = res.alerts.find((x) => x.key === "pendent_liquidar:2")!;
    expect([a.amount, a.claimable, a.claimKey]).toEqual(["100.00", true, "pendent:2"]);
    expect(a.detail).toMatch(/termini de pagament de 60 dies/);
  });
  it("encara dins del termini: cap alerta", () => {
    expect(row("3").situations).toEqual(["dins_termini"]);
    expect(row("3").alerts).toEqual([]);
  });
  it("ajornament contractual: no és pendent ni reclamable mentre duri", () => {
    expect(row("4").situations).toEqual(["ajornada"]);
    expect(res.alerts.some((a) => a.contractId === "4")).toBe(false);
  });
  it("sense termini aprovat s'aplica el termini per defecte de l'alerta i es diu", () => {
    const r = auditCommissions(input({ terms: { paymentDays: null, claimDays: null }, defaultPaymentDays: 90 }));
    expect(r.commissions.find((c) => c.contractId === "2")!.dueSource).toBe("per_defecte");
    expect(r.alerts.find((x) => x.key === "pendent_liquidar:2")!.detail).toMatch(/90 dies per defecte/);
  });
  it("liquidada per sota de la regla aprovada → alerta amb la diferència", () => {
    expect(row("5").difference).toBe("-15.00");
    expect(res.alerts.find((x) => x.type === "liquidada_inferior")).toMatchObject({ contractId: "5", amount: "15.00", claimable: true });
  });
  it("liquidada fora del termini esperat", () => {
    expect(row("8").situations).toEqual(expect.arrayContaining(["correcta", "liquidada_tard", "cobrada"]));
  });
  it("les renovacions es controlen com a comissions pròpies", () => {
    expect(row("6").event).toBe("renovacio");
  });
});

describe("cobraments", () => {
  it("cobrament parcial", () => {
    expect(row("6").situations).toContain("cobrada_parcial");
    expect(res.alerts.find((x) => x.type === "cobrada_parcial")).toMatchObject({ contractId: "6", amount: "20.00" });
  });
  it("liquidada i sense cobrament bancari després de 30 dies → fora de termini; mai es marca com a cobrada", () => {
    expect(row("7").cobrada.amount).toBe("0.00");
    expect(row("7").situations).toContain("cobrament_fora_termini");
    expect(res.alerts.filter((x) => x.type === "cobrament_fora_termini").map((x) => x.contractId).sort()).toEqual(["5", "7"]);   // la 5 també: liquidada (per sota) i no cobrada
  });
  it("una línia d'Excel no compta com a cobrament: el total cobrat només surt de cobraments reals", () => {
    expect(res.kpis.cobrada).toBe("220.00");                 // 100 + 20 + 100 (només els cobraments registrats)
    expect(res.kpis.liquidada).toBe("425.00");                // 100 + 85 + 40 + 100 + 100 (sense el duplicat)
  });
});

describe("de la comercialitzadora cap al CRM", () => {
  it("línia sense contracte i línia amb diversos contractes compatibles (no s'assigna sola)", () => {
    const s = res.alerts.filter((a) => a.type === "sense_contracte");
    expect(s).toHaveLength(2);
    expect(s.some((a) => /Vinculació ambigua/.test(a.title))).toBe(true);
    expect(res.kpis.senseContracte).toEqual({ count: 2, amount: "110.00" });
  });
  it("liquidació duplicada: no es compta dues vegades", () => {
    expect(res.alerts.filter((a) => a.type === "liquidacio_duplicada")).toHaveLength(1);
    expect(row("1").liquidada.amount).toBe("100.00");
  });
  it("retrocomissió inesperada (sense regla aprovada i sense comissió liquidada)", () => {
    const a = res.alerts.find((x) => x.type === "retro_inesperada")!;
    expect(a.contractId).toBe("9");
    expect(a.detail).toMatch(/no té cap comissió liquidada/);
    expect(res.kpis.retrocomissions).toBe("-32.50");
  });
  it("les set alertes es compten per separat", () => {
    // pendent de liquidar: la 2 i la 9 (activada, sense cap alta liquidada i sense import previst aprovat)
    expect(res.kpis.counts).toEqual({ pendent_liquidar: 2, liquidada_inferior: 1, cobrada_parcial: 1, retro_inesperada: 1, liquidacio_duplicada: 1, sense_contracte: 2, cobrament_fora_termini: 2 });
    expect(res.alerts.find((x) => x.key === "pendent_liquidar:9")!.detail).toMatch(/Sense import previst aprovat/);
  });
});

describe("reclamada", () => {
  it("una diferència ja reclamada suma a «Reclamada» i deixa de ser seleccionable", () => {
    const r = auditCommissions(input({
      claimItems: [{ item_key: "line:l2", contract_id: "5", statement_line_id: "l2", claimed_amount: "15.00", recovered_amount: "5.00", status: "reclamada", active: true, claim_code: "REC-2026-0007", claim_status: "pendent_resposta" }],
      claimed: new Map([["line:l2", { claim_id: "x", code: "REC-2026-0007", status: "pendent_resposta", item_status: "reclamada" }]]),
    }));
    const c = r.commissions.find((x) => x.contractId === "5")!;
    expect([c.reclamada.amount, c.reclamada.recovered, c.reclamada.claims]).toEqual(["15.00", "5.00", ["REC-2026-0007"]]);
    expect(c.situations).toContain("reclamada");
    expect(r.alerts.find((x) => x.type === "liquidada_inferior")!.claimable).toBe(false);
  });
});

describe("cobrament net d'una liquidació", () => {
  it("Gana: 3.026,25 € de comissions i −1.015,00 € de retrocomissions es cobren amb una transferència neta de 2.011,25 €", () => {
    const r = allocateNetReceipt("2011.25", [{ id: "a", amount: "1780.00", pending: "1780.00" }, { id: "r", amount: "-1015.00", pending: "1015.00" }, { id: "b", amount: "1246.25", pending: "1246.25" }]);
    const tot = (xs: { amount: string }[]) => xs.reduce((s, x) => s + Number(x.amount), 0).toFixed(2);
    expect([tot(r.cash), tot(r.compensation), r.unallocated]).toEqual(["2011.25", "1015.00", "0.00"]);
  });
  it("cobrament inferior: queda part pendent i no es marca res de més", () => {
    const r = allocateNetReceipt("50.00", [{ id: "a", amount: "100.00", pending: "100.00" }, { id: "b", amount: "100.00", pending: "100.00" }]);
    expect(r.cash).toEqual([{ id: "a", amount: "50.00" }]);
  });
  it("cobrament superior: l'excés queda sense assignar", () => {
    expect(allocateNetReceipt("250.00", [{ id: "a", amount: "100.00", pending: "100.00" }]).unallocated).toBe("150.00");
  });
});
