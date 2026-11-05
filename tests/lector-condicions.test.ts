/**
 * LECTOR IA UNIFICAT DE CONDICIONS COMERCIALS: interpretació creuada de comissions i retrocessions.
 * Document de prova REAL (tests/fixtures/contracte-prova-condicions.pdf, 24 pàgines, dades fictícies):
 *   pàg. 3 comissions per producte · pàg. 7 liquidació · pàg. 12 objectius · pàg. 18 retrocessions · pàg. 21 excepcions.
 * Es llegeix el PDF de debò (text per pàgines) i es prova tot el circuit del servidor. L'ÚNIC que se simula és la
 * resposta del proveïdor d'IA (no hi ha clau en aquest entorn): la prova real amb la IA es fa a la Preview.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";
import { expandTerms, isRiskyClawback, parseReaderOutput, parseVerifyOutput, productRisk, productSheets, READER_TOOL, type SheetTerm } from "@/core/condition-reader";

vi.mock("server-only", () => ({}));
process.env.ANTHROPIC_API_KEY = "sk-test-no-real";
process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
const PDF = fs.readFileSync(path.resolve(__dirname, "fixtures/contracte-prova-condicions.pdf"));

/** Resposta d'una lectura correcta del document de prova (el que hauria de retornar la IA). */
const AI_READING = {
  summary: { retailer: "Energía Demo Comercializadora, S.L.", valid_from: "2027-01-01", valid_to: "2027-12-31" },
  products: [
    { key: "p1", name: "Luz Hogar", tariff: "2.0TD", service: "llum", segment: "residencial", pages: [3] },
    { key: "p2", name: "Luz Empresa", tariff: "3.0TD", service: "llum", segment: "pime", pages: [3] },
    { key: "p3", name: "Gas Confort", tariff: "RL.3", service: "gas", pages: [3] },
  ],
  terms: [
    { id: "t1", category: "remuneracio", field: "fix_contracte", scope: "productes", products: ["p1"], value: 40, unit: "eur", applies_to: "alta_nova", pages: [3], clause: "Cl. 5.1", excerpt: "Producto Luz Hogar (peaje 2.0TD): 40 € por contrato activado.", interpretation: "40 € per contracte activat de Luz Hogar", related: ["t5", "t7"], confidence: 0.95 },
    { id: "t2", category: "remuneracio", field: "per_mwh", scope: "productes", products: ["p2"], value: "8", unit: "€/MWh", pages: [3], clause: "Cl. 5.2", excerpt: "Producto Luz Empresa (peaje 3.0TD): 8 €/MWh sobre el consumo anual contratado.", related: ["t5"], confidence: 0.93 },
    { id: "t3", category: "remuneracio", field: "fix_contracte", scope: "productes", products: ["p3"], value: "25,00", unit: "eur", pages: [3], clause: "Cl. 5.3", excerpt: "Producto Gas Confort (peaje RL.3): 25 € por contrato activado.", related: ["t6"], confidence: 0.94 },
    { id: "t4", category: "remuneracio", field: "bonificacio", scope: "productes", products: ["p1"], value: 500, unit: "eur", pages: [12], clause: "Cl. 9.1", excerpt: "percibirá una bonificación adicional de 500 € ese mes", interpretation: "Bonus de 500 € si supera 50 altes de Luz Hogar en un mes", related: ["t1"], confidence: 0.9 },
    { id: "t5", category: "retrocessio", field: "baixa_anticipada", scope: "productes", products: ["p1", "p2"], value: 100, unit: "pct", risk_months: 3, start_event: "activacio", mode: "total", pages: [18, 21], clause: "Cl. 14.1 i 16.1",
      excerpt: "En caso de baja del cliente durante los 3 primeros meses desde la activación, la Comercializadora descontará el 100% de la comisión", related: ["t1", "t2"], confidence: 0.92,
      exceptions: [{ text: "cuando la baja se deba al fallecimiento del titular o al traslado del suministro a otro punto con la misma Comercializadora", page: 21, effect: "no s'aplica la retrocessió" }] },
    { id: "t6", category: "retrocessio", field: "baixa_anticipada", scope: "productes", products: ["p3"], value: null, unit: null, risk_months: 12, mode: "prorrata", formula: "comisión x (12 - meses transcurridos) / 12", pages: [18], clause: "Cl. 14.2", excerpt: "Para el producto Gas Confort la retrocesión será proporcional durante 12 meses", related: ["t3"], confidence: 0.9 },
    { id: "t7", category: "retrocessio", field: "impagament", scope: "general", products: [], value: 50, unit: "pct", risk_months: 6, mode: "parcial", pages: [18], clause: "Cl. 14.3", excerpt: "supondrá la retrocesión del 50% de la comisión de cualquier producto", confidence: 0.88 },
    { id: "t8", category: "pagament", field: "termini_pagament", scope: "general", products: [], value: 60, unit: "dies", pages: [7], clause: "Cl. 8", excerpt: "se abonarán en un plazo de 60 días desde la activación del suministro", confidence: 0.95 },
    { id: "t9", category: "pagament", field: "termini_reclamacio", scope: "general", products: [], value: 90, unit: "dies", pages: [7], clause: "Cl. 8", excerpt: "El Agente dispondrá de 90 días desde cada liquidación para presentar reclamaciones.", confidence: 0.95 },
    { id: "t10", category: "comissio_rara", field: "x", scope: "productes", products: ["p1"], excerpt: "res", pages: [1], confidence: 0.5 },
  ],
  contradictions: [],
};

