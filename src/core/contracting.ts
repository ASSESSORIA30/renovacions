/**
 * CRM FASE 3 · CONTRACTACIÓ I TRAMITACIONS (model compartit client/servidor, sense dependències de servidor).
 * Les regles de transició es repeteixen a la base de dades (trigger crm_exp_before): aquí serveixen per guiar la
 * interfície i donar missatges clars; la base de dades és qui mana.
 */
import { z } from "zod";
import { SERVICES, SERVICE_LABEL, type Service } from "./sales";
import { CLIENT_KINDS, type ClientKind } from "./crm";

/* ------------------------------------------------------------------ estats */

export const EXP_STATUSES = ["pendent_documentacio", "documentacio_completa", "pendent_signatura", "signat", "enviat", "en_tramitacio", "activat", "incidencia", "rebutjat"] as const;
export type ExpStatus = (typeof EXP_STATUSES)[number];
export const EXP_STATUS_LABEL: Record<ExpStatus, string> = {
  pendent_documentacio: "Pendent de documentació",
  documentacio_completa: "Documentació completa",
  pendent_signatura: "Pendent de signatura",
  signat: "Signat",
  enviat: "Enviat a comercialitzadora",
  en_tramitacio: "En tramitació",
  activat: "Activat",
  incidencia: "Incidència",
  rebutjat: "Rebutjat o anul·lat",
};
export const EXP_STATUS_COLOR: Record<ExpStatus, string> = {
  pendent_documentacio: "#f59e0b", documentacio_completa: "#84cc16", pendent_signatura: "#a855f7", signat: "#6366f1", enviat: "#0ea5e9",
  en_tramitacio: "#06b6d4", activat: "#16a34a", incidencia: "#ef4444", rebutjat: "#71717a",
};
export const OPEN_EXP_STATUSES: ExpStatus[] = ["pendent_documentacio", "documentacio_completa", "pendent_signatura", "signat", "enviat", "en_tramitacio", "incidencia"];
/** Ordre del flux principal (les incidències i els rebuigs en queden fora). */
export const FLOW: ExpStatus[] = ["pendent_documentacio", "documentacio_completa", "pendent_signatura", "signat", "enviat", "en_tramitacio", "activat"];
/** Estats que pot gestionar un comercial (preparació). La resta són tramitació d'Administració. */
export const SALES_STATUSES: ExpStatus[] = ["pendent_documentacio", "documentacio_completa", "pendent_signatura"];

const TRANSITIONS: Record<ExpStatus, ExpStatus[]> = {
  pendent_documentacio: ["documentacio_completa", "incidencia", "rebutjat"],
  documentacio_completa: ["pendent_signatura", "pendent_documentacio", "incidencia", "rebutjat"],
  pendent_signatura: ["signat", "documentacio_completa", "pendent_documentacio", "incidencia", "rebutjat"],
  signat: ["enviat", "incidencia", "rebutjat"],
  enviat: ["en_tramitacio", "activat", "incidencia", "rebutjat"],
  en_tramitacio: ["activat", "enviat", "incidencia", "rebutjat"],
  incidencia: ["pendent_documentacio", "documentacio_completa", "pendent_signatura", "signat", "enviat", "en_tramitacio", "rebutjat"],
  activat: ["incidencia"],
  rebutjat: ["pendent_documentacio"],
};
export const allowedTransitions = (from: ExpStatus) => TRANSITIONS[from];

