/**
 * Fase 8.1 · Lectura intel·ligent de contractes de comercialitzadores (nucli + extracció de text).
 * Documents de prova ficticis (tests/helpers/retailer-docs.ts), inclòs un amb condicions contradictòries.
 * La crida real al proveïdor d'IA NO es prova aquí: es prova la validació que s'aplica a QUALSEVOL resposta d'IA.
 */
import { describe, expect, it } from "vitest";
import { clawbackFor, findExcerpt, hardenAiTerms, localExtract, matchesRetailer, missedByAi, reviewStatusOf, riskExposure, underpayments, valueInExcerpt, type ClawRule } from "@/core/retailers";
import { docxText, pdfText } from "@/server/doc-text";
import { CONTRADICTORY_PAGES, NUFRI_PAGES, docxBytes, pdfBytes } from "./helpers/retailer-docs";

const pick = (ts: ReturnType<typeof localExtract>, field: string, product?: string) => ts.find((t) => t.field === field && (product === undefined || t.product === product));

describe("extracció de text", () => {
  it("PDF amb capa de text: pàgines separades, no escanejat", async () => {
    const d = await pdfText(pdfBytes(NUFRI_PAGES));
    expect(d.pages).toHaveLength(3);
    expect(d.scanned).toBe(false);
    expect(d.pages[1]).toMatch(/Nufri Gala: 10 €\/MWh/);
  });
  it("PDF sense text (escanejat) es detecta per demanar OCR", async () => {
    const d = await pdfText(pdfBytes(["", ""]));
    expect(d.scanned).toBe(true);
  });
  it("DOCX: paràgrafs, salts de pàgina i taules", async () => {
    const d = await docxText(await docxBytes(NUFRI_PAGES));
    expect(d.pages).toHaveLength(3);
    expect(d.tables).toBe(1);
    expect(d.pages[1]).toMatch(/Nufri Gala \| 10 €\/MWh/);
  });
});

describe("lector local determinista (sense IA)", () => {
  const ts = localExtract(NUFRI_PAGES);
  it("Nufri Gala: 10 €/MWh → comercialitzadora, tipus per MWh, producte, import, unitat, pàgina i fragment", () => {
    const g = pick(ts, "per_mwh", "Nufri Gala")!;
    expect(g).toMatchObject({ category: "remuneracio", value: 10, unit: "eur_mwh", page: 2, excerpt_found: true, source: "local" });
    expect(g.excerpt).toMatch(/Nufri Gala: 10 €\/MWh/);
  });
  it("detecta €/kWh, import fix per contracte i termini de pagament", () => {
    expect(pick(ts, "per_kwh", "Nufri Fuji")).toMatchObject({ value: 0.002, unit: "eur_kwh" });
    expect(pick(ts, "fix_contracte")).toMatchObject({ value: 45, unit: "eur" });
    expect(pick(ts, "termini_pagament")).toMatchObject({ value: 30, unit: "dies" });
  });
  it("retrocessió: baixa en 12 mesos = 100 %; impagament proporcional amb la fórmula exacta", () => {
    const b = pick(ts, "baixa_anticipada")!;
    expect(b).toMatchObject({ category: "retrocessio", value: 100, unit: "pct", conditions: { risk_months: 12, mode: "total" }, ambiguous: false });
    const i = pick(ts, "impagament")!;
    expect(i.conditions).toMatchObject({ risk_months: 6, mode: "prorrata" });
    expect(i.formula).toMatch(/comisión × \(6 − meses consumidos\) \/ 6/);
  });
  it("vigència amb dates", () => {
    expect(ts.find((t) => t.category === "vigencia")).toMatchObject({ valid_from: "2026-01-01", valid_to: "2026-12-31" });
  });
  it("condicions contradictòries: Gala 10 vs 12 €/MWh → totes dues ambigües i en revisió manual", () => {
    const c = localExtract(CONTRADICTORY_PAGES).filter((t) => t.field === "per_mwh" && /Gala$/.test(t.product ?? ""));
    expect(c.map((t) => t.value).sort()).toEqual([10, 12]);
    for (const t of c) { expect(t.ambiguous).toBe(true); expect(t.ambiguity_reason).toMatch(/contradictòries/); expect(reviewStatusOf(t)).toBe("revisio_manual"); }
  });
});

