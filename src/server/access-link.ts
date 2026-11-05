import "server-only";
/**
 * ENLLAÇOS D'ACCÉS (servidor): genera l'enllaç per crear la contrasenya i l'envia des del correu corporatiu.
 * Supabase només genera el codi (generateLink no envia cap correu). Si el correu corporatiu no està configurat
 * o falla, es retorna l'enllaç perquè Direcció l'enviï des del seu propi correu.
 */
import { accessEmail, accessUrl, appBase, type AccessKind } from "@/core/access-link";
import { explainSmtpError } from "@/core/mail";
import { sendCorporateMail, smtpReady } from "./mailer";
import { adminClient, HttpError } from "./supabase";

export interface AccessLinkResult { userId: string | null; link: string; emailSent: boolean; emailError: string | null }

export async function issueAccessLink(o: {
  email: string; name?: string | null; kind: Exclude<AccessKind, "email">; next: string; origin: string; portal: boolean;
  sender?: { email?: string | null; name?: string | null } | null;
}): Promise<AccessLinkResult> {
  const sb = adminClient();
  const r = o.kind === "invite"
    ? await sb.auth.admin.generateLink({ type: "invite", email: o.email, options: { data: { name: o.name ?? undefined } } })
    : await sb.auth.admin.generateLink({ type: "recovery", email: o.email });
  if (r.error) throw new HttpError(400, /already/i.test(r.error.message) ? "Ja existeix un usuari amb aquest correu" : r.error.message);
  const hash = r.data.properties?.hashed_token;
  if (!hash) throw new HttpError(500, "Supabase no ha retornat l'enllaç d'accés");
  const link = accessUrl(appBase(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL, o.origin), hash, o.kind, o.next);
  let emailSent = false, emailError: string | null = null;
  if (!(await smtpReady())) emailError = "El correu corporatiu no està configurat (Configuració → Correu). Copia l'enllaç i envia'l tu des del teu correu.";
  else {
    try {
      const m = accessEmail({ name: o.name, url: link, portal: o.portal, sender: o.sender?.name });
      await sendCorporateMail({ to: o.email, subject: m.subject, text: m.text, html: m.html }, o.sender);
      emailSent = true;
    } catch (e) {
      emailError = `${explainSmtpError(e as never)} Copia l'enllaç i envia'l tu des del teu correu.`;
    }
  }
  return { userId: r.data.user?.id ?? null, link, emailSent, emailError };
}
