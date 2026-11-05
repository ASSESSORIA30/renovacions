/**
 * FASE 2 · Correcció del motor energètic: desglossament de l'energia, excedents fotovoltaics i permanència.
 * Totes les dades són fictícies (cap titular, NIF, CUPS ni preu real d'un client).
 */
import { describe, expect, it, vi } from "vitest";
import { parseEnergyComponents, reconstructEnergyPrices } from "@/comparator/energy-breakdown";
import { extractFromText, invoiceSurplus, recomputeBreakdown } from "@/comparator/invoice";
import { computeCost } from "@/comparator/engine";
import { buildSnapshot } from "@/comparator/snapshot";
import { surplusView } from "@/comparator/surplus-view";
import { renderComparisonPdf } from "@/comparator/pdf";
import { checkVersion, applyAdjustment } from "@/comparator/catalog";
import { permanenceIssues, permanenceLabel, snapshotPermanenceLabel } from "@/comparator/permanence";
import { autoMap, previewImport } from "@/comparator/tariff-import";
import { aiTariffsToVersions } from "@/comparator/tariff-ai";
import { detectSurplusKeywords, permanenceFromImport, surplusFromImport } from "@/comparator/surplus-detect";
import { emptySheet, emptySurplus, type OfferVersion, type SupplyInput, type SurplusConfig } from "@/comparator/types";

vi.mock("server-only", () => ({}));

