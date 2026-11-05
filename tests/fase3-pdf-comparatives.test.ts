/**
 * FASE 3 · PDF de comparatives en 4 columnes (ACTUAL | OPCIÓ 1 | OPCIÓ 2 | OPCIÓ 3), A4 horitzontal.
 * Comprova que el full surt del mateix resultat que la pantalla i genera PDFs reals de 2.0TD, 3.0TD, 6.1TD i gas.
 * Dades fictícies. Amb PDF_OUT=<carpeta> es desen els PDFs per revisar-los visualment.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildSnapshot, presentationOrder, type Snapshot } from "@/comparator/snapshot";
import { comparisonSheet, periodLabel, type PricedBlock, type ValueBlock } from "@/comparator/sheet-view";
import { renderComparisonPdf } from "@/comparator/pdf";
import { emptySheet, emptySurplus, type OfferVersion, type PriceSheet, type SupplyInput } from "@/comparator/types";

vi.mock("server-only", () => ({}));

const TODAY = new Date().toISOString().slice(0, 10);
const NEXT = `${Number(TODAY.slice(0, 4)) + 1}-12-31`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const perm = (months: number) => ({ status: "amb" as const, months, startNote: null, cancellation: null, penalty: "5 % de l'energia pendent", source: "Condicions generals", exception: null });
const offer = (n: number, supplier: string, p: Partial<OfferVersion>): OfferVersion => ({
  ...emptySheet(), id: uuid(n), supplierId: `s${n}`, supplierName: supplier, productId: `p${n}`, productName: `Tarifa Prova ${n}`, version: 1, energyType: "luz", accessTariff: "2.0TD",
  segments: ["residencial", "pyme", "industrial"], permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12,
  eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: NEXT, source: "Prova", publishedAt: null, status: "activa", conditions: null, origin: "manual", ...p,
});
const supply = (p: Partial<SupplyInput>): SupplyInput => ({ energyType: "luz", accessTariff: "2.0TD", territory: "peninsula", segment: null, days: 30, basis: "periode_facturat", kwh: Array(6).fill(null), kwhTotal: null, kw: Array(6).fill(null), meterRentEurMonth: 1.2, residentialLowPower: false, periodFrom: "2026-09-01", periodTo: "2026-09-30", ...p });
const sheet = (p: Partial<PriceSheet>): PriceSheet => ({ ...emptySheet(), ...p });
const company = { nombre: "Assessoria 3.0", telefono: "900 000 000", email: "info@exemple.test", web: "exemple.test", direccion: "" };
const client = { name: "CLIENT FICTICI PROVA SL", taxId: null, address: null, email: null, phone: null };

const CASES: Record<string, Snapshot> = {
  "2.0TD": buildSnapshot({
    mode: "factura", client, cups: "ES0000000000000000AA0F", currentRetailer: "Comercialitzadora Actual SA",
    supply: supply({ kwh: [120, 140, 200, null, null, null], kw: [4.6, 4.6, null, null, null, null] }),
    current: sheet({ energy: [0.26, 0.19, 0.15, null, null, null], power: [0.11, 0.035, null, null, null, null] }),
    offers: [
      offer(1, "Verda Energia", { contractType: "fix24h", energy24h: 0.149, power: [0.09, 0.03, null, null, null, null] }),
      offer(2, "Llum Clara", { energy: [0.21, 0.16, 0.12, null, null, null], power: [0.095, 0.032, null, null, null, null], discounts: [{ concept: "Benvinguda", pct: 10, eurYear: null, base: "energia" }] }),
      offer(3, "Mar i Sol", { energy: [0.2, 0.17, 0.13, null, null, null], power: [0.1, 0.03, null, null, null, null], fees: [{ concept: "Manteniment", eurMonth: 2.5 }] }),
    ],
  }, TODAY),
  "3.0TD": buildSnapshot({
    mode: "factura", client, cups: "ES0000000000000000BB0F", currentRetailer: "Nufri (fictícia)",
    supply: supply({ accessTariff: "3.0TD", kwh: [1234, 980, 1289, 2100, 300, 3050], kw: [15, 15, 15, 15, 15, 20], surplus: { kwhTotal: 420, monthly: null, byPeriod: null, currentCompensationEur: 18.9, currentMode: "fix", battery: false, batteryBalanceEur: null, estimated: false } }),
    current: sheet({ energy: [0.25, 0.22, 0.233934, 0.206837, 0.19, 0.234553], power: [0.06789, 0.03512, 0.01432, 0.01245, 0.00811, 0.00473] }),
    offers: [
      offer(4, "Energia del Pla", { accessTariff: "3.0TD", energy: [0.19, 0.17, 0.15, 0.14, 0.12, 0.11], power: [0.06, 0.03, 0.013, 0.011, 0.007, 0.004], permanence: perm(12), permanenceMonths: 12, surplus: { ...emptySurplus("fix"), eurKwh: 0.05 } }),
      offer(5, "Corrent Nord", { accessTariff: "3.0TD", energy: [0.2, 0.18, 0.16, 0.15, 0.13, 0.12], power: [0.062, 0.031, 0.014, 0.012, 0.008, 0.0045], permanenceMonths: null, sas: { mode: "variable", eurKwh: 0.012 }, surplus: { ...emptySurplus("bateria"), eurKwh: 0.06, battery: { enabled: true, feeEurMonth: 1.5, accumulation: null, usage: null, expiry: null } } }),
      offer(6, "Ones Verdes", { accessTariff: "3.0TD", energy: [0.21, 0.19, 0.17, 0.16, 0.14, 0.13], power: [0.065, 0.032, 0.015, 0.012, 0.008, 0.005], permanence: perm(24), permanenceMonths: 24 }),
    ],
  }, TODAY),
  "6.1TD": buildSnapshot({
    mode: "manual", client, cups: "ES0000000000000000CC0F", currentRetailer: "Indústria Elèctrica Actual",
    supply: supply({ accessTariff: "6.1TD", basis: "anual", days: 365, periodFrom: null, periodTo: null, kwh: [42000, 51000, 38000, 60000, 25000, 98000], kw: [450, 450, 450, 450, 450, 500], meterRentEurMonth: 25 }),
    current: sheet({ energy: [0.21, 0.19, 0.17, 0.15, 0.13, 0.11], power: [0.07, 0.06, 0.03, 0.025, 0.003, 0.002] }),
    offers: [
      offer(7, "Alta Tensió Plus", { accessTariff: "6.1TD", energy: [0.18, 0.16, 0.14, 0.12, 0.1, 0.09], power: [0.065, 0.055, 0.028, 0.022, 0.0025, 0.0018], permanence: perm(12), permanenceMonths: 12 }),
      offer(8, "Indexa Pro", { accessTariff: "6.1TD", contractType: "indexat", indexedReference: { energy: [0.17, 0.155, 0.135, 0.12, 0.1, 0.085], note: "Referència fictícia", asOf: TODAY }, power: [0.066, 0.056, 0.029, 0.023, 0.0026, 0.0019] }),
      offer(9, "Potència Neta", { accessTariff: "6.1TD", energy: [0.185, 0.165, 0.145, 0.125, 0.105, 0.095], power: [0.064, 0.054, 0.027, 0.021, 0.0024, 0.0017], permanence: perm(36), permanenceMonths: 36 }),
    ],
  }, TODAY),
  gas: buildSnapshot({
    mode: "factura", client, cups: "ES0000000000000000DD0F", currentRetailer: "Gas Actual SA",
    supply: supply({ energyType: "gas", accessTariff: "RL.2", days: 62, kwhTotal: 2850, kwh: [2850, null, null, null, null, null], meterRentEurMonth: 0.6, periodFrom: "2026-08-01", periodTo: "2026-09-30" }),
    current: sheet({ contractType: "fix24h", energy24h: 0.085, gasFixedEurDay: 0.32 }),
    offers: [
      offer(10, "Gas Proper", { energyType: "gas", accessTariff: "RL.2", contractType: "fix24h", energy24h: 0.071, gasFixedEurDay: 0.28 }),
      offer(11, "Flama Blava", { energyType: "gas", accessTariff: "RL.2", contractType: "fix24h", energy24h: 0.075, gasFixedEurDay: 0.25 }),
      offer(12, "Caldera Fàcil", { energyType: "gas", accessTariff: "RL.2", contractType: "fix24h", energy24h: 0.079, gasFixedEurDay: 0.22 }),
    ],
  }, TODAY),
};

const priced = (sh: ReturnType<typeof comparisonSheet>, id: string) => sh.blocks.find((b) => b.id === id) as PricedBlock | undefined;
const values = (sh: ReturnType<typeof comparisonSheet>, id: string) => sh.blocks.find((b) => b.id === id) as ValueBlock | undefined;
const num = (t: string) => Number(t.replace(/[−]/g, "-").replace(/[^\d,\-]/g, "").replace(",", "."));

describe("Fase 3 · full de comparació en 4 columnes", () => {
  for (const [name, s] of Object.entries(CASES)) {
    describe(name, () => {
      const sh = comparisonSheet(s, "ca");
      const alts = presentationOrder(s);
      const costs = [s.result.current!, ...alts.map((e) => e.cost)];
      it("4 columnes en ordre fix (actual + 3 alternatives del catàleg) i els quatre totals = pantalla", () => {
        expect(sh.columns.map((c) => c.role)).toEqual(["ACTUAL", "OPCIÓ 1", "OPCIÓ 2", "OPCIÓ 3"]);
        expect(sh.columns.slice(1).map((c) => c.supplier)).toEqual(alts.map((e) => e.offer.supplierName));
        expect(sh.totals.values).toEqual(costs.map((c) => c.total));
        expect(sh.savings.values.slice(1)).toEqual(alts.map((e) => e.saving));
        expect(costs.every((c) => c.ok)).toBe(true);
      });
      it("subtotals d'energia i potència / terme fix = motor, i la suma per període quadra (±1 cèntim per fila)", () => {
        const e = priced(sh, "energia")!;
        expect(e.total.values).toEqual(costs.map((c) => c.energy));
        costs.forEach((c, i) => {
          const sum = e.rows.reduce((a, r) => a + num(r.cells[i].amount), 0);
          expect(Math.abs(sum - c.energy)).toBeLessThanOrEqual(0.01 * e.rows.length);
        });
        const p = priced(sh, s.supply.energyType === "gas" ? "fix_gas" : "potencia")!;
        expect(p.total.values).toEqual(costs.map((c) => (s.supply.energyType === "gas" ? c.detail!.gasFixed!.amount : c.power)));
      });
      it("períodes correctes: no s'inventen períodes i el preu únic s'aplica a cada període", () => {
        const e = priced(sh, "energia")!;
        expect(e.rows.map((r) => r.label)).toEqual(name === "2.0TD" ? ["P1", "P2", "P3"] : name === "gas" ? ["Variable"] : ["P1", "P2", "P3", "P4", "P5", "P6"]);
        if (name === "2.0TD") {
          const i = sh.columns.findIndex((c) => c.supplier === "Verda Energia");
          expect(new Set(e.rows.map((r) => r.cells[i].price))).toEqual(new Set(["0,149000"])); // 24 h: mateix preu a P1–P3
        }
      });
      it("el període del resultat no es diu mai «mensual»", () => {
        expect(sh.totals.label).not.toMatch(/mes\b|mensual/i);
        expect(sh.periodLabel).toBe(periodLabel(s, "ca"));
      });
      it("genera el PDF A4 horitzontal", () => {
        const kind = name === "3.0TD" ? "detallada" : "resum";
        const r = renderComparisonPdf(s, { kind, lang: name === "gas" ? "es" : "ca", recommendation: name === "3.0TD" ? "Recomanem l'opció 1 pel cost i l'estabilitat del preu." : null, company, salesperson: "Comercial Prova" });
        expect(r.blob.size).toBeGreaterThan(5000);
        const txt = Buffer.from(r.bytes).toString("latin1");
        expect(txt).toMatch(/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/); // horitzontal
        if (process.env.PDF_OUT) fs.writeFileSync(path.join(process.env.PDF_OUT, `comparativa-${name}.pdf`), Buffer.from(r.bytes));
      });
    });
  }

  it("3.0TD: descomptes, SAS, excedents i permanència al full", () => {
    const sh = comparisonSheet(CASES["3.0TD"], "ca");
    const adj = values(sh, "ajustos")!;
    const sas = adj.rows.find((r) => r.label === "SAS / SSAA")!;
    const iN = sh.columns.findIndex((c) => c.supplier === "Corrent Nord");
    expect(sas.values[iN]).toMatch(/\*$/); // SAS variable estimat
    const ex = values(sh, "excedents")!;
    expect(ex.rows.map((r) => r.label)).toEqual(["Excedents (kWh)", "Modalitat", "Preu compensació (€/kWh)", "Import compensat", "Bateria virtual"]);
    const iP = sh.columns.findIndex((c) => c.supplier === "Energia del Pla");
    expect(ex.rows[3].values[iP]).toBe("−21,00"); // 420 kWh × 0,05
    expect(ex.rows[4].values[iN]).toMatch(/quota 18,00|quota 1,48/); // quota de la bateria (prorratejada)
    const cond = values(sh, "condicions")!;
    expect(cond.rows[0].values[iP]).toBe("12 mesos");
    expect(cond.rows[0].values[iN]).toBe("Permanència obligatòria: pendent de confirmar");
    expect(cond.rows[0].warn![iN]).toBe(true);
  });
  it("2.0TD: descompte sobre energia negatiu i quotes de serveis", () => {
    const sh = comparisonSheet(CASES["2.0TD"], "ca");
    const adj = values(sh, "ajustos")!;
    const iL = sh.columns.findIndex((c) => c.supplier === "Llum Clara");
    expect(adj.rows.find((r) => r.label === "Descompte sobre energia")!.values[iL]).toMatch(/^−\d/);
    expect(values(sh, "excedents")).toBeUndefined(); // sense excedents, sense secció
  });
  it("gas: terme fix en lloc de potència i impost d'hidrocarburs; en castellà", () => {
    const sh = comparisonSheet(CASES.gas, "es");
    expect(sh.title).toBe("COMPARATIVA DE TARIFAS DE GAS");
    expect(priced(sh, "potencia")).toBeUndefined();
    expect(priced(sh, "fix_gas")!.rows[0].qty).toBe("62");
    expect(values(sh, "altres")!.rows.some((r) => /hidrocarburos/.test(r.label))).toBe(true);
    expect(sh.info.period).toBe("Del 01/08/2026 al 30/09/2026 (62 días)");
    expect(priced(sh, "energia")!.total.qty).toBe("2.850");
  });
  it("sense preus actuals i amb només 2 alternatives: no s'inventen columnes ni totals", () => {
    const base = CASES["2.0TD"];
    const s = buildSnapshot({ mode: "cups", client, cups: base.cups, supply: base.supply, current: null, offers: base.offers.slice(0, 2) }, TODAY);
    const sh = comparisonSheet(s, "ca");
    expect(sh.columns.map((c) => c.role)).toEqual(["ACTUAL", "OPCIÓ 1", "OPCIÓ 2"]);
    expect(sh.totals.values[0]).toBeNull();
    expect(sh.totals.text[0]).toBe("Sense preus actuals");
    expect(sh.savings.values).toEqual([null, null, null]);
    const r = renderComparisonPdf(s, { kind: "resum", lang: "ca", recommendation: null, company, salesperson: null });
    expect(r.blob.size).toBeGreaterThan(5000);
  });
  it("una comparativa emesa amb el motor anterior (sense detall per període) es continua podent imprimir", () => {
    const s = structuredClone(CASES["3.0TD"]);
    s.engineVersion = "1.0.0";
    s.result.current!.detail = undefined;
    s.result.evaluations.forEach((e) => (e.cost.detail = undefined));
    const sh = comparisonSheet(s, "ca");
    expect(sh.totals.values).toEqual([s.result.current!.total, ...presentationOrder(s).map((e) => e.cost.total)]);
    expect(renderComparisonPdf(s, { kind: "resum", lang: "ca", recommendation: null, company, salesperson: null }).blob.size).toBeGreaterThan(5000);
  });
});
