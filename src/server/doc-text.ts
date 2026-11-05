/**
 * Extracció de text per pàgines (Fase 8.1) dels contractes de comercialitzadores: PDF (capa de text), DOCX (paràgrafs i
 * taules) i detecció de documents escanejats. Sense xarxa: no envia res fora. Les imatges i els PDF sense text necessiten
 * OCR, que només es fa amb el proveïdor d'IA quan Direcció ha configurat les garanties de confidencialitat.
 */
export type DocText = { kind: "pdf" | "docx" | "image" | "sheet"; pages: string[]; chars: number; scanned: boolean; tables: number };

/** Excel (XLSX) o CSV → una «pàgina» per full, amb les files com a «cel·la | cel·la». Sense xarxa. */
export async function sheetText(bytes: Uint8Array, ext: "xlsx" | "csv"): Promise<DocText> {
  const XLSX = await import("xlsx");
  const wb = ext === "csv" ? XLSX.read(new TextDecoder().decode(bytes), { type: "string", raw: true }) : XLSX.read(bytes, { type: "array", cellDates: true });
  const pages = wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" }) as unknown[][];
    const body = rows.filter((r) => r.some((c) => String(c ?? "").trim())).map((r) => r.map((c) => String(c ?? "").trim()).join(" | ")).join("\n");
    return `Full «${name}»\n${body}`;
  });
  const chars = pages.reduce((s, p) => s + p.replace(/\s/g, "").length, 0);
  return { kind: "sheet", pages, chars, scanned: false, tables: pages.length };
}

export async function pdfText(input: Uint8Array): Promise<DocText> {
  // mateixa preparació que el lector de factures: bytes previs a «%PDF-» retirats, errors clars si és corrupte o protegit
  const { preparePdf } = await import("./pdf-prepare");
  const bytes = (await preparePdf(input)).bytes;
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((t) => String(t ?? ""));
  const chars = pages.reduce((s, p) => s + p.replace(/\s/g, "").length, 0);
  // menys de ~40 caràcters útils per pàgina: és una imatge escanejada
  return { kind: "pdf", pages, chars, scanned: chars < 40 * Math.max(1, pages.length), tables: 0 };
}

const xmlText = (s: string) => s.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** DOCX → text. Les taules es converteixen en files «cel·la | cel·la». Els salts de pàgina explícits separen pàgines. */
export async function docxText(bytes: Uint8Array): Promise<DocText> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("El DOCX no té document principal");
  const body = xml.slice(xml.indexOf("<w:body"));
  let tables = 0;
  const pages: string[] = [""];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  for (const m of body.matchAll(re)) {
    const block = m[0];
    if (block.startsWith("<w:tbl>")) {
      tables++;
      for (const row of block.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
        const cells = (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => (c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(xmlText).join(" ").trim());
        pages[pages.length - 1] += `${cells.join(" | ")}\n`;
      }
      pages[pages.length - 1] += "\n";
      continue;
    }
    if (/<w:br [^>]*w:type="page"/.test(block) || /<w:pageBreakBefore\/>/.test(block)) pages.push("");
    pages[pages.length - 1] += `${xmlText(block).trim()}\n`;
  }
  const clean = pages.map((p) => p.replace(/\n{3,}/g, "\n\n").trim());
  return { kind: "docx", pages: clean, chars: clean.join("").length, scanned: false, tables };
}
