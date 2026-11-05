"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { Loader2 } from "lucide-react";
import type { Repo } from "@/data/repo";
import { initNavFromHistory, useApp } from "@/data/store";
import { Composer } from "./components/Composer";
import { ContractDrawer } from "./components/ContractDrawer";
import { LeaveDialog, SupplyPointModal } from "./components/Navigation";
import { AgendaView } from "./views/agenda/Agenda";
import { AgendaComposer } from "./views/agenda/EventForm";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CloseDialog, Toasts } from "./components/Overlays";
import { ProposalWizard } from "./components/ProposalWizard";
import { GroupPanel } from "./components/groups/GroupPanel";
import { GroupMoveDialog } from "./components/groups/GroupMoveDialog";
import { ContactAllPanel } from "./components/groups/ContactAllPanel";
import { RelatedPanel } from "./components/groups/RelatedPanel";
import { Logo, Shell } from "./components/Shell";
import { EASE_OUT } from "./components/ui";
import { AjustesView } from "./views/Ajustes";
import { CalendarioView } from "./views/Calendario";
import { CarteraView } from "./views/Cartera";
import { EstadisticasView } from "./views/Estadisticas";
import { HoyView } from "./views/Hoy";
import { KanbanView } from "./views/Kanban";
import { PlantillasView } from "./views/Plantillas";
import { DashboardExecView } from "./views/DashboardExec";
// Comparatives IA: es carreguen sota demanda (xlsx, jszip i jsPDF no pesen al Kanban).
const lazyView = <T extends string>(load: () => Promise<Record<T, React.ComponentType>>, name: T) =>
  dynamic(() => load().then((m) => m[name]), { ssr: false, loading: () => <div className="mx-auto max-w-[1300px] px-4 py-6 sm:px-6"><div className="h-10 w-64 animate-pulse rounded-xl bg-elevated" /><div className="mt-4 h-72 animate-pulse rounded-2xl bg-elevated" /></div> });
const JornadaView = lazyView(() => import("./views/sales/Jornada"), "JornadaView");
// Fase 7: consolidació, panells per rol i supervisió
const ControlCenterView = lazyView(() => import("./views/consolidacio/ControlCenter"), "ControlCenterView");
const CapPanelView = lazyView(() => import("./views/consolidacio/RolePanels"), "CapPanelView");
const TeamPanelView = lazyView(() => import("./views/teams/TeamPanel"), "TeamPanelView");
const TeamsAdminView = lazyView(() => import("./views/teams/TeamsAdmin"), "TeamsAdminView");
const RetailersView = lazyView(() => import("./views/retailers/RetailersList"), "RetailersView");
const RetailerView = lazyView(() => import("./views/retailers/RetailerDetail"), "RetailerView");
const MyDayView = lazyView(() => import("./views/consolidacio/RolePanels"), "MyDayView");
const CommercialPanelView = lazyView(() => import("./views/consolidacio/RolePanels"), "CommercialPanelView");
const TasksView = lazyView(() => import("./views/consolidacio/Tasks"), "TasksView");
const IncidentsView = lazyView(() => import("./views/consolidacio/Incidents"), "IncidentsView");
const ReportsView = lazyView(() => import("./views/consolidacio/Admin"), "ReportsView");
const QualityView = lazyView(() => import("./views/consolidacio/Admin"), "QualityView");
const AlertsCenterView = lazyView(() => import("./views/consolidacio/Admin"), "AlertsCenterView");
const PermissionsView = lazyView(() => import("./views/consolidacio/Admin"), "PermissionsView");
const ProfileView = lazyView(() => import("./views/consolidacio/Profile"), "ProfileView");
const LeadsView = lazyView(() => import("./views/sales/Leads"), "LeadsView");
const PipelineView = lazyView(() => import("./views/sales/Pipeline"), "PipelineView");
const OpportunityView = lazyView(() => import("./views/sales/Opportunity"), "OpportunityView");
const PerformanceView = lazyView(() => import("./views/sales/Performance"), "PerformanceView");
const ContractingDashboardView = lazyView(() => import("./views/contracting/Dashboard"), "ContractingDashboardView");
const BoardView = lazyView(() => import("./views/contracting/Board"), "BoardView");
const ExpedientView = lazyView(() => import("./views/contracting/Expedient"), "ExpedientView");
const FinanceDashboardView = lazyView(() => import("./views/finance/Dashboard"), "FinanceDashboardView");
const SettlementsView = lazyView(() => import("./views/finance/Settlements"), "SettlementsView");
const SettlementDetailView = lazyView(() => import("./views/finance/Settlements"), "SettlementDetailView");
const ReconciliationView = lazyView(() => import("./views/finance/Reconciliation"), "ReconciliationView");
const ClaimsView = lazyView(() => import("./views/finance/Claims"), "ClaimsView");
const AuditorView = lazyView(() => import("./views/finance/Auditor"), "AuditorView");
const RulesView = lazyView(() => import("./views/finance/Rules"), "RulesView");
// Facturació pròpia (migració 026)
const BillingView = lazyView(() => import("./views/billing/Billing"), "BillingView");
const InvoiceView = lazyView(() => import("./views/billing/Invoice"), "InvoiceView");
const ExportsView = lazyView(() => import("./views/exports/Exports"), "ExportsView");
const IntelligenceView = lazyView(() => import("./views/intelligence/Center"), "IntelligenceView");
const IaOpportunityView = lazyView(() => import("./views/intelligence/Detail"), "IaOpportunityView");
const CaptureView = lazyView(() => import("./views/capture/Dashboard"), "CaptureView");
const CaptureLeadView = lazyView(() => import("./views/capture/Lead"), "CaptureLeadView");
const ClientsView = lazyView(() => import("./views/crm/ClientsList"), "ClientsView");
const ClientView = lazyView(() => import("./views/crm/ClientDetail"), "ClientView");
const ComparativaWizardView = lazyView(() => import("./views/comparatives/Wizard"), "ComparativaWizardView");
const ComparativesListView = lazyView(() => import("./views/comparatives/List"), "ComparativesListView");
const TariffCatalogView = lazyView(() => import("./views/comparatives/Catalog"), "TariffCatalogView");
const MassComparisonView = lazyView(() => import("./views/comparatives/Mass"), "MassComparisonView");
const CommissionsView = lazyView(() => import("./views/comparatives/Commissions"), "CommissionsView");
import { VIEWS, type View } from "@/data/store";

