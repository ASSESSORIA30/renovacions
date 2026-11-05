/**
 * Proves de la fusió Renewal Intelligence Pro + Energy Intelligence Pro.
 * Cobreixen el model de dades compartit, la normalització de CUPS, la navegació interna
 * i la integració de les dades SIPS al càlcul d'ofertes.
 */
import { describe, expect, it } from "vitest";
import { entitiesToRows } from "@/energy/lib/sips-engine";
import { availabilityOf, cacheRowFromRecord, cupsBase, emptyRow, isFresh, legacyRow, recordFromRow, supplyFromRecord } from "@/energy/lib/sips-record";
import { consumptionSource, hasSipsCups, isElectricCups, isValidCups, normalizedCups } from "@/core/sips";
import { supplyAlerts } from "@/energy/lib/alerts";
import { isGasSupply } from "@/energy/lib/sips-record";
import { resolveHref, hrefFor } from "@/energy/compat/routes";
import { compare } from "@/core/compare";
import { DEFAULT_SETTINGS } from "@/data/defaults";
import type { Offer } from "@/core/types";

const MONTHS = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`EActivaMes${String(i + 1).padStart(2, "0")}`, 1000 + i]));
const MAX = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`PotenciaMes${String(i + 1).padStart(2, "0")}`, i < 6 ? 12 + i : null]));
const ENTITY = {
  TipoEnergia: 1,
  CUPS: "ES0021000000000001RK0F",
  Direccion: "C/ MAJOR 15",
  CodigoPostal: "25001",
  IdLocalidadNombreLocalidad: "Lleida",
  IdDistribuidoraNombreDistribuidora: "E-DISTRIBUCIÓN",
  IdComercializadoraNombreComercializadora: "COMERCIALITZADORA X",
  IdTarifaNombreTarifa: "3.0TD",
  PotenciaContratadaP1: 20,
  PotenciaContratadaP2: 20,
  PotenciaContratadaP3: 25,
  EActivaAnual: 12_066,
  PotenciaAnual: 17,
  ...MONTHS,
  ...MAX,
};

describe("CUPS: normalització i variants de 20/22 caràcters", () => {
  it("majúscules, espais, guions i sufix opcional", () => {
    expect(normalizedCups(" es0021-0000.0000 0001rk0f")).toBe("ES0021000000000001RK");
    expect(normalizedCups("ES0021000000000001RK")).toBe("ES0021000000000001RK");
    expect(cupsBase("es0021000000000001rk1p")).toBe("ES0021000000000001RK");
    expect(isElectricCups("ES0021000000000001RK0F")).toBe(true);
    expect(isElectricCups("ES0021000000000001RK")).toBe(true);
    expect(isElectricCups("ES00210000")).toBe(false);
    expect(isElectricCups(null)).toBe(false);
  });
});

