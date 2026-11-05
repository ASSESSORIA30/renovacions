/**
 * Fase 9 · 019 sobre PostgreSQL real (PGlite, migracions 001-019): representant legal, esborranys de comparatives
 * (un per persona i context, versió per conflictes, permisos) i registres recents (només del propietari). Dades fictícies.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;

beforeAll(async () => {
  h = await setup(upTo("019"));
  ids.c1 = (await sys<{ id: string }>(`insert into crm_clients (name, kind, owner_id) values ('EMPRESA FICTÍCIA SL', 'empresa', '${U.C1}') returning id`))[0].id;
  ids.c2 = (await sys<{ id: string }>(`insert into crm_clients (name, kind, owner_id) values ('ALTRA FICTÍCIA SL', 'empresa', '${U.C2}') returning id`))[0].id;
}, 180_000);

describe("019 · representant legal", () => {
  it("es desa amb el càrrec i el DNI/NIE validat", async () => {
    await h.as("A", `update crm_clients set contact_role='Gerent', legal_rep_name='Persona Fictícia', legal_rep_tax_id='00000000T', legal_rep_role='administrador', contact_is_legal_rep=false where id='${ids.c1}'`);
    expect((await sys<{ r: string }>(`select legal_rep_role r from crm_clients where id='${ids.c1}'`))[0].r).toBe("administrador");
    expect(await h.fails("A", `update crm_clients set legal_rep_tax_id='12345' where id='${ids.c1}'`)).toMatch(/legal_rep_tax_chk/);
    expect(await h.fails("A", `update crm_clients set legal_rep_role='president' where id='${ids.c1}'`)).toMatch(/legal_rep_role_chk/);
  });
});

describe("019 · esborranys de comparatives", () => {
  it("un sol esborrany obert per persona i context; la versió puja amb cada canvi", async () => {
    ids.d1 = (await h.as<{ id: string }>("C1", `insert into comparison_drafts (context_key, crm_client_id, state, created_by) values ('client:${ids.c1}', '${ids.c1}', '{"step":1}', '${U.C1}') returning id`)).rows[0].id;
    expect(await h.fails("C1", `insert into comparison_drafts (context_key, crm_client_id, state, created_by) values ('client:${ids.c1}', '${ids.c1}', '{}', '${U.C1}')`)).toMatch(/duplicate|unique/);
    await h.as("C1", `update comparison_drafts set state='{"step":2,"preu":0.1}' where id='${ids.d1}'`);
    expect((await sys<{ v: number }>(`select version v from comparison_drafts where id='${ids.d1}'`))[0].v).toBe(2);
  });
  it("permisos: l'autor, Administració i qui veu el client; un altre comercial i els col·laboradors no", async () => {
    expect(await h.count("C1", `select * from comparison_drafts`)).toBe(1);
    expect(await h.count("B", `select * from comparison_drafts`)).toBe(1);
    expect(await h.count("C2", `select * from comparison_drafts`)).toBe(0);
    expect(await h.count("K", `select * from comparison_drafts`)).toBe(0);
    expect(await h.fails("C2", `insert into comparison_drafts (context_key, crm_client_id, state, created_by) values ('client:${ids.c1}', '${ids.c1}', '{}', '${U.C2}')`)).toMatch(/row-level security/);
    expect(await h.fails("C2", `insert into comparison_drafts (context_key, state, created_by) values ('cups:X', '{}', '${U.C1}')`)).toMatch(/row-level security/);   // no pot crear-ne en nom d'un altre
  });
  it("un esborrany tancat no es modifica i l'autor no es pot canviar", async () => {
    await h.as("C1", `update comparison_drafts set status='finalitzat' where id='${ids.d1}'`);
    expect(await h.fails("C1", `update comparison_drafts set state='{"x":1}' where id='${ids.d1}'`)).toMatch(/ja està tancat/);
    expect(await h.fails("A", `update comparison_drafts set created_by='${U.A}' where id='${ids.d1}'`)).toMatch(/no es poden canviar/);
    // tancat l'anterior, se'n pot obrir un de nou per al mateix context
    await h.as("C1", `insert into comparison_drafts (context_key, crm_client_id, state, created_by) values ('client:${ids.c1}', '${ids.c1}', '{}', '${U.C1}')`);
  });
});

describe("019 · registres recents", () => {
  it("cadascú només veu els seus", async () => {
    await h.as("C1", `insert into user_recent_records (user_id, kind, ref_id, label) values ('${U.C1}', 'client', '${ids.c1}', 'EMPRESA FICTÍCIA SL')`);
    await h.as("C1", `insert into user_recent_records (user_id, kind, ref_id, label) values ('${U.C1}', 'client', '${ids.c1}', 'EMPRESA FICTÍCIA SL') on conflict (user_id, kind, ref_id) do update set visited_at = now()`);
    expect(await h.count("C1", `select * from user_recent_records`)).toBe(1);
    expect(await h.count("A", `select * from user_recent_records`)).toBe(0);
    expect(await h.fails("C2", `insert into user_recent_records (user_id, kind, ref_id, label) values ('${U.C1}', 'client', 'x', 'x')`)).toMatch(/row-level security/);
  });
});

describe("019 · idempotència i desfer", () => {
  it("es pot tornar a executar; el _down conserva les dades", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/019_navegacio_360.sql`, "utf8"));
    const n = (await sys<{ n: number }>(`select count(*)::int n from comparison_drafts`))[0].n;
    await h.db.exec(fs.readFileSync(`${dir}/019_navegacio_360_down.sql`, "utf8"));
    expect((await sys<{ n: number }>(`select count(*)::int n from comparison_drafts`))[0].n).toBe(n);
    expect(await h.count("C1", `select * from comparison_drafts`)).toBe(0);
    await h.db.exec(fs.readFileSync(`${dir}/019_navegacio_360.sql`, "utf8"));
    expect(await h.count("C1", `select * from comparison_drafts`)).toBe(n);
  });
});
