/**
 * 029 · Agrupació per contacte sobre PostgreSQL real (PGlite, migracions 001-029). Dades fictícies.
 * Prova 12 (accés als contractes relacionats), 13 (comercials i col·laboradors), 10 (històric) i 15 (sense duplicats).
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const OP1 = "11111111-1111-4111-8111-111111111111", OP2 = "22222222-2222-4222-8222-222222222222", OP3 = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  h = await setup(upTo("029"));
  const ct = (id: string, comercial: string, cif: string, extra = "") => `('${id}', 'ES0021000000000000${id.slice(-2)}AA', '${comercial}', '{"cif":"${cif}","cliente":"Titular ${id}"${extra}}', 'h')`;
  await sys(`insert into contracts (id, cups, comercial, data, source_hash) values ${[ct("k01", "C1", "B11111111"), ct("k02", "C1", "H22222222"), ct("k03", "C2", "B33333333"), ct("k04", "C2", "B11111111")].join(",")}`);
  await sys(`update contracts set captador = 'K' where id = 'k02'`);
}, 240_000);

describe("029 · decisions d'unir i separar", () => {
  it("un comercial uneix dos contractes seus; queda qui i quan, i l'ordre es normalitza", async () => {
    await h.as("C1", `insert into renewal_contact_links (kind, contract_a, contract_b, created_by) values ('unir', 'k02', 'k01', '${U.C1}')`);
    const r = (await sys<{ a: string; b: string; n: string }>(`select contract_a a, contract_b b, created_by_name n from renewal_contact_links`))[0];
    expect(r).toEqual({ a: "k01", b: "k02", n: "C1" });
  });
  it("no pot unir un contracte d'un altre comercial (ni en sap l'existència)", async () => {
    expect(await h.fails("C1", `insert into renewal_contact_links (kind, contract_a, contract_b, created_by) values ('unir', 'k01', 'k03', '${U.C1}')`)).toMatch(/row-level security/);
    expect(await h.count("C2", `select * from renewal_contact_links`)).toBe(0);
    expect(await h.count("A", `select * from renewal_contact_links`)).toBe(1);
  });
  it("no hi pot haver dues decisions actives sobre la mateixa parella; es revoca, no s'esborra", async () => {
    expect(await h.fails("C1", `insert into renewal_contact_links (kind, contract_a, contract_b, created_by) values ('separar', 'k01', 'k02', '${U.C1}')`)).toMatch(/duplicate|unique/);
    await h.as("C1", `update renewal_contact_links set revoked_at = now() where contract_a = 'k01' and contract_b = 'k02'`);
    expect((await sys<{ by: string }>(`select revoked_by::text by from renewal_contact_links`))[0].by).toBe(U.C1);
    await h.as("C1", `insert into renewal_contact_links (kind, contract_a, contract_b, created_by) values ('separar', 'k01', 'k02', '${U.C1}')`);
    await h.as("C1", `delete from renewal_contact_links`);
    expect((await sys<{ n: number }>(`select count(*)::int n from renewal_contact_links`))[0].n).toBe(2);
    expect(await h.fails("C1", `update renewal_contact_links set kind = 'unir' where revoked_at is null`)).toMatch(/no es pot modificar/);
  });
  it("el col·laborador no pot crear decisions encara que vegi el contracte", async () => {
    expect(await h.count("K", `select * from contracts where id = 'k02'`)).toBe(1);
    expect(await h.fails("K", `insert into renewal_contact_links (kind, contract_a, contract_b, created_by) values ('unir', 'k02', 'k01', '${U.K}')`)).toMatch(/row-level security/);
  });
});

describe("029 · operacions conjuntes (històric i comunicacions)", () => {
  it("es registra una sola operació vinculada a diversos contractes; sense duplicats de contracte", async () => {
    await h.as("C1", `insert into renewal_group_ops (id, kind, channel, contract_ids, status, created_by) values ('${OP1}', 'trucada', 'telefon', array['k02','k01','k01'], 'registrat', '${U.C1}')`);
    expect((await sys<{ ids: string[]; n: string }>(`select contract_ids ids, created_by_name n from renewal_group_ops where id = '${OP1}'`))[0]).toEqual({ ids: ["k01", "k02"], n: "C1" });
  });
  it("el mateix identificador d'operació no es pot registrar dues vegades (clics repetits)", async () => {
    expect(await h.fails("C1", `insert into renewal_group_ops (id, kind, contract_ids, status, created_by) values ('${OP1}', 'trucada', array['k01'], 'registrat', '${U.C1}')`)).toMatch(/duplicate|unique/);
  });
  it("cap operació pot incloure un contracte inaccessible", async () => {
    expect(await h.fails("C1", `insert into renewal_group_ops (id, kind, contract_ids, status, created_by) values ('${OP2}', 'comunicacio', array['k01','k03'], 'preparat', '${U.C1}')`)).toMatch(/row-level security/);
  });
  it("una operació amb contractes que l'usuari no veu tots no es mostra (no revela comptadors)", async () => {
    await h.as("A", `insert into renewal_group_ops (id, kind, contract_ids, status, created_by) values ('${OP2}', 'comunicacio', array['k01','k03'], 'enviat', '${U.A}')`);
    expect(await h.count("C1", `select * from renewal_group_ops where id = '${OP2}'`)).toBe(0);
    expect(await h.count("C1", `select * from renewal_group_ops where id = '${OP1}'`)).toBe(1);
    expect(await h.count("B", `select * from renewal_group_ops`)).toBe(2);
  });
  it("estats: preparat → enviat; un enviat no torna enrere i un fallit no es pot marcar com a enviat", async () => {
    await h.as("C1", `insert into renewal_group_ops (id, kind, channel, contract_ids, status, body, created_by) values ('${OP3}', 'comunicacio', 'email', array['k01','k02'], 'preparat', 'Text', '${U.C1}')`);
    expect(await h.fails("C1", `update renewal_group_ops set body = 'canviat' where id = '${OP3}'`)).toMatch(/no es pot modificar/);
    await h.as("C1", `update renewal_group_ops set status = 'enviat' where id = '${OP3}'`);
    expect(await h.fails("C1", `update renewal_group_ops set status = 'preparat' where id = '${OP3}'`)).toMatch(/no pot tornar/);
    expect(await h.count("C2", `update renewal_group_ops set status = 'error' where id = '${OP1}' returning id`)).toBe(0);
  });
});

describe("029 · autoritzacions per titular", () => {
  it("es registra per a un titular visible i la veu qui veu algun contracte d'aquell titular", async () => {
    await h.as("C1", `insert into renewal_contact_authorizations (contact_key, holder_key, basis, granted_by) values ('tel:600112233', 'cif:B11111111', 'representacio', '${U.C1}')`);
    expect(await h.count("C2", `select * from renewal_contact_authorizations`)).toBe(1); // C2 veu k04 (mateix titular)
    expect(await h.fails("C1", `insert into renewal_contact_authorizations (contact_key, holder_key, basis, granted_by) values ('tel:600112233', 'cif:B33333333', 'representacio', '${U.C1}')`)).toMatch(/row-level security/);
    expect(await h.fails("C1", `insert into renewal_contact_authorizations (contact_key, holder_key, basis, granted_by) values ('tel:600112233', 'cif:B11111111', 'representacio', '${U.C1}')`)).toMatch(/duplicate|unique/);
    expect(await h.fails("C1", `insert into renewal_contact_authorizations (contact_key, holder_key, basis, granted_by) values ('telefon', 'cif:H22222222', 'altre', '${U.C1}')`)).toMatch(/check/);
  });
});

describe("029 · persona de contacte relacionada amb diversos clients (sense fusionar)", () => {
  it("es relaciona amb un altre client que l'usuari pot editar; la identitat de cada client es conserva", async () => {
    const c1 = (await h.as<{ id: string }>("C1", `insert into crm_clients (name, kind, tax_id, owner_id) values ('Comunitat Prova U', 'empresa', 'H60000001', '${U.C1}') returning id`)).rows[0].id;
    const c2 = (await h.as<{ id: string }>("C1", `insert into crm_clients (name, kind, tax_id, owner_id) values ('Comunitat Prova D', 'empresa', 'H60000002', '${U.C1}') returning id`)).rows[0].id;
    const c3 = (await h.as<{ id: string }>("C2", `insert into crm_clients (name, kind, tax_id, owner_id) values ('Empresa Prova Altre', 'empresa', 'B60000003', '${U.C2}') returning id`)).rows[0].id;
    const p = (await h.as<{ id: string }>("C1", `insert into crm_contacts (client_id, name, phone) values ('${c1}', 'Administrador Prova', '600112233') returning id`)).rows[0].id;
    await h.as("C1", `insert into crm_contact_clients (contact_id, client_id, authorized, basis, created_by) values ('${p}', '${c2}', true, 'representacio', '${U.C1}')`);
    expect(await h.fails("C1", `insert into crm_contact_clients (contact_id, client_id, created_by) values ('${p}', '${c3}', '${U.C1}')`)).toMatch(/row-level security/);
    expect(await h.fails("C1", `insert into crm_contact_clients (contact_id, client_id, created_by) values ('${p}', '${c1}', '${U.C1}')`)).toMatch(/ja és contacte/);
    expect(await h.count("C2", `select * from crm_contact_clients`)).toBe(0);
    const r = (await sys<{ s: string; cb: string | null }>(`select status s, confirmed_by::text cb from crm_contact_clients`))[0];
    expect(r).toEqual({ s: "confirmada", cb: U.C1 });
    expect((await sys<{ n: number }>(`select count(*)::int n from crm_clients where tax_id in ('H60000001','H60000002')`))[0].n).toBe(2); // fitxes separades
    await h.as("C1", `update crm_contact_clients set revoked_at = now()`);
    expect(await h.fails("C1", `update crm_contact_clients set authorized = false`)).toMatch(/ja està revocada/);
  });
});

describe("029 · idempotència i desfer", () => {
  it("es pot tornar a executar; el _down conserva les dades i es pot tornar a aplicar", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/029_agrupacio_contactes.sql`, "utf8"));
    const before = (await sys<{ n: number }>(`select count(*)::int n from renewal_group_ops`))[0].n;
    await h.db.exec(fs.readFileSync(`${dir}/029_agrupacio_contactes_down.sql`, "utf8"));
    expect((await sys<{ n: number }>(`select count(*)::int n from renewal_group_ops`))[0].n).toBe(before);
    expect(await h.count("A", `select * from renewal_group_ops`)).toBe(0);
    expect((await sys<{ n: number }>(`select count(*)::int n from contracts`))[0].n).toBe(4);
    await h.db.exec(fs.readFileSync(`${dir}/029_agrupacio_contactes.sql`, "utf8"));
    expect(await h.count("A", `select * from renewal_group_ops`)).toBe(before);
  });
});
