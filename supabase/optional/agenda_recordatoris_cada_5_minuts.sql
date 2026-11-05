-- =====================================================================================================
-- OPCIONAL · Recordatoris de l'agenda cada 5 minuts, encara que ningú tingui el CRM obert.
-- =====================================================================================================
-- Per defecte, els recordatoris es generen (1) cada minut mentre algú té el CRM obert i (2) un cop al dia amb
-- la tasca programada de Vercel. Per als avisos de 5-15 minuts sense cap sessió oberta, Supabase pot cridar
-- el CRM cada 5 minuts amb pg_cron + pg_net.
--
-- ABANS D'EXECUTAR-HO:
--   1. Supabase → Database → Extensions: activa «pg_cron» i «pg_net».
--   2. Supabase → Project Settings → Vault: crea dos secrets (no els escriguis en aquest fitxer):
--        crm_app_url      = l'adreça del CRM, p. ex. https://crm.assessoria30.com   (sense barra final)
--        crm_cron_secret  = el MATEIX valor que la variable CRON_SECRET de Vercel
--   3. Executa aquest fitxer. Per desactivar-ho:  select cron.unschedule('agenda-recordatoris');
-- =====================================================================================================
select cron.unschedule('agenda-recordatoris') where exists (select 1 from cron.job where jobname = 'agenda-recordatoris');
select cron.schedule('agenda-recordatoris', '*/5 * * * *', $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'crm_app_url') || '/api/agenda/cron',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret')),
    timeout_milliseconds := 60000);
$$);
-- COMPROVACIÓ: ha de sortir una fila «agenda-recordatoris» activa
select jobname, schedule, active from cron.job where jobname = 'agenda-recordatoris';
