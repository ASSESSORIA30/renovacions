# Correcció · Lector de factures PDF (bytes abans de «%PDF») i Qualitat de dades

Branca proposada: `fix/lector-factures-pdf` (sobre `main`). Sense migracions.

## Lector de PDF
- Causa: `sniffMime()` només acceptava «%PDF» a la posició 0. Algunes factures reals (Energia Nufri) porten bytes abans de la capçalera.
- `src/core/pdf-sniff.ts`: capçalera «%PDF-d.d» dins dels primers 1024 bytes (com Acrobat i pdf.js). Mai s'accepta un ZIP/DOCX, un executable, un script o un HTML amb un PDF enganxat, ni un fitxer qualsevol amb extensió .pdf.
- `src/server/pdf-prepare.ts`: retira els bytes previs en memòria (el resultat és idèntic al PDF original a partir de la capçalera; l'original desat no es toca), comprova que pdf.js el pot obrir i, només si no pot, el reconstrueix amb pdf-lib. Errors específics: protegit amb contrasenya, malmès o incomplet, sense pàgines, no és un PDF.
- El text (`unpdf`) i la IA reben la mateixa versió normalitzada. Es mantenen el límit de 10 MB i la resta de restriccions.
- Reutilitzat a: comparatives (adjuntar factura), captació (factures de leads), contractes de comercialitzadores, lector de tarifes amb IA i validació de documents de clients, comercialitzadores i reclamacions (`sniffDoc`).

## Qualitat de dades
- Botó «Ignora tots» (pendents del filtre actiu), amb confirmació i motiu opcional. No trepitja casos ja revisats; es poden reobrir un per un.
- Clients amb el mateix telèfon I el mateix correu (i NIF diferent): s'ignoren automàticament («mateixa persona amb diversos subministraments o empreses»). Es veuen a «Revisats». Si coincideix el NIF, continua sent un duplicat real.

## Proves
- `tests/lector-factures-pdf.test.ts` (17): factura FICTÍCIA amb el format 3.0TD de Nufri i 8 bytes previs; PDF normal, escanejat, protegit, només amb restriccions, malmès i no-PDF; extracció de titular, NIF, CUPS, 3.0TD, potències, consums i preus P1–P6.
- `tests/consolidacio.test.ts` (+2): ignorar automàtic i «Ignora tots».
- typecheck, test (971), lint (0 errors) i build: correctes.
- Pendent: provar-ho amb la factura original de Nufri (no s'ha rebut l'adjunt).
