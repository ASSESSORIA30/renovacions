"use client";
import { create } from "zustand";
import { computePriority, type Priority } from "@/core/priority";
import { assigneeKey, canSee } from "@/core/roles";
import { today } from "@/core/dates";
import type { Activity, Contract, CrmState, SourceContract, Integrations, ProposalDoc, Settings, Status, Task, Template, User } from "@/core/types";
import type { ImportReport } from "@/core/importer";
import { isGroupWindow, type C360Index, type ManualLink } from "@/core/contact-groups";
import { ConflictError, type Repo, type Snapshot } from "./repo";
import { uid } from "./defaults";

export type View =
  // Clients 360° (CRM Fase 1)
  | "clients" | "client"
  // Gestió comercial (CRM Fase 2)
  | "jornada" | "leads" | "pipeline" | "oportunitat" | "rendiment"
  // Contractació i tramitacions (CRM Fase 3)
  | "contractacio" | "tramitacions" | "expedient"
  // Control econòmic (CRM Fase 4)
  | "economia" | "liquidacions" | "liquidacio" | "conciliacio" | "regles"
  // Intel·ligència IA (CRM Fase 5)
  | "ia" | "ia-oportunitat"
  // Captació i màrqueting (CRM Fase 6)
  | "captacio" | "captacio-lead" | "portal"
  // CRM i renovacions
  | "dashboard" | "kanban" | "hoy" | "calendario" | "cartera" | "propuestas"
  // Intel·ligència energètica (mòdul cups2 integrat)
  | "sips" | "energia" | "fitxa" | "radar" | "optimizer" | "alertes" | "mercat"
  // Comparatives IA
  | "comparativa" | "comparatives" | "tarifes" | "massiva" | "comissions"
  // Gestió
  | "estadisticas" | "plantillas" | "ajustes"
  // Consolidació (CRM Fase 7)
  | "control" | "panell-cap" | "jornada-admin" | "panell-comercial" | "tasques" | "incidencies" | "informes" | "qualitat" | "centre-alertes" | "permisos"
  // Fase 8
  | "perfil"
  // Fase 8.1: Cap d'equip i Comercialitzadores
  | "panell-equip" | "equips" | "comercialitzadores" | "comercialitzadora"
  // Fase 8.2: reclamacions a comercialitzadores
  | "reclamacions"
  // Fase 14: auditor de comissions (conciliació de doble sentit)
  | "auditor"
  // Fase 10: agenda personal i compartida
  | "agenda"
  // Facturació pròpia (migració 026)
  | "facturacio" | "factura"
  // Exportacions a Excel
  | "exportacions";

export const VIEWS: View[] = ["clients", "client", "jornada", "leads", "pipeline", "oportunitat", "rendiment", "contractacio", "tramitacions", "expedient", "economia", "liquidacions", "liquidacio", "conciliacio", "regles", "ia", "ia-oportunitat", "captacio", "captacio-lead", "portal", "dashboard", "kanban", "hoy", "calendario", "cartera", "propuestas", "sips", "energia", "fitxa", "radar", "optimizer", "alertes", "mercat", "comparativa", "comparatives", "tarifes", "massiva", "comissions", "estadisticas", "plantillas", "ajustes", "control", "panell-cap", "jornada-admin", "panell-comercial", "tasques", "incidencies", "informes", "qualitat", "centre-alertes", "permisos", "perfil", "panell-equip", "equips", "comercialitzadores", "comercialitzadora", "reclamacions", "agenda", "auditor", "facturacio", "factura", "exportacions"];

/** Origen des d'on s'ha obert la fitxa energètica (per poder tornar a la renovació). */
export interface ReturnTo { view: View; params: Record<string, string>; contractId?: string | null; label: string }

