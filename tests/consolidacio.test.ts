/**
 * FASE 7 · Consolidació: permisos per rol, Centre de Control, panells, tasques, escalats, qualitat, informes i portal.
 * La numeració «Pn» segueix les 20 proves obligatòries del prompt (secció 16). La part de RLS real (PostgreSQL)
 * és a tests/db/crm-consolidacio-rls.test.ts; aquí es prova el servidor amb un client en memòria.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase>; current: { id: string; role: string } | null } = { sb: fakeSupabase(), current: null };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return {
    adminClient: () => state.sb, HttpError, handler: () => () => null,
    requireUser: async () => { if (!state.current) throw new HttpError(401, "No has iniciat sessió"); return user(state.current.id, state.current.role); },
  };
});
vi.mock("@/server/mailer", () => ({ smtpReady: async () => false, sendCorporateMail: async () => { throw new Error("no s'ha d'enviar"); } }));

import { DEFAULT_TEMPLATE, KPI, KPI_DEFS, TEMPLATES, WIDGETS, detectQuality, operationalKpis, periodRange, planEscalations, productivity, sanitizeLayout } from "@/core/control";
import { MODULES, legacyPerms } from "@/core/permissions";
import { planAutomations } from "@/core/sales";
import { publicFormSchema } from "@/core/capture";

/* ------------------------------------------------------------------ permisos per defecte, llegits de la migració real */
const SQL = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/014_consolidacio.sql"), "utf8");
const DEFAULTS = [...SQL.slice(SQL.indexOf("insert into public.role_permissions"), SQL.indexOf("on conflict (role, module) do nothing")).matchAll(/\('(\w+)', '(\w+)', (true|false), (true|false), (true|false)\)/g)]
  .map((m) => ({ role: m[1], module: m[2], can_read: m[3] === "true", can_edit: m[4] === "true", can_approve: m[5] === "true" }));
type Row = Record<string, unknown>;
/** Mateixa semàntica que has_perm()/my_permissions() de la migració 014. */
function myPermissions(uid: string, role: string) {
  if (role === "admin") return MODULES.map((m) => ({ module: m.id, can_read: true, can_edit: true, can_approve: true }));
  const R = (state.sb.db.role_permissions ?? []) as Row[], P = (state.sb.db.user_permissions ?? []) as Row[];
  const mods = new Set([...R.filter((r) => r.role === role).map((r) => r.module as string), ...P.filter((p) => p.user_id === uid).map((p) => p.module as string)]);
  return [...mods].map((m) => {
    const o = P.find((p) => p.user_id === uid && p.module === m) ?? R.find((r) => r.role === role && r.module === m);
    const r = !!(o?.can_read || o?.can_edit || o?.can_approve);
    return { module: m, can_read: r, can_edit: !!o?.can_edit, can_approve: !!o?.can_approve };
  });
}
function user(id: string, role: string) {
  const sb = { ...state.sb, rpc: async (name: string, args: unknown) => (name === "my_permissions" ? { data: myPermissions(id, role), error: null } : name === "sec_log" ? { data: null, error: { message: "no" } } : state.sb.rpc(name, args)) };
  return { sb, user: { id }, profile: { id, name: NAMES[id] ?? role, email: `${id}@a30.com`, role, code: null } } as never;
}

const JOAN = "00000000-0000-0000-0000-00000000001a", OLIVIE = "00000000-0000-0000-0000-00000000002a", IBERTH = "00000000-0000-0000-0000-0000000000cb";
const ADM = "00000000-0000-0000-0000-0000000000ad", PATRICIA = "00000000-0000-0000-0000-0000000000c1", ALTRE_COM = "00000000-0000-0000-0000-0000000000c2";
const PAU = "00000000-0000-0000-0000-00000000000f", MARIA = "00000000-0000-0000-0000-00000000000e";
const NAMES: Record<string, string> = { [JOAN]: "Joan", [OLIVIE]: "Olivié", [IBERTH]: "Iberth", [ADM]: "Administrativa 1", [PATRICIA]: "Patricia", [ALTRE_COM]: "Comercial 2", [PAU]: "Pau Electricista", [MARIA]: "Maria Gestoria" };
const now = new Date("2026-11-10T10:00:00Z");
const iso = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const day = (d: number) => iso(d).slice(0, 10);

