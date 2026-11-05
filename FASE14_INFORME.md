# Fase 14 · Auditor de comissions: conciliació de doble sentit

Branca: `feature/fase14-auditor-comissions` (surt de `main`, commit «FASE 12»).
Data: 3 de novembre de 2026.

> **Com s'ha provat.**
> - **Provat de debò:** el lector, amb els Excel reals de Gana (`75368.xlsx`) i de Niba (`Liquidacion_Septiembre2026…xlsx`), en local. Els fitxers reals **no** s'han posat al repositori perquè contenen CUPS de clients.
> - **Proves automàtiques:** fan servir còpies anonimitzades, amb la mateixa estructura i els mateixos imports però amb CUPS inventats.
> - **Base de dades:** provada sobre PostgreSQL local (PGlite) amb les migracions 001–025.
> - **Pantalles:** provades al navegador amb un servidor simulat.
> - **No s'ha provat res contra el Supabase real ni s'ha enviat cap correu real.**

## 1. Què fa

Funciona en dues direccions:

| Direcció | Què comprova |
|---|---|
| **Del CRM cap a la comercialitzadora** | Busca els contractes amb dret a comissió (altes i renovacions) i calcula la comissió prevista amb les regles aprovades. Calcula fins quan s'havia de liquidar: activació + termini de pagament aprovat + ajornament contractual. Després la busca a les liquidacions importades i diu si hi és, si falta, si ha arribat per sota o si ha arribat tard. |
| **De la comercialitzadora cap al CRM** | Revisa cada línia rebuda: busca el contracte, comprova l'import i detecta duplicats, línies sense contracte, coincidències amb diversos contractes, retrocomissions i regularitzacions. |

**Quatre estats separats per a cada comissió.** El CRM mostra quatre imports: **prevista**, **liquidada**, **cobrada** i **reclamada**.
- «Cobrada» només surt d'un cobrament bancari confirmat a Conciliació.
- La base de dades no deixa registrar un cobrament sense rebut bancari, i això ja era així des de la 011.

**Les set alertes.** Es veuen a la pantalla i, si estan activades, s'avisen cada dia amb la tasca programada:

| Alerta | Quan salta |
|---|---|
| Comissió pendent de liquidar | Ha passat el termini i la comissió no apareix a cap liquidació. |
| Comissió liquidada per un import inferior | La comercialitzadora ha liquidat menys del que diu la regla aprovada. |
| Comissió cobrada parcialment | El banc ha pagat menys del que s'ha liquidat. |
| Retrocomissió inesperada | No hi ha regla aprovada, està fora del període de risc, és superior a la permesa o el contracte no té cap comissió liquidada. |
| Liquidació duplicada | El mateix moviment surt en més d'una liquidació. |
| Comissió que no correspon a cap contracte | La línia no té contracte, o en té diversos de possibles. |
| Contracte pendent de cobrament fora de termini | La comissió està liquidada però no s'ha cobrat al cap de X dies (30 per defecte). |

**Reclamacions.**
- El botó **«Generar reclamació a comercialitzadora»** agafa totes les discrepàncies reclamables d'una comercialitzadora, o només les que triïs, i en fa una sola reclamació.
- La reclamació inclou un PDF i un esborrany de correu amb: els CUPS, les referències, els imports previstos i liquidats, la diferència i la justificació de cada línia (regla aprovada i clàusula).
- **Cap reclamació no es pot enviar sense autorització**, ni pel CRM ni registrant-la com a enviada fora. Les condicions són:
  - **Qui l'autoritza.** Direcció, o qui tingui permís d'aprovació a Economia.
  - **Qui no la pot autoritzar.** La persona que l'ha preparada, tret que sigui Direcció.
  - **Què s'envia.** Exactament el correu que s'ha autoritzat.
  - **Si es canvia.** Si algú modifica el correu, el destinatari o les diferències, l'autorització s'anul·la.

  Ho comprova el servidor i també la base de dades.
- **Sobre la IA.** El text de la justificació el prepara el motor local, sense IA. L'opció «Per què?» amb IA (Fase 8.2) continua igual: només funciona amb la clau d'IA i amb les garanties de confidencialitat registrades.

