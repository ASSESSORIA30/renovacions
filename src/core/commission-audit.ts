/**
 * FASE 14 · AUDITOR DE COMISSIONS · CONCILIACIÓ DE DOBLE SENTIT (lògica pura, sense servidor).
 *
 * 1. Del CRM cap a la comercialitzadora: per a cada contracte amb dret a comissió (altes i renovacions) calcula què
 *    s'hauria d'haver liquidat i quan (activació + termini de pagament aprovat + ajornament contractual) i ho busca a
 *    les liquidacions importades: absent, inferior, liquidada fora de termini o correcta.
 * 2. De la comercialitzadora cap al CRM: cada línia rebuda es classifica (contracte desconegut, vinculació ambigua,
 *    duplicat, retrocomissió inesperada, regularització) reutilitzant el detector de la Fase 8.2.
 * 3. Control financer: cada comissió manté separats quatre imports i estats — PREVISTA, LIQUIDADA, COBRADA i
 *    RECLAMADA —. «Cobrada» només surt de cobraments reals registrats amb referència bancària (fin_ledger.cobrament,
 *    que la base de dades exigeix vinculat a un cobrament rebut); una línia d'Excel mai no compta com a cobrament.
 * 4. Set alertes diferenciades.
 * No s'ajusta mai cap import per fer-lo quadrar. Aritmètica decimal.
 */
import { D, money } from "./commissions";
import { detectDiscrepancies, eu, type ContractIn, type DetectInput, type DiscRow, type LineIn } from "./claims";

/* ======================================================================= alertes */

export const AUDIT_ALERTS = ["pendent_liquidar", "liquidada_inferior", "cobrada_parcial", "retro_inesperada", "liquidacio_duplicada", "sense_contracte", "cobrament_fora_termini"] as const;
export type AuditAlert = (typeof AUDIT_ALERTS)[number];
export const AUDIT_ALERT_LABEL: Record<AuditAlert, string> = {
  pendent_liquidar: "Comissió pendent de liquidar",
  liquidada_inferior: "Comissió liquidada per un import inferior",
  cobrada_parcial: "Comissió cobrada parcialment",
  retro_inesperada: "Retrocomissió inesperada",
  liquidacio_duplicada: "Liquidació duplicada",
  sense_contracte: "Comissió que no correspon a cap contracte",
  cobrament_fora_termini: "Contracte pendent de cobrament fora de termini",
};
/** Clau de l'automatització (crm_automation_rules, migració 025) de cada alerta. */
export const AUDIT_RULE_KEY: Record<AuditAlert, string> = Object.fromEntries(AUDIT_ALERTS.map((a) => [a, `audit_${a}`])) as Record<AuditAlert, string>;

/* ======================================================================= entrades */

export interface AuditContract extends ContractIn {
  is_renewal: boolean;
  deferred_until: string | null; deferral_reason: string | null;   // ajornament contractual de la liquidació
}
export interface AuditLine extends LineIn {
  movement: string | null; event_date: string | null; source_sheet: string | null; source_row: number | null; file_name: string | null;
  match_confidence: string | null; match_reason: string | null; candidates: number;
  collected: string;            // cobrat real (moviments «cobrament» del llibre vinculats a la línia)
  compensated: string;          // part d'una retrocessió compensada dins d'un cobrament net
}
export interface ClaimItemLite { item_key: string; contract_id: string | null; statement_line_id: string | null; claimed_amount: string; recovered_amount: string; status: string; active: boolean; claim_code: string; claim_status: string }
export interface AuditInput extends Omit<DetectInput, "lines" | "contracts"> {
  /** Línies de les liquidacions rebudes dins del període (detecció i alertes). */
  lines: AuditLine[];
  /** Totes les línies de la comercialitzadora (historial de cada comissió). Per defecte, `lines`. */
  allLines?: AuditLine[];
  contracts: AuditContract[];
  claimItems: ClaimItemLite[];
  /** Dies per defecte per esperar una liquidació quan la comercialitzadora no té termini aprovat (configurable a l'alerta). */
  defaultPaymentDays?: number;
  /** Dies després de rebre la liquidació per considerar el cobrament fora de termini. */
  collectDays?: number;
}

/* ======================================================================= sortides */