function seed() {
  return {
    profiles: [
      { id: JOAN, name: "Joan", role: "admin" }, { id: OLIVIE, name: "Olivié", role: "admin" }, { id: IBERTH, name: "Iberth", role: "cap_administrativa" }, { id: ADM, name: "Administrativa 1", role: "administrativa" },
      { id: PATRICIA, name: "Patricia", role: "comercial" }, { id: ALTRE_COM, name: "Comercial 2", role: "comercial" }, { id: PAU, name: "Pau Electricista", role: "colaborador" }, { id: MARIA, name: "Maria Gestoria", role: "colaborador" },
    ],
    role_permissions: DEFAULTS,
    crm_clients: [{ id: "CLI-1", search: "forn sant jordi sl b12345678", name: "Forn Sant Jordi SL", owner_id: PATRICIA, collaborator_id: PAU, tax_id: "B12345678", phone: "+34973000000", email: "forn@x.cat", archived_at: null }, { id: "CLI-2", name: "Taller Segrià", owner_id: ALTRE_COM, collaborator_id: MARIA, tax_id: "B87654321", phone: null, email: null, archived_at: null }],
    crm_supplies: [{ id: "SUP-1", client_id: "CLI-1", cups: "ES0031405000000001ZV", annual_kwh: 48000, archived_at: null }, { id: "SUP-2", client_id: "CLI-2", cups: "ES0031405000000002ZV", annual_kwh: 12000, archived_at: null }],
    crm_contracts: [
      { id: "K-1", client_id: "CLI-1", supply_id: "SUP-1", retailer: "Nufri", product: "Gala", status: "actiu", signed_at: day(-1), created_at: iso(-1), created_by: ADM, owner_id: PATRICIA, end_date: day(100), start_date: day(-1) },
      { id: "K-2", client_id: "CLI-2", supply_id: "SUP-2", retailer: "Iberdrola", product: "Plan", status: "actiu", signed_at: day(0), created_at: iso(0), created_by: ADM, owner_id: ALTRE_COM, end_date: day(20), start_date: day(0) },
    ],
    crm_expedients: [
      { id: "EXP-1", code: "EXP-2026-00001", client_id: "CLI-1", status: "en_tramitacio", status_changed_at: iso(-12), last_event_at: iso(-12), owner_id: ADM, retailer: "Nufri", service: "llum_empresa", collaborator_id: PAU, created_at: iso(-15) },
      { id: "EXP-2", code: "EXP-2026-00002", client_id: "CLI-2", status: "pendent_documentacio", status_changed_at: iso(-1), last_event_at: iso(-1), owner_id: null, retailer: "Iberdrola", service: "llum_residencial", collaborator_id: MARIA, created_at: iso(-1) },
    ],
    crm_leads: [{ id: "L-1", search: "forn sant jordi sl", name: "Forn Sant Jordi SL", owner_id: PATRICIA, collaborator_id: PAU, status: "nou", created_at: iso(-1), first_contact_at: null, services: ["llum_empresa"] }],
    crm_opportunities: [{ id: "O-1", title: "Forn · llum", stage: "proposta_enviada", owner_id: PATRICIA, created_at: iso(-5), proposal_sent_at: iso(-3), won_at: null, lost_at: null, mwh: 48, last_activity_at: iso(-3), lead_id: "L-1", client_id: "CLI-1", service: "llum_empresa" }],
    crm_tasks: [{ id: "T-1", title: "Revisar DNI", status: "pendent", due_at: iso(-6), assigned_to: ADM, assigned_name: "Administrativa 1", created_by: IBERTH, area: "administrativa", kind: "documentacio", priority: "alta", escalation_level: 0, created_at: iso(-8), completed_at: null }],
    crm_incidents: [{ id: "I-1", title: "Factura duplicada", status: "oberta", priority: "urgent", opened_at: iso(-2), closed_at: null, assigned_to: ADM, client_id: "CLI-1", escalation_level: 0 }],
    fin_ledger: [
      { id: "LG-1", contract_id: "K-1", layer: "comercial", beneficiary_id: PATRICIA, kind: "meritacio", amount: "120.00", period: day(-2), description: "Comissió Forn", settlement_id: null },
      { id: "LG-2", contract_id: "K-2", layer: "comercial", beneficiary_id: ALTRE_COM, kind: "meritacio", amount: "999.00", period: day(0), description: "Comissió d'un altre", settlement_id: null },
    ],
    fin_calculations: [],
    crm_automation_rules: [{ key: "tasca_vencuda", enabled: true, params: { escalate_days: [2, 5] } }, { key: "incidencia_urgent", enabled: true, params: { hours: [4, 24] } }, { key: "error_integracio", enabled: true, params: { hours: 24 } }],
  };
}
beforeEach(() => { state.sb = fakeSupabase(seed() as never); state.current = null; });

