/**
 * Fase 8.2 · 018 · Reclamacions a comercialitzadores sobre PostgreSQL real (PGlite, migracions 001-018).
 * Accés (Direcció, Administració autoritzada i la persona assignada; mai comercials ni col·laboradors),
 * estats, duplicats, bloqueig després d'enviar, historial només d'afegir, totals i idempotència.
 * Dades fictícies.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const item = (claim: string, key: string, amount = 25) =>
  `insert into fin_claim_items (claim_id, item_key, kind, expected_amount, settled_amount, claimed_amount, reason_text) values ('${claim}', '${key}', 'infraliquidacio', ${amount + 75}, 75, ${amount}, 'Liquidat per sota de la regla aprovada') returning id`;

beforeAll(async () => {
  h = await setup(upTo("018"));
  ids.r = (await h.as<{ id: string }>("A", `insert into retailers (trade_name, status) values ('Iberdrola','activa') returning id`)).rows[0].id;
  ids.c = (await h.as<{ id: string }>("A", `insert into fin_claims (retailer, retailer_id, period_from, period_to, created_by) values ('Iberdrola', '${ids.r}', '2026-09-01', '2026-09-30', '${U.A}') returning id`)).rows[0].id;
}, 180_000);

describe("018 · accés", () => {
  it("Direcció hi accedeix; Administració sense permís «economia», comercials, caps d'equip i col·laboradors no", async () => {
    expect(await h.count("A", `select * from fin_claims`)).toBe(1);
    for (const w of ["B", "C1", "K", "L"] as const) expect(await h.count(w, `select * from fin_claims`)).toBe(0);
    expect(await h.fails("C1", `insert into fin_claims (retailer, period_from, period_to, created_by) values ('X','2026-01-01','2026-01-31','${U.C1}')`)).toMatch(/row-level security/);
  });
  it("la persona interna assignada veu només la seva reclamació (sense permís global d'economia)", async () => {
    const other = (await h.as<{ id: string }>("A", `insert into fin_claims (retailer, period_from, period_to, created_by) values ('Naturgy','2026-09-01','2026-09-30','${U.A}') returning id`)).rows[0].id;
    await h.as("A", `update fin_claims set assigned_to='${U.B}' where id='${ids.c}'`);
    expect((await h.as<{ id: string }>("B", `select id from fin_claims`)).rows.map((r) => r.id)).toEqual([ids.c]);
    await h.as("B", `insert into fin_claim_events (claim_id, kind, body, user_id) values ('${ids.c}', 'nota', 'Trucada a liquidacions', '${U.B}')`);
    expect(await h.fails("B", `insert into fin_claim_events (claim_id, kind, body, user_id) values ('${other}', 'nota', 'x', '${U.B}')`)).toMatch(/row-level security/);
    // un comercial assignat per error no hi accedeix igualment (no és personal intern d'administració)
    await h.as("A", `update fin_claims set assigned_to='${U.C1}' where id='${other}'`);
    expect(await h.count("C1", `select * from fin_claims`)).toBe(0);
    await h.as("A", `delete from fin_claims where id='${other}'`);
  });
  it("els contactes de liquidacions: Direcció i economia; mai comercials", async () => {
    await h.as("A", `insert into retailer_contacts (retailer_id, name, email, role, is_default) values ('${ids.r}', 'Dept. Liquidacions', 'liquidacions@exemple.test', 'liquidacions', true)`);
    expect(await h.count("A", `select * from retailer_contacts`)).toBe(1);
    expect(await h.count("C1", `select * from retailer_contacts`)).toBe(0);
    expect(await h.fails("A", `insert into retailer_contacts (retailer_id, name, role, is_default) values ('${ids.r}', 'Segon', 'liquidacions', true)`)).toMatch(/duplicate|unique/);
  });
});

describe("018 · línies, duplicats i totals", () => {
  it("els totals es calculen sols a partir de les línies", async () => {
    ids.i1 = (await h.as<{ id: string }>("A", item(ids.c, "line:aaa", 25))).rows[0].id;
    ids.i2 = (await h.as<{ id: string }>("A", item(ids.c, "pendent:k1:2026-09", 120.5))).rows[0].id;
    const c = (await sys<{ t: string; n: number }>(`select total_claimed::text t, items_count n from fin_claims where id='${ids.c}'`))[0];
    expect(c).toEqual({ t: "145.50", n: 2 });
  });
  it("una mateixa diferència no pot ser en dues reclamacions actives", async () => {
    ids.c2 = (await h.as<{ id: string }>("A", `insert into fin_claims (retailer, period_from, period_to, created_by) values ('Iberdrola','2026-09-01','2026-09-30','${U.A}') returning id`)).rows[0].id;
    expect(await h.fails("A", item(ids.c2, "line:aaa"))).toMatch(/duplicate|unique/);
  });
  it("no es pot enviar una reclamació buida", async () => {
    expect(await h.fails("A", `update fin_claims set status='enviada' where id='${ids.c2}'`)).toMatch(/cap diferència/);
  });
});

describe("018 · estats i bloqueig", () => {
  it("transicions vàlides; les no permeses fallen", async () => {
    expect(await h.fails("A", `update fin_claims set status='resolta' where id='${ids.c}'`)).toMatch(/no permès/);
    await h.as("A", `update fin_claims set status='pendent_enviament' where id='${ids.c}'`);
    await h.as("A", `update fin_claims set status='enviada' where id='${ids.c}'`);
    const c = (await sys<{ sent_at: string | null; sent_by: string }>(`select sent_at, sent_by from fin_claims where id='${ids.c}'`))[0];
    expect(c.sent_at).not.toBeNull();
    expect(c.sent_by).toBe(U.A);
  });
  it("enviada: no s'hi afegeixen diferències, l'import reclamat queda bloquejat i no es pot eliminar", async () => {
    expect(await h.fails("A", item(ids.c, "line:bbb"))).toMatch(/ampliació/);
    expect(await h.fails("A", `update fin_claim_items set claimed_amount=999 where id='${ids.i1}'`)).toMatch(/bloquejat/);
    expect(await h.fails("A", `update fin_claims set period_to='2026-10-31' where id='${ids.c}'`)).toMatch(/ja no es poden canviar/);
    await h.as("A", `delete from fin_claims where id='${ids.c}'`);                       // la RLS ho filtra: no esborra res
    expect(await h.count("A", `select * from fin_claims where id='${ids.c}'`)).toBe(1);
    const sysFail = await h.db.query(`delete from fin_claims where id='${ids.c}'`).then(() => null, (e: Error) => e.message);
    expect(sysFail).toMatch(/esborrany/);                                                    // i el disparador també, fins i tot sense RLS
  });
  it("es registra la resposta: import reconegut per línia i recuperacions (només d'afegir)", async () => {
    await h.as("A", `update fin_claim_items set recognized_amount=25, status='acceptada' where id='${ids.i1}'`);
    await h.as("A", `update fin_claim_items set recognized_amount=60, status='parcial' where id='${ids.i2}'`);
    await h.as("A", `update fin_claims set status='acceptada_parcial' where id='${ids.c}'`);
    await h.as("A", `insert into fin_claim_recoveries (claim_id, item_id, amount, received_at, reference, idempotency_key) values ('${ids.c}', '${ids.i1}', 25, '2026-10-20', 'REG-1', 'k1')`);
    expect(await h.fails("A", `insert into fin_claim_recoveries (claim_id, item_id, amount, received_at, idempotency_key) values ('${ids.c}', '${ids.i1}', 25, '2026-10-20', 'k1')`)).toMatch(/duplicate|unique/);
    const c = (await sys<{ r: string; rec: string }>(`select total_recognized::text r, total_recovered::text rec from fin_claims where id='${ids.c}'`))[0];
    expect(c).toEqual({ r: "85.00", rec: "25.00" });
    expect((await sys<{ v: string }>(`select recovered_amount::text v from fin_claim_items where id='${ids.i1}'`))[0].v).toBe("25.00");
    const sysErr = (sql: string) => h.db.query(sql).then(() => null, (e: Error) => e.message);
    expect(await sysErr(`update fin_claim_recoveries set amount=1`)).toMatch(/només d'afegir/);
    expect(await sysErr(`update fin_claim_events set body='x'`)).toMatch(/només d'afegir/);
    expect(await sysErr(`delete from fin_claim_recoveries`)).toMatch(/només d'afegir/);
  });
  it("seguiment: la diferència es traspassa a la reclamació nova i l'antiga en conserva l'historial", async () => {
    await h.as("A", `update fin_claims set parent_id='${ids.c}' where id='${ids.c2}'`);
    await h.as("A", `update fin_claim_items set status='traspassada' where id='${ids.i2}'`);
    await h.as("A", item(ids.c2, "pendent:k1:2026-09", 60.5));
    expect((await sys<{ n: number }>(`select items_count n from fin_claims where id='${ids.c}'`))[0].n).toBe(1);
    expect((await sys<{ n: number }>(`select count(*)::int n from fin_claim_items where item_key='pendent:k1:2026-09'`))[0].n).toBe(2);
  });
  it("en resoldre, les seves diferències deixen d'estar actives", async () => {
    await h.as("A", `update fin_claims set status='resolta' where id='${ids.c}'`);
    expect((await sys<{ a: boolean }>(`select active a from fin_claim_items where id='${ids.i1}'`))[0].a).toBe(false);
    const ev = (await sys<{ kind: string }>(`select kind from fin_claim_events where claim_id='${ids.c}' order by at`)).map((e) => e.kind);
    expect(ev).toEqual(expect.arrayContaining(["creacio", "estat", "assignacio", "nota", "recuperacio"]));
  });
});

describe("018 · idempotència i desfer", () => {
  it("es pot tornar a executar; el _down conserva les dades i es pot tornar a aplicar", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/018_reclamacions.sql`, "utf8"));
    const before = (await sys<{ n: number }>(`select count(*)::int n from fin_claims`))[0].n;
    await h.db.exec(fs.readFileSync(`${dir}/018_reclamacions_down.sql`, "utf8"));
    expect((await sys<{ n: number }>(`select count(*)::int n from fin_claims`))[0].n).toBe(before);
    expect(await h.count("B", `select * from fin_claims`)).toBe(0);
    await h.db.exec(fs.readFileSync(`${dir}/018_reclamacions.sql`, "utf8"));
    expect(await h.count("A", `select * from fin_claims`)).toBe(before);
  });
});
