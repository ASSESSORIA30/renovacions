import { explainSmtpError } from "@/core/mail";
import { sendCorporateMail, smtpReady } from "@/server/mailer";
import { HttpError, handler } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";

/** Envia un correu real amb el compte corporatiu. Retorna «enviat» només si el servidor SMTP l'ha acceptat. */
export const POST = handler(async (req) => {
  const { sb, profile } = await requireInternal();
  if (!(await smtpReady())) throw new HttpError(400, "El correu corporatiu no està configurat (Configuració → Correu)");
  const b = (await req.json()) as { to: string; subject: string; body: string; contractId: string; attachment?: { fileName: string; base64: string } };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.to)) throw new HttpError(400, "Correu de destinació no vàlid");
  // RLS: l'usuari ha de poder veure el contracte
  const { data: c } = await sb.from("contracts").select("id").eq("id", b.contractId).maybeSingle();
  if (!c) throw new HttpError(403, "Sense accés a aquest contracte");
  if (b.attachment && b.attachment.base64.length > 8_000_000) throw new HttpError(400, "L'adjunt és massa gran");
  try {
    const info = await sendCorporateMail(
      {
        to: b.to,
        subject: b.subject.slice(0, 300),
        text: b.body,
        attachments: b.attachment ? [{ filename: b.attachment.fileName, content: Buffer.from(b.attachment.base64, "base64"), contentType: "application/pdf" }] : [],
      },
      profile,
    );
    return { id: info.messageId, accepted: (info.accepted?.length ?? 0) > 0 };
  } catch (e) {
    throw new HttpError(502, `No s'ha enviat: ${explainSmtpError(e as Parameters<typeof explainSmtpError>[0])}`);
  }
});
