import { describe, expect, it } from "vitest";
import { compare } from "../src/core/compare";
import { addMonths, anyToISO } from "../src/core/dates";
import { importContracts, normalizePhone } from "../src/core/importer";
import { computePriority, DEFAULT_WEIGHTS } from "../src/core/priority";
import { render } from "../src/core/templates";
import { DEFAULT_SETTINGS } from "../src/data/defaults";
import type { Contract, Offer } from "../src/core/types";

const H = ["CIF Cuenta", "Nombre *", "Dirección *", "Población *", "Provincia *", "Código Postal *", "Tipo de producto *", "Comercializadora *", "Tarifa *", "Producto *", "CUPS *", "Consumo", "Estado", "Fecha activación", "Fecha tramitación", "Fecha traspaso", "Nº teléfono", "Correo electrónico", "IBAN *"];
const row = (o: Partial<Record<string, unknown>>) => H.map((h) => o[h] ?? null);

describe("importer", () => {
  const sheet = { name: "Contratos", rows: [H,
    row({ "CIF Cuenta": "B1", "Nombre *": "ACME SL - RENOV", "Tipo de producto *": "Contrato de luz", "Tarifa *": "Tarifa 2.0TD", "CUPS *": "ES001", "Fecha tramitación": "01/11/2025", "Fecha traspaso": "01/05/2025", "Nº teléfono": 612345678, "IBAN *": "ES00 SECRET" }),
    row({ "CIF Cuenta": "B1", "Nombre *": "ACME SL", "Tipo de producto *": "Contrato de luz", "Tarifa *": "Tarifa 2.0TD", "CUPS *": "es001", "Fecha tramitación": "05/11/2026", "Fecha traspaso": "05/11/2026" }),
    row({ "CIF Cuenta": "C2", "Nombre *": "OLD", "Tipo de producto *": "Contrato de gas", "Tarifa *": "Tarifa RL1", "CUPS *": "ES002", "Fecha traspaso": "15/05/2025", "Estado": "Baja" }),
  ] };
  const diario = { name: "2026", rows: [["MES", "DATA", "CLIENT", "CUPS", "ADMIN GESTIONO", "COMENTARIO LLAMADA"], ["ENERO", new Date(2026, 0, 2), "ACME", "ES001", "OLIVIÉ", "llamar tarde"]] };
  const { contracts, report } = importContracts({ today: "2026-10-30", crm: { sheet }, diario: { sheets: [diario] } });

  it("dedupes by CUPS (case-insensitive) keeping the latest record", () => {
    expect(contracts).toHaveLength(2);
    const acme = contracts.find((c) => c.cups === "ES001")!;
    expect(acme.fechaInicio).toBe("2026-11-05");
    expect(acme.vencimiento).toBe("2027-11-05");
    expect(acme.contratosPrevios).toBe(1);
    expect(acme.cliente).toBe("ACME SL");
  });
  it("joins diario by CUPS and normalizes people", () => {
    const acme = contracts.find((c) => c.cups === "ES001")!;
    expect(acme.comercial).toBe("OLIVIE");
    expect(acme.comentarioLlamada).toBe("llamar tarde");
  });
  it("flags import dates, rolls tacit renewals and marks bajas", () => {
    const old = contracts.find((c) => c.cups === "ES002")!;
    expect(old.fechaInicioFuente).toBe("importacion_crm");
    expect(old.renovacionTacita).toBe(true);
    expect(old.vencimiento).toBe("2027-05-15");
    expect(old.status).toBe("no_renueva");
    expect(report.fechasEstimadas).toBe(1);
  });
  it("never imports IBAN", () => {
    expect(JSON.stringify(contracts)).not.toContain("SECRET");
  });
});

describe("helpers", () => {
  it("phones", () => {
    expect(normalizePhone("650 79 04 02")).toBe("+34650790402");
    expect(normalizePhone(612345678)).toBe("+34612345678");
  });
  it("dates", () => {
    expect(anyToISO("1/2/2026")).toBe("2026-02-01");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
  });
  it("templates leave unknown variables visible", () => {
    expect(render("Hola {{nombre}} {{x}}", { nombre: "Ana" })).toBe("Hola Ana {{x}}");
  });
});

describe("compare", () => {
  const offer: Offer = { id: "o", comercializadora: "X", nombre: "Y", tarifa: "2.0TD", energia: [0.1, 0.1, 0.1], potencia: [0.1, 0.1], validaHasta: "2099-01-01", verificada: true };
  it("refuses when data is missing", () => {
    const r = compare({ tarifa: "2.0TD", kwhPorPeriodo: [1000, null, 500], kwPorPeriodo: [4, 4], actual: { energia: [0.2, 0.2, 0.2], potencia: [0.1, 0.1] }, propuesta: offer, settings: DEFAULT_SETTINGS });
    expect(r.ok).toBe(false);
  });
  it("computes savings", () => {
    const r = compare({ tarifa: "2.0TD", kwhPorPeriodo: [1000, 1000, 1000], kwPorPeriodo: [4, 4], actual: { energia: [0.2, 0.2, 0.2], potencia: [0.1, 0.1] }, propuesta: offer, settings: { ...DEFAULT_SETTINGS, iee: 0, iva: 0 } });
    if (!r.ok) throw new Error("expected ok");
    expect(r.ahorro).toBeCloseTo(300, 6); // 3000 kWh × 0.1 €/kWh
  });
});

