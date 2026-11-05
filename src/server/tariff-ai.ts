import "server-only";
import { aiFailure } from "./ai";
/**
 * LECTOR DE TARIFES AMB IA (servidor). Només personal d'administració.
 * - PDF / imatge: el navegador el puja a la carpeta privada de l'usuari (bucket `invoices`), aquí es descarrega,
 *   es comprova el tipus real, es llegeix i s'esborra immediatament (no es conserva).
 * - Excel / CSV: el navegador l'envia ja convertit a text (taules).
 * Els documents de tarifes no contenen dades personals; igualment el contingut es tracta com a DADES (anti-injecció)
 * i la sortida només és una proposta: la valida `aiTariffsToVersions` + `checkVersion` i sempre entra com a esborrany.
 */
import { sniffMime } from "@/comparator/invoice";
import { preparePdf } from "./pdf-prepare";
import { parseAiJson, splitSheetText, TARIFF_AI_SYSTEM } from "@/comparator/tariff-ai";
import { detectSurplusKeywords } from "@/comparator/surplus-detect";
import { env } from "./env";
import { imageForAi } from "./invoices";
import { adminClient, HttpError } from "./supabase";
import { isEndesaOpen, parseEndesaOpen } from "@/comparator/endesa-open";
import { storedPdfPages } from "./tariff-open";
import { isNufriTariffDoc, parseNufriDoc } from "@/comparator/nufri-reader";

export const MAX_TARIFF_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TARIFF_TEXT_CHARS = 160_000;

type Content = { type: string; [k: string]: unknown };
/** La resposta no hi cap: el document es parteix automàticament (mai es demana a l'usuari que el divideixi). */
class TooLong extends Error { constructor() { super("resposta massa llarga"); } }

