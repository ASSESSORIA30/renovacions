-- Renewal Intelligence Pro — Assessoria 3.0
-- Schema, row level security and storage. Run with `supabase db push` or paste in the SQL editor.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles / roles
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'comercial' check (role in ('admin', 'comercial')),
  code text,                       -- code used in the sheet (ADMIN GESTIONO), e.g. IBETH
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_code() returns text
language sql stable security definer set search_path = public as $$
  select code from profiles where id = auth.uid();
$$;

-- new auth users get a profile (first user becomes admin)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email,
          case when (select count(*) from profiles) = 0 then 'admin' else 'comercial' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- source contracts (owned by the sync)
create table if not exists public.contracts (
  id text primary key,                 -- stable id derived from CUPS
  cups text,
  comercial text not null default 'SIN ASIGNAR',
  data jsonb not null,                 -- SourceContract
  source_hash text not null,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_from_source boolean not null default false
);
create index if not exists contracts_comercial_idx on public.contracts (comercial);
create index if not exists contracts_cups_idx on public.contracts (cups);

-- ---------------------------------------------------------------- CRM-owned state (never touched by the sync)
create table if not exists public.crm_state (
  contract_id text primary key references public.contracts on delete cascade,
  status text not null check (status in ('pendiente', 'contactado', 'renovado', 'no_renueva')),
  data jsonb not null,                 -- CrmState
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users
);

create table if not exists public.activities (
  id uuid primary key,
  contract_id text not null references public.contracts on delete cascade,
  type text not null,
  at timestamptz not null default now(),
  by_name text not null,
  by_user uuid references auth.users default auth.uid(),
  title text not null,
  body text,
  delivery text check (delivery in ('preparado', 'enviado', 'entregado', 'error')),
  meta jsonb
);
create index if not exists activities_contract_idx on public.activities (contract_id, at desc);

create table if not exists public.tasks (
  id uuid primary key,
  contract_id text references public.contracts on delete cascade,
  title text not null,
  due date not null,
  assignee text not null,
  done boolean not null default false,
  kind text not null default 'seguimiento',
  created_at timestamptz not null default now(),
  created_by text not null
);
create index if not exists tasks_assignee_idx on public.tasks (assignee, done, due);

create table if not exists public.documents (
  id uuid primary key,
  contract_id text not null references public.contracts on delete cascade,
  version integer not null,
  file_name text not null,
  offer_id text,
  ahorro_anual numeric,
  storage_path text not null,
  created_at timestamptz not null default now(),
  created_by text not null
);

create table if not exists public.offers (
  id text primary key,                 -- "of-…" for template offers, UUID for manual ones
  data jsonb not null,                 -- Offer
  verificada boolean not null default false,
  valida_hasta date not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_config (
  key text primary key,                -- 'settings' | 'templates'
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  origin text not null,
  report jsonb,
  added integer, updated integer, unchanged integer,
  ok boolean not null default true,
  error text
);

-- audit trail: who changed what
create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  row_id text not null,
  action text not null,
  old jsonb,
  new jsonb
);
create or replace function public.audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, row_id, action, old, new)
  values (tg_table_name, coalesce((to_jsonb(new)->>'id'), (to_jsonb(new)->>'contract_id'), (to_jsonb(old)->>'id'), (to_jsonb(old)->>'contract_id')), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger if exists audit_crm_state on public.crm_state;
create trigger audit_crm_state after insert or update or delete on public.crm_state for each row execute function public.audit();
drop trigger if exists audit_offers on public.offers;
create trigger audit_offers after insert or update or delete on public.offers for each row execute function public.audit();

-- closed contracts are immutable history (renovado / no_renueva can only be reopened by an admin)
create or replace function public.protect_closed() returns trigger language plpgsql as $$
begin
  if old.status in ('renovado', 'no_renueva') and not public.is_admin() and new.status <> old.status then
    raise exception 'Solo un administrador puede reabrir un contrato cerrado';
  end if;
  return new;
end $$;
drop trigger if exists protect_closed_trg on public.crm_state;
create trigger protect_closed_trg before update on public.crm_state for each row execute function public.protect_closed();

-- optimistic concurrency: save state only if version matches
create or replace function public.save_crm_state(p_contract_id text, p_status text, p_data jsonb, p_expected integer)
returns public.crm_state language plpgsql security invoker set search_path = public as $$
declare r crm_state;
begin
  if p_expected = 0 then
    insert into crm_state (contract_id, status, data, version, updated_by)
    values (p_contract_id, p_status, p_data, 1, auth.uid())
    on conflict (contract_id) do nothing
    returning * into r;
  else
    update crm_state set status = p_status, data = p_data, version = version + 1, updated_at = now(), updated_by = auth.uid()
    where contract_id = p_contract_id and version = p_expected
    returning * into r;
  end if;
  if r is null then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.contracts enable row level security;
alter table public.crm_state enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.documents enable row level security;
alter table public.offers enable row level security;
alter table public.app_config enable row level security;
alter table public.sync_runs enable row level security;
alter table public.audit_log enable row level security;

create or replace function public.can_see(p_contract text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from contracts c where c.id = p_contract and c.comercial = public.my_code());
$$;

drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists p_profiles_admin on public.profiles;
create policy p_profiles_admin on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_contracts_read on public.contracts;
create policy p_contracts_read on public.contracts for select to authenticated using (public.is_admin() or comercial = public.my_code());
-- contracts are written only by the server sync (service role bypasses RLS)

drop policy if exists p_state_rw on public.crm_state;
create policy p_state_rw on public.crm_state for all to authenticated using (public.can_see(contract_id)) with check (public.can_see(contract_id));

drop policy if exists p_act_read on public.activities;
create policy p_act_read on public.activities for select to authenticated using (public.can_see(contract_id));
drop policy if exists p_act_insert on public.activities;
create policy p_act_insert on public.activities for insert to authenticated with check (public.can_see(contract_id));
drop policy if exists p_act_update on public.activities;
create policy p_act_update on public.activities for update to authenticated using (public.can_see(contract_id) and by_user = auth.uid());

drop policy if exists p_tasks_rw on public.tasks;
create policy p_tasks_rw on public.tasks for all to authenticated
  using (public.is_admin() or assignee = public.my_code() or (contract_id is not null and public.can_see(contract_id)))
  with check (public.is_admin() or assignee = public.my_code() or (contract_id is not null and public.can_see(contract_id)));

drop policy if exists p_docs_rw on public.documents;
create policy p_docs_rw on public.documents for all to authenticated using (public.can_see(contract_id)) with check (public.can_see(contract_id));

drop policy if exists p_offers_read on public.offers;
create policy p_offers_read on public.offers for select to authenticated using (true);
drop policy if exists p_offers_admin on public.offers;
create policy p_offers_admin on public.offers for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_config_read on public.app_config;
create policy p_config_read on public.app_config for select to authenticated using (true);
drop policy if exists p_config_admin on public.app_config;
create policy p_config_admin on public.app_config for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_sync_read on public.sync_runs;
create policy p_sync_read on public.sync_runs for select to authenticated using (true);
drop policy if exists p_audit_admin on public.audit_log;
create policy p_audit_admin on public.audit_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- storage for proposal PDFs (private)
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
drop policy if exists p_docs_storage_read on storage.objects;
create policy p_docs_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.can_see(split_part(name, '/', 1)));
drop policy if exists p_docs_storage_write on storage.objects;
create policy p_docs_storage_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_see(split_part(name, '/', 1)));
