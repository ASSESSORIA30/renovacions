"use client";
/** FITXA D'EXPEDIENT: tot el cicle de contractació d'un servei, de la proposta acceptada a l'activació. */
import { DropArea } from "../../components/DropZone";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Ban, Building2, Check, CheckCircle2, ChevronRight, CircleDashed, Clock, Eye, FileCheck2, FilePlus2, FileSignature, FileText, History, Link2, Loader2,
  Lock, PenLine, Plus, RefreshCw, Send, ShieldCheck, Upload, X, XCircle, Zap,
} from "lucide-react";
import {
  ACCRUAL_LABEL, ACTIVATION_SOURCE_LABEL, DATA_FIELD_LABEL, EXP_STATUS_LABEL, FLOW, PAYMENT_LABEL, PROCEDURE_LABEL, REQ_STATUS_LABEL, SALES_STATUSES, SIGNATURE_STATUS_LABEL,
  allowedTransitions, conditionsRows, type DataField, type ExpStatus, type Requirement, type SignatureStatus,
} from "@/core/contracting";
import { DOC_CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, type DocCategory } from "@/core/crm";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { crmApi, uploadDocument } from "../crm/api";
import { Avatar, ServiceChip, useFacets } from "../sales/shared";
import { isStaff } from "@/core/roles";
import { cApi, fmtDate, fmtDateTime, todayStr, type ExpDetail, type SigRequest } from "./api";
import { ActivationDialog, DocMeter, MoveDialog, StatusPill } from "./shared";
import { ContractEconomicsDialog } from "../finance/ContractEconomics";

const eur = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ca-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));
const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function openDoc(id: string) {
  const w = window.open("about:blank", "_blank");
  try { const r = await crmApi.docUrl(id); if (w) w.location.href = r.url; else window.location.href = r.url; }
  catch (e) { w?.close(); toast("No s'ha pogut obrir el document", errMsg(e), "err"); }
}

