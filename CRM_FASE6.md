# CRM · Fase 6: captació automàtica, portal de col·laboradors i màrqueting

Tots els leads entren a Supabase i són els mateixos `crm_leads` de la Fase 2: no hi ha un sistema de leads paral·lel ni cap Excel.

## 1. Auditoria

| Element | Estat trobat | Ús a la Fase 6 |
|---|---|---|
| Lector de factures (`src/server/invoices.ts`, `src/comparator/invoice.ts`) | Operatiu: text del PDF i, si `INVOICE_AI_ENABLED`, lectura visual amb IA validada amb zod | S'ha extret `readInvoiceBytes()` i ara el comparteixen el comparador i la captació. S'hi ha afegit el format WebP. |
| Leads, tasques, avisos i automatitzacions (Fase 2) | Operatius | Els leads captats hi entren amb columnes noves (canal, campanya, col·laborador, UTM, CUPS i duplicats). Les tasques i els avisos són idempotents per `rule_key`. |
| Rol `colaborador` i `fin_collaborator_terms` (fases 1 i 4) | Operatius | El col·laborador entra al portal amb aquest rol. Les seves comissions i liquidacions surten de la Fase 4. |
| Motor de comparatives i PDF de proposta (Fase 5) | Operatius | Es fan servir per a la comparativa preliminar i el PDF en esborrany. |
| WhatsApp (`/api/whatsapp/send`) | Només enviament bàsic, sense estats | S'hi afegeixen el webhook d'estats i de missatges entrants, el registre i el consentiment. |
| Landing pública, portal, referències, QR, campanyes, Meta i Google Ads | **No existien** | Són nous en aquesta fase. |

## 2. Base de dades (`013_captacio.sql`, additiva i reversible)

**Taules noves:**
- `cap_submissions` (sol·licituds), `cap_consents`, `cap_lead_documents`, `cap_invoice_readings`;
- `cap_partners`, `cap_referral_links`, `cap_attributions`;
- `cap_assignment_rules`, `cap_assignments`;
- `cap_campaigns`, `cap_campaign_costs`, `cap_visits`, `cap_conversion_events`;
- `cap_webhook_events`, `cap_whatsapp_messages`, `cap_audit`.

**Altres canvis:**
- **Bucket privat `lead-documents`** (10 MB; només PDF, JPG, PNG i WebP). No té cap política d'Storage: només hi accedeix el servidor.
- **9 regles d'automatització** `cap_*`, que només generen tasques i avisos interns.

**Seguretat:**
- **Formulari públic:** `anon` no té cap política. El formulari passa pel servidor, que valida, limita i insereix; no pot llegir res. Una prova ho verifica amb els permisos de taula per defecte de Supabase.
- **Col·laborador:** només veu el seu perfil, els seus enllaços i atribucions, i les factures que ha pujat ell. Mai veu les lectures internes.
- **Atribucions:**
  - només Direcció en pot crear o canviar, sempre amb motiu i amb auditoria;
  - no es poden reassignar a un altre col·laborador;
  - només n'hi pot haver una de vigent per lead;
  - la vigent porta el col·laborador al lead, i d'aquí a les comissions de la Fase 4.
- **Consentiments:** no es modifiquen; només es poden retirar, i una sola vegada.
- **WhatsApp:** l'estat no retrocedeix, i «lliurat» o «llegit» només ho marca el servidor.
- **Historials:** el d'assignacions i l'auditoria són només d'afegir.
- **Conservació:** `cap_anonymize_expired()` anonimitza les sol·licituds caducades (2 anys). Només la pot executar el servidor.
- **Reversió:** la migració de reversió conserva les columnes de captació dels leads.

## 3. Landing pública `/estudi`

- **Contingut:**
  - hero amb la proposta de valor;
  - formulari amb pujada de factura (fitxer o foto amb la càmera al mòbil);
  - com funciona, avantatges, serveis per a particulars i empreses;
  - preguntes freqüents, contacte, WhatsApp i pàgines legals (`/privacitat` i `/avis-legal`).
