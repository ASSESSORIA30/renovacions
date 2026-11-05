/**
 * Migració 011 (CRM Fase 4: control econòmic) sobre PostgreSQL real (PGlite).
 * Usuaris: Direcció (A), Administració (B), comercials (C1, C2) i col·laborador (K).
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { MIGRATIONS, U, dir, setup } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let client = "", contract = "", rule = "", settlement = "", stmt = "";
const one = async <T = Record<string, unknown>>(who: Parameters<typeof h.as>[0], sql: string) => (await h.as<T>(who, sql)).rows[0];
const led = (key: string, layer: string, benef: string | null, kind: string, amount: string, extra = "") =>
  `insert into fin_ledger (contract_id, client_id, layer, beneficiary_id, kind, amount, description, idempotency_key, created_by${extra ? ", " + extra.split("=")[0] : ""}) values ('${contract}','${client}','${layer}',${benef ? `'${benef}'` : "null"},'${kind}',${amount},'Prova','${key}','${U.B}'${extra ? ", " + extra.split("=")[1] : ""}) returning id`;

beforeAll(async () => {
  h = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "011_crm_economia.sql", "011_crm_economia.sql"]);
  client = (await one<{ id: string }>("C1", `insert into crm_clients (name, owner_id, collaborator_id) values ('Forn SL','${U.C1}','${U.K}') returning id`)).id;
  contract = (await one<{ id: string }>("C1", `insert into crm_contracts (client_id, retailer, status, owner_id) values ('${client}','Nufri','actiu','${U.C1}') returning id`)).id;
}, 120_000);

describe("011 · regles de comissió", () => {
  it("les regles inicials existeixen i estan pendents d'aprovació", async () => {
    const r = (await h.as<{ rule_key: string; status: string; base_validated: boolean }>("A", `select rule_key, status, base_validated from fin_rules order by rule_key`)).rows;
    expect(r.length).toBe(13);
    expect(r.every((x) => x.status === "pendent_aprovacio")).toBe(true);
    expect(r.find((x) => x.rule_key === "iberdrola_pct")!.base_validated).toBe(false);
  });
  it("només Direcció aprova; un percentatge sense base validada no es pot aprovar", async () => {
    expect((await h.as("B", `update fin_rules set status='aprovada' where rule_key='nufri_gala' returning id`)).rows).toHaveLength(0);   // Administració no gestiona regles
    await h.as("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit, status, created_by) values ('prova_cap', 'Prova', 'comercial', 'fix_contracte', 1, 'eur', 'esborrany', '${U.A}')`);
    expect(await h.fails("A", `update fin_rules set status='aprovada' where rule_key='prova_cap'`)).toBeNull();
    expect((await h.as("C1", `update fin_rules set value=99 where rule_key='nufri_gala' returning id`)).rows).toHaveLength(0);
    expect(await h.fails("A", `update fin_rules set status='aprovada' where rule_key='iberdrola_pct'`)).toMatch(/base de càlcul/);
    await h.as("A", `update fin_rules set status='aprovada', valid_from='2026-01-01' where rule_key='nufri_gala'`);
    rule = (await one<{ id: string; approved_by: string }>("A", `select id, approved_by from fin_rules where rule_key='nufri_gala'`)).id;
    expect((await one<{ approved_by: string }>("A", `select approved_by from fin_rules where id='${rule}'`)).approved_by).toBe(U.A);
  });
  it("una regla aprovada no es modifica: el canvi és una versió nova i l'anterior es tanca", async () => {
    expect(await h.fails("A", `update fin_rules set value=11 where id='${rule}'`)).toMatch(/versió nova/);
    const v2 = (await one<{ id: string }>("A", `insert into fin_rules (rule_key, version, name, layer, retailer, product, kind, value, unit, conditions, base_validated, valid_from, status, created_by) values ('nufri_gala', 2, 'Nufri Gala v2', 'comercial', 'Nufri', 'Gala', 'per_mwh', 11, 'eur_mwh', '{}', true, '2026-11-01', 'esborrany', '${U.A}') returning id`)).id;
    await h.as("A", `update fin_rules set status='aprovada' where id='${v2}'`);
    const old = await one<{ value: string; valid_to: string }>("A", `select value, valid_to::text from fin_rules where id='${rule}'`);
    expect(Number(old.value)).toBe(10);                       // es conserva per als càlculs històrics
    expect(old.valid_to).toBe("2026-10-31");
  });
  it("comercials i col·laboradors no veuen les regles del proveïdor", async () => {
    await h.as("A", `insert into fin_rules (rule_key, name, layer, retailer, kind, value, unit, base_validated, status, created_by) values ('prov_nufri', 'Nufri paga a A3', 'proveidor', 'Nufri', 'per_mwh', 30, 'eur_mwh', true, 'aprovada', '${U.A}')`);
    expect(await h.count("C1", `select * from fin_rules where layer='proveidor'`)).toBe(0);
    expect(await h.count("K", `select * from fin_rules where layer='proveidor'`)).toBe(0);
    expect(await h.count("C1", `select * from fin_rules where rule_key='nufri_gala' and status='aprovada'`)).toBe(2);
    expect(await h.count("B", `select * from fin_rules where layer='proveidor'`)).toBe(1);
  });
});

describe("011 · càlculs i moviments", () => {
  it("els càlculs i els moviments són immutables", async () => {
    const c = (await one<{ id: string }>("B", `insert into fin_calculations (contract_id, layer, beneficiary_id, rule_id, status, amount, inputs, breakdown, calc_hash, created_by) values ('${contract}','comercial','${U.C1}','${rule}','calculat',2000.00,'{}','[]','h1','${U.B}') returning id`)).id;
    expect(await h.fails("B", `update fin_calculations set amount=1 where id='${c}'`)).toMatch(/immutables/);
    await h.as("B", `update fin_calculations set is_current=false where id='${c}'`);
    const l = (await one<{ id: string }>("B", led("merit:1", "comercial", U.C1, "meritacio", "2000.00", `rule_id='${rule}'`))).id;
    expect(await h.fails("B", `update fin_ledger set amount=1 where id='${l}'`)).toMatch(/immutables/);
    expect((await h.as("B", `delete from fin_ledger where id='${l}' returning id`)).rows).toHaveLength(0);            // cap política d'esborrat
    await expect(h.db.exec(`delete from fin_ledger where id='${l}'`)).rejects.toThrow(/no es poden esborrar/);          // ni tan sols el servidor
    expect(await h.fails("B", led("merit:1", "comercial", U.C1, "meritacio", "5"))).toMatch(/duplicate key|unique/);   // idempotència
  });
  it("els comercials no poden escriure moviments ni veure la capa del proveïdor ni els dels altres", async () => {
    await h.as("B", led("prov:1", "proveidor", null, "meritacio", "6000.00"));
    expect(await h.fails("C1", led("x:1", "comercial", U.C1, "ajustament", "100"))).toMatch(/row-level security/);
    expect(await h.count("C1", `select * from fin_ledger where layer='proveidor'`)).toBe(0);
    expect(await h.count("C1", `select * from fin_ledger where beneficiary_id='${U.C1}'`)).toBe(1);
    expect(await h.count("C2", `select * from fin_ledger`)).toBe(0);
    expect(await h.count("K", `select * from fin_ledger`)).toBe(0);
    expect(await h.count("C1", `select * from fin_provider_statements`)).toBe(0);
  });
  it("decimals: els imports es desen a cèntims (arrodoniment mig cap amunt)", async () => {
    const r = (await one<{ id: string }>("B", led("dec:1", "comercial", U.C1, "ajustament", "12.345"))).id;
    expect((await one<{ amount: string }>("B", `select amount::text from fin_ledger where id='${r}'`)).amount).toBe("12.35");
    expect((await one<{ s: string }>("B", `select (0.1::numeric(14,2) + 0.2::numeric(14,2))::text as s`)).s).toBe("0.30");
  });
});

describe("011 · liquidacions", () => {
  it("Administració prepara la liquidació amb els moviments pendents (en una transacció)", async () => {
    settlement = (await one<{ id: string }>("B", `select public.fin_build_settlement('comercial', '${U.C1}', '2026-11-01', '2026-11-30') as id`)).id;
    const s = await one<{ code: string; total_gross: string; total_variable: string; total_adjustments: string; status: string }>("B", `select * from fin_settlements where id='${settlement}'`);
    expect(s.code).toMatch(/^LIQ-2026-\d{4}$/);
    expect(Number(s.total_variable)).toBe(2000);
    expect(Number(s.total_adjustments)).toBe(12.35);
    expect(Number(s.total_gross)).toBe(2012.35);
    expect(await h.fails("C1", `select public.fin_build_settlement('comercial', '${U.C1}', '2026-12-01', '2026-12-31')`)).toMatch(/Només Administració/);
  });
  it("el comercial veu la seva liquidació però no la pot modificar ni aprovar", async () => {
    expect(await h.count("C1", `select * from fin_settlements where id='${settlement}'`)).toBe(1);
    expect(await h.count("C2", `select * from fin_settlements where id='${settlement}'`)).toBe(0);
    expect((await h.as("C1", `update fin_settlements set status='revisio' where id='${settlement}' returning id`)).rows).toHaveLength(0);
    expect((await h.as("C1", `update fin_settlement_lines set amount=99999 where settlement_id='${settlement}' returning id`)).rows).toHaveLength(0);
  });
  it("aprovació: només Direcció, mai la pròpia, i bloqueja imports i línies", async () => {
    expect(await h.fails("B", `update fin_settlements set status='aprovada' where id='${settlement}'`)).toMatch(/Canvi d'estat|no permès/);
    await h.as("B", `update fin_settlements set status='revisio' where id='${settlement}'`);
    expect(await h.fails("B", `update fin_settlements set status='aprovada' where id='${settlement}'`)).toMatch(/Només Direcció/);
    await h.as("A", `update fin_settlements set status='aprovada' where id='${settlement}'`);
    const s = await one<{ approved_amount: string; approved_by: string }>("A", `select approved_amount::text, approved_by from fin_settlements where id='${settlement}'`);
    expect(s).toEqual({ approved_amount: "2012.35", approved_by: U.A });
    expect(await h.fails("A", `update fin_settlements set total_gross=1 where id='${settlement}'`)).toMatch(/bloquejats/);
    expect(await h.fails("A", `update fin_settlement_lines set amount=1 where settlement_id='${settlement}'`)).toMatch(/bloquejades/);
    expect(await h.fails("A", `update fin_ledger set settlement_id=null where settlement_id='${settlement}'`)).toMatch(/aprovada/);
    expect((await h.as("A", `delete from fin_settlements where id='${settlement}' returning id`)).rows).toHaveLength(0);
    await expect(h.db.exec(`delete from fin_settlements where id='${settlement}'`)).rejects.toThrow(/no es poden eliminar/);
    expect(await h.fails("A", `update fin_settlements set status='esborrany' where id='${settlement}'`)).toMatch(/enrere/);
  });
  it("ningú aprova la seva pròpia liquidació", async () => {
    await h.as("B", led("own:1", "comercial", U.A, "bonificacio", "50"));
    const own = (await one<{ id: string }>("B", `select public.fin_build_settlement('comercial', '${U.A}', '2026-11-01', '2026-11-30') as id`)).id;
    await h.as("B", `update fin_settlements set status='revisio' where id='${own}'`);
    expect(await h.fails("A", `update fin_settlements set status='aprovada' where id='${own}'`)).toMatch(/pròpia/);
  });
  it("pagament parcial, pagament duplicat i pagament complet", async () => {
    await h.as("B", `insert into fin_payments (settlement_id, amount, paid_at, reference, idempotency_key, created_by) values ('${settlement}', 1000.00, '2026-12-05', 'TR-1', 'p1', '${U.B}')`);
    let s = await one<{ status: string; paid_amount: string }>("B", `select status, paid_amount::text from fin_settlements where id='${settlement}'`);
    expect(s).toEqual({ status: "aprovada", paid_amount: "1000.00" });
    expect(await h.fails("B", `insert into fin_payments (settlement_id, amount, paid_at, reference, idempotency_key, created_by) values ('${settlement}', 1000.00, '2026-12-05', 'TR-2', 'p2', '${U.B}')`)).toMatch(/duplicat/);
    expect(await h.fails("B", `insert into fin_payments (settlement_id, amount, paid_at, reference, idempotency_key, created_by) values ('${settlement}', 1500.00, '2026-12-06', 'TR-3', 'p3', '${U.B}')`)).toMatch(/supera el saldo/);
    expect(await h.fails("B", `insert into fin_payments (settlement_id, amount, paid_at, reference, idempotency_key, created_by) values ('${settlement}', 5.00, '2026-12-07', 'TR-1', 'p1', '${U.B}')`)).toMatch(/duplicate key|unique/);
    await h.as("B", `insert into fin_payments (settlement_id, amount, paid_at, reference, idempotency_key, created_by) values ('${settlement}', 1012.35, '2026-12-06', 'TR-4', 'p4', '${U.B}')`);
    s = await one("B", `select status, paid_amount::text from fin_settlements where id='${settlement}'`);
    expect(s).toEqual({ status: "pagada", paid_amount: "2012.35" });
    expect((await h.as("B", `update fin_payments set amount=1 where settlement_id='${settlement}' returning id`)).rows).toHaveLength(0);
    await expect(h.db.exec(`update fin_payments set amount=1 where settlement_id='${settlement}'`)).rejects.toThrow(/no es modifiquen/);
  });
  it("una correcció posterior és un ajustament nou que va a la liquidació següent", async () => {
    await h.as("B", led("adj:1", "comercial", U.C1, "ajustament", "-25.00"));
    const next = (await one<{ id: string }>("B", `select public.fin_build_settlement('comercial', '${U.C1}', '2026-12-01', '2026-12-31') as id`)).id;
    expect(Number((await one<{ total_gross: string }>("B", `select total_gross from fin_settlements where id='${next}'`)).total_gross)).toBe(-25);
    expect(Number((await one<{ approved_amount: string }>("B", `select approved_amount from fin_settlements where id='${settlement}'`)).approved_amount)).toBe(2012.35);
  });
  it("historial: auditoria amb l'autor de cada aprovació i pagament", async () => {
    const a = (await h.as<{ action: string; user_id: string }>("A", `select action, user_id from fin_audit where entity_id='${settlement}' order by id`)).rows;
    expect(a.map((x) => x.action)).toEqual(expect.arrayContaining(["estat:esborrany", "estat:revisio", "estat:aprovada", "estat:pagada"]));
    expect(a.find((x) => x.action === "estat:aprovada")!.user_id).toBe(U.A);
    expect(await h.count("C1", `select * from fin_audit`)).toBe(0);
    expect(await h.fails("A", `update fin_audit set amount=0`)).toBeNull();          // sense política: no modifica res
    await expect(h.db.exec(`update fin_audit set amount=0`)).rejects.toThrow(/immutable/);
  });
});

describe("011 · conciliació i cobraments", () => {
  it("el cobrament real només s'assigna a línies conciliades i no és el mateix que l'import comunicat", async () => {
    stmt = (await one<{ id: string }>("B", `insert into fin_provider_statements (retailer, reference, declared_total, created_by) values ('Nufri','NUF-2026-11', 6000.00, '${U.B}') returning id`)).id;
    await h.as("B", `insert into fin_statement_lines (statement_id, line_no, cups, amount, contract_id, match_status, line_hash) values ('${stmt}', 1, 'ES0021000000000001AA', 4000.00, '${contract}', 'conciliat', 'a'), ('${stmt}', 2, 'ES0021000000000002BB', 2000.00, null, 'no_identificat', 'b')`);
    expect(await h.count("B", `select * from fin_ledger where kind='cobrament'`)).toBe(0);    // comunicat ≠ cobrat
    await h.as("B", `select public.fin_register_receipt('${stmt}', 2500.00, '2026-12-10', 'BANC-778')`);
    const c = (await h.as<{ amount: string }>("B", `select amount::text from fin_ledger where kind='cobrament'`)).rows;
    expect(c).toEqual([{ amount: "2500.00" }]);
    expect(await h.fails("B", `select public.fin_register_receipt('${stmt}', 2500.00, '2026-12-10', 'BANC-778')`)).toMatch(/duplicate key|unique/);
    await h.as("B", `select public.fin_register_receipt('${stmt}', 3500.00, '2026-12-20', 'BANC-779')`);
    const r = await one<{ allocated: string }>("B", `select allocated::text from fin_provider_receipts where bank_reference='BANC-779'`);
    expect(r.allocated).toBe("1500.00");                       // la resta queda sense assignar (línia no identificada)
    expect(await h.fails("C1", `select public.fin_register_receipt('${stmt}', 10, '2026-12-21', 'X')`)).toMatch(/Només Administració/);
  });
});

describe("011 · reversió", () => {
  it("la migració es pot desfer i tornar a aplicar sense tocar les fases anteriors", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/011_crm_economia_down.sql`, "utf8"));
    expect((await h.db.query(`select 1 from information_schema.tables where table_name='fin_ledger'`)).rows).toHaveLength(0);
    expect((await h.db.query<{ n: number }>(`select count(*)::int as n from crm_contracts`)).rows[0].n).toBe(1);
    await h.db.exec(fs.readFileSync(`${dir}/011_crm_economia.sql`, "utf8"));
  });
});
