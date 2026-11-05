"use client";
/**
 * CAPTACIÓ I MÀRQUETING · panell intern. Embut de conversió, canals, campanyes i atribució.
 * Cada indicador indica si és conegut, estimat o no disponible (no s'inventen costos ni conversions).
 */
import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CircleAlert, ExternalLink, FileText, Filter, Globe, Megaphone, Plug, RefreshCw, Users, X } from "lucide-react";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { CHANNEL_LABEL, CHANNELS, type Kpi } from "@/core/capture";
import { Badge, Button, Notice, Tabs, cn } from "../../components/ui";
import { capApi, eur, fdt } from "./api";
import { PartnersTab } from "./Partners";
import { CampaignsTab, IntegrationsTab, RulesTab } from "./Settings";

type Row = { channel: string; label: string; submissions: number; leads: number; valid: number; opportunities: number; contracts: number; commissionsEstimated: number | null; cost: number | null; costStatus: string };
type Camp = { id: string; name: string; platform: string; status: string; utm_campaign: string | null; visits: number; leads: number; contracts: number; cost: number | null; costSource: string | null; cpl: number | null; cpa: number | null };
type Recent = { id: string; channel: string; status: string; name: string | null; received_at: string; lead_id: string | null; spam_reasons: string[]; error: string | null; cap_lead_documents: { id: string; status: string; cap_invoice_readings: { status: string; sufficient: boolean } | { status: string; sufficient: boolean }[] | null }[] };
export type Integration = { ok: boolean; label: string; note: string };
type Dash = { migrated: boolean; range: { from: string; to: string }; kpis: Kpi[]; byChannel: Row[]; byCampaign: Camp[]; byPartner: { id: string; name: string; leads: number; clients: number; contracts: number }[]; series: { day: string; enviats: number; leads: number }[]; recent: Recent[]; campaigns: { id: string; name: string; platform: string }[]; owners: { id: string; name: string }[]; unassigned: number; integrations: Record<string, Integration>; canEdit: boolean };

const STATUS_TONE = { conegut: "green", estimat: "amber", no_disponible: "zinc" } as const;
const STATUS_LABEL = { conegut: "Conegut", estimat: "Estimat", no_disponible: "No disponible" } as const;
const SUB_LABEL: Record<string, string> = { rebuda: "Rebuda", processant: "Processant", lead_creat: "Lead creat", duplicat: "Duplicat", rebutjada: "Rebutjada (antispam)", error: "Error (es reintenta)" };
const READ_LABEL: Record<string, string> = { pendent: "Lectura pendent", processant: "Llegint…", llegida: "Factura llegida", per_revisar: "Dades per revisar", revisada: "Revisada", error: "Error de lectura" };

export function CaptureView() {
  const me = useApp((s) => s.snap!.me);
  const params = useApp((s) => s.params);
  const [tab, setTab] = useState<"panell" | "collaboradors" | "campanyes" | "assignacio" | "integracions">((params.tab as "panell") ?? "panell");
  useEffect(() => { if (params.tab) setTab(params.tab as "panell"); }, [params.tab]);
  if (!isStaff(me.role)) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="amber">El panell de captació és per a l&apos;equip d&apos;administració. Els teus leads captats són a «Leads».</Notice></div>;
  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-emerald-600 to-lime-500 text-white"><Megaphone size={16} /></span>Captació i màrqueting</h2>
          <p className="mt-1 text-[13px] text-muted">Landing, formularis, factures, col·laboradors, campanyes i WhatsApp, tot connectat al CRM. Les dades que no existeixen es mostren com a no disponibles.</p>
        </div>
        <a href="/estudi" target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium hover:border-ink/25"><Globe size={13} /> Obre la landing <ExternalLink size={12} /></a>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ id: "panell", label: "Panell" }, { id: "collaboradors", label: "Col·laboradors" }, { id: "campanyes", label: "Campanyes" }, { id: "assignacio", label: "Assignació de leads" }, { id: "integracions", label: "Integracions" }]} />
      {tab === "panell" && <Panel />}
      {tab === "collaboradors" && <PartnersTab />}
      {tab === "campanyes" && <CampaignsTab />}
      {tab === "assignacio" && <RulesTab />}
      {tab === "integracions" && <IntegrationsTab />}
    </div>
  );
}

