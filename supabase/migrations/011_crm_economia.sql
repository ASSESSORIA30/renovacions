-- 011 · CRM FASE 4: CONTROL ECONÒMIC, COMISSIONS, LIQUIDACIONS I CONCILIACIÓ
-- Additiva i idempotent: no esborra ni reescriu cap dada existent. Reversible amb 011_crm_economia_down.sql.
-- Requereix les migracions 008, 009 i 010.
--
-- Principis:
--   · Diners sempre en NUMERIC(14,2) (imports) o NUMERIC(14,6) (preus i tarifes). Arrodoniment a cèntims, mig cap amunt.
--   · Dues capes diferents: A) el que la comercialitzadora paga a Assessoria 3.0 (capa «proveidor»)
--     i B) el que Assessoria 3.0 paga als comercials i col·laboradors (capes «comercial», «collaborador», «incentiu»).
--     El motor no fa servir mai una regla d'una capa per calcular l'altra.
--   · Estimat ≠ meritat ≠ confirmat pel proveïdor ≠ cobrat. Un import comunicat en un fitxer no és un cobrament.
--   · Llibre de moviments (fin_ledger) només d'afegir: les correccions són moviments nous (ajustaments, retrocessions).
--   · Les regles aprovades són immutables: modificar-les crea una versió nova; els càlculs guarden la versió aplicada.
--   · Liquidacions ESBORRANY → REVISIÓ → APROVADA → PAGADA. Aprovar bloqueja els imports; ningú aprova la seva pròpia.
--   · Retencions, cotitzacions i nòmines NO es calculen (no hi ha configuració laboral i fiscal validada).

create or replace function public.fin_can_manage_rules() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'cap_administrativa'), false);
$$;

-- ============================================================ regles de comissió (una fila per versió)
create table if not exists public.fin_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null check (rule_key ~ '^[a-z0-9_]{3,60}$'),
  version integer not null default 1 check (version >= 1),
  name text not null check (length(trim(name)) between 1 and 160),
  layer text not null check (layer in ('proveidor', 'comercial', 'collaborador', 'incentiu')),
  retailer text,
  product text,
  service text check (service is null or service in ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes')),
  segment text check (segment is null or segment in ('residencial', 'pime', 'gran_consum')),
  beneficiary_id uuid references auth.users (id) on delete set null,       -- regla específica d'un comercial o col·laborador
  kind text not null check (kind in ('fix_contracte', 'per_mwh', 'pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'trams_volum', 'bonificacio', 'regularitzacio', 'retrocessio')),
  value numeric(14, 6) check (value is null or value >= 0),
  unit text not null check (unit in ('eur', 'eur_mwh', 'pct')),
  tiers jsonb,                                   -- [{"threshold": 5, "amount": 50}, …] per a trams
  conditions jsonb not null default '{}',        -- meritació, base de càlcul, període i criteri dels trams…
  base_formula text,                             -- fórmula explícita de la base (obligatòria per als percentatges)
  base_validated boolean not null default false, -- sense base validada: «Pendent de configuració»
  valid_from date not null default current_date,
  valid_to date,
  status text not null default 'esborrany' check (status in ('esborrany', 'pendent_aprovacio', 'aprovada', 'retirada')),
  notes text,
  is_seed boolean not null default false,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_key, version),
  check (valid_to is null or valid_to >= valid_from),
  check ((kind = 'trams_volum') = (tiers is not null)),
  check (kind = 'trams_volum' or value is not null),
  check (layer <> 'incentiu' or kind in ('trams_volum', 'bonificacio')),
  check (unit = case when kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'retrocessio') then 'pct' when kind = 'per_mwh' then 'eur_mwh' else 'eur' end)
);
create index if not exists fin_rules_match_idx on public.fin_rules (layer, status, valid_from);

