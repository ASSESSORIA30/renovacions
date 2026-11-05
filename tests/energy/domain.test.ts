import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { readWorkbook } from "@/energy/lib/xlsx";
const readSheet = async (f: string) => (await readWorkbook(fs.readFileSync(f))).rows;
import { COLUMNS } from "@/energy/lib/columns";
import { cupsControl, makeCups, validateCups } from "@/energy/lib/cups";
import { annualActive, parseRows, toIsoDate, toNum } from "@/energy/lib/parse";
import { REGULATED_2026, checkRules, controlMode, periodsInMonth, regulatedPowerPrice, normalizeTariff, DAYS_IN_MONTH } from "@/energy/lib/tariffs";
import { buildDemandModel, evaluate, runOptimizer, scenarioDefs, type OptimizerInput } from "@/energy/lib/optimizer";
import { analyzeReactive, compensationSizing, priceForCos } from "@/energy/lib/reactive";
import { blankOffer, costOffer, savingVs } from "@/energy/lib/market";
import { supplyAlerts } from "@/energy/lib/alerts";
import { scoreSupply } from "@/energy/lib/scoring";
import { demoRows } from "@/energy/lib/demo";

const REAL = "tests/energy/fixtures/PuntoSuministro_20261029_153630.xlsx";
const FIX = "tests/energy/fixtures/sips_test.xlsx";
const TODAY = "2026-10-30";

describe("Excel real (estructura)", () => {
  it("reconoce las 97 columnas y no inventa filas", async () => {
    const rows = await readSheet(REAL);
    expect(rows[0].length).toBe(97);
    const { supplies, report } = parseRows(rows as never, { file: "real.xlsx", sheet: "Page1" });
    expect(COLUMNS.length).toBe(97);
    expect(report.recognized.length).toBe(97);
    expect(report.missing).toEqual([]);
    expect(report.extra).toEqual([]);
    expect(supplies.length).toBe(0);
    expect(report.warnings.join(" ")).toMatch(/solo la fila de cabeceras/);
  });
});

describe("Importación con formatos reales", () => {
  it("parsea números españoles, fechas, duplicados y conserva columnas", async () => {
    const rows = await readSheet(FIX);
    const { supplies, report } = parseRows(rows as never, { file: "t.xlsx", sheet: "Page1" });
    expect(report.imported).toBe(2); // duplicado fusionado, fila sin CUPS omitida
    expect(report.duplicates).toEqual(["ES0021000000000001RK0F"]);
    expect(report.emptyRows).toBe(1);
    expect(report.invalidCups).toContain("ES0021000000000002XX");
    const s = supplies.find((x) => x.cups === "ES0021000000000001RK0F")!;
    expect(s.comercializadora).toBe("DUPLICADO"); // última aparición
    expect(s.potContratada[0]).toBe(60.5);
    expect(s.potMaxBIE).toBe(1200);
    expect(s.fUltLectura).toBe("2026-10-15");
    expect(s.fCaducidadBIE).toBe("2026-01-15");
    expect(Object.keys(s.raw).length).toBe(97);
    expect(s.tarifa).toBe("3.0TD");
    expect(annualActive(s)).toEqual({ value: 120000, basis: "anual" });
  });
  it("helpers", () => {
    expect(toNum("1.234,56")).toBe(1234.56);
    expect(toNum("12.000")).toBe(12000);
    expect(toNum("3,45")).toBe(3.45);
    expect(toIsoDate(45000)).toBe("2023-03-15");
    expect(toIsoDate("5/3/2026")).toBe("2026-03-05");
  });
});

describe("CUPS", () => {
  it("valida letras de control", () => {
    const c = makeCups("0021000000000001");
    expect(c).toBe("ES0021000000000001RK0F");
    expect(validateCups(c).valid).toBe(true);
    expect(validateCups("ES0021000000000001RJ").valid).toBe(false);
    expect(validateCups("ES0021000000000001RK").valid).toBe(true);
    expect(cupsControl("0021000000000001")).toBe("RK");
  });
});

