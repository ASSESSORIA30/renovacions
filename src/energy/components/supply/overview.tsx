"use client";
import { motion } from "motion/react";
import { Activity, BatteryCharging, Building2, Gauge, MapPin, Plug, ShieldCheck, Waves, Zap } from "lucide-react";
import type { Supply } from "@/energy/lib/types";
import { annualActive, maxContracted, sumKnown } from "@/energy/lib/parse";
import { tariffRules } from "@/energy/lib/tariffs";
import { fmt } from "@/energy/lib/format";
import { Badge, Card, CardBody, CardHeader, InfoTip, Callout } from "../ui";
import { MonthlyBars, MonthlyLine, PeriodBars } from "../charts";
import { GLOSSARY, Provenance } from "./common";

function AnimatedNumber({ value }: { value: string }) {
  return (
    <motion.span key={value} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}>
      {value}
    </motion.span>
  );
}

export function SupplyHero({ s }: { s: Supply }) {
  const a = annualActive(s);
  const n = s.tarifa ? tariffRules(s.tarifa).periods : 6;
  const pcs = s.potContratada.slice(0, n);
  const maxPc = maxContracted(s) ?? 0;
  return (
    <Card className="hero-grad relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative grid gap-6 p-6 lg:grid-cols-[1.2fr_1fr] lg:p-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" className="text-xs">
              <Zap /> {s.tarifa ?? s.tarifaRaw ?? "Tarifa ?"}
            </Badge>
            <Badge tone={s.contratable === false ? "critical" : "good"}>{s.contratable === false ? "No contratable" : s.contratable ? "Contratable" : "Contratabilidad s/d"}</Badge>
            {!s.cupsValid && <Badge tone="critical">CUPS no válido</Badge>}
            {s.autoconsumo && !/^0*0\b|^no/i.test(s.autoconsumo) && <Badge tone="blue">Autoconsumo</Badge>}
          </div>
          <div className="num mt-3 break-all text-sm text-fg-2">{s.cups}</div>
          <div className="mt-1 flex items-start gap-1.5 text-sm text-fg-3">
            <MapPin className="mt-0.5 size-4 shrink-0" />
            <span>
              {s.direccion ?? "Dirección no informada"} · {s.cp ?? ""} {s.localidad ?? ""} ({s.provincia ?? "—"})
            </span>
          </div>
          <div className="mt-6">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-fg-3">
              Consumo anual activo <InfoTip>{GLOSSARY.activa.text}</InfoTip>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="num text-5xl font-semibold tracking-tight text-grad sm:text-6xl lg:text-7xl">
                <AnimatedNumber value={fmt.n(a.value)} />
              </span>
              <span className="text-xl text-fg-3">kWh</span>
              <span className="num text-2xl font-medium text-fg-2">{fmt.n(a.value != null ? a.value / 1000 : null, 1)} MWh</span>
            </div>
            <div className="mt-1 text-xs text-fg-3">{a.basis === "anual" ? "Fuente: columna E.A. Anual (kWh)" : a.basis === "suma12" ? "Fuente: suma de 12 meses (E.A. Anual vacío)" : "Sin dato anual"}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { k: "Potencia anual registrada", v: fmt.kw(s.potAnual), i: <Activity />, h: GLOSSARY.potRegistrada.text },
            { k: "Pot. máx. BIE", v: fmt.kw(s.potMaxBIE), i: <ShieldCheck />, h: GLOSSARY.potBIE.text },
            { k: "Pot. máx. APM", v: fmt.kw(s.potMaxAPM), i: <ShieldCheck />, h: GLOSSARY.potBIE.text },
            { k: "Máx. contratada", v: fmt.kw(maxPc || null), i: <Gauge />, h: GLOSSARY.potContratada.text },
            { k: "Distribuidora", v: s.distribuidora ?? "—", i: <Plug />, text: true },
            { k: "Comercializadora", v: s.comercializadora ?? "—", i: <Building2 />, text: true },
          ].map((x) => (
            <div key={x.k} className="rounded-xl border border-border bg-bg-elev/60 p-3.5 backdrop-blur">
              <div className="flex items-center justify-between text-[11px] text-fg-3">
                <span className="flex items-center gap-1">
                  {x.k} {x.h && <InfoTip>{x.h}</InfoTip>}
                </span>
                <span className="[&_svg]:size-3.5">{x.i}</span>
              </div>
              <div className={x.text ? "mt-1.5 line-clamp-2 text-sm font-medium" : "num mt-1 text-lg font-semibold"}>{x.v}</div>
            </div>
          ))}
          <div className="col-span-2 rounded-xl border border-border bg-bg-elev/60 p-3.5">
            <div className="mb-2 flex items-center justify-between text-[11px] text-fg-3">
              <span className="flex items-center gap-1">
                Potencias contratadas P1–P{n} <InfoTip>{GLOSSARY.potContratada.text}</InfoTip>
              </span>
              <BatteryCharging className="size-3.5" />
            </div>
            <div className={`grid gap-2 ${n === 2 ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-6"}`}>
              {pcs.map((v, i) => (
                <div key={i} className="text-center">
                  <div className="relative mx-auto h-12 w-full overflow-hidden rounded-md bg-surface-2">
                    <motion.div className="absolute bottom-0 w-full bg-gradient-to-t from-accent-2 to-accent" initial={{ height: 0 }} animate={{ height: `${maxPc ? ((v ?? 0) / maxPc) * 100 : 0}%` }} transition={{ duration: 0.8, delay: i * 0.05 }} />
                  </div>
                  <div className="mt-1 text-[10px] text-fg-3">P{i + 1}</div>
                  <div className="num text-xs font-medium">{fmt.n(v, v != null && v % 1 ? 2 : 0)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function Overview({ s }: { s: Supply }) {
  const n = s.tarifa ? tariffRules(s.tarifa).periods : 6;
  const maxPc = maxContracted(s);
  const eaSum = sumKnown(s.eaMensual);
  const refs = [
    ...(maxPc != null ? [{ label: "Máx. contratada", value: maxPc, color: "s4" }] : []),
    ...(s.potMaxBIE != null ? [{ label: "BIE", value: s.potMaxBIE, color: "critical" }] : []),
    ...(s.potMaxAPM != null && s.potMaxAPM !== s.potMaxBIE ? [{ label: "APM", value: s.potMaxAPM, color: "s7" }] : []),
  ];
  return (
    <div className="space-y-5">
      <Provenance s={s} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Zap />} title="1 · Consumo activo mensual" subtitle={<>kWh por mes · suma de meses disponibles {fmt.n(eaSum.sum)} kWh ({eaSum.known}/12)</>} right={<InfoTip>{GLOSSARY.activa.text}</InfoTip>} />
          <CardBody>
            <MonthlyBars values={s.eaMensual} unit="kWh" name="Energía activa" color="s1" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Activity />} title="2 · Potencia registrada mensual" subtitle="kW · demanda máxima medida (sin periodo) frente a límites contractuales y técnicos" right={<InfoTip>{GLOSSARY.potRegistrada.text}</InfoTip>} />
          <CardBody>
            <MonthlyLine values={s.potMensual} unit="kW" name="Máxima registrada" refLines={refs} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Waves />} title="3 · Energía reactiva mensual" subtitle={<>kVArh por mes · anual {fmt.n(s.erAnual)} kVArh</>} right={<InfoTip>{GLOSSARY.reactiva.text}</InfoTip>} />
          <CardBody>
            <MonthlyBars values={s.erMensual} unit="kVArh" name="Energía reactiva" color="s2" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Gauge />} title="4 · Potencias contratadas por periodo" subtitle="kW · contratada frente a potencia anual registrada (referencia agregada)" right={<InfoTip>{GLOSSARY.potContratada.text}</InfoTip>} />
          <CardBody>
            <PeriodBars
              n={n}
              series={[
                { name: "Contratada", values: s.potContratada, color: "s1" },
                { name: "Pot. anual registrada (todas las horas)", values: Array(n).fill(s.potAnual), color: "s4", dashed: true },
              ]}
            />
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[GLOSSARY.potContratada, GLOSSARY.potBIE, GLOSSARY.potRegistrada, GLOSSARY.reactiva].map((g) => (
          <Callout key={g.title} tone="info" title={g.title}>
            <span className="text-xs">{g.text}</span>
          </Callout>
        ))}
      </div>
    </div>
  );
}
