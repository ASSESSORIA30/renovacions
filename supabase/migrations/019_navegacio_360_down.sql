-- =====================================================================================================
-- Desfà 019_navegacio_360.sql SENSE perdre dades:
--   · es retiren el disparador i les polítiques; les taules i les columnes noves es CONSERVEN (amb RLS restringida:
--     només Direcció veu els esborranys; cadascú continua veient només els seus registres recents);
--   · els representants legals que s'hagin introduït es conserven a crm_clients.
-- =====================================================================================================
drop trigger if exists comparison_drafts_touch on public.comparison_drafts;
drop function if exists public.comparison_draft_touch();

drop policy if exists p_comparison_drafts_select on public.comparison_drafts;
drop policy if exists p_comparison_drafts_insert on public.comparison_drafts;
drop policy if exists p_comparison_drafts_update on public.comparison_drafts;
drop policy if exists p_comparison_drafts_down on public.comparison_drafts;
create policy p_comparison_drafts_down on public.comparison_drafts for select to authenticated using (public.my_role() = 'admin');

-- Per esborrar del tot (IRREVERSIBLE: es perden esborranys, historial de recents i representants legals), descomenta:
-- drop table if exists public.comparison_drafts; drop table if exists public.user_recent_records;
-- alter table public.crm_clients drop constraint if exists crm_clients_legal_rep_role_chk, drop constraint if exists crm_clients_legal_rep_tax_chk,
--   drop column if exists contact_role, drop column if exists legal_rep_name, drop column if exists legal_rep_tax_id,
--   drop column if exists legal_rep_role, drop column if exists contact_is_legal_rep;

select 'esborranys i recents desactivats (dades conservades)' as resultat;
