"use client";
/**
 * Estado de la aplicación (cliente) persistido en IndexedDB.
 * La capa de persistencia está aislada para sustituirla por una API/BD
 * (ver docs/schema.sql) cuando se integre con el CRM de Assessoria 3.0.
 */
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { del, get, set } from "idb-keyval";
import { parseRows } from "./parse";
import { demoRows } from "./demo";
import { DEFAULT_ALERT_CONFIG, type AlertConfig } from "./alerts";
import { DEFAULT_SCORING, type ScoringConfig } from "./scoring";
import { REGULATED_2026, type RegulatedSet, type TariffCode, regulatedPowerPrice } from "./tariffs";
import type { ImportReport, Opportunity, Supply } from "./types";
import type { Offer } from "./market";
import type { PeriodMaxTable } from "./optimizer";
import type { RawCell } from "./xlsx";
import { cupsBase, supplyFromRecord } from "./sips-record";
import type { CacheEntry, EnergyInputs } from "../api";
import { energyApi, serverEnabled } from "../api";
import { useApp } from "@/data/store";

const hasIdb = () => typeof indexedDB !== "undefined";
const idb: StateStorage = {
  getItem: async (k) => (hasIdb() ? ((await get<string>(k)) ?? null) : null),
  setItem: async (k, v) => {
    if (hasIdb()) await set(k, v);
  },
  removeItem: async (k) => {
    if (hasIdb()) await del(k);
  },
};

export interface Settings {
  regulated: RegulatedSet;
  marginPowerEurKWyr: number; // margen comercial sobre ATR por defecto
  modCosts: { extensionEurKW: number; accesoEurKW: number; fixedEur: number };
  scoring: ScoringConfig;
  alerts: AlertConfig;
  logoDataUrl: string | null;
  userName: string;
  reactiveShareOutsideP6: number | null;
  sipsKey: string;
}

export interface InvoiceData {
  kWhByPeriod: (number | null)[]; // anual por periodo, desde facturas
  source: string;
  date: string;
}

interface State {
  hydrated: boolean;
  supplies: Supply[];
  reports: ImportReport[];
  offers: Offer[];
  crm: Record<string, Opportunity>;
  periodMax: Record<string, PeriodMaxTable>;
  invoices: Record<string, InvoiceData>;
  settings: Settings;
  /** Estat de la càrrega de dades SIPS del CRM (Supabase). */
  crm2: { loaded: boolean; loading: boolean; total: number; error: string | null };
  importRows: (rows: RawCell[][], meta: { file: string; sheet: string; origin?: "excel" | "portal" }, mode: "replace" | "merge") => ImportReport;
  /** Incorpora dades de `sips_cache` (no es desen al navegador: es recarreguen a cada sessió). */
  mergeServerEntries: (entries: CacheEntry[]) => number;
  loadCrmSupplies: (force?: boolean) => Promise<void>;
  hydrateInputs: (cups: string, inputs: EnergyInputs | null) => void;
  loadDemo: () => ImportReport;
  clearSupplies: () => void;
  upsertOffer: (o: Offer) => void;
  deleteOffer: (id: string) => void;
  updateOpp: (cups: string, fn: (o: Opportunity) => Opportunity) => void;
  setPeriodMax: (cups: string, t: PeriodMaxTable | null) => void;
  setInvoice: (cups: string, d: InvoiceData | null) => void;
  setSettings: (fn: (s: Settings) => Settings) => void;
}

export const DEFAULT_SETTINGS: Settings = {
  regulated: REGULATED_2026,
  marginPowerEurKWyr: 0,
  modCosts: { extensionEurKW: 17.374714, accesoEurKW: 19.703137, fixedEur: 9.04476 },
  scoring: DEFAULT_SCORING,
  alerts: DEFAULT_ALERT_CONFIG,
  logoDataUrl: null,
  userName: "Comercial Assessoria 3.0",
  reactiveShareOutsideP6: null,
  sipsKey: "",
};

