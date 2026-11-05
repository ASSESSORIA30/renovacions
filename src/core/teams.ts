/**
 * EQUIPS COMERCIALS · càlcul del panell del Cap d'equip (Fase 8.1). Funció pura (sense base de dades) i testejable.
 * Les dades d'entrada ja arriben filtrades per la RLS: només els comercials del seu equip.
 * Cap xifra s'estima: si falta una dada (consum, objectiu…), el valor és null i la interfície ho indica.
 */
export type TMember = { id: string; name: string };
export type TContract = { id: string; owner_id: string | null; status: string; signed_at: string | null; created_at: string; end_date: string | null; kwh: number | null };
export type TOpp = { owner_id: string | null; stage: string; won_at: string | null; lost_at: string | null; created_at: string; mwh: number | null; commission_eur?: number | null };
export type TTask = { id: string; title: string; assigned_to: string | null; status: string; due_at: string | null };
export type TTarget = { user_id: string; metric: "guanyades" | "mwh" | "comissio" | "oportunitats"; target: number };
export type TCommission = { beneficiary_id: string; kind: string; amount: number | string; period: string };

const OPEN_TASK = ["pendent", "en_curs", "bloquejada"];
const OPEN_STAGES_EXCL = ["guanyat", "perdut"];
const LIVE = (c: TContract) => !["esborrany", "anullat"].includes(c.status);
const day = (c: TContract) => (c.signed_at ?? c.created_at).slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;
const mwhOf = (cs: TContract[]) => r1(cs.reduce((s, c) => s + (c.kwh ?? 0), 0) / 1000);

export const TARGET_LABEL: Record<TTarget["metric"], string> = { guanyades: "Oportunitats guanyades", mwh: "MWh guanyats", comissio: "Comissió generada", oportunitats: "Oportunitats creades" };

