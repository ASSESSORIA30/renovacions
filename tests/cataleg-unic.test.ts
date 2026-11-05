/**
 * UNIFICACIÓ · Catàleg de tarifes com a ÚNICA FONT (comparatives, PDF i renovacions) i retirada de «Propostes».
 * Supabase SIMULAT en memòria (sense RLS: la RLS es prova a tests/db/cataleg-unic-rls.test.ts). Dades fictícies.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAdjustment, classifyLegacy, discountKeys, latestPerProduct, selectableForNew, toCrmOffer } from "@/comparator/catalog";
import { buildSnapshot } from "@/comparator/snapshot";
import { renderComparisonPdf } from "@/comparator/pdf";
import { emptySheet, type OfferVersion, type SupplyInput } from "@/comparator/types";
import type { Offer } from "@/core/types";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase>; role: string } = { sb: fakeSupabase(), role: "admin" };
vi.mock("@/server/supabase", async () => {
  const { HttpError } = await import("@/server/http-error");
  const handler = (fn: (r: Request) => Promise<unknown>) => async (r: Request) => {
    try { return Response.json(await fn(r)); } catch (e) { return Response.json({ error: (e as Error).message }, { status: e instanceof HttpError ? e.status : 500 }); }
  };
  return { adminClient: () => state.sb, HttpError, handler };
});
vi.mock("@/server/permissions", async () => {
  const { HttpError } = await import("@/server/http-error");
  return {
    requireInternal: async (o?: { staff?: boolean }) => {
      if (o?.staff && !["admin", "cap_administrativa", "administrativa"].includes(state.role)) throw new HttpError(403, "Només l'equip d'administració");
      return { sb: state.sb, user: { id: "u1" }, profile: { id: "u1", name: "Prova", role: state.role } };
    },
    secLog: async () => undefined,
  };
});

const TODAY = new Date().toISOString().slice(0, 10);
const NEXT_YEAR = `${Number(TODAY.slice(0, 4)) + 1}-12-31`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = (n: number, e: number[], p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...emptySheet(), id: uuid(n), supplierId: "s", supplierName: `Comercialitzadora ${n}`, productId: `prod-${n}`, productName: `Tarifa ${n}`, version: 1, energyType: "luz", accessTariff: "2.0TD", segments: ["residencial", "pyme"],
  energy: [...e, null, null, null], power: [0.1, 0.05, null, null, null, null], permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12,
  eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: NEXT_YEAR, source: "Prova", publishedAt: null, status: "activa", conditions: null, origin: "manual", ...p,
});
const supply: SupplyInput = { energyType: "luz", accessTariff: "2.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: [1000, 800, 1200, null, null, null], kwhTotal: 3000, kw: [4.6, 4.6, null, null, null, null], meterRentEurMonth: null, residentialLowPower: false };
const row = (o: OfferVersion) => ({ id: o.id, product_id: o.productId, version: o.version, status: o.status, origin: o.origin, data: o, used_at: null, created_at: `2026-0${o.version}-01T00:00:00Z`, created_by_name: "Prova" });
const legacy = (id: string, p: Partial<Offer> = {}): Offer => ({ id, comercializadora: "Antiga SA", nombre: `Oferta ${id}`, tarifa: "2.0TD", energia: [0.2, 0.15, 0.1], potencia: [0.1, 0.05], cuotaFijaMes: null, validaHasta: "9999-12-31", verificada: true, ventajas: [], tipo: "luz", ...p });

const A = offer(1, [0.2, 0.15, 0.1]), B = offer(2, [0.19, 0.14, 0.09]), C = offer(3, [0.21, 0.16, 0.11]);
const EXPIRED = offer(4, [0.1, 0.1, 0.1], { validTo: "2024-12-31", status: "caducada" });
beforeEach(() => {
  state.role = "admin";
  state.sb = fakeSupabase({ tariff_versions: [A, B, C, EXPIRED].map(row), offers: [{ data: legacy("of-1") }, { data: legacy("of-2", { comercializadora: "Comercialitzadora 1", nombre: "Tarifa 1" }) }], comparisons: [], retailers: [] });
});
const api = async (method: "GET" | "POST", body?: unknown, qs = "") => {
  const { GET, POST } = await import("../app/api/tariffs/route");
  const r = method === "GET" ? await GET(new Request(`http://x/api/tariffs${qs}`)) : await POST(new Request("http://x/api/tariffs", { method: "POST", body: JSON.stringify(body) }));
  return { status: r.status, j: await r.json() };
};

describe("1–2 · una sola font i cap duplicat", () => {
  it("el catàleg no barreja les ofertes antigues de «Propostes»", async () => {
    const { listCatalog } = await import("@/server/tariffs");
    const r = await listCatalog({ sb: state.sb } as never);
    expect(r.versions.map((v) => v.id).sort()).toEqual([A, B, C, EXPIRED].map((o) => o.id).sort());
    expect(r.crm).toEqual([]);
    expect(r.versions.some((v) => v.origin === "crm" || v.id.startsWith("crm:"))).toBe(false);
  });
  it("cada tarifa surt una vegada: la versió activa encara que n'hi hagi un esborrany posterior", () => {
    const v1 = offer(10, [0.2, 0.1, 0.1], { productId: "P", version: 1, status: "arxivada" });
    const v2 = offer(11, [0.2, 0.1, 0.1], { productId: "P", version: 2, status: "activa" });
    const v3 = offer(12, [0.2, 0.1, 0.1], { productId: "P", version: 3, status: "esborrany" });
    expect(latestPerProduct([v1, v3, v2]).map((v) => v.id)).toEqual([v2.id]);
    expect(latestPerProduct([v1, v3]).map((v) => v.id)).toEqual([v3.id]);
  });
});

describe("3–5 · selecció per a comparatives noves", () => {
  it("activa, vigent i completa: seleccionable; caducada, arxivada, esborrany o antiga: no", () => {
    expect(selectableForNew(A, TODAY).ok).toBe(true);
    expect(selectableForNew(EXPIRED, TODAY).reasons.join(" ")).toMatch(/caducada/i);
    expect(selectableForNew({ ...A, status: "arxivada" }, TODAY).ok).toBe(false);
    expect(selectableForNew({ ...A, status: "esborrany" }, TODAY).ok).toBe(false);
    expect(selectableForNew({ ...A, energy: [null, null, null, null, null, null] }, TODAY).ok).toBe(false);
    expect(selectableForNew({ ...A, id: "crm:of-1", origin: "crm" }, TODAY).reasons[0]).toMatch(/Propostes/);
    expect(selectableForNew({ ...A, id: "crm:of-1", origin: "crm" }, TODAY, { demo: true }).ok).toBe(true); // només en mode demostració
  });
  const save = async (offers: OfferVersion[], extra: Record<string, unknown> = {}) => {
    const { saveComparison } = await import("@/server/comparisons");
    return saveComparison({ sb: state.sb, user: { id: "u1" }, profile: { name: "Prova", role: "admin" } } as never, { mode: "manual", supply, current: null, offers, ...extra });
  };
  it("es poden triar 3 tarifes vigents i els preus són SEMPRE els del catàleg (no els del navegador)", async () => {
    const tampered = { ...A, energy: [0.001, 0.001, 0.001, null, null, null] };
    const r = await save([tampered, B, C]);
    const s = r.snapshot;
    expect(s.offers).toHaveLength(3);
    expect(s.offers[0].energy.slice(0, 3)).toEqual([0.2, 0.15, 0.1]);
    expect(s.catalogRefs).toEqual([A, B, C].map((o) => ({ id: o.id, productId: o.productId, version: 1, supplierName: o.supplierName, productName: o.productName })));
  });
  it("una tarifa caducada o una oferta antiga no es poden fer servir en una comparativa nova", async () => {
    await expect(save([EXPIRED])).rejects.toThrow(/no es pot proposar.*Caducada/);
    await expect(save([{ ...A, id: "crm:of-1", origin: "crm" }])).rejects.toThrow(/no és una tarifa del catàleg/);
  });
  it("9 · una comparativa històrica amb una oferta antiga es continua podent desar (còpia congelada)", async () => {
    const old = { ...A, id: "crm:of-1", origin: "crm" as const, supplierName: "Antiga SA" };
    state.sb.db.comparisons.push({ id: uuid(99), status: "esborrany", snapshot: buildSnapshot({ mode: "manual", supply, current: null, offers: [old] }) });
    const r = await save([old], { id: uuid(99) });
    expect(r.snapshot.offers[0].supplierName).toBe("Antiga SA");
  });
});

describe("6–7 · descomptes i SAS", () => {
  const D = offer(20, [0.2, 0.2, 0.2], { discounts: [{ concept: "Descompte benvinguda", pct: 30, eurYear: null, base: "energia" }] });
  it("el descompte del 30 % sobre energia s'aplica una vegada i es pot desactivar només en aquesta comparativa", () => {
    const on = buildSnapshot({ mode: "manual", supply, current: null, offers: [D] }, TODAY).result.evaluations[0].cost;
    const offSnap = buildSnapshot({ mode: "manual", supply, current: null, offers: [D], adjustments: { [D.id]: { discountsOff: [0] } } }, TODAY);
    const off = offSnap.result.evaluations[0].cost;
    expect(on.discounts).toBeCloseTo(off.energy * 0.3, 1); // 30 % de l'energia, no del total
    expect(off.discounts).toBe(0);
    expect(off.total).toBeGreaterThan(on.total);
    expect(D.discounts).toHaveLength(1); // la tarifa original no canvia
    expect(offSnap.baseOffers?.[0].discounts).toHaveLength(1);
    expect(discountKeys(D).map((k) => k.key)).toEqual([0]);
  });
  it("el SAS inclòs al preu no s'afegeix mai de nou; si no hi és, es pot afegir amb valor", () => {
    const inc = offer(21, [0.2, 0.2, 0.2], { sas: { mode: "inclos", eurKwh: null } });
    expect(applyAdjustment(inc, { sas: { enabled: true, eurKwh: 0.02, justification: "x" } }).sas.mode).toBe("inclos");
    const c1 = buildSnapshot({ mode: "manual", supply, current: null, offers: [inc], adjustments: { [inc.id]: { sas: { enabled: true, eurKwh: 0.02, justification: "x" } } } }, TODAY).result.evaluations[0].cost;
    expect(c1.sas).toBe(0);
    const exc = offer(22, [0.2, 0.2, 0.2], { sas: { mode: "exclos", eurKwh: null } });
    const c2 = buildSnapshot({ mode: "manual", supply, current: null, offers: [exc], adjustments: { [exc.id]: { sas: { enabled: true, eurKwh: 0.01, justification: "Previsió REE" } } } }, TODAY).result.evaluations[0].cost;
    expect(c2.sas).toBeCloseTo(30, 2); // 3.000 kWh × 0,01
  });
  it("el servidor exigeix valor i justificació per afegir el SAS", async () => {
    const { saveComparison } = await import("@/server/comparisons");
    await expect(saveComparison({ sb: state.sb, user: { id: "u1" }, profile: { name: "Prova", role: "admin" } } as never, { mode: "manual", supply, current: null, offers: [A], adjustments: { [A.id]: { sas: { enabled: true, eurKwh: null, justification: "" } } } })).rejects.toThrow(/justificar/);
  });
});

describe("8 · el PDF surt del mateix resultat que la pantalla", () => {
  it("mateixos totals a la pantalla (càlcul local) i al snapshot desat; el PDF es genera amb la versió del catàleg", async () => {
    const adj = { [A.id]: { discountsOff: [] } };
    const screen = buildSnapshot({ mode: "manual", supply, current: null, offers: [A, B, C], adjustments: adj }, TODAY);
    const { saveComparison } = await import("@/server/comparisons");
    const saved = (await saveComparison({ sb: state.sb, user: { id: "u1" }, profile: { name: "Prova", role: "admin" } } as never, { mode: "manual", supply, current: null, offers: [A, B, C], adjustments: adj })).snapshot;
    expect(saved.result.evaluations.map((e: { cost: { total: number } }) => e.cost.total)).toEqual(screen.result.evaluations.map((e) => e.cost.total));
    const pdf = renderComparisonPdf(saved, { kind: "detallada", lang: "ca", recommendation: null, company: { nombre: "Assessoria 3.0", telefono: "", email: "", web: "", direccion: "" }, salesperson: null });
    expect(pdf.bytes.byteLength).toBeGreaterThan(2000);
  });
});

describe("12 · renovacions: les ofertes surten del catàleg", () => {
  it("la versió del catàleg es converteix al format de renovacions amb els preus finals (descompte aplicat una vegada)", () => {
    const D = offer(30, [0.2, 0.2, 0.2], { discounts: [{ concept: "Benvinguda", pct: 10, eurYear: null, base: "energia" }], powerUnit: "eur_kw_any", power: [36.5, 18.25, null, null, null, null] });
    const o = toCrmOffer(D, TODAY);
    expect(o.id).toBe(D.id);
    expect(o.energia).toEqual([0.18, 0.18, 0.18]);
    expect(o.potencia[0]).toBeCloseTo(0.1, 6); // €/kW·any → €/kW·dia
    expect(o.verificada).toBe(true);
    expect(toCrmOffer(EXPIRED, TODAY).verificada).toBe(false); // caducada: no es proposa
    expect(o.nombre).toContain("(v1)");
  });
});

describe("Migració de «Propostes»", () => {
  it("classifica les ofertes antigues sense modificar res", () => {
    const rows = classifyLegacy([
      legacy("ja", { comercializadora: "Comercialitzadora 1", nombre: "Tarifa 1" }), legacy("nova"), legacy("dup", { nombre: "Oferta nova" }), legacy("vella", { nombre: "Vella", validaHasta: "2020-01-01" }), legacy("buida", { nombre: "Buida", energia: [null, null, null] }),
    ], [A], { nova: 3 }, TODAY);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.ja.cls).toBe("ja_al_cataleg");
    expect(by.nova).toMatchObject({ cls: "vigent", importable: true, usedInHistory: 3 });
    expect(by.dup.cls).toBe("duplicada");
    expect(by.vella.cls).toBe("caducada");
    expect(by.buida.cls).toBe("incompleta");
  });
  it("informe i incorporació: només les vàlides que no existeixen; mai sobreescriu ni activa caducades", async () => {
    const rep = await api("GET", undefined, "?r=legacy");
    expect(rep.j.counts).toMatchObject({ vigent: 1, ja_al_cataleg: 1 });
    const before = state.sb.db.tariff_versions.length;
    const r = await api("POST", { action: "import_legacy", ids: ["of-1", "of-2"] });
    expect(r.j.imported.map((x: { id: string }) => x.id)).toEqual(["of-1"]);
    expect(r.j.skipped[0]).toMatchObject({ id: "of-2", reason: "Ja existeix al catàleg" });
    expect(state.sb.db.tariff_versions.length).toBe(before + 1);
    const created = state.sb.db.tariff_versions.at(-1)!;
    expect((created.data as OfferVersion).source).toMatch(/Migrat de l'antic apartat/);
    expect(state.sb.db.tariff_versions.find((x) => x.id === A.id)!.data).toEqual(A); // la tarifa existent no es toca
    expect(state.sb.db.offers).toHaveLength(2); // no s'esborra res
  });
  it("14 · permisos: només l'equip d'administració veu l'informe i incorpora ofertes", async () => {
    state.role = "comercial";
    expect((await api("GET", undefined, "?r=legacy")).status).toBe(403);
    expect((await api("POST", { action: "import_legacy", ids: ["of-1"] })).status).toBe(403);
    expect((await api("GET")).status).toBe(200); // consultar el catàleg sí
  });
});

describe("13 · cap funcionalitat duplicada", () => {
  it("l'antic gestor d'ofertes ja no existeix ni surt al menú", async () => {
    expect(fs.existsSync(path.join(__dirname, "../src/ui/views/Ofertas.tsx"))).toBe(false);
    const { NAV } = await import("@/ui/components/nav");
    expect(JSON.stringify(NAV)).not.toMatch(/"propuestas"/);
    const src = fs.readFileSync(path.join(__dirname, "../src/data/store.ts"), "utf8");
    expect(src).not.toMatch(/saveOffer|deleteOffer/);
    const repo = fs.readFileSync(path.join(__dirname, "../src/data/supabaseRepo.ts"), "utf8");
    expect(repo).not.toMatch(/from\("offers"\)/);
  });
});