describe("Normativa", () => {
  it("ATR = peaje + cargo 2026 (coincide con precios ATR publicados por comercializadoras)", () => {
    expect(regulatedPowerPrice(REGULATED_2026, "3.0TD")).toEqual([20.376927, 10.617621, 4.481534, 3.886333, 2.513851, 1.442287]);
    expect(regulatedPowerPrice(REGULATED_2026, "2.0TD").slice(0, 2)).toEqual([27.704413, 0.725423]);
    expect(regulatedPowerPrice(REGULATED_2026, "6.1TD")).toEqual([29.595368, 15.514709, 6.801881, 5.393829, 2.125113, 1.004181]);
  });
  it("calendario y reglas", () => {
    expect(periodsInMonth("3.0TD", 0, true)).toEqual([1, 2, 6]);
    expect(periodsInMonth("3.0TD", 3, true)).toEqual([4, 5, 6]);
    expect(periodsInMonth("3.0TD", 3, false)).toBeNull();
    expect(checkRules("3.0TD", [10, 10, 10, 10, 10, 10])).toHaveLength(1);
    expect(checkRules("3.0TD", [20, 18, 20, 20, 20, 20])[0]).toMatch(/P2 < P1/);
    expect(checkRules("2.0TD", [16, 4])[0]).toMatch(/15 kW/);
    expect(normalizeTariff("3.0 TD").code).toBe("3.0TD");
    expect(normalizeTariff("019").code).toBe("3.0TD");
    expect(normalizeTariff("3.0TDVE").code).toBeNull();
    expect(controlMode("2.0TD", 5, "ICP", 4.6).mode).toBe("icp");
    expect(controlMode("3.0TD", 4, "Maxímetro", 40).mode).toBe("maximetro45");
    expect(controlMode("6.1TD", 3, null, 300).mode).toBe("cuartohorario13");
  });
});

async function fixtureSupply() {
  const rows = await readSheet(FIX);
  return parseRows(rows as never, { file: "t", sheet: "Page1" }).supplies.find((x) => x.tarifa === "3.0TD")!;
}

describe("Power Optimizer", () => {
  it("cota superior por temporadas", async () => {
    const s = await fixtureSupply();
    const dm = buildDemandModel(s, "3.0TD");
    expect(dm.basis).toBe("temporadas");
    expect(dm.ub).toEqual([50, 50, 35, 35, 20, 50]);
  });

  it("exceso tipo 4: tep(€/kW·día) × (Pd−Pc) × días", async () => {
    const s = await fixtureSupply();
    const prices = regulatedPowerPrice(REGULATED_2026, "3.0TD");
    const inp: OptimizerInput = { supply: s, tariff: "3.0TD", prices, excess45: REGULATED_2026.excess45["3.0TD"] };
    const dm = buildDemandModel(s, "3.0TD");
    const ev = evaluate(inp, dm, [45, 45, 45, 45, 45, 45], "maximetro45");
    // Julio: 50 > 45 en P1, P2 y P6 (31 días)
    const expected = (0.171373 + 0.090584 + 0.006142) * 5 * 31;
    expect(ev.excessWorst).toBeCloseTo(expected, 6);
  });

  it("escenarios coinciden con el cálculo manual y con fuerza bruta", async () => {
    const s = await fixtureSupply();
    const prices = regulatedPowerPrice(REGULATED_2026, "3.0TD");
    const inp: OptimizerInput = { supply: s, tariff: "3.0TD", prices, excess45: REGULATED_2026.excess45["3.0TD"], maxKWOverride: null };
    const res = runOptimizer(inp, { today: TODAY });
    expect(res.ok).toBe(true);
    const [cons, , max] = res.scenarios;
    expect(cons.pc).toEqual([55, 55, 55, 55, 55, 55]);
    expect(cons.excessWorst).toBe(0);
    expect(max.pc).toEqual([30, 30, 30, 30, 30, 30]); // bajar los 6 periodos juntos compensa (restricción P1≤…≤P6)
    // ahorro de potencia exacto
    const sumP = prices.reduce((a, b) => a + b, 0);
    expect(max.powerSaving).toBeCloseTo((60.5 - 30) * sumP, 6);
    expect(max.netSavingLB).toBeCloseTo(max.powerSaving - max.excessWorst, 9);

    // fuerza bruta sobre combinaciones monótonas 16..56 (paso 2)
    const dm = buildDemandModel(s, "3.0TD");
    let best = Infinity;
    let arg: number[] = [];
    const rec = (p: number, lo: number, acc: number[]) => {
      if (p === 6) {
        const e = evaluate(inp, dm, acc, "maximetro45");
        const c = e.powerCost + e.excessWorst;
        if (c < best - 1e-9) {
          best = c;
          arg = [...acc];
        }
        return;
      }
      for (let v = lo; v <= 56; v += 2) rec(p + 1, v, [...acc, v]);
    };
    rec(0, 16, []);
    expect(arg).toEqual(max.pc);
    expect(max.powerCost + max.excessWorst).toBeCloseTo(best, 6);
  });

  it("ICP: nunca propone potencias bajo la demanda", () => {
    const rows = demoRows(30);
    const sup = parseRows(rows as never, { file: "d", sheet: "Page1", demo: true }).supplies.filter((x) => x.tarifa === "2.0TD");
    expect(sup.length).toBeGreaterThan(3);
    for (const s of sup) {
      const res = runOptimizer({ supply: s, tariff: "2.0TD", prices: regulatedPowerPrice(REGULATED_2026, "2.0TD"), excess45: REGULATED_2026.excess45["2.0TD"] });
      for (const sc of res.scenarios) {
        expect(sc.belowDemand).toEqual([]);
        expect(sc.excessWorst).toBe(0);
        expect(Math.max(...sc.pc)).toBeLessThanOrEqual(15);
      }
      expect(res.confidence.level).not.toBe("Alta");
    }
  });

  it("con maxímetros por periodo (facturas) usa la medida", async () => {
    const s = await fixtureSupply();
    const table = Array.from({ length: 12 }, () => [30, 32, 25, 22, 18, 50]);
    const dm = buildDemandModel(s, "3.0TD", table);
    expect(dm.basis).toBe("medida_periodo");
    expect(dm.ub[0]).toBe(30);
  });

  it("todos los escenarios cumplen las reglas del peaje en los datos demo", () => {
    const rows = demoRows(42);
    const { supplies } = parseRows(rows as never, { file: "d", sheet: "Page1", demo: true });
    for (const s of supplies) {
      if (!s.tarifa) continue;
      const res = runOptimizer({ supply: s, tariff: s.tarifa, prices: regulatedPowerPrice(REGULATED_2026, s.tarifa), excess45: REGULATED_2026.excess45[s.tarifa] });
      expect(res.ok).toBe(true);
      for (const sc of res.scenarios) {
        expect(checkRules(s.tarifa, sc.pc)).toEqual([]);
        expect(sc.feasible).toBe(true);
      }
      expect(scenarioDefs(res.mode.mode)).toHaveLength(3);
    }
  });
});

