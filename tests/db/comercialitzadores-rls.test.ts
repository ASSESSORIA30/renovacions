/**
 * Fase 8.1 · 017 · Comercialitzadores sobre PostgreSQL real (PGlite, migracions 001-017).
 * Accés restringit, aprovació de condicions → motor de comissions (capa proveïdor), versions i vigències,
 * clàusules ambigües, retrocessions amb evidència i immutabilitat.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const lit = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v));
const term = async (o: Record<string, string | number | boolean | null>) =>
  (await h.as<{ id: string }>("A", `insert into retailer_terms (extraction_id, document_id, retailer_id, ${Object.keys(o).join(",")}) values ('${ids.ex}','${ids.doc}','${ids.r}', ${Object.values(o).map(lit).join(",")}) returning id`)).rows[0].id;

beforeAll(async () => {
  h = await setup(upTo("017"));
  ids.r = (await h.as<{ id: string }>("A", `insert into retailers (trade_name, legal_name, tax_id, services, status) values ('Nufri','Nufri Energía SL','B25000000','{llum,gas}','activa') returning id`)).rows[0].id;
  ids.doc = (await h.as<{ id: string }>("A", `insert into retailer_documents (retailer_id, title, valid_from, valid_to, sha256) values ('${ids.r}','Contracte d''agència 2026','2026-01-01','2026-12-31','aaa') returning id`)).rows[0].id;
  ids.ex = (await h.as<{ id: string }>("A", `insert into retailer_extractions (document_id, retailer_id, method, status) values ('${ids.doc}','${ids.r}','local','completada') returning id`)).rows[0].id;
  ids.client = (await sys<{ id: string }>(`insert into crm_clients (name, owner_id) values ('Forn','${U.C1}') returning id`))[0].id;
  ids.k = (await sys<{ id: string }>(`insert into crm_contracts (client_id, retailer, product, status, owner_id) values ('${ids.client}','Nufri','Gala','actiu','${U.C1}') returning id`))[0].id;
}, 180_000);

describe("017 · accés a les comercialitzadores", () => {
  it("només Direcció per defecte; comercials, caps d'equip i col·laboradors mai", async () => {
    expect(await h.count("A", `select * from retailers`)).toBe(1);
    for (const w of ["B", "C1", "L", "K"] as const) expect(await h.count(w, `select * from retailers`)).toBe(0);
    expect(await h.fails("B", `insert into retailers (trade_name) values ('X')`)).toMatch(/row-level security/);
  });
  it("Direcció pot autoritzar Administració, però mai un comercial encara que tingui el permís", async () => {
    await h.as("A", `insert into user_permissions (user_id, module, can_read, can_edit) values ('${U.B}','comercialitzadores', true, true), ('${U.C1}','comercialitzadores', true, true)`);
    expect(await h.count("B", `select * from retailers`)).toBe(1);
    expect(await h.count("B", `select * from retailer_documents`)).toBe(1);
    expect(await h.count("C1", `select * from retailers`)).toBe(0);
    expect(await h.count("C1", `select * from retailer_documents`)).toBe(0);
  });
  it("Administració autoritzada no pot aprovar condicions (només Direcció)", async () => {
    const t = await term({ category: "remuneracio", field: "per_mwh", product: "Gala", value: 10, unit: "eur_mwh", excerpt: "Nufri Gala: 10 €/MWh", excerpt_found: true, confidence: 0.95 });
    expect(await h.fails("B", `select retailer_approve_term('${t}')`)).toMatch(/Direcció/);
    expect(await h.fails("B", `update retailer_terms set review_status='aprovada' where id='${t}'`)).toMatch(/Direcció/);
    ids.gala = t;
  });
});

describe("017 · aprovació → motor de comissions (capa proveïdor)", () => {
  it("Nufri Gala 10 €/MWh es converteix en una regla aprovada de la capa proveïdor amb traçabilitat", async () => {
    const r = (await h.as<{ j: { rule_id: string; version: number } }>("A", `select retailer_approve_term('${ids.gala}') j`)).rows[0].j;
    expect(r.version).toBe(1);
    const rule = (await sys<Record<string, unknown>>(`select layer, retailer, product, kind, value::float v, unit, status, valid_from::text vf, valid_to::text vt, retailer_id, source_document_id, source_term_id, conditions from fin_rules where id='${r.rule_id}'`))[0];
    expect(rule).toMatchObject({ layer: "proveidor", retailer: "Nufri", product: "Gala", kind: "per_mwh", v: 10, unit: "eur_mwh", status: "aprovada", vf: "2026-01-01", vt: "2026-12-31", retailer_id: ids.r, source_document_id: ids.doc, source_term_id: ids.gala });
    expect((rule.conditions as { source: { excerpt: string } }).source.excerpt).toBe("Nufri Gala: 10 €/MWh");
    const t = (await sys<{ review_status: string; reviewed_by: string; applied_rule_id: string }>(`select review_status, reviewed_by, applied_rule_id from retailer_terms where id='${ids.gala}'`))[0];
    expect(t).toEqual({ review_status: "aprovada", reviewed_by: U.A, applied_rule_id: r.rule_id });
  });
  it("una condició aprovada no es pot modificar ni tornar a aprovar", async () => {
    expect(await h.fails("A", `update retailer_terms set value=99 where id='${ids.gala}'`)).toMatch(/ja està aprovada/);
    expect(await h.fails("A", `select retailer_approve_term('${ids.gala}')`)).toMatch(/ja està aprovada/);
  });
  it("€/kWh es normalitza exactament a €/MWh i es guarda la unitat original", async () => {
    const t = await term({ category: "remuneracio", field: "per_kwh", product: "Fuji", value: 0.002, unit: "eur_kwh", excerpt: "Fuji: 0,002 €/kWh", excerpt_found: true, confidence: 0.9 });
    const r = (await h.as<{ j: { rule_id: string } }>("A", `select retailer_approve_term('${t}') j`)).rows[0].j;
    const x = (await sys<{ v: number; unit: string; c: { source_unit: string } }>(`select value::float v, unit, conditions c from fin_rules where id='${r.rule_id}'`))[0];
    expect(x).toMatchObject({ v: 2, unit: "eur_mwh", c: { source_unit: "eur_kwh" } });
  });
  it("Direcció pot corregir la proposta abans d'aprovar i es conserva l'original de la IA", async () => {
    const t = await term({ category: "remuneracio", field: "per_mwh", product: "Golden", value: 60, unit: "eur_mwh", excerpt: "Golden: 6 €/MWh", excerpt_found: true, confidence: 0.6 });
    await h.as("A", `select retailer_approve_term('${t}', '{"value": 6, "note": "La IA havia llegit 60"}')`);
    const x = (await sys<{ value: string; original: { value: number }; review_note: string }>(`select value, original, review_note from retailer_terms where id='${t}'`))[0];
    expect(Number(x.value)).toBe(6);
    expect(Number(x.original.value)).toBe(60);
    expect(x.review_note).toMatch(/60/);
  });
  it("les condicions ambigües o amb fragment no verificat exigeixen confirmació de revisió manual", async () => {
    const t = await term({ category: "remuneracio", field: "pct_marge", value: 12.5, unit: "pct", excerpt: "12,5% del margen (según anexo)", excerpt_found: true, confidence: 0.4, ambiguous: true, ambiguity_reason: "La base del marge és a un annex no aportat", review_status: "revisio_manual" });
    expect(await h.fails("A", `select retailer_approve_term('${t}')`)).toMatch(/REVISIÓ MANUAL NECESSÀRIA/);
    // un percentatge no s'aprova sense la fórmula exacta de la base validada (salvaguarda del motor de la Fase 4)
    expect(await h.fails("A", `select retailer_approve_term('${t}', '{}', true)`)).toMatch(/fórmula exacta de la base/);
    const r = (await h.as<{ j: { rule_id: string } }>("A", `select retailer_approve_term('${t}', '{"formula": "12,5 % × marge comercial definit a l''annex II"}', true, true) j`)).rows[0].j;
    expect((await sys<{ base_validated: boolean; base_formula: string }>(`select base_validated, base_formula from fin_rules where id='${r.rule_id}'`))[0]).toEqual({ base_validated: true, base_formula: "12,5 % × marge comercial definit a l'annex II" });
    const nf = await term({ category: "remuneracio", field: "fix_contracte", value: 50, unit: "eur", excerpt: "text que no és al document", excerpt_found: false, confidence: 0.8 });
    expect(await h.fails("A", `select retailer_approve_term('${nf}')`)).toMatch(/REVISIÓ MANUAL/);
  });
  it("un contracte nou crea una versió nova i conserva la regla anterior per als contractes antics", async () => {
    const doc2 = (await h.as<{ id: string }>("A", `insert into retailer_documents (retailer_id, title, version, supersedes_id, valid_from, sha256) values ('${ids.r}','Contracte d''agència 2027', 2, '${ids.doc}', '2027-01-01','bbb') returning id`)).rows[0].id;
    const ex2 = (await h.as<{ id: string }>("A", `insert into retailer_extractions (document_id, retailer_id, method, status) values ('${doc2}','${ids.r}','ia','completada') returning id`)).rows[0].id;
    const t = (await h.as<{ id: string }>("A", `insert into retailer_terms (extraction_id, document_id, retailer_id, category, field, product, value, unit, excerpt, excerpt_found, confidence) values ('${ex2}','${doc2}','${ids.r}','remuneracio','per_mwh','Gala',12,'eur_mwh','Gala: 12 €/MWh', true, 0.97) returning id`)).rows[0].id;
    const r = (await h.as<{ j: { rule_id: string; version: number; rule_key: string } }>("A", `select retailer_approve_term('${t}') j`)).rows[0].j;
    expect(r.version).toBe(2);
    const vs = await sys<{ version: number; v: number; vf: string; vt: string | null; status: string }>(`select version, value::float v, valid_from::text vf, valid_to::text vt, status from fin_rules where rule_key='${r.rule_key}' order by version`);
    expect(vs).toEqual([{ version: 1, v: 10, vf: "2026-01-01", vt: "2026-12-31", status: "aprovada" }, { version: 2, v: 12, vf: "2027-01-01", vt: null, status: "aprovada" }]);
    await h.as("A", `select retailer_activate_document('${doc2}')`);
    const st = await sys<{ title: string; status: string }>(`select title, status from retailer_documents order by version`);
    expect(st.map((s) => s.status)).toEqual(["substituit", "vigent"]);
  });
  it("els comercials no veuen mai les regles de la comercialitzadora", async () => {
    expect(await h.count("C1", `select * from fin_rules where layer='proveidor'`)).toBe(0);
    expect(await h.count("L", `select * from fin_rules`)).toBe(0);
  });
});

describe("017 · retrocessions i penalitzacions", () => {
  it("baixa anticipada en 12 mesos = 100 % es converteix en una regla de retrocessió total", async () => {
    const t = await term({ category: "retrocessio", field: "baixa_anticipada", value: 100, unit: "pct", excerpt: "Si el cliente causa baja en los primeros 12 meses se devolverá el 100% de la comisión", excerpt_found: true, confidence: 0.92 });
    await sys(`update retailer_terms set conditions='{"risk_months": 12, "start_event": "activacio"}' where id='${t}'`);
    const r = (await h.as<{ j: { clawback_id: string } }>("A", `select retailer_approve_term('${t}') j`)).rows[0].j;
    ids.claw = r.clawback_id;
    const c = (await sys<Record<string, unknown>>(`select trigger, risk_months, mode, pct::float pct, start_event, status from retailer_clawback_rules where id='${r.clawback_id}'`))[0];
    expect(c).toEqual({ trigger: "baixa_anticipada", risk_months: 12, mode: "total", pct: 100, start_event: "activacio", status: "aprovada" });
  });
  it("el prorrateig guarda la fórmula exacta", async () => {
    const t = await term({ category: "retrocessio", field: "impagament", value: null, unit: null, formula: "comisión × (12 − meses consumidos) / 12", excerpt: "se devolverá la parte proporcional: comisión × (12 − meses consumidos) / 12", excerpt_found: true, confidence: 0.85 });
    await sys(`update retailer_terms set conditions='{"risk_months": 12, "mode": "prorrata"}' where id='${t}'`);
    const r = (await h.as<{ j: { clawback_id: string } }>("A", `select retailer_approve_term('${t}') j`)).rows[0].j;
    const c = (await sys<{ mode: string; formula: string }>(`select mode, formula from retailer_clawback_rules where id='${r.clawback_id}'`))[0];
    expect(c).toEqual({ mode: "prorrata", formula: "comisión × (12 − meses consumidos) / 12" });
  });
  it("una retrocessió real necessita evidència i Direcció; no es duplica", async () => {
    expect(await h.fails("A", `select retailer_apply_clawback('${ids.k}','${ids.claw}', 200)`)).toMatch(/evidència/);
    expect(await h.fails("B", `select retailer_apply_clawback('${ids.k}','${ids.claw}', 200, null, 'Baixa comunicada per correu el 10/11')`)).toMatch(/Direcció/);
    await h.as("A", `select retailer_apply_clawback('${ids.k}','${ids.claw}', 200, null, 'Baixa comunicada per Nufri, correu del 10/11/2026')`);
    const l = await sys<{ amount: string; kind: string; layer: string }>(`select amount, kind, layer from fin_ledger where contract_id='${ids.k}'`);
    expect(l.map((x) => [Number(x.amount), x.kind, x.layer])).toEqual([[-200, "retrocessio", "proveidor"]]);
    expect(await h.fails("A", `select retailer_apply_clawback('${ids.k}','${ids.claw}', 200, null, 'Una altra vegada la mateixa baixa')`)).toMatch(/duplicate key|unique/);
  });
  it("les regles de retrocessió aprovades són immutables i tot queda a l'auditoria", async () => {
    expect(await h.fails("A", `update retailer_clawback_rules set pct=50 where id='${ids.claw}'`)).toMatch(/no es modifica/);
    const acts = (await sys<{ action: string }>(`select action from sec_audit where entity like 'retailer%'`)).map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(["comercialitzadora_alta", "contracte_comercialitzadora_pujat", "condicio_aprovada", "retrocessio_regla_aprovada"]));
  });
});

describe("017 · idempotència i reversió", () => {
  it("es pot aplicar dues vegades, desfer i tornar a aplicar", async () => {
    const x = await setup(upTo("017"));
    await x.db.exec(fs.readFileSync(`${dir}/017_comercialitzadores.sql`, "utf8"));
    await x.db.exec(fs.readFileSync(`${dir}/017_comercialitzadores_down.sql`, "utf8"));
    expect(await x.fails("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit) values ('xx_test','x','proveidor','pct_energia',1,'pct')`)).toMatch(/check constraint/);
    await x.db.exec(fs.readFileSync(`${dir}/017_comercialitzadores.sql`, "utf8"));
    expect(await x.fails("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit) values ('xx_test','x','proveidor','pct_energia',1,'pct')`)).toBeNull();
  }, 180_000);
});
