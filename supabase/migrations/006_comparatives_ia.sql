-- 006 · COMPARATIVES IA: catàleg de tarifes versionat, importacions, connectors, comparatives,
-- documents, enviaments, enllaços privats, comissions i factures.
-- Incremental i idempotent. Reversió: 006_comparatives_ia_down.sql (només elimina el que crea aquest fitxer).
-- Requereix 001–003 (funcions is_admin, is_staff, can_see, audit).

-- =============================================================== catàleg
create table if not exists public.tariff_suppliers (
  id text primary key,                         -- 'sup:<slug>'
  name text not null,
  logo text,                                   -- data URL petit o ruta de Storage
  website text,
  created_at timestamptz not null default now()
);

create table if not exists public.tariff_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id text not null references public.tariff_suppliers on delete restrict,
  name text not null,
  energy_type text not null check (energy_type in ('luz', 'gas')),
  access_tariff text not null,
  product_key text not null unique,            -- comercialitzadora|producte|peatge|energia (deduplicació)
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Cada actualització crea una VERSIÓ nova. Els preus per període són a `data` (OfferVersion validat amb zod)
-- i es poden consultar per separat amb la vista tariff_prices_v.
create table if not exists public.tariff_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.tariff_products on delete restrict,
  version integer not null check (version >= 1),
  status text not null default 'esborrany' check (status in ('esborrany', 'activa', 'caducada', 'arxivada')),
  origin text not null check (origin in ('manual', 'excel', 'api')),
  data jsonb not null check (jsonb_typeof(data) = 'object' and jsonb_typeof(data->'energy') = 'array' and jsonb_typeof(data->'power') = 'array'),
  valid_from date,
  valid_to date,
  source text,
  import_run_id uuid,
  connector_run_id bigint,
  used_at timestamptz,                         -- primera proposta emesa que l'ha fet servir → immutable
  created_by uuid references auth.users default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (product_id, version),
  check (valid_from is null or valid_to is null or valid_from <= valid_to)
);
create index if not exists tariff_versions_status_idx on public.tariff_versions (status, valid_to);
create index if not exists tariff_versions_product_idx on public.tariff_versions (product_id, version desc);

-- Versions usades en propostes emeses: no es poden modificar (només arxivar/caducar) ni esborrar.
create or replace function public.protect_used_tariff() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.used_at is not null then raise exception 'Versió de tarifa usada en propostes: no es pot esborrar (arxiva-la)'; end if;
    return old;
  end if;
  if old.used_at is not null and (new.data is distinct from old.data or new.version <> old.version or new.product_id <> old.product_id) then
    raise exception 'Versió de tarifa usada en propostes: és immutable. Crea una versió nova.';
  end if;
  return new;
end $$;
drop trigger if exists protect_used_tariff_trg on public.tariff_versions;
create trigger protect_used_tariff_trg before update or delete on public.tariff_versions for each row execute function public.protect_used_tariff();
drop trigger if exists audit_tariff_versions on public.tariff_versions;
create trigger audit_tariff_versions after insert or update or delete on public.tariff_versions for each row execute function public.audit();

-- Preus per període (lectura)
create or replace view public.tariff_prices_v with (security_invoker = true) as
  select v.id as version_id, v.product_id, v.version, v.status, p.n as period,
         nullif(v.data->'energy'->>(p.n - 1), '')::numeric as energy_eur_kwh,
         nullif(v.data->'power'->>(p.n - 1), '')::numeric as power_price,
         v.data->>'powerUnit' as power_unit
  from public.tariff_versions v cross join generate_series(1, 6) as p(n);

