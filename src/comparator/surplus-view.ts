/**
 * Fase 2 · Taula «Excedents fotovoltaics» compartida per la pantalla i el PDF (mateix resultat, mateixos textos).
 * Només té files quan el subministrament té excedents.
 */
import { surplusKwh } from "./engine";
import { presentationOrder, type Snapshot } from "./snapshot";
import type { CostResult } from "./types";

type Lang = "ca" | "es";
const eur = (n: number | null | undefined, lang: Lang) => (n == null ? "—" : (Object.is(n, -0) ? 0 : n).toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { style: "currency", currency: "EUR" }));
const nf = (n: number | null | undefined, d: number, lang: Lang) => (n == null ? "—" : n.toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { maximumFractionDigits: d }));

const L = {
  ca: { grid: "Consum kWh", energy: "Cost energia", power: "Cost potència", kwh: "Excedents kWh", price: "Preu excedents €/kWh", comp: "Compensació", battery: "Bateria virtual", net: "Cost total net", saving: "Estalvi", notInf: "No informat", pending: "Pendent", toBattery: "al saldo", fee: "quota", lost: "no compensats", title: "Excedents fotovoltaics", balance: "Saldo acumulat actual a la bateria virtual" },
  es: { grid: "Consumo kWh", energy: "Coste energía", power: "Coste potencia", kwh: "Excedentes kWh", price: "Precio excedentes €/kWh", comp: "Compensación", battery: "Batería virtual", net: "Coste total neto", saving: "Ahorro", notInf: "No informado", pending: "Pendiente", toBattery: "al saldo", fee: "cuota", lost: "no compensados", title: "Excedentes fotovoltaicos", balance: "Saldo acumulado actual en la batería virtual" },
} as const;

export interface SurplusView { title: string; columns: string[]; rows: { label: string; cells: string[] }[]; notes: string[]; balance: string | null }

export function hasSurplus(s: Pick<Snapshot, "supply">): boolean {
  return (surplusKwh(s.supply) ?? 0) > 0;
}

export function surplusView(s: Snapshot, lang: Lang = "ca"): SurplusView | null {
  if (!hasSurplus(s)) return null;
  const t = L[lang];
  const alts = presentationOrder(s);
  const cols: { name: string; c: CostResult | null; saving: number | null }[] = [
    { name: s.currentRetailer ?? (lang === "es" ? "Actual" : "Actual"), c: s.result.current, saving: null },
    ...alts.map((e) => ({ name: e.offer.supplierName, c: e.cost as CostResult | null, saving: e.saving })),
  ];
  const grid = s.supply.kwhTotal ?? s.supply.kwh.reduce<number>((a, x) => a + (x ?? 0), 0);
  const row = (label: string, f: (c: CostResult | null, i: number) => string) => ({ label, cells: cols.map((col, i) => f(col.c, i)) });
  const rows = [
    row(t.grid, () => nf(grid, 0, lang)),
    row(t.energy, (c) => (c?.ok ? eur(c.energy, lang) : "—")),
    row(t.power, (c) => (c?.ok ? eur(c.power, lang) : "—")),
    row(t.kwh, (c) => nf(c?.surplus?.kwh ?? null, 0, lang)),
    row(t.price, (c) => (!c?.surplus ? "—" : c.surplus.priceEurKwh != null ? nf(c.surplus.priceEurKwh, 6, lang) : c.surplus.status === "no_informada" ? t.notInf : t.pending)),
    row(t.comp, (c) => (c?.surplus ? `−${eur(c.surplus.compensationEur, lang)}` : "—")),
    row(t.battery, (c) => {
      const x = c?.surplus;
      if (!x) return "—";
      if (x.toBatteryEur > 0 || x.batteryFeeEur > 0) return `${eur(x.toBatteryEur, lang)} ${t.toBattery}${x.batteryFeeEur ? ` · ${t.fee} ${eur(x.batteryFeeEur, lang)}` : ""}`;
      return x.lostEur > 0 ? `${eur(x.lostEur, lang)} ${t.lost}` : "—";
    }),
    row(t.net, (c) => (c?.ok ? eur(c.total, lang) : "—")),
    row(t.saving, (_c, i) => (i === 0 ? "" : cols[i].saving == null ? "—" : eur(cols[i].saving, lang))),
  ];
  const notes = [...new Set(cols.map((c) => c.c?.surplus?.note).filter((n): n is string => !!n))];
  const sur = s.supply.surplus;
  const balance = sur?.battery && sur.batteryBalanceEur != null ? `${t.balance}: ${eur(sur.batteryBalanceEur, lang)}` : null;
  return { title: t.title, columns: cols.map((c) => c.name), rows, notes, balance };
}