/** Fase 9 · un pas del recorregut (breadcrumbs). L'etiqueta la poden afinar les pantalles (nom del client…). */
export interface Crumb { view: View; params: Record<string, string>; label: string | null }
/** Context de treball desat a cada pas de l'historial per restaurar-lo en tornar-hi. */
export interface NavCtx { openId: string | null; drawerTab: string; supplyFor: string | null; scroll: number }
/** Canvis sense desar: la pantalla que edita registra com saber-ho i com desar-los. */
export interface UnsavedGuard { label: string; dirty: () => boolean; save?: () => Promise<boolean> }
type NavOpts = { replace?: boolean; returnTo?: ReturnTo | null; fromHistory?: boolean; force?: boolean };
/** Destinació segura quan no hi ha historial intern (enllaç directe): el mòdul pare de cada fitxa. */
export const PARENT_VIEW: Partial<Record<View, View>> = {
  client: "clients", expedient: "contractacio", oportunitat: "pipeline", "ia-oportunitat": "ia", "captacio-lead": "captacio", liquidacio: "liquidacions",
  comercialitzadora: "comercialitzadores", fitxa: "energia", comparativa: "comparatives", reclamacions: "economia", auditor: "economia", factura: "facturacio",
};

/** Agrupació per contacte (migració 029): decisions manuals i vincles amb Clients 360° per calcular els grups. */
export interface GroupState { links: ManualLink[]; c360: C360Index; authorizations: { contact_key: string; holder_key: string }[]; loaded: boolean; migrationMissing: boolean; error: string | null }
/** Panell lateral d'un grup: tots els contractes del grup i, si ve d'una columna, l'estat d'origen. */
export interface GroupPanelState { contractIds: string[]; focusStatus?: Status | null }
/** «Altres contractes del mateix contacte»: des d'un contracte o des d'una fitxa de Clients 360°. */
export interface RelatedState { contractId?: string; client?: { id: string; name: string; contacts: { id?: string; name?: string | null; phone?: string | null; email?: string | null }[]; ownContractIds: string[] } }

export interface Toast { id: string; title: string; body?: string; tone?: "ok" | "err" | "info"; undo?: () => void }

interface State {
  repo: Repo | null;
  ready: boolean;
  error: string | null;
  snap: Snapshot | null;
  integrations: Integrations;
  contracts: Contract[]; // merged & role-filtered
  byId: Record<string, Contract>;
  priority: Record<string, Priority>;
  view: View;
  /** Paràmetres de la vista actual (p. ex. { cups } a la fitxa energètica). Sincronitzats amb l'URL. */
  params: Record<string, string>;
  returnTo: ReturnTo | null;
  /** Fase 9: recorregut (historial intern), posició actual, punt de subministrament obert i canvis sense desar */
  trail: Crumb[];
  navIdx: number;
  supplyFor: string | null;
  guard: UnsavedGuard | null;
  pendingNav: { view: View; params: Record<string, string>; opts: NavOpts; fromPop?: boolean } | null;
  back(): void;
  canGoBack(): boolean;
  setCrumbLabel(label: string | null): void;
  openSupply(cups: string | null): void;
  restoreFromHistory(state: { v?: View; params?: Record<string, string>; idx?: number; ctx?: NavCtx } | null, view: View, params: Record<string, string>): void;
  resolvePending(action: "save" | "leave" | "cancel"): Promise<void>;
  openId: string | null;
  drawerTab: string;
  composer: { contractId: string; channel: "whatsapp" | "email"; templateId?: string; attachDocId?: string } | null;
  proposalFor: string | null;
  closeDialog: { contractId: string; to: "renovado" | "no_renueva" } | null;
  /** Tancaments pendents d'un moviment de grup: cada contracte passa per la seva validació (CloseDialog). */
  closeQueue: { contractId: string; to: "renovado" | "no_renueva" }[];
  groups: GroupState;
  /** Vista agrupada (per contacte) o individual del Kanban, i finestra de proximitat (dies). */
  groupView: boolean;
  /** null = el valor configurat a Ajustos (agrupacioDies, per defecte 30) */
  groupWindow: number | null;
  groupPanel: GroupPanelState | null;
  contactAll: { contractIds: string[]; preselected?: string[] } | null;
  related: RelatedState | null;
  groupMove: { contractIds: string[]; preselected: string[]; to: Status } | null;
  mergeActivities(acts: Activity[]): void;
  nextClose(): void;
  search: string;
  filter: { kpi: string | null; comercial: string | null; tipo: string | null };
  smartSort: boolean;
  dark: boolean;
  ambient: boolean;
  ambientRun: number;
  themePreview: string | null;
  toasts: Toast[];
  init(repo: Repo): Promise<void>;
  set<K extends keyof State>(k: K, v: State[K]): void;
  open(id: string | null, tab?: string): void;
  navigate(view: View, params?: Record<string, string>, opts?: NavOpts): void;
  /** Obre la fitxa energètica d'un CUPS; si ve d'un contracte, recorda el retorn. */
  analyzeCups(cups: string, contractId?: string | null, backLabel?: string): void;
  toast(t: Omit<Toast, "id">): void;
  dismiss(id: string): void;
  move(id: string, to: Status, extra?: Partial<CrmState>, note?: string, opts?: { silent?: boolean }): Promise<void>;
  patchCrm(id: string, patch: Partial<CrmState>, activity?: Omit<Activity, "id" | "at" | "by" | "contractId">): Promise<void>;
  log(a: Omit<Activity, "id" | "at" | "by">): Promise<Activity>;
  updateActivity(a: Activity): Promise<void>;
  saveTask(t: Partial<Task> & { title: string; due: string }): Promise<void>;
  toggleTask(id: string): Promise<void>;
  addDoc(d: Omit<ProposalDoc, "id" | "createdAt" | "createdBy">, blob: Blob): Promise<ProposalDoc>;
  saveTemplates(t: Template[]): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  applyImport(contracts: SourceContract[], report: ImportReport, origin: string): Promise<void>;
  syncRemote(): Promise<void>;
  switchUser(id: string): Promise<void>;
  recompute(): void;
}

