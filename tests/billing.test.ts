/** Facturació · lògica pura: totals exactes, numeració, NIF/CIF, proposta des de liquidació i CSV. Dades fictícies. */
import { describe, expect, it } from "vitest";
import { computeTotals, invoiceNumber, normName, proposalFromStatement, toCsv, validTaxId } from "@/core/billing";
import { buildInvoicePdf } from "@/core/invoice-pdf";

describe("totals", () => {
  it("sense errors de coma flotant i amb arrodoniment a cèntims", () => {
    const t = computeTotals([{ description: "a", quantity: 1, unitPrice: "622", vatRate: 21 }, { description: "b", quantity: 1, unitPrice: "359.03", vatRate: 21 }]);
    expect(t).toMatchObject({ base: "981.03", vat: "206.02", total: "1187.05" });
    expect(computeTotals([{ description: "x", quantity: 3, unitPrice: "0.1", vatRate: 21 }]).base).toBe("0.30");
  });
  it("diversos tipus d'IVA: es calcula per tipus", () => {
    const t = computeTotals([{ description: "a", quantity: 1, unitPrice: 100, vatRate: 21 }, { description: "b", quantity: 2, unitPrice: 50, vatRate: 0 }]);
    expect(t.breakdown).toEqual([{ rate: "21.00", base: "100.00", vat: "21.00" }, { rate: "0.00", base: "100.00", vat: "0.00" }]);
    expect(t.total).toBe("221.00");
  });
  it("línies negatives (rectificatives)", () => {
    expect(computeTotals([{ description: "a", quantity: -1, unitPrice: "5256", vatRate: 21 }]).total).toBe("-6359.76");
  });
});

describe("numeració i identificadors", () => {
  it("format AA-NNN i RAA-NNN", () => {
    expect(invoiceNumber("ORD", 2026, 49)).toBe("26-049");
    expect(invoiceNumber("REC", 2027, 1)).toBe("R27-001");
  });
  it("valida NIF, NIE i CIF amb el dígit de control", () => {
    expect(validTaxId("B12345674")).toBe(true);
    expect(validTaxId("B12345675")).toBe(false);
    expect(validTaxId("12345678Z")).toBe(true);
    expect(validTaxId("X1234567L")).toBe(true);
    expect(validTaxId("A1234567")).toBe(false);
  });
  it("normalitza noms per comparar", () => { expect(normName(" Energía  Nufri, S.L.U. ")).toBe("ENERGIANUFRISLU"); });
});

describe("proposta des d'una liquidació", () => {
  it("descompta retrocessions, avisa de dubtes i calcula l'IVA de manera determinista", () => {
    const p = proposalFromStatement({ retailer: "COMERCIALITZADORA PROVA", reference: "OCT-26", period_from: "2026-10-01", period_to: "2026-10-31" }, { pending: "5256", negatives: "-44", doubtful: 2 });
    expect(p).toMatchObject({ base: "5256.00", vat: "1103.76", total: "6359.76" });
    expect(p.warnings.join(" ")).toMatch(/retrocessions/);
    expect(p.warnings.join(" ")).toMatch(/2 línia/);
  });
  it("res pendent → avís", () => {
    expect(proposalFromStatement({ retailer: "X", reference: "R", period_from: null, period_to: null }, { pending: 0, negatives: 0, doubtful: 0 }).warnings[0]).toMatch(/No queda/);
  });
});

describe("exportació i PDF", () => {
  it("CSV per a Excel amb separador ; i decimals amb coma", () => {
    expect(toCsv(["A", "B"], [["x;y", 1.5]])).toBe('﻿A;B\r\n"x;y";1,5');
  });
  it("genera un PDF de factura", () => {
    const pdf = buildInvoicePdf({
      number: "26-049", kind: "ordinaria", draft: false, issueDate: "2026-11-04", dueDate: "2026-12-04",
      issuer: { name: "EMPRESA DE PROVA SL", nif: "B12345674", address: "C/ Prova 1", postal_code: "25001", city: "Lleida", iban: "ES00 0000 0000 0000 0000 0000" },
      client: { legal_name: "CLIENT FICTICI SA", nif: "A00000000", address: "C/ Inventada 2", postal_code: "08001", city: "Barcelona", province: "Barcelona" },
      concept: "Comissions octubre", periodLabel: "Octubre 2026", orderRefLabel: null, orderRef: null, notes: null, rectifies: null,
      lines: [{ description: "Comissions", quantity: "1", unit_price: "100", vat_rate: "21", vat_exemption: null, amount: "100.00" }],
      breakdown: [{ rate: "21", base: "100.00", vat: "21.00" }], base: "100.00", vat: "21.00", total: "121.00",
    });
    expect(pdf.byteLength).toBeGreaterThan(5000);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  });
});
