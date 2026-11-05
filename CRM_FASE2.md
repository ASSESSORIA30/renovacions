# CRM · Fase 2: CRM comercial intel·ligent

Aquesta fase amplia el CRM de la Fase 1 (Clients 360°). No substitueix cap mòdul existent. El Kanban de **renovacions** (`?v=kanban`) continua intacte. El Kanban **comercial** de captació (`?v=pipeline`) és una vista nova i independent.

## Què inclou

| Vista | Ruta | Contingut |
|---|---|---|
| La meva jornada | `?v=jornada` | Tasques vençudes, trucades, reunions, propostes per seguir, leads i clients per contactar, renovacions urgents (30 dies), noves oportunitats assignades. També un calendari de dia, setmana o mes amb tasques, pròximes accions i venciments. |
| Leads | `?v=leads` | Llista amb filtres, alta (cal telèfon o correu), assignació, descart o reobertura, i conversió en client sense duplicar (es busquen coincidències per NIF, telèfon i correu). |
| Oportunitats | `?v=pipeline` | Kanban amb les columnes Nou lead → Contactat → Factura sol·licitada → Estudi en curs → Proposta enviada → Negociació → Guanyat / Perdut. Es pot arrossegar, filtrar (comercial, servei, província, prioritat, estat) i s'actualitza en temps real. |
| Fitxa d'oportunitat | `?v=oportunitat&id=…` | Barra d'etapes, client o lead, CUPS, comparatives vinculades, registre d'enviament, contracte, tasques i historial. |
| Rendiment | `?v=rendiment` | KPI reals del període, embut, objectius, resultats per servei i comparativa de comercials (només per a Direcció i Administració). |
| Automatitzacions | Configuració → Automatitzacions | Activar i desactivar regles, ajustar-ne els paràmetres i executar-les a mà (només admin). També mostra l'historial d'execucions. |

A més:
- La fitxa de client té una secció d'**Oportunitats**.
- La capçalera té una **campana d'avisos**.
- L'assistent de comparatives accepta `opportunity=` i hi queda vinculat.

## Model de dades (migració `009_crm_comercial.sql`)

Tots els canvis són additius. No s'esborra ni es reescriu cap taula ni cap dada existent.

**Taules noves:**
- `crm_leads`;
- `crm_opportunities`, que inclou:
  - `version`, per a la concurrència optimista;
  - `mwh`, una columna generada;
  - `position`;
  - les dates de proposta, guanyada i perduda;
- `crm_automation_rules`, `crm_automation_runs`, `crm_notifications` i `crm_targets`.

**Columnes noves:**
- a `crm_activities`: `lead_id`, `opportunity_id` i `outcome`;
- a `crm_tasks`: `lead_id`, `opportunity_id`, `kind`, `duration_min`, `source` i `rule_key`, aquesta última única per garantir la idempotència;
- a `comparisons`: `crm_opportunity_id`.

**Triggers:**
- Cada canvi d'etapa crea una activitat del tipus «Títol: A → B».
- La `version` només puja quan hi ha canvis reals.
- Només l'staff pot reassignar.
- Guanyar posa la probabilitat a 100 i perdre la posa a 0.
- Registrar una trucada, una reunió, un correu o un WhatsApp actualitza la darrera activitat i el primer contacte del lead.

**Auditoria:** `crm_audit` desa només els noms dels camps canviats, mai els valors.

**Reversió:** `009_crm_comercial_down.sql`. Primer restaura les polítiques de la 008 i després elimina les columnes i les taules de la 009. **Esborra les dades comercials**, així que abans cal fer-ne còpia.

## Permisos (RLS)

- **Comercial:** veu i edita només els seus leads i oportunitats, i les dels clients que té assignats. No pot reassignar. Al panell de rendiment només hi veu les seves dades.
- **Col·laborador:** igual, però limitat al que té com a col·laborador.
- **Admin i Direcció:** ho veuen tot, poden reassignar i fixar objectius. Configurar les automatitzacions és només per a l'admin.
- Totes les rutes de l'API fan servir el client de l'usuari amb RLS. El client de servei només s'utilitza al servidor per a les automatitzacions i el cron.

