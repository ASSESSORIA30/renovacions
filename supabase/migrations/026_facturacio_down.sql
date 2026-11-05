-- 026 · REVERSIÓ de la facturació pròpia.
-- ATENCIÓ: elimina les taules de facturació i les factures que contenen. Fes-ne una còpia abans (Facturació › Exportar).
-- No toca cap taula de les migracions 001-025.
drop view if exists public.bill_invoices_v;
drop function if exists public.bill_register_payment(uuid, numeric, date, text, text, text);
drop function if exists public.bill_create_rectification(uuid, text);
drop function if exists public.bill_issue_invoice(uuid, date);
drop function if exists public.bill_statement_summary(uuid);
drop table if exists public.bill_events cascade;
drop table if exists public.bill_email_log cascade;
drop table if exists public.bill_statement_claims cascade;
drop table if exists public.bill_invoice_statements cascade;
drop table if exists public.bill_payments cascade;
drop table if exists public.bill_invoice_lines cascade;
drop table if exists public.bill_invoices cascade;
drop table if exists public.bill_number_gaps cascade;
drop table if exists public.bill_series cascade;
drop table if exists public.bill_clients cascade;
drop table if exists public.bill_settings cascade;
drop function if exists public.bill_log(text, uuid, uuid, jsonb);
drop function if exists public.bill_audit();
drop function if exists public.bill_events_ro();
drop function if exists public.bill_payments_ro();
drop function if exists public.bill_invoice_insert_guard();
drop function if exists public.bill_invoice_guard();
drop function if exists public.bill_lines_after();
drop function if exists public.bill_recalc(uuid);
drop function if exists public.bill_line_guard();
drop function if exists public.bill_line_before();
drop function if exists public.bill_client_before();
delete from public.user_permissions where module = 'facturacio';
delete from public.role_permissions where module = 'facturacio';
