# Fase 11 · Comparador fix vs indexat i plantilles de lectura IA per comercialitzadora — informe

Branca: `feature/fase10-agenda` (continua les fases 10 i 10.1). No toca `main`. Migració nova: **023** (additiva, idempotent, amb `_down`).

## 1. Plantilles de lectura IA (Excel per comercialitzadora)
**On:** Comercialitzadores → (p. ex. Naturgy) → pestanya **Plantilles de lectura IA**. A la llista de comercialitzadores, cada fitxa mostra l'estat de les seves plantilles.

- **Proposta automàtica a partir d'un Excel de mostra** (`src/comparator/xlsx-template.ts`). Detecta:
  - el full de preus i els blocs de productes;
  - les columnes de potència P1–P6 i d'energia de cada variant;
  - el codi comercial de cada variant, el peatge, el nom i el límit de consum;
  - el terme fix i els descomptes (gas) i els serveis complementaris;
  - les unitats tal com les escriu el document;
  - la vigència (nom del full i full «Seguimiento info»).
- **Amb l'Excel real de Naturgy** (`NC-Productos-Captacion-PYMES-20261029-VP.xlsx`) reconeix:
  - Plan Fijo Luz 24h (E0008), Plan Fijo Luz (E0009), Plan Fijo Luz ECO (E0010), Plan Variable Luz (E0013), Temporada/Obra, Plan Variable Gas (G0009), Plan Compromiso Gas (G0007) i els serveis;
  - les variants **M / ONE / SUPRA** (llum, amb el codi de cadascuna: …M, …B, …A) i **SUPRA / Base / ONE** i **M / SUPRA** (gas, amb el descompte de cada variant);
  - 61 productes en total.
- **Fix / indexat:**
  - Fijo, Fijo 24h (preu únic), ECO i Compromiso es classifiquen com a FIXA.
  - **«Variable» no es classifica com a indexat:** Plan Variable Luz i Plan Variable Gas queden PENDENT fins que algú confirmi si són preus revisables o fórmules indexades.
  - Mentre quedi algun bloc PENDENT, la plantilla no es pot verificar.
- **Cel·les buides i errors:** no són zeros. El bloc Temporada/Obra (tot `#N/A`) es proposa no importar-lo, i es pot tornar a incloure.
- **Avisos, sense moure res:**
  - Plan Variable Luz 3.0/6.1 només té preus a P4–P6.
  - La cel·la Y35 = −6 no s'ha identificat (no s'aplica).
