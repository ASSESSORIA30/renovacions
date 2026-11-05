"use client";
/**
 * Permisos de la sessió per a la interfície (Fase 7). Només serveixen per mostrar o amagar opcions:
 * el servidor i la RLS tornen a comprovar cada petició.
 */
import { create } from "zustand";
import { can, legacyPerms, type Action, type PermMap } from "@/core/permissions";
import type { Role } from "@/core/types";
import { supabaseConfigured } from "@/data/browserSupabase";

type S = { role: Role | null; perms: PermMap | null; economic: boolean; migrated: boolean; mfa: { required: boolean; current: string; next: string } | null; loaded: boolean; load: (role: Role) => Promise<void> };

export const useSession = create<S>((set, get) => ({
  role: null, perms: null, economic: false, migrated: true, mfa: null, loaded: false,
  async load(role) {
    if (get().loaded && get().role === role) return;
    if (!supabaseConfigured) { set({ role, perms: legacyPerms(role), economic: ["admin", "cap_administrativa", "administrativa"].includes(role), migrated: false, loaded: true }); return; }
    try {
      const r = await fetch("/api/control?r=session", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      set({ role, perms: j.perms, economic: !!j.economic, migrated: !!j.migrated, mfa: j.mfa ?? null, loaded: true });
    } catch {
      set({ role, perms: legacyPerms(role), economic: role === "admin", migrated: false, loaded: true });
    }
  },
}));

export const useCan = () => {
  const { role, perms } = useSession();
  return (module: string, action: Action = "read") => can(role ?? undefined, perms ?? (role ? legacyPerms(role) : null), module, action);
};
