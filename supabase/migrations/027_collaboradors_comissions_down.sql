-- 027 · REVERSIÓ: treu les columnes i la taula afegides. No esborra cap col·laborador ni cap regla de comissió
-- (els percentatges són regles de fin_rules i es conserven). Es perden el DNI, l'adreça i l'etiqueta d'origen afegits.
drop index if exists public.cap_partners_tax_id_uq;
drop index if exists public.cap_partners_email_idx;
drop index if exists public.cap_partners_import_idx;
alter table public.cap_partners drop constraint if exists cap_partners_import_fk;
alter table public.cap_partners drop constraint if exists cap_partners_person_kind_chk;
alter table public.cap_partners drop constraint if exists cap_partners_classification_chk;
alter table public.cap_partners drop column if exists tax_id_norm;
alter table public.cap_partners drop column if exists last_name;
alter table public.cap_partners drop column if exists tax_id;
alter table public.cap_partners drop column if exists person_kind;
alter table public.cap_partners drop column if exists address;
alter table public.cap_partners drop column if exists postal_code;
alter table public.cap_partners drop column if exists source_label;
alter table public.cap_partners drop column if exists source_created_at;
alter table public.cap_partners drop column if exists classification;
alter table public.cap_partners drop column if exists manager_id;
alter table public.cap_partners drop column if exists import_id;
alter table public.cap_partners drop column if exists account_created_by_import;
drop table if exists public.cap_partner_imports;
delete from public.sec_settings where key = 'collab_levels';