/** Ajunta els resultats de diversos fragments (sense duplicar ofertes idèntiques). */
function mergeRaw(parts: unknown[]): unknown {
  const root: Record<string, unknown> = { offers: [], warnings: [] };
  const seen = new Set<string>();
  for (const p of parts) {
    const r = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    for (const k of ["supplierName", "publishedAt", "validFrom", "validTo"]) if (root[k] == null && r[k] != null) root[k] = r[k];
    for (const o of Array.isArray(r.offers) ? r.offers : []) { const key = JSON.stringify(o); if (!seen.has(key)) { seen.add(key); (root.offers as unknown[]).push(o); } }
    for (const w of Array.isArray(r.warnings) ? r.warnings : []) (root.warnings as unknown[]).push(w);
    if (Array.isArray(r.surplusKeywords)) root.surplusKeywords = [...((root.surplusKeywords as unknown[]) ?? []), ...r.surplusKeywords];
  }
  return root;
}
/** Paraules clau d'excedents detectades localment al text (no depèn de la IA). */
function withKeywords(raw: unknown, text: string | null): unknown {
  if (!text || !raw || typeof raw !== "object") return raw;
  const k = detectSurplusKeywords(text);
  return k.length ? { ...(raw as Record<string, unknown>), docKeywords: k } : raw;
}
async function askChunked(text: string, fileName: string, hint: string | null, size = 24_000): Promise<{ raw: unknown; chunks: number }> {
  const chunks = splitSheetText(text, size);
  const results: unknown[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      const doc = `<document nom="${fileName.replace(/[<>"]/g, "")}" fragment="${i + 1} de ${chunks.length}">\n${chunks[i]}\n</document>`;
      try { results[i] = await ask([{ type: "text", text: doc }], hint); }
      catch (e) {
        if (!(e instanceof TooLong) || size <= 6_000) throw e instanceof TooLong ? new HttpError(422, "Un fragment del document continua sent massa gran per a la IA. Fes servir una plantilla de lectura per a aquest format.") : e;
        results[i] = (await askChunked(chunks[i], fileName, hint, Math.floor(size / 2))).raw;   // es torna a partir només aquest fragment
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
  return { raw: mergeRaw(results), chunks: chunks.length };
}

async function ask(content: Content[], hint: string | null): Promise<unknown> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 16000,
      system: TARIFF_AI_SYSTEM,
      messages: [{ role: "user", content: [...content, { type: "text", text: `Extreu totes les tarifes del document en el JSON indicat.${hint ? ` La comercialitzadora és «${hint.replace(/[«»"]/g, "")}».` : ""}` }] }],
    }),
  });
  if (r.status === 429 || r.status === 529) throw new HttpError(503, "El servei d'IA està saturat. Torna-ho a provar d'aquí a un moment.");
  if (!r.ok) throw new HttpError(502, await aiFailure(r));
  const j = (await r.json()) as { content: { type: string; text?: string }[]; stop_reason?: string };
  const text = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return parseAiJson(text);
  } catch {
    if (j.stop_reason === "max_tokens") throw new TooLong();
    throw new HttpError(422, "La IA no ha retornat dades estructurades. Prova amb un altre format del document.");
  }
}

export async function readTariffFile(userId: string, b: { path?: string; text?: string; fileName: string; supplierHint?: string | null }) {
  // Fase 10.1: la Tarifa Open d'Endesa es llegeix amb el lector local (sense IA) i es pondera per hores
  if (b.text == null && b.path && b.path.startsWith(`${userId}/`) && !b.path.includes("..") && /\.pdf$/i.test(b.fileName)) {
    const pages = await storedPdfPages(b.path).catch(() => null);
    // annexos d'Energía Nufri: lector local determinista (sense IA, també sense clau)
    if (pages && isNufriTariffDoc(pages.join("\n"))) {
      await adminClient().storage.from("invoices").remove([b.path]).then(() => undefined, () => undefined);
      const nufri = parseNufriDoc(pages);
      return { raw: null, kind: `Annex Nufri ${nufri.kind === "gas" ? "gas" : "electricitat"} ${nufri.version ?? ""} · lector local (sense IA)`.replace(/\s+/g, " "), nufri };
    }
    if (pages && isEndesaOpen(pages.join("\n"))) {
      await adminClient().storage.from("invoices").remove([b.path]).then(() => undefined, () => undefined);
      return { raw: null, kind: "Tarifa Open d'Endesa · lector local (sense IA)", open: parseEndesaOpen(pages, b.fileName) };
    }
  }
  if (!env.anthropicKey) throw new HttpError(400, "El lector amb IA necessita ANTHROPIC_API_KEY al servidor.");
  const hint = b.supplierHint?.trim().slice(0, 120) || null;
  const started = Date.now();
  if (b.text != null) {
    if (b.text.length > MAX_TARIFF_TEXT_CHARS) throw new HttpError(413, "El full de càlcul és massa gran. Deixa només els fulls amb preus.");
    // Documents grans: es parteixen per blocs de files des del principi; si un sol bloc no hi cap, es torna a partir.
    if (b.text.length > 30_000) {
      const r = await askChunked(b.text, b.fileName, hint);
      console.info(`[tarifes-ia] full de càlcul llegit en ${r.chunks} fragments en ${Date.now() - started} ms`);
      return { raw: withKeywords(r.raw, b.text), kind: `full de càlcul (${r.chunks} fragments)` };
    }
    try {
      const raw = await ask([{ type: "text", text: `<document nom="${b.fileName.replace(/[<>"]/g, "")}">\n${b.text}\n</document>` }], hint);
      console.info(`[tarifes-ia] full de càlcul llegit en ${Date.now() - started} ms`);
      return { raw: withKeywords(raw, b.text), kind: "full de càlcul" };
    } catch (e) {
      if (!(e instanceof TooLong)) throw e;
      const r = await askChunked(b.text, b.fileName, hint, 12_000);
      return { raw: withKeywords(r.raw, b.text), kind: `full de càlcul (${r.chunks} fragments)` };
    }
  }
  if (!b.path || !b.path.startsWith(`${userId}/`) || b.path.includes("..")) throw new HttpError(403, "Fitxer no vàlid");
  const sb = adminClient();
  const dl = await sb.storage.from("invoices").download(b.path);
  // El fitxer no es conserva: s'esborra tant si la lectura funciona com si no.
  const remove = () => sb.storage.from("invoices").remove([b.path!]).then(() => undefined, () => undefined);
  try {
    if (dl.error || !dl.data) throw new HttpError(404, "No s'ha trobat el fitxer pujat");
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    if (bytes.byteLength > MAX_TARIFF_FILE_BYTES) throw new HttpError(413, "El fitxer supera els 10 MB");
    const mime = sniffMime(bytes);
    if (!mime) throw new HttpError(415, "Format no admès: puja un PDF, una imatge o un Excel/CSV");
    const pdf = mime === "application/pdf" ? (await preparePdf(bytes)).bytes : null; // la IA rep el PDF normalitzat
    const content: Content[] =
      pdf
        ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } }]
        : await imageForAi(bytes, mime).then((img) => [{ type: "image", source: { type: "base64", media_type: img.media, data: img.data.toString("base64") } }]);
    const raw = await ask(content, hint).catch((e) => { if (e instanceof TooLong) throw new HttpError(422, "La resposta de la IA ha superat la mida màxima. Si és un Excel, puja l'Excel original (es llegeix per parts automàticament)."); throw e; });
    console.info(`[tarifes-ia] ${mime} llegit en ${Date.now() - started} ms`);
    const docText = pdf ? await import("./doc-text").then((m) => m.pdfText(pdf)).then((t) => t.pages.join("\n")).catch(() => null) : null;
    return { raw: withKeywords(raw, docText), kind: mime === "application/pdf" ? "PDF" : "imatge" };
  } finally {
    await remove();
  }
}
