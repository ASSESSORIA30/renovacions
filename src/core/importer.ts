/**
 * Importer: turns spreadsheet rows (array-of-arrays) into SourceContracts.
 *
 * Sources supported out of the box (headers detected automatically, mapping editable in Ajustes):
 *  - "crm":   CRM export (Contratos_*.xlsx, sheet "Contratos")
 *  - "diario": CONTRACTES PER DIA.xlsx (sheets "2025", "2026"...), joined by CUPS
 *
 * Rules (documented in README):
 *  - One contract per CUPS; latest record wins. Rows without CUPS keyed by CIF+tarifa+producto+nombre.
 *  - Start date priority: activación > tramitación > DATA (diario) > traspaso (CRM import date → flagged).
 *  - Vencimiento = inicio + 12 meses; if >15 days in the past, rolls to the next anniversary (tácita).
 *  - IBAN is never imported.
 */
import { addMonths, anyToISO, addDays } from "./dates";
import type { SourceContract, Status, SupplyKind } from "./types";

export type Row = unknown[];
export interface Sheet { name: string; rows: Row[] }

export type FieldKey =
  | "cif" | "nombre" | "direccion" | "poblacion" | "provincia" | "cp" | "tipo" | "comercializadora" | "tarifa"
  | "producto" | "cups" | "consumo" | "potencia" | "estado" | "fechaActivacion" | "fechaTramitacion" | "fechaTraspaso"
  | "fechaBaja" | "observaciones" | "propietario" | "telefono" | "email"
  | "p1" | "p2" | "p3" | "p4" | "p5" | "p6"
  // diario
  | "data" | "client" | "representant" | "companyiaAnterior" | "companyiaNova" | "tipoAlta" | "preu" | "estadoAlta"
  | "excedents" | "admin" | "comentario" | "gestiono" | "comentarioLlamada" | "renovat";

export type Mapping = Partial<Record<FieldKey, string>>;

export const FIELD_LABELS: Record<FieldKey, string> = {
  cif: "NIF/CIF", nombre: "Client / raó social", direccion: "Adreça", poblacion: "Municipi", provincia: "Província",
  cp: "Codi postal", tipo: "Tipus de subministrament", comercializadora: "Comercialitzadora actual", tarifa: "Tarifa",
  producto: "Producte", cups: "CUPS", consumo: "Consum anual (kWh)", potencia: "Potència (kW)", estado: "Estat a l'origen",
  fechaActivacion: "Data d'activació", fechaTramitacion: "Data de tramitació", fechaTraspaso: "Data de traspàs/importació",
  fechaBaja: "Data de baixa", observaciones: "Observacions", propietario: "Usuari propietari", telefono: "Telèfon",
  email: "Correu electrònic", p1: "Potència P1", p2: "Potència P2", p3: "Potència P3", p4: "Potència P4", p5: "Potència P5", p6: "Potència P6",
  data: "Data (DATA)", client: "Client (registre diari)", representant: "Representant", companyiaAnterior: "Comercialitzadora anterior",
  companyiaNova: "Comercialitzadora nova", tipoAlta: "Tipus d'alta", preu: "Preu contractat", estadoAlta: "Estat de l'alta",
  excedents: "Excedents", admin: "Captador (admin)", comentario: "Comentari", gestiono: "Comercial (gestiona)",
  comentarioLlamada: "Comentari de trucada", renovat: "Renovat (marca)",
};

/** Synonyms used for automatic column detection (normalized: lowercase, no accents, no symbols). */
const SYN: Record<FieldKey, string[]> = {
  cif: ["cif cuenta", "cif", "nif", "nif cif", "dni"],
  nombre: ["nombre", "cliente", "razon social", "titular"],
  direccion: ["direccion", "direccion suministro", "domicilio"],
  poblacion: ["poblacion", "municipio", "localidad"],
  provincia: ["provincia"],
  cp: ["codigo postal", "cp"],
  tipo: ["tipo de producto", "subministre", "suministro", "tipo suministro"],
  comercializadora: ["comercializadora", "compania", "comercializadora actual"],
  tarifa: ["tarifa"],
  producto: ["producto"],
  cups: ["cups"],
  consumo: ["consumo", "consumo anual"],
  potencia: ["potencia"],
  estado: ["estado"],
  fechaActivacion: ["fecha activacion"],
  fechaTramitacion: ["fecha tramitacion", "fecha carterizacion"],
  fechaTraspaso: ["fecha traspaso"],
  fechaBaja: ["fecha de baja"],
  observaciones: ["observaciones"],
  propietario: ["usuario propietario email", "usuario propietario"],
  telefono: ["n telefono", "telefono", "movil", "tel"],
  email: ["correo electronico", "email", "e mail", "correo"],
  p1: ["p1 contratada"], p2: ["p2 contratada"], p3: ["p3 contratada"], p4: ["p4 contratada"], p5: ["p5 contratada"], p6: ["p6 contratada"],
  data: ["data", "fecha"],
  client: ["client"],
  representant: ["representant", "representante"],
  companyiaAnterior: ["companyia anterior", "compania anterior"],
  companyiaNova: ["companyia nova", "compania nueva"],
  tipoAlta: ["tipo de alta"],
  preu: ["preu contractat", "precio contratado"],
  estadoAlta: ["estado alta"],
  excedents: ["excedents", "excedentes"],
  admin: ["admin"],
  comentario: ["comentario"],
  gestiono: ["admin gestiono", "gestiono"],
  comentarioLlamada: ["comentario llamada"],
  renovat: ["renovat 2026", "renovat", "renovado"],
};

