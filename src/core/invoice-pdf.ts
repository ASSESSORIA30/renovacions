/** PDF de factura d'Assessoria 3.0 (logotip oficial, colors corporatius verd, negre, gris i blanc). */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { LOGO_DATA_URL } from "./logo";
import { eurFmt } from "./commissions";

export interface InvoicePdfInput {
  number: string | null; kind: "ordinaria" | "rectificativa"; draft: boolean;
  issueDate: string | null; dueDate: string | null;
  issuer: { name: string; nif: string; address: string; postal_code: string; city: string; province?: string | null; iban?: string | null; email?: string | null; phone?: string | null };
  client: { legal_name: string; nif: string; address: string | null; postal_code: string | null; city: string | null; province: string | null; country?: string | null };
  concept: string | null; periodLabel: string | null; orderRefLabel: string | null; orderRef: string | null; notes: string | null;
  rectifies: { number: string; date: string | null; reason: string | null } | null;
  lines: { description: string; quantity: string; unit_price: string; vat_rate: string; vat_exemption: string | null; amount: string }[];
  breakdown: { rate: string; base: string; vat: string }[];
  base: string; vat: string; total: string; footer?: string | null;
  logo?: string | null;
}
const GREEN: [number, number, number] = [21, 128, 61];
const INK: [number, number, number] = [24, 24, 27];
const GREY: [number, number, number] = [113, 113, 122];
const d = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("ca-ES") : "—");
const qty = (s: string) => Number(s).toLocaleString("ca-ES", { maximumFractionDigits: 4 });
const price = (s: string) => Number(s).toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + " €";

