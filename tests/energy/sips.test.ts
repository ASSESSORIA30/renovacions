import { beforeEach, describe, expect, it } from "vitest";
import { FIELD_HEADERS, buildListRequest, entitiesToRows, caseVariants, __resetSession, sipsSearchRows, SipsError, recordsToRows, rowToRecord, cupsBase, type SipsConfig } from "@/energy/lib/sips-engine";
import { COLUMNS } from "@/energy/lib/columns";
import { parseRows } from "@/energy/lib/parse";

describe("Buscador SIPS · mapeo", () => {
  it("97 campos en el mismo orden que el Excel", () => {
    expect(FIELD_HEADERS).toHaveLength(97);
    expect(FIELD_HEADERS.map(([, h]) => h)).toEqual(COLUMNS.map((c) => c.header));
  });
  it("valida la consulta y construye criterios Serenity", () => {
    expect(buildListRequest({ cups: "ES0031" }).ok).toBe(false);
    expect(buildListRequest({}).ok).toBe(false);
    expect(buildListRequest({ cp: "0820" }).ok).toBe(false);
    const r = buildListRequest({ cp: "08201", direccion: "Migdia 5%", tarifa: "3.0TD", minKWh: 100000, take: 500 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.Take).toBe(100);
      expect(r.request.EqualityFilter).toEqual({ CodigoPostal: "08201" });
      expect(JSON.stringify(r.request.Criteria)).toBe(
        JSON.stringify([[[[["TipoEnergia"], "=", 1], "and", caseVariants("Direccion", "Migdia 5", "%", "%")], "and", [["IdTarifaNombreTarifa"], "=", "3.0TD"]], "and", [["EActivaAnual"], ">=", 100000]]),
      );
    }
    const c = buildListRequest({ cups: "es 0021 0000 0000 0001 rk 0f" });
    expect(c.ok && c.request.EqualityFilter).toEqual({});
    // CUPS eléctrico de 20 caracteres: encuentra el mismo CUPS con cualquier
    // extensión de dos caracteres (por ejemplo 0F).
    const short = buildListRequest({ cups: "es 0021 0000 0000 0001 rk" });
    expect(short.ok).toBe(true);
    if (short.ok) {
      expect(short.request.EqualityFilter).toEqual({});
      // Plataforma unificada: per CUPS no es filtra el tipus (pot ser llum o gas).
      expect(short.request.Criteria).toEqual(caseVariants("CUPS", "ES0021000000000001RK", "", "%"));
    }
    // Un CUPS de 22 caracteres sigue buscando por coincidencia exacta.
    expect(c.ok && c.request.Criteria).toEqual(caseVariants("CUPS", "ES0021000000000001RK0F"));
    // Només llum, si es demana explícitament (comportament original de cups2).
    const luz = buildListRequest({ cups: "ES0021000000000001RK", energia: "luz" });
    expect(luz.ok && luz.request.Criteria).toEqual([[["TipoEnergia"], "=", 1], "and", caseVariants("CUPS", "ES0021000000000001RK", "", "%")]);
  });
  it("las filas devueltas pasan por el importador", () => {
    const rows = entitiesToRows([
      { TipoEnergia: 1, CUPS: "ES0021000000000001RK0F", Direccion: "C/ TEST 1", IdTarifaNombreTarifa: "3.0TD", PotenciaContratadaP1: 20, FechaCaducidadBIE: "2025-01-02T00:00:00.000", Contratable: true, EActivaAnual: 120000, PotenciaMes07: 18.5 },
    ]);
    const { supplies, report } = parseRows(rows, { file: "Portal SIPS", sheet: "API" });
    expect(report.recognized).toHaveLength(97);
    const s = supplies[0];
    expect(s.tarifa).toBe("3.0TD");
    expect(s.fCaducidadBIE).toBe("2025-01-02");
    expect(s.contratable).toBe(true);
    expect(s.potMensual[6]).toBe(18.5);
    expect(s.tipoEnergia).toBe("Electricidad");
  });
});

