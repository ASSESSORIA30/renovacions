"use client";
/** REGLES DE COMISSIONS: configurables sense codi, versionades i aprovades per Direcció. */
import { formatUnitValue } from "@/core/units";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, History, PenLine, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { KINDS, KIND_LABEL, LAYERS, LAYER_LABEL, RULE_STATUS_LABEL, SEGMENTS, SEGMENT_LABEL, UNIT_OF, type Kind, type Layer, type RuleRow } from "@/core/commissions";
import { SERVICES, SERVICE_LABEL } from "@/core/sales";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, Tabs, cn } from "../../components/ui";
import { eur, fApi, fmtD } from "./api";

const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Rule = RuleRow & { approved_by_name: string | null; approved_at: string | null; beneficiary_name: string | null; is_seed: boolean };
type Data = { rules: Rule[]; canManage: boolean; isDirector: boolean; users: { id: string; name: string; role: string }[] };
const valueText = (r: Pick<RuleRow, "kind" | "value" | "tiers">) => r.kind === "trams_volum" ? (r.tiers ?? []).map((t) => `${t.threshold}→${t.amount} €`).join(" · ") : UNIT_OF[r.kind] === "eur" ? eur(r.value) : formatUnitValue(r.value, UNIT_OF[r.kind]);
const STONE: Record<string, "zinc" | "amber" | "green" | "red"> = { esborrany: "zinc", pendent_aprovacio: "amber", aprovada: "green", retirada: "red" };

