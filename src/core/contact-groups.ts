/**
 * AGRUPACIÓ INTEL·LIGENT DE RENOVACIONS PER CONTACTE (lògica pura, sense dependències de la interfície ni del servidor).
 *
 * Dues relacions diferents:
 *  - RELACIÓ GENERAL: tots els contractes que comparteixen persona de contacte (telèfon, correu, nom fiable o fitxa de
 *    Clients 360°), independentment de la data. És la base de «Altres contractes del mateix contacte».
 *  - AGRUPACIÓ DE RENOVACIONS: dins d'una relació general, els contractes que vencen dins de la finestra configurada
 *    (7–90 dies). La diferència entre el primer i l'últim venciment d'un grup MAI supera la finestra.
 *
 * Principis:
 *  - Mai no es dupliquen contractes: els grups són només llistes d'identificadors calculades a partir de les dades reals.
 *  - Només s'agrupen automàticament les coincidències «confirmades» i «probables». Les «ambigües» (centraletes,
 *    correus genèrics, noms iguals sense cap altra dada, telèfon compartit per persones diferents) requereixen revisió.
 *  - Les decisions manuals («unir» i «separar») tenen prioritat sobre la detecció automàtica.
 *  - El càlcul treballa NOMÉS amb els contractes que l'usuari pot veure (el magatzem ja ve filtrat per la RLS),
 *    de manera que cap comptador ni avís revela contractes inaccessibles.
 */
import { daysBetween, daysUntil, today } from "./dates";
import { expiry } from "./insights";
import { titleCase } from "./templates";
import type { Contract, Status } from "./types";

export const GROUP_WINDOWS = [7, 15, 30, 45, 60, 90] as const;
export type GroupWindow = (typeof GROUP_WINDOWS)[number];
export const DEFAULT_GROUP_WINDOW: GroupWindow = 30;
export const isGroupWindow = (n: unknown): n is GroupWindow => GROUP_WINDOWS.includes(n as GroupWindow);

/** Una clau compartida per més titulars que aquest llindar, sense un nom de persona coherent, es tracta com a genèrica. */
export const SHARED_KEY_HOLDER_LIMIT = 6;

export type MatchLevel = "confirmada" | "probable" | "ambigua";
export type MatchReason = "telefon" | "email" | "nom" | "clients360" | "manual";
export const MATCH_LABEL: Record<MatchLevel, string> = { confirmada: "Confirmada", probable: "Probable", ambigua: "Per revisar" };
export const REASON_LABEL: Record<MatchReason, string> = { telefon: "mateix telèfon", email: "mateix correu", nom: "mateix nom de contacte", clients360: "mateix contacte a Clients 360°", manual: "unió manual" };

/* ======================================================================= normalització */

const FAKE_PHONES = new Set(["000000000", "111111111", "123456789", "600000000", "900000000", "999999999", "987654321"]);

/** Telèfon normalitzat: 9 xifres per als números espanyols (sense prefix 34) o el número internacional complet. */
export function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  d = d.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("34") && /^[6789]/.test(d.slice(2))) d = d.slice(2);
  if (d.length < 9 || d.length > 15) return null;
  if (/^(\d)\1+$/.test(d) || FAKE_PHONES.has(d)) return null;
  return d;
}

/** Correu normalitzat: minúscules, sense espais i sense l'etiqueta «+…» de la part local. */
export function normEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  const m = e.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!m) return null;
  return `${m[1].replace(/\+.*$/, "")}@${m[2]}`;
}

const GENERIC_LOCAL = new Set([
  "info", "informacio", "informacion", "admin", "administracio", "administracion", "administration", "contabilidad", "comptabilitat",
  "facturacion", "facturacio", "facturas", "factures", "billing", "oficina", "office", "contacto", "contacte", "contact", "hola", "hello",
  "comercial", "ventas", "vendes", "sales", "gestion", "gestio", "gestoria", "recepcion", "recepcio", "noreply", "no-reply", "secretaria",
  "rrhh", "general", "mail", "correo", "correu", "empresa", "clientes", "clients", "atencion", "atencio", "soporte", "suport", "web",
]);