describe("Buscador SIPS · sesión y seguridad (portal simulado)", () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let listStatus = 200;
  let entities: Record<string, unknown>[] = [{ TipoEnergia: 1, CUPS: "ES0021000000000001RK0F", EActivaAnual: 5 }];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/Account/Login/")) return new Response("<html/>", { status: 200, headers: [["Set-Cookie", "CSRF-TOKEN=tok123; path=/"]] });
    if (url.endsWith("/Account/Login")) {
      const b = JSON.parse(String(init?.body));
      if (b.Password !== "secreto") return new Response('{"Error":{"Message":"bad"}}', { status: 400 });
      return new Response("{}", { status: 200, headers: [["Set-Cookie", ".AspNetAuth=AUTH; path=/; HttpOnly"]] });
    }
    if (url.endsWith("/Services/Core/PuntoSuministro/List")) {
      if (listStatus === 302) {
        listStatus = 200;
        return new Response("", { status: 302 });
      }
      return new Response(JSON.stringify({ Entities: entities, TotalCount: entities.length }), { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const cfg: SipsConfig = { base: "https://portal.test", user: "SIPS", pass: "secreto" };

  beforeEach(() => {
    calls.length = 0;
    listStatus = 200;
    entities = [{ TipoEnergia: 1, CUPS: "ES0021000000000001RK0F", EActivaAnual: 5 }];
    __resetSession();
  });

  it("sense credencials al servidor → 503 i sense consultar el portal", async () => {
    await expect(sipsSearchRows({ cp: "08201" }, { ...cfg, pass: "" }, fake)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });
  it("consulta no vàlida → 400 abans de connectar", async () => {
    await expect(sipsSearchRows({ cp: "0820" }, cfg, fake)).rejects.toBeInstanceOf(SipsError);
    expect(calls).toHaveLength(0);
  });
  it("login con CSRF + cookies y consulta", async () => {
    const j = await sipsSearchRows({ cups: "ES0021000000000001RK0F" }, cfg, fake);
    expect(j.total).toBe(1);
    expect(j.rows[0]).toHaveLength(97);
    const list = calls.find((c) => c.url.endsWith("/List"))!;
    const h = list.init!.headers as Record<string, string>;
    expect(h["X-CSRF-TOKEN"]).toBe("tok123");
    expect(h.Cookie).toContain(".AspNetAuth=AUTH");
    // segunda consulta reutiliza la sesión
    await sipsSearchRows({ cp: "08201" }, cfg, fake);
    expect(calls.filter((c) => c.url.endsWith("/Account/Login")).length).toBe(1);
  });
  it("si la sesión caduca, vuelve a iniciar sesión", async () => {
    await sipsSearchRows({ cp: "08201" }, cfg, fake);
    listStatus = 302;
    const r = await sipsSearchRows({ cp: "08201" }, cfg, fake);
    expect(r.total).toBe(1);
    expect(calls.filter((c) => c.url.endsWith("/Account/Login")).length).toBe(2);
  });
  it("credenciales incorrectas → error claro", async () => {
    await expect(sipsSearchRows({ cp: "08201" }, { ...cfg, pass: "otra" }, fake)).rejects.toMatchObject({ status: 502, code: "credencials", message: expect.stringMatching(/rebutjat/) });
    // el cos de la resposta del portal no es filtra mai a l'usuari
    await expect(sipsSearchRows({ cp: "08201" }, { ...cfg, pass: "otra" }, fake)).rejects.not.toMatchObject({ message: expect.stringMatching(/bad/) });
  });
  it("CUPS de 20 caràcters en minúscules troba el CUPS amb sufix i descarta coincidències alienes", async () => {
    entities = [
      { TipoEnergia: 1, CUPS: "ES0021000000000001RK0F", EActivaAnual: 5 },
      { TipoEnergia: 1, CUPS: "ES0021000000000002AB0F", EActivaAnual: 9 },
    ];
    const r = await sipsSearchRows({ cups: "es0021000000000001rk" }, cfg, fake);
    expect(r.total).toBe(1);
    expect(r.rows[1][1]).toBe("ES0021000000000001RK0F");
  });
  it("CUPS de 22 caràcters exigeix coincidència exacta", async () => {
    entities = [{ TipoEnergia: 1, CUPS: "ES0021000000000001RK1P", EActivaAnual: 5 }];
    const r = await sipsSearchRows({ cups: "ES0021000000000001RK0F" }, cfg, fake);
    expect(r.total).toBe(0);
  });
  it("raw de sips_cache ↔ files de l'importador (sense pèrdua)", () => {
    const rows = entitiesToRows([{ TipoEnergia: 1, CUPS: "ES0021000000000001RK0F", EActivaAnual: 1234, PotenciaMes01: 7 }]);
    const rec = rowToRecord(rows[0], rows[1]);
    expect(Object.keys(rec)).toHaveLength(97);
    expect(recordsToRows([rec])).toEqual(rows);
    expect(cupsBase(" es0021-0000 0000 0001rk0f")).toBe("ES0021000000000001RK");
  });
});

describe("Buscador SIPS · gas", () => {
  it("filtra per tipus d'energia en cerques per adreça", () => {
    const gas = buildListRequest({ cp: "25001", energia: "gas" });
    expect(gas.ok && JSON.stringify(gas.request.Criteria)).toBe(JSON.stringify([["TipoEnergia"], "=", 2]));
    const totes = buildListRequest({ cp: "25001", energia: "totes", direccion: "major" });
    expect(totes.ok && JSON.stringify(totes.request.Criteria)).toBe(
      JSON.stringify([[[["TipoEnergia"], "=", 1], "or", [["TipoEnergia"], "=", 2]], "and", caseVariants("Direccion", "major", "%", "%")]),
    );
    // per defecte, per adreça es manté només llum (comportament anterior)
    const def = buildListRequest({ cp: "25001" });
    expect(def.ok && JSON.stringify(def.request.Criteria)).toBe(JSON.stringify([["TipoEnergia"], "=", 1]));
  });
  it("peatges de gas RL.1–RL.11 (variants d'escriptura) i coherència amb el tipus", () => {
    const r = buildListRequest({ cp: "25001", energia: "gas", tarifa: "RL.3" });
    expect(r.ok && JSON.stringify(r.request.Criteria)).toContain('"RL3"');
    expect(buildListRequest({ cp: "25001", energia: "luz", tarifa: "RL.3" }).ok).toBe(false);
    expect(buildListRequest({ cp: "25001", energia: "gas", tarifa: "3.0TD" }).ok).toBe(false);
    expect(buildListRequest({ cp: "25001", energia: "gas", tarifa: "RL.12" }).ok).toBe(false);
  });
  it("un punt de gas passa per l'importador com a «Gas»", () => {
    const rows = entitiesToRows([{ TipoEnergia: 2, CUPS: "ES0217010000000001AB", IdTarifaNombreTarifa: "RL.2", EActivaAnual: 9500, EActivaMes01: 2100 }]);
    const { supplies } = parseRows(rows, { file: "Portal SIPS", sheet: "API" });
    expect(supplies[0].tipoEnergia).toBe("Gas");
    expect(supplies[0].tarifaRaw).toBe("RL.2");
    expect(supplies[0].eaAnual).toBe(9500);
  });
});


/* ---------- Fase 8 · errors tipificats (portal simulat; la connexió REAL queda pendent de credencials) ---------- */
describe("Buscador SIPS · errors tipificats (Fase 8)", () => {
  const cfg: SipsConfig = { base: "https://portal.test", user: "SIPS", pass: "secreto" };
  const portal = (list: (init?: RequestInit) => Response | Promise<Response>, loginStatus = 200) => (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/Account/Login/")) return new Response("<html/>", { status: 200, headers: [["Set-Cookie", "CSRF-TOKEN=t; path=/"]] });
    if (url.endsWith("/Account/Login")) return new Response("{}", { status: loginStatus, headers: [["Set-Cookie", ".AspNetAuth=A; path=/"]] });
    return list(init);
  }) as unknown as typeof fetch;
  beforeEach(() => __resetSession());

  it("sense credencials → no_configurat", async () => {
    await expect(sipsSearchRows({ cp: "08201" }, { ...cfg, user: "" }, portal(() => new Response("{}")))).rejects.toMatchObject({ status: 503, code: "no_configurat" });
  });
  it("CUPS mal format → cups_invalid sense connectar", async () => {
    let n = 0;
    await expect(sipsSearchRows({ cups: "ES12" }, cfg, portal(() => { n++; return new Response("{}"); }))).rejects.toMatchObject({ status: 400, code: "cups_invalid" });
    expect(n).toBe(0);
  });
  it("portal caigut en iniciar sessió (5xx) → no_disponible", async () => {
    await expect(sipsSearchRows({ cp: "08201" }, cfg, portal(() => new Response("{}"), 503))).rejects.toMatchObject({ code: "no_disponible" });
  });
  it("429 → limit", async () => {
    await expect(sipsSearchRows({ cp: "08201" }, cfg, portal(() => new Response("", { status: 429 })))).rejects.toMatchObject({ status: 429, code: "limit" });
  });
  it("resposta que no és JSON → transformacio", async () => {
    await expect(sipsSearchRows({ cp: "08201" }, cfg, portal(() => new Response("<html>manteniment</html>", { status: 200 })))).rejects.toMatchObject({ code: "transformacio" });
  });
  it("error de xarxa → no_disponible (503)", async () => {
    await expect(sipsSearchRows({ cp: "08201" }, cfg, portal(() => { throw new TypeError("fetch failed"); }))).rejects.toMatchObject({ status: 503, code: "no_disponible" });
  });
  it("temps esgotat → 504 no_disponible (amb senyal d'abort a cada petició)", async () => {
    let signal: AbortSignal | undefined;
    const f = portal((init) => { signal = init?.signal ?? undefined; const e = new Error("timeout"); e.name = "TimeoutError"; throw e; });
    await expect(sipsSearchRows({ cp: "08201" }, cfg, f)).rejects.toMatchObject({ status: 504, code: "no_disponible" });
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  it("sessió que caduca sempre → credencials", async () => {
    await expect(sipsSearchRows({ cp: "08201" }, cfg, portal(() => new Response("", { status: 302 })))).rejects.toMatchObject({ code: "credencials" });
  });
  it("sense resultats → total 0 (no s'inventa cap dada)", async () => {
    const r = await sipsSearchRows({ cp: "08201" }, cfg, portal(() => new Response(JSON.stringify({ Entities: [], TotalCount: 0 }))));
    expect(r.total).toBe(0);
    expect(r.rows).toHaveLength(1); // només capçaleres
  });
});
