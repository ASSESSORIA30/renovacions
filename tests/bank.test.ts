/**
 * Extractes bancaris i lector de liquidacions amb CUPS o telèfon a la mateixa columna. Dades fictícies.
 */
import { describe, expect, it } from "vitest";
import { parseBankGrid, parseNorma43, suggest, unpaidAnalysis, type OpenInvoice } from "@/core/bank";
import { phoneOf, readSettlement, type Cell } from "@/core/settlement-reader";

/* ---------------------------------------------------------------- liquidació «581»: CUPS o telèfon, IVA inclòs */
const H = ["   TRAMITACIÓN", " MES  ACTIVACIÓN", "ACTIVADO", "   COLABORADOR", "   COMERCIAL", "   ACCIÓN", "   FIBRA / MOVIL", "   OPERADOR", "   TARIFA", "   TELÉFONO", "   NOMBRE DEL CLIENTE", "   DNI", "   CONTACTO", "   CORREO", "OBSERVACIONES", "TELÉFONO", "COMISIÓN IVA INCLUIDO", null, null, null];
const row = (a: Cell[]) => [...a, ...Array(20 - a.length).fill(null)] as Cell[];
const grid = {
  fileName: "999 PROVA - SETEMBRE.xlsx",
  sheets: [{ name: "999 PROVA", rows: [
    H,
    row(["2026-09-02", "2026-09-14", "SÍ", "999 PROVA", "COMERCIAL A", "PORTA", "FIBRA/ADSL", "OPERADOR X", "FIBRA 1GB", 973000001, "CLIENT FICTICI 1", "00000000T", null, "x@exemple.test", "", null, 272.29]),
    row(["2026-09-10", "2026-09-16", "SÍ", "999 PROVA", "COMERCIAL B", "LUZ", "PRESCRIPTOR", "0 - 10 kW", "SIN SERVICIO", "ES0031406187631039LL0F", "CLIENT FICTICI 2", "B00000000", null, "y@exemple.test", "", null, 72.6, null, "TOTAL IVA INCLUIDO", 434.43]),
    row(["2026-09-15", "2026-09-16", "SÍ", "999 PROVA", "COMERCIAL B", "LUZ", "PRESCRIPTOR", "0 - 10 kW", "OKLUZ 360", "ES0031102383105018VA0F", "CLIENT FICTICI 3", "X0000000T", 600000003, "z@exemple.test", "", null, 89.54]),
    row(["2026-09-21", "2026-09-24", "CN SI", "999 PROVA", "COMERCIAL C", "GAS", "SIN PRESCRIPTOR", "GAS", "SIN SERVICIO", "ES0230012300026114HW", "CLIENT FICTICI 4", "00000001R", 600000004, "w@exemple.test", "", null, "NO COMISIONA", null, "TOTAL BAJAS IVA INCLUIDO", 0]),
    row([null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "COMISIÓN + IVA", 359.03]),
  ] }],
};

describe("liquidació amb CUPS o telèfon a la mateixa columna", () => {
  const r = readSettlement(grid);
  it("cada fila s'interpreta pel seu valor: CUPS → subministrament; 9 xifres → línia de fibra o mòbil", () => {
    expect(r.movements).toHaveLength(4);
    expect(r.movements[0]).toMatchObject({ cups: null, phone: "973000001", energy: null });
    expect(r.movements[0].concept).toMatch(/fibra · tel\. 973000001 · FIBRA 1GB/);
    expect(r.movements[1]).toMatchObject({ cups: "ES0031406187631039LL0F", phone: null, energy: "llum", movement: "alta" });
    expect(r.movements[3]).toMatchObject({ energy: "gas" });
    expect(r.movements.every((m) => !m.flags.some((f) => /CUPS no vàlid/.test(f)))).toBe(true);
  });
  it("l'import porta l'IVA: es desa la base i es conserva el brut", () => {
    expect(r.movements.map((m) => [m.gross, m.amount])).toEqual([["272.29", "225.03"], ["72.60", "60.00"], ["89.54", "74.00"], ["0.00", "0.00"]]);
    expect(r.total).toBe("359.03");
    expect(r.movements[3].flags.join(" ")).toMatch(/NO COMISIONA/);
    expect(r.movements[3].flags.join(" ")).toMatch(/CN SI/);
  });
  it("els resums de la dreta no són moviments i serveixen per quadrar", () => {
    expect(r.errors).toEqual([]);
    expect(r.sheets[0].declaredTotal).toBe("359.03");
    expect(r.sheets[0].balanced).toBe(true);
  });
  it("la «TARIFA» comercial passa a producte (no és un peatge)", () => {
    expect(r.movements[2]).toMatchObject({ product: "OKLUZ 360", tariff: null });
  });
  it("telèfons", () => {
    expect(phoneOf("+34 973 000 001")).toBe("973000001");
    expect(phoneOf("12345")).toBeNull();
  });
});

