"use client";
/** Components compartits de Contractació: etiquetes d'estat, diàlegs de canvi d'estat i d'activació, i l'assistent de nou expedient. */
import { RetailerInput } from "../retailers/options";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileCheck2, Loader2, Plus, Search } from "lucide-react";
import {
  ACTIVATION_SOURCES, ACTIVATION_SOURCE_LABEL, EXP_STATUS_COLOR, EXP_STATUS_LABEL, PROCEDURE_LABEL, PROCEDURE_TYPES, needsJustification, type ExpStatus,
} from "@/core/contracting";
import { PRIORITIES, PRIORITY_LABEL, type CrmClientDetail } from "@/core/crm";
import { ENERGY_SERVICES, SERVICES, SERVICE_LABEL, type Service } from "@/core/sales";
import { isStaff } from "@/core/roles";
import { useApp } from "@/data/store";
import { Button, Modal, Notice, cn } from "../../components/ui";
import { crmApi } from "../crm/api";
import { useFacets } from "../sales/shared";
import { cApi, todayStr, type Progress } from "./api";

export const StatusPill = ({ s, size = "sm" }: { s: ExpStatus; size?: "sm" | "md" }) => (
  <span className={cn("inline-flex items-center gap-1.5 rounded-full font-medium", size === "md" ? "px-2.5 py-1 text-[12.5px]" : "px-2 py-0.5 text-[11px]")} style={{ background: `${EXP_STATUS_COLOR[s]}1a`, color: EXP_STATUS_COLOR[s] }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: EXP_STATUS_COLOR[s] }} />{EXP_STATUS_LABEL[s]}
  </span>
);

