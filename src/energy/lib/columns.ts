/**
 * Registro canónico de las 97 columnas de la exportación SIPS
 * `PuntoSuministro_*.xlsx` (hoja Page1). Cada columna se identifica por su
 * cabecera normalizada, de modo que la importación tolera variaciones de
 * acentos, mayúsculas y espacios ("Informacion Impagos" / "Información Impagos").
 *
 * Ninguna columna se descarta: las no registradas se conservan en `raw`.
 */

export type ColumnKind = "text" | "number" | "date" | "bool";
export type ColumnGroup =
  | "identificacion"
  | "potencia"
  | "potenciaTecnica"
  | "consumo"
  | "reactiva"
  | "tecnica"
  | "administrativa"
  | "otros";

export interface ColumnDef {
  header: string;
  group: ColumnGroup;
  kind: ColumnKind;
  unit?: string;
  help?: string;
}

export const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const c = (header: string, group: ColumnGroup, kind: ColumnKind, unit?: string, help?: string): ColumnDef => ({
  header,
  group,
  kind,
  unit,
  help,
});

/** Orden exacto del fichero original (97 columnas). */
export const COLUMNS: ColumnDef[] = [
  c("Tipo Energía", "identificacion", "text"),
  c("CUPS", "identificacion", "text", undefined, "Código Universal de Punto de Suministro"),
  c("Dirección", "identificacion", "text"),
  c("Provincia", "identificacion", "text"),
  c("Localidad", "identificacion", "text"),
  c("Código Postal", "identificacion", "text"),
  c("Distribuidora", "identificacion", "text"),
  c("Comercializadora", "identificacion", "text"),
  c("Tarifa", "identificacion", "text", undefined, "Peaje de acceso (2.0TD, 3.0TD, 6.xTD)"),
  ...[1, 2, 3, 4, 5, 6].map((p) =>
    c(`Pot. P${p} (kW)`, "potencia", "number", "kW", `Potencia contratada en el periodo P${p}`),
  ),
  c("F. Alta", "administrativa", "date"),
  c("Tensión (V)", "tecnica", "number", "V"),
  c("Pot. Máx. BIE (kW)", "potenciaTecnica", "number", "kW", "Potencia máxima admisible según el Boletín de Instalación Eléctrica (autorizada, no medida)"),
  c("Pot. Máx. APM (kW)", "potenciaTecnica", "number", "kW", "Potencia máxima según el Acta de Puesta en Marcha (autorizada, no medida)"),
  c("Tipo P.M.", "tecnica", "text", undefined, "Tipo de punto de medida (1 a 5)"),
  c("Disp. ICP", "tecnica", "text"),
  c("Tipo Perfil Consumo", "tecnica", "text"),
  c("Derechos Extensión (kW)", "potenciaTecnica", "number", "kW", "Potencia con derechos de extensión reconocidos"),
  c("Derechos Acceso (kW)", "potenciaTecnica", "number", "kW", "Potencia con derechos de acceso reconocidos"),
  c("Prop. E.M.", "tecnica", "text"),
  c("Prop. ICP", "tecnica", "text"),
  c("F. Últ. Mov. Contrato", "administrativa", "date"),
  c("F. Últ. Cambio Comer.", "administrativa", "date"),
  c("F. Límite Derechos Reconocidos", "administrativa", "date"),
  c("F. Últ. Lectura", "administrativa", "date"),
  c("Informacion Impagos", "administrativa", "text"),
  c("Importe Deposito Garantía (€)", "administrativa", "number", "€"),
  c("Tipo Id. Titular", "administrativa", "text"),
  c("Vivienda Habitual", "administrativa", "text"),
  c("Telegestión", "tecnica", "text"),
  c("Fases E.M.", "tecnica", "text"),
  c("Autoconsumo", "tecnica", "text"),
  c("Tipo Contrato ATR", "tecnica", "text"),
  c("Per. Facturación", "tecnica", "text"),
  c("Código BIE", "administrativa", "text"),
  c("F. Emisión BIE", "administrativa", "date"),
  c("F. Caducidad BIE", "administrativa", "date"),
  c("Código APM", "administrativa", "text"),
  c("F. Emisión APM", "administrativa", "date"),
  c("F. Caducidad APM", "administrativa", "date"),
  c("Relación Trans. Intensidad", "tecnica", "text"),
  c("CNAE", "tecnica", "text"),
  c("Ctrl Potencia", "tecnica", "text", undefined, "Sistema de control de potencia (ICP / maxímetro)"),
  c("Potencia CGP", "potenciaTecnica", "text", undefined, "Potencia/intensidad de la Caja General de Protección"),
  c("Tipo D.H. E.M.", "tecnica", "text"),
  c("Acceso Contador", "tecnica", "text"),
  c("Contratable", "administrativa", "text"),
  c("Motivo NO Contratable", "administrativa", "text"),
  c("Tensión E.M. (V)", "tecnica", "number", "V"),
  c("Tipo Exp.", "administrativa", "text"),
  c("Motivo Exp.", "administrativa", "text"),
  c("Tipo Suministro", "tecnica", "text"),
  c("Bono Social", "administrativa", "text"),
  c("E.A. Anual (kWh)", "consumo", "number", "kWh", "Energía activa consumida en los últimos 12 meses"),
  c("E.R. Anual (kVArh)", "reactiva", "number", "kVArh", "Energía reactiva registrada en los últimos 12 meses"),
  c("Pot. Anual (kW)", "potenciaTecnica", "number", "kW", "Potencia máxima demandada registrada en el año (medida, agregada)"),
  ...MONTHS.map((m) => c(`E.A. ${m} (kWh)`, "consumo", "number", "kWh")),
  ...MONTHS.map((m) => c(`E.R. ${m} (kVArh)`, "reactiva", "number", "kVArh")),
  ...MONTHS.map((m) => c(`Pot. ${m} (kW)`, "potenciaTecnica", "number", "kW")),
];

export const GROUP_LABELS: Record<ColumnGroup, string> = {
  identificacion: "Datos identificativos",
  potencia: "Potencia contratada",
  potenciaTecnica: "Potencias técnicas y máximas",
  consumo: "Consumo activo",
  reactiva: "Energía reactiva",
  tecnica: "Condiciones técnicas",
  administrativa: "Situación administrativa",
  otros: "Otras columnas",
};

/** Normaliza una cabecera: sin acentos, minúsculas, solo alfanuméricos. */
export function normHeader(h: unknown): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export const COLUMN_BY_NORM = new Map(COLUMNS.map((col) => [normHeader(col.header), col]));
