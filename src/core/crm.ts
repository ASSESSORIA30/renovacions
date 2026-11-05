/**
 * CRM FASE 1 · model compartit (navegador i servidor): tipus, etiquetes, normalització i validació.
 * Sense secrets ni accés a dades.
 */
import { pdfHeaderOffset } from "./pdf-sniff";
import { z } from "zod";
import { isValidCups } from "./sips";

/* ------------------------------------------------------------------ catàlegs */

export const CLIENT_KINDS = ["particular", "autonom", "empresa"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];
export const CLIENT_KIND_LABEL: Record<ClientKind, string> = { particular: "Particular", autonom: "Autònom", empresa: "Empresa" };

export const CLIENT_STATUSES = ["potencial", "actiu", "inactiu", "baixa"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = { potencial: "Potencial", actiu: "Actiu", inactiu: "Inactiu", baixa: "Baixa" };
export const CLIENT_STATUS_TONE: Record<ClientStatus, "blue" | "green" | "zinc" | "red"> = { potencial: "blue", actiu: "green", inactiu: "zinc", baixa: "red" };

export const PRIORITIES = ["baixa", "mitjana", "alta"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { baixa: "Baixa", mitjana: "Mitjana", alta: "Alta" };

export const ORIGINS = ["Recomanació", "Web", "Trucada entrant", "Col·laborador", "Porta a porta", "Fira o esdeveniment", "Xarxes socials", "Cartera existent", "Altres"];

export const SUPPLY_STATUSES = ["actiu", "pendent_alta", "baixa"] as const;
export type SupplyStatus = (typeof SUPPLY_STATUSES)[number];
export const SUPPLY_STATUS_LABEL: Record<SupplyStatus, string> = { actiu: "Actiu", pendent_alta: "Pendent d'alta", baixa: "Baixa" };
export const DATA_SOURCES = ["manual", "sips", "factura", "importacio"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];
export const DATA_SOURCE_LABEL: Record<DataSource, string> = { manual: "Manual", sips: "SIPS", factura: "Factura", importacio: "Importació" };

export const CONTRACT_STATUSES = ["esborrany", "pendent_documentacio", "pendent_signatura", "enviat_comercialitzadora", "en_tramitacio", "actiu", "renovacio_pendent", "finalitzat", "anullat", "incidencia"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  esborrany: "Esborrany",
  pendent_documentacio: "Pendent de documentació",
  pendent_signatura: "Pendent de signatura",
  enviat_comercialitzadora: "Enviat a comercialitzadora",
  en_tramitacio: "En tramitació",
  actiu: "Actiu",
  renovacio_pendent: "Renovació pendent",
  finalitzat: "Finalitzat",
  anullat: "Anul·lat",
  incidencia: "Incidència",
};
export const CONTRACT_STATUS_TONE: Record<ContractStatus, "zinc" | "amber" | "blue" | "green" | "red" | "violet"> = {
  esborrany: "zinc", pendent_documentacio: "amber", pendent_signatura: "amber", enviat_comercialitzadora: "blue", en_tramitacio: "blue",
  actiu: "green", renovacio_pendent: "violet", finalitzat: "zinc", anullat: "red", incidencia: "red",
};
/** Grups per a la pestanya Contractes. */
export const CONTRACT_GROUP: Record<ContractStatus, "tramitacio" | "vigent" | "renovacio" | "anterior"> = {
  esborrany: "tramitacio", pendent_documentacio: "tramitacio", pendent_signatura: "tramitacio", enviat_comercialitzadora: "tramitacio", en_tramitacio: "tramitacio", incidencia: "tramitacio",
  actiu: "vigent", renovacio_pendent: "renovacio", finalitzat: "anterior", anullat: "anterior",
};
export const PRICE_TYPES = ["fix", "periodes", "indexat", "mixt"] as const;
export const PRICE_TYPE_LABEL: Record<(typeof PRICE_TYPES)[number], string> = { fix: "Preu fix", periodes: "Per períodes", indexat: "Indexat", mixt: "Mixt" };

export const DOC_CATEGORIES = ["dni_nie", "fiscal", "factura_llum", "factura_gas", "contracte", "contracte_signat", "mandat", "proposta", "bancaria", "altres", "proteccio_dades"] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];
export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  dni_nie: "DNI / NIE",
  fiscal: "CIF i documentació fiscal",
  factura_llum: "Factura d'electricitat",
  factura_gas: "Factura de gas",
  contracte: "Contracte",
  contracte_signat: "Contracte signat",
  mandat: "Mandat o autorització",
  proposta: "Proposta comercial",
  bancaria: "Documentació bancària",
  altres: "Altres",
  proteccio_dades: "Protecció de dades (autorització o evidència)",
};
export const SENSITIVE_CATEGORIES: DocCategory[] = ["dni_nie", "bancaria"];
/** Conservació obligatòria (anys) abans de poder eliminar: documentació contractual (Codi de Comerç, art. 30). */
export const RETENTION_YEARS: Partial<Record<DocCategory, number>> = { contracte_signat: 6, mandat: 6 };

