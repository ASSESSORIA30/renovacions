/**
 * Fase 11 · 023 · Plantilles de lectura IA sobre PostgreSQL real (PGlite, migracions 001-023). Dades fictícies.
 * Qui crea, qui verifica (només Direcció), versions immutables, recuperació en una sessió nova i res no s'esborra.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let id = "";
const def = '{"schema":1,"supplier":"Naturgy","name":"Captación PYMES Excel","blocks":[]}';
beforeAll(async () => { h = await setup(upTo("023")); }, 240_000);

describe("023 · plantilles de lectura", () => {
  it("l'administració crea la plantilla i la versió 1; comercials i col·laboradors no hi accedeixen", async () => {
    id = (await h.as<{ id: string }>("B", `insert into tariff_templates (supplier, name, created_by) values ('Naturgy','Captación PYMES Excel', auth.uid()) returning id`)).rows[0].id;
    await h.as("B", `insert into tariff_template_versions (template_id, version, definition) values ('${id}', 1, '${def}')`);
    expect(await h.fails("C1", `insert into tariff_templates (supplier, name) values ('X','Y')`)).toMatch(/row-level security/);
    expect(await h.count("C1", "select * from tariff_templates")).toBe(0);
    expect(await h.count("K", "select * from tariff_template_versions")).toBe(0);
  });
  it("es recupera en una sessió nova (un altre usuari de l'administració)", async () => {
    const r = (await h.as<{ name: string; definition: { supplier: string } }>("A", `select t.name, v.definition from tariff_templates t join tariff_template_versions v on v.template_id = t.id where t.id='${id}'`)).rows[0];
    expect(r.name).toBe("Captación PYMES Excel");
    expect(r.definition.supplier).toBe("Naturgy");
  });
  it("només Direcció la pot verificar, i només amb una versió existent", async () => {
    expect(await h.fails("B", `update tariff_templates set status='verificada', verified_version=1 where id='${id}'`)).toMatch(/Només Direcció/);
    expect(await h.fails("A", `update tariff_templates set status='verificada', verified_version=7 where id='${id}'`)).toMatch(/versió existent/);
    await h.as("A", `update tariff_templates set status='verificada', verified_version=1 where id='${id}'`);
    const t = (await h.db.query<{ status: string; verified_at: string | null }>(`select status, verified_at from tariff_templates where id='${id}'`)).rows[0];
    expect(t.status).toBe("verificada");
    expect(t.verified_at).not.toBeNull();
    expect(await h.fails("B", `insert into tariff_templates (supplier, name, status, verified_version) values ('X','Y','verificada',1)`)).toMatch(/row-level security|Només Direcció/);
  });
  it("les versions són immutables i no s'esborra res", async () => {
    expect(await h.count("A", `update tariff_template_versions set definition='{}' where template_id='${id}' returning version`)).toBe(0);
    expect(await h.count("A", `delete from tariff_template_versions where template_id='${id}' returning version`)).toBe(0);
    expect(await h.count("A", `delete from tariff_templates where id='${id}' returning id`)).toBe(0);
    expect(await h.fails("B", `insert into tariff_template_versions (template_id, version, definition) values ('${id}', 1, '{}')`)).toMatch(/duplicate|unique/);
  });
  it("lectures i correccions queden registrades (biblioteca de coneixement)", async () => {
    await h.as("B", `insert into tariff_template_reads (template_id, version, file_name, status, summary) values ('${id}', 1, 'naturgy.xlsx', 'compatible', '{"stats":{"fields":10}}')`);
    await h.as("B", `insert into tariff_template_corrections (template_id, version, instruction, ops, created_by) values ('${id}', 2, 'Aquest producte és fix', '[{"op":"setClassification"}]', auth.uid())`);
    expect(await h.count("A", `select * from tariff_template_reads where template_id='${id}'`)).toBe(1);
    expect(await h.count("A", `select * from tariff_template_corrections where template_id='${id}'`)).toBe(1);
    expect(await h.fails("C1", `insert into tariff_template_reads (template_id, version, file_name, status) values ('${id}', 1, 'x', 'compatible')`)).toMatch(/row-level security/);
  });
});
