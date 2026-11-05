-- 010 · CRM FASE 3: CONTRACTACIÓ DIGITAL, EXPEDIENTS I TRAMITACIONS
-- Additiva i idempotent: no esborra ni reescriu cap dada existent. Reversible amb 010_crm_contractacio_down.sql.
-- Requereix les migracions 008 (Clients 360°) i 009 (CRM comercial).
--
-- Principis:
--   · L'expedient NO duplica les dades del client ni del subministrament: les referencia.
--   · Les condicions acceptades es desen en una còpia IMMUTABLE i versionada (crm_expedient_terms).
--   · Proposta acceptada ≠ contracte signat ≠ enviat a la comercialitzadora ≠ activat: són estats i dates diferents.
--   · Una signatura només és vàlida si l'ha confirmada el proveïdor (servidor, webhook verificat) o si Administració
--     registra una signatura manuscrita adjuntant el document signat i una justificació.
--   · El contracte (crm_contracts) es crea quan l'activació està confirmada. El contracte anterior es conserva.
--   · Activar un contracte NO marca cap comissió com a meritada ni cobrada.

-- ============================================================ expedients
create sequence if not exists public.crm_expedient_seq;

create table if not exists public.crm_expedients (
  id uuid primary key default gen_random_uuid(),
  code text unique,                                                  -- EXP-AAAA-00001 (trigger)
  client_id uuid not null references public.crm_clients (id) on delete restrict,
  supply_id uuid references public.crm_supplies (id) on delete set null,
  opportunity_id uuid references public.crm_opportunities (id) on delete set null,
  comparison_id uuid references public.comparisons (id) on delete set null,
  contract_id uuid references public.crm_contracts (id) on delete set null,           -- contracte resultant (en activar)
  previous_contract_id uuid references public.crm_contracts (id) on delete set null,  -- contracte que substitueix
  service text not null check (service in ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes')),
  procedure_type text not null default 'canvi_comercialitzadora'
    check (procedure_type in ('alta_nova', 'canvi_comercialitzadora', 'renovacio', 'canvi_titular', 'modificacio', 'portabilitat', 'altres')),
  customer_type text not null default 'empresa' check (customer_type in ('particular', 'autonom', 'empresa')),
  retailer text not null check (length(trim(retailer)) between 1 and 120),
  product text,
  owner_id uuid references auth.users (id) on delete set null,
  collaborator_id uuid references auth.users (id) on delete set null,
  status text not null default 'pendent_documentacio'
    check (status in ('pendent_documentacio', 'documentacio_completa', 'pendent_signatura', 'signat', 'enviat', 'en_tramitacio', 'activat', 'incidencia', 'rebutjat')),
  priority text not null default 'mitjana' check (priority in ('baixa', 'mitjana', 'alta')),
  position double precision not null default 0,
  version integer not null default 1,                                 -- concurrència optimista
  status_changed_at timestamptz not null default now(),
  status_before_incident text,                                        -- per tornar a l'estat anterior en resoldre una incidència
  status_note text,                                                   -- justificació del canvi d'estat (es mou a l'historial)
  next_action text,
  next_action_at timestamptz,
  expected_signature_date date,
  expected_activation_date date,
  signed_at timestamptz,
  sent_at timestamptz,
  sent_to text,                                                       -- comercialitzadora o proveïdor receptor
  external_ref text,                                                  -- referència principal de la comercialitzadora
  activated_at date,
  activation_source text check (activation_source in ('comercialitzadora', 'distribuidora', 'portal', 'factura', 'altres')),
  activation_ref text,
  activation_confirmed_by uuid references auth.users (id),
  activation_confirmed_at timestamptz,
  start_date date,
  end_date date,
  rejection_reason text,
  accepted_terms_id uuid,                                             -- FK afegida després de crear crm_expedient_terms
  internal_notes text,
  last_event_at timestamptz not null default now(),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists crm_exp_status_idx on public.crm_expedients (status, position);
create index if not exists crm_exp_client_idx on public.crm_expedients (client_id, created_at desc);
create index if not exists crm_exp_owner_idx on public.crm_expedients (owner_id, status);
create index if not exists crm_exp_opp_idx on public.crm_expedients (opportunity_id);
create index if not exists crm_exp_supply_idx on public.crm_expedients (supply_id);

-- condicions acceptades: còpia immutable i versionada (no canvia si després s'edita una tarifa o una comparativa)
create table if not exists public.crm_expedient_terms (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.crm_expedients (id) on delete cascade,
  version integer not null,
  source text not null check (source in ('comparativa', 'oportunitat', 'manual')),
  comparison_id uuid references public.comparisons (id) on delete set null,
  proposal_document_id uuid references public.crm_documents (id) on delete set null,
  retailer text not null,
  product text,
  service text not null,
  conditions jsonb not null default '{}',     -- preus pactats (energia, potència, quotes, descomptes, permanència…)
  annual_kwh numeric check (annual_kwh is null or annual_kwh >= 0),
  estimated_annual_eur numeric,
  notes text,
  sha256 text not null,
  captured_by uuid references auth.users (id) default auth.uid(),
  captured_by_name text,
  captured_at timestamptz not null default now(),
  unique (expedient_id, version)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_exp_terms_fk') then
    alter table public.crm_expedients add constraint crm_exp_terms_fk foreign key (accepted_terms_id) references public.crm_expedient_terms (id);
  end if;
end $$;

-- ============================================================ requisits documentals (configurables)
create table if not exists public.crm_doc_requirements (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  description text,
  kind text not null check (kind in ('document', 'dada', 'manual')),   -- document adjunt · dada de la fitxa · comprovació manual
  doc_category text check (doc_category is null or doc_category in ('dni_nie', 'fiscal', 'factura_llum', 'factura_gas', 'contracte', 'contracte_signat', 'mandat', 'proposta', 'bancaria', 'altres')),
  data_field text check (data_field is null or data_field in ('client.tax_id', 'client.name', 'client.address', 'client.contact', 'supply.cups', 'supply.address', 'supply.holder_name', 'supply.access_tariff', 'supply.power')),
  services text[] not null default '{}',         -- buit = tots
  retailers text[] not null default '{}',        -- buit = totes (es compara sense majúscules)
  customer_types text[] not null default '{}',
  procedure_types text[] not null default '{}',
  mandatory boolean not null default true,
  active boolean not null default true,
  sort integer not null default 100,
  is_example boolean not null default false,     -- requisit d'exemple: revisar-lo i adaptar-lo als requisits reals de cada proveïdor
  updated_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'document') = (doc_category is not null)),
  check ((kind = 'dada') = (data_field is not null))
);

insert into public.crm_doc_requirements (name, description, kind, doc_category, data_field, services, customer_types, procedure_types, mandatory, sort, is_example)
select * from (values
  ('NIF/CIF del titular', 'El NIF o CIF ha de constar a la fitxa del client.', 'dada', null, 'client.tax_id', '{}'::text[], '{}'::text[], '{}'::text[], true, 10, true),
  ('Dades del titular', 'Nom i adreça del titular a la fitxa.', 'dada', null, 'client.address', '{}', '{}', '{}', true, 20, true),
  ('Telèfon o correu de contacte', null, 'dada', null, 'client.contact', '{}', '{}', '{}', true, 30, true),
  ('DNI/NIE del titular', 'Document identificatiu (persones físiques).', 'document', 'dni_nie', null, '{llum_residencial,llum_empresa,gas,fibra_telefonia,assegurances,alarmes}', '{particular,autonom}', '{}', true, 40, true),
  ('CIF i escriptures o poders', 'Documentació de l''empresa i del representant.', 'document', 'fiscal', null, '{}', '{empresa}', '{}', true, 45, true),
  ('CUPS del subministrament', null, 'dada', null, 'supply.cups', '{llum_residencial,llum_empresa,gas}', '{}', '{}', true, 50, true),
  ('Factura recent d''electricitat', 'Només si la comercialitzadora la demana.', 'document', 'factura_llum', null, '{llum_residencial,llum_empresa}', '{}', '{}', false, 60, true),
  ('Factura recent de gas', 'Només si la comercialitzadora la demana.', 'document', 'factura_gas', null, '{gas}', '{}', '{}', false, 61, true),
  ('Titularitat del compte (IBAN)', 'Certificat o document bancari. No es desa l''IBAN en text a la fitxa.', 'document', 'bancaria', null, '{llum_residencial,llum_empresa,gas}', '{}', '{}', false, 70, true),
  ('Autorització o mandat signat', null, 'document', 'mandat', null, '{llum_residencial,llum_empresa,gas}', '{}', '{}', false, 80, true),
  ('Adreça d''instal·lació', 'Adreça del servei al subministrament.', 'dada', null, 'supply.address', '{fibra_telefonia,alarmes}', '{}', '{}', true, 90, true),
  ('Dades de portabilitat', 'Número i operador actual.', 'manual', null, null, '{fibra_telefonia}', '{}', '{portabilitat}', true, 95, true),
  ('Dades del prenedor i del risc', 'Informació demanada per la companyia asseguradora.', 'manual', null, null, '{assegurances}', '{}', '{}', true, 100, true),
  ('Informació tècnica de la instal·lació', 'Dades tècniques que demana el proveïdor d''alarmes.', 'manual', null, null, '{alarmes}', '{}', '{}', true, 110, true)
) as v(name, description, kind, doc_category, data_field, services, customer_types, procedure_types, mandatory, sort, is_example)
where not exists (select 1 from public.crm_doc_requirements);

-- requisits de cada expedient (instàncies): poden apuntar a un document existent de la fitxa SENSE duplicar-lo
create table if not exists public.crm_expedient_requirements (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.crm_expedients (id) on delete cascade,
  requirement_id uuid references public.crm_doc_requirements (id) on delete set null,
  name text not null,
  kind text not null check (kind in ('document', 'dada', 'manual')),
  doc_category text,
  data_field text,
  mandatory boolean not null default true,
  status text not null default 'pendent' check (status in ('pendent', 'aportat', 'validat', 'rebutjat', 'no_aplica')),
  document_id uuid references public.crm_documents (id) on delete set null,
  note text,
  reject_reason text,
  validated_by uuid references auth.users (id),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expedient_id, requirement_id)
);
create index if not exists crm_exp_req_idx on public.crm_expedient_requirements (expedient_id);

