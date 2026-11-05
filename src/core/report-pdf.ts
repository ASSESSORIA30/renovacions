/** PDF professional d'informes (diari, setmanal, mensual). Només dades reals; els buits es mostren com a «sense dades». */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { LOGO_DATA_URL } from "./logo";

export type ReportSection =
  | { type: "kpis"; title: string; items: { label: string; value: string; note?: string }[] }
  | { type: "table"; title: string; head: string[]; rows: (string | number)[][]; empty?: string; align?: ("left" | "right")[] }
  | { type: "text"; title: string; body: string };
export interface ReportPdfInput { title: string; subtitle: string; scope: string; generatedBy: string; generatedAt: Date; sections: ReportSection[]; footnote?: string }

const BRAND: [number, number, number] = [21, 128, 61];

/**
 * Les fonts estàndard de jsPDF no dibuixen el punt volat (·): «l·l» es mostra com «l.l» (grafia alternativa admesa) i el
 * separador « · » com « - », perquè el PDF no perdi lletres.
 */
const fix = (t: string) => t.replace(/l·l/gi, (m) => `${m[0]}.${m[2]}`).replace(/\s·\s/g, " - ").replace(/·/g, ".");
const deep = <T,>(x: T): T => (typeof x === "string" ? (fix(x) as T) : Array.isArray(x) ? (x.map(deep) as T) : x && typeof x === "object" ? (Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deep(v)])) as T) : x);

export function buildReportPdf(input: ReportPdfInput): Uint8Array {
  const p = { ...deep(input), generatedAt: input.generatedAt, generatedBy: fix(input.generatedBy) };
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), L = 16, R = W - 16;
  try { doc.addImage(LOGO_DATA_URL, "PNG", L, 10, 11, 11); } catch { /* sense logo */ }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(24, 24, 27); doc.text("Assessoria 3.0", L + 14, 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(113, 113, 122); doc.text(p.scope, L + 14, 19);
  doc.setFillColor(...BRAND); doc.rect(L, 25, R - L, 0.6, "F");
  doc.setTextColor(24, 24, 27); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(p.title, L, 35);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(82, 82, 91); doc.text(p.subtitle, L, 41);
  let y = 48;
  const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const heading = (t: string) => {
    if (y > H - 40) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(24, 24, 27); doc.text(t, L, y); y += 3;
  };
  for (const s of p.sections) {
    heading(s.title);
    if (s.type === "kpis") {
      const cols = 4, cw = (R - L) / cols;
      const rows: { label: string; value: string; note?: string }[][] = [];
      for (let i = 0; i < s.items.length; i += cols) rows.push(s.items.slice(i, i + cols));
      autoTable(doc, {
        startY: y + 1, margin: { left: L, right: W - R, bottom: 18 }, theme: "plain",
        body: rows.map((r) => r.map((k) => ({ content: `${k.value}\n${k.label}${k.note ? `\n${k.note}` : ""}` }))),
        styles: { fontSize: 8.5, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineColor: [228, 228, 231], lineWidth: 0.2, textColor: [63, 63, 70], valign: "top" },
        columnStyles: Object.fromEntries(Array.from({ length: cols }, (_, i) => [i, { cellWidth: cw }])),
        didParseCell: (d) => { d.cell.styles.fillColor = [250, 250, 250]; },
        didDrawCell: (d) => {
          // valor en negreta i més gran a la primera línia
          if (d.section !== "body") return;
          const raw = String((d.cell.raw as { content?: string })?.content ?? "");
          const first = raw.split("\n")[0];
          doc.setFillColor(250, 250, 250); doc.rect(d.cell.x + 0.3, d.cell.y + 0.3, d.cell.width - 0.6, 5.2, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(24, 24, 27); doc.text(first, d.cell.x + 2.5, d.cell.y + 4.6);
          doc.setFont("helvetica", "normal");
        },
      });
      y = last() + 7;
    } else if (s.type === "table") {
      if (!s.rows.length) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(113, 113, 122); doc.text(s.empty ?? "Sense dades en aquest període.", L, y + 4); y += 10; continue; }
      autoTable(doc, {
        startY: y + 1, margin: { left: L, right: W - R, bottom: 18 }, theme: "grid", head: [s.head], body: s.rows.map((r) => r.map(String)),
        styles: { fontSize: 8.3, cellPadding: 1.6, lineColor: [228, 228, 231] }, headStyles: { fillColor: BRAND, fontSize: 8.3 },
        columnStyles: Object.fromEntries((s.align ?? []).map((a, i) => [i, { halign: a }])),
      });
      y = last() + 7;
    } else {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(63, 63, 70);
      const lines = doc.splitTextToSize(s.body, R - L) as string[];
      doc.text(lines, L, y + 4); y += 6 + lines.length * 4;
    }
  }
  if (p.footnote) {
    if (y > H - 30) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(113, 113, 122);
    doc.text(doc.splitTextToSize(p.footnote, R - L) as string[], L, y + 2);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(113, 113, 122);
    doc.text(`Generat el ${p.generatedAt.toLocaleString("ca-ES", { timeZone: "Europe/Madrid" })} per ${p.generatedBy} - document intern`, L, H - 9);
    doc.text(`${i} / ${pages}`, R, H - 9, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
