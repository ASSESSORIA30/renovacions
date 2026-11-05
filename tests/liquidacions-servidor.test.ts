/**
 * Fase 14 · Importació i vinculació de liquidacions al servidor (Supabase en memòria).
 * Excel anonimitzat de Gana (75368) i de Niba. Comprova: lectura de totes les pestanyes, traçabilitat (pestanya i
 * fila), reimportació bloquejada, vinculació amb nivells de confiança (un mateix CUPS amb diversos contractes no
 * s'assigna sol; les renovacions van al contracte de renovació) i imports zero sense moviment econòmic.
 * La RLS, la funció de cobrament net i l'autorització es proven sobre PostgreSQL a tests/db/auditor-comissions-rls.test.ts.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => null };
});

const ADMIN = "00000000-0000-4000-8000-0000000000ad", COM = "00000000-0000-4000-8000-0000000000c1";
const user = (id: string, role: string) => ({ sb: state.sb, user: { id }, profile: { id, name: role, email: `${role}@exemple.test`, role, code: null } }) as never;
const file = (f: string, name = f) => ({ name, base64: readFileSync(`tests/fixtures/liquidacions/${f}`).toString("base64") });
const GANA = () => file("75368-anonim.xlsx", "75368.xlsx");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// CUPS inventats de la còpia anonimitzada
const CUPS_ALTA = "ES0021006262014095TK", CUPS_DUBTE = "ES0031006008525830IJ", CUPS_RENOV = "ES0031000758332512DP", CUPS_ALTRA = "ES0217003461893960XN", CUPS_ZERO = "ES0031009856290885NF";

function seed() {
  return {
    profiles: [{ id: ADMIN, name: "Direcció", role: "admin" }],
    retailers: [{ id: id(900), trade_name: "Gana Energía", aliases: ["Gana", "GANA ENERGIA"] }],
    crm_clients: [{ id: id(1), name: "CLIENT FICTICI 1" }, { id: id(2), name: "CLIENT FICTICI 2" }],
    crm_supplies: [
      { id: id(11), client_id: id(1), cups: CUPS_ALTA, energy_type: "electricitat" },
      { id: id(12), client_id: id(1), cups: `${CUPS_DUBTE}0F`, energy_type: "electricitat" },      // amb sufix 0F al CRM
      { id: id(13), client_id: id(2), cups: CUPS_RENOV, energy_type: "electricitat" },
      { id: id(14), client_id: id(2), cups: CUPS_ALTRA, energy_type: "gas" },
      { id: id(15), client_id: id(2), cups: CUPS_ZERO, energy_type: "electricitat" },
    ],
    crm_contracts: [
      { id: id(101), client_id: id(1), supply_id: id(11), retailer: "Gana", status: "actiu", start_date: "2026-10-22", product: "Tarifa Precio de Mercado", previous_contract_id: null },
      // el mateix CUPS amb dues altes de Gana en dates llunyanes a l'activació: ambigu
      { id: id(102), client_id: id(1), supply_id: id(12), retailer: "Gana Energía", status: "finalitzat", start_date: "2024-01-10", end_date: "2025-01-09", product: "Tarifa 24 horas", previous_contract_id: null },
      { id: id(103), client_id: id(1), supply_id: id(12), retailer: "Gana Energía", status: "actiu", start_date: "2025-03-01", product: "Tarifa 24 horas", previous_contract_id: null },
      // alta original i renovació del mateix CUPS
      { id: id(104), client_id: id(2), supply_id: id(13), retailer: "Gana Energía", status: "finalitzat", start_date: "2024-10-03", product: "Tarifa Tramos Horarios", previous_contract_id: null },
      { id: id(105), client_id: id(2), supply_id: id(13), retailer: "Gana Energía", status: "actiu", start_date: "2025-10-03", product: "Tarifa Tramos Horarios", previous_contract_id: id(104) },
      // el CUPS és al CRM, però amb una altra comercialitzadora
      { id: id(106), client_id: id(2), supply_id: id(14), retailer: "Naturgy", status: "actiu", start_date: "2026-10-24", product: "Gas", previous_contract_id: null },
      { id: id(107), client_id: id(2), supply_id: id(15), retailer: "Gana Energía", status: "actiu", start_date: "2026-10-16", product: "Tarifa Precio de Mercado", previous_contract_id: null },
    ],
  };
}
const fin = () => import("@/server/finance");
type Line = { id: string; cups: string | null; amount: string; kind: string; movement: string; source_sheet: string; source_row: number; contract_id: string | null; match_status: string; match_confidence: string | null; match_reason: string | null; match_candidates: { id: string; suggested?: boolean }[]; line_hash: string; stable_key: string; flags: string[] };
const lines = () => state.sb.db.fin_statement_lines as Line[];
const lineOf = (cups: string, sheet?: string) => lines().find((l) => l.cups === cups && (!sheet || l.source_sheet === sheet))!;

describe("servidor · importació de liquidacions (Fase 14)", () => {
  beforeEach(() => { state.sb = fakeSupabase(seed() as never); });

  it("previsualització: detecta Gana, 8 pestanyes, 86 moviments i 2.011,25 € sense desar res", async () => {
    const f = await fin();
    const p = await f.previewStatement(user(ADMIN, "admin"), {}, GANA());
    expect([p.supplier?.name, p.retailer, p.count, p.total, p.sheets.length, p.errors]).toEqual(["Gana Energía", "Gana Energía", 86, "2011.25", 8, []]);
    expect(p.duplicateOf).toBeNull();
    expect(state.sb.db.fin_provider_statements ?? []).toHaveLength(0);
  });

  it("importa les 86 línies amb la pestanya, la fila i el tipus de moviment de cada una", async () => {
    const f = await fin();
    const r = await f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10", received_at: "2026-11-02", period_to: "2026-10-31" }, GANA());
    expect([r.lines, r.total]).toEqual([86, "2011.25"]);
    const st = (state.sb.db.fin_provider_statements as { supplier_format: string; file_sha256: string; read_summary: { total: string } }[])[0];
    expect([st.supplier_format, st.file_sha256.length, st.read_summary.total]).toEqual(["gana", 64, "2011.25"]);
    const l = lineOf(CUPS_ALTA);
    expect([l.source_sheet, l.source_row, l.movement, l.kind, l.amount]).toEqual(["Altas LUZ", 2, "alta", "comissio", "100.00"]);
    expect(lines().filter((x) => x.kind === "retrocessio")).toHaveLength(16);
    expect(new Set(lines().map((x) => x.stable_key)).size).toBe(86);
  });

  it("el mateix fitxer no es pot tornar a importar (i la previsualització ho diu)", async () => {
    const f = await fin();
    await f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10", received_at: "2026-11-02" }, GANA());
    await expect(f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10-bis" }, GANA())).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ja s'ha importat/) });
    expect((await f.previewStatement(user(ADMIN, "admin"), {}, GANA())).duplicateOf?.reference).toBe("GANA-2026-10");
    expect(lines()).toHaveLength(86);
  });

  it("vinculació: inequívoca, renovació al contracte de renovació, ambigua sense assignar i CUPS d'una altra comercialitzadora", async () => {
    const f = await fin();
    await f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10", received_at: "2026-11-02" }, GANA());
    const a = lineOf(CUPS_ALTA);
    expect([a.contract_id, a.match_confidence]).toEqual([id(101), "inequivoca"]);
    expect(a.match_reason).toMatch(/CUPS .* Gana Energía/);
    const r = lineOf(CUPS_RENOV, "Renovaciones LUZ");
    expect([r.contract_id, r.match_confidence]).toEqual([id(105), "inequivoca"]);
    expect(r.match_reason).toMatch(/renovació/);
    const d = lineOf(CUPS_DUBTE);                                     // sufix 0F al CRM i dos contractes compatibles
    expect([d.contract_id, d.match_status, d.match_confidence, d.match_candidates.length]).toEqual([null, "pendent", "multiple", 2]);
    const o = lineOf(CUPS_ALTRA);
    expect([o.contract_id, o.match_status]).toEqual([null, "no_identificat"]);
    expect(o.match_reason).toMatch(/cap contracte és de Gana Energía/);
  });

  it("assignar a mà una línia ambigua la marca com a manual; un import zero es concilia sense moviment econòmic", async () => {
    const f = await fin();
    await f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10", received_at: "2026-11-02" }, GANA());
    const d = lineOf(CUPS_DUBTE);
    await f.resolveLine(user(ADMIN, "admin"), { lineId: d.id, action: "assignar", contractId: id(103) });
    expect([lineOf(CUPS_DUBTE).contract_id, lineOf(CUPS_DUBTE).match_confidence]).toEqual([id(103), "manual"]);
    const z = lineOf(CUPS_ZERO);
    expect([z.amount, z.contract_id]).toEqual(["0.00", id(107)]);
    await f.resolveLine(user(ADMIN, "admin"), { lineId: z.id, action: "conciliar", note: "Alta sense comissió" });
    expect(lineOf(CUPS_ZERO).match_status).toBe("conciliat");
    expect((state.sb.db.fin_ledger ?? []).some((x) => (x as { statement_line_id: string }).statement_line_id === z.id)).toBe(false);
  });

  it("Fase 14.2 · CUPS al CRM amb una altra comercialitzadora: es proposa i es crea el contracte de Gana, i la línia s'identifica", async () => {
    const f = await fin();
    const { id: st } = await f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10", received_at: "2026-11-02" }, GANA());
    expect(lineOf(CUPS_ALTRA).match_status).toBe("no_identificat");
    const m = await f.missingContracts(user(ADMIN, "admin"), st);
    const p = m.proposals.find((x) => x.cups === CUPS_ALTRA)!;
    expect([m.retailer, p.client, p.status, p.start, p.current.map((k) => k.retailer)]).toEqual(["Gana Energía", "CLIENT FICTICI 2", "actiu", "2026-10-24", ["Naturgy"]]);
    expect(m.notInCrm.length).toBeGreaterThan(50);                                   // la resta de CUPS de la còpia no són al CRM de prova
    expect(m.proposals.some((x) => x.cups === CUPS_ALTA)).toBe(false);               // aquest ja té contracte de Gana
    const r = await f.createMissingContracts(user(ADMIN, "admin"), st, { cups: [CUPS_ALTRA], closePrevious: true });
    expect([r.created, r.failed]).toEqual([1, []]);
    const k = (state.sb.db.crm_contracts as { id: string; retailer: string; supply_id: string; status: string; start_date: string; notes: string }[]).find((x) => x.supply_id === id(14) && x.retailer === "Gana Energía")!;
    expect([k.status, k.start_date]).toEqual(["actiu", "2026-10-24"]);
    expect(k.notes).toMatch(/Creat des de la liquidació Gana Energía GANA-2026-10 \(Altas GAS · fila 2\)/);
    expect([lineOf(CUPS_ALTRA).contract_id, lineOf(CUPS_ALTRA).match_confidence]).toEqual([k.id, "inequivoca"]);
    expect((state.sb.db.crm_contracts as { id: string; status: string }[]).find((x) => x.id === id(106))!.status).toBe("finalitzat");
  });

  it("Fase 14.2 · CUPS que no és al CRM: en triar el client s'hi afegeix el CUPS i es crea el contracte", async () => {
    const f = await fin();
    await f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10", received_at: "2026-11-02" }, GANA());
    const l = lines().find((x) => x.source_sheet === "Altas LUZ" && x.source_row === 4)!;       // CUPS que no existeix al CRM
    expect(l.match_reason).toMatch(/Cap subministrament del CRM/);
    await f.createContractForLine(user(ADMIN, "admin"), { lineId: l.id, clientId: id(1) });
    const sup = (state.sb.db.crm_supplies as { id: string; cups: string; client_id: string }[]).find((x) => x.cups === l.cups)!;
    expect(sup.client_id).toBe(id(1));
    const after = lines().find((x) => x.id === l.id)!;
    expect(after.contract_id).toBeTruthy();
    await expect(f.createContractForLine(user(ADMIN, "admin"), { lineId: lineOf(CUPS_ALTRA).id, clientId: id(1) })).rejects.toMatchObject({ status: 409 });   // CUPS d'un altre client
  });

  it("Fase 14.2 · tornar a identificar 86 línies fa les consultes en bloc (abans: diverses per línia → error 504)", async () => {
    const f = await fin();
    const { id: st } = await f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10", received_at: "2026-11-02" }, GANA());
    const calls: string[] = [];
    const from = state.sb.from.bind(state.sb);
    (state.sb as { from: typeof from }).from = (t: string) => { calls.push(t); return from(t); };
    await f.autoMatch(user(ADMIN, "admin"), st);
    (state.sb as { from: typeof from }).from = from;
    const reads = calls.filter((t) => t !== "fin_statement_lines").length;
    expect(reads).toBeLessThan(12);                                   // subministraments, contractes, càlculs… una vegada
    expect(calls.length).toBeLessThan(86 + 15);                       // + una actualització per línia (8 alhora)
  });

  it("Fase 14.4 · «Concilia-ho tot»: totes les identificades d'un cop; zero sense moviment; no toca les que no tenen contracte", async () => {
    const f = await fin();
    const { id: st } = await f.createStatement(user(ADMIN, "admin"), { retailer: "Gana Energía", reference: "GANA-2026-10", received_at: "2026-11-02" }, GANA());
    const ident = lines().filter((l) => l.match_status === "identificat").map((l) => l.id);
    expect(ident.length).toBe(3);                                                          // alta, renovació i l'alta a zero
    await expect(f.conciliateAll(user(ADMIN, "admin"), st, { includeDifferences: true })).rejects.toMatchObject({ status: 400 });
    const r = await f.conciliateAll(user(ADMIN, "admin"), st, {});
    expect([r.conciliated, r.amount]).toEqual([3, "140.00"]);                              // 100 + 40 + 0
    expect(lines().filter((l) => ident.includes(l.id)).every((l) => l.match_status === "conciliat")).toBe(true);
    const led = (state.sb.db.fin_ledger ?? []) as { statement_line_id: string; kind: string; amount: string }[];
    expect(led.map((x) => [x.kind, x.amount]).sort()).toEqual([["confirmacio", "100.00"], ["confirmacio", "40.00"]]);
    expect(lines().filter((l) => !l.contract_id).every((l) => l.match_status !== "conciliat")).toBe(true);
    expect((await f.conciliateAll(user(ADMIN, "admin"), st, {})).conciliated).toBe(0);     // repetir-ho no duplica res
    await expect(f.conciliateAll(user(COM, "comercial"), st, {})).rejects.toMatchObject({ status: 403 });
  });

  it("Niba: 31 moviments i 2.792,00 €; un comercial no pot importar liquidacions", async () => {
    const f = await fin();
    const p = await f.previewStatement(user(ADMIN, "admin"), {}, file("Liquidacion_Septiembre2026-anonim.xlsx"));
    expect([p.supplier?.id, p.count, p.total]).toEqual(["niba", 31, "2792.00"]);
    await expect(f.previewStatement(user(COM, "comercial"), {}, file("Liquidacion_Septiembre2026-anonim.xlsx"))).rejects.toMatchObject({ status: 403 });
  });
});
