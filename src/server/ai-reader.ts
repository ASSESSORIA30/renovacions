import "server-only";
/**
 * Crida a la IA amb RESPOSTA ESTRUCTURADA OBLIGATÒRIA (tool use forçat) i en STREAMING.
 * - L'estructura la garanteix l'esquema de l'eina: ja no depenem que la IA escrigui un JSON correcte en text lliure.
 * - El streaming permet respostes llargues (documents amb moltes condicions) sense talls de connexió.
 * - Si la resposta es talla (límit de mida o de temps), es recupera la part completa i s'avisa: no es perd tota la lectura.
 */
import { randomUUID } from "node:crypto";
import { aiFailure } from "./ai";
import { env } from "./env";
import { HttpError } from "./supabase";

export type Content = { type: string; [k: string]: unknown };
export interface ToolCallResult { input: unknown; usage: { in: number; out: number }; truncated: boolean; stopReason: string | null }

/**
 * Repara un JSON tallat: el retalla fins al darrer element complet d'una llista o objecte i en tanca les claus.
 * Retorna null si no hi ha res aprofitable.
 */
export function repairJson(s: string): unknown | null {
  try { return JSON.parse(s); } catch { /* cal reparar */ }
  const stack: string[] = [];
  let inStr = false, esc = false, lastSafe = -1, safeStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") { stack.pop(); lastSafe = i; safeStack = [...stack]; }
    else if (c === "," && stack.length) { lastSafe = i - 1; safeStack = [...stack]; }
  }
  if (lastSafe < 0) return null;
  const candidate = s.slice(0, lastSafe + 1).replace(/,\s*$/, "") + safeStack.reverse().join("");
  try { return JSON.parse(candidate); } catch { return null; }
}

/** Llegeix un flux SSE de l'API de missatges i reconstrueix l'entrada de l'eina. */
export async function readToolStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<{ json: string; text: string; usage: { in: number; out: number }; stopReason: string | null; aborted: boolean }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "", json = "", text = "", stopReason: string | null = null, aborted = false;
  const usage = { in: 0, out: 0 };
  const handle = (data: string) => {
    let e: { type?: string; delta?: { type?: string; partial_json?: string; text?: string; stop_reason?: string }; usage?: { output_tokens?: number }; message?: { usage?: { input_tokens?: number } }; error?: { message?: string } };
    try { e = JSON.parse(data); } catch { return; }
    if (e.type === "message_start") usage.in = e.message?.usage?.input_tokens ?? 0;
    else if (e.type === "content_block_delta" && e.delta?.type === "input_json_delta") json += e.delta.partial_json ?? "";
    else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") text += e.delta.text ?? "";
    else if (e.type === "message_delta") { stopReason = e.delta?.stop_reason ?? stopReason; usage.out = e.usage?.output_tokens ?? usage.out; }
    else if (e.type === "error") throw new HttpError(502, `Proveïdor d'IA: ${e.error?.message ?? "error durant la resposta"}`);
  };
  try {
    for (;;) {
      if (signal?.aborted) { aborted = true; await reader.cancel().catch(() => undefined); break; }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (data) handle(data);
      }
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (signal?.aborted || (e as Error)?.name === "AbortError") aborted = true; else throw e;
  }
  return { json, text, usage, stopReason, aborted };
}

/** Extreu un objecte JSON d'una resposta de text (per si el model respon en text en lloc de cridar l'eina). */
export function jsonFromText(t: string): unknown | null {
  const s = t.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
  const i = s.indexOf("{");
  if (i < 0) return null;
  const j = s.lastIndexOf("}");
  return repairJson(j > i ? s.slice(i, j + 1) : s.slice(i));
}

