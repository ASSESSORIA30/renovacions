# CRM · Fase 3: contractació digital, expedients i tramitacions

Aquesta fase gestiona tot el cicle de contractació dins la plataforma, des de la proposta acceptada fins a l'activació i la futura renovació. No substitueix cap mòdul existent: reutilitza els clients, els subministraments, els contractes i el gestor documental de la Fase 1, i les oportunitats, les tasques, els avisos i el motor d'automatitzacions de la Fase 2.

## Pantalles

| Pantalla | Ruta | Contingut |
|---|---|---|
| Panell de contractació | `?v=contractacio` | Indicadors, flux per estats, documentació pendent, signatures pendents, expedients signats per enviar, activacions endarrerides, incidències i activats recentment |
| Tramitacions | `?v=tramitacions` | Kanban amb 9 columnes, filtres (responsable, servei, comercialitzadora, província, prioritat), cercador (codi, client, NIF, CUPS, referència) i Realtime |
| Fitxa d'expedient | `?v=expedient&id=…` | Barra de progrés, documentació, condicions acceptades, documents generats, signatura, tramitació, historial, client, subministrament, gestió i comissió |
| Assistent «Nou expedient» | botó a Tramitacions, al panell, a la fitxa del client i a l'oportunitat guanyada | Client → subministrament (triar-ne un o crear-lo) → producte i comercialitzadora → condicions acceptades → revisió |
| Configuració → Contractació | `?v=ajustes&tab=contractacio` | Requisits documentals, plantilles (amb autorització de Direcció) i estat de la signatura electrònica |

Els codis d'expedient (`EXP-2026-00001`) també es troben des del cercador global.

## Estats i transicions

Pendent de documentació → Documentació completa → Pendent de signatura → Signat → Enviat a comercialitzadora → En tramitació → Activat. També hi ha els estats Incidència i Rebutjat o anul·lat.

- **No es poden saltar estats.** Les transicions permeses estan definides a la base de dades (`crm_exp_transition_ok`) i es repeteixen a la interfície. Quan s'arrossega una targeta, les columnes no permeses es mostren bloquejades.
- **Documentació completa:** cal que no hi hagi cap requisit obligatori pendent o rebutjat.
- **Signat:** cal una signatura confirmada pel proveïdor o una signatura manuscrita registrada per Administració.
- **Enviat:** cal la data d'enviament i la comercialitzadora receptora. La referència externa és opcional.
- **Activat:** només es pot fer amb el formulari d'activació. Cal la data real (no pot ser futura), qui l'ha confirmat, la data d'inici i que l'expedient s'hagi signat abans.
- **Retrocessos, incidències, rebuigs i reobertures:** necessiten una justificació, que queda a l'historial. En resoldre una incidència, l'expedient torna com a màxim a l'estat on era.
- **Permisos:** els comercials només mouen la fase de preparació (els tres primers estats) dels seus expedients. Des de «Signat» en endavant, la tramitació és d'Administració.

Proposta acceptada, contracte signat, enviat i activat són conceptes diferents, cadascun amb el seu camp i la seva data: `accepted_terms_id`, `signed_at`, `sent_at` i `activated_at`.

## Model de dades (migració `010_crm_contractacio.sql`)

Tots els canvis són additius i no modifiquen dades existents.

| Taula | Ús |
|---|---|
| `crm_expedients` | Expedient: client, CUPS, oportunitat, comparativa, servei, tràmit, comercialitzadora, responsable, estat, versió, dates previstes i efectives, enviament, activació i contracte resultant |
| `crm_expedient_terms` | Còpia **immutable** i versionada de les condicions acceptades, amb empremta SHA-256. No es modifica encara que després s'editi la tarifa |
| `crm_doc_requirements` | Requisits documentals configurables per servei, comercialitzadora, tipus de client i tipus de tràmit. Els que vénen inclosos estan marcats com a **exemple** |
| `crm_expedient_requirements` | Requisits de cada expedient. Apunten a documents de la fitxa del client **sense duplicar-los** |
| `crm_doc_templates` i `crm_doc_template_versions` | Plantilles i totes les seves versions |
| `crm_generated_documents` | Cada PDF generat: plantilla i versió, condicions, document del gestor, estat (generat, revisat, enviat a signar, signat, substituït) |
| `crm_signature_requests` i `crm_signature_events` | Sol·licituds de signatura i avisos del proveïdor (marcats com a verificats o no) |
| `crm_expedient_events` | Historial cronològic. No es pot modificar ni esborrar |
| `crm_expedient_refs` | Referències externes (comercialitzadora, distribuïdora, signatura, portal) |
| `crm_commission_records` | Preparació del mòdul de comissions (vegeu més avall) |

