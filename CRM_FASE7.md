# CRM Fase 7 · Consolidació, Direcció compartida, supervisió operativa i portal de col·laboradors

Branca: `feature/crm-fase7-consolidacio` (no s'ha fusionat a `main` ni s'ha desplegat a producció).
Migració: `supabase/migrations/014_consolidacio.sql`, amb el retorn `014_consolidacio_down.sql`.
Configuració inicial de l'equip: `supabase/seed/fase7_equip.sql`.
Auditoria prèvia: `AUDITORIA_FASE7.md`.

## 1. Rols i permisos

Hi ha cinc rols. **Cap permís depèn del nom d'una persona.** Els codis interns no s'han reanomenat, perquè les migracions 001-013 en depenen:

| Rol definitiu | Codi intern | Qui (s'assigna per correu a `fase7_equip.sql`) |
|---|---|---|
| DIRECCIO | `admin` | Joan i Olivié: mateixos drets, cap jerarquia entre ells |
| CAP_ADMINISTRATIVA | `cap_administrativa` | Iberth |
| ADMINISTRATIVA | `administrativa` | Pendent de designar. S'afegeix des de Configuració → Usuaris. |
| COMERCIAL | `comercial` | Patricia. El rol es pot reutilitzar per a noves incorporacions. |
| COLLABORADOR | `colaborador` | Només el portal `/collaboradors` |

**Model de permisos:**
- `role_permissions` (per rol) i `user_permissions` (excepcions per persona) indiquen, per a cada mòdul, si hi ha permís de **lectura**, **edició** i **aprovació**.
- `has_perm(mòdul, acció)` és la funció que aplica la RLS i la que consulta el servidor: no poden discrepar.
- Direcció té sempre tots els permisos i no es pot restringir, per evitar quedar sense accés.
- Les dades econòmiques restringides (marges, comissions globals, liquidacions de tercers i conciliació) depenen del mòdul **economia**:
  - per defecte només les veu Direcció;
  - Direcció les pot autoritzar a una persona concreta, per exemple Iberth, des de Configuració → Usuaris i permisos → Persones;
  - la lectura no dona dret a modificar ni a aprovar.
- **Protecció al servidor:**
  - `requireInternal()` impedeix que els col·laboradors facin servir cap API interna;
  - `requirePerm()` comprova el mòdul;
  - `finStaff()` controla les dades econòmiques.
  - El menú només amaga opcions: la decisió real la prenen el servidor i la RLS.

**Valors per defecte** (taula `role_permissions`, editable des de la interfície):

| Rol | Pot fer | No pot fer |
|---|---|---|
| Cap administrativa | Supervisar l'operativa; assignar i supervisar tasques; escalar i tancar incidències; aprovar a contractació; veure la productivitat de l'equip administratiu; revisar la qualitat de dades | Veure comissions, economia ni configuració, si no l'autoritzen |
| Administrativa | La seva jornada, clients, contractació, renovacions, tasques i incidències | Veure comissions ni economia |
| Comercial | El seu panell, cartera, leads i oportunitats, renovacions, comparatives i informes propis; llegir **les seves** comissions | Veure economia global |
| Col·laborador | El portal; les seves sol·licituds externes, comissions i informe | Res del CRM intern |

## 2. Centre de Control de Direcció

- **Indicadors:** comercials, administratius i econòmics. Els econòmics reutilitzen el càlcul del Panell econòmic de la Fase 4, de manera que la xifra és la mateixa a les dues pantalles.
- **Filtres:** període (avui, setmana, mes, trimestre, any, personalitzat), comercial, comercialitzadora, producte i responsable.
- **Personalització:** es poden afegir i treure widgets, arrossegar-los, canviar-ne la mida (1-4 columnes), desar filtres i restaurar un panell predeterminat.
- Les preferències es guarden a `user_dashboard_prefs` **per identificador d'usuari**. El panell de Joan no altera el d'Olivié.
- **Panells inicials** (plantilles assignades per identificador d'usuari a `fase7_equip.sql`):
  - **Direcció · comercial i econòmic** (Olivié): contractes del dia, la setmana i el mes, MWh, evolució comercial, activitat de l'equip, col·laboradors, comissions meritades i cobrades, marge, rendibilitat, objectius i IA;
  - **Direcció · operativa i administració** (Joan): tramitació, expedients pendents, bloquejats, renovacions, incidències, tasques vençudes, alertes, càrrega, activitat, renovacions i qualitat de dades.

### Definicions dels indicadors

Font única al codi: `src/core/control.ts · KPI_DEFS`. També es poden consultar des del botó «Definicions».

| Indicador | Àrea | Definició | Font |
|---|---|---|---|
| Contractes del dia | Comercial | Contractes del CRM (crm_contracts) amb data de signatura avui; si no hi ha data de signatura, la data d'alta. No compta esborranys ni anul·lats. | `crm_contracts` |
| Contractes de la setmana | Comercial | Igual que «del dia», de dilluns a diumenge de la setmana actual. | `crm_contracts` |
| Contractes del mes | Comercial | Igual que «del dia», del mes natural actual. | `crm_contracts` |
| Contractes del període | Comercial | Contractes signats (o donats d'alta) dins del període seleccionat, sense esborranys ni anul·lats. | `crm_contracts` |
| Contractes activats | Comercial | Expedients activats dins del període (data d'activació confirmada; si no n'hi ha, la del canvi d'estat). | `crm_expedients.activated_at` |
| Contractes anul·lats | Comercial | Contractes en estat «anul·lat» actualitzats dins del període i expedients «rebutjats» dins del període. | `crm_contracts, crm_expedients` |
| MWh contractats | Comercial | Suma del consum anual (kWh ÷ 1.000) dels subministraments dels contractes del període. Si el contracte no té subministrament amb consum, no suma (no s'estima). | `crm_contracts → crm_supplies.annual_kwh` |
| Leads nous | Comercial | Leads creats dins del període (qualsevol canal). | `crm_leads` |
| Oportunitats obertes | Comercial | Oportunitats en una etapa oberta ara mateix (no guanyades ni perdudes). | `crm_opportunities` |
| Propostes enviades | Comercial | Oportunitats amb data d'enviament de proposta dins del període. | `crm_opportunities.proposal_sent_at` |
| Taxa de conversió | Comercial | Oportunitats guanyades ÷ (guanyades + perdudes) tancades dins del període. Sense tancaments, no es calcula. | `crm_opportunities` |
| Oportunitats detectades per IA | Comercial | Oportunitats del motor d'IA (Fase 5) pendents de revisar. | `ai_opportunities` |
| Expedients pendents | Administratiu | Expedients no activats ni rebutjats (pendents de documentació, signatura, enviament o en tramitació). | `crm_expedients` |
| En tramitació | Administratiu | Expedients en estat enviat o en tramitació a la comercialitzadora. | `crm_expedients` |
| Documentació incompleta | Administratiu | Expedients en estat «pendent de documentació». | `crm_expedients` |
| Contractes bloquejats | Administratiu | Expedients en «incidència» o sense cap moviment des de fa més de 7 dies (sense comptar activats ni rebutjats). | `crm_expedients` |
| Renovacions urgents | Administratiu | Contractes actius o pendents de renovar que vencen en els propers 30 dies. | `crm_contracts.end_date` |
| Renovacions (120 dies) | Administratiu | Contractes actius o pendents de renovar que vencen en els propers 120 dies. | `crm_contracts.end_date` |
| Incidències obertes | Administratiu | Incidències no resoltes ni tancades. | `crm_incidents` |
| Incidències urgents | Administratiu | Incidències obertes amb prioritat urgent o alta. | `crm_incidents` |
| Tasques pendents | Administratiu | Tasques pendents, en curs o bloquejades. | `crm_tasks` |
| Tasques vençudes | Administratiu | Tasques obertes amb data límit anterior a ara. | `crm_tasks` |
| Tasques bloquejades | Administratiu | Tasques en estat «bloquejada». | `crm_tasks` |
| Contractes introduïts avui | Administratiu | Contractes donats d'alta avui al CRM (data d'alta, no de signatura). | `crm_contracts.created_at` |
| Comissions previstes | Econòmic | Comissió calculada pel motor de regles (capa proveïdor) dels contractes iniciats al període. És una previsió, no un import confirmat. | `fin_calculations` |
| Comissions meritades | Econòmic | Moviments de meritació, regularització i anul·lació (capa proveïdor) del període. | `fin_ledger` |
| Comissions confirmades | Econòmic | Imports confirmats per la comercialitzadora (conciliació) dins del període. | `fin_ledger (confirmacio)` |
| Comissions cobrades | Econòmic | Cobraments reals registrats i conciliats dins del període. | `fin_ledger (cobrament)` |
| Pendent de cobrar | Econòmic | Acumulat meritat o confirmat que encara no s'ha cobrat (no només el període). | `fin_ledger` |
| Liquidacions pendents | Econòmic | Liquidacions en esborrany, revisió o aprovades sense pagar del tot. | `fin_settlements` |
| Pagaments efectuats | Econòmic | Pagaments a comercials i col·laboradors registrats dins del període. | `fin_payments` |
| Marge previst | Econòmic | Comissions previstes − comissions a pagar previstes − costos del període. | `Fase 4 · dashboard` |
| Marge realitzat | Econòmic | Cobrat − comissions a pagar meritades − costos del període. | `Fase 4 · dashboard` |
| Rendibilitat | Econòmic | Marge realitzat ÷ cobrat del període. Sense cobraments, no es calcula. | `Fase 4 · dashboard` |
| Problemes de qualitat de dades | Qualitat | Nombre de problemes detectats pel revisor de qualitat (pendents de revisió humana). | `detectors de qualitat` |


## 3. Panells per rol

- **Supervisió administrativa** (Cap administrativa):
  - contractes introduïts avui, pendents de revisar, expedients incomplets, bloquejats, tasques pendents i vençudes, renovacions urgents i incidències;
  - treball i càrrega de cada persona i activitat recent;
  - pot assignar tasques des del mateix panell. Les comissions no apareixen si no hi ha autorització.
- **La meva jornada** (administrativa): tasques d'avui, vençudes i pendents; expedients i contractes per tramitar; renovacions; incidències; alertes; activitat recent. Es pot marcar una tasca com a feta des del mateix panell.
- **Panell comercial** (comercial):
  - leads, clients, oportunitats, propostes pendents, trucades d'avui, tasques, contractes, MWh i objectius;
  - **comissions pròpies** (càlcul de la Fase 4) i resultats mensuals;
  - no mostra marges globals ni comissions d'altres comercials.

Cada rol entra directament al seu panell.

## 4. Gestor global de tasques i d'incidències

**Tasques** (`crm_tasks`, ampliada sense perdre dades):

| Camp | Valors o contingut |
|---|---|
| Estats | pendent, en curs, bloquejada (cal indicar el motiu), finalitzada, cancel·lada |
| Prioritat | baixa, normal, alta, urgent |
| Àrea | administrativa, comercial, direcció, externa |
| Vincles | client, contracte, expedient, lead, oportunitat, incidència, liquidació |
| Historial | `crm_task_events`, escrit pels triggers: creació, estat, reassignació, prioritat, venciment, comentari, escalat |

- Només Direcció i la Cap administrativa poden reassignar tasques d'altres persones. Ho impedeix el trigger `crm_task_guard`, encara que es manipuli la petició.
- Direcció supervisa totes les tasques; la Cap administrativa, les de l'àrea administrativa.
- Els col·laboradors només veuen les seves **sol·licituds externes**.

**Incidències:**
- prioritat urgent, termini i responsable;
- escalat (nivell 1: Cap administrativa; nivell 2: Direcció);
- resolució obligatòria per tancar-les (només qui té permís d'aprovació);
- historial a `crm_incident_events`.

## 5. Centre d'alertes i automatitzacions

Una sola pantalla mostra:
- les regles (activar o desactivar) i l'última execució;
- l'historial, els errors (7 dies) i les tasques i alertes generades;
- els reintents de captació i de lectura de factures, els webhooks i les sincronitzacions;
- els informes enviats;
- l'**estat real de cada integració**, sense simular cap connexió.

**Automatitzacions consolidades** (totes idempotents: clau única per avís i nivell):

| Situació | Comportament |
|---|---|
| Renovacions | A 120, 90, 60 i 30 dies. Una sola tasca de renovació per contracte i data de venciment. |
| Documentació incompleta | Avís (expedients) |
| Expedients sense moviment | Avís |
| Leads sense contacte | Avís |
| Propostes sense resposta | Avís |
| Tasques vençudes | Avís al responsable, després a la Cap administrativa i després a Direcció |
| Incidències urgents | Avís al responsable i a la Cap; si passa el termini, a Direcció |
| Liquidacions pendents | Avís |
| Errors de lectura de factures, d'automatització, de sincronització i de webhooks | Un avís per origen i dia |

- Els avisos econòmics només arriben a Direcció i a les persones autoritzades.
- No s'envia cap comunicació externa nova.

## 6. Qualitat i integritat de dades

**Es detecten:**
- clients duplicats (NIF, telèfon o correu);
- CUPS repetits (també a clients diferents, per un possible canvi de titular);
- contractes sense titular i dates incoherents;
- expedients sense responsable i documents sense vinculació;
- comissions duplicades i liquidacions incoherents (només amb accés econòmic);
- oportunitats abandonades (més de 30 dies sense activitat) i tasques sense responsable.

**El sistema no fusiona ni esborra res.** Cada cas el revisa una persona («corregit», «correcte» o «ignora», amb un motiu), i la revisió queda a `dq_reviews`.

## 7. Cercador global

**Cerca per:**
- client, NIF/CIF, telèfon i correu;
- adreça (de clients i de subministraments);
- CUPS;
- contracte (per CUPS o per la referència de l'expedient);
- expedient, lead, oportunitat;
- col·laborador (només amb el permís «colaboradors»).

Els resultats es paginen per tipus (`limit`, amb un indicador de «n'hi ha més») i respecten la RLS de cada usuari. S'hi han afegit índexs trigram.

## 8. Supervisió, productivitat i informes

**Productivitat:** només amb l'activitat registrada al CRM. Els indicadors són:
- contractes introduïts i activats;
- expedients tramitats;
- tasques finalitzades i pendents;
- renovacions;
- incidències resoltes;
- leads treballats i propostes enviades;
- temps de gestió, que **només es mostra si hi ha 3 o més tasques amb inici i final registrats**.

Abast per rol:

| Rol | Què veu |
|---|---|
| Direcció | Tothom |
| Cap administrativa | L'equip administratiu |
| Comercial | Només ella mateixa |
| Col·laborador | Les seves operacions, al portal |

**No hi ha cap monitoratge ocult**: ni captures de pantalla, ni teclat, ni temps de connexió.

**Informes PDF** (diari, setmanal i mensual) dins de l'abast de qui els genera:
- Direcció: global, amb comissions, liquidacions, rendibilitat i cartera;
- Cap administrativa: informe administratiu;
- Comercial: només els seus resultats;
- Col·laborador: les seves operacions.

**Enviament automàtic** (`/api/reports/cron`, a les 06:00 UTC):
- només a destinataris interns configurats per Direcció;
- cada informe es genera amb els permisos de la persona que el rep;
- sense SMTP queda «pendent_smtp»: mai es marca com a enviat sense confirmació;
- és idempotent per destinatari i període (`report_runs`).

## 9. Portal de col·laboradors (`/collaboradors`)

És el mateix portal de la Fase 6, consolidat. No s'ha creat un segon portal: `/portal` redirigeix a `/collaboradors`. Té navegació i estil propis, separats del CRM.

**Indicadors:**
- leads aportats, clients captats;
- contractes en estudi, en tramitació, activats i rebutjats;
- comissions **estimades** (previsió), **meritades** i **cobrades**, i liquidacions pendents;
- historial d'operacions.

**Funcions:**
- aportar un client: tipus, llum o gas, i altres serveis (fibra i telefonia, assegurances, alarmes), factura i observacions;
- consultar els leads i l'estat de tramitació;
- consultar les comissions i descarregar les liquidacions pròpies (PDF);
- consultar les factures aportades;
- editar les dades de contacte;
- obtenir l'enllaç i el QR de captació;
- **contactar amb Assessoria 3.0**: crea una sol·licitud externa per a la Cap administrativa i el col·laborador en veu l'estat;
- descarregar un PDF de les seves operacions.

**Seguretat:**
- La RLS impedeix veure clients d'altres, documents d'altres, tasques internes, economia, auditoria o permisos.
- El middleware i la interfície envien el col·laborador fora del CRM intern.
- Totes les APIs internes el rebutgen, encara que manipuli la petició.
- L'atribució segueix les regles de la Fase 6: una sola atribució vigent, i Direcció decideix amb auditoria.

## 10. Seguretat

- **RLS:**
  - a totes les taules noves;
  - les polítiques econòmiques s'han reescrit amb `fin_staff()`;
  - els col·laboradors queden restringits a tasques i incidències.
- **Auditoria `sec_audit`** (només afegir; ni la clau de servei la pot modificar). Registra:
  - canvis de permisos i de rol;
  - altes, baixes, suspensions i contrasenyes d'usuaris;
  - esborrats de dades de negoci;
  - aprovacions i pagaments de liquidacions;
  - la política MFA i els destinataris d'informes.
- **MFA (TOTP de Supabase Auth, nivell aal2):**
  1. Cada persona configura el seu segon factor a Configuració → Usuaris i permisos → Seguretat.
  2. Direcció activa l'obligació per rols (per defecte, Direcció i Cap administrativa). Només la pot activar si ella mateixa ja ha verificat el segon factor.
  3. A partir d'aquí, el servidor rebutja les peticions internes d'aquests rols si no tenen el segon factor verificat.

  Comprova que el projecte de Supabase té activat «MFA → TOTP», que ho està per defecte.
- **Sessions:**
  - Direcció pot suspendre l'accés d'una persona sense esborrar res (`ban` de Supabase Auth);
  - eliminar un usuari requereix confirmació explícita i queda auditat.
- **Secrets:** no s'ha afegit cap clau nova al navegador. Les variables noves són només del servidor.
- **Retenció** (`sec_settings.retention`, valors de referència):
  - auditoria: 6 anys;
  - leads sense contracte: 730 dies (s'anonimitzen amb `cap_anonymize_expired` de la Fase 6);
  - dades de la IA: 365 dies (`ai_purge_expired` de la Fase 5).

### Còpies de seguretat verificables

| Script | Què fa |
|---|---|
| `scripts/backup.sh` | `pg_dump` dels esquemes `public` i `auth`, recompte de files de cada taula i empremta SHA-256 |
| `scripts/restore-verify.sh` | Restaura en una base de dades **buida de proves** (es nega a fer-ho a producció o a una base de dades amb taules) i compara el recompte de files taula per taula |

S'han provat de punta a punta sobre PostgreSQL 16 (108 taules). Resultat: «Restauració verificada».

**Documents (Storage):**
- La còpia es fa des del tauler de Supabase (backups del projecte; PITR al pla Pro) o bé amb `supabase storage cp -r ss:///crm-documents ./backups/crm-documents` (CLI de Supabase).
- Recomanació: còpia diària automàtica de Supabase i una còpia setmanal fora de Supabase amb `backup.sh`.

**Restauració a producció** (el procediment no és automàtic):
1. Atura l'ús del CRM.
2. Restaura des del tauler (Database → Backups o PITR).
3. Comprova el recompte de files amb el `.counts` de la còpia.
4. Torna a obrir.

## 11. Rendiment (mesurat)

Condicions: Node 22, 2 vCPU Intel Xeon a 2,1 GHz, PostgreSQL 16.15 local. **No s'ha mesurat contra el Supabase de producció.**

**Càlculs en memòria:**

| Càlcul | Volum de dades | Temps |
|---|---|---|
| Indicadors i sèrie de 12 mesos | 20.000 contractes, 6.000 expedients, 10.000 tasques, 8.000 leads, 8.000 oportunitats, 2.000 incidències | **58 ms** |
| Productivitat | El mateix volum | **15 ms** |
| Revisió de qualitat | 8.000 clients i 12.000 subministraments | **75 ms** |

**Cerca de clients** (`ilike '%1234 farm%'` sobre 30.000 clients):

| Mètode | Temps |
|---|---|
| Recorregut seqüencial (el que tria el planificador amb aquest volum) | **18,6 ms** |
| Índex trigram | **3,9 ms** |

El planificador passarà a fer servir l'índex quan el volum creixi.

**Disseny:**
- els panells llegeixen 12 mesos, en pàgines de 1.000 files i amb un màxim de 20.000;
- les vistes noves es carreguen de manera diferida (`lazyView`);
- les tasques i les incidències es paginen al servidor (50 per pàgina).

## 12. Desplegament a Vercel (Preview; producció només amb autorització)

1. **Supabase** (SQL Editor), en aquest ordre:
   1. `014_consolidacio.sql` (requereix les migracions 001-013). Pega'n el **contingut**, no el nom del fitxer.
   2. `supabase/seed/fase7_equip.sql`, després de revisar-ne els correus.
2. **Vercel**:
   - desplega la branca `feature/crm-fase7-consolidacio` com a **Preview**;
   - `vercel.json` hi afegeix el cron `/api/reports/cron`;
   - cal `CRON_SECRET`, que ja existeix si es fan servir els crons de les fases anteriors.
3. **Comprovacions a la Preview:**
   - entrar amb cada rol;
   - Configuració → Usuaris i permisos;
   - Centre d'alertes (l'estat de les integracions).
4. **MFA:**
   1. Cada directiu configura el seu segon factor.
   2. Després, Direcció activa l'obligació.
5. **Desfer**, només si cal: `014_consolidacio_down.sql`. Conserva l'auditoria i les columnes noves.

No hi ha variables d'entorn noves obligatòries.

## 13. Configuracions externes pendents

| Configuració | Per a què serveix |
|---|---|
| SMTP | Correus i informes automàtics |
| `ANTHROPIC_API_KEY` | Copilot i lectura IA de factures |
| Credencials SIPS | Consultes al SIPS |
| Proveïdor de signatura electrònica | Signatura electrònica de contractes |
| Google Ads, Meta Lead Ads i WhatsApp Business | Captació i comunicacions per aquests canals |
| `CRON_SECRET` | Execució dels crons de Vercel |
| Còpia del bucket de documents | Còpies de seguretat completes |
| Activació de l'MFA | Decisió de Direcció |
| Correus definitius de Joan, Iberth i Patricia | Revisar-los a `fase7_equip.sql` |
| Alta de l'administrativa | Quan es designi |
