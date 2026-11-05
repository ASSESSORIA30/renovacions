/**
 * FASE 6 · Captació de punta a punta al servidor amb un client Supabase en memòria (Storage inclòs):
 * formulari → sol·licitud → lead → factura privada → lectura → comparativa preliminar → PDF; col·laboradors, referències,
 * atribució, portal, webhooks i automatitzacions. (La RLS real es prova a tests/db/crm-captacio-rls.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { fakeSupabase } from "./helpers/fake-supabase";
import { CUPS_OK, field, invoice20 } from "./helpers/invoice";
import type { InvoiceData } from "@/comparator/invoice";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase>; reader: (b: Uint8Array) => Promise<{ data: InvoiceData; warnings: string[]; method: "text" | "ia" | "mixt"; pages: number }> } = {
  sb: fakeSupabase(), reader: async () => ({ data: invoice20(), warnings: [], method: "text", pages: 1 }),
};
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, requireUser: async () => { throw new Error("no"); }, handler: () => () => null };
});
vi.mock("@/server/invoices", () => ({ readInvoiceBytes: (b: Uint8Array) => state.reader(b) }));
vi.mock("@/server/mailer", () => ({ smtpReady: async () => false, sendCorporateMail: async () => ({ accepted: [] }) }));
process.env.META_APP_SECRET = "meta-secret";
process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-me";
process.env.CAPTURE_HASH_SALT = "sal";

const A = "00000000-0000-0000-0000-00000000000a", C1 = "00000000-0000-0000-0000-0000000000c1", C2 = "00000000-0000-0000-0000-0000000000c2", K = "00000000-0000-0000-0000-00000000000f";
const user = (id: string, role: string) => ({ sb: state.sb, user: { id }, profile: { id, name: role === "colaborador" ? "Pau Electricista" : `Usuari ${role}`, email: `${role}@a30.com`, role, code: null } }) as never;
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n(factura de prova)\n%%EOF");
const PDF2 = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n(una altra factura)\n%%EOF");
let n = 0;
const key = () => `0b8f7f3e-4a8e-4c41-9a35-${(++n).toString(16).padStart(12, "0")}`;
const form = (p: Record<string, unknown> = {}) => ({ idempotencyKey: key(), name: "Marta Puig", phone: "600 111 222", email: "marta@exemple.cat", customerKind: "particular", energyType: "luz", acceptPrivacy: true, acceptCommercial: false, province: "Lleida", startedAt: Date.now() - 30_000, ...p });
const offer = (id: string, name: string, e: number[]) => ({ id, supplierId: `s-${id}`, supplierName: name, productId: `p-${id}`, productName: `${name} Llar`, version: 1, energyType: "luz", accessTariff: "2.0TD", segments: ["residencial", "pyme"], contractType: "periodes", energy: [...e, null, null, null], energy24h: null, power: [0.09, 0.04, null, null, null, null], powerUnit: "eur_kw_dia", gasFixedEurDay: null, taxTreatment: "sense_impostos", sas: { mode: "inclos", eurKwh: null }, fees: [], discounts: [], permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), source: `Tarifa ${name}`, publishedAt: null, status: "activa", conditions: null, origin: "manual" });

function seed() {
  return {
    profiles: [{ id: A, name: "Direcció", email: "a@a30.com", role: "admin" }, { id: C1, name: "Comercial Lleida", email: "c1@a30.com", role: "comercial" }, { id: C2, name: "Comercial Girona", email: "c2@a30.com", role: "comercial" }, { id: K, name: "Pau Electricista", email: "pau@x.cat", role: "colaborador" }],
    crm_automation_rules: [{ key: "cap_nou_lead", enabled: true, params: { due_hours: 4 } }, { key: "cap_reprocessa", enabled: true, params: { max_attempts: 3 } }, { key: "cap_factura_processada", enabled: true, params: {} }, { key: "cap_dades_incompletes", enabled: true, params: {} }],
    cap_assignment_rules: [{ id: "R1", name: "Lleida", priority: 10, active: true, conditions: { provinces: ["Lleida"] }, strategy: "menys_carrega", user_ids: [C1], max_open_leads: null }, { id: "R2", name: "Resta", priority: 20, active: true, conditions: {}, strategy: "usuari", user_ids: [C2], max_open_leads: null }],
    crm_clients: [{ id: "CLI-EXIST", name: "Client Existent", phone: "+34600999999", email: "existent@x.cat", tax_id: null, archived_at: null }],
    crm_supplies: [], crm_leads: [], cap_submissions: [], cap_partners: [], cap_referral_links: [],
    tariff_versions: [{ id: "V1", product_id: "P1", version: 1, status: "activa", data: offer("V1", "Nufri", [0.16, 0.12, 0.08]) }, { id: "V2", product_id: "P2", version: 1, status: "activa", data: offer("V2", "Repsol", [0.17, 0.13, 0.09]) }],
    offers: [], fin_calculations: [], fin_ledger: [], fin_settlements: [],
  };
}

describe("1-4 · 8-9 · Formulari → lead a Supabase amb factura privada, tasca i assignació", () => {
  beforeEach(() => { state.sb = fakeSupabase(seed()); state.reader = async () => ({ data: invoice20(), warnings: [], method: "text", pages: 1 }); });

  it("crea la sol·licitud, el lead, desa la factura al bucket privat i registra consentiments, origen i conversió", async () => {
    const { submit } = await import("@/server/capture");
    const r = await submit({ fields: form(), file: { bytes: PDF, name: "factura setembre.pdf" }, ip: "81.0.0.1" });
    expect(r).toMatchObject({ ok: true, status: "lead_creat" });
    const db = state.sb.db;
    expect(db.cap_submissions[0]).toMatchObject({ channel: "factura", status: "lead_creat", phone: "+34600111222", ip_hash: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(JSON.stringify(db.cap_submissions[0])).not.toContain("81.0.0.1"); // cap IP en clar
    const lead = db.crm_leads[0];
    expect(lead).toMatchObject({ name: "Marta Puig", capture_channel: "factura", status: "nou", kind: "particular", services: ["llum_residencial"], owner_id: C1, capture_submission_id: r.submissionId });
    const doc = db.cap_lead_documents[0];
    expect(doc).toMatchObject({ lead_id: lead.id, kind: "factura", mime: "application/pdf", original_name: "factura-setembre.pdf", status: "rebut" });
    expect([...state.sb.files.keys()]).toEqual([`lead-documents/${doc.storage_path}`]);
    expect(db.cap_consents.map((c) => [c.kind, c.granted, c.lead_id])).toEqual([["privacitat_servei", true, lead.id], ["comercial", false, lead.id], ["whatsapp", false, lead.id]]);
    expect(db.cap_conversion_events.map((e) => e.kind)).toEqual(["lead", "lead_valid"]);
    // 8 · tasca de primer contacte i avís al responsable; 9 · historial d'assignació
    expect(db.crm_tasks).toEqual([expect.objectContaining({ lead_id: lead.id, assigned_to: C1, kind: "trucada", source: "automatica", rule_key: `cap:lead:${lead.id}` })]);
    expect(db.crm_notifications).toEqual([expect.objectContaining({ user_id: C1, title: "Nou lead: Marta Puig", link: { view: "captacio-lead", params: { id: lead.id } } })]);
    expect(db.cap_assignments).toEqual([expect.objectContaining({ lead_id: lead.id, user_id: C1, rule_id: "R1", method: "regla" })]);
  });

  it("18 · reenviaments: mateixa clau → mateixa sol·licitud; mateixa persona i factura en 24 h → sense lead nou", async () => {
    const { submit } = await import("@/server/capture");
    const f = form();
    const a = await submit({ fields: f, file: { bytes: PDF, name: "f.pdf" }, ip: "81.0.0.2" });
    const b = await submit({ fields: f, file: { bytes: PDF, name: "f.pdf" }, ip: "81.0.0.2" });
    expect(b).toMatchObject({ ok: true, duplicate: true, submissionId: a.submissionId });
    const c = await submit({ fields: form(), file: { bytes: PDF, name: "f.pdf" }, ip: "81.0.0.3" });
    expect(c.status).toBe("duplicat");
    expect(state.sb.db.crm_leads).toHaveLength(1);
    expect(state.sb.db.crm_activities.some((x) => /mateixa sol·licitud/.test(String(x.title)))).toBe(true);
    const d = await submit({ fields: form(), file: { bytes: PDF2, name: "altra.pdf" }, ip: "81.0.0.4" }); // factura diferent → lead nou, marcat com a possible duplicat
    expect(d.status).toBe("lead_creat");
    expect(state.sb.db.crm_leads[1]).toMatchObject({ duplicate_status: "possible_duplicat" });
  });

  it("5 · coincidència amb un client existent: lead nou marcat com a possible duplicat (sense fusionar)", async () => {
    const { submit } = await import("@/server/capture");
    await submit({ fields: form({ phone: "600 999 999", email: "altre@x.cat" }), file: null, ip: "81.0.0.5" });
    const lead = state.sb.db.crm_leads[0];
    expect(lead.duplicate_status).toBe("possible_duplicat");
    expect(lead.duplicate_refs).toEqual([expect.objectContaining({ kind: "client", id: "CLI-EXIST", by: ["telefon"], strength: "feble" })]);
    expect(state.sb.db.crm_clients).toHaveLength(1);
  });

  it("antispam (resposta neutra, sense lead), límit de peticions i fitxers maliciosos", async () => {
    const { submit } = await import("@/server/capture");
    const spam = await submit({ fields: form({ website: "http://bot" }), file: null, ip: "81.0.0.6" });
    expect(spam).toMatchObject({ ok: true, status: "rebutjada" });
    expect(state.sb.db.crm_leads).toHaveLength(0);
    for (let i = 0; i < 4; i++) await submit({ fields: form({ phone: `600 000 00${i}`, email: `p${i}@x.cat` }), file: null, ip: "81.0.0.6" });
    await expect(submit({ fields: form({ phone: "611 000 000", email: "z@x.cat" }), file: null, ip: "81.0.0.6" })).rejects.toThrow(/Massa enviaments/);
    const bad = await submit({ fields: form(), file: { bytes: new TextEncoder().encode("%PDF-1.4 /OpenAction<</S/JavaScript/JS(x)>>"), name: "f.pdf" }, ip: "81.0.0.7" });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { file: expect.stringMatching(/no permesos/) } });
  });
});

describe("6-7 · 10 · Lectura de la factura i comparativa preliminar", () => {
  beforeEach(() => { state.sb = fakeSupabase(seed()); state.reader = async () => ({ data: invoice20(), warnings: [], method: "text", pages: 1 }); });

  it("llegeix en segon pla, valida, actualitza el lead (CUPS/NIF), calcula la comparativa i genera el PDF en esborrany", async () => {
    const { submit, readDocument, preliminaryProposal } = await import("@/server/capture");
    const r = await submit({ fields: form(), file: { bytes: PDF, name: "f.pdf" }, ip: "82.0.0.1" });
    expect(await readDocument(r.documentId!)).toEqual({ status: "llegida" });
    const rd = state.sb.db.cap_invoice_readings[0];
    expect(rd).toMatchObject({ status: "llegida", sufficient: true, method: "text" });
    expect((rd.fields as { key: string; value: unknown }[]).find((f) => f.key === "cups")!.value).toBe(CUPS_OK);
    const pre = rd.preliminary as { ok: boolean; alternatives: { supplier: string; saving: number | null }[]; hypotheses: string[] };
    expect(pre.ok).toBe(true);
    expect(pre.alternatives.map((a) => a.supplier)).toEqual(["Nufri", "Repsol"]);
    expect(pre.alternatives[0].saving).toBeGreaterThan(0);
    expect(pre.hypotheses[0]).toMatch(/anualitzat/);
    expect(state.sb.db.comparisons[0]).toMatchObject({ mode: "factura", status: "esborrany", id: rd.comparison_id });
    expect(state.sb.db.crm_leads[0]).toMatchObject({ cups: CUPS_OK, tax_id: "12345678Z" });
    expect(state.sb.db.crm_notifications.some((x) => /Factura llegida/.test(String(x.title)))).toBe(true);
    const p = await preliminaryProposal(user(C1, "comercial"), rd.id as string);
    expect(p.reference).toMatch(/^PRE-\d{8}-/);
    const pdf = state.sb.db.cap_lead_documents.find((d) => d.kind === "proposta_preliminar")!;
    expect(pdf).toMatchObject({ lead_id: state.sb.db.crm_leads[0].id, mime: "application/pdf" });
    expect(String(pdf.original_name)).toMatch(/esborrany\.pdf$/);
    const { extractText } = await import("unpdf");
    const t = ((await extractText(state.sb.files.get(`lead-documents/${pdf.storage_path}`)!.bytes, { mergePages: true })).text as string).replace(/\s+/g, " ");
    expect(t).toContain("ESBORRANY");
    expect(t).toContain("PRELIMINAR");
    expect(t).toContain("vàlida fins al");
    expect(t).toContain("3.532 kWh"); // consum anualitzat (hipòtesi explícita)
    expect(state.sb.db.comparison_deliveries ?? []).toHaveLength(0); // no s'envia
  });

  it("dades dubtoses: lectura «per revisar», tasca de revisió i proposta bloquejada fins a la revisió humana", async () => {
    state.reader = async () => ({ data: invoice20({ kw: [field(4.6, 1, true, "ia"), field(4.6), ...Array.from({ length: 4 }, () => field(null))] }), warnings: ["Imatge: cal lectura visual (OCR)."], method: "ia", pages: 1 });
    const { submit, readDocument, preliminaryProposal, reviewReading } = await import("@/server/capture");
    const r = await submit({ fields: form(), file: { bytes: PDF, name: "f.pdf" }, ip: "82.0.0.2" });
    expect(await readDocument(r.documentId!)).toEqual({ status: "per_revisar" });
    const rd = state.sb.db.cap_invoice_readings[0];
    expect(state.sb.db.crm_tasks.some((t) => String(t.rule_key) === `cap:revisio:${rd.id}`)).toBe(true);
    await expect(preliminaryProposal(user(C1, "comercial"), rd.id as string)).rejects.toThrow(/revisa aquestes dades dubtoses: Potència contractada P1/);
    await expect(reviewReading(user(K, "colaborador"), rd.id as string, { "kw.P1": 4.6 })).rejects.toThrow(/Només l'equip comercial/);
    expect(await reviewReading(user(C1, "comercial"), rd.id as string, { "kw.P1": 4.6 })).toMatchObject({ status: "revisada" });
    expect(state.sb.db.cap_invoice_readings[0]).toMatchObject({ status: "revisada", reviewed_by: C1 });
    await expect(preliminaryProposal(user(C1, "comercial"), rd.id as string)).resolves.toMatchObject({ reference: expect.any(String) });
  });

  it("si falla la lectura (IA), el lead i la factura es conserven i es pot reintentar", async () => {
    state.reader = async () => { throw new Error("Proveïdor d'IA: 529"); };
    const { submit, readDocument, processPendingCapture } = await import("@/server/capture");
    const r = await submit({ fields: form(), file: { bytes: PDF, name: "f.pdf" }, ip: "82.0.0.3" });
    expect(await readDocument(r.documentId!)).toEqual({ status: "error" });
    expect(state.sb.db.crm_leads).toHaveLength(1);
    expect(state.sb.db.cap_lead_documents[0].status).toBe("error");
    expect(state.sb.files.size).toBe(1);
    expect(state.sb.db.cap_invoice_readings[0]).toMatchObject({ status: "error", attempts: 1, error: expect.stringMatching(/529/) });
    state.reader = async () => ({ data: invoice20(), warnings: [], method: "text", pages: 1 });
    state.sb.db.cap_lead_documents[0].created_at = new Date(Date.now() - 10 * 60_000).toISOString();
    const out = await processPendingCapture();
    expect(out).toMatchObject({ readings: 1 });
    expect(state.sb.db.cap_invoice_readings[0]).toMatchObject({ status: "llegida", attempts: 2 });
  });
});

describe("11-14 · Col·laboradors, referències, atribució i portal", () => {
  beforeEach(() => { state.sb = fakeSupabase(seed()); });

  it("alta de col·laborador (només Direcció) amb accés al portal, codi i dades fiscals", async () => {
    const { createPartner } = await import("@/server/partners");
    await expect(createPartner(user(C1, "comercial"), { name: "X", kind: "altres" }, "https://a30")).rejects.toThrow(/Només Direcció/);
    const r = await createPartner(user(A, "admin"), { name: "Pau Electricista", company: "Electricitat Pau SL", kind: "electricista", email: "pau@x.cat", invite: true, code: "PAU1234", tax_id: "12345678Z" }, "https://a30");
    expect(r).toMatchObject({ code: "PAU1234", invited: true });
    // l'enllaç apunta a la pàgina /acces del CRM (mai a localhost ni a supabase.co) i, sense correu configurat, es retorna per copiar-lo
    expect(r.link).toMatch(/^https:\/\/a30\/acces\?t=hash_invite_[a-f0-9]+&k=i&next=%2Fcollaboradors$/);
    expect(r).toMatchObject({ emailSent: false });
    expect(state.sb.db.cap_partners[0]).toMatchObject({ user_id: r.userId, status: "actiu", kind: "electricista" });
    expect(state.sb.db.profiles.find((p) => p.id === r.userId)).toMatchObject({ role: "colaborador" });
    expect(state.sb.db.fin_collaborator_terms[0]).toMatchObject({ user_id: r.userId, tax_id: "12345678Z" });
    expect(state.sb.db.cap_referral_links[0]).toMatchObject({ code: "PAU1234", partner_id: r.id });
    const again = await createPartner(user(A, "admin"), { name: "Pau 2", kind: "altres", code: "PAU1234" }, "https://a30");
    expect(again.code).not.toBe("PAU1234"); // codi únic
  });

  it("captació per enllaç de referència: atribució vigent; un segon col·laborador queda en disputa; un codi fals no atribueix res", async () => {
    const { createPartner } = await import("@/server/partners");
    const { submit } = await import("@/server/capture");
    const p1 = await createPartner(user(A, "admin"), { name: "Pau", kind: "electricista", code: "PAU1234" }, "");
    const p2 = await createPartner(user(A, "admin"), { name: "Gestoria Segrià", kind: "gestoria", code: "SEGRIA01" }, "");
    const a = await submit({ fields: form({ ref: "pau1234" }), file: null, ip: "83.0.0.1" });
    expect(state.sb.db.cap_submissions.find((s) => s.id === a.submissionId)).toMatchObject({ channel: "recomanacio", partner_id: p1.id, ref_code: "PAU1234" });
    expect(state.sb.db.cap_attributions).toEqual([expect.objectContaining({ partner_id: p1.id, status: "vigent", source: "enllac" })]);
    await submit({ fields: form({ ref: "SEGRIA01" }), file: { bytes: PDF2, name: "g.pdf" }, ip: "83.0.0.2" }); // mateixa persona (telèfon/correu)
    expect(state.sb.db.cap_attributions.map((x) => [x.partner_id, x.status])).toEqual([[p1.id, "vigent"], [p2.id, "en_disputa"]]);
    await submit({ fields: form({ ref: "FALS9999", phone: "622 222 222", email: "nou@x.cat" }), file: null, ip: "83.0.0.3" });
    expect(state.sb.db.cap_submissions.at(-1)).toMatchObject({ partner_id: null, channel: "formulari" });
    expect(state.sb.db.cap_attributions).toHaveLength(2);
  });

  it("el col·laborador aporta un lead des del portal i només veu les seves operacions i comissions", async () => {
    const { createPartner, portalData } = await import("@/server/partners");
    const { submit } = await import("@/server/capture");
    const p = await createPartner(user(A, "admin"), { name: "Pau", kind: "electricista", code: "PAU1234" }, "");
    state.sb.db.cap_partners[0].user_id = K;
    const r = await submit({ fields: form({ phone: "633 333 333", email: "client@pau.cat" }), file: { bytes: PDF, name: "f.pdf" }, ip: "portal", by: user(K, "colaborador"), forcedChannel: "collaborador" });
    expect(r.status).toBe("lead_creat");
    expect(state.sb.db.cap_attributions[0]).toMatchObject({ partner_id: p.id, source: "portal", status: "vigent" });
    // (el trigger de la base de dades porta el col·laborador al lead; aquí ho simulem)
    state.sb.db.crm_leads[0].collaborator_id = K;
    state.sb.db.crm_leads.push({ id: "ALIE", name: "Lead d'un altre", collaborator_id: "un-altre", status: "nou" });
    state.sb.db.fin_settlements.push({ id: "S1", code: "LIQ-2026-0001", status: "aprovada", kind: "collaborador", beneficiary_id: K, period_from: "2026-10-01", period_to: "2026-10-31", total_gross: "120.00", approved_amount: "120.00", paid_amount: "20.00" }, { id: "S2", code: "LIQ-2026-0002", status: "aprovada", kind: "collaborador", beneficiary_id: "un-altre", period_from: "2026-10-01", period_to: "2026-10-31", total_gross: "999.00", approved_amount: "999.00", paid_amount: "0" });
    const d = await portalData(user(K, "colaborador"));
    expect(d.leads.map((l) => l.name)).toEqual(["Marta Puig"]);
    expect(d.kpis).toMatchObject({ leadsPending: 1, commissionsSettled: 120, paymentsPending: 100 });
    expect(d.settlements.map((s) => s.code)).toEqual(["LIQ-2026-0001"]);
    expect(JSON.stringify(d)).not.toMatch(/marge|margin|proveidor/i);
    await expect(portalData(user(C1, "comercial"))).rejects.toThrow(/El portal és per a col·laboradors/);
  });
});

describe("16 · Webhooks (Meta Lead Ads i WhatsApp) amb signatura verificada", () => {
  beforeEach(() => { state.sb = fakeSupabase(seed()); });
  const sign = (b: string) => `sha256=${createHmac("sha256", "meta-secret").update(b).digest("hex")}`;

  it("Meta: signatura incorrecta → 401; correcta sense token de pàgina → pendent de credencials; repetit → idempotent", async () => {
    const { metaLeadgenWebhook, verifyChallenge } = await import("@/server/marketing");
    const body = JSON.stringify({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "LG1", ad_id: "AD1", form_id: "F1" } }] }] });
    await expect(metaLeadgenWebhook(body, "sha256=00")).rejects.toThrow(/Signatura no vàlida/);
    expect(await metaLeadgenWebhook(body, sign(body))).toEqual({ received: 1, results: ["pendent_credencials"] });
    expect(await metaLeadgenWebhook(body, sign(body))).toEqual({ received: 1, results: ["duplicat"] });
    expect(state.sb.db.cap_webhook_events).toEqual([expect.objectContaining({ provider: "meta_leadgen", external_id: "LG1", signature_ok: true, status: "pendent_credencials" })]);
    expect(state.sb.db.crm_leads).toHaveLength(0); // no s'inventa cap lead sense les dades reals
    expect(verifyChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" }))).toBe("42");
    expect(verifyChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "no", "hub.challenge": "42" }))).toBeNull();
  });

  it("WhatsApp: «lliurat» només amb el webhook; missatge entrant d'un número nou → lead", async () => {
    state.sb.db.cap_whatsapp_messages = [{ id: "M1", wa_message_id: "wamid.A", phone: "+34600111222", direction: "sortint", status: "acceptat" }];
    const { whatsappWebhook } = await import("@/server/marketing");
    const st = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.A", status: "delivered", timestamp: "1793000000" }] } }] }] });
    await expect(whatsappWebhook(st, null)).rejects.toThrow(/Signatura/);
    expect(await whatsappWebhook(st, sign(st))).toEqual({ statuses: 1, inbound: 0 });
    expect(state.sb.db.cap_whatsapp_messages[0].status).toBe("lliurat");
    expect(await whatsappWebhook(st, sign(st))).toEqual({ statuses: 0, inbound: 0 }); // idempotent
    const inb = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { contacts: [{ wa_id: "34655444333", profile: { name: "Joan" } }], messages: [{ id: "wamid.IN1", from: "34655444333", type: "text", text: { body: "Hola, voldria revisar la factura" } }] } }] }] });
    expect(await whatsappWebhook(inb, sign(inb))).toEqual({ statuses: 0, inbound: 1 });
    expect(state.sb.db.crm_leads[0]).toMatchObject({ name: "Joan", phone: "+34655444333", capture_channel: "whatsapp" });
    expect(state.sb.db.cap_whatsapp_messages.at(-1)).toMatchObject({ direction: "entrant", status: "rebut", lead_id: state.sb.db.crm_leads[0].id });
  });

  it("enviament de WhatsApp sense credencials: no s'envia ni es registra com a enviat", async () => {
    const { sendWhatsapp } = await import("@/server/marketing");
    state.sb.db.crm_leads.push({ id: "L1", name: "Marta", phone: "+34600111222" });
    await expect(sendWhatsapp({ sb: fakeSupabase({ crm_leads: [{ id: "00000000-0000-4000-8000-000000000001", name: "Marta", phone: "+34600111222" }] }, { crm_can_edit_lead: () => true }), user: { id: C1 }, profile: { role: "comercial", name: "C1" } } as never, { leadId: "00000000-0000-4000-8000-000000000001", text: "Hola" })).rejects.toThrow(/no està configurat/);
    expect(state.sb.db.cap_whatsapp_messages ?? []).toHaveLength(0);
  });
});

describe("19 · Integració amb el CRM existent", () => {
  beforeEach(() => { state.sb = fakeSupabase(seed()); state.reader = async () => ({ data: invoice20(), warnings: [], method: "text", pages: 1 }); });

  it("en convertir el lead: la factura es copia a la fitxa del client i la comparativa s'hi vincula", async () => {
    const { submit, readDocument, onLeadConverted } = await import("@/server/capture");
    const r = await submit({ fields: form(), file: { bytes: PDF, name: "f.pdf" }, ip: "84.0.0.1" });
    await readDocument(r.documentId!);
    const leadId = state.sb.db.crm_leads[0].id as string;
    expect(await onLeadConverted(leadId, "CLI-EXIST")).toEqual({ documents: 1 });
    expect(state.sb.db.crm_documents[0]).toMatchObject({ client_id: "CLI-EXIST", category: "factura_llum", mime: "application/pdf" });
    expect([...state.sb.files.keys()].some((k) => k.startsWith("crm-documents/CLI-EXIST/"))).toBe(true);
    expect(state.sb.db.cap_lead_documents[0].client_document_id).toBe(state.sb.db.crm_documents[0].id);
    expect(state.sb.db.comparisons[0].crm_client_id).toBe("CLI-EXIST");
    expect(await onLeadConverted(leadId, "CLI-EXIST")).toEqual({ documents: 0 }); // no es duplica
  });

  it("automatitzacions: lead sense assignar → avís a Direcció (una sola vegada per lead)", async () => {
    const { captureAutomations } = await import("@/server/marketing");
    state.sb.db.crm_leads.push({ id: "LX", name: "Sense responsable", capture_channel: "web", owner_id: null, status: "nou", created_at: new Date(Date.now() - 5 * 3600_000).toISOString() });
    const notes = await captureAutomations(state.sb as never, new Date(), [{ key: "cap_lead_sense_assignar", enabled: true, params: { hours: 2 } }], [A]);
    expect(notes).toEqual([expect.objectContaining({ user_id: A, rule_key: "cap:sense_assignar:LX" })]);
  });

  it("panell de captació: embut per canal amb dades reals; sense costos importats, el cost no està disponible", async () => {
    const { submit } = await import("@/server/capture");
    const { captureDashboard, integrationStatus } = await import("@/server/marketing");
    await submit({ fields: form(), file: { bytes: PDF, name: "f.pdf" }, ip: "85.0.0.1" });
    await submit({ fields: form({ phone: "644 444 444", email: "b@x.cat", utm: { source: "google", campaign: "llum-pimes" }, gclid: "abc" }), file: null, ip: "85.0.0.2" });
    state.sb.db.cap_visits = [{ event: "visita", session_hash: "s1", created_at: new Date().toISOString() }, { event: "visita", session_hash: "s2", created_at: new Date().toISOString() }, { event: "formulari_iniciat", session_hash: "s1", created_at: new Date().toISOString() }];
    await expect(captureDashboard(user(C1, "comercial"), {})).rejects.toThrow(/equip d'administració/);
    const d = await captureDashboard(user(A, "admin"), {}) as { kpis: { key: string; value: number | null; status: string }[]; byChannel: { channel: string; leads: number; costStatus: string }[] };
    const k = (key: string) => d.kpis.find((x) => x.key === key)!;
    expect([k("visites").value, k("iniciats").value, k("enviats").value, k("factures").value, k("leads_valids").value]).toEqual([2, 1, 2, 1, 2]);
    expect(k("cost")).toMatchObject({ value: null, status: "no_disponible" });
    expect(d.byChannel.map((c) => [c.channel, c.leads, c.costStatus])).toEqual([["factura", 1, "sense_cost_directe"], ["google_ads", 1, "no_disponible"]]);
    const i = integrationStatus();
    expect(i.googleAds.ok).toBe(false);
    expect(i.googleAds.note).toMatch(/Pendent de credencials/);
    expect(i.whatsapp.ok).toBe(false);
  });
});
