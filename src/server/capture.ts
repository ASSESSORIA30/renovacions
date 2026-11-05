import "server-only";
/**
 * CAPTACIÓ (servidor). Formulari públic → sol·licitud → lead de la Fase 2 → factura privada → lectura → comparativa preliminar.
 *
 *  · Res del públic arriba a la base de dades sense passar per aquí: validació, antispam, límits per IP (hash diari) i
 *    clau d'idempotència. Els formularis no poden llegir cap dada.
 *  · Cada pas és idempotent i reintentable: si falla la IA o la lectura, el lead i el document continuen desats.
 *  · Duplicats per CUPS, NIF, telèfon i correu: s'avisa, mai es fusiona automàticament.
 *  · L'atribució al col·laborador la decideix el servidor (enllaç vàlid o sessió del portal), mai el navegador.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CHANNEL_LABEL, CONSENT_TEXTS, CONSENT_VERSION, EXT, applyReview, checkUpload, matchDuplicates, normalizeEmail, normalizePhone, normalizeReading, pickAssignee, publicFormSchema,
  rateDecision, readingToComparison, relaxedFormSchema, resolveAttribution, resolveChannel, safeName, spamReasons,
  type AssignRule, type Channel, type DocMime, type DupRow, type ExistingAttribution, type ReadField,
} from "@/core/capture";
import { analyseSupply, PENDING_PRICE, type Analysis } from "@/core/intelligence";
import { captureEnv } from "./env";
import { adminClient, HttpError, type requireUser } from "./supabase";

type U = Awaited<ReturnType<typeof requireUser>>;
type SB = ReturnType<typeof adminClient>;
export const LEAD_BUCKET = "lead-documents";
const sha = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const nowIso = () => new Date().toISOString();
const STAFF = ["admin", "cap_administrativa", "administrativa"];
export const isStaffU = (u: U) => STAFF.includes(u.profile.role);
const isMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? ""));

export const ipHash = (ip: string, day = nowIso().slice(0, 10)) => sha(`${captureEnv().hashSalt}|${day}|${ip}`).slice(0, 32);
export const contactHash = (phone: string | null, email: string | null) => sha(`${phone ?? ""}|${email ?? ""}`).slice(0, 40);

/* ======================================================================= referències */

export async function resolveRef(sb: SB, code: string | null | undefined) {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(c)) return null;
  const { data } = await sb.from("cap_referral_links").select("id,code,channel,active,expires_at,partner_id,cap_partners(id,status,public_name,user_id)").eq("code", c).maybeSingle();
  const l = data as unknown as { id: string; code: string; channel: "recomanacio" | "qr" | "collaborador"; active: boolean; expires_at: string | null; partner_id: string; cap_partners: { id: string; status: string; public_name: string | null; user_id: string | null } | null } | null;
  if (!l || !l.active || (l.expires_at && l.expires_at < nowIso()) || l.cap_partners?.status !== "actiu") return null;
  return { code: l.code, channel: l.channel, partnerId: l.partner_id, publicName: l.cap_partners.public_name, partnerUserId: l.cap_partners.user_id };
}

/** Dades públiques per a la landing personalitzada: només el nom públic (si el col·laborador l'ha autoritzat). */
export async function landingRef(code: string | null | undefined) {
  try {
    const r = await resolveRef(adminClient(), code);
    return r ? { valid: true, publicName: r.publicName } : { valid: false, publicName: null };
  } catch { return { valid: false, publicName: null }; }
}

/* ======================================================================= mètriques de la landing */

const trackSchema = z.object({ event: z.enum(["visita", "formulari_iniciat", "formulari_enviat"]), session: z.string().regex(/^[a-f0-9-]{16,64}$/i), path: z.string().max(120).optional(), ref: z.string().max(16).optional(), utm: z.object({ source: z.string().max(120).nullish(), medium: z.string().max(120).nullish(), campaign: z.string().max(120).nullish() }).partial().optional() });
export async function track(raw: unknown) {
  const p = trackSchema.safeParse(raw);
  if (!p.success) return { ok: false };
  const t = p.data;
  await adminClient().from("cap_visits").upsert({ event: t.event, session_hash: sha(t.session).slice(0, 32), path: t.path ?? null, ref_code: t.ref?.toUpperCase() || null, utm_source: t.utm?.source ?? null, utm_medium: t.utm?.medium ?? null, utm_campaign: t.utm?.campaign ?? null }, { onConflict: "session_hash,event", ignoreDuplicates: true });
  return { ok: true };
}

/* ======================================================================= enviament */

export interface SubmitInput {
  fields: Record<string, unknown>;
  file: { bytes: Uint8Array; name: string } | null;
  ip: string;
  by?: U | null;                       // col·laborador o comercial (portal o CRM)
  forcedChannel?: Channel | null;
  consentText?: string | null;          // portal: declaració del col·laborador
  relaxed?: boolean;                     // canals externs: telèfon o correu (no tots dos obligatoris)
}
export interface SubmitResult { ok: boolean; submissionId?: string; status?: string; duplicate?: boolean; documentId?: string | null; error?: string; fieldErrors?: Record<string, string> }