const TODAY = new Date().toISOString().slice(0, 10);
const NEXT = `${Number(TODAY.slice(0, 4)) + 1}-12-31`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = (n: number, p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...emptySheet(), id: uuid(n), supplierId: "s", supplierName: `Comercialitzadora ${n}`, productId: `prod-${n}`, productName: `Tarifa ${n}`, version: 1,
  energyType: "luz", accessTariff: "2.0TD", segments: ["residencial", "pyme"], contractType: "periodes",
  energy: [0.2, 0.15, 0.1, null, null, null], power: [0.1, 0.05, null, null, null, null], permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12,
  eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: NEXT, source: "Prova", publishedAt: null, status: "activa", conditions: null, origin: "manual", ...p,
});
const supply = (p: Partial<SupplyInput> = {}): SupplyInput => ({ energyType: "luz", accessTariff: "2.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: [1000, 800, 1200, null, null, null], kwhTotal: 3000, kw: [4.6, 4.6, null, null, null, null], meterRentEurMonth: null, residentialLowPower: false, ...p });
const withSurplus = (kwh: number, p: Partial<NonNullable<SupplyInput["surplus"]>> = {}) => supply({ surplus: { kwhTotal: kwh, monthly: null, byPeriod: null, currentCompensationEur: null, currentMode: null, battery: false, batteryBalanceEur: null, estimated: false, ...p } });
const sur = (mode: SurplusConfig["mode"], p: Partial<SurplusConfig> = {}): SurplusConfig => ({ ...emptySurplus(mode), ...p });

/** Factura fictícia 3.0TD amb el format de Nufri: ATR i energia lliure per separat. */
const NUFRI_ATR = [
  "Energia Nufri - Factura de electricidad (FICTÍCIA)",
  "Peaje de acceso: 3.0TD",
  "Término Energía ATR",
  "P3: 1.289 kWh × 0,019279 €/kWh = 24,85 €",
  "P4: 2.100 kWh × 0,009795 €/kWh = 20,57 €",
  "P6: 3.050 kWh × 0,002898 €/kWh = 8,84 €",
  "Energía libre",
  "P3: 1.289 kWh × 0,214655 €/kWh = 276,69 €",
  "P4: 2.100 kWh × 0,197042 €/kWh = 413,79 €",
  "P6: 3.050 kWh × 0,231655 €/kWh = 706,55 €",
  "Término de potencia",
  "P1 15,000 kW × 30 días × 0,067890 €/kW día 30,55 €",
].join("\n");

describe("1–3 · energia ATR + lliure (Nufri, fictícia)", () => {
  const comps = parseEnergyComponents([NUFRI_ATR]);
  const br = reconstructEnergyPrices(comps);
  const by = (p: number) => br.find((b) => b.period === p)!;
  it("1 · llegeix l'ATR i l'energia lliure de cada període, amb els kWh de milers ben interpretats", () => {
    expect(comps.filter((c) => c.concept === "atr").map((c) => c.period)).toEqual([3, 4, 6]);
    expect(comps.filter((c) => c.concept === "lliure").map((c) => c.period)).toEqual([3, 4, 6]);
    expect(comps.find((c) => c.period === 3)!.kwh).toBe(1289);
    expect(comps.every((c) => c.original && c.original.unitPrice === c.unitPrice)).toBe(true); // valors originals conservats
  });
  it("2 · P3 = 0,019279 + 0,214655 = 0,233934 · P4 = 0,206837 · P6 = 0,234553", () => {
    expect([by(3).total, by(4).total, by(6).total]).toEqual([0.233934, 0.206837, 0.234553]);
    expect(br.every((b) => b.status === "reconstruit")).toBe(true);
    // el lector de factures aplica el total al preu del contracte actual i marca «confirmar»
    const d = extractFromText([NUFRI_ATR]);
    expect(d.energyPrice[2].value).toBe(0.233934);
    expect(d.energyPrice[2].confirm).toBe(true);
    expect(d.kwh[2].value).toBe(1289);
    expect(d.energyBreakdown).toHaveLength(3);
  });
  it("3 · no es compta l'ATR dues vegades: si el detall de peatges i càrrecs no quadra amb l'ATR, queda pendent", () => {
    const dup = parseEnergyComponents([`${NUFRI_ATR}\nPeajes\nP3: 1.289 kWh × 0,015000 €/kWh = 19,34 €\nCargos\nP3: 1.289 kWh × 0,004279 €/kWh = 5,52 €`]);
    expect(reconstructEnergyPrices(dup).find((b) => b.period === 3)!.total).toBe(0.233934); // peatges + càrrecs = ATR → no se sumen
    const bad = parseEnergyComponents([`${NUFRI_ATR}\nPeajes\nP3: 1.289 kWh × 0,030000 €/kWh = 38,67 €`]);
    const p3 = reconstructEnergyPrices(bad).find((b) => b.period === 3)!;
    expect([p3.status, p3.total]).toEqual(["pendent", null]);
    expect(p3.note).toMatch(/doble comptabilització/);
  });
  it("un import en € no es confon amb un preu en €/kWh, i la correcció manual recalcula el total sense perdre l'original", () => {
    const onlyEur = reconstructEnergyPrices(parseEnergyComponents(["Energía libre\nP2 Energía libre 250,00 €"]));
    expect(onlyEur[0].status).toBe("pendent"); // sense consum no es pot convertir l'import en preu
    const d = extractFromText([NUFRI_ATR]);
    const comps2 = d.energyComponents!.map((c) => (c.period === 3 && c.concept === "lliure" ? { ...c, unitPrice: 0.2, method: "manual" as const } : c));
    const r = recomputeBreakdown(d, comps2);
    expect(r.prices[2]).toBe(0.219279);
    expect(comps2.find((c) => c.period === 3 && c.concept === "lliure")!.original!.unitPrice).toBe(0.214655);
  });
});

describe("4–5 · factura indexada i ajustos independents", () => {
  it("4 · factura indexada amb un sol terme d'energia per període: preu directe, sense inventar components", () => {
    const br = reconstructEnergyPrices(parseEnergyComponents(["Término de energía\nP1: 500 kWh × 0,145210 €/kWh = 72,61 €\nP2: 400 kWh × 0,121000 €/kWh = 48,40 €"]));
    expect(br.map((b) => [b.status, b.total])).toEqual([["directe", 0.14521], ["directe", 0.121]]);
  });
  it("4b · total i components alhora: només s'accepta si quadren", () => {
    const ok = reconstructEnergyPrices(parseEnergyComponents([`${NUFRI_ATR}\nTérmino de energía\nP3: 1.289 kWh × 0,233934 €/kWh = 301,54 €`]));
    expect(ok.find((b) => b.period === 3)!.total).toBe(0.233934);
    const ko = reconstructEnergyPrices(parseEnergyComponents([`${NUFRI_ATR}\nTérmino de energía\nP3: 1.289 kWh × 0,250000 €/kWh = 322,25 €`]));
    expect(ko.find((b) => b.period === 3)!.status).toBe("pendent");
  });
  it("5 · descomptes i ajustos de la comparativa no toquen els excedents (i a l'inrevés)", () => {
    const o = offer(5, { discounts: [{ concept: "Benvinguda", pct: 10, eurYear: null, base: "energia" }], surplus: sur("fix", { eurKwh: 0.05 }) });
    const s = withSurplus(1000);
    const on = computeCost(o, s);
    const off = computeCost(applyAdjustment(o, { discountsOff: [0] }), s);
    expect(on.surplus!.compensationEur).toBe(50);
    expect(off.surplus!.compensationEur).toBe(50);
    expect(on.discounts).toBeGreaterThan(0);
    expect(off.discounts).toBe(0);
  });
});

describe("6 · importació de tarifes amb excedents", () => {
  it("Excel: detecta les columnes d'excedents i de permanència; sense columnes → «no informada»", () => {
    const head = ["Comercializadora", "Producto", "Tarifa acceso", "Tipo precio", "Precio único", "P1 potencia", "P2 potencia", "Permanencia", "Precio excedentes", "Batería virtual"];
    const rows = [head, ["Prova SL", "Solar Fix", "2.0TD", "24h", 0.15, 0.1, 0.05, "12 meses", 0.06, "Sí"], ["Prova SL", "Basic", "2.0TD", "24h", 0.14, 0.1, 0.05, "", "", ""]];
    const m = autoMap(head);
    expect([m.surplusPrice, m.battery, m.permanence]).toEqual(["Precio excedentes", "Batería virtual", "Permanencia"]);
    const r = previewImport(rows, 0, m, { source: "Prova.xlsx", existing: [], today: TODAY });
    const [a, b] = r.rows.map((x) => x.offer!);
    expect(a.surplus).toMatchObject({ mode: "bateria", eurKwh: 0.06, source: "excel" });
    expect(a.surplus!.battery?.enabled).toBe(true);
    expect([a.permanence?.status, a.permanence?.months, a.permanenceMonths]).toEqual(["amb", 12, 12]);
    expect(b.surplus!.mode).toBe("no_informada");
    expect(b.permanence!.status).toBe("no_informada"); // mai 12 mesos per defecte
  });
  it("IA: paraules clau del document i camps d'excedents; sense res → «Compensació no informada»", () => {
    expect(detectSurplusKeywords("Condiciones: Compensación de excedentes y Batería virtual incluidas")).toEqual(["compensacion de excedentes", "bateria virtual"]);
    const raw = {
      supplierName: "Prova SL", docKeywords: ["compensacion de excedentes"],
      offers: [
        { productName: "Solar", accessTariff: "2.0TD", contractType: "fix24h", energy24h: 0.15, power: [0.1, 0.05], powerUnit: "eur_kw_dia", sas: "inclos", surplusMode: "fix", surplusEurKwh: 0.07, permanenceMonths: 12, confidence: "alta" },
        { productName: "Sense dades", accessTariff: "2.0TD", contractType: "fix24h", energy24h: 0.15, power: [0.1, 0.05], powerUnit: "eur_kw_dia", sas: "inclos", confidence: "alta" },
      ],
    };
    const r = aiTariffsToVersions(raw, { fileName: "prova.pdf", existing: [], today: TODAY });
    expect(r.items[0].offer.surplus).toMatchObject({ mode: "fix", eurKwh: 0.07, source: "ia" });
    expect(r.items[0].offer.permanence).toMatchObject({ status: "amb", months: 12 });
    const s2 = r.items[1].offer.surplus!;
    expect(s2.mode).toBe("no_informada");
    expect(s2.notes).toMatch(/esmenta excedents/);
    expect(checkVersion(r.items[1].offer).info).toContain("Compensació d'excedents no informada");
  });
  it("no es confon la compensació simplificada amb la venda i la permanència en text no s'inventa", () => {
    expect(surplusFromImport({ mode: "Batería virtual" }, "excel")).toMatchObject({ mode: "bateria", eurKwh: null });
    expect(surplusFromImport({ mode: "No" }, "excel").mode).toBe("sense");
    expect(permanenceFromImport("Sin permanencia").status).toBe("sense");
    expect(permanenceFromImport("1 año")).toMatchObject({ status: "amb", months: 12 });
    expect(permanenceFromImport("Sí")).toMatchObject({ status: "amb", months: null });
    expect(permanenceFromImport(null).status).toBe("no_informada");
  });
});

describe("7–11 · excedents al comparador", () => {
  const s = withSurplus(1000);
  it("7 · tarifa sense compensació: no redueix el cost i ho diu", () => {
    const c = computeCost(offer(7, { surplus: sur("sense") }), s);
    expect([c.surplus!.status, c.surplus!.compensationEur]).toEqual(["no_compensa", 0]);
  });
  it("7b · compensació no informada: no es calcula (mai zero silenciós) i s'avisa", () => {
    const c = computeCost(offer(71), s);
    expect(c.surplus!.status).toBe("no_informada");
    expect(c.notes.join(" ")).toMatch(/no informada/i);
  });
  it("8 · preu fix: 1.000 kWh × 0,05 €/kWh = 50 € que redueixen el cost net", () => {
    const base = computeCost(offer(8), supply());
    const c = computeCost(offer(8, { surplus: sur("fix", { eurKwh: 0.05 }) }), s);
    expect(c.surplus!.compensationEur).toBe(50);
    expect(c.totalExTax).toBeLessThan(base.totalExTax);
    expect(c.lines.some((l) => l.key === "excedents" && l.amount === -50)).toBe(true);
  });
  it("9 · indexada sense preu de referència: pendent (no quantificada); amb referència, estimada", () => {
    expect(computeCost(offer(9, { surplus: sur("indexat", { formula: "OMIE - 0,01" }) }), s).surplus!.status).toBe("pendent");
    const c = computeCost(offer(91, { surplus: sur("indexat", { eurKwh: 0.04 }) }), s);
    expect([c.surplus!.compensationEur, c.surplus!.estimated]).toEqual([40, true]);
  });
  it("10 · bateria virtual: el sobrant passa al saldo i la quota de gestió s'afegeix al cost", () => {
    const big = withSurplus(10_000);
    const c = computeCost(offer(10, { surplus: sur("bateria", { eurKwh: 0.1, battery: { enabled: true, feeEurMonth: 2, accumulation: null, usage: null, expiry: null } }) }), big);
    expect(c.surplus!.limited).toBe(true);
    expect(c.surplus!.toBatteryEur).toBeGreaterThan(0);
    expect(c.surplus!.lostEur).toBe(0);
    expect(c.surplus!.batteryFeeEur).toBe(24);
    expect(c.surplus!.compensationEur + c.surplus!.toBatteryEur).toBeCloseTo(1000, 2);
  });
  it("11 · límit legal: la compensació simplificada no supera el terme d'energia; sense bateria, el sobrant es perd", () => {
    const c = computeCost(offer(11, { surplus: sur("fix", { eurKwh: 0.1 }) }), withSurplus(10_000));
    expect(c.surplus!.compensationEur).toBeLessThanOrEqual(c.energy);
    expect(c.surplus!.lostEur).toBeGreaterThan(0);
    expect(c.subtotal).toBeGreaterThanOrEqual(0);
    // venda d'excedents: no té el límit de la compensació simplificada
    const v = computeCost(offer(12, { surplus: sur("fix", { eurKwh: 0.1, mechanism: "venda" }) }), withSurplus(10_000));
    expect(v.surplus!.compensationEur).toBe(1000);
  });
  it("per períodes: necessita el repartiment o preus iguals", () => {
    const o = offer(13, { surplus: sur("periodes", { periodEurKwh: [0.06, 0.05, 0.04, null, null, null] }) });
    expect(computeCost(o, s).surplus!.status).toBe("pendent");
    const bp = withSurplus(600, { kwhTotal: null, byPeriod: [100, 200, 300, null, null, null] });
    expect(computeCost(o, bp).surplus!.compensationEur).toBe(28); // 6 + 10 + 12
  });
  it("contracte actual: amb la factura del període s'usa l'import compensat real", () => {
    const cur = { ...emptySheet(), energy: [0.2, 0.15, 0.1, null, null, null], power: [0.1, 0.05, null, null, null, null] };
    const c = computeCost(cur, { ...withSurplus(100, { currentCompensationEur: 6.5 }), basis: "periode_facturat", days: 30 }, undefined, { current: true });
    expect(c.surplus!.compensationEur).toBe(6.5);
  });
  it("la lectura de la factura separa els excedents del consum de xarxa", () => {
    const d = extractFromText(["Consumo P1: 300 kWh\nEnergía excedentaria 210 kWh × 0,060000 €/kWh -12,60 €\nBatería virtual: saldo acumulado 35,20 €"]);
    expect([d.surplusKwh?.value, d.surplusPrice?.value, d.surplusCompensationEur?.value, d.virtualBattery?.value, d.batteryBalanceEur?.value]).toEqual([210, 0.06, 12.6, true, 35.2]);
    const m = invoiceSurplus(d);
    expect(m.surplus).toMatchObject({ kwhTotal: 210, currentCompensationEur: 12.6, battery: true, batteryBalanceEur: 35.2 });
    expect(m.currentSurplus).toMatchObject({ mode: "bateria", eurKwh: 0.06 });
    expect(d.kwh[0].value).toBe(300); // els excedents no se sumen al consum
  });
});

describe("12–14 · permanència", () => {
  const fix30 = offer(30, { accessTariff: "3.0TD", contractType: "periodes" });
  it("12 · tarifa fixa 3.0TD sense permanència: incidència, no es pot activar ni s'escriu «Sense permanència»", () => {
    expect(permanenceIssues(fix30)).toEqual(["Permanència obligatòria pendent de configurar (tarifa fixa 3.0TD/6.1TD)"]);
    expect(permanenceLabel(fix30)).toBe("Permanència obligatòria: pendent de confirmar");
    expect(permanenceLabel(fix30, "es")).toBe("Permanencia obligatoria: pendiente de confirmar");
    expect(permanenceLabel({ ...fix30, permanenceMonths: 12 })).toBe("Permanència: 12 mesos");
    expect(permanenceIssues({ ...fix30, permanenceMonths: 12 })).toEqual([]);
  });
  it("13 · tarifa fixa 6.1TD: «sense» explícit també és incidència tret d'una excepció de Direcció", () => {
    const o = offer(31, { accessTariff: "6.1TD", contractType: "fix24h", energy24h: 0.15, permanence: { status: "sense", months: null, startNote: null, cancellation: null, penalty: null, source: "Contracte", exception: null } });
    expect(permanenceIssues(o)[0]).toMatch(/sense permanència/);
    expect(permanenceIssues({ ...o, permanence: { ...o.permanence!, exception: "Acord Direcció 2026-11" } })).toEqual([]);
    // indexada i 2.0TD: la regla no hi aplica; si consta «sense», es pot dir
    expect(permanenceIssues(offer(32, { accessTariff: "6.1TD", contractType: "indexat" }))).toEqual([]);
    expect(permanenceLabel(offer(33, { permanence: { status: "sense", months: null, startNote: null, cancellation: null, penalty: null, source: null, exception: null } }))).toBe("Sense permanència");
    expect(permanenceLabel(offer(34))).toBe("Permanència: no informada"); // desconeguda ≠ sense
  });
  it("14 · «amb permanència» sense durada: incidència i la regla configurable per Direcció es respecta", () => {
    const o = { ...fix30, permanence: { status: "amb" as const, months: null, startNote: null, cancellation: null, penalty: null, source: null, exception: null } };
    expect(permanenceIssues(o)[0]).toMatch(/sense durada/);
    expect(permanenceIssues(fix30, { enabled: false, tariffs: [], contractTypes: [] })).toEqual([]);
    expect(permanenceIssues(offer(35, { accessTariff: "2.0TD" }), { enabled: true, tariffs: ["2.0TD"], contractTypes: ["periodes"] })).toHaveLength(1);
  });
});

describe("15–17 · pantalla = PDF, versions històriques i no-regressió", () => {
  it("15 · la taula d'excedents de la pantalla i la del PDF surten del mateix càlcul", () => {
    const A = offer(40, { surplus: sur("fix", { eurKwh: 0.05 }) }), B = offer(41, { surplus: sur("sense") });
    const snap = buildSnapshot({ mode: "manual", supply: withSurplus(1000), current: null, offers: [A, B] }, TODAY);
    const v = surplusView(snap, "ca")!;
    expect(v.rows.map((r) => r.label)).toEqual(["Consum kWh", "Cost energia", "Cost potència", "Excedents kWh", "Preu excedents €/kWh", "Compensació", "Bateria virtual", "Cost total net", "Estalvi"]);
    const comp = v.rows.find((r) => r.label === "Compensació")!;
    const iA = v.columns.indexOf(A.supplierName);
    expect(comp.cells[iA]).toMatch(/50,00/);
    expect(surplusView(buildSnapshot({ mode: "manual", supply: supply(), current: null, offers: [A] }, TODAY))).toBeNull(); // sense excedents, no hi ha secció
    const pdf = renderComparisonPdf(snap, { kind: "detallada", lang: "ca", recommendation: null, company: { nombre: "Assessoria 3.0", telefono: "", email: "", web: "", direccion: "" }, salesperson: null });
    expect(pdf.blob.size).toBeGreaterThan(1000);
  });
  it("16 · una proposta emesa amb el motor anterior conserva el text de permanència amb què es va emetre", () => {
    const o = offer(50, { accessTariff: "3.0TD" });
    expect(snapshotPermanenceLabel(o, "1.0.0")).toBe("Sense permanència");
    expect(snapshotPermanenceLabel(o, "1.1.0")).toBe("Permanència obligatòria: pendent de confirmar");
    const snap = buildSnapshot({ mode: "manual", supply: supply(), current: null, offers: [offer(51)] }, TODAY);
    expect(snap.engineVersion).toBe("1.1.0");
  });
  it("17 · sense excedents ni dades noves, el cost és idèntic al d'abans (cap regressió)", () => {
    const o = offer(60);
    const a = computeCost(o, supply());
    const b = computeCost({ ...o, surplus: sur("fix", { eurKwh: 0.05 }) }, supply());
    expect(b.total).toBe(a.total);
    expect(a.surplus).toBeNull();
    expect(a.lines.some((l) => l.key === "excedents" || l.key === "bateria")).toBe(false);
  });
});
