-- Desfà la migració 011 (CRM Fase 4: control econòmic). ATENCIÓ: elimina regles, càlculs, moviments, liquidacions,
-- pagaments, conciliacions, costos, objectius i l'auditoria financera. Fes una còpia abans (Database → Backups).
-- No toca cap taula de les fases anteriors (contractes, expedients, oportunitats…).
delete from public.crm_automation_rules where key in ('fin_sense_liquidar', 'fin_diferencia', 'fin_anullat_pagat', 'fin_pagament_duplicat', 'fin_liquidacio_pendent', 'fin_collaborador_saldo', 'fin_objectiu_assolit', 'fin_possible_retrocessio');
drop function if exists public.fin_register_receipt(uuid, numeric, date, text, text);
drop function if exists public.fin_build_settlement(text, uuid, date, date, text);
drop function if exists public.fin_refresh_settlement(uuid);
drop table if exists public.fin_audit cascade;
drop table if exists public.fin_targets cascade;
drop table if exists public.fin_collaborator_terms cascade;
drop table if exists public.fin_costs cascade;
drop table if exists public.fin_payments cascade;
drop table if exists public.fin_settlement_lines cascade;
drop table if exists public.fin_ledger cascade;
drop table if exists public.fin_provider_receipts cascade;
drop table if exists public.fin_statement_lines cascade;
drop table if exists public.fin_provider_statements cascade;
drop table if exists public.fin_settlements cascade;
drop sequence if exists public.fin_settlement_seq;
drop table if exists public.fin_calculations cascade;
drop table if exists public.fin_contract_economics cascade;
drop table if exists public.fin_rules cascade;
drop function if exists public.fin_touch();
drop function if exists public.fin_payment_after();
drop function if exists public.fin_payment_before();
drop function if exists public.fin_sline_guard();
drop function if exists public.fin_settlement_after();
drop function if exists public.fin_settlement_before();
drop function if exists public.fin_ledger_after();
drop function if exists public.fin_ledger_before();
drop function if exists public.fin_calc_before();
drop function if exists public.fin_rule_after();
drop function if exists public.fin_rule_before();
drop function if exists public.fin_can_manage_rules();
