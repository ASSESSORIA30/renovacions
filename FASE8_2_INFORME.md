# Fase 8.2 · Correcció de «Documents» i reclamacions a comercialitzadores

Branques: `fix/pestanya-documents` (només la correcció) i `feature/reclamacions-comercialitzadores` (la correcció + les reclamacions).
Migració nova: **`018_reclamacions.sql`** (i `018_reclamacions_down.sql`). La correcció de «Documents» no necessita cap migració.

## 1. Error crític de la pestanya «Documents» (Renovacions)

**Causa real.** La pestanya llegia els documents amb un selector de l'estat (zustand v5) que creava una llista nova a cada lectura. React ho interpreta com un canvi constant i entra en bucle infinit (*Minified React error #185 · Maximum update depth exceeded*), i com que l'aplicació no tenia cap «error boundary», queia tota la pantalla. Reproduït amb Playwright clicant «Documents».

**Correcció.**
- Selector corregit (la llista es filtra amb `useMemo`). Una prova automàtica impedeix que torni a aparèixer aquest patró a qualsevol pantalla.
- `ErrorBoundary` a cada pestanya de la fitxa, a la fitxa sencera i a cada pantalla del CRM: si una part falla, surt un avís amb «Torna-ho a provar» i la resta continua funcionant.
- La pestanya ara té dos blocs:
  - **Propostes de renovació** (versió, data, autor, estalvi; descarregar i enviar per correu). Si el PDF ja no existeix, avís «Fitxer no disponible».
  - **Documents del client** de Clients 360° (factures, contractes, mandats…): tipus, data de càrrega, qui l'ha pujat, mida; **visualitzar**, **descarregar** i **pujar** documents nous (queden vinculats al client, al contracte i al CUPS). El client es troba pel contracte (`crm:<id>` o `legacy_contract_id`) o pel CUPS.
- Permisos: la base de dades (RLS) decideix què veu cadascú; els DNI/NIE i els documents bancaris només els veu qui hi té permís. Nova ruta `GET /api/crm/documents?renewal=…`.

## 2. Reclamacions a comercialitzadores (menú Economia → Reclamacions)

**Flux.** Carregar la liquidació mensual a *Conciliació* (com fins ara) → *Reclamacions*: el CRM compara cada línia amb les regles **aprovades** i mostra les discrepàncies → seleccionar (una a una o «totes les elegibles») → **GENERAR RECLAMACIÓ** → un sol PDF i un sol esborrany de correu per comercialitzadora i període → revisar i **Enviar** (amb confirmació explícita) → seguiment.

**Què és reclamable (ho decideix el servidor, no la pantalla).**
| Cas | Reclamable? |
|---|---|
| Liquidat per sota de la regla aprovada (≥ 1 €) | Sí, la diferència |
| Contracte activat i no liquidat | Només si ha vençut el **termini de pagament aprovat** de la comercialitzadora; si no hi ha termini aprovat → «Cal revisar» |
| Retrocessió fora del període de risc o per sobre del que permet la regla | Sí, l'excés |
| Regla en simulació / pendent de configuració, contracte anul·lat, meritació que no és l'activació, excepcions a la regla, termini de reclamació possiblement vençut | No automàticament («Cal revisar») |
| Liquidat per sobre, duplicats, línies no identificades | No |

