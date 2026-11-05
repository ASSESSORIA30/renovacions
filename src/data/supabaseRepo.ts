/**
 * Production repository: Supabase (auth + Postgres with RLS + Storage) and Next.js API routes
 * for everything that needs server secrets (sync, SMTP, AI).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TEMPLATES } from "@/core/templates";
import type { Activity, CrmState, ProposalDoc, Settings, SourceContract, Task, Template, User } from "@/core/types";
import { DEFAULT_SETTINGS } from "./defaults";
import { latestPerProduct, toCrmOffer } from "@/comparator/catalog";
import type { OfferVersion } from "@/comparator/types";
import { ConflictError, type Repo, type Snapshot } from "./repo";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}

/** Fetch every row of a table in pages of 1000 (PostgREST default limit). */
async function all<T>(sb: SupabaseClient, table: string, columns = "*"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function createSupabaseRepo(sb: SupabaseClient): Repo {
  return {
    mode: "supabase",
    async load(): Promise<Snapshot> {
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) throw new Error("No has iniciat sessió");
      const [profiles, contracts, states, acts, tasks, docs, offers, config, sync] = await Promise.all([
        all<{ id: string; name: string; email: string; role: User["role"]; code: string | null }>(sb, "profiles"),
        all<{ data: SourceContract; removed_from_source: boolean }>(sb, "contracts", "data, removed_from_source"),
        all<{ data: CrmState; version: number }>(sb, "crm_state", "data, version"),
        sb.from("activities").select("*").order("at", { ascending: false }).limit(5000),
        all<Record<string, unknown>>(sb, "tasks"),
        all<Record<string, unknown>>(sb, "documents"),
        // ofertes per a renovacions: derivades del Catàleg de tarifes (única font), mai de l'antiga taula `offers`
        all<{ id: string; product_id: string; version: number; status: OfferVersion["status"]; data: OfferVersion }>(sb, "tariff_versions", "id,product_id,version,status,data").catch(() => []),
        all<{ key: string; value: unknown }>(sb, "app_config"),
        sb.from("sync_runs").select("*").order("at", { ascending: false }).limit(10),
      ]);
      const me = profiles.find((p) => p.id === auth.user!.id);
      if (!me) throw new Error("El teu usuari no té perfil. Demana accés a un administrador.");
      const cfg = Object.fromEntries(config.map((c) => [c.key, c.value]));
      const runs = sync.data ?? [];
      const lastRun = runs.find((r) => r.ok);
      const lastFail = runs[0] && !runs[0].ok ? runs[0] : null;
      return {
        source: contracts.filter((c) => !c.removed_from_source).map((c) => c.data),
        states: Object.fromEntries(states.map((s) => [s.data.contractId, { ...s.data, version: s.version }])),
        activities: (acts.data ?? []).map((a) => ({ id: a.id, contractId: a.contract_id, type: a.type, at: a.at, by: a.by_name, title: a.title, body: a.body ?? undefined, delivery: a.delivery ?? undefined, meta: a.meta ?? undefined })),
        tasks: tasks.map((t) => ({ id: t.id as string, contractId: (t.contract_id as string) ?? null, title: t.title as string, due: t.due as string, assignee: t.assignee as string, done: t.done as boolean, createdAt: t.created_at as string, createdBy: t.created_by as string, kind: t.kind as Task["kind"] })),
        docs: docs.map((d) => ({ id: d.id as string, contractId: d.contract_id as string, version: d.version as number, createdAt: d.created_at as string, createdBy: d.created_by as string, offerId: d.offer_id as string, fileName: d.file_name as string, ahorroAnual: d.ahorro_anual === null ? null : Number(d.ahorro_anual), storagePath: d.storage_path as string })),
        offers: latestPerProduct(offers.map((r) => ({ ...r.data, id: r.id, productId: r.product_id, version: r.version, status: r.status }))).map((v) => toCrmOffer(v)).filter((o) => o.verificada),
        templates: (cfg.templates as Template[]) ?? DEFAULT_TEMPLATES,
        settings: { ...DEFAULT_SETTINGS, ...((cfg.settings as Partial<Settings>) ?? {}) },
        users: profiles.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, code: p.code })),
        me: { id: me.id, name: me.name, email: me.email, role: me.role, code: me.code },
        lastSync: lastRun || lastFail ? { at: lastRun?.at ?? lastFail!.at, report: lastRun?.report ?? null, origin: lastRun?.origin ?? "Google Drive", error: lastFail?.error ?? null, errorAt: lastFail?.at ?? null } : null,
      };
    },
    async saveState(next, expected) {
      const { data, error } = await sb.rpc("save_crm_state", { p_contract_id: next.contractId, p_status: next.status, p_data: { ...next, version: expected + 1 }, p_expected: expected });
      if (error) {
        if (error.message.includes("CONFLICT")) {
          const { data: cur } = await sb.from("crm_state").select("data, version").eq("contract_id", next.contractId).single();
          throw new ConflictError({ ...(cur!.data as CrmState), version: cur!.version });
        }
        throw new Error(error.message);
      }
      return { ...(data.data as CrmState), version: data.version };
    },
    async addActivity(a: Activity) {
      const { error } = await sb.from("activities").insert({ id: a.id, contract_id: a.contractId, type: a.type, at: a.at, by_name: a.by, title: a.title, body: a.body, delivery: a.delivery, meta: a.meta });
      if (error) throw new Error(error.message);
    },
    async updateActivity(a: Activity) {
      const { error } = await sb.from("activities").update({ delivery: a.delivery, body: a.body, meta: a.meta }).eq("id", a.id);
      if (error) throw new Error(error.message);
    },
    async upsertTask(t: Task) {
      const { error } = await sb.from("tasks").upsert({ id: t.id, contract_id: t.contractId, title: t.title, due: t.due, assignee: t.assignee, done: t.done, kind: t.kind, created_at: t.createdAt, created_by: t.createdBy });
      if (error) throw new Error(error.message);
    },
    async addDoc(d: ProposalDoc, pdf: Blob) {
      const path = `${d.contractId}/${d.id}.pdf`;
      const up = await sb.storage.from("documents").upload(path, pdf, { contentType: "application/pdf" });
      if (up.error) throw new Error(up.error.message);
      const { error } = await sb.from("documents").insert({ id: d.id, contract_id: d.contractId, version: d.version, file_name: d.fileName, offer_id: d.offerId, ahorro_anual: d.ahorroAnual, storage_path: path, created_at: d.createdAt, created_by: d.createdBy });
      if (error) throw new Error(error.message);
      return { ...d, storagePath: path };
    },
    async getDocUrl(d: ProposalDoc) {
      if (!d.storagePath) return null;
      // short-lived signed link (also used as the "secure link" for WhatsApp)
      const { data } = await sb.storage.from("documents").createSignedUrl(d.storagePath, 60 * 60 * 24 * 7);
      return data?.signedUrl ?? null;
    },
    async saveTemplates(t: Template[]) {
      const { error } = await sb.from("app_config").upsert({ key: "templates", value: t, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    async saveSettings(s: Settings) {
      const { error } = await sb.from("app_config").upsert({ key: "settings", value: s, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    async importSource(contracts, report, origin) {
      // Manual Excel upload → server upsert (service role), same path as the Google sync.
      return api("/api/sync/import", { contracts, report, origin });
    },
    async syncRemote() {
      return api("/api/sync", {});
    },
    integrations: () => api("/api/integrations"),
    listUsers: () => api("/api/users"),
    createUser: (u) => api("/api/users", u),
    async updateUser(id, patch) {
      const r = await fetch("/api/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${r.status}`);
    },
    async deleteUser(id) {
      const r = await fetch(`/api/users?id=${encodeURIComponent(id)}&confirm=ELIMINA`, { method: "DELETE" }); // la confirmació la demana la interfície abans
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Error ${r.status}`);
    },
    sendEmail: (p) => api("/api/email/send", p),
    ai: async (p) => (await api<{ text: string }>("/api/ai", p)).text,
  };
}
