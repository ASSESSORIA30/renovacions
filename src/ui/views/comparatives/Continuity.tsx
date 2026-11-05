"use client";
/**
 * FASE 9 · Continuïtat de les comparatives
 *  - Esborrany desat automàticament al servidor (no es perd la feina en canviar de pantalla, tancar o recarregar).
 *  - Indicador d'estat: Guardant… · Canvis guardats · Canvis pendents · Error de desament.
 *  - Conflictes: si una altra persona (o una altra pestanya) l'ha modificat, no es trepitja: s'avisa.
 *  - Importació de dades del SIPS amb comparació camp a camp (mai no se sobreescriu una dada manual sense confirmar).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { AlertTriangle, Check, CloudOff, Download, Loader2, RotateCcw, Zap } from "lucide-react";
import { sipsDiff, type DiffKey, type DiffRow } from "@/core/sips-diff";
import { normalizedCups, isValidCups } from "@/core/sips";
import { normalizeTariff } from "@/comparator/engine";
import { supabaseConfigured } from "@/data/browserSupabase";
import { energyApi, type CacheEntry } from "@/energy/api";
import { useApp } from "@/data/store";
import { Button, Modal, cn } from "../../components/ui";
import { useWizard, type WizardState } from "./state";

/* ----------------------------------------------------------------------- estat de l'esborrany */

type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "conflict" | "off";
export interface ServerDraft { id: string; version: number; step: number; state: Record<string, unknown>; updated_at: string; updated_by_name: string | null; client_name: string | null; status: string; context_key: string }
interface DraftMeta {
  id: string | null; version: number | null; key: string | null;
  status: SaveState; savedAt: string | null; error: string | null;
  conflict: string | null; offer: ServerDraft | null;
  set: (p: Partial<DraftMeta>) => void;
}
export const useDraft = create<DraftMeta>((set) => ({ id: null, version: null, key: null, status: "idle", savedAt: null, error: null, conflict: null, offer: null, set: (p) => set(p) }));

/** Camps que es desen (sense el catàleg d'ofertes, que es torna a carregar, ni les funcions). */
const KEEP: (keyof WizardState)[] = ["step", "mode", "contractId", "crmClientId", "crmSupplyId", "crmClientName", "crmOpportunityId", "client", "cups", "supply", "current", "currentRetailer", "sources", "invoice", "dataNotes", "selected", "observations", "lang", "kind", "savedId", "savedStatus", "recommendation", "market"];
export function draftPayload(w: WizardState): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of KEEP) o[k] = w[k];
  return o;
}
/** Context de l'esborrany (el mateix criteri que el servidor). */
export function draftContext(w: Pick<WizardState, "contractId" | "crmClientId" | "crmSupplyId" | "cups">): { contract?: string; client?: string; supply?: string; cups?: string } | null {
  if (w.contractId) return { contract: w.contractId };
  if (w.crmClientId) return { client: w.crmClientId, ...(w.crmSupplyId ? { supply: w.crmSupplyId } : {}) };
  const c = normalizedCups(w.cups ?? "");
  return isValidCups(c) ? { cups: c } : null;
}
const ctxKey = (c: ReturnType<typeof draftContext>) => (c ? JSON.stringify(c) : null);
/** L'esborrany té contingut que valgui la pena desar (no només el context buit). */
const worth = (w: WizardState) => w.step > 1 || !!w.mode;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}
const post = <T,>(action: string, data: unknown) => api<T>("/api/nav", { method: "POST", body: JSON.stringify({ action, data }) });

/** Recupera un esborrany a l'assistent. */
export function restoreDraft(d: ServerDraft) {
  const st = d.state as Partial<WizardState>;
  useWizard.getState().reset({ ...st, catalog: [], savedSnapshot: null });
  useDraft.getState().set({ id: d.id, version: d.version, key: ctxKey(draftContext({ contractId: st.contractId ?? null, crmClientId: st.crmClientId ?? null, crmSupplyId: st.crmSupplyId ?? null, cups: st.cups ?? "" })), status: "saved", savedAt: d.updated_at, offer: null, conflict: null, error: null });
}

/** Tanca l'esborrany actual (finalitzat amb la comparativa desada, o descartat). No bloqueja l'usuari. */
export async function closeDraft(status: "finalitzat" | "descartat", comparisonId: string | null = null) {
  const id = useDraft.getState().id;
  useDraft.getState().set({ id: null, version: null, key: null, status: "idle", savedAt: null, conflict: null, offer: null, error: null });
  if (!id || !supabaseConfigured) return;
  await post("draft_close", { id, status, comparisonId }).catch(() => undefined);
}

