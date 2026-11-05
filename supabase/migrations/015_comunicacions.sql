-- =====================================================================================================
-- Fase 8 · Comunicacions per usuari, sol·licituds de ressenya i de protecció de dades, i espai de treball persistent
-- =====================================================================================================
-- Additiva i idempotent. No esborra res.
--   · user_mail_accounts: correu propi de cada usuari (SMTP). La contrasenya es desa XIFRADA pel servidor
--     (AES-256-GCM, clau SETTINGS_ENCRYPTION_KEY) i la taula NO té cap política per al navegador: només hi accedeix
--     el servidor després de comprovar que l'usuari és qui diu ser. Mai es retorna cap credencial.
--   · user_whatsapp: número professional de cada usuari (mode enllaç wa.me) o número empresarial autoritzat (Cloud API).
--   · wa_business_numbers / wa_number_access: números empresarials i qui els pot fer servir (els decideix Direcció).
--   · client_requests: sol·licituds de ressenya Google i d'autorització de tractament de dades, amb estat, idioma,
--     canal, base jurídica i evidència. Obrir un enllaç MAI marca res com a signat.
--   · user_workspace: dades de treball de l'usuari al mòdul energètic (ofertes, configuració, factures i màxims)
--     que fins ara només es guardaven al navegador.
-- Desfer: 015_comunicacions_down.sql
-- =====================================================================================================

