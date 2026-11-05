-- 008 · CRM FASE 1: CLIENTS 360°, SUBMINISTRAMENTS, CONTRACTES, DOCUMENTS, ACTIVITAT I TASQUES
-- Additiva i idempotent: no esborra ni modifica dades existents. Reversible amb 008_crm_clients360_down.sql.
--
-- Rols (ja existents a profiles.role):
--   admin                      → Direcció (tot)
--   cap_administrativa,
--   administrativa             → Administració (tots els clients; documentació i tramitació)
--   comercial                  → els seus clients (propietari) i els que tingui assignats
--   colaborador                → només els clients que ha aportat o que té assignats; sense documents sensibles
-- Tots els permisos es validen amb RLS (la base de dades) a més de la API.

-- ============================================================ funcions auxiliars
create or replace function public.crm_norm(t text) returns text
language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'ÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ·', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn.'));
$$;

-- ============================================================ clients
create table if not exists public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'empresa' check (kind in ('particular', 'autonom', 'empresa')),
  name text not null check (length(trim(name)) between 1 and 200),
  trade_name text,
  tax_id text,                                   -- normalitzat (majúscules, sense espais ni guions)
  tax_id_type text check (tax_id_type in ('nif', 'nie', 'cif', 'altre')),
  sector text,
  status text not null default 'potencial' check (status in ('potencial', 'actiu', 'inactiu', 'baixa')),
  registered_at date not null default current_date,
  contact_name text,
  phone text,                                    -- normalitzat (+34…)
  phone2 text,
  email text,                                    -- minúscules
  address text,
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  city text,
  province text,
  notes text,
  owner_id uuid references auth.users (id) on delete set null,          -- comercial assignat
  collaborator_id uuid references auth.users (id) on delete set null,   -- col·laborador que l'ha aportat
  origin text,
  tags text[] not null default '{}',
  priority text not null default 'mitjana' check (priority in ('baixa', 'mitjana', 'alta')),
  next_follow_up date,
  search text,                                   -- text de cerca normalitzat (trigger)
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists crm_clients_tax_id_uq on public.crm_clients (tax_id) where tax_id is not null and archived_at is null;
create index if not exists crm_clients_owner_idx on public.crm_clients (owner_id);
create index if not exists crm_clients_collab_idx on public.crm_clients (collaborator_id);
create index if not exists crm_clients_status_idx on public.crm_clients (status) where archived_at is null;
create index if not exists crm_clients_name_idx on public.crm_clients (lower(name));
create index if not exists crm_clients_city_idx on public.crm_clients (province, city);
create index if not exists crm_clients_created_idx on public.crm_clients (created_at desc);
create index if not exists crm_clients_followup_idx on public.crm_clients (next_follow_up) where next_follow_up is not null;

-- contactes (una mateixa persona pot ser contacte de diverses empreses)
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  role text,                                     -- funció: gerent, administració, compres…
  phone text,
  email text,
  is_primary boolean not null default false,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_contacts_client_idx on public.crm_contacts (client_id);
create unique index if not exists crm_contacts_primary_uq on public.crm_contacts (client_id) where is_primary;