-- ============================================================ plantilles i documents generats
create table if not exists public.crm_doc_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  description text,
  origin text not null default 'intern' check (origin in ('intern', 'comercialitzadora')),   -- document propi o model facilitat pel proveïdor
  retailer text,
  services text[] not null default '{}',
  body text not null check (length(body) between 1 and 60000),
  version integer not null default 1,
  status text not null default 'esborrany' check (status in ('esborrany', 'autoritzada', 'retirada')),
  source_note text,                                          -- d'on prové el model (obligatori per als models de proveïdor)
  authorized_by uuid references auth.users (id),
  authorized_at timestamptz,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin = 'intern' or source_note is not null)
);
create table if not exists public.crm_doc_template_versions (
  template_id uuid not null references public.crm_doc_templates (id) on delete cascade,
  version integer not null,
  body text not null,
  sha256 text not null,
  saved_by uuid references auth.users (id) default auth.uid(),
  saved_at timestamptz not null default now(),
  primary key (template_id, version)
);

create table if not exists public.crm_generated_documents (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.crm_expedients (id) on delete cascade,
  template_id uuid not null references public.crm_doc_templates (id) on delete restrict,
  template_version integer not null,
  terms_id uuid references public.crm_expedient_terms (id),
  document_id uuid not null references public.crm_documents (id) on delete restrict,   -- integrat al gestor documental (Fase 1)
  version integer not null,
  status text not null default 'generat' check (status in ('generat', 'acceptat', 'enviat_signatura', 'signat', 'substituit', 'anullat')),
  data_sha256 text not null,
  generated_by uuid references auth.users (id) default auth.uid(),
  generated_by_name text,
  generated_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz,
  signed_document_id uuid references public.crm_documents (id) on delete set null,
  unique (expedient_id, version)
);

