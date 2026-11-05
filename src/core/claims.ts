/**
 * FASE 8.2 · RECLAMACIONS A COMERCIALITZADORES (lògica pura, sense servidor).
 *
 * 1. detectDiscrepancies: compara el que ha liquidat una comercialitzadora amb el que diuen les regles APROVADES
 *    i classifica cada cas en: correcte · liquidat per sota · liquidat per sobre · pendent de liquidació ·
 *    retrocessió a revisar · duplicat · no identificat · sense regla aprovada.
 *    Només és «reclamable» el que es pot demostrar: regla aprovada, import calculat, termini de pagament vençut,
 *    contracte vigent i cap excepció contractual pendent. La resta queda «a revisar» o «no reclamable».
 * 2. explainDiscrepancy: hipòtesis (MAI fets) sobre el motiu de cada diferència, amb les referències documentals.
 *    Si no hi ha prou informació: «Motiu pendent de revisió».
 * 3. matchRegularizations: en arribar una liquidació nova, proposa quines línies poden ser regularitzacions
 *    de reclamacions obertes (sempre amb revisió humana).
 * 4. Correu de reclamació (esborrany editable).
 * Imports amb aritmètica decimal (mai coma flotant).
 */
import { D, money } from "./commissions";
import { clawbackFor, fullMonths, type ClawRule } from "./retailers";

/* ======================================================================= estats */

export const CLAIM_STATUSES = ["esborrany", "pendent_enviament", "enviada", "pendent_resposta", "en_revisio", "acceptada_total", "acceptada_parcial", "rebutjada", "resolta"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  esborrany: "Esborrany", pendent_enviament: "Pendent d'enviament", enviada: "Enviada", pendent_resposta: "Pendent de resposta", en_revisio: "En revisió",
  acceptada_total: "Acceptada totalment", acceptada_parcial: "Acceptada parcialment", rebutjada: "Rebutjada", resolta: "Resolta",
};
/** Mateixes transicions que el disparador fin_claim_before() de la migració 018. */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  esborrany: ["pendent_enviament", "enviada"],
  pendent_enviament: ["esborrany", "enviada"],
  enviada: ["pendent_resposta", "en_revisio", "acceptada_total", "acceptada_parcial", "rebutjada"],
  pendent_resposta: ["en_revisio", "acceptada_total", "acceptada_parcial", "rebutjada"],
  en_revisio: ["pendent_resposta", "acceptada_total", "acceptada_parcial", "rebutjada"],
  acceptada_total: ["resolta", "en_revisio"],
  acceptada_parcial: ["resolta", "en_revisio"],
  rebutjada: ["resolta", "en_revisio"],
  resolta: [],
};
export const OPEN_CLAIM: ClaimStatus[] = ["esborrany", "pendent_enviament", "enviada", "pendent_resposta", "en_revisio", "acceptada_total", "acceptada_parcial"];
export const AWAITING: ClaimStatus[] = ["enviada", "pendent_resposta", "en_revisio"];
export const canTransition = (from: ClaimStatus, to: ClaimStatus) => CLAIM_TRANSITIONS[from]?.includes(to) ?? false;

/* ======================================================================= tipus d'entrada */

export type DiscKind = "correcte" | "inferior" | "superior" | "pendent_liquidacio" | "retrocessio" | "duplicat" | "no_identificat" | "sense_regla";
export const DISC_LABEL: Record<DiscKind, string> = {
  correcte: "Import correcte", inferior: "Comissió inferior", superior: "Liquidat per sobre", pendent_liquidacio: "Pendent de liquidació",
  retrocessio: "Retrocessió a revisar", duplicat: "Línia duplicada", no_identificat: "No identificada", sense_regla: "Sense regla aprovada",
};
export type Eligibility = "reclamable" | "revisio" | "no_reclamable";
export const ELIG_LABEL: Record<Eligibility, string> = { reclamable: "Reclamable", revisio: "Cal revisar", no_reclamable: "No reclamable" };
export type ItemKind = "infraliquidacio" | "pendent_liquidacio" | "retrocessio_improcedent";

export interface SourceRef { rule_key?: string | null; version?: number | null; document?: string | null; page?: number | null; excerpt?: string | null; label: string }
export interface RuleLite {
  id: string; rule_key: string; version: number; name: string; status: string; kind: string; value: string | number | null; unit: string;
  product: string | null; retailer: string | null; tiers?: unknown; conditions: Record<string, unknown> | null; valid_from: string; valid_to: string | null; layer?: string;
}
export interface LineIn {
  id: string; statement_id: string; reference: string; received_at: string; period_from: string | null; period_to: string | null; line_no: number;
  cups: string | null; external_ref: string | null; contract_ref: string | null; client_name: string | null; concept: string | null;
  amount: string; kind: string; match_status: string; contract_id: string | null; expected_amount: string | null; line_hash?: string | null;
}
export interface ContractIn {
  id: string; client_id: string | null; client_name: string | null; retailer: string; product: string | null; status: string; cups: string | null;
  activated_at: string | null;                 // data d'activació (o d'inici) del subministrament
  econ_status: string | null; cancelled_at: string | null; tariff?: string | null; eligible_mwh?: string | number | null; annual_kwh?: number | null; province?: string | null;
  calc: { amount: string | null; status: string; rule_id: string | null; rule_key: string | null; rule_version: number | null } | null;
}
export interface RetailerTerms { paymentDays: number | null; claimDays: number | null; paymentRef?: SourceRef | null; claimRef?: SourceRef | null }
export interface ActiveRef { claim_id: string; code: string; status: ClaimStatus; item_status: string }

