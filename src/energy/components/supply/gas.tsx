"use client";
/**
 * Fitxa de subministrament de GAS. Reutilitza els components de cups2 (targetes, gràfic mensual,
 * procedència i fitxa tècnica). Els mòduls de potència, reactiva i el comparador elèctric no s'apliquen al gas.
 */
import { Flame, MapPin } from "lucide-react";
import type { Supply } from "@/energy/lib/types";
import { annualActive, sumKnown } from "@/energy/lib/parse";
import { fmt } from "@/energy/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, Kpi } from "@/energy/components/ui";
import { MonthlyBars } from "@/energy/components/charts";
import { Provenance } from "./common";

export function GasHero({ s }: { s: Supply }) {
  const a = annualActive(s);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--s2)_40%,transparent)] bg-gradient-to-br from-[color-mix(in_srgb,var(--s2)_10%,transparent)] via-transparent to-transparent p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="serious">
          <Flame /> Gas · {s.tarifaRaw ?? "Peatge ?"}
        </Badge>
        {s.contratable === true && <Badge tone="good">Contratable</Badge>}
        {s.contratable === false && <Badge tone="critical">No contratable</Badge>}
      </div>
      <div className="num mt-3 text-sm text-fg-2">{s.cups}</div>
      <div className="mt-1 flex items-center gap-1.5 text-sm text-fg-3">
        <MapPin className="size-4" /> {[s.direccion, [s.cp, s.localidad].filter(Boolean).join(" "), s.provincia && `(${s.provincia})`].filter(Boolean).join(" · ") || "Sense adreça"}
      </div>
      <div className="mt-5 text-[11px] uppercase tracking-[0.2em] text-fg-3">Consum anual de gas</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <span className="num text-5xl font-semibold tracking-tight text-[var(--s2)]">{fmt.n(a.value)}</span>
        <span className="text-fg-3">kWh</span>
        <span className="num text-2xl text-fg-2">{a.value == null ? "—" : `${fmt.n(a.value / 1000, 1)} MWh`}</span>
      </div>
      <p className="mt-1 text-xs text-fg-3">{a.basis === "anual" ? "Font: columna de consum anual del SIPS" : a.basis === "suma12" ? "Suma dels 12 mesos informats" : "El SIPS no informa el consum anual"}</p>
    </div>
  );
}

export function GasOverview({ s }: { s: Supply }) {
  const months = sumKnown(s.eaMensual);
  return (
    <div className="space-y-5">
      <Provenance s={s} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Peatge d'accés" value={s.tarifaRaw ?? "—"} />
        <Kpi label="Distribuïdora" value={<span className="text-base">{s.distribuidora ?? "—"}</span>} />
        <Kpi label="Comercialitzadora" value={<span className="text-base">{s.comercializadora ?? "—"}</span>} />
        <Kpi label="Mesos amb consum informat" value={`${months.known}/12`} sub={months.known ? `${fmt.n(months.sum)} kWh en total` : "Sense desglossament mensual"} />
      </div>
      <Card>
        <CardHeader icon={<Flame />} title="Consum mensual de gas" subtitle="kWh · els mesos sense dada no es mostren com a zero" />
        <CardBody>{months.known ? <MonthlyBars values={s.eaMensual} unit="kWh" name="Consum" color="s2" /> : <p className="text-sm text-fg-3">El SIPS no ha retornat consums mensuals per a aquest punt.</p>}</CardBody>
      </Card>
      <Callout tone="info" title="Subministrament de gas">
        No s&apos;hi apliquen el Power Optimizer, la reactiva ni el comparador elèctric. Per preparar l&apos;oferta, fes servir el generador del CRM: per al gas demana el preu de l&apos;energia (€/kWh) i el terme fix (€/dia).
      </Callout>
    </div>
  );
}
