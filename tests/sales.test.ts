import { describe, expect, it } from "vitest";
import { STAGE_PROBABILITY, computeKpis, leadInput, opportunityInput, planAutomations, type AutoInput, type Rule } from "@/core/sales";
import { nameKey, planImport } from "@/core/crm-import";
import type { SourceContract } from "@/core/types";

const allRules = (over: Partial<Record<string, Partial<Rule>>> = {}): Rule[] =>
  ([["proposta_sense_resposta", { days: 3 }], ["venciment_contracte", { days: [90, 60, 30] }], ["lead_sense_contacte", { hours: 24 }], ["oportunitat_inactiva", { days: 7 }], ["proposta_acceptada", { due_days: 2 }], ["preparar_renovacio", { days_before: 90 }]] as const)
    .map(([key, params]) => ({ key, enabled: true, params: { ...params }, ...(over[key] ?? {}) }) as Rule);

const NOW = new Date("2026-11-10T10:00:00Z");
const base = (p: Partial<AutoInput> = {}): AutoInput => ({ now: NOW, rules: allRules(), opps: [], lastActivity: {}, leads: [], contracts: [], staffIds: ["boss"], ...p });
const opp = (p: Partial<AutoInput["opps"][number]>): AutoInput["opps"][number] => ({ id: "o1", title: "Gas Bar Pepe", stage: "contactat", owner_id: "c1", client_id: "cl1", lead_id: null, proposal_sent_at: null, won_at: null, last_activity_at: NOW.toISOString(), contract_id: null, ...p });
const kontract = (p: Partial<AutoInput["contracts"][number]>): AutoInput["contracts"][number] => ({ id: "k1", client_id: "cl1", retailer: "Iberdrola", end_date: "2026-12-20", status: "actiu", owner_id: null, client_owner_id: "c1", client_name: "Forn", legacy: false, created_at: "2026-11-01T00:00:00Z", ...p });

describe("Leads i oportunitats · validació", () => {
  it("un lead necessita almenys telèfon o correu; normalitza i deriva la província", () => {
    expect(leadInput.safeParse({ name: "Bar Pepe" }).success).toBe(false);
    const l = leadInput.parse({ name: "Bar Pepe", phone: "600 11 22 33", postal_code: "25001", services: ["gas", "gas", "alarmes"] });
    expect(l).toMatchObject({ phone: "+34600112233", province: "Lleida", services: ["gas", "alarmes"] });
    expect(leadInput.safeParse({ name: "X", email: "x@y.cat", services: ["piscines"] }).success).toBe(false);
  });
  it("una oportunitat és d'un lead o d'un client; el consum només s'aplica a energia", () => {
    expect(opportunityInput.safeParse({ title: "x", service: "gas" }).success).toBe(false);
    expect(opportunityInput.safeParse({ title: "x", service: "gas", lead_id: "00000000-0000-4000-8000-000000000001", annual_kwh: "45.000" }).success).toBe(true);
    expect(opportunityInput.parse({ title: "x", service: "gas", lead_id: "00000000-0000-4000-8000-000000000001", annual_kwh: "45.000" }).annual_kwh).toBe(45000);
    expect(opportunityInput.safeParse({ title: "x", service: "alarmes", client_id: "00000000-0000-4000-8000-000000000001", annual_kwh: 100 }).success).toBe(false);
  });
});

