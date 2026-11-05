/**
 * IMPORTACIÓ DE TARIFES DES D'EXCEL/CSV · lògica pura (assistent de 10 passos a la interfície).
 * Cada comercialitzadora pot tenir una estructura diferent: es fa un mapatge de columnes a camps
 * normalitzats (detectat automàticament i editable) i es pot desar com a plantilla.
 */
import { normalizeTariff } from "./engine";
import { permanenceFromImport, surplusFromImport } from "./surplus-detect";
import { checkVersion, productKey, slug } from "./catalog";
import { emptySheet, type ContractType, type OfferVersion, type PowerUnit, type SasMode, type Segment } from "./types";

export type Cell = string | number | boolean | Date | null | undefined;

export const IMPORT_FIELDS = {
  supplier: "Comercialitzadora",
  product: "Nom de l'oferta",
  tariff: "Peatge d'accés",
  energyType: "Llum / gas",
  segment: "Segment",
  contractType: "Tipus de contracte",
  e1: "Energia P1 (€/kWh)",
  e2: "Energia P2",
  e3: "Energia P3",
  e4: "Energia P4",
  e5: "Energia P5",
  e6: "Energia P6",
  e24: "Energia preu únic (€/kWh)",
  p1: "Potència P1",
  p2: "Potència P2",
  p3: "Potència P3",
  p4: "Potència P4",
  p5: "Potència P5",
  p6: "Potència P6",
  powerUnit: "Unitat de potència",
  gasFixed: "Terme fix gas (€/dia)",
  sas: "SAS (inclòs/exclòs/variable)",
  sasValue: "SAS €/kWh",
  fee: "Quota fixa (€/mes)",
  permanence: "Permanència (mesos)",
  penalty: "Penalització",
  surplusMode: "Compensació d'excedents (modalitat)",
  surplusPrice: "Preu excedents (€/kWh)",
  battery: "Bateria virtual (sí/no)",
  batteryFee: "Cost bateria virtual (€/mes)",
  validFrom: "Vigent des de",
  validTo: "Vigent fins a",
  minKwh: "Consum mínim (kWh)",
  maxKwh: "Consum màxim (kWh)",
  minKw: "Potència mínima (kW)",
  maxKw: "Potència màxima (kW)",
  conditions: "Condicions",
  taxes: "Preus amb impostos",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
export type Mapping = Partial<Record<ImportField, string>>; // camp → capçalera

const SYN: Record<ImportField, string[]> = {
  supplier: ["comercializadora", "comercialitzadora", "compania", "proveedor", "marca"],
  product: ["producto", "oferta", "nombre", "nom", "tarifa comercial", "nombre oferta", "producte"],
  tariff: ["tarifa acceso", "peaje", "atr", "tarifa", "acceso", "peatge"],
  energyType: ["tipo energia", "energia", "suministro", "tipo", "producto tipo"],
  segment: ["segmento", "cliente", "tipo cliente"],
  contractType: ["tipo precio", "modalidad", "tipo contrato"],
  e1: ["p1 energia", "energia p1", "termino energia p1", "precio energia p1", "te p1", "ep1"],
  e2: ["p2 energia", "energia p2", "termino energia p2", "precio energia p2", "te p2", "ep2"],
  e3: ["p3 energia", "energia p3", "termino energia p3", "precio energia p3", "te p3", "ep3"],
  e4: ["p4 energia", "energia p4", "termino energia p4", "precio energia p4", "te p4", "ep4"],
  e5: ["p5 energia", "energia p5", "termino energia p5", "precio energia p5", "te p5", "ep5"],
  e6: ["p6 energia", "energia p6", "termino energia p6", "precio energia p6", "te p6", "ep6"],
  e24: ["precio unico", "energia 24h", "precio energia", "termino energia", "precio kwh", "energia unico"],
  p1: ["p1 potencia", "potencia p1", "termino potencia p1", "tp p1", "pp1"],
  p2: ["p2 potencia", "potencia p2", "termino potencia p2", "tp p2", "pp2"],
  p3: ["p3 potencia", "potencia p3", "termino potencia p3", "tp p3", "pp3"],
  p4: ["p4 potencia", "potencia p4", "termino potencia p4", "tp p4", "pp4"],
  p5: ["p5 potencia", "potencia p5", "termino potencia p5", "tp p5", "pp5"],
  p6: ["p6 potencia", "potencia p6", "termino potencia p6", "tp p6", "pp6"],
  powerUnit: ["unidad potencia", "unitat potencia"],
  gasFixed: ["termino fijo", "fijo dia", "termino fijo gas"],
  sas: ["sas", "mecanismo ajuste", "ajuste"],
  sasValue: ["sas eur kwh", "valor sas", "importe sas"],
  fee: ["cuota", "cuota fija", "servicio", "quota"],
  permanence: ["permanencia", "permanencia meses"],
  penalty: ["penalizacion", "penalitzacio", "penalidad"],
  surplusMode: ["compensacion de excedentes", "compensacion excedentes", "excedentes", "autoconsumo", "modalidad excedentes", "compensacion simplificada"],
  surplusPrice: ["precio excedentes", "precio de excedentes", "excedentes eur kwh", "precio compensacion", "energia excedentaria"],
  battery: ["bateria virtual", "monedero solar", "hucha solar"],
  batteryFee: ["cuota bateria", "coste bateria", "precio bateria virtual"],
  validFrom: ["desde", "inicio", "vigencia desde", "fecha inicio"],
  validTo: ["hasta", "fin", "vigencia hasta", "fecha fin", "validez"],
  minKwh: ["consumo minimo", "consumo min"],
  maxKwh: ["consumo maximo", "consumo max"],
  minKw: ["potencia minima", "potencia min"],
  maxKw: ["potencia maxima", "potencia max"],
  conditions: ["condiciones", "observaciones", "notas"],
  taxes: ["impuestos incluidos", "con impuestos", "iva incluido"],
};

export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Troba la fila de capçaleres (la primera amb ≥ 3 coincidències de sinònims) dins de les 15 primeres. */
export function detectHeaderRow(rows: Cell[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const n = (rows[i] ?? []).map(norm);
    const score = Object.values(SYN).filter((syns) => n.some((h) => h && syns.some((x) => h === x || h.includes(x)))).length;
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return best;
}

/** Mapatge automàtic: coincidència exacta primer, després per inclusió. Cada capçalera s'usa una sola vegada. */
export function autoMap(headers: string[]): Mapping {
  const used = new Set<string>();
  const out: Mapping = {};
  const nh = headers.map((h) => [h, norm(h)] as const);
  for (const pass of ["exact", "include"] as const) {
    for (const [field, syns] of Object.entries(SYN) as [ImportField, string[]][]) {
      if (out[field]) continue;
      const hit = nh.find(([h, n]) => !used.has(h) && n && syns.some((x) => (pass === "exact" ? n === x : n.includes(x))));
      if (hit) {
        out[field] = hit[0];
        used.add(hit[0]);
      }
    }
  }
  return out;
}

/** Número en format espanyol o internacional. Retorna null si està buit o no és un número. */
export function toNumber(v: Cell): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v instanceof Date) return null;
  // es treuen unitats i símbols (€/kWh, %, espais…): només queden xifres, separadors i signe
  let s = String(v).trim().replace(/[^\d,.\-]/g, "");
  if (!s || s === "-") return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toDate(v: Cell): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(+v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const yes = (v: Cell) => /^(s|si|sí|yes|true|1|x|incl)/i.test(String(v ?? "").trim());

export interface RowResult {
  row: number; // fila de l'Excel (1 = primera)
  offer: OfferVersion | null;
  errors: string[];
  warnings: string[];
  status: "nova" | "modificada" | "sense_canvis" | "rebutjada" | "revisio" | "duplicada";
  key: string | null;
}

export interface ImportPreview {
  rows: RowResult[];
  counts: Record<RowResult["status"], number>;
}

/**
 * Converteix les files segons el mapatge i les valida (simulació: no desa res).
 * `existing`: versions actives actuals del catàleg (per detectar canvis i duplicats).
 */
export function previewImport(
  rows: Cell[][],
  headerRow: number,
  mapping: Mapping,
  opts: { defaultSupplier?: string; defaultPowerUnit?: PowerUnit; source: string; existing: OfferVersion[]; today?: string },
): ImportPreview {
  const headers = (rows[headerRow] ?? []).map((h) => String(h ?? "").trim());
  const idx = (f: ImportField) => (mapping[f] ? headers.indexOf(mapping[f]!) : -1);
  const get = (r: Cell[], f: ImportField): Cell => (idx(f) >= 0 ? r[idx(f)] : null);
  const byKey = new Map(opts.existing.map((e) => [productKey(e), e]));
  const seen = new Map<string, number>();
  const out: RowResult[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((v) => v == null || String(v).trim() === "")) continue;
    const errors: string[] = [];
    const warnings: string[] = [];
    const supplier = String(get(r, "supplier") ?? opts.defaultSupplier ?? "").trim();
    const product = String(get(r, "product") ?? "").trim();
    const tRaw = String(get(r, "tariff") ?? "").trim();
    const et = norm(get(r, "energyType"));
    const gas = /gas/.test(et) || /^RL/i.test(tRaw);
    if (!supplier) errors.push("Falta la comercialitzadora");
    if (!product) errors.push("Falta el nom de l'oferta");
    if (!tRaw) errors.push("Falta el peatge d'accés");
    const seg = norm(get(r, "segment"));
    const segments: Segment[] = !seg ? ["residencial", "pyme"] : ([/resid|domest|hogar/.test(seg) && "residencial", /pyme|pime|empresa|negocio/.test(seg) && "pyme", /indus/.test(seg) && "industrial"].filter(Boolean) as Segment[]);
    if (!segments.length) warnings.push(`Segment no reconegut («${get(r, "segment")}»): es deixa residencial i pime`);
    const ct = norm(get(r, "contractType"));
    const e = (["e1", "e2", "e3", "e4", "e5", "e6"] as const).map((f) => toNumber(get(r, f)));
    const e24 = toNumber(get(r, "e24"));
    const contractType: ContractType = /index/.test(ct) ? "indexat" : /mixt/.test(ct) ? "mixt" : /24|unic|fijo unico|plano/.test(ct) || (e24 != null && e.every((x) => x == null)) ? "fix24h" : "periodes";
    const pu = norm(get(r, "powerUnit"));
    const powerUnit: PowerUnit = /any|ano|year/.test(pu) ? "eur_kw_any" : /mes|month/.test(pu) ? "eur_kw_mes" : /dia|day/.test(pu) ? "eur_kw_dia" : (opts.defaultPowerUnit ?? "eur_kw_dia");
    if (!pu && !opts.defaultPowerUnit) warnings.push("Unitat de potència no indicada: s'ha suposat €/kW·dia");
    const sasRaw = norm(get(r, "sas"));
    const sas: SasMode = /variab|aparte|no incl/.test(sasRaw) ? "variable" : /exclu|no aplica/.test(sasRaw) ? "exclos" : "inclos";
    if (!sasRaw) warnings.push("Tractament del SAS no indicat: s'ha suposat inclòs");
    const fee = toNumber(get(r, "fee"));
    const perm = permanenceFromImport(get(r, "permanence") as unknown, { penalty: get(r, "penalty") ? String(get(r, "penalty")).slice(0, 500) : null, source: opts.source ?? null });
    const offer: OfferVersion = {
      ...emptySheet(),
      id: crypto.randomUUID(),
      supplierId: `sup:${slug(supplier)}`,
      supplierName: supplier,
      productId: "",
      productName: product,
      version: 1,
      energyType: gas ? "gas" : "luz",
      accessTariff: normalizeTariff(tRaw) ?? tRaw,
      segments: segments.length ? segments : ["residencial", "pyme"],
      contractType: gas ? "fix24h" : contractType,
      energy: gas ? Array(6).fill(null) : contractType === "indexat" ? Array(6).fill(null) : e,
      energy24h: gas ? (e24 ?? e[0]) : e24,
      power: (["p1", "p2", "p3", "p4", "p5", "p6"] as const).map((f) => toNumber(get(r, f))),
      powerUnit,
      gasFixedEurDay: toNumber(get(r, "gasFixed")),
      taxTreatment: yes(get(r, "taxes")) ? "amb_iee_iva" : "sense_impostos",
      sas: { mode: sas, eurKwh: toNumber(get(r, "sasValue")) },
      fees: fee ? [{ concept: "Quota fixa", eurMonth: fee }] : [],
      discounts: [],
      indexedReference: contractType === "indexat" && e.some((x) => x != null) ? { energy: e, note: "Preus de referència del fitxer importat.", asOf: null } : null,
      permanenceMonths: perm.months,
      permanence: perm,
      penalty: perm.penalty,
      surplus: gas ? null : surplusFromImport({ mode: get(r, "surplusMode"), price: toNumber(get(r, "surplusPrice")), battery: get(r, "battery") == null ? undefined : String(get(r, "battery")), batteryFee: toNumber(get(r, "batteryFee")) }, "excel"),
      durationMonths: null,
      priceGuaranteeMonths: null,
      eligibility: { minKwh: toNumber(get(r, "minKwh")), maxKwh: toNumber(get(r, "maxKwh")), minKw: toNumber(get(r, "minKw")), maxKw: toNumber(get(r, "maxKw")), territories: null, notes: null },
      validFrom: toDate(get(r, "validFrom")),
      validTo: toDate(get(r, "validTo")),
      source: opts.source,
      publishedAt: opts.today ?? new Date().toISOString().slice(0, 10),
      status: "esborrany",
      conditions: get(r, "conditions") ? String(get(r, "conditions")).slice(0, 4000) : null,
      origin: "excel",
    };
    if (offer.taxTreatment !== "sense_impostos") warnings.push("Preus amb impostos inclosos: es convertiran a sense impostos en calcular");
    const check = errors.length ? { ok: false, errors: [], warnings: [], info: [] } : checkVersion(offer);
    errors.push(...check.errors);
    warnings.push(...check.warnings);
    const key = supplier && product && tRaw ? productKey(offer) : null;
    let status: RowResult["status"];
    if (errors.length) status = "rebutjada";
    else if (key && seen.has(key)) status = "duplicada";
    else {
      const prev = key ? byKey.get(key) : undefined;
      if (prev) {
        offer.productId = prev.productId;
        offer.supplierId = prev.supplierId;
        offer.version = prev.version + 1;
      }
      const changed = !prev || JSON.stringify([prev.energy, prev.energy24h, prev.power, prev.powerUnit, prev.gasFixedEurDay, prev.sas, prev.fees, prev.validTo, prev.permanenceMonths, prev.surplus ?? null]) !== JSON.stringify([offer.energy, offer.energy24h, offer.power, offer.powerUnit, offer.gasFixedEurDay, offer.sas, offer.fees, offer.validTo, offer.permanenceMonths, offer.surplus ?? null]);
      status = !prev ? (warnings.length ? "revisio" : "nova") : changed ? (warnings.length ? "revisio" : "modificada") : "sense_canvis";
    }
    if (key && !seen.has(key)) seen.set(key, i + 1);
    if (status === "duplicada") errors.push(`Duplicada de la fila ${seen.get(key!)}`);
    out.push({ row: i + 1, offer: status === "rebutjada" || status === "duplicada" ? null : offer, errors, warnings, status, key });
  }
  const counts = { nova: 0, modificada: 0, sense_canvis: 0, rebutjada: 0, revisio: 0, duplicada: 0 } as ImportPreview["counts"];
  for (const r of out) counts[r.status]++;
  return { rows: out, counts };
}

/** Llegeix CSV (separador ; o ,, amb cometes). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