-- ============================================================ signatura electrònica
create table if not exists public.crm_signature_requests (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.crm_expedients (id) on delete cascade,
  generated_document_id uuid references public.crm_generated_documents (id) on delete set null,
  provider text not null check (provider ~ '^[a-z0-9_]{2,30}$'),     -- signaturit, manual…
  provider_request_id text,
  status text not null default 'preparada'
    check (status in ('preparada', 'pendent_configuracio', 'enviada', 'oberta', 'signada', 'rebutjada', 'caducada', 'cancellada', 'error')),
  signers jsonb not null default '[]',
  manual_justification text,
  sent_at timestamptz,
  completed_at timestamptz,
  last_event_at timestamptz,
  signed_document_id uuid references public.crm_documents (id) on delete set null,
  evidence_document_id uuid references public.crm_documents (id) on delete set null,
  error text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_request_id)
);
create index if not exists crm_sig_exp_idx on public.crm_signature_requests (expedient_id, created_at desc);

create table if not exists public.crm_signature_events (
  id bigserial primary key,
  request_id uuid not null references public.crm_signature_requests (id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  type text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  verified boolean not null default false,       -- confirmat consultant l'API del proveïdor (no només pel contingut del webhook)
  payload_sha256 text,
  detail jsonb,
  unique (provider, provider_event_id)
);

-- ============================================================ historial, referències i comissions
create table if not exists public.crm_expedient_events (
  id bigserial primary key,
  expedient_id uuid not null references public.crm_expedients (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid references auth.users (id) default auth.uid(),
  user_name text,
  type text not null check (type in ('creacio', 'estat', 'condicions', 'document', 'requisit', 'signatura', 'enviament', 'referencia', 'incidencia', 'activacio', 'renovacio', 'comissio', 'nota', 'automatitzacio', 'responsable')),
  title text not null,
  from_status text,
  to_status text,
  justification text,
  detail jsonb,
  rule_key text unique
);
create index if not exists crm_exp_events_idx on public.crm_expedient_events (expedient_id, at desc);

create table if not exists public.crm_expedient_refs (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.crm_expedients (id) on delete cascade,
  system text not null check (system in ('comercialitzadora', 'distribuidora', 'signatura', 'portal', 'altres')),
  ref text not null check (length(trim(ref)) between 1 and 120),
  label text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (expedient_id, system, ref)
);

-- preparació del mòdul de comissions (sense liquidacions encara)
create table if not exists public.crm_commission_records (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null unique references public.crm_expedients (id) on delete cascade,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  owner_id uuid references auth.users (id) on delete set null,
  collaborator_id uuid references auth.users (id) on delete set null,
  retailer text,
  service text,
  annual_kwh numeric check (annual_kwh is null or annual_kwh >= 0),
  estimated_eur numeric check (estimated_eur is null or estimated_eur >= 0),
  accrual_status text not null default 'pendent' check (accrual_status in ('pendent', 'meritada', 'anullada', 'no_aplica')),
  payment_status text not null default 'pendent' check (payment_status in ('pendent', 'cobrada', 'parcial', 'impagada', 'no_aplica')),
  accrued_at date,
  paid_at date,
  paid_eur numeric check (paid_eur is null or paid_eur >= 0),
  retailer_ref text,                 -- referència de la comercialitzadora per a la conciliació
  settlement_ref text,               -- referència de liquidació (futur)
  notes text,
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- vincles amb les taules existents (columnes noves, opcionals)
alter table public.crm_contracts add column if not exists expedient_id uuid references public.crm_expedients (id) on delete set null;
alter table public.crm_documents add column if not exists expedient_id uuid references public.crm_expedients (id) on delete set null;
alter table public.crm_incidents add column if not exists expedient_id uuid references public.crm_expedients (id) on delete set null;
alter table public.crm_tasks add column if not exists expedient_id uuid references public.crm_expedients (id) on delete set null;
alter table public.crm_activities add column if not exists expedient_id uuid references public.crm_expedients (id) on delete set null;
alter table public.crm_opportunities add column if not exists renewal_of_contract_id uuid references public.crm_contracts (id) on delete set null;
create index if not exists crm_contracts_exp_idx on public.crm_contracts (expedient_id);
create index if not exists crm_documents_exp_idx on public.crm_documents (expedient_id);
create index if not exists crm_incidents_exp_idx on public.crm_incidents (expedient_id);
create index if not exists crm_tasks_exp_idx on public.crm_tasks (expedient_id);

-- regles d'automatització noves (mateix motor de la Fase 2). «Proper venciment» reutilitza la regla venciment_contracte.
insert into public.crm_automation_rules (key, name, description, params) values
  ('exp_documentacio_incompleta', 'Expedient: documentació incompleta', 'Si un expedient porta X dies pendent de documentació, crea una tasca per reclamar-la.', '{"days": 3}'),
  ('exp_signatura_pendent', 'Expedient: signatura pendent', 'Si una sol·licitud de signatura porta X dies sense signar, avisa el responsable.', '{"days": 3}'),
  ('exp_sense_moviment', 'Expedient sense moviment', 'Avisa quan un expedient obert porta X dies sense cap canvi (com a màxim un avís per setmana).', '{"days": 7}'),
  ('exp_rebuig', 'Rebuig de la comercialitzadora', 'Quan un expedient es rebutja, avisa el responsable i Administració.', '{}'),
  ('exp_activat', 'Contracte activat', 'Quan s''activa un contracte, avisa el responsable i recorda revisar la comissió (no es marca com a meritada).', '{}'),
  ('exp_sense_responsable', 'Expedient sense responsable', 'Avisa Administració dels expedients oberts sense responsable (un avís per dia).', '{}')
on conflict (key) do nothing;

-- ============================================================ permisos
create or replace function public.crm_can_see_expedient(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_expedients e where e.id = p_id and (
    public.is_staff() or e.owner_id = auth.uid() or e.collaborator_id = auth.uid() or public.crm_can_edit_client(e.client_id)));
$$;

create or replace function public.crm_can_edit_expedient(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_expedients e where e.id = p_id and (
    public.is_staff() or (e.owner_id = auth.uid() and public.my_role() = 'comercial')));
$$;

create or replace function public.crm_can_manage_contracting() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'cap_administrativa'), false);
$$;

-- transicions permeses del flux de tramitació
create or replace function public.crm_exp_transition_ok(p_from text, p_to text) returns boolean
language sql immutable as $$
  select case p_from
    when 'pendent_documentacio' then p_to in ('documentacio_completa', 'incidencia', 'rebutjat')
    when 'documentacio_completa' then p_to in ('pendent_signatura', 'pendent_documentacio', 'incidencia', 'rebutjat')
    when 'pendent_signatura' then p_to in ('signat', 'documentacio_completa', 'pendent_documentacio', 'incidencia', 'rebutjat')
    when 'signat' then p_to in ('enviat', 'incidencia', 'rebutjat')
    when 'enviat' then p_to in ('en_tramitacio', 'activat', 'incidencia', 'rebutjat')
    when 'en_tramitacio' then p_to in ('activat', 'enviat', 'incidencia', 'rebutjat')
    when 'incidencia' then p_to in ('pendent_documentacio', 'documentacio_completa', 'pendent_signatura', 'signat', 'enviat', 'en_tramitacio', 'rebutjat')
    when 'activat' then p_to in ('incidencia')
    when 'rebutjat' then p_to in ('pendent_documentacio')
    else false end;
$$;

-- ============================================================ triggers
create or replace function public.crm_exp_before() returns trigger language plpgsql security definer set search_path = public as $$
declare
  staff boolean := auth.uid() is null or public.is_staff();
  backwards boolean;
  rank_from int;
  rank_to int;
  order_ text[] := array['pendent_documentacio', 'documentacio_completa', 'pendent_signatura', 'signat', 'enviat', 'en_tramitacio', 'activat'];
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, 'EXP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.crm_expedient_seq')::text, 5, '0'));
    if new.status <> 'pendent_documentacio' and not staff then
      raise exception 'Un expedient nou comença sempre pendent de documentació' using errcode = '42501';
    end if;
    perform set_config('crm.exp_note', coalesce(new.status_note, ''), true);
    new.status_note := null;
    return new;
  end if;

  if auth.uid() is not null and not public.is_staff() then
    if new.owner_id is distinct from old.owner_id or new.collaborator_id is distinct from old.collaborator_id then
      raise exception 'Només Administració o Direcció poden canviar el responsable de l''expedient' using errcode = '42501';
    end if;
    if (new.activated_at, new.activation_confirmed_by, new.start_date, new.end_date, new.contract_id, new.sent_at, new.signed_at)
       is distinct from (old.activated_at, old.activation_confirmed_by, old.start_date, old.end_date, old.contract_id, old.sent_at, old.signed_at) then
      raise exception 'Només Administració pot registrar l''enviament, la signatura o l''activació' using errcode = '42501';
    end if;
  end if;
  if new.client_id is distinct from old.client_id then
    raise exception 'No es pot canviar el client d''un expedient' using errcode = '42501';
  end if;
  if new.accepted_terms_id is distinct from old.accepted_terms_id and new.accepted_terms_id is not null
     and not exists (select 1 from crm_expedient_terms t where t.id = new.accepted_terms_id and t.expedient_id = new.id) then
    raise exception 'Les condicions no són d''aquest expedient' using errcode = '23514';
  end if;

  perform set_config('crm.exp_note', coalesce(new.status_note, ''), true);

  if new.status is distinct from old.status then
    if not public.crm_exp_transition_ok(old.status, new.status) then
      raise exception 'Transició no permesa: % → %', old.status, new.status using errcode = '23514';
    end if;
    -- els comercials només treballen la fase de preparació; la tramitació és d'Administració
    if not staff and not (new.status in ('pendent_documentacio', 'documentacio_completa', 'pendent_signatura') and old.status in ('pendent_documentacio', 'documentacio_completa', 'pendent_signatura')) then
      raise exception 'Només Administració pot moure l''expedient a «%»', new.status using errcode = '42501';
    end if;
    rank_from := array_position(order_, old.status);
    rank_to := array_position(order_, new.status);
    backwards := old.status in ('activat', 'rebutjat') or new.status in ('incidencia', 'rebutjat') or (rank_from is not null and rank_to is not null and rank_to < rank_from);
    if backwards and coalesce(trim(new.status_note), '') = '' then
      raise exception 'Cal indicar una justificació per a aquest canvi d''estat' using errcode = '23514';
    end if;
    if new.status = 'documentacio_completa' and exists (
         select 1 from crm_expedient_requirements r where r.expedient_id = new.id and r.mandatory and r.status in ('pendent', 'rebutjat')) then
      raise exception 'Falta documentació obligatòria' using errcode = '23514';
    end if;
    if new.status = 'signat' and not exists (select 1 from crm_signature_requests s where s.expedient_id = new.id and s.status = 'signada') then
      raise exception 'No hi ha cap signatura confirmada per a aquest expedient' using errcode = '23514';
    end if;
    if new.status = 'enviat' and (new.sent_at is null or coalesce(trim(new.sent_to), '') = '') then
      raise exception 'Cal registrar la data d''enviament i la comercialitzadora receptora' using errcode = '23514';
    end if;
    if new.status = 'activat' and (new.activated_at is null or new.activation_source is null or new.activation_confirmed_by is null or new.start_date is null or new.signed_at is null) then
      raise exception 'Falta la informació mínima d''activació (data real, origen de la confirmació, qui la confirma i data d''inici)' using errcode = '23514';
    end if;
    if new.status = 'rebutjat' and coalesce(trim(new.rejection_reason), '') = '' then
      raise exception 'Cal indicar el motiu del rebuig o de l''anul·lació' using errcode = '23514';
    end if;
    if old.status = 'incidencia' and new.status <> 'rebutjat' and old.status_before_incident is not null
       and array_position(order_, new.status) > array_position(order_, old.status_before_incident) then
      raise exception 'En resoldre una incidència l''expedient torna com a màxim a l''estat on era («%»)', old.status_before_incident using errcode = '23514';
    end if;
    if new.status = 'incidencia' then new.status_before_incident := old.status; end if;
    if new.status = 'signat' and new.signed_at is null then
      new.signed_at := (select max(completed_at) from crm_signature_requests s where s.expedient_id = new.id and s.status = 'signada');
    end if;
    new.status_changed_at := now();
  end if;

  if (to_jsonb(new) - array['updated_at', 'last_event_at', 'version', 'position', 'status_note']) is distinct from (to_jsonb(old) - array['updated_at', 'last_event_at', 'version', 'position', 'status_note']) then
    new.version := old.version + 1;
  end if;
  new.status_note := null;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.crm_exp_after() returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := (select name from profiles where id = auth.uid());
  note text := nullif(current_setting('crm.exp_note', true), '');
  label jsonb := '{"pendent_documentacio":"Pendent de documentació","documentacio_completa":"Documentació completa","pendent_signatura":"Pendent de signatura","signat":"Signat","enviat":"Enviat a comercialitzadora","en_tramitacio":"En tramitació","activat":"Activat","incidencia":"Incidència","rebutjat":"Rebutjat o anul·lat"}';
