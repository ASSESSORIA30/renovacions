# Auditoria inicial de la plataforma · Fase 7 (01/11/2026)

Revisió del codi real de la branca `feature/crm-fase6-captacio` (commit `89b3615`) abans de construir la Fase 7. Es va comprovar què existeix i funciona al codi, a les migracions i a les proves. La documentació de fases anteriors no es va donar per bona sense verificar-la.

**Mètode:**
- lectura de les 13 migracions, de les 50 rutes d'API i dels serveis del servidor;
- `tsc`, ESLint i `npm audit`;
- execució de les 368 proves existents;
- aplicació de les migracions 001-013 sobre un **PostgreSQL 16 real**.

## 1. Funcionalitats implementades (verificades)

| Àrea | Estat | Verificació |
|---|---|---|
| Clients 360°: clients, contactes, subministraments, contractes, documents (bucket privat, versions), activitat, auditoria | Funciona | RLS a PGlite i PostgreSQL 16 i proves del servidor |
| Leads, oportunitats, Kanban comercial, agenda, objectius i automatitzacions idempotents | Funciona | `sales.test.ts`, `db/crm-comercial-rls` |
| Expedients, requisits documentals, plantilles, signatura (adaptador; manual sense credencials), activació, registre de comissió | Funciona | `contracting*.test.ts`, `db/crm-contractacio-rls` |
| Regles de comissió versionades, llibre immutable, liquidacions, conciliació, rendibilitat | Funciona | `finance*.test.ts`, `db/crm-economia-rls` |
| Motor d'oportunitats IA (mode regles sense clau) i Copilot amb eines autoritzades | Funciona | `intelligence*.test.ts`, `db/crm-ia-rls` |
| Landing, captació, lectura de factures, portal de col·laboradors, atribució, webhooks | Funciona; les integracions estan pendents de credencials | `capture*.test.ts`, `db/crm-captacio-rls` |
| Comparatives (catàleg, manual, Excel), SIPS, Power Optimizer i renovacions | Funcionen; SIPS i IA depenen de credencials | Proves existents |

## 2. Funcionalitats parcials

