import "server-only";
import { env } from "./env";

export const SYSTEM = `Ets l'assistent comercial d'Assessoria 3.0, una assessoria energètica de Lleida (des del 2013).
Ajudes els comercials a renovar contractes de llum i gas.
Regles estrictes:
- Fes servir EXCLUSIVAMENT les dades del context JSON. Si falta una dada, digues-ho i suggereix com obtenir-la.
- No inventis MAI preus, percentatges d'estalvi, ofertes, descomptes ni condicions contractuals.
- Només esmenta estalvis si el context inclou un càlcul amb dades contrastades (camp "comparativa").
- Només pots citar ofertes que apareguin a "ofertasVerificadas".
- Respon al comercial en català, breu i accionable. Als missatges per al client, tracta'l de vostè i fes servir l'idioma que se t'indiqui.`;

export async function complete(user: string, maxTokens = 700): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.anthropicModel, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(await aiFailure(r));
  const j = (await r.json()) as { content: { type: string; text?: string }[] };
  return j.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

/**
 * Motiu llegible d'un error del proveïdor d'IA (Anthropic retorna {"error": {"type", "message"}}).
 * Abans només es mostrava el codi (p. ex. «400»), que no permetia saber què fallava.
 */
export async function aiFailure(r: Response): Promise<string> {
  let type = "", message = "";
  try { const j = (await r.json()) as { error?: { type?: string; message?: string } }; type = j.error?.type ?? ""; message = j.error?.message ?? ""; }
  catch { /* resposta sense JSON */ }
  console.error("[ia]", r.status, type, message.slice(0, 300));
  if (/credit balance/i.test(message)) return "El compte d'Anthropic no té saldo. Afegeix crèdit a console.anthropic.com → Billing i torna-ho a provar.";
  if (r.status === 401 || type === "authentication_error") return "La clau ANTHROPIC_API_KEY no és vàlida o s'ha revocat. Revisa-la a Vercel i torna a desplegar.";
  if (r.status === 403 || type === "permission_error") return "La clau ANTHROPIC_API_KEY no té permís per fer servir aquest model.";
  if (r.status === 404 || /model/i.test(message) && /not found|invalid/i.test(message)) return `El model configurat (${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5"}) no existeix o no està disponible. Revisa ANTHROPIC_MODEL a Vercel o esborra-la per fer servir el model per defecte.`;
  if (/max_tokens/i.test(message)) return `El model configurat (${process.env.ANTHROPIC_MODEL ?? "—"}) no admet respostes tan llargues. Fes servir un model actual (p. ex. claude-sonnet-5-5) a ANTHROPIC_MODEL.`;
  if (/pdf pages|maximum of \d+ pages|page limit/i.test(message)) return "El PDF té massa pàgines per a una sola lectura. Divideix-lo (contracte i annexos per separat) i torna-ho a provar.";
  if (r.status === 413 || /too large|request_too_large|exceeds/i.test(message)) return "El document és massa gran per enviar-lo a la IA. Redueix-ne la mida o divideix-lo.";
  return `Proveïdor d'IA: ${r.status}${message ? ` · ${message.slice(0, 200)}` : ""}`;
}
