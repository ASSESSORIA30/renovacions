-- =====================================================================================================
-- Fase 8.2 · 018 · RECLAMACIONS A COMERCIALITZADORES
-- =====================================================================================================
-- Migració ADDITIVA i idempotent (es pot executar més d'una vegada). No esborra ni modifica cap taula existent.
-- Desfer: 018_reclamacions_down.sql. Requereix: 011 (economia), 014 (permisos) i 017 (comercialitzadores).
--
-- Principis:
--   · Una reclamació agrupa diferències REALMENT reclamables d'una comercialitzadora i un període. El servidor
--     decideix què és reclamable (regla aprovada, termini de meritació vençut, sense excepcions); la base de dades
--     impedeix que una mateixa diferència sigui en dues reclamacions actives (índex únic sobre item_key).
--   · Ampliació o seguiment: una reclamació pot dependre d'una altra (parent_id). Si recull una diferència que ja era
--     en la reclamació anterior, aquella línia queda «traspassada» (es conserva l'historial).
--   · Un cop enviada, el que es reclama queda bloquejat: només s'hi registren respostes, imports reconeguts i recuperats.
--   · Historial (fin_claim_events) i imports recuperats (fin_claim_recoveries) només d'afegir.
--   · Res no s'envia automàticament: l'enviament el confirma sempre una persona (ho controla el servidor).
--   · Accés: Direcció i l'administració autoritzada (fin_staff, mòdul «economia») i, a més, la persona interna a qui
--     Direcció assigna la reclamació. Mai comercials, caps d'equip ni col·laboradors.
-- =====================================================================================================

-- ============================================================ 1. contactes de les comercialitzadores (liquidacions)
create table if not exists public.retailer_contacts (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  role text not null default 'liquidacions' check (role in ('liquidacions', 'comercial', 'juridic', 'altres')),
  is_default boolean not null default false,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists retailer_contacts_retailer_idx on public.retailer_contacts (retailer_id, role);
create unique index if not exists retailer_contacts_default_uq on public.retailer_contacts (retailer_id, role) where is_default;

-- ============================================================ 2. reclamacions (expedient)
create sequence if not exists public.fin_claim_seq;
create table if not exists public.fin_claims (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  retailer text not null check (length(trim(retailer)) between 1 and 120),      -- nom tal com apareix a les liquidacions
  retailer_id uuid references public.retailers (id) on delete set null,
  period_from date not null,
  period_to date not null,
  status text not null default 'esborrany' check (status in ('esborrany', 'pendent_enviament', 'enviada', 'pendent_resposta', 'en_revisio', 'acceptada_total', 'acceptada_parcial', 'rebutjada', 'resolta')),
  parent_id uuid references public.fin_claims (id) on delete restrict,          -- ampliació o seguiment d'una reclamació anterior
  total_claimed numeric(14, 2) not null default 0,
  total_recognized numeric(14, 2) not null default 0,
  total_recovered numeric(14, 2) not null default 0,
  items_count integer not null default 0,
  assigned_to uuid references auth.users (id) on delete set null,
  contact_id uuid references public.retailer_contacts (id) on delete set null,
  contact_name text,
  contact_email text,
  email_subject text,
  email_body text,
  sent_at timestamptz,
  sent_by uuid references auth.users (id),
  sent_channel text check (sent_channel is null or sent_channel in ('crm', 'extern')),
  response_due date,
  responded_at timestamptz,
  resolved_at timestamptz,
  pdf_sha256 text,                                   -- empremta del PDF enviat
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_to >= period_from),
  check (total_claimed >= 0 and total_recognized >= 0 and total_recovered >= 0)
);
create index if not exists fin_claims_retailer_idx on public.fin_claims (lower(retailer), period_from, period_to);
create index if not exists fin_claims_status_idx on public.fin_claims (status, response_due);
create index if not exists fin_claims_assignee_idx on public.fin_claims (assigned_to, status);

-- ============================================================ 3. diferències incloses
create table if not exists public.fin_claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.fin_claims (id) on delete cascade,
  item_key text not null check (length(item_key) between 3 and 200),           -- line:<id> · pendent:<contracte>:<període> · retro:<línia>
  kind text not null check (kind in ('infraliquidacio', 'pendent_liquidacio', 'retrocessio_improcedent', 'altres')),
  statement_line_id uuid references public.fin_statement_lines (id) on delete set null,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  client_id uuid references public.crm_clients (id) on delete set null,
  cups text,
  external_ref text,
  contract_ref text,
  client_name text,
  expected_amount numeric(14, 2) not null,           -- comissió prevista segons la regla aprovada
  settled_amount numeric(14, 2) not null default 0,  -- comissió liquidada per la comercialitzadora
  claimed_amount numeric(14, 2) not null check (claimed_amount > 0),
  recognized_amount numeric(14, 2) not null default 0 check (recognized_amount >= 0),
  recovered_amount numeric(14, 2) not null default 0 check (recovered_amount >= 0),
  reason_code text not null default 'pendent_revisio',
  reason_text text not null,
  reason_source text not null default 'regla' check (reason_source in ('regla', 'ia', 'manual', 'pendent_revisio')),
  rule_id uuid references public.fin_rules (id) on delete restrict,
  rule_ref jsonb,                                    -- {rule_key, version, document, page, excerpt}
  status text not null default 'reclamada' check (status in ('reclamada', 'acceptada', 'parcial', 'rebutjada', 'retirada', 'traspassada')),
  active boolean not null default true,
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recognized_amount <= claimed_amount)
);
create index if not exists fin_claim_items_claim_idx on public.fin_claim_items (claim_id);
create index if not exists fin_claim_items_contract_idx on public.fin_claim_items (contract_id);
create index if not exists fin_claim_items_line_idx on public.fin_claim_items (statement_line_id);
-- una diferència només pot ser en UNA reclamació activa
create unique index if not exists fin_claim_items_active_uq on public.fin_claim_items (item_key) where active;

