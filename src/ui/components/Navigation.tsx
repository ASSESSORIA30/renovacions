"use client";
/**
 * FASE 9 · NAVEGACIÓ GLOBAL
 *  - Botó ENRERE i ruta de navegació (breadcrumbs) sobre l'historial intern; respecten enrere/endavant del navegador.
 *  - Diàleg de canvis sense desar (Guardar i sortir · Sortir sense guardar · Cancel·lar).
 *  - Nom del client i CUPS clicables a tot el CRM: fitxa 360º i punt de subministrament (amb tots els titulars).
 *  - Registres consultats recentment (només de l'usuari).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronRight, Clock, ExternalLink, Gauge, History, Loader2, MapPin, Trash2, Users, X, Zap } from "lucide-react";
import { titleCase } from "@/core/templates";
import { supabaseConfigured } from "@/data/browserSupabase";
import { useApp, type View } from "@/data/store";
import { Badge, Button, Modal, cn } from "./ui";

const TITLE: Partial<Record<View, string>> = {
  control: "Centre de Control", "panell-cap": "Supervisió", kanban: "Renovacions", dashboard: "Renovacions", hoy: "Pla d'avui", calendario: "Calendari", cartera: "Cartera",
  clients: "Clients", client: "Client", fitxa: "SIPS", sips: "SIPS", energia: "Anàlisi energètica", comparativa: "Comparativa", comparatives: "Comparatives",
  contractacio: "Expedients", tramitacions: "Tramitacions", expedient: "Expedient", incidencies: "Incidències", tasques: "Tasques", economia: "Control econòmic",
  liquidacions: "Liquidacions", liquidacio: "Liquidació", conciliacio: "Conciliació", reclamacions: "Reclamacions", auditor: "Auditor de comissions", regles: "Comissions", comercialitzadores: "Comercialitzadores",
  comercialitzadora: "Comercialitzadora", agenda: "Agenda", leads: "Leads", pipeline: "Oportunitats", oportunitat: "Oportunitat", perfil: "El meu perfil", ajustes: "Configuració", facturacio: "Facturació", factura: "Factura", exportacions: "Exportacions a Excel",
};
export const viewTitle = (v: View) => TITLE[v] ?? v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, " ");

/* ======================================================================= enrere + ruta */

export function BackButton() {
  const back = useApp((s) => s.back);
  const can = useApp((s) => s.canGoBack());
  return (
    <button type="button" onClick={back} disabled={!can} aria-label="Enrere" title="Enrere (Alt + ←)"
      className="pressable inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[12.5px] font-medium text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-35">
      <ArrowLeft size={15} /><span className="hidden sm:inline">Enrere</span>
    </button>
  );
}

export function Breadcrumbs() {
  const trail = useApp((s) => s.trail);
  const idx = useApp((s) => s.navIdx);
  const path = trail.slice(0, idx + 1);
  if (path.length < 2) return null;
  const go = (i: number) => { if (i !== idx) history.go(i - idx); };
  const label = (i: number) => path[i].label ?? viewTitle(path[i].view);
  return (
    <nav aria-label="Ruta de navegació" className="flex min-w-0 items-center gap-1 overflow-hidden text-[12px] text-muted">
      {path.length > 4 && <span className="hidden sm:inline">…</span>}
      {path.map((c, i) => {
        const hideMobile = i < path.length - 2;
        const hideDesk = path.length > 4 && i < path.length - 4;
        if (hideDesk) return null;
        return (
          <span key={`${i}-${c.view}`} className={cn("flex min-w-0 items-center gap-1", hideMobile && "hidden sm:flex")}>
            {i > 0 && <ChevronRight size={12} className="shrink-0 opacity-60" />}
            {i === path.length - 1 ? <span className="truncate font-medium text-ink" aria-current="page">{label(i)}</span>
              : <button type="button" onClick={() => go(i)} className="max-w-[160px] truncate rounded px-0.5 hover:text-ink hover:underline">{label(i)}</button>}
          </span>
        );
      })}
    </nav>
  );
}

/** La pantalla posa nom al seu pas del recorregut (p. ex. el nom del client). */
export function useCrumb(label: string | null | undefined) {
  const set = useApp((s) => s.setCrumbLabel);
  useEffect(() => { if (label) set(label); }, [label, set]);
}

