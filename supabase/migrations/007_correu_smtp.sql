-- 007 · Correu corporatiu configurable des del CRM (Configuració → Correu).
-- Additiva i idempotent. No toca cap taula existent.
-- La contrasenya es desa XIFRADA (AES-256-GCM) pel servidor; la taula no és accessible des del navegador:
-- RLS activat sense cap política + revocació explícita. Només el servidor (service role), després de comprovar
-- que l'usuari és administrador, la llegeix o l'escriu.

create table if not exists public.mail_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  host text not null,
  port integer not null check (port between 1 and 65535),
  security text not null default 'starttls' check (security in ('starttls', 'ssl', 'none')),
  username text not null,
  password_enc text,
  from_name text,
  from_email text not null,
  reply_to_mode text not null default 'usuari' check (reply_to_mode in ('usuari', 'remitent', 'fixa')),
  reply_to text,
  bcc_sender boolean not null default false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

alter table public.mail_settings enable row level security;
revoke all on table public.mail_settings from anon, authenticated;

comment on table public.mail_settings is 'Compte SMTP del CRM. Contrasenya xifrada pel servidor. Sense accés des del navegador.';
