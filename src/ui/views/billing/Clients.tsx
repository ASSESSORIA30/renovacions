"use client";
/** CLIENTS DE FACTURACIÓ: afegir, modificar, arxivar/eliminar, cercar i importar (Excel o CSV) sense duplicar NIF. */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, Archive, ArchiveRestore, BookUser, FileUp, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { validTaxId } from "@/core/billing";
import { useApp } from "@/data/store";
import { useCan, useSession } from "../../session";
import { Badge, Button, Empty, Field, Modal, Notice } from "../../components/ui";
import { bApi, errMsg, eur, fmtD, toast, type BillClient } from "./api";

const blank = (): Partial<BillClient> => ({ legal_name: "", trade_name: "", nif: "", address: "", postal_code: "", city: "", province: "", country: "España", contact_name: "", phone: "", billing_email: "", payment_method: "transferencia", due_days: null, order_ref_label: "", order_ref: "", retailer_name: "", notes: "", status: "actiu", needs_review: false, review_notes: "" });

export function BillingClientsTab() {
  const openId = useApp((s) => s.params.id);
  const canDo = useCan();
  const role = useSession((s) => s.role);
  const canEdit = canDo("facturacio", "edit") || role === "admin";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<BillClient[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<BillClient> | null>(null);
  const [imp, setImp] = useState(false);
  const load = useCallback(async () => { try { setRows((await bApi.get<{ rows: BillClient[] }>("clients", { q, status })).rows); setErr(null); } catch (e) { setErr(errMsg(e)); } }, [q, status]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (openId && rows) { const c = rows.find((r) => r.id === openId); if (c) setEdit(c); } }, [openId, rows]);
  const review = (rows ?? []).filter((r) => r.needs_review && r.status === "actiu").length;
  const setArchived = async (c: BillClient, archived: boolean) => {
    try { await bApi.act("client_save", { id: c.id, data: { ...strip(c), status: archived ? "arxivat" : "actiu" } }); toast(archived ? "Client arxivat" : "Client reactivat", archived ? "Les factures emeses es conserven." : undefined); void load(); }
    catch (e) { toast("No s'ha pogut", errMsg(e), "err"); }
  };
  const remove = async (c: BillClient) => {
    if (!confirm(`Eliminar ${c.legal_name}? Només es pot fer si no té cap factura.`)) return;
    try { await bApi.act("client_delete", { id: c.id }); toast("Client eliminat"); void load(); }
    catch (e) { toast("No es pot eliminar", errMsg(e), "err"); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-muted" /><input className="input h-9 w-72 pl-8 text-[12.5px]" placeholder="Nom, CIF, població, comercialitzadora o correu" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Estat" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Actius i inactius</option><option value="actiu">Actius</option><option value="inactiu">Inactius</option><option value="arxivat">Arxivats</option><option value="tots">Tots</option></select>
        {canEdit && <div className="ml-auto flex gap-2"><Button onClick={() => setImp(true)}><FileUp size={14} /> Importa Excel/CSV</Button><Button variant="primary" onClick={() => setEdit(blank())}><Plus size={14} /> Afegeix client</Button></div>}
      </div>
      {review > 0 && <Notice tone="amber"><AlertTriangle size={13} className="mr-1 inline" />{review} client(s) amb dades fiscals per revisar (marcats amb ⚠). No s&apos;hi poden emetre factures fins que es corregeixin.</Notice>}
      {err && <Notice tone={/migració/.test(err) ? "amber" : "red"}>{err}</Notice>}
      <div className="overflow-auto rounded-2xl border border-line bg-surface">
        {!rows ? <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-muted" size={18} /></div> : !rows.length ? <Empty icon={<BookUser size={24} />} title="Cap client amb aquests filtres" /> : (
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Raó social</th><th>NIF/CIF</th><th className="hidden md:table-cell">Població</th><th className="hidden lg:table-cell">Correu de facturació</th><th className="text-right">Factures</th><th className="hidden text-right sm:table-cell">Facturat</th><th className="hidden text-right sm:table-cell">Pendent</th><th className="hidden md:table-cell">Última</th><th className="px-3 text-right">Accions</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="border-t border-line hover:bg-ink/[0.02]">
                <td className="px-3 py-2"><button className="text-left font-medium hover:underline" onClick={() => setEdit(c)}>{c.legal_name}</button>{c.needs_review && <span title={c.review_notes ?? ""} className="ml-1 text-amber-500">⚠</span>}{c.status !== "actiu" && <Badge tone="zinc" className="ml-1">{c.status}</Badge>}{c.retailer_name && <div className="text-[11px] text-muted">Liquidacions: {c.retailer_name}</div>}</td>
                <td className="font-mono">{c.nif || "—"}{c.nif && c.nif_valid === false && <span className="ml-1 text-lost" title="No supera la validació">✗</span>}</td>
                <td className="hidden md:table-cell">{c.city}</td>
                <td className="hidden max-w-[220px] truncate lg:table-cell">{c.billing_email ?? <span className="text-muted">—</span>}</td>
                <td className="text-right tabular-nums">{c.invoices}</td>
                <td className="hidden text-right tabular-nums sm:table-cell">{eur(c.invoiced)}</td>
                <td className="hidden text-right tabular-nums sm:table-cell">{Number(c.pending) ? eur(c.pending) : "—"}</td>
                <td className="hidden md:table-cell">{fmtD(c.last_invoice)}</td>
                <td className="px-3 text-right">{canEdit && <div className="inline-flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Modifica" onClick={() => setEdit(c)}><Pencil size={13} /></Button>
                  {c.status === "arxivat" ? <Button size="sm" variant="ghost" aria-label="Reactiva" onClick={() => void setArchived(c, false)}><ArchiveRestore size={13} /></Button> : <Button size="sm" variant="ghost" aria-label="Arxiva" onClick={() => void setArchived(c, true)}><Archive size={13} /></Button>}
                  {!c.invoices && <Button size="sm" variant="ghost" aria-label="Elimina" onClick={() => void remove(c)}><Trash2 size={13} /></Button>}
                </div>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {edit && <ClientModal c={edit} readOnly={!canEdit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
      <ImportModal open={imp} onClose={() => setImp(false)} onDone={() => { setImp(false); void load(); }} />
    </div>
  );
}

const strip = (c: Partial<BillClient>) => {
  const { id: _i, invoices: _n, invoiced: _t, pending: _p, last_invoice: _l, nif_valid: _v, ...rest } = c as BillClient & Record<string, unknown>;
  void _i; void _n; void _t; void _p; void _l; void _v;
  const keep = ["legal_name", "trade_name", "nif", "address", "postal_code", "city", "province", "country", "contact_name", "phone", "billing_email", "payment_method", "due_days", "order_ref_label", "order_ref", "retailer_name", "notes", "status", "needs_review", "review_notes"];
  return Object.fromEntries(Object.entries(rest).filter(([k]) => keep.includes(k)).map(([k, v]) => [k, v === "" && k !== "nif" && k !== "legal_name" ? null : v]));
};

function ClientModal({ c, readOnly, onClose, onSaved }: { c: Partial<BillClient>; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<BillClient>>(c);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nifOk = useMemo(() => !f.nif || validTaxId(f.nif), [f.nif]);
  const t = (k: keyof BillClient) => ({ value: (f[k] as string | null | undefined) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }), disabled: readOnly });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await bApi.act<{ warning: string | null }>("client_save", { id: c.id, data: { ...strip(f), due_days: f.due_days === null || (f.due_days as unknown) === "" ? null : Number(f.due_days) } });
      toast(c.id ? "Client desat" : "Client creat", r.warning ?? (c.id && (c.invoices ?? 0) > 0 ? "Les factures ja emeses conserven les dades fiscals anteriors." : undefined), r.warning ? "info" : "ok");
      onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={c.id ? c.legal_name : "Nou client de facturació"} footer={!readOnly && <><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.legal_name} onClick={() => void save()}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="space-y-3">
        {err && <Notice tone="red">{err}</Notice>}
        {f.needs_review && <Notice tone="amber"><b>Per revisar:</b> {f.review_notes} {!readOnly && <button className="underline" onClick={() => setF({ ...f, needs_review: false, review_notes: null })}>Ja està corregit</button>}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Raó social"><input className="input" {...t("legal_name")} /></Field>
          <Field label="Nom comercial"><input className="input" {...t("trade_name")} /></Field>
          <Field label="NIF/CIF" hint={nifOk ? undefined : "No supera la validació del dígit de control"}><input className={`input font-mono ${nifOk ? "" : "border-lost"}`} {...t("nif")} /></Field>
          <Field label="Estat"><select className="input" {...t("status")}><option value="actiu">Actiu</option><option value="inactiu">Inactiu</option><option value="arxivat">Arxivat</option></select></Field>
          <Field label="Adreça fiscal"><input className="input" {...t("address")} /></Field>
          <div className="grid grid-cols-3 gap-2"><Field label="CP"><input className="input" {...t("postal_code")} /></Field><div className="col-span-2"><Field label="Població"><input className="input" {...t("city")} /></Field></div></div>
          <Field label="Província"><input className="input" {...t("province")} /></Field>
          <Field label="País"><input className="input" {...t("country")} /></Field>
          <Field label="Persona de contacte"><input className="input" {...t("contact_name")} /></Field>
          <Field label="Telèfon"><input className="input" {...t("phone")} /></Field>
          <Field label="Correu de facturació"><input className="input" type="email" {...t("billing_email")} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Forma de pagament"><select className="input" {...t("payment_method")}><option value="transferencia">Transferència</option><option value="domiciliacio">Domiciliació</option><option value="confirming">Confirming</option><option value="compensacio">Compensació</option><option value="altres">Altres</option></select></Field><Field label="Venciment (dies)"><input className="input" inputMode="numeric" value={f.due_days ?? ""} disabled={readOnly} onChange={(e) => setF({ ...f, due_days: e.target.value === "" ? null : Number(e.target.value) })} /></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Referència exigida" hint="p. ex. ALBARÀ o PEDIDO"><input className="input" {...t("order_ref_label")} /></Field><Field label="Número de referència"><input className="input" {...t("order_ref")} /></Field></div>
          <Field label="Nom a les liquidacions" hint="Com apareix a la conciliació (per proposar-lo automàticament)"><input className="input" {...t("retailer_name")} /></Field>
        </div>
        <Field label="Observacions"><textarea className="input" rows={2} {...t("notes")} /></Field>
      </div>
    </Modal>
  );
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ created: number; skipped: { name: string; reason: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setRows(null); setRes(null); setErr(null); setName(""); } }, [open]);
  const read = async (file: File) => {
    setErr(null); setName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.SheetNames.find((s) => /client/i.test(s)) ?? wb.SheetNames[0];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet], { defval: null, raw: false });
      if (!data.length) throw new Error("El fitxer no té files");
      setRows(data.slice(0, 2000));
    } catch (e) { setErr(`No s'ha pogut llegir: ${errMsg(e)}`); }
  };
  const run = async () => {
    if (!rows) return;
    setBusy(true);
    try { const r = await bApi.act<{ created: number; skipped: { name: string; reason: string }[] }>("clients_import", { data: rows }); setRes(r); toast(`${r.created} clients importats`, r.skipped.length ? `${r.skipped.length} omesos` : undefined); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={res ? onDone : onClose} width="max-w-2xl" title="Importar clients de facturació" footer={res ? <Button variant="primary" onClick={onDone}>Fet</Button> : <><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!rows || busy} onClick={() => void run()}>{busy && <Loader2 size={14} className="animate-spin" />} Importa {rows ? `${rows.length} files` : ""}</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Excel o CSV amb columnes com <b>CLIENT</b> (o Raó social), <b>CIF</b>, <b>ADREÇA</b>, <b>CP</b>, <b>POBLACIÓ</b>, <b>PROVINCIA</b> i, opcionalment, <b>EMAIL</b>. Els clients amb un NIF que ja existeix <b>no es dupliquen ni es modifiquen</b>. Els que tinguin dades dubtoses queden marcats per revisar.</p>
        <input type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
        {name && rows && <p>{name}: {rows.length} files llegides.</p>}
        {err && <Notice tone="red">{err}</Notice>}
        {res && <div><Notice tone="green">{res.created} clients nous creats.</Notice>{res.skipped.length > 0 && <ul className="mt-2 max-h-48 overflow-auto text-[12px] text-muted">{res.skipped.map((s, i) => <li key={i}>{s.name}: {s.reason}</li>)}</ul>}</div>}
      </div>
    </Modal>
  );
}
