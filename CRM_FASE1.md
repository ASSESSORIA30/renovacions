# CRM Assessoria 3.0 · Fase 1 — Clients 360°, gestor documental i base de dades centralitzada

Branca: `feature/crm-fase1-clients360` (sobre `feature/comparatives-ia`). No s'ha integrat a `main`.

## 1. Anàlisi prèvia (punt de partida)

| Element | Estat abans de la fase 1 |
|---|---|
| Stack | Next.js 15 (App Router), React 19, TypeScript estricte, Tailwind 3, Supabase (Auth + Postgres + Storage), Vercel |
| Autenticació | Supabase Auth amb `@supabase/ssr` (cookies). Una sola autenticació; es manté |
| Rols | `profiles.role`: admin, cap_administrativa, administrativa, comercial, colaborador (migració 003) |
| Dades de clients | No hi havia entitat «client». Cada fila de `contracts` (sincronitzada de l'Excel) barreja client, CUPS i contracte |
| Renovacions | Kanban, calendari, dashboard i pla d'avui llegeixen `contracts` + `crm_state` (estat propi del CRM) |
| Documents | Taula `documents` + bucket `documents`: només PDF de propostes per contracte |
| Activitat/tasques | `activities` i `tasks` per contracte (identificador text de l'Excel) |
| Mòduls reals | SIPS, anàlisi energètica, comparatives IA, catàleg de tarifes, correu SMTP configurable |

Decisió: **el CRM nou no substitueix res**. Es creen taules noves (`crm_*`) amb el client com a entitat central i s'enllacen
amb el que ja existeix (`contracts` de renovacions, `comparisons`, SIPS). Excel queda com a importació opcional.

## 2. Model de dades (migració `008_crm_clients360.sql`)

```
crm_clients ──< crm_contacts
     │  ├──< crm_client_assignments (accés compartit)
     │  ├──< crm_supplies (CUPS) ──< crm_contracts (historial; previous_contract_id) ── crm_contract_finance
     │  ├──< crm_documents ──< crm_document_versions          (bucket privat crm-documents)
     │  ├──< crm_activities      ├──< crm_tasks      ├──< crm_incidents
     │  └──< comparisons.crm_client_id (mòdul existent)
crm_audit_events (qui ha fet què: només noms de camps, mai valors)
vista crm_clients_list (security_invoker: respecta la RLS) per al llistat paginat
```

- **El CUPS identifica el punt** (únic entre subministraments actius, per als 20 primers caràcters); els contractes s'hi
  enllacen al llarg del temps. Una renovació crea un contracte nou amb `previous_contract_id`: l'historial no es sobreescriu.
- NIF/CIF únic entre clients no arxivats. Una mateixa persona pot ser contacte de diverses empreses.
- Clients i subministraments no s'esborren: s'arxiven (`archived_at`).
- Normalització al servidor: NIF/NIE/CIF (amb dígit de control), telèfons (+34…), correus, CUPS, província pel codi postal.
- Migració **additiva i idempotent**. Reversible amb `008_crm_clients360_down.sql` (elimina les dades del CRM nou; no toca `contracts`).

## 3. Permisos (validats a la base de dades amb RLS i, a més, a l'API)

| | Direcció (admin) | Administració | Comercial | Col·laborador |
|---|---|---|---|---|
| Veure clients | Tots | Tots | Propis (propietari) + compartits | Aportats per ell + compartits |
| Crear clients | Sí | Sí | Sí (queda com a propietari) | Sí (com a potencial, l'assigna Administració) |
| Editar client, contactes, CUPS, contractes | Sí | Sí | Propis i compartits com a comercial/suport | No |
| Reassignar comercial, compartir, arxivar | Sí | Sí | No | No |
| Activitat i notes | Sí | Sí | Sí | Sí (als clients que veu) |
| Documents DNI/NIE i bancaris | Sí | Sí | Només com a propietari | No |
| Eliminar documents | Sí (si no tenen conservació obligatòria) | Sí (ídem) | No | No |
| Comissions del contracte | Veure i editar | Veure i editar | Veure les seves | No |

- Canviar l'identificador a l'URL o a l'API no dona accés: les consultes es fan amb la sessió de l'usuari i la RLS filtra.
  Una fitxa sense permís respon «no existeix o no tens permís» (no es revela si existeix).
- El client de servei (service role) només s'usa al servidor per a: duplicats globals sense revelar dades, auditoria,
  publicació a Renovacions, URL signades d'Storage i la importació inicial (només Administració).

## 4. Gestor documental

- Bucket **privat** `crm-documents` sense polítiques per a usuaris: només hi accedeix el servidor.
- Pujada: el servidor comprova permisos, tipus i mida i **fixa la ruta** (`<client>/<document>/v<n>-<uuid>.<ext>`);
  retorna una URL de pujada d'un sol ús i un tiquet signat (HMAC). El fitxer va directament a Storage (sense el límit de 4,5 MB de Vercel).
  En finalitzar, el servidor descarrega el fitxer i comprova el **contingut real** (bytes màgics; per a DOCX/XLSX, l'estructura
  interna del ZIP i que no tingui macros), la mida i l'empremta SHA-256. Si falla, s'esborra.
- Descàrrega i vista prèvia: URL signada de **60 s**, generada després de comprovar l'accés; cada visualització i descàrrega queda auditada.
- Versions (cada versió es conserva), reclassificació, vincle a CUPS o contracte, arxiu.
- Conservació: contractes signats i mandats, 6 anys (Codi de Comerç, art. 30): es poden arxivar però no eliminar (ho impedeix la base de dades).
- Tipus: PDF, JPG/JPEG, PNG, WebP, DOCX, XLSX. Configurable: `CRM_DOCS_EXTRA_TYPES` (heic, tif, tiff, doc, xls, csv, txt, eml, msg, zip, odt, ods) i `CRM_DOCS_MAX_MB` (per defecte 25, màxim 50).

## 5. Integració amb els mòduls existents

| Integració | Estat |
|---|---|
| Cercador global (Ctrl K) | Busca clients (nom, NIF/CIF, telèfon, correu, població) i CUPS al servidor, a més dels contractes de renovacions |
| Subministrament → Anàlisi energètica | Botó a cada CUPS (mòdul SIPS existent) |
| Alta de CUPS amb el SIPS | Opcional («Omple amb el SIPS»); tot es pot introduir a mà |
| Client/CUPS → Comparativa IA | La comparativa es pre-omple, queda vinculada al client i surt a la pestanya Comparatives |
| PDF de comparativa → Documents | En generar el PDF d'una comparativa vinculada, es desa a Documents → Proposta comercial |
| Contracte del CRM → Renovacions | Un contracte actiu amb data de renovació es publica a `contracts` (id `crm:<uuid>`): surt al Kanban, calendari i dashboard. Si ja hi ha el mateix CUPS a l'Excel, s'enllaça (`legacy_contract_id`) i no es duplica. La sincronització de l'Excel mai els marca com a desapareguts |
| Pla d'avui | Mostra les tasques de clients assignades a l'usuari |
| Importació de la cartera | «Importa la cartera» (Administració): crea clients, CUPS i contractes a partir dels contractes de Renovacions. Simulació prèvia; idempotent |

Pendent per a fases posteriors (interfície preparada): que un canvi d'estat al Kanban de renovacions actualitzi el contracte del CRM
(ara el vincle és CRM → Renovacions); gestor complet d'incidències (la taula `crm_incidents` ja existeix amb un registre bàsic).

## 6. API

| Ruta | Mètode | Ús |
|---|---|---|
| `/api/crm/clients` | GET | Llistat paginat (q, status, owner, city, province, sector, service, sort, page, size); `?facets=1`; `?check=1` (duplicats) |
| `/api/crm/clients` | POST | Alta de client |
| `/api/crm/clients/[id]` | GET / PATCH | Fitxa completa / edició |
| `/api/crm/action` | POST | `{entity: contact | supply | contract | activity | task | incident | assignment | bulk, action, …}` |
| `/api/crm/documents` | GET / POST | URL signada (`?id`) i límits / `step: request | finalize | action` |
| `/api/crm/search` | GET | Cercador global |
| `/api/crm/tasks` | GET | Tasques pendents de l'usuari |
| `/api/crm/import` | POST | Importació de la cartera (`dryRun`) |

## 7. Variables d'entorn

No n'hi ha cap d'obligatòria nova. Opcionals: `CRM_DOCS_MAX_MB`, `CRM_DOCS_EXTRA_TYPES`. Es mantenen totes les existents
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SETTINGS_ENCRYPTION_KEY` opcional, etc.).

## 8. Desplegament a Vercel

1. Supabase → SQL Editor: executa el contingut de `supabase/migrations/008_crm_clients360.sql` (ha de sortir «Success»).
   Crea també el bucket privat `crm-documents`.
2. Puja el codi a GitHub (branca `feature/crm-fase1-clients360`) i obre una **Preview** a Vercel. No publiquis a producció fins a validar-la.
3. A la Preview, fes el recorregut de la secció 9 amb usuaris reals de diferents rols.
4. Opcional: Clients → «Importa la cartera» (Administració) per crear els clients a partir dels contractes actuals.
5. Quan tot estigui validat, fusiona a `main`.

## 9. Recorregut d'acceptació (per validar a la Preview)

1. Inicia sessió → Clients → Nou client (dades fiscals i comercials).
2. Afegeix dos contactes (Resum → Contactes).
3. Subministraments: tres CUPS diferents (llum i gas).
4. Documents: arrossega una factura i un contracte; previsualitza'ls i descarrega'ls.
5. Activitat: registra una trucada i una tasca de seguiment.
6. Contractes: crea'n un actiu amb data de renovació (apareix a Renovacions en recarregar).
7. Tanca la sessió i torna a entrar: tot hi ha de ser.
8. Un segon usuari amb accés (Administració o comercial a qui s'ha compartit) consulta la fitxa.
9. Un comercial sense accés obre l'URL de la fitxa: ha de veure «No pots veure aquest client».
10. Comprova Renovacions, SIPS, Comparatives i Pla d'avui.
