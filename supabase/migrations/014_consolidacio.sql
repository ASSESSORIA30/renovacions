-- =====================================================================================================
-- Fase 7 · Consolidació del CRM, Direcció compartida, supervisió operativa i portal de col·laboradors
-- =====================================================================================================
-- Migració additiva i idempotent (es pot tornar a executar). NO esborra cap taula ni cap dada.
--   · Permisos configurables per mòdul (lectura / edició / aprovació) per rol i per usuari: has_perm().
--     Els permisos van lligats a ROLS, mai a noms de persona. El rol intern 'admin' es mostra com a «Direcció»
--     i el poden tenir diverses persones amb exactament els mateixos drets.
--   · Dades econòmiques restringides: Cap administrativa i Administrativa ja no les veuen per defecte;
--     Direcció ho pot autoritzar persona a persona (mòdul «economia»). Ho aplica la RLS, no només la interfície.
--   · Auditoria de seguretat (sec_audit, només afegir): permisos, rols, aprovacions i esborrats.
--   · Gestor global de tasques: prioritat, estats en curs/bloquejada, vincles a incidència i liquidació,
--     àrea, sol·licituds externes visibles al col·laborador i historial (crm_task_events).
--   · Incidències: prioritat urgent, termini, escalat i historial (crm_incident_events).
--   · Preferències de panell per usuari i configuració de seguretat (MFA per rols sensibles).
--   · Noves regles d'automatització: tasques vençudes, incidències urgents i errors d'integració,
--     amb escalat a Cap administrativa i després a Direcció. Renovacions també a 120 dies.
-- Desfer: 014_consolidacio_down.sql
-- =====================================================================================================

-- ============================================================ permisos per mòdul
create table if not exists public.role_permissions (
  role text not null check (role in ('admin', 'cap_administrativa', 'administrativa', 'comercial', 'colaborador')),
  module text not null,
  can_read boolean not null default false,
  can_edit boolean not null default false,
  can_approve boolean not null default false,
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (role, module)
);

create table if not exists public.user_permissions (
  user_id uuid not null references auth.users (id) on delete cascade,
  module text not null,
  can_read boolean not null default false,
  can_edit boolean not null default false,
  can_approve boolean not null default false,
  note text,
  granted_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module)
);

