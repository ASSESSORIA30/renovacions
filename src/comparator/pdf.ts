/**
 * GENERADOR DE PDF CORPORATIU de comparatives (jsPDF, ja present al projecte). A4 HORITZONTAL.
 * Pàgina 1 (els dos estils): full de comparació en 4 columnes ACTUAL | OPCIÓ 1 | OPCIÓ 2 | OPCIÓ 3 (Fase 3).
 * «detallada» afegeix el desglossament del càlcul de cada opció i les hipòtesis.
 * Totes les xifres surten del Snapshot (resultat versionat): aquí NO es recalcula res.
 * Mai inclou comissions ni marges.
 */
import { jsPDF } from "jspdf";
import { snapshotPermanenceLabel } from "./permanence";
import { comparisonSheet, type ComparisonSheet, type PricedBlock, type ValueBlock } from "./sheet-view";
import autoTable from "jspdf-autotable";
import { LOGO_DATA_URL } from "@/core/logo";
import { periodsOf } from "./engine";
import { presentationOrder, type Snapshot } from "./snapshot";
import { CONTRACT_TYPE_LABEL, SAS_LABEL, type OfferEvaluation } from "./types";

type Lang = "ca" | "es";
type RGB = [number, number, number];
const INK: RGB = [24, 27, 33];
const MUTED: RGB = [110, 116, 128];
const LINE: RGB = [226, 230, 235];
const SERIES: RGB[] = [[110, 116, 128], [21, 128, 61], [42, 120, 214], [235, 104, 52]];
/** Colors corporatius: blau petroli, verd i blanc. Cada columna manté el seu color a tot el document. */
const PETROL: RGB = [11, 61, 79];
const PETROL2: RGB = [19, 96, 112];
const GREEN: RGB = [92, 168, 46];
const COLS: RGB[] = [[30, 80, 150], [14, 140, 140], [70, 150, 45], [120, 150, 30]];
const WARN: RGB = [180, 83, 9];
const mix = (c: RGB, k: number): RGB => [Math.round(c[0] + (255 - c[0]) * k), Math.round(c[1] + (255 - c[1]) * k), Math.round(c[2] + (255 - c[2]) * k)];
const lerp = (a: RGB, b: RGB, k: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];

const T = {
  ca: {
    title: "Proposta d'estalvi energètic", detailed: "Proposta detallada", client: "Client", supply: "Subministrament", cups: "CUPS", tariff: "Peatge", annual: "Consum del període",
    power: "Potències contractades", current: "Contracte actual", best: "Alternativa recomanada", alt: "Alternativa", noCurrent: "Sense preus actuals", notCalc: "No calculable",
    totalYear: "Cost amb impostos", saving: "Estalvi", moreExpensive: "Més car", chart: "Comparativa de cost", reco: "Recomanació", why: "Per què", conditions: "Condicions",
    validity: "Vigència de l'oferta", permanence: "Permanència", none: "Sense permanència", months: "mesos", prices: "Preus per període (sense impostos)", energy: "Energia €/kWh",
    powerP: "Potència", breakdown: "Desglossament del càlcul", concept: "Concepte", formula: "Càlcul", amount: "Import", hypotheses: "Hipòtesis i dades", obs: "Observacions",
    contact: "Contacte", estimate: "Import estimat", incomplete: "Càlcul incomplet", basis: { anual: "Consum anual", periode_facturat: "Període facturat", anualitzat: "Anualitzat (estimació)" },
    days: "dies", page: "Pàgina", issued: "Data", engine: "Motor de càlcul", disclaimer: "Imports calculats amb les dades i hipòtesis indicades. No són estalvis garantits: els consums i preus reals poden variar.",
    sas: "SAS", missing: "Falta", excluded: "No elegible",
  },
  es: {
    title: "Propuesta de ahorro energético", detailed: "Propuesta detallada", client: "Cliente", supply: "Suministro", cups: "CUPS", tariff: "Peaje", annual: "Consumo del periodo",
    power: "Potencias contratadas", current: "Contrato actual", best: "Alternativa recomendada", alt: "Alternativa", noCurrent: "Sin precios actuales", notCalc: "No calculable",
    totalYear: "Coste con impuestos", saving: "Ahorro", moreExpensive: "Más caro", chart: "Comparativa de coste", reco: "Recomendación", why: "Por qué", conditions: "Condiciones",
    validity: "Vigencia de la oferta", permanence: "Permanencia", none: "Sin permanencia", months: "meses", prices: "Precios por periodo (sin impuestos)", energy: "Energía €/kWh",
    powerP: "Potencia", breakdown: "Desglose del cálculo", concept: "Concepto", formula: "Cálculo", amount: "Importe", hypotheses: "Hipótesis y datos", obs: "Observaciones",
    contact: "Contacto", estimate: "Importe estimado", incomplete: "Cálculo incompleto", basis: { anual: "Consumo anual", periode_facturat: "Periodo facturado", anualitzat: "Anualizado (estimación)" },
    days: "días", page: "Página", issued: "Fecha", engine: "Motor de cálculo", disclaimer: "Importes calculados con los datos e hipótesis indicados. No son ahorros garantizados: los consumos y precios reales pueden variar.",
    sas: "SAS", missing: "Falta", excluded: "No elegible",
  },
} as const;

