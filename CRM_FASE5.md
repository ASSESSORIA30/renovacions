# CRM · Fase 5: Intel·ligència IA, motor d'oportunitats i automatització comercial

La Fase 5 afegeix la secció **Intel·ligència IA**. El sistema:
- analitza la cartera real (Supabase);
- detecta oportunitats justificades;
- calcula comparatives deterministes amb les tarifes vigents del catàleg;
- prepara propostes en PDF;
- ofereix un Copilot conversacional amb eines autoritzades.

Prepara recomanacions i propostes, però **no envia res ni modifica cap contracte sense una acció i una aprovació d'una persona**.

## 1. Auditoria: què existia i com s'ha reutilitzat

| Mòdul existent (verificat al codi) | Ús a la Fase 5 |
|---|---|
| Comparador (`src/comparator`: `computeCost`, `runComparison`, `eligibility`, `buildSnapshot`). Operatiu i provat. | És el **motor de càlcul únic**. Calcula energia i potència per períodes, SAS, quotes, descomptes, impostos, lloguer i qualitat del càlcul. No s'ha duplicat cap fórmula. |
| Catàleg de tarifes (`tariff_versions`). Entrada manual, Excel/CSV i connectors API. | És la font de les alternatives. Només es fan servir versions **activa** i **vigents**. Cada anàlisi desa una instantània (`tariff_snapshots`). Excel només serveix per importar catàlegs. |
| Taula `comparisons` i les seves vistes | Cada proposta preparada desa també la seva comparativa aquí, de manera que es pot consultar des del comparador i des de la contractació. |
| Optimitzador de potències (`src/energy/lib/optimizer.ts`) | Es fa servir amb les dades SIPS desades (`sips_cache.raw`) i els peatges regulats de 2026. |
| Fase 2: oportunitats, tasques i avisos (`crm_tasks.rule_key`, `crm_notifications`) | Les tasques i els avisos de la IA s'hi creen amb una clau única, de manera que són idempotents. En acceptar una oportunitat es crea (o es vincula) una oportunitat comercial. |
| Fase 3: condicions acceptades (`crm_expedient_terms`) | Són la **font principal del preu actual** del client. Es complementa amb els preus de factura d'una comparativa anterior. |
| Fase 4: motor de comissions (`pickRule`, `computeCommission`) | Calcula la comissió **potencial**, separada per capes. Sempre es mostra com a estimada; mai com a meritada ni cobrada. |
| `src/server/ai.ts` (crida directa a l'API d'Anthropic) | Es manté igual. El Copilot fa servir el mateix patró de crida al servidor, ara amb eines. |

**Funcions pendents o no operatives:**
- El correu SMTP només funciona si està configurat.
- La signatura (Fase 3) continua pendent de credencials.

El sistema no simula cap d'aquests serveis.

## 2. Base de dades (`012_ai_intelligence.sql`, additiva i reversible)

| Taula | Contingut |
|---|---|
| `ai_analysis_runs` | Cada execució del motor: origen (cron, manual o esdeveniment), estat, intents, estadístiques i errors. Un índex únic impedeix dues execucions alhora. |
| `tariff_snapshots` | Catàleg exacte usat en una anàlisi: versions i preus, amb hash. És immutable. |
| `ai_opportunities` | Oportunitats detectades. Inclou la clau `dedupe_key` única (per exemple `renovacio:{contracte}:{venciment}`, una per contracte i cicle), les evidències amb font i data, la puntuació i els factors, el valor de negoci separat, l'estalvi estimat i la qualitat de les dades. |
| `ai_recommendations` | Anàlisi determinista **immutable**: entrades, cost actual, 3 alternatives, escenari SAS, costos únics, hipòtesis, dades que falten i versió del motor. És única per hash d'entrades. |
| `opportunity_scores` | Historial de puntuacions, amb els factors i els pesos. Només s'hi afegeixen files. |
| `ai_opportunity_economics` | Comissió potencial d'Assessoria 3.0, comissió comercial i marge previst. L'estat de cobrament és `no_meritat` per defecte i no s'hi pot posar `cobrat`. |
| `ai_proposal_drafts` | Propostes: esborrany → aprovada → enviada → acceptada / rebutjada / anul·lada. El contingut no es pot modificar. |
| `ai_conversations`, `ai_messages` | Copilot. Són privats de cada usuari; Direcció els pot consultar per auditoria. Tenen data de retenció. |
| `ai_tool_executions` | Registre de totes les eines executades, proposades, confirmades o rebutjades. Del testimoni de confirmació només se'n desa el hash. |
| `ai_usage` | Tokens i cost de cada consulta, per al control de costos. |
| `ai_automation_logs` | Registre de les automatitzacions, idempotent per clau. |
| `crm_clients.commercial_opt_out`, `contact_preference` | Oposició comercial i canal preferit del client. |
| `crm_opportunities.ai_opportunity_id` | Vincle únic amb l'oportunitat detectada, per evitar duplicats. |

