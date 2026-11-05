import { describe, expect, it } from "vitest";
import { computeCost, eligibility, normalizeTariff, periodsOf, powerPerDay } from "@/comparator/engine";
import { runComparison } from "@/comparator/ranking";
import { checkVersion, fromCrmOffer, priceChanged, newVersionFrom } from "@/comparator/catalog";
import { autoMap, detectHeaderRow, parseCsv, previewImport, toNumber } from "@/comparator/tariff-import";
import { DEFAULT_TAXES, emptySheet, type OfferVersion, type PriceSheet, type SupplyInput } from "@/comparator/types";

const supply = (p: Partial<SupplyInput> = {}): SupplyInput => ({
  energyType: "luz",
  accessTariff: "2.0TD",
  territory: "peninsula",
  segment: "residencial",
  days: 365,
  basis: "anual",
  kwh: [1000, 800, 1200, null, null, null],
  kwhTotal: null,
  kw: [4.6, 4.6, null, null, null, null],
  meterRentEurMonth: 0.81,
  ...p,
});
const sheet = (p: Partial<PriceSheet> = {}): PriceSheet => ({ ...emptySheet(), energy: [0.2, 0.15, 0.1, null, null, null], power: [0.1, 0.05, null, null, null, null], ...p });
const offer = (p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...sheet(),
  id: p.id ?? "o1",
  supplierId: "s",
  supplierName: "Comercialitzadora A",
  productId: "p",
  productName: "Fix",
  version: 1,
  energyType: "luz",
  accessTariff: "2.0TD",
  segments: ["residencial", "pyme"],
  permanenceMonths: null,
  penalty: null,
  durationMonths: 12,
  priceGuaranteeMonths: 12,
  eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  source: "test",
  publishedAt: "2026-10-01",
  status: "activa",
  conditions: null,
  origin: "manual",
  ...p,
});

describe("Motor · càlcul 2.0TD per períodes (desglossament i redondeig)", () => {
  const r = computeCost(sheet(), supply());
  it("energia P1–P3 i potència en €/kW·dia", () => {
    expect(r.ok).toBe(true);
    expect(r.energy).toBe(440); // 200 + 120 + 120
    expect(r.power).toBe(251.85); // 4,6×0,10×365 + 4,6×0,05×365
  });
  it("impost elèctric, lloguer, IVA i total quadren al cèntim", () => {
    expect(r.subtotal).toBe(691.85);
    expect(r.iee).toBe(35.37); // 5,11269632 % × 691,85
    expect(r.rent).toBe(9.72);
    expect(r.vatBase).toBe(736.94);
    expect(r.vat).toBe(154.76);
    expect(r.total).toBe(891.7);
    expect(r.lines.reduce((a, l) => a + Math.round(l.amount * 100), 0) / 100).toBe(r.total);
    expect(r.quality).toBe("exacte");
  });
  it("la potència dona el mateix en €/kW·dia, €/kW·mes i €/kW·any", () => {
    const any = computeCost(sheet({ power: [36.5, 18.25, null, null, null, null], powerUnit: "eur_kw_any" }), supply());
    const mes = computeCost(sheet({ power: [36.5 / 12, 18.25 / 12, null, null, null, null], powerUnit: "eur_kw_mes" }), supply());
    expect(any.power).toBe(251.85);
    expect(mes.power).toBe(251.85);
    expect(powerPerDay(36.5, "eur_kw_any").toNumber()).toBeCloseTo(0.1, 12);
  });
});

