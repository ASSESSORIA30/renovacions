/**
 * COL·LABORADORS · importació i percentatges (lògica pura).
 *  - Llegeix les capçaleres habituals (Nombre, Apellidos, DNI, Email, Teléfono, Dirección, Localidad, Provincia,
 *    Código Postal, Etiqueta, Creado En, Representante) amb o sense accents, en català o castellà.
 *  - Normalitza les dades, distingeix persona física/jurídica i proposa una acció per fila; mai fusiona per si sol.
 *  - El percentatge del col·laborador s'aplica sobre la COMISSIÓ que cobra Assessoria 3.0 (no sobre consum ni factura).
 */
import { D, money } from "./commissions";
import { normName, validTaxId } from "./billing";

export const LEVEL_KEYS = ["n1", "n2", "n3"] as const;
export type LevelKey = (typeof LEVEL_KEYS)[number];
export type Levels = Record<LevelKey, { label: string; pct: number }>;
export const DEFAULT_LEVELS: Levels = { n1: { label: "Nivell 1", pct: 70 }, n2: { label: "Nivell 2", pct: 50 }, n3: { label: "Nivell 3", pct: 30 } };

export function cleanLevels(raw: unknown): Levels {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, { label?: unknown; pct?: unknown }>;
  const out = { ...DEFAULT_LEVELS };
  for (const k of LEVEL_KEYS) {
    const pct = Number(o[k]?.pct);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) out[k] = { label: typeof o[k]?.label === "string" && o[k]!.label ? String(o[k]!.label) : DEFAULT_LEVELS[k].label, pct };
  }
  return out;
}
/** Nivell que correspon a un percentatge (si no coincideix amb cap, és personalitzat). */
export const levelOf = (pct: number | string, levels: Levels): LevelKey | "personalitzat" => LEVEL_KEYS.find((k) => D(levels[k].pct).eq(D(pct))) ?? "personalitzat";
export const validPct = (v: string | number) => { const s = String(v).replace(",", ".").trim(); return /^\d{1,3}(\.\d{1,4})?$/.test(s) && Number(s) >= 0 && Number(s) <= 100; };

/** Repartiment: part del col·laborador i part que queda per a Assessoria 3.0 (sense arrodonir dues vegades). */
export function splitCommission(base: string | number, pct: string | number) {
  const collaborator = money(D(base).times(D(pct)).div(100));
  return { base: money(D(base)), pct: D(pct).toString(), collaborator, remainder: money(D(base).minus(collaborator)) };
}

/* ======================================================================= importació */

export const IMPORT_FIELDS = {
  name: ["NOMBRE", "NOM", "NAME"],
  lastName: ["APELLIDOS", "COGNOMS", "APELLIDO", "COGNOM"],
  taxId: ["DNI", "NIF", "CIF", "DNICIF", "NIFCIF", "DOCUMENTO", "DOCUMENT"],
  email: ["EMAIL", "CORREO", "CORREU", "EMAILADDRESS", "MAIL"],
  phone: ["TELEFONO", "TELEFON", "MOVIL", "MOBIL", "PHONE"],
  address: ["DIRECCION", "ADRECA", "DOMICILIO", "DOMICILI"],
  city: ["LOCALIDAD", "POBLACIO", "POBLACION", "MUNICIPIO", "MUNICIPI", "CIUDAD", "CIUTAT"],
  province: ["PROVINCIA"],
  postalCode: ["CODIGOPOSTAL", "CODIPOSTAL", "CP"],
  label: ["ETIQUETA", "TIPO", "TIPUS", "ROL"],
  createdAt: ["CREADOEN", "CREATEDAT", "FECHAALTA", "DATAALTA", "CREAT"],
  representative: ["REPRESENTANTE", "REPRESENTANT", "RESPONSABLE"],
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;

/** Correspondència capçalera → camp. */
export function mapHeaders(headers: string[]) {
  const map: Partial<Record<ImportField, string>> = {};
  for (const h of headers) {
    const n = normName(h);
    for (const [f, syn] of Object.entries(IMPORT_FIELDS) as [ImportField, readonly string[]][]) if (!map[f] && syn.includes(n)) map[f] = h;
  }
  return { map, missing: (["name", "email"] as ImportField[]).filter((f) => !map[f]), unknown: headers.filter((h) => !Object.values(map).includes(h)) };
}

/**
 * Converteix una pestanya (files com a llistes) en registres. La fila de capçaleres pot no ser la primera (títols o
 * files buides a dalt): es busca entre les 20 primeres la que té més columnes reconegudes (com a mínim nom i correu).
 */
export function rowsFromGrid(grid: unknown[][]): { rows: Record<string, unknown>[]; headerRow: number | null } {
  let best = -1, bestScore = 0;
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const heads = (grid[r] ?? []).map((c) => (c == null ? "" : String(c).trim()));
    const { map } = mapHeaders(heads.filter(Boolean));
    const score = Object.keys(map).length;
    if (map.name && map.email && score > bestScore) { best = r; bestScore = score; }
  }
  if (best < 0) return { rows: [], headerRow: null };
  const heads = (grid[best] ?? []).map((c, i) => (c == null || String(c).trim() === "" ? `__col${i}` : String(c).trim()));
  const rows: Record<string, unknown>[] = [];
  for (let r = best + 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    if (!line.some((c) => c != null && String(c).trim() !== "")) continue;
    rows.push(Object.fromEntries(heads.map((h, i) => [h, line[i] ?? null])));
  }
  return { rows, headerRow: best + 1 };
}

