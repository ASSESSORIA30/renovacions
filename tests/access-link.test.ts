/**
 * Enllaços d'accés: es generen a Supabase sense correu, apunten a /acces del CRM i s'envien des del correu corporatiu.
 * (Provat amb simulació: no s'envia cap correu real ni es crida Supabase.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessEmail, accessUrl, appBase, parseAccessParams, safeNext } from "@/core/access-link";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state = { sb: fakeSupabase(), ready: true, sent: [] as { to: string; subject: string; text: string; html: string }[], fail: null as null | { code: string } };
vi.mock("@/server/supabase", () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError };
});
vi.mock("@/server/mailer", () => ({
  smtpReady: async () => state.ready,
  sendCorporateMail: async (m: { to: string; subject: string; text: string; html: string }) => { if (state.fail) throw state.fail; state.sent.push(m); return { accepted: [m.to] }; },
}));

describe("enllaç d'accés (lògica pura)", () => {
  it("només deixa redirigir a rutes internes", () => {
    expect(safeNext("/collaboradors")).toBe("/collaboradors");
    for (const bad of ["//dolent.com", "https://dolent.com", "/\\dolent.com", "", null]) expect(safeNext(bad)).toBe("/");
  });
  it("fa servir APP_URL si hi és i, si no, l'origen de la petició", () => {
    expect(appBase("https://crm.exemple.cat/", "http://localhost:3000")).toBe("https://crm.exemple.cat");
    expect(appBase("", "https://crm-exemple.vercel.app")).toBe("https://crm-exemple.vercel.app");
  });
  it("l'adreça es pot llegir a la pàgina /acces", () => {
    const u = accessUrl("https://crm.exemple.cat", "abc123def456", "recovery", "/collaboradors");
    expect(u).toBe("https://crm.exemple.cat/acces?t=abc123def456&k=r&next=%2Fcollaboradors");
    expect(parseAccessParams(new URL(u).search)).toEqual({ tokenHash: "abc123def456", kind: "recovery", next: "/collaboradors" });
    expect(parseAccessParams("?t=<script>")).toBeNull();
    expect(parseAccessParams("?t=abc123def456&k=m")?.kind).toBe("email");
  });
  it("el correu és en català, amb versió de text i sense HTML injectat", () => {
    const m = accessEmail({ name: "Pau <b>Prova</b>", url: "https://crm.exemple.cat/acces?t=x&k=i", portal: true, sender: "Direcció" });
    expect(m.subject).toBe("Accés al portal de col·laboradors d'Assessoria 3.0");
    expect(m.text).toContain("https://crm.exemple.cat/acces?t=x&k=i");
    expect(m.html).not.toContain("<b>Prova");
    expect(m.html).toContain("Crea la contrasenya");
  });
});

describe("enllaç d'accés (servidor, amb simulació)", () => {
  beforeEach(() => { state.sb = fakeSupabase({ auth_users: [{ id: "00000000-0000-0000-0000-0000000000b1", email: "collab@exemple.cat" }] }); state.ready = true; state.sent = []; state.fail = null; delete process.env.APP_URL; });

  it("envia l'enllaç des del correu corporatiu", async () => {
    const { issueAccessLink } = await import("@/server/access-link");
    const r = await issueAccessLink({ email: "collab@exemple.cat", name: "Col·laborador Prova", kind: "recovery", next: "/collaboradors", origin: "https://crm.exemple.cat", portal: true });
    expect(r).toMatchObject({ emailSent: true, emailError: null });
    expect(r.link.startsWith("https://crm.exemple.cat/acces?t=hash_recovery_")).toBe(true);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toBe("collab@exemple.cat");
    expect(state.sent[0].text).toContain(r.link);
  });
  it("sense correu configurat, o si falla, retorna l'enllaç per enviar-lo a mà", async () => {
    const { issueAccessLink } = await import("@/server/access-link");
    state.ready = false;
    const a = await issueAccessLink({ email: "collab@exemple.cat", kind: "recovery", next: "/", origin: "https://crm.exemple.cat", portal: true });
    expect(a.emailSent).toBe(false); expect(a.emailError).toMatch(/no està configurat/); expect(a.link).toContain("/acces?t=");
    state.ready = true; state.fail = { code: "EAUTH" };
    const b = await issueAccessLink({ email: "collab@exemple.cat", kind: "recovery", next: "/", origin: "https://crm.exemple.cat", portal: true });
    expect(b.emailSent).toBe(false); expect(b.emailError).toMatch(/contrasenya incorrectes/);
  });
  it("APP_URL té prioritat sobre l'origen de la petició", async () => {
    process.env.APP_URL = "https://crm.exemple.cat";
    const { issueAccessLink } = await import("@/server/access-link");
    const r = await issueAccessLink({ email: "nou@exemple.cat", kind: "invite", next: "/", origin: "http://localhost:3000", portal: false });
    expect(r.link.startsWith("https://crm.exemple.cat/acces?")).toBe(true);
    expect(r.userId).toBeTruthy();
    await expect(issueAccessLink({ email: "nou@exemple.cat", kind: "invite", next: "/", origin: "x", portal: false })).rejects.toThrow(/Ja existeix/);
  });
});