export async function submit(inp: SubmitInput): Promise<SubmitResult> {
  const sb = adminClient();
  const parsed = (inp.relaxed ? relaxedFormSchema : publicFormSchema).safeParse(inp.fields);
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, error: "Revisa les dades del formulari", fieldErrors: fe };
  }
  const f = parsed.data;
  // 1) idempotència: el mateix enviament (reintent del navegador, doble clic) torna el mateix resultat
  const prev = await sb.from("cap_submissions").select("id,status,lead_id").eq("idempotency_key", f.idempotencyKey).maybeSingle();
  if (prev.error && isMissing(prev.error)) throw new HttpError(503, "La captació encara no està activada (falta la migració 013)");
  if (prev.data) return { ok: true, submissionId: prev.data.id, status: prev.data.status, duplicate: true };
  // 2) antispam i limitació de peticions (sense desar cap IP en clar)
  const spam = spamReasons(f);
  const iph = ipHash(inp.ip || "0.0.0.0");
  const ch = contactHash(f.phone || null, f.email || null);
  if (!inp.by) {
    const since10 = new Date(Date.now() - 10 * 60_000).toISOString(), sinceDay = new Date(Date.now() - 86_400_000).toISOString();
    const [a, b, c] = await Promise.all([
      sb.from("cap_submissions").select("id", { count: "exact", head: true }).eq("ip_hash", iph).gte("received_at", since10),
      sb.from("cap_submissions").select("id", { count: "exact", head: true }).eq("ip_hash", iph).gte("received_at", sinceDay),
      sb.from("cap_submissions").select("id", { count: "exact", head: true }).eq("contact_hash", ch).gte("received_at", sinceDay),
    ]);
    const rd = rateDecision({ ip10min: a.count ?? 0, ipDay: b.count ?? 0, contactDay: c.count ?? 0 });
    if (!rd.ok) throw new HttpError(429, rd.reason!);
  }
  // 3) fitxer: contingut real, mida i contingut actiu
  let mime: DocMime | null = null;
  if (inp.file) {
    const chk = checkUpload(inp.file.bytes, inp.file.name);
    if (!chk.ok) return { ok: false, error: chk.error, fieldErrors: { file: chk.error } };
    mime = chk.mime;
  }
  // 4) atribució i campanya (al servidor)
  const partnerFromSession = inp.by && inp.by.profile.role === "colaborador" ? ((await sb.from("cap_partners").select("id,status").eq("user_id", inp.by.user.id).maybeSingle()).data as { id: string; status: string } | null) : null;
  if (inp.by && inp.by.profile.role === "colaborador" && partnerFromSession?.status !== "actiu") throw new HttpError(403, "El teu perfil de col·laborador no està actiu");
  const ref = partnerFromSession ? null : await resolveRef(sb, f.ref);
  const channel = resolveChannel({ forced: inp.forcedChannel ?? null, linkChannel: ref?.channel ?? null, utm: f.utm ?? null, gclid: f.gclid, fbclid: f.fbclid, withInvoice: !!inp.file });
  let campaignId: string | null = null;
  if (f.utm?.campaign && (channel === "google_ads" || channel === "meta_ads")) {
    const c = await sb.from("cap_campaigns").select("id").eq("platform", channel).ilike("utm_campaign", f.utm.campaign).maybeSingle();
    campaignId = (c.data?.id as string | undefined) ?? null;
  }
  const status = spam.length ? "rebutjada" : "rebuda";
  const ins = await sb.from("cap_submissions").insert({
    idempotency_key: f.idempotencyKey, channel, status, customer_kind: f.customerKind, energy_type: f.energyType, ...(f.extraServices?.length ? { extra_services: [...new Set(f.extraServices)] } : {}), name: f.name, phone: f.phone || null, email: f.email || null, province: f.province || null,
    notes: f.notes || null, ref_code: ref?.code ?? (f.ref || null), partner_id: partnerFromSession?.id ?? ref?.partnerId ?? null, campaign_id: campaignId, utm: f.utm ?? null,
    click_ids: f.gclid || f.fbclid ? { gclid: f.gclid || null, fbclid: f.fbclid || null } : null, contact_hash: ch, ip_hash: inp.by ? null : iph, spam_reasons: spam, submitted_by: inp.by?.user.id ?? null,
  }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") { const again = await sb.from("cap_submissions").select("id,status").eq("idempotency_key", f.idempotencyKey).single(); return { ok: true, submissionId: again.data?.id, status: again.data?.status, duplicate: true }; }
    throw new HttpError(500, "No s'ha pogut registrar la sol·licitud");
  }
  const subId = ins.data.id as string;
  if (spam.length) return { ok: true, submissionId: subId, status }; // resposta neutra: no es revela la detecció
  // 5) consentiments (servei obligatori; comercial i WhatsApp opcionals, per separat)
  const consentRows = [
    { kind: "privacitat_servei", granted: true, text: inp.consentText ?? CONSENT_TEXTS.privacitat_servei },
    { kind: "comercial", granted: !!f.acceptCommercial, text: CONSENT_TEXTS.comercial },
    { kind: "whatsapp", granted: !!f.acceptWhatsapp, text: CONSENT_TEXTS.whatsapp },
  ].map((c) => ({ submission_id: subId, kind: c.kind, granted: c.granted, text_version: CONSENT_VERSION, text_sha256: sha(c.text), channel }));
  await sb.from("cap_consents").insert(consentRows);
  // 6) factura a Storage privat
  let documentId: string | null = null;
  if (inp.file && mime) {
    const path = `${subId}/${randomUUID()}.${EXT[mime]}`;
    const up = await sb.storage.from(LEAD_BUCKET).upload(path, inp.file.bytes, { contentType: mime, upsert: false });
    if (up.error) {
      await sb.from("cap_submissions").update({ status: "error", error: "No s'ha pogut desar la factura", attempts: 1 }).eq("id", subId);
      throw new HttpError(502, "No s'ha pogut desar la factura. Torna-ho a provar.");
    }
    const d = await sb.from("cap_lead_documents").insert({ submission_id: subId, kind: "factura", storage_path: path, original_name: safeName(inp.file.name), mime, size_bytes: inp.file.bytes.byteLength, sha256: sha(inp.file.bytes), status: "rebut", uploaded_by: inp.by?.user.id ?? null }).select("id").single();
    documentId = (d.data?.id as string | undefined) ?? null;
  }
  // 7) lead, duplicats, atribució, assignació, tasca i avís (si falla, es reintenta amb el cron)
  const r = await processSubmission(subId).catch((e) => ({ status: "error", error: (e as Error).message }));
  return { ok: true, submissionId: subId, status: r.status, documentId };
}

