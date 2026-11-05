/**
 * Documents de PROVA (ficticis) per a la lectura de contractes de comercialitzadores. Imports i clàusules inventats per
 * provar el sistema; no reprodueixen cap contracte real. Es generen en PDF (jsPDF) i DOCX (JSZip) per provar l'extracció.
 */
import JSZip from "jszip";
import { jsPDF } from "jspdf";

export const NUFRI_PAGES = [
  `CONTRATO DE AGENCIA COMERCIAL
Entre NUFRI ENERGÍA DE PRUEBA, S.L. (la Comercializadora) y ASSESSORIA 3.0 (el Agente).
PRIMERA. Objeto. El Agente promoverá la contratación de suministro eléctrico y de gas de la Comercializadora.
SEGUNDA. Vigencia. El presente contrato entrará en vigor el 01/01/2026 y finalizará el 31/12/2026. Se prorrogará automáticamente por periodos anuales salvo preaviso de 60 días.`,
  `TERCERA. Remuneración del Agente.
La Comercializadora abonará al Agente las siguientes comisiones por cada contrato activado:
Nufri Gala: 10 €/MWh
Nufri Galaxy: 15 €/MWh
Nufri Fuji: 0,002 €/kWh
Gas Pyme: 45 € por contrato activado.
Las comisiones se abonarán en un plazo de 30 días desde la emisión de la factura del Agente.`,
  `CUARTA. Retrocesión de comisiones.
Si el cliente causa baja en los primeros 12 meses desde la activación, el Agente devolverá el 100% de la comisión percibida.
En caso de impago del cliente dentro de los 6 primeros meses, se devolverá la parte proporcional: comisión × (6 − meses consumidos) / 6.
QUINTA. Reclamaciones. El Agente dispondrá de 90 días para reclamar liquidaciones.`,
];

/** Mateix contracte amb un annex que contradiu el preu de Gala. */
export const CONTRADICTORY_PAGES = [...NUFRI_PAGES, `ANEXO I. Condiciones particulares.
Nufri Gala: 12 €/MWh para contratos firmados a partir de la firma del presente anexo.`];

export function pdfBytes(pages: string[]): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  pages.forEach((p, i) => {
    if (i) doc.addPage();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(p, 500), 48, 60);
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (t: string, pageBreak = false) => `<w:p>${pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ""}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
/** DOCX mínim vàlid: cada pàgina amb salt de pàgina i la remuneració en una TAULA (producte | comissió). */
export async function docxBytes(pages: string[]): Promise<Uint8Array> {
  const body = pages.map((p, i) => {
    const lines = p.split("\n");
    const rows = lines.filter((l) => /€\/(MWh|kWh)/.test(l));
    const text = lines.filter((l) => !rows.includes(l));
    const table = rows.length ? `<w:tbl>${rows.map((r) => { const [a, b] = r.split(":"); return `<w:tr><w:tc>${para(a.trim())}</w:tc><w:tc>${para((b ?? "").trim())}</w:tc></w:tr>`; }).join("")}</w:tbl>` : "";
    return text.map((t, j) => para(t, i > 0 && j === 0)).join("") + table;
  }).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
