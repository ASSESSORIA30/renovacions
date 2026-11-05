import { describe, expect, it } from "vitest";
import {
  computeCommission, contributionMargin, deriveSegment, incentiveDelta, lineFingerprint, money, parseAmount, parseStatementRows, periodRange, pickRule, planFinanceAlerts, reconcile, retrocession,
  tierAmount, type Facts, type RuleRow,
} from "@/core/commissions";
import { buildSettlementPdf } from "@/core/settlement-pdf";

const rule = (p: Partial<RuleRow>): RuleRow => ({
  id: p.rule_key ?? "r", rule_key: "r", version: 1, name: "Regla", layer: "comercial", retailer: null, product: null, service: null, segment: null, beneficiary_id: null, kind: "fix_contracte", value: "15", unit: "eur",
  tiers: null, conditions: {}, base_formula: null, base_validated: true, valid_from: "2026-01-01", valid_to: null, status: "aprovada", notes: null, ...p,
});
const facts = (p: Partial<Facts> = {}): Facts => ({
  retailer: "Iberdrola", product: null, service: "llum_residencial", segment: "residencial", refDate: "2026-11-01", annualKwh: 3500, annualKwhSource: "Subministrament", eligibleMwh: null,
  energyIncrementEurKwh: null, powerIncrementEurKwDay: null, powerKw: null, months: 12, providerAmount: null, providerAmountSource: null, ...p,
});

describe("1 · comissió fixa residencial", () => {
  it("electricitat 15 € i gas 10 €", () => {
    const rules = [rule({ rule_key: "res_llum", service: "llum_residencial", segment: "residencial", value: "15" }), rule({ rule_key: "res_gas", service: "gas", segment: "residencial", value: "10" })];
    const l = pickRule(rules, facts(), "comercial", "u1");
    expect(computeCommission(l.rule!, facts()).amount).toBe("15.00");
    const g = pickRule(rules, facts({ service: "gas" }), "comercial", "u1");
    expect(computeCommission(g.rule!, facts({ service: "gas" }))).toMatchObject({ status: "calculat", amount: "10.00" });
  });
});

describe("2 · comissió per MWh", () => {
  it("Nufri Gala: 200 MWh × 10 €/MWh = 2.000 € (amb desglossament)", () => {
    const r = rule({ kind: "per_mwh", unit: "eur_mwh", value: "10", retailer: "Nufri", product: "Gala", name: "Nufri Gala" });
    const res = computeCommission(r, facts({ retailer: "Nufri", product: "Gala", eligibleMwh: "200" }));
    expect(res.amount).toBe("2000.00");
    expect(res.formula).toBe("200 MWh × 10 €/MWh");
    expect(res.breakdown.find((b) => b.label === "MWh elegibles")?.source).toMatch(/Volum elegible pactat/);
  });
  it("sense volum elegible fa servir el consum anual prorratejat i ho indica", () => {
    const res = computeCommission(rule({ kind: "per_mwh", unit: "eur_mwh", value: "6" }), facts({ annualKwh: 150000, months: 6 }));
    expect(res.amount).toBe("450.00");
    expect(res.breakdown.find((b) => b.label === "MWh elegibles")?.source).toMatch(/prorratejat a 6 mesos/);
  });
  it("sense dades → pendent de dades (no s'inventa)", () => {
    expect(computeCommission(rule({ kind: "per_mwh", unit: "eur_mwh", value: "6" }), facts({ annualKwh: null })).status).toBe("pendent_dades");
  });
});

describe("3 · comissió percentual (Novaluz 12,5 % del valor afegit)", () => {
  const nova = rule({ kind: "pct_marge", unit: "pct", value: "12.5", retailer: "Novaluz", base_formula: "inc €/kWh × kWh + inc €/kW·dia × kW × dies", conditions: { include_energy: true, include_power: true } });
  it("energia + potència amb fórmula explícita", () => {
    const res = computeCommission(nova, facts({ retailer: "Novaluz", annualKwh: 100000, energyIncrementEurKwh: "0.010", powerIncrementEurKwDay: "0.002", powerKw: [10, 10] }));
    // energia: 0,010 × 100.000 = 1.000 € · potència: 0,002 × 20 kW × 365 dies = 14,60 € · base 1.014,60 → 12,5 % = 126,825 → 126,83
    expect(res.breakdown.find((b) => b.label === "Valor afegit energia")?.value).toBe("1000.00 €");
    expect(res.breakdown.find((b) => b.label === "Valor afegit potència")?.value).toBe("14.60 €");
    expect(res.amount).toBe("126.83");
  });
  it("sense l'increment pactat no aplica el 12,5 % al preu ni al consum", () => {
    const res = computeCommission(nova, facts({ retailer: "Novaluz", annualKwh: 100000 }));
    expect(res.status).toBe("pendent_dades");
    expect(res.missing).toContain("Increment pactat d'energia (€/kWh)");
  });
  it("Iberdrola amb la base sense validar → «Pendent de configuració»", () => {
    const res = computeCommission(rule({ kind: "pct_marge", unit: "pct", value: "12.5", base_validated: false, base_formula: null }), facts({ energyIncrementEurKwh: "0.01" }));
    expect(res).toMatchObject({ status: "pendent_configuracio", amount: null });
  });
  it("percentatge sobre la comissió rebuda: necessita la capa del proveïdor", () => {
    const r = rule({ kind: "pct_comissio_rebuda", unit: "pct", value: "40", base_formula: "Comissió confirmada" });
    expect(computeCommission(r, facts()).status).toBe("pendent_dades");
    expect(computeCommission(r, facts({ providerAmount: "1234.57", providerAmountSource: "confirmat" })).amount).toBe("493.83");
  });
});

