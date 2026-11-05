"use client";
/** Configuració → Contractació: requisits documentals, plantilles autoritzades i estat de la signatura electrònica. */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FilePlus2, Loader2, PenLine, Plus, ShieldCheck, XCircle } from "lucide-react";
import { DATA_FIELDS, DATA_FIELD_LABEL, INTERNAL_TEMPLATE_EXAMPLE, PROCEDURE_LABEL, PROCEDURE_TYPES, TEMPLATE_VARS, templateVariables } from "@/core/contracting";
import { CLIENT_KINDS, CLIENT_KIND_LABEL, DOC_CATEGORIES, DOC_CATEGORY_LABEL } from "@/core/crm";
import { SERVICES, SERVICE_LABEL, SERVICE_SHORT } from "@/core/sales";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, cn } from "../../components/ui";
import { cApi, type ReqConfig, type SignatureInfo, type Template } from "./api";

const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ContractingSettings() {
  const [reqs, setReqs] = useState<{ rows: ReqConfig[]; canManage: boolean } | null>(null);
  const [tpls, setTpls] = useState<{ templates: Template[]; canManage: boolean; isAdmin: boolean } | null>(null);
  const [sig, setSig] = useState<SignatureInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editReq, setEditReq] = useState<ReqConfig | "new" | null>(null);
  const [editTpl, setEditTpl] = useState<Template | "new" | "example" | null>(null);
  const load = useCallback(async () => {
    try { const [a, b, c] = await Promise.all([cApi.reqConfig(), cApi.templates(), cApi.signature()]); setReqs(a); setTpls(b); setSig(c); setErr(null); }
    catch (e) { setErr(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const status = async (t: Template, s: "autoritzada" | "retirada" | "esborrany") => { try { await cApi.act("template_status", { id: t.id, status: s }); toast(s === "autoritzada" ? "Plantilla autoritzada" : s === "retirada" ? "Plantilla retirada" : "Plantilla en esborrany"); await load(); } catch (e) { toast("No s'ha pogut canviar", errMsg(e), "err"); } };
  if (err) return <Notice tone="red">{err}</Notice>;
  if (!reqs || !tpls || !sig) return <div className="h-64 animate-pulse rounded-2xl bg-elevated" />;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-[14px] font-semibold">Signatura electrònica</h3>
        {sig.configured ? <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ren"><CheckCircle2 size={14} /> {sig.label} configurat{sig.sandbox ? " en mode de proves (sandbox)" : " en producció"}.</p> : (
          <div className="mt-2 space-y-2 text-[13px]">
            <p className="flex items-center gap-1.5 text-pend"><XCircle size={14} /> Integració pendent: no hi ha credencials d&apos;un proveïdor autoritzat.</p>
            <p className="text-muted">Per activar-la, configura a Vercel (només al servidor): <code className="font-mono">SIGNATURE_PROVIDER=signaturit</code>, <code className="font-mono">SIGNATURIT_API_TOKEN</code>, <code className="font-mono">SIGNATURIT_ENV=sandbox</code> (o <code className="font-mono">production</code>), <code className="font-mono">SIGNATURE_WEBHOOK_SECRET</code> i <code className="font-mono">APP_URL</code>. Falta ara: {sig.missing.join(", ")}.</p>
            <p className="text-muted">Mentrestant es poden preparar sol·licituds i Administració pot registrar signatures manuscrites amb el document signat. Cap signatura es dona per bona des del CRM.</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div><h3 className="text-[14px] font-semibold">Requisits documentals</h3><p className="text-[12.5px] text-muted">Es creen automàticament a cada expedient segons el servei, la comercialitzadora, el tipus de client i el tràmit.</p></div>
          {reqs.canManage && <Button size="sm" variant="primary" onClick={() => setEditReq("new")}><Plus size={13} /> Requisit</Button>}
        </div>
        {reqs.rows.some((r) => r.is_example) && <div className="mt-3"><Notice tone="amber">Els requisits marcats com a <b>exemple</b> són orientatius. Revisa&apos;ls i adapta&apos;ls als requisits reals de cada proveïdor.</Notice></div>}
        <table className="mt-3 w-full text-[12.5px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="py-1.5">Requisit</th><th>Tipus</th><th>S&apos;aplica a</th><th>Oblig.</th><th /></tr></thead>
          <tbody>
            {reqs.rows.map((r) => (
              <tr key={r.id} className={cn("border-t border-line", !r.active && "opacity-50")}>
                <td className="py-2 pr-2"><span className="font-medium">{r.name}</span>{r.is_example && <Badge tone="amber" className="ml-1.5">exemple</Badge>}{r.description && <span className="block text-[11.5px] text-muted">{r.description}</span>}</td>
                <td className="pr-2">{r.kind === "document" ? DOC_CATEGORY_LABEL[r.doc_category as keyof typeof DOC_CATEGORY_LABEL] : r.kind === "dada" ? `Dada: ${DATA_FIELD_LABEL[r.data_field as keyof typeof DATA_FIELD_LABEL]}` : "Comprovació manual"}</td>
                <td className="pr-2 text-[11.5px] text-muted">{[r.services.length ? r.services.map((s) => SERVICE_SHORT[s as keyof typeof SERVICE_SHORT]).join(", ") : "Tots els serveis", r.customer_types.length ? r.customer_types.map((c) => CLIENT_KIND_LABEL[c as keyof typeof CLIENT_KIND_LABEL]).join(", ") : null, r.retailers.length ? r.retailers.join(", ") : null, r.procedure_types.length ? r.procedure_types.map((p) => PROCEDURE_LABEL[p as keyof typeof PROCEDURE_LABEL]).join(", ") : null].filter(Boolean).join(" · ")}</td>
                <td>{r.mandatory ? "Sí" : "No"}</td>
                <td className="text-right">{reqs.canManage && <button className="text-brand" onClick={() => setEditReq(r)} aria-label={`Edita ${r.name}`}><PenLine size={13} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-[14px] font-semibold">Plantilles de documents</h3><p className="text-[12.5px] text-muted">Només es poden generar documents amb plantilles <b>autoritzades per Direcció</b>. No s&apos;inclou cap model oficial de cap comercialitzadora: afegeix només els que t&apos;hagin facilitat.</p></div>
          {tpls.canManage && <div className="flex gap-2"><Button size="sm" onClick={() => setEditTpl("example")}><FilePlus2 size={13} /> Resum intern d&apos;exemple</Button><Button size="sm" variant="primary" onClick={() => setEditTpl("new")}><Plus size={13} /> Plantilla</Button></div>}
        </div>
        {!tpls.templates.length ? <p className="mt-3 text-[12.5px] text-muted">Encara no hi ha cap plantilla.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {tpls.templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]">
                <span className="min-w-0 flex-1"><b>{t.name}</b> · v{t.version} <span className="text-muted">· {t.origin === "intern" ? "document intern d'Assessoria 3.0" : `model de ${t.retailer ?? "proveïdor"}`}{t.services.length ? ` · ${t.services.map((s) => SERVICE_SHORT[s as keyof typeof SERVICE_SHORT]).join(", ")}` : ""}</span>{t.source_note && <span className="block text-[11.5px] text-muted">Origen: {t.source_note}</span>}</span>
                <Badge tone={t.status === "autoritzada" ? "green" : t.status === "retirada" ? "zinc" : "amber"}>{t.status === "autoritzada" ? "Autoritzada" : t.status === "retirada" ? "Retirada" : "Esborrany"}</Badge>
                {tpls.canManage && <Button size="sm" variant="ghost" onClick={() => setEditTpl(t)}><PenLine size={12} /> Edita</Button>}
                {tpls.isAdmin && t.status !== "autoritzada" && <Button size="sm" onClick={() => void status(t, "autoritzada")}><ShieldCheck size={12} /> Autoritza</Button>}
                {tpls.canManage && t.status === "autoritzada" && <Button size="sm" variant="ghost" onClick={() => void status(t, "retirada")}>Retira</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {editReq && <ReqDialog r={editReq === "new" ? null : editReq} onClose={() => setEditReq(null)} onDone={() => { setEditReq(null); void load(); }} />}
      {editTpl && <TemplateDialog t={editTpl === "new" || editTpl === "example" ? null : editTpl} example={editTpl === "example"} onClose={() => setEditTpl(null)} onDone={() => { setEditTpl(null); void load(); }} />}
    </div>
  );
}

function Multi<T extends string>({ all, value, label, onChange }: { all: readonly T[]; value: string[]; label: (v: T) => string; onChange: (v: string[]) => void }) {
  return <div className="flex flex-wrap gap-1">{all.map((v) => <button key={v} type="button" aria-pressed={value.includes(v)} onClick={() => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])} className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", value.includes(v) ? "border-brand bg-brand/[0.06] text-brand" : "border-line text-muted")}>{label(v)}</button>)}</div>;
}

function ReqDialog({ r, onClose, onDone }: { r: ReqConfig | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: r?.name ?? "", description: r?.description ?? "", kind: r?.kind ?? "document", doc_category: r?.doc_category ?? "altres", data_field: r?.data_field ?? DATA_FIELDS[0], services: r?.services ?? [], retailers: (r?.retailers ?? []).join(", "), customer_types: r?.customer_types ?? [], procedure_types: r?.procedure_types ?? [], mandatory: r?.mandatory ?? true, active: r?.active ?? true, sort: r?.sort ?? 100 });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await cApi.act("req_config_save", { id: r?.id, data: { ...f, retailers: f.retailers.split(",").map((x) => x.trim()).filter(Boolean), description: f.description || null } }); toast("Requisit desat", "S'aplicarà als expedients nous."); onDone(); }
    catch (e) { toast("No s'ha pogut desar", errMsg(e), "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={r ? `Requisit · ${r.name}` : "Nou requisit documental"} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.name.trim()} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Nom *</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Descripció</span><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="block"><span className="label">Tipus</span><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}><option value="document">Document adjunt</option><option value="dada">Dada de la fitxa</option><option value="manual">Comprovació manual</option></select></label>
        {f.kind === "document" && <label className="block"><span className="label">Categoria del document</span><select className="input" value={f.doc_category} onChange={(e) => setF({ ...f, doc_category: e.target.value })}>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}</select></label>}
        {f.kind === "dada" && <label className="block"><span className="label">Dada</span><select className="input" value={f.data_field} onChange={(e) => setF({ ...f, data_field: e.target.value })}>{DATA_FIELDS.map((c) => <option key={c} value={c}>{DATA_FIELD_LABEL[c]}</option>)}</select></label>}
        <div className="sm:col-span-2"><span className="label">Serveis (cap = tots)</span><Multi all={SERVICES} value={f.services} label={(s) => SERVICE_LABEL[s]} onChange={(v) => setF({ ...f, services: v })} /></div>
        <div className="sm:col-span-2"><span className="label">Tipus de client (cap = tots)</span><Multi all={CLIENT_KINDS} value={f.customer_types} label={(s) => CLIENT_KIND_LABEL[s]} onChange={(v) => setF({ ...f, customer_types: v })} /></div>
        <div className="sm:col-span-2"><span className="label">Tràmits (cap = tots)</span><Multi all={PROCEDURE_TYPES} value={f.procedure_types} label={(s) => PROCEDURE_LABEL[s]} onChange={(v) => setF({ ...f, procedure_types: v })} /></div>
        <label className="block sm:col-span-2"><span className="label">Comercialitzadores (separades per comes; buit = totes)</span><input className="input" value={f.retailers} onChange={(e) => setF({ ...f, retailers: e.target.value })} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.mandatory} onChange={(e) => setF({ ...f, mandatory: e.target.checked })} /> Obligatori</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Actiu</label>
      </div>
    </Modal>
  );
}

function TemplateDialog({ t, example, onClose, onDone }: { t: Template | null; example?: boolean; onClose: () => void; onDone: () => void }) {
  const [full, setFull] = useState<Template | null>(t);
  useEffect(() => { if (t && t.body === undefined) cApi.templates().then((r) => setFull(r.templates.find((x) => x.id === t.id) ?? t)).catch(() => undefined); }, [t]);
  const src = full ?? t;
  const [f, setF] = useState({ name: example ? "Resum de condicions acceptades" : "", description: example ? "Document intern d'Assessoria 3.0 per al client. No substitueix el contracte de la comercialitzadora." : "", origin: "intern" as "intern" | "comercialitzadora", retailer: "", services: [] as string[], body: example ? INTERNAL_TEMPLATE_EXAMPLE : "", source_note: "" });
  useEffect(() => { if (src && src.body !== undefined) setF({ name: src.name, description: src.description ?? "", origin: src.origin, retailer: src.retailer ?? "", services: src.services, body: src.body ?? "", source_note: src.source_note ?? "" }); }, [src]);
  const [busy, setBusy] = useState(false);
  const unknown = templateVariables(f.body).unknown;
  const save = async () => {
    setBusy(true);
    try { await cApi.act("template_save", { id: t?.id, data: { ...f, retailer: f.retailer || null, description: f.description || null, source_note: f.source_note || null } }); toast("Plantilla desada", "Cal que Direcció l'autoritzi abans de poder-la fer servir."); onDone(); }
    catch (e) { toast("No s'ha pogut desar", errMsg(e), "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-4xl" title={t ? `Plantilla · ${t.name}` : "Nova plantilla"} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.name.trim() || !f.body.trim() || unknown.length > 0 || (f.origin === "comercialitzadora" && !f.source_note.trim())} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="grid gap-3 text-[13px] lg:grid-cols-[1fr_240px]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Nom *</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="block"><span className="label">Origen</span><select className="input" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value as typeof f.origin })}><option value="intern">Document intern d&apos;Assessoria 3.0</option><option value="comercialitzadora">Model facilitat per la comercialitzadora</option></select></label>
            {f.origin === "comercialitzadora" && <>
              <label className="block"><span className="label">Comercialitzadora</span><input className="input" value={f.retailer} onChange={(e) => setF({ ...f, retailer: e.target.value })} /></label>
              <label className="block"><span className="label">Qui l&apos;ha facilitat i quan *</span><input className="input" value={f.source_note} onChange={(e) => setF({ ...f, source_note: e.target.value })} placeholder="Ex.: enviat pel gestor de canal el 15/10/2026" /></label>
            </>}
            <label className="block sm:col-span-2"><span className="label">Descripció</span><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <div className="sm:col-span-2"><span className="label">Serveis (cap = tots)</span><Multi all={SERVICES} value={f.services} label={(s) => SERVICE_SHORT[s]} onChange={(v) => setF({ ...f, services: v })} /></div>
          </div>
          <label className="block"><span className="label">Text de la plantilla *</span><textarea className="input min-h-[320px] font-mono text-[12px]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} spellCheck={false} /></label>
          {unknown.length > 0 && <Notice tone="red">Variables desconegudes: {unknown.map((u) => `{{${u}}}`).join(", ")}</Notice>}
          {t && t.status === "autoritzada" && <Notice tone="blue">Si canvies el text, es crearà una versió nova que caldrà tornar a autoritzar. Els documents ja generats conserven la versió amb què es van fer.</Notice>}
        </div>
        <aside className="rounded-xl bg-ink/[0.03] p-3 text-[11.5px]">
          <p className="mb-1 font-semibold">Format</p>
          <p className="text-muted"># Títol · ## Secció · - punt · --- separador. <code>{"{{var}}"}</code> obligatòria, <code>{"{{?var}}"}</code> opcional.</p>
          <p className="mb-1 mt-3 font-semibold">Variables</p>
          <ul className="space-y-0.5">{TEMPLATE_VARS.map((v) => <li key={v.key}><button type="button" className="text-left font-mono text-brand hover:underline" onClick={() => setF({ ...f, body: `${f.body}{{${v.key}}}` })}>{`{{${v.key}}}`}</button> <span className="text-muted">{v.label}</span></li>)}</ul>
        </aside>
      </div>
    </Modal>
  );
}
