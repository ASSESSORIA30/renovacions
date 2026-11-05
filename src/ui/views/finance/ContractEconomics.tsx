"use client";
/** ECONOMIA I COMISSIONS d'un contracte: entrades, regla aplicada, desglossament, moviments, marge i accions. */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, Calculator, CheckCircle2, ChevronDown, ChevronRight, Loader2, Lock, Plus, Receipt } from "lucide-react";
import { CALC_STATUS_LABEL, LAYER_LABEL, LEDGER_KIND_LABEL, SEGMENTS, SEGMENT_LABEL, type CalcStatus, type LedgerKind } from "@/core/commissions";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, cn } from "../../components/ui";
import { eur, fApi, fmtD, type Calc, type ContractEcon } from "./api";

const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const CALC_TONE: Record<string, "green" | "amber" | "red" | "zinc" | "blue"> = { calculat: "green", simulacio: "blue", pendent_configuracio: "amber", pendent_dades: "amber", sense_regla: "zinc" };

export function ContractEconomicsDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const [d, setD] = useState<ContractEcon | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [manual, setManual] = useState(false);
  const load = useCallback(async () => { try { setD(await fApi.get<ContractEcon>("contract", { id: contractId })); setErr(null); } catch (e) { setErr(errMsg(e)); } }, [contractId]);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, action: string, ok: (r: Record<string, unknown>) => string) => {
    setBusy(key);
    try { const r = await fApi.act<Record<string, unknown>>(action, { id: contractId }); toast(ok(r)); await load(); } catch (e) { toast("No s'ha pogut fer", errMsg(e), "err"); } finally { setBusy(null); }
  };
  const staff = d?.permissions.staff;
  const cur = (layer: Calc["layer"]) => d?.calculations.find((c) => c.layer === layer && c.is_current);
  return (
    <Modal open onClose={onClose} width="max-w-5xl" title={d ? `Economia i comissions · ${d.client.name} · ${d.contract.retailer}${d.contract.product ? ` · ${d.contract.product}` : ""}` : "Economia i comissions"}>
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <div className="h-64 animate-pulse rounded-xl bg-ink/[0.04]" /> : (
        <div className="space-y-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Contracte {d.contract.status} · {fmtD(d.contract.start_date)} → {fmtD(d.contract.end_date)}{d.supply ? ` · ${d.supply.cups}` : ""}{d.expedient ? ` · ${d.expedient.code}` : ""}</span>
            {d.economics?.econ_status && d.economics.econ_status !== "actiu" && <Badge tone="red">{d.economics.econ_status === "anullat" ? "Anul·lat" : "Penalitzat"} el {fmtD(d.economics.cancelled_at)}</Badge>}
            <span className="flex-1" />
            {staff && <>
              <Button size="sm" onClick={() => setEdit(true)}>Dades del càlcul</Button>
              <Button size="sm" disabled={!!busy} onClick={() => run("calc", "calculate", () => "Comissions recalculades")}>{busy === "calc" ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />} Calcula</Button>
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run("acc", "accrue", (r) => `${r.created ?? 0} moviment(s) de meritació registrats`)}>{busy === "acc" ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Registra la meritació</Button>
              <Button size="sm" variant="ghost" onClick={() => setManual(true)}><Plus size={13} /> Moviment</Button>
              {d.economics?.econ_status !== "anullat" && <Button size="sm" variant="ghost" onClick={() => setCancel(true)}><Ban size={13} /> Anul·la o penalitza</Button>}
            </>}
          </div>

          {d.summary && (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Estimat (proveïdor)" value={d.summary.provider.estimated} sub={d.summary.provider.estimatedStatus ? CALC_STATUS_LABEL[d.summary.provider.estimatedStatus as CalcStatus] : "Sense càlcul"} tone="text-muted" />
              <Tile label="Meritat" value={d.summary.provider.accrued} />
              <Tile label="Confirmat pel proveïdor" value={d.summary.provider.confirmed} />
              <Tile label="Cobrat" value={d.summary.provider.collected} tone="text-ren" />
              <Tile label="Costos directes" value={d.summary.costs} />
              <Tile label="Marge de contribució" value={d.summary.margin.value ?? d.summary.margin.estimated} sub={d.summary.margin.status === "real" ? "Real (amb cobraments)" : d.summary.margin.status === "estimat" ? "Estimat" : "Incomplet"} tone={d.summary.margin.status === "real" ? "text-ren" : "text-pend"} />
            </div>
          )}
          {d.summary?.margin && d.summary.margin.status !== "real" && <p className="text-[11.5px] text-muted">{d.summary.margin.note}</p>}

          <div className="grid gap-3 lg:grid-cols-3">
            {(["proveidor", "comercial", "collaborador"] as const).filter((l) => staff || l !== "proveidor").map((layer) => {
              const c = cur(layer);
              const p = layer === "proveidor" ? null : d.payouts[layer];
              const who = layer === "comercial" ? d.owner?.name : layer === "collaborador" ? d.collaborator?.name : null;
              if (layer === "collaborador" && !d.collaborator && !c) return null;
              return (
                <section key={layer} className="rounded-xl border border-line p-3">
                  <h4 className="flex items-center gap-1.5 text-[12.5px] font-semibold">{LAYER_LABEL[layer]}{who ? <span className="font-normal text-muted">· {who}</span> : null}</h4>
                  {!c ? <p className="mt-2 text-muted">Encara no s&apos;ha calculat.</p> : <CalcCard c={c} />}
                  {p && <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 border-t border-line pt-2 text-[12px]">
                    <dt className="text-muted">Meritat</dt><dd className="text-right tnum">{eur(p.accrued)}</dd>
                    <dt className="text-muted">Ajustaments</dt><dd className="text-right tnum">{eur(p.adjustments)}</dd>
                    <dt className="text-muted">Liquidat (aprovat)</dt><dd className="text-right tnum">{eur(p.settled)}</dd>
                    <dt className="font-medium">Pendent de liquidar</dt><dd className="text-right font-medium tnum">{eur(p.pending)}</dd>
                  </dl>}
                </section>
              );
            })}
          </div>

          <section>
            <h4 className="mb-1.5 text-[12.5px] font-semibold">Moviments ({d.ledger.length})</h4>
            {!d.ledger.length ? <p className="text-muted">Cap moviment encara. Calcular no genera cap moviment: només «Registra la meritació», les liquidacions del proveïdor i els cobraments.</p> : (
              <div className="max-h-64 overflow-auto rounded-xl border border-line">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-2 py-1.5">Data</th><th>Capa</th><th>Tipus</th><th>Concepte</th><th className="text-right">Import</th><th className="px-2">Liquidació</th></tr></thead>
                  <tbody>{d.ledger.map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-2 py-1.5 tnum">{fmtD(l.period)}</td><td className="text-muted">{l.layer}</td><td>{LEDGER_KIND_LABEL[l.kind as LedgerKind] ?? l.kind}</td>
                      <td className="max-w-[320px] truncate" title={l.description}>{l.description}</td>
                      <td className={cn("text-right tnum", Number(l.amount) < 0 && "text-lost")}>{eur(l.amount)}</td>
                      <td className="px-2 text-muted">{l.settlement ? <span className="flex items-center gap-1">{["aprovada", "pagada"].includes(l.settlement.status) && <Lock size={10} />}{l.settlement.code}</span> : l.layer === "proveidor" ? "—" : "Pendent"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          {staff && d.commissionHistory && <CommissionHistory h={d.commissionHistory} deferred={d.economics?.settlement_deferred_until ?? null} />}
          {staff && !d.commissionHistory && d.statementLines.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-[12.5px] font-semibold">Liquidacions del proveïdor</h4>
              <ul className="space-y-1 text-[12px]">{d.statementLines.map((l) => <li key={l.id} className="flex items-center gap-2"><Receipt size={12} className="text-muted" /><span className="flex-1">{l.fin_provider_statements?.retailer} · {l.fin_provider_statements?.reference} · {l.concept ?? ""}</span><Badge tone={l.match_status === "conciliat" ? "green" : l.match_status === "diferencia" ? "amber" : "zinc"}>{l.match_status}</Badge><span className="tnum">{eur(l.amount)}</span>{l.difference && Number(l.difference) !== 0 && <span className="text-pend tnum">({eur(l.difference)})</span>}</li>)}</ul>
            </section>
          )}
          {staff && d.legacy?.record && <p className="text-[11.5px] text-muted">Expedient: comissió estimada {eur(d.legacy.record.estimated_eur)} · meritació {d.legacy.record.accrual_status} · cobrament {d.legacy.record.payment_status} (es manté sincronitzat amb els moviments).</p>}
        </div>
      )}
      {edit && d && <EconForm d={d} onClose={() => setEdit(false)} onDone={() => { setEdit(false); void load(); }} />}
      {cancel && d && <CancelForm id={contractId} onClose={() => setCancel(false)} onDone={() => { setCancel(false); void load(); }} />}
      {manual && d && <ManualEntry d={d} onClose={() => setManual(false)} onDone={() => { setManual(false); void load(); }} />}
    </Modal>
  );
}

const Tile = ({ label, value, sub, tone }: { label: string; value: string | null | undefined; sub?: string; tone?: string }) => (
  <div className="rounded-xl border border-line px-3 py-2"><p className="text-[11px] text-muted">{label}</p><p className={cn("text-[15px] font-semibold tnum", tone)}>{eur(value)}</p>{sub && <p className="text-[10.5px] text-muted">{sub}</p>}</div>
);

export function CalcCard({ c }: { c: Calc }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2"><Badge tone={CALC_TONE[c.status] ?? "zinc"}>{CALC_STATUS_LABEL[c.status as CalcStatus] ?? c.status}</Badge><span className="ml-auto text-[15px] font-semibold tnum">{eur(c.amount)}</span></div>
      <p className="mt-1 text-[11.5px] text-muted">{c.formula}</p>
      {c.breakdown?.length > 0 && <button className="mt-1 flex items-center gap-1 text-[11.5px] text-brand" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Desglossament{c.rule_key ? ` · ${c.rule_key} v${c.rule_version}` : ""}</button>}
      {open && <dl className="mt-1 space-y-0.5 rounded-lg bg-ink/[0.03] p-2 text-[11.5px]">{c.breakdown.map((b, i) => <div key={i} className="flex gap-2"><dt className="w-36 shrink-0 text-muted">{b.label}</dt><dd className="min-w-0 flex-1">{b.value}{b.source && <span className="block text-[10.5px] text-muted">Origen: {b.source}</span>}</dd></div>)}</dl>}
    </div>
  );
}