describe("4 · bonificació per trams", () => {
  const tiers = [{ threshold: 5, amount: 50 }, { threshold: 10, amount: 150 }, { threshold: 15, amount: 250 }, { threshold: 20, amount: 400 }];
  it("només el tram més alt assolit (no la suma)", () => {
    expect(tierAmount(tiers, 4).amount).toBe("0.00");
    expect(tierAmount(tiers, 12)).toMatchObject({ amount: "150.00", reached: { threshold: 10 }, next: { threshold: 15 } });
    expect(tierAmount(tiers, 25).amount).toBe("400.00");
    expect(tierAmount(tiers, 12, "acumulat").amount).toBe("200.00");
  });
  it("Pimes 100 MWh i Fibra O2", () => {
    expect(tierAmount([{ threshold: 100, amount: 50 }], "99.999").amount).toBe("0.00");
    expect(tierAmount([{ threshold: 100, amount: 50 }], "100").amount).toBe("50.00");
    expect(tierAmount([{ threshold: 3, amount: 50 }, { threshold: 7, amount: 150 }, { threshold: 11, amount: 300 }], 7).amount).toBe("150.00");
  });
  it("idempotència: només es registra la diferència respecte del que ja s'ha comptabilitzat", () => {
    expect(incentiveDelta("150.00", "50.00")).toBe("100.00");
    expect(incentiveDelta("150.00", "150.00")).toBe("0.00");
    expect(incentiveDelta("50.00", "150.00")).toBe("-100.00");
  });
});

describe("5 · versions de regla", () => {
  it("s'aplica la versió vigent a la data del contracte; l'antiga continua servint per als contractes anteriors", () => {
    const v1 = rule({ id: "v1", rule_key: "gala", version: 1, kind: "per_mwh", unit: "eur_mwh", value: "10", valid_from: "2026-01-01", valid_to: "2026-10-31" });
    const v2 = rule({ id: "v2", rule_key: "gala", version: 2, kind: "per_mwh", unit: "eur_mwh", value: "11", valid_from: "2026-11-01" });
    expect(pickRule([v1, v2], facts({ refDate: "2026-06-15" }), "comercial", null).rule?.id).toBe("v1");
    expect(pickRule([v1, v2], facts({ refDate: "2026-11-15" }), "comercial", null).rule?.id).toBe("v2");
  });
  it("una regla pendent d'aprovació només dona una simulació", () => {
    const r = rule({ status: "pendent_aprovacio" });
    const p = pickRule([r], facts(), "comercial", null);
    expect(p.simulation).toBe(true);
    expect(computeCommission(p.rule!, facts(), true).status).toBe("simulacio");
  });
  it("les capes no es barregen: una regla de comercial no calcula la comissió del proveïdor", () => {
    expect(pickRule([rule({})], facts(), "proveidor", null).rule).toBeNull();
  });
  it("la regla més específica guanya; dues igual d'específiques són un conflicte", () => {
    const gen = rule({ id: "g", rule_key: "g", service: "llum_residencial" });
    const spec = rule({ id: "s", rule_key: "s", retailer: "Iberdrola", service: "llum_residencial", value: "20" });
    expect(pickRule([gen, spec], facts(), "comercial", null).rule?.id).toBe("s");
    const other = rule({ id: "o", rule_key: "o", retailer: "Iberdrola", service: "llum_residencial", value: "25" });
    expect(pickRule([spec, other], facts(), "comercial", null)).toMatchObject({ rule: null, conflict: [{ id: "s" }, { id: "o" }] });
  });
});