describe("Indicadors comercials", () => {
  it("calcula leads, oportunitats, propostes, conversió, MWh i comissions del període", () => {
    const k = computeKpis({
      from: "2026-11-01", to: "2026-12-01", now: "2026-11-15T00:00:00Z",
      leads: [{ created_at: "2026-11-02T10:00:00Z" }, { created_at: "2026-10-30T10:00:00Z" }],
      opps: [
        { stage: "estudi", mwh: 45, commission_eur: 200, probability: null, proposal_sent_at: null, won_at: null, lost_at: null, created_at: "2026-11-01", owner_id: "a" },
        { stage: "proposta_enviada", mwh: 10, commission_eur: 100, probability: 50, proposal_sent_at: "2026-11-05T00:00:00Z", won_at: null, lost_at: null, created_at: "2026-11-01", owner_id: "a" },
        { stage: "guanyat", mwh: 20, commission_eur: 300, probability: 100, proposal_sent_at: "2026-11-03T00:00:00Z", won_at: "2026-11-10T00:00:00Z", lost_at: null, created_at: "2026-10-01", owner_id: "a" },
        { stage: "perdut", mwh: 5, commission_eur: 50, probability: 0, proposal_sent_at: null, won_at: null, lost_at: "2026-11-11T00:00:00Z", created_at: "2026-10-01", owner_id: "a" },
        { stage: "guanyat", mwh: 99, commission_eur: 999, probability: 100, proposal_sent_at: null, won_at: "2026-10-10T00:00:00Z", lost_at: null, created_at: "2026-09-01", owner_id: "a" },
      ],
      tasks: [{ due_at: "2026-11-14T00:00:00Z", status: "pendent" }, { due_at: "2026-11-20T00:00:00Z", status: "pendent" }, { due_at: null, status: "feta" }],
    });
    expect(k).toMatchObject({ leadsNew: 1, openOpps: 2, proposalsSent: 2, won: 1, lost: 1, conversion: 50, mwhOpen: 55, commissionOpen: 300, commissionWon: 300, mwhWon: 20, pendingTasks: 2, overdueTasks: 1 });
    // ponderat: 45 MWh × 40 % (probabilitat per defecte d'«Estudi») + 10 × 50 %
    expect(k.mwhWeighted).toBe(Math.round((45 * STAGE_PROBABILITY.estudi / 100 + 5) * 10) / 10);
    expect(k.commissionWeighted).toBe(200 * 0.4 + 50);
  });
  it("sense tancaments, la conversió no es pot calcular (no és 0 %)", () => {
    expect(computeKpis({ from: "2026-11-01", to: "2026-12-01", leads: [], opps: [], tasks: [] }).conversion).toBeNull();
  });
});

describe("Automatitzacions (planificador idempotent)", () => {
  it("proposta enviada fa 3 dies sense resposta → tasca de seguiment (una sola clau)", () => {
    const o = opp({ stage: "proposta_enviada", proposal_sent_at: "2026-11-06T09:00:00Z" });
    const p = planAutomations(base({ opps: [o] }));
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0]).toMatchObject({ rule_key: "proposta_sense_resposta:o1:2026-11-06", kind: "seguiment", assigned_to: "c1", opportunity_id: "o1" });
    expect(planAutomations(base({ opps: [o], lastActivity: { o1: "2026-11-08T10:00:00Z" } })).tasks).toHaveLength(0); // ja hi ha resposta
    expect(planAutomations(base({ opps: [{ ...o, proposal_sent_at: "2026-11-09T09:00:00Z" }] })).tasks).toHaveLength(0); // encara no fa 3 dies
  });
  it("contracte que venç: un avís per llindar (90, 60, 30) i res per a la cartera importada", () => {
    const at = (end: string) => planAutomations(base({ contracts: [kontract({ end_date: end })] })).notifications.map((n) => n.rule_key);
    expect(at("2027-02-05")).toEqual(["venciment_contracte:k1:90"]); // 87 dies
    expect(at("2027-01-05")).toEqual(["venciment_contracte:k1:60"]); // 56 dies
    expect(at("2026-11-30")).toEqual(["venciment_contracte:k1:30"]); // 20 dies
    expect(at("2027-06-01")).toEqual([]);
    expect(planAutomations(base({ contracts: [kontract({ end_date: "2026-11-30", legacy: true })] })).notifications).toHaveLength(0);
    // sense responsable: avisa Direcció / cap d'administració
    expect(planAutomations(base({ contracts: [kontract({ end_date: "2026-11-30", client_owner_id: null })] })).notifications[0].user_id).toBe("boss");
  });
  it("lead nou sense primer contacte després de 24 h → avís al responsable (o a Administració si no en té)", () => {
    const lead = { id: "l1", name: "Bar Pepe", status: "nou" as const, owner_id: "c1", created_at: "2026-11-08T09:00:00Z", first_contact_at: null };
    expect(planAutomations(base({ leads: [lead] })).notifications[0]).toMatchObject({ rule_key: "lead_sense_contacte:l1", user_id: "c1" });
    expect(planAutomations(base({ leads: [{ ...lead, owner_id: null }] })).notifications[0].user_id).toBe("boss");
    expect(planAutomations(base({ leads: [{ ...lead, created_at: "2026-11-10T01:00:00Z" }] })).notifications).toHaveLength(0);
    expect(planAutomations(base({ leads: [{ ...lead, first_contact_at: "2026-11-08T10:00:00Z" }] })).notifications).toHaveLength(0);
  });
  it("oportunitat 7 dies sense activitat → com a màxim un avís per setmana", () => {
    const o = opp({ last_activity_at: "2026-11-01T10:00:00Z" });
    const k1 = planAutomations(base({ opps: [o] })).notifications[0].rule_key;
    const k2 = planAutomations(base({ opps: [o], now: new Date("2026-11-11T10:00:00Z") })).notifications[0].rule_key;
    const k3 = planAutomations(base({ opps: [o], now: new Date("2026-11-17T10:00:00Z") })).notifications[0].rule_key;
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
    expect(planAutomations(base({ opps: [{ ...o, stage: "perdut" }] })).notifications).toHaveLength(0);
  });
  it("proposta acceptada → tasca de tramitació (fins que hi hagi contracte)", () => {
    const o = opp({ stage: "guanyat", won_at: "2026-11-10T08:00:00Z" });
    expect(planAutomations(base({ opps: [o] })).tasks[0]).toMatchObject({ rule_key: "proposta_acceptada:o1", kind: "tramitacio", due_at: "2026-11-12T08:00:00.000Z" });
    expect(planAutomations(base({ opps: [{ ...o, contract_id: "k1" }] })).tasks).toHaveLength(0);
  });
  it("contracte activat al CRM → tasca per preparar la renovació 90 dies abans", () => {
    const t = planAutomations(base({ contracts: [kontract({ end_date: "2027-10-31" })] })).tasks;
    expect(t[0]).toMatchObject({ rule_key: "preparar_renovacio:k1:2027-10-31", kind: "renovacio", assigned_to: "c1", due_at: "2027-08-02T09:00:00.000Z" });
    expect(planAutomations(base({ contracts: [kontract({ end_date: "2027-10-31", created_at: "2026-01-01T00:00:00Z" })] })).tasks).toHaveLength(0); // no és nou
  });
  it("les regles desactivades no generen res i els paràmetres es respecten", () => {
    const o = opp({ stage: "proposta_enviada", proposal_sent_at: "2026-11-06T09:00:00Z" });
    expect(planAutomations(base({ opps: [o], rules: allRules({ proposta_sense_resposta: { enabled: false } }) })).tasks).toHaveLength(0);
    expect(planAutomations(base({ opps: [o], rules: allRules({ proposta_sense_resposta: { params: { days: 10 } } }) })).tasks).toHaveLength(0);
  });
  it("executar-ho dues vegades produeix exactament les mateixes claus (idempotència)", () => {
    const input = base({ opps: [opp({ stage: "proposta_enviada", proposal_sent_at: "2026-11-01T09:00:00Z", last_activity_at: "2026-11-01T09:00:00Z" })], contracts: [kontract({})], leads: [{ id: "l1", name: "x", status: "nou", owner_id: "c1", created_at: "2026-11-01T00:00:00Z", first_contact_at: null }] });
    const a = planAutomations(input), b = planAutomations(input);
    expect([...a.tasks, ...a.notifications].map((x) => x.rule_key)).toEqual([...b.tasks, ...b.notifications].map((x) => x.rule_key));
    expect(new Set(a.tasks.map((t) => t.rule_key)).size).toBe(a.tasks.length);
  });
});

