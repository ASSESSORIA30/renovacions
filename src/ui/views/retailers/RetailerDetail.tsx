"use client";
/**
 * FITXA DE COMERCIALITZADORA (Fase 8.1)
 *  - «PUJAR CONTRACTE I ANALITZAR AMB IA»: puja el document (bucket privat) i el llegeix (IA amb garanties o lector local).
 *  - Revisió: cada condició mostra el que DIU el contracte (fragment literal, pàgina, versió) separat de la
 *    INTERPRETACIÓ proposada, amb confiança i estat. Les dubtoses: «REVISIÓ MANUAL NECESSÀRIA».
 *  - Direcció aprova (individualment o en bloc les clares) i el sistema crea les regles al motor de comissions.
 */
import { ReadingTemplates } from "./ReadingTemplates";
import { DropArea } from "../../components/DropZone";
import { refreshRetailerOptions } from "./options";
import { formatUnitValue, humanizeUnits } from "@/core/units";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileText, Loader2, Pencil, RefreshCw, ShieldAlert, Sparkles, Upload, X } from "lucide-react";
import { CATEGORY_LABEL, FIELD_LABEL, UNIT_LABEL, norm } from "@/core/retailers";
import { isRiskyClawback, productRisk, productSheets, type SheetTerm } from "@/core/condition-reader";
import { useApp } from "@/data/store";
import { Button, Modal, Notice, SupplierMark, Tabs, cn } from "../../components/ui";
import { Panel, Pill, Skeleton, fdate } from "../consolidacio/shared";
import { AiBanner } from "./RetailersList";
import { DOC_STATUS, SERVICES, STATUS_LABEL, STATUS_TONE, rApi, uploadRetailerFile, type AiInfo, type Doc, type Extraction, type Retailer, type Term } from "./api";

type Rule = { id: string; rule_key: string; version: number; name: string; product: string | null; kind: string; value: string | null; unit: string; tiers: unknown; conditions: Record<string, unknown>; base_formula: string | null; base_validated: boolean; valid_from: string; valid_to: string | null; status: string; source_document_id: string | null };
type Claw = { id: string; rule_key: string; version: number; name: string; trigger: string; risk_months: number | null; start_event: string; mode: string; pct: string | null; penalty_eur: string | null; formula: string | null; exceptions: string | null; claim_days: number | null; valid_from: string; valid_to: string | null; status: string };
type Detail = { retailer: Retailer; documents: Doc[]; extractions: Extraction[]; terms: Term[]; rules: Rule[]; clawbacks: Claw[]; ai: AiInfo; canEdit: boolean; canApprove: boolean; productContracts: { product: string | null; start: string | null; expected: number }[] | null };
type TabId = "revisio" | "documents" | "regles" | "plantilles" | "fitxa";

const fmtVal = (v: string | number | null, unit: string | null) => formatUnitValue(v, unit);
const pctConf = (c: string | number) => `${Math.round(Number(c) * 100)} %`;
const MODE: Record<string, string> = { total: "Retorn total", parcial: "Retorn parcial", prorrata: "Prorrateig", formula: "Fórmula", penalitzacio: "Penalització" };