/**
 * Desament automàtic: 1,5 s després de l'últim canvi (i en sortir de la pantalla). Es fa servir l'`id` i la
 * `version`: si el servidor diu que algú altre l'ha modificat, s'atura i es mostra l'avís de conflicte.
 */
export function useDraftAutosave() {
  const w = useWizard();
  const issued = w.savedStatus === "emesa" || w.savedStatus === "enviada";
  const ctx = draftContext(w);
  const key = ctxKey(ctx);
  const payload = useMemo(() => JSON.stringify(draftPayload(w)), [w]);
  const last = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useRef<() => Promise<boolean>>(async () => true);

  // en canviar de context (un altre contracte o client) es comença un esborrany nou
  useEffect(() => {
    const d = useDraft.getState();
    if (d.key && key !== d.key) d.set({ id: null, version: null, key, status: "idle", conflict: null, offer: null });
    else if (!d.key) d.set({ key });
  }, [key]);

  // en emetre la proposta, l'esborrany queda tancat i vinculat a la comparativa
  useEffect(() => { if (issued && useDraft.getState().id) void closeDraft("finalitzat", w.savedId); }, [issued, w.savedId]);

  flush.current = async () => {
    const d = useDraft.getState();
    if (!supabaseConfigured) { d.set({ status: "off" }); return true; }
    if (!ctx || issued || !worth(useWizard.getState()) || d.status === "conflict" || d.offer) return true;
    if (last.current === payload && d.status === "saved") return true;
    d.set({ status: "saving", error: null });
    const st = useWizard.getState();
    try {
      const r = await post<{ id?: string; version?: number; savedAt?: string; conflict?: "version" | "existing"; message?: string; draft?: ServerDraft | null }>("draft_save", {
        ...ctx, id: d.id ?? undefined, version: d.id ? d.version ?? undefined : undefined, step: st.step, client_name: st.client.name ?? st.crmClientName ?? null, state: JSON.parse(payload),
      });
      if (r.conflict === "version") { d.set({ status: "conflict", conflict: r.message ?? "L'esborrany s'ha modificat en un altre lloc." }); return false; }
      if (r.conflict === "existing") { d.set({ status: "idle", offer: r.draft ?? null }); return false; }
      last.current = payload;
      d.set({ id: r.id!, version: r.version!, status: "saved", savedAt: r.savedAt ?? new Date().toISOString() });
      return true;
    } catch (e) {
      d.set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  useEffect(() => {
    if (!supabaseConfigured) { useDraft.getState().set({ status: "off" }); return; }
    if (!ctx || issued || !worth(w)) return;
    if (last.current === payload) return;
    const d = useDraft.getState();
    if (d.status !== "conflict" && !d.offer) d.set({ status: "pending" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush.current(); }, 1500);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, key, issued]);

  // en sortir de la pantalla es desa el que quedi pendent (sense bloquejar la navegació)
  useEffect(() => () => { if (useDraft.getState().status === "pending") void flush.current(); }, []);

  return { flush: () => flush.current() };
}

/** Cerca un esborrany obert per al context actual i l'ofereix (no s'aplica sol: l'usuari tria). */
export function useDraftOffer(ctx: { contract?: string; client?: string; supply?: string; cups?: string; draft?: string } | null) {
  const k = ctx ? JSON.stringify(ctx) : null;
  useEffect(() => {
    if (!ctx || !supabaseConfigured) return;
    let alive = true;
    const qs = new URLSearchParams({ r: "draft", ...(ctx.draft ? { id: ctx.draft } : ctx) } as Record<string, string>);
    api<{ draft: ServerDraft | null }>(`/api/nav?${qs}`).then(({ draft }) => {
      if (!alive || !draft || draft.status !== "obert") return;
      if (useDraft.getState().id === draft.id) return; // ja és el que s'està editant
      if (ctx.draft) { restoreDraft(draft); return; } // «Reprendre» des de la fitxa del client
      useDraft.getState().set({ offer: draft });
    }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
}

const STEP = ["", "Origen de dades", "Validació", "Selecció d'ofertes", "Comparativa", "Entrega"];
const when = (iso: string) => new Date(iso).toLocaleString("ca-ES", { dateStyle: "short", timeStyle: "short" });

export function DraftStatus() {
  const d = useDraft();
  const map: Record<SaveState, { t: string; icon: React.ReactNode; cls: string } | null> = {
    idle: null,
    off: { t: "Mode local: l'esborrany es conserva mentre no tanquis el navegador", icon: <CloudOff size={13} />, cls: "text-muted" },
    pending: { t: "Canvis pendents", icon: <span className="h-2 w-2 rounded-full bg-amber-500" />, cls: "text-amber-700 dark:text-amber-300" },
    saving: { t: "Guardant…", icon: <Loader2 size={13} className="animate-spin" />, cls: "text-muted" },
    saved: { t: `Canvis guardats${d.savedAt ? ` · ${new Date(d.savedAt).toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}`, icon: <Check size={13} />, cls: "text-ren" },
    error: { t: "Error de desament", icon: <AlertTriangle size={13} />, cls: "text-red-600" },
    conflict: { t: "Conflicte: no s'ha desat", icon: <AlertTriangle size={13} />, cls: "text-red-600" },
  };
  const m = map[d.status];
  if (!m) return null;
  return <span role="status" aria-live="polite" title={d.error ?? undefined} className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", m.cls)} data-testid="draft-status">{m.icon}{m.t}</span>;
}

export function DraftBanners({ onRetry }: { onRetry: () => void }) {
  const d = useDraft();
  const reload = async () => {
    if (!d.id) return;
    try { const { draft } = await api<{ draft: ServerDraft }>(`/api/nav?r=draft&id=${encodeURIComponent(d.id)}`); restoreDraft(draft); }
    catch (e) { useApp.getState().toast({ title: "No s'ha pogut recarregar l'esborrany", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  return (
    <>
      {d.offer && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand/[0.05] px-3 py-2 text-[12.5px]" role="alert">
          <RotateCcw size={14} className="text-brand" />
          <span>Tens una comparativa a mig fer{d.offer.client_name ? ` per a ${d.offer.client_name}` : ""}: pas «{STEP[d.offer.step] ?? d.offer.step}», desada el {when(d.offer.updated_at)}{d.offer.updated_by_name ? ` per ${d.offer.updated_by_name}` : ""}.</span>
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="primary" onClick={() => restoreDraft(d.offer!)}>Reprèn-la</Button>
            <Button size="sm" variant="ghost" onClick={() => { const id = d.offer!.id; d.set({ offer: null, id: null, version: null }); void post("draft_close", { id, status: "descartat" }).catch(() => undefined); }}>Descarta-la i comença de nou</Button>
          </span>
        </div>
      )}
      {d.status === "conflict" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/[0.05] px-3 py-2 text-[12.5px]" role="alert">
          <AlertTriangle size={14} className="text-red-600" />
          <span>{d.conflict}</span>
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" onClick={() => void reload()}>Recarrega l&apos;esborrany</Button>
          </span>
        </div>
      )}
      {d.status === "error" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-[12.5px]" role="alert">
          <AlertTriangle size={14} className="text-amber-600" />
          <span>No s&apos;ha pogut desar l&apos;esborrany: {d.error}. Les dades continuen en aquesta pantalla.</span>
          <Button size="sm" className="ml-auto" onClick={onRetry}>Torna-ho a provar</Button>
        </div>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------- importar del SIPS amb comparació */

export function SipsImportButton() {
  const w = useWizard();
  const [open, setOpen] = useState(false);
  const cups = normalizedCups(w.cups ?? "");
  if (!isValidCups(cups) || w.savedStatus === "emesa" || w.savedStatus === "enviada") return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Download size={14} /> Importa dades del SIPS</Button>
      <Button size="sm" variant="ghost" onClick={() => useApp.getState().analyzeCups(cups, null, "Tornar a la comparativa")}><Zap size={14} /> Consulta el SIPS</Button>
      {open && <SipsImportModal cups={cups} onClose={() => setOpen(false)} />}
    </>
  );
}

function SipsImportModal({ cups, onClose }: { cups: string; onClose: () => void }) {
  const w = useWizard();
  const [entry, setEntry] = useState<CacheEntry | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    energyApi.supply(cups).then(({ entry: e }) => {
      if (!alive) return;
      if (!e || e.status !== "found") setErr("Aquest CUPS encara no s'ha consultat al SIPS o no hi ha dades. Consulta'l primer amb «Consulta el SIPS».");
      else setEntry(e);
    }).catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [cups]);
  const rows: DiffRow[] = useMemo(() => {
    if (!entry) return [];
    const per = w.supply.kw;
    return sipsDiff(
      { tariff: w.supply.accessTariff, powerKw: per, annualKwh: w.supply.kwhTotal, retailer: w.currentRetailer || null, address: w.client.address, cups: w.cups || null, sources: { ...w.sources, tariff: w.sources.tariff ?? (w.supply.accessTariff ? w.sources.kw ?? null : null), retailer: w.sources.retailer ?? null, address: w.sources.address ?? null, cups: w.sources.cups ?? null } },
      { tariff: normalizeTariff(entry.tariff) ?? entry.tariff, powerKw: entry.contracted_power_kw ?? null, annualKwh: entry.annual_kwh, retailer: entry.retailer ?? null, address: entry.address, cups: entry.returned_cups ?? null },
    );
  }, [entry, w]);
  useEffect(() => { setOn(Object.fromEntries(rows.map((r) => [r.key, r.defaultOn]))); }, [rows]);
  const apply = () => {
    if (!entry) return;
    const pick = (k: DiffKey) => !!on[k];
    const st = useWizard.getState();
    const supply = { ...st.supply };
    const sources = { ...st.sources };
    if (pick("tariff")) { supply.accessTariff = normalizeTariff(entry.tariff) ?? supply.accessTariff; sources.tariff = "sips"; }
    if (pick("powerKw")) { supply.kw = Array.from({ length: 6 }, (_, i) => entry.contracted_power_kw?.[i] ?? null); sources.kw = "sips"; }
    if (pick("annualKwh")) { supply.kwhTotal = entry.annual_kwh; supply.basis = "anual"; supply.days = 365; sources.kwhTotal = "sips"; }
    st.set({
      supply, sources,
      currentRetailer: pick("retailer") ? entry.retailer ?? st.currentRetailer : st.currentRetailer,
      client: pick("address") ? { ...st.client, address: entry.address } : st.client,
      cups: pick("cups") ? entry.returned_cups ?? st.cups : st.cups,
      dataNotes: [...st.dataNotes, `Importat del SIPS (consulta del ${new Date(entry.consulted_at).toLocaleDateString("ca-ES")}): ${rows.filter((r) => pick(r.key)).map((r) => r.label.toLowerCase()).join(", ") || "cap camp"}.`],
    });
    useApp.getState().toast({ title: "Dades del SIPS importades", body: "Només s'han canviat els camps marcats.", tone: "ok" });
    onClose();
  };
  const SRC: Record<string, string> = { manual: "introduït a mà", factura: "de la factura", sips: "del SIPS", crm: "del CRM", calculat: "calculat" };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Importar dades del SIPS"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!entry || !rows.some((r) => on[r.key])} onClick={apply}>Importa els camps marcats</Button></>}>
      {err ? <p className="text-[13px] text-amber-700 dark:text-amber-300">{err}</p> : !entry ? <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Llegint el SIPS desat…</p> : !rows.length ? (
        <p className="text-[13px]">Les dades de la comparativa ja coincideixen amb el SIPS. No hi ha res a importar.</p>
      ) : (
        <div className="space-y-2 text-[12.5px]">
          <p className="text-muted">Consulta del SIPS del {new Date(entry.consulted_at).toLocaleDateString("ca-ES")}. Marca què vols importar. Els camps introduïts a mà o llegits de la factura no es marquen sols.</p>
          <table className="w-full">
            <thead className="text-left text-[10.5px] uppercase text-muted"><tr><th className="w-8" /><th className="py-1">Camp</th><th>Ara a la comparativa</th><th>SIPS</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key} className="border-t border-line align-top">
                <td className="py-1.5"><input type="checkbox" aria-label={`Importa ${r.label}`} checked={!!on[r.key]} onChange={(e) => setOn((o) => ({ ...o, [r.key]: e.target.checked }))} /></td>
                <td className="py-1.5 font-medium">{r.label}{r.protectedValue && <span className="block text-[11px] font-normal text-amber-700 dark:text-amber-300">Valor {SRC[r.source ?? ""] ?? "existent"}: es mantindrà si no el marques</span>}</td>
                <td className="py-1.5 text-muted">{r.current || "—"}</td>
                <td className="py-1.5">{r.sips}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
