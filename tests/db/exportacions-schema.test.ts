/**
 * Exportacions a Excel: cada columna, filtre i ordre de cada conjunt existeix a l'esquema real (migracions 001-028),
 * i els filtres rebuts només poden fer servir columnes de la definició (mai SQL lliure).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { EXPORTS, cleanQuery, exportDef } from "@/core/exports";
import { setup, upTo } from "./harness";

let cols: Map<string, Set<string>>;
beforeAll(async () => {
  const h = await setup(upTo("028"));
  const r = await h.db.query<{ t: string; c: string }>(`select table_name as t, column_name as c from information_schema.columns where table_schema = 'public'`);
  cols = new Map();
  for (const x of r.rows) { if (!cols.has(x.t)) cols.set(x.t, new Set()); cols.get(x.t)!.add(x.c); }
}, 300_000);

describe("definicions d'exportació contra l'esquema", () => {
  for (const d of EXPORTS) it(`${d.id} (${d.table})`, () => {
    const have = cols.get(d.table);
    expect(have, `taula ${d.table}`).toBeTruthy();
    const used = [...d.columns.map((c) => c.key), d.statusCol, ...d.dates.map((x) => x.col), ...d.search, d.retailerCol, d.ownerCol, d.collaboratorCol, ...(d.facets ?? []).map((f) => f.col), ...Object.keys(d.base ?? {}), d.order.col, d.expandJson, ...(d.links ?? []), d.idCol ?? "id",
      ...Object.entries(d.extras ?? {}).flatMap(([k, m]) => (Object.keys(m).length ? Object.values(m).flat().map((c) => c[1]) : [k]))].filter(Boolean) as string[];
    expect(used.filter((c) => !have!.has(c)), `columnes que no existeixen a ${d.table}`).toEqual([]);
  });
  it("identificadors únics", () => { expect(new Set(EXPORTS.map((d) => d.id)).size).toBe(EXPORTS.length); });
});

describe("filtres de les pantalles", () => {
  it("clients: comercial sense assignar, serveis i municipi com a la pantalla", () => {
    const q = cleanQuery(exportDef("clients")!, { owner: "cap", x_service: "gas", x_city: "Lleida", x_unknown: "x" });
    expect(q).toMatchObject({ ownerNull: true, extras: [["gt", "gas_count", 0], ["ilike", "city", "Lleida"]] });
  });
  it("tasques: grup «vençudes» i «les meves»", () => {
    const q = cleanQuery(exportDef("tasques")!, { x_group: "vencudes", owner: "me" });
    expect(q.extras?.map((c) => c[0])).toEqual(["in", "lt_now"]);
    expect(q.ownerMe).toBe(true);
  });
  it("selecció i vincles: només identificadors i columnes permeses", () => {
    const q = cleanQuery(exportDef("contractes")!, { ids: "a1b2,../etc,ok-3", l_client_id: "00000000-0000-0000-0000-000000000001", l_password: "x" });
    expect(q.ids).toEqual(["a1b2", "ok-3"]);
    expect(q.links).toEqual({ client_id: "00000000-0000-0000-0000-000000000001" });
  });
});

describe("filtres segurs", () => {
  const def = exportDef("clients")!;
  it("ignora columnes, dates i valors no permesos", () => {
    const q = cleanQuery(def, { status: "actiu,potencial", dateCol: "password", from: "2026-01-01", to: "x", q: "a%b,c);drop", owner: "no-uuid", f_kind: "empresa", f_secret: "x", columns: "name,tax_id,inexistent" });
    expect(q).toMatchObject({ status: ["actiu", "potencial"], dateCol: "created_at", from: "2026-01-01", to: undefined, owner: undefined, facets: { kind: "empresa" }, columns: ["name", "tax_id"] });
    expect(q.q).not.toMatch(/[%,()]/);
  });
  it("sense columna d'estat no s'accepta cap filtre d'estat", () => {
    expect(cleanQuery(exportDef("cobraments")!, { status: "x" }).status).toBeUndefined();
  });
});
