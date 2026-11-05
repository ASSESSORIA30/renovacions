-- =====================================================================================================
-- Fase 8.1 · 016 · ROL «CAP D'EQUIP» I EQUIPS COMERCIALS
-- =====================================================================================================
-- Migració ADDITIVA i idempotent (es pot tornar a executar). No esborra cap taula, cap dada ni cap relació.
-- Desfer: 016_equips_down.sql (restaura exactament les funcions que aquí s'amplien).
--
-- Model:
--   · Nou rol intern 'cap_equip' (es mostra com «Cap d'equip»), entre Direcció i Comercial.
--   · crm_teams: equips comercials; cada equip té un Cap d'equip (lead_id).
--   · crm_team_members: pertinença AMB HISTORIAL (joined_at / left_at). Un comercial només és a un equip actiu;
--     canviar d'equip tanca la fila i n'obre una de nova: el seu historial (clients, contractes, vendes) no es mou.
--   · crm_team_clients: cartera de clients assignada per Direcció a un equip (a més de la cartera dels comercials).
--   · Visibilitat del Cap d'equip (RLS, no només interfície): clients, contractes, subministraments, leads,
--     oportunitats, expedients, tasques, incidències i objectius dels comercials del SEU equip. Mai d'altres equips.
--   · El Cap d'equip NO és «staff»: is_staff() i fin_staff() continuen retornant fals. Per tant, sense autorització
--     expressa no veu beneficis globals, marges, comissions de les comercialitzadores ni liquidacions de tercers,
--     no pot aprovar liquidacions ni regles econòmiques, ni crear administradors ni tocar permisos.
--   · Comissions dels comercials del seu equip: només si Direcció li concedeix el mòdul «comissions_equip»
--     (user_permissions o role_permissions). Mai la capa «proveidor».
--   · Tots els canvis d'equip queden a l'auditoria de seguretat (sec_audit).
-- Requereix: 003, 008, 009, 010, 011 i 014.
-- =====================================================================================================

-- ============================================================ 1. rol nou
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'cap_administrativa', 'cap_equip', 'administrativa', 'comercial', 'colaborador'));

alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role in ('admin', 'cap_administrativa', 'cap_equip', 'administrativa', 'comercial', 'colaborador'));

-- permisos per defecte del Cap d'equip (no es trepitja cap canvi fet per Direcció)
insert into public.role_permissions (role, module, can_read, can_edit, can_approve) values
  ('cap_equip', 'panell_equip', true, true, false),
  ('cap_equip', 'clients', true, false, false),
  ('cap_equip', 'comercial', true, true, false),
  ('cap_equip', 'contractacio', true, false, false),
  ('cap_equip', 'renovacions', true, false, false),
  ('cap_equip', 'comparatives', true, true, false),
  ('cap_equip', 'tasques', true, true, true),
  ('cap_equip', 'incidencies', true, true, false),
  ('cap_equip', 'informes', true, false, false),
  ('cap_equip', 'documents', true, false, false),
  ('cap_equip', 'comissions', false, false, false),
  ('cap_equip', 'comissions_equip', false, false, false),   -- Direcció ho autoritza persona a persona
  ('cap_equip', 'economia', false, false, false),
  ('cap_equip', 'configuracio', false, false, false)
on conflict (role, module) do nothing;

-- ============================================================ 2. equips
create table if not exists public.crm_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  lead_id uuid references auth.users (id) on delete set null,
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_teams_name_uq on public.crm_teams (lower(name)) where active;
create index if not exists crm_teams_lead_idx on public.crm_teams (lead_id) where active;

create table if not exists public.crm_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.crm_teams (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  added_by uuid references auth.users (id) default auth.uid(),
  removed_by uuid references auth.users (id),
  note text,
  check (left_at is null or left_at >= joined_at)
);
-- un comercial només pot ser a un equip actiu alhora
create unique index if not exists crm_team_members_active_uq on public.crm_team_members (user_id) where left_at is null;
create index if not exists crm_team_members_team_idx on public.crm_team_members (team_id) where left_at is null;