const eur = (n: number | null | undefined, lang: Lang) => (n == null ? "—" : n.toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }));
const nf = (n: number | null | undefined, d: number, lang: Lang) => (n == null ? "—" : n.toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const dt = (s: string | null | undefined, lang: Lang) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString(lang === "es" ? "es-ES" : "ca-ES") : "—");

export interface PdfOptions {
  kind: "resum" | "detallada";
  lang: Lang;
  recommendation: string | null;
  company: { nombre: string; telefono: string; email: string; web: string; direccion: string };
  salesperson: string | null;
  logo?: string | null;
}

export function renderComparisonPdf(s: Snapshot, o: PdfOptions): { blob: Blob; bytes: ArrayBuffer; fileName: string } {
  const L = T[o.lang];
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const W = 297, H = 210, M = 8;
  const alts = presentationOrder(s);
  const cur = s.result.current;
  const per = periodsOf(s.supply.accessTariff, s.supply.energyType);
  const sh = comparisonSheet(s, o.lang);
  const lastY = (fallback: number) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;
  const logo = () => { try { doc.addImage(o.logo || LOGO_DATA_URL, "PNG", M, 3, 19, 19); } catch { /* logo opcional */ } };

  /** Capçalera de les pàgines de detall (franja petroli). */
  const header = (subtitle: string) => {
    gradient(0, 0, W, 18, PETROL, PETROL2);
    try { doc.addImage(o.logo || LOGO_DATA_URL, "PNG", M, 2, 14, 14); } catch { /* */ }
    doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(13).text(subtitle, M + 18, 9);
    doc.setFont("helvetica", "normal").setFontSize(8).text(`${o.company.nombre} · ${L.issued}: ${dt(s.computedAt, o.lang)}${s.client.name ? ` · ${s.client.name}` : ""}`, M + 18, 14);
    doc.setTextColor(...INK);
  };
  const gradient = (x: number, y: number, w: number, h: number, a: RGB, b: RGB, steps = 40) => {
    for (let i = 0; i < steps; i++) doc.setFillColor(...lerp(a, b, i / (steps - 1))).rect(x + (w * i) / steps, y, w / steps + 0.3, h, "F");
  };
  const footer = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(...LINE).setLineWidth(0.2).line(M, H - 7, W - M, H - 7);
      doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(...MUTED);
      doc.text([o.company.nombre, o.company.telefono, o.company.email, o.company.web].filter(Boolean).join(" · "), M, H - 3.5);
      doc.text(`${L.page} ${i}/${n} · ${L.engine} ${s.engineVersion} · ${dt(s.computedAt, o.lang)}`, W - M, H - 3.5, { align: "right" });
    }
  };

  /* ================= Pàgina 1 · full de comparació en 4 columnes ================= */
  drawSheet(doc, sh, { W, H, M, logo, gradient, lastY });

  /* ================= Recomanació i observacions ================= */
  const extra = [o.recommendation ? { t: L.reco, v: o.recommendation } : null, s.observations ? { t: L.obs, v: s.observations } : null].filter(Boolean) as { t: string; v: string }[];
  if (extra.length) {
    doc.addPage();
    header(L.reco);
    let yy = 28;
    for (const e of extra) {
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...PETROL).text(e.t, M, yy);
      const lines = doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK).splitTextToSize(e.v, W - 2 * M).slice(0, 30);
      doc.text(lines, M, yy + 6);
      yy += 10 + lines.length * 4.2;
    }
  }

  if (o.kind === "detallada") {
    /* ---------------- Pàgines de detall */
    const evs: { label: string; ev: { cost: NonNullable<typeof cur> } | OfferEvaluation }[] = [...(cur ? [{ label: `${L.current}${s.currentRetailer ? ` · ${s.currentRetailer}` : ""}`, ev: { cost: cur } }] : []), ...alts.map((e) => ({ label: `${e.offer.supplierName} · ${e.offer.productName}`, ev: e }))];
    for (const { label, ev } of evs) {
      doc.addPage();
      header(L.breakdown);
      let yy = 28;
      doc.setFontSize(12).setTextColor(...INK).setFont("helvetica", "bold").text(label, M, yy);
      doc.setFont("helvetica", "normal");
      const cost = ev.cost;
      if ("offer" in ev) {
        const off = ev.offer;
        // traçabilitat: versió del catàleg i ajustos d'aquesta comparativa (descomptes desactivats, SAS)
        const adj = s.adjustments?.[off.id];
        const adjTxt = adj ? [adj.discountsOff?.length ? (o.lang === "es" ? "descuentos desactivados en esta comparativa" : "descomptes desactivats en aquesta comparativa") : null, adj.sas ? `SAS ${adj.sas.enabled ? `${adj.sas.eurKwh ?? "—"} €/kWh (${adj.sas.justification})` : o.lang === "es" ? "no aplicado" : "no aplicat"}` : null].filter(Boolean).join(" · ") : "";
        doc.setFontSize(7.5).setTextColor(...MUTED).text(`${o.lang === "es" ? "Catálogo de tarifas" : "Catàleg de tarifes"} · v${off.version}${adjTxt ? ` · ${adjTxt}` : ""}`, M, yy + (ev.eligibility.eligible ? 11 : 16), { maxWidth: W - 2 * M });
        doc.setFontSize(8.5).setTextColor(...MUTED).text(`${CONTRACT_TYPE_LABEL[off.contractType]} · ${SAS_LABEL[off.sas.mode]} · ${snapshotPermanenceLabel(off, s.engineVersion, o.lang)} · ${L.validity}: ${dt(off.validFrom, o.lang)} – ${dt(off.validTo, o.lang)}`, M, yy + 6, { maxWidth: W - 2 * M });
        if (!ev.eligibility.eligible) doc.setTextColor(200, 50, 50).text(`${L.excluded}: ${ev.eligibility.reasons.join("; ")}`, M, yy + 11, { maxWidth: W - 2 * M });
        yy += ev.eligibility.eligible ? 9 : 14;
      }
      autoTable(doc, {
        startY: yy + 10,
        head: [[L.concept, L.formula, L.amount]],
        body: [...cost.lines.map((l) => [l.label + (l.estimated ? " *" : ""), l.formula, eur(l.amount, o.lang)]), [{ content: L.totalYear, styles: { fontStyle: "bold" } }, "", { content: cost.ok ? eur(cost.total, o.lang) : "—", styles: { fontStyle: "bold" } }]],
        theme: "striped",
        styles: { fontSize: 7.5, cellPadding: 1.6, textColor: INK },
        headStyles: { fillColor: PETROL, textColor: 255 },
        columnStyles: { 0: { cellWidth: 45 }, 2: { halign: "right", cellWidth: 28 } },
        margin: { left: M, right: M },
      });
      let ty = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120) + 6;
      if (!cost.ok) {
        doc.setFontSize(8).setTextColor(180, 110, 0).text(`${L.missing}: ${cost.missing.join(", ")}`, M, ty, { maxWidth: W - 2 * M });
        ty += 8;
      }
      const notes = [...cost.notes, ...("offer" in ev && ev.offer.conditions ? [`${L.conditions}: ${ev.offer.conditions}`] : []), ...("offer" in ev && ev.offer.penalty ? [ev.offer.penalty] : [])];
      if (notes.length) doc.setFontSize(7.5).setTextColor(...MUTED).text(doc.splitTextToSize(notes.join("\n"), W - 2 * M).slice(0, 30), M, ty);
    }
    // hipòtesis
    doc.addPage();
    header(L.hypotheses);
    const hyp = [
      `${L.basis[s.supply.basis]} · ${s.supply.days} ${L.days} · ${s.supply.territory}`,
      `${L.annual}: ${s.supply.kwh.slice(0, per.energy).map((k, i) => `P${i + 1} ${nf(k, 0, o.lang)}`).join(" · ")} kWh${s.supply.kwhTotal != null ? ` (total ${nf(s.supply.kwhTotal, 0, o.lang)} kWh)` : ""}`,
      `IEE ${nf(s.taxes.ieePct, 8, o.lang)} % (mín. ${nf(s.taxes.ieeMinEurMWh, 2, o.lang)} €/MWh) · ${s.taxes.vat[s.supply.territory].label} ${nf(s.taxes.vat[s.supply.territory].pct, 2, o.lang)} %`,
      ...s.dataNotes,
      "* = import estimat",
      L.disclaimer,
    ];
    const hl = doc.setFontSize(8.5).setTextColor(...INK).splitTextToSize(hyp.join("\n\n"), W - 2 * M).slice(0, 34);
    doc.text(hl, M, 28);
    const cy = Math.min(28 + hl.length * 3.7 + 8, H - 40);
    doc.setFont("helvetica", "bold").text(L.contact, M, cy);
    doc.setFont("helvetica", "normal").text([o.salesperson ?? "", o.company.nombre, o.company.telefono, o.company.email, o.company.web, o.company.direccion].filter(Boolean), M, cy + 6);
  }
  /* ---------------- Fix vs indexat (escenaris de mercat): resum i detallada */
  const ma = s.marketAnalysis;
  if (ma && (ma.bestFixed || ma.indexed.length)) {
    const es = o.lang === "es";
    const X = {
      title: es ? "Fija vs indexada · escenarios de mercado" : "Fixa vs indexada · escenaris de mercat",
      type: es ? "Tipo de tarifa" : "Tipus de tarifa", annual: es ? "Coste anual" : "Cost anual", vs: es ? "Ahorro respecto al actual" : "Estalvi respecte de l'actual",
      current: es ? "Tarifa actual" : "Tarifa actual", fixed: es ? "Mejor fija (precio contractual)" : "Millor fixa (preu contractual)",
      sc: { baixista: es ? "Indexada — bajista" : "Indexada — baixista", central: es ? "Indexada — central" : "Indexada — central", alcista: es ? "Indexada — alcista" : "Indexada — alcista" },
      est: es ? "estimado" : "estimat", ref: es ? "Referencia" : "Referència", inc: es ? "INCOMPLETA: falta" : "INCOMPLETA: falta",
      be: es ? "Punto de equilibrio" : "Punt d'equilibri", risk: es ? "Riesgo de la indexada" : "Risc de la indexada",
      riskTxt: (r: string, sens: string) => es ? `Entre el escenario bajista y el alcista el coste anual varía ${r}. Cada +1 €/MWh de mercado son ${sens} más al año. La fija mantiene el precio durante su vigencia.` : `Entre l'escenari baixista i l'alcista el cost anual varia ${r}. Cada +1 €/MWh de mercat són ${sens} més a l'any. La fixa manté el preu durant la seva vigència.`,
      beTxt: (v: string) => es ? `La indexada es más económica que la fija mientras el mercado esté por debajo de ${v} €/MWh de media.` : `La indexada és més econòmica que la fixa mentre el mercat estigui per sota de ${v} €/MWh de mitjana.`,
      note: es ? "Importes contractuales: tarifa actual y fija. Importes estimados: indexada (dependen del mercado). Los escenarios son hipótesis, no previsiones oficiales." : "Imports contractuals: tarifa actual i fixa. Imports estimats: indexada (depenen del mercat). Els escenaris són hipòtesis, no previsions oficials.",
    };
    doc.addPage();
    header(X.title);
    const rows: (string | { content: string; styles?: Record<string, unknown> })[][] = [[X.current, eur(ma.current.cost, o.lang), X.ref]];
    if (ma.bestFixed) rows.push([`${X.fixed}: ${ma.bestFixed.supplier} · ${ma.bestFixed.name}`, eur(ma.bestFixed.cost, o.lang), eur(ma.bestFixed.savingVsCurrent, o.lang)]);
    const bars: { label: string; v: number; c: RGB }[] = [];
    if (ma.current.cost != null) bars.push({ label: X.current, v: ma.current.cost, c: SERIES[0] });
    if (ma.bestFixed) bars.push({ label: es ? "Mejor fija" : "Millor fixa", v: ma.bestFixed.cost, c: SERIES[1] });
    for (const x of ma.indexed) {
      if (!x.complete) { rows.push([`${x.supplier} · ${x.name}`, { content: `${X.inc} ${x.missing.join(", ")}`, styles: { textColor: [180, 60, 40] } }, ""]); continue; }
      for (const sc of x.scenarios) {
        rows.push([`${X.sc[sc.scenario]} · ${x.supplier} ${x.name} (${nf(sc.avgMarket, 2, o.lang)} €/MWh) *`, sc.cost.ok ? `${eur(sc.cost.total, o.lang)} (${X.est})` : "—", eur(sc.savingVsCurrent, o.lang)]);
        if (sc.cost.ok) bars.push({ label: X.sc[sc.scenario].replace("Indexada — ", "Idx "), v: sc.cost.total, c: sc.scenario === "baixista" ? [42, 120, 214] : sc.scenario === "central" ? [124, 58, 237] : [235, 104, 52] });
      }
    }
    autoTable(doc, { startY: 26, head: [[X.type, X.annual, X.vs]], body: rows, theme: "grid", styles: { fontSize: 8, cellPadding: 1.8, textColor: INK, lineColor: LINE }, headStyles: { fillColor: PETROL, textColor: 255 }, columnStyles: { 1: { halign: "right", cellWidth: 40 }, 2: { halign: "right", cellWidth: 40 } }, margin: { left: M, right: M } });
    let yy = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 90) + 8;
    // gràfic de barres horitzontal (cost anual)
    const max = Math.max(...bars.map((b) => b.v), 1);
    for (const b of bars) {
      doc.setFontSize(7.5).setTextColor(...INK).text(b.label, M, yy + 3.5);
      doc.setFillColor(...b.c).rect(M + 38, yy, ((W - 2 * M - 70) * b.v) / max, 5, "F");
      doc.setTextColor(...MUTED).text(eur(b.v, o.lang), W - M, yy + 3.5, { align: "right" });
      yy += 7.5;
    }
    yy += 4;
    const txt: string[] = [];
    for (const x of ma.indexed.filter((i) => i.complete)) {
      if (x.breakEvenMarket != null) txt.push(`${X.be} (${x.supplier} · ${x.name}): ${X.beTxt(nf(x.breakEvenMarket, 2, o.lang))}`);
      if (x.riskRange != null) txt.push(`${X.risk}: ${X.riskTxt(eur(x.riskRange, o.lang), eur(x.sensitivityPerEurMWh, o.lang))}`);
    }
    txt.push(...ma.hypotheses, X.note, "* = " + X.est);
    doc.setFontSize(8.5).setTextColor(...INK).text(doc.splitTextToSize(txt.join("\n\n"), W - 2 * M).slice(0, Math.max(0, Math.floor((H - 12 - yy) / 3.7))), M, yy);
  }

  footer();
  const bytes = doc.output("arraybuffer");
  const safe = (s.client.name ?? "client").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40);
  return { blob: new Blob([bytes], { type: "application/pdf" }), bytes, fileName: `${o.kind === "resum" ? "Proposta" : "Proposta-detallada"}-${safe}-${s.computedAt.slice(0, 10)}.pdf` };
}


