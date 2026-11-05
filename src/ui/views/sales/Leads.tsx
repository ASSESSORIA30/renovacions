"use client";
/** LEADS: captació de potencials clients (encara no són clients), assignació, primer contacte i conversió. */
import { useCallback, useEffect, useState } from "react";
import { Ban, Loader2, Mail, MessageCircle, Phone, Plus, RotateCcw, Search, Target, Trophy, UserCheck, UserPlus } from "lucide-react";
import { ORIGINS, formatPhone, phoneDigits } from "@/core/crm";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, SERVICES, SERVICE_LABEL, leadInput, type Service } from "@/core/sales";
import { fmtDateTime } from "@/core/dates";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { supabaseConfigured } from "@/data/browserSupabase";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { salesApi, type LeadRow } from "./api";
import { Avatar, LogActivity, OppForm, ServiceChip, StagePill, TaskForm, useFacets } from "./shared";
import { ConvertLead } from "./Opportunity";
import { ExportButton } from "../../components/ExportButton";

export function LeadsView() {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const openId = useApp((s) => s.params.id);
  const facets = useFacets();
  const [f, setF] = useState({ q: "", status: "", owner: "", service: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: LeadRow[]; total: number; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    try { setData(await salesApi.leads({ ...f, page })); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [f, page]);
  useEffect(() => { if (!supabaseConfigured) return; const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, f.q]);
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || isStaff(u.role as never));
  const openLead = (id: string | null) => useApp.getState().navigate("leads", id ? { id } : {}, { replace: true });

  if (!supabaseConfigured) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<Target size={26} />} title="El CRM comercial necessita la base de dades" /></div>;
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-semibold tracking-tight">Leads</h2><p className="text-[13px] text-muted">Potencials clients en captació. Quan es qualifiquen, passen a oportunitat; quan es tanquen, a client.</p></div>
        <div className="flex gap-2"><ExportButton size="md" set="leads" params={{ q: f.q, status: f.status, owner: f.owner, x_open: f.status ? "" : "1" }} /><Button variant="primary" onClick={() => setCreating(true)}><UserPlus size={15} /> Nou lead</Button></div>
      </div>
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
        <div className="relative min-w-[220px] flex-1"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-8" placeholder="Cerca per nom, empresa, telèfon, correu…" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(1); }} aria-label="Cerca leads" /></div>
        <select className="input h-10 w-auto" aria-label="Estat" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}><option value="">Oberts</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}</select>
        <select className="input h-10 w-auto" aria-label="Servei" value={f.service} onChange={(e) => { setF({ ...f, service: e.target.value }); setPage(1); }}><option value="">Tots els serveis</option>{SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select>
        {staff && <select className="input h-10 w-auto" aria-label="Comercial" value={f.owner} onChange={(e) => { setF({ ...f, owner: e.target.value }); setPage(1); }}><option value="">Tots els comercials</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value="cap">Sense assignar</option></select>}
      </section>
      {error && <Notice tone="red">{error}</Notice>}
      {!data && !error ? <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-elevated" />)}</div>
        : data && data.rows.length === 0 ? <Empty icon={<Target size={24} />} title={f.q || f.status || f.service || f.owner ? "Cap lead amb aquests criteris" : "Encara no hi ha leads"} body="Dona d'alta els contactes que vols captar i fes-ne el seguiment fins a convertir-los." action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={13} /> Nou lead</Button>} />
        : data && (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2 text-left">Lead</th><th className="px-3 py-2 text-left">Contacte</th><th className="px-3 py-2 text-left">Serveis d&apos;interès</th><th className="px-3 py-2 text-left">Responsable</th><th className="px-3 py-2 text-left">Alta</th><th className="px-3 py-2 text-left">Estat</th></tr></thead>
              <tbody>
                {data.rows.map((l) => {
                  const hours = (Date.now() - new Date(l.created_at).getTime()) / 3_600_000;
                  return (
                    <tr key={l.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.025]" onClick={() => openLead(l.id)}>
                      <td className="px-3 py-2.5"><p className="font-medium">{l.company || l.name}</p><p className="text-[11px] text-muted">{l.company ? l.name : l.kind}{l.city ? ` · ${l.city}` : ""}{l.origin ? ` · ${l.origin}` : ""}</p></td>
                      <td className="px-3 py-2.5 text-muted"><p>{formatPhone(l.phone) || "—"}</p><p className="max-w-[200px] truncate text-[11px]">{l.email}</p></td>
                      <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{l.services.map((s) => <ServiceChip key={s} s={s as Service} short />)}{!l.services.length && <span className="text-muted">—</span>}</div></td>
                      <td className="px-3 py-2.5">{l.owner_name ? <span className="flex items-center gap-1.5"><Avatar name={l.owner_name} size={20} />{l.owner_name}</span> : <span className="text-pend">Sense assignar</span>}</td>
                      <td className="px-3 py-2.5 text-muted">{fmtDateTime(l.created_at)}{l.status === "nou" && !l.first_contact_at && hours > 24 && <p className="text-[11px] font-medium text-lost">Sense primer contacte</p>}</td>
                      <td className="px-3 py-2.5"><Badge tone={LEAD_STATUS_TONE[l.status]}>{LEAD_STATUS_LABEL[l.status]}</Badge>{l.opportunities > 0 && <span className="ml-1 text-[11px] text-muted">· {l.opportunities} opor.</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {data && data.total > data.size && (
        <div className="flex items-center justify-end gap-2 text-[12.5px] text-muted">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><span>{page} / {Math.ceil(data.total / data.size)}</span><Button size="sm" disabled={page * data.size >= data.total} onClick={() => setPage(page + 1)}>Següent</Button>
        </div>
      )}
      {creating && <LeadForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); void load(); openLead(id); }} />}
      {openId && <LeadDrawer id={openId} onClose={() => openLead(null)} onChanged={load} />}
    </div>
  );
}

function LeadForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const facets = useFacets();
  const [f, setF] = useState({ kind: "empresa" as "particular" | "autonom" | "empresa", name: "", company: "", contact_name: "", tax_id: "", phone: "", email: "", city: "", postal_code: "", origin: "", services: [] as Service[], notes: "", owner_id: me.role === "comercial" ? me.id : "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const v = leadInput.safeParse({ ...f, owner_id: f.owner_id || null });
    if (!v.success) { setErr([...new Set(v.error.issues.map((i) => i.message))].join(" · ")); return; }
    setBusy(true); setErr(null);
    try { const r = await salesApi.lead_("create", { data: { ...f, owner_id: f.owner_id || null } }); useApp.getState().toast({ title: "Lead creat", tone: "ok" }); onSaved(r.id!); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || isStaff(u.role as never));
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Nou lead" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Crea el lead</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <div className="flex rounded-xl border border-line p-0.5 sm:col-span-2" role="radiogroup" aria-label="Tipus">{(["particular", "autonom", "empresa"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k })} className={cn("flex-1 rounded-lg px-3 py-1.5 text-[12.5px]", f.kind === k ? "bg-ink/[0.07] font-medium" : "text-muted")}>{k === "particular" ? "Particular" : k === "autonom" ? "Autònom" : "Empresa"}</button>)}</div>
        <label className="block"><span className="label">{f.kind === "empresa" ? "Persona de contacte *" : "Nom i cognoms *"}</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        {f.kind !== "particular" ? <label className="block"><span className="label">Empresa</span><input className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label> : <div />}
        <label className="block"><span className="label">Telèfon</span><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="block"><span className="label">Correu</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="block"><span className="label">NIF/CIF (opcional)</span><input className="input font-mono uppercase" value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value })} /></label>
        <div className="grid grid-cols-[100px_1fr] gap-2"><label className="block"><span className="label">CP</span><input className="input" value={f.postal_code} onChange={(e) => setF({ ...f, postal_code: e.target.value })} /></label><label className="block"><span className="label">Municipi</span><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label></div>
        <div className="sm:col-span-2"><span className="label">Serveis d&apos;interès</span><div className="flex flex-wrap gap-1.5">{SERVICES.map((s) => <button key={s} type="button" aria-pressed={f.services.includes(s)} onClick={() => setF({ ...f, services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s] })} className={cn("rounded-full border px-3 py-1 text-[12.5px]", f.services.includes(s) ? "border-brand bg-brand/[0.06] font-medium text-brand" : "border-line text-muted")}>{SERVICE_LABEL[s]}</button>)}</div></div>
        <label className="block"><span className="label">Origen</span><select className="input" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })}><option value="">—</option>{ORIGINS.map((o) => <option key={o}>{o}</option>)}</select></label>
        <label className="block"><span className="label">Comercial assignat</span>{staff ? <select className="input" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}><option value="">Sense assignar</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : <input className="input" disabled value={me.role === "comercial" ? me.name : "L'assignarà Administració"} />}</label>
        <label className="block sm:col-span-2"><span className="label">Observacions</span><textarea className="input min-h-[60px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {err && <p className="rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
    </Modal>
  );
}

function LeadDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof salesApi.lead>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [opp, setOpp] = useState(false);
  const [convert, setConvert] = useState(false);
  const [task, setTask] = useState(false);
  const [assign, setAssign] = useState("");
  const facets = useFacets();
  const load = useCallback(async () => { try { setD(await salesApi.lead(id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { await load(); onChanged(); };
  const l = d?.lead;
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    try { await salesApi.lead_(action, { id, ...extra }); await refresh(); } catch (e) { useApp.getState().toast({ title: "No s'ha pogut fer", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-4xl" title={l ? (l.company || l.name) : "Lead"}>
      {err ? <Notice tone="red">{err}</Notice> : !d || !l ? <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Carregant…</p> : (
        <div className="grid gap-4 text-[13px] lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={LEAD_STATUS_TONE[l.status]}>{LEAD_STATUS_LABEL[l.status]}</Badge>
              {l.services.map((s) => <ServiceChip key={s} s={s} />)}
              {l.converted_client_id && <Button size="sm" onClick={() => useApp.getState().navigate("client", { id: l.converted_client_id! })}><UserCheck size={13} /> Obre la fitxa del client</Button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {l.phone && <a href={`tel:${l.phone}`} className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 hover:bg-elevated"><Phone size={14} /> {formatPhone(l.phone)}</a>}
              {l.email && <a href={`mailto:${l.email}`} className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 hover:bg-elevated"><Mail size={14} /> Correu</a>}
              {l.phone && <a href={`https://wa.me/${phoneDigits(l.phone)}`} target="_blank" rel="noopener noreferrer" className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 hover:bg-elevated"><MessageCircle size={14} /> WhatsApp</a>}
            </div>
            <section className="rounded-2xl border border-line p-3">
              <h3 className="mb-2 font-semibold">Registra un contacte</h3>
              <LogActivity target={{ leadId: l.id }} onDone={refresh} compact />
            </section>
            <section>
              <h3 className="mb-2 font-semibold">Oportunitats ({d.opportunities.length})</h3>
              {d.opportunities.length === 0 ? <p className="text-muted">Encara cap. Quan el lead estigui qualificat, crea&apos;n una per a cada servei que li interessi.</p> : (
                <ul className="space-y-1.5">{d.opportunities.map((o) => <li key={o.id}><button className="flex w-full items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-left hover:border-ink/25" onClick={() => useApp.getState().navigate("oportunitat", { id: o.id })}><span className="truncate font-medium">{o.title}</span><StagePill s={o.stage} /></button></li>)}</ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 font-semibold">Historial</h3>
              {d.activities.length === 0 ? <p className="text-muted">Sense activitat.</p> : <ul className="space-y-1.5">{d.activities.map((a) => <li key={a.id} className="rounded-lg bg-elevated/60 px-3 py-1.5"><p className="font-medium">{a.title}</p><p className="text-[11px] text-muted">{fmtDateTime(a.at)}{a.user_name ? ` · ${a.user_name}` : ""}</p></li>)}</ul>}
            </section>
          </div>
          <aside className="space-y-3">
            <div className="space-y-1 rounded-2xl bg-elevated/60 p-3 text-[12.5px]">
              <p><span className="text-muted">Contacte:</span> {l.name}</p>
              {l.tax_id && <p><span className="text-muted">NIF/CIF:</span> <span className="font-mono">{l.tax_id}</span></p>}
              {l.city && <p><span className="text-muted">Població:</span> {l.city}{l.province ? ` (${l.province})` : ""}</p>}
              {l.origin && <p><span className="text-muted">Origen:</span> {l.origin}</p>}
              <p><span className="text-muted">Responsable:</span> {l.owner_name ?? "Sense assignar"}</p>
              <p><span className="text-muted">Alta:</span> {fmtDateTime(l.created_at)}</p>
              {l.first_contact_at && <p><span className="text-muted">Primer contacte:</span> {fmtDateTime(l.first_contact_at)}</p>}
              {l.notes && <p className="whitespace-pre-wrap pt-1">{l.notes}</p>}
              {(l as { capture_channel?: string | null }).capture_channel && <button className="mt-1 text-[12px] font-medium text-brand hover:underline" onClick={() => useApp.getState().navigate("captacio-lead", { id: l.id })}>Factura, lectura i comparativa preliminar →</button>}
            </div>
            {l.status !== "convertit" && l.status !== "descartat" && (
              <div className="grid gap-2">
                <Button variant="primary" onClick={() => setOpp(true)}><Trophy size={14} /> Crea una oportunitat</Button>
                <Button onClick={() => setConvert(true)}><UserCheck size={14} /> Converteix en client</Button>
                <Button onClick={() => setTask(true)}><Plus size={14} /> Tasca de seguiment</Button>
                <Button variant="ghost" className="text-muted" onClick={() => { const r = prompt("Motiu per descartar el lead"); if (r !== null) void act("discard", { reason: r || null }); }}><Ban size={14} /> Descarta</Button>
              </div>
            )}
            {l.status === "descartat" && <Button onClick={() => act("reopen")}><RotateCcw size={14} /> Reobre el lead</Button>}
            {d.isStaff && (
              <div className="rounded-2xl border border-line p-3">
                <span className="label">Assigna a un comercial</span>
                <div className="flex gap-2"><select className="input h-9" value={assign} onChange={(e) => setAssign(e.target.value)} aria-label="Comercial"><option value="">Tria…</option>{(facets?.users ?? []).filter((u) => u.role === "comercial").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><Button size="sm" disabled={!assign} onClick={() => act("assign", { ownerId: assign })}>Assigna</Button></div>
              </div>
            )}
            {d.tasks.length > 0 && <div className="rounded-2xl border border-line p-3"><h4 className="mb-1 font-semibold">Tasques</h4>{d.tasks.map((t) => <p key={t.id} className={cn("text-[12px]", t.status !== "pendent" && "text-muted line-through")}>{t.title}{t.due_at ? ` · ${fmtDateTime(t.due_at)}` : ""}</p>)}</div>}
          </aside>
        </div>
      )}
      {opp && l && <OppForm initialParty={{ kind: l.converted_client_id ? "client" : "lead", id: l.converted_client_id ?? l.id, name: l.company || l.name }} onClose={() => setOpp(false)} onSaved={(oid) => { setOpp(false); useApp.getState().navigate("oportunitat", { id: oid }); }} />}
      {convert && l && <ConvertLead leadId={l.id} name={l.company || l.name} onClose={() => setConvert(false)} onDone={(cid) => { setConvert(false); void refresh(); useApp.getState().navigate("client", { id: cid }); }} />}
      {task && l && <TaskForm link={{ lead_id: l.id }} defaultTitle={`Trucar a ${l.company || l.name}`} defaultKind="trucada" onClose={() => setTask(false)} onSaved={() => { setTask(false); void refresh(); }} />}
    </Modal>
  );
}