- **Incidències:** només hi havia l'estructura base de la Fase 1, sense gestor, prioritat urgent, escalat ni historial. *Completat a la Fase 7.*
- **Tasques:** hi ha dos sistemes.
  - `crm_tasks` es fa servir a les fases 1-6.
  - `tasks` és la taula antiga del mòdul de renovacions («Pla d'avui»).
  - El gestor global unifica `crm_tasks`. La taula antiga no s'ha migrat: funciona i migrar-la implicaria moure dades. *Pendent (vegeu 5).*
- **Renovacions:** el Kanban treballa sobre la taula antiga `contracts`, que s'alimenta dels contractes del CRM (`publishToRenewals`) i, opcionalment, de l'Excel. El CRM ja **no necessita l'Excel**, però hi ha dos models de contracte connectats per un pont. *Documentat; no s'ha reescrit, perquè funciona.*
- **Automatitzacions:**
  - Només s'avisava a 90/60/30 dies.
  - Els contractes antics no generaven cap tasca de renovació.
  - No hi havia escalats de tasques vençudes ni d'incidències.
  - No hi havia avisos d'errors d'integració.

  *Corregit.*
- **Cercador global:** només cercava clients, CUPS i codi d'expedient, i sense índexs. *Ampliat.*
- **MFA:** no existia. *Preparat i activable per Direcció (vegeu `CRM_FASE7.md`).*

## 3. Errors i problemes de seguretat detectats

| # | Problema | Gravetat | Acció correctora | Prova de regressió |
|---|---|---|---|---|
| 1 | Un col·laborador podia obrir la interfície interna (`/`) i cridar les APIs internes. Les dades estaven protegides per la RLS, però les pantalles i els endpoints eren accessibles. | Alta | Redirecció al middleware i a la interfície. `requireInternal()` a les 42 rutes internes (38 existents i 4 de noves). | `consolidacio.test.ts` (P14), navegador |
| 2 | Cap administrativa i Administrativa veien **totes** les dades econòmiques: 23 polítiques, 2 funcions i el servidor usaven `is_staff()`. Contradiu l'organització definitiva. | Alta | `fin_staff()` + permís «economia» que Direcció autoritza persona a persona. | `db/crm-consolidacio-rls`, `npm run test:compat014` |
| 3 | `fin_can_manage_rules()` deixava la Cap administrativa gestionar regles de comissió. | Mitjana | Ara cal el permís explícit «comissions: edició». | `db/crm-consolidacio-rls` |
| 4 | Rendiment comercial: qualsevol membre de l'equip veia les comissions de tot l'equip. | Mitjana | Les comissions s'amaguen sense permís econòmic (el comercial continua veient les seves). | `consolidacio.test.ts` |
| 5 | Els avisos econòmics anaven sempre a la Cap administrativa. | Mitjana | Només a Direcció i a les persones autoritzades. | `consolidacio.test.ts` |
| 6 | Els canvis de rol i les baixes d'usuaris fets amb la clau de servei no quedaven auditats, i les baixes no tenien confirmació al servidor. | Mitjana | `sec_audit` (només afegir), auditoria explícita al servidor i confirmació obligatòria. | `db/crm-consolidacio-rls` |
| 7 | Col·laboradors: veien les tasques internes i les incidències dels clients que havien aportat. | Mitjana | Només veuen les seves sol·licituds externes i les incidències que han obert. | `db/crm-consolidacio-rls` |
| 8 | El rol `admin` es mostrava com a «Administrador», no com a Direcció. | Baixa | Es mostra «Direcció» (codi DIRECCIO). | Navegador |
| 9 | Els PDF nous no dibuixaven el punt volat (`l·l`) amb les fonts estàndard de jsPDF. | Baixa | S'escriu `l.l` als informes. *El PDF de liquidació de la Fase 4 té el mateix comportament: pendent.* | Revisió visual |

**Dependències (`npm audit --omit=dev`):**

| Paquet | Problema | Situació | Decisió |
|---|---|---|---|
| `xlsx` | Alta (contaminació de prototip i ReDoS) | Sense correcció a npm. Només es fa servir al navegador per llegir fitxers que tria l'usuari. | Substituir per `exceljs`, que ja hi és (pendent). |
| `zod` < 4.6.6 | Alta (consum de memòria amb col·leccions enormes) | Els esquemes tenen límits `.max()`. | Actualitzar a zod 4 (canvi major; pendent). |
| `postcss` | Alta | Arriba a través de `next`; només afecta el moment del build. | Actualitzar a Next 16 (canvi major; pendent). |

Cap d'aquests paquets s'ha actualitzat en aquesta fase, per no introduir canvis de versió major sense proves de regressió completes.

## 4. Duplicacions

- **Contractes:** dos models, `contracts` (renovacions) i `crm_contracts` (CRM), connectats per `publishToRenewals`.
- **Tasques:** `tasks` (renovacions) i `crm_tasks` (CRM).
- **Pantalles de dia:**
  - «Pla d'avui» (renovacions);
  - «La meva jornada» comercial, ara «Agenda comercial»;
  - «La meva jornada» de l'administrativa, que és nova.

  Al menú queden separades per rol i amb noms diferents.
- **Biblioteques:**
  - gràfics: `recharts` (CRM) i `echarts` (mòdul energètic);
  - Excel: tres biblioteques (`xlsx`, `exceljs`, `write-excel-file`).
- **Registres d'auditoria:**
  - `audit_log` (renovacions);
  - `crm_audit_events` (camps de client);
  - `fin_audit` (economia);
  - `cap_audit` (captació);
  - `sec_audit` (seguretat, nou).

  Tenen abasts diferents i no es fusionen, per no perdre historial.

## 5. Rendiment

- **Abans de la Fase 7:**
  - cerques `ilike '%…%'` sense índexs trigram;
  - el mòdul de renovacions carrega al navegador totes les files de `contracts` (en pàgines de 1.000) i 5.000 activitats.
- **Fase 7:**
  - índexs `pg_trgm` a clients (cerca i adreça), subministraments (CUPS i adreça), leads i oportunitats;
  - índexs de dates, estats i responsables;
  - els panells llegeixen 12 mesos i en pàgines de 1.000 files, amb un màxim de 20.000.
- **Mesures reals:** vegeu `CRM_FASE7.md · Rendiment`. No s'ha mesurat contra el Supabase de producció.

## 6. Integracions pendents (no simulades)

| Integració | Per què està pendent |
|---|---|
| SMTP | Correus i informes automàtics |
| Anthropic | Copilot i lectura IA de factures |
| SIPS | Calen credencials |
| Proveïdor de signatura electrònica | Cal triar-lo i configurar-lo |
| Google Ads, Meta Lead Ads i WhatsApp Business | Calen credencials |
| `CRON_SECRET` i crons de Vercel | Cal definir el secret i activar els crons |
| Còpia del bucket de documents (Storage) | Vegeu `CRM_FASE7.md` |

Totes surten com a «pendent» al Centre d'alertes, amb el motiu.

## 7. Dades locals no sincronitzades

`localRepo` (IndexedDB) només s'activa si **no** hi ha Supabase configurat (desenvolupament local). En producció totes les dades són a Supabase. La importació d'Excel és opcional i no és necessària per treballar.
