-- 026 · FACTURACIÓ PRÒPIA D'ASSESSORIA 3.0
-- Additiva i idempotent: no esborra ni modifica cap taula existent. Reversible amb 026_facturacio_down.sql.
-- Requereix 011 (fin_provider_statements, fin_statement_lines) i 014 (has_perm, role_permissions, sec_audit).
-- Nota: es va lliurar primer com a «018_facturacio.sql». És el mateix contingut; si ja s'ha executat, tornar-la a executar no canvia res.
--
-- Principis:
--   · Diners en NUMERIC(14,2). Cada línia s'arrodoneix a cèntims; l'IVA es calcula per tipus sobre la base de cada tipus.
--   · Els esborranys NO tenen número. El número es reserva en emetre, dins d'una transacció, bloquejant la fila del
--     comptador (bill_series): dues persones que emeten alhora reben números consecutius, mai el mateix.
--   · Una factura emesa no es pot modificar ni esborrar. Les correccions es fan amb una factura rectificativa (sèrie REC).
--   · Cada factura emesa guarda una còpia de les dades del client i de l'emissor tal com eren el dia de l'emissió.
--   · Cada factura emesa guarda una empremta (SHA-256) encadenada amb l'anterior de la sèrie. Això prepara la integritat
--     dels registres, però NO equival per si sol al compliment de VERI*FACTU (cal un SIF homologat o l'enviament a l'AEAT).
--   · Un import comunicat per una comercialitzadora no és un cobrament. Calculat ≠ reconegut ≠ facturat ≠ cobrat.

-- ============================================================ 1. configuració de l'emissor (una sola fila)
create table if not exists public.bill_settings (
  id smallint primary key default 1 check (id = 1),
  issuer_name text not null,
  issuer_nif text not null,
  issuer_address text not null,
  issuer_postal_code text not null,
  issuer_city text not null,
  issuer_province text,
  issuer_country text not null default 'España',
  issuer_email text,
  issuer_phone text,
  iban text,
  logo_path text,                                   -- ruta al bucket privat (logotip original pujat per Direcció)
  default_vat_rate numeric(5, 2) not null default 21 check (default_vat_rate between 0 and 100),
  default_due_days integer not null default 30 check (default_due_days between 0 and 365),
  footer_text text,
  email_subject_tpl text,
  email_body_tpl text,
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

-- ============================================================ 2. clients de facturació
create table if not exists public.bill_clients (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) between 2 and 200),
  trade_name text,
  nif text not null default '',
  nif_norm text not null default '',
  address text,
  postal_code text,
  city text,
  province text,
  country text not null default 'España',
  contact_name text,
  phone text,
  billing_email text,
  payment_method text not null default 'transferencia' check (payment_method in ('transferencia', 'domiciliacio', 'confirming', 'compensacio', 'altres')),
  due_days integer check (due_days is null or due_days between 0 and 365),
  order_ref_label text,                              -- p. ex. «ALBARÀ» o «PEDIDO» si el client ho exigeix
  order_ref text,
  retailer_name text,                                -- nom tal com surt a les liquidacions (fin_provider_statements.retailer)
  notes text,
  status text not null default 'actiu' check (status in ('actiu', 'inactiu', 'arxivat')),
  needs_review boolean not null default false,
  review_notes text,
  search text not null default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
create unique index if not exists bill_clients_nif_uq on public.bill_clients (nif_norm) where nif_norm <> '';
create index if not exists bill_clients_search_idx on public.bill_clients (status, legal_name);
create index if not exists bill_clients_retailer_idx on public.bill_clients (lower(retailer_name));

create or replace function public.bill_client_before() returns trigger language plpgsql set search_path = public as $$
begin
  new.legal_name := regexp_replace(trim(new.legal_name), '\s+', ' ', 'g');
  new.nif := upper(trim(coalesce(new.nif, '')));
  new.nif_norm := regexp_replace(new.nif, '[^A-Z0-9]', '', 'g');
  new.billing_email := nullif(lower(trim(coalesce(new.billing_email, ''))), '');
  new.search := lower(concat_ws(' ', new.legal_name, new.trade_name, new.nif_norm, new.city, new.retailer_name, new.billing_email));
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;
drop trigger if exists bill_clients_before on public.bill_clients;
create trigger bill_clients_before before insert or update on public.bill_clients for each row execute function public.bill_client_before();