function defaultState(c: SourceContract): CrmState {
  return {
    contractId: c.id,
    status: c.status,
    statusChangedAt: c.fechaInicio ?? today(),
    statusChangedBy: "importació",
    motivoRechazo: c.motivoRechazo,
    version: 0,
  };
}

export function visibleFor(me: User, c: SourceContract) {
  return canSee(me, c);
}

export const useApp = create<State>((set, get) => ({
  repo: null,
  ready: false,
  error: null,
  snap: null,
  integrations: { supabase: false, googleSync: false, smtp: false, ai: false, whatsappCloud: false },
  contracts: [],
  byId: {},
  priority: {},
  view: "dashboard",
  params: {},
  returnTo: null,
  trail: [],
  navIdx: 0,
  supplyFor: null,
  guard: null,
  pendingNav: null,
  openId: null,
  drawerTab: "resumen",
  composer: null,
  proposalFor: null,
  closeDialog: null,
  closeQueue: [],
  groups: { links: [], c360: {}, authorizations: [], loaded: false, migrationMissing: false, error: null },
  groupView: readGroupPref("view", true) as boolean,
  groupWindow: readGroupPref("window", null) as number | null,
  groupPanel: null,
  contactAll: null,
  related: null,
  groupMove: null,
  mergeActivities(acts) {
    const snap = get().snap;
    if (!snap || !acts.length) return;
    const ids = new Set(acts.map((a) => a.id));
    set({ snap: { ...snap, activities: [...acts, ...snap.activities.filter((a) => !ids.has(a.id))].sort((a, b) => b.at.localeCompare(a.at)) } });
  },
  nextClose() {
    const [next, ...rest] = get().closeQueue;
    set({ closeDialog: next ?? null, closeQueue: next ? rest : [] });
  },
  search: "",
  filter: { kpi: null, comercial: null, tipo: null },
  smartSort: true,
  dark: false,
  ambient: true,
  ambientRun: 0,
  themePreview: null,
  toasts: [],

  async init(repo) {
    try {
      const [snap, integrations] = await Promise.all([repo.load(), repo.integrations()]);
      let dark = false;
      let ambient = true;
      try { ambient = localStorage.getItem("rip:ambient") !== "off"; } catch { /* ignore */ }
      try { dark = localStorage.getItem("rip:theme") === "dark" || (!localStorage.getItem("rip:theme") && matchMedia("(prefers-color-scheme: dark)").matches); } catch { /* ignore */ }
      // Fase 7: cada rol entra al seu panell (si no hi ha cap vista a l'URL)
      const home: Partial<Record<string, View>> = { admin: "control", cap_administrativa: "panell-cap", cap_equip: "panell-equip", administrativa: "jornada-admin", comercial: "panell-comercial" };
      set({ repo, snap, integrations, ready: true, dark, ambient, view: home[snap.me.role] ?? get().view });
      get().recompute();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), ready: true });
    }
  },
  set: (k, v) => {
    if (k === "view") return get().navigate(v as View);
    if (k === "groupView") writeGroupPref("view", v);
    if (k === "groupWindow") writeGroupPref("window", v);
    set({ [k]: v } as Partial<State>);
  },
  open: (id, tab = "resumen") => set({ openId: id, drawerTab: tab }),
  navigate(view, params = {}, opts = {}) {
    const st = get();
    // canvis sense desar: es demana què fer abans de sortir
    if (!opts.fromHistory && !opts.force && st.guard?.dirty() && !(st.view === view && JSON.stringify(st.params) === JSON.stringify(params))) {
      set({ pendingNav: { view, params, opts } });
      return;
    }
    const patch: Partial<State> = { view, params };
    if (opts.returnTo !== undefined) patch.returnTo = opts.returnTo;
    else if (view !== "fitxa") patch.returnTo = null;
    const same = st.view === view && JSON.stringify(st.params) === JSON.stringify(params);
    const crumb: Crumb = { view, params, label: null };
    if (!opts.fromHistory) {
      if (opts.replace || same) {
        const trail = [...st.trail];
        trail[st.navIdx] = same && trail[st.navIdx] ? trail[st.navIdx] : crumb;
        patch.trail = trail;
      } else {
        patch.trail = [...st.trail.slice(0, st.navIdx + 1), crumb].slice(-60);
        patch.navIdx = Math.min(st.navIdx + 1, 59);
      }
    }
    if (st.guard && !same) patch.guard = null;
    set(patch);
    if (typeof window !== "undefined" && !opts.fromHistory) {
      const q = new URLSearchParams({ v: view, ...params }).toString();
      const url = `/?${q}`;
      const idx = get().navIdx;
      if (opts.replace || same) history.replaceState({ ...(history.state ?? {}), v: view, params, idx }, "", url);
      else {
        // es desa el context de la pantalla que es deixa (fitxa oberta, punt de subministrament, desplaçament)
        try { history.replaceState({ ...(history.state ?? {}), ctx: captureCtx(st) }, "", location.href); } catch { /* ignore */ }
        history.pushState({ v: view, params, idx }, "", url);
      }
      saveTrail(get().trail, idx);
    }
  },
  back() {
    const st = get();
    if (st.navIdx > 0 && typeof window !== "undefined" && (history.state as { idx?: number } | null)?.idx) { history.back(); return; }
    // sense historial intern (enllaç directe): destinació segura
    const parent = PARENT_VIEW[st.view];
    if (st.returnTo) st.navigate(st.returnTo.view, st.returnTo.params);
    else st.navigate(parent ?? "dashboard", {});
  },
  canGoBack() { const st = get(); return st.navIdx > 0 || !!PARENT_VIEW[st.view] || !!st.returnTo; },
  setCrumbLabel(label) {
    const st = get();
    const cur = st.trail[st.navIdx];
    if (!cur || cur.label === label) return;
    const trail = [...st.trail];
    trail[st.navIdx] = { ...cur, label };
    set({ trail });
    saveTrail(trail, st.navIdx);
  },
  openSupply(cups) { set({ supplyFor: cups ? cups.toUpperCase().replace(/[^A-Z0-9]/g, "") : null }); },
  restoreFromHistory(state, view, params) {
    const st = get();
    const idx = typeof state?.idx === "number" ? state.idx : st.navIdx;
    // canvis sense desar en tornar enrere amb el navegador: es torna a la pantalla i es pregunta
    if (st.guard?.dirty()) {
      const cur = new URLSearchParams({ v: st.view, ...st.params }).toString();
      history.pushState({ v: st.view, params: st.params, idx: st.navIdx }, "", `/?${cur}`);
      set({ pendingNav: { view, params, opts: { fromHistory: false }, fromPop: true } });
      return;
    }
    const trail = loadTrail(idx) ?? st.trail;
    if (!trail[idx] || trail[idx].view !== view) trail[idx] = { view, params, label: null };
    set({ navIdx: idx, trail, guard: null });
    st.navigate(view, params, { fromHistory: true, returnTo: st.returnTo });
    const ctx = state?.ctx;
    set({ openId: ctx?.openId ?? null, drawerTab: ctx?.drawerTab ?? "resumen", supplyFor: ctx?.supplyFor ?? null });
    if (ctx?.scroll) restoreScroll(ctx.scroll);
  },
  async resolvePending(action) {
    const st = get();
    const p = st.pendingNav;
    if (!p) return;
    if (action === "cancel") { set({ pendingNav: null }); return; }
    if (action === "save" && st.guard?.save) {
      const ok = await st.guard.save().catch(() => false);
      if (!ok) { set({ pendingNav: null }); get().toast({ title: "No s'ha pogut desar", body: "Revisa els camps i torna-ho a provar.", tone: "err" }); return; }
    }
    set({ pendingNav: null, guard: null });
    get().navigate(p.view, p.params, { ...p.opts, force: true });
  },
  analyzeCups(cups, contractId = null, backLabel) {
    const st = get();
    const c = contractId ? st.byId[contractId] : null;
    const returnTo: ReturnTo = backLabel
      ? { view: st.view, params: st.params, contractId: null, label: backLabel }
      : c
      ? { view: st.view, params: st.params, contractId: c.id, label: `Tornar a ${c.cliente}` }
      : { view: st.view, params: st.params, contractId: null, label: "Tornar" };
    set({ openId: null });
    get().navigate("fitxa", { cups: cups.toUpperCase().replace(/[\s.\-]/g, "") }, { returnTo });
  },
  toast(t) {
    const id = uid();
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.undo ? 6000 : 3800);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  recompute() {
    const snap = get().snap;
    if (!snap) return;
    const contracts: Contract[] = [];
    const byId: Record<string, Contract> = {};
    const priority: Record<string, Priority> = {};
    const ref = today();
    for (const s of snap.source) {
      if (!visibleFor(snap.me, s)) continue;
      const c: Contract = { ...s, crm: snap.states[s.id] ?? defaultState(s) };
      contracts.push(c);
      byId[c.id] = c;
    }
    const tasks = snap.tasks;
    for (const c of contracts) priority[c.id] = computePriority(c, tasks, snap.settings.pesos, ref);
    set({ contracts, byId, priority });
  },

  async move(id, to, extra = {}, note, opts) {
    const c = get().byId[id];
    if (!c || c.crm.status === to) return;
    const prev = c.crm;
    const me = get().snap!.me;
    const next: CrmState = {
      ...prev,
      ...extra,
      status: to,
      statusChangedAt: new Date().toISOString(),
      statusChangedBy: me.name,
      ...(to === "contactado" && !prev.ultimoContacto ? { ultimoContacto: new Date().toISOString() } : {}),
    };
    await commit(id, next, prev.version);
    const LABEL: Record<Status, string> = { pendiente: "Pendents", contactado: "Contactats", renovado: "Renovats", no_renueva: "No vol renovar" };
    await get().log({ contractId: id, type: "status", title: `${LABEL[prev.status]} → ${LABEL[to]}`, body: note ?? extra.motivoRechazo ?? extra.condicionesRenovacion ?? undefined, meta: { from: prev.status, to } });
    if (opts?.silent) return;
    get().toast({
      title: `Mogut a ${LABEL[to]}`,
      body: c.cliente,
      tone: "ok",
      undo: async () => {
        const cur = get().byId[id];
        await commit(id, { ...prev, statusChangedAt: new Date().toISOString(), statusChangedBy: me.name }, cur.crm.version);
        await get().log({ contractId: id, type: "status", title: `Desfet: ${LABEL[to]} → ${LABEL[prev.status]}` });
      },
    });
  },

  async patchCrm(id, patch, activity) {
    const c = get().byId[id];
    if (!c) return;
    await commit(id, { ...c.crm, ...patch }, c.crm.version);
    if (activity) await get().log({ contractId: id, ...activity });
  },

  async log(a) {
    const snap = get().snap!;
    const full: Activity = { ...a, id: uid(), at: new Date().toISOString(), by: snap.me.name };
    set({ snap: { ...snap, activities: [full, ...snap.activities] } });
    await get().repo!.addActivity(full);
    return full;
  },
  async updateActivity(a) {
    const snap = get().snap!;
    set({ snap: { ...snap, activities: snap.activities.map((x) => (x.id === a.id ? a : x)) } });
    await get().repo!.updateActivity(a);
  },

  async saveTask(t) {
    const snap = get().snap!;
    const existing = t.id ? snap.tasks.find((x) => x.id === t.id) : undefined;
    const full: Task = {
      id: t.id ?? uid(),
      contractId: t.contractId ?? existing?.contractId ?? null,
      title: t.title,
      due: t.due,
      assignee: t.assignee ?? existing?.assignee ?? assigneeKey(snap.me),
      done: t.done ?? existing?.done ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      createdBy: existing?.createdBy ?? snap.me.name,
      kind: t.kind ?? existing?.kind ?? "seguimiento",
    };
    const tasks = existing ? snap.tasks.map((x) => (x.id === full.id ? full : x)) : [full, ...snap.tasks];
    set({ snap: { ...snap, tasks } });
    await get().repo!.upsertTask(full);
    if (!existing && full.contractId) {
      await get().log({ contractId: full.contractId, type: "task", title: `Tasca programada: ${full.title}`, body: `Per al ${full.due} · ${full.assignee}` });
      const c = get().byId[full.contractId];
      if (c) await commit(c.id, { ...c.crm, proximaAccion: full.title, proximaAccionFecha: full.due }, c.crm.version);
    }
    get().recompute();
  },
  async toggleTask(id) {
    const t = get().snap!.tasks.find((x) => x.id === id);
    if (!t) return;
    await get().saveTask({ ...t, done: !t.done });
    if (!t.done && t.contractId) await get().log({ contractId: t.contractId, type: "task", title: `Tasca completada: ${t.title}` });
  },

  async addDoc(d, blob) {
    const snap = get().snap!;
    const full: ProposalDoc = { ...d, id: uid(), createdAt: new Date().toISOString(), createdBy: snap.me.name };
    const saved = await get().repo!.addDoc(full, blob);
    set({ snap: { ...get().snap!, docs: [saved, ...get().snap!.docs] } });
    await get().log({ contractId: d.contractId, type: "pdf", title: `Proposta PDF v${d.version} generada`, body: d.fileName, meta: { docId: saved.id, ahorro: d.ahorroAnual } });
    return saved;
  },

  // (Unificació) Les ofertes ja no es mantenen aquí: l'única font és el Catàleg de tarifes.
  async saveTemplates(t) {
    set({ snap: { ...get().snap!, templates: t } });
    await get().repo!.saveTemplates(t);
  },
  async saveSettings(s) {
    set({ snap: { ...get().snap!, settings: s } });
    await get().repo!.saveSettings(s);
    get().recompute();
  },
  async applyImport(contracts, report, origin) {
    const r = await get().repo!.importSource(contracts, report, origin);
    const snap = await get().repo!.load();
    set({ snap });
    get().recompute();
    get().toast({ title: "Sincronització completada", body: `${r.added} nous · ${r.updated} actualitzats · ${r.unchanged} sense canvis. Es conserven els estats i els seguiments.`, tone: "ok" });
  },
  async syncRemote() {
    const repo = get().repo!;
    if (!repo.syncRemote) return;
    const r = await repo.syncRemote();
    const snap = await repo.load();
    set({ snap });
    get().recompute();
    get().toast({ title: "Sincronització completada", body: `${r.added} nous · ${r.updated} actualitzats · ${r.unchanged} sense canvis.`, tone: "ok" });
  },
  async switchUser(id) {
    const repo = get().repo!;
    if (!repo.switchUser) return;
    const me = await repo.switchUser(id);
    set({ snap: { ...get().snap!, me }, openId: null, filter: { kpi: null, comercial: null, tipo: null } });
    get().recompute();
  },
}));

