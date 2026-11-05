/**
 * Fase 2 · Importació intel·ligent: compensació d'excedents i permanència a partir de documents, Excel o IA.
 * Mai s'assumeix un preu ni una durada: el que no consta queda «no informat».
 */
import { emptySurplus, SURPLUS_MODES, type PermanenceInfo, type SurplusConfig, type SurplusMode } from "./types";

export const SURPLUS_KEYWORDS = [
  "compensación de excedentes", "compensacion de excedentes", "compensació d'excedents", "energía excedentaria", "energia excedentaria",
  "autoconsumo", "autoconsum", "compensación simplificada", "compensacion simplificada", "batería virtual", "bateria virtual",
  "monedero solar", "precio excedentes", "precio de excedentes", "excedentes indexados", "excedents",
];
const BATTERY_KW = /bater[ií]a virtual|monedero solar|bateria virtual|hucha solar/i;

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Paraules clau d'excedents presents al text (sense duplicats). */
export function detectSurplusKeywords(text: string): string[] {
  const t = plain(text);
  return [...new Set(SURPLUS_KEYWORDS.filter((k) => t.includes(plain(k))).map(plain))];
}

const numOr = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && v.trim()) { const n = Number(v.replace(/[^\d,.\-]/g, "").replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : null; }
  return null;
};

/** Modalitat a partir d'un text lliure («fijo», «por periodos», «indexado», «batería virtual», «no»…). */
export function surplusModeOf(raw: unknown): SurplusMode | null {
  if (raw == null) return null;
  const t = plain(String(raw));
  if (!t.trim()) return null;
  if ((SURPLUS_MODES as readonly string[]).includes(t)) return t as SurplusMode;
  if (/bater|monedero|hucha/.test(t)) return "bateria";
  if (/index|pool|omie|mercado/.test(t)) return "indexat";
  if (/period|p1|tramo/.test(t)) return "periodes";
  if (/^(no|sin|sense|n)$|no compensa|sin compensa/.test(t)) return "sense";
  if (/fij|fix|unico|si|sí|yes/.test(t)) return "fix";
  return null;
}

/**
 * Configuració d'excedents a partir dels camps importats. Sense camps i sense paraules clau → «no informada».
 * Amb paraules clau però sense preu → modalitat detectada amb el preu pendent (mai s'inventa).
 */
export function surplusFromImport(f: { mode?: unknown; price?: unknown; periodPrices?: unknown; formula?: unknown; battery?: unknown; batteryFee?: unknown; limits?: unknown; notes?: unknown; keywords?: string[] }, source: SurplusConfig["source"]): SurplusConfig {
  const price = numOr(f.price);
  const periods = Array.isArray(f.periodPrices) ? Array.from({ length: 6 }, (_, i) => numOr((f.periodPrices as unknown[])[i])) : Array(6).fill(null);
  const batteryYes = f.battery === true || (typeof f.battery === "string" && /^(s|si|sí|yes|true|1)$/i.test(f.battery.trim())) || (f.keywords ?? []).some((k) => BATTERY_KW.test(k));
  let mode = surplusModeOf(f.mode);
  if (!mode && batteryYes) mode = "bateria";
  if (!mode && periods.some((x) => x != null)) mode = "periodes";
  if (!mode && price != null) mode = "fix";
  if (!mode && (f.keywords ?? []).some((k) => /index/.test(k))) mode = "indexat";
  if (!mode) {
    const s = emptySurplus("no_informada");
    if (f.keywords?.length) s.notes = `El document esmenta excedents (${f.keywords.slice(0, 4).join(", ")}) però no se n'han pogut llegir les condicions: cal completar-les.`;
    return { ...s, source: f.keywords?.length ? source : null };
  }
  const s = emptySurplus(mode);
  return {
    ...s,
    eurKwh: mode === "periodes" ? null : price,
    periodEurKwh: periods,
    formula: typeof f.formula === "string" && f.formula.trim() ? f.formula.trim().slice(0, 500) : null,
    battery: mode === "bateria" || batteryYes ? { enabled: true, feeEurMonth: numOr(f.batteryFee), accumulation: null, usage: null, expiry: null } : null,
    limits: typeof f.limits === "string" && f.limits.trim() ? f.limits.trim().slice(0, 1000) : null,
    notes: typeof f.notes === "string" && f.notes.trim() ? f.notes.trim().slice(0, 1000) : null,
    source,
  };
}

/** Permanència importada: un número de mesos → «amb»; «no/sin» → «sense»; buit → no informada. Mai s'inventen 12 mesos. */
export function permanenceFromImport(raw: unknown, extra: { penalty?: string | null; source?: string | null } = {}): PermanenceInfo {
  const base = { startNote: null, cancellation: null, penalty: extra.penalty ?? null, source: extra.source ?? null, exception: null };
  if (raw == null || (typeof raw === "string" && !raw.trim())) return { status: "no_informada", months: null, ...base };
  if (typeof raw === "number") return raw > 0 ? { status: "amb", months: Math.round(raw), ...base } : { status: "sense", months: null, ...base };
  const t = plain(String(raw));
  const m = t.match(/(\d{1,3})\s*(mes|meses|mesos|m\b)?/);
  const y = t.match(/(\d)\s*(ano|anos|any|anys)/);
  if (y) return { status: "amb", months: Number(y[1]) * 12, ...base };
  if (m) return Number(m[1]) > 0 ? { status: "amb", months: Number(m[1]), ...base } : { status: "sense", months: null, ...base };
  if (/^(no|sin|sense)\b|sin permanencia|sense permanencia/.test(t)) return { status: "sense", months: null, ...base };
  if (/^(si|sí|yes)\b|con permanencia|amb permanencia/.test(t)) return { status: "amb", months: null, ...base };
  return { status: "no_informada", months: null, ...base };
}