export function RulesView() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>("comercial");
  const [edit, setEdit] = useState<Rule | "new" | null>(null);
  const [sim, setSim] = useState<Rule | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const load = useCallback(() => fApi.get<Data>("rules").then((r) => { setD(r); setErr(null); }).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { void load(); }, [load]);
  const latest = useMemo(() => {
    const m = new Map<string, Rule>();
    for (const r of d?.rules ?? []) if (r.layer === layer) { const c = m.get(r.rule_key); if (!c || r.version > c.version) m.set(r.rule_key, r); }
    return [...m.values()].sort((a, b) => (a.retailer ?? "").localeCompare(b.retailer ?? "") || a.name.localeCompare(b.name));
  }, [d, layer]);
  const status = async (r: Rule, s: string) => { try { await fApi.act("rule_status", { id: r.id, status: s }); toast(s === "aprovada" ? "Regla aprovada" : s === "retirada" ? "Regla retirada" : "Estat actualitzat"); await load(); } catch (e) { toast("No s'ha pogut canviar", errMsg(e), "err"); } };
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-semibold tracking-tight">Regles de comissions</h2><p className="text-[13px] text-muted">Cada modificació d&apos;una regla aprovada crea una versió nova. Els càlculs antics conserven la versió que s&apos;hi va aplicar.</p></div>
        {d?.canManage && <Button variant="primary" onClick={() => setEdit("new")}><Plus size={14} /> Nova regla</Button>}
      </div>
      <Notice tone="amber">Dues capes separades: el que <b>la comercialitzadora paga a Assessoria 3.0</b> i el que <b>Assessoria 3.0 paga</b> als comercials i col·laboradors. Les regles inicials (pendents d&apos;aprovació) s&apos;han carregat com a pagaments a l&apos;equip comercial; les de proveïdor s&apos;han de configurar amb els acords reals. Cap import és definitiu fins que Direcció l&apos;aprova.</Notice>
      {err && <Notice tone="red">{err}</Notice>}
      <Tabs value={layer} onChange={setLayer} items={LAYERS.map((l) => ({ id: l, label: LAYER_LABEL[l], count: new Set((d?.rules ?? []).filter((r) => r.layer === l).map((r) => r.rule_key)).size }))} />
      {!d ? <div className="h-40 animate-pulse rounded-2xl bg-elevated" /> : !latest.length ? <p className="rounded-2xl border border-line bg-surface p-6 text-center text-[13px] text-muted">No hi ha regles en aquesta capa{layer === "proveidor" ? ". Afegeix les condicions reals de cada comercialitzadora (no s'inventa cap import)." : "."}</p> : (
        <div className="overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Regla</th><th>S&apos;aplica a</th><th>Tipus</th><th>Valor</th><th>Vigència</th><th>Estat</th><th className="px-3 text-right" /></tr></thead>
            <tbody>{latest.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-3 py-2"><span className="font-medium">{r.name}</span> <span className="text-muted">v{r.version}</span>{r.notes && <span className="block max-w-[340px] text-[11.5px] text-muted">{r.notes}</span>}{r.base_formula && <span className="block max-w-[340px] text-[11px] text-muted">Base: {r.base_formula}</span>}{UNIT_OF[r.kind] === "pct" && r.kind !== "retrocessio" && !r.base_validated && <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-pend"><ShieldAlert size={11} /> Pendent de configuració: base no validada</span>}</td>
                <td className="text-[11.5px]">{[r.retailer, r.product, r.service ? SERVICE_LABEL[r.service] : null, r.segment ? SEGMENT_LABEL[r.segment] : null, r.beneficiary_name].filter(Boolean).join(" · ") || "Tots"}</td>
                <td className="text-[11.5px]">{KIND_LABEL[r.kind]}{r.kind === "trams_volum" && <span className="block text-muted">{(r.conditions as { metric?: string }).metric === "mwh" ? "MWh" : "contractes"} {(r.conditions as { basis?: string }).basis ?? "activat"}s · {(r.conditions as { policy?: string }).policy === "acumulat" ? "acumulat" : "només el tram més alt"}</span>}</td>
                <td className="font-medium tnum">{valueText(r)}</td>
                <td className="text-[11.5px] text-muted">{fmtD(r.valid_from)}{r.valid_to ? ` → ${fmtD(r.valid_to)}` : " →"}</td>
                <td><Badge tone={STONE[r.status]}>{RULE_STATUS_LABEL[r.status]}</Badge>{r.approved_by_name && <span className="block text-[10.5px] text-muted">{r.approved_by_name}</span>}</td>
                <td className="px-3"><span className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setSim(r)} title="Simula"><Calculator size={12} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setHist(r.rule_key)} title="Versions"><History size={12} /></Button>
                  {d.canManage && <Button size="sm" variant="ghost" onClick={() => setEdit(r)} title={r.status === "aprovada" ? "Crea una versió nova" : "Edita"}><PenLine size={12} /></Button>}
                  {d.isDirector && r.status === "pendent_aprovacio" && <Button size="sm" variant="primary" onClick={() => status(r, "aprovada")}><CheckCircle2 size={12} /> Aprova</Button>}
                  {d.canManage && r.status === "aprovada" && <Button size="sm" variant="ghost" onClick={() => status(r, "retirada")} title="Retira"><Trash2 size={12} /></Button>}
                </span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {edit && d && <RuleForm r={edit === "new" ? null : edit} layer={layer} users={d.users} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void load(); }} />}
      {sim && <Simulator r={sim} onClose={() => setSim(null)} />}
      {hist && d && <Modal open onClose={() => setHist(null)} title={`Versions · ${hist}`}><ul className="space-y-2 text-[12.5px]">{d.rules.filter((r) => r.rule_key === hist).sort((a, b) => b.version - a.version).map((r) => <li key={r.id} className="rounded-xl border border-line p-2.5"><div className="flex items-center gap-2"><b>v{r.version}</b><Badge tone={STONE[r.status]}>{RULE_STATUS_LABEL[r.status]}</Badge><span className="ml-auto tnum">{valueText(r)}</span></div><p className="text-[11.5px] text-muted">{fmtD(r.valid_from)} → {r.valid_to ? fmtD(r.valid_to) : "vigent"}{r.approved_by_name ? ` · aprovada per ${r.approved_by_name} el ${fmtD(r.approved_at)}` : ""}</p></li>)}</ul></Modal>}
    </div>
  );
}

