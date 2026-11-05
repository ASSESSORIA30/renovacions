"use client";
/**
 * FACTURACIÓ › BANC: pujar extractes (Norma 43, Excel o CSV), proposta de quina factura cobra cada ingrés i
 * anàlisi de les factures que encara no s'han cobrat. Res es concilia sol: es confirma i es registra el cobrament.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Landmark, Loader2, RefreshCw, Sparkles, Undo2, X } from "lucide-react";
import { useApp } from "@/data/store";
import { useCan, useSession } from "../../session";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { bApi, errMsg, eur, fmtD, toast } from "./api";

type Sugg = { invoices: { id: string; invoice_no: string; amount: string }[]; score: number; confidence: "alta" | "mitjana" | "baixa"; reasons: string[] };
type Row = { id: string; op_date: string; value_date: string | null; amount: string; concept: string; reference: string | null; status: "pendent" | "conciliat" | "ignorat"; note: string | null; suggestions: Sugg[]; matches: { invoiceId: string; invoiceNo: string | null; amount: string }[] };
type Unpaid = { id: string; invoice_no: string; issue_date: string; due_date: string | null; client_name: string; pending: string; payment_unknown: boolean; overdue: boolean; daysOverdue: number };
type Ov = { imports: { id: string; file_name: string; format: string; account: string | null; period_from: string | null; period_to: string | null; movements: number; new_movements: number; created_at: string }[]; period: { to: string | null }; rows: Row[]; unpaid: Unpaid[]; summary: { pendingCredits: number; withoutInvoice: number; highConfidence: number; unpaidCount: number; unpaidOverdue: number; unpaidAmount: string; historicUnknown: number } };
const CONF_TONE = { alta: "green", mitjana: "amber", baixa: "zinc" } as const;

export function BankTab() {
  const go = useApp((s) => s.navigate);
  const canDo = useCan();
  const role = useSession((s) => s.role);
  const canConfirm = canDo("facturacio", "approve") || role === "admin";
  const canEdit = canDo("facturacio", "edit") || role === "admin";
  const [status, setStatus] = useState<"pendent" | "conciliat" | "ignorat">("pendent");
  const [d, setD] = useState<Ov | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"ingressos" | "pendents">("ingressos");
  const [pick, setPick] = useState<Row | null>(null);
  const load = useCallback(async () => { try { setD(await bApi.get<Ov>("bank", { status })); setErr(null); } catch (e) { setErr(errMsg(e)); } }, [status]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    if (file.size > 5_000_000) { toast("Fitxer massa gran", "Màxim 5 MB", "err"); return; }
    setBusy("upload");
    try {
      const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(file); });
      const r = await bApi.act<{ movements: number; added: number; repeated: number; credits: number; creditTotal: string; from: string | null; to: string | null; format: string }>("bank_upload", { data: { file: { name: file.name, base64: b64 } } });
      toast("Extracte importat", `${r.movements} moviments (${r.added} nous${r.repeated ? `, ${r.repeated} ja hi eren` : ""}) · ${r.credits} ingressos per ${eur(r.creditTotal)} · ${fmtD(r.from)} – ${fmtD(r.to)}`);
      void load();
    } catch (e) { toast("No s'ha pogut importar", errMsg(e), "err"); } finally { setBusy(null); }
  };
  const confirm = async (row: Row, s: Sugg) => {
    setBusy(row.id);
    try { await bApi.act("bank_confirm", { data: { movementId: row.id, invoices: s.invoices.map((i) => ({ invoiceId: i.id, amount: i.amount })) } }); toast("Cobrament registrat", `${s.invoices.map((i) => i.invoice_no).join(" + ")} · ${eur(row.amount)}`); void load(); }
    catch (e) { toast("No s'ha pogut conciliar", errMsg(e), "err"); } finally { setBusy(null); }
  };
  const confirmHigh = async () => {
    if (!confirm_(`Confirmar les ${d?.summary.highConfidence ?? 0} propostes de confiança alta? Es registrarà el cobrament de cada factura.`)) return;
    setBusy("high");
    try { const r = await bApi.act<{ done: number; skipped: string[] }>("bank_confirm_high"); toast(`${r.done} cobraments registrats`, r.skipped.length ? r.skipped.join(" · ") : undefined, r.skipped.length ? "info" : "ok"); void load(); }
    catch (e) { toast("No s'ha pogut fer", errMsg(e), "err"); } finally { setBusy(null); }
  };
  const setSt = async (row: Row, st: "pendent" | "ignorat") => {
    try { await bApi.act("bank_status", { data: { movementId: row.id, status: st, note: st === "ignorat" ? "No correspon a cap factura" : null } }); void load(); }
    catch (e) { toast("No s'ha pogut", errMsg(e), "err"); }
  };
  const s = d?.summary;
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
        <Landmark className="text-ren" size={22} />
        <div className="min-w-0 flex-1 text-[12.5px]"><div className="text-[13.5px] font-semibold">Extractes bancaris</div><div className="text-muted">Puja el fitxer Norma 43 (n43/aeb43) o l&apos;Excel/CSV que descarregues de la banca en línia. Els moviments repetits no es dupliquen.</div></div>
        {canEdit && <label className={cn("pressable inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-medium text-surface", busy === "upload" && "opacity-50")}>{busy === "upload" ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Pujar extracte<input type="file" className="hidden" accept=".n43,.aeb,.csb,.q43,.txt,.xlsx,.xls,.csv" disabled={busy === "upload"} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} /></label>}
      </section>
      {err && <Notice tone={/migració/.test(err) ? "amber" : "red"}>{err}</Notice>}
      {d && !d.imports.length && <Empty icon={<Landmark size={24} />} title="Encara no s'ha pujat cap extracte" body="Quan en pugis un, el CRM proposarà quina factura cobra cada ingrés i et dirà quines factures falten per cobrar." />}
      {d && d.imports.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Ingressos per conciliar" value={String(s!.pendingCredits)} hint={`${s!.highConfidence} amb proposta segura · ${s!.withoutInvoice} sense cap factura que hi encaixi`} />
          <Card label="Factures sense cobrament a l'extracte" value={String(s!.unpaidCount - s!.historicUnknown)} hint={`${s!.unpaidOverdue} vençudes · ${eur(s!.unpaidAmount)} pendents`} tone={s!.unpaidOverdue ? "text-lost" : undefined} />
          <Card label="Històric de l'Excel per comprovar" value={String(s!.historicUnknown)} hint="Factures antigues sense ingrés trobat" />
          <Card label="Últim extracte fins al" value={fmtD(d.period.to)} hint={d.imports[0] ? `${d.imports[0].file_name}` : undefined} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["ingressos", "pendents"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn("pressable h-8 rounded-lg px-3 text-[12.5px] font-medium", tab === t ? "bg-ink text-surface" : "text-muted hover:bg-ink/5")}>{t === "ingressos" ? "Ingressos de l'extracte" : `Factures que falten per cobrar (${s!.unpaidCount})`}</button>)}
          {tab === "ingressos" && <select className="input h-8 w-auto text-[12.5px]" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="pendent">Per conciliar</option><option value="conciliat">Conciliats</option><option value="ignorat">Ignorats</option></select>}
          <Button size="sm" onClick={() => void load()}><RefreshCw size={13} /> Actualitza</Button>
          {tab === "ingressos" && canConfirm && status === "pendent" && s!.highConfidence > 0 && <Button size="sm" variant="primary" className="ml-auto" disabled={busy === "high"} onClick={() => void confirmHigh()}>{busy === "high" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Confirmar les {s!.highConfidence} segures</Button>}
        </div>
        {tab === "ingressos" ? (
          <div className="overflow-auto rounded-2xl border border-line bg-surface">
            {!d.rows.length ? <Empty icon={<CheckCircle2 size={24} />} title={status === "pendent" ? "Tots els ingressos estan conciliats o ignorats" : "Cap moviment"} /> : (
              <table className="w-full text-[12.5px]">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Data</th><th>Concepte</th><th className="text-right">Import</th><th className="px-3">{status === "pendent" ? "Proposta" : status === "conciliat" ? "Factures" : "Nota"}</th></tr></thead>
                <tbody>{d.rows.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap px-3 py-2">{fmtD(r.op_date)}</td>
                    <td className="max-w-[360px] break-words text-[12px]">{r.concept || "—"}{r.reference && <div className="text-[11px] text-muted">Ref. {r.reference}</div>}</td>
                    <td className="whitespace-nowrap text-right font-medium tabular-nums">{eur(r.amount)}</td>
                    <td className="min-w-[300px] px-3 py-2">
                      {r.status === "conciliat" && r.matches.map((m) => <div key={m.invoiceId}><button className="font-mono underline" onClick={() => go("factura", { id: m.invoiceId })}>{m.invoiceNo}</button> · {eur(m.amount)}</div>)}
                      {r.status === "ignorat" && <div className="flex items-center gap-2 text-muted">{r.note ?? "Ignorat"} {canEdit && <button className="underline" onClick={() => void setSt(r, "pendent")}><Undo2 size={12} className="inline" /> Recupera</button>}</div>}
                      {r.status === "pendent" && <>
                        {r.suggestions[0] ? (
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5"><Badge tone={CONF_TONE[r.suggestions[0].confidence]}>Confiança {r.suggestions[0].confidence}</Badge>{r.suggestions[0].invoices.map((i) => <button key={i.id} className="font-mono font-medium underline" onClick={() => go("factura", { id: i.id })}>{i.invoice_no}</button>)}</div>
                            <div className="text-[11.5px] text-muted">{r.suggestions[0].reasons.join(" · ")}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {canConfirm && <Button size="sm" variant="primary" disabled={busy === r.id} onClick={() => void confirm(r, r.suggestions[0])}>{busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Confirma</Button>}
                              {r.suggestions.length > 1 && <Button size="sm" onClick={() => setPick(r)}>{r.suggestions.length - 1} alternativa(es)</Button>}
                              {canEdit && <Button size="sm" variant="ghost" onClick={() => void setSt(r, "ignorat")}><X size={12} /> No és cap factura</Button>}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1"><div className="flex items-center gap-1 text-amber-700 dark:text-amber-300"><AlertTriangle size={12} /> Cap factura oberta amb aquest import.</div><div className="text-[11.5px] text-muted">Pot ser un cobrament d&apos;una factura que encara no s&apos;ha emès, una bestreta o un ingrés que no és de facturació.</div>{canEdit && <Button size="sm" variant="ghost" onClick={() => void setSt(r, "ignorat")}><X size={12} /> No és cap factura</Button>}</div>
                        )}
                      </>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Notice tone="blue">Factures emeses amb import pendent per a les quals l&apos;extracte no té cap ingrés que hi encaixi (import exacte, o suma de factures del mateix client){d.period.to ? `, fins al ${fmtD(d.period.to)}` : ""}. Les de l&apos;Excel antic surten a part: potser es van cobrar abans del període de l&apos;extracte.</Notice>
            <div className="overflow-auto rounded-2xl border border-line bg-surface">
              {!d.unpaid.length ? <Empty icon={<CheckCircle2 size={24} />} title="No falta cobrar cap factura" /> : (
                <table className="w-full text-[12.5px]">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Factura</th><th>Client</th><th>Emesa</th><th>Venciment</th><th className="text-right">Pendent</th><th className="px-3">Situació</th></tr></thead>
                  <tbody>{d.unpaid.map((i) => (
                    <tr key={i.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.02]" onClick={() => go("factura", { id: i.id })}>
                      <td className="px-3 py-2 font-mono font-medium">{i.invoice_no}</td><td className="max-w-[260px] truncate">{i.client_name}</td><td>{fmtD(i.issue_date)}</td><td>{fmtD(i.due_date)}</td>
                      <td className="text-right tabular-nums">{eur(i.pending)}</td>
                      <td className="px-3">{i.payment_unknown ? <Badge tone="zinc">Històric: comprovar</Badge> : i.overdue ? <Badge tone="red">Vençuda fa {i.daysOverdue} dies</Badge> : <Badge tone="blue">Encara no ha vençut</Badge>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </>}
      {pick && (
        <Modal open onClose={() => setPick(null)} width="max-w-2xl" title={`Ingrés de ${eur(pick.amount)} del ${fmtD(pick.op_date)}`}>
          <p className="mb-2 text-[12px] text-muted">{pick.concept}</p>
          <ul className="space-y-2 text-[12.5px]">{pick.suggestions.map((sg, k) => (
            <li key={k} className="rounded-xl border border-line p-2">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={CONF_TONE[sg.confidence]}>{sg.confidence}</Badge><b className="font-mono">{sg.invoices.map((i) => i.invoice_no).join(" + ")}</b>{canConfirm && <Button size="sm" variant="primary" className="ml-auto" onClick={() => { const r = pick; setPick(null); void confirm(r, sg); }}>Confirma</Button>}</div>
              <div className="mt-1 text-[11.5px] text-muted">{sg.reasons.join(" · ")}</div>
            </li>
          ))}</ul>
        </Modal>
      )}
    </div>
  );
}
const confirm_ = (m: string) => window.confirm(m);

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return <div className="rounded-2xl border border-line bg-surface p-4"><div className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</div><div className={cn("mt-1 text-xl font-semibold tabular-nums", tone)}>{value}</div>{hint && <div className="mt-1 text-[11.5px] text-muted">{hint}</div>}</div>;
}
