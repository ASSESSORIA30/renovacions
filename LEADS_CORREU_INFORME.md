# Captació automàtica de leads per correu · informe de lliurament

Branca: `feature/captacio-leads-email` (feta a partir de `main` del 20/11/2026). Migració: **058** (la següent de `main`, que ja arriba a la 057).

## Què fa

Cada correu que arriba a info@assessoria30.com es llegeix en mode **només lectura** (no s'esborra, no es mou i no es marca com a llegit). El CRM:

1. **Formularis de la web (Formspree):** comprova el remitent `noreply@formspree.io` **i** l'estructura del contingut (camps reconeguts i un telèfon o correu vàlid). Si el remitent és Formspree però no hi ha formulari (avisos del servei), no és un lead.
2. **Dades de la calculadora:** `Dades_calculadora` es llegeix directament, com a text JSON o com a objecte, **sense IA**. Es desen el servei, la tarifa (3.0 → 3.0TD perquè és l'única del catàleg), els dies, la factura actual, la factura estimada i l'estalvi. Sempre es marquen com a **orientatius**: no són una comparativa validada ni un preu contractual. No es calcula res que no hi sigui.
3. **Consultes directes:** es classifiquen amb regles en sis categories: oportunitat, client existent, incidència, administratiu, irrellevant o dubtós. Si s'activa, també amb IA. Els correus dubtosos, els de poca confiança, els que tenen instruccions sospitoses i els que la IA no ha pogut classificar queden **pendents de revisió**.
4. **Lead:** normalitza el correu i el telèfon i cerca el contacte per correu, telèfon, NIF/CIF i CUPS.
   - Si és **nou**, crea el lead amb l'estat «Pendent de contactar» i el deixa a la cua d'Administració.
   - Si ja és un **lead**, s'hi vincula i només omple els camps buits.
   - Si ja és un **client**, crea l'oportunitat a la seva fitxa sense tocar-ne les dades.
   - Si la coincidència és **ambigua** (coincideix amb més d'una fitxa, o només el telèfon amb un correu diferent), crea igualment un **lead nou marcat com a «possible duplicat»**, amb una nota que indica amb quines fitxes coincideix. No vincula ni modifica cap fitxa existent.
   - Crea una **oportunitat per servei**. Si ja n'hi ha una d'oberta del mateix servei, la reaprofita.
   - Registra una activitat (un correu rebut no compta com a contacte fet), desa els documents al bucket privat i envia un avís intern.
5. **Cap correu s'envia al client.** L'esborrany de resposta es mostra perquè el comercial el revisi i l'obri al seu correu.

## On és al CRM

- **Comercial → Leads entrants**: el llistat té filtres per servei, comercial, estat i data, un avís de leads pendents i una fitxa per a cada lead amb aquests blocs:
  - contacte;
  - consulta original;
  - simulació de la web;
  - documentació;
  - activitats;
  - accions: trucar, preparar resposta amb IA, sol·licitar documentació, preparar la comparativa real, assignar, crear una tasca, convertir en client i descartar.

  La pestanya **Correus per revisar** és només per a Administració.
- **Configuració → Integracions → Correu i leads** (només Direcció) té:
  - l'estat de la connexió i els comptadors;
  - els botons: provar la connexió, sincronitzar ara, importar leads anteriors, consultar els errors i pausar o reprendre;
  - les opcions.

## Taules i migracions

Fitxers: `058_leads_correu.sql` i `058_leads_correu_down.sql`. La migració és additiva i idempotent.

- **Taules noves:**
  - `lead_mail_settings`
  - `lead_mailboxes`
  - `lead_mail_messages`
  - `lead_mail_imports`
  - `lead_mail_runs`
- **Columnes noves (poden quedar buides):**
  - a `crm_leads`: `inbound_source`, `inbound_stage`, `inbound_priority`, `inbound_last_at`, `web_simulation` i `access_tariff`;
  - a `crm_opportunities`: `source_mail_message_id` i `web_simulation`.
- **Funcions** (només per al servidor): `lead_mail_try_lock` i `lead_mail_unlock`.
- **Regla d'avís** `lead_correu_sense_contacte`: 24 hores laborables, configurable.
- **Opcional, per activar la sincronització:** `supabase/optional/leads_correu_cada_5_minuts.sql`. No és una migració.

## Variables d'entorn (Vercel, només servidor)

`LEADS_IMAP_HOST`, `LEADS_IMAP_PORT`, `LEADS_IMAP_USER`, `LEADS_IMAP_PASSWORD`, `LEADS_IMAP_SECURE`, `LEADS_IMAP_FOLDER`, `LEADS_SYNC_ENABLED=false`, `LEADS_SYNC_INTERVAL_MINUTES` i `LEADS_AUTO_SEND_ENABLED=false`. Estan documentades a `env.example`. La contrasenya no s'escriu mai al codi i no surt ni a la interfície ni als registres.

## Automatització

El pla de Vercel és Hobby: només admet tasques **diàries** (`vercel.json` i el test `vercel-cron-hobby` ho confirmen). Per això:

- no s'ha tocat `vercel.json`;
- Supabase crida `/api/leads/cron` cada 5 minuts, amb el mateix mecanisme que ja feu servir per a l'agenda i les renovacions (`pg_cron` + `pg_net` + `CRON_SECRET`).

Una sincronització dura uns segons i cap dins del límit de 60 segons de la funció. Funciona així:

- un sol procés per bústia, amb un bloqueig que caduca sol;
- un registre persistent per correu, amb la clau bústia + UIDVALIDITY + UID i el Message-ID;
- el punt de sincronització només avança quan el correu ja està desat;
- una cua amb reintents limitats i recuperació de les feines interrompudes;
- el primer cop no recorre l'històric: per a això hi ha «Importar leads anteriors», que primer mostra una previsualització i després demana confirmació.

## Proves

- `tests/leads-correu-core.test.ts`: 20 proves de la lògica pura.
- `tests/leads-correu-servidor.test.ts`: 31 proves. Fan servir una bústia simulada i un Supabase en memòria, i cobreixen els 20 casos obligatoris.
- `tests/db/leads-correu-058.test.ts`: 6 proves sobre PostgreSQL real (PGlite): RLS, idempotència, bloqueig i reversió.

**Tot està provat amb simulació.** La connexió real amb IONOS i la importació real del lead de Marta **no s'han provat de debò**: falta la contrasenya i aquest entorn no pot sortir a imap.ionos.es. El cas de Marta s'ha reproduït amb la mateixa estructura i els mateixos imports, però amb dades fictícies.