## 2. Lector de liquidacions (dins de Conciliació)

**Com llegeix.**
- Llegeix **totes les pestanyes** de l'Excel o el CSV i en mostra la previsualització abans d'importar.
- Detecta la comercialitzadora sola i fa servir les regles de lectura que corresponen a cadascuna:
  - **Gana Energía:** una pestanya per a cada tipus de moviment.
  - **Niba:** una sola pestanya, amb la columna TIPO.
  - **Altres comercialitzadores:** lector genèric que busca les capçaleres.

**Resultat amb els Excel reals**

| Document | Pestanyes | Moviments | Net | Subtotals |
|---|---:|---:|---:|---|
| Gana `75368.xlsx` | 8 | 86 | 2.011,25 € | Les 8 quadren amb la fila TOTAL |
| Niba Setembre 2026 | 1 | 31 | 2.792,00 € | 27 altes de llum (2.800 €), 2 de gas (120 €), baixa de llum −80 € i baixa de gas −48 € |
| **Total** | | **117** | **4.803,25 €** | Comprovació matemàtica. No són diners cobrats. |

**Regles que aplica**

| Cas | Com es tracta |
|---|---|
| Fila TOTAL | No s'importa. Serveix per comprovar el subtotal de la pestanya. |
| «Clientes Activos» | S'importa el total de la fila: 118 kWh × 0,01 € = 1,18 €. No s'importa el 0,01. |
| Renovació negativa | Es registra com a regularització lligada a la renovació. |
| Import zero | Es conserva com a moviment, però no genera cap cobrament. |
| Estats «Ojo se va» i «Suspendido» | Es conserven i es mostren com a avís. |

**Ho guarda tot.**
- El nom del document, la pestanya i la fila de cada moviment.
- Les dates d'alta, d'activació, de baixa i de factura, cadascuna per separat.

**Evita duplicats.**
- No deixa importar dues vegades el mateix fitxer.
- Detecta el mateix moviment en dues liquidacions diferents.
- Les renovacions de l'any següent no es prenen per duplicats.
- Si la comercialitzadora envia una liquidació rectificativa, la relaciona amb l'original.

**Avisa de canvis de format.** Si una comercialitzadora canvia l'estructura de l'Excel, el CRM ho diu abans d'importar.

**Vincula cada línia amb el seu contracte**

| Nivell de confiança | Què fa el CRM |
|---|---|
| Inequívoca | Hi ha un sol contracte possible. La vincula sola. |
| Probable | Proposa un contracte i cal confirmar-lo. |
| Diversos | Hi ha més d'un contracte possible. Cal triar-ne un. |
| Cap | No troba cap contracte. |

L'ordre de cerca és:
1. La referència de la comercialitzadora.
2. El CUPS, amb el sufix 0F o sense, però mai retallant caràcters a cegues.
3. La comercialitzadora.
4. Si és una alta o una renovació.
5. Les dates.
6. El producte.

**Cobrament net.** Amb **«Confirmar cobrament de la liquidació»**, les retrocomissions de la mateixa liquidació compensen les comissions.
- Cada repartiment queda registrat i no es pot esborrar.
- Les línies sense contracte no es marquen mai com a cobrades.

**Format pendent.** Els PDF de liquidació encara no es llegeixen sols i s'han d'entrar a mà.

## 3. Fitxa econòmica del contracte

- **Historial de comissions:** els quatre estats, el pendent de cobrament i cada liquidació, amb el document, la pestanya i la fila d'origen, la data de cobrament i la reclamació, si n'hi ha.
- **Ajornament:** camp nou «Liquidació ajornada fins a», amb el motiu. Mentre duri, aquella comissió no surt com a pendent ni es pot reclamar.

## 4. Migració `025_auditor_comissions.sql`

És additiva i idempotent, i té el seu `_down`. Necessita la 011, la 014 i la 018.

