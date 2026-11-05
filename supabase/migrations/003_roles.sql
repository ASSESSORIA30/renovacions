-- Roles: admin, cap_administrativa, administrativa (full access), comercial and colaborador (own contracts only).
-- Safe to run more than once.

-- 1. allowed roles
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'cap_administrativa', 'administrativa', 'comercial', 'colaborador'));

-- 2. columns used to decide what a collaborator can see
alter table public.contracts add column if not exists captador text;
alter table public.contracts add column if not exists colaborador text;
update public.contracts set captador = upper(data->>'captador'), colaborador = lower(data->>'colaborador');
create index if not exists contracts_captador_idx on public.contracts (captador);
create index if not exists contracts_colaborador_idx on public.contracts (colaborador);

-- 3. helper functions
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from profiles where id = auth.uid();
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'cap_administrativa', 'administrativa'), false);
$$;

create or replace function public.can_assign() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'cap_administrativa'), false);
$$;

create or replace function public.collab_key(t text) returns text
language sql immutable as $$
  select trim(regexp_replace(upper(coalesce(t, '')), '^COL\.?\s*', ''));
$$;

create or replace function public.contract_visible(c_comercial text, c_captador text, c_colaborador text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.my_role()
    when 'admin' then true
    when 'cap_administrativa' then true
    when 'administrativa' then true
    when 'comercial' then c_comercial = public.my_code()
    when 'colaborador' then
      (public.my_code() is not null and c_captador is not null and public.collab_key(c_captador) = public.collab_key(public.my_code()))
      or (c_colaborador is not null and c_colaborador = public.my_email())
    else false end;
$$;

create or replace function public.can_see(p_contract text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contracts c where c.id = p_contract and public.contract_visible(c.comercial, c.captador, c.colaborador));
$$;

-- 4. policies
drop policy if exists p_contracts_read on public.contracts;
create policy p_contracts_read on public.contracts for select to authenticated
  using (public.contract_visible(comercial, captador, colaborador));

drop policy if exists p_tasks_rw on public.tasks;
create policy p_tasks_rw on public.tasks for all to authenticated
  using (public.is_staff() or assignee = public.my_code() or lower(assignee) = public.my_email() or (contract_id is not null and public.can_see(contract_id)))
  with check (public.can_assign() or public.is_staff() or assignee = public.my_code() or lower(assignee) = public.my_email() or (contract_id is not null and public.can_see(contract_id)));

drop policy if exists p_offers_admin on public.offers;
create policy p_offers_admin on public.offers for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists p_config_admin on public.app_config;
create policy p_config_admin on public.app_config for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- closed contracts can be reopened by full-access roles only
create or replace function public.protect_closed() returns trigger language plpgsql as $$
begin
  if old.status in ('renovado', 'no_renueva') and not public.is_staff() and new.status <> old.status then
    raise exception 'Només l''equip d''administració pot reobrir un contracte tancat';
  end if;
  return new;
end $$;
