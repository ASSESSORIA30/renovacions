"use client";
/** LIQUIDACIONS COMERCIALS I DE COL·LABORADORS: ESBORRANY → REVISIÓ → APROVADA → PAGADA. */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Banknote, CheckCircle2, FileDown, Loader2, Lock, PenLine, Plus, Send, Trash2, Undo2, Users, Wallet, X } from "lucide-react";
import { LEDGER_KIND_LABEL, SETTLEMENT_STATUS_LABEL, type LedgerKind, type SettlementStatus } from "@/core/commissions";
import { isStaff } from "@/core/roles";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, Tabs, cn } from "../../components/ui";
import { eur, fApi, fmtD, ym } from "./api";
import { CALC_TONE } from "./ContractEconomics";
import { ExportButton } from "../../components/ExportButton";

const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TONE: Record<string, "zinc" | "amber" | "green" | "blue" | "red"> = { esborrany: "zinc", revisio: "amber", aprovada: "blue", pagada: "green", anullada: "red" };
type Row = { id: string; code: string; kind: string; beneficiary_id: string; beneficiary_name: string | null; period_from: string; period_to: string; status: SettlementStatus; total_gross: string; approved_amount: string | null; paid_amount: string; pending: string };
type List = { rows: Row[]; unsettled: { layer: string; beneficiary_id: string; name: string | null; amount: string }[]; people: { id: string; name: string; role: string }[]; isStaff: boolean; isDirector: boolean; me: string };

export function SettlementsView() {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const p = useApp((s) => s.params);
  const [tab, setTab] = useState<"comercials" | "collaboradors" | "meves">((p.tab as "comercials") ?? (staff ? "comercials" : "meves"));
  useEffect(() => { if (p.tab) setTab(p.tab as "comercials"); }, [p.tab]);
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div className="float-right"><ExportButton set={tab === "meves" ? "comissions" : "liquidacions_comissions"} params={tab === "meves" ? {} : { f_kind: tab === "collaboradors" ? "collaborador" : "comercial" }} /></div>
      <div><h2 className="text-xl font-semibold tracking-tight">{staff ? "Liquidacions" : "Les meves comissions"}</h2><p className="text-[13px] text-muted">Imports bruts de comissions. No inclou retencions, cotitzacions ni nòmines.</p></div>
      <Tabs value={tab} onChange={setTab} items={staff ? [{ id: "comercials", label: "Comercials" }, { id: "collaboradors", label: "Col·laboradors" }] : [{ id: "meves", label: "Pendent i calculat" }, { id: me.role === "colaborador" ? "collaboradors" : "comercials", label: "Liquidacions" }]} />
      {tab === "meves" && <Mine />}
      {tab === "comercials" && <ListTab kind="comercial" />}
      {tab === "collaboradors" && (staff ? <Collaborators /> : <ListTab kind="collaborador" />)}
    </div>
  );
}

function ListTab({ kind }: { kind: "comercial" | "collaborador" }) {
  const [d, setD] = useState<List | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => fApi.get<List>("settlements", { kind }).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(errMsg(e))), [kind]);
  useEffect(() => { void load(); }, [load]);
  const go = useApp((s) => s.navigate);
  const layer = kind === "comercial" ? "comercial" : "collaborador";
  return (
    <div className="space-y-3">
      {err && <Notice tone="red">{err}</Notice>}
      {d?.isStaff && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-[12.5px] text-muted">Pendent de liquidar: {d.unsettled.filter((u) => u.layer === layer).map((u) => `${u.name ?? "—"} ${eur(u.amount)}`).join(" · ") || "res"}</p>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Nova liquidació</Button>
        </div>
      )}
      {!d ? <div className="h-40 animate-pulse rounded-2xl bg-elevated" /> : !d.rows.length ? <Empty icon={<Wallet size={24} />} title="Encara no hi ha liquidacions" body={d.isStaff ? "Prepara una liquidació mensual: inclourà les comissions meritades pendents i els incentius del mes." : "Quan Administració prepari una liquidació teva, la veuràs aquí."} /> : (
        <div className="overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Codi</th><th>{kind === "comercial" ? "Comercial" : "Col·laborador"}</th><th>Període</th><th>Estat</th><th className="text-right">Total brut</th><th className="text-right">Aprovat</th><th className="text-right">Pagat</th><th className="px-3 text-right">Saldo</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.02]" onClick={() => go("liquidacio", { id: r.id })}>
                <td className="px-3 py-2 font-mono">{r.code}</td><td>{r.beneficiary_name}</td><td className="text-muted">{fmtD(r.period_from)} – {fmtD(r.period_to)}</td>
                <td><Badge tone={TONE[r.status]}>{SETTLEMENT_STATUS_LABEL[r.status]}</Badge></td>
                <td className="text-right tnum">{eur(r.total_gross)}</td><td className="text-right tnum">{r.approved_amount != null ? eur(r.approved_amount) : "—"}</td><td className="text-right tnum">{eur(r.paid_amount)}</td>
                <td className={cn("px-3 text-right font-medium tnum", Number(r.pending) > 0 && ["aprovada"].includes(r.status) && "text-pend")}>{eur(r.pending)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && d && <NewSettlement kind={kind} people={d.people.filter((p) => (kind === "comercial" ? p.role !== "colaborador" : p.role === "colaborador"))} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); go("liquidacio", { id }); }} />}
    </div>
  );
}