export function RetailerView() {
  const go = useApp((s) => s.navigate);
  const id = useApp((s) => s.params.id ?? "");
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("revisio");
  const [upload, setUpload] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "blue" | "amber"; text: string } | null>(null);
  // sense identificador (enllaç antic, historial o menú) no es demana res al servidor: es torna al llistat
  const load = useCallback(async () => { if (!id) return; try { setD(await rApi.get<Detail>("get", { id })); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, [id]);
  useEffect(() => { if (!id) { go("comercialitzadores", {}, { replace: true }); return; } void load(); }, [load, id, go]);
  if (err) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="red">{err}</Notice></div>;
  if (!d) return <div className="mx-auto max-w-[1300px] px-4 py-5"><Skeleton rows={3} /></div>;
  const r = d.retailer;
  const pending = d.terms.filter((t) => ["pendent", "revisio_manual"].includes(t.review_status)).length;
  const aiOn = d.ai.configured && d.ai.policy.enabled;
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => go("comercialitzadores")} className="rounded-lg p-1.5 text-muted hover:bg-ink/[0.05]" aria-label="Tornar"><ArrowLeft size={16} /></button>
        {r.logoUrl ? <img src={r.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" /> : <SupplierMark name={r.trade_name} size={40} />}
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">{r.trade_name}<Pill className={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill></h2>
          <p className="text-[12.5px] text-muted">{[r.legal_name, r.tax_id, r.services.map((s) => SERVICES[s]).join(" · ")].filter(Boolean).join(" · ")}</p>
        </div>
        {d.canApprove && <StatusActions r={r} reload={load} setMsg={setMsg} />}
        {d.canEdit && <Button variant="primary" onClick={() => setUpload(true)} className="font-semibold tracking-wide"><Sparkles size={14} /> {aiOn ? "PUJAR CONTRACTE I ANALITZAR AMB IA" : "PUJAR CONTRACTE I ANALITZAR"}</Button>}
      </div>
      {["inactiva", "arxivada"].includes(r.status) && <Notice tone="amber">Aquesta comercialitzadora està {r.status === "arxivada" ? "arxivada" : "desactivada"}: no apareix als selectors per a contractes, expedients ni comparatives nous. Tot l&apos;historial (contractes, tarifes, comissions, retrocessions, liquidacions, documents i incidències) es conserva.{r.status_changed_by_name ? ` Canvi fet per ${r.status_changed_by_name}${r.status_changed_at ? ` el ${new Date(r.status_changed_at).toLocaleString("ca-ES")}` : ""}.` : ""}</Notice>}
      <AiBanner ai={d.ai} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Tabs value={tab} onChange={setTab} items={[{ id: "revisio", label: "Revisió i aprovació", count: pending }, { id: "documents", label: "Contractes i annexos", count: d.documents.length }, { id: "regles", label: "Regles aprovades", count: d.rules.length + d.clawbacks.length }, { id: "plantilles", label: "Plantilles de lectura IA" }, { id: "fitxa", label: "Fitxa" }]} />
      {tab === "revisio" && <Review d={d} reload={load} setMsg={setMsg} />}
      {tab === "documents" && <Documents d={d} reload={load} setMsg={setMsg} onAnalyzed={() => setTab("revisio")} />}
      {tab === "regles" && <Rules d={d} />}
      {tab === "plantilles" && <ReadingTemplates retailerId={r.id} supplier={r.trade_name} canEdit={d.canEdit} />}
      {tab === "fitxa" && <Sheet d={d} reload={load} setMsg={setMsg} />}
      <UploadModal open={upload} onClose={() => setUpload(false)} d={d} aiOn={aiOn} onDone={async (text, tone) => { setMsg({ tone, text }); await load(); setTab("revisio"); }} />
    </div>
  );
}

/* ======================================================================= pujada + anàlisi */

/** Lectura IA (1a passada) i, tot seguit, comprovació de coherència (2a passada). Cada passada és una petició separada. */
async function analyzeAndVerify(docId: string, step: (s: string) => void): Promise<{ text: string; tone: "green" | "amber" | "red" }> {
  const a = await rApi.act<{ id: string; status: string; terms: number; manual?: number; method?: string; needsOcr?: boolean; verify?: boolean }>("analyze", { mode: "auto" }, docId);
  if (a.needsOcr) return { text: "Document pujat, però és escanejat i la IA no està activada amb garanties: introdueix les condicions a mà des de «Contractes i annexos».", tone: "amber" };
  let extra = "";
  if (a.verify) {
    step(`2/2 · Comprovació de coherència: la IA torna a llegir el document per buscar condicions oblidades, abasts incorrectes i contradiccions… (${a.terms} condicions trobades)`);
    try {
      const v = await rApi.act<{ added?: number; flagged?: number; contradictions?: number }>("verify", {}, a.id);
      extra = ` Comprovació de coherència: ${v.added ?? 0} condició(ns) afegida(es), ${v.flagged ?? 0} marcada(es) per revisar${v.contradictions ? `, ${v.contradictions} contradicció(ns)` : ""}.`;
    } catch (e) { extra = ` La comprovació de coherència no s'ha pogut fer (${e instanceof Error ? e.message : String(e)}); pots tornar-la a llançar des de «Contractes i annexos».`; }
  }
  return { text: `Document analitzat (${a.method === "ia" ? "IA" : "lector local"}): ${a.terms} condicions proposades${a.manual ? `, ${a.manual} necessiten revisió manual` : ""}.${extra} Revisa la fitxa per producte i importa-les.`, tone: a.terms ? "green" : "amber" };
}

function UploadModal({ open, onClose, d, aiOn, onDone }: { open: boolean; onClose: () => void; d: Detail; aiOn: boolean; onDone: (t: string, tone: "green" | "amber" | "red") => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    const f = new FormData(e.currentTarget);
    setErr(null);
    try {
      setStep("Pujant el document al bucket privat…");
      const up = await uploadRetailerFile(file, { retailerId: d.retailer.id, title: String(f.get("title") || "") || undefined, kind: String(f.get("kind")), supersedesId: String(f.get("supersedes") || "") || null, validFrom: String(f.get("from") || "") || null, validTo: String(f.get("to") || "") || null }, setPct);
      setStep(aiOn ? "1/2 · La IA llegeix el document sencer i relaciona comissions, retrocessions i excepcions… (pot trigar uns minuts)" : "Llegint el contracte amb el lector local…");
      const r = await analyzeAndVerify(up.id as string, setStep);
      onClose(); setFile(null); setStep(null); setPct(0);
      onDone(r.text, r.tone);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); setStep(null); }
  };
  return (
    <Modal open={open} onClose={() => !step && onClose()} title={aiOn ? "Pujar contracte i analitzar amb IA" : "Pujar contracte i analitzar"} width="max-w-xl">
      <form onSubmit={submit} className="space-y-3 text-[13px]">
        <DropArea accept=".pdf,.docx,.xlsx,.csv,.jpg,.jpeg,.png" onFiles={([f]) => setFile(f)}>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line p-6 text-center hover:border-brand">
          <Upload size={20} className="text-muted" />
          <span className="font-medium">{file ? file.name : "Tria el contracte, l'annex o les tarifes, o arrossega'l aquí"}</span>
          <span className="text-[11.5px] text-muted">PDF (també escanejats), Word, Excel, CSV, JPG o PNG · màx. 25 MB</span>
          <input type="file" className="hidden" accept=".pdf,.docx,.xlsx,.csv,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        </DropArea>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">Títol<input name="title" maxLength={200} className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" placeholder="p. ex. Contracte d'agència 2027" /></label>
          <label className="block">Tipus<select name="kind" className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5"><option value="contracte">Contracte de col·laboració</option><option value="annex">Annex</option><option value="tarifes">Tarifes</option><option value="condicions">Condicions especials</option><option value="altres">Altres</option></select></label>
          <label className="block">Vigent des de<input type="date" name="from" className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
          <label className="block">Fins a<input type="date" name="to" className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
        </div>
        <label className="block">Substitueix un contracte anterior? (es conserven tots dos)<select name="supersedes" className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5"><option value="">No, és nou</option>{d.documents.filter((x) => x.status !== "anullat").map((x) => <option key={x.id} value={x.id}>{x.title} (v{x.version})</option>)}</select></label>
        {step && <div className="flex items-center gap-2 rounded-lg bg-ink/[0.04] p-2.5 text-[12.5px]"><Loader2 size={14} className="animate-spin" />{step}{pct > 0 && pct < 100 ? ` ${pct} %` : ""}</div>}
        {err && <Notice tone="red">{err}</Notice>}
        <p className="text-[11.5px] text-muted">El sistema no activa cap regla: només en prepara la proposta perquè Direcció la revisi i l&apos;aprovi.</p>
        <div className="flex justify-end gap-2"><Button type="button" onClick={onClose} disabled={!!step}>Cancel·la</Button><Button type="submit" variant="primary" disabled={!file || !!step}><Sparkles size={13} /> Puja i analitza</Button></div>
      </form>
    </Modal>
  );
}

/* ======================================================================= revisió */

