-- 028 · REVERSIÓ: elimina els extractes importats i les seves conciliacions.
-- ELS COBRAMENTS JA REGISTRATS A LES FACTURES ES CONSERVEN (bill_payments no es toca).
drop function if exists public.bill_bank_confirm(uuid, jsonb);
drop table if exists public.bill_bank_matches;
drop table if exists public.bill_bank_movements;
drop table if exists public.bill_bank_imports;
