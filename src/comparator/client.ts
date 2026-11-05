"use client";
/** Client de les APIs de comparatives (mateixa sessió Supabase que la resta de la plataforma). */
import type { OpenDocument } from "./endesa-open";
import type { NufriDoc } from "./nufri-reader";
import type { Modality, OpenRule } from "./open-calendar";
import type { ChatAnswer, OpenChatContext } from "./open-chat";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";
import { useApp } from "@/data/store";
import { fromCrmOffer } from "./catalog";
import type { InvoiceData } from "./invoice";
import type { Snapshot } from "./snapshot";
import type { OfferVersion, PermanenceRule, TariffStatus } from "./types";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new Error("No hi ha connexió amb el servidor.");
  }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `Error ${r.status}`), { status: r.status });
  return j as T;
}

export const serverMode = () => supabaseConfigured;

export type CatalogItem = OfferVersion & { usedAt?: string | null; createdAt?: string; createdByName?: string | null };

/**
 * Catàleg de tarifes: ÚNICA FONT de les ofertes de comparatives i PDF (taula `tariff_versions`, una versió per producte).
 * Les ofertes de l'antic apartat «Propostes» no s'hi barregen mai. En mode demostració (sense servidor) no hi ha catàleg
 * versionat i es fan servir les ofertes de la demo.
 */
export async function loadCatalog(all = false): Promise<{ items: CatalogItem[]; migrated: boolean }> {
  if (!serverMode()) {
    const offers = useApp.getState().snap?.offers ?? [];
    return { items: offers.map(fromCrmOffer), migrated: false };
  }
  const r = await call<{ versions: CatalogItem[]; migrated: boolean }>(`/api/tariffs${all ? "?all=1" : ""}`);
  return { items: r.versions, migrated: r.migrated };
}

/** Migració de l'antic apartat «Propostes»: informe (sense canvis) i incorporació de les ofertes vàlides. */
export const legacyApi = {
  report: () => call<{ rows: import("./catalog").LegacyRow[]; counts: Record<string, number>; total: number; usedInHistory: number; migrated: boolean }>("/api/tariffs?r=legacy"),
  import: (ids: string[]) => call<{ imported: { id: string; versionId: string }[]; skipped: { id: string; reason: string }[] }>("/api/tariffs", { method: "POST", body: JSON.stringify({ action: "import_legacy", ids }) }),
};

export const tariffsApi = {
  save: (offer: OfferVersion) => call<{ id: string; version: number; status: TariffStatus }>("/api/tariffs", { method: "POST", body: JSON.stringify({ action: "save", offer }) }),
  status: (id: string, status: TariffStatus) => call<{ id: string; status: TariffStatus }>("/api/tariffs", { method: "POST", body: JSON.stringify({ action: "status", id, status }) }),
  importConfirm: (b: unknown) => call<{ runId: string; saved: number; activated: number; rejected?: number }>("/api/tariffs/import", { method: "POST", body: JSON.stringify(b) }),
  importRuns: () => call<{ runs: { id: string; file_name: string; supplier_name: string | null; dry_run: boolean; counts: Record<string, number>; created_by_name: string | null; created_at: string }[] }>("/api/tariffs/import"),
  templates: () => call<{ templates: { id: string; name: string; supplier_name: string | null; header_row: number; mapping: Record<string, string>; default_power_unit: string | null }[] }>("/api/tariffs/templates"),
  saveTemplate: (b: unknown) => call("/api/tariffs/templates", { method: "POST", body: JSON.stringify(b) }),
  connectors: () => call<{ connectors: { providerId: string; name: string }[]; runs: { id: number; provider_id: string; started_at: string; ok: boolean | null; fetched: number | null; created: number | null; changed: number | null; retired: number | null; rejected: number | null; error: string | null }[] }>("/api/tariffs/sync"),
  sync: () => call<{ results: unknown[] }>("/api/tariffs/sync", { method: "POST" }),
  rule: () => call<PermanenceRule>("/api/tariffs?r=rule"),
  saveRule: (rule: PermanenceRule) => call<PermanenceRule>("/api/tariffs", { method: "POST", body: JSON.stringify({ action: "permanence_rule", rule }) }),
};

