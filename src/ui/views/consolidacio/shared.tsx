"use client";
/** Fase 7 · client de l'API i components compartits dels panells (Centre de Control, panells per rol, tasques…). */
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { ApiError } from "../crm/api";
import { cn } from "../../components/ui";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new ApiError(0, "No hi ha connexió amb el servidor."); }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
const qs = (p: Record<string, string | number | undefined | null>) => new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]))).toString();
export const api = {
  control: <T,>(r: string, p: Record<string, string | number | undefined | null> = {}) => call<T>(`/api/control?${qs({ r, ...p })}`),
  controlAct: <T = { ok: boolean }>(action: string, b: Record<string, unknown> = {}) => call<T>("/api/control", { method: "POST", body: JSON.stringify({ action, ...b }) }),
  work: <T,>(r: string, p: Record<string, string | number | undefined | null> = {}) => call<T>(`/api/work?${qs({ r, ...p })}`),
  workAct: <T = { ok: boolean }>(action: string, b: Record<string, unknown> = {}) => call<T>("/api/work", { method: "POST", body: JSON.stringify({ action, ...b }) }),
  perms: <T,>(r = "", p: Record<string, string> = {}) => call<T>(`/api/permissions?${qs({ r, ...p })}`),
  permsAct: <T = { ok: boolean }>(action: string, data: unknown) => call<T>("/api/permissions", { method: "POST", body: JSON.stringify({ action, data }) }),
};

export const eur = (v: number | string | null | undefined, dp = 0) => (v == null || v === "" ? "—" : Number(v).toLocaleString("ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const num = (v: number | null | undefined, dp = 0) => (v == null ? "—" : v.toLocaleString("ca-ES", { maximumFractionDigits: dp }));
export const fdate = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("ca-ES", { day: "2-digit", month: "short" }) : "—");
export const fdt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtUnit = (v: unknown, unit: string) => (v == null ? "—" : unit === "eur" ? eur(v as number) : unit === "pct" ? `${num(v as number, 1)} %` : unit === "mwh" ? `${num(v as number, 1)} MWh` : num(v as number));
export const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

export function PageHead({ icon, title, sub, children, tone = "from-brand to-emerald-500" }: { icon: ReactNode; title: string; sub?: string; children?: ReactNode; tone?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white", tone)}>{icon}</span>{title}</h2>
        {sub && <p className="mt-1 max-w-3xl text-[13px] text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, tone, hint, onClick, sub }: { label: string; value: ReactNode; tone?: "red" | "amber" | "green" | "blue"; hint?: string; onClick?: () => void; sub?: ReactNode }) {
  const t = tone === "red" ? "text-red-600 dark:text-red-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "green" ? "text-emerald-600 dark:text-emerald-400" : tone === "blue" ? "text-sky-600 dark:text-sky-400" : "";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("group relative flex h-full min-h-[86px] w-full flex-col justify-between rounded-2xl border border-line bg-surface p-3.5 text-left", onClick && "pressable hover:border-ink/20")}>
      <p className="flex items-start gap-1 pr-4 text-[12px] leading-tight text-muted">{label}{hint && <span title={hint} className="absolute right-2.5 top-3 text-muted/60 hover:text-ink"><Info size={12} /></span>}</p>
      <p className={cn("mt-1 text-[22px] font-semibold leading-none tracking-tight tnum", t)}>{value}</p>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </Tag>
  );
}

export function Panel({ title, children, action, className, empty }: { title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; empty?: string | false }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2"><h3 className="text-[13.5px] font-semibold">{title}</h3>{action}</div>
      {empty ? <p className="py-6 text-center text-[12.5px] text-muted">{empty}</p> : children}
    </section>
  );
}

export const PRIORITY_TONE: Record<string, string> = { urgent: "bg-red-500/12 text-red-700 dark:text-red-300", alta: "bg-amber-500/14 text-amber-800 dark:text-amber-300", normal: "bg-ink/[0.06] text-ink/70", mitjana: "bg-ink/[0.06] text-ink/70", baixa: "bg-ink/[0.04] text-muted" };
export const PRIORITY_LABEL: Record<string, string> = { urgent: "Urgent", alta: "Alta", normal: "Normal", mitjana: "Mitjana", baixa: "Baixa" };
export const TASK_STATUS_LABEL: Record<string, string> = { pendent: "Pendent", en_curs: "En curs", bloquejada: "Bloquejada", feta: "Finalitzada", cancellada: "Cancel·lada" };
export const TASK_STATUS_TONE: Record<string, string> = { pendent: "bg-sky-500/12 text-sky-700 dark:text-sky-300", en_curs: "bg-violet-500/12 text-violet-700 dark:text-violet-300", bloquejada: "bg-red-500/12 text-red-700 dark:text-red-300", feta: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", cancellada: "bg-ink/[0.05] text-muted" };
export const INC_STATUS_LABEL: Record<string, string> = { oberta: "Oberta", en_curs: "En curs", esperant_tercers: "Esperant tercers", resolta: "Resolta", tancada: "Tancada" };
export const EXP_STATUS_LABEL: Record<string, string> = { pendent_documentacio: "Pendent de documentació", documentacio_completa: "Documentació completa", pendent_signatura: "Pendent de signatura", signat: "Signat", enviat: "Enviat", en_tramitacio: "En tramitació", activat: "Activat", incidencia: "Incidència", rebutjat: "Rebutjat" };
export const Pill = ({ className, children }: { className?: string; children: ReactNode }) => <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", className)}>{children}</span>;
export const isOverdue = (due: string | null | undefined, status?: string) => !!due && new Date(due) < new Date() && (!status || ["pendent", "en_curs", "bloquejada"].includes(status));

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[86px] animate-pulse rounded-2xl bg-elevated" />)}</div>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-elevated" />)}
    </div>
  );
}
