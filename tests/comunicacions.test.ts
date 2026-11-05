/**
 * FASE 8 · Comunicacions per usuari (correu propi, WhatsApp), ressenyes i autoritzacions de dades — servidor amb un
 * client Supabase en memòria i un SMTP simulat. La RLS real d'aquestes taules és a tests/db/comunicacions-rls.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase>; smtp: { verify: () => Promise<unknown>; sendMail: (m: Record<string, unknown>) => Promise<{ accepted: string[]; messageId?: string }> }; sent: Record<string, unknown>[]; lastCfg: Record<string, unknown> | null } = {
  sb: fakeSupabase(), sent: [], lastCfg: null,
  smtp: { verify: async () => true, sendMail: async (m) => { state.sent.push(m); return { accepted: [String(m.to)], messageId: "<m1@test>" }; } },
};
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError };
});
vi.mock("@/server/mailer", () => ({ keyMaterial: () => "clau-de-proves-0123456789-abcdefghij", createTransport: (c: Record<string, unknown>) => { state.lastCfg = c; return state.smtp; } }));
vi.mock("@/server/env", () => ({ env: { waToken: "" } }));

import { clientComms, confirmRequestSent, myComms, registerRequest, revokeMailAccount, saveMailAccount, saveWhatsapp, sendClientEmail, sendClientWhatsapp, testMailAccount, updateDataRequest } from "@/server/comms";
import { DATA_MESSAGE, DATA_URL, REVIEW_MESSAGE, REVIEW_URL, contactAllowed, mailtoLink, waDigits, waLink } from "@/core/messages";

const PAT = "00000000-0000-0000-0000-0000000000c1", ALT = "00000000-0000-0000-0000-0000000000c2", COL = "00000000-0000-0000-0000-00000000000f";
const CLI = "00000000-0000-4000-8000-0000000000a1", OPT = "00000000-0000-4000-8000-0000000000a2", CAP = "00000000-0000-4000-8000-0000000000a3", DOC = "00000000-0000-4000-8000-0000000000d1", DOC2 = "00000000-0000-4000-8000-0000000000d2";
const NUM = "00000000-0000-4000-8000-0000000000b1";
const user = (id: string, role = "comercial") => ({ sb: state.sb, user: { id }, profile: { id, name: id === PAT ? "Patricia" : "Altre", email: `${id}@a30.com`, role } }) as never;

beforeEach(() => {
  state.sent = []; state.lastCfg = null;
  state.smtp = { verify: async () => true, sendMail: async (m) => { state.sent.push(m); return { accepted: [String(m.to)], messageId: "<m1@test>" }; } };
  state.sb = fakeSupabase({
    crm_clients: [
      { id: CLI, name: "Forn Pujol", email: "forn@example.com", phone: "+34 600 111 222", contact_preference: "qualsevol", commercial_opt_out: false },
      { id: OPT, name: "Baixa SL", email: "baixa@example.com", phone: "600333444", contact_preference: "qualsevol", commercial_opt_out: true },
      { id: CAP, name: "No molestar", email: "no@example.com", phone: "600555666", contact_preference: "cap", commercial_opt_out: false },
    ],
    crm_documents: [{ id: DOC, client_id: CLI, category: "proteccio_dades" }, { id: DOC2, client_id: OPT, category: "altres" }],
    wa_business_numbers: [{ id: NUM, phone_number_id: "1234567", display_phone: "+34973000001", label: "Comercial", active: true }],
    wa_number_access: [{ number_id: NUM, user_id: PAT }],
  });
});

const SMTP = { from_name: "Patricia", from_email: "patricia@assessoria30.com", host: "smtp.office365.com", port: 587, security: "starttls", username: "patricia@assessoria30.com", password: "Secret-App-Pass-1", signature: "Patricia · Assessoria 3.0" };

describe("Prova 18-19 · El meu perfil → Comunicacions → Email", () => {
  it("desa la configuració amb la credencial XIFRADA i mai no la retorna", async () => {
    const r = await saveMailAccount(user(PAT), SMTP);
    const row = state.sb.db.user_mail_accounts[0] as Record<string, string>;
    expect(row.password_enc).toBeTruthy();
    expect(row.password_enc).not.toContain("Secret-App-Pass-1");
    expect(JSON.stringify(r)).not.toContain("Secret-App-Pass-1");
    expect(JSON.stringify(r)).not.toContain(row.password_enc);
    expect(r.mail?.hasPassword).toBe(true);
    const mine = await myComms(user(PAT));
    expect(JSON.stringify(mine)).not.toMatch(/password_enc|Secret-App-Pass/);
  });
  it("cada usuari té el seu compte: un altre usuari no veu el de la Patricia", async () => {
    await saveMailAccount(user(PAT), SMTP);
    expect((await myComms(user(ALT))).mail).toBeNull();
  });
  it("deixar la contrasenya en blanc conserva la desada; sense cap credencial, error", async () => {
    await expect(saveMailAccount(user(PAT), { ...SMTP, password: "" })).rejects.toMatchObject({ status: 400 });
    await saveMailAccount(user(PAT), SMTP);
    const before = (state.sb.db.user_mail_accounts[0] as Record<string, string>).password_enc;
    await saveMailAccount(user(PAT), { ...SMTP, password: "", from_name: "Patricia R." });
    expect((state.sb.db.user_mail_accounts[0] as Record<string, string>).password_enc).toBe(before);
  });
  it("prova de connexió: desxifra al servidor, verifica i desa el resultat", async () => {
    await saveMailAccount(user(PAT), SMTP);
    expect((await testMailAccount(user(PAT))).ok).toBe(true);
    expect(state.lastCfg).toMatchObject({ host: "smtp.office365.com", password: "Secret-App-Pass-1" });
    state.smtp.verify = async () => { throw Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 }); };
    const r = await testMailAccount(user(PAT));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect((state.sb.db.user_mail_accounts[0] as Record<string, unknown>).last_test_ok).toBe(false);
  });
  it("revocar esborra la credencial i impedeix enviar", async () => {
    await saveMailAccount(user(PAT), SMTP);
    await revokeMailAccount(user(PAT));
    expect((state.sb.db.user_mail_accounts[0] as Record<string, unknown>).password_enc).toBeNull();
    await expect(sendClientEmail(user(PAT), { clientId: CLI, to: "forn@example.com", subject: "Hola", body: "Text", kind: "proposta" })).rejects.toMatchObject({ status: 400 });
  });
  it("OAuth preparat però no simulat", async () => {
    await expect(saveMailAccount(user(PAT), { ...SMTP, provider: "google_oauth" })).rejects.toMatchObject({ status: 400 });
  });
  it("el col·laborador no té comunicacions internes", async () => {
    await expect(myComms(user(COL, "colaborador"))).rejects.toMatchObject({ status: 403 });
  });
});

describe("Proves 20-21 · Enviament de correu des de la fitxa", () => {
  it("s'envia des del compte propi de l'usuari (remitent visible) i només es marca «enviat» si l'SMTP l'accepta", async () => {
    await saveMailAccount(user(PAT), SMTP);
    const r = await sendClientEmail(user(PAT), { clientId: CLI, to: "forn@example.com", subject: "Proposta", body: "Adjuntem la proposta.", kind: "proposta" });
    expect(r.from).toBe("patricia@assessoria30.com");
    expect(state.sent[0]).toMatchObject({ from: { name: "Patricia", address: "patricia@assessoria30.com" }, to: "forn@example.com" });
    expect(String(state.sent[0].text)).toContain("Patricia · Assessoria 3.0");
    const act = state.sb.db.crm_activities.at(-1) as Record<string, unknown>;
    expect(act).toMatchObject({ type: "email", delivery: "enviat" });
  });
  it("si l'SMTP rebutja el destinatari NO es registra com a enviat", async () => {
    await saveMailAccount(user(PAT), SMTP);
    state.smtp.sendMail = async () => ({ accepted: [] });
    await expect(sendClientEmail(user(PAT), { clientId: CLI, to: "forn@example.com", subject: "Recordatori", body: "Text", kind: "recordatori" })).rejects.toMatchObject({ status: 502 });
    const acts = state.sb.db.crm_activities as Record<string, unknown>[];
    expect(acts.every((a) => a.delivery !== "enviat")).toBe(true);
    expect(acts.at(-1)).toMatchObject({ delivery: "error" });
  });
  it("si l'SMTP falla tampoc no consta com a enviat (ni la sol·licitud de ressenya)", async () => {
    await saveMailAccount(user(PAT), SMTP);
    state.smtp.sendMail = async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNECTION" }); };
    await expect(sendClientEmail(user(PAT), { clientId: CLI, to: "forn@example.com", subject: "Ressenya", body: REVIEW_MESSAGE.ca, kind: "ressenya" })).rejects.toMatchObject({ status: 502 });
    expect(state.sb.db.client_requests ?? []).toHaveLength(0);
  });
  it("ressenya per correu acceptat → sol·licitud «enviada» amb canal email", async () => {
    await saveMailAccount(user(PAT), SMTP);
    await sendClientEmail(user(PAT), { clientId: CLI, to: "forn@example.com", subject: "Ressenya", body: REVIEW_MESSAGE.ca, kind: "ressenya" });
    expect(state.sb.db.client_requests[0]).toMatchObject({ kind: "ressenya", channel: "email", status: "enviada", delivery: "enviat", requested_by: PAT });
  });
});

describe("Proves 22-23 · WhatsApp per usuari", () => {
  it("mode enllaç: número propi validat i normalitzat", async () => {
    await saveWhatsapp(user(PAT), { mode: "enllac", phone: "+34 600 000 001", display_name: "Patricia" });
    expect(state.sb.db.user_whatsapp[0]).toMatchObject({ phone_e164: "+34600000001", mode: "enllac" });
    await expect(saveWhatsapp(user(PAT), { mode: "enllac", phone: "123" })).rejects.toMatchObject({ status: 400 });
  });
  it("mode Cloud API: només amb un número empresarial autoritzat", async () => {
    await expect(saveWhatsapp(user(ALT), { mode: "cloud", default_number_id: NUM })).rejects.toMatchObject({ status: 403 });
    await saveWhatsapp(user(PAT), { mode: "cloud", default_number_id: NUM });
    expect(state.sb.db.user_whatsapp[0]).toMatchObject({ mode: "cloud", default_number_id: NUM });
  });
  it("enviament Cloud sense WHATSAPP_TOKEN → pendent de configuració (no se simula)", async () => {
    await saveWhatsapp(user(PAT), { mode: "cloud", default_number_id: NUM });
    state.sb.db.wa_number_access[0] = { number_id: NUM, user_id: PAT, wa_business_numbers: { phone_number_id: "1234567", active: true } };
    await expect(sendClientWhatsapp(user(PAT), { clientId: CLI, to: "+34600111222", body: "Hola", kind: "lliure" })).rejects.toMatchObject({ status: 503 });
    expect((state.sb.db.crm_activities ?? []).length).toBe(0);
  });
  it("enllaç wa.me amb el text preparat i el telèfon del client", () => {
    expect(waDigits("600 111 222")).toBe("34600111222");
    expect(waDigits("+34 600-111-222")).toBe("34600111222");
    expect(waDigits("12")).toBeNull();
    const l = waLink("+34 600 111 222", "Hola Forn & co")!;
    expect(l).toMatch(/^https:\/\/wa\.me\/34600111222\?text=/);
    expect(decodeURIComponent(l.split("text=")[1])).toBe("Hola Forn & co");
    expect(mailtoLink("a@b.com", "Assumpte", "Cos")).toMatch(/^mailto:a@b\.com\?subject=Assumpte&body=Cos$/);
  });
});

describe("Proves 24-28 · Sol·licitar ressenya", () => {
  it("missatges exactes en català i castellà amb l'enllaç de Google", () => {
    expect(REVIEW_URL).toBe("https://g.page/r/CeQVI7cNNDvREBM/review");
    for (const l of ["ca", "es"] as const) expect(REVIEW_MESSAGE[l]).toContain(REVIEW_URL);
    expect(REVIEW_MESSAGE.ca).toMatch(/Assessoria 3\.0/);
    expect(REVIEW_MESSAGE.es).not.toBe(REVIEW_MESSAGE.ca);
  });
  it("obrir WhatsApp registra un «intent» (preparada); «L'he enviat» la passa a enviada; mai «publicada»", async () => {
    const r = await registerRequest(user(PAT), { clientId: CLI, kind: "ressenya", language: "ca", channel: "whatsapp", recipient: "+34600111222", message: REVIEW_MESSAGE.ca });
    expect(r.status).toBe("preparada");
    expect(state.sb.db.crm_activities[0]).toMatchObject({ type: "whatsapp", delivery: "intent" });
    await confirmRequestSent(user(PAT), r.id);
    expect(state.sb.db.client_requests[0]).toMatchObject({ status: "enviada", delivery: "registrat" });
    const c = await clientComms(user(PAT), CLI);
    expect(c.review.status).toBe("enviada");
    expect(c.requests).toHaveLength(1); // (la data la posa la base de dades: default now())
  });
  it("respecta les preferències: baixa comercial o «no contactar» → bloquejat", async () => {
    await expect(registerRequest(user(PAT), { clientId: OPT, kind: "ressenya", language: "ca", channel: "whatsapp" })).rejects.toMatchObject({ status: 409 });
    await expect(registerRequest(user(PAT), { clientId: CAP, kind: "ressenya", language: "ca", channel: "email" })).rejects.toMatchObject({ status: 409 });
    expect(contactAllowed("telefon", false, "whatsapp", "comercial")).toMatchObject({ ok: true, warning: expect.stringMatching(/telefon/) });
  });
  it("copiar el missatge també queda registrat (canal «copiat», sense afirmar cap enviament)", async () => {
    const r = await registerRequest(user(PAT), { clientId: CLI, kind: "ressenya", language: "es", channel: "copiat", message: REVIEW_MESSAGE.es }, "registrat");
    expect(r.status).toBe("enviada");
    expect(state.sb.db.crm_activities[0]).toMatchObject({ type: "nota", delivery: null });
  });
  it("recordatori opcional: crea una tasca de seguiment", async () => {
    await registerRequest(user(PAT), { clientId: CLI, kind: "ressenya", language: "ca", channel: "copiat", reminderDays: 7 });
    expect(state.sb.db.crm_tasks[0]).toMatchObject({ client_id: CLI, assigned_to: PAT, kind: "seguiment" });
  });
});

describe("Proves 29-33 · Sol·licitar autorització de dades", () => {
  it("missatges amb l'enllaç del formulari de fdigital.es", () => {
    expect(DATA_URL).toBe("https://www.fdigital.es/assessoria30/");
    for (const l of ["ca", "es"] as const) expect(DATA_MESSAGE[l]).toContain(DATA_URL);
  });
  it("enviar l'enllaç deixa l'estat «sol·licitada» (mai signada) amb la base legal", async () => {
    const r = await registerRequest(user(PAT), { clientId: CLI, kind: "proteccio_dades", language: "ca", channel: "whatsapp", legal_basis: "execucio_contracte" });
    expect(r.status).toBe("sollicitada");
    expect(state.sb.db.client_requests[0]).toMatchObject({ legal_basis: "execucio_contracte" });
    expect((await clientComms(user(PAT), CLI)).dataProtection.status).toBe("sollicitada");
  });
  it("les autoritzacions de dades no són comunicacions comercials: s'admeten amb baixa comercial", async () => {
    await expect(registerRequest(user(PAT), { clientId: OPT, kind: "proteccio_dades", language: "ca", channel: "email" })).resolves.toMatchObject({ status: "sollicitada" });
  });
  it("«completada» exigeix evidència o nota; l'evidència ha de ser del mateix client; queda qui la confirma", async () => {
    const { id } = await registerRequest(user(PAT), { clientId: CLI, kind: "proteccio_dades", language: "ca", channel: "manual" });
    await expect(updateDataRequest(user(PAT), id, { status: "completada" })).rejects.toMatchObject({ status: 400 });
    await expect(updateDataRequest(user(PAT), id, { status: "completada", evidence_document_id: DOC2 })).rejects.toMatchObject({ status: 400 });
    await updateDataRequest(user(PAT), id, { status: "completada", evidence_document_id: DOC });
    expect(state.sb.db.client_requests[0]).toMatchObject({ status: "completada", confirmed_by: PAT, evidence_document_id: DOC });
    expect((state.sb.db.crm_activities as Record<string, unknown>[]).some((a) => a.type === "canvi" && /completada/.test(String(a.title)))).toBe(true);
  });
  it("estats rebutjada i caducada", async () => {
    const { id } = await registerRequest(user(PAT), { clientId: CLI, kind: "proteccio_dades", language: "es", channel: "manual" });
    await updateDataRequest(user(PAT), id, { status: "rebutjada", note: "Ha dit que no per telèfon" });
    expect(state.sb.db.client_requests[0]).toMatchObject({ status: "rebutjada" });
    await updateDataRequest(user(PAT), id, { status: "caducada", expires_at: "2026-10-01" });
    expect(state.sb.db.client_requests[0]).toMatchObject({ status: "caducada", expires_at: "2026-10-01" });
  });
});