function EconForm({ d, onClose, onDone }: { d: ContractEcon; onClose: () => void; onDone: () => void }) {
  const e = d.economics;
  const [f, setF] = useState({ segment: e?.segment ?? d.facts?.segment ?? "", product_modality: e?.product_modality ?? "", eligible_mwh: e?.eligible_mwh ?? "", energy_increment_eur_kwh: e?.energy_increment_eur_kwh ?? "", power_increment_eur_kw_day: e?.power_increment_eur_kw_day ?? "", economic_months: String(e?.economic_months ?? 12), settlement_deferred_until: e?.settlement_deferred_until ?? "", settlement_deferral_reason: e?.settlement_deferral_reason ?? "" });
  const [busy, setBusy] = useState(false);
  const n = (s: string) => s.trim().replace(",", ".") || null;
  const save = async () => {
    setBusy(true);
    try { await fApi.act("economics", { id: d.contract.id, data: { segment: f.segment || null, product_modality: f.product_modality || null, eligible_mwh: n(f.eligible_mwh), energy_increment_eur_kwh: n(f.energy_increment_eur_kwh), power_increment_eur_kw_day: n(f.power_increment_eur_kw_day), economic_months: Number(f.economic_months) || 12, ...(f.settlement_deferred_until || e?.settlement_deferred_until ? { settlement_deferred_until: f.settlement_deferred_until || null, settlement_deferral_reason: f.settlement_deferral_reason || null } : {}) } }); toast("Dades desades i comissions recalculades"); onDone(); }
    catch (x) { toast("No s'ha pogut desar", errMsg(x), "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Dades del càlcul" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>Desa i recalcula</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block"><span className="label">Segment</span><select className="input" value={f.segment} onChange={(x) => setF({ ...f, segment: x.target.value })}><option value="">Automàtic</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select></label>
        <label className="block"><span className="label">Modalitat / producte de comissió</span><input className="input" placeholder="Ex.: Gala" value={f.product_modality} onChange={(x) => setF({ ...f, product_modality: x.target.value })} /></label>
        <label className="block"><span className="label">MWh elegibles</span><input className="input tnum" inputMode="decimal" placeholder={d.supply?.annual_kwh != null ? `Consum: ${(d.supply.annual_kwh / 1000).toLocaleString("ca-ES")} MWh` : ""} value={f.eligible_mwh} onChange={(x) => setF({ ...f, eligible_mwh: x.target.value })} /></label>
        <label className="block"><span className="label">Liquidació ajornada fins a (opcional)</span><input type="date" className="input" value={f.settlement_deferred_until} onChange={(x) => setF({ ...f, settlement_deferred_until: x.target.value })} /></label>
        <label className="block"><span className="label">Motiu de l&apos;ajornament (clàusula del contracte)</span><input className="input" value={f.settlement_deferral_reason} onChange={(x) => setF({ ...f, settlement_deferral_reason: x.target.value })} /></label>
        <label className="block"><span className="label">Període econòmic (mesos)</span><input className="input tnum" inputMode="numeric" value={f.economic_months} onChange={(x) => setF({ ...f, economic_months: x.target.value.replace(/\D/g, "").slice(0, 3) })} /></label>
        <label className="block"><span className="label">Increment pactat d&apos;energia (€/kWh)</span><input className="input tnum" inputMode="decimal" value={f.energy_increment_eur_kwh} onChange={(x) => setF({ ...f, energy_increment_eur_kwh: x.target.value })} /></label>
        <label className="block"><span className="label">Increment pactat de potència (€/kW·dia)</span><input className="input tnum" inputMode="decimal" value={f.power_increment_eur_kw_day} onChange={(x) => setF({ ...f, power_increment_eur_kw_day: x.target.value })} /></label>
        <p className="text-[11.5px] text-muted sm:col-span-2">Aquestes dades alimenten el motor de comissions. Cada valor apareix al desglossament amb el seu origen.</p>
      </div>
    </Modal>
  );
}

function CancelForm({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: "anullat", date: new Date().toISOString().slice(0, 10), reason: "" });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ actions: string[]; warnings: string[] } | null>(null);
  const save = async () => { setBusy(true); try { setRes(await fApi.act<{ actions: string[]; warnings: string[] }>("cancel", { id, data: f })); } catch (x) { toast("No s'ha pogut registrar", errMsg(x), "err"); } finally { setBusy(false); } };
  return (
    <Modal open onClose={res ? onDone : onClose} title="Anul·lació o penalització" footer={res ? <Button variant="primary" onClick={onDone}>Tanca</Button> : <><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || f.reason.trim().length < 3} onClick={save}>Registra</Button></>}>
      {!res ? (
        <div className="space-y-3 text-[13px]">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Tipus</span><select className="input" value={f.status} onChange={(x) => setF({ ...f, status: x.target.value })}><option value="anullat">Anul·lat</option><option value="penalitzat">Penalitzat</option></select></label>
            <label className="block"><span className="label">Data</span><input type="date" className="input" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></label>
          </div>
          <label className="block"><span className="label">Motiu *</span><input className="input" value={f.reason} onChange={(x) => setF({ ...f, reason: x.target.value })} /></label>
          <p className="text-[12px] text-muted">El que encara no s&apos;ha liquidat s&apos;anul·la amb un moviment negatiu. Sobre el que ja s&apos;ha liquidat només s&apos;aplica una retrocessió si hi ha una regla de retrocessió aprovada; si no, es genera un avís per revisar-ho.</p>
        </div>
      ) : (
        <div className="space-y-2 text-[13px]">
          {res.actions.map((a) => <p key={a} className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-ren" /> {a}</p>)}
          {res.warnings.map((a) => <p key={a} className="flex items-center gap-1.5 text-pend"><AlertTriangle size={13} /> {a}</p>)}
          {!res.actions.length && !res.warnings.length && <p className="text-muted">No hi havia cap import a revertir.</p>}
        </div>
      )}
    </Modal>
  );
}

function ManualEntry({ d, onClose, onDone }: { d: ContractEcon; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ layer: "comercial", kind: "ajustament", amount: "", description: "" });
  const [key] = useState(() => crypto.randomUUID());
  const benef = f.layer === "comercial" ? d.owner?.id : f.layer === "collaborador" ? d.collaborator?.id : null;
  const kinds = f.layer === "proveidor" ? ["ajustament", "regularitzacio", "retrocessio", "facturacio", "confirmacio"] : ["ajustament", "bonificacio", "regularitzacio", "retrocessio"];
  const save = async () => {
    try { await fApi.act("manual", { data: { contract_id: d.contract.id, layer: f.layer, beneficiary_id: benef ?? null, kind: f.kind, amount: f.amount.replace(",", "."), description: f.description, key } }); toast("Moviment registrat"); onDone(); }
    catch (x) { toast("No s'ha pogut registrar", errMsg(x), "err"); }
  };
  return (
    <Modal open onClose={onClose} title="Nou moviment econòmic" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!f.amount || f.description.trim().length < 3 || (f.layer !== "proveidor" && !benef)} onClick={save}>Registra</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block"><span className="label">Capa</span><select className="input" value={f.layer} onChange={(x) => setF({ ...f, layer: x.target.value, kind: "ajustament" })}><option value="proveidor">Proveïdor</option><option value="comercial">Comercial{d.owner?.name ? ` (${d.owner.name})` : ""}</option>{d.collaborator && <option value="collaborador">Col·laborador ({d.collaborator.name})</option>}</select></label>
        <label className="block"><span className="label">Tipus</span><select className="input" value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}>{kinds.map((k) => <option key={k} value={k}>{LEDGER_KIND_LABEL[k as LedgerKind]}</option>)}</select></label>
        <label className="block"><span className="label">Import (€, negatiu per descomptar)</span><input className="input tnum" inputMode="decimal" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Motiu *</span><input className="input" value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} /></label>
        <p className="text-[11.5px] text-muted sm:col-span-2">Els moviments no es poden modificar ni esborrar: qualsevol correcció és un moviment nou. Queda registrat qui l&apos;ha fet.</p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Fase 14 · historial de comissions (quatre estats separats) */
