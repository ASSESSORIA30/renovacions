# CRM · Fase 4: control econòmic, comissions i liquidacions

Aquesta fase porta el control econòmic de cada contracte a Supabase, sense Excel. També hi ha la liquidació de comissions a comercials i col·laboradors, la conciliació amb les comercialitzadores i la rendibilitat.

## Què existia abans (auditoria) i com s'ha reutilitzat

| Element existent | Ús a la Fase 4 |
|---|---|
| `offer_commissions` (migració 006): marges per producte del catàleg, només per a admin | Es manté sense canvis (pantalla «Marges i comissions»). El motor nou **no** l'utilitza automàticament perquè barreja estimacions per oferta; les condicions reals es configuren com a regles. |
| `crm_contract_finance` (Fase 1): camps manuals per contracte | Es manté. Es mostra com a referència històrica. |
| `crm_commission_records` (Fase 3): estat de la comissió de cada expedient | Es **sincronitza automàticament** amb els moviments reals: meritada, cobrada, parcial i anul·lada. |
| `crm_targets` (Fase 2): objectius mensuals per comercial | Es llegeix al rànquing. Els objectius nous per equip i per producte van a `fin_targets`. |
| Motor d'automatitzacions (fases 2 i 3) | S'hi han afegit 8 regles d'alertes econòmiques. |

## Dues capes que no es barregen

- **A · Proveïdor → Assessoria 3.0:** el que ha de pagar la comercialitzadora. Té quatre estats: estimat, meritat, confirmat (comunicat a la liquidació del proveïdor) i cobrat (cobrament bancari registrat per Administració).
- **B · Assessoria 3.0 → comercial / col·laborador:** el que es paga a l'equip.

Cada regla pertany a una sola capa, i el motor no aplica mai la regla d'una capa a l'altra. El percentatge sobre la comissió rebuda (capa B) fa servir l'import de la capa A, però ho indica explícitament al desglossament.

**Regles inicials (secció 5 del prompt).** S'han carregat com a **capa B** (pagaments a l'equip comercial) i **pendents d'aprovació**: residencial 15/10 €, Nufri Fuji/Golden/Gala/Galaxy/Royal, Novaluz 12,5 %, Iberdrola 12,5 % (amb la base pendent), incentius residencials, Fibra O2, Pimes i SEGURMA. **Direcció ha de confirmar aquesta interpretació.** No s'ha creat cap regla de capa A amb imports inventats: s'han d'introduir amb els acords reals de cada comercialitzadora.

## Motor de comissions (`src/core/commissions.ts`)

- **Càlcul exacte:** aritmètica decimal (decimal.js-light). Els imports es guarden com a `NUMERIC(14,2)` i els preus com a `NUMERIC(14,6)`. L'arrodoniment a cèntims es fa una sola vegada al final de cada import, cap amunt quan cau al mig.
- **Tipus de regla:**
  - import fix per contracte;
  - €/MWh;
  - % sobre marge o valor afegit;
  - % sobre l'increment de preu;
  - % sobre la comissió rebuda;
  - trams;
  - bonificació;
  - regularització;
  - retrocessió.
- **Regla aplicable:** és la més específica (beneficiari > producte > comercialitzadora > segment > servei) dins la vigència i en la versió més recent.
  - Dues regles igual d'específiques es marquen com a **conflicte** i no se'n tria cap a l'atzar.
  - Si només hi ha una regla pendent d'aprovació, el resultat és una **simulació** i no compta com a estimat definitiu.
