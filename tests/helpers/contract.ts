/** Contracte fictici per a les proves (cap dada real). */
import type { Contract, Status } from "../../src/core/types";

let n = 0;
export function mkContract(o: Partial<Contract> & { status?: Status; venc?: string | null } = {}): Contract {
  const id = o.id ?? `ct-${++n}`;
  const { status = "pendiente", venc = "2026-12-01", crm, ...rest } = o;
  return {
    id, cups: `ES00210000000000${String(n).padStart(2, "0")}AA`, cif: null, cliente: `Titular Ficticí ${n}`, direccion: null, poblacion: "Lleida", provincia: null, cp: null,
    telefono: null, email: null, tipo: "luz", comercializadora: "Comercialitzadora Prova", comercializadoraAnterior: null, tarifa: "2.0TD", producto: null, precioContratado: null,
    consumoAnual: 3000, potencia: null, potencias: null, estadoOrigen: null, estadoAlta: null, tipoAlta: null, excedentes: null, observaciones: null, comentario: null,
    comentarioLlamada: null, renovat2026: null, representante: null, captador: null, comercial: "C1", colaborador: null, fechaInicio: null, fechaInicioFuente: null,
    vencimientoOriginal: venc, vencimiento: venc, renovacionTacita: false, fechaBaja: null, contratosPrevios: 0, registrosDiarios: 0, status, motivoRechazo: null, source: "demo",
    ...rest,
    crm: { contractId: id, status, statusChangedAt: "2026-10-01", statusChangedBy: "prova", version: 1, ...(crm ?? {}) },
  } as Contract;
}