/** Correu genèric (info@, administracio@, comptabilitat@…): pot correspondre a persones diferents. */
export function isGenericEmail(e: string | null | undefined): boolean {
  const n = normEmail(e);
  if (!n) return false;
  const local = n.split("@")[0].replace(/[._-]?\d+$/, "");
  return GENERIC_LOCAL.has(local) || [...GENERIC_LOCAL].some((g) => local === `${g}s` || local.startsWith(`${g}.`) || local.startsWith(`${g}_`));
}

const NAME_STOP = new Set(["de", "del", "la", "las", "los", "el", "i", "y", "da", "dos", "van", "sr", "sra", "sres", "don", "dona", "dna", "en", "na"]);
const COMPANY_RE = /\b(s\.?l\.?u?|s\.?a\.?u?|s\.?c\.?p|sccl|c\.?b|sat|slp|slu|sl|sa|cooperativa|comunitat|comunidad|propietaris|propietarios|ajuntament|ayuntamiento|associacio|asociacion|fundacio|fundacion)\b/i;

/**
 * Nom de persona normalitzat (sense accents, majúscules ni partícules i amb les paraules ordenades), o null si no és
 * prou fiable: menys de dues paraules significatives o un nom d'empresa.
 */
export function normPersonName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (COMPANY_RE.test(s)) return null;
  const words = s.replace(/[^a-z0-9ñç ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !NAME_STOP.has(w) && !/\d/.test(w));
  if (words.length < 2) return null;
  return [...new Set(words)].sort().join(" ");
}