export function ExpedientView() {
  const id = useApp((s) => s.params.id);
  const go = useApp((s) => s.navigate);
  const [d, setD] = useState<ExpDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [move, setMove] = useState<ExpStatus | null>(null);
  const [activate, setActivate] = useState(false);
  const load = useCallback(async () => { if (!id) return; try { setD(await cApi.exp(id)); setErr(null); } catch (e) { setErr(errMsg(e)); } }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (err && !d) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<Lock size={24} />} title="No s'ha pogut obrir l'expedient" body={err} action={<Button onClick={() => go("tramitacions")}>Torna a Tramitacions</Button>} /></div>;
  if (!d) return <div className="mx-auto max-w-[1400px] space-y-3 px-4 py-5 sm:px-6"><div className="h-28 animate-pulse rounded-2xl bg-elevated" /><div className="h-96 animate-pulse rounded-2xl bg-elevated" /></div>;
  const e = d.expedient, p = d.permissions;
  const next = allowedTransitions(e.status).filter((s) => s !== "activat" && (p.isStaff || (SALES_STATUSES.includes(s) && SALES_STATUSES.includes(e.status))));
  const forward = next.filter((s) => FLOW.indexOf(s) > FLOW.indexOf(e.status) || (e.status === "incidencia" && s === e.status_before_incident));
  const canActivate = p.isStaff && (e.status === "enviat" || e.status === "en_tramitacio");
  const closed = e.status === "activat" || e.status === "rebutjat";

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <button onClick={() => go("tramitacions")} className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft size={13} /> Tramitacions</button>
      <header className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{d.client.name}</h2>
              <StatusPill s={e.status} size="md" />
              {e.priority === "alta" && !closed && <Badge tone="red">Prioritat alta</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span className="font-mono text-ink">{e.code}</span><ServiceChip s={e.service} /><span>{PROCEDURE_LABEL[e.procedure_type]}</span>
              <span>· {e.retailer}{e.product ? ` · ${e.product}` : ""}</span>
              <span className="flex items-center gap-1">· <Avatar name={e.owner_name} size={18} /> {e.owner_name ?? "Sense responsable"}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.canEdit && forward.map((s) => <Button key={s} variant="primary" onClick={() => setMove(s)}><ChevronRight size={14} /> {EXP_STATUS_LABEL[s]}</Button>)}
            {canActivate && <Button variant="primary" onClick={() => setActivate(true)}><FileCheck2 size={14} /> Confirma l&apos;activació</Button>}
            {p.isStaff && next.includes("incidencia") && <Button onClick={() => setMove("incidencia")}><AlertTriangle size={14} /> Incidència</Button>}
            {p.isStaff && next.includes("rebutjat") && <Button variant="ghost" onClick={() => setMove("rebutjat")}><Ban size={14} /> Rebutja o anul·la</Button>}
            {p.isStaff && e.status === "rebutjat" && <Button onClick={() => setMove("pendent_documentacio")}><RefreshCw size={14} /> Reobre</Button>}
          </div>
        </div>
        <ol className="mt-4 grid grid-cols-7 gap-1" aria-label="Progrés de la tramitació">
          {FLOW.map((s, i) => {
            const idx = FLOW.indexOf(e.status === "incidencia" ? (e.status_before_incident ?? "pendent_documentacio") : e.status);
            const done = e.status !== "rebutjat" && (i < idx || e.status === "activat");
            const cur = i === idx && e.status !== "rebutjat";
            return <li key={s} className={cn("rounded-lg px-2 py-1.5 text-center text-[11px]", done ? "bg-ren/[0.12] text-ren" : cur ? (e.status === "incidencia" ? "bg-lost/[0.1] font-medium text-lost" : "bg-brand/[0.1] font-medium text-brand") : "bg-ink/[0.04] text-muted")} aria-current={cur ? "step" : undefined}>{done && <Check size={10} className="mr-0.5 inline" />}{EXP_STATUS_LABEL[s]}</li>;
          })}
        </ol>
        {e.status === "rebutjat" && <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-lost"><XCircle size={13} /> {e.rejection_reason}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-3 lg:grid-cols-6">
          <Kv k="Creat" v={fmtDate(e.created_at)} />
          <Kv k="Documentació" v={<DocMeter p={d.progress} />} />
          <Kv k="Signat" v={e.signed_at ? fmtDate(e.signed_at) : "—"} />
          <Kv k="Enviat" v={e.sent_at ? `${fmtDate(e.sent_at)} · ${e.sent_to ?? ""}` : "—"} />
          <Kv k="Activació prevista" v={fmtDate(e.expected_activation_date)} />
          <Kv k="Activat" v={e.activated_at ? `${fmtDate(e.activated_at)}` : "—"} />
        </dl>
      </header>
      {err && <Notice tone="red">{err}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Requirements d={d} reload={load} />
          <TermsSection d={d} reload={load} />
          <Generated d={d} reload={load} />
          <Signatures d={d} reload={load} />
          <Processing d={d} reload={load} onActivate={() => setActivate(true)} />
          <Timeline d={d} reload={load} />
        </div>
        <aside className="space-y-4">
          <ClientCard d={d} />
          <SupplyCard d={d} reload={load} />
          <Settings d={d} reload={load} />
          <CommissionCard d={d} reload={load} />
          {d.tasks.length > 0 && (
            <Section title="Tasques" icon={<Clock size={15} />}>
              <ul className="space-y-1.5 text-[12.5px]">{d.tasks.map((t) => <li key={t.id} className="flex items-start gap-2">{t.status === "feta" ? <CheckCircle2 size={14} className="mt-0.5 text-ren" /> : <CircleDashed size={14} className="mt-0.5 text-muted" />}<span className="min-w-0 flex-1"><span className={cn(t.status === "feta" && "text-muted line-through")}>{t.title}</span><span className="block text-[11px] text-muted">{t.due_at ? fmtDateTime(t.due_at) : "Sense data"} · {t.assigned_name ?? "—"}{t.source === "automatica" ? " · automàtica" : ""}</span></span></li>)}</ul>
            </Section>
          )}
        </aside>
      </div>
      {move && <MoveDialog exp={e} to={move} onClose={() => setMove(null)} onDone={() => { setMove(null); void load(); }} />}
      {activate && <ActivationDialog exp={e} onClose={() => setActivate(false)} onDone={() => { setActivate(false); void load(); }} />}
    </div>
  );
}

const Kv = ({ k, v }: { k: string; v: React.ReactNode }) => <div><dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt><dd className="mt-0.5">{v}</dd></div>;
function Section({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold">{icon}{title}<span className="ml-auto">{action}</span></h3>
      <div className="p-4">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ documentació obligatòria */

const REQ_TONE: Record<string, "zinc" | "amber" | "green" | "red" | "blue"> = { pendent: "amber", aportat: "blue", validat: "green", rebutjat: "red", no_aplica: "zinc" };

function Requirements({ d, reload }: { d: ExpDetail; reload: () => Promise<void> }) {
  const e = d.expedient;
  const closed = e.status === "activat" || e.status === "rebutjat";
  const p = { ...d.permissions, canEdit: d.permissions.canEdit && !closed, isStaff: d.permissions.isStaff && !closed };
  const [busy, setBusy] = useState<string | null>(null);
  const [reject, setReject] = useState<Requirement | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<Requirement | null>(null);
  const act = async (r: Requirement, data: Record<string, unknown>) => {
    setBusy(r.id);
    try { await cApi.act("requirement", { id: e.id, data: { id: r.id, ...data } }); await reload(); } catch (x) { toast("No s'ha pogut desar", errMsg(x), "err"); } finally { setBusy(null); }
  };
  const upload = async (f: File) => {
    const r = target.current;
    if (!r) return;
    setBusy(r.id);
    try {
      const up = await uploadDocument(f, { clientId: e.client_id, category: (r.doc_category ?? "altres") as DocCategory, title: r.name, supplyId: e.supply_id, expedientId: e.id }, () => undefined);
      await cApi.act("requirement", { id: e.id, data: { id: r.id, action: "attach", documentId: up.id } });
      toast("Document pujat i aportat", r.name);
      await reload();
    } catch (x) { toast("No s'ha pogut pujar", errMsg(x), "err"); } finally { setBusy(null); }
  };
  const order = { rebutjat: 0, pendent: 1, aportat: 2, validat: 3, no_aplica: 4 } as const;
  const reqs = [...d.requirements].sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || order[a.status] - order[b.status]);
  return (
    <Section title="Documentació" icon={<FileText size={15} />} action={<span className="flex items-center gap-3"><DocMeter p={d.progress} />{p.isStaff && <button className="text-[12px] font-normal text-brand" onClick={() => setAdding(true)}><Plus size={12} className="inline" /> Requisit</button>}</span>}>
      <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.docx,.xlsx" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) void upload(f); }} />
      {!reqs.length ? <p className="text-[12.5px] text-muted">No hi ha requisits configurats per a aquest servei. Administració els pot afegir a Configuració → Contractació.</p> : (
        <ul className="divide-y divide-line">
          {reqs.map((r) => {
            const doc = r.document_id ? d.documents.find((x) => x.id === r.document_id) : null;
            const candidates = r.kind === "document" ? d.documents.filter((x) => x.category === r.doc_category && x.id !== r.document_id) : [];
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13px] font-medium">{r.name}{!r.mandatory && <span className="text-[11px] font-normal text-muted">opcional</span>}</span>
                  <span className="block text-[11.5px] text-muted">
                    {r.kind === "dada" ? `Dada de la fitxa: ${DATA_FIELD_LABEL[r.data_field as DataField] ?? r.data_field}` : r.kind === "manual" ? "Comprovació manual" : doc ? <button className="inline-flex items-center gap-1 text-brand hover:underline" onClick={() => void openDoc(doc.id)}><Eye size={11} /> {doc.title}</button> : DOC_CATEGORY_LABEL[r.doc_category as DocCategory] ?? "Document"}
                    {r.status === "rebutjat" && r.reject_reason && <span className="text-lost"> · {r.reject_reason}</span>}
                    {r.status === "validat" && r.validated_at && <span> · validat el {fmtDate(r.validated_at)}</span>}
                  </span>
                </span>
                <Badge tone={REQ_TONE[r.status]}>{REQ_STATUS_LABEL[r.status]}</Badge>
                {busy === r.id ? <Loader2 size={14} className="animate-spin text-muted" /> : p.canEdit && (
                  <span className="flex flex-wrap items-center gap-1">
                    {r.kind === "document" && (
                      <>
                        {candidates.length > 0 && (
                          <select className="input h-8 w-44 text-[12px]" aria-label={`Reutilitza un document per a ${r.name}`} value="" onChange={(ev) => ev.target.value && void act(r, { action: "attach", documentId: ev.target.value })}>
                            <option value="">Reutilitza de la fitxa…</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.title} · {fmtDate(c.created_at)}</option>)}
                          </select>
                        )}
                        <DropArea className="inline-block" accept=".pdf,.jpg,.jpeg,.png,.heic,.docx,.xlsx" label="Puja" onFiles={([f]) => { target.current = r; void upload(f); }}><Button size="sm" title="Puja el document (o arrossega'l aquí)" onClick={() => { target.current = r; fileRef.current?.click(); }}><Upload size={12} /> Puja</Button></DropArea>
                      </>
                    )}
                    {r.kind === "manual" && r.status === "pendent" && <Button size="sm" onClick={() => void act(r, { action: "status", status: "aportat" })}><Check size={12} /> Fet</Button>}
                    {r.kind === "dada" && r.status === "pendent" && <Button size="sm" variant="ghost" onClick={() => useApp.getState().navigate("client", { id: e.client_id })}><PenLine size={12} /> Completa la fitxa</Button>}
                    {p.isStaff && r.status === "aportat" && <Button size="sm" onClick={() => void act(r, { action: "status", status: "validat" })}><ShieldCheck size={12} /> Valida</Button>}
                    {p.isStaff && (r.status === "aportat" || r.status === "validat") && <Button size="sm" variant="ghost" onClick={() => setReject(r)}><X size={12} /> Rebutja</Button>}
                    {!r.mandatory && r.status === "pendent" && <Button size="sm" variant="ghost" onClick={() => void act(r, { action: "status", status: "no_aplica", reason: "No el demana la comercialitzadora" })}>No cal</Button>}
                    {r.status === "no_aplica" && <Button size="sm" variant="ghost" onClick={() => void act(r, { action: "status", status: "pendent" })}>Reactiva</Button>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-muted">Els documents es reutilitzen de la fitxa del client sense duplicar-los. Els identificatius i bancaris només els veuen Administració i el comercial responsable.</p>
      {reject && <ReasonDialog title={`Rebutjar · ${reject.name}`} label="Per què es rebutja? (es comunicarà al responsable)" onClose={() => setReject(null)} onOk={async (reason) => { const r = reject; setReject(null); await act(r, { action: "status", status: "rebutjat", reason }); }} />}
      {adding && <ReasonDialog title="Afegir un requisit a aquest expedient" label="Nom del requisit" onClose={() => setAdding(false)} onOk={async (name) => { setAdding(false); try { await cApi.act("requirement", { id: e.id, data: { id: e.id, action: "add", name } }); await reload(); } catch (x) { toast("No s'ha pogut afegir", errMsg(x), "err"); } }} />}
    </Section>
  );
}

function ReasonDialog({ title, label, onClose, onOk, min = 3 }: { title: string; label: string; onClose: () => void; onOk: (v: string) => void | Promise<void>; min?: number }) {
  const [v, setV] = useState("");
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={v.trim().length < min} onClick={() => void onOk(v.trim())}>Desa</Button></>}>
      <label className="block text-[13px]"><span className="label">{label}</span><input className="input" autoFocus value={v} onChange={(ev) => setV(ev.target.value)} /></label>
    </Modal>
  );
}

/* ------------------------------------------------------------------ condicions acceptades */

function TermsSection({ d, reload }: { d: ExpDetail; reload: () => Promise<void> }) {
  const t = d.terms[0];
  const [open, setOpen] = useState(false);
  const rows = t ? conditionsRows(t.conditions, { annual_kwh: t.annual_kwh, estimated_annual_eur: t.estimated_annual_eur }) : [];
  return (
    <Section title="Condicions acceptades" icon={<Lock size={15} />} action={d.permissions.canEdit && <button className="text-[12px] font-normal text-brand" onClick={() => setOpen(true)}><Plus size={12} className="inline" /> {t ? "Nova versió" : "Desa les condicions"}</button>}>
      {!t ? <Notice tone="amber">Encara no s&apos;han desat les condicions acceptades. Desa-les de la comparativa acceptada o introdueix-les a mà abans de generar documents.</Notice> : (
        <>
          <p className="mb-2 text-[12px] text-muted">Versió {t.version} · {t.source === "comparativa" ? "de la comparativa acceptada" : t.source === "manual" ? "introduïdes a mà" : "de l'oportunitat"} · {t.captured_by_name} · {fmtDateTime(t.captured_at)} · <span className="font-mono" title="Empremta de les condicions">{t.sha256.slice(0, 10)}</span></p>
          <p className="mb-2 text-[13px] font-medium">{t.retailer}{t.product ? ` · ${t.product}` : ""}</p>
          {rows.length ? <table className="w-full text-[12.5px]"><tbody>{rows.map(([k, v]) => <tr key={k} className="border-t border-line"><td className="w-48 py-1.5 pr-3 text-muted">{k}</td><td className="py-1.5">{v}</td></tr>)}</tbody></table> : <p className="text-[12.5px] text-muted">Sense preus detallats.</p>}
          {t.conditions.text && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-ink/[0.03] p-2.5 text-[12.5px]">{t.conditions.text}</p>}
          <p className="mt-2 text-[11.5px] text-muted">Còpia immutable: si després es modifica la tarifa o la comparativa, aquestes condicions no canvien.{d.terms.length > 1 ? ` Hi ha ${d.terms.length - 1} versió(ns) anterior(s) conservada(es).` : ""}</p>
        </>
      )}
      {open && <TermsDialog d={d} onClose={() => setOpen(false)} onDone={() => { setOpen(false); void reload(); }} />}
    </Section>
  );
}

function TermsDialog({ d, onClose, onDone }: { d: ExpDetail; onClose: () => void; onDone: () => void }) {
  const e = d.expedient;
  const [src, setSrc] = useState<"comparativa" | "manual">(d.comparisons.length ? "comparativa" : "manual");
  const [cmp, setCmp] = useState(e.comparison_id ?? d.comparisons[0]?.id ?? "");
  const [offer, setOffer] = useState("");
  const [m, setM] = useState({ retailer: e.retailer, product: e.product ?? "", energy: "", power: "", fee: "", permanence: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nums = (s: string) => s.split(/[;\s]+/).filter(Boolean).map((x) => Number(x.replace(",", "."))).map((n) => (Number.isFinite(n) ? n : null));
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await cApi.act("terms", { id: e.id, data: src === "comparativa" ? { source: "comparativa", comparison_id: cmp, offer_id: offer || null } : {
        source: "manual", retailer: m.retailer, product: m.product || null,
        conditions: { energy_eur_kwh: m.energy ? nums(m.energy) : null, power_eur_kw_day: m.power ? nums(m.power) : null, monthly_fee_eur: m.fee ? Number(m.fee.replace(",", ".")) : null, permanence_months: m.permanence ? Number(m.permanence) : null, text: m.text || null },
      } });
      toast("Condicions desades", "S'ha creat una còpia immutable.");
      onDone();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-xl" title="Condicions acceptades" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || (src === "comparativa" && !cmp) || (src === "manual" && !m.retailer.trim())} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="space-y-3 text-[13px]">
        <div className="flex rounded-xl border border-line p-0.5" role="radiogroup" aria-label="Origen">{(["comparativa", "manual"] as const).map((k) => <button key={k} role="radio" aria-checked={src === k} onClick={() => setSrc(k)} className={cn("flex-1 rounded-lg px-3 py-1.5", src === k ? "bg-ink/[0.07] font-medium" : "text-muted")}>{k === "comparativa" ? "Comparativa acceptada" : "Introducció manual"}</button>)}</div>
        {src === "comparativa" ? (d.comparisons.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Comparativa</span><select className="input" value={cmp} onChange={(ev) => { setCmp(ev.target.value); setOffer(""); }}>{d.comparisons.map((k) => <option key={k.id} value={k.id}>{fmtDate(k.created_at)} · {k.status}</option>)}</select></label>
            <label className="block"><span className="label">Oferta acceptada</span><select className="input" value={offer} onChange={(ev) => setOffer(ev.target.value)}><option value="">La recomanada</option>{d.comparisons.find((k) => k.id === cmp)?.offers.map((o) => <option key={o.id} value={o.id}>{o.label} (v{o.version})</option>)}</select></label>
            <p className="text-[12px] text-muted sm:col-span-2">Es copien els preus i les condicions de l&apos;oferta tal com consten a la comparativa (no es recalculen).</p>
          </div>
        ) : <Notice tone="amber">El client no té comparatives desades.</Notice>) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Comercialitzadora *</span><input className="input" value={m.retailer} onChange={(ev) => setM({ ...m, retailer: ev.target.value })} /></label>
            <label className="block"><span className="label">Producte</span><input className="input" value={m.product} onChange={(ev) => setM({ ...m, product: ev.target.value })} /></label>
            <label className="block"><span className="label">Energia €/kWh (P1 P2 …)</span><input className="input font-mono" placeholder="0,1234 0,1100" value={m.energy} onChange={(ev) => setM({ ...m, energy: ev.target.value })} /></label>
            <label className="block"><span className="label">Potència €/kW·dia (P1 P2 …)</span><input className="input font-mono" value={m.power} onChange={(ev) => setM({ ...m, power: ev.target.value })} /></label>
            <label className="block"><span className="label">Quota mensual (€)</span><input className="input" value={m.fee} onChange={(ev) => setM({ ...m, fee: ev.target.value })} /></label>
            <label className="block"><span className="label">Permanència (mesos)</span><input className="input" inputMode="numeric" value={m.permanence} onChange={(ev) => setM({ ...m, permanence: ev.target.value.replace(/\D/g, "").slice(0, 3) })} /></label>
            <label className="block sm:col-span-2"><span className="label">Altres condicions</span><textarea className="input min-h-[70px]" value={m.text} onChange={(ev) => setM({ ...m, text: ev.target.value })} /></label>
          </div>
        )}
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ documents generats */

const GEN_LABEL: Record<string, string> = { generat: "Generat", acceptat: "Revisat", enviat_signatura: "Enviat a signar", signat: "Signat", substituit: "Substituït", anullat: "Anul·lat" };
function Generated({ d, reload }: { d: ExpDetail; reload: () => Promise<void> }) {
  const e = d.expedient;
  const [tpl, setTpl] = useState(d.templates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    try { const r = await cApi.act<{ version: number; documentId: string }>("generate", { id: e.id, templateId: tpl }); toast(`Document generat (v${r.version})`, "S'ha desat al gestor documental del client."); await reload(); }
    catch (x) { toast("No s'ha pogut generar", errMsg(x), "err"); } finally { setBusy(false); }
  };
  const mark = async (genId: string, status: "acceptat" | "anullat") => { try { await cApi.act("generated", { id: e.id, generatedId: genId, status }); await reload(); } catch (x) { toast("No s'ha pogut desar", errMsg(x), "err"); } };
  const name = (id: string) => d.templates.find((t) => t.id === id)?.name ?? "Plantilla";
  return (
    <Section title="Documents de contractació" icon={<FilePlus2 size={15} />}>
      {d.permissions.canEdit && (d.templates.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="input h-9 w-auto min-w-[240px] text-[12.5px]" aria-label="Plantilla" value={tpl} onChange={(ev) => setTpl(ev.target.value)}>{d.templates.map((t) => <option key={t.id} value={t.id}>{t.name} · v{t.version}{t.origin === "comercialitzadora" ? ` (model de ${t.retailer ?? "proveïdor"})` : " (document intern)"}</option>)}</select>
          <Button variant="primary" size="sm" disabled={busy || !tpl} onClick={gen}>{busy ? <Loader2 size={13} className="animate-spin" /> : <FilePlus2 size={13} />} Genera PDF</Button>
        </div>
      ) : <Notice tone="amber">No hi ha cap plantilla autoritzada per a aquest servei. Només es poden fer servir plantilles facilitades per la comercialitzadora o autoritzades per Direcció (Configuració → Contractació).</Notice>)}
      {!d.generated.length ? <p className="text-[12.5px] text-muted">Encara no s&apos;ha generat cap document.</p> : (
        <ul className="divide-y divide-line">
          {d.generated.map((g) => (
            <li key={g.id} className={cn("flex flex-wrap items-center gap-2 py-2 text-[12.5px]", ["substituit", "anullat"].includes(g.status) && "opacity-60")}>
              <FileText size={14} className="text-muted" />
              <span className="min-w-0 flex-1"><b>{name(g.template_id)}</b> · v{g.version} <span className="text-muted">· plantilla v{g.template_version} · {g.generated_by_name} · {fmtDateTime(g.generated_at)}</span></span>
              <Badge tone={g.status === "signat" ? "green" : g.status === "acceptat" || g.status === "enviat_signatura" ? "blue" : "zinc"}>{GEN_LABEL[g.status] ?? g.status}</Badge>
              <Button size="sm" variant="ghost" onClick={() => void openDoc(g.document_id)}><Eye size={12} /> Obre</Button>
              {g.signed_document_id && <Button size="sm" variant="ghost" onClick={() => void openDoc(g.signed_document_id!)}><FileSignature size={12} /> Signat</Button>}
              {d.permissions.canEdit && g.status === "generat" && <Button size="sm" onClick={() => void mark(g.id, "acceptat")}><Check size={12} /> Revisat</Button>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ signatura */

function Signatures({ d, reload }: { d: ExpDetail; reload: () => Promise<void> }) {
  const e = d.expedient, p = d.permissions, sig = d.signature;
  const [prep, setPrep] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, f: () => Promise<unknown>, ok: string) => { setBusy(key); try { await f(); toast(ok); await reload(); } catch (x) { toast("No s'ha pogut fer", errMsg(x), "err"); } finally { setBusy(null); } };
  const live = d.generated.filter((g) => !["substituit", "anullat"].includes(g.status));
  return (
    <Section title="Signatura" icon={<FileSignature size={15} />} action={<span className="text-[11.5px] font-normal">{sig.configured ? <span className="text-ren">{sig.label}{sig.sandbox ? " (proves)" : ""} · configurada</span> : <span className="text-pend">Integració pendent</span>}</span>}>
      {!sig.configured && <div className="mb-3"><Notice tone="amber">No hi ha cap proveïdor de signatura electrònica configurat{sig.missing.length ? ` (falta ${sig.missing.join(", ")})` : ""}. Les sol·licituds es poden preparar però no s&apos;envien, i cap signatura es dona per bona des del CRM.</Notice></div>}
      {d.signatures.length > 0 && (
        <ul className="mb-3 space-y-2">
          {d.signatures.map((s) => <SigRow key={s.id} s={s} busy={busy} canEdit={p.canEdit} configured={sig.configured}
            onSend={() => run(`send-${s.id}`, () => cApi.act("sig_send", { id: e.id, requestId: s.id }), "Enviat a signar")}
            onRefresh={() => run(`ref-${s.id}`, () => cApi.act("sig_refresh", { id: e.id, requestId: s.id }), "Estat actualitzat")}
            onCancel={() => run(`can-${s.id}`, () => cApi.act("sig_cancel", { id: e.id, requestId: s.id, reason: "Cancel·lada des de l'expedient" }), "Sol·licitud cancel·lada")} />)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {p.canEdit && <Button size="sm" disabled={!live.length} onClick={() => setPrep(true)} title={live.length ? "" : "Genera primer el document"}><Send size={13} /> Prepara una sol·licitud</Button>}
        {p.isStaff && <Button size="sm" variant="ghost" onClick={() => setManual(true)}><PenLine size={13} /> Registra una signatura manuscrita</Button>}
      </div>
      {prep && <PrepareSig d={d} docs={live} onClose={() => setPrep(false)} onDone={() => { setPrep(false); void reload(); }} />}
      {manual && <ManualSig d={d} onClose={() => setManual(false)} onDone={() => { setManual(false); void reload(); }} />}
    </Section>
  );
}

function SigRow({ s, busy, canEdit, configured, onSend, onRefresh, onCancel }: { s: SigRequest; busy: string | null; canEdit: boolean; configured: boolean; onSend: () => void; onRefresh: () => void; onCancel: () => void }) {
  const st = s.status as SignatureStatus;
  return (
    <li className="rounded-xl border border-line p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st === "signada" ? "green" : st === "pendent_configuracio" ? "amber" : ["rebutjada", "caducada", "error", "cancellada"].includes(st) ? "red" : "blue"}>{SIGNATURE_STATUS_LABEL[st] ?? st}</Badge>
        <span className="min-w-0 flex-1">{s.provider === "manual" ? "Signatura manuscrita" : s.provider === "pendent" ? "Proveïdor pendent" : s.provider} · {s.signers.map((x) => x.name).join(", ")}</span>
        <span className="text-[11px] text-muted">{fmtDateTime(s.completed_at ?? s.sent_at ?? s.created_at)}</span>
      </div>
      {s.manual_justification && <p className="mt-1 text-[11.5px] text-muted">Justificació: {s.manual_justification}</p>}
      {s.error && <p className="mt-1 text-[11.5px] text-lost">{s.error}</p>}
      {s.events.length > 0 && <p className="mt-1 text-[11px] text-muted">{s.events.length} avís(os) del proveïdor · {s.events.filter((x) => x.verified).length} verificat(s)</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {s.signed_document_id && <Button size="sm" variant="ghost" onClick={() => void openDoc(s.signed_document_id!)}><FileSignature size={12} /> Document signat</Button>}
        {s.evidence_document_id && <Button size="sm" variant="ghost" onClick={() => void openDoc(s.evidence_document_id!)}><ShieldCheck size={12} /> Evidències</Button>}
        {canEdit && ["preparada", "pendent_configuracio", "error"].includes(st) && <Button size="sm" disabled={!configured || busy === `send-${s.id}`} onClick={onSend} title={configured ? "" : "Integració pendent"}>{busy === `send-${s.id}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Envia a signar</Button>}
        {canEdit && ["enviada", "oberta"].includes(st) && <Button size="sm" variant="ghost" disabled={busy === `ref-${s.id}`} onClick={onRefresh}><RefreshCw size={12} /> Consulta l&apos;estat</Button>}
        {canEdit && !["signada", "cancellada"].includes(st) && <Button size="sm" variant="ghost" onClick={onCancel}><X size={12} /> Cancel·la</Button>}
      </div>
    </li>
  );
}

function PrepareSig({ d, docs, onClose, onDone }: { d: ExpDetail; docs: ExpDetail["generated"]; onClose: () => void; onDone: () => void }) {
  const primary = d.contacts.find((c) => c.is_primary) ?? d.contacts[0];
  const [gen, setGen] = useState(docs[0]?.id ?? "");
  const [s, setS] = useState({ name: primary?.name ?? d.client.contact_name ?? d.client.name, email: primary?.email ?? d.client.email ?? "", phone: primary?.phone ?? d.client.phone ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await cApi.act<{ configured: boolean }>("sig_prepare", { id: d.expedient.id, data: { generatedId: gen, signers: [{ name: s.name, email: s.email, phone: s.phone || null }] } }); toast("Sol·licitud preparada", r.configured ? "Ja la pots enviar a signar." : "Queda pendent fins que es configuri el proveïdor de signatura."); onDone(); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Preparar la signatura" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !gen || !s.name || !s.email} onClick={save}>Prepara</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Document</span><select className="input" value={gen} onChange={(ev) => setGen(ev.target.value)}>{docs.map((g) => <option key={g.id} value={g.id}>v{g.version} · {fmtDateTime(g.generated_at)}</option>)}</select></label>
        <label className="block"><span className="label">Signant *</span><input className="input" value={s.name} onChange={(ev) => setS({ ...s, name: ev.target.value })} /></label>
        <label className="block"><span className="label">Correu *</span><input className="input" type="email" value={s.email} onChange={(ev) => setS({ ...s, email: ev.target.value })} /></label>
        <label className="block"><span className="label">Mòbil (SMS de verificació)</span><input className="input" value={s.phone} onChange={(ev) => setS({ ...s, phone: ev.target.value })} /></label>
        {err && <div className="sm:col-span-2"><Notice tone="red">{err}</Notice></div>}
      </div>
    </Modal>
  );
}

function ManualSig({ d, onClose, onDone }: { d: ExpDetail; onClose: () => void; onDone: () => void }) {
  const e = d.expedient;
  const signedDocs = d.documents.filter((x) => x.category === "contracte_signat" || x.category === "contracte");
  const [doc, setDoc] = useState(signedDocs[0]?.id ?? "");
  const [signer, setSigner] = useState(d.client.contact_name ?? d.client.name);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const live = d.generated.find((g) => !["substituit", "anullat", "signat"].includes(g.status));
  const upload = async (f: File) => {
    setBusy(true); setErr(null);
    try { const up = await uploadDocument(f, { clientId: e.client_id, category: "contracte_signat", title: `Contracte signat · ${e.code}`, supplyId: e.supply_id, expedientId: e.id }, () => undefined); setDoc(up.id); toast("Document signat pujat"); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try { await cApi.act("sig_manual", { id: e.id, data: { documentId: doc, signer, justification: why, generatedId: live?.id ?? null } }); toast("Signatura manuscrita registrada"); onDone(); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Registrar una signatura manuscrita" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !doc || why.trim().length < 10 || !signer.trim()} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Registra</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Només per a documents signats a mà (presencialment o escanejats). Cal adjuntar el document <b>signat</b> i explicar com s&apos;ha obtingut.</p>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) void upload(f); }} />
        <div className="flex items-end gap-2">
          <label className="block flex-1"><span className="label">Document signat *</span><select className="input" value={doc} onChange={(ev) => setDoc(ev.target.value)}><option value="">Tria…</option>{d.documents.filter((x) => x.category === "contracte_signat" || x.category === "contracte" || x.id === doc).map((x) => <option key={x.id} value={x.id}>{x.title} · {fmtDate(x.created_at)}</option>)}</select></label>
          <DropArea className="inline-block" accept=".pdf,.jpg,.jpeg,.png" label="Puja" disabled={busy} onFiles={([f]) => void upload(f)}><Button onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={13} /> Puja</Button></DropArea>
        </div>
        <label className="block"><span className="label">Signant *</span><input className="input" value={signer} onChange={(ev) => setSigner(ev.target.value)} /></label>
        <label className="block"><span className="label">Justificació *</span><textarea className="input min-h-[70px]" value={why} onChange={(ev) => setWhy(ev.target.value)} placeholder="Ex.: signat presencialment a l'oficina el 31/10 davant de…" /></label>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ tramitació */

function Processing({ d, reload, onActivate }: { d: ExpDetail; reload: () => Promise<void>; onActivate: () => void }) {
  const e = d.expedient, p = d.permissions;
  const [ref, setRef] = useState(false);
  const [inc, setInc] = useState(false);
  const [econ, setEcon] = useState(false);
  const [busy, setBusy] = useState(false);
  const renewal = async () => { setBusy(true); try { const r = await cApi.act<{ id: string; existed: boolean }>("renewal", { id: e.id }); toast(r.existed ? "Ja hi havia una oportunitat de renovació" : "Oportunitat de renovació creada"); useApp.getState().navigate("oportunitat", { id: r.id }); } catch (x) { toast("No s'ha pogut crear", errMsg(x), "err"); } finally { setBusy(false); } };
  return (
    <Section title="Tramitació" icon={<Zap size={15} />} action={<span className="flex gap-3 text-[12px] font-normal">{p.isStaff && <button className="text-brand" onClick={() => setRef(true)}><Link2 size={12} className="inline" /> Referència</button>}{p.canEdit && <button className="text-brand" onClick={() => setInc(true)}><AlertTriangle size={12} className="inline" /> Incidència</button>}</span>}>
      <dl className="grid gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-2">
        <Kv k="Proposta acceptada" v={d.opportunity ? <button className="text-brand hover:underline" onClick={() => useApp.getState().navigate("oportunitat", { id: d.opportunity!.id })}>{d.opportunity.title}</button> : d.terms.length ? "Condicions desades" : "—"} />
        <Kv k="Contracte signat" v={e.signed_at ? fmtDateTime(e.signed_at) : "Pendent"} />
        <Kv k="Enviat a la comercialitzadora" v={e.sent_at ? `${fmtDate(e.sent_at)} · ${e.sent_to}` : "Pendent"} />
        <Kv k="Referència externa" v={e.external_ref ? <span className="font-mono">{e.external_ref}</span> : "—"} />
        <Kv k="Activació" v={e.activated_at ? `${fmtDate(e.activated_at)} · ${ACTIVATION_SOURCE_LABEL[e.activation_source as keyof typeof ACTIVATION_SOURCE_LABEL] ?? e.activation_source}` : "Pendent"} />
        <Kv k="Confirmada per" v={e.activation_confirmed_name ? `${e.activation_confirmed_name} · ${fmtDateTime(e.activation_confirmed_at)}` : "—"} />
        {e.status === "activat" && <Kv k="Vigència" v={`${fmtDate(e.start_date)} → ${e.end_date ? fmtDate(e.end_date) : "sense data de finalització"}`} />}
      </dl>
      {(e.status === "enviat" || e.status === "en_tramitacio") && p.isStaff && <div className="mt-3"><Button size="sm" variant="primary" onClick={onActivate}><FileCheck2 size={13} /> Confirma l&apos;activació</Button></div>}
      {d.contract && (
        <div className="mt-3 rounded-xl border border-ren/30 bg-ren/[0.04] p-3 text-[12.5px]">
          <p className="flex items-center gap-1.5 font-medium text-ren"><CheckCircle2 size={14} /> Contracte actiu: {d.contract.retailer}{d.contract.product ? ` · ${d.contract.product}` : ""}</p>
          <p className="mt-1 text-muted">{fmtDate(d.contract.start_date)} → {d.contract.end_date ? fmtDate(d.contract.end_date) : "—"}{d.previousContract ? ` · substitueix ${d.previousContract.retailer} (${d.previousContract.status}, conservat a l'historial)` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => useApp.getState().navigate("client", { id: e.client_id, tab: "contractes" })}><Building2 size={12} /> Contractes del client</Button>
            {p.canEdit && <Button size="sm" disabled={busy} onClick={renewal}><RefreshCw size={12} /> Oportunitat de renovació</Button>}
            <Button size="sm" variant="ghost" onClick={() => setEcon(true)}>Economia i comissions</Button>
          </div>
        </div>
      )}
      {d.refs.length > 0 && <div className="mt-3"><p className="label">Referències externes</p><ul className="flex flex-wrap gap-1.5">{d.refs.map((r) => <li key={r.id} className="rounded-lg bg-ink/[0.05] px-2 py-1 text-[12px]"><span className="text-muted">{r.system}{r.label ? ` · ${r.label}` : ""}:</span> <span className="font-mono">{r.ref}</span></li>)}</ul></div>}
      {d.incidents.length > 0 && <div className="mt-3"><p className="label">Incidències</p><ul className="space-y-1">{d.incidents.map((i) => <li key={i.id} className="flex items-center gap-2 text-[12.5px]"><AlertTriangle size={13} className={i.status === "resolta" || i.status === "tancada" ? "text-muted" : "text-lost"} /><span className="flex-1">{i.title}</span><Badge tone={i.status === "resolta" || i.status === "tancada" ? "zinc" : "red"}>{i.status}</Badge><span className="text-[11px] text-muted">{fmtDate(i.opened_at)}</span></li>)}</ul></div>}
      {econ && d.contract && <ContractEconomicsDialog contractId={d.contract.id} onClose={() => setEcon(false)} />}
      {ref && <RefDialog id={e.id} onClose={() => setRef(false)} onDone={() => { setRef(false); void reload(); }} />}
      {inc && <ReasonDialog title="Registrar una incidència" label="Què ha passat?" onClose={() => setInc(false)} onOk={async (title) => { setInc(false); try { await cApi.act("incident", { id: e.id, data: { title } }); toast("Incidència registrada"); await reload(); } catch (x) { toast("No s'ha pogut registrar", errMsg(x), "err"); } }} />}
    </Section>
  );
}

function RefDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ system: "comercialitzadora", ref: "", label: "" });
  const save = async () => { try { await cApi.act("reference", { id, data: f }); onDone(); } catch (x) { toast("No s'ha pogut desar", errMsg(x), "err"); } };
  return (
    <Modal open onClose={onClose} title="Referència externa" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!f.ref.trim()} onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block"><span className="label">Sistema</span><select className="input" value={f.system} onChange={(ev) => setF({ ...f, system: ev.target.value })}>{["comercialitzadora", "distribuidora", "signatura", "portal", "altres"].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="block"><span className="label">Referència *</span><input className="input font-mono" value={f.ref} onChange={(ev) => setF({ ...f, ref: ev.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Descripció</span><input className="input" value={f.label} onChange={(ev) => setF({ ...f, label: ev.target.value })} /></label>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ historial */

const EV_ICON: Record<string, React.ReactNode> = { estat: <ChevronRight size={12} />, activacio: <CheckCircle2 size={12} />, signatura: <FileSignature size={12} />, document: <FileText size={12} />, requisit: <FileText size={12} />, incidencia: <AlertTriangle size={12} />, automatitzacio: <Clock size={12} />, condicions: <Lock size={12} /> };
function Timeline({ d, reload }: { d: ExpDetail; reload: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const add = async () => { try { await cApi.act("note", { id: d.expedient.id, data: { text: note } }); setNote(""); await reload(); } catch (x) { toast("No s'ha pogut desar", errMsg(x), "err"); } };
  return (
    <Section title="Historial" icon={<History size={15} />}>
      <div className="mb-3 flex gap-2"><input className="input" placeholder="Afegeix una nota a l'historial…" value={note} onChange={(ev) => setNote(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && note.trim() && void add()} aria-label="Nota" /><Button disabled={!note.trim()} onClick={add}>Afegeix</Button></div>
      <ol className="relative space-y-3 border-l border-line pl-4">
        {d.events.map((ev) => (
          <li key={ev.id} className="relative text-[12.5px]">
            <span className={cn("absolute -left-[22px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-surface ring-1 ring-line", ev.type === "activacio" ? "text-ren" : ev.type === "incidencia" ? "text-lost" : "text-muted")}>{EV_ICON[ev.type] ?? <CircleDashed size={10} />}</span>
            <p className="font-medium">{ev.title}</p>
            {ev.justification && <p className="text-muted">«{ev.justification}»</p>}
            <p className="text-[11px] text-muted">{fmtDateTime(ev.at)} · {ev.user_name ?? "Sistema"}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[11px] text-muted">L&apos;historial no es pot modificar ni esborrar.</p>
    </Section>
  );
}

/* ------------------------------------------------------------------ columna lateral */

function ClientCard({ d }: { d: ExpDetail }) {
  const c = d.client;
  return (
    <Section title="Client" icon={<Building2 size={15} />} action={<button className="text-[12px] font-normal text-brand" onClick={() => useApp.getState().navigate("client", { id: c.id })}>Fitxa</button>}>
      <p className="text-[13px] font-medium">{c.name}</p>
      <p className="text-[12.5px] text-muted">{c.tax_id ?? "Sense NIF/CIF"}</p>
      <p className="mt-1 text-[12.5px]">{[c.address, c.postal_code, c.city].filter(Boolean).join(", ") || <span className="text-muted">Sense adreça</span>}</p>
      <p className="text-[12.5px]">{[c.phone, c.email].filter(Boolean).join(" · ") || <span className="text-muted">Sense contacte</span>}</p>
      {d.contacts.length > 0 && <ul className="mt-2 space-y-1 border-t border-line pt-2 text-[12px]">{d.contacts.slice(0, 4).map((k) => <li key={k.id}><b>{k.name}</b>{k.role ? ` · ${k.role}` : ""}{k.is_primary ? " · principal" : ""}<span className="block text-muted">{[k.phone, k.email].filter(Boolean).join(" · ")}</span></li>)}</ul>}
    </Section>
  );
}

function SupplyCard({ d, reload }: { d: ExpDetail; reload: () => Promise<void> }) {
  const s = d.supply;
  const [pick, setPick] = useState(false);
  const [supplies, setSupplies] = useState<{ id: string; cups: string }[]>([]);
  useEffect(() => { if (pick) crmApi.get(d.client.id).then((c) => setSupplies(c.supplies.filter((x) => !x.archived_at))).catch(() => undefined); }, [pick, d.client.id]);
  const set = async (id: string) => { try { await cApi.act("update", { id: d.expedient.id, data: { supply_id: id } }); setPick(false); await reload(); toast("CUPS associat"); } catch (x) { toast("No s'ha pogut associar", errMsg(x), "err"); } };
  return (
    <Section title="Subministrament" icon={<Zap size={15} />} action={d.permissions.canEdit && !["activat", "rebutjat"].includes(d.expedient.status) && <button className="text-[12px] font-normal text-brand" onClick={() => setPick(!pick)}>{s ? "Canvia" : "Associa CUPS"}</button>}>
      {s ? (
        <dl className="space-y-1 text-[12.5px]">
          <p className="font-mono text-[12.5px]">{s.cups}</p>
          <p>{s.energy_type === "gas" ? "Gas" : "Electricitat"} · {s.access_tariff ?? "—"}{s.power_kw?.some((x) => x) ? ` · ${s.power_kw.filter((x) => x != null).join(" / ")} kW` : ""}</p>
          <p className="text-muted">Consum: {s.annual_kwh != null ? `${s.annual_kwh.toLocaleString("ca-ES")} kWh/any` : "—"} · actual: {s.current_retailer ?? "—"}</p>
          {s.address && <p className="text-muted">{s.address}{s.city ? `, ${s.city}` : ""}</p>}
        </dl>
      ) : <p className="text-[12.5px] text-muted">Sense CUPS associat (no cal per a fibra, assegurances o alarmes).</p>}
      {pick && <select className="input mt-2" value="" onChange={(ev) => ev.target.value && void set(ev.target.value)} aria-label="Subministrament"><option value="">Tria el CUPS…</option>{supplies.map((x) => <option key={x.id} value={x.id}>{x.cups}</option>)}</select>}
    </Section>
  );
}

function Settings({ d, reload }: { d: ExpDetail; reload: () => Promise<void> }) {
  const e = d.expedient, p = d.permissions;
  const facets = useFacets();
  const me = useApp((s) => s.snap!.me);
  const [f, setF] = useState({ priority: e.priority, owner_id: e.owner_id ?? "", next_action: e.next_action ?? "", expected_activation_date: e.expected_activation_date ?? "", internal_notes: e.internal_notes ?? "" });
  useEffect(() => setF({ priority: e.priority, owner_id: e.owner_id ?? "", next_action: e.next_action ?? "", expected_activation_date: e.expected_activation_date ?? "", internal_notes: e.internal_notes ?? "" }), [e.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const owners = useMemo(() => (facets?.users ?? []).filter((u) => u.role === "comercial" || isStaff(u.role as never)), [facets]);
  const dirty = f.priority !== e.priority || (f.owner_id || null) !== e.owner_id || (f.next_action || null) !== e.next_action || (f.expected_activation_date || null) !== e.expected_activation_date || (f.internal_notes || null) !== e.internal_notes;
  const save = async () => {
    try {
      await cApi.act("update", { id: e.id, version: e.version, data: { priority: f.priority, next_action: f.next_action || null, expected_activation_date: f.expected_activation_date || null, internal_notes: f.internal_notes || null, ...(p.isStaff ? { owner_id: f.owner_id || null } : {}) } });
      toast("Expedient desat"); await reload();
    } catch (x) { toast("No s'ha pogut desar", errMsg(x), "err"); if (/modificat/.test(errMsg(x))) void reload(); }
  };
  if (!p.canEdit) return null;
  return (
    <Section title="Gestió" icon={<PenLine size={15} />}>
      <div className="space-y-2.5 text-[12.5px]">
        {p.isStaff && <label className="block"><span className="label">Responsable</span><select className="input" value={f.owner_id} onChange={(ev) => setF({ ...f, owner_id: ev.target.value })}><option value="">Sense responsable</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? " (jo)" : ""}</option>)}</select></label>}
        <label className="block"><span className="label">Prioritat</span><select className="input" value={f.priority} onChange={(ev) => setF({ ...f, priority: ev.target.value as typeof f.priority })}>{PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}</select></label>
        <label className="block"><span className="label">Pròxima acció</span><input className="input" value={f.next_action} onChange={(ev) => setF({ ...f, next_action: ev.target.value })} /></label>
        <label className="block"><span className="label">Activació prevista</span><input type="date" className="input" value={f.expected_activation_date} onChange={(ev) => setF({ ...f, expected_activation_date: ev.target.value })} /></label>
        <label className="block"><span className="label">Observacions internes</span><textarea className="input min-h-[60px]" value={f.internal_notes} onChange={(ev) => setF({ ...f, internal_notes: ev.target.value })} /></label>
        <div className="flex justify-end"><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Desa</Button></div>
      </div>
    </Section>
  );
}

function CommissionCard({ d, reload }: { d: ExpDetail; reload: () => Promise<void> }) {
  const c = d.commission;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ estimated_eur: "", accrual_status: "pendent", payment_status: "pendent", paid_at: "", paid_eur: "", retailer_ref: "", notes: "" });
  useEffect(() => { if (c) setF({ estimated_eur: c.estimated_eur?.toString() ?? "", accrual_status: c.accrual_status, payment_status: c.payment_status, paid_at: c.paid_at ?? "", paid_eur: c.paid_eur?.toString() ?? "", retailer_ref: c.retailer_ref ?? "", notes: c.notes ?? "" }); }, [c]);
  if (!c) return null;
  const save = async () => {
    try {
      await cApi.act("commission", { id: d.expedient.id, data: { estimated_eur: f.estimated_eur ? Number(f.estimated_eur.replace(",", ".")) : null, accrual_status: f.accrual_status, payment_status: f.payment_status, paid_at: f.paid_at || null, paid_eur: f.paid_eur ? Number(f.paid_eur.replace(",", ".")) : null, retailer_ref: f.retailer_ref || null, notes: f.notes || null } });
      setEdit(false); toast("Comissió desada"); await reload();
    } catch (x) { toast("No s'ha pogut desar", errMsg(x), "err"); }
  };
  return (
    <Section title="Comissió (preparació)" icon={<Lock size={15} />} action={d.permissions.isStaff && <button className="text-[12px] font-normal text-brand" onClick={() => setEdit(!edit)}>{edit ? "Tanca" : "Edita"}</button>}>
      {!edit ? (
        <dl className="space-y-1 text-[12.5px]">
          <p>Estimada: <b>{eur(c.estimated_eur)}</b>{c.annual_kwh ? <span className="text-muted"> · {(c.annual_kwh / 1000).toLocaleString("ca-ES", { maximumFractionDigits: 1 })} MWh</span> : null}</p>
          <p>Meritació: <Badge tone={c.accrual_status === "meritada" ? "green" : "zinc"}>{ACCRUAL_LABEL[c.accrual_status as keyof typeof ACCRUAL_LABEL]}</Badge> · Cobrament: <Badge tone={c.payment_status === "cobrada" ? "green" : c.payment_status === "impagada" ? "red" : "zinc"}>{PAYMENT_LABEL[c.payment_status as keyof typeof PAYMENT_LABEL]}</Badge></p>
          {c.retailer_ref && <p className="text-muted">Ref. comercialitzadora: <span className="font-mono">{c.retailer_ref}</span></p>}
          <p className="text-[11px] text-muted">Activar el contracte no marca la comissió com a meritada ni cobrada. Visible només per a Administració i el comercial responsable.</p>
        </dl>
      ) : (
        <div className="grid gap-2 text-[12.5px]">
          <label className="block"><span className="label">Comissió estimada (€)</span><input className="input" value={f.estimated_eur} onChange={(ev) => setF({ ...f, estimated_eur: ev.target.value })} /></label>
          <label className="block"><span className="label">Meritació</span><select className="input" value={f.accrual_status} onChange={(ev) => setF({ ...f, accrual_status: ev.target.value })}>{Object.entries(ACCRUAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block"><span className="label">Cobrament</span><select className="input" value={f.payment_status} onChange={(ev) => setF({ ...f, payment_status: ev.target.value })}>{Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {(f.payment_status === "cobrada" || f.payment_status === "parcial") && <div className="grid grid-cols-2 gap-2"><label className="block"><span className="label">Data *</span><input type="date" className="input" max={todayStr()} value={f.paid_at} onChange={(ev) => setF({ ...f, paid_at: ev.target.value })} /></label><label className="block"><span className="label">Import (€)</span><input className="input" value={f.paid_eur} onChange={(ev) => setF({ ...f, paid_eur: ev.target.value })} /></label></div>}
          <label className="block"><span className="label">Referència per a la conciliació</span><input className="input font-mono" value={f.retailer_ref} onChange={(ev) => setF({ ...f, retailer_ref: ev.target.value })} /></label>
          <label className="block"><span className="label">Notes</span><input className="input" value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} /></label>
          <div className="flex justify-end"><Button size="sm" variant="primary" onClick={save}>Desa</Button></div>
        </div>
      )}
    </Section>
  );
}

