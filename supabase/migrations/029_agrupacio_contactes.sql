-- =====================================================================================================
-- 029 · AGRUPACIÓ INTEL·LIGENT DE RENOVACIONS PER CONTACTE · «ALTRES CONTRACTES DEL MATEIX CONTACTE» · «CONTACTAR TOTS»
-- =====================================================================================================
-- Additiva i idempotent. No esborra ni modifica cap dada existent. Reversible amb 029_agrupacio_contactes_down.sql.
-- Requereix 001 (contracts, activities), 003 (rols), 008 (Clients 360°) i 014 (sec_audit).
--
-- Principis:
--   · Els grups NO es desen: es calculen a partir dels contractes reals. Cap contracte es duplica.
--   · Només es desen les DECISIONS de les persones (unir / separar), les relacions persona ↔ client,
--     les autoritzacions per rebre informació de cada titular i les comunicacions conjuntes. Tot amb traçabilitat
--     (qui, quan) i sense esborrats: les decisions es revoquen, no s'eliminen.
--   · Seguretat a la base de dades: ningú pot llegir ni crear res que inclogui un contracte que no pot veure.
--   · No es toca la sincronització amb Google Sheets ni les renovacions ja registrades.
--
--   renewal_contact_links          decisions manuals: «unir» o «separar» dos contractes de renovació
--   crm_contact_clients            una persona de contacte de Clients 360° relacionada amb altres clients (sense fusionar fitxes)
--   renewal_contact_authorizations el destinatari X pot rebre informació del titular Y (base i evidència)
--   renewal_group_ops              una sola operació (comunicació, trucada, visita…) vinculada a diversos contractes;
--                                  l'identificador el genera el navegador i fa d'empremta d'idempotència
-- =====================================================================================================

