/**
 * Pestanya «Documents» de la fitxa de Renovacions (correcció de l'error crític de novembre 2026).
 *  - Regressió: cap selector de zustand pot retornar un array/objecte nou a cada lectura (bucle infinit, React #185).
 *  - Servidor: `documentsForRenewal` troba el client pel contracte (crm:<id> o legacy_contract_id) o pel CUPS,
 *    ordena primer els documents d'aquest contracte, respecta els permisos i no falla si no hi ha vincle.
 * La RLS es simula filtrant les files que cada usuari pot veure (la política real és a la migració 008 i ja es prova a tests/db).
 * Dades totalment fictícies.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => { throw new Error("no s'ha de fer servir el client admin"); }, HttpError, handler: () => () => null, requireUser: async () => null };
});

import { documentsForRenewal } from "@/server/crm-docs";

type Row = Record<string, unknown>;
const ADMIN = "00000000-0000-4000-8000-0000000000ad", COM = "00000000-0000-4000-8000-0000000000c1", ALTRE = "00000000-0000-4000-8000-0000000000c2";
const CLI = "00000000-0000-4000-8000-00000000c001", CLI2 = "00000000-0000-4000-8000-00000000c002";
const K1 = "00000000-0000-4000-8000-00000000a001", K2 = "00000000-0000-4000-8000-00000000a002";
const SUP = "00000000-0000-4000-8000-00000000b001";
const CUPS = "ES0000000000000001AB0F";
const doc = (id: string, extra: Row): Row => ({
  id, client_id: CLI, supply_id: null, contract_id: null, category: "factura_llum", sensitive: false, title: `Doc ${id.slice(-3)}`, description: null,
  original_name: `doc-${id.slice(-3)}.pdf`, mime: "application/pdf", size_bytes: 1000, version: 1, status: "actiu", retain_until: null, uploaded_by_name: "Usuari Demo",
  created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z", ...extra,
});
const seed = () => ({
  crm_clients: [{ id: CLI, name: "CLIENT FICTICI SL", owner_id: COM }, { id: CLI2, name: "ALTRE CLIENT SL", owner_id: ALTRE }],
  crm_contracts: [
    { id: K1, client_id: CLI, retailer: "Nufri", legacy_contract_id: "drive-001", created_at: "2026-01-01" },
    { id: K2, client_id: CLI2, retailer: "Naturgy", legacy_contract_id: "drive-002", created_at: "2026-01-01" },
  ],
  crm_supplies: [{ id: SUP, client_id: CLI, cups: CUPS, cups20: CUPS.slice(0, 20), archived_at: null }],
  crm_documents: [
    doc("00000000-0000-4000-8000-000000000d01", { created_at: "2026-10-05T10:00:00Z" }),                          // del client, sense vincle
    doc("00000000-0000-4000-8000-000000000d02", { contract_id: K1, category: "contracte" }),                         // d'aquest contracte
    doc("00000000-0000-4000-8000-000000000d03", { supply_id: SUP, category: "factura_llum" }),                       // del CUPS
    doc("00000000-0000-4000-8000-000000000d04", { category: "dni_nie", sensitive: true }),                           // sensible
    doc("00000000-0000-4000-8000-000000000d05", { status: "arxivat" }),                                              // arxivat: no es mostra
    doc("00000000-0000-4000-8000-000000000d06", { client_id: CLI2, contract_id: K2 }),                               // d'un altre client
  ],
});

/** Usuari amb una sessió que només veu el que la RLS li permetria. */
function user(id: string, role: "admin" | "comercial") {
  const all = seed();
  const visibleClients = role === "admin" ? all.crm_clients : all.crm_clients.filter((c) => c.owner_id === id);
  const ids = new Set(visibleClients.map((c) => c.id));
  const sensitive = role === "admin";
  const sb = fakeSupabase(
    {
      crm_clients: visibleClients,
      crm_contracts: all.crm_contracts.filter((k) => ids.has(k.client_id)),
      crm_supplies: all.crm_supplies.filter((s) => ids.has(s.client_id)),
      crm_documents: all.crm_documents.filter((d) => ids.has(d.client_id as string) && (!d.sensitive || sensitive)),
    } as never,
    { crm_can_edit_client: () => true, crm_can_see_sensitive: () => sensitive },
  );
  return { sb, user: { id }, profile: { id, name: role, email: `${role}@exemple.test`, role, code: null } } as never;
}