describe("Model unificat · sips_cache", () => {
  const rows = entitiesToRows([ENTITY]);
  const record = recordFromRow(rows[0], rows[1]);
  const row = cacheRowFromRecord("ES0021000000000001RK", record, { source: "sips", sourceDetail: "test", consultedAt: "2026-10-01T10:00:00Z" });

  it("desa la base de 20 caràcters com a clau i el CUPS retornat complet", () => {
    expect(row.cups).toBe("ES0021000000000001RK");
    expect(row.returned_cups).toBe("ES0021000000000001RK0F");
    expect(row.status).toBe("found");
  });
  it("camps estructurats: consum, potències, mensuals i màximes", () => {
    expect(row.annual_kwh).toBe(12_066);
    expect(row.tariff).toBe("3.0TD");
    expect(row.contracted_power_kw).toEqual([20, 20, 25, null, null, null]);
    expect(row.monthly_kwh).toHaveLength(12);
    expect(row.monthly_kwh[11]).toBe(1011);
    expect(row.monthly_max_kw.slice(6)).toEqual([null, null, null, null, null, null]);
    expect(row.max_power_year_kw).toBe(17);
    expect(row.distributor).toBe("E-DISTRIBUCIÓN");
    expect(row.postal_code).toBe("25001");
  });
  it("zero no és el mateix que dada absent", () => {
    const r = recordFromRow(rows[0], rows[1]);
    r["E.A. Enero (kWh)"] = 0;
    r["E.A. Febrero (kWh)"] = null;
    const x = cacheRowFromRecord("ES0021000000000001RK", r, { source: "sips", sourceDetail: "t" });
    expect(x.monthly_kwh[0]).toBe(0);
    expect(x.monthly_kwh[1]).toBeNull();
    expect(x.data_availability!.monthsKwh).toBe(11);
  });
  it("disponibilitat de dades", () => {
    expect(row.data_availability).toMatchObject({ level: "completa", monthsKwh: 12, monthsMaxKw: 6, powers: 3, annualKwh: true });
    const s = supplyFromRecord({ CUPS: "ES0021000000000001RK0F", "E.A. Anual (kWh)": 5000 }, { file: "t" })!;
    expect(availabilityOf(s).level).toBe("minima");
  });
  it("el registre raw torna a la mateixa fitxa (97 columnes)", () => {
    expect(Object.keys(row.raw!)).toHaveLength(97);
    const s = supplyFromRecord(row.raw!, { file: "sips_cache", origin: "crm" })!;
    expect(s.cups).toBe("ES0021000000000001RK0F");
    expect(s.eaAnual).toBe(12_066);
    expect(s.source.origin).toBe("crm");
  });
  it("resultat no trobat / error sense dades inventades", () => {
    const e = emptyRow("ES0021000000000001RK0F", "error", "timeout", "2026-10-01T00:00:00Z", { source: "sips", sourceDetail: "t" });
    expect(e.cups).toBe("ES0021000000000001RK");
    expect(e.annual_kwh).toBeNull();
    expect(e.monthly_kwh.every((x) => x === null)).toBe(true);
    expect(legacyRow(e)).toEqual({ cups: e.cups, returned_cups: null, annual_kwh: null, tariff: null, address: null, status: "error", error: "timeout", consulted_at: e.consulted_at });
  });
  it("TTL configurable: dades vigents 7 dies, errors 24 h", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    expect(isFresh("2026-10-05T00:00:00Z", "found", 7, 24, now)).toBe(true);
    expect(isFresh("2026-10-01T00:00:00Z", "found", 7, 24, now)).toBe(false);
    expect(isFresh("2026-10-09T12:00:00Z", "error", 7, 24, now)).toBe(true);
    expect(isFresh("2026-10-08T00:00:00Z", "error", 7, 24, now)).toBe(false);
    expect(isFresh(null, "found", 7, 24, now)).toBe(false);
  });
});

describe("Font del consum a les targetes del Kanban", () => {
  const sips = { cups: "X", returned_cups: null, annual_kwh: 9000, tariff: "2.0TD", address: null, status: "found" as const, consulted_at: "2026-01-01" };
  it("CRM i manual tenen prioritat sobre SIPS; SIPS omple el buit", () => {
    expect(consumptionSource(5000, false, sips)).toEqual({ kwh: 5000, source: "crm" });
    expect(consumptionSource(5000, true, sips)).toEqual({ kwh: 5000, source: "manual" });
    expect(consumptionSource(null, false, sips)).toEqual({ kwh: 9000, source: "sips" });
    expect(consumptionSource(null, false, { ...sips, status: "error" })).toEqual({ kwh: null, source: null });
  });
});

describe("Navegació interna (sense iframes ni altres aplicacions)", () => {
  it("les rutes de cups2 es resolen a vistes de la plataforma", () => {
    expect(resolveHref("/suministro/?cups=ES0021000000000001RK0F")).toEqual({ view: "fitxa", params: { cups: "ES0021000000000001RK0F" } });
    expect(resolveHref("/radar")).toEqual({ view: "radar", params: {} });
    expect(resolveHref("/alertas")).toEqual({ view: "alertes", params: {} });
    expect(resolveHref("/mercado")).toEqual({ view: "mercat", params: {} });
    expect(resolveHref("/")).toEqual({ view: "energia", params: {} });
    expect(resolveHref("/ajustes/")).toEqual({ view: "ajustes", params: { tab: "energia" } });
    expect(hrefFor("fitxa", { cups: "ES1" })).toBe("/?v=fitxa&cups=ES1");
  });
});

