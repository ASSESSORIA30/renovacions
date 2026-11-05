/**
 * Fase 11 · Comparador fix vs indexat amb escenaris. L'oferta fixa és la REAL de Naturgy (Plan Fijo Luz 3.0, variant
 * M, llegida de l'Excel); la indexada és una fórmula de PROVA (no és cap oferta real) per validar el càlcul.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applyTemplate, gridFromXlsx, productsToOffers, proposeTemplate } from "@/comparator/xlsx-template";
import { analyzeMarket, emptyFormula, explainMarket, formulaMissing, indexedPrices, perUnit, type IndexedFormula, type MarketInput } from "@/comparator/market";
import { computeCost } from "@/comparator/engine";
import { buildSnapshot } from "@/comparator/snapshot";
import { emptySupply } from "@/ui/views/comparatives/state";
import type { OfferVersion } from "@/comparator/types";

const wb = gridFromXlsx(XLSX as never, readFileSync("tests/fixtures/naturgy/NC-Productos-Captacion-PYMES-20261029-VP.xlsx"), "n.xlsx");
const { def } = proposeTemplate(wb, { supplier: "Naturgy", name: "PYMES" });
const offers = productsToOffers(applyTemplate(wb, def), def, { templateId: null, version: 1, fileName: "n.xlsx", today: "2026-11-03" });
const fixed: OfferVersion = { ...offers.find((o) => o.product.code === "E000930TDM")!.offer, status: "activa" };
const formula: IndexedFormula = { ...emptyFormula(), index: "OMIE", granularity: "horari", lossesPct: [16, 15, 14, 13, 12, 10], ssaaEurMWh: 15, marginEurMWh: 12, otherEurMWh: 2, regulatedEurKwh: [0.042, 0.033, 0.019, 0.013, 0.007, 0.004], regulatedIncluded: false, contractText: "Fórmula de prova" };
const indexed: OfferVersion = { ...fixed, id: "idx-prova", productName: "Indexada de prova", supplierName: "Comercialitzadora de prova", contractType: "indexat", energy: Array(6).fill(null), energy24h: null, formula, template: null };
const supply = { ...emptySupply(), accessTariff: "3.0TD", kwh: [9000, 12000, 8000, 10000, 6000, 35000], kw: [40, 40, 40, 40, 40, 40], days: 365 };
const market: MarketInput = { central: [95, 85, 75, 70, 65, 55], lowPct: -20, highPct: 20, source: "Hipòtesi de prova" };

describe("10–11 · fix vs indexat amb escenaris", () => {
  const a = analyzeMarket({ supply, current: fixed, offers: [fixed, indexed], market, periods: 6 });
  const x = a.indexed[0];
  it("preu de la indexada segons la SEVA fórmula: ((índex + SSAA + altres) × (1 + pèrdues) + marge) / 1000 + peatges", () => {
    expect(indexedPrices(formula, market.central as number[], 6)[0]).toBe(Math.round((((95 + 15 + 2) * 1.16 + 12) / 1000 + 0.042) * 1e6) / 1e6);
  });
  it("tres escenaris (baixista < central < alcista) i diferència amb la millor fixa", () => {
    expect(x.complete).toBe(true);
    const [lo, mid, hi] = x.scenarios.map((s) => s.cost.total);
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    expect(a.bestFixed!.cost).toBe(computeCost(fixed, supply).total);
    expect(x.scenarios[1].diffVsFixed).toBe(Math.round((a.bestFixed!.cost - mid) * 100) / 100);
    expect(x.riskRange).toBe(Math.round((hi - lo) * 100) / 100);
  });
  it("punt d'equilibri: al preu de mercat indicat, la indexada costa el mateix que la fixa", () => {
    expect(x.breakEvenMarket).not.toBeNull();
    const avg = x.scenarios[1].avgMarket;
    const f = x.breakEvenMarket! / avg;
    const at = analyzeMarket({ supply, current: null, offers: [fixed, indexed], market: { ...market, central: market.central.map((v) => v! * f), lowPct: 0, highPct: 0 }, periods: 6 }).indexed[0].scenarios[1].cost.total;
    expect(Math.abs(at - a.bestFixed!.cost)).toBeLessThan(2); // el preu d'equilibri s'arrodoneix a 0,01 €/MWh
  });
  it("sensibilitat: cada +1 €/MWh de mercat afegeix ≈ kWh × (1 + pèrdues) / 1000 (+ impostos)", () => {
    expect(x.sensitivityPerEurMWh!).toBeGreaterThan(80);
    expect(x.sensitivityPerEurMWh!).toBeLessThan(130);
    expect(perUnit(-1200, 80000)).toEqual({ month: -100, perMWh: -15 });
  });
  it("sense fórmula completa: INCOMPLET (no s'inventa cap component)", () => {
    expect(formulaMissing({ ...formula, marginEurMWh: null, regulatedEurKwh: null }, 6)).toEqual(["Marge comercial (€/MWh)", "Peatges i càrrecs per període (€/kWh)"]);
    const b = analyzeMarket({ supply, current: null, offers: [fixed, { ...indexed, formula: null }], market, periods: 6 });
    expect(b.indexed[0].complete).toBe(false);
    expect(explainMarket(b).verdict).toBe("incomplet");
  });
  it("no recomana la indexada només perquè sigui més barata a l'escenari baixista", () => {
    const run = (margin: number) => analyzeMarket({ supply, current: null, offers: [fixed, { ...indexed, formula: { ...formula, marginEurMWh: margin } }], market, periods: 6 });
    const onlyLow = run(112);
    expect(onlyLow.indexed[0].scenarios.map((x) => Math.sign(x.diffVsFixed!))).toEqual([1, -1, -1]);
    const e = explainMarket(onlyLow);
    expect(e.verdict).toBe("fixa");
    expect(e.bullets.join(" ")).toMatch(/només surt més barata a l'escenari baixista: no és suficient/);
    // més barata al central però més cara a l'alcista → depèn del risc que vulgui assumir el client
    const mid = run(105);
    expect(mid.indexed[0].scenarios.map((x) => Math.sign(x.diffVsFixed!))).toEqual([1, 1, -1]);
    expect(explainMarket(mid).verdict).toBe("indiferent");
    expect(explainMarket(run(12)).verdict).toBe("indexada");
  });
  it("la comparativa desada inclou l'anàlisi (el servidor la recalcula)", () => {
    const s = buildSnapshot({ mode: "manual", supply, current: fixed, offers: [fixed, indexed], market }, "2026-11-03");
    expect(s.marketAnalysis?.indexed[0].scenarios.length).toBe(3);
    expect(s.marketAnalysis?.hypotheses.join(" ")).toMatch(/no previsions oficials/);
    expect(buildSnapshot({ mode: "manual", supply, current: fixed, offers: [fixed] }, "2026-11-03").marketAnalysis).toBeNull();
  });
  it("clients 3.0TD amb corba horària: el consum per període surt de la corba", () => {
    const hourly = Array.from({ length: 24 }, (_, h) => ({ date: "2027-01-13", hour: h, kwh: 10 }));
    const c = analyzeMarket({ supply: { ...supply, hourly }, current: null, offers: [fixed, indexed], market, periods: 6 });
    expect(c.kwhSource).toBe("corba_horaria");
    expect(c.kwhTotal).toBe(240);
  });
});

import { renderComparisonPdf } from "@/comparator/pdf";
describe("12 · informe PDF amb resultats i hipòtesis", () => {
  it("afegeix la pàgina «Fixa vs indexada» amb escenaris, punt d'equilibri, risc i hipòtesis", async () => {
    const s = buildSnapshot({ mode: "manual", client: { name: "Client de prova", taxId: null, address: null, email: null, phone: null }, supply, current: fixed, offers: [fixed, indexed], market }, "2026-11-03");
    const company = { nombre: "Assessoria 3.0", telefono: "", email: "", web: "", direccion: "" };
    for (const kind of ["resum", "detallada"] as const) {
      const pdf = renderComparisonPdf(s, { kind, lang: "ca", recommendation: null, company, salesperson: null });
      const { extractText, getDocumentProxy } = await import("unpdf");
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf.bytes)), { mergePages: true });
      const t = String(text).replace(/\s+/g, " ");
      expect(t).toContain("Fixa vs indexada · escenaris de mercat");
      expect(t).toContain("Indexada — baixista");
      expect(t).toContain("Indexada — alcista");
      expect(t).toContain("Punt d'equilibri");
      expect(t).toContain("no previsions oficials");
      expect(t).toContain("Imports contractuals");
    }
  });
});
