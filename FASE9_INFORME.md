# Fase 9 · Navegació, context i fitxa 360º — informe de lliurament

Branca: `feature/reclamacions-comercialitzadores` (no toca `main`). Migració nova: **019** (additiva, idempotent, amb `_down`).

## Què s'ha fet (per fases del PROMPT MESTRE)

| Fase | Canvi | On |
|---|---|---|
| 2 | Nom del client clicable al calaix de Renovacions (capçalera i «Titular») → fitxa 360º. Busca el client vinculat pel contracte o pel CUPS; si no n'hi ha, obre Clients 360° amb el nom cercat. Als titulars del punt de subministrament també. | `Navigation.tsx` (`RenewalClientLink`, `ClientLink`), `ContractDrawer.tsx` |
| 3 | CUPS clicable a tot arreu (calaix, subministraments i contractes de la fitxa, comparatives, reclamacions, conciliació, cercador) → **punt de subministrament**: adreça, tarifa, consum, contractes, **titulars al llarg del temps** i botons «Consultar SIPS» i «Fer comparativa». El sufix `0F` es normalitza (es compara pels 20 primers caràcters). | `SupplyPointModal`, `CupsLink`, `src/server/navigation.ts` |
| 4 | Botó **Enrere** global (i Alt+←) que respecta l'historial del navegador; sense historial va a una pantalla segura. Diàleg de **canvis sense desar**: Desa i surt · Surt sense desar · Cancel·la (també amb l'enrere del navegador i en tancar la pestanya). Aplicat a l'edició de clients i a la comparativa si no s'ha pogut desar. | `store.ts`, `Shell.tsx`, `LeaveDialog`, `ClientForm.tsx` |
| 5 | Es conserva el context en tornar: calaix obert i pestanya, punt de subministrament, desplaçament, filtres i pàgina de Clients, ordre i filtres de Cartera, quantitat de targetes per columna del Kanban. | `store.ts` (`captureCtx`), `useViewState.ts` |
| 6 | Comparativa → «Consulta el SIPS» → «Tornar a la comparativa» amb les dades intactes. **Importar dades del SIPS** amb comparació camp a camp: els valors introduïts a mà o de la factura no es marquen sols (mai no se sobreescriuen sense confirmar). | `Continuity.tsx`, `src/core/sips-diff.ts`, `suministro.tsx` |
| 7 | **Esborrany de comparativa desat automàticament al servidor** (1,5 s després de cada canvi i en sortir), amb indicador (Guardant… · Canvis guardats · Canvis pendents · Error de desament), detecció de conflictes per versió, oferta «Reprèn-la» en tornar al mateix contracte/client, i secció «Comparatives a mig fer» a la fitxa 360º. En emetre la proposta l'esborrany es tanca; «Comença de nou» el descarta (no s'esborra). | `Continuity.tsx`, `Wizard.tsx`, `/api/nav` |
| 8 | Cercador global: nom, NIF/CIF, CUPS, adreça, telèfon (només xifres), correu, contactes, representant legal, expedients, incidències, oportunitats, leads i col·laboradors. **Resultats agrupats per tipus** i NIF/NIE de persones emmascarats. Cada resultat obre la pantalla que toca (abans, alguns tipus obrien una fitxa equivocada). | `Shell.tsx`, `src/server/crm.ts` |
| 9 | Ruta de navegació (breadcrumbs) sota el títol, amb el nom real del client; simplificada al mòbil. | `Breadcrumbs` |
| 10 | Accions ràpides: al calaix (Punt de subministrament, Consultar SIPS, Fer comparativa, Crear tasca, Documents) i a la fitxa 360º (+Tasca, +Incidència, +Document, SIPS, Comparatives). | `ContractDrawer.tsx`, `ClientDetail.tsx` |
| 11 | **Consultats recentment** (icona del rellotge a la capçalera): clients, contractes i punts de subministrament de cada usuari (només els seus, màx. 50). | `RecentMenu`, taula `user_recent_records` |
| 12 | Empreses: **persona de contacte habitual (amb càrrec)** separada del **representant legal** (nom, DNI/NIE validat, càrrec) i casella «El contacte habitual també és el representant legal». Dues seccions a la fitxa. El DNI/NIE només el veu sencer qui té permís de dades sensibles; un DNI ocult no s'esborra en desar. | `ClientForm.tsx`, `ClientDetail.tsx`, `src/core/crm.ts`, `src/server/crm.ts` |
| 13 | Capçalera de la fitxa 360º amb comptadors reals: contractes actius, renovacions pendents, incidències obertes i comparatives en curs (clicables). | `ClientDetail.tsx`, `getClient` |
| 14 | Migració 019 amb RLS (vegeu sota). Cap dada eliminada. | `supabase/migrations/019_*` |

Sense la 019 aplicada el CRM continua funcionant: els camps nous s'ignoren i els esborranys/recents avisen que falta la migració.

## Base de dades (019)
- `crm_clients`: `contact_role`, `legal_rep_name`, `legal_rep_tax_id` (format DNI/NIE), `legal_rep_role`, `contact_is_legal_rep`.
- `comparison_drafts`: un esborrany obert per persona i context; versió per a conflictes; RLS: col·laboradors mai; l'autor, Direcció/Administració i qui pot veure el client. Sense DELETE.
- `user_recent_records`: cada usuari només veu i toca els seus.

## Proves
| Prova | Tipus | Resultat |
|---|---|---|
| `npm run typecheck`, `lint` (0 errors), `test` (641 proves), `build` | Codi | OK |
| `tests/db/navegacio-rls.test.ts` (6): RLS de 019 sobre Postgres (PGlite) amb els rols reals | **Provat de debò** sobre la base de dades local de proves (no el Supabase real) | OK |
| `tests/navegacio.test.ts` (14): CUPS/0F, context dels esborranys, comparació SIPS, representant legal i emmascarament, Enrere, diàleg de canvis sense desar | Lògica | OK |
| `e2e/navegacio.e2e.cjs` (Playwright, 7 recorreguts): 1 nom→360º→Enrere amb el calaix obert · 2 CUPS→titulars→fitxa · 3 filtres conservats · 4 diàleg de canvis sense desar · 5 comparativa→SIPS→tornar + importació · 6 esborrany automàtic i reprendre · 7 cercador agrupat | **Provat amb simulació** (navegador real, però totes les respostes de `/api` són inventades) | 7/7 OK |

**No s'ha provat de debò** contra el Supabase real ni amb dades reals: cal fer-ho després d'aplicar la 019 (vegeu «Com provar-ho»).

## Com provar-ho (després de pujar-ho i aplicar la 019)
1. Kanban → obre un contracte → clica el nom del client → fitxa 360º → «Enrere»: tornes al Kanban amb el calaix obert.
2. Clica un CUPS → apareix el punt de subministrament amb els titulars.
3. Fitxa d'una empresa → Edita → Contacte: omple el representant legal. Canvia alguna cosa i prem «Enrere» sense desar: surt el diàleg.
4. Nova comparativa des d'un contracte → tria un mode → mira «Canvis guardats» → surt i torna a entrar: et proposa reprendre-la.
5. Cerca un telèfon o un CUPS al cercador de dalt: resultats agrupats.

## Pendent
- Proves reals amb Supabase després d'aplicar la 019.
- Integracions externes (SIPS, SMTP, WhatsApp, signatura) segueixen sense credencials: el botó «Consultar SIPS» només retornarà dades quan el SIPS estigui configurat.
- Millores de la llista prèvia encara pendents: botó de tancar sessió, canvi de contrasenya, «€/MWh» als avisos i les dues crides a l'API.