-- valors per defecte (només s'insereixen si no hi són: no es trepitja cap canvi fet per Direcció)
insert into public.role_permissions (role, module, can_read, can_edit, can_approve) values
  -- Cap administrativa: supervisa l'operativa i assigna tasques; sense dades econòmiques restringides per defecte
  ('cap_administrativa', 'panell_cap', true, true, false),
  ('cap_administrativa', 'clients', true, true, false),
  ('cap_administrativa', 'comercial', true, false, false),
  ('cap_administrativa', 'contractacio', true, true, true),
  ('cap_administrativa', 'renovacions', true, true, false),
  ('cap_administrativa', 'comparatives', true, true, false),
  ('cap_administrativa', 'tasques', true, true, true),
  ('cap_administrativa', 'incidencies', true, true, true),
  ('cap_administrativa', 'comissions', false, false, false),
  ('cap_administrativa', 'economia', false, false, false),
  ('cap_administrativa', 'colaboradors', true, false, false),
  ('cap_administrativa', 'informes', true, false, false),
  ('cap_administrativa', 'productivitat', true, false, false),
  ('cap_administrativa', 'documents', true, true, false),
  ('cap_administrativa', 'configuracio', false, false, false),
  -- Administrativa: la seva jornada i la tramitació; sense dades econòmiques ni liquidacions
  ('administrativa', 'jornada_admin', true, true, false),
  ('administrativa', 'clients', true, true, false),
  ('administrativa', 'contractacio', true, true, false),
  ('administrativa', 'renovacions', true, true, false),
  ('administrativa', 'comparatives', true, true, false),
  ('administrativa', 'tasques', true, true, false),
  ('administrativa', 'incidencies', true, true, false),
  ('administrativa', 'comissions', false, false, false),
  ('administrativa', 'economia', false, false, false),
  ('administrativa', 'informes', false, false, false),
  ('administrativa', 'documents', true, true, false),
  -- Comercial: el seu panell, la seva cartera i les seves comissions (mai les d'altres ni marges globals)
  ('comercial', 'panell_comercial', true, true, false),
  ('comercial', 'clients', true, true, false),
  ('comercial', 'comercial', true, true, false),
  ('comercial', 'contractacio', true, false, false),
  ('comercial', 'renovacions', true, true, false),
  ('comercial', 'comparatives', true, true, false),
  ('comercial', 'tasques', true, true, false),
  ('comercial', 'incidencies', true, true, false),
  ('comercial', 'comissions', true, false, false),
  ('comercial', 'economia', false, false, false),
  ('comercial', 'informes', true, false, false),
  ('comercial', 'documents', true, true, false),
  -- Col·laborador: només el portal (les seves operacions)
  ('colaborador', 'portal', true, true, false),
  ('colaborador', 'tasques', true, false, false),
  ('colaborador', 'comissions', true, false, false),
  ('colaborador', 'informes', true, false, false),
  ('colaborador', 'economia', false, false, false)
on conflict (role, module) do nothing;

/** Permís efectiu de l'usuari actual. Direcció (rol intern 'admin') té sempre tots els permisos (evita bloquejos). */
create or replace function public.has_perm(p_module text, p_action text default 'read') returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when public.my_role() = 'admin' then true
    else coalesce(
      (select case p_action when 'read' then up.can_read or up.can_edit or up.can_approve when 'edit' then up.can_edit when 'approve' then up.can_approve else false end
         from user_permissions up where up.user_id = auth.uid() and up.module = p_module),
      (select case p_action when 'read' then rp.can_read or rp.can_edit or rp.can_approve when 'edit' then rp.can_edit when 'approve' then rp.can_approve else false end
         from role_permissions rp where rp.role = public.my_role() and rp.module = p_module),
      false)
  end;
$$;

/** Tots els permisos efectius de l'usuari actual (per al menú i el servidor). */
create or replace function public.my_permissions() returns table (module text, can_read boolean, can_edit boolean, can_approve boolean)
language sql stable security definer set search_path = public as $$
  with mods as (
    select module from role_permissions where role = public.my_role()
    union select module from user_permissions where user_id = auth.uid()
  )
  select m.module, public.has_perm(m.module, 'read'), public.has_perm(m.module, 'edit'), public.has_perm(m.module, 'approve') from mods m;
$$;

/** Dades econòmiques restringides (marges, comissions globals, liquidacions de tercers, conciliació). */
create or replace function public.fin_staff(p_action text default 'read') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false) or (coalesce(public.is_staff(), false) and public.has_perm('economia', p_action));
$$;

-- regles de comissió: Direcció, o qui tingui permís explícit d'edició de comissions
create or replace function public.fin_can_manage_rules() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false) or (coalesce(public.is_staff(), false) and public.has_perm('comissions', 'edit'));
$$;

alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
drop policy if exists p_role_perm_select on public.role_permissions;
create policy p_role_perm_select on public.role_permissions for select to authenticated using (true);
drop policy if exists p_role_perm_write on public.role_permissions;
create policy p_role_perm_write on public.role_permissions for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin' and role <> 'admin');
drop policy if exists p_user_perm_select on public.user_permissions;
create policy p_user_perm_select on public.user_permissions for select to authenticated using (user_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists p_user_perm_write on public.user_permissions;
create policy p_user_perm_write on public.user_permissions for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ============================================================ restricció de dades econòmiques (RLS)
-- Es reescriuen les polítiques existents que feien servir is_staff() a les taules econòmiques:
-- lectura → fin_staff('read'); escriptura → fin_staff('edit'). Les polítiques «for all» passen a exigir
-- edició i es crea una política de lectura separada. La resta de condicions (comercial, beneficiari) es manté.
do $$
declare p record; q text; c text; act text;
begin
  for p in select tablename, policyname, cmd, qual, with_check from pg_policies
           where schemaname = 'public'
             and (tablename like 'fin\_%' or tablename in ('crm_contract_finance', 'crm_commission_records', 'ai_opportunity_economics'))
             and (coalesce(qual, '') like '%is_staff()%' or coalesce(with_check, '') like '%is_staff()%') loop
    act := case when p.cmd = 'SELECT' then 'read' else 'edit' end;
    q := replace(p.qual, 'is_staff()', format('fin_staff(%L)', act));
    c := replace(p.with_check, 'is_staff()', 'fin_staff(''edit'')');
    if q is not null and c is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', p.policyname, p.tablename, q, c);
    elsif q is not null then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, q);
    else
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, c);
    end if;
    if p.cmd = 'ALL' then
      execute format('drop policy if exists %I on public.%I', left(p.policyname, 50) || '_read', p.tablename);
      execute format('create policy %I on public.%I for select to authenticated using (%s)', left(p.policyname, 50) || '_read', p.tablename, replace(p.qual, 'is_staff()', 'fin_staff(''read'')'));
    end if;
  end loop;
end $$;

-- funcions econòmiques que comprovaven is_staff(): preparar liquidacions, registrar cobraments i veure l'economia d'un contracte
do $$
declare f record;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname in ('fin_build_settlement', 'fin_register_receipt', 'crm_can_see_contract_finance'))
             and pg_get_functiondef(p.oid) like '%is_staff()%' loop
    execute replace(pg_get_functiondef(f.oid), 'is_staff()', case when f.proname like 'crm_can_see%' then 'fin_staff(''read'')' else 'fin_staff(''edit'')' end);
  end loop;
end $$;

-- ============================================================ auditoria de seguretat (només afegir)
create table if not exists public.sec_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid default auth.uid(),
  actor_name text,
  action text not null,                -- permis_rol, permis_usuari, canvi_rol, esborrat, aprovacio_liquidacio, mfa…
  entity text not null,
  entity_id text,
  detail jsonb                          -- sense dades personals: només identificadors i camps
);
create index if not exists sec_audit_at_idx on public.sec_audit (at desc);
alter table public.sec_audit enable row level security;
drop policy if exists p_sec_audit_select on public.sec_audit;
create policy p_sec_audit_select on public.sec_audit for select to authenticated using (public.my_role() = 'admin');
drop policy if exists p_sec_audit_insert on public.sec_audit;
create policy p_sec_audit_insert on public.sec_audit for insert to authenticated with check (actor_id = auth.uid());

create or replace function public.sec_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'L''auditoria de seguretat no es pot modificar ni esborrar' using errcode = '42501';
end $$;
drop trigger if exists sec_audit_ro on public.sec_audit;
create trigger sec_audit_ro before update or delete on public.sec_audit for each row execute function public.sec_audit_append_only();

