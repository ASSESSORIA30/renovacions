# Càlcul automàtic de comissions i regularització històrica

Branca: `fix/calcul-automatic-comissions` · Migració: `059_calcul_automatic_comissions.sql` (i `_down`).

## Causa de l'error
`contractAction` (`src/server/crm.ts`) desava els contractes d'energia (alta, renovació i edició) però **no cridava mai el motor de comissions**. Només els multiservei recalculaven (`refreshServiceCommission`). El càlcul d'energia (`calculateContract`) només s'executava si Administració premia «Calcula» a la fitxa econòmica. A més, el motor no feia servir el col·laborador del contracte i agafava el servei de l'expedient encara que el CUPS fos de gas. Per això alguns gasos sortien com a electricitat i no els trobava cap regla de gas.

## Què canvia
- **Motor únic** (`runCalculation`, a `finance.ts`): és el mateix càlcul de sempre. Primer el proveïdor; després el comercial i el col·laborador. És idempotent per `calc_hash` i, si dues desades arriben alhora, la segona reaprofita la primera. `calculateContract` (botó «Calcula») el fa servir sense canviar de comportament.
- **En desar un contracte d'energia** (`commission-auto.ts`):
  - comprova si el contracte està protegit;
  - calcula amb el client de servidor, perquè els comercials no tenen permís d'escriure càlculs. Els imports surten només de les regles i de les dades desades;
  - desa una instantània a `fin_calculations`. Mai crea moviments, meritacions, liquidacions, factures ni pagaments;
  - torna el resultat perquè la pantalla el mostri. Els imports només els veuen Direcció i l'Administració autoritzada.
- **Pendents amb motiu**: si falten dades, no hi ha regla o la regla no està aprovada, el càlcul queda pendent amb el motiu i sense import (mai un 0 €).
- **Errors**: si el càlcul falla, el contracte es desa igualment i el contracte queda a `fin_calc_pending`. La fitxa econòmica mostra l'avís. «Calcula» o la regularització el reintenten.
- **Servei**: el tipus d'energia del CUPS mana. Un CUPS de gas sempre es desa i es calcula com a gas, i un CUPS d'electricitat mai com a gas.
- **Col·laborador**: precedència contracte → expedient → client. Mai s'assigna un col·laborador arbitrari. La comissió del proveïdor es calcula encara que no hi hagi col·laborador.
- **Regularització** (`commission-regularize.ts`, Economia › Regles, només Direcció):
  - primer, una **revisió en simulació** obligatòria, per lots de 50, que no escriu res;
  - després, «Aplica un lot (25)». Es basa en la darrera revisió completada (com a màxim de 7 dies) i torna a comprovar cada contracte just abans d'escriure;
  - classifica cada contracte com a calculable, pendent de dades, pendent de regla, protegit o conflicte;
  - els protegits i els conflictes no es toquen mai;
  - tot queda registrat a `fin_regularization_runs` i `fin_regularization_items`.

## Contractes protegits (mai es recalculen automàticament)
Un contracte queda protegit si té qualsevol d'aquests elements:
- moviments a `fin_ledger`;
- línies de liquidació;
- extractes del proveïdor vinculats;
- comissió manual, meritada, liquidada, cobrada o retrocedida a `crm_contract_finance` o a `crm_commission_records`;
- liquidacions històriques (`fin_hist_lines`);
- anul·lació o penalització;
- un servei incoherent amb el CUPS.

## Fora d'abast (sense canvis)
- La importació massiva de cartera. Aquests contractes es cobreixen amb la regularització.
- El recàlcul en editar només el subministrament.
- Els contractes multiservei, que continuen igual.
