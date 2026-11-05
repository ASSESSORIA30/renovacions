# Facturació · Importació de «FACTURA BASE.xlsm»

Data: 4 de novembre de 2026 · Migracions: 018 (estructura) i 019 (dades)

## Què s'importa

| Dada | Quantitat | Com queda al CRM |
|---|---|---|
| Clients de facturació | 28 | Precarregats. Si un NIF/CIF ja existeix, no es toca ni es duplica. |
| Factures 2025 (25-001 a 25-052) | 52 | Emeses, amb el número original. |
| Factures 2026 (26-001 a 26-048) | 46 | Emeses, amb el número original. |
| Factures 2023-2024 (sèries AG24, EN24, TD24…) | 83 | Emeses, en sèries històriques tancades. |
| **Total de factures** | **181** | Base 2025: 150.613,97 € · Base 2026: 119.009,25 € |
| Configuració de l'emissor | 1 | ASSESSORIA 3.0 AE, SL · B13639190 · IBAN de la plantilla actual. |

Les factures històriques entren amb l'estat **«cobrament no consta»**. L'Excel no diu si estan cobrades, així que el CRM no les compta com a vençudes ni com a pendents fins que algú les revisi o hi registri el cobrament.

L'Excel només guarda els totals de cada factura, no el detall de línies. Per això cada factura històrica té una sola línia amb la base. L'única excepció és la 26-048: el seu concepte es pot recuperar de la plantilla.

## Numeració

- **Atenció:** l'última factura registrada **no és la 26-047, sinó la 26-048**. És de TELECOMUNICACIONES DEL SOMONTANO SL, amb data d'avui (4/11/2026) i 981,03 € de base, pel concepte «APOYO MARKETING SEPTIEMBRE Y OCTUBRE 26».
- La següent factura del CRM serà la **26-049**. Si la 26-048 era una prova i no s'ha enviat, digues-m'ho abans d'executar la 019.
- **26-023 i 26-031:** el full CONTROL els compta com a números consumits (48 números el 2026), però no són al REGISTRE. Probablement es van emetre i després es van esborrar del registre. Queden registrats com a «pendents de verificar» i **mai es reutilitzaran**.
- El 2027 començarà una sèrie nova automàticament (27-001).
- Les rectificatives tenen la seva pròpia sèrie: R26-001, R26-002…

## Dades que cal revisar (el CRM les marca)

| On | Problema | Efecte |
|---|---|---|
| ADAMO TELECOM IBERIA SAU | El CIF «A6523235» només té 8 caràcters. | No es pot emetre cap factura nova a aquest client fins que es corregeixi. |
| BETON DEL NORTE SL | El codi postal «2205» té 4 xifres (Osca és 22xxx). | Mateix bloqueig fins que es corregeixi. |
| NOVALUZ ENERGIA SL | El codi postal estava enganxat al final de l'adreça. | Corregit automàticament; no bloqueja. |
| Factura 25-013 (Santesmasse) | Té l'IVA al 0 %. | Cal confirmar-ne la causa d'exempció. Les factures noves amb IVA 0 % l'exigeixen. |
| AR23-009 (AUDAX) | El mateix número apareix dues vegades, el 2/12/2023 i el 30/12/2023, totes dues de 825,17 €. | S'han importat totes dues; la segona queda marcada per revisar. |
| Sèries de 2023-2024 | Hi falten números: AR23-001 a 006, EB23-001, EN23-001 i 002, EN24-010, LB23-002 i VI23-001. | Només informatiu; són sèries tancades. |

Tots els altres 26 CIF superen la validació del dígit de control.

## Garanties provades amb PostgreSQL 16

Són proves locals sobre una còpia mínima de l'esquema, no sobre el Supabase real.

- Les dues migracions es poden executar dues vegades sense duplicar res.
- 20 persones emetent alhora reben 20 números diferents i consecutius (del 26-049 al 26-068).
- Un esborrany no consumeix número.
- Una factura emesa no es pot modificar (ni l'import, ni el concepte, ni les línies) ni eliminar.
- Si es canvien les dades fiscals d'un client, les factures ja emeses conserven les que tenien.
- Cobraments: es permeten de parcials; un cobrament repetit o superior al pendent es rebutja; un cobrament no es pot esborrar.
- La rectificativa R26-001 deixa l'original com a «rectificada».
- No es pot facturar dues vegades la mateixa liquidació; les retrocessions (imports negatius) es resten.
- No es pot emetre si falten dades fiscals, si hi ha una línia amb IVA 0 % sense causa o si el client està marcat per revisar.
- Permisos: Direcció ho fa tot. La Cap administrativa emet i cobra. L'Administrativa només prepara esborranys. Els comercials i els col·laboradors no hi veuen res. Només Direcció pot canviar l'IBAN.

## Sobre VERI*FACTU

Cada factura emesa guarda una empremta digital (SHA-256) encadenada amb la factura anterior. Això prepara la integritat dels registres, però **no equival al compliment de VERI*FACTU**: per complir-lo cal un sistema de facturació adaptat o enviar els registres a l'AEAT. Abans d'activar-ho cal confirmar amb la gestoria les dates d'obligació vigents.
