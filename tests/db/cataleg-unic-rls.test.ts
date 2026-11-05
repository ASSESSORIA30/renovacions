/**
 * 030 · Catàleg únic sobre PostgreSQL real (PGlite): còpia de seguretat de `offers`, taula en només lectura i cap pèrdua
 * de comparatives, documents ni propostes (proves 10 i 11). Dades fictícies.
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const n = async (sql: string) => (await sys<{ n: number }>(`select count(*)::int n from ${sql}`))[0].n;

beforeAll(async () => {
  h = await setup(upTo("028"));
  await sys(`insert into offers (id, data, verificada, valida_hasta) values ('of-1', '{"id":"of-1","nombre":"Antiga"}', true, '2099-12-31'), ('of-2', '{"id":"of-2","nombre":"Antiga 2"}', false, '2020-01-01')`);
  await sys(`insert into comparisons (mode, engine_version, snapshot, status, created_by_name) values ('manual', 'x', '{"offers":[{"id":"crm:of-1"}]}', 'emesa', 'Prova')`);
  await sys(`insert into contracts (id, cups, comercial, data, source_hash) values ('k1', 'ES0021000000000000001AA', 'C1', '{}', 'h')`);
  await sys(`insert into documents (id, contract_id, version, file_name, storage_path, created_by) values ('00000000-0000-4000-8000-000000000001', 'k1', 1, 'Proposta.pdf', 'k1/x.pdf', 'Prova')`);
  await h.db.exec(fs.readFileSync(`${dir}/030_cataleg_unic.sql`, "utf8"));
}, 240_000);

describe("030 · retirada segura de «Propostes»", () => {
  it("fa una còpia de seguretat completa abans de restringir res", async () => {
    expect(await n("offers_backup_030")).toBe(2);
    // la còpia no és accessible des del navegador (sense permís o sense cap fila visible per la RLS)
    const r = await h.fails("A", "select * from offers_backup_030") ?? String(await h.count("A", "select * from offers_backup_030"));
    expect(r).toMatch(/permission denied|^0$/);
  });
  it("les ofertes antigues es poden llegir però ningú les pot crear, modificar ni esborrar", async () => {
    expect(await h.count("C1", "select * from offers")).toBe(2);
    expect(await h.fails("A", `insert into offers (id, data, verificada, valida_hasta) values ('of-3', '{}', true, '2099-12-31')`)).toMatch(/row-level security/);
    expect(await h.count("B", "update offers set verificada = false returning id")).toBe(0);
    expect(await h.count("A", "delete from offers returning id")).toBe(0);
    expect(await n("offers")).toBe(2);
  });
  it("11 · no desapareix cap comparativa, document ni contracte", async () => {
    expect(await n("comparisons")).toBe(1);
    expect(await n("documents")).toBe(1);
    expect(await n("contracts")).toBe(1);
  });
  it("es pot tornar a executar sense refer la còpia, i el _down torna a permetre l'escriptura sense perdre dades", async () => {
    await sys(`insert into offers (id, data, verificada, valida_hasta) values ('of-sys', '{}', true, '2099-12-31')`);
    await h.db.exec(fs.readFileSync(`${dir}/030_cataleg_unic.sql`, "utf8"));
    expect(await n("offers_backup_030")).toBe(2);
    await h.db.exec(fs.readFileSync(`${dir}/030_cataleg_unic_down.sql`, "utf8"));
    await h.as("A", `update offers set verificada = false where id = 'of-sys'`);
    expect(await n("offers_backup_030")).toBe(2);
    await h.db.exec(fs.readFileSync(`${dir}/030_cataleg_unic.sql`, "utf8"));
    expect(await h.count("A", "update offers set verificada = true returning id")).toBe(0);
  });
});
