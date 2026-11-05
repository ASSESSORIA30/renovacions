-- 009 · CRM FASE 2: GESTIÓ COMERCIAL (leads, oportunitats, agenda, automatitzacions, notificacions, objectius)
-- Additiva i idempotent. Reutilitza crm_clients, crm_activities, crm_tasks, crm_contracts i comparisons.
-- Reversible amb 009_crm_comercial_down.sql.

-- ============================================================ leads (captació: encara no són clients)
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'empresa' check (kind in ('particular', 'autonom', 'empresa')),
  name text not null check (length(trim(name)) between 1 and 200),     -- persona o empresa
  company text,
  contact_name text,
  tax_id text,
  phone text,
  email text,
  address text,
  postal_code text,
  city text,
  province text,
  origin text,
  services text[] not null default '{}' check (services <@ array['llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes']::text[]),
  notes text,
  status text not null default 'nou' check (status in ('nou', 'contactat', 'qualificat', 'convertit', 'descartat')),
  discard_reason text,
  owner_id uuid references auth.users (id) on delete set null,
  collaborator_id uuid references auth.users (id) on delete set null,
  converted_client_id uuid references public.crm_clients (id) on delete set null,
  converted_at timestamptz,
  first_contact_at timestamptz,
  search text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_leads_owner_idx on public.crm_leads (owner_id, status);
create index if not exists crm_leads_status_idx on public.crm_leads (status, created_at desc);
create index if not exists crm_leads_client_idx on public.crm_leads (converted_client_id);

-- ============================================================ oportunitats (una per servei; un client en pot tenir moltes)
create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads (id) on delete set null,
  client_id uuid references public.crm_clients (id) on delete cascade,
  supply_id uuid references public.crm_supplies (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 200),
  service text not null check (service in ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes')),
  stage text not null default 'nou_lead' check (stage in ('nou_lead', 'contactat', 'factura_sollicitada', 'estudi', 'proposta_enviada', 'negociacio', 'guanyat', 'perdut')),
  owner_id uuid references auth.users (id) on delete set null,
  collaborator_id uuid references auth.users (id) on delete set null,
  annual_kwh numeric check (annual_kwh is null or annual_kwh >= 0),
  mwh numeric generated always as (round(annual_kwh / 1000.0, 3)) stored,
  commission_eur numeric check (commission_eur is null or commission_eur >= 0),
  probability integer check (probability is null or probability between 0 and 100),
  priority text not null default 'mitjana' check (priority in ('baixa', 'mitjana', 'alta')),
  next_action text,
  next_action_at timestamptz,
  expected_close date,
  province text,
  lost_reason text,
  comparison_id uuid references public.comparisons (id) on delete set null,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  notes text,
  position double precision not null default 0,                   -- ordre dins la columna
  version integer not null default 1,                             -- concurrència optimista entre usuaris
  stage_changed_at timestamptz not null default now(),
  proposal_sent_at timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lead_id is not null or client_id is not null)
);
create index if not exists crm_opps_stage_idx on public.crm_opportunities (stage, position);
create index if not exists crm_opps_owner_idx on public.crm_opportunities (owner_id, stage);
create index if not exists crm_opps_client_idx on public.crm_opportunities (client_id);
create index if not exists crm_opps_lead_idx on public.crm_opportunities (lead_id);

-- ============================================================ activitat i tasques: ara també de leads i oportunitats
alter table public.crm_activities alter column client_id drop not null;
alter table public.crm_activities add column if not exists lead_id uuid references public.crm_leads (id) on delete cascade;
alter table public.crm_activities add column if not exists opportunity_id uuid references public.crm_opportunities (id) on delete set null;
alter table public.crm_activities add column if not exists outcome text;             -- resultat (contestat, no contesta, interessat…)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_activities_owner_chk') then
    alter table public.crm_activities add constraint crm_activities_owner_chk check (client_id is not null or lead_id is not null) not valid;
  end if;
end $$;
create index if not exists crm_activities_lead_idx on public.crm_activities (lead_id, at desc);
create index if not exists crm_activities_opp_idx on public.crm_activities (opportunity_id, at desc);

