import { DEFAULT_WEIGHTS } from "@/core/priority";
import type { Settings, User } from "@/core/types";

export const DEFAULT_SETTINGS: Settings = {
  horizonteDias: 90,
  alertas: [60, 30, 15, 7],
  seguimientoDias: 3,
  pesos: DEFAULT_WEIGHTS,
  iee: 5.11269632,
  iva: 21,
  alquilerContadorMes: 0,
  validezOfertaDias: 15,
  empresa: {
    nombre: "Assessoria 3.0",
    telefono: "",
    email: "info@assessoria30.com",
    web: "",
    direccion: "",
  },
};

/** Demo users (only used by the local demo repository). Codes match "ADMIN GESTIONO" in the source sheet. */
export const DEMO_USERS: User[] = [
  { id: "u-admin", name: "Administració", email: "info@assessoria30.com", role: "admin", code: null },
  { id: "u-cap", name: "Cap administrativa", email: "cap@demo.local", role: "cap_administrativa", code: null },
  { id: "u-adm", name: "Administrativa", email: "administrativa@demo.local", role: "administrativa", code: null },
  { id: "u-ibeth", name: "Ibeth", email: "ibeth@demo.local", role: "comercial", code: "IBETH" },
  { id: "u-irene", name: "Irene", email: "irene@demo.local", role: "comercial", code: "IRENE" },
  { id: "u-olivie", name: "Olivié", email: "olivie@demo.local", role: "comercial", code: "OLIVIE" },
  { id: "u-weeko", name: "Weeko", email: "weeko@demo.local", role: "comercial", code: "WEEKO" },
  { id: "u-jenni", name: "Jenni", email: "jenni@demo.local", role: "comercial", code: "JENNI" },
  { id: "u-col-finques", name: "Antonio Finques (col·laborador)", email: "finquesronda@gmail.com", role: "colaborador", code: "COL. ANTONIO FINQUES" },
];

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