/** Mòdul energètic (cups2) carregat de manera diferida: ECharts i els motors no afecten el Kanban. */
const EnergyRoot = dynamic(() => import("@/energy/EnergyRoot"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-6 sm:px-6">
      <div className="h-10 w-72 animate-pulse rounded-xl bg-elevated" />
      <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-elevated" />)}</div>
      <div className="h-80 animate-pulse rounded-2xl bg-elevated" />
    </div>
  ),
});
const ENERGY_VIEWS: View[] = ["sips", "energia", "fitxa", "radar", "optimizer", "alertes", "mercat"];

/** Llegeix la vista de l'URL (/?v=fitxa&cups=…). */
function fromUrl(): { view: View; params: Record<string, string> } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(location.search);
  const v = q.get("v") as View | null;
  if (!v || !VIEWS.includes(v)) return null;
  const params: Record<string, string> = {};
  q.forEach((val, key) => key !== "v" && (params[key] = val));
  return { view: v, params };
}

export default function App({ repo }: { repo: Repo }) {
  const { ready, error, view, init } = useApp();
  const role = useApp((s) => s.snap?.me.role);
  useEffect(() => { void init(repo); }, [repo, init]);
  // Fase 7: els col·laboradors només tenen el portal (el middleware ja els redirigeix i les APIs internes els rebutgen)
  useEffect(() => { if (ready && role === "colaborador" && repo.variant !== "demo") window.location.replace("/collaboradors"); }, [ready, role, repo]);
  // Navegació amb l'URL: enllaços directes i botó «enrere» del navegador.
  useEffect(() => {
    if (!ready) return;
    initNavFromHistory();
    const u = fromUrl();
    if (u) useApp.getState().navigate(u.view, u.params, { replace: true });
    else useApp.getState().navigate(useApp.getState().view, {}, { replace: true });
    // Fase 9: enrere/endavant del navegador → es restaura la pantalla i el seu context (fitxa oberta, desplaçament…)
    const onPop = (e: PopStateEvent) => {
      const x = fromUrl();
      if (x) useApp.getState().restoreFromHistory(e.state, x.view, x.params);
    };
    // canvis sense desar en tancar o recarregar la pestanya
    const onUnload = (e: BeforeUnloadEvent) => { if (useApp.getState().guard?.dirty()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("beforeunload", onUnload); };
  }, [ready]);

  if (!ready || (role === "colaborador" && repo.variant !== "demo")) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Logo />
        <Loader2 className="animate-spin text-muted" size={20} />
      </div>
    );
  }
  if (error) {
    return <div className="flex h-full items-center justify-center p-6 text-center text-sm"><div><p className="font-semibold">No s'han pogut carregar les dades</p><p className="mt-1 text-muted">{error}</p></div></div>;
  }
  return (
    <Shell>
      <AnimatePresence mode="wait">
        <motion.div key={ENERGY_VIEWS.includes(view) ? `energy-${view}-${useApp.getState().params.cups ?? ""}` : view} className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14, ease: EASE_OUT }}>
          <ErrorBoundary label="Aquesta pantalla" resetKey={view}>
          {view === "control" && <ControlCenterView />}
          {view === "panell-cap" && <CapPanelView />}
          {view === "panell-equip" && <TeamPanelView />}
          {view === "equips" && <TeamsAdminView />}
          {view === "comercialitzadores" && <RetailersView />}
          {view === "comercialitzadora" && <RetailerView key={useApp.getState().params.id ?? ""} />}
          {view === "jornada-admin" && <MyDayView />}
          {view === "panell-comercial" && <CommercialPanelView />}
          {view === "tasques" && <TasksView key={useApp.getState().params.scope ?? ""} />}
          {view === "incidencies" && <IncidentsView />}
          {view === "informes" && <ReportsView />}
          {view === "qualitat" && <QualityView />}
          {view === "centre-alertes" && <AlertsCenterView />}
          {view === "permisos" && <PermissionsView />}
          {view === "perfil" && <ProfileView />}
          {view === "agenda" && <AgendaView />}
          {view === "jornada" && <JornadaView />}
          {view === "leads" && <LeadsView />}
          {view === "pipeline" && <PipelineView />}
          {view === "oportunitat" && <OpportunityView />}
          {view === "rendiment" && <PerformanceView />}
          {view === "contractacio" && <ContractingDashboardView />}
          {view === "tramitacions" && <BoardView />}
          {view === "expedient" && <ExpedientView />}
          {view === "economia" && <FinanceDashboardView />}
          {view === "liquidacions" && <SettlementsView />}
          {view === "liquidacio" && <SettlementDetailView />}
          {view === "conciliacio" && <ReconciliationView />}
          {view === "auditor" && <AuditorView />}
          {view === "reclamacions" && <ClaimsView key={useApp.getState().params.id ?? "home"} />}
          {view === "regles" && <RulesView />}
          {view === "facturacio" && <BillingView key={useApp.getState().params.tab ?? "panell"} />}
          {view === "factura" && <InvoiceView key={useApp.getState().params.id ?? ""} />}
          {view === "exportacions" && <ExportsView />}
          {view === "ia" && <IntelligenceView />}
          {view === "ia-oportunitat" && <IaOpportunityView key={useApp.getState().params.id} />}
          {view === "captacio" && <CaptureView />}
          {view === "captacio-lead" && <CaptureLeadView key={useApp.getState().params.id} />}
          {view === "portal" && <PortalRedirect />}
          {view === "clients" && <ClientsView />}
          {view === "client" && <ClientView />}
          {view === "dashboard" && <DashboardExecView />}
          {view === "comparativa" && <ComparativaWizardView />}
          {view === "comparatives" && <ComparativesListView />}
          {view === "tarifes" && <TariffCatalogView />}
          {view === "massiva" && <MassComparisonView />}
          {view === "comissions" && <CommissionsView />}
          {view === "kanban" && <KanbanView />}
          {view === "hoy" && <HoyView />}
          {view === "calendario" && <CalendarioView />}
          {view === "cartera" && <CarteraView />}
          {view === "estadisticas" && <EstadisticasView />}
          {view === "propuestas" && <LegacyRedirect />}
          {view === "plantillas" && <PlantillasView />}
          {ENERGY_VIEWS.includes(view) && <EnergyRoot view={view} />}
          {view === "ajustes" && <AjustesView />}
          </ErrorBoundary>
        </motion.div>
      </AnimatePresence>
      <ErrorBoundary label="Agrupació per contacte" resetKey="groups"><GroupPanel /><RelatedPanel /><ContactAllPanel /><GroupMoveDialog /></ErrorBoundary>
      <ContractDrawer />
      <ErrorBoundary label="Punt de subministrament" resetKey="supply"><SupplyPointModal /></ErrorBoundary>
      <LeaveDialog />
      <ErrorBoundary label="Agenda" resetKey="composer"><AgendaComposer /></ErrorBoundary>
      <Composer />
      <ProposalWizard />
      <CloseDialog />
      <Toasts />
    </Shell>
  );
}

/** El portal de col·laboradors és una aplicació a part (/portal). */
function PortalRedirect() {
  useEffect(() => { window.location.assign("/collaboradors"); }, []);
  return <div className="flex h-full items-center justify-center text-sm text-muted">Obrint el portal de col·laboradors…</div>;
}

/** L'antic apartat «Propostes» (gestor d'ofertes) s'ha substituït pel Catàleg de tarifes: els enllaços antics hi porten. */
function LegacyRedirect() {
  useEffect(() => { useApp.getState().navigate("tarifes", { tab: "propostes" }, { replace: true }); }, []);
  return null;
}
