/**
 * Contracte de PROVA (dades fictícies, 24 pàgines) per al diagnòstic del lector IA:
 * comissions pàg. 3 · liquidació pàg. 7 · objectius pàg. 12 · retrocessions pàg. 18 · excepcions pàg. 21.
 * És el mateix document que tests/fixtures/contracte-prova-condicions.pdf (es genera igual).
 */
import { jsPDF } from "jspdf";

const PAGES: Record<number, string[]> = {
  1: ["CONTRATO DE COLABORACIÓN COMERCIAL (AGENCIA)", "", "Entre ENERGÍA DEMO COMERCIALIZADORA, S.L. (en adelante, la Comercializadora) y ASSESSORIA 3.0 (en adelante, el Agente).", "Documento de PRUEBA con datos ficticios. Vigencia: del 1 de enero de 2027 al 31 de diciembre de 2027."],
  3: ["Cláusula 5. Comisiones por captación", "", "5.1. Producto Luz Hogar (peaje 2.0TD): 40 € por contrato activado.", "5.2. Producto Luz Empresa (peaje 3.0TD): 8 €/MWh sobre el consumo anual contratado.", "5.3. Producto Gas Confort (peaje RL.3): 25 € por contrato activado.", "5.4. Las renovaciones de clientes existentes no generan comisión de captación."],
  7: ["Cláusula 8. Liquidación y pago", "", "Las comisiones se liquidarán mensualmente y se abonarán en un plazo de 60 días desde la activación del suministro.", "El Agente dispondrá de 90 días desde cada liquidación para presentar reclamaciones."],
  12: ["Cláusula 9. Comisiones especiales por objetivos comerciales", "", "9.1. Si el Agente supera 50 altas de Luz Hogar en un mes natural, percibirá una bonificación adicional de 500 € ese mes.", "9.2. Esta bonificación no se aplica a los productos de gas."],
  18: ["Cláusula 14. Retrocesiones", "", "14.1. En caso de baja del cliente durante los 3 primeros meses desde la activación, la Comercializadora descontará el 100% de la comisión percibida por los productos de luz (Luz Hogar y Luz Empresa).", "14.2. Para el producto Gas Confort la retrocesión será proporcional durante 12 meses, según la fórmula: comisión x (12 - meses transcurridos) / 12.", "14.3. El impago de tres facturas consecutivas en los 6 primeros meses supondrá la retrocesión del 50% de la comisión de cualquier producto."],
  21: ["Cláusula 16. Excepciones a las retrocesiones", "", "16.1. No se aplicará la retrocesión de la cláusula 14.1 cuando la baja se deba al fallecimiento del titular o al traslado del suministro a otro punto con la misma Comercializadora.", "16.2. Las bajas por causas imputables a la Comercializadora no darán lugar a retrocesión."],
};

