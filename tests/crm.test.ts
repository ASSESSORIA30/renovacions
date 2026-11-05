import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  activityInput, allowedDocTypes, checkTaxId, clientInput, contractInput, extOf, normalizePhone, provinceFromPostalCode, retainUntil, safeFileName, safeSearch,
  sniffDoc, supplyInput, validCupsFull, zipKindOk, formatPhone,
} from "@/core/crm";
import { planImport } from "@/core/crm-import";
import type { SourceContract } from "@/core/types";

describe("Clients · validació i normalització", () => {
  it("NIF, NIE i CIF amb dígit de control", () => {
    expect(checkTaxId("12345678z")).toMatchObject({ value: "12345678Z", type: "nif", valid: true });
    expect(checkTaxId("12345678A").valid).toBe(false);
    expect(checkTaxId("x-1234567-l")).toMatchObject({ value: "X1234567L", type: "nie", valid: true });
    expect(checkTaxId("B60000000")).toMatchObject({ type: "cif", valid: false });
    expect(checkTaxId("B 6261 4337")).toMatchObject({ value: "B62614337", type: "cif" });
    expect(checkTaxId("A58818501")).toMatchObject({ type: "cif", valid: true }); // control numèric
    expect(checkTaxId("Q2826000H")).toMatchObject({ type: "cif", valid: true }); // control amb lletra
    expect(checkTaxId("ESB62614337").value).toBe("B62614337");
    expect(checkTaxId("DE123456789")).toMatchObject({ type: "altre", valid: true });
    expect(checkTaxId("")).toMatchObject({ value: null, valid: true });
  });
  it("telèfons espanyols i internacionals", () => {
    expect(normalizePhone("600 11 22 33")).toEqual({ value: "+34600112233", valid: true });
    expect(normalizePhone("0034 973-00-00-00")).toEqual({ value: "+34973000000", valid: true });
    expect(normalizePhone("+33 6 12 34 56 78")).toEqual({ value: "+33612345678", valid: true });
    expect(normalizePhone("12345").valid).toBe(false);
    expect(formatPhone("+34600112233")).toBe("600 11 22 33");
  });
  it("CUPS de 20 i 22 caràcters, i província pel codi postal", () => {
    expect(validCupsFull("es0021000000000001aa")).toBe(true);
    expect(validCupsFull("ES0021000000000001AA0F")).toBe(true);
    expect(validCupsFull("ES00210000")).toBe(false);
    expect(provinceFromPostalCode("25001")).toBe("Lleida");
    expect(provinceFromPostalCode("08001")).toBe("Barcelona");
  });
  it("esquema de client: normalitza, detecta errors i omple la província", () => {
    const ok = clientInput.parse({ kind: "empresa", name: " Forn Sant Jordi SL ", tax_id: "a58818501", phone: "973 00 00 00", email: " Info@Forn.CAT ", postal_code: "25001", tags: ["Hostaleria", "hostaleria"] });
    expect(ok).toMatchObject({ name: "Forn Sant Jordi SL", tax_id: "A58818501", tax_id_type: "cif", phone: "+34973000000", email: "info@forn.cat", province: "Lleida", tags: ["hostaleria"] });
    const bad = clientInput.safeParse({ kind: "empresa", name: "X", tax_id: "12345678Z", email: "no", postal_code: "123" });
    expect(bad.success).toBe(false);
    const msgs = bad.success ? [] : bad.error.issues.map((i) => i.message);
    expect(msgs).toEqual(expect.arrayContaining(["Una empresa ha de tenir CIF (o un identificador estranger)", "Correu electrònic no vàlid", "El codi postal ha de tenir 5 xifres"]));
    expect(clientInput.safeParse({ kind: "particular", name: "" }).success).toBe(false);
  });
  it("subministrament: CUPS normalitzat, potències només per a llum", () => {
    const s = supplyInput.parse({ cups: "es 0021 0000 0000 0001 aa", energy_type: "luz", power_kw: ["4,6", "4.6"], annual_kwh: "3.500" });
    expect(s.cups).toBe("ES0021000000000001AA");
    expect(s.power_kw).toEqual([4.6, 4.6]);
    expect(s.annual_kwh).toBe(3500);
    expect(supplyInput.parse({ cups: "ES0217900000000003AB", energy_type: "gas", power_kw: [5] }).power_kw).toBeNull();
    expect(supplyInput.safeParse({ cups: "ES0021000000000001AA", energy_type: "luz", power_kw: ["-1"] }).success).toBe(false);
  });
  it("contracte: un actiu necessita data de renovació i les dates han de ser coherents", () => {
    expect(contractInput.safeParse({ retailer: "Iberdrola", status: "actiu" }).success).toBe(false);
    expect(contractInput.safeParse({ retailer: "Iberdrola", status: "actiu", end_date: "2027-03-31" }).success).toBe(true);
    expect(contractInput.safeParse({ retailer: "X", start_date: "2027-01-01", end_date: "2026-01-01" }).success).toBe(false);
  });
  it("activitat: un usuari no pot marcar un correu com a enviat (només una integració)", () => {
    expect(activityInput.safeParse({ type: "email", title: "Proposta", delivery: "enviat" }).success).toBe(false);
    expect(activityInput.safeParse({ type: "email", title: "Proposta", delivery: "registrat" }).success).toBe(true);
    expect(activityInput.safeParse({ type: "whatsapp", title: "Obert", delivery: "intent" }).success).toBe(true);
  });
  it("cerca segura: sense comodins ni sintaxi de filtres", () => {
    expect(safeSearch("  Forn,%(Sant)_Jordí* ")).toBe("forn sant jordi");
  });
});

