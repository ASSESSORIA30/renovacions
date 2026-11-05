/**
 * Catàleg de tarifes · PREU FINAL AMB DESCOMPTE.
 * Cas real de document públic de tarifes: gas RL.4–RL.6 amb un 22 % sobre el terme variable durant 1 any
 * (el document publica també els preus amb descompte, que han de coincidir amb el càlcul).
 */
import { describe, expect, it } from "vitest";
import { finalPrices } from "@/comparator/final-prices";
import { aiTariffsToVersions } from "@/comparator/tariff-ai";
import { parseDiscount, simulateDiscounts } from "@/comparator/tariff-discounts";
import { blankOfferForTest } from "./helpers/offer";

const gasDoc = (extra: Record<string, unknown> = {}) => ({
  supplierName: "Comercialitzadora Prova",
  validFrom: "2026-10-31",
  validTo: "2026-11-16",
  offers: [
    { productName: "Gas Estable", energyType: "gas", accessTariff: "RL.4", energy24h: 0.146686, energyUnit: "€/kWh", gasFixedValue: 43.313, gasFixedUnit: "€/mes", discountPct: 22, discountOn: "energia", discountMonths: 12, discountConditional: false, discountText: "22% durante 1 año sobre el término variable", energyWithDiscount: [0.114415], confidence: "alta", ...extra },
    { productName: "Gas Estable", energyType: "gas", accessTariff: "RL.5", energy24h: 0.146598, energyUnit: "€/kWh", gasFixedValue: 242.632, gasFixedUnit: "€/mes", discountPct: 22, discountOn: "energia", discountMonths: 12, discountConditional: false, energyWithDiscount: [0.114346], confidence: "alta", ...extra },
    { productName: "Gas Estable", energyType: "gas", accessTariff: "RL.6", energy24h: 0.135117, energyUnit: "€/kWh", gasFixedValue: 1168.049, gasFixedUnit: "€/mes", discountPct: 22, discountOn: "energia", discountMonths: 12, discountConditional: false, energyWithDiscount: [0.105391], confidence: "alta", ...extra },
  ],
  warnings: [],
});

describe("preu final amb descompte al catàleg", () => {
  it("descompte posat a l'editor: mostra el preu final i l'original", () => {
    const o = blankOfferForTest({ energyType: "gas", accessTariff: "RL.4", contractType: "fix24h", energy24h: 0.146686, gasFixedEurDay: 1.424, discounts: [{ concept: "Descompte", pct: 22, eurYear: null, base: "energia" }] });
    const fp = finalPrices(o);
    expect(fp.energy24h).toBe(0.114415);
    expect(fp.original?.energy24h).toBe(0.146686);
    expect(fp.energyPct).toBe(22);
    expect(fp.label).toContain("22 % terme variable");
  });

  it("sense descompte: el preu final és el desat i no hi ha original", () => {
    const o = blankOfferForTest({ energy: [0.15, 0.12, 0.1, null, null, null] });
    const fp = finalPrices(o);
    expect(fp.energy.slice(0, 3)).toEqual([0.15, 0.12, 0.1]);
    expect(fp.original).toBeNull();
    expect(fp.energyPct).toBe(0);
  });

  it("descompte sobre el total: no es converteix en preu per kWh (només nota)", () => {
    const o = blankOfferForTest({ energy: [0.15, 0.12, 0.1, null, null, null], discounts: [{ concept: "Bo", pct: 5, eurYear: null, base: "total_sense_impostos" }] });
    const fp = finalPrices(o);
    expect(fp.energy[0]).toBe(0.15);
    expect(fp.original).toBeNull();
    expect(fp.notes[0]).toContain("total de la factura");
  });
});

