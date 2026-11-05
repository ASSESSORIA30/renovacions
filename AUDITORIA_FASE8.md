# Auditoria Fase 8 · correcció d'errors, seguretat i optimització (01/11/2026)

Branca: `feature/crm-fase8-auditoria`. No s'ha fusionat a `main` ni s'ha desplegat a producció.
La migració `015_comunicacions.sql` només afegeix taules i polítiques: no esborra res. La 015_down es pot revertir i conserva les dades de `client_requests` i `user_workspace`.

Llegenda:
- ✅ **funcional verificada**: provada amb tests automàtics, PostgreSQL real o el navegador.
- 🟡 **parcial**: funciona, amb limitacions documentades.
- 🔴 **amb errors**: hi ha un error conegut no resolt.
- ⚪ **no implementada**.
- 🔧 **pendent de configuració externa**: el codi hi és, però cal una credencial o un servei extern.

## 1. Estat de cada funcionalitat

| Àrea | Funcionalitat | Estat | Notes |
|---|---|---|---|
| Menú | Menú lateral per grups: Inici, Clients, Comercial, Energia, Contractació, Economia, Col·laboradors, Intel·ligència i Administració | ✅ | Cerca ràpida, preferits, grups plegables, mode compacte, opció activa amb barra, comptador de tasques vençudes, teclat (fletxes/Inici/Fi), mòbil. Preferències desades a Supabase (`user_workspace`, clau `nav`). |
| Menú | Opcions sense pantalla pròpia | ⚪ | **Documents** (global) i **Contractes** (llistat global) no surten al menú, perquè no hi ha cap pantalla. Els documents són a la fitxa del client i els contractes a «Subministraments» i als expedients. No s'han creat enllaços buits. |
| Clients 360° | Fitxa, cerca, duplicats per NIF/CIF, RLS per comercial | ✅ | Fases 1-7; proves de regressió verdes. |
| Clients 360° | Nova pestanya **Comunicacions** i botons «Sol·licitar ressenya» / «Sol·licitar autorització de dades» | ✅ | Historial amb l'estat d'entrega real. |
| Documents | Storage privat, validació de contingut, conservació obligatòria | ✅ | Nova categoria `proteccio_dades` per a les evidències. |
| SIPS | Cerca per CUPS (20/22 caràcters) i per codi postal i adreça | ✅ lògica / 🔧 connexió | Validació, errors tipificats, temps límit de 12 s i límit per minut. La **connexió real amb el portal no s'ha pogut provar**: no hi ha credencials en aquest entorn. |
| SIPS | Errors diferenciats | ✅ | `no_configurat`, `credencials`, `no_disponible` (inclou temps esgotat i xarxa), `cups_invalid`, `sense_permisos`, `limit`, `transformacio`, `consulta`. Si no hi ha resultats es retorna 0 files i no s'inventa cap dada. |
| SIPS | Vincular al subministrament del CRM (`/api/sips/link`) | ✅ | Actualitza consum, tarifa, potències, comercialitzadora i adreça, amb `data_source='sips'` i la data. Deixa una activitat a la fitxa i un registre d'auditoria. |
| SIPS | Visibilitat per als comercials dels CUPS del CRM | ✅ corregit | Abans només es comprovava la taula antiga `contracts`. |
| SIPS | El botó desactivat ara n'explica el motiu; els textos castellans s'han traduït | ✅ corregit | |
| Energia | Ofertes, configuració, factures i màxims de potència | ✅ corregit | Abans es desaven **només a IndexedDB del navegador**. Ara se sincronitzen amb `user_workspace` amb control de versions: un 409 es fusiona i es torna a provar. |
| Energia | Dades de demostració | ✅ | El carregador de demo només apareix **sense Supabase**. No se n'han trobat en producció. |
| Comunicacions | Correu per usuari (SMTP propi) | ✅ lògica / 🔧 SMTP real | La credencial es xifra amb AES-256-GCM, mai es retorna i es pot revocar. Hi ha botó de prova de connexió. Un correu només queda «enviat» si l'SMTP l'accepta. |
| Comunicacions | OAuth de Google i Microsoft | 🔧 | Preparat a l'esquema. Cal registrar l'aplicació a cada proveïdor; no s'ha simulat. |
| Comunicacions | WhatsApp, mode A (enllaç wa.me) | ✅ | Queda com a «intent» fins que l'usuari confirma «L'he enviat». El CRM **no pot confirmar** l'entrega en aquest mode. |
| Comunicacions | WhatsApp, mode B (Cloud API) | 🔧 | Només s'hi poden enviar números empresarials autoritzats per Direcció, i es respecta la finestra de 24 h. Pendent de `WHATSAPP_TOKEN` i d'alta a Meta. |
| Ressenyes | Català/castellà, missatge editable, copiar, WhatsApp, correu, Google Reviews, registre i darrera data | ✅ | Mai no s'indica «publicada». Duplicats de menys de 2 min bloquejats. Es respecten la baixa comercial i el «no contactar». |
| Protecció de dades | Estats pendent / sol·licitada / formulari enviat / signada-completada / rebutjada / caducada | ✅ | «Completada» exigeix una evidència del mateix client o una nota, i deixa qui ho confirma i quan (`sec_audit`). Obrir l'enllaç no ho marca mai com a signat. |
| Protecció de dades | API de fdigital.es | ⚪ (extern) | No hi ha cap API ni webhook públic documentat. La confirmació és manual, amb evidència i auditoria. |
| Permisos | Rols de la Fase 7 i permisos per mòdul | ✅ | Sense canvis de rol. Cada usuari gestiona només el seu correu i el seu WhatsApp. |
| Portal | /collaboradors (col·laboradors), sense accés al CRM intern | ✅ | Regressió de la Fase 7 verda. |