- **Editor visual:**
  - l'Excel original en una graella interactiva;
  - es pot triar el bloc i seleccionar columnes o rangs;
  - es pot indicar què representen (potència, energia d'una variant, codi, peatge, nom, consum, terme fix, marge, descompte);
  - es pot canviar el tipus del bloc (FIXA/INDEXADA/MIXTA/PENDENT), marcar preu únic o excloure'l;
  - la previsualització marca les files afectades i, per a cada valor, la cel·la d'origen.
- **Xat d'ensenyament:**
  - entén frases com «Aquestes sis columnes F a K corresponen a la potència P1–P6», «Aquest producte és fix, encara que tingui sis períodes», «Aquesta variant és SUPRA», «Aquesta fila és una tarifa de gas», «Aquestes cel·les buides no són zeros», «Aquesta columna representa el marge…»;
  - proposa la correcció, l'aplica a la previsualització amb les files afectades i la desa com a **versió nova**.

  La interpretació la fa un motor local; no s'envia l'Excel a cap IA.
- **Persistència a Supabase (migració 023):**
  - es guarda la plantilla, les versions (amb la definició i l'Excel d'exemple), les correccions (biblioteca de coneixement), les lectures, la data de verificació i qui l'ha verificada;
  - es poden activar, desactivar, duplicar i recuperar versions anteriors;
  - les versions no es reescriuen mai.
- **Estats:** VERIFICADA · PENDENT DE VERIFICACIÓ · REVISIÓ NECESSÀRIA · ERROR DE LECTURA · DESACTIVADA.
- **Verificació (només Direcció):**
  - el servidor torna a llegir l'Excel d'exemple i exigeix que es compleixin totes les condicions: productes identificats, preus comprovats contra les cel·les, tots els blocs classificats, variants, unitats, fórmules indexades si n'hi ha, trams, prova amb un document real i cap error crític;
  - una confiança alta de la IA no compta.
- **Excel nous:**
  - Des de la plantilla («Provar amb un document») o des del lector de tarifes del catàleg, el CRM busca una plantilla compatible i en comprova l'estructura (full, títols dels blocs, capçaleres i unitats).
  - Si és compatible, llegeix els preus, els compara amb la lectura anterior (nous, eliminats, preus, potència, marges, tipus i vigència) i permet importar-los al catàleg **com a esborrany**.
  - Si l'estructura ha canviat, **no aplica la plantilla**: mostra «S'ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura.», les diferències i el botó per obrir el xat de correcció.
- **Catàleg i comparador:** cada tarifa importada porta la plantilla, la versió, el tipus FIXA/INDEXADA/MIXTA/PENDENT, la variant, el codi i les cel·les d'origen. Entra sempre com a esborrany i les versions anteriors es conserven. El comparador només fa servir les tarifes **actives**.

**No hi ha cap plantilla inventada per a Endesa, Iberdrola, Repsol, Nufri o Novaluz.** La infraestructura és comuna i s'ensenyarà a mesura que n'arribin documents. La Tarifa Open d'Endesa (PDF) continua amb el seu lector de la Fase 10.1.

## 2. Comparador fix vs indexat amb escenaris
- **Fórmula pròpia de cada indexada** (catàleg → editor de la tarifa, quan és indexada o mixta):
  - índex (OMIE, OMIP, PVPC, MIBGAS, TTF…), marge, pèrdues per període, serveis d'ajust, altres components i peatges i càrrecs (si no hi van inclosos);
  - el text literal del contracte.

  Si falta un component imprescindible, el resultat surt **INCOMPLET**.
- **Escenaris:**
  - El central és la hipòtesi de mercat per període en €/MWh, amb la seva font; el baixista i l'alcista són percentatges configurables (−20 % i +20 % per defecte).
  - Hi ha un avís explícit que no són previsions oficials.
  - No hi ha connexió amb cap API de mercat: els valors s'introdueixen a mà.
- **Resultats** (pas «Comparativa»):
  - taula amb la tarifa actual, la millor fixa (contractual) i la indexada en els tres escenaris (estimat): cost anual, estalvi, diferència mensual i per MWh;
  - **gràfic** del cost segons el preu de mercat, amb el **punt d'equilibri** (calculat numèricament);
  - sensibilitat (€/any per cada +1 €/MWh) i rang de risc (alcista − baixista).
- **Consum horari:** per als clients 3.0TD i 6.1TD amb corba horària, el consum de cada període surt de la corba.
- **Recomanació:**
  - Hi ha una anàlisi explicada sense IA. **No recomana mai la indexada només perquè surti més barata a l'escenari baixista.**
  - El botó «Redacta amb IA» també rep les dades dels escenaris.
- **PDF** (resum i detallat): pàgina nova «Fixa vs indexada · escenaris de mercat» amb la taula, les barres, el punt d'equilibri, el risc explicat de manera senzilla i les hipòtesis. Distingeix els imports contractuals dels estimats.
- **Comparatives desades:** porten la hipòtesi i l'anàlisi; el servidor ho torna a calcular.

## Migració
`023_plantilles_lectura.sql`: tariff_templates, tariff_template_versions, tariff_template_corrections i tariff_template_reads.
- **RLS:** només l'administració (`is_staff`) hi té accés; verificar, només Direcció (guarda a la base de dades).
- Sense DELETE, i versions immutables.

No cal cap variable d'entorn nova.

## Proves
| Prova | Tipus | Resultat |
|---|---|---|
| 1–4, 7–9: `tests/plantilles-naturgy.test.ts` (15) amb l'**Excel real**: cada valor comparat amb la cel·la original (més de 300), productes, variants, classificació, `#N/A`, segon Excel equivalent (preus nous, full NOV26), format incompatible, correccions del xat i ofertes per al catàleg | **Provat de debò** (lectura real del fitxer) | 15/15 OK |
| 10–12: `tests/market.test.ts` (9): fórmula, escenaris, punt d'equilibri, sensibilitat, fórmula incompleta, la indexada no es recomana només per l'escenari baixista, comparativa desada, corba horària i **PDF** (text extret del PDF generat) | Lògica (la indexada és una fórmula de prova) | 9/9 OK |
| 5–6, 13–14: `tests/db/plantilles-rls.test.ts` (5): desar, recuperar en una sessió nova, només Direcció verifica, versions immutables, no s'esborra res, permisos | **Provat de debò** sobre Postgres local (PGlite), no sobre el Supabase real | 5/5 OK |
| `e2e/plantilles.e2e.cjs` (Playwright, 6): Excel real → proposta → xat → desar; verificar; segon Excel → canvis → importar; format canviat; reconeixement des del lector; comparador amb escenaris i gràfic | **Provat amb simulació** (navegador real; API simulada) | 6/6 OK |
| typecheck · lint (0 errors) · 728 proves vitest · build | Codi | OK |

## Limitacions
- No hi ha dades de mercat automàtiques (OMIE/OMIP): els escenaris s'introdueixen a mà, amb la font indicada.
- El xat d'ensenyament fa servir un intèrpret local de frases. Si la frase no s'entén, demana que se seleccionin les columnes; no envia l'Excel a cap IA.
- Només s'han ensenyat els Excel. Els PDF (llevat de la Tarifa Open d'Endesa) continuen passant pel lector amb IA.
- Plan Variable Luz i Plan Variable Gas de Naturgy: cal que algú confirmi si són preus revisables (fixos) o indexats. El document no inclou cap fórmula.
- Res no s'ha provat contra el Supabase real (cal executar la 023).