- **Sense promeses:** la landing no promet estalvis («No ho podem garantir per endavant»).
- **Dades corporatives:** són configurables per variables d'entorn. Mentre `NEXT_PUBLIC_COMPANY_VERIFIED` no sigui `true`, es mostra un avís que s'han de verificar. Al projecte no n'hi havia cap de configurada.
- **Enllaços de referència:** `?ref=CODI` mostra «Recomanat per…» només si el col·laborador ha autoritzat un nom públic. El codi no dona accés a cap dada.

## 4. Formulari i processament (`src/server/capture.ts`)

1. **Validació:** amb zod, i el telèfon i el correu es normalitzen.
2. **Consentiments:** el del servei és obligatori; el comercial i el de WhatsApp són opcionals i es registren per separat, amb la versió i el hash del text.
3. **Antispam:**
   - camp parany;
   - temps mínim d'emplenament;
   - enllaços i paraules típiques;
   - la resposta és neutra: no revela que s'ha detectat spam.
4. **Límits de peticions:** 5 cada 10 minuts i 20 al dia per IP (es desa un hash diari amb sal, mai la IP), i 3 al dia per contacte.
5. **Fitxer:**
   - es comprova el tipus pel contingut real, no per l'extensió;
   - mida màxima de 10 MB;
   - es rebutgen els PDF amb JavaScript, accions Launch, fitxers incrustats o enviament de formularis.
6. **Duplicats:**
   - la mateixa clau d'idempotència retorna la mateixa sol·licitud;
   - la mateixa persona amb la mateixa factura en 24 hores no crea un lead nou;
   - coincidències per CUPS o NIF (fortes) i per telèfon o correu (febles) marquen el lead com a «possible duplicat». **Mai es fusiona automàticament.**
7. **Lead i resta del procés:**
   - es crea el lead i la factura es desa al bucket privat;
   - s'aplica l'atribució i l'assignació automàtica, que queda a l'historial;
   - es crea la tasca de primer contacte i s'avisa el responsable;
   - es registra la conversió.
8. **Lectura en segon pla** (`after()`): si falla la IA, el lead i el document ja estan desats. El cron ho reintenta, amb un màxim d'intents.

## 5. Lectura de factures i comparativa preliminar

- **Camps normalitzats:** cada dada té valor, unitat, pàgina, estat (llegit, per revisar, pendent o revisat), mètode i observacions.
- **Imports:** «amb impostos» i «sense impostos» se separen.
- **Comprovacions:**
  - lletres de control del CUPS i del NIF;
  - dates i dies facturats;
  - tarifa coherent amb el tipus d'energia (llum o gas);
  - proporció de l'IVA (per detectar confusions entre imports amb i sense impostos);
  - preus anòmals.
- **Gas:** peatge RL, consum i terme fix, sense potències.
- **Comparativa preliminar:**
  - consum anualitzat a partir dels dies facturats, indicat com a hipòtesi;
  - tarifes vigents i motor de la Fase 5;
  - sense preus, «Pendent de factura o condicions actuals»;
  - es desa com a comparativa en esborrany.
- **Proposta PDF:** **ESBORRANY** i marcada com a **PRELIMINAR**. Només es genera quan les dades dubtoses usades s'han revisat. No s'envia mai sola.
- **Conversió a client:** la factura es copia a la fitxa del client i la comparativa s'hi vincula, sense duplicar res.

## 6. Col·laboradors, referències i QR

- **Alta (Direcció):**
  - perfil del col·laborador;
  - invitació opcional al portal (rol `colaborador`);
  - dades fiscals a `fin_collaborator_terms`;
  - enllaç amb un codi únic.
- **QR:** en SVG o PNG (`/api/capture/qr`), només per a l'equip o per al col·laborador propietari.
- **Atribució:** la primera aportació queda vigent. Si un altre col·laborador aporta la mateixa persona en 90 dies, queda **en disputa** i decideix Direcció, amb motiu.
- **Portal `/portal`:**
  - indicadors: clients aportats, leads pendents, en tramitació, activats, comissions estimades, meritades i liquidades, i pagaments pendents;
  - aportar un client amb factura, amb la declaració d'autorització del client;
  - consultar les operacions i els documents propis;
  - descarregar liquidacions en PDF;
  - enllaç i QR;
  - actualitzar les dades de contacte.

  No mostra cap marge ni cap dada d'altres col·laboradors.

## 7. Assignació de leads