export const PROCEDURE_TYPES = ["alta_nova", "canvi_comercialitzadora", "renovacio", "canvi_titular", "modificacio", "portabilitat", "altres"] as const;
export type ProcedureType = (typeof PROCEDURE_TYPES)[number];
export const PROCEDURE_LABEL: Record<ProcedureType, string> = {
  alta_nova: "Alta nova", canvi_comercialitzadora: "Canvi de comercialitzadora", renovacio: "Renovació", canvi_titular: "Canvi de titular",
  modificacio: "Modificació (potència, tarifa…)", portabilitat: "Portabilitat", altres: "Altres",
};
export const ACTIVATION_SOURCES = ["comercialitzadora", "distribuidora", "portal", "factura", "altres"] as const;
export const ACTIVATION_SOURCE_LABEL: Record<(typeof ACTIVATION_SOURCES)[number], string> = {
  comercialitzadora: "Confirmació de la comercialitzadora", distribuidora: "Confirmació de la distribuïdora", portal: "Portal del proveïdor", factura: "Primera factura", altres: "Altres",
};
export const REQ_STATUS_LABEL = { pendent: "Pendent", aportat: "Aportat", validat: "Validat", rebutjat: "Rebutjat", no_aplica: "No s'aplica" } as const;
export type ReqStatus = keyof typeof REQ_STATUS_LABEL;
export const DATA_FIELDS = ["client.tax_id", "client.name", "client.address", "client.contact", "supply.cups", "supply.address", "supply.holder_name", "supply.access_tariff", "supply.power"] as const;
export type DataField = (typeof DATA_FIELDS)[number];
export const DATA_FIELD_LABEL: Record<DataField, string> = {
  "client.tax_id": "NIF/CIF del client", "client.name": "Nom del client", "client.address": "Adreça del client", "client.contact": "Telèfon o correu",
  "supply.cups": "CUPS", "supply.address": "Adreça del subministrament", "supply.holder_name": "Titular del subministrament", "supply.access_tariff": "Tarifa d'accés", "supply.power": "Potències contractades",
};
export const SIGNATURE_STATUS_LABEL = {
  preparada: "Preparada", pendent_configuracio: "Integració pendent", enviada: "Enviada", oberta: "Oberta pel signant", signada: "Signada",
  rebutjada: "Rebutjada pel signant", caducada: "Caducada", cancellada: "Cancel·lada", error: "Error",
} as const;
export type SignatureStatus = keyof typeof SIGNATURE_STATUS_LABEL;
export const ACCRUAL_LABEL = { pendent: "Pendent", meritada: "Meritada", anullada: "Anul·lada", no_aplica: "No s'aplica" } as const;
export const PAYMENT_LABEL = { pendent: "Pendent", cobrada: "Cobrada", parcial: "Cobrament parcial", impagada: "Impagada", no_aplica: "No s'aplica" } as const;

/* ------------------------------------------------------------------ tipus */

export interface Expedient {
  id: string; code: string; client_id: string; supply_id: string | null; opportunity_id: string | null; comparison_id: string | null; contract_id: string | null; previous_contract_id: string | null;
  service: Service; procedure_type: ProcedureType; customer_type: ClientKind; retailer: string; product: string | null; owner_id: string | null; collaborator_id: string | null;
  status: ExpStatus; priority: "baixa" | "mitjana" | "alta"; position: number; version: number; status_changed_at: string; status_before_incident: ExpStatus | null;
  next_action: string | null; next_action_at: string | null; expected_signature_date: string | null; expected_activation_date: string | null;
  signed_at: string | null; sent_at: string | null; sent_to: string | null; external_ref: string | null;
  activated_at: string | null; activation_source: string | null; activation_ref: string | null; activation_confirmed_by: string | null; activation_confirmed_at: string | null;
  start_date: string | null; end_date: string | null; rejection_reason: string | null; accepted_terms_id: string | null; internal_notes: string | null;
  last_event_at: string; created_by: string | null; created_at: string; updated_at: string;
}
export interface Requirement {
  id: string; expedient_id: string; requirement_id: string | null; name: string; kind: "document" | "dada" | "manual"; doc_category: string | null; data_field: DataField | null;
  mandatory: boolean; status: ReqStatus; document_id: string | null; note: string | null; reject_reason: string | null; validated_by: string | null; validated_at: string | null;
}
export interface Terms {
  id: string; expedient_id: string; version: number; source: "comparativa" | "oportunitat" | "manual"; comparison_id: string | null; proposal_document_id: string | null;
  retailer: string; product: string | null; service: string; conditions: Conditions; annual_kwh: number | null; estimated_annual_eur: number | null; notes: string | null;
  sha256: string; captured_by_name: string | null; captured_at: string;
}

/** Condicions pactades (còpia immutable). Tots els camps són opcionals: el que no es coneix és null. */
export const conditionsSchema = z.object({
  price_type: z.enum(["fix", "periodes", "indexat", "mixt"]).nullable().optional(),
  energy_eur_kwh: z.array(z.number().finite().min(0).max(5).nullable()).max(6).nullable().optional(),
  power_eur_kw_day: z.array(z.number().finite().min(0).max(10).nullable()).max(6).nullable().optional(),
  power_unit: z.string().max(30).nullable().optional(),
  gas_fixed_eur_day: z.number().finite().min(0).max(100).nullable().optional(),
  monthly_fee_eur: z.number().finite().min(0).max(100_000).nullable().optional(),
  discount_pct: z.number().finite().min(0).max(100).nullable().optional(),
  permanence_months: z.number().int().min(0).max(120).nullable().optional(),
  duration_months: z.number().int().min(0).max(120).nullable().optional(),
  price_guarantee_months: z.number().int().min(0).max(120).nullable().optional(),
  penalty: z.string().max(500).nullable().optional(),
  extra: z.array(z.object({ concept: z.string().min(1).max(120), value: z.string().min(1).max(200) })).max(20).optional(),
  text: z.string().max(4000).nullable().optional(),
  offer_ref: z.object({ offer_id: z.string().max(80), version: z.number().nullable(), supplier: z.string().max(120), product: z.string().max(160) }).nullable().optional(),
});
export type Conditions = z.infer<typeof conditionsSchema>;

