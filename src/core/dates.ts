export const DAY = 86_400_000;

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toISODate(new Date());
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseISO(toISO).getTime() - parseISO(fromISO).getTime()) / DAY);
}

export function daysUntil(iso: string | null | undefined, ref = today()): number | null {
  if (!iso) return null;
  return daysBetween(ref, iso);
}

export function addMonths(iso: string, n: number): string {
  const d = parseISO(iso);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return toISODate(t);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

const fmt = new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short", year: "numeric" });
const fmtShort = new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short" });
export const fmtDate = (iso?: string | null) => (iso ? fmt.format(parseISO(iso)) : "—");
export const fmtDateShort = (iso?: string | null) => (iso ? fmtShort.format(parseISO(iso)) : "—");
/** Spanish formatter (used in Spanish PDFs). */
const fmtEs = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });
export const fmtDateEs = (iso?: string | null) => (iso ? fmtEs.format(parseISO(iso)) : "—");
export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export function relDays(n: number | null): string {
  if (n === null) return "Sense data";
  if (n === 0) return "Venç avui";
  if (n === 1) return "Venç demà";
  if (n < 0) return `Vençut fa ${-n} d`;
  return `Venç en ${n} d`;
}

/** Parse dd/mm/yyyy, yyyy-mm-dd, Excel serial or Date into ISO date */
export function anyToISO(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return toISODate(new Date(v.getTime() + 12 * 3600_000)) // rounds SheetJS 23:59:xx artefacts to the right day;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial date (1900 system)
    const ms = Math.round((v - 25569) * DAY);
    const d = new Date(ms);
    return toISODate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return toISODate(new Date(y, Number(m[2]) - 1, Number(m[1])));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
