import { daysUntil, fmtDate, today, relDays } from "./dates";
import { consumption, lastContactDays, type Priority } from "./priority";
import type { Activity, Contract, Offer, ProposalDoc, Settings, Task } from "./types";

export type BadgeTone = "red" | "orange" | "amber" | "blue" | "green" | "zinc" | "violet";
export interface Badge { key: string; label: string; tone: BadgeTone }

export function expiry(c: Contract) {
  return c.crm.nuevaFechaVencimiento ?? c.vencimiento;
}

export function badges(c: Contract, tasks: Task[], s: Settings, ref = today()): Badge[] {
  const out: Badge[] = [];
  const d = daysUntil(expiry(c), ref);
  const open = c.crm.status === "pendiente" || c.crm.status === "contactado";
  if (open && d !== null) {
    if (d >= 0 && d <= 7) out.push({ key: "urgente", label: "Renovació urgent", tone: "red" });
  }
  if (c.crm.status === "pendiente" && !c.crm.ultimoContacto) out.push({ key: "sin_contactar", label: "Sense contactar", tone: "orange" });
  if (c.crm.status === "contactado" && c.crm.propuestaEnviada) {
    const lc = lastContactDays(c, ref) ?? 0;
    out.push(lc >= s.seguimientoDias ? { key: "esperando", label: "Esperant resposta", tone: "amber" } : { key: "propuesta", label: "Proposta enviada", tone: "blue" });
  }
  if (tasks.some((t) => t.contractId === c.id && !t.done && t.due < ref)) out.push({ key: "atrasado", label: "Seguiment endarrerit", tone: "violet" });
  if (c.fechaInicioFuente === "importacion_crm") out.push({ key: "fecha_estimada", label: "Data per revisar", tone: "zinc" });
  return out;
}

/**
 * Deterministic analysis built only from stored facts. It is ALWAYS available (no AI key required)
 * and is also the factual context passed to the AI provider.
 */
export function ruleAnalysis(c: Contract, p: Priority, acts: Activity[], tasks: Task[], docs: ProposalDoc[], offers: Offer[], ref = today()) {
  const d = daysUntil(expiry(c), ref);
  const kwh = consumption(c);
  const lc = lastContactDays(c, ref);
  const contacts = acts.filter((a) => ["whatsapp", "email", "call"].includes(a.type));
  const applicable = offers.filter((o) => o.verificada && o.validaHasta >= ref && sameTariff(o.tarifa, c.tarifa));
  const facts: string[] = [];
  facts.push(d === null ? "No hi ha data de venciment registrada." : `${relDays(d)} (${fmtDate(expiry(c))}).`);
  if (c.fechaInicioFuente === "importacion_crm") facts.push("La data d'inici ve de la importació del CRM: cal confirmar-la.");
  if (c.renovacionTacita) facts.push(`El contracte ja va superar un venciment (${fmtDate(c.vencimientoOriginal)}) i es considera renovat tàcitament.`);
  facts.push(
    kwh ? `Consum anual registrat: ${Math.round(kwh).toLocaleString("ca-ES")} kWh${c.tarifa ? ` · tarifa ${c.tarifa}` : ""}.` : `Sense consum anual registrat${c.tarifa ? ` · tarifa ${c.tarifa}` : ""}.`
  );
  if (c.comercializadora) facts.push(`Comercialitzadora actual: ${c.comercializadora}${c.precioContratado ? ` (${c.precioContratado})` : ""}.`);
  facts.push(contacts.length ? `${contacts.length} comunicació(ns) registrades; l'última fa ${lc ?? "?"} dies.` : "Cap comunicació registrada al CRM.");
  if (c.comentarioLlamada) facts.push(`Nota de trucada a l'origen: «${c.comentarioLlamada}».`);
  facts.push(docs.length ? `${docs.length} proposta(es) PDF generada(es).` : "Encara no s'ha generat cap proposta.");
  facts.push(applicable.length ? `${applicable.length} oferta(es) disponible(s) per a la seva tarifa.` : "No hi ha ofertes disponibles per a la seva tarifa.");

  const riskF = p.factors.find((f) => f.key === "riesgo");
  const risk = p.level === "cerrado" ? "—" : (riskF?.value ?? 0) >= 0.5 ? "Alt" : (riskF?.value ?? 0) >= 0.25 ? "Mitjà" : "Baix";

  let next = "Sense acció pendent.";
  if (c.crm.status === "pendiente") {
    if (!c.telefono && !c.email) next = "Completar les dades de contacte abans de gestionar.";
    else if (d !== null && d <= 15) next = applicable.length ? "Contactar avui i enviar una proposta personalitzada." : "Contactar avui; cal registrar una oferta per poder preparar la proposta.";
    else if (d !== null && d <= 60) next = "Programar el primer contacte aquesta setmana i preparar la proposta.";
    else next = "Sense urgència: planificar el contacte quan faltin 60 dies.";
  } else if (c.crm.status === "contactado") {
    const overdue = tasks.some((t) => t.contractId === c.id && !t.done && t.due < ref);
    next = overdue ? "Hi ha un seguiment endarrerit: trucar avui." : c.crm.propuestaEnviada ? "Fer el seguiment de la proposta enviada." : "Enviar la proposta de renovació.";
  }
  const summary =
    c.crm.status === "renovado" ? "Contracte renovat." :
    c.crm.status === "no_renueva" ? `Client perdut${c.crm.motivoRechazo ? `: ${c.crm.motivoRechazo}` : ""}.` :
    `${d !== null ? relDays(d) : "Sense data"}, ${kwh ? (kwh >= 15000 ? "consum elevat" : kwh >= 5000 ? "consum mitjà" : "consum baix") : "consum desconegut"}, ${contacts.length ? "ja contactat" : "sense contactar"} i ${docs.length ? "amb proposta generada" : "sense proposta"}. ${next}`;
  return { summary, facts, risk, next, applicableOffers: applicable };
}

export function sameTariff(a?: string | null, b?: string | null) {
  const n = (s?: string | null) => (s ?? "").toUpperCase().replace(/[^0-9A-Z.]/g, "").replace("TARIFA", "");
  return !!a && !!b && n(a) === n(b);
}
