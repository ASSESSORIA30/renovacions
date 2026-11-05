/* eslint-disable @typescript-eslint/no-unused-expressions -- les comprovacions fan servir «condició ? ok() : bad()» */
/**
 * Proves de la migració 008 (Clients 360°) i de la seguretat a nivell de fila (RLS) amb PostgreSQL real (PGlite).
 * Simula els rols Direcció (A), Administració (B), dos comercials (C1, C2) i un col·laborador (K).
 * Es comproven els criteris d'acceptació de permisos: qui veu, qui modifica i qui no pot accedir-hi.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const U = { A: "00000000-0000-0000-0000-00000000000a", B: "00000000-0000-0000-0000-00000000000b", C1: "00000000-0000-0000-0000-0000000000c1", C2: "00000000-0000-0000-0000-0000000000c2", K: "00000000-0000-0000-0000-00000000000f" };
const roles = { A: "admin", B: "administrativa", C1: "comercial", C2: "comercial", K: "colaborador" };
const dir = path.resolve(__dirname, "../../supabase/migrations");
const results: { ok: boolean; msg: string }[] = [];
const ok = (m: string) => results.push({ ok: true, msg: m });
const bad = (m: string) => results.push({ ok: false, msg: m });

async function run() {
  const db = new PGlite();
  await db.exec(`
create role anon; create role authenticated;
create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.uid', true), '')::uuid $$;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;`);
  for (const f of ["001_init.sql", "002_offer_ids_text.sql", "003_roles.sql", "004_sips_cache_enriquida.sql", "005_energy_inputs_audit.sql", "006_comparatives_ia.sql", "007_correu_smtp.sql", "008_crm_clients360.sql", "008_crm_clients360.sql"]) {
    try { await db.exec(fs.readFileSync(`${dir}/${f}`, "utf8").replace(/create extension if not exists pgcrypto;/g, "")); ok(f); } catch (e) { bad(`${f}: ${(e as Error).message}`); return; }
  }
  await db.exec(`grant usage on schema public to authenticated; grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated; grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const as = async (who: keyof typeof U, sql: string): Promise<{ rows: any[] }> => {
    await db.exec(`reset role; select set_config('request.jwt.uid', '${U[who]}', false); set role authenticated;`);
    try { return await db.query(sql); } finally { await db.exec("reset role;"); }
  };
  const expectErr = async (who: keyof typeof U, sql: string, label: string) => { try { await as(who, sql); bad(label + " (s'esperava error)"); } catch (e) { ok(label + " → " + (e as Error).message.slice(0, 70)); } };
  const count = async (who: keyof typeof U, sql: string) => (await as(who, sql)).rows.length;
  for (const [k, id] of Object.entries(U)) await db.exec(`insert into auth.users values ('${id}','${k.toLowerCase()}@a30.com','{"name":"${k}"}'); update public.profiles set role='${roles[k as keyof typeof roles]}', code='${k}' where id='${id}';`);

  // 1. comercial C1 crea client propi
  const c1 = (await as("C1", `insert into crm_clients (name, kind, tax_id, owner_id, email, phone, city) values ('Forn Sant Jordi SL','empresa','B60000000','${U.C1}','info@forn.cat','+34 600 11 22 33','Lleida') returning id`)).rows[0].id;
  ok("comercial crea un client propi");
  await expectErr("C1", `insert into crm_clients (name, owner_id) values ('X','${U.C2}')`, "comercial no pot crear clients d'un altre comercial");
  await as("C1", `insert into crm_contacts (client_id, name, role, is_primary) values ('${c1}','Jordi','Gerent',true), ('${c1}','Anna','Administració',false)`); ok("dos contactes");
  await as("C1", `insert into crm_supplies (client_id, cups, energy_type) values ('${c1}','ES0021000000000001AA','luz'),('${c1}','ES0021000000000002AA','luz'),('${c1}','ES0217900000000003AB1F','gas')`); ok("tres subministraments");
  await expectErr("C1", `insert into crm_supplies (client_id, cups) values ('${c1}','ES0021000000000001AA0F')`, "CUPS duplicat (mateix punt de 20 caràcters)");
  await expectErr("C1", `insert into crm_supplies (client_id, cups) values ('${c1}','ES00210000')`, "CUPS amb format incorrecte");
  const k1 = (await as("C1", `insert into crm_contracts (client_id, retailer, product, end_date, status, owner_id) values ('${c1}','Iberdrola','Plan Estable','2027-03-31','actiu','${U.C1}') returning id`)).rows[0].id; ok("contracte amb data de renovació");
  await as("C1", `insert into crm_activities (client_id, type, title, user_id) values ('${c1}','trucada','Trucada inicial','${U.C1}')`); ok("activitat registrada");
  await as("C1", `insert into crm_tasks (client_id, title, due_at, assigned_to, created_by) values ('${c1}','Enviar proposta', now() + interval '2 days','${U.C1}','${U.C1}')`); ok("tasca de seguiment");
  await as("C1", `insert into crm_documents (client_id, category, title, original_name, mime, size_bytes, sha256, storage_path, uploaded_by) values ('${c1}','factura_llum','Factura','f.pdf','application/pdf',100,'x','p','${U.C1}'), ('${c1}','dni_nie','DNI','d.jpg','image/jpeg',100,'y','q','${U.C1}')`); ok("documents (factura i DNI)");

  // 2. altres usuaris
  (await count("C2", `select * from crm_clients where id='${c1}'`)) === 0 ? ok("un altre comercial NO veu el client") : bad("C2 veu el client");
  (await count("C2", `select * from crm_supplies where client_id='${c1}'`)) === 0 ? ok("ni els seus subministraments") : bad("C2 veu subministraments");
  (await count("C2", `select * from crm_documents where client_id='${c1}'`)) === 0 ? ok("ni els documents") : bad("C2 veu documents");
  const upd = await as("C2", `update crm_clients set name='Hackejat' where id='${c1}' returning id`); upd.rows.length === 0 ? ok("ni el pot modificar canviant l'identificador") : bad("C2 modifica");
  await expectErr("C2", `insert into crm_activities (client_id, type, title, user_id) values ('${c1}','nota','x','${U.C2}')`, "ni hi pot afegir activitat");
  (await count("B", `select * from crm_clients where id='${c1}'`)) === 1 ? ok("Administració veu el client") : bad("B no el veu");
  (await count("B", `select * from crm_documents where client_id='${c1}'`)) === 2 ? ok("Administració veu els documents sensibles") : bad("B docs");
  (await count("C1", `select * from crm_clients_list where id='${c1}' and supplies_count=3 and active_contracts=1`)) === 1 ? ok("vista de llistat amb comptadors") : bad("vista");
  (await count("C2", `select * from crm_clients_list`)) === 0 ? ok("la vista respecta la RLS") : bad("vista RLS");
  await expectErr("C1", `update crm_clients set owner_id='${U.C2}' where id='${c1}'`, "el comercial no pot reassignar-se el client");

  // 3. assignació i col·laborador
  await as("B", `insert into crm_client_assignments (client_id, user_id, role) values ('${c1}','${U.C2}','comercial'), ('${c1}','${U.K}','colaborador')`); ok("Administració comparteix el client");
  (await as("C2", `update crm_clients set notes='ok' where id='${c1}' returning id`)).rows.length === 1 ? ok("comercial assignat pot editar") : bad("C2 assignat no edita");
  (await count("K", `select * from crm_clients where id='${c1}'`)) === 1 ? ok("col·laborador assignat veu el client") : bad("K no veu");
  (await as("K", `update crm_clients set notes='k' where id='${c1}' returning id`)).rows.length === 0 ? ok("col·laborador no pot editar-lo") : bad("K edita");
  (await count("K", `select * from crm_documents where client_id='${c1}'`)) === 1 ? ok("col·laborador no veu el DNI (sí la factura)") : bad("K docs sensibles");
  await as("K", `insert into crm_activities (client_id, type, title, user_id) values ('${c1}','nota','Visita feta','${U.K}')`); ok("col·laborador pot afegir notes");
  (await count("K", `select * from crm_contract_finance`)) === 0 ? ok("col·laborador sense dades de comissions") : bad("finance");
  await as("B", `insert into crm_contract_finance (contract_id, commission_eur) values ('${k1}', 120)`);
  (await count("C1", `select * from crm_contract_finance`)) === 1 ? ok("el comercial del contracte veu la seva comissió") : bad("C1 finance");
  (await count("C2", `select * from crm_contract_finance`)) === 0 ? ok("un altre comercial no la veu") : bad("C2 finance");
  await expectErr("C1", `insert into crm_contract_finance (contract_id, commission_eur) values ('${k1}', 999) on conflict (contract_id) do update set commission_eur=999`, "el comercial no pot canviar comissions");
  const k2 = (await as("K", `insert into crm_clients (name, collaborator_id) values ('Client aportat','${U.K}') returning id`)).rows[0].id; ok("col·laborador pot aportar clients potencials");
  (await count("C1", `select * from crm_clients where id='${k2}'`)) === 0 ? ok("i el comercial no el veu fins que se li assigni") : bad("C1 veu k2");

  // 4. integritat i historial
  await expectErr("B", `insert into crm_clients (name, tax_id) values ('Duplicat','B60000000')`, "NIF/CIF duplicat");
  await as("C1", `update crm_contracts set status='finalitzat' where id='${k1}'`);
  await expectErr("C1", `update crm_contracts set end_date='2030-01-01' where id='${k1}'`, "contracte tancat: el comercial no el pot reescriure");
  (await as("B", `update crm_contracts set notes='correcció' where id='${k1}' returning id`)).rows.length === 1 ? ok("Administració pot anotar contractes tancats") : bad("B notes");
  const d = (await as("B", `insert into crm_documents (client_id, category, title, original_name, mime, size_bytes, sha256, storage_path, uploaded_by, retain_until) values ('${c1}','contracte_signat','Contracte','c.pdf','application/pdf',1,'z','r','${U.B}', current_date + 2000) returning id`)).rows[0].id;
  await expectErr("B", `delete from crm_documents where id='${d}'`, "document amb conservació obligatòria: no s'elimina");
  (await as("C1", `delete from crm_documents where client_id='${c1}' returning id`)).rows.length === 0 ? ok("el comercial no elimina documents") : bad("C1 delete");
  const ev = await as("B", `select entity, action, fields from crm_audit_events where client_id='${c1}' order by id`);
  const upd2 = ev.rows.find((r: { entity: string; action: string }) => r.entity === "clients" && r.action === "update");
  ev.rows.length > 10 && upd2 && upd2.fields.includes("notes") && !JSON.stringify(ev.rows).includes("Hackejat") ? ok(`auditoria: ${ev.rows.length} esdeveniments, només noms de camps`) : bad("auditoria " + JSON.stringify(ev.rows.slice(0, 3)));
  const s = await as("B", `select search from crm_clients where id='${c1}'`); s.rows[0].search.includes("600112233") && s.rows[0].search.includes("lleida") ? ok("text de cerca normalitzat") : bad("search " + s.rows[0].search);
  await as("C1", `insert into comparisons (mode, engine_version, snapshot, created_by, crm_client_id) values ('manual','1','{}','${U.C1}','${c1}')`);
  (await count("C2", `select * from comparisons`)) === 1 ? ok("comparativa visible per al comercial assignat al client") : bad("cmp C2");
  (await count("K", `select * from comparisons`)) === 1 ? ok("i per al col·laborador assignat") : bad("cmp K");
  await expectErr("C1", `insert into comparisons (mode, engine_version, snapshot, created_by, crm_client_id) values ('manual','1','{}','${U.C1}','${k2}')`, "no es pot vincular una comparativa a un client que no veus");
  await as("K", `insert into crm_incidents (client_id, title, created_by) values ('${c1}','Factura duplicada','${U.K}')`); ok("col·laborador pot obrir una incidència");
  (await count("C2", `select * from crm_incidents`)) === 1 && (await count("C1", `select * from crm_incidents where client_id='${c1}'`)) === 1 ? ok("incidències visibles a qui veu el client") : bad("incidències");
  (await count("A", `select * from crm_clients`)) === 2 ? ok("Direcció ho veu tot") : bad("A");
  // 5. reversió
  try { await db.exec(fs.readFileSync(`${dir}/008_crm_clients360_down.sql`, "utf8")); ok("reversió"); await db.exec(fs.readFileSync(`${dir}/008_crm_clients360.sql`, "utf8")); ok("es pot tornar a aplicar"); } catch (e) { bad("reversió " + (e as Error).message); }
  const t = await db.query<{ n: number }>(`select count(*)::int n from contracts`); ok(`taules existents intactes (contracts: ${t.rows[0].n})`);
}

describe("migració 008 · Clients 360° i permisos (RLS)", () => {
  it("aplica les migracions i compleix totes les regles d'accés", async () => {
    await run();
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((f) => f.msg)).toEqual([]);
    expect(results.length).toBeGreaterThan(45);
  }, 120_000);
});