type History = NonNullable<ContractEcon["commissionHistory"]>;
const MOV: Record<string, string> = { alta: "Alta", renovacio: "Renovació", retrocessio: "Retrocomissió", baixa: "Baixa", recurrent: "Recurrent (consum)", regularitzacio: "Regularització", altres: "Altres" };
function CommissionHistory({ h, deferred }: { h: History; deferred: string | null }) {
  const st = h.states;
  const pending = Math.max(0, Number(st.liquidada) + Number(st.regularitzacions) - Number(st.cobrada));
  const box = (label: string, v: string | null, sub?: string, tone?: string) => (
    <div className="rounded-xl border border-line p-2.5"><p className="text-[10.5px] uppercase tracking-wide text-muted">{label}</p><p className={cn("text-[15px] font-semibold tnum", tone)}>{v != null ? eur(v) : "—"}</p>{sub && <p className="text-[10.5px] text-muted">{sub}</p>}</div>
  );
  return (
    <section data-testid="historial-comissions">
      <h4 className="mb-1.5 text-[12.5px] font-semibold">Historial de comissions de la comercialitzadora</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {box("Prevista", st.prevista.amount, st.prevista.status === "simulacio" ? "simulació (regla no aprovada)" : st.prevista.amount == null ? "sense regla aprovada" : "regla aprovada")}
        {box("Liquidada", st.liquidada, Number(st.regularitzacions) !== 0 ? `retrocomissions i regularitzacions ${eur(st.regularitzacions)}` : "declarat per la comercialitzadora")}
        {box("Cobrada", st.cobrada, "confirmada amb el banc", "text-ren")}
        {box("Reclamada", st.reclamada, Number(st.recuperada) > 0 ? `recuperat ${eur(st.recuperada)}` : undefined)}
        {box("Pendent de cobrament", pending.toFixed(2), deferred ? `liquidació ajornada fins al ${fmtD(deferred)}` : undefined, pending > 0 ? "text-pend" : undefined)}
      </div>
      {h.lines.length > 0 ? (
        <div className="mt-2 overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="py-1">Liquidació</th><th>Moviment</th><th>Origen</th><th className="text-right">Liquidat</th><th className="text-right">Previst</th><th className="text-right">Cobrat</th><th>Estat</th></tr></thead>
            <tbody>{h.lines.map((l) => (
              <tr key={l.id} className="border-t border-line align-top">
                <td className="py-1">{fmtD(l.received_at)}<span className="block font-mono text-[10.5px] text-muted">{l.reference}</span></td>
                <td>{l.movement ? MOV[l.movement] ?? l.movement : l.concept ?? "—"}{l.doc_status && <span className="block text-[10.5px] text-muted">{l.doc_status}</span>}</td>
                <td className="text-[11px] text-muted">{l.origin ?? "—"}</td>
                <td className={cn("text-right tnum", Number(l.amount) < 0 && "text-lost")}>{eur(l.amount)}</td>
                <td className="text-right tnum text-muted">{eur(l.expected)}</td>
                <td className="text-right tnum text-ren">{Number(l.collected) > 0 ? <>{eur(l.collected)}<span className="block text-[10px] text-muted">{fmtD(l.collected_at)}</span></> : "—"}</td>
                <td><Badge tone={l.match_status === "conciliat" ? "green" : l.match_status === "diferencia" ? "amber" : l.match_status === "duplicat" ? "red" : "zinc"}>{l.match_status === "conciliat" ? (Number(l.collected) >= Number(l.amount) && Number(l.amount) > 0 ? "Cobrada" : Number(l.amount) > 0 ? "Liquidada, pendent de cobrament" : "Conciliada") : l.match_status}</Badge>{l.claim.length > 0 && <Badge tone="blue" className="ml-1">{l.claim.join(", ")}</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="mt-2 text-[12px] text-muted">Encara no apareix a cap liquidació de la comercialitzadora.</p>}
      {h.claims.length > 0 && <p className="mt-1 text-[11.5px] text-muted">Reclamacions: {h.claims.map((c) => `${c.code ?? "—"} (${eur(c.claimed)}${Number(c.recovered) > 0 ? `, recuperat ${eur(c.recovered)}` : ""})`).join(" · ")}</p>}
    </section>
  );
}
