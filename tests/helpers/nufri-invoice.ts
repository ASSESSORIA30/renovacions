/**
 * Factura FICTÍCIA amb el format d'una factura 3.0TD d'Energia Nufri (cap dada real: titular, NIF i CUPS inventats).
 * Reprodueix el problema detectat: el PDF original porta 8 bytes addicionals abans de «%PDF-1.7».
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

export const NUFRI = {
  holder: "COMUNITAT FICTICIA PROVA SL", taxId: "B99999998", cups: "ES0031405000000001ZV", tariff: "3.0TD",
  kw: [15, 15, 15, 15, 15, 20], kwh: [1234, 980, 455, 610, 300, 1520],
  energy: [0.15523, 0.13874, 0.12011, 0.11048, 0.10021, 0.09512], power: [0.06789, 0.03512, 0.01432, 0.01245, 0.00811, 0.00473],
};
/** Bytes que precedeixen la capçalera al PDF original (8 bytes). */
export const NUFRI_PREFIX = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a, 0x20, 0x20, 0x0d, 0x0a]);

const es = (n: number, d: number) => n.toFixed(d).replace(".", ",");
export function nufriLines(): string[] {
  const N = NUFRI;
  return [
    "Energia Nufri, S.L.U. - Factura de electricidad",
    `Titular: ${N.holder}`,
    `NIF: ${N.taxId}`,
    `CUPS: ${N.cups}`,
    `Peaje de acceso: ${N.tariff}`,
    "Periodo de facturación: del 01/09/2026 al 30/09/2026 (30 días)",
    ...N.kw.map((k, i) => `Potencia contratada P${i + 1}: ${es(k, 3)} kW`),
    ...N.kwh.map((k, i) => `Consumo P${i + 1}: ${k.toLocaleString("es-ES")} kWh`),
    ...N.energy.map((p, i) => `Término energía P${i + 1}: ${es(p, 6)} €/kWh`),
    ...N.power.map((p, i) => `Término potencia P${i + 1}: ${es(p, 6)} €/kW día`),
    "Impuesto electricidad 5,11% 38,40 €",
    "IVA 21% 210,55 €",
    "Total a pagar: 1.213,18 €",
  ];
}

/** PDF digital (amb capa de text). `prefix` = bytes previs a la capçalera, com el PDF original de Nufri. */
export async function nufriPdf(prefix: Uint8Array | null = NUFRI_PREFIX): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer("Prova"); doc.setCreator("Prova");
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  nufriLines().forEach((l, i) => page.drawText(l.replace(/[áéíóú]/g, (c) => c), { x: 40, y: 800 - i * 18, size: 9, font }));
  const bytes = await doc.save();
  if (!prefix) return bytes;
  const out = new Uint8Array(prefix.length + bytes.length);
  out.set(prefix, 0); out.set(bytes, prefix.length);
  return out;
}

/** PDF «escanejat»: una sola pàgina sense capa de text (només un rectangle dibuixat). */
export async function scannedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 40, y: 40, width: 500, height: 700, borderWidth: 1 });
  return doc.save();
}
