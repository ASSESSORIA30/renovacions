"use client";
/**
 * CONFIGURACIÓ DE FACTURACIÓ (dades de l'emissor, IBAN, logotip, plantilla de correu, numeració i números per verificar)
 * i CONCILIACIONS PENDENTS DE FACTURAR (botó «Generar factura» a partir d'una liquidació).
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, CheckCircle2, FilePlus2, Hash, ImageUp, Loader2, Lock, RefreshCw, Save } from "lucide-react";
import { LOGO_DATA_URL } from "@/core/logo";
import { useApp } from "@/data/store";
import { useCan, useSession } from "../../session";
import { Badge, Button, Empty, Field, Modal, Notice } from "../../components/ui";
import { bApi, errMsg, eur, fmtD, toast, type BillClient } from "./api";

type Settings = Record<string, string | number | null>;
type Gap = { series: string; year: number; number: number; invoice_no: string; status: string; notes: string | null; resolved_at: string | null };
type SettingsRes = { settings: Settings | null; gaps: Gap[]; series: { code: string; year: number; last_number: number }[]; canEdit: boolean };

export function BillingSettingsTab() {
  const [d, setD] = useState<SettingsRes | null>(null);
  const [f, setF] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gap, setGap] = useState<Gap | null>(null);
  const canDo = useCan();
  const role = useSession((s) => s.role);
  const canApprove = canDo("facturacio", "approve") || role === "admin";
  const load = useCallback(async () => { try { const r = await bApi.get<SettingsRes>("settings"); setD(r); setF(r.settings); setErr(null); } catch (e) { setErr(errMsg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const ro = !d?.canEdit;
  const t = (k: string) => ({ value: String(f?.[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => (x ? { ...x, [k]: e.target.value } : x)), disabled: ro });
  const save = async () => {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      await bApi.act("settings_save", { data: { ...f, default_vat_rate: String(f.default_vat_rate ?? "21"), default_due_days: Number(f.default_due_days ?? 30), id: undefined, updated_by: undefined, updated_at: undefined } });
      toast("Configuració desada"); void load();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const logo = (file: File) => {
    if (file.type !== "image/png") { toast("El logotip ha de ser PNG", undefined, "err"); return; }
    if (file.size > 400_000) { toast("Logotip massa gran", "Màxim 400 KB", "err"); return; }
    const r = new FileReader(); r.onload = () => setF((x) => (x ? { ...x, logo_path: String(r.result) } : x)); r.readAsDataURL(file);
  };
  if (err && !d) return <Notice tone={/migració/.test(err) ? "amber" : "red"}>{err}</Notice>;
  if (!d || !f) return d && !f ? <Notice tone="amber">Encara no hi ha configuració de l&apos;emissor. Executa la migració 027 (dades de l&apos;Excel) o demana-ho a Direcció.</Notice> : <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Dades de l&apos;emissor</h3>{ro && <Badge tone="zinc"><Lock size={11} /> Només Direcció les pot canviar</Badge>}</div>
        {err && <Notice tone="red">{err}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Raó social"><input className="input" {...t("issuer_name")} /></Field>
          <Field label="CIF"><input className="input font-mono" {...t("issuer_nif")} /></Field>
          <Field label="Adreça"><input className="input" {...t("issuer_address")} /></Field>
          <div className="grid grid-cols-3 gap-2"><Field label="CP"><input className="input" {...t("issuer_postal_code")} /></Field><div className="col-span-2"><Field label="Població"><input className="input" {...t("issuer_city")} /></Field></div></div>
          <Field label="Província"><input className="input" {...t("issuer_province")} /></Field>
          <Field label="Correu (surt a la factura)"><input className="input" {...t("issuer_email")} /></Field>
          <Field label="Telèfon (surt a la factura)"><input className="input" {...t("issuer_phone")} /></Field>
          <Field label="Compte bancari (IBAN)" hint="Surt a cada factura nova. Canviar-lo queda registrat."><input className="input font-mono" {...t("iban")} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="IVA per defecte (%)"><input className="input" {...t("default_vat_rate")} /></Field><Field label="Venciment (dies)"><input className="input" value={f.default_due_days ?? ""} disabled={ro} onChange={(e) => setF({ ...f, default_due_days: Number(e.target.value) || 0 })} /></Field></div>
          <Field label="Peu de la factura (opcional)"><input className="input" {...t("footer_text")} /></Field>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-line p-3">
          <img src={typeof f.logo_path === "string" && f.logo_path.startsWith("data:image/png") ? f.logo_path : LOGO_DATA_URL} alt="Logotip" className="h-14 w-14 object-contain" />
          <div className="text-[12.5px]"><div className="font-medium">Logotip de les factures</div><div className="text-muted">Per defecte, el logotip oficial que ja fa servir el CRM. Pots pujar el PNG original si en tens una versió millor.</div>
            {!ro && <label className="mt-1 inline-flex cursor-pointer items-center gap-1 text-ren underline"><ImageUp size={13} /> Puja PNG<input type="file" accept="image/png" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) logo(x); }} /></label>}</div>
        </div>
        <h3 className="pt-2 text-sm font-semibold">Plantilla del correu</h3>
        <p className="text-[12px] text-muted">Pots fer servir {"{numero}"}, {"{client}"}, {"{total}"}, {"{venciment}"} i {"{concepte}"}.</p>
        <Field label="Assumpte"><input className="input" {...t("email_subject_tpl")} placeholder="Factura {numero} · Assessoria 3.0" /></Field>
        <Field label="Missatge"><textarea className="input" rows={5} {...t("email_body_tpl")} /></Field>
        {!ro && <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Desa</Button></div>}
      </section>
      <aside className="space-y-3">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Hash size={14} /> Numeració</h3>
          <p className="mt-1 text-[12px] text-muted">Es gestiona a Supabase amb una reserva atòmica: dues persones que emeten alhora reben números diferents. Els esborranys no consumeixen número.</p>
          <ul className="mt-2 space-y-1 text-[12.5px]">{d.series.map((s) => <li key={`${s.code}${s.year}`} className="flex justify-between"><span>{s.code === "ORD" ? "Ordinàries" : "Rectificatives"} {s.year}</span><span className="font-mono">última {s.code === "REC" ? "R" : ""}{String(s.year % 100).padStart(2, "0")}-{String(s.last_number).padStart(3, "0")}</span></li>)}</ul>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold">Números per verificar</h3>
          <p className="mt-1 text-[12px] text-muted">Consten com a consumits a l&apos;Excel però no hi ha la factura. Mai es reutilitzaran.</p>
          <ul className="mt-2 space-y-2 text-[12.5px]">{d.gaps.map((g) => (
            <li key={g.invoice_no} className="rounded-lg border border-line p-2">
              <div className="flex items-center justify-between"><span className="font-mono font-medium">{g.invoice_no}</span><Badge tone={g.status === "pendent_verificar" ? "amber" : "green"}>{g.status === "pendent_verificar" ? "Pendent" : g.status}</Badge></div>
              {g.notes && <div className="mt-1 text-[11.5px] text-muted">{g.notes}</div>}
              {canApprove && g.status === "pendent_verificar" && <button className="mt-1 text-[12px] text-ren underline" onClick={() => setGap(g)}>Registrar què s&apos;ha comprovat</button>}
            </li>
          ))}{!d.gaps.length && <li className="text-muted">Cap.</li>}</ul>
        </section>
      </aside>
      {gap && <GapModal g={gap} onClose={() => setGap(null)} onDone={() => { setGap(null); void load(); }} />}
    </div>
  );
}

function GapModal({ g, onClose, onDone }: { g: Gap; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState("anullada");
  const [notes, setNotes] = useState("");
  const run = async () => {
    try { await bApi.act("gap_resolve", { data: { series: g.series, year: g.year, number: g.number, status, notes } }); toast(`Número ${g.invoice_no} registrat`); onDone(); }
    catch (e) { toast("No s'ha pogut desar", errMsg(e), "err"); }
  };
  return (
    <Modal open onClose={onClose} title={`Número ${g.invoice_no}`} footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={notes.trim().length < 3} onClick={() => void run()}>Desa</Button></>}>
      <div className="space-y-3 text-[13px]">
        <Field label="Resultat"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="anullada">Es va anul·lar (no s&apos;ha d&apos;emetre mai)</option><option value="localitzada">S&apos;ha localitzat la factura (cal donar-la d&apos;alta)</option><option value="verificada">Verificat amb la gestoria</option></select></Field>
        <Field label="Què s'ha comprovat"><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-[12px] text-muted">El número continua bloquejat: el CRM no el reutilitzarà en cap cas.</p>
      </div>
    </Modal>
  );
}

/* ======================================================================= liquidacions → factura */

