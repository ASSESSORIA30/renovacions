/**
 * PDF de proposta comercial (Fase 5) amb el disseny corporatiu existent (mateixa capçalera i colors que
 * la resta de PDFs). Tots els números provenen de l'anàlisi determinista; el text és de plantilla.
 * Mentre no s'aprova, cada pàgina porta la marca «ESBORRANY».
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { LOGO_DATA_URL } from "./logo";
import { PENDING_PRICE, PROPOSAL_ADVANTAGES, PROPOSAL_MESSAGE, type Analysis } from "./intelligence";

export interface ProposalPdfInput {
  draft: boolean;
  reference: string;
  client: { name: string };
  supply: { cups: string | null; address: string | null; accessTariff: string | null; annualKwh: number | null; powerKw: (number | null)[] | null; energyType: "luz" | "gas" };
  currentRetailer: string | null;
  currentPrices: { energy: (number | null)[] | null; power: (number | null)[] | null; powerUnit: string | null; source: string | null; date: string | null } | null;
  analysis: Analysis;
  validUntil: string;
  contact: { name: string; email: string | null; phone: string | null };
  generatedAt: Date;
}

const eur = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const d = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("ca-ES") : "—");
const prices = (a: (number | null)[] | null | undefined, unit: string) => (a ?? []).map((v, i) => (v == null ? null : `P${i + 1} ${v.toLocaleString("ca-ES", { maximumFractionDigits: 6 })}`)).filter(Boolean).join(" · ") + (a?.some((x) => x != null) ? ` ${unit}` : "");
const UNIT: Record<string, string> = { eur_kw_dia: "€/kW·dia", eur_kw_mes: "€/kW·mes", eur_kw_any: "€/kW·any" };
const GREEN: [number, number, number] = [21, 128, 61];

export function buildProposalPdf(p: ProposalPdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), L = 18, R = W - 18;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const a = p.analysis;

  try { doc.addImage(LOGO_DATA_URL, "PNG", L, 10, 11, 11); } catch { /* sense logo */ }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(24, 24, 27); doc.text("Assessoria 3.0", L + 14, 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(113, 113, 122); doc.text("Proposta de subministrament", L + 14, 19);
  doc.text(`${p.reference} · ${d(p.generatedAt.toISOString())}`, R, 15, { align: "right" });

  doc.setTextColor(24, 24, 27); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(p.client.name, L, 34, { maxWidth: R - L });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(63, 63, 70);
  const msg = doc.splitTextToSize(PROPOSAL_MESSAGE, R - L) as string[];
  doc.text(msg, L, 41);
  let y = 41 + msg.length * 4.2 + 2;

  autoTable(doc, {
    startY: y, margin: { left: L, right: W - R }, theme: "plain", styles: { fontSize: 9, cellPadding: 1.3 },
    head: [[{ content: "Subministrament", colSpan: 2, styles: { fontStyle: "bold", textColor: GREEN } }]],
    body: [
      ["CUPS", p.supply.cups ?? "—"],
      ["Adreça", p.supply.address ?? "—"],
      ["Tipus i tarifa d'accés", `${p.supply.energyType === "gas" ? "Gas" : "Electricitat"} · ${p.supply.accessTariff ?? "—"}`],
      ["Consum anual", p.supply.annualKwh != null ? `${Math.round(p.supply.annualKwh).toLocaleString("ca-ES")} kWh` : "—"],
      ...(p.supply.energyType === "luz" ? [["Potències contractades", (p.supply.powerKw ?? []).map((v, i) => (v == null ? null : `P${i + 1} ${v} kW`)).filter(Boolean).join(" · ") || "—"]] : []),
      ["Comercialitzadora actual", p.currentRetailer ?? "—"],
      ["Preus actuals", p.currentPrices && a.current.known
        ? [prices(p.currentPrices.energy, "€/kWh"), prices(p.currentPrices.power, UNIT[p.currentPrices.powerUnit ?? "eur_kw_dia"] ?? "")].filter(Boolean).join("\n") + (p.currentPrices.source ? `\nFont: ${p.currentPrices.source}${p.currentPrices.date ? ` (${d(p.currentPrices.date)})` : ""}` : "")
        : PENDING_PRICE],
      ["Cost anual actual estimat", a.current.known ? eur(a.current.annualCost) : PENDING_PRICE],
    ],
    columnStyles: { 0: { cellWidth: 52, textColor: [113, 113, 122] } },
  });
  y = finalY() + 5;

  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(24, 24, 27); doc.text("Tres alternatives", L, y); y += 2;
  autoTable(doc, {
    startY: y, margin: { left: L, right: W - R }, theme: "grid",
    head: [["", "Comercialitzadora i producte", "Cost anual estimat", "Estalvi potencial", "Condicions rellevants"]],
    body: a.alternatives.map((x) => [
      String(x.rank),
      `${x.supplier}\n${x.product} (v${x.version})`,
      `${eur(x.annualCost)}\n(${eur(x.annualCostExTax)} sense impostos)`,
      x.saving != null ? `${eur(x.saving)}${x.savingPct != null ? `\n${x.savingPct.toLocaleString("ca-ES")} %` : ""}` : PENDING_PRICE,
      [x.permanenceMonths ? `Permanència ${x.permanenceMonths} mesos${x.penalty ? `: ${x.penalty}` : ""}` : "Sense permanència", x.priceGuaranteeMonths ? `Preu garantit ${x.priceGuaranteeMonths} mesos` : null, `SAS: ${x.sas.label}`, x.validTo ? `Oferta vàlida fins al ${d(x.validTo)}` : null].filter(Boolean).join("\n"),
    ]),
    styles: { fontSize: 8.5, cellPadding: 2, lineColor: [228, 228, 231], valign: "top" }, headStyles: { fillColor: GREEN, fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: 7, halign: "center", fontStyle: "bold" }, 2: { halign: "right", cellWidth: 34 }, 3: { halign: "right", cellWidth: 30 } },
  });
  y = finalY() + 4;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(63, 63, 70);
  for (const x of a.alternatives) {
    const t = doc.splitTextToSize(`${x.rank}. ${x.reasons.join(". ")}.`, R - L) as string[];
    if (y + t.length * 3.6 > H - 22) { doc.addPage(); y = 20; }
    doc.text(t, L, y); y += t.length * 3.6 + 1;
  }

  if (a.sasScenarios.length) {
    y += 2;
    autoTable(doc, {
      startY: y, margin: { left: L, right: W - R }, theme: "grid",
      head: [["Escenari de sensibilitat SAS (no és un cost regulat confirmat)", "Forquilla", "Cost anual resultant"]],
      body: a.sasScenarios.map((s) => [`${s.retailer}: ${s.justification}\nFont: ${s.source} · data ${d(s.asOf)}`, `${s.minEurKwh}–${s.maxEurKwh} €/kWh\n(+${eur(s.extraMinEur)} a +${eur(s.extraMaxEur)})`, `${eur(s.totalMinEur)} – ${eur(s.totalMaxEur)}`]),
      styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: { fillColor: [180, 83, 9], fontSize: 8 },
    });
    y = finalY() + 4;
  }
  if (a.oneOff.length) {
    autoTable(doc, { startY: y, margin: { left: L, right: W - R }, theme: "grid", head: [["Costos únics (no recurrents)", "Import", "Observacions"]], body: a.oneOff.map((o) => [o.concept, o.amount != null ? eur(o.amount) : "Pendent", o.note]), styles: { fontSize: 8 }, headStyles: { fillColor: [82, 82, 91] } });
    y = finalY() + 4;
  }

  const block = (title: string, lines: string[]) => {
    const body = lines.flatMap((l) => doc.splitTextToSize(`• ${l}`, R - L) as string[]);
    if (y + 6 + body.length * 3.6 > H - 22) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(24, 24, 27); doc.text(title, L, y); y += 4.5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(63, 63, 70); doc.text(body, L, y); y += body.length * 3.6 + 3;
  };
  block("Validesa", [`Proposta vàlida fins al ${d(p.validUntil)} o fins que la comercialitzadora modifiqui les tarifes, el que passi abans.`]);
  block("Hipòtesis del càlcul", a.hypotheses);
  block("Avantatges", PROPOSAL_ADVANTAGES);
  block("Contacte", [`${p.contact.name}${p.contact.email ? ` · ${p.contact.email}` : ""}${p.contact.phone ? ` · ${p.contact.phone}` : ""}`, "Assessoria 3.0"]);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (p.draft) {
      doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text("ESBORRANY · pendent d'aprovació interna · no enviar", W / 2, 27, { align: "center" });
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(113, 113, 122);
    doc.text(`${p.reference} · Imports estimats amb les tarifes vigents; no són un estalvi garantit.`, L, H - 10);
    doc.text(`${i} / ${pages}`, R, H - 10, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