let pages: string[] = [];
beforeAll(async () => {
  const { pdfText } = await import("@/server/doc-text");
  pages = (await pdfText(new Uint8Array(PDF))).pages;
});

describe("document de prova real (24 pàgines)", () => {
  it("es llegeix sencer i cada condició és a la seva pàgina", () => {
    expect(pages).toHaveLength(24);
    expect(pages[2]).toMatch(/40 €\s+por\s+contrato/);
    expect(pages[11]).toMatch(/bonificación\s+adicional de 500 €/);
    expect(pages[17]).toMatch(/3\s+primeros\s+meses/);
    expect(pages[20]).toMatch(/fallecimiento\s+del\s+titular/);
  });
});

describe("interpretació creuada", () => {
  const out = () => parseReaderOutput(AI_READING);
  it("una condició mal formada no fa fallar la lectura (abans: «La IA no ha retornat l'estructura esperada»)", () => {
    const o = out();
    expect(o.terms).toHaveLength(9);
    expect(o.rejected).toEqual(["categoria desconeguda (comissio_rara)"]);
    expect(o.terms.find((t) => t.id === "t2")).toMatchObject({ value: 8, unit: "eur_mwh" });       // «8» i «€/MWh» normalitzats
    expect(o.terms.find((t) => t.id === "t3")?.value).toBe(25);                                   // «25,00»
    const x = expandTerms(o, { pages, textAvailable: true });
    expect(x.warnings.join(" ")).toMatch(/1 condicions descartades/);
  });

  it("relaciona comissions (pàg. 3 i 12) amb retrocessions (pàg. 18) i excepcions (pàg. 21) per producte", () => {
    const { terms } = expandTerms(out(), { pages, textAvailable: true });
    const hogarClaw = terms.find((t) => t.category === "retrocessio" && t.field === "baixa_anticipada" && t.product === "Luz Hogar")!;
    expect(hogarClaw).toMatchObject({ value: 100, unit: "pct", tariff: "2.0TD", page: 18, excerpt_found: true });
    expect(hogarClaw.conditions).toMatchObject({ risk_months: 3, mode: "total", scope: "productes", pages: [18, 21], clause: "Cl. 14.1 i 16.1", products_all: ["Luz Hogar", "Luz Empresa"] });
    expect(String(hogarClaw.conditions.exceptions)).toMatch(/fallecimiento.*\(pàg\. 21\).*no s'aplica la retrocessió/);
    expect((hogarClaw.conditions.related as string[]).join(" ")).toMatch(/t1 · Remuneració: Import fix per contracte 40 € \(Luz Hogar\) · Cl\. 5\.1/);
    // la mateixa retrocessió s'aplica als dos productes de llum, i NO al gas (que té la seva pròpia, proporcional)
    expect(terms.filter((t) => t.field === "baixa_anticipada" && t.conditions.group === "t5").map((t) => t.product)).toEqual(["Luz Hogar", "Luz Empresa"]);
    const gas = terms.find((t) => t.field === "baixa_anticipada" && t.product === "Gas Confort")!;
    expect(gas.conditions).toMatchObject({ mode: "prorrata", risk_months: 12 });
    expect(gas.formula).toMatch(/12 - meses transcurridos/);
    // la bonificació per objectius (pàg. 12) queda vinculada a la comissió base de Luz Hogar
    const bonus = terms.find((t) => t.field === "bonificacio")!;
    expect(bonus).toMatchObject({ product: "Luz Hogar", page: 12, excerpt_found: true });
    expect((bonus.conditions.related as string[])[0]).toMatch(/^t1 /);
    // els terminis de liquidació, reclamació i retrocessió no es confonen
    expect(terms.filter((t) => t.category === "pagament").map((t) => [t.field, t.value, t.page])).toEqual([["termini_pagament", 60, 7], ["termini_reclamacio", 90, 7]]);
    // fragments literals verificats al document i condicions clares → no cal revisió manual
    expect(terms.filter((t) => t.ambiguous).map((t) => t.field)).toEqual([]);
  });

  it("fitxa per producte: comissions i retrocessions juntes, amb les generals aplicables i el risc en vermell", () => {
    const { terms } = expandTerms(out(), { pages, textAvailable: true });
    const rows: SheetTerm[] = terms.map((t, i) => ({ ...t, id: `r${i}`, review_status: "pendent" }));
    const sheets = productSheets(rows);
    const hogar = sheets.find((s) => s.product === "Luz Hogar")!;
    expect(hogar.commissions.map((t) => [t.field, t.value])).toEqual([["fix_contracte", 40], ["bonificacio", 500]]);
    expect(hogar.clawbacks.map((t) => [t.field, t.value])).toEqual([["baixa_anticipada", 100]]);
    expect(hogar.general.map((t) => t.field)).toEqual(["impagament", "termini_pagament", "termini_reclamacio"]);   // la general d'impagament s'aplica a tots
    expect(hogar.pages).toEqual([3, 7, 12, 18, 21]);
    expect(hogar.risky).toBe(true);
    const gas = sheets.find((s) => s.product === "Gas Confort")!;
    expect(gas.commissions.map((t) => t.value)).toEqual([25]);
    expect(gas.clawbacks.map((t) => t.conditions.mode)).toEqual(["prorrata"]);
    expect(isRiskyClawback(gas.clawbacks[0])).toBe(true);              // 12 mesos de risc
    expect(sheets.at(-1)!.key).toBe("__general");
  });

  it("una retrocessió sense abast clar NO s'aplica a tots els productes: queda per revisar", () => {
    const o = parseReaderOutput({ ...AI_READING, terms: [{ ...AI_READING.terms[6], id: "t7", scope: "no_clar" }] });
    const [t] = expandTerms(o, { pages, textAvailable: true }).terms;
    expect(t.product).toBeNull();
    expect(t.ambiguous).toBe(true);
    expect(t.ambiguity_reason).toMatch(/Abast no clar.*no es dona per fet que una retrocessió s'aplica a tots els productes/);
  });

  it("condicions particulars que prevalen, contradiccions i fragments inventats", () => {
    const o = parseReaderOutput({
      ...AI_READING,
      terms: [
        { ...AI_READING.terms[6], id: "g1" },
        { ...AI_READING.terms[6], id: "s1", scope: "productes", products: ["p3"], value: 25, overrides: ["g1"], excerpt: "Texto que no existe en el documento", confidence: 0.9 },
        { ...AI_READING.terms[0], id: "c1", related: [] }, { ...AI_READING.terms[0], id: "c2", value: 45, excerpt: "40 € por contrato activado", related: [] },
      ],
      contradictions: [{ terms: ["c1", "c2"], pages: [3], description: "Dos imports diferents per a Luz Hogar" }],
    });
    const ts = expandTerms(o, { pages, textAvailable: true }).terms;
    expect(ts.find((t) => t.conditions.group === "g1")!.ambiguity_reason).toMatch(/condicions particulars que prevalen/);
    const s1 = ts.find((t) => t.conditions.group === "s1")!;
    expect(s1.excerpt_found).toBe(false);
    expect(s1.ambiguity_reason).toMatch(/no s'ha trobat literalment/);
    expect((s1.conditions.overrides as string[])[0]).toMatch(/^g1 /);
    expect(ts.filter((t) => ["c1", "c2"].includes(String(t.conditions.group))).every((t) => t.ambiguous && /Contradicció/.test(t.ambiguity_reason ?? ""))).toBe(true);
    // la general substituïda no es mostra al producte que té la particular
    const sheets = productSheets(ts.map((t, i) => ({ ...t, id: `x${i}`, review_status: "pendent" })));
    expect(sheets.find((s) => s.product === "Gas Confort")!.general.map((g) => g.conditions.group)).not.toContain("g1");
  });

  it("risc econòmic per producte", () => {
    const r = productRisk([{ start: "2026-10-01", expected: 40 }, { start: "2026-06-01", expected: 40 }, { start: null, expected: 40 }], { pct: 100, penalty: null, riskMonths: 3, mode: "total" }, "2026-11-02");
    expect(r).toMatchObject({ contracts: 3, expected: 120, inRisk: 1, potential: 40, net: 80, enough: true });
  });

  it("l'esquema de l'eina obliga a l'estructura (productes, abast, pàgines i relacions)", () => {
    const s = READER_TOOL.input_schema;
    expect(s.required).toEqual(["products", "terms"]);
    expect(s.properties.terms.items.required).toEqual(expect.arrayContaining(["scope", "products", "pages", "excerpt"]));
    expect(Object.keys(s.properties.terms.items.properties)).toEqual(expect.arrayContaining(["exceptions", "overrides", "related", "clause", "risk_months"]));
  });
});

/* ================================================================== servidor (només la IA simulada) */
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return {
    adminClient: () => ({ ...state.sb, storage: { from: () => ({ download: async () => ({ data: new Blob([PDF]), error: null }) }) } }),
    HttpError, handler: () => () => null, requireUser: async () => null,
  };
});
const sse = (input: unknown, stop = "tool_use", cut?: number) => {
  let json = JSON.stringify(input);
  if (cut) json = json.slice(0, cut);
  const ev = (o: unknown) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
  const parts = [ev({ type: "message_start", message: { usage: { input_tokens: 51000 } } }), ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "registrar_condicions", input: {} } })];
  for (let i = 0; i < json.length; i += 97) parts.push(ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 97) } }));
  parts.push(ev({ type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 4200 } }), ev({ type: "message_stop" }));
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
};
const RID = "00000000-0000-4000-8000-0000000000e1", DOC = "00000000-0000-4000-8000-0000000000d1", ADMIN = "00000000-0000-4000-8000-0000000000ad";
const admin = () => ({ sb: { ...state.sb, rpc: async () => ({ data: null, error: { message: "no" } }) }, user: { id: ADMIN }, profile: { id: ADMIN, name: "Direcció", email: "d@exemple.test", role: "admin", code: null } }) as never;

