/**
 * Fase 8.1 · 016 · Rol «Cap d'equip» i equips comercials sobre PostgreSQL real (PGlite, migracions 001-016).
 * Equip 1: Cap L amb els comercials C1 i C2 (+ un client sense comercial assignat a la cartera de l'equip).
 * Equip 2: Cap L2 amb el comercial C3.
 * Es comprova la RLS (no la interfície): visibilitat, assignacions, restriccions econòmiques i historial/auditoria.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const sys = async <T = Record<string, string>,>(sql: string) => (await h.db.query<T>(sql)).rows;


beforeAll(async () => {
  h = await setup(upTo("016"));
  // equips (Direcció)
  ids.t1 = (await h.as<{ id: string }>("A", `insert into crm_teams (name, lead_id) values ('Equip Lleida','${U.L}') returning id`)).rows[0].id;
  ids.t2 = (await h.as<{ id: string }>("A", `insert into crm_teams (name, lead_id) values ('Equip Girona','${U.L2}') returning id`)).rows[0].id;
  await h.as("A", `select crm_team_move('${U.C1}','${ids.t1}')`);
  await h.as("A", `select crm_team_move('${U.C2}','${ids.t1}')`);
  await h.as("A", `select crm_team_move('${U.C3}','${ids.t2}')`);
  // cartera
  ids.c1 = (await sys<{ id: string }>(`insert into crm_clients (name, owner_id) values ('Forn C1','${U.C1}') returning id`))[0].id;
  ids.c2 = (await sys<{ id: string }>(`insert into crm_clients (name, owner_id) values ('Taller C2','${U.C2}') returning id`))[0].id;
  ids.c3 = (await sys<{ id: string }>(`insert into crm_clients (name, owner_id) values ('Hotel C3','${U.C3}') returning id`))[0].id;
  ids.cx = (await sys<{ id: string }>(`insert into crm_clients (name) values ('Client sense comercial') returning id`))[0].id;
  await h.as("A", `insert into crm_team_clients (team_id, client_id) values ('${ids.t1}','${ids.cx}')`);
  ids.k1 = (await sys<{ id: string }>(`insert into crm_contracts (client_id, retailer, status, owner_id) values ('${ids.c1}','Nufri','actiu','${U.C1}') returning id`))[0].id;
  ids.k3 = (await sys<{ id: string }>(`insert into crm_contracts (client_id, retailer, status, owner_id) values ('${ids.c3}','Naturgy','actiu','${U.C3}') returning id`))[0].id;
  ids.l1 = (await sys<{ id: string }>(`insert into crm_leads (name, owner_id, created_by) values ('Lead C1','${U.C1}','${U.C1}') returning id`))[0].id;
  ids.l3 = (await sys<{ id: string }>(`insert into crm_leads (name, owner_id, created_by) values ('Lead C3','${U.C3}','${U.C3}') returning id`))[0].id;
  ids.i1 = (await sys<{ id: string }>(`insert into crm_incidents (client_id, title, created_by) values ('${ids.c1}','Factura errònia','${U.C1}') returning id`))[0].id;
  ids.i3 = (await sys<{ id: string }>(`insert into crm_incidents (client_id, title, created_by) values ('${ids.c3}','Factura errònia','${U.C3}') returning id`))[0].id;
  ids.e1 = (await sys<{ id: string }>(`insert into crm_expedients (client_id, service, retailer, owner_id, created_by) values ('${ids.c1}','llum_empresa','Nufri','${U.C1}','${U.C1}') returning id`))[0].id;
  // economia: capa comercial (C1 i C3) i capa proveïdor (el que paga la comercialitzadora)
  await sys(`insert into fin_ledger (contract_id, client_id, layer, beneficiary_id, kind, amount, description, idempotency_key) values ('${ids.k1}','${ids.c1}','comercial','${U.C1}','meritacio', 120, 'Comissió C1', 'k1c')`);
  await sys(`insert into fin_ledger (contract_id, client_id, layer, beneficiary_id, kind, amount, description, idempotency_key) values ('${ids.k3}','${ids.c3}','comercial','${U.C3}','meritacio', 90, 'Comissió C3', 'k3c')`);
  await sys(`insert into fin_ledger (contract_id, client_id, layer, beneficiary_id, kind, amount, description, idempotency_key) values ('${ids.k1}','${ids.c1}','proveidor',null,'meritacio', 2000, 'Nufri paga', 'k1p')`);
  await sys(`insert into crm_contract_finance (contract_id, commission_eur) values ('${ids.k1}', 2000)`);
}, 180_000);

describe("016 · Cap d'equip: visibilitat de l'equip (RLS)", () => {
  it("el Cap d'equip no és staff ni té accés econòmic global", async () => {
    const r = (await h.as<{ s: boolean; f: boolean; a: boolean }>("L", `select is_staff() s, fin_staff('read') f, can_assign() a`)).rows[0];
    expect(r).toEqual({ s: false, f: false, a: false });
  });
  it("veu els clients dels seus comercials i la cartera de l'equip, però no els d'un altre equip", async () => {
    const seen = (await h.as<{ name: string }>("L", `select name from crm_clients order by name`)).rows.map((r) => r.name);
    expect(seen).toEqual(["Client sense comercial", "Forn C1", "Taller C2"]);
    expect(await h.count("L2", `select * from crm_clients`)).toBe(1);
    expect(await h.count("L", `select * from crm_clients where id='${ids.c3}'`)).toBe(0);
  });
  it("veu els contractes i expedients del seu equip (pendents de tramitació), no els d'altres", async () => {
    expect(await h.count("L", `select * from crm_contracts where id='${ids.k1}'`)).toBe(1);
    expect(await h.count("L", `select * from crm_contracts where id='${ids.k3}'`)).toBe(0);
    expect(await h.count("L", `select * from crm_expedients where id='${ids.e1}'`)).toBe(1);
    expect(await h.count("L2", `select * from crm_expedients where id='${ids.e1}'`)).toBe(0);
  });
  it("no pot editar clients (lectura) ni veure dades econòmiques del contracte", async () => {
    expect((await h.as("L", `update crm_clients set notes='x' where id='${ids.c1}' returning id`)).rows).toHaveLength(0);
    expect(await h.count("L", `select * from crm_contract_finance`)).toBe(0);
  });
});

describe("016 · Cap d'equip: leads, tasques, objectius i incidències", () => {
  it("veu els leads del seu equip i els pot reassignar dins l'equip, mai fora", async () => {
    expect(await h.count("L", `select * from crm_leads where id='${ids.l1}'`)).toBe(1);
    expect(await h.count("L", `select * from crm_leads where id='${ids.l3}'`)).toBe(0);
    expect((await h.as("L", `update crm_leads set owner_id='${U.C2}' where id='${ids.l1}' returning id`)).rows).toHaveLength(1);
    expect(await h.fails("L", `update crm_leads set owner_id='${U.C3}' where id='${ids.l1}'`)).toMatch(/row-level security|reassignar/);
    expect((await h.as("L", `update crm_leads set owner_id='${U.C3}' where id='${ids.l3}' returning id`)).rows).toHaveLength(0);
  });
  it("crea leads per al seu equip però no per a un altre", async () => {
    expect((await h.as("L", `insert into crm_leads (name, owner_id, created_by) values ('Nou','${U.C1}','${U.L}') returning id`)).rows).toHaveLength(1);
    expect(await h.fails("L", `insert into crm_leads (name, owner_id, created_by) values ('Nou','${U.C3}','${U.L}')`)).toMatch(/row-level security/);
  });
  it("assigna tasques als comercials del seu equip i les reassigna dins l'equip", async () => {
    const t = (await h.as<{ id: string }>("L", `insert into crm_tasks (title, assigned_to, created_by, client_id) values ('Trucar','${U.C1}','${U.L}','${ids.c1}') returning id`)).rows[0].id;
    expect(await h.fails("L", `insert into crm_tasks (title, assigned_to, created_by) values ('Trucar','${U.C3}','${U.L}')`)).toMatch(/row-level security/);
    const own = (await sys<{ id: string }>(`insert into crm_tasks (title, assigned_to, created_by) values ('De C1','${U.C1}','${U.C1}') returning id`))[0].id;
    expect((await h.as("L", `update crm_tasks set assigned_to='${U.C2}' where id='${own}' returning id`)).rows).toHaveLength(1);
    expect(await h.fails("L", `update crm_tasks set assigned_to='${U.C3}' where id='${t}'`)).toMatch(/row-level security|equip/);
  });
  it("gestiona objectius dels seus comercials, però no els propis ni els d'altres equips", async () => {
    expect((await h.as("L", `insert into crm_targets (user_id, period, metric, target) values ('${U.C2}','2026-11','mwh', 300) returning user_id`)).rows).toHaveLength(1);
    expect(await h.fails("L", `insert into crm_targets (user_id, period, metric, target) values ('${U.C3}','2026-11','mwh', 300)`)).toMatch(/row-level security/);
    expect(await h.fails("L", `insert into crm_targets (user_id, period, metric, target) values ('${U.L}','2026-11','mwh', 999)`)).toMatch(/row-level security/);
  });
  it("gestiona les incidències dels clients del seu equip", async () => {
    expect((await h.as("L", `update crm_incidents set status='en_curs' where id='${ids.i1}' returning id`)).rows).toHaveLength(1);
    expect((await h.as("L", `update crm_incidents set status='en_curs' where id='${ids.i3}' returning id`)).rows).toHaveLength(0);
  });
});

describe("016 · Cap d'equip: restriccions econòmiques i d'administració", () => {
  it("sense autorització no veu cap comissió; mai la capa del proveïdor", async () => {
    expect(await h.count("L", `select * from fin_ledger`)).toBe(0);
    expect(await h.count("L", `select * from fin_rules`)).toBe(0);
  });
  it("amb «comissions_equip» autoritzat per Direcció veu les comissions dels comercials del SEU equip (només capa comercial)", async () => {
    await h.as("A", `insert into user_permissions (user_id, module, can_read) values ('${U.L}','comissions_equip', true)`);
    const rows = (await h.as<{ layer: string; beneficiary_id: string }>("L", `select layer, beneficiary_id from fin_ledger`)).rows;
    expect(rows).toEqual([{ layer: "comercial", beneficiary_id: U.C1 }]);
    expect(await h.count("L2", `select * from fin_ledger`)).toBe(0); // L2 no té l'autorització
  });
  it("no pot aprovar liquidacions, crear equips, moure comercials, canviar rols ni permisos", async () => {
    expect(await h.fails("L", `insert into crm_teams (name, lead_id) values ('Pirata','${U.L}')`)).toMatch(/row-level security/);
    expect(await h.fails("L", `select crm_team_move('${U.C3}','${ids.t1}')`)).toMatch(/Direcció/);
    expect((await h.as("L", `update profiles set role='admin' where id='${U.L}' returning id`)).rows).toHaveLength(0);
    expect(await h.fails("L", `insert into user_permissions (user_id, module, can_read) values ('${U.L}','economia', true)`)).toMatch(/row-level security/);
    expect(await h.fails("L", `insert into fin_settlements (kind, beneficiary_id, period_from, period_to, created_by) values ('comercial','${U.C1}','2026-11-01','2026-11-30','${U.L}')`)).toMatch(/row-level security/);
  });
});

describe("016 · Equips: integritat, historial i auditoria", () => {
  it("el responsable ha de ser Cap d'equip i els membres, comercials", async () => {
    expect(await h.fails("A", `insert into crm_teams (name, lead_id) values ('X','${U.C1}')`)).toMatch(/Cap d'equip/);
    expect(await h.fails("A", `insert into crm_team_members (team_id, user_id) values ('${ids.t1}','${U.B}')`)).toMatch(/comercials/);
  });
  it("un comercial canvia d'equip sense perdre l'historial; la visibilitat segueix l'equip actual", async () => {
    await h.as("A", `select crm_team_move('${U.C2}','${ids.t2}','Reorganització')`);
    expect(await h.count("L", `select * from crm_clients where id='${ids.c2}'`)).toBe(0);
    expect(await h.count("L2", `select * from crm_clients where id='${ids.c2}'`)).toBe(1);
    const hist = await sys<{ team_id: string; left_at: string | null }>(`select team_id, left_at from crm_team_members where user_id='${U.C2}' order by joined_at`);
    expect(hist.map((x) => [x.team_id, x.left_at === null])).toEqual([[ids.t1, false], [ids.t2, true]]);
    // les dades del comercial no canvien de propietari
    expect((await sys<{ owner_id: string }>(`select owner_id from crm_clients where id='${ids.c2}'`))[0].owner_id).toBe(U.C2);
  });
  it("l'historial no es pot esborrar ni reescriure i tot queda a l'auditoria", async () => {
    expect(await h.fails("A", `delete from crm_team_members where user_id='${U.C2}'`)).toMatch(/historial/);
    expect(await h.fails("A", `update crm_team_members set team_id='${ids.t2}' where user_id='${U.C1}'`)).toMatch(/historial/);
    const acts = (await sys<{ action: string }>(`select action from sec_audit where entity like 'crm_team%' order by id`)).map((r) => r.action);
    expect(acts).toEqual(expect.arrayContaining(["equip_creat", "equip_alta_membre", "equip_baixa_membre", "equip_cartera_afegit"]));
    expect(acts.filter((a) => a === "equip_baixa_membre")).toHaveLength(1);
  });
  it("un comercial no pot ser a dos equips actius alhora", async () => {
    expect(await h.fails("A", `insert into crm_team_members (team_id, user_id) values ('${ids.t1}','${U.C3}')`)).toMatch(/duplicate key|unique/);
  });
  it("un comercial veu el seu equip; un altre comercial no veu equips aliens", async () => {
    expect(await h.count("C1", `select * from crm_teams`)).toBe(1);
    expect(await h.count("C1", `select * from crm_team_members`)).toBe(1);
  });
});

describe("016 · idempotència i reversió", () => {
  it("es pot aplicar dues vegades i desfer amb 016_equips_down.sql conservant les dades d'equips", async () => {
    const x = await setup(upTo("016"));
    const t = (await x.as<{ id: string }>("A", `insert into crm_teams (name, lead_id) values ('Equip','${U.L}') returning id`)).rows[0].id;
    await x.as("A", `select crm_team_move('${U.C1}','${t}')`);
    await x.db.exec(fs.readFileSync(`${dir}/016_equips.sql`, "utf8"));                 // segona vegada: sense errors
    expect((await x.db.query(`select * from crm_team_members`)).rows).toHaveLength(1);
    await x.db.exec(`update profiles set role='comercial' where role='cap_equip'`);
    await x.db.exec(fs.readFileSync(`${dir}/016_equips_down.sql`, "utf8"));
    const def = (await x.db.query<{ d: string }>(`select pg_get_functiondef('public.crm_can_see_client(uuid)'::regprocedure) d`)).rows[0].d;
    expect(def).not.toMatch(/crm_team/);
    expect((await x.db.query(`select * from crm_teams`)).rows).toHaveLength(1);       // dades conservades
    expect(await x.fails("A", `update profiles set role='cap_equip' where id='${U.C2}'`)).toMatch(/check constraint/);
    await x.db.exec(fs.readFileSync(`${dir}/016_equips.sql`, "utf8"));                 // i es pot tornar a aplicar
  }, 180_000);
});
