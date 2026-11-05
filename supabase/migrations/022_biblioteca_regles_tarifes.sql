-- =====================================================================================================
-- Fase 10.1 · 022 · BIBLIOTECA DE REGLES DEL LECTOR DE TARIFES (ponderació horària Endesa Open)
-- =====================================================================================================
-- Migració ADDITIVA i idempotent: només crea una taula nova. Desfer: 022_biblioteca_regles_tarifes_down.sql.
-- Requereix: 003 (my_role, is_staff).
--
--   · Cada fila és una regla d'interpretació d'una modalitat (p. ex. «Noche = 00–08 h de dilluns a divendres»)
--     per a una comercialitzadora i producte, opcionalment per peatge i versió del document; o bé un ajust del
--     calendari (festius afegits o exclosos).
--   · L'administració (is_staff) pot proposar regles (també des del xat del lector). Només Direcció (admin) les
--     aprova o rebutja. Les regles APROVADES es recuperen automàticament quan es carrega un document equivalent.
--   · No s'esborra res: aprovar una regla nova marca l'anterior com a «substituida» (queda l'historial).
-- =====================================================================================================

create table if not exists public.tariff_rule_library (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'modalitat' check (kind in ('modalitat', 'calendari')),
  supplier text not null check (length(supplier) between 1 and 80),
  product text not null check (length(product) between 1 and 80),
  access_tariff text check (access_tariff is null or length(access_tariff) <= 20),
  doc_version text check (doc_version is null or length(doc_version) <= 40),
  modality text check (modality is null or modality in ('plana', 'dia', 'laboral', 'cap_de_setmana', 'nit')),
  rule jsonb not null,
  source text not null default 'manual' check (source in ('direccio', 'document', 'xat', 'manual')),
  status text not null default 'proposada' check (status in ('proposada', 'aprovada', 'rebutjada', 'substituida')),
  note text check (note is null or length(note) <= 1000),
  discrepancies jsonb,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_name text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tariff_rule_library_modality_chk check ((kind = 'modalitat') = (modality is not null))
);
create index if not exists tariff_rule_library_key_idx on public.tariff_rule_library (lower(supplier), lower(product), modality, status);
-- una sola regla aprovada per clau (comercialitzadora, producte, peatge, versió, modalitat / calendari)
create unique index if not exists tariff_rule_library_approved_uq on public.tariff_rule_library
  (lower(supplier), lower(product), coalesce(access_tariff, ''), coalesce(doc_version, ''), kind, coalesce(modality, ''))
  where status = 'aprovada';

create or replace function public.tariff_rule_library_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    -- només Direcció pot crear-la directament aprovada
    if new.status <> 'proposada' and coalesce(public.my_role(), '') <> 'admin' and auth.uid() is not null then
      new.status := 'proposada';
    end if;
    return new;
  end if;
  -- la regla en si no es pot reescriure: per canviar-la se'n proposa una de nova
  if new.rule is distinct from old.rule or new.supplier is distinct from old.supplier or new.product is distinct from old.product
     or new.access_tariff is distinct from old.access_tariff or new.doc_version is distinct from old.doc_version
     or new.modality is distinct from old.modality or new.kind is distinct from old.kind then
    raise exception 'Una regla no es modifica: proposa''n una de nova' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and new.status in ('aprovada', 'rebutjada') then
    new.decided_at := now();
    new.decided_by := coalesce(auth.uid(), new.decided_by);
  end if;
  return new;
end $$;
drop trigger if exists tariff_rule_library_guard on public.tariff_rule_library;
create trigger tariff_rule_library_guard before insert or update on public.tariff_rule_library
  for each row execute function public.tariff_rule_library_guard();

alter table public.tariff_rule_library enable row level security;
drop policy if exists p_trl_select on public.tariff_rule_library;
create policy p_trl_select on public.tariff_rule_library for select to authenticated using (public.is_staff());
drop policy if exists p_trl_insert on public.tariff_rule_library;
create policy p_trl_insert on public.tariff_rule_library for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
drop policy if exists p_trl_update on public.tariff_rule_library;
create policy p_trl_update on public.tariff_rule_library for update to authenticated
  using (coalesce(public.my_role() = 'admin', false)) with check (coalesce(public.my_role() = 'admin', false));
-- (sense DELETE: les regles es rebutgen o se substitueixen, no s'esborren)

-- ============================================================ COMPROVACIÓ (ha de retornar 1 taula i 3 polítiques)
select 'taula biblioteca' as què, count(*) as total from information_schema.tables where table_schema = 'public' and table_name = 'tariff_rule_library'
union all select 'polítiques RLS', count(*) from pg_policies where schemaname = 'public' and tablename = 'tariff_rule_library';