-- assignacions addicionals (compartir un client amb un altre comercial, suport o col·laborador)
create table if not exists public.crm_client_assignments (
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'comercial' check (role in ('comercial', 'suport', 'colaborador')),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index if not exists crm_assign_user_idx on public.crm_client_assignments (user_id);

-- ============================================================ subministraments (el CUPS identifica el punt, no el contracte)
create table if not exists public.crm_supplies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  cups text not null check (cups ~ '^ES[0-9]{16}[A-Z]{2}([0-9][A-Z])?$'),
  cups20 text generated always as (left(cups, 20)) stored,
  energy_type text not null default 'luz' check (energy_type in ('luz', 'gas')),
  address text,
  postal_code text,
  city text,
  province text,
  holder_name text,
  current_retailer text,
  access_tariff text,
  power_kw numeric[] check (power_kw is null or cardinality(power_kw) <= 6),
  annual_kwh numeric check (annual_kwh is null or annual_kwh >= 0),
  period_kwh numeric[] check (period_kwh is null or cardinality(period_kwh) <= 6),
  status text not null default 'actiu' check (status in ('actiu', 'pendent_alta', 'baixa')),
  current_contract_id uuid,                      -- FK afegida després de crear crm_contracts
  data_source text not null default 'manual' check (data_source in ('manual', 'sips', 'factura', 'importacio')),
  data_updated_at timestamptz not null default now(),
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists crm_supplies_cups_uq on public.crm_supplies (cups20) where archived_at is null;
create index if not exists crm_supplies_client_idx on public.crm_supplies (client_id);

-- ============================================================ contractes (historial: un subministrament pot tenir molts contractes)
create table if not exists public.crm_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  supply_id uuid references public.crm_supplies (id) on delete set null,
  retailer text not null,
  product text,
  price_type text check (price_type in ('fix', 'periodes', 'indexat', 'mixt')),
  access_tariff text,
  signed_at date,
  start_date date,
  end_date date,                                 -- finalització o renovació
  status text not null default 'esborrany' check (status in ('esborrany', 'pendent_documentacio', 'pendent_signatura', 'enviat_comercialitzadora', 'en_tramitacio', 'actiu', 'renovacio_pendent', 'finalitzat', 'anullat', 'incidencia')),
  owner_id uuid references auth.users (id) on delete set null,
  notes text,
  previous_contract_id uuid references public.crm_contracts (id) on delete set null,
  legacy_contract_id text,                       -- contracte equivalent a la taula `contracts` (renovacions)
  comparison_id uuid,                            -- comparativa d'origen, si n'hi ha
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists crm_contracts_client_idx on public.crm_contracts (client_id, created_at desc);
create index if not exists crm_contracts_supply_idx on public.crm_contracts (supply_id, created_at desc);
create index if not exists crm_contracts_end_idx on public.crm_contracts (end_date) where status in ('actiu', 'renovacio_pendent');
create index if not exists crm_contracts_legacy_idx on public.crm_contracts (legacy_contract_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_supplies_current_contract_fk') then
    alter table public.crm_supplies add constraint crm_supplies_current_contract_fk foreign key (current_contract_id) references public.crm_contracts (id) on delete set null;
  end if;
end $$;

-- dades econòmiques i comissions (només Administració/Direcció i el comercial del contracte)
create table if not exists public.crm_contract_finance (
  contract_id uuid primary key references public.crm_contracts (id) on delete cascade,
  annual_amount_eur numeric,
  commission_eur numeric check (commission_eur is null or commission_eur >= 0),
  commission_pct numeric check (commission_pct is null or commission_pct between 0 and 100),
  commission_paid_at date,
  notes text,
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

-- ============================================================ documents (bucket privat crm-documents)
create table if not exists public.crm_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  supply_id uuid references public.crm_supplies (id) on delete set null,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  category text not null check (category in ('dni_nie', 'fiscal', 'factura_llum', 'factura_gas', 'contracte', 'contracte_signat', 'mandat', 'proposta', 'bancaria', 'altres')),
  sensitive boolean generated always as (category in ('dni_nie', 'bancaria')) stored,
  title text not null,
  description text,
  original_name text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  version integer not null default 1,
  storage_path text not null,
  status text not null default 'actiu' check (status in ('actiu', 'arxivat')),
  retain_until date,                             -- conservació obligatòria: no es pot eliminar abans
  uploaded_by uuid references auth.users (id) default auth.uid(),
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_documents_client_idx on public.crm_documents (client_id, created_at desc);
create index if not exists crm_documents_contract_idx on public.crm_documents (contract_id);
create index if not exists crm_documents_supply_idx on public.crm_documents (supply_id);

create table if not exists public.crm_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.crm_documents (id) on delete cascade,
  version integer not null,
  storage_path text not null,
  original_name text not null,
  mime text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_by uuid references auth.users (id) default auth.uid(),
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

-- ============================================================ activitat i tasques
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  supply_id uuid references public.crm_supplies (id) on delete set null,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  type text not null check (type in ('nota', 'trucada', 'reunio', 'email', 'whatsapp', 'tasca', 'seguiment', 'proposta', 'canvi', 'document')),
  title text not null,
  body text,
  at timestamptz not null default now(),
  -- email/WhatsApp: 'intent' (s'ha obert l'aplicació), 'registrat' (fet a mà i anotat), 'enviat' (confirmat per la integració), 'error'
  delivery text check (delivery in ('intent', 'registrat', 'enviat', 'error')),
  user_id uuid references auth.users (id) default auth.uid(),
  user_name text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists crm_activities_client_idx on public.crm_activities (client_id, at desc);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.crm_clients (id) on delete cascade,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 200),
  notes text,
  due_at timestamptz,
  status text not null default 'pendent' check (status in ('pendent', 'feta', 'cancellada')),
  assigned_to uuid references auth.users (id) on delete set null,
  assigned_name text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists crm_tasks_client_idx on public.crm_tasks (client_id, status, due_at);
create index if not exists crm_tasks_assignee_idx on public.crm_tasks (assigned_to, status, due_at);

-- ============================================================ incidències i reclamacions (estructura base; el gestor complet és d'una fase posterior)
create table if not exists public.crm_incidents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  supply_id uuid references public.crm_supplies (id) on delete set null,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  kind text not null default 'incidencia' check (kind in ('incidencia', 'reclamacio', 'consulta')),
  category text,                                 -- facturació, alta/canvi, lectures, tall, distribuïdora…
  title text not null check (length(trim(title)) between 1 and 200),
  description text,
  status text not null default 'oberta' check (status in ('oberta', 'en_curs', 'esperant_tercers', 'resolta', 'tancada')),
  priority text not null default 'mitjana' check (priority in ('baixa', 'mitjana', 'alta')),
  external_ref text,                             -- número de reclamació de la comercialitzadora o distribuïdora
  assigned_to uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_incidents_client_idx on public.crm_incidents (client_id, opened_at desc);

-- ============================================================ auditoria (sense dades personals: només camps i identificadors)
create table if not exists public.crm_audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_name text,
  client_id uuid,
  entity text not null,
  entity_id text not null,
  action text not null,
  fields text[],
  detail jsonb
);
create index if not exists crm_audit_client_idx on public.crm_audit_events (client_id, at desc);
create index if not exists crm_audit_entity_idx on public.crm_audit_events (entity, entity_id, at desc);

-- comparatives vinculades al client (mòdul existent)
alter table public.comparisons add column if not exists crm_client_id uuid references public.crm_clients (id) on delete set null;
alter table public.comparisons add column if not exists crm_supply_id uuid references public.crm_supplies (id) on delete set null;
create index if not exists comparisons_crm_client_idx on public.comparisons (crm_client_id, created_at desc);

-- ============================================================ permisos
create or replace function public.crm_can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff()
    or exists (select 1 from crm_clients c where c.id = p_client and (c.owner_id = auth.uid() or c.collaborator_id = auth.uid()))
    or exists (select 1 from crm_client_assignments a where a.client_id = p_client and a.user_id = auth.uid());
$$;

-- edició: Administració/Direcció, el comercial propietari o un comercial/suport assignat (no els col·laboradors)
create or replace function public.crm_can_edit_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff()
    or exists (select 1 from crm_clients c where c.id = p_client and c.owner_id = auth.uid() and public.my_role() = 'comercial')
    or exists (select 1 from crm_client_assignments a where a.client_id = p_client and a.user_id = auth.uid() and a.role in ('comercial', 'suport') and public.my_role() <> 'colaborador');
$$;

-- documents identificatius i bancaris: Administració/Direcció i el comercial propietari
create or replace function public.crm_can_see_sensitive(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from crm_clients c where c.id = p_client and c.owner_id = auth.uid() and public.my_role() = 'comercial');
$$;

create or replace function public.crm_can_see_contract_finance(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from crm_contracts k where k.id = p_contract and k.owner_id = auth.uid() and public.crm_can_see_client(k.client_id));
$$;

-- ============================================================ triggers
create or replace function public.crm_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name in ('crm_clients', 'crm_contracts') then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;

create or replace function public.crm_client_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.search := public.crm_norm(concat_ws(' ', new.name, new.trade_name, new.tax_id, new.email, regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), regexp_replace(coalesce(new.phone2, ''), '\D', '', 'g'), new.contact_name, new.city));
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_staff() then
    if new.owner_id is distinct from old.owner_id or new.collaborator_id is distinct from old.collaborator_id then
      raise exception 'Només Administració o Direcció poden canviar el comercial o el col·laborador assignat' using errcode = '42501';
    end if;
    if new.archived_at is distinct from old.archived_at then
      raise exception 'Només Administració o Direcció poden arxivar clients' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- historial de contractes: un contracte tancat no es reescriu (només Administració/Direcció poden corregir-lo)
create or replace function public.crm_contract_protect() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff() and old.status in ('finalitzat', 'anullat')
     and (new.retailer, new.product, new.signed_at, new.start_date, new.end_date, new.status, new.supply_id, new.client_id)
         is distinct from (old.retailer, old.product, old.signed_at, old.start_date, old.end_date, old.status, old.supply_id, old.client_id) then
    raise exception 'Contracte tancat: no es pot modificar. Crea''n un de nou per a la renovació.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.is_staff() and new.owner_id is distinct from old.owner_id then
    raise exception 'Només Administració o Direcció poden canviar el responsable del contracte' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.crm_document_protect() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.retain_until is not null and old.retain_until > current_date then
      raise exception 'Document amb conservació obligatòria fins al %: es pot arxivar però no eliminar', old.retain_until using errcode = '42501';
    end if;
    return old;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- auditoria automàtica: noms dels camps canviats, mai els valors
create or replace function public.crm_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[];
  k text;
  cid uuid;
  ent text := replace(tg_table_name, 'crm_', '');
begin
  if tg_op = 'UPDATE' then
    select array_agg(key) into changed from jsonb_each(to_jsonb(new)) n
      where n.key not in ('updated_at', 'updated_by', 'search') and n.value is distinct from (to_jsonb(old) -> n.key);
    if changed is null then return new; end if;
  end if;
  cid := case when tg_table_name = 'crm_clients' then coalesce((to_jsonb(new) ->> 'id')::uuid, (to_jsonb(old) ->> 'id')::uuid) else coalesce((to_jsonb(new) ->> 'client_id')::uuid, (to_jsonb(old) ->> 'client_id')::uuid) end;
  insert into crm_audit_events (user_id, user_name, client_id, entity, entity_id, action, fields)
  values (auth.uid(), (select name from profiles where id = auth.uid()), cid, ent, coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'client_id'),
          lower(tg_op), changed);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['crm_clients', 'crm_contacts', 'crm_supplies', 'crm_contracts', 'crm_incidents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.crm_touch()', t || '_touch', t);
  end loop;
  foreach t in array array['crm_clients', 'crm_contacts', 'crm_supplies', 'crm_contracts', 'crm_documents', 'crm_client_assignments', 'crm_incidents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.crm_audit()', t || '_audit', t);
  end loop;
