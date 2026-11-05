"use client";
/**
 * LECTOR DE TARIFES AMB IA: puja el fitxer de la comercialitzadora (PDF, Excel, CSV o imatge) i la IA en treu les tarifes.
 * L'usuari revisa la llista, corregeix el que calgui i les desa. Tot entra com a esborrany (o activa, si és completa i ho demana).
 */
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { FileUp, Loader2, Pencil, Sparkles, Upload } from "lucide-react";
import { ACCEPTED_TARIFF_FILE, loadCatalog, serverMode, tariffAi, tariffsApi } from "@/comparator/client";
import { aiTariffsToVersions, recheckItem, type AiTariffItem } from "@/comparator/tariff-ai";
import { CONTRACT_TYPE_LABEL, POWER_UNIT_LABEL, type OfferVersion } from "@/comparator/types";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, SupplierMark, cn } from "../../components/ui";
import { DropZone } from "../../components/DropZone";
import { OpenDualView } from "./OpenDualView";
import { NufriPreview } from "./NufriPreview";
import type { NufriDoc } from "@/comparator/nufri-reader";
import { TestDocument } from "../retailers/ReadingTemplates";
import { readWorkbook, tplApi, type TemplateRow } from "../retailers/templates-api";
import { checkStructure, type TemplateDef, type WorkbookGrid } from "@/comparator/xlsx-template";
import { proposeTable } from "@/comparator/tariff-table";
import { detectSupplier } from "@/comparator/reading-knowledge";
import { TableReader } from "../retailers/TableReader";
import { readKnownWorkbook, type KnownRead } from "@/comparator/known-reader";
import { CLASSIFICATION_LABEL, type Classification } from "@/comparator/xlsx-template";

/** Busca una plantilla de lectura activa compatible amb l'Excel (per comercialitzadora i estructura). */
async function matchTemplate(f: File): Promise<{ match?: { row: TemplateRow; wb: WorkbookGrid; def: TemplateDef }; changed?: { row: TemplateRow; differences: string[] }; wb: WorkbookGrid } | null> {
  // Fase 14.1: l'Excel es llegeix sempre al navegador; si les plantilles no es poden consultar (migració pendent o
  // sense connexió), es continua amb els lectors integrats en lloc d'enviar-lo a la IA.
  const [wb, list] = await Promise.all([readWorkbook(f), tplApi.list({ defs: true }).catch(() => ({ templates: [] as TemplateRow[], defs: [] as { templateId: string; version: number; definition: unknown }[] }))]);
  let changed: { row: TemplateRow; differences: string[] } | undefined;
  for (const d of list.defs ?? []) {
    const row = list.templates.find((t) => t.id === d.templateId);
    if (!row) continue;
    const st = checkStructure(wb, d.definition as TemplateDef);
    if (st.compatibility.status !== "incompatible") return { match: { row, wb, def: d.definition as TemplateDef }, wb };
    const found = (d.definition as TemplateDef).layout === "taula" ? (st.sheet ? 1 : 0) : Object.values(st.anchors).filter((x) => x != null).length;
    if (found > 0 && !changed) changed = { row, differences: st.compatibility.differences };
  }
  return { changed, wb };
}
import type { OpenDocument } from "@/comparator/endesa-open";

const STATUS: Record<AiTariffItem["status"], { label: string; tone: "green" | "zinc" | "amber" | "red" | "blue" }> = {
  nova: { label: "Nova", tone: "green" },
  modificada: { label: "Preus nous", tone: "blue" },
  revisio: { label: "Revisar", tone: "amber" },
  incompleta: { label: "Incompleta", tone: "red" },
  sense_canvis: { label: "Sense canvis", tone: "zinc" },
  duplicada: { label: "Duplicada", tone: "zinc" },
};
const preselect = (i: AiTariffItem) => i.status !== "sense_canvis" && i.status !== "duplicada";
const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { maximumFractionDigits: 6 }));

type EditorProps = { offer: OfferVersion; onClose: () => void; onSaved: () => void; onApply?: (o: OfferVersion) => void };

