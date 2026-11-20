-- =====================================================================================================
-- DIAGNÒSTIC DE COMISSIONS SENSE CÀLCUL · NOMÉS LECTURA (no modifica res). Es pot executar abans i després de la 059.
-- =====================================================================================================

-- 1. Últims 14 dies: contractes, sense cap càlcul, i sense col·laborador al contracte
select count(*) as total,
       count(*) filter (where not exists (select 1 from fin_calculations f where f.contract_id = k.id)) as sense_calcul,
       count(*) filter (where k.collaborator_id is null) as sense_collaborador_al_contracte
  from crm_contracts k where k.created_at > now() - interval '14 days';

-- 2. Tots els contractes d'energia sense càlcul, separant els que tenen indicadors econòmics protegits
select count(*) as energia_sense_calcul,
       count(*) filter (where exists (select 1 from fin_ledger l where l.contract_id = k.id)
                          or exists (select 1 from fin_settlement_lines s where s.contract_id = k.id)
                          or exists (select 1 from fin_statement_lines s where s.contract_id = k.id)
                          or exists (select 1 from fin_hist_lines h where h.contract_id = k.id)
                          or exists (select 1 from crm_commission_records r where r.contract_id = k.id and (r.accrual_status = 'meritada' or r.payment_status in ('cobrada', 'parcial', 'impagada') or r.paid_eur is not null))
                          or exists (select 1 from crm_contract_finance c where c.contract_id = k.id and (c.commission_paid_at is not null or c.settlement_ref is not null or c.commission_eur is not null or c.commission_status in ('meritada', 'liquidada', 'cobrada', 'retrocedida')))) as amb_indicadors_protegits
  from crm_contracts k
 where k.service in ('llum_residencial', 'llum_empresa', 'gas')
   and not exists (select 1 from fin_calculations f where f.contract_id = k.id);

-- 3. Gas mal classificat (servei del contracte incoherent amb el tipus d'energia del CUPS)
select k.service as servei_contracte, s.energy_type as energia_cups, count(*) as contractes
  from crm_contracts k join crm_supplies s on s.id = k.supply_id
 where k.service in ('llum_residencial', 'llum_empresa', 'gas') and ((s.energy_type = 'gas') <> (k.service = 'gas'))
 group by 1, 2 order by 3 desc;

-- 4. Contractes d'energia sense càlcul per comercialitzadora i servei (per preveure regles que falten)
select k.retailer, k.service, count(*) as contractes
  from crm_contracts k
 where k.service in ('llum_residencial', 'llum_empresa', 'gas') and not exists (select 1 from fin_calculations f where f.contract_id = k.id)
 group by 1, 2 order by 3 desc limit 50;
