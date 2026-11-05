"use client";
/**
 * FACTURA: editor d'esborranys (sense número) i fitxa de la factura emesa (bloquejada).
 * Emetre assigna el número a la base de dades (atòmic). Una emesa només es corregeix amb una rectificativa.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban, CheckCircle2, CircleDollarSign, Download, Eye, FileMinus2, Loader2, Lock, Mail, Plus, Save, Send, Trash2, X,
} from "lucide-react";
import { DISPLAY_STATUS_LABEL, DISPLAY_STATUS_TONE, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, VAT_RATES, computeTotals, type DisplayStatus, type PaymentMethod } from "@/core/billing";
import { useApp } from "@/data/store";
import { useSession, useCan } from "../../session";
import { Badge, Button, Field, Modal, Notice, cn } from "../../components/ui";
import { useCrumb } from "../../components/Navigation";
import { bApi, errMsg, eur, fmtD, toast, type BillClient, type Line } from "./api";

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (vat = "21"): Line => ({ description: "", quantity: "1", unitPrice: "", vatRate: vat, vatExemption: "" });

type Detail = {
  invoice: Record<string, unknown> & { id: string; invoice_no: string | null; status: string; display_status: DisplayStatus; kind: "ordinaria" | "rectificativa"; client_id: string; client_name: string; total: string; base: string; vat: string; paid: string; pending: string; issue_date: string | null; due_date: string | null; concept: string | null; period_label: string | null; period_from: string | null; period_to: string | null; order_ref_label: string | null; order_ref: string | null; notes: string | null; internal_notes: string | null; payment_unknown: boolean; needs_review: boolean; review_notes: string | null; origin: string; record_hash: string | null; sent_at: string | null; rectification_reason: string | null; client_snapshot: Record<string, string> | null; vat_breakdown: { rate: string; base: string; vat: string }[] };
  lines: { id: string; line_no: number; description: string; quantity: string; unit_price: string; vat_rate: string; vat_exemption: string | null; amount: string }[];
  payments: { id: string; amount: string; paid_at: string; method: string; reference: string | null; notes: string | null }[];
  emails: { id: string; to_email: string; subject: string; status: string; error: string | null; sent_at: string }[];
  statements: { id: string; retailer: string; reference: string; amount: string }[];
  statementLinks: { statement_id: string; amount: string }[];
  events: { id: number; at: string; actor_name: string | null; action: string; detail: Record<string, unknown> | null }[];
  rectifications: { id: string; invoice_no: string | null; status: string; total: string }[];
  client: BillClient | null; original: { id: string; invoice_no: string; issue_date: string | null } | null;
};

/* ======================================================================= vista «factura» */

export function InvoiceView() {
  const id = useApp((s) => s.params.id) ?? "";
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await bApi.get<Detail>("invoice", { id })); setErr(null); } catch (e) { setErr(errMsg(e)); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  useCrumb(d ? (d.invoice.invoice_no ? `Factura ${d.invoice.invoice_no}` : "Esborrany") : null);
  if (err) return <div className="mx-auto max-w-[1100px] px-4 py-6"><Notice tone="red">{err}</Notice></div>;
  if (!d) return <div className="flex h-60 items-center justify-center"><Loader2 className="animate-spin text-muted" /></div>;
  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-5 sm:px-6">
      {d.invoice.status === "esborrany" ? <InvoiceEditor detail={d} onSaved={load} /> : <IssuedInvoice d={d} reload={load} />}
    </div>
  );
}

/* ======================================================================= editor d'esborrany */

