/**
 * Fase 10.1 · Tarifa Open d'Endesa: lectura dels PDF REALS (3.0TD i 6.1TD, versió 07), calendari horari,
 * ponderació P1–P6, regles de Direcció, discrepàncies, xat i comparador. Els PDF són documents públics d'ofertes
 * (sense dades personals).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { pdfText } from "@/server/doc-text";
import { bracketForP6, convertModality, effectiveRules, isEndesaOpen, openToOffers, parseEndesaOpen, type OpenDocument } from "@/comparator/endesa-open";
import {
  DIRECCIO_RULES, countHours, effectiveFromHourly, localHours, parseHourlyCsv, periodOf, holidaySet, weightedPrices, yearReference, type Period,
} from "@/comparator/open-calendar";
import { explainPeriod, localAnswer, parseCorrection, type OpenChatContext } from "@/comparator/open-chat";
import { computeCost, eligibility } from "@/comparator/engine";
import { emptySupply } from "@/ui/views/comparatives/state";
import { offerVersionSchema } from "@/comparator/types";

const load = async (f: string) => parseEndesaOpen((await pdfText(new Uint8Array(readFileSync(`tests/fixtures/endesa/${f}`)))).pages, f);
const Y = yearReference(2027);

describe("1 · extracció dels preus originals (PDF reals)", () => {
  it("3.0TD: trams, preus de les cinc modalitats, No Open, preu base, potència, horaris i vigència", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    expect(d.tariff).toBe("3.0TD");
    expect(d.docVersion).toBe("07 · V1");
    expect([d.validFrom, d.validTo]).toEqual(["2026-10-26", "2026-10-30"]);
    expect(d.brackets.map((b) => b.label)).toEqual(["15-30 kW", "30-50 kW", "50-100 kW", ">100 kW"]);
    expect(d.brackets[0].prices).toEqual({ plana: 0.196239, dia: 0.183659, laboral: 0.17108, cap_de_setmana: 0.120762, nit: 0.095603 });
    expect(d.brackets[0].noOpen).toBe(0.233977);
    expect(d.brackets[3].prices.dia).toBe(0.183294);
    expect(d.brackets[3].noOpen).toBe(0.233512);
    expect(d.brackets.map((b) => b.base)).toEqual([0.251588, 0.251588, 0.251088, 0.251088]);
    expect(d.power).toEqual([21.876927, 12.117621, 5.981534, 5.386333, 4.013851, 2.942287]);
    expect(d.schedules.dia.rule).toEqual({ mode: "horari", windows: [{ days: "tots", from: 8, to: 24 }] });
    expect(d.schedules.nit.rule).toEqual({ mode: "horari", windows: [{ days: "tots", from: 0, to: 8 }] });
    expect(d.schedules.laboral.rule).toEqual({ mode: "horari", windows: [{ days: "laborable", from: 8, to: 24 }] });
    expect(d.schedules.cap_de_setmana.rule).toEqual({ mode: "horari", windows: [{ days: "festiu", from: 0, to: 24 }] });
    // descomptes inclosos (derivats del preu base): 15/20/25/45/55 % + 7 % general
    expect(d.impliedDiscounts).toEqual({ plana: 22, dia: 27, laboral: 32, cap_de_setmana: 52, nit: 62, no_open: 7 });
    expect(d.generalDiscountPct).toBe(7);
    expect(d.warnings).toEqual([]);
  });
  it("6.1TD: trams fins a 450 kW i horaris diferents de Día i Noche", async () => {
    const d = await load("20261030_6.1TD_OPEN_07_V1.pdf");
    expect(d.tariff).toBe("6.1TD");
    expect(d.maxKw).toBe(450);
    expect(d.brackets.map((b) => [b.minKw, b.maxKw])).toEqual([[null, 30], [30, 50], [50, 100], [100, 450]]);
    expect(d.brackets[2].prices).toEqual({ plana: 0.172896, dia: 0.161813, laboral: 0.15073, cap_de_setmana: 0.106398, nit: 0.128564 });
    expect(d.brackets[2].noOpen).toBe(0.206146);
    expect(d.schedules.dia.rule).toEqual({ mode: "horari", windows: [{ days: "laborable", from: 8, to: 24 }, { days: "festiu", from: 18, to: 24 }] });
    expect(d.schedules.nit.rule).toEqual({ mode: "horari", windows: [{ days: "laborable", from: 0, to: 8 }, { days: "festiu", from: 0, to: 18 }] });
    expect(d.impliedDiscounts.nit).toBe(42); // 35 % + 7 %
    expect(d.warnings).toEqual([]);
  });
  it("detecta el document i no el confon amb altres PDF", () => {
    expect(isEndesaOpen("Tarifa Open 3.0TD ... Elige tu Modalidad de Horas Open")).toBe(true);
    expect(isEndesaOpen("Factura de llum · Tarifa Plana")).toBe(false);
  });
});

describe("2 · tram segons la potència contractada P6", () => {
  it("límit inferior exclòs i superior inclòs (P6, no la potència màxima)", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    expect(bracketForP6(d, 30)?.label).toBe("15-30 kW");
    expect(bracketForP6(d, 30.01)?.label).toBe("30-50 kW");
    expect(bracketForP6(d, 100)?.label).toBe("50-100 kW");
    expect(bracketForP6(d, 150)?.label).toBe(">100 kW");
    expect(bracketForP6(d, 10)).toBeNull();
  });
});

describe("7–8 · calendari horari real (2027): hores per període, festius i canvis d'hora", () => {
  it("8.760 h, dies de 23 i 25 hores i festius nacionals de data fixa", () => {
    const c = countHours("3.0TD", DIRECCIO_RULES.dia, Y);
    expect(c.totalHours).toBe(8760);
    expect(c.dstDays).toEqual([{ date: "2027-03-28", hours: 23 }, { date: "2027-10-31", hours: 25 }]);
    expect(c.holidays).toEqual(["2027-01-01", "2027-01-06", "2027-05-01", "2027-08-15", "2027-10-12", "2027-11-01", "2027-12-06", "2027-12-08", "2027-12-25"]);
    expect(c.periods.map((p) => p.total)).toEqual([738, 970, 902, 1029, 441, 4680]);
  });
  it("any de traspàs: 2028 té 8.784 hores", () => {
    expect(countHours("6.1TD", DIRECCIO_RULES.nit, yearReference(2028)).totalHours).toBe(8784);
  });
  it("coincideix amb un recompte independent (Intl Europe/Madrid, dia a dia)", () => {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
    const hol = new Set(["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"]);
    const season: Record<number, [number, number]> = { 1: [1, 2], 2: [1, 2], 7: [1, 2], 12: [1, 2], 3: [2, 3], 11: [2, 3], 6: [3, 4], 8: [3, 4], 9: [3, 4], 4: [4, 5], 5: [4, 5], 10: [4, 5] };
    const n = [0, 0, 0, 0, 0, 0, 0];
    for (let t = Date.UTC(2026, 11, 31, 23); t < Date.UTC(2027, 11, 31, 23); t += 3_600_000) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      const h = Number(p.hour), m = Number(p.month);
      const festiu = p.weekday === "Sat" || p.weekday === "Sun" || hol.has(`${p.month}-${p.day}`);
      const per = festiu || h < 8 ? 6 : (h >= 9 && h < 14) || (h >= 18 && h < 22) ? season[m][0] : season[m][1];
      n[per]++;
    }
    expect(countHours("3.0TD", { mode: "plana" }, Y).periods.map((p) => p.total)).toEqual(n.slice(1));
  });
  it("el dia de 25 hores de l'octubre és diumenge: totes les hores, P6", () => {
    const hol = holidaySet("2027-10-31", "2027-11-01");
    const hours = [...localHours("2027-10-31", "2027-11-01")];
    expect(hours.length).toBe(25);
    expect(new Set(hours.map((h) => periodOf(h, hol)))).toEqual(new Set([6]));
  });
});

describe("3–6 · conversió de les modalitats a P1–P6", () => {
  it("fórmula: (hores Open × preu Open + hores No Open × preu No Open) / hores totals, a 6 decimals", () => {
    const counts = { from: "", to: "", tariff: "3.0TD", totalHours: 100, holidays: [], dstDays: [], periods: [{ period: 1 as Period, open: 75, noOpen: 25, total: 100 }] };
    const [p] = weightedPrices(counts, { open: 0.183659, noOpen: 0.233977 }, DIRECCIO_RULES.dia);
    expect(p.exact).toBe("0.1962385");
    expect(p.price).toBe(0.196239);
    expect(p.openPct).toBe(75);
  });
  it("3.0TD Día (08–24 h tots els dies): P1–P5 sencers Open, P6 ponderat", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    const c = convertModality(d, d.brackets[0], "dia", effectiveRules().dia, Y);
    expect(c.periods.slice(0, 5).every((p) => p.noOpen === 0 && p.price === 0.183659)).toBe(true);
    expect([c.periods[5].open, c.periods[5].noOpen]).toEqual([1760, 2920]);
    expect(c.periods[5].price).toBe(Number(((1760 * 0.183659 + 2920 * 0.233977) / 4680).toFixed(6)));
    expect(c.discrepancies).toEqual([]); // la regla de Direcció coincideix amb el document
    expect(c.needsApproval).toBe(false);
  });
  it("3.0TD Noche: regla de Direcció (dl–dv 00–08) ≠ document (tots els dies) → discrepància i validació", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    const c = convertModality(d, d.brackets[0], "nit", effectiveRules().nit, Y);
    expect(c.periods.slice(0, 5).every((p) => p.open === 0 && p.price === 0.233977)).toBe(true);
    expect(c.periods[5].open).toBe(261 * 8); // 261 dies de dilluns a divendres
    expect(c.discrepancies).toEqual([expect.objectContaining({ period: 6, internalOpen: 2088, documentOpen: 2920, diffHours: -832 })]);
    expect(c.needsApproval).toBe(true);
  });
  it("6.1TD Día i Noche segons el document (amb franges de cap de setmana)", async () => {
    const d = await load("20261030_6.1TD_OPEN_07_V1.pdf");
    const dia = convertModality(d, d.brackets[0], "dia", { rule: d.schedules.dia.rule!, source: "document", approved: true }, Y);
    expect(dia.discrepancies).toEqual([]);
    expect(dia.periods[5].open).toBe(110 * 6); // 110 dies festius (104 de cap de setmana + 6 festius laborables) × 18–24 h
    expect(dia.periods[5].open + dia.periods[5].noOpen).toBe(4680);
    const nit = convertModality(d, d.brackets[0], "nit", { rule: d.schedules.nit.rule!, source: "document", approved: true }, Y);
    expect(nit.periods.slice(0, 5).every((p) => p.open === 0)).toBe(true);
    expect(nit.periods[5].price).toBeGreaterThan(0.130594);
    expect(nit.periods[5].price).toBeLessThan(0.209401);
  });
  it("Plana: el mateix preu als sis períodes", async () => {
    const d = await load("20261030_6.1TD_OPEN_07_V1.pdf");
    const c = convertModality(d, d.brackets[3], "plana", effectiveRules().plana, Y);
    expect(c.periods.map((p) => p.price)).toEqual(Array(6).fill(0.172896));
  });
  it("Laboral (P1–P5 Open, P6 No Open) i Fin de Semana (P1–P5 No Open, P6 Open)", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    const lab = convertModality(d, d.brackets[0], "laboral", effectiveRules().laboral, Y);
    expect(lab.periods.map((p) => p.price)).toEqual([0.17108, 0.17108, 0.17108, 0.17108, 0.17108, 0.233977]);
    expect(lab.discrepancies).toEqual([]); // coincideix exactament amb «08–24 h de dilluns a divendres excepte festius»
    const fds = convertModality(d, d.brackets[0], "cap_de_setmana", effectiveRules().cap_de_setmana, Y);
    expect(fds.periods.map((p) => p.price)).toEqual([0.233977, 0.233977, 0.233977, 0.233977, 0.233977, 0.120762]);
    expect(fds.discrepancies.map((x) => x.period)).toEqual([6]); // el document no posa Open les nits laborables
    expect(fds.needsApproval).toBe(true);
  });
  it("una regla aprovada a la biblioteca substitueix la de Direcció i treu l'avís", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    const rules = effectiveRules({ nit: { rule: d.schedules.nit.rule!, source: "biblioteca", approved: true } });
    expect(convertModality(d, d.brackets[0], "nit", rules.nit, Y).needsApproval).toBe(false);
  });
});

describe("ofertes per al catàleg", () => {
  it("una oferta per modalitat i tram (trams iguals agrupats), preus originals conservats i vàlida per a l'esquema", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    const o = openToOffers(d, effectiveRules(), Y, { fileName: "20261030_3.0TD_OPEN_07_V1.pdf", today: "2026-11-03" });
    expect(o.length).toBe(10); // 5 modalitats × 2 grups de trams
    const dia = o.find((x) => x.offer.productName.startsWith("Open Día"))!.offer;
    expect(dia.open).toMatchObject({ openPrice: 0.183659, noOpenPrice: 0.233977, bracket: { minKw: 15, maxKw: 50 }, estimated: true });
    expect(dia.discounts).toEqual([]); // descomptes ja inclosos: no es dupliquen
    expect(dia.sas.mode).toBe("inclos");
    expect(offerVersionSchema.safeParse(dia).success).toBe(true);
    expect(offerVersionSchema.parse(dia).open?.modality).toBe("dia"); // la metadada no es perd en desar
  });
});

describe("12 · comparatives amb i sense consum horari", () => {
  const supply = () => ({ ...emptySupply(), accessTariff: "3.0TD", kwh: [4000, 5000, 3000, 3000, 2000, 13000], kw: [40, 40, 40, 40, 40, 40], days: 365 });
  it("sense corba: preus ponderats i càlcul marcat com a estimat; tram triat per P6", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    const o = openToOffers(d, effectiveRules(), Y, { fileName: "x.pdf" }).map((x) => ({ ...x.offer, status: "activa" as const, validTo: null }));
    const dia = o.filter((x) => x.open?.modality === "dia");
    const s = supply();
    expect(dia.map((x) => eligibility(x, s, "2026-11-03").eligible)).toEqual([true, false]); // P6 = 40 kW → tram 15–50
    expect(eligibility(dia[0], { ...s, kw: [40, 40, 40, 40, 40, null] }).reasons).toContain("Cal la potència contractada P6 per triar el tram de preus");
    const cost = computeCost(dia[0], s);
    const line = cost.lines.find((l) => l.key === "energia")!;
    expect(line.label).toMatch(/preu estimat per ponderació horària/);
    expect(line.estimated).toBe(true);
    expect(cost.quality).toBe("estimat");
    expect(cost.notes.join(" ")).toMatch(/estalvi calculat és estimat/);
    expect(cost.lines.some((l) => l.key === "descomptes")).toBe(false);
    expect(cost.lines.some((l) => l.key === "sas")).toBe(false);
  });
  it("amb corba horària real: preu Open o No Open a cada hora", async () => {
    const d = await load("20261030_3.0TD_OPEN_07_V1.pdf");
    const dia = openToOffers(d, effectiveRules(), Y, { fileName: "x.pdf" }).find((x) => x.offer.open?.modality === "dia")!.offer;
    // 1 kWh cada hora d'un dimecres laborable (2027-01-13): 8 h No Open (00–08) i 16 h Open
    const hourly = Array.from({ length: 24 }, (_, h) => ({ date: "2027-01-13", hour: h, kwh: 1 }));
    const r = effectiveFromHourly("3.0TD", dia.open!.rule, { open: 0.183659, noOpen: 0.233977 }, hourly);
    expect(r.cost).toBe(Number((16 * 0.183659 + 8 * 0.233977).toFixed(2)));
    expect(r.periods[5]).toMatchObject({ kwh: 8, openKwh: 0, price: 0.233977 });
    const cost = computeCost(dia, { ...supply(), hourly });
    expect(cost.lines.find((l) => l.key === "energia")!.label).toBe("Terme d'energia (distribució horària real)");
    expect(cost.energy).toBe(r.cost);
    expect(cost.notes.join(" ")).toMatch(/no una factura definitiva/);
  });
  it("llegeix el CSV de Datadis (hores 1–24, decimals amb coma)", () => {
    const csv = "CUPS;Fecha;Hora;Consumo;Metodo_obtencion\nES0000000000000001XX;2027/01/13;1;0,250;Real\nES0000000000000001XX;2027/01/13;24;1,5;Real";
    const r = parseHourlyCsv(csv);
    expect(r.rows).toEqual([{ date: "2027-01-13", hour: 0, kwh: 0.25 }, { date: "2027-01-13", hour: 23, kwh: 1.5 }]);
  });
});

describe("10 · xat de correcció", () => {
  const ctxOf = (d: OpenDocument): OpenChatContext => {
    const c = convertModality(d, d.brackets[0], "dia", effectiveRules().dia, Y);
    return { tariff: d.tariff, modality: "dia", bracketLabel: c.bracket.label, openPrice: c.openPrice, noOpenPrice: c.noOpenPrice, rule: c.rule.rule, documentRule: c.documentRule, reference: Y, periods: c.periods, discrepancies: c.discrepancies };
  };
  it("«Per què el P6 de la tarifa Día té aquest preu?» → hores, percentatges, preus, fórmula i resultat", async () => {
    const ctx = ctxOf(await load("20261030_3.0TD_OPEN_07_V1.pdf"));
    const a = localAnswer("Per què el P6 de la tarifa Día té aquest preu?", ctx);
    expect(a.text).toContain("Hores Open: 1760 h");
    expect(a.text).toContain("Hores No Open: 2920 h");
    expect(a.text).toMatch(/37,61 %/);
    expect(a.text).toContain("0,183659");
    expect(a.text).toContain("0,233977");
    expect(a.text).toContain("Fórmula: (1760 × 0,183659 + 2920 × 0,233977) / 4680");
    expect(a.proposal).toBeNull();
    expect(explainPeriod(ctx, 1)).toContain("Hores No Open: 0 h");
  });
  it("una correcció d'horari es converteix en una proposta (no s'aplica sola)", async () => {
    const ctx = ctxOf(await load("20261030_6.1TD_OPEN_07_V1.pdf"));
    const a = localAnswer("La Noche és de 0 a 8 de dilluns a divendres i de 0 a 18 els caps de setmana i festius", ctx);
    expect(a.proposal).toEqual({ modality: "nit", rule: { mode: "horari", windows: [{ days: "dl_dv", from: 0, to: 8 }, { days: "festiu", from: 0, to: 18 }] }, summary: expect.any(String) });
    expect(a.text).toMatch(/recalculo/);
    expect(parseCorrection("Fin de semana: P6 open", "dia")).toMatchObject({ modality: "cap_de_setmana", rule: { mode: "periodes", openPeriods: [6] } });
    expect(parseCorrection("Laboral: P1 a P5 open")).toMatchObject({ modality: "laboral", rule: { mode: "periodes", openPeriods: [1, 2, 3, 4, 5] } });
  });
});
