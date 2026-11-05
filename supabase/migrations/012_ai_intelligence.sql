-- 012 · FASE 5: INTEL·LIGÈNCIA ARTIFICIAL, MOTOR D'OPORTUNITATS I AUTOMATITZACIÓ COMERCIAL
-- Additiva i idempotent: no esborra ni modifica dades existents. Reversible amb 012_ai_intelligence_down.sql.
--
-- Principis:
--   · El motor PREPARA recomanacions i propostes; no envia ofertes ni modifica contractes sense autorització.
--   · Els càlculs econòmics són deterministes (motor del comparador); la IA només redacta i resumeix.
--   · Cada anàlisi es desa amb les dades d'entrada, les versions de tarifa i la data (reproduïble i immutable).
--   · Estalvis i comissions potencials són ESTIMACIONS i es marquen com a tals; mai com a confirmats/cobrats.
--   · La prioritat de servei al client (puntuació) és independent de la rendibilitat interna (valor de negoci).
--   · Oposicions comercials i preferències de contacte dels clients es respecten a tot el motor.

-- ============================================================ preferències de contacte del client
alter table public.crm_clients add column if not exists commercial_opt_out boolean not null default false;   -- s'oposa a comunicacions comercials
alter table public.crm_clients add column if not exists opt_out_at timestamptz;
alter table public.crm_clients add column if not exists contact_preference text not null default 'qualsevol';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_contact_pref_chk') then
    alter table public.crm_clients add constraint crm_clients_contact_pref_chk check (contact_preference in ('qualsevol', 'telefon', 'email', 'whatsapp', 'presencial', 'cap'));
  end if;
end $$;

-- ============================================================ execucions del motor
create table if not exists public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron', 'manual', 'event')),
  scope jsonb not null default '{}',                     -- {client_id?, kinds?}
  status text not null default 'en_curs' check (status in ('en_curs', 'ok', 'parcial', 'error', 'omesa')),
  attempts integer not null default 1 check (attempts between 1 and 10),
  stats jsonb not null default '{}',                     -- detectades, noves, actualitzades, comparatives, errors…
  errors jsonb not null default '[]',
  tariff_snapshot_id uuid,
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
-- només una execució en curs alhora (bloqueig): la segona falla per clau única
create unique index if not exists ai_runs_single_uq on public.ai_analysis_runs ((true)) where status = 'en_curs';
create index if not exists ai_runs_started_idx on public.ai_analysis_runs (started_at desc);