export function buildInvoicePdf(p: InvoicePdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), L = 16, R = W - 16;
  // capçalera
  doc.setFillColor(...GREEN); doc.rect(0, 0, W, 4, "F");
  try { doc.addImage(p.logo || LOGO_DATA_URL, "PNG", L, 10, 24, 24); } catch { /* sense logotip */ }
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(p.issuer.name, L + 28, 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY);
  const iss = [`CIF: ${p.issuer.nif}`, p.issuer.address, `${p.issuer.postal_code} ${p.issuer.city}${p.issuer.province && p.issuer.province.toLowerCase() !== p.issuer.city.toLowerCase() ? ` (${p.issuer.province})` : ""}`, [p.issuer.phone, p.issuer.email].filter(Boolean).join(" · ")].filter(Boolean);
  iss.forEach((t, i) => doc.text(t, L + 28, 21 + i * 4));
  doc.setTextColor(...GREEN); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  doc.text(p.kind === "rectificativa" ? "FACTURA RECTIFICATIVA" : "FACTURA", R, 17, { align: "right" });
  doc.setTextColor(...INK); doc.setFontSize(10);
  doc.text(p.number ? `Núm. ${p.number}` : "ESBORRANY · sense número", R, 24, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY);
  doc.text(`Data d'emissió: ${d(p.issueDate)}`, R, 29, { align: "right" });
  if (p.dueDate) doc.text(`Venciment: ${d(p.dueDate)}`, R, 33, { align: "right" });

  // destinatari
  let y = 44;
  doc.setDrawColor(228, 228, 231); doc.setFillColor(248, 250, 249); doc.roundedRect(L, y, 100, 30, 2, 2, "FD");
  doc.setTextColor(...GREEN); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.text("CLIENT", L + 4, y + 5);
  doc.setTextColor(...INK); doc.setFontSize(9.5);
  const name = doc.splitTextToSize(p.client.legal_name, 92) as string[];
  doc.text(name.slice(0, 2), L + 4, y + 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  let cy = y + 10 + Math.min(2, name.length) * 4;
  for (const t of [`CIF: ${p.client.nif}`, p.client.address, [p.client.postal_code, p.client.city].filter(Boolean).join(" ") + (p.client.province && p.client.province.toLowerCase() !== (p.client.city ?? "").toLowerCase() ? ` (${p.client.province})` : "")].filter(Boolean) as string[]) {
    doc.text(t, L + 4, cy); cy += 4;
  }
  // dades de la factura
  const meta: [string, string][] = [];
  if (p.periodLabel) meta.push(["Període", p.periodLabel]);
  if (p.orderRefLabel && p.orderRef) meta.push([p.orderRefLabel, p.orderRef]);
  if (p.rectifies) meta.push(["Rectifica", `${p.rectifies.number} (${d(p.rectifies.date)})`]);
  doc.setFontSize(8.5);
  meta.forEach(([k, v], i) => { doc.setTextColor(...GREY); doc.text(k, L + 108, y + 6 + i * 6); doc.setTextColor(...INK); doc.text(v, R, y + 6 + i * 6, { align: "right" }); });

  y = 82;
  if (p.concept) { doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(doc.splitTextToSize(p.concept, R - L) as string[], L, y); y += 6; }
  if (p.rectifies?.reason) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY); doc.text(`Motiu de la rectificació: ${p.rectifies.reason}`, L, y); y += 5; }

  autoTable(doc, {
    startY: y + 1, margin: { left: L, right: W - R, bottom: 40 }, theme: "plain",
    head: [["Descripció", "Quantitat", "Preu unitari", "IVA", "Import"]],
    body: p.lines.map((l) => [l.description + (Number(l.vat_rate) === 0 && l.vat_exemption ? `\n${l.vat_exemption}` : ""), qty(l.quantity), price(l.unit_price), `${Number(l.vat_rate)} %`, eurFmt(l.amount)]),
    styles: { fontSize: 9, cellPadding: { top: 2.4, bottom: 2.4, left: 2, right: 2 }, textColor: INK, lineColor: [228, 228, 231], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    columnStyles: { 1: { halign: "right", cellWidth: 22 }, 2: { halign: "right", cellWidth: 30 }, 3: { halign: "right", cellWidth: 16 }, 4: { halign: "right", cellWidth: 30 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  if (y > H - 75) { doc.addPage(); y = 20; }

  // totals
  const rows: [string, string, boolean][] = [];
  for (const b of p.breakdown) {
    rows.push([`Base imposable${p.breakdown.length > 1 ? ` (${Number(b.rate)} %)` : ""}`, eurFmt(b.base), false]);
    rows.push([`IVA ${Number(b.rate)} %`, eurFmt(b.vat), false]);
  }
  const tx = R - 80;
  doc.setFontSize(9);
  rows.forEach(([k, v], i) => { doc.setTextColor(...GREY); doc.setFont("helvetica", "normal"); doc.text(k, tx, y + i * 5.5); doc.setTextColor(...INK); doc.text(v, R, y + i * 5.5, { align: "right" }); });
  y += rows.length * 5.5 + 1;
  doc.setFillColor(...GREEN); doc.roundedRect(tx - 3, y - 1, R - tx + 3, 10, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("TOTAL FACTURA", tx, y + 5.6); doc.text(eurFmt(p.total), R - 2, y + 5.6, { align: "right" });
  y += 18;

  // pagament i notes
  if (p.issuer.iban) {
    doc.setTextColor(...GREEN); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.text("FORMA DE PAGAMENT", L, y);
    doc.setTextColor(...INK); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(`Transferència bancària al compte ${p.issuer.iban}`, L, y + 5);
    y += 12;
  }
  if (p.notes) { doc.setTextColor(...GREY); doc.setFontSize(8.5); doc.text(doc.splitTextToSize(p.notes, R - L) as string[], L, y); }

  // peu
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.4); doc.line(L, H - 16, R, H - 16);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text(p.footer || `${p.issuer.name} · CIF ${p.issuer.nif} · ${p.issuer.address}, ${p.issuer.postal_code} ${p.issuer.city}`, L, H - 11);
    doc.text(`Pàgina ${i} de ${pages}`, R, H - 11, { align: "right" });
    if (p.draft) { doc.setTextColor(220, 38, 38); doc.setFontSize(48); doc.setFont("helvetica", "bold"); doc.text("ESBORRANY", W / 2, H / 2, { align: "center", angle: 30 }); }
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