end $$;

drop trigger if exists crm_clients_before on public.crm_clients;
create trigger crm_clients_before before insert or update on public.crm_clients for each row execute function public.crm_client_before();
drop trigger if exists crm_contracts_protect on public.crm_contracts;
create trigger crm_contracts_protect before update on public.crm_contracts for each row execute function public.crm_contract_protect();
drop trigger if exists crm_documents_protect on public.crm_documents;
create trigger crm_documents_protect before update or delete on public.crm_documents for each row execute function public.crm_document_protect();

-- ============================================================ RLS
alter table public.crm_clients enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_client_assignments enable row level security;
alter table public.crm_supplies enable row level security;
alter table public.crm_contracts enable row level security;
alter table public.crm_contract_finance enable row level security;
alter table public.crm_documents enable row level security;
alter table public.crm_document_versions enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_audit_events enable row level security;
alter table public.crm_incidents enable row level security;

-- clients
drop policy if exists p_crm_clients_select on public.crm_clients;
-- (es comprova sobre la mateixa fila perquè funcioni també en el moment de crear-la)
create policy p_crm_clients_select on public.crm_clients for select to authenticated using (
  public.is_staff() or owner_id = auth.uid() or collaborator_id = auth.uid()
  or exists (select 1 from crm_client_assignments a where a.client_id = id and a.user_id = auth.uid())
);
drop policy if exists p_crm_clients_insert on public.crm_clients;
create policy p_crm_clients_insert on public.crm_clients for insert to authenticated with check (
  public.is_staff()
  or (public.my_role() = 'comercial' and owner_id = auth.uid())
  or (public.my_role() = 'colaborador' and collaborator_id = auth.uid() and owner_id is null)
);
drop policy if exists p_crm_clients_update on public.crm_clients;
create policy p_crm_clients_update on public.crm_clients for update to authenticated using (public.crm_can_edit_client(id)) with check (public.crm_can_edit_client(id) or public.is_staff());
-- no hi ha política DELETE: els clients s'arxiven (archived_at), no s'esborren