## 2. Auditoria de seguretat

| Punt | Resultat |
|---|---|
| Secrets al repositori | Cap. S'han cercat patrons de claus Anthropic, JWT de Supabase, `sb_secret_`, AWS i claus privades. Els `.env*` estan a `.gitignore`. |
| Secrets al navegador | Cap. Al codi client compilat (`.next/static`) només apareixen **noms** de variables en textos d'ajuda, mai valors. No hi ha cap clau de servei al frontend. |
| Source maps | `productionBrowserSourceMaps: false`; s'ha comprovat que no hi ha cap `.map` a la compilació. |
| Capçaleres | S'hi han afegit `Strict-Transport-Security` i `poweredByHeader: false`. Ja hi havia `X-Frame-Options: DENY` (iframes prohibits). |
| **/api/health** | 🔴→✅ **corregit**. Era públic i revelava recomptes, noms de fitxers de Google, el servidor SMTP, el model d'IA i errors interns, i feia crides a Anthropic a càrrec de qualsevol visitant. Ara, sense una sessió de Direcció, només retorna `{ok, at}`. |
| Endpoints públics | Les propostes (`/p/[token]`), les ressenyes i la protecció de dades (enllaços externs) i els formularis de captació continuen públics, amb token, validació, límit per IP i anti-spam (Fase 6). |
| Credencials SMTP dels usuaris | Taula `user_mail_accounts` amb RLS **sense polítiques**: ni el mateix usuari no la pot llegir des del navegador. S'ha verificat amb PGlite i a PostgreSQL 16. |
| Concurrència | `/api/workspace` fa un compare-and-set per versió (un 409 retorna les dades actuals), en comptes de llegir i després escriure. |
| Registres | Els errors del portal SIPS ja no reenvien el cos de la resposta (podia contenir detalls interns). |
| Seguiment ocult | No n'hi ha: cap captura de pantalla, keylogger ni monitoratge ocult. |

### Dependències (`npm audit --omit=dev`): 13 avisos (10 moderats i 3 alts)

Totes les correccions disponibles són **canvis de versió major**, que podrien trencar l'aplicació. No s'han aplicat en aquesta fase.

- **zod 3 → 4.6.7** (alt): risc d'esgotament de memòria amb col·leccions enormes. Les entrades ja estan limitades per mida (`max()`) i el cos de les peticions està acotat. Migració recomanada en una fase pròpia.
- **xlsx 0.18.5** (alt; sense correcció a npm): SheetJS es distribueix ara des del seu CDN (0.20.x). Els fitxers que es processen els pugen usuaris interns autenticats. Es recomana substituir el paquet per la versió del CDN.
- **next 15 → 16** (moderat, via postcss): afecta l'eina de compilació, no l'execució. Es farà en l'actualització de Next.
- **exceljs, uuid, glob, minimatch i archiver** (moderats): són dependències transitives de l'exportació Excel.

### Secrets a revocar
No s'ha trobat cap secret exposat al repositori ni a la compilació, de manera que no cal revocar-ne cap per aquest motiu. Recomanació general: si en algun moment s'ha compartit `SUPABASE_SERVICE_ROLE_KEY` o `SIPS_PASSWORD` fora de Vercel, cal rotar-les.

## 3. Errors corregits en aquesta fase
1. `/api/health` exposava la configuració interna i generava costos d'IA a qualsevol visitant.
2. SIPS:
   - no tenia temps límit (podia esgotar la funció de Vercel);
   - els errors no estaven tipificats i podien filtrar el cos del portal;
   - un error d'estat es mostrava com «Requereix Supabase»;
   - els comercials no veien els CUPS del CRM;
   - el botó desactivat no donava cap explicació;
   - la interfície tenia textos en castellà;
   - es mostrava «Connectat» sense haver provat mai la connexió (ara diu «Credencials configurades»).
3. Mòdul energètic: les dades només eren al navegador (es perdien en canviar de navegador o de dispositiu).
4. Concurrència de l'espai de treball (read-then-write) → compare-and-set.
5. L'enllaç `mailto:` codificava l'`@` del destinatari (alguns clients de correu no l'acceptaven).
6. Obrir WhatsApp després d'una crida asíncrona pot ser bloquejat per Safari. Ara la finestra s'obre dins del clic i, si el registre falla, es tanca.
7. Algunes vistes (Captació, Control econòmic, Liquidacions, Usuaris i permisos) no canviaven de pestanya quan s'hi arribava des del menú amb una altra pestanya.
