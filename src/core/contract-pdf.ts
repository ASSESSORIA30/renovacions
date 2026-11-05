/**
 * Genera el PDF d'un document de contractació a partir dels blocs d'una plantilla ja omplerta (renderTemplate).
 * Funciona igual al servidor (Node) i al navegador. No inventa contingut: només maqueta el text de la plantilla
 * autoritzada i les dades de l'expedient.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { LOGO_DATA_URL } from "./logo";
import type { TemplateBlock } from "./contracting";

export interface ContractPdfMeta {
  title: string;
  code: string;               // codi d'expedient
  templateName: string;
  templateVersion: number;
  generatedAt: Date;
  generatedBy: string;
  documentVersion: number;
  origin: "intern" | "comercialitzadora";
}

const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [113, 113, 122];
const BRAND: [number, number, number] = [21, 128, 61];

export function buildContractPdf(blocks: TemplateBlock[], m: ContractPdfMeta): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setProperties({ title: m.title, subject: `Expedient ${m.code}`, creator: "Assessoria 3.0", author: m.generatedBy });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const L = 20, R = W - 20, maxW = R - L;
  let y = 18;

  const header = () => {
    if (m.origin === "intern") {
      try { doc.addImage(LOGO_DATA_URL, "PNG", L, 10, 11, 11); } catch { /* sense logo */ }
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK); doc.text("Assessoria 3.0", L + 14, 15);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text("Intelligence Platform", L + 14, 19);
    }
    doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Expedient ${m.code}`, R, 15, { align: "right" });
    doc.setDrawColor(228, 228, 231); doc.line(L, 24, R, 24);
    y = 32;
  };
  const ensure = (h: number) => { if (y + h > H - 22) { doc.addPage(); header(); } };
  header();

  for (const b of blocks) {
    if (b.t === "hr") { ensure(6); doc.setDrawColor(228, 228, 231); doc.line(L, y, R, y); y += 6; continue; }
    if (b.t === "table") {
      autoTable(doc, {
        startY: y, margin: { left: L, right: W - R, top: 32, bottom: 22 }, theme: "grid",
        body: b.rows.map(([k, v]) => [k, v]),
        styles: { font: "helvetica", fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: [228, 228, 231] },
        columnStyles: { 0: { cellWidth: 55, fontStyle: "bold", fillColor: [250, 250, 250] } },
        didDrawPage: (d) => { if (d.pageNumber > 1 && d.cursor && d.cursor.y < 30) header(); },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      continue;
    }
    const style = b.t === "h1" ? { size: 15, bold: true, color: INK, gap: 3, before: 2 } : b.t === "h2" ? { size: 11, bold: true, color: BRAND, gap: 2, before: 3 } : { size: 10, bold: false, color: INK, gap: 2.5, before: 0 };
    doc.setFont("helvetica", style.bold ? "bold" : "normal"); doc.setFontSize(style.size); doc.setTextColor(...style.color);
    const indent = b.t === "li" ? 5 : 0;
    const lines = doc.splitTextToSize(b.text, maxW - indent) as string[];
    const lh = style.size * 0.45;
    ensure(style.before + lines.length * lh + style.gap);
    y += style.before;
    if (b.t === "li") doc.text("•", L + 1, y);
    doc.text(lines, L + indent, y);
    y += lines.length * lh + style.gap;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(`${m.templateName} · plantilla v${m.templateVersion} · document v${m.documentVersion} · generat el ${m.generatedAt.toLocaleString("ca-ES", { timeZone: "Europe/Madrid" })} per ${m.generatedBy}`, L, H - 12);
    doc.text(`${i} / ${pages}`, R, H - 12, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