create table if not exists public.crm_team_clients (
  team_id uuid not null references public.crm_teams (id) on delete cascade,
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  assigned_by uuid references auth.users (id) default auth.uid(),
  assigned_at timestamptz not null default now(),
  primary key (team_id, client_id)
);
create index if not exists crm_team_clients_client_idx on public.crm_team_clients (client_id);

-- ============================================================ 3. funcions de visibilitat
/** Comercials ACTIUS dels equips actius que lidera p_lead. */
create or replace function public.crm_team_member_ids(p_lead uuid default auth.uid()) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.user_id from crm_team_members m join crm_teams t on t.id = m.team_id
  where t.lead_id = p_lead and t.active and m.left_at is null;
$$;

/** El Cap d'equip actual pot veure la feina de p_user (un comercial del seu equip, o ell mateix). */
create or replace function public.crm_team_sees_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and coalesce(public.my_role() = 'cap_equip', false)
     and (p_user = auth.uid() or p_user in (select public.crm_team_member_ids(auth.uid())));
$$;

/** El Cap d'equip actual pot veure el client: és d'un comercial del seu equip o és a la cartera de l'equip. */
create or replace function public.crm_team_sees_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'cap_equip', false) and (
    exists (select 1 from crm_clients c where c.id = p_client and public.crm_team_sees_user(c.owner_id))
    or exists (select 1 from crm_team_clients tc join crm_teams t on t.id = tc.team_id where tc.client_id = p_client and t.lead_id = auth.uid() and t.active));
$$;

-- Ampliació de les funcions existents (mateix cos + la clàusula del Cap d'equip). El 016_down les restaura.
create or replace function public.crm_can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff()
    or exists (select 1 from crm_clients c where c.id = p_client and (c.owner_id = auth.uid() or c.collaborator_id = auth.uid()))
    or exists (select 1 from crm_client_assignments a where a.client_id = p_client and a.user_id = auth.uid())
    or public.crm_team_sees_client(p_client);
$$;

create or replace function public.crm_can_see_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from crm_leads l where l.id = p_lead and (l.owner_id = auth.uid() or l.collaborator_id = auth.uid() or l.created_by = auth.uid() or public.crm_team_sees_user(l.owner_id)));
$$;

create or replace function public.crm_can_see_opportunity(p_opp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_opportunities o where o.id = p_opp and (
    public.is_staff() or o.owner_id = auth.uid() or o.collaborator_id = auth.uid()
    or public.crm_team_sees_user(o.owner_id)
    or (o.client_id is not null and public.crm_can_see_client(o.client_id))
    or (o.lead_id is not null and public.crm_can_see_lead(o.lead_id))));
$$;

-- reassignació de tasques: el Cap d'equip pot reassignar entre ell mateix i els comercials del seu equip
create or replace function public.crm_task_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- processos del servidor
  if new.assigned_to is distinct from old.assigned_to and not public.can_assign()
     and old.assigned_to is distinct from auth.uid() and old.created_by is distinct from auth.uid()
     and not (public.crm_team_sees_user(old.assigned_to) and public.crm_team_sees_user(new.assigned_to)) then
    raise exception 'Només Direcció o la Cap administrativa poden reassignar tasques d''altres persones' using errcode = '42501';
  end if;
  if new.assigned_to is distinct from old.assigned_to and coalesce(public.my_role() = 'cap_equip', false)
     and new.assigned_to is not null and not public.crm_team_sees_user(new.assigned_to) then
    raise exception 'Només pots assignar tasques als comercials del teu equip' using errcode = '42501';
  end if;
  if new.escalation_level < old.escalation_level and not public.can_assign() then
    raise exception 'No pots desfer un escalat' using errcode = '42501';
  end if;
  return new;
end $$;

-- reassignació de leads: el Cap d'equip pot moure leads entre els comercials del seu equip (i ell mateix)
create or replace function public.crm_lead_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.search := public.crm_norm(concat_ws(' ', new.name, new.company, new.contact_name, new.tax_id, new.email, regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), new.city));
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_staff()
     and (new.owner_id is distinct from old.owner_id or new.collaborator_id is distinct from old.collaborator_id)
     and not (new.collaborator_id is not distinct from old.collaborator_id
              and public.crm_team_sees_user(old.owner_id) and public.crm_team_sees_user(new.owner_id)) then
    raise exception 'Només Administració o Direcció poden reassignar leads' using errcode = '42501';
  end if;
  return new;
