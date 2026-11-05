/**
 * Fase 12 · 024 · Regles de lectura apreses i exemples validats sobre PostgreSQL real (PGlite, migracions 001-024).
 * Dades fictícies (cap preu ni document real). Es comprova: persistència en una sessió nova, que només Direcció
 * aprova, que una regla no es reescriu, que comercials i col·laboradors no hi accedeixen i que la 022 continua igual.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let tpl = "";
let ruleId = "";
const rule = '{"id":"xat:prova-1","title":"Producte de prova: P1–P5 promocionat","scope":"producte","match":{"product":"Producte de prova"},"set":{"mapping":["B","B","B","B","B","A"]},"explanation":"Exemple fictici","source":"xat","approved":false}';
beforeAll(async () => { h = await setup(upTo("024")); }, 240_000);

describe("024 · lector universal: regles apreses i exemples", () => {
  it("l'administració desa una regla de LECTURA (amb plantilla, abast, columnes i exemple) i queda PROPOSADA", async () => {
    tpl = (await h.as<{ id: string }>("B", `insert into tariff_templates (supplier, name, created_by) values ('Comercialitzadora de prova','Full de preus', auth.uid()) returning id`)).rows[0].id;
    await h.as("B", `insert into tariff_template_versions (template_id, version, definition) values ('${tpl}', 1, '{"schema":1,"layout":"taula","rules":[]}')`);
    ruleId = (await h.as<{ id: string; status: string }>("B", `insert into tariff_rule_library (kind, supplier, product, rule, source, status, template_id, template_version, scope, columns, example, created_by)
      values ('lectura','Comercialitzadora de prova','xat:prova-1','${rule}','xat','aprovada','${tpl}',2,'producte','{I,J}','{"expected":[0.1,0.1,0.1,0.1,0.1,0.2]}', auth.uid()) returning id, status`)).rows[0].id;
    const r = (await h.db.query<{ status: string; scope: string; columns: string[] }>(`select status, scope, columns from tariff_rule_library where id='${ruleId}'`)).rows[0];
    expect(r.status).toBe("proposada"); // no és Direcció: queda proposada encara que demani «aprovada»
    expect(r.scope).toBe("producte");
    expect(r.columns).toEqual(["I", "J"]);
  });
  it("es recupera en una sessió nova i comercials i col·laboradors no la veuen", async () => {
    expect(await h.count("A", `select * from tariff_rule_library where kind='lectura' and template_id='${tpl}'`)).toBe(1);
    expect(await h.count("C1", "select * from tariff_rule_library")).toBe(0);
    expect(await h.count("K", "select * from tariff_template_examples")).toBe(0);
    expect(await h.fails("C1", `insert into tariff_rule_library (kind, supplier, product, rule, created_by) values ('lectura','X','Y','{}', auth.uid())`)).toMatch(/row-level security/);
  });
  it("només Direcció l'aprova; la regla, l'abast i l'exemple no es poden reescriure", async () => {
    expect(await h.count("B", `update tariff_rule_library set status='aprovada' where id='${ruleId}' returning id`)).toBe(0);
    await h.as("A", `update tariff_rule_library set status='aprovada', decided_by_name='Direcció' where id='${ruleId}'`);
    const r = (await h.db.query<{ status: string; decided_at: string | null }>(`select status, decided_at from tariff_rule_library where id='${ruleId}'`)).rows[0];
    expect(r.status).toBe("aprovada");
    expect(r.decided_at).not.toBeNull();
    expect(await h.fails("A", `update tariff_rule_library set scope='general' where id='${ruleId}'`)).toMatch(/no es modifica/);
    expect(await h.fails("A", `update tariff_rule_library set example='{}' where id='${ruleId}'`)).toMatch(/no es modifica/);
    expect(await h.count("A", `delete from tariff_rule_library where id='${ruleId}' returning id`)).toBe(0);
  });
  it("exemples validats: l'administració els crea, Direcció els aprova, el contingut és immutable i no s'esborren", async () => {
    const ex = (await h.as<{ id: string; status: string }>("B", `insert into tariff_template_examples (template_id, version, product_key, product_name, row_number, expected, explanation, explained, rule, status, created_by)
      values ('${tpl}', 2, 'producte de prova', 'Producte de prova', 10, '[0.1,0.1,0.1,0.1,0.1,0.2]', 'Exemple fictici', true, '${rule}', 'aprovat', auth.uid()) returning id, status`)).rows[0];
    expect(ex.status).toBe("proposat");
    expect(await h.count("B", `update tariff_template_examples set status='aprovat' where id='${ex.id}' returning id`)).toBe(0);
    await h.as("A", `update tariff_template_examples set status='aprovat' where id='${ex.id}'`);
    expect(await h.fails("A", `update tariff_template_examples set expected='[1]' where id='${ex.id}'`)).toMatch(/no es modifica/);
    expect(await h.count("A", `delete from tariff_template_examples where id='${ex.id}' returning id`)).toBe(0);
  });
  it("lectures amb pestanya i recompte; la biblioteca de la 022 (Endesa Open) continua acceptant modalitats", async () => {
    await h.as("B", `insert into tariff_template_reads (template_id, version, file_name, status, summary, sheet, counts) values ('${tpl}', 2, 'preus.xlsx', 'compatible', '{}', 'Energía', '{"identified":3,"interpreted":2,"review":1,"pending":0,"failed":0}')`);
    const r = (await h.db.query<{ sheet: string; counts: { identified: number } }>(`select sheet, counts from tariff_template_reads where template_id='${tpl}'`)).rows[0];
    expect(r.sheet).toBe("Energía");
    expect(r.counts.identified).toBe(3);
    await h.as("B", `insert into tariff_rule_library (kind, supplier, product, modality, rule, created_by) values ('modalitat','Endesa','Tarifa Open','nit','{"mode":"plana"}', auth.uid())`);
    expect(await h.fails("B", `insert into tariff_rule_library (kind, supplier, product, rule, created_by) values ('altres','X','Y','{}', auth.uid())`)).toMatch(/check/);
  });
});
