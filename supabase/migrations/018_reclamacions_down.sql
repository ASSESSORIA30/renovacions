-- =====================================================================================================
-- Desfà 018_reclamacions.sql SENSE perdre dades econòmiques:
--   · es retiren els disparadors, les funcions i els avisos automàtics nous;
--   · les taules de reclamacions i de contactes es CONSERVEN (amb RLS: només Direcció), perquè contenen
--     reclamacions enviades, respostes i imports recuperats. Si es torna a aplicar la 018, tot continua igual.
--   · no es toca cap taula anterior (liquidacions, conciliació, comercialitzadores).
-- =====================================================================================================
delete from public.crm_automation_rules where key in ('reclamacio_recordatori', 'reclamacio_sense_resposta', 'reclamacio_regularitzacio');

drop trigger if exists fin_claims_before on public.fin_claims;
drop trigger if exists fin_claims_after on public.fin_claims;
drop trigger if exists fin_claim_items_guard on public.fin_claim_items;
drop trigger if exists fin_claim_items_after on public.fin_claim_items;
drop trigger if exists fin_claim_recoveries_after on public.fin_claim_recoveries;
drop trigger if exists fin_claim_events_append on public.fin_claim_events;
drop trigger if exists fin_claim_recoveries_append on public.fin_claim_recoveries;
drop trigger if exists retailer_contacts_touch on public.retailer_contacts;

-- accés: només Direcció (les polítiques de la 018 depenen d'aquestes funcions; es redefineixen, no s'esborren)
create or replace function public.fin_claim_access(p_claim uuid, p_action text default 'read') returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.my_role() = 'admin', false); $$;
do $$
declare t text;
begin
  foreach t in array array['fin_claims', 'fin_claim_items', 'fin_claim_events', 'fin_claim_reminders', 'fin_claim_recoveries', 'fin_claim_links', 'retailer_contacts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'p_' || t || '_down_admin', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.my_role() = ''admin'')', 'p_' || t || '_down_admin', t);
    end if;
  end loop;
end $$;
drop policy if exists p_fin_claims_select on public.fin_claims;
drop policy if exists p_fin_claims_insert on public.fin_claims;
drop policy if exists p_fin_claims_update on public.fin_claims;
drop policy if exists p_fin_claims_delete on public.fin_claims;
drop policy if exists p_fin_claim_items_select on public.fin_claim_items;
drop policy if exists p_fin_claim_items_insert on public.fin_claim_items;
drop policy if exists p_fin_claim_items_update on public.fin_claim_items;
drop policy if exists p_fin_claim_items_delete on public.fin_claim_items;
drop policy if exists p_retailer_contacts_select on public.retailer_contacts;
drop policy if exists p_retailer_contacts_write on public.retailer_contacts;
do $$
declare t text;
begin
  foreach t in array array['fin_claim_events', 'fin_claim_reminders', 'fin_claim_recoveries', 'fin_claim_links'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'p_' || t || '_select', t);
      execute format('drop policy if exists %I on public.%I', 'p_' || t || '_insert', t);
      execute format('drop policy if exists %I on public.%I', 'p_' || t || '_update', t);
    end if;
  end loop;
end $$;

drop function if exists public.fin_claim_before();
drop function if exists public.fin_claim_item_guard();
drop function if exists public.fin_claim_items_after();
drop function if exists public.fin_claim_recoveries_after();
drop function if exists public.fin_claim_status_after();
drop function if exists public.fin_claim_append_only();
drop function if exists public.fin_claim_refresh(uuid);
drop function if exists public.retailer_contacts_touch();

-- Per esborrar del tot el mòdul (IRREVERSIBLE: es perden reclamacions, respostes i imports recuperats), descomenta:
-- drop table if exists public.fin_claim_links; drop table if exists public.fin_claim_recoveries; drop table if exists public.fin_claim_reminders;
-- drop table if exists public.fin_claim_events; drop table if exists public.fin_claim_items; drop table if exists public.fin_claims;
-- drop table if exists public.retailer_contacts; drop function if exists public.fin_claim_access(uuid, text); drop sequence if exists public.fin_claim_seq;
-- delete from storage.buckets where id = 'fin-claims';   -- només si el bucket és buit

select 'reclamacions desactivades (dades conservades)' as resultat;
