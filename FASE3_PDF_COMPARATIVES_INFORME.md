# Fase 3 · Redisseny del PDF de comparatives

Branca proposada: `feature/fase3-pdf-comparatives`, creada a partir de la branca de la Fase 2.
**No cal cap SQL.**

## Què canvia

### PDF en A4 horitzontal, amb 4 columnes
- **Capçalera:**
  - logotip oficial i «ASSESSORIA 3.0»;
  - franja de blau petroli amb un degradat i un traç verd;
  - títol «Comparativa de tarifes elèctriques» (o «de gas»), amb la tarifa d'accés i el nombre de períodes.
- **Fitxa del subministrament:**
  - client i CUPS;
  - període analitzat, amb les dates de la factura si es coneixen;
  - consum total;
  - potència contractada (al gas, els dies facturats);
  - comercialitzadora actual.
- **Columnes:** ACTUAL | OPCIÓ 1 | OPCIÓ 2 | OPCIÓ 3.
  - Cada columna mostra el nom real de la comercialitzadora i de la tarifa.
  - Cada columna té el seu color, que es manté a tot el document.
  - L'ordre és el mateix que a la pantalla.
  - La millor opció calculable i elegible queda destacada.
- **Blocs del full:**
  - **Energia:** P1–P6 amb consum, preu i import de cada opció, i el total. Un preu únic (24 h) s'aplica a cada període. No s'inventen períodes que la tarifa no té.
  - **Potència:** P1–P6 amb kW, €/kW·dia i import, calculat amb els dies reals. Al gas, aquest bloc és el del **terme fix**.
  - **Descomptes i SAS:** descompte sobre energia, descompte sobre potència, SAS/SSAA i serveis. Només surten les files que tenen dades.
  - **Excedents / autoconsum:** només si el client té excedents. Mostra kWh, modalitat, preu, import compensat i bateria virtual. Si falta la dada, posa «No informat», mai un zero.
  - **Altres conceptes:** lloguer d'equips, impost elèctric (al gas, el d'hidrocarburs), base imposable i IVA/IGIC.
  - **Condicions:** permanència, en taronja si està pendent de confirmar; tipus de preu i vigència; penalitzacions.
- **Franja de totals:** el total de les quatre opcions, amb el període que correspon: «anual», «anual, estimació» o «període facturat · N dies». Mai es diu «mensual» si el càlcul no ho és.
- **Franja d'estalvi:** l'estalvi de cada alternativa respecte de l'actual, en € i en %. Les opcions més cares surten en vermell.
- **Imports estimats:** porten un asterisc (indexades, SAS variable, excedents estimats).
- **Pàgines següents:**
  - la recomanació i les observacions, si n'hi ha;
  - a la versió «detallada», també el desglossament del càlcul de cada opció, les hipòtesis i el comparador fix/indexat.

### Mateix càlcul que la pantalla
- El motor (versió 1.1.0) ara també desa l'import de cada període. És el mateix càlcul de sempre; no hi ha cap segon motor.
- El PDF agafa totes les xifres del resultat desat:
  - els totals, els subtotals d'energia i potència i els estalvis coincideixen exactament amb la pantalla;
  - la suma dels imports de cada període quadra amb el subtotal, amb un marge d'1 cèntim per fila pels arrodoniments.
- Les comparatives antigues, desades sense el detall per període, també es poden imprimir: surten els totals i els preus, i els imports per període queden en blanc.
- Les funcions de descarregar, enviar per correu, WhatsApp i vincular a Clients 360° no canvien.

## Proves
- `npm run typecheck`: correcte.
- `npm run test`: 1.040 tests superats, 25 d'ells nous (`tests/fase3-pdf-comparatives.test.ts`).
- `npm run lint`: 0 errors.
- `npm run build`: correcte.
- He generat i revisat visualment PDFs de 2.0TD, 3.0TD (amb excedents, SAS variable, bateria i permanència pendent), 6.1TD (anual, amb una indexada) i gas RL.2 en castellà. No hi ha textos tallats ni columnes desplaçades.
- Tot amb dades fictícies (provat amb simulació). No s'ha provat amb factures reals de clients.

## Pendent
- Revisar el PDF amb una comparativa real.
- La pantalla de resultats manté el seu disseny actual. Si es vol, es pot fer que mostri el mateix full de 4 columnes que el PDF.