describe("Permisos per rol (sense noms de persona)", () => {
  it("els valors per defecte surten de la migració 014 i cap mòdul depèn d'un nom", () => {
    expect(DEFAULTS.length).toBeGreaterThan(30);
    expect(SQL).not.toMatch(/joan|olivi|iberth|patricia/i);
    const cap = DEFAULTS.filter((d) => d.role === "cap_administrativa");
    expect(cap.find((d) => d.module === "economia")).toMatchObject({ can_read: false, can_edit: false });
    expect(cap.find((d) => d.module === "comissions")).toMatchObject({ can_read: false });
    expect(cap.find((d) => d.module === "tasques")).toMatchObject({ can_approve: true });
    expect(DEFAULTS.find((d) => d.role === "administrativa" && d.module === "economia")).toMatchObject({ can_read: false });
    expect(DEFAULTS.find((d) => d.role === "comercial" && d.module === "comissions")).toMatchObject({ can_read: true, can_edit: false });
    expect(DEFAULTS.filter((d) => d.role === "colaborador" && d.can_read).map((d) => d.module).sort()).toEqual(["comissions", "informes", "portal", "tasques"]);
  });
  it("P1-P2 · Joan i Olivié (Direcció) tenen exactament els mateixos permisos: tots", async () => {
    const { permissions } = await import("@/server/permissions");
    const a = await permissions(user(JOAN, "admin")), b = await permissions(user(OLIVIE, "admin"));
    expect(a.map).toEqual(b.map);
    expect(Object.values(a.map).every((x) => x.read && x.edit && x.approve)).toBe(true);
    expect(Object.keys(a.map).sort()).toEqual(MODULES.map((m) => m.id).sort());
  });
  it("la Cap administrativa supervisa tasques però NO té dades econòmiques fins que Direcció l'autoritza", async () => {
    const { finStaff, hasPerm } = await import("@/server/permissions");
    expect(await hasPerm(user(IBERTH, "cap_administrativa"), "tasques", "approve")).toBe(true);
    expect(await finStaff(user(IBERTH, "cap_administrativa"))).toBe(false);
    state.sb.db.user_permissions = [{ user_id: IBERTH, module: "economia", can_read: true, can_edit: false, can_approve: false }];
    expect(await finStaff(user(IBERTH, "cap_administrativa"))).toBe(true);
    expect(await finStaff(user(IBERTH, "cap_administrativa"), "edit")).toBe(false);
  });
  it("sense la migració 014 es manté exactament el comportament de la Fase 6", () => {
    expect(legacyPerms("administrativa").economia.read).toBe(true);
    expect(legacyPerms("comercial").economia.read).toBe(false);
    expect(legacyPerms("colaborador").clients.read).toBe(false);
  });
  it("P14 · un col·laborador no pot fer servir cap API del CRM intern", async () => {
    const { requireInternal } = await import("@/server/permissions");
    state.current = { id: PAU, role: "colaborador" };
    await expect(requireInternal()).rejects.toThrow(/no és accessible per a col·laboradors/);
    state.current = { id: PATRICIA, role: "comercial" };
    await expect(requireInternal()).resolves.toBeTruthy();
  });
  it("MFA: si Direcció l'exigeix, el servidor rebutja els rols sensibles sense segon factor", async () => {
    const { requireInternal, invalidateSecurityCache } = await import("@/server/permissions");
    state.sb.db.sec_settings = [{ key: "mfa", value: { enforced: true, roles: ["admin", "cap_administrativa"] } }];
    invalidateSecurityCache();
    state.current = { id: IBERTH, role: "cap_administrativa" };
    await expect(requireInternal()).rejects.toThrow(/MFA/);
    state.current = { id: ADM, role: "administrativa" };
    await expect(requireInternal()).resolves.toBeTruthy();
    invalidateSecurityCache();
  });
  it("només Direcció canvia permisos, i Direcció no es pot restringir a si mateixa", async () => {
    const { setRolePermission, setUserPermission } = await import("@/server/permissions");
    await expect(setRolePermission(user(IBERTH, "cap_administrativa"), { role: "administrativa", module: "economia", read: true, edit: true, approve: true })).rejects.toThrow(/Només Direcció/);
    await expect(setRolePermission(user(JOAN, "admin"), { role: "admin", module: "economia", read: false, edit: false, approve: false })).rejects.toThrow(/sempre tots els permisos/);
    await expect(setUserPermission(user(JOAN, "admin"), { userId: PAU, module: "clients", value: { read: true, edit: false, approve: false } })).rejects.toThrow(/només pot tenir accés al seu portal/);
    await setUserPermission(user(OLIVIE, "admin"), { userId: IBERTH, module: "economia", value: { read: true, edit: false, approve: false } });
    expect(state.sb.db.user_permissions).toHaveLength(1);
  });
});