describe("lector de tarifes amb IA · descompte del document", () => {
  const r = aiTariffsToVersions(gasDoc(), { fileName: "gas-estable.pdf", existing: [], today: "2026-11-04" });

  it("desa el preu FINAL (coincideix amb la taula «amb descompte» del document) i conserva l'original", () => {
    expect(r.items.map((i) => i.offer.energy24h)).toEqual([0.114415, 0.114346, 0.105391]);
    expect(r.items.map((i) => i.offer.template?.original?.energy[0])).toEqual([0.146686, 0.146598, 0.135117]);
    for (const i of r.items) {
      expect(i.warnings.join(" ")).not.toContain("no coincideix");
      expect(i.errors).toEqual([]);
      expect(i.offer.discounts).toEqual([]); // no es torna a aplicar al comparador
      expect(i.offer.conditions).toContain("22 %");
    }
  });

  it("el catàleg mostra final + original sense aplicar el descompte dues vegades", () => {
    const fp = finalPrices(r.items[0].offer);
    expect(fp.energy24h).toBe(0.114415);
    expect(fp.original?.energy24h).toBe(0.146686);
    expect(fp.energyPct).toBe(22);
  });

  it("el simulador entén el text: 22 % el 1r any i preu original el 2n any", () => {
    const o = r.items[0].offer;
    const d = parseDiscount(o.template!.discountText!, "gas");
    const inp = { energy: o.template!.original!.energy, power: [], powerUnit: "eur_kw_dia" as const, discount: d, energyType: "gas" as const };
    const opts = { conditions: [], annualMWh: null, combination: "suma" as const };
    expect(simulateDiscounts(inp, { ...opts, year: 1 }).final.energy[0]).toBe(0.114415);
    expect(simulateDiscounts(inp, { ...opts, year: 2 }).final.energy[0]).toBe(0.146686);
  });

  it("si la IA ha copiat el preu ja descomptat com a base, no el torna a descomptar", () => {
    const x = aiTariffsToVersions(gasDoc({ energy24h: 0.114415, energyWithDiscount: [0.114415] }), { fileName: "g.pdf", existing: [], today: "2026-11-04" });
    expect(x.items[0].offer.energy24h).toBe(0.114415);
    expect(x.items[0].warnings.join(" ")).toContain("ja són els preus amb descompte");
  });

  it("avisa si el preu amb descompte del document no quadra amb el percentatge", () => {
    const x = aiTariffsToVersions(gasDoc({ energyWithDiscount: [0.1] }), { fileName: "g.pdf", existing: [], today: "2026-11-04" });
    expect(x.items[0].warnings.join(" ")).toContain("no coincideix");
    expect(x.items[0].status).toBe("revisio");
  });

  it("un descompte condicionat no s'aplica al preu final", () => {
    const x = aiTariffsToVersions(gasDoc({ discountConditional: true, energyWithDiscount: null }), { fileName: "g.pdf", existing: [], today: "2026-11-04" });
    expect(x.items[0].offer.energy24h).toBe(0.146686);
    expect(x.items[0].warnings.join(" ")).toContain("condicionat");
  });

  it("electricitat: descompte sobre energia i potència", () => {
    const x = aiTariffsToVersions({ supplierName: "Prova", offers: [{ productName: "Fix", energyType: "luz", accessTariff: "2.0TD", contractType: "periodes", energy: [0.2, 0.15, 0.1], power: [0.1, 0.05], powerUnit: "eur_kw_dia", sas: "inclos", discountPct: 10, discountOn: "energia_potencia", discountConditional: false, confidence: "alta" }] }, { fileName: "l.pdf", existing: [], today: "2026-11-04" });
    const o = x.items[0].offer;
    expect(o.energy.slice(0, 3)).toEqual([0.18, 0.135, 0.09]);
    expect(o.power.slice(0, 2)).toEqual([0.09, 0.045]);
    const fp = finalPrices(o);
    expect(fp.energyPct).toBe(10);
    expect(fp.powerPct).toBe(10);
    expect(fp.original?.power.slice(0, 2)).toEqual([0.1, 0.05]);
  });
});
