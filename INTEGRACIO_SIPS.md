# SIPS automàtic — renovacions

Aquesta versió utilitza `public.sips_cache` amb PRIMARY KEY `cups`, **sense** `contract_id`. És la taula que ja has creat a `supabase-copper-ferry`.

## Variables de Vercel
`SIPS_USER`, `SIPS_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. `SIPS_BASE_URL` és opcional. No cal `APP_ACCESS_KEY` per a aquesta integració (s'usa l'autenticació del panell).

## Funcionament
El cron existent de les 05:00 UTC sincronitza Drive i, separadament, fins a 12 CUPS elèctrics pendents/contactats. El resultat queda a `sips_cache`, refresc cada 7 dies, errors cada 24 hores. El panell mostra el consum SIPS quan no té un consum CRM; l'assistent permet actualitzar-lo manualment. El consum SIPS total no es reparteix artificialment entre períodes.

## Seguretat
Les credencials SIPS i service-role són exclusivament de servidor. `/api/sips/cache` exigeix sessió Supabase i només retorna CUPS visibles; `/api/sips/refresh` exigeix rol administratiu i visibilitat de CUPS. RLS segueix habilitat i l'accés directe client a `sips_cache` està revocat.

## Limitacions / comprovacions
La consulta a EAS és una integració de portal no oficial que cal provar amb un CUPS real autoritzat. El cron del pla Vercel està subjecte als límits del pla i s'executa a 05:00 UTC. Si l'usuari necessita màxima disponibilitat, configurar un sistema d'alertes de fallades del cron.