export function TariffAiReader({ Editor, onDone }: { Editor: ComponentType<EditorProps>; onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  const [ai, setAi] = useState<boolean | null>(null);
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [items, setItems] = useState<AiTariffItem[] | null>(null);
  const [docWarnings, setDocWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AiTariffItem | null>(null);
  const [activate, setActivate] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<{ doc: OpenDocument; file: File } | null>(null);
  const [nufri, setNufri] = useState<{ doc: NufriDoc; file: string; existing: OfferVersion[] } | null>(null);
  const [tplMatch, setTplMatch] = useState<{ row: TemplateRow; wb: WorkbookGrid } | null>(null);
  const [formatChange, setFormatChange] = useState<{ row: TemplateRow; differences: string[] } | null>(null);
  const [universal, setUniversal] = useState<{ wb: WorkbookGrid; def: TemplateDef | null; error: string | null; supplier: string } | null>(null);
  const [known, setKnown] = useState<{ wb: WorkbookGrid; def: TemplateDef | null; existing: OfferVersion[]; classification: Record<string, Classification>; read: KnownRead } | null>(null);
  const isAdmin = useApp((s) => s.snap?.me.role === "admin");

  useEffect(() => { tariffAi.status().then((r) => setAi(r.ai)).catch(() => setAi(false)); }, []);

  const read = async (f: File) => {
    setError(null); setSaved(null); setItems(null); setDocWarnings([]); setFile(f.name); setOpenDoc(null); setNufri(null); setTplMatch(null); setFormatChange(null); setKnown(null);
    try {
      // Fase 11: si és un Excel d'un format conegut (plantilla de lectura activa), es llegeix amb la plantilla
      if (/\.(xlsx|xls|csv)$/i.test(f.name)) {
        setBusy("Obrint el full de càlcul i reconeixent la comercialitzadora…");
        const found = await matchTemplate(f).catch(() => null);
        // Fase 14.1: formats per blocs coneguts (Naturgy · Captación PYMES) → lector integrat, document sencer,
        // sense IA i sense límit de tarifes. Si hi ha una plantilla VERIFICADA compatible, se'n fan servir les regles.
        const detB = found?.wb ? detectSupplier(found.wb) : null;
        if (found?.wb && detB?.pack.layout === "blocs") {
          setBusy(`Fitxer reconegut: ${detB.supplier}. Llegint totes les famílies de productes…`);
          const catalog = await loadCatalog().catch(() => ({ items: [] as OfferVersion[] }));
          const existing = catalog.items.filter((x) => x.origin !== "crm" && x.status === "activa");
          const def = found.match && found.match.row.status === "verificada" && found.match.def.layout !== "taula" ? found.match.def : null;
          const r = readKnownWorkbook(found.wb, { existing, def });
          if (r) {
            setKnown({ wb: found.wb, def, existing, classification: {}, read: r });
            setItems(r.items);
            setSelected(new Set(r.items.filter(preselect).map((i) => i.offer.id)));
            setDocWarnings(r.warnings);
            if (!supplier.trim()) setSupplier(r.supplier);
            toast({ title: `${r.supplier}: ${r.items.length} tarifes llegides`, body: `${r.template} · ${r.families.length} famílies · sense IA`, tone: "ok" });
            setBusy(null);
            return;
          }
        }
        if (found?.match) { setTplMatch(found.match); setBusy(null); return; }
        if (found?.changed) setFormatChange(found.changed);
        // Fase 12: comercialitzadora amb coneixement propi (p. ex. Iberdrola «Energía») → lector universal local.
        // No s'envia l'Excel sencer a la IA: el parser llegeix totes les files i les regles l'interpreten.
        const det = found?.wb ? detectSupplier(found.wb) : null;
        if (det?.pack.layout === "taula" && found?.wb && !found.changed) {
          const p = proposeTable(found.wb, { supplier: det.supplier, name: "Full de preus", knowledge: det.pack.id });
          setUniversal({ wb: found.wb, def: p.def, error: p.error, supplier: det.supplier });
          setBusy(null);
          return;
        }
      }
      const [{ raw, kind, truncated, open, nufri: nf }, catalog] = await Promise.all([tariffAi.read(f, supplier.trim() || null, setBusy), loadCatalog().catch(() => ({ items: [] as OfferVersion[] }))]);
      if (nf) {
        // Annex d'Energía Nufri: lector local determinista (sense IA)
        setNufri({ doc: nf, file: f.name, existing: catalog.items.filter((x) => x.origin !== "crm") });
        if (!supplier.trim()) setSupplier("Nufri");
        toast({ title: "Annex de Nufri llegit en local", body: kind, tone: "ok" });
        return;
      }
      if (open) {
        // Tarifa Open d'Endesa: lector local + ponderació horària (vista doble)
        setOpenDoc({ doc: open, file: f });
        if (!supplier.trim()) setSupplier(open.supplier);
        toast({ title: `Tarifa Open ${open.tariff} llegida`, body: `${kind} · ${open.brackets.length} trams de potència`, tone: "ok" });
        return;
      }
      const existing = catalog.items.filter((x) => x.origin !== "crm" && x.status === "activa");
      const r = aiTariffsToVersions(raw, { fileName: f.name, supplierHint: supplier.trim() || null, existing });
      setItems(r.items);
      setSelected(new Set(r.items.filter(preselect).map((i) => i.offer.id)));
      setDocWarnings([...(truncated ? ["El full de càlcul era molt gran i només s'ha llegit una part: revisa que hi siguin totes les tarifes."] : []), ...r.warnings]);
      if (!supplier.trim() && r.supplierName) setSupplier(r.supplierName);
      toast({ title: `${r.items.length} tarifes llegides`, body: `${kind} · revisa-les abans de desar`, tone: r.items.length ? "ok" : "info" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const c: Partial<Record<AiTariffItem["status"], number>> = {};
    for (const i of items ?? []) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);
  const chosen = (items ?? []).filter((i) => selected.has(i.offer.id));
  const unsavable = chosen.filter((i) => !i.offer.supplierName.trim() || !i.offer.productName.trim() || i.offer.accessTariff.trim().length < 2);

  const save = async () => {
    if (!items || !file) return;
    setBusy("Desant les tarifes…");
    try {
      const r = await tariffsApi.importConfirm({
        fileName: file,
        supplierName: supplier.trim() || null,
        mapping: { lector: known ? `integrat:${known.read.template}` : "ia" },
        counts: Object.fromEntries(Object.entries(counts)),
        report: items.map((i, k) => ({ row: k + 1, status: i.status, errors: i.errors, warnings: i.warnings })),
        offers: chosen.filter((i) => !unsavable.includes(i)).map((i) => i.offer),
        activateComplete: activate,
        keepDraftIds: chosen.filter((i) => i.status !== "nova" && i.status !== "modificada").map((i) => i.offer.id),
        keepIncompleteAsDraft: true,
        dryRun: false,
      });
      setSaved(`${r.saved} tarifes desades (${r.activated} activades, la resta en esborrany)${r.rejected ? ` · ${r.rejected} rebutjades pel servidor` : ""}.`);
      toast({ title: "Tarifes desades al catàleg", tone: "ok" });
      setItems(null);
      onDone();
    } catch (e) {
      toast({ title: "No s'han pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const reclassify = (blockId: string, c: Classification) => {
    if (!known) return;
    const classification = { ...known.classification, [blockId]: c };
    const r = readKnownWorkbook(known.wb, { existing: known.existing, def: known.def, classification });
    if (!r) return;
    setKnown({ ...known, classification, read: r });
    setItems(r.items);
    setSelected(new Set(r.items.filter(preselect).map((i) => i.offer.id)));
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3">
      <Notice tone="blue">
        Puja el fitxer que t&apos;ha enviat la comercialitzadora (PDF, Excel, CSV o foto) i la IA en llegirà les tarifes. No es desa res fins que no ho confirmis:
        revisa els preus, corregeix el que calgui i desa-les. Les incompletes entren com a esborrany i no s&apos;ofereixen a les comparatives fins que s&apos;activin.
      </Notice>
      {!serverMode() && <Notice>El lector necessita el servidor de la plataforma.</Notice>}
      {serverMode() && ai === false && <Notice tone="amber">Falta la clau ANTHROPIC_API_KEY al servidor: la lectura amb IA (PDF i imatges d&apos;altres comercialitzadores) no està disponible. Sí que funcionen sense IA: els Excel de Naturgy (Captación PYMES) i d&apos;Iberdrola, els Excel amb plantilla de lectura, els PDF de la Tarifa Open d&apos;Endesa, els annexos de tarifes de Nufri (llum i gas) i «Importar Excel / CSV» amb mapatge de columnes.</Notice>}
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <label className="block max-w-sm">
          <span className="label">Comercialitzadora (opcional)</span>
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Si el document no la diu clarament" />
        </label>
        <DropZone accept={ai === false ? ".pdf,application/pdf,.xlsx,.xls" : ACCEPTED_TARIFF_FILE} disabled={!!busy || !serverMode()} onFiles={([f]) => read(f)} onReject={setError}>
          {busy ? <Loader2 className="animate-spin text-brand" /> : <FileUp className="text-brand" />}
          <span className="font-medium">{busy ?? "Arrossega aquí el fitxer de tarifes o fes clic per seleccionar-lo"}</span>
          <span className="text-[12px] text-muted">PDF, Excel (.xlsx, .xls), CSV, JPG, PNG, HEIC o TIFF · màx. 10 MB · el fitxer no es conserva després de llegir-lo</span>
        </DropZone>
        {error && <Notice tone="red">{error}</Notice>}
        {saved && <Notice tone="green">{saved}</Notice>}
      </section>

      {known && <KnownPanel r={known.read} classification={known.classification} onReclassify={reclassify} />}
      {formatChange && (
        <Notice tone="red">S&apos;ha detectat un canvi en el format de les tarifes. Cal revisar la plantilla de lectura «{formatChange.row.name}» ({formatChange.row.supplier}): {formatChange.differences.slice(0, 3).join(" · ")}. El document s&apos;ha llegit amb el lector general; per corregir la plantilla, obre Comercialitzadores → {formatChange.row.supplier} → Plantilles de lectura IA.</Notice>
      )}
      {universal && (
        <Modal open onClose={() => setUniversal(null)} width="max-w-[96vw]" title={`Lector universal · ${universal.supplier}`}>
          {universal.def ? <TableReader templateId={null} sample={universal.wb} draft={universal.def} retailerId={null} supplier={universal.supplier} isAdmin={isAdmin} onClose={() => { setUniversal(null); onDone(); }} />
            : <Notice tone="red">{universal.error} Crea la plantilla des de Comercialitzadores → {universal.supplier} → Plantilles de lectura IA, on pots triar la pestanya manualment.</Notice>}
        </Modal>
      )}
      {tplMatch && <TestDocument template={tplMatch.row} initial={tplMatch.wb} onClose={() => { setTplMatch(null); onDone(); }} onFix={() => { const id = tplMatch.row.retailer_id; setTplMatch(null); if (id) useApp.getState().navigate("comercialitzadora", { id }); }} />}
      {nufri && <NufriPreview doc={nufri.doc} fileName={nufri.file} existing={nufri.existing} onDone={onDone} onCancel={() => setNufri(null)} />}
      {openDoc && <OpenDualView doc={openDoc.doc} file={openDoc.file} onDone={() => { setOpenDoc(null); onDone(); }} onCancel={() => setOpenDoc(null)} />}

      {items && (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><Sparkles size={15} className="text-brand" /> {items.length} tarifes llegides de «{file}»</h3>
            <div className="flex flex-wrap gap-1.5">{(Object.keys(STATUS) as AiTariffItem["status"][]).filter((k) => counts[k]).map((k) => <Badge key={k} tone={STATUS[k].tone}>{STATUS[k].label}: {counts[k]}</Badge>)}</div>
          </div>
          {docWarnings.length > 0 && <Notice>{docWarnings.join(" · ")}</Notice>}
          {items.length > 0 && (
            <div className="max-h-[520px] overflow-auto rounded-xl border border-line">
              <table className="w-full min-w-[980px] text-[12px]">
                <thead className="sticky top-0 z-10 bg-elevated text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-8 px-2 py-2"><input type="checkbox" aria-label="Selecciona-les totes" checked={selected.size === items.length} onChange={(e) => setSelected(new Set(e.target.checked ? items.map((i) => i.offer.id) : []))} /></th>
                    <th className="px-2 py-2 text-left">Oferta</th>
                    <th className="px-2 py-2 text-left">Peatge</th>
                    <th className="px-2 py-2 text-left">Tipus</th>
                    <th className="px-2 py-2 text-left">Energia €/kWh</th>
                    <th className="px-2 py-2 text-left">Potència</th>
                    <th className="px-2 py-2 text-left">Vigència</th>
                    <th className="px-2 py-2 text-left">Pàg.</th>
                    <th className="px-2 py-2 text-left">Estat</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const o = i.offer;
                    const energy = o.energy24h != null ? fmt(o.energy24h) : (o.contractType === "indexat" ? o.indexedReference?.energy ?? [] : o.energy).filter((x) => x != null).map(fmt).join(" / ") || "—";
                    const power = o.power.some((x) => x != null) ? `${o.power.filter((x) => x != null).map(fmt).join(" / ")} ${POWER_UNIT_LABEL[o.powerUnit]}` : o.gasFixedEurDay != null ? `${fmt(o.gasFixedEurDay)} €/client·dia` : "—";
                    return (
                      <tr key={o.id} className={cn("border-t border-line align-top", selected.has(o.id) && "bg-brand/[0.04]")}>
                        <td className="px-2 py-2"><input type="checkbox" aria-label={`Selecciona ${o.productName}`} checked={selected.has(o.id)} onChange={() => toggle(o.id)} /></td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2"><SupplierMark name={o.supplierName || "?"} size={20} /><div><p className="font-medium">{o.supplierName || "—"} · {o.productName || "—"}</p>{i.previous && <p className="text-[11px] text-muted">Substituirà la v{i.previous.version} activa</p>}</div></div>
                          {!!i.conversions?.length && <p className="mt-1 text-[11px] text-brand">{i.conversions.join(" · ")}</p>}
                          {(i.errors.length > 0 || i.warnings.length > 0) && (
                            <p className="mt-1 text-[11px]"><span className="text-lost">{i.errors.join(" · ")}</span>{i.errors.length && i.warnings.length ? " · " : ""}<span className="text-pend">{i.warnings.join(" · ")}</span></p>
                          )}
                        </td>
                        <td className="px-2 py-2">{o.accessTariff || "—"}</td>
                        <td className="px-2 py-2">{CONTRACT_TYPE_LABEL[o.contractType]}{o.permanenceMonths ? ` · ${o.permanenceMonths} m perm.` : ""}</td>
                        <td className="px-2 py-2 tnum">{energy}</td>
                        <td className="px-2 py-2 tnum">{power}</td>
                        <td className="px-2 py-2 text-muted">{o.validFrom ?? "—"} → {o.validTo ?? "—"}</td>
                        <td className="px-2 py-2 text-muted">{i.page ?? "—"}</td>
                        <td className="px-2 py-2"><Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge></td>
                        <td className="px-2 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(i)}><Pencil size={13} /> Revisa</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {unsavable.length > 0 && <Notice>{unsavable.length} de les seleccionades no tenen comercialitzadora, nom o peatge: obre-les amb «Revisa» per completar-les, o no es desaran.</Notice>}
          <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Activa directament les completes i sense avisos (la resta queden en esborrany)</label>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!!busy || chosen.length === unsavable.length} onClick={save}><Upload size={14} /> Desa {chosen.length - unsavable.length} tarifes al catàleg</Button>
            <Button variant="ghost" onClick={() => { setItems(null); setFile(null); }}>Descarta</Button>
          </div>
        </section>
      )}
      {editing && (
        <Editor
          offer={editing.offer}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onApply={(o) => {
            const next = recheckItem(editing, o);
            setItems((list) => (list ?? []).map((x) => (x.offer.id === editing.offer.id ? next : x)));
            setSelected((s) => new Set(s).add(o.id));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Fase 14.1 · Document reconegut: comercialitzadora, plantilla, famílies (progrés), serveis i fulls de metadades. */
function KnownPanel({ r, classification, onReclassify }: { r: KnownRead; classification: Record<string, Classification>; onReclassify: (blockId: string, c: Classification) => void }) {
  const total = r.items.length;
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" data-testid="document-reconegut">
      <div className="grid gap-2 text-[13px] sm:grid-cols-3">
        <p><span className="text-muted">Fitxer reconegut:</span> <b>{r.supplier}</b></p>
        <p><span className="text-muted">Plantilla detectada:</span> <b>{r.template.replace(`${r.supplier} · `, "")}</b>{r.source === "plantilla_verificada" && <Badge tone="green" className="ml-1">verificada</Badge>}</p>
        <p><span className="text-muted">Estat:</span> <b>Document llegit sencer</b> · {total} tarifes · sense IA{r.validity ? ` · ${r.validity}` : ""}</p>
      </div>
      <div className="space-y-1.5">
        {r.families.map((f) => {
          const pct = f.products ? Math.round((f.complete / f.products) * 100) : 0;
          return (
            <div key={f.id} className="grid items-center gap-2 text-[12.5px] sm:grid-cols-[260px_1fr_auto]">
              <span className="font-medium">{f.title} <span className="text-[11px] text-muted">· {f.energyType === "gas" ? "gas" : "llum"}</span></span>
              {f.excluded ? <span className="text-muted">No publicat al document (cel·les #N/A): no s&apos;importa cap preu.</span> : (
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/[0.07]"><div className={cn("h-full rounded-full", f.incomplete ? "bg-pend" : "bg-ren")} style={{ width: `${pct}%` }} /></div>
                  <span className="w-44 text-[11.5px] text-muted">{f.complete} de {f.products} completes{f.incomplete ? ` · ${f.incomplete} per revisar` : ""}</span>
                </div>
              )}
              <span>
                {(f.pending || classification[f.id]) && !f.excluded ? (
                  <select className="input h-8 py-0 text-[12px]" aria-label={`Tipus de ${f.title}`} value={classification[f.id] ?? "pendent"} onChange={(e) => onReclassify(f.id, e.target.value as Classification)}>
                    <option value="pendent">PENDENT: cal confirmar</option>
                    <option value="fixa">FIXA (preu revisable)</option>
                    <option value="indexada">INDEXADA</option>
                  </select>
                ) : <Badge tone={f.classification === "fixa" ? "green" : "amber"}>{CLASSIFICATION_LABEL[f.classification]}</Badge>}
              </span>
            </div>
          );
        })}
      </div>
      {r.families.some((f) => f.pending && !f.excluded && !classification[f.id]) && <Notice>Les famílies «Variable» no s&apos;activen fins que confirmis si són de preu fix revisable o indexades. Tria-ho al desplegable i les tarifes es tornen a validar.</Notice>}
      {r.services.length > 0 && <p className="text-[12px] text-muted"><b className="text-ink">Serveis addicionals</b> (no són tarifes d&apos;energia, no s&apos;importen al comparador): {r.services.map((x) => `${x.name} ${x.price != null ? `${x.price.toLocaleString("ca-ES")} €` : "—"}`).join(" · ")}</p>}
      {r.metadataSheets.length > 0 && <p className="text-[12px] text-muted">Fulls de metadades (no són tarifes): {r.metadataSheets.join(", ")}.</p>}
    </section>
  );
}
