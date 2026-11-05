"use client";
import { startWorkspaceSync, useWorkspaceSync } from "./lib/workspace-sync";
/**
 * Arrel del mòdul d'intel·ligència energètica dins del shell únic.
 * - Carrega una sola vegada les dades SIPS (Supabase) dels contractes visibles.
 * - Manté el contenidor i l'espaiat originals de cups2.
 * Es carrega de manera diferida (next/dynamic) perquè ECharts i els motors no pesin al Kanban.
 */
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { View } from "@/data/store";
import { useStore } from "./lib/store";
import { EnergyPanelView } from "./views/panel";
import { SipsView } from "./views/sips";
import { SupplyView } from "./views/suministro";
import { RadarView } from "./views/radar";
import { AlertsView } from "./views/alertas";
import { MarketView } from "./views/mercado";
import { OptimizerView } from "./views/optimizer";
import { EnergySettingsView } from "./views/ajustes";

export default function EnergyRoot({ view, bare }: { view: View | "energy-settings"; bare?: boolean }) {
  const load = useStore((s) => s.loadCrmSupplies);
  const hydrated = useStore((s) => s.hydrated);
  const sync = useWorkspaceSync();
  // Fase 8: ofertes, configuració, factures i màxims es desen a Supabase (no només al navegador)
  useEffect(() => { if (hydrated) void startWorkspaceSync(); }, [hydrated]);
  const crm = useStore((s) => s.crm2);
  useEffect(() => {
    if (view !== "sips" && view !== "energy-settings") void load();
  }, [load, view]);

  const body = (
    <>
      {(sync.status === "error" || sync.status === "offline") && (
        <div role="status" className="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
          {sync.status === "offline" ? sync.message : <>No s&apos;han pogut desar els canvis de l&apos;espai energètic al servidor: {sync.message}. Es tornarà a provar amb el proper canvi.</>}
        </div>
      )}
      {crm.loading && view !== "fitxa" && view !== "sips" && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface/70 px-3 py-2 text-xs text-fg-3">
          <Loader2 className="size-3.5 animate-spin text-accent" /> Carregant les dades SIPS dels contractes del CRM…
        </div>
      )}
      {crm.error && view !== "sips" && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-fg-2">No s&apos;han pogut carregar les dades SIPS del CRM: {crm.error}</div>
      )}
      {view === "energia" && <EnergyPanelView />}
      {view === "sips" && <SipsView />}
      {view === "fitxa" && <SupplyView />}
      {view === "radar" && <RadarView />}
      {view === "alertes" && <AlertsView />}
      {view === "mercat" && <MarketView />}
      {view === "optimizer" && <OptimizerView />}
      {view === "energy-settings" && <EnergySettingsView />}
    </>
  );
  if (bare) return body;
  return <div className="energy-module mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:py-8">{body}</div>;
}
