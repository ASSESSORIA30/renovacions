/**
 * 059 · Càlcul automàtic de comissions sobre PostgreSQL real (PGlite): additiva i idempotent, només lectura per a
 * Direcció/Administració, ningú hi escriu des del navegador, i la reversió no toca cap dada econòmica existent.
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const run = (f: string) => h.db.exec(fs.readFileSync(`${dir}/${f}`, "utf8"));
const tables = async () => (await h.db.query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_name in ('fin_calc_pending', 'fin_regularization_runs', 'fin_regularization_items') order by 1`)).rows.map((r) => r.t);

beforeAll(async () => {
  h = await setup(upTo("058"));
  await run("059_calcul_automatic_comissions.sql"); await run("059_calcul_automatic_comissions.sql");   // idempotent
  await h.db.exec(`grant all on all tables in schema public to authenticated;`);
  await h.db.exec(`insert into fin_regularization_runs (mode, status) values ('dry_run', 'completat')`);
}, 300_000);

describe("059", () => {
  it("crea només les tres taules de registre, amb les restriccions de seguretat", async () => {
    expect(await tables()).toEqual(["fin_calc_pending", "fin_regularization_items", "fin_regularization_runs"]);
    await expect(h.db.exec(`insert into fin_regularization_runs (mode) values ('apply')`)).rejects.toThrow(/check/);   // una aplicació sempre es basa en una revisió
  });
  it("RLS: Direcció llegeix; comercials i col·laboradors no veuen res; ningú hi escriu des del navegador", async () => {
    expect(await h.count("A", `select id from fin_regularization_runs`)).toBe(1);
    expect(await h.count("C1", `select id from fin_regularization_runs`)).toBe(0);
    expect(await h.count("K", `select id from fin_regularization_runs`)).toBe(0);
    expect(await h.fails("A", `insert into fin_regularization_runs (mode, status) values ('dry_run', 'en_curs')`)).toMatch(/row-level security/);
    expect(await h.fails("C1", `insert into fin_calc_pending (contract_id) values (gen_random_uuid())`)).toMatch(/row-level security/);
  });
  it("reversió idempotent i reaplicable; les taules econòmiques existents es conserven", async () => {
    await run("059_calcul_automatic_comissions_down.sql"); await run("059_calcul_automatic_comissions_down.sql");
    expect(await tables()).toEqual([]);
    expect((await h.db.query(`select 1 from information_schema.tables where table_schema = 'public' and table_name in ('fin_calculations', 'fin_ledger', 'fin_payments', 'fin_settlements')`)).rows).toHaveLength(4);
    await run("059_calcul_automatic_comissions.sql");
    expect(await tables()).toHaveLength(3);
  });
});