-- Regles inicials d'Assessoria 3.0: editables i PENDENTS D'APROVACIÓ (no calculen res de definitiu fins que Direcció les aprovi).
-- Interpretació: totes són comissions que Assessoria 3.0 paga a l'equip comercial (capa B). La capa A (el que paga la
-- comercialitzadora) s'ha de configurar a part; no s'ha inventat cap import de proveïdor.
insert into public.fin_rules (rule_key, name, layer, retailer, product, service, segment, kind, value, unit, tiers, conditions, base_formula, base_validated, status, notes, is_seed)
select * from (values
  ('res_llum_fix', 'Electricitat residencial · fix per contracte', 'comercial', null, null, 'llum_residencial', 'residencial', 'fix_contracte', 15::numeric, 'eur', null::jsonb, '{"accrual_event": "activacio"}'::jsonb, null, true, 'pendent_aprovacio', 'Regla inicial (5.1). No es paga en crear l''expedient: es merita segons la condició aprovada.', true),
  ('res_gas_fix', 'Gas residencial · fix per contracte', 'comercial', null, null, 'gas', 'residencial', 'fix_contracte', 10, 'eur', null, '{"accrual_event": "activacio"}', null, true, 'pendent_aprovacio', 'Regla inicial (5.1).', true),
  ('nufri_fuji', 'Nufri Fuji · €/MWh', 'comercial', 'Nufri', 'Fuji', null, null, 'per_mwh', 2, 'eur_mwh', null, '{"accrual_event": "activacio", "volume": "mwh_elegibles"}', 'MWh contractuals elegibles × €/MWh', true, 'pendent_aprovacio', 'Regla inicial (5.2). Cal confirmar quin volum és elegible segons el contracte.', true),
  ('nufri_golden', 'Nufri Golden · €/MWh', 'comercial', 'Nufri', 'Golden', null, null, 'per_mwh', 6, 'eur_mwh', null, '{"accrual_event": "activacio", "volume": "mwh_elegibles"}', 'MWh contractuals elegibles × €/MWh', true, 'pendent_aprovacio', 'Regla inicial (5.2).', true),
  ('nufri_gala', 'Nufri Gala · €/MWh', 'comercial', 'Nufri', 'Gala', null, null, 'per_mwh', 10, 'eur_mwh', null, '{"accrual_event": "activacio", "volume": "mwh_elegibles"}', 'MWh contractuals elegibles × €/MWh', true, 'pendent_aprovacio', 'Regla inicial (5.2). Exemple: 200 MWh × 10 €/MWh = 2.000 € (simulació, no cobrament).', true),
  ('nufri_galaxy', 'Nufri Galaxy · €/MWh', 'comercial', 'Nufri', 'Galaxy', null, null, 'per_mwh', 15, 'eur_mwh', null, '{"accrual_event": "activacio", "volume": "mwh_elegibles"}', 'MWh contractuals elegibles × €/MWh', true, 'pendent_aprovacio', 'Regla inicial (5.2).', true),
  ('nufri_royal', 'Nufri Royal · €/MWh', 'comercial', 'Nufri', 'Royal', null, null, 'per_mwh', 20, 'eur_mwh', null, '{"accrual_event": "activacio", "volume": "mwh_elegibles"}', 'MWh contractuals elegibles × €/MWh', true, 'pendent_aprovacio', 'Regla inicial (5.2).', true),
  ('novaluz_valor_afegit', 'Novaluz · 12,5 % del valor afegit', 'comercial', 'Novaluz', null, null, null, 'pct_marge', 12.5, 'pct', null, '{"accrual_event": "activacio", "include_energy": true, "include_power": true}',
   'Valor afegit = (increment pactat €/kWh × kWh elegibles) + (increment pactat €/kW·dia × kW contractats × dies del període). Comissió = 12,5 % × valor afegit.', true, 'pendent_aprovacio', 'Regla inicial (5.3). Cal confirmar que l''acord vigent inclou energia i potència.', true),
  ('iberdrola_pct', 'Iberdrola · 12,5 % (base pendent)', 'comercial', 'Iberdrola', null, null, null, 'pct_marge', 12.5, 'pct', null, '{"accrual_event": "activacio"}', null, false, 'pendent_aprovacio', 'Regla inicial (5.4). La base de càlcul no està validada: el càlcul queda «Pendent de configuració».', true),
  ('incentiu_residencial', 'Incentiu residencial per trams', 'incentiu', null, null, null, 'residencial', 'trams_volum', null, 'eur', '[{"threshold": 5, "amount": 50}, {"threshold": 10, "amount": 150}, {"threshold": 15, "amount": 250}, {"threshold": 20, "amount": 400}]',
   '{"metric": "contractes", "basis": "activat", "policy": "maxim", "period": "mes"}', null, true, 'pendent_aprovacio', 'Regla inicial (5.5). S''aplica només el tram més alt assolit dins el període (no la suma).', true),
  ('incentiu_fibra_o2', 'Fibra O2 · incentiu per trams', 'incentiu', 'O2', null, 'fibra_telefonia', null, 'trams_volum', null, 'eur', '[{"threshold": 3, "amount": 50}, {"threshold": 7, "amount": 150}, {"threshold": 11, "amount": 300}]',
   '{"metric": "contractes", "basis": "activat", "policy": "maxim", "period": "mes"}', null, true, 'pendent_aprovacio', 'Regla inicial (5.6).', true),
  ('incentiu_pimes_mwh', 'Pimes · 100 MWh elegibles', 'incentiu', null, null, null, 'pime', 'trams_volum', null, 'eur', '[{"threshold": 100, "amount": 50}]',
   '{"metric": "mwh", "basis": "activat", "policy": "maxim", "period": "mes"}', null, true, 'pendent_aprovacio', 'Regla inicial (5.7). Cal confirmar la periodicitat i l''elegibilitat.', true),
  ('segurma_alarma', 'SEGURMA · alarma', 'comercial', 'Segurma', null, 'alarmes', null, 'fix_contracte', 50, 'eur', null, '{"accrual_event": "activacio"}', null, true, 'pendent_aprovacio', 'Regla inicial (5.8).', true)
) as v(rule_key, name, layer, retailer, product, service, segment, kind, value, unit, tiers, conditions, base_formula, base_validated, status, notes, is_seed)
where not exists (select 1 from public.fin_rules);

-- ============================================================ dades econòmiques del contracte (entrades del càlcul)
create table if not exists public.fin_contract_economics (
  contract_id uuid primary key references public.crm_contracts (id) on delete cascade,
  segment text check (segment is null or segment in ('residencial', 'pime', 'gran_consum')),
  product_modality text,                                            -- p. ex. modalitat Nufri (Gala)
  eligible_mwh numeric(14, 3) check (eligible_mwh is null or eligible_mwh >= 0),
  energy_increment_eur_kwh numeric(14, 6) check (energy_increment_eur_kwh is null or energy_increment_eur_kwh >= 0),
  power_increment_eur_kw_day numeric(14, 6) check (power_increment_eur_kw_day is null or power_increment_eur_kw_day >= 0),
  economic_months integer not null default 12 check (economic_months between 1 and 120),
  econ_status text not null default 'actiu' check (econ_status in ('actiu', 'anullat', 'penalitzat')),
  cancelled_at date,
  cancel_reason text,
  notes text,
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  check (econ_status = 'actiu' or cancelled_at is not null)
);