describe("Centre de Control i preferències per usuari", () => {
  it("P1 · Direcció veu indicadors comercials, administratius i econòmics amb dades reals", async () => {
    const { controlCenter } = await import("@/server/control");
    const d = await controlCenter(user(JOAN, "admin"), { period: "setmana" }, now);
    expect(d.kpis.contractes_setmana).toBe(2);
    expect(d.kpis.mwh).toBe(60); // 48.000 + 12.000 kWh dels subministraments (no s'estima res)
    expect(d.kpis.bloquejats).toBe(1); // EXP-1: 12 dies sense moviment
    expect(d.kpis.renovacions_urgents).toBe(1);
    expect(d.kpis.tasques_vencudes).toBe(1);
    expect(d.kpis.incidencies_urgents).toBe(1);
    expect(d.economic).toBe(true);
    expect(d.definitions.some((k) => k.economic)).toBe(true);
  });
  it("la Cap administrativa i els comercials no poden obrir el Centre de Control de Direcció", async () => {
    const { controlCenter } = await import("@/server/control");
    await expect(controlCenter(user(IBERTH, "cap_administrativa"), {}, now)).rejects.toThrow(/Centre de Control/);
    await expect(controlCenter(user(PATRICIA, "comercial"), {}, now)).rejects.toThrow(/Centre de Control/);
  });
  it("P2 · Olivié veu exactament les mateixes xifres que Joan", async () => {
    const { controlCenter } = await import("@/server/control");
    const a = await controlCenter(user(JOAN, "admin"), { period: "mes" }, now), b = await controlCenter(user(OLIVIE, "admin"), { period: "mes" }, now);
    expect(a.kpis).toEqual(b.kpis);
  });
  it("filtres: comercial i comercialitzadora redueixen els indicadors", async () => {
    const { controlCenter } = await import("@/server/control");
    const d = await controlCenter(user(JOAN, "admin"), { period: "setmana", owner: PATRICIA }, now);
    expect(d.kpis.contractes_setmana).toBe(1);
    const r = await controlCenter(user(JOAN, "admin"), { period: "setmana", retailer: "Iberdrola" }, now);
    expect(r.kpis.mwh).toBe(12);
  });
  it("P3-P5 · cada directiu personalitza el seu panell; no altera el de l'altre i persisteix en una sessió nova", async () => {
    const { saveLayout, getLayout } = await import("@/server/control");
    const joan = { ...TEMPLATES.direccio_operativa.layout, widgets: [{ id: "kpi:tramitacio", size: 2 as const }, { id: "alertes", size: 2 as const }] };
    await saveLayout(user(JOAN, "admin"), joan);
    await saveLayout(user(OLIVIE, "admin"), TEMPLATES.direccio_comercial.layout);
    const j2 = await getLayout(user(JOAN, "admin"));        // «nova sessió»: un objecte d'usuari nou
    const o2 = await getLayout(user(OLIVIE, "admin"));
    expect(j2.layout.widgets.map((w) => w.id)).toEqual(["kpi:tramitacio", "alertes"]);
    expect(j2.layout.widgets[0].size).toBe(2);
    expect(o2.layout.template).toBe("direccio_comercial");
    expect(o2.layout.widgets.map((w) => w.id)).toContain("kpi:mwh");
    expect(state.sb.db.user_dashboard_prefs.map((r) => r.user_id).sort()).toEqual([JOAN, OLIVIE].sort());
  });
  it("restaurar el panell predeterminat i validar el que es desa (sense widgets desconeguts ni econòmics sense permís)", async () => {
    const { resetLayout } = await import("@/server/control");
    const r = await resetLayout(user(JOAN, "admin"), "direccio_operativa");
    expect(r.layout.template).toBe("direccio_operativa");
    const clean = sanitizeLayout({ ...TEMPLATES.complet.layout, widgets: [{ id: "kpi:mwh", size: 1 }, { id: "kpi:mwh", size: 2 }, { id: "x:inventat", size: 1 }, { id: "kpi:marge_realitzat", size: 1 }] }, { economic: false });
    expect(clean.widgets.map((w) => w.id)).toEqual(["kpi:mwh"]);
    expect(sanitizeLayout("brossa", { economic: true }).template).toBe(DEFAULT_TEMPLATE);
  });
  it("cada widget d'indicador té una definició documentada única", () => {
    for (const w of WIDGETS.filter((x) => x.kind === "kpi")) expect(KPI[w.kpi!]?.def.length).toBeGreaterThan(20);
    expect(new Set(KPI_DEFS.map((k) => k.id)).size).toBe(KPI_DEFS.length);
    for (const t of Object.values(TEMPLATES)) for (const w of t.layout.widgets) expect(WIDGETS.some((x) => x.id === w.id)).toBe(true);
  });
});

describe("Panells per rol", () => {
  it("panell de la Cap administrativa: càrrega per persona, bloquejats i sense dades econòmiques", async () => {
    const { capPanel } = await import("@/server/control");
    const d = await capPanel(user(IBERTH, "cap_administrativa"), now);
    expect(d.kpis.contractes_introduits_avui).toBe(1);
    expect(d.kpis.expedients_incomplets).toBe(1);
    expect(d.kpis.contractes_bloquejats).toBe(1);
    expect(d.team.find((t) => t.id === ADM)).toMatchObject({ open: 1, overdue: 1, expedients: 1 });
    expect(d.economicAccess).toBe(false);
    await expect(capPanel(user(PATRICIA, "comercial"), now)).rejects.toThrow(/permís/);
  });
  it("P7 · la meva jornada: l'administrativa veu els seus expedients, tasques vençudes i incidències", async () => {
    const { myDay } = await import("@/server/control");
    const d = await myDay(user(ADM, "administrativa"), now);
    expect(d.overdue.map((t) => (t as { id: string }).id)).toEqual(["T-1"]);
    expect(d.expedients.map((e) => (e as { id: string }).id)).toEqual(["EXP-1"]);
    expect(d.incidents).toHaveLength(1);
    await expect(myDay(user(PATRICIA, "comercial"), now)).rejects.toThrow(/permís/);
  });
  it("P8-P9 · Patricia crea un lead i una oportunitat i només veu les seves comissions", async () => {
    const { leadAction, oppAction } = await import("@/server/sales");
    const pat = user(PATRICIA, "comercial");
    const l = (await leadAction(pat, { action: "create", data: { name: "Bar Centre", phone: "+34973111222", services: ["llum_residencial"] } })) as { id: string };
    expect(state.sb.db.crm_leads.find((x) => x.id === l.id)).toMatchObject({ owner_id: PATRICIA, created_by: PATRICIA });
    const o = await oppAction(pat, { action: "create", data: { title: "Bar Centre · llum", service: "llum_residencial", lead_id: l.id } });
    expect(state.sb.db.crm_opportunities.find((x) => x.id === o.id)).toMatchObject({ owner_id: PATRICIA });
    const { commercialPanel } = await import("@/server/control");
    const d = await commercialPanel(pat, now);
    expect(d.kpis.leads).toBe(2);
    expect(d.commissions?.accrued).toBe(120);            // la seva comissió (no la de 999 € d'un altre comercial)
    const fin = await import("@/server/finance");
    await expect(fin.dashboard(pat, {})).rejects.toThrow(/restringides/);
  });
  it("el rendiment d'equip amaga comissions a personal sense autorització econòmica", async () => {
    const { performance } = await import("@/server/sales");
    const r = await performance(user(ADM, "administrativa"), day(-30), day(1));
    expect(r.economic).toBe(false);
    expect(r.kpis.commissionWeighted).toBeNull();
  });
});