/** Drecera de teclat Alt + ← (com el navegador) per al botó Enrere intern. */
export function useBackShortcut() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.altKey && e.key === "ArrowLeft" && !(e.target as HTMLElement)?.closest?.("input,textarea,select")) { e.preventDefault(); useApp.getState().back(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}

/* ======================================================================= canvis sense desar */

/** Registra que la pantalla té canvis sense desar. Mentre `dirty` sigui cert, sortir-ne demana confirmació. */
export function useUnsavedChanges(label: string, dirty: boolean, save?: () => Promise<boolean>) {
  const ref = useRef({ dirty, save });
  ref.current = { dirty, save };
  useEffect(() => {
    if (!dirty) { if (useApp.getState().guard?.label === label) useApp.setState({ guard: null }); return; }
    useApp.setState({ guard: { label, dirty: () => ref.current.dirty, save: ref.current.save ? () => ref.current.save!() : undefined } });
    return () => { if (useApp.getState().guard?.label === label) useApp.setState({ guard: null }); };
  }, [dirty, label]);
}

export function LeaveDialog() {
  const pending = useApp((s) => s.pendingNav);
  const guard = useApp((s) => s.guard);
  const resolve = useApp((s) => s.resolvePending);
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const act = async (a: "save" | "leave" | "cancel") => { setBusy(true); try { await resolve(a); } finally { setBusy(false); } };
  return (
    <Modal open onClose={() => void act("cancel")} title="Tens canvis sense desar"
      footer={<><Button variant="ghost" disabled={busy} onClick={() => void act("cancel")}>Cancel·la</Button><Button disabled={busy} onClick={() => void act("leave")}>Surt sense desar</Button>{guard?.save && <Button variant="primary" disabled={busy} onClick={() => void act("save")}>{busy ? <Loader2 size={14} className="animate-spin" /> : null} Desa i surt</Button>}</>}>
      <p className="text-[13px]">Hi ha canvis a «{guard?.label ?? "aquesta pantalla"}» que encara no s&apos;han desat. Què vols fer?</p>
    </Modal>
  );
}

/* ======================================================================= enllaços: client i CUPS */

/** Nom de client clicable: obre la fitxa 360º (per id). No dispara altres accions del contenidor. */
export function ClientLink({ id, name, className, onBefore }: { id: string; name: string; className?: string; onBefore?: () => void }) {
  const go = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); onBefore?.(); useApp.getState().navigate("client", { id }); };
  return (
    <button type="button" onClick={go} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") go(e); }} title="Obre la fitxa 360º del client"
      className={cn("group inline-flex max-w-full items-center gap-1 rounded text-left font-[inherit] hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40", className)}>
      <span className="truncate underline-offset-2 group-hover:underline">{name}</span>
      <ArrowUpRight size={13} className="shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
    </button>
  );
}

/** CUPS clicable: obre el punt de subministrament (contractes i titulars). Es conserva el valor original. */
export function CupsLink({ cups, className, short = false }: { cups: string | null | undefined; className?: string; short?: boolean }) {
  if (!cups) return <span className={className}>—</span>;
  const shown = short ? cups.slice(0, 22) : cups;
  return (
    <button type="button" title="Consulta el punt de subministrament" aria-label={`Punt de subministrament ${cups}`}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); useApp.getState().openSupply(cups); }}
      className={cn("inline-flex max-w-full items-center gap-1 rounded font-mono text-left hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40", className)}>
      <span className="truncate">{shown}</span><MapPin size={11} className="shrink-0 opacity-50" />
    </button>
  );
}

/**
 * Nom del titular d'un contracte de Renovacions: cerca el client vinculat a Clients 360° (per CUPS o per l'enllaç
 * de la importació) i n'obre la fitxa. El calaix es tanca però es recorda: amb «Enrere» es torna a obrir igual.
 */