begin
  if tg_op = 'INSERT' then
    insert into crm_expedient_events (expedient_id, user_id, user_name, type, title, to_status, justification)
    values (new.id, auth.uid(), who, 'creacio', 'Expedient ' || new.code || ' creat', new.status, note);
    insert into crm_commission_records (expedient_id, owner_id, collaborator_id, retailer, service, annual_kwh, estimated_eur)
    select new.id, new.owner_id, new.collaborator_id, new.retailer, new.service, o.annual_kwh, o.commission_eur
      from (select 1) x left join crm_opportunities o on o.id = new.opportunity_id
    on conflict (expedient_id) do nothing;
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into crm_expedient_events (expedient_id, user_id, user_name, type, title, from_status, to_status, justification)
    values (new.id, auth.uid(), coalesce(who, 'Sistema'), case when new.status = 'activat' then 'activacio' else 'estat' end,
            (label ->> old.status) || ' → ' || (label ->> new.status), old.status, new.status, note);
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into crm_expedient_events (expedient_id, user_id, user_name, type, title, justification)
    values (new.id, auth.uid(), coalesce(who, 'Sistema'), 'responsable', 'Canvi de responsable', note);
    update crm_commission_records set owner_id = new.owner_id, updated_at = now() where expedient_id = new.id and accrual_status = 'pendent';
  end if;
  return new;
