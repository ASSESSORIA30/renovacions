/**
 * Fase 9 · Navegació, context i continuïtat: lògica pura i del magatzem (sense navegador).
 * Les dades són inventades (CUPS i DNI de prova amb lletra de control vàlida, cap dada real).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { contextKey, normCups } from "@/server/navigation";
import { sipsDiff } from "@/core/sips-diff";
import { MASKED, clientInput, maskId } from "@/core/crm";
import { useApp } from "@/data/store";

const CUPS = "ES0031400000000001JN";

describe("CUPS i context dels esborranys", () => {
  it("normalitza el CUPS amb o sense sufix 0F i amb espais", () => {
    expect(normCups(`${CUPS}0F`)).toEqual({ full: `${CUPS}0F`, cups20: CUPS, valid: true });
    expect(normCups(" es 0031 4000 0000 0001 jn ").cups20).toBe(CUPS);
    expect(normCups("XX123").valid).toBe(false);
  });
  it("un sol context per contracte, client+subministrament o CUPS (el 0F no crea un esborrany nou)", () => {
    expect(contextKey({ contract: "r-12" })).toBe("contract:r-12");
    expect(contextKey({ client: "11111111-1111-4111-8111-111111111111", supply: "22222222-2222-4222-8222-222222222222" })).toBe("client:11111111-1111-4111-8111-111111111111:supply:22222222-2222-4222-8222-222222222222");
    expect(contextKey({ cups: `${CUPS}0F` })).toBe(contextKey({ cups: CUPS }));
    expect(contextKey({})).toBeNull();
  });
});

describe("Importació del SIPS amb comparació", () => {
  const sips = { tariff: "3.0TD", powerKw: [15, 15, 15, 15, 15, 20], annualKwh: 48000, retailer: "Comercialitzadora B", address: "C/ Prova 1", cups: `${CUPS}0F` };
  it("no marca per defecte els valors introduïts a mà o de la factura", () => {
    const rows = sipsDiff({ tariff: "3.0TD", powerKw: [15, 15, 15, 15, 15, 15], annualKwh: 50000, retailer: "Comercialitzadora A", address: null, cups: CUPS, sources: { kw: "factura", kwhTotal: "manual", retailer: "crm" } }, sips);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.tariff).toBeUndefined(); // igual: no surt
    expect(by.powerKw.defaultOn).toBe(false);
    expect(by.powerKw.protectedValue).toBe(true);
    expect(by.annualKwh.defaultOn).toBe(false);
    expect(by.retailer.defaultOn).toBe(true); // venia del CRM
    expect(by.address.defaultOn).toBe(true); // estava buit
  });
  it("si tot coincideix no hi ha res a importar", () => {
    expect(sipsDiff({ ...sips, sources: {} }, sips)).toEqual([]);
  });
});

describe("Persona de contacte i representant legal (empreses)", () => {
  const base = { kind: "empresa", name: "Empresa de Prova SL", tax_id: "B00000000", status: "actiu", contact_name: "Anna Exemple", contact_role: "Gerència", owner_id: null, collaborator_id: null, tags: [], priority: "mitjana" };
  it("valida el DNI/NIE del representant", () => {
    const r = clientInput.safeParse({ ...base, legal_rep_name: "Pere Exemple", legal_rep_tax_id: "00000001X", legal_rep_role: "administrador" });
    expect(r.success).toBe(false);
    const ok = clientInput.safeParse({ ...base, legal_rep_name: "Pere Exemple", legal_rep_tax_id: "00000000T", legal_rep_role: "administrador" });
    expect(ok.success).toBe(true);
  });
  it("la casella copia el nom del contacte com a representant", () => {
    const r = clientInput.parse({ ...base, contact_is_legal_rep: true, legal_rep_role: "apoderat" });
    expect(r.legal_rep_name).toBe("Anna Exemple");
    expect(r.contact_is_legal_rep).toBe(true);
  });
  it("un DNI ocult (amb asteriscos) no s'esborra en desar", () => {
    expect(clientInput.parse({ ...base, legal_rep_name: "Pere Exemple", legal_rep_tax_id: "********" }).legal_rep_tax_id).toBe(MASKED);
  });
  it("als particulars no s'hi desa representant legal", () => {
    const r = clientInput.parse({ ...base, kind: "particular", tax_id: "00000000T", legal_rep_name: "Algú", legal_rep_tax_id: "00000000T" });
    expect(r.legal_rep_name).toBeNull();
    expect(r.legal_rep_tax_id).toBeNull();
  });
  it("emmascara documents d'identitat", () => {
    expect(maskId("00000000T")).not.toContain("000000");
    expect(maskId("00000000T")!.endsWith("T")).toBe(true);
  });
});

describe("Navegació interna: recorregut, enrere i canvis sense desar", () => {
  beforeEach(() => useApp.setState({ view: "clients", params: {}, trail: [{ view: "clients", params: {}, label: null }], navIdx: 0, guard: null, pendingNav: null, returnTo: null }));

  it("cada pantalla s'afegeix al recorregut i canviar de pestanya no n'afegeix cap", () => {
    const st = useApp.getState();
    st.navigate("client", { id: "c1" });
    useApp.getState().navigate("client", { id: "c1", tab: "contractes" }, { replace: true });
    const s = useApp.getState();
    expect(s.trail.map((c) => c.view)).toEqual(["clients", "client"]);
    expect(s.navIdx).toBe(1);
    expect(s.canGoBack()).toBe(true);
    s.setCrumbLabel("Empresa de Prova SL");
    expect(useApp.getState().trail[1].label).toBe("Empresa de Prova SL");
  });

  it("enrere sense historial va a una destinació segura (pantalla mare)", () => {
    useApp.setState({ view: "client", params: { id: "c1" }, trail: [{ view: "client", params: { id: "c1" }, label: null }], navIdx: 0 });
    useApp.getState().back();
    expect(useApp.getState().view).toBe("clients");
  });

  it("amb canvis sense desar es pregunta abans de sortir; «Cancel·la» s'hi queda i «Surt» hi va", async () => {
    let dirty = true;
    useApp.setState({ guard: { label: "Edició", dirty: () => dirty } });
    useApp.getState().navigate("kanban");
    expect(useApp.getState().view).toBe("clients");
    expect(useApp.getState().pendingNav?.view).toBe("kanban");
    await useApp.getState().resolvePending("cancel");
    expect(useApp.getState().view).toBe("clients");
    expect(useApp.getState().pendingNav).toBeNull();
    useApp.getState().navigate("kanban");
    await useApp.getState().resolvePending("leave");
    expect(useApp.getState().view).toBe("kanban");
    dirty = false;
  });

  it("«Desa i surt» només surt si s'ha pogut desar", async () => {
    let saved = false;
    useApp.setState({ guard: { label: "Edició", dirty: () => !saved, save: async () => false } });
    useApp.getState().navigate("kanban");
    await useApp.getState().resolvePending("save");
    expect(useApp.getState().view).toBe("clients");
    useApp.setState({ guard: { label: "Edició", dirty: () => !saved, save: async () => { saved = true; return true; } } });
    useApp.getState().navigate("kanban");
    await useApp.getState().resolvePending("save");
    expect(useApp.getState().view).toBe("kanban");
  });

  it("el punt de subministrament es normalitza", () => {
    useApp.getState().openSupply(" es0031400000000001jn0f ");
    expect(useApp.getState().supplyFor).toBe(`${CUPS}0F`);
    useApp.getState().openSupply(null);
  });
});
