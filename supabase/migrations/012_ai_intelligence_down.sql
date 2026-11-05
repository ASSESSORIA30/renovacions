-- Reverteix 012_ai_intelligence.sql (només objectes creats per la Fase 5).
-- ATENCIÓ: esborra les oportunitats detectades, recomanacions, esborranys, converses i registres de la IA.
-- No toca clients, contractes, oportunitats comercials, documents ni comparatives.
drop trigger if exists ai_sync_from_crm_opp_trg on public.crm_opportunities;
drop function if exists public.ai_sync_from_crm_opp();
drop index if exists public.crm_opps_ai_uq;
alter table public.crm_opportunities drop column if exists ai_opportunity_id;

drop table if exists public.ai_automation_logs;
drop table if exists public.ai_usage;
drop table if exists public.ai_tool_executions;
drop table if exists public.ai_messages;
drop table if exists public.ai_conversations;
drop table if exists public.ai_proposal_drafts;
drop table if exists public.ai_opportunity_economics;
drop table if exists public.opportunity_scores;
drop table if exists public.ai_recommendations;
drop table if exists public.ai_opportunities;
alter table if exists public.ai_analysis_runs drop constraint if exists ai_runs_snapshot_fk;
drop table if exists public.tariff_snapshots;
drop table if exists public.ai_analysis_runs;

drop function if exists public.ai_purge_expired();
drop function if exists public.ai_draft_before();
drop function if exists public.ai_opp_before();
drop function if exists public.ai_snapshot_immutable();
drop function if exists public.ai_can_see_opportunity(uuid);

delete from public.crm_automation_rules where key in ('ai_motor', 'ai_puntuacio', 'ai_sas_escenari', 'ai_esborranys_auto', 'ai_retencio');

-- Les preferències de contacte dels clients es conserven (dades del client): esborra-les només si cal.
-- alter table public.crm_clients drop constraint if exists crm_clients_contact_pref_chk;
-- alter table public.crm_clients drop column if exists contact_preference, drop column if exists opt_out_at, drop column if exists commercial_opt_out;
