# Assessoria 3.0 · Intelligence Platform

Una sola plataforma amb **Renewal Intelligence Pro** (CRM de renovacions) i **Energy Intelligence Pro** (`ASSESSORIA30/cups2`): una autenticació, un menú i dades compartides. Detall tècnic de la fusió: [`FUSIO.md`](FUSIO.md). Resultats de les proves: [`INFORME_PROVES.md`](INFORME_PROVES.md).

## Instal·lació

```bash
npm install
cp env.example .env.local      # sense Supabase funciona en mode local (sense dades)
npm run dev
npm run typecheck && npm run test && npm run lint && npm run build
```

## Base de dades (Supabase · projecte `supabase-copper-ferry`)

Migracions en ordre: `001_init.sql`, `002_offer_ids_text.sql`, `003_roles.sql` (ja aplicades a producció) i les noves **`004_sips_cache_enriquida.sql`** i **`005_energy_inputs_audit.sql`**. Totes dues són incrementals i idempotents: no eliminen ni recreen cap taula. Abans d'executar-les, fes una còpia de seguretat (Supabase → Database → Backups).

## Desplegament a Vercel

1. Puja la branca `feature/fusio-energy-intelligence` al repositori de Renovacions i obre una **Preview** (no publiquis directament a producció).
2. Variables d'entorn a **Production i Preview** (per separat): les de Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), Google, correu, IA, `CRON_SECRET` i `SIPS_USER` / `SIPS_PASSWORD`. Opcionals: `SIPS_TTL_DAYS`, `SIPS_CRON_LIMIT`, `SIPS_EXTERNAL_ROLES`… (vegeu `env.example`). `APP_ACCESS_KEY` ja no cal.
3. Les variables `NEXT_PUBLIC_` s'incorporen durant la compilació: si les canvies, torna a desplegar.
4. Les rutes SIPS s'executen preferentment a París (`cdg1`), com a cups2.
5. Cron (`vercel.json`): una vegada al dia a les 05:00 UTC (Google Drive + un lot de CUPS SIPS). Al pla Pro es pot fer més freqüent.
6. Diagnòstic: Configuració → Integracions o `GET /api/health`.

### Validació a la Preview (abans de producció)

- [ ] Inici de sessió amb un administrador i amb un comercial; el comercial només veu els seus contractes.
- [ ] Els contractes de Google Drive són els mateixos; el Kanban permet arrossegar i desfer.
- [ ] Migracions 004 i 005 aplicades; «Configuració → Energia i SIPS» mostra «Servidor configurat».
- [ ] Buscador SIPS: un CUPS de 20 caràcters (sense `0F`), el mateix de 22, i en minúscules.
- [ ] Un CUPS de **gas** real: apareix al buscador, la fitxa mostra el consum (anual i mensual) i el contracte de gas en mostra les dades SIPS. Revisa si el portal informa el consum de gas al mateix camp que la llum; si no, afegeix-ne el camp a `SIPS_EXTRA_COLUMNS`.
- [ ] Cerca per adreça amb «Gas» i peatge RL.x.
- [ ] Cerca per codi postal + carrer (amb majúscules i minúscules) amb un rol autoritzat; un comercial no hi té accés.
- [ ] Kanban → «Analitzar CUPS» → fitxa amb gràfics → «Tornar» → «Prepara l'oferta».
- [ ] «Actualitza des del SIPS» desa a `sips_cache` (comprova `consulted_at`, `raw`, `monthly_kwh`).
- [ ] «Enriqueix ara» actualitza contractes pendents; les targetes mostren «SIPS dd/mm».
- [ ] Energy Market → desar consums per període → el generador d'ofertes els proposa com a «Font: factura».
- [ ] Generació del PDF, enviament per correu i WhatsApp preparat.
- [ ] `sips_audit` registra les consultes; el límit per minut respon 429.

### Punts pendents i limitacions

