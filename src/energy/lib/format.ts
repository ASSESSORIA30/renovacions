import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const fmt = {
  n(v: number | null | undefined, d = 0) {
    if (v == null || !Number.isFinite(v)) return "—";
    return v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  eur(v: number | null | undefined, d = 0) {
    if (v == null || !Number.isFinite(v)) return "—";
    return v.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d });
  },
  kw(v: number | null | undefined, d = 1) {
    return v == null ? "—" : `${fmt.n(v, d)} kW`;
  },
  kwh(v: number | null | undefined) {
    return v == null ? "—" : `${fmt.n(v)} kWh`;
  },
  pct(v: number | null | undefined, d = 0) {
    return v == null || !Number.isFinite(v) ? "—" : `${fmt.n(v * 100, d)} %`;
  },
  date(iso: string | null | undefined) {
    if (!iso) return "—";
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  },
  dateTime(iso: string | null | undefined) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
  },
};

export function cn(...c: ClassValue[]) {
  return twMerge(clsx(c));
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
