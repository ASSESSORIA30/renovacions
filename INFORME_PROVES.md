# Informe de proves · fusió + Comparatives IA + CRM Fase 1 (31/10/2026)

Entorn: Node 22.23, npm 10.9, Linux. Execució al contenidor de treball, sense credencials reals (ni Supabase, ni portal SIPS, ni Google).

## Comprovacions automàtiques

| Ordre | Resultat |
|---|---|
| `npm install` / `npm ci` | OK |
| `npx tsc --noEmit` | **0 errors** |
| `npm run test` (vitest) | **141/141 tests correctes** (10 fitxers) |
| `npm run lint` (ESLint, configurat en aquesta fusió) | **0 errors**, 4 avisos (3 del codi original de Renovacions) |
| `npm run build` | **Compila correctament** (incloses les rutes de Comparatives IA); pàgina inicial 453 kB (abans 434 kB; el mòdul energètic es carrega a part) |

Tests:
- `tests/core.test.ts` (18, Renovacions, sense canvis): importador, prioritat, comparativa. **Regressió OK.**
- `tests/energy/domain.test.ts` (19, cups2): importació real de 97 columnes, normativa 2026, optimitzador vs. força bruta, reactiva, comparador, alertes, PDF. El test «exportació a dist/» de cups2 s'ha **substituït** (no eliminat) per un d'equivalent: la plataforma ja no és una exportació estàtica perquè necessita servidor.
- `tests/energy/sips.test.ts` (14): mapa de 97 camps, criteris Serenity, sessió amb CSRF i cookies, renovació de sessió, credencials incorrectes, **sense credencials → 503 sense contactar el portal**, **CUPS de 20 caràcters en minúscules**, **CUPS de 22 amb coincidència exacta**, conversió raw ↔ files.
- Gas (6 tests nous): filtre llum/gas/totes per adreça, CUPS sense filtre de tipus, peatges RL.1–RL.11, importació d'un punt de gas, `energy_type` a `sips_cache`, disponibilitat sense potències i cap alerta elèctrica falsa.
- `tests/fusion.test.ts` (16, nous): normalització de CUPS, model `sips_cache` (clau de 20, P1–P6, mensuals, **zero ≠ absent**, disponibilitat), TTL, font del consum a les targetes, rutes internes, mecanisme d'ajust al càlcul d'ofertes i regressió de la comparativa.

- `tests/comparator.test.ts` (21) i `tests/comparator-flow.test.ts` (Comparatives IA): arrodoniment per línia i suma exacta, normalització €/kW·dia, preus amb impostos inclosos, impost elèctric amb mínim, IVA/IGIC/IPSI, SAS, descomptes, elegibilitat i vigència, mode B sense cost actual ni estalvi, rànquing sense comissió, importador (mapatge, números «0,145 €/kWh», duplicats, sempre esborrany), extracció de text de factura, snapshot i PDF amb els mateixos imports que la pantalla.
- Migració 006 validada amb PGlite: creació, reexecució idempotent, immutabilitat de versions usades i de comparatives emeses, i rollback net amb `006_comparatives_ia_down.sql`.

