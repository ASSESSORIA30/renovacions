/**
 * CAPTACIÓ (Fase 6) · nucli pur (sense xarxa ni base de dades; sense node:crypto perquè també el fa servir el navegador).
 *
 *  · Dades corporatives configurables i textos de privacitat versionats.
 *  · Validació del formulari públic, antispam i limitació de peticions.
 *  · Detecció de fitxers perillosos (contingut real, PDF amb codi actiu).
 *  · Duplicats per CUPS, NIF, telèfon i correu (mai fusió automàtica).
 *  · Atribució a col·laboradors i assignació automàtica de leads (regles deterministes).
 *  · Normalització de la lectura de factures (valor, unitat, pàgina, estat i observacions).
 *  · Indicadors de l'embut amb estat «conegut / estimat / no disponible».
 */
import { pdfHeaderOffset } from "./pdf-sniff";
import { z } from "zod";
import { normalizeTariff, periodsOf } from "@/comparator/engine";
import type { InvoiceData, Field } from "@/comparator/invoice";
import { validTaxId } from "@/comparator/invoice";
import type { PriceSheet, SupplyInput } from "@/comparator/types";

/* ================================================================== dades corporatives */

const pub = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined);
/** Valors facilitats per Direcció al prompt de la Fase 6. No n'hi havia cap de configurat al projecte: es poden
 *  sobreescriure amb variables d'entorn i cal confirmar-los (NEXT_PUBLIC_COMPANY_VERIFIED=true) abans de publicar. */
export const COMPANY = {
  legalName: pub("NEXT_PUBLIC_COMPANY_LEGAL_NAME") || "Assessoria 3.0 AE, SL",
  brand: "Assessoria 3.0",
  web: pub("NEXT_PUBLIC_COMPANY_WEB") || "www.assessoria30.com",
  address: pub("NEXT_PUBLIC_COMPANY_ADDRESS") || "Av. Garrigues, 21, local 1, Lleida",
  phone: pub("NEXT_PUBLIC_COMPANY_PHONE") || "973 982 852",
  email: pub("NEXT_PUBLIC_COMPANY_EMAIL") || "",
  whatsapp: pub("NEXT_PUBLIC_COMPANY_WHATSAPP") || "",
  taxId: pub("NEXT_PUBLIC_COMPANY_TAX_ID") || "",
  privacyEmail: pub("NEXT_PUBLIC_COMPANY_PRIVACY_EMAIL") || "",
  since: 2013,
  verified: pub("NEXT_PUBLIC_COMPANY_VERIFIED") === "true",
};
export const phoneHref = (p: string) => `tel:+34${p.replace(/\D/g, "").replace(/^34/, "")}`;
export const waHref = (p: string, text = "") => `https://wa.me/34${p.replace(/\D/g, "").replace(/^34/, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

/* ================================================================== privacitat i consentiments */

export const CONSENT_VERSION = "2026-11-v1";
export const CONSENT_TEXTS = {
  privacitat_servei: `He llegit la informació de privacitat i accepto que ${COMPANY.legalName} tracti les meves dades i la factura per estudiar el meu subministrament i respondre la sol·licitud.`,
  comercial: `Vull rebre comunicacions comercials d'${COMPANY.brand} sobre estalvi i serveis energètics (opcional; ho puc retirar quan vulgui).`,
  whatsapp: `Accepto que em contacteu per WhatsApp en relació amb aquesta sol·licitud.`,
} as const;
export type ConsentKind = keyof typeof CONSENT_TEXTS;

/* ================================================================== canals */

export const CHANNELS = ["web", "formulari", "factura", "google_ads", "meta_ads", "whatsapp", "collaborador", "qr", "recomanacio", "comercial"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  web: "Web", formulari: "Formulari", factura: "Pujada de factura", google_ads: "Google Ads", meta_ads: "Meta Ads", whatsapp: "WhatsApp",
  collaborador: "Portal de col·laboradors", qr: "Codi QR", recomanacio: "Enllaç de recomanació", comercial: "Captació comercial directa",
};
export const PARTNER_KINDS = { electricista: "Electricista", fotovoltaica: "Instal·lador fotovoltaic", gas: "Instal·lador de gas", immobiliaria: "Immobiliària", administrador_finques: "Administrador de finques", gestoria: "Gestoria", corredoria: "Corredoria d'assegurances", altres: "Altres" } as const;
export type PartnerKind = keyof typeof PARTNER_KINDS;

