"use client";
/**
 * SIMULADOR DE MARGES (tarifes amb matriu comercial, p. ex. Nufri). Reutilitza el motor de comparatives (`computeCost`)
 * per al cost del client i `commercialCommission` per a la comissió: no hi ha cap motor nou.
 * Qualsevol canvi (nivell, marge BOE, potències, consum, dies, % del col·laborador) es recalcula a l'instant.
 * Les comissions només les veu qui té accés a les dades econòmiques (Direcció o Administració autoritzada).
 */
import { useEffect, useMemo, useState } from "react";
import { levelOf, marginTable, selectionOf, type CommercialSelection } from "@/comparator/commercial";
import { periodsOf } from "@/comparator/engine";
import type { OfferVersion, SupplyInput } from "@/comparator/types";
import { Badge, cn } from "../../components/ui";
import { fApi } from "../finance/api";

const eur = (n: number | string | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));
const f6 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { minimumFractionDigits: 6, maximumFractionDigits: 6 }));
const toNum = (s: string) => { const t = s.replace(/\s/g, "").replace(",", "."); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Selector de nivell d'energia i marge BOE (comparatives i simulador). */
export function CommercialPicker({ offer, value, onChange }: { offer: OfferVersion; value: Partial<CommercialSelection> | null | undefined; onChange: (s: CommercialSelection) => void }) {
  const m = offer.commercial;
  const sel = selectionOf(offer, value);
  if (!m || !sel) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <label className="block"><span className="label">Nivell d&apos;energia</span>
        <select className="input h-8 py-0" value={sel.level} onChange={(e) => onChange({ ...sel, level: e.target.value })} aria-label="Nivell d'energia">
          {m.levels.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select></label>
      {m.margins.length > 0 && (
        <label className="block"><span className="label">Marge de potència</span>
          <select className="input h-8 py-0" value={sel.margin ?? ""} onChange={(e) => onChange({ ...sel, margin: e.target.value })} aria-label="Marge de potència">
            {m.margins.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select></label>
      )}
    </div>
  );
}

type RuleRow = { rule_key: string; version: number; value: string | null; status: string };

/** €/MWh del nivell segons les regles de comissió (aprovada o pendent d'aprovació). null si no n'hi ha o no hi ha accés. */
function useLevelRules(): { rules: RuleRow[] | null; econ: boolean } {
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [econ, setEcon] = useState(false);
  useEffect(() => {
    // només qui té accés a les dades econòmiques (Direcció o Administració autoritzada) veu les comissions
    fApi.get<{ econ: boolean }>("access")
      .then((a) => (a.econ ? fApi.get<{ rules: RuleRow[] }>("rules").then((r) => { setRules(r.rules); setEcon(true); }) : undefined))
      .catch(() => undefined);
  }, []);
  return { rules, econ };
}
export function levelRule(rules: RuleRow[] | null, levelId: string): { value: number; status: string; version: number } | null {
  const key = `nufri_llum_${levelId.toLowerCase()}`;
  const r = (rules ?? []).filter((x) => x.rule_key === key && x.status !== "retirada" && x.value != null).sort((a, b) => b.version - a.version)[0];
  return r ? { value: Number(r.value), status: r.status, version: r.version } : null;
}

export function MarginSimulator({ offer }: { offer: OfferVersion }) {
  const m = offer.commercial!;
  const per = periodsOf(offer.accessTariff, offer.energyType);
  const [sel, setSel] = useState<CommercialSelection>(selectionOf(offer, null)!);
  const [kw, setKw] = useState<(number | null)[]>(Array(6).fill(null));
  const [kwh, setKwh] = useState<(number | null)[]>(Array(6).fill(null));
  const [annual, setAnnual] = useState<number | null>(null);
  const [days, setDays] = useState(365);
  const [pct, setPct] = useState<number | null>(null);
  const { rules, econ } = useLevelRules();
  const showCom = econ;
  const rule = levelRule(rules, sel.level);
  const byPeriod = kwh.slice(0, per.energy).every((x) => x != null);
  const annualKwh = annual ?? (byPeriod ? kwh.slice(0, per.energy).reduce<number>((a, x) => a + (x ?? 0), 0) : null);
  const supply: SupplyInput = useMemo(() => ({
    energyType: offer.energyType, accessTariff: offer.accessTariff, territory: "peninsula", segment: null, days, basis: days === 365 ? "anual" : "periode_facturat",
    kwh: byPeriod ? kwh : Array(6).fill(null), kwhTotal: byPeriod ? null : annual != null ? Math.round((annual * days) / 365) : null, kw, meterRentEurMonth: null,
  }), [offer, days, kwh, kw, annual, byPeriod]);
  const rows = useMemo(() => marginTable(offer, supply, { level: sel.level, selected: sel.margin, energyEurMwh: rule?.value ?? null, collaboratorPct: pct, annualKwh, months: Math.round((days * 12) / 365) || 12 }), [offer, supply, sel, rule, pct, annualKwh, days]);
  const cur = rows.find((r) => r.selected) ?? rows[0];
  const lv = levelOf(m, sel.level);
  const set = (arr: (number | null)[], i: number, v: number | null) => arr.map((x, j) => (j === i ? v : x));

  return (
    <div className="space-y-3 text-[12.5px]" data-testid="simulador-marges">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="font-semibold">Dades del client</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Array.from({ length: per.power }, (_, i) => <label key={i} className="block"><span className="label">P{i + 1} kW</span><input className="input h-8" inputMode="decimal" onChange={(e) => setKw(set(kw, i, toNum(e.target.value)))} aria-label={`Potència P${i + 1}`} /></label>)}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Array.from({ length: per.energy }, (_, i) => <label key={i} className="block"><span className="label">{per.energy === 1 ? "kWh" : `P${i + 1} kWh`}</span><input className="input h-8" inputMode="decimal" onChange={(e) => setKwh(set(kwh, i, toNum(e.target.value)))} aria-label={`Consum P${i + 1}`} /></label>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="block"><span className="label">Consum anual (kWh)</span><input className="input h-8 w-36" inputMode="decimal" placeholder={byPeriod ? String(annualKwh ?? "") : ""} onChange={(e) => setAnnual(toNum(e.target.value))} aria-label="Consum anual" /></label>
            <label className="block"><span className="label">Dies</span><input className="input h-8 w-20" inputMode="numeric" defaultValue={365} onChange={(e) => setDays(Math.max(1, Math.min(400, Math.round(toNum(e.target.value) ?? 365))))} aria-label="Dies" /></label>
            {showCom && <label className="block"><span className="label">% col·laborador</span><input className="input h-8 w-24" inputMode="decimal" onChange={(e) => setPct(toNum(e.target.value))} aria-label="Percentatge del col·laborador" /></label>}
          </div>
          <CommercialPicker offer={offer} value={sel} onChange={setSel} />
          <p className="text-muted">Preus del client ({lv.label}{sel.margin ? ` · ${sel.margin}` : ""}): energia {(offer.contractType === "fix24h" ? [lv.energy24h] : lv.energy.slice(0, per.energy)).map(f6).join(" / ")} €/kWh · potència {cur.power.slice(0, per.power).map(f6).join(" / ")} €/kW·dia</p>
        </div>
        <div className="space-y-1.5 rounded-xl border border-brand/40 bg-brand/[0.04] p-3">
          <p className="font-semibold">Resultat · {cur.margin.label}</p>
          <p>Cost de potència del client: <b>{eur(cur.clientPower)}</b>{cur.diffPowerVsBase ? <span className="text-muted"> ({cur.diffPowerVsBase > 0 ? "+" : ""}{eur(cur.diffPowerVsBase)} respecte de {rows[0].margin.label})</span> : null}</p>
          <p>Cost total estimat del subministrament: <b>{cur.clientTotal != null ? eur(cur.clientTotal) : "— (falta el consum per períodes)"}</b></p>
          {showCom ? (
            <>
              <p>Comissió d&apos;energia: <b>{eur(cur.commission.energy)}</b> <span className="text-muted">({cur.commission.formulaEnergy})</span>
                {rule ? <Badge tone={rule.status === "aprovada" ? "green" : "amber"} className="ml-1">{rule.status === "aprovada" ? `regla v${rule.version} aprovada` : "regla pendent d'aprovació"}</Badge> : <Badge tone="red" className="ml-1">sense regla per a {lv.label}</Badge>}</p>
              <p>Comissió de potència: <b>{eur(cur.commission.power)}</b> <span className="text-muted">({cur.commission.formulaPower})</span></p>
              <p>Comissió total prevista: <b>{eur(cur.commission.total)}</b> · col·laborador: <b>{eur(cur.commission.collaborator)}</b> · Assessoria 3.0: <b>{eur(cur.commission.remainder)}</b></p>
              {cur.commission.missing.length > 0 && <p className="text-amber-700 dark:text-amber-300">Falta: {cur.commission.missing.join(", ")}</p>}
            </>
          ) : <p className="text-muted">Les comissions només les veu Direcció o l&apos;Administració autoritzada.</p>}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] tnum">
          <thead className="bg-elevated text-[11px] text-muted"><tr>
            <th className="px-2 py-1.5 text-left">Modalitat</th>
            {Array.from({ length: per.power }, (_, i) => <th key={i} className="px-2 py-1.5 text-right">P{i + 1} €/kW·dia</th>)}
            <th className="px-2 py-1.5 text-right">Cost potència</th><th className="px-2 py-1.5 text-right">Dif. vs {rows[0]?.margin.label}</th>
            {showCom && <><th className="px-2 py-1.5 text-right">Com. potència</th><th className="px-2 py-1.5 text-right">Com. total</th><th className="px-2 py-1.5 text-right">Col·laborador</th><th className="px-2 py-1.5 text-right">Assessoria 3.0</th></>}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.margin.id} className={cn("cursor-pointer border-t border-line", r.selected && "bg-brand/[0.08] font-semibold")} onClick={() => setSel({ ...sel, margin: r.margin.id })}>
                <td className="px-2 py-1.5">{r.margin.label}{r.selected ? " ✓" : ""}</td>
                {r.power.slice(0, per.power).map((p, i) => <td key={i} className="px-2 py-1.5 text-right">{f6(p)}</td>)}
                <td className="px-2 py-1.5 text-right">{eur(r.clientPower)}</td>
                <td className="px-2 py-1.5 text-right">{r.diffPowerVsBase == null ? "—" : `${r.diffPowerVsBase > 0 ? "+" : ""}${eur(r.diffPowerVsBase)}`}</td>
                {showCom && <><td className="px-2 py-1.5 text-right">{eur(r.commission.power)}</td><td className="px-2 py-1.5 text-right">{eur(r.commission.total)}</td><td className="px-2 py-1.5 text-right">{eur(r.commission.collaborator)}</td><td className="px-2 py-1.5 text-right">{eur(r.commission.remainder)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">Regla de Direcció per a Nufri: comissió de potència = suma dels kW contractats de tots els períodes ({per.power === 2 ? "P1 + P2" : "P1…P6"}) × marge BOE (€/kW·any). Energia i potència es mantenen separades. Tots els escenaris fan servir els mateixos dies, potències i consums.</p>
    </div>
  );
}

