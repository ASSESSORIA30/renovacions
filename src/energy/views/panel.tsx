"use client";
import Link from "@/energy/compat/link";
import { useMemo } from "react";
import { motion } from "motion/react";
import { AlertTriangle, ArrowRight, Bolt, Cpu, Database, Gauge, LayoutDashboard, Radar, Search, ShieldCheck, Store, Target, Waves } from "lucide-react";
import { useStore } from "@/energy/lib/store";
import { usePortfolio } from "@/energy/lib/portfolio";
import { fmt } from "@/energy/lib/format";
import { TARIFFS } from "@/energy/lib/tariffs";
import { Badge, Button, Card, CardBody, CardHeader, Kpi, SeverityBadge } from "@/energy/components/ui";
import { ImportPanel, ImportReportView } from "@/energy/components/import-panel";
import { PageTitle } from "@/energy/components/shell";
import { HBarScores } from "@/energy/components/charts";

export function EnergyPanelView() {
  const hydrated = useStore((s) => s.hydrated);
  const supplies = useStore((s) => s.supplies);
  if (!hydrated) return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;
  return supplies.length ? <Dashboard /> : <Welcome />;
}

function Welcome() {
  const features = [
    { i: <Search />, t: "Radiografía por CUPS", d: "Consumo, potencias, reactiva y situación técnica en una sola pantalla." },
    { i: <Cpu />, t: "Power Optimizer", d: "Optimización exacta con reglas de cada peaje y excesos según Circular 3/2020." },
    { i: <Waves />, t: "Reactive Energy", d: "Riesgo de penalización y dimensionado orientativo de compensación." },
    { i: <Store />, t: "Energy Market", d: "Comparador de ofertas con calidad de dato explícita e informe PDF." },
    { i: <Radar />, t: "Radar comercial", d: "Filtros, puntuación transparente y exportación de toda la cartera." },
    { i: <ShieldCheck />, t: "Alertas inteligentes", d: "BIE/APM, impagos, lecturas antiguas e inconsistencias de potencia." },
  ];
  return (
    <div className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 -top-10 h-[420px] opacity-50" />
      <div className="relative grid gap-10 py-6 lg:grid-cols-[1.1fr_1fr] lg:py-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-4">
            { }
            <img src="/logo-assessoria30.png" alt="Assessoria 3.0" className="size-16 rounded-full drop-shadow-[0_10px_30px_rgba(34,197,94,0.4)]" />
            <Badge tone="accent" className="text-xs">
              <Bolt /> Energy Intelligence para Assessoria 3.0
            </Badge>
          </div>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            La radiografía energética
            <br />
            <span className="text-grad">de cada suministro.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-fg-3">
            Importa la exportación SIPS, busca un CUPS o una dirección y detecta oportunidades de ahorro con cálculos reproducibles, normativa vigente y sin inventar datos por periodo.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {features.map((f, i) => (
              <motion.div key={f.t} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }} className="flex gap-3 rounded-xl border border-border bg-surface/60 p-3.5">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent [&_svg]:size-4">{f.i}</div>
                <div>
                  <div className="text-sm font-medium">{f.t}</div>
                  <div className="text-xs text-fg-3">{f.d}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="p-6">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Database className="size-4 text-accent" /> Importar cartera
            </h2>
            <p className="mb-5 text-xs text-fg-3">Exporta els punts de subministrament des del portal SIPS i arrossega aquí el fitxer. Les dades SIPS dels contractes del CRM es carreguen automàticament de Supabase.</p>
            <ImportPanel big />
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

function Dashboard() {
  const rows = usePortfolio();
  const reports = useStore((s) => s.reports);
  const crm = useStore((s) => s.crm);
  const k = useMemo(() => {
    const total = rows.reduce((a, r) => a + (r.annual ?? 0), 0);
    const pc = rows.reduce((a, r) => a + (r.maxPc ?? 0), 0);
    const crit = rows.reduce((a, r) => a + r.critical, 0);
    const saving = rows.reduce((a, r) => a + Math.max(0, r.saving ?? 0), 0);
    const opps = rows.filter((r) => r.score >= 60).length;
    const byTariff = TARIFFS.map((t) => rows.filter((r) => r.s.tarifa === t).reduce((a, r) => a + (r.annual ?? 0), 0) / 1000);
    const comer = new Map<string, number>();
    rows.forEach((r) => comer.set(r.s.comercializadora ?? "Sin dato", (comer.get(r.s.comercializadora ?? "Sin dato") ?? 0) + 1));
    return { total, pc, crit, saving, opps, byTariff, comer: [...comer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) };
  }, [rows]);
  const top = [...rows].sort((a, b) => b.score - a.score).slice(0, 8);
  const alerts = rows.flatMap((r) => r.alerts).filter((a) => a.severity === "critica").slice(0, 6);
  const marked = Object.values(crm).filter((o) => o.marked).length;

  return (
    <div className="space-y-6">
      <PageTitle icon={<LayoutDashboard />} title="Anàlisi energètica" subtitle={`${fmt.n(rows.length)} subministraments · ${fmt.n(rows.filter((r) => r.s.source.origin === "crm").length)} del CRM (SIPS) · ${fmt.n(rows.filter((r) => r.s.source.origin !== "crm").length)} importats o cercats`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi accent label="Consumo anual de la cartera" value={fmt.n(k.total / 1000, 1)} unit="MWh" sub={`${fmt.n(k.total)} kWh · suma de E.A. Anual`} />
        <Kpi label="Potencia contratada agregada" value={fmt.n(k.pc, 0)} unit="kW" sub="Máx. contratada por CUPS" icon={<Gauge />} />
        <Kpi label="Ahorro mínimo en potencia" value={fmt.eur(k.saving)} sub="Escenario Equilibrado · preliminar, ATR" icon={<Cpu />} hint="Suma del ahorro neto mínimo (cota) con precios ATR regulados y el margen configurado. Requiere validación con facturas." />
        <Kpi label="Oportunidades (score ≥ 60)" value={fmt.n(k.opps)} sub={`${marked} marcadas en CRM`} icon={<Target />} />
        <Kpi label="Alertas críticas / altas" value={fmt.n(k.crit)} sub="Ver centro de alertas" icon={<AlertTriangle />} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            icon={<Target />}
            title="Mejores oportunidades"
            subtitle="Puntuación comercial transparente (no es ahorro demostrado)"
            right={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/radar">
                  Radar <ArrowRight />
                </Link>
              </Button>
            }
          />
          <CardBody className="space-y-1.5">
            {top.map((r) => (
              <Link key={r.s.cups} href={`/suministro/?cups=${encodeURIComponent(r.s.cups)}`} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-surface-2">
                <div className="num grid size-10 place-items-center rounded-lg bg-accent/10 text-sm font-semibold text-accent">{r.score}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.s.direccion ?? r.s.cups}</div>
                  <div className="truncate text-[11px] text-fg-3">
                    {r.s.localidad} · {r.s.comercializadora} · <span className="num">{r.s.cups}</span>
                  </div>
                </div>
                <div className="text-right">
                  <Badge tone="blue">{r.s.tarifa ?? "?"}</Badge>
                  <div className="num mt-1 text-xs text-fg-2">{fmt.n((r.annual ?? 0) / 1000, 1)} MWh</div>
                </div>
              </Link>
            ))}
          </CardBody>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Consumo por tarifa" subtitle="MWh/año" />
            <CardBody>
              <HBarScores items={TARIFFS.map((t, i) => ({ label: t, value: Math.round(k.byTariff[i]) })).filter((x) => x.value > 0)} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Comercializadoras actuales" subtitle="Número de suministros" />
            <CardBody>
              <HBarScores items={k.comer.map(([l, v]) => ({ label: l, value: v }))} />
            </CardBody>
          </Card>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<AlertTriangle />} title="Alertas críticas" right={<Button variant="ghost" size="sm" asChild><Link href="/alertas">Ver todas <ArrowRight /></Link></Button>} />
          <CardBody className="space-y-2">
            {alerts.length ? (
              alerts.map((a) => (
                <Link key={a.id} href={`/suministro/?cups=${encodeURIComponent(a.cups)}`} className="flex items-start gap-3 rounded-lg border border-border p-3 hover:border-border-strong">
                  <SeverityBadge s={a.severity} />
                  <div className="min-w-0">
                    <div className="text-sm">{a.title}</div>
                    <div className="truncate text-[11px] text-fg-3">{a.reason}</div>
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-sm text-fg-3">Sin alertas críticas.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Database />} title="Última importación" />
          <CardBody>{reports[0] ? <ImportReportView r={reports[0]} /> : <p className="text-sm text-fg-3">—</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}
