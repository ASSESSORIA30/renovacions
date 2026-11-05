import "server-only";
import { aiFailure } from "./ai";
/**
 * COMPARATIVES (servidor).
 * - El servidor RECALCULA sempre el resultat amb el mateix motor a partir de les dades i de les còpies
 *   de les ofertes: el que es desa (i el que mostren la pantalla i el PDF) és aquest resultat versionat.
 * - La IA només rep resultats validats, sense dades personals, i no pot alterar cap xifra.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { ENGINE_VERSION, offerVersionSchema, priceSheetSchema, supplySchema } from "@/comparator/types";
import { buildSnapshot, type Snapshot } from "@/comparator/snapshot";
import { aiContext } from "@/comparator/ai-context";
import { env, integrations } from "./env";
import { sendCorporateMail, smtpReady } from "./mailer";
import { explainSmtpError } from "@/core/mail";
import { adminClient, HttpError, type requireUser } from "./supabase";
import { catalogVersionsByIds, markUsed, permanenceRule } from "./tariffs";
import { permanenceIssues } from "@/comparator/permanence";
import { selectableForNew } from "@/comparator/catalog";

type U = Awaited<ReturnType<typeof requireUser>>;

export const savePayload = z.object({
  id: z.string().uuid().optional(),
  mode: z.enum(["factura", "cups", "cups_preus", "manual", "massiva"]),
  contractId: z.string().max(200).nullable().optional(),
  /** Client i subministrament del CRM (Clients 360°), si la comparativa s'ha fet des de la fitxa del client */
  crmClientId: z.string().uuid().nullable().optional(),
  crmSupplyId: z.string().uuid().nullable().optional(),
  /** Oportunitat comercial (Fase 2) de la qual surt la comparativa */
  crmOpportunityId: z.string().uuid().nullable().optional(),
  cups: z.string().max(26).nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  client: z.object({ name: z.string().max(200).nullable(), taxId: z.string().max(20).nullable(), address: z.string().max(300).nullable(), email: z.string().max(200).nullable(), phone: z.string().max(40).nullable(), logo: z.string().max(400_000).nullable().optional() }).optional(),
  supply: supplySchema,
  current: priceSheetSchema.nullable(),
  currentLabel: z.string().max(200).nullable().optional(),
  currentRetailer: z.string().max(120).nullable().optional(),
  offers: z.array(offerVersionSchema).min(1).max(3),
  taxes: z.any().optional(),
  weights: z.object({ price: z.number(), stability: z.number(), permanence: z.number(), variability: z.number() }).optional(),
  observations: z.string().max(3000).nullable().optional(),
  dataNotes: z.array(z.string().max(300)).max(30).optional(),
  /** Ajustos puntuals d'aquesta comparativa (no modifiquen la tarifa del catàleg). */
  adjustments: z.record(z.string().max(100), z.object({
    discountsOff: z.array(z.union([z.number().int().min(0).max(50), z.literal("doc")])).max(50).optional(),
    sas: z.object({ enabled: z.boolean(), eurKwh: z.number().finite().min(0).max(1).nullable(), justification: z.string().trim().max(300) }).nullable().optional(),
    // combinació comercial (nivell d'energia + marge BOE) d'una tarifa amb matriu: els preus surten de la taula publicada
    commercial: z.object({ level: z.string().max(40), margin: z.string().max(40).nullable() }).nullable().optional(),
  })).nullable().optional(),
  market: z.object({ central: z.array(z.number().finite().min(0).max(2000).nullable()).max(6), lowPct: z.number().finite().min(-90).max(0), highPct: z.number().finite().min(0).max(300), source: z.string().max(200), note: z.string().max(500).nullable().optional() }).nullable().optional(),
  issue: z.boolean().optional(),
});
export type SavePayload = z.infer<typeof savePayload>;

