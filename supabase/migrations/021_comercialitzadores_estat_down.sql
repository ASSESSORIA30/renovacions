-- Desfà la 021 sense perdre dades: les comercialitzadores arxivades passen a «inactiva» (desactivada) i es
-- torna a la restricció d'estats de la 017. Les columnes de traçabilitat es conserven.
drop trigger if exists retailers_status_stamp on public.retailers;
update public.retailers set status = 'inactiva' where status = 'arxivada';
alter table public.retailers drop constraint if exists retailers_status_chk;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'retailers_status_check') then
    alter table public.retailers add constraint retailers_status_check check (status in ('activa', 'pendent', 'suspesa', 'inactiva'));
  end if;
end $$;
