/**
 * Fase 12 · LECTOR UNIVERSAL amb l'Excel REAL d'Iberdrola (IBERDROLA_HASTA_15.11.xlsx, pestanya «Energía»).
 * Els documents «del mes següent», «format nou» i «sense Energía» es generen a partir del real canviant-hi
 * poques cel·les (scripts/e2e-iberdrola-fixtures.ts). No hi ha dades personals: només preus de tarifes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applyTemplate, diffReads, gridFromXlsx, productsToOffers, templateChecks, type Product, type TemplateDef, type WorkbookGrid } from "@/comparator/xlsx-template";
import { proposeTable, type ReadingRule } from "@/comparator/tariff-table";
import { detectSupplier } from "@/comparator/reading-knowledge";
import { chunkForAi, inferFromExample, parseRuleChat, readDiff, withScope } from "@/comparator/reading-rules";
import { parseDiscount, simulateDiscounts } from "@/comparator/tariff-discounts";
import { offerVersionSchema } from "@/comparator/types";
import { computeCost } from "@/comparator/engine";
import { analyzeMarket } from "@/comparator/market";
import { emptySupply } from "@/ui/views/comparatives/state";

const load = (f: string) => gridFromXlsx(XLSX as never, readFileSync(`tests/fixtures/iberdrola/${f}`), f);
const wb = load("IBERDROLA_HASTA_15.11.xlsx");
const REF = { reference: { from: "2027-01-01", to: "2028-01-01" } };
const proposal = proposeTable(wb, { supplier: "Iberdrola", name: "Hoja de Precios", knowledge: detectSupplier(wb)?.pack.id });
const def = proposal.def!;
const read = applyTemplate(wb, def, REF);
const row = (r: number, res = read): Product => res.products.find((p) => p.row === r)!;
const fin = (r: number, res = read) => { const i = row(r, res).interp!; return i.energyFinal.slice(0, i.periods); };

describe("Iberdrola · pestanya «Energía» (document real)", () => {
  it("detecta Iberdrola i llegeix EXACTAMENT la pestanya «Energía» (ni Portada, ni PYS, ni old)", () => {
    expect(detectSupplier(wb)?.supplier).toBe("Iberdrola");
    expect(wb.sheets.map((s) => s.name)).toEqual(["Portada", "Energía", "PYS", "old"]);
    expect(proposal.error).toBeNull();
    expect(read.sheet).toBe("Energía");
    expect(def.table!.ignoredSheets).toEqual(["Portada", "old"]);
    expect(def.table!.complementarySheets).toEqual(["PYS"]);
  });
  it("estructura real: B producte, C–H potència €/kW any, I–N energia, O descomptes, U–V €/kW dia", () => {
    const t = def.table!;
    expect(t.cols.name).toBe("B");
    expect(t.cols.power).toEqual(["C", "D", "E", "F", "G", "H"]);
    expect(t.cols.energy).toEqual(["I", "J", "K", "L", "M", "N"]);
    expect(t.cols.discount).toBe("O");
    expect(t.cols.powerDay).toEqual(["U", "V"]);
    expect(t.units.power).toBe("€/kW año");
    expect(t.colHeaders.I).toContain("No Prom.");
    expect(t.colHeaders.J).toContain("Prom.");
    expect(t.firstDataRow).toBe(9);
  });
  it("llegeix TOTES les tarifes (cap pèrdua) i informa del rang real, columnes auxiliars i files ocultes", () => {
    // recompte independent amb SheetJS: files amb nom a B i algun número a C–N, abans del bloc de PyS
    const ws = XLSX.read(readFileSync("tests/fixtures/iberdrola/IBERDROLA_HASTA_15.11.xlsx")).Sheets["Energía"];
    let n = 0;
    for (let r = 9; r < 120; r++) { const b = ws[`B${r}`]?.v; const nums = "CDEFGHIJKLMN".split("").some((c) => typeof ws[`${c}${r}`]?.v === "number"); if (b && nums) n++; }
    expect(n).toBe(100);
    expect(read.products.length).toBe(100);
    expect(read.table!.counts).toEqual({ identified: 100, interpreted: 65, review: 32, pending: 3, failed: 0 });
    expect(read.table!.ignoredCols).toEqual(["AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI"]);
    expect(read.table!.hiddenRows).toEqual([8]);
    expect(read.issues.some((i) => /files ocultes després de la taula/.test(i.text))).toBe(true);
    expect(read.stats).toEqual({ fields: 674, validated: 674, errors: 0 });
    expect(read.table!.complementary.tiers["Tier 1"]).toContain("Urgencias Eléctricas Negocios");
    expect(read.validity.from).toBe("2026-10-30");
    expect(read.validity.logEntry).toBe("2026-11-15");
  });
  it("fila 14 · 2.0TD un preu, 15 % s/Te y Tp: P1 = P2 = P3 i descompte també a la potència", () => {
    expect(fin(14)).toEqual([0.1999, 0.1999, 0.1999]);
    expect(row(14).interp!.powerFinal.slice(0, 2)).toEqual([37.3915, 24.6415]);
    expect(row(14).energy[0]).toMatchObject({ v: 0.23517647058824, cell: "Energía!I14" }); // original conservat
  });
  it("fila 68 · Impulsa Negocios: P1–P5 promocionat i P6 no promocionat, 20 % s/Te (el +5 % no s'aplica)", () => {
    expect(fin(68)).toEqual([0.1504, 0.1504, 0.1504, 0.1504, 0.1504, 0.3096]);
    const i = row(68).interp!;
    expect(i.powerFinal).toEqual(i.powerOriginal); // només energia
    expect(i.schedule!.text).toMatch(/08:00–17:00 de dilluns a divendres/);
    expect(i.estimate).toBeNull();
    expect(i.discount.conditional.map((c) => c.condition?.id)).toEqual(["uuee"]);
  });
  it("fila 69 · Impulsa Nocturna: P1–P5 no promocionat i P6 promocionat", () => {
    expect(fin(69)).toEqual([0.3096, 0.3096, 0.3096, 0.3096, 0.3096, 0.136]);
  });
  it("Impulsa Solar i Vehículo Eléctrico: horari conservat i P1–P6 com a ESTIMACIÓ ponderada", () => {
    for (const r of [70, 71]) {
      const i = row(r).interp!;
      expect(i.estimate).not.toBeNull();
      expect(i.reasons.join(" ")).toMatch(/PREU ESTIMAT PER PONDERACIÓ HORÀRIA/);
    }
    expect(fin(71).slice(0, 5)).toEqual([0.3288, 0.3288, 0.3288, 0.3288, 0.3288]); // 01–07 h és sempre P6
    expect(fin(71)[5]).toBeGreaterThan(0.0616);
    expect(fin(71)[5]).toBeLessThan(0.3288);
  });
  it("fila 73 · 3.0TD sis preus amb 15 % s/Te; files 76 i 91 · descompte d'import CONDICIONAT (no aplicat)", () => {
    expect(fin(73)).toEqual([0.283101, 0.257802, 0.233113, 0.219385, 0.187744, 0.196957]);
    expect(fin(76)).toEqual([0.279495, 0.244668, 0.207255, 0.179088, 0.162481, 0.176861]);
    expect(fin(91)).toEqual([0.215487, 0.185813, 0.163891, 0.151555, 0.137264, 0.139295]);
    expect(row(76).interp!.discount.conditional[0]).toMatchObject({ kind: "eur_kwh", value: 0.02, condition: { type: "consum", minMWh: 40 } });
    expect(row(91).interp!.discount.conditional[0]).toMatchObject({ kind: "eur_kwh", value: 0.01, condition: { minMWh: 100 } });
  });
  it("Plan OMIE: INDEXADA, es conserva el MARGE (€/kWh i €/MWh) i mai es converteix en preu final", () => {
    const omie = read.products.filter((p) => /plan omie/i.test(p.name));
    expect(omie.length).toBe(17);
    expect(omie.every((p) => p.classification === "indexada" && p.interp!.energyFinal.every((v) => v == null))).toBe(true);
    expect([79, 80, 81, 82, 83].map((r) => row(r).interp!.margin!.eurMWh)).toEqual([34, 27, 20, 10, 40]);
    expect(row(96).interp!.margin).toEqual({ eurKwh: 0.005, eurMWh: 5, cell: "Energía!I96" });
  });
  it("no s'inventa cap distribució: Regantes i Estancias Verdes 3.0/6.1 amb dos preus queden PENDENTS", () => {
    for (const r of [72, 85, 99]) expect(row(r).interp!.status).toBe("pendent");
    expect(row(94).interp!.status).toBe("interpretada"); // 6.1 Regantes té sis preus
    expect(row(28).interp!.status).toBe("revisar"); // 2.0 Vehículo Eléctrico: hores promocionades a confirmar
  });
  it("descomptes per anys (fila 65: 20 % el 1r any i 30 % el 2n)", () => {
    expect(fin(65)[0]).toBe(0.1824);
    expect(row(65).interp!.energyFinalYear2![0]).toBe(0.1596);
  });
  it("taula → catàleg: preus finals, marge com a fórmula, origen amb cel·les i esquema vàlid", () => {
    const offers = productsToOffers(read, def, { templateId: null, version: 1, fileName: "IBERDROLA_HASTA_15.11.xlsx", today: "2026-11-03" });
    expect(offers.length).toBe(100);
    for (const o of offers) expect(offerVersionSchema.safeParse(o.offer).success).toBe(true);
    const neg = offers.find((o) => o.product.row === 68)!.offer;
    expect(neg.energy).toEqual([0.1504, 0.1504, 0.1504, 0.1504, 0.1504, 0.3096]);
    expect(neg.open).toMatchObject({ kind: "comercial", openPrice: 0.1504, noOpenPrice: 0.3096 });
    expect(neg.template!.origin).toMatchObject({ sheet: "Energía", row: 68 });
    expect(neg.template!.original!.energy).toEqual([0.188, 0.188, 0.188, 0.188, 0.188, 0.387]);
    const omie = offers.find((o) => o.product.row === 79)!.offer;
    expect(omie.contractType).toBe("indexat");
    expect(omie.energy.every((v) => v == null)).toBe(true);
    expect(omie.formula!.marginEurMWh).toBe(34);
    expect(neg.status).toBe("esborrany");
  });
});

describe("Comparador i simulador amb tarifes d'Iberdrola", () => {
  const offers = productsToOffers(read, def, { templateId: null, version: 1, fileName: "i.xlsx", today: "2026-11-03" }).map((o) => ({ ...o.offer, status: "activa" as const }));
  const supply = { ...emptySupply(), accessTariff: "3.0TD", kwh: [9000, 12000, 8000, 10000, 6000, 35000], kw: [40, 40, 40, 40, 40, 40], days: 365 };
  it("fixa contra fixa: el cost anual fa servir els preus finals", () => {
    const a = computeCost(offers.find((o) => o.productName === "3.0TD Impulsa Negocios")!, supply);
    const b = computeCost(offers.find((o) => o.productName === "3.0TD Plan Exclusivo 15%TE")!, supply);
    expect(a.ok && b.ok).toBe(true);
    expect(a.total).not.toBe(b.total);
  });
  it("fixa contra Plan OMIE: el marge NO es compara amb un preu final (indexada incompleta sense fórmula)", () => {
    const fixed = offers.find((o) => o.productName === "3.0TD Plan Exclusivo 15%TE")!;
    const omie = offers.find((o) => o.productName === "3.0TD Plan OMIE 1")!;
    const a = analyzeMarket({ supply, current: null, offers: [fixed, omie], market: { central: [95, 85, 75, 70, 65, 55], lowPct: -20, highPct: 20, source: "Hipòtesi de prova" }, periods: 6 });
    expect(a.indexed[0].complete).toBe(false);
    expect(a.indexed[0].missing.join(" ")).toMatch(/Pèrdues|Peatges/);
    expect(a.bestFixed?.offerId).toBe(fixed.id);
  });
  it("SIMULAR DESCOMPTES: sense descompte, base, condicionat per consum, serveis, 1r i 2n any", () => {
    const p = row(76).interp!;
    const inp = { energy: p.energyOriginal, power: p.powerOriginal, powerUnit: "eur_kw_any" as const, discount: p.discount };
    const low = simulateDiscounts(inp, { year: 1, conditions: [], annualMWh: 30, combination: "suma" });
    expect(low.final.energy[0]).toBe(0.279495);
    expect(low.notEligible[0].reason).toMatch(/no supera 40 MWh/);
    const high = simulateDiscounts(inp, { year: 1, conditions: [], annualMWh: 80, combination: "suma", consumptionKwh: [10000, 10000, 10000, 10000, 10000, 30000], powerKw: [40, 40, 40, 40, 40, 40] });
    expect(high.final.energy[0]).toBe(0.259495);
    expect(high.cost!.noDiscount! - high.cost!.final!).toBeCloseTo(0.02 * 80000, 2);
    const n = row(68).interp!;
    const s = simulateDiscounts({ energy: n.energyOriginal, power: n.powerOriginal, powerUnit: "eur_kw_any", discount: n.discount }, { year: 1, conditions: ["uuee"], annualMWh: null, combination: "suma", serviceCostEurMonth: 10, consumptionKwh: [1, 1, 1, 1, 1, 1].map((x) => x * 10000), powerKw: [40, 40, 40, 40, 40, 40] });
    expect(s.final.energy[0]).toBe(0.141); // 20 % + 5 % (suma) sobre 0,188
    expect(s.pendingFormula).toMatch(/PENDENT DE VALIDACIÓ/);
    expect(s.cost!.services).toBe(120);
    const y = row(65).interp!;
    expect(simulateDiscounts({ energy: y.energyOriginal, power: y.powerOriginal, powerUnit: "eur_kw_any", discount: y.discount }, { year: 2, conditions: [], annualMWh: null, combination: "suma" }).final.energy[0]).toBe(0.1596);
  });
  it("interpretació dels textos de descompte de la columna O", () => {
    expect(parseDiscount("15% s/Te y Tp (+5% PyS Tier 1 +2% PyS Tier 2)").base[0].on).toEqual(["energia", "potencia"]);
    expect(parseDiscount("15% s/Te").base[0].on).toEqual(["energia"]);
    expect(parseDiscount("s/ dto (únicamente para suministros de obra)")).toMatchObject({ none: true, restriction: "únicamente para suministros de obra" });
    expect(parseDiscount("10% / 15% / 20% /25% / 30% Te").ambiguous.length).toBeGreaterThan(0);
  });
});

describe("Ensenyar a la IA: regles apreses, persistència i documents nous", () => {
  it("xat: «El Plan OMIE és indexat…», «dos preus en 2.0TD…», «Impulsa Negocios P1–P5 promocionats», confusió i descomptes", () => {
    const ctx = (r: number | null) => ({ product: r ? row(r) : null, products: read.products, last: null });
    expect(parseRuleChat("El Plan OMIE és indexat i el preu que apareix és el marge.", ctx(null)).rule!.set).toEqual({ classification: "indexada", valueIsMargin: true });
    expect(parseRuleChat("Quan hi ha dos preus en 2.0TD, el primer correspon a P1 i P2 i el segon a P3.", ctx(null)).rule).toMatchObject({ set: { mapping: ["A", "A", "B"] }, match: { tariffs: ["2.0TD"], priceCount: 2 } });
    expect(parseRuleChat("En Impulsa Negocios P1–P5 són promocionats.", ctx(null)).rule!.set.mapping).toEqual(["B", "B", "B", "B", "B", "A"]);
    expect(parseRuleChat("Aquí has confós el preu promocionat amb el no promocionat", ctx(69)).rule!.set.mapping).toEqual(["B", "B", "B", "B", "B", "A"]);
    expect(parseRuleChat("El descompte de la columna O afecta energia i potència.", ctx(73)).rule!.set.discountOn).toEqual(["energia", "potencia"]);
    expect(parseRuleChat("Aquest import és €/kW/any, no €/kWh.", ctx(null)).rule!.set.powerUnit).toBe("eur_kw_any");
    expect(parseRuleChat("Has interpretat malament aquesta tarifa.", ctx(72)).understood).toBe(false);
  });
  it("correcció amb el xat → actualitza la taula (abans/després) → s'amplia als equivalents", () => {
    const chat = parseRuleChat("P1–P5 promocionat i P6 no promocionat", { product: row(72), products: read.products, last: null });
    const after = applyTemplate(wb, def, { ...REF, extraRules: [chat.rule!] });
    expect(fin(72, after)).toEqual([0.149, 0.149, 0.149, 0.149, 0.149, 0.38]);
    expect(readDiff(read, after).map((d) => d.row)).toEqual([72]);
    const wide = parseRuleChat("Aplica aquesta correcció a tots els productes equivalents", { product: row(72), products: read.products, last: chat.rule });
    expect(wide.widened).toBe(true);
    expect(wide.rule!.match).toEqual({ tariffs: ["3.0TD"], priceCount: 2 });
  });
  it("ensenyar amb una tarifa d'exemple: descobreix la regla reutilitzable (o guarda valors manuals)", () => {
    const ex = inferFromExample(row(85), { expected: [0.128, 0.128, 0.128, 0.128, 0.128, 0.224], explanation: "Estancias Verdes 3.0: com Impulsa Negocios", discountApplied: null });
    expect(ex.explained).toBe(true);
    expect(ex.rule.set).toEqual({ mapping: ["B", "B", "B", "B", "B", "A"] });
    expect(ex.detail[1]).toMatch(/descompte base \(20 %/);
    expect(ex.general!.match).toEqual({ tariffs: ["3.0TD"], priceCount: 2 });
    const manual = inferFromExample(row(85), { expected: [0.13, 0.13, 0.128, 0.128, 0.128, 0.224], explanation: "x", discountApplied: null });
    expect(manual.explained).toBe(false);
    expect(manual.rule.set.manual).toBeTruthy();
  });
  it("regla aprovada → es desa amb la plantilla (JSON) → es recupera en una sessió nova → s'aplica al document del mes següent", () => {
    const ex = inferFromExample(row(85), { expected: [0.128, 0.128, 0.128, 0.128, 0.128, 0.224], explanation: "Estancias Verdes", discountApplied: null });
    const approved: ReadingRule = { ...withScope(ex.rule, "producte", row(85)), approved: true, approvedBy: "Direcció" };
    const saved = JSON.stringify({ ...def, rules: [approved] }); // el que es desa a tariff_template_versions.definition
    const restored = JSON.parse(saved) as TemplateDef; // sessió nova
    const next = load("IBERDROLA_HASTA_30.11.xlsx");
    const r2 = applyTemplate(next, restored, REF);
    expect(r2.compatibility.status).toBe("compatible");
    expect(fin(85, r2)).toEqual([0.128, 0.128, 0.128, 0.128, 0.128, 0.224]);
    expect(row(85, r2).interp!.rules.map((r) => r.title).join()).toMatch(/Estancias Verdes/);
    // preus modificats respecte de la versió anterior
    const d = diffReads(read, r2);
    expect(d.changed.map((c) => c.name).sort()).toEqual(["2.0TD_2 Plan Exclusivo 15%TE/TP 1p", "3.0TD Impulsa Negocios", "3.0TD Plan Exclusivo 15%TE", "3.0TD Plan OMIE 1"].sort());
    expect(d.changed.find((c) => c.name === "3.0TD Plan OMIE 1")!.fields[0]).toMatchObject({ before: 0.027, after: 0.025 });
    expect(fin(68, r2)[0]).toBe(0.148);
    expect(r2.validity.from).toBe("2026-11-16");
  });
  it("confirmar un descompte dubtós, aprovar una regla proposada i la unitat del terme fix del gas", () => {
    const c = parseRuleChat("El descompte del 2n any és correcte", { product: row(11), products: read.products, last: null });
    const wide = withScope({ ...c.rule!, approved: true }, "plantilla", row(11));
    expect(wide.match).toEqual({ discount: "20% s/Te (+5% si ACP) + 5% s/te 2año" });
    const knRule = row(28).interp!.rules.find((r) => !r.approved)!;
    const approvedCopy = { id: knRule.id, title: knRule.title, scope: "plantilla" as const, match: { tariffs: ["2.0TD"], priceCount: 2, product: ["ahorro inteligente 8 horas", "plan solar", "vehiculo electrico", "estancias verdes"] }, set: { review: "" }, explanation: "Direcció confirma la regla de dos preus", source: "direccio" as const, approved: true, approvedBy: "Direcció" };
    const gas = parseRuleChat("El terme fix del gas és en €/mes", { product: null, products: read.products, last: null });
    const r = applyTemplate(wb, { ...def, rules: [wide, approvedCopy, { ...gas.rule!, approved: true }] }, REF);
    expect([11, 12, 13, 35, 61].map((x) => row(x, r).interp!.status)).toEqual(["interpretada", "interpretada", "interpretada", "interpretada", "interpretada"]);
    expect(row(28, r).interp!.status).toBe("interpretada");
    expect(row(110, r).interp!.status).toBe("interpretada");
    const gasOffer = productsToOffers(r, def, { templateId: null, version: 2, fileName: "i.xlsx" }).find((o) => o.product.row === 110)!.offer;
    expect(gasOffer.gasFixedEurDay).toBeCloseTo(5.895 / (365 / 12), 6);
  });
  it("format diferent: NO s'aplica la plantilla antiga i es demana revisar-la", () => {
    const r = applyTemplate(load("IBERDROLA_FORMAT_NOU.xlsx"), def, REF);
    expect(r.compatibility.status).toBe("incompatible");
    expect(r.products).toEqual([]);
    expect(r.issues[0].text).toBe("S'ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura.");
    expect(r.compatibility.differences.join(" ")).toMatch(/O2.*descuento.*condiciones/);
  });
  it("sense pestanya «Energía»: error i selecció manual (mai es canvia de pestanya en silenci)", () => {
    const w: WorkbookGrid = load("IBERDROLA_SENSE_ENERGIA.xlsx");
    const p = proposeTable(w, { supplier: "Iberdrola", name: "x", knowledge: "iberdrola-energia" });
    expect(p.def).toBeNull();
    expect(p.error).toMatch(/No existeix la pestanya «Energía».*Precios/);
    const r = applyTemplate(w, def, REF);
    expect(r.table!.needsSheet).toBe(true);
    expect(r.products).toEqual([]);
    const manual = applyTemplate(w, def, { ...REF, sheet: "Precios" });
    expect(manual.products.length).toBe(100);
    expect(manual.compatibility.status).toBe("canvis_menors");
  });
  it("verificació: la confiança no compta; cal que totes les tarifes estiguin interpretades i les regles aprovades", () => {
    const checks = templateChecks(def, read);
    expect(checks.find((c) => c.id === "interpretacio")!.ok).toBe(false);
    expect(checks.find((c) => c.id === "preus")!.ok).toBe(true);
    expect(checks.find((c) => c.id === "columnes")!.ok).toBe(true);
  });
  it("la IA només rep fragments (mai tot l'Excel d'un cop)", () => {
    const chunks = chunkForAi(read.products, 4000);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.flat().length).toBe(100);
    expect(chunks.every((c) => c.join("").length <= 4000 + 500)).toBe(true);
  });
});

describe("Material d'aprenentatge: Excel amb la interpretació correcta", () => {
  it("compara la lectura amb un Excel de referència i detecta les diferències", async () => {
    const { compareWithReference } = await import("@/comparator/reading-rules");
    const ref = { sheets: [{ name: "Correcte", rows: 4, cols: 7, cells: [
      [{ v: "Producte", t: "s" }, { v: "P1", t: "s" }, { v: "P2", t: "s" }, { v: "P3", t: "s" }, { v: "P4", t: "s" }, { v: "P5", t: "s" }, { v: "P6", t: "s" }],
      [{ v: "3.0TD Impulsa Negocios", t: "s" }, ...[0.1504, 0.1504, 0.1504, 0.1504, 0.1504, 0.3096].map((v) => ({ v, t: "n" }))],
      [{ v: "3.0TD Plan Regantes", t: "s" }, ...[0.149, 0.149, 0.149, 0.149, 0.149, 0.38].map((v) => ({ v, t: "n" }))],
      [{ v: "Producte inexistent", t: "s" }, { v: 0.1, t: "n" }, null, null, null, null, null],
    ] }] };
    const c = compareWithReference(read, ref);
    expect(c.error).toBeNull();
    expect(c.rows.map((r) => r.ok)).toEqual([true, false, false]);
    expect(c.rows[2].product).toBeNull();
  });
});
