# Agrupació de renovacions per contacte · «Altres contractes del mateix contacte» · «Contactar tots»

Branca proposada: `feature/agrupacio-renovacions-contacte` (sobre `main`, que ja arriba a la migració 028).
Migració nova: **029_agrupacio_contactes.sql** (amb el seu `_down`). Additiva i idempotent: no esborra res.

## Auditoria prèvia (què ja existia i s'ha reutilitzat)

| Necessitat | Reutilitzat | Afegit |
|---|---|---|
| Contractes del Kanban | `contracts` + `crm_state`, `useKanbanColumns`, `ContractCard`, dnd-kit, 4 estats | Cap còpia: els grups són llistes d'identificadors calculades |
| Persona de contacte | `contracts.data` (telèfon, correu, representant) i `crm_contacts` de Clients 360° | `crm_contact_clients`: una persona relacionada amb altres clients sense fusionar fitxes |
| Històric | `activities` (una activitat per contracte, amb `meta.groupOpId`) | `renewal_group_ops`: una sola operació vinculada a diversos contractes |
| Correu | correu corporatiu (`sendCorporateMail`) o correu propi (`sendFromMyMailbox`) | — |
| WhatsApp | enllaç wa.me i Cloud API (lògica extreta a `sendCloudText`, sense canviar-ne el comportament) | — |
| Propostes | `documents` + Storage + `ProposalWizard` | Enllaços segurs temporals (7 dies) per WhatsApp |
| Tasques i tancaments | `saveTask`, `move`, `CloseDialog` | Cua de tancaments per a moviments de grup |
| Permisos | RLS `can_see` / `contract_visible`, `crm_can_see_client` | `can_see_all`, `holder_visible`, `is_internal` |

## Peces noves

- `src/core/contact-groups.ts` — normalització (telèfon, correu, nom), coincidències confirmades / probables / ambigües, unir i separar, finestra de proximitat (7–90 dies, 30 per defecte), targetes del Kanban, resum del grup, avís intel·ligent i missatge conjunt.
- `src/server/contact-groups.ts` + `app/api/renewals/groups` — dades per als grups, unir/separar, activitat conjunta, comprovacions prèvies i enviament de «Contactar tots», autoritzacions i relacions persona ↔ client.
- Interfície: `GroupCard`, `groups/GroupPanel`, `groups/GroupMoveDialog`, `groups/ContactAllPanel`, `groups/RelatedPanel`, `views/crm/ContactRelations`; canvis a `Kanban`, `ContractDrawer`, `ClientDetail`, `Overlays`, `Ajustes`, `store`, `selectors`.

## Regles de seguretat

- Els grups es calculen només amb els contractes que la RLS deixa veure a l'usuari: cap comptador, avís ni grup revela contractes inaccessibles.
- Cap operació conjunta pot incloure un contracte que l'usuari no vegi (servidor + RLS `can_see_all`); el missatge d'error no diu quin.
- Contractes de titulars diferents: cal una autorització registrada del destinatari per a cada titular (o una relació autoritzada a Clients 360°).
- Es respecten l'oposició a comunicacions comercials i la preferència «no contactar» dels clients vinculats.
- Idempotència: identificador d'operació generat al navegador; un segon clic o un reintent no torna a enviar.
- Avís de duplicat (mateix canal, destinatari i contractes) amb la data de l'últim enviament; cal confirmar el reenviament.
- Res no es marca com a renovat ni com a contactat automàticament. Un enviament fallit queda com a error.

## Proves

- `tests/agrupacio-contactes.test.ts` (26) · lògica pura: proves 1–8, 11, 14 (10.000 contractes) i 15.
- `tests/agrupacio-servidor.test.ts` (17) · «Contactar tots» i activitat conjunta amb Supabase **simulat**; SMTP i WhatsApp **simulats**.
- `tests/db/agrupacio-rls.test.ts` (12) · RLS sobre PostgreSQL real (PGlite): proves 10, 12, 13 i idempotència / `_down`.
- `npm run typecheck`, `npm run test` (1007 proves), `npm run lint` (0 errors) i `npm run build`: correctes.

Cap integració externa s'ha provat de debò: correu i WhatsApp només s'han provat amb simulació.
