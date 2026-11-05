/**
 * Fase 8 · Menú lateral definitiu. Cada opció apunta a una pantalla REAL de l'aplicació (o a una acció real:
 * cercador global, Copilot). Sense enllaços duplicats ni opcions sense funcionalitat. La visibilitat depèn dels
 * PERMISOS de mòdul (mai del nom d'una persona); la interfície només amaga: servidor i RLS tornen a comprovar-ho.
 *
 * Opcions de l'especificació que NO tenen pantalla pròpia i, per tant, no surten al menú (documentat a AUDITORIA_FASE8.md):
 *  - CLIENTS › Documents: els documents viuen a la fitxa de cada client (pestanya Documents); no hi ha cap llistat global.
 *  - CONTRACTACIÓ › Contractes: els contractes vigents són a «Subministraments i contractes» i als expedients.
 */
import {
  BadgePercent, BarChart3, Building2, UsersRound, Bell, BellRing, BrainCircuit, Calculator, CalendarCheck, CalendarClock, CalendarDays, ClipboardCheck, Contact, Cpu, DatabaseZap,
  FileBarChart, FileCheck2, FileClock, FileStack, FileText, Files, Gauge, Handshake, History, KanbanSquare, Landmark, LayoutDashboard, Layers,
  ListChecks, ListTodo, Megaphone, MessageSquareText, Plug, Radar, Scale, Search, SearchCheck, Settings2, ShieldCheck, Sparkles, Store, Sunrise,
  FileWarning, Target, TrendingUp, TriangleAlert, Trophy, UserCircle, UserPlus, Users, Wallet, WandSparkles, Workflow, Zap, Gavel,
  FileSpreadsheet, Receipt, FilePlus2, FilePen, Hourglass, CircleCheckBig, FileMinus2, BookUser, ArrowRightLeft } from "lucide-react";
import type { View } from "@/data/store";

export type NavItem = {
  id: View; label: string; icon: typeof Gauge; key: string;
  params?: Record<string, string>; perm?: string; action?: "read" | "edit" | "approve"; roles?: string[];
  /** acció en comptes de navegació */ run?: "search" | "copilot";
  badge?: "tasks";
};
export type NavGroup = { title: string; tone?: "energy" | "ai"; items: NavItem[] };

