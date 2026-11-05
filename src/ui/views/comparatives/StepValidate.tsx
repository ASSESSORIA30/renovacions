"use client";
/** Pas 2 · Validació: el comercial revisa i corregeix les dades i n'hi veu la procedència. */
import { periodsOf, normalizeTariff } from "@/comparator/engine";
import type { Field } from "@/comparator/invoice";
import { emptySheet, POWER_UNIT_LABEL, SAS_LABEL, TERRITORIES, type Num, type PowerUnit, type SasMode, type Territory } from "@/comparator/types";
import { Badge, Button, Notice, cn } from "../../components/ui";
import { useWizard } from "./state";
import { useState } from "react";
import { parseHourlyCsv } from "@/comparator/open-calendar";
import { DropZone } from "../../components/DropZone";
import { EnergyBreakdownPanel, SurplusSection } from "./EnergySurplus";

const TARIFFS = ["2.0TD", "3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD", ...Array.from({ length: 11 }, (_, i) => `RL.${i + 1}`)];
const TERR_LABEL: Record<Territory, string> = { peninsula: "Península", balears: "Illes Balears", canaries: "Canàries", ceuta: "Ceuta", melilla: "Melilla" };
const SRC_LABEL: Record<string, string> = { factura: "Factura", sips: "SIPS", crm: "CRM", manual: "Manual", calculat: "Calculat" };

