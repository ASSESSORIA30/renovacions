-- =====================================================================================================
-- Fase 11 · 023 · PLANTILLES DE LECTURA IA PER COMERCIALITZADORA (Excel de tarifes) — versions i verificació
-- =====================================================================================================
-- Migració ADDITIVA i idempotent: només crea taules noves. Desfer: 023_plantilles_lectura_down.sql. Requereix: 003, 017.
--
--   · tariff_templates: una plantilla per format de document d'una comercialitzadora (p. ex. Naturgy · Captación
--     PYMES Excel). Estat: pendent · verificada · revisio (format canviat) · error · desactivada.
--   · tariff_template_versions: cada canvi de correspondències és una VERSIÓ nova (no es reescriu cap versió:
--     les antigues serveixen per interpretar documents històrics). Guarda la definició, l'empremta i l'exemple.
--   · tariff_template_corrections: correccions fetes des del xat o l'editor (biblioteca de coneixement).
--   · tariff_template_reads: cada lectura de document (resultat, errors, productes) per comparar versions.
--   · Només Direcció (admin) pot marcar una plantilla com a VERIFICADA (afecta el catàleg general de tarifes).
--     L'administració (is_staff) la pot crear, corregir i provar. Ningú no esborra res.
-- =====================================================================================================

create table if not exists public.tariff_templates (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid references public.retailers (id) on delete restrict,
  supplier text not null check (length(supplier) between 1 and 120),
  name text not null check (length(name) between 1 and 160),
  doc_type text not null default 'xlsx' check (doc_type in ('xlsx', 'pdf')),
  status text not null default 'pendent' check (status in ('pendent', 'verificada', 'revisio', 'error', 'desactivada')),
  active boolean not null default true,
  current_version int not null default 1 check (current_version >= 1),
  verified_version int,
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  verified_by_name text,
  last_read_at timestamptz,
  last_read_status text,
  last_errors jsonb not null default '[]'::jsonb,
  validated_pct numeric(5, 1),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tariff_templates_supplier_idx on public.tariff_templates (lower(supplier));
create index if not exists tariff_templates_retailer_idx on public.tariff_templates (retailer_id);

create table if not exists public.tariff_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.tariff_templates (id) on delete restrict,
  version int not null check (version >= 1),
  definition jsonb not null,
  sample_name text,
  sample_grid jsonb,               -- full d'exemple (valors de la plantilla de tarifes; sense dades personals)
  checks jsonb not null default '[]'::jsonb,
  note text check (note is null or length(note) <= 1000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create table if not exists public.tariff_template_corrections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.tariff_templates (id) on delete restrict,
  version int,                     -- versió que s'ha creat en aplicar-la
  instruction text not null check (length(instruction) between 1 and 2000),
  ops jsonb not null,
  status text not null default 'aplicada' check (status in ('proposada', 'aplicada', 'rebutjada')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.tariff_template_reads (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.tariff_templates (id) on delete restrict,
  version int not null,
  file_name text not null check (length(file_name) <= 300),
  status text not null check (status in ('compatible', 'canvis_menors', 'incompatible', 'error')),
  summary jsonb not null default '{}'::jsonb,   -- productes llegits (amb cel·les d'origen), avisos i vigència
  imported boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists tariff_template_reads_tpl_idx on public.tariff_template_reads (template_id, created_at desc);

-- Guarda: només Direcció verifica; la versió verificada ha d'existir; no es pot verificar una plantilla desactivada.
create or replace function public.tariff_templates_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'verificada' and (tg_op = 'INSERT' or old.status is distinct from 'verificada' or old.verified_version is distinct from new.verified_version) then
    if auth.uid() is not null and coalesce(public.my_role(), '') <> 'admin' then
      raise exception 'Només Direcció pot verificar una plantilla de lectura' using errcode = '42501';
    end if;
    if new.verified_version is null or not exists (select 1 from public.tariff_template_versions v where v.template_id = new.id and v.version = new.verified_version) then
      raise exception 'Cal indicar una versió existent per verificar la plantilla' using errcode = '23514';
    end if;
    if not new.active then raise exception 'Una plantilla desactivada no es pot verificar' using errcode = '23514'; end if;
    new.verified_at := now();
    new.verified_by := coalesce(auth.uid(), new.verified_by);
  end if;
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then new.created_by := old.created_by; end if;
  return new;
end $$;
drop trigger if exists tariff_templates_guard on public.tariff_templates;
create trigger tariff_templates_guard before insert or update on public.tariff_templates for each row execute function public.tariff_templates_guard();

alter table public.tariff_templates enable row level security;
alter table public.tariff_template_versions enable row level security;
alter table public.tariff_template_corrections enable row level security;
alter table public.tariff_template_reads enable row level security;

drop policy if exists p_ttpl_select on public.tariff_templates;
create policy p_ttpl_select on public.tariff_templates for select to authenticated using (public.is_staff());
drop policy if exists p_ttpl_insert on public.tariff_templates;
create policy p_ttpl_insert on public.tariff_templates for insert to authenticated with check (public.is_staff() and status <> 'verificada');
drop policy if exists p_ttpl_update on public.tariff_templates;
create policy p_ttpl_update on public.tariff_templates for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists p_ttplv_select on public.tariff_template_versions;
create policy p_ttplv_select on public.tariff_template_versions for select to authenticated using (public.is_staff());
drop policy if exists p_ttplv_insert on public.tariff_template_versions;
create policy p_ttplv_insert on public.tariff_template_versions for insert to authenticated with check (public.is_staff());
-- (sense UPDATE ni DELETE: les versions són immutables)

drop policy if exists p_ttplc_select on public.tariff_template_corrections;
create policy p_ttplc_select on public.tariff_template_corrections for select to authenticated using (public.is_staff());
drop policy if exists p_ttplc_insert on public.tariff_template_corrections;
create policy p_ttplc_insert on public.tariff_template_corrections for insert to authenticated with check (public.is_staff() and created_by = auth.uid());

drop policy if exists p_ttplr_select on public.tariff_template_reads;
create policy p_ttplr_select on public.tariff_template_reads for select to authenticated using (public.is_staff());
drop policy if exists p_ttplr_insert on public.tariff_template_reads;
create policy p_ttplr_insert on public.tariff_template_reads for insert to authenticated with check (public.is_staff());
drop policy if exists p_ttplr_update on public.tariff_template_reads;
create policy p_ttplr_update on public.tariff_template_reads for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ============================================================ COMPROVACIÓ (ha de retornar 4 taules i 9 polítiques)
select 'taules de plantilles' as què, count(*) as total from information_schema.tables
 where table_schema = 'public' and table_name in ('tariff_templates', 'tariff_template_versions', 'tariff_template_corrections', 'tariff_template_reads')
union all select 'polítiques RLS', count(*) from pg_policies where schemaname = 'public' and tablename like 'tariff_template%';
