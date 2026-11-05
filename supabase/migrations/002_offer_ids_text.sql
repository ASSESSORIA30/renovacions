-- Offer ids from the Excel template are "of-<hash>" (stable, so re-imports replace the same offer), not UUIDs.
alter table public.offers alter column id type text using id::text;
alter table public.documents alter column offer_id type text using offer_id::text;