async function commit(id: string, next: CrmState, expected: number) {
  const { repo, snap } = useApp.getState();
  const before = snap!.states[id];
  // optimistic
  useApp.setState({ snap: { ...snap!, states: { ...snap!.states, [id]: { ...next, version: expected + 1 } } } });
  useApp.getState().recompute();
  try {
    const saved = await repo!.saveState(next, expected);
    const s = useApp.getState().snap!;
    useApp.setState({ snap: { ...s, states: { ...s.states, [id]: saved } } });
  } catch (e) {
    const s = useApp.getState().snap!;
    if (e instanceof ConflictError) {
      useApp.setState({ snap: { ...s, states: { ...s.states, [id]: e.current } } });
      useApp.getState().toast({ title: "Conflicte d'edició", body: e.message, tone: "err" });
    } else {
      const states = { ...s.states };
      if (before) states[id] = before; else delete states[id];
      useApp.setState({ snap: { ...s, states } });
      useApp.getState().toast({ title: "No s'ha pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" });
    }
    useApp.getState().recompute();
    throw e;
  }
}


/* ======================================================================= agrupació: preferències de la vista (per navegador) */
function readGroupPref(k: "view" | "window", fallback: boolean | number | null) {
  try {
    const v = localStorage.getItem(`a30:grp:${k}`);
    if (v === null) return fallback;
    if (k === "view") return v === "1";
    const n = Number(v);
    return isGroupWindow(n) ? n : fallback;
  } catch { return fallback; }
}
function writeGroupPref(k: "view" | "window", v: unknown) {
  try { if (v === null) localStorage.removeItem(`a30:grp:${k}`); else localStorage.setItem(`a30:grp:${k}`, k === "view" ? (v ? "1" : "0") : String(v)); } catch { /* ignore */ }
}