export interface DiscRow {
  key: string;                                   // clau de la diferència (fin_claim_items.item_key)
  kind: DiscKind; eligibility: Eligibility; itemKind: ItemKind | null;
  retailer: string; lineId: string | null; statementRef: string | null; contractId: string | null; clientId: string | null;
  cups: string | null; supply: string | null; reference: string | null; contractRef: string | null; client: string | null;
  expected: string | null; settled: string; difference: string | null; claimable: string; pendingJustify: string;
  reason: string; ruleId: string | null; ruleRef: SourceRef | null;
  /** Fets estructurats per redactar el motiu en l'idioma del PDF (dates, terminis, mesos). */
  facts?: { activated?: string | null; deadline?: string | null; paymentDays?: number | null; riskMonths?: number | null; elapsedMonths?: number | null; allowed?: string | null } | null;
  status: "pendent" | "reclamada" | "resolta"; claim: ActiveRef | null; selectable: boolean;
}

const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const addDays = (d: string, n: number) => { const x = new Date(`${d.slice(0, 10)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("ca-ES", { timeZone: "UTC" }) : "—");
const abs = (v: string) => money(D(v).abs());
/** Import per als textos: 1.234,56 € */
export const eu = (v: string | number | null | undefined, lang: "ca" | "es" = "ca") => `${Number(v ?? 0).toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" as unknown as boolean })} €`;

/** Referència contractual d'una regla aprovada (document, pàgina i fragment literal guardats en aprovar-la). */
export function ruleSource(r: RuleLite | null | undefined): SourceRef | null {
  if (!r) return null;
  const src = (r.conditions?.source ?? null) as { document?: string; version?: number; page?: number | null; excerpt?: string } | null;
  const label = `Regla «${r.name}» v${r.version}${src?.document ? ` · ${src.document}${src.page ? `, pàg. ${src.page}` : ""}` : ""}`;
  return { rule_key: r.rule_key, version: r.version, document: src?.document ?? null, page: src?.page ?? null, excerpt: src?.excerpt ?? null, label };
}

export const keyForLine = (lineId: string) => `line:${lineId}`;
export const keyForRetro = (lineId: string) => `retro:${lineId}`;
export const keyForPending = (contractId: string) => `pendent:${contractId}`;

/** L'esdeveniment que merita la comissió segons la regla (per defecte, l'activació). */
const accrualEvent = (r: RuleLite | null) => String((r?.conditions as { accrual_event?: string } | null)?.accrual_event ?? "activacio");
const AUTO_ACCRUAL = ["activacio", "alta_subministrament", "signatura"];

export interface DetectInput {
  retailer: string; from: string; to: string; today: string;
  lines: LineIn[];                         // línies de les liquidacions de la comercialitzadora rebudes en el període
  settledContracts: Set<string>;           // contractes que ja tenen alguna línia de comissió (de qualsevol liquidació)
  contracts: ContractIn[];                 // contractes de la comercialitzadora amb càlcul de la capa proveïdor
  rules: Map<string, RuleLite>;            // regles per id
  terms: RetailerTerms;
  clawRules: ClawRule[];
  claimed: Map<string, ActiveRef>;         // diferències ja incloses en reclamacions (actives o resoltes)
  minEur?: string;                         // import mínim per considerar una diferència (per defecte 1,00 €)
  tolerance?: string;                      // tolerància d'arrodoniment (per defecte 0,01 €)
}

export function detectDiscrepancies(inp: DetectInput): DiscRow[] {
  const min = D(inp.minEur ?? "1.00"), tol = D(inp.tolerance ?? "0.01");
  const byId = new Map(inp.contracts.map((c) => [c.id, c]));
  const out: DiscRow[] = [];
  const mark = (row: Omit<DiscRow, "status" | "claim" | "selectable">): DiscRow => {
    const c = inp.claimed.get(row.key) ?? null;
    const status: DiscRow["status"] = !c ? "pendent" : c.status === "resolta" || c.status === "rebutjada" ? "resolta" : "reclamada";
    return { ...row, status, claim: c, selectable: row.eligibility === "reclamable" && status === "pendent" };
  };

  for (const l of inp.lines) {
    if (l.match_status === "descartat") continue;
    const k = l.contract_id ? byId.get(l.contract_id) ?? null : null;
    const rule = k?.calc?.rule_id ? inp.rules.get(k.calc.rule_id) ?? null : null;
    const base = {
      retailer: inp.retailer, lineId: l.id, statementRef: l.reference, contractId: l.contract_id, clientId: k?.client_id ?? null,
      cups: l.cups ?? k?.cups ?? null, supply: k?.cups ?? l.cups ?? null, reference: l.external_ref, contractRef: l.contract_ref, client: k?.client_name ?? l.client_name,
      settled: money(l.amount), ruleId: rule?.id ?? null, ruleRef: ruleSource(rule),
    };
    if (l.match_status === "duplicat") {
      out.push(mark({ ...base, key: keyForLine(l.id), kind: "duplicat", eligibility: "no_reclamable", itemKind: null, expected: null, difference: null, claimable: "0.00", pendingJustify: "0.00", reason: "Línia repetida en una altra liquidació: no es reclama (revisa-la a Conciliació)." }));
      continue;
    }
    if (!l.contract_id || l.match_status === "no_identificat") {
      out.push(mark({ ...base, key: keyForLine(l.id), kind: "no_identificat", eligibility: "revisio", itemKind: null, expected: null, difference: null, claimable: "0.00", pendingJustify: abs(l.amount), reason: "La línia no s'ha pogut vincular a cap contracte del CRM: assigna-la a Conciliació abans de reclamar." }));
      continue;
    }
    // ---- retrocessions comunicades per la comercialitzadora
    if (l.kind === "retrocessio" || D(l.amount).lt(0) && l.kind !== "regularitzacio" && l.kind !== "ajustament") {
      out.push(mark(retroRow(inp, l, k, base)));
      continue;
    }
    if (l.kind !== "comissio") continue;                                // regularitzacions i ajustaments: informatius
    // ---- comissions
    const calc = k?.calc ?? null;
    if (!calc || calc.status !== "calculat" || calc.amount == null || !rule || rule.status !== "aprovada") {
      const why = !calc ? "El contracte no té cap comissió calculada" : calc.status === "simulacio" ? "La regla aplicable encara no està aprovada per Direcció (només simulació)" : calc.status === "pendent_configuracio" ? "La regla està pendent de configuració (base de càlcul no validada)" : calc.status === "pendent_dades" ? "Falten dades del contracte per calcular la comissió" : "No hi ha cap regla aprovada aplicable";
      out.push(mark({ ...base, key: keyForLine(l.id), kind: "sense_regla", eligibility: "revisio", itemKind: null, expected: calc?.amount ?? null, difference: null, claimable: "0.00", pendingJustify: "0.00", reason: `${why}: no es pot reclamar sense una regla aprovada.` }));
      continue;
    }
    const expected = money(calc.amount);
    const diff = D(l.amount).minus(expected);
    if (diff.abs().lte(tol)) {
      out.push(mark({ ...base, key: keyForLine(l.id), kind: "correcte", eligibility: "no_reclamable", itemKind: null, expected, difference: "0.00", claimable: "0.00", pendingJustify: "0.00", reason: "L'import liquidat coincideix amb la regla aprovada." }));
      continue;
    }
    if (diff.gt(0)) {
      out.push(mark({ ...base, key: keyForLine(l.id), kind: "superior", eligibility: "no_reclamable", itemKind: null, expected, difference: money(diff), claimable: "0.00", pendingJustify: "0.00", reason: "S'ha liquidat més del previst: no es reclama (pot ser una regularització o un incentiu; revisa-ho)." }));
      continue;
    }
    const gap = money(diff.neg());
    const blockers: string[] = [];
    if (k && k.econ_status && k.econ_status !== "actiu") blockers.push(`el contracte consta com a ${k.econ_status === "anullat" ? "anul·lat" : "penalitzat"}${k.cancelled_at ? ` (${fmt(k.cancelled_at)})` : ""}: comprova les condicions de meritació`);
    if (!AUTO_ACCRUAL.includes(accrualEvent(rule))) blockers.push(`la regla merita amb «${accrualEvent(rule)}», que s'ha de verificar abans de reclamar`);
    if (rule.conditions && (rule.conditions as { exceptions?: unknown }).exceptions) blockers.push("la regla té excepcions contractuals que cal revisar");
    if (D(gap).lt(min)) blockers.push(`la diferència (${eu(gap)}) és inferior al mínim de ${eu(money(min))}`);
    const late = claimWindowClosed(inp, l.received_at);
    if (late) blockers.push(late);
    out.push(mark({
      ...base, key: keyForLine(l.id), kind: "inferior", eligibility: blockers.length ? "revisio" : "reclamable", itemKind: "infraliquidacio",
      expected, difference: money(diff), claimable: blockers.length ? "0.00" : gap, pendingJustify: gap,
      reason: blockers.length ? `Comissió inferior en ${eu(gap)}, però ${blockers.join("; ")}.` : `Liquidat ${eu(l.amount)} quan la regla aprovada en preveu ${eu(expected)} (diferència ${eu(gap)}).`,
    }));
  }

  // ---- contractes activats dins el període que la comercialitzadora encara no ha liquidat mai
  for (const k of inp.contracts) {
    const act = iso(k.activated_at);
    if (!act || act < inp.from || act > inp.to) continue;
    if (inp.settledContracts.has(k.id)) continue;
    if (!["actiu", "renovacio_pendent", "finalitzat"].includes(k.status)) continue;
    const rule = k.calc?.rule_id ? inp.rules.get(k.calc.rule_id) ?? null : null;
    const base = {
      retailer: inp.retailer, lineId: null, statementRef: null, contractId: k.id, clientId: k.client_id, cups: k.cups, supply: k.cups, reference: null, contractRef: null,
      client: k.client_name, settled: "0.00", ruleId: rule?.id ?? null, ruleRef: ruleSource(rule), key: keyForPending(k.id),
    };
    if (!k.calc || k.calc.status !== "calculat" || k.calc.amount == null || !rule || rule.status !== "aprovada") {
      out.push(mark({ ...base, kind: "pendent_liquidacio", eligibility: "revisio", itemKind: null, expected: k.calc?.amount ?? null, difference: null, claimable: "0.00", pendingJustify: "0.00", reason: "Contracte activat sense liquidar, però sense una regla aprovada que fixi la comissió: no es pot reclamar encara." }));
      continue;
    }
    const expected = money(k.calc.amount);
    const why: string[] = [];
    let eligibility: Eligibility = "reclamable";
    if (k.econ_status && k.econ_status !== "actiu") { eligibility = "no_reclamable"; why.push(`el contracte consta com a ${k.econ_status === "anullat" ? "anul·lat" : "penalitzat"}: no s'ha meritat`); }
    if (!AUTO_ACCRUAL.includes(accrualEvent(rule))) { eligibility = eligibility === "no_reclamable" ? eligibility : "revisio"; why.push(`la comissió es merita amb «${accrualEvent(rule)}» i cal verificar que s'ha complert`); }
    if (rule.conditions && (rule.conditions as { exceptions?: unknown }).exceptions) { eligibility = eligibility === "no_reclamable" ? eligibility : "revisio"; why.push("la regla té excepcions contractuals"); }
    let deadline: string | null = null;
    if (inp.terms.paymentDays == null) { eligibility = eligibility === "no_reclamable" ? eligibility : "revisio"; why.push("no hi ha cap termini de pagament aprovat per a aquesta comercialitzadora: no es pot afirmar que ja s'hagi d'haver liquidat"); }
    else {
      deadline = addDays(act, inp.terms.paymentDays);
      if (inp.today <= deadline) { eligibility = "no_reclamable"; why.push(`encara és dins del termini de pagament (${inp.terms.paymentDays} dies, fins al ${fmt(deadline)})`); }
    }
    if (inp.terms.claimDays != null && addDays(act, inp.terms.claimDays) < inp.today) { eligibility = eligibility === "no_reclamable" ? eligibility : "revisio"; why.push(`pot haver vençut el termini de reclamació de ${inp.terms.claimDays} dies`); }
    out.push(mark({
      ...base, kind: "pendent_liquidacio", eligibility, itemKind: eligibility === "reclamable" ? "pendent_liquidacio" : null, expected, difference: money(D(expected).neg()),
      claimable: eligibility === "reclamable" ? expected : "0.00", pendingJustify: expected, facts: { activated: act, deadline, paymentDays: inp.terms.paymentDays },
      reason: eligibility === "reclamable"
        ? `Activat el ${fmt(act)} i no liquidat: el termini de pagament de ${inp.terms.paymentDays} dies va vèncer el ${fmt(deadline)}.`
        : `Pendent de liquidació (${eu(expected)}), però ${why.join("; ")}.`,
    }));
  }
  return out;
}

function claimWindowClosed(inp: DetectInput, receivedAt: string): string | null {
  if (inp.terms.claimDays == null) return null;
  return addDays(receivedAt, inp.terms.claimDays) < inp.today ? `pot haver vençut el termini de reclamació de ${inp.terms.claimDays} dies des de la liquidació` : null;
}

function retroRow(inp: DetectInput, l: LineIn, k: ContractIn | null, base: Pick<DiscRow, "retailer" | "lineId" | "statementRef" | "contractId" | "clientId" | "cups" | "supply" | "reference" | "contractRef" | "client" | "settled" | "ruleId" | "ruleRef">): Omit<DiscRow, "status" | "claim" | "selectable"> {
  const clawed = abs(l.amount);
  const event = /impag|impago/i.test(l.concept ?? "") ? "impagament" : /no activ|no alta/i.test(l.concept ?? "") ? "no_activat" : /titular/i.test(l.concept ?? "") ? "canvi_titular" : "baixa_anticipada";
  const start = iso(k?.activated_at);
  const commission = Number(k?.calc?.status === "calculat" ? k.calc.amount ?? 0 : 0);
  const rule = inp.clawRules.find((r) => r.status === "aprovada" && (r.trigger === event || r.trigger === "altres") && (!start || (r.valid_from <= start && (!r.valid_to || r.valid_to >= start))) && (!r.product || !k?.product || r.product.toLowerCase() === k.product.toLowerCase()));
  const common = { ...base, key: keyForRetro(l.id), kind: "retrocessio" as const, expected: null as string | null, difference: null as string | null };
  if (!rule) return { ...common, eligibility: "revisio", itemKind: null, claimable: "0.00", pendingJustify: clawed, reason: `Retrocessió de ${eu(clawed)} sense cap regla de retrocessió aprovada que la justifiqui: cal revisar-la.` };
  const r = clawbackFor(rule, { commission: commission || Number(clawed), start, event, eventDate: iso(k?.cancelled_at) ?? l.received_at });
  const ref: SourceRef = { label: `Regla de retrocessió «${rule.name}» v${rule.version}` };
  if (r.status === "fora_termini") return { ...common, ruleRef: ref, eligibility: "reclamable", itemKind: "retrocessio_improcedent", expected: "0.00", difference: money(D(l.amount)), claimable: clawed, pendingJustify: clawed, reason: `Retrocessió de ${eu(clawed)} fora del període de risc (${fullMonths(start ?? l.received_at, iso(k?.cancelled_at) ?? l.received_at)} mesos des de l'activació; període de risc de ${rule.risk_months} mesos).`, facts: { riskMonths: rule.risk_months, elapsedMonths: start ? fullMonths(start, iso(k?.cancelled_at) ?? l.received_at) : null, activated: start } };
  if (r.status === "aplica" && r.amount != null) {
    const excess = D(clawed).minus(r.amount);
    if (excess.gt("0.01")) return { ...common, ruleRef: ref, eligibility: "reclamable", itemKind: "retrocessio_improcedent", expected: money(-r.amount), difference: money(excess.neg()), claimable: money(excess), pendingJustify: money(excess), reason: `Retrocessió de ${eu(clawed)} quan la regla en permet ${eu(r.amount)} (${r.formula.replace(/−/g, "-")}).`, facts: { riskMonths: rule.risk_months, allowed: money(r.amount), activated: start } };
    return { ...common, ruleRef: ref, eligibility: "no_reclamable", itemKind: null, expected: money(-r.amount), difference: "0.00", claimable: "0.00", pendingJustify: "0.00", reason: `Retrocessió conforme a la regla (${r.reason}).` };
  }
  return { ...common, ruleRef: ref, eligibility: "revisio", itemKind: null, claimable: "0.00", pendingJustify: clawed, reason: `Retrocessió de ${eu(clawed)} que cal revisar: ${r.reason}.` };
}

/* ======================================================================= indicadors */

export interface ClaimRowLite { status: ClaimStatus; total_claimed: string | number; total_recognized: string | number; total_recovered: string | number; items_count: number; contracts?: string[] }
export function claimKpis(rows: DiscRow[], claims: ClaimRowLite[]) {
  const sum = (xs: (string | number)[]) => money(xs.reduce<ReturnType<typeof D>>((a, x) => a.plus(D(x)), D(0)));
  const disc = rows.filter((r) => ["inferior", "pendent_liquidacio", "retrocessio"].includes(r.kind));
  const awaiting = claims.filter((c) => AWAITING.includes(c.status));
  const affected = new Set(disc.filter((r) => r.contractId).map((r) => r.contractId!));
  return {
    discrepancies: sum(disc.map((r) => r.pendingJustify)),
    claimable: sum(rows.filter((r) => r.eligibility === "reclamable" && r.status === "pendent").map((r) => r.claimable)),
    claimed: sum(claims.filter((c) => !["esborrany", "pendent_enviament"].includes(c.status)).map((c) => c.total_claimed)),
    recovered: sum(claims.map((c) => c.total_recovered)),
    awaiting: sum(awaiting.map((c) => D(c.total_claimed).minus(c.total_recovered).toString())),
    contracts: affected.size,
    open: claims.filter((c) => OPEN_CLAIM.includes(c.status)).length,
    resolved: claims.filter((c) => c.status === "resolta" || c.status === "rebutjada").length,
    counts: Object.fromEntries((Object.keys(DISC_LABEL) as DiscKind[]).map((k) => [k, rows.filter((r) => r.kind === k).length])) as Record<DiscKind, number>,
  };
}

/* ======================================================================= explicació de diferències (hipòtesis) */

export const REASONS = {
  geografica: "Comissió geogràfica incorrecta", tarifa: "Tarifa aplicada incorrectament", mwh: "MWh comissionables diferents", campanya: "Campanya no aplicada",
  incentiu: "Incentiu pendent", activacio: "Activació fora del període", retrocessio: "Retrocessió contractual", regularitzacio: "Duplicació o regularització",
  meritacio: "Condicions de meritació no complertes", pendent_revisio: "Motiu pendent de revisió",
} as const;
export type ReasonCode = keyof typeof REASONS;
export interface Hypothesis { code: ReasonCode; label: string; detail: string; confidence: number; refs: SourceRef[] }
export interface ExplainInput {
  row: Pick<DiscRow, "kind" | "expected" | "settled" | "difference" | "lineId">;
  rule: RuleLite | null;
  otherRules: RuleLite[];                     // altres regles APROVADES de la mateixa comercialitzadora (capa proveïdor)
  contract: Pick<ContractIn, "product" | "tariff" | "activated_at" | "econ_status" | "cancelled_at" | "eligible_mwh" | "annual_kwh" | "province"> | null;
  line: { concept: string | null; received_at: string; period_from: string | null; period_to: string | null; kind: string } | null;
  clawRules: ClawRule[];
}

/** Import simple d'una regla (fix o per MWh) per comparar-lo amb el liquidat. */
function simpleAmount(r: RuleLite, mwh: number | null): number | null {
  const v = Number(r.value);
  if (!Number.isFinite(v)) return null;
  if (r.kind === "fix_contracte" || r.kind === "bonificacio") return v;
  if (r.kind === "per_mwh" && mwh != null) return Math.round(v * mwh * 100) / 100;
  return null;
}
const close = (a: number, b: number, pct = 0.01) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * pct);

export function explainDiscrepancy(x: ExplainInput): { hypotheses: Hypothesis[]; top: Hypothesis; needsReview: boolean } {
  const out: Hypothesis[] = [];
  const settled = Number(x.row.settled), expected = x.row.expected != null ? Number(x.row.expected) : null;
  const ref = ruleSource(x.rule);
  const refs = ref ? [ref] : [];
  const mwh = x.contract?.eligible_mwh != null ? Number(x.contract.eligible_mwh) : x.contract?.annual_kwh != null ? x.contract.annual_kwh / 1000 : null;
  const cond = (x.rule?.conditions ?? {}) as Record<string, unknown>;

  // regularització o duplicació
  if (x.row.kind === "duplicat" || /regulari|abono|ajust|duplic/i.test(x.line?.concept ?? "")) {
    out.push({ code: "regularitzacio", label: REASONS.regularitzacio, detail: x.row.kind === "duplicat" ? "La mateixa línia apareix en una altra liquidació." : `El concepte de la línia («${x.line?.concept}») indica una regularització o un ajust.`, confidence: x.row.kind === "duplicat" ? 0.9 : 0.6, refs });
  }
  // retrocessió
  if (x.row.kind === "retrocessio" || x.line?.kind === "retrocessio") {
    const claws = x.clawRules.filter((r) => r.status === "aprovada");
    out.push({ code: "retrocessio", label: REASONS.retrocessio, detail: claws.length ? `Hi ha ${claws.length} regla(es) de retrocessió aprovades; comprova el fet desencadenant i el període de risc.` : "No hi ha cap regla de retrocessió aprovada per justificar-la.", confidence: 0.7, refs: claws.slice(0, 2).map((c) => ({ label: `Regla de retrocessió «${c.name}» v${c.version}` })) });
  }
  // condicions de meritació
  if (x.contract?.econ_status && x.contract.econ_status !== "actiu") {
    out.push({ code: "meritacio", label: REASONS.meritacio, detail: `El contracte consta com a ${x.contract.econ_status}${x.contract.cancelled_at ? ` des del ${fmt(x.contract.cancelled_at)}` : ""}.`, confidence: 0.7, refs });
  } else if (cond.accrual_event && !AUTO_ACCRUAL.includes(String(cond.accrual_event))) {
    out.push({ code: "meritacio", label: REASONS.meritacio, detail: `La regla merita amb «${String(cond.accrual_event)}»: verifica que s'ha complert.`, confidence: 0.45, refs });
  }
  // activació fora del període liquidat
  const act = iso(x.contract?.activated_at);
  if (act && x.line?.period_from && x.line.period_to && (act < x.line.period_from || act > x.line.period_to)) {
    out.push({ code: "activacio", label: REASONS.activacio, detail: `Activació el ${fmt(act)}, fora del període liquidat (${fmt(x.line.period_from)} – ${fmt(x.line.period_to)}).`, confidence: 0.55, refs });
  }
  if (expected != null && x.rule && settled > 0) {
    // MWh diferents
    if (x.rule.kind === "per_mwh" && Number(x.rule.value) > 0 && mwh != null) {
      const implied = settled / Number(x.rule.value);
      if (Math.abs(implied - mwh) / Math.max(mwh, 0.001) > 0.02) out.push({ code: "mwh", label: REASONS.mwh, detail: `L'import liquidat equival a ${implied.toFixed(3).replace(".", ",")} MWh a ${x.rule.value} €/MWh; el CRM en compta ${mwh.toFixed(3).replace(".", ",")}.`, confidence: 0.65, refs });
    }
    // tarifa o producte equivocat: una altra regla aprovada explica exactament l'import
    for (const o of x.otherRules) {
      if (o.id === x.rule.id || o.status !== "aprovada") continue;
      const a = simpleAmount(o, mwh);
      if (a != null && close(settled, a)) {
        const t = (o.conditions as { tariff?: string } | null)?.tariff;
        out.push({ code: "tarifa", label: REASONS.tarifa, detail: `L'import liquidat (${eu(settled)}) coincideix amb la regla «${o.name}»${t ? ` (peatge ${t})` : o.product ? ` (producte ${o.product})` : ""} i no amb la del contracte${x.contract?.tariff ? ` (peatge ${x.contract.tariff})` : x.contract?.product ? ` (producte ${x.contract.product})` : ""}.`, confidence: 0.75, refs: [...refs, ruleSource(o)!] });
        break;
      }
    }
    // campanya o bonificació no aplicada
    const bonus = x.otherRules.filter((o) => o.kind === "bonificacio" && o.status === "aprovada");
    for (const b of bonus) if (close(expected - settled, Number(b.value), 0.02)) { out.push({ code: "campanya", label: REASONS.campanya, detail: `La diferència coincideix amb la bonificació «${b.name}» (${eu(b.value ?? 0)}).`, confidence: 0.7, refs: [ruleSource(b)!] }); break; }
    if (cond.campaign || cond.campanya) out.push({ code: "campanya", label: REASONS.campanya, detail: `La regla inclou la campanya «${String(cond.campaign ?? cond.campanya)}»: comprova que s'ha aplicat.`, confidence: 0.4, refs });
    // comissió geogràfica
    const zone = cond.zona ?? cond.zone ?? cond.provincia ?? cond.province;
    if (zone) out.push({ code: "geografica", label: REASONS.geografica, detail: `La regla depèn de la zona (${String(zone)})${x.contract?.province ? `; el subministrament és a ${x.contract.province}` : ""}.`, confidence: x.contract?.province && !String(zone).toLowerCase().includes(x.contract.province.toLowerCase()) ? 0.6 : 0.35, refs });
    // incentius per volum
    const tiers = x.otherRules.filter((o) => o.kind === "trams_volum" && o.status === "aprovada");
    if (tiers.length) out.push({ code: "incentiu", label: REASONS.incentiu, detail: `Hi ha ${tiers.length} incentiu(s) per volum aprovat(s) que es poden liquidar a part.`, confidence: 0.3, refs: tiers.slice(0, 2).map((t) => ruleSource(t)!) });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  const fallback: Hypothesis = { code: "pendent_revisio", label: REASONS.pendent_revisio, detail: "No hi ha prou informació per explicar la diferència amb seguretat. Revisa la liquidació i el contracte.", confidence: 0, refs };
  const top = out[0] && out[0].confidence >= 0.5 ? out[0] : fallback;
  return { hypotheses: out.length ? out : [fallback], top, needsReview: top.code === "pendent_revisio" };
}

/* ======================================================================= regularitzacions (liquidació nova → reclamacions) */

export interface OpenItem { id: string; claim_id: string; claim_status: ClaimStatus; item_key: string; kind: ItemKind; contract_id: string | null; cups: string | null; claimed_amount: string; recovered_amount: string }
export interface NewLine { id: string; contract_id: string | null; cups: string | null; amount: string; kind: string; concept: string | null; match_status: string }
export interface LinkProposal { claim_id: string; item_id: string; statement_line_id: string; amount: string; confidence: number; reason: string }

export function matchRegularizations(lines: NewLine[], items: OpenItem[]): LinkProposal[] {
  const out: LinkProposal[] = [];
  const open = items.filter((i) => ["enviada", "pendent_resposta", "en_revisio", "acceptada_total", "acceptada_parcial"].includes(i.claim_status) && D(i.claimed_amount).gt(i.recovered_amount));
  for (const l of lines) {
    if (l.match_status === "duplicat" || l.match_status === "descartat" || D(l.amount).lte(0)) continue;
    const kw = /regulari|reclam|abono|diferenc|ajust|atras/i.test(l.concept ?? "");
    const cups20 = (l.cups ?? "").slice(0, 20);
    let best: LinkProposal | null = null;
    for (const i of open) {
      const sameContract = !!l.contract_id && l.contract_id === i.contract_id;
      const sameCups = !!cups20 && !!i.cups && i.cups.slice(0, 20) === cups20;
      if (!sameContract && !sameCups) continue;
      const pending = D(i.claimed_amount).minus(i.recovered_amount);
      const exact = D(l.amount).minus(pending).abs().lte("0.05");
      let conf = sameContract ? 0.5 : 0.35;
      const why: string[] = [sameContract ? "mateix contracte" : "mateix CUPS"];
      if (exact) { conf += 0.35; why.push("import igual al pendent de recuperar"); }
      if (kw || l.kind === "regularitzacio" || l.kind === "ajustament") { conf += 0.15; why.push("concepte de regularització"); }
      if (i.kind === "pendent_liquidacio" && l.kind === "comissio") { conf += 0.1; why.push("primera liquidació d'un contracte reclamat com a pendent"); }
      if (!exact && !kw && l.kind === "comissio" && i.kind === "infraliquidacio") conf -= 0.2;   // una comissió nova normal no és, per si sola, una regularització
      conf = Math.max(0, Math.min(0.99, Math.round(conf * 100) / 100));
      if (conf < 0.45) continue;
      const p = { claim_id: i.claim_id, item_id: i.id, statement_line_id: l.id, amount: money(l.amount), confidence: conf, reason: why.join(" · ") };
      if (!best || p.confidence > best.confidence) best = p;
    }
    if (best) out.push(best);
  }
  return out;
}

/* ======================================================================= correu */

export type Lang = "ca" | "es";
export interface EmailInput { lang: Lang; code: string; retailer: string; contactName: string | null; periodFrom: string; periodTo: string; total: string; count: number; byReason: { label: string; count: number; amount: string }[]; senderName: string; senderEmail: string | null; responseDays: number }
const eurTxt = (v: string | number, lang: Lang) => eu(v, lang);
const dTxt = (d: string, lang: Lang) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString(lang === "es" ? "es-ES" : "ca-ES", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

export function buildClaimEmail(e: EmailInput): { subject: string; body: string } {
  const p = `${dTxt(e.periodFrom, e.lang)} – ${dTxt(e.periodTo, e.lang)}`;
  const reasons = e.byReason.map((r) => `  · ${r.label}: ${r.count} ${e.lang === "es" ? (r.count === 1 ? "contrato" : "contratos") : r.count === 1 ? "contracte" : "contractes"} (${eurTxt(r.amount, e.lang)})`).join("\n");
  if (e.lang === "es") {
    return {
      subject: `Reclamación de comisiones ${e.retailer} · ${p} · ${e.code}`,
      body: `${e.contactName ? `Estimado/a ${e.contactName}:` : "Buenos días:"}

Les escribimos desde Assessoria 3.0, asesoría energética colaboradora de ${e.retailer}.

Tras revisar la liquidación de comisiones correspondiente al periodo ${p} y compararla con las condiciones del contrato de colaboración vigente, hemos detectado diferencias en ${e.count} ${e.count === 1 ? "contrato" : "contratos"}, por un importe total de ${eurTxt(e.total, e.lang)}:

${reasons}

Adjuntamos el informe ${e.code} con el detalle de cada contrato (CUPS, referencias, comisión prevista y liquidada, diferencia y cláusula contractual aplicable).

Les agradeceríamos que revisaran estas diferencias y procedieran a su regularización en la próxima liquidación, o que nos indicaran el motivo en caso de discrepancia, en un plazo de ${e.responseDays} días.

Quedamos a su disposición para cualquier aclaración.

Atentamente,

${e.senderName}
Assessoria 3.0 · Departamento de Administración${e.senderEmail ? `\n${e.senderEmail}` : ""}`,
    };
  }
  return {
    subject: `Reclamació de comissions ${e.retailer} · ${p} · ${e.code}`,
    body: `${e.contactName ? `Benvolgut/da ${e.contactName},` : "Bon dia,"}

Us escrivim des d'Assessoria 3.0, assessoria energètica col·laboradora de ${e.retailer}.

Després de revisar la liquidació de comissions del període ${p} i comparar-la amb les condicions del contracte de col·laboració vigent, hem detectat diferències en ${e.count} ${e.count === 1 ? "contracte" : "contractes"}, per un import total de ${eurTxt(e.total, e.lang)}:

${reasons}

Adjuntem l'informe ${e.code} amb el detall de cada contracte (CUPS, referències, comissió prevista i liquidada, diferència i clàusula contractual aplicable).

Us agrairíem que revisàveu aquestes diferències i les regularitzéssiu en la propera liquidació, o que ens indiquéssiu el motiu si no hi esteu d'acord, en un termini de ${e.responseDays} dies.

Restem a la vostra disposició per a qualsevol aclariment.

Atentament,

${e.senderName}
Assessoria 3.0 · Departament d'Administració${e.senderEmail ? `\n${e.senderEmail}` : ""}`,
  };
}

export const ITEM_KIND_LABEL: Record<ItemKind, string> = { infraliquidacio: "Comissió inferior a la pactada", pendent_liquidacio: "Contracte activat pendent de liquidar", retrocessio_improcedent: "Retrocessió no justificada" };
export const ITEM_KIND_LABEL_ES: Record<ItemKind, string> = { infraliquidacio: "Comisión inferior a la pactada", pendent_liquidacio: "Contrato activado pendiente de liquidar", retrocessio_improcedent: "Retrocesión no justificada" };
export const fullMonthsBetween = fullMonths;
