"use client";
/** Pestanya DOCUMENTS: gestor documental del client (bucket privat, URL signades de 60 s, versions i auditoria). */
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CheckCircle2, Download, Eye, FileImage, FileSpreadsheet, FileText, FileUp, History, Loader2, Lock, Pencil, RotateCcw, Search, Trash2, Upload, XCircle } from "lucide-react";
import { DOC_CATEGORIES, DOC_CATEGORY_LABEL, SENSITIVE_CATEGORIES, extOf, fmtBytes, type CrmDocument, type DocCategory } from "@/core/crm";
import { fmtDate, fmtDateTime } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice } from "../../components/ui";
import { DropZone, DropArea } from "../../components/DropZone";
import { crmApi, uploadDocument } from "./api";
import type { Ctx } from "./ClientDetail";

type Upload = { key: string; file: File; pct: number; status: "pendent" | "pujant" | "fet" | "error"; error?: string };

export const guessCategory = (name: string): DocCategory => {
  const n = name.toLowerCase();
  if (/dni|nie|passaport|pasaporte/.test(n)) return "dni_nie";
  if (/factura|fra[_ -]|invoice/.test(n)) return /gas/.test(n) ? "factura_gas" : "factura_llum";
  if (/signat|firmad|signed/.test(n)) return "contracte_signat";
  if (/contract|contrat/.test(n)) return "contracte";
  if (/mandat|autoritz|autoriza/.test(n)) return "mandat";
  if (/cif|modelo|036|037|escritura|fiscal/.test(n)) return "fiscal";
  if (/proposta|propuesta|comparativa/.test(n)) return "proposta";
  if (/banc|iban|sepa|domicili/.test(n)) return "bancaria";
  return "altres";
};
const DocIcon = ({ mime }: { mime: string }) => (mime.startsWith("image/") ? <FileImage size={18} /> : /sheet|excel|csv/.test(mime) ? <FileSpreadsheet size={18} /> : <FileText size={18} />);