export interface Utm { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null }
const clip = (v: unknown, n = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
export function parseUtm(p: URLSearchParams | Record<string, string | undefined>): Utm {
  const g = (k: string) => (p instanceof URLSearchParams ? p.get(k) : p[k]) ?? null;
  return { source: clip(g("utm_source")), medium: clip(g("utm_medium")), campaign: clip(g("utm_campaign")), content: clip(g("utm_content")), term: clip(g("utm_term")) };
}

/** Canal a partir del que se sap al servidor (enllaç de col·laborador, UTM, identificadors de clic, factura). */
export function resolveChannel(x: { linkChannel?: "recomanacio" | "qr" | "collaborador" | null; utm?: Utm | null; gclid?: string | null; fbclid?: string | null; withInvoice: boolean; forced?: Channel | null }): Channel {
  if (x.forced) return x.forced;
  if (x.linkChannel) return x.linkChannel;
  const s = (x.utm?.source ?? "").toLowerCase();
  if (x.gclid || /google|adwords/.test(s)) return "google_ads";
  if (x.fbclid || /facebook|instagram|meta|\bfb\b|\big\b/.test(s)) return "meta_ads";
  return x.withInvoice ? "factura" : "formulari";
}

/* ================================================================== formulari públic */

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = `+${d.slice(2)}`;
  if (d.startsWith("+34")) d = d.slice(3);
  else if (d.startsWith("34") && d.length === 11) d = d.slice(2);
  if (/^[6789]\d{8}$/.test(d)) return `+34${d}`;
  if (/^\+\d{8,15}$/.test(d)) return d;
  return null;
}
export const normalizeEmail = (e: string | null | undefined) => (e && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e.trim()) ? e.trim().toLowerCase() : null);

export const REF_RE = /^[A-Z0-9]{4,16}$/;
export const publicFormSchema = z.object({
  idempotencyKey: z.string().uuid("Clau d'enviament no vàlida"),
  name: z.string().trim().min(2, "Indica el teu nom").max(120),
  phone: z.string().trim().max(30).transform((v, ctx) => { const n = normalizePhone(v); if (!n) ctx.addIssue({ code: "custom", message: "Telèfon no vàlid" }); return n ?? ""; }),
  email: z.string().trim().max(160).transform((v, ctx) => { const n = normalizeEmail(v); if (!n) ctx.addIssue({ code: "custom", message: "Correu no vàlid" }); return n ?? ""; }),
  customerKind: z.enum(["particular", "empresa"]),
  energyType: z.enum(["luz", "gas"]),
  // Fase 7: altres serveis que també interessen al client (fibra i telefonia, assegurances, alarmes)
  extraServices: z.preprocess((v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : v ?? []), z.array(z.enum(["fibra_telefonia", "assegurances", "alarmes"])).max(3)).optional().default([]),
  notes: z.string().trim().max(1000).optional().default(""),
  province: z.string().trim().max(60).optional().default(""),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: "Cal acceptar la informació de privacitat per poder estudiar la factura" }) }),
  acceptCommercial: z.boolean().default(false),
  acceptWhatsapp: z.boolean().default(false),
  ref: z.string().trim().toUpperCase().max(16).optional().default("").refine((v) => !v || REF_RE.test(v), "Codi de referència no vàlid"),
  utm: z.object({ source: z.string().max(120).nullish(), medium: z.string().max(120).nullish(), campaign: z.string().max(120).nullish(), content: z.string().max(120).nullish(), term: z.string().max(120).nullish() }).partial().optional(),
  gclid: z.string().max(200).optional().default(""),
  fbclid: z.string().max(200).optional().default(""),
  website: z.string().max(200).optional().default(""),      // camp parany (els humans no el veuen)
  startedAt: z.coerce.number().int().optional(),
});
export type PublicForm = z.infer<typeof publicFormSchema>;
/** Canals externs (Meta Lead Ads, WhatsApp): pot faltar el correu o el telèfon; no s'inventen. */
export const relaxedFormSchema = publicFormSchema.extend({
  phone: z.string().trim().max(30).optional().default("").transform((v) => normalizePhone(v) ?? ""),
  email: z.string().trim().max(160).optional().default("").transform((v) => normalizeEmail(v) ?? ""),
}).refine((f) => f.phone || f.email, { message: "Cal almenys un telèfon o un correu", path: ["phone"] });

