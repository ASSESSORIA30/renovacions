-- =====================================================================================================
-- Fase 10 · 020 · AGENDA PERSONAL I COMPARTIDA, DISPONIBILITAT, RECORDATORIS I CALENDARIS EXTERNS
-- =====================================================================================================
-- Migració ADDITIVA i idempotent: no esborra ni modifica dades existents. Desfer: 020_agenda_down.sql.
-- Requereix: 008 (Clients 360°), 009 (avisos crm_notifications), 014 (permisos has_perm/can_assign) i 016 (equips).
--
--   · agenda_events: cites, trucades, visites, reunions, seguiments, recordatoris i absències. Les TASQUES no es
--     dupliquen: l'agenda llegeix crm_tasks (mateixa taula del gestor de tasques) i hi enllaça (task_id).
--   · Privacitat: una cita PERSONAL només la veuen el propietari, qui l'ha creada i els participants. La resta
--     de l'equip només en veu l'ocupació (calculada al servidor, sense títol ni detalls). Les cites COMPARTIDES
--     les veu tot l'equip intern amb el mòdul «agenda».
--   · Assignar una cita a una altra persona: Direcció, Cap administrativa (can_assign) o el Cap d'equip als seus.
--   · calendar_connections: tokens OAuth de Google/Microsoft XIFRATS i sense cap política de lectura per als
--     usuaris (només el servidor amb la service role). Mai arriben al navegador.
-- =====================================================================================================

-- ============================================================ 1. permís de mòdul «agenda»
insert into public.role_permissions (role, module, can_read, can_edit, can_approve) values
  ('cap_administrativa', 'agenda', true, true, true),
  ('cap_equip', 'agenda', true, true, true),
  ('administrativa', 'agenda', true, true, false),
  ('comercial', 'agenda', true, true, false),
  ('colaborador', 'agenda', false, false, false)
on conflict (role, module) do nothing;

-- ============================================================ 2. esdeveniments
create table if not exists public.agenda_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,      -- agenda on apareix (responsable)
  created_by uuid not null references auth.users (id) default auth.uid(),
  created_by_name text,
  updated_by_name text,
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 5000),
  kind text not null default 'cita' check (kind in ('cita', 'trucada', 'visita', 'reunio', 'seguiment', 'recordatori', 'tasca', 'absencia')),
  scope text not null default 'personal' check (scope in ('personal', 'compartida')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'Europe/Madrid',
  location text check (location is null or length(location) <= 300),
  priority text not null default 'normal' check (priority in ('baixa', 'normal', 'alta', 'urgent')),
  status text not null default 'programada' check (status in ('programada', 'confirmada', 'feta', 'cancellada', 'no_presentat')),
  -- vincles amb el CRM (tots opcionals)
  client_id uuid references public.crm_clients (id) on delete set null,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  renewal_id text,                                                           -- targeta del Kanban de renovacions
  incident_id uuid references public.crm_incidents (id) on delete set null,
  task_id uuid references public.crm_tasks (id) on delete set null,
  -- recurrència: {"freq":"daily|weekly|monthly|yearly","interval":1,"byweekday":[1..7],"until":"YYYY-MM-DD","count":10}
  recurrence jsonb,
  exdates timestamptz[] not null default '{}',                               -- ocurrències esborrades o editades a part
  recurrence_parent_id uuid references public.agenda_events (id) on delete set null,
  recurrence_original_start timestamptz,
  -- recordatoris (minuts abans) i canals; ara només «crm» (correu i WhatsApp quan hi hagi integració real)
  reminders integer[] not null default '{15}',
  channels text[] not null default '{crm}' check (channels <@ array['crm', 'email', 'whatsapp']::text[]),
  -- calendaris externs (cites importades de Google/Outlook)
  external_source text check (external_source is null or external_source in ('google', 'microsoft')),
  external_id text,
  external_etag text,
  external_updated_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at),
  check (cardinality(reminders) <= 5)
);
create index if not exists agenda_events_owner_idx on public.agenda_events (owner_id, starts_at);
create index if not exists agenda_events_range_idx on public.agenda_events (starts_at, ends_at);
create index if not exists agenda_events_scope_idx on public.agenda_events (scope, starts_at);
create index if not exists agenda_events_client_idx on public.agenda_events (client_id) where client_id is not null;
create index if not exists agenda_events_recurring_idx on public.agenda_events (owner_id) where recurrence is not null;
create unique index if not exists agenda_events_external_uq on public.agenda_events (owner_id, external_source, external_id) where external_id is not null;

