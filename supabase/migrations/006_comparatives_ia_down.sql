-- REVERSIÓ de 006_comparatives_ia.sql. Elimina NOMÉS els objectes creats per la 006.
-- ATENCIÓ: esborra comparatives, catàleg i factures desades. Fes una còpia de seguretat abans.
drop policy if exists p_invoices_own on storage.objects;
drop view if exists public.tariff_prices_v;
drop table if exists public.comparison_share_events, public.comparison_shares, public.comparison_deliveries, public.comparison_documents, public.comparisons cascade;
drop table if exists public.offer_commissions, public.tariff_connector_runs, public.tariff_import_runs, public.tariff_import_templates, public.tariff_versions, public.tariff_products, public.tariff_suppliers cascade;
drop table if exists public.invoice_uploads cascade;
drop function if exists public.can_see_comparison(uuid);
drop function if exists public.protect_used_tariff();
drop function if exists public.protect_issued_comparison();
-- Els buckets 'invoices' i 'proposals' s'han de buidar i esborrar des del panell de Storage.
