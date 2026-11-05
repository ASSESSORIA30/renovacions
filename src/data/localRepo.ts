/**
 * Local repository used by the DEMO build (and by `next dev` when Supabase is not configured).
 * Persists in the browser (localStorage for small state, IndexedDB for source data and PDFs).
 * Integrations that need server credentials (SMTP, AI, Google API, WhatsApp Cloud) are reported as NOT configured.
 */
import { DEFAULT_TEMPLATES } from "@/core/templates";
import type { ImportReport } from "@/core/importer";
import type { Activity, CrmState, ProposalDoc, Settings, SourceContract, Task, Template, User } from "@/core/types";
import { DEFAULT_SETTINGS, DEMO_USERS } from "./defaults";
import { ConflictError, type Repo, type Snapshot } from "./repo";

const P = "rip:v1:";
const mem = new Map<string, string>();
const ls = {
  get<T>(k: string, fb: T): T {
    try {
      const v = typeof localStorage !== "undefined" ? localStorage.getItem(P + k) : mem.get(P + k) ?? null;
      return v ? (JSON.parse(v) as T) : fb;
    } catch {
      const v = mem.get(P + k);
      return v ? (JSON.parse(v) as T) : fb;
    }
  },
  set(k: string, v: unknown) {
    const s = JSON.stringify(v);
    mem.set(P + k, s);
    try { localStorage.setItem(P + k, s); } catch { /* quota or blocked: keep in memory */ }
  },
};

