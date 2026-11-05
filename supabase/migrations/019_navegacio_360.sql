-- =====================================================================================================
-- Fase 9 · 019 · NAVEGACIÓ, FITXA 360º, REPRESENTANT LEGAL, ESBORRANYS DE COMPARATIVES I REGISTRES RECENTS
-- =====================================================================================================
-- Migració ADDITIVA i idempotent: no esborra ni modifica cap dada existent. Desfer: 019_navegacio_360_down.sql.
-- Requereix: 006 (comparatives), 008 (Clients 360°) i 014 (permisos).
--
--   1. Clients empresa: càrrec del contacte habitual i REPRESENTANT LEGAL separat (nom, DNI/NIE, càrrec).
--      El DNI/NIE del representant és una dada sensible: el servidor només el mostra sencer a qui pot veure
--      dades sensibles del client (crm_can_see_sensitive); a la resta, emmascarat.
--   2. Esborranys persistents de comparatives (desament automàtic): un per usuari i context (contracte, client
--      i subministrament o CUPS), amb número de versió per detectar canvis simultanis de dues persones.
--   3. Registres consultats recentment: només els veu el seu propietari.
-- =====================================================================================================

-- ============================================================ 1. representant legal
alter table public.crm_clients add column if not exists contact_role text;
alter table public.crm_clients add column if not exists legal_rep_name text;
alter table public.crm_clients add column if not exists legal_rep_tax_id text;
alter table public.crm_clients add column if not exists legal_rep_role text;
alter table public.crm_clients add column if not exists contact_is_legal_rep boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_legal_rep_role_chk') then
    alter table public.crm_clients add constraint crm_clients_legal_rep_role_chk check (legal_rep_role is null or legal_rep_role in ('administrador', 'administrador_solidari', 'administrador_mancomunat', 'conseller_delegat', 'apoderat', 'altre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_legal_rep_tax_chk') then
    alter table public.crm_clients add constraint crm_clients_legal_rep_tax_chk check (legal_rep_tax_id is null or legal_rep_tax_id ~ '^[0-9XYZ][0-9]{7}[A-Z]$');
  end if;
end $$;

-- ============================================================ 2. esborranys de comparatives
create table if not exists public.comparison_drafts (
  id uuid primary key default gen_random_uuid(),
  context_key text not null check (length(context_key) between 3 and 200),   -- contract:<id> · client:<id>[:supply:<id>] · cups:<cups> · lliure:<uuid>
  contract_id text,                                                           -- contracte de renovacions (id importat o crm:<uuid>)
  crm_client_id uuid references public.crm_clients (id) on delete set null,
  crm_supply_id uuid references public.crm_supplies (id) on delete set null,
  cups text,
  client_name text,
  step integer not null default 1 check (step between 1 and 5),
  state jsonb not null,                                                       -- estat de l'assistent (preus, consums, potències, ofertes…)
  version integer not null default 1 check (version >= 1),
  status text not null default 'obert' check (status in ('obert', 'finalitzat', 'descartat')),
  comparison_id uuid references public.comparisons (id) on delete set null,   -- comparativa desada a partir de l'esborrany
  created_by uuid not null references auth.users (id) default auth.uid(),
  created_by_name text,
  updated_by uuid references auth.users (id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- un sol esborrany obert per persona i context (evita duplicats)
create unique index if not exists comparison_drafts_open_uq on public.comparison_drafts (created_by, context_key) where status = 'obert';
create index if not exists comparison_drafts_client_idx on public.comparison_drafts (crm_client_id, updated_at desc);
create index if not exists comparison_drafts_contract_idx on public.comparison_drafts (contract_id, updated_at desc);

create or replace function public.comparison_draft_touch() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by or new.context_key is distinct from old.context_key then
      raise exception 'L''autor i el context d''un esborrany no es poden canviar' using errcode = '42501';
    end if;
    if old.status <> 'obert' and new.state is distinct from old.state then
      raise exception 'Aquest esborrany ja està tancat' using errcode = '42501';
    end if;
    if new.state is distinct from old.state then new.version := old.version + 1; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists comparison_drafts_touch on public.comparison_drafts;
create trigger comparison_drafts_touch before insert or update on public.comparison_drafts for each row execute function public.comparison_draft_touch();

-- ============================================================ 3. registres consultats recentment
create table if not exists public.user_recent_records (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('client', 'contracte', 'subministrament')),
  ref_id text not null check (length(ref_id) between 1 and 200),
  label text not null check (length(label) between 1 and 200),
  sub text,
  visited_at timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);
create index if not exists user_recent_records_idx on public.user_recent_records (user_id, visited_at desc);

-- ============================================================ 4. RLS
alter table public.comparison_drafts enable row level security;
alter table public.user_recent_records enable row level security;

-- Esborranys: l'autor; Administració (is_staff); i qui pot veure el client vinculat (per reprendre'ls des de la fitxa 360º).
-- Mai els col·laboradors (no tenen accés al CRM intern).
drop policy if exists p_comparison_drafts_select on public.comparison_drafts;
create policy p_comparison_drafts_select on public.comparison_drafts for select to authenticated using (
  coalesce(public.my_role() <> 'colaborador', false) and (
    created_by = auth.uid() or public.is_staff() or (crm_client_id is not null and public.crm_can_see_client(crm_client_id))));
drop policy if exists p_comparison_drafts_insert on public.comparison_drafts;
create policy p_comparison_drafts_insert on public.comparison_drafts for insert to authenticated with check (
  created_by = auth.uid() and coalesce(public.my_role() <> 'colaborador', false)
  and (crm_client_id is null or public.crm_can_see_client(crm_client_id)));
drop policy if exists p_comparison_drafts_update on public.comparison_drafts;
create policy p_comparison_drafts_update on public.comparison_drafts for update to authenticated
  using (coalesce(public.my_role() <> 'colaborador', false) and (created_by = auth.uid() or public.is_staff() or (crm_client_id is not null and public.crm_can_edit_client(crm_client_id))))
  with check (crm_client_id is null or public.crm_can_see_client(crm_client_id));
-- (sense DELETE: un esborrany es descarta, no s'esborra)

drop policy if exists p_user_recent_select on public.user_recent_records;
create policy p_user_recent_select on public.user_recent_records for select to authenticated using (user_id = auth.uid());
drop policy if exists p_user_recent_insert on public.user_recent_records;
create policy p_user_recent_insert on public.user_recent_records for insert to authenticated with check (user_id = auth.uid());
drop policy if exists p_user_recent_update on public.user_recent_records;
create policy p_user_recent_update on public.user_recent_records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists p_user_recent_delete on public.user_recent_records;
create policy p_user_recent_delete on public.user_recent_records for delete to authenticated using (user_id = auth.uid());

-- ============================================================ COMPROVACIÓ (ha de retornar 5 columnes, 2 taules)
select 'columnes de representant legal' as què, count(*) as total from information_schema.columns
 where table_schema = 'public' and table_name = 'crm_clients' and column_name in ('contact_role', 'legal_rep_name', 'legal_rep_tax_id', 'legal_rep_role', 'contact_is_legal_rep')
union all select 'taules noves', count(*) from information_schema.tables where table_schema = 'public' and table_name in ('comparison_drafts', 'user_recent_records');