const STAFF = ["admin", "cap_administrativa", "administrativa"];
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Inici",
    items: [
      { key: "control", id: "control", label: "Centre de Control", icon: Gauge, perm: "centre_control" },
      { key: "panell-cap", id: "panell-cap", label: "Supervisió", icon: ClipboardCheck, perm: "panell_cap" },
      { key: "panell-equip", id: "panell-equip", label: "El meu equip", icon: UsersRound, perm: "panell_equip", roles: ["cap_equip"] },
      { key: "jornada-admin", id: "jornada-admin", label: "La meva jornada", icon: Sunrise, perm: "jornada_admin", roles: ["administrativa"] },
      { key: "panell-comercial", id: "panell-comercial", label: "La meva jornada", icon: Sunrise, perm: "panell_comercial", roles: ["comercial"] },
      { key: "hoy", id: "hoy", label: "Pla d'avui", icon: CalendarCheck, perm: "renovacions", roles: ["admin", "cap_administrativa"] },
      { key: "agenda", id: "agenda", label: "Agenda", icon: CalendarClock, perm: "agenda" },
      { key: "calendario", id: "calendario", label: "Calendari de venciments", icon: CalendarDays, perm: "renovacions" },
      { key: "tasques", id: "tasques", label: "Tasques", icon: ListTodo, perm: "tasques", badge: "tasks" },
    ],
  },
  {
    title: "Clients",
    items: [
      { key: "clients", id: "clients", label: "Cartera de clients", icon: Contact, perm: "clients" },
      { key: "cartera", id: "cartera", label: "Subministraments", icon: Zap, perm: "clients" },
      { key: "cercador", id: "clients", label: "Cercador global", icon: Search, run: "search" },
    ],
  },
  {
    title: "Comercial",
    items: [
      { key: "leads", id: "leads", label: "Leads", icon: Target, perm: "comercial" },
      { key: "pipeline", id: "pipeline", label: "Oportunitats", icon: Trophy, perm: "comercial" },
      { key: "kanban", id: "kanban", label: "Kanban de renovacions", icon: KanbanSquare, perm: "renovacions" },
      { key: "jornada", id: "jornada", label: "Seguiments", icon: History, perm: "comercial" },
      { key: "rendiment", id: "rendiment", label: "Rendiment comercial", icon: TrendingUp, perm: "comercial" },
    ],
  },
  {
    title: "Energia",
    tone: "energy",
    items: [
      { key: "sips", id: "sips", label: "SIPS", icon: DatabaseZap, perm: "comparatives" },
      { key: "comparatives", id: "comparatives", label: "Comparatives IA", icon: Files, perm: "comparatives" },
      { key: "comparativa", id: "comparativa", label: "Nova comparativa", icon: WandSparkles, perm: "comparatives" },
      { key: "massiva", id: "massiva", label: "Comparatives massives", icon: ListChecks, perm: "comparatives" },
      { key: "optimizer", id: "optimizer", label: "Optimització de potència", icon: Cpu, perm: "comparatives" },
      { key: "tarifes", id: "tarifes", label: "Catàleg de tarifes", icon: Layers, perm: "comparatives" },
      { key: "energia", id: "energia", label: "Anàlisi energètica", icon: Gauge, perm: "comparatives" },
      { key: "radar", id: "radar", label: "Radar comercial", icon: Radar, perm: "comparatives" },
      { key: "mercat", id: "mercat", label: "Mercat elèctric", icon: Store, perm: "comparatives" },
    ],
  },
  {
    title: "Contractació",
    items: [
      { key: "contractacio", id: "contractacio", label: "Expedients", icon: FileStack, perm: "contractacio" },
      { key: "tramitacions", id: "tramitacions", label: "Tramitacions", icon: FileCheck2, perm: "contractacio" },
      { key: "dashboard", id: "dashboard", label: "Renovacions", icon: LayoutDashboard, perm: "renovacions" },
      { key: "incidencies", id: "incidencies", label: "Incidències", icon: TriangleAlert, perm: "incidencies" },
    ],
  },
  {
    title: "Economia",
    items: [
      { key: "economia", id: "economia", label: "Control econòmic", icon: Landmark, perm: "economia" },
      { key: "regles", id: "regles", label: "Comissions", icon: Calculator, perm: "economia" },
      { key: "lector-condicions", id: "comercialitzadores", label: "Lector IA de condicions", icon: Sparkles, params: { lector: "1" }, perm: "comercialitzadores", roles: ["admin", "cap_administrativa", "administrativa"] },
      { key: "comissions", id: "comissions", label: "Marges de tarifes", icon: BadgePercent, perm: "economia" },
      { key: "liquidacions", id: "liquidacions", label: "Liquidacions", icon: Wallet, perm: "comissions" },
      { key: "objectius", id: "economia", label: "Objectius", icon: Target, params: { tab: "ranquing" }, perm: "economia" },
      { key: "meves-comissions", id: "economia", label: "Les meves comissions", icon: TrendingUp, params: { tab: "ranquing" }, perm: "comissions", roles: ["comercial"] },
      { key: "informes-economics", id: "economia", label: "Informes econòmics", icon: BarChart3, params: { tab: "rendibilitat" }, perm: "economia" },
      { key: "conciliacio", id: "conciliacio", label: "Conciliació", icon: Scale, perm: "economia" },
      { key: "auditor", id: "auditor", label: "Auditor de comissions", icon: Gavel, perm: "economia", roles: ["admin", "cap_administrativa", "administrativa"] },
      { key: "reclamacions", id: "reclamacions", label: "Reclamacions", icon: FileWarning, perm: "economia" },
    ],
  },
  {
    // Facturació pròpia d'Assessoria 3.0 (migració 026). Totes les opcions obren la mateixa pantalla amb la secció corresponent.
    title: "Facturació",
    items: [
      { key: "facturacio", id: "facturacio", label: "Panell de facturació", icon: Receipt, perm: "facturacio", roles: STAFF },
      { key: "fact-nova", id: "facturacio", label: "Nova factura", icon: FilePlus2, params: { tab: "nova" }, perm: "facturacio", action: "edit", roles: STAFF },
      { key: "fact-emeses", id: "facturacio", label: "Factures emeses", icon: FileText, params: { tab: "emeses" }, perm: "facturacio", roles: STAFF },
      { key: "fact-esborranys", id: "facturacio", label: "Esborranys", icon: FilePen, params: { tab: "esborranys" }, perm: "facturacio", roles: STAFF },
      { key: "fact-pendents", id: "facturacio", label: "Pendents de cobrar", icon: Hourglass, params: { tab: "pendents" }, perm: "facturacio", roles: STAFF },
      { key: "fact-cobrades", id: "facturacio", label: "Factures cobrades", icon: CircleCheckBig, params: { tab: "cobrades" }, perm: "facturacio", roles: STAFF },
      { key: "fact-rectificatives", id: "facturacio", label: "Factures rectificatives", icon: FileMinus2, params: { tab: "rectificatives" }, perm: "facturacio", roles: STAFF },
      { key: "fact-clients", id: "facturacio", label: "Clients de facturació", icon: BookUser, params: { tab: "clients" }, perm: "facturacio", roles: STAFF },
      { key: "fact-conciliacions", id: "facturacio", label: "Conciliacions per facturar", icon: ArrowRightLeft, params: { tab: "conciliacions" }, perm: "facturacio", roles: STAFF },
      { key: "fact-banc", id: "facturacio", label: "Extractes bancaris", icon: Landmark, params: { tab: "banc" }, perm: "facturacio", roles: STAFF },
      { key: "fact-config", id: "facturacio", label: "Configuració de facturació", icon: Settings2, params: { tab: "configuracio" }, perm: "facturacio", roles: STAFF },
    ],
  },
  {
    title: "Col·laboradors",
    items: [
      { key: "col-gestio", id: "captacio", label: "Gestió", icon: Handshake, params: { tab: "collaboradors" }, perm: "colaboradors" },
      { key: "col-aportats", id: "captacio", label: "Leads i clients aportats", icon: UserPlus, params: { tab: "assignacio" }, perm: "colaboradors" },
      { key: "col-resultats", id: "captacio", label: "Resultats", icon: BarChart3, params: { tab: "panell" }, perm: "colaboradors" },
      { key: "col-campanyes", id: "captacio", label: "Campanyes", icon: Megaphone, params: { tab: "campanyes" }, perm: "colaboradors" },
      { key: "col-liquidacions", id: "liquidacions", label: "Liquidacions", icon: Wallet, params: { tab: "collaboradors" }, perm: "economia" },
    ],
  },
  {
    title: "Intel·ligència",
    tone: "ai",
    items: [
      { key: "ia", id: "ia", label: "Motor d'oportunitats", icon: BrainCircuit, perm: "comercial" },
      { key: "copilot", id: "ia", label: "Copilot IA", icon: Sparkles, run: "copilot" },
      { key: "automatitzacions", id: "ajustes", label: "Automatitzacions", icon: Workflow, params: { tab: "automatitzacions" }, roles: STAFF },
      { key: "centre-alertes", id: "centre-alertes", label: "Alertes", icon: BellRing, perm: "configuracio" },
      { key: "alertes", id: "alertes", label: "Alertes energètiques", icon: Bell, perm: "comparatives" },
    ],
  },
  {
    title: "Administració",
    items: [
      { key: "permisos", id: "permisos", label: "Usuaris i permisos", icon: ShieldCheck, perm: "configuracio", roles: ["admin"] },
      { key: "usuaris", id: "ajustes", label: "Accés i invitacions", icon: Users, params: { tab: "usuarios" }, roles: ["admin"] },
      { key: "equips", id: "equips", label: "Equips comercials", icon: UsersRound, roles: ["admin"] },
      { key: "comercialitzadores", id: "comercialitzadores", label: "Comercialitzadores", icon: Building2, perm: "comercialitzadores", roles: ["admin", "cap_administrativa", "administrativa"] },
      { key: "config", id: "ajustes", label: "Configuració", icon: Settings2 },
      { key: "integracions", id: "ajustes", label: "Integracions", icon: Plug, params: { tab: "integraciones" }, roles: ["admin"] },
      { key: "informes", id: "informes", label: "Informes", icon: FileBarChart, perm: "informes" },
      { key: "exportacions", id: "exportacions", label: "Exportacions a Excel", icon: FileSpreadsheet },
      { key: "estadisticas", id: "estadisticas", label: "Estadístiques de renovacions", icon: BarChart3, perm: "informes" },
      { key: "auditoria", id: "permisos", label: "Auditoria", icon: FileClock, params: { tab: "auditoria" }, perm: "configuracio", roles: ["admin"] },
      { key: "qualitat", id: "qualitat", label: "Qualitat de dades", icon: SearchCheck, perm: "configuracio" },
      { key: "plantillas", id: "plantillas", label: "Plantilles", icon: MessageSquareText, perm: "configuracio" },
      { key: "perfil", id: "perfil", label: "El meu perfil", icon: UserCircle },
    ],
  },
];
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Àlies: vistes de detall que pertanyen a una opció del menú. */
const ALIAS: Partial<Record<View, View>> = { comercialitzadora: "comercialitzadores", fitxa: "energia", "ia-oportunitat": "ia", "captacio-lead": "captacio", client: "clients", oportunitat: "pipeline", expedient: "contractacio", liquidacio: "liquidacions", factura: "facturacio" };

