/** Informe PDF de reclamació a una comercialitzadora (corporatiu, preparat per enviar). Català o castellà. */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { LOGO_DATA_URL } from "./logo";
import { ITEM_KIND_LABEL, ITEM_KIND_LABEL_ES, eu, type ItemKind, type Lang } from "./claims";

export interface ClaimPdfInput {
  lang: Lang; code: string; retailer: string; retailerLegal?: string | null; periodFrom: string; periodTo: string; generatedAt: Date; generatedBy: string;
  contactName?: string | null; draft: boolean;
  items: {
    kind: ItemKind; client: string | null; cups: string | null; reference: string | null; contractRef: string | null; expected: string; settled: string; claimed: string;
    reason: string; ruleRef: { label: string; excerpt?: string | null } | null;
    facts?: { activated?: string | null; deadline?: string | null; paymentDays?: number | null; riskMonths?: number | null; elapsedMonths?: number | null; allowed?: string | null } | null;
  }[];
  total: string;
}

const T = {
  ca: {
    title: "Reclamació de comissions", to: "Comercialitzadora", period: "Període reclamat", date: "Data de generació", ref: "Referència", contact: "A l'atenció de",
    summary: "Resum", contracts: "Contractes afectats", total: "Import total reclamat", byType: "Per tipus de discrepància",
    detail: "Relació de contractes", cols: ["Client", "CUPS", "Referència", "Prevista", "Liquidada", "Diferència"],
    explain: "Explicació de les discrepàncies", refs: "Referències contractuals", draft: "ESBORRANY · pendent de revisió interna",
    intro: "Assessoria 3.0 ha comparat la liquidació de comissions rebuda amb les condicions del contracte de col·laboració vigent aprovades per la seva Direcció. Aquest informe recull les diferències que considerem reclamables, amb l'import i la clàusula que justifica cada una.",
    foot: "Imports en euros, sense IVA. La comissió prevista s'ha calculat amb les regles contractuals aprovades; la liquidada és la que consta a la liquidació de la comercialitzadora.",
    request: "Sol·licitem la revisió d'aquestes diferències i la seva regularització en la propera liquidació, o l'explicació del motiu si no hi esteu d'acord.",
  },
  es: {
    title: "Reclamación de comisiones", to: "Comercializadora", period: "Periodo reclamado", date: "Fecha de generación", ref: "Referencia", contact: "A la atención de",
    summary: "Resumen", contracts: "Contratos afectados", total: "Importe total reclamado", byType: "Por tipo de discrepancia",
    detail: "Relación de contratos", cols: ["Cliente", "CUPS", "Referencia", "Prevista", "Liquidada", "Diferencia"],
    explain: "Explicación de las discrepancias", refs: "Referencias contractuales", draft: "BORRADOR · pendiente de revisión interna",
    intro: "Assessoria 3.0 ha comparado la liquidación de comisiones recibida con las condiciones del contrato de colaboración vigente aprobadas por su Dirección. Este informe recoge las diferencias que consideramos reclamables, con el importe y la cláusula que justifica cada una.",
    foot: "Importes en euros, sin IVA. La comisión prevista se ha calculado con las reglas contractuales aprobadas; la liquidada es la que consta en la liquidación de la comercializadora.",
    request: "Solicitamos la revisión de estas diferencias y su regularización en la próxima liquidación, o la explicación del motivo en caso de discrepancia.",
  },
} as const;

/** La font estàndard del PDF (WinAnsi) no té alguns símbols: es substitueixen per equivalents segurs. */
const safe = (s: string) => s.replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/[−‒]/g, "-").replace(/[\u2009\u202f\u00a0]/g, " ");

