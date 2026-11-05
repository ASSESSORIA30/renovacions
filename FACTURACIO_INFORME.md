# Facturació pròpia d'Assessoria 3.0

Nou apartat **Facturació** al menú (entre Economia i Col·laboradors). Substitueix l'Excel «FACTURA BASE.xlsm».

## On és

| Opció del menú | Què hi ha |
|---|---|
| Panell de facturació | Facturat del mes i de l'any, base, IVA, pendent, cobrat i vençudes. Gràfica mensual comparada amb l'any anterior, empreses amb més facturació i avisos. |
| Nova factura | Esborrany amb una o diverses línies. La base, l'IVA per tipus i el total es calculen amb decimals exactes. |
| Factures emeses | Cerca per número, empresa, CIF o concepte. Filtres per any, dates, imports, estat i període. Descàrrega de PDF en ZIP i Excel (llistat, resum mensual i IVA trimestral). |
| Esborranys · Pendents de cobrar · Cobrades · Rectificatives | El mateix llistat, filtrat. |
| Clients de facturació | Alta, modificació, arxivament (si té factures) o eliminació (si no en té), cerca i importació des d'Excel/CSV. No es duplica cap NIF. |
| Conciliacions per facturar | Liquidacions de comercialitzadores amb l'import pendent de facturar. El botó **Generar factura** crea l'esborrany vinculat a la liquidació. |
| Configuració de facturació | Dades de l'emissor, IBAN i logotip (només Direcció), plantilla del correu, numeració i números per verificar. |

La fitxa de cada factura emesa permet:
- veure i descarregar el PDF;
- enviar-la per correu des de la bústia de l'usuari;
- registrar cobraments totals o parcials;
- preparar una rectificativa.

## Regles garantides per la base de dades (migració 026)

- **Numeració:**
  - Correlativa per any: 26-049, 26-050… El 2027 tornarà a començar.
  - El número es reserva de manera atòmica en emetre la factura. Els esborranys no consumeixen número.
  - Mai es reutilitzen números, tampoc els que consten com a consumits (26-023 i 26-031).
- **Factures emeses:**
  - No es poden modificar ni eliminar. Les correccions es fan amb una rectificativa (sèrie R26-001…).
  - Conserven les dades fiscals del client i de l'emissor del dia de l'emissió.
  - Cada una guarda una empremta SHA-256 encadenada amb l'anterior. Això prepara la integritat dels registres, però **no equival a VERI\*FACTU**.
- **Emissió bloquejada** quan:
  - falten dades fiscals;
  - el client està marcat per revisar;
  - hi ha una línia amb IVA 0 % sense causa d'exempció;
  - la data és anterior a la de l'última factura emesa;
  - la factura supera l'import pendent d'una liquidació ja facturada.
- **Cobraments:** poden ser parcials. Un cobrament repetit o superior al pendent es rebutja, i no es poden esborrar.
- **Correu:** la factura només es marca com a enviada quan el servidor SMTP accepta el missatge.

## Permisos (mòdul `facturacio`)

| Rol | Accés |
|---|---|
| Direcció | Tot, inclosos l'IBAN i les dades de l'emissor. |
| Cap administrativa | Llegeix, prepara esborranys, emet factures i registra cobraments. |
| Administrativa | Llegeix i prepara esborranys i clients. No emet. |
| Comercial, Cap d'equip i col·laborador | Sense accés. |

Tot es valida al servidor i amb la RLS. Direcció ho pot ajustar a «Usuaris i permisos».

## Dades

Els 28 clients, les 181 factures històriques i la numeració de l'Excel es van carregar amb la migració de dades. Per protecció de dades, aquesta migració **no és al repositori**, perquè conté CIF i l'IBAN real. Les factures de l'Excel apareixen com a «Cobrament no consta» fins que es revisen. Des del llistat es poden seleccionar i marcar com a cobrades.

## Proves

- `tests/billing.test.ts` comprova els totals, la numeració, el NIF/CIF, la proposta a partir d'una liquidació, el CSV i el PDF.
- `tests/db/facturacio-rls.test.ts` prova, sobre PostgreSQL (PGlite) amb les migracions 001-026 i dades fictícies:
  - els permisos de cada rol;
  - la numeració;
  - el bloqueig de les factures emeses;
  - els cobraments i les rectificatives;
  - la doble facturació d'una liquidació.

## Extractes bancaris (migració 028)

A *Facturació › Banc* («Extractes bancaris» al menú) es puja el fitxer **Norma 43** (n43/aeb43) o l'**Excel/CSV** de la banca en línia. Els moviments que ja s'havien pujat no es dupliquen.

- **Proposta per a cada ingrés:**
  - Busca la factura oberta amb el **mateix import pendent**.
  - Si el concepte esmenta el número de factura o el CIF/nom del client, la proposta té **confiança alta**.
  - També detecta pagaments agrupats de 2 o 3 factures d'un mateix client.
- **Confirmar:** registra el cobrament a la factura (`bill_register_payment`) i marca l'ingrés com a conciliat. Tot o res: no es pot cobrar més del que ha entrat al banc. El botó «Confirmar les segures» confirma de cop les de confiança alta.
- **«Factures que falten per cobrar»:** llista les factures obertes per a les quals l'extracte no té cap ingrés que hi encaixi, amb els dies de retard. Les factures de l'Excel antic surten a part.
- **Ingressos sense factura:** surten avisats. Poden ser cobraments de factures que encara no s'han emès.

## Liquidacions amb CUPS o telèfon a la mateixa columna

Alguns col·laboradors (per exemple el «581») posen a la columna «TELÉFONO» el CUPS (llum i gas) o el número (fibra i mòbil). El lector:
- interpreta cada fila pel seu valor;
- desa el telèfon com a referència de la línia;
- passa la «COMISIÓN IVA INCLUIDO» a base (import / 1,21) i en conserva el brut;
- llegeix «NO COMISIONA» com a 0;
- fa servir el «TOTAL IVA INCLUIDO» de la dreta per quadrar.

Provat amb les liquidacions de setembre i octubre de 2026: 359,03 € + 622,00 € = 981,03 €, l'import de la factura 26-048.

## Pendent

- **Enviament de correu:** només s'ha provat amb simulació. Necessita el correu SMTP/IONOS de cada usuari configurat a «El meu perfil».
- **VERI\*FACTU i facturació electrònica (Facturae):** no estan implementats. Cal confirmar amb la gestoria les obligacions i les dates vigents.
- **Gestió intel·ligent de tarifes (Part 2 de l'encàrrec):** encara no està feta.
- **Taula `bill_statement_claims`:** està creada, però la pantalla de reclamacions existent (migració 018) ja cobreix aquesta funció. Encara no s'ha connectat.