Una diferència no pot ser en dues reclamacions actives (ho garanteix la base de dades). Per tornar-la a reclamar: **Crear seguiment** (copia el que encara no s'ha recuperat).

**Panell:** discrepàncies, potencialment reclamable, reclamat, recuperat, pendent de resposta, contractes afectats, obertes i resoltes.

**PDF** (castellà o català): logotip, comercialitzadora, període, data, relació de contractes amb CUPS i referències, comissió prevista i liquidada, diferència, total, explicació (només fets: imports, dates i terminis) i la clàusula contractual de cada regla (document, pàgina i fragment literal).

**Correu:** assumpte, presentació, resum per tipus, total, petició de regularització, referència a l'informe adjunt i signatura corporativa. Editable. Contacte de liquidacions configurable per comercialitzadora. S'envia amb el compte SMTP de l'usuari i **mai** sense la casella de confirmació. També es pot registrar un enviament fet fora del CRM.

**Seguiment:** estats (Esborrany → Pendent d'enviament → Enviada → Pendent de resposta → En revisió → Acceptada totalment / parcialment / Rebutjada → Resolta), resposta amb import reconegut per contracte, justificants (fins a 3 MB), responsable, tasques, recordatoris, imports recuperats i historial que no es pot modificar.

**Regularitzacions:** en registrar una liquidació nova, el CRM proposa quines línies poden correspondre a reclamacions obertes (mateix contracte o CUPS, import, concepte). Cal confirmar-les; en confirmar-les es registra l'import recuperat.

**«Per què?» (motiu de la diferència).** Hipòtesis amb grau de confiança i referències: tarifa aplicada incorrectament, MWh diferents, campanya, incentiu, zona, activació fora del període, retrocessió, regularització, meritació. Sempre etiquetades com a **hipòtesi**; sense prou dades → «Motiu pendent de revisió». La IA és opcional i només s'activa si Direcció ha registrat les garanties de confidencialitat (envia dades estructurades i els fragments de les regles aprovades, mai el contracte sencer).

**Integració:** comercialitzadores (contactes, termini de pagament, regles de retrocessió), motor de comissions i conciliació, tasques, incidències (obrir-ne una al client des d'una línia), notificacions (assignació, regularitzacions, recordatoris i reclamacions sense resposta, al cron diari) i Centre de Control (3 indicadors nous).

**Permisos:** Direcció i l'administració amb permís «economia». La persona interna a qui s'assigna una reclamació hi té accés (només a aquella). Mai comercials, caps d'equip ni col·laboradors (comprovat al servidor i a la RLS).

## 3. Proves

| Prova | Com | Resultat |
|---|---|---|
| Pestanya Documents i la resta de pestanyes (Resum, Energia, Renovació, Comunicacions, Seguiment, Historial) amb clients amb documents, sense documents, registres trencats i un fitxer inexistent | Playwright sobre la versió local (dades fictícies) | **Simulació**: cap error |
| Error boundary amb dades corruptes | Playwright | **Simulació**: avís i CRM operatiu |
| Documents del client, permisos i casos sense vincle | vitest (Supabase simulat) | 9 proves OK |
| Detecció (exemple Iberdrola: 175 correctes, 15 per sota, 7 pendents, 3 retrocessions), precisió en cèntims, terminis i excepcions, hipòtesis, regularitzacions, correu i PDF | vitest | OK |
| Creació només amb reclamables, duplicats, assignació i notificació, enviament amb confirmació i PDF adjunt, accés de la persona assignada, comercial sense accés, regularitzacions i avisos | vitest (Supabase simulat, correu simulat) | OK |
| Migració 018 sobre PostgreSQL real (PGlite): RLS per rol, duplicats, estats, bloqueig després d'enviar, historial només d'afegir, totals, seguiment, idempotència i `_down` | vitest | 12 proves OK |
| Pantalla de reclamacions: panell, selecció de les 25 elegibles (3.200,00 €), «Per què?», generar, expedient i confirmar regularització | Playwright amb respostes del servidor simulades | **Simulació**: OK |
| `npm run typecheck`, `test` (601), `lint` (0 errors), `build` | | OK |

**No provat de debò:** enviament SMTP real, emmagatzematge a Supabase Storage, RLS al Supabase de producció i la lectura amb IA. Cal provar-ho a la Preview de Vercel després d'aplicar la 018.

## 4. Pendent / limitacions
- Cal registrar a cada comercialitzadora el **termini de pagament** (condició «Pagament» aprovada) perquè els contractes no liquidats es puguin marcar com a reclamables; sense termini queden «Cal revisar».
- Els justificants admeten fins a 3 MB per fitxer (límit de Vercel per petició).
- Els recordatoris s'avisen amb el cron diari (05:00 UTC), no a l'hora exacta.
- L'import mínim per reclamar una diferència és 1,00 € (configurable al codi).

## 5. Lector IA unificat de condicions comercials (comissions, decomissions i retrocessions)

**Errors corregits**
- «La IA no ha retornat l'estructura esperada»: n'hi havia prou amb una sola condició mal formada per rebutjar tota la lectura. Ara la IA respon amb una **eina d'estructura obligatòria** (tool use) i cada condició es valida per separat (es corregeixen formats com «25,00» o «€/MWh»; les que no es poden fer servir es descarten i s'avisa).
- «El contracte és massa llarg»: no era el document (24 pàgines), sinó la resposta (fragments llargs per condició amb un límit de 16.000 tokens). Ara: fragments de màxim 220 caràcters, límit de 32.000 tokens i **streaming**. Si la resposta es talla per mida o per temps, es desa el que és complet i s'avisa.
- `temperature` ja no s'envia (el model actual el rebutja) i els errors del proveïdor mostren el motiu real.

**Interpretació creuada (una sola càrrega, una sola lectura del document sencer)**
- La IA construeix el catàleg de productes/tarifes i, per a cada condició, indica a quins productes s'aplica, la clàusula, **totes les pàgines**, les excepcions (amb pàgina i efecte), quines condicions particulars prevalen sobre les generals i les relacions comissió ↔ retrocessió.
- Una retrocessió només s'aplica a tots els productes si el document ho diu explícitament; si l'abast no és clar, queda en «REVISIÓ MANUAL NECESSÀRIA».
- Contradiccions entre apartats, fragments que no apareixen literalment al document, percentatges sense base i retrocessions sense període de risc → revisió manual.
- **Comprovació de coherència** (2a lectura automàtica): busca condicions oblidades, abasts incorrectes, excepcions no aplicades, valors mal llegits i confusions entre permanència, liquidació i retrocessió. Les noves s'afegeixen per revisar; les afectades passen a revisió manual.
- Formats: PDF (també escanejats, amb OCR de la IA), Word, **Excel i CSV** (nou), JPG i PNG.

**Revisió i importació**: a la fitxa de la comercialitzadora, taula única *Comercialitzadora · Producte · Comissió · Decomissió / retrocessió*. Cada fila s'obre amb comissions, retrocessions (les de risc en vermell), excepcions, relacions, fragments i pàgines, versió anterior aprovada i **risc econòmic** (retrocessió potencial dels contractes vius i marge net estimat, amb permís econòmic). Botó **APROVAR I IMPORTAR CONDICIONS COMERCIALS**: importa comissions i retrocessions vinculades a la mateixa versió del contracte (les de revisió manual exigeixen confirmació). Accés també des de *Economia → Lector IA de condicions*.

**Proves**: document de prova real `tests/fixtures/contracte-prova-condicions.pdf` (24 pàgines; comissions pàg. 3, liquidació pàg. 7, objectius pàg. 12, retrocessions pàg. 18, excepcions pàg. 21). Es llegeix el PDF de debò i es prova tot el circuit (lectura, relacions, fitxa per producte, comprovació de coherència, resposta tallada, errors). **La resposta de la IA està simulada** en aquestes proves: falta la prova real amb la IA a la Preview (vegeu el resum de lliurament).

### 5.1 Correcció P0 (error 400 `tool_choice`) i diagnòstic real

- **Causa:** `src/server/ai-reader.ts` → `callTool()` enviava `tool_choice: { type: "tool" }`, que `claude-sonnet-5-5` no admet (tampoc `temperature`, ja retirat).
- **Solució:** l'eina es passa com a format de resposta sense `tool_choice` (mode automàtic) i les instruccions obliguen a respondre-hi. Es llegeixen els dos formats del flux (`input_json_delta` i `text_delta`). Si el model respon en text, se n'extreu el JSON. Si rebutja les eines, es reintenta automàticament amb l'esquema com a JSON. Una resposta buida o sense condicions és un error, mai una extracció correcta. Cada error porta un identificador de diagnòstic (també al registre de Vercel, sense dades sensibles).
- Afecta les dues crides del lector: lectura (comissions, decomissions, retrocessions i relacions entre pàgines) i segona passada de coherència.
- **Diagnòstic real** (Administració → Comercialitzadores → «Diagnòstic del lector IA», només Direcció): comprova la clau, el model, les garanties i l'OCR; fa una lectura real del contracte de prova integrat i hi passa 11 comprovacions; fa la segona passada. No desa res.
