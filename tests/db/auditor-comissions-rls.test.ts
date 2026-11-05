/**
 * Fase 14 · 025 · Auditor de comissions sobre PostgreSQL real (PGlite, migracions 001-025).
 * Cobrament net amb compensació de retrocomissions, conciliació parcial, assignacions només d'afegir,
 * reimportació del mateix fitxer, autorització obligatòria de les reclamacions, idempotència i _down.
 * Dades fictícies (CUPS inventats).
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const one = async (sql: string) => (await sys<{ id: string }>(sql))[0].id;

beforeAll(async () => {
  h = await setup(upTo("025"));
  // B (Administració) amb permís d'edició a economia, sense aprovació
  await sys(`insert into user_permissions (user_id, module, can_read, can_edit) values ('${U.B}','economia', true, true)`);
  const client = await one(`insert into crm_clients (name, owner_id) values ('Client fictici','${U.C1}') returning id`);
  const s1 = await one(`insert into crm_supplies (client_id, cups) values ('${client}','ES0031000000000001AA') returning id`);
  const s2 = await one(`insert into crm_supplies (client_id, cups) values ('${client}','ES0031000000000002BB') returning id`);
  const s3 = await one(`insert into crm_supplies (client_id, cups) values ('${client}','ES0031000000000003CC') returning id`);
  ids.k1 = await one(`insert into crm_contracts (client_id, supply_id, retailer, status, start_date) values ('${client}','${s1}','Gana Energía','actiu','2026-10-01') returning id`);
  ids.k2 = await one(`insert into crm_contracts (client_id, supply_id, retailer, status, start_date) values ('${client}','${s2}','Gana Energía','actiu','2026-10-02') returning id`);
  ids.k3 = await one(`insert into crm_contracts (client_id, supply_id, retailer, status, start_date) values ('${client}','${s3}','Gana Energía','anullat','2025-10-01') returning id`);
  ids.st = (await h.as<{ id: string }>("A", `insert into fin_provider_statements (retailer, reference, received_at, file_sha256, supplier_format, created_by) values ('Gana Energía','GANA-2026-10','2026-11-02','abc123','gana','${U.A}') returning id`)).rows[0].id;
  const line = (n: number, k: string | null, amount: number, kind: string, status: string, key: string) =>
    `insert into fin_statement_lines (statement_id, line_no, cups, amount, kind, contract_id, match_status, line_hash, source_sheet, source_row, movement, stable_key) values ('${ids.st}', ${n}, 'ES00310000000000${n}AA', ${amount}, '${kind}', ${k ? `'${k}'` : "null"}, '${status}', 'h${n}', 'Altas LUZ', ${n + 1}, '${kind === "retrocessio" ? "retrocessio" : "alta"}', '${key}') returning id`;
  ids.l1 = (await h.as<{ id: string }>("A", line(1, ids.k1, 100, "comissio", "conciliat", "s1"))).rows[0].id;
  ids.l2 = (await h.as<{ id: string }>("A", line(2, ids.k2, 120, "comissio", "conciliat", "s2"))).rows[0].id;
  ids.l3 = (await h.as<{ id: string }>("A", line(3, ids.k3, -80, "retrocessio", "conciliat", "s3"))).rows[0].id;
  ids.l4 = (await h.as<{ id: string }>("A", line(4, null, 50, "comissio", "no_identificat", "s4"))).rows[0].id;
}, 180_000);

describe("025 · importació idempotent", () => {
  it("el mateix fitxer de la mateixa comercialitzadora no es pot importar dues vegades", async () => {
    expect(await h.fails("A", `insert into fin_provider_statements (retailer, reference, file_sha256, created_by) values ('GANA ENERGÍA','GANA-2026-10-bis','abc123','${U.A}')`)).toMatch(/duplicate|unique/);
  });
  it("un mateix moviment del document només una vegada per liquidació", async () => {
    expect(await h.fails("A", `insert into fin_statement_lines (statement_id, line_no, amount, line_hash, stable_key) values ('${ids.st}', 99, 1, 'x', 's1')`)).toMatch(/duplicate|unique/);
  });
  it("el tipus de moviment i la confiança de la vinculació estan acotats", async () => {
    expect(await h.fails("A", `update fin_statement_lines set movement='inventat' where id='${ids.l1}'`)).toMatch(/check/);
    expect(await h.fails("A", `update fin_statement_lines set match_confidence='segur' where id='${ids.l1}'`)).toMatch(/check/);
  });
  it("una rectificativa es relaciona amb l'original sense ser un duplicat", async () => {
    const r = (await h.as<{ id: string }>("A", `insert into fin_provider_statements (retailer, reference, file_sha256, rectifies_id, created_by) values ('Gana Energía','GANA-2026-10-R','def456','${ids.st}','${U.A}') returning id`)).rows[0].id;
    expect((await sys<{ r: string }>(`select rectifies_id::text r from fin_provider_statements where id='${r}'`))[0].r).toBe(ids.st);
  });
});

describe("025 · cobrament net i conciliació parcial", () => {
  it("comercials i col·laboradors no poden registrar cobraments", async () => {
    expect(await h.fails("C1", `select fin_register_receipt_net('${ids.st}', 140, '2026-11-03', 'TRF-1')`)).toMatch(/Administració|row-level|permission/);
  });
  it("140 € nets = 220 € de comissions − 80 € de retrocomissió: les dues comissions queden cobrades i la línia sense contracte no", async () => {
    const rid = (await h.as<{ r: string }>("B", `select fin_register_receipt_net('${ids.st}', 140, '2026-11-03', 'TRF-1')::text r`)).rows[0].r;
    const cob = await sys<{ id: string; s: string }>(`select statement_line_id::text id, sum(amount)::text s from fin_ledger where kind='cobrament' group by 1 order by 1`);
    expect(Object.fromEntries(cob.map((x) => [x.id, x.s]))).toEqual({ [ids.l1]: "100.00", [ids.l2]: "120.00" });
    const al = await sys<{ mode: string; s: string }>(`select mode, sum(amount)::text s from fin_receipt_allocations where receipt_id='${rid}' group by 1 order by 1`);
    expect(al).toEqual([{ mode: "compensacio", s: "80.00" }, { mode: "compensada", s: "80.00" }, { mode: "efectiu", s: "140.00" }]);
    expect((await sys<{ a: string }>(`select allocated::text a from fin_provider_receipts where id='${rid}'`))[0].a).toBe("140.00");
    expect((await sys<{ n: number }>(`select count(*)::int n from fin_ledger where statement_line_id='${ids.l4}'`))[0].n).toBe(0);
  });
  it("un segon cobrament no assigna res més a línies ja cobrades (queda sense assignar)", async () => {
    const rid = (await h.as<{ r: string }>("B", `select fin_register_receipt_net('${ids.st}', 50, '2026-11-03', 'TRF-2')::text r`)).rows[0].r;
    expect((await sys<{ a: string }>(`select allocated::text a from fin_provider_receipts where id='${rid}'`))[0].a).toBe("0.00");
  });
  it("el mateix cobrament (referència, import i data) no es pot registrar dues vegades", async () => {
    expect(await h.fails("B", `select fin_register_receipt_net('${ids.st}', 140, '2026-11-03', 'TRF-1')`)).toMatch(/duplicate|unique/);
  });
  it("les assignacions no es modifiquen ni s'esborren; un cobrament sense rebut bancari és impossible", async () => {
    expect(await h.count("A", `delete from fin_receipt_allocations returning id`)).toBe(0);          // sense política d'esborrat
    await expect(sys(`delete from fin_receipt_allocations`)).rejects.toThrow(/no es modifiquen/);     // ni amb privilegis
    expect(await h.fails("A", `insert into fin_ledger (contract_id, layer, kind, amount, description, idempotency_key, created_by) values ('${ids.k1}','proveidor','cobrament', 10, 'x', 'manual-cob', '${U.A}')`)).toMatch(/check/);
  });
});

describe("025 · autorització de les reclamacions", () => {
  beforeAll(async () => {
    ids.c = (await h.as<{ id: string }>("B", `insert into fin_claims (retailer, period_from, period_to, created_by) values ('Gana Energía','2026-10-01','2026-10-31','${U.B}') returning id`)).rows[0].id;
    await h.as("B", `insert into fin_claim_items (claim_id, item_key, kind, expected_amount, settled_amount, claimed_amount, reason_text) values ('${ids.c}', 'pendent:${ids.k1}', 'pendent_liquidacio', 100, 0, 100, 'Activat i no liquidat')`);
  });
  it("no es pot enviar (ni registrar com a enviada fora) sense autorització", async () => {
    expect(await h.fails("B", `update fin_claims set status='enviada' where id='${ids.c}'`)).toMatch(/autoritzar/);
    expect(await h.fails("A", `update fin_claims set status='pendent_enviament' where id='${ids.c}'`)).toBeNull();
    expect(await h.fails("A", `update fin_claims set status='enviada' where id='${ids.c}'`)).toMatch(/autoritzar/);
  });
  it("Administració sense permís d'aprovació no pot autoritzar; qui la prepara tampoc (excepte Direcció)", async () => {
    expect(await h.fails("B", `update fin_claims set authorized_at=now() where id='${ids.c}'`)).toMatch(/aprovació/);
    await sys(`update user_permissions set can_approve = true where user_id='${U.B}' and module='economia'`);
    expect(await h.fails("B", `update fin_claims set authorized_at=now() where id='${ids.c}'`)).toMatch(/diferent/);
  });
  it("Direcció l'autoritza; si després es toca el correu o les diferències cal tornar-la a autoritzar", async () => {
    await h.as("A", `update fin_claims set authorized_at=now(), authorization_note='Revisada' where id='${ids.c}'`);
    expect((await sys<{ b: string }>(`select authorized_by::text b from fin_claims where id='${ids.c}'`))[0].b).toBe(U.A);
    await h.as("B", `update fin_claims set email_body='Text nou' where id='${ids.c}'`);
    expect((await sys<{ a: string | null }>(`select authorized_at::text a from fin_claims where id='${ids.c}'`))[0].a).toBeNull();
    await h.as("A", `update fin_claims set authorized_at=now() where id='${ids.c}'`);
    await h.as("B", `insert into fin_claim_items (claim_id, item_key, kind, expected_amount, settled_amount, claimed_amount, reason_text) values ('${ids.c}', 'pendent:${ids.k2}', 'pendent_liquidacio', 120, 0, 120, 'Activat i no liquidat')`);
    expect((await sys<{ a: string | null }>(`select authorized_at::text a from fin_claims where id='${ids.c}'`))[0].a).toBeNull();
  });
  it("amb autorització vigent s'envia; l'autorització ja no es pot canviar", async () => {
    await h.as("A", `update fin_claims set authorized_at=now() where id='${ids.c}'`);
    expect(await h.fails("B", `update fin_claims set status='enviada' where id='${ids.c}'`)).toBeNull();
    expect(await h.fails("A", `update fin_claims set authorized_at=now() - interval '1 day' where id='${ids.c}'`)).toMatch(/no es pot modificar/);
  });
});

describe("025 · alertes, idempotència i _down", () => {
  it("hi ha les set alertes de l'auditor", async () => {
    expect((await sys<{ key: string }>(`select key from crm_automation_rules where key like 'audit_%' order by key`)).map((r) => r.key)).toEqual([
      "audit_cobrada_parcial", "audit_cobrament_fora_termini", "audit_liquidacio_duplicada", "audit_liquidada_inferior", "audit_pendent_liquidar", "audit_retro_inesperada", "audit_sense_contracte",
    ]);
  });
  it("la 025 es pot tornar a aplicar i la comprovació retorna 6 · 15 · 1 · 1 · 3 · 2 · 7", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/025_auditor_comissions.sql`, "utf8"));
    const r = await h.db.query<{ total: number }>(fs.readFileSync(`${dir}/025_auditor_comissions.sql`, "utf8").split("-- ============================================================ COMPROVACIÓ")[1]);
    expect(r.rows.map((x) => Number(x.total))).toEqual([6, 15, 1, 1, 3, 2, 7]);
  });
  it("el _down treu l'obligació i la funció, i conserva l'historial de cobraments", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/025_auditor_comissions_down.sql`, "utf8"));
    expect((await sys<{ n: number }>(`select count(*)::int n from fin_receipt_allocations`))[0].n).toBeGreaterThan(0);
    expect((await sys<{ n: number }>(`select count(*)::int n from pg_proc where proname='fin_register_receipt_net'`))[0].n).toBe(0);
    await h.db.exec(fs.readFileSync(`${dir}/025_auditor_comissions.sql`, "utf8"));
  });
});