export type Snap = { supply?: { annualKwh?: number | null }; offers?: ({ id: string; supplierName: string; productName: string; version: number; contractType?: string; energy?: (number | null)[]; energy24h?: number | null; power?: (number | null)[]; powerUnit?: string; gasFixedEurDay?: number | null; permanenceMonths?: number | null; durationMonths?: number | null; priceGuaranteeMonths?: number | null; penalty?: string | null; conditions?: string | null; fees?: { concept: string; eurMonth?: number | null; eurYear?: number | null }[]; discounts?: { concept: string; pct?: number | null }[] })[]; result?: { ranked?: { offer: { id: string }; cost?: { total?: number } }[] } };

/** Condicions a partir de l'oferta acceptada d'una comparativa (es copien, no es recalculen). */
export function conditionsFromOffer(snap: Snap, offerId: string | null): { conditions: Conditions; retailer: string; product: string; annual_kwh: number | null; estimated: number | null } | null {
  const id = offerId ?? snap.result?.ranked?.[0]?.offer.id ?? null;
  const o = snap.offers?.find((x) => x.id === id);
  if (!o) return null;
  const ct = o.contractType;
  const energy = (o.energy ?? []).some((x) => x != null) ? o.energy! : o.energy24h != null ? [o.energy24h] : null;
  const extra = [
    ...(o.fees ?? []).map((f) => ({ concept: f.concept, value: f.eurMonth != null ? `${f.eurMonth} €/mes` : f.eurYear != null ? `${f.eurYear} €/any` : "Inclòs" })),
    ...(o.discounts ?? []).map((d) => ({ concept: d.concept, value: d.pct != null ? `${d.pct} % de descompte` : "Descompte" })),
  ].slice(0, 20);
  return {
    retailer: o.supplierName, product: o.productName,
    annual_kwh: snap.supply?.annualKwh ?? null,
    estimated: snap.result?.ranked?.find((r) => r.offer.id === o.id)?.cost?.total ?? null,
    conditions: conditionsSchema.parse({
      price_type: ct === "fix" || ct === "indexat" || ct === "mixt" ? ct : ct ? "periodes" : null,
      energy_eur_kwh: energy, power_eur_kw_day: (o.power ?? []).some((x) => x != null) ? o.power : null, power_unit: o.powerUnit ?? null,
      gas_fixed_eur_day: o.gasFixedEurDay ?? null, permanence_months: o.permanenceMonths ?? null, duration_months: o.durationMonths ?? null,
      price_guarantee_months: o.priceGuaranteeMonths ?? null, penalty: o.penalty ?? null, text: o.conditions ?? null, extra,
      offer_ref: { offer_id: o.id, version: o.version ?? null, supplier: o.supplierName, product: o.productName },
    }),
  };
}


/* ------------------------------------------------------------------ entrades */

const uuid = z.string().uuid();
const optText = (n: number) => z.string().trim().max(n).transform((v) => v || null).nullable().optional();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no vàlida").nullable().optional().or(z.literal("").transform(() => null));

export const expedientInput = z.object({
  client_id: uuid,
  supply_id: uuid.nullable().optional(),
  opportunity_id: uuid.nullable().optional(),
  comparison_id: uuid.nullable().optional(),
  service: z.enum(SERVICES, { errorMap: () => ({ message: "Tria el servei" }) }),
  procedure_type: z.enum(PROCEDURE_TYPES).default("canvi_comercialitzadora"),
  retailer: z.string().trim().min(1, "Indica la comercialitzadora o el proveïdor").max(120),
  product: optText(160),
  owner_id: uuid.nullable().optional(),
  priority: z.enum(["baixa", "mitjana", "alta"]).default("mitjana"),
  expected_signature_date: optDate,
  expected_activation_date: optDate,
  next_action: optText(200),
  internal_notes: optText(4000),
});
export type ExpedientInput = z.infer<typeof expedientInput>;

