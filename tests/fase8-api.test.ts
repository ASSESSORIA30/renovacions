/**
 * FASE 8 · Rutes: diagnòstic restringit (/api/health), espai de treball persistent amb control de concurrència
 * (/api/workspace) i SIPS (validació abans de consultar, errors tipificats). Client Supabase en memòria.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase>; who: { id: string; role: string } | null } = { sb: fakeSupabase(), who: null };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  const handler = (fn: (r: Request) => Promise<unknown>) => async (r: Request) => {
    try { const x = await fn(r); return x instanceof Response ? x : Response.json(x); } catch (e) { return Response.json({ error: (e as Error).message }, { status: e instanceof HttpError ? e.status : (e as { name?: string }).name === "ZodError" ? 400 : 500 }); }
  };
  return { adminClient: () => state.sb, HttpError, handler };
});
vi.mock("@/server/permissions", async () => {
  const { HttpError } = await import("@/server/supabase");
  return {
    requireInternal: async (o?: { admin?: boolean }) => {
      if (!state.who) throw new HttpError(401, "No has iniciat sessió");
      if (state.who.role === "colaborador") throw new HttpError(403, "Només per a l'equip intern");
      if (o?.admin && state.who.role !== "admin") throw new HttpError(403, "Només Direcció");
      return { sb: state.sb, user: { id: state.who.id }, profile: { id: state.who.id, name: "X", role: state.who.role } };
    },
  };
});

const A = "00000000-0000-0000-0000-00000000000a", C1 = "00000000-0000-0000-0000-0000000000c1";
beforeEach(() => { state.sb = fakeSupabase(); state.who = null; });

describe("Prova 46 · /api/health: diagnòstic restringit", () => {
  it("anònim i usuaris no Direcció: només «ok», sense cap detail de configuració", async () => {
    const { GET } = await import("../app/api/health/route");
    for (const who of [null, { id: C1, role: "comercial" }]) {
      state.who = who;
      const j = await (await GET()).json();
      expect(Object.keys(j).sort()).toEqual(["at", "ok"]);
      expect(JSON.stringify(j)).not.toMatch(/smtp|anthropic|supabase|google|checks/i);
    }
  });
});

describe("Prova 38 · Persistència entre sessions i navegadors (/api/workspace)", () => {
  const put = async (body: unknown) => { const { PUT } = await import("../app/api/workspace/route"); return PUT(new Request("http://x/api/workspace", { method: "PUT", body: JSON.stringify(body) })); };
  const get = async (key: string) => { const { GET } = await import("../app/api/workspace/route"); return (await GET(new Request(`http://x/api/workspace?key=${key}`))).json(); };
  it("cal sessió interna", async () => {
    expect((await put({ key: "energy", data: {}, version: 0 })).status).toBe(401);
    state.who = { id: "k", role: "colaborador" };
    expect((await put({ key: "energy", data: {}, version: 0 })).status).toBe(403);
  });
  it("desa al servidor i un altre «navegador» ho recupera", async () => {
    state.who = { id: C1, role: "comercial" };
    const r = await put({ key: "energy", data: { offers: [{ id: "o1" }] }, version: 0 });
    expect(await r.json()).toMatchObject({ version: 1 });
    const g = await get("energy");
    expect(g).toMatchObject({ version: 1, data: { offers: [{ id: "o1" }] } });
  });
  it("concurrència: una versió antiga rep 409 amb les dades actuals (no es trepitja)", async () => {
    state.who = { id: C1, role: "comercial" };
    await put({ key: "energy", data: { offers: [1] }, version: 0 });
    await put({ key: "energy", data: { offers: [1, 2] }, version: 1 });
    const stale = await put({ key: "energy", data: { offers: [9] }, version: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ conflict: true, version: 2, data: { offers: [1, 2] } });
    expect((await get("energy")).data).toEqual({ offers: [1, 2] });
  });
  it("cada usuari té el seu espai; claus i mida validades", async () => {
    state.who = { id: C1, role: "comercial" };
    await put({ key: "nav", data: { fav: ["sips"] }, version: 0 });
    state.who = { id: A, role: "admin" };
    expect((await get("nav")).data).toBeNull();
    expect((await put({ key: "../x", data: {}, version: 0 })).status).toBe(400);
    expect((await put({ key: "big", data: { s: "x".repeat(3_100_000) }, version: 0 })).status).toBe(413);
  });
});

describe("Menú (Fase 8): només pantalles reals, sense duplicats, segons permisos", async () => {
  const { NAV, NAV_GROUPS, activeKey, filterGroups, visibleItem, cleanPrefs } = await import("@/ui/components/nav");
  it("conté els 10 grups de l'especificació", () => {
    expect(NAV_GROUPS.map((g) => g.title)).toEqual(["Inici", "Clients", "Comercial", "Energia", "Contractació", "Economia", "Facturació", "Col·laboradors", "Intel·ligència", "Administració"]);
  });
  it("cap enllaç duplicat (vista + paràmetres) per a un mateix rol, i claus úniques", () => {
    expect(new Set(NAV.map((n) => n.key)).size).toBe(NAV.length);
    for (const role of ["admin", "cap_administrativa", "administrativa", "comercial"]) {
      const can = (p: string) => role === "admin" || !["economia", "configuracio", "centre_control"].includes(p);
      const seen = NAV.filter((n) => visibleItem(n, role, can) && !n.run).map((n) => `${n.id}?${new URLSearchParams(n.params ?? {})}`);
      expect(new Set(seen).size, role).toBe(seen.length);
    }
  });
  it("cada opció apunta a una vista existent", async () => {
    const { VIEWS } = await import("@/data/store");
    for (const n of NAV) expect(VIEWS, n.key).toContain(n.id);
  });
  it("el col·laborador no veu el menú intern; sense permís no apareix l'opció", () => {
    expect(NAV.filter((n) => visibleItem(n, "colaborador", () => true))).toHaveLength(0);
    const com = NAV.filter((n) => visibleItem(n, "comercial", (p) => ["clients", "comercial", "comparatives"].includes(p)));
    expect(com.some((n) => n.key === "economia" || n.key === "permisos" || n.key === "auditoria")).toBe(false);
    expect(com.some((n) => n.key === "sips")).toBe(true);
  });
  it("opció activa: Configuració vs Integracions; vistes de detall", () => {
    expect(activeKey(NAV, "ajustes", { tab: "integraciones" })).toBe("integracions");
    expect(activeKey(NAV, "ajustes", { tab: "datos" })).toBe("config");
    expect(activeKey(NAV, "client", { id: "x" })).toBe("clients");
    expect(activeKey(NAV, "fitxa", {})).toBe("energia");
  });
  it("cerca ràpida sense accents i preferències netejades", () => {
    expect(filterGroups(NAV_GROUPS, "comissio").flatMap((g) => g.items.map((n) => n.key))).toContain("regles");
    expect(filterGroups(NAV_GROUPS, "intelligencia")[0].title).toBe("Intel·ligència");
    expect(cleanPrefs({ fav: ["sips", "inexistent", "sips"], mini: 1, closed: { Inici: true, X: "no" } })).toEqual({ fav: ["sips"], mini: false, closed: { Inici: true } });
  });
});
