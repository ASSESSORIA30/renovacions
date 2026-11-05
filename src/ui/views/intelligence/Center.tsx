"use client";
/**
 * INTEL·LIGÈNCIA IA · AI Intelligence Center.
 * Oportunitats detectades pel motor (dades reals de la cartera), prioritzades per servei al client.
 * Estalvis i comissions són ESTIMACIONS i així es mostren; sense preu actual: «Pendent de factura o condicions actuals».
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlarmClock, BrainCircuit, CalendarClock, CheckCircle2, ChevronRight, CircleAlert, FileSignature, FileText, Filter, Gauge, Layers, ListTodo, Loader2, PiggyBank, Play, RefreshCw,
  Repeat, Settings2, ShieldOff, Sparkles, Target, TriangleAlert, UserRoundX, Wallet, X, Zap,
} from "lucide-react";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { AI_KIND_LABEL, AI_STATUS_LABEL, PENDING_PRICE, type AiKind } from "@/core/intelligence";
import { Badge, Button, Empty, Notice, Tabs, cn } from "../../components/ui";
import { aiApi, eur, fdate, type Dash, type OppItem, type Run } from "./api";
import { IntelligenceSettings } from "./Settings";

export const KIND_ICON: Record<AiKind, typeof Zap> = { renovacio: Repeat, estalvi: PiggyBank, contracte_car: TriangleAlert, potencia: Gauge, recuperacio: UserRoundX, venda_creuada: Layers, proposta_sense_resposta: AlarmClock, dades_incompletes: CircleAlert, tarifa_caducada: CalendarClock };
export const KIND_TONE: Record<AiKind, string> = { renovacio: "text-blue-600 bg-blue-500/10", estalvi: "text-green-600 bg-green-500/10", contracte_car: "text-orange-600 bg-orange-500/10", potencia: "text-violet-600 bg-violet-500/10", recuperacio: "text-zinc-600 bg-zinc-500/10", venda_creuada: "text-teal-600 bg-teal-500/10", proposta_sense_resposta: "text-amber-600 bg-amber-500/10", dades_incompletes: "text-red-600 bg-red-500/10", tarifa_caducada: "text-red-600 bg-red-500/10" };

const SHORT: Partial<Record<AiKind, string>> = { renovacio: "Renovacions", estalvi: "Estalvi", contracte_car: "Contractes cars" };
const EMPTY_F = { owner: "", client: "", retailer: "", tariff: "", province: "", kwhMin: "", kwhMax: "", savingMin: "", dueFrom: "", dueTo: "", status: "obertes", kind: "" };
type F = typeof EMPTY_F;

export function IntelligenceView() {
  const me = useApp((s) => s.snap!.me);
  const params = useApp((s) => s.params);
  const [tab, setTab] = useState<"oportunitats" | "calendari" | "execucions" | "configuracio">("oportunitats");
  const [f, setF] = useState<F>({ ...EMPTY_F, kind: params.kind ?? "" });
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const toast = useApp((s) => s.toast);
  const load = useCallback(async () => {
    try { setD(await aiApi.get<Dash>("dashboard", f)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [f]);
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [load]);
  const run = async () => {
    setRunning(true);
    try {
      const r = await aiApi.act<{ skipped?: string; stats?: Record<string, number>; errors?: number }>("run");
      if (r.skipped) toast({ title: "Anàlisi no executada", body: r.skipped, tone: "info" });
      else toast({ title: "Anàlisi completada", body: `${r.stats?.candidats ?? 0} oportunitats analitzades · ${r.stats?.noves ?? 0} noves · ${r.stats?.comparatives ?? 0} comparatives${r.errors ? ` · ${r.errors} incidències` : ""}`, tone: r.errors ? "info" : "ok" });
      await load();
    } catch (e) { toast({ title: "No s'ha pogut analitzar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setRunning(false); }
  };
  const staff = isStaff(me.role);
  const last = d?.runs?.[0];
  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand to-emerald-500 text-white shadow-sm"><BrainCircuit size={17} /></span>Intel·ligència IA</h2>
          <p className="mt-1 text-[13px] text-muted">Oportunitats detectades a la cartera real, amb comparatives deterministes i tarifes vigents. Prepara propostes; no envia res sense la teva aprovació.</p>
        </div>
        <div className="flex items-center gap-2">
          {last && <RunChip run={last} />}
          <Button size="sm" onClick={() => void load()} aria-label="Actualitza"><RefreshCw size={13} /></Button>
          {staff && <Button variant="primary" size="sm" onClick={run} disabled={running}>{running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Analitza la cartera</Button>}
        </div>
      </div>
      {err && <Notice tone="red">{err}</Notice>}
      {d && !d.migrated && <Notice tone="amber">Falta aplicar la migració <b>012_ai_intelligence.sql</b> a Supabase. Fins llavors el mòdul no té dades.</Notice>}
      <Tabs value={tab} onChange={setTab} items={[{ id: "oportunitats", label: "Oportunitats", count: d?.total ?? d?.items.length }, { id: "calendari", label: "Calendari d'accions" }, ...(staff ? [{ id: "execucions" as const, label: "Anàlisis automàtiques" }] : []), ...(d?.canConfigure ? [{ id: "configuracio" as const, label: "Configuració" }] : [])]} />
      {tab === "oportunitats" && <Overview d={d} f={f} setF={setF} />}
      {tab === "calendari" && <Calendar d={d} />}
      {tab === "execucions" && <Runs runs={d?.runs ?? []} />}
      {tab === "configuracio" && <IntelligenceSettings />}
    </div>
  );
}

function RunChip({ run }: { run: Run }) {
  const ok = run.status === "ok", partial = run.status === "parcial", busy = run.status === "en_curs";
  return (
    <span className={cn("hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] sm:inline-flex", ok ? "border-green-500/30 text-green-700 dark:text-green-300" : partial ? "border-amber-500/30 text-amber-700" : busy ? "border-blue-500/30 text-blue-700" : "border-red-500/30 text-red-700")} title={run.errors?.join("\n") || undefined}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : ok ? <CheckCircle2 size={11} /> : <CircleAlert size={11} />}
      Última anàlisi: {new Date(run.started_at).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function Overview({ d, f, setF }: { d: Dash | null; f: F; setF: (f: F) => void }) {
  const k = d?.kpis;
  const go = useApp((s) => s.navigate);
  const [shown, setShown] = useState(30);
  const set = (p: Partial<F>) => setF({ ...f, ...p });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi icon={<Sparkles size={14} />} label="Oportunitats detectades" value={k?.detected} onClick={() => setF({ ...EMPTY_F })} />
        <Kpi icon={<Target size={14} />} label="Alta prioritat" value={k?.highPriority} hint="Puntuació de servei ≥ 70" tone="text-brand" />
        <Kpi icon={<Repeat size={14} />} label="Renovacions properes" value={k?.renewals} hint="Venciments en 120 dies" onClick={() => set({ kind: "renovacio" })} />
        <Kpi icon={<PiggyBank size={14} />} label="Estalvi potencial (estimat)" value={k ? eur(k.savingEstimated, 0) : undefined} hint={k ? `${k.savingCount} oportunitats amb preu actual conegut · ${k.pendingPrice} pendents de factura` : undefined} tone="text-ren" />
        <Kpi icon={<Wallet size={14} />} label={k?.commission.scope === "own" ? "La meva comissió potencial" : "Comissió potencial A3 (estimada)"} value={k ? (k.commission.amount != null ? eur(k.commission.amount, 0) : "—") : undefined} hint={`Estimació amb regles de la Fase 4; no és meritada ni cobrada.${k?.commission.simulations ? ` ${k.commission.simulations} amb regles pendents d'aprovació (simulació).` : ""}${k && k.commission.amount == null ? " Sense regla aplicable a les alternatives recomanades." : ""}`} tone="text-muted" />
        <Kpi icon={<FileSignature size={14} />} label="Propostes preparades" value={k?.proposalsPrepared} hint={k ? `${k.proposalsSent} enviades (confirmades pel correu)` : undefined} />
        <Kpi icon={<ListTodo size={14} />} label="Tasques suggerides" value={k?.suggestedTasks} hint="Tasques automàtiques pendents" />
        <Kpi icon={<Zap size={14} />} label="Alertes energètiques" value={k?.energyAlerts} hint="Potència i tarifes caducades" onClick={() => set({ kind: "potencia" })} />
        <Kpi icon={<CircleAlert size={14} />} label="Clients sense dades suficients" value={k?.clientsWithoutData} onClick={() => set({ kind: "dades_incompletes" })} />
        <Kpi icon={<BrainCircuit size={14} />} label="Anàlisis automàtiques" value={d?.runs?.[0] ? `${d.runs[0].stats?.comparatives ?? 0} comp.` : d ? "—" : undefined} hint={d?.runs?.[0] ? `Última: ${d.runs[0].status} · ${d.runs[0].stats?.candidats ?? 0} candidats` : "Només visible per a l'equip d'administració"} />
      </div>
      <FilterBar f={f} set={set} reset={() => setF({ ...EMPTY_F })} owners={d?.owners ?? []} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-2">
          {!d ? [0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-elevated" />)
            : !d.items.length ? <Empty icon={<Sparkles size={22} />} title="Cap oportunitat amb aquests filtres" body="Quan el motor detecti renovacions, estalvis o dades a revisar, apareixeran aquí." />
            : <>
              {d.items.slice(0, shown).map((o) => <OppCard key={o.id} o={o} onOpen={() => go("ia-oportunitat", { id: o.id })} />)}
              {d.items.length > shown && <Button className="w-full" onClick={() => setShown(shown + 30)}>Mostra'n més ({d.items.length - shown})</Button>}
            </>}
        </section>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="text-[13px] font-semibold">Estalvi potencial per tipus</h3>
            <p className="text-[11.5px] text-muted">Estimat amb tarifes vigents. Les barres no inclouen els casos sense preu actual.</p>
            <div className="mt-2 h-44">
              {d && <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.savingsByKind.map((x) => ({ ...x, label: SHORT[x.kind] ?? x.label }))} margin={{ left: 0, right: 8, top: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line, #e4e4e7)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5 }} interval={0} />
                  <YAxis tick={{ fontSize: 10.5 }} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip formatter={(v) => eur(Number(v))} />
                  <Bar dataKey="estimated" name="Estalvi estimat" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>}
            </div>
            {d && d.savingsByKind.some((s) => s.pending) && <p className="mt-1 text-[11.5px] text-muted">{d.savingsByKind.reduce((a, s) => a + s.pending, 0)} oportunitats: {PENDING_PRICE.toLowerCase()}.</p>}
          </section>
          <section className="rounded-2xl border border-line bg-surface">
            <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold"><Target size={14} className="text-brand" /> Clients prioritaris</h3>
            {!d?.ranking.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Sense clients prioritaris.</p> : (
              <ol className="divide-y divide-line">
                {d.ranking.map((r, i) => (
                  <li key={r.clientId}><button className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-ink/[0.03]" onClick={() => go("client", { id: r.clientId })}>
                    <span className="w-4 text-[11px] text-muted tnum">{i + 1}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium">{r.name}</span><span className="text-[11px] text-muted">{r.count} oportunitat{r.count === 1 ? "" : "s"} · {r.kinds.map((k) => AI_KIND_LABEL[k].split(" ")[0]).join(", ")}</span></span>
                    {r.saving > 0 && <span className="text-[11.5px] text-ren tnum" title="Estalvi estimat">{eur(r.saving, 0)}</span>}
                    <ScoreDot score={r.score} />
                  </button></li>
                ))}
              </ol>
            )}
          </section>
          <MiniCalendar d={d} />
        </aside>
      </div>
    </div>
  );
}

function FilterBar({ f, set, reset, owners }: { f: F; set: (p: Partial<F>) => void; reset: () => void; owners: Dash["owners"] }) {
  const [open, setOpen] = useState(false);
  const active = (Object.keys(EMPTY_F) as (keyof F)[]).filter((k) => f[k] !== EMPTY_F[k]).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input h-9 w-56 text-[12.5px]" placeholder="Client…" aria-label="Client" value={f.client} onChange={(e) => set({ client: e.target.value })} />
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Tipus" value={f.kind} onChange={(e) => set({ kind: e.target.value })}><option value="">Tots els tipus</option>{(Object.keys(AI_KIND_LABEL) as AiKind[]).map((k) => <option key={k} value={k}>{AI_KIND_LABEL[k]}</option>)}</select>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Estat de l'oportunitat" value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="obertes">Obertes</option><option value="totes">Totes</option>{Object.entries(AI_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button onClick={() => setOpen(!open)} className={cn("pressable flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px]", open || active > 2 ? "border-brand/60 text-brand" : "border-line text-muted")}><Filter size={13} /> Més filtres</button>
        {active > 0 && <button className="flex items-center gap-1 text-[12px] text-muted" onClick={reset}><X size={12} /> Neteja</button>}
      </div>
      {open && (
        <div className="grid gap-2 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-6">
          <select className="input h-9 text-[12.5px]" aria-label="Comercial" value={f.owner} onChange={(e) => set({ owner: e.target.value })}><option value="">Tots els comercials</option><option value="meu">Les meves</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <input className="input h-9 text-[12.5px]" placeholder="Comercialitzadora" aria-label="Comercialitzadora" value={f.retailer} onChange={(e) => set({ retailer: e.target.value })} />
          <select className="input h-9 text-[12.5px]" aria-label="Tarifa" value={f.tariff} onChange={(e) => set({ tariff: e.target.value })}><option value="">Totes les tarifes</option>{["2.0TD", "3.0TD", "6.1TD", "6.2TD", "RL.1", "RL.2", "RL.3"].map((t) => <option key={t}>{t}</option>)}</select>
          <input className="input h-9 text-[12.5px]" placeholder="Província" aria-label="Província" value={f.province} onChange={(e) => set({ province: e.target.value })} />
          <div className="flex gap-1"><input className="input h-9 text-[12.5px]" inputMode="numeric" placeholder="kWh mín." aria-label="Consum anual mínim" value={f.kwhMin} onChange={(e) => set({ kwhMin: e.target.value.replace(/\D/g, "") })} /><input className="input h-9 text-[12.5px]" inputMode="numeric" placeholder="kWh màx." aria-label="Consum anual màxim" value={f.kwhMax} onChange={(e) => set({ kwhMax: e.target.value.replace(/\D/g, "") })} /></div>
          <input className="input h-9 text-[12.5px]" inputMode="numeric" placeholder="Estalvi mín. (€)" aria-label="Import d'estalvi mínim" value={f.savingMin} onChange={(e) => set({ savingMin: e.target.value.replace(/[^\d]/g, "") })} />
          <label className="flex items-center gap-1.5 text-[12px] text-muted sm:col-span-2">Renovació des de<input type="date" className="input h-9 flex-1 text-[12.5px]" aria-label="Data de renovació des de" value={f.dueFrom} onChange={(e) => set({ dueFrom: e.target.value })} /></label>
          <label className="flex items-center gap-1.5 text-[12px] text-muted sm:col-span-2">fins a<input type="date" className="input h-9 flex-1 text-[12.5px]" aria-label="Data de renovació fins a" value={f.dueTo} onChange={(e) => set({ dueTo: e.target.value })} /></label>
        </div>
      )}
    </div>
  );
}

export function ScoreDot({ score, size = 34 }: { score: number; size?: number }) {
  const r = (size - 5) / 2, c = 2 * Math.PI * r;
  const color = score >= 70 ? "#16a34a" : score >= 45 ? "#f59e0b" : "#a1a1aa";
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} title={`Puntuació de servei: ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth={3} /><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} /></svg>
      <span className="absolute text-[10.5px] font-semibold tnum">{score}</span>
    </span>
  );
}

function OppCard({ o, onOpen }: { o: OppItem; onOpen: () => void }) {
  const Icon = KIND_ICON[o.kind];
  const days = o.due_date ? Math.round((Date.parse(o.due_date) - Date.now()) / 86_400_000) : null;
  return (
    <button onClick={onOpen} className="group flex w-full items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left transition-colors hover:border-ink/20">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", KIND_TONE[o.kind])}><Icon size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold">{o.crm_clients?.name ?? o.title}</span>
          <Badge tone="zinc">{AI_KIND_LABEL[o.kind]}</Badge>
          {o.status !== "nova" && <Badge tone={o.status === "acceptada" || o.status === "guanyada" ? "green" : o.status === "descartada" || o.status === "caducada" ? "zinc" : "blue"}>{AI_STATUS_LABEL[o.status as keyof typeof AI_STATUS_LABEL] ?? o.status}</Badge>}
          {!o.contact_allowed && <Badge tone="red"><ShieldOff size={10} /> No contactar</Badge>}
          {o.data_quality === "incomplet" && o.kind !== "dades_incompletes" && <Badge tone="amber">Dades incompletes</Badge>}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{o.summary}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
          {o.crm_supplies?.cups && <span className="font-mono">{o.crm_supplies.cups.slice(0, 20)}</span>}
          {o.crm_supplies?.access_tariff && <span>{o.crm_supplies.access_tariff}</span>}
          {(o.crm_contracts?.retailer ?? o.crm_supplies?.current_retailer) && <span>{o.crm_contracts?.retailer ?? o.crm_supplies?.current_retailer}</span>}
          {o.annual_kwh && <span className="tnum">{Math.round(Number(o.annual_kwh)).toLocaleString("ca-ES")} kWh/any</span>}
          {days != null && <span className={cn("inline-flex items-center gap-1", days <= 30 && "font-medium text-pend")}><CalendarClock size={11} />{days < 0 ? `Vençut fa ${-days} d` : `${days} dies`} · {fdate(o.due_date)}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <ScoreDot score={o.score} />
        {o.saving_status === "estimat" && o.potential_saving_eur != null ? <span className="text-[12px] font-semibold text-ren tnum" title="Estalvi anual estimat (no confirmat)">−{eur(o.potential_saving_eur, 0)}<span className="font-normal text-muted">/any</span></span>
          : o.saving_status === "pendent_preu_actual" ? <span className="max-w-[140px] text-right text-[10.5px] leading-tight text-muted">{PENDING_PRICE}</span> : null}
      </span>
      <ChevronRight size={16} className="mt-2 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function Kpi({ icon, label, value, hint, tone, onClick }: { icon: React.ReactNode; label: string; value: number | string | undefined; hint?: string; tone?: string; onClick?: () => void }) {
  const C = onClick ? "button" : "div";
  return (
    <C onClick={onClick} className={cn("rounded-2xl border border-line bg-surface p-3 text-left", onClick && "pressable hover:border-ink/20")} title={hint}>
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted">{icon}<span className="truncate">{label}</span></p>
      <p className={cn("mt-1 text-[21px] font-semibold tnum", tone)}>{value === undefined ? <span className="inline-block h-6 w-14 animate-pulse rounded bg-ink/[0.06]" /> : value}</p>
      {hint && <p className="line-clamp-1 text-[10.5px] text-muted">{hint}</p>}
    </C>
  );
}

function groupByDate(items: Dash["calendar"]) {
  const m = new Map<string, Dash["calendar"]>();
  for (const i of items) m.set(i.date, [...(m.get(i.date) ?? []), i]);
  return [...m.entries()];
}

function MiniCalendar({ d }: { d: Dash | null }) {
  const go = useApp((s) => s.navigate);
  const groups = useMemo(() => groupByDate((d?.calendar ?? []).slice(0, 12)), [d]);
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold"><CalendarClock size={14} /> Properes accions</h3>
      {!groups.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Cap acció en els propers 60 dies.</p> : (
        <ul className="divide-y divide-line">{groups.map(([date, xs]) => (
          <li key={date} className="px-4 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{fdate(date)}</p>
            {xs.map((x) => <button key={x.type + x.id} className="block w-full truncate text-left text-[12.5px] hover:text-brand" onClick={() => (x.type === "oportunitat" ? go("ia-oportunitat", { id: x.id }) : go("jornada", {}))}>{x.type === "tasca" ? "☐ " : ""}{x.title}</button>)}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function Calendar({ d }: { d: Dash | null }) {
  const go = useApp((s) => s.navigate);
  const groups = useMemo(() => groupByDate(d?.calendar ?? []), [d]);
  if (!d) return <div className="h-60 animate-pulse rounded-2xl bg-elevated" />;
  if (!groups.length) return <Empty icon={<CalendarClock size={22} />} title="Cap acció programada" body="Renovacions, propostes pendents i tasques suggerides dels propers 60 dies." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map(([date, xs]) => {
        const days = Math.round((Date.parse(date) - Date.now()) / 86_400_000);
        return (
          <section key={date} className="rounded-2xl border border-line bg-surface p-3">
            <p className="flex items-baseline justify-between"><span className="text-[13px] font-semibold">{new Date(`${date}T12:00:00`).toLocaleDateString("ca-ES", { weekday: "long", day: "numeric", month: "long" })}</span><span className={cn("text-[11px]", days <= 7 ? "text-pend" : "text-muted")}>{days <= 0 ? "avui o vençut" : `d'aquí a ${days} dies`}</span></p>
            <ul className="mt-2 space-y-1">{xs.map((x) => {
              const Icon = x.type === "tasca" ? ListTodo : KIND_ICON[x.kind as AiKind] ?? FileText;
              return <li key={x.type + x.id}><button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-ink/[0.04]" onClick={() => (x.type === "oportunitat" ? go("ia-oportunitat", { id: x.id }) : go("jornada", {}))}><Icon size={13} className="shrink-0 text-muted" /><span className="truncate">{x.title}</span></button></li>;
            })}</ul>
          </section>
        );
      })}
    </div>
  );
}

function Runs({ runs }: { runs: Run[] }) {
  if (!runs.length) return <Empty icon={<Settings2 size={22} />} title="Encara no hi ha cap anàlisi" body="El motor s'executa cada dia (cron) i també manualment amb «Analitza la cartera»." />;
  const S: Record<string, string> = { candidats: "Candidats", noves: "Noves", actualitzades: "Actualitzades", comparatives: "Comparatives", recomanacions: "Recomanacions", tasques: "Tasques", avisos: "Avisos", caducades: "Caducades", esborranys: "Esborranys", purgades: "Purgades", omeses_oposicio: "Clients amb oposició (omesos)" };
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr className="border-b border-line">{["Inici", "Origen", "Estat", "Intents", "Resultat", "Incidències"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{runs.map((r) => (
          <tr key={r.id} className="align-top">
            <td className="whitespace-nowrap px-3 py-2">{new Date(r.started_at).toLocaleString("ca-ES")}</td>
            <td className="px-3 py-2">{r.trigger === "cron" ? "Programada" : r.trigger === "manual" ? "Manual" : "Esdeveniment"}</td>
            <td className="px-3 py-2"><Badge tone={r.status === "ok" ? "green" : r.status === "parcial" || r.status === "omesa" ? "amber" : r.status === "en_curs" ? "blue" : "red"}>{r.status}</Badge></td>
            <td className="px-3 py-2 tnum">{r.attempts}</td>
            <td className="px-3 py-2 text-muted">{Object.entries(r.stats ?? {}).filter(([, v]) => v).map(([k, v]) => `${S[k] ?? k}: ${v}`).join(" · ") || "—"}</td>
            <td className="px-3 py-2 text-[11.5px] text-red-700">{(r.errors ?? []).slice(0, 3).join(" · ")}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
