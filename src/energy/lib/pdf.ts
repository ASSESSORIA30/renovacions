"use client";
/** Informes PDF con identidad Assessoria 3.0 (jsPDF + autotable). */
import { jsPDF } from "jspdf";
import autoTableRaw from "jspdf-autotable";

/** La fuente estándar del PDF no incluye √, Σ, ², φ, ≤…: se transliteran. */
export function pdfSafe(t: string): string {
  return t
    .replace(/√Σ\(Pdj−Pcp\)²/g, "raiz(suma de (Pdj - Pcp)^2)")
    .replace(/√/g, "raiz")
    .replace(/Σ/g, "suma")
    .replace(/²/g, "^2")
    .replace(/[−–]/g, "-")
    .replace(/φ/g, "phi")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/·/g, "·")
    .replace(/[^\x00-\xFF€]/g, "");
}
const autoTable: typeof autoTableRaw = (doc, opts) =>
  autoTableRaw(doc, {
    ...opts,
    didParseCell: (d) => {
      d.cell.text = d.cell.text.map(pdfSafe);
      opts.didParseCell?.(d);
    },
  });
import type { Supply, Opportunity } from "./types";
import type { OptimizerResult, ScenarioResult } from "./optimizer";
import type { ConsumptionScenario, OfferCost } from "./market";
import { savingVs } from "./market";
import { annualActive } from "./parse";
import { SOURCES } from "./tariffs";
import type { useInsights } from "@/energy/components/supply/opportunity";

const TEAL: [number, number, number] = [14, 124, 134];
const INK: [number, number, number] = [11, 13, 18];
const GREY: [number, number, number] = [110, 116, 128];

const n = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
const eur = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : `${n(v, d)} €`);
const dmy = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

let defaultLogo: string | null = null;
/** Logo oficial de Assessoria 3.0 (public/logo-assessoria30.png) como dataURL. */
async function officialLogo(): Promise<string | null> {
  if (defaultLogo) return defaultLogo;
  if (typeof fetch === "undefined" || typeof FileReader === "undefined") return null;
  try {
    const blob = await (await fetch("/logo-assessoria30.png")).blob();
    defaultLogo = await new Promise<string>((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = ko;
      r.readAsDataURL(blob);
    });
    return defaultLogo;
  } catch {
    return null;
  }
}

function header(doc: jsPDF, title: string, subtitle: string, customLogo: string | null, official: string | null) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(7, 9, 13);
  doc.rect(0, 0, w, 30, "F");
  doc.setFillColor(...TEAL);
  doc.rect(0, 30, w, 1.2, "F");
  // Logo siempre presente: el personalizado de Ajustes o, por defecto, el oficial.
  const logo = customLogo ?? official;
  let placed = false;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", 15, 6.5, 17, 17, undefined, "FAST");
      placed = true;
    } catch {
      placed = false;
    }
  }
  if (!placed) {
    doc.setFillColor(34, 160, 70);
    doc.circle(24, 15, 10, "F");
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("A 3.0", 24, 16.5, { align: "center" });
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("ASSESSORIA 3.0", 38, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(170, 176, 186);
  doc.text("ENERGY INTELLIGENCE", 38, 19);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title, w - 14, 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(170, 176, 186);
  doc.text(subtitle, w - 14, 20, { align: "right" });
}

function footer(doc: jsPDF, author: string) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(`Assessoria 3.0 · Energy Intelligence · ${author} · ${new Date().toLocaleDateString("es-ES")}`, 14, h - 8);
    doc.text(`${i}/${pages}`, w - 14, h - 8, { align: "right" });
  }
}