-- ============================================================ 3. sèries i comptadors
create table if not exists public.bill_series (
  code text not null check (code in ('ORD', 'REC')),     -- ORD = ordinària «AA-NNN»; REC = rectificativa «RAA-NNN»
  year integer not null check (year between 2000 and 2100),
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (code, year)
);

-- Números que consten com a consumits però no tenen factura localitzada (p. ex. 26-023 i 26-031). Mai es reutilitzen.
create table if not exists public.bill_number_gaps (
  series text not null,
  year integer not null,
  number integer not null,
  invoice_no text not null,
  status text not null default 'pendent_verificar' check (status in ('pendent_verificar', 'anullada', 'localitzada', 'verificada')),
  notes text,
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  primary key (series, year, number)
);

-- ============================================================ 4. factures i línies
create table if not exists public.bill_invoices (
  id uuid primary key default gen_random_uuid(),
  series text not null,                              -- ORD, REC o sèries històriques H-XX (Excel 2023-2024)
  year integer,
  number integer,
  invoice_no text,                                   -- null mentre és esborrany
  dup_seq smallint not null default 0,               -- >0 només per a números repetits ja existents a l'Excel
  kind text not null default 'ordinaria' check (kind in ('ordinaria', 'rectificativa')),
  status text not null default 'esborrany' check (status in ('esborrany', 'emesa', 'parcialment_cobrada', 'cobrada', 'rectificada')),
  origin text not null default 'manual' check (origin in ('manual', 'liquidacio', 'excel_historic')),
  client_id uuid not null references public.bill_clients (id) on delete restrict,
  client_snapshot jsonb,
  issuer_snapshot jsonb,
  issue_date date,
  due_date date,
  concept text,
  period_label text,
  period_from date,
  period_to date,
  order_ref_label text,
  order_ref text,
  notes text,                                        -- surt a la factura
  internal_notes text,                               -- no surt a la factura
  base numeric(14, 2) not null default 0,
  vat numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  vat_breakdown jsonb not null default '[]',
  paid numeric(14, 2) not null default 0,
  payment_unknown boolean not null default false,    -- històric de l'Excel: no consta si s'ha cobrat
  rectifies_id uuid references public.bill_invoices (id) on delete restrict,
  rectification_reason text,
  needs_review boolean not null default false,
  review_notes text,
  prev_hash text,
  record_hash text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_by uuid references auth.users (id),
  issued_at timestamptz,
  sent_at timestamptz,
  last_email_status text,
  check (period_from is null or period_to is null or period_from <= period_to),
  check (status = 'esborrany' or (invoice_no is not null and issue_date is not null)),
  check (kind = 'ordinaria' or rectifies_id is not null)
);
create unique index if not exists bill_invoices_no_uq on public.bill_invoices (invoice_no, dup_seq) where invoice_no is not null;
create unique index if not exists bill_invoices_num_uq on public.bill_invoices (series, year, number, dup_seq) where number is not null;
create index if not exists bill_invoices_client_idx on public.bill_invoices (client_id, issue_date desc);
create index if not exists bill_invoices_status_idx on public.bill_invoices (status, due_date);
create index if not exists bill_invoices_date_idx on public.bill_invoices (issue_date desc);

create table if not exists public.bill_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.bill_invoices (id) on delete cascade,
  line_no integer not null,
  description text not null check (length(trim(description)) between 1 and 1000),
  quantity numeric(14, 4) not null default 1,
  unit_price numeric(14, 6) not null,
  vat_rate numeric(5, 2) not null default 21 check (vat_rate between 0 and 100),
  vat_exemption text,                                -- obligatori si vat_rate = 0 en factures noves (causa legal)
  amount numeric(14, 2) not null default 0,
  statement_line_id uuid references public.fin_statement_lines (id) on delete set null,
  unique (invoice_id, line_no)
);

create or replace function public.bill_line_before() returns trigger language plpgsql set search_path = public as $$
begin
  new.amount := round(new.quantity * new.unit_price, 2);
  return new;
