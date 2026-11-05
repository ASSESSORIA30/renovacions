"use client";
/**
 * DASHBOARD EXECUTIU. Tot surt de dades reals de la plataforma:
 * contractes visibles (RLS), estats del CRM, activitats, tasques i `sips_cache`.
 * Si una dada no existeix es mostra «—» o un estat buit; mai valors inventats.
 */
import { useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity as ActivityIcon, AlertTriangle, ArrowRight, BatteryCharging, CalendarClock, CheckCircle2, Database, Gauge, KanbanSquare, PhoneCall, Target, XCircle, Zap } from "lucide-react";
import { daysUntil, today } from "@/core/dates";
import { expiry } from "@/core/insights";
import { LEVEL_META, consumption } from "@/core/priority";
import { titleCase } from "@/core/templates";
import { consumptionSource, fmtMWh, hasSipsCups } from "@/core/sips";
import type { Contract } from "@/core/types";
import { useApp } from "@/data/store";
import { useSipsIndex } from "../useSips";
import { serverEnabled } from "@/energy/api";
import { Button, EASE_OUT, SupplierMark, cn } from "../components/ui";
import { STATUS_META } from "../selectors";
import { isStaff } from "@/core/roles";

const WINDOWS = [7, 15, 30, 60, 90] as const;
const open = (c: Contract) => c.crm.status === "pendiente" || c.crm.status === "contactado";
const MONTHS = ["gen", "febr", "març", "abr", "maig", "juny", "jul", "ag", "set", "oct", "nov", "des"];