export const ACTIVITY_TYPES = ["nota", "trucada", "reunio", "email", "whatsapp", "tasca", "seguiment", "proposta", "canvi", "document"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_LABEL: Record<ActivityType, string> = { nota: "Nota", trucada: "Trucada", reunio: "Reunió", email: "Correu", whatsapp: "WhatsApp", tasca: "Tasca", seguiment: "Seguiment", proposta: "Proposta", canvi: "Canvi", document: "Document" };
/** Tipus que un usuari pot registrar a mà (la resta els genera el sistema). */
export const MANUAL_ACTIVITY_TYPES: ActivityType[] = ["nota", "trucada", "reunio", "email", "whatsapp", "seguiment", "proposta"];
export const DELIVERIES = ["intent", "registrat", "enviat", "error"] as const;
export type Delivery = (typeof DELIVERIES)[number];
export const DELIVERY_LABEL: Record<Delivery, string> = { intent: "Només s'ha obert l'aplicació", registrat: "Registrat a mà", enviat: "Enviament confirmat", error: "Error d'enviament" };

/* ------------------------------------------------------------------ tipus de dades */

export interface CrmClient {
  id: string;
  kind: ClientKind;
  name: string;
  trade_name: string | null;
  tax_id: string | null;
  tax_id_type: TaxIdType | null;
  sector: string | null;
  status: ClientStatus;
  registered_at: string;
  contact_name: string | null;
  /** Fase 9: càrrec del contacte habitual i representant legal (empreses). El DNI/NIE pot arribar emmascarat. */
  contact_role?: string | null;
  legal_rep_name?: string | null;
  legal_rep_tax_id?: string | null;
  legal_rep_role?: LegalRepRole | null;
  contact_is_legal_rep?: boolean;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  notes: string | null;
  owner_id: string | null;
  collaborator_id: string | null;
  origin: string | null;
  tags: string[];
  priority: Priority;
  next_follow_up: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
export interface CrmClientRow extends CrmClient {
  supplies_count: number;
  luz_count: number;
  gas_count: number;
  active_contracts: number;
  next_renewal: string | null;
  last_activity_at: string | null;
  owner_name: string | null;
  owner_labels?: string[];
}
export interface CrmContact { id: string; client_id: string; name: string; role: string | null; phone: string | null; email: string | null; is_primary: boolean; notes: string | null }
export interface CrmSupply {
  id: string; client_id: string; cups: string; energy_type: "luz" | "gas"; address: string | null; postal_code: string | null; city: string | null; province: string | null;
  holder_name: string | null; current_retailer: string | null; access_tariff: string | null; power_kw: (number | null)[] | null; annual_kwh: number | null; period_kwh: (number | null)[] | null;
  status: SupplyStatus; current_contract_id: string | null; data_source: DataSource; data_updated_at: string; notes: string | null; created_at: string; archived_at: string | null;
}
export interface CrmContract {
  id: string; client_id: string; supply_id: string | null; retailer: string; product: string | null; price_type: (typeof PRICE_TYPES)[number] | null; access_tariff: string | null;
  signed_at: string | null; start_date: string | null; end_date: string | null; status: ContractStatus; owner_id: string | null; notes: string | null;
  previous_contract_id: string | null; legacy_contract_id: string | null; comparison_id: string | null; created_at: string; updated_at: string;
  finance?: { annual_amount_eur: number | null; commission_eur: number | null; commission_pct: number | null; commission_paid_at: string | null; notes: string | null } | null;
}
export interface CrmDocument {
  id: string; client_id: string; supply_id: string | null; contract_id: string | null; category: DocCategory; sensitive: boolean; title: string; description: string | null;
  original_name: string; mime: string; size_bytes: number; version: number; status: "actiu" | "arxivat"; retain_until: string | null; uploaded_by_name: string | null; created_at: string; updated_at: string;
  versions?: { version: number; original_name: string; size_bytes: number; uploaded_by_name: string | null; created_at: string }[];
}
export interface CrmActivity { id: string; client_id: string; supply_id: string | null; contract_id: string | null; type: ActivityType; title: string; body: string | null; at: string; delivery: Delivery | null; user_id: string | null; user_name: string | null; meta: Record<string, unknown> | null }
export interface CrmTask { id: string; client_id: string | null; contract_id: string | null; title: string; notes: string | null; due_at: string | null; status: "pendent" | "feta" | "cancellada"; assigned_to: string | null; assigned_name: string | null; created_at: string; completed_at: string | null }
export interface CrmAuditEvent { id: number; at: string; user_name: string | null; entity: string; entity_id: string; action: string; fields: string[] | null; detail: Record<string, unknown> | null }
export interface CrmPermissions { canEdit: boolean; canSeeSensitive: boolean; isStaff: boolean; canAssign: boolean; canDeleteDocs: boolean }
export interface CrmComparisonLink { id: string; created_at: string; status: string; cups: string | null; client_name: string | null; created_by_name: string | null; saving: number | null; offers?: { id: string; label: string }[]; best?: string | null }
export const INCIDENT_KINDS = ["incidencia", "reclamacio", "consulta"] as const;
export const INCIDENT_KIND_LABEL: Record<(typeof INCIDENT_KINDS)[number], string> = { incidencia: "Incidència", reclamacio: "Reclamació", consulta: "Consulta" };
export const INCIDENT_STATUSES = ["oberta", "en_curs", "esperant_tercers", "resolta", "tancada"] as const;
export const INCIDENT_STATUS_LABEL: Record<(typeof INCIDENT_STATUSES)[number], string> = { oberta: "Oberta", en_curs: "En curs", esperant_tercers: "Esperant tercers", resolta: "Resolta", tancada: "Tancada" };
export interface CrmIncident {
  id: string; client_id: string; supply_id: string | null; contract_id: string | null; kind: (typeof INCIDENT_KINDS)[number]; category: string | null; title: string; description: string | null;
  status: (typeof INCIDENT_STATUSES)[number]; priority: Priority; external_ref: string | null; opened_at: string; closed_at: string | null;
}

export interface CrmClientDetail {
  client: CrmClient & { owner_name: string | null; collaborator_name: string | null };
  contacts: CrmContact[];
  assignments: { user_id: string; role: string; name: string | null }[];
  supplies: CrmSupply[];
  contracts: CrmContract[];
  documents: CrmDocument[];
  activities: CrmActivity[];
  tasks: CrmTask[];
  audit: CrmAuditEvent[];
  comparisons: CrmComparisonLink[];
  incidents: CrmIncident[];
  /** Fase 2: oportunitats comercials del client */
  expedients?: { id: string; code: string; status: string; service: string; retailer: string; product: string | null; created_at: string; activated_at: string | null }[];
  opportunities?: { id: string; title: string; service: string; stage: string; commission_eur: number | null; mwh: number | null; owner_name: string | null; next_action_at: string | null; updated_at: string }[];
  permissions: CrmPermissions;
  /** Fase 9: resum de la capçalera (dades reals) i esborranys de comparatives oberts */
  summary?: { activeContracts: number; pendingRenewals: number; openIncidents: number; comparisonsInProgress: number };
  drafts?: { id: string; context_key: string; contract_id: string | null; crm_supply_id: string | null; cups: string | null; client_name: string | null; step: number; created_by_name: string | null; updated_by_name: string | null; updated_at: string }[];
}

export const LEGAL_REP_ROLES = ["administrador", "administrador_solidari", "administrador_mancomunat", "conseller_delegat", "apoderat", "altre"] as const;
export type LegalRepRole = (typeof LEGAL_REP_ROLES)[number];
export const LEGAL_REP_ROLE_LABEL: Record<LegalRepRole, string> = { administrador: "Administrador/a únic/a", administrador_solidari: "Administrador/a solidari/ària", administrador_mancomunat: "Administrador/a mancomunat/ada", conseller_delegat: "Conseller/a delegat/ada", apoderat: "Apoderat/ada", altre: "Altre" };
/** DNI/NIE emmascarat (només les 4 últimes posicions): per a qui no pot veure dades sensibles. */
export const maskId = (v: string | null | undefined) => (v ? `${"*".repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : null);
export const MASKED = "__masked__";

/* ------------------------------------------------------------------ normalització i validació */

export type TaxIdType = "nif" | "nie" | "cif" | "altre";
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** Normalitza i valida un NIF, NIE o CIF espanyol (amb dígit/lletra de control). */
export function checkTaxId(raw: string | null | undefined): { value: string | null; type: TaxIdType | null; valid: boolean; message?: string } {
  const v = (raw ?? "").toUpperCase().replace(/[\s.\-/]/g, "").replace(/^ES(?=[0-9A-Z]{9}$)/, "");
  if (!v) return { value: null, type: null, valid: true };
  if (/^[0-9]{8}[A-Z]$/.test(v)) {
    const ok = DNI_LETTERS[Number(v.slice(0, 8)) % 23] === v[8];
    return { value: v, type: "nif", valid: ok, message: ok ? undefined : "La lletra del NIF no és correcta" };
  }
  if (/^[XYZ][0-9]{7}[A-Z]$/.test(v)) {
    const n = Number(String("XYZ".indexOf(v[0])) + v.slice(1, 8));
    const ok = DNI_LETTERS[n % 23] === v[8];
    return { value: v, type: "nie", valid: ok, message: ok ? undefined : "La lletra del NIE no és correcta" };
  }
  if (/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(v)) {
    const digits = v.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digits[i]);
      if (i % 2 === 0) { const x = d * 2; sum += Math.floor(x / 10) + (x % 10); } else sum += d;
    }
    const control = (10 - (sum % 10)) % 10;
    const letter = "JABCDEFGHI"[control];
    const c = v[8];
    const mustLetter = "PQRSNW".includes(v[0]);
    const mustDigit = "ABEH".includes(v[0]);
    const ok = mustLetter ? c === letter : mustDigit ? c === String(control) : c === letter || c === String(control);
    return { value: v, type: "cif", valid: ok, message: ok ? undefined : "El dígit de control del CIF no és correcte" };
  }
  if (/^[A-Z0-9]{5,20}$/.test(v)) return { value: v, type: "altre", valid: true, message: "No té format de NIF, NIE ni CIF espanyol: es desa com a identificador estranger" };
  return { value: v, type: null, valid: false, message: "Format d'identificador fiscal no vàlid" };
}

/** Telèfon: espanyol de 9 xifres → +34XXXXXXXXX; internacional → +codi i xifres. */
export function normalizePhone(raw: string | null | undefined): { value: string | null; valid: boolean } {
  let v = (raw ?? "").trim();
  if (!v) return { value: null, valid: true };
  v = v.replace(/[\s.\-()/]/g, "");
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  if (/^[6789][0-9]{8}$/.test(v)) return { value: `+34${v}`, valid: true };
  if (/^\+34[6789][0-9]{8}$/.test(v)) return { value: v, valid: true };
  if (/^\+[1-9][0-9]{7,14}$/.test(v) && !v.startsWith("+34")) return { value: v, valid: true };
  return { value: raw!.trim(), valid: false };
}
export const formatPhone = (p: string | null | undefined) => {
  if (!p) return "";
  const m = /^\+34([0-9]{3})([0-9]{2})([0-9]{2})([0-9]{2})$/.exec(p);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
};
/** Número per a enllaços tel: i wa.me (només xifres, amb prefix). */
export const phoneDigits = (p: string | null | undefined) => (p ? p.replace(/[^0-9]/g, "") : "");

export const normalizeEmail = (raw: string | null | undefined) => {
  const v = (raw ?? "").trim().toLowerCase();
  return { value: v || null, valid: !v || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v) };
};

export const normalizeCupsFull = (raw: string | null | undefined) => (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const validCupsFull = (raw: string | null | undefined) => {
  const v = normalizeCupsFull(raw);
  return /^ES[0-9]{16}[A-Z]{2}([0-9][A-Z])?$/.test(v) && isValidCups(v.slice(0, 20));
};

/** Província a partir dels dos primers dígits del codi postal. */
const PROVINCES: Record<string, string> = {
  "01": "Araba/Álava", "02": "Albacete", "03": "Alacant", "04": "Almeria", "05": "Àvila", "06": "Badajoz", "07": "Illes Balears", "08": "Barcelona", "09": "Burgos", "10": "Càceres",
  "11": "Cadis", "12": "Castelló", "13": "Ciudad Real", "14": "Còrdova", "15": "A Coruña", "16": "Conca", "17": "Girona", "18": "Granada", "19": "Guadalajara", "20": "Gipuzkoa",
  "21": "Huelva", "22": "Osca", "23": "Jaén", "24": "Lleó", "25": "Lleida", "26": "La Rioja", "27": "Lugo", "28": "Madrid", "29": "Màlaga", "30": "Múrcia", "31": "Navarra",
  "32": "Ourense", "33": "Astúries", "34": "Palència", "35": "Las Palmas", "36": "Pontevedra", "37": "Salamanca", "38": "Santa Cruz de Tenerife", "39": "Cantàbria", "40": "Segòvia",
  "41": "Sevilla", "42": "Sòria", "43": "Tarragona", "44": "Terol", "45": "Toledo", "46": "València", "47": "Valladolid", "48": "Bizkaia", "49": "Zamora", "50": "Saragossa", "51": "Ceuta", "52": "Melilla",
};
export const provinceFromPostalCode = (cp: string | null | undefined) => (cp && /^[0-9]{5}$/.test(cp) ? PROVINCES[cp.slice(0, 2)] ?? null : null);

/* ------------------------------------------------------------------ esquemes d'entrada (API) */

const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null);
const optNum = z.union([z.number(), z.string()]).nullable().optional().transform((v, ctx) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) { ctx.addIssue({ code: "custom", message: "Número no vàlid" }); return z.NEVER; }
  return n;
});

export const clientInput = z
  .object({
    kind: z.enum(CLIENT_KINDS),
    name: z.string().trim().min(1, "Falta el nom o la raó social").max(200),
    trade_name: optText(200),
    tax_id: optText(30),
    sector: optText(120),
    status: z.enum(CLIENT_STATUSES).default("potencial"),
    registered_at: optDate,
    contact_name: optText(160),
    contact_role: optText(120),
    legal_rep_name: optText(160),
    legal_rep_tax_id: optText(20),
    legal_rep_role: z.enum(LEGAL_REP_ROLES).nullable().optional().transform((v) => v ?? null),
    contact_is_legal_rep: z.boolean().optional().default(false),
    phone: optText(40),
    phone2: optText(40),
    email: optText(200),
    address: optText(300),
    postal_code: optText(10),
    city: optText(120),
    province: optText(120),
    notes: optText(5000),
    owner_id: z.string().uuid().nullable().optional(),
    collaborator_id: z.string().uuid().nullable().optional(),
    origin: optText(120),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
    priority: z.enum(PRIORITIES).default("mitjana"),
    next_follow_up: optDate,
  })
  .transform((c, ctx) => {
    const tax = checkTaxId(c.tax_id);
    if (!tax.valid) ctx.addIssue({ code: "custom", path: ["tax_id"], message: tax.message ?? "Identificador fiscal no vàlid" });
    if (c.kind === "empresa" && tax.type && (tax.type === "nif" || tax.type === "nie")) ctx.addIssue({ code: "custom", path: ["tax_id"], message: "Una empresa ha de tenir CIF (o un identificador estranger)" });
    const p1 = normalizePhone(c.phone);
    const p2 = normalizePhone(c.phone2);
    if (!p1.valid) ctx.addIssue({ code: "custom", path: ["phone"], message: "Telèfon no vàlid" });
    if (!p2.valid) ctx.addIssue({ code: "custom", path: ["phone2"], message: "Telèfon secundari no vàlid" });
    const em = normalizeEmail(c.email);
    if (!em.valid) ctx.addIssue({ code: "custom", path: ["email"], message: "Correu electrònic no vàlid" });
    const cp = c.postal_code?.replace(/\s/g, "") || null;
    if (cp && !/^[0-9]{5}$/.test(cp)) ctx.addIssue({ code: "custom", path: ["postal_code"], message: "El codi postal ha de tenir 5 xifres" });
    // representant legal: només per a empreses; DNI/NIE validat (un valor emmascarat vol dir «no el canviïs»)
    const company = c.kind === "empresa";
    let repTax: string | null = null;
    if (company && c.legal_rep_tax_id) {
      if (c.legal_rep_tax_id.includes("*")) repTax = MASKED;
      else {
        const t = checkTaxId(c.legal_rep_tax_id);
        if (!t.valid || (t.type !== "nif" && t.type !== "nie")) ctx.addIssue({ code: "custom", path: ["legal_rep_tax_id"], message: "El DNI/NIE del representant legal no és vàlid" });
        repTax = t.value;
      }
    }
    const repName = company ? (c.contact_is_legal_rep ? c.legal_rep_name ?? c.contact_name : c.legal_rep_name) : null;
    return {
      ...c,
      contact_role: c.contact_role,
      legal_rep_name: repName,
      legal_rep_tax_id: repTax,
      legal_rep_role: company ? c.legal_rep_role : null,
      contact_is_legal_rep: company ? c.contact_is_legal_rep : false,
      tax_id: tax.value,
      tax_id_type: tax.type,
      phone: p1.value,
      phone2: p2.value,
      email: em.value,
      postal_code: cp,
      province: c.province ?? provinceFromPostalCode(cp),
      tags: [...new Set(c.tags.map((t) => t.toLowerCase()))],
    };
  });
export type ClientInput = z.input<typeof clientInput>;

export const contactInput = z
  .object({
    name: z.string().trim().min(1, "Falta el nom del contacte").max(160),
    role: optText(120),
    phone: optText(40),
    email: optText(200),
    is_primary: z.boolean().default(false),
    notes: optText(1000),
  })
  .transform((c, ctx) => {
    const p = normalizePhone(c.phone);
    const e = normalizeEmail(c.email);
    if (!p.valid) ctx.addIssue({ code: "custom", path: ["phone"], message: "Telèfon no vàlid" });
    if (!e.valid) ctx.addIssue({ code: "custom", path: ["email"], message: "Correu electrònic no vàlid" });
    return { ...c, phone: p.value, email: e.value };
  });

const six = z.array(z.union([z.number(), z.string(), z.null()])).max(6).nullable().optional().transform((a) => {
  if (!a) return null;
  const out = a.map((x) => (x === null || x === "" ? null : Number(String(x).replace(",", "."))));
  return out.some((x) => x != null && (!Number.isFinite(x) || x < 0)) ? undefined : out.every((x) => x == null) ? null : out;
});

export const supplyInput = z
  .object({
    cups: z.string().trim().min(1, "Falta el CUPS"),
    energy_type: z.enum(["luz", "gas"]),
    address: optText(300),
    postal_code: optText(10),
    city: optText(120),
    province: optText(120),
    holder_name: optText(200),
    current_retailer: optText(120),
    access_tariff: optText(20),
    power_kw: six,
    annual_kwh: optNum,
    period_kwh: six,
    status: z.enum(SUPPLY_STATUSES).default("actiu"),
    data_source: z.enum(DATA_SOURCES).default("manual"),
    notes: optText(2000),
  })
  .transform((s, ctx) => {
    const cups = normalizeCupsFull(s.cups);
    if (!validCupsFull(cups)) ctx.addIssue({ code: "custom", path: ["cups"], message: "CUPS no vàlid (ES + 16 xifres + 2 lletres, amb sufix opcional)" });
    if (s.power_kw === undefined) ctx.addIssue({ code: "custom", path: ["power_kw"], message: "Potències no vàlides" });
    if (s.period_kwh === undefined) ctx.addIssue({ code: "custom", path: ["period_kwh"], message: "Consums per període no vàlids" });
    const cp = s.postal_code?.replace(/\s/g, "") || null;
    return { ...s, cups, postal_code: cp, province: s.province ?? provinceFromPostalCode(cp), power_kw: s.energy_type === "gas" ? null : s.power_kw ?? null, period_kwh: s.period_kwh ?? null };
  });

export const contractInput = z
  .object({
    supply_id: z.string().uuid().nullable().optional(),
    retailer: z.string().trim().min(1, "Falta la comercialitzadora").max(120),
    product: optText(160),
    price_type: z.enum(PRICE_TYPES).nullable().optional(),
    access_tariff: optText(20),
    signed_at: optDate,
    start_date: optDate,
    end_date: optDate,
    status: z.enum(CONTRACT_STATUSES).default("esborrany"),
    owner_id: z.string().uuid().nullable().optional(),
    notes: optText(4000),
    comparison_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((k, ctx) => {
    if (k.start_date && k.end_date && k.end_date < k.start_date) ctx.addIssue({ code: "custom", path: ["end_date"], message: "La data de finalització és anterior a la d'inici" });
    if ((k.status === "actiu" || k.status === "renovacio_pendent") && !k.end_date) ctx.addIssue({ code: "custom", path: ["end_date"], message: "Un contracte actiu necessita la data de finalització o renovació" });
  });

export const financeInput = z.object({
  annual_amount_eur: optNum,
  commission_eur: optNum,
  commission_pct: optNum.refine((v) => v == null || v <= 100, "El percentatge no pot superar el 100 %"),
  commission_paid_at: optDate,
  notes: optText(1000),
});

export const activityInput = z.object({
  type: z.enum(ACTIVITY_TYPES),
  title: z.string().trim().min(1, "Falta el títol").max(200),
  body: optText(10000),
  at: z.string().datetime({ offset: true }).optional(),
  supply_id: z.string().uuid().nullable().optional(),
  contract_id: z.string().uuid().nullable().optional(),
  delivery: z.enum(DELIVERIES).nullable().optional(),
}).superRefine((a, ctx) => {
  // Un usuari no pot marcar res com a «enviat»: només ho fa una integració que ho ha confirmat.
  if (a.delivery === "enviat") ctx.addIssue({ code: "custom", path: ["delivery"], message: "Només una integració pot confirmar un enviament" });
});

export const taskInput = z.object({
  title: z.string().trim().min(1, "Falta el títol").max(200),
  notes: optText(2000),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  contract_id: z.string().uuid().nullable().optional(),
});

export const incidentInput = z.object({
  kind: z.enum(INCIDENT_KINDS).default("incidencia"),
  category: optText(80),
  title: z.string().trim().min(1, "Falta el títol").max(200),
  description: optText(5000),
  status: z.enum(INCIDENT_STATUSES).default("oberta"),
  priority: z.enum(PRIORITIES).default("mitjana"),
  external_ref: optText(80),
  supply_id: z.string().uuid().nullable().optional(),
  contract_id: z.string().uuid().nullable().optional(),
});

/* ------------------------------------------------------------------ llistat */

export const LIST_SORTS = ["nom", "alta", "renovacio", "activitat"] as const;
export type ListSort = (typeof LIST_SORTS)[number];
export const LIST_SORT_LABEL: Record<ListSort, string> = { nom: "Nom", alta: "Data d'alta (recents)", renovacio: "Propera renovació", activitat: "Última activitat" };

export const listQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(CLIENT_STATUSES).optional(),
  owner: z.string().max(60).optional(),
  collaborator: z.string().max(240).optional(),               // uuid o "cap"
  city: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
  sector: z.string().trim().max(120).optional(),
  service: z.enum(["luz", "gas", "cap"]).optional(),
  sort: z.enum(LIST_SORTS).optional().default("nom"),
  // una pàgina fora de rang (0, negativa o no numèrica) es corregeix a l'1 en lloc de fallar amb 400
  page: z.preprocess((v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1; }, z.number().int()).optional().default(1),
  size: z.coerce.number().int().min(10).max(100).optional().default(25),
});
export type ListQuery = z.infer<typeof listQuery>;

/** Escapa els comodins de LIKE i caràcters de sintaxi de PostgREST per a la cerca. */
export const safeSearch = (q: string) => q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/* ------------------------------------------------------------------ documents */

export const DOC_BASE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
/** Tipus addicionals que es poden habilitar amb CRM_DOCS_EXTRA_TYPES (separats per comes). */
export const DOC_OPTIONAL_TYPES: Record<string, string> = {
  heic: "image/heic", tif: "image/tiff", tiff: "image/tiff", doc: "application/msword", xls: "application/vnd.ms-excel",
  csv: "text/csv", txt: "text/plain", eml: "message/rfc822", msg: "application/vnd.ms-outlook", zip: "application/zip", odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
};
export function allowedDocTypes(extra: string | null | undefined): Record<string, string> {
  const out = { ...DOC_BASE_TYPES };
  for (const e of (extra ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) if (DOC_OPTIONAL_TYPES[e]) out[e] = DOC_OPTIONAL_TYPES[e];
  return out;
}
export const extOf = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? "").toLowerCase();

/** Nom de fitxer segur per a la descàrrega (sense rutes ni caràcters de control). */
export const safeFileName = (name: string) => {
  const base = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/^\.+/, "").trim();
  return (base || "document").slice(0, 150);
};

/**
 * Comprova que el contingut real correspon a l'extensió (bytes màgics). Per a DOCX/XLSX/ODT cal, a més,
 * que el servidor comprovi l'estructura interna del ZIP (`zipKind`).
 */
export function sniffDoc(bytes: Uint8Array, ext: string): { ok: boolean; reason?: string; zip?: boolean } {
  const b = bytes;
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  const ascii = (from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));
  switch (ext) {
    case "pdf": return { ok: pdfHeaderOffset(b) >= 0, reason: "No és un PDF vàlid" }; // admet bytes previs (≤1024), mai un altre format camuflat
    case "jpg": case "jpeg": return { ok: starts(0xff, 0xd8, 0xff), reason: "No és una imatge JPEG" };
    case "png": return { ok: starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), reason: "No és una imatge PNG" };
    case "webp": return { ok: ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP", reason: "No és una imatge WebP" };
    case "heic": return { ok: /^ftyp(heic|heix|hevc|hevx|mif1|msf1)/.test(ascii(4, 8)), reason: "No és una imatge HEIC" };
    case "tif": case "tiff": return { ok: starts(0x49, 0x49, 0x2a, 0) || starts(0x4d, 0x4d, 0, 0x2a), reason: "No és una imatge TIFF" };
    case "docx": case "xlsx": case "odt": case "ods": case "zip": return { ok: starts(0x50, 0x4b, 0x03, 0x04), zip: true, reason: "El fitxer no té l'estructura esperada" };
    case "doc": case "xls": case "msg": return { ok: starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), reason: "El fitxer no té el format d'Office esperat" };
    case "csv": case "txt": case "eml": return { ok: !b.slice(0, 8192).includes(0), reason: "El fitxer no és text" };
    default: return { ok: false, reason: "Tipus de fitxer no admès" };
  }
}

/** Contingut esperat dins del ZIP per als formats Office/OpenDocument. */
export function zipKindOk(ext: string, entries: string[], mimetype: string | null): boolean {
  if (ext === "docx") return entries.includes("[Content_Types].xml") && entries.some((e) => e.startsWith("word/"));
  if (ext === "xlsx") return entries.includes("[Content_Types].xml") && entries.some((e) => e.startsWith("xl/"));
  if (ext === "odt") return mimetype === "application/vnd.oasis.opendocument.text";
  if (ext === "ods") return mimetype === "application/vnd.oasis.opendocument.spreadsheet";
  return true; // zip genèric
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

/** Data fins a la qual s'ha de conservar un document segons la categoria. */
export function retainUntil(category: DocCategory, from = new Date()): string | null {
  const y = RETENTION_YEARS[category];
  if (!y) return null;
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + y);
  return d.toISOString().slice(0, 10);
}
