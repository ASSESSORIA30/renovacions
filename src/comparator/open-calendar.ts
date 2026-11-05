/**
 * CALENDARI HORARI ELÈCTRIC i PONDERACIÓ DE TARIFES «OPEN» (part pura, servidor i navegador, testejable).
 *
 * 1. Períodes P1–P6 dels peatges 3.0TD i 6.xTD a la Península (Circular CNMC 3/2020):
 *      · Dissabtes, diumenges i festius nacionals: P6 les 24 hores.
 *      · Dies laborables: 00–08 h P6 · 09–14 h i 18–22 h «punta» · 08–09 h, 14–18 h i 22–24 h «pla».
 *      · Temporades: alta (gen, feb, jul, des) punta P1 / pla P2 · mitjana-alta (mar, nov) P2 / P3 ·
 *        mitjana (jun, ago, set) P3 / P4 · baixa (abr, mai, oct) P4 / P5.
 *    Tot és configurable (`CalendarConfig`): temporades, franges i festius.
 * 2. Hores reals del període de referència en hora local Europe/Madrid, amb els canvis d'hora (dia de 23 h al març
 *    i de 25 h a l'octubre) i els anys de traspàs. El canvi d'hora segueix la regla europea (últim diumenge de
 *    març i d'octubre a les 01:00 UTC).
 * 3. Regles de les modalitats Open: franges horàries (Día, Noche…), conversió per períodes (Laboral, Fin de
 *    semana segons Direcció) o preu pla.
 * 4. Preu estimat per període = (hores Open × preu Open + hores No Open × preu No Open) / hores totals.
 *    Es calcula amb precisió decimal completa i només s'arrodoneix el resultat a 6 decimals.
 *    ÉS UNA PONDERACIÓ TEMPORAL, no el cost real del client (que depèn de quan consumeix).
 */
import Decimal from "decimal.js-light";

export type Period = 1 | 2 | 3 | 4 | 5 | 6;
export const PERIOD_LIST: Period[] = [1, 2, 3, 4, 5, 6];

/* ======================================================================= configuració del calendari */

export type Season = "alta" | "mitjana_alta" | "mitjana" | "baixa";
export interface CalendarConfig {
  /** Temporada de cada mes (1..12). */
  seasons: Record<number, Season>;
  /** Període de la franja «punta» i «pla» de cada temporada (dies laborables). */
  seasonPeriods: Record<Season, { punta: Period; pla: Period }>;
  /** Franges horàries dels dies laborables: [des de, fins a) en hores locals. La resta d'hores = P6. */
  punta: [number, number][];
  pla: [number, number][];
  /** Festius nacionals de data fixa i no substituïbles (MM-DD) + dates concretes addicionals o excloses (AAAA-MM-DD). */
  fixedHolidays: string[];
  extraHolidays: string[];
  removedHolidays: string[];
}

export const DEFAULT_CALENDAR: CalendarConfig = {
  seasons: { 1: "alta", 2: "alta", 3: "mitjana_alta", 4: "baixa", 5: "baixa", 6: "mitjana", 7: "alta", 8: "mitjana", 9: "mitjana", 10: "baixa", 11: "mitjana_alta", 12: "alta" },
  seasonPeriods: { alta: { punta: 1, pla: 2 }, mitjana_alta: { punta: 2, pla: 3 }, mitjana: { punta: 3, pla: 4 }, baixa: { punta: 4, pla: 5 } },
  punta: [[9, 14], [18, 22]],
  pla: [[8, 9], [14, 18], [22, 24]],
  // Festius d'àmbit nacional de data fixa i no substituïbles (els que la CNMC considera per als períodes)
  fixedHolidays: ["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"],
  extraHolidays: [],
  removedHolidays: [],
};

export const SEASON_LABEL: Record<Season, string> = { alta: "Alta", mitjana_alta: "Mitjana-alta", mitjana: "Mitjana", baixa: "Baixa" };
/** Peatges amb calendari de 6 períodes que coneix el motor. */
export const SIX_PERIOD_TARIFFS = ["3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD"];

/* ======================================================================= hora local Europe/Madrid */