-- ============================================================ instantànies del catàleg de tarifes usat en cada anàlisi
create table if not exists public.tariff_snapshots (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique,                           -- hash del contingut: mateix catàleg → mateixa instantània
  taken_at timestamptz not null default now(),
  as_of date not null,
  versions jsonb not null,                               -- [{id, supplier, product, version, validFrom, validTo, source, status}]
  offers jsonb not null,                                 -- ofertes completes (preus) per reproduir el càlcul
  offer_count integer not null check (offer_count >= 0)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_runs_snapshot_fk') then
    alter table public.ai_analysis_runs add constraint ai_runs_snapshot_fk foreign key (tariff_snapshot_id) references public.tariff_snapshots (id) on delete set null;
  end if;
end $$;

-- ============================================================ oportunitats detectades
create table if not exists public.ai_opportunities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('renovacio', 'estalvi', 'contracte_car', 'potencia', 'recuperacio', 'venda_creuada', 'proposta_sense_resposta', 'dades_incompletes', 'tarifa_caducada')),
  dedupe_key text not null unique,                       -- p. ex. renovacio:{contracte}:{venciment} (un per contracte i cicle)
  client_id uuid references public.crm_clients (id) on delete cascade,
  supply_id uuid references public.crm_supplies (id) on delete set null,
  contract_id uuid references public.crm_contracts (id) on delete set null,
  crm_opportunity_id uuid references public.crm_opportunities (id) on delete set null,   -- oportunitat comercial vinculada
  owner_id uuid references auth.users (id) on delete set null,
  status text not null default 'nova' check (status in ('nova', 'revisada', 'proposta_preparada', 'acceptada', 'guanyada', 'descartada', 'caducada')),
  status_reason text,
  title text not null check (length(trim(title)) between 1 and 200),
  summary text,
  evidence jsonb not null default '[]',                  -- [{label, value, source, date}] → d'on surt cada dada
  milestone integer,                                     -- renovacions: finestra actual (120/90/60/30/15 dies)
  due_date date,
  potential_saving_eur numeric(14, 2),                   -- ESTIMAT; null si no es coneix el preu actual
  saving_status text not null default 'no_aplicable' check (saving_status in ('estimat', 'pendent_preu_actual', 'no_aplicable')),
  annual_kwh numeric(14, 3),
  data_quality text not null default 'incomplet' check (data_quality in ('complet', 'parcial', 'incomplet')),
  score integer not null default 0 check (score between 0 and 100),              -- prioritat de servei al client
  business_value integer check (business_value is null or business_value between 0 and 100),   -- rendibilitat interna (separada)
  score_factors jsonb not null default '[]',
  service text check (service is null or service in ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes')),
  contact_allowed boolean not null default true,
  first_run_id uuid references public.ai_analysis_runs (id) on delete set null,
  last_run_id uuid references public.ai_analysis_runs (id) on delete set null,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is not null or kind = 'tarifa_caducada')
);
create index if not exists ai_opps_client_idx on public.ai_opportunities (client_id);
create index if not exists ai_opps_status_idx on public.ai_opportunities (status, score desc);
create index if not exists ai_opps_owner_idx on public.ai_opportunities (owner_id, status);
create index if not exists ai_opps_due_idx on public.ai_opportunities (due_date) where status in ('nova', 'revisada', 'proposta_preparada');
-- una oportunitat comercial només es vincula a una oportunitat IA (sense duplicats en acceptar)
create unique index if not exists ai_opps_crm_opp_uq on public.ai_opportunities (crm_opportunity_id) where crm_opportunity_id is not null;

alter table public.crm_opportunities add column if not exists ai_opportunity_id uuid references public.ai_opportunities (id) on delete set null;
create unique index if not exists crm_opps_ai_uq on public.crm_opportunities (ai_opportunity_id) where ai_opportunity_id is not null;

-- ============================================================ recomanacions (anàlisi determinista immutable)
create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.ai_opportunities (id) on delete cascade,
  run_id uuid references public.ai_analysis_runs (id) on delete set null,
  tariff_snapshot_id uuid references public.tariff_snapshots (id) on delete restrict,
  engine_version text not null,
  input_hash text not null,                              -- hash de les entrades: si no canvien, no es repeteix
  inputs jsonb not null,                                 -- subministrament, condicions actuals i fonts
  current_cost jsonb,                                    -- null → «Pendent de factura o condicions actuals»
  alternatives jsonb not null default '[]',              -- top 3 per cost anual total, amb motiu
  sas_scenario jsonb,                                    -- només si aplica (comercialitzadora configurada i justificada)
  one_off_costs jsonb not null default '[]',             -- costos puntuals (penalitzacions…), separats dels recurrents
  hypotheses jsonb not null default '[]',
  missing jsonb not null default '[]',
  narrative text,                                        -- redacció (IA o plantilla); mai números nous
  narrative_source text check (narrative_source is null or narrative_source in ('ia', 'plantilla')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (opportunity_id, input_hash)
);
create index if not exists ai_recs_opp_idx on public.ai_recommendations (opportunity_id, created_at desc);

-- ============================================================ historial de puntuacions (explicat)
create table if not exists public.opportunity_scores (
  id bigserial primary key,
  opportunity_id uuid not null references public.ai_opportunities (id) on delete cascade,
  run_id uuid references public.ai_analysis_runs (id) on delete set null,
  score integer not null check (score between 0 and 100),
  business_value integer check (business_value is null or business_value between 0 and 100),
  factors jsonb not null,                                -- [{key, label, weight, value, points, explanation}]
  weights jsonb not null,
  computed_at timestamptz not null default now()
);
create index if not exists opp_scores_opp_idx on public.opportunity_scores (opportunity_id, computed_at desc);