**Columnes noves** (opcionals): `expedient_id` a contractes, documents, incidències, tasques i activitat, i `renewal_of_contract_id` a oportunitats.

**Funcions transaccionals:**
- `crm_expedient_seed_requirements(id)`: crea els requisits de l'expedient. És idempotent.
- `crm_activate_expedient(...)`: en una sola transacció i amb la RLS de l'usuari:
  - crea el contracte nou;
  - passa l'anterior a `finalitzat`, sense esborrar-lo;
  - actualitza el subministrament, el client i l'oportunitat;
  - desa la referència;
  - tanca l'expedient;
  - vincula la comissió, que continua **pendent**.

**Reversió:** `010_crm_contractacio_down.sql` elimina les taules de la 010, però **conserva els contractes creats**.

## Documentació obligatòria

Cada requisit és d'un d'aquests tres tipus:
- **Document:** s'aporta pujant un fitxer o reutilitzant-ne un de la fitxa.
- **Dada de la fitxa:** NIF, adreça, CUPS, potències… Es comprova automàticament.
- **Comprovació manual:** per exemple, les dades de portabilitat.

Validar o rebutjar un requisit és tasca d'Administració, i el rebuig demana un motiu. Els documents identificatius i bancaris conserven la protecció de la Fase 1: només els veuen Administració i el comercial responsable.

Els requisits inclosos són exemples. Cal revisar-los a Configuració → Contractació i adaptar-los a cada proveïdor.

## Plantilles i PDF

- El motor genera el PDF al servidor (jsPDF) amb les dades del client, del subministrament, de les condicions pactades, del producte i del comercial, i amb la data de generació.
- El PDF es desa al gestor documental de la Fase 1, a la categoria «Contracte».
- Si falta una dada obligatòria de la plantilla, **no es genera** i s'indica quina dada falta.
- Només es fan servir plantilles **autoritzades per Direcció**. Qualsevol canvi en el text crea una versió nova, que cal tornar a autoritzar.
- Els models de comercialitzadora han d'indicar qui els ha facilitat i quan.
- **No s'inclou cap model contractual oficial de cap comercialitzadora.** Hi ha un botó per crear un «Resum de condicions acceptades» intern d'exemple. Es crea en esborrany i també necessita l'autorització de Direcció.

## Signatura electrònica

- **Adaptadors:** l'arquitectura funciona amb adaptadors (`src/server/signature.ts`), i se n'inclou un per a Signaturit (API v3).
- **Sense credencials, la integració queda pendent:** es poden preparar sol·licituds, però **no s'envia res**, i la interfície ho indica clarament.
- **Webhooks:**
  - URL: `/api/signature/webhook/signaturit?r=<id>&t=<HMAC>`.
  - Autenticació: el testimoni HMAC és únic per a cada sol·licitud i es compara en temps constant.
  - Idempotència: cada avís es registra una sola vegada, identificat per l'empremta del cos.
  - Verificació: l'estat es consulta **sempre** a l'API del proveïdor.
  - Signatura confirmada: es descarreguen el document signat i les evidències (*audit trail*) al gestor documental, i l'expedient passa a «Signat».
- **Cap signatura es dona per bona des del CRM.** La base de dades impedeix que qualsevol usuari marqui com a signada una sol·licitud electrònica.
- **Signatura manuscrita:** només la pot registrar Administració, amb el document signat i una justificació.
- **Important:** l'adaptador s'ha escrit segons la documentació pública de Signaturit, però **no s'ha provat contra el servei real** perquè no hi ha credencials. Cal validar-lo amb un compte de proves (`SIGNATURIT_ENV=sandbox`) abans de fer-lo servir en producció.

