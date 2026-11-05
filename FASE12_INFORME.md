# Fase 12 · Lector IA universal de tarifes amb aprenentatge permanent

Branca: `feature/fase12-lector-iberdrola` (surt de `feature/fase10-agenda`; inclou també les fases 10, 10.1 i 11).
Data: 3 de novembre de 2026.

> **Com s'ha provat.** El lector s'ha provat de debò amb l'Excel real `IBERDROLA_HASTA_15.11.xlsx`, a les proves
> automàtiques. Les pantalles s'han provat al navegador amb un servidor simulat. La base de dades s'ha provat sobre
> PostgreSQL local (PGlite) amb les migracions 001–024. **No s'ha provat res contra el Supabase real.**

---

## 1. Fitxers modificats

**Nous**

| Fitxer | Què fa |
|---|---|
| `src/comparator/tariff-table.ts` | Lector únic de taules: detecta la pestanya, les columnes, el rang real i les files ocultes; llegeix totes les files i aplica el motor de regles. |
| `src/comparator/tariff-discounts.ts` | Llegeix la columna O (descomptes) i fa el simulador de descomptes. |
| `src/comparator/reading-knowledge.ts` | Coneixement validat per comercialitzadora (Iberdrola «Energía», Naturgy) i detecció de la comercialitzadora. |
| `src/comparator/reading-rules.ts` | Xat de correccions, aprenentatge per exemple, abast de les regles, abans/després, comparació amb un Excel correcte i fragments per a la IA. |
| `src/comparator/table-offers.ts` | Converteix la lectura en tarifes del catàleg (sempre en esborrany), amb la cel·la d'origen. |
| `src/ui/views/retailers/TableReader.tsx` | Vista de tres columnes (Excel · tarifes interpretades · xat), «ENSENYAR A LA IA» i material d'aprenentatge. |
| `src/ui/views/retailers/StatusPill.tsx` | Etiqueta de l'estat de verificació. |
| `src/ui/views/comparatives/DiscountSimulator.tsx` | Botó i finestra «SIMULAR DESCOMPTES». |
| `supabase/migrations/024_lector_universal_aprenentatge.sql` i `_down.sql` | Migració nova. |
| `tests/iberdrola-energia.test.ts` | 27 proves amb l'Excel real. |
| `tests/db/lector-universal-rls.test.ts` | 5 proves de base de dades. |
| `e2e/iberdrola.e2e.cjs` i `e2e/iberdrola/*.json` | 8 recorreguts al navegador. |
| `tests/fixtures/iberdrola/*.xlsx` | Excel real i tres còpies modificades. |
| `scripts/e2e-iberdrola-fixtures.ts` | Genera les còpies modificades. |

**Modificats**

| Fitxer | Canvi |
|---|---|
| `src/comparator/xlsx-template.ts` | Disposició «taula», files ocultes, regles desades a la plantilla. |
| `src/comparator/types.ts` | Origen (arxiu, pestanya, fila i cel·les), preus originals, text del descompte i estat de la lectura. |
| `src/comparator/endesa-open.ts` | Etiqueta i tipus de l'horari promocionat. |
| `src/comparator/engine.ts` | Horari promocionat d'altres comercialitzadores; el tram per P6 continua sent només d'Endesa. |
| `src/comparator/client.ts` | Lectura de documents Word. |
| `src/server/tariff-templates.ts` | Funcions noves: desar regles, aprovar-les, llistar-les, regles generals i propostes de la IA. |
| `app/api/tariffs/reading-templates/route.ts` | Rutes per a les funcions noves. |
| `src/ui/views/retailers/ReadingTemplates.tsx`, `templates-api.ts` | Detecció de la comercialitzadora, tria de pestanya, prova de documents de taula i «Aprova i activa les interpretades». |
| `src/ui/views/comparatives/TariffAiReader.tsx`, `Catalog.tsx`, `StepResults.tsx` | Lector universal sense IA i simulador de descomptes. |