**Seguretat a la base de dades:**
- **RLS:**
  - les oportunitats les veu qui veu el client;
  - l'economia: Direcció i Administració ho veuen tot; el comercial només veu la seva comissió; els col·laboradors no en veuen cap;
  - les execucions del motor i els registres només els veu l'equip d'administració.
- **Triggers:**
  - una persona només pot canviar l'estat d'una oportunitat; les dades les canvia el motor;
  - descartar una oportunitat exigeix un motiu;
  - «guanyada» només arriba des de l'oportunitat comercial;
  - el flux d'estats de les propostes està controlat, i «enviada» només la pot marcar el servidor.
- **Retenció:** `ai_purge_expired()` només la pot executar el servidor.

## 3. Motor d'oportunitats (`src/core/intelligence.ts` i `src/server/intelligence.ts`)

S'executa cada dia amb el cron de Vercel (`/api/ai/cron`, 05:30 UTC) i també manualment («Analitza la cartera», o «Analitza» a la fitxa d'un client).

| Detecció | Criteri |
|---|---|
| Renovacions | Contractes actius amb venciment a 120, 90, 60, 30 o 15 dies, o vençuts fa menys de 30 dies. Una sola oportunitat per contracte i cicle. Avís a cada finestra, i una tasca de preparació. |
| Estalvi / contracte car | Contractes amb preu actual conegut. Estalvi ≥ 60 € i ≥ 5 %, o ≥ 15 % per considerar-lo «contracte car» (valors configurables). |
| Sense preu actual | Es calculen les alternatives, però l'estalvi es mostra com a **«Pendent de factura o condicions actuals»**. |
| Potència | Optimitzador existent, escenari equilibrat. Només amb confiança mitjana o alta, sense excessos i amb un estalvi mínim configurable. Sempre «pendent de validació tècnica», mai una reducció definitiva. |
| Recuperació | Clients inactius o amb contractes finalitzats i sense contacte en 365 dies. **S'exclouen els clients amb oposició comercial o «no contactar».** |
| Venda creuada | Clients amb algun servei actiu. És una oportunitat per **comprovar l'interès**: el text diu explícitament que no s'ha de suposar la necessitat. L'interès registrat (leads, oportunitats perdudes «més endavant», etiquetes `interes:…`) es cita amb la font. |
| Propostes sense resposta | Propostes enviades fa ≥ 7 dies sense cap activitat posterior. |
| Dades incompletes | Subministraments sense tarifa, potències o consum, i contractes sense data de venciment. |
| Tarifes caducades | Versions vençudes. S'exclouen de les comparatives i de les propostes, i se n'avisa Direcció. |

**Funcionament del motor:**
- **Idempotència:** és idempotent per `dedupe_key`, hash d'entrades i `rule_key`.
- **Concurrència i errors:**
  - una sola execució alhora;
  - un bloqueig caducat s'allibera als 30 minuts;
  - 3 reintents amb espera creixent per a errors transitoris;
  - el cron s'atura després de N errors consecutius (`max_attempts`).
- **Control de cost:** límit de comparatives per execució (`max_comparisons`).
- **Tancament:** les oportunitats que ja no es detecten passen a «caducada», però les descartades o guanyades no es reobren.
- **Esborranys automàtics:** estan **desactivats per defecte**, i mai s'envien.

## 4. Comparativa i 3 alternatives

