export type Status = "pendiente" | "contactado" | "renovado" | "no_renueva";
export type SupplyKind = "luz" | "gas" | "telefonia" | "dual";
export type Role = "admin" | "cap_administrativa" | "cap_equip" | "administrativa" | "comercial" | "colaborador";

/** Contract as imported from the source spreadsheets (read-only for the CRM). */
export interface SourceContract {
  id: string;
  cups: string | null;
  cif: string | null;
  cliente: string;
  clienteOriginal?: string | null;
  direccion: string | null;
  poblacion: string | null;
  provincia: string | null;
  cp: string | null;
  telefono: string | null;
  email: string | null;
  tipo: SupplyKind;
  comercializadora: string | null;
  comercializadoraAnterior: string | null;
  tarifa: string | null;
  producto: string | null;
  precioContratado: string | null;
  consumoAnual: number | null;
  potencia: number | null;
  potencias: (number | null)[] | null;
  estadoOrigen: string | null;
  estadoAlta: string | null;
  tipoAlta: string | null;
  excedentes: string | null;
  observaciones: string | null;
  comentario: string | null;
  comentarioLlamada: string | null;
  renovat2026: string | null;
  representante: string | null;
  captador: string | null;
  comercial: string;
  colaborador: string | null;
  /** Enllaç verificat amb la fitxa cap_partners per coincidència única d'email. */
  colaboradorPartnerId?: string | null;
  colaboradorPartnerName?: string | null;
  /** Estat de vinculació del propietari importat; no modifica el correu original. */
  colaboradorLinkStatus?: "vinculat" | "pendent" | "ambigu" | "intern";
  fechaInicio: string | null;
  fechaInicioFuente: "activacion" | "tramitacion" | "registro_diario" | "importacion_crm" | null;
  vencimientoOriginal: string | null;
  vencimiento: string | null;
  renovacionTacita: boolean;
  fechaBaja: string | null;
  contratosPrevios: number;
  registrosDiarios: number;
  /** Initial Kanban status derived from the source (only used if the CRM has no state yet). */
  status: Status;
  motivoRechazo: string | null;
  source: "real" | "demo";
}

/** State owned by the CRM. Never overwritten by a sync. */
export interface CrmState {
  contractId: string;
  status: Status;
  statusChangedAt: string;
  statusChangedBy: string;
  motivoRechazo?: string | null;
  nuevaFechaVencimiento?: string | null;
  condicionesRenovacion?: string | null;
  proximaAccion?: string | null;
  proximaAccionFecha?: string | null;
  ultimoContacto?: string | null;
  propuestaEnviada?: string | null;
  telefonoOverride?: string | null;
  emailOverride?: string | null;
  consumoOverride?: number | null;
  version: number;
}

export type ActivityType = "status" | "whatsapp" | "email" | "call" | "note" | "pdf" | "task" | "renewal" | "sync";
export type Delivery = "preparado" | "enviado" | "entregado" | "error";

export interface Activity {
  id: string;
  contractId: string;
  type: ActivityType;
  at: string;
  by: string;
  title: string;
  body?: string;
  delivery?: Delivery;
  meta?: Record<string, unknown>;
}

export interface Task {
  id: string;
  contractId: string | null;
  title: string;
  due: string; // ISO date
  assignee: string;
  done: boolean;
  createdAt: string;
  createdBy: string;
  kind: "llamada" | "seguimiento" | "propuesta" | "otro";
}

export interface ProposalDoc {
  id: string;
  contractId: string;
  version: number;
  createdAt: string;
  createdBy: string;
  offerId: string;
  fileName: string;
  ahorroAnual: number | null;
  storagePath?: string | null;
}

export interface Offer {
  id: string;
  comercializadora: string;
  nombre: string;
  tarifa: string; // 2.0TD, 3.0TD, 6.1TD, RL1...
  energia: (number | null)[]; // €/kWh per period
  potencia: (number | null)[]; // €/kW·día per period
  cuotaFijaMes?: number | null; // €/mes (servicios)
  fijoDia?: number | null; // €/día (gas: término fijo)
  validaHasta: string;
  verificada: boolean;
  verificadaPor?: string | null;
  notas?: string | null;
  ventajas?: string[];
  tipo?: "luz" | "gas";
  /** Extra information from the ZocoProductos template (informative, not used in calculations unless stated). */
  meta?: {
    origen?: "plantilla" | "manual";
    tipoPrecio?: string | null; // Fijo, Fijo-Variable, Indexado
    mesIndexado?: string | null;
    ambito?: string | null;
    residencial?: boolean | null;
    pyme?: boolean | null;
    excedentes?: string | null;
    potenciaMin?: number | null; potenciaMax?: number | null;
    consumoMin?: number | null; consumoMax?: number | null;
    feePotencia?: { unico?: string | null; min?: number | null; max?: number | null };
    feeEnergia?: { unico?: string | null; min?: number | null; max?: number | null };
    dual?: boolean;
  };
}

export interface Template {
  id: string;
  name: string;
  channel: "whatsapp" | "email";
  subject?: string;
  body: string;
  builtIn?: boolean;
}

export interface PriorityWeights {
  proximidad: number;
  consumo: number;
  valor: number;
  sinContacto: number;
  estado: number;
  seguimientos: number;
  riesgo: number;
}

export interface Settings {
  horizonteDias: number;
  alertas: number[];
  seguimientoDias: number;
  pesos: PriorityWeights;
  iee: number; // % impuesto eléctrico
  iva: number; // %
  alquilerContadorMes: number;
  validezOfertaDias: number;
  logo?: string | null; // data URL used in PDFs
  empresa: { nombre: string; telefono: string; email: string; web: string; direccion: string };
  /** Objectiu de renovacions per mes (Dashboard executiu). Opcional. */
  objetivoRenovacionesMes?: number | null;
  /** Agrupació de renovacions per contacte: finestra de proximitat en dies (7, 15, 30, 45, 60 o 90). Per defecte 30. */
  agrupacioDies?: number | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Code used in the source sheet (ADMIN GESTIONO), e.g. IBETH */
  code: string | null;
}

export interface Contract extends SourceContract {
  crm: CrmState;
}

export interface Integrations {
  supabase: boolean;
  googleSync: boolean;
  smtp: boolean;
  ai: boolean;
  whatsappCloud: boolean;
}
