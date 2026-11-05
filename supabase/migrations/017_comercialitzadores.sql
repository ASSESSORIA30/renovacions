-- =====================================================================================================
-- Fase 8.1 · 017 · COMERCIALITZADORES, CONTRACTES DE COL·LABORACIÓ, LECTURA AMB IA I RETROCESSIONS
-- =====================================================================================================
-- Migració ADDITIVA i idempotent. No esborra cap taula, dada ni relació. Desfer: 017_comercialitzadores_down.sql
--
-- Principis:
--   · Capa A (el que la comercialitzadora paga a Assessoria 3.0) i capa B (el que Assessoria 3.0 paga als comercials)
--     continuen separades: les regles aprovades aquí entren SEMPRE a fin_rules amb layer = 'proveidor'.
--   · La IA només PROPOSA. Cap condició extreta (retailer_terms) arriba al motor de comissions sense l'aprovació
--     expressa de Direcció (retailer_approve_term). Les condicions ambigües queden en «revisió manual».
--   · Traçabilitat: cada condició guarda document, versió, pàgina, fragment literal, interpretació, confiança i estat.
--   · Versions: un contracte nou crea una versió nova de la regla; l'anterior es tanca (valid_to) i es conserva
--     per als contractes antics. No es recalcula cap comissió històrica.
--   · Retrocessions reals: només amb evidència (línia de liquidació o justificació) i per Direcció.
--   · Accés: Direcció i, si Direcció ho autoritza (mòdul «comercialitzadores»), Cap administrativa / Administrativa.
--     MAI comercials, caps d'equip ni col·laboradors (ho comprova la funció, no només la interfície).
-- Requereix: 011 i 014 (i 016 per a la coherència de rols).
-- =====================================================================================================

-- ============================================================ 1. accés
create or replace function public.retailer_access(p_action text default 'read') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
      or (coalesce(public.my_role() in ('cap_administrativa', 'administrativa'), false) and public.has_perm('comercialitzadores', p_action));
$$;
grant execute on function public.retailer_access(text) to authenticated;

insert into public.role_permissions (role, module, can_read, can_edit, can_approve) values
  ('cap_administrativa', 'comercialitzadores', false, false, false),
  ('administrativa', 'comercialitzadores', false, false, false)
on conflict (role, module) do nothing;