describe("Gestor documental · validació de fitxers", () => {
  const bytes = (s: string | number[]) => (typeof s === "string" ? new TextEncoder().encode(s) : new Uint8Array(s));
  it("tipus admesos i opcionals per configuració", () => {
    expect(Object.keys(allowedDocTypes(null))).toEqual(["pdf", "jpg", "jpeg", "png", "webp", "docx", "xlsx"]);
    expect(Object.keys(allowedDocTypes("csv, exe, heic"))).toEqual(expect.arrayContaining(["csv", "heic"]));
    expect(Object.keys(allowedDocTypes("exe"))).not.toContain("exe");
    expect(extOf("Factura GENER.PDF")).toBe("pdf");
  });
  it("el contingut real ha de coincidir amb l'extensió", () => {
    expect(sniffDoc(bytes("%PDF-1.7\n..."), "pdf").ok).toBe(true);
    expect(sniffDoc(bytes("MZ\x90\x00"), "pdf").ok).toBe(false); // executable amb extensió .pdf
    expect(sniffDoc(bytes([0xff, 0xd8, 0xff, 0xe0]), "jpg").ok).toBe(true);
    expect(sniffDoc(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png").ok).toBe(true);
    expect(sniffDoc(bytes("RIFF\x00\x00\x00\x00WEBPVP8 "), "webp").ok).toBe(true);
    expect(sniffDoc(bytes([0x89, 0x50, 0x4e, 0x47]), "jpg").ok).toBe(false);
  });
  it("DOCX i XLSX reals: estructura interna comprovada; un ZIP qualsevol amb extensió .docx es rebutja", async () => {
    const docx = new JSZip();
    docx.file("[Content_Types].xml", "<Types/>");
    docx.file("word/document.xml", "<w:document/>");
    const docxBytes = await docx.generateAsync({ type: "uint8array" });
    expect(sniffDoc(docxBytes, "docx")).toMatchObject({ ok: true, zip: true });
    expect(zipKindOk("docx", Object.keys((await JSZip.loadAsync(docxBytes)).files), null)).toBe(true);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["CUPS"], ["ES0021000000000001AA"]]), "Full1");
    const xlsxBytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const entries = Object.keys((await JSZip.loadAsync(xlsxBytes)).files);
    expect(zipKindOk("xlsx", entries, null)).toBe(true);
    expect(zipKindOk("docx", entries, null)).toBe(false); // un Excel reanomenat a .docx

    const other = new JSZip();
    other.file("virus.js", "alert(1)");
    expect(zipKindOk("docx", Object.keys((await JSZip.loadAsync(await other.generateAsync({ type: "uint8array" }))).files), null)).toBe(false);
  });
  it("noms de fitxer segurs i conservació obligatòria", () => {
    expect(safeFileName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeFileName('fac"tura<1>.pdf')).toBe("factura1.pdf");
    expect(retainUntil("contracte_signat", new Date("2026-10-31T10:00:00Z"))).toBe("2032-10-31");
    expect(retainUntil("factura_llum")).toBeNull();
  });
});