- Les pantalles internes de cups2 conserven els textos originals en castellà; el menú, la fitxa, el dashboard i els missatges nous són en català.
- La cartera energètica importada des d'Excel i les notes d'«Oportunitat» de cups2 es continuen desant al navegador de cada usuari. Les dades SIPS dels contractes i les dades de factures es desen a Supabase.
- Les ofertes d'**Energy Market** (cups2, €/kW·any, per a la fitxa) i les ofertes verificades del CRM (€/kW·dia, per al PDF de renovació) continuen sent catàlegs separats.
- La consulta a EAS és una integració amb un portal no oficial: cal validar-la amb CUPS reals i respectar-ne les condicions d'ús.

---

## CRM · Clients 360°

Vegeu `CRM_FASE1.md` (model de dades, permisos, gestor documental, integracions, API i desplegament). Cal executar la migració `008_crm_clients360.sql`.

## CRM comercial (Fase 2)

Leads, oportunitats, Kanban comercial, «La meva jornada», automatitzacions i rendiment. Vegeu `CRM_FASE2.md`. Cal executar la migració `009_crm_comercial.sql` després de la 008.

## Contractació i tramitacions (Fase 3)

Expedients de contractació, Kanban de tramitacions, documentació obligatòria configurable, plantilles autoritzades i PDF, signatura electrònica (adaptador, integració pendent sense credencials), activació amb contracte nou i renovació, i preparació de comissions. Vegeu `CRM_FASE3.md`. Cal executar la migració `010_crm_contractacio.sql` després de la 009.

## Control econòmic i comissions (Fase 4)

Regles de comissions versionades en dues capes (proveïdor → Assessoria 3.0 i Assessoria 3.0 → comercials/col·laboradors), llibre de moviments immutable, liquidacions amb aprovació de Direcció, conciliació amb les comercialitzadores, rendibilitat i alertes. Vegeu `CRM_FASE4.md`. Cal executar la migració `011_crm_economia.sql` després de la 010.

## Intel·ligència IA (Fase 5)

Motor d'oportunitats (renovacions 120/90/60/30/15 dies, estalvis, contractes cars, potència, recuperació, venda creuada, propostes sense resposta, dades incompletes i tarifes caducades), comparatives deterministes amb 3 alternatives, propostes PDF desades a la fitxa del client com a esborrany, puntuació 0-100 explicada i Copilot IA amb eines autoritzades. Vegeu `CRM_FASE5.md`. Cal executar la migració `012_ai_intelligence.sql` després de la 011.

## Captació, portal de col·laboradors i màrqueting (Fase 6)

Landing pública `/estudi` amb pujada de factura, formulari amb antispam i idempotència, lectura de la factura i comparativa preliminar en esborrany, creació automàtica del lead (Fase 2) amb tasca i assignació, portal privat per a col·laboradors (ara `/collaboradors`; `/portal` hi redirigeix) amb enllaç, codi i QR, atribució segura, panell «Captació i màrqueting» i webhooks de Meta Lead Ads i WhatsApp. Vegeu `CRM_FASE6.md`. Cal executar la migració `013_captacio.sql` després de la 012.

## Consolidació, Direcció compartida i supervisió (Fase 7)

