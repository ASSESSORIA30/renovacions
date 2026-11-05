-- =====================================================================================================
-- 030 · CATÀLEG DE TARIFES COM A ÚNICA FONT · retirada gradual de l'antic apartat «Propostes» (taula `offers`)
-- =====================================================================================================
-- Additiva i idempotent. NO esborra cap taula ni cap dada. Reversible amb 030_cataleg_unic_down.sql.
--   · Còpia de seguretat de `offers` (offers_backup_030) abans de deixar-la en només lectura.
--   · `offers` passa a ser NOMÉS LECTURA des del navegador: ja no s'hi poden crear ni modificar ofertes. Les comparatives,
--     els PDF i les renovacions llegeixen `tariff_versions` (Catàleg de tarifes). La taula es conserva perquè:
--       - l'informe de migració la compara amb el catàleg i permet incorporar-ne les ofertes vàlides;
--       - les comparatives històriques porten còpies de les ofertes antigues dins del seu snapshot (no en depenen).
--   · No es toquen `comparisons`, `comparison_documents`, `documents` ni cap proposta, PDF o activitat emesa.
-- =====================================================================================================

-- 1. còpia de seguretat (només la primera vegada; si ja existeix no es sobreescriu)
do $$ begin
  if to_regclass('public.offers_backup_030') is null then
    create table public.offers_backup_030 as select o.*, now() as backup_at from public.offers o;
    alter table public.offers_backup_030 enable row level security;   -- sense polítiques: només Direcció via SQL
    comment on table public.offers_backup_030 is 'Còpia de l''antiga taula offers abans de la unificació amb el Catàleg de tarifes (migració 030)';
  end if;
end $$;

-- 2. l'antiga taula d'ofertes queda en només lectura (es conserva la política de lectura existent)
drop policy if exists p_offers_admin on public.offers;
comment on table public.offers is 'OBSOLETA (030): només lectura. Font única de tarifes: tariff_versions (Catàleg de tarifes). No esborrar sense revisar l''informe de migració.';

-- comprovació: ha de retornar la còpia amb el mateix nombre de files i cap política d'escriptura a offers
select (select count(*) from public.offers) as ofertes, (select count(*) from public.offers_backup_030) as copia,
       (select count(*) from pg_policies where tablename = 'offers' and cmd <> 'SELECT') as politiques_escriptura;
