"use client";
/**
 * FITXA ENERGÈTICA (pantalla «suministro» de cups2) integrada a la plataforma.
 * - Carrega el subministrament de la cartera energètica; si no hi és, de Supabase (sips_cache).
 * - Si no hi ha dades o han caducat (TTL), consulta el SIPS des del servidor.
 * - Mostra origen i data de les dades, i enllaça amb el contracte del CRM (tornar / preparar oferta).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, Bell, Briefcase, Cpu, DatabaseZap, FileSignature, FileText, Loader2, RefreshCw, Store, Target, Waves } from "lucide-react";
import { useStore, useSupply } from "@/energy/lib/store";
import { supplyAlerts } from "@/energy/lib/alerts";
import { availabilityOf, AVAILABILITY_META, cupsBase, isFresh, isGasSupply } from "@/energy/lib/sips-record";
import { GasHero, GasOverview } from "@/energy/components/supply/gas";
import { energyApi, serverEnabled } from "@/energy/api";
import { fmt } from "@/energy/lib/format";
import { Badge, Button, Callout, Empty, Tabs, TabsContent, TabsList, TabsTrigger } from "@/energy/components/ui";
import { SupplyHero, Overview } from "@/energy/components/supply/overview";
import { PowerOptimizer } from "@/energy/components/supply/optimizer";
import { ReactiveModule } from "@/energy/components/supply/reactive";
import { MarketModule } from "@/energy/components/supply/market";
import { OpportunityModule } from "@/energy/components/supply/opportunity";
import { TechSheet } from "@/energy/components/supply/tech-sheet";
import { AlertList } from "@/energy/components/alert-list";
import { useApp } from "@/data/store";
import { useSipsIndex } from "@/ui/useSips";

const ORIGIN_LABEL = { excel: "Excel SIPS importat", portal: "Buscador SIPS", crm: "SIPS desat a Supabase" } as const;

export function SupplyView() {
  const id = (useApp((s) => s.params.cups) ?? "").trim().toUpperCase();
  const tabParam = useApp((s) => s.params.tab);
  const returnTo = useApp((s) => s.returnTo);
  const contracts = useApp((s) => s.contracts);
  const s = useSupply(id);
  const hydrated = useStore((st) => st.hydrated);
  const cfg = useStore((st) => st.settings.alerts);
  const merge = useStore((st) => st.mergeServerEntries);
  const hydrateInputs = useStore((st) => st.hydrateInputs);
  const [tab, setTab] = useState(tabParam ?? "radiografia");
  const [state, setState] = useState<{ loading: boolean; refreshing: boolean; error: string | null; consultedAt: string | null; status: string | null; checked: boolean }>({ loading: false, refreshing: false, error: null, consultedAt: null, status: null, checked: false });
  const asked = useRef<string | null>(null);

  const contract = useMemo(() => contracts.find((c) => c.cups && cupsBase(c.cups) === cupsBase(id)) ?? null, [contracts, id]);

  async function refresh(force: boolean) {
    setState((x) => ({ ...x, refreshing: true, error: null }));
    try {
      const { entry } = await energyApi.refresh(id, force);
      merge([entry]);
      useSipsIndex.getState().put(entry);
      setState((x) => ({ ...x, refreshing: false, consultedAt: entry.consulted_at, status: entry.status, error: entry.error ?? (entry.status === "not_found" ? "El portal SIPS no retorna cap punt de llum ni de gas amb aquest CUPS." : null) }));
    } catch (e) {
      setState((x) => ({ ...x, refreshing: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  // Càrrega des de Supabase i, si cal, consulta automàtica al portal (una sola vegada per CUPS).
  useEffect(() => {
    if (!hydrated || !id || !serverEnabled() || asked.current === id) return;
    asked.current = id;
    setState((x) => ({ ...x, loading: true, error: null, checked: false }));
    (async () => {
      try {
        const [{ entry }, inputs] = await Promise.all([energyApi.supply(id), energyApi.getInputs(id).catch(() => null)]);
        if (inputs?.inputs) hydrateInputs(id, inputs.inputs);
        if (entry) merge([entry]);
        setState((x) => ({ ...x, loading: false, checked: true, consultedAt: entry?.consulted_at ?? null, status: entry?.status ?? null }));
        const ttl = (await energyApi.status().catch(() => null))?.ttlDays ?? 7;
        if (!entry || !isFresh(entry.consulted_at, entry.status, ttl, 24)) await refresh(false);
      } catch (e) {
        setState((x) => ({ ...x, loading: false, checked: true, error: e instanceof Error ? e.message : String(e) }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, id]);

  useEffect(() => {
    if (tabParam) setTab(tabParam);
  }, [tabParam]);

  const back = returnTo ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        const st = useApp.getState();
        // Fase 9: si la pantalla d'origen és just abans a l'historial, s'hi torna amb «Enrere» (es conserva el desplaçament i l'estat)
        const prev = st.trail[st.navIdx - 1];
        if (!returnTo.contractId && prev && prev.view === returnTo.view) { st.back(); return; }
        st.navigate(returnTo.view, returnTo.params);
        if (returnTo.contractId) st.open(returnTo.contractId, "energia");
      }}
    >
      <ArrowLeft /> {returnTo.label}
    </Button>
  ) : (
    <Button variant="ghost" size="sm" onClick={() => useApp.getState().navigate("radar")}>
      <ArrowLeft /> Radar comercial
    </Button>
  );

  if (!hydrated || (!s && (state.loading || state.refreshing)))
    return (
      <div className="space-y-4">
        {back}
        <div className="flex items-center gap-2 text-sm text-fg-3">
          <Loader2 className="size-4 animate-spin" /> {state.refreshing ? "Consultant el portal SIPS…" : "Carregant les dades energètiques…"}
        </div>
        <div className="h-40 animate-pulse rounded-2xl bg-surface-2/60" />
        <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-2/60" />)}</div>
      </div>
    );

  if (!s)
    return (
      <div className="space-y-4">
        {back}
        <Empty icon={<DatabaseZap />} title="Sense dades energètiques per a aquest CUPS">
          <span className="num">{id || "—"}</span>
          {state.error ? <span className="mt-2 block text-critical">{state.error}</span> : !serverEnabled() ? <span className="mt-2 block">Importa l'Excel SIPS o configura el servidor per consultar el portal.</span> : null}
          {serverEnabled() && (
            <span className="mt-3 flex justify-center gap-2">
              <Button size="sm" onClick={() => refresh(true)}>
                <RefreshCw /> Consulta el SIPS
              </Button>
              {contract && (
                <Button size="sm" variant="outline" onClick={() => useApp.getState().set("proposalFor", contract.id)}>
                  <FileSignature /> Prepara l&apos;oferta
                </Button>
              )}
            </span>
          )}
        </Empty>
      </div>
    );

  const alerts = supplyAlerts(s, cfg);
  const tabNow = isGasSupply(s) && ["optimizer", "reactiva", "mercado"].includes(tab) ? "radiografia" : tab;
  const crit = alerts.filter((a) => a.severity === "critica" || a.severity === "alta").length;
  const av = availabilityOf(s);
  const avm = AVAILABILITY_META[av.level];
  const consulted = state.consultedAt ?? s.source.importedAt;
  const gas = isGasSupply(s);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          {contract && (
            <Button variant="outline" size="sm" onClick={() => useApp.getState().open(contract.id, "energia")}>
              <Briefcase /> Contracte: {contract.cliente.slice(0, 28)}
            </Button>
          )}
          {contract && (
            <Button size="sm" onClick={() => useApp.getState().set("proposalFor", contract.id)}>
              <FileSignature /> Prepara l&apos;oferta
            </Button>
          )}
        </div>
      </div>

      {/* Procedència i actualitat de les dades */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/70 px-3 py-2 text-xs text-fg-2">
        <DatabaseZap className="size-3.5 text-accent" />
        <span>
          Origen: <b className="text-fg">{s.source.demo ? "Dades sintètiques de demostració" : ORIGIN_LABEL[s.source.origin ?? "excel"]}</b>
        </span>
        <span className="text-fg-3">·</span>
        <Badge tone={gas ? "serious" : "blue"}>{gas ? "Gas" : "Llum"}</Badge>
        <span className="text-fg-3">·</span>
        <span>
          Data de les dades: <b className="num text-fg">{fmt.dateTime(consulted)}</b>
        </span>
        <span className="text-fg-3">·</span>
        <Badge tone={avm.tone === "green" ? "good" : avm.tone === "blue" ? "blue" : avm.tone === "amber" ? "warning" : "neutral"} title={avm.hint}>
          {avm.label} · {av.monthsKwh}/12 mesos
        </Badge>
        {serverEnabled() && (
          <Button variant="ghost" size="sm" className="ml-auto" disabled={state.refreshing} onClick={() => refresh(true)}>
            {state.refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Actualitza des del SIPS
          </Button>
        )}
      </div>
      {state.error && <Callout tone="warning" title="No s'ha pogut actualitzar">{state.error} Es mostren les darreres dades desades.</Callout>}

      {gas ? <GasHero s={s} /> : <SupplyHero s={s} />}
      <Tabs value={tabNow} onValueChange={setTab}>
        <TabsList className="sticky top-0 z-10">
          <TabsTrigger value="radiografia">
            <Activity /> Radiografia
          </TabsTrigger>
          {!gas && (
            <>
              <TabsTrigger value="optimizer">
                <Cpu /> Power Optimizer
              </TabsTrigger>
              <TabsTrigger value="reactiva">
                <Waves /> Reactiva
              </TabsTrigger>
              <TabsTrigger value="mercado">
                <Store /> Energy Market
              </TabsTrigger>
            </>
          )}
          <TabsTrigger value="alertas">
            <Bell /> Alertes {crit > 0 && <span className="num rounded-full bg-critical/15 px-1.5 text-[10px] text-critical">{crit}</span>}
          </TabsTrigger>
          <TabsTrigger value="oportunidad">
            <Target /> Oportunitat
          </TabsTrigger>
          <TabsTrigger value="ficha">
            <FileText /> Fitxa tècnica
          </TabsTrigger>
        </TabsList>
        <div className="mt-5">
          <TabsContent value="radiografia">{gas ? <GasOverview s={s} /> : <Overview s={s} />}</TabsContent>
          {!gas && (
            <>
              <TabsContent value="optimizer">
                <PowerOptimizer key={s.cups} s={s} />
              </TabsContent>
              <TabsContent value="reactiva">
                <ReactiveModule key={s.cups} s={s} />
              </TabsContent>
              <TabsContent value="mercado">
                <MarketModule key={s.cups} s={s} />
              </TabsContent>
            </>
          )}
          <TabsContent value="alertas">
            <AlertList alerts={alerts} />
          </TabsContent>
          <TabsContent value="oportunidad">
            {contract && (
              <div className="mb-4">
                <Callout tone="info" title="Subministrament del CRM">
                  Aquest CUPS correspon al contracte de <b>{contract.cliente}</b> ({contract.crm.status}). El seguiment comercial oficial és al CRM; aquestes notes són de l&apos;anàlisi energètica.
                </Callout>
              </div>
            )}
            <OpportunityModule s={s} goTo={setTab} />
          </TabsContent>
          <TabsContent value="ficha">
            <TechSheet s={s} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