-- contactes
drop policy if exists p_crm_contacts_select on public.crm_contacts;
create policy p_crm_contacts_select on public.crm_contacts for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists p_crm_contacts_write on public.crm_contacts;
create policy p_crm_contacts_write on public.crm_contacts for all to authenticated using (public.crm_can_edit_client(client_id)) with check (public.crm_can_edit_client(client_id));

-- assignacions: les veu qui veu el client; només Administració/Direcció les gestionen
drop policy if exists p_crm_assign_select on public.crm_client_assignments;
create policy p_crm_assign_select on public.crm_client_assignments for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists p_crm_assign_write on public.crm_client_assignments;
create policy p_crm_assign_write on public.crm_client_assignments for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- subministraments
drop policy if exists p_crm_supplies_select on public.crm_supplies;
create policy p_crm_supplies_select on public.crm_supplies for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists p_crm_supplies_insert on public.crm_supplies;
create policy p_crm_supplies_insert on public.crm_supplies for insert to authenticated with check (public.crm_can_edit_client(client_id));
drop policy if exists p_crm_supplies_update on public.crm_supplies;
create policy p_crm_supplies_update on public.crm_supplies for update to authenticated using (public.crm_can_edit_client(client_id)) with check (public.crm_can_edit_client(client_id));

