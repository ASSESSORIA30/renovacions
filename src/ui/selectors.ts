"use client";
import { useMemo } from "react";
import { daysUntil, today } from "@/core/dates";
import { expiry } from "@/core/insights";
import { norm } from "@/core/importer";
import type { Contract, Status } from "@/core/types";
import { DEFAULT_GROUP_WINDOW, buildContactGraph, isGroupWindow, kanbanItems, renewalClusters, type ContactGraph, type KanbanItem } from "@/core/contact-groups";
import { useApp } from "@/data/store";

export const STATUS_META: Record<Status, { label: string; color: string; soft: string; hint: string }> = {
  pendiente: { label: "Pendents de renovar", color: "rgb(var(--pend))", soft: "rgb(var(--pend) / 0.1)", hint: "Vencen aviat i encara cal gestionar-los" },
  contactado: { label: "Contactats", color: "rgb(var(--cont))", soft: "rgb(var(--cont) / 0.1)", hint: "Hi hem parlat o hem enviat proposta" },
  renovado: { label: "Renovats", color: "rgb(var(--ren))", soft: "rgb(var(--ren) / 0.1)", hint: "Renovació aconseguida" },
  no_renueva: { label: "No vol renovar", color: "rgb(var(--lost))", soft: "rgb(var(--lost) / 0.1)", hint: "Han rebutjat les nostres condicions" },
};
export const STATUSES: Status[] = ["pendiente", "contactado", "renovado", "no_renueva"];

export const KPI_FILTERS: Record<string, { label: string; test: (c: Contract, d: number | null, horizon: number) => boolean }> = {
  proximos: { label: "Propers a renovar", test: (c, d, h) => c.crm.status === "pendiente" && d !== null && d <= h },
  semana: { label: "Vencen aquesta setmana", test: (c, d) => open(c) && d !== null && d >= 0 && d <= 7 },
  mes: { label: "Vencen en 30 dies", test: (c, d) => open(c) && d !== null && d >= 0 && d <= 30 },
  vencidos: { label: "Vençuts sense gestionar", test: (c, d) => open(c) && d !== null && d < 0 },
  sin_contactar: { label: "Pendents de contactar", test: (c, d, h) => c.crm.status === "pendiente" && !c.crm.ultimoContacto && d !== null && d <= h },
  propuestas: { label: "Propostes enviades", test: (c) => !!c.crm.propuestaEnviada && open(c) },
  contactados: { label: "Contactats", test: (c) => c.crm.status === "contactado" },
  renovados: { label: "Renovacions", test: (c) => c.crm.status === "renovado" },
  perdidos: { label: "Perduts", test: (c) => c.crm.status === "no_renueva" },
};
const open = (c: Contract) => c.crm.status === "pendiente" || c.crm.status === "contactado";

export function matchesSearch(c: Contract, q: string) {
  if (!q) return true;
  const n = norm(q);
  const hay = norm([c.cliente, c.cups, c.cif, c.poblacion, c.telefono, c.email, c.comercializadora, c.direccion].join(" "));
  return n.split(" ").every((w) => hay.includes(w));
}

/** Contracts after search + KPI + comercial + tipo filters (role filter already applied in the store). */
export function useFiltered() {
  const { contracts, search, filter, snap } = useApp();
  const horizon = snap?.settings.horizonteDias ?? 90;
  return useMemo(() => {
    const ref = today();
    const kpi = filter.kpi ? KPI_FILTERS[filter.kpi] : null;
    return contracts.filter((c) => {
      if (filter.comercial && c.comercial !== filter.comercial) return false;
      if (filter.tipo && c.tipo !== filter.tipo) return false;
      if (!matchesSearch(c, search)) return false;
      if (kpi && !kpi.test(c, daysUntil(expiry(c), ref), horizon)) return false;
      return true;
    });
  }, [contracts, search, filter, horizon]);
}