describe("Reactiva", () => {
  it("bandas, precios, rango y no aplicación en 2.0TD", async () => {
    const s = await fixtureSupply();
    expect(priceForCos(0.96)).toBe(0);
    expect(priceForCos(0.9)).toBe(0.041554);
    expect(priceForCos(0.7)).toBe(0.062332);
    const r = analyzeReactive(s, { shareOutsideP6: null });
    expect(r.months[6].ratio).toBeCloseTo(0.6);
    expect(r.months[6].band).toBe("medio");
    expect(r.risk).toBe("medio");
    expect(r.estimateTotal).toBeNull(); // sin hipótesis no hay estimación puntual
    expect(r.boundTotal).toBeCloseTo(28000 * 0.062332, 6);
    const e = analyzeReactive(s, { shareOutsideP6: 0.5 });
    const cos = 10000 / Math.sqrt(10000 ** 2 + 6000 ** 2);
    expect(e.estimateTotal).toBeCloseTo((6000 - 3300) * 0.5 * priceForCos(cos), 6);
    const c = compensationSizing({ pKW: 100, cos1: 0.8, cos2: 0.98, costPerKVAr: 30, annualPenalty: 500 });
    expect(c.qc).toBeCloseTo(100 * (0.75 - Math.tan(Math.acos(0.98))), 6);
  });
});

