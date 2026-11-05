-- Desfà la 020 SENSE esborrar dades: les taules de l'agenda i dels calendaris es conserven, però queden
-- tancades (només el servidor hi pot accedir) i es treu el permís de mòdul «agenda».
drop policy if exists p_agenda_select on public.agenda_events;
drop policy if exists p_agenda_insert on public.agenda_events;
drop policy if exists p_agenda_update on public.agenda_events;
drop policy if exists p_agenda_delete on public.agenda_events;
drop policy if exists p_agenda_part_select on public.agenda_participants;
drop policy if exists p_agenda_part_insert on public.agenda_participants;
drop policy if exists p_agenda_part_update on public.agenda_participants;
drop policy if exists p_agenda_part_delete on public.agenda_participants;
drop trigger if exists agenda_events_touch on public.agenda_events;
delete from public.role_permissions where module = 'agenda';
-- (les funcions agenda_* es conserven: no fan res sense les polítiques)
