-- =====================================================================================================
-- Desfà 029_agrupacio_contactes.sql SENSE perdre dades:
--   · es retiren les polítiques, els disparadors, les funcions i els índexs nous;
--   · les 4 taules es CONSERVEN amb RLS activada i sense polítiques (ningú hi accedeix des del navegador) perquè
--     contenen decisions, autoritzacions i comunicacions amb valor de traçabilitat. Tornar a aplicar la 029 les reactiva.
--   · no es toca cap taula ni dada anterior (contracts, activities, crm_contacts…).
-- =====================================================================================================
drop policy if exists p_rcl_select on public.renewal_contact_links;
drop policy if exists p_rcl_insert on public.renewal_contact_links;
drop policy if exists p_rcl_update on public.renewal_contact_links;
drop policy if exists p_ccc_select on public.crm_contact_clients;
drop policy if exists p_ccc_insert on public.crm_contact_clients;
drop policy if exists p_ccc_update on public.crm_contact_clients;
drop policy if exists p_rca_select on public.renewal_contact_authorizations;
drop policy if exists p_rca_insert on public.renewal_contact_authorizations;
drop policy if exists p_rca_update on public.renewal_contact_authorizations;
drop policy if exists p_rgo_select on public.renewal_group_ops;
drop policy if exists p_rgo_insert on public.renewal_group_ops;
drop policy if exists p_rgo_update on public.renewal_group_ops;

drop trigger if exists renewal_contact_links_guard on public.renewal_contact_links;
drop trigger if exists renewal_contact_authorizations_guard on public.renewal_contact_authorizations;
drop trigger if exists crm_contact_clients_guard on public.crm_contact_clients;
drop trigger if exists renewal_contact_links_stamp on public.renewal_contact_links;
drop trigger if exists renewal_contact_authorizations_stamp on public.renewal_contact_authorizations;
drop trigger if exists crm_contact_clients_stamp on public.crm_contact_clients;
drop trigger if exists renewal_group_ops_stamp on public.renewal_group_ops;
drop trigger if exists renewal_group_ops_guard on public.renewal_group_ops;

drop function if exists public.grp_guard_revoke();
drop function if exists public.grp_stamp_insert();
drop function if exists public.grp_ops_guard();
drop index if exists public.activities_group_op_idx;
drop index if exists public.contracts_cif_norm_idx;
drop function if exists public.holder_visible(text);
drop function if exists public.can_see_all(text[]);
drop function if exists public.is_internal();
drop function if exists public.norm_tax_id(text);

-- Per esborrar del tot les dades d'aquesta funcionalitat (IRREVERSIBLE), descomenta:
-- drop table if exists public.renewal_group_ops; drop table if exists public.renewal_contact_authorizations;
-- drop table if exists public.crm_contact_clients; drop table if exists public.renewal_contact_links;

-- comprovació: ha de retornar 0 (les taules i les dades es conserven)
select count(*) as politiques_restants from pg_policies where tablename in ('renewal_contact_links','crm_contact_clients','renewal_contact_authorizations','renewal_group_ops');