/** Motiu de cada línia en l'idioma del PDF, redactat a partir de fets (imports, dates i terminis), mai d'hipòtesis. */
export function itemReason(i: ClaimPdfInput["items"][number], lang: Lang): string {
  const f = i.facts ?? {};
  const d = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString(lang === "es" ? "es-ES" : "ca-ES", { timeZone: "UTC" }) : "—");
  const settledAbs = Math.abs(Number(i.settled));
  if (lang === "es") {
    if (i.kind === "infraliquidacio") return `Liquidado ${eu(i.settled, lang)} cuando la regla aprobada prevé ${eu(i.expected, lang)} (diferencia ${eu(i.claimed, lang)}).`;
    if (i.kind === "pendent_liquidacio") return f.activated && f.paymentDays != null ? `Contrato activado el ${d(f.activated)} y no liquidado; el plazo de pago de ${f.paymentDays} días venció el ${d(f.deadline)}.` : "Contrato activado y pendiente de liquidar; el plazo de pago contractual ha vencido.";
    return f.allowed != null ? `Retrocesión de ${eu(settledAbs, lang)} cuando la regla de retrocesión permite ${eu(f.allowed, lang)}.` : `Retrocesión de ${eu(settledAbs, lang)} fuera del periodo de riesgo${f.riskMonths != null ? ` (${f.elapsedMonths ?? "—"} meses desde la activación; periodo de riesgo de ${f.riskMonths} meses)` : ""}.`;
  }
  if (i.kind === "infraliquidacio") return `Liquidat ${eu(i.settled)} quan la regla aprovada en preveu ${eu(i.expected)} (diferència ${eu(i.claimed)}).`;
  if (i.kind === "pendent_liquidacio") return f.activated && f.paymentDays != null ? `Contracte activat el ${d(f.activated)} i no liquidat; el termini de pagament de ${f.paymentDays} dies va vèncer el ${d(f.deadline)}.` : "Contracte activat i pendent de liquidar; el termini de pagament contractual ha vençut.";
  return f.allowed != null ? `Retrocessió de ${eu(settledAbs)} quan la regla de retrocessió en permet ${eu(f.allowed)}.` : `Retrocessió de ${eu(settledAbs)} fora del període de risc${f.riskMonths != null ? ` (${f.elapsedMonths ?? "—"} mesos des de l'activació; període de risc de ${f.riskMonths} mesos)` : ""}.`;
}
const refLabel = (label: string, lang: Lang) => (lang === "es" ? label.replace(/Regla de retrocessió/g, "Regla de retrocesión").replace(/pàg\./g, "pág.") : label);