describe("6-7 · anul·lació i retrocessió", () => {
  const retro = rule({ kind: "retrocessio", unit: "pct", value: "100", conditions: { months: 12 } });
  it("dins el termini: es retrocedeix el percentatge del que s'ha liquidat", () => {
    expect(retrocession(retro, "150.00", "2026-03-01", "2026-09-01")).toMatchObject({ amount: "-150.00" });
    expect(retrocession(rule({ kind: "retrocessio", unit: "pct", value: "50", conditions: { months: 6 } }), "150.00", "2026-03-01", "2026-05-01").amount).toBe("-75.00");
  });
  it("fora del termini o sense regla: no es descompta res automàticament", () => {
    expect(retrocession(retro, "150.00", "2025-01-01", "2026-09-01").amount).toBeNull();
    expect(retrocession(null, "150.00", "2026-03-01", "2026-09-01").reason).toMatch(/no es descompta res/);
  });
});

describe("12 · conciliació", () => {
  it("diferències amb l'estimat i tolerància d'1 cèntim", () => {
    expect(reconcile("2000.00", "2000.00")).toEqual({ status: "identificat", difference: "0.00" });
    expect(reconcile("1995.50", "2000.00")).toEqual({ status: "diferencia", difference: "-4.50" });
    expect(reconcile("100.00", null)).toEqual({ status: "identificat", difference: null });
  });
  it("llegeix imports en format català/espanyol i anglès", () => {
    expect(parseAmount("1.234,56")).toBe("1234.56");
    expect(parseAmount("1,234.56")).toBe("1234.56");
    expect(parseAmount("-12,5 €")).toBe("-12.50");
    expect(parseAmount("(45,00)")).toBe("-45.00");
    expect(parseAmount("abc")).toBeNull();
  });
  it("detecta columnes, retrocessions i files errònies d'un fitxer", () => {
    const r = parseStatementRows([
      { CUPS: "es0021 0000 0000 0001 AA", Cliente: "Forn SL", Concepto: "Comisión alta", Importe: "2.000,00" },
      { CUPS: "ES0021000000000002BB", Cliente: "Bar Pepe", Concepto: "Baja anticipada", Importe: "-150,00" },
      { CUPS: "ES0021000000000003CC", Cliente: "X", Concepto: "?", Importe: "n/d" },
    ]);
    expect(r.columns).toMatchObject({ cups: "CUPS", amount: "Importe", client_name: "Cliente", concept: "Concepto" });
    expect(r.lines.map((l) => [l.cups, l.amount, l.kind])).toEqual([["ES0021000000000001AA", "2000.00", "comissio"], ["ES0021000000000002BB", "-150.00", "retrocessio"]]);
    expect(r.errors).toEqual(["Fila 4: import no vàlid"]);
  });
});

describe("11 · duplicats", () => {
  it("la mateixa línia en dues liquidacions té la mateixa empremta", () => {
    const a = lineFingerprint("Nufri", { cups: "ES0021000000000001AA", external_ref: "NUF-1", contract_ref: null, amount: "2000.00", concept: "Alta" }, "2026-11-30");
    const b = lineFingerprint("NUFRI ", { cups: "ES0021000000000001AA", external_ref: "nuf-1", contract_ref: null, amount: "2000.00", concept: "alta" }, "2026-11-30");
    expect(a).toBe(b);
    expect(lineFingerprint("Nufri", { cups: "ES0021000000000001AA", external_ref: "NUF-1", contract_ref: null, amount: "2000.01", concept: "Alta" }, "2026-11-30")).not.toBe(a);
  });
});

describe("14 · decimals", () => {
  it("sense errors de coma flotant i arrodoniment mig cap amunt a cèntims", () => {
    expect(money("0.1") === "0.10" && money(0.1 + 0.2)).toBe("0.30");
    expect(money("2.675")).toBe("2.68");                              // amb float seria 2.67
    expect(money("-2.675")).toBe("-2.68");
    const r = computeCommission(rule({ kind: "per_mwh", unit: "eur_mwh", value: "2.333333" }), facts({ eligibleMwh: "3.333" }));
    expect(r.amount).toBe("7.78");                                     // 7,776999… → 7,78
    const p = computeCommission(rule({ kind: "pct_increment_preu", unit: "pct", value: "12.5", base_formula: "inc × kWh" }), facts({ annualKwh: 3333, energyIncrementEurKwh: "0.0123" }));
    expect(p.amount).toBe("5.12");                                     // 0,0123 × 3.333 = 40,9959 × 12,5 % = 5,1244875
  });
});

