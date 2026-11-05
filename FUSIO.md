# Fusió · Assessoria 3.0 — Intelligence Platform

Renewal Intelligence Pro (CRM de renovacions) i Energy Intelligence Pro (`ASSESSORIA30/cups2`) en **una sola aplicació Next.js**: una autenticació (Supabase), un menú, un tema i un sistema d'avisos. Els components reals de cups2 s'importen com a codi React: **no hi ha iframes ni redireccions a l'altra web**.

Branca de treball: `feature/fusio-energy-intelligence`. El primer commit (`Backup: Renovacions abans de la fusió`) és l'estat exacte del ZIP de partida.

## 1. Auditoria (resum)

| | Renewal Intelligence Pro (base) | Energy Intelligence Pro (cups2) |
|---|---|---|
| Framework | Next.js 15 · React 19 · App Router, una pàgina amb vistes a l'estat (zustand) | Next.js 16 · React 19 · exportació estàtica (`output: "export"`) |
| Estils | Tailwind 3, tokens RGB (`rgb(var(--x) / α)`) | Tailwind 4, tokens hex, components Radix (estil shadcn) |
| Gràfics | Recharts | Apache ECharts |
| Dades | Supabase (RLS), Google Drive/Sheets, Storage | IndexedDB al navegador |
| SIPS | Motor parcial (5–9 camps) a `src/server/sips*.ts` | Motor complet de 97 camps (`api/sips.ts`) + tests |
| Accés SIPS | Sessió Supabase | Clau `APP_ACCESS_KEY` al navegador |
| Excel | `xlsx` (SheetJS) | `exceljs` (necessari per a l'exportació SIPS) |

Conflictes resolts:
- **Next 15 vs 16**: es manté Next 15 (producció). El codi de cups2 és client i funciona sense canvis de framework.
- **Tailwind 4 → 3**: els tokens de cups2 (`surface-2`, `fg-3`, `accent`, `critical`…) s'han afegit al `tailwind.config.ts` en format RGB perquè funcionin amb opacitats (`bg-accent/10`). Els neutres s'alineen amb Renovacions (coherència visual); l'accent turquesa, la paleta dels gràfics i els estats són els de cups2.
- **Rutes de cups2** (`/radar`, `/suministro/?cups=`…): `src/energy/compat/*` substitueix `next/link`, `next/navigation`, `sonner` i `next-themes` per la navegació, els avisos i el tema de la plataforma. Les URL són `/?v=fitxa&cups=ES…` (enllaçables i amb «enrere» del navegador).
- **Dos motors SIPS**: s'elimina el parcial (`src/server/sipsSearch.ts`) i s'adopta el de cups2 com a motor únic (`src/energy/lib/sips-engine.ts`).
- **`APP_ACCESS_KEY`**: ja no cal; tota consulta passa per la sessió Supabase i els permisos del CRM.

## 2. Arquitectura

```
app/api/sips/{search,refresh,supply,cache,status,import,enrich}   APIs SIPS (servidor, sessió Supabase)
app/api/energy/inputs                                              dades manuals de factures (kWh P1–P6, maxímetres)
app/api/sync/cron                                                  Google Drive + enriquiment SIPS per lots
src/server/sips.ts             servei SIPS: permisos, límits, auditoria, memòria cau, TTL, reintents
src/energy/lib/sips-engine.ts  motor de cups2 (login CSRF, 97 camps, variants de majúscules, CUPS 20/22)
src/energy/lib/sips-record.ts  MODEL UNIFICAT: fila SIPS ↔ Supply ↔ sips_cache ↔ resum CRM
src/energy/lib/*               motors de cups2 sense canvis funcionals (optimizer, reactive, market, alerts, scoring, tariffs, pdf…)
src/energy/components/*        components de cups2 (fitxa, gràfics ECharts, optimitzador, mercat…)
src/energy/views/*             pantalles de cups2 adaptades al shell únic
src/energy/EnergyRoot.tsx      arrel del mòdul (càrrega diferida amb next/dynamic)
src/ui/views/DashboardExec.tsx dashboard executiu
src/ui/useSips.ts              resum SIPS compartit per Kanban, fitxa del contracte i generador d'ofertes
```

### Navegació

| CRM I RENOVACIONS | INTEL·LIGÈNCIA ENERGÈTICA | GESTIÓ |
|---|---|---|
| Dashboard · Renovacions · Pla d'avui · Calendari · Cartera · Ofertes | Buscador SIPS · Anàlisi energètica · Radar comercial · Power Optimizer · Alertes · Energy Market | Estadístiques · Plantilles · Usuaris · Configuració (+ pestanya «Energia i SIPS») |

### Flux «Analitzar CUPS»

Targeta del Kanban / fitxa del contracte → `analyzeCups(cups, contractId)` → vista `fitxa` amb el CUPS → la fitxa carrega `sips_cache` (`/api/sips/supply`) i, si no hi ha dades o han caducat (TTL), consulta el portal (`/api/sips/refresh`) → gràfics i mòduls de cups2 → «Tornar a <client>» reobre el contracte · «Prepara l'oferta» obre el generador amb aquestes dades.

## 3. Model de dades unificat

`SipsCacheRow` (`src/energy/lib/sips-record.ts`) = taula `sips_cache` després de la migració 004:

- Clau `cups` = **base de 20 caràcters** (el CRM sol guardar el CUPS sense el sufix `0F`). `returned_cups` = CUPS complet del portal.
- `raw` (jsonb): les **97 columnes** originals; la fitxa es reconstrueix amb el mateix importador de cups2.
- Camps estructurats: consum anual, tarifa, adreça, CP, municipi, província, distribuïdora, comercialitzadora, tensió, P1–P6, 12 consums mensuals, 12 màximes mensuals, 12 reactives, màximes anual/BIE/APM, última lectura.
- `data_availability`: nivell (completa/parcial/mínima/sense) i comptadors de mesos.
- Procedència: `source` (`sips` | `excel`), `source_detail`, `consulted_at`, `attempts`, `next_retry_at`, `last_success_at`, `last_error_at`.
- **`null` = dada absent; 0 = valor real zero.** Els totals mensuals no es reparteixen mai en P1–P6.

`energy_type` (`luz`/`gas`) indica el tipus de punt. Fonts diferenciades a la interfície: **CRM** (Google Drive), **Manual** (`crm_state.consumoOverride`, `energy_inputs`), **SIPS** (portal), **Excel SIPS** (importació), **Calculat** (optimitzador, comparativa). Quan CRM i SIPS difereixen més d'un 15 %, el generador d'ofertes ho avisa i el comercial tria/edita el valor.

## 4. Seguretat i permisos

- Una sola autenticació (Supabase). Les credencials SIPS i la service role només existeixen al servidor.
- `sips_cache`, `energy_inputs` i `sips_audit` tenen RLS i **cap accés directe** des del navegador; el servidor les llegeix amb la service role **després** de comprovar el permís.
- CUPS d'un contracte visible (RLS de `contracts`): qualsevol usuari amb accés al contracte el pot consultar i actualitzar.
- Subministraments externs i cerca per adreça: només rols de `SIPS_EXTERNAL_ROLES` (per defecte, l'equip d'administració = política anterior).
- Límits per usuari i minut (`SIPS_RATE_*`) i registre de cada cerca/actualització/importació a `sips_audit`.
- Validació d'entrades (format de CUPS, CP de 5 xifres, mida de lots, valors numèrics).
- Validació d'entorn: sense `NEXT_PUBLIC_SUPABASE_*` les APIs responen 503 amb un missatge entenedor (s'evita l'error «Your project's URL and Key are required…»).

