/** Base de dades PostgreSQL real (PGlite) amb les migracions aplicades i usuaris de cada rol, per provar la RLS. */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

export const dir = path.resolve(__dirname, "../../supabase/migrations");
export const U = { A: "00000000-0000-0000-0000-00000000000a", B: "00000000-0000-0000-0000-00000000000b", C1: "00000000-0000-0000-0000-0000000000c1", C2: "00000000-0000-0000-0000-0000000000c2", K: "00000000-0000-0000-0000-00000000000f", L: "00000000-0000-0000-0000-0000000000e1", L2: "00000000-0000-0000-0000-0000000000e2", C3: "00000000-0000-0000-0000-0000000000c3" } as const;
const ROLES = { A: "admin", B: "administrativa", C1: "comercial", C2: "comercial", K: "colaborador", L: "cap_equip", L2: "cap_equip", C3: "comercial" } as const;
/** Usuaris que només existeixen si s'aplica la migració 016 (rol cap_equip): Caps d'equip L i L2 i un tercer comercial C3. */
const NEEDS_016 = new Set(["L", "L2", "C3"]);
export type Who = keyof typeof U;

export async function setup(files: string[]) {
  const db = new PGlite();
  await db.exec(`
create role anon; create role authenticated;
create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.uid', true), '')::uuid $$;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;`);
  const applied: string[] = [];
  // Compatibilitat Fase 7: `WITH014=1` afegeix la migració 014 a les suites anteriors i autoritza B (Administració)
  // a l'economia, tal com ho faria Direcció des del panell de permisos (npm run test:compat014).
  const with014 = !!process.env.WITH014 && files.includes("011_crm_economia.sql") && !files.includes("014_consolidacio.sql");
  if (with014) files = [...files, "014_consolidacio.sql"];
  for (const f of files) {
    await db.exec(fs.readFileSync(`${dir}/${f}`, "utf8").replace(/create extension if not exists pgcrypto;/g, ""));
    applied.push(f);
  }
  await db.exec(`grant usage on schema public to authenticated; grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated; grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;`);
  for (const [k, id] of Object.entries(U)) if (!NEEDS_016.has(k) || applied.includes("016_equips.sql")) await db.exec(`insert into auth.users values ('${id}','${k.toLowerCase()}@a30.com','{"name":"${k}"}'); update public.profiles set role='${ROLES[k as Who]}', code='${k}' where id='${id}';`);
  if (with014) await db.exec(`insert into public.user_permissions (user_id, module, can_read, can_edit) values ('${U.B}','economia', true, true);`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const as = async <T = any>(who: Who, sql: string): Promise<{ rows: T[] }> => {
    await db.exec(`reset role; select set_config('request.jwt.uid', '${U[who]}', false); set role authenticated;`);
    try { return await db.query<T>(sql); } finally { await db.exec("reset role;"); }
  };
  const fails = async (who: Who, sql: string) => { try { await as(who, sql); return null; } catch (e) { return (e as Error).message; } };
  const count = async (who: Who, sql: string) => (await as(who, sql)).rows.length;
  return { db, as, fails, count, applied };
}

export const MIGRATIONS = ["001_init.sql", "002_offer_ids_text.sql", "003_roles.sql", "004_sips_cache_enriquida.sql", "005_energy_inputs_audit.sql", "006_comparatives_ia.sql", "007_correu_smtp.sql", "008_crm_clients360.sql"];

/** Totes les migracions «up» fins a la indicada (p. ex. "016"), en ordre. */
export const upTo = (last: string) => fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.includes("_down") && f.slice(0, 3) <= last).sort();
