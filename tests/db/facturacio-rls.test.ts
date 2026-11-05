/**
 * Facturació · 026 i 028 sobre PostgreSQL real (PGlite, migracions 001-028). Dades fictícies.
 * Numeració atòmica i correlativa, esborranys sense número, bloqueig de les emeses, rectificatives, cobraments,
 * doble facturació d'una liquidació i permisos per rol (Direcció, Administració, comercial, col·laborador).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { U, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const draft = async (client: string, amount: number, vat = 21, extra = "") => {
  const id = (await h.as<{ id: string }>("A", `insert into bill_invoices (client_id, concept${extra ? ", origin" : ""}) values ('${client}', 'Concepte de prova'${extra ? `, '${extra}'` : ""}) returning id`)).rows[0].id;
  await h.as("A", `insert into bill_invoice_lines (invoice_id, line_no, description, unit_price, vat_rate${vat === 0 ? ", vat_exemption" : ""}) values ('${id}', 1, 'Servei de prova', ${amount}, ${vat}${vat === 0 ? ", 'Exempt (prova)'" : ""})`);
  return id;
};

beforeAll(async () => {
  h = await setup(upTo("028"));
  await sys(`insert into bill_settings (id, issuer_name, issuer_nif, issuer_address, issuer_postal_code, issuer_city, iban) values (1, 'EMISSOR DE PROVA SL', 'B12345674', 'C/ Prova 1', '25001', 'Lleida', 'ES00 0000 0000 0000 0000 0000')`);
  ids.c = (await sys<{ id: string }>(`insert into bill_clients (legal_name, nif, address, postal_code, city, retailer_name) values ('CLIENT FICTICI SA', 'A58818501', 'C/ Inventada 2', '08001', 'Barcelona', 'COMERCIALITZADORA PROVA') returning id`))[0].id;
  ids.bad = (await sys<{ id: string }>(`insert into bill_clients (legal_name, nif, address, postal_code, city, needs_review, review_notes) values ('CLIENT PER REVISAR SL', 'B0000000', 'C/ X', '2205', 'Osca', true, 'CIF incomplet') returning id`))[0].id;
  await sys(`insert into bill_series (code, year, last_number) values ('ORD', 2026, 48)`);
  await sys(`insert into bill_number_gaps (series, year, number, invoice_no) values ('ORD', 2026, 23, '26-023')`);
}, 240_000);

describe("026 · permisos", () => {
  it("Direcció i Administració veuen la facturació; comercials i col·laboradors no", async () => {
    expect(await h.count("A", `select * from bill_clients`)).toBe(2);
    expect(await h.count("B", `select * from bill_clients`)).toBe(2);
    for (const w of ["C1", "K", "L"] as const) { expect(await h.count(w, `select * from bill_clients`)).toBe(0); expect(await h.count(w, `select * from bill_settings`)).toBe(0); }
    expect(await h.fails("C1", `insert into bill_clients (legal_name) values ('X')`)).toMatch(/row-level security/);
  });
  it("Administració prepara esborranys però no emet; només Direcció canvia l'IBAN", async () => {
    const id = (await h.as<{ id: string }>("B", `insert into bill_invoices (client_id, concept) values ('${ids.c}', 'Esborrany administratiu') returning id`)).rows[0].id;
    await h.as("B", `insert into bill_invoice_lines (invoice_id, line_no, description, unit_price) values ('${id}', 1, 'x', 10)`);
    expect(await h.fails("B", `select bill_issue_invoice('${id}')`)).toMatch(/permís per emetre/);
    await h.as("B", `update bill_settings set iban = 'XX'`);
    expect((await sys<{ iban: string }>(`select iban from bill_settings`))[0].iban).toMatch(/^ES00/);
    await h.as("A", `delete from bill_invoices where id = '${id}'`);
  });
});

describe("026 · numeració i bloqueig", () => {
  it("l'esborrany no té número; en emetre rep el següent correlatiu", async () => {
    ids.i1 = await draft(ids.c, 5256);
    expect((await sys<{ invoice_no: string | null; total: string }>(`select invoice_no, total from bill_invoices where id='${ids.i1}'`))[0]).toEqual({ invoice_no: null, total: "6359.76" });
    const r = (await h.as<{ invoice_no: string; status: string }>("A", `select invoice_no, status from bill_issue_invoice('${ids.i1}', '2026-11-04')`)).rows[0];
    expect(r).toEqual({ invoice_no: "26-049", status: "emesa" });
    const i2 = await draft(ids.c, 10);
    expect((await h.as<{ invoice_no: string }>("A", `select invoice_no from bill_issue_invoice('${i2}', '2026-11-05')`)).rows[0].invoice_no).toBe("26-050");
  });
  it("una emesa no es modifica ni s'esborra; tampoc les línies", async () => {
    expect(await h.fails("A", `update bill_invoices set total = 1 where id='${ids.i1}'`)).toMatch(/ja és emesa/);
    expect(await h.fails("A", `delete from bill_invoices where id='${ids.i1}'`)).toMatch(/no es pot eliminar/);
    expect(await h.fails("A", `update bill_invoice_lines set unit_price = 1 where invoice_id='${ids.i1}'`)).toMatch(/ja és emesa/);
    expect(await h.fails("A", `update bill_invoices set status='emesa' where status='esborrany'`)).toBeNull(); // cap esborrany: res a fer
  });
  it("no es pot emetre amb data anterior a l'última, a un client per revisar ni amb IVA 0 sense causa", async () => {
    const a = await draft(ids.c, 10);
    expect(await h.fails("A", `select bill_issue_invoice('${a}', '2026-10-01')`)).toMatch(/anterior/);
    const b = await draft(ids.bad, 10);
    expect(await h.fails("A", `select bill_issue_invoice('${b}')`)).toMatch(/revisar la fitxa/);
    await h.as("A", `update bill_invoice_lines set vat_rate = 0 where invoice_id='${a}'`);
    expect(await h.fails("A", `select bill_issue_invoice('${a}', '2026-11-05')`)).toMatch(/exempció/);
    await h.as("A", `delete from bill_invoices where id in ('${a}', '${b}')`);
  });
  it("conserva les dades fiscals del moment de l'emissió", async () => {
    await h.as("A", `update bill_clients set address = 'Adreça nova' where id='${ids.c}'`);
    expect((await sys<{ a: string }>(`select client_snapshot->>'address' as a from bill_invoices where id='${ids.i1}'`))[0].a).toBe("C/ Inventada 2");
  });
});

describe("026 · cobraments i rectificatives", () => {
  it("parcial, total, repetit i superior al pendent", async () => {
    expect((await h.as<{ status: string }>("A", `select status from bill_register_payment('${ids.i1}', 3000, '2026-11-10', 'transferencia', 'REF-1')`)).rows[0].status).toBe("parcialment_cobrada");
    expect(await h.fails("A", `select bill_register_payment('${ids.i1}', 3000, '2026-11-10', 'transferencia', 'REF-1')`)).toMatch(/duplicate|idempotency/);
    expect(await h.fails("A", `select bill_register_payment('${ids.i1}', 9000, '2026-11-11', 'transferencia', 'REF-2')`)).toMatch(/supera el pendent/);
    expect((await h.as<{ status: string }>("A", `select status from bill_register_payment('${ids.i1}', 3359.76, '2026-11-12', 'transferencia', 'REF-3')`)).rows[0].status).toBe("cobrada");
    await h.as("A", `delete from bill_payments`); // la RLS no ho permet: no s'esborra res
    expect(await h.count("A", `select * from bill_payments`)).toBe(2);
    await expect(sys(`delete from bill_payments`)).rejects.toThrow(/no es modifiquen/); // ni amb la clau de servei
  });
  it("la rectificativa té sèrie pròpia i marca l'original", async () => {
    const r = (await h.as<{ id: string }>("A", `select bill_create_rectification('${ids.i1}', 'Error en l''import de prova') as id`)).rows[0].id;
    expect((await h.as<{ invoice_no: string; total: string }>("A", `select invoice_no, total from bill_issue_invoice('${r}', '2026-11-20')`)).rows[0]).toEqual({ invoice_no: "R26-001", total: "-6359.76" });
    expect((await sys<{ status: string }>(`select status from bill_invoices where id='${ids.i1}'`))[0].status).toBe("rectificada");
  });
});

describe("026 · liquidacions", () => {
  it("no es pot facturar dues vegades la mateixa liquidació (retrocessions descomptades)", async () => {
    const st = (await h.as<{ id: string }>("A", `insert into fin_provider_statements (retailer, reference) values ('COMERCIALITZADORA PROVA', 'OCT-26') returning id`)).rows[0].id;
    await h.as("A", `insert into fin_statement_lines (statement_id, line_no, amount, kind, match_status, line_hash) values ('${st}', 1, 1000, 'comissio', 'conciliat', 'h1'), ('${st}', 2, -100, 'retrocessio', 'conciliat', 'h2'), ('${st}', 3, 500, 'comissio', 'duplicat', 'h3')`);
    const s = (await h.as<{ billable: string; pending: string; negatives: string }>("A", `select billable, pending, negatives from bill_statement_summary('${st}')`)).rows[0];
    expect([Number(s.billable), Number(s.pending), Number(s.negatives)]).toEqual([900, 900, -100]);
    const a = await draft(ids.c, 900, 21, "liquidacio");
    await h.as("A", `insert into bill_invoice_statements (invoice_id, statement_id, amount) values ('${a}', '${st}', 900)`);
    await h.as("A", `select bill_issue_invoice('${a}', '2026-11-25')`);
    const b = await draft(ids.c, 900, 21, "liquidacio");
    await h.as("A", `insert into bill_invoice_statements (invoice_id, statement_id, amount) values ('${b}', '${st}', 900)`);
    expect(await h.fails("A", `select bill_issue_invoice('${b}', '2026-11-25')`)).toMatch(/ja s'ha facturat/);
  });
  it("el comptador mai reutilitza números (tampoc els que consten com a consumits)", async () => {
    const n = (await sys<{ last_number: number }>(`select last_number from bill_series where code='ORD' and year=2026`))[0].last_number;
    expect(n).toBeGreaterThanOrEqual(51);
    expect((await sys<{ c: number }>(`select count(*)::int as c from bill_invoices where invoice_no='26-023'`))[0].c).toBe(0);
    expect(U.A).toBeTruthy();
  });
});

describe("028 · conciliació bancària", () => {
  it("confirmar un ingrés registra el cobrament a la factura i no es pot repetir", async () => {
    await sys(`select 1`);
    const inv = await draft(ids.c, 1000);
    const no = (await h.as<{ id: string }>("A", `select id from bill_issue_invoice('${inv}', '2026-11-26')`)).rows[0].id;
    const mv = (await sys<{ id: string }>(`insert into bill_bank_movements (op_date, amount, concept, movement_hash) values ('2026-11-28', 1210, 'TRANSFERENCIA CLIENT FICTICI', 'hash-prova-1') returning id`))[0].id;
    expect(await h.fails("B", `select bill_bank_confirm('${mv}', '[{"invoice_id":"${no}","amount":1210}]')`)).toMatch(/permís/);
    await h.as("A", `select bill_bank_confirm('${mv}', '[{"invoice_id":"${no}","amount":1210}]')`);
    expect((await sys<{ status: string; paid: string }>(`select status, paid from bill_invoices where id='${no}'`))[0]).toEqual({ status: "cobrada", paid: "1210.00" });
    expect((await sys<{ status: string }>(`select status from bill_bank_movements where id='${mv}'`))[0].status).toBe("conciliat");
    expect(await h.fails("A", `select bill_bank_confirm('${mv}', '[{"invoice_id":"${no}","amount":1}]')`)).toMatch(/ja està conciliat/);
    await expect(sys(`insert into bill_bank_movements (op_date, amount, concept, movement_hash) values ('2026-11-28', 1210, 'x', 'hash-prova-1')`)).rejects.toThrow(/duplicate|unique/);
  });
  it("no es pot cobrar més del que entra al banc (tot o res)", async () => {
    const inv = await draft(ids.c, 1000);
    const no = (await h.as<{ id: string }>("A", `select id from bill_issue_invoice('${inv}', '2026-11-28')`)).rows[0].id;
    const mv = (await sys<{ id: string }>(`insert into bill_bank_movements (op_date, amount, concept, movement_hash) values ('2026-11-29', 500, 'parcial', 'hash-prova-2') returning id`))[0].id;
    expect(await h.fails("A", `select bill_bank_confirm('${mv}', '[{"invoice_id":"${no}","amount":600}]')`)).toMatch(/superen/);
    expect((await sys<{ paid: string }>(`select paid from bill_invoices where id='${no}'`))[0].paid).toBe("0.00");
    expect(await h.count("C1", `select * from bill_bank_movements`)).toBe(0);
  });
});