/** Opció activa: la que coincideix amb la vista i amb més paràmetres (p. ex. Configuració vs Integracions). */
export function activeKey(items: NavItem[], view: View, params: Record<string, string>): string | null {
  const v = ALIAS[view] ?? view;
  let best: NavItem | null = null;
  let score = -1;
  for (const n of items) {
    if (n.run || n.id !== v) continue;
    const p = Object.entries(n.params ?? {});
    if (!p.every(([k, x]) => params[k] === x)) continue;
    if (p.length > score) { best = n; score = p.length; }
  }
  return best?.key ?? null;
}

export function visibleItem(n: NavItem, role: string | undefined, can: (perm: string, a?: "read" | "edit" | "approve") => boolean) {
  if (!role || role === "colaborador") return false;
  if (n.roles && !n.roles.includes(role)) return false;
  if (!n.perm || can(n.perm, n.action ?? "read")) return true;
  // la Cap administrativa també veu «Qualitat» i «Alertes» des del seu panell (permís panell_cap)
  return (n.key === "qualitat" || n.key === "centre-alertes") && can("panell_cap");
}

/** Filtre ràpid del menú (insensible a accents i majúscules). */
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/·/g, "").toLowerCase();
export function filterGroups(groups: NavGroup[], q: string) {
  const t = norm(q.trim());
  if (!t) return groups;
  return groups.map((g) => ({ ...g, items: norm(g.title).includes(t) ? g.items : g.items.filter((n) => norm(n.label).includes(t)) })).filter((g) => g.items.length);
}

export type NavPrefs = { fav: string[]; closed: Record<string, boolean>; mini: boolean };
export const DEFAULT_PREFS: NavPrefs = { fav: [], closed: {}, mini: false };
export function cleanPrefs(x: unknown): NavPrefs {
  const o = (x && typeof x === "object" ? x : {}) as Partial<NavPrefs>;
  const keys = new Set(NAV.map((n) => n.key));
  return {
    fav: Array.isArray(o.fav) ? [...new Set(o.fav.filter((k): k is string => typeof k === "string" && keys.has(k)))].slice(0, 12) : [],
    closed: o.closed && typeof o.closed === "object" ? Object.fromEntries(Object.entries(o.closed).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean> : {},
    mini: o.mini === true,
  };
}