describe("validació de la resposta de la IA (anti-invenció)", () => {
  const ai = {
    summary: { retailer: "Nufri", valid_from: "2026-01-01", valid_to: "2026-12-31" },
    terms: [
      { category: "remuneracio", field: "per_mwh", product: "Gala", value: 10, unit: "eur_mwh", page: 1, excerpt: "Nufri Gala: 10 €/MWh", interpretation: "10 €/MWh", confidence: 0.95 },
      // inventada: aquest text no és al document
      { category: "remuneracio", field: "bonificacio", value: 500, unit: "eur", page: 2, excerpt: "Bonus de 500 € por superar 100 contratos", interpretation: "Bonus", confidence: 0.9 },
      // import que no apareix al fragment
      { category: "remuneracio", field: "per_mwh", product: "Galaxy", value: 51, unit: "eur_mwh", page: 2, excerpt: "Nufri Galaxy: 15 €/MWh", interpretation: "x", confidence: 0.9 },
      // tipus no admès
      { category: "remuneracio", field: "comissio_magica", value: 1, unit: "eur", page: 2, excerpt: "Nufri Gala: 10 €/MWh", confidence: 0.9 },
      { category: "retrocessio", field: "impagament", value: null, unit: null, formula: null, conditions: { mode: "prorrata", risk_months: 6 }, page: 3, excerpt: "En caso de impago del cliente dentro de los 6 primeros meses, se devolverá la parte proporcional", confidence: 0.9 },
    ],
  };
  const r = hardenAiTerms(ai, NUFRI_PAGES, true);
  it("fragment verificat: es corregeix la pàgina i queda llest per revisar", () => {
    const g = r.terms.find((t) => t.product === "Gala")!;
    expect(g).toMatchObject({ excerpt_found: true, page: 2, ambiguous: false });
    expect(reviewStatusOf(g)).toBe("pendent");
  });
  it("una condició inventada queda marcada com a REVISIÓ MANUAL NECESSÀRIA i confiança baixa", () => {
    const b = r.terms.find((t) => t.field === "bonificacio")!;
    expect(b.excerpt_found).toBe(false);
    expect(b.confidence).toBeLessThanOrEqual(0.3);
    expect(b.ambiguity_reason).toMatch(/REVISIÓ MANUAL NECESSÀRIA/);
  });
  it("un import que no és al fragment es marca; els tipus desconeguts es descarten", () => {
    expect(r.terms.find((t) => t.product === "Galaxy")!.ambiguity_reason).toMatch(/no apareix al fragment/);
    expect(r.rejected).toBe(1);
  });
  it("prorrateig sense fórmula → ambigu", () => {
    expect(r.terms.find((t) => t.field === "impagament")!.ambiguity_reason).toMatch(/Prorrateig sense fórmula/);
  });
  it("document escanejat: res es pot verificar localment → tot en revisió manual", () => {
    const s = hardenAiTerms({ terms: [ai.terms[0]] }, [], false);
    expect(s.terms[0].ambiguous).toBe(true);
    expect(reviewStatusOf(s.terms[0])).toBe("revisio_manual");
  });
  it("el lector local afegeix el que la IA ha omès (marcat per revisar)", () => {
    const extra = missedByAi(r.terms, localExtract(NUFRI_PAGES));
    expect(extra.some((t) => t.field === "per_kwh" && t.value === 0.002)).toBe(true);
    expect(extra.every((t) => t.ambiguous)).toBe(true);
  });
  it("una resposta sense l'estructura esperada es rebutja", () => {
    expect(() => hardenAiTerms({ foo: 1 }, NUFRI_PAGES, true)).toThrow();
  });
  it("helpers de verificació", () => {
    expect(findExcerpt(NUFRI_PAGES, "comisión  ×  (6 − meses consumidos) / 6").found).toBe(true);
    expect(valueInExcerpt(0.002, "Fuji: 0,002 €/kWh")).toBe(true);
    expect(valueInExcerpt(12.5, "el 12,5 % del margen")).toBe(true);
    expect(valueInExcerpt(13, "el 12,5 % del margen")).toBe(false);
  });
});