describe("Gestor global de tasques i incidències", () => {
  it("P6 · Iberth assigna una tasca administrativa: queda assignada, amb avís a la persona", async () => {
    const { createTask, bulkAssign } = await import("@/server/work");
    const r = await createTask(user(IBERTH, "cap_administrativa"), { title: "Trucar a la distribuïdora", assigned_to: ADM, priority: "alta", area: "administrativa", kind: "tramitacio", due_at: day(1) });
    const t = state.sb.db.crm_tasks.find((x) => x.id === r.id)!;
    expect(t).toMatchObject({ assigned_to: ADM, assigned_name: "Administrativa 1", created_by: IBERTH, priority: "alta", area: "administrativa" });
    expect(state.sb.db.crm_notifications.some((n) => n.user_id === ADM && String(n.title).includes("Trucar"))).toBe(true);
    expect((await bulkAssign(user(IBERTH, "cap_administrativa"), [r.id], ADM)).updated).toBe(1);
  });
  it("una administrativa no pot assignar tasques a altres persones ni reassignar en bloc", async () => {
    const { createTask, bulkAssign } = await import("@/server/work");
    await expect(createTask(user(ADM, "administrativa"), { title: "Per a la Cap", assigned_to: IBERTH })).rejects.toThrow(/assignen tasques/);
    await expect(bulkAssign(user(ADM, "administrativa"), ["T-1"], IBERTH)).rejects.toThrow(/reassignen/);
  });
  it("bloquejar una tasca exigeix motiu; els col·laboradors no veuen tasques internes", async () => {
    const { updateTask, listTasks } = await import("@/server/work");
    await expect(updateTask(user(ADM, "administrativa"), "T-1", { status: "bloquejada" })).rejects.toThrow(/per què/);
    await expect(listTasks(user(PATRICIA, "comercial"), { scope: "totes" })).rejects.toThrow(/supervisen/);
  });
  it("tancar una incidència requereix resolució i permís d'aprovació", async () => {
    const { updateIncident } = await import("@/server/work");
    await expect(updateIncident(user(ADM, "administrativa"), "00000000-0000-4000-8000-000000000001", { status: "resolta" })).rejects.toThrow(/com s'ha resolt/);
    await expect(updateIncident(user(ADM, "administrativa"), "00000000-0000-4000-8000-000000000001", { status: "tancada", resolution: "ok" })).rejects.toThrow(/tanquen/);
  });
});

describe("Automatitzacions, alertes i escalats", () => {
  it("P15 · una renovació propera genera UNA tasca (encara que dues regles la proposin)", () => {
    const plan = planAutomations({
      now, rules: [{ key: "venciment_contracte", enabled: true, params: { days: [120, 90, 60, 30] } }, { key: "preparar_renovacio", enabled: true, params: { days_before: 90 } }] as never,
      opps: [], lastActivity: {}, leads: [], staffIds: [IBERTH],
      contracts: [{ id: "K-1", client_id: "CLI-1", retailer: "Nufri", end_date: day(100), status: "actiu", owner_id: PATRICIA, client_owner_id: PATRICIA, client_name: "Forn", legacy: false, created_at: iso(-2) }],
    } as never);
    const ren = plan.tasks.filter((t) => t.kind === "renovacio");
    expect(ren).toHaveLength(1);
    expect(ren[0]).toMatchObject({ assigned_to: PATRICIA, contract_id: "K-1", rule_key: `preparar_renovacio:K-1:${day(100)}` });
    expect(plan.notifications.some((n) => n.rule_key === "venciment_contracte:K-1:120")).toBe(true);
  });
  it("P16 · un expedient bloquejat apareix com a alerta i compta als indicadors", () => {
    const k = operationalKpis({ now, range: periodRange("mes", now), contracts: [], leads: [], opps: [], tasks: [], incidents: [], expedients: [{ id: "E", status: "en_tramitacio", status_changed_at: iso(-10), last_event_at: iso(-10), owner_id: ADM, retailer: "Nufri", created_at: iso(-20) }, { id: "F", status: "incidencia", status_changed_at: iso(-1), owner_id: ADM, retailer: "Nufri", created_at: iso(-2) }] });
    expect(k.bloquejats).toBe(2);
  });
  it("tasca vençuda: avís al responsable, després Cap administrativa i després Direcció (sense repeticions)", () => {
    const rules = [{ key: "tasca_vencuda", params: { escalate_days: [2, 5] } }];
    const base = { rules, incidents: [], capIds: [IBERTH], direccioIds: [JOAN, OLIVIE], failures: [] };
    const t = { id: "T", title: "Doc", status: "pendent", due_at: iso(-1), assigned_to: ADM, completed_at: null, escalation_level: 0 };
    expect(planEscalations({ ...base, now, tasks: [t] }).notifications.map((n) => n.user_id)).toEqual([ADM]);
    const p3 = planEscalations({ ...base, now: new Date(now.getTime() + 2 * 86_400_000), tasks: [t] });
    expect(p3.notifications.map((n) => n.user_id).sort()).toEqual([ADM, IBERTH].sort());
    const p6 = planEscalations({ ...base, now: new Date(now.getTime() + 5 * 86_400_000), tasks: [t] });
    expect(p6.notifications.map((n) => n.user_id).sort()).toEqual([ADM, IBERTH, JOAN, OLIVIE].sort());
    expect(p6.taskLevels).toEqual([{ id: "T", level: 2 }]);
    // claus estables: la base de dades rebutja el mateix avís dues vegades
    expect(new Set(p6.notifications.map((n) => `${n.user_id}|${n.rule_key}`)).size).toBe(p6.notifications.length);
    expect(p3.notifications.find((n) => n.user_id === ADM)!.rule_key).toBe(p6.notifications.find((n) => n.user_id === ADM)!.rule_key);
  });
  it("incidència urgent: responsable + Cap; passat el termini, Direcció. Errors d'integració: un avís per origen i dia", () => {
    const p = planEscalations({ now, rules: [{ key: "incidencia_urgent", params: { hours: [4, 24] } }, { key: "error_integracio", params: { hours: 24 } }], tasks: [], capIds: [IBERTH], direccioIds: [JOAN],
      incidents: [{ id: "I", title: "Tall", status: "oberta", priority: "urgent", opened_at: iso(-2), closed_at: null, assigned_to: ADM, escalation_level: 0 }],
      failures: [{ source: "Webhook meta_leadgen", at: iso(-0.1), error: "firma" }, { source: "Webhook meta_leadgen", at: iso(-0.05), error: "firma" }, { source: "Sincronització", at: iso(-3), error: "vell" }] });
    expect(p.notifications.filter((n) => n.rule_key.startsWith("inc:I:0")).map((n) => n.user_id).sort()).toEqual([ADM, IBERTH].sort());
    expect(p.notifications.some((n) => n.rule_key === "inc:I:2" && n.user_id === JOAN)).toBe(true);
    expect(p.notifications.filter((n) => n.kind === "integracio")).toHaveLength(1);
  });
  it("les alertes econòmiques ja no van a la Cap administrativa si no té autorització", async () => {
    const code = fs.readFileSync(path.resolve(__dirname, "../src/server/automations.ts"), "utf8");
    expect(code).toMatch(/financeRecipients\(sb/);
  });
  it("P17 · una activació actualitza els indicadors del període", () => {
    const base = { now, range: periodRange("mes", now), contracts: [], leads: [], opps: [], tasks: [], incidents: [] };
    const e = { id: "E", status: "en_tramitacio", status_changed_at: iso(-3), owner_id: ADM, retailer: "Nufri", created_at: iso(-5) };
    expect(operationalKpis({ ...base, expedients: [e] }).activats).toBe(0);
    expect(operationalKpis({ ...base, expedients: [{ ...e, status: "activat", activated_at: iso(0), status_changed_at: iso(0) }] }).activats).toBe(1);
  });
});

describe("Portal de col·laboradors", () => {
  it("P10-P11 · el formulari del portal accepta altres serveis i el lead queda atribuït al col·laborador", () => {
    const f = publicFormSchema.parse({ idempotencyKey: "0b8f7f3e-4a8e-4c41-9a35-6c5a8f1f2b99", name: "Bar Centre", phone: "600111222", email: "bar@x.cat", customerKind: "empresa", energyType: "luz", acceptPrivacy: true, extraServices: "fibra_telefonia,alarmes" });
    expect(f.extraServices).toEqual(["fibra_telefonia", "alarmes"]);
    expect(publicFormSchema.safeParse({ idempotencyKey: "0b8f7f3e-4a8e-4c41-9a35-6c5a8f1f2b99", name: "X", phone: "600111222", email: "x@x.cat", customerKind: "empresa", energyType: "luz", acceptPrivacy: true, extraServices: "hackejar" }).success).toBe(false);
    const code = fs.readFileSync(path.resolve(__dirname, "../src/server/capture.ts"), "utf8");
    expect(code).toMatch(/services: \[service, \.\.\.\(\(\(s as \{ extra_services/);
  });
  it("P12-P13 · cada col·laborador consulta només les seves operacions (el servidor filtra pel seu identificador)", async () => {
    state.sb.db.cap_partners = [{ id: "P-PAU", user_id: PAU, name: "Pau Electricista", kind: "electricista", status: "actiu" }, { id: "P-MARIA", user_id: MARIA, name: "Maria Gestoria", kind: "gestoria", status: "actiu" }];
    const { portalData } = await import("@/server/partners");
    const pau = await portalData(user(PAU, "colaborador"));
    expect(pau.kpis.clients).toBe(1);
    expect(pau.leads.map((l) => l.name)).toEqual(["Forn Sant Jordi SL"]);
    const maria = await portalData(user(MARIA, "colaborador"));
    expect(maria.leads).toHaveLength(0);
    expect(JSON.stringify(maria)).not.toMatch(/Forn Sant Jordi/);
  });
  it("contactar amb Assessoria 3.0 crea una sol·licitud externa per a la Cap administrativa", async () => {
    state.sb.db.cap_partners = [{ id: "P-PAU", user_id: PAU, name: "Pau Electricista", kind: "electricista", status: "actiu" }];
    const { portalMessage } = await import("@/server/partners");
    await portalMessage(user(PAU, "colaborador"), { subject: "Estat d'un client", message: "Com va el Forn Sant Jordi?" });
    const t = state.sb.db.crm_tasks.find((x) => x.kind === "sollicitud_externa")!;
    expect(t).toMatchObject({ partner_visible: true, area: "externa", assigned_to: IBERTH, created_by: PAU });
    expect(state.sb.db.crm_notifications.some((n) => n.user_id === IBERTH)).toBe(true);
  });
});

describe("Qualitat de dades, productivitat i informes", () => {
  it("detecta duplicats, dates incorrectes, orfes, comissions duplicades i liquidacions incoherents sense modificar res", () => {
    const issues = detectQuality({
      now,
      clients: [{ id: "a", name: "Forn", tax_id: "B-12345678", phone: null, email: null, archived_at: null }, { id: "b", name: "Forn SL", tax_id: "b12345678", phone: null, email: null, archived_at: null }],
      supplies: [{ id: "s1", cups: "ES0031405000000001ZV", client_id: "a", archived_at: null }, { id: "s2", cups: "ES0031405000000001ZV0F", client_id: "c", archived_at: null }],
      contracts: [{ id: "k", client_id: "a", status: "actiu", start_date: "2026-05-01", end_date: "2026-01-01", signed_at: null, owner_id: null }],
      expedients: [{ id: "e", code: "EXP-1", status: "en_tramitacio", owner_id: null }],
      documents: [],
      ledger: [{ id: "l1", contract_id: "k", layer: "proveidor", kind: "cobrament", beneficiary_id: null, amount: "50.00", period: "2026-10-01" }, { id: "l2", contract_id: "k", layer: "proveidor", kind: "cobrament", beneficiary_id: null, amount: 50, period: "2026-10-01" }],
      settlements: [{ id: "st", code: "LIQ-1", status: "pagada", total_gross: 100, approved_amount: 100, paid_amount: 80, lines_total: 100 }],
      opps: [{ id: "o", title: "Vella", stage: "contactat", last_activity_at: iso(-40), owner_id: null }],
      tasks: [{ id: "t", title: "Òrfena", status: "pendent", assigned_to: null }],
    });
    const kinds = issues.map((i) => i.kind);
    for (const k of ["client_duplicat", "cups_duplicat", "data_incorrecta", "expedient_sense_responsable", "comissio_duplicada", "liquidacio_incoherent", "oportunitat_abandonada", "tasca_sense_responsable"]) expect(kinds).toContain(k);
    expect(issues[0].severity).toBe("alta");
  });
  it("clients amb el mateix telèfon I el mateix correu (empreses diferents) s'ignoren automàticament; un sol camp coincident no", () => {
    const base = { now, supplies: [], contracts: [], expedients: [], documents: [], ledger: null, settlements: null, opps: [], tasks: [] };
    const c = (id: string, tax: string | null, phone: string | null, email: string | null) => ({ id, name: `Client ${id}`, tax_id: tax, phone, email, archived_at: null });
    const same = detectQuality({ ...base, clients: [c("a", "H11111111", "+34 600 11 22 33", "Admin.Prova@exemple.cat"), c("b", "H22222222", "600112233", "admin.prova@exemple.cat"), c("x", "B33333333", "611000000", "x@exemple.cat")] });
    const dup = same.filter((i) => i.kind === "client_duplicat");
    expect(dup).toHaveLength(1); // el grup per telèfon i el grup per correu són el mateix cas
    expect(dup[0].autoIgnore).toMatch(/mateix telèfon i mateix correu/);
    const onlyPhone = detectQuality({ ...base, clients: [c("a", "H11111111", "600112233", "a@exemple.cat"), c("b", "H22222222", "600112233", "b@exemple.cat")] });
    expect(onlyPhone.find((i) => i.kind === "client_duplicat")!.autoIgnore).toBeUndefined();
    const sameNif = detectQuality({ ...base, clients: [c("a", "B44444444", "600112233", "a@exemple.cat"), c("b", "B44444444", "600112233", "a@exemple.cat")] });
    const real = sameNif.find((i) => i.kind === "client_duplicat")!;
    expect(real.severity).toBe("alta"); // mateix NIF: duplicat real
    expect(real.autoIgnore).toBeUndefined();
  });
  it("la revisió humana es desa per signatura i la llista la marca com a revisada", async () => {
    const { qualityReport, reviewQuality } = await import("@/server/control");
    const before = await qualityReport(user(JOAN, "admin"), now);
    const first = before.issues[0];
    await reviewQuality(user(JOAN, "admin"), { signature: first.signature, kind: first.kind, status: "revisat" });
    const after = await qualityReport(user(JOAN, "admin"), now);
    expect(after.open).toBe(before.open - 1);
    await expect(qualityReport(user(PATRICIA, "comercial"), now)).rejects.toThrow(/Direcció i la Cap/);
  });
  it("«Ignora tots» ignora de cop els pendents (sense trepitjar revisions anteriors)", async () => {
    const { qualityReport, reviewQuality, reviewQualityBulk } = await import("@/server/control");
    (state.sb.db.crm_tasks ??= []).push({ id: "t-orfena-1", title: "Òrfena 1", status: "pendent", assigned_to: null }, { id: "t-orfena-2", title: "Òrfena 2", status: "pendent", assigned_to: null });
    const before = await qualityReport(user(JOAN, "admin"), now);
    const [reviewed, ...pending] = before.issues.filter((i) => !i.review);
    expect(pending.length).toBeGreaterThan(0);
    await reviewQuality(user(JOAN, "admin"), { signature: reviewed.signature, kind: reviewed.kind, status: "revisat" });
    // l'usuari envia també un cas ja revisat (p. ex. una llista desactualitzada): no es trepitja
    const r = await reviewQualityBulk(user(JOAN, "admin"), { items: [...pending, reviewed].map((i) => ({ signature: i.signature, kind: i.kind })), status: "ignorat" });
    expect(r).toMatchObject({ ignored: pending.length, kept: 1 });
    const after = await qualityReport(user(JOAN, "admin"), now);
    expect(after.open).toBe(0);
    expect(after.issues.find((i) => i.signature === reviewed.signature)!.review!.status).toBe("revisat"); // es conserva
    await expect(reviewQualityBulk(user(PATRICIA, "comercial"), { items: [{ signature: "x:1", kind: "x" }], status: "ignorat" })).rejects.toThrow(/Sense permís/);
  });
  it("productivitat: només activitat registrada, i el temps només amb dades fiables", () => {
    const rows = productivity({
      range: { from: "2026-11-01", to: "2026-11-30" }, people: [{ id: ADM, name: "A", role: "administrativa" }],
      contracts: [{ created_by: ADM, created_at: "2026-11-05T10:00:00Z" }], activations: [], expedientEvents: [], incidents: [], leads: [], proposals: [], renewals: [],
      tasks: [{ assigned_to: ADM, status: "feta", completed_at: "2026-11-05T12:00:00Z", started_at: "2026-11-05T10:00:00Z" }, { assigned_to: ADM, status: "feta", completed_at: "2026-11-06T12:00:00Z", started_at: null }],
    });
    expect(rows[0]).toMatchObject({ contractes_introduits: 1, tasques_finalitzades: 2, hores_mitjanes_tasca: null, tasques_amb_temps: 1 });
  });
  it("informe de productivitat: Direcció veu tothom, la Cap l'equip administratiu, la comercial només ella", async () => {
    const { productivityReport } = await import("@/server/control");
    expect((await productivityReport(user(JOAN, "admin"), { period: "mes" }, now)).rows.length).toBe(6);
    const cap = await productivityReport(user(IBERTH, "cap_administrativa"), { period: "mes" }, now);
    expect(cap.rows.map((r) => r.id).sort()).toEqual([IBERTH, ADM].sort());
    const pat = await productivityReport(user(PATRICIA, "comercial"), { period: "mes" }, now);
    expect(pat.rows.map((r) => r.id)).toEqual([PATRICIA]);
    await expect(productivityReport(user(PAU, "colaborador"), {}, now)).rejects.toThrow(/portal/);
  });
  it("informes PDF dins de l'abast de cada rol (PDF vàlid; el comercial no rep dades globals)", async () => {
    const { reportPdf, reportData } = await import("@/server/reports");
    const g = await reportPdf(user(JOAN, "admin"), "mensual", now);
    expect(new TextDecoder().decode(g.bytes.slice(0, 5))).toBe("%PDF-");
    const c = await reportData(user(PATRICIA, "comercial"), "setmanal", now);
    expect(c.scope).toMatch(/només dades pròpies/);
    expect(JSON.stringify(c.sections)).not.toMatch(/Taller Segrià|999/);
    await expect(reportData(user(ADM, "administrativa"), "diari", now)).rejects.toThrow(/informes/);
  });
  it("enviament programat: sense SMTP queda «pendent_smtp» (mai «enviat») i només a destinataris interns", async () => {
    state.sb.db.sec_settings = [{ key: "reports", value: { diari: [JOAN, PATRICIA], setmanal: [], mensual: [] } }];
    const { sendScheduledReports } = await import("@/server/reports");
    const r = await sendScheduledReports(now);
    expect(r.sent).toBe(0);
    expect(state.sb.db.report_runs.map((x) => [x.recipient_id, x.status])).toEqual([[JOAN, "pendent_smtp"]]);
  });
});

describe("Cercador global", () => {
  it("cerca clients, leads i oportunitats, i pagina per tipus", async () => {
    const { globalSearch } = await import("@/server/crm");
    const r = await globalSearch(user(JOAN, "admin"), "forn", "4");
    expect(r.results.map((x) => x.kind)).toEqual(expect.arrayContaining(["lead", "opportunity"]));
    expect(r.limit).toBe(4);
    const cups = await globalSearch(user(JOAN, "admin"), "ES00314050000000", null);
    // un CUPS no es busca com a nom de client ni de lead (el filtre per codi d'expedient el fa PostgREST: el client de prova no aplica «or»)
    expect(cups.results.some((x) => x.kind === "supply")).toBe(true);
    expect(cups.results.some((x) => x.kind === "client" || x.kind === "lead")).toBe(false);
  });
  it("un comercial no rep col·laboradors (cal el permís «colaboradors»)", async () => {
    state.sb.db.cap_partners = [{ id: "P-PAU", name: "Pau Forner", company: null, kind: "electricista", email: "pau@x.cat", phone: null }];
    const { globalSearch } = await import("@/server/crm");
    expect((await globalSearch(user(PATRICIA, "comercial"), "forn", null)).results.some((x) => x.kind === "partner")).toBe(false);
    expect((await globalSearch(user(JOAN, "admin"), "forn", null)).results.some((x) => x.kind === "partner")).toBe(true);
  });
});
