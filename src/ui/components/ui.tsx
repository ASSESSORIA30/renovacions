"use client";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { BadgeTone } from "@/core/insights";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export function Button({ variant = "secondary", size = "md", className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...p}
      className={cn(
        "pressable inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-[15px]",
        variant === "primary" && "bg-brand text-white shadow-sm hover:bg-brand/90 dark:text-zinc-950",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-elevated",
        variant === "ghost" && "text-muted hover:bg-ink/5 hover:text-ink",
        variant === "danger" && "bg-lost text-white hover:bg-lost/90",
        variant === "success" && "bg-ren text-white hover:bg-ren/90 dark:text-zinc-950",
        className
      )}
    >
      {children}
    </button>
  );
}

const TONES: Record<BadgeTone, string> = {
  red: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/20",
  orange: "bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-orange-500/20",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-blue-500/20",
  green: "bg-green-500/10 text-green-700 dark:text-green-300 ring-green-500/20",
  zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 ring-zinc-500/20",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20",
};
export function Badge({ tone = "zinc", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

export function Modal({ open, onClose, title, children, width = "max-w-lg", footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            className={cn("relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-lift sm:rounded-2xl", width)}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">{title}</h2>
              <button aria-label="Tancar" onClick={onClose} className="pressable rounded-md p-1 text-muted hover:bg-ink/5 hover:text-ink"><X size={18} /></button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-elevated px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="scroll-thin flex gap-1 overflow-x-auto" role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("relative whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors", value === t.id ? "text-ink" : "text-muted hover:text-ink")}
        >
          {value === t.id && <motion.span layoutId={`tab-${items[0].id}`} className="absolute inset-0 rounded-md bg-ink/[0.06]" transition={{ duration: 0.2, ease: EASE_OUT }} />}
          <span className="relative">{t.label}{t.count !== undefined && <span className="ml-1 text-muted tnum">{t.count}</span>}</span>
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-muted">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="max-w-sm text-xs text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "blue" | "red" | "green"; children: ReactNode }) {
  const t = {
    amber: "border-amber-500/30 bg-amber-500/[0.07] text-amber-800 dark:text-amber-200",
    blue: "border-blue-500/30 bg-blue-500/[0.07] text-blue-800 dark:text-blue-200",
    red: "border-red-500/30 bg-red-500/[0.07] text-red-800 dark:text-red-200",
    green: "border-green-500/30 bg-green-500/[0.07] text-green-800 dark:text-green-200",
  }[tone];
  return <div className={cn("rounded-lg border px-3 py-2 text-xs leading-relaxed", t)}>{children}</div>;
}

/** Supplier mark: coloured monogram (official logos can be added in /public/logos/<slug>.svg). */
const SUPPLIER_COLORS: Record<string, string> = {
  gana: "#00a77f", iberdrola: "#5b9d2e", endesa: "#0a6fb7", niba: "#ff5a1f", nufri: "#00838f", naturgy: "#e57200", chc: "#d61f69",
  serosense: "#6d28d9", "electrica serosense": "#6d28d9", novaluz: "#0ea5e9", digi: "#1d4ed8", o2: "#0050ff", "factor energia": "#f59e0b",
  "ab energia": "#16a34a", acciona: "#e30613", repsol: "#ff8200", visalia: "#0284c7", orange: "#ff7900", plenitude: "#00a0e3",
};
export function SupplierMark({ name, size = 22 }: { name: string | null; size?: number }) {
  const n = (name ?? "?").trim();
  const key = n.toLowerCase().replace(/\s*energ[ií]a$/, "").replace(/\s*\(.*\)$/, "");
  const color = SUPPLIER_COLORS[key] ?? SUPPLIER_COLORS[key.split(" ")[0]] ?? "#64748b";
  const letters = n.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <span title={n} className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.4, background: color }}>
      {letters}
    </span>
  );
}

/** Expiry gauge: 12 ticks; fills from the left as the renewal date approaches (90 → 0 days). */
export function ExpiryGauge({ days, tone }: { days: number | null; tone: string }) {
  const ticks = 12;
  const filled = days === null ? 0 : days <= 0 ? ticks : Math.max(0, Math.min(ticks, Math.round(((90 - days) / 90) * ticks)));
  return (
    <div className="flex items-end gap-[2px]" aria-hidden>
      {Array.from({ length: ticks }).map((_, i) => (
        <span key={i} className="w-[3px] rounded-full transition-colors" style={{ height: 4 + i * 0.6, background: i < filled ? tone : "rgb(var(--line))" }} />
      ))}
    </div>
  );
}