describe("marge de contribució", () => {
  it("real, estimat o incomplet; mai inventa costos", () => {
    expect(contributionMargin({ providerCollected: "2000.00", providerEstimated: "2000.00", providerConfirmed: "2000.00", payouts: "200.00", payoutsEstimated: "200.00", costs: "50.00", hasProviderRule: true, hasPayoutCalc: true })).toMatchObject({ status: "real", value: "1750.00" });
    expect(contributionMargin({ providerCollected: "0", providerEstimated: "2000.00", providerConfirmed: "0", payouts: "0", payoutsEstimated: "200.00", costs: "0", hasProviderRule: true, hasPayoutCalc: true })).toMatchObject({ status: "estimat", value: null, estimated: "1800.00" });
    expect(contributionMargin({ providerCollected: "0", providerEstimated: null, providerConfirmed: "0", payouts: "15", payoutsEstimated: null, costs: "0", hasProviderRule: false, hasPayoutCalc: true }).status).toBe("incomplet");
  });
  it("segment derivat", () => {
    expect(deriveSegment("gas", "particular", 5000)).toBe("residencial");
    expect(deriveSegment("llum_empresa", "empresa", 200000)).toBe("pime");
    expect(deriveSegment("llum_empresa", "empresa", 2_000_000)).toBe("gran_consum");
  });
});

describe("alertes econòmiques", () => {
  it("idempotents (clau estable) i només per a les regles actives", () => {
    const base = { now: new Date("2026-12-31T10:00:00Z"), staffIds: ["a", "b"], stale: [{ contract_id: "k1", client_name: "Forn", retailer: "Nufri", since: "2026-08-01T00:00:00Z" }], differences: [{ line_id: "l1", retailer: "Nufri", amount: "1990.00", expected: "2000.00", difference: "-10.00" }], cancelledPaid: [{ contract_id: "k2", client_name: "Bar", beneficiary_id: "c1", amount: "15.00" }], duplicates: [{ key: "line:9", label: "dup" }], pendingApproval: [{ id: "s1", code: "LIQ-2026-0001", since: "2026-12-20T00:00:00Z" }], collabBalance: [], achieved: [{ key: "res:c1:2026-12:10", user_id: "c1", label: "10 contractes" }], retrocessions: [{ line_id: "l2", contract_id: "k3", beneficiary_id: "c1", amount: "-150.00", client_name: "Bar" }] };
    const rules = ["fin_sense_liquidar", "fin_diferencia", "fin_anullat_pagat", "fin_pagament_duplicat", "fin_liquidacio_pendent", "fin_collaborador_saldo", "fin_objectiu_assolit", "fin_possible_retrocessio"].map((key) => ({ key, enabled: true, params: {} }));
    const a = planFinanceAlerts({ ...base, rules });
    const keys = new Set(a.map((x) => x.rule_key.split(":")[0]));
    expect([...keys].sort()).toEqual(["fin_cancel_paid", "fin_diff", "fin_dup", "fin_goal", "fin_pending", "fin_retro", "fin_stale"]);
    expect(planFinanceAlerts({ ...base, rules }).map((x) => x.rule_key)).toEqual(a.map((x) => x.rule_key));
    expect(a.filter((x) => x.rule_key === "fin_goal:res:c1:2026-12:10").map((x) => x.user_id).sort()).toEqual(["a", "b", "c1"]);
    expect(planFinanceAlerts({ ...base, rules: rules.map((r) => ({ ...r, enabled: false })) })).toEqual([]);
  });
  it("períodes", () => {
    expect(periodRange("trimestre", new Date("2026-11-15T10:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange("setmana", new Date("2026-11-01T10:00:00Z"))).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });
});

describe("PDF de liquidació", () => {
  it("inclou totals, línies i l'avís de retencions", async () => {
    const pdf = buildSettlementPdf({ code: "LIQ-2026-0001", kind: "comercial", beneficiary: "Ibeth Comercial", periodFrom: "2026-11-01", periodTo: "2026-11-30", status: "aprovada",
      totals: { fixed: "15.00", variable: "2000.00", bonus: "150.00", cancellations: "-15.00", adjustments: "-25.00", gross: "2125.00", approved: "2125.00", paid: "1000.00", pending: "1125.00" },
      lines: [{ contract: "Nufri", client: "Forn SL · Nufri", category: "variable", description: "200 MWh × 10 €/MWh", amount: "2000.00" }], payments: [{ paid_at: "2026-12-05", amount: "1000.00", method: "transferencia", reference: "TR-1" }],
      approvedBy: "Olivia Admin", approvedAt: "2026-12-01T10:00:00Z", generatedBy: "Olivia Admin", generatedAt: new Date("2026-12-06T10:00:00Z") });
    const { extractText } = await import("unpdf");
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("Ibeth Comercial");
    expect(text).toMatch(/2\.125,00\s*€/);
    expect(text).toContain("200 MWh × 10 €/MWh");
    expect(text).toContain("no inclou retencions fiscals");
  });
});
