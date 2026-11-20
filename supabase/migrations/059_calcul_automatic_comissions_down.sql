-- =====================================================================================================
-- 059 · CÀLCUL AUTOMÀTIC DE COMISSIONS — REVERSIÓ
-- Elimina només les tres taules de registre que va afegir la 059. Els càlculs de comissions creats (fin_calculations)
-- es CONSERVEN: són instantànies immutables de l'economia i no depenen d'aquestes taules.
-- =====================================================================================================
drop table if exists public.fin_regularization_items;
drop table if exists public.fin_regularization_runs;
drop table if exists public.fin_calc_pending;
