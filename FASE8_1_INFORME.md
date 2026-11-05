# Fase 8.1 · Informe: correcció de dashboards, rol Cap d'equip i Comercialitzadores

Data: 01/11/2026. Base: Fase 8 estable (zip del 01/11/2026).

| Branca | Contingut | Migracions |
|---|---|---|
| `fix/fase8.1-relacions-dashboards` | **Pas 1.** Correcció del Centre de Control i la Supervisió | Cap (només codi) |
| `feature/fase8.1-cap-equip-comercialitzadores` | **Pas 2**, a partir del pas 1: rol Cap d'equip i mòdul Comercialitzadores | `016_equips.sql`, `017_comercialitzadores.sql` |

No s'ha tocat `main` ni producció. No s'han canviat variables d'entorn, claus de xifrat, login ni MFA. No s'ha eliminat cap taula, dada ni relació.

Llegenda: ✅ verificat (tests automàtics o PostgreSQL real) · 🟡 verificat parcialment o amb simulació · 🔧 pendent de configuració externa · ⚪ no fet.

---

## 1. Errors corregits

| # | Error | Causa | Correcció |
|---|---|---|---|
| 1 | Centre de Control: `Could not embed because more than one relationship was found for 'crm_contracts' and 'crm_supplies'` | Dues FK reals entre les taules: `crm_contracts_supply_id_fkey` i `crm_supplies_current_contract_fk` | `crm_supplies!crm_contracts_supply_id_fkey(...)` (nom llegit de `pg_constraint`) |
| 2 | Supervisió: el mateix error | Mateixa consulta (`loadOps`) | Ídem |
| 3 | Panell del comercial: contractes i MWh del mes a **0** sense avisar | Mateixa ambigüitat; l'error s'ignorava | Relació explícita i l'error ara es mostra |
| 4 | Economia › incentius per trams de volum fallaven | Mateixa ambigüitat a `computeIncentives` | Relació explícita |
| 5 | Un error de relació es podia convertir en «0 contractes» al Centre de Control | `loadOps` tractava PGRST200/201 com a «taula inexistent» | Consulta de contractes estricta |
| 6 | Errors de validació de l'API sortien com a 500 | `handler` no reconeixia `ZodError` | Ara retornen 400 amb un missatge entenedor |

Detall i consulta SQL de comprovació: `FASE8_1_CORRECCIO.md`.

## 2. Rol Cap d'equip