create or replace function public.sec_log(p_action text, p_entity text, p_entity_id text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into sec_audit (actor_id, actor_name, action, entity, entity_id, detail)
  values (auth.uid(), (select name from profiles where id = auth.uid()), p_action, p_entity, p_entity_id, p_detail);
$$;

create or replace function public.sec_perm_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  perform public.sec_log(case when tg_table_name = 'role_permissions' then 'permis_rol' else 'permis_usuari' end, tg_table_name,
    case when tg_table_name = 'role_permissions' then (r ->> 'role') else (r ->> 'user_id') end || ':' || (r ->> 'module'),
    jsonb_build_object('op', lower(tg_op),
      'abans', case when tg_op <> 'INSERT' then jsonb_build_object('read', old.can_read, 'edit', old.can_edit, 'approve', old.can_approve) end,
      'despres', case when tg_op <> 'DELETE' then jsonb_build_object('read', new.can_read, 'edit', new.can_edit, 'approve', new.can_approve) end));
  return null;
end $$;
drop trigger if exists sec_role_perm_audit on public.role_permissions;
create trigger sec_role_perm_audit after insert or update or delete on public.role_permissions for each row execute function public.sec_perm_audit();
drop trigger if exists sec_user_perm_audit on public.user_permissions;
create trigger sec_user_perm_audit after insert or update or delete on public.user_permissions for each row execute function public.sec_perm_audit();

-- canvis de rol (també quan es fan amb la clau de servei des de /api/users: llavors el servidor registra l'autor)
create or replace function public.sec_role_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    perform public.sec_log('canvi_rol', 'profiles', new.id::text, jsonb_build_object('abans', old.role, 'despres', new.role));
  end if;
  return new;
end $$;
drop trigger if exists sec_profiles_role_audit on public.profiles;
create trigger sec_profiles_role_audit after update of role on public.profiles for each row execute function public.sec_role_audit();

-- esborrats de dades de negoci: queda constància de qui, què i quan (sense copiar dades personals)
create or replace function public.sec_delete_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sec_log('esborrat', tg_table_name, (to_jsonb(old) ->> 'id'), jsonb_build_object('client_id', to_jsonb(old) ->> 'client_id', 'status', to_jsonb(old) ->> 'status'));
  return old;
end $$;
do $$
declare t text;
begin
  foreach t in array array['crm_clients', 'crm_contracts', 'crm_documents', 'crm_leads', 'crm_opportunities', 'crm_expedients', 'crm_tasks', 'crm_incidents', 'fin_settlements', 'fin_rules', 'cap_partners', 'cap_lead_documents'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists sec_del_audit on public.%I', t);
      execute format('create trigger sec_del_audit after delete on public.%I for each row execute function public.sec_delete_audit()', t);
    end if;
  end loop;
end $$;

-- aprovacions i pagaments de liquidacions
create or replace function public.sec_settlement_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('aprovada', 'pagada', 'anullada') then
    perform public.sec_log('liquidacio_' || new.status, 'fin_settlements', new.id::text, jsonb_build_object('abans', old.status, 'despres', new.status));
  end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.fin_settlements') is not null then
    drop trigger if exists sec_settlement_audit on public.fin_settlements;
    create trigger sec_settlement_audit after update of status on public.fin_settlements for each row execute function public.sec_settlement_audit();
  end if;
end $$;

-- ============================================================ gestor global de tasques
alter table public.crm_tasks add column if not exists priority text not null default 'normal';
alter table public.crm_tasks add column if not exists area text;
alter table public.crm_tasks add column if not exists blocked_reason text;
alter table public.crm_tasks add column if not exists incident_id uuid references public.crm_incidents (id) on delete set null;
alter table public.crm_tasks add column if not exists partner_visible boolean not null default false;
alter table public.crm_tasks add column if not exists escalation_level smallint not null default 0;
alter table public.crm_tasks add column if not exists started_at timestamptz;
alter table public.crm_tasks add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if to_regclass('public.fin_settlements') is not null then
    alter table public.crm_tasks add column if not exists settlement_id uuid references public.fin_settlements (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_priority_chk') then
    alter table public.crm_tasks add constraint crm_tasks_priority_chk check (priority in ('baixa', 'normal', 'alta', 'urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_area_chk') then
    alter table public.crm_tasks add constraint crm_tasks_area_chk check (area is null or area in ('administrativa', 'comercial', 'direccio', 'externa'));
  end if;
  -- nous estats (superconjunt de l'anterior: cap fila existent queda invàlida)
  alter table public.crm_tasks drop constraint if exists crm_tasks_status_check;
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_status_chk') then
    alter table public.crm_tasks add constraint crm_tasks_status_chk check (status in ('pendent', 'en_curs', 'bloquejada', 'feta', 'cancellada'));
  end if;
  alter table public.crm_tasks drop constraint if exists crm_tasks_kind_chk;
  alter table public.crm_tasks add constraint crm_tasks_kind_chk check (kind in ('trucada', 'reunio', 'seguiment', 'tramitacio', 'renovacio', 'altres', 'documentacio', 'incidencia', 'comissio', 'sollicitud_externa'));
end $$;
create index if not exists crm_tasks_open_idx on public.crm_tasks (assigned_to, due_at) where status in ('pendent', 'en_curs', 'bloquejada');
create index if not exists crm_tasks_incident_idx on public.crm_tasks (incident_id);

create table if not exists public.crm_task_events (
  id bigserial primary key,
  task_id uuid not null references public.crm_tasks (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_name text,
  type text not null check (type in ('creada', 'estat', 'assignacio', 'prioritat', 'venciment', 'comentari', 'escalada', 'bloqueig')),
  from_value text,
  to_value text,
  note text check (note is null or length(note) <= 2000)
);
create index if not exists crm_task_events_task_idx on public.crm_task_events (task_id, at);

create or replace function public.crm_task_history() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := (select name from profiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into crm_task_events (task_id, user_id, user_name, type, to_value) values (new.id, auth.uid(), coalesce(who, 'Automatització'), 'creada', new.assigned_name);
    return new;
  end if;
  new.updated_at := now();
  if new.status is distinct from old.status then
    insert into crm_task_events (task_id, user_id, user_name, type, from_value, to_value, note) values (new.id, auth.uid(), coalesce(who, 'Automatització'), case when new.status = 'bloquejada' then 'bloqueig' else 'estat' end, old.status, new.status, case when new.status = 'bloquejada' then new.blocked_reason end);
    if new.status = 'en_curs' and new.started_at is null then new.started_at := now(); end if;
    if new.status = 'feta' and new.completed_at is null then new.completed_at := now(); end if;
    if new.status <> 'bloquejada' then new.blocked_reason := null; end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into crm_task_events (task_id, user_id, user_name, type, from_value, to_value) values (new.id, auth.uid(), coalesce(who, 'Automatització'), 'assignacio', old.assigned_name, new.assigned_name);
  end if;
  if new.priority is distinct from old.priority then
    insert into crm_task_events (task_id, user_id, user_name, type, from_value, to_value) values (new.id, auth.uid(), coalesce(who, 'Automatització'), 'prioritat', old.priority, new.priority);
  end if;
  if new.due_at is distinct from old.due_at then
    insert into crm_task_events (task_id, user_id, user_name, type, from_value, to_value) values (new.id, auth.uid(), coalesce(who, 'Automatització'), 'venciment', old.due_at::text, new.due_at::text);
  end if;
  if new.escalation_level > old.escalation_level then
    insert into crm_task_events (task_id, user_id, user_name, type, from_value, to_value) values (new.id, auth.uid(), coalesce(who, 'Automatització'), 'escalada', old.escalation_level::text, new.escalation_level::text);
  end if;
  return new;
end $$;
drop trigger if exists crm_task_history_ins on public.crm_tasks;
create trigger crm_task_history_ins after insert on public.crm_tasks for each row execute function public.crm_task_history();
drop trigger if exists crm_task_history_upd on public.crm_tasks;
create trigger crm_task_history_upd before update on public.crm_tasks for each row execute function public.crm_task_history();

-- només Direcció i qui pot assignar (Cap administrativa) reassignen tasques d'altres persones
create or replace function public.crm_task_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- processos del servidor
  if new.assigned_to is distinct from old.assigned_to and not public.can_assign()
     and old.assigned_to is distinct from auth.uid() and old.created_by is distinct from auth.uid() then
    raise exception 'Només Direcció o la Cap administrativa poden reassignar tasques d''altres persones' using errcode = '42501';
  end if;
  if new.escalation_level < old.escalation_level and not public.can_assign() then
    raise exception 'No pots desfer un escalat' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists crm_task_guard on public.crm_tasks;
create trigger crm_task_guard before update on public.crm_tasks for each row execute function public.crm_task_guard();

alter table public.crm_task_events enable row level security;
drop policy if exists p_task_events_select on public.crm_task_events;
-- (la subconsulta passa per la RLS de crm_tasks: només es veu l'historial de les tasques visibles)
create policy p_task_events_select on public.crm_task_events for select to authenticated using (exists (select 1 from crm_tasks t where t.id = task_id));
drop policy if exists p_task_events_insert on public.crm_task_events;
create policy p_task_events_insert on public.crm_task_events for insert to authenticated
  with check (type = 'comentari' and user_id = auth.uid() and exists (select 1 from crm_tasks t where t.id = task_id));

-- col·laboradors: només les seves sol·licituds externes (no les tasques internes dels seus clients)
do $$
declare p record;
begin
  for p in select policyname, qual from pg_policies where schemaname = 'public' and tablename = 'crm_tasks' and policyname = 'p_crm_tasks_select' loop
    if p.qual not like '%colaborador%' then
      execute format('alter policy p_crm_tasks_select on public.crm_tasks using ((coalesce(public.my_role(), '''') <> ''colaborador'' and (%s)) or (public.my_role() = ''colaborador'' and (assigned_to = auth.uid() or created_by = auth.uid() or (partner_visible and ((client_id is not null and public.crm_can_see_client(client_id)) or (lead_id is not null and public.crm_can_see_lead(lead_id)))))))', p.qual);
    end if;
  end loop;
end $$;

-- ============================================================ incidències: gestor complet
alter table public.crm_incidents add column if not exists due_at timestamptz;
alter table public.crm_incidents add column if not exists escalation_level smallint not null default 0;
alter table public.crm_incidents add column if not exists escalated_at timestamptz;
alter table public.crm_incidents add column if not exists resolution text;
alter table public.crm_incidents add column if not exists assigned_name text;
do $$ begin
  alter table public.crm_incidents drop constraint if exists crm_incidents_priority_check;
  if not exists (select 1 from pg_constraint where conname = 'crm_incidents_priority_chk') then
    alter table public.crm_incidents add constraint crm_incidents_priority_chk check (priority in ('baixa', 'mitjana', 'alta', 'urgent'));
  end if;
end $$;
create index if not exists crm_incidents_open_idx on public.crm_incidents (status, priority, opened_at) where status not in ('resolta', 'tancada');

create table if not exists public.crm_incident_events (
  id bigserial primary key,
  incident_id uuid not null references public.crm_incidents (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_name text,
  type text not null check (type in ('creada', 'estat', 'assignacio', 'prioritat', 'comentari', 'escalada')),
  from_value text,
  to_value text,
  note text check (note is null or length(note) <= 2000)
);
create index if not exists crm_incident_events_idx on public.crm_incident_events (incident_id, at);

create or replace function public.crm_incident_history() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := coalesce((select name from profiles where id = auth.uid()), 'Automatització');
begin
  if tg_op = 'INSERT' then
    insert into crm_incident_events (incident_id, user_id, user_name, type, to_value) values (new.id, auth.uid(), who, 'creada', new.status);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into crm_incident_events (incident_id, user_id, user_name, type, from_value, to_value, note) values (new.id, auth.uid(), who, 'estat', old.status, new.status, case when new.status in ('resolta', 'tancada') then new.resolution end);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into crm_incident_events (incident_id, user_id, user_name, type, from_value, to_value) values (new.id, auth.uid(), who, 'assignacio', old.assigned_name, new.assigned_name);
  end if;
  if new.priority is distinct from old.priority then
    insert into crm_incident_events (incident_id, user_id, user_name, type, from_value, to_value) values (new.id, auth.uid(), who, 'prioritat', old.priority, new.priority);
  end if;
  if new.escalation_level > old.escalation_level then
    insert into crm_incident_events (incident_id, user_id, user_name, type, from_value, to_value) values (new.id, auth.uid(), who, 'escalada', old.escalation_level::text, new.escalation_level::text);
  end if;
  return new;
end $$;
drop trigger if exists crm_incident_history_ins on public.crm_incidents;
create trigger crm_incident_history_ins after insert on public.crm_incidents for each row execute function public.crm_incident_history();
drop trigger if exists crm_incident_history_upd on public.crm_incidents;
create trigger crm_incident_history_upd after update on public.crm_incidents for each row execute function public.crm_incident_history();

alter table public.crm_incident_events enable row level security;
drop policy if exists p_inc_events_select on public.crm_incident_events;
create policy p_inc_events_select on public.crm_incident_events for select to authenticated using (exists (select 1 from crm_incidents i where i.id = incident_id));
drop policy if exists p_inc_events_insert on public.crm_incident_events;
create policy p_inc_events_insert on public.crm_incident_events for insert to authenticated
  with check (type = 'comentari' and user_id = auth.uid() and exists (select 1 from crm_incidents i where i.id = incident_id));

-- col·laboradors: només les incidències que han obert ells
do $$
declare p record;
begin
  for p in select policyname, qual from pg_policies where schemaname = 'public' and tablename = 'crm_incidents' and policyname = 'p_crm_inc_select' loop
    if p.qual not like '%colaborador%' then
      execute format('alter policy p_crm_inc_select on public.crm_incidents using ((coalesce(public.my_role(), '''') <> ''colaborador'' and (%s)) or (public.my_role() = ''colaborador'' and created_by = auth.uid()))', p.qual);
    end if;
  end loop;
end $$;

-- ============================================================ preferències del panell i seguretat
create table if not exists public.user_dashboard_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  layout jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.user_dashboard_prefs enable row level security;
drop policy if exists p_dash_prefs_own on public.user_dashboard_prefs;
create policy p_dash_prefs_own on public.user_dashboard_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.sec_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
-- MFA: preparat però NO obligatori fins que Direcció l'activi (després d'haver registrat el seu propi factor)
insert into public.sec_settings (key, value) values
  ('mfa', '{"enforced": false, "roles": ["admin", "cap_administrativa"]}'),
  ('retention', '{"audit_years": 6, "lead_days_without_contract": 730, "ai_days": 365}')
on conflict (key) do nothing;
alter table public.sec_settings enable row level security;
drop policy if exists p_sec_settings_select on public.sec_settings;
create policy p_sec_settings_select on public.sec_settings for select to authenticated using (true);
drop policy if exists p_sec_settings_write on public.sec_settings;
create policy p_sec_settings_write on public.sec_settings for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ============================================================ automatitzacions i alertes
insert into public.crm_automation_rules (key, name, description, params) values
  ('tasca_vencuda', 'Tasques vençudes', 'Avisa el responsable quan una tasca passa del termini. Si continua oberta, s''escala a la Cap administrativa i després a Direcció (un sol avís per nivell).', '{"escalate_days": [2, 5]}'),
  ('incidencia_urgent', 'Incidències urgents', 'Avisa el responsable i la Cap administrativa d''una incidència urgent o d''alta prioritat sense resoldre; si passa el termini, s''escala a Direcció.', '{"hours": [4, 24]}'),
  ('error_integracio', 'Errors d''integració', 'Avisa Direcció quan falla una sincronització, una automatització o un webhook (un avís per dia i origen).', '{"hours": 24}')
on conflict (key) do nothing;

-- renovacions també a 120 dies (només si la regla encara té els valors de fàbrica)
update public.crm_automation_rules set params = '{"days": [120, 90, 60, 30]}'
 where key = 'venciment_contracte' and params = '{"days": [90, 60, 30]}'::jsonb;

-- ============================================================ portal: altres serveis d'interès (fibra, assegurances, alarmes)
do $$ begin
  if to_regclass('public.cap_submissions') is not null then
    alter table public.cap_submissions add column if not exists extra_services text[] not null default '{}';
    if not exists (select 1 from pg_constraint where conname = 'cap_submissions_extra_services_chk') then
      alter table public.cap_submissions add constraint cap_submissions_extra_services_chk check (extra_services <@ array['fibra_telefonia', 'assegurances', 'alarmes']::text[]);
    end if;
  end if;
end $$;

-- ============================================================ qualitat de dades: revisió humana (mai fusió ni esborrat automàtic)
create table if not exists public.dq_reviews (
  signature text primary key,                  -- tipus + identificadors afectats (ordenats)
  kind text not null,
  status text not null check (status in ('revisat', 'ignorat', 'corregit')),
  note text check (note is null or length(note) <= 1000),
  reviewed_by uuid references auth.users (id) default auth.uid(),
  reviewed_at timestamptz not null default now()
);
alter table public.dq_reviews enable row level security;
drop policy if exists p_dq_reviews_select on public.dq_reviews;
create policy p_dq_reviews_select on public.dq_reviews for select to authenticated using (public.has_perm('configuracio', 'read') or public.has_perm('panell_cap', 'read'));
drop policy if exists p_dq_reviews_write on public.dq_reviews;
create policy p_dq_reviews_write on public.dq_reviews for all to authenticated
  using (public.has_perm('configuracio', 'edit') or public.has_perm('panell_cap', 'edit'))
  with check ((public.has_perm('configuracio', 'edit') or public.has_perm('panell_cap', 'edit')) and reviewed_by = auth.uid());

-- ============================================================ informes automàtics: destinataris interns i registre d'enviaments
insert into public.sec_settings (key, value) values ('reports', '{"diari": [], "setmanal": [], "mensual": []}') on conflict (key) do nothing;
create table if not exists public.report_runs (
  id bigserial primary key,
  kind text not null check (kind in ('diari', 'setmanal', 'mensual')),
  period_key text not null,                    -- 2026-11-01 · 2026-W44 · 2026-10
  recipient_id uuid references auth.users (id) on delete set null,
  status text not null check (status in ('enviat', 'pendent_smtp', 'error')),
  error text,
  at timestamptz not null default now(),
  unique (kind, period_key, recipient_id)       -- idempotència: un informe per destinatari i període
);
alter table public.report_runs enable row level security;
drop policy if exists p_report_runs_select on public.report_runs;
create policy p_report_runs_select on public.report_runs for select to authenticated using (public.my_role() = 'admin');

-- ============================================================ rendiment: índexs per a la cerca global i els panells
do $$ begin
  begin
    create extension if not exists pg_trgm;
  exception when others then
    raise notice 'pg_trgm no disponible: la cerca funciona igual, però sense índexs trigram';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create index if not exists crm_clients_search_trgm on public.crm_clients using gin (search gin_trgm_ops);
    create index if not exists crm_clients_address_trgm on public.crm_clients using gin (address gin_trgm_ops);
    create index if not exists crm_supplies_cups_trgm on public.crm_supplies using gin (cups gin_trgm_ops);
    create index if not exists crm_supplies_address_trgm on public.crm_supplies using gin (address gin_trgm_ops);
    create index if not exists crm_leads_search_trgm on public.crm_leads using gin (search gin_trgm_ops);
    create index if not exists crm_opps_title_trgm on public.crm_opportunities using gin (title gin_trgm_ops);
  end if;
end $$;
create index if not exists crm_contracts_signed_idx on public.crm_contracts (coalesce(signed_at, (created_at at time zone 'UTC')::date));
create index if not exists crm_contracts_created_idx on public.crm_contracts (created_at desc);
create index if not exists crm_expedients_status_idx on public.crm_expedients (status, status_changed_at);
create index if not exists crm_opps_stage_idx on public.crm_opportunities (stage, owner_id);
create index if not exists crm_leads_created_idx on public.crm_leads (created_at desc);
create index if not exists crm_incidents_assignee_idx on public.crm_incidents (assigned_to, status);
