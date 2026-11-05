-- Desfà la 024 SENSE esborrar regles, exemples ni lectures (mateix criteri que la 022 i la 023):
--  · els exemples validats queden en només lectura (es treuen les polítiques d'escriptura i la guarda);
--  · la guarda de la biblioteca de regles torna a la versió de la 022;
--  · les columnes i els tipus nous es CONSERVEN (hi pot haver regles de lectura desades). Per eliminar-los cal fer-ho
--    a mà després d'exportar les dades.
drop policy if exists p_ttplx_insert on public.tariff_template_examples;
drop policy if exists p_ttplx_update on public.tariff_template_examples;
drop trigger if exists tariff_template_examples_guard on public.tariff_template_examples;
drop function if exists public.tariff_template_examples_guard();

create or replace function public.tariff_rule_library_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status <> 'proposada' and coalesce(public.my_role(), '') <> 'admin' and auth.uid() is not null then
      new.status := 'proposada';
    end if;
    return new;
  end if;
  if new.rule is distinct from old.rule or new.supplier is distinct from old.supplier or new.product is distinct from old.product
     or new.access_tariff is distinct from old.access_tariff or new.doc_version is distinct from old.doc_version
     or new.modality is distinct from old.modality or new.kind is distinct from old.kind then
    raise exception 'Una regla no es modifica: proposa''n una de nova' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and new.status in ('aprovada', 'rebutjada') then
    new.decided_at := now();
    new.decided_by := coalesce(auth.uid(), new.decided_by);
  end if;
  return new;
end $$;