describe("Motor · regles de dades", () => {
  it("sense consum per períodes no reparteix el total: incomplet", () => {
    const r = computeCost(sheet(), supply({ kwh: [null, null, null, null, null, null], kwhTotal: 3000 }));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("Consum P1 (kWh)");
    expect(r.quality).toBe("incomplet");
  });
  it("una oferta de preu únic es pot calcular només amb el consum total (mode només CUPS)", () => {
    const r = computeCost(sheet({ contractType: "fix24h", energy: Array(6).fill(null), energy24h: 0.15 }), supply({ kwh: [null, null, null, null, null, null], kwhTotal: 3000 }));
    expect(r.ok).toBe(true);
    expect(r.energy).toBe(450);
  });
  it("SAS inclòs no suma; SAS variable suma i marca estimació", () => {
    expect(computeCost(sheet({ sas: { mode: "inclos", eurKwh: 0.02 } }), supply()).sas).toBe(0);
    const v = computeCost(sheet({ sas: { mode: "variable", eurKwh: 0.01 } }), supply());
    expect(v.sas).toBe(30);
    expect(v.quality).toBe("estimat");
    const nv = computeCost(sheet({ sas: { mode: "variable", eurKwh: null } }), supply());
    expect(nv.notes.join()).toMatch(/no s'ha quantificat/);
  });
  it("descompte sobre energia: s'aplica una sola vegada i redueix la base de l'impost elèctric", () => {
    const r = computeCost(sheet({ discounts: [{ concept: "Benvinguda", pct: 10, eurYear: null, base: "energia" }] }), supply());
    expect(r.discounts).toBe(44);
    expect(r.subtotal).toBe(647.85);
    expect(r.iee).toBe(33.12); // 5,11269632 % × 647,85
  });
  it("preus publicats amb IEE i IVA es converteixen a base sense impostos", () => {
    const f = (1 + DEFAULT_TAXES.ieePct / 100) * 1.21;
    const incl = computeCost(sheet({ energy: [0.2 * f, 0.15 * f, 0.1 * f, null, null, null], power: [0.1 * f, 0.05 * f, null, null, null, null], taxTreatment: "amb_iee_iva" }), supply());
    expect(incl.total).toBe(891.7);
  });
  it("gas: energia + terme fix + impost d'hidrocarburs, sense potència", () => {
    const r = computeCost(
      { ...emptySheet(), contractType: "fix24h", energy24h: 0.06, gasFixedEurDay: 0.3 },
      supply({ energyType: "gas", accessTariff: "RL.2", kwh: Array(6).fill(null), kwhTotal: 9500, kw: Array(6).fill(null), meterRentEurMonth: null }),
    );
    expect(r.ok).toBe(true);
    expect(r.energy).toBe(570);
    expect(r.fixed).toBe(109.5);
    expect(r.iee).toBe(22.23);
    expect(r.total).toBe(849.09);
  });
  it("Canàries: IGIC 0 % per a habitatges ≤ 10 kW", () => {
    const r = computeCost(sheet(), supply({ territory: "canaries", residentialLowPower: true }));
    expect(r.vat).toBe(0);
    expect(r.lines.at(-1)!.label).toMatch(/IGIC/);
  });
  it("3.0TD i 6.1TD fan servir 6 períodes", () => {
    expect(periodsOf("3.0TD")).toMatchObject({ energy: 6, power: 6 });
    expect(periodsOf("6.1 TD")).toMatchObject({ energy: 6, power: 6 });
    expect(normalizeTariff("2.0 td")).toBe("2.0TD");
    const s = supply({ accessTariff: "6.1TD", kwh: [1e5, 1e5, 1e5, 1e5, 1e5, 1e5], kw: [400, 400, 400, 400, 400, 450] });
    const r = computeCost(sheet({ energy: [0.2, 0.18, 0.16, 0.14, 0.12, 0.1], power: [0.08, 0.07, 0.04, 0.03, 0.01, 0.006] }), s);
    expect(r.ok).toBe(true);
    expect(r.energy).toBe(90000);
  });
});

describe("Elegibilitat i classificació", () => {
  it("exclou ofertes caducades, incompatibles i de segment o rang no vàlid", () => {
    const s = supply();
    expect(eligibility(offer({ validTo: "2025-12-31" }), s, "2026-10-31").reasons.join()).toMatch(/Caducada/);
    expect(eligibility(offer({ accessTariff: "3.0TD" }), s, "2026-10-31").eligible).toBe(false);
    expect(eligibility(offer({ segments: ["pyme"] }), s, "2026-10-31").eligible).toBe(false);
    expect(eligibility(offer({ status: "esborrany" }), s, "2026-10-31").eligible).toBe(false);
    expect(eligibility(offer({ eligibility: { minKwh: 5000, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null } }), s, "2026-10-31").eligible).toBe(false);
    expect(eligibility(offer(), s, "2026-10-31").eligible).toBe(true);
  });
  it("estalvi respecte de l'actual i etiquetes verificables", () => {
    const cur = sheet({ energy: [0.25, 0.2, 0.15, null, null, null], power: [0.12, 0.06, null, null, null, null] });
    const a = offer({ id: "a" });
    const b = offer({ id: "b", energy: [0.19, 0.14, 0.09, null, null, null], permanenceMonths: 12 });
    const c = offer({ id: "c", contractType: "indexat", energy: Array(6).fill(null), indexedReference: { energy: [0.18, 0.13, 0.08, null, null, null], note: "mitjana", asOf: "2026-09" } });
    const x = offer({ id: "x", validTo: "2020-01-01" });
    const r = runComparison({ supply: supply(), current: cur, offers: [a, b, c, x], today: "2026-10-31" });
    expect(r.current!.ok).toBe(true);
    expect(r.ranked.map((e) => e.offer.id)).not.toContain("x");
    const ea = r.evaluations.find((e) => e.offer.id === "a")!;
    expect(ea.saving).toBe(Math.round((r.current!.total - ea.cost.total) * 100) / 100);
    expect(ea.savingPct).toBeGreaterThan(0);
    expect(r.highlights.cheapest).toBe("c");
    expect(r.highlights.noPermanence).not.toBe("b");
    expect(r.highlights.leastVariable).not.toBe("c");
    expect(r.evaluations.find((e) => e.offer.id === "c")!.cost.quality).toBe("estimat");
  });
  it("sense preus actuals no hi ha estalvi (no s'inventa el cost actual)", () => {
    const r = runComparison({ supply: supply(), current: null, offers: [offer()], today: "2026-10-31" });
    expect(r.current).toBeNull();
    expect(r.evaluations[0].saving).toBeNull();
    expect(r.highlights.bestSaving).toBeNull();
  });
  it("una comissió afegida a l'oferta no altera la classificació", () => {
    const a = offer({ id: "a" });
    const b = offer({ id: "b", energy: [0.21, 0.16, 0.11, null, null, null] });
    const base = runComparison({ supply: supply(), current: null, offers: [a, b], today: "2026-10-31" }).ranked.map((e) => e.offer.id);
    const withCommission = runComparison({ supply: supply(), current: null, offers: [a, { ...b, commission: 9999 } as OfferVersion], today: "2026-10-31" }).ranked.map((e) => e.offer.id);
    expect(withCommission).toEqual(base);
    expect(base[0]).toBe("a");
  });
});

describe("Catàleg · versions i ofertes del CRM", () => {
  it("valida unitats i dades abans d'activar", () => {
    expect(checkVersion(offer()).ok).toBe(true);
    expect(checkVersion(offer({ energy: [150, 0.15, 0.1, null, null, null] })).errors.join()).toMatch(/fora de rang/);
    expect(checkVersion(offer({ power: [0.1, null, null, null, null, null] })).errors.join()).toMatch(/potència P2/);
    expect(checkVersion(offer({ accessTariff: "XYZ" })).ok).toBe(false);
  });
  it("una nova versió és un esborrany amb número següent i detecta canvis de preu", () => {
    const o = offer();
    const n = newVersionFrom(o, { energy: [0.21, 0.15, 0.1, null, null, null] });
    expect(n.version).toBe(2);
    expect(n.status).toBe("esborrany");
    expect(n.id).not.toBe(o.id);
    expect(priceChanged(o, n)).toBe(true);
    expect(priceChanged(o, { ...o, conditions: "x" })).toBe(false);
  });
  it("adapta les ofertes verificades del CRM (€/kW·dia)", () => {
    const v = fromCrmOffer({ id: "of-1", comercializadora: "Naturgy", nombre: "Tarifa Fix", tarifa: "2.0TD", energia: [0.14, 0.14, 0.14], potencia: [0.09, 0.03], validaHasta: "2026-12-31", verificada: true });
    expect(v.contractType).toBe("fix24h");
    expect(v.energy24h).toBe(0.14);
    expect(v.powerUnit).toBe("eur_kw_dia");
    expect(v.status).toBe("activa");
    const g = fromCrmOffer({ id: "of-2", comercializadora: "Repsol", nombre: "Gas", tarifa: "RL2", energia: [0.07], potencia: [], fijoDia: 0.3, validaHasta: "2026-12-31", verificada: true, tipo: "gas" });
    expect(g.energyType).toBe("gas");
    expect(g.gasFixedEurDay).toBe(0.3);
  });
});

describe("Importació Excel/CSV", () => {
  const rows = [
    ["Tarifes octubre 2026", null],
    ["Comercializadora", "Producto", "Tarifa acceso", "Energia P1", "Energia P2", "Energia P3", "Potencia P1", "Potencia P2", "Unidad potencia", "SAS", "Hasta"],
    ["Endesa", "One Luz", "2.0TD", "0,182", "0,145", "0,121", "0,0912", "0,0301", "€/kW día", "Incluido", "31/12/2026"],
    ["Endesa", "One Luz", "2.0TD", "0,182", "0,145", "0,121", "0,0912", "0,0301", "€/kW día", "Incluido", "31/12/2026"],
    ["Iberdrola", "Plan Estable", "2.0TD", "", "0,14", "0,11", "0,09", "0,03", "€/kW día", "Incluido", "31/12/2026"],
    ["Repsol", "Ahorro", "2.0TD", "0,16", "0,13", "0,11", "33,2", "11", "€/kW año", "variable", "31/12/2026"],
    ["Holaluz", "Tarifa Mal", "2.0TD", "160", "130", "110", "0,09", "0,03", "€/kW día", "Incluido", "31/12/2026"],
  ];
  it("detecta la fila de capçaleres i mapa les columnes", () => {
    expect(detectHeaderRow(rows)).toBe(1);
    const m = autoMap(rows[1] as string[]);
    expect(m).toMatchObject({ supplier: "Comercializadora", product: "Producto", tariff: "Tarifa acceso", e1: "Energia P1", p2: "Potencia P2", powerUnit: "Unidad potencia", sas: "SAS", validTo: "Hasta" });
  });
  it("simula la importació: noves, duplicades, rebutjades i amb revisió", () => {
    const existing = [offer({ supplierName: "Repsol", productName: "Ahorro", productId: "p-rep", version: 3, energy: [0.17, 0.13, 0.11, null, null, null] })];
    const p = previewImport(rows, 1, autoMap(rows[1] as string[]), { source: "Excel test", existing, today: "2026-10-31" });
    const st = p.rows.map((r) => r.status);
    expect(st).toEqual(["nova", "duplicada", "rebutjada", "revisio", "rebutjada"]);
    expect(p.rows[2].errors.join()).toMatch(/energia P1/);
    expect(p.rows[4].errors.join()).toMatch(/fora de rang/);
    const rep = p.rows[3].offer!;
    expect(rep.powerUnit).toBe("eur_kw_any");
    expect(rep.version).toBe(4);
    expect(rep.productId).toBe("p-rep");
    expect(rep.status).toBe("esborrany"); // mai s'activa automàticament
    expect(p.counts.rebutjada).toBe(2);
  });
  it("números i CSV en format espanyol", () => {
    expect(toNumber("1.234,56")).toBe(1234.56);
    expect(toNumber("0,145 €/kWh")).toBe(0.145);
    expect(toNumber("")).toBeNull();
    expect(parseCsv('a;b;c\n"x;1";2,5;\n')).toEqual([["a", "b", "c"], ["x;1", "2,5", ""]]);
  });
});
