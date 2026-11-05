-- Desfà la 023 SENSE esborrar plantilles, versions ni lectures: treu les polítiques d'escriptura i la guarda
-- (les taules queden en només lectura per a l'administració). Per eliminar-les cal fer-ho a mà després d'exportar-les.
drop policy if exists p_ttpl_insert on public.tariff_templates;
drop policy if exists p_ttpl_update on public.tariff_templates;
drop policy if exists p_ttplv_insert on public.tariff_template_versions;
drop policy if exists p_ttplc_insert on public.tariff_template_corrections;
drop policy if exists p_ttplr_insert on public.tariff_template_reads;
drop policy if exists p_ttplr_update on public.tariff_template_reads;
drop trigger if exists tariff_templates_guard on public.tariff_templates;
drop function if exists public.tariff_templates_guard();