const H = 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** Últim diumenge d'un mes (dia del mes). */
function lastSunday(year: number, month1: number): number {
  const last = new Date(Date.UTC(year, month1, 0)); // últim dia del mes
  return last.getUTCDate() - last.getUTCDay();
}
/** Desplaçament (hores) d'Europe/Madrid peninsular en un instant UTC: +2 a l'estiu, +1 a l'hivern. */
export function madridOffset(utcMs: number): 1 | 2 {
  const y = new Date(utcMs).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 3), 1); // últim diumenge de març, 01:00 UTC
  const end = Date.UTC(y, 9, lastSunday(y, 10), 1); // últim diumenge d'octubre, 01:00 UTC
  return utcMs >= start && utcMs < end ? 2 : 1;
}
/** Instant UTC de la mitjanit local d'una data (AAAA-MM-DD). A mitjanit mai hi ha canvi d'hora. */
export function localMidnightUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d) - H; // hivern
  return Date.UTC(y, m - 1, d) - madridOffset(guess) * H;
}
export interface LocalHour { date: string; month: number; weekday: number; hour: number; utc: number }
/** Totes les hores locals reals entre dues dates (des de `from` inclosa fins a `to` exclosa). */
export function* localHours(from: string, to: string): Generator<LocalHour> {
  const end = localMidnightUtc(to);
  for (let t = localMidnightUtc(from); t < end; t += H) {
    const l = new Date(t + madridOffset(t) * H);
    yield { date: `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`, month: l.getUTCMonth() + 1, weekday: l.getUTCDay(), hour: l.getUTCHours(), utc: t };
  }
}

/* ======================================================================= festius i períodes */

export function holidaySet(from: string, to: string, cfg: CalendarConfig = DEFAULT_CALENDAR): Set<string> {
  const s = new Set<string>();
  const y0 = Number(from.slice(0, 4)), y1 = Number(to.slice(0, 4));
  for (let y = y0; y <= y1; y++) for (const md of cfg.fixedHolidays) s.add(`${y}-${md}`);
  for (const d of cfg.extraHolidays) s.add(d);
  for (const d of cfg.removedHolidays) s.delete(d);
  return s;
}
const inRanges = (h: number, r: [number, number][]) => r.some(([a, b]) => h >= a && h < b);
/** Dia «festiu» als efectes elèctrics: dissabte, diumenge o festiu nacional. */
export const isFestiu = (lh: Pick<LocalHour, "date" | "weekday">, hol: Set<string>) => lh.weekday === 0 || lh.weekday === 6 || hol.has(lh.date);

/** Període P1–P6 d'una hora local (peatges de 6 períodes, Península). */
export function periodOf(lh: LocalHour, hol: Set<string>, cfg: CalendarConfig = DEFAULT_CALENDAR): Period {
  if (isFestiu(lh, hol)) return 6;
  const sp = cfg.seasonPeriods[cfg.seasons[lh.month]];
  if (inRanges(lh.hour, cfg.punta)) return sp.punta;
  if (inRanges(lh.hour, cfg.pla)) return sp.pla;
  return 6;
}

/* ======================================================================= modalitats i regles Open */

export const MODALITIES = ["plana", "dia", "laboral", "cap_de_setmana", "nit"] as const;
export type Modality = (typeof MODALITIES)[number];
export const MODALITY_LABEL: Record<Modality, string> = { plana: "Plana", dia: "Día", laboral: "Laboral", cap_de_setmana: "Fin de Semana", nit: "Noche" };

/** Classes de dia per a les franges: tots · dl_dv (dilluns a divendres, festius inclosos) · laborable (dl–dv no festius) · festiu (ds, dg i festius). */
export type DayClass = "tots" | "dl_dv" | "laborable" | "festiu";
export const DAY_LABEL: Record<DayClass, string> = { tots: "tots els dies", dl_dv: "de dilluns a divendres", laborable: "de dilluns a divendres excepte festius nacionals", festiu: "dissabtes, diumenges i festius nacionals" };
export interface Window { days: DayClass; from: number; to: number }
export type OpenRule =
  | { mode: "plana" }
  | { mode: "horari"; windows: Window[] }
  | { mode: "periodes"; openPeriods: Period[] };