export const CRM_FIELDS: FieldKey[] = [
  "cif", "nombre", "direccion", "poblacion", "provincia", "cp", "tipo", "comercializadora", "tarifa", "producto", "cups",
  "consumo", "potencia", "estado", "fechaActivacion", "fechaTramitacion", "fechaTraspaso", "fechaBaja", "observaciones",
  "propietario", "telefono", "email", "p1", "p2", "p3", "p4", "p5", "p6",
];
export const DIARIO_FIELDS: FieldKey[] = [
  "data", "client", "representant", "tipo", "tarifa", "potencia", "companyiaAnterior", "companyiaNova", "tipoAlta", "cups",
  "preu", "estadoAlta", "excedents", "admin", "comentario", "gestiono", "comentarioLlamada", "renovat",
];

export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const m = String(v).match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
};

export function normalizePhone(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  let p = typeof v === "number" ? String(Math.trunc(v)) : String(v);
  p = p.replace(/[^\d+]/g, "");
  if (!p) return null;
  if (p.startsWith("+")) return p;
  if (p.startsWith("0034")) return "+" + p.slice(2);
  if (p.startsWith("34") && p.length === 11) return "+" + p;
  if (p.length === 9) return "+34" + p;
  return p;
}

const PEOPLE: Record<string, string> = { "OLIVIÉ": "OLIVIE", "IRENE/OLIVIE": "IRENE", "JOAN/IBETH": "IBETH", "IRENE (LLUCIA)": "IRENE" };
function person(v: unknown): string | null {
  const s = str(v);
  if (!s || s.toUpperCase() === "X") return null;
  const u = s.toUpperCase();
  return PEOPLE[u] ?? u;
}

function kind(t: string | null): SupplyKind {
  const s = norm(t);
  if (s.includes("gas")) return "gas";
  if (s.includes("telef") || s.includes("fibra") || s.includes("movil")) return "telefonia";
  if (s.includes("dual")) return "dual";
  return "luz";
}

/** Find the header row (first row with ≥3 recognised headers) and auto-map columns. */
export function detectHeader(rows: Row[], fields: FieldKey[]): { headerIndex: number; headers: string[]; mapping: Mapping } {
  let best = { headerIndex: 0, score: -1 };
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] ?? []).map(norm);
    const score = fields.filter((f) => SYN[f].some((syn) => cells.includes(syn))).length;
    if (score > best.score) best = { headerIndex: i, score };
  }
  const headers = (rows[best.headerIndex] ?? []).map((h) => str(h) ?? "");
  return { headerIndex: best.headerIndex, headers, mapping: autoMap(headers, fields) };
}

export function autoMap(headers: string[], fields: FieldKey[]): Mapping {
  const nh = headers.map(norm);
  const used = new Set<number>();
  const mapping: Mapping = {};
  // exact synonym matches first, in synonym priority order
  for (const f of fields) {
    for (const syn of SYN[f]) {
      const i = nh.findIndex((h, idx) => h === syn && !used.has(idx));
      if (i >= 0) { mapping[f] = headers[i]; used.add(i); break; }
    }
  }
  return mapping;
}

function rowsToObjects(rows: Row[], headerIndex: number, headers: string[]) {
  const out: Record<string, unknown>[] = [];
  for (const r of rows.slice(headerIndex + 1)) {
    if (!r || !r.some((c) => c !== null && c !== undefined && c !== "")) continue;
    const o: Record<string, unknown> = {};
    headers.forEach((h, i) => { if (h) o[h] = r[i]; });
    out.push(o);
  }
  return out;
}

const getter = (m: Mapping) => (o: Record<string, unknown>, f: FieldKey) => (m[f] ? o[m[f]!] : undefined);

/** Small stable hash (FNV-1a) → 12 hex chars. Used for ids of rows without CUPS. */
export function hashId(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619) >>> 0;
    h2 ^= s.charCodeAt(i) * 31; h2 = Math.imul(h2, 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
}