export function useKanbanColumns() {
  const filtered = useFiltered();
  const { priority, smartSort, snap, filter, search } = useApp();
  const horizon = snap?.settings.horizonteDias ?? 90;
  return useMemo(() => {
    const ref = today();
    const cols: Record<Status, Contract[]> = { pendiente: [], contactado: [], renovado: [], no_renueva: [] };
    for (const c of filtered) {
      if (c.crm.status === "pendiente" && !filter.kpi && !search) {
        const d = daysUntil(expiry(c), ref);
        if (d === null || d > horizon) continue; // outside the renewal window → in Cartera
      }
      cols[c.crm.status].push(c);
    }
    const byExp = (a: Contract, b: Contract) => (expiry(a) ?? "9999").localeCompare(expiry(b) ?? "9999");
    for (const s of ["pendiente", "contactado"] as Status[]) {
      cols[s].sort(smartSort ? (a, b) => (priority[b.id]?.score ?? 0) - (priority[a.id]?.score ?? 0) || byExp(a, b) : byExp);
    }
    for (const s of ["renovado", "no_renueva"] as Status[]) cols[s].sort((a, b) => b.crm.statusChangedAt.localeCompare(a.crm.statusChangedAt));
    return cols;
  }, [filtered, priority, smartSort, horizon, filter.kpi, search]);
}

export function useKpis() {
  const { contracts, snap } = useApp();
  const horizon = snap?.settings.horizonteDias ?? 90;
  return useMemo(() => {
    const ref = today();
    const counts: Record<string, number> = Object.fromEntries(Object.keys(KPI_FILTERS).map((k) => [k, 0]));
    for (const c of contracts) {
      const d = daysUntil(expiry(c), ref);
      for (const [k, f] of Object.entries(KPI_FILTERS)) if (f.test(c, d, horizon)) counts[k]++;
    }
    const closed = counts.renovados + counts.perdidos;
    return { counts, exito: closed ? Math.round((counts.renovados / closed) * 100) : null };
  }, [contracts, horizon]);
}

export function useMe() {
  return useApp((s) => s.snap?.me);
}

/* ======================================================================= agrupació per contacte */

/** Finestra de proximitat efectiva: la triada a la vista o, si no, la configurada a Ajustos (per defecte 30 dies). */
export function useGroupWindow() {
  const pref = useApp((s) => s.groupWindow);
  const conf = useApp((s) => s.snap?.settings.agrupacioDies);
  return pref ?? (isGroupWindow(conf) ? conf : DEFAULT_GROUP_WINDOW);
}

/**
 * Relació general entre TOTS els contractes visibles de l'usuari (el magatzem ja ve filtrat per permisos: cap grup ni
 * comptador pot incloure contractes que no pot veure). Es recalcula quan canvien els contractes o les decisions.
 */
export function useContactGraph(): ContactGraph {
  const contracts = useApp((s) => s.contracts);
  const groups = useApp((s) => s.groups);
  const ownPhone = useApp((s) => s.snap?.settings.empresa.telefono);
  return useMemo(() => buildContactGraph(contracts, { links: groups.links, c360: groups.c360, ownPhones: ownPhone ? [ownPhone] : [] }), [contracts, groups.links, groups.c360, ownPhone]);
}

/** Columnes del Kanban en forma de targetes (agrupades per contacte i renovacions pròximes, o individuals). */
export function useKanbanItems(): { items: Record<Status, KanbanItem[]>; grouped: boolean; window: number } {
  const cols = useKanbanColumns();
  const grouped = useApp((s) => s.groupView);
  const window = useGroupWindow();
  const graph = useContactGraph();
  const items = useMemo(() => {
    if (!grouped) {
      const out = {} as Record<Status, KanbanItem[]>;
      for (const s of STATUSES) out[s] = cols[s].map((c) => ({ kind: "single" as const, id: c.id, contract: c }));
      return out;
    }
    const all = STATUSES.flatMap((s) => cols[s]);
    return kanbanItems(cols, renewalClusters(graph, all, window), graph.byId);
  }, [cols, grouped, window, graph]);
  return { items, grouped, window };
}