## 2. Migració de Supabase

**`024_lector_universal_aprenentatge.sql`**: additiva i idempotent, amb el seu `_down`. No esborra ni duplica cap taula.

- **Biblioteca de regles (`tariff_rule_library`, creada a la 022).**
  - Accepta un tipus nou de regla: `lectura`.
  - Admet dues fonts noves: `exemple` i `ia`.
  - Té cinc columnes noves: plantilla, versió, abast, columnes afectades i exemple validat.
  - Una regla no es pot reescriure i només Direcció l'aprova.
- **Taula nova `tariff_template_examples`.** Guarda els exemples validats amb el seu historial.
  - Hi poden afegir exemples Direcció, la cap administrativa i l'administració.
  - Només Direcció els aprova.
  - Ningú no els pot esborrar.
- **Lectures (`tariff_template_reads`).** Guarden també la pestanya llegida i el recompte de tarifes.
- **Consulta de comprovació.** Ha de retornar `1 · 3 · 5 · 2 · 1`.

Necessita les migracions 019–023 aplicades abans.

## 3. Funcionalitats

**Lector únic per a totes les comercialitzadores.** Una plantilla per format de document, més el coneixement de cada comercialitzadora.

**Formats**

| Format | Com es llegeix | IA |
|---|---|---|
| XLSX, XLS i CSV | Amb un lector d'Excel de debò, sense OCR | No |
| Word | El text s'extreu al navegador | Sí |
| PDF i imatges | Lector amb IA de les fases anteriors | Sí |
| Tarifa Open d'Endesa | Lector local | No |

**Iberdrola · pestanya «Energía»**

- **Pestanya.**
  - El lector tria «Energía» sol i ho indica.
  - «Portada» i «old» no es fan servir; «PYS» només com a document complementari.
  - Si «Energía» no hi és: error i tria manual. Mai no canvia de pestanya sense avisar.
- **Rang i files.**
  - Ignora les cel·les que només tenen format (la pestanya arriba fins a la columna XFD).
  - Informa de les columnes auxiliars AA–AI i de les files ocultes.
  - Llegeix les 100 tarifes sense IA, i per tant sense límit de context.
- **Capçaleres.** Es llegeixen les secundàries: «No Prom.» / «Prom.», «Punta / Llano / Valle» i «Tramo».
- **Regles de Direcció.**
  - 2.0TD: un, dos o tres preus.
  - 3.0TD i 6.xTD amb preu únic.
  - Impulsa Negocios: P1–P5 promocionat, P6 no promocionat.
  - Impulsa Nocturna: P1–P5 no promocionat, P6 promocionat.
  - Impulsa Solar i Impulsa Vehículo Eléctrico: estimació ponderada per hores, marcada sempre com a estimació.
  - Plan OMIE: indexat; el valor es guarda com a marge, en €/kWh i en €/MWh.
- **Descomptes de la columna O.**
  - S'interpreten: s/Te; s/Te y Tp; s/ dto; import fix per kWh condicionat a consum; descomptes per anys; Tier 1, Tier 2, UUEE, ACP i Estancias Verdes; calendari.
  - Els preus originals es conserven.
  - El descompte base s'aplica una sola vegada.
  - Els descomptes condicionats no s'apliquen mai sols.
  - Si no consta si dos descomptes se sumen o s'apliquen un darrere l'altre, la fórmula queda pendent de validar.

**Ensenyar a la IA**

- Vista de tres columnes: l'Excel, les tarifes interpretades i el xat.
- **El xat entén frases com:**
  - «P1–P5 promocionat i P6 no promocionat»
  - «el Plan OMIE és indexat i el valor és el marge»
  - «quan hi ha dos preus en 2.0TD, el primer correspon a P1 i P2 i el segon a P3»
  - «el descompte de la columna O afecta energia i potència»
  - «aquest import és €/kW/any»
  - «has confós el promocionat amb el no promocionat»
  - «aplica-ho a tots els productes equivalents»
  - «el descompte és correcte»
  - «el terme fix del gas és en €/mes»
