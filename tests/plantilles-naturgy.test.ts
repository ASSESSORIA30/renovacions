/**
 * Fase 11 · Plantilles de lectura IA: Excel REAL de Naturgy (NC-Productos-Captacion-PYMES-20261029-VP.xlsx).
 * Es comprova cada valor llegit contra la cel·la original, les variants, la classificació, un segon Excel
 * equivalent (mateixa estructura, preus nous), un format incompatible i les correccions del xat.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  applyOps, applyTemplate, checkStructure, diffReads, gridFromXlsx, parseTeaching, productsToOffers, proposeTemplate, templateChecks,
  type TemplateDef, type WorkbookGrid,
} from "@/comparator/xlsx-template";
import { offerVersionSchema } from "@/comparator/types";

const FILE = "tests/fixtures/naturgy/NC-Productos-Captacion-PYMES-20261029-VP.xlsx";
const bytes = readFileSync(FILE);
const X = XLSX as never;
const grid = (b: Uint8Array | Buffer, name = "naturgy.xlsx"): WorkbookGrid => gridFromXlsx(X, b, name);
/** Còpia de l'Excel real amb canvis (per simular el document del mes següent). */
function variant(edit: (wb: XLSX.WorkBook) => void): Buffer {
  const wb = XLSX.read(bytes, { type: "buffer", cellDates: true });
  edit(wb);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const raw = XLSX.read(bytes, { type: "buffer" });
const cellOf = (ref: string) => { const [sh, a] = ref.split("!"); return (raw.Sheets[sh][a] as { v: number }).v; };

const wb = grid(bytes);
const proposal = proposeTemplate(wb, { supplier: "Naturgy", name: "Captación PYMES Excel" });
const def = proposal.def;
const byTitle = (t: string) => def.blocks.find((b) => b.title.startsWith(t))!;

describe("1–2 · lectura real i productes", () => {
  const r = applyTemplate(wb, def);
  it("reconeix el full, la vigència i tots els blocs (llum, gas i serveis)", () => {
    expect(r.sheet).toBe("OCT26_3_VP");
    expect(r.compatibility.status).toBe("compatible");
    expect(r.validity).toMatchObject({ label: "OCT 2026 · versió 3", month: "2026-10", version: "3", from: "2026-10-31", logEntry: "Precios Fijos: subida de precios" });
    expect(def.blocks.map((b) => b.title)).toEqual(["PLAN FIJO LUZ 24h (E0008)", "PLAN FIJO LUZ (E0009)", "PLAN FIJO LUZ ECO (E0010)", "PLAN VARIABLE LUZ (E0013)", "TEMPORADA/OBRA", "PLAN VARIABLE GAS (G0009)", "PLAN COMPROMISO GAS (G0007)", "SERVICIOS"]);
    expect(r.services.map((s) => [s.name, s.price.v])).toEqual([["SVG GC Complet (RL.4/RL.5)", 184.68], ["SVE GC Xpress (20TD/30TD)", 89.16], ["SVS GC <10kWp  (2.0TD/3.0TD)", 130.3], ["Batería Virtual", 0]]);
  });
  it("cada valor coincideix amb la cel·la original de l'Excel", () => {
    let n = 0;
    for (const p of r.products) for (const x of [...p.power, ...p.energy, ...(p.fixedTerm ? [p.fixedTerm] : [])]) {
      if (x.v == null) continue;
      expect(x.v).toBeCloseTo(cellOf(x.cell), 9);
      n++;
    }
    expect(n).toBeGreaterThan(300);
  });
  it("productes, peatges, codis comercials i límits de consum", () => {
    const p = r.products.find((x) => x.code === "E000930TDB")!;
    expect(p).toMatchObject({ name: "Plan Fijo Luz 3.0", tariff: "3.0TD", variant: "ONE", productCode: "E0009", classification: "fixa", singlePrice: false });
    expect(p.energy.map((x) => x.v)).toEqual([0.2585, 0.2337, 0.2098, 0.1962, 0.19, 0.1828]);
    expect(p.energy[0].cell).toBe("OCT26_3_VP!S20");
    expect(p.power[0].v).toBeCloseTo(0.05792764931506849, 12);
    expect(p.powerUnit).toBe("€/kW.día");
    const gas = r.products.filter((x) => x.productCode === "G0009" && x.variant === "ONE");
    expect(gas.map((x) => [x.tariff, x.consumptionMax, x.energy[0].v])).toEqual([["RL.1", 5000, 0.09793], ["RL.2", 15000, 0.095832], ["RL.3", 50000, 0.092392], ["RL.4", 300000, 0.096476], ["RL.5", 1500000, 0.096413]]);
    expect(gas[0].fixedTerm!.v).toBeCloseTo(0.0772908493150685, 12);
    expect(gas[0].fixedTermUnit).toBe("€/día/cliente");
    expect(gas[0].discountLabel).toBe("Dto 6€/MWh TV");
  });
});

describe("3–4 · variants i FIXA / INDEXADA / PENDENT", () => {
  it("separa M, ONE i SUPRA (llum) i SUPRA / Base / ONE (gas) amb el seu codi", () => {
    expect(byTitle("PLAN FIJO LUZ (E0009)").variants.map((v) => [v.label, v.letter, v.codeCol, v.energyCols[0]])).toEqual([["M", "M", "A", "L"], ["ONE", "B", "R", "S"], ["SUPRA", "A", "Y", "Z"]]);
    expect(byTitle("PLAN VARIABLE GAS").variants.map((v) => [v.label, v.energyCols[0], v.discountCol])).toEqual([["SUPRA", "H", "G"], ["Base", "J", "I"], ["ONE", "L", "K"]]);
    const r = applyTemplate(wb, def);
    expect(new Set(r.products.filter((p) => p.productCode === "E0008").map((p) => `${p.code}:${p.variant}`))).toEqual(new Set(["E000820TDM:M", "E000820TDB:ONE", "E000820TDA:SUPRA", "E000830TDM:M", "E000830TDB:ONE", "E000830TDA:SUPRA", "E000861TDM:M", "E000861TDB:ONE", "E000861TDA:SUPRA"]));
  });
  it("Fijo, Fijo 24h i ECO són fixes; «Variable» NO es considera indexat (queda PENDENT)", () => {
    expect(byTitle("PLAN FIJO LUZ 24h").classification).toBe("fixa");
    expect(byTitle("PLAN FIJO LUZ 24h").singlePrice).toBe(true);
    expect(byTitle("PLAN FIJO LUZ ECO").classification).toBe("fixa");
    expect(byTitle("PLAN COMPROMISO GAS").classification).toBe("fixa");
    expect(byTitle("PLAN VARIABLE LUZ").classification).toBe("pendent");
    expect(byTitle("PLAN VARIABLE GAS").classification).toBe("pendent");
    expect(def.blocks.some((b) => b.classification === "indexada")).toBe(false);
  });
  it("les cel·les amb #N/A no són zeros: el bloc Temporada/Obra es proposa no importar-lo", () => {
    expect(byTitle("TEMPORADA").excluded).toBe(true);
    const r = applyTemplate(wb, applyOps(def, [{ op: "excludeBlock", block: byTitle("TEMPORADA").id, value: false }]));
    const e = r.issues.filter((i) => i.level === "critica");
    expect(e.length).toBe(4);
    expect(e[0].text).toMatch(/OCT26_3_VP!L44/);
    expect(r.products.some((p) => p.block === "TEMPORADA/OBRA")).toBe(false);
  });
  it("avisa del que no quadra sense moure res (Variable 3.0: preus a P4–P6; Y35 = -6)", () => {
    const r = applyTemplate(wb, def);
    const v30 = r.products.find((p) => p.name === "Plan Variable Luz 3.0" && p.variant === "Base")!;
    expect(v30.energy.map((x) => x.v)).toEqual([null, null, null, 0.216691, 0.19392, 0.256136]);
    expect(v30.warnings.join(" ")).toMatch(/a partir de P4 però no a P1/);
    expect(r.products.find((p) => p.name === "Plan Variable Luz 2.0" && p.variant === "SUPRA")!.warnings.join(" ")).toMatch(/Y35: valor -6 sense identificar/);
  });
});

describe("verificació: requisits reals", () => {
  it("la proposta no es pot verificar mentre hi hagi blocs PENDENTS; quan es classifiquen, sí", () => {
    const c0 = templateChecks(def, applyTemplate(wb, def));
    expect(c0.find((c) => c.id === "classificacio")!.ok).toBe(false);
    const fixed = applyOps(def, [
      { op: "setClassification", block: byTitle("PLAN VARIABLE LUZ").id, value: "fixa", note: "Preu revisable mensualment (no és fórmula indexada)" },
      { op: "setClassification", block: byTitle("PLAN VARIABLE GAS").id, value: "fixa", note: "Preu revisable mensualment" },
    ]);
    const c1 = templateChecks(fixed, applyTemplate(wb, fixed));
    expect(c1.filter((c) => !c.ok).map((c) => c.id)).toEqual([]);
  });
});

describe("7–8 · segon Excel equivalent i canvis d'estructura", () => {
  const next = grid(variant((w) => {
    const ws = w.Sheets.OCT26_3_VP;
    (ws.L20 as { v: number }).v = 0.2801; // preu nou
    (ws.H57 as { v: number }).v = 0.0999;
    delete ws.A12; delete ws.B12; delete ws.C12; delete ws.D12; // desapareix el 6.1 de Fijo 24h
    w.SheetNames[0] = "NOV26_1_VP"; w.Sheets.NOV26_1_VP = ws; delete w.Sheets.OCT26_3_VP;
  }), "NC-Productos-Captacion-PYMES-20261128-VP.xlsx");
  it("reconeix el document compatible, aplica la plantilla i mostra els canvis", () => {
    const prev = applyTemplate(wb, def);
    const r = applyTemplate(next, def);
    expect(r.compatibility.status).toBe("compatible");
    expect(r.validity.label).toBe("NOV 2026 · versió 1");
    const d = diffReads(prev, r);
    expect(d.changed.find((c) => c.key === "E000930TDM|M")!.fields).toEqual([{ field: "energia P1", before: 0.2765, after: 0.2801 }]);
    expect(d.changed.find((c) => c.key === "G0009-RL.1|SUPRA")!.fields).toEqual([{ field: "energia P1", before: 0.103811, after: 0.0999 }]);
    expect(d.validity).toEqual({ before: "OCT 2026 · versió 3", after: "NOV 2026 · versió 1" });
    expect(d.removed.length).toBeGreaterThanOrEqual(1);
  });
  it("un format incompatible NO s'aplica: queda pendent de revisió amb les diferències", () => {
    const bad = grid(variant((w) => {
      const ws = w.Sheets.OCT26_3_VP;
      (ws.L16 as { v: string }).v = "Plan Fijo Luz\nTÉRMINO ENERGÍA (€/MWh)"; // canvi d'unitat
      (ws.C23 as { v: string }).v = "PLAN FIJO LUZ ECO PLUS (E0020)"; // bloc reanomenat
    }));
    const st = checkStructure(bad, def);
    expect(st.compatibility.status).toBe("incompatible");
    expect(st.compatibility.differences.join(" ")).toMatch(/L16/);
    expect(st.compatibility.differences.join(" ")).toMatch(/No es troba el bloc «PLAN FIJO LUZ ECO \(E0010\)»/);
    const r = applyTemplate(bad, def);
    expect(r.products).toEqual([]);
    expect(r.issues[0].text).toBe("S'ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura.");
  });
});

describe("9 · correccions des del xat", () => {
  const ctx = (block: string, cols: string[] = [], rowKey: string | null = null) => ({ def, block: byTitle(block).id, cols, rowKey });
  it("«Aquestes sis columnes F a K corresponen a la potència P1–P6»", () => {
    expect(parseTeaching("Aquestes sis columnes F a K corresponen a la potència P1–P6 (€/kW·día)", ctx("PLAN FIJO LUZ (E0009)"))).toEqual([{ op: "setPower", block: byTitle("PLAN FIJO LUZ (E0009)").id, cols: ["F", "G", "H", "I", "J", "K"], unit: "€/kW·día" }]);
  });
  it("«Aquest producte és fix, encara que tingui sis períodes» i «Aquesta variant és ONE»", () => {
    expect(parseTeaching("Aquest producte és fix, encara que tingui sis períodes", ctx("PLAN VARIABLE LUZ"))[0]).toMatchObject({ op: "setClassification", value: "fixa" });
    expect(parseTeaching("Aquesta variant és ONE", ctx("PLAN VARIABLE LUZ", ["S"]))).toEqual([]); // ja és ONE
    expect(parseTeaching("Aquesta variant és SUPRA", ctx("PLAN VARIABLE LUZ", ["S"]))).toEqual([{ op: "renameVariant", block: byTitle("PLAN VARIABLE LUZ").id, from: "ONE", to: "SUPRA" }]);
  });
  it("marge, cel·les buides, fila de gas i energia d'una variant", () => {
    expect(parseTeaching("Aquesta columna representa el marge d'una tarifa indexada", ctx("PLAN VARIABLE LUZ", ["Y"]))[0]).toMatchObject({ op: "setMargin", col: "Y" });
    expect(parseTeaching("Aquestes cel·les buides no són zeros", ctx("PLAN FIJO LUZ (E0009)"))).toEqual([{ op: "emptyIsNull" }]);
    expect(parseTeaching("Aquesta fila és una tarifa de gas", ctx("PLAN FIJO LUZ (E0009)", [], "E000920TDM"))[0]).toMatchObject({ op: "rowEnergyType", key: "E000920TDM", value: "gas" });
    expect(parseTeaching("Columna S a X: energia de la variant ONE", ctx("PLAN FIJO LUZ (E0009)"))[0]).toMatchObject({ op: "setVariantEnergy", variant: "ONE", cols: ["S", "T", "U", "V", "W", "X"] });
  });
  it("una correcció aplicada actualitza la previsualització (files afectades)", () => {
    const d2 = applyOps(def, parseTeaching("Aquest producte és fix", ctx("PLAN VARIABLE LUZ")));
    const affected = applyTemplate(wb, d2).products.filter((p) => p.blockId === byTitle("PLAN VARIABLE LUZ").id);
    expect(affected.length).toBe(9);
    expect(affected.every((p) => p.classification === "fixa")).toBe(true);
    expect(def.blocks.find((b) => b.title.startsWith("PLAN VARIABLE LUZ"))!.classification).toBe("pendent"); // l'original no es toca
  });
});

describe("ofertes per al catàleg (sempre esborrany) amb la plantilla d'origen", () => {
  it("fixa 24 h, fixa per períodes i gas amb trams de consum; vàlides per a l'esquema", () => {
    const r = applyTemplate(wb, def);
    const offers = productsToOffers(r, def, { templateId: null, version: 1, fileName: "naturgy.xlsx", today: "2026-11-03" });
    const f24 = offers.find((o) => o.product.code === "E000830TDA")!.offer;
    expect(f24).toMatchObject({ contractType: "fix24h", energy24h: 0.2368, accessTariff: "3.0TD", powerUnit: "eur_kw_dia", status: "esborrany", template: { classification: "fixa", variant: "SUPRA", code: "E000830TDA" } });
    const g = offers.filter((o) => o.product.productCode === "G0007" && o.product.variant === "M").map((o) => o.offer);
    expect(g.map((o) => [o.accessTariff, o.eligibility.minKwh, o.eligibility.maxKwh, o.energy24h])).toEqual([["RL.1", null, 5000, 0.053445], ["RL.2", 5000, 15000, 0.051346], ["RL.3", 15000, 50000, 0.047905], ["RL.4", 50000, 300000, 0.05199], ["RL.5", 300000, 1500000, 0.051927]]);
    expect(g[0].gasFixedEurDay).toBeCloseTo(0.08038209271232877, 12);
    expect(offers.every((o) => offerVersionSchema.safeParse(o.offer).success)).toBe(true);
    const pend = offers.find((o) => o.product.productCode === "42053")!;
    expect(pend.warnings.join(" ")).toMatch(/PENDENT/);
  });
});

export const naturgyDef: TemplateDef = def;