Regles configurables per Direcció:
- condicions: província, municipi, energia, tipus de client, canal, col·laborador i consum;
- prioritat;
- estratègia: usuari fix, rotació o menys càrrega de treball;
- màxim de leads oberts.

**Funcionament:**
- **Sense regla aplicable:** el lead queda pendent i s'avisa Direcció.
- **Doble assignació:** no es pot assignar dues vegades (actualització condicional).
- **Assignació manual:** només Direcció, amb motiu i auditoria.

## 8. Màrqueting, campanyes i integracions

**Panell «Captació i màrqueting»** (equip d'administració):
- **Embut:** visites, formularis, factures, leads vàlids, oportunitats, propostes, contractes, MWh, comissions, cost, CPL, CPA i rendibilitat.
- **Estat de cada indicador:** **conegut / estimat / no disponible**.
- **Desglossament:** per canal, per campanya i per col·laborador.
- **Filtres:** dates, canal, campanya, comercial i producte.

**Integracions:**

| Integració | Implementat | Estat en aquest entorn |
|---|---|---|
| UTM, gclid i fbclid | Es registren al servidor | Operatiu |
| Costos de Google Ads | Lectura amb `searchStream` (només lectura) o registre manual | **Pendent de credencials; no verificat contra un compte real** |
| Meta Lead Ads | Webhook amb verificació HMAC (`X-Hub-Signature-256`) i del testimoni de subscripció, idempotent; lectura del lead amb un token de pàgina | **Pendent de credencials**. Sense token, l'esdeveniment queda «pendent_credencials» i no s'inventa cap lead. |
| WhatsApp Cloud API | Plantilles, finestra de 24 h, consentiment, webhook d'estats i missatges entrants | **Pendent de credencials**. «Acceptat» quan l'API respon; «lliurat» només amb el webhook. |
| Pujada de conversions a plataformes | **No s'envia res.** Es registren internament (`upload_status = no_configurat`). | Cal base jurídica i configuració abans d'activar-ho. |

**El que no fa el sistema:**
- crear, activar ni modificar campanyes o pressupostos publicitaris;
- crear audiències amb dades de factures.

## 9. Automatitzacions (motor existent)

- **Al formulari:** nou lead (tasca i avís).
- **A la lectura:**
  - factura processada (avís);
  - dades incompletes (tasca de revisió).
- **Al motor diari:**
  - lead sense assignar (avís a Direcció);
  - comparativa pendent de revisió;
  - contracte activat (avís al comercial i al col·laborador);
  - comissió meritada i liquidació disponible (avís al col·laborador).
- **Regles de la Fase 2 que es reutilitzen:** lead sense contactar i proposta sense resposta.
- **Al cron:** reintents de sol·licituds i lectures, anonimització i costos de Google Ads (si n'hi ha credencials).

## 10. Variables d'entorn i Vercel

Totes són a `env.example`, a l'apartat «Captació i màrqueting».

**Desplegament:**
1. Executa `013_captacio.sql` a l'editor SQL de Supabase, després de la 012. Enganxa'n el **contingut**, no el nom del fitxer.
2. Revisa les dades corporatives i els textos legals de `/privacitat` i `/avis-legal`. Després posa `NEXT_PUBLIC_COMPANY_VERIFIED=true`.
3. Defineix `NEXT_PUBLIC_LANDING_URL`, que fan servir els enllaços i els QR, i `CAPTURE_HASH_SALT`.
4. Webhooks de Meta: subscriu `https://<domini>/api/webhooks/meta` (camp `leadgen`) i `https://<domini>/api/webhooks/whatsapp` (camp `messages`) amb `META_WEBHOOK_VERIFY_TOKEN`. També cal `META_APP_SECRET`.
5. El middleware ja deixa passar sense sessió `/api/capture/submit`, `/api/capture/track` i `/api/webhooks`.

## 11. Pendent de verificar amb serveis reals

- La migració 013 a Supabase, la RLS i el bucket privat amb usuaris reals.
- Invitacions al portal amb correu real (`inviteUserByEmail`).
- Lectura amb IA de factures reals (`INVOICE_AI_ENABLED` i `ANTHROPIC_API_KEY`).
- Google Ads, Meta Lead Ads i WhatsApp Cloud API amb comptes reals.
- `after()` (segon pla) i el cron a Vercel.
- Revisió legal dels textos de privacitat i consentiment.