Hi ha 14 proves de RLS sobre PGlite (`tests/db/crm-comercial-rls.test.ts`) que comproven, entre altres coses, que un comercial no pot llegir ni modificar oportunitats d'un altre canviant-ne l'identificador.

## Automatitzacions

Les executen dos mecanismes:
- el cron diari de Vercel (`/api/sync/cron`, a les 05:00 UTC);
- de manera oportunista, quan s'obre la jornada, amb un màxim d'una execució cada 30 minuts.

Totes són idempotents: cada tasca o avís porta una `rule_key` única i, si es tornen a executar, no es duplica res.

| Regla | Per defecte | Acció |
|---|---|---|
| Proposta sense resposta | 3 dies | Tasca de seguiment al responsable |
| Venciment de contracte | 90, 60 i 30 dies | Avís i tasca de renovació |
| Lead sense contacte | 24 h | Avís al responsable (o a l'admin si no en té) |
| Oportunitat inactiva | 7 dies | Avís setmanal |
| Proposta acceptada (guanyada) | 2 dies | Tasca «Tramitar el contracte» |
| Preparar renovació | 90 dies abans | Tasca per a contractes nous |

Les automatitzacions **només creen tasques i avisos interns**. No envien mai correus ni WhatsApp a clients.

## Comunicacions

- Una activitat només consta com a **«enviat»** si el servidor SMTP ha confirmat l'enviament (correus enviats des de la comparativa).
- Els enviaments que es fan fora de la plataforma es desen com a **«registrat»**.
- Si només s'obre l'aplicació de correu o de WhatsApp, queda com a **«intent»**.

## Temps real i coherència entre usuaris

- El Kanban se subscriu a `postgres_changes` de `crm_opportunities`, que respecta la RLS. A més, es refresca cada 60 s.
- Si dos usuaris mouen la mateixa targeta, el segon rep un 409 («Algú altre ha modificat aquesta oportunitat») i la targeta torna a la seva posició.
- La migració afegeix la taula a la publicació `supabase_realtime` si existeix. Si no, cal activar-la a *Database → Replication*.

## API

- `GET /api/crm/sales?r=leads|lead|matches|opps|opp|jornada|agenda|kpis|notifications`
- `POST /api/crm/sales`, amb `entity` = `lead` | `opp` | `activity` | `task` | `convert` | `notifications` | `target`
- `GET/POST /api/crm/automations`: el GET és per a l'staff; el POST (actualitzar o executar) només per a l'admin.

## Desplegament

1. **Supabase → SQL Editor:** obre `supabase/migrations/009_crm_comercial.sql`, copia'n **tot el contingut** (no el nom del fitxer), enganxa'l i executa'l. Abans han d'estar aplicades la 007 i la 008.
2. Comprova a *Database → Replication* que `crm_opportunities` és a `supabase_realtime`.
3. **GitHub:** puja la branca `feature/crm-fase2-comercial`. Vercel en crearà una **Preview**. No l'integris a `main` fins que hagis fet el recorregut d'acceptació.
4. **Vercel:** no cal cap variable nova. El cron ja és a `vercel.json` i necessita `CRON_SECRET` i `SUPABASE_SERVICE_ROLE_KEY`, que ja existeixen.
5. Recorregut d'acceptació a la Preview (vegeu `INFORME_PROVES.md`):
   1. crear un lead;
   2. assignar-lo;
   3. crear-ne l'oportunitat;
   4. arrossegar-la;
   5. registrar una trucada;
   6. crear una tasca;
   7. comprovar l'avís;
   8. vincular una comparativa;
   9. marcar-la com a guanyada;
   10. crear el contracte;
   11. convertir el lead sense duplicar el client;
   12. entrar com a comercial i comprovar que no veu les oportunitats d'un altre.
