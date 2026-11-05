-- =====================================================================================================
-- Fase 7 · Configuració inicial de l'equip (s'executa UNA vegada, després de la migració 014, al SQL Editor).
-- Els permisos depenen del ROL, mai del nom: aquí només s'assigna el rol de cada persona (pel seu correu) i el
-- panell inicial de Direcció (per identificador d'usuari). Les persones han d'haver estat donades d'alta abans
-- (Configuració → Usuaris) perquè existeixin a auth.users / profiles.
--
-- 1) Revisa i completa els correus de la llista «equip». Les files amb un correu que no existeix s'ignoren.
-- 2) Executa el fitxer sencer. És idempotent: es pot tornar a executar sense duplicar res.
-- La persona administrativa encara no està designada: quan s'incorpori, dona-la d'alta amb el rol «Administrativa».
-- =====================================================================================================
with equip(email, rol, panell) as (values
  ('joan@assessoria30.com',     'admin',              'direccio_operativa'),   -- DIRECCIO · Joan        (REVISA EL CORREU)
  ('olivie@assessoria30.com',   'admin',              'direccio_comercial'),   -- DIRECCIO · Olivié
  ('iberth@assessoria30.com',   'cap_administrativa', null),                   -- CAP_ADMINISTRATIVA · Iberth (REVISA EL CORREU)
  ('patricia@assessoria30.com', 'comercial',          null)                    -- COMERCIAL · Patricia   (REVISA EL CORREU)
)
update public.profiles p set role = e.rol
  from equip e
 where lower(p.email) = lower(e.email) and p.role is distinct from e.rol;

-- Panell inicial de cada directiu (preferència personal per identificador d'usuari; cadascú el pot canviar després)
with equip(email, layout) as (values
  ('olivie@assessoria30.com', '{"control": {"template": "direccio_comercial", "period": "mes", "filters": {}, "saved": [], "widgets": [{"id": "kpi:contractes_dia", "size": 1}, {"id": "kpi:contractes_setmana", "size": 1}, {"id": "kpi:contractes_mes", "size": 1}, {"id": "kpi:mwh", "size": 1}, {"id": "serie_comercial", "size": 2}, {"id": "equip", "size": 2}, {"id": "collaboradors", "size": 2}, {"id": "kpi:comissions_meritades", "size": 1}, {"id": "kpi:comissions_cobrades", "size": 1}, {"id": "kpi:marge_realitzat", "size": 1}, {"id": "kpi:rendibilitat", "size": 1}, {"id": "objectius", "size": 2}, {"id": "ia", "size": 2}, {"id": "serie_economica", "size": 2}]}}'::jsonb),
  ('joan@assessoria30.com',   '{"control": {"template": "direccio_operativa", "period": "setmana", "filters": {}, "saved": [], "widgets": [{"id": "kpi:tramitacio", "size": 1}, {"id": "kpi:expedients_pendents", "size": 1}, {"id": "kpi:bloquejats", "size": 1}, {"id": "kpi:renovacions_urgents", "size": 1}, {"id": "kpi:incidencies_obertes", "size": 1}, {"id": "kpi:tasques_vencudes", "size": 1}, {"id": "alertes", "size": 2}, {"id": "tasques_equip", "size": 2}, {"id": "equip", "size": 2}, {"id": "renovacions", "size": 2}, {"id": "qualitat", "size": 2}, {"id": "kpi:documentacio_incompleta", "size": 1}]}}'::jsonb)
)
insert into public.user_dashboard_prefs (user_id, layout)
select p.id, e.layout from equip e join public.profiles p on lower(p.email) = lower(e.email)
on conflict (user_id) do nothing;

-- Comprovació
select p.name, p.email, p.role, (d.user_id is not null) as te_panell
  from public.profiles p left join public.user_dashboard_prefs d on d.user_id = p.id
 order by p.role, p.name;
