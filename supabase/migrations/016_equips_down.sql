-- =====================================================================================================
-- Desfà 016_equips.sql. Restaura les funcions originals (008/009/014) i elimina les polítiques del Cap d'equip.
-- CONSERVA les dades d'equips (crm_teams, crm_team_members, crm_team_clients): les taules es queden, sense accés
-- per a ningú excepte Direcció, per si cal tornar a aplicar la 016. Per esborrar-les del tot, vegeu el final.
-- ABANS d'executar-la: canvia el rol dels usuaris 'cap_equip' (p. ex. a 'comercial'); si no, la restricció de rols falla.
-- =====================================================================================================

-- polítiques addicionals
drop policy if exists p_team_clients_select on public.crm_clients;
drop policy if exists p_team_leads_select on public.crm_leads;
drop policy if exists p_team_leads_insert on public.crm_leads;
drop policy if exists p_team_leads_update on public.crm_leads;
drop policy if exists p_team_opps_select on public.crm_opportunities;
drop policy if exists p_team_exp_select on public.crm_expedients;
drop policy if exists p_team_tasks_select on public.crm_tasks;
drop policy if exists p_team_tasks_insert on public.crm_tasks;
drop policy if exists p_team_tasks_update on public.crm_tasks;
drop policy if exists p_team_inc_update on public.crm_incidents;
drop policy if exists p_team_targets_select on public.crm_targets;
drop policy if exists p_team_targets_write on public.crm_targets;
drop policy if exists p_team_fin_calc_select on public.fin_calculations;
drop policy if exists p_team_fin_ledger_select on public.fin_ledger;
drop policy if exists p_team_fin_set_select on public.fin_settlements;

-- funcions originals
create or replace function public.crm_can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff()
    or exists (select 1 from crm_clients c where c.id = p_client and (c.owner_id = auth.uid() or c.collaborator_id = auth.uid()))
    or exists (select 1 from crm_client_assignments a where a.client_id = p_client and a.user_id = auth.uid());
$$;
create or replace function public.crm_can_see_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from crm_leads l where l.id = p_lead and (l.owner_id = auth.uid() or l.collaborator_id = auth.uid() or l.created_by = auth.uid()));
$$;
create or replace function public.crm_can_see_opportunity(p_opp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_opportunities o where o.id = p_opp and (
    public.is_staff() or o.owner_id = auth.uid() or o.collaborator_id = auth.uid()
    or (o.client_id is not null and public.crm_can_see_client(o.client_id))
    or (o.lead_id is not null and public.crm_can_see_lead(o.lead_id))));
$$;
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

-- funcions noves
drop function if exists public.crm_team_move(uuid, uuid, text);
drop function if exists public.crm_team_commissions(uuid);
drop function if exists public.crm_team_sees_client(uuid);
drop function if exists public.crm_team_sees_user(uuid);
drop function if exists public.crm_team_member_ids(uuid);

-- taules d'equips: només Direcció (es conserven les dades)
drop policy if exists p_teams_select on public.crm_teams;
drop policy if exists p_team_members_select on public.crm_team_members;
drop policy if exists p_team_clients_rel_select on public.crm_team_clients;
drop function if exists public.crm_team_is_lead(uuid);
drop function if exists public.crm_team_is_member(uuid);

delete from public.crm_automation_rules where key in ('equip_sense_activitat', 'equip_tasques_vencudes');
delete from public.role_permissions where role = 'cap_equip';

alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role in ('admin', 'cap_administrativa', 'administrativa', 'comercial', 'colaborador'));
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'cap_administrativa', 'administrativa', 'comercial', 'colaborador'));

-- Per esborrar també les dades d'equips (IRREVERSIBLE), descomenta:
-- drop table if exists public.crm_team_clients; drop table if exists public.crm_team_members; drop table if exists public.crm_teams;
-- drop function if exists public.crm_team_before(); drop function if exists public.crm_team_audit(); drop function if exists public.crm_team_members_nodelete();
