"use client";
/** Barra de filtres d'ofertes reutilitzable (catàleg, selecció de la comparativa i ofertes del CRM). */
import { useEffect, useMemo, useState } from "react";
import { Filter, X } from "lucide-react";
import { EMPTY_FILTERS, ORIGIN_LABEL, SORT_LABEL, VALIDITY_LABEL, activeFilters, filterOptions, type OfferFilters, type SortKey, type Validity } from "@/comparator/filters";
import { CONTRACT_TYPE_LABEL, SEGMENTS, TARIFF_STATUSES, type OfferVersion } from "@/comparator/types";
import { cn } from "../../components/ui";

const SEGMENT_LABEL: Record<string, string> = { residencial: "Residencial", pyme: "Pime", industrial: "Industrial" };
const STATUS_LABEL: Record<string, string> = { activa: "Activa", esborrany: "Esborrany", caducada: "Caducada", arxivada: "Arxivada" };

/** Filtres recordats per context (navegador de l'usuari). */
export function useOfferFilters(key: string, initial: Partial<OfferFilters> = {}) {
  const storageKey = `a30.filters.${key}`;
  const [f, setF] = useState<OfferFilters>(() => {
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      if (saved) return { ...EMPTY_FILTERS, ...initial, ...(JSON.parse(saved) as Partial<OfferFilters>) };
    } catch { /* sense emmagatzematge */ }
    return { ...EMPTY_FILTERS, ...initial };
  });
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(f)); } catch { /* sense emmagatzematge */ }
  }, [f, storageKey]);
  return [f, setF] as const;
}

type Key = keyof OfferFilters;

export function OfferFilterBar({ items, value, onChange, hide = [], shown, reset }: {
  items: OfferVersion[];
  value: OfferFilters;
  onChange: (f: OfferFilters) => void;
  hide?: Key[];
  shown?: number;
  /** valors als quals torna «Neteja» (per defecte, cap filtre) */
  reset?: Partial<OfferFilters>;
}) {
  const opts = useMemo(() => filterOptions(items), [items]);
  const [more, setMore] = useState(false);
  const set = (p: Partial<OfferFilters>) => onChange({ ...value, ...p });
  const has = (k: Key) => !hide.includes(k);
  const n = activeFilters(value);
  const sel = (k: Key, label: string, options: [string, string][], all = "Tots") => has(k) && (
    <label className="block min-w-[150px]">
      <span className="text-[11px] text-muted">{label}</span>
      <select aria-label={label} className={cn("input h-9 py-1 text-[12.5px]", value[k] && "border-brand/60 bg-brand/[0.04]")} value={String(value[k] ?? "")} onChange={(e) => set({ [k]: e.target.value } as Partial<OfferFilters>)}>
        <option value="">{all}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  const secondary: Key[] = ["contractType", "status", "segment", "permanence", "validity", "origin"];
  const secondaryActive = secondary.some((k) => has(k) && value[k] !== EMPTY_FILTERS[k]);
  return (
    <section className="space-y-2 rounded-2xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[220px] flex-1">
          <span className="text-[11px] text-muted">Cerca</span>
          <input className="input h-9 text-[12.5px]" placeholder="Comercialitzadora, producte, condicions…" value={value.q} onChange={(e) => set({ q: e.target.value })} />
        </label>
        {sel("supplier", "Comercialitzadora", opts.suppliers.map((s) => [s, s]), "Totes")}
        {sel("tariff", "Tarifa d'accés", opts.tariffs.map((t) => [t, t]), "Totes")}
        {opts.hasGas && opts.hasLuz && sel("energyType", "Energia", [["luz", "Llum"], ["gas", "Gas"]], "Llum i gas")}
        {has("sort") && (
          <label className="block min-w-[170px]">
            <span className="text-[11px] text-muted">Ordena per</span>
            <select className="input h-9 py-1 text-[12.5px]" value={value.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={() => setMore(!more)} className={cn("pressable flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px]", more || secondaryActive ? "border-brand/60 text-brand" : "border-line text-muted")}>
          <Filter size={14} /> Més filtres
        </button>
        {n > 0 && (
          <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort, ...reset })} className="pressable flex h-9 items-center gap-1 rounded-xl px-2 text-[12.5px] text-muted hover:text-ink">
            <X size={14} /> Neteja ({n})
          </button>
        )}
      </div>
      {(more || secondaryActive) && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
          {sel("contractType", "Tipus de preu", opts.contractTypes.map((c) => [c, CONTRACT_TYPE_LABEL[c]]))}
          {sel("status", "Estat", TARIFF_STATUSES.map((s) => [s, STATUS_LABEL[s]]))}
          {sel("segment", "Segment", SEGMENTS.map((s) => [s, SEGMENT_LABEL[s]]))}
          {sel("permanence", "Permanència", [["sense", "Sense permanència"], ["amb", "Amb permanència"]], "Indiferent")}
          {sel("validity", "Vigència", (Object.keys(VALIDITY_LABEL) as Validity[]).map((v) => [v, VALIDITY_LABEL[v]]), "Totes")}
          {opts.origins.length > 1 && sel("origin", "Origen", opts.origins.map((o) => [o, ORIGIN_LABEL[o]]), "Tots")}
        </div>
      )}
      {shown != null && <p className="text-[11.5px] text-muted">{shown === items.length ? `${items.length} ofertes` : `${shown} de ${items.length} ofertes`}</p>}
    </section>
  );
}
