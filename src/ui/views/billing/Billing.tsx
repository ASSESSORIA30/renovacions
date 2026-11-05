"use client";
/**
 * FACTURACIÓ (pantalla principal). Les opcions del menú obren aquesta pantalla amb ?tab=…:
 * panell · nova · emeses · esborranys · pendents · cobrades · rectificatives · clients · conciliacions · configuracio
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, ArrowRightLeft, BookUser, CalendarClock, CheckCircle2, CircleDollarSign, FileArchive, FilePen, FilePlus2, FileSpreadsheet, FileText, Hourglass, Landmark,
  Loader2, Percent, Receipt, RefreshCw, Search, Settings2, TrendingUp, Wallet,
} from "lucide-react";
import { DISPLAY_STATUS_LABEL, DISPLAY_STATUS_TONE } from "@/core/billing";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { bApi, errMsg, eur, fmtD, toast, type InvoiceRow } from "./api";
import { InvoiceEditor } from "./Invoice";
import { BillingClientsTab } from "./Clients";
import { BillingSettingsTab, StatementsTab } from "./Settings";
import { BankTab } from "./Bank";

type Tab = "panell" | "nova" | "emeses" | "esborranys" | "pendents" | "cobrades" | "rectificatives" | "clients" | "conciliacions" | "banc" | "configuracio";
const TABS: { id: Tab; label: string; icon: typeof Receipt }[] = [
  { id: "panell", label: "Panell", icon: Receipt }, { id: "nova", label: "Nova factura", icon: FilePlus2 }, { id: "emeses", label: "Emeses", icon: FileText },
  { id: "esborranys", label: "Esborranys", icon: FilePen }, { id: "pendents", label: "Pendents de cobrar", icon: Hourglass }, { id: "cobrades", label: "Cobrades", icon: CheckCircle2 },
  { id: "rectificatives", label: "Rectificatives", icon: FileText }, { id: "clients", label: "Clients", icon: BookUser }, { id: "conciliacions", label: "Conciliacions", icon: ArrowRightLeft },
  { id: "banc", label: "Banc", icon: Landmark },
  { id: "configuracio", label: "Configuració", icon: Settings2 },
];

export function BillingView() {
  const raw = useApp((s) => s.params.tab) as Tab | undefined;
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "panell";
  const go = useApp((s) => s.navigate);
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Receipt size={20} className="text-ren" /> Facturació</h2>
          <p className="text-[13px] text-muted">Factures d&apos;Assessoria 3.0 AE, SL · numeració correlativa, cobraments i liquidacions de comercialitzadores.</p>
        </div>
        {tab !== "nova" && <Button variant="primary" onClick={() => go("facturacio", { tab: "nova" })}><FilePlus2 size={15} /> Nova factura</Button>}
      </div>
      <nav className="scroll-thin -mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Seccions de facturació">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => go("facturacio", t.id === "panell" ? {} : { tab: t.id })}
            className={cn("pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium", tab === t.id ? "bg-ink text-surface" : "text-muted hover:bg-ink/5 hover:text-ink")}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </nav>
      {tab === "panell" && <BillingDashboard />}
      {tab === "nova" && <InvoiceEditor />}
      {["emeses", "esborranys", "pendents", "cobrades", "rectificatives"].includes(tab) && <InvoiceList key={tab} preset={tab as ListPreset} />}
      {tab === "clients" && <BillingClientsTab />}
      {tab === "conciliacions" && <StatementsTab />}
      {tab === "banc" && <BankTab />}
      {tab === "configuracio" && <BillingSettingsTab />}
    </div>
  );
}

/* ======================================================================= panell */

