/**
 * XAT DEL LECTOR DE TARIFES «OPEN» · part pura (sense IA, testejable).
 *  - Explica d'on surt el preu d'un període: hores Open / No Open, percentatges, preus originals, fórmula i resultat.
 *  - Entén correccions d'horari escrites en català o castellà («Noche és de 0 a 8 tots els dies», «Día: de 8 a 24
 *    de dilluns a divendres i de 18 a 24 els caps de setmana») i les converteix en una PROPOSTA de regla.
 *    La proposta mai s'aplica sola: l'usuari la recalcula, la revisa i Direcció l'aprova.
 * El servidor pot afegir-hi la IA (si està configurada) per a preguntes obertes, però sempre amb aquest context.
 */
import { DAY_LABEL, MODALITIES, MODALITY_LABEL, describeRule, type DayClass, type Modality, type OpenRule, type Period, type Window } from "./open-calendar";

export interface OpenChatContext {
  tariff: string;
  modality: Modality;
  bracketLabel: string;
  openPrice: number;
  noOpenPrice: number;
  rule: OpenRule;
  documentRule: OpenRule | null;
  reference: { from: string; to: string };
  periods: { period: number; open: number; noOpen: number; total: number; price: number }[];
  discrepancies: { period: number; internalOpen: number; documentOpen: number; diffHours: number; internalPrice: number; documentPrice: number }[];
}
export interface ChatProposal { modality: Modality; rule: OpenRule; summary: string }
export interface ChatAnswer { text: string; proposal: ChatProposal | null; engine: "local" | "ia" }

const f6 = (n: number) => n.toLocaleString("ca-ES", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const pct = (a: number, t: number) => (t ? ((a * 100) / t).toLocaleString("ca-ES", { maximumFractionDigits: 2 }) : "0");

const MOD_WORDS: [Modality, RegExp][] = [
  ["plana", /\bplana\b/i],
  ["cap_de_setmana", /fin(?:es)?\s+de\s+semana|cap(?:s)?\s+de\s+setmana/i],
  ["laboral", /\blaboral\b/i],
  ["nit", /\bnoche\b|\bnit\b/i],
  ["dia", /\bd[ií]a\b|\bdia\b/i],
];
/** Modalitat esmentada (la que apareix primer al text: «La Noche és … els caps de setmana» → Noche). */
export function modalityIn(text: string): Modality | null {
  let best: { m: Modality; i: number } | null = null;
  for (const [m, re] of MOD_WORDS) {
    const i = text.search(re);
    if (i >= 0 && (!best || i < best.i)) best = { m, i };
  }
  return best?.m ?? null;
}

/** Explicació detallada del preu d'un període. */
export function explainPeriod(ctx: OpenChatContext, period: number): string {
  const p = ctx.periods.find((x) => x.period === period);
  if (!p) return `No tinc dades del període P${period}.`;
  const name = `${MODALITY_LABEL[ctx.modality]} (${ctx.tariff}, tram ${ctx.bracketLabel})`;
  if (ctx.rule.mode === "plana") return `A la modalitat ${name} el preu és el mateix les 24 hores: P${period} = ${f6(ctx.openPrice)} €/kWh. No cal ponderació.`;
  const lines = [
    `P${period} de ${name}, període de referència ${ctx.reference.from} – ${ctx.reference.to}:`,
    `• Hores Open: ${p.open} h (${pct(p.open, p.total)} %) · Hores No Open: ${p.noOpen} h (${pct(p.noOpen, p.total)} %) · Total: ${p.total} h.`,
    `• Preus originals del document: Open ${f6(ctx.openPrice)} €/kWh · No Open ${f6(ctx.noOpenPrice)} €/kWh.`,
    `• Fórmula: (${p.open} × ${f6(ctx.openPrice)} + ${p.noOpen} × ${f6(ctx.noOpenPrice)}) / ${p.total}`,
    `• Resultat: ${f6(p.price)} €/kWh (preu estimat per ponderació horària, no el cost real del client).`,
    `• Regla aplicada: ${describeRule(ctx.rule)}.`,
  ];
  if (ctx.rule.mode === "periodes") lines.splice(1, 0, `Aquesta modalitat fa servir la regla de conversió per períodes de Direcció: P${period} va sencer al preu ${ctx.rule.openPeriods.includes(period as Period) ? "Open" : "No Open"}.`);
  const d = ctx.discrepancies.find((x) => x.period === period);
  if (d) lines.push(`• Atenció: segons l'horari del document, P${period} tindria ${d.documentOpen} h Open (${d.diffHours > 0 ? "+" : ""}${d.diffHours} h de diferència) i el preu seria ${f6(d.documentPrice)} €/kWh. Cal que Direcció validi quina regla s'aplica.`);
  return lines.join("\n");
}

/* ----------------------------------------------------------------------- correccions d'horari */

function dayClassOf(t: string): DayClass | null {
  const s = t.toLowerCase();
  if (/(tots|todos)\s+els?\s*(dies|d[ií]as)|todos los d[ií]as|cada dia|365/.test(s)) return "tots";
  if (/(excepte|excepto|sense|sin)\s+(els\s+)?festius?|laborables?/.test(s)) return "laborable";
  if (/(dissabte|s[áa]bado|diumenge|domingo|caps?\s+de\s+setmana|fin(es)?\s+de\s+semana|festius?|festivos?)/.test(s)) return "festiu";
  if (/(dilluns|lunes)\s+a\s+(divendres|viernes)|dl-dv|l-v/.test(s)) return "dl_dv";
  return null;
}

/** Converteix una frase de correcció en una regla (null si no s'entén prou bé per proposar res). */
export function parseCorrection(message: string, current: Modality | null = null): ChatProposal | null {
  const modality = modalityIn(message) ?? current;
  if (!modality || modality === "plana") return null;
  // per períodes: «Laboral: P1 a P5 Open» / «P6 Open»
  const pm = message.match(/P([1-6])\s*(?:a|-|–|fins a)\s*P([1-6])\s*(?:al preu\s*)?open/i) ?? message.match(/((?:P[1-6][,\s]*(?:i|y)?\s*)+)\s*(?:al preu\s*)?open/i);
  if (pm && /period/i.test(message) === false && /P[1-6]/i.test(message) && !/\d{1,2}\s*h?\s*(?:a|-|fins)\s*\d{1,2}\s*h/i.test(message)) {
    let list: Period[] = [];
    if (pm[2]) { const a = Number(pm[1]), b = Number(pm[2]); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) list.push(i as Period); }
    else list = [...pm[1].matchAll(/P([1-6])/gi)].map((x) => Number(x[1]) as Period);
    if (list.length) { const rule: OpenRule = { mode: "periodes", openPeriods: [...new Set(list)].sort() }; return { modality, rule, summary: `${MODALITY_LABEL[modality]}: ${describeRule(rule)}` }; }
  }
  // per franges: «de 0 a 8 de dilluns a divendres i de 0 a 18 els caps de setmana»
  const windows: Window[] = [];
  const parts = message.split(/;|\s+(?:i|y)\s+(?=(?:de\s+)?\d{1,2}\s*(?:h|:00)?\s*(?:a|-|fins))/i);
  for (const part of parts) {
    const m = part.match(/(\d{1,2})\s*(?:h|:00)?\s*(?:a|-|–|fins a|fins les)\s*(\d{1,2})\s*(?:h|:00)?/i);
    if (!m) continue;
    const from = Number(m[1]), to = Number(m[2]) === 0 ? 24 : Number(m[2]);
    if (!(from >= 0 && from < to && to <= 24)) return null;
    const days = dayClassOf(part.slice((m.index ?? 0) + m[0].length)) ?? dayClassOf(part) ?? "tots";
    windows.push({ days, from, to });
  }
  if (!windows.length) return null;
  const rule: OpenRule = { mode: "horari", windows };
  return { modality, rule, summary: `${MODALITY_LABEL[modality]}: ${describeRule(rule)}` };
}