export function DashboardExecView() {
  const { contracts, snap, priority, set, open: openContract, navigate } = useApp();
  const sips = useSipsIndex((s) => s.entries);
  const sipsLoaded = useSipsIndex((s) => s.loaded);
  const sipsError = useSipsIndex((s) => s.error);
  const loadSips = useSipsIndex((s) => s.load);
  useEffect(() => {
    void loadSips();
  }, [loadSips]);

  const k = useMemo(() => {
    const ref = today();
    const byStatus = { pendiente: 0, contactado: 0, renovado: 0, no_renueva: 0 };
    const win: Record<number, { n: number; kwh: number }> = Object.fromEntries(WINDOWS.map((w) => [w, { n: 0, kwh: 0 }]));
    let overdue = 0;
    let kwhTotal = 0, kwhKnown = 0, kwhOpen = 0, fromSips = 0, electric = 0;
    for (const c of contracts) {
      byStatus[c.crm.status]++;
      const d = daysUntil(expiry(c), ref);
      const src = consumptionSource(consumption(c), c.crm.consumoOverride != null, hasSipsCups(c) ? (sips[(c.cups ?? "").toUpperCase().replace(/[\s.-]/g, "").slice(0, 20)] ?? null) : null);
      if (c.tipo === "luz" || c.tipo === "dual") electric++;
      if (src.kwh != null && c.tipo !== "telefonia") {
        kwhTotal += src.kwh;
        kwhKnown++;
        if (src.source === "sips") fromSips++;
        if (open(c)) kwhOpen += src.kwh;
      }
      if (open(c) && d !== null) {
        if (d < 0) overdue++;
        for (const w of WINDOWS) if (d >= 0 && d <= w) {
          win[w].n++;
          win[w].kwh += src.kwh ?? 0;
        }
      }
    }
    return { byStatus, win, overdue, kwhTotal, kwhKnown, kwhOpen, fromSips, electric, pending: byStatus.pendiente + byStatus.contactado, closed: byStatus.renovado + byStatus.no_renueva };
  }, [contracts, sips]);

  // Renovacions per mes (últims 12 mesos), a partir de l'historial real de canvis d'estat.
  const monthly = useMemo(() => {
    const now = new Date();
    const keys = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const m = Object.fromEntries(keys.map((x) => [x, { renov: 0, perd: 0 }]));
    const visible = new Set(contracts.map((c) => c.id));
    for (const a of snap?.activities ?? []) {
      if (a.type !== "status" || !visible.has(a.contractId)) continue;
      const key = a.at.slice(0, 7);
      if (!m[key]) continue;
      const to = (a.meta as { to?: string } | undefined)?.to;
      if (to === "renovado") m[key].renov++;
      if (to === "no_renueva") m[key].perd++;
    }
    return keys.map((x) => ({ key: x, label: MONTHS[Number(x.slice(5)) - 1], ...m[x] }));
  }, [snap?.activities, contracts]);

  // Activitat comercial (30 dies)
  const activity = useMemo(() => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const visible = new Set(contracts.map((c) => c.id));
    const by = new Map<string, { calls: number; msgs: number; status: number; pdf: number; total: number }>();
    for (const a of snap?.activities ?? []) {
      if (a.at < since || !visible.has(a.contractId) || a.type === "sync") continue;
      const r = by.get(a.by) ?? { calls: 0, msgs: 0, status: 0, pdf: 0, total: 0 };
      if (a.type === "call") r.calls++;
      else if (a.type === "whatsapp" || a.type === "email") r.msgs++;
      else if (a.type === "status" || a.type === "renewal") r.status++;
      else if (a.type === "pdf") r.pdf++;
      r.total++;
      by.set(a.by, r);
    }
    return [...by.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  }, [snap?.activities, contracts]);

  const urgent = useMemo(
    () =>
      contracts
        .filter((c) => open(c) && priority[c.id] && (priority[c.id].level === "critica" || priority[c.id].level === "alta"))
        .sort((a, b) => (priority[b.id]?.score ?? 0) - (priority[a.id]?.score ?? 0))
        .slice(0, 8),
    [contracts, priority],
  );
  const goal = snap?.settings.objetivoRenovacionesMes ?? null;
  const thisMonth = monthly[monthly.length - 1];
  const exit = k.closed ? Math.round((k.byStatus.renovado / k.closed) * 100) : null;
  const goKanban = (kpi: string | null) => {
    set("filter", { kpi, comercial: null, tipo: null });
    navigate("kanban");
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Hola, {titleCase(snap?.me.name ?? "")}</h2>
          <p className="text-[13px] text-muted">
            Visió global de {k.byStatus.pendiente + k.byStatus.contactado + k.closed} contractes {snap && isStaff(snap.me.role) ? "de la cartera" : "assignats"} · dades del CRM i del SIPS
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => goKanban(null)}><KanbanSquare size={15} /> Renovacions</Button>
          <Button variant="primary" onClick={() => navigate("sips")}><Zap size={15} /> Buscador SIPS</Button>
        </div>
      </div>

      {/* KPI principals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Database size={15} />} label="Contractes totals" value={contracts.length} onClick={() => navigate("cartera")} />
        <Kpi icon={<CalendarClock size={15} />} label="Renovacions pendents" value={k.pending} tone="text-pend" onClick={() => goKanban(null)} sub={k.overdue ? `${k.overdue} vençuts sense gestionar` : undefined} />
        <Kpi icon={<PhoneCall size={15} />} label="Contactats" value={k.byStatus.contactado} tone="text-cont" onClick={() => goKanban("contactados")} />
        <Kpi icon={<CheckCircle2 size={15} />} label="Renovats" value={k.byStatus.renovado} tone="text-ren" onClick={() => goKanban("renovados")} sub={exit != null ? `${exit}% d'èxit sobre tancats` : undefined} />
        <Kpi icon={<XCircle size={15} />} label="Perduts" value={k.byStatus.no_renueva} tone="text-lost" onClick={() => goKanban("perdidos")} />
        <Kpi icon={<Target size={15} />} label="Renovats aquest mes" value={thisMonth?.renov ?? 0} sub={goal ? `Objectiu: ${goal} (${Math.round(((thisMonth?.renov ?? 0) / goal) * 100)}%)` : "Sense objectiu definit"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        {/* Venciments */}
        <Panel title="Venciments de contractes oberts" sub="Pendents i contactats que vencen dins de cada finestra (acumulat)">
          <div className="grid grid-cols-5 gap-2">
            {WINDOWS.map((w, i) => (
              <motion.button key={w} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, ease: EASE_OUT }}
                onClick={() => goKanban(w <= 7 ? "semana" : w <= 30 ? "mes" : "proximos")}
                className={cn("pressable rounded-xl border border-line p-3 text-left hover:border-ink/25", w <= 7 && k.win[w].n > 0 && "border-lost/40 bg-lost/[0.05]", w > 7 && w <= 30 && k.win[w].n > 0 && "border-pend/40 bg-pend/[0.05]")}>
                <div className="text-[11px] text-muted">≤ {w} dies</div>
                <div className="mt-1 text-2xl font-semibold tnum">{k.win[w].n}</div>
                <div className="text-[11px] text-muted tnum">{k.win[w].kwh ? fmtMWh(k.win[w].kwh) : "—"}</div>
              </motion.button>
            ))}
          </div>
        </Panel>

        {/* Energia gestionada */}
        <Panel title="Energia gestionada" sub="Consum anual: CRM o manual; si no n'hi ha, SIPS. Mai es reparteix per períodes.">
          <div className="grid grid-cols-2 gap-3">
            <Stat icon={<BatteryCharging size={15} />} label="Consum anual total" value={k.kwhKnown ? fmtMWh(k.kwhTotal) : "—"} sub={`${k.kwhKnown} de ${contracts.filter((c) => c.tipo !== "telefonia").length} contractes amb consum`} />
            <Stat icon={<Gauge size={15} />} label="Volum pendent de renovar" value={k.kwhOpen ? fmtMWh(k.kwhOpen) : "—"} sub="Contractes pendents i contactats" />
          </div>
          <div className="mt-3 rounded-lg bg-elevated p-2.5 text-[12px] text-muted">
            <Zap size={12} className="mr-1 inline text-brand" />
            {!serverEnabled() ? "Dades SIPS no disponibles sense servidor (mode local)." : sipsError ? `No s'han pogut carregar les dades SIPS: ${sipsError}` : sipsLoaded ? `${Object.values(sips).filter((x) => x.status === "found").length} CUPS amb dades SIPS · ${k.fromSips} consums completats amb SIPS` : "Carregant dades SIPS…"}
            <button onClick={() => navigate("energia")} className="ml-2 font-medium text-ink underline-offset-2 hover:underline">Anàlisi energètica →</button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Panel title="Evolució de renovacions" sub="Canvis d'estat registrats a l'historial (12 mesos)">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} />
                <Tooltip cursor={{ fill: "rgb(var(--ink) / 0.04)" }} contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 10, fontSize: 12 }} formatter={(v, n) => [String(v ?? 0), n === "renov" ? "Renovats" : "Perduts"]} />
                {goal ? <ReferenceLine y={goal} stroke="rgb(var(--brand))" strokeDasharray="4 4" label={{ value: "objectiu", fontSize: 10, fill: "rgb(var(--brand))", position: "insideTopRight" }} /> : null}
                <Bar dataKey="renov" radius={[4, 4, 0, 0]} fill="rgb(var(--ren))" />
                <Bar dataKey="perd" radius={[4, 4, 0, 0]} fill="rgb(var(--lost) / 0.55)">
                  {monthly.map((m) => <Cell key={m.key} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Activitat dels comercials" sub="Gestions registrades els últims 30 dies">
          {activity.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted">Encara no hi ha activitat registrada en aquest període.</p>
          ) : (
            <ul className="space-y-1.5">
              {activity.map(([who, r]) => (
                <li key={who} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-ink/[0.03]">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">{who.slice(0, 2).toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{titleCase(who)}</span>
                  <span className="text-muted tnum" title="Trucades">📞 {r.calls}</span>
                  <span className="text-muted tnum" title="WhatsApp i correus">✉ {r.msgs}</span>
                  <span className="text-muted tnum" title="Propostes PDF">📄 {r.pdf}</span>
                  <span className="w-10 text-right font-semibold tnum">{r.total}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Alertes i oportunitats prioritàries" sub="Contractes oberts amb prioritat crítica o alta (puntuació 0–100 del CRM)" right={<Button size="sm" variant="ghost" onClick={() => goKanban(null)}>Kanban <ArrowRight size={13} /></Button>}>
        {urgent.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted"><ActivityIcon size={14} className="mr-1 inline" /> No hi ha contractes amb prioritat crítica o alta.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {urgent.map((c) => {
              const p = priority[c.id];
              const d = daysUntil(expiry(c));
              const elec = hasSipsCups(c);
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                  <SupplierMark name={c.comercializadora} size={26} />
                  <button onClick={() => openContract(c.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[13px] font-semibold">{titleCase(c.cliente)}</p>
                    <p className="truncate text-[11.5px] text-muted">
                      <span style={{ color: STATUS_META[c.crm.status].color }}>{STATUS_META[c.crm.status].label}</span> · {d == null ? "sense data" : d < 0 ? `vençut fa ${-d} dies` : `venç en ${d} dies`} · {p.factors.filter((f) => f.points > 0).sort((a, b) => b.points - a.points)[0]?.reason ?? ""}
                    </p>
                  </button>
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset tnum", LEVEL_META[p.level].cls)}>{p.score}</span>
                  {elec && <Button size="sm" variant="ghost" title="Analitzar CUPS" onClick={() => useApp.getState().analyzeCups(c.cups!, c.id)}><Zap size={14} /></Button>}
                </div>
              );
            })}
          </div>
        )}
        {k.overdue > 0 && (
          <button onClick={() => goKanban("vencidos")} className="mt-3 flex w-full items-center gap-2 rounded-lg border border-lost/30 bg-lost/[0.05] px-3 py-2 text-left text-[12.5px] text-lost">
            <AlertTriangle size={14} /> {k.overdue} contractes oberts ja han vençut sense gestió. Revisa&apos;ls.
          </button>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">{title}</h3>
          {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Kpi({ icon, label, value, sub, tone, onClick }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="pressable rounded-2xl border border-line bg-surface p-3.5 text-left shadow-card hover:border-ink/25">
      <div className="flex items-center justify-between text-[11.5px] text-muted">{label}<span className="opacity-70">{icon}</span></div>
      <div className={cn("mt-1.5 text-[28px] font-semibold leading-none tracking-tight tnum", tone)}>{value.toLocaleString("ca-ES")}</div>
      {sub && <div className="mt-1.5 truncate text-[11px] text-muted">{sub}</div>}
    </button>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">{icon}{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tnum">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{sub}</div>
    </div>
  );
}
