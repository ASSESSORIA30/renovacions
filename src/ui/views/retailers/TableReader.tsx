"use client";
/**
 * LECTOR IA DE TARIFES · plantilles de TAULA (Fase 12: Iberdrola «Energía» i qualsevol full amb una fila per tarifa).
 *
 *   ESQUERRA: l'Excel original (pestanya triada; les cel·les de la tarifa seleccionada es ressalten).
 *   CENTRE:   les tarifes interpretades (preu original, descompte, P1–P6 finals, estat i regles aplicades).
 *   DRETA:    el xat per ensenyar-li: proposa una regla, mostra l'abans/després i deixa triar on es guarda
 *             (només aquest document · aquest producte · aquesta plantilla · regla general).
 *   + «ENSENYAR A LA IA» amb una tarifa d'exemple i «SIMULAR DESCOMPTES».
 * Les regles guardades creen una versió nova de la plantilla (Supabase) i persisteixen entre sessions.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Bot, CheckCircle2, GraduationCap, Loader2, Send, ShieldCheck, Sparkles, Upload, XCircle } from "lucide-react";
import { CLASSIFICATION_LABEL, applyTemplate, colIdx, colName, templateChecks, validatedPct, type Product, type ReadResult, type TemplateDef, type WorkbookGrid } from "@/comparator/xlsx-template";
import { INTERP_LABEL, SCOPE_LABEL, type InterpStatus, type ReadingRule, type RuleScope } from "@/comparator/tariff-table";
import { chunkForAi, compareWithReference, inferFromExample, parseRuleChat, readDiff, shortHeader, withScope, type ExampleResult, type InterpChange, type ReferenceRow } from "@/comparator/reading-rules";
import { loadCatalog } from "@/comparator/client";
import { DropZone } from "../../components/DropZone";
import { readWorkbook } from "./templates-api";
import { knowledgeFor } from "@/comparator/reading-knowledge";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, cn } from "../../components/ui";
import { SimulateDiscountsButton } from "../comparatives/DiscountSimulator";
import { TemplateStatusPill } from "./StatusPill";
import { tplApi, type TemplateDetail } from "./templates-api";

const f6 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { minimumFractionDigits: 4, maximumFractionDigits: 6 }));
const STATUS_TONE: Record<InterpStatus, "green" | "amber" | "orange" | "red"> = { interpretada: "green", revisar: "amber", pendent: "orange", fallida: "red" };
type Msg = { role: "user" | "assistant"; text: string; rule?: ReadingRule | null };
type Proposal = { rule: ReadingRule; product: Product | null; text: string; example?: { result: ExampleResult; expected: (number | null)[]; explanation: string; discountApplied: boolean | null } };

export function CountsBar({ read }: { read: ReadResult }) {
  const c = read.table?.counts;
  if (!c) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="read-counts">
      <Badge tone="blue">{c.identified} identificades</Badge><Badge tone="green">{c.interpreted} interpretades</Badge>
      <Badge tone="amber">{c.review + c.pending} pendents ({c.review} a revisar · {c.pending} sense regla)</Badge><Badge tone={c.failed ? "red" : "zinc"}>{c.failed} fallides</Badge>
      {read.table?.dataRange && <span className="text-muted">Rang de dades: {read.sheet}!{read.table.dataRange}</span>}
    </div>
  );
}

/** Taula central: tarifes interpretades (preus originals → descompte → P1–P6 finals). */
export function InterpretedTable({ read, selected, onSelect, affected, filter }: { read: ReadResult; selected?: string | null; onSelect?: (p: Product) => void; affected?: Set<string>; filter?: InterpStatus | "totes" }) {
  const list = read.products.filter((p) => !filter || filter === "totes" || p.interp?.status === filter);
  return (
    <div className="max-h-[520px] overflow-auto rounded-xl border border-line" data-testid="interpreted-table">
      <table className="w-max min-w-full text-[11.5px]">
        <thead className="sticky top-0 z-10 bg-elevated text-left text-[10px] uppercase text-muted">
          <tr><th className="px-2 py-1">Fila</th><th>Producte</th><th>Tipus · estat</th><th>Energia final P1–P6 (€/kWh)</th><th>Original</th><th>Descompte</th><th>Potència final (€/kW any)</th></tr>
        </thead>
        <tbody>{list.map((p) => {
          const it = p.interp!;
          return (
            <tr key={p.key} data-testid={`row-${p.row}`} onClick={() => onSelect?.(p)} className={cn("cursor-pointer border-t border-line align-top hover:bg-brand/[0.04]", selected === p.key && "bg-brand/10", affected?.has(p.key) && "outline outline-1 -outline-offset-1 outline-amber-500")}>
              <td className="px-2 py-1 text-muted">{p.row}{it.hidden && <span title="Fila oculta"> 👁</span>}</td>
              <td className="max-w-[190px] py-1 pr-2 font-medium">{p.name}<span className="block text-[10px] font-normal text-muted">{p.tariff ?? "—"}{it.eligibility.maxKw != null ? ` · ≤ ${it.eligibility.maxKw} kW` : it.eligibility.minKw != null ? ` · > ${it.eligibility.minKw} kW` : ""}</span></td>
              <td className="pr-2"><div className="flex flex-col items-start gap-0.5"><Badge tone={it.classification === "indexada" ? "blue" : it.classification === "pendent" ? "amber" : "green"}>{CLASSIFICATION_LABEL[it.classification]}</Badge><Badge tone={STATUS_TONE[it.status]}>{INTERP_LABEL[it.status]}</Badge>{it.estimate && <span className="text-[10px] text-amber-700 dark:text-amber-300">estimació</span>}</div></td>
              <td className="tnum whitespace-nowrap pr-2">{it.margin ? <span className="font-semibold text-blue-700 dark:text-blue-300">Marge {f6(it.margin.eurKwh)} €/kWh = {it.margin.eurMWh} €/MWh</span> : it.energyFinal.slice(0, it.periods).map((v, i) => <span key={i} title={`P${i + 1}`} className={cn("mr-2", it.estimate && "text-amber-700 dark:text-amber-300")} data-testid={`p${p.row}-e${i + 1}`}>{f6(v)}</span>)}</td>
              <td className="tnum">{it.source.map((s) => <span key={s.letter} title={`${s.cell} · ${s.header}`} className="block whitespace-nowrap">{shortHeader(s.header, s.letter).replace(/^preu /, "")}: {f6(s.v)}</span>)}</td>
              <td className="max-w-[110px] text-[10.5px]" title={p.discountLabel ?? ""}><span className="line-clamp-2">{p.discountLabel ?? "—"}</span><span className="block font-medium">{it.energyPct ? `−${it.energyPct} % E` : "—"}{it.powerPct ? ` · −${it.powerPct} % P` : ""}</span></td>
              <td className="tnum max-w-[160px] pr-2 text-[10.5px] text-muted">{it.powerFinal.filter((v) => v != null).map((v) => f6(v)).join(" · ")}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export function TableReader({ templateId, sample, draft, retailerId, supplier, isAdmin, onClose }: { templateId: string | null; sample?: WorkbookGrid; draft?: TemplateDef; retailerId: string | null; supplier: string; isAdmin: boolean; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const me = useApp((s) => s.snap?.me.name ?? null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [def, setDef] = useState<TemplateDef | null>(draft ?? null);
  const [wb, setWb] = useState<WorkbookGrid | null>(sample ?? null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [docRules, setDocRules] = useState<ReadingRule[]>([]);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<InterpStatus | "totes">("totes");
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: "He llegit totes les files de la taula amb el parser d'Excel i hi he aplicat les regles validades. Clica una tarifa al centre i explica'm què he interpretat malament, per exemple: «P1–P5 promocionat i P6 no promocionat», «el Plan OMIE és indexat i el valor és el marge», «el descompte de la columna O afecta energia i potència» o «aplica-ho a tots els productes equivalents»." }]);
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [lastRule, setLastRule] = useState<ReadingRule | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [teaching, setTeaching] = useState<(number | null)[] | true | false>(false);
  const [refRows, setRefRows] = useState<{ title: string; rows: ReferenceRow[] } | null>(null);
  const [material, setMaterial] = useState<{ name: string; text: string }[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    if (!templateId) return;
    const d = await tplApi.get(templateId);
    setDetail(d);
    if (d.version) { setDef(d.version.definition); if (!sample) setWb(d.version.sample_grid); }
  };
  useEffect(() => { void reload().catch((e) => toast({ title: "No s'ha pogut obrir la plantilla", body: e instanceof Error ? e.message : String(e), tone: "err" })); }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const general = useMemo(() => (detail?.generalRules ?? []).map((g) => g.rule), [detail]);
  const read = useMemo(() => (def && wb ? applyTemplate(wb, def, { force: true, sheet, extraRules: [...general, ...docRules] }) : null), [def, wb, sheet, general, docRules]);
  const after = useMemo(() => (proposal && def && wb ? applyTemplate(wb, def, { force: true, sheet, extraRules: [...general, ...docRules, proposal.rule] }) : null), [proposal, def, wb, sheet, general, docRules]);
  const changes: InterpChange[] = useMemo(() => (read && after ? readDiff(read, after) : []), [read, after]);
  const affected = useMemo(() => new Set(changes.map((c) => c.key)), [changes]);
  const checks = useMemo(() => (def ? templateChecks(def, read) : []), [def, read]);
  const sel = read?.products.find((p) => p.key === selKey) ?? null;
  const g = wb?.sheets.find((s) => s.name === (read?.sheet || def?.table?.sheetName)) ?? null;
  const kn = knowledgeFor(def?.knowledge ?? null);
  const pending = (detail?.library ?? []).filter((r) => r.status === "proposada");

  useEffect(() => { if (sel && gridRef.current) gridRef.current.querySelector(`[data-r="${sel.row}"]`)?.scrollIntoView({ block: "center" }); }, [sel]);

  const send = () => {
    const m = text.trim();
    if (!m || !read) return;
    setText("");
    const r = parseRuleChat(m, { product: sel, products: read.products, last: lastRule, author: me });
    setMsgs((x) => [...x, { role: "user", text: m }, { role: "assistant", text: r.reply, rule: r.rule }]);
    if (r.rule) { setProposal({ rule: r.rule, product: sel, text: m }); setLastRule(r.rule); }
  };
  const save = async (scope: RuleScope) => {
    if (!proposal) return;
    const rule = withScope(proposal.rule, scope, proposal.product);
    if (scope === "document") {
      setDocRules((x) => [...x, { ...rule, approved: true }]);
      setMsgs((x) => [...x, { role: "assistant", text: `✓ Aplicada només a aquest document («${rule.title}»). No s'ha guardat a la plantilla.` }]);
      setProposal(null);
      return;
    }
    if (!templateId) { toast({ title: "Desa primer la plantilla", body: "Les regles es guarden amb una versió de la plantilla.", tone: "err" }); return; }
    setBusy("Guardant la regla…");
    try {
      const ex = proposal.example;
      const r = await tplApi.learn({
        templateId, rule, scope, instruction: proposal.text,
        example: ex && proposal.product ? { productKey: proposal.product.key, productName: proposal.product.name, row: proposal.product.row, expected: ex.expected, explanation: ex.explanation, discountApplied: ex.discountApplied, explained: ex.result.explained } : null,
      });
      setMsgs((x) => [...x, { role: "assistant", text: `✓ Regla guardada (${SCOPE_LABEL[scope].toLowerCase()})${r.version ? ` a la versió ${r.version} de la plantilla` : " a la biblioteca"}. ${r.approved ? "Aprovada per Direcció." : "Queda PENDENT D'APROVAR per Direcció: fins llavors les tarifes afectades surten «a revisar»."}${r.warning ? ` ${r.warning}` : ""}` }]);
      toast({ title: "Regla guardada", body: r.approved ? "Es recordarà en els documents següents." : "Pendent d'aprovació de Direcció.", tone: "ok" });
      setProposal(null);
      await reload();
    } catch (e) { toast({ title: "No s'ha pogut guardar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  const createTemplate = async () => {
    if (!def || !wb) return;
    setBusy("Creant la plantilla…");
    try {
      const r = await tplApi.create({ retailerId, supplier, name: def.name, definition: def, sample: wb, note: `Plantilla de taula: pestanya «${read?.sheet}»${kn ? ` · ${kn.label}` : ""}` });
      toast({ title: "Plantilla creada (pendent de verificació)", body: "Ara ja pots guardar-hi regles apreses.", tone: "ok" });
      void r;
      onClose();
    } catch (e) { toast({ title: "No s'ha pogut crear", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  const decide = async (id: string, decision: "aprovada" | "rebutjada") => {
    setBusy("Desant la decisió…");
    try { await tplApi.decideRule(id, decision); toast({ title: decision === "aprovada" ? "Regla aprovada" : "Regla rebutjada", tone: "ok" }); await reload(); }
    catch (e) { toast({ title: "No s'ha pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  const approveBuiltin = (rid: string) => {
    const kr = kn?.rules.find((r) => r.id === rid);
    if (!kr) return;
    setProposal({ rule: { ...kr, set: { ...kr.set, review: "" }, approved: false, source: "direccio", explanation: `${kr.explanation} Confirmat per Direcció.` }, product: sel, text: `Confirmo la regla «${kr.title}»` });
    setMsgs((x) => [...x, { role: "assistant", text: `Proposo confirmar la regla «${kr.title}». Guarda-la per a la plantilla perquè quedi aprovada.` }]);
  };
  const verify = async () => {
    if (!templateId || !detail) return;
    setBusy("Verificant…");
    try {
      const r = await tplApi.verify(templateId, detail.template.current_version);
      toast(r.verified ? { title: "Plantilla VERIFICADA", tone: "ok" } : { title: "Encara no es pot verificar", body: r.message, tone: "err" });
      await reload();
    } catch (e) { toast({ title: "No s'ha pogut verificar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  const askAi = async () => {
    if (!read) return;
    const rows = read.products.filter((p) => p.interp?.status === "pendent" || p.interp?.status === "revisar");
    if (!rows.length) { setMsgs((x) => [...x, { role: "assistant", text: "No hi ha cap tarifa pendent per preguntar a la IA." }]); return; }
    setBusy("Preguntant a la IA (per fragments)…");
    try {
      const chunks = chunkForAi(rows, 12000);
      const all: { row: number; title: string; set: Record<string, unknown>; explanation: string }[] = [];
      for (const c of chunks) all.push(...(await tplApi.aiSuggest(supplier, c)).proposals);
      setMsgs((x) => [...x, { role: "assistant", text: all.length ? `La IA proposa (cal revisar-ho; no s'aplica res sol):\n${all.map((a) => `• Fila ${a.row}: ${a.title} — ${a.explanation}`).join("\n")}` : "La IA no ha proposat cap regla segura." }]);
      const first = all[0];
      const p = first ? read.products.find((x) => x.row === first.row) : null;
      if (first && p) setProposal({ rule: { id: `ia:${Date.now().toString(36)}`, title: `${p.name}: ${first.title}`, scope: "producte", match: { product: p.name, tariffs: p.tariff ? [p.tariff] : null, priceCount: p.interp?.priceCount ?? null }, set: first.set, explanation: first.explanation, source: "ia", approved: false }, product: p, text: "Proposta de la IA" });
    } catch (e) { setMsgs((x) => [...x, { role: "assistant", text: `IA no disponible: ${e instanceof Error ? e.message : String(e)}. El lector local i el xat continuen funcionant.` }]); }
    finally { setBusy(null); }
  };

  const loadReference = async (f: File) => {
    if (!read) return;
    try {
      const c = compareWithReference(read, await readWorkbook(f));
      if (c.error) { toast({ title: "No s'ha pogut fer servir l'Excel", body: c.error, tone: "err" }); return; }
      setRefRows({ title: `Interpretació correcta · ${f.name}`, rows: c.rows });
    } catch (e) { toast({ title: "No s'ha pogut llegir", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const compareCatalog = async () => {
    if (!read) return;
    try {
      const items = (await loadCatalog()).items.filter((o) => o.status === "activa" && o.supplierName.toLowerCase() === supplier.toLowerCase());
      const cells = [["Producte", "P1", "P2", "P3", "P4", "P5", "P6"].map((v) => ({ v, t: "s" })), ...items.map((o) => [{ v: o.productName, t: "s" }, ...Array.from({ length: 6 }, (_, i) => { const v = o.contractType === "fix24h" ? o.energy24h : o.energy[i]; return v == null ? null : { v, t: "n" }; })])];
      const c = compareWithReference(read, { sheets: [{ name: "catàleg", rows: cells.length, cols: 7, cells }] });
      setRefRows({ title: `Tarifes aprovades del catàleg (${items.length})`, rows: c.rows });
    } catch (e) { toast({ title: "No s'ha pogut llegir el catàleg", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const loadMaterial = async (f: File) => {
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      let text = "";
      if (/\.pdf$/i.test(f.name)) { const { extractText } = await import("unpdf"); const r = await extractText(buf, { mergePages: true }); text = Array.isArray(r.text) ? r.text.join("\n") : r.text; }
      else if (/\.docx$/i.test(f.name)) { const { docxText } = await import("@/server/doc-text"); text = (await docxText(buf)).pages.join("\n"); }
      else text = new TextDecoder().decode(buf);
      setMaterial((m) => [...m, { name: f.name, text: text.slice(0, 60_000) || "(sense text: pot ser un document escanejat)" }]);
    } catch (e) { toast({ title: "No s'ha pogut llegir el document", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };

  if (!def) return <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Obrint la plantilla…</p>;
  const t = def.table!;
  const selCells = new Set(sel ? [...sel.power, ...sel.energy, ...(sel.fixedTerm ? [sel.fixedTerm] : [])].map((x) => x.cell.replace(/^.*!/, "")) : []);
  const shownCols = g ? Math.min(g.cols, colIdx(t.cols.powerDay[t.cols.powerDay.length - 1] ?? "V") + 1) : 0;
  return (
    <div className="space-y-3" data-testid="table-reader">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[16px] font-semibold">{def.supplier} · {def.name}</h3>
        {detail ? <TemplateStatusPill status={detail.template.status} /> : <Badge tone="amber">Nova (sense desar)</Badge>}
        {detail && <span className="text-[12px] text-muted">v{detail.template.current_version}{detail.template.verified_version ? ` · verificada v${detail.template.verified_version}` : ""}</span>}
        {kn && <Badge tone="blue"><BookOpen size={11} /> {kn.label}</Badge>}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onClose}>Tanca</Button>
          <Button onClick={() => setTeaching(true)} disabled={!sel} title={sel ? "" : "Selecciona una tarifa"} data-testid="teach-ai"><GraduationCap size={14} /> ENSENYAR A LA IA</Button>
          {!templateId && <Button variant="primary" disabled={!!busy || !read?.products.length} onClick={() => void createTemplate()}><Upload size={14} /> Desa la plantilla</Button>}
          {isAdmin && templateId && <Button disabled={!!busy || detail?.template.status === "verificada"} onClick={() => void verify()}><ShieldCheck size={14} /> Verificar</Button>}
        </span>
      </div>
      {/* pestanya de preus: es mostra i es pot confirmar o canviar; mai es canvia sola */}
      {wb && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px]" data-testid="sheet-picker">
          <span className="font-semibold">Pestanya de preus:</span>
          {wb.sheets.map((s) => {
            const active = (read?.sheet || null) === s.name;
            const role = t.ignoredSheets.includes(s.name) ? "no s'utilitza" : t.complementarySheets.includes(s.name) ? "complementària" : s.name === t.sheetName ? "font principal" : "";
            return <button key={s.name} onClick={() => setSheet(s.name === t.sheetName ? null : s.name)} className={cn("rounded-lg px-2 py-0.5 ring-1 ring-inset", active ? "bg-brand text-white ring-brand" : "ring-line hover:bg-elevated")}>{s.name}{role && <span className="ml-1 text-[10.5px] opacity-75">({role})</span>}</button>;
          })}
          {read?.sheet === t.sheetName && !sheet && <span className="flex items-center gap-1 text-ren"><CheckCircle2 size={13} /> «{t.sheetName}» detectada automàticament</span>}
          {sheet && <Badge tone="amber">Triada a mà</Badge>}
        </div>
      )}
      {read?.table?.needsSheet && <Notice tone="red"><AlertTriangle size={14} className="mr-1 inline" />{read.compatibility.differences[0]}</Notice>}
      {read && read.compatibility.status === "incompatible" && !read.table?.needsSheet && <Notice tone="red">S&apos;ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura. {read.compatibility.differences.slice(0, 4).join(" · ")}</Notice>}
      {read && <CountsBar read={read} />}
      {pending.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-2 text-[12px]" data-testid="pending-rules">
          <b>Regles pendents d&apos;aprovar ({pending.length})</b>
          <ul className="mt-1 space-y-1">{pending.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">«{r.rule.title}» · {SCOPE_LABEL[(r.scope ?? "producte") as RuleScope]} · {r.created_by_name}
              {isAdmin && <><Button size="sm" onClick={() => void decide(r.id, "aprovada")} disabled={!!busy}>Aprova</Button><Button size="sm" variant="ghost" onClick={() => void decide(r.id, "rebutjada")} disabled={!!busy}>Rebutja</Button></>}
            </li>))}</ul>
        </div>
      )}

      <div className="grid gap-3 2xl:grid-cols-[minmax(0,0.75fr)_minmax(0,1.6fr)_340px] xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ESQUERRA: Excel original */}
        <section className="min-w-0 space-y-2 rounded-2xl border border-line bg-surface p-3 xl:col-span-2 2xl:col-span-1" aria-label="Excel original">
          <div className="flex items-center gap-2 text-[12px]"><b>Excel original</b><span className="text-muted">{wb?.fileName} · {g?.name}</span></div>
          {g ? (
            <div ref={gridRef} className="max-h-[520px] overflow-auto rounded-xl border border-line" data-testid="xlsx-grid">
              <table className="w-max border-collapse text-[10.5px]">
                <thead className="sticky top-0 z-10 bg-elevated"><tr><th className="sticky left-0 z-20 bg-elevated px-1" />{Array.from({ length: shownCols }, (_, c) => <th key={c} className="min-w-[48px] border border-line px-1 font-mono" title={t.colHeaders[colName(c)]}>{colName(c)}</th>)}</tr></thead>
                <tbody>{Array.from({ length: Math.min(g.rows, 125) }, (_, r) => {
                  const hidden = g.hidden?.includes(r);
                  return (
                    <tr key={r} data-r={r + 1} className={cn(sel?.row === r + 1 && "bg-brand/10", hidden && "opacity-50")} onClick={() => { const p = read?.products.find((x) => x.row === r + 1); if (p) setSelKey(p.key); }}>
                      <td className="sticky left-0 bg-elevated px-1 text-right text-muted">{r + 1}</td>
                      {Array.from({ length: shownCols }, (_, c) => { const x = g.cells[r]?.[c]; const a = `${colName(c)}${r + 1}`; return <td key={c} title={a} className={cn("max-w-[150px] truncate border border-line/60 px-1", selCells.has(a) && "bg-amber-400/30 font-semibold", x?.t === "e" && "text-red-600")}>{x == null ? "" : typeof x.v === "number" ? x.v.toLocaleString("ca-ES", { maximumFractionDigits: 6 }) : String(x.v)}</td>; })}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <Notice>{read?.table?.needsSheet ? "Tria la pestanya de preus." : "Aquesta versió no té cap Excel d'exemple desat."}</Notice>}
        </section>

        {/* CENTRE: tarifes interpretades */}
        <section className="min-w-0 space-y-2 rounded-2xl border border-line bg-surface p-3" aria-label="Tarifes interpretades">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <b>Tarifes interpretades</b>
            <select className="input h-7 w-auto py-0" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtra per estat">
              <option value="totes">Totes</option>{(["interpretada", "revisar", "pendent", "fallida"] as InterpStatus[]).map((s) => <option key={s} value={s}>{INTERP_LABEL[s]}</option>)}
            </select>
            <span className="text-muted">Passa el ratolí pels preus per veure la cel·la d&apos;origen.</span>
          </div>
          {read && <InterpretedTable read={read} selected={selKey} onSelect={(p) => setSelKey(p.key)} affected={affected} filter={filter} />}
          {sel?.interp && (
            <div className="space-y-1.5 rounded-xl border border-line p-2 text-[12px]" data-testid="row-detail">
              <div className="flex flex-wrap items-center gap-2"><b>Fila {sel.row} · {sel.name}</b><Badge tone={STATUS_TONE[sel.interp.status]}>{INTERP_LABEL[sel.interp.status]}</Badge>
                <span className="ml-auto"><SimulateDiscountsButton source={{ title: sel.name, energy: sel.interp.energyOriginal, power: sel.interp.powerOriginal, powerUnit: sel.interp.powerUnit ?? "eur_kw_any", discountText: sel.discountLabel, energyType: sel.energyType, periods: sel.interp.periods }} /></span></div>
              <p><b>Preus originals:</b> {sel.interp.source.map((s) => `${s.cell.replace(/^.*!/, "")} ${shortHeader(s.header, s.letter)} = ${f6(s.v)}`).join(" · ")}</p>
              {sel.interp.mapping && <p><b>Correspondència:</b> {sel.interp.mapping.map((l, i) => `P${i + 1}←${shortHeader(sel.interp!.source.find((s) => s.letter === l)?.header, l)}`).join(" · ")}</p>}
              <p><b>Descompte:</b> {sel.discountLabel ?? "—"} → aplicat {sel.interp.energyPct} % energia{sel.interp.powerPct ? `, ${sel.interp.powerPct} % potència` : ""}; condicionats no aplicats: {sel.interp.discount.conditional.map((c) => c.label).join(", ") || "cap"}{sel.interp.energyFinalYear2 ? ` · 2n any: ${sel.interp.energyFinalYear2.slice(0, sel.interp.periods).map(f6).join(" · ")}` : ""}</p>
              {sel.interp.schedule && <p><b>Horari promocionat:</b> {sel.interp.schedule.text}</p>}
              {sel.interp.estimate && <p className="font-semibold text-amber-700 dark:text-amber-300">PREU ESTIMAT PER PONDERACIÓ HORÀRIA ({sel.interp.estimate.reference.from} – {sel.interp.estimate.reference.to}): {sel.interp.estimate.periods.map((p) => `P${p.period} ${Math.round((p.open / (p.total || 1)) * 100)} % hores promocionades`).join(" · ")}</p>}
              <div><b>Regles aplicades:</b>
                <ul className="list-disc pl-5">{sel.interp.rules.map((r) => <li key={r.id}>{r.title} <span className="text-muted">({r.source}{r.approved ? "" : " · pendent d'aprovar"})</span>{!r.approved && isAdmin && kn?.rules.some((k) => k.id === r.id) && <button className="ml-1 text-brand underline" onClick={() => approveBuiltin(r.id)}>confirma-la</button>}</li>)}</ul></div>
              {sel.interp.reasons.length > 0 && <ul className="space-y-0.5 text-amber-700 dark:text-amber-300">{sel.interp.reasons.map((x, i) => <li key={i}>⚠ {x}</li>)}</ul>}
            </div>
          )}
        </section>

        {/* DRETA: xat */}
        <section className="flex min-h-[420px] flex-col rounded-2xl border border-line bg-surface p-3" aria-label="Xat amb la IA">
          <h4 className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={14} className="text-brand" /> Xat de lectura{sel && <Badge>fila {sel.row}</Badge>}</h4>
          <div className="max-h-[360px] flex-1 space-y-2 overflow-y-auto text-[12px]" data-testid="teach-chat">
            {msgs.map((m, i) => <div key={i} className={cn("whitespace-pre-wrap rounded-xl px-3 py-2", m.role === "user" ? "ml-6 bg-brand/10" : "mr-6 bg-elevated")}>{m.text}</div>)}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder={sel ? `Explica com s'interpreta «${sel.name}»…` : "Selecciona una tarifa o escriu una regla general…"} aria-label="Missatge per a la IA" />
            <Button type="submit" variant="primary" disabled={!text.trim()}><Send size={14} /></Button>
          </form>
          <button className="mt-1 flex items-center gap-1 self-start text-[11.5px] text-muted underline" disabled={!!busy} onClick={() => void askAi()}><Bot size={12} /> Pregunta a la IA per les tarifes pendents (s&apos;envien per fragments)</button>
          {proposal && (
            <div className="mt-2 space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-2 text-[11.5px]" data-testid="rule-proposal">
              <b>Proposta: {proposal.rule.title}</b>
              <p className="text-muted">Abans → després ({changes.length} tarifes canvien):</p>
              <ul className="max-h-40 space-y-1 overflow-auto">{changes.slice(0, 20).map((c) => <li key={c.key}><b>Fila {c.row} {c.name}</b>{c.fields.map((f, i) => <span key={i} className="block">{f.field}: <s className="text-muted">{f.before}</s> → <b>{f.after}</b></span>)}</li>)}</ul>
              {!changes.length && <p>No canvia cap tarifa amb aquesta regla.</p>}
              <div className="flex flex-wrap gap-1 pt-1">
                <Button size="sm" variant="ghost" onClick={() => void save("document")}>Aplica només a aquest document</Button>
                <Button size="sm" onClick={() => void save("producte")} disabled={!!busy || !proposal.product}>Guarda per a aquest producte</Button>
                <Button size="sm" onClick={() => void save("plantilla")} disabled={!!busy}>Guarda per a aquesta plantilla</Button>
                <Button size="sm" variant="ghost" onClick={() => void save("general")} disabled={!!busy} title="Només Direcció l'activa">Proposa com a regla general</Button>
                <button className="text-[11px] text-muted underline" onClick={() => setProposal(null)}>Descarta</button>
              </div>
            </div>
          )}
          <div className="mt-2 space-y-1 border-t border-line pt-2 text-[11.5px]" data-testid="checks">
            <b>Comprovacions per verificar ({validatedPct(read)} % de valors validats)</b>
            {checks.map((c) => <p key={c.id} className="flex items-start gap-1.5">{c.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ren" /> : <XCircle size={13} className="mt-0.5 shrink-0 text-red-600" />}<span><b>{c.label}</b> · <span className="text-muted">{c.detail}</span></span></p>)}
            <p className="text-muted">La confiança de la IA no compta: només Direcció verifica, i només si tot és correcte.</p>
          </div>
        </section>
      </div>
      <section className="space-y-2 rounded-2xl border border-line bg-surface p-3 text-[12px]" data-testid="learning-material">
        <h4 className="flex items-center gap-2 text-[13px] font-semibold"><GraduationCap size={14} className="text-brand" /> Material d&apos;aprenentatge i validació</h4>
        <div className="grid gap-2 md:grid-cols-3">
          <DropZone accept=".xlsx,.xls,.csv" onFiles={([f]) => void loadReference(f)}><span className="font-medium">Excel amb la interpretació correcta</span><span className="text-[11px] text-muted">Columnes «Producte» i P1…P6: es compara fila a fila</span></DropZone>
          <DropZone accept=".pdf,.docx,.txt" onFiles={([f]) => void loadMaterial(f)}><span className="font-medium">Document d&apos;explicació o PDF de condicions</span><span className="text-[11px] text-muted">Es llegeix aquí mateix: no es desa ni s&apos;envia a cap IA</span></DropZone>
          <button className="rounded-xl border border-dashed border-line p-3 text-left hover:bg-elevated" onClick={() => void compareCatalog()}><span className="block font-medium">Exemple de tarifes ja aprovades</span><span className="text-[11px] text-muted">Compara amb les tarifes actives de {supplier} al catàleg</span></button>
        </div>
        {refRows && (
          <div className="rounded-xl border border-line p-2" data-testid="reference-compare">
            <b>{refRows.title}: {refRows.rows.filter((r) => r.ok).length} coincideixen · {refRows.rows.filter((r) => !r.ok).length} diferents</b>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">{refRows.rows.filter((r) => !r.ok).map((r) => (
              <li key={r.sourceRow}>{r.product ? <>✗ {r.name}: lector {r.actual.map(f6).join(" · ")} · correcte {r.expected.map(f6).join(" · ")} <button className="text-brand underline" onClick={() => { setSelKey(r.product!.key); setTeaching(r.expected); }}>Ensenya-ho</button></> : <>? {r.name}: no hi ha cap tarifa amb aquest nom al document</>}</li>))}</ul>
          </div>
        )}
        {material.map((m, i) => <details key={i} className="rounded-xl border border-line p-2"><summary className="cursor-pointer font-medium">{m.name}</summary><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-[11px]">{m.text}</pre></details>)}
      </section>
      {read && read.issues.length > 0 && <ul className="space-y-0.5 text-[11.5px]">{read.issues.map((i, k) => <li key={k} className={i.level === "critica" ? "text-red-600" : "text-amber-700 dark:text-amber-300"}>{i.level === "critica" ? "✖" : "⚠"} {i.text}</li>)}</ul>}
      {teaching !== false && sel && <TeachExample product={sel} initial={Array.isArray(teaching) ? teaching : null} onClose={() => setTeaching(false)} onProposal={(p) => { setTeaching(false); setProposal(p); setMsgs((x) => [...x, { role: "assistant", text: `${p.example!.result.detail.join("\n")}\nTria on la guardes.` }]); setLastRule(p.rule); }} author={me} />}
    </div>
  );
}

/** ENSENYAR AMB UNA TARIFA D'EXEMPLE: l'usuari escriu els P1–P6 correctes i el CRM busca la regla que ho explica. */
function TeachExample({ product, initial, onClose, onProposal, author }: { product: Product; initial: (number | null)[] | null; onClose: () => void; onProposal: (p: Proposal) => void; author: string | null }) {
  const it = product.interp!;
  const [vals, setVals] = useState<string[]>(() => Array.from({ length: it.periods }, (_, i) => { const v = initial ? initial[i] : it.energyFinal[i]; return v != null ? String(v) : ""; }));
  const [explanation, setExplanation] = useState("");
  const [disc, setDisc] = useState<"auto" | "si" | "no">("auto");
  const [res, setRes] = useState<ExampleResult | null>(null);
  const expected = vals.map((v) => { const n = Number(v.replace(",", ".")); return v.trim() && Number.isFinite(n) ? n : null; });
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={`Ensenyar a la IA · ${product.name} (fila ${product.row})`}>
      <div className="space-y-3 text-[12.5px]" data-testid="teach-example">
        <p className="text-muted">Escriu els preus finals correctes P1–P{it.periods} (€/kWh) i explica com s&apos;obtenen. El CRM compara la seva lectura amb l&apos;exemple i proposa la regla reutilitzable.</p>
        <p>Preus de l&apos;Excel: {it.source.map((s) => `${shortHeader(s.header, s.letter)} ${f6(s.v)} (${s.cell.replace(/^.*!/, "")})`).join(" · ")} · descompte: {product.discountLabel ?? "—"}</p>
        <div className="flex flex-wrap gap-2">{vals.map((v, i) => <label key={i} className="block"><span className="label">P{i + 1}</span><input className="input h-8 w-28" value={v} onChange={(e) => setVals((x) => x.map((y, j) => (j === i ? e.target.value : y)))} aria-label={`P${i + 1} correcte`} /></label>)}</div>
        <label className="block"><span className="label">Com s&apos;obté (explicació)</span><textarea className="input min-h-[60px]" value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="p. ex. P1–P5 al preu promocionat i P6 al no promocionat, amb el 20 % de descompte" aria-label="Explicació" /></label>
        <label className="flex items-center gap-2">Descompte aplicat
          <select className="input h-8 w-auto py-0" value={disc} onChange={(e) => setDisc(e.target.value as typeof disc)} aria-label="Descompte aplicat"><option value="auto">Que ho descobreixi</option><option value="si">Sí, el de la columna de descomptes</option><option value="no">No, el preu ja és final</option></select></label>
        <Button onClick={() => setRes(inferFromExample(product, { expected, explanation, discountApplied: disc === "auto" ? null : disc === "si", author }))} disabled={expected.every((x) => x == null)}>Compara amb la lectura</Button>
        {res && (
          <div className={cn("rounded-xl border p-2", res.explained ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-amber-500/40 bg-amber-500/[0.06]")} data-testid="example-result">
            {res.detail.map((d, i) => <p key={i}>{d}</p>)}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => onProposal({ rule: res.rule, product, text: explanation || "Exemple validat", example: { result: res, expected, explanation, discountApplied: disc === "auto" ? null : disc === "si" } })}>Revisa l&apos;abans/després i aprova</Button>
              {res.general && <Button size="sm" onClick={() => onProposal({ rule: res.general!, product, text: explanation || "Exemple validat (equivalents)", example: { result: res, expected, explanation, discountApplied: disc === "auto" ? null : disc === "si" } })}>Proposa-la per als productes equivalents</Button>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