end $$;

-- ============================================================ 4. polítiques ADDICIONALS (permissives) per al Cap d'equip
-- Són polítiques noves que s'afegeixen (OR) a les existents; no se'n modifica ni s'elimina cap.

-- clients (la política original no fa servir crm_can_see_client)
drop policy if exists p_team_clients_select on public.crm_clients;
create policy p_team_clients_select on public.crm_clients for select to authenticated using (public.crm_team_sees_client(id));

-- leads: veure, crear i ASSIGNAR només dins de l'equip
drop policy if exists p_team_leads_select on public.crm_leads;
create policy p_team_leads_select on public.crm_leads for select to authenticated using (public.crm_team_sees_user(owner_id));
drop policy if exists p_team_leads_insert on public.crm_leads;
create policy p_team_leads_insert on public.crm_leads for insert to authenticated with check (
  created_by = auth.uid() and coalesce(public.my_role() = 'cap_equip', false) and public.crm_team_sees_user(owner_id));
drop policy if exists p_team_leads_update on public.crm_leads;
create policy p_team_leads_update on public.crm_leads for update to authenticated
  using (public.crm_team_sees_user(owner_id)) with check (public.crm_team_sees_user(owner_id));

-- oportunitats
drop policy if exists p_team_opps_select on public.crm_opportunities;
create policy p_team_opps_select on public.crm_opportunities for select to authenticated using (public.crm_team_sees_user(owner_id));

-- expedients (contractes pendents de tramitació)
drop policy if exists p_team_exp_select on public.crm_expedients;
create policy p_team_exp_select on public.crm_expedients for select to authenticated using (public.crm_team_sees_user(owner_id) or public.crm_team_sees_client(client_id));

-- tasques: veure, crear i assignar als comercials de l'equip
drop policy if exists p_team_tasks_select on public.crm_tasks;
create policy p_team_tasks_select on public.crm_tasks for select to authenticated using (public.crm_team_sees_user(assigned_to));
drop policy if exists p_team_tasks_insert on public.crm_tasks;
create policy p_team_tasks_insert on public.crm_tasks for insert to authenticated with check (
  created_by = auth.uid() and coalesce(public.my_role() = 'cap_equip', false) and public.crm_team_sees_user(assigned_to)
  and (client_id is null or public.crm_can_see_client(client_id))
  and (lead_id is null or public.crm_can_see_lead(lead_id))
  and (opportunity_id is null or public.crm_can_see_opportunity(opportunity_id)));
drop policy if exists p_team_tasks_update on public.crm_tasks;
create policy p_team_tasks_update on public.crm_tasks for update to authenticated
  using (public.crm_team_sees_user(assigned_to)) with check (public.crm_team_sees_user(assigned_to));

-- incidències comercials dels clients de l'equip
drop policy if exists p_team_inc_update on public.crm_incidents;
create policy p_team_inc_update on public.crm_incidents for update to authenticated
  using (public.crm_team_sees_client(client_id)) with check (public.crm_team_sees_client(client_id));

-- objectius comercials dels membres de l'equip
drop policy if exists p_team_targets_select on public.crm_targets;
create policy p_team_targets_select on public.crm_targets for select to authenticated using (public.crm_team_sees_user(user_id));
drop policy if exists p_team_targets_write on public.crm_targets;
create policy p_team_targets_write on public.crm_targets for all to authenticated
  using (public.crm_team_sees_user(user_id) and user_id <> auth.uid()) with check (public.crm_team_sees_user(user_id) and user_id <> auth.uid());

