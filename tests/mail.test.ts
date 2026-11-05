import { describe, expect, it } from "vitest";
import { open, seal } from "@/server/secret-box";
import { explainSmtpError, fromHeader, mailSettingsInput, replyToFor } from "@/core/mail";

const KEY = "clau-de-servei-de-prova-prou-llarga";
const ok = { host: "smtp.ionos.es", port: 587, security: "starttls", username: "propostes@assessoria30.com", password: "x", fromEmail: "propostes@assessoria30.com" };

describe("xifrat de la contrasenya", () => {
  it("xifra i desxifra; cada xifrat és diferent", () => {
    const a = seal("contrasenya secreta", KEY, "mail");
    const b = seal("contrasenya secreta", KEY, "mail");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secreta");
    expect(open(a, KEY, "mail")).toBe("contrasenya secreta");
  });
  it("amb una altra clau, una altra finalitat o dades alterades retorna null (no un valor erroni)", () => {
    const a = seal("pwd", KEY, "mail");
    expect(open(a, `${KEY}-nova`, "mail")).toBeNull();
    expect(open(a, KEY, "altre")).toBeNull();
    const parts = a.split(":");
    parts[3] = Buffer.from("xxxx").toString("base64");
    expect(open(parts.join(":"), KEY, "mail")).toBeNull();
    expect(open("brossa", KEY, "mail")).toBeNull();
  });
  it("sense clau al servidor no xifra", () => {
    expect(() => seal("x", "", "mail")).toThrow(/clau/);
  });
});

describe("validació de la configuració del correu", () => {
  it("accepta una configuració normal i normalitza l'adreça", () => {
    const r = mailSettingsInput.safeParse({ ...ok, fromEmail: " Propostes@Assessoria30.com " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.fromEmail).toBe("propostes@assessoria30.com");
  });
  it("detecta port i seguretat incompatibles", () => {
    expect(mailSettingsInput.safeParse({ ...ok, security: "ssl", port: 587 }).success).toBe(false);
    expect(mailSettingsInput.safeParse({ ...ok, security: "starttls", port: 465 }).success).toBe(false);
    expect(mailSettingsInput.safeParse({ ...ok, security: "ssl", port: 465 }).success).toBe(true);
  });
  it("rebutja servidors amb protocol o espais i adreces no vàlides", () => {
    expect(mailSettingsInput.safeParse({ ...ok, host: "https://smtp.ionos.es" }).success).toBe(false);
    expect(mailSettingsInput.safeParse({ ...ok, fromEmail: "no-es-un-correu" }).success).toBe(false);
  });
  it("resposta a una adreça fixa: cal indicar-la", () => {
    expect(mailSettingsInput.safeParse({ ...ok, replyToMode: "fixa" }).success).toBe(false);
    expect(mailSettingsInput.safeParse({ ...ok, replyToMode: "fixa", replyTo: "comercial@assessoria30.com" }).success).toBe(true);
  });
});

describe("remitent i respostes", () => {
  it("From amb nom o sense", () => {
    expect(fromHeader({ fromName: "Assessoria 3.0", fromEmail: "a@b.com" })).toEqual({ name: "Assessoria 3.0", address: "a@b.com" });
    expect(fromHeader({ fromName: null, fromEmail: "a@b.com" })).toBe("a@b.com");
  });
  it("Reply-To segons el mode", () => {
    const user = { email: "joan@assessoria30.com", name: "Joan" };
    expect(replyToFor({ replyToMode: "usuari", replyTo: null }, user)).toEqual({ name: "Joan", address: "joan@assessoria30.com" });
    expect(replyToFor({ replyToMode: "remitent", replyTo: null }, user)).toBeUndefined();
    expect(replyToFor({ replyToMode: "fixa", replyTo: "c@b.com" }, user)).toBe("c@b.com");
  });
});

describe("missatges d'error de l'SMTP", () => {
  it("tradueix els errors habituals sense mostrar credencials", () => {
    expect(explainSmtpError({ code: "EAUTH", responseCode: 535, response: "535 Authentication credentials invalid" })).toMatch(/Usuari o contrasenya/);
    expect(explainSmtpError({ code: "EAUTH", response: "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant" })).toMatch(/Microsoft 365/);
    expect(explainSmtpError({ code: "ETIMEDOUT" })).toMatch(/connectar/);
    expect(explainSmtpError({ code: "EDNS", message: "getaddrinfo ENOTFOUND smtp.ionoss.es" })).toMatch(/no existeix/);
    expect(explainSmtpError({ code: "ESOCKET", message: "wrong version number" })).toMatch(/587 → STARTTLS/);
    expect(explainSmtpError({ code: "EENVELOPE", responseCode: 553 })).toMatch(/remitent/);
  });
});
