-- Desfà la 022 SENSE esborrar les regles desades: només treu les polítiques d'escriptura (la taula queda en
-- només lectura per a l'administració). Per eliminar-la del tot cal fer-ho a mà després d'exportar-la.
drop policy if exists p_trl_insert on public.tariff_rule_library;
drop policy if exists p_trl_update on public.tariff_rule_library;
drop trigger if exists tariff_rule_library_guard on public.tariff_rule_library;
drop function if exists public.tariff_rule_library_guard();
