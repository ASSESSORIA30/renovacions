"use client";
/** CONTROL ECONÒMIC: panell financer, rendibilitat i rànquing. Diferencia sempre estimat, meritat, confirmat i cobrat. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, BadgeEuro, Banknote, CircleDollarSign, FileWarning, Filter, Gauge, Hourglass, Info, Landmark, RefreshCw, Scale, Target, TrendingUp, Trophy, Wallet, X } from "lucide-react";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { Button, Empty, Notice, Tabs, cn } from "../../components/ui";
import { eur, fApi, ym } from "./api";
import { ContractEconomicsDialog } from "./ContractEconomics";
import { ExportButton } from "../../components/ExportButton";

type Dash = {
  range: { from: string; to: string };
  kpis: Record<"estimated" | "accrued" | "invoiced" | "confirmed" | "collected" | "pending" | "payoutsComercial" | "payoutsCollab" | "payoutsAccrued" | "marginForecast" | "marginRealized" | "adjustments" | "costs", string> & { pendingSettlementContracts: number; simulations: number; pendingConfig: number };
  series: { month: string; estimat: number; meritat: number; confirmat: number; cobrat: number; comissions: number }[];
  forecast: { nextMonth: string; method: string; pendingToCollect: string };
  pendingCollection: { contract_id: string; client: string; retailer: string; pending: string }[];
  unsettled: { beneficiary_id: string; name: string | null; layer: string; amount: string; count: number }[];
  alerts: { key: string; title: string; body: string | null; link: { view: string; params: Record<string, string> } }[];
  filters: { retailers: string[]; people: { id: string; name: string; role: string }[] };
};
const PERIODS = [["dia", "Dia"], ["setmana", "Setmana"], ["mes", "Mes"], ["trimestre", "Trimestre"], ["any", "Any"]] as const;

export function FinanceDashboardView() {
  const me = useApp((s) => s.snap!.me);
  const params = useApp((s) => s.params);
  const [tab, setTab] = useState<"resum" | "rendibilitat" | "ranquing">((params.tab as "resum") ?? "resum");
  useEffect(() => { if (params.tab) setTab(params.tab as "resum"); }, [params.tab]);
  const [contract, setContract] = useState<string | null>(params.contract ?? null);
  useEffect(() => { if (params.contract) setContract(params.contract); }, [params.contract]);
  if (!isStaff(me.role)) return <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6"><RankingTab /></div>;
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="float-right flex gap-2"><ExportButton set="comissions" label="Comissions a Excel" /><ExportButton set="moviments_economics" label="Moviments a Excel" /></div>
      <div><h2 className="text-xl font-semibold tracking-tight">Control econòmic</h2><p className="text-[13px] text-muted">Comissions, cobraments, liquidacions i rendibilitat. Els imports estimats no són ingressos confirmats.</p></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: "resum", label: "Panell financer" }, { id: "rendibilitat", label: "Rendibilitat" }, { id: "ranquing", label: "Rendiment i objectius" }]} />
      {tab === "resum" && <Summary onContract={setContract} />}
      {tab === "rendibilitat" && <Profitability onContract={setContract} />}
      {tab === "ranquing" && <RankingTab />}
      {contract && <ContractEconomicsDialog contractId={contract} onClose={() => setContract(null)} />}
    </div>
  );
}

function useFilters() {
  const [f, setF] = useState({ g: "mes", owner: "", collaborator: "", retailer: "", product: "", cstatus: "", pay: "" });
  return { f, setF };
}
function FilterBar({ f, setF, people, retailers }: { f: ReturnType<typeof useFilters>["f"]; setF: ReturnType<typeof useFilters>["setF"]; people: Dash["filters"]["people"]; retailers: string[] }) {
  const [more, setMore] = useState(false);
  const n = ["owner", "collaborator", "retailer", "product", "cstatus", "pay"].filter((k) => f[k as keyof typeof f]).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line p-0.5 text-[12.5px]" role="radiogroup" aria-label="Període">{PERIODS.map(([k, l]) => <button key={k} role="radio" aria-checked={f.g === k} onClick={() => setF({ ...f, g: k })} className={cn("rounded-lg px-3 py-1", f.g === k ? "bg-ink/[0.07] font-medium" : "text-muted")}>{l}</button>)}</div>
        <button onClick={() => setMore(!more)} className={cn("pressable flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12.5px]", more || n ? "border-brand/60 text-brand" : "border-line text-muted")}><Filter size={13} /> Filtres{n ? ` (${n})` : ""}</button>
        {n > 0 && <button className="flex items-center gap-1 text-[12px] text-muted" onClick={() => setF({ ...f, owner: "", collaborator: "", retailer: "", product: "", cstatus: "", pay: "" })}><X size={12} /> Neteja</button>}
      </div>
      {more && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-line bg-surface p-2.5">
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Comercial" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}><option value="">Tots els comercials</option>{people.filter((p) => p.role === "comercial").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Col·laborador" value={f.collaborator} onChange={(e) => setF({ ...f, collaborator: e.target.value })}><option value="">Tots els col·laboradors</option>{people.filter((p) => p.role === "colaborador").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Comercialitzadora" value={f.retailer} onChange={(e) => setF({ ...f, retailer: e.target.value })}><option value="">Totes les comercialitzadores</option>{retailers.map((r) => <option key={r}>{r}</option>)}</select>
          <input className="input h-9 w-40 text-[12.5px]" placeholder="Producte" aria-label="Producte" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} />
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Estat del contracte" value={f.cstatus} onChange={(e) => setF({ ...f, cstatus: e.target.value })}><option value="">Tots els estats</option>{["actiu", "renovacio_pendent", "finalitzat", "anullat", "en_tramitacio"].map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input h-9 w-auto text-[12.5px]" aria-label="Estat de cobrament" value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })}><option value="">Qualsevol cobrament</option><option value="cobrat">Cobrat</option><option value="parcial">Parcial</option><option value="pendent">Pendent</option></select>
        </div>
      )}
    </div>
  );
}

function Summary({ onContract }: { onContract: (id: string) => void }) {
  const { f, setF } = useFilters();
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await fApi.get<Dash>("dashboard", f)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, [f]);
  useEffect(() => { void load(); }, [load]);
  const go = useApp((s) => s.navigate);
  const k = d?.kpis;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <FilterBar f={f} setF={setF} people={d?.filters.people ?? []} retailers={d?.filters.retailers ?? []} />
        <div className="flex items-center gap-2 text-[12px] text-muted">{d && <span>{d.range.from} → {d.range.to}</span>}<Button size="sm" onClick={() => void load()}><RefreshCw size={13} /> Actualitza</Button></div>
      </div>
      {err && <Notice tone="red">{err}</Notice>}
      {k && (k.simulations > 0 || k.pendingConfig > 0) && <Notice tone="amber">{k.simulations > 0 ? `${k.simulations} càlcul(s) són simulacions amb regles pendents d'aprovació (no compten com a estimat definitiu). ` : ""}{k.pendingConfig > 0 ? `${k.pendingConfig} contracte(s) tenen el càlcul pendent de configuració o de dades.` : ""}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={<Gauge size={15} />} label="Comissions estimades" value={k?.estimated} hint="Previsió amb regles aprovades. No és cap ingrés." tone="text-muted" />
        <Kpi icon={<BadgeEuro size={15} />} label="Meritades" value={k?.accrued} hint="Dret de cobrament reconegut (contracte activat)" />
        <Kpi icon={<Landmark size={15} />} label="Confirmades pel proveïdor" value={k?.confirmed} hint={`Facturades: ${eur(k?.invoiced)}`} />
        <Kpi icon={<CircleDollarSign size={15} />} label="Cobrades" value={k?.collected} hint="Ingressos confirmats al banc" tone="text-ren" strong />
        <Kpi icon={<Hourglass size={15} />} label="Pendents de cobrar" value={k?.pending} hint="Acumulat, no només el període" tone={k && Number(k.pending) > 0 ? "text-pend" : undefined} strong />
        <Kpi icon={<Wallet size={15} />} label="Pagat a comercials" value={k?.payoutsComercial} />
        <Kpi icon={<Wallet size={15} />} label="Pagat a col·laboradors" value={k?.payoutsCollab} />
        <Kpi icon={<TrendingUp size={15} />} label="Marge previst" value={k?.marginForecast} hint="Estimat − comissions estimades − costos" tone="text-muted" />
        <Kpi icon={<Scale size={15} />} label="Marge realitzat" value={k?.marginRealized} hint="Cobrat − comissions meritades − costos" tone={k && Number(k.marginRealized) < 0 ? "text-lost" : "text-ren"} />
        <Kpi icon={<FileWarning size={15} />} label="Ajustaments i retrocessions" value={k?.adjustments} sub={k ? `${k.pendingSettlementContracts} contractes pendents de liquidar` : undefined} />
      </div>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[13px] font-semibold">Evolució mensual (capa proveïdor) i comissions a pagar</h3>{d && <p className="text-[11.5px] text-muted">Previsió de cobrament del mes vinent: <b>{eur(d.forecast.nextMonth)}</b> · {d.forecast.method}</p>}</div>
        <div className="h-72">
          {d && <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={d.series} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e4e4e7)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(m: string) => new Date(`${m}-15`).toLocaleDateString("ca-ES", { month: "short", year: "2-digit" })} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} width={40} />
              <Tooltip formatter={(v) => eur(Number(v))} labelFormatter={(m) => String(m)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="estimat" name="Estimat" fill="#a1a1aa" radius={[3, 3, 0, 0]} />
              <Bar dataKey="meritat" name="Meritat" fill="#60a5fa" radius={[3, 3, 0, 0]} />
              <Bar dataKey="confirmat" name="Confirmat" fill="#818cf8" radius={[3, 3, 0, 0]} />
              <Bar dataKey="cobrat" name="Cobrat" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Line dataKey="comissions" name="Comissions a pagar" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-line bg-surface lg:col-span-1">
          <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold"><AlertTriangle size={15} className="text-pend" /> Alertes<span className="ml-auto text-[11px] font-normal text-muted">{d?.alerts.length ?? "…"}</span></h3>
          {!d?.alerts.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Cap alerta econòmica.</p> : <ul className="max-h-80 divide-y divide-line overflow-auto">{d.alerts.map((a) => <li key={a.key}><button className="w-full px-4 py-2 text-left hover:bg-ink/[0.03]" onClick={() => (a.link.params.contract ? onContract(a.link.params.contract) : go(a.link.view as never, a.link.params))}><p className="text-[12.5px] font-medium">{a.title}</p>{a.body && <p className="text-[11.5px] text-muted">{a.body}</p>}</button></li>)}</ul>}
        </section>
        <section className="rounded-2xl border border-line bg-surface">
          <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold"><Hourglass size={15} /> Més pendent de cobrar</h3>
          {!d?.pendingCollection.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Res pendent de cobrar.</p> : <ul className="divide-y divide-line">{d.pendingCollection.map((r) => <li key={r.contract_id}><button className="flex w-full items-center gap-2 px-4 py-2 text-left text-[12.5px] hover:bg-ink/[0.03]" onClick={() => onContract(r.contract_id)}><span className="min-w-0 flex-1 truncate">{r.client} · {r.retailer}</span><span className="font-medium text-pend tnum">{eur(r.pending)}</span></button></li>)}</ul>}
        </section>
        <section className="rounded-2xl border border-line bg-surface">
          <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold"><Banknote size={15} /> Pendent de liquidar a l&apos;equip</h3>
          {!d?.unsettled.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Tot liquidat.</p> : <ul className="divide-y divide-line">{d.unsettled.map((r) => <li key={`${r.layer}${r.beneficiary_id}`}><button className="flex w-full items-center gap-2 px-4 py-2 text-left text-[12.5px] hover:bg-ink/[0.03]" onClick={() => go("liquidacions", { tab: r.layer === "collaborador" ? "collaboradors" : "comercials" })}><span className="min-w-0 flex-1 truncate">{r.name ?? "—"} <span className="text-muted">· {r.layer === "collaborador" ? "col·laborador" : "comercial"} · {r.count} mov.</span></span><span className="font-medium tnum">{eur(r.amount)}</span></button></li>)}</ul>}
        </section>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint, sub, tone, strong }: { icon: React.ReactNode; label: string; value: string | undefined; hint?: string; sub?: string; tone?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-2xl border bg-surface p-3.5", strong ? "border-ink/15" : "border-line")} title={hint}>
      <p className="flex items-center gap-1.5 text-[12px] text-muted">{icon}{label}{hint && <Info size={11} className="opacity-60" />}</p>
      <p className={cn("mt-1 text-[22px] font-semibold tnum", tone)}>{value === undefined ? <span className="inline-block h-6 w-20 animate-pulse rounded bg-ink/[0.06]" /> : eur(value)}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

type ProfRow = { key: string; label: string; contracts: number; estimated: string; confirmed: string; collected: string; payouts: string; costs: string; margin: string | null; marginEstimated: string | null; status: string; incomplete: number };
const GROUP_LABEL = { client: "Client", contracte: "Contracte", comercial: "Comercial", collaborador: "Col·laborador", comercialitzadora: "Comercialitzadora", producte: "Producte", canal: "Canal de captació", periode: "Període (inici)" } as const;
function Profitability({ onContract }: { onContract: (id: string) => void }) {
  const { f, setF } = useFilters();
  const [group, setGroup] = useState<keyof typeof GROUP_LABEL>("client");
  const [d, setD] = useState<{ rows: ProfRow[]; note: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fApi.get<{ rows: ProfRow[]; note: string }>("profitability", { ...f, group }).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(String(e instanceof Error ? e.message : e))); }, [f, group]);
  const totals = useMemo(() => (d?.rows ?? []).reduce((a, r) => ({ collected: a.collected + Number(r.collected), payouts: a.payouts + Number(r.payouts), costs: a.costs + Number(r.costs), margin: a.margin + Number(r.margin ?? 0) }), { collected: 0, payouts: 0, costs: 0, margin: 0 }), [d]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><select className="input h-9 w-auto text-[12.5px]" aria-label="Agrupa per" value={group} onChange={(e) => setGroup(e.target.value as keyof typeof GROUP_LABEL)}>{Object.entries(GROUP_LABEL).map(([k, l]) => <option key={k} value={k}>Per {l.toLowerCase()}</option>)}</select><FilterBar f={f} setF={setF} people={[]} retailers={[]} /></div>
      {err && <Notice tone="red">{err}</Notice>}
      <Notice tone="blue">{d?.note ?? "Marge de contribució: no és el benefici net."} Si un grup no té ingressos cobrats, el marge es mostra com a estimat; si falta la comissió del proveïdor, com a incomplet.</Notice>
      <div className="overflow-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">{GROUP_LABEL[group]}</th><th className="text-right">Contractes</th><th className="text-right">Estimat</th><th className="text-right">Confirmat</th><th className="text-right">Cobrat</th><th className="text-right">Comissions</th><th className="text-right">Costos</th><th className="px-3 text-right">Marge de contribució</th></tr></thead>
          <tbody>
            {!d ? <tr><td colSpan={8} className="p-6"><div className="h-20 animate-pulse rounded bg-ink/[0.04]" /></td></tr> : !d.rows.length ? <tr><td colSpan={8} className="p-6 text-center text-muted">Sense contractes en aquest filtre.</td></tr> : d.rows.map((r) => (
              <tr key={r.key} className="border-t border-line hover:bg-ink/[0.02]">
                <td className="px-3 py-2">{group === "contracte" ? <button className="text-left text-brand hover:underline" onClick={() => onContract(r.key)}>{r.label}</button> : r.label}{r.incomplete > 0 && <span className="ml-1 text-[11px] text-pend">({r.incomplete} sense comissió del proveïdor)</span>}</td>
                <td className="text-right tnum">{r.contracts}</td><td className="text-right text-muted tnum">{eur(r.estimated)}</td><td className="text-right tnum">{eur(r.confirmed)}</td><td className="text-right tnum">{eur(r.collected)}</td><td className="text-right tnum">{eur(r.payouts)}</td><td className="text-right tnum">{eur(r.costs)}</td>
                <td className="px-3 text-right tnum">{r.margin != null ? <b className={Number(r.margin) < 0 ? "text-lost" : "text-ren"}>{eur(r.margin)}</b> : r.marginEstimated != null ? <span className="text-muted">{eur(r.marginEstimated)} <span className="text-[10.5px]">estimat</span></span> : <span className="text-pend">Incomplet</span>}</td>
              </tr>
            ))}
          </tbody>
          {d && d.rows.length > 0 && <tfoot className="border-t-2 border-line font-medium"><tr><td className="px-3 py-2">Total</td><td /><td /><td /><td className="text-right tnum">{eur(totals.collected)}</td><td className="text-right tnum">{eur(totals.payouts)}</td><td className="text-right tnum">{eur(totals.costs)}</td><td className="px-3 text-right tnum">{eur(totals.margin)}</td></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

type Rank = { month: string; rows: { id: string; name: string; contracts: number; mwh: string; generated: string; accrued: string; bonus: string; conversion: number | null; targets: { metric: string; target: string }[] }[]; isStaff: boolean; teamTargets: { scope: string; product: string | null; service: string | null; metric: string; target: string }[] };
const METRIC_LABEL: Record<string, string> = { contractes: "Contractes", mwh: "MWh", comissio_generada: "Comissió generada", comissio_meritada: "Comissió meritada", oportunitats: "Oportunitats" };
export function RankingTab() {
  const [month, setMonth] = useState(ym());
  const [d, setD] = useState<Rank | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const load = useCallback(() => fApi.get<Rank>("ranking", { month }).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(String(e instanceof Error ? e.message : e))), [month]);
  useEffect(() => { void load(); }, [load]);
  const value = (r: Rank["rows"][number], m: string) => (m === "contractes" ? r.contracts : m === "mwh" ? Number(r.mwh) : m === "comissio_generada" ? Number(r.generated) : Number(r.accrued));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><input type="month" className="input h-9 w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mes" />{d && !d.isStaff && <span className="text-[12px] text-muted">Només veus les teves dades.</span>}</div>
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <div className="h-40 animate-pulse rounded-2xl bg-elevated" /> : !d.rows.length ? <Empty icon={<Trophy size={24} />} title="Sense dades" body="Encara no hi ha comissions calculades aquest mes." /> : (
        <div className="overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">#</th><th>Comercial</th><th className="text-right">Contractes</th><th className="text-right">MWh</th><th className="text-right">Comissions generades</th><th className="text-right">Meritades</th><th className="text-right">Bonificacions</th><th className="text-right">Conversió</th><th className="px-3">Objectius</th></tr></thead>
            <tbody>{d.rows.map((r, i) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2 text-muted">{d.isStaff ? i + 1 : "—"}</td><td className="font-medium">{r.name}</td><td className="text-right tnum">{r.contracts}</td><td className="text-right tnum">{Number(r.mwh).toLocaleString("ca-ES")}</td>
                <td className="text-right tnum">{eur(r.generated)}</td><td className="text-right tnum">{eur(r.accrued)}</td><td className="text-right tnum">{eur(r.bonus)}</td><td className="text-right tnum">{r.conversion != null ? `${r.conversion} %` : "—"}</td>
                <td className="px-3">{r.targets.map((t) => { const pct = Number(t.target) ? Math.min(100, Math.round((value(r, t.metric) / Number(t.target)) * 100)) : 0; return <span key={t.metric} className="mr-2 inline-flex items-center gap-1 text-[11.5px]"><Target size={11} />{METRIC_LABEL[t.metric] ?? t.metric}: <b className={pct >= 100 ? "text-ren" : ""}>{pct} %</b></span>; })}{d.isStaff && <button className="text-[11.5px] text-brand" onClick={() => setTarget({ id: r.id, name: r.name })}>+ objectiu</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {target && <TargetDialog user={target} month={month} onClose={() => setTarget(null)} onDone={() => { setTarget(null); void load(); }} />}
    </div>
  );
}
function TargetDialog({ user, month, onClose, onDone }: { user: { id: string; name: string }; month: string; onClose: () => void; onDone: () => void }) {
  const [metric, setMetric] = useState("contractes");
  const [value, setValue] = useState("");
  const save = async () => { try { await fApi.act("target", { data: { scope: "comercial", user_id: user.id, period: month, metric, target: value ? Number(value.replace(",", ".")) : null } }); onDone(); } catch (e) { useApp.getState().toast({ title: "No s'ha pogut desar", body: String(e instanceof Error ? e.message : e), tone: "err" }); } };
  return (
    <div role="dialog" aria-label="Objectiu" className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-4 text-[13px] shadow-lift" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">Objectiu de {user.name} · {month}</h3>
        <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>{["contractes", "mwh", "comissio_generada", "comissio_meritada"].map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}</select>
        <input className="input tnum" inputMode="decimal" placeholder="Valor (buit per eliminar)" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" onClick={save}>Desa</Button></div>
      </div>
    </div>
  );
}
