# CRM Fase 8 · Comunicacions per usuari, ressenyes, autoritzacions de dades, SIPS i menú definitiu

## 1. Ordre de les migracions a Supabase (SQL Editor)

Copia i enganxa el **contingut** de cada fitxer al SQL Editor, no el nom del fitxer. Executa'ls en aquest ordre:

1. `supabase/migrations/013_captacio.sql` (si encara no s'ha aplicat)
2. `supabase/migrations/014_consolidacio.sql`
3. `supabase/seed/fase7_equip.sql` (revisa abans els correus de l'equip)
4. **`supabase/migrations/015_comunicacions.sql`** (nova)

Comprovació final:

```sql
select to_regclass('public.user_mail_accounts') is not null as m015;
```

Si cal tornar enrere, executa `015_comunicacions_down.sql`. No esborra les sol·licituds de ressenya o de dades ni l'espai de treball.

## 2. Variables d'entorn a Vercel (Settings → Environment Variables)

| Variable | Per a què | Obligatòria |
|---|---|---|
| `SETTINGS_ENCRYPTION_KEY` | Clau per xifrar les credencials SMTP de cada usuari: 32 o més caràcters aleatoris, que es poden generar amb `openssl rand -base64 48`. Si no hi és, es deriva de la clau de servei; és millor separar-les. | Molt recomanada |
| `SIPS_USER`, `SIPS_PASSWORD` | Portal SIPS. Només al servidor. | Per a SIPS |
| `WHATSAPP_TOKEN` | WhatsApp Business Cloud API (mode B). Els números empresarials els dona d'alta Direcció a «El meu perfil → WhatsApp». | Només per al mode B |
| Les de les fases anteriors | Supabase, Anthropic, Google, CRON_SECRET… | Sense canvis |

No posis mai cap d'aquestes variables amb el prefix `NEXT_PUBLIC_`.

## 3. Configuració per persona
- **Correu:** El meu perfil → Comunicacions → Email. Cal triar el proveïdor, posar la contrasenya d'aplicació i fer «Desa» i després «Prova la connexió».
  - Microsoft 365: cal tenir activat l'SMTP autenticat al compte.
  - Gmail: cal la verificació en dos passos i una contrasenya d'aplicació.
- **WhatsApp:** El meu perfil → Comunicacions → WhatsApp.
  - Mode A (aplicació): només cal el número propi.
  - Mode B (Cloud API): cal que Direcció autoritzi un número empresarial.
- **OAuth (Google / Microsoft):** l'esquema ja ho preveu, però cal registrar l'aplicació a cada proveïdor. Fins llavors, cal fer servir SMTP.

## 4. Ressenyes i protecció de dades
- **Fitxa del client → «Sol·licitar ressenya»** (https://g.page/r/CeQVI7cNNDvREBM/review):
  - el missatge pot ser en català o castellà, i es pot editar;
  - es pot copiar, enviar per WhatsApp o per correu, o obrir Google Reviews.
  - El CRM registra la sol·licitud, **mai la publicació**: Google no ofereix cap confirmació fiable.
- **«Sol·licitar autorització de dades»** (https://www.fdigital.es/assessoria30/):
  - fdigital.es no té API pública, així que el pas a «Signada / completada» es fa a mà, a la pestanya Comunicacions, amb un document d'evidència o una nota;
  - cada canvi queda a l'auditoria;
  - cal triar la base jurídica, perquè el consentiment no és l'única.

## 5. Desplegament a una Preview (sense tocar producció)
1. `git push` de la branca `feature/crm-fase8-auditoria` al repositori (sense fusionar-la).
2. Vercel crea una **Preview**. Configura-hi les variables d'entorn per a l'entorn Preview.
3. A Supabase de proves, aplica la 015.
4. Comprova:
   - `/api/health` sense sessió retorna només `{ok, at}`;
   - SIPS amb un CUPS real;
   - un correu de prova des de «El meu perfil»;
   - una sol·licitud de ressenya.
5. Només amb la vostra autorització: fusiona a `main` i aplica la 015 a producció.

## 6. Pendents de configuració externa
- Credencials SIPS: cal provar la connexió real.
- SMTP de cada persona.
- `WHATSAPP_TOKEN` i alta dels números a Meta (mode B).
- Aplicacions OAuth de Google i Microsoft.
- Actualització de dependències amb canvi de versió major (zod 4, Next 16, SheetJS des del CDN): en una fase pròpia.
