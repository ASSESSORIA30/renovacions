/**
 * Fase 14 · LECTOR DE LIQUIDACIONS amb els Excel de Gana Energía (75368.xlsx) i Niba (Septiembre 2026).
 * Els fitxers de tests/fixtures/liquidacions són CÒPIES ANONIMITZADES dels reals: mateixa estructura, pestanyes,
 * dates, estats i imports; els CUPS i l'usuari s'han substituït per valors inventats (cap dada real).
 * Els fitxers reals també s'han llegit en local amb el mateix resultat (no s'inclouen al repositori).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { D } from "@/core/commissions";
import { gridFromBytes, movementFingerprint, normCups, cupsBase, parseDate, parseDecimal, readSettlement, type WorkbookGrid } from "@/core/settlement-reader";

const load = (f: string, name = f) => gridFromBytes(XLSX as never, readFileSync(`tests/fixtures/liquidacions/${f}`), name);
const GANA = load("75368-anonim.xlsx", "75368.xlsx");
const NIBA = load("Liquidacion_Septiembre2026-anonim.xlsx", "Liquidacion_Septiembre2026_info@assessoria30.com.xlsx");
const g = readSettlement(GANA);
const n = readSettlement(NIBA);
const sheet = (r: ReturnType<typeof readSettlement>, name: string) => r.sheets.find((s) => s.name === name)!;
const clone = (wb: WorkbookGrid): WorkbookGrid => JSON.parse(JSON.stringify(wb));

describe("Gana Energía · 75368.xlsx", () => {
  it("detecta Gana per les pestanyes (el nom del fitxer és un número) i llegeix les 8 pestanyes", () => {
    expect(g.supplier?.id).toBe("gana");
    expect(g.supplier?.evidence).toMatch(/pestanyes/);
    expect(g.sheets.map((s) => [s.name, s.role])).toEqual([
      ["Altas LUZ", "moviments"], ["Altas GAS", "moviments"], ["Retrocomisión Alta LUZ", "moviments"], ["Retrocomisión Alta GAS", "moviments"],
      ["Renovaciones LUZ", "moviments"], ["Renovaciones GAS", "moviments"], ["Clientes Activos LUZ", "moviments"], ["Clientes Activos GAS", "moviments"],
    ]);
  });
  it("86 moviments i un net de 2.011,25 €, sense errors", () => {
    expect(g.movements).toHaveLength(86);
    expect(g.total).toBe("2011.25");
    expect(g.errors).toEqual([]);
  });
  it("registres i subtotal de cada pestanya, i quadren amb la fila TOTAL del document", () => {
    const want: [string, number, string][] = [["Altas LUZ", 12, "1160.00"], ["Altas GAS", 8, "620.00"], ["Retrocomisión Alta LUZ", 13, "-877.50"], ["Retrocomisión Alta GAS", 3, "-137.50"], ["Renovaciones LUZ", 34, "1040.00"], ["Renovaciones GAS", 12, "203.75"], ["Clientes Activos LUZ", 3, "2.50"], ["Clientes Activos GAS", 1, "0.00"]];
    for (const [name, count, total] of want) {
      const s = sheet(g, name);
      expect([name, s.count, s.total, s.declaredTotal, s.balanced]).toEqual([name, count, total, total, true]);
    }
  });
  it("la fila TOTAL no és un moviment", () => {
    for (const s of g.sheets) expect(g.movements.some((m) => m.sheet === s.name && m.row === s.totalRow)).toBe(false);
    expect(g.movements.every((m) => m.cups)).toBe(true);
  });
  it("a les sis primeres pestanyes, la columna K (Retribución) és l'import de la comissió", () => {
    expect(sheet(g, "Altas LUZ").columns.amount).toBe("K");
    const first = g.movements[0];
    expect([first.sheet, first.row, first.amount, first.movement, first.kind, first.energy, first.eventDate]).toEqual(["Altas LUZ", 2, "100.00", "alta", "comissio", "llum", "2026-10-22"]);
  });
  it("Clientes Activos: K és €/kWh, L els kWh i M el total → 118 kWh × 0,01 = 1,18 € (no 0,01 €)", () => {
    const cl = g.movements.filter((m) => m.sheet === "Clientes Activos LUZ");
    expect(sheet(g, "Clientes Activos LUZ").columns).toMatchObject({ amount: "K", qty: "L", total: "M" });
    expect(cl.map((m) => [m.amount, m.unit?.qty, m.unit?.price])).toEqual([["1.18", "118", "0.01"], ["0.98", "98", "0.01"], ["0.34", "34", "0.01"]]);
    expect(cl.every((m) => m.movement === "recurrent" && m.eventDate?.startsWith("2026-10"))).toBe(true);
  });
  it("classifica altes, retrocomissions, renovacions i recurrències per pestanya i signe", () => {
    const by = (sh: string) => g.movements.filter((m) => m.sheet === sh);
    expect(by("Altas LUZ").length + by("Altas GAS").length).toBe(20);
    expect(by("Retrocomisión Alta LUZ").every((m) => m.kind === "retrocessio" && D(m.amount).lt(0))).toBe(true);
    expect(by("Retrocomisión Alta GAS").every((m) => m.energy === "gas")).toBe(true);
    expect(g.byMovement.alta).toEqual({ count: 20, total: "1780.00" });
    expect(g.byMovement.retrocessio).toEqual({ count: 16, total: "-1015.00" });
    expect(g.byMovement.renovacio).toEqual({ count: 46, total: "1243.75" });
    expect(g.byMovement.recurrent).toEqual({ count: 4, total: "2.50" });
  });
  it("una renovació negativa és una regularització vinculada a la renovació (no s'elimina ni es compensa)", () => {
    const neg = g.movements.filter((m) => m.movement === "renovacio" && D(m.amount).lt(0));
    expect(neg).toHaveLength(10);
    expect(neg.every((m) => m.kind === "regularitzacio" && m.flags.some((f) => /regularització vinculada a una renovació/.test(f)))).toBe(true);
    expect(neg.reduce((a, m) => a.plus(m.amount), D(0)).toFixed(2)).toBe("-326.25");
  });
  it("els imports zero són moviments vàlids (sense cobrament)", () => {
    const zero = g.movements.filter((m) => D(m.amount).isZero());
    expect(zero.map((m) => `${m.sheet}!${m.row}`)).toEqual(["Altas LUZ!7", "Clientes Activos GAS!2"]);
    expect(zero.every((m) => m.flags.some((f) => /Import zero/.test(f)))).toBe(true);
  });
  it("conserva els estats «Ojo se va» i «Suspendido - Distribuidora» com a avisos, sense excloure el moviment", () => {
    const ojo = g.movements.filter((m) => /ojo/i.test(m.docStatus ?? ""));
    expect(ojo).toHaveLength(2);
    expect(ojo.every((m) => m.kind === "comissio" && m.flags.some((f) => /Ojo se va/.test(f)))).toBe(true);
    const sus = g.movements.find((m) => /suspend/i.test(m.docStatus ?? ""))!;
    expect([sus.amount, sus.kind]).toEqual(["70.00", "comissio"]);
  });
  it("dates de 2025 en renovacions i retrocomissions liquidades el 2026; dates diferents per a cada concepte", () => {
    const r = g.movements.find((m) => m.sheet === "Retrocomisión Alta LUZ")!;
    expect(r.dates.activation?.startsWith("2025")).toBe(true);
    expect(r.eventDate).toBe(r.dates.baixa);
    expect(r.dates.baixa?.startsWith("2026")).toBe(true);
  });
  it("claus estables úniques dins del document", () => {
    expect(new Set(g.movements.map((m) => m.stableKey)).size).toBe(86);
  });
});

describe("Niba · Liquidación Septiembre 2026", () => {
  it("detecta Niba pel contingut (el nom del fitxer no ho diu), 1 pestanya, 31 moviments i 2.792,00 €", () => {
    expect(n.supplier?.id).toBe("niba");
    expect(n.sheets).toHaveLength(1);
    expect(n.movements).toHaveLength(31);
    expect(n.total).toBe("2792.00");
    expect(n.errors).toEqual([]);
    expect(n.movements.some((m) => /total/i.test(m.cupsRaw ?? ""))).toBe(false);
  });
  it("27 altes de llum (2.800 €), 2 de gas (120 €), una baixa de llum (−80 €) i una de gas (−48 €)", () => {
    const sumOf = (xs: typeof n.movements) => xs.reduce((a, m) => a.plus(m.amount), D(0)).toFixed(2);
    const altaL = n.movements.filter((m) => m.movement === "alta" && m.energy === "llum");
    const altaG = n.movements.filter((m) => m.movement === "alta" && m.energy === "gas");
    const baixa = n.movements.filter((m) => m.movement === "baixa");
    expect([altaL.length, sumOf(altaL), altaG.length, sumOf(altaG)]).toEqual([27, "2800.00", 2, "120.00"]);
    expect(baixa.map((m) => [m.energy, m.amount, m.kind])).toEqual([["gas", "-48.00", "retrocessio"], ["llum", "-80.00", "retrocessio"]]);
  });
  it("ESTADO és l'estat del contracte, no un cobrament; els productes es conserven", () => {
    expect(new Set(n.movements.map((m) => m.docStatus))).toEqual(new Set(["EN VIGOR", "BAJA"]));
    expect(new Set(n.movements.map((m) => m.product))).toEqual(new Set(["niba Zen", "niba Flex", "niba Gas", "niba Negocios", "niba Flex Negocios"]));
    expect(n.movements.find((m) => m.movement === "baixa")!.eventDate).toMatch(/^2026-09/);
  });
  it("mai aplica una regla de Gana a Niba: cada document amb el seu format", () => {
    expect(n.format).toBe("niba");
    expect(n.sheets[0].columns).toMatchObject({ type: "A", cups: "B", product: "C", line: "D", amount: "H" });
  });
});

describe("Gana + Niba", () => {
  it("117 moviments i 4.803,25 € nets liquidats (comprovació matemàtica, no són cobraments)", () => {
    expect(g.movements.length + n.movements.length).toBe(117);
    expect(D(g.total).plus(n.total).toFixed(2)).toBe("4803.25");
  });
});

describe("validació, format i duplicats", () => {
  it("si una pestanya no quadra amb el seu TOTAL, és un error que s'ha de revisar", () => {
    const wb = clone(GANA);
    wb.sheets[0].rows[1][10] = 90;                        // Altas LUZ fila 2: 100 → 90
    const r = readSettlement(wb);
    expect(r.errors.join(" ")).toMatch(/Altas LUZ.*no quadra.*1160\.00/);
    expect(sheet(r, "Altas LUZ").balanced).toBe(false);
  });
  it("detecta un canvi de format (capçaleres diferents) i la signatura canvia", () => {
    const wb = clone(GANA);
    wb.sheets[6].rows[0][12] = "Importe";                 // Clientes Activos LUZ: «Total» → «Importe»
    const r = readSettlement(wb);
    expect(r.signature).not.toBe(g.signature);
    expect(r.errors.join(" ")).toMatch(/Clientes Activos LUZ.*Retribución, KWh Activa i Total/);
  });
  it("una pestanya desconeguda en un document de Gana no s'importa sense revisió", () => {
    const wb = clone(GANA);
    wb.sheets.push({ name: "Bonus Especial", rows: [["CUPS", "Importe"], ["ES0031000000000099ZZ", 50]] });
    const r = readSettlement(wb);
    expect(r.movements).toHaveLength(86);
    expect(r.warnings.join(" ")).toMatch(/Bonus Especial/);
  });
  it("la mateixa liquidació reimportada té les mateixes empremtes (duplicats); la renovació de l'any següent no", () => {
    const m = g.movements.find((x) => x.movement === "renovacio")!;
    expect(movementFingerprint("Gana Energía", m, "2026-10-31")).toBe(movementFingerprint("GANA ENERGÍA", { ...m }, "2026-10-31"));
    expect(movementFingerprint("Gana Energía", m, "2026-10-31")).not.toBe(movementFingerprint("Gana Energía", m, "2027-10-31"));
    const a = g.movements.find((x) => x.movement === "alta")!;
    expect(movementFingerprint("Gana Energía", a, "2026-10-31")).toBe(movementFingerprint("Gana Energía", a, "2026-11-30"));
  });
  it("lector genèric per capçaleres (CSV d'una altra comercialitzadora) amb TOTAL i signes", () => {
    const csv = "Concepto;CUPS;Importe\nAlta;ES0031000000000001AA0F;\"120,50\"\nRetrocesión;ES0031000000000002BB;-30\nTOTAL;;90,50\n";
    const r = readSettlement(gridFromBytes(XLSX as never, Buffer.from(csv), "altra.csv"));
    expect(r.format).toBe("generic");
    expect(r.movements.map((m) => [m.cups, m.movement, m.kind, m.amount])).toEqual([["ES0031000000000001AA0F", "alta", "comissio", "120.50"], ["ES0031000000000002BB", "retrocessio", "retrocessio", "-30.00"]]);
    expect(r.sheets[0].balanced).toBe(true);
  });
  it("CUPS: majúscules i sense espais; el sufix 0F és opcional i no es retallen caràcters a cegues", () => {
    expect(normCups(" es0031 0000 0000 0001 aa ")).toBe("ES0031000000000001AA");
    expect(cupsBase("ES0031000000000001AA0F")).toBe("ES0031000000000001AA");
    expect(cupsBase("ES0031000000000001AA")).toBe("ES0031000000000001AA");
    expect(normCups("ES00310000000000")).toBeNull();
  });
  it("imports i dates en formats habituals, amb precisió decimal", () => {
    expect(["1.234,56", "-12,5", "(12,00)", "100.0", "1,234.56"].map(parseDecimal)).toEqual(["1234.56", "-12.5", "-12", "100", "1234.56"]);
    expect(["22-10-2026", "05/10/2026", "2026-09-04 00:00:00", "31-02-2026"].map(parseDate)).toEqual(["2026-10-22", "2026-10-05", "2026-09-04", null]);
    expect(D("0.1").plus("0.2").toString()).toBe("0.3");
  });
});