function RuleForm({ r, layer, users, onClose, onDone }: { r: Rule | null; layer: Layer; users: Data["users"]; onClose: () => void; onDone: () => void }) {
  const c = (r?.conditions ?? {}) as { accrual_event?: string; include_energy?: boolean; include_power?: boolean; metric?: string; basis?: string; policy?: string; months?: number };
  const [f, setF] = useState({
    name: r?.name ?? "", layer: r?.layer ?? layer, retailer: r?.retailer ?? "", product: r?.product ?? "", service: r?.service ?? "", segment: r?.segment ?? "", beneficiary_id: r?.beneficiary_id ?? "",
    kind: (r?.kind ?? (layer === "incentiu" ? "trams_volum" : "fix_contracte")) as Kind, value: r?.value != null ? String(Number(r.value)) : "", tiers: (r?.tiers ?? [{ threshold: 5, amount: 50 }]).map((t) => ({ ...t })),
    base_formula: r?.base_formula ?? "", base_validated: r?.base_validated ?? false, valid_from: r?.valid_from ?? new Date().toISOString().slice(0, 10), valid_to: r?.valid_to ?? "", notes: r?.notes ?? "",
    accrual_event: c.accrual_event ?? "activacio", include_energy: c.include_energy !== false, include_power: !!c.include_power, metric: c.metric ?? "contractes", basis: c.basis ?? "activat", policy: c.policy ?? "maxim", months: String(c.months ?? 12),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pct = UNIT_OF[f.kind] === "pct";
  const kinds = f.layer === "incentiu" ? (["trams_volum", "bonificacio"] as Kind[]) : KINDS.filter((k) => k !== "trams_volum");
  const save = async () => {
    setBusy(true); setErr(null);
    const conditions = f.kind === "trams_volum" ? { metric: f.metric, basis: f.basis, policy: f.policy, period: "mes" } : f.kind === "retrocessio" ? { months: Number(f.months) || 12 } : { accrual_event: f.accrual_event, ...(f.kind === "pct_marge" ? { include_energy: f.include_energy, include_power: f.include_power } : {}) };
    try {
      await fApi.act("rule_save", { id: r?.id, data: { name: f.name, layer: f.layer, retailer: f.retailer || null, product: f.product || null, service: f.service || null, segment: f.segment || null, beneficiary_id: f.beneficiary_id || null, kind: f.kind, value: f.kind === "trams_volum" ? null : f.value.replace(",", ".") || null, tiers: f.kind === "trams_volum" ? f.tiers : null, conditions, base_formula: f.base_formula || null, base_validated: f.base_validated, valid_from: f.valid_from, valid_to: f.valid_to || null, notes: f.notes || null } });
      toast(r?.status === "aprovada" ? "S'ha creat una versió nova pendent d'aprovació" : "Regla desada", "Cal que Direcció l'aprovi abans que compti com a definitiva.");
      onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={r ? (r.status === "aprovada" || r.status === "retirada" ? `Nova versió de «${r.name}»` : `Edita «${r.name}»`) : "Nova regla de comissió"} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.name.trim() || (f.kind !== "trams_volum" && !f.value)} onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-3">
        <label className="block sm:col-span-2"><span className="label">Nom *</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="block"><span className="label">Capa</span><select className="input" value={f.layer} disabled={!!r} onChange={(e) => setF({ ...f, layer: e.target.value as Layer, kind: e.target.value === "incentiu" ? "trams_volum" : "fix_contracte" })}>{LAYERS.map((l) => <option key={l} value={l}>{LAYER_LABEL[l]}</option>)}</select></label>
        <label className="block"><span className="label">Comercialitzadora</span><input className="input" placeholder="Totes" value={f.retailer} onChange={(e) => setF({ ...f, retailer: e.target.value })} /></label>
        <label className="block"><span className="label">Producte / modalitat</span><input className="input" placeholder="Tots" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></label>
        <label className="block"><span className="label">Servei</span><select className="input" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">Tots</option>{SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select></label>
        <label className="block"><span className="label">Segment</span><select className="input" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })}><option value="">Tots</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}</select></label>
        {f.layer !== "proveidor" && <label className="block"><span className="label">Només per a</span><select className="input" value={f.beneficiary_id} onChange={(e) => setF({ ...f, beneficiary_id: e.target.value })}><option value="">Tothom</option>{users.filter((u) => (f.layer === "collaborador" ? u.role === "colaborador" : u.role === "comercial")).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
        <label className="block"><span className="label">Tipus</span><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
        {f.kind !== "trams_volum" && <label className="block"><span className="label">Valor ({UNIT_OF[f.kind] === "pct" ? "%" : UNIT_OF[f.kind] === "eur_mwh" ? "€/MWh" : "€"}) *</span><input className="input tnum" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>}
        {f.kind !== "trams_volum" && f.kind !== "retrocessio" && <label className="block"><span className="label">Es merita</span><select className="input" value={f.accrual_event} onChange={(e) => setF({ ...f, accrual_event: e.target.value })}><option value="activacio">En activar-se el contracte</option><option value="cobrament_proveidor">Quan cobra Assessoria 3.0</option><option value="manual">Manualment</option></select></label>}
        {f.kind === "retrocessio" && <label className="block"><span className="label">Termini (mesos des de l&apos;activació)</span><input className="input tnum" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value.replace(/\D/g, "") })} /></label>}
        {f.kind === "trams_volum" && (
          <div className="space-y-2 sm:col-span-3">
            <div className="grid grid-cols-3 gap-3">
              <label className="block"><span className="label">Es compten</span><select className="input" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}><option value="contractes">Contractes</option><option value="mwh">MWh elegibles</option></select></label>
              <label className="block"><span className="label">Criteri</span><select className="input" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })}><option value="signat">Signats</option><option value="activat">Activats</option><option value="meritat">Meritats</option></select></label>
              <label className="block"><span className="label">Política</span><select className="input" value={f.policy} onChange={(e) => setF({ ...f, policy: e.target.value })}><option value="maxim">Només el tram més alt</option><option value="acumulat">Suma de trams (cal confirmació de Direcció)</option></select></label>
            </div>
            <span className="label">Trams (mensuals)</span>
            {f.tiers.map((t, i) => <div key={i} className="flex items-center gap-2"><input className="input w-28 tnum" value={t.threshold} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, threshold: Number(e.target.value.replace(",", ".")) || 0 } : x)) })} aria-label="Llindar" /><span className="text-muted">→</span><input className="input w-28 tnum" value={t.amount} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(",", ".")) || 0 } : x)) })} aria-label="Import" /><span className="text-muted">€</span><button aria-label="Elimina el tram" onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })}><Trash2 size={13} className="text-muted" /></button></div>)}
            <button className="text-[12.5px] text-brand" onClick={() => setF({ ...f, tiers: [...f.tiers, { threshold: 0, amount: 0 }] })}>+ Tram</button>
          </div>
        )}
        {pct && f.kind !== "retrocessio" && (
          <div className="space-y-2 rounded-xl border border-pend/40 bg-pend/[0.04] p-3 sm:col-span-3">
            <label className="block"><span className="label">Base de càlcul (fórmula explícita) *</span><textarea className="input min-h-[60px]" value={f.base_formula} onChange={(e) => setF({ ...f, base_formula: e.target.value })} placeholder="Ex.: (increment €/kWh × kWh elegibles) + (increment €/kW·dia × kW × dies)" /></label>
            {f.kind === "pct_marge" && <div className="flex gap-4"><label className="flex items-center gap-2"><input type="checkbox" checked={f.include_energy} onChange={(e) => setF({ ...f, include_energy: e.target.checked })} /> Inclou energia</label><label className="flex items-center gap-2"><input type="checkbox" checked={f.include_power} onChange={(e) => setF({ ...f, include_power: e.target.checked })} /> Inclou potència</label></div>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.base_validated} onChange={(e) => setF({ ...f, base_validated: e.target.checked })} /> La base està validada segons l&apos;acord vigent</label>
            <p className="text-[11.5px] text-muted">Sense base validada, el càlcul queda «Pendent de configuració» i la regla no es pot aprovar.</p>
          </div>
        )}
        <label className="block"><span className="label">Vigent des de</span><input type="date" className="input" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></label>
        <label className="block"><span className="label">Fins a</span><input type="date" className="input" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></label>
        <label className="block sm:col-span-3"><span className="label">Notes</span><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {err && <div className="sm:col-span-3"><Notice tone="red">{err}</Notice></div>}
      </div>
    </Modal>
  );
}

