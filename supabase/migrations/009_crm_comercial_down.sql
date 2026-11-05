-- Desfà la migració 009 (CRM Fase 2). ATENCIÓ: elimina leads, oportunitats, notificacions, regles i objectius.
-- Les activitats i tasques de leads (sense client) també s'eliminen. Fes una còpia abans (Database → Backups).
drop policy if exists p_cmp_read on public.comparisons;
create policy p_cmp_read on public.comparisons for select to authenticated using (created_by = auth.uid() or public.is_staff()
  or (contract_id is not null and public.can_see(contract_id)) or (crm_client_id is not null and public.crm_can_see_client(crm_client_id)));
alter table if exists public.comparisons drop column if exists crm_opportunity_id;

-- polítiques de la 008 per a activitat i tasques
drop policy if exists p_crm_act_select on public.crm_activities;
create policy p_crm_act_select on public.crm_activities for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists p_crm_act_insert on public.crm_activities;
create policy p_crm_act_insert on public.crm_activities for insert to authenticated with check (public.crm_can_see_client(client_id) and user_id = auth.uid());
drop policy if exists p_crm_act_update on public.crm_activities;
create policy p_crm_act_update on public.crm_activities for update to authenticated using (user_id = auth.uid() or public.is_staff()) with check (public.crm_can_see_client(client_id));
drop policy if exists p_crm_tasks_select on public.crm_tasks;
create policy p_crm_tasks_select on public.crm_tasks for select to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid() or public.is_staff() or (client_id is not null and public.crm_can_see_client(client_id)));
drop policy if exists p_crm_tasks_insert on public.crm_tasks;
create policy p_crm_tasks_insert on public.crm_tasks for insert to authenticated
  with check (created_by = auth.uid() and (client_id is null or public.crm_can_see_client(client_id)) and (assigned_to = auth.uid() or public.can_assign() or public.is_staff() or (client_id is not null and public.crm_can_edit_client(client_id))));


delete from public.crm_activities where client_id is null;
delete from public.crm_tasks where lead_id is not null and client_id is null;
drop trigger if exists crm_activities_touch on public.crm_activities;
drop function if exists public.crm_activity_touch();
alter table public.crm_activities drop constraint if exists crm_activities_owner_chk;
alter table public.crm_activities drop column if exists outcome;
alter table public.crm_activities drop column if exists opportunity_id;
alter table public.crm_activities drop column if exists lead_id;
alter table public.crm_activities alter column client_id set not null;
drop index if exists public.crm_tasks_rule_key_uq;
alter table public.crm_tasks drop constraint if exists crm_tasks_kind_chk;
alter table public.crm_tasks drop constraint if exists crm_tasks_source_chk;
alter table public.crm_tasks drop column if exists rule_key;
alter table public.crm_tasks drop column if exists source;
alter table public.crm_tasks drop column if exists duration_min;
alter table public.crm_tasks drop column if exists kind;
alter table public.crm_tasks drop column if exists opportunity_id;
alter table public.crm_tasks drop column if exists lead_id;

drop table if exists public.crm_targets cascade;
drop table if exists public.crm_notifications cascade;
drop table if exists public.crm_automation_runs cascade;
drop table if exists public.crm_automation_rules cascade;
drop table if exists public.crm_opportunities cascade;
drop table if exists public.crm_leads cascade;
drop function if exists public.crm_link_current_contracts(uuid[]);
drop function if exists public.crm_opp_after();
drop function if exists public.crm_opp_before();
drop function if exists public.crm_lead_before();
drop function if exists public.crm_can_see_opportunity(uuid);
drop function if exists public.crm_can_edit_opportunity(uuid);
drop function if exists public.crm_can_edit_lead(uuid);
drop function if exists public.crm_can_see_lead(uuid);