export function RenewalClientLink({ renewalId, cups, name, className }: { renewalId: string; cups: string | null; name: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const go = async (e: React.SyntheticEvent) => {
    e.stopPropagation(); e.preventDefault();
    const st = useApp.getState();
    if (!supabaseConfigured) { st.navigate("clients", { q: name }); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/nav?r=resolve&renewal=${encodeURIComponent(renewalId)}${cups ? `&cups=${encodeURIComponent(cups)}` : ""}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { linked?: boolean; clientId?: string; clientName?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      if (j.linked && j.clientId) { st.navigate("client", { id: j.clientId }); st.open(null); }
      else { st.toast({ title: "Aquest contracte encara no està vinculat a cap client", body: "T'obro Clients 360° amb el nom cercat perquè el puguis trobar o crear.", tone: "info" }); st.navigate("clients", { q: name }); st.open(null); }
    } catch (err) { st.toast({ title: "No s'ha pogut obrir la fitxa del client", body: err instanceof Error ? err.message : String(err), tone: "err" }); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={(e) => void go(e)} disabled={busy} title="Obre la fitxa 360º del client"
      className={cn("group inline-flex max-w-full items-center gap-1 rounded text-left font-[inherit] hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40", className)}>
      <span className="truncate underline-offset-2 group-hover:underline">{name}</span>
      {busy ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <ArrowUpRight size={13} className="shrink-0 opacity-50 group-hover:opacity-100" />}
    </button>
  );
}

/* ======================================================================= punt de subministrament */

type SupplyData = {
  cups: string; cups20: string;
  supplies: { id: string; client_id: string; cups: string; energy_type: string; address: string | null; postal_code: string | null; city: string | null; province: string | null; holder_name: string | null; current_retailer: string | null; access_tariff: string | null; power_kw: (number | null)[] | null; annual_kwh: number | null; status: string; archived_at: string | null; data_source: string; data_updated_at: string; client: { id: string; name: string; kind: string } | null }[];
  contracts: { id: string; client_id: string; client_name: string | null; retailer: string; product: string | null; access_tariff: string | null; signed_at: string | null; start_date: string | null; end_date: string | null; status: string; legacy_contract_id: string | null }[];
  holders: { clientId: string; name: string; from: string | null; to: string | null; current: boolean; contracts: number }[];
};
const fd = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("ca-ES") : "…");
const K_STATUS: Record<string, string> = { actiu: "Actiu", renovacio_pendent: "Pendent de renovar", finalitzat: "Finalitzat", anullat: "Anul·lat", en_tramitacio: "En tramitació", esborrany: "Esborrany" };

export function SupplyPointModal() {
  const cups = useApp((s) => s.supplyFor);
  const contracts = useApp((s) => s.contracts);
  const [d, setD] = useState<SupplyData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = () => useApp.getState().openSupply(null);
  const c20 = (cups ?? "").slice(0, 20);
  // contractes de Renovacions (font importada) amb aquest CUPS: es comparen pels 20 primers caràcters (amb o sense «0F»)
  const renewals = useMemo(() => (cups ? contracts.filter((c) => (c.cups ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) === c20) : []), [contracts, cups, c20]);
  useEffect(() => {
    setD(null); setErr(null);
    if (!cups) return;
    if (!supabaseConfigured) return;
    let alive = true;
    fetch(`/api/nav?r=supply&cups=${encodeURIComponent(cups)}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`); return j as SupplyData; })
      .then((j) => { if (alive) setD(j); }).catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [cups]);
  useEffect(() => { if (cups) recordRecent({ kind: "subministrament", ref: cups, label: cups, sub: d?.supplies[0]?.address ?? renewals[0]?.direccion ?? null }); }, [cups, d, renewals]);
  if (!cups) return null;
  const s = d?.supplies.find((x) => !x.archived_at) ?? d?.supplies[0] ?? null;
  const r0 = renewals[0];
  const nav = (fn: () => void) => { fn(); };
  return (
    <Modal open onClose={close} width="max-w-3xl" title={<span className="flex items-center gap-2"><Zap size={16} className="text-brand" />Punt de subministrament <span className="font-mono text-[14px] font-normal text-muted">{cups}</span></span>}
      footer={<>
        <Button variant="ghost" onClick={close}>Tanca</Button>
        <Button onClick={() => nav(() => useApp.getState().navigate("comparativa", r0 ? { contract: r0.id } : s?.client ? { client: s.client.id, supply: s.id } : {}))}><Gauge size={14} /> Fer comparativa</Button>
        <Button variant="primary" onClick={() => nav(() => { useApp.getState().analyzeCups(cups, r0?.id ?? null); })}><Zap size={14} /> Consultar SIPS</Button>
      </>}>
      <div className="space-y-4 text-[13px]">
        <section className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2">
          <p><span className="block text-[11px] uppercase text-muted">Adreça</span>{s ? [s.address, s.postal_code, s.city, s.province].filter(Boolean).join(", ") || "—" : r0 ? [r0.direccion, r0.cp, r0.poblacion].filter(Boolean).join(", ") || "—" : "—"}</p>
          <p><span className="block text-[11px] uppercase text-muted">Tarifa · subministrament</span>{s?.access_tariff ?? r0?.tarifa ?? "—"} · {(s?.energy_type ?? r0?.tipo) === "gas" ? "Gas" : "Llum"}</p>
          <p><span className="block text-[11px] uppercase text-muted">Comercialitzadora actual</span>{s?.current_retailer ?? r0?.comercializadora ?? "—"}</p>
          <p><span className="block text-[11px] uppercase text-muted">Consum anual</span>{s?.annual_kwh != null ? `${Math.round(s.annual_kwh).toLocaleString("ca-ES")} kWh` : r0?.consumoAnual != null ? `${Math.round(r0.consumoAnual).toLocaleString("ca-ES")} kWh` : "—"}{s ? <span className="block text-[11px] text-muted">Font: {s.data_source} · {fd(s.data_updated_at)}</span> : null}</p>
        </section>
        {err && <p className="rounded-lg bg-amber-500/10 p-2 text-[12.5px] text-amber-800 dark:text-amber-300">Clients 360°: {err}</p>}
        {!supabaseConfigured && <p className="text-[12px] text-muted">En mode local només es mostren els contractes de Renovacions.</p>}
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Titulars d&apos;aquest punt al llarg del temps</h4>
          {!d && supabaseConfigured && !err ? <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Carregant…</p> : d && d.holders.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">{d.holders.map((h) => (
              <li key={h.clientId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Users size={14} className="text-muted" />
                <ClientLink id={h.clientId} name={h.name} className="font-medium" onBefore={close} />
                {h.current && <Badge tone="green">Titular actual</Badge>}
                <span className="ml-auto text-[12px] text-muted">{h.contracts ? `${h.contracts} contracte(s) · ${fd(h.from)} – ${h.to ? fd(h.to) : "actualitat"}` : "Subministrament registrat"}</span>
              </li>))}</ul>
          ) : <p className="text-[12.5px] text-muted">Cap client de Clients 360° vinculat a aquest CUPS.</p>}
        </section>
        {d && d.contracts.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Contractes del CRM</h4>
            <table className="w-full text-[12.5px]"><thead className="text-left text-[10.5px] uppercase text-muted"><tr><th className="py-1">Titular</th><th>Comercialitzadora</th><th>Període</th><th>Estat</th></tr></thead>
              <tbody>{d.contracts.map((k) => (
                <tr key={k.id} className="border-t border-line"><td className="py-1.5"><ClientLink id={k.client_id} name={k.client_name ?? "—"} onBefore={close} /></td><td>{k.retailer}{k.product ? ` · ${k.product}` : ""}</td><td>{fd(k.start_date ?? k.signed_at)} – {k.end_date ? fd(k.end_date) : "…"}</td><td>{K_STATUS[k.status] ?? k.status}</td></tr>
              ))}</tbody></table>
          </section>
        )}
        {renewals.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Contractes de Renovacions</h4>
            <ul className="divide-y divide-line rounded-xl border border-line">{renewals.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-medium">{titleCase(c.cliente)}</span>
                <span className="text-[12px] text-muted">{c.comercializadora ?? "—"} · venç {fd(c.vencimiento)}</span>
                <button className="ml-auto inline-flex items-center gap-1 text-[12px] text-brand hover:underline" onClick={() => { close(); useApp.getState().open(c.id); }}><ExternalLink size={12} /> Obre la fitxa</button>
              </li>))}</ul>
          </section>
        )}
      </div>
    </Modal>
  );
}

