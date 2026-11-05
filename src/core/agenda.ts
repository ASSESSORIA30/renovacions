/**
 * AGENDA (Fase 10) · lògica pura compartida pel servidor, la interfície i els tests.
 *  - Zona horària Europe/Madrid (canvis d'hora inclosos): les recurrències mantenen l'hora local.
 *  - Recurrències (diària, setmanal amb dies, mensual, anual) amb excepcions.
 *  - Coincidències horàries, disponibilitat de l'equip i proposta de franges lliures.
 *  - Recordatoris pendents d'enviar (antelació configurable).
 */
export const TZ = "Europe/Madrid";

export const EVENT_KINDS = ["cita", "trucada", "visita", "reunio", "seguiment", "recordatori", "tasca", "absencia"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const KIND_LABEL: Record<EventKind, string> = { cita: "Cita", trucada: "Trucada", visita: "Visita comercial", reunio: "Reunió", seguiment: "Seguiment", recordatori: "Recordatori", tasca: "Tasca", absencia: "Absència" };
/** Colors per tipus (classes Tailwind; el text sempre acompanya el color, mai el color sol). */
export const KIND_COLOR: Record<EventKind, { bg: string; text: string; dot: string }> = {
  cita: { bg: "bg-sky-500/12", text: "text-sky-800 dark:text-sky-200", dot: "bg-sky-500" },
  trucada: { bg: "bg-violet-500/12", text: "text-violet-800 dark:text-violet-200", dot: "bg-violet-500" },
  visita: { bg: "bg-emerald-500/14", text: "text-emerald-800 dark:text-emerald-200", dot: "bg-emerald-500" },
  reunio: { bg: "bg-indigo-500/12", text: "text-indigo-800 dark:text-indigo-200", dot: "bg-indigo-500" },
  seguiment: { bg: "bg-amber-500/16", text: "text-amber-900 dark:text-amber-200", dot: "bg-amber-500" },
  recordatori: { bg: "bg-pink-500/12", text: "text-pink-800 dark:text-pink-200", dot: "bg-pink-500" },
  tasca: { bg: "bg-slate-500/14", text: "text-slate-800 dark:text-slate-200", dot: "bg-slate-500" },
  absencia: { bg: "bg-zinc-500/14", text: "text-zinc-700 dark:text-zinc-300", dot: "bg-zinc-400" },
};
export const PRIORITIES = ["baixa", "normal", "alta", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgent: "Urgent" };
export const STATUSES = ["programada", "confirmada", "feta", "cancellada", "no_presentat"] as const;
export type EventStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<EventStatus, string> = { programada: "Programada", confirmada: "Confirmada", feta: "Feta", cancellada: "Cancel·lada", no_presentat: "No presentat" };
export const REMINDER_PRESETS: { min: number; label: string }[] = [
  { min: 5, label: "5 minuts" }, { min: 15, label: "15 minuts" }, { min: 30, label: "30 minuts" }, { min: 60, label: "1 hora" }, { min: 1440, label: "1 dia" },
];
export const reminderLabel = (m: number) => REMINDER_PRESETS.find((p) => p.min === m)?.label ?? (m % 1440 === 0 ? `${m / 1440} dies` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);

export interface Recurrence { freq: "daily" | "weekly" | "monthly" | "yearly"; interval?: number; byweekday?: number[]; until?: string | null; count?: number | null }
export const FREQ_LABEL: Record<Recurrence["freq"], string> = { daily: "Cada dia", weekly: "Cada setmana", monthly: "Cada mes", yearly: "Cada any" };

/** Esdeveniment tal com el desa la base de dades (camps que necessita la lògica). */
export interface AgendaEventRow {
  id: string; owner_id: string; title: string; kind: EventKind; scope: "personal" | "compartida";
  starts_at: string; ends_at: string; all_day: boolean; status: EventStatus; priority: Priority;
  recurrence: Recurrence | null; exdates: string[] | null; reminders: number[] | null;
  participants?: { user_id: string; response: string }[];
}
export interface Occurrence { eventId: string; occurrenceId: string; start: string; end: string; recurring: boolean }

/* ======================================================================= zona horària */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(d: Date, tz = TZ) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); fmtCache.set(tz, f); }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(o.weekday) + 1;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd };
}
/** Desfasament (minuts) de la zona respecte UTC en aquell instant. */
export function tzOffsetMin(d: Date, tz = TZ) {
  const p = parts(d, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}
/** Data/hora local (Madrid) → instant UTC. Resol els canvis d'hora (l'hora inexistent avança). */
export function zonedToUtc(y: number, m: number, d: number, h = 0, mi = 0, tz = TZ): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let off = tzOffsetMin(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMin(new Date(t), tz);
  if (off2 !== off) { off = off2; t = guess - off * 60000; }
  return new Date(t);
}
/** Components locals (Madrid) d'un instant. `wd`: 1 = dilluns … 7 = diumenge. */
export const localParts = (iso: string | Date, tz = TZ) => parts(typeof iso === "string" ? new Date(iso) : iso, tz);
/** «YYYY-MM-DD» local d'un instant. */
export function localDate(iso: string | Date, tz = TZ) { const p = parts(typeof iso === "string" ? new Date(iso) : iso, tz); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; }
/** Inici del dia local (Madrid) en UTC. */
export function startOfLocalDay(date: string) { const [y, m, d] = date.split("-").map(Number); return zonedToUtc(y, m, d, 0, 0); }
export function addDaysLocal(date: string, n: number) { const [y, m, d] = date.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
/** Dilluns de la setmana (local) d'una data. */
export function mondayOf(date: string) { const [y, m, d] = date.split("-").map(Number); const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; return addDaysLocal(date, -wd); }

/* ======================================================================= recurrències */

const MAX_OCCURRENCES = 1000;
function addLocal(p: { y: number; m: number; d: number }, freq: Recurrence["freq"], n: number) {
  if (freq === "daily") { const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
  if (freq === "weekly") { const t = new Date(Date.UTC(p.y, p.m - 1, p.d + 7 * n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
  if (freq === "monthly") { const mm = p.m - 1 + n; const y = p.y + Math.floor(mm / 12); const m = (((mm % 12) + 12) % 12) + 1; return { y, m, d: p.d }; }
  return { y: p.y + n, m: p.m, d: p.d };
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Ocurrències d'un esdeveniment dins de [from, to). Les no recurrents retornen una sola ocurrència si s'hi solapa.
 * L'hora local es manté encara que canviï l'horari d'estiu/hivern. Els mesos sense aquell dia (31) se salten.
 */
export function expandEvent(e: Pick<AgendaEventRow, "id" | "starts_at" | "ends_at" | "recurrence" | "exdates">, from: Date, to: Date): Occurrence[] {
  const s0 = new Date(e.starts_at), e0 = new Date(e.ends_at);
  const dur = Math.max(0, e0.getTime() - s0.getTime());
  const one = (st: Date): Occurrence => ({ eventId: e.id, occurrenceId: e.recurrence ? `${e.id}@${st.toISOString()}` : e.id, start: st.toISOString(), end: new Date(st.getTime() + dur).toISOString(), recurring: !!e.recurrence });
  if (!e.recurrence) return s0 < to && new Date(s0.getTime() + Math.max(dur, 1)) > from ? [one(s0)] : [];
  const r = e.recurrence;
  const interval = Math.max(1, Math.min(365, Math.floor(r.interval ?? 1)));
  const until = r.until ? zonedToUtc(...(r.until.split("-").map(Number) as [number, number, number]), 23, 59) : null;
  const ex = new Set((e.exdates ?? []).map((x) => new Date(x).toISOString()));
  const lp = localParts(s0);
  const out: Occurrence[] = [];
  let produced = 0;
  const push = (y: number, m: number, d: number) => {
    const st = zonedToUtc(y, m, d, lp.h, lp.mi);
    if (st < s0) return true;
    if (until && st > until) return false;
    if (r.count && produced >= r.count) return false;
    produced++;
    if (st >= to) return false;
    if (new Date(st.getTime() + Math.max(dur, 1)) > from && !ex.has(st.toISOString())) out.push(one(st));
    return true;
  };
  // salt endavant (sense «count»): no cal recórrer anys d'ocurrències passades per mirar una setmana
  const periodDays = r.freq === "daily" ? 1 : r.freq === "weekly" ? 7 : r.freq === "monthly" ? 28 : 365;
  const i0 = r.count ? 0 : Math.max(0, Math.floor((from.getTime() - s0.getTime()) / (periodDays * interval * 86400000)) - 2);
  for (let i = i0; i < i0 + 5000 && out.length < MAX_OCCURRENCES; i++) {
    const base = addLocal(lp, r.freq, i * interval);
    if (r.freq === "weekly" && r.byweekday?.length) {
      // setmana que comença el dilluns de la data base
      const t = new Date(Date.UTC(base.y, base.m - 1, base.d));
      const mon = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000);
      let stop = false;
      for (const wd of [...new Set(r.byweekday)].filter((x) => x >= 1 && x <= 7).sort()) {
        const dd = new Date(mon.getTime() + (wd - 1) * 86400000);
        if (!push(dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate())) { stop = true; break; }
      }
      if (stop) break;
    } else {
      if ((r.freq === "monthly" || r.freq === "yearly") && base.d > daysInMonth(base.y, base.m)) continue;
      if (!push(base.y, base.m, base.d)) break;
    }
  }
  return out;
}

/** Descripció curta d'una recurrència en català. */
export function describeRecurrence(r: Recurrence | null | undefined) {
  if (!r) return "No es repeteix";
  const n = r.interval && r.interval > 1 ? r.interval : 1;
  const unit = { daily: ["dia", "dies"], weekly: ["setmana", "setmanes"], monthly: ["mes", "mesos"], yearly: ["any", "anys"] }[r.freq];
  const base = n === 1 ? FREQ_LABEL[r.freq] : `Cada ${n} ${unit[1]}`;
  const days = r.freq === "weekly" && r.byweekday?.length ? ` (${r.byweekday.map((d) => ["dl", "dt", "dc", "dj", "dv", "ds", "dg"][d - 1]).join(", ")})` : "";
  const end = r.until ? ` fins al ${r.until.split("-").reverse().join("/")}` : r.count ? `, ${r.count} vegades` : "";
  return `${base}${days}${end}`;
}

/* ======================================================================= coincidències i disponibilitat */

export interface Busy { userId: string; start: string; end: string; eventId?: string; title?: string | null; kind?: EventKind | "tasca"; private?: boolean }
export const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);

/** Coincidències d'un nou interval amb l'ocupació existent de cada persona (s'exclou l'esdeveniment que s'edita). */
export function findConflicts(slot: { start: string; end: string }, userIds: string[], busy: Busy[], excludeEventId?: string | null) {
  return busy.filter((b) => userIds.includes(b.userId) && b.eventId !== excludeEventId && b.eventId?.split("@")[0] !== excludeEventId && overlaps(slot, b));
}

export type AvailabilityState = "disponible" | "ocupat" | "sense_informacio";
/** Estat d'una persona per a una franja: ocupada, disponible (se'n coneix l'agenda) o sense informació. */
export function availabilityOf(userId: string, slot: { start: string; end: string }, busy: Busy[], known: Set<string>): AvailabilityState {
  if (busy.some((b) => b.userId === userId && overlaps(slot, b))) return "ocupat";
  return known.has(userId) ? "disponible" : "sense_informacio";
}

/** Horari laboral per proposar franges (hora local de Madrid). */
export const WORK_HOURS: [number, number][] = [[9, 14], [15, 19]];

/**
 * Proposa franges en què TOTS els participants estan lliures, en horari laboral (dl–dv), a partir de `fromIso`.
 * Retorna com a màxim `max` propostes; si algú no té informació d'agenda, la franja es marca com a «a confirmar».
 */
export function suggestSlots(opts: { userIds: string[]; busy: Busy[]; known: Set<string>; durationMin: number; fromIso: string; days?: number; stepMin?: number; max?: number }) {
  const { userIds, busy, known, durationMin } = opts;
  const step = opts.stepMin ?? 30, max = opts.max ?? 5, days = opts.days ?? 10;
  const now = new Date(opts.fromIso);
  const out: { start: string; end: string; uncertain: string[] }[] = [];
  let date = localDate(now);
  for (let k = 0; k < days * 2 && out.length < max; k++, date = addDaysLocal(date, 1)) {
    const [y, m, d] = date.split("-").map(Number);
    const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 + 1;
    if (wd > 5) continue;
    for (const [h0, h1] of WORK_HOURS) {
      for (let min = h0 * 60; min + durationMin <= h1 * 60 && out.length < max; min += step) {
        const st = zonedToUtc(y, m, d, Math.floor(min / 60), min % 60);
        if (st < now) continue;
        const slot = { start: st.toISOString(), end: new Date(st.getTime() + durationMin * 60000).toISOString() };
        if (userIds.some((u) => busy.some((b) => b.userId === u && overlaps(slot, b)))) continue;
        out.push({ ...slot, uncertain: userIds.filter((u) => !known.has(u)) });
      }
    }
  }
  return out;
}

/* ======================================================================= recordatoris */

export interface DueReminder { userId: string; eventId: string; occurrenceStart: string; minutes: number; ruleKey: string; title: string; kind: EventKind }
/**
 * Recordatoris que ja s'han d'enviar (hora de l'avís ≤ ara) d'ocurrències que encara no han començat
 * (o fa menys de `graceMin`). La clau `ruleKey` evita duplicats a crm_notifications (unique user_id+rule_key).
 */
export function dueReminders(events: (AgendaEventRow & { participants?: { user_id: string; response: string }[] })[], nowIso: string, graceMin = 5): DueReminder[] {
  const now = new Date(nowIso);
  const maxLead = 7 * 1440;
  const out: DueReminder[] = [];
  for (const e of events) {
    if (e.status === "cancellada" || e.status === "feta" || !e.reminders?.length) continue;
    const people = [e.owner_id, ...(e.participants ?? []).filter((p) => p.response !== "rebutja").map((p) => p.user_id)];
    const occ = expandEvent(e, new Date(now.getTime() - graceMin * 60000), new Date(now.getTime() + maxLead * 60000));
    for (const o of occ) {
      const st = new Date(o.start);
      if (st.getTime() < now.getTime() - graceMin * 60000) continue;
      for (const m of e.reminders) {
        if (!(m >= 0 && m <= maxLead)) continue;
        if (st.getTime() - m * 60000 > now.getTime()) continue;
        for (const u of [...new Set(people)]) out.push({ userId: u, eventId: e.id, occurrenceStart: o.start, minutes: m, ruleKey: `agenda:${e.id}:${o.start}:${m}`, title: e.title, kind: e.kind });
      }
    }
  }
  return out;
}

/** Text de l'avís: «Visita comercial d'aquí a 15 minuts · 10:30». */
export function reminderText(r: Pick<DueReminder, "kind" | "minutes" | "occurrenceStart" | "title">) {
  const hh = new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(r.occurrenceStart));
  const day = new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(r.occurrenceStart));
  return { title: `${KIND_LABEL[r.kind]}: ${r.title}`, body: r.minutes >= 1440 ? `${day} a les ${hh}` : `D'aquí a ${reminderLabel(r.minutes)} · ${hh}` };
}
