"use client";
/**
 * FASE 14 · AUDITOR DE COMISSIONS. Conciliació de doble sentit:
 *  - del CRM cap a la comercialitzadora: què ens haurien d'haver liquidat i no apareix (o apareix per sota o tard);
 *  - de la comercialitzadora cap al CRM: línies sense contracte, duplicades i retrocomissions inesperades.
 * Cada comissió mostra separats PREVISTA · LIQUIDADA · COBRADA · RECLAMADA. Res no s'envia sense autorització.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Banknote, CheckCircle2, CircleDollarSign, FileWarning, Filter, Gavel, Landmark, Loader2, RefreshCw, Scale, SearchX, Undo2, Wallet } from "lucide-react";
import { AUDIT_ALERTS, AUDIT_ALERT_LABEL, SITUATION_LABEL, type AlertItem, type AuditAlert, type CommissionState, type OrphanLine, type Situation } from "@/core/commission-audit";
import { MOVEMENT_LABEL, type MovementType } from "@/core/settlement-reader";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { CupsLink } from "../../components/Navigation";
import { ContractEconomicsDialog } from "./ContractEconomics";
import { eur, fApi, fmtD } from "./api";

const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Kpis = { prevista: string; liquidada: string; cobrada: string; reclamada: string; recuperada: string; pendentLiquidar: string; pendentCobrar: string; retrocomissions: string; diferencies: string; claimable: string; senseContracte: { count: number; amount: string }; counts: Record<AuditAlert, number> };
type Claimable = { key: string; amount: string; kind: string; client: string | null; cups: string | null; reason: string };
type Group = { retailer: string; terms: { paymentDays: number | null; claimDays: number | null }; kpis: Kpis; warnings: string[]; commissions: CommissionState[]; lines: OrphanLine[]; alerts: AlertItem[]; claimable: Claimable[] };
type Data = { from: string; to: string; retailer: string | null; retailers: string[]; kpis: Kpis; groups: Group[]; alertsEnabled: Record<AuditAlert, boolean>; canEdit: boolean };

const ATONE: Record<AuditAlert, "red" | "amber" | "blue" | "zinc"> = { pendent_liquidar: "amber", liquidada_inferior: "red", cobrada_parcial: "amber", retro_inesperada: "red", liquidacio_duplicada: "zinc", sense_contracte: "zinc", cobrament_fora_termini: "amber" };
const STONE: Partial<Record<Situation, "red" | "amber" | "blue" | "green" | "zinc">> = { correcta: "green", cobrada: "green", pendent_liquidar: "amber", inferior: "red", superior: "blue", liquidada_tard: "amber", pendent_cobrament: "blue", cobrada_parcial: "amber", cobrament_fora_termini: "amber", reclamada: "blue", sense_regla: "zinc", retrocessio: "red", anullada: "zinc", dins_termini: "zinc", ajornada: "zinc" };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const yearAgo = () => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1); return iso(d); };

export function AuditorView() {
  const params = useApp((s) => s.params);
  const go = useApp((s) => s.navigate);
  const [f, setF] = useState(() => ({ retailer: params.retailer ?? "", from: yearAgo(), to: iso(new Date()) }));
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<"" | AuditAlert>("");
  const [tab, setTab] = useState<"comissions" | "linies" | "alertes">("comissions");
  const [open, setOpen] = useState<string | null>(null);
  const [claimFor, setClaimFor] = useState<Group | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setD(await fApi.get<Data>("audit", f)); setErr(null); } catch (e) { setErr(errMsg(e)); } finally { setLoading(false); }
  }, [f]);
  useEffect(() => { void load(); }, [load]);
  const k = d?.kpis;
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Gavel size={20} className="text-brand" /> Auditor de comissions</h2>
          <p className="text-[13px] text-muted">Què ens correspon cobrar, què ens han liquidat, què hem cobrat de debò i què hem de reclamar a cada comercialitzadora.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-[12.5px]">
          <label><span className="label">Comercialitzadora</span><select className="input" value={f.retailer} onChange={(e) => setF({ ...f, retailer: e.target.value })}><option value="">Totes</option>{d?.retailers.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label><span className="label">Des de</span><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label><span className="label">Fins a</span><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <Button onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Torna a auditar</Button>
        </div>
      </div>
      <Notice tone="blue">Una línia d&apos;una liquidació no és un cobrament: una comissió només consta com a <b>cobrada</b> quan s&apos;ha confirmat el cobrament bancari a <button className="font-medium underline" onClick={() => go("conciliacio")}>Conciliació</button>. Les reclamacions sempre passen per revisió i autorització abans d&apos;enviar-se.</Notice>
      {err && <Notice tone="red">{err}</Notice>}
      {!d || !k ? <div className="h-60 animate-pulse rounded-2xl bg-elevated" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" data-testid="kpis-auditor">
            <Kpi icon={<CircleDollarSign size={15} />} label="Prevista" value={k.prevista} hint="Segons les regles de la capa proveïdor" />
            <Kpi icon={<Landmark size={15} />} label="Liquidada" value={k.liquidada} hint="El que la comercialitzadora declara" />
            <Kpi icon={<Banknote size={15} />} label="Cobrada" value={k.cobrada} tone="ren" hint="Confirmada amb el banc" />
            <Kpi icon={<FileWarning size={15} />} label="Reclamada" value={k.reclamada} hint={`Recuperat ${eur(k.recuperada)}`} />
            <Kpi icon={<AlertTriangle size={15} />} label="Pendent de liquidar" value={k.pendentLiquidar} tone="pend" hint="Termini vençut" />
            <Kpi icon={<Wallet size={15} />} label="Pendent de cobrament" value={k.pendentCobrar} hint="Liquidat i no cobrat" />
            <Kpi icon={<Undo2 size={15} />} label="Retrocomissions" value={k.retrocomissions} tone="lost" />
            <Kpi icon={<SearchX size={15} />} label="Sense contracte" value={k.senseContracte.amount} hint={`${k.senseContracte.count} moviments`} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Alertes">
            <Filter size={13} className="text-muted" />
            <button onClick={() => setAlert("")} className={cn("rounded-full border px-2.5 py-1 text-[12px]", !alert ? "border-brand bg-brand/10 font-medium" : "border-line")}>Totes</button>
            {AUDIT_ALERTS.map((a) => (
              <button key={a} onClick={() => { setAlert(a); setTab(a === "sense_contracte" || a === "liquidacio_duplicada" || a === "retro_inesperada" ? "linies" : "comissions"); }} className={cn("rounded-full border px-2.5 py-1 text-[12px]", alert === a ? "border-brand bg-brand/10 font-medium" : "border-line", !k.counts[a] && "opacity-50")}>
                {AUDIT_ALERT_LABEL[a]} <b className="tnum">{k.counts[a]}</b>
              </button>
            ))}
          </div>
          {!d.groups.length ? <Empty icon={<Scale size={24} />} title="No hi ha liquidacions en aquest període" body="Importa les liquidacions de les comercialitzadores a Conciliació per començar l'auditoria." /> : d.groups.map((g) => (
            <section key={g.retailer} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
              <header className="flex flex-wrap items-center gap-3">
                <h3 className="text-[15px] font-semibold">{g.retailer}</h3>
                <span className="text-[12px] text-muted">Termini de pagament: {g.terms.paymentDays != null ? `${g.terms.paymentDays} dies (aprovat)` : "sense termini aprovat · s'usen els dies per defecte de l'alerta"}</span>
                <span className="flex-1" />
                <span className="text-[12.5px]">Reclamable: <b className="tnum">{eur(g.kpis.claimable)}</b></span>
                {d.canEdit && <Button size="sm" variant="primary" disabled={!g.claimable.length} onClick={() => setClaimFor(g)}><FileWarning size={13} /> Generar reclamació a comercialitzadora</Button>}
              </header>
              {g.warnings.map((w) => <Notice key={w} tone="amber">{w}</Notice>)}
              <div className="flex gap-1 border-b border-line text-[12.5px]">
                {([["comissions", `Comissions (${g.commissions.length})`], ["linies", `Moviments a revisar (${g.lines.length})`], ["alertes", `Alertes (${g.alerts.length})`]] as const).map(([t, l]) => <button key={t} onClick={() => setTab(t)} className={cn("-mb-px border-b-2 px-3 py-1.5", tab === t ? "border-brand font-medium" : "border-transparent text-muted")}>{l}</button>)}
              </div>
              {tab === "comissions" && <CommissionTable rows={g.commissions.filter((c) => !alert || c.alerts.includes(alert))} onOpen={setOpen} />}
              {tab === "linies" && <LinesTable rows={g.lines.filter((l) => !alert || l.alerts.includes(alert))} />}
              {tab === "alertes" && (
                <ul className="divide-y divide-line text-[12.5px]">{g.alerts.filter((a) => !alert || a.type === alert).map((a) => (
                  <li key={a.key} className="flex flex-wrap items-start gap-2 py-2">
                    <Badge tone={ATONE[a.type]}>{AUDIT_ALERT_LABEL[a.type]}</Badge>
                    <span className="min-w-0 flex-1"><b>{a.title}</b><span className="block text-muted">{a.detail}</span></span>
                    <span className="tnum">{eur(a.amount)}</span>
                    {a.claimable && <Badge tone="green">Reclamable</Badge>}
                    {a.contractId && <Button size="sm" variant="ghost" onClick={() => setOpen(a.contractId)}><ArrowUpRight size={12} /> Contracte</Button>}
                  </li>
                ))}{!g.alerts.length && <li className="py-3 text-muted">Cap alerta: tot quadra en aquest període.</li>}</ul>
              )}
            </section>
          ))}
        </>
      )}
      {open && <ContractEconomicsDialog contractId={open} onClose={() => setOpen(null)} />}
      {claimFor && d && <ClaimDialog g={claimFor} from={d.from} to={d.to} onClose={() => setClaimFor(null)} onDone={(id) => { setClaimFor(null); go("reclamacions", { id }); }} />}
    </div>
  );
}

function Kpi({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: "ren" | "pend" | "lost" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">{icon}{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tnum", tone === "ren" && "text-ren", tone === "pend" && "text-pend", tone === "lost" && "text-lost")}>{eur(value)}</p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function CommissionTable({ rows, onOpen }: { rows: CommissionState[]; onOpen: (id: string) => void }) {
  if (!rows.length) return <p className="py-4 text-[12.5px] text-muted">Cap comissió amb aquest filtre.</p>;
  return (
    <div className="overflow-auto">
      <table className="w-full text-[12.5px]" data-testid="taula-comissions">
        <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="py-2">CUPS · client</th><th>Contracte</th><th className="text-right">Prevista</th><th className="text-right">Liquidada</th><th className="text-right">Cobrada</th><th className="text-right">Reclamada</th><th className="text-right">Diferència</th><th>Estat</th><th /></tr></thead>
        <tbody>{rows.map((c) => (
          <tr key={c.key} className="border-t border-line align-top">
            <td className="py-1.5">{c.cups ? <CupsLink cups={c.cups} /> : "—"}<span className="block text-[11px] text-muted">{c.client ?? "—"}</span></td>
            <td><Badge tone={c.event === "renovacio" ? "blue" : "zinc"}>{c.event === "renovacio" ? "Renovació" : "Alta"}</Badge><span className="block text-[11px] text-muted">{c.product ?? ""} · activat {fmtD(c.activated)}</span>{c.dueDate && !c.liquidada.lines && <span className="block text-[11px] text-muted">s&apos;esperava abans del {fmtD(c.dueDate)}{c.deferredUntil ? " (ajornat)" : ""}</span>}</td>
            <td className="text-right tnum">{c.prevista.amount != null ? eur(c.prevista.amount) : <span className="text-muted" title="Sense regla aprovada">—</span>}{c.prevista.status === "simulacio" && <span className="block text-[10px] text-muted">simulació</span>}</td>
            <td className="text-right tnum">{eur(c.liquidada.amount)}{Number(c.liquidada.regularitzacions) !== 0 && <span className="block text-[10.5px] text-lost">{eur(c.liquidada.regularitzacions)}</span>}{c.liquidada.last && <span className="block text-[10px] text-muted">{fmtD(c.liquidada.last)}</span>}</td>
            <td className="text-right tnum text-ren">{eur(c.cobrada.amount)}{Number(c.cobrada.pending) > 0 && <span className="block text-[10.5px] text-muted">pendent {eur(c.cobrada.pending)}</span>}</td>
            <td className="text-right tnum">{Number(c.reclamada.amount) > 0 ? <>{eur(c.reclamada.amount)}<span className="block text-[10px] text-muted">{c.reclamada.claims.join(", ")}</span></> : "—"}</td>
            <td className={cn("text-right tnum", c.difference && Number(c.difference) < 0 && "font-medium text-lost")}>{c.difference != null ? eur(c.difference) : "—"}</td>
            <td className="max-w-[220px]"><span className="flex flex-wrap gap-1">{c.situations.map((s) => <Badge key={s} tone={STONE[s] ?? "zinc"}>{SITUATION_LABEL[s]}</Badge>)}</span></td>
            <td className="text-right"><Button size="sm" variant="ghost" onClick={() => onOpen(c.contractId)} aria-label="Obre el contracte"><ArrowUpRight size={12} /></Button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function LinesTable({ rows }: { rows: OrphanLine[] }) {
  const go = useApp((s) => s.navigate);
  if (!rows.length) return <p className="py-4 text-[12.5px] text-muted">Cap moviment a revisar: totes les línies rebudes corresponen a un contracte.</p>;
  return (
    <div className="overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="py-2">Liquidació · origen</th><th>CUPS</th><th>Moviment</th><th className="text-right">Import</th><th>Alerta</th><th>Motiu</th></tr></thead>
        <tbody>{rows.map((l) => (
          <tr key={l.lineId} className="border-t border-line align-top">
            <td className="py-1.5"><span className="font-mono">{l.statementRef}</span><span className="block text-[11px] text-muted">{l.source ?? fmtD(l.received)}</span></td>
            <td>{l.cups ? <CupsLink cups={l.cups} /> : "—"}</td>
            <td>{l.movement ? MOVEMENT_LABEL[l.movement as MovementType] ?? l.movement : l.concept ?? "—"}</td>
            <td className={cn("text-right tnum", Number(l.amount) < 0 && "text-lost")}>{eur(l.amount)}</td>
            <td>{l.alerts.map((a) => <Badge key={a} tone={ATONE[a]}>{AUDIT_ALERT_LABEL[a]}</Badge>)}</td>
            <td className="max-w-[360px] text-[11.5px] text-muted">{l.reason} <button className="text-brand hover:underline" onClick={() => go("conciliacio")}>Revisa-la a Conciliació</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ClaimDialog({ g, from, to, onClose, onDone }: { g: Group; from: string; to: string; onClose: () => void; onDone: (id: string) => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(g.claimable.map((c) => c.key)));
  const [lang, setLang] = useState<"es" | "ca">("es");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = useMemo(() => g.claimable.filter((c) => sel.has(c.key)).reduce((a, c) => a + Number(c.amount), 0), [g, sel]);
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/claims", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", data: { retailer: g.retailer, from, to, keys: [...sel], lang } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      toast(`Reclamació ${j.code} preparada`, "Revisa-la i demana'n l'autorització abans d'enviar-la.");
      onDone(j.id);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={`Generar reclamació a ${g.retailer}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !sel.size} onClick={create}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Prepara la reclamació ({eur(total)})</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">El CRM prepara un únic informe PDF i un esborrany de correu amb els CUPS, les referències, els imports previstos i liquidats, les diferències i la justificació de cada cas (regla aprovada i clàusula). <b>No s&apos;envia res</b>: després cal revisar-la i autoritzar-la.</p>
        <div className="flex items-center gap-3"><label className="flex items-center gap-1.5"><input type="checkbox" checked={sel.size === g.claimable.length} onChange={(e) => setSel(e.target.checked ? new Set(g.claimable.map((c) => c.key)) : new Set())} /> Totes les discrepàncies reclamables ({g.claimable.length})</label><span className="flex-1" /><label className="flex items-center gap-1.5">Idioma <select className="input h-8 py-0" value={lang} onChange={(e) => setLang(e.target.value as "es" | "ca")}><option value="es">Castellà</option><option value="ca">Català</option></select></label></div>
        <ul className="max-h-80 divide-y divide-line overflow-auto rounded-xl border border-line">{g.claimable.map((c) => (
          <li key={c.key} className="flex items-start gap-2 px-3 py-2">
            <input type="checkbox" className="mt-1" checked={sel.has(c.key)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(c.key); else n.delete(c.key); setSel(n); }} />
            <span className="min-w-0 flex-1"><b>{c.client ?? c.cups ?? "—"}</b> <span className="font-mono text-[11px] text-muted">{c.cups}</span><span className="block text-[11.5px] text-muted">{c.reason}</span></span>
            <span className="tnum">{eur(c.amount)}</span>
          </li>
        ))}</ul>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}