-- contractes
drop policy if exists p_crm_contracts_select on public.crm_contracts;
create policy p_crm_contracts_select on public.crm_contracts for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists p_crm_contracts_insert on public.crm_contracts;
create policy p_crm_contracts_insert on public.crm_contracts for insert to authenticated with check (public.crm_can_edit_client(client_id));
drop policy if exists p_crm_contracts_update on public.crm_contracts;
create policy p_crm_contracts_update on public.crm_contracts for update to authenticated using (public.crm_can_edit_client(client_id)) with check (public.crm_can_edit_client(client_id));

drop policy if exists p_crm_finance_select on public.crm_contract_finance;
create policy p_crm_finance_select on public.crm_contract_finance for select to authenticated using (public.crm_can_see_contract_finance(contract_id));
drop policy if exists p_crm_finance_write on public.crm_contract_finance;
create policy p_crm_finance_write on public.crm_contract_finance for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- documents: els sensibles (DNI/NIE i bancaris) només per a Administració/Direcció i el comercial propietari
drop policy if exists p_crm_docs_select on public.crm_documents;
create policy p_crm_docs_select on public.crm_documents for select to authenticated
  using (public.crm_can_see_client(client_id) and (not sensitive or public.crm_can_see_sensitive(client_id)));
drop policy if exists p_crm_docs_insert on public.crm_documents;
create policy p_crm_docs_insert on public.crm_documents for insert to authenticated
  with check (public.crm_can_see_client(client_id) and uploaded_by = auth.uid() and (category not in ('dni_nie', 'bancaria') or public.crm_can_see_sensitive(client_id)));
drop policy if exists p_crm_docs_update on public.crm_documents;
create policy p_crm_docs_update on public.crm_documents for update to authenticated
  using (public.crm_can_edit_client(client_id) and (not sensitive or public.crm_can_see_sensitive(client_id)))
  with check (public.crm_can_edit_client(client_id) and (category not in ('dni_nie', 'bancaria') or public.crm_can_see_sensitive(client_id)));
drop policy if exists p_crm_docs_delete on public.crm_documents;
create policy p_crm_docs_delete on public.crm_documents for delete to authenticated using (public.is_staff());

drop policy if exists p_crm_docv_select on public.crm_document_versions;
create policy p_crm_docv_select on public.crm_document_versions for select to authenticated
  using (exists (select 1 from crm_documents d where d.id = document_id));   -- hereta la RLS del document
drop policy if exists p_crm_docv_insert on public.crm_document_versions;
create policy p_crm_docv_insert on public.crm_document_versions for insert to authenticated
  with check (uploaded_by = auth.uid() and exists (select 1 from crm_documents d where d.id = document_id and public.crm_can_see_client(d.client_id)));

-- activitat: qui veu el client la veu i en pot afegir; cadascú edita la seva; Administració pot esborrar
drop policy if exists p_crm_act_select on public.crm_activities;
create policy p_crm_act_select on public.crm_activities for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists p_crm_act_insert on public.crm_activities;
create policy p_crm_act_insert on public.crm_activities for insert to authenticated with check (public.crm_can_see_client(client_id) and user_id = auth.uid());
drop policy if exists p_crm_act_update on public.crm_activities;
create policy p_crm_act_update on public.crm_activities for update to authenticated using (user_id = auth.uid() or public.is_staff()) with check (public.crm_can_see_client(client_id));
drop policy if exists p_crm_act_delete on public.crm_activities;
create policy p_crm_act_delete on public.crm_activities for delete to authenticated using (public.is_staff());

-- tasques
drop policy if exists p_crm_tasks_select on public.crm_tasks;
create policy p_crm_tasks_select on public.crm_tasks for select to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid() or public.is_staff() or (client_id is not null and public.crm_can_see_client(client_id)));
drop policy if exists p_crm_tasks_insert on public.crm_tasks;
create policy p_crm_tasks_insert on public.crm_tasks for insert to authenticated
  with check (created_by = auth.uid() and (client_id is null or public.crm_can_see_client(client_id)) and (assigned_to = auth.uid() or public.can_assign() or public.is_staff() or (client_id is not null and public.crm_can_edit_client(client_id))));
