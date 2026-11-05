"use client";
/** CONCILIACIÓ: liquidacions rebudes de comercialitzadores. Import comunicat ≠ cobrament confirmat. */
import { DropArea } from "../../components/DropZone";
import { CupsLink } from "../../components/Navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, FileSpreadsheet, Info, Landmark, Loader2, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { MATCH_LABEL, type MatchStatus } from "@/core/commissions";
import { MOVEMENT_LABEL, type MovementType } from "@/core/settlement-reader";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { crmApi } from "../crm/api";
import { eur, fApi, fmtD } from "./api";
import { ExportButton } from "../../components/ExportButton";

const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MTONE: Record<string, "zinc" | "amber" | "green" | "blue" | "red"> = { pendent: "zinc", identificat: "blue", conciliat: "green", diferencia: "amber", duplicat: "red", no_identificat: "red", descartat: "zinc" };
type St = { id: string; retailer: string; reference: string; received_at: string; period_from: string | null; period_to: string | null; declared_total: string | null; status: string; source: string; file_name: string | null; lines: number; total: string; conciliated: string; collected: string; issues: number };

export function ReconciliationView() {
  const [d, setD] = useState<{ rows: St[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => fApi.get<{ rows: St[] }>("statements").then((r) => { setD(r); setErr(null); }).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { void load(); }, [load]);
  if (open) return <StatementDetail id={open} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-semibold tracking-tight">Conciliació amb comercialitzadores</h2><p className="text-[13px] text-muted">Registra les liquidacions que envien els proveïdors, identifica cada línia i confirma els cobraments reals.</p></div>
        <div className="flex gap-2"><ExportButton size="md" set="liquidacions_proveidor" /><ExportButton size="md" set="linies_liquidacio" label="Totes les línies a Excel" /><Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Nova liquidació rebuda</Button></div>
      </div>
      <Notice tone="blue">Excel o CSV són només una manera opcional d&apos;importar-les: les dades es desen a la base de dades. Un import comunicat pel proveïdor <b>no</b> es considera cobrat fins que registris el cobrament amb la referència bancària.</Notice>
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <div className="h-40 animate-pulse rounded-2xl bg-elevated" /> : !d.rows.length ? <Empty icon={<Landmark size={24} />} title="Encara no hi ha liquidacions de proveïdors" body="Registra-les a mà o importa el fitxer que t'envia la comercialitzadora." /> : (
        <div className="overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Comercialitzadora</th><th>Referència</th><th>Rebuda</th><th>Estat</th><th className="text-right">Línies</th><th className="text-right">Comunicat</th><th className="text-right">Conciliat</th><th className="text-right">Cobrat</th><th className="px-3 text-right">Incidències</th></tr></thead>
            <tbody>{d.rows.map((s) => (
              <tr key={s.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.02]" onClick={() => setOpen(s.id)}>
                <td className="px-3 py-2 font-medium">{s.retailer}</td><td className="font-mono">{s.reference}{s.source === "fitxer" && <FileSpreadsheet size={11} className="ml-1 inline text-muted" />}</td><td>{fmtD(s.received_at)}</td>
                <td><Badge tone={s.status === "conciliada" ? "green" : s.status === "en_conciliacio" ? "amber" : "zinc"}>{s.status === "conciliada" ? "Conciliada" : s.status === "en_conciliacio" ? "En conciliació" : "Registrada"}</Badge></td>
                <td className="text-right tnum">{s.lines}</td><td className="text-right tnum">{eur(s.total)}</td><td className="text-right tnum">{eur(s.conciliated)}</td><td className="text-right text-ren tnum">{eur(s.collected)}</td>
                <td className={cn("px-3 text-right tnum", s.issues > 0 && "font-medium text-pend")}>{s.issues}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && <NewStatement onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpen(id); }} />}
    </div>
  );
}

type Preview = {
  supplier: { id: string; name: string; evidence: string } | null; format: string; retailer: string; total: string; count: number;
  sheets: { name: string; role: string; reason?: string; movement: MovementType | null; count: number; total: string; declaredTotal: string | null; balanced: boolean | null; headerRow: number | null }[];
  byMovement: Record<MovementType, { count: number; total: string }>; errors: string[]; warnings: string[]; formatChanged: boolean | null;
  duplicateOf: { id: string; reference: string; received_at: string } | null;
  movements: { sheet: string; row: number; cups: string | null; movement: MovementType; kind: string; energy: string | null; product: string | null; eventDate: string | null; docStatus: string | null; amount: string; unit: { qty: string; price: string } | null; flags: string[] }[];
};
const toB64 = async (file: File) => { const buf = new Uint8Array(await file.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(bin); };

function NewStatement({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [mode, setMode] = useState<"fitxer" | "manual">("fitxer");
  const [f, setF] = useState({ retailer: "", reference: "", received_at: new Date().toISOString().slice(0, 10), period_to: "", declared_total: "" });
  const [lines, setLines] = useState([{ cups: "", external_ref: "", client_name: "", concept: "", amount: "" }]);
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [net, setNet] = useState(true);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const pick = async (fl: File | null) => {
    setFile(fl); setPv(null); setErr(null); setForce(false);
    if (!fl) return;
    setBusy(true);
    try {
      const r = await fApi.act<Preview>("statement_preview", { data: { retailer: f.retailer || undefined }, file: { name: fl.name, base64: await toB64(fl) } });
      setPv(r);
      setF((x) => ({ ...x, retailer: x.retailer || r.supplier?.name || "", reference: x.reference || fl.name.replace(/\.[^.]+$/, "").slice(0, 120) }));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      let filePayload: { name: string; base64: string } | undefined;
      if (mode === "fitxer") {
        if (!file) throw new Error("Tria el fitxer");
        filePayload = { name: file.name, base64: await toB64(file) };
      }
      const r = await fApi.act<{ id: string; lines: number; total: string; warnings: string[]; matched: Record<string, number> }>("statement_create", {
        data: { retailer: f.retailer, reference: f.reference, received_at: f.received_at, period_to: f.period_to || null, declared_total: f.declared_total ? f.declared_total.replace(",", ".") : null, net_settlement: net, force, lines: mode === "manual" ? lines.filter((l) => l.amount).map((l) => ({ ...l, amount: l.amount.replace(",", ".") })) : [] },
        file: filePayload,
      });
      toast(`${r.lines} moviments registrats (${eur(r.total)})`, [Object.entries(r.matched).map(([k, v]) => `${MATCH_LABEL[k as MatchStatus] ?? k}: ${v}`).join(" · "), ...r.warnings].filter(Boolean).join(" · "));
      onDone(r.id);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const blocked = mode === "fitxer" && (!pv || !!pv.duplicateOf || (pv.errors.length > 0 && !force));
  return (
    <Modal open onClose={onClose} width="max-w-5xl" title="Nova liquidació rebuda" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || blocked || !f.retailer.trim() || !f.reference.trim() || (mode === "fitxer" ? !file : !lines.some((l) => l.amount))} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Importa i concilia</Button></>}>
      <div className="space-y-3 text-[13px]">
        <div className="flex rounded-xl border border-line p-0.5" role="radiogroup">{(["fitxer", "manual"] as const).map((k) => <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cn("flex-1 rounded-lg px-3 py-1.5", mode === k ? "bg-ink/[0.07] font-medium" : "text-muted")}>{k === "fitxer" ? "Importar Excel o CSV (totes les pestanyes)" : "Alta manual"}</button>)}</div>
        {mode === "fitxer" && (
          <div>
            <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
            <DropArea accept=".xlsx,.xls,.csv" onFiles={([x]) => void pick(x)}>
            <button onClick={() => ref.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-line px-4 py-5 text-muted hover:border-brand/50"><Upload size={18} />{file ? <b className="text-ink">{file.name}</b> : "Pas 1 · Tria la liquidació o arrossega-la aquí (XLSX, XLS o CSV, màx. 5 MB)"}<span className="text-[11.5px]">Es llegeixen totes les pestanyes. Gana Energía i Niba es reconeixen soles; per a la resta es detecten les capçaleres (CUPS, tipus, dates, import).</span></button>
            </DropArea>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-5">
          <label className="block"><span className="label">Comercialitzadora *</span><input className="input" value={f.retailer} onChange={(e) => setF({ ...f, retailer: e.target.value })} /></label>
          <label className="block"><span className="label">Referència *</span><input className="input font-mono" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
          <label className="block"><span className="label">Rebuda</span><input type="date" className="input" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} /></label>
          <label className="block"><span className="label">Període fins a</span><input type="date" className="input" value={f.period_to} onChange={(e) => setF({ ...f, period_to: e.target.value })} /></label>
          <label className="block"><span className="label">Total declarat (€)</span><input className="input tnum" value={f.declared_total} onChange={(e) => setF({ ...f, declared_total: e.target.value })} /></label>
        </div>
        {mode === "fitxer" && busy && !pv && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Llegint les pestanyes…</p>}
        {mode === "fitxer" && pv && (
          <div className="space-y-2" data-testid="previsualitzacio">
            <p className="text-[12.5px]"><b>Pas 2 · Lectura:</b> {pv.supplier ? <>comercialitzadora detectada <Badge tone="blue">{pv.supplier.name}</Badge> ({pv.supplier.evidence})</> : <>format genèric (lectura per capçaleres)</>} · <b className="tnum">{pv.count}</b> moviments · net <b className="tnum">{eur(pv.total)}</b></p>
            {pv.duplicateOf && <Notice tone="red">Aquest fitxer ja es va importar (liquidació <b>{pv.duplicateOf.reference}</b> del {fmtD(pv.duplicateOf.received_at)}). No es tornarà a importar.</Notice>}
            {pv.errors.map((x) => <Notice key={x} tone="red">{x}</Notice>)}
            {pv.warnings.map((x) => <Notice key={x} tone="amber">{x}</Notice>)}
            <div className="overflow-auto rounded-xl border border-line">
              <table className="w-full text-[12px]">
                <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="px-2 py-1.5">Pestanya</th><th>Tipus</th><th className="text-right">Moviments</th><th className="text-right">Suma</th><th className="text-right">TOTAL del document</th><th className="px-2">Quadra</th></tr></thead>
                <tbody>{pv.sheets.map((sh) => (
                  <tr key={sh.name} className="border-t border-line">
                    <td className="px-2 py-1 font-medium">{sh.name}</td>
                    <td className="text-muted">{sh.role === "ignorada" ? <span title={sh.reason}>No s&apos;importa</span> : sh.movement ? MOVEMENT_LABEL[sh.movement] : "Segons la fila"}</td>
                    <td className="text-right tnum">{sh.count}</td><td className={cn("text-right tnum", Number(sh.total) < 0 && "text-lost")}>{eur(sh.total)}</td>
                    <td className="text-right tnum text-muted">{sh.declaredTotal != null ? eur(sh.declaredTotal) : "—"}</td>
                    <td className="px-2">{sh.balanced == null ? "—" : sh.balanced ? <CheckCircle2 size={13} className="text-ren" /> : <AlertTriangle size={13} className="text-lost" />}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="flex flex-wrap gap-2 text-[11.5px]">{(Object.keys(pv.byMovement) as MovementType[]).filter((k) => pv.byMovement[k].count).map((k) => <span key={k} className="rounded-lg bg-ink/[0.05] px-2 py-0.5">{MOVEMENT_LABEL[k]}: {pv.byMovement[k].count} · {eur(pv.byMovement[k].total)}</span>)}</p>
            <details className="rounded-xl border border-line px-3 py-2">
              <summary className="cursor-pointer text-[12px] font-medium">Pas 4 · Previsualització dels moviments ({pv.movements.length}{pv.count > pv.movements.length ? ` de ${pv.count}` : ""})</summary>
              <div className="mt-2 max-h-72 overflow-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="text-left text-muted"><tr><th>Origen</th><th>CUPS</th><th>Moviment</th><th>Data</th><th>Estat</th><th className="text-right">Import</th><th>Avisos</th></tr></thead>
                  <tbody>{pv.movements.map((m) => (
                    <tr key={`${m.sheet}-${m.row}`} className="border-t border-line">
                      <td className="whitespace-nowrap text-muted">{m.sheet} · {m.row}</td><td className="font-mono">{m.cups ?? "—"}</td>
                      <td>{MOVEMENT_LABEL[m.movement]}{m.energy ? ` ${m.energy}` : ""}</td><td className="whitespace-nowrap">{fmtD(m.eventDate)}</td><td className="text-muted">{m.docStatus ?? ""}</td>
                      <td className={cn("text-right tnum", Number(m.amount) < 0 && "text-lost")}>{eur(m.amount)}{m.unit && <span className="block text-[10px] text-muted">{m.unit.qty} kWh × {m.unit.price} €</span>}</td>
                      <td>{m.flags.length > 0 && <span title={m.flags.join("\n")}><Info size={12} className="text-pend" /></span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
            {pv.errors.length > 0 && !pv.duplicateOf && <label className="flex items-start gap-2 rounded-xl border border-lost/40 p-2 text-[12px]"><input type="checkbox" className="mt-0.5" checked={force} onChange={(e) => setForce(e.target.checked)} /><span>He revisat els errors de lectura i vull importar-la igualment (les línies quedaran per revisar a la conciliació).</span></label>}
          </div>
        )}
        {mode === "manual" && (
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_100px_28px] gap-1.5">
                <input className="input font-mono text-[12px]" placeholder="CUPS" value={l.cups} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cups: e.target.value } : x)))} />
                <input className="input text-[12px]" placeholder="Referència" value={l.external_ref} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, external_ref: e.target.value } : x)))} />
                <input className="input text-[12px]" placeholder="Client" value={l.client_name} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, client_name: e.target.value } : x)))} />
                <input className="input text-[12px]" placeholder="Concepte" value={l.concept} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, concept: e.target.value } : x)))} />
                <input className="input tnum text-[12px]" placeholder="Import" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <button className="text-muted hover:text-lost" aria-label="Elimina la línia" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </div>
            ))}
            <button className="flex items-center gap-1 text-[12.5px] text-brand" onClick={() => setLines([...lines, { cups: "", external_ref: "", client_name: "", concept: "", amount: "" }])}><Plus size={12} /> Línia</button>
          </div>
        )}
        <label className="flex items-start gap-2 text-[12px] text-muted"><input type="checkbox" className="mt-0.5" checked={net} onChange={(e) => setNet(e.target.checked)} /><span>La comercialitzadora paga el <b>net</b>: descompta les retrocomissions d&apos;aquesta liquidació del pagament.</span></label>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