export async function saveComparison(u: U, raw: unknown) {
  const parsed = savePayload.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `Dades no vàlides: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const p = parsed.data;
  // CATÀLEG COM A ÚNICA FONT: els preus es llegeixen del catàleg al servidor (mai del navegador)
  p.offers = await offersFromCatalog(u, p);
  for (const [k, a] of Object.entries(p.adjustments ?? {})) if (a.sas?.enabled && (a.sas.eurKwh == null || a.sas.justification.length < 3)) throw new HttpError(400, `Per afegir el SAS a ${k} cal indicar el valor (€/kWh) i justificar-lo`);
  const snapshot = buildSnapshot(p);
  // permanència obligatòria pendent: es pot desar com a esborrany, però no emetre la proposta definitiva
  if (p.issue) {
    const rule = await permanenceRule(u.sb as never);
    const pending = snapshot.offers.map((o) => ({ o, issues: permanenceIssues(o, rule) })).filter((x) => x.issues.length);
    if (pending.length) throw new HttpError(409, `No es pot emetre la proposta: ${pending.map((x) => `«${x.o.supplierName} · ${x.o.productName}»: ${x.issues.join("; ")}`).join(" · ")}. Revisa la tarifa al catàleg.`);
  }
  const row = {
    contract_id: p.contractId ?? null,
    cups: p.cups ?? null,
    client_name: p.client?.name ?? p.clientName ?? null,
    mode: p.mode,
    engine_version: ENGINE_VERSION,
    snapshot,
    status: p.issue ? "emesa" : "esborrany",
    issued_at: p.issue ? new Date().toISOString() : null,
    created_by_name: u.profile.name,
    // només s'envien si hi ha vincle (així funciona igual sense la migració 008)
    ...(p.crmClientId ? { crm_client_id: p.crmClientId, crm_supply_id: p.crmSupplyId ?? null } : {}),
    ...(p.crmOpportunityId ? { crm_opportunity_id: p.crmOpportunityId } : {}),
  };
  const r = p.id ? await u.sb.from("comparisons").update(row).eq("id", p.id).select("*").single() : await u.sb.from("comparisons").insert(row).select("*").single();
  if (r.error) throw new HttpError(r.error.message.includes("immutables") ? 409 : 400, r.error.message);
  // l'oportunitat queda vinculada a la seva comparativa (la primera, si no en tenia cap)
  if (p.crmOpportunityId) await u.sb.from("crm_opportunities").update({ comparison_id: r.data.id }).eq("id", p.crmOpportunityId).is("comparison_id", null);
  if (p.issue) {
    await markUsed(p.offers.map((o) => o.id));
    if (p.crmClientId) {
      const best = snapshot.result.ranked[0];
      await u.sb.from("crm_activities").insert({
        client_id: p.crmClientId, supply_id: p.crmSupplyId ?? null, type: "proposta", title: "Comparativa IA emesa",
        body: best ? `Recomanada: ${best.offer.supplierName} · ${best.offer.productName}${best.saving != null ? ` · estalvi ${best.saving.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })}/any` : ""}` : "Sense ofertes calculables",
        user_id: u.user.id, user_name: u.profile.name, meta: { comparisonId: r.data.id },
      });
    }
    if (p.contractId) {
      const best = snapshot.result.ranked[0];
      await u.sb.from("activities").insert({
        id: crypto.randomUUID(),
        contract_id: p.contractId,
        type: "pdf",
        by_name: u.profile.name,
        title: "Comparativa IA emesa",
        body: best ? `Recomanada: ${best.offer.supplierName} · ${best.offer.productName}${best.saving != null ? ` · estalvi ${best.saving.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })}/any` : ""}` : "Sense ofertes calculables",
        meta: { comparisonId: r.data.id },
      });
    }
  }
  return r.data;
}

/**
 * Resol les alternatives amb les dades del catàleg: per a cada identificador es fa servir la versió desada a
 * `tariff_versions` (preus, condicions, versió). Una alternativa nova ha de ser del catàleg i seleccionable (activa,
 * vigent i completa). Les que ja eren en aquesta comparativa es conserven tal com es van triar (historial).
 */
async function offersFromCatalog(u: U, p: SavePayload): Promise<SavePayload["offers"]> {
  const prev = p.id ? ((await u.sb.from("comparisons").select("snapshot").eq("id", p.id).maybeSingle()).data?.snapshot as Snapshot | null) : null;
  const prevById = new Map((prev?.baseOffers ?? prev?.offers ?? []).map((o) => [o.id, o]));
  const cat = await catalogVersionsByIds(u, p.offers.map((o) => o.id));
  const today = new Date().toISOString().slice(0, 10);
  return p.offers.map((o) => {
    const v = cat.get(o.id);
    if (prevById.has(o.id)) return (v ?? prevById.get(o.id)!) as SavePayload["offers"][number];
    if (!v) throw new HttpError(400, `«${o.supplierName} · ${o.productName}» no és una tarifa del catàleg. Les comparatives noves només poden fer servir el Catàleg de tarifes.`);
    const sel = selectableForNew(v, today);
    if (!sel.ok) throw new HttpError(409, `«${v.supplierName} · ${v.productName}» (v${v.version}) no es pot proposar: ${sel.reasons.join(" · ")}`);
    return v as SavePayload["offers"][number];
  });
}

export async function getComparison(u: U, id: string) {
  const r = await u.sb.from("comparisons").select("*").eq("id", id).maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) throw new HttpError(404, "Comparativa no trobada o sense accés");
  return r.data as { id: string; status: string; contract_id: string | null; snapshot: Snapshot; recommendation: Recommendation | null; client_name: string | null; created_by_name: string | null; created_at: string; issued_at: string | null };
}

export interface Recommendation {
  ai: { sections: Record<string, string>; model: string; at: string } | null;
  edited: { text: string; at: string; by: string } | null;
  history: { at: string; by: string; action: string; previous?: string | null }[];
}

const AI_RECO = `Ets l'analista d'Assessoria 3.0. Redactes la recomanació d'una comparativa energètica.
Regles estrictes: fes servir EXCLUSIVAMENT les xifres i condicions del JSON; no inventis preus, estalvis, percentatges, descomptes ni avantatges;
si una oferta no és calculable o no és elegible, digues-ho; si no hi ha cost actual, no parlis d'estalvi respecte del contracte vigent;
no prioritzis cap oferta per motius diferents dels del JSON; recomana la primera de "ordre" llevat que hi hagi un motiu explícit al JSON.
Si hi ha "fixVsIndexat": explica quina és més econòmica a cada escenari, quina té el preu més previsible (la fixa), quina està més exposada al mercat
(sensibilitat i rang de risc), la diferència econòmica i el punt d'equilibri; recorda que els escenaris són HIPÒTESIS, no previsions oficials;
no recomanis una indexada només perquè sigui més barata a l'escenari baixista; esmenta les condicions (permanència) que poden afectar la decisió.
Retorna NOMÉS JSON: {"principal":"","justificacio":"","riscos":"","avantatges":"","inconvenients":"","resum":"","argumentari":"","revisar":""}`;

export async function explain(u: U, id: string, lang: "ca" | "es") {
  if (!integrations().ai) throw new HttpError(400, "IA no configurada (ANTHROPIC_API_KEY)");
  const c = await getComparison(u, id);
  const ctx = aiContext(c.snapshot);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.anthropicModel, max_tokens: 1800, system: AI_RECO, messages: [{ role: "user", content: `Idioma de redacció: ${lang === "es" ? "castellà" : "català"}.\nJSON:\n${JSON.stringify(ctx)}` }] }),
  });
  if (!r.ok) throw new HttpError(502, await aiFailure(r));
  const j = (await r.json()) as { content: { type: string; text?: string }[] };
  const text = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = /\{[\s\S]*\}/.exec(text);
  const sections = z.record(z.string(), z.string().max(4000)).safeParse(m ? JSON.parse(m[0]) : null);
  if (!sections.success) throw new HttpError(502, "La IA no ha retornat una recomanació vàlida");
  const prev = (c.recommendation ?? { ai: null, edited: null, history: [] }) as Recommendation;
  const reco: Recommendation = { ...prev, ai: { sections: sections.data, model: env.anthropicModel, at: new Date().toISOString() }, history: [...prev.history, { at: new Date().toISOString(), by: u.profile.name, action: "IA generada" }] };
  await u.sb.from("comparisons").update({ recommendation: reco }).eq("id", id);
  return reco;
}

export async function editRecommendation(u: U, id: string, text: string) {
  const c = await getComparison(u, id);
  const prev = (c.recommendation ?? { ai: null, edited: null, history: [] }) as Recommendation;
  const reco: Recommendation = { ...prev, edited: { text: text.slice(0, 6000), at: new Date().toISOString(), by: u.profile.name }, history: [...prev.history, { at: new Date().toISOString(), by: u.profile.name, action: "Recomanació editada", previous: prev.edited?.text ?? null }] };
  const r = await u.sb.from("comparisons").update({ recommendation: reco }).eq("id", id);
  if (r.error) throw r.error;
  return reco;
}

export async function storePdf(u: U, id: string, kind: "resum" | "detallada", lang: "ca" | "es", base64: string) {
  const cmp = (await getComparison(u, id)) as Awaited<ReturnType<typeof getComparison>> & { crm_client_id?: string | null; crm_supply_id?: string | null };
  if (base64.length > 8_000_000) throw new HttpError(413, "PDF massa gran");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.subarray(0, 4).toString() !== "%PDF") throw new HttpError(400, "No és un PDF");
  const path = `${id}/${kind}-${lang}-${Date.now()}.pdf`;
  const sb = adminClient();
  const up = await sb.storage.from("proposals").upload(path, bytes, { contentType: "application/pdf" });
  if (up.error) throw up.error;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const doc = await u.sb.from("comparison_documents").insert({ comparison_id: id, kind, lang, storage_path: path, sha256 }).select("*").single();
  if (doc.error) throw doc.error;
  const signed = await sb.storage.from("proposals").createSignedUrl(path, 60 * 60 * 24 * 7);
  // Si la comparativa és d'un client del CRM, el PDF queda també a la seva fitxa (Documents → Proposta comercial)
  let crmDocumentId: string | null = null;
  if (cmp.crm_client_id) {
    const { attachComparisonPdf } = await import("./crm-docs");
    crmDocumentId = await attachComparisonPdf(u, { clientId: cmp.crm_client_id, supplyId: cmp.crm_supply_id ?? null, bytes, fileName: `Proposta-${(cmp.client_name ?? "client").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}-${kind}.pdf`, title: `Comparativa ${kind === "resum" ? "(resum executiu)" : "(detallada)"} · ${new Date().toLocaleDateString("ca-ES")}` });
  }
  return { document: doc.data, url: signed.data?.signedUrl ?? null, crmDocumentId };
}

export async function sendEmail(u: U, id: string, b: { to: string; subject: string; body: string; documentId: string; confirmed: boolean }) {
  if (!b.confirmed) throw new HttpError(400, "Cal confirmar l'enviament");
  if (!(await smtpReady())) throw new HttpError(400, "El correu corporatiu no està configurat (Configuració → Correu)");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.to)) throw new HttpError(400, "Correu de destinació no vàlid");
  const c = await getComparison(u, id);
  const doc = await u.sb.from("comparison_documents").select("*").eq("id", b.documentId).eq("comparison_id", id).single();
  if (doc.error) throw new HttpError(404, "Document no trobat");
  const dl = await adminClient().storage.from("proposals").download(doc.data.storage_path);
  if (dl.error || !dl.data) throw new HttpError(404, "No s'ha pogut recuperar el PDF");
  const fileName = `Proposta-${(c.client_name ?? "client").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.pdf`;
  try {
    const info = await sendCorporateMail({ to: b.to, subject: b.subject.slice(0, 300), text: b.body.slice(0, 20000), attachments: [{ filename: fileName, content: Buffer.from(await dl.data.arrayBuffer()), contentType: "application/pdf" }] }, u.profile);
    const accepted = (info.accepted?.length ?? 0) > 0;
    await u.sb.from("comparison_deliveries").insert({ comparison_id: id, channel: "email", recipient: b.to, subject: b.subject, status: accepted ? "enviat" : "error", message_id: info.messageId, document_id: b.documentId });
    if (accepted) await u.sb.from("comparisons").update({ status: "enviada" }).eq("id", id);
    // Oportunitat vinculada: enviament CONFIRMAT pel servidor de correu → historial i etapa «Proposta enviada»
    const oppId = (c as { crm_opportunity_id?: string | null }).crm_opportunity_id;
    if (accepted && oppId) {
      const o = (await u.sb.from("crm_opportunities").select("stage,version,client_id,lead_id").eq("id", oppId).maybeSingle()).data;
      if (o) {
        await u.sb.from("crm_activities").insert({ client_id: o.client_id, lead_id: o.client_id ? null : o.lead_id, opportunity_id: oppId, type: "email", title: `Proposta enviada per correu: ${b.subject}`.slice(0, 200), delivery: "enviat", user_id: u.user.id, user_name: u.profile.name, meta: { to: b.to, comparisonId: id, messageId: info.messageId } });
        if (["nou_lead", "contactat", "factura_sollicitada", "estudi"].includes(o.stage)) await u.sb.from("crm_opportunities").update({ stage: "proposta_enviada" }).eq("id", oppId).eq("version", o.version);
      }
    }
    if (c.contract_id) await u.sb.from("activities").insert({ id: crypto.randomUUID(), contract_id: c.contract_id, type: "email", by_name: u.profile.name, title: `Comparativa enviada: ${b.subject}`, body: b.body.slice(0, 2000), delivery: accepted ? "enviado" : "error", meta: { to: b.to, comparisonId: id, messageId: info.messageId } });
    return { accepted, messageId: info.messageId };
  } catch (e) {
    const why = explainSmtpError(e as Parameters<typeof explainSmtpError>[0]);
    await u.sb.from("comparison_deliveries").insert({ comparison_id: id, channel: "email", recipient: b.to, subject: b.subject, status: "error", error: why.slice(0, 300), document_id: b.documentId });
    throw new HttpError(502, `No s'ha enviat: ${why}`);
  }
}