export type Situation = "correcta" | "pendent_liquidar" | "dins_termini" | "ajornada" | "inferior" | "superior" | "liquidada_tard" | "pendent_cobrament" | "cobrada" | "cobrada_parcial" | "cobrament_fora_termini" | "reclamada" | "sense_regla" | "retrocessio" | "anullada";
export const SITUATION_LABEL: Record<Situation, string> = {
  correcta: "Liquidada correctament", pendent_liquidar: "Pendent de liquidar (termini vençut)", dins_termini: "Encara dins del termini", ajornada: "Liquidació ajornada",
  inferior: "Liquidada per sota", superior: "Liquidada per sobre", liquidada_tard: "Liquidada fora de termini", pendent_cobrament: "Liquidada, pendent de cobrament",
  cobrada: "Cobrada", cobrada_parcial: "Cobrada parcialment", cobrament_fora_termini: "Cobrament fora de termini", reclamada: "Reclamada", sense_regla: "Sense condicions aprovades",
  retrocessio: "Amb retrocomissió", anullada: "Contracte anul·lat",
};
export interface CommissionState {
  key: string;                                   // contract:<id>
  contractId: string; clientId: string | null; client: string | null; cups: string | null; retailer: string; product: string | null;
  event: "alta" | "renovacio"; activated: string | null; dueDate: string | null; dueSource: "contracte" | "per_defecte" | null; deferredUntil: string | null;
  /** Els quatre estats, separats. */
  prevista: { amount: string | null; status: string | null; rule: string | null };
  liquidada: { amount: string; regularitzacions: string; first: string | null; last: string | null; lines: number; statements: string[] };
  cobrada: { amount: string; pending: string };
  reclamada: { amount: string; recovered: string; claims: string[] };
  difference: string | null;                     // liquidada − prevista (null si no hi ha prevista)
  situations: Situation[];
  alerts: AuditAlert[];
}
export interface OrphanLine { lineId: string; statementRef: string; received: string; cups: string | null; concept: string | null; amount: string; movement: string | null; source: string | null; status: string; alerts: AuditAlert[]; reason: string; candidates: number }
export interface AlertItem { type: AuditAlert; key: string; contractId: string | null; lineId: string | null; retailer: string; title: string; detail: string; amount: string; claimable: boolean; claimKey: string | null }
export interface AuditResult {
  commissions: CommissionState[]; lines: OrphanLine[]; alerts: AlertItem[]; discrepancies: DiscRow[];
  kpis: {
    prevista: string; liquidada: string; cobrada: string; reclamada: string; recuperada: string; pendentLiquidar: string; pendentCobrar: string;
    retrocomissions: string; diferencies: string; senseContracte: { count: number; amount: string }; claimable: string;
    counts: Record<AuditAlert, number>;
  };
}

/* ======================================================================= motor */

