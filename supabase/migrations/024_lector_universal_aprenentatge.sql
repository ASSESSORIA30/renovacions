-- =====================================================================================================
-- Fase 12 · 024 · LECTOR UNIVERSAL DE TARIFES AMB APRENENTATGE PERMANENT
-- =====================================================================================================
-- Migració ADDITIVA i idempotent. Desfer: 024_lector_universal_aprenentatge_down.sql. Requereix: 003, 022, 023.
-- No crea taules duplicades: reaprofita la biblioteca de regles (022) i les plantilles de lectura (023).
--
--   · tariff_rule_library (022) admet ara regles de LECTURA (kind = 'lectura'): «Plan OMIE = indexada, el valor és
--     el marge», «Impulsa Negocios: P1–P5 promocionat», «el descompte de la columna O afecta energia i potència»…
--     Cada regla guarda la comercialitzadora, la plantilla i la versió, l'abast (document · producte · plantilla ·
--     general), les columnes afectades, l'explicació, l'exemple validat (resultat correcte), qui la proposa i
--     qui l'aprova. La regla en si no es pot reescriure (per canviar-la se'n proposa una de nova).
--     Només Direcció (admin) aprova o rebutja; una regla GENERAL només s'activa quan Direcció l'aprova.
--   · tariff_template_examples (nova): exemples validats («aquesta tarifa ha de donar aquests P1–P6»), amb la regla
--     deduïda i l'estat de l'aprovació. Serveixen per aprendre i per validar lectures futures.
--   · tariff_template_reads (023): es registra també la pestanya llegida i el recompte de tarifes (identificades,
--     interpretades, a revisar, pendents i fallides) de cada document (fonts documentals).
--   · Les regles apreses de producte i de plantilla es desen DINS de la definició de la versió de la plantilla
--     (tariff_template_versions, immutable): una correcció mai modifica tarifes ja aprovades ni comparatives
--     històriques; només s'aplica a les lectures noves.
-- =====================================================================================================

-- 1) Biblioteca de regles: nou tipus «lectura» i noves fonts (exemple validat, proposta de la IA)
alter table public.tariff_rule_library drop constraint if exists tariff_rule_library_kind_check;
alter table public.tariff_rule_library add constraint tariff_rule_library_kind_check check (kind in ('modalitat', 'calendari', 'lectura'));
alter table public.tariff_rule_library drop constraint if exists tariff_rule_library_source_check;
alter table public.tariff_rule_library add constraint tariff_rule_library_source_check check (source in ('direccio', 'document', 'xat', 'manual', 'exemple', 'ia'));

alter table public.tariff_rule_library add column if not exists template_id uuid references public.tariff_templates (id) on delete restrict;
alter table public.tariff_rule_library add column if not exists template_version int;
alter table public.tariff_rule_library add column if not exists scope text;
alter table public.tariff_rule_library add column if not exists columns text[];
alter table public.tariff_rule_library add column if not exists example jsonb;
alter table public.tariff_rule_library drop constraint if exists tariff_rule_library_scope_check;
alter table public.tariff_rule_library add constraint tariff_rule_library_scope_check check (scope is null or scope in ('document', 'producte', 'plantilla', 'general'));
create index if not exists tariff_rule_library_tpl_idx on public.tariff_rule_library (template_id, created_at desc);
create index if not exists tariff_rule_library_kind_idx on public.tariff_rule_library (kind, lower(supplier), status);

-- La guarda de la 022, ampliada: tampoc es poden reescriure la plantilla, l'abast, les columnes ni l'exemple.
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
  if new.rule is distinct from old.rule or new.supplier is distinct from old.supplier or new.product is distinct from old.product
     or new.access_tariff is distinct from old.access_tariff or new.doc_version is distinct from old.doc_version
     or new.modality is distinct from old.modality or new.kind is distinct from old.kind
     or new.template_id is distinct from old.template_id or new.template_version is distinct from old.template_version
     or new.scope is distinct from old.scope or new.columns is distinct from old.columns or new.example is distinct from old.example then
    raise exception 'Una regla no es modifica: proposa''n una de nova' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and new.status in ('aprovada', 'rebutjada') then
    new.decided_at := now();
    new.decided_by := coalesce(auth.uid(), new.decided_by);
  end if;
  return new;
