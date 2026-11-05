/**
 * Permisos per mòdul (Fase 7). La font de veritat és la base de dades (role_permissions, user_permissions i la
 * funció has_perm(), que aplica la RLS). Aquest fitxer només descriu els mòduls per a la interfície i el menú.
 *
 * Correspondència dels rols definitius amb els codis interns (no es reanomenen per no trencar les migracions 001-013):
 *   DIRECCIO           → admin               (Joan i Olivié: mateixos drets, cap jerarquia entre ells)
 *   CAP_ADMINISTRATIVA → cap_administrativa
 *   CAP_EQUIP          → cap_equip           (Fase 8.1: entre Direcció i Comercial; veu només el seu equip)
 *   ADMINISTRATIVA     → administrativa
 *   COMERCIAL          → comercial
 *   COLLABORADOR       → colaborador         (només el portal /collaboradors)
 * Cap permís depèn del nom d'una persona: tot va per rol i, si cal, per identificador d'usuari.
 */
import type { Role } from "./types";

export type Action = "read" | "edit" | "approve";
export type Perm = { module: string; can_read: boolean; can_edit: boolean; can_approve: boolean };
export type PermMap = Record<string, { read: boolean; edit: boolean; approve: boolean }>;

export const ROLE_CODE: Record<Role, string> = { admin: "DIRECCIO", cap_administrativa: "CAP_ADMINISTRATIVA", cap_equip: "CAP_EQUIP", administrativa: "ADMINISTRATIVA", comercial: "COMERCIAL", colaborador: "COLLABORADOR" };

export const MODULES: { id: string; label: string; help: string; sensitive?: boolean }[] = [
  { id: "centre_control", label: "Centre de Control", help: "Indicadors globals de Direcció" },
  { id: "panell_cap", label: "Panell de Cap administrativa", help: "Supervisió de l'equip administratiu" },
  { id: "jornada_admin", label: "La meva jornada (administració)", help: "Feina diària de l'administrativa" },
  { id: "panell_comercial", label: "Panell comercial", help: "Resultats i agenda del comercial" },
  { id: "panell_equip", label: "Panell del Cap d'equip", help: "Rendiment, objectius, tasques i alertes del seu equip comercial" },
  { id: "clients", label: "Clients", help: "Fitxes 360°, subministraments i contractes (sempre amb la RLS de cartera)" },
  { id: "comercial", label: "Comercial", help: "Leads, oportunitats i rendiment" },
  { id: "contractacio", label: "Contractació", help: "Expedients, tramitacions i signatures" },
  { id: "renovacions", label: "Renovacions", help: "Kanban de renovacions i venciments" },
  { id: "comparatives", label: "Comparatives IA", help: "Comparatives, tarifes i intel·ligència energètica" },
  { id: "tasques", label: "Tasques", help: "Gestor global de tasques (aprovar = assignar i supervisar)" },
  { id: "agenda", label: "Agenda", help: "Agenda personal i compartida. Edició: cites pròpies i invitacions. Aprovar: assignar cites a altres persones i gestionar les compartides" },
  { id: "incidencies", label: "Incidències", help: "Gestor d'incidències (aprovar = escalar i tancar)" },
  { id: "comissions", label: "Comissions", help: "Lectura: les pròpies. Edició: regles de comissió", sensitive: true },
  { id: "comissions_equip", label: "Comissions de l'equip", help: "Cap d'equip: veure les comissions (capa comercial) dels comercials del seu equip. Mai les de les comercialitzadores", sensitive: true },
  { id: "comercialitzadores", label: "Comercialitzadores", help: "Fitxes, contractes de col·laboració, lectura amb IA i regles de remuneració i retrocessió. Només Direcció i administració autoritzada", sensitive: true },
  { id: "economia", label: "Dades econòmiques restringides", help: "Marges, comissions globals, liquidacions de tercers i conciliació", sensitive: true },
  { id: "facturacio", label: "Facturació", help: "Factures d'Assessoria 3.0, clients de facturació i cobraments. Edició: esborranys i clients. Aprovar: emetre factures i registrar cobraments", sensitive: true },
  { id: "colaboradors", label: "Col·laboradors", help: "Captació, col·laboradors i atribucions" },
  { id: "informes", label: "Informes", help: "Informes diaris, setmanals i mensuals (cadascú dins del seu abast)" },
  { id: "productivitat", label: "Productivitat", help: "Activitat registrada de l'equip (sense cap monitoratge ocult)" },
  { id: "documents", label: "Documents", help: "Gestor documental (sempre amb la RLS del client)" },
  { id: "configuracio", label: "Configuració", help: "Configuració empresarial, automatitzacions i integracions", sensitive: true },
  { id: "portal", label: "Portal de col·laboradors", help: "Només per al rol col·laborador" },
];