### CRM Fase 1 · Clients 360°
- `tests/db/crm-rls.test.ts`: aplica les migracions 001–008 sobre **PostgreSQL real (PGlite)**, dues vegades (idempotència), i comprova més de 50 regles amb cinc usuaris (Direcció, Administració, dos comercials i un col·laborador): un comercial crea un client propi i no en pot crear per a un altre; un altre comercial no veu ni modifica el client, els seus CUPS ni els documents (ni canviant l'identificador); Administració ho veu tot, inclosos documents sensibles; compartir dona accés i edició; el col·laborador veu però no edita, no veu DNI ni bancaris ni comissions i pot afegir notes i incidències; ningú no-staff pot reassignar-se clients; NIF/CIF i CUPS duplicats es rebutgen; contractes tancats no es reescriuen; documents amb conservació obligatòria no s'eliminen; auditoria només amb noms de camps; la vista de llistat respecta la RLS; comparatives vinculades al client visibles a qui el veu; reversió neta i reaplicació.
- `tests/crm.test.ts` (15): NIF/NIE/CIF amb dígit de control, telèfons, CUPS de 20/22, província per CP, esquemes de client/CUPS/contracte/activitat (un usuari no pot marcar un correu com a «enviat»), cerca segura, tipus de fitxer, contingut real (PDF, JPG, PNG, WebP, DOCX i XLSX reals; executable amb extensió .pdf i Excel reanomenat a .docx rebutjats), noms de fitxer segurs, conservació, i importació de la cartera (agrupació per NIF, idempotència, contractes vençuts, NIF no vàlids conservats).

## Proves funcionals al navegador (Playwright, compilació de producció en mode local)

Dades **sintètiques** només al navegador de prova: 8 contractes i les 42 fitxes de demostració de cups2.

| Prova | Resultat |
|---|---|
| Dashboard executiu (KPI, venciments a 7/15/30/60/90 dies, MWh, evolució, activitat) | OK |
| Kanban: targetes amb MWh, font (CRM/Manual/SIPS), estat SIPS, botons «Analitzar CUPS» i «Preparar oferta» | OK |
| Kanban → «Analitzar CUPS» → fitxa energètica completa (CUPS de 20 caràcters → fitxa de 22) | OK |
| Pestanyes de la fitxa (Radiografia, Power Optimizer, Reactiva, Energy Market, Alertes, Oportunitat, Fitxa tècnica) | OK |
| «Tornar a <client>» reobre el contracte a la pestanya Energia | OK |
| «Prepara l'oferta» obre el generador amb les dades del contracte | OK |
| Anàlisi energètica, Radar, Power Optimizer, Alertes, Energy Market i Configuració energètica | OK |
| Mode fosc (inclosos els gràfics ECharts) i mòbil | OK |
| Fitxa d'un punt de **gas** (consum anual i mensual; sense Power Optimizer, reactiva ni Energy Market) i selector Llum/Gas al buscador | OK |
| Comparatives IA: assistent de 5 passos (origen → validació → selecció → resultats a 4 columnes → lliurament), mode manual | OK |
| Total verificat a mà: contracte actual 1.146,55 € = 590,00 + 302,22 + 45,62 + 9,72 + 198,99 | OK |
| PDF resum (1 pàgina) i detallat (6 pàgines) amb els mateixos imports que la pantalla, sense comissions | OK |
| Catàleg de tarifes, importador (vista prèvia i simulació), comparativa massiva amb exportació Excel | OK |
| **CRM** (API i Supabase simulats al navegador de prova): alta de client en 3 blocs amb validació (telèfon no vàlid detectat, província pel CP), fitxa, 2 contactes, 3 CUPS (llum i gas), contracte (data de renovació obligatòria si és actiu), 2 documents pujats amb progrés i classificats automàticament (factura / contracte signat amb conservació), vista prèvia, trucada i tasca, recàrrega de la pàgina, llistat en taula i targetes, cercador global per CUPS, accés denegat («No pots veure aquest client»), comparativa oberta des del client amb el CUPS pre-omplert | OK |
| Regressió: Dashboard, Renovacions, Pla d'avui, Calendari, Cartera, Ofertes, SIPS, Anàlisi, Comparatives, Catàleg, Massives, Estadístiques, Plantilles, Configuració | OK, sense errors |
| Errors de consola | **Cap** |
| APIs sense Supabase configurat | 503 amb missatge entenedor |

## No verificat en aquest entorn (cal fer-ho a una Preview de Vercel)

Requereixen credencials reals, que no són disponibles al contenidor:
- inici de sessió amb usuaris reals, permisos per rol i RLS;
- sincronització de Google Drive i canvis d'estat persistits;
- consulta real al portal EAS: CUPS amb/sense sufix, cerca per carrer amb majúscules/minúscules i errors del portal (el comportament està cobert amb un portal simulat);
- persistència a `sips_cache`, `energy_inputs` i `sips_audit` (cal executar les migracions 004 i 005);
- execució del cron de Vercel;
- generació i descàrrega del PDF amb Supabase Storage.
- CRM Fase 1 amb Supabase real: migració 008, bucket `crm-documents`, pujada amb URL signada i comprovació de contingut al servidor, descàrregues signades, publicació de contractes a Renovacions, importació de la cartera amb dades reals, i el recorregut d'acceptació amb usuaris reals de diferents rols i sessions (tancar i tornar a entrar). La lògica de permisos s'ha verificat amb PostgreSQL (PGlite); la interfície, amb l'API simulada.
- Comparatives IA: migració 006 a Supabase real, buckets `invoices`/`proposals`, extracció de factures amb IA (`INVOICE_AI_ENABLED`), text de recomanació amb IA, enviament SMTP real, connectors de tarifes (cap API autoritzada configurada) i portal `/p/<token>` amb dades reals.

La llista de comprovació per a la Preview és a `README.md` → «Validació a la Preview».

## CRM Fase 2 · CRM comercial (31/10/2026)

**Resultats reals:**
- `tsc --noEmit`: sense errors.
- ESLint: 0 errors (4 avisos que ja hi eren).
- `vitest`: 12 fitxers i **168 proves** superades. Inclouen 14 proves de RLS de la migració 009 sobre PostgreSQL (PGlite) i 13 de lògica comercial (KPI i planificador d'automatitzacions).
- `next build`: correcte.

Les 14 proves de RLS comproven:
- la visibilitat per rol;
- que un comercial no pot modificar oportunitats d'un altre;
- que no pot reassignar;
- l'increment de la versió;
- l'activitat que es crea en canviar d'etapa;
- el primer contacte del lead;
- la idempotència de `rule_key`;
- els avisos privats;
- els objectius només per a l'staff;
- la reversió de la migració.

**Navegador (Playwright, servidor de producció amb l'API i Supabase simulats):** recorregut de 12 passos superat.
1. Alta del lead des del formulari.
2. Assignació, amb l'avís corresponent.
3. Dues oportunitats per al mateix lead.
4. Arrossegar al Kanban (Nou lead → Contactat).
5. Registrar una trucada, amb el lead marcat com a contactat.
6. Tasca visible a «La meva jornada».
7. Enviament registrat com a «registrat», mai com a «enviat».
8. Guanyada, amb la tasca automàtica «Tramitar el contracte» i l'avís.
9. Conversió del lead en client: totes dues oportunitats passen al client.
10. Campana d'avisos.
11. Rendiment i Automatitzacions.
12. Conflicte de versió (409).

També s'ha comprovat la regressió de Dashboard, Renovacions, Pla d'avui, Calendari, Cartera, Comparatives, Tarifes, Clients i Configuració: no hi ha cap error de pàgina.

**Pendent de verificar amb Supabase real:**
- la migració 009 aplicada;
- Realtime entre dues sessions;
- el cron de Vercel executant les automatitzacions;
- l'enviament SMTP real que mou l'oportunitat a «Proposta enviada»;
- el recorregut amb usuaris reals de rols diferents.

## CRM Fase 3 · Contractació digital i tramitacions (01/11/2026)

**Resultats reals:**
- `tsc --noEmit`: sense errors.
- ESLint: 0 errors (4 avisos que ja hi eren).
- `vitest`: 14 fitxers i **207 proves** superades. Inclouen 18 proves de RLS i triggers de la migració 010 sobre PostgreSQL (PGlite) i 21 de lògica de contractació.
- `next build`: correcte.

Les 18 proves de base de dades (`tests/db/crm-contractacio-rls.test.ts`) comproven:
- el codi d'expedient, l'historial i el registre de comissió;
- els permisos entre comercials, Administració i col·laborador;
- la generació de requisits segons el servei i el tipus de client (idempotent);
- que no es pot passar a «Documentació completa» amb documents pendents;
- que no es pot reutilitzar un document d'un altre client;
- que només Administració valida;
- la immutabilitat de les condicions i de l'historial;
- la versió i l'autorització de les plantilles;
- que només es generen documents amb una versió autoritzada;
- que una signatura electrònica no es pot marcar com a signada des del CRM;
- la signatura manuscrita (Administració, document signat i justificació);
- que no es poden saltar estats;
- l'enviament amb data i receptora;
- la justificació de les incidències i el retorn a l'estat anterior;
- que no es pot activar sense la informació mínima;
- l'activació transaccional: contracte nou, anterior finalitzat, CUPS actualitzat i comissió **pendent**;
- el motiu de rebuig;
- la reversió de la migració, que conserva els contractes.

Les 21 proves de lògica (`tests/contracting.test.ts`) comproven:
- les transicions i les justificacions;
- els requisits i el progrés de la documentació;
- les plantilles: dades que falten, variables opcionals i desconegudes;
- el **PDF generat**: se n'extreu el text i hi apareixen les dades del client, els preus i la versió de la plantilla;
- la còpia de les condicions des d'una comparativa;
- les automatitzacions (idempotents);
- els indicadors del panell;
- el testimoni del webhook i l'estat «pendent» de la signatura.

**Navegador (Playwright, servidor de producció amb l'API i Supabase simulats): 41/41 comprovacions superades.** El recorregut:
1. Plantilla interna creada i autoritzada per Direcció.
2. Expedient creat des d'una oportunitat guanyada amb l'assistent per passos.
3. Dades del client recuperades sense duplicar-les.
4. CUPS associat.
5. El Kanban bloqueja «Documentació completa» amb documents pendents.
6. Document pujat i validat.
7. Canvis d'estat.
8. PDF generat amb una plantilla vàlida.
9. Signatura: integració pendent, no s'envia res i no es pot marcar com a signat; després es registra una signatura manuscrita.
10. Enviament amb referència i pas a «En tramitació».
11. Incidència amb justificació obligatòria.
12. Activació: el botó està desactivat si falta l'origen de la confirmació; en confirmar-la, es crea el contracte nou, l'anterior queda finalitzat i la comissió no es merita.
13. Oportunitat de renovació creada.
14. Historial complet.
15. Expedient sense permís.
16. Panell, fitxa del client i oportunitat enllaçada.
17. Regressió de 13 vistes de les fases 1 i 2 i dels mòduls anteriors, sense errors de pàgina.

**Pendent de verificar amb serveis reals:**
- la migració 010 aplicada a Supabase;
- la RLS amb usuaris reals de cada rol;
- Realtime del Kanban entre dues sessions;
- la generació i la descàrrega del PDF des de Supabase Storage;
- la signatura electrònica amb Signaturit en mode de proves (l'adaptador no s'ha provat contra el servei real perquè no hi ha credencials);
- el cron de Vercel executant les regles de contractació;
- la publicació del contracte activat al Kanban de renovacions amb dades reals.

## CRM Fase 4 · Control econòmic i comissions (01/11/2026)

**Resultats reals:**
- `tsc --noEmit`: sense errors.
- ESLint: 0 errors (4 avisos que ja hi eren).
- `vitest`: 16 fitxers i **250 proves** superades. Inclouen 16 proves de base de dades de la migració 011 sobre PostgreSQL (PGlite) i 27 del motor de comissions.
- `next build`: correcte.

**Proves obligatòries:**

| # | Prova | On |
|---|---|---|
| 1 | Comissió fixa residencial (15 € / 10 €) | `tests/commissions.test.ts` |
| 2 | Per MWh: Nufri Gala, 200 MWh × 10 = 2.000 € (amb volum elegible i prorrateig) | `tests/commissions.test.ts` |
| 3 | Percentual: Novaluz amb energia i potència; Iberdrola «Pendent de configuració»; % sobre la comissió rebuda | `tests/commissions.test.ts` |
| 4 | Trams: només el més alt; acumulat opcional; Pimes; O2; diferència idempotent | `tests/commissions.test.ts` |
| 5 | Canvi de versió: aplicació per vigència; la versió aprovada és immutable i es tanca en aprovar-ne una de nova | `commissions` i `db/crm-economia-rls` |
| 6 | Contracte anul·lat | `commissions` (retrocessió) i navegador (servidor simulat) |
| 7 | Retrocessió dins i fora del termini; sense regla no es descompta res | `tests/commissions.test.ts` |
| 8 | Liquidació parcial | `db/crm-economia-rls` i navegador |
| 9 | Liquidació aprovada: bloqueig d'imports i de línies; no torna enrere; no s'esborra | `db/crm-economia-rls` i navegador |
| 10 | Intent d'edició no autoritzat (comercial, administrativa, aprovació pròpia) | `db/crm-economia-rls` i navegador |
| 11 | Pagament i cobrament duplicats | `db/crm-economia-rls` i navegador |
| 12 | Conciliació amb diferències i lectura de fitxers (formats d'import) | `commissions` i navegador |
| 13 | Preservació de l'historial (càlculs, moviments, pagaments i auditoria immutables) | `db/crm-economia-rls` |
| 14 | Decimals: 0,1 + 0,2; 2,675 → 2,68; percentatges amb 6 decimals | `commissions` i `db/crm-economia-rls` |
| 15 | Permisos de comercials i col·laboradors (sense capa del proveïdor ni marges) | `db/crm-economia-rls` i navegador |

**Navegador (Playwright, servidor de producció amb l'API simulada): 37/37 comprovacions superades.** S'han comprovat els 14 criteris d'acceptació:
1. Direcció aprova la regla de Nufri Gala; Iberdrola no s'aprova sense base; es crea una regla de proveïdor.
2. Al contracte: càlcul de 6.000 € (proveïdor) i 2.000 € (comercial), amb el desglossament.
3. Meritació.
4. Liquidació de Nufri amb una diferència de −10 €, conciliada amb un motiu.
5. Cobrament real; el duplicat es rebutja.
6. Liquidació mensual: revisió, aprovació, pagament parcial, pagament duplicat rebutjat i pagament complet.
7. Historial amb l'autor.
8. Enllaç al PDF.
9. Marge real de 3.990 €.
10. Panell econòmic.
11. Vista de comercial: sense panell, conciliació ni regles; la seva liquidació només en lectura; l'API rebutja els canvis (403); la seva comissió es veu sense la del proveïdor ni el marge.
12. Regressió de 10 vistes de les fases anteriors sense errors.

Que el contingut del PDF és correcte es comprova a les proves unitàries (s'extreu el text del PDF). Al navegador, la descàrrega no es pot provar sense Supabase.

**Pendent de verificar amb serveis reals:**
- la migració 011 aplicada a Supabase;
- la RLS amb usuaris reals;
- la importació de fitxers reals de les comercialitzadores (format de columnes);
- la generació i descàrrega del PDF des de Vercel;
- el cron executant les alertes econòmiques;
- la validació per part de Direcció de les regles inicials i de la capa a la qual pertanyen.

## CRM Fase 5 · Intel·ligència IA i motor d'oportunitats (01/11/2026)

**Resultats reals:**
- `tsc --noEmit`: sense errors.
- ESLint: 0 errors (3 avisos que ja hi eren).
- `vitest`: 19 fitxers i **315 proves** superades. Les noves són:
  - 19 de base de dades de la migració 012 sobre PostgreSQL (PGlite);
  - 36 del nucli d'intel·ligència, el PDF i el Copilot;
  - 10 del motor del servidor de punta a punta amb un client Supabase en memòria.
- `next build`: correcte.

**Proves obligatòries (secció 15):**

| # | Prova | On |
|---|---|---|
| 1 | Detecció de renovacions (finestres 120/90/60/30/15, vençuts, estats) | `intelligence.test.ts`, `intelligence-engine.test.ts` |
| 2 | Prevenció de duplicats (clau per contracte i cicle, hash d'entrades, `rule_key`, segona execució sense canvis) | `intelligence`, `intelligence-engine`, `db/crm-ia-rls` |
| 3 | Comparació amb dades completes (font del preu actual, determinisme) | `intelligence.test.ts` |
| 4 | Rebuig amb dades insuficients («Pendent de factura o condicions actuals», indexada sense fórmula) | `intelligence.test.ts` |
| 5 | Tarifes per períodes (2.0TD i 3.0TD, 6 períodes) | `intelligence.test.ts` |
| 6 | Potència i energia (unitats €/kW·dia i €/kW·any; potència sense reduccions definitives) | `intelligence.test.ts` |
| 7 | SAS inclòs, exclòs i estimat; escenari només amb configuració, font, data i comercialitzadora; costos únics separats | `intelligence.test.ts` |
| 8 | Càlcul d'estalvi i classificació | `intelligence.test.ts` |
| 9 | Tres alternatives per cost anual, amb motius; la comissió no altera l'ordre | `intelligence.test.ts`, `intelligence-engine.test.ts` |
| 10 | Generació del PDF (s'extreu el text: client, CUPS, 3 alternatives, validesa, hipòtesis, missatge 2013, ESBORRANY) | `intelligence.test.ts` |
| 11 | Vinculació del PDF amb el client (document *proposta*, esborrany i aprovació) | `intelligence-engine`, `db/crm-ia-rls`, navegador |
| 12 | Copilot amb permisos (eines amb la sessió de l'usuari, RLS) | `db/crm-ia-rls`, `intelligence-engine`, navegador |
| 13 | Denegació de dades no autoritzades (altres comercials, col·laboradors, economia) | `db/crm-ia-rls`, navegador |
| 14 | Accions sensibles amb confirmació (testimoni, caducitat, un sol ús, propietari) | `intelligence-engine`, `intelligence`, navegador |
| 15 | Tarifes caducades (exclusió, alerta, propostes bloquejades) | `intelligence`, `intelligence-engine` |
| 16 | Integració amb contractació (una sola oportunitat comercial, guanyada → oportunitat IA guanyada, expedient sense duplicar CUPS) | `intelligence-engine`, `db/crm-ia-rls`, navegador |
| 17 | Integració amb comissions (capes separades, simulació, sense base, mai cobrat) | `intelligence`, `db/crm-ia-rls` |
| 18 | Automatitzacions (bloqueig, idempotència, caducitat, errors consecutius, retenció) | `intelligence-engine`, `db/crm-ia-rls` |
| 19 | Control de costos d'IA (límit per minut, diari, pressupost i variables d'entorn) | `intelligence`, `intelligence-engine` |
| 20 | Compatibilitat amb les fases anteriors (012 idempotent i reversible; fluxos de les fases 1-4; les 250 proves anteriors) | `db/crm-ia-rls`, suite completa, navegador |

**Navegador (Playwright, servidor de producció amb l'API simulada; les dades les ha generat el motor real): 37/37 comprovacions superades.**
- Indicadors i filtres.
- Anàlisi manual i registre d'execucions.
- Calendari d'accions.
- Comparador integrat amb font del preu actual, 3 alternatives i escenari SAS.
- Proposta: esborrany a la fitxa del client, aprovació, intent d'enviament sense SMTP (no es registra) i acceptació → oportunitat comercial.
- Descartar amb motiu.
- Copilot (fonts, mode regles, acció proposada i confirmada).
- Oposició comercial.
- Configuració SAS.
- Vistes de comercial i de col·laborador.
- Vista mòbil.
- Regressió de 6 vistes de fases anteriors.

**Pendent de verificar amb serveis reals:**
- la migració 012 aplicada a Supabase i la RLS amb usuaris reals;
- el Copilot amb `ANTHROPIC_API_KEY`;
- l'enviament SMTP de propostes;
- el cron diari a Vercel amb la cartera real;
- l'optimització de potència amb dades SIPS reals;
- l'activació de l'escenari SAS per part de Direcció amb una font documentada.

## CRM Fase 6 · Captació, portal de col·laboradors i màrqueting (01/11/2026)

**Resultats reals:**
- `tsc --noEmit`: sense errors.
- ESLint: 0 errors (3 avisos que ja hi eren).
- `vitest`: 22 fitxers i **368 proves** superades. Les noves són:
  - 15 de base de dades de la migració 013 sobre PostgreSQL (PGlite), amb `anon` amb els permisos de taula per defecte de Supabase;
  - 22 del nucli de captació;
  - 16 del servidor de punta a punta amb un client Supabase en memòria (amb Storage).
- `next build`: correcte (`/estudi`, `/portal`, `/privacitat`, `/avis-legal` i les API de captació, el portal i els webhooks).

**Proves obligatòries (secció 19):**

| # | Prova | On |
|---|---|---|
| 1 | Enviament del formulari | `capture.test.ts`, `capture-engine.test.ts`, navegador |
| 2 | Pujada segura de factura (contingut real, mida, PDF amb codi actiu, executables disfressats) | `capture.test.ts`, `capture-engine.test.ts`, navegador |
| 3 | Creació real del lead (`crm_leads` de la Fase 2) | `capture-engine.test.ts` |
| 4 | Persistència (sol·licitud, consentiments, document, fitxer al bucket privat, conversió) | `capture-engine`, `db/crm-captacio-rls` |
| 5 | Detecció de duplicats (CUPS, NIF, telèfon, correu; sense fusió) | `capture.test.ts`, `capture-engine.test.ts` |
| 6 | Lectura de factura (en segon pla; error de la IA sense perdre el lead; reintent) | `capture-engine.test.ts` |
| 7 | Validació de les dades extretes (unitat, pàgina, estat; CUPS, NIF, dates, tarifa, impostos; gas) | `capture.test.ts` |
| 8 | Creació de tasca (primer contacte i revisió) | `capture-engine.test.ts` |
| 9 | Assignació de comercial (regles, càrrega, rotació, historial) | `capture.test.ts`, `capture-engine`, `db` |
| 10 | Proposta preliminar (anualització, PDF ESBORRANY i PRELIMINAR, bloqueig fins a la revisió) | `capture-engine.test.ts`, navegador |
| 11 | Alta de col·laborador (només Direcció; accés, codi únic, dades fiscals) | `capture-engine.test.ts`, navegador |
| 12 | Captació per enllaç de referència | `capture`, `capture-engine`, navegador |
| 13 | Atribució correcta (vigent, en disputa, codi fals, només Direcció, sense reassignar) | `capture`, `capture-engine`, `db` |
| 14 | Consulta de comissions del col·laborador | `capture-engine.test.ts`, navegador |
| 15 | Denegació d'accés a dades alienes | `db/crm-captacio-rls`, `capture-engine`, navegador |
| 16 | Recepció i verificació de webhooks (HMAC, verificació de subscripció, idempotència, estats de WhatsApp) | `capture`, `capture-engine`, `db` |
| 17 | Gestió de consentiments (separats, immutables, retirada, anonimització) | `capture`, `capture-engine`, `db` |
| 18 | Resistència a enviaments duplicats | `capture-engine`, `db` |
| 19 | Integració amb el CRM (conversió → fitxa del client, comparativa, automatitzacions, fases 1-5) | `capture-engine`, `db`, navegador |
| 20 | Build de producció | `next build` correcte |

**Navegador (Playwright, servidor de producció amb l'API simulada; les dades les ha generat el motor real): 30/30 comprovacions superades.** S'ha comprovat:
- la landing (seccions, sense promeses d'estalvi garantit);
- la validació del formulari, el rebuig d'un fitxer fals i l'enviament multipart amb factura, UTM, gclid i consentiments separats;
- les mètriques anònimes, les pàgines legals i la pujada amb la càmera al mòbil;
- el panell amb l'estat de cada indicador i els filtres;
- els col·laboradors i les integracions pendents de credencials;
- la fitxa del lead: lectura, revisió obligatòria, proposta preliminar i WhatsApp pendent;
- el portal: indicadors propis, aportar un client, operacions, liquidació en PDF, enllaç i QR, i que no s'hi veuen dades alienes;
- els permisos de comercial i de col·laborador;
- la regressió de 6 vistes.

Limitació de la prova: Playwright no exposa el contingut binari dels fitxers interceptats, de manera que al navegador el fitxer fals es rebutja pel nom. La comprovació real del contingut està coberta a les proves unitàries i de servidor.

**Pendent de verificar amb serveis reals:**
- Supabase (migració 013, RLS, bucket privat i invitacions);
- la lectura amb IA de factures reals;
- Google Ads, Meta Lead Ads i WhatsApp Cloud API;
- `after()` i el cron a Vercel;
- la revisió legal dels textos.

## CRM Fase 7 · Consolidació, Direcció compartida, supervisió i portal (01/11/2026)

**Resultats reals:**
- `tsc --noEmit`: sense errors.
- ESLint: 0 errors. Hi ha 4 avisos, tots anteriors a la Fase 7.
- `vitest`: 24 fitxers i **428 proves superades**. Les noves són:
  - 21 de RLS de la migració 014 sobre PostgreSQL (PGlite):
    - permisos;
    - economia restringida i autorització de Direcció;
    - auditoria només per afegir;
    - historial i guarda de tasques;
    - col·laboradors;
    - incidències;
    - preferències i MFA;
    - migració de retorn i reaplicació;
    - comissió vinculada al responsable;
    - documents protegits.
  - 39 del servidor amb un client Supabase en memòria (permisos, Centre de Control, panells, tasques, escalats, qualitat, informes, portal i cercador).
- `npm run test:compat014`: les **104 proves de base de dades de les fases 1-6** tornen a passar amb la 014 aplicada, amb Administració autoritzada a l'economia tal com ho faria Direcció.
- **PostgreSQL 16 real (local):**
  - les migracions 001-014 s'apliquen netes;
  - la 014 es pot reaplicar sense errors (idempotent);
  - `pg_trgm` i els 6 índexs trigram es creen;
  - la migració de retorn es pot executar i la 014 es pot tornar a aplicar;
  - RLS: Direcció veu els costos; la Cap administrativa sense autorització i la comercial, no;
  - `fase7_equip.sql` és idempotent;
  - còpia i **restauració verificada** de 108 taules.
- `next build`: correcte (`/collaboradors`, `/portal` → redirecció, `/api/control`, `/api/work`, `/api/permissions`, `/api/reports`, `/api/reports/cron`).

**Proves obligatòries (secció 16):**

| # | Prova | On | Resultat |
|---|---|---|---|
| 1 | Joan accedeix a totes les funcions de Direcció | `consolidacio.test.ts`, navegador | Superada |
| 2 | Olivié té exactament els mateixos permisos (i xifres) | `consolidacio.test.ts`, `db`, navegador | Superada |
| 3 | Joan personalitza el seu panell (afegir, mida, treure, arrossegar, filtres desats) | `consolidacio.test.ts`, navegador | Superada |
| 4 | Olivié personalitza el seu sense alterar el de Joan | `consolidacio.test.ts`, navegador | Superada |
| 5 | Les preferències persisteixen en una sessió nova | `consolidacio.test.ts`, navegador | Superada |
| 6 | Iberth assigna tasques administratives (amb avís) | `consolidacio.test.ts`, `db`, navegador | Superada |
| 7 | L'administrativa gestiona els seus expedients i tasques | `consolidacio.test.ts`, navegador | Superada |
| 8 | Patricia crea un lead i una oportunitat | `consolidacio.test.ts` | Superada |
| 9 | Patricia només veu les seves comissions | `consolidacio.test.ts`, `db` (existents i 014), navegador | Superada |
| 10 | Un col·laborador crea un lead (també amb altres serveis) | `consolidacio.test.ts`, `capture-engine.test.ts`, navegador | Superada |
| 11 | El lead queda atribuït correctament | `capture-engine.test.ts`, `db/crm-captacio-rls` | Superada |
| 12 | El col·laborador consulta les seves operacions | `consolidacio.test.ts`, navegador | Superada |
| 13 | Un altre col·laborador no hi pot accedir | `consolidacio.test.ts`, `db/crm-captacio-rls`, `db/crm-consolidacio-rls` | Superada |
| 14 | Un col·laborador no pot accedir al CRM intern (interfície i API) | `consolidacio.test.ts`, navegador | Superada |
| 15 | Una renovació genera una tasca (una sola) | `consolidacio.test.ts`, `sales.test.ts` | Superada |
| 16 | Un expedient bloquejat genera una alerta i compta als indicadors | `consolidacio.test.ts`, `contracting*.test.ts` | Superada |
| 17 | Una activació actualitza els indicadors | `consolidacio.test.ts` | Superada |
| 18 | La comissió queda vinculada al responsable correcte | `db/crm-consolidacio-rls` | Superada |
| 19 | Els documents es recuperen de manera segura | `db/crm-consolidacio-rls`, proves de documents de la Fase 1 | Superada |
| 20 | Les fases 1 a 6 continuen funcionant | 428 proves, `test:compat014`, navegador | Superada |

**Navegador (Playwright, servidor de producció amb l'API simulada; les dades les ha generat el motor real): 36/36 comprovacions superades, sense errors de JavaScript.** Es van provar:
- **Joan:** Centre de Control i definicions dels indicadors; personalització amb ratolí (afegir, mida, treure, arrossegar), filtres desats i cercador global.
- **Olivié:** un panell diferent que no altera el de Joan; persistència de les preferències.
- **Direcció:**
  - informes i descàrrega del PDF;
  - qualitat de dades i revisió d'un cas;
  - centre d'alertes;
  - permisos per rol i per persona (autoritzar Iberth a l'economia), seguretat i MFA, auditoria.
- **Iberth:** supervisió, assignació d'una tasca, detall de tasca amb historial, incidència amb escalat.
- **Administrativa:** la seva jornada i finalitzar una tasca.
- **Patricia:** el panell comercial, sense opcions econòmiques globals.
- **Pau:** redirigit de `/` al portal; indicadors; operacions; aportar un client amb altres serveis; contactar; l'API interna li retorna 403.
- **Altres:** mòbil; Clients 360° i Captació continuen funcionant.

**Rendiment mesurat:** vegeu `CRM_FASE7.md · 11`.

**No verificat en aquest entorn (cal fer-ho a una Preview de Vercel amb el Supabase real):**
- inici de sessió real i MFA amb Supabase Auth (TOTP);
- el middleware amb sessió real (redirecció del col·laborador al servidor);
- l'enviament real d'informes per SMTP;
- el cron de Vercel;
- la còpia del bucket de documents;
- les integracions externes, que estan pendents de credencials.

## CRM Fase 8 · Auditoria, correcció d'errors, seguretat i optimització (01/11/2026)

**Resultats reals:**
- `tsc --noEmit`: sense errors.
- ESLint: 0 errors. Els 3 avisos són anteriors a la Fase 8.
- `vitest`: 27 fitxers i **488 proves superades** (60 noves):
  - `comunicacions.test.ts` (25): servidor de correu, WhatsApp, ressenyes i protecció de dades, amb un client en memòria i un SMTP simulat;
  - `db/comunicacions-rls.test.ts` (15): RLS de la migració 015 sobre PostgreSQL (PGlite), aplicada dues vegades;
  - `fase8-api.test.ts` (11): `/api/health`, `/api/workspace` i menú;
  - `energy/sips.test.ts` (+9): errors tipificats del portal SIPS simulat.
- `npm run test:compat014`: **119 proves de base de dades** de les fases 1-8 superades.
- **PostgreSQL 16 real (local):**
  - les migracions 001-015 s'apliquen netes;
  - la 015 és idempotent;
  - `015_down` s'executa i la 015 es torna a aplicar;
  - les 6 taules noves tenen RLS, i `user_mail_accounts` no té cap política (només hi accedeix el servidor).
- `next build`: correcte, sense source maps al navegador.
- Al bundle del client no hi ha cap valor de secret, només noms de variables en textos d'ajuda.
- **Navegador (Playwright, compilació de producció, API simulada):** recorregut de la Fase 8 **36/36**. Regressió de la Fase 7 **36/36** (2 selectors del guió s'han acotat a `main` i `header` pel menú nou). Sense errors de JavaScript.

**Llegenda de les 50 proves:**
- **L**: verificada en local amb proves automàtiques;
- **PG**: verificada sobre PostgreSQL real (PGlite o PG 16);
- **N**: verificada al navegador amb dades simulades;
- **⏳**: pendent de producció o d'una credencial externa (no s'ha pogut fer aquí).

| # | Prova | Verificació | Què falta per a producció |
|---|---|---|---|
| **Clients** | | | |
| 1 | Alta de client amb validació de NIF/CIF/NIE i telèfon | L (`crm.test.ts`) | — |
| 2 | Duplicat per NIF detectat abans de desar | L, N (fase 1) | — |
| 3 | El comercial només veu els seus clients (RLS) | PG (`crm-rls`) | — |
| 4 | La fitxa 360° carrega subministraments, contractes, documents, activitat i tasques | N | — |
| 5 | Les modificacions queden a l'auditoria de la fitxa | PG (`crm-rls`) | — |
| 6 | Preferència de contacte i baixa comercial respectades en totes les comunicacions | L (`comunicacions`) | — |
| 7 | Cercador global (només clients visibles) i entrada des del menú | N (`g7`, `g8`) | — |
| **Documents** | | | |
| 8 | Pujada a Storage privat amb validació del contingut real | L (`crm.test.ts`) | ⏳ prova amb el bucket real |
| 9 | Documents sensibles (DNI, banc) amagats al col·laborador i a altres comercials | PG (`crm-rls`, `consolidacio-rls`) | — |
| 10 | Conservació obligatòria (no es pot esborrar abans de `retain_until`) | PG (`crm-rls`) | — |
| 11 | Categoria «Protecció de dades» per a evidències | PG (`comunicacions-rls`) | — |
| **SIPS** | | | |
| 12 | CUPS invàlid → error abans de consultar el portal | L (`sips.test.ts`) | — |
| 13 | Sense credencials → «SIPS no configurat» i el botó explica per què està desactivat | L, N | — |
| 14 | Credencials incorrectes, portal caigut, temps esgotat, xarxa, límit 429 i resposta no JSON → errors diferenciats | L (portal simulat), N | ⏳ **prova real amb `SIPS_USER`/`SIPS_PASSWORD`** |
| 15 | Sense resultats → 0 files (no s'inventa cap dada) | L | ⏳ |
| 16 | Vincular les dades SIPS al subministrament del CRM amb data i origen | L (tsc i ruta) | ⏳ prova amb un CUPS real |
| 17 | El comercial pot consultar els CUPS dels seus subministraments del CRM | L | ⏳ |
| **Comunicacions** | | | |
| 18 | Configuració del correu propi; la credencial es xifra i mai es retorna | L, PG, N | — |
| 19 | Prova de connexió i revocació | L, N | ⏳ SMTP real de cada usuari |
| 20 | Enviament des del compte propi amb el remitent visible i la signatura | L | ⏳ SMTP real |
| 21 | Rebuig o error de l'SMTP → mai «enviat» | L, N | — |
| 22 | WhatsApp per enllaç amb el número propi i el text preparat | L, N | — |
| 23 | WhatsApp Cloud: només números autoritzats; sense token → pendent (no simulat) | L, PG, N | ⏳ `WHATSAPP_TOKEN` i alta a Meta |
| **Ressenyes** | | | |
| 24 | Missatges exactes en català i castellà, amb l'enllaç de Google | L, N | — |
| 25 | Missatge editable; copiar, obrir WhatsApp, preparar correu i obrir Google Reviews | N | — |
| 26 | Registre «preparada» → «enviada» només quan l'usuari ho confirma; mai «publicada» | L, PG, N | — |
| 27 | Duplicats accidentals bloquejats (2 min) | PG, N | — |
| 28 | Darrera data de sol·licitud visible i recordatori opcional | L, N | — |
| **Protecció de dades** | | | |
| 29 | Missatge amb l'enllaç de fdigital.es | L, N | — |
| 30 | Obrir o enviar l'enllaç → «sol·licitada», mai signada | L, PG, N | — |
| 31 | «Completada» exigeix evidència (del mateix client) o nota | L, PG, N | — |
| 32 | Estats rebutjada i caducada, i bases legals (no només consentiment) | L, PG | — |
| 33 | Cada canvi d'estat queda a `sec_audit` amb qui i quan | PG | — |
| **CRM general** | | | |
| 34 | Menú amb els 9 grups i sense duplicats | L, N | — |
| 35 | El menú s'adapta als permisos (comercial ≠ Direcció; col·laborador sense menú intern) | L, N | — |
| 36 | Cerca ràpida, preferits, mode compacte, teclat i mòbil | N | — |
| 37 | Preferències del menú recuperades en un altre navegador | N | — |
| 38 | Dades energètiques persistents entre navegadors, amb control de concurrència (409) | L | ⏳ prova amb dos dispositius reals |
| 39 | Centre de Control i panells per rol (regressió de la Fase 7) | L, N | — |
| 40 | Tasques, incidències i alertes (regressió) | L, PG, N | — |
| 41 | Economia i comissions restringides (regressió) | PG | — |
| 42 | Captació i portal de col·laboradors (regressió) | L, PG, N | — |
| **Seguretat** | | | |
| 43 | Cap secret al repositori ni al bundle del navegador | L (cerca de patrons i `.next/static`) | — |
| 44 | Sense source maps de producció | L | — |
| 45 | Capçaleres HSTS, X-Frame-Options DENY (sense iframes) i sense `x-powered-by` | L | ⏳ comprovar-ho a la Preview |
| 46 | `/api/health` no revela la configuració sense una sessió de Direcció | L | — |
| 47 | Credencials SMTP inaccessibles des del navegador (RLS sense polítiques) | PG | — |
| 48 | Ningú llegeix ni modifica la configuració ni l'espai de treball d'un altre usuari | PG | — |
| 49 | Endpoints públics (propostes, captació) amb token, validació i límit (regressió) | L | — |
| 50 | Dependències auditades (`npm audit`) | L | ⏳ 3 avisos alts amb correcció només per canvi de versió major (vegeu AUDITORIA_FASE8.md) |

**No verificat en aquest entorn** (cal fer-ho a la Preview de Vercel, amb credencials reals):
- connexió real amb el portal SIPS;
- enviament SMTP real des del compte de cada usuari;
- WhatsApp Cloud API;
- OAuth de Google i Microsoft;
- bucket real de Storage;
- persistència amb dos dispositius reals.