/* ---------------------------------------------------------------- extractes */
const pad = (s: string, n: number) => s.padEnd(n, " ").slice(0, n);
const n43 = [
  pad("11" + "0049" + "0001" + "0000000001" + "261001" + "261031", 80),
  pad("22" + "    " + "0001" + "261014" + "261014" + "02" + "099" + "2" + "00000000635976" + "0000000001" + "TRANSF REF1 " + "26-046 PROVA", 80),
  pad("23" + "01" + "TRANSFERENCIA DE CLIENT FICTICI SA", 80),
  pad("22" + "    " + "0001" + "261015" + "261015" + "12" + "001" + "1" + "00000000005000" + "0000000000" + "" + "COMISSIO", 80),
  pad("33", 80), pad("88", 80),
].join("\r\n");

describe("lectura d'extractes", () => {
  it("Norma 43: compte, període, signe, import i concepte complementari", () => {
    const r = parseNorma43(n43);
    expect(r).toMatchObject({ format: "norma43", account: "004900010000000001", from: "2026-10-01", to: "2026-10-31" });
    expect(r.movements.map((m) => [m.opDate, m.amount])).toEqual([["2026-10-14", "6359.76"], ["2026-10-15", "-50.00"]]);
    expect(r.movements[0].concept).toMatch(/26-046 PROVA.*CLIENT FICTICI SA/);
    expect(new Set(r.movements.map((m) => m.hash)).size).toBe(2);
  });
  it("Excel/CSV de la banca en línia (càrrec i abonament separats)", () => {
    const r = parseBankGrid({ fileName: "moviments.xlsx", sheets: [{ name: "Moviments", rows: [
      ["Compte: ES00 0000 0000 0000 0000 0000"], [],
      ["Fecha operación", "Fecha valor", "Concepto", "Cargo", "Abono", "Saldo"],
      ["14/10/2026", "14/10/2026", "TRANSFERENCIA CLIENT FICTICI SA FRA 26-046", null, "6.359,76", "10.000,00"],
      ["15/10/2026", "15/10/2026", "COMISION MANTENIMIENTO", "50,00", null, "9.950,00"],
    ] }] });
    expect(r.movements.map((m) => [m.opDate, m.amount, m.balance])).toEqual([["2026-10-14", "6359.76", "10000.00"], ["2026-10-15", "-50.00", "9950.00"]]);
    expect(r.account).toBe("ES0000000000000000000000");
  });
});

describe("proposta de conciliació i factures pendents", () => {
  const inv = (n: string, client: string, nif: string, pending: string, due = "2026-11-13"): OpenInvoice => ({ id: n, invoice_no: n, issue_date: "2026-10-01", due_date: due, client_id: client, client_name: client, client_nif: nif, pending, payment_unknown: false });
  const open = [inv("26-046", "CLIENT FICTICI SA", "A00000001", "6359.76"), inv("26-045", "ALTRA EMPRESA SL", "B00000002", "3378.32"), inv("26-040", "TERCERA SL", "B00000003", "100.00"), inv("26-041", "TERCERA SL", "B00000003", "250.50"), inv("26-047", "QUARTA SL", "B00000004", "6359.76")];
  it("import exacte + número de factura al concepte → confiança alta", () => {
    const s = suggest({ amount: "6359.76", concept: "TRANSFERENCIA CLIENT FICTICI SA FRA 26-046", opDate: "2026-10-14" }, open);
    expect(s[0]).toMatchObject({ confidence: "alta", invoices: [{ invoice_no: "26-046" }] });
  });
  it("dues factures amb el mateix import i sense pistes → cap proposta segura", () => {
    const s = suggest({ amount: "6359.76", concept: "TRANSFERENCIA", opDate: "2026-10-14" }, open);
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.confidence !== "alta")).toBe(true);
  });
  it("un pagament agrupat de dues factures del mateix client", () => {
    const s = suggest({ amount: "350.50", concept: "TERCERA SL", opDate: "2026-10-20" }, open);
    expect(s[0].invoices.map((i) => i.invoice_no).sort()).toEqual(["26-040", "26-041"]);
  });
  it("els càrrecs no cobren factures i les anteriors a l'emissió no s'hi proposen", () => {
    expect(suggest({ amount: "-50.00", concept: "x", opDate: "2026-10-20" }, open)).toEqual([]);
    expect(suggest({ amount: "100.00", concept: "TERCERA", opDate: "2026-09-01" }, open)).toEqual([]);
  });
  it("factures que l'extracte no explica, ordenades per dies de retard", () => {
    const u = unpaidAnalysis(open, new Set(["26-046", "26-047"]), "2026-12-01");
    expect(u.map((x) => x.invoice_no)).toEqual(["26-045", "26-040", "26-041"]);
    expect(u[0]).toMatchObject({ overdue: true, daysOverdue: 18 });
  });
});