- **Nou rol** `cap_equip` («Cap d'equip»), entre Direcció i Comercial. No és «staff», de manera que les restriccions econòmiques s'apliquen automàticament.
- **Equips** (`crm_teams`) i **pertinença amb historial** (`crm_team_members`, amb `joined_at` i `left_at`). Un comercial només pot ser a un equip actiu.
  - Canviar d'equip tanca la fila anterior i n'obre una de nova. Els clients, contractes i vendes del comercial no canvien de propietari.
  - L'historial no es pot esborrar ni reescriure.
- **Cartera d'equip** (`crm_team_clients`): Direcció pot assignar clients a un equip.
- **RLS real**, no només ocultar botons. El Cap d'equip veu clients, contractes, subministraments, leads, oportunitats, expedients pendents, tasques, incidències i objectius **només del seu equip**. Pot:
  - assignar leads i tasques dins l'equip;
  - gestionar objectius dels seus comercials (no els propis);
  - gestionar incidències comercials del seu equip.
- **Restriccions** (sense autorització expressa): no té accés a beneficis, marges ni comissions de les comercialitzadores. Tampoc pot:
  - aprovar liquidacions;
  - crear o editar equips;
  - canviar rols o permisos;
  - veure altres equips.
- **Comissions dels comercials de l'equip**: només si Direcció concedeix el nou mòdul «Comissions de l'equip». Encara així, veu només la capa comercial, mai la de la comercialitzadora.
- **Auditoria**: alta, canvi de responsable i canvi de membres o de cartera queden a `sec_audit`.
- **Pantalles**:
  - «El meu equip» (Inici). Inclou:
    - contractes del mes i per comercial, MWh captats, objectius, conversió, oportunitats obertes, renovacions, tasques vençudes i comissions autoritzades;
    - evolució de 12 mesos;
    - alertes d'inactivitat i de tasques vençudes;
    - assignació de leads i contractes pendents de tramitació.
  - «Equips comercials» (Administració, Direcció).
- **Avisos automàtics** al Cap d'equip: tasques vençudes i comercials sense activitat durant 5 dies laborables.

## 3. Comercialitzadores

- **Fitxa**:
  - dades d'identificació: nom comercial, raó social, CIF i logo;
  - contacte i web: persona de contacte, telèfon, correu i web;
  - serveis i estat;
  - condicions especials i àlies (els noms amb què surt als contractes del CRM).
- **Contractes de col·laboració, annexos i tarifes**, amb versions:
  - «substitueix» conserva els dos documents;
  - cada document té vigència i dies d'avís de venciment;
  - el contracte s'activa com a vigent explícitament.
- **Pujada segura**:
  - bucket privat `retailer-contracts`, amb URL signada d'un sol ús i tiquet HMAC;
  - comprovació del contingut real (PDF, DOCX sense macros, JPG o PNG), de la mida i de la petjada SHA-256;
  - detecció de duplicats;
  - descàrrega amb URL de 60 s, auditada.
- **Lectura intel·ligent** (botó «PUJAR CONTRACTE I ANALITZAR AMB IA»):
  - Text per pàgines: PDF amb unpdf, DOCX amb paràgrafs i taules. Els documents escanejats es detecten.
  - **IA amb garanties**: el contracte només s'envia al proveïdor si Direcció ha registrat el DPA i ha confirmat que les dades no s'usen per entrenar models («Garanties IA»). Cada enviament queda auditat. L'OCR dels escanejats el fa la mateixa IA (proveïdor autoritzat).
  - **Sense garanties o sense clau**, s'utilitza un **lector local** determinista i res no surt del servidor. Detecta:
    - €/MWh, €/kWh, imports fixos i percentatges;
    - retrocessions per baixa, impagament, anul·lació, canvi de titular o de comercialitzadora, reducció de consum i no activació;
    - prorrateigs amb fórmula, permanències, penalitzacions, vigència i terminis de pagament i de reclamació.
  - **Anti-invenció**: cada condició ha de citar un fragment **literal** que el servidor troba al document. Si no el troba, o l'import no hi apareix, la condició es marca com a «**REVISIÓ MANUAL NECESSÀRIA**».
    - Les condicions contradictòries (p. ex. Gala 10 vs 12 €/MWh) es marquen totes dues.
    - El lector local també revisa el que la IA hagi pogut ometre.
  - **Traçabilitat** de cada condició:
    - document, versió, pàgina i fragment;
    - interpretació proposada (separada del fragment);
    - camp normalitzat, valor, unitat i vigència;
    - confiança i estat de revisió.
- **Revisió i aprovació**:
  - Direcció pot corregir la proposta abans d'aprovar-la (es conserva l'original de la IA).
  - Les condicions clares es poden aprovar **en bloc**. Les dubtoses, una a una i confirmant la revisió manual.
  - Els percentatges exigeixen la fórmula exacta de la base. Aquesta salvaguarda del motor de la Fase 4 es respecta.
- **Integració amb el motor de comissions**:
  - Les condicions aprovades es converteixen en regles `fin_rules` amb `layer = 'proveidor'`. La capa B (comercials) continua separada.
  - Inclouen productes, peatges, renovació o alta nova, i dates de vigència. Els €/kWh es converteixen exactament a €/MWh i es guarda la unitat original.
  - Un contracte nou crea una **versió nova**; l'anterior es tanca i es conserva per als contractes antics. **No es recalcula res d'històric.**
  - Tipus nous al motor: `pct_energia` i `pct_potencia`.