end $$;

-- historial, condicions i esdeveniments de signatura: només s'hi afegeix (no es modifiquen ni s'esborren)
create or replace function public.crm_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Registre immutable: no es pot modificar (%).', tg_table_name using errcode = '42501';
  end if;
  -- l'esborrat només s'admet en cascada des del registre pare (no hi ha cap política DELETE per als usuaris)
  return old;
end $$;

create or replace function public.crm_event_touch() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update crm_expedients set last_event_at = new.at where id = new.expedient_id and last_event_at < new.at;
  return new;
end $$;

create or replace function public.crm_req_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.document_id is not null and not exists (
       select 1 from crm_documents d join crm_expedients e on e.client_id = d.client_id where d.id = new.document_id and e.id = new.expedient_id) then
    raise exception 'El document no és d''aquest client' using errcode = '23514';
  end if;
  if new.status = 'validat' and (tg_op = 'INSERT' or old.status is distinct from 'validat') then
    if auth.uid() is not null and not public.is_staff() then
      raise exception 'Només Administració pot validar documentació' using errcode = '42501';
    end if;
    new.validated_by := coalesce(auth.uid(), new.validated_by);
    new.validated_at := now();
  end if;
  if new.status = 'rebutjat' and coalesce(trim(new.reject_reason), '') = '' then
    raise exception 'Cal indicar per què es rebutja el document' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.crm_template_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.version := old.version + 1;
    if new.status = 'autoritzada' and old.status = 'autoritzada' then
      new.status := 'esborrany';             -- qualsevol canvi de text s'ha de tornar a autoritzar
      new.authorized_by := null;
      new.authorized_at := null;
    end if;
  end if;
  if new.status = 'autoritzada' and (tg_op = 'INSERT' or old.status <> 'autoritzada') then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Només Direcció pot autoritzar plantilles' using errcode = '42501';
    end if;
    new.authorized_by := coalesce(auth.uid(), new.authorized_by);
    new.authorized_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.crm_template_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into crm_doc_template_versions (template_id, version, body, sha256, saved_by)
    values (new.id, new.version, new.body, encode(sha256(convert_to(new.body, 'UTF8')), 'hex'), auth.uid())
    on conflict do nothing;
  end if;
  return new;
