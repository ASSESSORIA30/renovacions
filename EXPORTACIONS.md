# Exportacions a Excel

Menú **Administració › Exportacions a Excel**.

Conjunts disponibles:
- **Clients:** clients, subministraments (CUPS), contractes i el full de renovacions.
- **Comercial:** expedients, leads i oportunitats.
- **Col·laboradors:** només Direcció.
- **Comercialitzadores i tarifes:** comercialitzadores i versions de preus de les tarifes.
- **Economia:**
  - liquidacions de comercialitzadores i línies de conciliació;
  - liquidacions a comercials i col·laboradors;
  - comissions calculades;
  - moviments econòmics;
  - reclamacions.
- **Facturació:** factures i cobraments.
- **Gestió:** tasques i incidències.

Filtres:
- **Estat:** un o diversos, amb els valors que hi ha realment a les dades.
- **Dates:** es tria quina data es filtra i se n'indica l'interval, amb dreceres (aquest mes, mes passat, aquest any, any passat).
- **Cerca de text.**
- **Persones i comercialitzadora:** comercialitzadora, responsable o comercial, i col·laborador o beneficiari.
- **Camps concrets:** tipus, origen, província, servei, capa…
- **Columnes:** es poden triar les que es volen exportar.

L'Excel:
- té la capçalera verda, filtres automàtics i la primera fila fixa;
- té els imports en €, les dates en format català i els identificadors convertits en noms (client, CUPS, comercial, producte…);
- inclou un segon full amb els filtres aplicats, qui l'ha exportat i quan;
- té un màxim de 50.000 files per exportació.

Seguretat:
- Es llegeix amb la sessió de l'usuari: la RLS limita les files (un comercial només exporta les seves dades).
- Cada conjunt exigeix el permís de lectura del seu mòdul. Els conjunts econòmics, només Direcció i l'Administració autoritzada.
- Els filtres només accepten columnes definides a `src/core/exports.ts`.
- Cada exportació queda a l'auditoria de seguretat (`sec_audit`): conjunt, nombre de files i filtres usats.

Proves: `tests/db/exportacions-schema.test.ts` comprova contra l'esquema real (migracions 001-028) que existeix cada columna, filtre i ordre.

## Botó «Exporta a Excel» a cada pantalla

Cada pantalla amb llistat té el seu botó. Exporta **el que tens filtrat** i, si hi ha files marcades, **només les seleccionades**:

| Pantalla | Què exporta |
|---|---|
| Cartera de clients | Els clients amb els mateixos filtres: estat (actiu, potencial, inactiu), comercial (inclòs «sense assignar»), cerca, província, municipi, sector i serveis. Amb clients seleccionats, només aquests. |
| Fitxa del client › Contractes / Subministraments | Tots els contractes o subministraments d'aquell client. |
| Cartera (renovacions) | Les files que veus, amb els mateixos filtres i ordre. L'Excel es fa al navegador. |
| Leads | Mateixos filtres (estat, comercial, cerca; sense estat = els oberts, com a la pantalla). |
| Oportunitats / Tramitacions | Exactament les fitxes que mostra el tauler amb els filtres posats. |
| Col·laboradors | Els visibles amb la cerca i la classificació, o els seleccionats (només Direcció). |
| Tasques / Incidències | Mateixa pestanya i filtres (les meves, obertes, vençudes, prioritat, àrea, cerca…), o les tasques seleccionades. |
| Comercialitzadores, Catàleg de tarifes | Tot el llistat. |
| Conciliació | Les liquidacions, totes les línies o les línies d'una liquidació concreta. |
| Liquidacions | Les de comercials o les de col·laboradors, segons la pestanya. A «Les meves comissions», les comissions pròpies. |
| Reclamacions | Amb la comercialitzadora filtrada. |
| Control econòmic | Comissions calculades i moviments econòmics. |
| Facturació | Ja tenia l'Excel, amb el llistat, el resum mensual i l'IVA. |

Quan es seleccionen moltes files, el botó les envia al servidor per POST, perquè no caben a l'adreça.
