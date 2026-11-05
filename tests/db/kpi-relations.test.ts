/**
 * Fase 8.1 · KPI del Centre de Control i Supervisió amb la relació correcta crm_contracts → crm_supplies.
 *
 * Reprodueix amb PostgreSQL real (PGlite + totes les migracions) les dues lectures possibles:
 *   - N:1 per crm_contracts_supply_id_fkey (la que fa servir ara el codi): una fila i un subministrament per contracte;
 *   - 1:N per crm_supplies_current_contract_fk (la que PostgREST no sabia descartar): un contracte renovat
 *     perdria el seu consum, i un contracte podria rebre diversos subministraments.
 * Després passa les files al mateix càlcul de KPI que el Centre de Control (operationalKpis).
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { dir, setup, U } from "./harness";
import { commercialSeries, operationalKpis, type CContract } from "@/core/control";

let db: Awaited<ReturnType<typeof setup>>["db"];
const sys = async <T,>(sql: string) => (await db.query<T>(sql)).rows;
const NOW = new Date("2026-11-15T10:00:00Z");

beforeAll(async () => {
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.includes("_down")).sort();
  ({ db } = await setup(files));
  const [{ id: cl }] = await sys<{ id: string }>(`insert into crm_clients (name, owner_id) values ('Forn Prova','${U.C1}') returning id`);
  const [{ id: s1 }] = await sys<{ id: string }>(`insert into crm_supplies (client_id, cups, annual_kwh) values ('${cl}','ES0031400000000001AB', 12000) returning id`);
  const [{ id: s2 }] = await sys<{ id: string }>(`insert into crm_supplies (client_id, cups, annual_kwh) values ('${cl}','ES0031400000000002AB', 5000) returning id`);
  // s1: contracte antic (finalitzat) + renovació (actiu, vigent); s2: un contracte actiu; i un sense subministrament
  const [{ id: k1 }] = await sys<{ id: string }>(`insert into crm_contracts (client_id, supply_id, retailer, status, signed_at, owner_id) values ('${cl}','${s1}','Nufri','finalitzat','2026-11-02','${U.C1}') returning id`);
  const [{ id: k2 }] = await sys<{ id: string }>(`insert into crm_contracts (client_id, supply_id, retailer, status, signed_at, owner_id, previous_contract_id) values ('${cl}','${s1}','Nufri','actiu','2026-11-03','${U.C1}','${k1}') returning id`);
  const [{ id: k3 }] = await sys<{ id: string }>(`insert into crm_contracts (client_id, supply_id, retailer, status, signed_at, owner_id) values ('${cl}','${s2}','Naturgy','actiu','2026-11-04','${U.C1}') returning id`);
  await sys(`insert into crm_contracts (client_id, retailer, status, signed_at, owner_id) values ('${cl}','Iberdrola','actiu','2026-11-05','${U.C1}')`);
  await sys(`update crm_supplies set current_contract_id = '${k2}' where id = '${s1}'`);
  await sys(`update crm_supplies set current_contract_id = '${k3}' where id = '${s2}'`);
}, 180_000);

type Row = { id: string; status: string; signed_at: string; created_at: string; retailer: string; owner_id: string; client_id: string; sup: { annual_kwh: number | null } | { annual_kwh: number | null }[] | null };
const toC = (r: Row): CContract => {
  const s = Array.isArray(r.sup) ? r.sup[0] : r.sup;
  return { id: r.id, status: r.status, signed_at: r.signed_at, created_at: r.created_at, end_date: null, retailer: r.retailer, product: null, owner_id: r.owner_id, created_by: null, client_id: r.client_id, kwh: s?.annual_kwh ?? null };
};

describe("KPI amb la relació crm_contracts_supply_id_fkey", () => {
  it("N:1 (correcta): una fila per contracte, sense duplicacions", async () => {
    const rows = await sys<Row>(`select c.id, c.status, c.signed_at::text, c.created_at::text, c.retailer, c.owner_id, c.client_id,
      (select row_to_json(s) from (select annual_kwh from crm_supplies where id = c.supply_id) s) as sup from crm_contracts c`);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
    const k = operationalKpis({ now: NOW, range: { from: "2026-11-01", to: "2026-11-30" }, contracts: rows.map(toC), expedients: [], leads: [], opps: [], tasks: [], incidents: [] });
    expect(k.contractes_periode).toBe(4);
    // 12 MWh (finalitzat) + 12 MWh (renovació) + 5 MWh; el contracte sense subministrament no suma i es compta a part
    expect(k.mwh).toBe(29);
    expect(k.mwh_sense_consum).toBe(1);
    const nov = commercialSeries(NOW, rows.map(toC), [], []).find((m) => m.month === "2026-11")!;
    expect(nov).toMatchObject({ contractes: 4, mwh: 29 });
  });

  it("1:N per crm_supplies_current_contract_fk (incorrecta) donaria uns altres MWh: per això cal el !hint", async () => {
    const rows = await sys<Row>(`select c.id, c.status, c.signed_at::text, c.created_at::text, c.retailer, c.owner_id, c.client_id,
      (select coalesce(json_agg(s), '[]'::json) from (select annual_kwh from crm_supplies where current_contract_id = c.id) s) as sup from crm_contracts c`);
    const k = operationalKpis({ now: NOW, range: { from: "2026-11-01", to: "2026-11-30" }, contracts: rows.map(toC), expedients: [], leads: [], opps: [], tasks: [], incidents: [] });
    expect(k.mwh).toBe(17); // el contracte finalitzat perd els seus 12 MWh
    expect(k.mwh).not.toBe(29);
  });

  it("les FK es conserven: no s'ha eliminat cap relació per amagar l'error", async () => {
    const r = await sys<{ conname: string }>(`select conname from pg_constraint where contype = 'f' and conname in ('crm_contracts_supply_id_fkey','crm_supplies_current_contract_fk') order by 1`);
    expect(r.map((x) => x.conname)).toEqual(["crm_contracts_supply_id_fkey", "crm_supplies_current_contract_fk"]);
  });
});