/* ======================================================================= Fase 9 · context de navegació */

const MAIN_ID = "a30-main";
function captureCtx(st: Pick<State, "openId" | "drawerTab" | "supplyFor">): NavCtx {
  const el = typeof document !== "undefined" ? document.getElementById(MAIN_ID) : null;
  return { openId: st.openId, drawerTab: st.drawerTab, supplyFor: st.supplyFor, scroll: el?.scrollTop ?? 0 };
}
/** Restaura el desplaçament quan la pantalla ja s'ha pintat (les dades poden arribar una mica més tard). */
function restoreScroll(y: number) {
  let tries = 0;
  const go = () => {
    const el = document.getElementById(MAIN_ID);
    if (el && el.scrollHeight >= y + el.clientHeight * 0.5) { el.scrollTop = y; return; }
    if (++tries < 20) setTimeout(go, 100);
    else if (el) el.scrollTop = y;
  };
  requestAnimationFrame(go);
}
/** El recorregut es conserva a la sessió del navegador (sobreviu a una recàrrega de la pestanya). */
function saveTrail(trail: Crumb[], idx: number) {
  try { sessionStorage.setItem("a30:trail", JSON.stringify({ trail, idx })); } catch { /* ignore */ }
}
function loadTrail(idx: number): Crumb[] | null {
  try {
    const j = JSON.parse(sessionStorage.getItem("a30:trail") ?? "null") as { trail: Crumb[]; idx: number } | null;
    return j && Array.isArray(j.trail) && j.trail.length > idx ? [...j.trail] : null;
  } catch { return null; }
}
export const NAV_MAIN_ID = MAIN_ID;

/** Estat d'una pantalla (filtres, cerca, pàgina, ordenació…) que es conserva en sortir-ne i tornar-hi. Només a la sessió. */
const viewStates = new Map<string, unknown>();
export function readViewState<T>(key: string, initial: T): T {
  if (viewStates.has(key)) return viewStates.get(key) as T;
  try { const v = sessionStorage.getItem(`a30:vs:${key}`); if (v) { const x = JSON.parse(v) as T; viewStates.set(key, x); return x; } } catch { /* ignore */ }
  return initial;
}
export function writeViewState<T>(key: string, v: T) {
  viewStates.set(key, v);
  try { sessionStorage.setItem(`a30:vs:${key}`, JSON.stringify(v)); } catch { /* ignore */ }
}

/** En carregar l'aplicació (o recarregar la pestanya a mig recorregut) es recupera la posició i el recorregut. */
export function initNavFromHistory() {
  if (typeof window === "undefined") return;
  const idx = (history.state as { idx?: number } | null)?.idx;
  if (typeof idx === "number" && idx > 0) {
    const trail = loadTrail(idx);
    if (trail) useApp.setState({ navIdx: idx, trail });
  }
}
