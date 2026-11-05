-- Desfà la 025 SENSE esborrar dades econòmiques (mateix criteri que les migracions anteriors):
--  · es treuen l'obligació d'autoritzar les reclamacions i la funció de cobrament net (es torna a fer servir
--    fin_register_receipt de la 011);
--  · es desactiven les alertes de l'auditor (no s'esborren);
--  · les columnes noves i la taula d'assignacions de cobrament es CONSERVEN, perquè poden contenir l'historial de
--    cobraments i la traçabilitat de les liquidacions importades. Per eliminar-les cal fer-ho a mà després
--    d'exportar les dades.
drop trigger if exists fin_claims_authz on public.fin_claims;
drop function if exists public.fin_claim_authz();
drop trigger if exists fin_claim_items_reauth on public.fin_claim_items;
drop function if exists public.fin_claim_items_reauth();
drop function if exists public.fin_register_receipt_net(uuid, numeric, date, text, text);
update public.crm_automation_rules set enabled = false where key like 'audit_%';

-- COMPROVACIÓ: ha de retornar 0 · 0 · 7 (alertes desactivades, no esborrades)
select 'disparador d''autorització' as què, count(*) as total from pg_trigger where tgname = 'fin_claims_authz'
union all select 'funció de cobrament net', count(*) from pg_proc where proname = 'fin_register_receipt_net'
union all select 'alertes desactivades', count(*) from public.crm_automation_rules where key like 'audit_%' and not enabled;