/** Antispam: parany, temps mínim d'emplenament, enllaços i patrons típics. Retorna els motius (buit = correcte). */
export function spamReasons(f: Pick<PublicForm, "website" | "notes" | "name" | "startedAt">, now = Date.now()): string[] {
  const r: string[] = [];
  if (f.website) r.push("camp_parany");
  if (f.startedAt && now - f.startedAt < 2500) r.push("massa_rapid");
  if (f.startedAt && f.startedAt > now + 60_000) r.push("rellotge_invalid");
  if ((f.notes.match(/https?:\/\//gi) ?? []).length > 2) r.push("massa_enllacos");
  if (/https?:\/\/|www\./i.test(f.name)) r.push("enllac_al_nom");
  if (/(viagra|casino|crypto|bitcoin|seo services|backlinks)/i.test(`${f.name} ${f.notes}`)) r.push("paraules_spam");
  return r;
}

export const RATE = { perIp10min: 5, perIpDay: 20, perContactDay: 3 };
export function rateDecision(c: { ip10min: number; ipDay: number; contactDay: number }): { ok: boolean; reason: string | null } {
  if (c.ip10min >= RATE.perIp10min) return { ok: false, reason: "Massa enviaments seguits. Torna-ho a provar d'aquí a uns minuts." };
  if (c.ipDay >= RATE.perIpDay) return { ok: false, reason: "S'ha arribat al límit d'enviaments d'avui des d'aquesta connexió." };
  if (c.contactDay >= RATE.perContactDay) return { ok: false, reason: "Ja hem rebut diverses sol·licituds amb aquestes dades avui. Et contactarem aviat." };
  return { ok: true, reason: null };
}

/* ================================================================== fitxers */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export type DocMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
export const ACCEPTED_MIME: DocMime[] = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const EXT: Record<DocMime, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Tipus real pels bytes (no per l'extensió ni pel MIME declarat). */
export function sniffDocument(b: Uint8Array): DocMime | null {
  if (b.length < 12) return null;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (pdfHeaderOffset(b) > 0) return "application/pdf"; // PDF amb bytes previs admesos (es normalitza en llegir-lo)
  return null;
}

/** PDF amb contingut actiu (JavaScript, accions d'execució, fitxers incrustats, multimèdia): es rebutja. */
export function pdfActiveContent(b: Uint8Array): string[] {
  let s = "";
  for (let i = 0; i < b.length; i += 65536) s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 65536)));
  const found: string[] = [];
  for (const [re, label] of [[/\/JavaScript\b/, "JavaScript"], [/\/JS\s*[(<\[]/, "JavaScript"], [/\/Launch\b/, "acció Launch"], [/\/EmbeddedFiles?\b/, "fitxers incrustats"], [/\/RichMedia\b/, "multimèdia"], [/\/SubmitForm\b/, "enviament de formulari"]] as const) {
    if (re.test(s) && !found.includes(label)) found.push(label);
  }
  return found;
}

export function checkUpload(b: Uint8Array, declaredName: string): { ok: true; mime: DocMime } | { ok: false; error: string } {
  if (!b.byteLength) return { ok: false, error: "El fitxer és buit" };
  if (b.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "El fitxer supera els 10 MB" };
  const mime = sniffDocument(b);
  if (!mime) return { ok: false, error: "Format no admès: puja un PDF, JPG, PNG o WebP" };
  if (/\.(exe|js|bat|cmd|sh|html?|svg|zip|docm|xlsm)$/i.test(declaredName)) return { ok: false, error: "Tipus de fitxer no admès" };
  if (mime === "application/pdf") {
    const act = pdfActiveContent(b);
    if (act.length) return { ok: false, error: `El PDF conté elements no permesos (${act.join(", ")}). Envia la factura original de la comercialitzadora o una foto.` };
  }
  return { ok: true, mime };
}
export const safeName = (n: string) => n.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(0, 120) || "factura";

/* ================================================================== duplicats */

export interface DupRow { kind: "lead" | "client" | "subministrament"; id: string; name?: string | null; phone?: string | null; email?: string | null; tax_id?: string | null; cups?: string | null; client_id?: string | null }
export interface DupRef { kind: DupRow["kind"]; id: string; name: string | null; by: ("cups" | "nif" | "telefon" | "correu")[]; strength: "fort" | "feble"; client_id: string | null }
const cups20 = (c: string | null | undefined) => (c ? c.toUpperCase().replace(/\s/g, "").slice(0, 20) : null);
const taxNorm = (t: string | null | undefined) => (t ? t.toUpperCase().replace(/[\s\-.]/g, "") : null);

/** Coincidències per CUPS i NIF (fortes) o telèfon i correu (febles). Mai es fusiona automàticament. */
export function matchDuplicates(c: { phone?: string | null; email?: string | null; tax_id?: string | null; cups?: string | null }, rows: DupRow[]): DupRef[] {
  const out: DupRef[] = [];
  const p = normalizePhone(c.phone), e = normalizeEmail(c.email), t = taxNorm(c.tax_id), k = cups20(c.cups);
  for (const r of rows) {
    const by: DupRef["by"] = [];
    if (k && cups20(r.cups) === k) by.push("cups");
    if (t && taxNorm(r.tax_id) === t) by.push("nif");
    if (p && normalizePhone(r.phone) === p) by.push("telefon");
    if (e && normalizeEmail(r.email) === e) by.push("correu");
    if (by.length) out.push({ kind: r.kind, id: r.id, name: r.name ?? null, by, strength: by.includes("cups") || by.includes("nif") ? "fort" : "feble", client_id: r.client_id ?? (r.kind === "client" ? r.id : null) });
  }
  return out.sort((a, b) => (a.strength === b.strength ? b.by.length - a.by.length : a.strength === "fort" ? -1 : 1));
}

/* ================================================================== atribució */

export interface ExistingAttribution { partner_id: string; status: "vigent" | "en_disputa" | "rebutjada" | "substituida"; created_at: string }
/**
 * Regla: el primer col·laborador que aporta el lead (o la persona, si és un duplicat recent) queda com a vigent.
 * Si un altre col·laborador aporta la mateixa persona dins la finestra, queda «en disputa» per a Direcció.
 * Fora de la finestra (lead antic sense activitat), la nova aportació és vigent per al lead nou.
 */
export function resolveAttribution(existing: ExistingAttribution[], partnerId: string | null, now: Date, windowDays = 90): "vigent" | "en_disputa" | "ja_existeix" | "cap" {
  if (!partnerId) return "cap";
  if (existing.some((a) => a.partner_id === partnerId && a.status !== "rebutjada")) return "ja_existeix";
  const live = existing.filter((a) => a.status === "vigent" && now.getTime() - Date.parse(a.created_at) <= windowDays * 86_400_000);
  return live.length ? "en_disputa" : "vigent";
}

/* ================================================================== assignació */

export interface AssignRule { id: string; name: string; priority: number; active: boolean; conditions: { provinces?: string[]; cities?: string[]; energy?: ("luz" | "gas")[]; customer_kinds?: string[]; channels?: string[]; partner_ids?: string[]; min_kwh?: number | null; max_kwh?: number | null }; strategy: "usuari" | "rotatiu" | "menys_carrega"; user_ids: string[]; max_open_leads: number | null }
export interface LeadFacts { province: string | null; city: string | null; energy: "luz" | "gas" | null; customerKind: string | null; channel: string | null; partnerId: string | null; partnerUserOwner?: string | null; annualKwh: number | null }
const nrm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export function ruleMatches(r: AssignRule, l: LeadFacts): boolean {
  const c = r.conditions ?? {};
  if (c.provinces?.length && !c.provinces.some((p) => nrm(p) === nrm(l.province))) return false;
  if (c.cities?.length && !c.cities.some((p) => nrm(p) === nrm(l.city))) return false;
  if (c.energy?.length && (!l.energy || !c.energy.includes(l.energy))) return false;
  if (c.customer_kinds?.length && (!l.customerKind || !c.customer_kinds.includes(l.customerKind))) return false;
  if (c.channels?.length && (!l.channel || !c.channels.includes(l.channel))) return false;
  if (c.partner_ids?.length && (!l.partnerId || !c.partner_ids.includes(l.partnerId))) return false;
  if (c.min_kwh != null && (l.annualKwh == null || l.annualKwh < c.min_kwh)) return false;
  if (c.max_kwh != null && (l.annualKwh == null || l.annualKwh > c.max_kwh)) return false;
  return true;
}

/** Tria el responsable. `workload` = leads oberts per usuari; `lastByRule` = últim usuari assignat per cada regla (rotatiu). */
export function pickAssignee(rules: AssignRule[], l: LeadFacts, workload: Record<string, number>, lastByRule: Record<string, string | null>, activeUsers: Set<string>): { userId: string | null; ruleId: string | null; method: "regla" | "sense_assignar"; reason: string } {
  for (const r of [...rules].filter((x) => x.active).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))) {
    if (!ruleMatches(r, l)) continue;
    const users = r.user_ids.filter((u) => activeUsers.has(u) && (r.max_open_leads == null || (workload[u] ?? 0) < r.max_open_leads));
    if (!users.length) continue;
    let pick: string;
    if (r.strategy === "usuari") pick = users[0];
    else if (r.strategy === "rotatiu") { const i = users.indexOf(lastByRule[r.id] ?? ""); pick = users[(i + 1) % users.length]; }
    else pick = [...users].sort((a, b) => (workload[a] ?? 0) - (workload[b] ?? 0) || users.indexOf(a) - users.indexOf(b))[0];
    return { userId: pick, ruleId: r.id, method: "regla", reason: `Regla «${r.name}» (${r.strategy === "usuari" ? "usuari fix" : r.strategy === "rotatiu" ? "rotació" : "menys càrrega de treball"})` };
  }
  return { userId: null, ruleId: null, method: "sense_assignar", reason: "Cap regla aplicable o cap comercial disponible: pendent d'assignació manual" };
}

/* ================================================================== lectura de factures */

export type ReadStatus = "llegit" | "per_revisar" | "pendent" | "revisat";
export interface ReadField { key: string; label: string; value: string | number | null; unit: string | null; page: number | null; status: ReadStatus; method: "text" | "ia" | "manual" | null; note: string | null }

const DEF: [keyof InvoiceData, string, string | null][] = [
  ["holder", "Titular", null], ["taxId", "NIF/CIF", null], ["address", "Adreça del subministrament", null], ["cups", "CUPS", null],
  ["retailer", "Comercialitzadora", null], ["accessTariff", "Tarifa d'accés", null], ["energyType", "Tipus d'energia", null],
  ["periodFrom", "Inici del període", "data"], ["periodTo", "Fi del període", "data"], ["days", "Dies facturats", "dies"],
  ["gasFixedEurDay", "Terme fix de gas", "€/dia"], ["sasEurKwh", "Mecanisme d'ajust (SAS)", "€/kWh"], ["meterRentEur", "Lloguer del comptador", "€ (sense impostos)"],
  ["discounts", "Descomptes", null], ["services", "Serveis addicionals", null], ["permanence", "Permanència", null],
  ["ieeEur", "Impost elèctric / hidrocarburs", "€ (impost)"], ["vatEur", "IVA", "€ (impost)"], ["total", "Total de la factura", "€ (amb impostos)"],
];
const PER: [keyof InvoiceData, string, string][] = [["kwh", "Consum", "kWh"], ["kw", "Potència contractada", "kW"], ["energyPrice", "Preu d'energia", "€/kWh (sense impostos)"], ["powerPrice", "Preu de potència", "€/kW·dia (sense impostos)"]];

/** CUPS: ES + 16 xifres + 2 lletres de control (mòdul 529). */
export function validCups(c: string | null | undefined): boolean {
  const s = (c ?? "").toUpperCase().replace(/\s/g, "");
  const m = /^ES(\d{16})([A-Z]{2})([0-9][A-Z])?$/.exec(s);
  if (!m) return false;
  const L = "TRWAGMYFPDXBNJZSQVHLCKE";
  const r = Number(BigInt(m[1]) % 529n);
  return L[Math.floor(r / 23)] + L[r % 23] === m[2];
}

/**
 * Converteix la sortida validada del lector existent en camps normalitzats amb unitat, pàgina, estat i observacions,
 * i comprova la coherència (CUPS, NIF, dates, dies, tarifa i tipus d'energia, imports amb/sense impostos).
 * Res que no aparegui a la factura s'omple: queda «pendent».
 */
export function normalizeReading(d: InvoiceData): { fields: ReadField[]; warnings: string[] } {
  const fields: ReadField[] = [];
  const warnings: string[] = [];
  const push = (key: string, label: string, f: Field<unknown>, unit: string | null, note: string | null = null) =>
    fields.push({ key, label, value: (f.value as string | number | null) ?? null, unit, page: f.page, status: f.value == null ? "pendent" : f.confirm ? "per_revisar" : "llegit", method: f.value == null ? null : f.method, note });
  for (const [k, label, unit] of DEF) push(k, label, d[k] as Field<unknown>, unit);
  const gas = d.energyType.value === "gas" || /^RL/.test(String(d.accessTariff.value ?? ""));
  const per = periodsOf(normalizeTariff(d.accessTariff.value), gas ? "gas" : "luz");
  for (const [k, label, unit] of PER) {
    if (gas && (k === "kw" || k === "powerPrice")) continue;
    const n = k === "kwh" || k === "energyPrice" ? (gas ? 1 : per.energy) : per.power;
    (d[k] as Field<unknown>[]).slice(0, per.known ? n : 6).forEach((f, i) => push(`${k}.P${i + 1}`, `${label} P${i + 1}`, f, unit));
  }
  const byKey = (k: string) => fields.find((f) => f.key === k)!;
  const flag = (k: string, note: string) => { const f = byKey(k); if (f && f.value != null) { f.status = "per_revisar"; f.note = note; } warnings.push(`${f?.label ?? k}: ${note}`); };
  if (d.cups.value && !validCups(d.cups.value)) flag("cups", "Les lletres de control del CUPS no quadren");
  if (d.taxId.value && !validTaxId(d.taxId.value)) flag("taxId", "La lletra de control del NIF/NIE no és vàlida");
  if (d.periodFrom.value && d.periodTo.value) {
    if (d.periodFrom.value > d.periodTo.value) flag("periodTo", "La data final és anterior a la inicial");
    else if (d.days.value) {
      const span = Math.round((Date.parse(d.periodTo.value) - Date.parse(d.periodFrom.value)) / 86_400_000);
      if (Math.abs(span - d.days.value) > 2) flag("days", `No quadra amb les dates (${span} dies entre l'inici i el final)`);
    }
  }
  if (d.energyType.value === "luz" && /^RL/.test(String(d.accessTariff.value ?? ""))) flag("accessTariff", "Tarifa de gas en una factura marcada com d'electricitat");
  if (d.energyType.value === "gas" && /TD$/.test(String(d.accessTariff.value ?? ""))) flag("accessTariff", "Tarifa d'electricitat en una factura marcada com de gas");
  if (d.total.value != null && d.vatEur.value != null && d.vatEur.value >= d.total.value) flag("vatEur", "L'IVA no pot ser superior al total: possible confusió entre import amb i sense impostos");
  if (d.total.value != null && d.vatEur.value != null && d.total.value > 0) {
    const vatPct = (d.vatEur.value / (d.total.value - d.vatEur.value)) * 100;
    if (vatPct > 22 || vatPct < 4) flag("vatEur", `L'IVA representa el ${vatPct.toFixed(1)} % de la base: revisa si el total inclou impostos`);
  }
  for (const f of fields) if (f.unit?.startsWith("€/kWh") && typeof f.value === "number" && f.value > 1) { f.status = "per_revisar"; f.note = "Preu d'energia anormalment alt: revisa la unitat"; }
  return { fields, warnings };
}

/** Aplica les correccions d'una persona (camp revisat → estat «revisat», mètode «manual»). */
export function applyReview(fields: ReadField[], patch: Record<string, string | number | null>): ReadField[] {
  return fields.map((f) => (f.key in patch ? { ...f, value: patch[f.key], status: patch[f.key] == null ? "pendent" : "revisat", method: "manual", note: f.note } : f));
}

const val = (fields: ReadField[], k: string) => fields.find((f) => f.key === k)?.value ?? null;
const numv = (fields: ReadField[], k: string) => { const v = val(fields, k); return typeof v === "number" ? v : v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null; };

/**
 * Entrades per a la comparativa preliminar. Requereix tarifa, consum per període i potència (llum) o consum (gas) i dies.
 * El consum s'ANUALITZA a partir dels dies facturats (hipòtesi explícita). Els preus actuals són opcionals:
 * sense preus, no hi ha cost actual (no s'inventa).
 */
export function readingToComparison(fields: ReadField[]): { ok: boolean; missing: string[]; doubtful: string[]; supply: SupplyInput | null; current: PriceSheet | null; hypotheses: string[]; cups: string | null; retailer: string | null } {
  const tariff = normalizeTariff(val(fields, "accessTariff") as string | null);
  const gas = val(fields, "energyType") === "gas" || /^RL/.test(tariff ?? "");
  const per = periodsOf(tariff, gas ? "gas" : "luz");
  const missing: string[] = [];
  const days = numv(fields, "days");
  if (!tariff || !per.known) missing.push("Tarifa d'accés");
  if (!days) missing.push("Dies facturats");
  const kwh = Array.from({ length: gas ? 1 : per.energy }, (_, i) => numv(fields, `kwh.P${i + 1}`));
  if (kwh.some((x) => x == null)) missing.push("Consum per períodes");
  const kw = gas ? [] : Array.from({ length: per.power }, (_, i) => numv(fields, `kw.P${i + 1}`));
  if (!gas && kw.some((x) => x == null)) missing.push("Potències contractades");
  const used = ["accessTariff", "days", ...kwh.map((_, i) => `kwh.P${i + 1}`), ...kw.map((_, i) => `kw.P${i + 1}`)];
  const doubtful = fields.filter((f) => used.includes(f.key) && f.status === "per_revisar").map((f) => f.label);
  const base = { cups: (val(fields, "cups") as string | null) ?? null, retailer: (val(fields, "retailer") as string | null) ?? null };
  if (missing.length) return { ok: false, missing, doubtful, supply: null, current: null, hypotheses: [], ...base };
  const factor = 365 / days!;
  const supply: SupplyInput = {
    energyType: gas ? "gas" : "luz", accessTariff: tariff, territory: "peninsula", segment: null, days: 365, basis: "anualitzat",
    kwh: kwh.map((x) => Math.round(x! * factor)), kwhTotal: Math.round(kwh.reduce<number>((a, b) => a + b!, 0) * factor), kw: kw as number[], meterRentEurMonth: null,
    sources: { kwh: "factura", kw: "factura", prices: "factura" },
  };
  const ep = Array.from({ length: gas ? 1 : per.energy }, (_, i) => numv(fields, `energyPrice.P${i + 1}`));
  const pp = gas ? [] : Array.from({ length: per.power }, (_, i) => numv(fields, `powerPrice.P${i + 1}`));
  const gf = numv(fields, "gasFixedEurDay");
  const pricesKnown = ep.every((x) => x != null) && (gas ? gf != null : pp.every((x) => x != null));
  const current: PriceSheet | null = pricesKnown ? {
    contractType: ep.length === 1 ? "fix24h" : "periodes", energy: ep.length === 1 ? [] : ep, energy24h: ep.length === 1 ? ep[0] : null, power: pp, powerUnit: "eur_kw_dia",
    gasFixedEurDay: gas ? gf : null, taxTreatment: "sense_impostos", sas: { mode: numv(fields, "sasEurKwh") != null ? "variable" : "exclos", eurKwh: numv(fields, "sasEurKwh") }, fees: [], discounts: [],
  } : null;
  const hypotheses = [
    `Consum anualitzat a partir d'una factura de ${days} dies (×${factor.toFixed(2)}); no té en compte l'estacionalitat.`,
    "Dades llegides de la factura" + (doubtful.length ? `; pendents de revisar: ${doubtful.join(", ")}.` : "."),
    pricesKnown ? "Preus actuals llegits de la factura (sense impostos)." : "Preus actuals no llegits: el cost actual i l'estalvi queden pendents de factura o condicions actuals.",
  ];
  return { ok: true, missing: [], doubtful, supply, current, hypotheses, ...base };
}

/* ================================================================== codis de referència */

export function refCodeFrom(name: string, rnd: () => number = Math.random): string {
  const letters = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "COL";
  const digits = Array.from({ length: 4 }, () => Math.floor(rnd() * 10)).join("");
  return `${letters}${digits}`.slice(0, 16);
}
export const referralUrl = (base: string, code: string) => `${base.replace(/\/$/, "")}/estudi?ref=${encodeURIComponent(code)}`;

/* ================================================================== WhatsApp */

export const WA_STATUS: Record<string, "enviat" | "lliurat" | "llegit" | "fallit"> = { sent: "enviat", delivered: "lliurat", read: "llegit", failed: "fallit" };
/** Missatges lliures només dins les 24 h posteriors a l'últim missatge del client; fora, cal una plantilla aprovada. */
export function waWindowOpen(lastInboundAt: string | null, now = Date.now()) { return !!lastInboundAt && now - Date.parse(lastInboundAt) < 24 * 3600_000; }

/* ================================================================== indicadors de l'embut */

export type KpiStatus = "conegut" | "estimat" | "no_disponible";
export interface Kpi { key: string; label: string; value: number | null; unit: "nombre" | "eur" | "mwh" | "pct"; status: KpiStatus; note: string | null }

export interface FunnelInput {
  visits: number | null; started: number | null; submitted: number; invoices: number; validLeads: number; opportunities: number; proposalsSent: number; contractsActivated: number;
  mwhWon: number | null; commissionsEstimated: number | null; commissionsConfirmed: number | null; cost: number | null; costComplete: boolean;
}
export function funnelKpis(f: FunnelInput): Kpi[] {
  const k = (key: string, label: string, value: number | null, unit: Kpi["unit"], status: KpiStatus, note: string | null = null): Kpi => ({ key, label, value: status === "no_disponible" ? null : value, unit, status, note });
  const tracking = f.visits != null;
  const out: Kpi[] = [
    k("visites", "Visites de la landing", f.visits, "nombre", tracking ? "conegut" : "no_disponible", tracking ? "Sessions úniques, sense cookies de tercers" : "Sense mesura de visites"),
    k("iniciats", "Formularis iniciats", f.started, "nombre", f.started != null ? "conegut" : "no_disponible"),
    k("enviats", "Formularis enviats", f.submitted, "nombre", "conegut"),
    k("factures", "Factures rebudes", f.invoices, "nombre", "conegut"),
    k("leads_valids", "Leads vàlids", f.validLeads, "nombre", "conegut", "Sense spam, rebutjats ni duplicats confirmats"),
    k("oportunitats", "Oportunitats generades", f.opportunities, "nombre", "conegut"),
    k("propostes", "Propostes enviades", f.proposalsSent, "nombre", "conegut", "Enviament confirmat o registrat a l'oportunitat"),
    k("contractes", "Contractes activats", f.contractsActivated, "nombre", "conegut"),
    k("mwh", "MWh captats", f.mwhWon, "mwh", f.mwhWon != null ? "conegut" : "no_disponible", "Consum anual de les oportunitats guanyades"),
    k("comissions", "Comissions atribuïbles", f.commissionsConfirmed ?? f.commissionsEstimated, "eur", f.commissionsConfirmed != null ? "conegut" : f.commissionsEstimated != null ? "estimat" : "no_disponible", f.commissionsConfirmed != null ? "Confirmades o cobrades (Fase 4)" : "Estimades amb regles de la Fase 4; no cobrades"),
    k("cost", "Cost de captació", f.cost, "eur", f.cost == null ? "no_disponible" : f.costComplete ? "conegut" : "estimat", f.cost == null ? "Sense costos importats (API o registre manual)" : f.costComplete ? null : "Costos parcials: alguns dies o campanyes sense dades"),
  ];
  const cpl = f.cost != null && f.validLeads > 0 ? Math.round((f.cost / f.validLeads) * 100) / 100 : null;
  const cpc = f.cost != null && f.contractsActivated > 0 ? Math.round((f.cost / f.contractsActivated) * 100) / 100 : null;
  out.push(k("cpl", "Cost per lead", cpl, "eur", cpl == null ? "no_disponible" : f.costComplete ? "conegut" : "estimat"));
  out.push(k("cpa", "Cost per client captat", cpc, "eur", cpc == null ? "no_disponible" : f.costComplete ? "conegut" : "estimat"));
  const comm = f.commissionsConfirmed ?? f.commissionsEstimated;
  const roi = f.cost != null && comm != null ? Math.round((comm - f.cost) * 100) / 100 : null;
  out.push(k("rendibilitat", "Rendibilitat (comissions − cost)", roi, "eur", roi == null ? "no_disponible" : f.commissionsConfirmed != null && f.costComplete ? "conegut" : "estimat"));
  return out;
}