const addDays = (d: string, n: number) => { const x = new Date(`${d.slice(0, 10)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("ca-ES", { timeZone: "UTC" }) : "—");
const sum = (xs: (string | null | undefined)[]) => money(xs.reduce<ReturnType<typeof D>>((a, x) => a.plus(D(x ?? 0)), D(0)));
const LIVE = (s: string) => !["duplicat", "descartat"].includes(s);

export function auditCommissions(inp: AuditInput): AuditResult {
  const tol = D(inp.tolerance ?? "0.01");
  const defaultDays = inp.defaultPaymentDays ?? 90;
  const collectDays = inp.collectDays ?? 30;
  const every = inp.allLines ?? inp.lines;
  const settled = new Set(every.filter((l) => l.contract_id && l.kind === "comissio" && LIVE(l.match_status)).map((l) => l.contract_id!));
  for (const c of inp.settledContracts) settled.add(c);
  const discrepancies = detectDiscrepancies({ ...inp, lines: inp.lines, contracts: inp.contracts, settledContracts: settled });
  const discByKey = new Map(discrepancies.map((d) => [d.key, d]));
  const alerts: AlertItem[] = [];
  const push = (a: AlertItem) => { if (!alerts.some((x) => x.key === a.key)) alerts.push(a); };

  // ---- 1. del CRM cap a la comercialitzadora: una fila per contracte amb dret a comissió
  const commissions: CommissionState[] = [];
  for (const k of inp.contracts) {
    const act = k.activated_at?.slice(0, 10) ?? null;
    const mine = every.filter((l) => l.contract_id === k.id && LIVE(l.match_status));
    const positive = mine.filter((l) => l.kind === "comissio");
    const negative = mine.filter((l) => l.kind !== "comissio");
    const items = inp.claimItems.filter((i) => i.contract_id === k.id && i.status !== "retirada" && i.status !== "traspassada");
    const hasCalc = !!k.calc && (k.calc.status === "calculat" || k.calc.status === "simulacio") && k.calc.amount != null;
    if (!act && !positive.length && !hasCalc) continue;
    if (act && (act < inp.from || act > inp.to) && !mine.some((l) => l.received_at >= inp.from && l.received_at <= inp.to)) continue;
    const prevAmount = hasCalc ? money(k.calc!.amount!) : null;
    const liq = sum(positive.map((l) => l.amount));
    const reg = sum(negative.map((l) => l.amount));
    const cob = sum(mine.map((l) => l.collected));
    const pendingCollect = money(D(liq).minus(cob));
    const dates = positive.map((l) => l.received_at).sort();
    const days = inp.terms.paymentDays ?? defaultDays;
    const dueSource: CommissionState["dueSource"] = act ? (inp.terms.paymentDays != null ? "contracte" : "per_defecte") : null;
    const dueBase = act ? addDays(act, days) : null;
    const due = dueBase && k.deferred_until && k.deferred_until > dueBase ? k.deferred_until : dueBase;
    const situations: Situation[] = [];
    const al: AuditAlert[] = [];
    const cancelled = !!k.econ_status && k.econ_status !== "actiu";
    if (cancelled) situations.push("anullada");
    if (!prevAmount) situations.push("sense_regla");
    if (!positive.length) {
      if (k.deferred_until && k.deferred_until >= inp.today) situations.push("ajornada");
      else if (due && inp.today > due && !cancelled && ["actiu", "renovacio_pendent", "finalitzat"].includes(k.status)) {
        situations.push("pendent_liquidar"); al.push("pendent_liquidar");
        const d = discByKey.get(`pendent:${k.id}`);
        push({
          type: "pendent_liquidar", key: `pendent_liquidar:${k.id}`, contractId: k.id, lineId: null, retailer: inp.retailer,
          title: `${k.is_renewal ? "Renovació" : "Alta"} sense liquidar: ${k.client_name ?? k.cups ?? "contracte"}`,
          detail: `Activat el ${fmt(act)}; s'esperava a la liquidació abans del ${fmt(due)} (${dueSource === "contracte" ? `termini de pagament de ${days} dies` : `${days} dies per defecte: no hi ha termini aprovat`}${k.deferred_until ? `, ajornat fins al ${fmt(k.deferred_until)}` : ""}).${prevAmount ? ` Prevista: ${eu(prevAmount)}.` : " Sense import previst aprovat."}`,
          amount: prevAmount ?? "0.00", claimable: d?.selectable ?? false, claimKey: d?.selectable ? d.key : null,
        });
      } else if (act) situations.push("dins_termini");
    } else {
      // liquidada: import i termini
      if (prevAmount) {
        const diff = D(liq).minus(prevAmount);
        if (diff.abs().lte(tol)) situations.push("correcta");
        else if (diff.gt(0)) situations.push("superior");
        else {
          situations.push("inferior"); al.push("liquidada_inferior");
          const d = positive.map((l) => discByKey.get(`line:${l.id}`)).find((x) => x?.kind === "inferior");
          push({ type: "liquidada_inferior", key: `liquidada_inferior:${k.id}`, contractId: k.id, lineId: positive[0]?.id ?? null, retailer: inp.retailer, title: `Liquidada per sota: ${k.client_name ?? k.cups ?? "contracte"}`, detail: `Prevista ${eu(prevAmount)} · liquidada ${eu(liq)} · diferència ${eu(money(diff))}.${d && d.eligibility !== "reclamable" ? ` ${d.reason}` : ""}`, amount: money(diff.neg()), claimable: !!d?.selectable, claimKey: d?.selectable ? d.key : null });
        }
      }
      if (due && dates[0] && dates[0] > due) situations.push("liquidada_tard");
      // cobrament
      const conciliated = positive.filter((l) => l.match_status === "conciliat");
      const concAmount = sum(conciliated.map((l) => l.amount));
      if (D(cob).gt(0) && D(cob).plus(tol).lt(concAmount)) {
        situations.push("cobrada_parcial"); al.push("cobrada_parcial");
        push({ type: "cobrada_parcial", key: `cobrada_parcial:${k.id}`, contractId: k.id, lineId: conciliated[0]?.id ?? null, retailer: inp.retailer, title: `Cobrament parcial: ${k.client_name ?? k.cups ?? "contracte"}`, detail: `Liquidat ${eu(concAmount)} · cobrat ${eu(cob)} · pendent ${eu(money(D(concAmount).minus(cob)))}.`, amount: money(D(concAmount).minus(cob)), claimable: false, claimKey: null });
      } else if (D(cob).gt(0)) situations.push("cobrada");
      else if (D(liq).gt(0)) {
        const oldest = conciliated.map((l) => l.received_at).sort()[0] ?? null;
        if (oldest && addDays(oldest, collectDays) < inp.today) {
          situations.push("cobrament_fora_termini"); al.push("cobrament_fora_termini");
          push({ type: "cobrament_fora_termini", key: `cobrament_fora_termini:${k.id}`, contractId: k.id, lineId: conciliated[0]?.id ?? null, retailer: inp.retailer, title: `Liquidat i no cobrat: ${k.client_name ?? k.cups ?? "contracte"}`, detail: `La comercialitzadora el va liquidar el ${fmt(oldest)} (${eu(concAmount)}) i, ${collectDays} dies després, no consta cap cobrament bancari.`, amount: concAmount, claimable: false, claimKey: null });
        } else situations.push("pendent_cobrament");
      }
    }
    if (negative.some((l) => l.kind === "retrocessio")) situations.push("retrocessio");
    const claimed = sum(items.map((i) => i.claimed_amount));
    if (D(claimed).gt(0)) situations.push("reclamada");
    commissions.push({
      key: `contract:${k.id}`, contractId: k.id, clientId: k.client_id, client: k.client_name, cups: k.cups, retailer: k.retailer, product: k.product,
      event: k.is_renewal ? "renovacio" : "alta", activated: act, dueDate: due, dueSource, deferredUntil: k.deferred_until,
      prevista: { amount: prevAmount, status: k.calc?.status ?? null, rule: k.calc?.rule_key ? `${k.calc.rule_key} v${k.calc.rule_version ?? 1}` : null },
      liquidada: { amount: liq, regularitzacions: reg, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null, lines: mine.length, statements: [...new Set(mine.map((l) => l.reference))] },
      cobrada: { amount: cob, pending: D(pendingCollect).lt(0) ? "0.00" : pendingCollect },
      reclamada: { amount: claimed, recovered: sum(items.map((i) => i.recovered_amount)), claims: [...new Set(items.map((i) => i.claim_code))] },
      difference: prevAmount ? money(D(liq).minus(prevAmount)) : null, situations, alerts: al,
    });
  }

  // ---- 2. de la comercialitzadora cap al CRM: línies que no encaixen
  const lines: OrphanLine[] = [];
  for (const l of inp.lines) {
    if (l.received_at < inp.from || l.received_at > inp.to) continue;
    const src = l.source_sheet ? `${l.file_name ?? "document"} / ${l.source_sheet} / fila ${l.source_row}` : l.file_name;
    const base = { lineId: l.id, statementRef: l.reference, received: l.received_at, cups: l.cups, concept: l.concept, amount: money(l.amount), movement: l.movement, source: src, status: l.match_status, candidates: l.candidates };
    if (l.match_status === "duplicat") {
      lines.push({ ...base, alerts: ["liquidacio_duplicada"], reason: "La mateixa línia (CUPS, moviment, data i import) ja és en una altra liquidació." });
      push({ type: "liquidacio_duplicada", key: `liquidacio_duplicada:${l.id}`, contractId: l.contract_id, lineId: l.id, retailer: inp.retailer, title: `Liquidació duplicada: ${l.cups ?? l.external_ref ?? "línia"} (${eu(l.amount)})`, detail: `${l.reference}${src ? ` · ${src}` : ""}. No es comptabilitza dues vegades: revisa-la a Conciliació.`, amount: money(D(l.amount).abs()), claimable: false, claimKey: null });
      continue;
    }
    if (l.match_status === "descartat") continue;
    if (!l.contract_id) {
      const amb = l.candidates > 1;
      lines.push({ ...base, alerts: ["sense_contracte"], reason: amb ? `El CUPS coincideix amb ${l.candidates} contractes compatibles: cal triar-ne un (no s'assigna automàticament).` : l.match_reason ?? "Cap contracte del CRM no coincideix amb aquesta línia." });
      push({ type: "sense_contracte", key: `sense_contracte:${l.id}`, contractId: null, lineId: l.id, retailer: inp.retailer, title: `${amb ? "Vinculació ambigua" : "Sense contracte"}: ${l.cups ?? l.external_ref ?? "línia"} (${eu(l.amount)})`, detail: `${l.reference}${src ? ` · ${src}` : ""}. ${amb ? `${l.candidates} contractes possibles.` : l.match_reason ?? "No s'ha trobat cap contracte al CRM."}`, amount: money(D(l.amount).abs()), claimable: false, claimKey: null });
      continue;
    }
    const d = discByKey.get(`retro:${l.id}`);
    if (d && d.kind === "retrocessio" && d.eligibility !== "no_reclamable") {
      const neverPaid = !every.some((x) => x.contract_id === l.contract_id && x.kind === "comissio" && LIVE(x.match_status));
      lines.push({ ...base, alerts: ["retro_inesperada"], reason: d.reason + (neverPaid ? " A més, aquest contracte no té cap comissió liquidada." : "") });
      push({ type: "retro_inesperada", key: `retro_inesperada:${l.id}`, contractId: l.contract_id, lineId: l.id, retailer: inp.retailer, title: `Retrocomissió inesperada: ${d.client ?? l.cups ?? "contracte"} (${eu(l.amount)})`, detail: `${d.reason}${neverPaid ? " El contracte no té cap comissió liquidada que es pugui retrocedir." : ""}`, amount: money(D(l.amount).abs()), claimable: d.selectable, claimKey: d.selectable ? d.key : null });
    }
  }
  const counts = Object.fromEntries(AUDIT_ALERTS.map((a) => [a, alerts.filter((x) => x.type === a).length])) as Record<AuditAlert, number>;
  const retro = inp.lines.filter((l) => LIVE(l.match_status) && l.kind === "retrocessio" && l.received_at >= inp.from && l.received_at <= inp.to);
  const orphan = lines.filter((x) => x.alerts.includes("sense_contracte"));
  return {
    commissions, lines, alerts, discrepancies,
    kpis: {
      prevista: sum(commissions.map((c) => c.prevista.amount)),
      liquidada: sum(commissions.map((c) => c.liquidada.amount)),
      cobrada: sum(commissions.map((c) => c.cobrada.amount)),
      reclamada: sum(commissions.map((c) => c.reclamada.amount)),
      recuperada: sum(commissions.map((c) => c.reclamada.recovered)),
      pendentLiquidar: sum(alerts.filter((a) => a.type === "pendent_liquidar").map((a) => a.amount)),
      pendentCobrar: sum(commissions.map((c) => c.cobrada.pending)),
      retrocomissions: sum(retro.map((l) => l.amount)),
      diferencies: sum(alerts.filter((a) => a.type === "liquidada_inferior").map((a) => a.amount)),
      senseContracte: { count: orphan.length, amount: sum(orphan.map((x) => x.amount)) },
      claimable: sum(discrepancies.filter((d) => d.selectable).map((d) => d.claimable)),
      counts,
    },
  };
}