/* ======================================================================= processament (idempotent) */

async function dupRows(sb: SB, c: { phone: string | null; email: string | null; tax_id?: string | null; cups?: string | null }, excludeLead?: string): Promise<DupRow[]> {
  const ors = (cols: [string, string | null | undefined][]) => cols.filter(([, v]) => v).map(([k, v]) => `${k}.eq.${String(v).replace(/[,()]/g, "")}`).join(",");
  const rows: DupRow[] = [];
  const lo = ors([["phone", c.phone], ["email", c.email], ["tax_id", c.tax_id], ["cups", c.cups]]);
  if (lo) for (const l of ((await sb.from("crm_leads").select("id,name,phone,email,tax_id,cups,converted_client_id").or(lo).limit(20)).data ?? []) as { id: string; name: string; phone: string | null; email: string | null; tax_id: string | null; cups: string | null; converted_client_id: string | null }[]) if (l.id !== excludeLead) rows.push({ kind: "lead", id: l.id, name: l.name, phone: l.phone, email: l.email, tax_id: l.tax_id, cups: l.cups, client_id: l.converted_client_id });
  const co = ors([["phone", c.phone], ["email", c.email], ["tax_id", c.tax_id]]);
  if (co) for (const k of ((await sb.from("crm_clients").select("id,name,phone,email,tax_id").or(co).is("archived_at", null).limit(20)).data ?? []) as { id: string; name: string; phone: string | null; email: string | null; tax_id: string | null }[]) rows.push({ kind: "client", ...k });
  if (c.cups) for (const s of ((await sb.from("crm_supplies").select("id,cups,client_id").eq("cups20", c.cups.toUpperCase().slice(0, 20)).is("archived_at", null).limit(5)).data ?? []) as { id: string; cups: string; client_id: string }[]) rows.push({ kind: "subministrament", id: s.id, cups: s.cups, client_id: s.client_id });
  return rows;
}