describe("servidor · lectura i comprovació de coherència", () => {
  const calls: { body: Record<string, unknown> }[] = [];
  beforeEach(() => {
    calls.length = 0;
    state.sb = fakeSupabase({
      retailer_documents: [{ id: DOC, retailer_id: RID, storage_path: `${RID}/doc.pdf`, original_name: "contracte-prova-condicions.pdf", title: "Contracte de prova", version: 1 }],
      sec_settings: [{ key: "ia_contractes", value: { enabled: true, dpa_reference: "DPA-PROVA", no_training: true } }],
      retailer_extractions: [], retailer_terms: [],
    } as never);
  });

  it("1a passada: una sola lectura del document sencer, resposta estructurada i streaming (sense «temperature»)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => { calls.push({ body: JSON.parse(init.body) }); return sse(AI_READING); }));
    const { analyzeDocument } = await import("@/server/retailers");
    const r = await analyzeDocument(admin(), DOC, { mode: "auto" });
    expect(r).toMatchObject({ status: "completada", method: "ia", verify: true });
    expect(calls).toHaveLength(1);
    const b = calls[0].body;
    expect(b).toMatchObject({ stream: true, max_tokens: 32000 });
    expect((b.tools as { name: string }[])[0].name).toBe("registrar_condicions");
    expect(b).not.toHaveProperty("temperature");
    expect(b).not.toHaveProperty("tool_choice");                    // claude-sonnet-5-5 rebutja tool_choice «tool»/«any»
    expect(String(b.system)).toMatch(/respon ÚNICAMENT cridant l'eina "registrar_condicions"/);
    expect(((b.messages as { content: { type: string }[] }[])[0].content)[0].type).toBe("document");     // el PDF sencer, una sola vegada
    const terms = state.sb.db.retailer_terms as { product: string | null; field: string; conditions: Record<string, unknown>; review_status: string }[];
    expect(terms.filter((t) => t.field === "baixa_anticipada").map((t) => t.product)).toEqual(["Luz Hogar", "Luz Empresa", "Gas Confort"]);
    expect(terms.find((t) => t.product === "Luz Hogar" && t.field === "baixa_anticipada")!.conditions.exceptions).toMatch(/fallecimiento/);
    const ex = (state.sb.db.retailer_extractions as { summary: { products: unknown[]; verification: { status: string } } }[])[0];
    expect(ex.summary.products).toHaveLength(3);
    expect(ex.summary.verification.status).toBe("pendent");
    vi.unstubAllGlobals();
  });

  it("2a passada: afegeix el que faltava i marca per revisar l'abast dubtós", async () => {
    let n = 0;
    const VERIFY = { missing_terms: [{ id: "v1", category: "retrocessio", field: "altres", scope: "general", products: [], value: null, unit: null, pages: [21], excerpt: "Las bajas por causas imputables a la Comercializadora no darán lugar a retrocesión.", interpretation: "Excepció general: sense retrocessió si la baixa és culpa de la comercialitzadora", confidence: 0.85 }], issues: [{ term: "t7", kind: "abast", description: "Revisa si l'impagament s'aplica també a gas", pages: [18] }], contradictions: [], warnings: [] };
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => { calls.push({ body: JSON.parse(init.body) }); return sse(n++ === 0 ? AI_READING : VERIFY); }));
    const { analyzeDocument, verifyExtraction } = await import("@/server/retailers");
    const a = await analyzeDocument(admin(), DOC, { mode: "auto" });
    const v = await verifyExtraction(admin(), a.id as string);
    expect(v).toMatchObject({ added: 1, flagged: 1 });
    expect((calls[1].body.tools as { name: string }[])[0].name).toBe("registrar_comprovacio");
    expect(calls[1].body).not.toHaveProperty("tool_choice");
    expect(JSON.stringify(calls[1].body.messages)).toMatch(/Condicions ja extretes/);
    const terms = state.sb.db.retailer_terms as { field: string; review_status: string; ambiguity_reason: string | null; conditions: Record<string, unknown> }[];
    expect(terms.find((t) => t.conditions.group === "t7")).toMatchObject({ review_status: "revisio_manual" });
    expect(terms.find((t) => t.conditions.group === "t7")!.ambiguity_reason).toMatch(/Comprovació de coherència \(abast\)/);
    expect(terms.find((t) => t.conditions.added_by_verification)).toMatchObject({ field: "altres", review_status: "revisio_manual" });
    // no es repeteix
    expect(await verifyExtraction(admin(), a.id as string)).toMatchObject({ already: true });
    vi.unstubAllGlobals();
  });

  it("resposta tallada (límit de mida o de temps): es desa el que és complet i s'avisa (abans: «massa llarg»)", async () => {
    const full = JSON.stringify(AI_READING);
    vi.stubGlobal("fetch", vi.fn(async () => sse(AI_READING, "max_tokens", Math.floor(full.length * 0.8))));
    const { analyzeDocument } = await import("@/server/retailers");
    const r = await analyzeDocument(admin(), DOC, { mode: "auto" });
    expect(r.status).toBe("completada");
    expect(r.terms).toBeGreaterThanOrEqual(5);
    const ex = (state.sb.db.retailer_extractions as { warnings: string[] }[])[0];
    expect(ex.warnings.join(" ")).toMatch(/s'ha tallat abans d'acabar/);
    vi.unstubAllGlobals();
  });

  it("error del proveïdor: es mostra el motiu real", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "`temperature` is deprecated for this model." } }), { status: 400 })));
    const { analyzeDocument } = await import("@/server/retailers");
    await expect(analyzeDocument(admin(), DOC, { mode: "auto" })).rejects.toThrow(/temperature/);
    vi.unstubAllGlobals();
  });
});

