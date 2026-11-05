"use client";
/** RENDIMENT COMERCIAL: indicadors reals (Supabase, amb la RLS), objectius i comparativa de l'equip (Direcció). */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2, Target } from "lucide-react";
import { SERVICES, SERVICE_COLOR, SERVICE_LABEL, STAGE_COLOR, type Kpis } from "@/core/sales";
import { supabaseConfigured } from "@/data/browserSupabase";
import { useApp } from "@/data/store";
import { Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { salesApi, eur, mwh, type Performance } from "./api";
import { useFacets } from "./shared";

type Period = "mes" | "mes_anterior" | "trimestre" | "any";
const PERIOD_LABEL: Record<Period, string> = { mes: "Aquest mes", mes_anterior: "Mes anterior", trimestre: "Aquest trimestre", any: "Aquest any" };
function range(p: Period) {
  const n = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (p === "mes") return { from: iso(new Date(n.getFullYear(), n.getMonth(), 1)), to: iso(new Date(n.getFullYear(), n.getMonth() + 1, 1)) };
  if (p === "mes_anterior") return { from: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: iso(new Date(n.getFullYear(), n.getMonth(), 1)) };
  if (p === "trimestre") { const q = Math.floor(n.getMonth() / 3) * 3; return { from: iso(new Date(n.getFullYear(), q, 1)), to: iso(new Date(n.getFullYear(), q + 3, 1)) }; }
  return { from: iso(new Date(n.getFullYear(), 0, 1)), to: iso(new Date(n.getFullYear() + 1, 0, 1)) };
}
const METRICS = [
  { key: "guanyades", label: "Contractes guanyats", value: (k: Kpis) => k.won, fmt: (n: number) => String(n) },
  { key: "mwh", label: "MWh guanyats", value: (k: Kpis) => k.mwhWon, fmt: (n: number) => mwh(n) },
  { key: "comissio", label: "Comissió guanyada", value: (k: Kpis) => k.commissionWon, fmt: (n: number) => eur(n) },
  { key: "oportunitats", label: "Oportunitats obertes", value: (k: Kpis) => k.openOpps, fmt: (n: number) => String(n) },
] as const;

export function PerformanceView() {
  const [period, setPeriod] = useState<Period>("mes");
  const [d, setD] = useState<Performance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState(false);
  const r = useMemo(() => range(period), [period]);
  const load = () => salesApi.kpis(r.from, r.to).then((x) => { setD(x); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { if (supabaseConfigured) { setD(null); void load(); } }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!supabaseConfigured) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<BarChart3 size={26} />} title="Els indicadors necessiten la base de dades" /></div>;

  const k = d?.kpis;
  const myTargets = d ? d.targets.filter((t) => t.user_id === d.me) : [];
  const teamTargets = d && d.isStaff ? d.targets : [];
  const maxFunnel = Math.max(1, ...(d?.funnel.map((f) => f.count) ?? [1]));
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-semibold tracking-tight">Rendiment comercial</h2><p className="text-[13px] text-muted">{d?.isStaff ? "Resultats globals de l'equip i comparativa per comercial." : "Els teus resultats."} Dades reals de la base de dades.</p></div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-line p-0.5 text-[12.5px]">{(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)} className={cn("rounded-lg px-2.5 py-1", period === p ? "bg-ink/[0.07] font-medium" : "text-muted")}>{PERIOD_LABEL[p]}</button>)}</div>
          {d?.isStaff && <Button onClick={() => setTargets(true)}><Target size={14} /> Objectius</Button>}
        </div>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      {!k ? <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-elevated" />)}</div> : (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
            <Tile label="Leads nous" value={String(k.leadsNew)} />
            <Tile label="Oportunitats obertes" value={String(k.openOpps)} />
            <Tile label="Propostes enviades" value={String(k.proposalsSent)} />
            <Tile label="Contractes guanyats" value={String(k.won)} tone="text-ren" />
            <Tile label="Perduts" value={String(k.lost)} tone={k.lost ? "text-lost" : ""} />
            <Tile label="Taxa de conversió" value={k.conversion == null ? "—" : `${k.conversion.toLocaleString("ca-ES")} %`} sub="guanyades / tancades" />
            <Tile label="MWh potencials" value={mwh(k.mwhOpen)} sub={`${mwh(k.mwhWeighted)} ponderats`} />
            <Tile label="Comissió estimada" value={eur(k.commissionOpen)} sub={`${eur(k.commissionWeighted)} ponderada`} />
            <Tile label="Comissió guanyada" value={eur(k.commissionWon)} sub={mwh(k.mwhWon)} tone="text-ren" />
            <Tile label="Activitats pendents" value={String(k.pendingTasks)} sub={k.overdueTasks ? `${k.overdueTasks} vençudes` : "cap vençuda"} tone={k.overdueTasks ? "text-lost" : ""} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
              <h3 className="mb-3 text-[14px] font-semibold">Embut d&apos;oportunitats obertes</h3>
              <div className="space-y-2">
                {d!.funnel.map((f) => (
                  <div key={f.stage} className="grid grid-cols-[140px_1fr_40px] items-center gap-2 text-[12.5px]">
                    <span className="text-muted">{f.label}</span>
                    <span className="h-5 overflow-hidden rounded-md bg-ink/[0.05]"><span className="block h-full rounded-md" style={{ width: `${(f.count / maxFunnel) * 100}%`, background: STAGE_COLOR[f.stage] }} /></span>
                    <span className="text-right font-medium tnum">{f.count}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="mb-3 text-[14px] font-semibold">{period === "mes" ? "Objectius del mes" : "Objectius (mes en curs)"}</h3>
              {(d!.isStaff ? teamTargets : myTargets).length === 0 ? <p className="text-[12.5px] text-muted">{d!.isStaff ? "Encara no s'han fixat objectius per a aquest mes." : "Administració encara no t'ha fixat objectius per a aquest mes."}</p> : (
                <div className="space-y-3">
                  {METRICS.map((m) => {
                    const t = (d!.isStaff ? teamTargets : myTargets).filter((x) => x.metric === m.key).reduce((a, x) => a + Number(x.target), 0);
                    if (!t) return null;
                    const v = m.value(k);
                    const pct = Math.min(100, Math.round((v / t) * 100));
                    return (
                      <div key={m.key} className="text-[12.5px]">
                        <div className="flex justify-between"><span>{m.label}</span><span className="tnum"><b>{m.fmt(v)}</b> / {m.fmt(t)}</span></div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/[0.06]"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-ren" : "bg-brand")} style={{ width: `${pct}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-[14px] font-semibold">Per servei</h3>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
              {SERVICES.map((s) => (
                <div key={s} className="rounded-xl border border-line px-3 py-2"><p className="flex items-center gap-1.5 text-[11.5px] text-muted"><span className="h-2 w-2 rounded-full" style={{ background: SERVICE_COLOR[s] }} />{SERVICE_LABEL[s]}</p><p className="text-[13px]"><b className="tnum">{d!.byService[s]?.open ?? 0}</b> obertes · <b className="tnum text-ren">{d!.byService[s]?.won ?? 0}</b> guanyades</p></div>
              ))}
            </div>
          </section>

          {d!.isStaff && (
            <section className="overflow-x-auto rounded-2xl border border-line bg-surface">
              <h3 className="px-4 pt-4 text-[14px] font-semibold">Comparativa de comercials</h3>
              {d!.team.length === 0 ? <p className="px-4 pb-4 pt-2 text-[12.5px] text-muted">Encara no hi ha oportunitats assignades.</p> : (
                <table className="mt-2 w-full min-w-[900px] text-[12.5px]">
                  <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 text-left">Comercial</th><th className="px-3 py-2 text-right">Leads nous</th><th className="px-3 py-2 text-right">Obertes</th><th className="px-3 py-2 text-right">Propostes</th><th className="px-3 py-2 text-right">Guanyades</th><th className="px-3 py-2 text-right">Perdudes</th><th className="px-3 py-2 text-right">Conversió</th><th className="px-3 py-2 text-right">MWh potencials</th><th className="px-3 py-2 text-right">Comissió ponderada</th><th className="px-3 py-2 text-right">Pendents</th></tr></thead>
                  <tbody>
                    {d!.team.map((t) => (
                      <tr key={t.id} className="border-t border-line">
                        <td className="px-4 py-2 font-medium">{t.name}</td>
                        <td className="px-3 py-2 text-right tnum">{t.kpis.leadsNew}</td>
                        <td className="px-3 py-2 text-right tnum">{t.kpis.openOpps}</td>
                        <td className="px-3 py-2 text-right tnum">{t.kpis.proposalsSent}</td>
                        <td className="px-3 py-2 text-right font-medium tnum text-ren">{t.kpis.won}</td>
                        <td className="px-3 py-2 text-right tnum">{t.kpis.lost}</td>
                        <td className="px-3 py-2 text-right tnum">{t.kpis.conversion == null ? "—" : `${t.kpis.conversion} %`}</td>
                        <td className="px-3 py-2 text-right tnum">{mwh(t.kpis.mwhOpen)}</td>
                        <td className="px-3 py-2 text-right tnum">{eur(t.kpis.commissionWeighted)}</td>
                        <td className={cn("px-3 py-2 text-right tnum", t.kpis.overdueTasks && "text-lost")}>{t.kpis.pendingTasks}{t.kpis.overdueTasks ? ` (${t.kpis.overdueTasks} venç.)` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}
      {targets && d && <TargetsEditor current={d.targets} onClose={() => setTargets(false)} onSaved={() => { setTargets(false); void load(); }} />}
    </div>
  );
}

const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
  <div className="rounded-2xl border border-line bg-surface p-3.5"><p className="text-[12px] text-muted">{label}</p><p className={cn("text-xl font-semibold tnum", tone)}>{value}</p>{sub && <p className="text-[11px] text-muted">{sub}</p>}</div>
);

function TargetsEditor({ current, onClose, onSaved }: { current: Performance["targets"]; onClose: () => void; onSaved: () => void }) {
  const facets = useFacets();
  const period = new Date().toISOString().slice(0, 7);
  const people = (facets?.users ?? []).filter((u) => u.role === "comercial");
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(current.filter((t) => t.period === period).map((t) => [`${t.user_id}|${t.metric}`, String(t.target)])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      for (const p of people) for (const m of METRICS) {
        const key = `${p.id}|${m.key}`;
        const v = vals[key];
        const prev = current.find((t) => t.user_id === p.id && t.metric === m.key && t.period === period);
        const num = v === undefined || v === "" ? null : Number(v.replace(",", "."));
        if ((prev ? Number(prev.target) : null) === num) continue;
        await salesApi.target({ userId: p.id, period, metric: m.key, target: num });
      }
      useApp.getState().toast({ title: "Objectius desats", tone: "ok" });
      onSaved();
    } catch (e) { useApp.getState().toast({ title: "Error", body: String(e instanceof Error ? e.message : e), tone: "err" }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={`Objectius de ${new Date().toLocaleDateString("ca-ES", { month: "long", year: "numeric" })}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      {people.length === 0 ? <p className="text-[13px] text-muted">No hi ha usuaris amb rol comercial.</p> : (
        <table className="w-full text-[12.5px]">
          <thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="py-1.5 text-left">Comercial</th>{METRICS.map((m) => <th key={m.key} className="px-2 text-left">{m.label}</th>)}</tr></thead>
          <tbody>{people.map((p) => <tr key={p.id} className="border-t border-line"><td className="py-1.5 font-medium">{p.name}</td>{METRICS.map((m) => <td key={m.key} className="px-2 py-1.5"><input className="input h-8 tnum" inputMode="decimal" aria-label={`${m.label} de ${p.name}`} value={vals[`${p.id}|${m.key}`] ?? ""} onChange={(e) => setVals({ ...vals, [`${p.id}|${m.key}`]: e.target.value })} /></td>)}</tr>)}</tbody>
        </table>
      )}
    </Modal>
  );
}