-- ============================================================ economia estimada de l'oportunitat (capes separades)
-- proveidor: comissió potencial Assessoria 3.0 · comercial: comissió potencial del comercial · marge: previsió
create table if not exists public.ai_opportunity_economics (
  opportunity_id uuid not null references public.ai_opportunities (id) on delete cascade,
  layer text not null check (layer in ('proveidor', 'comercial', 'marge')),
  beneficiary_id uuid references auth.users (id) on delete set null,
  amount numeric(14, 2),
  status text not null check (status in ('estimat', 'simulacio', 'pendent_configuracio', 'pendent_dades', 'sense_regla')),
  rule_ref jsonb,                                        -- {rule_key, version, status}
  formula text,
  collection_status text not null default 'no_meritat' check (collection_status in ('no_meritat', 'meritat', 'cobrat')),
  computed_at timestamptz not null default now(),
  primary key (opportunity_id, layer)
);

-- ============================================================ esborranys de proposta
create table if not exists public.ai_proposal_drafts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.ai_opportunities (id) on delete cascade,
  recommendation_id uuid not null references public.ai_recommendations (id) on delete restrict,
  client_id uuid not null references public.crm_clients (id) on delete cascade,
  comparison_id uuid references public.comparisons (id) on delete set null,
  document_id uuid references public.crm_documents (id) on delete set null,
  status text not null default 'esborrany' check (status in ('esborrany', 'aprovada', 'enviada', 'acceptada', 'rebutjada', 'anullada')),
  valid_until date not null,
  alternatives jsonb not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,                                   -- només quan el proveïdor de correu ho confirma
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ai_drafts_opp_idx on public.ai_proposal_drafts (opportunity_id, created_at desc);
create index if not exists ai_drafts_client_idx on public.ai_proposal_drafts (client_id);

-- ============================================================ copilot: converses, missatges, eines i consum
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retain_until timestamptz not null default now() + interval '90 days'
);
create index if not exists ai_conv_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id bigserial primary key,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) <= 20000),
  sources jsonb not null default '[]',                   -- [{label, ref, date}]
  mode text check (mode is null or mode in ('ia', 'regles')),
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, id);

create table if not exists public.ai_tool_executions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.ai_conversations (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  tool text not null,
  args jsonb not null default '{}',
  sensitive boolean not null default false,
  status text not null check (status in ('executada', 'proposada', 'confirmada', 'rebutjada', 'denegada', 'error', 'caducada')),
  confirm_hash text,                                     -- hash del testimoni de confirmació (mai el testimoni)
  result_summary text,
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  retain_until timestamptz not null default now() + interval '365 days'
);
create index if not exists ai_tools_user_idx on public.ai_tool_executions (user_id, created_at desc);

create table if not exists public.ai_usage (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('copilot', 'redaccio')),
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_eur numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);