- **Rols:** cinc rols amb permisos per mòdul (lectura, edició, aprovació) configurables des de Direcció. Les dades econòmiques només les veu qui Direcció autoritza.
- **Panells:**
  - Centre de Control personalitzable per a cada persona de Direcció (desat per identificador d'usuari);
  - Supervisió administrativa;
  - La meva jornada;
  - Panell comercial.
- **Gestió diària:**
  - gestor global de tasques i d'incidències, amb historial i escalats;
  - centre d'alertes i automatitzacions;
  - revisió de la qualitat de dades;
  - cercador global ampliat.
- **Informes:** informes PDF per rol amb enviament programat, i productivitat basada en l'activitat registrada.
- **Portal:** el portal de col·laboradors passa a `/collaboradors`.
- **Seguretat:** auditoria de seguretat, MFA activable i còpies verificables (`scripts/backup.sh`, `scripts/restore-verify.sh`).

Documentació: `CRM_FASE7.md` (inclou les definicions dels indicadors i el desplegament) i `AUDITORIA_FASE7.md` (auditoria inicial).

Instal·lació:
1. Executa la migració `014_consolidacio.sql` després de la 013.
2. Revisa els correus de `supabase/seed/fase7_equip.sql` i executa'l.

## Auditoria, comunicacions per usuari i menú definitiu (Fase 8)
- **Menú** reorganitzat en 9 àrees (Inici, Clients, Comercial, Energia, Contractació, Economia, Col·laboradors, Intel·ligència, Administració). Té cerca ràpida, preferits, mode compacte i navegació amb teclat, i les preferències es desen a Supabase.
- **El meu perfil → Comunicacions:** cada persona hi configura el seu correu (SMTP xifrat, prova de connexió i revocació) i el seu WhatsApp (enllaç o Cloud API amb un número autoritzat).
- **Fitxa del client:** «Sol·licitar ressenya» i «Sol·licitar autorització de dades», i nova pestanya Comunicacions amb l'historial i l'estat d'entrega real.
- **SIPS:** errors tipificats, temps límit, visibilitat dels CUPS del CRM i vinculació de les dades al subministrament.
- **Seguretat:** `/api/health` restringit, capçalera HSTS, sense source maps. El mòdul energètic ja no depèn només del navegador.
- Migració: `015_comunicacions.sql` (s'aplica després de 013, 014 i `fase7_equip.sql`).

Documentació: `AUDITORIA_FASE8.md` (estat de cada funcionalitat i seguretat), `CRM_FASE8.md` (Vercel i configuració) i `INFORME_PROVES.md` (les 50 proves).

## Comparatives IA

Vegeu `COMPARATIVES_IA.md` (modes d'entrada, catàleg, motor de càlcul, lliurament, seguretat). Cal executar la migració `006_comparatives_ia.sql` i, opcionalment, definir `INVOICE_AI_ENABLED` i `TARIFF_CONNECTORS`.

## Renewal Intelligence Pro (mòdul CRM) · documentació original

CRM de renovaciones de luz, gas y telefonía. Kanban con arrastrar y soltar, ficha de cliente, plan diario, calendario, propuestas PDF con comparativa, WhatsApp/email, prioridad inteligente 0–100, estadísticas y permisos por comercial.

Stack: Next.js 15 · React 19 · TypeScript · Tailwind · dnd-kit · Motion · Recharts · Lucide · Supabase (auth, Postgres con RLS, Storage) · Google Drive/Sheets API · Nodemailer (SMTP IONOS) · Anthropic API · Vercel.

## Datos de origen

| Fuente | Uso |
|---|---|
| `Contratos_*.xlsx` (export del CRM, pestaña **Contratos**) | Datos maestros: CIF, nombre, dirección, teléfono, email, CUPS, tarifa, consumo, potencias P1–P6, estado, fechas |
| `CONTRACTES PER DIA.xlsx` (pestañas **2025**, **2026**…) | Se cruza por **CUPS**: comercial (ADMIN GESTIONO), captador (admin), comercializadora anterior, precio contratado, comentarios de llamada, marca RENOVAT 2026 |

Reglas de importación (`src/core/importer.ts`, cubiertas por tests):

- **Un contrato por CUPS**: se queda con el registro más reciente; los anteriores cuentan como «contratos previos». Sin CUPS → clave CIF + tarifa + producto + nombre.
- **Fecha de inicio**: activación → tramitación → DATA del diario → fecha de traspaso. Este último caso es la fecha de importación al CRM, no la real, y se marca como «Fecha a revisar».
- **Vencimiento** = inicio + 12 meses. Si ya pasó hace más de 15 días, se calcula el siguiente aniversario (renovación tácita) y se marca.
- **Estado inicial**: Baja/Anulado → «No quiere renovar»; RENOVAT 2026 = SI/OK → «Renovado»; otra nota en RENOVAT 2026 → «Contactado»; resto → «Pendiente».
- **El IBAN no se importa nunca.**
- Columnas detectadas automáticamente (sinónimos en ES/CA), con correspondencia editable en *Ajustes → Datos*.

La sincronización solo escribe en la tabla `contracts`. Estados, comunicaciones, tareas, documentos y ofertas están en tablas propias y **nunca se sobrescriben**. Un contrato que desaparece de la hoja se marca como `removed_from_source` y no se borra.

## Puesta en marcha

```bash
npm install
cp env.example .env.local      # rellena lo que tengas
npm run dev                     # sin Supabase: modo local vacío; importa los Excel en Ajustes
npm test                        # tests del importador, comparativa y prioridad
```

### 1. Supabase
1. Crea el proyecto y ejecuta `supabase/migrations/001_init.sql` (SQL editor o `supabase db push`).
2. Copia URL, anon key y service role key en las variables de entorno (Vercel → Settings → Environment Variables) y vuelve a desplegar.
3. Crea **tu** usuario en Supabase → *Authentication → Add user* (con contraseña). **El primer usuario es administrador.**
4. El resto de usuarios se crean desde la app: *Ajustes → Usuarios → Nuevo usuario* (con contraseña o invitación por email). Cada comercial necesita su código (`IBETH`, `IRENE`, `OLIVIE`, `WEEKO`, `JENNI`…) para ver solo sus contratos.

**Diagnóstico:** *Ajustes → Integraciones* (o `GET /api/health`) indica en directo qué falta: variables, tablas, primer administrador, acceso a Google, SMTP, validez de la clave de IA y CRON_SECRET.

### 2. Google (sincronización automática)
1. Google Cloud → crea una cuenta de servicio y activa **Drive API** y **Sheets API**. Descarga la clave JSON y pégala en `GOOGLE_SERVICE_ACCOUNT_JSON`.
2. Comparte las dos hojas con el `client_email` de la cuenta de servicio (permiso de lector).
3. `SOURCE_CRM_FILE_ID` y `SOURCE_DIARIO_FILE_ID` ya vienen en `env.example`. Como el CRM genera un archivo nuevo en cada exportación (`Contratos_AAAAMMDD_HHMMSS.xlsx`), lo recomendable es guardar las exportaciones en una carpeta de Drive y poner su ID en `SOURCE_CRM_FOLDER_ID`: se usará siempre la más reciente.
4. El cron de Vercel (`vercel.json`) sincroniza **una vez al día** (05:00 UTC), que es el máximo del plan Hobby; una frecuencia mayor hace fallar el despliegue. En el plan Pro puedes cambiarlo a `*/15 * * * *`. Con Hobby, otra opción es un programador externo que llame a `GET /api/sync/cron` con la cabecera `Authorization: Bearer <CRON_SECRET>`. Define `CRON_SECRET`. El botón «Sincronizar ahora» funciona siempre.
5. **Bidireccional**: los archivos actuales son `.xlsx` guardados en Drive, y la API no permite editar celdas en ellos. Para escribir el estado del CRM de vuelta, convierte la hoja a formato Google Sheets (*Archivo → Guardar como Hojas de cálculo de Google*), compártela como **editor** y pon su ID en `WRITEBACK_SHEET_ID`. En cada sincronización se rellena una columna `ESTADO CRM` por CUPS.

### 3. Email (IONOS)
`SMTP_HOST=smtp.ionos.es`, `SMTP_PORT=587`, usuario y contraseña del buzón y `SMTP_FROM`. Sin SMTP, el botón pasa a ser «Abrir en mi correo» (mailto) y queda registrado como *Preparado*. Con SMTP, como *Enviado* cuando el servidor acepta el mensaje. *Entregado* requiere confirmación del proveedor y no se marca sin ella.

### 4. IA
`ANTHROPIC_API_KEY` (y opcionalmente `ANTHROPIC_MODEL`). El servidor reconstruye el contexto desde la base de datos con los permisos del usuario. El prompt prohíbe inventar precios, ahorros u ofertas. Sin clave, el análisis de la ficha se calcula con reglas a partir de los datos reales, y así se indica.

### 5. WhatsApp
Ahora funciona con enlaces `wa.me` y el mensaje preparado. `/api/whatsapp/send` ya está listo para WhatsApp Business Platform (plantillas aprobadas). Falta el webhook de estados de entrega para marcar *Entregado*.

### 6. Vercel
Importa el repositorio, añade las variables de entorno y despliega. Las rutas `/api/*` corren en Node.

## Roles
| Rol | Ve | Además |
|---|---|---|
| Administrador | Todos los contratos | Gestiona usuarios e integraciones; asigna tareas |
| Cap administrativa | Todos los contratos | Asigna tareas a cualquiera desde «El teu pla d'avui» |
| Administrativa | Todos los contratos | Ofertas, plantillas, configuración e importación |
| Comercial | Contratos con su código en ADMIN GESTIONO | — |
| Col·laborador | Contratos con su código en la columna admin (prefijo «COL.» opcional) o cuyo «Usuario propietario» del CRM es su email | — |

Migraciones a ejecutar en orden: `001_init.sql`, `002_offer_ids_text.sql`, `003_roles.sql`, `004_sips_cache_enriquida.sql`, `005_energy_inputs_audit.sql`.

## Ofertas
- *Ofertas → Importar plantilla Excel* lee la plantilla de comercializadoras (ZocoProductos, hoja «Productos»). Se importan las filas de Electricidad, Gas y Dual (la dual genera una oferta de luz y otra de gas); telefonía, alarmas y autoconsumo se omiten indicando el motivo.
- Clave «comercializadora + tarifa + producto»: al reimportar se actualizan los precios sin duplicar.
- La plantilla no tiene vigencia: se indica al importar. Solo las ofertas marcadas como verificadas se pueden usar en propuestas.
- Rangos de consumo/potencia, ámbito y residencial/pyme se muestran como avisos en el asistente de propuestas. Los fees se guardan como información (no se suman a los precios).

## Propuestas PDF
- Solo usan **ofertas verificadas y vigentes** registradas en *Ofertas* (admin). No hay precios precargados.
- La comparativa exige consumo y potencia por periodo y los precios actuales de la factura del cliente. Si falta algo, lo dice y no calcula.
- IEE, IVA y alquiler de contador son hipótesis configurables (*Ajustes → Empresa y PDF*). El PDF las muestra siempre, separando importes con y sin impuestos.
- Cada PDF queda versionado en *Documentos* (Supabase Storage privado; enlace firmado de 7 días para compartir).

## Prioridad 0–100
Suma ponderada (pesos editables en *Ajustes → Prioridad*) de: proximidad del vencimiento, consumo, valor por tarifa, días sin contacto, estado, seguimientos pendientes y riesgo (vence pronto sin contacto, seguimiento atrasado, objeciones en notas, renovación tácita). Cada ficha muestra el desglose. Crítica ≥ 75 · Alta ≥ 55 · Media ≥ 35 · Baja.

## Seguridad y RGPD
- RLS en todas las tablas; los comerciales solo ven sus contratos. La service role se usa solo en la sincronización del servidor.
- Auditoría (`audit_log`) de cambios de estado y ofertas, con usuario y fecha.
- Un contrato cerrado (renovado/perdido) solo lo puede reabrir un administrador.
- Bucket de documentos privado; cabeceras de seguridad; `noindex`.
- `demo/seed.json` contiene datos reales y está en `.gitignore`.

## Demo de un solo archivo
`npm run demo:seed -- <crm.xlsx> <diario.xlsx>` y después `npm run demo:build`. Genera `demo/dist/index.html` con la misma app y almacenamiento local en el navegador. Es **privado**: lleva datos personales de clientes.

## Estructura
```
src/core     lógica pura (importador, prioridad, comparativa, PDF, plantillas)
src/data     repositorios (local / Supabase) y store (zustand)
src/ui       interfaz (vistas y componentes)
src/server   código de servidor (Google, SMTP, IA, Supabase admin)
app/         Next.js (página, login, API routes)
supabase/    migración SQL con RLS
tests/       vitest
```

## Fase 8.2 · Documents de la fitxa de renovació i reclamacions a comercialitzadores

Correcció de la caiguda de la pestanya «Documents» i nou mòdul *Economia → Reclamacions*. Cal executar la migració `018_reclamacions.sql` (després de la 017). Detall i proves: [`FASE8_2_INFORME.md`](FASE8_2_INFORME.md).