function NewSettlement({ kind, people, onClose, onDone }: { kind: "comercial" | "collaborador"; people: { id: string; name: string }[]; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ beneficiary: people[0]?.id ?? "", month: ym() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => { setBusy(true); setErr(null); try { const r = await fApi.act<{ id: string }>("settlement_build", { data: { kind, ...f } }); toast("Liquidació preparada en esborrany"); onDone(r.id); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title={`Nova liquidació de ${kind === "comercial" ? "comercial" : "col·laborador"}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.beneficiary} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Prepara</Button></>}>
      <div className="space-y-3 text-[13px]">
        <label className="block"><span className="label">{kind === "comercial" ? "Comercial" : "Col·laborador"}</span><select className="input" value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block"><span className="label">Mes</span><input type="month" className="input" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></label>
        <p className="text-[12px] text-muted">S&apos;inclouran tots els moviments meritats pendents de liquidar fins a final de mes{kind === "comercial" ? " i es calcularan els incentius per trams del mes (només el tram més alt)" : ""}. Queda en esborrany fins que Direcció l&apos;aprovi.</p>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

type Detail = {
  settlement: Row & { total_fixed: string; total_variable: string; total_bonus: string; total_cancellations: string; total_adjustments: string; approved_by_name: string | null; approved_at: string | null; reviewed_by_name: string | null; notes: string | null };
  lines: { id: string; contract_id: string | null; category: string; description: string; amount: string; client_name: string | null; retailer: string | null }[];
  payments: { id: string; amount: string; paid_at: string; method: string; reference: string }[];
  audit: { id: number; at: string; user_name: string | null; action: string; amount: string | null }[];
  permissions: { staff: boolean; director: boolean; own: boolean };
};
const CAT: Record<string, string> = { fixa: "Comissions fixes", variable: "Comissions variables", bonificacio: "Bonificacions", anullacio: "Anul·lacions i retrocessions", ajustament: "Ajustaments" };

export function SettlementDetailView() {
  const id = useApp((s) => s.params.id) ?? "";
  const go = useApp((s) => s.navigate);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pay, setPay] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => fApi.get<Detail>("settlement", { id }).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(errMsg(e))), [id]);
  useEffect(() => { void load(); }, [load]);
  const status = async (s: string, msg: string) => { setBusy(s); try { await fApi.act("settlement_status", { id, status: s }); toast(msg); await load(); } catch (e) { toast("No s'ha pogut canviar", errMsg(e), "err"); } finally { setBusy(null); } };
  const del = async () => { if (!confirm("Eliminar aquest esborrany? Els moviments tornaran a quedar pendents de liquidar.")) return; try { await fApi.act("settlement_delete", { id }); toast("Esborrany eliminat"); go("liquidacions"); } catch (e) { toast("No s'ha pogut eliminar", errMsg(e), "err"); } };
  if (err && !d) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<Lock size={24} />} title="No s'ha pogut obrir la liquidació" body={err} action={<Button onClick={() => go("liquidacions")}>Torna</Button>} /></div>;
  if (!d) return <div className="mx-auto max-w-5xl px-4 py-5"><div className="h-80 animate-pulse rounded-2xl bg-elevated" /></div>;
  const s = d.settlement, p = d.permissions;
  const locked = s.status === "aprovada" || s.status === "pagada";
  const groups = Object.keys(CAT).map((k) => ({ k, rows: d.lines.filter((l) => l.category === k) })).filter((g) => g.rows.length);
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
      <button onClick={() => go("liquidacions")} className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft size={13} /> Liquidacions</button>
      <header className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{s.beneficiary_name}</h2><Badge tone={TONE[s.status]}>{SETTLEMENT_STATUS_LABEL[s.status]}</Badge>{locked && <span className="flex items-center gap-1 text-[12px] text-muted"><Lock size={12} /> Imports bloquejats</span>}</div>
            <p className="mt-1 text-[12.5px] text-muted"><span className="font-mono text-ink">{s.code}</span> · {s.kind === "comercial" ? "Comercial" : "Col·laborador"} · {fmtD(s.period_from)} – {fmtD(s.period_to)}{s.approved_by_name ? ` · aprovada per ${s.approved_by_name} el ${fmtD(s.approved_at)}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={fApi.pdfUrl(id)} className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px]" download><FileDown size={14} /> PDF</a>
            {p.staff && s.status === "esborrany" && <Button variant="primary" disabled={!!busy} onClick={() => status("revisio", "Enviada a revisió")}><Send size={14} /> Envia a revisió</Button>}
            {p.staff && s.status === "revisio" && <Button variant="ghost" disabled={!!busy} onClick={() => status("esborrany", "Tornada a esborrany")}><Undo2 size={14} /> Torna a esborrany</Button>}
            {p.director && s.status === "revisio" && !p.own && <Button variant="primary" disabled={!!busy} onClick={() => status("aprovada", "Liquidació aprovada")}><CheckCircle2 size={14} /> Aprova</Button>}
            {p.staff && s.status === "aprovada" && <Button variant="primary" onClick={() => setPay(true)}><Banknote size={14} /> Registra un pagament</Button>}
            {p.staff && (s.status === "esborrany" || s.status === "revisio") && <Button variant="ghost" onClick={del}><Trash2 size={14} /> Elimina</Button>}
          </div>
        </div>
        {p.director && p.own && s.status === "revisio" && <p className="mt-2 text-[12px] text-pend">És la teva pròpia liquidació: l&apos;ha d&apos;aprovar una altra persona de Direcció.</p>}
        <div className="mt-4 grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {[["Fixes", s.total_fixed], ["Variables", s.total_variable], ["Bonificacions", s.total_bonus], ["Anul·lacions", s.total_cancellations], ["Ajustaments", s.total_adjustments], ["Total brut", s.total_gross], ["Pagat", s.paid_amount], ["Saldo pendent", s.pending]].map(([l, v]) => (
            <div key={l} className={cn("rounded-xl border border-line px-3 py-2", (l === "Total brut" || l === "Saldo pendent") && "border-ink/20")}><p className="text-[11px] text-muted">{l}</p><p className={cn("text-[14px] font-semibold tnum", l === "Saldo pendent" && Number(v) > 0 && "text-pend")}>{eur(v)}</p></div>
          ))}
        </div>
      </header>
      <section className="rounded-2xl border border-line bg-surface">
        <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Detall ({d.lines.length} línies)</h3>
        {groups.map((g) => (
          <div key={g.k}>
            <p className="bg-ink/[0.03] px-4 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{CAT[g.k]} · {eur(g.rows.reduce((a, r) => a + Number(r.amount), 0))}</p>
            <ul className="divide-y divide-line">{g.rows.map((l) => <li key={l.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]"><span className="min-w-0 flex-1"><span className="font-medium">{l.client_name ?? "Incentiu del període"}</span>{l.retailer && <span className="text-muted"> · {l.retailer}</span>}<span className="block truncate text-[11.5px] text-muted" title={l.description}>{l.description}</span></span><span className={cn("tnum", Number(l.amount) < 0 && "text-lost")}>{eur(l.amount)}</span></li>)}</ul>
          </div>
        ))}
        {locked && p.staff && <p className="border-t border-line px-4 py-2 text-[11.5px] text-muted">Per corregir una liquidació aprovada, registra un ajustament al contracte o al comercial: s&apos;inclourà a la liquidació següent.</p>}
      </section>
      {(d.payments.length > 0 || s.status === "aprovada") && (
        <section className="rounded-2xl border border-line bg-surface">
          <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Pagaments</h3>
          {!d.payments.length ? <p className="px-4 py-3 text-[12.5px] text-muted">Encara no s&apos;ha pagat res.</p> : <ul className="divide-y divide-line">{d.payments.map((x) => <li key={x.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]"><span className="flex-1">{fmtD(x.paid_at)} · {x.method} · <span className="font-mono">{x.reference}</span></span><span className="tnum">{eur(x.amount)}</span></li>)}</ul>}
        </section>
      )}
      {p.staff && d.audit.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-2 text-[13px] font-semibold">Historial</h3>
          <ol className="space-y-1 text-[12px]">{d.audit.map((a) => <li key={a.id} className="flex gap-2"><span className="w-36 shrink-0 text-muted">{new Date(a.at).toLocaleString("ca-ES")}</span><span className="flex-1">{a.action.replace("estat:", "Estat: ")}{a.amount != null ? ` · ${eur(a.amount)}` : ""}</span><span className="text-muted">{a.user_name ?? "Sistema"}</span></li>)}</ol>
        </section>
      )}
      {pay && <PaymentDialog id={id} pending={s.pending} onClose={() => setPay(false)} onDone={() => { setPay(false); void load(); }} />}
    </div>
  );
}

function PaymentDialog({ id, pending, onClose, onDone }: { id: string; pending: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: pending, paid_at: new Date().toISOString().slice(0, 10), method: "transferencia", reference: "" });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => { setErr(null); try { await fApi.act("payment", { id, data: { ...f, amount: f.amount.replace(",", ".") } }); toast("Pagament registrat"); onDone(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal open onClose={onClose} title="Registrar un pagament" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!f.amount || !f.reference.trim()} onClick={save}>Registra</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block"><span className="label">Import (saldo {eur(pending)})</span><input className="input tnum" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="block"><span className="label">Data</span><input type="date" className="input" max={new Date().toISOString().slice(0, 10)} value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></label>
        <label className="block"><span className="label">Mètode</span><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="transferencia">Transferència</option><option value="nomina">Nòmina</option><option value="efectiu">Efectiu</option><option value="altres">Altres</option></select></label>
        <label className="block"><span className="label">Referència *</span><input className="input font-mono" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        <p className="text-[11.5px] text-muted sm:col-span-2">Es permeten pagaments parcials. No es pot pagar més del saldo ni registrar dues vegades el mateix pagament.</p>
        {err && <div className="sm:col-span-2"><Notice tone="red">{err}</Notice></div>}
      </div>
    </Modal>
  );
}

type Mine = { calculations: { id: string; label: string; status: string; amount: string | null; formula: string | null; created_at: string }[]; ledger: { id: string; kind: string; amount: string; period: string; description: string; settlement_id: string | null }[]; pending: string };
function Mine() {
  const [d, setD] = useState<Mine | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fApi.get<Mine>("mine").then(setD).catch((e) => setErr(errMsg(e))); }, []);
  if (err) return <Notice tone="red">{err}</Notice>;
  if (!d) return <div className="h-40 animate-pulse rounded-2xl bg-elevated" />;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-4"><p className="text-[12px] text-muted">Meritat pendent de liquidar</p><p className="text-2xl font-semibold tnum">{eur(d.pending)}</p><p className="text-[11.5px] text-muted">Es pagarà quan s&apos;aprovi la liquidació corresponent.</p></div>
      <section className="rounded-2xl border border-line bg-surface">
        <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Comissions previstes per contracte</h3>
        {!d.calculations.length ? <p className="px-4 py-3 text-[12.5px] text-muted">Encara no n&apos;hi ha cap.</p> : <ul className="divide-y divide-line">{d.calculations.map((c) => <li key={c.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]"><span className="min-w-0 flex-1"><span className="font-medium">{c.label}</span>{c.formula && <span className="block text-[11.5px] text-muted">{c.formula}</span>}</span><Badge tone={CALC_TONE[c.status] ?? "zinc"}>{c.status === "calculat" ? "Previst" : c.status === "simulacio" ? "Simulació" : "Pendent"}</Badge><span className="w-24 text-right tnum">{eur(c.amount)}</span></li>)}</ul>}
      </section>
      <section className="rounded-2xl border border-line bg-surface">
        <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">Moviments</h3>
        {!d.ledger.length ? <p className="px-4 py-3 text-[12.5px] text-muted">Cap moviment.</p> : <ul className="divide-y divide-line">{d.ledger.map((l) => <li key={l.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]"><span className="w-24 text-muted">{fmtD(l.period)}</span><span className="min-w-0 flex-1 truncate">{LEDGER_KIND_LABEL[l.kind as LedgerKind]} · {l.description}</span><span className="text-[11px] text-muted">{l.settlement_id ? "En liquidació" : "Pendent"}</span><span className={cn("w-24 text-right tnum", Number(l.amount) < 0 && "text-lost")}>{eur(l.amount)}</span></li>)}</ul>}
      </section>
    </div>
  );
}

type Collab = { id: string; name: string; email: string | null; terms: { legal_name: string | null; tax_id: string | null; billing_email: string | null; conditions: string | null; active: boolean } | null; clients: number; forecast: string; accrued: string; approved: string; paid: string; balance: string };
function Collaborators() {
  const [d, setD] = useState<{ rows: Collab[]; canManage: boolean } | null>(null);
  const [edit, setEdit] = useState<Collab | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => fApi.get<{ rows: Collab[]; canManage: boolean }>("collaborators").then(setD).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-4">
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <div className="h-32 animate-pulse rounded-2xl bg-elevated" /> : !d.rows.length ? <Empty icon={<Users size={24} />} title="No hi ha col·laboradors" body="Dona d'alta usuaris amb el rol Col·laborador a Configuració → Usuaris." /> : (
        <div className="overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Col·laborador</th><th className="text-right">Clients aportats</th><th className="text-right">Previstes</th><th className="text-right">Meritades</th><th className="text-right">Aprovades</th><th className="text-right">Pagades</th><th className="text-right">Saldo</th><th className="px-3" /></tr></thead>
            <tbody>{d.rows.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-3 py-2"><span className="font-medium">{c.name}</span>{c.terms?.legal_name && <span className="block text-[11.5px] text-muted">{c.terms.legal_name}{c.terms.tax_id ? ` · ${c.terms.tax_id}` : ""}</span>}{!c.terms?.conditions && <span className="block text-[11px] text-pend">Sense condicions comercials registrades</span>}</td>
                <td className="text-right tnum">{c.clients}</td><td className="text-right text-muted tnum">{eur(c.forecast)}</td><td className="text-right tnum">{eur(c.accrued)}</td><td className="text-right tnum">{eur(c.approved)}</td><td className="text-right tnum">{eur(c.paid)}</td>
                <td className={cn("text-right font-medium tnum", Number(c.balance) > 0 && "text-pend")}>{eur(c.balance)}</td>
                <td className="px-3 text-right">{d.canManage && <button className="text-brand" onClick={() => setEdit(c)} aria-label={`Fitxa de ${c.name}`}><PenLine size={13} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <ListTab kind="collaborador" />
      {edit && <CollabTerms c={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void load(); }} />}
    </div>
  );
}
function CollabTerms({ c, onClose, onDone }: { c: Collab; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ legal_name: c.terms?.legal_name ?? "", tax_id: c.terms?.tax_id ?? "", billing_email: c.terms?.billing_email ?? c.email ?? "", conditions: c.terms?.conditions ?? "", active: c.terms?.active ?? true });
  const save = async () => { try { await fApi.act("collab_terms", { id: c.id, data: { ...f, legal_name: f.legal_name || null, tax_id: f.tax_id || null, billing_email: f.billing_email || null, conditions: f.conditions || null } }); toast("Fitxa desada"); onDone(); } catch (e) { toast("No s'ha pogut desar", errMsg(e), "err"); } };
  return (
    <Modal open onClose={onClose} width="max-w-xl" title={`Fitxa del col·laborador · ${c.name}`} footer={<><Button variant="ghost" onClick={onClose}><X size={13} /> Cancel·la</Button><Button variant="primary" onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block"><span className="label">Raó social</span><input className="input" value={f.legal_name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /></label>
        <label className="block"><span className="label">NIF/CIF</span><input className="input font-mono uppercase" value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Correu de facturació</span><input className="input" value={f.billing_email} onChange={(e) => setF({ ...f, billing_email: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Condicions comercials pactades</span><textarea className="input min-h-[100px]" value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} placeholder="Text de l'acord. Els imports que es calculen surten de les regles de la capa «col·laborador» (Regles de comissions)." /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Actiu</label>
        <p className="text-[11.5px] text-muted sm:col-span-2">No es desen dades bancàries en text a la fitxa.</p>
      </div>
    </Modal>
  );
}
