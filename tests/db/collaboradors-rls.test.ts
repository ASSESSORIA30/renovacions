/**
 * 027 · Col·laboradors sobre PostgreSQL real (PGlite, migracions 001-027). Dades fictícies.
 * DNI únic, nivells per defecte, regles de percentatge amb versions (l'anterior es tanca sola), aprovació només de Direcció,
 * i que un col·laborador no veu fitxes ni percentatges d'altres.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { U, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const rule = (v: string, version: number, from: string, status = "aprovada") =>
  `insert into fin_rules (rule_key, version, name, layer, beneficiary_id, kind, value, unit, base_formula, base_validated, valid_from, status) values ('collab_${U.K.replace(/-/g, "").slice(0, 16)}', ${version}, 'Col·laborador · prova · general', 'collaborador', '${U.K}', 'pct_comissio_rebuda', ${v}, 'pct', 'Comissió rebuda', true, '${from}', '${status}')`;

beforeAll(async () => {
  h = await setup(upTo("027"));
  await sys(`update profiles set role = 'colaborador' where id = '${U.K}'`);
}, 240_000);

describe("027 · fitxa i importació", () => {
  it("el DNI/CIF no es pot repetir (normalitzat) i s'hi poden guardar les dades noves", async () => {
    await sys(`insert into cap_partners (name, tax_id, person_kind, classification, source_label) values ('Persona Prova', '12345678-z', 'fisica', 'collaborador', 'Comercial')`);
    await expect(sys(`insert into cap_partners (name, tax_id) values ('Una altra', '12345678Z')`)).rejects.toThrow(/duplicate|unique/);
    expect((await sys<{ tax_id_norm: string }>(`select tax_id_norm from cap_partners where name = 'Persona Prova'`))[0].tax_id_norm).toBe("12345678Z");
    await expect(sys(`insert into cap_partners (name, classification) values ('X', 'administrador')`)).rejects.toThrow(/check/);
  });
  it("els lots d'importació només els veu l'equip intern", async () => {
    await sys(`insert into cap_partner_imports (file_name, rows_total) values ('prova.xlsx', 20)`);
    expect(await h.count("A", `select * from cap_partner_imports`)).toBe(1);
    expect(await h.count("C1", `select * from cap_partner_imports`)).toBe(0);
    expect(await h.count("K", `select * from cap_partner_imports`)).toBe(0);
  });
  it("nivells per defecte 70 / 50 / 30", async () => {
    const v = (await sys<{ value: { n1: { pct: number }; n2: { pct: number }; n3: { pct: number } } }>(`select value from sec_settings where key = 'collab_levels'`))[0].value;
    expect([v.n1.pct, v.n2.pct, v.n3.pct]).toEqual([70, 50, 30]);
    expect(await h.fails("C1", `update sec_settings set value = '{}' where key = 'collab_levels'`)).toBeNull(); // la RLS no deixa canviar res
    expect((await sys<{ c: number }>(`select count(*)::int as c from sec_settings where key = 'collab_levels' and value ? 'n1'`))[0].c).toBe(1);
  });
});

describe("027 · percentatges amb el motor existent", () => {
  it("una versió nova aprovada tanca l'anterior el dia abans (històric conservat)", async () => {
    await h.as("A", rule("50", 1, "2026-01-01"));
    await h.as("A", rule("70", 2, "2027-01-01"));
    const r = await sys<{ version: number; value: string; valid_to: string | null }>(`select version, value, valid_to::text from fin_rules where beneficiary_id = '${U.K}' order by version`);
    expect(r.map((x) => [x.version, Number(x.value), x.valid_to])).toEqual([[1, 50, "2026-12-31"], [2, 70, null]]);
  });
  it("una regla aprovada no es pot modificar; només Direcció aprova", async () => {
    expect(await h.fails("A", `update fin_rules set value = 99 where beneficiary_id = '${U.K}' and version = 1`)).toMatch(/no es pot modificar/);
    expect(await h.fails("B", rule("62.5", 3, "2027-06-01"))).toMatch(/Direcció|row-level security/);
  });
  it("el col·laborador no veu les regles ni les fitxes d'altres", async () => {
    await sys(`insert into cap_partners (name, user_id) values ('Fitxa pròpia', '${U.K}')`);
    expect((await h.as<{ name: string }>("K", `select name from cap_partners`)).rows.map((x) => x.name)).toEqual(["Fitxa pròpia"]);
    expect(await h.count("C1", `select * from fin_rules where layer = 'collaborador'`)).toBe(0);
  });
});