| Canvi | Detall |
|---|---|
| Liquidacions | Columnes noves per a l'empremta del fitxer, el format, la signatura, el resum de la lectura, la liquidació rectificativa i el cobrament net. Es bloqueja importar dues vegades el mateix fitxer. |
| Línies | Pestanya, fila, tipus de moviment, energia, producte, dates, estat del document, kWh × €/kWh, clau estable, avisos i motiu i candidats de la vinculació. |
| `fin_receipt_allocations` | Taula nova. Guarda com es reparteix cada cobrament (diners o compensació). No es pot modificar ni esborrar. |
| `fin_register_receipt_net()` | Funció nova per registrar el cobrament net. |
| `fin_contract_economics` | Ajornament de la liquidació. |
| `fin_claims` | Autorització obligatòria abans d'enviar (dos disparadors nous). |
| Alertes | Les set alertes `audit_*`. |

**Comprovació final:** ha de retornar `6 · 15 · 1 · 1 · 3 · 2 · 7`.

**Desfer:** el `_down` treu l'obligació d'autoritzar i la funció nova, i desactiva les alertes. Conserva les dades i l'historial de cobraments.

## 5. Fitxers

| Tipus | Fitxers |
|---|---|
| **Nous** | `src/core/settlement-reader.ts` (lector) · `src/core/commission-audit.ts` (motor de l'auditor) · `src/server/commission-audit.ts` · `src/ui/views/finance/Auditor.tsx` · `supabase/migrations/025_auditor_comissions.sql` i `_down.sql` · `tests/liquidacions-lector.test.ts` · `tests/liquidacions-servidor.test.ts` · `tests/auditor-comissions.test.ts` · `tests/db/auditor-comissions-rls.test.ts` · `tests/fixtures/liquidacions/*` (anonimitzats) · `e2e/auditor.e2e.cjs` i `e2e/auditor/*.json` · `scripts/e2e-auditor-fixtures.ts` |
| **Modificats** | `src/server/finance.ts` (importació, vinculació, cobrament net, historial i ajornament) · `src/server/claims.ts` (autorització i comprovació del correu autoritzat) · `src/server/automations.ts` · `app/api/finance/route.ts` · `app/api/claims/route.ts` · `src/ui/views/finance/Reconciliation.tsx` · `Claims.tsx` · `ContractEconomics.tsx` · `api.ts` · menú (`nav.ts`, `store.ts`, `App.tsx`, `Navigation.tsx`) · `tests/reclamacions.test.ts` |

## 6. Proves

| Prova | Tipus | Resultat |
|---|---|---|
| `tests/liquidacions-lector.test.ts` | Excel de Gana i de Niba (anonimitzats) | 24 correctes |
| `tests/liquidacions-servidor.test.ts` | Importació i vinculació, Supabase simulat | 6 correctes |
| `tests/auditor-comissions.test.ts` | Motor de l'auditor i cobrament net | 19 correctes |
| `tests/db/auditor-comissions-rls.test.ts` | PostgreSQL local: 025, permisos, cobrament net, autorització, aplicar-la dues vegades i `_down` | 16 correctes |
| `e2e/auditor.e2e.cjs` | Navegador, servidor simulat | 5 de 5 |
| `npm run typecheck` | | Correcte |
| `npm run lint` | | 0 errors i 4 avisos que ja hi eren |
| `npm run test` | | 824 proves en 54 fitxers, totes correctes |
| `npm run build` | | Correcte, amb l'avís de `unpdf` que ja hi era |

## 7. Pendent

**Configuració al CRM**
- **Supabase real.** Aplicar la 025, i abans la 019–024 si encara no hi són. Després, provar-ho a la Preview de Vercel.
- **Regles de la capa proveïdor de Gana i Niba.** Cal que estiguin aprovades. Sense regla, el CRM sap què s'ha liquidat, però no ho pot comparar amb res ni reclamar-ho.
- **Termini de pagament de cada comercialitzadora.** Cal registrar-lo i aprovar-lo. Sense termini, l'alerta fa servir 90 dies per defecte i ho indica.
- **Permís d'aprovació a Economia.** Cal donar-lo a qui hagi d'autoritzar reclamacions, a més de Direcció.

**Funcions que falten**
- **PDF i OCR de liquidacions.** El lector és per a Excel i CSV.
- **Plantilles editables per a liquidacions noves.** Ara mateix el coneixement de Gana i Niba és al codi, i les altres comercialitzadores es llegeixen per capçaleres.