describe("servidor · compatibilitat amb el model i respostes buides", () => {
  beforeEach(() => {
    state.sb = fakeSupabase({
      retailer_documents: [{ id: DOC, retailer_id: RID, storage_path: `${RID}/doc.pdf`, original_name: "contracte-prova-condicions.pdf", title: "Contracte de prova", version: 1 }],
      sec_settings: [{ key: "ia_contractes", value: { enabled: true, dpa_reference: "DPA-PROVA", no_training: true } }],
      retailer_extractions: [], retailer_terms: [],
    } as never);
  });
  const textStream = (text: string) => {
    const ev = (o: unknown) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
    const enc = new TextEncoder();
    const parts = [ev({ type: "message_start", message: { usage: { input_tokens: 10 } } }), ...text.match(/[\s\S]{1,80}/g)!.map((t) => ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } })), ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } })];
    return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), { status: 200 });
  };
  it("si el model respon amb JSON en text (sense cridar l'eina), es llegeix igualment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textStream("Aquí tens el resultat:\n```json\n" + JSON.stringify(AI_READING) + "\n```")));
    const { analyzeDocument } = await import("@/server/retailers");
    const r = await analyzeDocument(admin(), DOC, { mode: "auto" });
    expect(r).toMatchObject({ status: "completada", terms: expect.any(Number) });
    expect(r.terms).toBeGreaterThan(8);
    vi.unstubAllGlobals();
  });
  it("si el model no admet eines (400), es reintenta automàticament amb l'esquema com a JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      const b = JSON.parse(init.body); bodies.push(b);
      return b.tools ? new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "tools: tool use is not supported for this model." } }), { status: 400 }) : textStream(JSON.stringify(AI_READING));
    }));
    const { analyzeDocument } = await import("@/server/retailers");
    const r = await analyzeDocument(admin(), DOC, { mode: "auto" });
    expect(r.status).toBe("completada");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty("tools");
    expect(String(bodies[1].system)).toMatch(/objecte JSON vàlid.*esquema/s);
    vi.unstubAllGlobals();
  });
  it("una resposta sense cap condició NO es dona per bona", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => sse({ products: [], terms: [] })));
    const { analyzeDocument } = await import("@/server/retailers");
    await expect(analyzeDocument(admin(), DOC, { mode: "auto" })).rejects.toThrow(/no ha extret cap condició.*diagnòstic [0-9a-f]{8}/);
    expect((state.sb.db.retailer_extractions as { status: string }[])[0].status).toBe("error");
    vi.stubGlobal("fetch", vi.fn(async () => textStream("No puc llegir el document.")));
    await expect(analyzeDocument(admin(), DOC, { mode: "auto" })).rejects.toThrow(/sense cap dada estructurada llegible \(diagnòstic/);
    vi.unstubAllGlobals();
  });
  it("sense clau: missatge exacte de quina variable configurar", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = "";
    const { callTool } = await import("@/server/ai-reader");
    await expect(callTool({ system: "s", content: [], tool: READER_TOOL, maxTokens: 10, budgetMs: 1000, instruction: "x" })).rejects.toThrow(/ANTHROPIC_API_KEY a Vercel/);
    process.env.ANTHROPIC_API_KEY = prev;
    vi.resetModules();
  });
  it("diagnòstic: el contracte de prova integrat és el mateix document i la comprovació detecta lectures incorrectes", async () => {
    const { buildTestContractPdf, checkTestReading } = await import("@/core/test-contract");
    const { pdfText } = await import("@/server/doc-text");
    const gen = (await pdfText(buildTestContractPdf())).pages;
    expect(gen.map((p) => p.replace(/\s+/g, " "))).toEqual(pages.map((p) => p.replace(/\s+/g, " ")));
    const good = expandTerms(parseReaderOutput(AI_READING), { pages, textAvailable: true }).terms;
    expect(checkTestReading(good).filter((c) => !c.ok).map((c) => c.id)).toEqual([]);
    // lectura dolenta: retrocessió de 3 mesos aplicada també al gas i sense excepció
    const bad = parseReaderOutput({ ...AI_READING, terms: AI_READING.terms.map((t) => (t.id === "t5" ? { ...t, products: ["p1", "p2", "p3"], exceptions: [], pages: [18] } : t)).filter((t) => t.id !== "t6") });
    const fails = checkTestReading(expandTerms(bad, { pages, textAvailable: true }).terms).filter((c) => !c.ok).map((c) => c.id);
    expect(fails).toEqual(expect.arrayContaining(["claw_not_gas", "claw_gas"]));
  });
  it("diagnòstic real: només Direcció; configuració sense clau → indica la variable", async () => {
    const { aiReaderCheck } = await import("@/server/retailers");
    const notAdmin = { ...(admin() as object), profile: { id: "x", name: "A", email: "a@x", role: "administrativa", code: null } } as never;
    await expect(aiReaderCheck(notAdmin, { step: "config" })).rejects.toMatchObject({ status: 403 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const r = await aiReaderCheck(admin(), { step: "config" });
    expect(r.steps!.find((s) => s.id === "model")!.detail).toMatch(/no existeix o no està disponible/);
    expect(r.steps!.find((s) => s.id === "key")!.detail).toMatch(/no té el format d'una clau d'Anthropic/);   // la clau de prova no és «sk-ant-»
    vi.unstubAllGlobals();
  });
});

describe("comprovació de coherència: lectura tolerant", () => {
  it("parseVerifyOutput", () => {
    const v = parseVerifyOutput({ missing_terms: [{ category: "retrocessio", field: "altres", scope: "general", products: [], excerpt: "Las bajas por causas imputables", pages: [21], confidence: 0.8 }, { category: "?" }], issues: [{ term: "t5", kind: "excepcio", description: "x" }, { kind: "x" }] });
    expect(v.missing).toHaveLength(1);
    expect(v.missing[0].id).toBe("v1");
    expect(v.issues).toHaveLength(1);
  });
});