// --- tiny IndexedDB key/value store with in-memory fallback
const memBlobs = new Map<string, unknown>();
function idb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open("rip-demo", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function kvGet<T>(k: string): Promise<T | undefined> {
  const db = await idb();
  if (!db) return memBlobs.get(k) as T | undefined;
  return new Promise((res) => {
    const q = db.transaction("kv").objectStore("kv").get(k);
    q.onsuccess = () => res(q.result as T);
    q.onerror = () => res(memBlobs.get(k) as T | undefined);
  });
}
async function kvSet(k: string, v: unknown) {
  memBlobs.set(k, v);
  const db = await idb();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export interface Seed { importedAt: string; report: ImportReport; contracts: SourceContract[]; origin?: string }

export function createLocalRepo(seed: Seed, variant: Repo["variant"] = "demo"): Repo {
  const users = () => ls.get<User[]>("users", DEMO_USERS);
  let meId = ls.get<string>("me", "u-admin");
  const me = () => users().find((u) => u.id === meId) ?? users()[0];

  return {
    mode: "demo",
    variant,
    async load(): Promise<Snapshot> {
      const imported = await kvGet<{ contracts: SourceContract[]; at: string; report: ImportReport; origin: string }>("source");
      const source = (imported?.contracts ?? seed.contracts).map(fillNulls);
      return {
        source,
        states: ls.get("states", {}),
        activities: ls.get("activities", []),
        tasks: ls.get("tasks", []),
        docs: ls.get("docs", []),
        offers: ls.get("offers", []),
        templates: ls.get("templates", DEFAULT_TEMPLATES),
        settings: { ...DEFAULT_SETTINGS, ...ls.get<Partial<Settings>>("settings", {}) },
        users: users(),
        me: me(),
        lastSync: imported
          ? { at: imported.at, report: imported.report, origin: imported.origin }
          : { at: seed.importedAt, report: seed.report, origin: seed.origin ?? "Google Drive · Contratos_20261030 + CONTRACTES PER DIA" },
      };
    },
    async saveState(next, expected) {
      const all = ls.get<Record<string, CrmState>>("states", {});
      const cur = all[next.contractId];
      if (cur && cur.version !== expected) throw new ConflictError(cur);
      const saved = { ...next, version: expected + 1 };
      all[next.contractId] = saved;
      ls.set("states", all);
      return saved;
    },
    async addActivity(a) { ls.set("activities", [a, ...ls.get<Activity[]>("activities", [])]); },
    async updateActivity(a) { ls.set("activities", ls.get<Activity[]>("activities", []).map((x) => (x.id === a.id ? a : x))); },
    async upsertTask(t) {
      const all = ls.get<Task[]>("tasks", []);
      const i = all.findIndex((x) => x.id === t.id);
      if (i >= 0) all[i] = t; else all.unshift(t);
      ls.set("tasks", all);
    },
    async addDoc(d, pdf) {
      await kvSet("pdf:" + d.id, pdf);
      const saved = { ...d, storagePath: "idb:" + d.id };
      ls.set("docs", [saved, ...ls.get<ProposalDoc[]>("docs", [])]);
      return saved;
    },
    async getDocUrl(d) {
      const b = await kvGet<Blob>("pdf:" + d.id);
      return b ? URL.createObjectURL(b) : null;
    },
    async saveTemplates(t: Template[]) { ls.set("templates", t); },
    async saveSettings(s: Settings) { ls.set("settings", s); },
    async importSource(contracts, report, origin) {
      const prev = (await kvGet<{ contracts: SourceContract[] }>("source"))?.contracts ?? seed.contracts;
      const byId = new Map(prev.map((c) => [c.id, JSON.stringify(fillNulls(c))]));
      let added = 0, updated = 0, unchanged = 0;
      for (const c of contracts) {
        const old = byId.get(c.id);
        if (!old) added++;
        else if (old !== JSON.stringify(fillNulls(c))) updated++;
        else unchanged++;
      }
      await kvSet("source", { contracts, at: new Date().toISOString(), report, origin });
      return { added, updated, unchanged };
    },
    async integrations() {
      return { supabase: false, googleSync: false, smtp: false, ai: false, whatsappCloud: false };
    },
    async switchUser(id: string) {
      meId = id;
      ls.set("me", id);
      return me();
    },
    async listUsers() { return users(); },
    async createUser(u) {
      if (users().some((x) => x.email.toLowerCase() === u.email.toLowerCase())) throw new Error("Ja existeix un usuari amb aquest correu");
      const nu: User = { id: "u-" + Math.random().toString(36).slice(2, 9), name: u.name, email: u.email, role: u.role, code: u.code };
      ls.set("users", [...users(), nu]);
      return nu;
    },
    async updateUser(id, patch) {
      ls.set("users", users().map((x) => (x.id === id ? { ...x, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.role ? { role: patch.role } : {}), ...(patch.code !== undefined ? { code: patch.code } : {}) } : x)));
    },
    async deleteUser(id) {
      if (id === meId) throw new Error("No pots eliminar el teu propi usuari");
      ls.set("users", users().filter((x) => x.id !== id));
    },
    async reset() {
      for (const k of ["states", "activities", "tasks", "docs", "offers", "templates", "settings", "users"]) {
        try { localStorage.removeItem(P + k); } catch { /* ignore */ }
        mem.delete(P + k);
      }
      await kvSet("source", undefined);
    },
  };
}

const NULLABLE: (keyof SourceContract)[] = [
  "cups", "cif", "direccion", "poblacion", "provincia", "cp", "telefono", "email", "comercializadora", "comercializadoraAnterior",
  "tarifa", "producto", "precioContratado", "consumoAnual", "potencia", "potencias", "estadoOrigen", "estadoAlta", "tipoAlta",
  "excedentes", "observaciones", "comentario", "comentarioLlamada", "renovat2026", "representante", "captador", "colaborador",
  "fechaInicio", "fechaInicioFuente", "vencimientoOriginal", "vencimiento", "fechaBaja", "motivoRechazo",
];
/** The seed is stored without nulls to save space; restore them. */
export function fillNulls(c: Partial<SourceContract>): SourceContract {
  const o = { ...c } as Record<string, unknown>;
  for (const k of NULLABLE) if (!(k in o)) o[k] = null;
  if (!("renovacionTacita" in o)) o.renovacionTacita = false;
  if (!("contratosPrevios" in o)) o.contratosPrevios = 0;
  if (!("registrosDiarios" in o)) o.registrosDiarios = 0;
  if (!("comercial" in o)) o.comercial = "SIN ASIGNAR";
  if (!("status" in o)) o.status = "pendiente";
  if (!("source" in o)) o.source = "real";
  return o as unknown as SourceContract;
}
