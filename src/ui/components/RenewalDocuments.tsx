"use client";
/**
 * Pestanya «Documents» de la fitxa lateral de Renovacions.
 *  1. Propostes de renovació generades des del CRM (versió, data, autor) → descarregar o enviar per correu.
 *  2. Documents del client a Clients 360° (factures, contractes, mandats…) → veure, descarregar i pujar-ne de nous.
 * Cada bloc gestiona els seus errors: si falla la càrrega es mostra un avís amb «Torna-ho a provar» i la resta
 * de la fitxa continua funcionant. Els permisos els aplica el servidor (RLS): cadascú només veu el que li toca.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Eye, FileImage, FileSpreadsheet, FileText, FileUp, Loader2, Lock, Mail, RotateCcw, Users, XCircle } from "lucide-react";
import { DOC_CATEGORIES, DOC_CATEGORY_LABEL, SENSITIVE_CATEGORIES, extOf, fmtBytes, type DocCategory } from "@/core/crm";
import { fmtDateTime } from "@/core/dates";
import type { Contract, ProposalDoc } from "@/core/types";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Notice } from "./ui";
import { DropZone } from "./DropZone";
import { ErrorBoundary } from "./ErrorBoundary";
import { crmApi, crmReady, uploadDocument, type RenewalDocs } from "../views/crm/api";
import { guessCategory } from "../views/crm/DocumentsTab";

const EMPTY: ProposalDoc[] = [];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const safeDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : fmtDateTime(s);
};
const DocIcon = ({ mime }: { mime?: string | null }) => {
  const m = mime ?? "";
  return m.startsWith("image/") ? <FileImage size={18} /> : /sheet|excel|csv/.test(m) ? <FileSpreadsheet size={18} /> : <FileText size={18} />;
};

export function RenewalDocuments({ c }: { c: Contract }) {
  return (
    <div className="space-y-5">
      <ErrorBoundary label="Propostes de renovació" resetKey={c.id}><Proposals c={c} /></ErrorBoundary>
      <ErrorBoundary label="Documents del client" resetKey={c.id}><ClientDocs c={c} /></ErrorBoundary>
    </div>
  );
}

// ---------- 1. Propostes generades
function Proposals({ c }: { c: Contract }) {
  const set = useApp((s) => s.set);
  const repo = useApp((s) => s.repo);
  const toast = useApp((s) => s.toast);
  // IMPORTANT: el selector retorna sempre la mateixa referència (la llista del store); el filtre es fa amb useMemo.
  // Un selector que retorni un array nou a cada lectura provoca un bucle infinit (React #185) amb zustand v5.
  const allDocs = useApp((s) => s.snap?.docs ?? EMPTY);
  const docs = useMemo(() => (Array.isArray(allDocs) ? allDocs.filter((d) => d && d.contractId === c.id) : EMPTY), [allDocs, c.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const canMail = !!(c.email || c.crm?.emailOverride);

  const dl = async (d: ProposalDoc) => {
    if (!repo) return;
    setBusy(d.id);
    try {
      const url = await repo.getDocUrl(d);
      if (!url) { toast({ title: "Fitxer no disponible", body: "El PDF d'aquesta proposta no es troba a l'emmagatzematge. Torna a generar la proposta.", tone: "err" }); return; }
      const a = document.createElement("a");
      a.href = url; a.download = d.fileName || "proposta.pdf"; a.rel = "noopener"; a.click();
    } catch (e) {
      toast({ title: "No s'ha pogut descarregar", body: errText(e), tone: "err" });
    } finally { setBusy(null); }
  };

  return (
    <section className="space-y-2.5">
      <Button variant="primary" size="lg" className="w-full" onClick={() => set("proposalFor", c.id)}><FileText size={16} /> Genera la proposta de renovació</Button>
      <h3 className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Propostes de renovació</h3>
      {docs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[12.5px] text-muted">Encara no s&apos;ha generat cap proposta. Es desaran aquí amb la versió i la data.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-xl border border-line p-3 text-[12.5px]">
              <FileText size={18} className="shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{d.fileName || "Proposta sense nom"}</p>
                <p className="text-[11px] text-muted">
                  <Badge tone="blue">Proposta</Badge> v{d.version ?? 1} · {safeDate(d.createdAt)}{d.createdBy ? ` · ${d.createdBy}` : ""}
                  {typeof d.ahorroAnual === "number" && Number.isFinite(d.ahorroAnual) ? ` · estalvi ${d.ahorroAnual.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })}` : ""}
                </p>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Descarrega ${d.fileName}`} title={d.storagePath === null ? "Fitxer no disponible" : "Descarrega"} disabled={busy === d.id} onClick={() => dl(d)}>
                {busy === d.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              </Button>
              <Button size="sm" variant="ghost" aria-label="Envia per correu" title={canMail ? "Envia per correu" : "El client no té correu"} disabled={!canMail} onClick={() => set("composer", { contractId: c.id, channel: "email", templateId: "t2", attachDocId: d.id })}><Mail size={13} /></Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- 2. Documents del client (Clients 360°)
type Up = { key: string; name: string; pct: number; status: "pujant" | "fet" | "error"; error?: string };

function ClientDocs({ c }: { c: Contract }) {
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);
  const live = crmReady();
  const [data, setData] = useState<RenewalDocs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<DocCategory | "auto">("auto");
  const [queue, setQueue] = useState<Up[]>([]);

  const load = useCallback(async () => {
    if (!live) return;
    setLoading(true); setErr(null);
    try { setData(await crmApi.renewalDocs(c.id, c.cups)); }
    catch (e) { setErr(errText(e)); }
    finally { setLoading(false); }
  }, [live, c.id, c.cups]);
  useEffect(() => { void load(); }, [load]);

  if (!live) {
    return (
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Documents del client</h3>
        <Notice tone="blue">En mode local no hi ha gestor documental. Amb Supabase configurat, aquí es mostren les factures, contractes i mandats del client (Clients 360°).</Notice>
      </section>
    );
  }

  const open = async (id: string, download: boolean) => {
    // la finestra s'obre abans de l'await perquè el navegador no la bloquegi
    const w = download ? null : window.open("", "_blank");
    try {
      const r = await crmApi.docUrl(id, { download });
      if (download) { const a = document.createElement("a"); a.href = r.url; a.rel = "noopener"; a.click(); }
      else if (w) { w.opener = null; w.location.href = r.url; }
      else window.open(r.url, "_blank", "noopener");
    } catch (e) {
      w?.close();
      toast({ title: "No s'ha pogut obrir el document", body: errText(e), tone: "err" });
    }
  };

  const upload = async (files: File[]) => {
    if (!data?.linked) return;
    let ok = 0;
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const upd = (p: Partial<Up>) => setQueue((q) => q.map((u) => (u.key === key ? { ...u, ...p } : u)));
      setQueue((q) => [{ key, name: file.name, pct: 0, status: "pujant" }, ...q]);
      const cat = category === "auto" ? guessCategory(file.name) : category;
      if (SENSITIVE_CATEGORIES.includes(cat) && !data.permissions.canSeeSensitive) { upd({ status: "error", error: "No tens permís per pujar documents identificatius o bancaris" }); continue; }
      try {
        await uploadDocument(file, { clientId: data.client.id, category: cat, contractId: data.contractId, supplyId: data.supplyId }, (pct) => upd({ pct }));
        upd({ status: "fet", pct: 100 }); ok++;
      } catch (e) { upd({ status: "error", error: errText(e) }); }
    }
    if (ok) { toast({ title: ok === 1 ? "Document pujat" : `${ok} documents pujats`, tone: "ok" }); await load(); }
  };

  const header = (
    <div className="flex items-center gap-2">
      <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Documents del client</h3>
      {data?.linked && <button className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline" onClick={() => navigate("client", { id: data.client.id, tab: "documents" })}><Users size={12} /> Obre a Clients 360°</button>}
    </div>
  );

  if (loading && !data) return <section className="space-y-2">{header}<p className="flex items-center gap-2 py-4 text-[12.5px] text-muted"><Loader2 size={14} className="animate-spin" /> Carregant documents…</p></section>;
  if (err) {
    return (
      <section className="space-y-2">{header}
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[12.5px] text-amber-900 dark:text-amber-100">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="flex-1"><p className="font-medium">No s&apos;han pogut carregar els documents del client.</p><p className="text-[11.5px] opacity-80">{err}</p></div>
          <Button size="sm" variant="ghost" onClick={() => void load()}><RotateCcw size={13} /> Torna-ho a provar</Button>
        </div>
      </section>
    );
  }
  if (!data) return null;
  if (!data.linked) {
    return (
      <section className="space-y-2">{header}
        <Empty icon={<Users size={20} />} title="Aquest contracte encara no està vinculat a cap client de Clients 360°" body="Quan el client existeixi a Clients 360° (pel contracte o pel CUPS), aquí en veuràs els documents i en podràs pujar de nous." action={<Button size="sm" onClick={() => navigate("clients")}>Ves a Clients 360°</Button>} />
      </section>
    );
  }

  const docs = Array.isArray(data.documents) ? data.documents : [];
  const allowed = DOC_CATEGORIES.filter((k) => data.permissions.canSeeSensitive || !SENSITIVE_CATEGORIES.includes(k));
  return (
    <section className="space-y-2.5">
      {header}
      <p className="text-[12px] text-muted">{data.client.name}</p>
      {data.permissions.canUpload && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <label className="block"><span className="label">Tipus de document</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as DocCategory | "auto")}>
              <option value="auto">Automàtic (pel nom del fitxer)</option>
              {allowed.map((k) => <option key={k} value={k}>{DOC_CATEGORY_LABEL[k]}</option>)}
            </select>
          </label>
          <DropZone multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" onFiles={upload} onReject={(m) => toast({ title: m, tone: "err" })}>
            <FileUp className="text-brand" size={18} />
            <span className="text-[12.5px] font-medium">Arrossega documents o fes clic per pujar-los</span>
            <span className="text-[11px] text-muted">Es vinculen a aquest client{data.contractId ? " i contracte" : ""}{data.supplyId ? " i CUPS" : ""} · emmagatzematge privat</span>
          </DropZone>
          {queue.length > 0 && (
            <ul className="space-y-1">
              {queue.slice(0, 6).map((u) => (
                <li key={u.key} className="flex items-center gap-2 text-[12px]">
                  {u.status === "fet" ? <CheckCircle2 size={14} className="text-ren" /> : u.status === "error" ? <XCircle size={14} className="text-lost" /> : <Loader2 size={14} className="animate-spin text-muted" />}
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  <span className={u.status === "error" ? "text-lost" : "text-muted tnum"}>{u.status === "error" ? u.error : u.status === "fet" ? "Fet" : `${u.pct} %`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!data.permissions.canSeeSensitive && <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><Lock size={11} /> Els DNI/NIE i els documents bancaris només els veuen Administració, Direcció i el comercial responsable.</p>}
      {docs.length === 0 ? (
        <Empty icon={<FileText size={20} />} title="Aquest client encara no té documents" body="Puja factures, contractes o mandats: quedaran guardats de manera privada i vinculats al client." />
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-xl border border-line p-3 text-[12.5px]">
              <span className="shrink-0 text-muted"><DocIcon mime={d.mime} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{d.title || d.original_name || "Document"}</p>
                <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                  <Badge tone={d.sensitive ? "red" : "zinc"}>{d.sensitive && <Lock size={10} />}{DOC_CATEGORY_LABEL[d.category] ?? "Altres"}</Badge>
                  {d.related && <Badge tone="green">Aquest contracte</Badge>}
                  <span>{safeDate(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ""}{typeof d.size_bytes === "number" ? ` · ${fmtBytes(d.size_bytes)}` : ""}{d.version > 1 ? ` · v${d.version}` : ""}{d.original_name ? ` · .${extOf(d.original_name)}` : ""}</span>
                </p>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Visualitza ${d.title}`} title="Visualitza" onClick={() => open(d.id, false)}><Eye size={13} /></Button>
              <Button size="sm" variant="ghost" aria-label={`Descarrega ${d.title}`} title="Descarrega" onClick={() => open(d.id, true)}><Download size={13} /></Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