end $$;
drop trigger if exists bill_lines_before on public.bill_invoice_lines;
create trigger bill_lines_before before insert or update on public.bill_invoice_lines for each row execute function public.bill_line_before();

-- Només es poden tocar línies d'esborranys (excepte la importació inicial de l'històric, feta pel servidor).
create or replace function public.bill_line_guard() returns trigger language plpgsql set search_path = public as $$
declare st text;
begin
  select status into st from bill_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if st is null then return coalesce(new, old); end if;   -- esborrat en cascada d'un esborrany
  if st <> 'esborrany' and not (auth.uid() is null and current_setting('bill.import', true) = 'on') then
    raise exception 'La factura ja és emesa: les línies no es poden modificar (fes una rectificativa)' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists bill_lines_guard on public.bill_invoice_lines;
create trigger bill_lines_guard before insert or update or delete on public.bill_invoice_lines for each row execute function public.bill_line_guard();

-- Totals deterministes d'un esborrany (base per tipus, IVA per tipus arrodonit a cèntims).
create or replace function public.bill_recalc(p_id uuid) returns void language plpgsql set search_path = public as $$
declare br jsonb; b numeric(14, 2); v numeric(14, 2);
begin
  select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'vat', vat) order by rate desc), '[]'),
         coalesce(sum(base), 0), coalesce(sum(vat), 0)
    into br, b, v
    from (select vat_rate as rate, sum(amount) as base, round(sum(amount) * vat_rate / 100, 2) as vat
            from bill_invoice_lines where invoice_id = p_id group by vat_rate) t;
  update bill_invoices set base = b, vat = v, total = b + v, vat_breakdown = br
   where id = p_id and status = 'esborrany';
end $$;