-- ============================================================ correu per usuari
create table if not exists public.user_mail_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null default 'smtp' check (provider in ('smtp', 'google_oauth', 'microsoft_oauth')),
  from_name text not null check (length(trim(from_name)) between 1 and 120),
  from_email text not null check (from_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  reply_to text check (reply_to is null or reply_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  signature text check (signature is null or length(signature) <= 4000),
  host text,
  port integer check (port is null or port between 1 and 65535),
  security text check (security is null or security in ('ssl', 'starttls', 'none')),
  username text,
  password_enc text,                                -- xifrada al servidor; mai es retorna
  enabled boolean not null default true,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.user_mail_accounts enable row level security;
-- (sense polítiques: el navegador no hi pot llegir ni escriure; només el servidor amb la clau de servei)

-- ============================================================ WhatsApp per usuari
create table if not exists public.wa_business_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_number_id text not null unique,             -- identificador del número a WhatsApp Business Cloud API
  display_phone text not null,
  label text not null,
  active boolean not null default true,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.wa_number_access (
  number_id uuid not null references public.wa_business_numbers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (number_id, user_id)
);
create table if not exists public.user_whatsapp (
  user_id uuid primary key references auth.users (id) on delete cascade,
  mode text not null default 'enllac' check (mode in ('enllac', 'cloud')),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  display_name text check (display_name is null or length(display_name) <= 120),
  default_number_id uuid references public.wa_business_numbers (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.wa_business_numbers enable row level security;
alter table public.wa_number_access enable row level security;
alter table public.user_whatsapp enable row level security;
drop policy if exists p_wa_numbers_select on public.wa_business_numbers;
create policy p_wa_numbers_select on public.wa_business_numbers for select to authenticated
  using (public.my_role() = 'admin' or exists (select 1 from wa_number_access a where a.number_id = id and a.user_id = auth.uid()));
drop policy if exists p_wa_numbers_write on public.wa_business_numbers;
create policy p_wa_numbers_write on public.wa_business_numbers for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists p_wa_access_select on public.wa_number_access;
create policy p_wa_access_select on public.wa_number_access for select to authenticated using (user_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists p_wa_access_write on public.wa_number_access;
create policy p_wa_access_write on public.wa_number_access for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists p_user_wa_own on public.user_whatsapp;
create policy p_user_wa_own on public.user_whatsapp for all to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  -- un usuari només pot triar un número empresarial que Direcció li ha autoritzat
  and (default_number_id is null or exists (select 1 from wa_number_access a where a.number_id = default_number_id and a.user_id = auth.uid())));

-- ============================================================ sol·licituds de ressenya i de protecció de dades
do $$ begin
  -- nova categoria documental per a les evidències de protecció de dades (superconjunt: cap fila queda invàlida)
  alter table public.crm_documents drop constraint if exists crm_documents_category_check;
  if not exists (select 1 from pg_constraint where conname = 'crm_documents_category_chk') then
    alter table public.crm_documents add constraint crm_documents_category_chk check (category in ('dni_nie', 'fiscal', 'factura_llum', 'factura_gas', 'contracte', 'contracte_signat', 'mandat', 'proposta', 'bancaria', 'altres', 'proteccio_dades'));
  end if;
end $$;

create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  kind text not null check (kind in ('ressenya', 'proteccio_dades')),
  language text not null check (language in ('ca', 'es')),
  channel text not null check (channel in ('whatsapp', 'email', 'copiat', 'manual')),
  status text not null check (status in (
    'preparada', 'enviada',                                                          -- ressenya: mai «publicada» (no hi ha confirmació fiable)
    'pendent', 'sollicitada', 'formulari_enviat', 'completada', 'rebutjada', 'caducada')),  -- protecció de dades
  legal_basis text check (legal_basis is null or legal_basis in ('consentiment', 'execucio_contracte', 'obligacio_legal', 'interes_legitim')),
  recipient text,                                  -- telèfon o correu al qual s'ha adreçat
  message text check (message is null or length(message) <= 4000),
  delivery text check (delivery is null or delivery in ('intent', 'registrat', 'enviat', 'error')),  -- igual que crm_activities
  evidence_document_id uuid references public.crm_documents (id) on delete set null,
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  expires_at date,
  note text check (note is null or length(note) <= 1000),
  requested_by uuid references auth.users (id) default auth.uid(),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- «completada» exigeix una confirmació registrada per una persona (i, si n'hi ha, l'evidència)
  check (status <> 'completada' or (confirmed_by is not null and confirmed_at is not null))
);
create index if not exists client_requests_client_idx on public.client_requests (client_id, kind, requested_at desc);
alter table public.client_requests enable row level security;
drop policy if exists p_client_req_select on public.client_requests;
create policy p_client_req_select on public.client_requests for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists p_client_req_insert on public.client_requests;
create policy p_client_req_insert on public.client_requests for insert to authenticated
  with check (public.crm_can_edit_client(client_id) and requested_by = auth.uid() and coalesce(public.my_role(), '') <> 'colaborador');
drop policy if exists p_client_req_update on public.client_requests;
create policy p_client_req_update on public.client_requests for update to authenticated
  using (public.crm_can_edit_client(client_id) and coalesce(public.my_role(), '') <> 'colaborador') with check (public.crm_can_edit_client(client_id));

-- evita duplicats accidentals: la mateixa sol·licitud pel mateix canal en menys de 2 minuts
create or replace function public.client_requests_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and exists (select 1 from client_requests r where r.client_id = new.client_id and r.kind = new.kind and r.channel = new.channel
       and r.requested_by is not distinct from new.requested_by and r.requested_at > now() - interval '2 minutes') then
    raise exception 'Ja s''ha registrat aquesta sol·licitud fa menys de 2 minuts' using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'completada' and old.status <> 'completada' and auth.uid() is not null then
      new.confirmed_by := auth.uid(); new.confirmed_at := coalesce(new.confirmed_at, now());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists client_requests_guard on public.client_requests;
create trigger client_requests_guard before insert or update on public.client_requests for each row execute function public.client_requests_guard();

-- auditoria: cada canvi d'estat d'una autorització de dades queda a sec_audit (si existeix la 014)
create or replace function public.client_requests_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('public.sec_audit') is not null and new.kind = 'proteccio_dades' and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    insert into sec_audit (actor_id, actor_name, action, entity, entity_id, detail)
    values (auth.uid(), (select name from profiles where id = auth.uid()), 'proteccio_dades_' || new.status, 'client_requests', new.id::text,
            jsonb_build_object('client_id', new.client_id, 'abans', case when tg_op = 'UPDATE' then old.status end, 'despres', new.status, 'evidencia', new.evidence_document_id is not null, 'base', new.legal_basis));
  end if;
  return null;
end $$;
drop trigger if exists client_requests_audit on public.client_requests;
create trigger client_requests_audit after insert or update on public.client_requests for each row execute function public.client_requests_audit();

-- ============================================================ espai de treball persistent (mòdul energètic)
create table if not exists public.user_workspace (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_.-]{1,60}$'),
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  check (octet_length(data::text) <= 3000000)
);
alter table public.user_workspace enable row level security;
drop policy if exists p_user_workspace_own on public.user_workspace;
create policy p_user_workspace_own on public.user_workspace for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
