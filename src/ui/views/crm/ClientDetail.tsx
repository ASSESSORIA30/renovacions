"use client";
/** FITXA DEL CLIENT (Clients 360°): capçalera amb accions i pestanyes connectades a dades reals segons els permisos. */
import { AgendaQuickActions, CLIENT_ACTIONS, LinkedAgenda } from "../agenda/Linked";
import { IncidentAgendaActions } from "../agenda/Incident";
import { useCallback, useEffect, useState } from "react";
import { ClientAiCard } from "../intelligence/ClientAiCard";
import { CommsButtons, CommsTab } from "./CommsTab";
import {
  AlertTriangle, ArrowLeft, Building2, CalendarClock, CheckCircle2, FileText, Flame, Loader2, Lock, Mail, MessageCircle, Pencil, Phone, Plus, Share2, Sparkles, Store, Trash2, User, UserPlus, Users, Zap,
} from "lucide-react";
import {
  CLIENT_KIND_LABEL, CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE, CONTRACT_GROUP, INCIDENT_KINDS, INCIDENT_KIND_LABEL, INCIDENT_STATUSES, INCIDENT_STATUS_LABEL, PRIORITY_LABEL, formatPhone, phoneDigits,
  LEGAL_REP_ROLE_LABEL, MASKED, type CrmClientDetail, type CrmContact, type CrmIncident,
} from "@/core/crm";
import { CupsLink, recordRecent, useCrumb } from "../../components/Navigation";
import { daysUntil, fmtDate, fmtDateTime } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, Tabs, cn } from "../../components/ui";
import { ApiError, crmApi, crmReady, type Facets } from "./api";
import { ClientForm } from "./ClientForm";
import { SuppliesTab } from "./SuppliesTab";
import { ContractsTab } from "./ContractsTab";
import { DocumentsTab } from "./DocumentsTab";
import { ActivityTab } from "./ActivityTab";
import { ClientRelatedIndicator, SharedContactsSection } from "./ContactRelations";
import { OppForm, ServiceChip, StagePill } from "../sales/shared";
import { NewExpedientWizard, StatusPill as ExpStatusPill } from "../contracting/shared";
import type { ExpStatus } from "@/core/contracting";
import type { Service, Stage } from "@/core/sales";

export type Tab = "resum" | "subministraments" | "contractes" | "documents" | "activitat" | "comparatives" | "incidencies" | "comunicacions";
export interface Ctx { d: CrmClientDetail; reload: () => Promise<void>; facets: Facets | null }