/* ======================================================================= registres recents */

export type Recent = { kind: "client" | "contracte" | "subministrament"; ref_id: string; label: string; sub: string | null; visited_at: string };
const LS = "a30:recents";
const local = (): Recent[] => { try { return JSON.parse(localStorage.getItem(LS) ?? "[]") as Recent[]; } catch { return []; } };
/** Desa un registre consultat (al servidor, o al navegador en mode local). Sense dades sensibles: nom i CUPS/població. */
export function recordRecent(r: { kind: Recent["kind"]; ref: string; label: string; sub?: string | null }) {
  if (!r.ref || !r.label) return;
  if (!supabaseConfigured) {
    try { const all = [{ kind: r.kind, ref_id: r.ref, label: r.label, sub: r.sub ?? null, visited_at: new Date().toISOString() }, ...local().filter((x) => !(x.kind === r.kind && x.ref_id === r.ref))].slice(0, 30); localStorage.setItem(LS, JSON.stringify(all)); } catch { /* ignore */ }
    return;
  }
  void fetch("/api/nav", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recent_touch", data: { kind: r.kind, ref: r.ref, label: r.label.slice(0, 200), sub: r.sub?.slice(0, 200) ?? null } }) }).catch(() => undefined);
}
export function openRecent(r: Recent) {
  const st = useApp.getState();
  if (r.kind === "client") st.navigate("client", { id: r.ref_id });
  else if (r.kind === "subministrament") st.openSupply(r.ref_id);
  else if (st.byId[r.ref_id]) { if (!["kanban", "dashboard", "cartera", "hoy"].includes(st.view)) st.navigate("kanban"); st.open(r.ref_id); }
  else st.toast({ title: "Aquest contracte ja no és a la teva cartera", tone: "info" });
}

export function RecentMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Recent[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    if (!supabaseConfigured) { setItems(local()); return; }
    try { const r = await fetch("/api/nav?r=recent", { cache: "no-store" }); const j = await r.json(); setItems(r.ok ? j.items ?? [] : []); } catch { setItems([]); }
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const clear = async () => {
    if (!supabaseConfigured) { try { localStorage.removeItem(LS); } catch { /* ignore */ } setItems([]); return; }
    await fetch("/api/nav", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recent_clear" }) }).catch(() => undefined);
    setItems([]);
  };
  const ICON = { client: <Users size={13} />, contracte: <Clock size={13} />, subministrament: <Zap size={13} /> };
  const LABEL = { client: "Client", contracte: "Contracte", subministrament: "Punt de subministrament" };
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Consultats recentment" title="Consultats recentment" aria-expanded={open} onClick={() => setOpen((x) => !x)} className="pressable rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink"><History size={17} /></button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-80 rounded-xl border border-line bg-surface p-1.5 shadow-lift">
          <div className="flex items-center justify-between px-2 py-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Consultats recentment</span>{items && items.length > 0 && <button className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink" onClick={() => void clear()}><Trash2 size={11} /> Neteja</button>}</div>
          {!items ? <p className="flex items-center gap-2 px-2 py-3 text-[12.5px] text-muted"><Loader2 size={13} className="animate-spin" /> Carregant…</p> : !items.length ? <p className="px-2 py-3 text-[12.5px] text-muted">Encara no has consultat cap registre.</p> : (
            <ul className="max-h-80 overflow-y-auto">{items.map((r) => (
              <li key={`${r.kind}-${r.ref_id}`}>
                <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.05]" onClick={() => { setOpen(false); openRecent(r); }}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand/10 text-brand">{ICON[r.kind]}</span>
                  <span className="min-w-0 flex-1"><span className={cn("block truncate text-[12.5px] font-medium", r.kind === "subministrament" && "font-mono")}>{r.label}</span><span className="block truncate text-[11px] text-muted">{LABEL[r.kind]}{r.sub ? ` · ${r.sub}` : ""}</span></span>
                </button>
              </li>))}</ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Tanca el botó «X» dels modals amb Escape sense obrir res més (ús intern). */
export const CloseX = ({ onClick }: { onClick: () => void }) => <button type="button" aria-label="Tanca" onClick={onClick} className="rounded p-1 text-muted hover:text-ink"><X size={14} /></button>;