/** Resposta local (sense IA): explicació d'un període, resum de discrepàncies o proposta de correcció. */
export function localAnswer(message: string, ctx: OpenChatContext): ChatAnswer {
  const t = message.trim();
  const proposal = /(és|es|son|són|serà|corregeix|corrige|canvia|cambia|hauria|debería|en realitat|realment)/i.test(t) || /open/i.test(t) ? parseCorrection(t, modalityIn(t) ?? ctx.modality) : null;
  if (proposal && (proposal.modality !== ctx.modality || JSON.stringify(proposal.rule) !== JSON.stringify(ctx.rule))) {
    return { engine: "local", proposal, text: `He entès aquesta correcció:\n${proposal.summary}.\nSi vols, la recalculo als sis períodes perquè ho comprovis. Després la pots desar a la biblioteca de regles (la valida Direcció).` };
  }
  const per = t.match(/P\s*([1-6])/i);
  if (per) {
    const mod = modalityIn(t);
    const note = mod && mod !== ctx.modality ? `(Ara tens seleccionada la modalitat ${MODALITY_LABEL[ctx.modality]}; selecciona ${MODALITY_LABEL[mod]} per veure'n el detall.)\n` : "";
    return { engine: "local", proposal: null, text: note + explainPeriod(ctx, Number(per[1])) };
  }
  if (/discrep|difer|document|horari|horario/i.test(t)) {
    if (!ctx.discrepancies.length) return { engine: "local", proposal: null, text: `La regla aplicada a ${MODALITY_LABEL[ctx.modality]} coincideix amb l'horari del document: no hi ha discrepàncies.` };
    return { engine: "local", proposal: null, text: [`Discrepàncies de ${MODALITY_LABEL[ctx.modality]} entre la regla interna i el document:`, `• Regla interna: ${describeRule(ctx.rule)}`, `• Document: ${ctx.documentRule ? describeRule(ctx.documentRule) : "no s'ha pogut llegir"}`, ...ctx.discrepancies.map((d) => `• P${d.period}: ${d.internalOpen} h Open (intern) vs ${d.documentOpen} h (document) → ${f6(d.internalPrice)} vs ${f6(d.documentPrice)} €/kWh`)].join("\n") };
  }
  return { engine: "local", proposal: null, text: `Puc explicar-te el preu de qualsevol període (per exemple «Per què el P6 de ${MODALITY_LABEL[ctx.modality]} té aquest preu?»), mostrar les discrepàncies amb el document o entendre una correcció d'horari (per exemple «Noche és de 0 a 8 de dilluns a divendres i de 0 a 18 els caps de setmana»).` };
}

export const DAY_CLASS_TEXT = DAY_LABEL;
export const ALL_MODALITIES = MODALITIES;