create or replace function public.bill_lines_after() returns trigger language plpgsql set search_path = public as $$
begin
  perform public.bill_recalc(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
drop trigger if exists bill_lines_after on public.bill_invoice_lines;
create trigger bill_lines_after after insert or update or delete on public.bill_invoice_lines for each row execute function public.bill_lines_after();

-- Bloqueig de les factures emeses: només poden canviar camps de seguiment (cobrament, enviament, revisió).
create or replace function public.bill_invoice_guard() returns trigger language plpgsql set search_path = public as $$
declare
  allowed text[] := array['status', 'paid', 'payment_unknown', 'sent_at', 'last_email_status', 'needs_review', 'review_notes', 'internal_notes', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'esborrany' then
      raise exception 'Una factura emesa no es pot eliminar. Fes una factura rectificativa.' using errcode = '42501';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if old.status = 'esborrany' then
    if new.status <> 'esborrany' and current_setting('bill.issuing', true) is distinct from new.id::text then
      raise exception 'Una factura només s''emet amb l''acció «Emetre» (bill_issue_invoice)' using errcode = '42501';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'La factura % ja és emesa i no es pot modificar. Fes una factura rectificativa.', old.invoice_no using errcode = '42501';
  end if;
  if new.status = 'esborrany' then
    raise exception 'Una factura emesa no pot tornar a esborrany' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bill_invoices_guard on public.bill_invoices;
create trigger bill_invoices_guard before update or delete on public.bill_invoices for each row execute function public.bill_invoice_guard();

-- Una factura nova sempre neix com a esborrany (l'històric de l'Excel només el pot inserir el servidor).
create or replace function public.bill_invoice_insert_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'esborrany' and not (auth.uid() is null and current_setting('bill.import', true) = 'on' and new.origin = 'excel_historic') then
    raise exception 'Les factures noves es creen com a esborrany' using errcode = '42501';
  end if;
  if new.status = 'esborrany' then
    new.invoice_no := null; new.number := null; new.year := null; new.record_hash := null; new.prev_hash := null;
    new.issued_at := null; new.issued_by := null; new.paid := 0;
    new.series := case when new.kind = 'rectificativa' then 'REC' else 'ORD' end;
  end if;
  return new;
end $$;
drop trigger if exists bill_invoices_insert_guard on public.bill_invoices;
create trigger bill_invoices_insert_guard before insert on public.bill_invoices for each row execute function public.bill_invoice_insert_guard();

-- ============================================================ 5. cobraments
create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.bill_invoices (id) on delete restrict,
  amount numeric(14, 2) not null check (amount <> 0),
  paid_at date not null,
  method text not null default 'transferencia' check (method in ('transferencia', 'domiciliacio', 'confirming', 'compensacio', 'efectiu', 'altres')),
  reference text,
  notes text,
  idempotency_key text not null unique,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists bill_payments_invoice_idx on public.bill_payments (invoice_id, paid_at);

create or replace function public.bill_payments_ro() returns trigger language plpgsql as $$
begin
  raise exception 'Els cobraments no es modifiquen ni s''esborren: registra un cobrament negatiu per corregir-lo' using errcode = '42501';
end $$;
drop trigger if exists bill_payments_ro on public.bill_payments;
create trigger bill_payments_ro before update or delete on public.bill_payments for each row execute function public.bill_payments_ro();

-- ============================================================ 6. relació amb les liquidacions de comercialitzadores
create table if not exists public.bill_invoice_statements (
  invoice_id uuid not null references public.bill_invoices (id) on delete cascade,
  statement_id uuid not null references public.fin_provider_statements (id) on delete restrict,
  amount numeric(14, 2) not null,                    -- base que aquesta factura cobreix d'aquesta liquidació
  created_at timestamptz not null default now(),
  primary key (invoice_id, statement_id)
);
create index if not exists bill_inv_stm_idx on public.bill_invoice_statements (statement_id);

-- Diferències de comissions: esperat, liquidat, acceptat per facturar i pendent de reclamar (per línia).
create table if not exists public.bill_statement_claims (
  statement_line_id uuid primary key references public.fin_statement_lines (id) on delete cascade,
  accepted_amount numeric(14, 2),                    -- import acceptat per facturar (null = l'import liquidat)
  claim_amount numeric(14, 2) not null default 0,    -- import pendent de reclamar a la comercialitzadora
  claim_status text not null default 'cap' check (claim_status in ('cap', 'pendent', 'reclamada', 'acceptada', 'rebutjada', 'tancada')),
  claim_reference text,
  notes text,
  updated_by uuid references auth.users (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Resum determinista d'una liquidació: el que es pot facturar, el que ja s'ha facturat i el que falta.
create or replace function public.bill_statement_summary(p_statement uuid)
returns table (lines integer, positives numeric, negatives numeric, billable numeric, invoiced numeric, drafts numeric, pending numeric, doubtful integer)
language sql stable set search_path = public as $$
  with l as (
    select fl.amount, fl.match_status, coalesce(c.accepted_amount, fl.amount) as acc
      from fin_statement_lines fl left join bill_statement_claims c on c.statement_line_id = fl.id
     where fl.statement_id = p_statement and fl.match_status not in ('duplicat', 'descartat')
  ), inv as (
    select coalesce(sum(case when i.status <> 'esborrany' then s.amount * case when i.kind = 'rectificativa' then -1 else 1 end end), 0) as done,
           coalesce(sum(case when i.status = 'esborrany' then s.amount end), 0) as dr
      from bill_invoice_statements s join bill_invoices i on i.id = s.invoice_id
     where s.statement_id = p_statement
  )
  select (select count(*)::int from l),
         (select coalesce(sum(amount), 0) from l where amount > 0),
         (select coalesce(sum(amount), 0) from l where amount < 0),
         (select coalesce(sum(acc), 0) from l),
         inv.done, inv.dr,
         (select coalesce(sum(acc), 0) from l) - inv.done,
         (select count(*)::int from l where match_status in ('pendent', 'diferencia', 'no_identificat'))
    from inv;
$$;

-- ============================================================ 7. enviaments per correu i registre d'operacions
create table if not exists public.bill_email_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.bill_invoices (id) on delete restrict,
  to_email text not null,
  cc text,
  subject text not null,
  status text not null check (status in ('acceptat', 'error')),   -- «acceptat» = el servidor SMTP l'ha acceptat
  provider_message_id text,
  error text,
  sent_by uuid references auth.users (id) default auth.uid(),
  sent_at timestamptz not null default now()
);
create index if not exists bill_email_log_idx on public.bill_email_log (invoice_id, sent_at desc);

create table if not exists public.bill_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid default auth.uid(),
  actor_name text,
  invoice_id uuid,
  client_id uuid,
  action text not null,
  detail jsonb
);
create index if not exists bill_events_invoice_idx on public.bill_events (invoice_id, at);

create or replace function public.bill_events_ro() returns trigger language plpgsql as $$
begin
  raise exception 'El registre de facturació no es pot modificar ni esborrar' using errcode = '42501';
end $$;
drop trigger if exists bill_events_ro on public.bill_events;
create trigger bill_events_ro before update or delete on public.bill_events for each row execute function public.bill_events_ro();

create or replace function public.bill_log(p_action text, p_invoice uuid, p_client uuid, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into bill_events (actor_id, actor_name, invoice_id, client_id, action, detail)
  values (auth.uid(), (select name from profiles where id = auth.uid()), p_invoice, p_client, p_action, p_detail);
$$;

create or replace function public.bill_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'bill_clients' then
    perform public.bill_log('client_' || lower(tg_op), null, coalesce(new.id, old.id),
      case when tg_op = 'UPDATE' then jsonb_build_object('camps', (select jsonb_agg(k) from jsonb_object_keys(to_jsonb(new)) k
        where k not in ('updated_at', 'search') and to_jsonb(new) -> k is distinct from to_jsonb(old) -> k)) end);
  elsif tg_table_name = 'bill_payments' then
    perform public.bill_log('cobrament', new.invoice_id, null, jsonb_build_object('import', new.amount, 'data', new.paid_at, 'ref', new.reference));
  elsif tg_table_name = 'bill_settings' then
    perform public.bill_log('configuracio', null, null, jsonb_build_object('iban_canviat', new.iban is distinct from old.iban));
  end if;
  return null;
end $$;
drop trigger if exists bill_clients_audit on public.bill_clients;
create trigger bill_clients_audit after insert or update or delete on public.bill_clients for each row execute function public.bill_audit();
drop trigger if exists bill_payments_audit on public.bill_payments;
create trigger bill_payments_audit after insert on public.bill_payments for each row execute function public.bill_audit();
drop trigger if exists bill_settings_audit on public.bill_settings;
create trigger bill_settings_audit after update on public.bill_settings for each row execute function public.bill_audit();

-- ============================================================ 8. operacions transaccionals
-- EMETRE: valida, reserva el número (bloqueig de fila), copia les dades fiscals i segella la factura.
create or replace function public.bill_issue_invoice(p_id uuid, p_issue_date date default null)
returns public.bill_invoices language plpgsql security definer set search_path = public as $$
declare
  inv bill_invoices; cl bill_clients; cfg bill_settings; orig bill_invoices;
  d date; y integer; n integer; no text; ph text; missing text[] := '{}'; last_d date;
begin
  if auth.uid() is not null and not public.has_perm('facturacio', 'approve') then
    raise exception 'No tens permís per emetre factures' using errcode = '42501';
  end if;
  select * into inv from bill_invoices where id = p_id for update;
  if inv.id is null then raise exception 'Factura no trobada' using errcode = 'P0002'; end if;
  if inv.status <> 'esborrany' then raise exception 'La factura ja és emesa (%)', inv.invoice_no using errcode = '23514'; end if;
  select * into cfg from bill_settings where id = 1;
  if cfg.id is null then raise exception 'Falta la configuració de l''emissor (Facturació › Configuració)' using errcode = '23514'; end if;
  select * into cl from bill_clients where id = inv.client_id;

  if cl.status <> 'actiu' then missing := array_append(missing, 'client actiu'); end if;
  if cl.nif_norm = '' then missing := array_append(missing, 'NIF/CIF del client'); end if;
  if coalesce(trim(cl.address), '') = '' then missing := array_append(missing, 'adreça fiscal'); end if;
  if coalesce(trim(cl.postal_code), '') = '' then missing := array_append(missing, 'codi postal'); end if;
  if coalesce(trim(cl.city), '') = '' then missing := array_append(missing, 'població'); end if;
  if not exists (select 1 from bill_invoice_lines where invoice_id = p_id) then missing := array_append(missing, 'línies'); end if;
  if coalesce(trim(inv.concept), '') = '' then missing := array_append(missing, 'concepte'); end if;
  if exists (select 1 from bill_invoice_lines where invoice_id = p_id and vat_rate = 0 and coalesce(trim(vat_exemption), '') = '') then
    missing := array_append(missing, 'causa d''exempció de les línies amb IVA 0 %');
  end if;
  if inv.kind = 'rectificativa' and coalesce(trim(inv.rectification_reason), '') = '' then missing := array_append(missing, 'motiu de la rectificació'); end if;
  if cl.needs_review then missing := array_append(missing, 'revisar la fitxa del client (' || coalesce(cl.review_notes, 'marcada per revisar') || ')'); end if;
  if array_length(missing, 1) > 0 then
    raise exception 'No es pot emetre. Falta: %', array_to_string(missing, ', ') using errcode = '23514';
  end if;

  perform public.bill_recalc(p_id);
  select * into inv from bill_invoices where id = p_id;
  if inv.total = 0 then raise exception 'No es pot emetre una factura amb total 0' using errcode = '23514'; end if;
  if inv.kind = 'ordinaria' and inv.total < 0 then raise exception 'Una factura ordinària no pot ser negativa: fes una rectificativa' using errcode = '23514'; end if;

  -- no facturar dues vegades la mateixa liquidació
  if exists (select 1 from bill_invoice_statements s, lateral public.bill_statement_summary(s.statement_id) m
              where s.invoice_id = p_id and inv.kind = 'ordinaria' and m.invoiced + s.amount > m.billable + 0.005) then
    raise exception 'Aquesta factura supera l''import pendent de facturar d''alguna liquidació vinculada (ja s''ha facturat)' using errcode = '23505';
  end if;

  d := coalesce(p_issue_date, inv.issue_date, current_date);
  y := extract(year from d)::int;
  insert into bill_series (code, year) values (inv.series, y) on conflict do nothing;
  update bill_series set last_number = last_number + 1, updated_at = now()
   where code = inv.series and year = y returning last_number into n;           -- bloqueja la fila fins al final
  select max(issue_date) into last_d from bill_invoices where series = inv.series and year = y and status <> 'esborrany';
  if last_d is not null and d < last_d then
    raise exception 'La data (%) és anterior a l''última factura emesa de la sèrie (%)', d, last_d using errcode = '23514';
  end if;
  no := case inv.series when 'REC' then 'R' else '' end || lpad((y % 100)::text, 2, '0') || '-' || lpad(n::text, 3, '0');
  while exists (select 1 from bill_invoices where invoice_no = no) or exists (select 1 from bill_number_gaps where series = inv.series and year = y and number = n) loop
    update bill_series set last_number = last_number + 1 where code = inv.series and year = y returning last_number into n;
    no := case inv.series when 'REC' then 'R' else '' end || lpad((y % 100)::text, 2, '0') || '-' || lpad(n::text, 3, '0');
  end loop;
  select record_hash into ph from bill_invoices where series = inv.series and record_hash is not null order by issued_at desc nulls last, issue_date desc limit 1;

  perform set_config('bill.issuing', p_id::text, true);
  update bill_invoices set
    status = 'emesa', year = y, number = n, invoice_no = no, issue_date = d,
    due_date = coalesce(due_date, d + coalesce(cl.due_days, cfg.default_due_days)),
    order_ref_label = coalesce(order_ref_label, cl.order_ref_label), order_ref = coalesce(order_ref, cl.order_ref),
    client_snapshot = jsonb_build_object('legal_name', cl.legal_name, 'trade_name', cl.trade_name, 'nif', cl.nif, 'address', cl.address,
      'postal_code', cl.postal_code, 'city', cl.city, 'province', cl.province, 'country', cl.country),
    issuer_snapshot = jsonb_build_object('name', cfg.issuer_name, 'nif', cfg.issuer_nif, 'address', cfg.issuer_address,
      'postal_code', cfg.issuer_postal_code, 'city', cfg.issuer_city, 'province', cfg.issuer_province, 'iban', cfg.iban),
    prev_hash = ph,
    record_hash = encode(sha256(convert_to(concat_ws('|', cfg.issuer_nif, no, d::text, inv.base::text, inv.vat::text, inv.total::text, cl.nif_norm, coalesce(ph, '')), 'UTF8')), 'hex'),
    issued_by = auth.uid(), issued_at = now()
  where id = p_id returning * into inv;
  perform set_config('bill.issuing', '', true);

  if inv.kind = 'rectificativa' then
    update bill_invoices set status = 'rectificada' where id = inv.rectifies_id and status <> 'esborrany';
  end if;
  perform public.bill_log('emissio', inv.id, inv.client_id, jsonb_build_object('numero', inv.invoice_no, 'total', inv.total));
  return inv;
end $$;

-- RECTIFICATIVA: crea un esborrany a la sèrie REC amb les línies en negatiu (es pot editar abans d'emetre).
create or replace function public.bill_create_rectification(p_original uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o bill_invoices; rid uuid;
begin
  if auth.uid() is not null and not public.has_perm('facturacio', 'edit') then
    raise exception 'No tens permís per preparar rectificatives' using errcode = '42501';
  end if;
  select * into o from bill_invoices where id = p_original;
  if o.id is null or o.status = 'esborrany' then raise exception 'Només es pot rectificar una factura emesa' using errcode = '23514'; end if;
  insert into bill_invoices (kind, client_id, concept, period_label, period_from, period_to, rectifies_id, rectification_reason, origin, notes)
  values ('rectificativa', o.client_id, 'Rectificació de la factura ' || o.invoice_no, o.period_label, o.period_from, o.period_to, o.id, p_reason, 'manual',
          'Rectifica la factura ' || o.invoice_no || ' de ' || to_char(o.issue_date, 'DD/MM/YYYY') || '. Motiu: ' || p_reason)
  returning id into rid;
  if exists (select 1 from bill_invoice_lines where invoice_id = o.id) then
    insert into bill_invoice_lines (invoice_id, line_no, description, quantity, unit_price, vat_rate, vat_exemption)
    select rid, line_no, description, -quantity, unit_price, vat_rate, vat_exemption from bill_invoice_lines where invoice_id = o.id;
  else
    insert into bill_invoice_lines (invoice_id, line_no, description, quantity, unit_price, vat_rate)
    select rid, 1, 'Anul·lació de la factura ' || o.invoice_no, -1, o.base, (b ->> 'rate')::numeric
      from jsonb_array_elements(case when jsonb_array_length(o.vat_breakdown) > 0 then o.vat_breakdown else '[{"rate":21}]' end) b limit 1;
  end if;
  perform public.bill_log('rectificativa_preparada', rid, o.client_id, jsonb_build_object('original', o.invoice_no));
  return rid;
end $$;

-- COBRAMENT: total o parcial. No es pot cobrar més del pendent; un cobrament repetit (mateixa ref., import i data) es rebutja.
create or replace function public.bill_register_payment(p_invoice uuid, p_amount numeric, p_date date, p_method text default 'transferencia', p_ref text default null, p_notes text default null)
returns public.bill_invoices language plpgsql security definer set search_path = public as $$
declare inv bill_invoices; amt numeric(14, 2) := round(p_amount, 2); newpaid numeric(14, 2);
begin
  if auth.uid() is not null and not public.has_perm('facturacio', 'approve') then
    raise exception 'No tens permís per registrar cobraments' using errcode = '42501';
  end if;
  select * into inv from bill_invoices where id = p_invoice for update;
  if inv.id is null or inv.status = 'esborrany' then raise exception 'Només es poden cobrar factures emeses' using errcode = '23514'; end if;
  if inv.status = 'rectificada' and amt > 0 then raise exception 'La factura està rectificada: registra el cobrament a la rectificativa o revisa-ho' using errcode = '23514'; end if;
  newpaid := inv.paid + amt;
  if abs(newpaid) > abs(inv.total) + 0.004 or sign(newpaid) * sign(inv.total) < 0 then
    raise exception 'L''import supera el pendent de cobrar (pendent: % €)', inv.total - inv.paid using errcode = '23514';
  end if;
  insert into bill_payments (invoice_id, amount, paid_at, method, reference, notes, idempotency_key)
  values (p_invoice, amt, p_date, coalesce(p_method, 'transferencia'), nullif(trim(p_ref), ''), p_notes,
          p_invoice::text || '|' || amt::text || '|' || p_date::text || '|' || lower(coalesce(trim(p_ref), '')));
  update bill_invoices set paid = newpaid, payment_unknown = false,
         status = case when inv.status = 'rectificada' then 'rectificada' when newpaid = total then 'cobrada' when newpaid = 0 then 'emesa' else 'parcialment_cobrada' end
   where id = p_invoice returning * into inv;
  return inv;
end $$;

-- ============================================================ 9. vista per a llistats i panell
create or replace view public.bill_invoices_v with (security_invoker = true) as
  select i.*,
         coalesce(i.client_snapshot ->> 'legal_name', c.legal_name) as client_name,
         coalesce(i.client_snapshot ->> 'nif', c.nif) as client_nif,
         (i.total - i.paid) as pending,
         case
           when i.status = 'esborrany' then 'esborrany'
           when i.status in ('cobrada', 'rectificada') then i.status
           when i.payment_unknown then 'cobrament_no_consta'
           when i.due_date is not null and i.due_date < current_date then 'vencuda'
           when i.status = 'parcialment_cobrada' then 'parcialment_cobrada'
           else 'pendent_cobrament'
         end as display_status
    from public.bill_invoices i join public.bill_clients c on c.id = i.client_id;

-- ============================================================ 10. seguretat (RLS) i permisos del mòdul «facturacio»
alter table public.bill_settings enable row level security;
alter table public.bill_clients enable row level security;
alter table public.bill_series enable row level security;
alter table public.bill_number_gaps enable row level security;
alter table public.bill_invoices enable row level security;
alter table public.bill_invoice_lines enable row level security;
alter table public.bill_payments enable row level security;
alter table public.bill_invoice_statements enable row level security;
alter table public.bill_statement_claims enable row level security;
alter table public.bill_email_log enable row level security;
alter table public.bill_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['bill_settings', 'bill_clients', 'bill_series', 'bill_number_gaps', 'bill_invoices', 'bill_invoice_lines',
                           'bill_payments', 'bill_invoice_statements', 'bill_statement_claims', 'bill_email_log', 'bill_events'] loop
    execute format('drop policy if exists p_%1$s_read on public.%1$I', t);
    execute format('create policy p_%1$s_read on public.%1$I for select to authenticated using (public.has_perm(''facturacio'', ''read''))', t);
  end loop;
  foreach t in array array['bill_clients', 'bill_invoices', 'bill_invoice_lines', 'bill_invoice_statements', 'bill_statement_claims'] loop
    execute format('drop policy if exists p_%1$s_write on public.%1$I', t);
    execute format('create policy p_%1$s_write on public.%1$I for all to authenticated using (public.has_perm(''facturacio'', ''edit'')) with check (public.has_perm(''facturacio'', ''edit''))', t);
  end loop;
end $$;
drop policy if exists p_bill_settings_admin on public.bill_settings;
create policy p_bill_settings_admin on public.bill_settings for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists p_bill_gaps_approve on public.bill_number_gaps;
create policy p_bill_gaps_approve on public.bill_number_gaps for update to authenticated using (public.has_perm('facturacio', 'approve')) with check (public.has_perm('facturacio', 'approve'));
drop policy if exists p_bill_email_insert on public.bill_email_log;
create policy p_bill_email_insert on public.bill_email_log for insert to authenticated with check (public.has_perm('facturacio', 'edit'));
-- bill_series, bill_payments i bill_events només s'escriuen amb les funcions anteriors (security definer).

-- Permisos per defecte (Direcció ho té tot sempre). Comercials, caps d'equip i col·laboradors: sense accés.
-- Aprovar = emetre factures i registrar cobraments. Només s'insereixen si no hi ha cap configuració prèvia.
insert into public.role_permissions (role, module, can_read, can_edit, can_approve) values
  ('cap_administrativa', 'facturacio', true, true, true),
  ('administrativa', 'facturacio', true, true, false)
on conflict (role, module) do nothing;

-- ============================================================ COMPROVACIÓ (ha de donar 11 · 3 · 2)
select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'bill\_%') as taules_facturacio,
       (select count(*) from pg_proc where proname in ('bill_issue_invoice', 'bill_register_payment', 'bill_create_rectification')) as funcions_clau,
       (select count(*) from public.role_permissions where module = 'facturacio') as permisos_per_defecte;