export const termsInput = z.object({
  source: z.enum(["comparativa", "oportunitat", "manual"]),
  comparison_id: uuid.nullable().optional(),
  offer_id: z.string().max(80).nullable().optional(),       // oferta acceptada dins la comparativa
  retailer: z.string().trim().min(1).max(120).optional(),
  product: optText(160),
  conditions: conditionsSchema.default({}),
  annual_kwh: z.number().finite().min(0).nullable().optional(),
  estimated_annual_eur: z.number().finite().nullable().optional(),
  notes: optText(2000),
});

export const moveExpInput = z.object({
  status: z.enum(EXP_STATUSES),
  version: z.number().int().positive(),
  position: z.number().finite().optional(),
  note: optText(1000),
  rejection_reason: optText(500),
  sent_at: z.string().datetime({ offset: true }).nullable().optional().or(optDate),
  sent_to: optText(120),
  external_ref: optText(120),
});
export const activationInput = z.object({
  activated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica la data real d'activació"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica la data d'inici del contracte"),
  end_date: optDate,
  source: z.enum(ACTIVATION_SOURCES, { errorMap: () => ({ message: "Indica qui ha confirmat l'activació" }) }),
  ref: optText(120),
  note: optText(1000),
  create_renewal: z.boolean().default(false),
}).refine((v) => !v.end_date || v.end_date >= v.start_date, { message: "La data de finalització ha de ser posterior a la d'inici", path: ["end_date"] });

/* ------------------------------------------------------------------ validacions de flux (espill del trigger) */

export interface MoveContext {
  staff: boolean;
  requirements: Pick<Requirement, "mandatory" | "status">[];
  signed: boolean;               // hi ha alguna signatura confirmada
  exp: Pick<Expedient, "status" | "sent_at" | "sent_to" | "signed_at" | "activated_at" | "activation_source" | "start_date" | "rejection_reason" | "status_before_incident">;
  note?: string | null;
}
/** Retorna null si la transició és vàlida o el motiu (en català) pel qual no ho és. */
export function checkMove(to: ExpStatus, c: MoveContext): string | null {
  const from = c.exp.status;
  if (from === to) return null;
  if (!TRANSITIONS[from].includes(to)) return `No es pot passar de «${EXP_STATUS_LABEL[from]}» a «${EXP_STATUS_LABEL[to]}».`;
  if (!c.staff && !(SALES_STATUSES.includes(to) && SALES_STATUSES.includes(from))) return `Només Administració pot moure l'expedient a «${EXP_STATUS_LABEL[to]}».`;
  if (from === "incidencia" && to !== "rebutjat" && c.exp.status_before_incident && FLOW.indexOf(to) > FLOW.indexOf(c.exp.status_before_incident))
    return `En resoldre la incidència, l'expedient torna com a màxim a «${EXP_STATUS_LABEL[c.exp.status_before_incident]}».`;
  if (needsJustification(from, to) && !c.note?.trim()) return "Cal indicar una justificació per a aquest canvi.";
  if (to === "documentacio_completa") {
    const missing = c.requirements.filter((r) => r.mandatory && (r.status === "pendent" || r.status === "rebutjat")).length;
    if (missing) return `Falta documentació obligatòria (${missing}).`;
  }
  if (to === "signat" && !c.signed) return "No hi ha cap signatura confirmada pel proveïdor ni cap signatura manuscrita registrada.";
  if (to === "enviat" && (!c.exp.sent_at || !c.exp.sent_to)) return "Cal registrar la data d'enviament i la comercialitzadora receptora.";
  if (to === "activat" && (!c.exp.activated_at || !c.exp.activation_source || !c.exp.start_date || !c.exp.signed_at)) return "Falta la informació mínima d'activació.";
  if (to === "rebutjat" && !c.exp.rejection_reason) return "Cal indicar el motiu del rebuig o de l'anul·lació.";
  return null;
}
export function needsJustification(from: ExpStatus, to: ExpStatus) {
  if (from === "activat" || from === "rebutjat" || to === "incidencia" || to === "rebutjat") return true;
  const a = FLOW.indexOf(from), b = FLOW.indexOf(to);
  return a >= 0 && b >= 0 && b < a;
}

/* ------------------------------------------------------------------ requisits */

