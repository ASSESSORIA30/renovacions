"use client";
/**
 * COMERCIALITZADORES → PLANTILLES DE LECTURA IA
 *  - Panell: estat de verificació de cada plantilla (VERIFICADA · PENDENT · REVISIÓ NECESSÀRIA · ERROR · DESACTIVADA),
 *    versió, verificació, última lectura, errors i % de camps validats; accions.
 *  - Editor: l'Excel original en una graella interactiva, blocs i columnes interpretats, assignació de columnes,
 *    xat d'ensenyament, previsualització amb les files afectades i comprovacions per verificar.
 *  - Prova / importació d'un document nou: estructura, canvis respecte de la lectura anterior i importació al catàleg.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, FileSpreadsheet, History, Loader2, MessageSquare, Play, Plus, Power, Send, ShieldCheck, Sparkles, Upload, XCircle } from "lucide-react";
import {
  CLASSIFICATIONS, CLASSIFICATION_LABEL, applyOps, applyTemplate, colIdx, colName, describeOp, diffReads, parseTeaching, productsToOffers, proposeTemplate, templateChecks, validatedPct,
  type BlockDef, type Classification, type ReadResult, type TemplateDef, type TemplateOp, type WorkbookGrid,
} from "@/comparator/xlsx-template";
import { tariffsApi } from "@/comparator/client";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, cn } from "../../components/ui";
import { DropArea, DropZone } from "../../components/DropZone";
import { readWorkbook, tplApi, type TemplateDetail, type TemplateRow } from "./templates-api";
import { TemplateStatusPill } from "./StatusPill";
import { CountsBar, InterpretedTable, TableReader } from "./TableReader";
import { proposeTable } from "@/comparator/tariff-table";
import { detectSupplier } from "@/comparator/reading-knowledge";

const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("ca-ES", { maximumFractionDigits: 6 }) : v == null ? "" : String(v));
const when = (d: string | null) => (d ? new Date(d).toLocaleString("ca-ES", { dateStyle: "short", timeStyle: "short" }) : "—");
export { TemplateStatusPill };

/* ======================================================================= panell */