export function buildTestContractPdf(): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, L = 20;
  for (let p = 1; p <= 24; p++) {
    if (p > 1) doc.addPage();
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(`Contrato de colaboración · Energía Demo · DOCUMENTO DE PRUEBA (datos ficticios) · página ${p} de 24`, L, 12);
    const lines = PAGES[p] ?? [`Cláusula ${p + 20}. Disposiciones generales`, "", "Las partes se comprometen a actuar de buena fe y a cumplir la normativa vigente en materia de protección de datos y competencia. Este apartado no contiene condiciones económicas."];
    let y = 28;
    lines.forEach((t, i) => { doc.setFont("helvetica", i === 0 ? "bold" : "normal"); doc.setFontSize(i === 0 ? 13 : 11); const w = doc.splitTextToSize(t, W - 2 * L) as string[]; doc.text(w, L, y); y += w.length * 6 + 2; });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

/** Què ha de trobar una lectura correcta del contracte de prova (comprovació del diagnòstic). */
export interface ExpectCheck { id: string; label: string; ok: boolean; detail: string }
type T = { category: string; field: string; product: string | null; value: number | null; unit: string | null; page: number | null; conditions: Record<string, unknown>; excerpt_found: boolean };
export function checkTestReading(terms: T[]): ExpectCheck[] {
  const n = (s: string | null) => (s ?? "").toLowerCase();
  const of = (p: string) => terms.filter((t) => n(t.product).includes(p));
  const claw = (p: string) => of(p).find((t) => t.category === "retrocessio" && t.field === "baixa_anticipada");
  const hogarClaw = claw("hogar");
  const gasClaw = claw("gas");
  const general = terms.find((t) => t.category === "retrocessio" && t.field === "impagament");
  const c = (id: string, label: string, ok: boolean, detail: string): ExpectCheck => ({ id, label, ok, detail });
  return [
    c("com_hogar", "Comissió Luz Hogar 40 € per contracte (pàg. 3)", of("hogar").some((t) => t.category === "remuneracio" && t.field === "fix_contracte" && t.value === 40), of("hogar").filter((t) => t.category === "remuneracio").map((t) => `${t.field} ${t.value}`).join(", ") || "no trobada"),
    c("com_empresa", "Comissió Luz Empresa 8 €/MWh (pàg. 3)", of("empresa").some((t) => t.category === "remuneracio" && (t.field === "per_mwh" && t.value === 8 || t.field === "per_kwh" && t.value === 0.008)), of("empresa").filter((t) => t.category === "remuneracio").map((t) => `${t.field} ${t.value} ${t.unit ?? ""}`).join(", ") || "no trobada"),
    c("com_gas", "Comissió Gas Confort 25 € (pàg. 3)", of("gas").some((t) => t.category === "remuneracio" && t.value === 25), of("gas").filter((t) => t.category === "remuneracio").map((t) => `${t.field} ${t.value}`).join(", ") || "no trobada"),
    c("bonus", "Bonificació per objectius 500 € a Luz Hogar (pàg. 12)", terms.some((t) => t.category === "remuneracio" && t.value === 500 && (n(t.product).includes("hogar") || !t.product)), terms.filter((t) => t.value === 500).map((t) => `${t.field} → ${t.product ?? "general"}`).join(", ") || "no trobada"),
    c("claw_luz", "Retrocessió 100 % abans de 3 mesos relacionada amb Luz Hogar i Luz Empresa (pàg. 18)", !!hogarClaw && !!claw("empresa") && Number(hogarClaw.conditions.risk_months) === 3, hogarClaw ? `${hogarClaw.value ?? "—"} ${hogarClaw.unit ?? ""} · ${String(hogarClaw.conditions.risk_months ?? "—")} mesos` : "no relacionada amb Luz Hogar"),
    c("claw_not_gas", "La retrocessió de 3 mesos NO s'aplica al gas", !gasClaw || Number(gasClaw.conditions.risk_months) !== 3, gasClaw ? `gas: ${String(gasClaw.conditions.mode ?? "—")} · ${String(gasClaw.conditions.risk_months ?? "—")} mesos` : "correcte"),
    c("claw_gas", "Gas Confort: retrocessió proporcional a 12 mesos (pàg. 18)", !!gasClaw && Number(gasClaw.conditions.risk_months) === 12, gasClaw ? `${String(gasClaw.conditions.mode ?? "—")} · ${String(gasClaw.conditions.risk_months ?? "—")} mesos` : "no trobada"),
    c("exception", "Excepció de la pàg. 21 vinculada a la retrocessió de la pàg. 18", !!hogarClaw && /fallec|defunci|traslad/i.test(String(hogarClaw.conditions.exceptions ?? "")) || terms.some((t) => t.page === 21 || ((t.conditions.pages as number[] | undefined) ?? []).includes(21)), hogarClaw?.conditions.exceptions ? String(hogarClaw.conditions.exceptions).slice(0, 160) : "no vinculada"),
    c("impago", "Impagament 50 % (6 mesos) com a condició general", !!general && general.value === 50, general ? `${general.value} ${general.unit ?? ""} · ${general.product ?? "general"}` : "no trobada"),
    c("payment", "Termini de pagament de 60 dies (pàg. 7), diferent de la retrocessió", terms.some((t) => t.field === "termini_pagament" && t.value === 60), terms.filter((t) => t.category === "pagament").map((t) => `${t.field} ${t.value}`).join(", ") || "no trobat"),
    c("literal", "Fragments literals verificats al document", terms.filter((t) => t.excerpt_found).length >= Math.ceil(terms.length * 0.6), `${terms.filter((t) => t.excerpt_found).length} de ${terms.length}`),
  ];
}
