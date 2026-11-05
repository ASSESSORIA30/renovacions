import { describe, expect, it } from "vitest";
import { teamDashboard, workdaysBetween } from "@/core/teams";

const NOW = new Date("2026-11-18T10:00:00Z"); // dimecres
const members = [{ id: "c1", name: "Anna" }, { id: "c2", name: "Biel" }];
const base = {
  now: NOW, members,
  contracts: [
    { id: "k1", owner_id: "c1", status: "actiu", signed_at: "2026-11-03", created_at: "2026-11-03T09:00:00Z", end_date: "2027-01-10", kwh: 12000 },
    { id: "k2", owner_id: "c1", status: "anullat", signed_at: "2026-11-04", created_at: "2026-11-04T09:00:00Z", end_date: null, kwh: 50000 },
    { id: "k3", owner_id: "c2", status: "actiu", signed_at: "2026-11-05", created_at: "2026-11-05T09:00:00Z", end_date: null, kwh: null },
    { id: "kx", owner_id: "intrus", status: "actiu", signed_at: "2026-11-05", created_at: "2026-11-05T09:00:00Z", end_date: null, kwh: 99999 },
  ],
  opps: [
    { owner_id: "c1", stage: "guanyat", won_at: "2026-11-06T10:00:00Z", lost_at: null, created_at: "2026-11-01T10:00:00Z", mwh: 40, commission_eur: 300 },
    { owner_id: "c1", stage: "perdut", won_at: null, lost_at: "2026-11-07T10:00:00Z", lost_at_: null, created_at: "2026-10-01T10:00:00Z", mwh: 10 } as never,
    { owner_id: "c2", stage: "proposta_enviada", won_at: null, lost_at: null, created_at: "2026-11-02T10:00:00Z", mwh: 5 },
  ],
  tasks: [
    { id: "t1", title: "Trucar", assigned_to: "c2", status: "pendent", due_at: "2026-11-10T10:00:00Z" },
    { id: "t2", title: "Enviar", assigned_to: "c1", status: "feta", due_at: "2026-11-10T10:00:00Z" },
  ],
  targets: [{ user_id: "c1", metric: "mwh" as const, target: 30 }, { user_id: "c2", metric: "guanyades" as const, target: 2 }, { user_id: "c1", metric: "comissio" as const, target: 100 }],
  lastActivity: { c1: "2026-11-17T09:00:00Z", c2: "2026-11-06T09:00:00Z" },
};

describe("Panell del Cap d'equip", () => {
  it("KPI de l'equip sense duplicar ni comptar anul·lats o comercials d'altres equips", () => {
    const d = teamDashboard({ ...base, commissions: null });
    expect(d.kpis.contractesMes).toBe(2);
    expect(d.kpis.mwhMes).toBe(12);
    expect(d.kpis.contractesSenseConsum).toBe(1);
    expect(d.kpis.conversio).toBe(50);
    expect(d.kpis.oportunitatsObertes).toBe(1);
    expect(d.kpis.renovacionsPendents).toBe(1);
    expect(d.kpis.tasquesVencudes).toBe(1);
    expect(d.kpis.comissionsAutoritzades).toBeNull();
  });
  it("objectius: sense autorització no es mostren els de comissió", () => {
    const d = teamDashboard({ ...base, commissions: null });
    const anna = d.perMember.find((m) => m.id === "c1")!;
    expect(anna.objectives.map((o) => [o.metric, o.actual, o.reached])).toEqual([["mwh", 40, true]]);
    expect(d.kpis.objectius).toEqual({ assolits: 1, total: 2 });
    expect(anna.comissio).toBeNull();
  });
  it("amb autorització, comissions del mes dels comercials de l'equip", () => {
    const d = teamDashboard({ ...base, commissions: [{ beneficiary_id: "c1", kind: "meritacio", amount: "120.50", period: "2026-11-03" }, { beneficiary_id: "c1", kind: "meritacio", amount: 50, period: "2026-10-03" }] });
    expect(d.kpis.comissionsAutoritzades).toBe(120.5);
    expect(d.perMember.find((m) => m.id === "c1")!.objectives.find((o) => o.metric === "comissio")!.actual).toBe(300);
  });
  it("detecta comercials sense activitat (dies laborables) i genera alertes", () => {
    const d = teamDashboard({ ...base, commissions: null });
    expect(d.perMember.find((m) => m.id === "c2")!.inactiu).toBe(true);
    expect(d.perMember.find((m) => m.id === "c1")!.inactiu).toBe(false);
    expect(d.alerts.map((a) => a.kind).sort()).toEqual(["inactivitat", "tasca_vencuda"]);
    expect(workdaysBetween("2026-11-13T09:00:00Z", NOW)).toBe(3); // dv → dc: dl, dt, dc
  });
});