alter table public.crm_tasks add column if not exists lead_id uuid references public.crm_leads (id) on delete cascade;
alter table public.crm_tasks add column if not exists opportunity_id uuid references public.crm_opportunities (id) on delete set null;
alter table public.crm_tasks add column if not exists kind text not null default 'seguiment';
alter table public.crm_tasks add column if not exists duration_min integer;
alter table public.crm_tasks add column if not exists source text not null default 'manual';
alter table public.crm_tasks add column if not exists rule_key text;                 -- idempotència de les automatitzacions
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_kind_chk') then
    alter table public.crm_tasks add constraint crm_tasks_kind_chk check (kind in ('trucada', 'reunio', 'seguiment', 'tramitacio', 'renovacio', 'altres'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_source_chk') then
    alter table public.crm_tasks add constraint crm_tasks_source_chk check (source in ('manual', 'automatica'));
  end if;
end $$;
create unique index if not exists crm_tasks_rule_key_uq on public.crm_tasks (rule_key);
create index if not exists crm_tasks_opp_idx on public.crm_tasks (opportunity_id);
create index if not exists crm_tasks_lead_idx on public.crm_tasks (lead_id);
create index if not exists crm_tasks_due_idx on public.crm_tasks (due_at) where status = 'pendent';

alter table public.comparisons add column if not exists crm_opportunity_id uuid references public.crm_opportunities (id) on delete set null;
create index if not exists comparisons_crm_opp_idx on public.comparisons (crm_opportunity_id);

-- ============================================================ automatitzacions, notificacions i objectius
create table if not exists public.crm_automation_rules (
  key text primary key,
  name text not null,
  description text,
  enabled boolean not null default true,
  params jsonb not null default '{}',
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
insert into public.crm_automation_rules (key, name, description, params) values
  ('proposta_sense_resposta', 'Proposta sense resposta', 'Si fa X dies que s''ha enviat una proposta i no hi ha cap activitat posterior, crea una tasca de seguiment per al responsable.', '{"days": 3}'),
  ('venciment_contracte', 'Venciment de contractes', 'Avisa el responsable quan un contracte actiu venç d''aquí a 90, 60 i 30 dies.', '{"days": [90, 60, 30]}'),
  ('lead_sense_contacte', 'Lead sense primer contacte', 'Avisa el responsable (o Administració si no n''hi ha) quan un lead nou porta X hores sense cap contacte.', '{"hours": 24}'),
  ('oportunitat_inactiva', 'Oportunitat inactiva', 'Avisa quan una oportunitat oberta porta X dies sense activitat (com a màxim un avís per setmana).', '{"days": 7}'),
  ('proposta_acceptada', 'Proposta acceptada', 'Quan una oportunitat es marca com a guanyada, crea una tasca de tramitació.', '{"due_days": 2}'),
  ('preparar_renovacio', 'Preparar la renovació', 'Quan un contracte s''activa, crea una tasca per preparar-ne la renovació X dies abans del venciment.', '{"days_before": 90}')
on conflict (key) do nothing;

create table if not exists public.crm_automation_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'cron',
  tasks_created integer not null default 0,
  notifications_created integer not null default 0,
  ok boolean,
  error text,
  detail jsonb
);

create table if not exists public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link jsonb,                                   -- {"view": "oportunitat", "params": {"id": "…"}}
  rule_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, rule_key)
);
create index if not exists crm_notifications_user_idx on public.crm_notifications (user_id, read_at, created_at desc);

create table if not exists public.crm_targets (
  user_id uuid not null references auth.users (id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- mes AAAA-MM
  metric text not null check (metric in ('guanyades', 'mwh', 'comissio', 'oportunitats')),
  target numeric not null check (target >= 0),
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (user_id, period, metric)
);

-- ============================================================ permisos
create or replace function public.crm_can_see_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from crm_leads l where l.id = p_lead and (l.owner_id = auth.uid() or l.collaborator_id = auth.uid() or l.created_by = auth.uid()));
$$;
create or replace function public.crm_can_edit_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from crm_leads l where l.id = p_lead and l.owner_id = auth.uid() and public.my_role() = 'comercial');
$$;
create or replace function public.crm_can_see_opportunity(p_opp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_opportunities o where o.id = p_opp and (
    public.is_staff() or o.owner_id = auth.uid() or o.collaborator_id = auth.uid()
    or (o.client_id is not null and public.crm_can_see_client(o.client_id))
    or (o.lead_id is not null and public.crm_can_see_lead(o.lead_id))));
$$;