/** Dies laborables (dl-dv) entre dues dates. */
export function workdaysBetween(fromIso: string, to: Date): number {
  const d = new Date(fromIso);
  if (Number.isNaN(d.getTime()) || d >= to) return 0;
  let n = 0;
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (c.getTime() < end) { c.setUTCDate(c.getUTCDate() + 1); const w = c.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export function teamDashboard(p: {
  now: Date; members: TMember[]; contracts: TContract[]; opps: TOpp[]; tasks: TTask[]; targets: TTarget[];
  lastActivity: Record<string, string | null>; commissions: TCommission[] | null; inactivityDays?: number;
}) {
  const month = p.now.toISOString().slice(0, 7);
  const today = p.now.toISOString().slice(0, 10);
  const in120 = new Date(p.now.getTime() + 120 * 86_400_000).toISOString().slice(0, 10);
  const limit = p.inactivityDays ?? 5;
  const ids = new Set(p.members.map((m) => m.id));
  // només comercials de l'equip (defensa en profunditat: la RLS ja ho limita)
  const C = p.contracts.filter((c) => c.owner_id && ids.has(c.owner_id));
  const O = p.opps.filter((o) => o.owner_id && ids.has(o.owner_id));
  const T = p.tasks.filter((t) => t.assigned_to && ids.has(t.assigned_to));
  const live = C.filter(LIVE);
  const inMonth = live.filter((c) => day(c).startsWith(month));
  const renewals = C.filter((c) => ["actiu", "renovacio_pendent"].includes(c.status) && c.end_date && c.end_date >= today && c.end_date <= in120);
  const openT = T.filter((t) => OPEN_TASK.includes(t.status));
  const overdue = openT.filter((t) => t.due_at && new Date(t.due_at) < p.now);
  const won = (xs: TOpp[]) => xs.filter((o) => o.stage === "guanyat" && o.won_at?.startsWith(month));
  const lost = (xs: TOpp[]) => xs.filter((o) => o.stage === "perdut" && o.lost_at?.startsWith(month));
  const conv = (xs: TOpp[]) => { const w = won(xs).length, l = lost(xs).length; return w + l ? Math.round((w / (w + l)) * 1000) / 10 : null; };
  const actual = (uid: string, metric: TTarget["metric"]) => {
    const mine = O.filter((o) => o.owner_id === uid);
    if (metric === "guanyades") return won(mine).length;
    if (metric === "mwh") return r1(won(mine).reduce((s, o) => s + (o.mwh ?? 0), 0));
    if (metric === "oportunitats") return mine.filter((o) => o.created_at.startsWith(month)).length;
    return p.commissions ? Math.round(won(mine).reduce((s, o) => s + (o.commission_eur ?? 0), 0) * 100) / 100 : null;
  };
  const commissionOf = (uid: string) => (p.commissions ? Math.round(p.commissions.filter((c) => c.beneficiary_id === uid && c.period.startsWith(month)).reduce((s, c) => s + Number(c.amount), 0) * 100) / 100 : null);

  const perMember = p.members.map((m) => {
    const mc = inMonth.filter((c) => c.owner_id === m.id);
    const mo = O.filter((o) => o.owner_id === m.id);
    const objectives = p.targets.filter((t) => t.user_id === m.id && (t.metric !== "comissio" || p.commissions)).map((t) => {
      const a = actual(m.id, t.metric);
      return { metric: t.metric, label: TARGET_LABEL[t.metric], target: t.target, actual: a, pct: a == null || !t.target ? null : Math.round((a / t.target) * 1000) / 10, reached: a != null && a >= t.target };
    });
    const last = p.lastActivity[m.id] ?? null;
    const idle = last ? workdaysBetween(last, p.now) : null;
    return {
      id: m.id, name: m.name,
      contractesMes: mc.length, mwhMes: mwhOf(mc), senseConsum: mc.filter((c) => c.kwh == null).length,
      conversio: conv(mo), oportunitatsObertes: mo.filter((o) => !OPEN_STAGES_EXCL.includes(o.stage)).length,
      renovacions: renewals.filter((c) => c.owner_id === m.id).length,
      tasquesVencudes: overdue.filter((t) => t.assigned_to === m.id).length,
      objectives, lastActivity: last, inactiu: last == null || (idle ?? 0) >= limit, diesSenseActivitat: idle,
      comissio: commissionOf(m.id),
    };
  });

  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(p.now.getUTCFullYear(), p.now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const series = months.map((mm) => {
    const cs = live.filter((c) => day(c).startsWith(mm));
    return { month: mm, contractes: cs.length, mwh: mwhOf(cs), guanyades: O.filter((o) => o.stage === "guanyat" && o.won_at?.startsWith(mm)).length };
  });
  const allObj = perMember.flatMap((m) => m.objectives);
  return {
    month,
    kpis: {
      contractesMes: inMonth.length, mwhMes: mwhOf(inMonth), contractesSenseConsum: inMonth.filter((c) => c.kwh == null).length,
      conversio: conv(O), oportunitatsObertes: O.filter((o) => !OPEN_STAGES_EXCL.includes(o.stage)).length,
      renovacionsPendents: renewals.length, tasquesVencudes: overdue.length,
      objectius: { assolits: allObj.filter((o) => o.reached).length, total: allObj.length },
      comissionsAutoritzades: p.commissions ? Math.round(p.commissions.filter((c) => c.period.startsWith(month)).reduce((s, c) => s + Number(c.amount), 0) * 100) / 100 : null,
      comercialsInactius: perMember.filter((m) => m.inactiu).length,
    },
    perMember, series,
    alerts: [
      ...perMember.filter((m) => m.inactiu).map((m) => ({ kind: "inactivitat" as const, userId: m.id, text: m.lastActivity ? `${m.name}: ${m.diesSenseActivitat} dies laborables sense activitat registrada` : `${m.name}: cap activitat registrada` })),
      ...overdue.slice(0, 50).map((t) => ({ kind: "tasca_vencuda" as const, userId: t.assigned_to!, taskId: t.id, text: `${p.members.find((m) => m.id === t.assigned_to)?.name ?? "—"}: «${t.title}» vençuda` })),
    ],
    overdueTasks: overdue.sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? "")).slice(0, 50),
  };
}
