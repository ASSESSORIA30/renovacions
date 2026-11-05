/**
 * Migració 012 (Fase 5: Intel·ligència IA) sobre PostgreSQL real (PGlite): RLS, integritat i compatibilitat.
 * Usuaris: Direcció (A), Administració (B), comercials (C1, C2) i col·laborador (K).
 * `sys()` simula el motor (client de servei, sense usuari).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS, U, setup } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let client = "", client2 = "", supply = "", contract = "", opp = "", opp2 = "", run = "", rec = "", draft = "";
const sys = async <T = Record<string, unknown>>(sql: string) => {
  await h.db.exec(`reset role; select set_config('request.jwt.uid', '', false);`);
  return (await h.db.query<T>(sql)).rows;
};
const one = async <T = Record<string, unknown>>(who: Parameters<typeof h.as>[0], sql: string) => (await h.as<T>(who, sql)).rows[0];

beforeAll(async () => {
  h = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "011_crm_economia.sql", "012_ai_intelligence.sql", "012_ai_intelligence.sql"]);
  client = (await one<{ id: string }>("C1", `insert into crm_clients (name, owner_id, collaborator_id) values ('Forn SL','${U.C1}','${U.K}') returning id`)).id;
  client2 = (await one<{ id: string }>("C2", `insert into crm_clients (name, owner_id) values ('Taller C2','${U.C2}') returning id`)).id;
  supply = (await one<{ id: string }>("C1", `insert into crm_supplies (client_id, cups, access_tariff, power_kw, annual_kwh) values ('${client}','ES0031400000000001AB','2.0TD','{4.6,4.6}',3000) returning id`)).id;
  contract = (await one<{ id: string }>("C1", `insert into crm_contracts (client_id, supply_id, retailer, status, end_date, owner_id) values ('${client}','${supply}','Endesa','actiu','2027-01-15','${U.C1}') returning id`)).id;
  run = (await sys<{ id: string }>(`insert into ai_analysis_runs (trigger) values ('manual') returning id`))[0].id;
  opp = (await sys<{ id: string }>(`insert into ai_opportunities (kind, dedupe_key, client_id, supply_id, contract_id, owner_id, title, score, business_value, potential_saving_eur, saving_status, first_run_id, last_run_id) values ('renovacio','renovacio:${contract}:2027-01-15','${client}','${supply}','${contract}','${U.C1}','Renovació Endesa · Forn SL', 72, 40, 180.50, 'estimat', '${run}', '${run}') returning id`))[0].id;
  opp2 = (await sys<{ id: string }>(`insert into ai_opportunities (kind, dedupe_key, client_id, owner_id, title, score) values ('venda_creuada','venda_creuada:${client2}:2026','${client2}','${U.C2}','Comprovar interès · Taller', 30) returning id`))[0].id;
  await sys(`insert into ai_opportunity_economics (opportunity_id, layer, beneficiary_id, amount, status) values ('${opp}','proveidor',null,300,'estimat'),('${opp}','comercial','${U.C1}',12,'estimat'),('${opp}','marge',null,288,'estimat')`);
  const snap = (await sys<{ id: string }>(`insert into tariff_snapshots (sha256, as_of, versions, offers, offer_count) values ('abc','2026-11-01','[]','[]',0) returning id`))[0].id;
  rec = (await sys<{ id: string }>(`insert into ai_recommendations (opportunity_id, run_id, tariff_snapshot_id, engine_version, input_hash, inputs, alternatives) values ('${opp}','${run}','${snap}','ia-1.0.0','h1','{}','[{"offerId":"A"}]') returning id`))[0].id;
  await sys(`update ai_analysis_runs set status='ok' where id='${run}'`);
}, 120_000);

describe("20 · Compatibilitat amb les fases anteriors", () => {
  it("la migració 012 és idempotent i reversible (down + up)", async () => {
    const h2 = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "011_crm_economia.sql", "012_ai_intelligence.sql", "012_ai_intelligence_down.sql", "012_ai_intelligence.sql"]);
    expect((await h2.as<{ n: number }>("A", `select count(*)::int n from crm_automation_rules where key like 'ai_%'`)).rows[0].n).toBe(5);
    expect((await h2.as<{ n: number }>("A", `select count(*)::int n from crm_automation_rules`)).rows[0].n).toBeGreaterThanOrEqual(6 + 6 + 8 + 5);
  }, 120_000);
  it("les taules i fluxos de les fases 1-4 continuen funcionant", async () => {
    const o = await one<{ id: string }>("C1", `insert into crm_opportunities (client_id, title, service, owner_id) values ('${client}','Gas Forn','gas','${U.C1}') returning id`);
    expect(o.id).toBeTruthy();
    const e = await one<{ code: string }>("C1", `insert into crm_expedients (client_id, service, retailer, owner_id) values ('${client}','gas','Nufri','${U.C1}') returning code`);
    expect(e.code).toMatch(/^EXP-\d{4}-\d{5}$/);
    expect(await h.count("A", `select 1 from fin_rules`)).toBe(13);
    expect((await one<{ commercial_opt_out: boolean; contact_preference: string }>("C1", `select commercial_opt_out, contact_preference from crm_clients where id='${client}'`))).toEqual({ commercial_opt_out: false, contact_preference: "qualsevol" });
  });
});

describe("12-13 · Permisos: cadascú veu només el que li correspon", () => {
  it("el comercial veu les oportunitats dels seus clients; no les d'altres comercials", async () => {
    expect(await h.count("C1", `select 1 from ai_opportunities`)).toBe(1);
    expect(await h.count("C2", `select 1 from ai_opportunities where id='${opp}'`)).toBe(0);
    expect(await h.count("A", `select 1 from ai_opportunities`)).toBe(2);
    expect(await h.count("C1", `select 1 from ai_recommendations where opportunity_id='${opp}'`)).toBe(1);
    expect(await h.count("C2", `select 1 from ai_recommendations where opportunity_id='${opp}'`)).toBe(0);
  });
  it("economia: Direcció ho veu tot; el comercial només la seva comissió; col·laborador i altres comercials, res", async () => {
    expect(await h.count("A", `select 1 from ai_opportunity_economics where opportunity_id='${opp}'`)).toBe(3);
    expect((await h.as<{ layer: string }>("C1", `select layer from ai_opportunity_economics where opportunity_id='${opp}'`)).rows.map((r) => r.layer)).toEqual(["comercial"]);
    expect(await h.count("K", `select 1 from ai_opportunity_economics`)).toBe(0);
    expect(await h.count("K", `select 1 from ai_opportunities where id='${opp}'`)).toBe(1); // veu l'oportunitat del client aportat…
    expect(await h.count("C2", `select 1 from ai_opportunity_economics`)).toBe(0);
  });
  it("les execucions del motor i els registres només els veu l'equip d'administració", async () => {
    expect(await h.count("B", `select 1 from ai_analysis_runs`)).toBe(1);
    expect(await h.count("C1", `select 1 from ai_analysis_runs`)).toBe(0);
    expect(await h.count("K", `select 1 from tariff_snapshots`)).toBe(0);
  });
  it("converses del copilot privades (Direcció pot auditar)", async () => {
    const c = await one<{ id: string }>("C1", `insert into ai_conversations (user_id, title) values ('${U.C1}','Renovacions') returning id`);
    await sys(`insert into ai_messages (conversation_id, role, content) values ('${c.id}','user','Quins contractes vencen?')`);
    expect(await h.count("C1", `select 1 from ai_messages where conversation_id='${c.id}'`)).toBe(1);
    expect(await h.count("C2", `select 1 from ai_messages where conversation_id='${c.id}'`)).toBe(0);
    expect(await h.count("A", `select 1 from ai_messages where conversation_id='${c.id}'`)).toBe(1);
    expect(await h.fails("C2", `insert into ai_conversations (user_id, title) values ('${U.C1}','suplantació')`)).toMatch(/row-level security/);
  });
});

describe("14 · Accions sensibles: només les registra el servidor; les dades del motor no es manipulen", () => {
  it("cap usuari pot inserir execucions d'eines ni recomanacions (només el servidor)", async () => {
    expect(await h.fails("C1", `insert into ai_tool_executions (user_id, tool, status) values ('${U.C1}','crear_tasca','executada')`)).toMatch(/row-level security/);
    expect(await h.fails("C1", `insert into ai_recommendations (opportunity_id, engine_version, input_hash, inputs) values ('${opp}','x','y','{}')`)).toMatch(/row-level security/);
    await sys(`insert into ai_tool_executions (user_id, tool, status, sensitive, confirm_hash) values ('${U.C1}','crear_tasca','proposada',true,'hash')`);
    expect(await h.count("C1", `select 1 from ai_tool_executions`)).toBe(1);
    expect(await h.count("C2", `select 1 from ai_tool_executions`)).toBe(0);
  });
  it("una persona només en canvia l'estat; descartar exigeix motiu; «guanyada» només des de l'oportunitat comercial", async () => {
    expect(await h.fails("C1", `update ai_opportunities set score=99 where id='${opp}'`)).toMatch(/només les actualitza el motor/);
    expect(await h.fails("C1", `update ai_opportunities set potential_saving_eur=9999 where id='${opp}'`)).toMatch(/motor/);
    expect(await h.fails("C1", `update ai_opportunities set status='descartada' where id='${opp}'`)).toMatch(/motiu/);
    expect(await h.fails("C1", `update ai_opportunities set status='guanyada' where id='${opp}'`)).toMatch(/oportunitat comercial/);
    const r = await one<{ status: string; reviewed_by: string }>("C1", `update ai_opportunities set status='revisada' where id='${opp}' returning status, reviewed_by`);
    expect(r).toEqual({ status: "revisada", reviewed_by: U.C1 });
    expect((await h.as("K", `update ai_opportunities set status='nova' where id='${opp}' returning id`)).rows).toHaveLength(0); // col·laborador: només lectura
    expect((await h.as("C2", `update ai_opportunities set status='nova' where id='${opp}' returning id`)).rows).toHaveLength(0);
  });
  it("recomanacions, puntuacions i instantànies de tarifes són immutables (reproduïbles)", async () => {
    expect(await h.db.exec(`update ai_recommendations set alternatives='[]' where id='${rec}'`).then(() => null, (e: Error) => e.message)).toMatch(/append-only|només|immutable|no es pot/i);
    expect(await h.db.exec(`update tariff_snapshots set offer_count=9`).then(() => null, (e: Error) => e.message)).toMatch(/immutable/);
  });
});

describe("2 · Prevenció de duplicats a la base de dades", () => {
  it("una sola oportunitat per clau (contracte i cicle)", async () => {
    expect(await sys(`insert into ai_opportunities (kind, dedupe_key, client_id, title) values ('renovacio','renovacio:${contract}:2027-01-15','${client}','dup')`).then(() => null, (e: Error) => e.message)).toMatch(/duplicate key/);
    expect(await sys(`insert into ai_recommendations (opportunity_id, engine_version, input_hash, inputs) values ('${opp}','ia','h1','{}')`).then(() => null, (e: Error) => e.message)).toMatch(/duplicate key/);
  });
  it("tasques automàtiques i registres d'automatització idempotents per clau", async () => {
    await sys(`insert into crm_tasks (client_id, title, assigned_to, kind, source, rule_key) values ('${client}','Preparar la renovació','${U.C1}','renovacio','automatica','ai:renovacio:${contract}:2027-01-15')`);
    expect(await sys(`insert into crm_tasks (client_id, title, assigned_to, kind, source, rule_key) values ('${client}','x','${U.C1}','renovacio','automatica','ai:renovacio:${contract}:2027-01-15')`).then(() => null, (e: Error) => e.message)).toMatch(/duplicate key/);
    await sys(`insert into ai_automation_logs (rule_key, idempotency_key, action) values ('ai_motor','k1','detectada') on conflict (idempotency_key) do nothing`);
    await sys(`insert into ai_automation_logs (rule_key, idempotency_key, action) values ('ai_motor','k1','detectada') on conflict (idempotency_key) do nothing`);
    expect((await sys<{ n: number }>(`select count(*)::int n from ai_automation_logs where idempotency_key='k1'`))[0].n).toBe(1);
  });
});

describe("18 · Automatitzacions: bloqueig, retenció i regles", () => {
  it("només una anàlisi en curs alhora", async () => {
    await sys(`insert into ai_analysis_runs (trigger) values ('cron')`);
    expect(await sys(`insert into ai_analysis_runs (trigger) values ('manual')`).then(() => null, (e: Error) => e.message)).toMatch(/duplicate key/);
    await sys(`update ai_analysis_runs set status='ok' where status='en_curs'`);
  });
  it("retenció: només el servidor purga, i només el que ha caducat", async () => {
    const c = (await sys<{ id: string }>(`insert into ai_conversations (user_id, title, retain_until) values ('${U.C2}','vella', now() - interval '1 day') returning id`))[0].id;
    expect(await h.fails("C2", `select ai_purge_expired()`)).toMatch(/permission denied/);
    const n = (await sys<{ n: number }>(`select ai_purge_expired() n`))[0].n;
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await sys(`select 1 from ai_conversations where id='${c}'`)).length).toBe(0);
    expect((await sys(`select 1 from ai_conversations where user_id='${U.C1}'`)).length).toBe(1); // les vigents es conserven
  });
  it("regles noves: esborranys automàtics i escenari SAS desactivats per defecte; només Direcció les modifica", async () => {
    const r = (await h.as<{ key: string; enabled: boolean }>("A", `select key, enabled from crm_automation_rules where key like 'ai_%' order by key`)).rows;
    expect(r).toEqual([{ key: "ai_esborranys_auto", enabled: false }, { key: "ai_motor", enabled: true }, { key: "ai_puntuacio", enabled: true }, { key: "ai_retencio", enabled: true }, { key: "ai_sas_escenari", enabled: false }]);
    expect((await h.as("C1", `update crm_automation_rules set enabled=true where key='ai_esborranys_auto' returning key`)).rows).toHaveLength(0);
  });
  it("preferències de contacte validades", async () => {
    expect(await h.fails("C1", `update crm_clients set contact_preference='fax' where id='${client}'`)).toMatch(/check constraint/);
    await h.as("C1", `update crm_clients set commercial_opt_out=true, contact_preference='cap' where id='${client}'`);
    await h.as("C1", `update crm_clients set commercial_opt_out=false, contact_preference='qualsevol' where id='${client}'`);
  });
});

describe("10-11 · 16 · Propostes i integració amb contractació", () => {
  it("l'esborrany es vincula al client i al document; només s'aprova (no s'envia) des de la interfície", async () => {
    const doc = await one<{ id: string }>("C1", `insert into crm_documents (client_id, supply_id, category, title, original_name, mime, size_bytes, sha256, storage_path, uploaded_by) values ('${client}','${supply}','proposta','Proposta PROP-1 (ESBORRANY)','p.pdf','application/pdf',1000,'x','${client}/d/v1.pdf','${U.C1}') returning id`);
    draft = (await sys<{ id: string }>(`insert into ai_proposal_drafts (opportunity_id, recommendation_id, client_id, document_id, valid_until, alternatives, created_by) values ('${opp}','${rec}','${client}','${doc.id}','2026-11-16','[{"offerId":"A"}]','${U.C1}') returning id`))[0].id;
    expect(await h.count("C1", `select 1 from ai_proposal_drafts d join crm_documents c on c.id=d.document_id where c.client_id='${client}' and c.category='proposta'`)).toBe(1);
    expect(await h.count("C2", `select 1 from ai_proposal_drafts`)).toBe(0);
    expect((await h.as("K", `update ai_proposal_drafts set status='aprovada' where id='${draft}' returning id`)).rows).toHaveLength(0);
    expect(await h.fails("C1", `update ai_proposal_drafts set status='acceptada' where id='${draft}'`)).toMatch(/no permès/);
    expect(await h.fails("C1", `update ai_proposal_drafts set alternatives='[]' where id='${draft}'`)).toMatch(/no es modifica/);
    const a = await one<{ status: string; approved_by: string }>("C1", `update ai_proposal_drafts set status='aprovada' where id='${draft}' returning status, approved_by`);
    expect(a).toEqual({ status: "aprovada", approved_by: U.C1 });
    expect(await h.fails("C1", `update ai_proposal_drafts set status='enviada' where id='${draft}'`)).toMatch(/el registra el sistema/);
    const s = (await sys<{ status: string; sent_at: string }>(`update ai_proposal_drafts set status='enviada' where id='${draft}' returning status, sent_at`))[0];
    expect(s.status).toBe("enviada");
    expect(s.sent_at).toBeTruthy();
  });
  it("acceptar → una sola oportunitat comercial vinculada; guanyar-la marca l'oportunitat IA com a guanyada", async () => {
    const crm = await one<{ id: string }>("C1", `insert into crm_opportunities (client_id, supply_id, title, service, owner_id, ai_opportunity_id, stage) values ('${client}','${supply}','Renovació Endesa','llum_empresa','${U.C1}','${opp}','estudi') returning id`);
    expect(await h.fails("C1", `insert into crm_opportunities (client_id, title, service, owner_id, ai_opportunity_id) values ('${client}','dup','llum_empresa','${U.C1}','${opp}')`)).toMatch(/duplicate key/);
    await h.as("C1", `update ai_opportunities set status='acceptada', crm_opportunity_id='${crm.id}' where id='${opp}'`);
    expect(await h.fails("C1", `update ai_opportunities set crm_opportunity_id=null where id='${opp}'`)).toMatch(/ja està vinculada/);
    await h.as("C1", `update crm_opportunities set stage='guanyat' where id='${crm.id}'`);
    expect((await one<{ status: string }>("C1", `select status from ai_opportunities where id='${opp}'`)).status).toBe("guanyada");
    // l'expedient es crea des de l'oportunitat guanyada, sense duplicar client ni CUPS
    const e = await one<{ client_id: string; supply_id: string }>("C1", `insert into crm_expedients (client_id, supply_id, opportunity_id, service, retailer, owner_id) values ('${client}','${supply}','${crm.id}','llum_empresa','Nufri','${U.C1}') returning client_id, supply_id`);
    expect(e).toEqual({ client_id: client, supply_id: supply });
    expect((await sys<{ n: number }>(`select count(*)::int n from crm_supplies where cups20='ES0031400000000001AB'`))[0].n).toBe(1);
  });
  it("una oportunitat comercial perduda descarta l'oportunitat IA vinculada", async () => {
    const crm = await one<{ id: string }>("C2", `insert into crm_opportunities (client_id, title, service, owner_id, ai_opportunity_id) values ('${client2}','Fibra','fibra_telefonia','${U.C2}','${opp2}') returning id`);
    await h.as("C2", `update crm_opportunities set stage='perdut', lost_reason='Ara no' where id='${crm.id}'`);
    expect((await one<{ status: string; status_reason: string }>("C2", `select status, status_reason from ai_opportunities where id='${opp2}'`))).toEqual({ status: "descartada", status_reason: "Oportunitat comercial perduda: Ara no" });
  });
});

describe("17 · Comissions potencials: sempre estimades, mai cobrades", () => {
  it("l'estat de cobrament per defecte és «no meritat» i els estats permesos són d'estimació", async () => {
    expect((await sys<{ c: string }>(`select distinct collection_status c from ai_opportunity_economics`)).map((r) => r.c)).toEqual(["no_meritat"]);
    expect(await sys(`insert into ai_opportunity_economics (opportunity_id, layer, amount, status) values ('${opp2}','proveidor',10,'cobrat')`).then(() => null, (e: Error) => e.message)).toMatch(/check constraint/);
  });
});