- **Retrocessions** (`retailer_clawback_rules`, immutables):
  - modes: total, parcial, prorrateig, fórmula i penalització;
  - camps: període de risc, inici del còmput, excepcions i termini de reclamació;
  - motor de càlcul verificable (`clawbackFor`): exposició de risc, retrocessió estimada i fórmules no automatitzables marcades com a «pendents».
  - Una **retrocessió real** només la registra Direcció **amb evidència** (línia de liquidació o justificació), i no es pot duplicar.
- **Panell econòmic** (Direcció o permís «economia»). Mostra:
  - comissions esperades, meritades, facturades, cobrades i pendents;
  - retrocessions potencials i aplicades;
  - contractes activats i MWh;
  - rendiment per producte i evolució mensual;
  - renovacions;
  - diferències i **alertes d'infrapagament**.
- **Avisos automàtics** a Direcció: venciment de contractes de col·laboració i comercialitzadores que paguen menys del pactat.

## 4. Proves

Totes les proves de base de dades s'executen sobre **PostgreSQL real** (PGlite) amb totes les migracions aplicades.

| # | Prova obligatòria | Estat | On |
|---|---|---|---|
| 1-2 | Centre de Control i Supervisió sense l'error de relacions | ✅ esquema real + detector · 🟡 PostgREST real pendent a la Preview | `embed-ambiguity.test.ts` |
| 3 | KPI correctes, sense duplicacions | ✅ | `kpi-relations.test.ts` |
| 4 | Login de Direcció | 🟡 sense canvis al login; cal provar-ho a la Preview | — |
| 5 | Login del Cap d'equip | 🟡 el rol s'accepta a l'alta d'usuaris i a l'accés intern; cal provar-ho a la Preview | — |
| 6-7 | Permisos del Cap d'equip i restriccions sobre altres equips | ✅ 18 proves RLS | `equips-rls.test.ts` |
| 8 | Alta d'una comercialitzadora | ✅ | `comercialitzadores-rls.test.ts` |
| 9 | Pujada d'un contracte | ✅ validació de contingut i extracció de PDF/DOCX · 🟡 pujada al bucket real pendent a la Preview | `retailers.test.ts` |
| 10-11 | Extracció de comissions i de retrocomissions | ✅ lector local amb documents de prova · 🟡 **IA real no provada** (només la validació aplicada a la seva resposta) | `retailers.test.ts` |
| 12 | Clàusules ambigües i contradictòries | ✅ | `retailers.test.ts` |
| 13 | Aprovació de regles | ✅ | `comercialitzadores-rls.test.ts` |
| 14 | Versions i vigències | ✅ | `comercialitzadores-rls.test.ts` |
| 15 | Càlcul econòmic (comissió i retrocessió) | ✅ | `retailers.test.ts` |
| 16 | Protecció de documents | ✅ RLS i accés per rol · 🟡 URL signades contra Storage real pendent a la Preview | — |
| 17 | Integració amb les comissions existents | ✅ | `comercialitzadores-rls.test.ts`, `retailers.test.ts` |
| 18 | Regressió de les fases anteriors | ✅ 497 proves anteriors en verd | suite completa |
| 19 | Persistència a Supabase | ✅ PostgreSQL real; migracions idempotents i reversibles provades | — |
| 20 | Compilació, TypeScript, lint i tests | ✅ `next build`, `tsc`, `eslint` (0 errors), **558 proves** en verd (497 anteriors + 61 noves) | — |

Les **pantalles** noves compilen i passen el lint, però **no s'han revisat visualment** contra una base de dades real. Cal mirar-les a la Preview.

Documents de prova ficticis: `tests/helpers/retailer-docs.ts`. Inclouen un contracte tipus «Nufri» en PDF i DOCX amb taula, i una versió amb un annex contradictori.

## 5. Preview de Vercel

