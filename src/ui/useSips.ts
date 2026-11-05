"use client";
/**
 * Dades SIPS resumides dels contractes visibles (Kanban, fitxa del contracte, generador d'ofertes).
 * Una sola càrrega compartida; les actualitzacions es propaguen a totes les targetes.
 * No bloqueja mai el Kanban: si el servidor no respon, les targetes es mostren igualment.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { SipsEntry } from "@/core/sips";
import { normalizedCups } from "@/core/sips";
import { energyApi, serverEnabled } from "@/energy/api";

interface SipsIndex {
  entries: Record<string, SipsEntry>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  busy: Record<string, boolean>;
  load(force?: boolean): Promise<void>;
  refresh(cups: string): Promise<SipsEntry>;
  put(e: SipsEntry): void;
}

export const useSipsIndex = create<SipsIndex>((set, get) => ({
  entries: {},
  loaded: false,
  loading: false,
  error: null,
  busy: {},
  async load(force = false) {
    if (!serverEnabled() || get().loading || (get().loaded && !force)) return;
    set({ loading: true, error: null });
    try {
      const j = await energyApi.summary();
      set({ entries: Object.fromEntries(j.rows.map((r) => [r.cups, r])), loaded: true, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  async refresh(cups) {
    const key = normalizedCups(cups);
    set({ busy: { ...get().busy, [key]: true } });
    try {
      const { entry } = await energyApi.refresh(cups, true);
      get().put(entry);
      return entry;
    } finally {
      const b = { ...get().busy };
      delete b[key];
      set({ busy: b });
    }
  },
  put(e) {
    const { raw: _raw, ...summary } = e as SipsEntry & { raw?: unknown };
    void _raw;
    set({ entries: { ...get().entries, [e.cups]: summary } });
  },
}));

/** Resum SIPS d'un CUPS (null si no n'hi ha). Desencadena la càrrega inicial una sola vegada. */
export function useSips(cups: string | null | undefined): SipsEntry | null {
  const load = useSipsIndex((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  return useSipsIndex((s) => (cups ? (s.entries[normalizedCups(cups)] ?? null) : null));
}

/** Compatibilitat amb la versió anterior. */
export function useRefreshSips() {
  const refresh = useSipsIndex((s) => s.refresh);
  const busyMap = useSipsIndex((s) => s.busy);
  return { refresh, busy: Object.keys(busyMap).length > 0, entry: null as SipsEntry | null };
}