export interface DataSources {
  client: { name: string | null; tax_id: string | null; address: string | null; city: string | null; phone: string | null; email: string | null };
  supply: { cups: string | null; address: string | null; holder_name: string | null; access_tariff: string | null; power_kw: (number | null)[] | null } | null;
}
/** Una dada obligatòria es dona per aportada si és a la fitxa (client o subministrament). */
export function dataPresent(field: DataField, d: DataSources): boolean {
  const s = d.supply;
  switch (field) {
    case "client.tax_id": return !!d.client.tax_id;
    case "client.name": return !!d.client.name;
    case "client.address": return !!d.client.name && !!(d.client.address || d.client.city);
    case "client.contact": return !!(d.client.phone || d.client.email);
    case "supply.cups": return !!s?.cups;
    case "supply.address": return !!(s?.address || d.client.address);
    case "supply.holder_name": return !!(s?.holder_name || d.client.name);
    case "supply.access_tariff": return !!s?.access_tariff;
    case "supply.power": return !!s?.power_kw?.some((x) => x != null && x > 0);
  }
}
export function docProgress(reqs: Pick<Requirement, "mandatory" | "status">[]) {
  const mandatory = reqs.filter((r) => r.mandatory && r.status !== "no_aplica");
  const done = mandatory.filter((r) => r.status === "aportat" || r.status === "validat").length;
  const rejected = reqs.filter((r) => r.status === "rebutjat").length;
  return { total: mandatory.length, done, pending: mandatory.length - done, rejected, pct: mandatory.length ? Math.round((done / mandatory.length) * 100) : 100 };
}

/* ------------------------------------------------------------------ plantilles */

/**
 * Format de les plantilles (text pla, sense HTML):
 *   # Títol · ## Secció · - punt de llista · --- separador · línia buida = paràgraf nou
 *   {{client.nom}} variable obligatòria (si no hi ha valor, no es genera i s'indica què falta)
 *   {{?client.email}} variable opcional (si no hi ha valor, s'escriu «—»)
 *   {{condicions.taula}} (en una línia sola) insereix la taula de condicions pactades
 */
export const TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: "client.nom", label: "Nom o raó social" }, { key: "client.nif", label: "NIF/CIF" }, { key: "client.tipus", label: "Tipus de client" },
  { key: "client.adreca", label: "Adreça" }, { key: "client.cp", label: "Codi postal" }, { key: "client.poblacio", label: "Població" }, { key: "client.provincia", label: "Província" },
  { key: "client.telefon", label: "Telèfon" }, { key: "client.email", label: "Correu" }, { key: "client.contacte", label: "Persona de contacte" },
  { key: "subministrament.cups", label: "CUPS" }, { key: "subministrament.adreca", label: "Adreça del subministrament" }, { key: "subministrament.titular", label: "Titular" },
  { key: "subministrament.tarifa", label: "Tarifa d'accés" }, { key: "subministrament.potencies", label: "Potències (kW)" }, { key: "subministrament.consum", label: "Consum anual (kWh)" },
  { key: "expedient.codi", label: "Codi d'expedient" }, { key: "expedient.servei", label: "Servei" }, { key: "expedient.tramit", label: "Tipus de tràmit" },
  { key: "producte.nom", label: "Producte" }, { key: "producte.comercialitzadora", label: "Comercialitzadora" },
  { key: "condicions.taula", label: "Taula de condicions pactades" }, { key: "condicions.text", label: "Condicions (text)" }, { key: "condicions.permanencia", label: "Permanència" },
  { key: "condicions.import_estimat", label: "Import anual estimat" }, { key: "condicions.data_acceptacio", label: "Data d'acceptació de les condicions" },
  { key: "comercial.nom", label: "Comercial" }, { key: "comercial.codi", label: "Codi del comercial" }, { key: "comercial.email", label: "Correu del comercial" },
  { key: "data.generacio", label: "Data de generació" },
];
const KNOWN = new Set(TEMPLATE_VARS.map((v) => v.key));

export type TemplateBlock =
  | { t: "h1" | "h2" | "p" | "li"; text: string }
  | { t: "hr" }
  | { t: "table"; rows: [string, string][] };

export function templateVariables(body: string) {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\??\s*([a-z_.]+)\s*\}\}/g)) found.add(m[1]);
  return { used: [...found], unknown: [...found].filter((k) => !KNOWN.has(k)) };
}

