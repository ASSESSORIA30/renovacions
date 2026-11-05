/**
 * Col·laboradors · importació i percentatges (lògica pura + motor de comissions existent). Dades fictícies:
 * 20 files amb la mateixa estructura que l'Excel d'usuaris (18 «Comercial», 1 «Usuario», 1 «Administrador»).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LEVELS, classify, rowsFromGrid, cleanLevels, levelOf, mapHeaders, normalizeRows, personKind, propose, splitCommission, type Existing } from "@/core/collaborators";
import { computeCommission, pickRule, type Facts, type RuleRow } from "@/core/commissions";

// DNI fictici vàlid: 8 xifres + lletra de control
const dni = (n: number) => { const num = String(10000000 + n * 7919).padStart(8, "0"); return num + "TRWAGMYFPDXBNJZSQVHLCKE"[Number(num) % 23]; };
const file = Array.from({ length: 20 }, (_, i) => ({
  Nombre: i === 0 ? "  MARIA  " : `Persona${i}`, Apellidos: i === 0 ? "garcía de la PRUEBA" : `Cognom${i}`, DNI: dni(i), Email: `persona${i}@exemple.test`, "Teléfono": `+34 600 000 ${String(100 + i)}`,
  "Dirección": `C/ Inventada ${i}`, Localidad: "LLEIDA", Provincia: "lleida", "Código Postal": i === 1 ? 8001 : "25001",
  Etiqueta: i === 18 ? "Usuario" : i === 19 ? "Administrador" : "Comercial", "Creado En": "15/03/2025 10:30", Representante: null,
}));

describe("lectura de l'Excel", () => {
  const { rows, headers } = normalizeRows(file);
  it("reconeix totes les capçaleres i llegeix les 20 files", () => {
    expect(rows).toHaveLength(20);
    expect(headers.missing).toEqual([]);
    expect(mapHeaders(Object.keys(file[0])).map).toMatchObject({ name: "Nombre", lastName: "Apellidos", taxId: "DNI", postalCode: "Código Postal", createdAt: "Creado En", representative: "Representante" });
  });
  it("18 col·laboradors i 2 pendents de classificar, sense duplicats interns", () => {
    expect(rows.filter((r) => r.classification === "collaborador")).toHaveLength(18);
    expect(rows.filter((r) => r.classification === "pendent_classificacio").map((r) => r.label)).toEqual(["Usuario", "Administrador"]);
    expect(rows.every((r) => !r.errors.length)).toBe(true);
  });
  it("normalitza noms, correus, telèfons, codis postals i dates", () => {
    expect(rows[0]).toMatchObject({ name: "Maria", lastName: "García de la Prueba", city: "Lleida", province: "Lleida", phone: "600000100", personKind: "fisica", taxIdValid: true });
    expect(rows[1].postalCode).toBe("08001");
    expect(rows[0].createdAt).toBe("2025-03-15T10:30:00.000Z");
    expect(rows[0].representative).toBeNull();
  });
  it("detecta duplicats dins del fitxer", () => {
    const dup = normalizeRows([file[2], { ...file[3], DNI: file[2].DNI }]).rows;
    expect(dup[1].errors.join(" ")).toMatch(/Repetit dins del fitxer/);
  });
  it("persona física o jurídica", () => {
    expect(personKind("B12345674")).toBe("juridica");
    expect(personKind("X1234567L")).toBe("fisica");
    expect(classify("comercial")).toBe("collaborador");
    expect(classify("Administrador")).toBe("pendent_classificacio");
  });
});

describe("capçaleres que no són a la primera fila", () => {
  it("troba la fila de capçaleres encara que a dalt hi hagi files buides o un títol", () => {
    const heads = Object.keys(file[0]);
    const grid: unknown[][] = [[null, null, null], ["Usuaris amb jerarquia"], heads, ...file.slice(0, 3).map((r) => heads.map((h) => (r as Record<string, unknown>)[h])), [null, null]];
    const g = rowsFromGrid(grid);
    expect(g.headerRow).toBe(3);
    expect(g.rows).toHaveLength(3);
    expect(normalizeRows(g.rows).headers.missing).toEqual([]);
  });
  it("sense nom ni correu no s'inventa cap capçalera", () => {
    expect(rowsFromGrid([["A", "B"], [1, 2]]).headerRow).toBeNull();
  });
});

describe("duplicats contra la base de dades", () => {
  const { rows } = normalizeRows(file);
  const existing: Existing[] = [
    { id: "p1", name: "Persona2 Cognom2", tax_id_norm: rows[2].taxId, email: null, phone: null, user_id: null },
    { id: "p2", name: "Algú amb el mateix correu", tax_id_norm: null, email: rows[3].email, phone: null, user_id: null },
  ];
  const users = [{ id: "u1", email: rows[4].email!, role: "comercial", name: "Usuari intern" }];
  it("mateix DNI → completar; només correu → revisar; usuari del CRM → revisar; res → crear", () => {
    expect(propose(rows[2], existing, users)).toMatchObject({ action: "actualitzar", target: "p1" });
    expect(propose(rows[3], existing, users).action).toBe("revisar");
    expect(propose(rows[4], existing, users).reason).toMatch(/usuari del CRM/);
    expect(propose(rows[5], existing, users).action).toBe("crear");
  });
  it("reimportar el mateix fitxer no crea cap duplicat", () => {
    const after: Existing[] = rows.map((r, i) => ({ id: `x${i}`, name: r.fullName, tax_id_norm: r.taxId, email: r.email, phone: r.phone, user_id: null }));
    expect(rows.map((r) => propose(r, after, []).action).filter((a) => a === "crear")).toHaveLength(0);
  });
});

describe("percentatges", () => {
  it("nivells per defecte editables i personalitzats amb decimals", () => {
    expect(DEFAULT_LEVELS).toMatchObject({ n1: { pct: 70 }, n2: { pct: 50 }, n3: { pct: 30 } });
    expect(cleanLevels({ n1: { pct: 72.5 } }).n1.pct).toBe(72.5);
    expect(cleanLevels({ n1: { pct: 150 } }).n1.pct).toBe(70);
    expect(levelOf("50", DEFAULT_LEVELS)).toBe("n2");
    expect(levelOf("62.5", DEFAULT_LEVELS)).toBe("personalitzat");
  });
  it("repartiment sobre la comissió d'Assessoria", () => {
    expect(splitCommission(100, 70)).toMatchObject({ collaborator: "70.00", remainder: "30.00" });
    expect(splitCommission(100, 50)).toMatchObject({ collaborator: "50.00", remainder: "50.00" });
    expect(splitCommission(100, 30)).toMatchObject({ collaborator: "30.00", remainder: "70.00" });
    expect(splitCommission("85.55", "62.5")).toMatchObject({ collaborator: "53.47", remainder: "32.08" });
  });
});

describe("motor existent: prioritat, vigència i base", () => {
  const C = "11111111-1111-1111-1111-111111111111";
  const rule = (p: Partial<RuleRow>): RuleRow => ({ id: Math.random().toString(), rule_key: "collab_x", version: 1, name: "r", layer: "collaborador", retailer: null, product: null, service: null, segment: null, beneficiary_id: C, kind: "pct_comissio_rebuda", value: "70", unit: "pct", tiers: null, conditions: {}, base_formula: "Comissió rebuda", base_validated: true, valid_from: "2026-01-01", valid_to: null, status: "aprovada", notes: null, ...p });
  const facts = (p: Partial<Facts> = {}): Facts => ({ retailer: "Comercialitzadora Prova", product: "Tarifa Fixa", service: "llum_empresa", segment: "pime", refDate: "2026-11-04", annualKwh: 12000, annualKwhSource: "", eligibleMwh: null, energyIncrementEurKwh: null, powerIncrementEurKwDay: null, powerKw: null, months: 12, providerAmount: "100.00", providerAmountSource: "confirmat", ...p });
  it("70 % de 100 € de comissió confirmada = 70 € (no sobre el consum)", () => {
    const r = pickRule([rule({})], facts(), "collaborador", C);
    expect(computeCommission(r.rule!, facts())).toMatchObject({ status: "calculat", amount: "70.00" });
  });
  it("l'excepció per producte té prioritat sobre el general", () => {
    const rules = [rule({ value: "70" }), rule({ rule_key: "collab_x_xp", product: "Fixa", value: "50" })];
    expect(pickRule(rules, facts(), "collaborador", C).rule!.value).toBe("50");
    expect(pickRule(rules, facts({ product: "Indexada" }), "collaborador", C).rule!.value).toBe("70");
  });
  it("històric: fins al 31/12/2026 el 50 %, des de l'01/01/2027 el 70 %", () => {
    const rules = [rule({ version: 1, value: "50", valid_to: "2026-12-31" }), rule({ version: 2, value: "70", valid_from: "2027-01-01" })];
    expect(pickRule(rules, facts({ refDate: "2026-06-01" }), "collaborador", C).rule!.value).toBe("50");
    expect(pickRule(rules, facts({ refDate: "2027-02-01" }), "collaborador", C).rule!.value).toBe("70");
  });
  it("sense comissió del proveïdor no es calcula res (no s'inventa la base)", () => {
    expect(computeCommission(rule({}), facts({ providerAmount: null })).status).not.toBe("calculat");
  });
  it("un altre col·laborador no rep la regla personal", () => {
    expect(pickRule([rule({})], facts(), "collaborador", "22222222-2222-2222-2222-222222222222").rule).toBeNull();
  });
});
