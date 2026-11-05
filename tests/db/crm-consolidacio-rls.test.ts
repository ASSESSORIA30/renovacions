/**
 * Migració 014 (Fase 7: consolidació, permisos per mòdul, supervisió i auditoria) sobre PostgreSQL real (PGlite).
 * Usuaris: Direcció (A), Administrativa (B), comercials (C1, C2) i col·laborador (K). Per provar la Cap
 * administrativa i una segona persona de Direcció es canvia el rol de B i C2 dins de cada prova.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { MIGRATIONS, U, dir, setup } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
let client1 = "", client2 = "", task1 = "", taskK = "", incident = "", settlement = "";
const sys = async <T = Record<string, unknown>>(sql: string) => {
  await h.db.exec(`reset role; select set_config('request.jwt.uid', '', false);`);
  return (await h.db.query<T>(sql)).rows;
};
const role = (who: keyof typeof U, r: string) => sys(`update profiles set role='${r}' where id='${U[who]}'`);

beforeAll(async () => {
  h = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "011_crm_economia.sql", "012_ai_intelligence.sql", "013_captacio.sql", "014_consolidacio.sql", "014_consolidacio.sql"]);
  client1 = (await sys<{ id: string }>(`insert into crm_clients (name, owner_id, collaborator_id) values ('Forn C1','${U.C1}','${U.K}') returning id`))[0].id;
  client2 = (await sys<{ id: string }>(`insert into crm_clients (name, owner_id) values ('Taller C2','${U.C2}') returning id`))[0].id;
  task1 = (await sys<{ id: string }>(`insert into crm_tasks (client_id, title, assigned_to, assigned_name, created_by) values ('${client1}','Revisar documentació','${U.B}','B','${U.A}') returning id`))[0].id;
  taskK = (await sys<{ id: string }>(`insert into crm_tasks (client_id, title, assigned_to, created_by, partner_visible, kind, area) values ('${client1}','Falta la factura de gas','${U.B}','${U.A}', true, 'sollicitud_externa', 'externa') returning id`))[0].id;
  incident = (await sys<{ id: string }>(`insert into crm_incidents (client_id, title, priority, created_by) values ('${client1}','Factura duplicada','urgent','${U.C1}') returning id`))[0].id;
  settlement = (await sys<{ id: string }>(`insert into fin_settlements (kind, beneficiary_id, period_from, period_to, created_by) values ('comercial','${U.C1}','2026-10-01','2026-10-31','${U.A}') returning id`))[0].id;
  await sys(`insert into fin_settlements (kind, beneficiary_id, period_from, period_to, created_by) values ('comercial','${U.C2}','2026-10-01','2026-10-31','${U.A}')`);
  await sys(`insert into fin_costs (client_id, concept, amount) values ('${client1}','Gestoria',120)`);
}, 120_000);

describe("1-2 · Direcció compartida: mateixos drets per a totes les persones amb rol Direcció", () => {
  it("dues persones de Direcció veuen exactament les mateixes dades econòmiques i tots els permisos", async () => {
    await role("C2", "admin");
    try {
      for (const who of ["A", "C2"] as const) {
        expect(await h.count(who, "select * from fin_settlements")).toBe(2);
        expect(await h.count(who, "select * from fin_costs")).toBe(1);
        const p = (await h.as<{ ok: boolean }>(who, "select public.has_perm('economia','approve') and public.has_perm('configuracio','edit') and public.has_perm('qualsevol_modul','approve') as ok")).rows[0];
        expect(p.ok).toBe(true);
      }
    } finally { await role("C2", "comercial"); }
  });
  it("la migració és idempotent (s'ha aplicat dues vegades) i no duplica polítiques", async () => {
    const r = await sys<{ n: number }>(`select count(*)::int as n from pg_policies where tablename = 'fin_settlements' and policyname like '%_read'`);
    expect(r[0].n).toBeLessThanOrEqual(1);
    expect((await sys<{ n: number }>(`select count(*)::int as n from role_permissions`))[0].n).toBeGreaterThan(30);
  });
});

describe("Dades econòmiques restringides: només amb autorització de Direcció", () => {
  it("la Cap administrativa NO veu liquidacions de tercers, costos ni economia per defecte", async () => {
    await role("B", "cap_administrativa");
    try {
      expect(await h.count("B", "select * from fin_settlements")).toBe(0);
      expect(await h.count("B", "select * from fin_costs")).toBe(0);
      const r = await h.as<{ n: number }>("B", `update fin_settlements set status='aprovada' where id='${settlement}' returning id`);
      expect(r.rows.length).toBe(0);
      expect(await h.fails("B", `select public.fin_build_settlement('comercial','${U.C1}','2026-10-01','2026-10-31')`)).toBeTruthy();
      // tampoc pot gestionar regles de comissió sense permís explícit
      expect((await h.as<{ ok: boolean }>("B", "select public.fin_can_manage_rules() as ok")).rows[0].ok).toBe(false);
    } finally { await role("B", "administrativa"); }
  });
  it("l'Administrativa no veu dades econòmiques ni liquidacions", async () => {
    expect(await h.count("B", "select * from fin_settlements")).toBe(0);
    expect(await h.count("B", "select * from fin_costs")).toBe(0);
    expect(await h.count("B", "select * from crm_contract_finance")).toBe(0);
  });
  it("Direcció autoritza la lectura a una persona concreta: la veu, però no pot modificar ni aprovar", async () => {
    await role("B", "cap_administrativa");
    try {
      await h.as("A", `insert into user_permissions (user_id, module, can_read) values ('${U.B}','economia', true)`);
      expect(await h.count("B", "select * from fin_settlements")).toBe(2);
      expect(await h.count("B", "select * from fin_costs")).toBe(1);
      const upd = await h.as("B", `update fin_settlements set status='aprovada' where id='${settlement}' returning id`);
      expect(upd.rows.length).toBe(0);
      expect(await h.fails("B", `delete from fin_costs`)).toBeNull();
      expect(await h.count("A", "select * from fin_costs")).toBe(1); // l'esborrat no ha afectat cap fila
      await h.as("A", `delete from user_permissions where user_id='${U.B}' and module='economia'`);
      expect(await h.count("B", "select * from fin_settlements")).toBe(0);
    } finally { await role("B", "administrativa"); }
  });
  it("el comercial continua veient NOMÉS la seva liquidació (mai la d'altres)", async () => {
    expect(await h.count("C1", "select * from fin_settlements")).toBe(1);
    expect((await h.as<{ beneficiary_id: string }>("C1", "select beneficiary_id from fin_settlements")).rows[0].beneficiary_id).toBe(U.C1);
    expect(await h.count("C1", "select * from fin_costs")).toBe(0);
  });
  it("ningú que no sigui Direcció pot canviar permisos (ni manipulant la petició)", async () => {
    for (const who of ["B", "C1", "K"] as const) {
      const r = await h.fails(who, `insert into user_permissions (user_id, module, can_read, can_edit, can_approve) values ('${U[who]}','economia', true, true, true)`);
      expect(r).toBeTruthy();
      const u = await h.as(who, `update role_permissions set can_read = true where module = 'economia' returning role`);
      expect(u.rows.length).toBe(0);
    }
    expect((await h.as<{ ok: boolean }>("C1", "select public.has_perm('economia','read') as ok")).rows[0].ok).toBe(false);
  });
});

describe("Auditoria de seguretat", () => {
  it("els canvis de permisos, de rol i els esborrats queden registrats i no es poden modificar", async () => {
    await h.as("A", `insert into user_permissions (user_id, module, can_read) values ('${U.C1}','informes', true)`);
    await h.as("A", `update profiles set role = 'comercial' where id = '${U.C2}'`); // sense canvi real: no registra
    await h.as("A", `update profiles set role = 'administrativa' where id = '${U.C2}'`);
    await h.as("A", `update profiles set role = 'comercial' where id = '${U.C2}'`);
    const tmp = (await sys<{ id: string }>(`insert into crm_tasks (title, created_by) values ('Temporal','${U.A}') returning id`))[0].id;
    // (les tasques no tenen política d'esborrat per a usuaris: es prova amb el servidor actuant en nom de Direcció)
    await h.db.exec(`reset role; select set_config('request.jwt.uid', '${U.A}', false); delete from crm_tasks where id = '${tmp}';`);
    expect(await h.count("A", `select * from crm_tasks where id = '${tmp}'`)).toBe(0);
    const rows = (await h.as<{ action: string; entity: string; actor_id: string }>("A", "select action, entity, actor_id from sec_audit order by id")).rows;
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["permis_usuari", "canvi_rol", "esborrat"]));
    expect(rows.filter((r) => r.action === "canvi_rol").length).toBe(2);
    expect(rows.every((r) => r.actor_id === U.A)).toBe(true);
    expect(await h.count("B", "select * from sec_audit")).toBe(0);
    expect(await h.count("C1", "select * from sec_audit")).toBe(0);
    // els usuaris no hi tenen cap política d'escriptura; i ni tan sols el servidor (clau de servei) pot alterar-la
    expect((await h.as("A", "delete from sec_audit returning id")).rows.length).toBe(0);
    expect(await sys("delete from sec_audit").then(() => null, (e: Error) => e.message)).toMatch(/no es pot modificar/);
    expect(await sys("update sec_audit set action = 'x'").then(() => null, (e: Error) => e.message)).toMatch(/no es pot modificar/);
  });
  it("l'aprovació d'una liquidació queda registrada", async () => {
    await h.as("A", `update fin_settlements set status='revisio' where id='${settlement}'`);
    await h.as("A", `update fin_settlements set status='aprovada', approved_amount = 0 where id='${settlement}'`);
    const r = await sys<{ n: number }>(`select count(*)::int as n from sec_audit where entity='fin_settlements' and action like 'liquidacio_%'`);
    expect(r[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe("3 · Gestor de tasques: assignació, historial i supervisió", () => {
  it("la Cap administrativa reassigna; l'Administrativa no pot reassignar tasques d'altres", async () => {
    const other = (await sys<{ id: string }>(`insert into crm_tasks (client_id, title, assigned_to, assigned_name, created_by) values ('${client1}','Tasca de C1','${U.C1}','C1','${U.A}') returning id`))[0].id;
    expect(await h.fails("B", `update crm_tasks set assigned_to='${U.B}' where id='${other}'`)).toMatch(/reassignar/);
    await role("B", "cap_administrativa");
    try {
      await h.as("B", `update crm_tasks set assigned_to='${U.C2}', assigned_name='C2', priority='alta' where id='${other}'`);
    } finally { await role("B", "administrativa"); }
    const ev = (await sys<{ type: string; from_value: string; to_value: string; user_id: string }>(`select type, from_value, to_value, user_id from crm_task_events where task_id='${other}' order by id`));
    expect(ev.map((e) => e.type)).toEqual(["creada", "assignacio", "prioritat"]);
    expect(ev[1]).toMatchObject({ from_value: "C1", to_value: "C2", user_id: U.B });
  });
  it("estats nous: en curs i bloquejada (amb motiu), i en tancar es marca la data", async () => {
    await h.as("B", `update crm_tasks set status='en_curs' where id='${task1}'`);
    await h.as("B", `update crm_tasks set status='bloquejada', blocked_reason='Esperant DNI del client' where id='${task1}'`);
    await h.as("B", `update crm_tasks set status='feta' where id='${task1}'`);
    const t = (await sys<{ started_at: string; completed_at: string; blocked_reason: string | null }>(`select started_at, completed_at, blocked_reason from crm_tasks where id='${task1}'`))[0];
    expect(t.started_at).toBeTruthy();
    expect(t.completed_at).toBeTruthy();
    expect(t.blocked_reason).toBeNull();
    const ev = await sys<{ type: string; note: string | null }>(`select type, note from crm_task_events where task_id='${task1}' and type in ('estat','bloqueig') order by id`);
    expect(ev.map((e) => e.type)).toEqual(["estat", "bloqueig", "estat"]);
    expect(ev[1].note).toBe("Esperant DNI del client");
    expect(await h.fails("B", `update crm_tasks set status='inventat' where id='${task1}'`)).toBeTruthy();
  });
  it("comentaris a l'historial: només a tasques visibles i només com a comentari", async () => {
    await h.as("B", `insert into crm_task_events (task_id, user_id, type, note) values ('${task1}','${U.B}','comentari','Trucat al client')`);
    expect(await h.fails("B", `insert into crm_task_events (task_id, user_id, type, to_value) values ('${task1}','${U.B}','estat','feta')`)).toBeTruthy();
    expect(await h.fails("C2", `insert into crm_task_events (task_id, user_id, type, note) values ('${task1}','${U.C2}','comentari','intrús')`)).toBeTruthy();
    expect(await h.count("C2", `select * from crm_task_events where task_id='${task1}'`)).toBe(0);
  });
});

describe("6-8 · Col·laborador: només les seves sol·licituds externes i incidències", () => {
  it("veu la sol·licitud externa del seu client però no les tasques internes", async () => {
    const ids = (await h.as<{ id: string }>("K", "select id from crm_tasks")).rows.map((r) => r.id);
    expect(ids).toContain(taskK);
    expect(ids).not.toContain(task1);
  });
  it("no veu incidències d'altres persones (encara que siguin del seu client)", async () => {
    expect(await h.count("K", `select * from crm_incidents where id='${incident}'`)).toBe(0);
    expect(await h.count("C1", `select * from crm_incidents where id='${incident}'`)).toBe(1);
  });
  it("no veu clients d'altres ni economia, ni pot llegir l'auditoria ni permisos d'altres", async () => {
    expect(await h.count("K", `select * from crm_clients where id='${client2}'`)).toBe(0);
    expect(await h.count("K", "select * from fin_costs")).toBe(0);
    expect(await h.count("K", "select * from user_permissions where user_id <> auth.uid()")).toBe(0);
  });
});

describe("Incidències: prioritat urgent, escalat i historial", () => {
  it("registra canvis d'estat, assignació i escalat", async () => {
    await h.as("A", `update crm_incidents set assigned_to='${U.B}', assigned_name='B', status='en_curs' where id='${incident}'`);
    await sys(`update crm_incidents set escalation_level = 1, escalated_at = now() where id='${incident}'`);
    await h.as("A", `update crm_incidents set status='resolta', resolution='Abonament emès' where id='${incident}'`);
    const ev = await sys<{ type: string; note: string | null }>(`select type, note from crm_incident_events where incident_id='${incident}' order by id`);
    expect(ev.map((e) => e.type)).toEqual(["creada", "estat", "assignacio", "escalada", "estat"]);
    expect(ev[4].note).toBe("Abonament emès");
  });
});

describe("Preferències i configuració de seguretat", () => {
  it("cada usuari només veu i desa el seu panell; només Direcció canvia la configuració MFA", async () => {
    await h.as("C1", `insert into user_dashboard_prefs (user_id, layout) values ('${U.C1}','{"hidden":["mwh"]}')`);
    expect(await h.count("C2", "select * from user_dashboard_prefs")).toBe(0);
    expect(await h.fails("C2", `insert into user_dashboard_prefs (user_id, layout) values ('${U.C1}','{}')`)).toBeTruthy();
    expect((await h.as("B", `update sec_settings set value='{"enforced":false,"roles":[]}' where key='mfa' returning key`)).rows.length).toBe(0);
    expect((await h.as("A", `update sec_settings set value='{"enforced":false,"roles":["admin"]}' where key='mfa' returning key`)).rows.length).toBe(1);
  });
  it("noves regles d'alerta i renovacions a 120 dies", async () => {
    const r = await sys<{ key: string; params: Record<string, unknown> }>(`select key, params from crm_automation_rules where key in ('tasca_vencuda','incidencia_urgent','error_integracio','venciment_contracte') order by key`);
    expect(r.map((x) => x.key)).toEqual(["error_integracio", "incidencia_urgent", "tasca_vencuda", "venciment_contracte"]);
    expect(r.find((x) => x.key === "venciment_contracte")!.params).toEqual({ days: [120, 90, 60, 30] });
  });
});

describe("Migració de retorn (down) i reaplicació", () => {
  it("el down torna la visibilitat econòmica de la Fase 6 sense perdre l'auditoria, i el 014 es pot tornar a aplicar", async () => {
    const g = await setup([...MIGRATIONS, "009_crm_comercial.sql", "010_crm_contractacio.sql", "011_crm_economia.sql", "012_ai_intelligence.sql", "013_captacio.sql", "014_consolidacio.sql"]);
    const q = async (sql: string) => { await g.db.exec(`reset role; select set_config('request.jwt.uid', '', false);`); return (await g.db.query(sql)).rows; };
    await q(`insert into crm_clients (name) values ('Client')`);
    await q(`insert into fin_costs (client_id, concept, amount) select id, 'Gestoria', 10 from crm_clients limit 1`);
    await g.as("A", `insert into user_permissions (user_id, module, can_read) values ('${U.C1}','informes', true)`);
    expect(await g.count("B", "select * from fin_costs")).toBe(0);
    await g.db.exec(fs.readFileSync(`${dir}/014_consolidacio_down.sql`, "utf8"));
    expect(await g.count("B", "select * from fin_costs")).toBe(1);              // com a la Fase 6
    expect((await q("select count(*)::int as n from sec_audit")) [0]).toMatchObject({ n: 1 }); // l'auditoria es conserva
    expect((await q("select count(*)::int as n from pg_policies where qual like '%fin_staff%' or with_check like '%fin_staff%'"))[0]).toMatchObject({ n: 0 });
    await g.db.exec(fs.readFileSync(`${dir}/014_consolidacio.sql`, "utf8"));
    expect(await g.count("B", "select * from fin_costs")).toBe(0);
    expect(await g.count("A", "select * from fin_costs")).toBe(1);
  }, 120_000);
});

describe("18 · Comissió vinculada al responsable correcte (amb la 014 aplicada)", () => {
  it("l'expedient crea el registre de comissió del comercial; si canvia el responsable, canvia el beneficiari; cada comercial veu només el seu", async () => {
    const exp = (await h.as<{ id: string }>("C1", `insert into crm_expedients (client_id, service, customer_type, retailer, owner_id, collaborator_id, created_by) values ('${client1}','llum_empresa','empresa','Nufri','${U.C1}','${U.K}','${U.C1}') returning id`)).rows[0].id;
    const rec = await sys<{ owner_id: string; collaborator_id: string }>(`select owner_id, collaborator_id from crm_commission_records where expedient_id='${exp}'`);
    expect(rec[0]).toMatchObject({ owner_id: U.C1, collaborator_id: U.K });
    await h.as("A", `update crm_expedients set owner_id='${U.C2}' where id='${exp}'`);
    expect((await sys<{ owner_id: string }>(`select owner_id from crm_commission_records where expedient_id='${exp}'`))[0].owner_id).toBe(U.C2);
    expect(await h.count("C1", `select * from crm_commission_records where expedient_id='${exp}'`)).toBe(0);
    expect(await h.count("B", `select * from crm_commission_records`)).toBe(0);           // administració sense autorització econòmica
    expect(await h.count("A", `select * from crm_commission_records where expedient_id='${exp}'`)).toBe(1);
  });
});

describe("19 · Documents protegits", () => {
  it("un comercial i un col·laborador no recuperen documents de clients que no són seus; els documents sensibles no són per a col·laboradors", async () => {
    await sys(`insert into crm_documents (client_id, category, title, original_name, storage_path, mime, size_bytes, sha256, uploaded_by) values ('${client2}','factura_llum','Factura','f.pdf','${client2}/f.pdf','application/pdf',100,'h1','${U.A}'), ('${client1}','dni_nie','DNI','dni.pdf','${client1}/dni.pdf','application/pdf',100,'h2','${U.A}')`);
    expect(await h.count("C1", `select * from crm_documents where client_id='${client2}'`)).toBe(0);
    expect(await h.count("K", `select * from crm_documents where client_id='${client2}'`)).toBe(0);
    expect(await h.count("K", `select * from crm_documents where sensitive`)).toBe(0);
    expect(await h.count("C2", `select * from crm_documents where client_id='${client2}'`)).toBe(1);
  });
});