-- comissions dels comercials de l'equip: NOMÉS capa «comercial» i NOMÉS amb autorització expressa de Direcció
create or replace function public.crm_team_commissions(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_team_sees_user(p_user) and p_user <> auth.uid() and public.has_perm('comissions_equip', 'read');
$$;
drop policy if exists p_team_fin_calc_select on public.fin_calculations;
create policy p_team_fin_calc_select on public.fin_calculations for select to authenticated using (layer = 'comercial' and public.crm_team_commissions(beneficiary_id));
drop policy if exists p_team_fin_ledger_select on public.fin_ledger;
create policy p_team_fin_ledger_select on public.fin_ledger for select to authenticated using (layer = 'comercial' and public.crm_team_commissions(beneficiary_id));
drop policy if exists p_team_fin_set_select on public.fin_settlements;
create policy p_team_fin_set_select on public.fin_settlements for select to authenticated using (kind = 'comercial' and public.crm_team_commissions(beneficiary_id));

-- ============================================================ 5. RLS de les taules d'equips
-- (funcions security definer: eviten la recursió entre les polítiques de crm_teams i crm_team_members)
create or replace function public.crm_team_is_lead(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_teams t where t.id = p_team and t.lead_id = auth.uid());
$$;
create or replace function public.crm_team_is_member(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_team_members m where m.team_id = p_team and m.user_id = auth.uid() and m.left_at is null);
$$;
alter table public.crm_teams enable row level security;
alter table public.crm_team_members enable row level security;
alter table public.crm_team_clients enable row level security;

drop policy if exists p_teams_select on public.crm_teams;
create policy p_teams_select on public.crm_teams for select to authenticated using (
  public.is_staff() or lead_id = auth.uid() or public.crm_team_is_member(id));
drop policy if exists p_teams_write on public.crm_teams;
create policy p_teams_write on public.crm_teams for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_team_members_select on public.crm_team_members;
create policy p_team_members_select on public.crm_team_members for select to authenticated using (
  public.is_staff() or user_id = auth.uid() or public.crm_team_is_lead(team_id));
drop policy if exists p_team_members_write on public.crm_team_members;
create policy p_team_members_write on public.crm_team_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_team_clients_rel_select on public.crm_team_clients;
create policy p_team_clients_rel_select on public.crm_team_clients for select to authenticated using (
  public.is_staff() or public.crm_team_is_lead(team_id));
drop policy if exists p_team_clients_rel_write on public.crm_team_clients;
create policy p_team_clients_rel_write on public.crm_team_clients for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================ 6. integritat i auditoria
create or replace function public.crm_team_before() returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if tg_table_name = 'crm_teams' then
    if new.lead_id is not null then
      select role into r from profiles where id = new.lead_id;
      if r is distinct from 'cap_equip' then raise exception 'El responsable d''un equip ha de tenir el rol Cap d''equip' using errcode = '23514'; end if;
    end if;
    new.updated_at := now();
  else
    if tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
      select role into r from profiles where id = new.user_id;
      if r is distinct from 'comercial' then raise exception 'Només els comercials poden formar part d''un equip' using errcode = '23514'; end if;
    end if;
    if tg_op = 'UPDATE' and (new.team_id is distinct from old.team_id or new.user_id is distinct from old.user_id or new.joined_at is distinct from old.joined_at) then
      raise exception 'L''historial d''equips no es modifica: tanca la pertinença i obre''n una de nova' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.left_at is not null and new.left_at is distinct from old.left_at then
      raise exception 'Una pertinença tancada no es pot reobrir' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_teams_before on public.crm_teams;
create trigger crm_teams_before before insert or update on public.crm_teams for each row execute function public.crm_team_before();
drop trigger if exists crm_team_members_before on public.crm_team_members;
create trigger crm_team_members_before before insert or update on public.crm_team_members for each row execute function public.crm_team_before();

create or replace function public.crm_team_members_nodelete() returns trigger language plpgsql as $$
begin
  raise exception 'L''historial d''equips no s''esborra: tanca la pertinença (left_at)' using errcode = '42501';
end $$;
drop trigger if exists crm_team_members_nodelete on public.crm_team_members;
create trigger crm_team_members_nodelete before delete on public.crm_team_members for each row execute function public.crm_team_members_nodelete();

create or replace function public.crm_team_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare a text; d jsonb;
begin
  if tg_table_name = 'crm_teams' then
    a := case when tg_op = 'INSERT' then 'equip_creat' when new.lead_id is distinct from old.lead_id then 'equip_cap_canviat' when new.active is distinct from old.active then 'equip_' || case when new.active then 'reactivat' else 'desactivat' end else 'equip_editat' end;
    d := jsonb_build_object('team', new.id, 'name', new.name, 'lead', new.lead_id, 'lead_anterior', case when tg_op = 'UPDATE' then old.lead_id end);
    insert into sec_audit (actor_id, actor_name, action, entity, entity_id, detail) values (auth.uid(), (select name from profiles where id = auth.uid()), a, 'crm_teams', new.id::text, d);
  elsif tg_table_name = 'crm_team_members' then
    a := case when tg_op = 'INSERT' then 'equip_alta_membre' else 'equip_baixa_membre' end;
    if tg_op = 'UPDATE' and new.left_at is not distinct from old.left_at then return new; end if;
    d := jsonb_build_object('team', new.team_id, 'user', new.user_id, 'joined_at', new.joined_at, 'left_at', new.left_at, 'note', new.note);
    insert into sec_audit (actor_id, actor_name, action, entity, entity_id, detail) values (auth.uid(), (select name from profiles where id = auth.uid()), a, 'crm_team_members', new.id::text, d);
  else
    a := case when tg_op = 'INSERT' then 'equip_cartera_afegit' else 'equip_cartera_retirat' end;
    d := jsonb_build_object('team', coalesce(new.team_id, old.team_id), 'client', coalesce(new.client_id, old.client_id));
    insert into sec_audit (actor_id, actor_name, action, entity, entity_id, detail) values (auth.uid(), (select name from profiles where id = auth.uid()), a, 'crm_team_clients', coalesce(new.team_id, old.team_id)::text, d);
    return coalesce(new, old);
  end if;
  return new;
end $$;
drop trigger if exists crm_teams_audit on public.crm_teams;
create trigger crm_teams_audit after insert or update on public.crm_teams for each row execute function public.crm_team_audit();
drop trigger if exists crm_team_members_audit on public.crm_team_members;
create trigger crm_team_members_audit after insert or update on public.crm_team_members for each row execute function public.crm_team_audit();
drop trigger if exists crm_team_clients_audit on public.crm_team_clients;
create trigger crm_team_clients_audit after insert or delete on public.crm_team_clients for each row execute function public.crm_team_audit();

/** Canvi d'equip atòmic (Direcció): tanca la pertinença actual i n'obre una de nova. p_team NULL = treure de l'equip. */
create or replace function public.crm_team_move(p_user uuid, p_team uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_admin() then raise exception 'Només Direcció gestiona els equips' using errcode = '42501'; end if;
  update crm_team_members set left_at = now(), removed_by = auth.uid(), note = coalesce(p_note, note)
   where user_id = p_user and left_at is null and (p_team is null or team_id <> p_team);
  if p_team is not null and not exists (select 1 from crm_team_members where user_id = p_user and team_id = p_team and left_at is null) then
    if not exists (select 1 from crm_teams where id = p_team and active) then raise exception 'Equip no trobat o inactiu' using errcode = '23503'; end if;
    insert into crm_team_members (team_id, user_id, note) values (p_team, p_user, p_note) returning id into new_id;
  end if;
  return new_id;
end $$;

grant execute on function public.crm_team_member_ids(uuid) to authenticated;
grant execute on function public.crm_team_sees_user(uuid) to authenticated;
grant execute on function public.crm_team_sees_client(uuid) to authenticated;
grant execute on function public.crm_team_commissions(uuid) to authenticated;
grant execute on function public.crm_team_move(uuid, uuid, text) to authenticated;

-- ============================================================ 7. alertes del Cap d'equip (mateix motor d'automatitzacions)
insert into public.crm_automation_rules (key, name, description, params) values
  ('equip_sense_activitat', 'Comercial de l''equip sense activitat', 'Avisa el Cap d''equip quan un comercial no registra activitat en X dies laborables.', '{"days": 5}'),
  ('equip_tasques_vencudes', 'Tasques vençudes de l''equip', 'Avisa el Cap d''equip de les tasques vençudes dels comercials del seu equip.', '{}')
on conflict (key) do nothing;
