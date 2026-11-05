"use client";
/**
 * Fase 9 · Estat d'una pantalla que es conserva quan l'usuari en surt i hi torna (filtres, cerca, pàgina,
 * ordenació, pestanya…). Viu a la memòria de la sessió del navegador: mai a l'URL ni al servidor, i és de cada usuari.
 */
import { useCallback, useState } from "react";
import { readViewState, writeViewState } from "@/data/store";

export function useViewState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => readViewState(key, initial));
  const set = useCallback((n: T | ((p: T) => T)) => {
    setV((prev) => { const next = typeof n === "function" ? (n as (p: T) => T)(prev) : n; writeViewState(key, next); return next; });
  }, [key]);
  return [v, set];
}