export async function logWhatsapp(u: U, id: string, phone: string | null) {
  await getComparison(u, id);
  await u.sb.from("comparison_deliveries").insert({ comparison_id: id, channel: "whatsapp", recipient: phone, status: "preparat" });
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createShare(u: U, id: string, days: number) {
  await getComparison(u, id);
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + Math.min(30, Math.max(1, days)) * 86_400_000).toISOString();
  const r = await u.sb.from("comparison_shares").insert({ comparison_id: id, token_hash: hashToken(token), expires_at: expires }).select("id,expires_at").single();
  if (r.error) throw r.error;
  await u.sb.from("comparison_deliveries").insert({ comparison_id: id, channel: "enllac", status: "preparat", subject: `Enllaç privat fins al ${expires.slice(0, 10)}` });
  return { token, shareId: r.data.id, expiresAt: r.data.expires_at };
}

export async function revokeShare(u: U, shareId: string) {
  const r = await u.sb.from("comparison_shares").update({ revoked_at: new Date().toISOString() }).eq("id", shareId);
  if (r.error) throw r.error;
  return { ok: true };
}

/** Portal públic: valida el token (hash), la caducitat i la revocació. Retorna només dades de la proposta. */
export async function publicProposal(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const sb = adminClient();
  const { data: share } = await sb.from("comparison_shares").select("id,comparison_id,expires_at,revoked_at,views").eq("token_hash", hashToken(token)).maybeSingle();
  if (!share || share.revoked_at || new Date(share.expires_at) < new Date()) return null;
  const { data: c } = await sb.from("comparisons").select("id,client_name,snapshot,recommendation,issued_at,created_by_name").eq("id", share.comparison_id).single();
  if (!c) return null;
  await sb.from("comparison_shares").update({ views: (share.views ?? 0) + 1, last_view_at: new Date().toISOString() }).eq("id", share.id);
  await sb.from("comparison_share_events").insert({ share_id: share.id, kind: "vista" });
  return { shareId: share.id as string, expiresAt: share.expires_at as string, comparison: c as { id: string; client_name: string | null; snapshot: Snapshot; recommendation: Recommendation | null; issued_at: string | null; created_by_name: string | null } };
}

export async function publicEvent(token: string, kind: "interes" | "aclariment", payload: { offerId?: string; message?: string; contact?: string }) {
  const p = await publicProposal(token);
  if (!p) throw new HttpError(404, "Enllaç no vàlid o caducat");
  const sb = adminClient();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await sb.from("comparison_share_events").select("id", { count: "exact", head: true }).eq("share_id", p.shareId).neq("kind", "vista").gte("at", since);
  if ((count ?? 0) >= 10) throw new HttpError(429, "Massa peticions. Torna-ho a provar més tard.");
  await sb.from("comparison_share_events").insert({ share_id: p.shareId, kind, payload: { offerId: payload.offerId?.slice(0, 80), message: payload.message?.slice(0, 1500), contact: payload.contact?.slice(0, 200) } });
  return { ok: true };
}