export function DocumentsTab({ ctx }: { ctx: Ctx }) {
  const { d, reload } = ctx;
  const [limits, setLimits] = useState<{ types: string[]; maxBytes: number } | null>(null);
  const [category, setCategory] = useState<DocCategory | "auto">("auto");
  const [supplyId, setSupplyId] = useState("");
  const [contractId, setContractId] = useState("");
  const [queue, setQueue] = useState<Upload[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"" | DocCategory>("");
  const [archived, setArchived] = useState(false);
  const [preview, setPreview] = useState<{ doc: CrmDocument; url: string; mime: string } | null>(null);
  const [edit, setEdit] = useState<CrmDocument | null>(null);
  const [versions, setVersions] = useState<CrmDocument | null>(null);
  const newVersionFor = useRef<CrmDocument | null>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const toast = useApp((s) => s.toast);
  const canUpload = true; // qui veu el client pot aportar documents; la RLS i el servidor ho validen
  useEffect(() => { crmApi.docLimits().then(setLimits).catch(() => undefined); }, []);
  const accept = (limits?.types ?? ["pdf", "jpg", "jpeg", "png", "webp", "docx", "xlsx"]).map((t) => `.${t}`).join(",");

  const startUploads = async (files: File[]) => {
    const items: Upload[] = files.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, pct: 0, status: "pendent" }));
    setQueue((x) => [...items, ...x]);
    let ok = 0;
    for (const it of items) {
      const upd = (p: Partial<Upload>) => setQueue((x) => x.map((u) => (u.key === it.key ? { ...u, ...p } : u)));
      if (limits && it.file.size > limits.maxBytes) { upd({ status: "error", error: `Supera el màxim de ${fmtBytes(limits.maxBytes)}` }); continue; }
      if (limits && !limits.types.includes(extOf(it.file.name))) { upd({ status: "error", error: "Tipus no admès" }); continue; }
      const cat = category === "auto" ? guessCategory(it.file.name) : category;
      if (SENSITIVE_CATEGORIES.includes(cat) && !d.permissions.canSeeSensitive) { upd({ status: "error", error: "No tens permís per pujar documents identificatius o bancaris" }); continue; }
      upd({ status: "pujant" });
      try {
        await uploadDocument(it.file, { clientId: d.client.id, category: cat, supplyId: supplyId || null, contractId: contractId || null }, (pct) => upd({ pct }));
        upd({ status: "fet", pct: 100 });
        ok++;
      } catch (e) {
        upd({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (ok) { toast({ title: ok === 1 ? "Document pujat" : `${ok} documents pujats`, tone: "ok" }); await reload(); }
  };
  const uploadVersion = async (file: File) => {
    const doc = newVersionFor.current;
    if (!doc) return;
    const key = `v-${doc.id}-${Date.now()}`;
    setQueue((x) => [{ key, file, pct: 0, status: "pujant" }, ...x]);
    try {
      await uploadDocument(file, { clientId: d.client.id, documentId: doc.id }, (pct) => setQueue((x) => x.map((u) => (u.key === key ? { ...u, pct } : u))));
      setQueue((x) => x.map((u) => (u.key === key ? { ...u, status: "fet", pct: 100 } : u)));
      toast({ title: `Nova versió de «${doc.title}»`, tone: "ok" });
      await reload();
    } catch (e) {
      setQueue((x) => x.map((u) => (u.key === key ? { ...u, status: "error", error: e instanceof Error ? e.message : String(e) } : u)));
    }
  };

  const open = async (doc: CrmDocument, download: boolean, version?: number) => {
    try {
      const r = await crmApi.docUrl(doc.id, { download, version });
      if (download) { const a = document.createElement("a"); a.href = r.url; a.rel = "noopener"; a.click(); }
      else setPreview({ doc, url: r.url, mime: r.mime });
    } catch (e) { toast({ title: "No s'ha pogut obrir", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const act = async (doc: CrmDocument, action: "archive" | "restore" | "delete") => {
    if (action === "delete" && !confirm(`Eliminar definitivament «${doc.title}» i totes les seves versions? Aquesta acció no es pot desfer.`)) return;
    try { await crmApi.docAction({ action, id: doc.id }); toast({ title: action === "delete" ? "Document eliminat" : action === "archive" ? "Document arxivat" : "Document restaurat", tone: "ok" }); await reload(); }
    catch (e) { toast({ title: "No s'ha pogut fer", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };

  const docs = useMemo(() => {
    const s = q.trim().toLowerCase();
    return d.documents.filter((x) => (archived ? x.status === "arxivat" : x.status === "actiu") && (!cat || x.category === cat) && (!s || `${x.title} ${x.original_name} ${x.description ?? ""}`.toLowerCase().includes(s)));
  }, [d.documents, q, cat, archived]);
  const archivedCount = d.documents.filter((x) => x.status === "arxivat").length;
  const cupsOf = (id: string | null) => d.supplies.find((s) => s.id === id)?.cups;
  const contractOf = (id: string | null) => d.contracts.find((k) => k.id === id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {canUpload && (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block"><span className="label">Categoria</span>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value as DocCategory | "auto")}>
                <option value="auto">Automàtica (pel nom del fitxer)</option>
                {DOC_CATEGORIES.filter((c) => d.permissions.canSeeSensitive || !SENSITIVE_CATEGORIES.includes(c)).map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Relaciona amb un CUPS</span><select className="input" value={supplyId} onChange={(e) => setSupplyId(e.target.value)}><option value="">—</option>{d.supplies.filter((s) => !s.archived_at).map((s) => <option key={s.id} value={s.id}>{s.cups.slice(0, 20)}</option>)}</select></label>
            <label className="block"><span className="label">Relaciona amb un contracte</span><select className="input" value={contractId} onChange={(e) => setContractId(e.target.value)}><option value="">—</option>{d.contracts.map((k) => <option key={k.id} value={k.id}>{k.retailer}{k.product ? ` · ${k.product}` : ""}</option>)}</select></label>
          </div>
          <DropZone multiple accept={accept} onFiles={startUploads} onReject={(m) => toast({ title: m, tone: "err" })}>
            <FileUp className="text-brand" />
            <span className="font-medium">Arrossega aquí els documents o fes clic per seleccionar-los</span>
            <span className="text-[12px] text-muted">{(limits?.types ?? []).map((t) => t.toUpperCase()).join(", ") || "PDF, JPG, PNG, WebP, DOCX, XLSX"} · màx. {limits ? fmtBytes(limits.maxBytes) : "25 MB"} per fitxer · emmagatzematge privat</span>
          </DropZone>
          {queue.length > 0 && (
            <ul className="space-y-1.5">
              {queue.slice(0, 8).map((u) => (
                <li key={u.key} className="flex items-center gap-2 text-[12.5px]">
                  {u.status === "fet" ? <CheckCircle2 size={15} className="text-ren" /> : u.status === "error" ? <XCircle size={15} className="text-lost" /> : <Loader2 size={15} className="animate-spin text-muted" />}
                  <span className="w-56 truncate">{u.file.name}</span>
                  {u.status === "error" ? <span className="text-lost">{u.error}</span> : (
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.07]"><span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${u.pct}%` }} /></span>
                  )}
                  <span className="w-14 text-right text-muted tnum">{u.status === "fet" ? "Fet" : u.status === "error" ? "" : `${u.pct} %`}</span>
                </li>
              ))}
              {queue.every((u) => u.status === "fet" || u.status === "error") && <button className="text-[12px] text-muted hover:text-ink" onClick={() => setQueue([])}>Neteja la llista</button>}
            </ul>
          )}
          <input ref={versionInput} type="file" className="hidden" accept={accept} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadVersion(f); }} />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-8" placeholder="Cerca per nom o descripció…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca documents" />
        </div>
        <select className="input w-auto" aria-label="Categoria" value={cat} onChange={(e) => setCat(e.target.value as "" | DocCategory)}><option value="">Totes les categories</option>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}</select>
        {archivedCount > 0 && <label className="flex items-center gap-1.5 text-[12.5px] text-muted"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Arxivats ({archivedCount})</label>}
      </div>
      {!d.permissions.canSeeSensitive && <p className="flex items-center gap-1.5 text-[12px] text-muted"><Lock size={12} /> Els documents identificatius (DNI/NIE) i bancaris només els veuen Administració, Direcció i el comercial responsable.</p>}

      {docs.length === 0 ? (
        <Empty icon={<FileText size={24} />} title={d.documents.length ? "Cap document amb aquests criteris" : "Encara no hi ha documents"} body={d.documents.length ? undefined : "Puja factures, contractes, DNI, mandats… Queden guardats de manera privada i vinculats al client."} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-2 text-left">Document</th><th className="px-3 py-2 text-left">Categoria</th><th className="px-3 py-2 text-left">Relacionat amb</th><th className="px-3 py-2 text-left">Mida</th><th className="px-3 py-2 text-left">Pujat</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {docs.map((x) => {
                const k = contractOf(x.contract_id);
                const locked = !!x.retain_until && x.retain_until > today;
                return (
                  <tr key={x.id} className="border-t border-line align-top">
                    <td className="px-3 py-2.5">
                      <button className="flex items-start gap-2.5 text-left" onClick={() => open(x, false)}>
                        <span className="mt-0.5 text-muted"><DocIcon mime={x.mime} /></span>
                        <span className="min-w-0"><span className="block font-medium hover:underline">{x.title}</span><span className="block truncate text-[11px] text-muted">{x.original_name}{x.version > 1 ? ` · v${x.version}` : ""}</span>{x.description && <span className="block text-[11px] text-muted">{x.description}</span>}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5"><Badge tone={x.sensitive ? "red" : "zinc"}>{x.sensitive && <Lock size={10} />} {DOC_CATEGORY_LABEL[x.category]}</Badge>{locked && <p className="mt-1 text-[10.5px] text-muted">Conservació fins al {fmtDate(x.retain_until)}</p>}</td>
                    <td className="px-3 py-2.5 text-muted">{cupsOf(x.supply_id) && <span className="block font-mono text-[11.5px]">{cupsOf(x.supply_id)!.slice(0, 20)}</span>}{k && <span className="block">{k.retailer}{k.product ? ` · ${k.product}` : ""}</span>}{!x.supply_id && !x.contract_id && "—"}</td>
                    <td className="px-3 py-2.5 text-muted tnum">{fmtBytes(x.size_bytes)}</td>
                    <td className="px-3 py-2.5 text-muted">{fmtDateTime(x.created_at)}<span className="block text-[11px]">{x.uploaded_by_name}</span></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <Button size="sm" variant="ghost" title="Previsualitza" aria-label="Previsualitza" onClick={() => open(x, false)}><Eye size={14} /></Button>
                      <Button size="sm" variant="ghost" title="Descarrega" aria-label="Descarrega" onClick={() => open(x, true)}><Download size={14} /></Button>
                      {(x.versions?.length ?? 0) > 1 && <Button size="sm" variant="ghost" title="Versions" aria-label="Versions" onClick={() => setVersions(x)}><History size={14} /></Button>}
                      {d.permissions.canEdit && <DropArea className="inline-block" accept={accept} label="Versió nova" onFiles={([f]) => { newVersionFor.current = x; void uploadVersion(f); }}><Button size="sm" variant="ghost" title="Puja una versió nova (o arrossega-hi el fitxer)" aria-label="Puja una versió nova" onClick={() => { newVersionFor.current = x; versionInput.current?.click(); }}><Upload size={14} /></Button></DropArea>}
                      {d.permissions.canEdit && <Button size="sm" variant="ghost" title="Reclassifica" aria-label="Reclassifica" onClick={() => setEdit(x)}><Pencil size={14} /></Button>}
                      {d.permissions.canEdit && (x.status === "actiu" ? <Button size="sm" variant="ghost" title="Arxiva" aria-label="Arxiva" onClick={() => act(x, "archive")}><Archive size={14} /></Button> : <Button size="sm" variant="ghost" title="Restaura" aria-label="Restaura" onClick={() => act(x, "restore")}><RotateCcw size={14} /></Button>)}
                      {d.permissions.canDeleteDocs && <Button size="sm" variant="ghost" className="text-lost" disabled={locked} title={locked ? "Conservació obligatòria: no es pot eliminar" : "Elimina"} aria-label="Elimina" onClick={() => act(x, "delete")}><Trash2 size={14} /></Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <Modal open onClose={() => setPreview(null)} width="max-w-5xl" title={preview.doc.title}
          footer={<><span className="mr-auto text-[11.5px] text-muted">Enllaç temporal (60 s) · l&apos;accés queda registrat</span><Button onClick={() => open(preview.doc, true)}><Download size={14} /> Descarrega</Button></>}>
          {preview.mime.startsWith("image/") ? (
            <img src={preview.url} alt={preview.doc.title} className="mx-auto max-h-[70vh] rounded-lg object-contain" />
          ) : preview.mime === "application/pdf" ? (
            <object data={preview.url} type="application/pdf" className="h-[70vh] w-full rounded-lg" aria-label={preview.doc.title}>
              <p className="text-[13px]">El navegador no pot mostrar el PDF. <button className="text-brand underline" onClick={() => open(preview.doc, true)}>Descarrega&apos;l</button>.</p>
            </object>
          ) : <Notice tone="blue">Aquest tipus de fitxer no es pot previsualitzar. Descarrega&apos;l per obrir-lo.</Notice>}
        </Modal>
      )}
      {versions && (
        <Modal open onClose={() => setVersions(null)} title={`Versions · ${versions.title}`}>
          <ul className="divide-y divide-line text-[12.5px]">
            {(versions.versions ?? []).map((v) => (
              <li key={v.version} className="flex items-center gap-3 py-2">
                <Badge tone={v.version === versions.version ? "green" : "zinc"}>v{v.version}</Badge>
                <span className="min-w-0 flex-1"><span className="block truncate">{v.original_name}</span><span className="text-[11px] text-muted">{fmtDateTime(v.created_at)} · {v.uploaded_by_name ?? "—"} · {fmtBytes(v.size_bytes)}</span></span>
                <Button size="sm" variant="ghost" aria-label={`Descarrega la versió ${v.version}`} onClick={() => open(versions, true, v.version)}><Download size={14} /></Button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {edit && <DocEdit ctx={ctx} doc={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </div>
  );
}

function DocEdit({ ctx, doc, onClose, onSaved }: { ctx: Ctx; doc: CrmDocument; onClose: () => void; onSaved: () => void }) {
  const { d } = ctx;
  const [f, setF] = useState({ category: doc.category, title: doc.title, description: doc.description ?? "", supplyId: doc.supply_id ?? "", contractId: doc.contract_id ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await crmApi.docAction({ action: "update", id: doc.id, category: f.category, title: f.title, description: f.description || null, supplyId: f.supplyId || null, contractId: f.contractId || null }); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Reclassifica el document" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.title.trim()} onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px]">
        <label className="block"><span className="label">Títol</span><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="block"><span className="label">Categoria</span><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as DocCategory })}>{DOC_CATEGORIES.filter((c) => d.permissions.canSeeSensitive || !SENSITIVE_CATEGORIES.includes(c)).map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}</select></label>
        <label className="block"><span className="label">Descripció</span><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">CUPS</span><select className="input" value={f.supplyId} onChange={(e) => setF({ ...f, supplyId: e.target.value })}><option value="">—</option>{d.supplies.map((s) => <option key={s.id} value={s.id}>{s.cups.slice(0, 20)}</option>)}</select></label>
          <label className="block"><span className="label">Contracte</span><select className="input" value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })}><option value="">—</option>{d.contracts.map((k) => <option key={k.id} value={k.id}>{k.retailer}{k.product ? ` · ${k.product}` : ""}</option>)}</select></label>
        </div>
        {(f.category === "contracte_signat" || f.category === "mandat") && <p className="text-[11.5px] text-muted">Els contractes signats i els mandats tenen conservació obligatòria de 6 anys: es poden arxivar però no eliminar.</p>}
        {err && <p className="text-[12.5px] text-lost">{err}</p>}
      </div>
    </Modal>
  );
}
