-- 028 · EXTRACTES BANCARIS I CONCILIACIÓ AMB LES FACTURES EMESES
-- Additiva i idempotent. Reversible amb 028_conciliacio_bancaria_down.sql. Requereix 026 (facturació).
--   · Es puja l'extracte (Norma 43, Excel o CSV) i es guarden els moviments sense duplicar-los (empremta única).
--   · El CRM proposa quina factura cobra cada ingrés; una persona ho confirma i es registra el cobrament amb
--     bill_register_payment (la mateixa funció de sempre). Res no es concilia sol.

create table if not exists public.bill_bank_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_sha256 text not null,
  format text not null check (format in ('norma43', 'taula')),
  account text,
  period_from date,
  period_to date,
  movements integer not null default 0,
  new_movements integer not null default 0,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists bill_bank_imports_sha_uq on public.bill_bank_imports (file_sha256);

create table if not exists public.bill_bank_movements (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.bill_bank_imports (id) on delete set null,
  account text,
  op_date date not null,
  value_date date,
  amount numeric(14, 2) not null,
  concept text not null default '',
  reference text,
  balance numeric(14, 2),
  movement_hash text not null,
  status text not null default 'pendent' check (status in ('pendent', 'conciliat', 'ignorat')),
  note text,
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists bill_bank_movements_hash_uq on public.bill_bank_movements (movement_hash);
create index if not exists bill_bank_movements_date_idx on public.bill_bank_movements (op_date desc);
create index if not exists bill_bank_movements_status_idx on public.bill_bank_movements (status) where amount > 0;

-- quin cobrament de factura explica cada ingrés (un ingrés pot pagar diverses factures)
create table if not exists public.bill_bank_matches (
  movement_id uuid not null references public.bill_bank_movements (id) on delete restrict,
  invoice_id uuid not null references public.bill_invoices (id) on delete restrict,
  payment_id uuid references public.bill_payments (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (movement_id, invoice_id)
);
create index if not exists bill_bank_matches_invoice_idx on public.bill_bank_matches (invoice_id);

alter table public.bill_bank_imports enable row level security;
alter table public.bill_bank_movements enable row level security;
alter table public.bill_bank_matches enable row level security;
do $$
declare t text;
begin
  foreach t in array array['bill_bank_imports', 'bill_bank_movements', 'bill_bank_matches'] loop
    execute format('drop policy if exists p_%1$s_read on public.%1$I', t);
    execute format('create policy p_%1$s_read on public.%1$I for select to authenticated using (public.has_perm(''facturacio'', ''read''))', t);
  end loop;
end $$;
drop policy if exists p_bill_bank_imports_write on public.bill_bank_imports;
create policy p_bill_bank_imports_write on public.bill_bank_imports for insert to authenticated with check (public.has_perm('facturacio', 'edit'));
drop policy if exists p_bill_bank_movements_insert on public.bill_bank_movements;
create policy p_bill_bank_movements_insert on public.bill_bank_movements for insert to authenticated with check (public.has_perm('facturacio', 'edit'));
drop policy if exists p_bill_bank_movements_update on public.bill_bank_movements;
create policy p_bill_bank_movements_update on public.bill_bank_movements for update to authenticated using (public.has_perm('facturacio', 'edit')) with check (public.has_perm('facturacio', 'edit'));
-- bill_bank_matches només s'escriu amb bill_bank_confirm (security definer)

-- Confirmar: registra el cobrament de cada factura (bill_register_payment) i marca l'ingrés com a conciliat. Tot o res.
create or replace function public.bill_bank_confirm(p_movement uuid, p_invoices jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare mv bill_bank_movements; it jsonb; amt numeric(14, 2); tot numeric(14, 2) := 0; inv bill_invoices; pay uuid;
begin
  if auth.uid() is not null and not public.has_perm('facturacio', 'approve') then
    raise exception 'No tens permís per registrar cobraments' using errcode = '42501';
  end if;
  select * into mv from bill_bank_movements where id = p_movement for update;
  if mv.id is null then raise exception 'Moviment no trobat' using errcode = 'P0002'; end if;
  if mv.status <> 'pendent' then raise exception 'Aquest moviment ja està conciliat o ignorat' using errcode = '23514'; end if;
  if mv.amount <= 0 then raise exception 'Només els ingressos poden cobrar factures' using errcode = '23514'; end if;
  for it in select * from jsonb_array_elements(p_invoices) loop
    amt := round((it ->> 'amount')::numeric, 2);
    tot := tot + amt;
    inv := public.bill_register_payment((it ->> 'invoice_id')::uuid, amt, mv.op_date, 'transferencia', left(coalesce(nullif(mv.reference, ''), mv.concept), 120), 'Conciliat amb l''extracte bancari');
    select id into pay from bill_payments where invoice_id = inv.id order by created_at desc limit 1;
    insert into bill_bank_matches (movement_id, invoice_id, payment_id, amount, created_by) values (mv.id, inv.id, pay, amt, auth.uid());
  end loop;
  if tot > mv.amount + 0.005 then raise exception 'Els cobraments (% €) superen l''import de l''ingrés (% €)', tot, mv.amount using errcode = '23514'; end if;
  update bill_bank_movements set status = 'conciliat', resolved_by = auth.uid(), resolved_at = now(),
         note = case when tot < mv.amount - 0.005 then 'Conciliat parcialment: ' || (mv.amount - tot)::text || ' € sense factura' else note end
   where id = mv.id;
  perform public.bill_log('conciliacio_bancaria', null, null, jsonb_build_object('moviment', mv.id, 'import', mv.amount, 'factures', jsonb_array_length(p_invoices)));
end $$;

-- ============================================================ COMPROVACIÓ (ha de donar 3 · 1)
select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'bill\_bank\_%') as taules_banc,
       (select count(*) from pg_proc where proname = 'bill_bank_confirm') as funcio_confirmar;