const fmtNum = (n: number, d = 6) => n.toLocaleString("ca-ES", { maximumFractionDigits: d });
export function conditionsRows(c: Conditions, extra: { annual_kwh?: number | null; estimated_annual_eur?: number | null } = {}): [string, string][] {
  const rows: [string, string][] = [];
  const per = (a: (number | null)[] | null | undefined, unit: string) => (a ?? []).map((v, i) => (v == null ? null : `P${i + 1}: ${fmtNum(v)} ${unit}`)).filter(Boolean).join(" · ");
  if (c.offer_ref) rows.push(["Oferta", `${c.offer_ref.supplier} · ${c.offer_ref.product}${c.offer_ref.version ? ` (v${c.offer_ref.version})` : ""}`]);
  if (c.price_type) rows.push(["Tipus de preu", { fix: "Fix", periodes: "Per períodes", indexat: "Indexat", mixt: "Mixt" }[c.price_type]]);
  const e = per(c.energy_eur_kwh, "€/kWh"); if (e) rows.push(["Terme d'energia", e]);
  const p = per(c.power_eur_kw_day, c.power_unit || "€/kW·dia"); if (p) rows.push(["Terme de potència", p]);
  if (c.gas_fixed_eur_day != null) rows.push(["Terme fix de gas", `${fmtNum(c.gas_fixed_eur_day)} €/dia`]);
  if (c.monthly_fee_eur != null) rows.push(["Quota mensual", `${fmtNum(c.monthly_fee_eur, 2)} €`]);
  if (c.discount_pct != null) rows.push(["Descompte", `${fmtNum(c.discount_pct, 2)} %`]);
  if (c.duration_months != null) rows.push(["Durada", `${c.duration_months} mesos`]);
  if (c.price_guarantee_months != null) rows.push(["Preu garantit", `${c.price_guarantee_months} mesos`]);
  if (c.permanence_months != null) rows.push(["Permanència", c.permanence_months ? `${c.permanence_months} mesos` : "Sense permanència"]);
  if (c.penalty) rows.push(["Penalització", c.penalty]);
  for (const x of c.extra ?? []) rows.push([x.concept, x.value]);
  if (extra.annual_kwh != null) rows.push(["Consum anual de referència", `${fmtNum(extra.annual_kwh, 0)} kWh`]);
  if (extra.estimated_annual_eur != null) rows.push(["Import anual estimat", `${fmtNum(extra.estimated_annual_eur, 2)} € (estimació, no és una factura)`]);
  return rows;
}

/** Omple la plantilla. Si falten dades obligatòries, retorna la llista i no genera res. */
export function renderTemplate(body: string, vars: Record<string, string | null | undefined>, table: [string, string][]): { ok: true; blocks: TemplateBlock[] } | { ok: false; missing: string[]; unknown: string[] } {
  const { unknown } = templateVariables(body);
  const missing = new Set<string>();
  const fill = (line: string) => line.replace(/\{\{(\?)?\s*([a-z_.]+)\s*\}\}/g, (_, opt: string | undefined, key: string) => {
    if (key === "condicions.taula") return "";
    const v = vars[key];
    if (v == null || v === "") { if (!opt) missing.add(key); return "—"; }
    return v;
  });
  if (/\{\{\s*condicions\.taula\s*\}\}/.test(body) && !table.length) missing.add("condicions.taula");
  const blocks: TemplateBlock[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ t: "p", text: para.join(" ") }); para = []; } };
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\{\{\s*condicions\.taula\s*\}\}\s*$/.test(line)) { flush(); blocks.push({ t: "table", rows: table }); continue; }
    if (!line.trim()) { flush(); continue; }
    if (line.trim() === "---") { flush(); blocks.push({ t: "hr" }); continue; }
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) { flush(); blocks.push({ t: h[1].length === 1 ? "h1" : "h2", text: fill(h[2]) }); continue; }
    const li = /^\s*[-•]\s+(.*)$/.exec(line);
    if (li) { flush(); blocks.push({ t: "li", text: fill(li[1]) }); continue; }
    para.push(fill(line.trim()));
  }
  flush();
  if (unknown.length || missing.size) return { ok: false, missing: [...missing], unknown };
  return { ok: true, blocks };
}

export const VAR_LABEL = Object.fromEntries(TEMPLATE_VARS.map((v) => [v.key, v.label])) as Record<string, string>;