end $$;

-- 2) Exemples validats per ensenyar la lectura
create table if not exists public.tariff_template_examples (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.tariff_templates (id) on delete restrict,
  version int,
  product_key text not null check (length(product_key) between 1 and 200),
  product_name text not null check (length(product_name) between 1 and 200),
  row_number int,
  expected jsonb not null,            -- preus correctes P1–P6 (i potència si s'indica)
  explanation text check (explanation is null or length(explanation) <= 2000),
  discount_applied boolean,
  explained boolean not null default false,   -- s'ha trobat una regla reutilitzable que l'explica
  rule jsonb,                         -- regla deduïda (o valors manuals)
  status text not null default 'proposat' check (status in ('proposat', 'aprovat', 'rebutjat')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_name text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tariff_template_examples_tpl_idx on public.tariff_template_examples (template_id, created_at desc);

create or replace function public.tariff_template_examples_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'proposat' and coalesce(public.my_role(), '') <> 'admin' and auth.uid() is not null then new.status := 'proposat'; end if;
    return new;
  end if;
  if new.expected is distinct from old.expected or new.template_id is distinct from old.template_id or new.product_key is distinct from old.product_key
     or new.rule is distinct from old.rule or new.explanation is distinct from old.explanation or new.created_by is distinct from old.created_by then
    raise exception 'Un exemple validat no es modifica: crea''n un de nou' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then new.decided_at := now(); new.decided_by := coalesce(auth.uid(), new.decided_by); end if;
  return new;
end $$;
drop trigger if exists tariff_template_examples_guard on public.tariff_template_examples;
create trigger tariff_template_examples_guard before insert or update on public.tariff_template_examples
  for each row execute function public.tariff_template_examples_guard();

alter table public.tariff_template_examples enable row level security;
drop policy if exists p_ttplx_select on public.tariff_template_examples;
create policy p_ttplx_select on public.tariff_template_examples for select to authenticated using (public.is_staff());
drop policy if exists p_ttplx_insert on public.tariff_template_examples;
create policy p_ttplx_insert on public.tariff_template_examples for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
drop policy if exists p_ttplx_update on public.tariff_template_examples;
create policy p_ttplx_update on public.tariff_template_examples for update to authenticated
  using (coalesce(public.my_role() = 'admin', false)) with check (coalesce(public.my_role() = 'admin', false));
-- (sense DELETE: no s'esborra cap exemple)

-- 3) Fonts documentals: pestanya llegida i recompte de tarifes de cada lectura
alter table public.tariff_template_reads add column if not exists sheet text;
alter table public.tariff_template_reads add column if not exists counts jsonb;

-- ============================================================ COMPROVACIÓ
-- Ha de retornar: 1 taula d'exemples, 3 polítiques d'exemples, 5 columnes noves a la biblioteca, 2 a les lectures
-- i el tipus «lectura» acceptat.
select 'taula d''exemples' as què, count(*) as total from information_schema.tables where table_schema = 'public' and table_name = 'tariff_template_examples'
union all select 'polítiques d''exemples', count(*) from pg_policies where schemaname = 'public' and tablename = 'tariff_template_examples'
union all select 'columnes noves a la biblioteca', count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tariff_rule_library' and column_name in ('template_id', 'template_version', 'scope', 'columns', 'example')
union all select 'columnes noves a les lectures', count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tariff_template_reads' and column_name in ('sheet', 'counts')
union all select 'tipus «lectura» acceptat', count(*) from pg_constraint where conname = 'tariff_rule_library_kind_check' and pg_get_constraintdef(oid) like '%lectura%';