type Line = { id: string; line_no: number; cups: string | null; external_ref: string | null; client_name: string | null; concept: string | null; amount: string; kind: string; contract_id: string | null; contract_label: string | null; expected_amount: string | null; difference: string | null; match_status: MatchStatus; note: string | null; collected: string; compensated?: string;
  source_sheet?: string | null; source_row?: number | null; movement?: MovementType | null; doc_status?: string | null; flags?: string[]; match_confidence?: string | null; match_reason?: string | null; match_candidates?: { id: string; label: string; suggested?: boolean }[] };
type Det = { statement: St & { net_settlement?: boolean; supplier_format?: string | null }; lines: Line[]; receipts: { id: string; amount: string; received_at: string; bank_reference: string; allocated: string }[] };
function StatementDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<Det | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [assign, setAssign] = useState<Line | null>(null);
  const [note, setNote] = useState<{ line: Line; action: "conciliar" | "descartar" } | null>(null);
  const [receipt, setReceipt] = useState(false);
  const [missing, setMissing] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => fApi.get<Det>("statement", { id }).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(errMsg(e))), [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (line: Line, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(line.id);
    try { await fApi.act("line_resolve", { data: { lineId: line.id, action, ...extra } }); await load(); } catch (e) { toast("No s'ha pogut fer", errMsg(e), "err"); } finally { setBusy(null); }
  };
  if (!d) return <div className="mx-auto max-w-5xl px-4 py-5">{err ? <Notice tone="red">{err}</Notice> : <div className="h-80 animate-pulse rounded-2xl bg-elevated" />}</div>;
  const s = d.statement;
  const concil = d.lines.filter((l) => l.match_status === "conciliat" && Number(l.amount) > 0).reduce((a, l) => a + Number(l.amount), 0);
  const retroConc = d.lines.filter((l) => l.match_status === "conciliat" && Number(l.amount) < 0).reduce((a, l) => a + Number(l.amount), 0);
  const compensatedTotal = d.lines.reduce((a, l) => a + Number(l.compensated ?? 0), 0);
  const toConcile = d.lines.filter((l) => l.contract_id && (l.match_status === "identificat" || l.match_status === "diferencia"));
  const unlinked = d.lines.filter((l) => !l.contract_id && !["conciliat", "descartat", "duplicat"].includes(l.match_status));
  const otherRetailer = unlinked.filter((l) => /cap contracte és de/.test(l.match_reason ?? "")).length;
  const notInCrm = unlinked.filter((l) => /Cap subministrament del CRM/.test(l.match_reason ?? "")).length;
  const collected = d.lines.reduce((a, l) => a + Number(l.collected ?? 0), 0);     // cobrat de debò (inclou la part saldada amb retrocomissions)
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <button onClick={onBack} className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft size={13} /> Conciliació</button>
      <header className="flex flex-wrap items-start gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{s.retailer} · <span className="font-mono">{s.reference}</span></h2>
          <p className="text-[12.5px] text-muted">Rebuda el {fmtD(s.received_at)}{s.file_name ? ` · ${s.file_name}` : ""}{s.declared_total ? ` · total declarat ${eur(s.declared_total)}` : ""}</p>
          <p className="mt-2 flex flex-wrap gap-4 text-[12.5px]"><span>Conciliat: <b className="tnum">{eur(concil)}</b></span><span>Cobrat: <b className="text-ren tnum">{eur(collected)}</b></span><span>Pendent de cobrar: <b className={cn("tnum", concil - collected > 0 && "text-pend")}>{eur(Math.max(0, concil - collected))}</b></span></p>
        </div>
        <div className="flex gap-2">
          <Button disabled={rematching} onClick={async () => { setRematching(true); try { const r = await fApi.act<{ matched: Record<string, number> }>("statement_match", { id }); await load(); toast("Identificació actualitzada", Object.entries(r.matched ?? {}).map(([k, v]) => `${MATCH_LABEL[k as MatchStatus] ?? k}: ${v}`).join(" · ")); } catch (e) { toast("No s'ha pogut tornar a identificar", errMsg(e), "err"); } finally { setRematching(false); } }}>{rematching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {rematching ? "Identificant…" : "Torna a identificar"}</Button>
          <Button variant="primary" disabled={!toConcile.length} onClick={() => setAllOpen(true)} data-testid="concilia-tot"><CheckCircle2 size={14} /> Concilia-ho tot{toConcile.length ? ` (${toConcile.length})` : ""}</Button>
          <Button variant="primary" disabled={concil <= 0} onClick={() => setReceipt(true)}><Banknote size={14} /> Confirmar cobrament de la liquidació</Button>
        </div>
      </header>
      {otherRetailer > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-pend/40 bg-pend/[0.06] p-3 text-[13px]" data-testid="avis-contractes-que-falten">
          <AlertTriangle size={16} className="text-pend" />
          <p className="min-w-0 flex-1"><b>{otherRetailer} línies</b> tenen el CUPS al CRM, però amb un contracte d&apos;una altra comercialitzadora: el canvi a {s.retailer} no està registrat. El CRM pot crear aquests contractes i identificar-les.{notInCrm > 0 ? ` ${notInCrm} línies més tenen un CUPS que no és al CRM: assigna-les al client amb «Assigna».` : ""}</p>
          <Button size="sm" variant="primary" onClick={() => setMissing(true)}><Plus size={13} /> Crea els contractes que falten</Button>
        </div>
      )}
      <div className="overflow-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">#</th><th>Identificació</th><th>Contracte</th><th>Concepte</th><th className="text-right">Comunicat</th><th className="text-right">Estimat</th><th className="text-right">Diferència</th><th>Estat</th><th className="px-3 text-right">Accions</th></tr></thead>
          <tbody>{d.lines.map((l) => (
            <tr key={l.id} className={cn("border-t border-line", l.match_status === "descartat" && "opacity-50")}>
              <td className="px-3 py-2 text-muted">{l.line_no}</td>
              <td><span className="text-[11.5px]">{l.cups ? <CupsLink cups={l.cups} /> : <span className="font-mono">{l.external_ref ?? "—"}</span>}</span>{l.client_name && <span className="block text-[11px] text-muted">{l.client_name}</span>}{l.source_sheet && <span className="block text-[10.5px] text-muted">{l.source_sheet} · fila {l.source_row}</span>}</td>
              <td className="max-w-[260px]">
                <span className="block truncate">{l.contract_label ?? <span className="text-lost">{l.match_candidates?.length ? `${l.match_candidates.length} contractes possibles` : "Sense identificar"}</span>}</span>
                {l.match_reason && <span className="block truncate text-[10.5px] text-muted" title={l.match_reason}>{l.match_confidence === "inequivoca" ? "✓ " : ""}{l.match_reason}</span>}
                {!l.contract_id && !!l.match_candidates?.length && l.match_status !== "descartat" && (
                  <select className="input mt-1 h-7 py-0 text-[11px]" defaultValue="" aria-label="Tria el contracte" onChange={(e) => e.target.value && void act(l, "assignar", { contractId: e.target.value })}>
                    <option value="">{l.match_confidence === "probable" ? "Confirma la proposta o tria…" : "Tria el contracte…"}</option>
                    {l.match_candidates.map((c) => <option key={c.id} value={c.id}>{c.suggested ? "★ " : ""}{c.label}</option>)}
                  </select>
                )}
              </td>
              <td className="max-w-[180px] text-muted"><span className="block truncate">{l.movement ? MOVEMENT_LABEL[l.movement] : l.concept ?? "—"}</span>{l.kind !== "comissio" && <Badge tone="red" className="mr-1">{l.kind === "retrocessio" ? "retrocomissió" : l.kind}</Badge>}{l.doc_status && <span className="text-[10.5px]">{l.doc_status}</span>}{!!l.flags?.length && <span title={l.flags.join("\n")} className="ml-1 inline-flex"><Info size={11} className="text-pend" /></span>}</td>
              <td className={cn("text-right tnum", Number(l.amount) < 0 && "text-lost")}>{eur(l.amount)}</td><td className="text-right text-muted tnum">{eur(l.expected_amount)}</td>
              <td className={cn("text-right tnum", l.difference && Number(l.difference) !== 0 && "font-medium text-pend")}>{l.difference != null ? eur(l.difference) : "—"}</td>
              <td><Badge tone={MTONE[l.match_status]}>{MATCH_LABEL[l.match_status]}</Badge>{Number(l.collected) > 0 && <span className="ml-1 text-[11px] text-ren">cobrat {eur(l.collected)}</span>}{Number(l.compensated ?? 0) > 0 && <span className="ml-1 text-[11px] text-muted">compensat {eur(l.compensated)}</span>}</td>
              <td className="px-3 text-right">
                {busy === l.id ? <Loader2 size={13} className="ml-auto animate-spin" /> : l.match_status !== "conciliat" && l.match_status !== "descartat" && (
                  <span className="flex justify-end gap-1">
                    {l.contract_id && l.match_status !== "duplicat" && <Button size="sm" variant="primary" onClick={() => (l.match_status === "diferencia" ? setNote({ line: l, action: "conciliar" }) : act(l, "conciliar"))}><CheckCircle2 size={12} /> Concilia</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setAssign(l)}><Search size={12} /> Assigna</Button>
                    <Button size="sm" variant="ghost" onClick={() => setNote({ line: l, action: "descartar" })}><X size={12} /></Button>
                  </span>
                )}
                {l.match_status === "descartat" && <Button size="sm" variant="ghost" onClick={() => act(l, "reobrir")}>Reobre</Button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex justify-end"><ExportButton set="linies_liquidacio" params={{ l_statement_id: id }} label="Exporta les línies d'aquesta liquidació" /></div>
      <CollaboratorSplit id={id} />
      {d.receipts.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
          <h3 className="mb-2 font-semibold">Cobraments registrats</h3>
          <ul className="space-y-1">{d.receipts.map((r) => <li key={r.id} className="flex gap-3"><span className="w-28 text-muted">{fmtD(r.received_at)}</span><span className="flex-1 font-mono">{r.bank_reference}</span><span className="tnum">{eur(r.amount)}</span><span className="w-40 text-right text-muted">assignat {eur(r.allocated)}</span></li>)}</ul>
        </section>
      )}
      {assign && <AssignDialog line={assign} retailer={s.retailer} onClose={() => setAssign(null)} onPick={(cid) => { const l = assign; setAssign(null); void act(l, "assignar", { contractId: cid }); }} onCreated={() => { setAssign(null); void load(); }} />}
      {allOpen && <ConciliateAllDialog id={id} lines={d.lines} onClose={() => setAllOpen(false)} onDone={() => { setAllOpen(false); void load(); }} />}
      {missing && <MissingContractsDialog statementId={id} onClose={() => setMissing(false)} onDone={() => { setMissing(false); void load(); }} />}
      {note && <NoteDialog title={note.action === "conciliar" ? `Conciliar amb diferència de ${eur(note.line.difference)}` : "Descartar la línia"} onClose={() => setNote(null)} onOk={(v) => { const n = note; setNote(null); void act(n.line, n.action, { note: v }); }} />}
      {receipt && <ReceiptDialog id={id} net={s.net_settlement !== false} suggested={(s.net_settlement !== false ? concil + retroConc - collected + compensatedTotal : concil - collected).toFixed(2)} onClose={() => setReceipt(false)} onDone={() => { setReceipt(false); void load(); }} />}
    </div>
  );
}

function AssignDialog({ line, retailer, onClose, onPick, onCreated }: { line: Line; retailer: string; onClose: () => void; onPick: (contractId: string) => void; onCreated: () => void }) {
  const [q, setQ] = useState(line.client_name ?? line.cups ?? "");
  const [clients, setClients] = useState<{ id: string; title: string }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [client, setClient] = useState<{ id: string; title: string } | null>(null);
  const [contracts, setContracts] = useState<{ id: string; label: string; same: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setClients(null); return; }
    setSearching(true);
    const t = setTimeout(() => crmApi.search(q).then((r) => {
      const seen = new Set<string>();
      setClients(r.results.filter((x) => x.kind === "client" || x.kind === "supply").filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).map((x) => ({ id: x.id, title: x.kind === "supply" ? `${x.sub.split(" · ")[1] ?? ""} · CUPS ${x.title}` : `${x.title}${x.sub ? ` · ${x.sub}` : ""}` })));
    }).catch((e) => { setClients([]); setErr(errMsg(e)); }).finally(() => setSearching(false)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const pickClient = async (c: { id: string; title: string }) => {
    setClient(c); setErr(null);
    try { const d = await crmApi.get(c.id); setContracts(d.contracts.map((k) => ({ id: k.id, same: k.retailer.toLowerCase().includes(retailer.toLowerCase().split(" ")[0]), label: `${k.retailer}${k.product ? ` · ${k.product}` : ""} · ${k.status} · ${fmtD(k.start_date)}` }))); }
    catch (e) { setErr(errMsg(e)); setContracts([]); }
  };
  const create = async () => {
    if (!client) return;
    setBusy(true); setErr(null);
    try { await fApi.act("line_contract", { data: { lineId: line.id, clientId: client.id } }); toast(`Contracte de ${retailer} creat i línia identificada`); onCreated(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Assignar la línia a un contracte">
      <div className="space-y-2 text-[13px]" data-testid="assignar-linia">
        <p className="text-[12px] text-muted">Línia {line.line_no}{line.cups ? ` · CUPS ${line.cups}` : ""} · {eur(line.amount)}. Busca el client pel nom, el NIF o el CUPS.</p>
        {!client ? <>
          <input className="input" autoFocus placeholder="Client, NIF o CUPS" value={q} onChange={(e) => setQ(e.target.value)} />
          {searching && <p className="flex items-center gap-1.5 text-muted"><Loader2 size={13} className="animate-spin" /> Cercant…</p>}
          {!searching && clients?.length === 0 && <Notice>No s&apos;ha trobat cap client{/^ES\d/i.test(q.trim()) ? " amb aquest CUPS: aquest punt de subministrament encara no és al CRM. Busca el client pel nom o el NIF i el CRM hi afegirà el CUPS en crear el contracte." : ". Prova amb el nom, el NIF o el CUPS."}</Notice>}
          {!!clients?.length && <ul className="max-h-60 overflow-auto">{clients.map((c) => <li key={c.id}><button className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.05]" onClick={() => void pickClient(c)}>{c.title}</button></li>)}</ul>}
        </> : <>
          <p className="flex items-center gap-2"><b>{client.title}</b><button className="text-[12px] text-brand hover:underline" onClick={() => { setClient(null); setContracts(null); }}>canvia</button></p>
          {!contracts ? <p className="text-muted"><Loader2 size={13} className="inline animate-spin" /> Carregant els contractes…</p> : (
            <ul className="max-h-56 overflow-auto">{contracts.map((k) => <li key={k.id}><button className={cn("w-full rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.05]", !k.same && "text-muted")} onClick={() => onPick(k.id)}>{k.label}{!k.same && <span className="ml-1 text-[11px]">(una altra comercialitzadora)</span>}</button></li>)}{!contracts.length && <li className="text-muted">Aquest client no té contractes.</li>}</ul>
          )}
          {contracts && !contracts.some((k) => k.same) && line.cups && (
            <div className="rounded-xl border border-brand/30 bg-brand/[0.04] p-2.5">
              <p className="text-[12.5px]">El client no té cap contracte de <b>{retailer}</b>. Si la comercialitzadora hi liquida comissions, és que el contracte existeix però no s&apos;ha registrat al CRM.</p>
              <Button size="sm" variant="primary" className="mt-2" disabled={busy} onClick={create}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Crea el contracte de {retailer} amb el CUPS {line.cups} i vincula-hi la línia</Button>
            </div>
          )}
        </>}
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

/** Fase 14.2 · Contractes que la comercialitzadora liquida i que no consten al CRM (canvis de comercialitzadora no registrats). */
type Missing = { retailer: string; reference: string; proposals: { cups: string; supplyId: string; clientId: string; client: string; energy: string; current: { id: string; retailer: string; status: string; start_date: string | null; end_date: string | null }[]; lines: { id: string; line_no: number; movement: string | null; amount: string; origin: string | null }[]; status: "actiu" | "finalitzat"; start: string | null; end: string | null; product: string | null }[]; notInCrm: { cups: string; lines: number[] }[] };
function MissingContractsDialog({ statementId, onClose, onDone }: { statementId: string; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<Missing | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [close, setClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fApi.act<Missing>("missing_contracts", { id: statementId }).then((r) => { setD(r); setSel(new Set(r.proposals.map((p) => p.cups))); }).catch((e) => setErr(errMsg(e))); }, [statementId]);
  const [progress, setProgress] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    // per blocs de 10 (cada contracte nou també es publica a renovacions): cap petició no s'acosta al temps màxim
    const all = [...sel];
    let created = 0;
    const failed: { cups: string; reason: string }[] = [];
    try {
      for (let i = 0; i < all.length; i += 10) {
        setProgress(`Creant contractes… ${Math.min(i + 10, all.length)} de ${all.length}`);
        const r = await fApi.act<{ created: number; failed: { cups: string; reason: string }[] }>("create_missing_contracts", { id: statementId, data: { cups: all.slice(i, i + 10), closePrevious: close, rematch: false } });
        created += r.created; failed.push(...r.failed);
      }
      setProgress("Tornant a identificar les línies…");
      const m = await fApi.act<{ matched: Record<string, number> }>("statement_match", { id: statementId });
      toast(`${created} contractes creats i línies identificades de nou`, [Object.entries(m.matched ?? {}).map(([k, v]) => `${MATCH_LABEL[k as MatchStatus] ?? k}: ${v}`).join(" · "), failed.length ? `${failed.length} no s'han pogut crear: ${failed.slice(0, 2).map((f) => f.reason).join(" · ")}` : ""].filter(Boolean).join(" · "), failed.length ? "err" : "ok");
      onDone();
    } catch (e) { setErr(`${created ? `S'han creat ${created} contractes, però després ha fallat: ` : ""}${errMsg(e)}`); } finally { setBusy(false); setProgress(null); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-4xl" title="Contractes que falten al CRM" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !sel.size} onClick={run}>{busy && <Loader2 size={14} className="animate-spin" />} {progress ?? `Crea ${sel.size} contractes i torna a identificar`}</Button></>}>
      {!d ? (err ? <Notice tone="red">{err}</Notice> : <p className="flex items-center gap-2 py-6 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Buscant els contractes que falten…</p>) : (
        <div className="space-y-3 text-[13px]" data-testid="contractes-que-falten">
          <p>Aquests CUPS són al CRM, però el seu contracte hi consta amb una altra comercialitzadora. <b>{d.retailer}</b> hi liquida comissions, per tant el client s&apos;hi va passar i el contracte no s&apos;ha registrat. Revisa la llista: el CRM crearà el contracte de {d.retailer} (des de la data d&apos;activació de la liquidació) i hi vincularà les línies.</p>
          {!d.proposals.length && <Notice>No hi ha cap línia en aquesta situació.</Notice>}
          {d.proposals.length > 0 && (
            <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-elevated text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="px-2 py-1.5"><input type="checkbox" aria-label="Selecciona-les totes" checked={sel.size === d.proposals.length} onChange={(e) => setSel(new Set(e.target.checked ? d.proposals.map((p) => p.cups) : []))} /></th><th>Client · CUPS</th><th>Ara al CRM</th><th>Contracte que es crearà</th><th>Línies</th></tr></thead>
                <tbody>{d.proposals.map((p) => (
                  <tr key={p.cups} className="border-t border-line align-top">
                    <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Crea el contracte de ${p.cups}`} checked={sel.has(p.cups)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.cups); else n.delete(p.cups); setSel(n); }} /></td>
                    <td><b>{p.client}</b><span className="block font-mono text-[11px] text-muted">{p.cups}</span></td>
                    <td className="text-muted">{p.current.length ? p.current.map((k) => `${k.retailer} · ${k.status}${k.end_date ? ` fins ${fmtD(k.end_date)}` : ""}`).join(" / ") : "cap contracte"}</td>
                    <td>{d.retailer}{p.product ? ` · ${p.product}` : ""}<span className="block text-[11px] text-muted">{p.status === "actiu" ? `Actiu des del ${fmtD(p.start)} · fi estimada a 12 mesos` : `Finalitzat${p.end ? ` el ${fmtD(p.end)}` : ""} (només hi ha retrocomissió)`}</span></td>
                    <td className="text-[11px] text-muted">{p.lines.map((l) => `${l.origin ?? `línia ${l.line_no}`} · ${eur(l.amount)}`).join(" · ")}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {d.notInCrm.length > 0 && <Notice>{d.notInCrm.length} CUPS no són al CRM ({d.notInCrm.slice(0, 4).map((x) => x.cups).join(", ")}{d.notInCrm.length > 4 ? "…" : ""}): no se sap de quin client són. Fes «Assigna» a cada línia, busca el client pel nom o el NIF i crea-hi el contracte.</Notice>}
          {d.proposals.length > 0 && <label className="flex items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-0.5" checked={close} onChange={(e) => setClose(e.target.checked)} /><span>Marca com a <b>finalitzat</b> el contracte anterior (de l&apos;altra comercialitzadora) a la data d&apos;activació. Si no ho marques, el contracte anterior es queda com està (per exemple, al Kanban de renovacions).</span></label>}
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      )}
    </Modal>
  );
}
function NoteDialog({ title, onClose, onOk }: { title: string; onClose: () => void; onOk: (v: string) => void }) {
  const [v, setV] = useState("");
  return <Modal open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={v.trim().length < 3} onClick={() => onOk(v.trim())}>Desa</Button></>}><label className="block text-[13px]"><span className="label">Motiu *</span><input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} /></label></Modal>;
}
function ReceiptDialog({ id, net: netDefault, suggested, onClose, onDone }: { id: string; net: boolean; suggested: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: Number(suggested) > 0 ? suggested : "", received_at: new Date().toISOString().slice(0, 10), bank_reference: "" });
  const [net, setNet] = useState(netDefault);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => { setErr(null); try { const r = await fApi.act<{ allocated: string; unallocated: string }>("receipt", { id, data: { ...f, net, amount: f.amount.replace(",", ".") } }); toast("Cobrament registrat", Number(r.unallocated) > 0 ? `${eur(r.unallocated)} sense assignar a cap línia conciliada` : undefined); onDone(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal open onClose={onClose} title="Registrar el cobrament real" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!f.amount || !f.bank_reference.trim()} onClick={save}>Registra</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block"><span className="label">Import rebut (€)</span><input className="input tnum" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="block"><span className="label">Data del cobrament</span><input type="date" className="input" max={new Date().toISOString().slice(0, 10)} value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Referència bancària *</span><input className="input font-mono" value={f.bank_reference} onChange={(e) => setF({ ...f, bank_reference: e.target.value })} /></label>
        <label className="flex items-start gap-2 text-[12px] sm:col-span-2"><input type="checkbox" className="mt-0.5" checked={net} onChange={(e) => setNet(e.target.checked)} /><span>Cobrament <b>net</b>: les retrocomissions conciliades d&apos;aquesta liquidació s&apos;han descomptat del pagament.</span></label>
        <p className="text-[11.5px] text-muted sm:col-span-2">Confirmar el cobrament de la liquidació: s&apos;assigna, per ordre, a les comissions conciliades pendents de cobrar (mai a les línies sense contracte). Es permeten cobraments parcials; si sobra import, queda sense assignar. Només aquest pas marca una comissió com a cobrada.</p>
        {err && <div className="sm:col-span-2"><Notice tone="red">{err}</Notice></div>}
      </div>
    </Modal>
  );
}

/** Fase 14.4 · Concilia d'un sol clic totes les línies identificades (les que tenen diferència, només amb un motiu). */
function ConciliateAllDialog({ id, lines, onClose, onDone }: { id: string; lines: Line[]; onClose: () => void; onDone: () => void }) {
  const ok = lines.filter((l) => l.contract_id && l.match_status === "identificat");
  const diff = lines.filter((l) => l.contract_id && l.match_status === "diferencia");
  const noContract = lines.filter((l) => !l.contract_id && !["descartat", "duplicat", "conciliat"].includes(l.match_status));
  const dup = lines.filter((l) => l.match_status === "duplicat");
  const [withDiff, setWithDiff] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = (xs: Line[]) => xs.reduce((a, l) => a + Number(l.amount), 0);
  const n = ok.length + (withDiff ? diff.length : 0);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fApi.act<{ conciliated: number; amount: string }>("conciliate_all", { id, data: { includeDifferences: withDiff, note: withDiff ? note.trim() : undefined } });
      toast(`${r.conciliated} línies conciliades (${eur(r.amount)})`, "Ara pots confirmar el cobrament de la liquidació quan arribi la transferència.");
      onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Conciliar totes les línies identificades" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !n || (withDiff && note.trim().length < 3)} onClick={run}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Concilia {n} línies</Button></>}>
      <div className="space-y-3 text-[13px]" data-testid="concilia-tot-dialeg">
        <p>Es conciliaran <b>{ok.length} línies identificades</b> ({eur(total(ok))}): el CRM registra que la comercialitzadora les ha liquidat. Encara no compten com a cobrades fins que confirmis el cobrament bancari.</p>
        {diff.length > 0 && (
          <div className="rounded-xl border border-pend/40 bg-pend/[0.06] p-2.5">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={withDiff} onChange={(e) => setWithDiff(e.target.checked)} /><span>Inclou-hi també les <b>{diff.length} línies amb diferència</b> respecte de la comissió prevista ({eur(total(diff))}).</span></label>
            {withDiff && <label className="mt-2 block"><span className="label">Motiu (s&apos;aplica a totes) *</span><input className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Revisat: import segons la liquidació de la comercialitzadora" /></label>}
            {!withDiff && <p className="mt-1 text-[11.5px] text-muted">Si no les inclous, queden pendents per revisar-les (o reclamar-les) una per una.</p>}
          </div>
        )}
        {(noContract.length > 0 || dup.length > 0) && <p className="text-[12px] text-muted">No es conciliaran: {[noContract.length ? `${noContract.length} sense contracte o per triar` : null, dup.length ? `${dup.length} duplicades` : null].filter(Boolean).join(" · ")}.</p>}
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

/* ======================================================================= repartiment amb col·laboradors (consulta) */

type Split = { rows: { lineId: string; lineNo: number; client: string; base: string; collaborator: string | null; pct: string | null; rule: string | null; simulation: boolean; collaboratorAmount: string | null; remainder: string; retro: boolean; review: boolean; note: string | null; forecast: string | null; accrued: string; settled: string }[]; totals: { base: string; collaborator: string; remainder: string; retroBase: string; retroCollaborator: string } };
function CollaboratorSplit({ id }: { id: string }) {
  const [d, setD] = useState<Split | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && !d) fApi.get<Split>("collab_split", { id }).then(setD).catch(() => setD({ rows: [], totals: { base: "0", collaborator: "0", remainder: "0", retroBase: "0", retroCollaborator: "0" } })); }, [open, d, id]);
  const rows = d?.rows.filter((r) => r.collaborator) ?? [];
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
      <button className="flex w-full items-center justify-between font-semibold" onClick={() => setOpen(!open)}><span>Repartiment amb col·laboradors</span><span className="text-[11.5px] font-normal text-muted">{open ? "Amaga" : "Mostra"}</span></button>
      {open && (!d ? <Loader2 size={14} className="mt-2 animate-spin text-muted" /> : !rows.length ? <p className="mt-2 text-muted">Cap línia d&apos;aquesta liquidació correspon a contractes amb col·laborador.</p> : (
        <div className="mt-2 space-y-2">
          <p className="text-muted">Consulta calculada amb el motor de comissions: base = import de la línia (comissió confirmada per la comercialitzadora) × percentatge vigent del col·laborador. No desa res; la meritació es fa des del contracte.</p>
          <div className="overflow-auto"><table className="w-full">
            <thead className="text-left text-[11px] uppercase text-muted"><tr><th className="py-1">Línia</th><th>Client</th><th>Col·laborador</th><th className="text-right">Comissió</th><th className="text-right">%</th><th className="text-right">Col·laborador</th><th className="text-right">Resta Assessoria</th><th className="text-right">Previst</th><th className="text-right">Meritat / liquidat</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.lineId} className={cn("border-t border-line", r.retro && "bg-amber-500/[0.04]")}>
                <td className="py-1.5 text-muted">{r.lineNo}</td><td className="max-w-[180px] truncate">{r.client}</td><td>{r.collaborator}</td>
                <td className="text-right tabular-nums">{eur(r.base)}</td>
                <td className="text-right">{r.pct ? `${Number(r.pct).toLocaleString("ca-ES")} %` : "—"}{r.simulation && <span className="ml-1 text-amber-600" title="Pendent d'aprovació">●</span>}</td>
                <td className="text-right font-medium tabular-nums">{eur(r.collaboratorAmount)}</td>
                <td className="text-right tabular-nums">{eur(r.remainder)}</td>
                <td className="text-right tabular-nums text-muted">{eur(r.forecast)}</td>
                <td className="text-right tabular-nums text-muted">{eur(r.accrued)} / {eur(r.settled)}</td>
              </tr>
            ))}{rows.filter((r) => r.note).map((r) => <tr key={`${r.lineId}-n`}><td /><td colSpan={8} className={cn("pb-1 text-[11.5px]", r.review ? "text-amber-700 dark:text-amber-300" : "text-muted")}>Línia {r.lineNo}: {r.note}</td></tr>)}</tbody>
          </table></div>
          <div className="flex flex-wrap gap-4 border-t border-line pt-2"><span>Comissions amb col·laborador: <b>{eur(d.totals.base)}</b></span><span>Part dels col·laboradors: <b>{eur(d.totals.collaborator)}</b></span><span>Resta per a Assessoria: <b>{eur(d.totals.remainder)}</b></span>{Number(d.totals.retroBase) !== 0 && <span className="text-amber-700 dark:text-amber-300">Retrocessions: {eur(d.totals.retroBase)} (part orientativa col·laboradors {eur(d.totals.retroCollaborator)}, cal revisar)</span>}</div>
        </div>
      ))}
    </section>
  );
}
