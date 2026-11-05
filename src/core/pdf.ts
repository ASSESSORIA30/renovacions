import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { addDays, fmtDate, fmtDateEs, today } from "./dates";
import { fmtEUR, fmtN, type CompareResult, type PriceSet } from "./compare";
import type { Contract, Offer, Settings } from "./types";
import { LOGO_DATA_URL } from "./logo";

const BRAND: [number, number, number] = [21, 128, 61];
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [113, 113, 122];

export interface ProposalInput {
  contract: Contract;
  offer: Offer;
  result: CompareResult & { ok: true };
  actualPrices: PriceSet;
  settings: Settings;
  comercial: string;
  version: number;
  logoDataUrl?: string | null;
  lang?: "ca" | "es";
}

export function buildProposalPdf(p: ProposalInput): { blob: Blob; fileName: string } {
  const { contract: c, offer: o, result: r, settings: s } = p;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 16;
  const emit = today();
  const L = p.lang === "es" ? ES : CA;
  const fd = p.lang === "es" ? fmtDateEs : fmtDate;

  // Header band
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 38, "F");
  // round official logo on a white disc + wordmark
  const logo = p.logoDataUrl || LOGO_DATA_URL;
  doc.setFillColor(255, 255, 255);
  doc.circle(M + 11, 19, 12, "F");
  try { doc.addImage(logo, M - 0.5, 7.5, 23, 23, undefined, "FAST"); } catch { /* ignore bad logo */ }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Assessoria 3.0", M + 27, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(L.tagline, M + 27, 24.5);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(L.title, W - M, 17, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`${L.issued}: ${fd(emit)}  ·  ${L.validUntil}: ${fd(addDays(emit, s.validezOfertaDias))}  ·  v${p.version}`, W - M, 24, { align: "right" });

  // Client block
  let y = 50;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(c.cliente, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  y += 6;
  const lines = [
    [c.direccion, [c.cp, c.poblacion].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
    `CUPS ${c.cups ?? "—"}  ·  Tarifa ${c.tarifa ?? "—"}  ·  ${c.cif ? `NIF/CIF ${c.cif}` : ""}`,
  ];
  lines.forEach((l) => { doc.text(l, M, y); y += 4.6; });

  // Savings hero
  y += 4;
  const saving = r.ahorro;
  const positive = saving > 0;
  doc.setFillColor(positive ? 236 : 250, positive ? 253 : 245, positive ? 245 : 235);
  doc.roundedRect(M, y, W - 2 * M, 30, 3, 3, "F");
  doc.setTextColor(...(positive ? BRAND : ([161, 98, 7] as [number, number, number])));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(positive ? L.saving : L.difference, M + 6, y + 8);
  doc.setFontSize(24);
  doc.text(fmtEUR(Math.abs(saving)) + (positive ? "" : L.more), M + 6, y + 21);
  doc.setFontSize(11);
  doc.text(`${fmtN(Math.abs(r.ahorroPct), 1)} %`, M + 66, y + 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(`${L.noTax}: ${fmtEUR(r.ahorroSinImpuestos)}`, M + 66, y + 27);

  // Bar chart current vs new
  const bx = W - M - 78;
  const max = Math.max(r.actual.total, r.nuevo.total) || 1;
  const bars: [string, number, [number, number, number]][] = [
    [c.comercializadora ?? L.current, r.actual.total, [161, 161, 170]],
    [o.comercializadora, r.nuevo.total, BRAND],
  ];
  bars.forEach(([label, v, col], i) => {
    const by = y + 6 + i * 11;
    const bw = (v / max) * 32;
    doc.setFillColor(...col);
    doc.roundedRect(bx + 20, by, Math.max(bw, 1), 6, 1, 1, "F");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(label.slice(0, 11), bx, by + 4.4);
    doc.setTextColor(...INK);
    doc.text(fmtEUR(v), bx + 22 + bw, by + 4.4);
  });
  y += 38;

  // Supply comparison table
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(L.comparison, M, y);
  y += 3;
  const ep = o.energia.map((v, n) => (v == null ? null : n)).filter((n): n is number => n !== null);
  const pp = o.potencia.map((v, n) => (v == null ? null : n)).filter((n): n is number => n !== null);
  const list = (arr: (number | null)[], idx: number[]) => idx.map((n, i) => `${i && i % 3 === 0 ? "\n" : ""}P${n + 1} ${fmtN(arr[n] ?? 0, 4)}`).join("   ").replace(/   \n/g, "\n");
  const body: (string | number)[][] = [
    [L.supplier, c.comercializadora ?? "—", `${o.comercializadora} · ${o.nombre}`],
    [L.energyPrice, list(p.actualPrices.energia, ep), list(o.energia, ep)],
    ...(pp.length ? [[L.powerPrice, list(p.actualPrices.potencia, pp), list(o.potencia, pp)]] : []),
    ...(o.fijoDia != null || p.actualPrices.fijoDia != null ? [[L.fixedDay, fmtN(p.actualPrices.fijoDia ?? 0, 4), fmtN(o.fijoDia ?? 0, 4)]] : []),
    [L.energyTerm, fmtEUR(r.actual.energia), fmtEUR(r.nuevo.energia)],
    ...(r.actual.ajuste || r.nuevo.ajuste ? [[L.adjust, fmtEUR(r.actual.ajuste), fmtEUR(r.nuevo.ajuste)]] : []),
    [L.powerTerm, fmtEUR(r.actual.potencia), fmtEUR(r.nuevo.potencia)],
    ...(r.actual.fijo || r.nuevo.fijo ? [[L.fixedTerm, fmtEUR(r.actual.fijo), fmtEUR(r.nuevo.fijo)]] : []),
    [L.elecTax, fmtEUR(r.actual.iee), fmtEUR(r.nuevo.iee)],
    [L.rental, fmtEUR(r.actual.alquiler), fmtEUR(r.nuevo.alquiler)],
    [L.totalNoVat, fmtEUR(r.actual.baseIva), fmtEUR(r.nuevo.baseIva)],
    [`IVA (${s.iva}%)`, fmtEUR(r.actual.iva), fmtEUR(r.nuevo.iva)],
    [L.total, fmtEUR(r.actual.total), fmtEUR(r.nuevo.total)],
  ];
  autoTable(doc, {
    startY: y + 2,
    head: [[L.concept, L.currentSituation, L.proposal]],
    body,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, lineColor: [228, 228, 231], textColor: INK },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 52 }, 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" } },
    didParseCell: (d) => { if (d.section === "body" && d.row.index === body.length - 1) { d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = [244, 244, 245]; } },
    margin: { left: M, right: M },
  });
  // @ts-expect-error lastAutoTable injected by plugin
  y = doc.lastAutoTable.finalY + 8;

  const ensure = (h: number) => { if (y + h > 250) { doc.addPage(); y = 20; } };
  // Advantages
  ensure(30);
  const ventajas = (o.ventajas?.length ? o.ventajas : L.defaultAdv).slice(0, 5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(L.advantages, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y += 6;
  ventajas.forEach((v) => {
    doc.setFillColor(...BRAND);
    doc.circle(M + 1.5, y - 1.2, 1, "F");
    doc.text(v, M + 5, y);
    y += 5;
  });

  // Hypotheses
  y += 3;
  ensure(16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(L.hypotheses, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  y += 4.5;
  for (const h of r.hipotesis) {
    const wrapped = doc.splitTextToSize(`• ${h}`, W - 2 * M);
    ensure(wrapped.length * 3.6);
    doc.text(wrapped, M, y);
    y += wrapped.length * 3.6;
  }

  // Commitment (last page) + footer (all pages)
  if (y > 250) { doc.addPage(); y = 20; }
  const fy = 262;
  doc.setDrawColor(228, 228, 231);
  doc.line(M, fy - 6, W - M, fy - 6);
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  const commit = doc.splitTextToSize(
    L.commitment,
    W - 2 * M
  );
  doc.text(commit, M, fy);
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text([s.empresa.nombre, s.empresa.direccion, s.empresa.telefono, s.empresa.email, s.empresa.web].filter(Boolean).join("  ·  "), M, 285);
    doc.text(`${L.advisor}: ${p.comercial}${pages > 1 ? `  ·  ${i}/${pages}` : ""}`, W - M, 285, { align: "right" });
  }

  const safe = c.cliente.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
  const fileName = `${L.file}_${safe}_${emit}_v${p.version}.pdf`;
  return { blob: doc.output("blob"), fileName };
}

const CA = {
  tagline: "Gestió energètica des del 2013", title: "PROPOSTA DE RENOVACIÓ", issued: "Emesa", validUntil: "Vàlida fins",
  saving: "ESTALVI ANUAL ESTIMAT (IVA incl.)", difference: "DIFERÈNCIA ANUAL ESTIMADA (IVA incl.)", more: " més", noTax: "Sense impostos",
  current: "Actual", comparison: "Comparativa", supplier: "Comercialitzadora", energyPrice: "Preu energia (€/kWh)", powerPrice: "Preu potència (€/kW·dia)",
  fixedDay: "Terme fix gas (€/dia)", energyTerm: "Terme d'energia (any)", adjust: "Mecanisme d'ajust (any)", powerTerm: "Terme de potència (any)", fixedTerm: "Terme fix / serveis",
  elecTax: "Impost elèctric", rental: "Lloguer d'equips", totalNoVat: "Total sense IVA", total: "TOTAL ANUAL ESTIMAT",
  concept: "Concepte", currentSituation: "Situació actual", proposal: "Proposta",
  defaultAdv: ["Gestió integral del canvi sense talls de subministrament", "Seguiment personalitzat de la seva factura", "Atenció directa del seu assessor"],
  advantages: "Avantatges de la proposta", hypotheses: "Hipòtesis del càlcul",
  commitment: "A Assessoria 3.0 treballem des del 2013 gestionant subministraments energètics, prioritzant l'atenció personalitzada, la transparència i la recerca de condicions competitives per als nostres clients.",
  advisor: "Assessor", file: "Proposta",
};
const ES: typeof CA = {
  tagline: "Gestión energética desde 2013", title: "PROPUESTA DE RENOVACIÓN", issued: "Emitida", validUntil: "Válida hasta",
  saving: "AHORRO ANUAL ESTIMADO (IVA incl.)", difference: "DIFERENCIA ANUAL ESTIMADA (IVA incl.)", more: " más", noTax: "Sin impuestos",
  current: "Actual", comparison: "Comparativa", supplier: "Comercializadora", energyPrice: "Precio energía (€/kWh)", powerPrice: "Precio potencia (€/kW·día)",
  fixedDay: "Término fijo gas (€/día)", energyTerm: "Término de energía (año)", adjust: "Mecanismo de ajuste (año)", powerTerm: "Término de potencia (año)", fixedTerm: "Término fijo / servicios",
  elecTax: "Impuesto eléctrico", rental: "Alquiler de equipos", totalNoVat: "Total sin IVA", total: "TOTAL ANUAL ESTIMADO",
  concept: "Concepto", currentSituation: "Situación actual", proposal: "Propuesta",
  defaultAdv: ["Gestión integral del cambio sin cortes de suministro", "Seguimiento personalizado de su factura", "Atención directa de su asesor"],
  advantages: "Ventajas de la propuesta", hypotheses: "Hipótesis del cálculo",
  commitment: "En Assessoria 3.0 trabajamos desde 2013 gestionando suministros energéticos, priorizando la atención personalizada, la transparencia y la búsqueda de condiciones competitivas para nuestros clientes.",
  advisor: "Asesor", file: "Propuesta",
};