describe("priority", () => {
  const base = { id: "a", tarifa: "3.0TD", consumoAnual: 60000, vencimiento: "2026-11-02", renovacionTacita: false, tipo: "luz" } as unknown as Contract;
  it("urgent big contract without contact is critical; closed scores 0", () => {
    const p = computePriority({ ...base, crm: { contractId: "a", status: "pendiente", statusChangedAt: "", statusChangedBy: "", version: 0 } }, [], DEFAULT_WEIGHTS, "2026-10-30");
    expect(p.level).toBe("critica");
    const q = computePriority({ ...base, crm: { contractId: "a", status: "renovado", statusChangedAt: "", statusChangedBy: "", version: 0 } }, [], DEFAULT_WEIGHTS, "2026-10-30");
    expect(q.score).toBe(0);
  });
});

import { parseOffersTemplate } from "../src/core/offersTemplate";
describe("offers template", () => {
  const rows = [
    ["ZocoProductos V1.4"],
    ["Comercializadora", "Tipo", "Tarifa", "Producto", "Fijo", "Variable", "P1", "P2", "P3", "P4", "P5", "P6", "P1", "P2", "P3", "P4", "P5", "P6"],
    ["Naturgy", "Electricidad", "Tarifa 2.0TD", "Luz", null, null, "0.1", "0.05", null, null, null, null, "0,2", "0.15", "0.1"],
    ["Naturgy", "Dual", "Tarifa 2.0TD", "Combo", 0.06, 0.07, 0.1, 0.05, null, null, null, null, 0.2, 0.15, 0.1, ...Array(19).fill(null), "Tarifa RL1", "Gas combo"],
    ["Naturgy", "Telefonia", "Fibra", "Fibra 1GB"],
    ["Iberdrola", "Gas", "Tarifa RL2", "Gas", 0.08, null],
  ];
  const r = parseOffersTemplate(rows, { validaHasta: "2026-12-31", verificadaPor: "A" });
  it("imports electricity, gas and both halves of dual rows", () => {
    expect(r.offers.map((o) => `${o.tarifa}:${o.tipo}`)).toEqual(["2.0TD:luz", "2.0TD:luz", "RL1:gas"]);
    expect(r.offers[0].energia).toEqual([0.2, 0.15, 0.1]);
    expect(r.offers[0].potencia).toEqual([0.1, 0.05]);
    expect(r.offers[2].fijoDia).toBe(0.06);
  });
  it("skips non-energy rows and incomplete prices with a reason", () => {
    expect(r.skipped.map((s) => s.row)).toEqual([5, 6]);
  });
  it("stable ids so re-imports update", () => {
    const again = parseOffersTemplate(rows, { validaHasta: "2027-01-31", verificadaPor: "A" });
    expect(again.offers.map((o) => o.id)).toEqual(r.offers.map((o) => o.id));
    expect(r.offers.every((o) => o.verificada)).toBe(true);
  });
});

import { easter, themeFor } from "../src/core/seasons";
describe("seasonal themes", () => {
  it("easter dates", () => { expect(easter(2026)).toBe("2026-04-05"); expect(easter(2027)).toBe("2027-03-28"); });
  it("picks the right festivity", () => {
    const cases: [string, string][] = [
      ["2026-10-30", "halloween"], ["2026-11-01", "castanyada"], ["2026-11-15", "tardor"], ["2026-12-10", "tio"],
      ["2026-12-24", "nadal"], ["2026-12-26", "santesteve"], ["2026-12-31", "capdany"], ["2027-01-01", "capdany"],
      ["2027-01-05", "reis"], ["2027-01-20", "hivern"], ["2027-02-08", "carnaval"], ["2027-03-29", "pasqua"],
      ["2027-04-23", "santjordi"], ["2027-05-11", "festamajor"], ["2027-06-23", "santjoan"], ["2027-07-15", "estiu"],
      ["2027-09-11", "diada"], ["2027-04-10", "primavera"],
    ];
    for (const [d, id] of cases) expect([d, themeFor(d).id]).toEqual([d, id]);
  });
});

import { canSee, collabKey } from "../src/core/roles";
describe("roles", () => {
  const c = { comercial: "IBETH", captador: "COL. ANTONIO FINQUES", colaborador: "finquesronda@gmail.com" };
  it("full-access roles see everything", () => {
    for (const role of ["admin", "cap_administrativa", "administrativa"] as const) expect(canSee({ role, code: null, email: "x@y.z" }, c)).toBe(true);
  });
  it("comercial sees only own contracts", () => {
    expect(canSee({ role: "comercial", code: "IBETH", email: "i@x.z" }, c)).toBe(true);
    expect(canSee({ role: "comercial", code: "IRENE", email: "i@x.z" }, c)).toBe(false);
  });
  it("collaborator matches by code (COL. prefix optional) or CRM owner email", () => {
    expect(canSee({ role: "colaborador", code: "ANTONIO FINQUES", email: "a@b.c" }, c)).toBe(true);
    expect(canSee({ role: "colaborador", code: null, email: "FinquesRonda@gmail.com" }, c)).toBe(true);
    expect(canSee({ role: "colaborador", code: "COL. ENGIBAR", email: "hola@engibar.com" }, c)).toBe(false);
    expect(collabKey("col. Engibar")).toBe("ENGIBAR");
  });
});