/**
 * Cobrament NET d'una liquidació (Fase 14): la comercialitzadora paga el net (comissions − retrocomissions).
 * Reparteix l'import rebut més les retrocomissions conciliades pendents de compensar entre les comissions
 * conciliades, per ordre. Mai no assigna més del que s'ha liquidat a cada línia i deixa sense assignar el que sobra.
 * (La base de dades fa el mateix càlcul a fin_register_receipt_net(); aquesta funció és la referència per a les proves.)
 */
export function allocateNetReceipt(receipt: string, lines: { id: string; amount: string; pending: string }[]): { cash: { id: string; amount: string }[]; compensation: { id: string; amount: string }[]; unallocated: string } {
  const negatives = lines.filter((l) => D(l.amount).lt(0) && D(l.pending).gt(0));
  let comp = negatives.reduce((a, l) => a.plus(l.pending), D(0));
  let cash = D(receipt);
  const outCash: { id: string; amount: string }[] = [], outComp: { id: string; amount: string }[] = [];
  for (const l of lines.filter((x) => D(x.amount).gt(0) && D(x.pending).gt(0))) {
    let need = D(l.pending);
    const c = need.lt(comp) ? need : comp;
    if (c.gt(0)) { outComp.push({ id: l.id, amount: money(c) }); comp = comp.minus(c); need = need.minus(c); }
    const k = need.lt(cash) ? need : cash;
    if (k.gt(0)) { outCash.push({ id: l.id, amount: money(k) }); cash = cash.minus(k); }
    if (cash.lte(0) && comp.lte(0)) break;
  }
  return { cash: outCash, compensation: outComp, unallocated: money(cash) };
}
