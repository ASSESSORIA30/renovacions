-- =====================================================================================================
-- Desfer la migració 014 (Fase 7). Torna a la seguretat de la Fase 6:
--   · les polítiques econòmiques tornen a is_staff() (Administració ho torna a veure tot);
--   · es treuen permisos per mòdul, historials, preferències, revisions de qualitat i registre d'informes.
-- ES CONSERVEN (per no perdre dades): sec_audit (auditoria) i les columnes noves de crm_tasks, crm_incidents i
-- cap_submissions. Els estats nous de tasques («en curs», «bloquejada») queden permesos perquè cap fila
-- existent sigui invàlida. Les línies comentades permeten esborrar-ho tot si realment cal.
-- =====================================================================================================

-- polítiques econòmiques: fin_staff(...) → is_staff()
do $$
declare p record;
begin
  for p in select tablename, policyname, cmd, qual, with_check from pg_policies
           where schemaname = 'public' and (coalesce(qual, '') like '%fin_staff(%' or coalesce(with_check, '') like '%fin_staff(%') loop
    if p.policyname like '%\_read' and p.cmd = 'SELECT' and p.tablename in (select tablename from pg_policies x where x.policyname = left(p.policyname, length(p.policyname) - 5)) then
      execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
    elsif p.qual is not null and p.with_check is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', p.policyname, p.tablename,
        regexp_replace(p.qual, 'fin_staff\(''(read|edit)''::text\)', 'is_staff()', 'g'), regexp_replace(p.with_check, 'fin_staff\(''(read|edit)''::text\)', 'is_staff()', 'g'));
    elsif p.qual is not null then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, regexp_replace(p.qual, 'fin_staff\(''(read|edit)''::text\)', 'is_staff()', 'g'));
    else
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, regexp_replace(p.with_check, 'fin_staff\(''(read|edit)''::text\)', 'is_staff()', 'g'));
    end if;
  end loop;
end $$;
do $$
declare f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('fin_build_settlement', 'fin_register_receipt', 'crm_can_see_contract_finance') and pg_get_functiondef(p.oid) like '%fin_staff(%' loop
    execute regexp_replace(pg_get_functiondef(f.oid), 'fin_staff\(''(read|edit)''(::text)?\)', 'is_staff()', 'g');
  end loop;
end $$;
create or replace function public.fin_can_manage_rules() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'cap_administrativa'), false);
$$;

-- tasques i incidències: polítiques de lectura de la Fase 2 / Fase 1
drop policy if exists p_crm_tasks_select on public.crm_tasks;
create policy p_crm_tasks_select on public.crm_tasks for select to authenticated using (
  assigned_to = auth.uid() or created_by = auth.uid() or public.is_staff()
  or (client_id is not null and public.crm_can_see_client(client_id))
  or (lead_id is not null and public.crm_can_see_lead(lead_id))
  or (opportunity_id is not null and public.crm_can_see_opportunity(opportunity_id)));
drop policy if exists p_crm_inc_select on public.crm_incidents;
create policy p_crm_inc_select on public.crm_incidents for select to authenticated using (public.crm_can_see_client(client_id));

drop trigger if exists crm_task_guard on public.crm_tasks;
drop trigger if exists crm_task_history_ins on public.crm_tasks;
drop trigger if exists crm_task_history_upd on public.crm_tasks;
drop trigger if exists crm_incident_history_ins on public.crm_incidents;
drop trigger if exists crm_incident_history_upd on public.crm_incidents;
drop trigger if exists sec_role_perm_audit on public.role_permissions;
drop trigger if exists sec_user_perm_audit on public.user_permissions;
drop trigger if exists sec_profiles_role_audit on public.profiles;
do $$
declare t text;
begin
  foreach t in array array['crm_clients', 'crm_contracts', 'crm_documents', 'crm_leads', 'crm_opportunities', 'crm_expedients', 'crm_tasks', 'crm_incidents', 'fin_settlements', 'fin_rules', 'cap_partners', 'cap_lead_documents'] loop
    if to_regclass('public.' || t) is not null then execute format('drop trigger if exists sec_del_audit on public.%I', t); end if;
  end loop;
  if to_regclass('public.fin_settlements') is not null then drop trigger if exists sec_settlement_audit on public.fin_settlements; end if;
end $$;
drop function if exists public.crm_task_guard();
drop function if exists public.crm_task_history();
drop function if exists public.crm_incident_history();
drop function if exists public.sec_perm_audit();
drop function if exists public.sec_role_audit();
drop function if exists public.sec_delete_audit();
drop function if exists public.sec_settlement_audit();

delete from public.crm_automation_rules where key in ('tasca_vencuda', 'incidencia_urgent', 'error_integracio');
update public.crm_automation_rules set params = '{"days": [90, 60, 30]}' where key = 'venciment_contracte' and params = '{"days": [120, 90, 60, 30]}'::jsonb;

drop table if exists public.crm_task_events;
drop table if exists public.crm_incident_events;
drop table if exists public.user_dashboard_prefs;
drop table if exists public.dq_reviews;
drop table if exists public.report_runs;
drop table if exists public.sec_settings;
drop function if exists public.my_permissions();
drop table if exists public.user_permissions;
drop table if exists public.role_permissions;
-- fin_staff i has_perm es mantenen definides fins que cap política les fa servir; ara ja es poden treure
drop function if exists public.fin_staff(text);
drop function if exists public.has_perm(text, text);

-- conservats a propòsit (descomenta-ho només si n'estàs segur):
-- drop table if exists public.sec_audit;
-- drop function if exists public.sec_log(text, text, text, jsonb);
-- alter table public.crm_tasks drop column if exists priority, drop column if exists area, drop column if exists blocked_reason, drop column if exists incident_id, drop column if exists settlement_id, drop column if exists partner_visible, drop column if exists escalation_level, drop column if exists started_at, drop column if exists updated_at;
-- alter table public.crm_incidents drop column if exists due_at, drop column if exists escalation_level, drop column if exists escalated_at, drop column if exists resolution, drop column if exists assigned_name;
-- alter table public.cap_submissions drop column if exists extra_services;
