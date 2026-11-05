# Fase 10 · Correccions, agenda, calendaris externs i estat de les comercialitzadores — informe

Branca: `feature/fase10-agenda` (parteix de `feature/reclamacions-comercialitzadores`, inclou les fases 8.2 i 9). No toca `main`.
Migracions noves: **020** (agenda) i **021** (estat de les comercialitzadores), additives, idempotents i amb `_down`.

## 1. Funcionalitats completades
| Punt | Què fa | Fitxers principals |
|---|---|---|
| 1.1 SIPS | Estat de configuració per a l'administrador (Configuració) i **prova de connexió real** (inicia sessió al portal sense consultar cap CUPS). Diu exactament quines variables falten. «Consultar SIPS» amb el CUPS del contracte, importació a la comparativa sense trepitjar dades manuals i botó per tornar (Fase 9). | `src/server/sips.ts`, `app/api/sips/status`, `Ajustes.tsx` |
| 1.2 Tancar sessió | Menú d'usuari a la capçalera: tanca la sessió de Supabase Auth (aquest dispositiu o tots), neteja l'estat sensible del navegador i torna a l'inici de sessió. | `src/ui/account.tsx`, `Shell.tsx` |
| 1.3 Contrasenya | Perfil → **Seguretat**: canvi amb reautenticació (contrasenya actual), requisits validats al navegador i al servidor, «He oblidat la contrasenya» per correu i pantalla per posar-ne una de nova des de l'enllaç. No es desa cap contrasenya (ho fa Supabase Auth). | `account.tsx`, `app/api/account`, `src/core/password.ts`, `app/login/page.tsx` |
| 1.4 Unitats | Una sola font d'unitats: €/MWh, €/kWh, €/contracte, €/kW·any, €/mes, %, mesos… als avisos de contradicció, regles i condicions. | `src/core/units.ts` |
| 1.5 Crides a l'API | `page=0` a la llista de clients: el navegador ja no l'envia i el servidor el corregeix a 1 en lloc de fallar. Comercialitzadora amb l'id buit: ja no es crida `get` sense id (torna a la llista). | `crm/api.ts`, `core/crm.ts`, `RetailerDetail.tsx` |
| 2–3 Agenda | Mòdul **Agenda** amb vistes mes / setmana / dia i agenda **personal / compartida / combinada**. Cites, trucades, visites, reunions, seguiments, recordatoris, absències i tasques (les tasques són les mateixes de `crm_tasks`: no hi ha una segona taula). Recurrències, prioritats, estats, diversos participants, filtres per persona i tipus, vincle amb client, contracte, renovació i incidència. Les cites personals són privades per defecte. | `src/core/agenda.ts`, `src/server/agenda.ts`, `src/ui/views/agenda/*` |
| 4 Disponibilitat | Avís de coincidència horària en crear o moure una cita, vista conjunta de l'equip (lliure / ocupat / sense informació) i proposta de franges lliures. Dels altres només es veu «ocupat», mai el contingut d'una cita personal. | `agenda.ts` (`findConflicts`, `suggestSlots`) |
| 5 Panell | Resum a l'inici: tasques d'avui, vençudes, properes cites, activitats assignades, renovacions a seguir i incidències amb tasques, amb accions ràpides (fet, reprogramar, obrir client o contracte, reassignar si té permís). | `agenda/Summary.tsx`, panells de rol |
| 6 Google / Outlook | «Connectar calendari» amb OAuth segur (state signat), tokens xifrats només al servidor, modes **només lectura / exportar / bidireccional** (mai bidireccional sense que l'usuari ho triï), ids externs sense duplicats, conflictes, zona horària i renovació de tokens. | `src/server/calendar.ts`, `app/api/calendar/*` |
| 7 Integració | Fitxa 360º (cita, tasca, trucada, seguiment, agenda del client), contractes i calaix del Kanban (recordatori, renovació, visita, seguiment, recordatoris del contracte), incidències (tasca, responsable, seguiment). En obrir un client des d'una cita, «Enrere» torna a l'agenda amb la mateixa data i filtres. | `agenda/Linked.tsx`, `Incident.tsx`, `ContractDrawer.tsx`, `ClientDetail.tsx` |
| 8 Recordatoris | Antelació 5 min, 15 min, 30 min, 1 h, 1 dia o personalitzada; avisos persistents a la campana sense duplicats; hora d'Europe/Madrid. Es generen mentre hi ha el CRM obert i amb la tasca programada del servidor (`/api/agenda/cron`). Correu i WhatsApp queden preparats però desactivats. | `/api/agenda/cron`, `vercel.json`, `supabase/optional/…` |
| 9 Comercialitzadores | Activar, desactivar, reactivar, arxivar i eliminar (només si no té cap dependència, amb doble confirmació escrivint el nom). Filtres Actives / Desactivades / Arxivades / Totes. Les desactivades i arxivades no surten als selectors de contractes, expedients ni comparatives nous, i tot l'historial es conserva. Registre de qui i quan. | `src/server/retailers.ts`, `RetailersList.tsx`, `RetailerDetail.tsx`, `retailers/options.tsx` |
| 10 Seguretat | Permisos al servidor i amb RLS (agenda personal només per al propietari, creador i participants; assignar a altres: Direcció, Cap administrativa i Cap d'equip amb el seu equip; col·laboradors sense accés). Tokens de Google, Microsoft i SIPS mai al navegador. | migracions 020 i 021 |

## 2. Errors corregits
`page=0` a Clients 360°, `retailers?r=get` amb id buit, unitats «eur_mwh» als avisos, manca de botó de tancar sessió i de canvi de contrasenya.

## 3. Migracions SQL (en aquest ordre)
1. `019_navegacio_360.sql` (Fase 9, si encara no l'has executat)
2. `020_agenda.sql`
3. `021_comercialitzadores_estat.sql`
4. Opcional: `supabase/optional/agenda_recordatoris_cada_5_minuts.sql` (recordatoris cada 5 minuts sense ningú connectat; cal activar pg_cron i pg_net i crear dos secrets a Vault, ho explica el fitxer).

## 4. Variables d'entorn (Vercel) — només noves, no se'n canvia cap d'existent
- `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`
- `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET`, opcional `MICROSOFT_CALENDAR_TENANT`
- Ja existents que cal tenir omplertes: `APP_URL` (domini real), `CRON_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `SIPS_USER`, `SIPS_PASSWORD` (i `SIPS_BASE_URL` si no és el per defecte).
- Adreces de retorn per registrar a Google Cloud i Azure: `${APP_URL}/api/calendar/callback?provider=google` i `…?provider=microsoft`.
- Supabase Auth → Redirect URLs: afegir `${APP_URL}/login?reset=1` (recuperació de contrasenya).

## 5. Proves
| Prova | Tipus | Resultat |
|---|---|---|
| typecheck · lint (0 errors) · build de producció | Codi | OK |
| vitest: 675 proves (43 fitxers), de les quals 37 noves de la Fase 10 | Lògica | OK |
| `tests/db/agenda-rls.test.ts` (11): privacitat de les cites, assignacions, calendaris sense lectura de tokens, estats de comercialitzadores i eliminació bloquejada | **Provat de debò** sobre Postgres local (PGlite), no sobre el Supabase real | OK |
| SIPS, Google i Microsoft (tests/fase10.test.ts) | **Provat amb simulació** (servidors falsos) | OK |
| `e2e/fase10.e2e.cjs` (Playwright, 10 recorreguts): tancar sessió, contrasenya, vistes de l'agenda, coincidències, disponibilitat, fitxa 360º, Kanban, calendari sense credencials, panell d'inici, comercialitzadores | **Provat amb simulació** (navegador real, respostes inventades) | 10/10 OK |
| `e2e/navegacio.e2e.cjs` (Fase 9, 7 recorreguts) | Simulació | 7/7 OK (no s'ha trencat res) |

## 6. Integracions pendents de credencials (no verificades de debò)
- **SIPS**: falten `SIPS_USER` i `SIPS_PASSWORD` → la prova de connexió de Configuració dirà si funciona.
- **Google Calendar** i **Outlook**: falten les aplicacions OAuth i les variables. Fins llavors surten com a «no disponible».
- **Recuperació de contrasenya**: depèn que Supabase Auth tingui el Site URL i les Redirect URLs del domini real, i que l'enviament de correus d'Auth funcioni.
- Recordatoris per **correu i WhatsApp**: preparats, desactivats fins que hi hagi SMTP/IONOS i WhatsApp Cloud API.

## 7. Limitacions reals
- La tasca programada de Vercel s'executa un cop al dia: els recordatoris de pocs minuts sense ningú connectat necessiten el fitxer opcional de pg_cron.
- Cap prova s'ha fet contra el Supabase real ni amb comptes reals de Google o Microsoft.

## 8. Build de producció
`npm run build`: compilat correctament.