const title = (s: string) => s.toLowerCase().replace(/(^|[\s'·-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|I|Y|Da|Dels)\b/g, (w) => w.toLowerCase());
const str = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

export interface ImportRow {
  index: number; name: string; lastName: string | null; fullName: string; taxId: string | null; taxIdValid: boolean; personKind: "fisica" | "juridica" | null;
  email: string | null; phone: string | null; address: string | null; city: string | null; province: string | null; postalCode: string | null;
  label: string | null; classification: "collaborador" | "pendent_classificacio"; createdAt: string | null; representative: string | null; warnings: string[]; errors: string[];
}

export function personKind(taxId: string | null): "fisica" | "juridica" | null {
  if (!taxId) return null;
  if (/^(\d{8}|[XYZKLM]\d{7})[A-Z]$/.test(taxId)) return "fisica";
  if (/^[A-HJNP-SUVW]\d{7}[0-9A-J]$/.test(taxId)) return "juridica";
  return null;
}
export const classify = (label: string | null): ImportRow["classification"] => (/^(comercial|colaborador|col·laborador|collaborador|agente|agent)$/i.test((label ?? "").trim()) ? "collaborador" : "pendent_classificacio");

function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  const s = str(v);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return new Date(`${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}:00Z`).toISOString(); }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeRows(rows: Record<string, unknown>[]): { rows: ImportRow[]; headers: ReturnType<typeof mapHeaders> } {
  const headers = mapHeaders(Object.keys(rows[0] ?? {}));
  const g = (r: Record<string, unknown>, f: ImportField) => (headers.map[f] ? r[headers.map[f]!] : null);
  const out = rows.map((r, index): ImportRow => {
    const warnings: string[] = [], errors: string[] = [];
    const name = title(str(g(r, "name")));
    const lastName = str(g(r, "lastName")) ? title(str(g(r, "lastName"))) : null;
    const taxRaw = str(g(r, "taxId")).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const taxId = taxRaw || null;
    const taxIdValid = taxId ? validTaxId(taxId) : false;
    if (!taxId) warnings.push("Sense DNI/CIF");
    else if (!taxIdValid) warnings.push(`DNI/CIF «${taxId}» no supera la validació`);
    const emailRaw = str(g(r, "email")).toLowerCase();
    const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
    if (emailRaw && !email) warnings.push(`Correu «${emailRaw}» no vàlid`);
    let phone = str(g(r, "phone")).replace(/[^\d+]/g, "");
    if (/^(\+34|0034)\d{9}$/.test(phone)) phone = phone.slice(-9);
    let cp = str(g(r, "postalCode")).replace(/\D/g, "");
    if (/^\d{4}$/.test(cp)) { cp = `0${cp}`; warnings.push(`Codi postal completat amb un 0 inicial (${cp})`); }
    else if (cp && !/^\d{5}$/.test(cp)) warnings.push(`Codi postal «${cp}» no vàlid`);
    if (!name) errors.push("Falta el nom");
    const label = str(g(r, "label")) || null;
    const classification = classify(label);
    if (classification === "pendent_classificacio") warnings.push(`Etiqueta «${label ?? "buida"}»: queda pendent de classificar, sense cap permís`);
    return {
      index, name, lastName, fullName: [name, lastName].filter(Boolean).join(" "), taxId, taxIdValid, personKind: personKind(taxId),
      email, phone: phone || null, address: str(g(r, "address")) || null, city: str(g(r, "city")) ? title(str(g(r, "city"))) : null,
      province: str(g(r, "province")) ? title(str(g(r, "province"))) : null, postalCode: cp || null, label, classification,
      createdAt: toIsoDate(g(r, "createdAt")), representative: str(g(r, "representative")) || null, warnings, errors,
    };
  });
  // duplicats dins del mateix fitxer
  const seen = { tax: new Map<string, number>(), email: new Map<string, number>(), phone: new Map<string, number>() };
  for (const r of out) {
    for (const [k, v] of [["tax", r.taxId], ["email", r.email], ["phone", r.phone]] as const) {
      if (!v) continue;
      const first = seen[k].get(v);
      if (first != null) r.errors.push(`Repetit dins del fitxer (fila ${first + 2}, ${k === "tax" ? "DNI/CIF" : k === "email" ? "correu" : "telèfon"})`);
      else seen[k].set(v, r.index);
    }
  }
  return { rows: out, headers };
}

export type MatchKind = "dni" | "email" | "telefon" | "usuari_crm";
export interface Existing { id: string; name: string; tax_id_norm: string | null; email: string | null; phone: string | null; user_id: string | null }
export interface Proposal { action: "crear" | "actualitzar" | "ignorar" | "revisar"; target: string | null; matches: { kind: MatchKind; id: string; name: string }[]; reason: string }

/** Coincidències amb Supabase i acció proposada. Si hi ha dubte, «revisar»: mai es fusiona automàticament. */
export function propose(r: ImportRow, partners: Existing[], users: { id: string; email: string; role: string; name: string }[]): Proposal {
  if (r.errors.length) return { action: "ignorar", target: null, matches: [], reason: r.errors.join("; ") };
  const m: Proposal["matches"] = [];
  const phone = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-9);
  for (const p of partners) {
    if (r.taxId && p.tax_id_norm === r.taxId) m.push({ kind: "dni", id: p.id, name: p.name });
    else if (r.email && p.email?.toLowerCase() === r.email) m.push({ kind: "email", id: p.id, name: p.name });
    else if (r.phone && phone(p.phone) && phone(p.phone) === phone(r.phone)) m.push({ kind: "telefon", id: p.id, name: p.name });
  }
  const user = r.email ? users.find((x) => x.email.toLowerCase() === r.email) : undefined;
  if (user && !partners.some((p) => p.user_id === user.id)) m.push({ kind: "usuari_crm", id: user.id, name: `${user.name} (${user.role})` });
  const targets = [...new Set(m.filter((x) => x.kind !== "usuari_crm").map((x) => x.id))];
  if (user && m.some((x) => x.kind === "usuari_crm")) return { action: "revisar", target: null, matches: m, reason: `El correu ja és d'un usuari del CRM (${user.role}). No es modifica cap usuari existent: revisa-ho manualment.` };
  if (!m.length) return { action: "crear", target: null, matches: [], reason: r.classification === "collaborador" ? "Nou col·laborador" : "Nou registre pendent de classificar" };
  if (targets.length > 1) return { action: "revisar", target: null, matches: m, reason: "Coincideix amb més d'un col·laborador existent" };
  const dni = m.find((x) => x.kind === "dni");
  if (dni) return { action: "actualitzar", target: dni.id, matches: m, reason: "Mateix DNI/CIF: es completen els camps buits (no se sobreescriu res)" };
  return { action: "revisar", target: targets[0], matches: m, reason: `Coincidència per ${m[0].kind === "email" ? "correu" : "telèfon"} sense DNI coincident: cal confirmar si és la mateixa persona` };
}