export interface ComparisonRow {
  id: string;
  contract_id: string | null;
  cups: string | null;
  client_name: string | null;
  mode: string;
  status: string;
  created_at: string;
  issued_at: string | null;
  created_by_name: string | null;
  supplierName?: string | null;
  saving?: number | null;
}

export const comparisonsApi = {
  list: (contract?: string) => call<{ rows: ComparisonRow[] }>(`/api/comparisons${contract ? `?contract=${encodeURIComponent(contract)}` : ""}`),
  save: (payload: unknown) => call<{ comparison: { id: string; status: string; snapshot: Snapshot } }>("/api/comparisons", { method: "POST", body: JSON.stringify(payload) }),
  action: <T = Record<string, unknown>>(b: Record<string, unknown>) => call<T>("/api/comparisons/action", { method: "POST", body: JSON.stringify(b) }),
};

export const commissionsApi = {
  list: () => call<{ rows: { product_id: string; company_eur_mwh: number | null; company_fixed_eur: number | null; salesperson_pct: number | null; notes: string | null }[] }>("/api/commissions"),
  save: (b: unknown) => call("/api/commissions", { method: "POST", body: JSON.stringify(b) }),
};

/** Tipus MIME per pujar a Storage: alguns navegadors deixen buit el de HEIC/TIFF i el bucket el rebutjaria. */
export function uploadMime(file: File): string {
  if (file.type) return file.type === "image/heif" ? "image/heic" : file.type;
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heic", tif: "image/tiff", tiff: "image/tiff" } as Record<string, string>)[ext] ?? "application/octet-stream";
}

export const ACCEPTED_INVOICE = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.tif,.tiff,application/pdf,image/jpeg,image/png,image/heic,image/heif,image/tiff";

/** Puja la factura al bucket privat (carpeta de l'usuari) i la fa llegir al servidor. */
export async function uploadAndExtract(file: File, onStage?: (s: string) => void) {
  if (!serverMode()) throw new Error("La lectura de factures necessita el servidor de la plataforma (Supabase).");
  if (file.size > 10 * 1024 * 1024) throw new Error("El fitxer supera els 10 MB.");
  const sb = browserSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error("Cal iniciar sessió.");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const path = `${auth.user.id}/${crypto.randomUUID()}.${ext}`;
  onStage?.("Pujant el fitxer de manera privada…");
  const up = await sb.storage.from("invoices").upload(path, file, { contentType: uploadMime(file), upsert: false });
  if (up.error) throw new Error(`No s'ha pogut pujar: ${up.error.message}`);
  onStage?.("Llegint la factura…");
  return call<{ id: string | null; data: InvoiceData; warnings: string[]; method: string; pages: number; summary: { filled: number; toConfirm: string[] } }>("/api/invoices/extract", { method: "POST", body: JSON.stringify({ path, fileName: file.name }) });
}

export const invoiceStatus = () => call<{ ai: boolean; maxBytes: number }>("/api/invoices/extract");

export const blobToBase64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

/* ------------------------------------------------------------ lector de tarifes amb IA */

