# Fase 10.1 · Tarifa Open d'Endesa: ponderació horària, vista doble i xat — informe

Branca: `feature/fase10-agenda` (continua la Fase 10). No toca `main`. Migració nova: **022** (additiva, idempotent, amb `_down`).

## Què fa
1. **Lector local de la Tarifa Open (3.0TD i 6.1TD), sense IA.** En pujar o arrossegar el PDF al lector de tarifes (Catàleg de tarifes → «Llegir fitxer de tarifes»), el CRM en llegeix:
   - els trams de potència;
   - els preus Plana, Día, Laboral, Fin de Semana, Noche i Horas No Open (amb els descomptes inclosos);
   - el preu base sense descompte i els descomptes que se'n dedueixen (15/20/25/45/55 % + 7 % a la 3.0TD);
   - el terme de potència en €/kW·any;
   - els horaris de cada modalitat;
   - la vigència comercial i la versió del document.

   Funciona encara que no hi hagi clau d'IA.
2. **Calendari horari real.** Motor nou (`src/comparator/open-calendar.ts`) que coneix:
   - els períodes P1–P6 dels peatges 3.0TD/6.xTD a la Península, segons la Circular CNMC 3/2020;
   - les temporades;
   - els dies laborables, els dissabtes i diumenges, i els festius nacionals de data fixa;
   - l'hora d'Europe/Madrid amb els canvis d'hora (dies de 23 i de 25 hores) i els anys de traspàs.

   El període de referència és configurable: els 12 mesos des del mes vinent, o un any concret. La biblioteca de regles ja admet afegir o treure festius, però encara no hi ha cap pantalla per editar-los.
3. **Ponderació per hores.** Per a cada període es calcula: Preu P = (hores Open × preu Open + hores No Open × preu No Open) / hores totals. Es fa amb precisió completa i només s'arrodoneix el resultat, a 6 decimals.
   - Plana: el mateix preu als 6 períodes.
   - Día i Noche: els preus es ponderen per hores.
   - Laboral i Fin de Semana: s'aplica la regla de conversió de Direcció.
4. **Tram per potència P6.** El tram es tria sempre per la P6, amb el límit inferior exclòs i el superior inclòs. Al comparador, una oferta Open d'un altre tram, o un subministrament sense P6, no s'ofereix: mai es barregen trams.
5. **Discrepàncies.** Es compara la regla de Direcció amb l'horari del document, període a període, en hores i en preu. Si no coincideixen, la conversió queda «pendent de validar» i les ofertes es desen en esborrany fins que Direcció l'aprovi. Amb els PDF de la versió 07 surten aquestes diferències:
   - 3.0TD Noche: Direcció diu de dilluns a divendres; el document diu tots els dies.
   - 3.0TD i 6.1TD Fin de Semana: la regla «P6 Open» no coincideix amb el document a les nits laborables.
   - 6.1TD Día: el document posa Open de 18 a 24 h els caps de setmana.
   - 6.1TD Noche: el document posa Open de 0 a 18 h els caps de setmana.
6. **Vista doble.**
   - Esquerra: el PDF original amb tot el que s'ha llegit i la pàgina d'origen.
   - Dreta: la taula P1–P6 amb hores Open, hores No Open, % Open, una barra visual i el preu en gran amb 6 decimals.
   - Controls: modalitat, potència P6 o tram, període de referència i un botó per mostrar les fórmules.
   - També hi ha els horaris aplicats, les discrepàncies i un resum de les cinc modalitats.
   - Etiqueta «PREU ESTIMAT PER PONDERACIÓ HORÀRIA», amb la nota explicativa.
7. **Xat.** Explica qualsevol període: hores, percentatges, preus originals, fórmula i resultat. També entén correccions d'horari («La Noche és de 0 a 8 tots els dies»):
   - en proposa la regla;
   - la recalcula als 6 períodes;
   - la desa a la biblioteca: aprovada directament si ho fa Direcció, o com a proposta si ho fa l'administració.

   Funciona sense IA amb el motor local. Si la IA està configurada, contesta les preguntes obertes, però només amb les dades calculades: no se li envia el PDF.