export function toMap(rows: Perm[] | null | undefined): PermMap {
  const m: PermMap = {};
  for (const r of rows ?? []) m[r.module] = { read: !!(r.can_read || r.can_edit || r.can_approve), edit: !!r.can_edit, approve: !!r.can_approve };
  return m;
}

/** Comprovació a la interfície (la decisió real la pren el servidor i la RLS). */
export function can(role: Role | undefined, perms: PermMap | null | undefined, module: string, action: Action = "read") {
  if (role === "admin") return true;
  return !!perms?.[module]?.[action];
}

/** Vista → mòdul que la governa (per amagar el menú; el servidor ho torna a comprovar). */
export const VIEW_MODULE: Record<string, string> = {
  control: "centre_control", "panell-cap": "panell_cap", "panell-equip": "panell_equip", comercialitzadores: "comercialitzadores", comercialitzadora: "comercialitzadores", "jornada-admin": "jornada_admin", "panell-comercial": "panell_comercial",
  clients: "clients", client: "clients", cartera: "clients",
  jornada: "comercial", leads: "comercial", pipeline: "comercial", oportunitat: "comercial", rendiment: "comercial", ia: "comercial", "ia-oportunitat": "comercial",
  contractacio: "contractacio", tramitacions: "contractacio", expedient: "contractacio",
  kanban: "renovacions", dashboard: "renovacions", hoy: "renovacions", calendario: "renovacions", propuestas: "renovacions",
  comparativa: "comparatives", comparatives: "comparatives", tarifes: "comparatives", massiva: "comparatives", sips: "comparatives", energia: "comparatives", fitxa: "comparatives", radar: "comparatives", optimizer: "comparatives", alertes: "comparatives", mercat: "comparatives",
  tasques: "tasques", incidencies: "incidencies", agenda: "agenda",
  economia: "economia", conciliacio: "economia", reclamacions: "economia", regles: "economia", liquidacions: "comissions", liquidacio: "comissions", comissions: "economia",
  facturacio: "facturacio", factura: "facturacio",
  captacio: "colaboradors", "captacio-lead": "colaboradors",
  informes: "informes", estadisticas: "informes", productivitat: "productivitat",
  "centre-alertes": "configuracio", qualitat: "configuracio", permisos: "configuracio", plantillas: "configuracio",
};

/** Equivalència de la Fase 6 (sense la migració 014): mateix comportament que abans, per rol. */
export function legacyPerms(role: string): PermMap {
  const all = (r = true, e = true, a = false) => ({ read: r, edit: e, approve: a });
  const staff = ["admin", "cap_administrativa", "administrativa"].includes(role);
  const m: PermMap = {};
  for (const x of MODULES) m[x.id] = { read: false, edit: false, approve: false };
  if (staff) for (const k of ["clients", "comercial", "contractacio", "renovacions", "comparatives", "tasques", "incidencies", "documents", "informes", "economia", "comissions", "colaboradors"]) m[k] = all();
  if (role === "cap_administrativa") { m.panell_cap = all(); m.tasques = all(true, true, true); m.incidencies = all(true, true, true); m.productivitat = all(true, false); }
  if (role === "administrativa") m.jornada_admin = all();
  if (role === "cap_administrativa") m.facturacio = all(true, true, true);
  if (role === "administrativa") m.facturacio = all(true, true, false);
  if (role === "cap_equip") { for (const k of ["clients", "contractacio", "renovacions", "informes", "documents"]) m[k] = all(true, false); for (const k of ["comercial", "comparatives", "incidencies", "panell_equip"]) m[k] = all(); m.tasques = all(true, true, true); }
  if (role === "comercial") for (const k of ["clients", "comercial", "renovacions", "comparatives", "tasques", "incidencies", "documents", "panell_comercial", "informes"]) m[k] = all();
  if (role === "comercial") m.comissions = all(true, false);
  if (role === "colaborador") m.portal = all();
  if (role !== "colaborador") m.agenda = all(true, true, ["cap_administrativa", "cap_equip"].includes(role)); // Fase 10 (sense la 020 aplicada)
  return m;
}