1. **Base de dades de proves.** Idealment, una branca de Supabase o un projecte de staging; no la producció. Al SQL Editor, enganxa el **contingut** de:
   1. `supabase/migrations/016_equips.sql`
   2. `supabase/migrations/017_comercialitzadores.sql`

   Comprovació:

   ```sql
   select to_regclass('public.crm_teams') is not null as m016,
          to_regclass('public.retailers') is not null as m017;
   ```

   **Abans d'aplicar la 016 a producció**, comprova que ningú no hagi modificat a mà les funcions que s'amplien. Han de coincidir amb les de les migracions 008, 009 i 014:

   ```sql
   select proname, md5(pg_get_functiondef(oid)) from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('crm_can_see_client','crm_can_see_lead','crm_can_see_opportunity','crm_task_guard','crm_lead_before');
   ```

   Si tens dubtes, envia'm el resultat abans d'aplicar-la.
2. **Variables d'entorn.** No n'hi ha cap de nova. `ANTHROPIC_API_KEY` ja existeix; sense aquesta clau s'usa el lector local.
3. **Durada de les funcions.** L'anàlisi amb IA d'un contracte llarg pot superar els 60 s. `/api/retailers` declara `maxDuration = 300`, que requereix el pla Pro de Vercel. Amb el pla Hobby, Vercel el limita i els contractes molt llargs s'han de dividir.
4. Puja la branca `fix/fase8.1-relacions-dashboards`, i després `feature/fase8.1-cap-equip-comercialitzadores`. Vercel crea una Preview per a cadascuna.
5. **Proves manuals recomanades**:
   1. Direcció: Centre de Control i Supervisió carreguen.
   2. Crea un usuari amb el rol «Cap d'equip». Després, a «Equips comercials», crea un equip i assigna-hi comercials.
   3. Entra com a Cap d'equip: «El meu equip» mostra només el seu equip. Intenta obrir un client d'un altre equip: no hi ha d'aparèixer.
   4. Comercialitzadores → nova fitxa «Nufri» → «PUJAR CONTRACTE I ANALITZAR». Revisa les condicions proposades i aprova-les. Comprova-les a «Regles aprovades» i a «Economia › Comissions».
   5. Si vols provar la IA: «Garanties IA» → registra el DPA. Repeteix el pas anterior.

## 6. Desplegament (quan la Preview estigui validada)

1. **Còpia de seguretat** de la base de dades (`scripts/backup.sh`).
2. Fusiona `fix/fase8.1-relacions-dashboards` a `main`. És només codi i es pot desplegar sol.
3. A producció, aplica `016_equips.sql` i després `017_comercialitzadores.sql`. Totes dues són additives i no esborren res.
4. Fusiona `feature/fase8.1-cap-equip-comercialitzadores` a `main`.
5. Direcció: crea els equips, assigna els rols de Cap d'equip i, si cal, concedeix «Comercialitzadores» a Administració i «Comissions de l'equip» als caps, des de «Usuaris i permisos».

## 7. Rollback

| Què | Com | Efecte sobre les dades |
|---|---|---|
| Codi | Vercel → Deployments → *Promote to Production* del desplegament anterior, o `git revert` | Cap |
| Pas 1 | Revert del commit (no té migració) | Cap |
| 017 | `017_comercialitzadores_down.sql` | Es retiren les funcions d'aprovació i de retrocessió. Les dades i les regles ja aprovades **es conserven** |
| 016 | Primer, canvia el rol dels usuaris `cap_equip`. Després, `016_equips_down.sql` | Es restauren exactament les funcions originals. L'historial d'equips **es conserva** |

## 8. Limitacions conegudes

- **Lector local.** És determinista i el poden despistar redaccions poc habituals. Per això avisa que cal revisar que no falti cap clàusula. Les condicions que no detecta es poden afegir a mà, sempre amb el fragment literal.
- **Documents escanejats sense IA.** No es poden llegir automàticament (no hi ha OCR local). S'avisa i es poden introduir a mà.
- **Ràpels i trams de la comercialitzadora.** S'aproven i es desen al motor, però el càlcul automàtic de trams continua limitat als incentius (capa B), com a la Fase 4.
- **Panell econòmic.** Relaciona els contractes del CRM amb les comercialitzadores pel nom comercial i els àlies. El panell indica quants contractes no coincideixen amb cap fitxa.
