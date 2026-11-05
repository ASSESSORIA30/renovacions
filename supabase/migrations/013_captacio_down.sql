-- Reverteix 013_captacio.sql (només objectes creats per la Fase 6).
-- ATENCIÓ: esborra sol·licituds, consentiments, documents de leads (registre), lectures, atribucions, campanyes i missatges.
-- Els fitxers del bucket `lead-documents` NO s'esborren aquí: buida'l manualment si cal (o conserva'l per obligacions legals).
-- No toca leads, clients, oportunitats, contractes ni comissions; les columnes de captació dels leads es conserven.
drop table if exists public.cap_audit;
drop table if exists public.cap_whatsapp_messages;
drop table if exists public.cap_webhook_events;
drop table if exists public.cap_conversion_events;
drop table if exists public.cap_visits;
drop table if exists public.cap_assignments;
drop table if exists public.cap_assignment_rules;
drop table if exists public.cap_attributions;
drop table if exists public.cap_invoice_readings;
drop table if exists public.cap_lead_documents;
drop table if exists public.cap_consents;
alter table if exists public.crm_leads drop constraint if exists crm_leads_submission_fk;
alter table if exists public.crm_leads drop constraint if exists crm_leads_partner_fk;
alter table if exists public.crm_leads drop constraint if exists crm_leads_campaign_fk;
drop table if exists public.cap_submissions;
drop table if exists public.cap_referral_links;
drop table if exists public.cap_partners;
drop table if exists public.cap_campaign_costs;
drop table if exists public.cap_campaigns;
drop function if exists public.cap_my_partner();
drop function if exists public.cap_attr_before();
drop function if exists public.cap_attr_after();
drop function if exists public.cap_consent_before();
drop function if exists public.cap_wa_before();
drop function if exists public.cap_anonymize_expired();
delete from public.crm_automation_rules where key like 'cap\_%';
drop index if exists public.crm_leads_channel_idx;
drop index if exists public.crm_leads_cups_idx;
-- Les columnes de captació dels leads (canal, campanya, UTM, CUPS, duplicats) es CONSERVEN: són dades de clients.
-- Esborra-les només si cal:
-- alter table public.crm_leads drop constraint if exists crm_leads_capture_channel_chk;
-- alter table public.crm_leads drop constraint if exists crm_leads_dup_status_chk;
-- alter table public.crm_leads drop column if exists capture_channel, drop column if exists capture_campaign_id, drop column if exists capture_partner_id,
--   drop column if exists capture_submission_id, drop column if exists utm, drop column if exists energy_type, drop column if exists cups,
--   drop column if exists duplicate_status, drop column if exists duplicate_refs;
