/**
 * ENLLAÇOS D'ACCÉS (lògica pura).
 * L'enllaç per crear la contrasenya el genera el servidor (Supabase, sense enviar cap correu) i apunta a la pàgina
 * pròpia `/acces` del CRM. Així:
 *  - mai depèn de la «Site URL» de Supabase (no pot acabar a localhost);
 *  - el correu surt del compte corporatiu (Assessoria 3.0), en català, i no de noreply@supabase;
 *  - els antivirus de correu (Outlook / Microsoft Defender) que obren els enllaços automàticament no el gasten:
 *    l'accés només s'activa quan la persona prem el botó de la pàgina.
 */
/** invite = alta nova · recovery = crear/canviar contrasenya · email = enllaç d'accés sense contrasenya (plantilla de Supabase). */
export type AccessKind = "invite" | "recovery" | "email";
const CODE: Record<AccessKind, string> = { invite: "i", recovery: "r", email: "m" };

/** Només rutes internes (evita redireccions a altres webs). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  return next && /^\/[a-z0-9]/i.test(next) && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}

/** Adreça base de la plataforma: APP_URL si està definida; si no, la del navegador que fa la petició. */
export function appBase(appUrl: string | null | undefined, requestOrigin: string): string {
  return (appUrl || requestOrigin || "").trim().replace(/\/+$/, "");
}

export function accessUrl(base: string, tokenHash: string, kind: AccessKind, next = "/"): string {
  const q = new URLSearchParams({ t: tokenHash, k: CODE[kind], next: safeNext(next) });
  return `${base}/acces?${q.toString()}`;
}

export function parseAccessParams(search: string): { tokenHash: string; kind: AccessKind; next: string } | null {
  const q = new URLSearchParams(search);
  const tokenHash = q.get("t") ?? "";
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash)) return null;
  const k = q.get("k");
  return { tokenHash, kind: k === "i" ? "invite" : k === "m" ? "email" : "recovery", next: safeNext(q.get("next")) };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Correu en català, amb versió de text (ajuda que no el marquin com a correu brossa). */
export function accessEmail(o: { name?: string | null; url: string; portal: boolean; sender?: string | null }) {
  const hi = o.name ? `Hola, ${o.name.split(" ")[0]}:` : "Hola:";
  const what = o.portal ? "el portal de col·laboradors d'Assessoria 3.0" : "la plataforma d'Assessoria 3.0";
  const subject = o.portal ? "Accés al portal de col·laboradors d'Assessoria 3.0" : "Accés a la plataforma d'Assessoria 3.0";
  const sign = o.sender ? `${o.sender}\nAssessoria 3.0` : "L'equip d'Assessoria 3.0";
  const text = [
    hi, "",
    `T'hem donat accés a ${what}.`,
    "Obre aquest enllaç i prem «Activa l'accés» per triar la teva contrasenya:", "",
    o.url, "",
    "L'enllaç és personal i té una validesa limitada. Si ha caducat, demana'ns-en un de nou.",
    "Si no esperaves aquest correu, pots ignorar-lo.", "",
    sign,
  ].join("\n");
  const html = `<!doctype html><html lang="ca"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:bold;padding-bottom:16px">Assessoria 3.0</td></tr>
<tr><td style="font-size:15px;line-height:1.55">
<p style="margin:0 0 12px">${esc(hi)}</p>
<p style="margin:0 0 12px">T'hem donat accés a ${esc(what)}. Prem el botó i, a la pàgina que s'obrirà, prem «Activa l'accés» per triar la teva contrasenya.</p>
<p style="margin:24px 0"><a href="${esc(o.url)}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Crea la contrasenya</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#6b7280">Si el botó no funciona, copia aquesta adreça al navegador:<br><span style="word-break:break-all">${esc(o.url)}</span></p>
<p style="margin:0 0 12px;font-size:13px;color:#6b7280">L'enllaç és personal i té una validesa limitada. Si ha caducat, demana'ns-en un de nou. Si no esperaves aquest correu, pots ignorar-lo.</p>
<p style="margin:16px 0 0">${esc(sign).replace(/\n/g, "<br>")}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
