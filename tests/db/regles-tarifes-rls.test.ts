/**
 * Fase 10.1 · 022 · Biblioteca de regles del lector de tarifes sobre PostgreSQL real (PGlite, migracions 001-022).
 * Qui pot proposar, qui pot aprovar, una sola regla aprovada per clau i res no s'esborra. Dades fictícies.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const rule = (m: string, r = '{"mode":"horari","windows":[{"days":"dl_dv","from":0,"to":8}]}') =>
  `insert into tariff_rule_library (supplier, product, access_tariff, modality, rule, source, created_by) values ('Endesa','Open','3.0TD','${m}','${r}','xat', auth.uid()) returning id, status`;

beforeAll(async () => { h = await setup(upTo("022")); }, 240_000);

describe("022 · biblioteca de regles de tarifes", () => {
  it("l'administració proposa (sempre queda «proposada»); comercials i col·laboradors no hi tenen accés", async () => {
    const r = (await h.as<{ id: string; status: string }>("B", rule("nit").replace("source, created_by)", "source, created_by, status)").replace("'xat', auth.uid())", "'xat', auth.uid(), 'aprovada')"))).rows[0];
    expect(r.status).toBe("proposada"); // no es pot autoaprovar
    expect(await h.fails("C1", rule("dia"))).toMatch(/row-level security/);
    expect(await h.count("C1", "select * from tariff_rule_library")).toBe(0);
    expect(await h.count("K", "select * from tariff_rule_library")).toBe(0);
    expect(await h.count("B", "select * from tariff_rule_library")).toBe(1);
  });
  it("només Direcció aprova; una sola regla aprovada per clau", async () => {
    const id = (await h.as<{ id: string }>("B", "select id from tariff_rule_library where modality='nit'")).rows[0].id;
    expect(await h.count("B", `update tariff_rule_library set status='aprovada' where id='${id}' returning id`)).toBe(0);
    await h.as("A", `update tariff_rule_library set status='aprovada' where id='${id}'`);
    const row = (await h.db.query<{ status: string; decided_at: string | null }>(`select status, decided_at from tariff_rule_library where id='${id}'`)).rows[0];
    expect(row.status).toBe("aprovada");
    expect(row.decided_at).not.toBeNull();
    const id2 = (await h.as<{ id: string }>("B", rule("nit", '{"mode":"horari","windows":[{"days":"tots","from":0,"to":8}]}'))).rows[0].id;
    expect(await h.fails("A", `update tariff_rule_library set status='aprovada' where id='${id2}'`)).toMatch(/duplicate|unique/);
    await h.as("A", `update tariff_rule_library set status='substituida' where id='${id}'`);
    await h.as("A", `update tariff_rule_library set status='aprovada' where id='${id2}'`);
    expect((await h.db.query<{ n: number }>(`select count(*)::int n from tariff_rule_library where status='aprovada'`)).rows[0].n).toBe(1);
  });
  it("una regla no es reescriu ni s'esborra", async () => {
    const id = (await h.as<{ id: string }>("A", "select id from tariff_rule_library where status='aprovada'")).rows[0].id;
    expect(await h.fails("A", `update tariff_rule_library set rule='{"mode":"plana"}' where id='${id}'`)).toMatch(/proposa/);
    expect(await h.count("A", `delete from tariff_rule_library where id='${id}' returning id`)).toBe(0);
    expect((await h.db.query<{ n: number }>("select count(*)::int n from tariff_rule_library")).rows[0].n).toBe(2);
  });
});
