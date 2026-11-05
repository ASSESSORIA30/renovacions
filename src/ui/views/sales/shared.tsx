"use client";
/** Components compartits del CRM comercial: etiquetes, formulari d'oportunitat, registre d'activitat i tasques. */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { PRIORITIES, PRIORITY_LABEL, ACTIVITY_LABEL, type ActivityType } from "@/core/crm";
import { CALL_OUTCOMES, CALL_OUTCOME_LABEL, ENERGY_SERVICES, SERVICES, SERVICE_COLOR, SERVICE_LABEL, SERVICE_SHORT, STAGE_COLOR, STAGE_LABEL, TASK_KINDS, TASK_KIND_LABEL, type Service, type Stage } from "@/core/sales";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { Button, Modal, cn } from "../../components/ui";
import { crmApi, type Facets } from "../crm/api";
import { salesApi, type OppRow } from "./api";

export const ServiceChip = ({ s, short }: { s: Service; short?: boolean }) => (
  <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `${SERVICE_COLOR[s]}1a`, color: SERVICE_COLOR[s] }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: SERVICE_COLOR[s] }} />{short ? SERVICE_SHORT[s] : SERVICE_LABEL[s]}
  </span>
);
export const StagePill = ({ s }: { s: Stage }) => (
  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${STAGE_COLOR[s]}1a`, color: STAGE_COLOR[s] }}>{STAGE_LABEL[s]}</span>
);
export const Avatar = ({ name, size = 22 }: { name: string | null | undefined; size?: number }) => (
  <span title={name ?? "Sense assignar"} className="inline-grid shrink-0 place-items-center rounded-full bg-ink/[0.08] font-semibold text-ink/70" style={{ width: size, height: size, fontSize: size * 0.42 }}>
    {(name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"}
  </span>
);
export const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export function useFacets() {
  const [f, setF] = useState<Facets | null>(null);
  useEffect(() => { crmApi.facets().then(setF).catch(() => undefined); }, []);
  return f;
}

/* ------------------------------------------------------------------ formulari d'oportunitat */

type Party = { kind: "client" | "lead"; id: string; name: string };

export function OppForm({ opp, initialParty, onClose, onSaved }: { opp?: OppRow | null; initialParty?: Party | null; onClose: () => void; onSaved: (id: string) => void }) {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const facets = useFacets();
  const [party, setParty] = useState<Party | null>(opp ? { kind: opp.client_id ? "client" : "lead", id: (opp.client_id ?? opp.lead_id)!, name: opp.party_name ?? "" } : initialParty ?? null);
  const [mode, setMode] = useState<"existent" | "nou">("existent");
  const [newLead, setNewLead] = useState({ name: "", phone: "", email: "" });
  const [f, setF] = useState({
    title: opp?.title ?? "", service: (opp?.service ?? "llum_empresa") as Service, annual_kwh: opp?.annual_kwh?.toString() ?? "", commission_eur: opp?.commission_eur?.toString() ?? "",
    probability: opp?.probability?.toString() ?? "", priority: opp?.priority ?? "mitjana", next_action: opp?.next_action ?? "", next_action_at: opp?.next_action_at ? localInput(new Date(opp.next_action_at)) : "",
    expected_close: opp?.expected_close ?? "", owner_id: opp?.owner_id ?? (me.role === "comercial" ? me.id : ""), notes: opp?.notes ?? "", supply_id: opp?.supply_id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const energy = ENERGY_SERVICES.includes(f.service);
  useEffect(() => { if (!opp && party && !f.title) set({ title: `${SERVICE_SHORT[f.service]} · ${party.name}` }); }, [party, f.service]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      let p = party;
      if (!opp && mode === "nou") {
        if (!newLead.name.trim()) throw new Error("Indica el nom del lead");
        const r = await salesApi.lead_("create", { data: { name: newLead.name, phone: newLead.phone || null, email: newLead.email || null, services: [f.service] } });
        p = { kind: "lead", id: r.id!, name: newLead.name };
      }
      if (!p) throw new Error("Tria el client o el lead");
      const data = {
        title: f.title || `${SERVICE_SHORT[f.service]} · ${p.name}`, service: f.service, client_id: p.kind === "client" ? p.id : null, lead_id: p.kind === "lead" ? p.id : null,
        supply_id: f.supply_id || null, annual_kwh: energy ? f.annual_kwh || null : null, commission_eur: f.commission_eur || null, probability: f.probability === "" ? null : Number(f.probability),
        priority: f.priority, next_action: f.next_action || null, next_action_at: toIso(f.next_action_at), expected_close: f.expected_close || null, notes: f.notes || null, owner_id: f.owner_id || null,
      };
      const r = opp ? await salesApi.opp_("update", { id: opp.id, data }) : await salesApi.opp_("create", { data });
      useApp.getState().toast({ title: opp ? "Oportunitat actualitzada" : "Oportunitat creada", tone: "ok" });
      onSaved(opp?.id ?? r.id!);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || isStaff(u.role as never));

  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={opp ? `Edita · ${opp.title}` : "Nova oportunitat"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} {opp ? "Desa" : "Crea l'oportunitat"}</Button></>}>
      <div className="space-y-4 text-[13px]">
        {!opp && !initialParty && (
          <div className="space-y-2">
            <div className="flex rounded-xl border border-line p-0.5 text-[12.5px]" role="radiogroup" aria-label="Per a qui">
              {([["existent", "Client o lead existent"], ["nou", "Nou lead"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cn("flex-1 rounded-lg px-3 py-1.5", mode === k ? "bg-ink/[0.07] font-medium" : "text-muted")}>{l}</button>)}
            </div>
            {mode === "existent" ? <PartyPicker value={party} onChange={setParty} /> : (
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="block sm:col-span-3"><span className="label">Nom o empresa *</span><input className="input" value={newLead.name} onChange={(e) => setNewLead({ ...newLead, name: e.target.value })} /></label>
                <label className="block"><span className="label">Telèfon</span><input className="input" type="tel" value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} /></label>
                <label className="block sm:col-span-2"><span className="label">Correu</span><input className="input" type="email" value={newLead.email} onChange={(e) => setNewLead({ ...newLead, email: e.target.value })} /></label>
              </div>
            )}
          </div>
        )}
        {(opp || initialParty) && party && <p className="rounded-lg bg-elevated px-3 py-2 text-[12.5px]">{party.kind === "client" ? "Client" : "Lead"}: <b>{party.name}</b></p>}
        <div>
          <span className="label">Servei</span>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {SERVICES.map((s) => <button key={s} type="button" onClick={() => set({ service: s })} className={cn("pressable rounded-lg border px-2.5 py-2 text-left text-[12.5px]", f.service === s ? "border-brand bg-brand/[0.06] font-medium" : "border-line text-muted")} style={f.service === s ? { borderColor: SERVICE_COLOR[s], color: SERVICE_COLOR[s] } : undefined}>{SERVICE_LABEL[s]}</button>)}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-3"><span className="label">Títol</span><input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
          {energy && <label className="block"><span className="label">Consum anual estimat (kWh)</span><input className="input tnum" inputMode="decimal" value={f.annual_kwh} onChange={(e) => set({ annual_kwh: e.target.value })} /></label>}
          <label className="block"><span className="label">Comissió potencial (€)</span><input className="input tnum" inputMode="decimal" value={f.commission_eur} onChange={(e) => set({ commission_eur: e.target.value })} /></label>
          <label className="block"><span className="label">Probabilitat (%)</span><input className="input tnum" inputMode="numeric" placeholder="Segons l'etapa" value={f.probability} onChange={(e) => set({ probability: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></label>
          <label className="block"><span className="label">Prioritat</span><select className="input" value={f.priority} onChange={(e) => set({ priority: e.target.value as typeof f.priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
          <label className="block"><span className="label">Tancament previst</span><input type="date" className="input" value={f.expected_close} onChange={(e) => set({ expected_close: e.target.value })} /></label>
          <label className="block"><span className="label">Responsable</span>
            {staff ? <select className="input" value={f.owner_id} onChange={(e) => set({ owner_id: e.target.value })}><option value="">Sense assignar</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : <input className="input" disabled value={opp?.owner_name ?? (me.role === "comercial" ? me.name : "L'assignarà Administració")} />}
          </label>
          <label className="block sm:col-span-2"><span className="label">Pròxima acció</span><input className="input" value={f.next_action} onChange={(e) => set({ next_action: e.target.value })} placeholder="Trucar per demanar la factura" /></label>
          <label className="block"><span className="label">Quan</span><input type="datetime-local" className="input" value={f.next_action_at} onChange={(e) => set({ next_action_at: e.target.value })} /></label>
          <label className="block sm:col-span-3"><span className="label">Observacions</span><textarea className="input min-h-[60px]" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        </div>
        {err && <p className="rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost">{err}</p>}
      </div>
    </Modal>
  );
}

function PartyPicker({ value, onChange }: { value: Party | null; onChange: (p: Party | null) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Party[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const [c, l] = await Promise.all([crmApi.search(q), salesApi.leads({ q, size: 10 })]);
        setRes([
          ...c.results.filter((r) => r.kind === "client").map((r) => ({ kind: "client" as const, id: r.id, name: r.title })),
          ...l.rows.map((r) => ({ kind: "lead" as const, id: r.id, name: r.company || r.name })),
        ].slice(0, 10));
      } catch { setRes([]); } finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return <p className="flex items-center justify-between rounded-xl border border-brand/40 bg-brand/[0.04] px-3 py-2 text-[13px]"><span>{value.kind === "client" ? "Client" : "Lead"}: <b>{value.name}</b></span><button className="text-[12px] text-muted hover:text-ink" onClick={() => onChange(null)}>Canvia</button></p>;
  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute left-3 top-3 text-muted" />
      <input className="input pl-8" placeholder="Cerca un client o un lead pel nom, NIF o telèfon…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {busy && <Loader2 size={14} className="absolute right-3 top-3 animate-spin text-muted" />}
      {res.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-auto rounded-xl border border-line bg-surface p-1">
          {res.map((r) => <li key={`${r.kind}-${r.id}`}><button className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-ink/[0.05]" onClick={() => onChange(r)}><span>{r.name}</span><span className="text-[11px] text-muted">{r.kind === "client" ? "Client" : "Lead"}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ registre d'activitat */

export function LogActivity({ target, onDone, compact }: { target: { clientId?: string | null; leadId?: string | null; opportunityId?: string | null }; onDone: () => void; compact?: boolean }) {
  const [type, setType] = useState<ActivityType>("trucada");
  const [outcome, setOutcome] = useState<string>("contactat");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const types: ActivityType[] = ["trucada", "reunio", "email", "whatsapp", "nota"];
  const save = async () => {
    setBusy(true);
    try {
      const t = title.trim() || (type === "trucada" ? `Trucada · ${CALL_OUTCOME_LABEL[outcome as keyof typeof CALL_OUTCOME_LABEL]}` : ACTIVITY_LABEL[type]);
      await salesApi.activity({ ...target, outcome: type === "trucada" ? outcome : null, data: { type, title: t, body: body || null, delivery: type === "email" || type === "whatsapp" ? "registrat" : null } });
      setTitle(""); setBody("");
      useApp.getState().toast({ title: `${ACTIVITY_LABEL[type]} registrada`, tone: "ok" });
      onDone();
    } catch (e) { useApp.getState().toast({ title: "No s'ha pogut registrar", body: e instanceof Error ? e.message : String(e), tone: "err" }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Tipus d'activitat">
        {types.map((t) => <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn("rounded-lg border px-2.5 py-1 text-[12px]", type === t ? "border-brand bg-brand/[0.06] text-brand" : "border-line text-muted")}>{ACTIVITY_LABEL[t]}</button>)}
      </div>
      {type === "trucada" && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Resultat">
          {CALL_OUTCOMES.map((o) => <button key={o} type="button" role="radio" aria-checked={outcome === o} onClick={() => setOutcome(o)} className={cn("rounded-full border px-2.5 py-0.5 text-[11.5px]", outcome === o ? "border-ink/40 bg-ink/[0.06] font-medium" : "border-line text-muted")}>{CALL_OUTCOME_LABEL[o]}</button>)}
        </div>
      )}
      <input className="input" placeholder="Resum (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Resum" />
      {!compact && <textarea className="input min-h-[60px]" placeholder="Detalls" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Detalls" />}
      {(type === "email" || type === "whatsapp") && <p className="text-[11px] text-muted">Es registra com a fet a mà. Només els correus enviats per la plataforma consten com a enviament confirmat.</p>}
      <div className="flex justify-end"><Button size="sm" variant="primary" disabled={busy} onClick={save}>{busy && <Loader2 size={13} className="animate-spin" />} Registra</Button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ tasques */

export function TaskForm({ link, defaultTitle, defaultKind = "seguiment", onClose, onSaved }: { link: { client_id?: string | null; lead_id?: string | null; opportunity_id?: string | null }; defaultTitle?: string; defaultKind?: (typeof TASK_KINDS)[number]; onClose: () => void; onSaved: () => void }) {
  const me = useApp((s) => s.snap!.me);
  const facets = useFacets();
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; }, []);
  const [f, setF] = useState({ title: defaultTitle ?? "", kind: defaultKind, due: localInput(tomorrow), duration: "30", assigned_to: me.id, notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canAssignOthers = isStaff(me.role) || me.role === "comercial";
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await salesApi.task({ ...link, title: f.title, kind: f.kind, due_at: toIso(f.due), duration_min: f.kind === "reunio" ? Number(f.duration) || 30 : null, assigned_to: f.assigned_to || null, notes: f.notes || null });
      useApp.getState().toast({ title: "Tasca creada", body: f.assigned_to !== me.id ? "S'ha avisat la persona responsable." : undefined, tone: "ok" });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Nova tasca" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.title.trim()} onClick={save}>Crea la tasca</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Què cal fer? *</span><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="block"><span className="label">Tipus</span><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>{TASK_KINDS.map((k) => <option key={k} value={k}>{TASK_KIND_LABEL[k]}</option>)}</select></label>
        <label className="block"><span className="label">Quan</span><input type="datetime-local" className="input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
        {f.kind === "reunio" && <label className="block"><span className="label">Durada (minuts)</span><input className="input tnum" inputMode="numeric" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value.replace(/\D/g, "") })} /></label>}
        <label className="block"><span className="label">Responsable</span>
          <select className="input" value={f.assigned_to} disabled={!canAssignOthers} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}>
            <option value={me.id}>{me.name} (jo)</option>
            {(facets?.users ?? []).filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><textarea className="input min-h-[60px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {err && <p className="text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
    </Modal>
  );
}