/** Plantilla interna d'exemple (document propi d'Assessoria 3.0, NO és un contracte de cap comercialitzadora). */
export const INTERNAL_TEMPLATE_EXAMPLE = `# Resum de condicions acceptades
Expedient {{expedient.codi}} · {{data.generacio}}

## Titular
{{client.nom}} · NIF/CIF {{client.nif}}
{{client.adreca}}, {{?client.cp}} {{client.poblacio}}
Contacte: {{?client.telefon}} · {{?client.email}}

## Servei
{{expedient.servei}} · {{expedient.tramit}}
CUPS: {{?subministrament.cups}} · Tarifa d'accés: {{?subministrament.tarifa}}

## Producte i condicions pactades
{{producte.comercialitzadora}} · {{producte.nom}}
{{condicions.taula}}

---
Aquest document resumeix les condicions comercials acceptades pel client segons la proposta presentada per Assessoria 3.0. No substitueix el contracte de la comercialitzadora, que és el document que regeix el subministrament.

Gestor: {{comercial.nom}} · {{?comercial.email}}`;

/* ------------------------------------------------------------------ automatitzacions (pures) */

export const EXP_RULE_KEYS = ["exp_documentacio_incompleta", "exp_signatura_pendent", "exp_sense_moviment", "exp_rebuig", "exp_activat", "exp_sense_responsable"] as const;
export type ExpRuleKey = (typeof EXP_RULE_KEYS)[number];