## 5. Sincronització automàtica SIPS

1. Google Drive → `contracts` (sense canvis).
2. Es seleccionen contractes de llum/dual **pendents o contactats** amb CUPS vàlid.
3. Si no tenen dades a `sips_cache` o han caducat (`SIPS_TTL_DAYS`, 7 per defecte) entren a la cua, primer els que no en tenen i després els més antics.
4. Es consulten en lots (`SIPS_CRON_LIMIT`), amb concurrència limitada (`SIPS_CONCURRENCY`) i un pressupost de temps dins dels 60 s de la funció.
5. Errors: es reintenta més tard amb espera creixent (24 h, 48 h… màx. 7 dies). **Un error no esborra mai les dades bones anteriors.**
6. El Kanban no espera mai el SIPS; les targetes mostren la dada quan arriba.
7. Botó manual «Enriqueix ara» a Configuració → Energia i SIPS (equip d'administració) i «Actualitza des del SIPS» a cada fitxa.

Un cron no garanteix l'hora exacta ni processa tota la base de dades en una sola execució: el sistema treballa per lots i completa la cartera en dies successius.

## 6. Gas

- Els CUPS de gas tenen el mateix format que els de llum (ES + 16 xifres + 2 lletres, amb o sense sufix): la validació els accepta tots dos.
- **Per CUPS** no es filtra el tipus d'energia: el mateix CUPS identifica el punt (llum o gas). **Per adreça** es tria «Llum i gas», «Llum» (per defecte, com abans) o «Gas», amb filtre de peatges RL.1–RL.11.
- `sips_cache.energy_type` (`luz` | `gas`) desa el tipus que retorna el SIPS (`TipoEnergia` 1/2).
- Fitxa de gas pròpia: consum anual, consum mensual, peatge, distribuïdora i comercialitzadora. S'amaguen el Power Optimizer, la reactiva i el comparador elèctric, i no es generen alertes de potència.
- Kanban, fitxa del contracte, generador d'ofertes (gas: energia €/kWh + terme fix €/dia) i enriquiment automàtic inclouen els contractes de gas.
- El portal fa servir els mateixos camps per a llum i gas en la llista de punts de subministrament. Si el portal té camps específics de gas (cabal, pressió…), es poden afegir sense tocar el codi amb `SIPS_EXTRA_COLUMNS`.

## 7. Migracions (no destructives)

Executa en ordre, al projecte **supabase-copper-ferry**: `001_init.sql`, `002_offer_ids_text.sql`, `003_roles.sql` (ja aplicades) i després:

- `004_sips_cache_enriquida.sql` — `ADD COLUMN IF NOT EXISTS` a `sips_cache`, validacions (`NOT VALID` per no bloquejar files antigues), índexs, RLS i revocació d'accés directe. No elimina ni recrea la taula.
- `005_energy_inputs_audit.sql` — taules `energy_inputs` i `sips_audit`.
- `006_comparatives_ia.sql` — mòdul Comparatives IA (catàleg de tarifes versionat, comparatives, lliuraments, portal de propostes, factures, comissions només admin) i buckets privats. Reversible amb `006_comparatives_ia_down.sql`. Detall a `COMPARATIVES_IA.md`.
- `007_correu_smtp.sql` — taula `mail_settings` (una sola fila) per configurar el correu corporatiu des de Configuració → Correu. Contrasenya xifrada (AES-256-GCM) pel servidor; sense accés des del navegador. Reversible amb `007_correu_smtp_down.sql`.
- `008_crm_clients360.sql` — CRM Fase 1: clients, contactes, subministraments, contractes amb historial, documents i versions, activitat, tasques, incidències i auditoria, amb RLS per rol, bucket privat `crm-documents` i vincle de les comparatives amb el client. Reversible amb `008_crm_clients360_down.sql`. Detall a `CRM_FASE1.md`.
- `009_crm_comercial.sql` — CRM Fase 2: leads, oportunitats amb versió (concurrència optimista), activitat i tasques vinculades a leads i oportunitats, regles d'automatització idempotents, avisos interns i objectius, amb RLS per rol i Realtime. Reversible amb `009_crm_comercial_down.sql`. Detall a `CRM_FASE2.md`.
- `010_crm_contractacio.sql` — CRM Fase 3: expedients de contractació amb transicions validades a la base de dades, condicions acceptades immutables, requisits documentals configurables, plantilles autoritzades i documents generats, sol·licituds i esdeveniments de signatura, historial immutable, referències externes, preparació de comissions i activació transaccional (contracte nou conservant l'anterior). Reversible amb `010_crm_contractacio_down.sql` (conserva els contractes). Detall a `CRM_FASE3.md`.
- `011_crm_economia.sql` — CRM Fase 4: regles de comissió versionades (dues capes), dades econòmiques per contracte, càlculs immutables, llibre de moviments només d'afegir amb claus d'idempotència, liquidacions (esborrany → revisió → aprovada → pagada) amb bloqueig i pagaments parcials, conciliació amb proveïdors i cobraments reals, costos, col·laboradors, objectius i auditoria financera, amb RLS per rol. Reversible amb `011_crm_economia_down.sql`. Detall a `CRM_FASE4.md`.

Si el codi es desplega abans de la migració 004, el servidor desa només les columnes antigues i continua funcionant.
