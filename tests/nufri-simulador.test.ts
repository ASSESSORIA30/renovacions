/**
 * SIMULADOR DINÀMIC DE MARGES NUFRI · preus del client, comissió d'energia i de potència, col·laborador,
 * coherència amb la comparativa, vinculació al contracte i conciliació (Supabase SIMULAT). Preus de l'annex real
 * del 05/11/2026; la resta de dades són fictícies.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pdfText } from "@/server/doc-text";
import { parseNufriDoc } from "@/comparator/nufri-reader";
import { nufriItems } from "@/comparator/nufri-mapping";
import { applyCommercial, commercialCommission, marginTable } from "@/comparator/commercial";
import { computeCost } from "@/comparator/engine";
import { buildSnapshot } from "@/comparator/snapshot";
import { comparisonSheet } from "@/comparator/sheet-view";
import { computeCommission, ruleApplies, type Facts, type RuleRow } from "@/core/commissions";
import type { OfferVersion, SupplyInput } from "@/comparator/types";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  const { HttpError } = await import("@/server/http-error");
  return { adminClient: () => state.sb, HttpError, handler: (fn: unknown) => fn, requireUser: async () => null };
});

let o20: OfferVersion, o30: OfferVersion;
beforeAll(async () => {
  const L = parseNufriDoc((await pdfText(new Uint8Array(readFileSync("tests/fixtures/nufri/nufri-electricitat-2026-11-05.pdf")))).pages);
  const items = nufriItems(L, { fileName: "annex.pdf", existing: [] });
  const ready = (o: OfferVersion): OfferVersion => ({ ...o, status: "activa", validTo: "2027-12-31", permanence: { status: "amb", months: 12, startNote: null, cancellation: null, penalty: null, source: "Prova", exception: null } });
  o20 = ready(items.find((i) => i.offer.productName === "Nufri 2.0TD · Tres precios")!.offer);
  o30 = ready(items.find((i) => i.offer.productName === "Nufri 3.0TD · Seis precios")!.offer);
});
const supply = (p: Partial<SupplyInput>): SupplyInput => ({ energyType: "luz", accessTariff: "3.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: [5000, 4000, 3000, 6000, 2000, 9000], kwhTotal: null, kw: [40, 40, 40, 40, 40, 40], meterRentEurMonth: null, ...p });

describe("BOE: preus publicats i comissió de potència", () => {
  it("2.0TD amb BOE, BOE+2, BOE+4 i BOE+6: preus del client i comissió = (P1 + P2) × marge", () => {
    const s = supply({ accessTariff: "2.0TD", kwh: [1000, 800, 1200, null, null, null], kw: [5.75, 4.6, null, null, null, null] });
    const rows = marginTable(o20, s, { level: "GALA", selected: "BOE+4", energyEurMwh: 10, collaboratorPct: null, annualKwh: 3000 });
    expect(rows.map((r) => [r.margin.label, r.power[0], r.power[1]])).toEqual([["BOE", 0.075903, 0.001987], ["BOE+2", 0.08373, 0.009815], ["BOE+4", 0.091558, 0.017643], ["BOE+6", 0.099386, 0.025471]]);
    expect(rows.map((r) => r.commission.power)).toEqual(["0.00", "20.70", "41.40", "62.10"]); // (5,75 + 4,6) kW × 0/2/4/6
    expect(rows.find((r) => r.selected)!.margin.label).toBe("BOE+4");
    // cost de potència del client: Σ kW × €/kW·dia × 365 (motor existent)
    expect(rows[1].clientPower).toBeCloseTo(5.75 * 0.08373 * 365 + 4.6 * 0.009815 * 365, 1);
    expect(rows[0].diffPowerVsBase).toBe(0);
    expect(rows[3].diffPowerVsBase).toBeGreaterThan(rows[2].diffPowerVsBase!);
  });
  it("3.0TD amb BOE, BOE+2 i BOE+4: 40 kW × 6 períodes × 2 = 480 € i × 4 = 960 €", () => {
    const rows = marginTable(o30, supply({}), { level: "GALA", selected: "BOE+2", energyEurMwh: 10, collaboratorPct: null, annualKwh: 29000 });
    expect(rows.map((r) => r.margin.label)).toEqual(["BOE", "BOE+2", "BOE+4"]);
    expect(rows.map((r) => r.commission.power)).toEqual(["0.00", "480.00", "960.00"]);
    expect(rows[1].commission.formulaPower).toMatch(/240 kW \(suma de períodes\) × 2 €\/kW·any/);
    expect(rows.every((r) => r.commission.energy === "290.00")).toBe(true); // 29 MWh × 10 €/MWh, separat de la potència
    expect(rows[2].commission.total).toBe("1250.00");
  });
  it("potències diferents a cada període: es fa servir la suma de tots, no P1 ni P6", () => {
    const c = commercialCommission({ annualKwh: null, kw: [10, 20, 30, 40, 50, 60], accessTariff: "3.0TD", energyEurMwh: null, marginEurKwYear: 4 });
    expect([c.kwSum, c.power, c.energy]).toEqual(["210", "840.00", null]);
  });
  it("canvi instantani: en canviar el marge canvien els preus €/kW·dia, el cost del client i la comissió", () => {
    const s = supply({});
    const a = computeCost(applyCommercial(o30, { level: "GALA", margin: "BOE" }), s);
    const b = computeCost(applyCommercial(o30, { level: "GALA", margin: "BOE+4" }), s);
    expect(b.detail!.power.map((p) => p.price)).toEqual([0.071483, 0.044745, 0.027934, 0.026303, 0.022543, 0.019607]);
    expect(b.power - a.power).toBeCloseTo(40 * 365 * (0.071483 - 0.055827 + 0.044745 - 0.029089 + 0.027934 - 0.012278 + 0.026303 - 0.010647 + 0.022543 - 0.006887 + 0.019607 - 0.003951), 0);
    expect(b.energy).toBe(a.energy); // el marge de potència no toca l'energia
  });
  it("percentatge del col·laborador sobre la comissió total i import per a Assessoria 3.0", () => {
    const c = commercialCommission({ annualKwh: 29000, kw: [40, 40, 40, 40, 40, 40], accessTariff: "3.0TD", energyEurMwh: 10, marginEurKwYear: 2, collaboratorPct: 30 });
    expect([c.energy, c.power, c.total, c.collaborator, c.remainder]).toEqual(["290.00", "480.00", "770.00", "231.00", "539.00"]);
  });
  it("la fórmula de potència és només de Nufri: una regla per MWh d'una altra comercialitzadora no la fa servir", () => {
    const facts: Facts = { retailer: "Iberdrola", product: "Plan Estable", service: null, segment: null, refDate: "2026-11-05", annualKwh: 29000, annualKwhSource: "x", eligibleMwh: null, energyIncrementEurKwh: null, powerIncrementEurKwDay: null, powerKw: [40, 40, 40, 40, 40, 40], months: 12, providerAmount: null, providerAmountSource: null, powerMarginEurKwYear: 2 };
    const r: RuleRow = { id: "r", rule_key: "iber", version: 1, name: "Iberdrola", layer: "proveidor", retailer: "Iberdrola", product: null, service: null, segment: null, beneficiary_id: null, kind: "per_mwh", value: "8", unit: "eur_mwh", tiers: null, conditions: {}, base_formula: null, base_validated: true, valid_from: "2026-01-01", valid_to: null, status: "aprovada", notes: null };
    const res = computeCommission(r, facts);
    expect([res.amount, res.components]).toEqual(["232.00", undefined]);
  });
});

describe("motor de comissions i conciliació", () => {
  const rule: RuleRow = { id: "r1", rule_key: "nufri_llum_gala", version: 1, name: "Nufri · GALA", layer: "proveidor", retailer: "Nufri", product: "GALA", service: null, segment: null, beneficiary_id: null, kind: "energia_potencia", value: "10", unit: "eur_mwh", tiers: null, conditions: {}, base_formula: null, base_validated: true, valid_from: "2026-11-05", valid_to: null, status: "aprovada", notes: null };
  const facts: Facts = { retailer: "Nufri", product: "Nufri 3.0TD · Seis precios · GALA", service: null, segment: null, refDate: "2026-11-10", annualKwh: 29000, annualKwhSource: "Consum anual de la comparativa formalitzada", eligibleMwh: null, energyIncrementEurKwh: null, powerIncrementEurKwDay: null, powerKw: [40, 40, 40, 40, 40, 40], months: 12, providerAmount: null, providerAmountSource: null, tariff: "3.0TD", powerMarginEurKwYear: 2 };
  it("energia i potència separades en el càlcul del contracte (components conciliables)", () => {
    const r = computeCommission(rule, facts);
    expect([r.status, r.amount, r.components]).toEqual(["calculat", "770.00", { energy: "290.00", power: "480.00" }]);
    expect(r.breakdown.filter((b) => b.component).map((b) => [b.component, b.value])).toEqual([["energia", "290.00 €"], ["potencia", "480.00 €"]]);
  });
  it("la regla GALA no s'aplica a un contracte GALAXY (paraula sencera)", () => {
    expect(ruleApplies(rule, { ...facts, product: "Nufri 3.0TD · Seis precios · GALAXY" }, "proveidor", null)).toBe(false);
    expect(ruleApplies(rule, facts, "proveidor", null)).toBe(true);
  });
  it("sense marge triat o sense potències, la comissió queda pendent (no s'inventa)", () => {
    expect(computeCommission(rule, { ...facts, powerMarginEurKwYear: null }).status).not.toBe("calculat");
    expect(computeCommission(rule, { ...facts, powerKw: null }).status).not.toBe("calculat");
  });
  it("conciliació: una línia d'energia i una de potència es comparen amb el seu component; una de total, amb el total", async () => {
    const { expectedFor } = await import("@/server/finance");
    const calc = { amount: "770.00", breakdown: computeCommission(rule, facts).breakdown };
    expect(expectedFor(calc, "Comisión energía GALA")).toBe("290.00");
    expect(expectedFor(calc, "Comisión término de potencia BOE+2")).toBe("480.00");
    expect(expectedFor(calc, "Liquidación agente")).toBe("770.00");
    expect(expectedFor({ amount: "100.00", breakdown: [] }, "Comisión potencia")).toBe("100.00"); // sense components: total
  });
});

describe("comparativa, PDF i contracte", () => {
  it("la combinació triada al simulador és la mateixa de la comparativa i del full del PDF (sense comissions)", () => {
    const s = supply({});
    const row = marginTable(o30, s, { level: "GALAXY", selected: "BOE+2", energyEurMwh: null, collaboratorPct: null, annualKwh: null }).find((r) => r.selected)!;
    const snap = buildSnapshot({ mode: "manual", supply: s, current: null, offers: [o30], adjustments: { [o30.id]: { commercial: { level: "GALAXY", margin: "BOE+2" } } } });
    const ev = snap.result.evaluations[0];
    expect(ev.cost.total).toBe(row.clientTotal);
    expect(ev.cost.power).toBe(row.clientPower);
    const sh = comparisonSheet(snap, "ca");
    expect(sh.totals.values[1]).toBe(row.clientTotal);
    expect(JSON.stringify(sh)).not.toMatch(/comissi|€\/MWh/i);
  });
  it("en formalitzar es vinculen tarifa, versió, nivell, marge, potències, consum, preus i comissions; no es reescriu", async () => {
    const s = supply({});
    const snap = buildSnapshot({ mode: "manual", supply: s, current: null, offers: [{ ...o30, id: "00000000-0000-4000-8000-000000000030", version: 3, productId: "prod-n30" }], adjustments: { "00000000-0000-4000-8000-000000000030": { commercial: { level: "GALA", margin: "BOE+2" } } } });
    state.sb = fakeSupabase({
      crm_expedients: [{ id: "e1", client_id: "c1", accepted_terms_id: "t1", comparison_id: "k1", collaborator_id: "col1" }],
      crm_expedient_terms: [{ id: "t1", comparison_id: "k1", conditions: { offer_ref: { offer_id: "00000000-0000-4000-8000-000000000030" } } }],
      comparisons: [{ id: "k1", snapshot: snap }],
      crm_clients: [{ id: "c1", collaborator_id: "col1" }],
      fin_rules: [
        { id: "r1", rule_key: "nufri_llum_gala", version: 1, value: "10", status: "aprovada", layer: "proveidor", kind: "energia_potencia" },
        { id: "rc", rule_key: "col_30", version: 2, value: "30", status: "aprovada", layer: "collaborador", kind: "pct_comissio_rebuda", beneficiary_id: "col1" },
      ],
      fin_contract_economics: [],
    });
    const { linkCommercialToContract } = await import("@/server/finance");
    const c = (await linkCommercialToContract("k-1", "e1", "u1"))!;
    expect(c).toMatchObject({
      catalog_version_id: "00000000-0000-4000-8000-000000000030", catalog_version: 3, product_id: "prod-n30", tariff: "3.0TD", level: "GALA", margin: "BOE+2", margin_eur_kw_year: 2,
      power_kw: [40, 40, 40, 40, 40, 40], annual_kwh: 29000, collaborator_id: "col1", collaborator_pct: "30", collaborator_rule_version: 2, comparison_id: "k1",
      forecast: { energy: "290.00", power: "480.00", total: "770.00", collaborator: "231.00", remainder: "539.00", status: "previst", rule_version: 1 },
    });
    expect(c.prices.power.slice(0, 6)).toEqual([0.063655, 0.036917, 0.020106, 0.018475, 0.014715, 0.011779]);
    const row = state.sb.db.fin_contract_economics[0] as { product_modality: string; commercial: unknown };
    expect(row.product_modality).toBe("GALA");
    // canvis posteriors (regla nova, catàleg) no modifiquen el contracte ja formalitzat
    (state.sb.db.fin_rules as { value: string }[])[0].value = "15";
    const again = await linkCommercialToContract("k-1", "e1", "u1");
    expect(again!.forecast.energy).toBe("290.00");
    expect(state.sb.db.fin_contract_economics).toHaveLength(1);
  });
  it("una comparativa amb una tarifa sense matriu comercial no vincula res", async () => {
    const snap = buildSnapshot({ mode: "manual", supply: supply({}), current: null, offers: [{ ...o30, commercial: null }] });
    state.sb = fakeSupabase({ crm_expedients: [{ id: "e2", client_id: "c1", accepted_terms_id: null, comparison_id: "k2", collaborator_id: null }], comparisons: [{ id: "k2", snapshot: snap }], fin_contract_economics: [] });
    const { linkCommercialToContract } = await import("@/server/finance");
    expect(await linkCommercialToContract("k-2", "e2", null)).toBeNull();
    expect(state.sb.db.fin_contract_economics).toHaveLength(0);
  });
});
