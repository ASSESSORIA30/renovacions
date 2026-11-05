"use client";
/**
 * Fase 8 · Preferències del menú (preferits, grups plegats, menú compacte) desades a Supabase (user_workspace, key «nav»)
 * perquè l'usuari les retrobi en qualsevol navegador. localStorage només fa de memòria cau per evitar parpelleig en
 * carregar; la font de veritat és el servidor.
 */
import { create } from "zustand";
import { supabaseConfigured } from "@/data/browserSupabase";
import { DEFAULT_PREFS, cleanPrefs, type NavPrefs } from "./components/nav";

const CACHE = "a30:nav2";
type S = NavPrefs & { version: number; loaded: boolean; error: string | null; load(): Promise<void>; update(p: Partial<NavPrefs>): void };
let timer: ReturnType<typeof setTimeout> | null = null;

const readCache = (): NavPrefs => { try { return cleanPrefs(JSON.parse(localStorage.getItem(CACHE) ?? "null")); } catch { return DEFAULT_PREFS; } };

export const useNavPrefs = create<S>((set, get) => ({
  ...DEFAULT_PREFS, version: 0, loaded: false, error: null,
  async load() {
    if (get().loaded) return;
    set({ ...readCache(), loaded: true });
    if (!supabaseConfigured) return;
    try {
      const r = await fetch("/api/workspace?key=nav", { cache: "no-store" });
      if (!r.ok) return; // sense migració 015: es manté la memòria cau local, sense errors visibles
      const j = (await r.json()) as { data: unknown; version: number };
      if (j.data) { const p = cleanPrefs(j.data); set({ ...p, version: j.version }); try { localStorage.setItem(CACHE, JSON.stringify(p)); } catch { /* */ } }
      else set({ version: j.version ?? 0 });
    } catch { /* fora de línia: es fa servir la memòria cau */ }
  },
  update(p) {
    const next = cleanPrefs({ fav: get().fav, closed: get().closed, mini: get().mini, ...p });
    set(next);
    try { localStorage.setItem(CACHE, JSON.stringify(next)); } catch { /* */ }
    if (!supabaseConfigured) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), 800);
  },
}));

async function save(retry = true): Promise<void> {
  const s = useNavPrefs.getState();
  const data = { fav: s.fav, closed: s.closed, mini: s.mini };
  try {
    const r = await fetch("/api/workspace", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "nav", data, version: s.version }) });
    if (r.status === 409 && retry) {
      // un altre dispositiu ha desat abans: preferències d'interfície → guanya l'última acció de l'usuari
      const j = (await r.json()) as { version: number };
      useNavPrefs.setState({ version: j.version });
      return save(false);
    }
    if (!r.ok) { useNavPrefs.setState({ error: "No s'han pogut desar les preferències del menú" }); return; }
    const j = (await r.json()) as { version: number };
    useNavPrefs.setState({ version: j.version, error: null });
  } catch { useNavPrefs.setState({ error: "Sense connexió: les preferències del menú es desaran quan tornis a estar en línia" }); }
}