## Integració amb renovacions

En activar un expedient:
- es crea un contracte nou amb data d'inici i de finalització, si es coneix, i vinculat a l'expedient i al contracte anterior;
- el contracte anterior queda **finalitzat i conservat**;
- es publica al motor de renovacions existent (`publishToRenewals`) si té data de finalització i no hi ha ja un contracte de l'Excel per al mateix CUPS;
- opcionalment, es crea l'oportunitat de renovació (`renewal_of_contract_id`);
- la regla «Preparar la renovació» de la Fase 2 crea la tasca corresponent.

## Comissions (preparació)

Cada expedient té un registre amb:
- comercial responsable i col·laborador;
- comercialitzadora i servei;
- consum anual i comissió estimada (de l'oportunitat);
- estat de meritació i estat de cobrament;
- data i import cobrats;
- referències per a la conciliació.

Els comercials hi tenen accés de lectura i Administració pot modificar-lo. Els col·laboradors no el veuen.

**Activar un contracte no marca la comissió com a meritada ni cobrada.** Si es marca com a cobrada o parcial, cal indicar la data. Encara no s'ha desenvolupat el sistema de liquidacions.

## Automatitzacions (motor de la Fase 2)

Regles noves, configurables a Configuració → Automatitzacions:
- documentació incompleta;
- signatura pendent;
- expedient sense moviment;
- rebuig de la comercialitzadora;
- contracte activat;
- expedient sense responsable.

El «proper venciment» reutilitza la regla `venciment_contracte` de la Fase 2.

Totes les regles fan servir claus úniques (`rule_key`), de manera que no es dupliquen tasques ni avisos. Cada execució deixa una entrada a l'historial de l'expedient.

## Permisos (RLS)

- **Lectura:** Administració i Direcció veuen tots els expedients. La resta d'usuaris només veuen els expedients dels quals són responsables o col·laboradors, o els dels clients que poden editar.
- **Escriptura:**
  - Administració i Direcció poden editar qualsevol expedient. Un comercial només pot editar els expedients dels quals és responsable.
  - Només Administració pot:
    - canviar el responsable;
    - registrar l'enviament, la signatura manuscrita o l'activació;
    - validar documentació;
    - afegir referències;
    - modificar les dades de comissió.
- **Plantilles i requisits:**
  - Els poden gestionar Direcció i la cap d'Administració.
  - Només Direcció pot autoritzar plantilles.
  - La resta d'usuaris només veuen les plantilles autoritzades.
- **Historial, condicions i avisos de signatura:** només s'hi poden afegir registres. No es poden modificar ni esborrar.
- **Avisos del proveïdor de signatura:** només els escriu el servidor.

## Desplegament

1. **Supabase → SQL Editor:** obre `supabase/migrations/010_crm_contractacio.sql`, copia'n **tot el contingut** (no el nom del fitxer) i executa'l. Abans han d'estar aplicades la 008 i la 009.
2. *Database → Replication*: comprova que `crm_expedients` és a `supabase_realtime`. La migració l'hi afegeix si la publicació existeix.
3. **GitHub:** puja la branca `feature/crm-fase3-contractacio`. Vercel en crearà una **Preview**. No l'integris a `main` fins que hagis fet el recorregut d'acceptació.
4. **Vercel:** cap variable és obligatòria. Per a la signatura electrònica, cal afegir les variables següents (només al servidor):

   | Variable | Valor |
   |---|---|
   | `SIGNATURE_PROVIDER` | `signaturit` |
   | `SIGNATURIT_API_TOKEN` | el teu testimoni d'API |
   | `SIGNATURIT_ENV` | `sandbox` (primer) o `production` |
   | `SIGNATURE_WEBHOOK_SECRET` | genera'l amb `openssl rand -base64 32` |
   | `APP_URL` | l'URL pública de la plataforma |

5. **Configuració → Contractació:**
   1. Revisa i adapta els requisits d'exemple.
   2. Afegeix les plantilles que t'hagin facilitat o crea el resum intern.
   3. Fes que Direcció les autoritzi.
