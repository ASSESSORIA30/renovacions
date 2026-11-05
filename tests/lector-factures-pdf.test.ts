/**
 * CORRECCIÓ · Lector de factures: PDF amb bytes addicionals abans de «%PDF-1.7» (cas real d'Energia Nufri).
 * Factura FICTÍCIA que reprodueix el format i el problema (cap dada real). Es comproven PDF normals, amb bytes previs,
 * escanejats, protegits, malmesos i fitxers que no són PDF, i que el lector existent extreu totes les dades.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sniffMime } from "@/comparator/invoice";
import { sniffDocument } from "@/core/capture";
import { sniffDoc } from "@/core/crm";
import { PDF_HEADER_MAX_OFFSET, pdfHeaderOffset, pdfLooksStructured } from "@/core/pdf-sniff";
import { NUFRI, NUFRI_PREFIX, nufriPdf, scannedPdf } from "./helpers/nufri-invoice";

vi.mock("server-only", () => ({}));
const fx = (f: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures/factures", f)));
const enc = (s: string) => new TextEncoder().encode(s);
const join = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

describe("detecció del PDF pels bytes reals", () => {
  it("el PDF de Nufri amb 8 bytes abans de «%PDF-1.7» s'accepta (abans: «Format no admès»)", async () => {
    const b = await nufriPdf();
    expect(b[0]).not.toBe(0x25);
    expect(pdfHeaderOffset(b)).toBe(NUFRI_PREFIX.length);
    expect(sniffMime(b)).toBe("application/pdf");
    expect(sniffDocument(b)).toBe("application/pdf"); // captació
    expect(sniffDoc(b, "pdf").ok).toBe(true); // documents de clients, comercialitzadores i reclamacions
    expect(pdfLooksStructured(b)).toBe(true);
  });
  it("PDF normal: sense canvis", async () => {
    const b = await nufriPdf(null);
    expect(pdfHeaderOffset(b)).toBe(0);
    expect(sniffMime(b)).toBe("application/pdf");
  });
  it("no s'accepten fitxers arbitraris amb extensió .pdf", () => {
    expect(sniffMime(enc("Hola, això és un text qualsevol desat com a factura.pdf"))).toBeNull();
    expect(sniffDoc(enc("<html><body>%PDF-1.7 fals</body></html>"), "pdf").ok).toBe(false);
    expect(sniffMime(join(enc("<!DOCTYPE html><p>"), enc("%PDF-1.7\n1 0 obj\n%%EOF")))).toBeNull(); // HTML amb un PDF enganxat
    expect(sniffMime(join(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), enc("%PDF-1.7")))).toBeNull(); // ZIP / DOCX
    expect(sniffMime(join(enc("MZ\x90\x00"), enc("%PDF-1.7")))).toBeNull(); // executable
  });
  it("la capçalera ha d'estar dins dels primers 1024 bytes i ha de ser «%PDF-d.d»", () => {
    expect(sniffMime(join(new Uint8Array(PDF_HEADER_MAX_OFFSET + 1).fill(0x20), enc("%PDF-1.7\n")))).toBeNull();
    expect(sniffMime(join(new Uint8Array(PDF_HEADER_MAX_OFFSET).fill(0x20), enc("%PDF-1.7\n")))).toBe("application/pdf");
    expect(sniffMime(join(enc("   "), enc("%PDF-xx")))).toBeNull();
  });
  it("les imatges continuen igual", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe("image/png");
  });
});

describe("preparació del PDF (servidor)", async () => {
  const { preparePdf, PdfProblem } = await import("@/server/pdf-prepare");
  it("retira els bytes previs sense perdre res: el resultat és idèntic al PDF original", async () => {
    const clean = await nufriPdf(null);
    const p = await preparePdf(await nufriPdf());
    expect(p).toMatchObject({ offset: 8, normalized: "capcalera", pages: 1 });
    expect(Buffer.from(p.bytes).equals(Buffer.from(clean))).toBe(true);
  });
  it("un PDF normal es passa tal qual", async () => {
    const b = await nufriPdf(null);
    const p = await preparePdf(b);
    expect(p.normalized).toBe("cap");
    expect(p.bytes).toBe(b);
  });
  it("protegit amb contrasenya → missatge específic", async () => {
    const e = await preparePdf(fx("protegida-contrasenya.pdf")).catch((x) => x);
    expect(e).toBeInstanceOf(PdfProblem);
    expect(e.code).toBe("protegit");
    expect(e.message).toMatch(/protegit amb contrasenya/);
  });
  it("amb restriccions però sense contrasenya d'obertura → es pot llegir", async () => {
    expect((await preparePdf(fx("restriccions-sense-contrasenya.pdf"))).pages).toBe(1);
  });
  it("malmès o incomplet → missatge específic (no «sembla escanejat»)", async () => {
    const b = await nufriPdf(null);
    for (const bad of [b.slice(0, 300), enc("%PDF-1.7\nnomés una capçalera\n%%EOF")]) {
      const e = await preparePdf(bad).catch((x) => x);
      expect(e.code).toBe("corrupte");
      expect(e.message).toMatch(/malmès o incomplet/);
    }
  });
  it("no és un PDF → 415", async () => {
    const e = await preparePdf(enc("text qualsevol")).catch((x) => x);
    expect([e.code, e.status]).toEqual(["no_pdf", 415]);
  });
});

describe("lector de factures complet amb la factura de Nufri (sense IA)", async () => {
  const { readInvoiceBytes } = await import("@/server/invoices");
  it("extreu titular, CUPS, 3.0TD, potències, consums i preus dels sis períodes", async () => {
    const r = await readInvoiceBytes(await nufriPdf(), "application/pdf", { allowAi: false });
    const d = r.data;
    expect(d.holder.value).toBe(NUFRI.holder);
    expect(d.taxId.value).toBe(NUFRI.taxId);
    expect(d.cups.value).toBe(NUFRI.cups);
    expect(d.accessTariff.value).toBe("3.0TD");
    expect(d.retailer.value).toBe("Nufri");
    expect(d.kw.map((x) => x.value)).toEqual(NUFRI.kw);
    expect(d.kwh.map((x) => x.value)).toEqual(NUFRI.kwh);
    expect(d.energyPrice.map((x) => x.value)).toEqual(NUFRI.energy);
    expect(d.powerPrice.map((x) => x.value)).toEqual(NUFRI.power);
    expect([d.periodFrom.value, d.periodTo.value, d.days.value, d.total.value]).toEqual(["2026-09-01", "2026-09-30", 30, 1213.18]);
    expect(r.warnings.join(" ")).toMatch(/8 bytes addicionals/);
    expect(r.warnings.join(" ")).not.toMatch(/escanejat/);
  });
  it("la mateixa factura sense bytes previs dona exactament les mateixes dades (cap regressió)", async () => {
    const a = (await readInvoiceBytes(await nufriPdf(), "application/pdf", { allowAi: false })).data;
    const b = (await readInvoiceBytes(await nufriPdf(null), "application/pdf", { allowAi: false })).data;
    expect(a).toEqual(b);
  });
  it("PDF escanejat (sense text): s'accepta i avisa que cal lectura visual", async () => {
    const r = await readInvoiceBytes(await scannedPdf(), "application/pdf", { allowAi: false });
    expect(r.warnings.join(" ")).toMatch(/sembla escanejat/);
  });
  it("PDF protegit: error específic, no es llegeix", async () => {
    await expect(readInvoiceBytes(fx("protegida-contrasenya.pdf"), "application/pdf", { allowAi: false })).rejects.toThrow(/protegit amb contrasenya/);
  });
});

describe("altres lectors de documents reutilitzen la mateixa correcció", async () => {
  const { pdfText } = await import("@/server/doc-text");
  it("contractes de comercialitzadores i tarifes: PDF amb bytes previs es llegeix igual", async () => {
    const t = await pdfText(await nufriPdf());
    expect(t.scanned).toBe(false);
    expect(t.pages[0]).toContain(NUFRI.cups);
  });
  it("i un PDF protegit dona el motiu concret", async () => {
    await expect(pdfText(fx("protegida-contrasenya.pdf"))).rejects.toThrow(/protegit amb contrasenya/);
  });
});