describe("Comparador", () => {
  it("rango garantizado y coste exacto con factura", async () => {
    const s = await fixtureSupply();
    const o = { ...blankOffer("3.0TD"), energia: [0.2, 0.18, 0.15, 0.13, 0.11, 0.1], potencia: regulatedPowerPrice(REGULATED_2026, "3.0TD"), ieePct: 0, ivaPct: 0 };
    const r = costOffer(o, s, { mode: "rango", annualKWh: 120000, values: [], label: "" }, { today: TODAY });
    expect(r.energyMin).toBeCloseTo(12000, 6);
    expect(r.energyMax).toBeCloseTo(24000, 6);
    expect(r.total).toBeNull();
    const f = costOffer(o, s, { mode: "factura", annualKWh: 120000, values: [20000, 20000, 20000, 20000, 20000, 20000], label: "" }, { today: TODAY });
    expect(f.energy).toBeCloseTo(20000 * (0.2 + 0.18 + 0.15 + 0.13 + 0.11 + 0.1), 6);
    expect(f.quality).toBe("exacto");
    const o2 = { ...o, energia: o.energia.map((x) => x - 0.01) };
    const f2 = costOffer(o2, s, { mode: "factura", annualKWh: 120000, values: [20000, 20000, 20000, 20000, 20000, 20000], label: "" }, { today: TODAY });
    const sv = savingVs(f, f2);
    expect(sv.kind).toBe("exacto");
    if (sv.kind === "exacto") expect(sv.value).toBeCloseTo(1200, 6);
    // impuestos
    const t = costOffer({ ...o, ieePct: 5.11269632, ivaPct: 21 }, s, { mode: "factura", annualKWh: 120000, values: [20000, 20000, 20000, 20000, 20000, 20000], label: "" });
    const base = f.energy! + f.power;
    expect(t.total).toBeCloseTo(base * 1.0511269632 * 1.21, 6);
  });
});

describe("Alertas y scoring", () => {
  it("detecta BIE caducado, no contratable e inconsistencias", async () => {
    const rows = await readSheet(FIX);
    const { supplies } = parseRows(rows as never, { file: "t", sheet: "Page1" });
    const a = supplies.flatMap((s) => supplyAlerts(s, undefined, TODAY));
    const rules = a.map((x) => x.rule);
    expect(rules).toContain("bie-caducado");
    expect(rules).toContain("no-contratable");
    expect(rules).toContain("cups");
    expect(rules).not.toContain("reactiva"); // R/A anual 23 % < 33 %
    expect(a.every((x) => x.columns.length > 0 && x.origin)).toBe(true);
  });
  it("puntuación acotada y explicada", async () => {
    const s = await fixtureSupply();
    const sc = scoreSupply(s, undefined, TODAY);
    expect(sc.score).toBeGreaterThanOrEqual(0);
    expect(sc.score).toBeLessThanOrEqual(100);
    expect(sc.items.every((i) => i.why)).toBe(true);
  });
  it("demo: 42 suministros válidos y días por mes", () => {
    const { supplies } = parseRows(demoRows(42) as never, { file: "d", sheet: "Page1", demo: true });
    expect(supplies).toHaveLength(42);
    expect(supplies.every((s) => s.cupsValid)).toBe(true);
    expect(DAYS_IN_MONTH.reduce((a, b) => a + b, 0)).toBe(365);
  });
});

describe("PDF", () => {
  it("translitera caracteres fuera de la fuente estándar", async () => {
    const { pdfSafe } = await import("@/energy/lib/pdf");
    expect(pdfSafe("tep 1-3 · √Σ(Pdj−Pcp)²")).toBe("tep 1-3 · raiz(suma de (Pdj - Pcp)^2)");
    expect(pdfSafe("cos φ ≥ 0,95 · 12 € · P1 ≤ P2")).toBe("cos phi >= 0,95 · 12 € · P1 <= P2");
  });
});

describe("Configuración de build (plataforma unificada)", () => {
  // cups2 es publicava com a web estàtica (next.config.ts → output: "export", dist/).
  // A la plataforma unificada el mòdul energètic viu dins de l'app Next.js de Renovacions,
  // que necessita servidor (APIs SIPS, Supabase, cron). Aquest test substitueix l'original
  // i comprova que els estils del mòdul energètic es generen amb el Tailwind del projecte.
  it("Tailwind inclou els tokens de cups2 i el projecte no és una exportació estàtica", () => {
    const tw = fs.readFileSync("tailwind.config.ts", "utf8");
    for (const t of ["surface-2", "fg-3", "border-strong", "accent", "critical"]) expect(tw).toContain(t);
    expect(tw).toContain("./src/**/*.{ts,tsx}");
    const css = fs.readFileSync("src/ui/globals.css", "utf8");
    expect(css).toMatch(/--accent: \d+ \d+ \d+;/);
    const next = fs.readFileSync("next.config.mjs", "utf8");
    expect(next).not.toContain('output: "export"');
    expect(JSON.parse(fs.readFileSync("vercel.json", "utf8")).crons[0].path).toBe("/api/sync/cron");
  });
});
