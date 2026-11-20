/**
 * CÀLCUL AUTOMÀTIC DE COMISSIONS (059) · proves d'integració amb un Supabase EN MEMÒRIA.
 * Passen per `contractAction` (alta, edició i renovació reals del CRM) i pel motor existent (`runCalculation`), amb les
 * regles reals d'Endesa (es llegeixen de la migració 046), Nufri per modalitat i Iberdrola 2026 (importació real).
 * També la regularització històrica (dry-run obligatori, idempotent) i la garantia que res pagat o liquidat es toca.
 * Tots els clients, CUPS i persones són ficticis.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => { throw new HttpError(401, "no"); } };
});
vi.mock("@/server/permissions", async () => ({
  finStaff: async (u: { profile: { role: string } }) => ["admin", "cap_administrativa"].includes(u.profile.role),
  hasPerm: async (u: { profile: { role: string } }) => u.profile.role !== "comercial",
  STAFF: ["admin", "cap_administrativa", "administrativa"],
}));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADM = ID(1), COM = ID(2), COL = ID(3), COL2 = ID(5);
const PART = ID(10), EMP = ID(11);
const S20 = ID(20), S30 = ID(21), S61 = ID(22), SGAS = ID(23), SNUF = ID(24), SIB = ID(25), SNORULE = ID(26), SNOKWH = ID(27);
const u = (id: string, role: string) => ({ sb: state.sb, user: { id }, profile: { id, name: role, email: "x@example.com", role, code: null } }) as never;
const db = () => state.sb.db as Record<string, Record<string, unknown>[]>;
const L = "TRWAGMYFPDXBNJZSQVHLCKE";
const cups = (n: number) => { const d = `0031${String(n).padStart(12, "0")}`; const r = Number(BigInt(d) % 529n); return `ES${d}${L[Math.floor(r / 23)]}${L[r % 23]}`; };

// regles reals d'Endesa (migració 046): matrius 3.0TD/6.1TD i gas RL
const SQL046 = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/046_endesa_matriu_comissions.sql"), "utf8");
const endesa = (key: string) => {
  const m = new RegExp(`\\('${key}', '([^']+)', (null|'[a-z_]+'),\\s*'(\\{.*\\})',`).exec(SQL046)!;
  return { id: key, rule_key: key, version: 1, name: m[1], layer: "proveidor", retailer: "Endesa", product: null, service: m[2] === "null" ? null : m[2].replace(/'/g, ""), segment: null, beneficiary_id: null, kind: "matriu_fixa", value: "0", unit: "eur", tiers: null, conditions: JSON.parse(m[3].replace(/''/g, "'")), base_formula: null, base_validated: true, valid_from: "2026-01-01", valid_to: null, status: "aprovada", notes: null };
};
const rule = (p: Record<string, unknown>) => ({ version: 1, layer: "proveidor", product: null, service: null, segment: null, beneficiary_id: null, value: "0", unit: "eur", tiers: null, conditions: {}, base_formula: null, base_validated: true, valid_from: "2026-01-01", valid_to: null, status: "aprovada", notes: null, ...p, rule_key: p.id });
const RULES = [
  endesa("endesa_gas_pyme_matriu"), endesa("endesa_llum_pyme_matriu"),
  rule({ id: "naturgy_20", name: "Naturgy 2.0TD fix", retailer: "Naturgy", service: "llum_residencial", kind: "fix_contracte", value: "50" }),
  rule({ id: "nufri_gala", name: "Nufri Gala · €/MWh", retailer: "Nufri", product: "Gala", kind: "per_mwh", value: "10", unit: "eur_mwh", conditions: { volume: "mwh_elegibles" } }),
  rule({ id: "nufri_royal", name: "Nufri Royal · €/MWh", retailer: "Nufri", product: "Royal", kind: "per_mwh", value: "20", unit: "eur_mwh", status: "pendent_aprovacio" }),
  rule({ id: "iberdrola_2026_taules", name: "Iberdrola · comissions 2026", retailer: "Iberdrola", kind: "taula_iberdrola", conditions: { accrual_event: "activacio", retailer_aliases: ["Iberdrola Clientes"], services: ["llum_residencial", "llum_empresa", "gas"] }, status: "pendent_aprovacio" }),
  rule({ id: "com_fix", name: "Comercial · fix", layer: "comercial", kind: "fix_contracte", value: "10" }),
  rule({ id: "col_25", name: "Col·laborador · 25 % de la comissió rebuda", layer: "collaborador", kind: "pct_comissio_rebuda", value: "25", unit: "pct", base_formula: "Comissió del proveïdor", base_validated: true }),
];
const supply = (id: string, n: number, client: string, energy: "luz" | "gas", tariff: string, kwh: number | null, power: number[] | null) =>
  ({ id, client_id: client, cups: cups(n), cups20: cups(n).slice(0, 20), energy_type: energy, access_tariff: tariff, annual_kwh: kwh, power_kw: power, address: "Carrer Fictici 1", city: "Lleida", province: "Lleida", postal_code: "25001" });

beforeEach(() => {
  state.sb = fakeSupabase({
    profiles: [{ id: ADM, name: "Direcció", role: "admin" }, { id: COM, name: "Comercial", role: "comercial" }, { id: COL, name: "Col·laborador", role: "colaborador" }, { id: COL2, name: "Col·laborador 2", role: "colaborador" }],
    crm_clients: [
      { id: PART, kind: "particular", name: "Client Particular Fictici", owner_id: COM, status: "actiu", collaborator_id: null },
      { id: EMP, kind: "empresa", name: "Empresa Fictícia SL", owner_id: COM, status: "actiu", collaborator_id: COL },
    ],
    crm_supplies: [
      supply(S20, 1, PART, "luz", "2.0TD", 3000, [4.6, 4.6]),
      supply(S30, 2, EMP, "luz", "3.0TD", 55000, [100, 100, 90, 90, 85, 80]),
      supply(S61, 3, EMP, "luz", "6.1TD", 120000, [100, 100, 90, 90, 85, 30]),
      supply(SGAS, 4, EMP, "gas", "RL4", 600000, null),
      supply(SNUF, 5, EMP, "luz", "3.0TD", 200000, [50, 50, 50, 50, 50, 50]),
      supply(SIB, 6, PART, "luz", "2.0TD", 3000, [4.6, 4.6]),
      supply(SNORULE, 7, PART, "luz", "2.0TD", 3000, [4.6, 4.6]),
      supply(SNOKWH, 8, EMP, "luz", "3.0TD", null, null),
    ],
    crm_contracts: [], crm_expedients: [], crm_activities: [], contracts: [], crm_contract_finance: [], crm_commission_records: [],
    fin_rules: RULES, fin_calculations: [], fin_contract_economics: [], fin_ledger: [], fin_settlements: [], fin_settlement_lines: [], fin_payments: [], fin_statement_lines: [], fin_hist_lines: [],
    fin_calc_pending: [], fin_regularization_runs: [], fin_regularization_items: [], retailers: [],
    iberdrola_settings: [{ id: 1, catalog_supplier_id: "sup:iberdrola" }], tariff_suppliers: [{ id: "sup:iberdrola", name: "Iberdrola" }], tariff_products: [],
    crm_contract_conditions: [], ibc_sources: [], ibc_schedules: [], ibc_cells: [], ibc_products: [], ibc_bindings: [], ibc_product_links: [], ibc_retro: [],
    ibc_settings: [{ id: 1, pc_basis: null, pc_confirmed: false, date_basis: null }], ibc_contract_inputs: [], ibc_overrides: [], ibc_discrepancies: [], ibc_audit: [],
  } as never);
});

const crm = () => import("@/server/crm");
type Res = { id: string; commission?: { state: string; message: string; results?: { layer: string; status: string; amount: string | null; beneficiary: string | null }[] } };
const create = async (client: string, data: Record<string, unknown>, who = u(ADM, "admin")) => (await (await crm()).contractAction(who, { action: "create", clientId: client, data: { status: "actiu", start_date: "2026-11-01", end_date: "2027-11-01", ...data } })) as Res;
const calcs = (k: string, layer?: string) => (db().fin_calculations as { contract_id: string; layer: string; is_current: boolean; status: string; amount: string | null; formula: string; beneficiary_id: string | null; created_by: string }[]).filter((c) => c.contract_id === k && (!layer || c.layer === layer));
const current = (k: string, layer = "proveidor") => calcs(k, layer).find((c) => c.is_current);

describe("alta de contractes: el motor existent s'executa en desar", () => {
  it("2.0TD: es calcula primer el proveïdor i després el comercial i el col·laborador (que en depèn)", async () => {
    db().crm_clients[0].collaborator_id = COL;
    const r = await create(PART, { supply_id: S20, retailer: "Naturgy", product: "Tarifa Fictícia", service: "llum_residencial", access_tariff: "2.0TD" });
    expect(r.commission).toMatchObject({ state: "calculat" });
    expect(r.commission!.results!.map((x) => x.layer)).toEqual(["proveidor", "comercial", "collaborador"]);
    expect(current(r.id)).toMatchObject({ status: "calculat", amount: "50.00" });
    expect(current(r.id, "comercial")).toMatchObject({ status: "calculat", amount: "10.00", beneficiary_id: COM });
    expect(current(r.id, "collaborador")).toMatchObject({ status: "calculat", amount: "12.50", beneficiary_id: COL });
    expect(db().fin_ledger).toHaveLength(0);   // només estimacions: cap meritació, liquidació ni pagament
  });

  it("Endesa 3.0TD i 6.1TD: matriu de consum × potència P6 (no un fix genèric)", async () => {
    const a = await create(EMP, { supply_id: S30, retailer: "Endesa", service: "llum_empresa", access_tariff: "3.0TD" });
    const b = await create(EMP, { supply_id: S61, retailer: "Endesa", service: "llum_empresa", access_tariff: "6.1TD" });
    expect(current(a.id)).toMatchObject({ status: "calculat", amount: "534.00" });
    expect(current(a.id)!.formula).toContain("Potència contractada P6: 80 kW");
    expect(current(b.id)).toMatchObject({ status: "calculat", amount: "595.00" });
  });

  it("gas: es classifica com a gas encara que el formulari digui electricitat, i s'aplica la matriu de gas d'Endesa", async () => {
    const r = await create(EMP, { supply_id: SGAS, retailer: "Endesa", service: "llum_empresa", access_tariff: "RL4" });
    expect(db().crm_contracts.find((k) => k.id === r.id)!.service).toBe("gas");
    expect(current(r.id)).toMatchObject({ status: "calculat", amount: "330.00" });
    // i a l'inrevés: un CUPS d'electricitat mai no queda com a gas
    const e = await create(PART, { supply_id: S20, retailer: "Naturgy", service: "gas", access_tariff: "2.0TD" });
    expect(db().crm_contracts.find((k) => k.id === e.id)!.service).toBe("llum_residencial");
  });

  it("Nufri per modalitat: Gala aprovada (200 MWh × 10 €) i Royal pendent d'aprovació → pendent, mai com a definitiva", async () => {
    const g = await create(EMP, { supply_id: SNUF, retailer: "Nufri", product: "Gala", service: "llum_empresa", access_tariff: "3.0TD" });
    expect(current(g.id)).toMatchObject({ status: "calculat", amount: "2000.00" });
    const r = await create(EMP, { supply_id: SNUF, retailer: "Nufri", product: "Royal", service: "llum_empresa", access_tariff: "3.0TD" });
    expect(current(r.id)!.status).toBe("simulacio");
    expect(r.commission).toMatchObject({ state: "pendent" });
    expect(r.commission!.message).toMatch(/pendent d'aprovació|no està aprovada/);
  });

  it("Iberdrola 2026: passa per les taules importades; sense configuració confirmada queda pendent i sense import", async () => {
    await (await import("@/server/iberdrola-commissions")).importDataset(u(ADM, "admin"));
    const r = await create(PART, { supply_id: SIB, retailer: "Iberdrola Clientes", product: "2.0TD_2 Plan OMIE 1", service: "llum_residencial", access_tariff: "2.0TD" });
    expect(current(r.id)).toMatchObject({ status: "pendent_configuracio", amount: null });
    expect(r.commission).toMatchObject({ state: "pendent" });
  });

  it("amb col·laborador: es respecta el del contracte per davant del del client", async () => {
    const r = await create(EMP, { supply_id: S30, retailer: "Endesa", service: "llum_empresa", collaborator_id: COL2 });
    expect(current(r.id, "collaborador")).toMatchObject({ beneficiary_id: COL2, amount: "133.50" });
    const c = await create(EMP, { supply_id: S61, retailer: "Endesa", service: "llum_empresa" });
    expect(current(c.id, "collaborador")).toMatchObject({ beneficiary_id: COL });   // sense col·laborador al contracte: el del client
  });

  it("sense col·laborador: es calcula igualment el proveïdor i no s'inventa cap col·laborador", async () => {
    const r = await create(PART, { supply_id: S20, retailer: "Naturgy", service: "llum_residencial" });
    expect(current(r.id)).toMatchObject({ status: "calculat", amount: "50.00" });
    expect(calcs(r.id, "collaborador")).toHaveLength(0);
  });

  it("sense regla: queda pendent amb el motiu i SENSE import (mai un zero)", async () => {
    const r = await create(PART, { supply_id: SNORULE, retailer: "Comercialitzadora Fictícia", service: "llum_residencial" });
    expect(current(r.id)).toMatchObject({ status: "sense_regla", amount: null });
    expect(r.commission).toMatchObject({ state: "pendent" });
    expect(r.commission!.message).toContain("No hi ha cap regla aplicable");
    const d = await create(EMP, { supply_id: SNOKWH, retailer: "Endesa", service: "llum_empresa", access_tariff: "3.0TD" });
    expect(current(d.id)).toMatchObject({ status: "pendent_dades", amount: null });
    expect(d.commission!.message).toMatch(/Pendent de dades/);
  });

  it("un comercial pot donar d'alta: el servidor calcula, però la resposta no li mostra imports", async () => {
    const r = await create(PART, { supply_id: S20, retailer: "Naturgy", service: "llum_residencial" }, u(COM, "comercial"));
    expect(current(r.id)).toMatchObject({ status: "calculat", amount: "50.00", created_by: COM });
    expect(r.commission).toEqual({ state: "calculat", message: "Comissió calculada automàticament." });
    expect(JSON.stringify(r)).not.toContain("50.00");
  });
});

describe("edició, renovació i reexecució", () => {
  it("edició: es recalcula amb les dades noves; l'anterior es conserva a l'historial (no vigent)", async () => {
    const r = await create(EMP, { supply_id: S30, retailer: "Endesa", service: "llum_empresa" });
    db().crm_supplies.find((s) => s.id === S30)!.power_kw = [100, 100, 90, 90, 85, 60];
    const e = (await (await crm()).contractAction(u(ADM, "admin"), { action: "update", clientId: EMP, id: r.id, data: { status: "actiu", supply_id: S30, retailer: "Endesa", service: "llum_empresa", start_date: "2026-11-01", end_date: "2027-11-01" } })) as Res;
    expect(e.commission).toMatchObject({ state: "calculat" });
    expect(current(r.id)!.amount).toBe("483.00");
    expect(calcs(r.id, "proveidor").filter((c) => !c.is_current).map((c) => c.amount)).toEqual(["534.00"]);
  });

  it("renovació: el contracte nou es calcula i l'anterior no es toca", async () => {
    const a = await create(EMP, { supply_id: S30, retailer: "Endesa", service: "llum_empresa" });
    const before = structuredClone(calcs(a.id));
    const r = (await (await crm()).contractAction(u(ADM, "admin"), { action: "renew", clientId: EMP, id: a.id, data: { status: "actiu", supply_id: S30, retailer: "Endesa", service: "llum_empresa", start_date: "2027-11-01", end_date: "2028-11-01" } })) as Res;
    expect(r.id).not.toBe(a.id);
    expect(current(r.id)).toMatchObject({ status: "calculat", amount: "534.00" });
    expect(calcs(a.id)).toEqual(before);
  });

  it("tornar a desar sense canvis no crea duplicats", async () => {
    const r = await create(EMP, { supply_id: S30, retailer: "Endesa", service: "llum_empresa" });
    const n = db().fin_calculations.length;
    for (let i = 0; i < 3; i++) await (await crm()).contractAction(u(ADM, "admin"), { action: "update", clientId: EMP, id: r.id, data: { status: "actiu", supply_id: S30, retailer: "Endesa", service: "llum_empresa", start_date: "2026-11-01", end_date: "2027-11-01" } });
    await (await import("@/server/finance")).calculateContract(u(ADM, "admin"), r.id);
    expect(db().fin_calculations.length).toBe(n);
    expect(calcs(r.id).filter((c) => c.is_current)).toHaveLength(3);
  });

  it("si el càlcul falla, el contracte queda desat, l'error es registra i es pot reintentar amb seguretat", async () => {
    const sb = state.sb as unknown as { from: (t: string) => unknown };
    const orig = sb.from.bind(sb);
    sb.from = (t: string) => (t === "fin_rules" ? { select: () => ({ in: async () => ({ data: null, error: { code: "XX000", message: "fallada simulada" } }) }) } : orig(t));
    const r = await create(PART, { supply_id: S20, retailer: "Naturgy", service: "llum_residencial" });
    sb.from = orig;
    expect(db().crm_contracts.some((k) => k.id === r.id)).toBe(true);
    expect(r.commission!.state).toBe("error");
    expect(r.commission!.message).toMatch(/pendent de càlcul/);
    expect(db().fin_calc_pending.find((p) => p.contract_id === r.id)).toMatchObject({ status: "error", source: "alta", attempts: 1 });
    expect(calcs(r.id)).toHaveLength(0);
    await (await import("@/server/finance")).calculateContract(u(ADM, "admin"), r.id);   // reintent
    expect(current(r.id)!.amount).toBe("50.00");
    expect(db().fin_calc_pending.find((p) => p.contract_id === r.id)!.status).toBe("resolt");
  });
});

describe("contractes pagats o liquidats: intactes", () => {
  it("editar un contracte amb meritació liquidada i pagada no recalcula ni toca cap import", async () => {
    const r = await create(EMP, { supply_id: S30, retailer: "Endesa", service: "llum_empresa" });
    db().fin_settlements.push({ id: ID(90), code: "LIQ-1", status: "pagada" });
    db().fin_ledger.push({ id: ID(91), contract_id: r.id, layer: "collaborador", beneficiary_id: COL, kind: "meritacio", amount: "133.50", settlement_id: ID(90), idempotency_key: "k" });
    db().fin_settlement_lines.push({ id: ID(92), settlement_id: ID(90), ledger_id: ID(91), contract_id: r.id, category: "fixa", description: "x", amount: "133.50" });
    db().fin_payments.push({ id: ID(93), settlement_id: ID(90), amount: "133.50", paid_at: "2026-11-15" });
    const snap = structuredClone({ c: db().fin_calculations, l: db().fin_ledger, s: db().fin_settlements, sl: db().fin_settlement_lines, p: db().fin_payments });
    db().crm_supplies.find((s) => s.id === S30)!.power_kw = [100, 100, 90, 90, 85, 60];   // dades noves que canviarien l'import
    const e = (await (await crm()).contractAction(u(ADM, "admin"), { action: "update", clientId: EMP, id: r.id, data: { status: "actiu", supply_id: S30, retailer: "Endesa", service: "llum_empresa", start_date: "2026-11-01", end_date: "2027-11-01" } })) as Res;
    expect(e.commission!.state).toBe("protegit");
    expect({ c: db().fin_calculations, l: db().fin_ledger, s: db().fin_settlements, sl: db().fin_settlement_lines, p: db().fin_payments }).toEqual(snap);
  });
});

describe("regularització històrica", () => {
  const seedHistoric = () => {
    const k = (id: string, client: string, sup: string, retailer: string, service: string) => ({ id, client_id: client, supply_id: sup, retailer, product: null, service, status: "actiu", start_date: "2026-03-01", end_date: "2027-03-01", signed_at: null, owner_id: null, expedient_id: null, previous_contract_id: null, collaborator_id: null });
    db().crm_contracts.push(
      k(ID(101), EMP, S30, "Endesa", "llum_empresa"),          // calculable
      k(ID(102), EMP, SNOKWH, "Endesa", "llum_empresa"),       // pendent de dades
      k(ID(103), PART, SNORULE, "Fictícia", "llum_residencial"), // pendent de regla
      k(ID(104), EMP, S61, "Endesa", "llum_empresa"),          // protegit (pagat)
      k(ID(105), EMP, SGAS, "Endesa", "gas"),                  // conflicte (import històric)
      k(ID(106), EMP, SGAS, "Endesa", "llum_empresa"),         // conflicte (gas classificat com a electricitat)
      k(ID(107), PART, S20, "Naturgy", "llum_residencial"),    // ja té càlcul
      { ...k(ID(108), PART, S20, "Movistar", "fibra"), supply_id: null },   // multiservei: fora d'abast
    );
    db().fin_ledger.push({ id: ID(191), contract_id: ID(104), layer: "proveidor", beneficiary_id: null, kind: "cobrament", amount: "595.00", settlement_id: null, idempotency_key: "c" });
    db().fin_hist_lines.push({ id: ID(192), contract_id: ID(105), movement_kind: "comissio", amount: "300.00" });
    db().fin_calculations.push({ id: ID(193), contract_id: ID(107), layer: "proveidor", status: "calculat", amount: "50.00", is_current: true, calc_hash: "h" });
  };
  const reg = async (who: ReturnType<typeof u>, data: Record<string, unknown>) => (await import("@/server/commission-regularize")).regularizeCommissions(who, data);

  it("dry-run obligatori: classifica sense escriure cap càlcul; aplicar sense revisió és impossible", async () => {
    seedHistoric();
    await expect(reg(u(ADM, "cap_administrativa"), { mode: "dry_run" })).rejects.toThrow(/Direcció/);
    await expect(reg(u(ADM, "admin"), { mode: "apply" })).rejects.toThrow(/simulació/);
    const before = db().fin_calculations.length;
    let p = await reg(u(ADM, "admin"), { mode: "dry_run", limit: 3 });
    while (!p.done) p = await reg(u(ADM, "admin"), { mode: "dry_run", runId: p.runId, after: p.nextCursor, limit: 3 });
    expect(db().fin_calculations.length).toBe(before);
    expect(p.counts).toMatchObject({ revisats: 7, ja_calculats: 1, calculable: 1, pendent_dades: 1, pendent_regla: 1, protegit: 1, conflicte: 2 });
    const items = db().fin_regularization_items as { contract_id: string; category: string; reasons: string[] }[];
    expect(items.find((i) => i.contract_id === ID(106))!.reasons.join()).toMatch(/incoherent/);
    expect(items.find((i) => i.contract_id === ID(103))!.reasons.join()).toMatch(/Sense col·laborador/);
    expect(items.find((i) => i.contract_id === ID(101))!.reasons.join()).not.toMatch(/Sense col·laborador/);
  });

  it("apply: només calcula els elegibles, per lots, de manera idempotent; protegits i conflictes intactes", async () => {
    seedHistoric();
    let p = await reg(u(ADM, "admin"), { mode: "dry_run" });
    expect(p.done).toBe(true);
    const snap = structuredClone({ l: db().fin_ledger, h: db().fin_hist_lines, c104: calcs(ID(104)), c105: calcs(ID(105)), c106: calcs(ID(106)), c107: calcs(ID(107)) });
    let a = await reg(u(ADM, "admin"), { mode: "apply", dryRunId: p.runId, limit: 2 });
    while (!a.done) a = await reg(u(ADM, "admin"), { mode: "apply", dryRunId: p.runId, runId: a.runId, after: a.nextCursor, limit: 2 });
    expect(a.counts).toMatchObject({ regularitzat: 1, marcat_pendent: 2 });
    expect(current(ID(101))).toMatchObject({ status: "calculat", amount: "534.00" });
    expect(current(ID(102))).toMatchObject({ status: "pendent_dades", amount: null });
    expect(current(ID(103))).toMatchObject({ status: "sense_regla", amount: null });
    expect({ l: db().fin_ledger, h: db().fin_hist_lines, c104: calcs(ID(104)), c105: calcs(ID(105)), c106: calcs(ID(106)), c107: calcs(ID(107)) }).toEqual(snap);
    expect(db().fin_ledger).toHaveLength(1);   // cap meritació, liquidació ni pagament nous
    // reexecució: res de nou
    const n = db().fin_calculations.length;
    p = await reg(u(ADM, "admin"), { mode: "dry_run" });
    const again = await reg(u(ADM, "admin"), { mode: "apply", dryRunId: p.runId });
    expect(db().fin_calculations.length).toBe(n);
    expect(again.counts.regularitzat ?? 0).toBe(0);
  });

  it("si entre la revisió i l'aplicació el contracte queda protegit, no es toca", async () => {
    seedHistoric();
    const p = await reg(u(ADM, "admin"), { mode: "dry_run" });
    db().fin_ledger.push({ id: ID(194), contract_id: ID(101), layer: "proveidor", beneficiary_id: null, kind: "confirmacio", amount: "534.00", settlement_id: null, idempotency_key: "z" });
    const a = await reg(u(ADM, "admin"), { mode: "apply", dryRunId: p.runId });
    expect(calcs(ID(101))).toHaveLength(0);
    expect(a.counts.omes_protegit).toBe(1);
  });
});
