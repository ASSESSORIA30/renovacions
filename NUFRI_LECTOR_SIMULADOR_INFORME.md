# Nufri · Lector local d'annexos i simulador dinàmic de marges BOE

Branca proposada: `feature/nufri-lector-marges`, creada a partir de la branca de la Fase 3 (PDF de comparatives).
SQL: **031_nufri_matriu_comercial.sql**, que s'aplica després de la 030.

## Què fa

### 1. Lector local de Nufri (sense IA)
- Quan es puja un PDF a **Catàleg de tarifes › Llegir fitxer de tarifes**, el sistema reconeix pel contingut, no pel nom del fitxer, si és un annex de Nufri, i el llegeix en local. No cal la clau d'IA.
- **Electricitat 2.0TD i 3.0TD:**
  - els cinc nivells (FUJI 2, GOLDEN 6, GALA 10, GALAXY 15 i ROYAL G 20 €/MWh);
  - preus per períodes i preu únic;
  - les files «30 % descuento» de la 3.0TD com a preus ja descomptats: l'original es guarda a part i no s'aplica cap descompte més;
  - els marges de potència amb els preus publicats: BOE, BOE+2, BOE+4 i BOE+6 a la 2.0TD, i BOE, BOE+2 i BOE+4 a la 3.0TD (no hi ha BOE+6).
- **Indexada elèctrica:** la taula CO → comissió, la fórmula literal, K = 0,018 (coeficient) i la definició de cada component.
- **Excedents:** 2.0TD 0,040 €/kWh (fins a 15 kW) i 3.0TD 0,030 €/kWh. La modalitat indexada (OMIE − 5 €/MWh) es conserva com a fórmula. La Reserva Virtual no s'inclou, perquè el document no n'indica el cost.
- **Gas:**
  - RL1–RL4 amb els rangs de consum i els quatre nivells (CONFERENCE, BARLET, DEVOE, WILLIAM'S);
  - preus fixos de 12 mesos;
  - constants C de la indexada (1,0379 × PVB + C);
  - comissions de la modalitat fixa i de la indexada per separat.
- **Terme fix del gas:** el document no n'indica la unitat. No se n'assumeix cap: Direcció la confirma a la previsualització abans d'activar les tarifes.
- **Condicions:**
  - validesa fins a un annex nou, sense inventar cap data de fi;
  - límit de 100 MWh i només clients nous;
  - energia verda inclosa a la 2.0TD i no inclosa a la 3.0TD;
  - SAS no inclòs;
  - gas: només punts no telemesurats i oferta personalitzada per a RL.4 a partir de 200 MWh.
- **Comprovacions automàtiques:** nombre de cel·les, 30 % = original × 0,7, ordre dels nivells i marges creixents. Si alguna cosa no quadra, es mostra com a error de lectura i no es dona per bona.
- **Previsualització abans d'importar:**
  - seccions separades: 2.0TD, 3.0TD, indexada, gas fix i gas indexat;
  - taules desplegables i condicions;
  - avisos separats en tres tipus: errors de lectura, dades no informades i dades que necessiten aprovació;
  - simulació del gas indexat amb un PVB de referència, marcada com a estimada.
- **Importació:** un producte per peatge i modalitat. El nivell i el marge són variants del mateix producte, no productes duplicats.
  - Tot entra en esborrany, amb versions i sense duplicats.
  - Un annex més antic no pot substituir mai un de més recent: el servidor també ho bloqueja.
- **Comissions:**
  - Només les veuen Direcció i l'Administració autoritzada. El servidor les elimina de la resposta per a la resta d'usuaris.
  - El botó «Proposa les comissions a Direcció» crea les regles pendents d'aprovació. Si es torna a prémer amb els mateixos valors, no es dupliquen.

### 2. Simulador de marges (Catàleg › botó «Marges»)
- Hi entres les potències P1–P6, el consum, els dies i el % del col·laborador, i hi tries el nivell i el marge BOE. Tot es recalcula a l'instant.
- Mostra els preus del client, el cost de potència i el total (amb el motor de comparatives existent), i la comissió d'energia i de potència per separat.
- També mostra la comissió total, la part del col·laborador i la part per a Assessoria 3.0.
- Hi ha una taula amb totes les modalitats BOE alhora, amb els mateixos dies, potències i consums. La modalitat triada surt destacada.
- Regla de Direcció per a Nufri: **comissió de potència = suma dels kW de tots els períodes × marge** (P1+P2 a la 2.0TD; P1…P6 a la 3.0TD). Aquesta fórmula no s'aplica a cap altra comercialitzadora.

### 3. Comparatives i PDF
- A «Ajustos d'aquesta comparativa» es poden triar el nivell (FUJI…ROYAL G) i el marge BOE de cada tarifa de Nufri. Els preus i el cost es recalculen amb el mateix motor.
- La combinació queda desada a la comparativa. El PDF del client mostra el producte amb el nivell, però mai cap comissió ni el marge BOE.

### 4. Contracte, comissions i conciliació
- Quan s'activa l'expedient (contracte formalitzat), queden vinculats i congelats:
  - la tarifa i la versió del catàleg;
  - el nivell i el marge;
  - les potències i el consum anual;
  - els preus acceptats;
  - la comissió prevista d'energia i de potència i el total, amb la versió de la regla;
  - el col·laborador i el seu percentatge.
- Els canvis posteriors del catàleg o de les regles no modifiquen el contracte.
- Nou tipus de regla «energia_potencia»: calcula energia i potència per separat.
- La conciliació compara cada línia de la liquidació amb el component que li toca: d'energia, de potència o el total.
- Les línies repetides en diverses liquidacions continuen marcades com a duplicades.

## Proves
- **De debò, amb els PDF reals de Nufri del 05/11/2026** (`tests/nufri-reader.test.ts`): 19 tests amb els valors copiats de les taules originals, inclosos els valors de control de potència de l'encàrrec.
- **Amb simulació** (`tests/nufri-simulador.test.ts`): 13 tests.
  - 2.0TD amb BOE…BOE+6 i 3.0TD amb BOE…BOE+4.
  - 40 kW × 6 × 2 = 480 € i × 4 = 960 €, i potències diferents a cada període.
  - Col·laborador 30 %.
  - Coherència entre simulador, comparativa i PDF.
  - Vinculació al contracte sense reescriure'l, i conciliació per components.
  - La base de dades és un Supabase simulat.
- **Migració 031 sobre PostgreSQL de prova (PGlite)** (`tests/db/nufri-matriu-rls.test.ts`): 3 tests.
- **Comprovacions finals:** typecheck correcte, 1.075 tests superats, lint sense errors i build correcte.
- **No provat de debò:** la pantalla de previsualització i el simulador no s'han provat en un navegador amb dades reals. La importació i la vinculació a Supabase només s'han provat amb simulació.

## Pendent i decisions de Direcció
- **Terme fix del gas:** confirmar-ne la unitat (€/mes, €/any o €/dia) amb Nufri.
- **Base de la comissió de potència:** aplicada segons la regla confirmada (suma de kW). L'encàrrec del lector demanava verificar-la amb el contracte d'agents o amb una liquidació real de Nufri. Les regles queden pendents d'aprovació fins que Direcció les validi.
- **Tarifes fixes 3.0TD:** l'annex no indica permanència, i la regla de permanència obligatòria en bloqueja l'activació fins que s'informi.
- **Descompte del 30 %:** confirmar-ne les condicions (durada i requisits).