- **Abast.** Abans de guardar, mostra l'abans/després i deixa triar l'abast:
  - només aquest document;
  - aquest producte;
  - aquesta plantilla;
  - regla general, que només s'activa quan Direcció l'aprova.
- **Ensenyar amb un exemple.** Escrius els P1–P6 correctes d'una tarifa i el CRM troba quina regla reutilitzable ho explica. Si no n'hi ha cap, guarda els valors com a manuals només per a aquell producte.
- **Material d'aprenentatge.**
  - Un Excel amb la interpretació correcta: es compara fila a fila.
  - Un document d'explicació o un PDF de condicions: es llegeix aquí mateix, no es desa ni s'envia a cap IA.
  - Comparació amb les tarifes aprovades del catàleg.
- **On es guarden les regles.**
  - Dins d'una versió nova de la plantilla, que no es pot modificar.
  - A la biblioteca, amb qui, quan, columnes, explicació i resultat correcte.
  - Una correcció no toca tarifes ja aprovades ni comparatives anteriors.

**Altres**

- **Plantilles verificades.** Estats VERIFICADA, PENDENT, REVISIÓ NECESSÀRIA, ERROR i DESACTIVADA.
  - Només Direcció verifica, i només si es compleixen totes les comprovacions: columnes, productes, preus, interpretació, descomptes, indexades, regles aprovades i errors.
  - La confiança de la IA no compta.
- **Document del mes següent.**
  - Recupera la plantilla i les regles apreses.
  - Mostra els preus modificats.
  - Direcció pot «Aprovar i activar les interpretades»; la resta entren en esborrany.
- **Format canviat.** No aplica la plantilla i mostra «S'ha detectat un canvi en el format de les tarifes…».
- **SIMULAR DESCOMPTES.** Al lector, al catàleg i al comparador. Les opcions surten només del document. Calcula elegibilitat per consum, cost dels serveis, 1r i 2n any i estalvi net.
- **Comparador.**
  - Les tarifes Plan OMIE no es comparen pel marge.
  - Mentre falti la fórmula contractual completa, surten com a «incompletes».
  - Amb corba horària es fa servir l'horari contractual.
- **Pregunta a la IA.** Envia les tarifes pendents en fragments de com a màxim 12.000 caràcters, mai l'Excel sencer. Torna regles proposades que algú ha de revisar.

## 4. Tarifes llegides per comercialitzadora

| Comercialitzadora | Document | Tarifes |
|---|---|---|
| Iberdrola | `IBERDROLA_HASTA_15.11.xlsx`, pestanya «Energía» | 100: 89 de llum i 11 de gas (RL.1–RL.6) |
| Naturgy | `NC-Productos-Captacion-PYMES-20261029-VP.xlsx` | 61 productes i 4 serveis (Fase 11, continua igual) |
| Endesa Open | PDF 3.0TD i 6.1TD | 10 ofertes per document: 5 modalitats × 2 trams (Fase 10.1, continua igual) |

## 5. Tarifes correctes i pendents (Iberdrola)

**65 interpretades · 32 a revisar · 3 pendents · 0 fallides.**

Comprovats amb els valors de Direcció:

| Fila | Tarifa | Resultat |
|---|---|---|
| 14 | 2.0TD un preu | 0,1999 a P1, P2 i P3; també −15 % a la potència |
| 68 | Impulsa Negocios | 0,1504 (P1–P5) i 0,3096 (P6) |
| 69 | Impulsa Nocturna | 0,3096 (P1–P5) i 0,1360 (P6) |
| 73 | 3.0TD sis preus | 0,283101 … 0,196957 |
| 76 i 91 | Empresa Plus | Sense descompte base; l'import fix per kWh només si se supera el consum |

