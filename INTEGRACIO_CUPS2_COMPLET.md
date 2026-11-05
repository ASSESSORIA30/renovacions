# Buscador SIPS complet de cups2

Aquesta versio ofereix una vista incrustada de https://cups2-silk.vercel.app/ dins del panell de renovacions, mantenint el cercador natiu per CUPS o adreca amb autenticacio de Supabase.

## Limitacions importants
- La vista incrustada es una aplicacio independent, no una fusio de codi. Si cups2 envia una politica CSP `frame-ancestors` o `X-Frame-Options` que la bloqueja, utilitzeu el boto **Obrir cups2**. Cal configurar la politica al projecte cups2, o portar components al repositori de renovacions, per integrar-la realment.
- Les dades de cups2 no es sincronitzen automaticament a les ofertes des d'aquesta vista.
- La sincronitzacio SIPS de renovacions i els seus secrets es mantenen separats.
- En previsualitzacions noves assegureu les variables de Supabase (NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_ANON_KEY) abans de compilar.

## Prova suggerida
1. Desplegar com a Preview amb configuracio de Supabase.
2. Obrir Buscador CUPS -> Panell complet.
3. Confirmar que cups2 permet ser incrustat; si no, usar l'enllac extern.
4. Provar Cercador del CRM (CUPS i CP + adreca) i autenticar un usuari.
5. Validar sincronitzacio de Google Drive, Kanban i ofertes.
