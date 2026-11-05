/**
 * Fase 14 · Genera les respostes simulades de les proves al navegador (e2e/auditor/*.json) a partir del lector i
 * del motor d'auditoria REALS: la previsualització surt de l'Excel anonimitzat de Gana i l'auditoria, d'un escenari
 * fictici. Ús: npx tsx scripts/e2e-auditor-fixtures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { gridFromBytes, readSettlement } from "@/core/settlement-reader";
import { auditCommissions, type AuditContract, type AuditLine } from "@/core/commission-audit";

const out = "e2e/auditor";
mkdirSync(out, { recursive: true });
const r = readSettlement(gridFromBytes(XLSX as never, readFileSync("tests/fixtures/liquidacions/75368-anonim.xlsx"), "75368.xlsx"));
writeFileSync(`${out}/preview.json`, JSON.stringify({
  supplier: r.supplier, format: r.format, retailer: r.supplier?.name ?? "", sheets: r.sheets, byMovement: r.byMovement, total: r.total, count: r.movements.length, errors: r.errors, warnings: r.warnings, formatChanged: null, duplicateOf: null,
  movements: r.movements.map((m) => ({ sheet: m.sheet, row: m.row, cups: m.cups, movement: m.movement, kind: m.kind, energy: m.energy, product: m.product ?? m.tariff, eventDate: m.eventDate, docStatus: m.docStatus, amount: m.amount, unit: m.unit, flags: m.flags })),
}));

const K = (id: string, act: string, amount: number | null, extra: Partial<AuditContract> = {}): AuditContract => ({ id, client_id: `cl-${id}`, client_name: `CLIENT FICTICI ${id}`, retailer: "Gana Energía", product: "Tarifa 24 horas", status: "actiu", cups: `ES00310000000000${id.padStart(2, "0")}AA`, activated_at: act, econ_status: "actiu", cancelled_at: null, is_renewal: false, deferred_until: null, deferral_reason: null, calc: amount == null ? null : { amount: amount.toFixed(2), status: "calculat", rule_id: "r", rule_key: "gana_alta", rule_version: 1 }, ...extra });
let n = 0;
const L = (c: string | null, amount: string, rec: string, extra: Partial<AuditLine> = {}): AuditLine => ({ id: `l${++n}`, statement_id: "s1", reference: "GANA-2026-10", received_at: rec, period_from: null, period_to: null, line_no: n, cups: c ? `ES00310000000000${c.padStart(2, "0")}AA` : "ES0031000000000099ZZ", external_ref: null, contract_ref: null, client_name: null, concept: "Alta llum", amount, kind: Number(amount) < 0 ? "retrocessio" : "comissio", match_status: c ? "conciliat" : "no_identificat", contract_id: c, expected_amount: null, movement: "alta", event_date: null, source_sheet: "Altas LUZ", source_row: n + 1, file_name: "75368.xlsx", match_confidence: null, match_reason: c ? null : "Cap subministrament del CRM té el CUPS ES0031000000000099ZZ.", candidates: 0, collected: "0.00", compensated: "0.00", ...extra });
const contracts = [K("1", "2026-06-01", 100), K("2", "2026-05-01", 100), K("3", "2026-04-10", 120), K("5", "2026-06-15", 100), K("6", "2026-07-01", 40, { is_renewal: true })];
const lines = [L("1", "100.00", "2026-07-10", { collected: "100.00" }), L("5", "85.00", "2026-08-10"), L("6", "40.00", "2026-09-10", { movement: "renovacio", collected: "20.00" }), L(null, "70.00", "2026-10-15"), L("1", "100.00", "2026-10-15", { match_status: "duplicat" })];
const res = auditCommissions({
  retailer: "Gana Energía", from: "2025-11-03", to: "2026-11-03", today: "2026-11-03", lines, contracts, settledContracts: new Set(),
  rules: new Map([["r", { id: "r", rule_key: "gana_alta", version: 1, name: "Gana · alta", status: "aprovada", kind: "fix_contracte", value: 100, unit: "eur", product: null, retailer: "Gana Energía", conditions: {}, valid_from: "2025-01-01", valid_to: null }]]),
  terms: { paymentDays: 60, claimDays: null }, clawRules: [], claimed: new Map(), claimItems: [], collectDays: 30,
});
writeFileSync(`${out}/audit.json`, JSON.stringify({
  from: "2025-11-03", to: "2026-11-03", retailer: null, retailers: ["Gana Energía", "Niba"], kpis: res.kpis,
  groups: [{ retailer: "Gana Energía", terms: { paymentDays: 60, claimDays: null }, kpis: res.kpis, warnings: [], commissions: res.commissions, lines: res.lines, alerts: res.alerts, claimable: res.discrepancies.filter((x) => x.selectable).map((x) => ({ key: x.key, amount: x.claimable, kind: x.kind, client: x.client, cups: x.cups, reason: x.reason })) }],
  alertsEnabled: {}, canEdit: true,
}, null, 0));
console.log("preview", r.movements.length, r.total, "· audit alerts", res.alerts.length, "claimable", res.discrepancies.filter((x) => x.selectable).length);
