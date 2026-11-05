"use client";
/**
 * SIMULAR DESCOMPTES (lector de tarifes, catàleg i comparador).
 * Les opcions es generen a partir del text de descomptes del document: no se n'ofereix cap que no hi aparegui.
 * Mostra el preu sense descompte, amb el descompte base i amb les promocions condicionades que es marquin,
 * comprova l'elegibilitat per consum, el cost dels serveis i compara el 1r i el 2n any.
 */
import { useMemo, useState } from "react";
import { Percent } from "lucide-react";
import { hasYear2, parseDiscount, simulateDiscounts, simulatorOptions, TARGET_LABEL } from "@/comparator/tariff-discounts";
import { Badge, Button, Modal, Notice } from "../../components/ui";
import type { OfferVersion } from "@/comparator/types";

/** Font del simulador a partir d'una oferta del catàleg (només si porta els preus originals i el text de descomptes). */
export function simSourceFromOffer(o: OfferVersion, supply?: { kwh?: (number | null)[]; kw?: (number | null)[] } | null): SimulatorSource | null {
  const t = o.template;
  if (!t?.original || !t.discountText || o.contractType === "indexat") return null;
  const gas = o.energyType === "gas";
  const periods = gas ? 1 : /^2\.0/.test(o.accessTariff) ? 3 : 6;
  return { title: `${o.supplierName} · ${o.productName}`, energy: t.original.energy, power: t.original.power, powerUnit: t.original.powerUnit ?? o.powerUnit, discountText: t.discountText, energyType: gas ? "gas" : "luz", periods, supply: supply ?? null };
}

const f6 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { minimumFractionDigits: 6, maximumFractionDigits: 6 }));
const eur = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));
const numIn = (s: string) => { const n = Number(s.replace(",", ".")); return s.trim() === "" || !Number.isFinite(n) ? null : n; };

export interface SimulatorSource {
  title: string;
  energy: (number | null)[]; // preus ORIGINALS P1..P6 (sense descompte)
  power: (number | null)[];
  powerUnit: "eur_kw_any" | "eur_kw_dia" | "eur_kw_mes";
  discountText: string | null;
  energyType: "luz" | "gas";
  periods: number;
  supply?: { kwh?: (number | null)[]; kw?: (number | null)[] } | null;
}