-- ============================================================ registre de les automatitzacions IA (idempotent)
create table if not exists public.ai_automation_logs (
  id bigserial primary key,
  run_id uuid references public.ai_analysis_runs (id) on delete set null,
  rule_key text not null,
  idempotency_key text not null unique,
  entity text,
  entity_id uuid,
  action text not null,                                  -- detectada, actualitzada, avis, tasca, esborrany, caducada, purga…
  outcome text not null default 'ok' check (outcome in ('ok', 'omesa', 'error')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_logs_run_idx on public.ai_automation_logs (run_id);

-- ============================================================ regles (configurables per Direcció)
insert into public.crm_automation_rules (key, name, description, enabled, params) values
  ('ai_motor', 'Motor d''oportunitats IA', 'Analitza diàriament la cartera i detecta renovacions (120/90/60/30/15 dies), estalvis, contractes cars, optimització de potència, recuperació de clients, venda creuada amb interès registrat, propostes sense resposta, dades incompletes i tarifes caducades. Només crea oportunitats i avisos interns.', true,
   '{"renewal_days": [120, 90, 60, 30, 15], "min_saving_eur": 60, "min_saving_pct": 5, "expensive_pct": 15, "inactive_days": 365, "proposal_days": 7, "min_power_saving_eur": 100, "max_comparisons": 400, "max_attempts": 3}'),
  ('ai_puntuacio', 'Puntuació d''oportunitats', 'Factors i pesos de la puntuació 0-100 (prioritat de servei al client). La rendibilitat interna es calcula a part i no altera aquesta puntuació.', true,
   '{"weights": {"venciment": 20, "estalvi": 25, "volum": 10, "qualitat_dades": 10, "conversio": 10, "antiguitat_proposta": 10, "ultima_activitat": 5, "seguiment": 10}, "business_weights": {"comissio": 70, "marge": 30}}'),
  ('ai_sas_escenari', 'Escenari de sensibilitat SAS', 'Afegeix un escenari de sensibilitat del mecanisme d''ajust (SAS) NOMÉS a les ofertes de les comercialitzadores indicades que el facturen a part sense valor publicat. No és un cost regulat confirmat. Cal indicar la font i la data abans d''activar-la.', false,
   '{"min_eur_kwh": 0.010, "max_eur_kwh": 0.015, "retailers": ["Iberdrola"], "justification": "Algunes ofertes d''aquesta comercialitzadora repercuteixen el SAS a part sense publicar-ne el valor.", "source": "", "as_of": null}'),
  ('ai_esborranys_auto', 'Esborranys automàtics de proposta', 'Prepara automàticament un esborrany de proposta (PDF intern, no enviat) per a les oportunitats amb puntuació alta. L''enviament sempre requereix aprovació i acció d''una persona.', false,
   '{"min_score": 75, "max_per_run": 20}'),
  ('ai_retencio', 'Retenció de dades IA', 'Esborra les converses del copilot i els registres d''eines caducats.', true,
   '{"conversation_days": 90, "tool_days": 365}')
on conflict (key) do nothing;

-- ============================================================ permisos
create or replace function public.ai_can_see_opportunity(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ai_opportunities o where o.id = p_id and (case when o.client_id is null then public.is_staff() else public.crm_can_see_client(o.client_id) end));
$$;

alter table public.ai_analysis_runs enable row level security;
alter table public.tariff_snapshots enable row level security;
alter table public.ai_opportunities enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.opportunity_scores enable row level security;
alter table public.ai_opportunity_economics enable row level security;
alter table public.ai_proposal_drafts enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_tool_executions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_automation_logs enable row level security;

drop policy if exists ai_runs_sel on public.ai_analysis_runs;
create policy ai_runs_sel on public.ai_analysis_runs for select to authenticated using (public.is_staff());
drop policy if exists ai_snap_sel on public.tariff_snapshots;
create policy ai_snap_sel on public.tariff_snapshots for select to authenticated using (public.my_role() <> 'colaborador');
drop policy if exists ai_logs_sel on public.ai_automation_logs;
create policy ai_logs_sel on public.ai_automation_logs for select to authenticated using (public.is_staff());

-- oportunitats: les veu qui veu el client (catàleg: només staff). Les crea el motor (servidor).
-- Les persones només en poden canviar l'estat (trigger), si poden editar el client.
drop policy if exists ai_opps_sel on public.ai_opportunities;
create policy ai_opps_sel on public.ai_opportunities for select to authenticated
  using (case when client_id is null then public.is_staff() else public.crm_can_see_client(client_id) end);
drop policy if exists ai_opps_upd on public.ai_opportunities;
create policy ai_opps_upd on public.ai_opportunities for update to authenticated
  using (case when client_id is null then public.is_staff() else public.crm_can_edit_client(client_id) end)
  with check (case when client_id is null then public.is_staff() else public.crm_can_edit_client(client_id) end);

drop policy if exists ai_recs_sel on public.ai_recommendations;
create policy ai_recs_sel on public.ai_recommendations for select to authenticated using (public.ai_can_see_opportunity(opportunity_id));
drop policy if exists ai_scores_sel on public.opportunity_scores;
create policy ai_scores_sel on public.opportunity_scores for select to authenticated using (public.ai_can_see_opportunity(opportunity_id));

-- economia: Direcció/Administració ho veuen tot; el comercial només la seva comissió estimada.
-- Els col·laboradors no veuen comissions d'Assessoria 3.0 ni marges.
drop policy if exists ai_econ_sel on public.ai_opportunity_economics;
create policy ai_econ_sel on public.ai_opportunity_economics for select to authenticated
  using (public.is_staff() or (layer = 'comercial' and beneficiary_id = auth.uid() and public.my_role() = 'comercial' and public.ai_can_see_opportunity(opportunity_id)));

drop policy if exists ai_drafts_sel on public.ai_proposal_drafts;
create policy ai_drafts_sel on public.ai_proposal_drafts for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists ai_drafts_upd on public.ai_proposal_drafts;
create policy ai_drafts_upd on public.ai_proposal_drafts for update to authenticated
  using (public.crm_can_edit_client(client_id)) with check (public.crm_can_edit_client(client_id));

drop policy if exists ai_conv_own on public.ai_conversations;
create policy ai_conv_own on public.ai_conversations for select to authenticated using (user_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists ai_conv_ins on public.ai_conversations;
create policy ai_conv_ins on public.ai_conversations for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ai_conv_del on public.ai_conversations;
create policy ai_conv_del on public.ai_conversations for delete to authenticated using (user_id = auth.uid());
drop policy if exists ai_msg_sel on public.ai_messages;
create policy ai_msg_sel on public.ai_messages for select to authenticated
  using (exists (select 1 from ai_conversations c where c.id = conversation_id and (c.user_id = auth.uid() or public.my_role() = 'admin')));
drop policy if exists ai_tools_sel on public.ai_tool_executions;
create policy ai_tools_sel on public.ai_tool_executions for select to authenticated using (user_id = auth.uid() or public.my_role() = 'admin');
drop policy if exists ai_usage_sel on public.ai_usage;
create policy ai_usage_sel on public.ai_usage for select to authenticated using (user_id = auth.uid() or public.my_role() = 'admin');

-- ============================================================ integritat
-- Oportunitat IA: una persona només canvia estat, motiu i revisió; la resta és del motor (service role).
create or replace function public.ai_opp_before() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if auth.uid() is not null and coalesce(current_setting('ai.sync', true), '') <> '1' then
    if (to_jsonb(new) - array['status', 'status_reason', 'reviewed_by', 'reviewed_at', 'updated_at', 'crm_opportunity_id'])
       is distinct from (to_jsonb(old) - array['status', 'status_reason', 'reviewed_by', 'reviewed_at', 'updated_at', 'crm_opportunity_id']) then
      raise exception 'Les dades d''una oportunitat detectada només les actualitza el motor';
    end if;
    if new.crm_opportunity_id is distinct from old.crm_opportunity_id and old.crm_opportunity_id is not null then
      raise exception 'L''oportunitat ja està vinculada a una oportunitat comercial';
    end if;
    if new.status = 'descartada' and old.status <> 'descartada' and coalesce(trim(new.status_reason), '') = '' then
      raise exception 'Per descartar una oportunitat cal indicar el motiu';
    end if;
    if new.status = 'guanyada' and old.status <> 'guanyada' then
      raise exception 'Una oportunitat només es marca com a guanyada des de l''oportunitat comercial';
    end if;
    if new.status is distinct from old.status then
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ai_opp_before_trg on public.ai_opportunities;
create trigger ai_opp_before_trg before update on public.ai_opportunities for each row execute function public.ai_opp_before();

-- Recomanacions, puntuacions i registres són immutables (només s'afegeixen)
drop trigger if exists ai_recs_append on public.ai_recommendations;
create trigger ai_recs_append before update on public.ai_recommendations for each row execute function public.crm_append_only();
drop trigger if exists ai_scores_append on public.opportunity_scores;
create trigger ai_scores_append before update on public.opportunity_scores for each row execute function public.crm_append_only();
drop trigger if exists ai_logs_append on public.ai_automation_logs;
create trigger ai_logs_append before update on public.ai_automation_logs for each row execute function public.crm_append_only();
create or replace function public.ai_snapshot_immutable() returns trigger language plpgsql as $$
begin raise exception 'Instantània de tarifes immutable'; end $$;
drop trigger if exists ai_snap_immutable on public.tariff_snapshots;
create trigger ai_snap_immutable before update on public.tariff_snapshots for each row execute function public.ai_snapshot_immutable();

-- Esborranys: flux d'estats i aprovació. Un col·laborador no aprova; ningú marca «enviada» a mà
-- (només el servidor quan el proveïdor de correu confirma l'enviament).
create or replace function public.ai_draft_before() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.alternatives is distinct from old.alternatives or new.recommendation_id <> old.recommendation_id or new.client_id <> old.client_id or new.valid_until <> old.valid_until then
    raise exception 'El contingut d''una proposta no es modifica: prepara''n una de nova';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'esborrany' and new.status in ('aprovada', 'anullada'))
         or (old.status = 'aprovada' and new.status in ('enviada', 'anullada', 'acceptada', 'rebutjada'))
         or (old.status = 'enviada' and new.status in ('acceptada', 'rebutjada', 'anullada'))) then
      raise exception 'Canvi d''estat de proposta no permès: % → %', old.status, new.status;
    end if;
    if auth.uid() is not null then
      if new.status = 'enviada' then raise exception 'L''enviament el registra el sistema quan el correu es confirma'; end if;
      if new.status = 'aprovada' and not (public.is_staff() or public.my_role() = 'comercial') then
        raise exception 'No tens permís per aprovar propostes';
      end if;
    end if;
    if new.status = 'aprovada' then new.approved_by := coalesce(auth.uid(), new.approved_by); new.approved_at := now(); end if;
    if new.status = 'enviada' then new.sent_at := coalesce(new.sent_at, now()); end if;
    if new.status in ('acceptada', 'rebutjada') then new.decided_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists ai_draft_before_trg on public.ai_proposal_drafts;
create trigger ai_draft_before_trg before update on public.ai_proposal_drafts for each row execute function public.ai_draft_before();

-- Tancar una oportunitat comercial vinculada actualitza l'oportunitat IA (guanyada/descartada)
create or replace function public.ai_sync_from_crm_opp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ai_opportunity_id is not null and new.stage is distinct from old.stage then
    perform set_config('ai.sync', '1', true);
    if new.stage = 'guanyat' then
      update ai_opportunities set status = 'guanyada', status_reason = 'Oportunitat comercial guanyada' where id = new.ai_opportunity_id and status <> 'guanyada';
    elsif new.stage = 'perdut' then
      update ai_opportunities set status = 'descartada', status_reason = coalesce('Oportunitat comercial perduda: ' || new.lost_reason, 'Oportunitat comercial perduda') where id = new.ai_opportunity_id and status not in ('descartada', 'guanyada');
    end if;
    perform set_config('ai.sync', '', true);
  end if;
  return new;
end $$;
drop trigger if exists ai_sync_from_crm_opp_trg on public.crm_opportunities;
create trigger ai_sync_from_crm_opp_trg after update of stage on public.crm_opportunities for each row execute function public.ai_sync_from_crm_opp();

-- Retenció: esborra converses i registres d'eines caducats. Retorna quantes files ha esborrat.
create or replace function public.ai_purge_expired() returns integer language plpgsql security definer set search_path = public as $$
declare n1 integer; n2 integer;
begin
  delete from ai_conversations where retain_until < now(); get diagnostics n1 = row_count;
  delete from ai_tool_executions where retain_until < now(); get diagnostics n2 = row_count;
  return n1 + n2;
end $$;
revoke all on function public.ai_purge_expired() from public;
revoke all on function public.ai_purge_expired() from authenticated;
revoke all on function public.ai_purge_expired() from anon;