const toNum = (s: string): Num => {
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function NumIn({ value, onChange, label, src, field, step = "any", className }: { value: Num; onChange: (v: Num) => void; label: string; src?: string | null; field?: Field<unknown>; step?: string; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-muted">
        {label}
        {src && <span className="rounded bg-ink/[0.06] px-1 text-[9.5px] font-semibold uppercase">{SRC_LABEL[src] ?? src}</span>}
        {field?.value != null && field.page && <span className="text-[9.5px]">p.{field.page}</span>}
        {field?.value != null && field.confirm && <span className="rounded bg-amber-500/15 px-1 text-[9.5px] font-semibold text-amber-700 dark:text-amber-300">confirmar</span>}
      </span>
      <input className={cn("input tnum", field?.value != null && field.confirm && "border-amber-400")} inputMode="decimal" step={step} defaultValue={value ?? ""} key={String(value)} onBlur={(e) => onChange(toNum(e.target.value))} />
    </label>
  );
}

export function StepValidate() {
  const w = useWizard();
  const s = w.supply;
  const gas = s.energyType === "gas";
  const per = periodsOf(s.accessTariff, s.energyType);
  const inv = w.invoice?.data;
  const cur = w.current;
  const setArr = (arr: Num[], i: number, v: Num) => arr.map((x, j) => (j === i ? v : x));
  const sumKnown = s.kwh.slice(0, per.energy).every((x) => x != null);

  const annualize = () => {
    const f = 365 / s.days;
    w.setSupply({ kwh: s.kwh.map((x) => (x == null ? null : Math.round(x * f))), kwhTotal: s.kwhTotal == null ? null : Math.round(s.kwhTotal * f), days: 365, basis: "anualitzat" });
    w.set({ dataNotes: [...w.dataNotes, `Consums anualitzats linealment (×365/${s.days}) a partir d'un període de ${s.days} dies: és una estimació, no el consum anual real.`] });
  };

  return (
    <div className="space-y-4">
      {w.invoice && (
        <Notice tone="blue">
          Lectura de la factura: {w.invoice.pages} pàgina(es). Els camps marcats amb <b>confirmar</b> s&apos;han de revisar; «p.N» indica la pàgina d&apos;on s&apos;han extret. {w.invoice.warnings.join(" ")}
        </Notice>
      )}
      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <h3 className="text-[14px] font-semibold sm:col-span-2 lg:col-span-5">Client</h3>
        <TextIn label="Titular" value={w.client.name} field={inv?.holder} onChange={(v) => w.set({ client: { ...w.client, name: v } })} className="lg:col-span-2" />
        <TextIn label="NIF/CIF" value={w.client.taxId} field={inv?.taxId} onChange={(v) => w.set({ client: { ...w.client, taxId: v } })} />
        <TextIn label="Correu" value={w.client.email} onChange={(v) => w.set({ client: { ...w.client, email: v } })} />
        <TextIn label="Telèfon" value={w.client.phone} onChange={(v) => w.set({ client: { ...w.client, phone: v } })} />
        <TextIn label="Adreça" value={w.client.address} field={inv?.address} onChange={(v) => w.set({ client: { ...w.client, address: v } })} className="sm:col-span-2 lg:col-span-3" />
        <TextIn label="CUPS" value={w.cups} field={inv?.cups} onChange={(v) => w.set({ cups: v ?? "" })} className="lg:col-span-2" mono />
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-[14px] font-semibold">Subministrament</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="block">
            <span className="label">Energia</span>
            <select className="input" value={s.energyType} onChange={(e) => w.setSupply({ energyType: e.target.value as "luz" | "gas", accessTariff: e.target.value === "gas" ? "RL.1" : "2.0TD" })}>
              <option value="luz">Llum</option>
              <option value="gas">Gas</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Peatge d&apos;accés</span>
            <select className="input" value={normalizeTariff(s.accessTariff) ?? ""} onChange={(e) => w.setSupply({ accessTariff: e.target.value })}>
              {TARIFFS.filter((t) => (gas ? t.startsWith("RL") : !t.startsWith("RL"))).map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Territori (fiscalitat)</span>
            <select className="input" value={s.territory} onChange={(e) => w.setSupply({ territory: e.target.value as Territory })}>
              {TERRITORIES.map((t) => <option key={t} value={t}>{TERR_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Segment</span>
            <select className="input" value={s.segment ?? ""} onChange={(e) => w.setSupply({ segment: (e.target.value || null) as typeof s.segment })}>
              <option value="">Sense indicar</option>
              <option value="residencial">Residencial</option>
              <option value="pyme">Pime</option>
              <option value="industrial">Industrial</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Base de càlcul</span>
            <select className="input" value={s.basis} onChange={(e) => w.setSupply({ basis: e.target.value as typeof s.basis, days: e.target.value === "anual" ? 365 : s.days })}>
              <option value="anual">Consum anual (365 dies)</option>
              <option value="periode_facturat">Període facturat</option>
              <option value="anualitzat">Anualitzat (estimació)</option>
            </select>
          </label>
          <NumIn label="Dies del període" value={s.days} field={inv?.days} onChange={(v) => w.setSupply({ days: Math.max(1, Math.min(400, Math.round(v ?? 365))) })} />
        </div>
        {s.basis === "periode_facturat" && s.days < 360 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/[0.08] p-2.5 text-[12.5px]">
            Els consums corresponen a {s.days} dies. El càlcul serà del període facturat; per a un import anual cal anualitzar-los (estimació).
            <Button size="sm" onClick={annualize}>Anualitza (×365/{s.days})</Button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {Array.from({ length: per.energy }, (_, i) => (
            <NumIn key={i} label={gas ? "Consum (kWh)" : `Consum P${i + 1} (kWh)`} value={s.kwh[i]} src={w.sources.kwh} field={inv?.kwh[i]} onChange={(v) => {
                const kwh = setArr(s.kwh, i, v);
                // si es coneixen tots els períodes, el total és la seva suma (no es manté un total contradictori)
                w.setSupply({ kwh, kwhTotal: kwh.slice(0, per.energy).every((x) => x != null) && !gas ? null : gas ? v : s.kwhTotal });
              }} />
          ))}
          <NumIn label="Consum total (kWh)" value={s.kwhTotal ?? (sumKnown ? s.kwh.slice(0, per.energy).reduce<number>((a, x) => a + (x as number), 0) : null)} src={w.sources.kwhTotal ?? (sumKnown ? "calculat" : null)} onChange={(v) => w.setSupply({ kwhTotal: v })} />
        </div>
        {!sumKnown && s.kwhTotal != null && per.energy > 1 && (
          <p className="text-[12px] text-amber-700 dark:text-amber-300">Hi ha consum total però no el repartiment P1–P{per.energy}: les ofertes de preu únic es podran calcular; les de discriminació horària, no. No s&apos;inventa cap perfil.</p>
        )}
        {per.power > 0 && (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
            {Array.from({ length: per.power }, (_, i) => (
              <NumIn key={i} label={`Potència P${i + 1} (kW)`} value={s.kw[i]} src={w.sources.kw} field={inv?.kw[i]} onChange={(v) => w.setSupply({ kw: setArr(s.kw, i, v) })} />
            ))}
            <NumIn label="Lloguer comptador (€/mes)" value={s.meterRentEurMonth} field={inv?.meterRentEur} onChange={(v) => w.setSupply({ meterRentEurMonth: v })} />
            {s.territory === "canaries" && (
              <label className="flex items-end gap-2 pb-2 text-[12.5px]"><input type="checkbox" checked={!!s.residentialLowPower} onChange={(e) => w.setSupply({ residentialLowPower: e.target.checked })} /> Habitatge ≤ 10 kW</label>
            )}
          </div>
        )}
        {!gas && <HourlyCurve />}
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold">Contracte actual</h3>
          {cur ? (
            <Button size="sm" variant="ghost" onClick={() => w.setCurrent(null)}>No tinc els preus actuals</Button>
          ) : (
            <Button size="sm" onClick={() => w.setCurrent(emptySheet())}>Introdueix els preus actuals</Button>
          )}
        </div>
        {!cur ? (
          <Notice tone="blue">Sense preus actuals es compararan les ofertes entre elles. No es calcularà cap estalvi respecte del contracte vigent.</Notice>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <TextIn label="Comercialitzadora actual" value={w.currentRetailer} field={inv?.retailer} onChange={(v) => w.set({ currentRetailer: v ?? "" })} className="lg:col-span-2" />
              {!gas && (
                <label className="block">
                  <span className="label">Tipus de preu</span>
                  <select className="input" value={cur.contractType === "fix24h" ? "fix24h" : "periodes"} onChange={(e) => w.setCurrent({ contractType: e.target.value as "fix24h" | "periodes" })}>
                    <option value="periodes">Per períodes</option>
                    <option value="fix24h">Preu únic 24 h</option>
                  </select>
                </label>
              )}
              <label className="block">
                <span className="label">Preus</span>
                <select className="input" value={cur.taxTreatment} onChange={(e) => w.setCurrent({ taxTreatment: e.target.value as typeof cur.taxTreatment })}>
                  <option value="sense_impostos">Sense impostos</option>
                  <option value="amb_iee">Amb impost elèctric</option>
                  <option value="amb_iee_iva">Amb IEE i IVA</option>
                </select>
              </label>
              <label className="block">
                <span className="label">SAS</span>
                <select className="input" value={cur.sas.mode} onChange={(e) => w.setCurrent({ sas: { ...cur.sas, mode: e.target.value as SasMode } })}>
                  {(["inclos", "exclos", "variable"] as SasMode[]).map((m) => <option key={m} value={m}>{SAS_LABEL[m]}</option>)}
                </select>
              </label>
              {cur.sas.mode === "variable" && <NumIn label="SAS €/kWh" value={cur.sas.eurKwh} field={inv?.sasEurKwh} onChange={(v) => w.setCurrent({ sas: { ...cur.sas, eurKwh: v } })} />}
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {gas || cur.contractType === "fix24h" ? (
                <NumIn label="Preu energia (€/kWh)" value={cur.energy24h} field={inv?.energyPrice[0]} src={w.sources.prices} onChange={(v) => w.setCurrent({ energy24h: v })} />
              ) : (
                Array.from({ length: per.energy }, (_, i) => <NumIn key={i} label={`Energia P${i + 1} (€/kWh)`} value={cur.energy[i]} field={inv?.energyPrice[i]} src={w.sources.prices} onChange={(v) => w.setCurrent({ energy: setArr(cur.energy, i, v) })} />)
              )}
              {gas && <NumIn label="Terme fix (€/dia)" value={cur.gasFixedEurDay} field={inv?.gasFixedEurDay} onChange={(v) => w.setCurrent({ gasFixedEurDay: v })} />}
            </div>
            {!gas && <EnergyBreakdownPanel />}
            {per.power > 0 && (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
                {Array.from({ length: per.power }, (_, i) => <NumIn key={i} label={`Potència P${i + 1}`} value={cur.power[i]} field={inv?.powerPrice[i]} src={w.sources.prices} onChange={(v) => w.setCurrent({ power: setArr(cur.power, i, v) })} />)}
                <label className="block">
                  <span className="label">Unitat de potència</span>
                  <select className="input" value={cur.powerUnit} onChange={(e) => w.setCurrent({ powerUnit: e.target.value as PowerUnit })}>
                    {(Object.keys(POWER_UNIT_LABEL) as PowerUnit[]).map((u) => <option key={u} value={u}>{POWER_UNIT_LABEL[u]}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <NumIn label="Quotes / serveis (€/mes)" value={cur.fees.reduce((a, f) => a + f.eurMonth, 0) || null} onChange={(v) => w.setCurrent({ fees: v ? [{ concept: "Quotes i serveis", eurMonth: v }] : [] })} />
              <NumIn label="Descompte sobre energia (%)" value={cur.discounts.find((d) => d.base === "energia")?.pct ?? null} onChange={(v) => w.setCurrent({ discounts: v ? [{ concept: "Descompte actual", pct: Math.min(100, v), eurYear: null, base: "energia" }] : [] })} />
            </div>
          </>
        )}
      </section>

      <SurplusSection />

      <section className="rounded-2xl border border-line bg-surface p-4">
        <label className="label" htmlFor="cmp-obs">Observacions per a la proposta (opcional)</label>
        <textarea id="cmp-obs" className="input min-h-[70px]" value={w.observations} onChange={(e) => w.set({ observations: e.target.value })} />
        {w.dataNotes.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12px] text-muted">{w.dataNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </section>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => w.set({ step: 1 })}>Enrere</Button>
        <Button variant="primary" onClick={() => w.set({ step: 3 })}>Continua: tria les ofertes</Button>
      </div>
    </div>
  );
}

function TextIn({ label, value, onChange, field, className, mono }: { label: string; value: string | null; onChange: (v: string | null) => void; field?: Field<unknown>; className?: string; mono?: boolean }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-muted">
        {label}
        {field?.value != null && field.page && <span className="text-[9.5px]">p.{field.page}</span>}
        {field?.value != null && field.confirm && <span className="rounded bg-amber-500/15 px-1 text-[9.5px] font-semibold text-amber-700 dark:text-amber-300">confirmar</span>}
      </span>
      <input className={cn("input", mono && "font-mono", field?.value != null && field.confirm && "border-amber-400")} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
    </label>
  );
}

/** Corba de consum horari (CSV de Datadis o de la distribuïdora): permet calcular les tarifes Open hora a hora. */
function HourlyCurve() {
  const w = useWizard();
  const h = w.supply.hourly ?? null;
  const [msg, setMsg] = useState<string | null>(null);
  const load = async (f: File) => {
    const { rows, warnings } = parseHourlyCsv(await f.text());
    if (!rows.length) { setMsg(warnings.join(" · ") || "No s'ha pogut llegir la corba"); return; }
    if (rows.length > 9000) { setMsg("La corba té més de 9.000 hores: deixa'n només 12 mesos."); return; }
    w.setSupply({ hourly: rows });
    setMsg(warnings.join(" · ") || null);
  };
  const kwh = h ? h.reduce((a, x) => a + x.kwh, 0) : 0;
  return (
    <div className="rounded-xl border border-dashed border-line p-3 text-[12.5px]">
      <p className="font-medium">Consum horari real (opcional)</p>
      <p className="text-muted">Amb la corba horària, les tarifes Open d&apos;Endesa es calculen aplicant el preu Open o No Open a cada hora. Sense corba, es fan servir els preus estimats per ponderació horària.</p>
      {h ? (
        <p className="mt-2 flex flex-wrap items-center gap-2"><Badge tone="green">{h.length} hores · {Math.round(kwh).toLocaleString("ca-ES")} kWh</Badge><span className="text-muted">{h[0]?.date} – {h[h.length - 1]?.date}</span><Button size="sm" variant="ghost" onClick={() => w.setSupply({ hourly: null })}>Treu la corba</Button></p>
      ) : (
        <DropZone className="mt-2 p-4" accept=".csv,.txt,text/csv" onFiles={([f]) => void load(f)} onReject={setMsg}>
          <span className="font-medium">Arrossega aquí el CSV de consum horari o fes clic</span>
          <span className="text-[11px] text-muted">Columnes de data, hora i consum (kWh) · separador «;» o «,»</span>
        </DropZone>
      )}
      {msg && <p className="mt-1 text-[11.5px] text-amber-700 dark:text-amber-300">{msg}</p>}
    </div>
  );
}
