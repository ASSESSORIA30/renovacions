# Unificació de tarifes · Fase 1: Catàleg de tarifes com a única font i retirada de «Propostes»

Branca proposada: `feature/cataleg-unic` (sobre `fix/lector-factures-pdf`). Migració: **030_cataleg_unic.sql** (+ `_down`).

## Auditoria (abans)
- `loadCatalog()` i `listCatalog()` barrejaven `tariff_versions` amb les ofertes de `offers` (adaptades amb `fromCrmOffer`).
- El motor d'oportunitats IA (`server/intelligence.ts`) i l'assistent IA de renovacions (`app/api/ai`) també llegien `offers`.
- Renovacions (fitxa del contracte i proposta PDF de renovació) llegien `snap.offers`, carregat de la taula `offers`.
- El servidor desava les comparatives amb els preus que enviava el navegador.
- «Propostes» (`views/Ofertas.tsx`) era un segon gestor d'ofertes (alta manual i plantilla Excel ZocoProductos). No guardava documents enviats: les propostes emeses són a `comparisons`, `comparison_documents` i `documents`.

## Canvis
- **Única font**: `listCatalog`, `loadCatalog`, intel·ligència i assistent IA només llegeixen `tariff_versions`. Una versió per producte: la més recent ACTIVA (`latestPerProduct`).
- **Selecció** (`selectableForNew`): només tarifes actives, vigents, completes i del catàleg. Les caducades/arxivades/esborranys no es poden triar; si no n'hi ha cap de compatible, avís clar (sense alternativa silenciosa).
- **Servidor de comparatives**: els preus es llegeixen del catàleg al servidor per identificador; una alternativa nova no seleccionable es rebutja; les comparatives històriques conserven les seves còpies. El snapshot guarda `catalogRefs` (id, producte, versió).
- **Ajustos per comparativa** (`OfferAdjustment`): activar/desactivar cada descompte i afegir/treure el SAS quan la tarifa no el porta inclòs (amb valor i justificació). No modifiquen la tarifa; es desen al snapshot (`adjustments`, `baseOffers`) i el PDF els indica.
- **Renovacions**: `snap.offers` es deriva del catàleg (`toCrmOffer`: preus finals, €/kW·dia, id = versió).
- **«Propostes» retirat**: menú, vista, formularis i lògica de manteniment d'ofertes eliminats (`saveOffer`, `deleteOffer`, `upsertOffer`). Els enllaços antics porten a Catàleg → «Migració de Propostes».
- **Migració**: informe (ja al catàleg, vigent, caducada, incompleta, duplicada, usada en comparatives) i incorporació de les vàlides que no existeixen (mai se sobreescriu ni s'activa res incomplet o caducat).
- **Plantilla Excel ZocoProductos**: ara s'importa des del Catàleg → «Importar Excel» (entra com a esborrany).
- **030**: còpia `offers_backup_030` i `offers` en només lectura. No s'esborra cap taula.

## Proves
`tests/cataleg-unic.test.ts` (15) i `tests/db/cataleg-unic-rls.test.ts` (4): proves 1–14 de l'encàrrec. typecheck, test (990), lint (0 errors) i build: correctes.

## Pendent (fases 2 i 3)
Energia desglossada (ATR + lliure), excedents, permanència obligatòria 3.0TD/6.1TD fixes i PDF nou de 4 columnes.