export function ClientView() {
  const params = useApp((s) => s.params);
  const id = params.id ?? "";
  const tab = (params.tab as Tab) || "resum";
  const [d, setD] = useState<CrmClientDetail | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setD(await crmApi.get(id));
      setError(null);
    } catch (e) {
      setError({ status: e instanceof ApiError ? e.status : 500, message: e instanceof Error ? e.message : String(e) });
    }
  }, [id]);
  useEffect(() => { setD(null); if (id && crmReady()) void reload(); }, [id, reload]);
  useEffect(() => { if (crmReady()) crmApi.facets().then(setFacets).catch(() => undefined); }, []);
  const setTab = (t: Tab) => useApp.getState().navigate("client", { id, tab: t }, { replace: true });
  const back = () => useApp.getState().navigate("clients");
  useCrumb(d?.client.name);
  useEffect(() => { if (d) recordRecent({ kind: "client", ref: d.client.id, label: d.client.name, sub: [CLIENT_KIND_LABEL[d.client.kind], d.client.city].filter(Boolean).join(" · ") }); }, [d?.client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Empty icon={error.status === 404 || error.status === 403 ? <Lock size={26} /> : <AlertTriangle size={26} />} title={error.status === 404 || error.status === 403 ? "No pots veure aquest client" : "No s'ha pogut carregar la fitxa"} body={error.message} action={<Button size="sm" onClick={back}><ArrowLeft size={13} /> Torna als clients</Button>} />
      </div>
    );
  }
  if (!d) return <div className="mx-auto max-w-[1400px] space-y-3 px-4 py-5 sm:px-6"><div className="h-36 animate-pulse rounded-2xl bg-elevated" /><div className="h-10 animate-pulse rounded-xl bg-elevated" /><div className="h-64 animate-pulse rounded-2xl bg-elevated" /></div>;

  const c = d.client;
  const ctx: Ctx = { d, reload, facets };
  const pendingTasks = d.tasks.filter((t) => t.status === "pendent").sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
  const nextTask = pendingTasks[0];
  const lastActivity = d.activities[0];
  const liveSupplies = d.supplies.filter((s) => !s.archived_at);
  const KindIcon = c.kind === "empresa" ? Building2 : c.kind === "autonom" ? Store : User;
  const logIntent = (type: "email" | "whatsapp" | "trucada", title: string) =>
    crmApi.action({ entity: "activity", action: "create", clientId: c.id, data: { type, title, delivery: type === "trucada" ? null : "intent" } }).then(reload).catch(() => undefined);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <button onClick={back} className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft size={14} /> Clients</button>

      <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand"><KindIcon size={26} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">{c.name}</h2>
              <Badge tone={CLIENT_STATUS_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</Badge>
              <Badge>{CLIENT_KIND_LABEL[c.kind]}</Badge>
              {c.priority === "alta" && <Badge tone="red">Prioritat alta</Badge>}
            </div>
            <p className="mt-0.5 text-[13px] text-muted">
              {[c.trade_name, c.tax_id, c.sector].filter(Boolean).join(" · ") || "Sense identificador fiscal"}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
              <span className="inline-flex items-center gap-1.5"><Users size={13} className="text-muted" /> {c.owner_name ?? <span className="text-muted">Sense comercial assignat</span>}</span>
              {c.phone && <span className="inline-flex items-center gap-1.5"><Phone size={13} className="text-muted" /> {formatPhone(c.phone)}</span>}
              {c.email && <span className="inline-flex items-center gap-1.5"><Mail size={13} className="text-muted" /> {c.email}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.phone && <a href={`tel:${c.phone}`} onClick={() => logIntent("trucada", "Trucada iniciada des de la fitxa")} className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] hover:bg-elevated"><Phone size={14} /> Truca</a>}
            {c.email && <a href={`mailto:${c.email}`} onClick={() => logIntent("email", "S'ha obert l'aplicació de correu")} className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] hover:bg-elevated"><Mail size={14} /> Correu</a>}
            {c.phone && <a href={`https://wa.me/${phoneDigits(c.phone)}`} target="_blank" rel="noopener noreferrer" onClick={() => logIntent("whatsapp", "S'ha obert WhatsApp")} className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] hover:bg-elevated"><MessageCircle size={14} /> WhatsApp</a>}
            <CommsButtons clientId={c.id} canEdit={d.permissions.canEdit} onChange={() => void reload()} />
            <Button onClick={() => useApp.getState().navigate("comparativa", { client: c.id })}><Sparkles size={14} /> Comparativa</Button>
            {d.permissions.canEdit && <Button variant="primary" onClick={() => setEditing(true)}><Pencil size={14} /> Edita</Button>}
          </div>
        </div>
        <div className="mt-4 grid gap-2.5 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Última activitat" value={lastActivity ? lastActivity.title : "Cap"} sub={lastActivity ? `${fmtDateTime(lastActivity.at)}${lastActivity.user_name ? ` · ${lastActivity.user_name}` : ""}` : undefined} />
          <Stat label="Pròxima tasca" value={nextTask ? nextTask.title : "Cap tasca pendent"} sub={nextTask?.due_at ? `${fmtDateTime(nextTask.due_at)}${nextTask.assigned_name ? ` · ${nextTask.assigned_name}` : ""}` : undefined} tone={nextTask?.due_at && nextTask.due_at < new Date().toISOString() ? "text-lost" : undefined} onClick={() => setTab("activitat")} />
          <Stat label="Subministraments" value={`${liveSupplies.length}`} sub={`${liveSupplies.filter((s) => s.energy_type === "luz").length} llum · ${liveSupplies.filter((s) => s.energy_type === "gas").length} gas`} onClick={() => setTab("subministraments")} />
          <Stat label="Proper seguiment" value={c.next_follow_up ? fmtDate(c.next_follow_up) : "—"} tone={c.next_follow_up && (daysUntil(c.next_follow_up) ?? 1) < 0 ? "text-lost" : undefined} />
        </div>
        {d.summary && (
          <div className="mt-2.5 flex flex-wrap gap-2" aria-label="Resum del client" data-testid="client-summary">
            <Counter n={d.summary.activeContracts} label="contractes actius" onClick={() => setTab("contractes")} />
            <Counter n={d.summary.pendingRenewals} label="renovacions pendents" tone={d.summary.pendingRenewals ? "amber" : undefined} onClick={() => setTab("contractes")} />
            <Counter n={d.summary.openIncidents} label="incidències obertes" tone={d.summary.openIncidents ? "red" : undefined} onClick={() => setTab("incidencies")} />
            <Counter n={d.summary.comparisonsInProgress} label="comparatives en curs" onClick={() => setTab("comparatives")} />
          </div>
        )}
        <div className="mt-2.5 empty:hidden"><ClientRelatedIndicator d={d} /></div>
        <div className="mt-2.5"><AgendaQuickActions compact actions={CLIENT_ACTIONS(c.name)} base={{ client: { id: c.id, name: c.name }, context: c.name }} /></div>
        <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Accions ràpides">
          <QuickChip onClick={() => setTab("activitat")}>+ Tasca o nota</QuickChip>
          <QuickChip onClick={() => setTab("incidencies")}>+ Incidència</QuickChip>
          <QuickChip onClick={() => setTab("documents")}>+ Document</QuickChip>
          {liveSupplies.length > 0 && <QuickChip onClick={() => setTab("subministraments")}>Consultar SIPS</QuickChip>}
          <QuickChip onClick={() => setTab("comparatives")}>Comparatives</QuickChip>
        </div>
        {!d.permissions.canEdit && <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted"><Lock size={12} /> Accés de consulta: pots afegir notes i activitat, però no modificar les dades del client.</p>}
      </section>

      <Tabs value={tab} onChange={setTab} items={[
        { id: "resum", label: "Resum" },
        { id: "subministraments", label: "Subministraments", count: liveSupplies.length },
        { id: "contractes", label: "Contractes", count: d.contracts.length },
        { id: "documents", label: "Documents", count: d.documents.filter((x) => x.status === "actiu").length },
        { id: "activitat", label: "Activitat", count: pendingTasks.length || undefined },
        { id: "comparatives", label: "Comparatives", count: d.comparisons.length },
        { id: "incidencies", label: "Incidències", count: d.incidents.filter((i) => i.status !== "tancada" && i.status !== "resolta").length || undefined },
        { id: "comunicacions", label: "Comunicacions" },
      ]} />

      {tab === "resum" && <Summary ctx={ctx} setTab={setTab} />}
      {tab === "subministraments" && <SuppliesTab ctx={ctx} />}
      {tab === "contractes" && <ContractsTab ctx={ctx} />}
      {tab === "documents" && <DocumentsTab ctx={ctx} />}
      {tab === "activitat" && <ActivityTab ctx={ctx} />}
      {tab === "comparatives" && <ComparisonsTab ctx={ctx} />}
      {tab === "incidencies" && <IncidentsTab ctx={ctx} />}
      {tab === "comunicacions" && <CommsTab clientId={c.id} canEdit={d.permissions.canEdit} documents={d.documents as unknown as { id: string; title: string; category: string; status: string }[]} onChange={() => void reload()} />}

      {editing && <ClientForm client={c} facets={facets} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />}
    </div>
  );
}