-- ============================================================ 4. historial (només d'afegir)
create table if not exists public.fin_claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.fin_claims (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('creacio', 'estat', 'enviament', 'resposta', 'nota', 'justificant', 'recordatori', 'tasca', 'assignacio', 'regularitzacio', 'recuperacio', 'correu')),
  status_from text,
  status_to text,
  amount numeric(14, 2),
  body text,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  ref_id uuid,                                       -- tasca, línia de liquidació, recuperació… segons el tipus
  user_id uuid references auth.users (id) default auth.uid(),
  user_name text
);
create index if not exists fin_claim_events_claim_idx on public.fin_claim_events (claim_id, at desc);

-- ============================================================ 5. recordatoris
create table if not exists public.fin_claim_reminders (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.fin_claims (id) on delete cascade,
  remind_at timestamptz not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  note text,
  notified_at timestamptz,
  done_at timestamptz,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists fin_claim_reminders_due_idx on public.fin_claim_reminders (remind_at) where done_at is null and notified_at is null;

-- ============================================================ 6. imports recuperats (només d'afegir)
create table if not exists public.fin_claim_recoveries (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.fin_claims (id) on delete restrict,
  item_id uuid references public.fin_claim_items (id) on delete restrict,
  statement_line_id uuid references public.fin_statement_lines (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  received_at date not null,
  reference text,
  note text,
  idempotency_key text not null unique,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists fin_claim_recoveries_claim_idx on public.fin_claim_recoveries (claim_id);

-- ============================================================ 7. regularitzacions proposades (noves liquidacions → reclamacions)
create table if not exists public.fin_claim_links (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.fin_claims (id) on delete cascade,
  item_id uuid not null references public.fin_claim_items (id) on delete cascade,
  statement_line_id uuid not null references public.fin_statement_lines (id) on delete cascade,
  amount numeric(14, 2) not null,
  confidence numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  reason text not null,
  status text not null default 'proposada' check (status in ('proposada', 'confirmada', 'descartada')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists fin_claim_links_uq on public.fin_claim_links (statement_line_id, item_id);
create index if not exists fin_claim_links_claim_idx on public.fin_claim_links (claim_id, status);

-- ============================================================ 8. integritat
create or replace function public.fin_claim_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, 'REC-' || to_char(coalesce(new.period_to, current_date), 'YYYY') || '-' || lpad(nextval('public.fin_claim_seq')::text, 4, '0'));
    if new.status <> 'esborrany' then raise exception 'Una reclamació nova comença en esborrany' using errcode = '23514'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'esborrany' then raise exception 'Només es poden eliminar reclamacions en esborrany' using errcode = '42501'; end if;
    return old;
  end if;
  if new.status is distinct from old.status then
    if not (old.status, new.status) in (
      ('esborrany', 'pendent_enviament'), ('pendent_enviament', 'esborrany'), ('pendent_enviament', 'enviada'), ('esborrany', 'enviada'),
      ('enviada', 'pendent_resposta'), ('enviada', 'en_revisio'), ('enviada', 'acceptada_total'), ('enviada', 'acceptada_parcial'), ('enviada', 'rebutjada'),
      ('pendent_resposta', 'en_revisio'), ('pendent_resposta', 'acceptada_total'), ('pendent_resposta', 'acceptada_parcial'), ('pendent_resposta', 'rebutjada'),
      ('en_revisio', 'pendent_resposta'), ('en_revisio', 'acceptada_total'), ('en_revisio', 'acceptada_parcial'), ('en_revisio', 'rebutjada'),
      ('acceptada_total', 'resolta'), ('acceptada_parcial', 'resolta'), ('rebutjada', 'resolta'),
      ('acceptada_total', 'en_revisio'), ('acceptada_parcial', 'en_revisio'), ('rebutjada', 'en_revisio')) then
      raise exception 'Canvi d''estat de reclamació no permès: % → %', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'enviada' then
      new.sent_at := coalesce(new.sent_at, now());
      new.sent_by := coalesce(new.sent_by, auth.uid());
      if new.items_count = 0 then raise exception 'La reclamació no té cap diferència' using errcode = '23514'; end if;
    end if;
    if new.status in ('acceptada_total', 'acceptada_parcial', 'rebutjada') then new.responded_at := coalesce(new.responded_at, now()); end if;
    if new.status = 'resolta' then new.resolved_at := now(); end if;
  end if;
  -- el que es reclama queda bloquejat un cop enviada
  if old.status not in ('esborrany', 'pendent_enviament') and (new.retailer, new.period_from, new.period_to, new.parent_id) is distinct from (old.retailer, old.period_from, old.period_to, old.parent_id) then
    raise exception 'Reclamació enviada: la comercialitzadora i el període ja no es poden canviar' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fin_claims_before on public.fin_claims;
create trigger fin_claims_before before insert or update or delete on public.fin_claims for each row execute function public.fin_claim_before();

-- les línies: només es poden afegir o treure mentre la reclamació no s'ha enviat
create or replace function public.fin_claim_item_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from fin_claims where id = coalesce(new.claim_id, old.claim_id);
  if tg_op = 'INSERT' then
    if st not in ('esborrany', 'pendent_enviament') then raise exception 'Reclamació enviada: no s''hi poden afegir diferències (crea una ampliació)' using errcode = '42501'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if st not in ('esborrany', 'pendent_enviament') then raise exception 'Reclamació enviada: no se n''esborren diferències' using errcode = '42501'; end if;
    return old;
  end if;
  if st not in ('esborrany', 'pendent_enviament') and (new.claimed_amount, new.expected_amount, new.settled_amount, new.item_key, new.claim_id) is distinct from (old.claimed_amount, old.expected_amount, old.settled_amount, old.item_key, old.claim_id) then
    raise exception 'Reclamació enviada: l''import reclamat està bloquejat' using errcode = '42501';
  end if;
  new.active := new.status not in ('retirada', 'traspassada') and st not in ('resolta', 'rebutjada');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fin_claim_items_guard on public.fin_claim_items;
create trigger fin_claim_items_guard before insert or update or delete on public.fin_claim_items for each row execute function public.fin_claim_item_guard();

-- totals de la reclamació i línies inactives quan es tanca
create or replace function public.fin_claim_refresh(p_claim uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update fin_claims c set
    total_claimed = coalesce((select sum(claimed_amount) from fin_claim_items i where i.claim_id = c.id and i.status not in ('retirada', 'traspassada')), 0),
    total_recognized = coalesce((select sum(recognized_amount) from fin_claim_items i where i.claim_id = c.id and i.status not in ('retirada', 'traspassada')), 0),
    total_recovered = coalesce((select sum(amount) from fin_claim_recoveries r where r.claim_id = c.id), 0),
    items_count = (select count(*) from fin_claim_items i where i.claim_id = c.id and i.status not in ('retirada', 'traspassada'))
  where c.id = p_claim;
end $$;
create or replace function public.fin_claim_items_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_claim_refresh(coalesce(new.claim_id, old.claim_id));
  return null;
end $$;
drop trigger if exists fin_claim_items_after on public.fin_claim_items;
create trigger fin_claim_items_after after insert or update or delete on public.fin_claim_items for each row execute function public.fin_claim_items_after();

create or replace function public.fin_claim_recoveries_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null then
    update fin_claim_items set recovered_amount = coalesce((select sum(amount) from fin_claim_recoveries r where r.item_id = new.item_id), 0) where id = new.item_id;
  end if;
  perform public.fin_claim_refresh(new.claim_id);
  insert into fin_claim_events (claim_id, kind, amount, body, ref_id, user_id, user_name)
  values (new.claim_id, 'recuperacio', new.amount, coalesce(new.note, 'Import recuperat') || coalesce(' · ref. ' || new.reference, ''), new.id, auth.uid(), (select name from profiles where id = auth.uid()));
  return null;
end $$;
drop trigger if exists fin_claim_recoveries_after on public.fin_claim_recoveries;
create trigger fin_claim_recoveries_after after insert on public.fin_claim_recoveries for each row execute function public.fin_claim_recoveries_after();

create or replace function public.fin_claim_status_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into fin_claim_events (claim_id, kind, status_to, amount, body, user_id, user_name)
    values (new.id, 'creacio', new.status, new.total_claimed, 'Reclamació creada', auth.uid(), (select name from profiles where id = auth.uid()));
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into fin_claim_events (claim_id, kind, status_from, status_to, user_id, user_name)
    values (new.id, 'estat', old.status, new.status, auth.uid(), (select name from profiles where id = auth.uid()));
    -- quan es tanca (resolta o rebutjada) les seves diferències deixen de ser «actives» (es poden tornar a reclamar en un seguiment)
    if new.status in ('resolta', 'rebutjada') or old.status in ('resolta', 'rebutjada') then
      update fin_claim_items set updated_at = now() where claim_id = new.id;
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into fin_claim_events (claim_id, kind, body, ref_id, user_id, user_name)
    values (new.id, 'assignacio', 'Assignada a ' || coalesce((select name from profiles where id = new.assigned_to), '—'), new.assigned_to, auth.uid(), (select name from profiles where id = auth.uid()));
  end if;
  insert into fin_audit (user_id, user_name, entity, entity_id, action, amount, detail)
  select auth.uid(), (select name from profiles where id = auth.uid()), 'reclamacio', new.id::text, 'estat:' || new.status, new.total_claimed, jsonb_build_object('code', new.code, 'retailer', new.retailer)
  where new.status is distinct from old.status;
  return null;
end $$;
drop trigger if exists fin_claims_after on public.fin_claims;
create trigger fin_claims_after after insert or update on public.fin_claims for each row execute function public.fin_claim_status_after();

-- historial i recuperacions: no es modifiquen ni s'esborren
create or replace function public.fin_claim_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'Registre només d''afegir: no es pot modificar ni esborrar' using errcode = '42501';
end $$;
drop trigger if exists fin_claim_events_append on public.fin_claim_events;
create trigger fin_claim_events_append before update on public.fin_claim_events for each row execute function public.fin_claim_append_only();
drop trigger if exists fin_claim_recoveries_append on public.fin_claim_recoveries;
create trigger fin_claim_recoveries_append before update or delete on public.fin_claim_recoveries for each row execute function public.fin_claim_append_only();

create or replace function public.retailer_contacts_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists retailer_contacts_touch on public.retailer_contacts;
create trigger retailer_contacts_touch before update on public.retailer_contacts for each row execute function public.retailer_contacts_touch();

-- ============================================================ 9. bucket privat (PDF enviats i justificants)
insert into storage.buckets (id, name, public, file_size_limit)
values ('fin-claims', 'fin-claims', false, 10485760)
on conflict (id) do nothing;
-- Sense polítiques per a `authenticated`: només el servidor hi llegeix i hi escriu, després de comprovar l'accés.

-- ============================================================ 10. accés (després de crear les taules: la funció les consulta)
create or replace function public.fin_claim_access(p_claim uuid, p_action text default 'read') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.fin_staff(p_action), false)
      or (coalesce(public.is_staff(), false) and exists (select 1 from fin_claims c where c.id = p_claim and c.assigned_to = auth.uid()));
$$;

-- ============================================================ 11. RLS
alter table public.retailer_contacts enable row level security;
alter table public.fin_claims enable row level security;
alter table public.fin_claim_items enable row level security;
alter table public.fin_claim_events enable row level security;
alter table public.fin_claim_reminders enable row level security;
alter table public.fin_claim_recoveries enable row level security;
alter table public.fin_claim_links enable row level security;

drop policy if exists p_retailer_contacts_select on public.retailer_contacts;
create policy p_retailer_contacts_select on public.retailer_contacts for select to authenticated using (public.retailer_access('read') or public.fin_staff('read'));
drop policy if exists p_retailer_contacts_write on public.retailer_contacts;
create policy p_retailer_contacts_write on public.retailer_contacts for all to authenticated using (public.retailer_access('edit') or public.fin_staff('edit')) with check (public.retailer_access('edit') or public.fin_staff('edit'));

drop policy if exists p_fin_claims_select on public.fin_claims;
create policy p_fin_claims_select on public.fin_claims for select to authenticated using (public.fin_staff('read') or (public.is_staff() and assigned_to = auth.uid()));
drop policy if exists p_fin_claims_insert on public.fin_claims;
create policy p_fin_claims_insert on public.fin_claims for insert to authenticated with check (public.fin_staff('edit') and created_by = auth.uid());
drop policy if exists p_fin_claims_update on public.fin_claims;
create policy p_fin_claims_update on public.fin_claims for update to authenticated
  using (public.fin_staff('edit') or (public.is_staff() and assigned_to = auth.uid()))
  with check (public.fin_staff('edit') or (public.is_staff() and assigned_to = auth.uid()));
drop policy if exists p_fin_claims_delete on public.fin_claims;
create policy p_fin_claims_delete on public.fin_claims for delete to authenticated using (public.fin_staff('edit') and status = 'esborrany');

drop policy if exists p_fin_claim_items_select on public.fin_claim_items;
create policy p_fin_claim_items_select on public.fin_claim_items for select to authenticated using (public.fin_claim_access(claim_id, 'read'));
drop policy if exists p_fin_claim_items_insert on public.fin_claim_items;
create policy p_fin_claim_items_insert on public.fin_claim_items for insert to authenticated with check (public.fin_staff('edit'));
drop policy if exists p_fin_claim_items_update on public.fin_claim_items;
create policy p_fin_claim_items_update on public.fin_claim_items for update to authenticated using (public.fin_claim_access(claim_id, 'edit')) with check (public.fin_claim_access(claim_id, 'edit'));
drop policy if exists p_fin_claim_items_delete on public.fin_claim_items;
create policy p_fin_claim_items_delete on public.fin_claim_items for delete to authenticated using (public.fin_staff('edit'));

do $$
declare t text;
begin
  foreach t in array array['fin_claim_events', 'fin_claim_reminders', 'fin_claim_recoveries', 'fin_claim_links'] loop
    execute format('drop policy if exists %I on public.%I', 'p_' || t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.fin_claim_access(claim_id, ''read''))', 'p_' || t || '_select', t);
    execute format('drop policy if exists %I on public.%I', 'p_' || t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fin_claim_access(claim_id, ''edit''))', 'p_' || t || '_insert', t);
  end loop;
end $$;
drop policy if exists p_fin_claim_reminders_update on public.fin_claim_reminders;
create policy p_fin_claim_reminders_update on public.fin_claim_reminders for update to authenticated using (public.fin_claim_access(claim_id, 'edit')) with check (public.fin_claim_access(claim_id, 'edit'));
drop policy if exists p_fin_claim_links_update on public.fin_claim_links;
create policy p_fin_claim_links_update on public.fin_claim_links for update to authenticated using (public.fin_claim_access(claim_id, 'edit')) with check (public.fin_claim_access(claim_id, 'edit'));

-- ============================================================ 12. avisos automàtics (mateix motor que la resta)
insert into public.crm_automation_rules (key, name, description, params) values
  ('reclamacio_recordatori', 'Recordatori de reclamació', 'Avisa la persona indicada quan arriba la data d''un recordatori programat en una reclamació a una comercialitzadora.', '{}'),
  ('reclamacio_sense_resposta', 'Reclamació sense resposta', 'Reclamacions enviades sense resposta de la comercialitzadora després del termini indicat (o de X dies).', '{"days": 30}'),
  ('reclamacio_regularitzacio', 'Possible regularització d''una reclamació', 'Una liquidació nova conté línies que poden correspondre a una reclamació oberta (cal revisió humana).', '{}')
on conflict (key) do nothing;

-- ============================================================ COMPROVACIÓ (ha de retornar 7 taules, 1 bucket i 3 avisos)
select 'taules' as què, count(*) as total from information_schema.tables where table_schema = 'public'
   and table_name in ('retailer_contacts', 'fin_claims', 'fin_claim_items', 'fin_claim_events', 'fin_claim_reminders', 'fin_claim_recoveries', 'fin_claim_links')
union all select 'bucket fin-claims', count(*) from storage.buckets where id = 'fin-claims'
union all select 'avisos', count(*) from public.crm_automation_rules where key like 'reclamacio_%';