describe("motor de retrocessions", () => {
  const rule = (o: Partial<ClawRule>): ClawRule => ({ id: "r", name: "Nufri baixa", version: 1, trigger: "baixa_anticipada", risk_months: 12, start_event: "activacio", mode: "total", pct: 100, penalty_eur: null, formula: null, valid_from: "2026-01-01", valid_to: null, product: null, status: "aprovada", ...o });
  it("total dins del període; fora del període no retorna res", () => {
    expect(clawbackFor(rule({}), { commission: 2000, start: "2026-03-01", event: "baixa_anticipada", eventDate: "2026-09-15" })).toMatchObject({ status: "aplica", amount: 2000 });
    expect(clawbackFor(rule({}), { commission: 2000, start: "2026-03-01", event: "baixa_anticipada", eventDate: "2027-03-02" })).toMatchObject({ status: "fora_termini", amount: 0 });
  });
  it("parcial, prorrateig i fórmula equivalent; fórmula desconeguda → pendent (no s'inventa)", () => {
    expect(clawbackFor(rule({ mode: "parcial", pct: 50 }), { commission: 300, start: "2026-01-10", event: "baixa_anticipada", eventDate: "2026-02-01" }).amount).toBe(150);
    expect(clawbackFor(rule({ trigger: "impagament", mode: "prorrata", risk_months: 6 }), { commission: 600, start: "2026-01-10", event: "impagament", eventDate: "2026-03-15" })).toMatchObject({ amount: 400 });
    expect(clawbackFor(rule({ trigger: "impagament", mode: "formula", risk_months: 6, formula: "comisión × (6 − meses consumidos) / 6" }), { commission: 600, start: "2026-01-10", event: "impagament", eventDate: "2026-03-15" }).amount).toBe(400);
    expect(clawbackFor(rule({ mode: "formula", formula: "según tabla del anexo III" }), { commission: 600, start: "2026-01-10", event: "baixa_anticipada", eventDate: "2026-03-15" }).status).toBe("pendent_formula");
    expect(clawbackFor(rule({}), { commission: 600, start: null, event: "baixa_anticipada", eventDate: "2026-03-15" }).status).toBe("pendent_dades");
  });
  it("exposició al risc de retrocessió de la cartera activa", () => {
    const e = riskExposure([{ id: "k1", retailer_id: "n", start: "2026-06-01", commission: 1000 }, { id: "k2", retailer_id: "n", start: "2025-01-01", commission: 1000 }], [{ ...rule({}), retailer_id: "n" }], "2026-11-01");
    expect(e).toEqual({ total: 1000, items: [{ contract_id: "k1", rule_id: "r", until: "2027-06-01", amount: 1000 }] });
  });
  it("infrapagaments i correspondència de noms", () => {
    expect(underpayments([{ id: "a", amount: 1800, expected_amount: 2000, kind: "comissio" }, { id: "b", amount: 2000, expected_amount: 2002, kind: "comissio" }])).toEqual([{ id: "a", expected: 2000, paid: 1800, gap: 200 }]);
    expect(matchesRetailer("NUFRI", { trade_name: "Nufri" })).toBe(true);
    expect(matchesRetailer("Nufri Energía", { trade_name: "Nufri" })).toBe(true);
    expect(matchesRetailer("Nufrix", { trade_name: "Nufri" })).toBe(false);
  });
});

describe("de punta a punta: fitxer → text → condicions", () => {
  for (const [kind, make] of [["PDF", async () => (await pdfText(pdfBytes(NUFRI_PAGES))).pages], ["DOCX", async () => (await docxText(await docxBytes(NUFRI_PAGES))).pages]] as const) {
    it(`${kind}: Gala 10 €/MWh, Fuji 0,002 €/kWh i retrocessió 100 % / 12 mesos`, async () => {
      const pages = await make();
      const ts = localExtract(pages);
      expect(ts.find((t) => t.field === "per_mwh" && /Gala$/.test(t.product ?? ""))).toMatchObject({ value: 10, page: 2 });
      expect(ts.find((t) => t.field === "per_kwh")).toMatchObject({ value: 0.002 });
      expect(ts.find((t) => t.field === "baixa_anticipada")).toMatchObject({ value: 100, conditions: { risk_months: 12 } });
      // la IA citant literalment el text del fitxer es verifica correctament
      const h = hardenAiTerms({ terms: [{ category: "remuneracio", field: "per_mwh", product: "Gala", value: 10, unit: "eur_mwh", page: 2, excerpt: "Nufri Gala", confidence: 0.9 }] }, pages, true);
      expect(h.terms[0].excerpt_found).toBe(true);
    });
  }
});

describe("motor de comissions ampliat (Fase 8.1)", async () => {
  const { computeCommission, ruleApplies } = await import("@/core/commissions");
  const rule = { id: "r", rule_key: "k", version: 1, name: "Nufri · % energia", layer: "proveidor", retailer: "Nufri", product: null, service: null, segment: null, beneficiary_id: null, kind: "pct_energia", value: "5", unit: "pct", tiers: null, conditions: {}, base_formula: "5 % × import facturat d'energia", base_validated: true, valid_from: "2026-01-01", valid_to: null, status: "aprovada", notes: null } as const;
  const facts = { retailer: "Nufri", product: "Gala", service: null, segment: null, refDate: "2026-06-01", annualKwh: 12000, annualKwhSource: "x", eligibleMwh: null, energyIncrementEurKwh: null, powerIncrementEurKwDay: null, powerKw: null, months: 12, providerAmount: null, providerAmountSource: null } as const;
  it("% sobre energia: sense l'import facturat queda pendent de dades; amb l'import, calcula", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeCommission(rule as any, facts as any).status).toBe("pendent_dades");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeCommission(rule as any, { ...facts, energyAmountEur: 2000 } as any)).toMatchObject({ status: "calculat", amount: "100.00" });
  });
  it("condicions de renovació i de peatge només restringeixen quan el fet és conegut", () => {
    const r = { ...rule, kind: "per_mwh", unit: "eur_mwh", conditions: { applies_to: "renovacio", tariff: "3.0TD" } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ap = (f: Record<string, unknown>) => ruleApplies(r as any, { ...facts, ...f } as any, "proveidor", null);
    expect(ap({ isRenewal: false })).toBe(false);
    expect(ap({ isRenewal: true, tariff: "3.0 TD" })).toBe(true);
    expect(ap({ isRenewal: true, tariff: "2.0TD" })).toBe(false);
    expect(ap({ isRenewal: null, tariff: null })).toBe(true);
  });
});
