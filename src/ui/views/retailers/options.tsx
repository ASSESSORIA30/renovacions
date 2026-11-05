"use client";
/** Fase 10 · Selector de comercialitzadores per a feina nova: només actives (les desactivades/arxivades s'avisen). */
import { useEffect, useState } from "react";
import { supabaseConfigured } from "@/data/browserSupabase";
import { matchesRetailer } from "@/core/retailers";

type Opt = { name: string; aliases: string[]; status: string };
let cache: Promise<{ options: Opt[]; blocked: Opt[] }> | null = null;
function load() {
  if (!supabaseConfigured) return Promise.resolve({ options: [], blocked: [] });
  cache ??= fetch("/api/retailers?r=options", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { options: [], blocked: [] })).catch(() => ({ options: [], blocked: [] }));
  return cache;
}
/** Invalida la memòria (després de canviar l'estat d'una comercialitzadora). */
export const refreshRetailerOptions = () => { cache = null; };

export function useRetailerOptions() {
  const [d, setD] = useState<{ options: Opt[]; blocked: Opt[] }>({ options: [], blocked: [] });
  useEffect(() => { let alive = true; void load().then((x) => { if (alive) setD(x); }); return () => { alive = false; }; }, []);
  return d;
}

/** Camp de text amb suggeriments de comercialitzadores actives i avís si la triada està desactivada o arxivada. */
export function RetailerInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { options, blocked } = useRetailerOptions();
  const listId = id ?? "a30-retailers-actives";
  const hit = value ? blocked.find((b) => matchesRetailer(value, { trade_name: b.name, aliases: b.aliases })) : null;
  return (
    <>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} list={listId} autoComplete="off" />
      <datalist id={listId}>{options.map((o) => <option key={o.name} value={o.name} />)}</datalist>
      {hit && <span className="mt-1 block text-[11.5px] text-lost">«{hit.name}» està {hit.status === "arxivada" ? "arxivada" : "desactivada"}: no es pot fer servir per a contractes nous.</span>}
    </>
  );
}