describe("Generador d'ofertes · mecanisme d'ajust i regressió", () => {
  const offer: Offer = { id: "o", comercializadora: "X", nombre: "Fix", tarifa: "2.0TD", energia: [0.2, 0.15, 0.1], potencia: [0.1, 0.05], validaHasta: "2099-01-01", verificada: true };
  const base = { tarifa: "2.0TD", kwhPorPeriodo: [1000, 1000, 2000], kwPorPeriodo: [4.6, 4.6], actual: { energia: [0.25, 0.2, 0.15], potencia: [0.12, 0.06] }, propuesta: offer, settings: { ...DEFAULT_SETTINGS, iee: 0, iva: 0, alquilerContadorMes: 0 } };
  it("sense ajust el resultat no canvia (regressió)", () => {
    const r = compare(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.actual.ajuste).toBe(0);
      expect(r.actual.energia).toBeCloseTo(250 + 200 + 300, 6);
      expect(r.ahorro).toBeGreaterThan(0);
    }
  });
  it("amb ajust inclòs s'aplica al consum total i exigeix els dos valors", () => {
    const miss = compare({ ...base, ajuste: { incluir: true, actual: 0.02, propuesta: null } });
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.faltan.join()).toMatch(/ajust/);
    const r = compare({ ...base, ajuste: { incluir: true, actual: 0.02, propuesta: 0 } });
    const r0 = compare(base);
    expect(r.ok && r0.ok).toBe(true);
    if (r.ok && r0.ok) {
      expect(r.actual.ajuste).toBeCloseTo(80, 6);
      expect(r.nuevo.ajuste).toBe(0);
      expect(r.ahorro - r0.ahorro).toBeCloseTo(80, 6);
      expect(r.hipotesis.join(" ")).toMatch(/Mecanisme d'ajust inclòs/);
    }
  });
  it("sense consum per períodes no calcula (no s'inventen repartiments)", () => {
    const r = compare({ ...base, kwhPorPeriodo: [null, null, null] });
    expect(r.ok).toBe(false);
  });
});

describe("Gas a la plataforma", () => {
  const GAS = { TipoEnergia: 2, CUPS: "ES0217010000000001AB0F", IdTarifaNombreTarifa: "RL.2", IdDistribuidoraNombreDistribuidora: "NEDGIA", EActivaAnual: 9500, ...MONTHS };
  const rows = entitiesToRows([GAS]);
  const row = cacheRowFromRecord("ES0217010000000001AB", recordFromRow(rows[0], rows[1]), { source: "sips", sourceDetail: "t" });
  it("els CUPS de gas són vàlids i consultables des dels contractes de gas", () => {
    expect(isValidCups("es0217010000000001ab")).toBe(true);
    expect(isElectricCups("ES0217010000000001AB0F")).toBe(true); // nom antic, mateix format
    expect(hasSipsCups({ tipo: "gas", cups: "ES0217010000000001AB" })).toBe(true);
    expect(hasSipsCups({ tipo: "telefonia", cups: "ES0217010000000001AB" })).toBe(false);
  });
  it("sips_cache guarda el tipus i la disponibilitat no exigeix potències", () => {
    expect(row.energy_type).toBe("gas");
    expect(row.tariff).toBe("RL.2");
    expect(row.annual_kwh).toBe(9500);
    expect(row.data_availability?.level).toBe("completa");
  });
  it("no es generen alertes elèctriques falses per al gas", () => {
    const s = supplyFromRecord(row.raw!, { file: "t" })!;
    expect(isGasSupply(s)).toBe(true);
    const rules = supplyAlerts(s).map((a) => a.rule);
    expect(rules).not.toContain("tarifa");
    expect(rules).not.toContain("pot-incompleta");
    expect(rules.filter((r) => r === "campos")).toHaveLength(0);
  });
});

