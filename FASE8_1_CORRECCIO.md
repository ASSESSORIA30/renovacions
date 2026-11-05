# Fase 8.1 · Pas 1 — Correcció del Centre de Control i la Supervisió

Branca: `fix/fase8.1-relacions-dashboards` (creada a partir de la Fase 8 estable).
Aquesta branca **només canvia codi**: no té migracions, no toca variables d'entorn, ni el login, ni l'MFA, ni les dades.
No s'ha fusionat a `main` ni s'ha desplegat a producció.

## 1. Error

```
Could not embed because more than one relationship was found for 'crm_contracts' and 'crm_supplies'
```

Codi PostgREST `PGRST201`. Les pantalles **Centre de Control** (`/api/control?r=control`) i **Supervisió** (`/api/control?r=cap`) no carregaven.

## 2. Causa (llegida de l'esquema real, no suposada)

S'han aplicat totes les migracions (001–015) a un PostgreSQL real (PGlite) i s'ha llegit `pg_constraint`.
Entre les dues taules hi ha **dues** claus foranes legítimes:

| Constraint | Sentit | Significat |
|---|---|---|
| `crm_contracts_supply_id_fkey` | `crm_contracts.supply_id → crm_supplies.id` (N:1) | Subministrament **del contracte** |
| `crm_supplies_current_contract_fk` | `crm_supplies.current_contract_id → crm_contracts.id` | Contracte **vigent** del subministrament |

Una consulta `crm_contracts?select=…,crm_supplies(annual_kwh)` no indica quina de les dues fer servir, i PostgREST la rebutja.
**No s'ha eliminat cap clau forana.** Totes dues continuen sent necessàries.

## 3. Consultes corregides

El detector automàtic ha trobat **3** consultes afectades (no només les 2 pantalles inicials):

| Fitxer | Funció | Pantalla afectada | Canvi |
|---|---|---|---|
| `src/server/control.ts` | `loadOps` | **Centre de Control** i **Supervisió** | `crm_supplies!crm_contracts_supply_id_fkey(annual_kwh)` |
| `src/server/control.ts` | `commercialPanel` | Panell del comercial (MWh i contractes del mes) | ídem |
| `src/server/finance.ts` | `computeIncentives` | Economia → incentius per trams de volum | `crm_supplies!crm_contracts_supply_id_fkey(annual_kwh,energy_type)` |

La relació correcta per als KPI és sempre la primera (`crm_contracts_supply_id_fkey`): retorna **un sol** subministrament per contracte i no pot duplicar files.

### Errors silenciosos que també s'han tancat
- `commercialPanel` ignorava l'error de la consulta i mostrava **0 contractes i 0 MWh** sense avisar. Ara l'error es mostra.
- `loadOps` tractava qualsevol error «relació no trobada» com «la taula encara no existeix» i retornava una llista buida.
  Per a la taula de contractes ara és estricte: si la relació falla, es veu l'error en comptes de KPI a zero.

## 4. Proves

| Prova | Resultat |
|---|---|
| `tests/db/embed-ambiguity.test.ts` — escaneja **totes** les consultes de `app/` i `src/` i comprova contra l'esquema real que cada incrustació resol a exactament **una** relació | ✅ (abans de la correcció fallava i assenyalava les 3 consultes) |
| `tests/db/kpi-relations.test.ts` — dades reals a PostgreSQL: contracte renovat sobre el mateix CUPS, contracte sense subministrament; comprova que no hi ha duplicacions i que els MWh surten bé (29 MWh), i que la relació incorrecta n'hauria donat 17 | ✅ |
| Suite completa (regressió fases 1–8) | ✅ 497/497 tests, 29 fitxers |
| `tsc --noEmit` | ✅ |
| `eslint` | ✅ 0 errors (4 avisos que ja hi eren a la Fase 8) |
| `next build` | ✅ |
| **PostgREST real** | 🟡 Pendent: no s'ha pogut executar PostgREST en aquest entorn. Cal comprovar-ho a la Preview (punt 5). |

## 5. Abans de fusionar: comprovació a Supabase (només lectura)

Al **SQL Editor** de Supabase, executa això. No modifica res:

```sql
select conname, conrelid::regclass as taula, confrelid::regclass as referencia
from pg_constraint
where contype = 'f'
  and ((conrelid = 'public.crm_contracts'::regclass and confrelid = 'public.crm_supplies'::regclass)
    or (conrelid = 'public.crm_supplies'::regclass  and confrelid = 'public.crm_contracts'::regclass));
```

Resultat esperat: dues files, `crm_contracts_supply_id_fkey` i `crm_supplies_current_contract_fk`.
**Si el nom de la primera fos diferent, no fusionis**: avisa'm i adaptaré el nom.

## 6. Preview de Vercel

1. Puja la branca `fix/fase8.1-relacions-dashboards` al repositori. Vercel en crea una Preview automàticament.
2. La Preview fa servir les mateixes variables que ja tens; no n'hi ha cap de nova.
3. Entra amb un usuari de Direcció i obre **Centre de Control** i **Supervisió**: han de carregar sense l'error.
4. Compara «Contractes del mes» i «MWh» amb el que esperes. El MWh compta el consum anual del subministrament de cada contracte del període.
5. Entra amb un comercial i obre el seu panell: ara ha de mostrar els seus contractes i MWh (abans sortien a 0).

## 7. Desplegament i rollback

- **Desplegament:** fusionar la branca a `main` quan la Preview estigui validada. No cal cap migració.
- **Rollback:** `git revert` del commit de la branca (o tornar a desplegar el deploy anterior des de Vercel → Deployments → *Promote to Production*). Com que no hi ha canvis a la base de dades, el rollback és immediat i sense risc per a les dades.