/** Regles comercials definides per Direcció (per defecte, si no n'hi ha cap d'aprovada a la biblioteca). */
export const DIRECCIO_RULES: Record<Modality, OpenRule> = {
  plana: { mode: "plana" },
  dia: { mode: "horari", windows: [{ days: "tots", from: 8, to: 24 }] },
  laboral: { mode: "periodes", openPeriods: [1, 2, 3, 4, 5] },
  cap_de_setmana: { mode: "periodes", openPeriods: [6] },
  nit: { mode: "horari", windows: [{ days: "dl_dv", from: 0, to: 8 }] },
};

const dayMatch = (c: DayClass, lh: LocalHour, hol: Set<string>) =>
  c === "tots" ? true : c === "dl_dv" ? lh.weekday >= 1 && lh.weekday <= 5 : c === "laborable" ? !isFestiu(lh, hol) : isFestiu(lh, hol);
/** Aquesta hora és Open segons la regla? (per a «periodes» cal el període de l'hora). */
export function isOpenHour(rule: OpenRule, lh: LocalHour, p: Period, hol: Set<string>): boolean {
  if (rule.mode === "plana") return true;
  if (rule.mode === "periodes") return rule.openPeriods.includes(p);
  return rule.windows.some((w) => dayMatch(w.days, lh, hol) && lh.hour >= w.from && lh.hour < w.to);
}
/** Descripció llegible d'una regla. */
export function describeRule(rule: OpenRule): string {
  if (rule.mode === "plana") return "Preu únic les 24 hores, tots els dies";
  if (rule.mode === "periodes") return `Conversió per períodes: ${rule.openPeriods.map((p) => `P${p}`).join(", ") || "cap"} al preu Open; la resta al preu No Open`;
  return `Open: ${rule.windows.map((w) => `${pad(w.from)}:00–${pad(w.to)}:00 ${DAY_LABEL[w.days]}`).join(" i ")}. No Open: la resta d'hores`;
}

/* ======================================================================= recompte d'hores i ponderació */

export interface PeriodCount { period: Period; open: number; noOpen: number; total: number }
export interface HourCounts { from: string; to: string; tariff: string; periods: PeriodCount[]; totalHours: number; holidays: string[]; dstDays: { date: string; hours: number }[] }

/** Hores Open i No Open de cada període en el període de referència. */
export function countHours(tariff: string, rule: OpenRule, ref: { from: string; to: string }, cfg: CalendarConfig = DEFAULT_CALENDAR): HourCounts {
  if (!SIX_PERIOD_TARIFFS.includes(tariff)) throw new Error(`El calendari de ponderació només coneix els peatges de 6 períodes (${SIX_PERIOD_TARIFFS.join(", ")}), no «${tariff}».`);
  const hol = holidaySet(ref.from, ref.to, cfg);
  const per = new Map<Period, PeriodCount>(PERIOD_LIST.map((p) => [p, { period: p, open: 0, noOpen: 0, total: 0 }]));
  const perDay = new Map<string, number>();
  let total = 0;
  const usedHol = new Set<string>();
  for (const lh of localHours(ref.from, ref.to)) {
    const p = periodOf(lh, hol, cfg);
    const c = per.get(p)!;
    if (isOpenHour(rule, lh, p, hol)) c.open++; else c.noOpen++;
    c.total++;
    total++;
    perDay.set(lh.date, (perDay.get(lh.date) ?? 0) + 1);
    if (hol.has(lh.date)) usedHol.add(lh.date);
  }
  const dstDays = [...perDay].filter(([, n]) => n !== 24).map(([date, hours]) => ({ date, hours }));
  return { from: ref.from, to: ref.to, tariff, periods: [...per.values()], totalHours: total, holidays: [...usedHol].sort(), dstDays };
}

export interface WeightedPrice { period: Period; open: number; noOpen: number; total: number; openPct: number; price: number; exact: string; formula: string }