create table if not exists public.tariff_import_templates (
  id uuid primary key default gen_random_uuid(),
  supplier_name text,
  name text not null,
  header_row integer not null default 0,
  mapping jsonb not null,
  default_power_unit text,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.tariff_import_runs (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  supplier_name text,
  mapping jsonb,
  dry_run boolean not null default false,
  counts jsonb not null,                       -- nova / modificada / sense_canvis / rebutjada / revisio / duplicada
  report jsonb not null,                       -- errors i avisos per fila
  created_by uuid references auth.users default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.tariff_connector_runs (
  id bigserial primary key,
  provider_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  attempt integer not null default 1,
  fetched integer, created integer, changed integer, retired integer, rejected integer,
  error text
);
create index if not exists tariff_connector_runs_idx on public.tariff_connector_runs (provider_id, started_at desc);

-- Comissions i marges: NOMÉS administradors. Mai entren al rànquing ni al PDF del client.
create table if not exists public.offer_commissions (
  product_id uuid primary key references public.tariff_products on delete cascade,
  company_eur_mwh numeric check (company_eur_mwh is null or company_eur_mwh >= 0),
  company_fixed_eur numeric check (company_fixed_eur is null or company_fixed_eur >= 0),
  salesperson_pct numeric check (salesperson_pct is null or (salesperson_pct >= 0 and salesperson_pct <= 100)),
  notes text,
  updated_by uuid references auth.users default auth.uid(),
  updated_at timestamptz not null default now()
);

-- =============================================================== comparatives
create table if not exists public.comparisons (
  id uuid primary key default gen_random_uuid(),
  contract_id text references public.contracts on delete set null,
  cups text,
  client_name text,
  mode text not null check (mode in ('factura', 'cups', 'cups_preus', 'manual', 'massiva')),
  status text not null default 'esborrany' check (status in ('esborrany', 'emesa', 'enviada', 'arxivada')),
  engine_version text not null,
  snapshot jsonb not null,                     -- dades, ofertes copiades, fiscalitat, ponderacions i resultat
  recommendation jsonb,                        -- text IA, text editat i historial de canvis
  created_by uuid references auth.users default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz
);
create index if not exists comparisons_contract_idx on public.comparisons (contract_id, created_at desc);
create index if not exists comparisons_creator_idx on public.comparisons (created_by, created_at desc);

-- Una comparativa emesa conserva sempre els preus i resultats amb què es va calcular.
create or replace function public.protect_issued_comparison() returns trigger language plpgsql as $$
begin
  if old.status in ('emesa', 'enviada') and new.snapshot is distinct from old.snapshot then
    raise exception 'Comparativa emesa: els càlculs són immutables. Duplica-la per fer-ne una de nova.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists protect_issued_comparison_trg on public.comparisons;
create trigger protect_issued_comparison_trg before update on public.comparisons for each row execute function public.protect_issued_comparison();

create table if not exists public.comparison_documents (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons on delete cascade,
  kind text not null check (kind in ('resum', 'detallada')),
  lang text not null check (lang in ('ca', 'es')),
  storage_path text not null,
  sha256 text,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.comparison_deliveries (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp', 'enllac')),
  recipient text,
  subject text,
  status text not null check (status in ('preparat', 'enviat', 'error')),
  message_id text,
  error text,
  document_id uuid references public.comparison_documents on delete set null,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);

-- Enllaços privats del portal de propostes (només es desa el hash del token).
create table if not exists public.comparison_shares (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  views integer not null default 0,
  last_view_at timestamptz,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.comparison_share_events (
  id bigserial primary key,
  share_id uuid not null references public.comparison_shares on delete cascade,
  kind text not null check (kind in ('vista', 'interes', 'aclariment')),
  payload jsonb,
  at timestamptz not null default now()
);

-- Factures pujades (bucket privat 'invoices'). Retenció per defecte: 90 dies.
create table if not exists public.invoice_uploads (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_name text,
  mime text,
  size_bytes integer,
  sha256 text,
  status text not null default 'pujada' check (status in ('pujada', 'processant', 'extreta', 'error', 'esborrada')),
  method text,                                 -- text / ia / mixt
  extraction jsonb,
  error text,
  duration_ms integer,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);

-- =============================================================== RLS
alter table public.tariff_suppliers enable row level security;
alter table public.tariff_products enable row level security;
alter table public.tariff_versions enable row level security;
alter table public.tariff_import_templates enable row level security;
alter table public.tariff_import_runs enable row level security;
alter table public.tariff_connector_runs enable row level security;
alter table public.offer_commissions enable row level security;
alter table public.comparisons enable row level security;
alter table public.comparison_documents enable row level security;
alter table public.comparison_deliveries enable row level security;
alter table public.comparison_shares enable row level security;
alter table public.comparison_share_events enable row level security;
alter table public.invoice_uploads enable row level security;

-- Catàleg: lectura per a tots els usuaris autenticats; escriptura per a l'equip d'administració.
drop policy if exists p_tsup_read on public.tariff_suppliers;
create policy p_tsup_read on public.tariff_suppliers for select to authenticated using (true);
drop policy if exists p_tsup_staff on public.tariff_suppliers;
create policy p_tsup_staff on public.tariff_suppliers for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists p_tprod_read on public.tariff_products;
create policy p_tprod_read on public.tariff_products for select to authenticated using (true);
drop policy if exists p_tprod_staff on public.tariff_products;
create policy p_tprod_staff on public.tariff_products for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists p_tver_read on public.tariff_versions;
create policy p_tver_read on public.tariff_versions for select to authenticated using (status in ('activa', 'caducada') or public.is_staff());
drop policy if exists p_tver_staff on public.tariff_versions;
create policy p_tver_staff on public.tariff_versions for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists p_timp_staff on public.tariff_import_templates;
create policy p_timp_staff on public.tariff_import_templates for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists p_truns_staff on public.tariff_import_runs;
create policy p_truns_staff on public.tariff_import_runs for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists p_tconn_staff on public.tariff_connector_runs;
create policy p_tconn_staff on public.tariff_connector_runs for select to authenticated using (public.is_staff());
drop policy if exists p_comm_admin on public.offer_commissions;
create policy p_comm_admin on public.offer_commissions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Comparatives: les veu qui les ha creat, l'equip d'administració o qui pot veure el contracte vinculat.
create or replace function public.can_see_comparison(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from comparisons c where c.id = p_id and (c.created_by = auth.uid() or public.is_staff() or (c.contract_id is not null and public.can_see(c.contract_id))));
$$;
drop policy if exists p_cmp_read on public.comparisons;
create policy p_cmp_read on public.comparisons for select to authenticated using (created_by = auth.uid() or public.is_staff() or (contract_id is not null and public.can_see(contract_id)));
drop policy if exists p_cmp_insert on public.comparisons;
create policy p_cmp_insert on public.comparisons for insert to authenticated with check (created_by = auth.uid() and (contract_id is null or public.can_see(contract_id)));
drop policy if exists p_cmp_update on public.comparisons;
create policy p_cmp_update on public.comparisons for update to authenticated using (created_by = auth.uid() or public.is_staff()) with check (contract_id is null or public.can_see(contract_id));
drop policy if exists p_cdoc_rw on public.comparison_documents;
create policy p_cdoc_rw on public.comparison_documents for all to authenticated using (public.can_see_comparison(comparison_id)) with check (public.can_see_comparison(comparison_id));
drop policy if exists p_cdel_rw on public.comparison_deliveries;
create policy p_cdel_rw on public.comparison_deliveries for all to authenticated using (public.can_see_comparison(comparison_id)) with check (public.can_see_comparison(comparison_id));
drop policy if exists p_cshare_rw on public.comparison_shares;
create policy p_cshare_rw on public.comparison_shares for all to authenticated using (public.can_see_comparison(comparison_id)) with check (public.can_see_comparison(comparison_id));
drop policy if exists p_cshev_read on public.comparison_share_events;
create policy p_cshev_read on public.comparison_share_events for select to authenticated using (exists (select 1 from comparison_shares s where s.id = share_id and public.can_see_comparison(s.comparison_id)));
drop policy if exists p_inv_own on public.invoice_uploads;
create policy p_inv_own on public.invoice_uploads for all to authenticated using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid());

-- =============================================================== Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/tiff'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('proposals', 'proposals', false) on conflict (id) do nothing;
-- Factures: cada usuari només pot pujar, llegir i esborrar a la seva carpeta (<uid>/…).
drop policy if exists p_invoices_own on storage.objects;
create policy p_invoices_own on storage.objects for all to authenticated
  using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);
-- PDFs de propostes: es desen i se signen des del servidor (service role); cap accés directe.
