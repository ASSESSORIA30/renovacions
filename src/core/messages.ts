/**
 * Fase 8 · Missatges de la fitxa de client en català i castellà (textos oficials d'Assessoria 3.0) i utilitats
 * per preparar WhatsApp i correu. Res d'aquí envia res: només prepara el text i els enllaços.
 */
export type Lang = "ca" | "es";
export const REVIEW_URL = "https://g.page/r/CeQVI7cNNDvREBM/review";
export const DATA_URL = "https://www.fdigital.es/assessoria30/";

export const REVIEW_MESSAGE: Record<Lang, string> = {
  ca: `Hola! 😊

Des d’Assessoria 3.0 ens agradaria molt conèixer la teva opinió sobre el servei que t’hem ofert.

Si estàs satisfet/a amb la nostra feina, t’agrairíem molt que ens deixessis una ressenya a Google. La teva valoració ens ajuda a continuar millorant i a arribar a més clients.

⭐ Pots deixar la teva ressenya aquí:
${REVIEW_URL}

Moltes gràcies per la teva confiança i per dedicar-nos un minut! 🙌`,
  es: `¡Hola! 😊

Desde Assessoria 3.0 nos gustaría mucho conocer tu opinión sobre el servicio que te hemos ofrecido.

Si estás satisfecho/a con nuestro trabajo, te agradeceríamos mucho que nos dejaras una reseña en Google. Tu valoración nos ayuda a seguir mejorando y a llegar a más clientes.

⭐ Puedes dejar tu reseña aquí:
${REVIEW_URL}

¡Muchas gracias por tu confianza y por dedicarnos un minuto! 🙌`,
};

export const DATA_MESSAGE: Record<Lang, string> = {
  ca: `🔐 *IMPORTANT* – Tractament de Dades Personals

Si us plau, accedeix al següent enllaç i emplena el formulari.

Això correspon a l’autorització per al tractament de les teves dades personals, un pas fonamental per continuar amb el procés:

👉 ${DATA_URL}

És molt important per a nosaltres comptar amb el teu consentiment per garantir el compliment de la normativa de protecció de dades.`,
  es: `🔐 *IMPORTANTE* – Tratamiento de Datos Personales

Por favor, accede al siguiente enlace y completa el formulario.

Esto corresponde a la autorización para el tratamiento de tus datos personales, un paso fundamental para continuar con el proceso:

👉 ${DATA_URL}

Para nosotros es muy importante contar con tu consentimiento para garantizar el cumplimiento de la normativa de protección de datos.`,
};

export const SUBJECT: Record<"ressenya" | "proteccio_dades" | "proposta" | "documentacio" | "recordatori", Record<Lang, string>> = {
  ressenya: { ca: "La teva opinió sobre Assessoria 3.0", es: "Tu opinión sobre Assessoria 3.0" },
  proteccio_dades: { ca: "Autorització per al tractament de dades personals", es: "Autorización para el tratamiento de datos personales" },
  proposta: { ca: "La teva proposta d'Assessoria 3.0", es: "Tu propuesta de Assessoria 3.0" },
  documentacio: { ca: "Documentació pendent per al teu contracte", es: "Documentación pendiente para tu contrato" },
  recordatori: { ca: "Recordatori d'Assessoria 3.0", es: "Recordatorio de Assessoria 3.0" },
};
export const EMAIL_BODY: Record<"proposta" | "documentacio" | "recordatori", Record<Lang, (name: string) => string>> = {
  proposta: { ca: (n) => `Hola ${n},\n\nT'enviem la proposta que hem preparat per al teu subministrament. Si tens cap dubte, respon aquest correu o truca'ns.\n\nGràcies!`, es: (n) => `Hola ${n},\n\nTe enviamos la propuesta que hemos preparado para tu suministro. Si tienes cualquier duda, responde a este correo o llámanos.\n\n¡Gracias!` },
  documentacio: { ca: (n) => `Hola ${n},\n\nPer continuar amb el contracte necessitem la documentació següent:\n- \n\nPots respondre aquest correu adjuntant-la.\n\nGràcies!`, es: (n) => `Hola ${n},\n\nPara continuar con el contrato necesitamos la siguiente documentación:\n- \n\nPuedes responder a este correo adjuntándola.\n\n¡Gracias!` },
  recordatori: { ca: (n) => `Hola ${n},\n\nT'escrivim per recordar-te `, es: (n) => `Hola ${n},\n\nTe escribimos para recordarte ` },
};

/** Telèfon espanyol o internacional → dígits per a wa.me (sense «+»). Retorna null si no és vàlid. */
export function waDigits(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/[^\d+]/g, "");
  if (!d) return null;
  const n = d.startsWith("+") ? d.slice(1) : d.startsWith("00") ? d.slice(2) : /^[6789]\d{8}$/.test(d) ? `34${d}` : d;
  return /^[1-9]\d{7,14}$/.test(n) ? n : null;
}
/** Enllaç wa.me amb el missatge preemplenat. Obre la conversa amb el CLIENT; el compte emissor el tria el dispositiu. */
export const waLink = (phone: string, text: string) => `https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(text)}`;
export const mailtoLink = (to: string, subject: string, body: string) => `mailto:${to.trim().replace(/[^\w.@+-]/g, (c) => encodeURIComponent(c))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Respecte de les preferències de contacte del client (Fase 5). */
export function contactAllowed(pref: string | null | undefined, optOut: boolean | null | undefined, channel: "whatsapp" | "email", purpose: "comercial" | "servei") {
  if (pref === "cap") return { ok: false, reason: "El client ha demanat no ser contactat" };
  if (purpose === "comercial" && optOut) return { ok: false, reason: "El client s'ha donat de baixa de les comunicacions comercials" };
  if (pref && pref !== "qualsevol" && pref !== channel) return { ok: true, warning: `El client prefereix el contacte per ${pref}` };
  return { ok: true };
}

export const DATA_STATUS_LABEL: Record<string, string> = { pendent: "Pendent", sollicitada: "Sol·licitada", formulari_enviat: "Formulari enviat", completada: "Signada / completada", rebutjada: "Rebutjada", caducada: "Caducada" };
export const LEGAL_BASIS_LABEL: Record<string, string> = { consentiment: "Consentiment (art. 6.1.a RGPD)", execucio_contracte: "Execució d'un contracte (art. 6.1.b)", obligacio_legal: "Obligació legal (art. 6.1.c)", interes_legitim: "Interès legítim (art. 6.1.f)" };