function Review({ d, reload, setMsg }: { d: Detail; reload: () => Promise<void>; setMsg: (m: { tone: "green" | "red" | "blue" | "amber"; text: string } | null) => void }) {
  const [filter, setFilter] = useState<"pendents" | "totes">("pendents");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Term | null>(null);
  const doc = useMemo(() => new Map(d.documents.map((x) => [x.id, x])), [d.documents]);
  const rows = d.terms.filter((t) => filter === "totes" || ["pendent", "revisio_manual"].includes(t.review_status));
  const clear = rows.filter((t) => t.review_status === "pendent" && !t.ambiguous);
  const run = async (ids: string[], action: "approve" | "reject", extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await rApi.act<{ ok: number; failed: number; results: { ok: boolean; error?: string }[] }>("review", { ids, action, ...extra });
      const errs = r.results.filter((x) => !x.ok).map((x) => x.error);
      setMsg({ tone: r.failed ? "amber" : "green", text: `${action === "approve" ? "Aprovades" : "Rebutjades"}: ${r.ok}${r.failed ? ` · No s'han pogut processar ${r.failed}: ${[...new Set(errs)].join(" · ")}` : ""}` });
      setSel(new Set()); await reload();
    } catch (e) { setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <ProductSheets d={d} busy={busy} onImport={async (ids, confirmManual) => { await run(ids, "approve", { confirmManual }); }} onEdit={(t) => setEdit(t)} />
      <h3 className="pt-2 text-[13px] font-semibold">Detall de cada condició</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onChange={setFilter} items={[{ id: "pendents", label: "Per revisar" }, { id: "totes", label: "Totes" }]} />
        <div className="flex-1" />
        {d.canApprove && clear.length > 0 && <Button size="sm" onClick={() => setSel(new Set(clear.map((t) => t.id)))}>Selecciona les {clear.length} clares</Button>}
        {d.canApprove && sel.size > 0 && <Button size="sm" variant="primary" disabled={busy} onClick={() => void run([...sel], "approve")}><Check size={13} /> Aprova {sel.size} seleccionades</Button>}
      </div>
      {!d.canApprove && <Notice tone="blue">Pots revisar, corregir i rebutjar propostes. L&apos;aprovació final és de Direcció.</Notice>}
      {!rows.length && <Panel title="Res per revisar" empty={d.documents.length ? "Totes les condicions estan revisades." : "Puja el primer contracte per preparar les regles automàticament."} />}
      <div className="space-y-2.5">
        {rows.map((t) => {
          const dc = doc.get(t.document_id);
          const manual = t.review_status === "revisio_manual" || t.ambiguous || !t.excerpt_found;
          const done = ["aprovada", "rebutjada"].includes(t.review_status);
          const canBulk = t.review_status === "pendent" && !t.ambiguous;
          return (
            <article key={t.id} className={cn("rounded-2xl border bg-surface p-3.5", manual && !done ? "border-amber-500/40" : "border-line", done && "opacity-75")}>
              <div className="flex flex-wrap items-start gap-2.5">
                {d.canApprove && !done && <input type="checkbox" aria-label="Seleccionar" className="mt-1" disabled={!canBulk} checked={sel.has(t.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(t.id); else s.delete(t.id); setSel(s); }} title={canBulk ? "" : "Les condicions dubtoses s'aproven una a una"} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    <Pill className="bg-ink/[0.06]">{CATEGORY_LABEL[t.category as keyof typeof CATEGORY_LABEL] ?? t.category}</Pill>
                    <span className="font-semibold">{FIELD_LABEL[t.field] ?? t.field}</span>
                    {t.product && <span>· {t.product}</span>}{t.tariff && <span className="text-muted">· {t.tariff}</span>}
                    {manual && !done && <Pill className="bg-red-500/12 font-semibold text-red-700 dark:text-red-300"><ShieldAlert size={11} className="mr-1" />REVISIÓ MANUAL NECESSÀRIA</Pill>}
                    {t.review_status === "aprovada" && <Pill className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={11} className="mr-1" />Aprovada{t.applied_rule_id ? " → motor de comissions" : t.applied_clawback_id ? " → regla de retrocessió" : ""}</Pill>}
                    {t.review_status === "rebutjada" && <Pill className="bg-ink/[0.06] text-muted">Rebutjada</Pill>}
                    <span className="ml-auto text-[11.5px] text-muted">Confiança {pctConf(t.confidence)} · {t.source === "ia" ? "IA" : t.source === "local" ? "lector local" : "manual"}</span>
                  </div>
                  <p className="mt-1 text-[20px] font-semibold tnum">{t.field === "trams_volum" || t.field === "rappel" || t.field === "escalonada" ? (t.tiers ?? []).map((x) => `${x.threshold}→${x.amount} €`).join(" · ") || "—" : fmtVal(t.value, t.unit)}
                    {t.category !== "remuneracio" && t.conditions?.risk_months != null && <span className="ml-2 text-[13px] font-normal text-muted">dins de {String(t.conditions.risk_months)} mesos{t.conditions.mode ? ` · ${MODE[String(t.conditions.mode)] ?? String(t.conditions.mode)}` : ""}</span>}
                  </p>
                  {t.formula && <p className="mt-0.5 font-mono text-[12px]">Fórmula: {t.formula}</p>}
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div className="rounded-xl bg-ink/[0.035] p-2.5">
                      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Què diu el contracte</p>
                      <blockquote className="mt-1 border-l-2 border-brand pl-2 text-[12.5px] italic">«{t.excerpt}»</blockquote>
                      <p className="mt-1 text-[11px] text-muted">{dc ? `${dc.title} · v${dc.version}` : "Document"}{t.page ? ` · pàg. ${t.page}` : ""} · {t.excerpt_found ? <span className="text-emerald-700 dark:text-emerald-400">fragment verificat al document</span> : <span className="font-semibold text-red-600">fragment NO verificat</span>}{(t.valid_from || t.valid_to) ? ` · vigència ${t.valid_from ?? "…"} – ${t.valid_to ?? "…"}` : ""}</p>
                    </div>
                    <div className="rounded-xl border border-dashed border-line p-2.5">
                      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Interpretació proposada</p>
                      <p className="mt-1 text-[12.5px]">{t.interpretation ?? "—"}</p>
                      {t.ambiguity_reason && <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-400">{humanizeUnits(t.ambiguity_reason)}</p>}
                      {t.original && <p className="mt-1 text-[11px] text-muted">Proposta original: {fmtVal(t.original.value as number | null, t.original.unit as string | null)}</p>}
                      {t.review_note && <p className="mt-1 text-[11px] text-muted">Nota: {t.review_note}</p>}
                    </div>
                  </div>
                </div>
              </div>
              {!done && (
                <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                  {d.canEdit && <Button size="sm" onClick={() => setEdit(t)}><Pencil size={12} /> Corregeix</Button>}
                  {d.canEdit && <Button size="sm" disabled={busy} onClick={() => void run([t.id], "reject")}><X size={12} /> Rebutja</Button>}
                  {d.canApprove && <Button size="sm" variant="primary" disabled={busy} onClick={() => setEdit({ ...t, __approve: true } as Term & { __approve: boolean })}><Check size={12} /> {manual ? "Revisa i aprova" : "Aprova"}</Button>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {edit && <TermEditor t={edit} approve={!!(edit as Term & { __approve?: boolean }).__approve} onClose={() => setEdit(null)} onSave={async (patch, opts) => {
        try {
          if (opts.approve) await run([edit.id], "approve", { patch, confirmManual: opts.confirmManual, baseValidated: opts.baseValidated });
          else { await rApi.act("term_edit", patch, edit.id); setMsg({ tone: "green", text: "Correcció desada (es conserva la proposta original)" }); await reload(); }
          setEdit(null);
        } catch (e) { setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) }); }
      }} />}
    </div>
  );
}

/* ======================================================================= fitxa unificada per producte */

const termText = (t: SheetTerm) => {
  const tiers = Array.isArray(t.tiers) ? (t.tiers as { threshold: number; amount: number }[]) : null;
  const v = tiers?.length ? tiers.map((x) => `${x.threshold}→${x.amount} €`).join(" · ") : fmtVal(t.value, t.unit);
  return `${FIELD_LABEL[t.field] ?? t.field}: ${v}`;
};
const clawText = (t: SheetTerm) => {
  const c = t.conditions ?? {};
  const v = t.unit === "pct" ? `${Number(t.value)} %` : fmtVal(t.value, t.unit);
  return `${FIELD_LABEL[t.field] ?? t.field}: ${c.mode === "total" && t.value == null ? "100 %" : t.value == null && c.mode === "prorrata" ? "proporcional" : v}${c.risk_months != null ? ` abans de ${String(c.risk_months)} mesos` : ""}${c.mode && c.mode !== "total" ? ` · ${MODE[String(c.mode)] ?? String(c.mode)}` : ""}`;
};
const refOf = (t: SheetTerm) => { const c = t.conditions ?? {}; const pages = (c.pages as number[] | undefined)?.length ? (c.pages as number[]) : t.page ? [t.page] : []; return [c.clause ? String(c.clause) : null, pages.length ? `pàg. ${pages.join(", ")}` : null].filter(Boolean).join(" · "); };

function ProductSheets({ d, busy, onImport, onEdit }: { d: Detail; busy: boolean; onImport: (ids: string[], confirmManual: boolean) => Promise<void>; onEdit: (t: Term) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [onlyPending, setOnlyPending] = useState(true);
  const terms = d.terms as unknown as SheetTerm[];
  const sheets = useMemo(() => productSheets(terms, (t) => !onlyPending || ["pendent", "revisio_manual"].includes(t.review_status) || t.review_status === "aprovada"), [terms, onlyPending]);
  const pending = d.terms.filter((t) => ["pendent", "revisio_manual"].includes(t.review_status));
  const manual = pending.filter((t) => t.review_status === "revisio_manual" || t.ambiguous || !t.excerpt_found);
  const today = new Date().toISOString().slice(0, 10);
  const before = (t: SheetTerm) => {
    if (t.category === "remuneracio") { const kind = t.field === "per_kwh" ? "per_mwh" : t.field; const r = d.rules.find((x) => x.status === "aprovada" && !x.valid_to && x.kind === kind && norm(x.product ?? "") === norm(t.product ?? "")); return r ? fmtVal(r.value, r.unit) : null; }
    const c = d.clawbacks.find((x) => x.status === "aprovada" && !x.valid_to && x.trigger === t.field); return c ? `${c.pct != null ? `${Number(c.pct)} %` : MODE[c.mode] ?? c.mode}${c.risk_months != null ? ` · ${c.risk_months} mesos` : ""}` : null;
  };
  if (!terms.length) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold">Condicions comercials per producte</h3>
        <span className="text-[12px] text-muted">comissions i decomissions/retrocessions juntes · {pending.length} pendents{manual.length ? `, ${manual.length} amb revisió manual` : ""}</span>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Només pendents i vigents</label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[820px] text-[12.5px]">
          <thead className="bg-elevated text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="w-6" /><th className="px-2 py-2">Comercialitzadora</th><th className="px-2">Producte</th><th className="px-2">Comissió</th><th className="px-2">Decomissió / retrocessió</th><th className="px-2">Referències</th><th className="px-2">Estat</th></tr></thead>
          <tbody>
            {sheets.map((s) => {
              const isOpen = open === s.key;
              const claws = [...s.clawbacks, ...s.general.filter((g) => ["retrocessio", "penalitzacio"].includes(g.category))];
              const pc = d.productContracts?.filter((c) => s.key !== "__general" && norm(c.product ?? "") === norm(s.product)) ?? null;
              const main = claws.find((c) => c.field === "baixa_anticipada") ?? claws[0];
              const risk = pc && main ? productRisk(pc, { pct: main.unit === "pct" ? Number(main.value) : null, penalty: main.unit === "eur" ? Number(main.value) : null, riskMonths: main.conditions?.risk_months != null ? Number(main.conditions.risk_months) : null, mode: (main.conditions?.mode as string) ?? null }, today) : null;
              return [
                <tr key={s.key} className={cn("cursor-pointer border-t border-line align-top hover:bg-ink/[0.02]", s.risky && "bg-red-500/[0.04]")} onClick={() => setOpen(isOpen ? null : s.key)}>
                  <td className="px-1 py-2 text-muted">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  <td className="px-2 py-2">{d.retailer.trade_name}</td>
                  <td className="px-2 py-2 font-medium">{s.product}{s.tariff && <span className="ml-1 text-muted">· {s.tariff}</span>}</td>
                  <td className="px-2 py-2">{s.commissions.length ? s.commissions.map((t) => <span key={t.id} className="block">{termText(t)}</span>) : <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-2">{claws.length ? claws.map((t) => <span key={t.id} className={cn("block", isRiskyClawback(t) && "font-medium text-red-700 dark:text-red-400")}>{clawText(t)}{!t.product && <span className="text-muted"> (general)</span>}</span>) : <span className="text-amber-700 dark:text-amber-400">Cap retrocessió trobada</span>}</td>
                  <td className="px-2 py-2 text-muted">{s.pages.length ? `pàg. ${s.pages.join(", ")}` : "—"}</td>
                  <td className="px-2 py-2">{s.pending ? <Pill className={s.manual ? "bg-red-500/12 text-red-700 dark:text-red-300" : "bg-amber-500/14 text-amber-800 dark:text-amber-300"}>{s.pending} pendents{s.manual ? ` · ${s.manual} revisió manual` : ""}</Pill> : <Pill className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">Importat</Pill>}</td>
                </tr>,
                isOpen && (
                  <tr key={`${s.key}-d`} className="border-t border-line bg-ink/[0.015]"><td /><td colSpan={6} className="px-2 py-3">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <SheetBlock title="Comissions" items={[...s.commissions, ...s.general.filter((g) => g.category === "remuneracio")]} render={termText} before={before} onEdit={onEdit} />
                      <SheetBlock title="Decomissions i retrocessions" items={claws} render={clawText} before={before} onEdit={onEdit} danger />
                      {s.other.length > 0 && <SheetBlock title="Permanència, pagament i vigència" items={[...s.other, ...s.general.filter((g) => !["remuneracio", "retrocessio", "penalitzacio"].includes(g.category))]} render={termText} before={before} onEdit={onEdit} />}
                      {s.key !== "__general" && (
                        <div className="rounded-xl border border-line p-2.5 text-[12px]">
                          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">Risc econòmic</p>
                          {!pc ? <p className="text-muted">Només amb permís econòmic.</p> : !risk ? <p className="text-muted">Sense retrocessió aplicable o sense contractes vius d&apos;aquest producte.</p> : !risk.enough ? <p className="text-muted">{risk.contracts} contractes vius · comissió prevista {eurTxt(risk.expected)}. Falten dades (període de risc o %) per estimar la retrocessió.</p> : (
                            <p>{risk.contracts} contractes vius · comissió prevista <b>{eurTxt(risk.expected)}</b><br />{risk.inRisk} dins del període de risc · retrocessió potencial <b className="text-red-700 dark:text-red-400">{eurTxt(risk.potential)}</b><br />Marge net estimat si es donessin de baixa: <b>{eurTxt(risk.net)}</b></p>
                          )}
                        </div>
                      )}
                    </div>
                  </td></tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      {d.canApprove && pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-ink/[0.03] p-2.5">
          {manual.length > 0 && <label className="flex items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span><b>REVISIÓ MANUAL NECESSÀRIA</b> en {manual.length} condició(ns): he comprovat el seu abast, les excepcions i els fragments amb el document original.</span></label>}
          <Button variant="primary" className="ml-auto font-semibold tracking-wide" disabled={busy || (manual.length > 0 && !confirm)} onClick={() => void onImport(pending.map((t) => t.id), confirm)}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} APROVAR I IMPORTAR CONDICIONS COMERCIALS ({pending.length})</Button>
          <p className="basis-full text-[11.5px] text-muted">Les comissions i les retrocessions s&apos;importen vinculades a la mateixa versió del contracte. Els percentatges sense la fórmula de la base validada no s&apos;importen: corregeix-los d&apos;un en un. Per rebutjar alguna condició, fes-ho al detall de sota abans d&apos;importar.</p>
        </div>
      )}
    </section>
  );
}
const eurTxt = (v: number | null) => (v == null ? "—" : v.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));

function SheetBlock({ title, items, render, before, onEdit, danger }: { title: string; items: SheetTerm[]; render: (t: SheetTerm) => string; before: (t: SheetTerm) => string | null; onEdit: (t: Term) => void; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-line p-2.5">
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{title}</p>
      {!items.length ? <p className="text-[12px] text-muted">Cap condició al document per a aquest producte.</p> : (
        <ul className="space-y-2">{items.map((t) => {
          const c = t.conditions ?? {};
          const b = before(t);
          return (
            <li key={t.id} className={cn("text-[12px]", danger && isRiskyClawback(t) && "rounded-lg bg-red-500/[0.06] p-1.5")}>
              <div className="flex items-start gap-2"><span className={cn("flex-1 font-medium", danger && isRiskyClawback(t) && "text-red-700 dark:text-red-400")}>{render(t)}{!t.product ? " · general" : ""}</span>
                {["pendent", "revisio_manual"].includes(t.review_status) && <button className="text-[11px] text-brand hover:underline" onClick={() => onEdit(t as unknown as Term)}>Corregeix</button>}</div>
              {b && <span className="block text-[11px] text-muted">Versió anterior aprovada: {b}</span>}
              {t.formula && <span className="block font-mono text-[11px]">Fórmula: {t.formula}</span>}
              {c.applies_to ? <span className="block text-[11px] text-muted">Aplica a: {String(c.applies_to).replace("_", " ")}</span> : null}
              {c.exceptions ? <span className="block text-[11px]"><b>Excepcions:</b> {String(c.exceptions)}</span> : null}
              {Array.isArray(c.overrides) && c.overrides.length ? <span className="block text-[11px] text-muted">Prevaleix sobre: {(c.overrides as string[]).join(", ")}</span> : null}
              {Array.isArray(c.related) && c.related.length ? <span className="block text-[11px] text-muted">Relacionada amb: {(c.related as string[]).join(", ")}</span> : null}
              <span className="block text-[11px] italic text-muted">«{t.excerpt.slice(0, 220)}» — {refOf(t) || "sense pàgina"}</span>
              {(t.review_status === "revisio_manual" || t.ambiguous) && ["pendent", "revisio_manual"].includes(t.review_status) && <span className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{humanizeUnits((t as unknown as Term).ambiguity_reason) || "Cal revisar-la"}</span>}
              {t.review_status === "aprovada" && <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">Importada</span>}
            </li>
          );
        })}</ul>
      )}
    </div>
  );
}

function TermEditor({ t, approve, onClose, onSave }: { t: Term; approve: boolean; onClose: () => void; onSave: (patch: Record<string, unknown>, o: { approve: boolean; confirmManual: boolean; baseValidated: boolean }) => Promise<void> }) {
  const [v, setV] = useState({ field: t.field, product: t.product ?? "", tariff: t.tariff ?? "", value: t.value == null ? "" : String(t.value), unit: t.unit ?? "", formula: t.formula ?? "", valid_from: t.valid_from ?? "", valid_to: t.valid_to ?? "", risk: t.conditions?.risk_months != null ? String(t.conditions.risk_months) : "", note: "" });
  const [confirm, setConfirm] = useState(false);
  const [baseOk, setBaseOk] = useState(false);
  const manual = t.review_status === "revisio_manual" || t.ambiguous || !t.excerpt_found;
  const isPct = t.category === "remuneracio" && (v.unit === "pct");
  const patch = () => {
    const p: Record<string, unknown> = {};
    if (v.field !== t.field) p.field = v.field;
    if ((v.product || null) !== t.product) p.product = v.product || null;
    if ((v.tariff || null) !== t.tariff) p.tariff = v.tariff || null;
    if (v.value !== (t.value == null ? "" : String(t.value))) p.value = v.value === "" ? null : Number(v.value.replace(",", "."));
    if ((v.unit || null) !== t.unit) p.unit = v.unit || null;
    if ((v.formula || null) !== t.formula) p.formula = v.formula || null;
    if ((v.valid_from || null) !== t.valid_from) p.valid_from = v.valid_from || null;
    if ((v.valid_to || null) !== t.valid_to) p.valid_to = v.valid_to || null;
    if (v.risk !== (t.conditions?.risk_months != null ? String(t.conditions.risk_months) : "")) p.conditions = { risk_months: v.risk === "" ? null : Number(v.risk) };
    if (v.note) p.note = v.note;
    return p;
  };
  const inp = "mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5";
  return (
    <Modal open onClose={onClose} title={approve ? "Revisar i aprovar condició" : "Corregir la proposta"} width="max-w-2xl"
      footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={approve && ((manual && !confirm) || (isPct && (!baseOk || !v.formula.trim())))} onClick={() => void onSave(patch(), { approve, confirmManual: confirm, baseValidated: baseOk })}>{approve ? "Aprova i incorpora al motor" : "Desa la correcció"}</Button></>}>
      <div className="space-y-3 text-[13px]">
        <blockquote className="rounded-lg bg-ink/[0.04] p-2.5 text-[12.5px] italic">«{t.excerpt}»{t.page ? <span className="not-italic text-muted"> — pàg. {t.page}</span> : null}</blockquote>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>Camp<select className={inp} value={v.field} onChange={(e) => setV({ ...v, field: e.target.value })}>{Object.entries(FIELD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Import / valor<input className={inp} inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></label>
          <label>Unitat<select className={inp} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })}><option value="">—</option>{Object.entries(UNIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Producte<input className={inp} value={v.product} onChange={(e) => setV({ ...v, product: e.target.value })} /></label>
          <label>Peatge / tarifa<input className={inp} value={v.tariff} onChange={(e) => setV({ ...v, tariff: e.target.value })} /></label>
          {t.category !== "remuneracio" && <label>Període de risc (mesos)<input className={inp} inputMode="numeric" value={v.risk} onChange={(e) => setV({ ...v, risk: e.target.value })} /></label>}
          <label>Vigent des de<input type="date" className={inp} value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} /></label>
          <label>Fins a<input type="date" className={inp} value={v.valid_to} onChange={(e) => setV({ ...v, valid_to: e.target.value })} /></label>
        </div>
        <label className="block">Fórmula exacta (base del percentatge o del prorrateig)<input className={inp} value={v.formula} onChange={(e) => setV({ ...v, formula: e.target.value })} placeholder="p. ex. 12,5 % × (increment €/kWh × kWh elegibles)" /></label>
        <label className="block">Nota de revisió<input className={inp} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
        {approve && manual && <label className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5"><input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span><b>REVISIÓ MANUAL NECESSÀRIA.</b> He comprovat aquesta condició amb el contracte original{t.ambiguity_reason ? ` (${humanizeUnits(t.ambiguity_reason)})` : ""}.</span></label>}
        {approve && isPct && <label className="flex items-start gap-2 rounded-lg bg-sky-500/10 p-2.5"><input type="checkbox" className="mt-0.5" checked={baseOk} onChange={(e) => setBaseOk(e.target.checked)} /><span>La fórmula de la base del percentatge és la que estableix el contracte (base validada). Sense això, el motor no pot calcular el percentatge.</span></label>}
        {approve && <p className="text-[11.5px] text-muted">En aprovar: es crea (o versiona) la regla de la capa «Comercialitzadora → Assessoria 3.0» amb aquesta vigència. La versió anterior es conserva per als contractes antics i no es recalcula res d&apos;històric.</p>}
      </div>
    </Modal>
  );
}

/* ======================================================================= documents */

function Documents({ d, reload, setMsg, onAnalyzed }: { d: Detail; reload: () => Promise<void>; setMsg: (m: { tone: "green" | "red" | "blue" | "amber"; text: string } | null) => void; onAnalyzed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<Doc | null>(null);
  const ex = (docId: string) => d.extractions.filter((e) => e.document_id === docId);
  const open = async (id: string) => { try { const r = await rApi.get<{ url: string }>("doc_url", { id }); window.open(r.url, "_blank", "noopener"); } catch (e) { setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) }); } };
  const act = async (id: string, fn: () => Promise<unknown>, ok: string, after?: () => void) => { setBusy(id); try { await fn(); setMsg({ tone: "green", text: ok }); await reload(); after?.(); } catch (e) { setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(null); } };
  if (!d.documents.length) return <Panel title="Cap document" empty="Puja el contracte de col·laboració amb el botó superior." />;
  return (
    <div className="space-y-2.5">
      {d.documents.map((doc) => (
        <Panel key={doc.id} title={<span className="flex items-center gap-2"><FileText size={14} />{doc.title} <span className="text-[11.5px] font-normal text-muted">v{doc.version} · {DOC_STATUS[doc.status]}</span></span>}
          action={<div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => void open(doc.id)}><ExternalLink size={12} /> Obre</Button>
            {d.canEdit && <Button size="sm" disabled={!!busy} onClick={async () => { setBusy(doc.id); setMsg({ tone: "blue", text: "1/2 · La IA llegeix el document sencer… (pot trigar uns minuts)" }); try { const r = await analyzeAndVerify(doc.id, (t) => setMsg({ tone: "blue", text: t })); setMsg({ tone: r.tone, text: r.text }); await reload(); onAnalyzed(); } catch (e) { setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) }); await reload(); } finally { setBusy(null); } }}>{busy === doc.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Torna a analitzar</Button>}
            {d.canEdit && <Button size="sm" onClick={() => setManual(doc)}><Pencil size={12} /> Condició manual</Button>}
            {d.canApprove && doc.status !== "vigent" && doc.status !== "anullat" && <Button size="sm" variant="primary" disabled={busy === doc.id} onClick={() => void act(doc.id, () => rApi.act("doc_activate", {}, doc.id), "Contracte marcat com a vigent (l'anterior queda substituït i es conserva)")}>Activa com a vigent</Button>}
          </div>}>
          <p className="text-[12.5px] text-muted">{doc.kind} · {doc.original_name} · pujat el {fdate(doc.created_at)} · vigència {doc.valid_from ?? "…"} – {doc.valid_to ?? "…"} · avís {doc.renewal_notice_days} dies abans{doc.supersedes_id ? ` · substitueix «${d.documents.find((x) => x.id === doc.supersedes_id)?.title ?? "—"}»` : ""}</p>
          {d.canEdit && <DocDates doc={doc} onSave={(p) => act(doc.id, () => rApi.act("doc_update", p, doc.id), "Dates desades")} />}
          <ul className="mt-2 space-y-1 text-[12px]">{ex(doc.id).map((e) => (
            <li key={e.id} className="rounded-lg bg-ink/[0.03] px-2 py-1.5">
              <b>{e.method === "ia" ? `IA${e.model ? ` (${e.model})` : ""}` : "Lector local"}</b> · {fdate(e.created_at)} · {e.status}{e.ocr_used ? " · OCR" : ""}{e.pages ? ` · ${e.pages} pàg.` : ""}
              {e.method === "ia" && e.status === "completada" && (() => { const v = (e.summary?.verification ?? null) as { status?: string } | null; return v?.status === "feta" ? <span className="text-emerald-700 dark:text-emerald-400"> · coherència comprovada</span> : v ? <>{" · "}<button className="text-brand underline" disabled={!!busy} onClick={() => void act(doc.id, () => rApi.act("verify", {}, e.id), "Comprovació de coherència feta", onAnalyzed)}>fer la comprovació de coherència</button></> : null; })()}
              {e.error && <span className="block text-red-600">{e.error}</span>}
              {(e.warnings ?? []).map((w, i) => <span key={i} className="block text-amber-700 dark:text-amber-400">{humanizeUnits(w)}</span>)}
            </li>))}</ul>
        </Panel>
      ))}
      {manual && <ManualTerm doc={manual} onClose={() => setManual(null)} onDone={async () => { setManual(null); setMsg({ tone: "green", text: "Condició afegida a la revisió" }); await reload(); onAnalyzed(); }} />}
    </div>
  );
}

function DocDates({ doc, onSave }: { doc: Doc; onSave: (p: Record<string, unknown>) => void }) {
  const [v, setV] = useState({ valid_from: doc.valid_from ?? "", valid_to: doc.valid_to ?? "", renewal_notice_days: doc.renewal_notice_days });
  const dirty = v.valid_from !== (doc.valid_from ?? "") || v.valid_to !== (doc.valid_to ?? "") || v.renewal_notice_days !== doc.renewal_notice_days;
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 text-[12px]">
      <label>Des de<input type="date" className="ml-1 rounded-md border border-line bg-surface px-1.5 py-0.5" value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} /></label>
      <label>Fins a<input type="date" className="ml-1 rounded-md border border-line bg-surface px-1.5 py-0.5" value={v.valid_to} onChange={(e) => setV({ ...v, valid_to: e.target.value })} /></label>
      <label>Avís (dies)<input type="number" min={0} max={730} className="ml-1 w-16 rounded-md border border-line bg-surface px-1.5 py-0.5" value={v.renewal_notice_days} onChange={(e) => setV({ ...v, renewal_notice_days: Number(e.target.value) })} /></label>
      {dirty && <Button size="sm" onClick={() => onSave({ valid_from: v.valid_from || null, valid_to: v.valid_to || null, renewal_notice_days: v.renewal_notice_days })}>Desa</Button>}
    </div>
  );
}

function ManualTerm({ doc, onClose, onDone }: { doc: Doc; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => { const x = String(f.get(k) ?? "").replace(",", "."); return x ? Number(x) : null; };
    try {
      await rApi.act("term_add", { documentId: doc.id, category: String(f.get("category")), field: String(f.get("field")), product: String(f.get("product") || "") || null, value: n("value"), unit: String(f.get("unit") || "") || null, formula: String(f.get("formula") || "") || null, excerpt: String(f.get("excerpt")), page: n("page"), conditions: n("risk") != null ? { risk_months: n("risk") } : {} });
      onDone();
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
  };
  const inp = "mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5";
  return (
    <Modal open onClose={onClose} title={`Condició manual · ${doc.title}`} width="max-w-xl">
      <form onSubmit={submit} className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label>Categoria<select name="category" className={inp}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Camp<select name="field" className={inp}>{Object.entries(FIELD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Producte<input name="product" className={inp} /></label>
        <label>Valor<input name="value" inputMode="decimal" className={inp} /></label>
        <label>Unitat<select name="unit" className={inp}><option value="">—</option>{Object.entries(UNIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Període de risc (mesos)<input name="risk" inputMode="numeric" className={inp} /></label>
        <label className="sm:col-span-2">Fórmula exacta<input name="formula" className={inp} /></label>
        <label className="sm:col-span-2">Fragment literal del contracte *<textarea name="excerpt" required rows={3} className={inp} /></label>
        <label>Pàgina<input name="page" inputMode="numeric" className={inp} /></label>
        {err && <div className="sm:col-span-2"><Notice tone="red">{err}</Notice></div>}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" onClick={onClose}>Cancel·la</Button><Button type="submit" variant="primary">Afegeix a la revisió</Button></div>
      </form>
    </Modal>
  );
}

/* ======================================================================= regles aprovades */

function Rules({ d }: { d: Detail }) {
  const doc = new Map(d.documents.map((x) => [x.id, x]));
  const today = new Date().toISOString().slice(0, 10);
  const live = (from: string, to: string | null, status: string) => status === "aprovada" && from <= today && (!to || to >= today);
  return (
    <div className="space-y-3">
      <Panel title="Remuneració (Comercialitzadora → Assessoria 3.0)" empty={!d.rules.length && "Cap regla aprovada encara"}>
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-[12.5px]">
          <thead className="text-left text-[11.5px] text-muted"><tr><th className="py-1.5">Regla</th><th>Tipus</th><th className="text-right">Valor</th><th>Vigència</th><th>Versió</th><th>Font</th><th>Estat</th></tr></thead>
          <tbody className="divide-y divide-line">{d.rules.map((r) => (
            <tr key={r.id}><td className="py-1.5">{r.name}</td><td>{FIELD_LABEL[r.kind] ?? r.kind}{r.unit === "pct" && !r.base_validated ? <span className="block text-[11px] text-amber-600">Base no validada</span> : null}</td>
              <td className="text-right tnum">{fmtVal(r.value, r.unit)}{(r.conditions as { source_unit?: string }).source_unit === "eur_kwh" ? <span className="block text-[11px] text-muted">({String((r.conditions as { source_value?: number }).source_value)} €/kWh)</span> : null}</td>
              <td>{r.valid_from} – {r.valid_to ?? "…"}</td><td>v{r.version}</td><td className="text-[11.5px] text-muted">{r.source_document_id ? doc.get(r.source_document_id)?.title ?? "—" : "Manual"}</td>
              <td>{live(r.valid_from, r.valid_to, r.status) ? <Pill className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">Vigent</Pill> : <Pill className="bg-ink/[0.06] text-muted">{r.status === "retirada" ? "Retirada" : "Històrica"}</Pill>}</td></tr>))}</tbody>
        </table></div>
        <p className="mt-2 text-[11px] text-muted">Les regles es gestionen (retirar, simular) a «Economia › Comissions». Les històriques es conserven per als contractes antics.</p>
      </Panel>
      <Panel title="Retrocessions i penalitzacions" empty={!d.clawbacks.length && "Cap regla de retrocessió aprovada"}>
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-[12.5px]">
          <thead className="text-left text-[11.5px] text-muted"><tr><th className="py-1.5">Fet desencadenant</th><th>Període de risc</th><th>Inici del còmput</th><th>Retorn</th><th>Excepcions</th><th>Vigència</th><th>Versió</th></tr></thead>
          <tbody className="divide-y divide-line">{d.clawbacks.map((c) => (
            <tr key={c.id}><td className="py-1.5">{FIELD_LABEL[c.trigger] ?? c.trigger}</td><td>{c.risk_months != null ? `${c.risk_months} mesos` : "—"}</td><td>{c.start_event}</td>
              <td>{MODE[c.mode]}{c.pct != null && c.mode !== "total" ? ` ${Number(c.pct)} %` : ""}{c.penalty_eur != null ? ` ${Number(c.penalty_eur)} €` : ""}{c.formula ? <span className="block font-mono text-[11px]">{c.formula}</span> : null}</td>
              <td className="text-[11.5px]">{c.exceptions ?? "—"}</td><td>{c.valid_from} – {c.valid_to ?? "…"}</td><td>v{c.version}</td></tr>))}</tbody>
        </table></div>
        <p className="mt-2 text-[11px] text-muted">Una retrocessió real només es registra amb evidència (línia de liquidació o justificació) i per Direcció.</p>
      </Panel>
    </div>
  );
}

/* ======================================================================= fitxa */

function Sheet({ d, reload, setMsg }: { d: Detail; reload: () => Promise<void>; setMsg: (m: { tone: "green" | "red" | "blue" | "amber"; text: string } | null) => void }) {
  const r = d.retailer;
  const [logo, setLogo] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim() || null;
    try {
      await rApi.act("save", { trade_name: s("trade_name"), legal_name: s("legal_name"), tax_id: s("tax_id"), website: s("website"), contact_name: s("contact_name"), phone: s("phone"), email: s("email") ?? "", status: s("status"), services: f.getAll("services").map(String), aliases: String(f.get("aliases") ?? "").split(",").map((x) => x.trim()).filter(Boolean), special_conditions: s("special_conditions"), notes: s("notes") }, r.id);
      setMsg({ tone: "green", text: "Fitxa desada" }); await reload();
    } catch (x) { setMsg({ tone: "red", text: x instanceof Error ? x.message : String(x) }); }
  };
  const inp = "mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5";
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-line bg-surface p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
      <label>Nom comercial<input name="trade_name" defaultValue={r.trade_name} required className={inp} disabled={!d.canEdit} /></label>
      <label>Raó social<input name="legal_name" defaultValue={r.legal_name ?? ""} className={inp} disabled={!d.canEdit} /></label>
      <label>CIF<input name="tax_id" defaultValue={r.tax_id ?? ""} className={inp} disabled={!d.canEdit} /></label>
      <label>Web<input name="website" defaultValue={r.website ?? ""} className={inp} disabled={!d.canEdit} /></label>
      <label>Persona de contacte<input name="contact_name" defaultValue={r.contact_name ?? ""} className={inp} disabled={!d.canEdit} /></label>
      <label>Telèfon<input name="phone" defaultValue={r.phone ?? ""} className={inp} disabled={!d.canEdit} /></label>
      <label>Email<input name="email" type="email" defaultValue={r.email ?? ""} className={inp} disabled={!d.canEdit} /></label>
      <label>Estat<select name="status" defaultValue={r.status} className={inp} disabled={!d.canEdit}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label>Àlies (noms als contractes del CRM, separats per comes)<input name="aliases" defaultValue={r.aliases.join(", ")} className={inp} disabled={!d.canEdit} /></label>
      <fieldset className="sm:col-span-2 lg:col-span-3"><legend>Serveis</legend><div className="mt-1 flex flex-wrap gap-3">{Object.entries(SERVICES).map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="services" value={k} defaultChecked={r.services.includes(k)} disabled={!d.canEdit} />{l}</label>)}</div></fieldset>
      <label className="sm:col-span-2 lg:col-span-3">Condicions especials<textarea name="special_conditions" rows={3} defaultValue={r.special_conditions ?? ""} className={inp} disabled={!d.canEdit} /></label>
      <label className="sm:col-span-2 lg:col-span-3">Notes<textarea name="notes" rows={2} defaultValue={r.notes ?? ""} className={inp} disabled={!d.canEdit} /></label>
      {d.canEdit && <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-3">
        <DropArea className="inline-block" accept=".png,.jpg,.jpeg" label="Logo" onFiles={async ([f]) => { setLogo(true); try { await uploadRetailerFile(f, { retailerId: r.id, purpose: "logo" }, () => undefined); await reload(); } catch (x) { setMsg({ tone: "red", text: x instanceof Error ? x.message : String(x) }); } finally { setLogo(false); } }}><label className="cursor-pointer text-[12.5px] text-brand">{logo ? "Pujant el logo…" : "Canvia el logo (PNG/JPG, màx. 2 MB) o arrossega'l aquí"}<input type="file" accept=".png,.jpg,.jpeg" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setLogo(true); try { await uploadRetailerFile(f, { retailerId: r.id, purpose: "logo" }, () => undefined); await reload(); } catch (x) { setMsg({ tone: "red", text: x instanceof Error ? x.message : String(x) }); } finally { setLogo(false); } }} /></label></DropArea>
        <Button type="submit" variant="primary">Desa la fitxa</Button>
      </div>}
    </form>
  );
}

/* ======================================================================= estat (Fase 10): activar · desactivar · arxivar · eliminar */
type Deps = { deps: { label: string; count: number }[]; total: number; safe: boolean };
function StatusActions({ r, reload, setMsg }: { r: { id: string; trade_name: string; status: string }; reload: () => Promise<void>; setMsg: (m: { tone: "green" | "red" | "blue" | "amber"; text: string } | null) => void }) {
  const [open, setOpen] = useState<null | "estat" | "eliminar">(null);
  const [busy, setBusy] = useState(false);
  const [deps, setDeps] = useState<Deps | null>(null);
  const [name, setName] = useState("");
  const [step2, setStep2] = useState(false);
  const change = async (status: string, label: string) => {
    setBusy(true);
    try { await rApi.act("set_status", { status }, r.id); refreshRetailerOptions(); setMsg({ tone: "green", text: `${r.trade_name}: ${label}.` }); setOpen(null); await reload(); }
    catch (e) { setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const openDelete = async () => {
    setOpen("eliminar"); setDeps(null); setName(""); setStep2(false);
    try { setDeps(await rApi.get<Deps>("deps", { id: r.id })); } catch (e) { setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) }); setOpen(null); }
  };
  const del = async () => {
    setBusy(true);
    try { await rApi.act("delete", { confirmName: name, confirmed: true }, r.id); useApp.getState().toast({ title: "Comercialitzadora eliminada", body: r.trade_name, tone: "ok" }); useApp.getState().navigate("comercialitzadores", {}, { replace: true }); }
    catch (e) { setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) }); setOpen(null); }
    finally { setBusy(false); }
  };
  const off = ["inactiva", "arxivada"].includes(r.status);
  return (
    <>
      <div className="flex flex-wrap gap-1.5" aria-label="Estat de la comercialitzadora">
        {off || r.status !== "activa" ? <Button size="sm" disabled={busy} onClick={() => void change("activa", off ? "reactivada" : "activada")}>{off ? "Reactiva" : "Activa"}</Button> : null}
        {r.status !== "inactiva" && r.status !== "arxivada" && <Button size="sm" disabled={busy} onClick={() => void change("inactiva", "desactivada")}>Desactiva</Button>}
        {r.status !== "arxivada" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change("arxivada", "arxivada")}>Arxiva</Button>}
        <Button size="sm" variant="ghost" className="text-lost" disabled={busy} onClick={() => void openDelete()}>Elimina…</Button>
      </div>
      {open === "eliminar" && (
        <Modal open onClose={() => setOpen(null)} title={`Eliminar ${r.trade_name}`}
          footer={<><Button variant="ghost" onClick={() => setOpen(null)}>Cancel·la</Button>
            {deps && !deps.safe ? <><Button onClick={() => void change("inactiva", "desactivada")}>Desactiva-la</Button><Button variant="primary" onClick={() => void change("arxivada", "arxivada")}>Arxiva-la</Button></>
              : !step2 ? <Button variant="primary" disabled={!deps} onClick={() => setStep2(true)}>Continua</Button>
              : <Button variant="primary" className="bg-lost hover:bg-lost/90" disabled={busy || name.trim().toLowerCase() !== r.trade_name.toLowerCase()} onClick={() => void del()}>Elimina definitivament</Button>}</>}>
          {!deps ? <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Comprovant dependències…</p> : !deps.safe ? (
            <div className="space-y-2 text-[13px]">
              <p><b>No es pot eliminar</b>: té registres relacionats que s&apos;han de conservar.</p>
              <ul className="list-disc pl-5 text-[12.5px]">{deps.deps.map((x) => <li key={x.label}>{x.label}: {x.count < 0 ? "no s'ha pogut comprovar" : x.count}</li>)}</ul>
              <p className="text-muted">Pots desactivar-la (no surt per a feina nova) o arxivar-la (no la fas servir més). En tots dos casos es conserva tot l&apos;historial.</p>
            </div>
          ) : !step2 ? (
            <p className="text-[13px]">No té contractes, tarifes, comissions, retrocessions, liquidacions, documents ni incidències relacionats. L&apos;eliminació és <b>definitiva</b> i no es pot desfer.</p>
          ) : (
            <label className="block text-[13px]">Per confirmar, escriu el nom exacte <b>{r.trade_name}</b>:
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-label="Nom de confirmació" />
            </label>
          )}
        </Modal>
      )}
    </>
  );
}
