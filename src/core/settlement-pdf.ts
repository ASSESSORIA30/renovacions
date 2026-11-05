/** PDF resum de liquidació per a un comercial o col·laborador (sense retencions ni nòmines: només comissions). */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { LOGO_DATA_URL } from "./logo";
import { SETTLEMENT_STATUS_LABEL, eurFmt, type SettlementStatus } from "./commissions";

export interface SettlementPdfInput {
  code: string; kind: "comercial" | "collaborador"; beneficiary: string; periodFrom: string; periodTo: string; status: SettlementStatus;
  totals: { fixed: string; variable: string; bonus: string; cancellations: string; adjustments: string; gross: string; approved: string | null; paid: string; pending: string };
  lines: { contract: string | null; client: string | null; category: string; description: string; amount: string }[];
  payments: { paid_at: string; amount: string; method: string; reference: string }[];
  approvedBy: string | null; approvedAt: string | null; generatedBy: string; generatedAt: Date;
}
const CAT: Record<string, string> = { fixa: "Fixa", variable: "Variable", bonificacio: "Bonificació", anullacio: "Anul·lació / retrocessió", ajustament: "Ajustament" };
const d = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("ca-ES") : "—");

export function buildSettlementPdf(p: SettlementPdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), L = 18, R = W - 18;
  try { doc.addImage(LOGO_DATA_URL, "PNG", L, 10, 11, 11); } catch { /* sense logo */ }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Assessoria 3.0", L + 14, 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(113, 113, 122); doc.text("Liquidació de comissions", L + 14, 19);
  doc.text(`${p.code} · ${SETTLEMENT_STATUS_LABEL[p.status]}`, R, 15, { align: "right" });
  doc.setTextColor(24, 24, 27); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text(`${p.kind === "comercial" ? "Comercial" : "Col·laborador"}: ${p.beneficiary}`, L, 34);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Període: ${d(p.periodFrom)} – ${d(p.periodTo)}`, L, 41);
  if (p.status === "esborrany" || p.status === "revisio") { doc.setTextColor(180, 83, 9); doc.text("ESBORRANY · pendent d'aprovació (imports no definitius)", L, 47); doc.setTextColor(24, 24, 27); }

  autoTable(doc, {
    startY: 52, margin: { left: L, right: W - R }, theme: "plain", styles: { fontSize: 9.5, cellPadding: 1.6 },
    body: [
      ["Comissions fixes", eurFmt(p.totals.fixed)], ["Comissions variables", eurFmt(p.totals.variable)], ["Bonificacions", eurFmt(p.totals.bonus)],
      ["Anul·lacions i retrocessions", eurFmt(p.totals.cancellations)], ["Ajustaments", eurFmt(p.totals.adjustments)],
      [{ content: "Total brut de comissions", styles: { fontStyle: "bold" } }, { content: eurFmt(p.totals.gross), styles: { fontStyle: "bold" } }],
      ["Import aprovat", p.totals.approved != null ? eurFmt(p.totals.approved) : "Pendent d'aprovació"], ["Import pagat", eurFmt(p.totals.paid)],
      [{ content: "Saldo pendent", styles: { fontStyle: "bold" } }, { content: eurFmt(p.totals.pending), styles: { fontStyle: "bold" } }],
    ],
    columnStyles: { 0: { cellWidth: 70 }, 1: { halign: "right", cellWidth: 40 } },
  });
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y, margin: { left: L, right: W - R, bottom: 22 }, theme: "grid", head: [["Contracte / client", "Tipus", "Concepte", "Import"]],
    body: p.lines.map((l) => [l.client ?? l.contract ?? "—", CAT[l.category] ?? l.category, l.description, eurFmt(l.amount)]),
    styles: { fontSize: 8.5, cellPadding: 1.8, lineColor: [228, 228, 231] }, headStyles: { fillColor: [21, 128, 61] }, columnStyles: { 3: { halign: "right", cellWidth: 26 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  if (p.payments.length) {
    autoTable(doc, { startY: y, margin: { left: L, right: W - R, bottom: 22 }, theme: "grid", head: [["Data de pagament", "Mètode", "Referència", "Import"]], body: p.payments.map((x) => [d(x.paid_at), x.method, x.reference, eurFmt(x.amount)]), styles: { fontSize: 8.5 }, headStyles: { fillColor: [82, 82, 91] }, columnStyles: { 3: { halign: "right" } } });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }
  doc.setFontSize(8); doc.setTextColor(113, 113, 122);
  const note = doc.splitTextToSize("Imports bruts de comissions. Aquest document no inclou retencions fiscals, cotitzacions ni conceptes de nòmina, que s'apliquen segons la configuració laboral i fiscal corresponent.", R - L) as string[];
  if (y + 12 > H - 20) { doc.addPage(); y = 20; }
  doc.text(note, L, y);
  if (p.approvedBy) doc.text(`Aprovada per ${p.approvedBy} el ${d(p.approvedAt)}.`, L, y + note.length * 3.6 + 2);
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.text(`${p.code} · generat el ${p.generatedAt.toLocaleString("ca-ES", { timeZone: "Europe/Madrid" })} per ${p.generatedBy}`, L, H - 10); doc.text(`${i} / ${pages}`, R, H - 10, { align: "right" }); }
  return new Uint8Array(doc.output("arraybuffer"));
}