- Es calculen **totes** les tarifes vigents i elegibles i se'n trien 3 pel **cost anual total estimat** (amb impostos).
- En cas d'empat, es prioritza la tarifa sense permanència i després la del preu garantit més llarg.
- Cada alternativa porta el motiu:
  - posició i diferència respecte de la primera;
  - estalvi;
  - permanència i penalització;
  - preu garantit;
  - exposició al mercat;
  - valors estimats.
- **Imports recurrents** (energia, potència, SAS, quotes, descomptes, impostos i lloguer) separats dels **costos únics** (penalització per sortir del contracte actual).
- **Les comissions no són cap entrada del càlcul.** L'estimació econòmica es fa després, sobre l'alternativa ja triada.
- **SAS:**
  - es distingeix si és inclòs, exclòs o estimat;
  - l'escenari de 0,010–0,015 €/kWh només s'aplica si Direcció l'ha activat, amb comercialitzadores, justificació, **font i data**, i només a ofertes que facturen el SAS a part **sense valor publicat**;
  - en aquest cas, el cost inclou el mínim de l'escenari com a valor *estimat* (així no es beneficia l'oferta que l'omet) i es mostra la forquilla completa;
  - sense escenari, s'avisa que «el cost real serà superior».

## 5. Propostes PDF

Quan es prepara una proposta:
- es desa la comparativa;
- es genera el PDF corporatiu (`src/core/proposal-pdf.ts`), que inclou:
  - logotip, client i subministrament;
  - comercialitzadora i preus actuals, o «Pendent de factura o condicions actuals»;
  - 3 alternatives, amb cost anual i estalvi;
  - condicions (permanència, preu garantit, SAS i validesa de l'oferta);
  - escenari SAS amb font i data, i costos únics;
  - validesa, hipòtesis, avantatges, contacte;
  - el missatge «Experiència des de 2013…»;
- es desa a la **fitxa documental del client** (categoria *proposta*) amb el títol «(ESBORRANY)» i la marca a cada pàgina.

**Després de preparar-la:**
- **Aprovació:** genera la versió 2 del document, sense marca.
- **Enviament per correu:**
  - només és possible si la proposta està aprovada i hi ha SMTP;
  - es marca «enviada» només si el servidor de correu l'accepta, i llavors l'oportunitat comercial passa a «Proposta enviada».
- **Resposta del client:**
  - acceptada: es crea o es vincula **una** oportunitat comercial, que passa a «Negociació»;
  - rebutjada: l'oportunitat es descarta amb el motiu.
- **Contractació:**
  - des de l'oportunitat comercial es marca com a guanyada i s'obre l'expedient (Fase 3), sense duplicar client, CUPS ni contracte;
  - en guanyar o perdre l'oportunitat comercial, la detectada s'actualitza (trigger).

## 6. Copilot IA

- És un **calaix lateral** a tota l'aplicació (botó «Copilot» o Ctrl+J). Té en compte el context de la pantalla (oportunitat o client).
- **Arquitectura equivalent al Vercel AI SDK:** bucle de *tool calling* amb l'API de missatges d'Anthropic, al servidor i sense dependències noves. La clau només és al servidor.
- **13 eines tancades i validades amb zod.** No hi ha accés SQL.
  - Lectura: trucades d'avui, venciments, consum, propostes pendents, estalvi, MWh, millors ofertes per perfil, comissions, resum d'activitat i cerca de clients.
  - Les lectures es fan **amb la sessió de l'usuari**: la RLS limita què veu.
- **Accions sensibles** (preparar proposta, crear tasca, descartar):
  - queden **proposades** amb un testimoni d'un sol ús (15 minuts, només per a qui la demana);
  - s'executen en confirmar-les;
  - tot queda registrat.
- **Protecció davant prompt injection:**
  - les dades van dins de `<dades>` i sense etiquetes;
  - els missatges sospitosos s'avisen al model;
  - les eines i les confirmacions no depenen del model.
- **Minimització de dades:** abans d'enviar res al proveïdor se suprimeixen NIF, telèfons, correus, IBAN, adreces i camins de fitxers.
- **Control de costos:**
  - límit diari de tokens per usuari;
  - pressupost mensual global;
  - límit de consultes per minut;
  - nombre de passos i sortida màxims.
- **Mode sense IA:** sense clau o sense pressupost, el Copilot respon amb **regles deterministes** i les mateixes eines, i ho indica.
- **Fonts:** cada resposta cita les fonts i les dates.

## 7. Puntuació 0-100

**Prioritat de servei al client:** 8 factors configurables:
- venciment;
- estalvi;
- volum;
- qualitat de dades;
- conversió amb evidència;
- antiguitat de la proposta;
- última activitat;
- seguiment.

Cada factor mostra el valor, el pes, els punts i l'explicació. Els factors que no corresponen al cas (per exemple, sense evidència de conversió) **no puntuen ni resten** i es marquen com a «no aplicable». No es fan prediccions opaques.

**La rendibilitat interna** (comissió i marge estimats) és un indicador separat (`business_value`). No altera la puntuació ni l'ordre de les alternatives.

## 8. Interfície

**Intel·ligència IA:**
- 10 indicadors:
  - oportunitats;
  - alta prioritat;
  - renovacions;
  - estalvi estimat;
  - comissió potencial;
  - propostes;
  - tasques suggerides;
  - alertes energètiques;
  - clients sense dades;
  - anàlisis.
- Filtres per:
  - comercial i client;
  - comercialitzadora, tarifa i província;
  - consum i estalvi;
  - dates de renovació;
  - estat i tipus.
- Targetes d'oportunitat.
- Gràfic d'estalvi.
- Rànquing de clients prioritaris.
- Properes accions i calendari.
- Registre d'anàlisis.
- Configuració (només Direcció).

**Fitxa d'oportunitat:**
- evidències;
- puntuació explicada;
- comparador integrat (situació actual + 3 opcions);
- escenari SAS;
- costos únics;
- hipòtesis;
- economia separada;
- generador de propostes;
- accions.

**Fitxa del client:**
- targeta d'oportunitats IA;
- preferències de contacte i oposició comercial.

## 9. Variables d'entorn (Vercel)

| Variable | Per a què | Per defecte |
|---|---|---|
| `ANTHROPIC_API_KEY` | Copilot amb IA (sense clau: mode regles) | — |
| `ANTHROPIC_MODEL` | Model | `claude-sonnet-5-5` |
| `AI_COPILOT_DAILY_TOKENS` | Tokens per usuari i dia | 60000 |
| `AI_MONTHLY_BUDGET_EUR` | Pressupost mensual d'IA (en arribar-hi, mode regles) | 30 |
| `AI_COPILOT_PER_MINUTE` | Consultes per usuari i minut | 8 |
| `AI_COPILOT_MAX_STEPS` | Passos d'eines per consulta (màxim 6) | 4 |
| `AI_COPILOT_MAX_OUTPUT_TOKENS` | Sortida màxima (màxim 2000) | 900 |
| `AI_PRICE_IN_EUR_MTOK`, `AI_PRICE_OUT_EUR_MTOK` | Preu per milió de tokens per estimar el cost | 3 i 15 |
| `CRON_SECRET` | Protegeix `/api/ai/cron` (ja existia) | — |

**Desplegament a Vercel:**
1. Executa `012_ai_intelligence.sql` a l'editor SQL de Supabase, després de l'011. Enganxa'n el **contingut**, no el nom del fitxer.
2. Defineix les variables d'entorn.
3. El fitxer `vercel.json` ja inclou el cron `/api/ai/cron`.
4. Direcció revisa la configuració, sobretot l'escenari SAS (font i data) i els pesos de la puntuació.

## 10. Pendent (no simulat)

- Executar la migració 012 a Supabase i comprovar la RLS amb usuaris reals.
- Provar el Copilot amb `ANTHROPIC_API_KEY` real: les proves cobreixen el mode regles, el bucle i les eines amb un client simulat.
- Enviar propostes per correu amb l'SMTP configurat.
- Executar el cron diari a Vercel i mesurar-ne el temps amb la cartera real.
- Comprovar l'optimització de potència amb dades SIPS reals desades a `sips_cache`.
- Direcció ha d'activar l'escenari SAS amb una font documentada i validar els llindars i els pesos.
- WhatsApp i correus automàtics: **no s'han implementat** enviaments automàtics. Calen una regla aprovada, una base jurídica i els permisos.
