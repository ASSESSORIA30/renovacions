/** Consum EAS per intervals. No anualitza ni estima períodes absents. */
export type AnnualConsumption = {
  status: "complete" | "incomplete";
  from: string | null;
  to: string | null;
  lastAvailable: string | null;
  periods: (number | null)[];
  total: number | null;
  annualListTotal: number | null;
  difference: number | null;
  warning: string | null;
  source: string;
};

type Rec = { start: string; end: string; values: (number | null)[]; signature: string };
const DAY = 86400000;
const utc = (s: string): number => Date.parse(`${s}T00:00:00Z`);
const iso = (n: number): string => new Date(n).toISOString().slice(0, 10);
const monthEnd = (n: number) => new Date(Date.UTC(new Date(n).getUTCFullYear(), new Date(n).getUTCMonth() + 1, 0)).getTime();
const monthStartMinus11 = (end: number) => { const d = new Date(end); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1); };

/** 1.958,168 -> 1958.168; 1,958.168 -> 1958.168; blanks are null. */
export function easNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  let s = value.trim().replace(/\s|\u00a0/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function norm(k: string) { return k.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function get(r: Record<string, unknown>, aliases: string[]): unknown {
  const pairs = Object.entries(r);
  const wanted = new Set(aliases.map(norm));
  return pairs.find(([k]) => wanted.has(norm(k)))?.[1];
}
function dateValue(x: unknown): string | null {
  if (x == null) return null;
  const s = String(x).trim();
  let isoDate: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) isoDate = s.slice(0, 10);
  else { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s); if (m) isoDate = `${m[3]}-${m[2]}-${m[1]}`; }
  return isoDate && Number.isFinite(utc(isoDate)) && iso(utc(isoDate)) === isoDate ? isoDate : null;
}
const startKeys = ["FechaInicio", "FechaInicioConsumo", "FInicio", "FechaDesde", "Desde", "FechaInicial", "Inicio"];
const endKeys = ["FechaFin", "FechaFinConsumo", "FFin", "FechaHasta", "Hasta", "FechaFinal", "Fin"];

/** Fields in 'Consumo Punto Suministro' are kWh, not reactive energy or power. */
function readRecord(o: Record<string, unknown>, count: number): Rec | null {
  const start = dateValue(get(o, startKeys)), end = dateValue(get(o, endKeys));
  if (!start || !end || utc(end) < utc(start)) return null;
  const values = Array.from({ length: count }, (_, i) => {
    const p = i + 1;
    return easNumber(get(o, [`E.A. P${p} (kWh)`, `EAP${p}`, `EActivaP${p}`, `EnergiaActivaP${p}`, `ConsumoEnergiaActivaP${p}`, `ConsumoEnergiaActivaEnKWhP${p}`]));
  });
  return { start, end, values, signature: `${start}|${end}|${values.join("|")}` };
}

/** Select latest 12 fully covered calendar months, without overlapping intervals. */
export function annualFromEasHistory(history: Record<string, unknown>[], count: 3 | 6, annualList: unknown): AnnualConsumption {
  const annualListTotal = easNumber(annualList);
  const dedup = new Map<string, Rec>();
  for (const h of history) { const r = readRecord(h, count); if (r) dedup.set(r.signature, r); }
  const records = [...dedup.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const lastAvailable = records.length ? records.map(r => r.end).sort().at(-1)! : null;
  const empty = (warning: string): AnnualConsumption => ({ status: "incomplete", from: null, to: null, lastAvailable, periods: Array(count).fill(null), total: null, annualListTotal, difference: null, warning, source: "EAS · Consumo Punto Suministro" });
  if (!records.length) return empty("No hi ha registres de consum per períodes a la resposta d'EAS.");
  const latestMonth = monthEnd(utc(lastAvailable!));
  for (let candidate = latestMonth, trials = 0; trials < 36; trials++) {
    const begin = monthStartMinus11(candidate);
    const inWindow = records.filter(r => utc(r.start) >= begin && utc(r.end) <= candidate);
    if (inWindow.length) {
      let next = begin;
      let valid = true;
      const sums = Array(count).fill(0) as number[];
      for (const r of inWindow) {
        const a = utc(r.start), b = utc(r.end);
        if (a !== next || r.values.some(v => v == null)) { valid = false; break; }
        r.values.forEach((v, i) => { sums[i] += v!; });
        next = b + DAY;
      }
      if (valid && next === candidate + DAY) {
        const periods = sums.map(v => Math.round(v * 1000) / 1000);
        const total = Math.round(sums.reduce((a, b) => a + b, 0) * 1000) / 1000;
        const difference = annualListTotal == null ? null : Math.round((total - annualListTotal) * 1000) / 1000;
        const warning = difference != null && Math.abs(difference) > 1 ? "El resum E.A. Anual difereix del tram calculat; poden ser finestres temporals diferents." : null;
        return { status: "complete", from: iso(begin), to: iso(candidate), lastAvailable, periods, total, annualListTotal, difference, warning, source: "EAS · Consumo Punto Suministro" };
      }
    }
    const d = new Date(candidate);
    candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0);
  }
  return empty("Històric incomplet: no hi ha 12 mesos naturals consecutius amb cobertura íntegra i sense solapaments.");
}