type SheetCtx = { W: number; H: number; M: number; logo: () => void; gradient: (x: number, y: number, w: number, h: number, a: RGB, b: RGB, steps?: number) => void; lastY: (f: number) => number };
type CellDef = { content: string; colSpan?: number; rowSpan?: number; styles?: Record<string, unknown> };
const isNumeric = (v: string) => /^[−-]?[\d.,]+(\s?€)?( \*)?$/.test(v.trim());

/** Full de comparació (pàgina 1). Tot surt del model `comparisonSheet` (mateixes xifres que la pantalla). */
function drawSheet(doc: jsPDF, sh: ComparisonSheet, c: SheetCtx) {
  const { W, H, M } = c;
  const n = sh.columns.length;
  /* ---- capçalera */
  c.logo();
  doc.setFont("helvetica", "bold").setFontSize(21).setTextColor(...PETROL).text("ASSESSORIA", M + 23, 14.5);
  const aw = doc.getTextWidth("ASSESSORIA ");
  doc.setTextColor(...GREEN).text("3.0", M + 23 + aw, 14.5);
  doc.setDrawColor(...GREEN).setLineWidth(0.7).line(M + 23, 17.5, M + 23 + aw + 12, 17.5);
  doc.setDrawColor(...PETROL).setLineWidth(0.3).line(M + 21.5, 4, M + 21.5, 21);
  const bx = 132;
  c.gradient(bx, 0, W - bx, 24, PETROL2, PETROL);
  doc.setFillColor(255, 255, 255).triangle(bx, 0, bx + 14, 0, bx, 24.2, "F");
  doc.setFillColor(...GREEN).triangle(bx, 24, bx + 14, 0, bx + 17, 0, "F").triangle(bx, 24, bx + 17, 0, bx + 3, 24, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(15).text(sh.title, W - M - 10, 10.5, { align: "right" });
  doc.setFontSize(10).setFont("helvetica", "normal");
  const sub1 = `${sh.subtitle.label} `, sub3 = ` ${sh.subtitle.periods}`;
  doc.setFont("helvetica", "bold").setFontSize(14);
  const tw = doc.getTextWidth(sh.subtitle.tariff);
  doc.setFont("helvetica", "normal").setFontSize(10);
  const w1 = doc.getTextWidth(sub1), w3 = doc.getTextWidth(sub3);
  let sx = W - M - 10 - (w1 + tw + w3 + 1.5);
  doc.text(sub1, sx, 19); sx += w1 + 1.5;
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...mix(GREEN, 0.15)).text(sh.subtitle.tariff, sx, 19.3); sx += tw;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(255, 255, 255).text(sub3, sx, 19);
  // llamp
  const lx = W - M - 5, ly = 6;
  doc.setFillColor(255, 255, 255).triangle(lx + 1.5, ly, lx - 1.6, ly + 6, lx + 0.6, ly + 6, "F").triangle(lx + 0.2, ly + 5, lx + 2.6, ly + 5, lx - 0.8, ly + 12, "F");

  /* ---- fitxa del subministrament */
  const L = sh.lang === "es";
  const boxes: { t: string; lines: string[]; w: number }[] = [
    { t: L ? "DATOS DEL SUMINISTRO" : "DADES DEL SUBMINISTRAMENT", lines: [sh.info.client, `CUPS ${sh.info.cups}`], w: 88 },
    { t: L ? "PERIODO ANALIZADO" : "PERÍODE ANALITZAT", lines: [sh.info.period], w: 62 },
    { t: L ? "CONSUMO TOTAL" : "CONSUM TOTAL", lines: [sh.info.kwhTotal], w: 36 },
    { t: sh.title.includes("GAS") ? (L ? "DÍAS FACTURADOS" : "DIES FACTURATS") : L ? "POTENCIA CONTRATADA" : "POTÈNCIA CONTRACTADA", lines: [sh.info.power], w: 46 },
    { t: L ? "COMERCIALIZADORA ACTUAL" : "COMERCIALITZADORA ACTUAL", lines: [sh.info.retailer], w: 0 },
  ];
  const gap = 2.5;
  boxes[4].w = W - 2 * M - boxes.slice(0, 4).reduce((a, b) => a + b.w, 0) - gap * 4;
  let bxx = M;
  const by = 27;
  for (const b of boxes) {
    doc.setFillColor(...PETROL).roundedRect(bxx, by, b.w, 5.2, 1.2, 1.2, "F").rect(bxx, by + 3, b.w, 2.2, "F");
    doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(6.6).text(b.t, bxx + 2, by + 3.7);
    doc.setDrawColor(...mix(PETROL, 0.55)).setLineWidth(0.25).setFillColor(255, 255, 255).roundedRect(bxx, by + 5.2, b.w, 9.6, 1.2, 1.2, "FD");
    doc.setTextColor(...INK);
    if (b.lines.length === 1) {
      doc.setFont("helvetica", "bold").setFontSize(9);
      const fitted = doc.splitTextToSize(b.lines[0], b.w - 4);
      doc.setFontSize(fitted.length > 1 ? 7.4 : 9).text(doc.splitTextToSize(b.lines[0], b.w - 4).slice(0, 2), bxx + b.w / 2, by + (fitted.length > 1 ? 9.2 : 11.2), { align: "center" });
    } else {
      doc.setFont("helvetica", "bold").setFontSize(8).text(doc.splitTextToSize(b.lines[0], b.w - 4)[0], bxx + 2, by + 9.1);
      doc.setFont("helvetica", "normal").setFontSize(7.4).text(b.lines[1], bxx + 2, by + 13);
    }
    bxx += b.w + gap;
  }

  /* ---- taula principal */
  const lead = 56; // secció + període + quantitat
  const gw = (W - 2 * M - lead) / n;
  const colStyles: Record<number, Record<string, unknown>> = { 0: { cellWidth: 21 }, 1: { cellWidth: 17 }, 2: { cellWidth: 18 } };
  for (let i = 0; i < n; i++) { colStyles[3 + 2 * i] = { cellWidth: gw * 0.5 }; colStyles[4 + 2 * i] = { cellWidth: gw * 0.5 }; }
  const totalCols = 3 + 2 * n;
  const nRows = sh.blocks.reduce((a, b) => a + (b.kind === "priced" ? b.rows.length + 2 : b.rows.length), 0);
  // alçada disponible fins a les franges de total i estalvi (capçalera de columnes 10 mm i separadors entre blocs)
  const avail = H - 44 - 33 - 9 - 11 - (sh.blocks.length - 1) * 1.4;
  const level = nRows * 4.5 <= avail ? 0 : nRows * 3.75 <= avail ? 1 : 2;
  const fs = [7, 6.3, 5.8][level];
  const pad = [0.85, 0.55, 0.42][level];
  // mida de la lletra de la secció: la paraula més llarga ha de cabre a la columna (sense partir paraules)
  const sectionSize = (title: string) => {
    doc.setFont("helvetica", "bold");
    let size = fs + 0.8;
    const longest = title.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? "";
    while (size > 5 && (doc.setFontSize(size), doc.getTextWidth(longest)) > 21 - 3) size -= 0.2;
    return size;
  };
  const sectionCell = (title: string, rows: number): CellDef => ({ content: title, rowSpan: rows, styles: { fillColor: PETROL, textColor: 255, fontStyle: "bold", halign: "center", valign: "middle", fontSize: sectionSize(title) } });
  const body: CellDef[][] = [];
  const spacer = (): CellDef[] => [{ content: "", colSpan: totalCols, styles: { minCellHeight: 1.4, cellPadding: 0, fillColor: [255, 255, 255], lineWidth: 0 } }];
  const tint = (i: number, k: number) => mix(COLS[i % COLS.length], k);
  sh.blocks.forEach((b, bi) => {
    if (bi > 0) body.push(spacer());
    if (b.kind === "priced") {
      const pb = b as PricedBlock;
      const subRow: CellDef[] = [sectionCell(pb.title, pb.rows.length + 2), { content: pb.head[0], styles: { fontStyle: "bold", halign: "center" } }, { content: pb.head[1], styles: { fontStyle: "bold", halign: "center" } }];
      for (let i = 0; i < n; i++) subRow.push({ content: pb.head[2], styles: { fontStyle: "bold", halign: "center", fillColor: tint(i, 0.86) } }, { content: pb.head[3], styles: { fontStyle: "bold", halign: "center", fillColor: tint(i, 0.86) } });
      subRow.slice(1, 3).forEach((x) => (x.styles = { ...x.styles, fillColor: mix(PETROL, 0.9) }));
      body.push(subRow);
      pb.rows.forEach((r, ri) => {
        const alt = ri % 2 === 1;
        const row: CellDef[] = [{ content: r.label, styles: { halign: "center", fillColor: alt ? mix(PETROL, 0.95) : [255, 255, 255] } }, { content: r.qty, styles: { halign: "center", fillColor: alt ? mix(PETROL, 0.95) : [255, 255, 255] } }];
        r.cells.forEach((cc, i) => row.push({ content: cc.price, styles: { halign: "center", fillColor: alt ? tint(i, 0.94) : [255, 255, 255] } }, { content: cc.amount, styles: { halign: "right", fillColor: alt ? tint(i, 0.94) : [255, 255, 255] } }));
        body.push(row);
      });
      // «Total energia» si hi cap; si no, «Total» (la secció ja diu de què és)
      doc.setFont("helvetica", "bold").setFontSize(fs + 0.4);
      const tl = pb.total.qty ? (doc.getTextWidth(pb.total.label) + 3.2 <= 17 ? pb.total.label : pb.total.label.split(" ")[0]) : pb.total.label;
      const tot: CellDef[] = pb.total.qty
        ? [{ content: tl, styles: { fontStyle: "bold", fillColor: mix(PETROL, 0.82), fontSize: fs + 0.4 } }, { content: pb.total.qty, styles: { fontStyle: "bold", halign: "center", fillColor: mix(PETROL, 0.82), fontSize: fs + 0.4 } }]
        : [{ content: tl, colSpan: 2, styles: { fontStyle: "bold", fillColor: mix(PETROL, 0.82), fontSize: fs + 0.4 } }];
      pb.total.amounts.forEach((a, i) => tot.push({ content: a, colSpan: 2, styles: { fontStyle: "bold", halign: "right", fillColor: tint(i, sh.columns[i].best ? 0.6 : 0.72), fontSize: fs + 1.6 } }));
      body.push(tot);
    } else {
      const vb = b as ValueBlock;
      vb.rows.forEach((r, ri) => {
        const alt = ri % 2 === 1;
        const row: CellDef[] = [];
        if (ri === 0) row.push(sectionCell(vb.title, vb.rows.length));
        row.push({ content: r.qty ? `${r.label}: ${r.qty}` : r.label, colSpan: 2, styles: { fillColor: alt ? mix(PETROL, 0.95) : [255, 255, 255] } });
        r.values.forEach((v, i) => row.push({ content: v, colSpan: 2, styles: { halign: isNumeric(v) ? "right" : "center", fillColor: alt ? tint(i, 0.94) : [255, 255, 255], ...(r.warn?.[i] ? { textColor: WARN, fontStyle: "bold" } : {}) } }));
        body.push(row);
      });
    }
  });
  const headRow: CellDef[] = [{ content: "", colSpan: 3, styles: { fillColor: [255, 255, 255], lineWidth: 0 } }];
  sh.columns.forEach((col, i) => headRow.push({
    content: `${col.role}${col.best ? ` · ${sh.lang === "es" ? "MEJOR OPCIÓN" : "MILLOR OPCIÓ"}` : ""}\n${col.supplier}\n${col.product}`,
    colSpan: 2,
    styles: { fillColor: COLS[i % COLS.length], textColor: 255, fontStyle: "bold", halign: "center", valign: "middle", fontSize: fs + 0.6, ...(col.best ? { lineWidth: 0.8, lineColor: GREEN } : {}) },
  }));
  // Helvetica (WinAnsi) no té el signe «−»: es fa servir el guionet
  const clean = (rows: CellDef[][]) => rows.map((r) => r.map((x) => ({ ...x, content: x.content.replace(/−/g, "-") })));
  autoTable(doc, {
    startY: 44,
    head: [headRow as never],
    body: clean(body) as never,
    theme: "plain",
    showHead: "everyPage",
    styles: { font: "helvetica", fontSize: fs, cellPadding: { top: pad, bottom: pad, left: 1.4, right: 1.6 }, textColor: INK, lineColor: [214, 222, 226], lineWidth: 0.12, overflow: "linebreak", valign: "middle" },
    columnStyles: colStyles,
    margin: { left: M, right: M, top: 14, bottom: 12 },
    didParseCell: (d) => { if (d.section === "head") d.cell.styles.minCellHeight = 10; },
  });

  /* ---- franja de totals */
  let y = c.lastY(150) + 2.5;
  if (y + 31 > H - 9) { doc.addPage(); y = 16; }
  const gx = (i: number) => M + lead + i * gw;
  doc.setFillColor(...PETROL).roundedRect(M, y, lead - 2, 10, 2, 2, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(8.2).text(doc.splitTextToSize(sh.totals.label, lead - 6), M + 3, y + 4.2);
  sh.totals.text.forEach((t, i) => {
    const x = gx(i) + 3, w = gw - 6;
    const col = COLS[i % COLS.length];
    if (sh.columns[i].best) doc.setDrawColor(...GREEN).setLineWidth(0.9).roundedRect(x - 0.8, y - 0.8, w + 1.6, 11.6, 3, 3, "S");
    doc.setFillColor(...(sh.totals.values[i] == null ? mix(col, 0.55) : col)).roundedRect(x, y, w, 10, 2.5, 2.5, "F");
    doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(sh.totals.values[i] == null ? 8 : 13).text(t + (sh.columns[i].estimated && sh.totals.values[i] != null ? " *" : ""), x + w / 2, y + 6.8, { align: "center" });
  });

  /* ---- franja d'estalvi */
  y += 13;
  doc.setDrawColor(...GREEN).setLineWidth(0.6).setFillColor(255, 255, 255).roundedRect(M, y, W - 2 * M, 17, 3, 3, "FD");
  doc.setFillColor(...GREEN).circle(M + 6, y + 8.5, 3.6, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(8).text("€", M + 6, y + 9.8, { align: "center" });
  doc.setTextColor(...PETROL).setFontSize(7.4).text(doc.splitTextToSize(sh.savings.label, lead - 14), M + 11.5, y + 6.2);
  doc.setFont("helvetica", "normal").setFontSize(6.4).setTextColor(...MUTED).text(`(${sh.periodLabel})`, M + 11.5, y + 14.4);
  sh.savings.text.forEach((t, i) => {
    const x = gx(i) + 6, w = gw - 12;
    const v = sh.savings.values[i], p = sh.savings.pct[i];
    if (i === 0) { doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text(t, x + w / 2, y + 9.8, { align: "center" }); return; }
    if (v == null) { doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED).text("—", x + w / 2, y + 9.8, { align: "center" }); return; }
    const pos = v >= 0;
    doc.setFillColor(...(pos ? mix(GREEN, 0.78) : [252, 226, 226] as RGB)).roundedRect(x, y + 1.8, w, 13.4, 2.5, 2.5, "F");
    doc.setTextColor(...(pos ? PETROL : [160, 40, 40] as RGB)).setFont("helvetica", "bold").setFontSize(11).text(t, x + w / 2, y + 7.4, { align: "center" });
    if (p != null) {
      const pt = `${pos ? "-" : "+"}${Math.abs(p).toLocaleString(sh.lang === "es" ? "es-ES" : "ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
      doc.setFontSize(8);
      const pw = doc.getTextWidth(pt) + 6;
      doc.setFillColor(...(pos ? [46, 125, 50] as RGB : [185, 50, 50] as RGB)).roundedRect(x + w / 2 - pw / 2, y + 9, pw, 4.8, 2.2, 2.2, "F");
      doc.setTextColor(255, 255, 255).text(pt, x + w / 2, y + 12.4, { align: "center" });
    }
  });

  /* ---- notes */
  y += 19;
  const room = Math.floor((H - 8.5 - y) / 2.6);
  if (room > 0) doc.setFont("helvetica", "normal").setFontSize(5.9).setTextColor(...MUTED).text(doc.splitTextToSize(sh.notes.join("  ·  "), W - 2 * M).slice(0, room), M, y + 1.5);
}

/** Resum de text per a WhatsApp (mateixes xifres del Snapshot). */
export function whatsappSummary(s: Snapshot, lang: Lang, link?: string | null) {
  const best = s.result.ranked[0];
  const L = T[lang];
  const parts = [
    lang === "es" ? `Hola${s.client.name ? ` ${s.client.name}` : ""}, le envío la propuesta de Assessoria 3.0:` : `Hola${s.client.name ? ` ${s.client.name}` : ""}, us envio la proposta d'Assessoria 3.0:`,
    s.result.current?.ok ? `• ${L.current}: ${eur(s.result.current.total, lang)}` : null,
    best ? `• ${L.best}: ${best.offer.supplierName} · ${best.offer.productName} — ${eur(best.cost.total, lang)}${best.saving != null ? ` (${L.saving.toLowerCase()} ${eur(best.saving, lang)})` : ""}` : null,
    ...s.result.ranked.slice(1, 3).map((e, i) => `• ${L.alt} ${i + 2}: ${e.offer.supplierName} — ${eur(e.cost.total, lang)}`),
    link ? (lang === "es" ? `Puede consultarla aquí (enlace temporal): ${link}` : `La podeu consultar aquí (enllaç temporal): ${link}`) : null,
  ];
  return parts.filter(Boolean).join("\n");
}
