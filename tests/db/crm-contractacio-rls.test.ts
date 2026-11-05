/**
 * Migració 010 (CRM Fase 3: contractació, expedients i tramitacions) sobre PostgreSQL real (PGlite).
 * Usuaris: Direcció (A), Administració (B), comercials (C1, C2) i col·laborador (K).
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { MIGRATIONS, U, dir, setup } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let client = "", supply = "", oldContract = "", exp = "", doc = "", otherDoc = "", tpl = "";

const one = async <T = Record<string, unknown>>(who: Parameters<typeof h.as>[0], sql: string) => (await h.as<T>(who, sql)).rows[0];

beforeAll(async () => {
  h = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "010_crm_contractacio.sql"]);
  client = (await one<{ id: string }>("C1", `insert into crm_clients (kind, name, tax_id, owner_id, collaborator_id, phone, address) values ('empresa','Forn Sant Jordi SL','B12345678','${U.C1}','${U.K}','+34973000000','C/ Major 1') returning id`)).id;
  supply = (await one<{ id: string }>("C1", `insert into crm_supplies (client_id, cups, energy_type, access_tariff) values ('${client}','ES0021000000000001AA','luz','3.0TD') returning id`)).id;
  oldContract = (await one<{ id: string }>("C1", `insert into crm_contracts (client_id, supply_id, retailer, status, start_date, end_date) values ('${client}','${supply}','Endesa','actiu','2025-01-01','2026-12-31') returning id`)).id;
  await h.as("C1", `update crm_supplies set current_contract_id='${oldContract}' where id='${supply}'`);
  const other = (await one<{ id: string }>("C2", `insert into crm_clients (name, owner_id) values ('Client C2','${U.C2}') returning id`)).id;
  doc = (await one<{ id: string }>("C1", `insert into crm_documents (client_id, category, title, original_name, mime, size_bytes, sha256, storage_path, uploaded_by) values ('${client}','fiscal','CIF','cif.pdf','application/pdf',10,'x','p','${U.C1}') returning id`)).id;
  otherDoc = (await one<{ id: string }>("C2", `insert into crm_documents (client_id, category, title, original_name, mime, size_bytes, sha256, storage_path, uploaded_by) values ('${other}','fiscal','CIF','cif.pdf','application/pdf',10,'x','p','${U.C2}') returning id`)).id;
}, 120_000);

describe("010 · expedients", () => {
  it("el comercial crea un expedient del seu client: codi, historial i registre de comissió", async () => {
    const opp = (await one<{ id: string }>("C1", `insert into crm_opportunities (client_id, title, service, owner_id, created_by, annual_kwh, commission_eur, stage) values ('${client}','Llum Forn','llum_empresa','${U.C1}','${U.C1}', 80000, 400, 'guanyat') returning id`)).id;
    const r = await one<{ id: string; code: string; status: string }>("C1", `insert into crm_expedients (client_id, supply_id, opportunity_id, service, customer_type, retailer, product, owner_id, collaborator_id, created_by) values ('${client}','${supply}','${opp}','llum_empresa','empresa','Iberdrola','Plan Empresa','${U.C1}','${U.K}','${U.C1}') returning id, code, status`);
    exp = r.id;
    expect(r.code).toMatch(/^EXP-\d{4}-\d{5}$/);
    expect(r.status).toBe("pendent_documentacio");
    expect(await h.count("C1", `select * from crm_expedient_events where expedient_id='${exp}' and type='creacio'`)).toBe(1);
    const c = await one<{ estimated_eur: string; accrual_status: string }>("B", `select * from crm_commission_records where expedient_id='${exp}'`);
    expect(Number(c.estimated_eur)).toBe(400);
    expect(c.accrual_status).toBe("pendent");
  });
  it("permisos de lectura i creació entre usuaris", async () => {
    expect(await h.count("C2", `select * from crm_expedients where id='${exp}'`)).toBe(0);
    expect(await h.count("B", `select * from crm_expedients where id='${exp}'`)).toBe(1);
    expect(await h.count("K", `select * from crm_expedients where id='${exp}'`)).toBe(1);      // col·laborador de l'expedient
    expect((await h.as("C2", `update crm_expedients set internal_notes='x' where id='${exp}' returning id`)).rows).toHaveLength(0);
    expect((await h.as("K", `update crm_expedients set internal_notes='x' where id='${exp}' returning id`)).rows).toHaveLength(0);
    expect(await h.fails("C2", `insert into crm_expedients (client_id, service, retailer, owner_id, created_by) values ('${client}','gas','Naturgy','${U.C2}','${U.C2}')`)).toMatch(/row-level security/);
    expect(await h.fails("C1", `insert into crm_expedients (client_id, service, retailer, owner_id, created_by) values ('${client}','gas','Naturgy','${U.C2}','${U.C1}')`)).toMatch(/row-level security/);
    expect(await h.fails("C1", `update crm_expedients set owner_id='${U.C2}' where id='${exp}'`)).toMatch(/Només Administració/);
  });
  it("comissions: el comercial les veu però no les modifica; el col·laborador no les veu", async () => {
    expect(await h.count("C1", `select * from crm_commission_records where expedient_id='${exp}'`)).toBe(1);
    expect(await h.count("K", `select * from crm_commission_records where expedient_id='${exp}'`)).toBe(0);
    expect(await h.count("C2", `select * from crm_commission_records where expedient_id='${exp}'`)).toBe(0);
    expect((await h.as("C1", `update crm_commission_records set accrual_status='meritada' where expedient_id='${exp}' returning id`)).rows).toHaveLength(0);
    expect(await h.fails("B", `update crm_commission_records set payment_status='cobrada' where expedient_id='${exp}'`)).toMatch(/data de cobrament/);
  });
});

describe("010 · documentació obligatòria", () => {
  it("es creen els requisits segons servei i tipus de client", async () => {
    const n = (await one<{ n: number }>("C1", `select public.crm_expedient_seed_requirements('${exp}') as n`)).n;
    expect(n).toBeGreaterThan(3);
    const names = (await h.as<{ name: string }>("C1", `select name from crm_expedient_requirements where expedient_id='${exp}'`)).rows.map((r) => r.name);
    expect(names).toContain("CIF i escriptures o poders");          // empresa
    expect(names).not.toContain("DNI/NIE del titular");             // només persones físiques
    expect(names).not.toContain("Dades de portabilitat");           // només fibra
    expect((await one<{ n: number }>("C1", `select public.crm_expedient_seed_requirements('${exp}') as n`)).n).toBe(0);   // idempotent
  });
  it("no es pot marcar com a completa amb documents obligatoris pendents", async () => {
    expect(await h.fails("C1", `update crm_expedients set status='documentacio_completa' where id='${exp}'`)).toMatch(/Falta documentació obligatòria/);
  });
  it("reutilitza un document de la fitxa (sense copiar-lo) però no el d'un altre client", async () => {
    expect(await h.fails("C1", `update crm_expedient_requirements set document_id='${otherDoc}', status='aportat' where expedient_id='${exp}' and doc_category='fiscal'`)).toMatch(/no és d'aquest client/);
    await h.as("C1", `update crm_expedient_requirements set document_id='${doc}', status='aportat' where expedient_id='${exp}' and doc_category='fiscal'`);
    expect(await h.fails("C1", `update crm_expedient_requirements set status='validat' where expedient_id='${exp}' and doc_category='fiscal'`)).toMatch(/Només Administració pot validar/);
    await h.as("B", `update crm_expedient_requirements set status='validat' where expedient_id='${exp}' and doc_category='fiscal'`);
    expect(await h.fails("B", `update crm_expedient_requirements set status='rebutjat' where expedient_id='${exp}' and data_field='client.tax_id'`)).toMatch(/per què es rebutja/);
    await h.as("C1", `update crm_expedient_requirements set status='aportat' where expedient_id='${exp}' and mandatory and status='pendent'`);
    await h.as("C1", `update crm_expedients set status='documentacio_completa' where id='${exp}'`);
    await h.as("C1", `update crm_expedients set status='pendent_signatura' where id='${exp}'`);
    expect((await one<{ status: string; version: number }>("C1", `select status, version from crm_expedients where id='${exp}'`)).status).toBe("pendent_signatura");
  });
});

describe("010 · condicions, plantilles i signatura", () => {
  it("les condicions acceptades són immutables", async () => {
    const t = (await one<{ id: string }>("C1", `insert into crm_expedient_terms (expedient_id, version, source, retailer, service, conditions, sha256, captured_by) values ('${exp}',1,'manual','Iberdrola','llum_empresa','{"energia":[0.12,0.11]}','abc','${U.C1}') returning id`)).id;
    await h.as("C1", `update crm_expedients set accepted_terms_id='${t}' where id='${exp}'`);
    expect((await h.as("B", `update crm_expedient_terms set retailer='Altra' where id='${t}' returning id`)).rows).toHaveLength(0);   // cap política d'edició
    await expect(h.db.exec(`update crm_expedient_terms set retailer='Altra' where id='${t}'`)).rejects.toThrow(/immutable/);      // ni tan sols el servidor
    expect(await h.fails("C2", `insert into crm_expedient_terms (expedient_id, version, source, retailer, service, sha256, captured_by) values ('${exp}',2,'manual','X','gas','x','${U.C2}')`)).toMatch(/row-level security/);
  });
  it("plantilles: només Direcció les autoritza i qualsevol canvi de text en demana una de nova autorització", async () => {
    expect(await h.fails("B", `insert into crm_doc_templates (name, body) values ('X','Hola')`)).toMatch(/row-level security/);
    tpl = (await one<{ id: string }>("A", `insert into crm_doc_templates (name, body) values ('Resum de condicions','Client: {{client.nom}}') returning id`)).id;
    expect(await h.count("C1", `select * from crm_doc_templates where id='${tpl}'`)).toBe(0);         // esborrany: no visible
    await h.as("A", `update crm_doc_templates set status='autoritzada' where id='${tpl}'`);
    expect(await h.count("C1", `select * from crm_doc_templates where id='${tpl}'`)).toBe(1);
    await h.as("A", `update crm_doc_templates set body='Client: {{client.nom}} · NIF {{client.nif}}' where id='${tpl}'`);
    const t = await one<{ version: number; status: string }>("A", `select version, status from crm_doc_templates where id='${tpl}'`);
    expect(t).toMatchObject({ version: 2, status: "esborrany" });
    expect(await h.count("A", `select * from crm_doc_template_versions where template_id='${tpl}'`)).toBe(2);
    expect(await h.fails("A", `insert into crm_doc_templates (name, body, origin) values ('Model X','...','comercialitzadora')`)).toMatch(/check constraint/);   // cal indicar l'origen
  });
  it("un document generat només es pot crear amb una versió autoritzada de la plantilla", async () => {
    const ins = (v: number) => `insert into crm_generated_documents (expedient_id, template_id, template_version, document_id, version, data_sha256, generated_by) values ('${exp}','${tpl}',${v},'${doc}',1,'h','${U.C1}')`;
    expect(await h.fails("C1", ins(2))).toMatch(/row-level security/);   // v2 encara no autoritzada
    await h.as("A", `update crm_doc_templates set status='autoritzada' where id='${tpl}'`);
    expect(await h.fails("C1", ins(1))).toMatch(/row-level security/);   // versió antiga
    await h.as("C1", ins(2));
  });
  it("una signatura electrònica no es pot donar per bona des del CRM", async () => {
    const s = (await one<{ id: string }>("C1", `insert into crm_signature_requests (expedient_id, provider, signers, created_by) values ('${exp}','signaturit','[{"name":"Joan"}]','${U.C1}') returning id`)).id;
    expect(await h.fails("C1", `update crm_signature_requests set status='signada' where id='${s}'`)).toMatch(/avís verificat del proveïdor/);
    expect(await h.fails("B", `update crm_signature_requests set status='signada' where id='${s}'`)).toMatch(/avís verificat del proveïdor/);
    expect(await h.fails("C1", `update crm_expedients set status='signat' where id='${exp}'`)).toMatch(/Només Administració/);
    expect(await h.fails("B", `update crm_expedients set status='signat' where id='${exp}'`)).toMatch(/cap signatura confirmada/);
  });
  it("signatura manuscrita: només Administració, amb el document signat i justificació", async () => {
    expect(await h.fails("C1", `insert into crm_signature_requests (expedient_id, provider, status, signed_document_id, manual_justification, created_by) values ('${exp}','manual','signada','${doc}','Signat a l''oficina','${U.C1}')`)).toMatch(/Administració/);
    expect(await h.fails("B", `insert into crm_signature_requests (expedient_id, provider, status, created_by) values ('${exp}','manual','signada','${U.B}')`)).toMatch(/document signat/);
    await h.as("B", `insert into crm_signature_requests (expedient_id, provider, status, signed_document_id, manual_justification, created_by) values ('${exp}','manual','signada','${doc}','Signat presencialment a l''oficina','${U.B}')`);
    await h.as("B", `update crm_expedients set status='signat' where id='${exp}'`);
    const e = await one<{ status: string; signed_at: string | null }>("B", `select status, signed_at from crm_expedients where id='${exp}'`);
    expect(e.status).toBe("signat");
    expect(e.signed_at).toBeTruthy();
    expect(await h.fails("B", `update crm_signature_requests set status='cancellada' where provider='manual' and expedient_id='${exp}'`)).toMatch(/no es pot desfer/);
  });
});

describe("010 · tramitació i activació", () => {
  it("no es pot saltar estats ni enviar sense data i receptor", async () => {
    expect(await h.fails("B", `update crm_expedients set status='en_tramitacio' where id='${exp}'`)).toMatch(/Transició no permesa/);
    expect(await h.fails("B", `update crm_expedients set status='enviat' where id='${exp}'`)).toMatch(/data d'enviament/);
    expect(await h.fails("C1", `update crm_expedients set sent_at=now(), sent_to='Iberdrola' where id='${exp}'`)).toMatch(/Només Administració/);
    await h.as("B", `update crm_expedients set sent_at=now(), sent_to='Iberdrola', external_ref='IB-778', status='enviat' where id='${exp}'`);
    await h.as("B", `update crm_expedients set status='en_tramitacio' where id='${exp}'`);
  });
  it("incidència: cal justificació i en resoldre-la no es pot avançar més enllà d'on era", async () => {
    expect(await h.fails("B", `update crm_expedients set status='incidencia' where id='${exp}'`)).toMatch(/justificació/);
    await h.as("B", `update crm_expedients set status='incidencia', status_note='La distribuïdora demana el CIE' where id='${exp}'`);
    const ev = await one<{ justification: string }>("C1", `select justification from crm_expedient_events where expedient_id='${exp}' and to_status='incidencia'`);
    expect(ev.justification).toBe("La distribuïdora demana el CIE");
    expect(await h.fails("B", `update crm_expedients set status='en_tramitacio', activated_at=current_date where id='${exp}'`)).toBeNull();   // torna on era
  });
  it("no es pot marcar com a activat sense la informació mínima", async () => {
    expect(await h.fails("B", `update crm_expedients set status='activat' where id='${exp}'`)).toMatch(/informació mínima d'activació/);
    expect(await h.fails("C1", `select public.crm_activate_expedient('${exp}', current_date, current_date, null, 'comercialitzadora', 'R1', null)`)).toMatch(/Només Administració/);
  });
  it("activació confirmada: contracte nou, l'anterior es conserva i la comissió continua pendent", async () => {
    const newId = (await one<{ id: string }>("B", `select public.crm_activate_expedient('${exp}', current_date, current_date, (current_date + 365), 'comercialitzadora', 'ALTA-991', 'Confirmat per correu de la comercialitzadora') as id`)).id;
    const k = await one<{ status: string; previous_contract_id: string; retailer: string; expedient_id: string }>("B", `select * from crm_contracts where id='${newId}'`);
    expect(k).toMatchObject({ status: "actiu", previous_contract_id: oldContract, retailer: "Iberdrola", expedient_id: exp });
    expect((await one<{ status: string; retailer: string }>("B", `select status, retailer from crm_contracts where id='${oldContract}'`))).toMatchObject({ status: "finalitzat", retailer: "Endesa" });
    expect((await one<{ current_contract_id: string }>("B", `select current_contract_id from crm_supplies where id='${supply}'`)).current_contract_id).toBe(newId);
    const e = await one<{ status: string; activation_confirmed_by: string; contract_id: string }>("B", `select * from crm_expedients where id='${exp}'`);
    expect(e).toMatchObject({ status: "activat", activation_confirmed_by: U.B, contract_id: newId });
    const c = await one<{ contract_id: string; accrual_status: string; payment_status: string }>("B", `select * from crm_commission_records where expedient_id='${exp}'`);
    expect(c).toMatchObject({ contract_id: newId, accrual_status: "pendent", payment_status: "pendent" });
    expect(await h.count("C1", `select * from crm_expedient_events where expedient_id='${exp}' and type='activacio'`)).toBe(1);
    expect(await h.count("C1", `select * from crm_expedient_refs where expedient_id='${exp}' and ref='ALTA-991'`)).toBe(1);
  });
  it("l'historial és immutable i els comercials no hi poden escriure canvis d'estat", async () => {
    expect((await h.as("B", `update crm_expedient_events set title='x' where expedient_id='${exp}' returning id`)).rows).toHaveLength(0);
    await expect(h.db.exec(`update crm_expedient_events set title='x' where expedient_id='${exp}'`)).rejects.toThrow(/immutable/);
    expect(await h.fails("C1", `insert into crm_expedient_events (expedient_id, type, title, user_id) values ('${exp}','estat','Fals','${U.C1}')`)).toMatch(/row-level security/);
    await h.as("C1", `insert into crm_expedient_events (expedient_id, type, title, user_id) values ('${exp}','nota','Trucada al client','${U.C1}')`);
    expect(await h.count("C2", `select * from crm_expedient_events where expedient_id='${exp}'`)).toBe(0);
  });
  it("rebuig: cal motiu", async () => {
    const e2 = (await one<{ id: string }>("C1", `insert into crm_expedients (client_id, service, retailer, owner_id, created_by) values ('${client}','gas','Naturgy','${U.C1}','${U.C1}') returning id`)).id;
    expect(await h.fails("B", `update crm_expedients set status='rebutjat', status_note='x' where id='${e2}'`)).toMatch(/motiu del rebuig/);
    await h.as("B", `update crm_expedients set status='rebutjat', rejection_reason='CUPS amb deute', status_note='Rebutjat per la comercialitzadora' where id='${e2}'`);
    expect(await h.fails("C1", `update crm_expedients set status='pendent_documentacio', status_note='reobrir' where id='${e2}'`)).toMatch(/Només Administració/);
  });
});

describe("010 · reversió", () => {
  it("la migració es pot desfer i conserva els contractes", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/010_crm_contractacio_down.sql`, "utf8"));
    const r = await h.db.query<{ n: number }>(`select count(*)::int as n from crm_contracts where retailer='Iberdrola'`);
    expect(r.rows[0].n).toBe(1);
    const t = await h.db.query(`select 1 from information_schema.tables where table_name='crm_expedients'`);
    expect(t.rows).toHaveLength(0);
    await h.db.exec(fs.readFileSync(`${dir}/010_crm_contractacio.sql`, "utf8"));   // es pot tornar a aplicar
  });
});