describe("Importació de la cartera al CRM", () => {
  const base = (p: Partial<SourceContract>): SourceContract => ({
    id: "c1", cups: "ES0021000000000001AA", cif: "A58818501", cliente: "FORN SANT JORDI SL", direccion: "C/ Major 1", poblacion: "Lleida", provincia: "Lleida", cp: "25001", telefono: "973000000", email: "INFO@FORN.CAT",
    tipo: "luz", comercializadora: "Endesa", comercializadoraAnterior: null, tarifa: "2.0TD", producto: "Tempo", precioContratado: null, consumoAnual: 3000, potencia: 4.6, potencias: [4.6, 4.6],
    estadoOrigen: null, estadoAlta: null, tipoAlta: null, excedentes: null, observaciones: null, comentario: null, comentarioLlamada: null, renovat2026: null, representante: "Jordi", captador: null, comercial: "IBETH", colaborador: null,
    fechaInicio: "2025-11-01", fechaInicioFuente: null, vencimientoOriginal: "2026-11-01", vencimiento: "2026-11-01", renovacionTacita: false, fechaBaja: null, contratosPrevios: 0, registrosDiarios: 0, status: "pendiente", motivoRechazo: null, source: "real", ...p,
  });
  const ex = { taxIds: new Map<string, string>(), cups20: new Set<string>(), legacyIds: new Set<string>(), ownerByCode: new Map([["IBETH", "u-ibeth"]]), collaboratorByKey: new Map<string, string>() };

  it("agrupa per NIF/CIF, un subministrament per CUPS i un contracte per registre", () => {
    const rows = [
      { contract: base({}), status: null, removed: false },
      { contract: base({ id: "c2", cups: "ES0217900000000003AB", tipo: "gas", comercializadora: "Naturgy" }), status: null, removed: false },
      { contract: base({ id: "c3", cif: null, cliente: "Maria Puig", telefono: "600112233", cups: "ES0021000000000009ZZ" }), status: "renovado" as const, removed: false },
    ];
    const plan = planImport(rows, ex, "2026-10-31");
    expect(plan.stats).toMatchObject({ newClients: 2, contracts: 3, supplies: 3, withoutTaxId: 1 });
    const forn = plan.groups.find((g) => g.key === "t:A58818501")!;
    expect(forn.row).toMatchObject({ kind: "empresa", tax_id: "A58818501", phone: "+34973000000", email: "info@forn.cat", owner_id: "u-ibeth", status: "actiu", origin: "Cartera existent" });
    expect(forn.supplies.map((s) => s.energy_type)).toEqual(["luz", "gas"]);
    expect(forn.contracts.map((k) => k.legacy_contract_id)).toEqual(["c1", "c2"]);
    expect(plan.groups.find((g) => g.key.startsWith("n:"))!.row).toMatchObject({ kind: "particular", tax_id: null });
  });
  it("és idempotent: el que ja existeix s'omet i els contractes vençuts queden finalitzats", () => {
    const plan = planImport(
      [{ contract: base({}), status: null, removed: false }, { contract: base({ id: "c9", vencimiento: "2025-01-01", cups: "ES0021000000000002AA" }), status: "no_renueva", removed: false }],
      { ...ex, taxIds: new Map([["A58818501", "client-existent"]]), legacyIds: new Set(["c1"]) },
      "2026-10-31",
    );
    expect(plan.stats).toMatchObject({ skippedContracts: 1, existingClients: 1, newClients: 0 });
    expect(plan.groups[0]).toMatchObject({ existingId: "client-existent", row: null });
    expect(plan.groups[0].contracts[0]).toMatchObject({ status: "finalitzat", legacy_contract_id: "c9" });
  });
  it("conserva a observacions un NIF no vàlid en lloc de perdre'l", () => {
    const plan = planImport([{ contract: base({ cif: "B60000000" }), status: null, removed: false }], ex, "2026-10-31");
    expect(plan.stats.invalidTaxId).toBe(1);
    expect(plan.groups[0].row).toMatchObject({ tax_id: null });
    expect(String(plan.groups[0].row!.notes)).toContain("B60000000");
  });
});