function supplyBlock(doc: jsPDF, s: Supply, y: number) {
  const a = annualActive(s).value;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(pdfSafe(s.direccion ?? "Suministro"), 14, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text(`${s.cp ?? ""} ${s.localidad ?? ""} (${s.provincia ?? "—"}) · CUPS ${s.cups}`, 14, y + 6);
  autoTable(doc, {
    startY: y + 10,
    theme: "plain",
    styles: { fontSize: 8.5, cellPadding: 1.6, textColor: INK },
    columnStyles: { 0: { textColor: GREY }, 2: { textColor: GREY } },
    body: [
      ["Tarifa", s.tarifa ?? s.tarifaRaw ?? "—", "Consumo anual", `${n(a)} kWh (${n(a != null ? a / 1000 : null, 1)} MWh)`],
      ["Distribuidora", s.distribuidora ?? "—", "Comercializadora actual", s.comercializadora ?? "—"],
      ["Potencia anual registrada", `${n(s.potAnual, 1)} kW`, "Pot. máx. BIE / APM", `${n(s.potMaxBIE, 1)} / ${n(s.potMaxAPM, 1)} kW`],
      ["Origen de datos", `${s.source.file} · fila ${s.source.row}${s.source.demo ? " · DEMO (sintético)" : ""}`, "Última lectura", dmy(s.fUltLectura)],
    ],
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function section(doc: jsPDF, t: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...TEAL);
  doc.text(t.toUpperCase(), 14, y);
  doc.setDrawColor(...TEAL);
  doc.line(14, y + 1.5, 60, y + 1.5);
  doc.setFont("helvetica", "normal");
  return y + 6;
}

function paragraph(doc: jsPDF, text: string, y: number, size = 8.5) {
  doc.setFontSize(size);
  doc.setTextColor(...GREY);
  const lines = doc.splitTextToSize(pdfSafe(text), doc.internal.pageSize.getWidth() - 28);
  doc.text(lines, 14, y);
  return y + lines.length * (size * 0.45) + 2;
}

function lastY(doc: jsPDF) {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

export async function optimizationPdf(p: { s: Supply; res: OptimizerResult; sc: ScenarioResult; prices: number[]; priceLabel: string; priceOrigin: string; date: string; logo: string | null; author: string }) {
  const { s, res, sc } = p;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  header(doc, "Propuesta de optimización de potencia", `Escenario ${sc.def.label} · ${dmy(p.date)}`, p.logo, await officialLogo());
  let y = supplyBlock(doc, s, 42) + 8;
  y = section(doc, "Resultado", y);
  autoTable(doc, {
    startY: y,
    theme: "grid",
    headStyles: { fillColor: TEAL, fontSize: 8.5 },
    styles: { fontSize: 8.5, halign: "right" },
    columnStyles: { 0: { halign: "left" } },
    head: [["Periodo", "Actual (kW)", "Propuesta (kW)", "Variación (kW)", "Demanda " + (res.dm.basis === "medida_periodo" ? "medida" : "cota") + " (kW)", "Precio (€/kW·año)"]],
    body: sc.pc.map((v, i) => [`P${i + 1}`, n(res.current.pc[i], 1), n(v, 1), n(-sc.reductionKW[i], 1), n(res.dm.ub[i], 1), n(p.prices[i], 6)]),
  });
  y = lastY(doc) + 6;
  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 9 },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    body: [
      ["Coste anual término de potencia actual", eur(res.current.powerCost)],
      ["Coste anual término de potencia propuesto", eur(sc.powerCost)],
      ["Excesos estimados (peor caso)", eur(sc.excessWorst)],
      ["Ahorro neto anual mínimo", eur(sc.netSavingLB)],
      ["Costes de modificación", `${eur(sc.modCost, 2)}${sc.modBreakdown.length ? ` (${sc.modBreakdown.map((b) => b.label).join("; ")})` : ""}`],
      ["Plazo de recuperación", sc.paybackMonths != null ? `${n(sc.paybackMonths, 1)} meses` : "—"],
      ["Precios de potencia", `${p.priceLabel}`],
    ],
  });
  y = lastY(doc) + 6;
  y = section(doc, "Metodología y nivel de confianza", y);
  y = paragraph(
    doc,
    `${res.mode.explanation} Las potencias cumplen las reglas del peaje ${res.tariff} y la potencia máxima técnica. ${res.dm.basis === "medida_periodo" ? "Se han utilizado maxímetros por periodo aportados desde facturas." : "El fichero SIPS solo contiene máximas mensuales agregadas: la demanda de cada periodo se acota con el calendario de temporadas y los excesos se valoran en el peor caso, por lo que el ahorro indicado es un mínimo si la demanda se repite."} Confianza: ${res.confidence.level} (${res.confidence.score}/100).`,
    y,
  );
  y = paragraph(doc, `Datos necesarios para una propuesta firme: ${res.confidence.needed.join("; ")}.`, y);
  y = paragraph(doc, `Fuentes: ${p.priceOrigin}. ${SOURCES.excesos.ref}. ${SOURCES.derechos.ref}. Simulación orientativa sujeta a validación con la distribuidora; la modificación puede estar limitada a un cambio cada 12 meses.`, y, 7.5);
  footer(doc, p.author);
  doc.save(`Optimizacion_potencia_${s.cups}.pdf`);
}

export async function comparisonPdf(p: { s: Supply; costs: OfferCost[]; current?: OfferCost; scenario: ConsumptionScenario; logo: string | null; author: string }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  header(doc, "Comparativa de ofertas eléctricas", new Date().toLocaleDateString("es-ES"), p.logo, await officialLogo());
  let y = supplyBlock(doc, p.s, 42) + 8;
  y = section(doc, "Ranking", y);
  autoTable(doc, {
    startY: y,
    theme: "grid",
    headStyles: { fillColor: TEAL, fontSize: 8 },
    styles: { fontSize: 8 },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    head: [["#", "Comercializadora", "Oferta", "Energía", "Potencia", "Total anual (con impuestos)", "Ahorro vs actual"]],
    body: p.costs.map((c, i) => {
      const sv = p.current && p.current.offer.id !== c.offer.id ? savingVs(p.current, c) : null;
      return [
        String(i + 1),
        c.offer.comercializadora,
        c.offer.nombre + (p.current?.offer.id === c.offer.id ? " (actual)" : ""),
        c.energy != null ? eur(c.energy) : `${eur(c.energyMin)}–${eur(c.energyMax)}`,
        eur(c.power),
        c.total != null ? eur(c.total) : `${eur(c.totalMin)} – ${eur(c.totalMax)}`,
        sv ? (sv.kind === "rango" ? `${eur(sv.min)} a ${eur(sv.max)}` : eur(sv.value)) : "—",
      ];
    }),
  });
  y = lastY(doc) + 6;
  y = section(doc, "Hipótesis y calidad de la información", y);
  y = paragraph(
    doc,
    p.scenario.mode === "factura"
      ? `Consumo por periodo procedente de facturas (${p.scenario.values.map((v, i) => `P${i + 1} ${n(v)} kWh`).join(", ")}). Coste calculado con los precios de cada oferta.`
      : p.scenario.mode === "hipotesis"
        ? `Reparto por periodos según hipótesis comercial (${p.scenario.label}). Resultado ORIENTATIVO: no procede de consumos medidos por periodo.`
        : "El SIPS solo incluye consumo mensual total. Se muestra el RANGO garantizado de coste (todo el consumo al precio más bajo / más alto de cada oferta). Para una comparativa exacta se necesitan facturas o la curva de carga.",
    y,
  );
  y = paragraph(doc, `Consumo anual de referencia: ${n(p.scenario.annualKWh)} kWh (columna E.A. Anual del SIPS). Impuestos según configuración de cada oferta (IEE e IVA). Validez de cada oferta según su ficha.`, y);
  for (const c of p.costs.filter((x) => x.issues.length)) y = paragraph(doc, `${c.offer.comercializadora} · ${c.offer.nombre}: ${c.issues.join(" ")}`, y, 7.5);
  footer(doc, p.author);
  doc.save(`Comparativa_ofertas_${p.s.cups}.pdf`);
}

export async function supplyReportPdf(p: { s: Supply; ins: ReturnType<typeof useInsights>; opp: Opportunity; logo: string | null; author: string }) {
  const { s, ins } = p;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  header(doc, "Radiografía energética y oportunidades", new Date().toLocaleDateString("es-ES"), p.logo, await officialLogo());
  let y = supplyBlock(doc, s, 42) + 8;
  y = section(doc, "Consumo y potencia mensual", y);
  const M = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  autoTable(doc, {
    startY: y,
    theme: "grid",
    headStyles: { fillColor: TEAL, fontSize: 7 },
    styles: { fontSize: 7, halign: "right" },
    columnStyles: { 0: { halign: "left" } },
    head: [["", ...M]],
    body: [
      ["Activa (kWh)", ...s.eaMensual.map((v) => n(v))],
      ["Reactiva (kVArh)", ...s.erMensual.map((v) => n(v))],
      ["Pot. máx. (kW)", ...s.potMensual.map((v) => n(v, 1))],
    ],
  });
  y = lastY(doc) + 6;
  y = section(doc, "Diagnóstico", y);
  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 8.5 },
    columnStyles: { 0: { textColor: GREY, cellWidth: 55 } },
    body: [
      ["Potencias contratadas", s.potContratada.map((v, i) => (v != null ? `P${i + 1} ${n(v, 1)}` : null)).filter(Boolean).join(" · ") + " kW"],
      ["Optimización de potencia", ins.best ? `Equilibrado: ${ins.best.pc.map((v) => n(v, 1)).join(" / ")} kW · ahorro mínimo ${eur(ins.best.netSavingLB)}/año · confianza ${ins.opt?.confidence.level}` : (ins.opt?.reason ?? "No disponible")],
      ["Energía reactiva", `R/A anual ${ins.reactive.annualRatio != null ? n(ins.reactive.annualRatio * 100) + " %" : "—"} · ${ins.reactive.applies.why}`],
      ["Puntuación comercial", `${ins.score.score}/100 (prioridad comercial, no ahorro)`],
      ["Alertas", `${ins.alerts.length} (${ins.alerts.filter((a) => a.severity === "critica").length} críticas)`],
    ],
  });
  y = lastY(doc) + 6;
  y = section(doc, "Alertas", y);
  autoTable(doc, {
    startY: y,
    theme: "grid",
    headStyles: { fillColor: TEAL, fontSize: 8 },
    styles: { fontSize: 7.5 },
    head: [["Gravedad", "Alerta", "Motivo", "Fuente"]],
    body: ins.alerts.map((a) => [a.severity, a.title, a.reason, a.columns.join(", ")]),
  });
  y = lastY(doc) + 6;
  y = section(doc, "Acciones recomendadas", y);
  for (const a of ins.actions) y = paragraph(doc, `• [${a.prio}] ${a.text}`, y);
  footer(doc, p.author);
  doc.save(`Informe_${s.cups}.pdf`);
}
