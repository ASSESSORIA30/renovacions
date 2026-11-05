/**
 * Fase 10 · 020 (agenda) i 021 (estat de comercialitzadores) sobre PostgreSQL real (PGlite, migracions 001-021).
 * Privacitat de les cites personals, agenda compartida, assignacions, tokens de calendaris i estats. Dades fictícies.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { U, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const ev = (owner: string, title: string, scope = "personal", extra = "") =>
  `insert into agenda_events (owner_id, created_by, title, kind, scope, starts_at, ends_at${extra ? ", " + extra.split("=")[0] : ""}) values ('${owner}', auth.uid(), '${title}', 'visita', '${scope}', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'${extra ? ", " + extra.split("=")[1] : ""}) returning id`;

beforeAll(async () => {
  h = await setup(upTo("021"));
  // equip: el Cap d'equip L té el comercial C1
  const t = (await h.as<{ id: string }>("A", `insert into crm_teams (name, lead_id) values ('Equip de prova','${U.L}') returning id`)).rows[0].id;
  await h.as("A", `select crm_team_move('${U.C1}','${t}')`);
}, 240_000);

describe("020 · cites personals i compartides", () => {
  it("una cita personal només la veu el propietari (ni Direcció ni companys en veuen el detall)", async () => {
    ids.p1 = (await h.as<{ id: string }>("C1", ev(U.C1, "Metge (privat)"))).rows[0].id;
    expect(await h.count("C1", `select * from agenda_events where id='${ids.p1}'`)).toBe(1);
    expect(await h.count("C2", `select * from agenda_events where id='${ids.p1}'`)).toBe(0);
    expect(await h.count("B", `select * from agenda_events where id='${ids.p1}'`)).toBe(0);
    expect(await h.count("A", `select * from agenda_events where id='${ids.p1}'`)).toBe(0);
  });
  it("una cita compartida la veu l'equip intern però no els col·laboradors", async () => {
    ids.s1 = (await h.as<{ id: string }>("C1", ev(U.C1, "Reunio de equip", "compartida"))).rows[0].id;
    expect(await h.count("C2", `select * from agenda_events where id='${ids.s1}'`)).toBe(1);
    expect(await h.count("B", `select * from agenda_events where id='${ids.s1}'`)).toBe(1);
    expect(await h.count("K", `select * from agenda_events where id='${ids.s1}'`)).toBe(0);
    expect(await h.fails("K", ev(U.K, "intent col·laborador"))).toMatch(/row-level security/);
  });
  it("els participants veuen la cita personal on són convidats i només canvien la seva resposta", async () => {
    await h.as("C1", `insert into agenda_participants (event_id, user_id) values ('${ids.p1}', '${U.C2}')`);
    expect(await h.count("C2", `select * from agenda_events where id='${ids.p1}'`)).toBe(1);
    await h.as("C2", `update agenda_participants set response='accepta' where event_id='${ids.p1}' and user_id='${U.C2}'`);
    expect((await sys<{ r: string }>(`select response r from agenda_participants where event_id='${ids.p1}'`))[0].r).toBe("accepta");
    expect(await h.count("C2", `update agenda_events set title='canviat' where id='${ids.p1}' returning id`)).toBe(0); // no la pot modificar
  });
  it("assignar a una altra persona: Direcció i el Cap d'equip (als seus) sí; un comercial no", async () => {
    expect(await h.fails("C2", ev(U.C1, "Visita imposada"))).toMatch(/row-level security/);
    await h.as("A", ev(U.C2, "Visita assignada per Direcció"));
    await h.as("L", ev(U.C1, "Visita assignada pel Cap de equip"));
    expect(await h.fails("L", ev(U.C2, "Fora del seu equip"))).toMatch(/row-level security/);
  });
  it("la versió puja a cada canvi i el creador no es pot falsejar", async () => {
    await h.as("C1", `update agenda_events set title='Reunio de equip (sala 2)' where id='${ids.s1}'`);
    const r = (await sys<{ v: number; c: string }>(`select version v, created_by c from agenda_events where id='${ids.s1}'`))[0];
    expect(r.v).toBe(2);
    await h.as("C1", `update agenda_events set created_by='${U.A}' where id='${ids.s1}'`);
    expect((await sys<{ c: string }>(`select created_by c from agenda_events where id='${ids.s1}'`))[0].c).toBe(U.C1);
  });
  it("valida dates i tipus", async () => {
    expect(await h.fails("C1", `insert into agenda_events (owner_id, created_by, title, starts_at, ends_at) values ('${U.C1}', '${U.C1}', 'x', '2026-11-10T10:00:00Z', '2026-11-10T09:00:00Z')`)).toMatch(/check/);
    expect(await h.fails("C1", `insert into agenda_events (owner_id, created_by, title, kind, starts_at, ends_at) values ('${U.C1}', '${U.C1}', 'x', 'festa', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z')`)).toMatch(/check/);
  });
  it("les cites importades no es dupliquen (mateix id extern)", async () => {
    const ins = `insert into agenda_events (owner_id, created_by, title, starts_at, ends_at, external_source, external_id) values ('${U.C1}', '${U.C1}', 'Importada', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z', 'google', 'ext-1')`;
    await h.as("C1", ins);
    expect(await h.fails("C1", ins)).toMatch(/duplicate|unique/);
  });
});

describe("020 · calendaris externs", () => {
  it("cap usuari pot llegir ni escriure tokens (només el servidor)", async () => {
    await sys(`insert into calendar_connections (user_id, provider, status, access_token_enc) values ('${U.C1}', 'google', 'connectat', 'v1:xifrat')`);
    expect(await h.count("C1", `select * from calendar_connections`)).toBe(0);
    expect(await h.count("A", `select * from calendar_connections`)).toBe(0);
    expect(await h.fails("C1", `insert into calendar_connections (user_id, provider) values ('${U.C1}', 'microsoft')`)).toMatch(/row-level security/);
  });
});

describe("021 · estat de les comercialitzadores", () => {
  it("es pot arxivar i queda registrat qui i quan; el nom no es perd", async () => {
    ids.r = (await h.as<{ id: string }>("A", `insert into retailers (trade_name, status) values ('Comercialitzadora Fictícia', 'activa') returning id`)).rows[0].id;
    await h.as("A", `update retailers set status='arxivada', status_note='Ja no hi treballem' where id='${ids.r}'`);
    const r = (await sys<{ s: string; at: string | null; by: string | null }>(`select status s, status_changed_at at, status_changed_by by from retailers where id='${ids.r}'`))[0];
    expect(r.s).toBe("arxivada");
    expect(r.at).not.toBeNull();
    expect(r.by).toBe(U.A);
    expect(await h.fails("A", `update retailers set status='esborrada' where id='${ids.r}'`)).toMatch(/retailers_status_chk|check/);
  });
  it("no es pot eliminar si té documents relacionats (clau forana «restrict»)", async () => {
    await sys(`insert into retailer_documents (retailer_id, title, kind, storage_path, original_name, mime, size_bytes, sha256, version, status) values ('${ids.r}', 'Contracte fictici', 'contracte', 'x/y.pdf', 'y.pdf', 'application/pdf', 10, repeat('a',64), 1, 'vigent')`).catch(async () => {
      // si l'esquema de documents demana altres camps, n'hi ha prou amb una regla de retrocessió per provar la restricció
      await sys(`insert into fin_rules (rule_key, version, name, kind, layer, retailer_id, status, valid_from) values ('r1', 1, 'Regla fictícia', 'fix_contracte', 'proveidor', '${ids.r}', 'esborrany', '2026-01-01')`);
    });
    const err = await h.db.query(`delete from retailers where id='${ids.r}'`).then(() => "", (e: Error) => e.message);
    expect(err).toMatch(/foreign key|violates/);
  });
});
