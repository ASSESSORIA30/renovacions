/**
 * Fase 14.1 · Lector integrat de Naturgy al catàleg («Llegir fitxer de tarifes») amb l'Excel REAL
 * NC-Productos-Captacion-PYMES-20261029-VP.xlsx (només preus de tarifes, cap dada personal).
 * Es llegeix el document SENCER al navegador, sense IA i sense cap plantilla desada a Supabase.
 * També: conversió determinista d'unitats (llum, gas i energia).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { gridFromXlsx } from "@/comparator/xlsx-template";
import { readKnownWorkbook, templateLabel } from "@/comparator/known-reader";
import { checkVersion } from "@/comparator/catalog";
import { aiTariffsToVersions, splitSheetText } from "@/comparator/tariff-ai";
import { fromInternal, normalizeOfferUnits, parseUnit, seriesToInternal, toInternal } from "@/comparator/units";
import { computeCost } from "@/comparator/engine";
import { emptySupply } from "@/ui/views/comparatives/state";
import { emptySheet } from "@/comparator/types";

const NAME = "NC-Productos-Captacion-PYMES-20261029-VP.xlsx";
const wb = gridFromXlsx(XLSX as never, readFileSync(`tests/fixtures/naturgy/${NAME}`), NAME);
const r = readKnownWorkbook(wb, { existing: [], today: "2026-11-03" })!;
const item = (name: string, tariff?: string) => r.items.find((i) => i.offer.productName === name && (!tariff || i.offer.accessTariff === tariff))!;
const count = (xs: typeof r.items) => xs.reduce<Record<string, number>>((a, i) => ({ ...a, [i.status]: (a[i.status] ?? 0) + 1 }), {});

describe("Naturgy · reconeixement i lectura completa", () => {
  it("reconeix Naturgy i la plantilla «Captación PYMES» sense plantilla desada ni IA", () => {
    expect([r.supplier, r.template, r.source]).toEqual(["Naturgy", "Naturgy · Captación PYMES", "lector_integrat"]);
    expect(templateLabel(NAME)).toBe("Captación PYMES");
  });
  it("les dues pestanyes: OCT26_3_VP és la de preus i «Seguimiento info» són metadades", () => {
    expect(r.sheet).toBe("OCT26_3_VP");
    expect(r.metadataSheets).toEqual(["Seguimiento info"]);
    expect(r.validity).toBe("OCT 2026 · versió 3");
  });
  it("set famílies de llum i gas + Temporada/Obra (#N/A) i l'apartat de serveis", () => {
    expect(r.families.map((f) => [f.title, f.products])).toEqual([
      ["PLAN FIJO LUZ 24h (E0008)", 9], ["PLAN FIJO LUZ (E0009)", 9], ["PLAN FIJO LUZ ECO (E0010)", 9], ["PLAN VARIABLE LUZ (E0013)", 9],
      ["TEMPORADA/OBRA", 0], ["PLAN VARIABLE GAS (G0009)", 15], ["PLAN COMPROMISO GAS (G0007)", 10],
    ]);
    expect(r.families.find((f) => f.title === "TEMPORADA/OBRA")!.excluded).toBe(true);
    expect(r.services.map((s) => s.name)).toEqual(["SVG GC Complet (RL.4/RL.5)", "SVE GC Xpress (20TD/30TD)", "SVS GC <10kWp  (2.0TD/3.0TD)", "Batería Virtual"]);
  });
  it("el document sencer d'un cop: 61 tarifes, sense límit ni divisió manual", () => {
    expect(r.items).toHaveLength(61);
    expect(r.items.every((i) => i.offer.origin === "excel" && i.offer.status === "esborrany")).toBe(true);
  });
  it("variants M, ONE i SUPRA separades (no es fusionen)", () => {
    expect(["M", "ONE", "SUPRA"].map((v) => item(`Plan Fijo Luz 24h 2.0 · ${v}`).offer.energy24h)).toEqual([0.2099, 0.192, 0.2278]);
  });
});

describe("Naturgy · valors exigits", () => {
  it("Plan Fijo Luz 24h 2.0TD: potència P1 i P2 exactes (€/kW·dia)", () => {
    const o = item("Plan Fijo Luz 24h 2.0 · M").offer;
    expect(o.powerUnit).toBe("eur_kw_dia");
    expect(o.power[0]).toBeCloseTo(0.12297297534246576, 14);
    expect(o.power[1]).toBeCloseTo(0.04397602191780822, 14);
  });
  it("Plan Fijo Luz 2.0TD trihorari, variant principal: P1 0,2797 · P2 0,2068 · P3 0,1722", () => {
    expect(item("Plan Fijo Luz 2.0 TRIHORARIO · M").offer.energy.slice(0, 3)).toEqual([0.2797, 0.2068, 0.1722]);
  });
  it("Plan Variable Gas RL.1: terme fix 0,0772908493150685 €/client·dia i els tres preus variables", () => {
    const g = ["SUPRA", "Base", "ONE"].map((v) => item(`PLAN VARIABLE GAS MENSUAL · ${v}`, "RL.1").offer);
    expect(g.map((o) => o.energy24h)).toEqual([0.103811, 0.100811, 0.09793]);
    for (const o of g) { expect(o.gasFixedEurDay).toBeCloseTo(0.0772908493150685, 15); expect(o.units?.gasFixed?.unit).toBe("€/día/cliente"); }
  });
  it("trams RL.1–RL.5 i cap preu sortit d'una cel·la #N/A (no són zeros)", () => {
    expect([...new Set(r.items.filter((i) => i.offer.energyType === "gas").map((i) => i.offer.accessTariff))]).toEqual(["RL.1", "RL.2", "RL.3", "RL.4", "RL.5"]);
    expect(r.items.every((i) => [...i.offer.energy, i.offer.energy24h, ...i.offer.power].every((x) => x == null || x > 0))).toBe(true);
  });
});

describe("Naturgy · validació, activació i reimportació", () => {
  it("sense confirmar: les famílies «Variable» queden pendents (no s'activen); la resta són completes", () => {
    // Fase 2: les 18 tarifes fixes 3.0TD/6.1TD no porten permanència al document → «revisió» (permanència obligatòria pendent)
    expect(count(r.items)).toEqual({ nova: 19, revisio: 18, incompleta: 24 });
    expect(item("PLAN VARIABLE GAS MENSUAL · ONE", "RL.1").errors.join(" ")).toMatch(/Classificació pendent/);
  });
  it("en confirmar que les «Variable» són de preu fix revisable: 54 noves, 1 per revisar i 6 incompletes (sense P1–P3 al document)", () => {
    const pend = Object.fromEntries(r.families.filter((f) => f.pending && !f.excluded).map((f) => [f.id, "fixa" as const]));
    const c = readKnownWorkbook(wb, { existing: [], classification: pend })!;
    expect(count(c.items)).toEqual({ nova: 36, revisio: 19, incompleta: 6 });
    expect(c.items.filter((i) => i.status === "incompleta").every((i) => i.errors.some((e) => /Falta el preu d'energia P1/.test(e)))).toBe(true);
  });
  it("una tarifa completa sense data de fi de vigència es pot activar (és informatiu, no un avís)", () => {
    const ch = checkVersion(item("Plan Fijo Luz 3.0 · ONE", "3.0TD").offer);
    expect([ch.ok, ch.info]).toEqual([true, ["Sense data de fi de vigència", "Compensació d'excedents no informada"]]);
    // Fase 2: fixa 3.0TD sense permanència al document → avís (no s'activa fins que es confirmi)
    expect(ch.warnings).toEqual(["Permanència obligatòria pendent de configurar (tarifa fixa 3.0TD/6.1TD)"]);
  });
  it("reimportar el mateix Excel no crea duplicats: totes surten «sense canvis»", () => {
    const existing = r.items.map((i) => ({ ...i.offer, status: "activa" as const, productId: `p-${i.offer.id}` }));
    expect(count(readKnownWorkbook(wb, { existing })!.items)).toEqual({ sense_canvis: 37, incompleta: 24 });
  });
  it("amb una plantilla verificada compatible se'n fan servir les regles", () => {
    const v = readKnownWorkbook(wb, { existing: [], def: { ...r.def, blocks: r.def.blocks.map((b) => (b.classification === "pendent" ? { ...b, classification: "fixa" as const } : b)) } })!;
    expect(v.source).toBe("plantilla_verificada");
    expect(count(v.items).nova + count(v.items).revisio).toBe(55);
  });
});

describe("conversió d'unitats (determinista)", () => {
  it("gas: 120 €/client/any → 0,3287671233 €/client·dia", () => {
    expect(toInternal(120, "€/client/any", "terme_fix_gas").value).toBeCloseTo(0.3287671233, 10);
    expect(toInternal(120, "€/cliente y año", "terme_fix_gas").value).toBeCloseTo(0.3287671233, 10);
  });
  it("llum: 35 €/kW/any → 0,0958904110 €/kW·dia, per a cada període P1–P6", () => {
    expect(toInternal(35, "€/kW/año", "potencia").value).toBeCloseTo(0.095890411, 10);
    const s = seriesToInternal([35, 20, 10, null, null, 3.65], "€/kW y año", "potencia");
    expect(s.values.map((x) => (x == null ? null : Number(x.toFixed(10))))).toEqual([0.095890411, 0.0547945205, 0.0273972603, null, null, 0.01]);
  });
  it("energia: 150 €/MWh → 0,15 €/kWh i 15 c€/kWh → 0,15 €/kWh", () => {
    expect(toInternal(150, "€/MWh", "energia").value).toBe(0.15);
    expect(toInternal(15, "c€/kWh", "energia").value).toBe(0.15);
  });
  it("quota mensual: × 12 ÷ 365 (365 dies, ni 360 ni 366)", () => {
    expect(toInternal(10, "€/cliente/mes", "terme_fix_gas").value).toBeCloseTo((10 * 12) / 365, 12);
    expect(toInternal(2, "€/kW/mes", "potencia").value).toBeCloseTo((2 * 12) / 365, 12);
  });
  it("distingeix €/client/any de €/kW/any: un terme fix per kW no es converteix sense potència de referència", () => {
    const k = toInternal(30, "€/kW/año", "terme_fix_gas");
    expect([k.ok, k.value]).toEqual([false, null]);
    expect(k.reason).toMatch(/potència de referència/);
    expect(parseUnit("€/client/any")!.per).toBe("client");
    expect(parseUnit("€/kW/any")!.per).toBe("kw");
    expect(toInternal(0.2, "€/kWh", "potencia").ok).toBe(false);          // no confon energia amb potència
  });
  it("unitat desconeguda: no es posa cap zero, queda pendent amb el motiu", () => {
    const u = toInternal(5, "unitats", "terme_fix_gas");
    expect([u.ok, u.value]).toEqual([false, null]);
  });
  it("conserva la unitat original i no converteix mai dues vegades", () => {
    const base = { ...emptySheet(), power: [36.5, 18.25, null, null, null, null], powerUnit: "eur_kw_any" as const };
    const a = normalizeOfferUnits(base).offer;
    expect([a.powerUnit, a.power[0], a.units?.power]).toEqual(["eur_kw_dia", 0.1, { values: [36.5, 18.25, null, null, null, null], unit: "€/kW·any" }]);
    const b = normalizeOfferUnits(a).offer;
    expect(b.power).toEqual(a.power);
    expect(b.units?.power?.values[0]).toBe(36.5);
  });
  it("el formulari mostra en altres unitats sense tocar el valor desat (inversa exacta)", () => {
    expect(fromInternal(0.15, "€/MWh", "energia")).toBe(150);
    expect(fromInternal(0.15, "c€/kWh", "energia")).toBe(15);
    expect(fromInternal(toInternal(120, "€/cliente/año", "terme_fix_gas").value, "€/cliente/año", "terme_fix_gas")).toBe(120);
  });
  it("el comparador dona el mateix cost amb €/kW·any original i amb el valor convertit (anual i mensual)", () => {
    const sup = { ...emptySupply(), accessTariff: "2.0TD", kwh: [1000, 800, 1200, null, null, null], kw: [4.6, 4.6, null, null, null, null], days: 365 };
    const any = { ...emptySheet(), contractType: "periodes" as const, energy: [0.2, 0.15, 0.1, null, null, null], power: [36.5, 18.25, null, null, null, null], powerUnit: "eur_kw_any" as const };
    const dia = normalizeOfferUnits(any).offer;
    for (const days of [365, 30]) {
      const s = { ...sup, days };
      expect(computeCost(dia, s as never).total).toBeCloseTo(computeCost(any, s as never).total, 6);
    }
  });
  it("lector amb IA: el terme fix del gas i l'energia en €/MWh es converteixen sols (la IA només diu la unitat)", () => {
    const raw = { offers: [{ productName: "Gas Fix", energyType: "gas", accessTariff: "RL.2", energy24h: 65, energyUnit: "€/MWh", gasFixedValue: 120, gasFixedUnit: "€/cliente/año", confidence: "alta" }] };
    const it0 = aiTariffsToVersions(raw, { fileName: "gas.pdf", supplierHint: "Comercialitzadora Exemple", existing: [] }).items[0];
    expect(it0.offer.energy24h).toBe(0.065);
    expect(it0.offer.gasFixedEurDay).toBeCloseTo(0.3287671233, 10);
    expect(it0.offer.units?.gasFixed).toEqual({ value: 120, unit: "€/cliente/año" });
    expect(it0.errors).toEqual([]);
    const kw = aiTariffsToVersions({ offers: [{ ...raw.offers[0], gasFixedUnit: "€/kW/año" }] }, { fileName: "gas.pdf", supplierHint: "X", existing: [] }).items[0];
    expect(kw.offer.gasFixedEurDay).toBeNull();
    expect(kw.status).toBe("incompleta");
    expect(kw.errors.join(" ")).toMatch(/potència de referència/);
  });
  it("lector amb IA: els fulls grans es parteixen en fragments amb les capçaleres (mai «divideix el document»)", () => {
    const rows = Array.from({ length: 3000 }, (_, i) => `Producte ${i}\t2.0TD\t0.${String(1000 + i)}`);
    const text = `### Full: Preus\nProducte\tPeatge\tEnergia\n${rows.join("\n")}\n`;
    const parts = splitSheetText(text, 24_000);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.startsWith("### Full: Preus\n") && p.includes("Producte\tPeatge\tEnergia") && p.length <= 24_000)).toBe(true);
    // cada fila surt UNA sola vegada com a dada (les capçaleres repetides van marcades com a context)
    const body = parts.map((p) => p.replace(/<capcaleres[\s\S]*?<\/capcaleres>\n/, "")).join("\n");
    expect(body.match(/Producte \d+/g)).toHaveLength(3000);
  });
});
