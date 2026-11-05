/**
 * FASE 6 · Captació: nucli pur (formulari, fitxers, antispam, duplicats, atribució, assignació, lectura de factures,
 * comparativa preliminar, indicadors) i verificació de webhooks. Numeració = secció 19 del prompt.
 */
import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  CONSENT_TEXTS, applyReview, checkUpload, funnelKpis, matchDuplicates, normalizePhone, normalizeReading, pdfActiveContent, pickAssignee, publicFormSchema, rateDecision,
  readingToComparison, refCodeFrom, referralUrl, relaxedFormSchema, resolveAttribution, resolveChannel, spamReasons, validCups, waWindowOpen, type AssignRule,
} from "@/core/capture";
import { CUPS_OK, field, invoice20 } from "./helpers/invoice";

vi.mock("server-only", () => ({}));

const form = (p: Record<string, unknown> = {}) => ({ idempotencyKey: "0b8f7f3e-4a8e-4c41-9a35-6c5a8f1f2b11", name: "Marta Puig", phone: "973 98 28 52", email: "Marta@Exemple.cat", customerKind: "particular", energyType: "luz", acceptPrivacy: true, ...p });
const PDF = (body = "") => new TextEncoder().encode(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n${body}\n%%EOF`);

describe("1 · Enviament del formulari (validació)", () => {
  it("accepta un formulari correcte i normalitza telèfon i correu", () => {
    const r = publicFormSchema.parse(form());
    expect(r.phone).toBe("+34973982852");
    expect(r.email).toBe("marta@exemple.cat");
    expect(r.acceptCommercial).toBe(false); // el comercial és opcional i desmarcat per defecte
  });
  it("rebutja sense privacitat, amb telèfon o correu no vàlids, i un codi de referència mal format", () => {
    expect(publicFormSchema.safeParse(form({ acceptPrivacy: false })).success).toBe(false);
    expect(publicFormSchema.safeParse(form({ phone: "123" })).success).toBe(false);
    expect(publicFormSchema.safeParse(form({ email: "no-es-un-correu" })).success).toBe(false);
    expect(publicFormSchema.safeParse(form({ ref: "../admin" })).success).toBe(false);
    expect(publicFormSchema.safeParse(form({ ref: "pau1234" })).data?.ref).toBe("PAU1234");
  });
  it("canals externs: n'hi ha prou amb telèfon o correu (no s'inventa l'altre)", () => {
    expect(relaxedFormSchema.safeParse(form({ email: "" })).success).toBe(true);
    expect(relaxedFormSchema.safeParse(form({ email: "", phone: "" })).success).toBe(false);
  });
  it("consentiment de servei i comercial són textos separats", () => {
    expect(CONSENT_TEXTS.privacitat_servei).not.toBe(CONSENT_TEXTS.comercial);
    expect(CONSENT_TEXTS.comercial).toMatch(/opcional/);
  });
});

describe("2 · Pujada segura de factura", () => {
  it("accepta PDF, JPG, PNG i WebP pel contingut real", () => {
    expect(checkUpload(PDF(), "f.pdf")).toEqual({ ok: true, mime: "application/pdf" });
    expect(checkUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), "foto.jpeg")).toMatchObject({ mime: "image/jpeg" });
    expect(checkUpload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), "f.png")).toMatchObject({ mime: "image/png" });
    expect(checkUpload(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "f.webp")).toMatchObject({ mime: "image/webp" });
  });
  it("rebutja executables disfressats, HTML, fitxers buits, massa grans i PDF amb codi actiu", () => {
    expect(checkUpload(new TextEncoder().encode("MZ\x90\x00 executable binari"), "factura.pdf")).toMatchObject({ ok: false });
    expect(checkUpload(new TextEncoder().encode("<html><script>alert(1)</script></html>"), "factura.html")).toMatchObject({ ok: false });
    expect(checkUpload(PDF(), "factura.exe")).toMatchObject({ ok: false });
    expect(checkUpload(new Uint8Array(), "f.pdf")).toMatchObject({ ok: false, error: "El fitxer és buit" });
    const big = new Uint8Array(10 * 1024 * 1024 + 1); big.set([0x25, 0x50, 0x44, 0x46]);
    expect(checkUpload(big, "f.pdf")).toMatchObject({ ok: false, error: "El fitxer supera els 10 MB" });
    expect(pdfActiveContent(PDF("<</S/JavaScript/JS(app.alert(1))>> /Launch /EmbeddedFiles"))).toEqual(["JavaScript", "acció Launch", "fitxers incrustats"]);
    expect(checkUpload(PDF("/OpenAction<</S/JavaScript/JS(x)>>"), "f.pdf")).toMatchObject({ ok: false, error: expect.stringMatching(/no permesos/) });
  });
});

describe("Antispam i limitació de peticions", () => {
  it("parany, massa ràpid, enllaços i paraules típiques", () => {
    const now = 1_000_000;
    expect(spamReasons({ website: "", notes: "", name: "Marta", startedAt: now - 20_000 }, now)).toEqual([]);
    expect(spamReasons({ website: "http://x", notes: "", name: "Bot", startedAt: now - 500 }, now)).toEqual(["camp_parany", "massa_rapid"]);
    expect(spamReasons({ website: "", notes: "http://a http://b http://c casino", name: "www.spam.com", startedAt: undefined }, now)).toEqual(["massa_enllacos", "enllac_al_nom", "paraules_spam"]);
  });
  it("límits per IP (10 minuts i dia) i per contacte", () => {
    expect(rateDecision({ ip10min: 4, ipDay: 19, contactDay: 2 }).ok).toBe(true);
    expect(rateDecision({ ip10min: 5, ipDay: 0, contactDay: 0 }).ok).toBe(false);
    expect(rateDecision({ ip10min: 0, ipDay: 20, contactDay: 0 }).ok).toBe(false);
    expect(rateDecision({ ip10min: 0, ipDay: 0, contactDay: 3 }).reason).toMatch(/Ja hem rebut/);
  });
});

describe("5 · Detecció de duplicats (mai fusió automàtica)", () => {
  const rows = [
    { kind: "client" as const, id: "c1", name: "Forn SL", phone: "+34 600 000 001", email: "a@b.cat", tax_id: "12345678-Z" },
    { kind: "subministrament" as const, id: "s1", cups: `${CUPS_OK}0F`, client_id: "c2" },
    { kind: "lead" as const, id: "l1", name: "Altre", phone: "600000009", email: null },
  ];
  it("CUPS i NIF són coincidències fortes; telèfon i correu, febles", () => {
    const d = matchDuplicates({ phone: "600000001", email: "A@B.cat", tax_id: "12345678z", cups: CUPS_OK }, rows);
    expect(d).toEqual([
      { kind: "client", id: "c1", name: "Forn SL", by: ["nif", "telefon", "correu"], strength: "fort", client_id: "c1" },
      { kind: "subministrament", id: "s1", name: null, by: ["cups"], strength: "fort", client_id: "c2" },
    ]);
    expect(matchDuplicates({ phone: "+34600000009", email: null }, rows)).toEqual([expect.objectContaining({ id: "l1", strength: "feble" })]);
    expect(matchDuplicates({ phone: "+34699999999", email: "x@y.cat" }, rows)).toEqual([]);
  });
});

describe("12-13 · Enllaços de referència i atribució", () => {
  it("canal per enllaç, UTM o identificadors de clic", () => {
    expect(resolveChannel({ linkChannel: "qr", withInvoice: true })).toBe("qr");
    expect(resolveChannel({ utm: { source: "google" }, withInvoice: true })).toBe("google_ads");
    expect(resolveChannel({ fbclid: "x", withInvoice: false })).toBe("meta_ads");
    expect(resolveChannel({ withInvoice: true })).toBe("factura");
    expect(resolveChannel({ withInvoice: false })).toBe("formulari");
  });
  it("primer aportant vigent; un segon col·laborador dins la finestra queda en disputa", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    expect(resolveAttribution([], "P1", now)).toBe("vigent");
    expect(resolveAttribution([{ partner_id: "P1", status: "vigent", created_at: "2026-10-20T00:00:00Z" }], "P2", now)).toBe("en_disputa");
    expect(resolveAttribution([{ partner_id: "P1", status: "vigent", created_at: "2026-10-20T00:00:00Z" }], "P1", now)).toBe("ja_existeix");
    expect(resolveAttribution([{ partner_id: "P1", status: "vigent", created_at: "2026-03-01T00:00:00Z" }], "P2", now)).toBe("vigent"); // fora de la finestra
    expect(resolveAttribution([], null, now)).toBe("cap");
  });
  it("codis segurs (només lletres i xifres) i URL de la landing", () => {
    expect(refCodeFrom("Electricitat Pau, SL", () => 0.42)).toBe("ELECTR4444");
    expect(referralUrl("https://www.assessoria30.com/", "PAU1234")).toBe("https://www.assessoria30.com/estudi?ref=PAU1234");
  });
});

describe("9 · Assignació de comercial", () => {
  const rules: AssignRule[] = [
    { id: "r1", name: "Gas", priority: 10, active: true, conditions: { energy: ["gas"] }, strategy: "usuari", user_ids: ["G"], max_open_leads: null },
    { id: "r2", name: "Lleida", priority: 20, active: true, conditions: { provinces: ["Lleida"] }, strategy: "menys_carrega", user_ids: ["A", "B"], max_open_leads: 5 },
    { id: "r3", name: "Rotació", priority: 30, active: true, conditions: {}, strategy: "rotatiu", user_ids: ["X", "Y"], max_open_leads: null },
  ];
  const lead = { province: "Lleida", city: null, energy: "luz" as const, customerKind: "particular", channel: "web", partnerId: null, annualKwh: null };
  const all = new Set(["G", "A", "B", "X", "Y"]);
  it("prioritat, condicions i menys càrrega de treball", () => {
    expect(pickAssignee(rules, { ...lead, energy: "gas" }, {}, {}, all)).toMatchObject({ userId: "G", ruleId: "r1", method: "regla" });
    expect(pickAssignee(rules, lead, { A: 3, B: 1 }, {}, all)).toMatchObject({ userId: "B", ruleId: "r2" });
    expect(pickAssignee(rules, lead, { A: 5, B: 5 }, {}, all).ruleId).toBe("r3"); // càrrega màxima → regla següent
    expect(pickAssignee(rules, { ...lead, province: "Girona" }, {}, { r3: "X" }, all).userId).toBe("Y"); // rotació
    expect(pickAssignee(rules, { ...lead, province: "Girona" }, {}, {}, new Set())).toMatchObject({ userId: null, method: "sense_assignar" });
  });
});

describe("6-7 · Lectura de factura i validació de les dades extretes", () => {
  it("cada dada amb valor, unitat, pàgina, estat i mètode; el que no hi és queda pendent", () => {
    const { fields, warnings } = normalizeReading(invoice20());
    const by = (k: string) => fields.find((f) => f.key === k)!;
    expect(by("cups")).toMatchObject({ value: CUPS_OK, status: "llegit", page: 1, method: "text" });
    expect(by("kwh.P1")).toMatchObject({ value: 100, unit: "kWh" });
    expect(by("energyPrice.P1").unit).toBe("€/kWh (sense impostos)");
    expect(by("total").unit).toBe("€ (amb impostos)");
    expect(by("permanence")).toMatchObject({ value: null, status: "pendent", method: null });
    expect(fields.filter((f) => f.key.startsWith("kwh."))).toHaveLength(3); // 2.0TD: 3 períodes d'energia
    expect(warnings).toEqual([]);
  });
  it("detecta CUPS i NIF incorrectes, dates incoherents, tarifa d'un altre tipus i confusió d'impostos", () => {
    const { fields, warnings } = normalizeReading(invoice20({ cups: field("ES0031405000000001AA"), taxId: field("12345678A"), days: field(40), accessTariff: field("RL.1"), vatEur: field(90) }));
    expect(warnings.join(" | ")).toMatch(/CUPS.*no quadren/);
    expect(warnings.join(" | ")).toMatch(/NIF.*no és vàlida/);
    expect(warnings.join(" | ")).toMatch(/No quadra amb les dates/);
    expect(warnings.join(" | ")).toMatch(/Tarifa de gas/);
    expect(warnings.join(" | ")).toMatch(/import amb i sense impostos/);
    expect(fields.find((f) => f.key === "cups")!.status).toBe("per_revisar");
    expect(validCups(CUPS_OK)).toBe(true);
  });
  it("els valors marcats per confirmar (IA o dubtosos) queden «per revisar»; la revisió humana els confirma", () => {
    const { fields } = normalizeReading(invoice20({ kw: [field(4.6, 2, true, "ia"), field(4.6), ...Array.from({ length: 4 }, () => field(null))] }));
    expect(fields.find((f) => f.key === "kw.P1")).toMatchObject({ status: "per_revisar", method: "ia", page: 2 });
    const rev = applyReview(fields, { "kw.P1": 5.75 });
    expect(rev.find((f) => f.key === "kw.P1")).toMatchObject({ value: 5.75, status: "revisat", method: "manual" });
  });
  it("gas: peatge RL, consum i terme fix; sense potències", () => {
    const g = invoice20({ energyType: field("gas"), accessTariff: field("RL.2"), kw: Array.from({ length: 6 }, () => field(null)), powerPrice: Array.from({ length: 6 }, () => field(null)), gasFixedEurDay: field(0.3), energyPrice: [field(0.07), ...Array.from({ length: 5 }, () => field(null))], kwh: [field(900), ...Array.from({ length: 5 }, () => field(null))] });
    const { fields } = normalizeReading(g);
    expect(fields.some((f) => f.key.startsWith("kw."))).toBe(false);
    expect(fields.find((f) => f.key === "gasFixedEurDay")).toMatchObject({ value: 0.3, unit: "€/dia" });
    const c = readingToComparison(fields);
    expect(c.ok).toBe(true);
    expect(c.supply).toMatchObject({ energyType: "gas", kwhTotal: Math.round(900 * 365 / 31) });
    expect(c.current?.gasFixedEurDay).toBe(0.3);
  });
});

describe("10 · Comparativa preliminar: dades suficients o pendents", () => {
  it("anualitza el consum (hipòtesi explícita) i fa servir els preus llegits", () => {
    const c = readingToComparison(normalizeReading(invoice20()).fields);
    expect(c.ok).toBe(true);
    expect(c.supply).toMatchObject({ basis: "anualitzat", days: 365, kwh: [Math.round(100 * 365 / 31), Math.round(80 * 365 / 31), Math.round(120 * 365 / 31)] });
    expect(c.current?.energy).toEqual([0.2, 0.15, 0.1]);
    expect(c.hypotheses[0]).toMatch(/anualitzat a partir d'una factura de 31 dies/);
  });
  it("sense consum per períodes no hi ha comparativa; sense preus no hi ha cost actual (no s'inventa)", () => {
    const noKwh = readingToComparison(normalizeReading(invoice20({ kwh: Array.from({ length: 6 }, () => field(null)) })).fields);
    expect(noKwh).toMatchObject({ ok: false, missing: ["Consum per períodes"], supply: null });
    const noPrice = readingToComparison(normalizeReading(invoice20({ energyPrice: Array.from({ length: 6 }, () => field(null)) })).fields);
    expect(noPrice.ok).toBe(true);
    expect(noPrice.current).toBeNull();
    expect(noPrice.hypotheses.join(" ")).toMatch(/pendents de factura o condicions actuals/);
  });
});

describe("Indicadors: conegut, estimat o no disponible", () => {
  it("sense costos importats el cost i el cost per lead no estan disponibles (no s'inventen)", () => {
    const k = funnelKpis({ visits: 120, started: 30, submitted: 12, invoices: 9, validLeads: 10, opportunities: 4, proposalsSent: 2, contractsActivated: 1, mwhWon: 12.5, commissionsEstimated: 300, commissionsConfirmed: null, cost: null, costComplete: false });
    const by = (key: string) => k.find((x) => x.key === key)!;
    expect(by("cost")).toMatchObject({ value: null, status: "no_disponible" });
    expect(by("cpl")).toMatchObject({ value: null, status: "no_disponible" });
    expect(by("comissions")).toMatchObject({ value: 300, status: "estimat" });
    const k2 = funnelKpis({ visits: null, started: null, submitted: 12, invoices: 9, validLeads: 10, opportunities: 4, proposalsSent: 2, contractsActivated: 2, mwhWon: null, commissionsEstimated: null, commissionsConfirmed: 500, cost: 200, costComplete: true });
    expect(k2.find((x) => x.key === "cpl")).toMatchObject({ value: 20, status: "conegut" });
    expect(k2.find((x) => x.key === "cpa")).toMatchObject({ value: 100, status: "conegut" });
    expect(k2.find((x) => x.key === "rendibilitat")).toMatchObject({ value: 300, status: "conegut" });
    expect(k2.find((x) => x.key === "visites")).toMatchObject({ value: null, status: "no_disponible" });
  });
});

describe("16 · Webhooks verificats i WhatsApp", () => {
  it("signatura HMAC SHA-256 de Meta: correcta, alterada o absent", async () => {
    const { verifyMetaSignature } = await import("@/server/marketing");
    const body = JSON.stringify({ object: "page", entry: [] });
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, sig, "secret")).toBe(true);
    expect(verifyMetaSignature(`${body} `, sig, "secret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "un-altre")).toBe(false);
    expect(verifyMetaSignature(body, null, "secret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "")).toBe(false); // sense secret configurat: mai vàlid
  });
  it("finestra de conversa de 24 h; telèfons normalitzats", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(waWindowOpen("2026-11-01T00:00:00Z", now)).toBe(true);
    expect(waWindowOpen("2026-10-30T00:00:00Z", now)).toBe(false);
    expect(waWindowOpen(null, now)).toBe(false);
    expect(normalizePhone("0034 600 11 22 33")).toBe("+34600112233");
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678");
  });
});