export const ACCEPTED_TARIFF_FILE = ".pdf,.xlsx,.xls,.csv,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.jpg,.jpeg,.png,.heic,.heif,.tif,.tiff,application/pdf,image/jpeg,image/png,image/heic,image/heif,image/tiff,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const tariffAi = {
  status: () => call<{ ai: boolean }>("/api/tariffs/ai-read"),
  /** Envia el fitxer a llegir. Els fulls de càlcul es converteixen a text al navegador; PDF i imatges es pugen a la carpeta privada i el servidor els esborra en acabar. */
  async read(file: File, supplierHint: string | null, onStage?: (s: string) => void): Promise<{ raw: unknown; kind: string; truncated: boolean; open?: OpenDocument | null; nufri?: NufriDoc | null }> {
    if (!serverMode()) throw new Error("El lector amb IA necessita el servidor de la plataforma.");
    if (file.size > 10 * 1024 * 1024) throw new Error("El fitxer supera els 10 MB.");
    const name = file.name.toLowerCase();
    if (/\.(xlsx|xls|csv)$/.test(name)) {
      onStage?.("Obrint el full de càlcul…");
      const [{ sheetsToText }, XLSX, { parseCsv }] = await Promise.all([import("./tariff-ai"), import("xlsx"), import("./tariff-import")]);
      const buf = await file.arrayBuffer();
      let sheets: Record<string, unknown[][]> = {};
      if (name.endsWith(".csv")) sheets = { CSV: parseCsv(new TextDecoder().decode(buf)) };
      else {
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: null, raw: true });
      }
      const { text, truncated } = sheetsToText(sheets);
      if (!text.trim()) throw new Error("El full de càlcul és buit.");
      onStage?.("La IA està llegint les tarifes (pot trigar fins a 2 minuts)…");
      const r = await call<{ raw: unknown; kind: string }>("/api/tariffs/ai-read", { method: "POST", body: JSON.stringify({ text, fileName: file.name, supplierHint }) });
      return { ...r, truncated };
    }
    if (name.endsWith(".docx")) {
      // Word: el text i les taules s'extreuen al navegador (el document no es puja); la IA rep només el text
      onStage?.("Llegint el document Word…");
      const { docxText } = await import("@/server/doc-text");
      const d = await docxText(new Uint8Array(await file.arrayBuffer()));
      const text = d.pages.join("\n").slice(0, 160_000);
      if (!text.trim()) throw new Error("El document Word no té text.");
      onStage?.("La IA està llegint les tarifes (pot trigar fins a 2 minuts)…");
      const r = await call<{ raw: unknown; kind: string }>("/api/tariffs/ai-read", { method: "POST", body: JSON.stringify({ text, fileName: file.name, supplierHint }) });
      return { ...r, kind: "document Word", truncated: d.pages.join("\n").length > 160_000 };
    }
    const sb = browserSupabase();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) throw new Error("Cal iniciar sessió.");
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
    const path = `${auth.user.id}/tarifes-${crypto.randomUUID()}.${ext}`;
    onStage?.("Pujant el fitxer de manera privada…");
    const up = await sb.storage.from("invoices").upload(path, file, { contentType: uploadMime(file), upsert: false });
    if (up.error) throw new Error(`No s'ha pogut pujar: ${up.error.message}`);
    onStage?.("Llegint les tarifes (la Tarifa Open d'Endesa i els annexos de Nufri es llegeixen en local; la resta, amb IA, pot trigar fins a 2 minuts)…");
    const r = await call<{ raw: unknown; kind: string; open?: OpenDocument | null; nufri?: NufriDoc | null }>("/api/tariffs/ai-read", { method: "POST", body: JSON.stringify({ path, fileName: file.name, supplierHint }) });
    return { ...r, truncated: false };
  },
};

/* ------------------------------------------------------------ Tarifa Open: biblioteca de regles i xat */

export type LibraryRule = { id: string; kind: "modalitat" | "calendari"; supplier: string; product: string; access_tariff: string | null; doc_version: string | null; modality: Modality | null; rule: unknown; source: string; status: string; note: string | null; created_by_name: string | null; decided_by_name: string | null; decided_at: string | null; created_at: string };
export const openApi = {
  library: (k: { supplier: string; product: string; tariff: string | null; version: string | null }) =>
    call<{ rules: LibraryRule[]; approved: Partial<Record<Modality, { id: string; rule: OpenRule; note: string | null; by: string | null; at: string | null }>>; calendar: { extraHolidays: string[]; removedHolidays: string[] } | null; migrated: boolean }>(
      `/api/tariffs/open?${new URLSearchParams({ supplier: k.supplier, product: k.product, tariff: k.tariff ?? "", version: k.version ?? "" })}`),
  propose: (data: Record<string, unknown>) => call<{ rule: LibraryRule; approved: boolean; summary: string }>("/api/tariffs/open", { method: "POST", body: JSON.stringify({ action: "propose", data }) }),
  decide: (id: string, decision: "aprovada" | "rebutjada") => call<{ rule: LibraryRule }>("/api/tariffs/open", { method: "POST", body: JSON.stringify({ action: "decide", data: { id, decision } }) }),
  chat: (data: { message: string; context: OpenChatContext; history?: { role: "user" | "assistant"; text: string }[] }) => call<ChatAnswer>("/api/tariffs/open", { method: "POST", body: JSON.stringify({ action: "chat", data }) }),
};
