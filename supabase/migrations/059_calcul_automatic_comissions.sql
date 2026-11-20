-- =====================================================================================================
-- 059 · CÀLCUL AUTOMÀTIC DE COMISSIONS I REGULARITZACIÓ HISTÒRICA
-- =====================================================================================================
-- Additiva, idempotent i reversible (059_calcul_automatic_comissions_down.sql).
-- NO modifica ni esborra cap dada existent. NO toca fin_rules, fin_calculations, fin_ledger, fin_settlements,
-- fin_settlement_lines, fin_payments, crm_contract_finance, crm_commission_records ni fin_hist_*.
--
-- Afegeix NOMÉS:
--   · fin_calc_pending          : contractes desats als quals el càlcul automàtic ha fallat (pendent de reintent).
--   · fin_regularization_runs   : execucions de la regularització (simulació «dry_run» i aplicació «apply»).
--   · fin_regularization_items  : resultat per contracte de cada execució (categoria, motius, acció feta).
-- Només el servidor hi escriu (client de servei). Direcció i Administració autoritzada ho poden llegir.
-- =====================================================================================================

-- ------------------------------------------------------------------ 1. càlculs pendents per error
create table if not exists public.fin_calc_pending (
  contract_id uuid primary key references public.crm_contracts (id) on delete cascade,
  status text not null default 'error' check (status in ('error', 'resolt')),
  source text check (source is null or source in ('alta', 'renovacio', 'edicio', 'regularitzacio')),
  last_error text,
  attempts integer not null default 1 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_calc_pending_status_idx on public.fin_calc_pending (status) where status = 'error';

-- ------------------------------------------------------------------ 2. execucions de la regularització
create table if not exists public.fin_regularization_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('dry_run', 'apply')),
  status text not null default 'en_curs' check (status in ('en_curs', 'completat')),
  based_on uuid references public.fin_regularization_runs (id) on delete restrict,   -- apply → revisió en què es basa
  started_by uuid references auth.users (id) on delete set null,
  started_by_name text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cursor uuid,
  counts jsonb not null default '{}',
  check (mode = 'dry_run' or based_on is not null)
);
create index if not exists fin_reg_runs_started_idx on public.fin_regularization_runs (started_at desc);

create table if not exists public.fin_regularization_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.fin_regularization_runs (id) on delete cascade,
  contract_id uuid not null references public.crm_contracts (id) on delete cascade,
  category text not null check (category in ('calculable', 'pendent_dades', 'pendent_regla', 'protegit', 'conflicte')),
  reasons text[] not null default '{}',
  provider_status text,
  provider_amount numeric(14, 2),
  action text not null check (action in ('revisat', 'regularitzat', 'marcat_pendent', 'omes_protegit', 'omes_ja_calculat', 'error')),
  created_at timestamptz not null default now(),
  unique (run_id, contract_id)
);
create index if not exists fin_reg_items_run_idx on public.fin_regularization_items (run_id, category);

-- ------------------------------------------------------------------ 3. seguretat (RLS)
alter table public.fin_calc_pending enable row level security;
alter table public.fin_regularization_runs enable row level security;
alter table public.fin_regularization_items enable row level security;

drop policy if exists p_fin_calc_pending_select on public.fin_calc_pending;
create policy p_fin_calc_pending_select on public.fin_calc_pending for select to authenticated using (public.is_staff());
drop policy if exists p_fin_reg_runs_select on public.fin_regularization_runs;
create policy p_fin_reg_runs_select on public.fin_regularization_runs for select to authenticated using (public.is_admin());
drop policy if exists p_fin_reg_items_select on public.fin_regularization_items;
create policy p_fin_reg_items_select on public.fin_regularization_items for select to authenticated using (public.is_admin());
-- sense polítiques d'escriptura: només el servidor (client de servei) hi escriu

-- ------------------------------------------------------------------ 4. comprovació
-- select table_name from information_schema.tables where table_schema = 'public'
--   and table_name in ('fin_calc_pending', 'fin_regularization_runs', 'fin_regularization_items');   -- ha de tornar 3 files
