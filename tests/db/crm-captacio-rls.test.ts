/**
 * Migració 013 (Fase 6: captació, col·laboradors i màrqueting) sobre PostgreSQL real (PGlite).
 * Usuaris: Direcció (A), Administració (B), comercials (C1, C2) i col·laborador (K). `sys()` = servidor (client de servei).
 * `anon` rep els mateixos permisos de taula que a Supabase per defecte: només la RLS el protegeix.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS, U, setup } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let p1 = "", p2 = "", sub = "", lead1 = "", lead2 = "", doc1 = "", consent = "", attr2 = "", wa = "";
const sys = async <T = Record<string, unknown>>(sql: string) => {
  await h.db.exec(`reset role; select set_config('request.jwt.uid', '', false);`);
  return (await h.db.query<T>(sql)).rows;
};
const anon = async (sql: string) => {
  await h.db.exec(`reset role; select set_config('request.jwt.uid', '', false); set role anon;`);
  try { return { rows: (await h.db.query(sql)).rows, error: null as string | null }; } catch (e) { return { rows: [], error: (e as Error).message }; } finally { await h.db.exec("reset role;"); }
};
const fails = async (sql: string) => sys(sql).then(() => null, (e: Error) => e.message);

beforeAll(async () => {
  h = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "011_crm_economia.sql", "012_ai_intelligence.sql", "013_captacio.sql", "013_captacio.sql"]);
  await h.db.exec(`grant usage on schema public to anon; grant all on all tables in schema public to anon; grant all on all sequences in schema public to anon;`);
  p1 = (await sys<{ id: string }>(`insert into cap_partners (user_id, kind, name, public_name, status) values ('${U.K}','electricista','Electricitat Pau','Pau Electricista','actiu') returning id`))[0].id;
  p2 = (await sys<{ id: string }>(`insert into cap_partners (kind, name, status) values ('gestoria','Gestoria Segrià','actiu') returning id`))[0].id;
  await sys(`insert into cap_referral_links (partner_id, code) values ('${p1}','PAU1234'), ('${p2}','SEGRIA01')`);
  sub = (await sys<{ id: string }>(`insert into cap_submissions (idempotency_key, channel, name, phone, email, partner_id, contact_hash, ip_hash) values ('11111111-1111-4111-8111-111111111111','recomanacio','Forn SL','+34600000001','forn@x.cat','${p1}','h1','ip1') returning id`))[0].id;
  lead1 = (await sys<{ id: string }>(`insert into crm_leads (name, phone, owner_id, capture_channel, capture_submission_id) values ('Forn SL','+34600000001','${U.C1}','recomanacio','${sub}') returning id`))[0].id;
  lead2 = (await sys<{ id: string }>(`insert into crm_leads (name, phone, owner_id, capture_channel) values ('Taller C2','+34600000002','${U.C2}','web') returning id`))[0].id;
  doc1 = (await sys<{ id: string }>(`insert into cap_lead_documents (lead_id, submission_id, storage_path, original_name, mime, size_bytes, sha256, uploaded_by) values ('${lead1}','${sub}','${sub}/f.pdf','factura.pdf','application/pdf',1000,'s1','${U.K}') returning id`))[0].id;
  await sys(`insert into cap_lead_documents (lead_id, storage_path, original_name, mime, size_bytes, sha256) values ('${lead2}','x/f2.pdf','factura2.pdf','application/pdf',1000,'s2')`);
  await sys(`insert into cap_invoice_readings (document_id, lead_id, status) values ('${doc1}','${lead1}','llegida')`);
  consent = (await sys<{ id: string }>(`insert into cap_consents (submission_id, lead_id, kind, granted, text_version, text_sha256, channel) values ('${sub}','${lead1}','comercial',true,'v1','x','web') returning id`))[0].id;
  await sys(`insert into cap_attributions (lead_id, partner_id, ref_code, source) values ('${lead1}','${p1}','PAU1234','enllac')`);
}, 120_000);

describe("16 · Formularis públics: cap accés directe a la base de dades", () => {
  it("anon no pot llegir ni escriure res de captació (ni leads, ni clients, ni col·laboradors)", async () => {
    for (const t of ["cap_submissions", "cap_partners", "cap_referral_links", "cap_lead_documents", "cap_invoice_readings", "cap_consents", "cap_attributions", "crm_leads", "crm_clients", "cap_visits"]) {
      const r = await anon(`select * from ${t}`);
      expect(r.rows, t).toHaveLength(0);
    }
    expect((await anon(`insert into cap_submissions (idempotency_key, channel) values ('22222222-2222-4222-8222-222222222222','web')`)).error).toMatch(/row-level security/);
    expect((await anon(`insert into crm_leads (name) values ('Intrús')`)).error).toMatch(/row-level security/);
    expect((await anon(`select cap_anonymize_expired()`)).error).toMatch(/permission denied/);
  });
  it("el bucket de factures és privat i només admet PDF i imatges", async () => {
    const b = (await sys<{ public: boolean; allowed_mime_types: string[]; file_size_limit: number }>(`select public, allowed_mime_types, file_size_limit from storage.buckets where id='lead-documents'`))[0];
    expect(b).toEqual({ public: false, allowed_mime_types: ["application/pdf", "image/jpeg", "image/png", "image/webp"], file_size_limit: 10485760 });
  });
});

describe("18 · Resistència a enviaments duplicats", () => {
  it("la mateixa clau d'idempotència, visita o esdeveniment de webhook no es registra dues vegades", async () => {
    expect(await fails(`insert into cap_submissions (idempotency_key, channel) values ('11111111-1111-4111-8111-111111111111','web')`)).toMatch(/duplicate key/);
    await sys(`insert into cap_visits (event, session_hash) values ('visita','s1') on conflict do nothing`);
    await sys(`insert into cap_visits (event, session_hash) values ('visita','s1') on conflict do nothing`);
    expect((await sys<{ n: number }>(`select count(*)::int n from cap_visits where session_hash='s1'`))[0].n).toBe(1);
    await sys(`insert into cap_webhook_events (provider, external_id, signature_ok) values ('meta_leadgen','L1',true)`);
    expect(await fails(`insert into cap_webhook_events (provider, external_id, signature_ok) values ('meta_leadgen','L1',true)`)).toMatch(/duplicate key/);
    await sys(`insert into cap_conversion_events (lead_id, kind) values ('${lead1}','lead')`);
    expect(await fails(`insert into cap_conversion_events (lead_id, kind) values ('${lead1}','lead')`)).toMatch(/duplicate key/);
  });
});

describe("15 · Denegació d'accés a dades alienes", () => {
  it("el col·laborador només veu el seu perfil, els seus enllaços i les seves atribucions", async () => {
    expect((await h.as<{ name: string }>("K", `select name from cap_partners`)).rows.map((r) => r.name)).toEqual(["Electricitat Pau"]);
    expect((await h.as<{ code: string }>("K", `select code from cap_referral_links`)).rows.map((r) => r.code)).toEqual(["PAU1234"]);
    expect(await h.count("K", `select 1 from cap_attributions`)).toBe(1);
    expect(await h.count("C1", `select 1 from cap_partners`)).toBe(0);
  });
  it("factures: el col·laborador veu les que ha pujat ell, mai la lectura interna; el comercial només les dels seus leads", async () => {
    await sys(`update crm_leads set collaborator_id='${U.K}' where id='${lead1}'`);
    expect(await h.count("K", `select 1 from cap_lead_documents`)).toBe(1);
    expect(await h.count("K", `select 1 from cap_invoice_readings`)).toBe(0);
    expect(await h.count("C1", `select 1 from cap_lead_documents`)).toBe(1);
    expect(await h.count("C1", `select 1 from cap_invoice_readings`)).toBe(1);
    expect(await h.count("C2", `select 1 from cap_lead_documents where lead_id='${lead1}'`)).toBe(0);
    expect(await h.count("B", `select 1 from cap_lead_documents`)).toBe(2);
  });
  it("sol·licituds, campanyes, costos i webhooks: només l'equip (els webhooks, només Direcció)", async () => {
    expect(await h.count("C1", `select 1 from cap_submissions`)).toBe(0);
    expect(await h.count("K", `select 1 from cap_submissions`)).toBe(0);
    expect(await h.count("B", `select 1 from cap_submissions`)).toBe(1);
    expect(await h.count("B", `select 1 from cap_webhook_events`)).toBe(0);
    expect(await h.count("A", `select 1 from cap_webhook_events`)).toBe(1);
    expect(await h.fails("B", `insert into cap_campaigns (platform, name) values ('google_ads','Prova')`)).toMatch(/row-level security/);
    await h.as("A", `insert into cap_campaigns (platform, name, utm_campaign) values ('google_ads','Llum pimes','llum-pimes')`);
    expect(await h.count("C1", `select 1 from cap_campaigns`)).toBe(0);
    expect(await h.fails("C1", `insert into cap_assignment_rules (name, user_ids) values ('x','{${U.C1}}')`)).toMatch(/row-level security/);
  });
});

describe("12-13 · Atribució segura (enllaç de referència)", () => {
  it("l'atribució vigent porta el col·laborador al lead (comissions de la Fase 4)", async () => {
    const l = (await sys<{ capture_partner_id: string; collaborator_id: string }>(`select capture_partner_id, collaborator_id from crm_leads where id='${lead1}'`))[0];
    expect(l).toEqual({ capture_partner_id: p1, collaborator_id: U.K });
    expect((await sys<{ action: string }>(`select action from cap_audit where entity='cap_attributions'`)).map((r) => r.action)).toContain("creada");
  });
  it("una sola atribució vigent per lead; la segona aportació queda en disputa", async () => {
    expect(await fails(`insert into cap_attributions (lead_id, partner_id, source) values ('${lead1}','${p2}','enllac')`)).toMatch(/duplicate key/);
    attr2 = (await sys<{ id: string }>(`insert into cap_attributions (lead_id, partner_id, source, status, reason) values ('${lead1}','${p2}','enllac','en_disputa','Mateixa persona') returning id`))[0].id;
    expect((await sys<{ capture_partner_id: string }>(`select capture_partner_id from crm_leads where id='${lead1}'`))[0].capture_partner_id).toBe(p1);
  });
  it("ningú excepte Direcció la modifica; no es pot reassignar a un altre col·laborador; cal motiu", async () => {
    expect((await h.as("B", `update cap_attributions set status='vigent', reason='x' where id='${attr2}' returning id`)).rows).toHaveLength(0);
    expect((await h.as("K", `update cap_attributions set status='rebutjada', reason='x' where id='${attr2}' returning id`)).rows).toHaveLength(0);
    expect(await h.fails("A", `update cap_attributions set partner_id='${p1}' where id='${attr2}'`)).toMatch(/no es pot reassignar|Només Direcció|duplicate/);
    expect(await h.fails("A", `update cap_attributions set status='rebutjada', reason='' where id='${attr2}'`)).toMatch(/motiu/);
    const r = await h.as<{ status: string; decided_by: string }>("A", `update cap_attributions set status='rebutjada', reason='Aportació posterior' where id='${attr2}' returning status, decided_by`);
    expect(r.rows[0]).toEqual({ status: "rebutjada", decided_by: U.A });
    expect(await h.fails("K", `insert into cap_attributions (lead_id, partner_id, source) values ('${lead2}','${p1}','portal')`)).toMatch(/row-level security|Només Direcció/);
    // i encara que una política ho permetés, el trigger només deixa Direcció
    await h.db.exec(`reset role; select set_config('request.jwt.uid', '${U.B}', false);`);
    expect(await h.db.exec(`update cap_attributions set status='vigent', reason='x' where id='${attr2}'`).then(() => null, (e: Error) => e.message)).toMatch(/Només Direcció/);
  });
});

describe("17 · Consentiments", () => {
  it("un consentiment no es modifica; només es pot retirar una vegada", async () => {
    expect(await fails(`update cap_consents set granted=false where id='${consent}'`)).toMatch(/només es pot retirar/);
    await sys(`update cap_consents set withdrawn_at=now() where id='${consent}'`);
    expect(await fails(`update cap_consents set withdrawn_at=now() + interval '1 day' where id='${consent}'`)).toMatch(/ja s'ha retirat/);
    expect(await h.count("C1", `select 1 from cap_consents where lead_id='${lead1}'`)).toBe(1);
    expect(await h.count("C2", `select 1 from cap_consents where lead_id='${lead1}'`)).toBe(0);
  });
  it("conservació: les sol·licituds caducades s'anonimitzen (només el servidor)", async () => {
    await sys(`insert into cap_submissions (idempotency_key, channel, name, phone, email, retain_until) values ('33333333-3333-4333-8333-333333333333','web','Antic','+34600000009','a@x.cat', now() - interval '1 day')`);
    expect(await h.fails("A", `select cap_anonymize_expired()`)).toMatch(/permission denied/);
    expect((await sys<{ n: number }>(`select cap_anonymize_expired() n`))[0].n).toBe(1);
    expect((await sys(`select name, phone, email from cap_submissions where idempotency_key='33333333-3333-4333-8333-333333333333'`))[0]).toEqual({ name: null, phone: null, email: null });
  });
});

describe("16 · WhatsApp: l'estat només avança amb el webhook", () => {
  it("cap usuari canvia l'estat; el servidor no el fa retrocedir; «fallit» és final", async () => {
    wa = (await sys<{ id: string }>(`insert into cap_whatsapp_messages (lead_id, direction, wa_message_id, phone, status) values ('${lead1}','sortint','wamid.1','+34600000001','acceptat') returning id`))[0].id;
    expect((await h.as("A", `update cap_whatsapp_messages set status='lliurat' where id='${wa}' returning id`)).rows).toHaveLength(0); // sense política d'escriptura
    await h.db.exec(`reset role; select set_config('request.jwt.uid', '${U.A}', false);`);
    expect(await h.db.exec(`update cap_whatsapp_messages set status='lliurat' where id='${wa}'`).then(() => null, (e: Error) => e.message)).toMatch(/només l'actualitza el servidor/);
    await sys(`update cap_whatsapp_messages set status='llegit' where id='${wa}'`);
    await sys(`update cap_whatsapp_messages set status='lliurat' where id='${wa}'`);
    expect((await sys<{ status: string }>(`select status from cap_whatsapp_messages where id='${wa}'`))[0].status).toBe("llegit");
    const f = (await sys<{ id: string }>(`insert into cap_whatsapp_messages (direction, wa_message_id, phone, status) values ('sortint','wamid.2','+34600000001','fallit') returning id`))[0].id;
    expect(await fails(`update cap_whatsapp_messages set status='lliurat' where id='${f}'`)).toMatch(/Estat final/);
  });
});

describe("9 · Assignacions i 19-20 · Compatibilitat", () => {
  it("l'historial d'assignacions és només d'afegir", async () => {
    await sys(`insert into cap_assignments (lead_id, user_id, method, reason) values ('${lead1}','${U.C1}','regla','Regla Lleida')`);
    expect(await fails(`update cap_assignments set user_id='${U.C2}'`)).toMatch(/append-only|només|no es pot/i);
    expect(await h.count("C1", `select 1 from cap_assignments where lead_id='${lead1}'`)).toBe(1);
    expect(await h.count("C2", `select 1 from cap_assignments where lead_id='${lead1}'`)).toBe(0);
  });
  it("la migració 013 és idempotent i reversible conservant les dades dels leads", async () => {
    const h2 = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "011_crm_economia.sql", "012_ai_intelligence.sql", "013_captacio.sql"]);
    await h2.db.exec(`insert into crm_leads (name, capture_channel, cups) values ('Lead captat','web','ES0031400000000001AB')`);
    for (const f of ["013_captacio_down.sql", "013_captacio.sql", "013_captacio.sql"]) await h2.db.exec((await import("node:fs")).readFileSync(`${(await import("./harness")).dir}/${f}`, "utf8"));
    expect((await h2.db.query<{ capture_channel: string; cups: string }>(`select capture_channel, cups from crm_leads where name='Lead captat'`)).rows[0]).toEqual({ capture_channel: "web", cups: "ES0031400000000001AB" });
    expect((await h2.db.query<{ n: number }>(`select count(*)::int n from crm_automation_rules where key like 'cap_%'`)).rows[0].n).toBe(9);
  }, 120_000);
  it("els leads de la Fase 2 continuen funcionant (comercial, conversió) amb les columnes noves", async () => {
    const l = await h.as<{ id: string; duplicate_status: string }>("C1", `insert into crm_leads (name, phone, owner_id) values ('Lead manual','+34611111111','${U.C1}') returning id, duplicate_status`);
    expect(l.rows[0].duplicate_status).toBe("unic");
    expect(await h.fails("C1", `update crm_leads set capture_channel='inventat' where id='${l.rows[0].id}'`)).toMatch(/check constraint/);
    expect(await h.count("A", `select 1 from crm_automation_rules where key in ('lead_sense_contacte','proposta_sense_resposta','ai_motor','cap_nou_lead')`)).toBe(4);
  });
});
