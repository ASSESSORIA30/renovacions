-- 027 · COL·LABORADORS: IMPORTACIÓ I PERCENTATGES DE COMISSIÓ
-- Additiva i idempotent: només afegeix columnes, una taula de lots d'importació i una clau de configuració.
-- Reversible amb 027_collaboradors_comissions_down.sql. Requereix 011 (fin_rules), 013 (cap_partners) i 014 (sec_settings).
--
-- NO hi ha cap motor de comissions nou. Els percentatges dels col·laboradors són regles del motor existent:
--   fin_rules · capa «collaborador» · tipus «pct_comissio_rebuda» (percentatge sobre la comissió que cobra Assessoria 3.0)
--   · beneficiary_id = el compte del col·laborador · versions amb data d'efecte (els càlculs ja fets no es recalculen).
-- Les excepcions (comercialitzadora, producte, servei, segment, tarifa, alta nova/renovació) són regles més específiques.

-- ============================================================ 1. fitxa del col·laborador (cap_partners) ampliada
alter table public.cap_partners add column if not exists last_name text;
alter table public.cap_partners add column if not exists tax_id text;
alter table public.cap_partners add column if not exists tax_id_norm text generated always as (nullif(regexp_replace(upper(coalesce(tax_id, '')), '[^A-Z0-9]', '', 'g'), '')) stored;
alter table public.cap_partners add column if not exists person_kind text;
alter table public.cap_partners add column if not exists address text;
alter table public.cap_partners add column if not exists postal_code text;
alter table public.cap_partners add column if not exists source_label text;            -- etiqueta d'origen (p. ex. «Comercial», «Usuario»)
alter table public.cap_partners add column if not exists source_created_at timestamptz; -- data d'alta al sistema d'origen
alter table public.cap_partners add column if not exists classification text not null default 'collaborador';
alter table public.cap_partners add column if not exists manager_id uuid references auth.users (id) on delete set null;  -- responsable o cap d'equip (opcional)
alter table public.cap_partners add column if not exists import_id uuid;
alter table public.cap_partners add column if not exists account_created_by_import boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cap_partners_person_kind_chk') then
    alter table public.cap_partners add constraint cap_partners_person_kind_chk check (person_kind is null or person_kind in ('fisica', 'juridica'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cap_partners_classification_chk') then
    alter table public.cap_partners add constraint cap_partners_classification_chk check (classification in ('collaborador', 'pendent_classificacio', 'descartat'));
  end if;
end $$;
-- un DNI/CIF no es pot repetir entre col·laboradors (els existents sense DNI no es veuen afectats)
create unique index if not exists cap_partners_tax_id_uq on public.cap_partners (tax_id_norm) where tax_id_norm is not null;
create index if not exists cap_partners_email_idx on public.cap_partners (lower(email));
create index if not exists cap_partners_import_idx on public.cap_partners (import_id);

-- ============================================================ 2. lots d'importació (per poder-la desfer de manera segura)
create table if not exists public.cap_partner_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_sha256 text,
  rows_total integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  pending_count integer not null default 0,
  report jsonb not null default '[]',               -- decisió per fila (sense DNI ni dades personals completes)
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users (id),
  undo_report jsonb
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cap_partners_import_fk') then
    alter table public.cap_partners add constraint cap_partners_import_fk foreign key (import_id) references public.cap_partner_imports (id) on delete set null;
  end if;
end $$;
alter table public.cap_partner_imports enable row level security;
drop policy if exists p_cap_partner_imports_staff on public.cap_partner_imports;
create policy p_cap_partner_imports_staff on public.cap_partner_imports for select to authenticated using (public.is_staff());
-- l'escriptura la fa el servidor (només Direcció)

-- Les dades noves de la fitxa (DNI, adreça) segueixen la RLS existent de cap_partners: només l'equip intern.

-- ============================================================ 3. nivells de comissió per defecte (editables per Direcció)
insert into public.sec_settings (key, value) values
  ('collab_levels', '{"n1": {"label": "Nivell 1", "pct": 70}, "n2": {"label": "Nivell 2", "pct": 50}, "n3": {"label": "Nivell 3", "pct": 30}}')
on conflict (key) do nothing;

-- ============================================================ COMPROVACIÓ (ha de donar 1 · 1 · 1)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cap_partners' and column_name = 'tax_id_norm') as columna_dni,
       (select count(*) from pg_tables where schemaname = 'public' and tablename = 'cap_partner_imports') as taula_lots,
       (select count(*) from public.sec_settings where key = 'collab_levels') as nivells;
