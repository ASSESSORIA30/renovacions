/**
 * Migració 009 (CRM Fase 2: leads, oportunitats, automatitzacions, notificacions i objectius) sobre PostgreSQL real (PGlite).
 * Usuaris: Direcció (A), Administració (B), comercials (C1, C2) i col·laborador (K).
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { MIGRATIONS, U, dir, setup } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let lead = "", opp = "", client = "", kLead = "", kOpp = "";

beforeAll(async () => {
  h = await setup([...MIGRATIONS, "009_crm_comercial.sql", "009_crm_comercial.sql"]);
  client = (await h.as<{ id: string }>("C1", `insert into crm_clients (name, owner_id) values ('Client C1','${U.C1}') returning id`)).rows[0].id;
}, 120_000);

describe("009 · leads i oportunitats", () => {
  it("un comercial crea un lead propi però no en pot crear per a un altre", async () => {
    lead = (await h.as<{ id: string }>("C1", `insert into crm_leads (name, phone, owner_id, created_by, services) values ('Bar Pepe','+34600112233','${U.C1}','${U.C1}','{gas,llum_empresa}') returning id`)).rows[0].id;
    expect(lead).toBeTruthy();
    expect(await h.fails("C1", `insert into crm_leads (name, owner_id, created_by) values ('X','${U.C2}','${U.C1}')`)).toMatch(/row-level security/);
    expect(await h.fails("C1", `insert into crm_leads (name, owner_id, created_by, services) values ('X','${U.C1}','${U.C1}','{piscines}')`)).toMatch(/check constraint/);
  });
  it("un altre comercial no veu el lead; Administració sí", async () => {
    expect(await h.count("C2", `select * from crm_leads where id='${lead}'`)).toBe(0);
    expect(await h.count("B", `select * from crm_leads where id='${lead}'`)).toBe(1);
    expect((await h.as("C2", `update crm_leads set notes='x' where id='${lead}' returning id`)).rows).toHaveLength(0);
  });
  it("oportunitat a partir del lead (encara sense client)", async () => {
    opp = (await h.as<{ id: string }>("C1", `insert into crm_opportunities (lead_id, title, service, owner_id, created_by, annual_kwh, commission_eur, probability) values ('${lead}','Gas Bar Pepe','gas','${U.C1}','${U.C1}', 45000, 180, 40) returning id`)).rows[0].id;
    const r = (await h.as<{ mwh: string; version: number }>("C1", `select mwh, version from crm_opportunities where id='${opp}'`)).rows[0];
    expect(Number(r.mwh)).toBe(45);
    expect(await h.count("C2", `select * from crm_opportunities where id='${opp}'`)).toBe(0);
    expect(await h.fails("C1", `insert into crm_opportunities (title, service, owner_id, created_by) values ('Sense client ni lead','gas','${U.C1}','${U.C1}')`)).toMatch(/check constraint/);
  });
  it("moure l'oportunitat registra l'historial, incrementa la versió i fixa les dates", async () => {
    await h.as("C1", `update crm_opportunities set stage='contactat' where id='${opp}'`);
    await h.as("C1", `update crm_opportunities set stage='proposta_enviada' where id='${opp}'`);
    const o = (await h.as<{ version: number; proposal_sent_at: string | null }>("C1", `select version, proposal_sent_at from crm_opportunities where id='${opp}'`)).rows[0];
    expect(o.version).toBe(3);
    expect(o.proposal_sent_at).not.toBeNull();
    const acts = (await h.as<{ title: string; lead_id: string }>("C1", `select title, lead_id from crm_activities where opportunity_id='${opp}' order by at`)).rows;
    expect(acts.map((a) => a.title)).toEqual(["Gas Bar Pepe: Nou lead → Contactat", "Gas Bar Pepe: Contactat → Proposta enviada"]);
    expect(acts[0].lead_id).toBe(lead);
    // una activitat o una actualització sense canvis no altera la versió (el Kanban no dona falsos conflictes)
    await h.as("C1", `update crm_opportunities set notes=notes where id='${opp}'`);
    await h.as("C1", `insert into crm_activities (lead_id, opportunity_id, type, title, user_id) values ('${lead}','${opp}','nota','Nota','${U.C1}')`);
    expect((await h.as<{ version: number }>("C1", `select version from crm_opportunities where id='${opp}'`)).rows[0].version).toBe(3);
    expect((await h.as<{ ok: boolean }>("C1", `select public.crm_can_edit_opportunity('${opp}') as ok`)).rows[0].ok).toBe(true);
    expect((await h.as<{ ok: boolean }>("C2", `select public.crm_can_edit_opportunity('${opp}') as ok`)).rows[0].ok).toBe(false);
    expect((await h.as("C2", `update crm_opportunities set stage='guanyat' where id='${opp}' returning id`)).rows).toHaveLength(0);
    expect(await h.fails("C1", `update crm_opportunities set owner_id='${U.C2}' where id='${opp}'`)).toMatch(/reassignar/);
  });
  it("una trucada al lead el marca com a contactat i actualitza l'activitat de l'oportunitat", async () => {
    await h.as("C1", `insert into crm_activities (lead_id, opportunity_id, type, title, outcome, user_id, at) values ('${lead}','${opp}','trucada','Trucada','interessat','${U.C1}', now() + interval '1 minute')`);
    const l = (await h.as<{ status: string; first_contact_at: string | null }>("C1", `select status, first_contact_at from crm_leads where id='${lead}'`)).rows[0];
    expect(l.status).toBe("contactat");
    expect(l.first_contact_at).not.toBeNull();
    expect(await h.fails("C2", `insert into crm_activities (lead_id, type, title, user_id) values ('${lead}','nota','x','${U.C2}')`)).toMatch(/row-level security/);
    expect(await h.fails("C1", `insert into crm_activities (type, title, user_id) values ('nota','orfe','${U.C1}')`)).toMatch(/row-level security|check/);
  });
  it("guanyar fixa won_at i probabilitat 100; convertir a client relaciona la mateixa oportunitat", async () => {
    await h.as("C1", `update crm_opportunities set stage='guanyat' where id='${opp}'`);
    const o = (await h.as<{ won_at: string | null; probability: number }>("C1", `select won_at, probability from crm_opportunities where id='${opp}'`)).rows[0];
    expect(o.won_at).not.toBeNull();
    expect(o.probability).toBe(100);
    await h.as("C1", `update crm_leads set status='convertit', converted_client_id='${client}' where id='${lead}'`);
    expect((await h.as("C1", `update crm_opportunities set client_id='${client}' where id='${opp}' returning id`)).rows).toHaveLength(1);
    expect(await h.count("C2", `select * from crm_opportunities where id='${opp}'`)).toBe(0);
  });
  it("el col·laborador aporta leads i oportunitats però no les mou", async () => {
    kLead = (await h.as<{ id: string }>("K", `insert into crm_leads (name, collaborator_id, created_by) values ('Lead de K','${U.K}','${U.K}') returning id`)).rows[0].id;
    kOpp = (await h.as<{ id: string }>("K", `insert into crm_opportunities (lead_id, title, service, collaborator_id, created_by) values ('${kLead}','Alarma','alarmes','${U.K}','${U.K}') returning id`)).rows[0].id;
    expect(await h.count("K", `select * from crm_opportunities where id='${kOpp}'`)).toBe(1);
    expect((await h.as("K", `update crm_opportunities set stage='contactat' where id='${kOpp}' returning id`)).rows).toHaveLength(0);
    expect(await h.count("C1", `select * from crm_leads where id='${kLead}'`)).toBe(0);
    await h.as("B", `update crm_leads set owner_id='${U.C1}' where id='${kLead}'`);
    expect(await h.count("C1", `select * from crm_leads where id='${kLead}'`)).toBe(1);
  });
});

describe("009 · tasques, automatitzacions, notificacions i objectius", () => {
  it("tasques d'oportunitat i idempotència per rule_key", async () => {
    await h.as("C1", `insert into crm_tasks (opportunity_id, title, kind, assigned_to, created_by, rule_key, source) values ('${opp}','Seguiment','seguiment','${U.C1}','${U.C1}','proposta:${opp}','automatica')`);
    expect(await h.fails("C1", `insert into crm_tasks (opportunity_id, title, assigned_to, created_by, rule_key) values ('${opp}','Duplicada','${U.C1}','${U.C1}','proposta:${opp}')`)).toMatch(/duplicate key/);
    expect(await h.fails("C1", `insert into crm_tasks (title, kind, assigned_to, created_by) values ('x','piscina','${U.C1}','${U.C1}')`)).toMatch(/check constraint/);
    expect(await h.count("C2", `select * from crm_tasks where opportunity_id='${opp}'`)).toBe(0);
  });
  it("notificacions: cadascú només les seves; una per regla i usuari", async () => {
    await h.db.exec(`insert into crm_notifications (user_id, kind, title, rule_key) values ('${U.C1}','avis','Lead sense contacte','lead:1'), ('${U.C2}','avis','Altre','lead:2')`);
    expect(await h.count("C1", `select * from crm_notifications`)).toBe(1);
    expect((await h.as("C1", `update crm_notifications set read_at=now() where user_id='${U.C2}' returning id`)).rows).toHaveLength(0);
    let dup = "";
    try { await h.db.exec(`insert into crm_notifications (user_id, kind, title, rule_key) values ('${U.C1}','avis','x','lead:1')`); } catch (e) { dup = (e as Error).message; }
    expect(dup).toMatch(/duplicate key/);
  });
  it("les regles només les configura Direcció", async () => {
    expect(await h.count("C1", `select * from crm_automation_rules`)).toBe(6);
    expect((await h.as("C1", `update crm_automation_rules set enabled=false where key='lead_sense_contacte' returning key`)).rows).toHaveLength(0);
    expect((await h.as("B", `update crm_automation_rules set enabled=false where key='lead_sense_contacte' returning key`)).rows).toHaveLength(0);
    expect((await h.as("A", `update crm_automation_rules set params='{"hours":12}' where key='lead_sense_contacte' returning key`)).rows).toHaveLength(1);
  });
  it("objectius: Administració els fixa; cada comercial veu els seus", async () => {
    await h.as("B", `insert into crm_targets (user_id, period, metric, target) values ('${U.C1}','2026-11','guanyades',10), ('${U.C2}','2026-11','guanyades',8)`);
    expect(await h.count("C1", `select * from crm_targets`)).toBe(1);
    expect(await h.fails("C1", `insert into crm_targets (user_id, period, metric, target) values ('${U.C1}','2026-12','guanyades',1)`)).toMatch(/row-level security/);
    expect(await h.count("A", `select * from crm_targets`)).toBe(2);
  });
  it("vincle massiu dels subministraments amb el contracte vigent", async () => {
    const s = (await h.as<{ id: string }>("C1", `insert into crm_supplies (client_id, cups) values ('${client}','ES0021000000000001AA') returning id`)).rows[0].id;
    await h.as("C1", `insert into crm_contracts (client_id, supply_id, retailer, status, end_date) values ('${client}','${s}','Iberdrola','actiu','2027-10-31')`);
    const n = (await h.db.query<{ n: number }>(`select public.crm_link_current_contracts(array['${s}']::uuid[]) as n`)).rows[0].n;
    expect(n).toBe(1);
  });
  it("la Fase 1 continua igual: activitat de client per a qui el veu", async () => {
    await h.as("C1", `insert into crm_activities (client_id, type, title, user_id) values ('${client}','nota','Nota','${U.C1}')`);
    expect(await h.fails("C2", `insert into crm_activities (client_id, type, title, user_id) values ('${client}','nota','x','${U.C2}')`)).toMatch(/row-level security/);
  });
  it("la migració es pot desfer i tornar a aplicar", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/009_crm_comercial_down.sql`, "utf8"));
    await h.db.exec(fs.readFileSync(`${dir}/009_crm_comercial.sql`, "utf8"));
    const t = await h.db.query<{ n: number }>(`select count(*)::int as n from crm_automation_rules`);
    expect(t.rows[0].n).toBe(6);
  });
});
