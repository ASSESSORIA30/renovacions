-- 004 · sips_cache enriquida (fusió Renewal Intelligence Pro + Energy Intelligence Pro)
-- Incremental i idempotent: NO elimina ni recrea la taula existent. Es pot executar més d'una vegada.
-- Projecte correcte: supabase-copper-ferry (https://rifotccaxuahijyixhup.supabase.co).

-- 0. La taula base (si en algun entorn encara no existeix). Estructura idèntica a la creada a producció.
create table if not exists public.sips_cache (
  cups text primary key,
  returned_cups text,
  annual_kwh numeric,
  tariff text,
  address text,
  status text not null default 'found' check (status in ('found', 'not_found', 'error')),
  error text,
  consulted_at timestamptz not null default now()
);

-- 1. Dades completes de l'exportació SIPS (97 columnes, {capçalera: valor}). Font de veritat per a la fitxa.
alter table public.sips_cache add column if not exists raw jsonb;

-- 2. Camps estructurats (consultes i filtres sense desplegar el JSON)
alter table public.sips_cache add column if not exists energy_type text;          -- 'luz' | 'gas' (TipoEnergia del SIPS)
alter table public.sips_cache add column if not exists distributor text;
alter table public.sips_cache add column if not exists retailer text;
alter table public.sips_cache add column if not exists postal_code text;
alter table public.sips_cache add column if not exists city text;
alter table public.sips_cache add column if not exists province text;
alter table public.sips_cache add column if not exists voltage_v numeric;
alter table public.sips_cache add column if not exists contracted_power_kw jsonb;      -- [P1..P6] kW, null = sense dada
alter table public.sips_cache add column if not exists monthly_kwh jsonb;              -- [gen..des] kWh actius
alter table public.sips_cache add column if not exists monthly_max_kw jsonb;           -- [gen..des] potència màxima registrada
alter table public.sips_cache add column if not exists monthly_reactive_kvarh jsonb;   -- [gen..des] kVArh
alter table public.sips_cache add column if not exists annual_reactive_kvarh numeric;
alter table public.sips_cache add column if not exists max_power_year_kw numeric;
alter table public.sips_cache add column if not exists max_power_bie_kw numeric;
alter table public.sips_cache add column if not exists max_power_apm_kw numeric;
alter table public.sips_cache add column if not exists last_reading_date date;
alter table public.sips_cache add column if not exists data_availability jsonb;        -- {level, annualKwh, monthsKwh, ...}

-- 3. Procedència i control de consultes
alter table public.sips_cache add column if not exists source text not null default 'sips';
alter table public.sips_cache add column if not exists source_detail text;
alter table public.sips_cache add column if not exists attempts integer not null default 0;
alter table public.sips_cache add column if not exists next_retry_at timestamptz;
alter table public.sips_cache add column if not exists last_success_at timestamptz;
alter table public.sips_cache add column if not exists last_error_at timestamptz;

-- 4. Validacions (afegides només si no existeixen)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sips_cache_source_chk') then
    alter table public.sips_cache add constraint sips_cache_source_chk check (source in ('sips', 'excel'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sips_cache_energy_chk') then
    alter table public.sips_cache add constraint sips_cache_energy_chk check (energy_type is null or energy_type in ('luz', 'gas'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sips_cache_cups_chk') then
    -- clau = base de 20 caràcters (sense sufix opcional). NOT VALID: no bloqueja files antigues.
    alter table public.sips_cache add constraint sips_cache_cups_chk check (cups ~ '^ES[0-9]{16}[A-Z]{2}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sips_cache_arrays_chk') then
    alter table public.sips_cache add constraint sips_cache_arrays_chk check (
      (contracted_power_kw is null or (jsonb_typeof(contracted_power_kw) = 'array' and jsonb_array_length(contracted_power_kw) = 6)) and
      (monthly_kwh is null or (jsonb_typeof(monthly_kwh) = 'array' and jsonb_array_length(monthly_kwh) = 12)) and
      (monthly_max_kw is null or (jsonb_typeof(monthly_max_kw) = 'array' and jsonb_array_length(monthly_max_kw) = 12)) and
      (monthly_reactive_kvarh is null or (jsonb_typeof(monthly_reactive_kvarh) = 'array' and jsonb_array_length(monthly_reactive_kvarh) = 12)) and
      (raw is null or jsonb_typeof(raw) = 'object')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sips_cache_values_chk') then
    alter table public.sips_cache add constraint sips_cache_values_chk check (
      (annual_kwh is null or annual_kwh >= 0) and attempts >= 0
    ) not valid;
  end if;
end $$;

create index if not exists sips_cache_consulted_idx on public.sips_cache (consulted_at);
create index if not exists sips_cache_retry_idx on public.sips_cache (next_retry_at) where next_retry_at is not null;
create index if not exists sips_cache_status_idx on public.sips_cache (status);

-- 5. Seguretat: RLS activat i cap accés directe des del navegador (només la service role, des del servidor,
--    després de validar que l'usuari pot veure el CUPS).
alter table public.sips_cache enable row level security;
revoke all on public.sips_cache from anon, authenticated;

-- 6. Índex per comprovar la visibilitat d'un CUPS per prefix (20/22 caràcters)
create index if not exists contracts_cups_prefix_idx on public.contracts (upper(cups) text_pattern_ops);
