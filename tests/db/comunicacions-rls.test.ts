/**
 * Fase 8 · Migració 015 (comunicacions per usuari, ressenyes, autoritzacions de dades i espai de treball) sobre
 * PostgreSQL real (PGlite). Usuaris: Direcció (A), Administrativa (B), comercials (C1, C2) i col·laborador (K).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS, U, setup } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let client1 = "", client2 = "", num1 = "", num2 = "", doc1 = "";
const sys = async <T = Record<string, unknown>>(sql: string) => {
  await h.db.exec(`reset role; select set_config('request.jwt.uid', '', false);`);
  return (await h.db.query<T>(sql)).rows;
};

beforeAll(async () => {
  h = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "011_crm_economia.sql", "012_ai_intelligence.sql", "013_captacio.sql", "014_consolidacio.sql", "015_comunicacions.sql", "015_comunicacions.sql"]);
  client1 = (await sys<{ id: string }>(`insert into crm_clients (name, owner_id, collaborator_id) values ('Forn C1','${U.C1}','${U.K}') returning id`))[0].id;
  client2 = (await sys<{ id: string }>(`insert into crm_clients (name, owner_id) values ('Taller C2','${U.C2}') returning id`))[0].id;
  num1 = (await sys<{ id: string }>(`insert into wa_business_numbers (phone_number_id, display_phone, label) values ('111','+34973000001','Comercial') returning id`))[0].id;
  num2 = (await sys<{ id: string }>(`insert into wa_business_numbers (phone_number_id, display_phone, label) values ('222','+34973000002','Administració') returning id`))[0].id;
  await sys(`insert into wa_number_access (number_id, user_id) values ('${num1}','${U.C1}')`);
  await sys(`insert into user_mail_accounts (user_id, from_name, from_email, host, port, security, username, password_enc) values ('${U.C1}','C1','c1@a30.com','smtp.test',587,'starttls','c1','v1.xifrat')`);
  doc1 = (await sys<{ id: string }>(`insert into crm_documents (client_id, category, title, original_name, mime, size_bytes, sha256, storage_path) values ('${client1}','proteccio_dades','Autorització','autoritzacio.pdf','application/pdf',100,'abc','${client1}/a.pdf') returning id`))[0].id;
}, 120_000);

describe("Correu per usuari: credencials només al servidor", () => {
  it("cap usuari (ni el propietari ni Direcció) no pot llegir user_mail_accounts des del navegador", async () => {
    for (const who of ["C1", "A", "B", "K"] as const) expect(await h.count(who, "select * from user_mail_accounts")).toBe(0);
  });
  it("tampoc no hi pot escriure (ni inserir la seva pròpia configuració saltant-se el servidor)", async () => {
    expect(await h.fails("C2", `insert into user_mail_accounts (user_id, from_name, from_email) values ('${U.C2}','C2','c2@a30.com')`)).toBeTruthy();
    const r = await h.as("C1", `update user_mail_accounts set password_enc='x' where user_id='${U.C1}' returning user_id`);
    expect(r.rows).toHaveLength(0);
  });
});

describe("WhatsApp per usuari: només números autoritzats", () => {
  it("cada usuari veu només els números empresarials que té autoritzats; Direcció els veu tots", async () => {
    expect(await h.count("C1", "select * from wa_business_numbers")).toBe(1);
    expect(await h.count("C2", "select * from wa_business_numbers")).toBe(0);
    expect(await h.count("A", "select * from wa_business_numbers")).toBe(2);
  });
  it("un usuari no pot triar un número que no té autoritzat ni autoritzar-se'l", async () => {
    expect(await h.fails("C1", `insert into user_whatsapp (user_id, mode, default_number_id) values ('${U.C1}','cloud','${num2}')`)).toBeTruthy();
    expect(await h.fails("C1", `insert into wa_number_access (number_id, user_id) values ('${num2}','${U.C1}')`)).toBeTruthy();
    await h.as("C1", `insert into user_whatsapp (user_id, mode, phone_e164, default_number_id) values ('${U.C1}','cloud','+34600000001','${num1}')`);
    expect(await h.count("C1", "select * from user_whatsapp")).toBe(1);
  });
  it("ningú veu ni modifica la configuració de WhatsApp d'un altre usuari", async () => {
    expect(await h.count("C2", "select * from user_whatsapp")).toBe(0);
    expect(await h.fails("C2", `insert into user_whatsapp (user_id, mode) values ('${U.C1}','enllac')`)).toBeTruthy();
  });
  it("el telèfon ha de ser E.164", async () => {
    expect(await h.fails("C2", `insert into user_whatsapp (user_id, phone_e164) values ('${U.C2}','600 000 000')`)).toBeTruthy();
  });
});

describe("Sol·licituds de ressenya i d'autorització de dades", () => {
  it("el comercial registra una sol·licitud del seu client; no la del client d'un altre comercial", async () => {
    await h.as("C1", `insert into client_requests (client_id, kind, language, channel, status, requested_by) values ('${client1}','ressenya','ca','whatsapp','preparada','${U.C1}')`);
    expect(await h.fails("C1", `insert into client_requests (client_id, kind, language, channel, status, requested_by) values ('${client2}','ressenya','ca','whatsapp','preparada','${U.C1}')`)).toBeTruthy();
    expect(await h.count("C2", `select * from client_requests where client_id='${client1}'`)).toBe(0);
  });
  it("evita duplicats accidentals (mateix client, tipus i canal en menys de 2 minuts)", async () => {
    const e = await h.fails("C1", `insert into client_requests (client_id, kind, language, channel, status, requested_by) values ('${client1}','ressenya','es','whatsapp','preparada','${U.C1}')`);
    expect(e).toMatch(/menys de 2 minuts/);
    // per un altre canal sí que es pot
    await h.as("C1", `insert into client_requests (client_id, kind, language, channel, status, requested_by) values ('${client1}','ressenya','ca','email','enviada','${U.C1}')`);
  });
  it("una ressenya no pot quedar mai «publicada» (estat inexistent)", async () => {
    expect(await h.fails("C1", `insert into client_requests (client_id, kind, language, channel, status, requested_by) values ('${client1}','ressenya','ca','copiat','publicada','${U.C1}')`)).toBeTruthy();
  });
  it("el col·laborador no pot registrar sol·licituds", async () => {
    expect(await h.fails("K", `insert into client_requests (client_id, kind, language, channel, status, requested_by) values ('${client1}','proteccio_dades','ca','manual','sollicitada','${U.K}')`)).toBeTruthy();
  });
  it("autorització de dades: «completada» registra qui ho confirma i queda auditada", async () => {
    const id = (await h.as<{ id: string }>("C1", `insert into client_requests (client_id, kind, language, channel, status, legal_basis, requested_by) values ('${client1}','proteccio_dades','ca','whatsapp','sollicitada','consentiment','${U.C1}') returning id`)).rows[0].id;
    await h.as("C1", `update client_requests set status='completada', evidence_document_id='${doc1}' where id='${id}'`);
    const r = (await sys<{ confirmed_by: string; confirmed_at: string | null }>(`select confirmed_by, confirmed_at from client_requests where id='${id}'`))[0];
    expect(r.confirmed_by).toBe(U.C1);
    expect(r.confirmed_at).toBeTruthy();
    const audit = await sys<{ action: string }>(`select action from sec_audit where entity='client_requests' and entity_id='${id}' order by id`);
    expect(audit.map((a) => a.action)).toEqual(["proteccio_dades_sollicitada", "proteccio_dades_completada"]);
  });
  it("sense usuari (càrrega directa) no es pot marcar completada sense confirmació", async () => {
    expect(await sys(`insert into client_requests (client_id, kind, language, channel, status) values ('${client2}','proteccio_dades','ca','manual','completada')`).then(() => null, (e: Error) => e.message)).toBeTruthy();
  });
  it("només bases legals vàlides (el consentiment no és l'única)", async () => {
    await h.as("C2", `insert into client_requests (client_id, kind, language, channel, status, legal_basis, requested_by) values ('${client2}','proteccio_dades','es','manual','pendent','execucio_contracte','${U.C2}')`);
    expect(await h.fails("C2", `insert into client_requests (client_id, kind, language, channel, status, legal_basis, requested_by) values ('${client2}','proteccio_dades','es','email','pendent','perque_si','${U.C2}')`)).toBeTruthy();
  });
  it("la categoria de document «proteccio_dades» és vàlida", async () => {
    expect(doc1).toBeTruthy();
  });
});

describe("Espai de treball persistent", () => {
  it("cada usuari només llegeix i escriu el seu", async () => {
    await h.as("C1", `insert into user_workspace (user_id, key, data) values ('${U.C1}','energy','{"offers":[1]}')`);
    expect(await h.count("C1", "select * from user_workspace")).toBe(1);
    expect(await h.count("C2", "select * from user_workspace")).toBe(0);
    expect(await h.count("A", "select * from user_workspace")).toBe(0);
    expect(await h.fails("C2", `insert into user_workspace (user_id, key, data) values ('${U.C1}','nav','{}')`)).toBeTruthy();
    const r = await h.as("C2", `update user_workspace set data='{}' where user_id='${U.C1}' returning key`);
    expect(r.rows).toHaveLength(0);
  });
});
