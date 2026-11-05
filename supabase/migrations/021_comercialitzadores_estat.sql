-- =====================================================================================================
-- Fase 10 · 021 · ESTAT DE LES COMERCIALITZADORES: activa, desactivada (inactiva), arxivada
-- =====================================================================================================
-- Additiva i idempotent. Desfer: 021_comercialitzadores_estat_down.sql. Requereix la 017.
--   · Nou estat 'arxivada' (es conserven 'activa', 'pendent', 'suspesa' i 'inactiva' = desactivada).
--   · Qui i quan ha canviat l'estat (a més del registre de seguretat sec_audit que ja feia la 017).
--   · Desactivar o arxivar NO esborra res: contractes, tarifes, comissions, retrocessions, liquidacions,
--     documents i incidències es conserven. Només deixa d'aparèixer als selectors per a feina nova.
--   · Eliminar físicament només es permet (al servidor, Direcció) si no té cap dependència; les claus
--     forànies «on delete restrict» de la 017 ho garanteixen també a la base de dades.
-- =====================================================================================================
alter table public.retailers add column if not exists status_changed_at timestamptz;
alter table public.retailers add column if not exists status_changed_by uuid references auth.users (id) on delete set null;
alter table public.retailers add column if not exists status_changed_by_name text;
alter table public.retailers add column if not exists status_note text check (status_note is null or length(status_note) <= 500);

do $$ begin
  alter table public.retailers drop constraint if exists retailers_status_check;
  if not exists (select 1 from pg_constraint where conname = 'retailers_status_chk') then
    alter table public.retailers add constraint retailers_status_chk check (status in ('activa', 'pendent', 'suspesa', 'inactiva', 'arxivada'));
  end if;
end $$;

create or replace function public.retailer_status_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
    new.status_changed_by_name := coalesce((select name from profiles where id = auth.uid()), new.status_changed_by_name, 'Sistema');
  end if;
  return new;
end $$;
drop trigger if exists retailers_status_stamp on public.retailers;
create trigger retailers_status_stamp before update on public.retailers for each row execute function public.retailer_status_stamp();

create index if not exists retailers_status_idx on public.retailers (status);

-- ============================================================ COMPROVACIÓ (ha de retornar 4 columnes noves i l'estat «arxivada» acceptat)
select 'columnes d''estat' as què, count(*)::text as valor from information_schema.columns
 where table_schema = 'public' and table_name = 'retailers' and column_name in ('status_changed_at', 'status_changed_by', 'status_changed_by_name', 'status_note')
union all select 'restricció d''estat', pg_get_constraintdef(oid) from pg_constraint where conname = 'retailers_status_chk';