end $$;

-- una signatura només es dona per bona si la confirma el proveïdor (servidor) o és manuscrita registrada per Administració amb el document signat
create or replace function public.crm_signature_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.status = 'signada' and (tg_op = 'INSERT' or old.status <> 'signada') then
      if new.provider <> 'manual' then
        raise exception 'Una signatura electrònica només es confirma amb l''avís verificat del proveïdor' using errcode = '42501';
      end if;
      if not public.is_staff() or new.signed_document_id is null or coalesce(trim(new.manual_justification), '') = '' then
        raise exception 'Per registrar una signatura manuscrita cal ser d''Administració, adjuntar el document signat i justificar-ho' using errcode = '42501';
      end if;
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    if tg_op = 'UPDATE' and new.provider <> 'manual' and (new.provider_request_id, new.completed_at, new.signed_document_id, new.evidence_document_id)
       is distinct from (old.provider_request_id, old.completed_at, old.signed_document_id, old.evidence_document_id) then
      raise exception 'Aquestes dades només les pot actualitzar el proveïdor de signatura' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.status = 'signada' and new.status <> 'signada' then
      raise exception 'Una signatura confirmada no es pot desfer' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.crm_commission_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Només Administració o Direcció poden modificar les dades de comissió' using errcode = '42501';
  end if;
  if new.accrual_status = 'meritada' and new.accrued_at is null then new.accrued_at := current_date; end if;
  if new.payment_status in ('cobrada', 'parcial') and new.paid_at is null then
    raise exception 'Indica la data de cobrament' using errcode = '23514';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists crm_exp_before on public.crm_expedients;
create trigger crm_exp_before before insert or update on public.crm_expedients for each row execute function public.crm_exp_before();
drop trigger if exists crm_exp_after on public.crm_expedients;
create trigger crm_exp_after after insert or update on public.crm_expedients for each row execute function public.crm_exp_after();
drop trigger if exists crm_exp_events_append on public.crm_expedient_events;
create trigger crm_exp_events_append before update on public.crm_expedient_events for each row execute function public.crm_append_only();
drop trigger if exists crm_exp_events_touch on public.crm_expedient_events;
create trigger crm_exp_events_touch after insert on public.crm_expedient_events for each row execute function public.crm_event_touch();
drop trigger if exists crm_exp_terms_append on public.crm_expedient_terms;
create trigger crm_exp_terms_append before update on public.crm_expedient_terms for each row execute function public.crm_append_only();
drop trigger if exists crm_sig_events_append on public.crm_signature_events;
create trigger crm_sig_events_append before update on public.crm_signature_events for each row execute function public.crm_append_only();
drop trigger if exists crm_tpl_versions_append on public.crm_doc_template_versions;
create trigger crm_tpl_versions_append before update on public.crm_doc_template_versions for each row execute function public.crm_append_only();
drop trigger if exists crm_exp_req_before on public.crm_expedient_requirements;
create trigger crm_exp_req_before before insert or update on public.crm_expedient_requirements for each row execute function public.crm_req_before();
drop trigger if exists crm_tpl_before on public.crm_doc_templates;
create trigger crm_tpl_before before insert or update on public.crm_doc_templates for each row execute function public.crm_template_before();
drop trigger if exists crm_tpl_after on public.crm_doc_templates;
create trigger crm_tpl_after after insert or update on public.crm_doc_templates for each row execute function public.crm_template_after();
drop trigger if exists crm_sig_before on public.crm_signature_requests;
create trigger crm_sig_before before insert or update on public.crm_signature_requests for each row execute function public.crm_signature_before();
drop trigger if exists crm_comm_before on public.crm_commission_records;
create trigger crm_comm_before before update on public.crm_commission_records for each row execute function public.crm_commission_before();

do $$
declare t text;
begin
  foreach t in array array['crm_expedients', 'crm_expedient_requirements', 'crm_signature_requests', 'crm_commission_records', 'crm_doc_templates', 'crm_doc_requirements', 'crm_generated_documents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.crm_audit()', t || '_audit', t);
  end loop;
end $$;

-- ============================================================ operacions transaccionals
-- Crea els requisits d'un expedient segons la configuració (servei, comercialitzadora, tipus de client i de tràmit).
create or replace function public.crm_expedient_seed_requirements(p_id uuid) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  e crm_expedients;
  n integer;
