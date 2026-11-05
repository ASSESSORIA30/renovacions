-- =====================================================================================================
-- 031 · MATRIU COMERCIAL NUFRI · lector local d'annexos, simulador de marges BOE i vinculació al contracte
-- =====================================================================================================
-- Additiva i idempotent. NO esborra cap taula, relació ni dada. Reversible amb 031_nufri_matriu_comercial_down.sql.
--   · Nou tipus de regla de comissió «energia_potencia» (energia €/MWh del nivell + marge BOE × suma de kW de tots els
--     períodes). Es substitueixen NOMÉS les restriccions de llista de tipus i d'unitat (v2 → v3), ampliades.
--   · fin_contract_economics.commercial (jsonb): configuració comercial congelada en formalitzar el contracte (tarifa i
--     versió del catàleg, nivell, marge BOE, potències, consum, preus acceptats, comissió prevista, col·laborador).
--   · Les tarifes del catàleg porten la matriu dins de tariff_versions.data (jsonb): no cal cap columna nova.
-- =====================================================================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_kind_v3') then
    alter table public.fin_rules drop constraint if exists fin_rules_kind_v2;
    alter table public.fin_rules add constraint fin_rules_kind_v3 check (kind in ('fix_contracte', 'per_mwh', 'energia_potencia', 'pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'trams_volum', 'bonificacio', 'regularitzacio', 'retrocessio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_unit_v3') then
    alter table public.fin_rules drop constraint if exists fin_rules_unit_v2;
    alter table public.fin_rules add constraint fin_rules_unit_v3 check (unit = case when kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'retrocessio') then 'pct' when kind in ('per_mwh', 'energia_potencia') then 'eur_mwh' else 'eur' end);
  end if;
end $$;

alter table public.fin_contract_economics add column if not exists commercial jsonb;
comment on column public.fin_contract_economics.commercial is 'Configuració comercial congelada en formalitzar (matriu Nufri: nivell, marge BOE, preus, comissió prevista). No es modifica retroactivament.';

-- comprovació: les dues restriccions noves i la columna han d'existir
select (select count(*) from pg_constraint where conname in ('fin_rules_kind_v3', 'fin_rules_unit_v3')) as restriccions_v3,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fin_contract_economics' and column_name = 'commercial') as columna_commercial;