-- ============================================================ càlculs (instantànies immutables)
create table if not exists public.fin_calculations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.crm_contracts (id) on delete restrict,
  layer text not null check (layer in ('proveidor', 'comercial', 'collaborador')),
  beneficiary_id uuid references auth.users (id),
  rule_id uuid references public.fin_rules (id) on delete restrict,
  rule_key text,
  rule_version integer,
  status text not null check (status in ('calculat', 'simulacio', 'pendent_configuracio', 'pendent_dades', 'sense_regla')),
  amount numeric(14, 2),
  inputs jsonb not null,
  breakdown jsonb not null,
  formula text,
  calc_hash text not null,
  is_current boolean not null default true,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (layer = 'proveidor' or beneficiary_id is not null or status = 'sense_regla'),
  check ((status in ('calculat', 'simulacio')) = (amount is not null))
);
create unique index if not exists fin_calc_hash_uq on public.fin_calculations (contract_id, layer, coalesce(beneficiary_id, '00000000-0000-0000-0000-000000000000'::uuid), calc_hash);
create index if not exists fin_calc_current_idx on public.fin_calculations (contract_id, layer) where is_current;

-- ============================================================ liquidacions (comercials i col·laboradors)
create sequence if not exists public.fin_settlement_seq;
create table if not exists public.fin_settlements (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  kind text not null check (kind in ('comercial', 'collaborador')),
  beneficiary_id uuid not null references auth.users (id) on delete restrict,
  period_from date not null,
  period_to date not null,
  status text not null default 'esborrany' check (status in ('esborrany', 'revisio', 'aprovada', 'pagada', 'anullada')),
  total_fixed numeric(14, 2) not null default 0,
  total_variable numeric(14, 2) not null default 0,
  total_bonus numeric(14, 2) not null default 0,
  total_cancellations numeric(14, 2) not null default 0,
  total_adjustments numeric(14, 2) not null default 0,
  total_gross numeric(14, 2) not null default 0,
  approved_amount numeric(14, 2),
  paid_amount numeric(14, 2) not null default 0,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_to >= period_from),
  check (paid_amount >= 0 and (approved_amount is null or paid_amount <= approved_amount))
);
create unique index if not exists fin_settlements_open_uq on public.fin_settlements (kind, beneficiary_id, period_from, period_to) where status <> 'anullada';

-- ============================================================ conciliació amb les comercialitzadores
create table if not exists public.fin_provider_statements (
  id uuid primary key default gen_random_uuid(),
  retailer text not null,
  reference text not null check (length(trim(reference)) between 1 and 120),
  period_from date,
  period_to date,
  received_at date not null default current_date,
  declared_total numeric(14, 2),
  source text not null default 'manual' check (source in ('manual', 'fitxer')),
  file_name text,
  status text not null default 'registrada' check (status in ('registrada', 'en_conciliacio', 'conciliada')),
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists fin_statements_ref_uq on public.fin_provider_statements (lower(retailer), reference);

create table if not exists public.fin_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.fin_provider_statements (id) on delete cascade,
  line_no integer not null,
  cups text,
  contract_ref text,
  external_ref text,
  client_name text,
  concept text,
  amount numeric(14, 2) not null,                 -- import COMUNICAT pel proveïdor (no és un cobrament)
  kind text not null default 'comissio' check (kind in ('comissio', 'retrocessio', 'ajustament', 'regularitzacio')),
  contract_id uuid references public.crm_contracts (id) on delete set null,
  expected_amount numeric(14, 2),
  difference numeric(14, 2),
  match_status text not null default 'pendent' check (match_status in ('pendent', 'identificat', 'conciliat', 'diferencia', 'duplicat', 'no_identificat', 'descartat')),
  line_hash text not null,
  duplicate_of uuid references public.fin_statement_lines (id) on delete set null,
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  note text,
  unique (statement_id, line_no)
);
create index if not exists fin_lines_hash_idx on public.fin_statement_lines (line_hash);
create index if not exists fin_lines_contract_idx on public.fin_statement_lines (contract_id);