export function emptyOpp(cups: string): Opportunity {
  return { cups, marked: false, status: "nueva", owner: "", notes: [], calls: [], proposals: [], updatedAt: new Date().toISOString() };
}

/** Oferta de referencia: ATR regulado 2026 sin margen (solo término de potencia). */
export function regulatedReferenceOffer(t: TariffCode, set: RegulatedSet): Offer {
  return {
    id: `ref-${t}`,
    comercializadora: "Referencia regulada",
    nombre: `ATR ${t} (peajes + cargos)`,
    tarifa: t,
    energia: Array(6).fill(0),
    potencia: [...regulatedPowerPrice(set, t)],
    sas: { applies: false, eurPerKWh: null, note: "" },
    servicios: [],
    alquilerEurMes: 0,
    ieePct: 0,
    ivaPct: 0,
    validFrom: set.validFrom,
    validTo: set.validTo,
    condiciones: "Solo referencia regulada",
    origen: set.sources.map((s) => s.ref).join(" · "),
  };
}

export const useStore = create<State>()(
  persist(
    (setState) => ({
      hydrated: false,
      supplies: [],
      reports: [],
      offers: [],
      crm: {},
      periodMax: {},
      invoices: {},
      settings: DEFAULT_SETTINGS,
      crm2: { loaded: false, loading: false, total: 0, error: null },
      importRows: (rows, meta, mode) => {
        const { supplies, report } = parseRows(rows, meta);
        for (const s of supplies) s.source.origin = meta.origin ?? "excel";
        setState((st) => {
          const crm = st.supplies.filter((s) => s.source.origin === "crm");
          if (mode === "replace") {
            const keep = new Set(supplies.map((s) => cupsBase(s.cups)));
            return { supplies: [...supplies, ...crm.filter((s) => !keep.has(cupsBase(s.cups)))], reports: [report, ...st.reports].slice(0, 20) };
          }
          const map = new Map(st.supplies.filter((s) => !s.source.demo).map((s) => [s.cups, s]));
          for (const s of supplies) for (const [k] of map) if (k !== s.cups && cupsBase(k) === cupsBase(s.cups)) map.delete(k);
          for (const s of supplies) map.set(s.cups, s);
          return { supplies: [...map.values()], reports: [report, ...st.reports].slice(0, 20) };
        });
        return report;
      },
      loadDemo: () => {
        const { supplies, report } = parseRows(demoRows(42), { file: "DEMO · datos sintéticos", sheet: "Page1", demo: true });
        setState((st) => ({ supplies, reports: [report, ...st.reports].slice(0, 20) }));
        return report;
      },
      mergeServerEntries: (entries) => {
        let n = 0;
        setState((st) => {
          const byBase = new Map(st.supplies.map((s) => [cupsBase(s.cups), s]));
          for (const e of entries) {
            if (e.status !== "found" || !e.raw) continue;
            const s = supplyFromRecord(e.raw, { file: e.source_detail ?? "SIPS · Supabase", sheet: "sips_cache", importedAt: e.consulted_at, origin: "crm" });
            if (!s) continue;
            const old = byBase.get(cupsBase(s.cups));
            // Les dades locals (Excel/portal) només se substitueixen si les del servidor són més recents.
            if (old && old.source.origin !== "crm" && !old.source.demo && old.source.importedAt > e.consulted_at) continue;
            byBase.set(cupsBase(s.cups), s);
            n++;
          }
          return { supplies: [...byBase.values()] };
        });
        return n;
      },
      loadCrmSupplies: async (force = false) => {
        const st = useStore.getState();
        if (!serverEnabled() || st.crm2.loading || (st.crm2.loaded && !force)) return;
        setState({ crm2: { ...st.crm2, loading: true, error: null } });
        try {
          let offset: number | null = 0;
          let total = 0;
          while (offset != null) {
            const r = await energyApi.full(offset, 500);
            total = r.total;
            useStore.getState().mergeServerEntries(r.rows);
            offset = r.next;
          }
          setState({ crm2: { loaded: true, loading: false, total, error: null } });
        } catch (e) {
          setState({ crm2: { loaded: false, loading: false, total: 0, error: e instanceof Error ? e.message : String(e) } });
        }
      },
      hydrateInputs: (cups, inputs) =>
        setState((st) => {
          if (!inputs) return {};
          const key = st.supplies.find((s) => cupsBase(s.cups) === cupsBase(cups))?.cups ?? cups;
          const invoices = { ...st.invoices };
          const periodMax = { ...st.periodMax };
          if (inputs.invoice_kwh) invoices[key] = { kWhByPeriod: inputs.invoice_kwh, source: inputs.invoice_source ?? "Factura (Supabase)", date: inputs.updated_at };
          if (inputs.period_max) periodMax[key] = inputs.period_max;
          return { invoices, periodMax };
        }),
      clearSupplies: () => setState((st) => ({ supplies: st.supplies.filter((s) => s.source.origin === "crm") })),
      upsertOffer: (o) => setState((st) => ({ offers: st.offers.some((x) => x.id === o.id) ? st.offers.map((x) => (x.id === o.id ? o : x)) : [...st.offers, o] })),
      deleteOffer: (id) => setState((st) => ({ offers: st.offers.filter((x) => x.id !== id) })),
      updateOpp: (cups, fn) =>
        setState((st) => ({ crm: { ...st.crm, [cups]: { ...fn(st.crm[cups] ?? emptyOpp(cups)), updatedAt: new Date().toISOString() } } })),
      setPeriodMax: (cups, t) =>
        setState((st) => {
          const n = { ...st.periodMax };
          if (t) n[cups] = t;
          else delete n[cups];
          pushInputs(cups, { periodMax: t });
          return { periodMax: n };
        }),
      setInvoice: (cups, d) =>
        setState((st) => {
          const n = { ...st.invoices };
          if (d) n[cups] = d;
          else delete n[cups];
          pushInputs(cups, { invoiceKwh: d?.kWhByPeriod ?? null, invoiceSource: d?.source });
          return { invoices: n };
        }),
      setSettings: (fn) => setState((st) => ({ settings: fn(st.settings) })),
    }),
    {
      name: "assessoria30-energy-v1",
      storage: createJSONStorage(() => idb),
      partialize: ({ hydrated: _h, crm2: _c, ...rest }) => {
        void _h;
        void _c;
        // Les dades del CRM (Supabase) no es desen al navegador.
        const out = { ...rest, supplies: rest.supplies.filter((s) => s.source.origin !== "crm") };
        return Object.fromEntries(Object.entries(out).filter(([, v]) => typeof v !== "function"));
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
      },
      onRehydrateStorage: () => () => {
        useStore.setState({ hydrated: true });
      },
    },
  ),
);

/** Cerca per CUPS complet o per la base de 20 caràcters (els CUPS del CRM solen anar sense sufix). */
export function useSupply(cups: string | undefined) {
  return useStore((s) => {
    if (!cups) return undefined;
    const c = cups.toUpperCase().replace(/[\s\-.]/g, "");
    return s.supplies.find((x) => x.cups === c) ?? s.supplies.find((x) => cupsBase(x.cups) === cupsBase(c));
  });
}

/** Desa al servidor (energy_inputs) les dades introduïdes de factures. En mode local no fa res. */
function pushInputs(cups: string, patch: Parameters<typeof energyApi.saveInputs>[1]) {
  if (!serverEnabled()) return;
  energyApi.saveInputs(cups, patch).catch((e) =>
    useApp.getState().toast({ title: "No s'han pogut desar les dades a Supabase", body: e instanceof Error ? e.message : String(e), tone: "err" }),
  );
}
