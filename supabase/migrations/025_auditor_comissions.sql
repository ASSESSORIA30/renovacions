-- =====================================================================================================
-- Fase 14 · 025 · AUDITOR DE COMISSIONS · CONCILIACIÓ DE DOBLE SENTIT
-- =====================================================================================================
-- Migració ADDITIVA i idempotent (es pot executar més d'una vegada). No esborra cap taula, columna ni relació.
-- Desfer: 025_auditor_comissions_down.sql. Requereix: 011 (economia), 014 (permisos) i 018 (reclamacions).
--
--   1. Liquidacions importades amb traçabilitat: empremta del fitxer (evita importar dues vegades el mateix document),
--      format i signatura de l'estructura, liquidació rectificativa, i per a cada línia la pestanya, la fila,
--      el tipus de moviment, les dates, l'estat del document, els kWh × €/kWh i el motiu de la vinculació.
--   2. Cobrament NET d'una liquidació: les retrocomissions conciliades compensen comissions de la mateixa liquidació.
--      Cada assignació queda registrada (fin_receipt_allocations, només d'afegir). «Cobrada» continua sortint NOMÉS
--      de cobraments reals amb referència bancària (fin_ledger.cobrament exigeix receipt_id des de la 011).
--   3. Ajornament contractual de la liquidació d'un contracte (no és reclamable mentre duri).
--   4. Reclamacions: revisió i AUTORITZACIÓ obligatòries abans d'enviar-les. Autoritza Direcció o qui tingui permís
--      d'aprovació a «economia», i mai qui l'ha preparada (excepte Direcció). Qualsevol canvi posterior al contingut
--      (diferències, correu, contacte) anul·la l'autorització.
--   5. Set alertes de l'auditor al motor d'automatitzacions.
-- =====================================================================================================

-- ============================================================ 1. liquidacions i línies
alter table public.fin_provider_statements add column if not exists file_sha256 text;
alter table public.fin_provider_statements add column if not exists supplier_format text;
alter table public.fin_provider_statements add column if not exists format_signature text;
alter table public.fin_provider_statements add column if not exists read_summary jsonb;
alter table public.fin_provider_statements add column if not exists rectifies_id uuid references public.fin_provider_statements (id) on delete restrict;
alter table public.fin_provider_statements add column if not exists net_settlement boolean not null default true;
create unique index if not exists fin_statements_file_uq on public.fin_provider_statements (lower(retailer), file_sha256) where file_sha256 is not null;

alter table public.fin_statement_lines add column if not exists source_sheet text;
alter table public.fin_statement_lines add column if not exists source_row integer;
alter table public.fin_statement_lines add column if not exists movement text;
alter table public.fin_statement_lines add column if not exists energy text;
alter table public.fin_statement_lines add column if not exists product text;
alter table public.fin_statement_lines add column if not exists event_date date;
alter table public.fin_statement_lines add column if not exists activation_date date;
alter table public.fin_statement_lines add column if not exists doc_status text;
alter table public.fin_statement_lines add column if not exists unit_qty numeric(18, 6);
alter table public.fin_statement_lines add column if not exists unit_price numeric(18, 6);
alter table public.fin_statement_lines add column if not exists stable_key text;
alter table public.fin_statement_lines add column if not exists flags text[] not null default '{}';
alter table public.fin_statement_lines add column if not exists match_confidence text;
alter table public.fin_statement_lines add column if not exists match_reason text;
alter table public.fin_statement_lines add column if not exists match_candidates jsonb not null default '[]';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fin_statement_lines_movement_chk') then
    alter table public.fin_statement_lines add constraint fin_statement_lines_movement_chk
      check (movement is null or movement in ('alta', 'renovacio', 'retrocessio', 'baixa', 'recurrent', 'regularitzacio', 'altres'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_statement_lines_energy_chk') then
    alter table public.fin_statement_lines add constraint fin_statement_lines_energy_chk check (energy is null or energy in ('llum', 'gas'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_statement_lines_confidence_chk') then
    alter table public.fin_statement_lines add constraint fin_statement_lines_confidence_chk
      check (match_confidence is null or match_confidence in ('inequivoca', 'probable', 'multiple', 'cap', 'manual'));
  end if;
end $$;
-- un mateix moviment del document només una vegada per liquidació (reintents idempotents)
create unique index if not exists fin_lines_stable_uq on public.fin_statement_lines (statement_id, stable_key) where stable_key is not null;
create index if not exists fin_lines_cups_idx on public.fin_statement_lines (cups);

-- ============================================================ 2. assignacions dels cobraments (només d'afegir)
create table if not exists public.fin_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.fin_provider_receipts (id) on delete restrict,
  statement_line_id uuid not null references public.fin_statement_lines (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  -- efectiu: part pagada amb diners · compensacio: part d'una comissió saldada amb retrocomissions de la mateixa
  -- liquidació · compensada: part d'una retrocomissió que s'ha descomptat del pagament
  mode text not null check (mode in ('efectiu', 'compensacio', 'compensada')),
  ledger_id uuid references public.fin_ledger (id) on delete restrict,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (receipt_id, statement_line_id, mode)
);
create index if not exists fin_receipt_alloc_line_idx on public.fin_receipt_allocations (statement_line_id);
create or replace function public.fin_receipt_alloc_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'Les assignacions de cobrament no es modifiquen ni s''esborren: registra un ajustament.' using errcode = '42501';
end $$;
drop trigger if exists fin_receipt_alloc_append on public.fin_receipt_allocations;
create trigger fin_receipt_alloc_append before update or delete on public.fin_receipt_allocations for each row execute function public.fin_receipt_alloc_append_only();

alter table public.fin_receipt_allocations enable row level security;
drop policy if exists p_fin_receipt_alloc_select on public.fin_receipt_allocations;
create policy p_fin_receipt_alloc_select on public.fin_receipt_allocations for select to authenticated using (public.fin_staff('read'));
drop policy if exists p_fin_receipt_alloc_insert on public.fin_receipt_allocations;
create policy p_fin_receipt_alloc_insert on public.fin_receipt_allocations for insert to authenticated with check (public.fin_staff('edit'));

-- Cobrament net: import rebut + retrocomissions conciliades pendents de compensar, repartit per ordre entre les
-- comissions conciliades. Mai no assigna a una línia més del que s'ha liquidat; el que sobra queda sense assignar.
-- Les línies sense identificar NO es marquen com a cobrades (conciliació parcial).
create or replace function public.fin_register_receipt_net(p_statement uuid, p_amount numeric, p_date date, p_ref text, p_notes text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  st fin_provider_statements;
  rid uuid;
  lid uuid;
  cash numeric(14, 2) := round(p_amount, 2);
  comp_total numeric(14, 2) := 0;
  comp numeric(14, 2);
  used numeric(14, 2);
  need numeric(14, 2);
  part numeric(14, 2);
  ln record;
  who text := (select name from profiles where id = auth.uid());
begin
  if not public.fin_staff('edit') then raise exception 'Només Administració registra cobraments' using errcode = '42501'; end if;
  if round(p_amount, 2) <= 0 then raise exception 'L''import del cobrament ha de ser positiu' using errcode = '23514'; end if;
  select * into st from fin_provider_statements where id = p_statement;
  if st.id is null then raise exception 'Liquidació del proveïdor no trobada' using errcode = '23514'; end if;
  insert into fin_provider_receipts (statement_id, retailer, amount, received_at, bank_reference, idempotency_key, notes, created_by)
  values (st.id, st.retailer, round(p_amount, 2), p_date, trim(p_ref), lower(st.retailer) || '|' || lower(trim(p_ref)) || '|' || round(p_amount, 2)::text || '|' || p_date::text, p_notes, auth.uid())
  returning id into rid;

  select coalesce(sum(-l.amount - coalesce((select sum(a.amount) from fin_receipt_allocations a where a.statement_line_id = l.id and a.mode = 'compensada'), 0)), 0)
    into comp_total
    from fin_statement_lines l where l.statement_id = st.id and l.match_status = 'conciliat' and l.amount < 0;
  comp_total := greatest(comp_total, 0);
  comp := comp_total;

  for ln in
    select l.id, l.contract_id, (select client_id from crm_contracts k where k.id = l.contract_id) as client_id,
           l.amount - coalesce((select sum(g.amount) from fin_ledger g where g.statement_line_id = l.id and g.kind = 'cobrament'), 0) as pending
      from fin_statement_lines l
     where l.statement_id = st.id and l.match_status = 'conciliat' and l.amount > 0
     order by l.line_no
  loop
    exit when cash <= 0 and comp <= 0;
    continue when ln.pending <= 0;
    need := ln.pending;
    part := least(need, comp);
    if part > 0 then
      insert into fin_ledger (contract_id, client_id, layer, kind, amount, period, description, statement_line_id, receipt_id, idempotency_key, created_by, created_by_name)
      values (ln.contract_id, ln.client_id, 'proveidor', 'cobrament', part, p_date, 'Cobrament per compensació amb retrocomissions · ' || st.retailer || ' · ref. ' || trim(p_ref), ln.id, rid,
              'cobrament:comp:' || rid::text || ':' || ln.id::text, auth.uid(), who)
      returning id into lid;
      insert into fin_receipt_allocations (receipt_id, statement_line_id, amount, mode, ledger_id) values (rid, ln.id, part, 'compensacio', lid);
      comp := comp - part; need := need - part;
    end if;
    part := least(need, cash);
    if part > 0 then
      insert into fin_ledger (contract_id, client_id, layer, kind, amount, period, description, statement_line_id, receipt_id, idempotency_key, created_by, created_by_name)
      values (ln.contract_id, ln.client_id, 'proveidor', 'cobrament', part, p_date, 'Cobrament ' || st.retailer || ' · ref. ' || trim(p_ref), ln.id, rid,
              'cobrament:' || rid::text || ':' || ln.id::text, auth.uid(), who)
      returning id into lid;
      insert into fin_receipt_allocations (receipt_id, statement_line_id, amount, mode, ledger_id) values (rid, ln.id, part, 'efectiu', lid);
      cash := cash - part;
    end if;
  end loop;

  -- retrocomissions realment compensades (només la part utilitzada)
  used := comp_total - comp;
  for ln in
    select l.id, -l.amount - coalesce((select sum(a.amount) from fin_receipt_allocations a where a.statement_line_id = l.id and a.mode = 'compensada'), 0) as pending
      from fin_statement_lines l where l.statement_id = st.id and l.match_status = 'conciliat' and l.amount < 0 order by l.line_no
  loop
    exit when used <= 0;
    continue when ln.pending <= 0;
    part := least(ln.pending, used);
    insert into fin_receipt_allocations (receipt_id, statement_line_id, amount, mode) values (rid, ln.id, part, 'compensada');
    used := used - part;
  end loop;

  update fin_provider_receipts set allocated = round(p_amount, 2) - cash where id = rid;
  return rid;
end $$;

-- ============================================================ 3. ajornament contractual de la liquidació
alter table public.fin_contract_economics add column if not exists settlement_deferred_until date;
alter table public.fin_contract_economics add column if not exists settlement_deferral_reason text;

-- ============================================================ 4. autorització de les reclamacions
alter table public.fin_claims add column if not exists authorized_by uuid references auth.users (id);
alter table public.fin_claims add column if not exists authorized_at timestamptz;
alter table public.fin_claims add column if not exists authorization_note text;

create or replace function public.fin_claim_authz() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- autoritzar
  if new.authorized_at is not null and old.authorized_at is null then
    if auth.uid() is null then raise exception 'Una reclamació només l''autoritza una persona' using errcode = '42501'; end if;
    if not (coalesce(public.my_role() = 'admin', false) or public.fin_staff('approve')) then
      raise exception 'Només Direcció o qui tingui permís d''aprovació a Economia pot autoritzar una reclamació' using errcode = '42501';
    end if;
    if coalesce(public.my_role(), '') <> 'admin' and old.created_by = auth.uid() then
      raise exception 'Una reclamació l''ha d''autoritzar una persona diferent de qui l''ha preparada' using errcode = '42501';
    end if;
    if old.status not in ('esborrany', 'pendent_enviament') then raise exception 'Aquesta reclamació ja s''ha enviat' using errcode = '23514'; end if;
    new.authorized_by := auth.uid();
    new.authorized_at := now();
  elsif new.authorized_at is not null and new.authorized_at is distinct from old.authorized_at then
    raise exception 'L''autorització no es pot modificar' using errcode = '42501';
  end if;
  -- canvis de contingut després d'autoritzar: cal tornar-la a autoritzar
  if old.authorized_at is not null and new.authorized_at is not distinct from old.authorized_at and new.status in ('esborrany', 'pendent_enviament')
     and (new.email_subject, new.email_body, new.contact_email, new.contact_name, new.contact_id, new.retailer, new.period_from, new.period_to)
         is distinct from (old.email_subject, old.email_body, old.contact_email, old.contact_name, old.contact_id, old.retailer, old.period_from, old.period_to) then
    new.authorized_at := null; new.authorized_by := null; new.authorization_note := null;
  end if;
  if new.authorized_at is null then new.authorized_by := null; end if;
  -- enviar (pel CRM o registrat com a enviat fora) exigeix l'autorització, i el correu ha de ser l'autoritzat
  if new.status = 'enviada' and old.status in ('esborrany', 'pendent_enviament') then
    if new.authorized_at is null then raise exception 'Cal revisar i autoritzar la reclamació abans d''enviar-la' using errcode = '23514'; end if;
    if (new.email_subject, new.email_body, new.contact_email) is distinct from (old.email_subject, old.email_body, old.contact_email) then
      raise exception 'El correu ha canviat després de l''autorització: cal tornar-la a autoritzar' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fin_claims_authz on public.fin_claims;
create trigger fin_claims_authz before update on public.fin_claims for each row execute function public.fin_claim_authz();

-- afegir, treure o canviar diferències anul·la l'autorització
create or replace function public.fin_claim_items_reauth() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.claimed_amount, new.item_key, new.status) is not distinct from (old.claimed_amount, old.item_key, old.status) then return null; end if;
  update fin_claims set authorized_at = null, authorized_by = null, authorization_note = null
   where id = coalesce(new.claim_id, old.claim_id) and authorized_at is not null and status in ('esborrany', 'pendent_enviament');
  return null;
end $$;
drop trigger if exists fin_claim_items_reauth on public.fin_claim_items;
create trigger fin_claim_items_reauth after insert or update or delete on public.fin_claim_items for each row execute function public.fin_claim_items_reauth();

-- ============================================================ 5. alertes de l'auditor
insert into public.crm_automation_rules (key, name, description, params) values
  ('audit_pendent_liquidar', 'Comissió pendent de liquidar', 'Contracte activat (alta o renovació) que no apareix a cap liquidació després del termini de pagament aprovat (o dels dies per defecte), tenint en compte els ajornaments.', '{"default_days": 90}'),
  ('audit_liquidada_inferior', 'Comissió liquidada per un import inferior', 'La comercialitzadora ha liquidat menys del que preveu la regla aprovada.', '{"min_eur": 1}'),
  ('audit_cobrada_parcial', 'Comissió cobrada parcialment', 'Comissió conciliada amb un cobrament bancari inferior a l''import liquidat.', '{}'),
  ('audit_retro_inesperada', 'Retrocomissió inesperada', 'Retrocomissió sense regla aprovada, fora del període de risc, superior a la permesa o d''un contracte sense comissió liquidada.', '{}'),
  ('audit_liquidacio_duplicada', 'Liquidació duplicada', 'El mateix moviment (CUPS, tipus, data i import) apareix en més d''una liquidació.', '{}'),
  ('audit_sense_contracte', 'Comissió que no correspon a cap contracte', 'Línia de liquidació sense contracte al CRM o amb diversos contractes compatibles.', '{}'),
  ('audit_cobrament_fora_termini', 'Contracte pendent de cobrament fora de termini', 'Comissió liquidada i conciliada sense cap cobrament bancari després de X dies.', '{"days": 30}')
on conflict (key) do nothing;

-- ============================================================ COMPROVACIÓ
-- Ha de retornar: 6 · 15 · 1 · 1 · 3 · 2 · 7
select 'columnes noves a les liquidacions' as què, count(*) as total from information_schema.columns where table_schema = 'public' and table_name = 'fin_provider_statements'
   and column_name in ('file_sha256', 'supplier_format', 'format_signature', 'read_summary', 'rectifies_id', 'net_settlement')
union all select 'columnes noves a les línies', count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fin_statement_lines'
   and column_name in ('source_sheet', 'source_row', 'movement', 'energy', 'product', 'event_date', 'activation_date', 'doc_status', 'unit_qty', 'unit_price', 'stable_key', 'flags', 'match_confidence', 'match_reason', 'match_candidates')
union all select 'taula d''assignacions de cobrament', count(*) from information_schema.tables where table_schema = 'public' and table_name = 'fin_receipt_allocations'
union all select 'funció de cobrament net', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fin_register_receipt_net'
union all select 'columnes d''autorització', count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fin_claims' and column_name in ('authorized_by', 'authorized_at', 'authorization_note')
union all select 'columnes d''ajornament', count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fin_contract_economics' and column_name in ('settlement_deferred_until', 'settlement_deferral_reason')
union all select 'alertes de l''auditor', count(*) from public.crm_automation_rules where key like 'audit_%';
