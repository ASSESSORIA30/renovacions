import { describe, expect, it, vi } from "vitest";
import {
  EXP_STATUSES, checkMove, conditionsFromOffer, conditionsRows, contractingKpis, dataPresent, docProgress, needsJustification, planExpedientAutomations, renderTemplate,
  templateVariables, INTERNAL_TEMPLATE_EXAMPLE, type MoveContext,
} from "@/core/contracting";
import { buildContractPdf } from "@/core/contract-pdf";

vi.mock("server-only", () => ({}));

const base: MoveContext["exp"] = { status: "pendent_documentacio", sent_at: null, sent_to: null, signed_at: null, activated_at: null, activation_source: null, start_date: null, rejection_reason: null, status_before_incident: null };
const ctx = (p: Omit<Partial<MoveContext>, "exp"> & { exp?: Partial<MoveContext["exp"]> } = {}): MoveContext => ({ staff: true, requirements: [], signed: false, ...p, exp: { ...base, ...(p.exp ?? {}) } });

describe("flux de l'expedient", () => {
  it("no deixa saltar estats", () => {
    expect(checkMove("enviat", ctx())).toMatch(/No es pot passar/);
    expect(checkMove("documentacio_completa", ctx())).toBeNull();
  });
  it("documentació obligatòria pendent bloqueja «documentació completa»", () => {
    expect(checkMove("documentacio_completa", ctx({ requirements: [{ mandatory: true, status: "pendent" }, { mandatory: false, status: "pendent" }] }))).toMatch(/Falta documentació obligatòria \(1\)/);
    expect(checkMove("documentacio_completa", ctx({ requirements: [{ mandatory: true, status: "validat" }, { mandatory: true, status: "no_aplica" }] }))).toBeNull();
  });
  it("proposta acceptada, signat, enviat i activat són coses diferents", () => {
    expect(checkMove("signat", ctx({ exp: { status: "pendent_signatura" } }))).toMatch(/cap signatura confirmada/);
    expect(checkMove("signat", ctx({ exp: { status: "pendent_signatura" }, signed: true }))).toBeNull();
    expect(checkMove("enviat", ctx({ exp: { status: "signat" } }))).toMatch(/data d'enviament/);
    expect(checkMove("enviat", ctx({ exp: { status: "signat", sent_at: "2026-11-01T10:00:00Z", sent_to: "Iberdrola" } }))).toBeNull();
    expect(checkMove("activat", ctx({ exp: { status: "en_tramitacio" } }))).toMatch(/informació mínima d'activació/);
  });
  it("els comercials només mouen la fase de preparació", () => {
    expect(checkMove("documentacio_completa", ctx({ staff: false }))).toBeNull();
    expect(checkMove("enviat", ctx({ staff: false, exp: { status: "signat", sent_at: "x", sent_to: "y" } }))).toMatch(/Només Administració/);
    expect(checkMove("rebutjat", ctx({ staff: false, note: "x", exp: { rejection_reason: "x" } }))).toMatch(/Només Administració/);
  });
  it("els retrocessos, les incidències i els rebuigs demanen justificació", () => {
    expect(needsJustification("pendent_signatura", "pendent_documentacio")).toBe(true);
    expect(needsJustification("pendent_documentacio", "documentacio_completa")).toBe(false);
    expect(checkMove("incidencia", ctx({ exp: { status: "enviat" } }))).toMatch(/justificació/);
    expect(checkMove("incidencia", ctx({ exp: { status: "enviat" }, note: "Falta el CIE" }))).toBeNull();
    expect(checkMove("rebutjat", ctx({ note: "x" }))).toMatch(/motiu del rebuig/);
  });
  it("en resoldre una incidència no es pot avançar més enllà d'on era", () => {
    const exp = { status: "incidencia" as const, status_before_incident: "documentacio_completa" as const };
    expect(checkMove("en_tramitacio", ctx({ exp }))).toMatch(/com a màxim/);
    expect(checkMove("documentacio_completa", ctx({ exp }))).toBeNull();
  });
  it("cada estat té etiqueta i sortida definida", () => {
    for (const s of EXP_STATUSES) expect(() => checkMove(s, ctx({ exp: { status: s } }))).not.toThrow();
  });
});

describe("requisits", () => {
  const src = { client: { name: "Forn SL", tax_id: "B12345678", address: null, city: "Lleida", phone: null, email: "a@b.cat" }, supply: { cups: "ES0021000000000001AA", address: null, holder_name: null, access_tariff: "3.0TD", power_kw: [null, null] } };
  it("comprova les dades de la fitxa", () => {
    expect(dataPresent("client.tax_id", src)).toBe(true);
    expect(dataPresent("client.contact", src)).toBe(true);
    expect(dataPresent("supply.power", src)).toBe(false);
    expect(dataPresent("supply.cups", { ...src, supply: null })).toBe(false);
  });
  it("progrés de documentació", () => {
    expect(docProgress([{ mandatory: true, status: "validat" }, { mandatory: true, status: "pendent" }, { mandatory: false, status: "pendent" }, { mandatory: true, status: "no_aplica" }])).toMatchObject({ total: 2, done: 1, pending: 1, pct: 50 });
  });
});

describe("plantilles i PDF", () => {
  const vars = { "client.nom": "Forn Sant Jordi SL", "client.nif": "B12345678", "client.email": null, "expedient.codi": "EXP-2026-00001" };
  it("no genera res si falten dades obligatòries i ho diu", () => {
    const r = renderTemplate("Client {{client.nom}} · {{client.adreca}}", vars, []);
    expect(r).toEqual({ ok: false, missing: ["client.adreca"], unknown: [] });
  });
  it("les variables opcionals s'escriuen com a «—»", () => {
    const r = renderTemplate("# Títol\nCorreu: {{?client.email}}\n- NIF {{client.nif}}\n---", vars, []);
    expect(r.ok && r.blocks).toEqual([{ t: "h1", text: "Títol" }, { t: "p", text: "Correu: —" }, { t: "li", text: "NIF B12345678" }, { t: "hr" }]);
  });
  it("detecta variables desconegudes", () => {
    expect(templateVariables("{{client.nom}} {{client.iban}}").unknown).toEqual(["client.iban"]);
    expect(templateVariables(INTERNAL_TEMPLATE_EXAMPLE).unknown).toEqual([]);
  });
  it("taula de condicions: només el que es coneix", () => {
    const rows = conditionsRows({ energy_eur_kwh: [0.12, null, 0.1], permanence_months: 0, offer_ref: { offer_id: "o1", version: 3, supplier: "Iberdrola", product: "Plan" } }, { estimated_annual_eur: 1234.5 });
    expect(rows.map((r) => r[0])).toEqual(["Oferta", "Terme d'energia", "Permanència", "Import anual estimat"]);
    expect(rows[1][1]).toBe("P1: 0,12 €/kWh · P3: 0,1 €/kWh");
    expect(rows[2][1]).toBe("Sense permanència");
  });
  it("genera un PDF amb el text de la plantilla", async () => {
    const r = renderTemplate("# Resum\nClient {{client.nom}}\n{{condicions.taula}}", vars, [["Terme d'energia", "P1: 0,12 €/kWh"]]);
    if (!r.ok) throw new Error("no");
    const pdf = buildContractPdf(r.blocks, { title: "Resum", code: "EXP-2026-00001", templateName: "Resum", templateVersion: 2, generatedAt: new Date("2026-11-01T10:00:00Z"), generatedBy: "Olivia", documentVersion: 1, origin: "intern" });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const { extractText } = await import("unpdf");
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("Forn Sant Jordi SL");
    expect(text).toContain("0,12 €/kWh");
    expect(text).toContain("plantilla v2");
  });
});

describe("condicions des d'una comparativa", () => {
  it("copia l'oferta acceptada sense recalcular", () => {
    const snap = { supply: { annualKwh: 80000 }, offers: [{ id: "a", supplierName: "Endesa", productName: "One", version: 1, contractType: "fix", energy: [0.15], power: [0.08, 0.02], permanenceMonths: 12 }, { id: "b", supplierName: "Iberdrola", productName: "Plan", version: 4, contractType: "periodes", energy: [0.13, 0.11], permanenceMonths: 0 }], result: { ranked: [{ offer: { id: "b" }, cost: { total: 9800 } }, { offer: { id: "a" }, cost: { total: 10400 } }] } };
    const best = conditionsFromOffer(snap, null)!;
    expect(best).toMatchObject({ retailer: "Iberdrola", product: "Plan", annual_kwh: 80000, estimated: 9800 });
    expect(best.conditions.energy_eur_kwh).toEqual([0.13, 0.11]);
    expect(conditionsFromOffer(snap, "a")!.conditions.permanence_months).toBe(12);
    expect(conditionsFromOffer(snap, "zz")).toBeNull();
  });
});

describe("automatitzacions d'expedients", () => {
  const now = new Date("2026-11-10T09:00:00Z");
  const rules = ["exp_documentacio_incompleta", "exp_signatura_pendent", "exp_sense_moviment", "exp_rebuig", "exp_activat", "exp_sense_responsable"].map((key) => ({ key, enabled: true, params: {} }));
  const e = (p: Record<string, unknown>) => ({ id: "e1", code: "EXP-2026-00001", client_id: "c1", status: "pendent_documentacio" as const, owner_id: "u1", status_changed_at: "2026-11-01T09:00:00Z", last_event_at: "2026-11-09T09:00:00Z", retailer: "Iberdrola", client_name: "Forn", ...p });
  it("documentació incompleta → tasca amb clau estable (idempotent)", () => {
    const a = planExpedientAutomations({ now, rules, expedients: [e({})], signatures: [], staffIds: ["s1"] });
    const b = planExpedientAutomations({ now: new Date("2026-11-11T09:00:00Z"), rules, expedients: [e({})], signatures: [], staffIds: ["s1"] });
    expect(a.tasks).toHaveLength(1);
    expect(a.tasks[0].rule_key).toBe(b.tasks[0].rule_key);
    expect(a.events[0].title).toMatch(/Automatització/);
  });
  it("sense responsable → Administració; rebuig → responsable i Administració", () => {
    const p = planExpedientAutomations({ now, rules, expedients: [e({ owner_id: null, id: "e2" }), e({ id: "e3", status: "rebutjat", status_changed_at: "2026-11-09T09:00:00Z" })], signatures: [], staffIds: ["s1", "s2"] });
    expect(p.notifications.filter((n) => n.rule_key.startsWith("exp_orphan")).map((n) => n.user_id)).toEqual(["s1", "s2"]);
    expect(p.notifications.filter((n) => n.rule_key.startsWith("exp_rej")).map((n) => n.user_id).sort()).toEqual(["s1", "s2", "u1"]);
  });
  it("signatura pendent i activació", () => {
    const p = planExpedientAutomations({ now, rules, expedients: [e({ status: "pendent_signatura" }), e({ id: "e4", status: "activat", status_changed_at: "2026-11-09T09:00:00Z" })], signatures: [{ id: "s", expedient_id: "e1", status: "enviada", sent_at: "2026-11-05T09:00:00Z" }], staffIds: [] });
    expect(p.notifications.map((n) => n.rule_key)).toEqual(expect.arrayContaining(["exp_sig:s", "exp_act:e4"]));
    expect(p.notifications.find((n) => n.rule_key === "exp_act:e4")!.body).toMatch(/no la marca com a meritada/);
  });
  it("regla desactivada → res", () => {
    expect(planExpedientAutomations({ now, rules: rules.map((r) => ({ ...r, enabled: false })), expedients: [e({ owner_id: null })], signatures: [], staffIds: ["s1"] })).toEqual({ tasks: [], notifications: [], events: [] });
  });
});

describe("panell", () => {
  it("indicadors", () => {
    const k = contractingKpis([
      { status: "activat", created_at: "2026-10-01T00:00:00Z", activated_at: "2026-11-05", status_changed_at: "2026-11-05T00:00:00Z", service: "gas" },
      { status: "pendent_documentacio", created_at: "2026-10-20T00:00:00Z", activated_at: null, status_changed_at: "2026-10-20T00:00:00Z", service: "gas", docs_pending: 2 },
    ], new Date("2026-11-10T00:00:00Z"));
    expect(k).toMatchObject({ open: 1, activatedMonth: 1, avgDaysToActivate: 35, stale: 1, docsPending: 2 });
  });
});

describe("webhook de signatura", () => {
  it("el testimoni de l'URL només val per a la seva sol·licitud", async () => {
    process.env.SIGNATURE_WEBHOOK_SECRET = "prova-secret";
    const { webhookToken, verifyWebhookToken, signatureStatus } = await import("@/server/signature");
    const t = webhookToken("11111111-1111-4111-8111-111111111111");
    expect(verifyWebhookToken("11111111-1111-4111-8111-111111111111", t)).toBe(true);
    expect(verifyWebhookToken("22222222-2222-4222-8222-222222222222", t)).toBe(false);
    expect(verifyWebhookToken("11111111-1111-4111-8111-111111111111", t.slice(0, -1) + "x")).toBe(false);
    delete process.env.SIGNATURE_PROVIDER;
    expect(signatureStatus()).toMatchObject({ configured: false, provider: null, missing: ["SIGNATURE_PROVIDER"] });
    process.env.SIGNATURE_PROVIDER = "signaturit";
    expect(signatureStatus()).toMatchObject({ configured: false, provider: "signaturit" });
    expect(signatureStatus().missing).toContain("SIGNATURIT_API_TOKEN");
  });
});