create table if not exists public.agenda_participants (
  event_id uuid not null references public.agenda_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_name text,
  response text not null default 'pendent' check (response in ('pendent', 'accepta', 'rebutja')),
  added_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists agenda_participants_user_idx on public.agenda_participants (user_id);

-- versió + data de modificació a cada canvi (per detectar conflictes i per a la sincronització)
create or replace function public.agenda_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.version := old.version + 1; new.created_by := old.created_by; end if;
  return new;
end $$;
drop trigger if exists agenda_events_touch on public.agenda_events;
create trigger agenda_events_touch before update on public.agenda_events for each row execute function public.agenda_touch();

-- qui pot posar una cita a l'agenda d'una altra persona
create or replace function public.agenda_can_assign(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or coalesce(public.can_assign(), false) or public.my_role() = 'admin'
      or public.crm_team_sees_user(p_user);
$$;

-- l'usuari actual pot veure el detall de la cita
create or replace function public.agenda_can_see(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from agenda_events e where e.id = p_event and coalesce(public.my_role() <> 'colaborador', false) and (
      e.owner_id = auth.uid() or e.created_by = auth.uid()
      or exists (select 1 from agenda_participants p where p.event_id = e.id and p.user_id = auth.uid())
      or (e.scope = 'compartida' and public.has_perm('agenda', 'read'))));
$$;

-- l'usuari actual pot modificar la cita (no les respostes dels altres participants)
create or replace function public.agenda_can_edit(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from agenda_events e where e.id = p_event and coalesce(public.my_role() <> 'colaborador', false) and (
      e.owner_id = auth.uid() or e.created_by = auth.uid()
      or (e.scope = 'compartida' and public.has_perm('agenda', 'approve'))
      or (e.scope = 'compartida' and public.crm_team_sees_user(e.owner_id))));
$$;

alter table public.agenda_events enable row level security;
alter table public.agenda_participants enable row level security;

drop policy if exists p_agenda_select on public.agenda_events;
create policy p_agenda_select on public.agenda_events for select to authenticated using (
  coalesce(public.my_role() <> 'colaborador', false) and (
    owner_id = auth.uid() or created_by = auth.uid()
    or exists (select 1 from agenda_participants p where p.event_id = id and p.user_id = auth.uid())
    or (scope = 'compartida' and public.has_perm('agenda', 'read'))));
drop policy if exists p_agenda_insert on public.agenda_events;
create policy p_agenda_insert on public.agenda_events for insert to authenticated with check (
  coalesce(public.my_role() <> 'colaborador', false) and created_by = auth.uid() and public.has_perm('agenda', 'edit')
  and public.agenda_can_assign(owner_id));
drop policy if exists p_agenda_update on public.agenda_events;
create policy p_agenda_update on public.agenda_events for update to authenticated
  using (public.agenda_can_edit(id))
  with check (public.agenda_can_assign(owner_id) or created_by = auth.uid());
drop policy if exists p_agenda_delete on public.agenda_events;
create policy p_agenda_delete on public.agenda_events for delete to authenticated using (public.agenda_can_edit(id));

drop policy if exists p_agenda_part_select on public.agenda_participants;
create policy p_agenda_part_select on public.agenda_participants for select to authenticated using (user_id = auth.uid() or public.agenda_can_see(event_id));
drop policy if exists p_agenda_part_insert on public.agenda_participants;
create policy p_agenda_part_insert on public.agenda_participants for insert to authenticated with check (public.agenda_can_edit(event_id));
drop policy if exists p_agenda_part_update on public.agenda_participants;
create policy p_agenda_part_update on public.agenda_participants for update to authenticated
  using (user_id = auth.uid() or public.agenda_can_edit(event_id)) with check (user_id = auth.uid() or public.agenda_can_edit(event_id));
drop policy if exists p_agenda_part_delete on public.agenda_participants;
create policy p_agenda_part_delete on public.agenda_participants for delete to authenticated using (public.agenda_can_edit(event_id));

-- ============================================================ 3. calendaris externs (Google / Microsoft)
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text,
  mode text not null default 'lectura' check (mode in ('lectura', 'exportacio', 'bidireccional')),
  status text not null default 'pendent' check (status in ('pendent', 'connectat', 'error', 'revocat')),
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scope text,
  calendar_id text not null default 'primary',
  sync_token text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create table if not exists public.calendar_event_links (
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  event_id uuid not null references public.agenda_events (id) on delete cascade,
  external_id text not null,
  external_etag text,
  pushed_version integer,
  last_pushed_at timestamptz,
  primary key (connection_id, event_id),
  unique (connection_id, external_id)
);
-- RLS activada SENSE polítiques: només el servidor (service role) hi accedeix. Els tokens no surten mai.
alter table public.calendar_connections enable row level security;
alter table public.calendar_event_links enable row level security;

-- ============================================================ COMPROVACIÓ (ha de retornar 4 taules i 1 permís per rol intern)
select 'taules de l''agenda' as què, count(*) as total from information_schema.tables
 where table_schema = 'public' and table_name in ('agenda_events', 'agenda_participants', 'calendar_connections', 'calendar_event_links')
union all select 'permisos «agenda»', count(*) from public.role_permissions where module = 'agenda';
