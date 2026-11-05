-- Desfer la migració 015 (Fase 8). Conserva per defecte les sol·licituds de clients i l'espai de treball (dades
-- d'usuari); treu les configuracions de correu i WhatsApp. Descomenta les línies finals només si n'estàs segur.
drop trigger if exists client_requests_guard on public.client_requests;
drop trigger if exists client_requests_audit on public.client_requests;
drop function if exists public.client_requests_guard();
drop function if exists public.client_requests_audit();
drop table if exists public.user_whatsapp cascade;
drop table if exists public.wa_number_access cascade;
drop table if exists public.wa_business_numbers cascade;
drop table if exists public.user_mail_accounts;
-- La categoria «proteccio_dades» es manté permesa perquè cap document existent quedi invàlid.
-- drop table if exists public.client_requests;
-- drop table if exists public.user_workspace;