export function buildClaimPdf(p: ClaimPdfInput): Uint8Array {
  const t = T[p.lang];
  const loc = p.lang === "es" ? "es-ES" : "ca-ES";
  const eur = (v: string | number) => eu(v, p.lang);
  const d = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString(loc, { timeZone: "UTC" });
  const kindLabel = (k: ItemKind) => (p.lang === "es" ? ITEM_KIND_LABEL_ES : ITEM_KIND_LABEL)[k];
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), L = 16, R = W - 16;
  const green: [number, number, number] = [21, 128, 61];
  const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // capçalera corporativa
  doc.setFillColor(...green); doc.rect(0, 0, W, 3, "F");
  try { doc.addImage(LOGO_DATA_URL, "PNG", L, 9, 12, 12); } catch { /* sense logotip */ }
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(24, 24, 27); doc.text("Assessoria 3.0", L + 15, 14);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(113, 113, 122); doc.text(p.lang === "es" ? "Asesoría energética" : "Assessoria energètica", L + 15, 18.5);
  doc.text(`${t.ref}: ${p.code}`, R, 14, { align: "right" });
  doc.setTextColor(24, 24, 27); doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text(t.title, L, 34);
  if (p.draft) { doc.setFontSize(9); doc.setTextColor(180, 83, 9); doc.text(t.draft, L, 40); doc.setTextColor(24, 24, 27); }

  autoTable(doc, {
    startY: 44, margin: { left: L, right: W - R }, theme: "plain", styles: { fontSize: 9.5, cellPadding: 1.4 },
    body: [
      [{ content: t.to, styles: { textColor: [113, 113, 122] } }, { content: p.retailerLegal ? `${p.retailer} (${p.retailerLegal})` : p.retailer, styles: { fontStyle: "bold" } }],
      ...(p.contactName ? [[{ content: t.contact, styles: { textColor: [113, 113, 122] } }, p.contactName]] : []),
      [{ content: t.period, styles: { textColor: [113, 113, 122] } }, `${d(p.periodFrom)} – ${d(p.periodTo)}`],
      [{ content: t.date, styles: { textColor: [113, 113, 122] } }, p.generatedAt.toLocaleDateString(loc, { timeZone: "Europe/Madrid" })],
    ] as never,
    columnStyles: { 0: { cellWidth: 42 } },
  });
  let y = last() + 4;
  doc.setFontSize(9.5); doc.setFont("helvetica", "normal");
  const intro = doc.splitTextToSize(t.intro, R - L) as string[];
  doc.text(intro, L, y); y += intro.length * 4.4 + 3;

  // resum
  const kinds = [...new Set(p.items.map((i) => i.kind))];
  autoTable(doc, {
    startY: y, margin: { left: L, right: W - R }, theme: "grid", head: [[t.summary, ""]], headStyles: { fillColor: green },
    styles: { fontSize: 9.5, cellPadding: 1.8, lineColor: [228, 228, 231] },
    body: [
      [t.contracts, String(p.items.length)],
      ...kinds.map((k) => [`  ${kindLabel(k)}`, `${p.items.filter((i) => i.kind === k).length} · ${eur(p.items.filter((i) => i.kind === k).reduce((s, i) => s + Number(i.claimed), 0))}`]),
      [{ content: t.total, styles: { fontStyle: "bold" } }, { content: eur(p.total), styles: { fontStyle: "bold" } }],
    ] as never,
    columnStyles: { 1: { halign: "right", cellWidth: 60 } },
  });
  y = last() + 6;

  // relació de contractes
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(t.detail, L, y); y += 2;
  autoTable(doc, {
    startY: y, margin: { left: L, right: W - R, bottom: 18 }, theme: "grid", head: [["#", ...t.cols]], headStyles: { fillColor: green, fontSize: 8.5 },
    styles: { fontSize: 7.8, cellPadding: 1.4, lineColor: [228, 228, 231], overflow: "linebreak" },
    body: p.items.map((i, n) => [String(n + 1), safe(i.client ?? "—"), (i.cups ?? "—").slice(0, 22), [i.reference, i.contractRef].filter(Boolean).join(" / ") || "—", eur(i.expected), eur(i.settled), eur(i.claimed)]),
    foot: [[{ content: t.total, colSpan: 6, styles: { halign: "right" } }, { content: eur(p.total), styles: { halign: "right" } }]] as never,
    footStyles: { fillColor: [244, 244, 245], textColor: [24, 24, 27], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 7 }, 2: { cellWidth: 36 }, 4: { halign: "right", cellWidth: 21 }, 5: { halign: "right", cellWidth: 21 }, 6: { halign: "right", cellWidth: 21 } },
  });
  y = last() + 6;

  // explicació i referències
  if (y > H - 50) { doc.addPage(); y = 20; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(t.explain, L, y); y += 2;
  autoTable(doc, {
    startY: y, margin: { left: L, right: W - R, bottom: 18 }, theme: "striped", head: [["#", p.lang === "es" ? "Tipo" : "Tipus", p.lang === "es" ? "Motivo" : "Motiu", t.refs]],
    headStyles: { fillColor: [82, 82, 91], fontSize: 8.5 }, styles: { fontSize: 7.8, cellPadding: 1.5, overflow: "linebreak" },
    body: p.items.map((i, n) => [String(n + 1), kindLabel(i.kind), safe(itemReason(i, p.lang)), i.ruleRef ? safe(`${refLabel(i.ruleRef.label, p.lang)}${i.ruleRef.excerpt ? `\n«${i.ruleRef.excerpt.slice(0, 220)}»` : ""}`) : "—"]),
    columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 32 }, 3: { cellWidth: 62 } },
  });
  y = last() + 6;
  if (y > H - 30) { doc.addPage(); y = 20; }
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(24, 24, 27);
  const req = doc.splitTextToSize(t.request, R - L) as string[];
  doc.text(req, L, y); y += req.length * 4.4 + 3;
  doc.setFontSize(7.8); doc.setTextColor(113, 113, 122);
  doc.text(doc.splitTextToSize(t.foot, R - L) as string[], L, y);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(113, 113, 122);
    doc.text(`Assessoria 3.0 · ${p.code} · ${p.generatedAt.toLocaleString(loc, { timeZone: "Europe/Madrid" })} · ${p.generatedBy}`, L, H - 8);
    doc.text(`${i} / ${pages}`, R, H - 8, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