function Counter({ n, label, tone, onClick }: { n: number; label: string; tone?: "amber" | "red"; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("pressable inline-flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] hover:bg-elevated", tone === "red" ? "border-red-500/30 text-red-700 dark:text-red-300" : tone === "amber" ? "border-amber-500/30 text-amber-800 dark:text-amber-300" : "border-line text-muted")}>
      <b className="text-[14px] tnum text-ink">{n}</b>{label}
    </button>
  );
}
const QuickChip = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="pressable rounded-full border border-line px-2.5 py-1 text-[11.5px] font-medium text-muted hover:border-brand/40 hover:text-brand">{children}</button>
);

function Stat({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("min-w-0 rounded-xl bg-elevated/60 px-3 py-2 text-left", onClick && "pressable hover:bg-elevated")}>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("truncate text-[13.5px] font-medium", tone)}>{value}</p>
      {sub && <p className="truncate text-[11.5px] text-muted">{sub}</p>}
    </Tag>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[130px_1fr] gap-2 py-1 text-[12.5px]"><span className="text-muted">{label}</span><span className="min-w-0 break-words">{children || <span className="text-muted">—</span>}</span></div>
);

/* ============================================================== RESUM */

function Summary({ ctx, setTab }: { ctx: Ctx; setTab: (t: Tab) => void }) {
  const { d, reload, facets } = ctx;
  const c = d.client;
  const [contact, setContact] = useState<CrmContact | "new" | null>(null);
  const [sharing, setSharing] = useState(false);
  const [newOpp, setNewOpp] = useState(false);
  const [newExp, setNewExp] = useState(false);
  const live = d.contracts.filter((k) => CONTRACT_GROUP[k.status] === "vigent" || CONTRACT_GROUP[k.status] === "renovacio");
  const renewals = live.filter((k) => k.end_date && (daysUntil(k.end_date) ?? 999) <= 90).sort((a, b) => (a.end_date ?? "").localeCompare(b.end_date ?? ""));
  const supplies = d.supplies.filter((s) => !s.archived_at);
  const kpis = [
    { label: "Subministraments", value: supplies.length, icon: Zap, tab: "subministraments" as Tab },
    { label: "Serveis actius", value: `${supplies.some((s) => s.energy_type === "luz" && s.status === "actiu") ? "Llum" : ""}${supplies.some((s) => s.energy_type === "luz" && s.status === "actiu") && supplies.some((s) => s.energy_type === "gas" && s.status === "actiu") ? " + " : ""}${supplies.some((s) => s.energy_type === "gas" && s.status === "actiu") ? "Gas" : ""}` || "—", icon: Flame, tab: "subministraments" as Tab },
    { label: "Contractes vigents", value: live.length, icon: FileText, tab: "contractes" as Tab },
    { label: "Renovacions (90 dies)", value: renewals.length, icon: CalendarClock, tab: "contractes" as Tab },
  ];
  const removeAssign = async (userId: string) => {
    try { await crmApi.action({ entity: "assignment", action: "remove", clientId: c.id, userId }); await reload(); } catch (e) { useApp.getState().toast({ title: "Error", body: String(e instanceof Error ? e.message : e), tone: "err" }); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {kpis.map((k) => (
            <button key={k.label} onClick={() => setTab(k.tab)} className="pressable rounded-2xl border border-line bg-surface p-3.5 text-left hover:border-ink/20">
              <k.icon size={16} className="text-brand" />
              <p className="mt-1.5 text-xl font-semibold tnum">{k.value}</p>
              <p className="text-[11.5px] text-muted">{k.label}</p>
            </button>
          ))}
        </div>
        <Section title="Dades del client">
          <div className="grid gap-x-6 md:grid-cols-2">
            <div>
              <Row label="Tipus">{CLIENT_KIND_LABEL[c.kind]}</Row>
              <Row label="NIF/NIE/CIF">{c.tax_id && <span className="font-mono">{c.tax_id}</span>}</Row>
              <Row label="Nom comercial">{c.trade_name}</Row>
              <Row label="Sector">{c.sector}</Row>
              <Row label="Data d'alta">{fmtDate(c.registered_at)}</Row>
              <Row label="Origen">{c.origin}</Row>
              <Row label="Prioritat">{PRIORITY_LABEL[c.priority]}</Row>
            </div>
            <div>
              {c.kind !== "empresa" && <Row label="Contacte">{c.contact_name}</Row>}
              <Row label="Telèfons">{[formatPhone(c.phone), formatPhone(c.phone2)].filter(Boolean).join(" · ")}</Row>
              <Row label="Correu">{c.email}</Row>
              <Row label="Adreça">{[c.address, [c.postal_code, c.city].filter(Boolean).join(" "), c.province].filter(Boolean).join(", ")}</Row>
              <Row label="Etiquetes">{c.tags.length ? <span className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> : null}</Row>
            </div>
          </div>
          {c.kind === "empresa" && (
            <div className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
              <div data-testid="contacte-habitual">
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Persona de contacte</h4>
                <Row label="Nom">{c.contact_name}</Row>
                <Row label="Càrrec">{c.contact_role}</Row>
                <Row label="Telèfon">{formatPhone(c.phone)}</Row>
                <Row label="Correu">{c.email}</Row>
              </div>
              <div data-testid="representant-legal">
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Representant legal</h4>
                {c.contact_is_legal_rep && <p className="mb-1 text-[11.5px] text-ren">La persona de contacte també és el representant legal.</p>}
                <Row label="Nom">{c.legal_rep_name}</Row>
                <Row label="DNI/NIE">{c.legal_rep_tax_id ? <span className="font-mono">{c.legal_rep_tax_id === MASKED ? "Ocult (sense permís)" : c.legal_rep_tax_id}</span> : null}</Row>
                <Row label="Càrrec">{c.legal_rep_role ? LEGAL_REP_ROLE_LABEL[c.legal_rep_role] : null}</Row>
              </div>
            </div>
          )}
          {c.notes && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-elevated/60 px-3 py-2 text-[12.5px]">{c.notes}</p>}
        </Section>
        <Section title={`Oportunitats (${d.opportunities?.length ?? 0})`} action={<Button size="sm" onClick={() => setNewOpp(true)}><Plus size={13} /> Nova</Button>}>
          {!d.opportunities?.length ? <p className="text-[12.5px] text-muted">Cap oportunitat comercial. Un client pot tenir-ne diverses (llum, gas, fibra, assegurances, alarmes…).</p> : (
            <ul className="divide-y divide-line">
              {d.opportunities.map((o) => (
                <li key={o.id}><button className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] hover:bg-ink/[0.02]" onClick={() => useApp.getState().navigate("oportunitat", { id: o.id })}>
                  <ServiceChip s={o.service as Service} short /><span className="min-w-0 flex-1 truncate font-medium">{o.title}</span>
                  <span className="text-muted tnum">{o.commission_eur != null ? o.commission_eur.toLocaleString("ca-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }) : ""}</span>
                  <StagePill s={o.stage as Stage} />
                </button></li>
              ))}
            </ul>
          )}
        </Section>
        {d.expedients && (
          <Section title={`Expedients de contractació (${d.expedients.length})`} action={d.permissions.canEdit && <Button size="sm" onClick={() => setNewExp(true)}><Plus size={13} /> Nou</Button>}>
            {!d.expedients.length ? <p className="text-[12.5px] text-muted">Cap expedient. Obre&apos;n un per gestionar la documentació, la signatura i l&apos;activació d&apos;un contracte.</p> : (
              <ul className="divide-y divide-line">
                {d.expedients.map((x) => (
                  <li key={x.id}><button className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] hover:bg-ink/[0.02]" onClick={() => useApp.getState().navigate("expedient", { id: x.id })}>
                    <ServiceChip s={x.service as Service} short /><span className="font-mono text-[11.5px] text-muted">{x.code}</span><span className="min-w-0 flex-1 truncate font-medium">{x.retailer}{x.product ? ` · ${x.product}` : ""}</span>
                    <ExpStatusPill s={x.status as ExpStatus} />
                  </button></li>
                ))}
              </ul>
            )}
          </Section>
        )}
        <Section title="Agenda del client" action={<Button size="sm" onClick={() => useApp.getState().navigate("agenda", {})}>Obre l&apos;agenda</Button>}>
          <LinkedAgenda filter={{ client: c.id }} empty="Cap cita, trucada ni seguiment programat amb aquest client." />
        </Section>
        <Section title={`Contactes (${d.contacts.length})`} action={d.permissions.canEdit && <Button size="sm" onClick={() => setContact("new")}><UserPlus size={13} /> Afegeix</Button>}>
          {d.contacts.length === 0 ? <p className="text-[12.5px] text-muted">Encara no hi ha contactes. {c.kind === "empresa" ? "Afegeix les persones amb qui tracteu (gerència, administració…)." : ""}</p> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {d.contacts.map((p) => (
                <li key={p.id} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-[12px] font-semibold">{p.name.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1 text-[12.5px]">
                    <p className="font-medium">{p.name} {p.is_primary && <Badge tone="green">Principal</Badge>}</p>
                    <p className="text-muted">{p.role ?? "—"}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3">
                      {p.phone && <a className="text-brand hover:underline" href={`tel:${p.phone}`}>{formatPhone(p.phone)}</a>}
                      {p.email && <a className="truncate text-brand hover:underline" href={`mailto:${p.email}`}>{p.email}</a>}
                    </p>
                  </div>
                  {d.permissions.canEdit && <button aria-label={`Edita ${p.name}`} className="text-muted hover:text-ink" onClick={() => setContact(p)}><Pencil size={13} /></button>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <SharedContactsSection d={d} />
      </div>
      <div className="space-y-4">
        <ClientAiCard client={c as unknown as { id: string; commercial_opt_out?: boolean; contact_preference?: string }} canEdit={d.permissions.canEdit} />
        <Section title="Gestió comercial" action={d.permissions.canAssign && <Button size="sm" variant="ghost" onClick={() => setSharing(true)}><Share2 size={13} /> Comparteix</Button>}>
          <Row label="Comercial">{c.owner_name}</Row>
          <Row label="Col·laborador">{c.collaborator_name}</Row>
          {d.assignments.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">També hi tenen accés</p>
              {d.assignments.map((a) => (
                <p key={a.user_id} className="flex items-center justify-between py-0.5 text-[12.5px]">
                  <span>{a.name ?? "Usuari"} <span className="text-muted">· {a.role}</span></span>
                  {d.permissions.canAssign && <button aria-label="Treu l'accés" className="text-muted hover:text-lost" onClick={() => removeAssign(a.user_id)}><Trash2 size={13} /></button>}
                </p>
              ))}
            </div>
          )}
        </Section>
        <Section title="Renovacions pendents">
          {renewals.length === 0 ? <p className="text-[12.5px] text-muted">Cap contracte venç en els propers 90 dies.</p> : (
            <ul className="space-y-1.5">
              {renewals.map((k) => {
                const days = daysUntil(k.end_date) ?? 0;
                return (
                  <li key={k.id} className="flex items-center justify-between rounded-lg bg-elevated/60 px-2.5 py-1.5 text-[12.5px]">
                    <span className="truncate">{k.retailer}{k.product ? ` · ${k.product}` : ""}</span>
                    <span className={cn("shrink-0 font-medium", days <= 30 ? "text-lost" : "text-pend")}>{days < 0 ? "Vençut" : `${days} dies`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section title="Activitat recent" action={<button className="text-[12px] text-brand hover:underline" onClick={() => setTab("activitat")}>Tot l&apos;historial</button>}>
          {d.activities.length === 0 ? <p className="text-[12.5px] text-muted">Encara no hi ha activitat.</p> : (
            <ul className="space-y-2">
              {d.activities.slice(0, 5).map((a) => <li key={a.id} className="text-[12.5px]"><p className="truncate">{a.title}</p><p className="text-[11px] text-muted">{fmtDateTime(a.at)}{a.user_name ? ` · ${a.user_name}` : ""}</p></li>)}
            </ul>
          )}
        </Section>
      </div>
      {contact && <ContactForm clientId={c.id} contact={contact === "new" ? null : contact} onClose={() => setContact(null)} onSaved={() => { setContact(null); void reload(); }} />}
      {newExp && <NewExpedientWizard initial={{ clientId: c.id, clientName: c.name }} onClose={() => setNewExp(false)} />}
      {newOpp && <OppForm initialParty={{ kind: "client", id: c.id, name: c.name }} onClose={() => setNewOpp(false)} onSaved={(id) => { setNewOpp(false); useApp.getState().navigate("oportunitat", { id }); }} />}
      {sharing && <ShareForm clientId={c.id} facets={facets} existing={d.assignments.map((a) => a.user_id)} onClose={() => setSharing(false)} onSaved={() => { setSharing(false); void reload(); }} />}
    </div>
  );
}

function ContactForm({ clientId, contact, onClose, onSaved }: { clientId: string; contact: CrmContact | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: contact?.name ?? "", role: contact?.role ?? "", phone: contact?.phone ?? "", email: contact?.email ?? "", is_primary: contact?.is_primary ?? false, notes: contact?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (action: "create" | "update" | "delete") => {
    if (action === "delete" && !confirm(`Segur que vols eliminar el contacte ${contact?.name}?`)) return;
    setBusy(true); setErr(null);
    try { await crmApi.action({ entity: "contact", action, clientId, id: contact?.id, data: f }); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={contact ? `Contacte · ${contact.name}` : "Nou contacte"}
      footer={<>{contact && <Button variant="ghost" className="mr-auto text-lost" disabled={busy} onClick={() => run("delete")}><Trash2 size={14} /> Elimina</Button>}<Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={() => run(contact ? "update" : "create")}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Nom i cognoms *</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="block"><span className="label">Funció</span><input className="input" list="crm-roles" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Gerència, administració…" /><datalist id="crm-roles">{["Gerència", "Administració", "Compres", "Manteniment", "Propietari/ària", "Assessoria"].map((r) => <option key={r} value={r} />)}</datalist></label>
        <label className="block"><span className="label">Telèfon</span><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Correu electrònic</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} /> Contacte principal</label>
        {err && <p className="text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
    </Modal>
  );
}

function ShareForm({ clientId, facets, existing, onClose, onSaved }: { clientId: string; facets: Facets | null; existing: string[]; onClose: () => void; onSaved: () => void }) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("comercial");
  const [busy, setBusy] = useState(false);
  const users = (facets?.users ?? []).filter((u) => !existing.includes(u.id) && !["admin", "cap_administrativa", "administrativa"].includes(u.role));
  return (
    <Modal open onClose={onClose} title="Comparteix el client"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!userId || busy} onClick={async () => { setBusy(true); try { await crmApi.action({ entity: "assignment", action: "add", clientId, userId, role }); onSaved(); } catch (e) { useApp.getState().toast({ title: "Error", body: String(e instanceof Error ? e.message : e), tone: "err" }); } finally { setBusy(false); } }}>Comparteix</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Dona accés a aquest client a un altre comercial o col·laborador. Administració i Direcció ja hi tenen accés.</p>
        <label className="block"><span className="label">Usuari</span><select className="input" value={userId} onChange={(e) => { setUserId(e.target.value); const u = users.find((x) => x.id === e.target.value); setRole(u?.role === "colaborador" ? "colaborador" : "comercial"); }}><option value="">Tria'l…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></label>
        <label className="block"><span className="label">Accés</span><select className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="comercial">Comercial (pot editar)</option><option value="suport">Suport (pot editar)</option><option value="colaborador">Col·laborador (consulta i notes)</option></select></label>
      </div>
    </Modal>
  );
}

/* ============================================================== COMPARATIVES */

function ComparisonsTab({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const supplies = d.supplies.filter((s) => !s.archived_at);
  const go = (supply?: string) => useApp.getState().navigate("comparativa", supply ? { client: d.client.id, supply } : { client: d.client.id });
  return (
    <div className="space-y-4">
      <Section title="Nova comparativa" action={<Button variant="primary" size="sm" onClick={() => go()}><Sparkles size={13} /> Sense subministrament</Button>}>
        {supplies.length === 0 ? <p className="text-[12.5px] text-muted">Afegeix un subministrament per comparar amb les seves dades (potències i consum).</p> : (
          <div className="flex flex-wrap gap-2">
            {supplies.map((s) => <Button key={s.id} size="sm" onClick={() => go(s.id)}>{s.energy_type === "gas" ? <Flame size={13} /> : <Zap size={13} />} <span className="font-mono">{s.cups.slice(0, 20)}</span></Button>)}
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-muted">La comparativa queda vinculada al client i els PDF que generis es desen a Documents → Proposta comercial.</p>
      </Section>
      {(d.drafts?.length ?? 0) > 0 && (
        <Section title={`Comparatives a mig fer (${d.drafts!.length})`}>
          <ul className="divide-y divide-line" data-testid="client-drafts">
            {d.drafts!.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]">
                <span className="font-medium">Pas {x.step} de 5</span>
                {x.cups && <CupsLink cups={x.cups} className="text-[12px]" />}
                <span className="text-muted">· {x.updated_by_name ?? x.created_by_name ?? "—"} · {fmtDateTime(x.updated_at)}</span>
                <Button size="sm" className="ml-auto" onClick={() => useApp.getState().navigate("comparativa", { draft: x.id })}>Reprèn</Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={`Comparatives del client (${d.comparisons.length})`}>
        {d.comparisons.length === 0 ? <Empty icon={<Sparkles size={22} />} title="Encara no hi ha comparatives" /> : (
          <table className="w-full text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="py-1.5 text-left">Data</th><th className="text-left">CUPS</th><th className="text-left">Estat</th><th className="text-left">Feta per</th><th className="text-right">Millor estalvi</th></tr></thead>
            <tbody>
              {d.comparisons.map((k) => (
                <tr key={k.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.025]" onClick={() => useApp.getState().navigate("comparatives", { open: k.id })}>
                  <td className="py-2">{fmtDateTime(k.created_at)}</td>
                  <td>{k.cups ? <CupsLink cups={k.cups} /> : "—"}</td>
                  <td><Badge tone={k.status === "esborrany" ? "zinc" : k.status === "enviada" ? "green" : "blue"}>{k.status}</Badge></td>
                  <td>{k.created_by_name ?? "—"}</td>
                  <td className="text-right tnum">{k.saving != null ? k.saving.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

/* ============================================================== INCIDÈNCIES (estructura base) */

function IncidentsTab({ ctx }: { ctx: Ctx }) {
  const { d, reload } = ctx;
  const [edit, setEdit] = useState<CrmIncident | "new" | null>(null);
  const contractIncidents = d.contracts.filter((k) => k.status === "incidencia");
  return (
    <div className="space-y-4">
      <Notice tone="blue">Registre bàsic d&apos;incidències, reclamacions i consultes del client. El gestor complet (terminis, comunicacions amb la comercialitzadora i la distribuïdora, plantilles) arribarà en una fase posterior sobre aquesta mateixa estructura.</Notice>
      {contractIncidents.length > 0 && <Notice>Hi ha {contractIncidents.length} contracte(s) en estat «Incidència»: {contractIncidents.map((k) => k.retailer).join(", ")}.</Notice>}
      <Section title={`Incidències i reclamacions (${d.incidents.length})`} action={<Button size="sm" variant="primary" onClick={() => setEdit("new")}><Plus size={13} /> Nova</Button>}>
        {d.incidents.length === 0 ? <Empty icon={<CheckCircle2 size={22} />} title="Cap incidència registrada" /> : (
          <ul className="divide-y divide-line">
            {d.incidents.map((i) => (
              <li key={i.id} className="flex cursor-pointer flex-wrap items-center gap-3 py-2.5 text-[12.5px] hover:bg-ink/[0.02]" onClick={() => setEdit(i)}>
                <Badge tone={i.kind === "reclamacio" ? "red" : i.kind === "consulta" ? "blue" : "amber"}>{INCIDENT_KIND_LABEL[i.kind]}</Badge>
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{i.title}</p><p className="text-[11px] text-muted">{fmtDateTime(i.opened_at)}{i.external_ref ? ` · Ref. ${i.external_ref}` : ""}{i.category ? ` · ${i.category}` : ""}</p></div>
                <Badge tone={i.status === "resolta" || i.status === "tancada" ? "green" : i.status === "esperant_tercers" ? "violet" : "zinc"}>{INCIDENT_STATUS_LABEL[i.status]}</Badge>
                {!["resolta", "tancada"].includes(i.status) && <span className="w-full pl-1" onClick={(e) => e.stopPropagation()}><IncidentAgendaActions incident={{ id: i.id, title: i.title }} client={{ id: d.client.id, name: d.client.name }} /></span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {edit && <IncidentForm ctx={ctx} incident={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </div>
  );
}

function IncidentForm({ ctx, incident, onClose, onSaved }: { ctx: Ctx; incident: CrmIncident | null; onClose: () => void; onSaved: () => void }) {
  const { d } = ctx;
  const [f, setF] = useState({ kind: incident?.kind ?? "incidencia", category: incident?.category ?? "", title: incident?.title ?? "", description: incident?.description ?? "", status: incident?.status ?? "oberta", priority: incident?.priority ?? "mitjana", external_ref: incident?.external_ref ?? "", supply_id: incident?.supply_id ?? "", contract_id: incident?.contract_id ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await crmApi.action({ entity: "incident", action: incident ? "update" : "create", clientId: d.client.id, id: incident?.id, data: { ...f, supply_id: f.supply_id || null, contract_id: f.contract_id || null } }); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={incident ? incident.title : "Nova incidència"} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-3">
        <label className="block"><span className="label">Tipus</span><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>{INCIDENT_KINDS.map((k) => <option key={k} value={k}>{INCIDENT_KIND_LABEL[k]}</option>)}</select></label>
        <label className="block"><span className="label">Estat</span><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>{INCIDENT_STATUSES.map((k) => <option key={k} value={k}>{INCIDENT_STATUS_LABEL[k]}</option>)}</select></label>
        <label className="block"><span className="label">Categoria</span><input className="input" list="crm-inc-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="crm-inc-cat">{["Facturació", "Alta o canvi de comercialitzadora", "Lectures", "Potència", "Tall de subministrament", "Distribuïdora", "Cobrament"].map((x) => <option key={x} value={x} />)}</datalist></label>
        <label className="block sm:col-span-3"><span className="label">Títol *</span><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="block sm:col-span-3"><span className="label">Descripció</span><textarea className="input min-h-[90px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="block"><span className="label">Subministrament</span><select className="input" value={f.supply_id} onChange={(e) => setF({ ...f, supply_id: e.target.value })}><option value="">—</option>{d.supplies.map((s) => <option key={s.id} value={s.id}>{s.cups.slice(0, 20)}</option>)}</select></label>
        <label className="block"><span className="label">Contracte</span><select className="input" value={f.contract_id} onChange={(e) => setF({ ...f, contract_id: e.target.value })}><option value="">—</option>{d.contracts.map((k) => <option key={k.id} value={k.id}>{k.retailer}{k.product ? ` · ${k.product}` : ""}</option>)}</select></label>
        <label className="block"><span className="label">Referència externa</span><input className="input" value={f.external_ref} onChange={(e) => setF({ ...f, external_ref: e.target.value })} placeholder="Núm. de reclamació" /></label>
        {err && <p className="text-[12.5px] text-lost sm:col-span-3">{err}</p>}
      </div>
    </Modal>
  );
}
