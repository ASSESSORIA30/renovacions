-- 005 · Dades energètiques manuals i auditoria de consultes SIPS. Incremental i idempotent.

-- Dades introduïdes pels comercials a partir de factures. El SIPS no les sobreescriu mai.
create table if not exists public.energy_inputs (
  cups text primary key,                 -- base de 20 caràcters
  invoice_kwh jsonb,                     -- [P1..P6] kWh anuals per període (factura)
  invoice_source text,                   -- descripció de l'origen (factura, període…)
  period_max jsonb,                      -- [12][6] maxímetres per període (factures)
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users,
  updated_by_name text
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'energy_inputs_chk') then
    alter table public.energy_inputs add constraint energy_inputs_chk check (
      (invoice_kwh is null or (jsonb_typeof(invoice_kwh) = 'array' and jsonb_array_length(invoice_kwh) <= 6)) and
      (period_max is null or (jsonb_typeof(period_max) = 'array' and jsonb_array_length(period_max) = 12))
    );
  end if;
end $$;
alter table public.energy_inputs enable row level security;
revoke all on public.energy_inputs from anon, authenticated;
-- (No s'enganxa el trigger genèric public.audit(): espera columnes id/contract_id. L'autoria queda a updated_by.)

-- Registre de consultes al portal SIPS (cerca, actualització, importació, enriquiment).
-- També serveix per limitar la freqüència per usuari.
create table if not exists public.sips_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users on delete set null,
  user_email text,
  action text not null check (action in ('search', 'refresh', 'import', 'enrich')),
  query jsonb,
  result_count integer,
  ok boolean not null default true,
  error text
);
create index if not exists sips_audit_user_idx on public.sips_audit (user_id, action, at desc);
alter table public.sips_audit enable row level security;
revoke all on public.sips_audit from anon, authenticated;
grant select on public.sips_audit to authenticated;
drop policy if exists p_sips_audit_admin on public.sips_audit;
create policy p_sips_audit_admin on public.sips_audit for select to authenticated using (public.is_admin());