/**
 * Crida l'API amb l'eina `tool` com a format de resposta. NO s'envia `tool_choice` ni `temperature`: els models
 * actuals (claude-sonnet-5-5) els rebutgen. Les instruccions obliguen a respondre amb l'eina i, si el model respon
 * en text, se n'extreu el JSON igualment.
 * `budgetMs`: temps màxim abans d'aturar i aprofitar el que s'ha rebut (Vercel talla la funció a maxDuration).
 * Cada error porta un identificador de diagnòstic (diag) que també queda al registre del servidor, sense dades sensibles.
 */
export async function callTool(opts: { system: string; content: Content[]; tool: { name: string; description: string; input_schema: unknown }; maxTokens: number; budgetMs: number; instruction: string }): Promise<ToolCallResult & { diag: string; mode: "tool" | "json" }> {
  const diag = randomUUID().slice(0, 8);
  const err = (status: number, msg: string, detail?: unknown) => { console.error(`[lector-ia ${diag}]`, status, msg.slice(0, 300), detail ?? ""); return new HttpError(status, `${msg} (diagnòstic ${diag})`); };
  if (!env.anthropicKey) throw err(409, "Falta la clau de la IA: configura ANTHROPIC_API_KEY a Vercel (Settings → Environment Variables) i torna a desplegar");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.budgetMs);
  const system = `${opts.system}\n\nFORMAT DE RESPOSTA OBLIGATORI: respon ÚNICAMENT cridant l'eina "${opts.tool.name}" una sola vegada. No escriguis cap text fora de l'eina.`;
  // Alternativa si el model no admet eines: el mateix esquema, com a JSON en text.
  const systemJson = `${opts.system}\n\nFORMAT DE RESPOSTA OBLIGATORI: respon ÚNICAMENT amb un objecte JSON vàlid (sense text abans ni després, sense \`\`\`) que compleixi aquest esquema JSON:\n${JSON.stringify(opts.tool.input_schema)}`;
  const send = (withTools: boolean) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: ctrl.signal,
    headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.anthropicModel, max_tokens: opts.maxTokens, stream: true, system: withTools ? system : systemJson,
      ...(withTools ? { tools: [opts.tool] } : {}),
      messages: [{ role: "user", content: [...opts.content, { type: "text", text: opts.instruction }] }],
    }),
  });
  try {
    let r: Response;
    let mode: "tool" | "json" = "tool";
    try {
      r = await send(true);
      if (r.status === 400) {
        const body = await r.clone().text();
        if (/tool/i.test(body) && /not supported|unsupported|deprecated|not allowed/i.test(body)) { console.warn(`[lector-ia ${diag}] el model no admet eines: es reintenta amb JSON`); mode = "json"; r = await send(false); }
      }
    } catch (e) {
      if (ctrl.signal.aborted) throw err(504, "La IA no ha començat a respondre a temps. Torna-ho a provar d'aquí a un moment");
      throw err(502, "No s'ha pogut connectar amb el proveïdor d'IA (xarxa o servei caigut)", (e as Error).message);
    }
    if (r.status === 429 || r.status === 529) throw err(503, "El servei d'IA està saturat o s'ha superat el límit d'ús. Torna-ho a provar d'aquí a un moment");
    if (!r.ok || !r.body) throw err(502, await aiFailure(r));
    const s = await readToolStream(r.body, ctrl.signal);
    const truncated = s.aborted || s.stopReason === "max_tokens";
    let input: unknown = null;
    if (s.json.trim()) { try { input = JSON.parse(s.json); } catch { input = repairJson(s.json); } }
    if (input == null && s.text.trim()) input = jsonFromText(s.text);
    if (input == null || typeof input !== "object") {
      throw err(422, truncated
        ? "La IA no ha pogut acabar la lectura a temps. Torna-ho a provar; si persisteix, puja el contracte i els annexos per separat"
        : "La IA ha respost sense cap dada estructurada llegible", { mode, stop: s.stopReason, textChars: s.text.length, jsonChars: s.json.length });
    }
    return { input, usage: s.usage, truncated, stopReason: s.stopReason, diag, mode };
  } finally { clearTimeout(timer); }
}