type Dash = {
  year: number;
  kpis: { month: string; year: string; base: string; vat: string; pending: string; paid: string; overdue: number; overdueAmount: string; previousYear: string; count: number };
  months: { month: string; current: number; previous: number }[];
  topClients: { id: string; name: string; base: string; n: number }[];
  alerts: { drafts: number; gaps: { invoice_no: string; notes: string | null }[]; clientsToReview: number; paymentUnknown: number };
  nextNumber: string;
};
const MONTHS = ["Gen", "Feb", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Des"];

function Kpi({ icon, label, value, hint, tone, strong }: { icon: React.ReactNode; label: string; value: string | number | undefined; hint?: string; tone?: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-muted">{icon}{label}</div>
      <div className={cn("mt-1.5 tabular-nums tracking-tight", strong ? "text-2xl font-semibold" : "text-xl font-semibold", tone)}>{value === undefined ? <span className="inline-block h-6 w-24 animate-pulse rounded bg-elevated" /> : typeof value === "number" ? value : eur(value)}</div>
      {hint && <div className="mt-1 text-[11.5px] text-muted">{hint}</div>}
    </div>
  );
}

function BillingDashboard() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [client, setClient] = useState("");
  const [clients, setClients] = useState<{ id: string; legal_name: string }[]>([]);
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = useApp((s) => s.navigate);
  const load = useCallback(async () => { try { setD(await bApi.get<Dash>("dashboard", { year: String(year), client })); setErr(null); } catch (e) { setErr(errMsg(e)); } }, [year, client]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { bApi.get<{ rows: { id: string; legal_name: string }[] }>("clients").then((r) => setClients(r.rows)).catch(() => undefined); }, []);
  const k = d?.kpis;
  const diff = k && Number(k.previousYear) > 0 ? ((Number(k.base) - Number(k.previousYear)) / Number(k.previousYear)) * 100 : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Any" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[0, 1, 2, 3].map((i) => <option key={i}>{new Date().getFullYear() - i}</option>)}</select>
        <select className="input h-9 w-auto max-w-[280px] text-[12.5px]" aria-label="Empresa" value={client} onChange={(e) => setClient(e.target.value)}><option value="">Totes les empreses</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select>
        <Button size="sm" onClick={() => void load()}><RefreshCw size={13} /> Actualitza</Button>
        {d && <span className="ml-auto text-[12px] text-muted">Propera factura: <b className="font-mono text-ink">{d.nextNumber}</b></span>}
      </div>
      {err && <Notice tone={/migració/.test(err) ? "amber" : "red"}>{err}</Notice>}
      {d && (d.alerts.gaps.length > 0 || d.alerts.clientsToReview > 0 || d.alerts.paymentUnknown > 0 || d.alerts.drafts > 0) && (
        <div className="grid gap-2 md:grid-cols-2">
          {d.alerts.gaps.length > 0 && <Notice tone="amber"><b>Números per verificar:</b> {d.alerts.gaps.map((g) => g.invoice_no).join(", ")}. Consten com a consumits a l&apos;Excel però sense factura. No es reutilitzaran. <button className="underline" onClick={() => go("facturacio", { tab: "configuracio" })}>Revisar</button></Notice>}
          {d.alerts.clientsToReview > 0 && <Notice tone="amber"><b>{d.alerts.clientsToReview} client(s) amb dades fiscals per revisar.</b> No s&apos;hi poden emetre factures fins que es corregeixin. <button className="underline" onClick={() => go("facturacio", { tab: "clients" })}>Obrir</button></Notice>}
          {d.alerts.paymentUnknown > 0 && <Notice tone="blue"><b>{d.alerts.paymentUnknown} factures de l&apos;Excel</b> sense informació de cobrament. No compten com a pendents ni vençudes fins que les revisis. <button className="underline" onClick={() => go("facturacio", { tab: "emeses", estat: "no_consta" })}>Revisar</button></Notice>}
          {d.alerts.drafts > 0 && <Notice tone="blue"><b>{d.alerts.drafts} esborrany(s)</b> pendents d&apos;emetre. <button className="underline" onClick={() => go("facturacio", { tab: "esborranys" })}>Obrir</button></Notice>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<CalendarClock size={14} />} label="Facturat aquest mes" value={k?.month} hint="Total amb IVA" strong />
        <Kpi icon={<TrendingUp size={14} />} label={`Facturat ${year}`} value={k?.year} hint={k ? `${k.count} factures${diff != null ? ` · ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} % de base vs ${year - 1}` : ""}` : undefined} strong />
        <Kpi icon={<Landmark size={14} />} label="Base imposable" value={k?.base} hint={`Any ${year}`} />
        <Kpi icon={<Percent size={14} />} label="IVA repercutit" value={k?.vat} hint={`Any ${year}`} />
        <Kpi icon={<Hourglass size={14} />} label="Pendent de cobrament" value={k?.pending} hint="Totes les factures obertes" tone={k && Number(k.pending) > 0 ? "text-pend" : undefined} strong />
        <Kpi icon={<CircleDollarSign size={14} />} label="Cobrat" value={k?.paid} hint={`Factures de ${year}`} tone="text-ren" />
        <Kpi icon={<AlertTriangle size={14} />} label="Factures vençudes" value={k ? k.overdue : undefined} hint={k ? `${eur(k.overdueAmount)} pendents` : undefined} tone={k && k.overdue > 0 ? "text-lost" : undefined} />
        <Kpi icon={<Wallet size={14} />} label={`Base ${year - 1}`} value={k?.previousYear} hint="Per comparar" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold">Base imposable per mes</h3>
          <p className="text-[12px] text-muted">{year} comparat amb {year - 1}</p>
          <div className="mt-3 h-64">
            {d ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.months.map((m) => ({ ...m, label: MONTHS[Number(m.month) - 1] }))} margin={{ left: 4, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--ink) / 0.08)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v: number) => `${Math.round(v / 1000)}k €`} />
                  <Tooltip formatter={(v) => eur(Number(v))} cursor={{ fill: "rgb(var(--ink) / 0.04)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="previous" name={String(year - 1)} fill="#a1a1aa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="current" name={String(year)} fill="#15803d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-full animate-pulse rounded-xl bg-elevated" />}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold">Empreses amb més facturació</h3>
          <p className="text-[12px] text-muted">Base imposable {year}</p>
          <ul className="mt-3 space-y-2">
            {(d?.topClients ?? []).map((c) => {
              const max = Number(d?.topClients[0]?.base ?? 1) || 1;
              return (
                <li key={c.id}>
                  <div className="flex justify-between gap-2 text-[12.5px]"><span className="truncate">{c.name}</span><span className="tabular-nums font-medium">{eur(c.base)}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-elevated"><div className="h-1.5 rounded-full bg-ren" style={{ width: `${(Number(c.base) / max) * 100}%` }} /></div>
                </li>
              );
            })}
            {d && !d.topClients.length && <li className="text-[12.5px] text-muted">Cap factura aquest any.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ======================================================================= llistats */

type ListPreset = "emeses" | "esborranys" | "pendents" | "cobrades" | "rectificatives";
type ListResult = { rows: InvoiceRow[]; total: number; page: number; size: number; sums: { base: string; total: string; pending: string } };

function InvoiceList({ preset }: { preset: ListPreset }) {
  const params = useApp((s) => s.params);
  const go = useApp((s) => s.navigate);
  const [f, setF] = useState({ q: "", year: "", from: "", to: "", min: "", max: "", period: "", client: "", status: params.estat ?? "" });
  const [page, setPage] = useState(0);
  const [d, setD] = useState<ListResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [paidModal, setPaidModal] = useState(false);
  const [clients, setClients] = useState<{ id: string; legal_name: string }[]>([]);
  const status = f.status || preset;
  const query = useMemo(() => ({ ...f, status, page: String(page) }), [f, status, page]);
  const load = useCallback(async () => { try { setD(await bApi.get<ListResult>("invoices", query)); setErr(null); } catch (e) { setErr(errMsg(e)); } }, [query]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { bApi.get<{ rows: { id: string; legal_name: string }[] }>("clients").then((r) => setClients(r.rows)).catch(() => undefined); }, []);
  const rows = d?.rows ?? [];
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const selRows = rows.filter((r) => sel.has(r.id));
  const unknownSel = selRows.filter((r) => r.payment_unknown);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setPage(0); setF({ ...f, [k]: e.target.value }); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-muted" /><input className="input h-9 w-64 pl-8 text-[12.5px]" placeholder="Número, empresa, CIF o concepte" value={f.q} onChange={set("q")} /></div>
        <select className="input h-9 w-auto max-w-[240px] text-[12.5px]" aria-label="Empresa" value={f.client} onChange={set("client")}><option value="">Totes les empreses</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Any" value={f.year} onChange={set("year")}><option value="">Tots els anys</option>{[0, 1, 2, 3].map((i) => <option key={i}>{new Date().getFullYear() - i}</option>)}</select>
        {preset === "emeses" && <select className="input h-9 w-auto text-[12.5px]" aria-label="Estat" value={f.status} onChange={set("status")}><option value="">Tots els estats</option><option value="pendents">Pendents de cobrar</option><option value="vencudes">Vençudes</option><option value="cobrades">Cobrades</option><option value="no_consta">Cobrament no consta (Excel)</option></select>}
        <input type="date" className="input h-9 w-auto text-[12.5px]" aria-label="Des de" value={f.from} onChange={set("from")} />
        <input type="date" className="input h-9 w-auto text-[12.5px]" aria-label="Fins a" value={f.to} onChange={set("to")} />
        <input className="input h-9 w-24 text-[12.5px]" placeholder="Import mín." inputMode="decimal" value={f.min} onChange={set("min")} />
        <input className="input h-9 w-24 text-[12.5px]" placeholder="Import màx." inputMode="decimal" value={f.max} onChange={set("max")} />
        <input className="input h-9 w-36 text-[12.5px]" placeholder="Període" value={f.period} onChange={set("period")} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-muted">{d ? `${d.total} factures · base ${eur(d.sums.base)} · total ${eur(d.sums.total)}${preset !== "esborranys" ? ` · pendent ${eur(d.sums.pending)}` : ""}` : "Carregant…"}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {sel.size > 0 && <span className="self-center text-muted">{sel.size} seleccionades</span>}
          {sel.size > 0 && preset !== "esborranys" && <a href={bApi.zipUrl([...sel])}><Button size="sm"><FileArchive size={13} /> PDF en ZIP</Button></a>}
          {unknownSel.length > 0 && <Button size="sm" onClick={() => setPaidModal(true)}><CheckCircle2 size={13} /> Marcar com a cobrades ({unknownSel.length})</Button>}
          {preset !== "esborranys" && <a href={bApi.xlsxUrl(query)}><Button size="sm"><FileSpreadsheet size={13} /> Excel (llistat, mensual i IVA)</Button></a>}
        </div>
      </div>
      {err && <Notice tone={/migració/.test(err) ? "amber" : "red"}>{err}</Notice>}
      <div className="overflow-auto rounded-2xl border border-line bg-surface">
        {!d ? <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-muted" size={18} /></div> : !rows.length ? (
          <Empty icon={<FileText size={24} />} title={preset === "esborranys" ? "No hi ha esborranys" : "Cap factura amb aquests filtres"} action={<Button size="sm" onClick={() => go("facturacio", { tab: "nova" })}><FilePlus2 size={13} /> Nova factura</Button>} />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Seleccionar totes" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                <th>Número</th><th>Data</th><th>Empresa</th><th className="hidden lg:table-cell">Concepte</th><th className="text-right">Base</th><th className="hidden text-right sm:table-cell">IVA</th><th className="text-right">Total</th><th className="hidden text-right md:table-cell">Pendent</th><th className="px-3">Estat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.02]" onClick={() => go("factura", { id: r.id })}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Seleccionar ${r.invoice_no ?? "esborrany"}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="font-mono font-medium">{r.invoice_no ?? <span className="text-muted">esborrany</span>}{r.needs_review && <AlertTriangle size={11} className="ml-1 inline text-amber-500" aria-label="Per revisar" />}</td>
                  <td>{fmtD(r.issue_date)}</td>
                  <td className="max-w-[260px] truncate">{r.client_name}</td>
                  <td className="hidden max-w-[280px] truncate text-muted lg:table-cell">{r.concept}</td>
                  <td className="text-right tabular-nums">{eur(r.base)}</td>
                  <td className="hidden text-right tabular-nums text-muted sm:table-cell">{eur(r.vat)}</td>
                  <td className="text-right font-medium tabular-nums">{eur(r.total)}</td>
                  <td className="hidden text-right tabular-nums md:table-cell">{r.status === "esborrany" || r.payment_unknown ? "—" : eur(r.pending)}</td>
                  <td className="px-3"><Badge tone={DISPLAY_STATUS_TONE[r.display_status]}>{r.kind === "rectificativa" && r.status !== "esborrany" ? "Rectificativa" : DISPLAY_STATUS_LABEL[r.display_status]}</Badge>{r.sent_at && <span className="ml-1 text-[11px] text-muted" title={`Enviada el ${fmtD(r.sent_at)}`}>✉</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {d && d.total > d.size && (
        <div className="flex items-center justify-end gap-2 text-[12.5px]">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span className="text-muted">Pàgina {page + 1} de {Math.ceil(d.total / d.size)}</span>
          <Button size="sm" disabled={(page + 1) * d.size >= d.total} onClick={() => setPage(page + 1)}>Següent</Button>
        </div>
      )}
      <HistoricPaidModal open={paidModal} rows={unknownSel} onClose={() => setPaidModal(false)} onDone={() => { setPaidModal(false); setSel(new Set()); void load(); }} />
    </div>
  );
}

function HistoricPaidModal({ open, rows, onClose, onDone }: { open: boolean; rows: InvoiceRow[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  const run = async () => {
    setBusy(true);
    try {
      const r = await bApi.act<{ done: number; skipped: string[] }>("historic_paid", { data: { ids: rows.map((x) => x.id), reference: ref || null } });
      toast(`${r.done} factures marcades com a cobrades`, r.skipped.length ? `No s'han pogut marcar: ${r.skipped.join(", ")}` : undefined);
      onDone();
    } catch (e) { toast("No s'ha pogut fer", errMsg(e), "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Marcar factures de l'Excel com a cobrades" footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirmar</Button></>}>
      <p className="text-[13px]">Es registrarà un cobrament total per a <b>{rows.length}</b> factures ({eur(total)}), amb data de la factura. Fes-ho només si has comprovat que estan cobrades al banc.</p>
      <ul className="mt-2 max-h-40 overflow-auto text-[12px] text-muted">{rows.map((r) => <li key={r.id}>{r.invoice_no} · {r.client_name} · {eur(r.total)}</li>)}</ul>
      <label className="mt-3 block"><span className="label">Referència (opcional)</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="p. ex. Revisió extractes 2025" /></label>
    </Modal>
  );
}

