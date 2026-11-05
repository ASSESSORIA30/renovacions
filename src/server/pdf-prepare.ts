/**
 * Preparació d'un PDF abans de llegir-lo (lector de factures, captació, contractes de comercialitzadores, tarifes amb IA).
 *
 * 1. El contingut ha de ser un PDF de debò (`pdfHeaderOffset`): capçalera «%PDF-x.y» a l'inici o precedida d'un marge
 *    limitat de bytes (fins a 1024, com admeten Acrobat i pdf.js), i mai un altre format camuflat.
 * 2. Si hi ha bytes previs, es retiren en memòria: el document que queda és EXACTAMENT el PDF original a partir de la
 *    capçalera (sense pèrdua d'informació). L'original desat a Storage no es toca.
 * 3. Es comprova que l'estructura es pot llegir amb pdf.js (el mateix motor que fa servir `unpdf`).
 * 4. Només si pdf.js no el pot obrir, es prova de reconstruir la taula de referències amb pdf-lib (desa de nou els
 *    mateixos objectes) i es torna a comprovar. Si tampoc es pot, el PDF és corrupte.
 * Errors específics: protegit amb contrasenya, corrupte, sense pàgines o no és un PDF.
 */
import { pdfHeaderOffset } from "@/core/pdf-sniff";
import { HttpError } from "./http-error"; // sense dependències de Supabase: també el fa servir doc-text

export type PdfProblemCode = "no_pdf" | "protegit" | "corrupte" | "sense_pagines";
export const PDF_PROBLEM_MESSAGE: Record<PdfProblemCode, string> = {
  no_pdf: "El fitxer no és un PDF vàlid (el contingut no correspon a un PDF, encara que l'extensió ho digui)",
  protegit: "El PDF està protegit amb contrasenya: obre'l, desa'l sense contrasenya (o imprimeix-lo com a PDF) i torna'l a pujar",
  corrupte: "El PDF està malmès o incomplet i no es pot llegir: descarrega'l de nou de l'àrea de clients de la comercialitzadora",
  sense_pagines: "El PDF no té cap pàgina",
};
export class PdfProblem extends HttpError {
  constructor(public code: PdfProblemCode) { super(code === "no_pdf" ? 415 : 422, PDF_PROBLEM_MESSAGE[code]); }
}

export interface PreparedPdf {
  bytes: Uint8Array;
  /** bytes retirats abans de la capçalera */
  offset: number;
  normalized: "cap" | "capcalera" | "reconstruit";
  pages: number;
}

const isPassword = (e: unknown) => /PasswordException|password/i.test(`${(e as { name?: string })?.name ?? ""} ${(e as Error)?.message ?? ""}`);
const isEncrypted = (e: unknown) => /Encrypted/i.test(`${(e as { name?: string })?.name ?? ""} ${(e as Error)?.message ?? ""}`);

async function pdfjsPages(b: Uint8Array): Promise<number> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(b)); // còpia: pdf.js pot transferir el buffer
  try { return doc.numPages; } finally { await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined); }
}

export async function preparePdf(input: Uint8Array): Promise<PreparedPdf> {
  const offset = pdfHeaderOffset(input);
  if (offset < 0) throw new PdfProblem("no_pdf");
  const bytes = offset > 0 ? input.slice(offset) : input;
  try {
    const pages = await pdfjsPages(bytes);
    if (pages < 1) throw new PdfProblem("sense_pagines");
    return { bytes, offset, normalized: offset > 0 ? "capcalera" : "cap", pages };
  } catch (e) {
    if (e instanceof PdfProblem) throw e;
    if (isPassword(e)) throw new PdfProblem("protegit");
  }
  // pdf.js no l'ha pogut obrir: reconstrucció amb pdf-lib (mateixos objectes, taula de referències nova)
  let rebuilt: Uint8Array;
  let libPages = 0;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    libPages = doc.getPageCount();
    rebuilt = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  } catch (e) {
    throw new PdfProblem(isEncrypted(e) ? "protegit" : "corrupte");
  }
  if (libPages < 1) throw new PdfProblem("corrupte");
  try {
    const pages = await pdfjsPages(rebuilt);
    if (pages !== libPages) throw new Error("pàgines diferents");
    return { bytes: rebuilt, offset, normalized: "reconstruit", pages };
  } catch (e) {
    throw new PdfProblem(isPassword(e) ? "protegit" : "corrupte");
  }
}

/** Avís per a l'usuari quan el document s'ha hagut de normalitzar (no és un error). */
export function preparedWarning(p: PreparedPdf): string | null {
  if (p.normalized === "capcalera") return `El PDF portava ${p.offset} bytes addicionals abans de la capçalera: s'han ignorat per llegir-lo (el document original no es modifica).`;
  if (p.normalized === "reconstruit") return "El PDF tenia l'estructura interna danyada: s'ha reconstruït en memòria per poder-lo llegir. Revisa les dades extretes.";
  return null;
}
