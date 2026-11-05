-- DESFÀ la 031 (només si cal tornar enrere). No esborra cap regla: si n'hi ha de tipus «energia_potencia», s'atura.
do $$
begin
  if exists (select 1 from public.fin_rules where kind = 'energia_potencia') then
    raise exception 'Hi ha regles de tipus energia_potencia: retira-les o canvia-les abans de desfer la 031';
  end if;
  alter table public.fin_rules drop constraint if exists fin_rules_kind_v3;
  alter table public.fin_rules drop constraint if exists fin_rules_unit_v3;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_kind_v2') then
    alter table public.fin_rules add constraint fin_rules_kind_v2 check (kind in ('fix_contracte', 'per_mwh', 'pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'trams_volum', 'bonificacio', 'regularitzacio', 'retrocessio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_unit_v2') then
    alter table public.fin_rules add constraint fin_rules_unit_v2 check (unit = case when kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'retrocessio') then 'pct' when kind = 'per_mwh' then 'eur_mwh' else 'eur' end);
  end if;
end $$;
-- La columna fin_contract_economics.commercial es conserva (conté configuracions de contractes ja formalitzats).
select 'desfet' as estat;
