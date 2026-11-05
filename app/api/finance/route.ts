import { z } from "zod";
import {
  accrueContract, addCost, collaboratorSplit, autoMatch, buildSettlement, calculateContract, cancelContract, collaborators, computeIncentives, contractEconomics, createStatement, dashboard, deleteDraft,
  getSettlement, getStatement, listRules, listSettlements, listStatements, manualEntry, myCommissions, profitability, ranking, registerPayment, registerReceipt, resolveLine,
  saveCollaboratorTerms, saveEconomics, saveRule, proposeRules, setRuleStatus, setTarget, settlementPdf, settlementStatus, simulate, previewStatement, missingContracts, createMissingContracts, createContractForLine, conciliateAll,
} from "@/server/finance";
import { auditOverview } from "@/server/commission-audit";
import { finStaff } from "@/server/permissions";
import { handler, HttpError, requireUser } from "@/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;   // Fase 14.2: importar i identificar liquidacions grans

/**
 * Control econòmic (CRM Fase 4).
 * GET ?r=dashboard|profitability|ranking|rules|contract|settlements|settlement|pdf|collaborators|statements|statement|mine|audit
 * Tot es llegeix i s'escriu amb la sessió de l'usuari: la RLS decideix què pot veure (els comercials i col·laboradors
 * només les seves comissions; mai la capa del proveïdor ni els marges).
 */
export async function GET(req: Request) {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.r === "pdf") {
    try {
      const u = await requireUser();
      const { pdf, fileName } = await settlementPdf(u, p.id ?? "");
      return new Response(pdf as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "no-store" } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status });
    }
  }
  return get(req);
}
const get = handler(async (req) => {
  const u = await requireUser();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "dashboard": return dashboard(u, p);
    case "profitability": return profitability(u, p);
    case "ranking": return ranking(u, p);
    case "rules": return listRules(u);
    case "access": return { econ: await finStaff(u) };
    case "contract": return contractEconomics(u, p.id ?? "");
    case "settlements": return listSettlements(u, p);
    case "settlement": return getSettlement(u, p.id ?? "");
    case "collaborators": return collaborators(u);
    case "statements": return listStatements(u);
    case "statement": return getStatement(u, p.id ?? "");
    case "collab_split": return collaboratorSplit(u, p.id ?? "");
    case "mine": return myCommissions(u);
    case "audit": return auditOverview(u, p);
    default: throw new HttpError(400, "Petició no vàlida");
  }
});

const body = z.object({
  action: z.enum(["calculate", "accrue", "economics", "cancel", "manual", "cost", "rule_save", "rules_propose", "rule_status", "simulate", "incentives", "settlement_build", "settlement_status", "settlement_delete", "payment", "collab_terms", "statement_create", "statement_preview", "statement_match", "missing_contracts", "create_missing_contracts", "line_contract", "conciliate_all", "line_resolve", "receipt", "target"]),
  id: z.string().uuid().optional(),
  data: z.unknown().optional(),
  status: z.string().max(30).optional(),
  month: z.string().max(7).optional(),
  file: z.object({ name: z.string().max(200), base64: z.string().max(7_500_000) }).optional(),
});
export const POST = handler(async (req) => {
  const u = await requireUser();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  const b = p.data;
  const id = () => { if (!b.id) throw new HttpError(400, "Falta l'identificador"); return b.id; };
  switch (b.action) {
    case "calculate": return calculateContract(u, id());
    case "accrue": return accrueContract(u, id());
    case "economics": return saveEconomics(u, id(), b.data);
    case "cancel": return cancelContract(u, id(), b.data);
    case "manual": return manualEntry(u, b.data);
    case "cost": return addCost(u, b.data);
    case "rule_save": return saveRule(u, b.data, b.id);
    case "rules_propose": return proposeRules(u, b.data);
    case "rule_status": return setRuleStatus(u, id(), (["aprovada", "retirada", "pendent_aprovacio", "esborrany"].includes(b.status ?? "") ? b.status : "esborrany") as "aprovada");
    case "simulate": return simulate(u, b.data);
    case "incentives": return computeIncentives(u, b.month ?? "");
    case "settlement_build": return buildSettlement(u, b.data);
    case "settlement_status": return settlementStatus(u, id(), (["revisio", "esborrany", "aprovada", "anullada"].includes(b.status ?? "") ? b.status : "revisio") as "revisio");
    case "settlement_delete": return deleteDraft(u, id());
    case "payment": return registerPayment(u, id(), b.data);
    case "collab_terms": return saveCollaboratorTerms(u, id(), b.data);
    case "statement_create": return createStatement(u, b.data, b.file);
    case "statement_preview": return previewStatement(u, b.data, b.file);
    case "statement_match": return autoMatch(u, id());
    case "missing_contracts": return missingContracts(u, id());
    case "create_missing_contracts": return createMissingContracts(u, id(), b.data);
    case "line_contract": return createContractForLine(u, b.data);
    case "conciliate_all": return conciliateAll(u, id(), b.data);
    case "line_resolve": return resolveLine(u, b.data);
    case "receipt": return registerReceipt(u, id(), b.data);
    case "target": return setTarget(u, b.data);
  }
});
