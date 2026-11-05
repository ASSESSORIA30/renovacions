"use client";
/**
 * Fase 2 · Desglossament del preu de l'energia de la factura i excedents fotovoltaics.
 * - El preu total per període es mostra amb el detall desplegable (energia lliure + ATR + …).
 * - Els components es poden corregir a mà: es guarden els valors originals i es recalcula el total.
 * - Els excedents es compten a part del consum de xarxa.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { ENERGY_CONCEPT_LABEL, type EnergyComponent } from "@/comparator/energy-breakdown";
import { recomputeBreakdown } from "@/comparator/invoice";
import { SURPLUS_MODE_LABEL, SURPLUS_MODES, type Num, type SupplySurplus, type SurplusMode } from "@/comparator/types";
import { Badge, Button, cn } from "../../components/ui";
import { useWizard } from "./state";
import { NumIn } from "./StepValidate";

const fmt = (v: number | null, d = 6) => (v == null ? "—" : v.toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: d }));
const STATUS: Record<string, { label: string; tone: string }> = {
  reconstruit: { label: "reconstruït", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  directe: { label: "directe", tone: "bg-ink/[0.06]" },
  pendent: { label: "pendent", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

/** Preu total per període amb el desglossament (només quan la factura separa l'energia en components). */
export function EnergyBreakdownPanel() {
  const w = useWizard();
  const inv = w.invoice;
  const [open, setOpen] = useState<number | null>(null);
  const comps = inv?.data.energyComponents ?? [];
  const br = inv?.data.energyBreakdown ?? [];
  if (!inv || !comps.length || !br.length) return null;

  const update = (next: EnergyComponent[]) => {
    const data = { ...inv.data, energyComponents: next };
    const { breakdown, prices } = recomputeBreakdown(data, next);
    data.energyBreakdown = breakdown;
    w.set({ invoice: { ...inv, data } });
    if (w.current) {
      const energy = w.current.energy.map((x, i) => (breakdown.some((b) => b.period === i + 1) ? prices[i] : x));
      w.setCurrent({ energy });
    }
  };
  const edit = (idx: number, patch: Partial<EnergyComponent>) =>
    update(comps.map((c, i) => (i === idx ? { ...c, ...patch, method: "manual" as const, original: c.original ?? { kwh: c.kwh, unitPrice: c.unitPrice, amount: c.amount } } : c)));
  const restore = (idx: number) => update(comps.map((c, i) => (i === idx && c.original ? { ...c, ...c.original, method: "text" as const } : c)));

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold">Preu de l&apos;energia per període (desglossat a la factura)</h4>
        <span className="text-[11.5px] text-muted">Total = energia lliure + ATR + altres conceptes − descomptes. Res no es compta dues vegades.</span>
      </div>
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[11px] text-muted">
          <tr><th className="py-1">Període</th><th>Preu total (€/kWh)</th><th>Estat</th><th>Nota</th></tr>
        </thead>
        <tbody>
          {br.map((b) => (
            <FragmentRow key={b.period}>
              <tr className="border-t border-line">
                <td className="py-1.5">
                  <button className="inline-flex items-center gap-1 font-medium" onClick={() => setOpen(open === b.period ? null : b.period)} aria-expanded={open === b.period}>
                    {open === b.period ? <ChevronDown size={14} /> : <ChevronRight size={14} />} P{b.period}
                  </button>
                </td>
                <td className="tnum font-semibold">{b.status === "pendent" ? "Pendent" : fmt(b.total)}</td>
                <td><span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold", STATUS[b.status]?.tone)}>{STATUS[b.status]?.label}</span></td>
                <td className="text-[11.5px] text-muted">{b.note ?? ""}</td>
              </tr>
              {open === b.period && (
                <tr>
                  <td colSpan={4} className="pb-2">
                    <div className="space-y-1.5 rounded-lg bg-ink/[0.03] p-2">
                      {comps.map((c, idx) => c.period !== b.period ? null : (
                        <div key={idx} className="grid items-end gap-2 sm:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
                          <div className="text-[12px]">
                            <b>{ENERGY_CONCEPT_LABEL[c.concept]}</b>
                            <div className="text-[11px] text-muted">{c.label}{c.page ? ` · p.${c.page}` : ""} · {c.method === "manual" ? "corregit a mà" : c.method === "ia" ? "lectura IA" : "lectura del text"}</div>
                          </div>
                          <NumIn label="kWh" value={c.kwh} onChange={(v) => edit(idx, { kwh: v })} />
                          <NumIn label="Preu (€/kWh)" value={c.unitPrice} onChange={(v) => edit(idx, { unitPrice: v })} />
                          <NumIn label="Import (€)" value={c.amount} onChange={(v) => edit(idx, { amount: v })} />
                          {c.method === "manual" && c.original ? (
                            <Button size="sm" variant="ghost" onClick={() => restore(idx)} title={`Original: ${fmt(c.original.unitPrice)} €/kWh · ${fmt(c.original.amount, 2)} €`}><RotateCcw size={13} /> Original</Button>
                          ) : <span />}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </FragmentRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const emptySupplySurplus = (): SupplySurplus => ({ kwhTotal: null, monthly: null, byPeriod: null, currentCompensationEur: null, currentMode: null, battery: false, batteryBalanceEur: null, estimated: false });

/** Excedents fotovoltaics del subministrament (separats del consum de xarxa). */
export function SurplusSection() {
  const w = useWizard();
  const s = w.supply;
  const sur = s.surplus ?? null;
  const inv = w.invoice?.data;
  const [byPeriod, setByPeriod] = useState(!!sur?.byPeriod);
  if (s.energyType === "gas") return null;
  const set = (patch: Partial<SupplySurplus>) => w.setSupply({ surplus: { ...(sur ?? emptySupplySurplus()), ...patch } });
  const setArr = (arr: Num[] | null, i: number, v: Num, n: number) => (arr ?? Array(n).fill(null)).map((x, j) => (j === i ? v : x));

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">Excedents fotovoltaics</h3>
        {sur ? (
          <Button size="sm" variant="ghost" onClick={() => w.setSupply({ surplus: null })}>Sense autoconsum amb excedents</Button>
        ) : (
          <Button size="sm" onClick={() => w.setSupply({ surplus: emptySupplySurplus() })}>Té excedents</Button>
        )}
      </div>
      {!sur ? (
        <p className="text-[12.5px] text-muted">Si el client té plaques amb excedents, afegeix-los: es comparen a part del consum de xarxa i es calcula la compensació de cada oferta.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <NumIn label="Excedents (kWh)" value={sur.kwhTotal} field={inv?.surplusKwh} src={inv?.surplusKwh?.value != null ? "factura" : "manual"} onChange={(v) => set({ kwhTotal: v })} />
            <NumIn label="Compensació actual (€)" value={sur.currentCompensationEur} field={inv?.surplusCompensationEur} onChange={(v) => set({ currentCompensationEur: v })} />
            <label className="block">
              <span className="label">Modalitat actual</span>
              <select className="input" value={sur.currentMode ?? ""} onChange={(e) => set({ currentMode: (e.target.value || null) as SurplusMode | null })}>
                <option value="">Sense indicar</option>
                {SURPLUS_MODES.map((m) => <option key={m} value={m}>{SURPLUS_MODE_LABEL[m]}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-[12.5px]"><input type="checkbox" checked={sur.battery} onChange={(e) => set({ battery: e.target.checked })} /> Bateria virtual</label>
            {sur.battery && <NumIn label="Saldo bateria (€)" value={sur.batteryBalanceEur} field={inv?.batteryBalanceEur} onChange={(v) => set({ batteryBalanceEur: v })} />}
            <label className="flex items-end gap-2 pb-2 text-[12.5px]"><input type="checkbox" checked={sur.estimated} onChange={(e) => set({ estimated: e.target.checked })} /> Valors estimats</label>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <button className={cn("rounded-lg px-2 py-1", byPeriod ? "bg-ink/[0.06]" : "underline")} onClick={() => { setByPeriod(!byPeriod); if (byPeriod) set({ byPeriod: null }); }}>
              {byPeriod ? "Treu el repartiment per períodes" : "Afegeix repartiment per períodes"}
            </button>
            <button className={cn("rounded-lg px-2 py-1", sur.monthly ? "bg-ink/[0.06]" : "underline")} onClick={() => set({ monthly: sur.monthly ? null : Array(12).fill(null) })}>
              {sur.monthly ? "Treu el detall mensual" : "Afegeix detall mensual"}
            </button>
          </div>
          {byPeriod && (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, i) => <NumIn key={i} label={`Excedents P${i + 1} (kWh)`} value={sur.byPeriod?.[i] ?? null} onChange={(v) => set({ byPeriod: setArr(sur.byPeriod, i, v, 6) })} />)}
            </div>
          )}
          {sur.monthly && (
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-12">
              {Array.from({ length: 12 }, (_, i) => <NumIn key={i} label={`Mes ${i + 1}`} value={sur.monthly?.[i] ?? null} onChange={(v) => set({ monthly: setArr(sur.monthly, i, v, 12) })} />)}
            </div>
          )}
          {sur.kwhTotal == null && !sur.byPeriod?.some((x) => x != null) && <Badge tone="amber">Falten els kWh excedentaris: no es calcularà cap compensació.</Badge>}
        </>
      )}
    </section>
  );
}