-- ============================================================ 2. fitxa de comercialitzadora
create table if not exists public.retailers (
  id uuid primary key default gen_random_uuid(),
  trade_name text not null check (length(trim(trade_name)) between 1 and 120),
  legal_name text,
  tax_id text,
  aliases text[] not null default '{}',            -- noms amb què apareix als contractes del CRM (p. ex. «Nufri Energía»)
  logo_path text,
  website text,
  contact_name text,
  phone text,
  email text,
  services text[] not null default '{}' check (services <@ array['llum', 'gas', 'fibra', 'assegurances', 'altres']::text[]),
  status text not null default 'pendent' check (status in ('activa', 'pendent', 'suspesa', 'inactiva')),
  special_conditions text,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists retailers_name_uq on public.retailers (lower(trade_name));

-- ============================================================ 3. contractes de col·laboració, annexos i tarifes (amb versions)
create table if not exists public.retailer_documents (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  kind text not null default 'contracte' check (kind in ('contracte', 'annex', 'tarifes', 'condicions', 'altres')),
  parent_id uuid references public.retailer_documents (id) on delete restrict,      -- annex d'un contracte
  supersedes_id uuid references public.retailer_documents (id) on delete restrict,  -- versió anterior que substitueix
  title text not null check (length(trim(title)) between 1 and 200),
  version integer not null default 1 check (version >= 1),
  valid_from date,
  valid_to date,
  auto_renewal boolean,
  renewal_notice_days integer not null default 60 check (renewal_notice_days between 0 and 730),
  status text not null default 'en_revisio' check (status in ('esborrany', 'en_revisio', 'vigent', 'substituit', 'vencut', 'anullat')),
  storage_path text,
  original_name text,
  mime text,
  size_bytes bigint,
  sha256 text,
  pages integer,
  notes text,
  uploaded_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index if not exists retailer_documents_retailer_idx on public.retailer_documents (retailer_id, created_at desc);
create unique index if not exists retailer_documents_sha_uq on public.retailer_documents (retailer_id, sha256) where sha256 is not null and status <> 'anullat';

-- ============================================================ 4. extraccions (cada lectura d'un document)
create table if not exists public.retailer_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.retailer_documents (id) on delete restrict,
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  status text not null default 'pendent' check (status in ('pendent', 'processant', 'completada', 'error', 'descartada')),
  method text not null check (method in ('ia', 'local')),          -- local = lector determinista, sense enviar res fora
  provider text,
  model text,
  ocr_used boolean not null default false,
  pages integer,
  text_chars integer,
  summary jsonb,                                                   -- resum estructurat (vigència, parts, objecte…)
  warnings jsonb not null default '[]',
  error text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists retailer_extractions_doc_idx on public.retailer_extractions (document_id, created_at desc);

-- ============================================================ 5. condicions extretes (proposta → revisió → aprovació)
create table if not exists public.retailer_terms (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.retailer_extractions (id) on delete restrict,
  document_id uuid not null references public.retailer_documents (id) on delete restrict,
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  category text not null check (category in ('remuneracio', 'retrocessio', 'penalitzacio', 'permanencia', 'vigencia', 'pagament', 'altres')),
  field text not null,                       -- camp normalitzat: per_mwh, per_kwh, fix_contracte, pct_marge, …, baixa_anticipada…
  product text,
  tariff text,                               -- peatge (2.0TD, 3.0TD, 6.1TD…) o tarifa comercial
  service text,
  segment text check (segment is null or segment in ('residencial', 'pime', 'gran_consum')),
  period_label text,                         -- període o tram al qual s'aplica, si n'hi ha
  value numeric(14, 6),
  unit text check (unit is null or unit in ('eur', 'eur_mwh', 'eur_kwh', 'pct', 'mesos', 'dies')),
  tiers jsonb,
  formula text,                              -- fórmula EXACTA del contracte (p. ex. prorrateig)
  conditions jsonb not null default '{}',
  valid_from date,
  valid_to date,
  -- traçabilitat
  page integer,
  excerpt text not null check (length(trim(excerpt)) > 0),   -- fragment literal del contracte
  excerpt_found boolean not null default false,              -- el servidor ha verificat que el fragment és al document
  interpretation text,                                       -- interpretació PROPOSADA (no és el que diu el contracte)
  confidence numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  ambiguous boolean not null default false,
  ambiguity_reason text,
  source text not null default 'ia' check (source in ('ia', 'local', 'manual')),
  review_status text not null default 'pendent' check (review_status in ('pendent', 'revisio_manual', 'aprovada', 'rebutjada')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  original jsonb,                                            -- valors proposats abans de cap correcció manual
  applied_rule_id uuid references public.fin_rules (id) on delete restrict,
  applied_clawback_id uuid,
  created_at timestamptz not null default now(),
  check (review_status <> 'aprovada' or reviewed_by is not null)
);
create index if not exists retailer_terms_extraction_idx on public.retailer_terms (extraction_id);
create index if not exists retailer_terms_retailer_idx on public.retailer_terms (retailer_id, review_status);

-- ============================================================ 6. regles de retrocessió i penalització (capa proveïdor)
create table if not exists public.retailer_clawback_rules (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id) on delete restrict,
  document_id uuid references public.retailer_documents (id) on delete restrict,
  term_id uuid references public.retailer_terms (id) on delete restrict,
  rule_key text not null,
  version integer not null default 1 check (version >= 1),
  name text not null,
  product text,
  service text,
  trigger text not null check (trigger in ('baixa_anticipada', 'impagament', 'anullacio', 'no_activat', 'canvi_titular', 'canvi_comercialitzadora', 'reduccio_consum', 'altres')),
  risk_months integer check (risk_months is null or risk_months between 0 and 120),
  start_event text not null default 'activacio' check (start_event in ('activacio', 'signatura', 'alta_subministrament', 'data_contracte', 'altres')),
  mode text not null check (mode in ('total', 'parcial', 'prorrata', 'formula', 'penalitzacio')),
  pct numeric(7, 4) check (pct is null or pct between 0 and 100),
  penalty_eur numeric(14, 2) check (penalty_eur is null or penalty_eur >= 0),
  formula text,
  min_consumption_pct numeric(7, 4),                 -- per a «reducció de consum»
  exceptions text,
  claim_days integer check (claim_days is null or claim_days >= 0),
  valid_from date not null default current_date,
  valid_to date,
  status text not null default 'aprovada' check (status in ('aprovada', 'retirada')),
  approved_by uuid references auth.users (id) default auth.uid(),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (rule_key, version),
  check (valid_to is null or valid_to >= valid_from),
  check (mode <> 'parcial' or pct is not null),
  check (mode <> 'total' or coalesce(pct, 100) = 100),
  check (mode <> 'formula' or coalesce(trim(formula), '') <> ''),
  check (mode <> 'penalitzacio' or penalty_eur is not null)
);
create index if not exists retailer_claw_retailer_idx on public.retailer_clawback_rules (retailer_id, status);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'retailer_terms_clawback_fk') then
    alter table public.retailer_terms add constraint retailer_terms_clawback_fk foreign key (applied_clawback_id) references public.retailer_clawback_rules (id) on delete restrict;
  end if;
end $$;

-- ============================================================ 7. motor de comissions: vincle i tipus nous (additiu)
alter table public.fin_rules add column if not exists retailer_id uuid references public.retailers (id) on delete restrict;
alter table public.fin_rules add column if not exists source_document_id uuid references public.retailer_documents (id) on delete restrict;
alter table public.fin_rules add column if not exists source_term_id uuid references public.retailer_terms (id) on delete restrict;

-- tipus nous: % sobre energia i % sobre potència. Es reemplacen NOMÉS les dues restriccions de llista de tipus/unitats
-- (es localitzen pel contingut, no pel nom, perquè a la 011 no tenien nom explícit) per una versió AMPLIADA.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.fin_rules'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%pct_comissio_rebuda%' and conname not in ('fin_rules_kind_v2', 'fin_rules_unit_v2') loop
    execute format('alter table public.fin_rules drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_kind_v2') then
    alter table public.fin_rules add constraint fin_rules_kind_v2 check (kind in ('fix_contracte', 'per_mwh', 'pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'trams_volum', 'bonificacio', 'regularitzacio', 'retrocessio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_unit_v2') then
    alter table public.fin_rules add constraint fin_rules_unit_v2 check (unit = case when kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'retrocessio') then 'pct' when kind = 'per_mwh' then 'eur_mwh' else 'eur' end);
  end if;
end $$;

-- ============================================================ 8. bucket privat
insert into storage.buckets (id, name, public, file_size_limit)
values ('retailer-contracts', 'retailer-contracts', false, 26214400)
on conflict (id) do nothing;
-- Sense polítiques per a `authenticated`: només el servidor (després de comprovar retailer_access) hi llegeix i hi escriu.

-- ============================================================ 9. RLS
alter table public.retailers enable row level security;
alter table public.retailer_documents enable row level security;
alter table public.retailer_extractions enable row level security;
alter table public.retailer_terms enable row level security;
alter table public.retailer_clawback_rules enable row level security;

do $$
declare t text;
begin
  foreach t in array array['retailers', 'retailer_documents', 'retailer_extractions', 'retailer_terms', 'retailer_clawback_rules'] loop
    execute format('drop policy if exists %I on public.%I', 'p_' || t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.retailer_access(''read''))', 'p_' || t || '_select', t);
    execute format('drop policy if exists %I on public.%I', 'p_' || t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.retailer_access(''edit''))', 'p_' || t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', 'p_' || t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.retailer_access(''edit'')) with check (public.retailer_access(''edit''))', 'p_' || t || '_update', t);
  end loop;
end $$;
-- les regles de retrocessió aprovades només les crea Direcció (via retailer_approve_term)
drop policy if exists p_retailer_clawback_rules_insert on public.retailer_clawback_rules;
create policy p_retailer_clawback_rules_insert on public.retailer_clawback_rules for insert to authenticated with check (public.is_admin());
drop policy if exists p_retailer_clawback_rules_update on public.retailer_clawback_rules;
create policy p_retailer_clawback_rules_update on public.retailer_clawback_rules for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- (sense DELETE: res d'això s'esborra; es retira o s'anul·la)

-- ============================================================ 10. integritat, immutabilitat i auditoria
create or replace function public.retailer_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists retailers_touch on public.retailers;
create trigger retailers_touch before update on public.retailers for each row execute function public.retailer_touch();
drop trigger if exists retailer_documents_touch on public.retailer_documents;
create trigger retailer_documents_touch before update on public.retailer_documents for each row execute function public.retailer_touch();

-- una condició aprovada o rebutjada ja no es modifica (es conserva tal com es va decidir)
create or replace function public.retailer_term_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.review_status in ('aprovada', 'rebutjada') then
    raise exception 'Aquesta condició ja està %: no es pot modificar', old.review_status using errcode = '42501';
  end if;
  if new.review_status = 'aprovada' and old.review_status <> 'aprovada' and auth.uid() is not null and not public.is_admin() then
    raise exception 'Només Direcció aprova condicions econòmiques' using errcode = '42501';
  end if;
  if new.review_status in ('aprovada', 'rebutjada') then
    new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
    new.reviewed_at := now();
  end if;
  -- es guarda la proposta original de la IA abans de la primera correcció
  if old.original is null and (new.value, new.unit, new.field, new.product, new.formula, new.valid_from, new.valid_to)
       is distinct from (old.value, old.unit, old.field, old.product, old.formula, old.valid_from, old.valid_to) then
    new.original := jsonb_build_object('value', old.value, 'unit', old.unit, 'field', old.field, 'product', old.product, 'formula', old.formula, 'valid_from', old.valid_from, 'valid_to', old.valid_to);
  end if;
  return new;
end $$;
drop trigger if exists retailer_terms_guard on public.retailer_terms;
create trigger retailer_terms_guard before update on public.retailer_terms for each row execute function public.retailer_term_guard();

create or replace function public.retailer_claw_guard() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['status', 'valid_to']) is distinct from (to_jsonb(old) - array['status', 'valid_to'])
     or (old.valid_to is not null and new.valid_to is distinct from old.valid_to)
     or (old.status = 'retirada' and new.status <> 'retirada') then
    raise exception 'Regla de retrocessió aprovada: no es modifica, se''n crea una versió nova' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists retailer_claw_guard on public.retailer_clawback_rules;
create trigger retailer_claw_guard before update on public.retailer_clawback_rules for each row execute function public.retailer_claw_guard();

create or replace function public.retailer_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare a text; d jsonb;
begin
  if tg_table_name = 'retailers' then
    a := case when tg_op = 'INSERT' then 'comercialitzadora_alta' when new.status is distinct from old.status then 'comercialitzadora_estat:' || new.status else 'comercialitzadora_editada' end;
    d := jsonb_build_object('name', new.trade_name, 'status', new.status);
  elsif tg_table_name = 'retailer_documents' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.valid_to is not distinct from old.valid_to and new.valid_from is not distinct from old.valid_from then return new; end if;
    a := case when tg_op = 'INSERT' then 'contracte_comercialitzadora_pujat' else 'contracte_comercialitzadora_estat:' || new.status end;
    d := jsonb_build_object('retailer', new.retailer_id, 'version', new.version, 'sha256', new.sha256, 'valid_from', new.valid_from, 'valid_to', new.valid_to);
  elsif tg_table_name = 'retailer_terms' then
    if new.review_status is not distinct from old.review_status then return new; end if;
    a := 'condicio_' || new.review_status;
    d := jsonb_build_object('retailer', new.retailer_id, 'document', new.document_id, 'field', new.field, 'value', new.value, 'unit', new.unit, 'rule', new.applied_rule_id, 'clawback', new.applied_clawback_id);
  else
    a := case when tg_op = 'INSERT' then 'retrocessio_regla_aprovada' else 'retrocessio_regla_' || new.status end;
    d := jsonb_build_object('retailer', new.retailer_id, 'rule_key', new.rule_key, 'version', new.version, 'trigger', new.trigger, 'mode', new.mode, 'pct', new.pct);
  end if;
  insert into sec_audit (actor_id, actor_name, action, entity, entity_id, detail)
  values (auth.uid(), (select name from profiles where id = auth.uid()), a, tg_table_name, new.id::text, d);
  return new;
end $$;
drop trigger if exists retailers_audit on public.retailers;
create trigger retailers_audit after insert or update on public.retailers for each row execute function public.retailer_audit();
drop trigger if exists retailer_documents_audit on public.retailer_documents;
create trigger retailer_documents_audit after insert or update on public.retailer_documents for each row execute function public.retailer_audit();
drop trigger if exists retailer_terms_audit on public.retailer_terms;
create trigger retailer_terms_audit after update on public.retailer_terms for each row execute function public.retailer_audit();
drop trigger if exists retailer_claw_audit on public.retailer_clawback_rules;
create trigger retailer_claw_audit after insert or update on public.retailer_clawback_rules for each row execute function public.retailer_audit();

-- ============================================================ 11. APROVACIÓ (atòmica, una condició per crida)
-- Direcció aprova una condició (amb correccions opcionals a p_patch) i el sistema:
--   · remuneració → fin_rules (layer 'proveidor', aprovada) amb versió nova si ja n'hi havia (l'anterior es tanca);
--   · retrocessió / penalització / permanència → retailer_clawback_rules (versió nova, l'anterior es tanca);
--   · vigència / pagament / altres → queda aprovada com a informació (vigència: actualitza les dates del document).
-- Les condicions marcades com a ambigües exigeixen p_confirm_manual = true (Direcció declara que les ha revisat).
create or replace function public.retailer_approve_term(p_term uuid, p_patch jsonb default '{}', p_confirm_manual boolean default false, p_base_validated boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  t retailer_terms; r retailers; doc retailer_documents;
  v_kind text; v_unit text; v_value numeric; v_key text; v_ver int; v_from date; v_to date; v_rule uuid; v_claw uuid;
  v_cond jsonb; v_label text; v_trigger text; v_mode text;
begin
  if not public.is_admin() then raise exception 'Només Direcció aprova condicions econòmiques' using errcode = '42501'; end if;
  select * into t from retailer_terms where id = p_term for update;
  if not found then raise exception 'Condició no trobada' using errcode = 'P0002'; end if;
  if t.review_status not in ('pendent', 'revisio_manual') then raise exception 'Aquesta condició ja està %', t.review_status using errcode = '23514'; end if;
  if (t.ambiguous or t.review_status = 'revisio_manual' or not t.excerpt_found) and not p_confirm_manual then
    raise exception 'REVISIÓ MANUAL NECESSÀRIA: confirma que has revisat el fragment del contracte abans d''aprovar' using errcode = '23514';
  end if;
  -- correccions de Direcció (es conserva l'original al disparador)
  if p_patch <> '{}'::jsonb then
    update retailer_terms set
      field = coalesce(p_patch->>'field', field), product = case when p_patch ? 'product' then nullif(p_patch->>'product', '') else product end,
      tariff = case when p_patch ? 'tariff' then nullif(p_patch->>'tariff', '') else tariff end,
      service = case when p_patch ? 'service' then nullif(p_patch->>'service', '') else service end,
      value = case when p_patch ? 'value' then (p_patch->>'value')::numeric else value end, unit = case when p_patch ? 'unit' then nullif(p_patch->>'unit', '') else unit end,
      formula = case when p_patch ? 'formula' then nullif(p_patch->>'formula', '') else formula end,
      tiers = case when p_patch ? 'tiers' then p_patch->'tiers' else tiers end,
      conditions = case when p_patch ? 'conditions' then conditions || (p_patch->'conditions') else conditions end,
      valid_from = case when p_patch ? 'valid_from' then nullif(p_patch->>'valid_from', '')::date else valid_from end,
      valid_to = case when p_patch ? 'valid_to' then nullif(p_patch->>'valid_to', '')::date else valid_to end,
      review_note = coalesce(p_patch->>'note', review_note)
    where id = p_term;
    select * into t from retailer_terms where id = p_term;
  end if;
  select * into r from retailers where id = t.retailer_id;
  select * into doc from retailer_documents where id = t.document_id;
  v_from := coalesce(t.valid_from, doc.valid_from, current_date);
  v_to := coalesce(t.valid_to, doc.valid_to);
  v_cond := t.conditions || jsonb_build_object('source', jsonb_build_object('document', doc.title, 'version', doc.version, 'page', t.page, 'excerpt', left(t.excerpt, 600)))
            || case when t.tariff is not null then jsonb_build_object('tariff', t.tariff) else '{}'::jsonb end;

  if t.category = 'remuneracio' then
    v_kind := case t.field when 'per_kwh' then 'per_mwh' when 'rappel' then 'trams_volum' when 'escalonada' then 'trams_volum' else t.field end;
    if v_kind not in ('fix_contracte', 'per_mwh', 'pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'trams_volum', 'bonificacio', 'regularitzacio') then
      raise exception 'Tipus de remuneració no admès pel motor: %', t.field using errcode = '23514';
    end if;
    v_value := case when t.field = 'per_kwh' then t.value * 1000 else t.value end;   -- €/kWh → €/MWh (exacte)
    if t.field = 'per_kwh' then v_cond := v_cond || jsonb_build_object('source_unit', 'eur_kwh', 'source_value', t.value); end if;
    if t.field = 'escalonada' then v_cond := v_cond || jsonb_build_object('policy', 'acumulat'); end if;
    v_unit := case when v_kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia') then 'pct' when v_kind = 'per_mwh' then 'eur_mwh' else 'eur' end;
    if v_kind = 'trams_volum' and (t.tiers is null or jsonb_typeof(t.tiers) <> 'array' or jsonb_array_length(t.tiers) = 0) then raise exception 'Falten els trams' using errcode = '23514'; end if;
    if v_kind <> 'trams_volum' and v_value is null then raise exception 'Falta l''import o percentatge' using errcode = '23514'; end if;
    if v_unit = 'pct' and (not p_base_validated or coalesce(trim(t.formula), '') = '') then
      raise exception 'Per aprovar un percentatge cal la fórmula exacta de la base (p. ex. «12,5 %% × valor afegit») i confirmar que la base està validada' using errcode = '23514';
    end if;
    v_key := 'ret_' || left(md5(r.id::text || '|' || coalesce(lower(t.product), '') || '|' || v_kind || '|' || coalesce(lower(t.tariff), '') || '|' || coalesce(lower(t.service), '') || '|' || coalesce(t.conditions->>'applies_to', '')), 16);
    select coalesce(max(version), 0) + 1 into v_ver from fin_rules where rule_key = v_key;
    v_label := case v_kind when 'per_mwh' then '€/MWh' when 'fix_contracte' then 'fix per contracte' when 'trams_volum' then 'trams' when 'bonificacio' then 'bonificació' else '%' end;
    insert into fin_rules (rule_key, version, name, layer, retailer, product, service, segment, kind, value, unit, tiers, conditions, base_formula, base_validated,
                           valid_from, valid_to, status, notes, retailer_id, source_document_id, source_term_id)
    values (v_key, v_ver, left(r.trade_name || ' · ' || coalesce(t.product, 'general') || ' · ' || v_label, 160), 'proveidor', r.trade_name, t.product,
            case when t.service in ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes') then t.service end, t.segment,
            v_kind, case when v_kind = 'trams_volum' then null else v_value end, v_unit, case when v_kind = 'trams_volum' then t.tiers end, v_cond,
            coalesce(t.formula, case when v_unit = 'pct' then null else t.excerpt end),
            true,
            v_from, v_to, 'aprovada', 'Extret de «' || doc.title || '» v' || doc.version || coalesce(' p.' || t.page, '') || ' i aprovat per Direcció.', r.id, doc.id, t.id)
    returning id into v_rule;
    update retailer_terms set review_status = 'aprovada', applied_rule_id = v_rule where id = p_term;
    return jsonb_build_object('rule_id', v_rule, 'rule_key', v_key, 'version', v_ver);

  elsif t.category in ('retrocessio', 'penalitzacio', 'permanencia') then
    v_trigger := case when t.field in ('baixa_anticipada', 'impagament', 'anullacio', 'no_activat', 'canvi_titular', 'canvi_comercialitzadora', 'reduccio_consum') then t.field
                      else coalesce(nullif(t.conditions->>'trigger', ''), case when t.category = 'permanencia' then 'baixa_anticipada' else 'altres' end) end;
    v_mode := coalesce(nullif(t.conditions->>'mode', ''), case when t.category = 'penalitzacio' then 'penalitzacio' when t.formula is not null then 'formula' when t.unit = 'pct' and t.value = 100 then 'total' when t.unit = 'pct' then 'parcial' else 'total' end);
    v_key := 'claw_' || left(md5(r.id::text || '|' || coalesce(lower(t.product), '') || '|' || v_trigger || '|' || coalesce(lower(t.service), '')), 16);
    select coalesce(max(version), 0) + 1 into v_ver from retailer_clawback_rules where rule_key = v_key;
    update retailer_clawback_rules set valid_to = greatest(valid_from, v_from - 1) where rule_key = v_key and status = 'aprovada' and valid_to is null;
    insert into retailer_clawback_rules (retailer_id, document_id, term_id, rule_key, version, name, product, service, trigger, risk_months, start_event, mode, pct, penalty_eur, formula,
                                         min_consumption_pct, exceptions, claim_days, valid_from, valid_to)
    values (r.id, doc.id, t.id, v_key, v_ver, left(r.trade_name || ' · ' || replace(v_trigger, '_', ' ') || coalesce(' · ' || t.product, ''), 160), t.product, t.service, v_trigger,
            coalesce((t.conditions->>'risk_months')::int, case when t.unit = 'mesos' then t.value::int end),
            coalesce(nullif(t.conditions->>'start_event', ''), 'activacio'), v_mode,
            case when v_mode in ('total') then 100 when t.unit = 'pct' then t.value end,
            case when v_mode = 'penalitzacio' and t.unit = 'eur' then t.value end, t.formula,
            (t.conditions->>'min_consumption_pct')::numeric, t.conditions->>'exceptions', (t.conditions->>'claim_days')::int, v_from, v_to)
    returning id into v_claw;
    update retailer_terms set review_status = 'aprovada', applied_clawback_id = v_claw where id = p_term;
    return jsonb_build_object('clawback_id', v_claw, 'rule_key', v_key, 'version', v_ver);

  else
    if t.category = 'vigencia' then
      update retailer_documents set valid_from = coalesce(t.valid_from, valid_from), valid_to = coalesce(t.valid_to, valid_to) where id = doc.id;
    end if;
    update retailer_terms set review_status = 'aprovada' where id = p_term;
    return jsonb_build_object('info', true);
  end if;
end $$;
grant execute on function public.retailer_approve_term(uuid, jsonb, boolean, boolean) to authenticated;

/** Activa un document aprovat com a vigent i marca com a «substituït» el que reemplaça (es conserven tots dos). */
create or replace function public.retailer_activate_document(p_doc uuid) returns void
language plpgsql set search_path = public as $$
declare d retailer_documents;
begin
  if not public.is_admin() then raise exception 'Només Direcció activa contractes de comercialitzadores' using errcode = '42501'; end if;
  select * into d from retailer_documents where id = p_doc for update;
  if not found then raise exception 'Document no trobat' using errcode = 'P0002'; end if;
  update retailer_documents set status = 'vigent' where id = p_doc;
  if d.supersedes_id is not null then
    update retailer_documents set status = 'substituit', valid_to = coalesce(valid_to, greatest(coalesce(valid_from, d.valid_from), coalesce(d.valid_from, current_date) - 1))
     where id = d.supersedes_id and status <> 'anullat';
  end if;
end $$;
grant execute on function public.retailer_activate_document(uuid) to authenticated;

/** Retrocessió REAL (definitiva): només Direcció i només amb evidència (línia de liquidació del proveïdor o justificació). */
create or replace function public.retailer_apply_clawback(p_contract uuid, p_rule uuid, p_amount numeric, p_statement_line uuid default null, p_evidence text default null)
returns uuid language plpgsql set search_path = public as $$
declare k crm_contracts; cr retailer_clawback_rules; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Només Direcció registra retrocessions definitives' using errcode = '42501'; end if;
  if p_statement_line is null and length(coalesce(trim(p_evidence), '')) < 10 then
    raise exception 'Cal una evidència: la línia de liquidació de la comercialitzadora o una justificació documentada' using errcode = '23514';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Import no vàlid' using errcode = '23514'; end if;
  select * into k from crm_contracts where id = p_contract;
  if not found then raise exception 'Contracte no trobat' using errcode = 'P0002'; end if;
  select * into cr from retailer_clawback_rules where id = p_rule and status = 'aprovada';
  if not found then raise exception 'Regla de retrocessió no trobada o no aprovada' using errcode = 'P0002'; end if;
  insert into fin_ledger (contract_id, client_id, layer, beneficiary_id, kind, amount, period, description, statement_line_id, idempotency_key, created_by_name)
  values (k.id, k.client_id, 'proveidor', null, 'retrocessio', -round(p_amount, 2), current_date,
          left('Retrocessió ' || cr.name || ' (v' || cr.version || ')' || coalesce(' · ' || p_evidence, ''), 500), p_statement_line,
          'claw:' || k.id || ':' || cr.rule_key, (select name from profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.retailer_apply_clawback(uuid, uuid, numeric, uuid, text) to authenticated;

-- ============================================================ 12. alertes (mateix motor d'automatitzacions)
insert into public.crm_automation_rules (key, name, description, params) values
  ('comercialitzadora_venciment', 'Venciment de contracte amb comercialitzadora', 'Avisa Direcció quan un contracte de col·laboració venç dins el termini d''avís configurat al document.', '{}'),
  ('comercialitzadora_infrapagament', 'Comercialitzadora paga menys del pactat', 'Línies de liquidació del proveïdor amb import inferior al que estableixen les regles aprovades.', '{"min_eur": 5}')
on conflict (key) do nothing;