begin
  select * into e from crm_expedients where id = p_id;
  if e.id is null then raise exception 'Expedient no trobat' using errcode = '42501'; end if;
  insert into crm_expedient_requirements (expedient_id, requirement_id, name, kind, doc_category, data_field, mandatory)
  select e.id, r.id, r.name, r.kind, r.doc_category, r.data_field, r.mandatory
    from crm_doc_requirements r
   where r.active
     and (cardinality(r.services) = 0 or e.service = any (r.services))
     and (cardinality(r.customer_types) = 0 or e.customer_type = any (r.customer_types))
     and (cardinality(r.procedure_types) = 0 or e.procedure_type = any (r.procedure_types))
     and (cardinality(r.retailers) = 0 or lower(e.retailer) = any (select lower(x) from unnest(r.retailers) x))
  on conflict (expedient_id, requirement_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Activació confirmada: crea el contracte (sense sobreescriure l'anterior), actualitza el subministrament,
-- el client, l'oportunitat i la comissió, i tanca l'expedient. Tot en una sola transacció i amb la RLS de l'usuari.
create or replace function public.crm_activate_expedient(p_id uuid, p_activated_at date, p_start date, p_end date, p_source text, p_ref text, p_note text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  e crm_expedients;
  prev uuid;
  prev_status text;
  tariff text;
  new_id uuid;
begin
  if not public.is_staff() then raise exception 'Només Administració pot confirmar activacions' using errcode = '42501'; end if;
  select * into e from crm_expedients where id = p_id for update;
  if e.id is null then raise exception 'Expedient no trobat' using errcode = '42501'; end if;
  if e.status not in ('enviat', 'en_tramitacio') then raise exception 'Només es poden activar expedients enviats o en tramitació' using errcode = '23514'; end if;
  if p_activated_at is null or p_start is null or p_source is null then raise exception 'Falta la informació mínima d''activació' using errcode = '23514'; end if;
  if p_activated_at > current_date then raise exception 'La data d''activació no pot ser futura' using errcode = '23514'; end if;

  if e.supply_id is not null then
    select current_contract_id, access_tariff into prev, tariff from crm_supplies where id = e.supply_id;
  end if;
  prev := coalesce(prev, e.previous_contract_id);
  if prev is not null then select status into prev_status from crm_contracts where id = prev; end if;

  insert into crm_contracts (client_id, supply_id, retailer, product, access_tariff, signed_at, start_date, end_date, status, owner_id, previous_contract_id, comparison_id, expedient_id, notes, created_by)
  values (e.client_id, e.supply_id, e.retailer, e.product, tariff, e.signed_at::date, p_start, p_end, 'actiu', e.owner_id, prev, e.comparison_id, e.id,
          'Expedient ' || e.code || coalesce(' · ref. ' || nullif(trim(p_ref), ''), ''), auth.uid())
  returning id into new_id;

  if prev is not null and prev_status in ('actiu', 'renovacio_pendent') then
    update crm_contracts set status = 'finalitzat' where id = prev;      -- el contracte anterior es conserva a l'historial
  end if;
  if e.supply_id is not null then
    update crm_supplies set current_contract_id = new_id, current_retailer = e.retailer where id = e.supply_id;
  end if;
  update crm_clients set status = 'actiu' where id = e.client_id and status = 'potencial';
  if e.opportunity_id is not null then
    update crm_opportunities set contract_id = new_id where id = e.opportunity_id and contract_id is null;
  end if;
  if p_ref is not null and trim(p_ref) <> '' then
    insert into crm_expedient_refs (expedient_id, system, ref, label) values (e.id, 'comercialitzadora', trim(p_ref), 'Referència d''activació') on conflict do nothing;
  end if;

  update crm_expedients set status = 'activat', activated_at = p_activated_at, start_date = p_start, end_date = p_end,
         activation_source = p_source, activation_ref = nullif(trim(p_ref), ''), activation_confirmed_by = auth.uid(), activation_confirmed_at = now(),
         contract_id = new_id, previous_contract_id = prev, status_note = p_note
   where id = e.id;
  update crm_commission_records set contract_id = new_id where expedient_id = e.id;   -- la meritació continua pendent
  return new_id;
end $$;

-- ============================================================ RLS
alter table public.crm_expedients enable row level security;
alter table public.crm_expedient_terms enable row level security;
alter table public.crm_doc_requirements enable row level security;
alter table public.crm_expedient_requirements enable row level security;
alter table public.crm_doc_templates enable row level security;
alter table public.crm_doc_template_versions enable row level security;
alter table public.crm_generated_documents enable row level security;
alter table public.crm_signature_requests enable row level security;
alter table public.crm_signature_events enable row level security;
alter table public.crm_expedient_events enable row level security;
alter table public.crm_expedient_refs enable row level security;
alter table public.crm_commission_records enable row level security;

-- expedients (la lectura es comprova sobre la mateixa fila perquè funcioni també en crear-la)
drop policy if exists p_crm_exp_select on public.crm_expedients;
create policy p_crm_exp_select on public.crm_expedients for select to authenticated using (
  public.is_staff() or owner_id = auth.uid() or collaborator_id = auth.uid() or public.crm_can_edit_client(client_id));
drop policy if exists p_crm_exp_insert on public.crm_expedients;
create policy p_crm_exp_insert on public.crm_expedients for insert to authenticated with check (
  created_by = auth.uid() and public.crm_can_edit_client(client_id)
  and (public.is_staff() or (public.my_role() = 'comercial' and owner_id = auth.uid())));
drop policy if exists p_crm_exp_update on public.crm_expedients;
create policy p_crm_exp_update on public.crm_expedients for update to authenticated
  using (public.is_staff() or (owner_id = auth.uid() and public.my_role() = 'comercial'))
  with check (public.is_staff() or (owner_id = auth.uid() and public.my_role() = 'comercial'));
-- no hi ha DELETE: els expedients es rebutgen o s'anul·len

drop policy if exists p_crm_terms_select on public.crm_expedient_terms;
create policy p_crm_terms_select on public.crm_expedient_terms for select to authenticated using (public.crm_can_see_expedient(expedient_id));
drop policy if exists p_crm_terms_insert on public.crm_expedient_terms;
create policy p_crm_terms_insert on public.crm_expedient_terms for insert to authenticated
  with check (captured_by = auth.uid() and public.crm_can_edit_expedient(expedient_id));

drop policy if exists p_crm_docreq_select on public.crm_doc_requirements;
create policy p_crm_docreq_select on public.crm_doc_requirements for select to authenticated using (true);
drop policy if exists p_crm_docreq_write on public.crm_doc_requirements;
create policy p_crm_docreq_write on public.crm_doc_requirements for all to authenticated
  using (public.crm_can_manage_contracting()) with check (public.crm_can_manage_contracting());

drop policy if exists p_crm_expreq_select on public.crm_expedient_requirements;
create policy p_crm_expreq_select on public.crm_expedient_requirements for select to authenticated using (public.crm_can_see_expedient(expedient_id));
drop policy if exists p_crm_expreq_insert on public.crm_expedient_requirements;
create policy p_crm_expreq_insert on public.crm_expedient_requirements for insert to authenticated with check (public.crm_can_edit_expedient(expedient_id));
drop policy if exists p_crm_expreq_update on public.crm_expedient_requirements;
create policy p_crm_expreq_update on public.crm_expedient_requirements for update to authenticated
  using (public.crm_can_edit_expedient(expedient_id)) with check (public.crm_can_edit_expedient(expedient_id));

drop policy if exists p_crm_tpl_select on public.crm_doc_templates;
create policy p_crm_tpl_select on public.crm_doc_templates for select to authenticated using (status = 'autoritzada' or public.is_staff());
drop policy if exists p_crm_tpl_write on public.crm_doc_templates;
create policy p_crm_tpl_write on public.crm_doc_templates for all to authenticated
  using (public.crm_can_manage_contracting()) with check (public.crm_can_manage_contracting());
drop policy if exists p_crm_tplv_select on public.crm_doc_template_versions;
create policy p_crm_tplv_select on public.crm_doc_template_versions for select to authenticated using (public.is_staff());

drop policy if exists p_crm_gen_select on public.crm_generated_documents;
create policy p_crm_gen_select on public.crm_generated_documents for select to authenticated using (public.crm_can_see_expedient(expedient_id));
drop policy if exists p_crm_gen_insert on public.crm_generated_documents;
create policy p_crm_gen_insert on public.crm_generated_documents for insert to authenticated
  with check (generated_by = auth.uid() and public.crm_can_edit_expedient(expedient_id)
              and exists (select 1 from crm_doc_templates t where t.id = template_id and t.status = 'autoritzada' and t.version = template_version));
drop policy if exists p_crm_gen_update on public.crm_generated_documents;
create policy p_crm_gen_update on public.crm_generated_documents for update to authenticated
  using (public.crm_can_edit_expedient(expedient_id)) with check (public.crm_can_edit_expedient(expedient_id));

drop policy if exists p_crm_sig_select on public.crm_signature_requests;
create policy p_crm_sig_select on public.crm_signature_requests for select to authenticated using (public.crm_can_see_expedient(expedient_id));
drop policy if exists p_crm_sig_insert on public.crm_signature_requests;
create policy p_crm_sig_insert on public.crm_signature_requests for insert to authenticated
  with check (created_by = auth.uid() and public.crm_can_edit_expedient(expedient_id));
drop policy if exists p_crm_sig_update on public.crm_signature_requests;
create policy p_crm_sig_update on public.crm_signature_requests for update to authenticated
  using (public.crm_can_edit_expedient(expedient_id)) with check (public.crm_can_edit_expedient(expedient_id));
drop policy if exists p_crm_sigev_select on public.crm_signature_events;
create policy p_crm_sigev_select on public.crm_signature_events for select to authenticated
  using (exists (select 1 from crm_signature_requests s where s.id = request_id and public.crm_can_see_expedient(s.expedient_id)));
-- els esdeveniments de signatura només els escriu el servidor (webhook verificat)

drop policy if exists p_crm_expev_select on public.crm_expedient_events;
create policy p_crm_expev_select on public.crm_expedient_events for select to authenticated using (public.crm_can_see_expedient(expedient_id));
drop policy if exists p_crm_expev_insert on public.crm_expedient_events;
create policy p_crm_expev_insert on public.crm_expedient_events for insert to authenticated with check (
  user_id = auth.uid() and public.crm_can_see_expedient(expedient_id)
  and type in ('condicions', 'document', 'requisit', 'signatura', 'enviament', 'referencia', 'incidencia', 'renovacio', 'comissio', 'nota') and rule_key is null);

drop policy if exists p_crm_refs_select on public.crm_expedient_refs;
create policy p_crm_refs_select on public.crm_expedient_refs for select to authenticated using (public.crm_can_see_expedient(expedient_id));
drop policy if exists p_crm_refs_write on public.crm_expedient_refs;
create policy p_crm_refs_write on public.crm_expedient_refs for insert to authenticated with check (created_by = auth.uid() and public.is_staff());

-- comissions: Administració/Direcció i el comercial responsable (lectura). Els col·laboradors no les veuen.
drop policy if exists p_crm_comm_select on public.crm_commission_records;
create policy p_crm_comm_select on public.crm_commission_records for select to authenticated
  using (public.is_staff() or (owner_id = auth.uid() and public.my_role() = 'comercial'));
drop policy if exists p_crm_comm_update on public.crm_commission_records;
create policy p_crm_comm_update on public.crm_commission_records for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ============================================================ temps real
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_expedients') then
    alter publication supabase_realtime add table public.crm_expedients;
  end if;
end $$;