function Panel() {
  const [f, setF] = useState({ from: "", to: "", channel: "", campaign: "", owner: "", product: "" });
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const go = useApp((s) => s.navigate);
  const load = useCallback(async () => { try { setD(await capApi.get<Dash>("dashboard", f)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, [f]);
  useEffect(() => { void load(); }, [load]);
  if (d && !d.migrated) return <Notice tone="amber">Falta aplicar la migració <b>013_captacio.sql</b> a Supabase.</Notice>;
  const n = Object.values(f).filter(Boolean).length;
  return (
    <div className="space-y-4">
      {err && <Notice tone="red">{err}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="input h-9 w-auto text-[12.5px]" aria-label="Des de" value={f.from || d?.range.from || ""} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <span className="text-muted">→</span>
        <input type="date" className="input h-9 w-auto text-[12.5px]" aria-label="Fins a" value={f.to || d?.range.to || ""} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Canal" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="">Tots els canals</option>{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select>
        <button onClick={() => setOpen(!open)} className={cn("pressable flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px]", open || n > 1 ? "border-brand/60 text-brand" : "border-line text-muted")}><Filter size={13} /> Més filtres</button>
        {n > 0 && <button className="flex items-center gap-1 text-[12px] text-muted" onClick={() => setF({ from: "", to: "", channel: "", campaign: "", owner: "", product: "" })}><X size={12} /> Neteja</button>}
        <Button size="sm" className="ml-auto" onClick={() => void load()}><RefreshCw size={13} /> Actualitza</Button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-line bg-surface p-2.5">
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Campanya" value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })}><option value="">Totes les campanyes</option>{(d?.campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Comercial" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}><option value="">Tots els comercials</option>{(d?.owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Producte" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}><option value="">Tots els productes</option><option value="llum_residencial">Llum residencial</option><option value="llum_empresa">Llum empresa</option><option value="gas">Gas</option></select>
        </div>
      )}
      {d && d.unassigned > 0 && <Notice tone="amber"><CircleAlert size={14} className="mr-1 inline" />{d.unassigned} lead(s) captats sense responsable. Revisa les regles d&apos;assignació o assigna&apos;ls a mà.</Notice>}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {(d?.kpis ?? Array.from({ length: 10 }, () => null)).map((k, i) => k ? (
          <div key={k.key} className="rounded-2xl border border-line bg-surface p-3" title={k.note ?? undefined}>
            <p className="flex items-center justify-between gap-1 text-[11.5px] text-muted"><span className="truncate">{k.label}</span><Badge tone={STATUS_TONE[k.status]} className="shrink-0 text-[9.5px]">{STATUS_LABEL[k.status]}</Badge></p>
            <p className={cn("mt-1 text-[21px] font-semibold tnum", k.status === "no_disponible" && "text-muted/60")}>{k.value == null ? "—" : k.unit === "eur" ? eur(k.value, 0) : k.unit === "mwh" ? `${k.value.toLocaleString("ca-ES")} MWh` : k.value.toLocaleString("ca-ES")}</p>
            {k.note && <p className="line-clamp-1 text-[10.5px] text-muted">{k.note}</p>}
          </div>
        ) : <div key={i} className="h-[86px] animate-pulse rounded-2xl bg-elevated" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="text-[13px] font-semibold">Sol·licituds i leads per dia</h3>
            <div className="mt-2 h-48">{d && <ResponsiveContainer width="100%" height="100%"><AreaChart data={d.series} margin={{ left: 0, right: 8, top: 6 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line, #e4e4e7)" /><XAxis dataKey="day" tick={{ fontSize: 10.5 }} tickFormatter={(s: string) => s.slice(5)} /><YAxis tick={{ fontSize: 10.5 }} width={28} allowDecimals={false} /><Tooltip /><Area dataKey="enviats" name="Formularis enviats" stroke="#16a34a" fill="#16a34a33" /><Area dataKey="leads" name="Leads" stroke="#0ea5e9" fill="#0ea5e922" /></AreaChart></ResponsiveContainer>}</div>
          </section>
          <section className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Rendiment per canal</h3>
            {!d?.byChannel.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Encara no hi ha captació en aquest període.</p> : (
              <table className="w-full text-[12.5px]"><thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr>{["Canal", "Enviats", "Leads", "Vàlids", "Oport.", "Contractes", "Comissions (est.)", "Cost"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">{d.byChannel.map((r) => <tr key={r.channel}><td className="px-3 py-2 font-medium">{r.label}</td><td className="px-3 tnum">{r.submissions}</td><td className="px-3 tnum">{r.leads}</td><td className="px-3 tnum">{r.valid}</td><td className="px-3 tnum">{r.opportunities}</td><td className="px-3 tnum">{r.contracts}</td><td className="px-3 tnum">{r.commissionsEstimated == null ? "—" : eur(r.commissionsEstimated, 0)}</td><td className="px-3 tnum">{r.costStatus === "sense_cost_directe" ? <span className="text-muted">Sense cost directe</span> : r.cost == null ? <span className="text-muted">No disponible</span> : eur(r.cost, 0)}</td></tr>)}</tbody></table>
            )}
          </section>
          <section className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Campanyes</h3>
            {!d?.byCampaign.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Cap campanya registrada. Registra-les a la pestanya «Campanyes» per relacionar UTM, leads i costos.</p> : (
              <table className="w-full text-[12.5px]"><thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr>{["Campanya", "Plataforma", "Visites", "Leads", "Contractes", "Cost", "Cost/lead", "Cost/client"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">{d.byCampaign.map((c) => <tr key={c.id}><td className="px-3 py-2 font-medium">{c.name}{c.utm_campaign && <span className="block font-mono text-[10.5px] text-muted">{c.utm_campaign}</span>}</td><td className="px-3">{c.platform === "google_ads" ? "Google Ads" : c.platform === "meta_ads" ? "Meta Ads" : "Altres"}</td><td className="px-3 tnum">{c.visits}</td><td className="px-3 tnum">{c.leads}</td><td className="px-3 tnum">{c.contracts}</td><td className="px-3 tnum">{c.cost == null ? <span className="text-muted">No disponible</span> : <>{eur(c.cost, 0)} <span className="text-[10.5px] text-muted">{c.costSource === "api" ? "API" : "manual"}</span></>}</td><td className="px-3 tnum">{eur(c.cpl)}</td><td className="px-3 tnum">{eur(c.cpa)}</td></tr>)}</tbody></table>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface">
            <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold"><FileText size={14} /> Sol·licituds recents</h3>
            {!d?.recent.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Cap sol·licitud en aquest període.</p> : (
              <ul className="max-h-[440px] divide-y divide-line overflow-auto">{d.recent.map((s) => {
                const doc = s.cap_lead_documents?.[0];
                const rd = doc ? (Array.isArray(doc.cap_invoice_readings) ? doc.cap_invoice_readings[0] : doc.cap_invoice_readings) : null;
                return (
                  <li key={s.id}><button disabled={!s.lead_id} className="w-full px-4 py-2 text-left hover:bg-ink/[0.03] disabled:cursor-default" onClick={() => s.lead_id && go("captacio-lead", { id: s.lead_id })}>
                    <p className="flex items-center justify-between gap-2 text-[12.5px]"><span className="truncate font-medium">{s.name ?? "—"}</span><span className="shrink-0 text-[11px] text-muted">{fdt(s.received_at)}</span></p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]"><Badge tone="zinc">{CHANNEL_LABEL[s.channel as keyof typeof CHANNEL_LABEL] ?? s.channel}</Badge><Badge tone={s.status === "lead_creat" ? "green" : s.status === "error" ? "red" : s.status === "rebutjada" ? "zinc" : "amber"}>{SUB_LABEL[s.status] ?? s.status}</Badge>{rd && <Badge tone={rd.status === "per_revisar" ? "amber" : rd.status === "error" ? "red" : "blue"}>{READ_LABEL[rd.status] ?? rd.status}</Badge>}</p>
                  </button></li>
                );
              })}</ul>
            )}
          </section>
          <section className="rounded-2xl border border-line bg-surface">
            <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold"><Users size={14} /> Atribució a col·laboradors</h3>
            {!d?.byPartner.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Cap lead de col·laboradors en aquest període.</p> : <ul className="divide-y divide-line">{d.byPartner.map((p) => <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-[12.5px]"><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-muted tnum">{p.leads} leads · {p.clients} clients · {p.contracts} contr.</span></li>)}</ul>}
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold"><Plug size={14} /> Integracions</h3>
            <ul className="mt-2 space-y-1.5">{Object.entries(d?.integrations ?? {}).map(([k, i]) => <li key={k} className="flex items-start gap-2 text-[12px]"><span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", i.ok ? "bg-green-500" : "bg-zinc-300")} /><span><b className="font-medium">{i.label}</b><span className="block text-[11px] text-muted">{i.note}</span></span></li>)}</ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