create or replace function public.crm_can_edit_opportunity(p_opp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_opportunities o where o.id = p_opp and (
    public.is_staff() or (o.owner_id = auth.uid() and public.my_role() = 'comercial')
    or (o.client_id is not null and public.crm_can_edit_client(o.client_id))));
$$;

-- ============================================================ triggers
create or replace function public.crm_lead_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.search := public.crm_norm(concat_ws(' ', new.name, new.company, new.contact_name, new.tax_id, new.email, regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), new.city));
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_staff()
     and (new.owner_id is distinct from old.owner_id or new.collaborator_id is distinct from old.collaborator_id) then
    raise exception 'Només Administració o Direcció poden reassignar leads' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists crm_leads_before on public.crm_leads;
create trigger crm_leads_before before insert or update on public.crm_leads for each row execute function public.crm_lead_before();

-- Canvi d'etapa: dates de seguiment, historial a la fitxa i protecció de la reassignació.
create or replace function public.crm_opp_before() returns trigger language plpgsql security definer set search_path = public as $$
declare
  ign text[] := array['updated_at', 'last_activity_at', 'version', 'mwh'];  -- mwh és calculada (encara no té valor aquí)
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    if new.stage = 'proposta_enviada' then new.proposal_sent_at := coalesce(new.proposal_sent_at, now()); end if;
    if new.stage = 'guanyat' then new.won_at := coalesce(new.won_at, now()); end if;
    if new.stage = 'perdut' then new.lost_at := coalesce(new.lost_at, now()); end if;
    return new;
  end if;
  -- Només els canvis reals compten com a modificació (la data d'última activitat no altera la versió del tauler).
  if (to_jsonb(new) - ign) = (to_jsonb(old) - ign) then
    new.version := old.version;
    return new;
  end if;
  new.updated_at := now();
  if auth.uid() is not null and not public.is_staff() and new.owner_id is distinct from old.owner_id then
    raise exception 'Només Administració o Direcció poden reassignar oportunitats' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage = 'proposta_enviada' and old.proposal_sent_at is null then new.proposal_sent_at := now(); end if;
    if new.stage = 'guanyat' then new.won_at := now(); new.lost_at := null; new.probability := 100; end if;
    if new.stage = 'perdut' then new.lost_at := now(); new.won_at := null; new.probability := 0; end if;
    if new.stage not in ('guanyat', 'perdut') then new.won_at := null; new.lost_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_opps_before on public.crm_opportunities;
create trigger crm_opps_before before insert or update on public.crm_opportunities for each row execute function public.crm_opp_before();

create or replace function public.crm_opp_after() returns trigger language plpgsql security definer set search_path = public as $$
declare labels jsonb := '{"nou_lead":"Nou lead","contactat":"Contactat","factura_sollicitada":"Factura sol·licitada","estudi":"Estudi en curs","proposta_enviada":"Proposta enviada","negociacio":"Negociació","guanyat":"Guanyat","perdut":"Perdut"}';
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into crm_activities (client_id, lead_id, opportunity_id, type, title, body, user_id, user_name, meta)
    values (new.client_id, case when new.client_id is null then new.lead_id end, new.id, 'canvi',
            format('%s: %s → %s', new.title, labels ->> old.stage, labels ->> new.stage),
            case when new.stage = 'perdut' then new.lost_reason end,
            auth.uid(), (select name from profiles where id = auth.uid()), jsonb_build_object('from', old.stage, 'to', new.stage));
  end if;
  return new;
end $$;
drop trigger if exists crm_opps_after on public.crm_opportunities;
create trigger crm_opps_after after update on public.crm_opportunities for each row execute function public.crm_opp_after();

-- Cada activitat actualitza la data d'última activitat de l'oportunitat i el primer contacte del lead.
create or replace function public.crm_activity_touch() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.opportunity_id is not null and new.type <> 'canvi' then
    update crm_opportunities set last_activity_at = greatest(last_activity_at, new.at) where id = new.opportunity_id;
  end if;
  if new.lead_id is not null and new.type in ('trucada', 'reunio', 'email', 'whatsapp') then
    update crm_leads set first_contact_at = coalesce(first_contact_at, new.at), status = case when status = 'nou' then 'contactat' else status end where id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists crm_activities_touch on public.crm_activities;
create trigger crm_activities_touch after insert on public.crm_activities for each row execute function public.crm_activity_touch();

-- auditoria: s'ignoren també els camps tècnics de les oportunitats (versió, ordre, dates automàtiques)
create or replace function public.crm_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[];
  cid uuid;
  ent text := replace(tg_table_name, 'crm_', '');
begin
  if tg_op = 'UPDATE' then
    select array_agg(key) into changed from jsonb_each(to_jsonb(new)) n
      where n.key not in ('updated_at', 'updated_by', 'search', 'version', 'position', 'last_activity_at', 'stage_changed_at') and n.value is distinct from (to_jsonb(old) -> n.key);
    if changed is null then return new; end if;
  end if;
  cid := case when tg_table_name = 'crm_clients' then coalesce((to_jsonb(new) ->> 'id')::uuid, (to_jsonb(old) ->> 'id')::uuid)
              else coalesce((to_jsonb(new) ->> 'client_id')::uuid, (to_jsonb(old) ->> 'client_id')::uuid) end;
  insert into crm_audit_events (user_id, user_name, client_id, entity, entity_id, action, fields)
  values (auth.uid(), (select name from profiles where id = auth.uid()), cid, ent, coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'client_id'),
          lower(tg_op), changed);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['crm_leads', 'crm_opportunities'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.crm_audit()', t || '_audit', t);
  end loop;
end $$;

-- Vincula cada subministrament amb el seu contracte vigent més recent (ús en importacions, en una sola consulta).
create or replace function public.crm_link_current_contracts(p_supplies uuid[]) returns integer
language sql security invoker set search_path = public as $$
  with k as (
    select distinct on (supply_id) id, supply_id from crm_contracts
    where supply_id = any(p_supplies) and status in ('actiu', 'renovacio_pendent')
    order by supply_id, created_at desc
  ), u as (update crm_supplies s set current_contract_id = k.id from k where s.id = k.supply_id returning 1)
  select count(*)::int from u;
$$;

-- ============================================================ RLS
alter table public.crm_leads enable row level security;
alter table public.crm_opportunities enable row level security;
alter table public.crm_automation_rules enable row level security;
alter table public.crm_automation_runs enable row level security;
alter table public.crm_notifications enable row level security;
alter table public.crm_targets enable row level security;

drop policy if exists p_crm_leads_select on public.crm_leads;
create policy p_crm_leads_select on public.crm_leads for select to authenticated
  using (public.is_staff() or owner_id = auth.uid() or collaborator_id = auth.uid() or created_by = auth.uid());
drop policy if exists p_crm_leads_insert on public.crm_leads;
create policy p_crm_leads_insert on public.crm_leads for insert to authenticated with check (
  created_by = auth.uid() and (
    public.is_staff()
    or (public.my_role() = 'comercial' and owner_id = auth.uid())
    or (public.my_role() = 'colaborador' and collaborator_id = auth.uid() and owner_id is null)));
drop policy if exists p_crm_leads_update on public.crm_leads;
create policy p_crm_leads_update on public.crm_leads for update to authenticated using (public.crm_can_edit_lead(id)) with check (public.crm_can_edit_lead(id) or public.is_staff());

drop policy if exists p_crm_opps_select on public.crm_opportunities;
create policy p_crm_opps_select on public.crm_opportunities for select to authenticated using (
  public.is_staff() or owner_id = auth.uid() or collaborator_id = auth.uid()
  or (client_id is not null and public.crm_can_see_client(client_id))
  or (lead_id is not null and public.crm_can_see_lead(lead_id)));
drop policy if exists p_crm_opps_insert on public.crm_opportunities;
create policy p_crm_opps_insert on public.crm_opportunities for insert to authenticated with check (
  created_by = auth.uid()
  and (client_id is null or public.crm_can_see_client(client_id))
  and (lead_id is null or public.crm_can_see_lead(lead_id))
  and (public.is_staff() or (public.my_role() = 'comercial' and owner_id = auth.uid()) or (public.my_role() = 'colaborador' and collaborator_id = auth.uid() and owner_id is null)));
drop policy if exists p_crm_opps_update on public.crm_opportunities;
create policy p_crm_opps_update on public.crm_opportunities for update to authenticated
  using (public.is_staff() or (owner_id = auth.uid() and public.my_role() = 'comercial') or (client_id is not null and public.crm_can_edit_client(client_id)))
  with check (public.is_staff() or (owner_id = auth.uid() and public.my_role() = 'comercial') or (client_id is not null and public.crm_can_edit_client(client_id)));
-- no hi ha DELETE: les oportunitats es tanquen com a perdudes

-- activitat: també de leads i oportunitats
drop policy if exists p_crm_act_select on public.crm_activities;
create policy p_crm_act_select on public.crm_activities for select to authenticated using (
  (client_id is not null and public.crm_can_see_client(client_id))
  or (lead_id is not null and public.crm_can_see_lead(lead_id))
  or (opportunity_id is not null and public.crm_can_see_opportunity(opportunity_id)));
drop policy if exists p_crm_act_insert on public.crm_activities;
create policy p_crm_act_insert on public.crm_activities for insert to authenticated with check (
  user_id = auth.uid()
  and (client_id is null or public.crm_can_see_client(client_id))
  and (lead_id is null or public.crm_can_see_lead(lead_id))
  and (opportunity_id is null or public.crm_can_see_opportunity(opportunity_id))
  and (client_id is not null or lead_id is not null));
drop policy if exists p_crm_act_update on public.crm_activities;
create policy p_crm_act_update on public.crm_activities for update to authenticated using (user_id = auth.uid() or public.is_staff())
  with check ((client_id is null or public.crm_can_see_client(client_id)) and (lead_id is null or public.crm_can_see_lead(lead_id)));

-- tasques: també de leads i oportunitats
drop policy if exists p_crm_tasks_select on public.crm_tasks;
create policy p_crm_tasks_select on public.crm_tasks for select to authenticated using (
  assigned_to = auth.uid() or created_by = auth.uid() or public.is_staff()
  or (client_id is not null and public.crm_can_see_client(client_id))
  or (lead_id is not null and public.crm_can_see_lead(lead_id))
  or (opportunity_id is not null and public.crm_can_see_opportunity(opportunity_id)));
drop policy if exists p_crm_tasks_insert on public.crm_tasks;
create policy p_crm_tasks_insert on public.crm_tasks for insert to authenticated with check (
  created_by = auth.uid()
  and (client_id is null or public.crm_can_see_client(client_id))
  and (lead_id is null or public.crm_can_see_lead(lead_id))
  and (opportunity_id is null or public.crm_can_see_opportunity(opportunity_id))
  and (assigned_to = auth.uid() or public.can_assign() or public.is_staff()
       or (client_id is not null and public.crm_can_edit_client(client_id))
       or (lead_id is not null and public.crm_can_edit_lead(lead_id))));

-- automatitzacions: les veu tothom; les configura Direcció (admin). Les execucions les escriu el servidor.
drop policy if exists p_crm_rules_select on public.crm_automation_rules;
create policy p_crm_rules_select on public.crm_automation_rules for select to authenticated using (true);
drop policy if exists p_crm_rules_update on public.crm_automation_rules;
create policy p_crm_rules_update on public.crm_automation_rules for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists p_crm_runs_select on public.crm_automation_runs;
create policy p_crm_runs_select on public.crm_automation_runs for select to authenticated using (public.is_staff());

-- notificacions: cadascú les seves
drop policy if exists p_crm_notif_select on public.crm_notifications;
create policy p_crm_notif_select on public.crm_notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists p_crm_notif_update on public.crm_notifications;
create policy p_crm_notif_update on public.crm_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- objectius: cadascú els seus; Administració/Direcció els de tothom i els fixen
drop policy if exists p_crm_targets_select on public.crm_targets;
create policy p_crm_targets_select on public.crm_targets for select to authenticated using (user_id = auth.uid() or public.is_staff());
drop policy if exists p_crm_targets_write on public.crm_targets;
create policy p_crm_targets_write on public.crm_targets for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- comparatives: també visibles des de l'oportunitat vinculada
drop policy if exists p_cmp_read on public.comparisons;
create policy p_cmp_read on public.comparisons for select to authenticated using (created_by = auth.uid() or public.is_staff()
  or (contract_id is not null and public.can_see(contract_id)) or (crm_client_id is not null and public.crm_can_see_client(crm_client_id))
  or (crm_opportunity_id is not null and public.crm_can_see_opportunity(crm_opportunity_id)));

-- ============================================================ temps real (Supabase Realtime respecta la RLS)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_opportunities') then
    alter publication supabase_realtime add table public.crm_opportunities;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_notifications') then
    alter publication supabase_realtime add table public.crm_notifications;
  end if;
end $$;
