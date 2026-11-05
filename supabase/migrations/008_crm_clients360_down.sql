-- Desfà la migració 008 (CRM Fase 1). ATENCIÓ: elimina les dades de clients, subministraments, contractes,
-- documents (registres), activitat i tasques creades al CRM. Fes-ne una còpia abans (Database → Backups).
-- Els fitxers del bucket crm-documents NO s'esborren automàticament.
drop view if exists public.crm_clients_list;
-- restaura les polítiques de comparatives de la migració 006
create or replace function public.can_see_comparison(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from comparisons c where c.id = p_id and (c.created_by = auth.uid() or public.is_staff() or (c.contract_id is not null and public.can_see(c.contract_id))));
$$;
drop policy if exists p_cmp_read on public.comparisons;
create policy p_cmp_read on public.comparisons for select to authenticated using (created_by = auth.uid() or public.is_staff() or (contract_id is not null and public.can_see(contract_id)));
drop policy if exists p_cmp_insert on public.comparisons;
create policy p_cmp_insert on public.comparisons for insert to authenticated with check (created_by = auth.uid() and (contract_id is null or public.can_see(contract_id)));
drop policy if exists p_cmp_update on public.comparisons;
create policy p_cmp_update on public.comparisons for update to authenticated using (created_by = auth.uid() or public.is_staff()) with check (contract_id is null or public.can_see(contract_id));
alter table if exists public.comparisons drop column if exists crm_supply_id;
alter table if exists public.comparisons drop column if exists crm_client_id;
drop table if exists public.crm_audit_events cascade;
drop table if exists public.crm_incidents cascade;
drop table if exists public.crm_tasks cascade;
drop table if exists public.crm_activities cascade;
drop table if exists public.crm_document_versions cascade;
drop table if exists public.crm_documents cascade;
drop table if exists public.crm_contract_finance cascade;
alter table if exists public.crm_supplies drop constraint if exists crm_supplies_current_contract_fk;
drop table if exists public.crm_contracts cascade;
drop table if exists public.crm_supplies cascade;
drop table if exists public.crm_client_assignments cascade;
drop table if exists public.crm_contacts cascade;
drop table if exists public.crm_clients cascade;
drop function if exists public.crm_audit();
drop function if exists public.crm_document_protect();
drop function if exists public.crm_contract_protect();
drop function if exists public.crm_client_before();
drop function if exists public.crm_touch();
drop function if exists public.crm_can_see_contract_finance(uuid);
drop function if exists public.crm_can_see_sensitive(uuid);
drop function if exists public.crm_can_edit_client(uuid);
drop function if exists public.crm_can_see_client(uuid);
drop function if exists public.crm_norm(text);
