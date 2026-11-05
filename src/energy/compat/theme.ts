"use client";
/** Substitut de `next-themes`: el tema és el de la plataforma (useApp.dark, desat a localStorage «rip:theme»). */
import { useApp } from "@/data/store";

export function useTheme() {
  const dark = useApp((s) => s.dark);
  return {
    theme: dark ? "dark" : "light",
    resolvedTheme: dark ? "dark" : "light",
    setTheme: (t: string) => useApp.getState().set("dark", t === "dark"),
  };
}
