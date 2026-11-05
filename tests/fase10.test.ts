/**
 * Fase 10 · correccions, comercialitzadores, recordatoris, SIPS i calendaris externs.
 * TOT AMB SIMULACIÓ: Supabase en memòria i respostes de Google/Microsoft/SIPS inventades (fetch simulat).
 * Cap credencial ni dada real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: (f: unknown) => f, requireUser: vi.fn() };
});
vi.mock("@/server/mailer", () => ({ keyMaterial: () => "clau-de-proves-0123456789-abcdefghij" }));

import { formatUnitValue, humanizeUnits } from "@/core/units";
import { checkPassword } from "@/core/password";
import { listQuery } from "@/core/crm";
import { markContradictions, type ExtractedTerm } from "@/core/retailers";

describe("1.4 · unitats de les comissions", () => {
  it("mostra €/MWh, €/kWh, €/contracte i % (no «eur_mwh» ni euros sols)", () => {
    expect(formatUnitValue(8, "eur_mwh")).toBe("8 €/MWh");
    expect(formatUnitValue(0.008, "eur_kwh")).toBe("0,008 €/kWh");
    expect(formatUnitValue(50, "eur_contracte")).toBe("50 €/contracte");
    expect(formatUnitValue(12.5, "pct")).toBe("12,5 %");
    expect(formatUnitValue(1250, "eur")).toBe("1.250 €");
    expect(humanizeUnits("Condicions contradictòries al document: 8 eur_mwh vs 10 eur_mwh (pàg. 3)")).toBe("Condicions contradictòries al document: 8 €/MWh vs 10 €/MWh (pàg. 3)");
    expect(humanizeUnits("percentatge del preu")).toBe("percentatge del preu"); // no toca paraules
  });
  it("els avisos nous de contradicció ja surten amb la unitat correcta", () => {
    const t = (value: number, page: number): ExtractedTerm => ({ category: "remuneracio", field: "per_mwh", product: "Producte Fictici", tariff: null, service: null, segment: null, period_label: null, value, unit: "eur_mwh", tiers: null, formula: null, conditions: {}, page, excerpt: `x${page}`, interpretation: "", confidence: 0.9, ambiguous: false, ambiguity_reason: null } as unknown as ExtractedTerm);
    const [a] = markContradictions([t(8, 3), t(10, 5)]);
    expect(a.ambiguity_reason).toContain("8 €/MWh vs 10 €/MWh");
    expect(a.ambiguity_reason).not.toContain("eur_mwh");
  });
});

describe("1.3 · requisits de contrasenya", () => {
  it("valida longitud, lletres i números, i no permet el nom ni el correu", () => {
    expect(checkPassword("curta1").ok).toBe(false);
    expect(checkPassword("nomesl1etres").ok).toBe(true);
    expect(checkPassword("senseNumeros").errors).toContain("Ha de contenir algun número.");
    expect(checkPassword("jordi.prova2026x", { email: "jordi.prova@exemple.test" }).errors).toContain("No pot contenir el teu usuari de correu.");
    expect(checkPassword("Assessoria2026!").ok).toBe(false); // massa previsible
    expect(checkPassword("Riu-Verd-7-Mussol", { current: "Riu-Verd-7-Mussol" }).errors).toContain("Ha de ser diferent de l'actual.");
    expect(checkPassword("Riu-Verd-7-Mussol").score).toBeGreaterThanOrEqual(3);
  });
});

describe("1.5 · crida de clients amb page=0", () => {
  it("una pàgina 0, negativa o no numèrica es corregeix a l'1 (abans: error 400)", () => {
    expect(listQuery.parse({ page: "0" }).page).toBe(1);
    expect(listQuery.parse({ page: "-3" }).page).toBe(1);
    expect(listQuery.parse({ page: "abc" }).page).toBe(1);
    expect(listQuery.parse({}).page).toBe(1);
    expect(listQuery.parse({ page: "4" }).page).toBe(4);
  });
});

describe("9 · comercialitzadores desactivades i arxivades", () => {
  beforeEach(() => { state.sb = fakeSupabase({ retailers: [
    { id: "11111111-1111-4111-8111-111111111111", trade_name: "Fictícia Activa", aliases: [], status: "activa" },
    { id: "22222222-2222-4222-8222-222222222222", trade_name: "Fictícia Desactivada", aliases: ["Desactivada Energia"], status: "inactiva" },
    { id: "33333333-3333-4333-8333-333333333333", trade_name: "Fictícia Arxivada", aliases: [], status: "arxivada" },
  ] }); });
  it("no es poden fer servir per a contractes nous; les actives sí (i els noms lliures també)", async () => {
    const { assertRetailerOperational, retailerIndex, blockedRetailer } = await import("@/server/retailers");
    await expect(assertRetailerOperational("Fictícia Activa")).resolves.toBeUndefined();
    await expect(assertRetailerOperational("Una altra no registrada")).resolves.toBeUndefined();
    await expect(assertRetailerOperational("Desactivada Energia SL")).rejects.toThrow(/desactivada/);
    await expect(assertRetailerOperational("FICTÍCIA ARXIVADA")).rejects.toThrow(/arxivada/);
    const idx = await retailerIndex();
    expect(blockedRetailer("Fictícia Activa", idx)).toBeNull();
  });
  it("el selector operatiu només ofereix les actives (o pendents)", async () => {
    const { retailerOptions } = await import("@/server/retailers");
    const r = await retailerOptions({ profile: { role: "comercial" } } as never);
    expect(r.options.map((o) => o.name)).toEqual(["Fictícia Activa"]);
    expect(r.blocked.map((o) => o.name).sort()).toEqual(["Fictícia Arxivada", "Fictícia Desactivada"]);
  });
});

describe("8 · recordatoris sense duplicats (servidor)", () => {
  it("dues execucions seguides només creen l'avís una vegada", async () => {
    const start = new Date(Date.now() + 10 * 60000).toISOString(); // d'aquí a 10 min → toca el de 15 min
    state.sb = fakeSupabase({ agenda_events: [{ id: "e1", owner_id: "u1", title: "Visita fictícia", kind: "visita", scope: "personal", starts_at: start, ends_at: new Date(Date.parse(start) + 3600000).toISOString(), all_day: false, status: "programada", priority: "normal", recurrence: null, exdates: [], reminders: [15, 5] }], agenda_participants: [], crm_notifications: [] });
    const { generateReminders } = await import("@/server/agenda");
    const a = await generateReminders();
    const b = await generateReminders();
    expect(a.sent).toBe(1); // el de 5 min encara no toca
    expect(b.sent).toBe(0);
    const n = (await state.sb.from("crm_notifications").select("*")).data as { title: string; rule_key: string; link: { view: string } }[];
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe("Visita comercial: Visita fictícia");
    expect(n[0].link.view).toBe("agenda");
  });
});

describe("1.1 · prova de connexió SIPS (portal simulat)", () => {
  it("sense credencials: indica exactament què falta i no truca enlloc", async () => {
    vi.stubEnv("SIPS_USER", ""); vi.stubEnv("SIPS_PASSWORD", "");
    const { sipsConnectionTest } = await import("@/server/sips");
    const f = vi.fn();
    const r = await sipsConnectionTest(f as never);
    expect(r).toMatchObject({ ok: false, code: "no_configurat", missing: ["SIPS_USER", "SIPS_PASSWORD"] });
    expect(f).not.toHaveBeenCalled();
  });
  it("credencials rebutjades i acceptades (respostes simulades del portal)", async () => {
    vi.stubEnv("SIPS_USER", "usuari-fictici"); vi.stubEnv("SIPS_PASSWORD", "contrasenya-ficticia");
    const { sipsConnectionTest } = await import("@/server/sips");
    const bad = vi.fn(async (url: string) => (String(url).endsWith("/Account/Login/") ? new Response("", { status: 200 }) : new Response("{}", { status: 401 })));
    expect(await sipsConnectionTest(bad as never)).toMatchObject({ ok: false, code: "credencials" });
    const good = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await sipsConnectionTest(good as never)).toMatchObject({ ok: true, code: "ok" });
    vi.unstubAllEnvs();
  });
});

describe("6 · calendaris externs (Google i Microsoft simulats)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "client-fictici.apps"); vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "secret-fictici"); vi.stubEnv("APP_URL", "https://crm.exemple.test");
  });
  it("sense credencials OAuth no es pot connectar i es diu què falta", async () => {
    vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_ID", ""); vi.stubEnv("MICROSOFT_CALENDAR_CLIENT_SECRET", "");
    const { authUrl, calendarConfig, makeState } = await import("@/server/calendar");
    expect(calendarConfig().microsoft.missing).toEqual(["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET"]);
    expect(() => authUrl("microsoft", "lectura", makeState("u1", "microsoft", "lectura"))).toThrow(/Falten/);
    const url = new URL(authUrl("google", "lectura", makeState("u1", "google", "lectura")));
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.exemple.test/api/calendar/callback?provider=google");
    expect(url.searchParams.get("scope")).toContain("calendar.readonly"); // només lectura si l'usuari no autoritza escriure
  });
  it("el «state» està signat, és de l'usuari i ha de coincidir amb la galeta", async () => {
    const { makeState, readState } = await import("@/server/calendar");
    const s = makeState("u1", "google", "bidireccional");
    expect(readState(s, s, "u1")).toMatchObject({ p: "google", m: "bidireccional" });
    expect(() => readState(s, null, "u1")).toThrow(/no és vàlida/);
    expect(() => readState(s, s, "u2")).toThrow(/altre usuari/);
    const forged = `${s.split(".")[0]}.signaturafalsa`;
    expect(() => readState(forged, forged, "u1")).toThrow();
  });
  it("conversions: personal → privada, recurrència RRULE i UTC", async () => {
    const { toGoogle, toMicrosoft, toRRule, fromMicrosoft } = await import("@/server/calendar");
    const e = { id: "e1", title: "Visita", description: null, location: null, starts_at: "2026-11-10T09:00:00.000Z", ends_at: "2026-11-10T10:00:00.000Z", all_day: false, scope: "personal", status: "programada", kind: "visita", recurrence: { freq: "weekly" as const, byweekday: [2, 4], until: "2026-12-31" }, version: 1 };
    expect(toGoogle(e)).toMatchObject({ visibility: "private", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261231T225959Z"] });
    expect(toMicrosoft(e)).toMatchObject({ sensitivity: "private", start: { dateTime: "2026-11-10T09:00:00", timeZone: "UTC" } });
    expect(toRRule({ freq: "monthly", interval: 2, count: 5 })).toBe("RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=5");
    expect(fromMicrosoft({ id: "m1", subject: "Dentista", start: { dateTime: "2026-11-10T08:00:00.0000000" }, end: { dateTime: "2026-11-10T09:00:00.0000000" } }).start).toBe("2026-11-10T08:00:00.000Z");
  });
  it("sincronització bidireccional simulada: importa, exporta, no duplica i renova el token", async () => {
    const { seal } = await import("@/server/secret-box");
    const k = "clau-de-proves-0123456789-abcdefghij";
    state.sb = fakeSupabase({
      calendar_connections: [{ id: "c1", user_id: "u1", provider: "google", mode: "bidireccional", status: "connectat", calendar_id: "primary", access_token_enc: seal("token-caducat", k, "calendar-oauth-token"), refresh_token_enc: seal("refresc-fictici", k, "calendar-oauth-token"), token_expires_at: new Date(Date.now() - 1000).toISOString() }],
      calendar_event_links: [],
      agenda_events: [{ id: "crm-1", owner_id: "u1", title: "Reunió del CRM", description: null, location: null, starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 90000000).toISOString(), all_day: false, scope: "compartida", status: "programada", kind: "reunio", recurrence: null, version: 1, external_source: null }],
    });
    const calls: string[] = [];
    let pushed = 0;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url).split("?")[0]}`);
      if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "token-nou", expires_in: 3600 });
      if (String(url).includes("/events") && (init?.method ?? "GET") === "GET") return Response.json({ items: [
        { id: "g-1", etag: "\"1\"", status: "confirmed", summary: "Cita personal de Google", start: { dateTime: new Date(Date.now() + 2 * 86400000).toISOString() }, end: { dateTime: new Date(Date.now() + 2 * 86400000 + 3600000).toISOString() } },
        ...(pushed ? [{ id: "g-crm-1", etag: "\"p1\"", status: "confirmed", summary: "Reunió del CRM", start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date().toISOString() }, extendedProperties: { private: { a30Id: "crm-1" } } }] : []),
      ] });
      if (init?.method === "POST") { pushed++; return Response.json({ id: "g-crm-1", etag: "\"p1\"" }); }
      return new Response(null, { status: 204 });
    });
    const { syncConnection } = await import("@/server/calendar");
    const conn = () => (state.sb as unknown as { from: (t: string) => { select: () => Promise<{ data: unknown[] }> } });
    const c0 = ((await conn().from("calendar_connections").select()).data[0]) as never;
    const r1 = await syncConnection(c0, f as never);
    expect(r1).toMatchObject({ imported: 1, pushed: 1, errors: [] });
    expect(calls[0]).toBe("POST https://oauth2.googleapis.com/token"); // el token havia caducat: es renova
    const c1 = ((await conn().from("calendar_connections").select()).data[0]) as never;
    const r2 = await syncConnection(c1, f as never);
    expect(r2).toMatchObject({ imported: 0, pushed: 0 }); // segona passada: cap duplicat ni cap enviament repetit
    const evs = (await conn().from("agenda_events").select()).data as { external_id?: string; title: string }[];
    expect(evs.filter((e) => e.external_id === "g-1")).toHaveLength(1);
    expect(evs.filter((e) => e.title === "Reunió del CRM")).toHaveLength(1); // la còpia exportada no es torna a importar
  });
  it("si el proveïdor revoca l'accés, la connexió queda en error (no es mostra com a connectada)", async () => {
    const { seal } = await import("@/server/secret-box");
    state.sb = fakeSupabase({ calendar_connections: [{ id: "c1", user_id: "u1", provider: "google", mode: "lectura", status: "connectat", calendar_id: "primary", access_token_enc: null, refresh_token_enc: seal("revocat", "clau-de-proves-0123456789-abcdefghij", "calendar-oauth-token"), token_expires_at: null }], calendar_event_links: [], agenda_events: [] });
    const f = vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    const { syncConnection } = await import("@/server/calendar");
    const c = ((await (state.sb as unknown as { from: (t: string) => { select: () => Promise<{ data: unknown[] }> } }).from("calendar_connections").select()).data[0]) as never;
    const r = await syncConnection(c, f as never);
    expect(r.errors[0]).toMatch(/tornar a connectar/);
    const after = ((await (state.sb as unknown as { from: (t: string) => { select: () => Promise<{ data: { status: string }[] }> } }).from("calendar_connections").select()).data[0]);
    expect(after.status).toBe("error");
  });
});