drop policy if exists p_crm_tasks_update on public.crm_tasks;
create policy p_crm_tasks_update on public.crm_tasks for update to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid() or public.is_staff() or (client_id is not null and public.crm_can_edit_client(client_id)))
  with check (client_id is null or public.crm_can_see_client(client_id));

-- incidències: qui veu el client les veu i les pot obrir; les gestionen qui pot editar el client
drop policy if exists p_crm_inc_select on public.crm_incidents;
create policy p_crm_inc_select on public.crm_incidents for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists p_crm_inc_insert on public.crm_incidents;
create policy p_crm_inc_insert on public.crm_incidents for insert to authenticated with check (public.crm_can_see_client(client_id) and created_by = auth.uid());
drop policy if exists p_crm_inc_update on public.crm_incidents;
create policy p_crm_inc_update on public.crm_incidents for update to authenticated using (public.crm_can_edit_client(client_id) or assigned_to = auth.uid()) with check (public.crm_can_see_client(client_id));

-- auditoria: la veu qui veu el client (només camps, sense valors); l'escriuen els triggers i el servidor
drop policy if exists p_crm_audit_select on public.crm_audit_events;
create policy p_crm_audit_select on public.crm_audit_events for select to authenticated using (public.is_staff() or (client_id is not null and public.crm_can_see_client(client_id)));

-- comparatives: també les veu qui pot veure el client vinculat (les polítiques de la 006 es mantenen i s'amplien)
create or replace function public.can_see_comparison(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from comparisons c where c.id = p_id and (c.created_by = auth.uid() or public.is_staff()
    or (c.contract_id is not null and public.can_see(c.contract_id))
    or (c.crm_client_id is not null and public.crm_can_see_client(c.crm_client_id))));
$$;
drop policy if exists p_cmp_read on public.comparisons;
create policy p_cmp_read on public.comparisons for select to authenticated using (created_by = auth.uid() or public.is_staff()
  or (contract_id is not null and public.can_see(contract_id)) or (crm_client_id is not null and public.crm_can_see_client(crm_client_id)));
drop policy if exists p_cmp_insert on public.comparisons;
create policy p_cmp_insert on public.comparisons for insert to authenticated with check (created_by = auth.uid()
  and (contract_id is null or public.can_see(contract_id)) and (crm_client_id is null or public.crm_can_see_client(crm_client_id)));
drop policy if exists p_cmp_update on public.comparisons;
create policy p_cmp_update on public.comparisons for update to authenticated using (created_by = auth.uid() or public.is_staff())
  with check ((contract_id is null or public.can_see(contract_id)) and (crm_client_id is null or public.crm_can_see_client(crm_client_id)));

-- ============================================================ emmagatzematge privat
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-documents', 'crm-documents', false, 26214400)
on conflict (id) do nothing;
-- Sense polítiques per a `authenticated`: només el servidor (després de validar permisos) hi llegeix i hi escriu.
-- Les pujades es fan amb URL signades d'un sol ús que genera el servidor per a una ruta que fixa ell mateix.

-- ============================================================ vista de llistat (respecta RLS: security_invoker)
create or replace view public.crm_clients_list with (security_invoker = true) as
select c.*,
  (select count(*) from crm_supplies s where s.client_id = c.id and s.archived_at is null) as supplies_count,
  (select count(*) from crm_supplies s where s.client_id = c.id and s.archived_at is null and s.energy_type = 'luz') as luz_count,
  (select count(*) from crm_supplies s where s.client_id = c.id and s.archived_at is null and s.energy_type = 'gas') as gas_count,
  (select count(*) from crm_contracts k where k.client_id = c.id and k.status in ('actiu', 'renovacio_pendent')) as active_contracts,
  (select min(k.end_date) from crm_contracts k where k.client_id = c.id and k.status in ('actiu', 'renovacio_pendent') and k.end_date >= current_date) as next_renewal,
  (select max(a.at) from crm_activities a where a.client_id = c.id) as last_activity_at,
  (select p.name from profiles p where p.id = c.owner_id) as owner_name,
  (select string_agg(s.cups, ' ') from crm_supplies s where s.client_id = c.id and s.archived_at is null) as cups_list
from public.crm_clients c;

grant select on public.crm_clients_list to authenticated;