**A revisar (32): l'aplicació no ha volgut decidir per tu**

| Cas | Quantes | Per què |
|---|---|---|
| «+5 % s/te 2año» (Comunidad i Estable Comunidades) | 11 | No consta com funciona el 2n any. |
| «10 / 15 / 20 / 25 / 30 %» (Más Ahorro) | 2 | No consta quin percentatge s'aplica cada any. |
| «100 € en Mi Iberdrola» | 2 | És un bo, no un descompte sobre el preu. |
| 2.0TD amb hores promocionades (8 horas, Solar, Vehículo Eléctrico, Estancias Verdes) | 8 | Cal confirmar l'horari real. |
| Gas: unitat del terme fix | 6 | El full no la indica. |
| Gas «Indexada» | 3 | Cal confirmar que el valor és el marge. |

**Pendents (3): no s'inventa la distribució P1–P6.** Són 3.0TD Plan Regantes, 3.0TD Estancias Verdes i 6.1TD Estancias Verdes.

## 6. Regles d'aprenentatge

- **Al codi (coneixement d'Iberdrola): 14 regles.**
  - 10 explicades per Direcció.
  - 2 que surten de la capçalera del document.
  - 2 propostes per confirmar.
- **Guardades al Supabase real: cap.** Encara no s'ha aplicat la 024.
- **Provat amb la base de dades local:** una regla es guarda, es recupera en una sessió nova i s'aplica al document del mes següent.

## 7. Plantilles verificades

**Cap.** Cal Direcció i les comprovacions reals.

La d'Iberdrola no es podrà verificar fins que es resolguin les 35 tarifes pendents o a revisar. Es poden resoldre des del xat o amb exemples.

## 8. Proves

| Proves | Tipus | Resultat |
|---|---|---|
| `tests/iberdrola-energia.test.ts` | Excel real d'Iberdrola | 27 |
| `tests/db/lector-universal-rls.test.ts` | Base de dades local (PGlite) | 5 |
| La 024 aplicada dues vegades i el `_down` | Base de dades local | Correctes |
| `e2e/iberdrola.e2e.cjs` | Navegador, servidor simulat | 8 de 8 |
| Naturgy (`e2e/plantilles.e2e.cjs`) | Navegador, servidor simulat | 6 de 6 |
| Endesa Open (`e2e/tarifes-open.e2e.cjs`) | Navegador, servidor simulat | 6 de 6 |
| Lector de comissions i retrocessions | Proves automàtiques existents | Passen |

## 9. TypeScript i build

| Comprovació | Resultat |
|---|---|
| `npm run typecheck` | Correcte |
| `npm run lint` | 0 errors; 4 avisos que ja hi eren |
| `npm run test` | 759 proves en 50 fitxers, totes correctes |
| `npm run build` | Correcte, amb un avís que ja hi era (`unpdf` a les factures) |

## 10. Pendent per bloquejos externs

- **Supabase real.** Aplicar la 019–024 i provar-ho de debò.
- **Clau d'IA.**
  - Sense `ANTHROPIC_API_KEY`, «Pregunta a la IA» i la lectura de PDF, imatges i Word no funcionen.
  - Amb la clau: provat només amb simulació.
- **OCR.** No hi ha cap motor d'OCR local instal·lat. Els PDF escanejats i les imatges els llegeix la IA amb visió (cal la clau).
- **`NUEVOS PLANES 3.0.pdf`.** No l'he rebut.
  - Les hores d'Impulsa Negocios són dilluns a divendres, com diu la instrucció.
  - Per a Nocturna, Solar i Vehículo Eléctrico he suposat «tots els dies» i ho marco. Si el PDF diu una altra cosa, es corregeix des del xat.
- **Plan OMIE.** Cal la fórmula contractual completa (pèrdues, peatges i serveis d'ajust) per poder-los comparar amb les fixes.
