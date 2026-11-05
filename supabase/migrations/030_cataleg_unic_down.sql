-- Desfà 030_cataleg_unic.sql: torna a permetre que l'equip d'administració escrigui a `offers` (com a la migració 003).
-- La còpia offers_backup_030 es CONSERVA (no s'esborra cap dada). Per eliminar-la, descomenta la darrera línia.
drop policy if exists p_offers_admin on public.offers;
create policy p_offers_admin on public.offers for all to authenticated using (public.is_staff()) with check (public.is_staff());
comment on table public.offers is null;
-- drop table if exists public.offers_backup_030;
select count(*) as politiques_offers from pg_policies where tablename = 'offers';