export function InvoiceEditor({ detail, onSaved }: { detail?: Detail; onSaved?: () => void }) {
  const go = useApp((s) => s.navigate);
  const canDo = useCan();
  const role = useSession((s) => s.role);
  const canIssue = canDo("facturacio", "approve") || role === "admin";
  const [clients, setClients] = useState<BillClient[]>([]);
  const [defaultVat, setDefaultVat] = useState("21");
  const inv = detail?.invoice;
  const [f, setF] = useState(() => ({
    clientId: inv?.client_id ?? "", concept: inv?.concept ?? "", periodLabel: inv?.period_label ?? "", periodFrom: inv?.period_from ?? "", periodTo: inv?.period_to ?? "",
    issueDate: inv?.issue_date ?? "", dueDate: inv?.due_date ?? "", orderRefLabel: inv?.order_ref_label ?? "", orderRef: inv?.order_ref ?? "", notes: inv?.notes ?? "", internalNotes: inv?.internal_notes ?? "",
  }));
  const [lines, setLines] = useState<Line[]>(() => detail?.lines.length ? detail.lines.map((l) => ({ description: l.description, quantity: String(Number(l.quantity)), unitPrice: String(Number(l.unit_price)), vatRate: String(Number(l.vat_rate)), vatExemption: l.vat_exemption ?? "" })) : [emptyLine()]);
  const [busy, setBusy] = useState<"" | "save" | "issue">("");
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const [del, setDel] = useState(false);
  useEffect(() => {
    bApi.get<{ rows: BillClient[] }>("clients").then((r) => setClients(r.rows)).catch((e) => setErr(errMsg(e)));
    bApi.get<{ settings: { default_vat_rate: string } | null }>("settings").then((r) => { if (r.settings) { const v = String(Number(r.settings.default_vat_rate)); setDefaultVat(v); if (!detail) setLines((ls) => ls.map((l) => (l.unitPrice ? l : { ...l, vatRate: v }))); } }).catch(() => undefined);
  }, [detail]);
  const client = clients.find((c) => c.id === f.clientId) ?? null;
  const totals = useMemo(() => computeTotals(lines.map((l) => ({ ...l, unitPrice: l.unitPrice.replace(",", ".") || "0", quantity: l.quantity.replace(",", ".") || "0" }))), [lines]);
  const setL = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const pickClient = (id: string) => { const c = clients.find((x) => x.id === id); setF((x) => ({ ...x, clientId: id, orderRefLabel: x.orderRefLabel || c?.order_ref_label || "", orderRef: x.orderRef || c?.order_ref || "" })); };
  const payload = () => ({
    ...f, periodFrom: f.periodFrom || null, periodTo: f.periodTo || null, issueDate: f.issueDate || null, dueDate: f.dueDate || null,
    origin: inv?.origin === "liquidacio" ? "liquidacio" : "manual",
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity.replace(",", "."), unitPrice: l.unitPrice.replace(",", "."), vatRate: l.vatRate, vatExemption: l.vatRate === "0" ? l.vatExemption || null : null })),
    statements: (detail?.statementLinks ?? []).map((s) => ({ statementId: s.statement_id, amount: String(s.amount) })),
  });
  const save = async (): Promise<string | null> => {
    setErr(null);
    if (!f.clientId) { setErr("Tria el client"); return null; }
    if (lines.some((l) => !l.description.trim() || !l.unitPrice.trim())) { setErr("Cada línia necessita descripció i preu"); return null; }
    if (lines.some((l) => l.vatRate === "0" && !l.vatExemption.trim())) { setErr("Les línies amb IVA 0 % necessiten la causa d'exempció (p. ex. «Exempt art. 20.1.16 LIVA»)"); return null; }
    try {
      const r = await bApi.act<{ id: string }>("draft_save", { id: inv?.id, data: payload() });
      return r.id;
    } catch (e) { setErr(errMsg(e)); return null; }
  };
  const onSave = async () => {
    setBusy("save");
    const id = await save();
    setBusy("");
    if (!id) return;
    toast("Esborrany desat", "Encara no té número: el rebrà en emetre'l.");
    if (!inv) go("factura", { id }); else onSaved?.();
  };
  const onIssue = async () => {
    setBusy("issue");
    const id = await save();
    if (!id) { setBusy(""); setConfirm(false); return; }
    try {
      const r = await bApi.act<{ number: string; total: string }>("issue", { id, data: { issueDate: f.issueDate || null } });
      toast(`Factura ${r.number} emesa`, `Total ${eur(r.total)}. Ja no es pot modificar.`);
      setConfirm(false);
      if (!inv) go("factura", { id }); else onSaved?.();
    } catch (e) { setErr(errMsg(e)); setConfirm(false); if (!inv) go("factura", { id }); }
    finally { setBusy(""); }
  };
  const onDelete = async () => {
    try { await bApi.act("draft_delete", { id: inv!.id }); toast("Esborrany eliminat"); go("facturacio", { tab: "esborranys" }); } catch (e) { toast("No s'ha pogut eliminar", errMsg(e), "err"); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">{inv ? (inv.kind === "rectificativa" ? "Esborrany de factura rectificativa" : "Esborrany de factura") : "Nova factura"} <Badge tone="zinc">Sense número fins que s&apos;emeti</Badge></h3>
          {inv?.origin === "liquidacio" && <p className="text-[12.5px] text-muted">Generada a partir d&apos;una liquidació{detail?.statements[0] ? `: ${detail.statements[0].retailer} · ${detail.statements[0].reference}` : ""}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {inv && <Button variant="ghost" onClick={() => setDel(true)}><Trash2 size={14} /> Elimina</Button>}
          {inv && <Button onClick={() => setPreview(true)}><Eye size={14} /> Previsualitza PDF</Button>}
          <Button onClick={() => void onSave()} disabled={!!busy}>{busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Desa esborrany</Button>
          {canIssue && <Button variant="primary" onClick={() => setConfirm(true)} disabled={!!busy || !f.clientId}><Lock size={14} /> Emet factura</Button>}
        </div>
      </div>
      {!canIssue && <Notice tone="blue">Pots preparar l&apos;esborrany. L&apos;emissió (assignar número) la fa Direcció o la Cap administrativa.</Notice>}
      {err && <Notice tone="red">{err}</Notice>}
      {client?.needs_review && <Notice tone="amber"><b>La fitxa d&apos;aquest client està marcada per revisar:</b> {client.review_notes}. No es podrà emetre fins que es corregeixi a «Clients de facturació».</Notice>}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
          <Field label="Client">
            <select className="input" value={f.clientId} onChange={(e) => pickClient(e.target.value)}>
              <option value="">Tria el client…</option>
              {clients.filter((c) => c.status === "actiu" || c.id === f.clientId).map((c) => <option key={c.id} value={c.id}>{c.legal_name} · {c.nif || "sense CIF"}{c.needs_review ? " ⚠" : ""}</option>)}
            </select>
          </Field>
          {client && <p className="-mt-1 text-[12px] text-muted">{[client.address, [client.postal_code, client.city].filter(Boolean).join(" "), client.province].filter(Boolean).join(" · ")}{client.billing_email ? ` · ${client.billing_email}` : ""}</p>}
          <Field label="Concepte de facturació"><input className="input" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} placeholder="p. ex. Comissions liquidació octubre 2026" /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Període (text)"><input className="input" value={f.periodLabel} onChange={(e) => setF({ ...f, periodLabel: e.target.value })} placeholder="Octubre 2026" /></Field>
            <Field label="Període des de"><input type="date" className="input" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} /></Field>
            <Field label="Període fins a"><input type="date" className="input" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} /></Field>
          </div>
          <div>
            <span className="label">Línies</span>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 items-start gap-2 rounded-xl border border-line p-2">
                  <textarea className="input col-span-12 min-h-[38px] sm:col-span-5" rows={1} placeholder="Descripció del servei" value={l.description} onChange={(e) => setL(i, "description", e.target.value)} />
                  <input className="input col-span-3 text-right sm:col-span-1" inputMode="decimal" aria-label="Quantitat" value={l.quantity} onChange={(e) => setL(i, "quantity", e.target.value)} />
                  <input className="input col-span-4 text-right sm:col-span-2" inputMode="decimal" aria-label="Preu unitari" placeholder="Preu €" value={l.unitPrice} onChange={(e) => setL(i, "unitPrice", e.target.value)} />
                  <select className="input col-span-3 sm:col-span-1" aria-label="IVA" value={l.vatRate} onChange={(e) => setL(i, "vatRate", e.target.value)}>{[...new Set([...VAT_RATES, l.vatRate, defaultVat])].map((v) => <option key={v} value={v}>{v} %</option>)}</select>
                  <div className="col-span-10 self-center text-right text-[13px] font-medium tabular-nums sm:col-span-2">{eur(totals.lines[i]?.amount)}</div>
                  <button type="button" className="col-span-2 self-center justify-self-end rounded p-1 text-muted hover:text-lost sm:col-span-1" aria-label="Treu la línia" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}><X size={15} /></button>
                  {l.vatRate === "0" && <input className="input col-span-12" placeholder="Causa d'exempció d'IVA (obligatòria)" value={l.vatExemption} onChange={(e) => setL(i, "vatExemption", e.target.value)} />}
                </div>
              ))}
            </div>
            <Button size="sm" className="mt-2" onClick={() => setLines([...lines, emptyLine(defaultVat)])}><Plus size={13} /> Afegeix línia</Button>
          </div>
          <Field label="Observacions (surten a la factura)"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Field label="Notes internes (no surten a la factura)"><textarea className="input" rows={2} value={f.internalNotes} onChange={(e) => setF({ ...f, internalNotes: e.target.value })} /></Field>
        </section>
        <aside className="space-y-3">
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <Field label="Data d'emissió" hint="Buit = el dia que s'emeti"><input type="date" className="input" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} /></Field>
            <Field label="Venciment" hint={client?.due_days != null ? `Per defecte: ${client.due_days} dies` : "Per defecte: segons la configuració"}><input type="date" className="input" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Referència"><input className="input" placeholder="ALBARÀ / PEDIDO" value={f.orderRefLabel} onChange={(e) => setF({ ...f, orderRefLabel: e.target.value })} /></Field>
              <Field label="Número"><input className="input" value={f.orderRef} onChange={(e) => setF({ ...f, orderRef: e.target.value })} /></Field>
            </div>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4 text-[13px]">
            {totals.breakdown.map((b) => (
              <div key={b.rate} className="space-y-1 border-b border-line pb-2 last:border-0">
                <div className="flex justify-between"><span className="text-muted">Base imposable{totals.breakdown.length > 1 ? ` (${Number(b.rate)} %)` : ""}</span><span className="tabular-nums">{eur(b.base)}</span></div>
                <div className="flex justify-between"><span className="text-muted">IVA {Number(b.rate)} %</span><span className="tabular-nums">{eur(b.vat)}</span></div>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between rounded-xl bg-ren/10 px-3 py-2 text-ren"><span className="font-semibold">Total factura</span><span className="text-lg font-semibold tabular-nums">{eur(totals.total)}</span></div>
          </section>
        </aside>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Emetre la factura" footer={<><Button onClick={() => setConfirm(false)}>Cancel·la</Button><Button variant="primary" disabled={!!busy} onClick={() => void onIssue()}>{busy === "issue" ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Emet ara</Button></>}>
        <div className="space-y-2 text-[13px]">
          <p>Es desarà l&apos;esborrany i se li assignarà el <b>següent número correlatiu</b>. Un cop emesa:</p>
          <ul className="list-disc pl-5 text-muted"><li>no es podrà modificar ni eliminar;</li><li>qualsevol correcció es farà amb una factura rectificativa;</li><li>conservarà les dades fiscals actuals del client.</li></ul>
          <div className="rounded-xl border border-line p-3"><div className="font-medium">{client?.legal_name ?? "—"}</div><div className="text-muted">{f.concept || "Sense concepte"}</div><div className="mt-1 text-lg font-semibold tabular-nums">{eur(totals.total)}</div></div>
        </div>
      </Modal>
      <Modal open={del} onClose={() => setDel(false)} title="Eliminar l'esborrany" footer={<><Button onClick={() => setDel(false)}>Cancel·la</Button><Button variant="danger" onClick={() => void onDelete()}><Trash2 size={14} /> Elimina</Button></>}>
        <p className="text-[13px]">L&apos;esborrany no té número, així que es pot eliminar sense deixar cap forat a la numeració.</p>
      </Modal>
      {inv && <PdfModal open={preview} onClose={() => setPreview(false)} id={inv.id} title="Previsualització de l'esborrany" />}
    </div>
  );
}

function PdfModal({ open, onClose, id, title }: { open: boolean; onClose: () => void; id: string; title: string }) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-4xl" footer={<a href={bApi.pdfUrl(id)}><Button><Download size={14} /> Descarrega</Button></a>}>
      {open && <iframe title={title} src={bApi.pdfUrl(id, true)} className="h-[70vh] w-full rounded-lg border border-line bg-white" />}
    </Modal>
  );
}