/** Preus estimats per ponderació horària (sis decimals; el valor exacte es conserva a `exact`). */
export function weightedPrices(counts: HourCounts, prices: { open: number; noOpen: number }, rule: OpenRule): WeightedPrice[] {
  return counts.periods.map((c) => {
    if (rule.mode === "plana") return { period: c.period, open: c.total, noOpen: 0, total: c.total, openPct: 100, price: prices.open, exact: String(prices.open), formula: `Plana: ${prices.open} €/kWh les 24 hores` };
    const po = new Decimal(prices.open), pn = new Decimal(prices.noOpen);
    const v = c.total ? po.times(c.open).plus(pn.times(c.noOpen)).dividedBy(c.total) : new Decimal(0);
    const price = Number(v.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
    const openPct = c.total ? Number(new Decimal(c.open).times(100).dividedBy(c.total).toDecimalPlaces(2).toString()) : 0;
    return {
      period: c.period, open: c.open, noOpen: c.noOpen, total: c.total, openPct, price, exact: v.toString(),
      formula: `(${c.open} h × ${prices.open} + ${c.noOpen} h × ${prices.noOpen}) / ${c.total} h = ${price.toFixed(6)} €/kWh`,
    };
  });
}

/** Període de referència per defecte: els 12 mesos que comencen el mes vinent. */
export function defaultReference(today = new Date()): { from: string; to: string } {
  const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1;
  const fy = m === 12 ? y + 1 : y, fm = m === 12 ? 1 : m + 1;
  return { from: `${fy}-${pad(fm)}-01`, to: `${fy + 1}-${pad(fm)}-01` };
}
export const yearReference = (year: number) => ({ from: `${year}-01-01`, to: `${year + 1}-01-01` });

/* ======================================================================= discrepàncies regla interna ↔ document */

export interface Discrepancy { period: Period; internalOpen: number; documentOpen: number; total: number; diffHours: number; internalPrice: number; documentPrice: number }
/** Compara la regla interna amb la del document, període a període (hores Open i preu resultant). */
export function compareRules(tariff: string, internal: OpenRule, document: OpenRule, ref: { from: string; to: string }, prices: { open: number; noOpen: number }, cfg: CalendarConfig = DEFAULT_CALENDAR): Discrepancy[] {
  const a = countHours(tariff, internal, ref, cfg), b = countHours(tariff, document, ref, cfg);
  const pa = weightedPrices(a, prices, internal), pb = weightedPrices(b, prices, document);
  return PERIOD_LIST.map((p, i) => ({ period: p, internalOpen: a.periods[i].open, documentOpen: b.periods[i].open, total: a.periods[i].total, diffHours: a.periods[i].open - b.periods[i].open, internalPrice: pa[i].price, documentPrice: pb[i].price }))
    .filter((d) => d.diffHours !== 0);
}

/* ======================================================================= consum horari real */

export interface HourlyKwh { date: string; hour: number; kwh: number }
export interface EffectiveResult { periods: { period: Period; kwh: number; openKwh: number; cost: number; price: number | null }[]; kwh: number; cost: number; hours: number; skipped: number }
/**
 * Cost de l'energia aplicant el preu Open o No Open a CADA hora real de consum (curva horària). Dona també el
 * preu efectiu de cada període (ponderat pel consum). No és una factura: no inclou potència, impostos ni recàrrecs.
 */
export function effectiveFromHourly(tariff: string, rule: OpenRule, prices: { open: number; noOpen: number }, hourly: HourlyKwh[], cfg: CalendarConfig = DEFAULT_CALENDAR): EffectiveResult {
  if (!hourly.length) return { periods: PERIOD_LIST.map((p) => ({ period: p, kwh: 0, openKwh: 0, cost: 0, price: null })), kwh: 0, cost: 0, hours: 0, skipped: 0 };
  const dates = hourly.map((h) => h.date).sort();
  const hol = holidaySet(dates[0], dates[dates.length - 1], cfg);
  const acc = new Map<Period, { kwh: Decimal; openKwh: Decimal; cost: Decimal }>(PERIOD_LIST.map((p) => [p, { kwh: new Decimal(0), openKwh: new Decimal(0), cost: new Decimal(0) }]));
  let skipped = 0;
  for (const h of hourly) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date) || !(h.hour >= 0 && h.hour <= 23) || !Number.isFinite(h.kwh) || h.kwh < 0) { skipped++; continue; }
    const [y, m, d] = h.date.split("-").map(Number);
    const lh: LocalHour = { date: h.date, month: m, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), hour: h.hour, utc: 0 };
    const p = SIX_PERIOD_TARIFFS.includes(tariff) ? periodOf(lh, hol, cfg) : 6;
    const open = isOpenHour(rule, lh, p, hol);
    const a = acc.get(p)!;
    a.kwh = a.kwh.plus(h.kwh);
    if (open) a.openKwh = a.openKwh.plus(h.kwh);
    a.cost = a.cost.plus(new Decimal(h.kwh).times(open ? prices.open : rule.mode === "plana" ? prices.open : prices.noOpen));
  }
  const periods = PERIOD_LIST.map((p) => {
    const a = acc.get(p)!;
    return { period: p, kwh: Number(a.kwh.toString()), openKwh: Number(a.openKwh.toString()), cost: Number(a.cost.toDecimalPlaces(6).toString()), price: a.kwh.isZero() ? null : Number(a.cost.dividedBy(a.kwh).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()) };
  });
  const kwh = periods.reduce((s, x) => s + x.kwh, 0);
  const cost = Number(PERIOD_LIST.reduce((s, p) => s.plus(acc.get(p)!.cost), new Decimal(0)).toDecimalPlaces(2).toString());
  return { periods, kwh, cost, hours: hourly.length - skipped, skipped };
}