-- cobraments REALS rebuts (confirmats per Administració amb la referència bancària)
create table if not exists public.fin_provider_receipts (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid references public.fin_provider_statements (id) on delete restrict,
  retailer text not null,
  amount numeric(14, 2) not null check (amount > 0),
  received_at date not null,
  bank_reference text not null check (length(trim(bank_reference)) between 1 and 120),
  allocated numeric(14, 2) not null default 0,
  idempotency_key text not null unique,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================ llibre de moviments econòmics (només d'afegir)
create table if not exists public.fin_ledger (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.crm_contracts (id) on delete restrict,
  client_id uuid references public.crm_clients (id) on delete restrict,
  layer text not null check (layer in ('proveidor', 'comercial', 'collaborador')),
  beneficiary_id uuid references auth.users (id) on delete restrict,
  kind text not null check (kind in ('meritacio', 'confirmacio', 'facturacio', 'cobrament', 'bonificacio', 'ajustament', 'regularitzacio', 'retrocessio', 'anullacio')),
  amount numeric(14, 2) not null check (amount <> 0),
  period date not null default current_date,           -- data econòmica del moviment
  description text not null,
  calculation_id uuid references public.fin_calculations (id) on delete restrict,
  rule_id uuid references public.fin_rules (id) on delete restrict,
  statement_line_id uuid references public.fin_statement_lines (id) on delete restrict,
  receipt_id uuid references public.fin_provider_receipts (id) on delete restrict,
  settlement_id uuid references public.fin_settlements (id) on delete set null,
  reverses_id uuid references public.fin_ledger (id) on delete restrict,
  idempotency_key text not null unique,
  created_by uuid references auth.users (id) default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  check ((layer = 'proveidor') = (beneficiary_id is null)),
  check (layer <> 'proveidor' or kind in ('meritacio', 'confirmacio', 'facturacio', 'cobrament', 'ajustament', 'regularitzacio', 'retrocessio', 'anullacio')),
  check (layer = 'proveidor' or kind in ('meritacio', 'bonificacio', 'ajustament', 'regularitzacio', 'retrocessio', 'anullacio')),
  check (kind <> 'cobrament' or (receipt_id is not null and amount > 0))
);
create index if not exists fin_ledger_contract_idx on public.fin_ledger (contract_id, layer);
create index if not exists fin_ledger_benef_idx on public.fin_ledger (beneficiary_id, settlement_id, period);
create index if not exists fin_ledger_period_idx on public.fin_ledger (period);

create table if not exists public.fin_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.fin_settlements (id) on delete cascade,
  ledger_id uuid not null unique references public.fin_ledger (id) on delete restrict,   -- un moviment només es liquida una vegada
  contract_id uuid references public.crm_contracts (id) on delete set null,
  category text not null check (category in ('fixa', 'variable', 'bonificacio', 'anullacio', 'ajustament')),
  description text not null,
  amount numeric(14, 2) not null
);
create index if not exists fin_slines_idx on public.fin_settlement_lines (settlement_id);

create table if not exists public.fin_payments (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.fin_settlements (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  paid_at date not null,
  method text not null default 'transferencia' check (method in ('transferencia', 'nomina', 'efectiu', 'altres')),
  reference text not null check (length(trim(reference)) between 1 and 120),
  idempotency_key text not null unique,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================ costos directes, col·laboradors, objectius i auditoria
create table if not exists public.fin_costs (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.crm_contracts (id) on delete restrict,
  client_id uuid references public.crm_clients (id) on delete restrict,
  concept text not null check (length(trim(concept)) between 1 and 200),
  amount numeric(14, 2) not null check (amount > 0),
  cost_date date not null default current_date,
  note text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (contract_id is not null or client_id is not null)
);

create table if not exists public.fin_collaborator_terms (
  user_id uuid primary key references auth.users (id) on delete cascade,
  legal_name text,
  tax_id text,
  billing_email text,
  conditions text,                               -- condicions comercials pactades (text de l'acord)
  active boolean not null default true,
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fin_targets (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('comercial', 'equip', 'producte')),
  user_id uuid references auth.users (id) on delete cascade,
  product text,
  service text,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  metric text not null check (metric in ('contractes', 'mwh', 'comissio_generada', 'comissio_meritada')),
  target numeric(14, 2) not null check (target >= 0),
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  check ((scope = 'comercial') = (user_id is not null)),
  check (scope <> 'producte' or product is not null or service is not null)
);
create unique index if not exists fin_targets_uq on public.fin_targets (scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(product, ''), coalesce(service, ''), period, metric);

create table if not exists public.fin_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_name text,
  entity text not null,
  entity_id text not null,
  action text not null,
  amount numeric(14, 2),
  detail jsonb
);
create index if not exists fin_audit_entity_idx on public.fin_audit (entity, entity_id, at desc);

-- alertes econòmiques (mateix motor d'automatitzacions)
insert into public.crm_automation_rules (key, name, description, params) values
  ('fin_sense_liquidar', 'Comissió prevista sense liquidar', 'Contractes actius amb comissió del proveïdor estimada i sense cap confirmació després de X dies.', '{"days": 90}'),
  ('fin_diferencia', 'Diferència estimat / confirmat', 'Línies de liquidació del proveïdor amb diferència respecte de l''estimat superior al llindar.', '{"min_eur": 5}'),
  ('fin_anullat_pagat', 'Contracte anul·lat amb comissió pagada', 'Contracte anul·lat amb comissió comercial ja inclosa en una liquidació aprovada o pagada.', '{}'),
  ('fin_pagament_duplicat', 'Possible pagament o cobrament duplicat', 'Mateix import, data i beneficiari, o línia del proveïdor repetida.', '{}'),
  ('fin_liquidacio_pendent', 'Liquidació pendent d''aprovació', 'Liquidacions en revisió des de fa més de X dies.', '{"days": 3}'),
  ('fin_collaborador_saldo', 'Col·laborador amb saldo pendent', 'Liquidacions de col·laboradors aprovades i no pagades del tot després de X dies.', '{"days": 15}'),
  ('fin_objectiu_assolit', 'Objectiu comercial assolit', 'Avisa el comercial i Direcció quan s''assoleix un tram d''incentiu o un objectiu.', '{}'),
  ('fin_possible_retrocessio', 'Possible retrocessió', 'La comercialitzadora comunica una retrocessió d''un contracte amb comissió comercial meritada.', '{}')
on conflict (key) do nothing;

-- ============================================================ triggers
create or replace function public.fin_rule_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status in ('aprovada', 'retirada') then
    -- una regla aprovada no es modifica: només es pot retirar o tancar-ne la vigència (la modificació és una versió nova)
    if (to_jsonb(new) - array['status', 'valid_to', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'valid_to', 'updated_at'])
       or (old.valid_to is not null and new.valid_to is distinct from old.valid_to)
       or (old.status = 'retirada' and new.status <> 'retirada')
       or (old.status = 'aprovada' and new.status not in ('aprovada', 'retirada')) then
      raise exception 'Regla aprovada: no es pot modificar. Crea''n una versió nova.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'aprovada' and (tg_op = 'INSERT' or old.status <> 'aprovada') then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Només Direcció pot aprovar regles de comissió' using errcode = '42501';
    end if;
    if new.kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda') and (not new.base_validated or coalesce(trim(new.base_formula), '') = '') then
      raise exception 'Cal definir i validar la base de càlcul abans d''aprovar un percentatge' using errcode = '23514';
    end if;
    new.approved_by := coalesce(auth.uid(), new.approved_by);
    new.approved_at := now();
  end if;
  if new.kind = 'trams_volum' and (jsonb_typeof(new.tiers) <> 'array' or jsonb_array_length(new.tiers) = 0) then
    raise exception 'Els trams han de ser una llista no buida' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- en aprovar una versió nova, la versió aprovada anterior deixa de ser vigent (es conserva per als càlculs històrics)
create or replace function public.fin_rule_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'aprovada' and (tg_op = 'INSERT' or old.status <> 'aprovada') then
    update fin_rules set valid_to = greatest(valid_from, new.valid_from - 1)
     where rule_key = new.rule_key and id <> new.id and status = 'aprovada' and valid_to is null;
  end if;
  insert into fin_audit (user_id, user_name, entity, entity_id, action, detail)
  values (auth.uid(), (select name from profiles where id = auth.uid()), 'regla', new.id::text,
          case when tg_op = 'INSERT' then 'creacio' when new.status is distinct from old.status then 'estat:' || new.status else 'edicio' end,
          jsonb_build_object('rule_key', new.rule_key, 'version', new.version, 'value', new.value));
  return new;
end $$;

create or replace function public.fin_calc_before() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'is_current') is distinct from (to_jsonb(old) - 'is_current') then
    raise exception 'Els càlculs són immutables (es conserva l''historial).' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.fin_ledger_before() returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Els moviments econòmics no es poden esborrar: registra un ajustament.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'settlement_id') is distinct from (to_jsonb(old) - 'settlement_id') then
    raise exception 'Els moviments econòmics són immutables: registra un ajustament.' using errcode = '42501';
  end if;
  if old.settlement_id is not null and new.settlement_id is distinct from old.settlement_id then
    select status into st from fin_settlements where id = old.settlement_id;
    if st in ('aprovada', 'pagada') then
      raise exception 'Aquest moviment pertany a una liquidació aprovada' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.fin_ledger_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into fin_audit (user_id, user_name, entity, entity_id, action, amount, detail)
  values (auth.uid(), coalesce(new.created_by_name, (select name from profiles where id = auth.uid())), 'moviment', new.id::text, new.kind, new.amount,
          jsonb_build_object('layer', new.layer, 'contract', new.contract_id, 'beneficiary', new.beneficiary_id));
  return new;
end $$;

create or replace function public.fin_settlement_before() returns trigger language plpgsql security definer set search_path = public as $$
declare sums record;
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, 'LIQ-' || to_char(new.period_to, 'YYYY') || '-' || lpad(nextval('public.fin_settlement_seq')::text, 4, '0'));
    if new.status <> 'esborrany' then raise exception 'Una liquidació nova comença en esborrany' using errcode = '23514'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('aprovada', 'pagada') then
      raise exception 'Les liquidacions aprovades no es poden eliminar' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status in ('aprovada', 'pagada') then
    if (new.total_fixed, new.total_variable, new.total_bonus, new.total_cancellations, new.total_adjustments, new.total_gross, new.approved_amount, new.beneficiary_id, new.period_from, new.period_to, new.kind)
       is distinct from (old.total_fixed, old.total_variable, old.total_bonus, old.total_cancellations, old.total_adjustments, old.total_gross, old.approved_amount, old.beneficiary_id, old.period_from, old.period_to, old.kind) then
      raise exception 'Liquidació aprovada: els imports estan bloquejats. Registra un ajustament a la liquidació següent.' using errcode = '42501';
    end if;
    if new.status not in ('aprovada', 'pagada') then
      raise exception 'Una liquidació aprovada no pot tornar enrere' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status then
    if not (old.status, new.status) in (('esborrany', 'revisio'), ('revisio', 'esborrany'), ('revisio', 'aprovada'), ('esborrany', 'anullada'), ('revisio', 'anullada'), ('aprovada', 'pagada')) then
      raise exception 'Canvi d''estat de liquidació no permès: % → %', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'revisio' then new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
    if new.status = 'aprovada' then
      if auth.uid() is not null and not public.is_admin() then
        raise exception 'Només Direcció pot aprovar liquidacions' using errcode = '42501';
      end if;
      if auth.uid() = new.beneficiary_id then
        raise exception 'Ningú no pot aprovar la seva pròpia liquidació' using errcode = '42501';
      end if;
      select coalesce(sum(amount), 0) as total into sums from fin_settlement_lines where settlement_id = new.id;
      if sums.total <> new.total_gross then
        raise exception 'Els totals no quadren amb les línies. Recalcula la liquidació.' using errcode = '23514';
      end if;
      new.approved_amount := new.total_gross;
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
    if new.status = 'pagada' and new.paid_amount < coalesce(new.approved_amount, 0) then
      raise exception 'Encara hi ha saldo pendent de pagar' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.fin_settlement_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update fin_ledger set settlement_id = null where settlement_id = old.id;
    insert into fin_audit (user_id, user_name, entity, entity_id, action, amount) values (auth.uid(), (select name from profiles where id = auth.uid()), 'liquidacio', old.id::text, 'eliminada', old.total_gross);
    return old;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into fin_audit (user_id, user_name, entity, entity_id, action, amount, detail)
    values (auth.uid(), (select name from profiles where id = auth.uid()), 'liquidacio', new.id::text, coalesce('estat:' || new.status, 'creacio'),
            coalesce(new.approved_amount, new.total_gross), jsonb_build_object('code', new.code, 'beneficiary', new.beneficiary_id));
  end if;
  if new.status = 'anullada' and (tg_op = 'INSERT' or old.status <> 'anullada') then
    update fin_ledger set settlement_id = null where settlement_id = new.id;
    delete from fin_settlement_lines where settlement_id = new.id;
  end if;
  return new;
end $$;

create or replace function public.fin_sline_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from fin_settlements where id = coalesce(new.settlement_id, old.settlement_id);
  if st in ('aprovada', 'pagada') then
    raise exception 'Liquidació aprovada: les línies estan bloquejades' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.fin_payment_before() returns trigger language plpgsql security definer set search_path = public as $$
declare s fin_settlements;
begin
  if tg_op <> 'INSERT' then raise exception 'Els pagaments no es modifiquen ni s''esborren: registra un ajustament.' using errcode = '42501'; end if;
  select * into s from fin_settlements where id = new.settlement_id for update;
  if s.status <> 'aprovada' then raise exception 'Només es poden pagar liquidacions aprovades amb saldo pendent' using errcode = '23514'; end if;
  if s.paid_amount + new.amount > s.approved_amount then
    raise exception 'El pagament supera el saldo pendent (%)', s.approved_amount - s.paid_amount using errcode = '23514';
  end if;
  if exists (select 1 from fin_payments p where p.settlement_id = new.settlement_id and p.amount = new.amount and p.paid_at = new.paid_at) then
    raise exception 'Possible pagament duplicat: ja hi ha un pagament del mateix import i data en aquesta liquidació' using errcode = '23505';
  end if;
  return new;
end $$;

create or replace function public.fin_payment_after() returns trigger language plpgsql security definer set search_path = public as $$
declare total numeric(14, 2);
begin
  select coalesce(sum(amount), 0) into total from fin_payments where settlement_id = new.settlement_id;
  update fin_settlements set paid_amount = total,
         status = case when total >= approved_amount then 'pagada' else status end,
         paid_at = case when total >= approved_amount then now() else paid_at end
   where id = new.settlement_id;
  insert into fin_audit (user_id, user_name, entity, entity_id, action, amount, detail)
  values (auth.uid(), (select name from profiles where id = auth.uid()), 'pagament', new.id::text, 'pagament', new.amount, jsonb_build_object('settlement', new.settlement_id, 'reference', new.reference));
  return new;
end $$;

create or replace function public.fin_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;

drop trigger if exists fin_rules_before on public.fin_rules;
create trigger fin_rules_before before insert or update on public.fin_rules for each row execute function public.fin_rule_before();
drop trigger if exists fin_rules_after on public.fin_rules;
create trigger fin_rules_after after insert or update on public.fin_rules for each row execute function public.fin_rule_after();
drop trigger if exists fin_calc_before on public.fin_calculations;
create trigger fin_calc_before before update on public.fin_calculations for each row execute function public.fin_calc_before();
drop trigger if exists fin_ledger_before on public.fin_ledger;
create trigger fin_ledger_before before update or delete on public.fin_ledger for each row execute function public.fin_ledger_before();
drop trigger if exists fin_ledger_after on public.fin_ledger;
create trigger fin_ledger_after after insert on public.fin_ledger for each row execute function public.fin_ledger_after();
drop trigger if exists fin_settlements_before on public.fin_settlements;
create trigger fin_settlements_before before insert or update or delete on public.fin_settlements for each row execute function public.fin_settlement_before();
drop trigger if exists fin_settlements_after on public.fin_settlements;
create trigger fin_settlements_after after insert or update or delete on public.fin_settlements for each row execute function public.fin_settlement_after();
drop trigger if exists fin_slines_guard on public.fin_settlement_lines;
create trigger fin_slines_guard before insert or update or delete on public.fin_settlement_lines for each row execute function public.fin_sline_guard();
drop trigger if exists fin_payments_before on public.fin_payments;
create trigger fin_payments_before before insert or update or delete on public.fin_payments for each row execute function public.fin_payment_before();
drop trigger if exists fin_payments_after on public.fin_payments;
create trigger fin_payments_after after insert on public.fin_payments for each row execute function public.fin_payment_after();
drop trigger if exists fin_econ_touch on public.fin_contract_economics;
create trigger fin_econ_touch before update on public.fin_contract_economics for each row execute function public.fin_touch();
drop trigger if exists fin_targets_touch on public.fin_targets;
create trigger fin_targets_touch before update on public.fin_targets for each row execute function public.fin_touch();
drop trigger if exists fin_collab_touch on public.fin_collaborator_terms;
create trigger fin_collab_touch before update on public.fin_collaborator_terms for each row execute function public.fin_touch();
drop trigger if exists fin_audit_append on public.fin_audit;
create trigger fin_audit_append before update on public.fin_audit for each row execute function public.crm_append_only();

-- ============================================================ operacions transaccionals
-- Crea una liquidació amb tots els moviments pendents del beneficiari fins al final del període (una sola transacció).
create or replace function public.fin_build_settlement(p_kind text, p_beneficiary uuid, p_from date, p_to date, p_notes text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  sid uuid;
  lyr text := case when p_kind = 'comercial' then 'comercial' else 'collaborador' end;
begin
  if not public.is_staff() then raise exception 'Només Administració prepara liquidacions' using errcode = '42501'; end if;
  insert into fin_settlements (kind, beneficiary_id, period_from, period_to, notes, created_by) values (p_kind, p_beneficiary, p_from, p_to, p_notes, auth.uid()) returning id into sid;
  insert into fin_settlement_lines (settlement_id, ledger_id, contract_id, category, description, amount)
  select sid, l.id, l.contract_id,
         case when l.kind = 'bonificacio' then 'bonificacio'
              when l.kind in ('retrocessio', 'anullacio') then 'anullacio'
              when l.kind in ('ajustament', 'regularitzacio') then 'ajustament'
              when r.kind = 'fix_contracte' then 'fixa' else 'variable' end,
         l.description, l.amount
    from fin_ledger l left join fin_rules r on r.id = l.rule_id
   where l.layer = lyr and l.beneficiary_id = p_beneficiary and l.settlement_id is null and l.period <= p_to
   order by l.period, l.created_at;
  update fin_ledger l set settlement_id = sid from fin_settlement_lines s where s.settlement_id = sid and s.ledger_id = l.id;
  perform public.fin_refresh_settlement(sid);
  return sid;
end $$;

create or replace function public.fin_refresh_settlement(p_id uuid) returns void language plpgsql security invoker set search_path = public as $$
begin
  update fin_settlements s set
    total_fixed = coalesce((select sum(amount) from fin_settlement_lines where settlement_id = p_id and category = 'fixa'), 0),
    total_variable = coalesce((select sum(amount) from fin_settlement_lines where settlement_id = p_id and category = 'variable'), 0),
    total_bonus = coalesce((select sum(amount) from fin_settlement_lines where settlement_id = p_id and category = 'bonificacio'), 0),
    total_cancellations = coalesce((select sum(amount) from fin_settlement_lines where settlement_id = p_id and category = 'anullacio'), 0),
    total_adjustments = coalesce((select sum(amount) from fin_settlement_lines where settlement_id = p_id and category = 'ajustament'), 0),
    total_gross = coalesce((select sum(amount) from fin_settlement_lines where settlement_id = p_id), 0)
  where s.id = p_id and s.status in ('esborrany', 'revisio');
end $$;

-- Cobrament REAL d'una comercialitzadora: s'assigna a les línies conciliades pendents de cobrar (una sola transacció).
create or replace function public.fin_register_receipt(p_statement uuid, p_amount numeric, p_date date, p_ref text, p_notes text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  st fin_provider_statements;
  rid uuid;
  remaining numeric(14, 2) := round(p_amount, 2);
  ln record;
  part numeric(14, 2);
begin
  if not public.is_staff() then raise exception 'Només Administració registra cobraments' using errcode = '42501'; end if;
  select * into st from fin_provider_statements where id = p_statement;
  if st.id is null then raise exception 'Liquidació del proveïdor no trobada' using errcode = '23514'; end if;
  insert into fin_provider_receipts (statement_id, retailer, amount, received_at, bank_reference, idempotency_key, notes, created_by)
  values (st.id, st.retailer, round(p_amount, 2), p_date, trim(p_ref), lower(st.retailer) || '|' || lower(trim(p_ref)) || '|' || round(p_amount, 2)::text || '|' || p_date::text, p_notes, auth.uid())
  returning id into rid;
  for ln in
    select l.id, l.contract_id, l.amount - coalesce((select sum(g.amount) from fin_ledger g where g.statement_line_id = l.id and g.kind = 'cobrament'), 0) as pending,
           (select client_id from crm_contracts k where k.id = l.contract_id) as client_id
      from fin_statement_lines l
     where l.statement_id = st.id and l.match_status = 'conciliat' and l.amount > 0
     order by l.line_no
  loop
    exit when remaining <= 0;
    continue when ln.pending <= 0;
    part := least(ln.pending, remaining);
    insert into fin_ledger (contract_id, client_id, layer, kind, amount, period, description, statement_line_id, receipt_id, idempotency_key, created_by, created_by_name)
    values (ln.contract_id, ln.client_id, 'proveidor', 'cobrament', part, p_date, 'Cobrament ' || st.retailer || ' · ref. ' || trim(p_ref), ln.id, rid,
            'cobrament:' || rid::text || ':' || ln.id::text, auth.uid(), (select name from profiles where id = auth.uid()));
    remaining := remaining - part;
  end loop;
  update fin_provider_receipts set allocated = round(p_amount, 2) - remaining where id = rid;
  return rid;
end $$;

-- ============================================================ RLS
alter table public.fin_rules enable row level security;
alter table public.fin_contract_economics enable row level security;
alter table public.fin_calculations enable row level security;
alter table public.fin_ledger enable row level security;
alter table public.fin_settlements enable row level security;
alter table public.fin_settlement_lines enable row level security;
alter table public.fin_payments enable row level security;
alter table public.fin_provider_statements enable row level security;
alter table public.fin_statement_lines enable row level security;
alter table public.fin_provider_receipts enable row level security;
alter table public.fin_costs enable row level security;
alter table public.fin_collaborator_terms enable row level security;
alter table public.fin_targets enable row level security;
alter table public.fin_audit enable row level security;

-- regles: Administració les veu totes; comercials i col·laboradors només les seves regles de pagament aprovades (mai les del proveïdor)
drop policy if exists p_fin_rules_select on public.fin_rules;
create policy p_fin_rules_select on public.fin_rules for select to authenticated using (
  public.is_staff()
  or (status = 'aprovada' and (beneficiary_id is null or beneficiary_id = auth.uid())
      and ((public.my_role() = 'comercial' and layer in ('comercial', 'incentiu')) or (public.my_role() = 'colaborador' and layer = 'collaborador'))));
drop policy if exists p_fin_rules_insert on public.fin_rules;
create policy p_fin_rules_insert on public.fin_rules for insert to authenticated with check (public.fin_can_manage_rules() and created_by = auth.uid());
drop policy if exists p_fin_rules_update on public.fin_rules;
create policy p_fin_rules_update on public.fin_rules for update to authenticated using (public.fin_can_manage_rules()) with check (public.fin_can_manage_rules());

-- dades econòmiques, conciliació, costos i auditoria: només Administració i Direcció
do $$
declare t text;
begin
  foreach t in array array['fin_contract_economics', 'fin_provider_statements', 'fin_statement_lines', 'fin_provider_receipts', 'fin_costs'] loop
    execute format('drop policy if exists %I on public.%I', 'p_' || t || '_staff', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', 'p_' || t || '_staff', t);
  end loop;
end $$;
drop policy if exists p_fin_audit_select on public.fin_audit;
create policy p_fin_audit_select on public.fin_audit for select to authenticated using (public.is_staff());

-- càlculs i moviments: Administració tot; cada comercial o col·laborador només els seus (mai la capa del proveïdor)
drop policy if exists p_fin_calc_select on public.fin_calculations;
create policy p_fin_calc_select on public.fin_calculations for select to authenticated using (public.is_staff() or (layer in ('comercial', 'collaborador') and beneficiary_id = auth.uid()));
drop policy if exists p_fin_calc_write on public.fin_calculations;
create policy p_fin_calc_write on public.fin_calculations for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
drop policy if exists p_fin_calc_update on public.fin_calculations;
create policy p_fin_calc_update on public.fin_calculations for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists p_fin_ledger_select on public.fin_ledger;
create policy p_fin_ledger_select on public.fin_ledger for select to authenticated using (public.is_staff() or (layer in ('comercial', 'collaborador') and beneficiary_id = auth.uid()));
drop policy if exists p_fin_ledger_insert on public.fin_ledger;
create policy p_fin_ledger_insert on public.fin_ledger for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
drop policy if exists p_fin_ledger_update on public.fin_ledger;
create policy p_fin_ledger_update on public.fin_ledger for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- liquidacions: Administració les prepara; Direcció les aprova; cada beneficiari veu només les seves
drop policy if exists p_fin_set_select on public.fin_settlements;
create policy p_fin_set_select on public.fin_settlements for select to authenticated using (public.is_staff() or beneficiary_id = auth.uid());
drop policy if exists p_fin_set_insert on public.fin_settlements;
create policy p_fin_set_insert on public.fin_settlements for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
drop policy if exists p_fin_set_update on public.fin_settlements;
create policy p_fin_set_update on public.fin_settlements for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists p_fin_set_delete on public.fin_settlements;
create policy p_fin_set_delete on public.fin_settlements for delete to authenticated using (public.is_staff() and status in ('esborrany', 'revisio'));
drop policy if exists p_fin_sline_select on public.fin_settlement_lines;
create policy p_fin_sline_select on public.fin_settlement_lines for select to authenticated using (exists (select 1 from fin_settlements s where s.id = settlement_id and (public.is_staff() or s.beneficiary_id = auth.uid())));
drop policy if exists p_fin_sline_write on public.fin_settlement_lines;
create policy p_fin_sline_write on public.fin_settlement_lines for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists p_fin_pay_select on public.fin_payments;
create policy p_fin_pay_select on public.fin_payments for select to authenticated using (exists (select 1 from fin_settlements s where s.id = settlement_id and (public.is_staff() or s.beneficiary_id = auth.uid())));
drop policy if exists p_fin_pay_insert on public.fin_payments;
create policy p_fin_pay_insert on public.fin_payments for insert to authenticated with check (public.is_staff() and created_by = auth.uid());

drop policy if exists p_fin_collab_select on public.fin_collaborator_terms;
create policy p_fin_collab_select on public.fin_collaborator_terms for select to authenticated using (public.is_staff() or user_id = auth.uid());
drop policy if exists p_fin_collab_write on public.fin_collaborator_terms;
create policy p_fin_collab_write on public.fin_collaborator_terms for all to authenticated using (public.fin_can_manage_rules()) with check (public.fin_can_manage_rules());

drop policy if exists p_fin_targets_select on public.fin_targets;
create policy p_fin_targets_select on public.fin_targets for select to authenticated using (public.is_staff() or user_id = auth.uid() or (scope <> 'comercial' and public.my_role() = 'comercial'));
drop policy if exists p_fin_targets_write on public.fin_targets;
create policy p_fin_targets_write on public.fin_targets for all to authenticated using (public.is_staff()) with check (public.is_staff());