type StRow = { id: string; retailer: string; reference: string; period_from: string | null; period_to: string | null; received_at: string; status: string; declared_total: string | null; summary: { lines: number; positives: string; negatives: string; billable: string; invoiced: string; drafts: string; pending: string; doubtful: number }; client: { id: string; name: string } | null; state: "pendent" | "parcial" | "facturada" | "sense_import" };
type Proposal = { statement: { id: string; retailer: string; reference: string }; summary: StRow["summary"]; client: { id: string; name: string; nif: string } | null; proposal: { concept: string; periodLabel: string; base: string; vat: string; total: string; warnings: string[] }; draftId?: string };
const ST_LABEL = { pendent: "Pendent de facturar", parcial: "Facturada en part", facturada: "Facturada", sense_import: "Sense import" } as const;
const ST_TONE = { pendent: "amber", parcial: "blue", facturada: "green", sense_import: "zinc" } as const;

export function StatementsTab() {
  const [d, setD] = useState<{ rows: StRow[]; allowed: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [only, setOnly] = useState(true);
  const [open, setOpen] = useState<StRow | null>(null);
  const go = useApp((s) => s.navigate);
  const load = useCallback(async () => { try { setD(await bApi.get("statements")); setErr(null); } catch (e) { setErr(errMsg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <Notice tone={/migració/.test(err) ? "amber" : "red"}>{err}</Notice>;
  if (!d) return <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>;
  if (!d.allowed) return <Notice tone="blue">Per facturar liquidacions cal tenir accés a la conciliació (dades econòmiques restringides).</Notice>;
  const rows = d.rows.filter((r) => !only || r.state === "pendent" || r.state === "parcial");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Només les pendents de facturar</label>
        <Button size="sm" className="ml-auto" onClick={() => void load()}><RefreshCw size={13} /> Actualitza</Button>
        <Button size="sm" onClick={() => go("conciliacio")}><ArrowRightLeft size={13} /> Anar a la conciliació</Button>
      </div>
      <Notice tone="blue">L&apos;import a facturar es calcula de manera determinista amb les línies de la liquidació (comissions menys retrocessions, sense duplicats ni línies descartades) i el que ja s&apos;ha facturat. Res es desa fins que no generes l&apos;esborrany.</Notice>
      <div className="overflow-auto rounded-2xl border border-line bg-surface">
        {!rows.length ? <Empty icon={<CheckCircle2 size={24} />} title="No hi ha liquidacions pendents de facturar" /> : (
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Comercialitzadora</th><th>Referència</th><th className="hidden md:table-cell">Període</th><th className="text-right">Comissions</th><th className="hidden text-right sm:table-cell">Retrocessions</th><th className="text-right">Facturat</th><th className="text-right">Pendent</th><th>Estat</th><th className="px-3" /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2 font-medium">{r.retailer}<div className="text-[11px] font-normal text-muted">{r.client ? `→ ${r.client.name}` : "Client de facturació no identificat"}</div></td>
                <td className="font-mono">{r.reference}</td>
                <td className="hidden md:table-cell">{r.period_from ? `${fmtD(r.period_from)} – ${fmtD(r.period_to)}` : fmtD(r.received_at)}</td>
                <td className="text-right tabular-nums">{eur(r.summary.positives)}</td>
                <td className="hidden text-right tabular-nums text-lost sm:table-cell">{Number(r.summary.negatives) ? eur(r.summary.negatives) : "—"}</td>
                <td className="text-right tabular-nums">{eur(r.summary.invoiced)}</td>
                <td className="text-right font-medium tabular-nums">{eur(r.summary.pending)}</td>
                <td><Badge tone={ST_TONE[r.state]}>{ST_LABEL[r.state]}</Badge>{r.summary.doubtful > 0 && <div className="text-[11px] text-amber-600">{r.summary.doubtful} línies per revisar</div>}</td>
                <td className="px-3 text-right">{Number(r.summary.pending) > 0 && <Button size="sm" variant="primary" onClick={() => setOpen(r)}><FilePlus2 size={13} /> Generar factura</Button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {open && <FromStatementModal st={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FromStatementModal({ st, onClose }: { st: StRow; onClose: () => void }) {
  const go = useApp((s) => s.navigate);
  const [clients, setClients] = useState<BillClient[]>([]);
  const [clientId, setClientId] = useState(st.client?.id ?? "");
  const [amount, setAmount] = useState(String(Number(st.summary.pending).toFixed(2)));
  const [vat, setVat] = useState("21");
  const [p, setP] = useState<Proposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { bApi.get<{ rows: BillClient[] }>("clients", { status: "actiu" }).then((r) => setClients(r.rows)).catch(() => undefined); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      bApi.act<Proposal>("from_statement", { data: { statementId: st.id, clientId: clientId || null, vatRate: vat, amount: amount.replace(",", ".") || null, confirm: false } }).then((r) => { setP(r); setErr(null); if (!clientId && r.client) setClientId(r.client.id); }).catch((e) => setErr(errMsg(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [st.id, clientId, vat, amount]);
  const run = async () => {
    setBusy(true);
    try { const r = await bApi.act<Proposal>("from_statement", { data: { statementId: st.id, clientId, vatRate: vat, amount: amount.replace(",", "."), confirm: true } }); toast("Esborrany de factura generat", "Revisa'l i emet-lo."); go("factura", { id: r.draftId! }); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={`Generar factura · ${st.retailer} · ${st.reference}`} footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !clientId || !p || Number(p.proposal.base) <= 0} onClick={() => void run()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />} Generar esborrany</Button></>}>
      <div className="space-y-3 text-[13px]">
        {err && <Notice tone="red">{err}</Notice>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3"><Field label="Destinatari fiscal (qui paga)"><select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Tria el client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name} · {c.nif}{c.needs_review ? " ⚠" : ""}</option>)}</select></Field></div>
          <Field label="Base a facturar (€)" hint={`Pendent: ${eur(st.summary.pending)}`}><input className="input text-right" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="IVA"><select className="input" value={vat} onChange={(e) => setVat(e.target.value)}>{["21", "10", "4", "0"].map((v) => <option key={v} value={v}>{v} %</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3 sm:grid-cols-4">
          <div><div className="text-[11px] text-muted">Comissions</div><div className="tabular-nums">{eur(st.summary.positives)}</div></div>
          <div><div className="text-[11px] text-muted">Retrocessions</div><div className="tabular-nums text-lost">{eur(st.summary.negatives)}</div></div>
          <div><div className="text-[11px] text-muted">Ja facturat</div><div className="tabular-nums">{eur(st.summary.invoiced)}</div></div>
          <div><div className="text-[11px] text-muted">Pendent</div><div className="font-semibold tabular-nums">{eur(st.summary.pending)}</div></div>
        </div>
        {p && (
          <div className="rounded-xl bg-ren/5 p-3">
            <div className="font-medium">{p.proposal.concept}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 tabular-nums"><div><div className="text-[11px] text-muted">Base</div>{eur(p.proposal.base)}</div><div><div className="text-[11px] text-muted">IVA {vat} %</div>{eur(p.proposal.vat)}</div><div><div className="text-[11px] text-muted">Total</div><b>{eur(p.proposal.total)}</b></div></div>
            {p.proposal.warnings.map((w, i) => <p key={i} className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">⚠ {w}</p>)}
          </div>
        )}
        <p className="text-[12px] text-muted">Es crea un <b>esborrany</b> vinculat a la liquidació. El número s&apos;assigna en emetre&apos;l. Si la liquidació ja s&apos;ha facturat, l&apos;emissió es bloqueja.</p>
      </div>
    </Modal>
  );
}
