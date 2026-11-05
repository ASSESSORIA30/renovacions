-- Desfà la migració 010 (CRM Fase 3: contractació). ATENCIÓ: elimina expedients, requisits, plantilles, documents generats
-- (només el vincle: els fitxers continuen al gestor documental), sol·licituds de signatura, historial de tramitació i
-- registres de comissions. Els contractes creats en activar expedients ES CONSERVEN. Fes una còpia abans (Database → Backups).
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_expedients') then
    alter publication supabase_realtime drop table public.crm_expedients;
  end if;
end $$;

delete from public.crm_automation_rules where key in ('exp_documentacio_incompleta', 'exp_signatura_pendent', 'exp_sense_moviment', 'exp_rebuig', 'exp_activat', 'exp_sense_responsable');

alter table public.crm_opportunities drop column if exists renewal_of_contract_id;
alter table public.crm_activities drop column if exists expedient_id;
alter table public.crm_tasks drop column if exists expedient_id;
alter table public.crm_incidents drop column if exists expedient_id;
alter table public.crm_documents drop column if exists expedient_id;
alter table public.crm_contracts drop column if exists expedient_id;

drop function if exists public.crm_activate_expedient(uuid, date, date, date, text, text, text);
drop function if exists public.crm_expedient_seed_requirements(uuid);

drop table if exists public.crm_commission_records cascade;
drop table if exists public.crm_expedient_refs cascade;
drop table if exists public.crm_expedient_events cascade;
drop table if exists public.crm_signature_events cascade;
drop table if exists public.crm_signature_requests cascade;
drop table if exists public.crm_generated_documents cascade;
drop table if exists public.crm_doc_template_versions cascade;
drop table if exists public.crm_doc_templates cascade;
drop table if exists public.crm_expedient_requirements cascade;
drop table if exists public.crm_doc_requirements cascade;
alter table if exists public.crm_expedients drop constraint if exists crm_exp_terms_fk;
drop table if exists public.crm_expedient_terms cascade;
drop table if exists public.crm_expedients cascade;
drop sequence if exists public.crm_expedient_seq;

drop function if exists public.crm_commission_before();
drop function if exists public.crm_signature_before();
drop function if exists public.crm_template_after();
drop function if exists public.crm_template_before();
drop function if exists public.crm_req_before();
drop function if exists public.crm_event_touch();
drop function if exists public.crm_append_only();
drop function if exists public.crm_exp_after();
drop function if exists public.crm_exp_before();
drop function if exists public.crm_exp_transition_ok(text, text);
drop function if exists public.crm_can_manage_contracting();
drop function if exists public.crm_can_edit_expedient(uuid);
drop function if exists public.crm_can_see_expedient(uuid);
