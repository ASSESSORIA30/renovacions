/**
 * LECTOR LOCAL DE NUFRI amb els dos annexos REALS del 05/11/2026 (tests/fixtures/nufri). Sense IA ni xarxa.
 * Els valors esperats s'han copiat de les taules originals dels PDF.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pdfText } from "@/server/doc-text";
import { isNufriTariffDoc, nufriGasIndexedPrice, parseNufriDoc, stripNufriCommissions, type NufriDoc } from "@/comparator/nufri-reader";
import { annexDateOf, nufriItems, nufriRuleProposals } from "@/comparator/nufri-mapping";
import { applyCommercial } from "@/comparator/commercial";
import { finalPrices } from "@/comparator/final-prices";
import { computeCost } from "@/comparator/engine";
import { buildSnapshot } from "@/comparator/snapshot";
import { comparisonSheet } from "@/comparator/sheet-view";
import { renderComparisonPdf } from "@/comparator/pdf";
import { isEndesaOpen, parseEndesaOpen } from "@/comparator/endesa-open";
import type { OfferVersion, SupplyInput } from "@/comparator/types";

vi.mock("server-only", () => ({}));

const pages = async (f: string) => (await pdfText(new Uint8Array(readFileSync(`tests/fixtures/nufri/${f}`)))).pages;
let L: NufriDoc, G: NufriDoc, lp: string[], gp: string[];
beforeAll(async () => {
  lp = await pages("nufri-electricitat-2026-11-05.pdf");
  gp = await pages("nufri-gas-2026-11-05.pdf");
  L = parseNufriDoc(lp);
  G = parseNufriDoc(gp);
});
const t20 = () => L.elec.find((e) => e.tariff === "2.0TD")!;
const t30 = () => L.elec.find((e) => e.tariff === "3.0TD")!;
const v = (t: ReturnType<typeof t20>, id: string) => t.variants.find((x) => x.id === id)!;
const lvl = (t: ReturnType<typeof t20>, id: string, level: string) => v(t, id).levels.find((l) => l.label === level)!;

describe("1–2 · detecció", () => {
  it("1 · annex de llum de Nufri, versió RV. 05.11.2026, pel contingut (no pel nom del fitxer)", () => {
    expect(isNufriTariffDoc(lp.join("\n"))).toBe(true);
    expect([L.kind, L.version, L.annexDate, L.conditionsVersion]).toEqual(["llum", "RV. 05.11.2026", "2026-11-05", "CG 14/VII/25 · CP V.28"]);
    expect(L.warnings).toEqual([]);
  });
  it("2 · annex de gas de Nufri, versió GRV. 05.11.2026", () => {
    expect(isNufriTariffDoc(gp.join("\n"))).toBe(true);
    expect([G.kind, G.version, G.annexDate]).toEqual(["gas", "GRV. 05.11.2026", "2026-11-05"]);
    expect(G.warnings).toEqual([]);
  });
});

describe("3–6 · energia", () => {
  it("3 · cinc nivells elèctrics amb la comissió (2, 6, 10, 15 i 20 €/MWh) a 2.0TD i 3.0TD", () => {
    for (const t of [t20(), t30()]) for (const vv of t.variants) {
      expect(vv.levels.map((l) => l.label)).toEqual(["FUJI", "GOLDEN", "GALA", "GALAXY", "ROYAL G"]);
      expect(vv.levels.map((l) => l.eurMwh)).toEqual([2, 6, 10, 15, 20]);
    }
  });
  it("4 · tres preus i preu únic (2.0TD), sis preus i preu únic (3.0TD); el preu únic no inventa P2/P3", () => {
    expect(t20().variants.map((x) => x.id)).toEqual(["p", "u"]);
    expect(lvl(t20(), "p", "FUJI").energy).toEqual([0.316077, 0.227382, 0.184506]);
    expect(lvl(t20(), "p", "ROYAL G").energy).toEqual([0.340524, 0.251829, 0.208954]);
    expect(lvl(t20(), "u", "GALA")).toMatchObject({ energy: [0.247928], energy24h: 0.247928 });
    expect(t30().variants.map((x) => x.id)).toEqual(["p", "p_d30", "u", "u_d30"]);
    expect(lvl(t30(), "p", "GALAXY").energy).toEqual([0.450636, 0.398691, 0.280369, 0.23619, 0.216899, 0.265429]);
    expect(lvl(t30(), "u", "ROYAL G").energy24h).toBe(0.33126);
    expect(lvl(t20(), "p", "FUJI").origin).toEqual({ page: 1, section: "2.0TD · Preu terme d'energia · Tres precios" });
  });
  it("5 · files «30% descuento»: preus finals publicats, amb l'original a part", () => {
    expect(lvl(t30(), "p_d30", "GALA").energy).toEqual([0.309333, 0.272972, 0.190146, 0.159221, 0.145717, 0.179689]);
    expect(lvl(t30(), "u_d30", "FUJI").energy24h).toBe(0.207435);
    expect(lvl(t30(), "p_d30", "GALA").eurMwh).toBe(10); // la comissió és la del nivell
    const it3 = nufriItems(L, { fileName: "annex.pdf", existing: [] }).find((i) => i.offer.productName === "Nufri 3.0TD · Seis precios · 30% descuento")!;
    expect(it3.offer.commercial!.discountPct).toBe(30);
    expect(it3.offer.commercial!.levels.find((l) => l.id === "GALA")!.original!.energy.slice(0, 2)).toEqual([0.441904, 0.38996]);
  });
  it("6 · cap descompte duplicat: el motor i el preu final del catàleg coincideixen amb el preu publicat", () => {
    const it3 = nufriItems(L, { fileName: "annex.pdf", existing: [] }).find((i) => i.offer.productName === "Nufri 3.0TD · Seis precios · 30% descuento")!;
    const o = applyCommercial(it3.offer, { level: "GALA", margin: "BOE+4" });
    expect(o.discounts).toEqual([]);
    const fp = finalPrices(o);
    expect(fp.energy.slice(0, 6)).toEqual([0.309333, 0.272972, 0.190146, 0.159221, 0.145717, 0.179689]);
    expect(fp.original!.energy[0]).toBe(0.441904);
    const s: SupplyInput = { energyType: "luz", accessTariff: "3.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: [1000, 1000, 1000, 1000, 1000, 1000], kwhTotal: null, kw: [40, 40, 40, 40, 40, 40], meterRentEurMonth: null };
    const c = computeCost(o, s);
    expect(c.detail!.energy.map((e) => e.price)).toEqual([0.309333, 0.272972, 0.190146, 0.159221, 0.145717, 0.179689]);
    expect(c.discounts).toBe(0);
  });
});

describe("7–11 · potència i comissions", () => {
  it("7 · 2.0TD: BOE, BOE+2, BOE+4 i BOE+6 amb els preus exactes (€/kW·dia)", () => {
    expect(t20().margins.map((m) => [m.label, m.eurKwYear, ...m.power])).toEqual([
      ["BOE", 0, 0.075903, 0.001987], ["BOE+2", 2, 0.08373, 0.009815], ["BOE+4", 4, 0.091558, 0.017643], ["BOE+6", 6, 0.099386, 0.025471],
    ]);
  });
  it("8–10 · 3.0TD: BOE, BOE+2 i BOE+4 amb els sis preus; no hi ha BOE+6", () => {
    expect(t30().margins.map((m) => [m.label, ...m.power])).toEqual([
      ["BOE", 0.055827, 0.029089, 0.012278, 0.010647, 0.006887, 0.003951],
      ["BOE+2", 0.063655, 0.036917, 0.020106, 0.018475, 0.014715, 0.011779],
      ["BOE+4", 0.071483, 0.044745, 0.027934, 0.026303, 0.022543, 0.019607],
    ]);
    expect(t30().margins.some((m) => m.label === "BOE+6")).toBe(false);
  });
  it("11 · energia i potència es proposen per separat i les comissions no viatgen dins la tarifa", () => {
    const r = nufriRuleProposals(L);
    const gala = r.find((x) => x.rule_key === "nufri_llum_gala")!;
    expect(gala).toMatchObject({ kind: "energia_potencia", value: "10", layer: "proveidor", valid_from: "2026-11-05" });
    expect(r.filter((x) => x.rule_key.startsWith("nufri_llum_index_co")).map((x) => [x.conditions.co_eur_mwh, x.value])).toEqual([[10, "7"], [11, "7.5"], [12, "8.5"], [13, "9"], [14, "10"], [15, "11"], [16, "12"], [17, "13"], [18, "14"], [19, "15"], [20, "16"]]);
    const items = nufriItems(L, { fileName: "annex.pdf", existing: [] });
    expect(JSON.stringify(items.map((i) => i.offer))).not.toMatch(/"eurMwh"|"fixedCommission"|"indexedCommission"|commissionEurMwh|comissi/i);
  });
});

describe("12–14 · gas", () => {
  it("12–13 · RL1–RL4 amb rangs, preus fixos dels quatre nivells i comissions de la modalitat fixa", () => {
    expect(G.gas.map((g) => [g.tariff, g.minKwh, g.maxKwh, g.fixedTerm.value])).toEqual([["RL.1", 0, 5000, 5.17], ["RL.2", 5000, 15000, 8.97], ["RL.3", 15000, 50000, 19.1], ["RL.4", 50000, 300000, 43.31]]);
    expect(G.gas[0].levels.map((l) => l.label)).toEqual(["CONFERENCE", "BARLET", "DEVOE", "WILLIAM'S"]);
    expect(G.gas[0].levels.map((l) => l.fixed)).toEqual([0.107042, 0.11315, 0.117222, 0.121294]);
    expect(G.gas[3].levels.map((l) => l.fixed)).toEqual([0.101603, 0.103639, 0.105675, 0.107711]);
    expect(G.gas.map((g) => g.levels.map((l) => l.fixedCommission))).toEqual([[2, 8, 12, 16], [2, 4, 8, 12], [2, 4, 6, 8], [2, 4, 6, 8]]);
  });
  it("el terme fix no té unitat al document: no se n'assumeix cap i queda pendent d'aprovació", () => {
    expect(G.gas.every((g) => g.fixedTerm.unit === null)).toBe(true);
    expect(G.approvals[0]).toMatch(/no n'indica la unitat/);
    const items = nufriItems(G, { fileName: "gas.pdf", existing: [] }).filter((i) => i.group === "gas_fix");
    expect(items.every((i) => i.offer.gasFixedEurDay === null && i.approvals.length === 1)).toBe(true);
    // confirmada per Direcció com a €/mes → €/dia (× 12 ÷ 365)
    const conf = nufriItems(G, { fileName: "gas.pdf", existing: [], gasFixedUnit: "mes" }).find((i) => i.offer.accessTariff === "RL.1" && i.group === "gas_fix")!;
    expect(conf.offer.gasFixedEurDay).toBeCloseTo((5.17 * 12) / 365, 6);
    expect(conf.approvals).toEqual([]);
  });
  it("14 · modalitat indexada: 1,0379 × PVB + C, constants C per RL i nivell, comissió a part i simulació estimada", () => {
    expect(G.gasIndexedFormula).toMatchObject({ multiplier: 1.0379, index: "PVB", text: "1,0379 x PVB + C" });
    expect(G.gasIndexedFormula!.pvbDefinition).toMatch(/MIBGAS-ES/);
    expect(G.gas.map((g) => g.levels.map((l) => l.c))).toEqual([[0.027127, 0.033235, 0.037307, 0.041379], [0.024009, 0.026045, 0.030117, 0.034189], [0.019551, 0.021587, 0.023623, 0.025659], [0.021689, 0.023725, 0.025761, 0.027797]]);
    expect(G.gas[1].levels.map((l) => l.indexedCommission)).toEqual([2, 4, 8, 12]);
    expect(nufriGasIndexedPrice(0.027127, 40)).toBe(0.068643); // 1,0379 × 40 €/MWh / 1000 + C
    const idx = nufriItems(G, { fileName: "gas.pdf", existing: [] }).filter((i) => i.group === "gas_indexat");
    expect(idx).toHaveLength(4);
    expect(idx.every((i) => i.offer.contractType === "indexat" && i.offer.energy24h == null)).toBe(true); // cap preu fix inventat
    expect(G.conditions.nonTelemeteredOnly).toBe(true);
    expect(G.conditions.customOffer).toMatch(/RL\.4 a partir de 200\s*MWh/);
  });
});

describe("15–16 · excedents, indexada i condicions", () => {
  it("15 · excedents: 2.0TD 40 €/MWh (fins a 15 kW), 3.0TD 30 €/MWh; indexat OMIE − 5 conservat com a fórmula", () => {
    expect([t20().surplus.fixEurMwh, t30().surplus.fixEurMwh]).toEqual([40, 30]);
    expect(t20().surplus.indexed).toBe("Precio OMIE -5 €/MWh");
    const it2 = nufriItems(L, { fileName: "annex.pdf", existing: [] }).find((i) => i.offer.productName === "Nufri 2.0TD · Tres precios")!;
    expect(it2.offer.surplus).toMatchObject({ mode: "fix", eurKwh: 0.04, mechanism: "compensacio_simplificada", limits: "Fins a 15 kW de potència contractada" });
    expect(it2.offer.surplus!.notes).toMatch(/OMIE -5/);
    expect(it2.offer.surplus!.battery).toBeNull(); // Reserva Virtual: annex a part, cost no indicat → no inclosa
  });
  it("16 · indexada elèctrica, energia verda i condicions", () => {
    expect(L.indexed!.formula).toMatch(/^∑ Energía en barras h\*\[OMIEi/);
    expect(L.indexed!.k).toBe(0.018);
    expect(L.indexed!.components.map((c) => c.code)).toEqual(expect.arrayContaining(["OMIEi", "OSi", "Co", "EV", "D", "K"]));
    expect([t20().greenIncluded, t30().greenIncluded]).toEqual([true, false]);
    expect(L.conditions).toMatchObject({ maxAnnualKwh: 100000, newClientsOnly: true, sasIncluded: false, validFrom: "2026-11-05" });
    expect(L.conditions.validUntilNote).toMatch(/annex nou/);
    expect(L.conditions.reserveVirtual).toMatchObject({ available: true, costInformed: false });
    const items = nufriItems(L, { fileName: "annex.pdf", existing: [] });
    expect(items.every((i) => i.offer.validTo === null)).toBe(true); // no s'inventa cap data de caducitat
    expect(items.find((i) => i.group === "indexada")!.offer.formula!.contractText).toMatch(/K = 0.018/);
  });
});

describe("17–20 · importació, comparatives i no-regressió", () => {
  it("17 · un producte per peatge i modalitat (sense duplicats) i reimportar el mateix annex no canvia res", () => {
    const items = nufriItems(L, { fileName: "annex.pdf", existing: [] });
    expect(items.filter((i) => i.group === "2.0TD" || i.group === "3.0TD").map((i) => i.offer.productName)).toEqual([
      "Nufri 2.0TD · Tres precios", "Nufri 2.0TD · Un precio", "Nufri 3.0TD · Seis precios", "Nufri 3.0TD · Seis precios · 30% descuento", "Nufri 3.0TD · Un precio", "Nufri 3.0TD · Un precio · 30% descuento",
    ]);
    const existing = items.map((i) => ({ ...i.offer, status: "activa" as const, productId: `p-${i.offer.productName}` }));
    const again = nufriItems(L, { fileName: "annex.pdf", existing });
    expect(new Set(again.map((i) => i.status))).toEqual(new Set(["sense_canvis"]));
  });
  it("17b · un annex més antic no substitueix mai un de més recent", () => {
    const items = nufriItems(L, { fileName: "annex.pdf", existing: [] });
    const newer = items.map((i) => ({ ...i.offer, status: "activa" as const, productId: `p-${i.offer.productName}`, commercial: i.offer.commercial ? { ...i.offer.commercial, annexDate: "2026-12-01" } : null }));
    const r = nufriItems(L, { fileName: "annex.pdf", existing: newer as OfferVersion[] });
    expect(r.filter((i) => i.offer.commercial).every((i) => i.status === "incompleta" && /més antic/.test(i.errors.join(" ")))).toBe(true);
    expect(annexDateOf(items[0].offer)).toBe("2026-11-05");
  });
  it("18 · la combinació GALA · BOE+4 es calcula amb el motor existent i surt al full / PDF de la comparativa", () => {
    const base = nufriItems(L, { fileName: "annex.pdf", existing: [] }).find((i) => i.offer.productName === "Nufri 3.0TD · Seis precios")!.offer;
    const o = { ...base, status: "activa" as const, validTo: "2027-12-31", permanence: { status: "amb" as const, months: 12, startNote: null, cancellation: null, penalty: null, source: "Prova", exception: null } };
    const s: SupplyInput = { energyType: "luz", accessTariff: "3.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: [5000, 4000, 3000, 6000, 2000, 9000], kwhTotal: null, kw: [40, 40, 40, 40, 40, 40], meterRentEurMonth: null };
    const snap = buildSnapshot({ mode: "manual", supply: s, current: null, offers: [o], adjustments: { [o.id]: { commercial: { level: "GALA", margin: "BOE+4" } } } });
    const ev = snap.result.evaluations[0];
    expect(ev.offer.energy.slice(0, 6)).toEqual([0.441904, 0.38996, 0.271637, 0.227459, 0.208167, 0.256699]);
    expect(ev.offer.power.slice(0, 6)).toEqual([0.071483, 0.044745, 0.027934, 0.026303, 0.022543, 0.019607]);
    expect(ev.offer.productName).toBe("Nufri 3.0TD · Seis precios · GALA");
    const sh = comparisonSheet(snap, "ca");
    expect(sh.columns[1].product).toBe("Nufri 3.0TD · Seis precios · GALA");
    const pdf = renderComparisonPdf(snap, { kind: "resum", lang: "ca", recommendation: null, company: { nombre: "Assessoria 3.0", telefono: "", email: "", web: "", direccion: "" }, salesperson: null });
    expect(Buffer.from(pdf.bytes).toString("latin1")).not.toMatch(/€\/MWh|BOE\+4|comissi/i); // cap comissió al PDF del client
  });
  it("19 · funciona sense clau d'IA: tot és local i les comissions s'amaguen a qui no té accés econòmic", () => {
    const hidden = stripNufriCommissions(L);
    expect(hidden.elec.flatMap((e) => e.variants.flatMap((x) => x.levels.map((l) => l.eurMwh)))).toEqual(Array(30).fill(null));
    expect(hidden.indexed!.rows.every((r) => r.commissionEurMwh === null)).toBe(true);
    expect(hidden.elec[0].variants[0].levels[0].energy).toEqual([0.316077, 0.227382, 0.184506]);
    expect(stripNufriCommissions(G).gas.every((g) => g.levels.every((l) => l.fixedCommission === null && l.indexedCommission === null && l.c != null))).toBe(true);
  });
  it("20 · el lector d'Endesa Open continua igual i no confon els annexos", async () => {
    expect(isEndesaOpen(lp.join("\n"))).toBe(false);
    const e = (await pdfText(new Uint8Array(readFileSync("tests/fixtures/endesa/20261030_3.0TD_OPEN_07_V1.pdf")))).pages;
    expect(isNufriTariffDoc(e.join("\n"))).toBe(false);
    expect(isEndesaOpen(e.join("\n"))).toBe(true);
    expect(parseEndesaOpen(e, "x.pdf").brackets.length).toBeGreaterThan(0);
  });
});
