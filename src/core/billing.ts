/**
 * FACTURACIÓ PRÒPIA (lògica pura). La font de veritat és la base de dades (migració 026): numeració, bloqueig de les
 * emeses i totals. Aquest fitxer replica el càlcul per a la previsualització i valida dades abans d'enviar-les.
 *  - Imports amb decimals exactes (decimal.js-light), arrodoniment a cèntims mig cap amunt.
 *  - Base per línia = quantitat × preu (arrodonida); IVA per tipus sobre la suma de la base d'aquell tipus.
 */
import { D, money } from "./commissions";

export type InvoiceStatus = "esborrany" | "emesa" | "parcialment_cobrada" | "cobrada" | "rectificada";
export type DisplayStatus = "esborrany" | "pendent_cobrament" | "parcialment_cobrada" | "cobrada" | "vencuda" | "rectificada" | "cobrament_no_consta";
export type InvoiceKind = "ordinaria" | "rectificativa";

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  esborrany: "Esborrany", pendent_cobrament: "Pendent de cobrament", parcialment_cobrada: "Parcialment cobrada", cobrada: "Cobrada",
  vencuda: "Vençuda", rectificada: "Rectificada", cobrament_no_consta: "Cobrament no consta",
};
export const DISPLAY_STATUS_TONE: Record<DisplayStatus, "zinc" | "amber" | "green" | "blue" | "red"> = {
  esborrany: "zinc", pendent_cobrament: "blue", parcialment_cobrada: "amber", cobrada: "green", vencuda: "red", rectificada: "zinc", cobrament_no_consta: "amber",
};
export const PAYMENT_METHODS = ["transferencia", "domiciliacio", "confirming", "compensacio", "efectiu", "altres"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  transferencia: "Transferència", domiciliacio: "Domiciliació", confirming: "Confirming", compensacio: "Compensació", efectiu: "Efectiu", altres: "Altres",
};
export const VAT_RATES = ["21", "10", "4", "0"] as const;

export interface LineInput { description: string; quantity: string | number; unitPrice: string | number; vatRate: string | number; vatExemption?: string | null }
export interface Totals { lines: { amount: string }[]; breakdown: { rate: string; base: string; vat: string }[]; base: string; vat: string; total: string }

/** Mateix càlcul que bill_recalc() a la base de dades. */
export function computeTotals(lines: LineInput[]): Totals {
  const out = lines.map((l) => ({ amount: money(D(l.quantity || 0).times(D(l.unitPrice || 0))), rate: D(l.vatRate || 0).toFixed(2) }));
  const by = new Map<string, ReturnType<typeof D>>();
  for (const l of out) by.set(l.rate, (by.get(l.rate) ?? D(0)).plus(l.amount));
  const breakdown = [...by.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([rate, base]) => ({ rate, base: money(base), vat: money(base.times(rate).div(100)) }));
  const base = breakdown.reduce((s, x) => s.plus(x.base), D(0));
  const vat = breakdown.reduce((s, x) => s.plus(x.vat), D(0));
  return { lines: out.map((l) => ({ amount: l.amount })), breakdown, base: money(base), vat: money(vat), total: money(base.plus(vat)) };
}

/** Número de factura: ordinària «AA-NNN», rectificativa «RAA-NNN». */
export function invoiceNumber(series: "ORD" | "REC", year: number, n: number) {
  return `${series === "REC" ? "R" : ""}${String(year % 100).padStart(2, "0")}-${String(n).padStart(3, "0")}`;
}

/** Validació d'un NIF/CIF/NIE espanyol (format i dígit de control). */
export function validTaxId(raw: string | null | undefined) {
  const n = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^\d{8}[A-Z]$/.test(n)) return "TRWAGMYFPDXBNJZSQVHLCKE"[Number(n.slice(0, 8)) % 23] === n[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(n)) return "TRWAGMYFPDXBNJZSQVHLCKE"[Number("XYZ".indexOf(n[0]) + n.slice(1, 8)) % 23] === n[8];
  if (!/^[A-HJNP-SUVW]\d{7}[0-9A-J]$/.test(n)) return false;
  const d = n.slice(1, 8).split("").map(Number);
  const a = d[1] + d[3] + d[5];
  const b = [0, 2, 4, 6].reduce((s, i) => { const x = d[i] * 2; return s + Math.floor(x / 10) + (x % 10); }, 0);
  const c = (10 - ((a + b) % 10)) % 10;
  return n[8] === String(c) || n[8] === "JABCDEFGHI"[c];
}

/** Normalització per comparar noms (majúscules, sense accents ni puntuació). */
export const normName = (s: string | null | undefined) =>
  (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Proposta de factura a partir del resum d'una liquidació (determinista: la IA no hi intervé). */
export function proposalFromStatement(s: { retailer: string; reference: string; period_from: string | null; period_to: string | null }, summary: { pending: string | number; negatives: string | number; doubtful: number }, vatRate = "21") {
  const base = money(D(summary.pending));
  const period = s.period_from && s.period_to ? `${fmtDay(s.period_from)} – ${fmtDay(s.period_to)}` : s.reference;
  const warnings: string[] = [];
  if (D(summary.negatives).lt(0)) warnings.push(`La liquidació inclou retrocessions per ${money(D(summary.negatives))} €, ja descomptades de l'import.`);
  if (summary.doubtful > 0) warnings.push(`${summary.doubtful} línia(es) encara pendents de revisar a la conciliació: comprova-les abans d'emetre.`);
  if (D(base).lte(0)) warnings.push("No queda cap import pendent de facturar d'aquesta liquidació.");
  const totals = computeTotals([{ description: "", quantity: 1, unitPrice: base, vatRate }]);
  return { concept: `Comissions ${s.retailer} · ${period}`, periodLabel: period, base, vat: totals.vat, total: totals.total, warnings };
}
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("ca-ES");

/** CSV compatible amb Excel (separador «;», decimals amb coma, BOM UTF-8). */
export function toCsv(head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}