describe("Fase 1 · importació repetida sense NIF", () => {
  const c = (p: Partial<SourceContract>): SourceContract => ({
    id: "c1", cups: "ES0021000000000009ZZ", cif: null, cliente: "Maria Puig", direccion: null, poblacion: "Lleida", provincia: "Lleida", cp: "25001", telefono: "600112233", email: null,
    tipo: "luz", comercializadora: "Endesa", comercializadoraAnterior: null, tarifa: "2.0TD", producto: null, precioContratado: null, consumoAnual: null, potencia: null, potencias: null,
    estadoOrigen: null, estadoAlta: null, tipoAlta: null, excedentes: null, observaciones: null, comentario: null, comentarioLlamada: null, renovat2026: null, representante: null, captador: null, comercial: "X", colaborador: null,
    fechaInicio: null, fechaInicioFuente: null, vencimientoOriginal: null, vencimiento: "2027-01-01", renovacionTacita: false, fechaBaja: null, contratosPrevios: 0, registrosDiarios: 0, status: "pendiente", motivoRechazo: null, source: "real", ...p,
  });
  it("un client sense NIF ja creat es reconeix per nom i telèfon i no es duplica", () => {
    const ex = { taxIds: new Map<string, string>(), cups20: new Set<string>(), legacyIds: new Set<string>(), ownerByCode: new Map<string, string>(), collaboratorByKey: new Map<string, string>(), nameKeys: new Map([[nameKey("Maria Puig", "+34600112233"), "client-maria"]]) };
    const plan = planImport([{ contract: c({ id: "c2", cups: "ES0021000000000008ZZ" }), status: null, removed: false }], ex, "2026-10-31");
    expect(plan.stats).toMatchObject({ newClients: 0, existingClients: 1 });
    expect(plan.groups[0].existingId).toBe("client-maria");
  });
});