/**
 * Llegeix una corba de consum horari (CSV de Datadis o de la distribuïdora): columnes de data, hora (1–24 o
 * 0–23, o «HH:MM») i consum en kWh. Separador «;» o «,», decimals amb coma o punt.
 */
export function parseHourlyCsv(text: string): { rows: HourlyKwh[]; warnings: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const warnings: string[] = [];
  if (!lines.length) return { rows: [], warnings: ["El fitxer és buit"] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const head = lines[0].toLowerCase().split(sep).map((h) => h.replace(/"/g, "").trim());
  const iDate = head.findIndex((h) => /fecha|data|date|dia/.test(h));
  const iHour = head.findIndex((h) => /^hora|hour|^h$/.test(h));
  const iKwh = head.findIndex((h) => /consumo|consum|kwh|ae|energ/.test(h) && !/metodo|method|obten/.test(h));
  if (iDate < 0 || iHour < 0 || iKwh < 0) return { rows: [], warnings: ["No s'han trobat les columnes de data, hora i consum (kWh)"] };
  const rows: HourlyKwh[] = [];
  let oneBased = false;
  const raw: { date: string; h: number; kwh: number }[] = [];
  for (const l of lines.slice(1)) {
    const c = l.split(sep).map((x) => x.replace(/"/g, "").trim());
    const dRaw = c[iDate] ?? "";
    const m1 = dRaw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/), m2 = dRaw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    const date = m1 ? `${m1[1]}-${pad(+m1[2])}-${pad(+m1[3])}` : m2 ? `${m2[3]}-${pad(+m2[2])}-${pad(+m2[1])}` : null;
    const hRaw = c[iHour] ?? "";
    const h = /^\d{1,2}:\d{2}/.test(hRaw) ? Number(hRaw.split(":")[0]) : Number(hRaw);
    const k = c[iKwh] ?? "";
    const kwh = Number(k.includes(",") ? k.replace(/\./g, "").replace(",", ".") : k);
    if (!date || !Number.isFinite(h) || !Number.isFinite(kwh)) continue;
    if (h === 24 || (h === 25)) oneBased = true;
    raw.push({ date, h, kwh });
  }
  // Datadis numera les hores d'1 a 24 (l'hora 1 és 00:00–01:00): es passen a 0–23
  if (!oneBased && raw.length && !raw.some((r) => r.h === 0)) oneBased = true;
  for (const r of raw) {
    const hour = oneBased ? r.h - 1 : r.h;
    rows.push({ date: r.date, hour: Math.min(23, Math.max(0, hour)), kwh: r.kwh });
  }
  if (!rows.length) warnings.push("No s'ha pogut llegir cap fila de consum");
  else if (rows.length < 24 * 28) warnings.push(`Només hi ha ${rows.length} hores de consum: el càlcul és representatiu només d'aquest període`);
  return { rows, warnings };
}
