-- Desfà la migració 007 (torna a fer servir només les variables SMTP_* de Vercel).
drop table if exists public.mail_settings;