export function ReadingTemplates({ retailerId, supplier, canEdit }: { retailerId: string; supplier: string; canEdit: boolean }) {
  const role = useApp((s) => s.snap?.me.role);
  const toast = useApp((s) => s.toast);
  const isAdmin = role === "admin";
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [migrated, setMigrated] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; sample?: WorkbookGrid; draft?: TemplateDef } | null>(null);
  const [testing, setTesting] = useState<TemplateRow | null>(null);
  const [versionsOf, setVersionsOf] = useState<TemplateRow | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => tplApi.list({ retailer: retailerId }).then((r) => { setRows(r.templates); setMigrated(r.migrated); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, [retailerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try { await fn(); toast({ title: ok, tone: "ok" }); await load(); } catch (e) { toast({ title: "No s'ha pogut fer", body: e instanceof Error ? e.message : String(e), tone: "err" }); } finally { setBusy(null); }
  };
  const [chooseSheet, setChooseSheet] = useState<{ wb: WorkbookGrid; error: string; knowledge: string | null; name: string } | null>(null);
  const startTable = (wb: WorkbookGrid, name: string, knowledge: string | null, sheet: string | null) => {
    const p = proposeTable(wb, { supplier, name, knowledge, sheet });
    if (!p.def) { setChooseSheet({ wb, error: p.error ?? "No s'ha trobat la taula de tarifes.", knowledge, name }); return; }
    p.def.notes = p.notes;
    setChooseSheet(null);
    setEditing({ id: null, sample: wb, draft: p.def });
  };
  const startNew = async (f: File) => {
    setBusy("Llegint l'Excel de mostra…");
    try {
      const wb = await readWorkbook(f);
      const name = newName.trim() || f.name.replace(/\.[^.]+$/, "");
      // un únic lector: la comercialitzadora (i el seu coneixement) es detecta del document
      const det = detectSupplier(wb);
      if (det && det.supplier.toLowerCase() !== supplier.toLowerCase()) toast({ title: `Aquest document sembla de ${det.supplier}`, body: `Ho indica: ${det.evidence}. Comprova que l'estàs pujant a la comercialitzadora correcta.`, tone: "err" });
      if (det?.pack.layout === "taula") { startTable(wb, name, det.pack.id, null); return; }
      const { def, notes } = proposeTemplate(wb, { supplier, name });
      if (!def.blocks.length) { startTable(wb, name, null, null); return; }
      def.notes = notes;
      setEditing({ id: null, sample: wb, draft: def });
    } catch (e) { toast({ title: "No s'ha pogut llegir l'Excel", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  const verify = async (t: TemplateRow) => {
    setBusy("Verificant…");
    try {
      const r = await tplApi.verify(t.id, t.current_version);
      if (r.verified) toast({ title: "Plantilla VERIFICADA", body: "Els documents compatibles es llegiran amb aquesta versió.", tone: "ok" });
      else toast({ title: "Encara no es pot verificar", body: r.message, tone: "err" });
      await load();
    } catch (e) { toast({ title: "No s'ha pogut verificar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };

  if (editing) return <TemplateEditor templateId={editing.id} sample={editing.sample} draft={editing.draft} retailerId={retailerId} supplier={supplier} isAdmin={isAdmin} onClose={() => { setEditing(null); void load(); }} />;
  return (
    <div className="space-y-3" data-testid="reading-templates">
      <Notice tone="blue">Una plantilla VERIFICADA vol dir que el CRM sap interpretar aquest format de document. No vol dir que els preus d&apos;un document nou estiguin aprovats: cada importació es revisa i s&apos;aprova a part.</Notice>
      {!migrated && <Notice>Falta aplicar la migració 023 a Supabase: les plantilles encara no es poden desar.</Notice>}
      {err && <Notice tone="red">{err}</Notice>}
      {!rows ? <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Carregant…</p> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead className="bg-elevated text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Plantilla</th><th>Tipus</th><th>Versió</th><th>Estat</th><th>Verificació</th><th>Última lectura</th><th>Errors</th><th>Camps validats</th><th className="px-3 text-right">Accions</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted">Encara no hi ha cap plantilla per a {supplier}. Carrega un Excel de mostra per crear-ne una.</td></tr>}
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-line align-top">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="py-2 uppercase">{t.doc_type}</td>
                  <td className="py-2">v{t.current_version}{t.verified_version && t.verified_version !== t.current_version ? <span className="block text-[11px] text-muted">verificada: v{t.verified_version}</span> : null}</td>
                  <td className="py-2"><TemplateStatusPill status={t.status} /></td>
                  <td className="py-2">{t.verified_at ? <>{when(t.verified_at)}<span className="block text-[11px] text-muted">{t.verified_by_name}</span></> : "—"}</td>
                  <td className="py-2">{when(t.last_read_at)}{t.last_read_status && <span className="block text-[11px] text-muted">{t.last_read_status.replace("_", " ")}</span>}</td>
                  <td className="py-2">{t.last_errors?.length ? <span className="text-red-600">{t.last_errors.length}</span> : "0"}</td>
                  <td className="py-2">{t.validated_pct != null ? `${Number(t.validated_pct).toLocaleString("ca-ES")} %` : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: t.id })}><MessageSquare size={13} /> Veure / editar amb el xat</Button>
                      <Button size="sm" variant="ghost" onClick={() => setTesting(t)}><Play size={13} /> Provar amb un document</Button>
                      {isAdmin && t.status !== "verificada" && t.active && <Button size="sm" disabled={!!busy} onClick={() => void verify(t)}><ShieldCheck size={13} /> Verificar</Button>}
                      {canEdit && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act("…", () => tplApi.active(t.id, !t.active), t.active ? "Plantilla desactivada" : "Plantilla activada")}><Power size={13} /> {t.active ? "Desactivar" : "Activar"}</Button>}
                      {canEdit && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { const n = window.prompt("Nom de la plantilla duplicada", `${t.name} (còpia)`); if (n) void act("…", () => tplApi.duplicate(t.id, n), "Plantilla duplicada"); }}><Copy size={13} /> Duplicar</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setVersionsOf(t)}><History size={13} /> Versions</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Plus size={15} className="text-brand" /> ENSENYAR A LA IA · nova plantilla a partir d&apos;un Excel d&apos;exemple</h3>
          <label className="block max-w-sm"><span className="label">Nom de la plantilla</span><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="p. ex. Captación PYMES Excel" /></label>
          <DropZone accept=".xlsx,.xls,.csv" disabled={!!busy} onFiles={([f]) => void startNew(f)} onReject={(m) => toast({ title: m, tone: "err" })}>
            {busy ? <Loader2 className="animate-spin text-brand" /> : <FileSpreadsheet className="text-brand" />}
            <span className="font-medium">{busy ?? "Arrossega l'Excel de mostra o fes clic"}</span>
            <span className="text-[12px] text-muted">Excel (XLSX/XLS) o CSV. Es detecta la comercialitzadora, la pestanya de preus, les columnes i les unitats; després ho pots ensenyar i corregir.</span>
          </DropZone>
        </section>
      )}
      {chooseSheet && (
        <Modal open onClose={() => setChooseSheet(null)} title="Tria la pestanya de preus" width="max-w-lg">
          <div className="space-y-2 text-[12.5px]" data-testid="choose-sheet">
            <Notice tone="red">{chooseSheet.error}</Notice>
            <p>No es canvia de pestanya automàticament. Tria quina conté les tarifes:</p>
            <div className="flex flex-wrap gap-2">{chooseSheet.wb.sheets.map((s) => <Button key={s.name} size="sm" onClick={() => startTable(chooseSheet.wb, chooseSheet.name, chooseSheet.knowledge, s.name)}>{s.name}</Button>)}</div>
          </div>
        </Modal>
      )}
      {testing && <TestDocument template={testing} onClose={() => { setTesting(null); void load(); }} onFix={(wb) => { setTesting(null); setEditing({ id: testing.id, sample: wb }); }} />}
      {versionsOf && <VersionsModal t={versionsOf} canEdit={canEdit} onClose={() => setVersionsOf(null)} onRestored={() => { setVersionsOf(null); void load(); }} />}
    </div>
  );
}

function VersionsModal({ t, canEdit, onClose, onRestored }: { t: TemplateRow; canEdit: boolean; onClose: () => void; onRestored: () => void }) {
  const [d, setD] = useState<TemplateDetail | null>(null);
  const toast = useApp((s) => s.toast);
  useEffect(() => { tplApi.get(t.id).then(setD).catch(() => undefined); }, [t.id]);
  return (
    <Modal open onClose={onClose} title={`Versions · ${t.name}`} width="max-w-2xl">
      {!d ? <Loader2 className="animate-spin" /> : (
        <div className="space-y-3 text-[12.5px]">
          <ul className="divide-y divide-line rounded-xl border border-line">{d.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <b>v{v.version}</b>{v.version === t.verified_version && <Badge tone="green">verificada</Badge>}{v.version === t.current_version && <Badge tone="blue">actual</Badge>}
              <span className="min-w-0 flex-1 text-muted">{v.note ?? "—"} · {v.created_by_name ?? "—"} · {when(v.created_at)}</span>
              {canEdit && v.version !== t.current_version && <Button size="sm" variant="ghost" onClick={async () => { try { await tplApi.restore(t.id, v.version); toast({ title: `Versió ${v.version} recuperada com a versió nova`, tone: "ok" }); onRestored(); } catch (e) { toast({ title: "No s'ha pogut recuperar", body: e instanceof Error ? e.message : String(e), tone: "err" }); } }}>Recupera</Button>}
            </li>))}</ul>
          <h4 className="text-[11px] font-semibold uppercase text-muted">Correccions (biblioteca de coneixement)</h4>
          <ul className="space-y-1">{d.corrections.length ? d.corrections.map((c) => <li key={c.id}>«{c.instruction}» → v{c.version} · {c.created_by_name} · {when(c.created_at)}</li>) : <li className="text-muted">Cap</li>}</ul>
        </div>
      )}
    </Modal>
  );
}

/* ======================================================================= editor */

const ROLE_OPTIONS = [
  { id: "power", label: "Potència P1–Pn" }, { id: "energy", label: "Energia d'una variant" }, { id: "code", label: "Codi comercial" }, { id: "productCode", label: "Codi de producte" },
  { id: "tariff", label: "Peatge d'accés" }, { id: "name", label: "Nom del producte" }, { id: "consumptionMax", label: "Límit de consum" }, { id: "fixedTerm", label: "Terme fix (gas)" },
  { id: "margin", label: "Marge (indexada)" }, { id: "discount", label: "Descompte de la variant" },
] as const;
const VARIANT_COLORS = ["bg-sky-500/15", "bg-violet-500/15", "bg-emerald-500/15", "bg-pink-500/15", "bg-amber-500/20"];
type Msg = { role: "user" | "assistant"; text: string; ops?: TemplateOp[] };

export function TemplateEditor({ templateId, sample, draft, retailerId, supplier, isAdmin, onClose }: { templateId: string | null; sample?: WorkbookGrid; draft?: TemplateDef; retailerId: string | null; supplier: string; isAdmin: boolean; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [base, setBase] = useState<TemplateDef | null>(draft ?? null);
  const [wb, setWb] = useState<WorkbookGrid | null>(sample ?? null);
  const [pending, setPending] = useState<{ instruction: string; ops: TemplateOp[] }[]>([]);
  const [block, setBlock] = useState<string | null>(null);
  const [cols, setCols] = useState<string[]>([]);
  const [rowKey, setRowKey] = useState<string | null>(null);
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]["id"]>("energy");
  const [variant, setVariant] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: "Selecciona un bloc i les columnes (clica la lletra; amb Maj, un rang) i explica'm què són. Per exemple: «Aquestes sis columnes corresponen a la potència P1–P6», «Aquest producte és fix, encara que tingui sis períodes», «Aquesta variant és ONE», «Aquestes cel·les buides no són zeros»." }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) return;
    tplApi.get(templateId).then((d) => { setDetail(d); if (d.version) { setBase(d.version.definition); if (!sample) setWb(d.version.sample_grid); } }).catch((e) => toast({ title: "No s'ha pogut obrir la plantilla", body: e instanceof Error ? e.message : String(e), tone: "err" }));
  }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = useMemo(() => (base ? applyOps(base, pending.flatMap((p) => p.ops)) : null), [base, pending]);
  const read = useMemo(() => (def && wb ? applyTemplate(wb, def, { force: true }) : null), [def, wb]);
  const baseRead = useMemo(() => (base && wb ? applyTemplate(wb, base, { force: true }) : null), [base, wb]);
  const checks = useMemo(() => (def ? templateChecks(def, read) : []), [def, read]);
  const affected = useMemo(() => {
    if (!read || !baseRead) return new Set<string>();
    const d = diffReads(baseRead, read);
    const s = new Set<string>([...d.added.map((p) => p.key), ...d.changed.map((c) => c.key)]);
    for (const p of read.products) { const q = baseRead.products.find((x) => x.key === p.key); if (q && (q.classification !== p.classification || q.energyType !== p.energyType || q.variant !== p.variant)) s.add(p.key); }
    return s;
  }, [read, baseRead]);
  const sheet = wb?.sheets.find((s) => s.name === (sheetName ?? read?.sheet ?? def?.sheet.example)) ?? wb?.sheets[0] ?? null;
  const b = def?.blocks.find((x) => x.id === block) ?? null;
  const anchorRow = useMemo(() => {
    if (!sheet || !b) return null;
    const c = colIdx(b.anchor.col);
    for (let r = 0; r < sheet.rows; r++) if (String(sheet.cells[r]?.[c]?.v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim().startsWith(b.anchor.text)) return r;
    return null;
  }, [sheet, b]);
  const roleOfCol = (c: string, bb: BlockDef | null): { cls: string; tip: string } | null => {
    if (!bb) return null;
    if (bb.power.includes(c)) return { cls: "bg-blue-500/15", tip: `Potència P${bb.power.indexOf(c) + 1}` };
    for (const [i, v] of bb.variants.entries()) {
      if (v.energyCols.includes(c)) return { cls: VARIANT_COLORS[i % VARIANT_COLORS.length], tip: `Energia ${v.label} P${v.energyCols.indexOf(c) + 1}` };
      if (v.codeCol === c) return { cls: "bg-zinc-500/15", tip: `Codi ${v.label}` };
      if (v.marginCol === c) return { cls: "bg-orange-500/20", tip: `Marge ${v.label}` };
      if (v.discountCol === c) return { cls: "bg-lime-500/20", tip: `Descompte ${v.label}` };
    }
    const k = (Object.keys(bb.cols) as (keyof BlockDef["cols"])[]).find((x) => bb.cols[x] === c);
    return k ? { cls: "bg-zinc-500/10", tip: k } : null;
  };
  const pickCol = (c: string, shift: boolean) => {
    if (shift && cols.length) { const a = colIdx(cols[0]), z = colIdx(c); const out: string[] = []; for (let i = Math.min(a, z); i <= Math.max(a, z); i++) out.push(colName(i)); setCols(out); }
    else setCols((x) => (x.length === 1 && x[0] === c ? [] : [c]));
  };
  const propose = (instruction: string, ops: TemplateOp[]) => { if (ops.length) setPending((p) => [...p, { instruction, ops }]); };

  const assign = () => {
    if (!b || !cols.length) return;
    const v = variant.trim() || b.variants.find((x) => x.energyCols.some((c) => cols.includes(c)))?.label || b.variants[0]?.label || "Base";
    let op: TemplateOp;
    if (role === "power") op = { op: "setPower", block: b.id, cols, unit: b.units.power };
    else if (role === "energy") op = b.variants.some((x) => x.label === v) ? { op: "setVariantEnergy", block: b.id, variant: v, cols } : { op: "addVariant", block: b.id, variant: v, cols };
    else if (role === "margin") op = { op: "setMargin", block: b.id, variant: v, col: cols[0] };
    else if (role === "discount") op = { op: "setDiscount", block: b.id, variant: v, col: cols[0] };
    else op = { op: "setColumn", block: b.id, field: role, col: cols[0] };
    propose(describeOp(op, def!), [op]);
  };
  const send = () => {
    const m = text.trim();
    if (!m || !def) return;
    setText("");
    const ops = parseTeaching(m, { def, block, cols, rowKey });
    setMsgs((x) => [...x, { role: "user", text: m }, ops.length
      ? { role: "assistant", text: `Proposo aquesta correcció:\n${ops.map((o) => `• ${describeOp(o, def)}`).join("\n")}\nVols aplicar-la a la previsualització?`, ops }
      : { role: "assistant", text: block ? "No ho he entès prou bé per proposar un canvi. Selecciona les columnes afectades i digues què representen (potència, energia de la variant…, marge, descompte) o si el bloc és fix, indexat o mixt." : "Primer selecciona el bloc al qual es refereix la correcció." }]);
  };
  const save = async () => {
    if (!def) return;
    setBusy("Desant…");
    try {
      const instruction = pending.map((p) => p.instruction).join(" · ") || null;
      if (!templateId) {
        const r = await tplApi.create({ retailerId, supplier, name: def.name, definition: def, sample: wb, note: instruction ? `Proposta inicial + ${instruction}` : "Proposta inicial a partir de l'Excel de mostra" });
        toast({ title: "Plantilla creada (pendent de verificació)", tone: "ok" });
        void r;
        onClose();
        return;
      }
      const r = await tplApi.version({ id: templateId, definition: def, note: instruction, instruction, ops: pending.flatMap((p) => p.ops), sample: sample ?? null });
      toast({ title: `Versió ${r.version} desada`, body: "Queda pendent de verificació per Direcció.", tone: "ok" });
      setPending([]);
      const d = await tplApi.get(templateId);
      setDetail(d); if (d.version) setBase(d.version.definition);
    } catch (e) { toast({ title: "No s'ha pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  const verify = async () => {
    if (!templateId || !detail) return;
    setBusy("Verificant…");
    try {
      const r = await tplApi.verify(templateId, detail.template.current_version);
      toast(r.verified ? { title: "Plantilla VERIFICADA", tone: "ok" } : { title: "Encara no es pot verificar", body: r.message, tone: "err" });
      const d = await tplApi.get(templateId); setDetail(d);
    } catch (e) { toast({ title: "No s'ha pogut verificar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };

  if (base?.layout === "taula") return <TableReader templateId={templateId} sample={sample} draft={templateId ? undefined : base} retailerId={retailerId} supplier={supplier} isAdmin={isAdmin} onClose={onClose} />;
  if (!def) return <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Obrint la plantilla…</p>;
  const shown = sheet ? Math.min(sheet.rows, 140) : 0;
  const shownCols = sheet ? Math.min(sheet.cols, 60) : 0;
  return (
    <div className="space-y-3" data-testid="template-editor">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[16px] font-semibold">{def.supplier} · {def.name}</h3>
        {detail ? <TemplateStatusPill status={detail.template.status} /> : <Badge tone="amber">Nova (sense desar)</Badge>}
        {detail && <span className="text-[12px] text-muted">v{detail.template.current_version}{detail.template.verified_version ? ` · verificada v${detail.template.verified_version}` : ""}</span>}
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>Tanca</Button>
          <Button variant="primary" disabled={!!busy || (!!templateId && !pending.length && !sample)} onClick={() => void save()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {templateId ? "Desa com a versió nova" : "Desa la plantilla"}</Button>
          {isAdmin && templateId && !pending.length && <Button disabled={!!busy || detail?.template.status === "verificada"} onClick={() => void verify()}><ShieldCheck size={14} /> Verificar</Button>}
        </span>
      </div>
      {def.notes.length > 0 && <Notice>{def.notes.join(" · ")}</Notice>}
      {read && read.compatibility.status === "incompatible" && <Notice tone="red">S&apos;ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura. {read.compatibility.differences.slice(0, 4).join(" · ")}</Notice>}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 space-y-2 rounded-2xl border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-semibold">Excel original</span>
            {wb && wb.sheets.length > 1 && <select className="input h-8 w-auto py-0" value={sheet?.name} onChange={(e) => setSheetName(e.target.value)} aria-label="Full">{wb.sheets.map((s) => <option key={s.name}>{s.name}</option>)}</select>}
            <span className="text-muted">{wb?.fileName ?? "Sense exemple desat"}</span>
            {cols.length > 0 && <Badge tone="blue">Columnes {cols[0]}{cols.length > 1 ? `–${cols[cols.length - 1]}` : ""}</Badge>}
          </div>
          {sheet ? (
            <div className="max-h-[460px] overflow-auto rounded-xl border border-line" data-testid="xlsx-grid">
              <table className="w-max border-collapse text-[11px]">
                <thead className="sticky top-0 z-10 bg-elevated"><tr><th className="sticky left-0 z-20 bg-elevated px-1" />{Array.from({ length: shownCols }, (_, c) => { const n = colName(c); const r = roleOfCol(n, b); return (
                  <th key={c} title={r?.tip} onClick={(e) => pickCol(n, e.shiftKey)} className={cn("min-w-[56px] cursor-pointer select-none border border-line px-1.5 py-0.5 font-mono", r?.cls, cols.includes(n) && "outline outline-2 -outline-offset-2 outline-brand")} data-col={n}>{n}</th>); })}</tr></thead>
                <tbody>{Array.from({ length: shown }, (_, r) => {
                  const p = read?.products.find((x) => x.row === r + 1);
                  const inBlock = b && anchorRow != null && r >= anchorRow && r < anchorRow + b.dataOffset + 30 && (r < anchorRow + b.dataOffset || read?.products.some((x) => x.row === r + 1 && x.blockId === b.id));
                  return (
                    <tr key={r} className={cn(inBlock && "bg-brand/[0.04]", p && affected.has(p.key) && "outline outline-1 -outline-offset-1 outline-amber-500")} onClick={() => { if (p) setRowKey(p.code ?? String(r + 1)); }}>
                      <td className="sticky left-0 bg-elevated px-1 text-right text-muted">{r + 1}</td>
                      {Array.from({ length: shownCols }, (_, c) => { const x = sheet.cells[r]?.[c]; const rr = roleOfCol(colName(c), b); return <td key={c} className={cn("max-w-[140px] truncate border border-line/60 px-1", inBlock && rr?.cls, x?.t === "e" && "bg-red-500/15 text-red-700", x?.t === "n" && "text-right tnum")} title={x ? String(x.v) : ""}>{x ? fmt(x.v) : ""}</td>; })}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <Notice>Aquesta versió no té cap Excel d&apos;exemple desat: prova-la amb un document per veure&apos;l aquí.</Notice>}
          {/* assignació de columnes */}
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-elevated/60 p-2 text-[12px]">
            <label className="block"><span className="label">Bloc</span>
              <select className="input h-8 py-0" value={block ?? ""} onChange={(e) => setBlock(e.target.value || null)} aria-label="Bloc">
                <option value="">Tria un bloc…</option>{def.blocks.map((x) => <option key={x.id} value={x.id}>{x.title}{x.excluded ? " (no s'importa)" : ""}</option>)}
              </select></label>
            <label className="block"><span className="label">Les columnes seleccionades són</span>
              <select className="input h-8 py-0" value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Rol de les columnes">{ROLE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
            {["energy", "margin", "discount"].includes(role) && <label className="block"><span className="label">Variant</span><input className="input h-8 w-28 py-0" value={variant} onChange={(e) => setVariant(e.target.value.toUpperCase())} placeholder={b?.variants.map((v) => v.label).join("/")} aria-label="Variant" /></label>}
            <Button size="sm" disabled={!b || !cols.length} onClick={assign}>Aplica a la previsualització</Button>
          </div>
          {b && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-2 text-[12px]" data-testid="block-panel">
              <b>{b.title}</b>
              <label className="flex items-center gap-1">Tipus
                <select className="input h-7 w-auto py-0" value={b.classification} onChange={(e) => propose(`«${b.title}» és ${CLASSIFICATION_LABEL[e.target.value as Classification]}`, [{ op: "setClassification", block: b.id, value: e.target.value as Classification }])} aria-label="Tipus de tarifa">{CLASSIFICATIONS.map((c) => <option key={c} value={c}>{CLASSIFICATION_LABEL[c]}</option>)}</select></label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={b.singlePrice} onChange={(e) => propose(`«${b.title}»: preu únic ${e.target.checked ? "sí" : "no"}`, [{ op: "setClassification", block: b.id, value: b.classification, singlePrice: e.target.checked }])} /> Preu únic 24 h</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={b.excluded} onChange={(e) => propose(`«${b.title}»: ${e.target.checked ? "no s'importa" : "s'importa"}`, [{ op: "excludeBlock", block: b.id, value: e.target.checked }])} /> No s&apos;importa</label>
              <span className="text-muted">Variants: {b.variants.map((v) => `${v.label} (${v.energyCols[0]}${v.energyCols.length > 1 ? `–${v.energyCols[v.energyCols.length - 1]}` : ""})`).join(" · ") || "cap"} · Potència: {b.power.length ? `${b.power[0]}–${b.power[b.power.length - 1]} (${b.units.power ?? "?"})` : "—"}</span>
              {b.classificationNote && <span className="w-full text-[11.5px] text-amber-700 dark:text-amber-300">{b.classificationNote}</span>}
            </div>
          )}
        </section>

        <section className="flex min-h-[420px] flex-col rounded-2xl border border-line bg-surface p-3" aria-label="Xat d'ensenyament">
          <h4 className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={14} className="text-brand" /> Xat d&apos;ensenyament</h4>
          <div className="flex-1 space-y-2 overflow-y-auto text-[12px]" data-testid="teach-chat">
            {msgs.map((m, i) => (
              <div key={i} className={cn("whitespace-pre-wrap rounded-xl px-3 py-2", m.role === "user" ? "ml-6 bg-brand/10" : "mr-6 bg-elevated")}>
                {m.text}
                {m.ops && <Button size="sm" className="mt-1" onClick={() => { propose(msgs[i - 1]?.text ?? "Correcció del xat", m.ops!); setMsgs((x) => x.map((y, j) => (j === i ? { ...y, ops: undefined, text: `${y.text}\n✓ Aplicada a la previsualització` } : y))); }}>Aplica a la previsualització</Button>}
              </div>
            ))}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder={block ? "Explica què són les columnes o el bloc…" : "Tria primer un bloc"} aria-label="Missatge d'ensenyament" />
            <Button type="submit" variant="primary" disabled={!text.trim()}><Send size={14} /></Button>
          </form>
          {pending.length > 0 && (
            <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-2 text-[11.5px]" data-testid="pending-ops">
              <b>Canvis pendents de desar ({pending.length}) · {affected.size} files afectades</b>
              <ul className="mt-1 list-disc pl-4">{pending.map((p, i) => <li key={i}>{p.instruction}</li>)}</ul>
              <button className="mt-1 text-[11px] text-muted underline" onClick={() => setPending([])}>Descarta els canvis</button>
            </div>
          )}
          <div className="mt-2 space-y-1 border-t border-line pt-2 text-[11.5px]" data-testid="checks">
            <b>Comprovacions per verificar ({validatedPct(read)} % de camps validats)</b>
            {checks.map((c) => <p key={c.id} className="flex items-start gap-1.5">{c.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ren" /> : <XCircle size={13} className="mt-0.5 shrink-0 text-red-600" />}<span><b>{c.label}</b> · <span className="text-muted">{c.detail}</span></span></p>)}
          </div>
        </section>
      </div>
      {read && <ProductsPreview read={read} affected={affected} />}
    </div>
  );
}

export function ProductsPreview({ read, affected }: { read: ReadResult; affected?: Set<string> }) {
  const [all, setAll] = useState(false);
  const list = all ? read.products : read.products.slice(0, 60);
  return (
    <section className="rounded-2xl border border-line bg-surface p-3" data-testid="products-preview">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
        <b>Interpretació: {read.products.length} productes · {read.services.length} serveis</b>
        {read.validity.label && <Badge tone="blue">{read.validity.label}{read.validity.from ? ` · des de ${read.validity.from}` : ""}</Badge>}
        <span className="text-muted">Cada valor porta la seva cel·la d&apos;origen (passa-hi el ratolí).</span>
      </div>
      <div className="max-h-[360px] overflow-auto rounded-xl border border-line">
        <table className="w-full min-w-[1000px] text-[11.5px]">
          <thead className="sticky top-0 bg-elevated text-left text-[10px] uppercase text-muted"><tr><th className="px-2 py-1">Fila</th><th>Producte</th><th>Peatge</th><th>Variant</th><th>Tipus</th><th>Energia P1–P6</th><th>Potència / terme fix</th><th>Consum fins a</th><th>Avisos</th></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.key} className={cn("border-t border-line align-top", affected?.has(p.key) && "bg-amber-500/10")}>
              <td className="px-2 py-1 text-muted">{p.row}</td>
              <td className="py-1">{p.name}<span className="block text-[10px] text-muted">{p.code ?? p.productCode}</span></td>
              <td>{p.tariff ?? p.tariffRaw ?? "—"}</td>
              <td><Badge>{p.variant}</Badge></td>
              <td><Badge tone={p.classification === "pendent" ? "amber" : p.classification === "fixa" ? "green" : "blue"}>{CLASSIFICATION_LABEL[p.classification]}</Badge>{p.energyType === "gas" && <span className="ml-1 text-[10px] text-muted">gas</span>}</td>
              <td className="tnum">{p.energy.map((x, i) => <span key={i} title={x.cell + (x.error ? ` · ${x.error}` : "")} className={cn("mr-1", x.error && "text-red-600")}>{x.v == null ? "·" : fmt(x.v)}</span>)} <span className="text-[10px] text-muted">{p.energyUnit}</span></td>
              <td className="tnum">{p.fixedTerm ? <span title={p.fixedTerm.cell}>{fmt(p.fixedTerm.v)} {p.fixedTermUnit}</span> : p.power.filter((x) => x.v != null).map((x, i) => <span key={i} title={x.cell} className="mr-1">{fmt(x.v)}</span>)}{p.powerUnit && !p.fixedTerm ? <span className="text-[10px] text-muted"> {p.powerUnit}</span> : null}</td>
              <td>{p.consumptionMax != null ? p.consumptionMax.toLocaleString("ca-ES") : "—"}</td>
              <td className="text-amber-700 dark:text-amber-300">{p.warnings.join(" · ")}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {read.products.length > 60 && <button className="mt-1 text-[12px] text-brand" onClick={() => setAll((x) => !x)}>{all ? "Mostra'n menys" : `Mostra els ${read.products.length}`}</button>}
      {read.issues.length > 0 && <ul className="mt-2 space-y-0.5 text-[11.5px]">{read.issues.map((i, k) => <li key={k} className={i.level === "critica" ? "text-red-600" : "text-amber-700 dark:text-amber-300"}>{i.level === "critica" ? "✖" : "⚠"} {i.text}</li>)}</ul>}
    </section>
  );
}

/* ======================================================================= provar / importar un document */

export function TestDocument({ template, onClose, onFix, initial }: { template: TemplateRow; onClose: () => void; onFix: (wb: WorkbookGrid) => void; initial?: WorkbookGrid }) {
  const toast = useApp((s) => s.toast);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [wb, setWb] = useState<WorkbookGrid | null>(initial ?? null);
  const [prev, setPrev] = useState<Awaited<ReturnType<typeof tplApi.previous>>["read"] | undefined>(undefined);
  const [readId, setReadId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const useVersion = template.verified_version ?? template.current_version;
  useEffect(() => { tplApi.get(template.id, useVersion).then(setDetail).catch(() => undefined); tplApi.previous(template.id).then((r) => setPrev(r.read)).catch(() => setPrev(null)); }, [template.id, useVersion]);
  const def = detail?.version?.definition ?? null;
  const [sheetOverride, setSheetOverride] = useState<string | null>(null);
  const role = useApp((s) => s.snap?.me.role);
  const general = useMemo(() => (detail?.generalRules ?? []).map((g) => g.rule), [detail]);
  const read = useMemo(() => (def && wb ? applyTemplate(wb, def, { sheet: sheetOverride, extraRules: general }) : null), [def, wb, sheetOverride, general]);
  const isTable = def?.layout === "taula";
  const diff = useMemo(() => (read && prev ? diffReads(prev.summary, read) : null), [read, prev]);
  useEffect(() => {
    if (!read || !wb || read.table?.needsSheet) return;
    tplApi.read({ id: template.id, version: useVersion, fileName: wb.fileName, result: read }).then((r) => setReadId(r.id)).catch(() => undefined);
  }, [read]); // eslint-disable-line react-hooks/exhaustive-deps
  const verified = template.status === "verificada" && template.verified_version === useVersion;
  const importOffers = async (activate = false) => {
    if (!read || !def || !wb) return;
    setBusy("Desant al catàleg…");
    try {
      const all = productsToOffers(read, def, { templateId: template.id, version: useVersion, fileName: wb.fileName });
      // Direcció pot aprovar i activar NOMÉS les tarifes interpretades sense avisos; la resta entren en esborrany
      if (activate && isTable) {
        const ok = all.filter((o) => o.product.interp?.status === "interpretada" && o.offer.contractType !== "indexat");
        const rest = all.filter((o) => !ok.includes(o));
        const send = (list: typeof all, act: boolean) => tariffsApi.importConfirm({ fileName: wb.fileName, supplierName: def.supplier, mapping: { plantilla: template.name, versio: String(useVersion) }, counts: { productes: list.length }, report: list.map((o, i) => ({ row: o.product.row ?? i + 1, status: "ok", errors: [], warnings: o.warnings.slice(0, 10) })), offers: list.map((o) => o.offer), activateComplete: act, keepIncompleteAsDraft: true });
        const a = ok.length ? await send(ok, true) : { saved: 0, activated: 0 };
        const b = rest.length ? await send(rest, false) : { saved: 0, activated: 0 };
        if (readId) await tplApi.imported(readId).catch(() => undefined);
        setDone(`${a.activated} tarifes interpretades aprovades i ACTIVES al comparador. ${a.saved - a.activated + b.saved} més desades com a ESBORRANY (a revisar, pendents, indexades sense fórmula o amb avisos). Les versions anteriors es conserven.`);
        toast({ title: "Tarifes importades", tone: "ok" });
        return;
      }
      const offers = all;
      const r = await tariffsApi.importConfirm({ fileName: wb.fileName, supplierName: def.supplier, mapping: { plantilla: template.name, versio: String(useVersion) }, counts: { productes: offers.length }, report: offers.map((o, i) => ({ row: i + 1, status: o.warnings.length ? "revisio" : "nova", errors: [], warnings: o.warnings })), offers: offers.map((o) => o.offer), activateComplete: false, keepIncompleteAsDraft: true, dryRun: false });
      if (readId) await tplApi.imported(readId).catch(() => undefined);
      setDone(`${r.saved} tarifes desades al catàleg com a ESBORRANY (cal revisar-les i activar-les). Les versions anteriors es conserven.`);
      toast({ title: "Tarifes importades en esborrany", tone: "ok" });
    } catch (e) { toast({ title: "No s'han pogut importar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-6xl" title={`Provar amb un document · ${template.name} (v${useVersion})`}>
      <div className="space-y-3 text-[12.5px]" data-testid="test-document">
        {!wb ? (
          <DropArea accept=".xlsx,.xls,.csv" onFiles={async ([f]) => setWb(await readWorkbook(f))}>
            <DropZone accept=".xlsx,.xls,.csv" onFiles={async ([f]) => setWb(await readWorkbook(f))}>
              <FileSpreadsheet className="text-brand" /><span className="font-medium">Arrossega l&apos;Excel nou de {template.supplier} o fes clic</span>
            </DropZone>
          </DropArea>
        ) : !read ? <Loader2 className="animate-spin" /> : (
          <>
            {read.table?.needsSheet ? (
              <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/[0.05] p-3" data-testid="missing-sheet">
                <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300"><AlertTriangle size={15} /> {read.compatibility.differences[0]}</p>
                <div className="flex flex-wrap gap-2">{wb.sheets.map((sh) => <Button key={sh.name} size="sm" onClick={() => setSheetOverride(sh.name)}>Llegeix «{sh.name}»</Button>)}</div>
              </div>
            ) : read.compatibility.status === "incompatible" ? (
              <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/[0.05] p-3" data-testid="format-changed">
                <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300"><AlertTriangle size={15} /> S&apos;ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura.</p>
                <ul className="list-disc pl-5">{read.compatibility.differences.map((d, i) => <li key={i}>{d}</li>)}</ul>
                <p className="text-muted">No s&apos;ha aplicat la plantilla. La versió actual es conserva per als documents antics.</p>
                <Button variant="primary" onClick={() => onFix(wb)}><MessageSquare size={14} /> Obre el xat de correcció amb aquest document</Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={read.compatibility.status === "compatible" ? "green" : "amber"}>Estructura {read.compatibility.status === "compatible" ? "compatible" : "amb canvis menors"}</Badge>
                  <span>{read.products.length} productes · {read.stats.validated}/{read.stats.fields} valors validats contra les cel·les</span>
                  {!verified && <Badge tone="amber">Plantilla pendent de verificació: les tarifes s&apos;importaran amb avís</Badge>}
                </div>
                {read.compatibility.differences.length > 0 && <Notice>{read.compatibility.differences.join(" · ")}</Notice>}
                {diff && (
                  <div className="rounded-xl border border-line p-3" data-testid="read-diff">
                    <b>Canvis respecte de la lectura anterior ({prev?.file_name})</b>
                    <p className="text-muted">Nous: {diff.added.length} · Eliminats: {diff.removed.length} · Modificats: {diff.changed.length}{diff.validity ? ` · Vigència: ${diff.validity.before ?? "—"} → ${diff.validity.after ?? "—"}` : ""}</p>
                    <ul className="mt-1 max-h-40 overflow-auto">{diff.changed.slice(0, 40).map((c) => <li key={c.key}>{c.name} · {c.variant}: {c.fields.map((f) => `${f.field} ${fmt(f.before)} → ${fmt(f.after)}`).join(", ")}</li>)}
                      {diff.added.slice(0, 10).map((p) => <li key={p.key} className="text-ren">+ {p.name} · {p.variant}</li>)}{diff.removed.slice(0, 10).map((p) => <li key={p.key} className="text-red-600">− {p.name} · {p.variant}</li>)}</ul>
                  </div>
                )}
                {prev === null && <p className="text-muted">És la primera lectura d&apos;aquesta plantilla: no hi ha preus anteriors per comparar.</p>}
                {isTable ? <><CountsBar read={read} /><InterpretedTable read={read} /></> : <ProductsPreview read={read} />}
                {done ? <Notice tone="green">{done}</Notice> : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" disabled={!!busy || !read.products.length} onClick={() => void importOffers()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Aprova i importa al catàleg (esborrany)</Button>
                    {isTable && role === "admin" && <Button disabled={!!busy || !read.table?.counts.interpreted} onClick={() => void importOffers(true)} data-testid="import-activate"><ShieldCheck size={14} /> Aprova i activa les interpretades ({read.table?.counts.interpreted})</Button>}
                    <Button variant="ghost" onClick={() => onFix(wb)}><MessageSquare size={14} /> Corregeix la plantilla amb aquest document</Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