/* ======================================================================= factura emesa */

const ACTION_LABEL: Record<string, string> = { emissio: "Emesa", cobrament: "Cobrament registrat", rectificativa_preparada: "Rectificativa preparada" };

function IssuedInvoice({ d, reload }: { d: Detail; reload: () => void }) {
  const i = d.invoice;
  const go = useApp((s) => s.navigate);
  const canDo = useCan();
  const role = useSession((s) => s.role);
  const canApprove = canDo("facturacio", "approve") || role === "admin";
  const canEdit = canDo("facturacio", "edit") || role === "admin";
  const [modal, setModal] = useState<"" | "pay" | "mail" | "rect" | "pdf">("");
  const snap = i.client_snapshot ?? {};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-2xl font-semibold tracking-tight">{i.invoice_no}</h3>
            <Badge tone={DISPLAY_STATUS_TONE[i.display_status]}>{DISPLAY_STATUS_LABEL[i.display_status]}</Badge>
            {i.kind === "rectificativa" && <Badge tone="amber">Rectificativa</Badge>}
            {i.origin === "excel_historic" && <Badge tone="zinc">Importada de l&apos;Excel</Badge>}
            {i.sent_at && <Badge tone="blue"><Mail size={11} /> Enviada {fmtD(i.sent_at)}</Badge>}
            <span className="inline-flex items-center gap-1 text-[11.5px] text-muted"><Lock size={11} /> Bloquejada</span>
          </div>
          <p className="mt-1 text-[13px] text-muted">{i.client_name} · emesa el {fmtD(i.issue_date)}{i.due_date ? ` · venç el ${fmtD(i.due_date)}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setModal("pdf")}><Eye size={14} /> Veure PDF</Button>
          <a href={bApi.pdfUrl(i.id)}><Button><Download size={14} /> PDF</Button></a>
          {canEdit && <Button onClick={() => setModal("mail")}><Send size={14} /> Envia per correu</Button>}
          {canApprove && !["cobrada", "rectificada"].includes(i.status) && Number(i.pending) !== 0 && <Button variant="primary" onClick={() => setModal("pay")}><CircleDollarSign size={14} /> Registra cobrament</Button>}
          {canEdit && i.kind === "ordinaria" && i.status !== "rectificada" && <Button variant="ghost" onClick={() => setModal("rect")}><FileMinus2 size={14} /> Rectifica</Button>}
        </div>
      </div>
      {i.needs_review && <Notice tone="amber"><b>Per revisar:</b> {i.review_notes} {canEdit && <ReviewButton id={i.id} onDone={reload} />}</Notice>}
      {i.payment_unknown && <Notice tone="blue">Factura importada de l&apos;Excel: no consta si està cobrada. Registra el cobrament quan ho comprovis (o marca-la des del llistat amb altres factures).</Notice>}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
          <div className="grid gap-4 text-[13px] sm:grid-cols-2">
            <div><div className="label">Client (dades en el moment de l&apos;emissió)</div><div className="font-medium">{snap.legal_name ?? i.client_name}</div><div className="text-muted">CIF {snap.nif}</div><div className="text-muted">{snap.address}</div><div className="text-muted">{[snap.postal_code, snap.city].filter(Boolean).join(" ")} {snap.province && snap.province !== snap.city ? `(${snap.province})` : ""}</div>
              <button className="mt-1 text-[12px] text-ren underline" onClick={() => go("facturacio", { tab: "clients", id: i.client_id })}>Fitxa del client</button></div>
            <div className="space-y-1">
              <div className="label">Concepte</div><div className="font-medium">{i.concept}</div>
              {i.period_label && <div className="text-muted">Període: {i.period_label}</div>}
              {i.order_ref && <div className="text-muted">{i.order_ref_label}: {i.order_ref}</div>}
              {d.original && <div className="text-muted">Rectifica: <button className="underline" onClick={() => go("factura", { id: d.original!.id })}>{d.original.invoice_no}</button> · {i.rectification_reason}</div>}
              {d.rectifications.map((r) => <div key={r.id} className="text-muted">Rectificada per: <button className="underline" onClick={() => go("factura", { id: r.id })}>{r.invoice_no ?? "esborrany"}</button> ({eur(r.total)})</div>)}
              {d.statements.map((s) => <div key={s.id} className="text-muted">Liquidació: {s.retailer} · {s.reference} ({eur(s.amount)})</div>)}
            </div>
          </div>
          <table className="mt-4 w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="py-1.5">Descripció</th><th className="text-right">Quant.</th><th className="text-right">Preu</th><th className="text-right">IVA</th><th className="text-right">Import</th></tr></thead>
            <tbody>{d.lines.map((l) => <tr key={l.id} className="border-t border-line"><td className="py-1.5">{l.description}{l.vat_exemption && <div className="text-[11px] text-muted">{l.vat_exemption}</div>}</td><td className="text-right tabular-nums">{Number(l.quantity)}</td><td className="text-right tabular-nums">{eur(l.unit_price)}</td><td className="text-right">{Number(l.vat_rate)} %</td><td className="text-right tabular-nums">{eur(l.amount)}</td></tr>)}</tbody>
          </table>
          <div className="ml-auto mt-3 max-w-xs space-y-1 text-[13px]">
            {(i.vat_breakdown ?? []).map((b) => <div key={String(b.rate)}><div className="flex justify-between"><span className="text-muted">Base{i.vat_breakdown.length > 1 ? ` ${Number(b.rate)} %` : ""}</span><span className="tabular-nums">{eur(b.base)}</span></div><div className="flex justify-between"><span className="text-muted">IVA {Number(b.rate)} %</span><span className="tabular-nums">{eur(b.vat)}</span></div></div>)}
            <div className="flex justify-between rounded-lg bg-ren/10 px-2 py-1.5 font-semibold text-ren"><span>Total</span><span className="tabular-nums">{eur(i.total)}</span></div>
          </div>
          {i.record_hash && <p className="mt-3 break-all font-mono text-[10.5px] text-muted" title="Empremta encadenada amb la factura anterior de la sèrie">Empremta: {i.record_hash}</p>}
        </section>
        <aside className="space-y-3">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h4 className="text-sm font-semibold">Cobraments</h4>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12.5px]"><div><div className="text-muted">Cobrat</div><div className="font-semibold tabular-nums text-ren">{eur(i.paid)}</div></div><div><div className="text-muted">Pendent</div><div className="font-semibold tabular-nums">{i.payment_unknown ? "No consta" : eur(i.pending)}</div></div></div>
            <ul className="mt-3 space-y-1.5 text-[12.5px]">{d.payments.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{fmtD(p.paid_at)} · {PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular-nums">{eur(p.amount)}</span></li>)}{!d.payments.length && <li className="text-muted">Cap cobrament registrat.</li>}</ul>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h4 className="text-sm font-semibold">Enviaments</h4>
            <ul className="mt-2 space-y-1.5 text-[12.5px]">{d.emails.map((m) => <li key={m.id}><span className={cn("mr-1", m.status === "acceptat" ? "text-ren" : "text-lost")}>{m.status === "acceptat" ? <CheckCircle2 size={12} className="inline" /> : <Ban size={12} className="inline" />}</span>{fmtD(m.sent_at)} · {m.to_email}{m.error && <div className="text-[11px] text-lost">{m.error}</div>}</li>)}{!d.emails.length && <li className="text-muted">Encara no s&apos;ha enviat.</li>}</ul>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h4 className="text-sm font-semibold">Registre</h4>
            <ul className="mt-2 space-y-1 text-[12px] text-muted">{d.events.map((e) => <li key={e.id}>{fmtD(e.at)} · {ACTION_LABEL[e.action] ?? e.action}{e.actor_name ? ` · ${e.actor_name}` : ""}</li>)}{!d.events.length && <li>—</li>}</ul>
          </section>
        </aside>
      </div>
      <PdfModal open={modal === "pdf"} onClose={() => setModal("")} id={i.id} title={`Factura ${i.invoice_no}`} />
      <PaymentModal open={modal === "pay"} onClose={() => setModal("")} d={d} onDone={() => { setModal(""); reload(); }} />
      <MailModal open={modal === "mail"} onClose={() => setModal("")} d={d} onDone={() => { setModal(""); reload(); }} />
      <RectifyModal open={modal === "rect"} onClose={() => setModal("")} d={d} />
    </div>
  );
}

function ReviewButton({ id, onDone }: { id: string; onDone: () => void }) {
  return <button className="ml-1 underline" onClick={() => void bApi.act("review", { id, data: { reviewed: true, internalNotes: null } }).then(() => { toast("Marcada com a revisada"); onDone(); }).catch((e) => toast("No s'ha pogut", errMsg(e), "err"))}>Marca-la com a revisada</button>;
}

function PaymentModal({ open, onClose, d, onDone }: { open: boolean; onClose: () => void; d: Detail; onDone: () => void }) {
  const [f, setF] = useState({ amount: "", paidAt: today(), method: "transferencia", reference: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setF((x) => ({ ...x, amount: String(Number(d.invoice.pending).toFixed(2)) })); }, [open, d.invoice.pending]);
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await bApi.act<{ status: string }>("payment", { id: d.invoice.id, data: { ...f, amount: f.amount.replace(",", "."), reference: f.reference || null, notes: f.notes || null } }); toast("Cobrament registrat", r.status === "cobrada" ? "La factura queda cobrada." : "Cobrament parcial."); onDone(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Cobrament de la factura ${d.invoice.invoice_no}`} footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CircleDollarSign size={14} />} Registra</Button></>}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">Total {eur(d.invoice.total)} · cobrat {eur(d.invoice.paid)} · pendent <b className="text-ink">{eur(d.invoice.pending)}</b></p>
        {err && <Notice tone="red">{err}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Import (€)"><input className="input text-right" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Data"><input type="date" className="input" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></Field>
          <Field label="Forma de pagament"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}</select></Field>
          <Field label="Referència bancària"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function MailModal({ open, onClose, d, onDone }: { open: boolean; onClose: () => void; d: Detail; onDone: () => void }) {
  const i = d.invoice;
  const [f, setF] = useState({ to: "", cc: "", subject: "", body: "", saveAsDefault: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    bApi.get<{ settings: { email_subject_tpl: string | null; email_body_tpl: string | null; issuer_name: string } | null }>("settings").then((r) => {
      const s = r.settings;
      const fill = (t: string) => t.replace(/\{numero\}/g, i.invoice_no ?? "").replace(/\{client\}/g, i.client_name).replace(/\{total\}/g, eur(i.total)).replace(/\{venciment\}/g, fmtD(i.due_date)).replace(/\{concepte\}/g, i.concept ?? "");
      setF({
        to: d.client?.billing_email ?? "", cc: "", saveAsDefault: !d.client?.billing_email,
        subject: fill(s?.email_subject_tpl || "Factura {numero} · Assessoria 3.0"),
        body: fill(s?.email_body_tpl || "Bon dia,\n\nUs adjuntem la factura {numero} corresponent a «{concepte}», per un import total de {total}, amb venciment el {venciment}.\n\nGràcies per la vostra confiança.\n\nAssessoria 3.0 AE, SL"),
      });
    }).catch(() => undefined);
  }, [open, i, d.client]);
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await bApi.act<{ from: string }>("send", { id: i.id, data: { to: f.to, cc: f.cc.split(/[,;\s]+/).filter(Boolean), subject: f.subject, body: f.body, saveAsDefault: f.saveAsDefault } }); toast("Factura enviada", `Des de ${r.from}. El servidor de correu l'ha acceptada.`); onDone(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title={`Enviar la factura ${i.invoice_no}`} footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.to} onClick={() => void run()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Envia</Button></>}>
      <div className="space-y-3">
        <Notice tone="blue">S&apos;envia des del teu correu configurat a «El meu perfil», amb el PDF adjunt. Només es marca com a enviada si el servidor de correu l&apos;accepta.</Notice>
        {err && <Notice tone="red">{err}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Per a"><input className="input" type="email" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Còpia (opcional)"><input className="input" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={f.saveAsDefault} onChange={(e) => setF({ ...f, saveAsDefault: e.target.checked })} /> Desa aquest correu com a correu de facturació del client</label>
        <Field label="Assumpte"><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Missatge"><textarea className="input" rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function RectifyModal({ open, onClose, d }: { open: boolean; onClose: () => void; d: Detail }) {
  const go = useApp((s) => s.navigate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await bApi.act<{ id: string }>("rectify", { id: d.invoice.id, data: { reason } }); toast("Rectificativa preparada", "Revisa l'esborrany (sèrie R) i emet-lo."); go("factura", { id: r.id }); }
    catch (e) { toast("No s'ha pogut preparar", errMsg(e), "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Rectificar la factura ${d.invoice.invoice_no}`} footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || reason.trim().length < 5} onClick={() => void run()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FileMinus2 size={14} />} Prepara la rectificativa</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p>Es crearà un <b>esborrany de factura rectificativa</b> (sèrie R) amb les línies en negatiu. Podràs ajustar-lo abans d&apos;emetre&apos;l (p. ex. rectificar només la diferència). La factura original no es modifica: quedarà marcada com a «rectificada» quan s&apos;emeti la rectificativa.</p>
        <Field label="Motiu de la rectificació"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="p. ex. Error en l'import de les comissions liquidades" /></Field>
      </div>
    </Modal>
  );
}