export async function processSubmission(id: string): Promise<{ status: string; leadId?: string }> {
  const sb = adminClient();
  const { data: s } = await sb.from("cap_submissions").select("*").eq("id", id).maybeSingle();
  if (!s) throw new Error("Sol·licitud no trobada");
  if (s.lead_id) return { status: s.status, leadId: s.lead_id };
  if (s.status === "rebutjada") return { status: s.status };
  await sb.from("cap_submissions").update({ status: "processant", attempts: Math.min(10, (s.attempts ?? 0) + 1) }).eq("id", id);
  try {
    // reenviament de la mateixa persona en 24 h (mateix contacte i, si n'hi ha, mateixa factura) → no es crea un altre lead
    const doc = (await sb.from("cap_lead_documents").select("id,sha256").eq("submission_id", id).maybeSingle()).data as { id: string; sha256: string } | null;
    const recent = (await sb.from("cap_submissions").select("id,lead_id").eq("contact_hash", s.contact_hash).eq("status", "lead_creat").gte("received_at", new Date(Date.now() - 86_400_000).toISOString()).neq("id", id).order("received_at", { ascending: false }).limit(1)).data?.[0] as { id: string; lead_id: string } | undefined;
    if (recent?.lead_id) {
      const prevDoc = (await sb.from("cap_lead_documents").select("sha256").eq("submission_id", recent.id).maybeSingle()).data as { sha256: string } | null;
      if (!doc || (prevDoc && prevDoc.sha256 === doc.sha256)) {
        if (doc) await sb.from("cap_lead_documents").update({ lead_id: recent.lead_id }).eq("id", doc.id);
        await sb.from("cap_consents").update({ lead_id: recent.lead_id }).eq("submission_id", id);
        await sb.from("crm_activities").insert({ lead_id: recent.lead_id, type: "nota", title: "S'ha rebut de nou la mateixa sol·licitud (duplicat, no s'ha creat cap lead nou)", user_name: "Captació" });
        await sb.from("cap_submissions").update({ status: "duplicat", lead_id: recent.lead_id, processed_at: nowIso(), error: null }).eq("id", id);
        return { status: "duplicat", leadId: recent.lead_id };
      }
    }
    const dups = matchDuplicates({ phone: s.phone, email: s.email }, await dupRows(sb, { phone: s.phone, email: s.email }));
    const partner = s.partner_id ? ((await sb.from("cap_partners").select("id,user_id,name").eq("id", s.partner_id).maybeSingle()).data as { id: string; user_id: string | null; name: string } | null) : null;
    const service = s.energy_type === "gas" ? "gas" : s.customer_kind === "empresa" ? "llum_empresa" : "llum_residencial";
    const lead = await sb.from("crm_leads").insert({
      kind: s.customer_kind === "empresa" ? "empresa" : "particular", name: s.name, phone: s.phone, email: s.email, province: s.province, origin: CHANNEL_LABEL[s.channel as Channel], services: [service, ...(((s as { extra_services?: string[] | null }).extra_services) ?? [])],
      notes: s.notes, status: "nou", capture_channel: s.channel, capture_campaign_id: s.campaign_id, capture_submission_id: id, utm: s.utm, energy_type: s.energy_type,
      duplicate_status: dups.length ? "possible_duplicat" : "unic", duplicate_refs: dups, created_by: s.submitted_by ?? null,
    }).select("id").single();
    if (lead.error) throw lead.error;
    const leadId = lead.data.id as string;
    await sb.from("cap_submissions").update({ lead_id: leadId }).eq("id", id);
    await sb.from("cap_consents").update({ lead_id: leadId }).eq("submission_id", id);
    if (doc) await sb.from("cap_lead_documents").update({ lead_id: leadId }).eq("id", doc.id);
    // atribució (si hi ha col·laborador): la persona ja aportada per un altre col·laborador queda en disputa
    if (partner) {
      const leadIds = [leadId, ...dups.filter((d) => d.kind === "lead").map((d) => d.id)];
      const ex = ((await sb.from("cap_attributions").select("partner_id,status,created_at").in("lead_id", leadIds)).data ?? []) as ExistingAttribution[];
      const decision = resolveAttribution(ex, partner.id, new Date());
      if (decision === "vigent" || decision === "en_disputa") {
        await sb.from("cap_attributions").insert({ lead_id: leadId, partner_id: partner.id, ref_code: s.ref_code, source: s.channel === "collaborador" ? "portal" : s.channel === "qr" ? "qr" : "enllac", status: decision, reason: decision === "en_disputa" ? "La mateixa persona ja l'havia aportat un altre col·laborador: decideix Direcció" : null });
      }
    }
    // assignació automàtica
    const owner = await autoAssign(sb, leadId);
    // tasca de primer contacte i avís (regla cap_nou_lead)
    const rule = (await sb.from("crm_automation_rules").select("enabled,params").eq("key", "cap_nou_lead").maybeSingle()).data as { enabled: boolean; params: { due_hours?: number } } | null;
    if (owner && rule?.enabled !== false) {
      const due = new Date(Date.now() + (rule?.params?.due_hours ?? 4) * 3600_000).toISOString();
      await sb.from("crm_tasks").upsert({ rule_key: `cap:lead:${leadId}`, lead_id: leadId, title: `Primer contacte: ${s.name}`.slice(0, 200), notes: `Lead captat per ${CHANNEL_LABEL[s.channel as Channel]}${doc ? " amb factura" : ""}.${dups.length ? " Possible duplicat: revisa-ho abans de crear el client." : ""}`, due_at: due, assigned_to: owner, kind: "trucada", source: "automatica", status: "pendent", created_by: null }, { onConflict: "rule_key", ignoreDuplicates: true });
      await sb.from("crm_notifications").upsert({ user_id: owner, kind: "lead", title: `Nou lead: ${s.name}`.slice(0, 200), body: `${CHANNEL_LABEL[s.channel as Channel]}${doc ? " · amb factura" : ""}${partner ? ` · col·laborador ${partner.name}` : ""}`, link: { view: "captacio-lead", params: { id: leadId } }, rule_key: `cap:nou:${leadId}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
    }
    await sb.from("crm_activities").insert({ lead_id: leadId, type: "canvi", title: `Lead captat · ${CHANNEL_LABEL[s.channel as Channel]}${doc ? " (amb factura)" : ""}`, user_name: "Captació" });
    await sb.from("cap_conversion_events").upsert([{ lead_id: leadId, kind: "lead", channel: s.channel, campaign_id: s.campaign_id, partner_id: s.partner_id }, ...(dups.some((d) => d.strength === "fort") ? [] : [{ lead_id: leadId, kind: "lead_valid", channel: s.channel, campaign_id: s.campaign_id, partner_id: s.partner_id }])], { onConflict: "lead_id,kind", ignoreDuplicates: true });
    await sb.from("cap_submissions").update({ status: "lead_creat", processed_at: nowIso(), error: null }).eq("id", id);
    return { status: "lead_creat", leadId };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await sb.from("cap_submissions").update({ status: "error", error: msg.slice(0, 300) }).eq("id", id);
    console.error("[captació] processament:", msg.slice(0, 160));
    throw e;
  }
}

/** Assigna el lead amb les regles actives (o el deixa pendent). Registra l'historial. */
export async function autoAssign(sb: SB, leadId: string): Promise<string | null> {
  const { data: l } = await sb.from("crm_leads").select("id,owner_id,province,city,energy_type,kind,capture_channel,capture_partner_id").eq("id", leadId).single();
  if (!l) return null;
  if (l.owner_id) return l.owner_id as string;
  const [rules, users, open, last] = await Promise.all([
    sb.from("cap_assignment_rules").select("*").eq("active", true),
    sb.from("profiles").select("id,role").in("role", ["admin", "comercial", "cap_administrativa", "administrativa"]),
    sb.from("crm_leads").select("owner_id").in("status", ["nou", "contactat", "qualificat"]).not("owner_id", "is", null).limit(5000),
    sb.from("cap_assignments").select("rule_id,user_id").eq("method", "regla").order("created_at", { ascending: false }).limit(200),
  ]);
  const workload: Record<string, number> = {};
  for (const r of (open.data ?? []) as { owner_id: string }[]) workload[r.owner_id] = (workload[r.owner_id] ?? 0) + 1;
  const lastByRule: Record<string, string | null> = {};
  for (const a of (last.data ?? []) as { rule_id: string | null; user_id: string | null }[]) if (a.rule_id && !(a.rule_id in lastByRule)) lastByRule[a.rule_id] = a.user_id;
  const pick = pickAssignee((rules.data ?? []) as AssignRule[], { province: l.province, city: l.city, energy: l.energy_type, customerKind: l.kind, channel: l.capture_channel, partnerId: l.capture_partner_id, annualKwh: null }, workload, lastByRule, new Set(((users.data ?? []) as { id: string }[]).map((u) => u.id)));
  if (pick.userId) {
    const up = await sb.from("crm_leads").update({ owner_id: pick.userId }).eq("id", leadId).is("owner_id", null).select("id");
    if (!up.data?.length) return ((await sb.from("crm_leads").select("owner_id").eq("id", leadId).single()).data?.owner_id as string | null) ?? null; // assignat en paral·lel: no es duplica
  }
  await sb.from("cap_assignments").insert({ lead_id: leadId, user_id: pick.userId, rule_id: pick.ruleId, method: pick.method, reason: pick.reason });
  return pick.userId;
}

/* ======================================================================= lectura de la factura */

export async function readDocument(docId: string): Promise<{ status: string }> {
  const sb = adminClient();
  const { data: d } = await sb.from("cap_lead_documents").select("*").eq("id", docId).maybeSingle();
  if (!d || d.kind !== "factura") return { status: "omesa" };
  const cur = (await sb.from("cap_invoice_readings").select("id,status,attempts").eq("document_id", docId).maybeSingle()).data as { id: string; status: string; attempts: number } | null;
  if (cur && ["llegida", "per_revisar", "revisada"].includes(cur.status)) return { status: cur.status };
  const attempts = (cur?.attempts ?? 0) + 1;
  const base = { document_id: docId, lead_id: d.lead_id, status: "processant", attempts: Math.min(10, attempts), updated_at: nowIso() };
  const row = cur ? await sb.from("cap_invoice_readings").update(base).eq("id", cur.id).select("id").single() : await sb.from("cap_invoice_readings").insert(base).select("id").single();
  const readingId = row.data?.id as string;
  await sb.from("cap_lead_documents").update({ status: "processant" }).eq("id", docId);
  try {
    const dl = await sb.storage.from(LEAD_BUCKET).download(d.storage_path);
    if (dl.error || !dl.data) throw new Error("No s'ha pogut obrir el fitxer");
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const { readInvoiceBytes } = await import("./invoices");
    const r = await readInvoiceBytes(bytes, d.mime);
    const { fields, warnings } = normalizeReading(r.data);
    const out = await finishReading(sb, readingId, d.lead_id, fields, [...r.warnings, ...warnings], r.method, r.data);
    await sb.from("cap_lead_documents").update({ status: "llegit" }).eq("id", docId);
    return { status: out.status };
  } catch (e) {
    const msg = ((e as Error).message ?? "error").slice(0, 300);
    await sb.from("cap_invoice_readings").update({ status: "error", error: msg, updated_at: nowIso() }).eq("id", readingId);
    await sb.from("cap_lead_documents").update({ status: "error" }).eq("id", docId);
    console.error("[captació] lectura de factura:", msg.slice(0, 160));
    return { status: "error" };
  }
}

/** Desa la lectura, actualitza el lead (CUPS/NIF i duplicats), prepara la comparativa preliminar i avisa. */
async function finishReading(sb: SB, readingId: string, leadId: string | null, fields: ReadField[], warnings: string[], method: string, raw: unknown, reviewer?: U) {
  const cmp = readingToComparison(fields);
  const pendingKeys = fields.filter((f) => f.status === "per_revisar").length;
  let preliminary: Record<string, unknown> | null = null;
  let comparisonId: string | null = null;
  if (cmp.ok && captureEnv().autoProposal) {
    const { catalogOffers } = await import("./intelligence");
    const offers = await catalogOffers(sb);
    const a: Analysis = analyseSupply({ supply: cmp.supply, current: cmp.current, currentRetailer: cmp.retailer, currentSource: cmp.current ? { label: "Factura aportada pel client", date: nowIso().slice(0, 10) } : null, offers, today: nowIso().slice(0, 10) });
    a.hypotheses = [...cmp.hypotheses, ...a.hypotheses];
    preliminary = { ok: a.ok, reason: a.reason, asOf: a.asOf, current: a.current, alternatives: a.alternatives, hypotheses: a.hypotheses, missing: a.missing, evaluated: a.evaluated, doubtful: cmp.doubtful, engineVersion: a.engineVersion };
    if (a.ok) {
      const { buildSnapshot } = await import("@/comparator/snapshot");
      const snap = buildSnapshot({ mode: "factura", cups: cmp.cups, supply: cmp.supply!, current: cmp.current, currentLabel: cmp.current ? "Factura aportada pel client" : null, currentRetailer: cmp.retailer, offers: offers.filter((o) => a.alternatives.some((x) => x.offerId === o.id)), dataNotes: ["Comparativa preliminar generada automàticament a partir de la factura captada. Pendent de revisió.", ...cmp.hypotheses] });
      const lead = leadId ? (await sb.from("crm_leads").select("name").eq("id", leadId).single()).data : null;
      const prev = (await sb.from("cap_invoice_readings").select("comparison_id").eq("id", readingId).single()).data?.comparison_id as string | null;
      if (!prev) {
        const c = await sb.from("comparisons").insert({ cups: cmp.cups, client_name: lead?.name ?? null, mode: "factura", engine_version: snap.engineVersion, snapshot: snap, status: "esborrany", created_by: reviewer?.user.id ?? null, created_by_name: reviewer?.profile.name ?? "Captació" }).select("id").single();
        comparisonId = (c.data?.id as string | undefined) ?? null;
      } else {
        comparisonId = prev;
        await sb.from("comparisons").update({ snapshot: snap, cups: cmp.cups }).eq("id", prev).eq("status", "esborrany");
      }
    }
  }
  const status = reviewer ? "revisada" : pendingKeys || !cmp.ok ? "per_revisar" : "llegida";
  await sb.from("cap_invoice_readings").update({ status, method, fields, raw: raw ?? undefined, warnings, missing: cmp.missing, sufficient: cmp.ok, preliminary, comparison_id: comparisonId ?? undefined, error: null, updated_at: nowIso(), ...(reviewer ? { reviewed_by: reviewer.user.id, reviewed_at: nowIso() } : {}) }).eq("id", readingId);
  if (leadId) {
    // CUPS i NIF al lead (si encara no en té) i nova comprovació de duplicats amb dades fortes
    const get = (k: string) => fields.find((f) => f.key === k)?.value as string | null;
    const cups = get("cups"), tax = get("taxId");
    const l = (await sb.from("crm_leads").select("id,phone,email,cups,tax_id,owner_id,name,duplicate_refs,duplicate_status").eq("id", leadId).single()).data as { id: string; phone: string | null; email: string | null; cups: string | null; tax_id: string | null; owner_id: string | null; name: string; duplicate_refs: unknown[]; duplicate_status: string };
    const patch: Record<string, unknown> = {};
    if (cups && !l.cups) patch.cups = String(cups).toUpperCase();
    if (tax && !l.tax_id) patch.tax_id = String(tax).toUpperCase();
    const dups = matchDuplicates({ phone: l.phone, email: l.email, tax_id: (patch.tax_id as string) ?? l.tax_id, cups: (patch.cups as string) ?? l.cups }, await dupRows(sb, { phone: l.phone, email: l.email, tax_id: (patch.tax_id as string) ?? l.tax_id, cups: (patch.cups as string) ?? l.cups }, leadId));
    if (dups.length) { patch.duplicate_refs = dups; if (l.duplicate_status === "unic") patch.duplicate_status = "possible_duplicat"; }
    if (Object.keys(patch).length) await sb.from("crm_leads").update(patch).eq("id", leadId);
    const flags = ((await sb.from("crm_automation_rules").select("key,enabled").in("key", ["cap_factura_processada", "cap_dades_incompletes"])).data ?? []) as { key: string; enabled: boolean }[];
    const ruleOn = (k: string) => flags.find((x) => x.key === k)?.enabled !== false;
    if (!reviewer && l.owner_id && ruleOn("cap_factura_processada")) {
      await sb.from("crm_notifications").upsert({ user_id: l.owner_id, kind: "lead", title: `Factura llegida: ${l.name}`.slice(0, 200), body: status === "per_revisar" ? `Hi ha ${pendingKeys} dades per revisar${cmp.missing.length ? ` i en falten: ${cmp.missing.join(", ")}` : ""}.` : "Dades llegides: la comparativa preliminar està preparada.", link: { view: "captacio-lead", params: { id: leadId } }, rule_key: `cap:factura:${readingId}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
    }
    if (!reviewer && l.owner_id && status === "per_revisar" && ruleOn("cap_dades_incompletes")) {
      await sb.from("crm_tasks").upsert({ rule_key: `cap:revisio:${readingId}`, lead_id: leadId, title: `Revisar les dades de la factura: ${l.name}`.slice(0, 200), notes: "Abans d'utilitzar-les per a una oferta, confirma les dades dubtoses o pendents.", due_at: new Date(Date.now() + 86_400_000).toISOString(), assigned_to: l.owner_id, kind: "seguiment", source: "automatica", status: "pendent", created_by: null }, { onConflict: "rule_key", ignoreDuplicates: true });
    }
  }
  return { status, comparisonId };
}

/* ======================================================================= revisió humana i proposta preliminar */

const reviewSchema = z.record(z.string().regex(/^[a-zA-Z]+(\.P[1-6])?$/), z.union([z.string().max(300), z.number().finite(), z.null()]));
export async function reviewReading(u: U, readingId: string, raw: unknown) {
  if (u.profile.role === "colaborador") throw new HttpError(403, "Només l'equip comercial revisa les lectures");
  const patch = reviewSchema.parse(raw);
  const { data: r } = await u.sb.from("cap_invoice_readings").select("id,lead_id,fields,method,raw").eq("id", readingId).maybeSingle();
  if (!r) throw new HttpError(404, "Lectura no trobada o sense permís");
  const fields = applyReview(r.fields as ReadField[], patch);
  const out = await finishReading(adminClient(), readingId, r.lead_id, fields, [], r.method ?? "manual", r.raw, u);
  await adminClient().from("cap_audit").insert({ entity: "cap_invoice_readings", entity_id: readingId, action: "revisada", detail: { camps: Object.keys(patch) }, user_id: u.user.id });
  return out;
}

/** PDF preliminar en ESBORRANY (no s'envia). Exigeix que les dades dubtoses usades estiguin revisades. */
export async function preliminaryProposal(u: U, readingId: string) {
  if (u.profile.role === "colaborador") throw new HttpError(403, "No tens permís per preparar propostes");
  const { data: r } = await u.sb.from("cap_invoice_readings").select("id,lead_id,document_id,fields,preliminary,status").eq("id", readingId).maybeSingle();
  if (!r) throw new HttpError(404, "Lectura no trobada o sense permís");
  const p = r.preliminary as (Analysis & { doubtful: string[] }) | null;
  if (!p?.ok || !p.alternatives?.length) throw new HttpError(400, `No hi ha prou dades per a una comparativa: ${((r.preliminary as { reason?: string } | null)?.reason) ?? "revisa la lectura de la factura"}`);
  if (r.status !== "revisada" && p.doubtful?.length) throw new HttpError(409, `Abans de generar l'oferta revisa aquestes dades dubtoses: ${p.doubtful.join(", ")}.`);
  const today = nowIso().slice(0, 10);
  const expired = p.alternatives.filter((a) => a.validTo && a.validTo < today);
  if (expired.length) throw new HttpError(409, "Alguna tarifa ha caducat des de la lectura: torna a calcular la comparativa.");
  const lead = (await u.sb.from("crm_leads").select("name").eq("id", r.lead_id).single()).data;
  const fields = r.fields as ReadField[];
  const g = (k: string) => fields.find((f) => f.key === k)?.value ?? null;
  const { buildProposalPdf } = await import("@/core/proposal-pdf");
  const { proposalValidUntil } = await import("@/core/intelligence");
  const reference = `PRE-${today.replace(/-/g, "")}-${readingId.slice(0, 6).toUpperCase()}`;
  const validUntil = proposalValidUntil(p, today);
  const gas = g("energyType") === "gas";
  const bytes = buildProposalPdf({
    draft: true, reference, client: { name: lead?.name ?? "Sol·licitant" },
    supply: { cups: (g("cups") as string) ?? null, address: (g("address") as string) ?? null, accessTariff: (g("accessTariff") as string) ?? null, annualKwh: readingToComparison(fields).supply?.kwhTotal ?? null, powerKw: gas ? null : [1, 2, 3, 4, 5, 6].map((i) => (g(`kw.P${i}`) as number | null) ?? null), energyType: gas ? "gas" : "luz" },
    currentRetailer: (g("retailer") as string) ?? null,
    currentPrices: p.current.known ? { energy: [1, 2, 3, 4, 5, 6].map((i) => (g(`energyPrice.P${i}`) as number | null) ?? null), power: gas ? null : [1, 2, 3, 4, 5, 6].map((i) => (g(`powerPrice.P${i}`) as number | null) ?? null), powerUnit: "eur_kw_dia", source: "Factura aportada pel client", date: today } : null,
    analysis: { ...p, sasScenarios: p.sasScenarios ?? [], oneOff: p.oneOff ?? [], excluded: p.excluded ?? [], hypotheses: [...p.hypotheses, "Proposta PRELIMINAR basada en una sola factura: cal validar el consum anual i les condicions abans de contractar."] },
    validUntil, contact: { name: u.profile.name, email: u.profile.email, phone: null }, generatedAt: new Date(),
  });
  const sb = adminClient();
  const path = `${r.lead_id}/preliminar-${randomUUID()}.pdf`;
  const up = await sb.storage.from(LEAD_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) throw new HttpError(502, "No s'ha pogut desar el PDF");
  const doc = await sb.from("cap_lead_documents").insert({ lead_id: r.lead_id, kind: "proposta_preliminar", storage_path: path, original_name: `${reference}-esborrany.pdf`, mime: "application/pdf", size_bytes: bytes.byteLength, sha256: sha(bytes), status: "llegit", uploaded_by: u.user.id }).select("id").single();
  await sb.from("crm_activities").insert({ lead_id: r.lead_id, type: "proposta", title: `Proposta preliminar ${reference} preparada (esborrany, no enviada)`, user_id: u.user.id, user_name: u.profile.name });
  await sb.from("cap_audit").insert({ entity: "cap_lead_documents", entity_id: doc.data?.id ?? null, action: "proposta_preliminar", detail: { readingId, reference }, user_id: u.user.id });
  return { documentId: doc.data?.id as string, reference, validUntil };
}

/** URL signada (2 minuts) d'un document de lead, només si la RLS permet veure'l. */
export async function leadDocumentUrl(u: U, docId: string) {
  const { data: d } = await u.sb.from("cap_lead_documents").select("storage_path,original_name").eq("id", docId).maybeSingle();
  if (!d) throw new HttpError(404, "Document no trobat o sense permís");
  const s = await adminClient().storage.from(LEAD_BUCKET).createSignedUrl(d.storage_path, 120, { download: d.original_name });
  if (s.error) throw new HttpError(502, "No s'ha pogut obrir el document");
  return { url: s.data.signedUrl };
}

/* ======================================================================= conversió a client (Fase 2 → Fase 1) */

/** En convertir el lead: còpia de les factures a la fitxa del client i vincle de la comparativa. No es duplica res. */
export async function onLeadConverted(leadId: string, clientId: string) {
  const sb = adminClient();
  const docs = ((await sb.from("cap_lead_documents").select("*").eq("lead_id", leadId).eq("kind", "factura").is("client_document_id", null)).data ?? []) as { id: string; storage_path: string; original_name: string; mime: string; size_bytes: number; sha256: string; uploaded_by: string | null }[];
  const lead = (await sb.from("crm_leads").select("energy_type,name").eq("id", leadId).single()).data;
  const { DOCS_BUCKET } = await import("./crm-docs");
  for (const d of docs) {
    const dl = await sb.storage.from(LEAD_BUCKET).download(d.storage_path);
    if (dl.error || !dl.data) continue;
    const id = randomUUID();
    const path = `${clientId}/${id}/v1-${randomUUID()}.${d.mime === "application/pdf" ? "pdf" : d.mime.split("/")[1]}`;
    const up = await sb.storage.from(DOCS_BUCKET).upload(path, new Uint8Array(await dl.data.arrayBuffer()), { contentType: d.mime, upsert: false });
    if (up.error) continue;
    const meta = { original_name: d.original_name, mime: d.mime, size_bytes: d.size_bytes, sha256: d.sha256, storage_path: path };
    const ins = await sb.from("crm_documents").insert({ id, client_id: clientId, category: lead?.energy_type === "gas" ? "factura_gas" : "factura_llum", title: `Factura aportada (captació)`, ...meta, version: 1, uploaded_by: d.uploaded_by, uploaded_by_name: "Captació" }).select("id");
    if (ins.error) { await sb.storage.from(DOCS_BUCKET).remove([path]); continue; }
    await sb.from("crm_document_versions").insert({ document_id: id, version: 1, ...meta, uploaded_by: d.uploaded_by, uploaded_by_name: "Captació" });
    await sb.from("cap_lead_documents").update({ client_document_id: id }).eq("id", d.id);
  }
  const readings = ((await sb.from("cap_invoice_readings").select("comparison_id").eq("lead_id", leadId).not("comparison_id", "is", null)).data ?? []) as { comparison_id: string }[];
  if (readings.length) await sb.from("comparisons").update({ crm_client_id: clientId }).in("id", readings.map((r) => r.comparison_id)).is("crm_client_id", null);
  return { documents: docs.length };
}

/* ======================================================================= reintents i retenció (cron) */

export async function processPendingCapture() {
  const sb = adminClient();
  const rule = (await sb.from("crm_automation_rules").select("enabled,params").eq("key", "cap_reprocessa").maybeSingle());
  if (rule.error && isMissing(rule.error)) return { skipped: "Falta la migració 013" };
  const max = Number((rule.data?.params as { max_attempts?: number } | undefined)?.max_attempts ?? 3);
  if (rule.data && !rule.data.enabled) return { skipped: "Reintents desactivats" };
  const old = new Date(Date.now() - 2 * 60_000).toISOString();
  const subs = ((await sb.from("cap_submissions").select("id").in("status", ["rebuda", "error", "processant"]).lt("received_at", old).lt("attempts", max).limit(50)).data ?? []) as { id: string }[];
  let ok = 0, ko = 0;
  for (const s of subs) { try { await processSubmission(s.id); ok++; } catch { ko++; } }
  const docs = ((await sb.from("cap_lead_documents").select("id,status,cap_invoice_readings(status,attempts)").eq("kind", "factura").in("status", ["rebut", "error", "processant"]).lt("created_at", old).limit(30)).data ?? []) as unknown as { id: string; cap_invoice_readings: { attempts: number }[] | { attempts: number } | null }[];
  let read = 0;
  for (const d of docs) {
    const r = Array.isArray(d.cap_invoice_readings) ? d.cap_invoice_readings[0] : d.cap_invoice_readings;
    if ((r?.attempts ?? 0) >= max) continue;
    await readDocument(d.id); read++;
  }
  const anon = await sb.rpc("cap_anonymize_expired");
  return { submissions: { ok, errors: ko }, readings: read, anonymized: (anon.data as number | null) ?? 0 };
}

/* ======================================================================= consentiments */

export async function withdrawConsent(u: U, consentId: string) {
  if (u.profile.role === "colaborador") throw new HttpError(403, "No tens permís");
  const { data: c } = await u.sb.from("cap_consents").select("id,lead_id,kind,withdrawn_at").eq("id", consentId).maybeSingle();
  if (!c) throw new HttpError(404, "Consentiment no trobat o sense permís");
  if (c.withdrawn_at) return { ok: true };
  await adminClient().from("cap_consents").update({ withdrawn_at: nowIso(), withdrawn_by: u.user.id }).eq("id", consentId);
  await adminClient().from("cap_audit").insert({ entity: "cap_consents", entity_id: consentId, action: "retirat", detail: { kind: c.kind, lead_id: c.lead_id }, user_id: u.user.id });
  return { ok: true };
}

export const PENDING = PENDING_PRICE;
export const normalizers = { normalizePhone, normalizeEmail };