8. **Biblioteca de regles (Supabase, migració 022).**
   - Les regles aprovades es carreguen soles amb els documents equivalents: mateixa comercialitzadora, producte, peatge i versió. La més específica guanya.
   - Hi ha excepcions per producte i per versió.
   - Res no s'esborra: una regla nova substitueix l'anterior i en queda l'historial.
9. **Comparatives.**
   - **Sense corba horària:** es fan servir els preus ponderats. La línia d'energia es marca com a estimada i surt l'avís «l'estalvi calculat és estimat».
   - **Amb corba horària:** a «Validació» hi ha una zona nova per arrossegar el CSV de Datadis o de la distribuïdora. Aleshores el cost es calcula aplicant el preu Open o No Open hora a hora, i s'indica que és una estimació i no una factura.
   - Els descomptes no s'apliquen dues vegades (ja són dins del preu) i no s'afegeix SAS.
   - Els preus originals Open i No Open es guarden amb cada oferta; no se substitueixen.
10. **Arrossegar i deixar anar a tot arreu.** S'ha afegit un component reutilitzable (`DropArea`) a tots els punts d'adjunts que no en tenien:
    - plantilla d'ofertes;
    - importació de configuració i logotip;
    - factures de l'oportunitat;
    - versió nova d'un document de la fitxa;
    - conciliació;
    - justificant de reclamació;
    - logotip del catàleg;
    - contracte i logotip de la comercialitzadora;
    - documents de l'expedient i signatura manuscrita;
    - logotip de l'eina energètica;
    - factura del portal de col·laboradors.

    Els punts que ja en tenien (documents de la fitxa, factures del comparador, lector de tarifes, importació SIPS, formulari públic) es mantenen.

## Fitxers principals
- **Nous:**
  - `src/comparator/open-calendar.ts`
  - `src/comparator/endesa-open.ts`
  - `src/comparator/open-chat.ts`
  - `src/server/tariff-open.ts`
  - `app/api/tariffs/open/route.ts`
  - `src/ui/views/comparatives/OpenDualView.tsx`
- **Modificats:**
  - `src/server/tariff-ai.ts`
  - `src/comparator/engine.ts` i `types.ts`
  - `TariffAiReader.tsx`, `StepValidate.tsx` i `DropZone.tsx`
  - les pantalles d'adjunts de la llista del punt 10

## Proves
| Prova | Tipus | Resultat |
|---|---|---|
| 1–8, 12 i xat: `tests/endesa-open.test.ts` (21 proves) amb els **PDF reals** 3.0TD i 6.1TD: preus, trams per P6, Día, Noche, Plana, Laboral, Fin de Semana, hores anuals (contrastades amb un recompte independent fet amb Intl), festius, canvis d'hora, any de traspàs, comparatives amb i sense corba, CSV de Datadis, xat | **Provat de debò** (lector i càlculs reals) | 21/21 OK |
| 11: `tests/db/regles-tarifes-rls.test.ts`: qui proposa i qui aprova, una regla aprovada per clau, no es reescriu ni s'esborra | **Provat de debò** sobre Postgres local (PGlite), no sobre el Supabase real | 3/3 OK |
| 9, 10, 13: `e2e/tarifes-open.e2e.cjs` (Playwright): arrossegar el PDF real, vista doble, canvi de tram i any, fórmules, discrepàncies, xat amb correcció i desar a la biblioteca, desar les 10 ofertes, arrossegar en una altra pantalla | **Provat amb simulació** (navegador real; respostes de l'API simulades) | 6/6 OK |
| typecheck · lint (0 errors) · 699 proves vitest · build de producció | Codi | OK |

**No provat de debò:** la persistència real a Supabase (cal executar la 022), la resposta de la IA al xat (sense clau no s'activa) i el drag & drop pantalla per pantalla en un navegador amb dades reals. N'hi ha un de comprovat amb Playwright i la resta fan servir el mateix component.

## Pendent i limitacions
- Calendari per a Balears, Canàries, Ceuta i Melilla: no implementat. La ponderació és per a la Península, i les ofertes Open queden limitades a la Península.
- Festius autonòmics i locals: no compten als efectes elèctrics; només els festius nacionals de data fixa (configurable).
- Si s'edita a mà el preu P1–P6 d'una oferta Open al catàleg, les metadades de la ponderació no es recalculen. Cal tornar a llegir el PDF.
