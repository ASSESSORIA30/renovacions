-- 013 · FASE 6: CAPTACIÓ AUTOMÀTICA, PORTAL DE COL·LABORADORS I MÀRQUETING
-- Additiva i idempotent: no esborra ni modifica dades existents. Reversible amb 013_captacio_down.sql.
--
-- Principis:
--   · Els formularis públics NO tenen cap permís a la base de dades (cap política per a anon): el servidor valida,
--     limita i insereix amb el client de servei. Un formulari públic no pot llegir res.
--   · Les factures van a un bucket PRIVAT (`lead-documents`); només el servidor hi accedeix.
--   · Els leads captats són els mateixos `crm_leads` de la Fase 2 (sense sistema duplicat).
--   · L'atribució a un col·laborador es decideix al servidor amb regles fixes; no es reassigna sense Direcció.
--   · Consentiment del servei ≠ consentiment comercial (opcional), registrats per separat i amb versió del text.
--   · Un missatge de WhatsApp només consta com a lliurat quan ho confirma el webhook de Meta.

-- ============================================================ leads: dades de captació (columnes noves)
alter table public.crm_leads add column if not exists capture_channel text;
alter table public.crm_leads add column if not exists capture_campaign_id uuid;
alter table public.crm_leads add column if not exists capture_partner_id uuid;
alter table public.crm_leads add column if not exists capture_submission_id uuid;
alter table public.crm_leads add column if not exists utm jsonb;
alter table public.crm_leads add column if not exists energy_type text;
alter table public.crm_leads add column if not exists cups text;
alter table public.crm_leads add column if not exists duplicate_status text not null default 'unic';
alter table public.crm_leads add column if not exists duplicate_refs jsonb not null default '[]';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_capture_channel_chk') then
    alter table public.crm_leads add constraint crm_leads_capture_channel_chk check (capture_channel is null or capture_channel in ('web', 'formulari', 'factura', 'google_ads', 'meta_ads', 'whatsapp', 'collaborador', 'qr', 'recomanacio', 'comercial'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_dup_status_chk') then
    alter table public.crm_leads add constraint crm_leads_dup_status_chk check (duplicate_status in ('unic', 'possible_duplicat', 'duplicat_confirmat', 'revisat_no_duplicat'));
  end if;
end $$;
create index if not exists crm_leads_channel_idx on public.crm_leads (capture_channel, created_at desc);
create index if not exists crm_leads_cups_idx on public.crm_leads (left(cups, 20)) where cups is not null;

-- ============================================================ campanyes i costos (només dades reals: API o registre manual)
create table if not exists public.cap_campaigns (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('google_ads', 'meta_ads', 'altres')),
  external_id text,                                        -- id de la plataforma (si es coneix)
  name text not null check (length(trim(name)) between 1 and 200),
  utm_source text,
  utm_campaign text,
  status text not null default 'activa' check (status in ('activa', 'pausada', 'finalitzada')),   -- registre intern: NO canvia res a la plataforma
  product text,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cap_campaigns_ext_uq on public.cap_campaigns (platform, external_id) where external_id is not null;
create unique index if not exists cap_campaigns_utm_uq on public.cap_campaigns (platform, lower(utm_campaign)) where utm_campaign is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_campaign_fk') then
    alter table public.crm_leads add constraint crm_leads_campaign_fk foreign key (capture_campaign_id) references public.cap_campaigns (id) on delete set null;
  end if;
end $$;

create table if not exists public.cap_campaign_costs (
  id bigserial primary key,
  campaign_id uuid not null references public.cap_campaigns (id) on delete cascade,
  day date not null,
  cost_eur numeric(14, 2) not null check (cost_eur >= 0),
  impressions integer check (impressions is null or impressions >= 0),
  clicks integer check (clicks is null or clicks >= 0),
  source text not null check (source in ('api', 'manual')),
  imported_by uuid references auth.users (id) default auth.uid(),
  imported_at timestamptz not null default now(),
  unique (campaign_id, day, source)
);

-- ============================================================ col·laboradors (perfil de captació; dades fiscals a fin_collaborator_terms)
create table if not exists public.cap_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,   -- accés al portal (rol «colaborador»)
  kind text not null default 'altres' check (kind in ('electricista', 'fotovoltaica', 'gas', 'immobiliaria', 'administrador_finques', 'gestoria', 'corredoria', 'altres')),
  name text not null check (length(trim(name)) between 1 and 160),
  company text,
  public_name text,                                        -- nom que es pot mostrar a la seva landing (opcional)
  email text,
  phone text,
  province text,
  city text,
  status text not null default 'actiu' check (status in ('pendent', 'actiu', 'suspes', 'baixa')),
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_partner_fk') then
    alter table public.crm_leads add constraint crm_leads_partner_fk foreign key (capture_partner_id) references public.cap_partners (id) on delete set null;
  end if;
end $$;

-- enllaços i codis de referència (el codi no dona accés a cap dada)
create table if not exists public.cap_referral_links (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.cap_partners (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{4,16}$'),
  label text,
  channel text not null default 'recomanacio' check (channel in ('recomanacio', 'qr', 'collaborador')),
  active boolean not null default true,
  expires_at timestamptz,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cap_links_partner_idx on public.cap_referral_links (partner_id);

-- ============================================================ sol·licituds públiques (formulari, Lead Ads, WhatsApp, portal)
create table if not exists public.cap_submissions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,                    -- generat pel navegador: reenviar no duplica
  channel text not null check (channel in ('web', 'formulari', 'factura', 'google_ads', 'meta_ads', 'whatsapp', 'collaborador', 'qr', 'recomanacio', 'comercial')),
  status text not null default 'rebuda' check (status in ('rebuda', 'processant', 'lead_creat', 'duplicat', 'rebutjada', 'error')),
  customer_kind text check (customer_kind is null or customer_kind in ('particular', 'empresa')),
  energy_type text check (energy_type is null or energy_type in ('luz', 'gas')),
  name text,
  phone text,
  email text,
  province text,
  notes text,
  ref_code text,
  partner_id uuid references public.cap_partners (id) on delete set null,
  campaign_id uuid references public.cap_campaigns (id) on delete set null,
  utm jsonb,
  click_ids jsonb,                                         -- gclid / fbclid (no s'envien a cap plataforma sense configuració)
  contact_hash text,                                       -- hash del telèfon/correu normalitzats (duplicats)
  ip_hash text,                                            -- hash diari amb sal: limitació de peticions, sense IP en clar
  spam_reasons jsonb not null default '[]',
  lead_id uuid references public.crm_leads (id) on delete set null,
  attempts integer not null default 0 check (attempts between 0 and 10),
  error text,
  submitted_by uuid references auth.users (id) on delete set null,   -- col·laborador o comercial (si no és públic)
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  retain_until timestamptz not null default now() + interval '2 years'
);
create index if not exists cap_sub_status_idx on public.cap_submissions (status, received_at);
create index if not exists cap_sub_ip_idx on public.cap_submissions (ip_hash, received_at desc);
create index if not exists cap_sub_contact_idx on public.cap_submissions (contact_hash, received_at desc);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_submission_fk') then
    alter table public.crm_leads add constraint crm_leads_submission_fk foreign key (capture_submission_id) references public.cap_submissions (id) on delete set null;
  end if;
end $$;

-- consentiments (servei obligatori; comercial opcional i separat)
create table if not exists public.cap_consents (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.cap_submissions (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete cascade,
  kind text not null check (kind in ('privacitat_servei', 'comercial', 'whatsapp')),
  granted boolean not null,
  text_version text not null,
  text_sha256 text not null,
  channel text not null,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users (id) on delete set null,
  check (submission_id is not null or lead_id is not null)
);
create index if not exists cap_consents_lead_idx on public.cap_consents (lead_id, kind);

-- documents dels leads (bucket privat lead-documents)
create table if not exists public.cap_lead_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads (id) on delete cascade,
  submission_id uuid references public.cap_submissions (id) on delete set null,
  kind text not null default 'factura' check (kind in ('factura', 'proposta_preliminar', 'altres')),
  storage_path text not null unique,
  original_name text not null,
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null,
  status text not null default 'rebut' check (status in ('rebut', 'processant', 'llegit', 'error', 'esborrat')),
  client_document_id uuid references public.crm_documents (id) on delete set null,   -- còpia a la fitxa del client en convertir
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  retain_until timestamptz not null default now() + interval '2 years'
);
create index if not exists cap_docs_lead_idx on public.cap_lead_documents (lead_id);
create index if not exists cap_docs_sha_idx on public.cap_lead_documents (sha256);

-- lectures de factures (estructura normalitzada amb unitat, pàgina, estat i observacions)
create table if not exists public.cap_invoice_readings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.cap_lead_documents (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete cascade,
  status text not null default 'pendent' check (status in ('pendent', 'processant', 'llegida', 'per_revisar', 'revisada', 'error')),
  method text,                                             -- text / ia / mixt
  attempts integer not null default 0 check (attempts between 0 and 10),
  fields jsonb not null default '[]',                      -- [{key,label,value,unit,page,status,method,note}]
  raw jsonb,                                               -- estructura validada del lector existent
  warnings jsonb not null default '[]',
  missing jsonb not null default '[]',
  sufficient boolean not null default false,               -- dades suficients per a una comparativa preliminar
  comparison_id uuid references public.comparisons (id) on delete set null,
  preliminary jsonb,                                       -- resum de la comparativa preliminar (determinista)
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- atribució a col·laboradors (una sola vigent per lead; les altres queden en disputa per a Direcció)
create table if not exists public.cap_attributions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads (id) on delete cascade,
  partner_id uuid not null references public.cap_partners (id) on delete restrict,
  ref_code text,
  source text not null check (source in ('enllac', 'qr', 'portal', 'manual')),
  status text not null default 'vigent' check (status in ('vigent', 'en_disputa', 'rebutjada', 'substituida')),
  reason text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists cap_attr_one_valid_uq on public.cap_attributions (lead_id) where status = 'vigent';
create unique index if not exists cap_attr_pair_uq on public.cap_attributions (lead_id, partner_id);

-- regles i historial d'assignació
create table if not exists public.cap_assignment_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  priority integer not null default 100,
  active boolean not null default true,
  conditions jsonb not null default '{}',                  -- {provinces, cities, energy, customer_kinds, channels, partner_ids, min_kwh, max_kwh}
  strategy text not null default 'menys_carrega' check (strategy in ('usuari', 'rotatiu', 'menys_carrega')),
  user_ids uuid[] not null default '{}',
  max_open_leads integer check (max_open_leads is null or max_open_leads > 0),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.cap_assignments (
  id bigserial primary key,
  lead_id uuid not null references public.crm_leads (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  rule_id uuid references public.cap_assignment_rules (id) on delete set null,
  method text not null check (method in ('regla', 'manual', 'collaborador', 'per_defecte', 'sense_assignar')),
  reason text,
  assigned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cap_assign_lead_idx on public.cap_assignments (lead_id, created_at desc);

-- mètriques de la landing (sense IP ni identificadors personals)
create table if not exists public.cap_visits (
  id bigserial primary key,
  event text not null check (event in ('visita', 'formulari_iniciat', 'formulari_enviat')),
  session_hash text not null,
  path text,
  ref_code text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now(),
  unique (session_hash, event)
);
create index if not exists cap_visits_created_idx on public.cap_visits (created_at desc, event);

-- esdeveniments de conversió (embut; no s'envien a cap plataforma sense configuració ni base jurídica)
create table if not exists public.cap_conversion_events (
  id bigserial primary key,
  lead_id uuid not null references public.crm_leads (id) on delete cascade,
  kind text not null check (kind in ('lead', 'lead_valid', 'oportunitat', 'proposta_enviada', 'contracte_activat')),
  channel text,
  campaign_id uuid references public.cap_campaigns (id) on delete set null,
  partner_id uuid references public.cap_partners (id) on delete set null,
  value_mwh numeric(14, 3),
  occurred_at timestamptz not null default now(),
  upload_status text not null default 'no_configurat' check (upload_status in ('no_configurat', 'pendent', 'enviat', 'error')),
  unique (lead_id, kind)
);

-- webhooks rebuts (Meta Lead Ads, WhatsApp) amb verificació de signatura
create table if not exists public.cap_webhook_events (
  id bigserial primary key,
  provider text not null check (provider in ('meta_leadgen', 'whatsapp')),
  external_id text not null,
  signature_ok boolean not null,
  status text not null default 'rebut' check (status in ('rebut', 'processat', 'ignorat', 'pendent_credencials', 'error')),
  payload jsonb,                                           -- mínim necessari (sense dades de factura)
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_id)
);

-- missatges de WhatsApp (l'estat només avança amb el webhook)
create table if not exists public.cap_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads (id) on delete set null,
  client_id uuid references public.crm_clients (id) on delete set null,
  direction text not null check (direction in ('sortint', 'entrant')),
  wa_message_id text unique,
  phone text not null,
  template text,
  body text check (body is null or length(body) <= 4096),
  status text not null check (status in ('preparat', 'acceptat', 'enviat', 'lliurat', 'llegit', 'fallit', 'rebut')),
  status_at timestamptz,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cap_wa_lead_idx on public.cap_whatsapp_messages (lead_id, created_at desc);
create index if not exists cap_wa_phone_idx on public.cap_whatsapp_messages (phone, created_at desc);

-- auditoria de captació (atribucions, assignacions manuals, consentiments, col·laboradors)
create table if not exists public.cap_audit (
  id bigserial primary key,
  entity text not null,
  entity_id text,
  action text not null,
  detail jsonb,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================ bucket privat
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-documents', 'lead-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
-- Sense polítiques a storage.objects per a aquest bucket: només el servidor (client de servei) hi accedeix.

-- ============================================================ regles d'automatització (només avisos i tasques interns)
insert into public.crm_automation_rules (key, name, description, enabled, params) values
  ('cap_nou_lead', 'Nou lead captat', 'Crea una tasca de primer contacte per al responsable i l''avisa quan entra un lead per la web, un col·laborador o una campanya.', true, '{"due_hours": 4}'),
  ('cap_factura_processada', 'Factura processada', 'Avisa el responsable quan s''ha llegit la factura (amb les dades que cal revisar).', true, '{}'),
  ('cap_dades_incompletes', 'Dades de factura incompletes', 'Crea una tasca de revisió quan la lectura de la factura deixa dades pendents o dubtoses.', true, '{"due_days": 1}'),
  ('cap_lead_sense_assignar', 'Lead sense assignar', 'Avisa Direcció quan un lead captat porta X hores sense responsable.', true, '{"hours": 2}'),
  ('cap_proposta_revisio', 'Proposta preliminar pendent de revisió', 'Avisa el responsable quan una comparativa preliminar porta X dies sense revisar.', true, '{"days": 2}'),
  ('cap_contracte_activat', 'Contracte activat d''un lead captat', 'Avisa el responsable i el col·laborador quan s''activa un contracte d''un lead captat.', true, '{}'),
  ('cap_comissio_meritable', 'Comissió meritable del col·laborador', 'Avisa el col·laborador quan una comissió seva passa a meritada.', true, '{}'),
  ('cap_liquidacio_disponible', 'Liquidació disponible', 'Avisa el col·laborador quan té una liquidació aprovada per consultar o descarregar.', true, '{}'),
  ('cap_reprocessa', 'Reintents de captació', 'Reprocessa sol·licituds i lectures de factura amb error (màxim d''intents).', true, '{"max_attempts": 3}')
on conflict (key) do nothing;

-- ============================================================ permisos
create or replace function public.cap_my_partner() returns uuid
language sql stable security definer set search_path = public as $$
  select id from cap_partners where user_id = auth.uid() and status = 'actiu' limit 1;
$$;

alter table public.cap_campaigns enable row level security;
alter table public.cap_campaign_costs enable row level security;
alter table public.cap_partners enable row level security;
alter table public.cap_referral_links enable row level security;
alter table public.cap_submissions enable row level security;
alter table public.cap_consents enable row level security;
alter table public.cap_lead_documents enable row level security;
alter table public.cap_invoice_readings enable row level security;
alter table public.cap_attributions enable row level security;
alter table public.cap_assignment_rules enable row level security;
alter table public.cap_assignments enable row level security;
alter table public.cap_visits enable row level security;
alter table public.cap_conversion_events enable row level security;
alter table public.cap_webhook_events enable row level security;
alter table public.cap_whatsapp_messages enable row level security;
alter table public.cap_audit enable row level security;

-- Cap política per a «anon»: els formularis públics no poden llegir ni escriure directament.
-- Màrqueting i configuració: equip d'administració; regles d'assignació i campanyes: només Direcció les modifica.
drop policy if exists cap_campaigns_sel on public.cap_campaigns;
create policy cap_campaigns_sel on public.cap_campaigns for select to authenticated using (public.is_staff());
drop policy if exists cap_campaigns_mod on public.cap_campaigns;
create policy cap_campaigns_mod on public.cap_campaigns for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists cap_costs_sel on public.cap_campaign_costs;
create policy cap_costs_sel on public.cap_campaign_costs for select to authenticated using (public.is_staff());
drop policy if exists cap_rules_sel on public.cap_assignment_rules;
create policy cap_rules_sel on public.cap_assignment_rules for select to authenticated using (public.is_staff());
drop policy if exists cap_rules_mod on public.cap_assignment_rules;
create policy cap_rules_mod on public.cap_assignment_rules for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists cap_sub_sel on public.cap_submissions;
create policy cap_sub_sel on public.cap_submissions for select to authenticated using (public.is_staff());
drop policy if exists cap_visits_sel on public.cap_visits;
create policy cap_visits_sel on public.cap_visits for select to authenticated using (public.is_staff());
drop policy if exists cap_webhooks_sel on public.cap_webhook_events;
create policy cap_webhooks_sel on public.cap_webhook_events for select to authenticated using (public.my_role() = 'admin');
drop policy if exists cap_audit_sel on public.cap_audit;
create policy cap_audit_sel on public.cap_audit for select to authenticated using (public.is_staff());

-- Col·laboradors: cadascú només veu el seu perfil i els seus enllaços
drop policy if exists cap_partners_sel on public.cap_partners;
create policy cap_partners_sel on public.cap_partners for select to authenticated using (public.is_staff() or user_id = auth.uid());
drop policy if exists cap_links_sel on public.cap_referral_links;
create policy cap_links_sel on public.cap_referral_links for select to authenticated using (public.is_staff() or partner_id = public.cap_my_partner());
drop policy if exists cap_attr_sel on public.cap_attributions;
create policy cap_attr_sel on public.cap_attributions for select to authenticated using (public.is_staff() or partner_id = public.cap_my_partner());
-- Només Direcció crea (atribució manual) o decideix atribucions; el trigger exigeix motiu i impedeix reassignar
drop policy if exists cap_attr_ins on public.cap_attributions;
create policy cap_attr_ins on public.cap_attributions for insert to authenticated with check (public.my_role() = 'admin');
drop policy if exists cap_attr_upd on public.cap_attributions;
create policy cap_attr_upd on public.cap_attributions for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Documents, lectures, consentiments, assignacions i conversions: qui veu el lead (la RLS del lead de la Fase 2)
drop policy if exists cap_docs_sel on public.cap_lead_documents;
create policy cap_docs_sel on public.cap_lead_documents for select to authenticated using (
  public.is_staff() or (lead_id is not null and public.crm_can_see_lead(lead_id) and (public.my_role() <> 'colaborador' or uploaded_by = auth.uid())));
drop policy if exists cap_read_sel on public.cap_invoice_readings;
create policy cap_read_sel on public.cap_invoice_readings for select to authenticated using (
  public.is_staff() or (lead_id is not null and public.crm_can_see_lead(lead_id) and public.my_role() <> 'colaborador'));
drop policy if exists cap_consents_sel on public.cap_consents;
create policy cap_consents_sel on public.cap_consents for select to authenticated using (public.is_staff() or (lead_id is not null and public.crm_can_edit_lead(lead_id)));
drop policy if exists cap_assign_sel on public.cap_assignments;
create policy cap_assign_sel on public.cap_assignments for select to authenticated using (public.is_staff() or public.crm_can_edit_lead(lead_id));
drop policy if exists cap_conv_sel on public.cap_conversion_events;
create policy cap_conv_sel on public.cap_conversion_events for select to authenticated using (public.is_staff());
drop policy if exists cap_wa_sel on public.cap_whatsapp_messages;
create policy cap_wa_sel on public.cap_whatsapp_messages for select to authenticated using (
  public.is_staff() or (lead_id is not null and public.crm_can_edit_lead(lead_id)) or (client_id is not null and public.crm_can_edit_client(client_id)));

-- ============================================================ integritat
-- Atribució: ningú excepte Direcció la canvia; la vigent només es substitueix amb motiu. Queda auditat.
create or replace function public.cap_attr_before() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and public.my_role() <> 'admin' then
    raise exception 'Només Direcció pot modificar l''atribució d''un lead';
  end if;
  if tg_op = 'UPDATE' then
    if new.lead_id <> old.lead_id or new.partner_id <> old.partner_id then raise exception 'L''atribució no es pot reassignar: crea''n una de nova'; end if;
    if new.status is distinct from old.status and coalesce(trim(new.reason), '') = '' then raise exception 'Cal indicar el motiu del canvi d''atribució'; end if;
    if new.status is distinct from old.status then new.decided_by := coalesce(auth.uid(), new.decided_by); new.decided_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists cap_attr_before_trg on public.cap_attributions;
create trigger cap_attr_before_trg before insert or update on public.cap_attributions for each row execute function public.cap_attr_before();

create or replace function public.cap_attr_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into cap_audit (entity, entity_id, action, detail, user_id)
  values ('cap_attributions', new.id::text, case when tg_op = 'INSERT' then 'creada' else 'estat_' || new.status end,
          jsonb_build_object('lead_id', new.lead_id, 'partner_id', new.partner_id, 'status', new.status, 'reason', new.reason), auth.uid());
  -- el lead (i, en convertir, el client) porta el col·laborador de l'atribució vigent → comissions de la Fase 4
  if new.status = 'vigent' then
    update crm_leads set capture_partner_id = new.partner_id, collaborator_id = coalesce((select user_id from cap_partners where id = new.partner_id), collaborator_id) where id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists cap_attr_after_trg on public.cap_attributions;
create trigger cap_attr_after_trg after insert or update on public.cap_attributions for each row execute function public.cap_attr_after();

-- Registres només d'afegir
drop trigger if exists cap_assign_append on public.cap_assignments;
create trigger cap_assign_append before update on public.cap_assignments for each row execute function public.crm_append_only();
drop trigger if exists cap_audit_append on public.cap_audit;
create trigger cap_audit_append before update on public.cap_audit for each row execute function public.crm_append_only();
-- Consentiments: només es pot retirar (withdrawn_at), mai modificar-ne el contingut
create or replace function public.cap_consent_before() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['withdrawn_at', 'withdrawn_by']) is distinct from (to_jsonb(old) - array['withdrawn_at', 'withdrawn_by']) then
    raise exception 'Un consentiment registrat no es modifica: només es pot retirar';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then raise exception 'El consentiment ja s''ha retirat'; end if;
  return new;
end $$;
drop trigger if exists cap_consent_before_trg on public.cap_consents;
create trigger cap_consent_before_trg before update on public.cap_consents for each row execute function public.cap_consent_before();

-- WhatsApp: l'estat avança, no retrocedeix; «lliurat» i «llegit» només amb el webhook (servidor)
create or replace function public.cap_wa_before() returns trigger language plpgsql as $$
declare rank_old int; rank_new int;
begin
  rank_old := array_position(array['preparat', 'acceptat', 'enviat', 'lliurat', 'llegit'], old.status);
  rank_new := array_position(array['preparat', 'acceptat', 'enviat', 'lliurat', 'llegit'], new.status);
  if auth.uid() is not null and new.status is distinct from old.status then raise exception 'L''estat d''un missatge només l''actualitza el servidor'; end if;
  if old.status in ('fallit', 'rebut') and new.status is distinct from old.status then raise exception 'Estat final'; end if;
  if rank_old is not null and rank_new is not null and rank_new < rank_old then new.status := old.status; new.status_at := old.status_at; end if;
  return new;
end $$;
drop trigger if exists cap_wa_before_trg on public.cap_whatsapp_messages;
create trigger cap_wa_before_trg before update on public.cap_whatsapp_messages for each row execute function public.cap_wa_before();

-- Anonimització en acabar la conservació (sol·licituds no convertides): s'esborren les dades personals
create or replace function public.cap_anonymize_expired() returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update cap_submissions set name = null, phone = null, email = null, notes = null, contact_hash = null, ip_hash = null, utm = null, click_ids = null
  where retain_until < now() and (name is not null or phone is not null or email is not null);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.cap_anonymize_expired() from public;
revoke all on function public.cap_anonymize_expired() from authenticated;
revoke all on function public.cap_anonymize_expired() from anon;