interface DiarioEntry {
  data: string; representant: string | null; anterior: string | null; nova: string | null; tipoAlta: string | null;
  preu: string | null; estadoAlta: string | null; excedents: string | null; captador: string | null; comentario: string | null;
  gestiono: string | null; comentarioLlamada: string | null; renovat: string | null;
}

export interface ImportOptions {
  today: string;
  crm: { sheet: Sheet; mapping?: Mapping };
  diario?: { sheets: Sheet[]; mapping?: Mapping };
}

export interface ImportReport {
  filasCRM: number;
  filasDiario: number;
  contratosUnicos: number;
  conDiario: number;
  sinCups: number;
  fechasEstimadas: number;
  tacitas: number;
  sinTelefono: number;
  sinEmail: number;
  sinConsumo: number;
  mappingCRM: Mapping;
  mappingDiario: Mapping;
}

export function importContracts(opts: ImportOptions): { contracts: SourceContract[]; report: ImportReport } {
  const TODAY = opts.today;
  // ---- diario
  const diario = new Map<string, DiarioEntry[]>();
  let filasDiario = 0;
  let mappingDiario: Mapping = {};
  for (const sh of opts.diario?.sheets ?? []) {
    const det = detectHeader(sh.rows, DIARIO_FIELDS);
    const m = { ...det.mapping, ...(opts.diario?.mapping ?? {}) };
    mappingDiario = { ...mappingDiario, ...m };
    const g = getter(m);
    for (const o of rowsToObjects(sh.rows, det.headerIndex, det.headers)) {
      const cups = str(g(o, "cups"))?.toUpperCase();
      const data = anyToISO(g(o, "data"));
      if (!cups || !data) continue;
      filasDiario++;
      const ren = g(o, "renovat");
      const e: DiarioEntry = {
        data,
        representant: str(g(o, "representant")),
        anterior: str(g(o, "companyiaAnterior")),
        nova: str(g(o, "companyiaNova")),
        tipoAlta: str(g(o, "tipoAlta")),
        preu: str(g(o, "preu")),
        estadoAlta: str(g(o, "estadoAlta")),
        excedents: str(g(o, "excedents")),
        captador: person(g(o, "admin")),
        comentario: str(g(o, "comentario")),
        gestiono: person(g(o, "gestiono")),
        comentarioLlamada: str(g(o, "comentarioLlamada")),
        renovat: ren instanceof Date || typeof ren === "number" ? anyToISO(ren) : str(ren),
      };
      if (!diario.has(cups)) diario.set(cups, []);
      diario.get(cups)!.push(e);
    }
  }
  for (const list of diario.values()) list.sort((a, b) => a.data.localeCompare(b.data));

  // ---- CRM
  const det = detectHeader(opts.crm.sheet.rows, CRM_FIELDS);
  const mappingCRM = { ...det.mapping, ...(opts.crm.mapping ?? {}) };
  const g = getter(mappingCRM);
  const recs = rowsToObjects(opts.crm.sheet.rows, det.headerIndex, det.headers);
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const o of recs) {
    const cups = str(g(o, "cups"))?.toUpperCase();
    const key = cups ?? "NOCUPS-" + ["cif", "tarifa", "producto", "nombre"].map((f) => str(g(o, f as FieldKey)) ?? "").join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  const recDate = (o: Record<string, unknown>) =>
    anyToISO(g(o, "fechaActivacion")) ?? anyToISO(g(o, "fechaTramitacion")) ?? anyToISO(g(o, "fechaTraspaso")) ?? "1900-01-01";

  const contracts: SourceContract[] = [];
  for (const [key, xs] of groups) {
    xs.sort((a, b) => recDate(a).localeCompare(recDate(b)));
    const x = xs[xs.length - 1];
    const cups = key.startsWith("NOCUPS-") ? null : key;
    const lg = cups ? diario.get(cups) ?? [] : [];
    const last = lg[lg.length - 1];

    let start: string | null = null;
    let src: SourceContract["fechaInicioFuente"] = null;
    if (anyToISO(g(x, "fechaActivacion"))) { start = anyToISO(g(x, "fechaActivacion")); src = "activacion"; }
    else if (anyToISO(g(x, "fechaTramitacion"))) { start = anyToISO(g(x, "fechaTramitacion")); src = "tramitacion"; }
    else if (last) { start = last.data; src = "registro_diario"; }
    else if (anyToISO(g(x, "fechaTraspaso"))) { start = anyToISO(g(x, "fechaTraspaso")); src = "importacion_crm"; }

    const vencOrig = start ? addMonths(start, 12) : null;
    let venc = vencOrig;
    let tacita = false;
    const limit = addDays(TODAY, -15);
    let guard = 0;
    while (venc && venc < limit && guard++ < 50) { venc = addMonths(venc, 12); tacita = true; }

    const estadoOrigen = str(g(x, "estado"));
    const nameRaw = str(g(x, "nombre")) ?? str(last?.representant) ?? "Sense nom";
    const name = nameRaw.replace(/\s*-\s*(RENOV\w*|NUEVO|NUEVA|20\d\d.*)$/i, "").trim() || nameRaw;
    const renovFlag = [...lg].reverse().find((l) => l.renovat)?.renovat ?? null;

    let status: Status = "pendiente";
    let motivo: string | null = null;
    const ea = (last?.estadoAlta ?? "").toUpperCase();
    if (estadoOrigen === "Baja" || estadoOrigen === "Anulado" || /^(BAJA|ANUL|CANCEL)/.test(ea)) {
      status = "no_renueva";
      motivo = `Baixa o anul·lació al full: ${estadoOrigen === "Baja" || estadoOrigen === "Anulado" ? estadoOrigen : last?.estadoAlta}`;
    } else if (renovFlag && ["SI", "OK", "OK RENOVAT", "X"].includes(renovFlag.toUpperCase().trim())) {
      status = "renovado";
    } else if (renovFlag) {
      status = "contactado";
    }

    const pot = (["p1", "p2", "p3", "p4", "p5", "p6"] as FieldKey[]).map((f) => num(g(x, f)));
    const owner = str(g(x, "propietario"))?.toLowerCase() ?? null;
    const tarifaRaw = str(g(x, "tarifa"));

    contracts.push({
      id: hashId(key),
      cups,
      cif: str(g(x, "cif")),
      cliente: name,
      clienteOriginal: nameRaw,
      direccion: str(g(x, "direccion")),
      poblacion: str(g(x, "poblacion")),
      provincia: str(g(x, "provincia")) ? str(g(x, "provincia"))!.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : null,
      cp: str(g(x, "cp")),
      telefono: normalizePhone(g(x, "telefono")),
      email: str(g(x, "email"))?.toLowerCase() ?? null,
      tipo: kind(str(g(x, "tipo"))),
      comercializadora: str(g(x, "comercializadora")) ?? last?.nova ?? null,
      comercializadoraAnterior: last?.anterior ?? null,
      tarifa: tarifaRaw ? tarifaRaw.replace(/^Tarifa\s+/i, "") : null,
      producto: str(g(x, "producto")),
      precioContratado: last?.preu ?? null,
      consumoAnual: num(g(x, "consumo")),
      potencia: num(g(x, "potencia")),
      potencias: pot.some((p) => p !== null) ? pot : null,
      estadoOrigen,
      estadoAlta: last?.estadoAlta ?? null,
      tipoAlta: last?.tipoAlta ?? null,
      excedentes: last?.excedents ?? null,
      observaciones: str(g(x, "observaciones")),
      comentario: last?.comentario ?? null,
      comentarioLlamada: last?.comentarioLlamada ?? null,
      renovat2026: renovFlag,
      representante: last?.representant ?? null,
      captador: last?.captador ?? null,
      comercial: last?.gestiono ?? last?.captador ?? "SIN ASIGNAR",
      colaborador: owner && owner !== "info@assessoria30.com" ? owner : null,
      fechaInicio: start,
      fechaInicioFuente: src,
      vencimientoOriginal: vencOrig,
      vencimiento: venc,
      renovacionTacita: tacita,
      fechaBaja: anyToISO(g(x, "fechaBaja")),
      contratosPrevios: xs.length - 1,
      registrosDiarios: lg.length,
      status,
      motivoRechazo: motivo,
      source: "real",
    });
  }
  contracts.sort((a, b) => (a.vencimiento ?? "9999").localeCompare(b.vencimiento ?? "9999"));
  const report: ImportReport = {
    filasCRM: recs.length,
    filasDiario,
    contratosUnicos: contracts.length,
    conDiario: contracts.filter((c) => c.registrosDiarios > 0).length,
    sinCups: contracts.filter((c) => !c.cups).length,
    fechasEstimadas: contracts.filter((c) => c.fechaInicioFuente === "importacion_crm").length,
    tacitas: contracts.filter((c) => c.renovacionTacita).length,
    sinTelefono: contracts.filter((c) => !c.telefono).length,
    sinEmail: contracts.filter((c) => !c.email).length,
    sinConsumo: contracts.filter((c) => !c.consumoAnual).length,
    mappingCRM,
    mappingDiario,
  };
  return { contracts, report };
}

/** Convenience: pick sheets from a workbook-like object. */
export function pickSheets(sheets: Sheet[]) {
  const crm = sheets.find((s) => norm(s.name) === "contratos") ?? sheets.find((s) => detectHeader(s.rows, CRM_FIELDS).mapping.cups);
  const diario = sheets.filter((s) => /^\d{4}$/.test(s.name.trim()));
  return { crm, diario };
}
