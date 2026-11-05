import type { TariffCode } from "./tariffs";

export type CellValue = string | number | boolean | null;
export type Num = number | null;

export interface SupplySource {
  file: string;
  sheet: string;
  row: number; // fila en el Excel (1 = cabecera)
  importedAt: string; // ISO
  demo: boolean;
  /**
   * Procedència dins de la plataforma unificada:
   *  - excel: importació d'un fitxer PuntoSuministro_*.xlsx (es desa en aquest navegador)
   *  - portal: afegit des del Buscador SIPS (es desa en aquest navegador)
   *  - crm: dades SIPS de Supabase (sips_cache) dels contractes visibles; es recarrega a cada sessió
   */
  origin?: "excel" | "portal" | "crm";
}

/** Suministro normalizado. `raw` conserva TODAS las columnas originales. */
export interface Supply {
  id: string;
  cups: string;
  cupsValid: boolean;
  cupsIssue?: string;
  tipoEnergia: string | null;
  direccion: string | null;
  provincia: string | null;
  localidad: string | null;
  cp: string | null;
  distribuidora: string | null;
  comercializadora: string | null;
  tarifaRaw: string | null;
  tarifa: TariffCode | null;
  potContratada: Num[]; // 6
  potMaxBIE: Num;
  potMaxAPM: Num;
  potAnual: Num;
  potMensual: Num[]; // 12
  potCGP: string | null;
  derechosExtension: Num;
  derechosAcceso: Num;
  eaAnual: Num;
  eaMensual: Num[];
  erAnual: Num;
  erMensual: Num[];
  tension: Num;
  tipoPMRaw: string | null;
  tipoPM: number | null;
  perfil: string | null;
  ctrlPotencia: string | null;
  telegestion: string | null;
  autoconsumo: string | null;
  tipoContratoATR: string | null;
  perFacturacion: string | null;
  cnae: string | null;
  contratableRaw: string | null;
  contratable: boolean | null;
  motivoNoContratable: string | null;
  impagos: string | null;
  fAlta: string | null;
  fUltLectura: string | null;
  fUltCambioComer: string | null;
  fUltMovContrato: string | null;
  fCaducidadBIE: string | null;
  fCaducidadAPM: string | null;
  fLimiteDerechos: string | null;
  raw: Record<string, CellValue>;
  source: SupplySource;
}

export interface ImportReport {
  file: string;
  sheet: string;
  importedAt: string;
  totalRows: number;
  imported: number;
  headerCount: number;
  recognized: string[];
  missing: string[];
  extra: string[];
  duplicates: string[];
  invalidCups: string[];
  emptyRows: number;
  warnings: string[];
  demo: boolean;
}

/* ---------- CRM ---------- */
export type OppStatus = "nueva" | "contactada" | "propuesta" | "negociacion" | "ganada" | "perdida";

export interface CrmNote {
  id: string;
  date: string;
  author: string;
  text: string;
}
export interface CrmCall {
  id: string;
  date: string;
  author: string;
  result: "contactado" | "no_contesta" | "rellamar" | "interesado" | "no_interesado";
  notes: string;
}
export interface CrmProposal {
  id: string;
  date: string;
  author: string;
  kind: "optimizacion" | "comparativa" | "informe";
  summary: string;
  estSavingEur: number | null;
}
export interface Opportunity {
  cups: string;
  marked: boolean;
  status: OppStatus;
  owner: string;
  notes: CrmNote[];
  calls: CrmCall[];
  proposals: CrmProposal[];
  updatedAt: string;
  externalId?: string; // id en el CRM de Assessoria 3.0 (futura integración)
  currentOfferId?: string; // condiciones actuales del cliente (Energy Market)
}