/** Identificador del titular: NIF/CIF normalitzat o, si no n'hi ha, el propi contracte (no s'assumeix cap relació). */
export function holderKey(c: Pick<Contract, "id" | "cif">): string {
  const t = (c.cif ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t.length >= 8 ? `cif:${t}` : `ct:${c.id}`;
}

/** Clau d'un destinatari (per a autoritzacions i duplicats): «tel:…» o «email:…». */
export function recipientKey(channel: "whatsapp" | "email", recipient: string | null | undefined): string | null {
  if (channel === "email") { const e = normEmail(recipient); return e ? `email:${e}` : null; }
  const p = normPhone(recipient);
  return p ? `tel:${p}` : null;
}

export const effectivePhone = (c: Contract) => c.crm.telefonoOverride ?? c.telefono;
export const effectiveEmail = (c: Contract) => c.crm.emailOverride ?? c.email;

/* ======================================================================= dades de suport */

export interface ManualLink { id: string; kind: "unir" | "separar"; contract_a: string; contract_b: string; reason?: string | null; created_by_name?: string | null; created_at?: string }
/** Clients 360°: per a cada contracte de renovacions (per CUPS), els identificadors de contacte del seu client. */
export type C360Index = Record<string, string[]>;
export interface GroupInputs { links?: ManualLink[]; c360?: C360Index; ownPhones?: string[] }

interface Keys { phone: string | null; email: string | null; name: string | null; c360: string[] }

export interface RelatedMatch { contractId: string; level: MatchLevel; reasons: MatchReason[]; sameHolder: boolean }

export interface ContactGraph {
  /** relació general: identificador del component per contracte (només contractes amb relacions) */
  componentOf: Map<string, string>;
  members: Map<string, string[]>;
  keysOf: Map<string, Keys>;
  /** coincidències ambigües per contracte (no s'agrupen, es mostren per revisar) */
  ambiguous: Map<string, Set<string>>;
  separated: Map<string, Set<string>>;
  byId: Map<string, Contract>;
  /** telèfons i correus compartits per persones diferents (centraletes, gestories): «tel:…» / «email:…» */
  sharedKeys: Set<string>;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* ======================================================================= graf de relacions (relació general) */

/**
 * Construeix la relació general entre contractes. Cost O(n · α) amb índexs per clau: funciona amb milers de contractes.
 */
export function buildContactGraph(contracts: Contract[], inputs: GroupInputs = {}): ContactGraph {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const own = new Set((inputs.ownPhones ?? []).map(normPhone).filter(Boolean) as string[]);
  const keysOf = new Map<string, Keys>();
  const idx = { phone: new Map<string, string[]>(), email: new Map<string, string[]>(), name: new Map<string, string[]>(), c360: new Map<string, string[]>() };
  const push = (m: Map<string, string[]>, k: string, id: string) => { const l = m.get(k); if (l) l.push(id); else m.set(k, [id]); };

  for (const c of contracts) {
    const p = normPhone(effectivePhone(c));
    const e = normEmail(effectiveEmail(c));
    const k: Keys = {
      phone: p && !own.has(p) ? p : null,
      email: e && !isGenericEmail(e) ? e : null,
      name: normPersonName(c.representante),
      c360: inputs.c360?.[c.id] ?? [],
    };
    keysOf.set(c.id, k);
    if (k.phone) push(idx.phone, k.phone, c.id);
    if (k.email) push(idx.email, k.email, c.id);
    if (k.name) push(idx.name, k.name, c.id);
    for (const x of k.c360) push(idx.c360, x, c.id);
  }

  // decisions manuals
  const separated = new Map<string, Set<string>>();
  const unions: [string, string][] = [];
  for (const l of inputs.links ?? []) {
    if (!byId.has(l.contract_a) || !byId.has(l.contract_b)) continue; // contracte no visible: s'ignora sense revelar-lo
    if (l.kind === "separar") {
      (separated.get(l.contract_a) ?? separated.set(l.contract_a, new Set()).get(l.contract_a)!).add(l.contract_b);
      (separated.get(l.contract_b) ?? separated.set(l.contract_b, new Set()).get(l.contract_b)!).add(l.contract_a);
    } else unions.push([l.contract_a, l.contract_b]);
  }

  // union-find que respecta les separacions
  const parent = new Map<string, string>();
  const comp = new Map<string, Set<string>>(); // arrel → membres
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let y = x; while (parent.get(y) !== r) { const n = parent.get(y)!; parent.set(y, r); y = n; } return r; };
  const ensure = (x: string) => { if (!parent.has(x)) { parent.set(x, x); comp.set(x, new Set([x])); } };
  const union = (a: string, b: string) => {
    ensure(a); ensure(b);
    let ra = find(a), rb = find(b);
    if (ra === rb) return;
    let A = comp.get(ra)!, B = comp.get(rb)!;
    if (A.size < B.size) { [ra, rb] = [rb, ra]; [A, B] = [B, A]; }
    for (const m of B) { const s = separated.get(m); if (s) for (const o of s) if (A.has(o)) return; } // unir-los violaria una separació
    parent.set(rb, ra);
    for (const m of B) A.add(m);
    comp.delete(rb);
  };

  const ambiguous = new Map<string, Set<string>>();
  const markAmbiguous = (ids: string[]) => {
    if (ids.length > 60) return; // claus massives (centraletes): no es llisten parelles
    for (const a of ids) for (const b of ids) if (a !== b) (ambiguous.get(a) ?? ambiguous.set(a, new Set()).get(a)!).add(b);
  };

  // 1) manuals i Clients 360°: confirmades
  for (const [a, b] of unions) union(a, b);
  for (const ids of idx.c360.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

  // 2) telèfon i correu: s'agrupa si la clau correspon a una sola persona
  const sharedKeys = new Set<string>();
  for (const [kind, m] of [["tel", idx.phone], ["email", idx.email]] as const) {
    for (const [key, ids] of m) {
      if (ids.length < 2) continue;
      const names = new Set(ids.map((id) => keysOf.get(id)!.name).filter(Boolean));
      const holders = new Set(ids.map((id) => holderKey(byId.get(id)!)));
      const shared = names.size >= 2 || (names.size === 0 && holders.size >= SHARED_KEY_HOLDER_LIMIT);
      if (shared) { sharedKeys.add(`${kind}:${key}`); markAmbiguous(ids); continue; }
      // un nom diferent dins d'una clau amb un sol nom: el contracte sense nom s'hi uneix, els noms iguals també
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    }
  }

  // 3) només el nom (cap altra dada en comú): coincidència ambigua, requereix revisió
  for (const ids of idx.name.values()) if (ids.length >= 2) markAmbiguous(ids);

  // les parelles ja unides o separades no són ambigües
  for (const [a, set] of ambiguous) {
    for (const b of [...set]) if ((parent.has(a) && parent.has(b) && find(a) === find(b)) || separated.get(a)?.has(b)) set.delete(b);
    if (!set.size) ambiguous.delete(a);
  }

  const componentOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const set of comp.values()) {
    if (set.size < 2) continue;
    const list = [...set].sort();
    const id = `rel:${list[0]}`;
    members.set(id, list);
    for (const m of list) componentOf.set(m, id);
  }
  return { componentOf, members, keysOf, ambiguous, separated, byId, sharedKeys };
}

/** Classificació d'una parella (per mostrar per què estan relacionats). */
export function classifyPair(g: ContactGraph, a: string, b: string, manual?: ManualLink[]): { level: MatchLevel; reasons: MatchReason[] } {
  const ka = g.keysOf.get(a), kb = g.keysOf.get(b);
  const reasons: MatchReason[] = [];
  if (manual?.some((l) => l.kind === "unir" && pairKey(l.contract_a, l.contract_b) === pairKey(a, b))) reasons.push("manual");
  if (ka && kb) {
    if (ka.c360.some((x) => kb.c360.includes(x))) reasons.push("clients360");
    if (ka.phone && ka.phone === kb.phone) reasons.push("telefon");
    if (ka.email && ka.email === kb.email) reasons.push("email");
    if (ka.name && ka.name === kb.name) reasons.push("nom");
  }
  const related = g.componentOf.get(a) !== undefined && g.componentOf.get(a) === g.componentOf.get(b);
  if (!related) return { level: "ambigua", reasons };
  const strong = reasons.includes("manual") || reasons.includes("clients360") || (reasons.includes("telefon") && reasons.includes("email"))
    || ((reasons.includes("telefon") || reasons.includes("email")) && reasons.includes("nom"));
  return { level: strong ? "confirmada" : "probable", reasons };
}

/** RELACIÓ GENERAL: altres contractes del mateix contacte (qualsevol data), ordenats per venciment. */
export function relatedContracts(g: ContactGraph, contractId: string, manual?: ManualLink[]): RelatedMatch[] {
  const self = g.byId.get(contractId);
  if (!self) return [];
  const hk = holderKey(self);
  const out: RelatedMatch[] = [];
  const comp = g.componentOf.get(contractId);
  for (const id of comp ? g.members.get(comp)! : []) {
    if (id === contractId) continue;
    const { level, reasons } = classifyPair(g, contractId, id, manual);
    out.push({ contractId: id, level, reasons, sameHolder: holderKey(g.byId.get(id)!) === hk });
  }
  for (const id of g.ambiguous.get(contractId) ?? []) {
    if (out.some((x) => x.contractId === id)) continue;
    out.push({ contractId: id, level: "ambigua", reasons: classifyPair(g, contractId, id, manual).reasons, sameHolder: holderKey(g.byId.get(id)!) === hk });
  }
  return sortByExpiry(out, g);
}

/** Contractes relacionats amb un conjunt de dades de contacte (fitxa de Clients 360°). */
export function relatedToContacts(g: ContactGraph, contacts: { phone?: string | null; email?: string | null; name?: string | null; id?: string }[], exclude: Set<string> = new Set()): RelatedMatch[] {
  const phones = new Set(contacts.map((c) => normPhone(c.phone)).filter(Boolean));
  const emails = new Set(contacts.map((c) => normEmail(c.email)).filter((e) => e && !isGenericEmail(e)));
  const names = new Set(contacts.map((c) => normPersonName(c.name)).filter(Boolean));
  const ids = new Set(contacts.map((c) => c.id).filter(Boolean));
  const out: RelatedMatch[] = [];
  for (const [cid, k] of g.keysOf) {
    if (exclude.has(cid)) continue;
    const reasons: MatchReason[] = [];
    if (k.c360.some((x) => ids.has(x))) reasons.push("clients360");
    if (k.phone && phones.has(k.phone)) reasons.push("telefon");
    if (k.email && emails.has(k.email)) reasons.push("email");
    if (k.name && names.has(k.name)) reasons.push("nom");
    if (!reasons.length) continue;
    const onlyShared = reasons.every((r) => r === "nom" || (r === "telefon" && g.sharedKeys.has(`tel:${k.phone}`)) || (r === "email" && g.sharedKeys.has(`email:${k.email}`)));
    if (onlyShared && !reasons.includes("clients360")) { out.push({ contractId: cid, level: "ambigua", reasons, sameHolder: false }); continue; }
    const strong = reasons.includes("clients360") || (reasons.includes("telefon") && reasons.includes("email")) || ((reasons.includes("telefon") || reasons.includes("email")) && reasons.includes("nom"));
    const level: MatchLevel = strong ? "confirmada" : "probable";
    out.push({ contractId: cid, level, reasons, sameHolder: false });
  }
  return sortByExpiry(out, g);
}

function sortByExpiry(list: RelatedMatch[], g: ContactGraph) {
  return list.sort((x, y) => (expiry(g.byId.get(x.contractId)!) ?? "9999").localeCompare(expiry(g.byId.get(y.contractId)!) ?? "9999") || x.contractId.localeCompare(y.contractId));
}

/* ======================================================================= agrupació de renovacions (finestra temporal) */

export interface RenewalCluster {
  /** identificador estable (no depèn de l'ordre de les columnes) */
  id: string;
  relationId: string;
  contractIds: string[];
  first: string | null;
  last: string | null;
}

/**
 * Divideix cada relació general en grups de renovacions pròximes. Algorisme voraç sobre les dates ordenades: un grup
 * comença al primer venciment i inclou els següents mentre la diferència amb el PRIMER no superi la finestra.
 * Els contractes sense data de venciment no s'agrupen.
 */
export function renewalClusters(g: ContactGraph, candidates: Contract[], window: number): RenewalCluster[] {
  const inSet = new Map<string, Contract[]>();
  for (const c of candidates) {
    const rel = g.componentOf.get(c.id);
    if (!rel || !expiry(c)) continue;
    (inSet.get(rel) ?? inSet.set(rel, []).get(rel)!).push(c);
  }
  const out: RenewalCluster[] = [];
  for (const [rel, list] of inSet) {
    if (list.length < 2) continue;
    list.sort((a, b) => expiry(a)!.localeCompare(expiry(b)!) || a.id.localeCompare(b.id));
    let cur: Contract[] = [];
    const flush = () => {
      if (cur.length >= 2) {
        const ids = cur.map((c) => c.id);
        out.push({ id: `grp:${[...ids].sort()[0]}`, relationId: rel, contractIds: ids, first: expiry(cur[0]), last: expiry(cur[cur.length - 1]) });
      }
      cur = [];
    };
    for (const c of list) {
      if (cur.length && daysBetween(expiry(cur[0])!, expiry(c)!) > window) flush();
      cur.push(c);
    }
    flush();
  }
  return out;
}

/* ======================================================================= Kanban: targetes agrupades */

export type KanbanItem =
  | { kind: "single"; id: string; contract: Contract }
  | { kind: "group"; id: string; cluster: RenewalCluster; status: Status; contracts: Contract[]; all: Contract[] };

/**
 * Converteix les columnes del Kanban en targetes: una targeta agrupada per grup i columna (els contractes del grup
 * que tenen aquest estat) i una targeta individual per a la resta. L'ordre de cada columna es manté (la targeta
 * agrupada ocupa el lloc del seu contracte més prioritari).
 */
export function kanbanItems(cols: Record<Status, Contract[]>, clusters: RenewalCluster[], byId: Map<string, Contract> | Record<string, Contract>): Record<Status, KanbanItem[]> {
  const get = (id: string) => (byId instanceof Map ? byId.get(id) : byId[id]);
  const clusterOf = new Map<string, RenewalCluster>();
  for (const cl of clusters) for (const id of cl.contractIds) clusterOf.set(id, cl);
  const out = {} as Record<Status, KanbanItem[]>;
  for (const s of Object.keys(cols) as Status[]) {
    const items: KanbanItem[] = [];
    const placed = new Set<string>();
    for (const c of cols[s]) {
      const cl = clusterOf.get(c.id);
      if (!cl) { items.push({ kind: "single", id: c.id, contract: c }); continue; }
      if (placed.has(cl.id)) continue;
      placed.add(cl.id);
      const all = cl.contractIds.map(get).filter(Boolean) as Contract[];
      const here = cols[s].filter((x) => clusterOf.get(x.id) === cl);
      items.push({ kind: "group", id: `${cl.id}@${s}`, cluster: cl, status: s, contracts: here, all });
    }
    out[s] = items;
  }
  return out;
}

export interface GroupSummary {
  contactName: string | null;
  phone: string | null;
  email: string | null;
  total: number;
  luz: number;
  gas: number;
  other: number;
  holders: number;
  first: string | null;
  last: string | null;
  statuses: Partial<Record<Status, number>>;
  owners: string[];
  priority: number;
}

export function summarize(contracts: Contract[], priority: Record<string, { score: number } | undefined> = {}): GroupSummary {
  const names = contracts.map((c) => c.representante?.trim()).filter(Boolean) as string[];
  const phone = contracts.map(effectivePhone).find(Boolean) ?? null;
  const email = contracts.map(effectiveEmail).find(Boolean) ?? null;
  const dates = contracts.map(expiry).filter(Boolean).sort() as string[];
  const statuses: Partial<Record<Status, number>> = {};
  for (const c of contracts) statuses[c.crm.status] = (statuses[c.crm.status] ?? 0) + 1;
  return {
    contactName: mostCommon(names) ?? null,
    phone, email,
    total: contracts.length,
    luz: contracts.filter((c) => c.tipo === "luz" || c.tipo === "dual").length,
    gas: contracts.filter((c) => c.tipo === "gas").length,
    other: contracts.filter((c) => c.tipo === "telefonia").length,
    holders: new Set(contracts.map(holderKey)).size,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    statuses,
    owners: [...new Set(contracts.map((c) => c.comercial))].sort(),
    priority: Math.max(0, ...contracts.map((c) => priority[c.id]?.score ?? 0)),
  };
}

function mostCommon(xs: string[]): string | undefined {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

/* ======================================================================= avís intel·ligent (8.5) */

/** «Aquest contacte té N contractes més, dels quals M vencen durant els pròxims X dies.» Només si és útil. */
export function relatedAlert(related: RelatedMatch[], byId: Map<string, Contract>, days = 30, ref = today()): { total: number; soon: number; text: string } | null {
  const sure = related.filter((r) => r.level !== "ambigua").map((r) => byId.get(r.contractId)).filter(Boolean) as Contract[];
  if (!sure.length) return null;
  const soon = sure.filter((c) => (c.crm.status === "pendiente" || c.crm.status === "contactado") && (() => { const d = daysUntil(expiry(c), ref); return d !== null && d >= 0 && d <= days; })()).length;
  if (!soon) return null; // sense renovacions pròximes no cal avisar: l'indicador ja informa
  const n = sure.length;
  return { total: n, soon, text: `Aquest contacte té ${n} ${n === 1 ? "contracte" : "contractes"} més, ${soon === 1 ? "un dels quals venç" : `dels quals ${soon} vencen`} durant els pròxims ${days} dies.` };
}

/* ======================================================================= comunicació conjunta («Contactar tots») */

export const SUPPLY_LABEL: Record<string, { ca: string; es: string }> = { luz: { ca: "llum", es: "luz" }, gas: { ca: "gas", es: "gas" }, dual: { ca: "llum i gas", es: "luz y gas" }, telefonia: { ca: "telefonia", es: "telefonía" } };

const fmtD = (iso: string | null, lang: "ca" | "es") => (iso ? new Intl.DateTimeFormat(lang === "ca" ? "ca-ES" : "es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${iso}T12:00:00`)) : "—");

/** Línia per contracte amb les seves condicions individuals (no es barregen dades entre contractes). */
export function contractLine(c: Contract, lang: "ca" | "es", extra?: { ahorro?: number | null; link?: string | null }): string {
  const cups = c.cups ? `CUPS …${c.cups.slice(-6)}` : lang === "ca" ? "sense CUPS" : "sin CUPS";
  const sup = SUPPLY_LABEL[c.tipo]?.[lang] ?? c.tipo;
  const parts = [`${titular(c.cliente)} — ${cups} (${sup}${c.tarifa ? `, ${c.tarifa}` : ""}${c.comercializadora ? `, ${c.comercializadora}` : ""})`, `${lang === "ca" ? "venç el" : "vence el"} ${fmtD(expiry(c), lang)}`];
  if (extra?.ahorro != null && extra.ahorro > 0) parts.push(`${lang === "ca" ? "estalvi estimat" : "ahorro estimado"} ${Math.round(extra.ahorro).toLocaleString(lang === "ca" ? "ca-ES" : "es-ES")} €/${lang === "ca" ? "any" : "año"}`);
  if (extra?.link) parts.push(extra.link);
  return `• ${parts.join(" · ")}`;
}
const titular = (s: string) => titleCase(s.trim().replace(/\s+/g, " "));

export function firstName(full: string | null | undefined): string | null {
  const w = (full ?? "").trim().split(/\s+/)[0];
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : null;
}

/** Missatge únic que resumeix els contractes seleccionats (editable abans d'enviar). */
export function buildGroupMessage(o: { contactName: string | null; contracts: Contract[]; lang: "ca" | "es"; channel: "whatsapp" | "email"; company: string; sender: string; withProposals: boolean; extras?: Record<string, { ahorro?: number | null; link?: string | null }> }): { subject: string; body: string } {
  const n = o.contracts.length;
  const who = firstName(o.contactName);
  const list = o.contracts.map((c) => contractLine(c, o.lang, o.extras?.[c.id])).join("\n");
  if (o.lang === "es") {
    const body = `${who ? `Buenos días, ${who}.` : "Buenos días."} Hemos detectado que tienes ${n} ${n === 1 ? "contrato próximo" : "contratos próximos"} a renovar:\n\n${list}\n\nHemos preparado una revisión conjunta de las condiciones para que puedas valorar las diferentes opciones.${o.withProposals ? " Te adjuntamos las propuestas correspondientes." : ""}\n\nQuedamos a tu disposición.\n${o.sender}\n${o.company}`;
    return { subject: `Renovación de ${n} ${n === 1 ? "contrato" : "contratos"} — ${o.company}`, body };
  }
  const body = `${who ? `Bon dia, ${who}.` : "Bon dia."} Hem detectat que tens ${n} ${n === 1 ? "contracte pròxim" : "contractes pròxims"} a renovar:\n\n${list}\n\nHem preparat una revisió conjunta de les condicions perquè puguis valorar les diferents opcions.${o.withProposals ? " T'adjuntem les propostes corresponents." : ""}\n\nQuedem a la teva disposició.\n${o.sender}\n${o.company}`;
  return { subject: `Renovació de ${n} ${n === 1 ? "contracte" : "contractes"} — ${o.company}`, body };
}

/** Empremta d'una comunicació (mateix canal, destinatari i contractes): serveix per avisar de reenviaments. */
export function commFingerprint(channel: "whatsapp" | "email", recipient: string | null | undefined, contractIds: string[]): string | null {
  const k = recipientKey(channel, recipient);
  return k ? `${channel}|${k}|${[...new Set(contractIds)].sort().join(",")}` : null;
}

/** Recompte del Kanban: targetes i contractes reals, per columna. */
export function columnCounts(items: KanbanItem[]): { cards: number; contracts: number; groups: number } {
  let contracts = 0, groups = 0;
  for (const it of items) { if (it.kind === "group") { groups++; contracts += it.contracts.length; } else contracts++; }
  return { cards: items.length, contracts, groups };
}
