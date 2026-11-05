import { COLUMNS, COLUMN_BY_NORM, MONTHS, normHeader } from "./columns";
import { normalizeCups, validateCups } from "./cups";
import { normalizeTariff } from "./tariffs";
import type { CellValue, ImportReport, Num, Supply } from "./types";

type InCell = string | number | boolean | Date | null | undefined;

/** Convierte números en formato español ("1.234,56") o numérico nativo. */
export function toNum(v: InCell): Num {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v instanceof Date) return null;
  let s = v.trim().replace(/\s/g, "").replace(/[€%]/g, "");
  if (!s || s === "-") return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Fecha → ISO (YYYY-MM-DD). Acepta Date, serial Excel y dd/mm/aaaa. */
export function toIsoDate(v: InCell): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(+v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (v < 1 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toText(v: InCell): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toCell(v: InCell): CellValue {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v;
}

export function parseYesNo(v: string | null): boolean | null {
  if (!v) return null;
  const s = v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  if (["S", "SI", "TRUE", "1", "Y", "YES", "VERDADERO"].includes(s)) return true;
  if (["N", "NO", "FALSE", "0", "FALSO"].includes(s)) return false;
  return null;
}

export function parseMeterType(v: string | null): number | null {
  if (!v) return null;
  const m = /([1-5])/.exec(v);
  return m ? Number(m[1]) : null;
}

/**
 * Convierte la matriz de la hoja (fila 0 = cabecera) en suministros normalizados.
 * - Ninguna columna se descarta (todas en `raw` con su cabecera original).
 * - CUPS duplicados: se conserva la última aparición y se informa.
 */
export function parseRows(
  rows: InCell[][],
  meta: { file: string; sheet: string; demo?: boolean; importedAt?: string },
): { supplies: Supply[]; report: ImportReport } {
  const importedAt = meta.importedAt ?? new Date().toISOString();
  const header = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const n = normHeader(h);
    if (n && !idx.has(n)) idx.set(n, i);
  });
  const recognized = header.filter((h) => COLUMN_BY_NORM.has(normHeader(h)));
  const missing = COLUMNS.filter((c) => !idx.has(normHeader(c.header))).map((c) => c.header);
  const extra = header.filter((h) => h && !COLUMN_BY_NORM.has(normHeader(h)));
  const warnings: string[] = [];
  if (!idx.has(normHeader("CUPS"))) warnings.push("No se ha encontrado la columna CUPS: no es posible identificar suministros.");
  if (missing.length) warnings.push(`${missing.length} columnas esperadas no están en el fichero; sus campos quedarán vacíos.`);

  const get = (r: InCell[], header: string): InCell => {
    const i = idx.get(normHeader(header));
    return i == null ? null : r[i];
  };

  const byCups = new Map<string, Supply>();
  const duplicates: string[] = [];
  const invalid: string[] = [];
  let emptyRows = 0;

  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri] ?? [];
    if (r.every((v) => v == null || String(v).trim() === "")) {
      emptyRows++;
      continue;
    }
    const cups = normalizeCups(get(r, "CUPS"));
    if (!cups) {
      warnings.push(`Fila ${ri + 1}: sin CUPS, se omite (los datos no pueden asociarse a un suministro).`);
      continue;
    }
    const v = validateCups(cups);
    if (!v.valid) invalid.push(cups);

    const raw: Record<string, CellValue> = {};
    header.forEach((h, i) => {
      if (h) raw[h] = toCell(r[i]);
    });
    const tarifaRaw = toText(get(r, "Tarifa"));
    const tipoPMRaw = toText(get(r, "Tipo P.M."));
    const contratableRaw = toText(get(r, "Contratable"));

    const s: Supply = {
      id: cups,
      cups,
      cupsValid: v.valid,
      cupsIssue: v.reason,
      tipoEnergia: toText(get(r, "Tipo Energía")),
      direccion: toText(get(r, "Dirección")),
      provincia: toText(get(r, "Provincia")),
      localidad: toText(get(r, "Localidad")),
      cp: toText(get(r, "Código Postal")),
      distribuidora: toText(get(r, "Distribuidora")),
      comercializadora: toText(get(r, "Comercializadora")),
      tarifaRaw,
      tarifa: normalizeTariff(tarifaRaw).code,
      potContratada: [1, 2, 3, 4, 5, 6].map((p) => toNum(get(r, `Pot. P${p} (kW)`))),
      potMaxBIE: toNum(get(r, "Pot. Máx. BIE (kW)")),
      potMaxAPM: toNum(get(r, "Pot. Máx. APM (kW)")),
      potAnual: toNum(get(r, "Pot. Anual (kW)")),
      potMensual: MONTHS.map((m) => toNum(get(r, `Pot. ${m} (kW)`))),
      potCGP: toText(get(r, "Potencia CGP")),
      derechosExtension: toNum(get(r, "Derechos Extensión (kW)")),
      derechosAcceso: toNum(get(r, "Derechos Acceso (kW)")),
      eaAnual: toNum(get(r, "E.A. Anual (kWh)")),
      eaMensual: MONTHS.map((m) => toNum(get(r, `E.A. ${m} (kWh)`))),
      erAnual: toNum(get(r, "E.R. Anual (kVArh)")),
      erMensual: MONTHS.map((m) => toNum(get(r, `E.R. ${m} (kVArh)`))),
      tension: toNum(get(r, "Tensión (V)")),
      tipoPMRaw,
      tipoPM: parseMeterType(tipoPMRaw),
      perfil: toText(get(r, "Tipo Perfil Consumo")),
      ctrlPotencia: toText(get(r, "Ctrl Potencia")),
      telegestion: toText(get(r, "Telegestión")),
      autoconsumo: toText(get(r, "Autoconsumo")),
      tipoContratoATR: toText(get(r, "Tipo Contrato ATR")),
      perFacturacion: toText(get(r, "Per. Facturación")),
      cnae: toText(get(r, "CNAE")),
      contratableRaw,
      contratable: parseYesNo(contratableRaw),
      motivoNoContratable: toText(get(r, "Motivo NO Contratable")),
      impagos: toText(get(r, "Informacion Impagos")),
      fAlta: toIsoDate(get(r, "F. Alta")),
      fUltLectura: toIsoDate(get(r, "F. Últ. Lectura")),
      fUltCambioComer: toIsoDate(get(r, "F. Últ. Cambio Comer.")),
      fUltMovContrato: toIsoDate(get(r, "F. Últ. Mov. Contrato")),
      fCaducidadBIE: toIsoDate(get(r, "F. Caducidad BIE")),
      fCaducidadAPM: toIsoDate(get(r, "F. Caducidad APM")),
      fLimiteDerechos: toIsoDate(get(r, "F. Límite Derechos Reconocidos")),
      raw,
      source: { file: meta.file, sheet: meta.sheet, row: ri + 1, importedAt, demo: !!meta.demo },
    };
    if (byCups.has(cups)) duplicates.push(cups);
    byCups.set(cups, s);
  }

  const supplies = [...byCups.values()];
  if (rows.length <= 1) warnings.push("El fichero contiene solo la fila de cabeceras: no hay suministros que importar.");
  if (duplicates.length)
    warnings.push(`${duplicates.length} CUPS repetidos: se conserva la última fila de cada uno para no duplicar consumos.`);

  return {
    supplies,
    report: {
      file: meta.file,
      sheet: meta.sheet,
      importedAt,
      totalRows: Math.max(0, rows.length - 1),
      imported: supplies.length,
      headerCount: header.filter(Boolean).length,
      recognized,
      missing,
      extra,
      duplicates: [...new Set(duplicates)],
      invalidCups: [...new Set(invalid)],
      emptyRows,
      warnings,
      demo: !!meta.demo,
    },
  };
}

/* ---------- Agregados de consumo (sin duplicar) ---------- */

export function sumKnown(a: Num[]): { sum: number; known: number } {
  let sum = 0;
  let known = 0;
  for (const x of a) if (x != null) {
    sum += x;
    known++;
  }
  return { sum, known };
}

/**
 * Consumo anual de referencia: el campo "E.A. Anual" del origen. Nunca se suma
 * con los mensuales (evita duplicar). Si falta, se usa la suma mensual solo con 12 meses.
 */
export function annualActive(s: Supply): { value: number | null; basis: "anual" | "suma12" | "none" } {
  if (s.eaAnual != null) return { value: s.eaAnual, basis: "anual" };
  const { sum, known } = sumKnown(s.eaMensual);
  if (known === 12) return { value: sum, basis: "suma12" };
  return { value: null, basis: "none" };
}

export function maxContracted(s: Supply): number | null {
  const v = s.potContratada.filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : null;
}

export function maxMonthlyDemand(s: Supply): number | null {
  const v = s.potMensual.filter((x): x is number => x != null);
  if (v.length) return Math.max(...v);
  return s.potAnual;
}
