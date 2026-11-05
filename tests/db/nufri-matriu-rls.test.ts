/**
 * 031 · Matriu comercial Nufri sobre PostgreSQL real (PGlite): tipus de regla «energia_potencia» (€/MWh) i configuració
 * comercial congelada al contracte. Idempotent i reversible. Dades fictícies.
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const run = (f: string) => h.db.exec(fs.readFileSync(`${dir}/${f}`, "utf8"));

beforeAll(async () => {
  h = await setup(upTo("031"));
}, 240_000);

describe("031 · regles energia + potència i configuració comercial", () => {
  it("Direcció pot crear una regla «energia_potencia» en €/MWh; una unitat incorrecta es rebutja", async () => {
    await h.as("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit, status, created_by) values ('nufri_llum_gala', 'Nufri GALA', 'proveidor', 'energia_potencia', 10, 'eur_mwh', 'pendent_aprovacio', '${U.A}')`);
    expect(await h.fails("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit, status, created_by) values ('nufri_llum_fuji', 'Nufri FUJI', 'proveidor', 'energia_potencia', 2, 'eur', 'esborrany', '${U.A}')`)).toMatch(/check constraint/);
    // els tipus anteriors continuen funcionant
    await h.as("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit, status, created_by) values ('prova_mwh', 'Prova', 'proveidor', 'per_mwh', 3, 'eur_mwh', 'esborrany', '${U.A}')`);
    expect((await sys<{ n: number }>(`select count(*)::int n from fin_rules where rule_key in ('nufri_llum_gala', 'prova_mwh')`))[0].n).toBe(2);
  });
  it("la columna commercial existeix i la migració es pot tornar a executar", async () => {
    await run("031_nufri_matriu_comercial.sql");
    const c = await sys(`select column_name from information_schema.columns where table_name = 'fin_contract_economics' and column_name = 'commercial'`);
    expect(c).toHaveLength(1);
  });
  it("el _down s'atura si hi ha regles energia_potencia (no esborra res); sense elles, restaura la v2", async () => {
    await expect(run("031_nufri_matriu_comercial_down.sql")).rejects.toThrow(/energia_potencia/);
    await sys(`delete from fin_rules where kind = 'energia_potencia'`);
    await run("031_nufri_matriu_comercial_down.sql");
    expect((await sys<{ conname: string }>(`select conname from pg_constraint where conname ~ '^fin_rules_(kind|unit)_v[0-9]$' order by 1`)).map((r) => r.conname)).toEqual(["fin_rules_kind_v2", "fin_rules_unit_v2"]);
    await run("031_nufri_matriu_comercial.sql");
    expect((await sys<{ conname: string }>(`select conname from pg_constraint where conname ~ '^fin_rules_(kind|unit)_v[0-9]$' order by 1`)).map((r) => r.conname)).toEqual(["fin_rules_kind_v3", "fin_rules_unit_v3"]);
  });
});
