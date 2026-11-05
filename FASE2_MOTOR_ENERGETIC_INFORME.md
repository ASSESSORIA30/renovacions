# Fase 2 · Motor energètic, excedents i permanència

Branca proposada: `feature/fase2-motor-energetic`, creada a partir de la branca de la Fase 1 (catàleg únic).
**No cal cap SQL nou.** La regla de permanència es desa a la taula `sec_settings`, que ja existeix (clau `permanencia`). Només Direcció la pot canviar.

## Què canvia

### 1. Preu de l'energia desglossat a la factura
- El lector separa l'energia lliure, l'ATR (o els peatges i els càrrecs), els ajustos, els descomptes i altres conceptes per període, i en calcula el preu total.
  - Exemple fictici amb el format de Nufri: P3 0,019279 + 0,214655 = 0,233934 · P4 0,206837 · P6 0,234553.
- No es compta res dues vegades:
  - Si l'ATR i el detall de peatges i càrrecs no quadren, el període queda **pendent**.
  - Un total que no coincideix amb la suma dels components també queda pendent.
  - Un import en € no es fa servir com a preu en €/kWh.
- Pantalla «Validació»:
  - preu total per període, amb el detall desplegable;
  - cada component es pot corregir a mà, i es guarda el valor original (botó «Original»);
  - estat de cada període: reconstruït, directe o pendent.
- La lectura amb IA (si està activa) segueix les mateixes regles. Si el text ja s'ha llegit bé, la IA no el sobreescriu.

### 2. Compensació d'excedents al catàleg
- Nova secció a l'editor de tarifes:
  - Sí/No i modalitat: preu fix, per períodes, indexada o bateria virtual;
  - mecanisme: compensació simplificada, venda o altres;
  - preus, fórmula i dates de vigència;
  - bateria virtual: cost, acumulació, ús i caducitat;
  - límits i observacions.
- Si no hi ha dades, la tarifa queda com a **«Compensació no informada»**. Mai es posa un preu per defecte.
- Importació:
  - Excel: noves columnes reconegudes (preu d'excedents, modalitat, bateria, penalització).
  - IA: detecta les paraules clau (Compensación de excedentes, Batería virtual, Monedero solar…). Si el document les esmenta però no en dona les condicions, la tarifa queda com a no informada, amb una nota.

### 3. Excedents fotovoltaics a la comparativa
- Pantalla «Validació», nova secció «Excedents fotovoltaics»:
  - kWh anuals, per període i mensuals;
  - compensació i modalitat actuals;
  - bateria virtual i saldo.
- El lector de factures omple aquests camps. Els excedents no se sumen mai al consum de xarxa.
- Càlcul per a cada oferta:
  - Compensació simplificada amb el límit legal: mai supera el terme d'energia.
  - Sense bateria, el sobrant es perd. Amb bateria, el sobrant va al saldo, que es mostra a part, i la quota de la bateria s'afegeix al cost.
  - Indexada sense preu: pendent, no es quantifica.
- La taula «Excedents fotovoltaics» té les files Consum, Cost energia, Cost potència, Excedents kWh, Preu, Compensació, Bateria virtual, Cost total net i Estalvi.
  - És la mateixa a la pantalla i al PDF, perquè totes dues surten del mateix càlcul.
  - Només apareix quan hi ha excedents.

### 4. Permanència
- Regla per defecte: les tarifes de preu fix 3.0TD i 6.1TD han de tenir permanència. Direcció la pot configurar a Catàleg › Tarifes.
- Editor de la tarifa:
  - camps: estat (amb, sense, no informada), mesos, inici, cancel·lació, penalització i font;
  - excepció documentada, que només pot posar Direcció.
- Mai s'inventen 12 mesos. Si la durada no és coneguda:
  - la tarifa no es pot activar;
  - la comparativa mostra una incidència;
  - el botó «Emet la proposta» queda bloquejat. El servidor també ho bloqueja.
- Pantalla i PDF: «Permanència: 12 mesos» o «Permanència obligatòria: pendent de confirmar». «Sense permanència» només surt si consta expressament.
- Les propostes ja emeses no canvien: el motor passa a la versió 1.1.0, i les comparatives fetes amb la 1.0.x mantenen el text original.

## Proves
- `npm run typecheck`: correcte.
- `npm run test`: 1.015 tests superats, 25 d'ells nous (`tests/fase2-motor-energetic.test.ts`, punts 1–17).
- `npm run lint`: 0 errors (els 4 avisos ja hi eren abans).
- `npm run build`: correcte.
- Ajust de tests existents: 4 tests de Naturgy (`tests/naturgy-lector-integrat.test.ts`). Les 18 tarifes fixes 3.0TD/6.1TD del fitxer no porten permanència i ara surten «per revisar», que és el comportament que demana la regla.
- Tot està provat amb simulació i dades fictícies. **No s'ha provat amb la factura real de Nufri**, perquè no l'he rebuda.

## Pendent
- Provar el lector amb una factura real de Nufri i amb una amb excedents (provat de debò ≠ provat amb simulació).
- Revisar les tarifes fixes 3.0TD/6.1TD actives: les que no tenen la permanència informada no es podran fer servir per emetre propostes fins que es completi.
- Fase 3: redisseny del PDF.