describe("Pestanya Documents · regressió del bucle infinit", () => {
  it("cap selector de zustand filtra o crea objectes dins del selector", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name)) files.push(p); } };
    walk(path.resolve(__dirname, "../src"));
    // els selectors que retornen un booleà o un número (`!!…`, `….length > 0`) són segurs
    const bad = /use(App|Store|Session|Wizard|SipsIndex|NavPrefs)\(\(?s\)?\s*=>\s*(?![\s!])[^;]*?\.(filter|map|slice|concat|sort)\((?![^;]*\.length)/;
    const hits = files.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").map((l, i) => (bad.test(l) ? `${path.relative(process.cwd(), f)}:${i + 1}` : null)).filter(Boolean));
    expect(hits).toEqual([]);
  });
  it("la fitxa protegeix cada pestanya amb un ErrorBoundary", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/ui/components/ContractDrawer.tsx"), "utf8");
    expect(src).toMatch(/<ErrorBoundary label=\{TABS\.find/);
    expect(fs.readFileSync(path.resolve(__dirname, "../src/ui/App.tsx"), "utf8")).toMatch(/<ErrorBoundary label="Aquesta pantalla"/);
  });
});

describe("documentsForRenewal (servidor)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("contracte importat (legacy) → documents del client, primer els d'aquest contracte i CUPS; sense arxivats", async () => {
    const r = await documentsForRenewal(user(ADMIN, "admin"), "drive-001", CUPS);
    expect(r.linked).toBe(true);
    if (!r.linked) return;
    expect(r.client.name).toBe("CLIENT FICTICI SL");
    expect(r.contractId).toBe(K1);
    expect(r.supplyId).toBe(SUP);
    const ids = r.documents.map((d) => d.id.slice(-3));
    expect(ids.slice(0, 2).sort()).toEqual(["d02", "d03"]);       // relacionats primer
    expect(r.documents.filter((d) => d.related)).toHaveLength(2);
    expect(ids).not.toContain("d05");                               // arxivat
    expect(ids).not.toContain("d06");                               // un altre client
    expect(ids).toContain("d04");                                   // Direcció veu els sensibles
    expect(r.permissions.canSeeSensitive).toBe(true);
  });

  it("contracte del CRM (crm:<uuid>) també es resol", async () => {
    const r = await documentsForRenewal(user(ADMIN, "admin"), `crm:${K1}`, null);
    expect(r.linked && r.contractId).toBe(K1);
  });

  it("sense contracte vinculat però amb CUPS conegut → troba el client pel CUPS", async () => {
    const r = await documentsForRenewal(user(ADMIN, "admin"), "drive-desconegut", CUPS.slice(0, 20).toLowerCase());
    expect(r.linked).toBe(true);
    if (r.linked) { expect(r.contractId).toBeNull(); expect(r.supplyId).toBe(SUP); }
  });

  it("contracte sense client → linked:false (no és un error)", async () => {
    const r = await documentsForRenewal(user(ADMIN, "admin"), "drive-999", null);
    expect(r).toMatchObject({ linked: false, documents: [] });
  });

  it("comercial responsable: veu els documents del seu client però no els DNI/bancaris", async () => {
    const r = await documentsForRenewal(user(COM, "comercial"), "drive-001", CUPS);
    expect(r.linked).toBe(true);
    if (!r.linked) return;
    expect(r.documents.map((d) => d.id.slice(-3))).not.toContain("d04");
    expect(r.permissions.canSeeSensitive).toBe(false);
  });

  it("comercial d'un altre client: no veu res", async () => {
    const r = await documentsForRenewal(user(COM, "comercial"), "drive-002", null);
    expect(r).toMatchObject({ linked: false, documents: [] });
  });

  it("identificadors no vàlids → 400", async () => {
    await expect(documentsForRenewal(user(ADMIN, "admin"), "crm:no-es-uuid", null)).rejects.toMatchObject({ status: 400 });
    await expect(documentsForRenewal(user(ADMIN, "admin"), "   ", null)).rejects.toMatchObject({ status: 400 });
  });
});