export function SimulateDiscountsButton({ source, size = "sm" }: { source: SimulatorSource; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="ghost" onClick={() => setOpen(true)} data-testid="simulate-discounts"><Percent size={13} /> SIMULAR DESCOMPTES</Button>
      {open && <DiscountSimulator source={source} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DiscountSimulator({ source, onClose }: { source: SimulatorSource; onClose: () => void }) {
  const d = useMemo(() => parseDiscount(source.discountText, source.energyType), [source.discountText, source.energyType]);
  const opts = useMemo(() => simulatorOptions(d), [d]);
  const [year, setYear] = useState<1 | 2>(1);
  const [conds, setConds] = useState<string[]>([]);
  const [mwh, setMwh] = useState(() => { const t = source.supply?.kwh?.reduce<number>((a, b) => a + (b ?? 0), 0); return t ? String(Math.round(t / 100) / 10) : ""; });
  const [kwh, setKwh] = useState<string[]>(() => Array.from({ length: source.periods }, (_, i) => (source.supply?.kwh?.[i] != null ? String(source.supply.kwh[i]) : "")));
  const [kw, setKw] = useState<string[]>(() => Array.from({ length: source.periods }, (_, i) => (source.supply?.kw?.[i] != null ? String(source.supply.kw[i]) : "")));
  const [svc, setSvc] = useState("");
  const [comb, setComb] = useState<"suma" | "successiu">("suma");
  const r = useMemo(() => simulateDiscounts(
    { energy: source.energy, power: source.power, powerUnit: source.powerUnit, discount: d, energyType: source.energyType },
    { year, conditions: conds, annualMWh: numIn(mwh), consumptionKwh: kwh.map(numIn), powerKw: kw.map(numIn), serviceCostEurMonth: numIn(svc), combination: comb },
  ), [source, d, year, conds, mwh, kwh, kw, svc, comb]);
  const P = Array.from({ length: source.periods }, (_, i) => i);
  return (
    <Modal open onClose={onClose} width="max-w-4xl" title={`Simular descomptes · ${source.title}`}>
      <div className="space-y-3 text-[12.5px]" data-testid="discount-simulator">
        <p className="rounded-xl bg-elevated px-3 py-2"><b>Condicions del document:</b> {d.raw || "—"}{d.restriction ? ` · ${d.restriction}` : ""}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="label">Any de contracte</span>
            <select className="input h-8 w-auto py-0" value={year} onChange={(e) => setYear(Number(e.target.value) as 1 | 2)} aria-label="Any de contracte"><option value={1}>1r any</option><option value={2}>2n any</option></select></label>
          <label className="block"><span className="label">Consum anual (MWh)</span><input className="input h-8 w-28" value={mwh} onChange={(e) => setMwh(e.target.value)} aria-label="Consum anual" /></label>
          <label className="block"><span className="label">Cost dels serveis (€/mes)</span><input className="input h-8 w-28" value={svc} onChange={(e) => setSvc(e.target.value)} aria-label="Cost dels serveis" /></label>
          <label className="block"><span className="label">Si se'n combinen dos</span>
            <select className="input h-8 w-auto py-0" value={comb} onChange={(e) => setComb(e.target.value as typeof comb)} aria-label="Combinació"><option value="suma">Se sumen (20 % + 5 % = 25 %)</option><option value="successiu">Successius (24 %)</option></select></label>
        </div>
        {opts.length > 0 ? (
          <fieldset className="rounded-xl border border-line p-2">
            <legend className="px-1 text-[11px] font-semibold uppercase text-muted">Promocions condicionades del document</legend>
            <div className="flex flex-wrap gap-3">{opts.map((o) => (
              <label key={o.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={conds.includes(o.id) || o.type === "consum"} disabled={o.type === "consum"} onChange={(e) => setConds((c) => (e.target.checked ? [...c, o.id] : c.filter((x) => x !== o.id)))} />
                {o.label}{o.type === "consum" && <span className="text-[11px] text-muted">(es comprova amb el consum)</span>}
              </label>))}</div>
          </fieldset>
        ) : <p className="text-muted">El document no indica cap promoció condicionada per a aquesta tarifa.</p>}
        {(d.ambiguous.length > 0 || d.conditionalNotes.length > 0) && <Notice>{[...d.ambiguous, ...d.conditionalNotes].join(" · ")}</Notice>}
        {r.pendingFormula && <Notice tone="blue">{r.pendingFormula}</Notice>}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[12px]">
            <thead className="bg-elevated text-left text-[10.5px] uppercase text-muted"><tr><th className="px-2 py-1">{source.energyType === "gas" ? "Terme" : "Període"}</th>{P.map((i) => <th key={i} className="px-2">{source.energyType === "gas" ? "variable" : `P${i + 1}`}</th>)}</tr></thead>
            <tbody className="tnum">
              <tr className="border-t border-line"><td className="px-2 py-1">Energia sense descompte</td>{P.map((i) => <td key={i} className="px-2">{f6(r.noDiscount.energy[i])}</td>)}</tr>
              <tr className="border-t border-line"><td className="px-2 py-1">Amb el descompte base</td>{P.map((i) => <td key={i} className="px-2">{f6(r.base.energy[i])}</td>)}</tr>
              <tr className="border-t border-line font-semibold"><td className="px-2 py-1">Final simulat</td>{P.map((i) => <td key={i} className="px-2" data-testid={`sim-e${i + 1}`}>{f6(r.final.energy[i])}</td>)}</tr>
              {source.energyType === "luz" && <tr className="border-t border-line"><td className="px-2 py-1">Potència (original → final)</td>{P.map((i) => <td key={i} className="px-2">{f6(r.noDiscount.power[i])} → {f6(r.final.power[i])}</td>)}</tr>}
              <tr className="border-t border-line"><td className="px-2 py-1">Consum (kWh)</td>{P.map((i) => <td key={i} className="px-1"><input className="input h-7 w-24 py-0" value={kwh[i]} onChange={(e) => setKwh((x) => x.map((y, j) => (j === i ? e.target.value : y)))} aria-label={`Consum P${i + 1}`} /></td>)}</tr>
              {source.energyType === "luz" && <tr className="border-t border-line"><td className="px-2 py-1">Potència contractada (kW)</td>{P.map((i) => <td key={i} className="px-1"><input className="input h-7 w-24 py-0" value={kw[i]} onChange={(e) => setKw((x) => x.map((y, j) => (j === i ? e.target.value : y)))} aria-label={`Potència P${i + 1}`} /></td>)}</tr>}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-xl border border-line p-2">
            <b>Descomptes aplicats</b>
            <ul className="mt-1 space-y-0.5">{r.applied.length ? r.applied.map((a, i) => <li key={i}>✓ {a.label}: {a.value} sobre {a.on.map((t) => TARGET_LABEL[t]).join(" i ")}</li>) : <li className="text-muted">Cap</li>}</ul>
            {r.notEligible.map((n, i) => <p key={i} className="text-amber-700 dark:text-amber-300">✗ {n.label}: {n.reason}</p>)}
            {year === 2 && !hasYear2(d) && <p className="text-muted">El document no diu res específic del 2n any.</p>}
          </div>
          <div className="rounded-xl border border-line p-2" data-testid="sim-cost">
            <b>Cost anual estimat (energia + potència, sense impostos)</b>
            {r.cost ? (
              <ul className="mt-1 space-y-0.5 tnum">
                <li>Sense descompte: {eur(r.cost.noDiscount)}</li><li>Amb el descompte base: {eur(r.cost.base)}</li><li>Final simulat: <b>{eur(r.cost.final)}</b></li>
                <li>Cost dels serveis: {eur(r.cost.services)}</li><li>Estalvi net estimat: <Badge tone={(r.cost.netSaving ?? 0) >= 0 ? "green" : "red"}>{eur(r.cost.netSaving)}</Badge></li>
              </ul>
            ) : <p className="text-muted">Introdueix el consum per períodes per calcular el cost.</p>}
          </div>
        </div>
        {r.notes.map((n, i) => <p key={i} className="text-[11.5px] text-muted">{n}</p>)}
        <p className="text-[11px] text-muted">Simulació orientativa: no canvia la tarifa del catàleg ni s&apos;aplica sola a cap comparativa.</p>
      </div>
    </Modal>
  );
}
