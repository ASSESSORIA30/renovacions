/**
 * Detecció de PDF pels bytes reals (no per l'extensió ni pel tipus declarat). Lògica pura, sense dependències.
 *
 * L'especificació PDF i els lectors habituals (Acrobat, pdf.js) admeten bytes addicionals ABANS de la capçalera
 * «%PDF-x.y» (p. ex. bytes afegits per una passarel·la de correu o un sistema de facturació). Alguns PDF reals de
 * comercialitzadores en porten. Aquí s'accepten, però només dins d'un marge limitat i mai si el fitxer comença com
 * un altre format conegut (ZIP, executable, HTML, script…), per no admetre fitxers «políglots».
 */

/** Marge màxim de bytes abans de «%PDF-» (el mateix que fan servir pdf.js i Acrobat). */
export const PDF_HEADER_MAX_OFFSET = 1024;

/** Formats que mai poden passar per PDF encara que continguin «%PDF-» més endavant. */
const FORBIDDEN_STARTS: number[][] = [
  [0x50, 0x4b, 0x03, 0x04], // ZIP / DOCX / XLSX
  [0x4d, 0x5a], // executable Windows (MZ)
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x23, 0x21], // script «#!»
  [0xd0, 0xcf, 0x11, 0xe0], // Office antic / MSG
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O / Java
];

/**
 * Posició de la capçalera «%PDF-d.d» dins dels primers 1024 bytes, o -1 si no és un PDF admissible.
 * 0 = PDF normal; > 0 = PDF vàlid amb bytes previs que caldrà normalitzar abans de llegir-lo.
 */
export function pdfHeaderOffset(b: Uint8Array): number {
  if (!b || b.length < 8) return -1;
  if (FORBIDDEN_STARTS.some((sig) => sig.every((v, i) => b[i] === v))) return -1;
  const lim = Math.min(b.length - 8, PDF_HEADER_MAX_OFFSET);
  for (let i = 0; i <= lim; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d && isDigit(b[i + 5]) && b[i + 6] === 0x2e && isDigit(b[i + 7])) {
      if (i > 0 && looksLikeMarkup(b.subarray(0, i))) return -1; // HTML o XML amb un PDF «enganxat»
      return i;
    }
  }
  return -1;
}

const isDigit = (x: number) => x >= 0x30 && x <= 0x39;
function looksLikeMarkup(prefix: Uint8Array) {
  const s = String.fromCharCode(...prefix.subarray(0, 64)).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart().toLowerCase();
  return s.startsWith("<!doctype") || s.startsWith("<html") || s.startsWith("<?xml") || s.startsWith("<svg") || s.startsWith("<script");
}

/**
 * Comprovació estructural mínima (sense llegir el document): capçalera, almenys un objecte i un final de fitxer
 * («%%EOF») o una taula de referències. La validació definitiva la fa el lector (pdf.js) al servidor.
 */
export function pdfLooksStructured(b: Uint8Array): boolean {
  const off = pdfHeaderOffset(b);
  if (off < 0) return false;
  const tail = latin1(b.subarray(Math.max(off, b.length - 4096)));
  const head = latin1(b.subarray(off, Math.min(b.length, off + 65536)));
  const hasObj = /\d+\s+\d+\s+obj\b/.test(head) || /\d+\s+\d+\s+obj\b/.test(tail);
  const hasEnd = /%%EOF/.test(tail) || /startxref|\btrailer\b|\/XRef\b/.test(tail);
  return hasObj && hasEnd;
}

const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 65536) s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 65536))); return s; };