-- ============================================================ funcions auxiliars
create or replace function public.norm_tax_id(t text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;

/** Cert si l'usuari pot veure TOTS els contractes de la llista (i n'hi ha almenys un). */
create or replace function public.can_see_all(p text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(cardinality(p), 0) > 0 and not exists (select 1 from unnest(p) x where not public.can_see(x));
$$;

/** Titular visible: «cif:<NIF>» si l'usuari veu algun contracte d'aquest titular, o «ct:<id>» si veu el contracte. */
create or replace function public.holder_visible(p_holder text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_holder like 'cif:%' then exists (select 1 from contracts c where public.norm_tax_id(c.data->>'cif') = substr(p_holder, 5) and public.contract_visible(c.comercial, c.captador, c.colaborador))
    when p_holder like 'ct:%' then public.can_see(substr(p_holder, 4))
    else false end;
$$;
create index if not exists contracts_cif_norm_idx on public.contracts (public.norm_tax_id(data->>'cif'));

/** Rol intern (els col·laboradors no gestionen agrupacions ni comunicacions conjuntes). */
create or replace function public.is_internal() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.my_role() <> 'colaborador', false); $$;

-- ============================================================ 1. decisions manuals d'agrupació
create table if not exists public.renewal_contact_links (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('unir', 'separar')),
  contract_a text not null references public.contracts (id) on delete cascade,
  contract_b text not null references public.contracts (id) on delete cascade,
  reason text check (reason is null or length(reason) <= 500),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_by_name text,
  constraint renewal_contact_links_order check (contract_a < contract_b)
);
create unique index if not exists renewal_contact_links_active_uq on public.renewal_contact_links (contract_a, contract_b) where revoked_at is null;
create index if not exists renewal_contact_links_b_idx on public.renewal_contact_links (contract_b) where revoked_at is null;

-- ============================================================ 2. persona de contacte ↔ altres clients (Clients 360°)
create table if not exists public.crm_contact_clients (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  role text check (role is null or length(role) <= 120),
  status text not null default 'confirmada' check (status in ('confirmada', 'detectada')),
  authorized boolean not null default false,                -- autoritzada a rebre informació d'aquest client
  basis text check (basis is null or basis in ('consentiment', 'execucio_contracte', 'interes_legitim', 'representacio', 'altre')),
  note text check (note is null or length(note) <= 1000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
create unique index if not exists crm_contact_clients_active_uq on public.crm_contact_clients (contact_id, client_id) where revoked_at is null;
create index if not exists crm_contact_clients_client_idx on public.crm_contact_clients (client_id) where revoked_at is null;

-- ============================================================ 3. autoritzacions per rebre informació d'un titular
create table if not exists public.renewal_contact_authorizations (
  id uuid primary key default gen_random_uuid(),
  contact_key text not null check (contact_key ~ '^(tel:[0-9]{9,15}|email:[^@\s]+@[^@\s]+)$'),
  holder_key text not null check (holder_key ~ '^(cif:[A-Z0-9]{8,}|ct:.+)$'),
  basis text not null check (basis in ('consentiment', 'execucio_contracte', 'interes_legitim', 'representacio', 'altre')),
  note text check (note is null or length(note) <= 1000),
  granted_by uuid references auth.users (id) on delete set null default auth.uid(),
  granted_by_name text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
create unique index if not exists renewal_contact_auth_active_uq on public.renewal_contact_authorizations (contact_key, holder_key) where revoked_at is null;

-- ============================================================ 4. operacions conjuntes (una comunicació → diversos contractes)
create table if not exists public.renewal_group_ops (
  id uuid primary key,                                      -- generat pel navegador: idempotència (clics repetits, reintents)
  kind text not null check (kind in ('comunicacio', 'trucada', 'visita', 'reunio', 'nota')),
  channel text check (channel is null or channel in ('whatsapp', 'email', 'telefon', 'presencial', 'altre')),
  contact_name text check (contact_name is null or length(contact_name) <= 200),
  recipient text check (recipient is null or length(recipient) <= 200),
  contract_ids text[] not null check (cardinality(contract_ids) between 1 and 200),
  fingerprint text check (fingerprint is null or length(fingerprint) <= 9000),
  template_id text,
  subject text check (subject is null or length(subject) <= 300),
  body text check (body is null or length(body) <= 20000),
  attachments jsonb not null default '[]',
  status text not null check (status in ('preparat', 'intent', 'enviat', 'registrat', 'error')),
  error text check (error is null or length(error) <= 1000),
  provider_ref text,
  outcome text check (outcome is null or length(outcome) <= 500),
  notes text check (notes is null or length(notes) <= 4000),
  at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists renewal_group_ops_contracts_idx on public.renewal_group_ops using gin (contract_ids);
create index if not exists renewal_group_ops_fp_idx on public.renewal_group_ops (fingerprint, at desc) where fingerprint is not null;

-- activitats de cada contracte vinculades a l'operació conjunta (sistema d'activitats existent)
create index if not exists activities_group_op_idx on public.activities ((meta->>'groupOpId')) where meta ? 'groupOpId';

-- ============================================================ traçabilitat: el que ja s'ha decidit no es pot reescriure
create or replace function public.grp_guard_revoke() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := (select name from profiles where id = auth.uid());
begin
  if tg_table_name = 'renewal_contact_links' then
    if (new.kind, new.contract_a, new.contract_b, new.reason, new.created_by, new.created_at) is distinct from (old.kind, old.contract_a, old.contract_b, old.reason, old.created_by, old.created_at) then
      raise exception 'Una decisió d''agrupació no es pot modificar: revoca-la i crea''n una de nova' using errcode = 'P0001';
    end if;
    if old.revoked_at is not null then raise exception 'Aquesta decisió ja està revocada' using errcode = 'P0001'; end if;
    if new.revoked_at is not null then new.revoked_by := auth.uid(); new.revoked_by_name := who; new.revoked_at := now(); end if;
  elsif tg_table_name = 'renewal_contact_authorizations' then
    if (new.contact_key, new.holder_key, new.basis, new.note, new.granted_by, new.granted_at) is distinct from (old.contact_key, old.holder_key, old.basis, old.note, old.granted_by, old.granted_at) then
      raise exception 'Una autorització no es pot modificar: revoca-la i registra''n una de nova' using errcode = 'P0001';
    end if;
    if old.revoked_at is not null then raise exception 'Aquesta autorització ja està revocada' using errcode = 'P0001'; end if;
    if new.revoked_at is not null then new.revoked_by := auth.uid(); new.revoked_at := now(); end if;
  elsif tg_table_name = 'crm_contact_clients' then
    if (new.contact_id, new.client_id, new.created_by, new.created_at) is distinct from (old.contact_id, old.client_id, old.created_by, old.created_at) then
      raise exception 'La relació no es pot moure a una altra persona o client: revoca-la i crea''n una de nova' using errcode = 'P0001';
    end if;
    if old.revoked_at is not null then raise exception 'Aquesta relació ja està revocada' using errcode = 'P0001'; end if;
    if new.status = 'confirmada' and old.status is distinct from 'confirmada' then new.confirmed_by := auth.uid(); new.confirmed_at := now(); end if;
    if new.revoked_at is not null then new.revoked_by := auth.uid(); new.revoked_at := now(); end if;
  end if;
  return new;
end $$;

create or replace function public.grp_stamp_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := (select name from profiles where id = auth.uid());
begin
  if tg_table_name = 'renewal_contact_links' then
    if new.contract_a > new.contract_b then declare t text := new.contract_a; begin new.contract_a := new.contract_b; new.contract_b := t; end; end if;
    if new.contract_a = new.contract_b then raise exception 'Un contracte no es pot unir amb si mateix' using errcode = '23514'; end if;
    new.created_by_name := coalesce(who, new.created_by_name); new.created_at := now(); new.revoked_at := null; new.revoked_by := null; new.revoked_by_name := null;
  elsif tg_table_name = 'renewal_contact_authorizations' then
    new.granted_by_name := coalesce(who, new.granted_by_name); new.granted_at := now(); new.revoked_at := null; new.revoked_by := null;
  elsif tg_table_name = 'crm_contact_clients' then
    if exists (select 1 from crm_contacts k where k.id = new.contact_id and k.client_id = new.client_id) then
      raise exception 'Aquesta persona ja és contacte d''aquest client' using errcode = '23514';
    end if;
    new.created_by_name := coalesce(who, new.created_by_name); new.created_at := now(); new.revoked_at := null; new.revoked_by := null;
    if new.status = 'confirmada' then new.confirmed_by := auth.uid(); new.confirmed_at := now(); else new.confirmed_by := null; new.confirmed_at := null; end if;
  elsif tg_table_name = 'renewal_group_ops' then
    new.created_by_name := coalesce(who, new.created_by_name); new.created_at := now(); new.updated_at := now();
    select array_agg(distinct x order by x) into new.contract_ids from unnest(new.contract_ids) x;
  end if;
  return new;
end $$;

/** Una operació conjunta només canvia d'estat (i de resultat); els contractes, el text i l'autor són immutables. */
create or replace function public.grp_ops_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.id, new.kind, new.channel, new.recipient, new.contract_ids, new.fingerprint, new.subject, new.body, new.attachments, new.created_by, new.created_at)
     is distinct from (old.id, old.kind, old.channel, old.recipient, old.contract_ids, old.fingerprint, old.subject, old.body, old.attachments, old.created_by, old.created_at) then
    raise exception 'Una comunicació registrada no es pot modificar' using errcode = 'P0001';
  end if;
  if old.status in ('enviat', 'registrat') and new.status not in ('enviat', 'registrat') then
    raise exception 'Una comunicació enviada no pot tornar a l''estat anterior' using errcode = 'P0001';
  end if;
  if old.status = 'error' and new.status <> 'error' then
    raise exception 'Una comunicació fallida no es pot marcar com a enviada: cal un enviament nou' using errcode = 'P0001';
  end if;
  if new.status = 'registrat' and old.status <> 'registrat' then new.confirmed_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['renewal_contact_links', 'renewal_contact_authorizations', 'crm_contact_clients'] loop
    execute format('drop trigger if exists %1$s_guard on public.%1$s', t);
    execute format('create trigger %1$s_guard before update on public.%1$s for each row execute function public.grp_guard_revoke()', t);
  end loop;
  foreach t in array array['renewal_contact_links', 'renewal_contact_authorizations', 'crm_contact_clients', 'renewal_group_ops'] loop
    execute format('drop trigger if exists %1$s_stamp on public.%1$s', t);
    execute format('create trigger %1$s_stamp before insert on public.%1$s for each row execute function public.grp_stamp_insert()', t);
  end loop;
end $$;
drop trigger if exists renewal_group_ops_guard on public.renewal_group_ops;
create trigger renewal_group_ops_guard before update on public.renewal_group_ops for each row execute function public.grp_ops_guard();

-- ============================================================ RLS
alter table public.renewal_contact_links enable row level security;
alter table public.crm_contact_clients enable row level security;
alter table public.renewal_contact_authorizations enable row level security;
alter table public.renewal_group_ops enable row level security;

-- 1. decisions: cal veure els DOS contractes (si no, ni tan sols se'n coneix l'existència)
drop policy if exists p_rcl_select on public.renewal_contact_links;
create policy p_rcl_select on public.renewal_contact_links for select to authenticated using (public.can_see(contract_a) and public.can_see(contract_b));
drop policy if exists p_rcl_insert on public.renewal_contact_links;
create policy p_rcl_insert on public.renewal_contact_links for insert to authenticated
  with check (public.is_internal() and created_by = auth.uid() and public.can_see(contract_a) and public.can_see(contract_b));
drop policy if exists p_rcl_update on public.renewal_contact_links;
create policy p_rcl_update on public.renewal_contact_links for update to authenticated
  using (public.is_internal() and public.can_see(contract_a) and public.can_see(contract_b))
  with check (public.is_internal() and public.can_see(contract_a) and public.can_see(contract_b));
-- sense política de DELETE: les decisions es revoquen, no s'esborren

-- 2. persona ↔ client: cal veure la persona (el seu client) i el client relacionat; per crear-la, poder editar-lo
drop policy if exists p_ccc_select on public.crm_contact_clients;
create policy p_ccc_select on public.crm_contact_clients for select to authenticated using (
  public.crm_can_see_client(client_id) and exists (select 1 from crm_contacts k where k.id = contact_id and public.crm_can_see_client(k.client_id)));
drop policy if exists p_ccc_insert on public.crm_contact_clients;
create policy p_ccc_insert on public.crm_contact_clients for insert to authenticated with check (
  public.is_internal() and created_by = auth.uid() and public.crm_can_edit_client(client_id)
  and exists (select 1 from crm_contacts k where k.id = contact_id and public.crm_can_see_client(k.client_id)));
drop policy if exists p_ccc_update on public.crm_contact_clients;
create policy p_ccc_update on public.crm_contact_clients for update to authenticated
  using (public.is_internal() and public.crm_can_edit_client(client_id)) with check (public.is_internal() and public.crm_can_edit_client(client_id));

-- 3. autoritzacions: visibles per a qui veu el titular; les registra l'equip intern amb accés al titular
drop policy if exists p_rca_select on public.renewal_contact_authorizations;
create policy p_rca_select on public.renewal_contact_authorizations for select to authenticated using (public.holder_visible(holder_key));
drop policy if exists p_rca_insert on public.renewal_contact_authorizations;
create policy p_rca_insert on public.renewal_contact_authorizations for insert to authenticated
  with check (public.is_internal() and granted_by = auth.uid() and public.holder_visible(holder_key));
drop policy if exists p_rca_update on public.renewal_contact_authorizations;
create policy p_rca_update on public.renewal_contact_authorizations for update to authenticated
  using (public.is_internal() and public.holder_visible(holder_key)) with check (public.is_internal() and public.holder_visible(holder_key));

-- 4. operacions: només qui pot veure TOTS els contractes inclosos (així cap llista revela un contracte inaccessible)
drop policy if exists p_rgo_select on public.renewal_group_ops;
create policy p_rgo_select on public.renewal_group_ops for select to authenticated using (public.can_see_all(contract_ids));
drop policy if exists p_rgo_insert on public.renewal_group_ops;
create policy p_rgo_insert on public.renewal_group_ops for insert to authenticated
  with check (public.is_internal() and created_by = auth.uid() and public.can_see_all(contract_ids));
drop policy if exists p_rgo_update on public.renewal_group_ops;
create policy p_rgo_update on public.renewal_group_ops for update to authenticated
  using (created_by = auth.uid() and public.can_see_all(contract_ids)) with check (created_by = auth.uid() and public.can_see_all(contract_ids));

-- ============================================================ comprovació (no modifica res). Ha de retornar: true, true, true, true i 12 polítiques.
select to_regclass('public.renewal_contact_links') is not null as decisions,
       to_regclass('public.crm_contact_clients') is not null as persona_clients,
       to_regclass('public.renewal_contact_authorizations') is not null as autoritzacions,
       to_regclass('public.renewal_group_ops') is not null as operacions,
       (select count(*) from pg_policies where tablename in ('renewal_contact_links', 'crm_contact_clients', 'renewal_contact_authorizations', 'renewal_group_ops')) as politiques;