export interface ExpAutoInput {
  now: Date;
  rules: { key: string; enabled: boolean; params: Record<string, unknown> }[];
  expedients: (Pick<Expedient, "id" | "code" | "client_id" | "status" | "owner_id" | "status_changed_at" | "last_event_at" | "retailer"> & { client_name: string | null })[];
  signatures: { id: string; expedient_id: string; status: string; sent_at: string | null }[];
  staffIds: string[];
}
export interface ExpPlan {
  tasks: { rule_key: string; title: string; kind: "tramitacio" | "seguiment"; due_at: string; assigned_to: string; client_id: string; expedient_id: string; notes: string | null }[];
  notifications: { rule_key: string; user_id: string; kind: string; title: string; body: string | null; link: { view: string; params: Record<string, string> } }[];
  events: { rule_key: string; expedient_id: string; title: string }[];
}
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}W${String(Math.ceil(((t.getTime() - y.getTime()) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
};
const days = (from: string | null, now: Date) => (from ? (now.getTime() - new Date(from).getTime()) / 86_400_000 : 0);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);

export function planExpedientAutomations(a: ExpAutoInput): ExpPlan {
  const out: ExpPlan = { tasks: [], notifications: [], events: [] };
  const rule = (k: ExpRuleKey) => a.rules.find((r) => r.key === k && r.enabled);
  const today = a.now.toISOString().slice(0, 10);
  const link = (id: string) => ({ view: "expedient", params: { id } });
  const who = (e: ExpAutoInput["expedients"][number]) => (e.owner_id ? [e.owner_id] : a.staffIds);
  const due = (d: number) => new Date(a.now.getTime() + d * 86_400_000).toISOString();
  const label = (e: ExpAutoInput["expedients"][number]) => `${e.code}${e.client_name ? ` · ${e.client_name}` : ""}`;

  const docs = rule("exp_documentacio_incompleta");
  if (docs) for (const e of a.expedients) {
    if (e.status !== "pendent_documentacio" || days(e.status_changed_at, a.now) < num(docs.params.days, 3)) continue;
    const key = `exp_doc:${e.id}:${e.status_changed_at.slice(0, 10)}`;
    for (const u of who(e).slice(0, 1)) out.tasks.push({ rule_key: key, title: `Reclamar la documentació pendent: ${label(e)}`, kind: "tramitacio", due_at: due(1), assigned_to: u, client_id: e.client_id, expedient_id: e.id, notes: null });
    out.events.push({ rule_key: `ev:${key}`, expedient_id: e.id, title: "Automatització: tasca per reclamar la documentació pendent" });
  }
  const sig = rule("exp_signatura_pendent");
  if (sig) for (const s of a.signatures) {
    if (!["enviada", "oberta"].includes(s.status) || days(s.sent_at, a.now) < num(sig.params.days, 3)) continue;
    const e = a.expedients.find((x) => x.id === s.expedient_id);
    if (!e) continue;
    const key = `exp_sig:${s.id}`;
    for (const u of who(e)) out.notifications.push({ rule_key: key, user_id: u, kind: "expedient", title: `Signatura pendent: ${label(e)}`, body: `Enviada fa ${Math.floor(days(s.sent_at, a.now))} dies i encara no s'ha signat.`, link: link(e.id) });
    out.events.push({ rule_key: `ev:${key}`, expedient_id: e.id, title: "Automatització: avís de signatura pendent" });
  }
  const idle = rule("exp_sense_moviment");
  if (idle) for (const e of a.expedients) {
    if (!OPEN_EXP_STATUSES.includes(e.status) || days(e.last_event_at, a.now) < num(idle.params.days, 7)) continue;
    const key = `exp_idle:${e.id}:${isoWeek(a.now)}`;
    for (const u of who(e)) out.notifications.push({ rule_key: key, user_id: u, kind: "expedient", title: `Expedient sense moviment: ${label(e)}`, body: `Fa ${Math.floor(days(e.last_event_at, a.now))} dies que no hi ha cap canvi.`, link: link(e.id) });
    out.events.push({ rule_key: `ev:${key}`, expedient_id: e.id, title: "Automatització: avís d'expedient sense moviment" });
  }
  const rej = rule("exp_rebuig");
  if (rej) for (const e of a.expedients) {
    if (e.status !== "rebutjat" || days(e.status_changed_at, a.now) > 7) continue;
    const key = `exp_rej:${e.id}:${e.status_changed_at}`;
    for (const u of [...new Set([...(e.owner_id ? [e.owner_id] : []), ...a.staffIds])]) out.notifications.push({ rule_key: key, user_id: u, kind: "expedient", title: `Rebutjat per ${e.retailer}: ${label(e)}`, body: null, link: link(e.id) });
    out.events.push({ rule_key: `ev:${key}`, expedient_id: e.id, title: "Automatització: avís de rebuig enviat al responsable i a Administració" });
  }
  const act = rule("exp_activat");
  if (act) for (const e of a.expedients) {
    if (e.status !== "activat" || days(e.status_changed_at, a.now) > 7) continue;
    const key = `exp_act:${e.id}`;
    for (const u of who(e)) out.notifications.push({ rule_key: key, user_id: u, kind: "expedient", title: `Contracte activat: ${label(e)}`, body: "Revisa les dades de comissió: l'activació no la marca com a meritada.", link: link(e.id) });
    out.events.push({ rule_key: `ev:${key}`, expedient_id: e.id, title: "Automatització: avís d'activació al responsable" });
  }
  const orphan = rule("exp_sense_responsable");
  if (orphan) for (const e of a.expedients) {
    if (e.owner_id || !OPEN_EXP_STATUSES.includes(e.status)) continue;
    const key = `exp_orphan:${e.id}:${today}`;
    for (const u of a.staffIds) out.notifications.push({ rule_key: key, user_id: u, kind: "expedient", title: `Expedient sense responsable: ${label(e)}`, body: null, link: link(e.id) });
  }
  return out;
}

/* ------------------------------------------------------------------ indicadors del panell */

export function contractingKpis(rows: (Pick<Expedient, "status" | "created_at" | "activated_at" | "status_changed_at" | "service"> & { docs_pending?: number })[], now = new Date()) {
  const by = Object.fromEntries(EXP_STATUSES.map((s) => [s, 0])) as Record<ExpStatus, number>;
  for (const r of rows) by[r.status]++;
  const month = now.toISOString().slice(0, 7);
  const activatedMonth = rows.filter((r) => r.status === "activat" && r.activated_at?.startsWith(month)).length;
  const durations = rows.filter((r) => r.status === "activat" && r.activated_at).map((r) => (new Date(r.activated_at!).getTime() - new Date(r.created_at).getTime()) / 86_400_000).filter((d) => d >= 0);
  const avgDays = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const open = rows.filter((r) => OPEN_EXP_STATUSES.includes(r.status));
  const stale = open.filter((r) => (now.getTime() - new Date(r.status_changed_at).getTime()) / 86_400_000 > 7).length;
  const byService = Object.fromEntries(SERVICES.map((s) => [s, open.filter((r) => r.service === s).length])) as Record<Service, number>;
  return { byStatus: by, open: open.length, activatedMonth, avgDaysToActivate: avgDays, stale, docsPending: open.reduce((a, r) => a + (r.docs_pending ?? 0), 0), byService };
}

export const customerTypeOf = (k: string | null | undefined): ClientKind => (CLIENT_KINDS.includes(k as ClientKind) ? (k as ClientKind) : "empresa");
export const serviceLabel = (s: string) => SERVICE_LABEL[s as Service] ?? s;
