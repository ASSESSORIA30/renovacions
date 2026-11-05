"use client";
/**
 * Fase 8 · Sincronització de l'espai de treball energètic amb Supabase (abans només era al navegador).
 * Es desa al servidor: ofertes, configuració, consums de factura i màxims de potència introduïts per l'usuari.
 * - En obrir el mòdul es llegeix la versió del servidor i té prioritat (és la mateixa en qualsevol dispositiu).
 * - Cada canvi es desa al cap d'1,5 s; l'estat («Desant…», «Desat», error) es mostra a la interfície i només es
 *   diu «Desat» quan el servidor ho ha confirmat.
 * - Si un altre dispositiu ha desat abans (409), es fusiona amb la versió del servidor i es torna a desar.
 * Els subministraments no es copien aquí: surten del CRM, de la memòria cau SIPS (Supabase) i de les importacions.
 */
import { create } from "zustand";
import { useStore } from "./store";
import { serverEnabled } from "../api";

const KEY = "energy";
type Synced = Pick<ReturnType<typeof useStore.getState>, "offers" | "settings" | "invoices" | "periodMax">;
const pick = (s: ReturnType<typeof useStore.getState>): Synced => ({ offers: s.offers, settings: s.settings, invoices: s.invoices, periodMax: s.periodMax });

export const useWorkspaceSync = create<{ status: "idle" | "loading" | "saving" | "saved" | "error" | "offline"; message: string | null; at: string | null }>(() => ({ status: "idle", message: null, at: null }));

let version = 0, started = false, timer: ReturnType<typeof setTimeout> | null = null, applying = false, last = "";

async function save() {
  const body = pick(useStore.getState());
  const json = JSON.stringify(body);
  if (json === last) return;
  useWorkspaceSync.setState({ status: "saving", message: null });
  try {
    const r = await fetch("/api/workspace", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: KEY, data: body, version }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) {
      // un altre dispositiu ha desat abans: s'adopta la seva versió i es fusionen les ofertes locals noves
      version = j.version;
      const server = (j.data ?? {}) as Partial<Synced>;
      const ids = new Set((server.offers ?? []).map((o) => o.id));
      applying = true;
      useStore.setState({ ...server, offers: [...(server.offers ?? []), ...useStore.getState().offers.filter((o) => !ids.has(o.id))] } as Partial<ReturnType<typeof useStore.getState>>);
      applying = false;
      last = "";
      return save();
    }
    if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
    version = j.version; last = json;
    useWorkspaceSync.setState({ status: "saved", message: null, at: j.updated_at });
  } catch (e) {
    useWorkspaceSync.setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

export async function startWorkspaceSync() {
  if (started || !serverEnabled()) { if (!serverEnabled()) useWorkspaceSync.setState({ status: "offline", message: "Sense Supabase: les dades només són en aquest navegador" }); return; }
  started = true;
  useWorkspaceSync.setState({ status: "loading" });
  try {
    const r = await fetch(`/api/workspace?key=${KEY}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
    version = j.version ?? 0;
    if (j.data) {
      applying = true;
      const d = j.data as Partial<Synced>;
      useStore.setState({ offers: d.offers ?? [], invoices: d.invoices ?? {}, periodMax: d.periodMax ?? {}, settings: { ...useStore.getState().settings, ...(d.settings ?? {}) } });
      applying = false;
      last = JSON.stringify(pick(useStore.getState()));
      useWorkspaceSync.setState({ status: "saved", at: j.updated_at });
    } else {
      // primera vegada: el que hi hagués al navegador es puja al servidor perquè no es perdi
      useWorkspaceSync.setState({ status: "idle" });
      await save();
    }
  } catch (e) {
    started = false;
    useWorkspaceSync.setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    return;
  }
  useStore.subscribe((s, prev) => {
    if (applying) return;
    if (s.offers === prev.offers && s.settings === prev.settings && s.invoices === prev.invoices && s.periodMax === prev.periodMax) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), 1500);
  });
}
