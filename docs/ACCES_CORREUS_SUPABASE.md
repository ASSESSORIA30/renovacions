# Correus d'accés: configuració (Supabase i correu corporatiu)

Des d'aquesta versió, **«Donar accés al portal»**, l'alta d'un col·laborador amb accés i la invitació d'usuaris
**ja no fan servir el correu de Supabase**. El CRM:

1. demana a Supabase només el codi d'accés (sense que Supabase enviï res);
2. envia el correu en català des del **correu corporatiu** (Configuració → Correu, o variables `SMTP_*`);
3. mostra l'enllaç amb un botó **Copia**, per si el vols enviar tu des del teu Outlook.

L'enllaç porta a la pàgina `/acces` del CRM. L'accés **només s'activa quan la persona prem «Activa l'accés»**:
els antivirus de correu (Outlook / Defender) que obren els enllaços automàticament ja no el gasten
(aquest era el motiu de l'error `otp_expired`).

## 1. Imprescindible

- **Vercel → Environment Variables → `APP_URL`** = l'adreça real del CRM (p. ex. `https://crm.assessoria30.com`).
  Si no hi és, s'agafa l'adreça des d'on s'ha premut el botó (també funciona).
- **Configuració → Correu** del CRM amb el compte d'IONOS (p. ex. `info@assessoria30.com`) i «Prova la connexió».
  Mentre no estigui configurat, el CRM no envia res: mostra l'enllaç perquè l'enviïs tu.

## 2. Supabase → Authentication → URL Configuration

Perquè els correus que encara envia Supabase («He oblidat la contrasenya», «Envia'm un enllaç d'accés») no vagin a localhost:

- **Site URL**: `https://<domini-real-del-crm>`
- **Redirect URLs**: `https://<domini-real-del-crm>/**`

## 3. Supabase → Authentication → Emails → SMTP Settings (recomanat)

Activa **Custom SMTP** amb les mateixes dades d'IONOS (host `smtp.ionos.es`, port `587`, usuari i contrasenya del compte,
remitent `info@assessoria30.com`, nom «Assessoria 3.0»). Així cap correu sortirà de `noreply@mail.app.supabase.io`.

## 4. Supabase → Authentication → Emails → Templates (en català)

Com a Supabase no es pot canviar el codi, enganxa aquests textos. Fan servir la mateixa pàgina segura `/acces`.

**Reset Password** · Assumpte: `Canvi de contrasenya · Assessoria 3.0`
```html
<p>Hola:</p>
<p>Hem rebut una petició per canviar la contrasenya del teu accés a Assessoria 3.0.</p>
<p><a href="{{ .SiteURL }}/acces?t={{ .TokenHash }}&k=r&next=/">Tria una contrasenya nova</a></p>
<p>Si no ho has demanat tu, ignora aquest correu.</p>
<p>L'equip d'Assessoria 3.0</p>
```

**Magic Link** · Assumpte: `Enllaç d'accés · Assessoria 3.0`
```html
<p>Hola:</p>
<p>Aquí tens l'enllaç per entrar a Assessoria 3.0:</p>
<p><a href="{{ .SiteURL }}/acces?t={{ .TokenHash }}&k=m&next=/">Entra</a></p>
<p>Si no ho has demanat tu, ignora aquest correu.</p>
<p>L'equip d'Assessoria 3.0</p>
```

**Invite user** · Assumpte: `Accés a Assessoria 3.0`
```html
<p>Hola:</p>
<p>T'hem donat accés a la plataforma d'Assessoria 3.0.</p>
<p><a href="{{ .SiteURL }}/acces?t={{ .TokenHash }}&k=i&next=/">Crea la contrasenya</a></p>
<p>L'equip d'Assessoria 3.0</p>
```

## 5. Perquè no arribi com a correu brossa

- El correu ha de sortir del domini propi (punts 1 i 3).
- A IONOS → Dominis → DNS de `assessoria30.com`, comprova que hi ha **SPF** i **DKIM** activats per al correu d'IONOS
  (IONOS els ofereix amb un clic). Opcional: registre **DMARC** (`v=DMARC1; p=none`).

## 6. Validesa de l'enllaç

Supabase → Authentication → Providers → Email → **Email OTP Expiration**: per defecte 1 hora.
Es pot pujar fins a 86400 segons (24 hores). Si caduca, només cal tornar a prémer «Donar accés al portal».