/** Indicador de documentació (obligatòria aportada / total). */
export function DocMeter({ p, compact }: { p: Progress; compact?: boolean }) {
  const tone = p.rejected ? "bg-lost" : p.pending ? "bg-pend" : "bg-ren";
  return (
    <span className="inline-flex items-center gap-1.5" title={`Documentació obligatòria: ${p.done} de ${p.total}${p.rejected ? ` · ${p.rejected} rebutjada` : ""}`}>
      <span className={cn("relative overflow-hidden rounded-full bg-ink/[0.08]", compact ? "h-1.5 w-10" : "h-2 w-20")}><span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${p.pct}%` }} /></span>
      <span className={cn("tnum", compact ? "text-[11px]" : "text-[12px]", p.rejected ? "text-lost" : p.pending ? "text-pend" : "text-ren")}>{p.done}/{p.total}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ canvi d'estat amb validació */

export function MoveDialog({ exp, to, onClose, onDone }: { exp: { id: string; code: string; status: ExpStatus; version: number; retailer: string; sent_to?: string | null }; to: ExpStatus; onClose: () => void; onDone: (r: { version: number; status: ExpStatus }) => void }) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [sentAt, setSentAt] = useState(todayStr());
  const [sentTo, setSentTo] = useState(exp.sent_to ?? exp.retailer);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const just = needsJustification(exp.status, to);
  const ok = (!just || note.trim()) && (to !== "rebutjat" || reason.trim()) && (to !== "enviat" || (sentAt && sentTo.trim()));
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await cApi.act<{ version: number; status: ExpStatus }>("move", { id: exp.id, data: { status: to, version: exp.version, note: note || null, rejection_reason: reason || null, sent_at: to === "enviat" ? sentAt : null, sent_to: to === "enviat" ? sentTo : null, external_ref: to === "enviat" ? ref || null : null } });
      useApp.getState().toast({ title: `${exp.code}: ${EXP_STATUS_LABEL[to]}`, tone: "ok" });
      onDone(r);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${exp.code} · ${EXP_STATUS_LABEL[exp.status]} → ${EXP_STATUS_LABEL[to]}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !ok} onClick={run}>{busy && <Loader2 size={14} className="animate-spin" />} Confirma</Button></>}>
      <div className="space-y-3 text-[13px]">
        {to === "enviat" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Data d&apos;enviament *</span><input type="date" className="input" max={todayStr()} value={sentAt} onChange={(e) => setSentAt(e.target.value)} /></label>
            <label className="block"><span className="label">Comercialitzadora receptora *</span><input className="input" value={sentTo} onChange={(e) => setSentTo(e.target.value)} /></label>
            <label className="block sm:col-span-2"><span className="label">Referència de la comercialitzadora</span><input className="input font-mono" placeholder="Número de sol·licitud o d'alta" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          </div>
        )}
        {to === "rebutjat" && <label className="block"><span className="label">Motiu del rebuig o de l&apos;anul·lació *</span><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: CUPS amb deute pendent, client desisteix…" /></label>}
        <label className="block"><span className="label">{just ? "Justificació *" : "Observació (opcional)"}</span><textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder={to === "incidencia" ? "Què ha passat? Es crearà també una incidència vinculada." : "Queda registrada a l'historial de l'expedient."} /></label>
        {to === "signat" && <Notice tone="blue">Només es pot marcar com a signat si hi ha una signatura confirmada pel proveïdor o una signatura manuscrita registrada per Administració.</Notice>}
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ activació confirmada */

export function ActivationDialog({ exp, onClose, onDone }: { exp: { id: string; code: string; retailer: string; product: string | null }; onClose: () => void; onDone: () => void }) {
  const t = todayStr();
  const [f, setF] = useState({ activated_at: t, start_date: t, end_date: "", source: "", ref: "", note: "", create_renewal: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plusYear = (d: string) => { const x = new Date(`${d}T12:00:00`); x.setFullYear(x.getFullYear() + 1); x.setDate(x.getDate() - 1); return x.toISOString().slice(0, 10); };
  const ok = f.activated_at && f.start_date && f.source;
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await cApi.act<{ contractId: string; renewalOpportunityId: string | null; publishedToRenewals: boolean }>("activate", { id: exp.id, data: { ...f, end_date: f.end_date || null, ref: f.ref || null, note: f.note || null } });
      useApp.getState().toast({ title: "Activació registrada", body: `S'ha creat el contracte${r.publishedToRenewals ? " i s'ha incorporat a Renovacions" : ""}${r.renewalOpportunityId ? ". També s'ha creat l'oportunitat de renovació." : "."}`, tone: "ok" });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-xl" title={`Confirmar l'activació · ${exp.code}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !ok} onClick={run}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />} Registra l&apos;activació</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <p className="text-muted sm:col-span-2">Registra-ho només quan la comercialitzadora o la distribuïdora hagi confirmat que el contracte <b>ja està actiu</b>. Es crearà el contracte de {exp.retailer}{exp.product ? ` (${exp.product})` : ""} i l&apos;anterior quedarà a l&apos;historial.</p>
        <label className="block"><span className="label">Data real d&apos;activació *</span><input type="date" className="input" max={t} value={f.activated_at} onChange={(e) => setF({ ...f, activated_at: e.target.value })} /></label>
        <label className="block"><span className="label">Inici del contracte *</span><input type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date || plusYear(e.target.value) })} /></label>
        <label className="block"><span className="label">Finalització o renovació</span><input type="date" className="input" min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /><span className="mt-1 block text-[11px] text-muted">Si es coneix. Sense data no s&apos;incorpora al Kanban de renovacions.</span></label>
        <label className="block"><span className="label">Qui ho ha confirmat *</span><select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">Tria…</option>{ACTIVATION_SOURCES.map((s) => <option key={s} value={s}>{ACTIVATION_SOURCE_LABEL[s]}</option>)}</select></label>
        <label className="block sm:col-span-2"><span className="label">Referència d&apos;activació</span><input className="input font-mono" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="Número de contracte o d'alta" /></label>
        <label className="block sm:col-span-2"><span className="label">Observació</span><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ex.: confirmat per correu de la comercialitzadora" /></label>
        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={f.create_renewal} onChange={(e) => setF({ ...f, create_renewal: e.target.checked })} /> Crea ara l&apos;oportunitat de renovació</label>
        <p className="rounded-xl bg-ink/[0.04] px-3 py-2 text-[12px] text-muted sm:col-span-2">La comissió <b>no</b> es marca com a meritada ni cobrada: ho farà Administració quan es concili amb la comercialitzadora.</p>
        {err && <div className="sm:col-span-2"><Notice tone="red">{err}</Notice></div>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ assistent de nou expedient */

type ClientPick = { id: string; name: string };
export function NewExpedientWizard({ initial, onClose }: { initial?: { clientId?: string; clientName?: string; opportunityId?: string; supplyId?: string | null; service?: Service; retailer?: string; product?: string | null; comparisonId?: string | null }; onClose: () => void }) {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const facets = useFacets();
  const [step, setStep] = useState(initial?.clientId ? 1 : 0);
  const [client, setClient] = useState<ClientPick | null>(initial?.clientId ? { id: initial.clientId, name: initial.clientName ?? "" } : null);
  const [detail, setDetail] = useState<CrmClientDetail | null>(null);
  const [f, setF] = useState({ supply_id: initial?.supplyId ?? "", service: (initial?.service ?? "") as Service | "", procedure_type: "canvi_comercialitzadora", retailer: initial?.retailer ?? "", product: initial?.product ?? "", priority: "mitjana", owner_id: "", expected_activation_date: "", internal_notes: "" });
  const [newSupply, setNewSupply] = useState<{ cups: string; energy_type: "luz" | "gas"; access_tariff: string } | null>(null);
  const [terms, setTerms] = useState<{ source: "comparativa" | "manual" | "cap"; comparison_id: string; offer_id: string; text: string; permanence: string }>({ source: initial?.comparisonId ? "comparativa" : "cap", comparison_id: initial?.comparisonId ?? "", offer_id: "", text: "", permanence: "" });
  const [comparisons, setComparisons] = useState<{ id: string; created_at: string; offers: { id: string; label: string }[]; best: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    crmApi.get(client.id).then((d) => {
      setDetail(d);
      setComparisons((d.comparisons ?? []).map((k) => ({ id: k.id, created_at: k.created_at, offers: k.offers ?? [], best: k.best ?? null })));
      if (!f.supply_id && d.supplies.filter((s) => !s.archived_at).length === 1) setF((x) => ({ ...x, supply_id: d.supplies.find((s) => !s.archived_at)!.id }));
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const supplies = (detail?.supplies ?? []).filter((s) => !s.archived_at);
  const supply = supplies.find((s) => s.id === f.supply_id);
  const energy = f.service ? ENERGY_SERVICES.includes(f.service) : false;
  useEffect(() => { if (supply && !f.service) setF((x) => ({ ...x, service: supply.energy_type === "gas" ? "gas" : detail?.client.kind === "particular" ? "llum_residencial" : "llum_empresa" })); }, [supply]); // eslint-disable-line react-hooks/exhaustive-deps
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || isStaff(u.role as never));
  const steps = ["Client", "Subministrament", "Producte", "Condicions", "Revisió"];
  const canNext = [!!client, !energy || !!f.supply_id || !!newSupply?.cups, !!f.service && !!f.retailer.trim(), terms.source !== "comparativa" || !!terms.comparison_id, true][step];

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      let supplyId = f.supply_id || null;
      if (newSupply?.cups) {
        const r = await crmApi.action<{ id: string }>({ entity: "supply", action: "create", clientId: client!.id, data: { cups: newSupply.cups, energy_type: newSupply.energy_type, access_tariff: newSupply.access_tariff || null } });
        supplyId = r.id ?? null;
      }
      const termsPayload = terms.source === "comparativa" ? { source: "comparativa", comparison_id: terms.comparison_id, offer_id: terms.offer_id || null }
        : terms.source === "manual" ? { source: "manual", retailer: f.retailer, product: f.product || null, conditions: { text: terms.text || null, permanence_months: terms.permanence ? Number(terms.permanence) : null } } : undefined;
      const r = await cApi.act<{ id: string; code: string }>("create", {
        data: { client_id: client!.id, supply_id: supplyId, opportunity_id: initial?.opportunityId ?? null, comparison_id: terms.comparison_id || null, service: f.service, procedure_type: f.procedure_type, retailer: f.retailer, product: f.product || null, priority: f.priority, owner_id: f.owner_id || null, expected_activation_date: f.expected_activation_date || null, internal_notes: f.internal_notes || null },
        terms: termsPayload,
      });
      useApp.getState().toast({ title: `Expedient ${r.code} creat`, body: "S'han preparat els requisits de documentació.", tone: "ok" });
      onClose();
      useApp.getState().navigate("expedient", { id: r.id });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Nou expedient de contractació"
      footer={<>
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}><ChevronLeft size={14} /> Enrere</Button>}
        <span className="flex-1" />
        {step < 4 ? <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Següent <ChevronRight size={14} /></Button>
          : <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Crea l&apos;expedient</Button>}
      </>}>
      <ol className="mb-4 flex items-center gap-1 text-[11.5px]" aria-label="Passos">
        {steps.map((s, i) => <li key={s} className={cn("flex flex-1 items-center gap-1.5 rounded-lg px-2 py-1", i === step ? "bg-brand/[0.08] font-medium text-brand" : i < step ? "text-ink" : "text-muted")} aria-current={i === step ? "step" : undefined}><span className={cn("grid h-4 w-4 place-items-center rounded-full text-[10px]", i < step ? "bg-brand text-white" : "bg-ink/[0.08]")}>{i < step ? <Check size={10} /> : i + 1}</span>{s}</li>)}
      </ol>
      <div className="min-h-[230px] text-[13px]">
        {step === 0 && <ClientPicker value={client} onChange={setClient} />}
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-muted">Client: <b className="text-ink">{detail?.client.name ?? client?.name}</b>{detail?.client.tax_id ? ` · ${detail.client.tax_id}` : ""}</p>
            {!detail ? <Loader2 className="animate-spin text-muted" size={16} /> : (
              <>
                {supplies.map((s) => (
                  <label key={s.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2", f.supply_id === s.id ? "border-brand bg-brand/[0.04]" : "border-line")}>
                    <input type="radio" name="sup" checked={f.supply_id === s.id} onChange={() => { setF({ ...f, supply_id: s.id }); setNewSupply(null); }} />
                    <span className="font-mono text-[12.5px]">{s.cups}</span><span className="text-muted">{s.energy_type === "gas" ? "Gas" : "Llum"} · {s.access_tariff ?? "—"} · {s.current_retailer ?? "—"}</span>
                  </label>
                ))}
                {!newSupply ? <button className="flex items-center gap-1 text-[12.5px] text-brand" onClick={() => { setNewSupply({ cups: "", energy_type: "luz", access_tariff: "" }); setF({ ...f, supply_id: "" }); }}><Plus size={13} /> Nou subministrament</button> : (
                  <div className="grid gap-2 rounded-xl border border-brand/40 p-3 sm:grid-cols-3">
                    <label className="block sm:col-span-3"><span className="label">CUPS *</span><input className="input font-mono uppercase" value={newSupply.cups} onChange={(e) => setNewSupply({ ...newSupply, cups: e.target.value.toUpperCase().replace(/\s/g, "") })} /></label>
                    <label className="block"><span className="label">Tipus</span><select className="input" value={newSupply.energy_type} onChange={(e) => setNewSupply({ ...newSupply, energy_type: e.target.value as "luz" | "gas" })}><option value="luz">Electricitat</option><option value="gas">Gas</option></select></label>
                    <label className="block"><span className="label">Tarifa d&apos;accés</span><input className="input" value={newSupply.access_tariff} onChange={(e) => setNewSupply({ ...newSupply, access_tariff: e.target.value })} placeholder="2.0TD" /></label>
                  </div>
                )}
                {!supplies.length && !newSupply && <p className="text-[12px] text-muted">El client no té cap subministrament. Per a fibra, assegurances o alarmes no cal.</p>}
              </>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Servei *</span><select className="input" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value as Service })}><option value="">Tria…</option>{SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select></label>
            <label className="block"><span className="label">Tipus de tràmit</span><select className="input" value={f.procedure_type} onChange={(e) => setF({ ...f, procedure_type: e.target.value })}>{PROCEDURE_TYPES.map((p) => <option key={p} value={p}>{PROCEDURE_LABEL[p]}</option>)}</select></label>
            <label className="block"><span className="label">Comercialitzadora o proveïdor *</span><RetailerInput value={f.retailer} onChange={(v) => setF({ ...f, retailer: v })} /></label>
            <label className="block"><span className="label">Producte</span><input className="input" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></label>
            <label className="block"><span className="label">Prioritat</span><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
            <label className="block"><span className="label">Activació prevista</span><input type="date" className="input" value={f.expected_activation_date} onChange={(e) => setF({ ...f, expected_activation_date: e.target.value })} /></label>
            {staff && <label className="block sm:col-span-2"><span className="label">Responsable</span><select className="input" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}><option value="">El comercial del client</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
            <label className="block sm:col-span-2"><span className="label">Observacions internes</span><textarea className="input min-h-[56px]" value={f.internal_notes} onChange={(e) => setF({ ...f, internal_notes: e.target.value })} /></label>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-muted">Les condicions acceptades es desen en una còpia que <b>no canvia</b> encara que després s&apos;editi la tarifa o la comparativa.</p>
            <div className="flex rounded-xl border border-line p-0.5" role="radiogroup" aria-label="Origen de les condicions">
              {([["comparativa", "Comparativa acceptada"], ["manual", "Introducció manual"], ["cap", "Més tard"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={terms.source === k} onClick={() => setTerms({ ...terms, source: k })} className={cn("flex-1 rounded-lg px-3 py-1.5", terms.source === k ? "bg-ink/[0.07] font-medium" : "text-muted")}>{l}</button>)}
            </div>
            {terms.source === "comparativa" && (comparisons.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">Comparativa *</span><select className="input" value={terms.comparison_id} onChange={(e) => setTerms({ ...terms, comparison_id: e.target.value, offer_id: "" })}><option value="">Tria…</option>{comparisons.map((k) => <option key={k.id} value={k.id}>{new Date(k.created_at).toLocaleDateString("ca-ES")} · {k.offers.length} ofertes</option>)}</select></label>
                <label className="block"><span className="label">Oferta acceptada</span><select className="input" value={terms.offer_id} onChange={(e) => setTerms({ ...terms, offer_id: e.target.value })}><option value="">La recomanada</option>{comparisons.find((k) => k.id === terms.comparison_id)?.offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
              </div>
            ) : <Notice tone="amber">Aquest client no té cap comparativa desada. Tria «Introducció manual» o «Més tard».</Notice>)}
            {terms.source === "manual" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block sm:col-span-2"><span className="label">Condicions pactades</span><textarea className="input min-h-[80px]" value={terms.text} onChange={(e) => setTerms({ ...terms, text: e.target.value })} placeholder="Preus, descomptes i condicions tal com consten a la proposta acceptada" /></label>
                <label className="block"><span className="label">Permanència (mesos)</span><input className="input" inputMode="numeric" value={terms.permanence} onChange={(e) => setTerms({ ...terms, permanence: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></label>
              </div>
            )}
          </div>
        )}
        {step === 4 && (
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted">Client</dt><dd className="font-medium">{detail?.client.name ?? client?.name}</dd>
            <dt className="text-muted">Subministrament</dt><dd className="font-mono text-[12.5px]">{supply?.cups ?? newSupply?.cups ?? "—"}</dd>
            <dt className="text-muted">Servei</dt><dd>{f.service ? SERVICE_LABEL[f.service] : "—"} · {PROCEDURE_LABEL[f.procedure_type as keyof typeof PROCEDURE_LABEL]}</dd>
            <dt className="text-muted">Producte</dt><dd>{f.retailer}{f.product ? ` · ${f.product}` : ""}</dd>
            <dt className="text-muted">Condicions</dt><dd>{terms.source === "comparativa" ? "De la comparativa acceptada" : terms.source === "manual" ? "Introduïdes a mà" : "Pendents"}</dd>
            {initial?.opportunityId && <><dt className="text-muted">Oportunitat</dt><dd>Guanyada · vinculada</dd></>}
          </dl>
        )}
        {err && <div className="mt-3"><Notice tone="red">{err}</Notice></div>}
      </div>
    </Modal>
  );
}

function ClientPicker({ value, onChange }: { value: ClientPick | null; onChange: (c: ClientPick | null) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ClientPick[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try { setRes((await crmApi.search(q)).results.filter((r) => r.kind === "client").map((r) => ({ id: r.id, name: r.title })).slice(0, 10)); } catch { setRes([]); } finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useMemo(() => res, [res]);
  if (value) return <p className="flex items-center justify-between rounded-xl border border-brand/40 bg-brand/[0.04] px-3 py-2">Client: <b>{value.name}</b><button className="text-[12px] text-muted hover:text-ink" onClick={() => onChange(null)}>Canvia</button></p>;
  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute left-3 top-3 text-muted" />
      <input className="input pl-8" placeholder="Cerca el client pel nom, NIF o telèfon…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Cerca client" />
      {busy && <Loader2 size={14} className="absolute right-3 top-3 animate-spin text-muted" />}
      {list.length > 0 && <ul className="mt-1 max-h-56 overflow-auto rounded-xl border border-line bg-surface p-1">{list.map((r) => <li key={r.id}><button className="w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-ink/[0.05]" onClick={() => onChange(r)}>{r.name}</button></li>)}</ul>}
      <p className="mt-2 text-[12px] text-muted">Si el client encara no existeix, crea&apos;l primer a Clients (o converteix el lead des de l&apos;oportunitat).</p>
    </div>
  );
}
