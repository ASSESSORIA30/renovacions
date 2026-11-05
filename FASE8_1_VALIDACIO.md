# Fase 8.1 — correccions i validació pendent

## Canvis aplicats
- Política MFA: en producció, un error o absència del valor de `sec_settings.mfa` provoca resposta 503 en lloc de desactivar-la silenciosament. Abans del desplegament, aplicar migracions i configurar la política MFA.
- SMTP per usuari: servidor restringit a una llista exacta de dominis autoritzats (`SMTP_ALLOWED_HOSTS`). Per defecte s'inclouen hostnames habituals de Gmail, Microsoft i IONOS; verificar el hostname IONOS amb el proveïdor i ajustar la llista. No s'admeten IPs ni dominis comodí. La validació es fa en desar i abans de connectar.
- Captació: eliminada la clau de reserva fixa en producció. Configurar `CAPTURE_HASH_SALT` amb un secret independent, aleatori i persistent. Revisar els punts d'ús i evitar cap operació de captació fins a configurar-la.

## Pendents abans d'ús real
1. Verificar les migracions 001–015 sobre un Supabase de proves i provar MFA amb dos usuaris directius.
2. Validar SIPS amb un CUPS autoritzat i `SIPS_USER`, `SIPS_PASSWORD` només a Vercel.
3. Provar enviament SMTP real amb cada proveïdor aprovat i validar la política de credencials.
4. Provar alhora dos navegadors i dos usuaris per confirmar persistència, permisos i documents privats.
5. Auditar i convertir en operacions transaccionals els canvis d'alt impacte i el seu registre d'auditoria. La funció `secLog` encara és best-effort; NO donar aquesta protecció per completada.
6. Revisar dependències vulnerables amb una actualització i regressió controlades.
7. Confirmar que els formularis públics rebutgen peticions si falta `CAPTURE_HASH_SALT`.

Aquest lliurable NO acredita cap integració externa ni una certificació integral de seguretat.