- **Percentatges:**
  - Sense una base validada, el càlcul queda **«Pendent de configuració»** (és el cas d'Iberdrola).
  - Si falten dades (per exemple, l'increment pactat a Novaluz), queda «Pendent de dades». No s'aplica mai el 12,5 % al preu ni al consum directament.
- **Fórmula de Novaluz:** valor afegit = increment €/kWh × kWh elegibles + increment €/kW·dia × kW contractats × dies del període. La comissió és el 12,5 % d'aquest valor afegit.
- **Trams:** per defecte només s'aplica el **tram més alt** assolit. Es pot configurar si es compten els contractes signats, activats o meritats, i es poden comptar contractes o MWh. L'incentiu només registra la diferència respecte del que ja s'ha comptabilitzat, de manera que mai es duplica.
- **Desglossament:** cada càlcul el guarda amb **l'origen de cada dada** (fitxa econòmica, subministrament, regla…) i amb la versió de la regla aplicada.

## Model de dades (`011_crm_economia.sql`)

| Taula | Ús |
|---|---|
| `fin_rules` | Regles (una fila per versió). Les aprovades són immutables: modificar-les crea una versió nova, i l'anterior es tanca. |
| `fin_contract_economics` | Entrades del càlcul per contracte: segment, modalitat, MWh elegibles, increments pactats, període i anul·lació o penalització |
| `fin_calculations` | Instantànies immutables de cada càlcul, amb el desglossament |
| `fin_ledger` | **Llibre de moviments, només d'afegir.** Hi entren meritacions, confirmacions, facturacions, cobraments, bonificacions, ajustaments, regularitzacions, retrocessions i anul·lacions. Cada moviment té una clau d'idempotència única. |
| `fin_settlements`, `fin_settlement_lines` i `fin_payments` | Liquidacions, les seves línies (un moviment només es pot liquidar una vegada) i els pagaments |
| `fin_provider_statements`, `fin_statement_lines` i `fin_provider_receipts` | Liquidacions rebudes dels proveïdors (amb l'import comunicat) i els cobraments reals |
| `fin_costs` | Costos directes registrats (no se n'inventa cap) |
| `fin_collaborator_terms` | Fitxa i condicions comercials de cada col·laborador |
| `fin_targets` | Objectius per comercial, per equip i per producte |
| `fin_audit` | Auditoria financera amb l'autor i l'import de cada acció. Només s'hi pot afegir. |

**Operacions transaccionals:**
- `fin_build_settlement`: prepara una liquidació amb tots els moviments pendents.
- `fin_refresh_settlement`: recalcula els totals d'una liquidació.
- `fin_register_receipt`: registra un cobrament i l'assigna per ordre a les línies conciliades.

**Reversió:** `011_crm_economia_down.sql`. No toca les taules de les fases anteriors.

## Garanties a la base de dades (provades a PostgreSQL)

- **Regles:** les aprovades no es modifiquen i només les aprova Direcció. Un percentatge no es pot aprovar sense la base validada.
- **Càlculs, moviments, pagaments i auditoria:** no es poden modificar ni esborrar. Les correccions sempre es fan amb moviments nous.
- **Liquidacions:**
  - Només Direcció les aprova, i **ningú pot aprovar la seva pròpia**.
  - En aprovar-les, els imports i les línies queden **bloquejats**.
  - No poden tornar enrere ni es poden eliminar un cop aprovades.
- **Pagaments:**
  - Es permeten pagaments parcials.
  - Si el pagament supera el saldo pendent, es rebutja.
  - Un pagament amb el mateix import i la mateixa data en la mateixa liquidació es considera **duplicat**.
- **Cobraments:**
  - Un cobrament amb la mateixa referència bancària, import i data es rebutja com a duplicat.
  - Una línia d'un fitxer importat **no** es considera cobrada.
- **Permisos (RLS):**
  - Administració i Direcció ho veuen tot. La conciliació, les dades econòmiques del contracte, els costos i l'auditoria són només per a elles.
  - Els comercials veuen només els seus càlculs, moviments i liquidacions, i les seves regles aprovades. **Mai** veuen la capa del proveïdor ni els marges.
  - Els col·laboradors veuen el mateix nivell d'informació, però a més el servidor els amaga el desglossament.

## Pantalles (menú «Control econòmic»)

| Pantalla | Per a | Contingut |
|---|---|---|
| **Panell econòmic** (`?v=economia`) | Administració i Direcció | Vegeu més avall |
| **Liquidacions** (`?v=liquidacions`, `?v=liquidacio&id=…`) | Administració i Direcció. Els comercials i col·laboradors hi veuen «Les meves comissions» | Liquidacions de comercials i de col·laboradors (aquesta pestanya inclou la fitxa i les condicions de cada col·laborador). Es preparen per mes, es revisen, s'aproven i es paguen, amb historial i PDF resum. |
| **Conciliació** (`?v=conciliacio`) | Administració i Direcció | Alta manual o importació opcional d'Excel o CSV, i identificació de cada línia per CUPS, referència externa o contracte. Detecta diferències respecte de l'estimat, duplicats, retrocessions i línies no identificades. La conciliació amb diferència demana un motiu. El cobrament real es registra a part, amb la referència bancària. |
| **Regles de comissions** (`?v=regles`) | Direcció i cap d'Administració | Regles per capa, amb editor, versions, aprovació i simulador |
| **El meu rendiment** | Comercials | Rànquing filtrat a les seves pròpies dades |
| **Economia i comissions** (botó a cada contracte de la fitxa del client i a l'expedient activat) | Segons el rol | Fitxa econòmica del contracte |

**Panell econòmic:** inclou tres pestanyes.
- **Panell financer:**
  - indicadors diferenciats d'estimat, meritat, confirmat, cobrat i pendent de cobrar;
  - pagaments a comercials i a col·laboradors;
  - marge previst i marge realitzat;
  - ajustaments i retrocessions;
  - gràfic de 12 mesos i una previsió orientativa;
  - llistes de pendents i alertes.
  - Es pot filtrar per dia, setmana, mes, trimestre i any, i també per comercial, col·laborador, comercialitzadora, producte, estat del contracte i estat del cobrament.
- **Rendibilitat:** per client, contracte, comercial, col·laborador, comercialitzadora, producte, canal i període.
- **Rendiment i objectius:** rànquing i objectius de cada comercial.

**Fitxa econòmica del contracte:**
- **Entrades del càlcul** i els tres càlculs (proveïdor, comercial i col·laborador), cadascun amb el desglossament i la regla aplicada.
- **Accions:**
  - «Calcula» no crea cap moviment.
  - «Registra la meritació» crea els moviments de meritació.
- **Moviments** del contracte i la liquidació on s'inclou cadascun.
- **Anul·lació o penalització:** el que encara no s'ha liquidat s'anul·la. Sobre el que ja s'ha liquidat només s'aplica una retrocessió si hi ha una regla de retrocessió aprovada; si no n'hi ha, es genera un avís.
- **Marge:** real, estimat o incomplet. Aquest marge és **de contribució, no el benefici net**.

## Alertes (motor d'automatitzacions, idempotents)

Hi ha 8 regles noves:
- comissió prevista sense liquidar;
- diferència entre l'import estimat i el confirmat;
- contracte anul·lat amb la comissió ja pagada;
- pagament o línia duplicada;
- liquidació pendent d'aprovació;
- col·laborador amb saldo pendent;
- objectiu assolit;
- possible retrocessió.

Cada alerta té una clau única per usuari, i cada execució queda registrada a `crm_automation_runs`.

## Què no fa (expressament)

- **Retencions, cotitzacions i nòmines:** no es calculen, perquè no hi ha cap configuració laboral i fiscal validada. El PDF de liquidació ho indica.
- **Costos, imports i percentatges:** no se n'inventa cap que no estigui documentat. Naturgy, Gana Energía, NIBA, Repsol, MAPFRE i qualsevol altre proveïdor es configuren des del panell de regles.
- **Comissions:** no es consideren meritades ni cobrades només perquè el contracte estigui activat o perquè apareguin en un fitxer.

## Desplegament

1. **Supabase → SQL Editor:** copia **tot el contingut** de `supabase/migrations/011_crm_economia.sql` (no el nom del fitxer) i executa'l. Abans han d'estar aplicades la 008, la 009 i la 010.
2. **GitHub:** puja la branca `feature/crm-fase4-economia` i prova-la a la **Preview** de Vercel. No l'integris a `main` fins que hagis validat el recorregut.
3. **Vercel:** no cal cap variable nova. Les alertes s'executen amb el cron diari que ja existeix.
4. **Direcció:**
   1. Revisa les regles inicials a «Regles de comissions» i confirma la capa de cadascuna.
   2. Aprova-les.
   3. Afegeix les regles de la capa del proveïdor amb els acords reals.
   4. Valida la base de càlcul d'Iberdrola.
