-- =====================================================================================================
-- Desfà 017_comercialitzadores.sql SENSE perdre dades econòmiques:
--   · es retiren les funcions d'aprovació i de retrocessió i les alertes noves;
--   · les taules de comercialitzadores es CONSERVEN (amb RLS: només Direcció), per si cal tornar a aplicar la 017;
--   · les regles ja aprovades a fin_rules (layer 'proveidor') es CONSERVEN: són regles econòmiques aprovades per
--     Direcció i poden haver generat càlculs. Si cal deixar-les de fer servir, retira-les des de «Comissions».
--   · les restriccions de tipus de fin_rules tornen a la llista de la 011 NOMÉS si cap regla fa servir els tipus nous.
-- =====================================================================================================
drop function if exists public.retailer_apply_clawback(uuid, uuid, numeric, uuid, text);
drop function if exists public.retailer_activate_document(uuid);
drop function if exists public.retailer_approve_term(uuid, jsonb, boolean, boolean);
delete from public.crm_automation_rules where key in ('comercialitzadora_venciment', 'comercialitzadora_infrapagament');

-- accés: només Direcció
create or replace function public.retailer_access(p_action text default 'read') returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.my_role() = 'admin', false); $$;
delete from public.role_permissions where module = 'comercialitzadores';

do $$
begin
  if not exists (select 1 from public.fin_rules where kind in ('pct_energia', 'pct_potencia')) then
    alter table public.fin_rules drop constraint if exists fin_rules_kind_v2;
    alter table public.fin_rules drop constraint if exists fin_rules_unit_v2;
    alter table public.fin_rules add constraint fin_rules_kind_v1 check (kind in ('fix_contracte', 'per_mwh', 'pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'trams_volum', 'bonificacio', 'regularitzacio', 'retrocessio'));
    alter table public.fin_rules add constraint fin_rules_unit_v1 check (unit = case when kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'retrocessio') then 'pct' when kind = 'per_mwh' then 'eur_mwh' else 'eur' end);
  else
    raise notice 'Hi ha regles amb tipus nous (pct_energia / pct_potencia): es mantenen les restriccions ampliades.';
  end if;
end $$;

-- Per esborrar del tot el mòdul (IRREVERSIBLE; abans cal desvincular fin_rules.retailer_id/source_*), descomenta:
-- alter table public.fin_rules drop column if exists source_term_id, drop column if exists source_document_id, drop column if exists retailer_id;
-- drop table if exists public.retailer_terms cascade; drop table if exists public.retailer_clawback_rules cascade;
-- drop table if exists public.retailer_extractions; drop table if exists public.retailer_documents; drop table if exists public.retailers;
