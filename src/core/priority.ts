import { daysUntil, daysBetween, today } from "./dates";
import type { Contract, PriorityWeights, Task } from "./types";

export const DEFAULT_WEIGHTS: PriorityWeights = {
  proximidad: 30,
  consumo: 15,
  valor: 10,
  sinContacto: 15,
  estado: 10,
  seguimientos: 10,
  riesgo: 10,
};

export const WEIGHT_LABELS: Record<keyof PriorityWeights, string> = {
  proximidad: "Proximitat del venciment",
  consumo: "Consum anual",
  valor: "Valor comercial (tarifa)",
  sinContacto: "Dies sense contacte",
  estado: "Estat de la negociació",
  seguimientos: "Seguiments pendents",
  riesgo: "Risc de pèrdua",
};

export type PriorityLevel = "critica" | "alta" | "media" | "baja" | "cerrado";

export interface PriorityFactor {
  key: keyof PriorityWeights;
  label: string;
  value: number; // 0..1
  points: number; // contribution to the 0..100 score
  reason: string;
}

export interface Priority {
  score: number;
  level: PriorityLevel;
  factors: PriorityFactor[];
}

export const LEVEL_META: Record<PriorityLevel, { label: string; hint: string; cls: string }> = {
  critica: { label: "Crítica", hint: "Acció immediata", cls: "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/25" },
  alta: { label: "Alta", hint: "Gestionar prioritàriament", cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-orange-500/25" },
  media: { label: "Mitjana", hint: "Seguiment normal", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/25" },
  baja: { label: "Baixa", hint: "Sense urgència immediata", cls: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 ring-zinc-500/20" },
  cerrado: { label: "Tancat", hint: "Sense acció", cls: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/15" },
};

function proximity(d: number | null): [number, string] {
  if (d === null) return [0.2, "Sense data de venciment"];
  if (d < 0) return [1, `Vençut fa ${-d} dies`];
  if (d <= 7) return [0.95, `Venç en ${d} dies`];
  if (d <= 15) return [0.85, `Venç en ${d} dies`];
  if (d <= 30) return [0.7, `Venç en ${d} dies`];
  if (d <= 60) return [0.45, `Venç en ${d} dies`];
  if (d <= 90) return [0.25, `Venç en ${d} dies`];
  return [0.05, `Venç en ${d} dies`];
}

export function consumption(c: Contract): number | null {
  return c.crm.consumoOverride ?? c.consumoAnual ?? null;
}

function consumoFactor(kwh: number | null): [number, string] {
  if (kwh === null) return [0.3, "Consum desconegut"];
  const f = kwh < 2000 ? 0.2 : kwh < 5000 ? 0.4 : kwh < 15000 ? 0.6 : kwh < 50000 ? 0.8 : 1;
  return [f, `${Math.round(kwh).toLocaleString("es-ES")} kWh/any`];
}

function valorFactor(c: Contract): [number, string] {
  const t = (c.tarifa ?? "").toUpperCase();
  if (t.includes("6.1")) return [1, "Tarifa 6.1TD (alta tensió)"];
  if (t.includes("3.0")) return [0.7, "Tarifa 3.0TD (empresa)"];
  if (/RL[3-6]/.test(t)) return [0.6, `Gas ${t}`];
  if (t.includes("2.0")) return [0.4, "Tarifa 2.0TD"];
  if (/RL[12]/.test(t)) return [0.35, `Gas ${t}`];
  if (c.tipo === "telefonia") return [0.2, "Telefonia"];
  return [0.3, t || "Tarifa no indicada"];
}

export function lastContactDays(c: Contract, ref = today()): number | null {
  return c.crm.ultimoContacto ? daysBetween(c.crm.ultimoContacto.slice(0, 10), ref) : null;
}

export function computePriority(c: Contract, tasks: Task[], w: PriorityWeights, ref = today()): Priority {
  if (c.crm.status === "renovado" || c.crm.status === "no_renueva") return { score: 0, level: "cerrado", factors: [] };
  const d = daysUntil(c.crm.nuevaFechaVencimiento ?? c.vencimiento, ref);
  const [fp, rp] = proximity(d);
  const [fc, rc] = consumoFactor(consumption(c));
  const [fv, rv] = valorFactor(c);
  const lc = lastContactDays(c, ref);
  const [fs, rs]: [number, string] =
    lc === null ? [d !== null && d <= 60 ? 1 : 0.6, "Mai contactat des del CRM"] : [Math.min(1, lc / 30), `Últim contacte fa ${lc} dies`];
  const sentNoReply = c.crm.propuestaEnviada && c.crm.status === "contactado";
  const [fe, re]: [number, string] =
    c.crm.status === "pendiente" ? [1, "Pendent de gestionar"] : sentNoReply ? [0.8, "Proposta enviada sense resposta"] : [0.6, "Contactat"];
  const own = tasks.filter((t) => t.contractId === c.id && !t.done);
  const overdue = own.filter((t) => t.due < ref).length;
  const [ft, rt]: [number, string] = overdue ? [1, `${overdue} seguiment(s) endarrerit(s)`] : own.length ? [0.5, `${own.length} seguiment(s) pendent(s)`] : [0, "Sense seguiments oberts"];
  // risk: close to expiry without contact, tacit renewals, negative call notes
  const neg = /no (cambiar|vol|quiere|interes)|baja|queja|enfadad|caro/i.test(`${c.comentarioLlamada ?? ""} ${c.observaciones ?? ""}`);
  let fr = 0;
  const rr: string[] = [];
  if (d !== null && d <= 30 && lc === null) { fr += 0.5; rr.push("venç aviat sense contacte"); }
  if (overdue) { fr += 0.25; rr.push("seguiment endarrerit"); }
  if (neg) { fr += 0.25; rr.push("notes amb objeccions"); }
  if (c.renovacionTacita) { fr += 0.1; rr.push("renovació tàcita prèvia"); }
  fr = Math.min(1, fr);

  const raw: [keyof PriorityWeights, number, string][] = [
    ["proximidad", fp, rp], ["consumo", fc, rc], ["valor", fv, rv], ["sinContacto", fs, rs], ["estado", fe, re], ["seguimientos", ft, rt],
    ["riesgo", fr, rr.length ? rr.join(", ") : "Sense senyals de risc"],
  ];
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const factors = raw.map(([key, value, reason]) => ({ key, label: WEIGHT_LABELS[key], value, reason, points: (w[key] / total) * value * 100 }));
  const score = Math.round(factors.reduce((a, f) => a + f.points, 0));
  const level: PriorityLevel = score >= 75 ? "critica" : score >= 55 ? "alta" : score >= 35 ? "media" : "baja";
  return { score, level, factors: factors.sort((a, b) => b.points - a.points) };
}
