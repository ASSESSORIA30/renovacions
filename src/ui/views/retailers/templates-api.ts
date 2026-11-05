"use client";
/** Plantilles de lectura IA (Fase 11): client de /api/tariffs/reading-templates. */
import type { ReadResult, TemplateCheck, TemplateDef, TemplateOp, WorkbookGrid } from "@/comparator/xlsx-template";
import type { ReadingRule } from "@/comparator/tariff-table";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}
const post = <T,>(action: string, data: unknown) => call<T>("/api/tariffs/reading-templates", { method: "POST", body: JSON.stringify({ action, data }) });

export type TemplateStatus = "pendent" | "verificada" | "revisio" | "error" | "desactivada";
export interface TemplateRow { id: string; retailer_id: string | null; supplier: string; name: string; doc_type: string; status: TemplateStatus; active: boolean; current_version: number; verified_version: number | null; verified_at: string | null; verified_by_name: string | null; last_read_at: string | null; last_read_status: string | null; last_errors: { text: string }[]; validated_pct: number | null; created_by_name: string | null; created_at: string; updated_at: string }
export interface TemplateDetail {
  template: TemplateRow;
  version: { version: number; definition: TemplateDef; sample_name: string | null; sample_grid: WorkbookGrid | null; checks: TemplateCheck[]; note: string | null; created_by_name: string | null; created_at: string } | null;
  versions: { version: number; note: string | null; sample_name: string | null; created_by_name: string | null; created_at: string }[];
  corrections: { id: string; version: number | null; instruction: string; ops: TemplateOp[]; status: string; created_by_name: string | null; created_at: string }[];
  reads: { id: string; version: number; file_name: string; status: string; imported: boolean; created_by_name: string | null; created_at: string; summary: { stats: ReadResult["stats"] | null; compatibility: ReadResult["compatibility"] | null; validity: ReadResult["validity"] | null } }[];
  /** Fase 12: biblioteca de regles apreses d'aquesta plantilla, exemples validats i regles generals aprovades. */
  library?: LibraryRule[];
  examples?: { id: string; version: number | null; product_key: string; product_name: string; row_number: number | null; expected: (number | null)[]; explanation: string | null; explained: boolean; status: string; created_by_name: string | null; created_at: string; decided_by_name: string | null }[];
  generalRules?: { supplier: string; rule: ReadingRule }[];
}
export interface LibraryRule { id: string; supplier: string; product: string; rule: ReadingRule; source: string; status: "proposada" | "aprovada" | "rebutjada" | "substituida"; note: string | null; template_id: string | null; template_version: number | null; scope: string | null; columns: string[] | null; example: unknown; created_by_name: string | null; created_at: string; decided_by_name: string | null; decided_at: string | null }
export const STATUS_TXT: Record<TemplateStatus, { label: string; cls: string }> = {
  verificada: { label: "VERIFICADA", cls: "bg-emerald-500/12 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300" },
  pendent: { label: "PENDENT DE VERIFICACIÓ", cls: "bg-amber-500/12 text-amber-800 ring-amber-600/25 dark:text-amber-300" },
  revisio: { label: "REVISIÓ NECESSÀRIA", cls: "bg-orange-500/12 text-orange-800 ring-orange-600/25 dark:text-orange-300" },
  error: { label: "ERROR DE LECTURA", cls: "bg-red-500/12 text-red-700 ring-red-600/25 dark:text-red-300" },
  desactivada: { label: "DESACTIVADA", cls: "bg-zinc-500/12 text-zinc-600 ring-zinc-500/25 dark:text-zinc-300" },
};

export const tplApi = {
  list: (p: { retailer?: string; supplier?: string; defs?: boolean } = {}) =>
    call<{ templates: TemplateRow[]; defs?: { templateId: string; version: number; definition: TemplateDef }[]; generalRules?: { supplier: string; rule: ReadingRule }[]; migrated: boolean }>(`/api/tariffs/reading-templates?${new URLSearchParams({ r: "list", ...(p.retailer ? { retailer: p.retailer } : {}), ...(p.supplier ? { supplier: p.supplier } : {}), ...(p.defs ? { defs: "1" } : {}) })}`),
  get: (id: string, version?: number) => call<TemplateDetail>(`/api/tariffs/reading-templates?${new URLSearchParams({ r: "get", id, ...(version ? { version: String(version) } : {}) })}`),
  previous: (id: string) => call<{ read: { id: string; file_name: string; created_at: string; summary: Pick<ReadResult, "products" | "validity"> } | null }>(`/api/tariffs/reading-templates?r=previous&id=${encodeURIComponent(id)}`),
  create: (d: { retailerId: string | null; supplier: string; name: string; definition: TemplateDef; sample: WorkbookGrid | null; note?: string | null }) => post<{ template: TemplateRow; checks: TemplateCheck[] }>("create", d),
  version: (d: { id: string; definition: TemplateDef; note?: string | null; instruction?: string | null; ops?: TemplateOp[]; sample?: WorkbookGrid | null }) => post<{ template: TemplateRow; version: number; checks: TemplateCheck[] }>("version", d),
  verify: (id: string, version: number) => post<{ verified: boolean; checks: TemplateCheck[]; message?: string; template?: TemplateRow }>("verify", { id, version }),
  active: (id: string, active: boolean) => post<{ template: TemplateRow }>("active", { id, active }),
  duplicate: (id: string, name: string) => post<{ template: TemplateRow }>("duplicate", { id, name }),
  restore: (id: string, version: number) => post<{ template: TemplateRow; version: number }>("restore", { id, version }),
  read: (d: { id: string; version: number; fileName: string; result: ReadResult; imported?: boolean }) => post<{ id: string; status: string }>("read", d),
  imported: (readId: string) => post<{ ok: boolean }>("imported", { readId }),
  learn: (d: { templateId: string; rule: ReadingRule; scope: "producte" | "plantilla" | "general"; instruction?: string | null; example?: { productKey: string; productName: string; row: number | null; expected: (number | null)[]; explanation: string | null; discountApplied: boolean | null; explained: boolean } | null }) =>
    post<{ libraryId: string | null; status: string; version: number | null; approved: boolean; warning?: string }>("learn", d),
  decideRule: (id: string, decision: "aprovada" | "rebutjada") => post<{ ok: boolean; status: string; version: number | null }>("decideRule", { id, decision }),
  rules: (p: { id?: string; supplier?: string }) => call<{ rules: LibraryRule[]; migrated: boolean }>(`/api/tariffs/reading-templates?${new URLSearchParams({ r: "rules", ...(p.id ? { id: p.id } : {}), ...(p.supplier ? { supplier: p.supplier } : {}) })}`),
  aiSuggest: (supplier: string, rows: string[]) => post<{ proposals: { row: number; title: string; set: Record<string, unknown>; explanation: string }[] }>("aiSuggest", { supplier, rows }),
};

/** Excel (XLSX/XLS) o CSV del navegador → graella amb un parser real (SheetJS; es carrega només quan cal). Sense OCR. */
export async function readWorkbook(file: File): Promise<WorkbookGrid> {
  const [XLSX, { gridFromXlsx }] = await Promise.all([import("xlsx"), import("@/comparator/xlsx-template")]);
  return gridFromXlsx(XLSX as never, await file.arrayBuffer(), file.name);
}
