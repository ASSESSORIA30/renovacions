"use client";
import { useState } from "react";
import { Copy, Pencil, Plus, Store, Trash2 } from "lucide-react";
import { toast } from "@/energy/compat/toast";
import { regulatedReferenceOffer, useStore } from "@/energy/lib/store";
import { blankOffer, type Offer } from "@/energy/lib/market";
import { TARIFFS, energyPeriods, powerPeriods, type TariffCode } from "@/energy/lib/tariffs";
import { fmt, todayIso } from "@/energy/lib/format";
import { Badge, Button, Callout, Card, Dialog, Empty, Field, Input, NumInput, Select, Switch, Textarea } from "@/energy/components/ui";
import { PageTitle } from "@/energy/components/shell";

export function MarketView() {
  const offers = useStore((s) => s.offers);
  const upsert = useStore((s) => s.upsertOffer);
  const del = useStore((s) => s.deleteOffer);
  const regulated = useStore((s) => s.settings.regulated);
  const [edit, setEdit] = useState<Offer | null>(null);
  const today = todayIso();

  return (
    <div className="space-y-5">
      <PageTitle
        icon={<Store />}
        title="Energy Market"
        subtitle="Tarifas de comercializadoras para comparar en cada suministro"
        right={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const o = { ...blankOffer("3.0TD"), ...regulatedReferenceOffer("3.0TD", regulated), id: crypto.randomUUID(), comercializadora: "", nombre: "Nueva oferta", origen: "Plantilla: término de potencia ATR regulado; completa energía y margen", ieePct: 5.11269632, ivaPct: 21 };
                setEdit(o);
              }}
            >
              <Copy /> Desde plantilla ATR
            </Button>
            <Button onClick={() => setEdit(blankOffer("3.0TD"))}>
              <Plus /> Nueva oferta
            </Button>
          </div>
        }
      />
      <Callout tone="info">
        Introduce los precios exactamente como figuran en las condiciones de la comercializadora (energía en €/kWh y potencia en €/kW·año, sin impuestos). Si la oferta repercute servicios de ajuste (SAS) u otros conceptos variables, indícalo con su estimación; si no hay estimación no se suman y se avisa en la comparativa.
      </Callout>
      {!offers.length ? (
        <Empty icon={<Store />} title="Aún no hay ofertas">
          Crea la primera oferta para habilitar el comparador en las fichas de suministro.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {offers.map((o) => {
            const expired = o.validTo && o.validTo < today;
            return (
              <Card key={o.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{o.comercializadora || "Sin comercializadora"}</div>
                    <div className="text-sm text-fg-3">{o.nombre}</div>
                  </div>
                  <Badge tone="blue">{o.tarifa}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-fg-3">Energía €/kWh</div>
                    <div className="num mt-1 text-fg-2">{o.energia.slice(0, energyPeriods(o.tarifa)).map((v) => fmt.n(v, 4)).join(" · ")}</div>
                  </div>
                  <div>
                    <div className="text-fg-3">Potencia €/kW·año</div>
                    <div className="num mt-1 text-fg-2">{o.potencia.slice(0, powerPeriods(o.tarifa)).map((v) => fmt.n(v, 2)).join(" · ")}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={expired ? "critical" : "good"}>{o.validTo ? `Válida hasta ${fmt.date(o.validTo)}` : "Sin fecha fin"}</Badge>
                  {o.sas.applies && <Badge tone="warning">SAS {o.sas.eurPerKWh != null ? `${o.sas.eurPerKWh} €/kWh` : "sin estimar"}</Badge>}
                  {o.servicios.length > 0 && <Badge>{o.servicios.length} servicios</Badge>}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEdit(o)}>
                    <Pencil /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...o, id: crypto.randomUUID(), nombre: `${o.nombre} (copia)` })}>
                    <Copy /> Duplicar
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      del(o.id);
                      toast("Oferta eliminada");
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {edit && <OfferEditor offer={edit} onClose={() => setEdit(null)} onSave={(o) => (upsert(o), setEdit(null), toast.success("Oferta guardada"))} />}
    </div>
  );
}

function OfferEditor({ offer, onClose, onSave }: { offer: Offer; onClose: () => void; onSave: (o: Offer) => void }) {
  const [o, setO] = useState<Offer>(offer);
  const ne = energyPeriods(o.tarifa);
  const np = powerPeriods(o.tarifa);
  const set = <K extends keyof Offer>(k: K, v: Offer[K]) => setO({ ...o, [k]: v });
  const valid = o.comercializadora.trim() && o.nombre.trim() && o.energia.slice(0, ne).every((x) => x > 0) && o.potencia.slice(0, np).every((x) => x >= 0);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Oferta comercial" wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Comercializadora">
            <Input value={o.comercializadora} onChange={(e) => set("comercializadora", e.target.value)} />
          </Field>
          <Field label="Nombre de la oferta">
            <Input value={o.nombre} onChange={(e) => set("nombre", e.target.value)} />
          </Field>
          <Field label="Tarifa aplicable">
            <Select value={o.tarifa} onChange={(e) => set("tarifa", e.target.value as TariffCode)}>
              {TARIFFS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-fg-2">Precio de energía por periodo (€/kWh, sin impuestos)</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Array.from({ length: ne }, (_, i) => (
              <Field key={i} label={`P${i + 1}`}>
                <NumInput value={o.energia[i]} onChange={(v) => set("energia", o.energia.map((x, j) => (j === i ? (v ?? 0) : x)))} />
              </Field>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-fg-2">Precio de potencia por periodo (€/kW·año, sin impuestos)</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Array.from({ length: np }, (_, i) => (
              <Field key={i} label={`P${i + 1}`}>
                <NumInput value={o.potencia[i]} onChange={(v) => set("potencia", o.potencia.map((x, j) => (j === i ? (v ?? 0) : x)))} />
              </Field>
            ))}
          </div>
        </div>
        <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={o.sas.applies} onCheckedChange={(v) => set("sas", { ...o.sas, applies: v })} /> Mecanismo de ajuste SAS
          </label>
          <Field label="Estimación SAS (€/kWh)">
            <NumInput disabled={!o.sas.applies} value={o.sas.eurPerKWh} onChange={(v) => set("sas", { ...o.sas, eurPerKWh: v })} />
          </Field>
          <Field label="Nota SAS">
            <Input disabled={!o.sas.applies} value={o.sas.note} onChange={(e) => set("sas", { ...o.sas, note: e.target.value })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="IEE (%)">
            <NumInput value={o.ieePct} onChange={(v) => set("ieePct", v ?? 0)} />
          </Field>
          <Field label="IVA (%)">
            <NumInput value={o.ivaPct} onChange={(v) => set("ivaPct", v ?? 0)} />
          </Field>
          <Field label="Alquiler equipo (€/mes)">
            <NumInput value={o.alquilerEurMes} onChange={(v) => set("alquilerEurMes", v ?? 0)} />
          </Field>
          <div />
          <Field label="Válida desde">
            <Input type="date" value={o.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
          </Field>
          <Field label="Válida hasta">
            <Input type="date" value={o.validTo} onChange={(e) => set("validTo", e.target.value)} />
          </Field>
          <Field label="Origen / referencia" className="sm:col-span-2">
            <Input value={o.origen} onChange={(e) => set("origen", e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-fg-2">
            Servicios adicionales
            <Button size="sm" variant="ghost" onClick={() => set("servicios", [...o.servicios, { nombre: "", eurMes: 0 }])}>
              <Plus /> Añadir
            </Button>
          </div>
          {o.servicios.map((sv, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_140px_40px] gap-2">
              <Input placeholder="Servicio" value={sv.nombre} onChange={(e) => set("servicios", o.servicios.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} />
              <NumInput placeholder="€/mes" value={sv.eurMes} onChange={(v) => set("servicios", o.servicios.map((x, j) => (j === i ? { ...x, eurMes: v ?? 0 } : x)))} />
              <Button size="icon" variant="ghost" onClick={() => set("servicios", o.servicios.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <Field label="Condiciones de contratación">
          <Textarea rows={2} value={o.condiciones} onChange={(e) => set("condiciones", e.target.value)} placeholder="Permanencia, penalizaciones, revisión de precios…" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!valid} onClick={() => onSave(o)}>
            Guardar oferta
          </Button>
        </div>
        {!valid && <p className="text-right text-[11px] text-fg-3">Completa comercializadora, nombre y precios de energía de todos los periodos.</p>}
      </div>
    </Dialog>
  );
}