function Simulator({ r, onClose }: { r: Rule; onClose: () => void }) {
  const [f, setF] = useState({ eligibleMwh: "200", annualKwh: "", energyIncrementEurKwh: "", powerIncrementEurKwDay: "", powerKw: "", months: "12", providerAmount: "", value: "10" });
  const [res, setRes] = useState<{ status: string; amount: string | null; formula: string; breakdown: { label: string; value: string }[] } | null>(null);
  const run = async () => {
    try {
      setRes(await fApi.act("simulate", { data: { ruleId: r.id, facts: { retailer: r.retailer ?? "", product: r.product, service: r.service, segment: r.segment, eligibleMwh: f.eligibleMwh || null, annualKwh: f.annualKwh || null, energyIncrementEurKwh: f.energyIncrementEurKwh || null, powerIncrementEurKwDay: f.powerIncrementEurKwDay || null, powerKw: f.powerKw ? f.powerKw.split(/[\s;]+/).map(Number) : null, months: Number(f.months) || 12, providerAmount: f.providerAmount || null, value: Number(f.value) } } }));
    } catch (e) { toast("No s'ha pogut simular", errMsg(e), "err"); }
  };
  const field = (k: keyof typeof f, l: string) => <label className="block"><span className="label">{l}</span><input className="input tnum" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Modal open onClose={onClose} title={`Simulador · ${r.name}`} footer={<><Button variant="ghost" onClick={onClose}>Tanca</Button><Button variant="primary" onClick={run}><Calculator size={13} /> Simula</Button></>}>
      <div className="space-y-3 text-[13px]">
        <div className="grid gap-2 sm:grid-cols-3">
          {r.kind === "trams_volum" ? field("value", "Contractes o MWh del període") : <>{field("eligibleMwh", "MWh elegibles")}{field("annualKwh", "o consum anual (kWh)")}{field("months", "Mesos")}{field("energyIncrementEurKwh", "Increment €/kWh")}{field("powerIncrementEurKwDay", "Increment €/kW·dia")}{field("powerKw", "kW per període (separats per espais)")}{field("providerAmount", "Comissió del proveïdor (€)")}</>}
        </div>
        {res && <div className={cn("rounded-xl border p-3", res.amount ? "border-ren/40 bg-ren/[0.04]" : "border-pend/40 bg-pend/[0.04]")}><p className="text-[18px] font-semibold tnum">{res.amount ? eur(res.amount) : "Sense import"}</p><p className="text-[12px] text-muted">{res.formula}</p><ul className="mt-1 text-[11.5px]">{res.breakdown.map((b, i) => <li key={i}>{b.label}: {b.value}</li>)}</ul><p className="mt-1 text-[11px] text-muted">Simulació aritmètica: no és cap cobrament ni pagament.</p></div>}
      </div>
    </Modal>
  );
}
