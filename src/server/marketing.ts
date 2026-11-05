import "server-only";
/**
 * CAPTACIÓ I MÀRQUETING (servidor): panell, campanyes i costos, integracions (Google Ads, Meta Lead Ads, WhatsApp),
 * fitxa de captació del lead, assignació manual i automatitzacions.
 *
 *  · Cap dada de campanya s'inventa: costos només de l'API (si hi ha credencials) o registrats a mà per Direcció.
 *  · No es creen ni es modifiquen campanyes ni pressupostos a les plataformes.
 *  · No s'envien dades personals a plataformes publicitàries (les conversions es registren internament).
 *  · Webhooks amb signatura HMAC verificada (X-Hub-Signature-256) i idempotents.
 *  · WhatsApp: «acceptat» quan l'API respon; «lliurat» i «llegit» només quan arriba el webhook d'estat.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CHANNEL_LABEL, CHANNELS, WA_STATUS, funnelKpis, normalizePhone, waWindowOpen, type Channel } from "@/core/capture";
import { captureEnv, env, integrations } from "./env";
import { adminClient, HttpError, type requireUser } from "./supabase";

type U = Awaited<ReturnType<typeof requireUser>>;
type SB = ReturnType<typeof adminClient>;
const STAFF = ["admin", "cap_administrativa", "administrativa"];
const staffOnly = (u: U) => { if (!STAFF.includes(u.profile.role)) throw new HttpError(403, "Només per a l'equip d'administració"); };
const nowIso = () => new Date().toISOString();
const n = (v: unknown) => Number(v ?? 0);

/* ======================================================================= panell */

export const dashFilters = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  channel: z.string().max(30).optional(), campaign: z.string().uuid().optional(), owner: z.string().uuid().optional(), product: z.string().max(30).optional(),
});

export async function captureDashboard(u: U, raw: Record<string, string>) {
  staffOnly(u);
  const f = dashFilters.parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const to = f.to ?? nowIso().slice(0, 10);
  const from = f.from ?? new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);
  const end = `${to}T23:59:59.999Z`, start = `${from}T00:00:00Z`;
  const sb = u.sb;
  let lq = sb.from("crm_leads").select("id,name,status,owner_id,capture_channel,capture_campaign_id,capture_partner_id,converted_client_id,services,duplicate_status,created_at,energy_type").not("capture_channel", "is", null).gte("created_at", start).lte("created_at", end).limit(10000);
  if (f.channel) lq = lq.eq("capture_channel", f.channel);
  if (f.campaign) lq = lq.eq("capture_campaign_id", f.campaign);
  if (f.owner) lq = lq.eq("owner_id", f.owner);
  if (f.product) lq = lq.contains("services", [f.product]);
  let sq = sb.from("cap_submissions").select("id,channel,status,received_at,campaign_id,lead_id").gte("received_at", start).lte("received_at", end).limit(10000);
  if (f.channel) sq = sq.eq("channel", f.channel);
  if (f.campaign) sq = sq.eq("campaign_id", f.campaign);
  const [leadsR, subsR, visitsR, campsR, costsR] = await Promise.all([
    lq, sq,
    sb.from("cap_visits").select("event,utm_campaign,ref_code").gte("created_at", start).lte("created_at", end).limit(50000),
    sb.from("cap_campaigns").select("*").order("created_at", { ascending: false }),
    sb.from("cap_campaign_costs").select("campaign_id,day,cost_eur,clicks,impressions,source").gte("day", from).lte("day", to).limit(20000),
  ]);
  if (leadsR.error && /capture_channel|does not exist|schema cache/i.test(leadsR.error.message)) return { migrated: false };
  type L = { id: string; name: string; status: string; owner_id: string | null; capture_channel: Channel; capture_campaign_id: string | null; capture_partner_id: string | null; converted_client_id: string | null; services: string[]; duplicate_status: string; created_at: string; energy_type: string | null };
  const leads = (leadsR.data ?? []) as L[];
  const subs = ((subsR.data ?? []) as { id: string; channel: string; status: string; received_at: string; campaign_id: string | null; lead_id: string | null }[]).filter((s) => !f.owner || leads.some((l) => l.id === s.lead_id));
  const leadIds = leads.map((l) => l.id);
  const clientIds = [...new Set(leads.map((l) => l.converted_client_id).filter((x): x is string => !!x))];
  const chunk = async <T>(ids: string[], fn: (part: string[]) => PromiseLike<{ data: unknown }>) => { const out: T[] = []; for (let i = 0; i < ids.length; i += 300) out.push(...(((await fn(ids.slice(i, i + 300))).data ?? []) as T[])); return out; };
  const [docs, opps, contracts] = await Promise.all([
    chunk<{ lead_id: string }>(leadIds, (p) => sb.from("cap_lead_documents").select("lead_id").eq("kind", "factura").in("lead_id", p)),
    chunk<{ id: string; lead_id: string | null; client_id: string | null; stage: string; proposal_sent_at: string | null; mwh: number | null }>(leadIds, (p) => sb.from("crm_opportunities").select("id,lead_id,client_id,stage,proposal_sent_at,mwh").in("lead_id", p)),
    chunk<{ id: string; client_id: string; status: string; created_at: string }>(clientIds, (p) => sb.from("crm_contracts").select("id,client_id,status,created_at").in("client_id", p)),
  ]);
  const clientOpps = clientIds.length ? await chunk<{ id: string; lead_id: string | null; client_id: string | null; stage: string; proposal_sent_at: string | null; mwh: number | null }>(clientIds, (p) => sb.from("crm_opportunities").select("id,lead_id,client_id,stage,proposal_sent_at,mwh").in("client_id", p)) : [];
  const allOpps = [...new Map([...opps, ...clientOpps].map((o) => [o.id, o])).values()];
  const leadByClient = new Map(leads.filter((l) => l.converted_client_id).map((l) => [l.converted_client_id!, l]));
  const activeContracts = contracts.filter((k) => ["actiu", "renovacio_pendent"].includes(k.status) && leadByClient.get(k.client_id) && k.created_at >= leadByClient.get(k.client_id)!.created_at);
  const contractIds = activeContracts.map((k) => k.id);
  const [calcs, ledger] = contractIds.length ? await Promise.all([
    chunk<{ contract_id: string; amount: string | null; status: string }>(contractIds, (p) => sb.from("fin_calculations").select("contract_id,amount,status").eq("layer", "proveidor").eq("is_current", true).in("contract_id", p)),
    chunk<{ contract_id: string; amount: string; kind: string }>(contractIds, (p) => sb.from("fin_ledger").select("contract_id,amount,kind").eq("layer", "proveidor").in("kind", ["confirmacio", "cobrament"]).in("contract_id", p)),
  ]) : [[], []];
  const visits = (visitsR.data ?? []) as { event: string; utm_campaign: string | null }[];
  const camps = (campsR.data ?? []) as { id: string; platform: string; name: string; utm_campaign: string | null; status: string; external_id: string | null }[];
  const costs = ((costsR.data ?? []) as { campaign_id: string; cost_eur: string; source: string; day: string }[]).filter((c) => (!f.campaign || c.campaign_id === f.campaign) && (!f.channel || camps.find((x) => x.id === c.campaign_id)?.platform === f.channel));
  const valid = leads.filter((l) => l.duplicate_status !== "duplicat_confirmat");
  const won = allOpps.filter((o) => o.stage === "guanyat");
  const commissionsEstimated = calcs.length ? calcs.filter((c) => c.status === "calculat").reduce((a, c) => a + n(c.amount), 0) : null;
  const confirmedRows = ledger.filter((l) => l.kind === "cobrament");
  const commissionsConfirmed = confirmedRows.length ? confirmedRows.reduce((a, l) => a + n(l.amount), 0) : null;
  const cost = costs.length ? Math.round(costs.reduce((a, c) => a + n(c.cost_eur), 0) * 100) / 100 : null;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const costDays = new Set(costs.map((c) => `${c.campaign_id}|${c.day}`)).size;
  const adCamps = camps.filter((c) => c.status !== "finalitzada" && (!f.campaign || c.id === f.campaign) && (!f.channel || c.platform === f.channel));
  const costComplete = !!costs.length && costDays >= adCamps.length * days;
  const kpis = funnelKpis({
    visits: f.channel && !["web", "formulari", "factura", "google_ads", "meta_ads", "qr", "recomanacio"].includes(f.channel) ? null : visits.filter((v) => v.event === "visita").length,
    started: visits.filter((v) => v.event === "formulari_iniciat").length, submitted: subs.filter((s) => s.status !== "rebutjada").length, invoices: docs.length,
    validLeads: valid.length, opportunities: allOpps.length, proposalsSent: allOpps.filter((o) => o.proposal_sent_at).length, contractsActivated: activeContracts.length,
    mwhWon: won.length ? Math.round(won.reduce((a, o) => a + n(o.mwh), 0) * 1000) / 1000 : null, commissionsEstimated, commissionsConfirmed, cost, costComplete,
  });
  // per canal i per campanya
  const byChannel = CHANNELS.map((ch) => {
    const L = leads.filter((l) => l.capture_channel === ch);
    if (!L.length && !subs.some((s) => s.channel === ch)) return null;
    const cl = new Set(L.map((l) => l.converted_client_id).filter(Boolean));
    const ks = activeContracts.filter((k) => cl.has(k.client_id));
    const chCost = ch === "google_ads" || ch === "meta_ads" ? costs.filter((c) => camps.find((x) => x.id === c.campaign_id)?.platform === ch).reduce((a, c) => a + n(c.cost_eur), 0) : null;
    const est = calcs.filter((c) => ks.some((k) => k.id === c.contract_id) && c.status === "calculat").reduce((a, c) => a + n(c.amount), 0);
    return { channel: ch, label: CHANNEL_LABEL[ch], submissions: subs.filter((s) => s.channel === ch && s.status !== "rebutjada").length, leads: L.length, valid: L.filter((l) => l.duplicate_status !== "duplicat_confirmat").length, opportunities: allOpps.filter((o) => L.some((l) => l.id === o.lead_id) || (o.client_id && cl.has(o.client_id))).length, contracts: ks.length, commissionsEstimated: ks.length ? Math.round(est * 100) / 100 : null, cost: chCost ? Math.round(chCost * 100) / 100 : ch === "google_ads" || ch === "meta_ads" ? null : 0, costStatus: ch === "google_ads" || ch === "meta_ads" ? (chCost ? "conegut" : "no_disponible") : "sense_cost_directe" };
  }).filter(Boolean);
  const byCampaign = camps.map((c) => {
    const L = leads.filter((l) => l.capture_campaign_id === c.id);
    const cc = costs.filter((x) => x.campaign_id === c.id);
    const cst = cc.length ? Math.round(cc.reduce((a, x) => a + n(x.cost_eur), 0) * 100) / 100 : null;
    const cl = new Set(L.map((l) => l.converted_client_id).filter(Boolean));
    const contractsN = activeContracts.filter((k) => cl.has(k.client_id)).length;
    return { id: c.id, name: c.name, platform: c.platform, status: c.status, utm_campaign: c.utm_campaign, visits: visits.filter((v) => v.event === "visita" && c.utm_campaign && v.utm_campaign?.toLowerCase() === c.utm_campaign.toLowerCase()).length, leads: L.length, contracts: contractsN, cost: cst, costSource: cc.some((x) => x.source === "api") ? "api" : cc.length ? "manual" : null, cpl: cst != null && L.length ? Math.round((cst / L.length) * 100) / 100 : null, cpa: cst != null && contractsN ? Math.round((cst / contractsN) * 100) / 100 : null };
  });
  // sèrie diària
  const series: { day: string; enviats: number; leads: number; factures: number }[] = [];
  for (let i = 0; i < Math.min(days, 92); i++) {
    const d = new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day: d, enviats: subs.filter((s) => s.received_at.startsWith(d) && s.status !== "rebutjada").length, leads: leads.filter((l) => l.created_at.startsWith(d)).length, factures: 0 });
  }
  const partnersR = await sb.from("cap_partners").select("id,name,company,kind,status");
  const byPartner = ((partnersR.data ?? []) as { id: string; name: string; company: string | null; status: string }[]).map((p) => {
    const L = leads.filter((l) => l.capture_partner_id === p.id);
    const cl = new Set(L.map((l) => l.converted_client_id).filter(Boolean));
    return { id: p.id, name: p.company || p.name, status: p.status, leads: L.length, clients: cl.size, contracts: activeContracts.filter((k) => cl.has(k.client_id)).length };
  }).filter((p) => p.leads > 0).sort((a, b) => b.leads - a.leads).slice(0, 15);
  const recent = ((await sb.from("cap_submissions").select("id,channel,status,name,received_at,lead_id,spam_reasons,error,cap_lead_documents(id,status,cap_invoice_readings(status,sufficient))").gte("received_at", start).lte("received_at", end).order("received_at", { ascending: false }).limit(40)).data ?? []);
  const owners = ((await sb.from("profiles").select("id,name,role").in("role", ["admin", "comercial", "cap_administrativa", "administrativa"])).data ?? []) as { id: string; name: string }[];
  const unassigned = leads.filter((l) => !l.owner_id && l.status === "nou").length;
  return { migrated: true, range: { from, to }, kpis, byChannel, byCampaign, byPartner, series, recent, campaigns: camps.map((c) => ({ id: c.id, name: c.name, platform: c.platform })), owners, unassigned, integrations: integrationStatus(), canEdit: u.profile.role === "admin" };
}

export function integrationStatus() {
  const c = captureEnv();
  const ga = c.googleAds;
  return {
    landing: { ok: true, label: "Landing i formulari", note: "Actius" },
    invoiceAi: { ok: !!env.anthropicKey && process.env.INVOICE_AI_ENABLED === "true", label: "Lectura de factures amb IA", note: !!env.anthropicKey && process.env.INVOICE_AI_ENABLED === "true" ? "Activa" : "Sense IA: lectura de text i revisió manual (cal INVOICE_AI_ENABLED=true i ANTHROPIC_API_KEY)" },
    googleAds: { ok: !!(ga.developerToken && ga.customerId && ga.clientId && ga.clientSecret && ga.refreshToken), label: "Google Ads (costos)", note: ga.developerToken ? "Credencials definides (sincronització no verificada en aquest entorn)" : "Pendent de credencials. Les UTM i els gclid ja es registren." },
    metaLeadAds: { ok: !!(c.metaAppSecret && c.metaVerifyToken), label: "Meta Lead Ads (webhook)", note: c.metaAppSecret && c.metaVerifyToken ? (c.metaPageToken ? "Webhook i lectura de leads configurats" : "Webhook configurat; falta META_PAGE_ACCESS_TOKEN per llegir les dades del lead") : "Pendent de credencials (META_APP_SECRET i META_WEBHOOK_VERIFY_TOKEN)" },
    whatsapp: { ok: integrations().whatsappCloud && !!c.metaAppSecret, label: "WhatsApp Business", note: integrations().whatsappCloud ? (c.metaAppSecret ? "Enviament i webhook configurats" : "Enviament configurat; falta META_APP_SECRET per verificar el webhook d'estats") : "Pendent de credencials (WHATSAPP_TOKEN i WHATSAPP_PHONE_NUMBER_ID)" },
  };
}

/* ======================================================================= campanyes i costos */

const campaignSchema = z.object({ id: z.string().uuid().optional(), platform: z.enum(["google_ads", "meta_ads", "altres"]), name: z.string().trim().min(1).max(200), external_id: z.string().trim().max(64).nullable().optional(), utm_source: z.string().trim().max(120).nullable().optional(), utm_campaign: z.string().trim().max(120).nullable().optional(), status: z.enum(["activa", "pausada", "finalitzada"]).default("activa"), product: z.string().max(40).nullable().optional(), notes: z.string().max(1000).nullable().optional() });
/** Registre intern de campanyes (no crea ni modifica res a Google ni a Meta). */
export async function saveCampaign(u: U, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció registra campanyes");
  const { id, ...c } = campaignSchema.parse(raw);
  const r = id ? await u.sb.from("cap_campaigns").update({ ...c, updated_at: nowIso() }).eq("id", id).select("id") : await u.sb.from("cap_campaigns").insert({ ...c, created_by: u.user.id }).select("id");
  if (r.error) throw new HttpError(400, r.error.code === "23505" ? "Ja hi ha una campanya amb aquest identificador o UTM" : "No s'ha pogut desar la campanya");
  return { id: r.data?.[0]?.id };
}
const costRow = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cost_eur: z.coerce.number().min(0).max(1_000_000), clicks: z.coerce.number().int().min(0).optional().nullable(), impressions: z.coerce.number().int().min(0).optional().nullable() });
/** Costos registrats a mà a partir de l'informe de la plataforma (font «manual»). */
export async function importCosts(u: U, campaignId: string, rows: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció registra costos");
  const list = z.array(costRow).min(1).max(400).parse(rows);
  const { error } = await u.sb.from("cap_campaign_costs").upsert(list.map((r) => ({ campaign_id: campaignId, ...r, source: "manual", imported_by: u.user.id })), { onConflict: "campaign_id,day,source" });
  if (error) throw new HttpError(400, "No s'han pogut desar els costos");
  return { imported: list.length };
}

/**
 * Sincronització de costos amb l'API de Google Ads (lectura). Sense credencials: no fa res i ho indica.
 * IMPORTANT: no s'ha pogut verificar contra un compte real en aquest entorn.
 */
export async function syncGoogleAdsCosts(days = 30) {
  const g = captureEnv().googleAds;
  if (!(g.developerToken && g.customerId && g.clientId && g.clientSecret && g.refreshToken)) return { status: "pendent_credencials" as const, imported: 0 };
  const tok = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, refresh_token: g.refreshToken, grant_type: "refresh_token" }) });
  if (!tok.ok) return { status: "error" as const, imported: 0, error: `OAuth ${tok.status}` };
  const access = ((await tok.json()) as { access_token: string }).access_token;
  const query = `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date DURING LAST_${days === 7 ? "7" : "30"}_DAYS`;
  const r = await fetch(`https://googleads.googleapis.com/v17/customers/${g.customerId}/googleAds:searchStream`, { method: "POST", headers: { authorization: `Bearer ${access}`, "developer-token": g.developerToken, ...(g.loginCustomerId ? { "login-customer-id": g.loginCustomerId } : {}), "content-type": "application/json" }, body: JSON.stringify({ query }) });
  if (!r.ok) return { status: "error" as const, imported: 0, error: `Google Ads ${r.status}` };
  const batches = (await r.json()) as { results?: { campaign: { id: string; name: string }; segments: { date: string }; metrics: { costMicros?: string; clicks?: string; impressions?: string } }[] }[];
  const sb = adminClient();
  let imported = 0;
  for (const row of batches.flatMap((b) => b.results ?? [])) {
    const camp = await sb.from("cap_campaigns").upsert({ platform: "google_ads", external_id: row.campaign.id, name: row.campaign.name }, { onConflict: "platform,external_id", ignoreDuplicates: false }).select("id").single();
    if (!camp.data) continue;
    await sb.from("cap_campaign_costs").upsert({ campaign_id: camp.data.id, day: row.segments.date, cost_eur: Number(row.metrics.costMicros ?? 0) / 1e6, clicks: Number(row.metrics.clicks ?? 0), impressions: Number(row.metrics.impressions ?? 0), source: "api", imported_by: null }, { onConflict: "campaign_id,day,source" });
    imported++;
  }
  return { status: "ok" as const, imported };
}

/* ======================================================================= webhooks (Meta) */

/** Verificació de la signatura X-Hub-Signature-256 (HMAC SHA-256 del cos amb el secret de l'app). */
export function verifyMetaSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const got = header.slice(7);
  if (got.length !== expected.length || !/^[a-f0-9]+$/i.test(got)) return false;
  return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}
export function verifyChallenge(q: URLSearchParams): string | null {
  const t = captureEnv().metaVerifyToken;
  if (!t || q.get("hub.mode") !== "subscribe" || q.get("hub.verify_token") !== t) return null;
  return q.get("hub.challenge");
}

/** Meta Lead Ads: es desa l'esdeveniment (idempotent) i, si hi ha token de pàgina, es llegeixen les dades del lead. */
export async function metaLeadgenWebhook(rawBody: string, signature: string | null) {
  const ok = verifyMetaSignature(rawBody, signature, captureEnv().metaAppSecret);
  if (!ok) throw new HttpError(401, "Signatura no vàlida");
  const body = JSON.parse(rawBody) as { object?: string; entry?: { changes?: { field: string; value: { leadgen_id?: string; ad_id?: string; form_id?: string; page_id?: string; created_time?: number } }[] }[] };
  const sb = adminClient();
  const results: string[] = [];
  for (const ch of (body.entry ?? []).flatMap((e) => e.changes ?? []).filter((c) => c.field === "leadgen" && c.value.leadgen_id)) {
    const v = ch.value;
    const ev = await sb.from("cap_webhook_events").insert({ provider: "meta_leadgen", external_id: v.leadgen_id!, signature_ok: true, payload: { ad_id: v.ad_id ?? null, form_id: v.form_id ?? null, page_id: v.page_id ?? null }, status: "rebut" }).select("id").single();
    if (ev.error) { results.push("duplicat"); continue; } // ja rebut: idempotent
    const token = captureEnv().metaPageToken;
    if (!token) { await sb.from("cap_webhook_events").update({ status: "pendent_credencials", error: "Falta META_PAGE_ACCESS_TOKEN" }).eq("id", ev.data.id); results.push("pendent_credencials"); continue; }
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(v.leadgen_id!)}?fields=field_data,campaign_id,campaign_name,ad_id&access_token=${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error(`Graph ${r.status}`);
      const lead = (await r.json()) as { field_data?: { name: string; values: string[] }[]; campaign_id?: string; campaign_name?: string };
      const fd = Object.fromEntries((lead.field_data ?? []).map((x) => [x.name, x.values?.[0] ?? ""]));
      let campaignId: string | null = null;
      if (lead.campaign_id) campaignId = ((await sb.from("cap_campaigns").upsert({ platform: "meta_ads", external_id: lead.campaign_id, name: lead.campaign_name ?? `Meta ${lead.campaign_id}` }, { onConflict: "platform,external_id", ignoreDuplicates: false }).select("id").single()).data?.id as string | undefined) ?? null;
      const { submit } = await import("./capture");
      const res = await submit({
        ip: "meta", by: null, forcedChannel: "meta_ads", file: null, relaxed: true, consentText: "Formulari de Meta Lead Ads amb la política de privacitat d'Assessoria 3.0 enllaçada al formulari.",
        fields: { idempotencyKey: uuidFrom(`meta:${v.leadgen_id}`), name: fd.full_name || fd.first_name || "Lead de Meta", phone: fd.phone_number ?? "", email: fd.email ?? "", customerKind: /empresa|business/i.test(fd.customer_type ?? "") ? "empresa" : "particular", energyType: /gas/i.test(fd.energy ?? "") ? "gas" : "luz", acceptPrivacy: true, acceptCommercial: false, notes: "", utm: { source: "meta", campaign: lead.campaign_name ?? null } },
      });
      if (campaignId && res.submissionId) await sb.from("cap_submissions").update({ campaign_id: campaignId }).eq("id", res.submissionId);
      await sb.from("cap_webhook_events").update({ status: res.ok ? "processat" : "error", error: res.ok ? null : res.error ?? null, processed_at: nowIso() }).eq("id", ev.data.id);
      results.push(res.ok ? "processat" : "error");
    } catch (e) {
      await sb.from("cap_webhook_events").update({ status: "error", error: (e as Error).message.slice(0, 200) }).eq("id", ev.data.id);
      results.push("error");
    }
  }
  return { received: results.length, results };
}
const uuidFrom = (s: string) => { const h = createHmac("sha256", "a30").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

/* ======================================================================= WhatsApp */

type WaBody = { entry?: { changes?: { field: string; value: { statuses?: { id: string; status: string; timestamp?: string; errors?: { title?: string }[] }[]; messages?: { id: string; from: string; timestamp?: string; type: string; text?: { body: string } }[]; contacts?: { profile?: { name?: string }; wa_id: string }[] } }[] }[] };

/** Estats de lliurament i missatges entrants. L'estat només avança (trigger) i és idempotent per identificador. */
export async function whatsappWebhook(rawBody: string, signature: string | null) {
  if (!verifyMetaSignature(rawBody, signature, captureEnv().metaAppSecret)) throw new HttpError(401, "Signatura no vàlida");
  const body = JSON.parse(rawBody) as WaBody;
  const sb = adminClient();
  let statuses = 0, inbound = 0;
  for (const v of (body.entry ?? []).flatMap((e) => e.changes ?? []).filter((c) => c.field === "messages").map((c) => c.value)) {
    for (const s of v.statuses ?? []) {
      const st = WA_STATUS[s.status];
      if (!st) continue;
      const key = `${s.id}:${s.status}`;
      const ev = await sb.from("cap_webhook_events").insert({ provider: "whatsapp", external_id: key, signature_ok: true, payload: { status: s.status }, status: "rebut" }).select("id");
      if (ev.error) continue;
      await sb.from("cap_whatsapp_messages").update({ status: st, status_at: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : nowIso(), error: st === "fallit" ? (s.errors?.[0]?.title ?? "Error de lliurament").slice(0, 200) : null }).eq("wa_message_id", s.id);
      await sb.from("cap_webhook_events").update({ status: "processat", processed_at: nowIso() }).eq("provider", "whatsapp").eq("external_id", key);
      statuses++;
    }
    for (const m of v.messages ?? []) {
      const ev = await sb.from("cap_webhook_events").insert({ provider: "whatsapp", external_id: m.id, signature_ok: true, payload: { type: m.type }, status: "rebut" }).select("id");
      if (ev.error) continue;
      const phone = normalizePhone(`+${m.from}`) ?? `+${m.from}`;
      const lead = (await sb.from("crm_leads").select("id,owner_id,name").eq("phone", phone).order("created_at", { ascending: false }).limit(1)).data?.[0] as { id: string; owner_id: string | null; name: string } | undefined;
      const client = lead ? null : ((await sb.from("crm_clients").select("id,owner_id,name").eq("phone", phone).is("archived_at", null).limit(1)).data?.[0] as { id: string; owner_id: string | null; name: string } | undefined);
      let leadId = lead?.id ?? null;
      if (!lead && !client) {
        const { submit } = await import("./capture");
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name || "Contacte de WhatsApp";
        const r = await submit({ ip: "whatsapp", forcedChannel: "whatsapp", file: null, relaxed: true, consentText: "Contacte iniciat per la persona a través de WhatsApp (sol·licitud d'informació).", fields: { idempotencyKey: uuidFrom(`wa:${m.id}`), name, phone, email: "", customerKind: "particular", energyType: "luz", acceptPrivacy: true, notes: (m.text?.body ?? "").slice(0, 900) } }).catch(() => null);
        leadId = r?.submissionId ? ((await sb.from("cap_submissions").select("lead_id").eq("id", r.submissionId).single()).data?.lead_id as string | null) : null;
      }
      await sb.from("cap_whatsapp_messages").insert({ lead_id: leadId, client_id: client?.id ?? null, direction: "entrant", wa_message_id: m.id, phone, body: (m.text?.body ?? `[${m.type}]`).slice(0, 4096), status: "rebut", status_at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : nowIso() });
      const owner = lead?.owner_id ?? client?.owner_id;
      if (owner) await sb.from("crm_notifications").upsert({ user_id: owner, kind: "whatsapp", title: `WhatsApp de ${lead?.name ?? client?.name}`.slice(0, 200), body: (m.text?.body ?? "").slice(0, 200), link: leadId ? { view: "captacio-lead", params: { id: leadId } } : { view: "client", params: { id: client!.id } }, rule_key: `wa:${m.id}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
      await sb.from("cap_webhook_events").update({ status: "processat", processed_at: nowIso() }).eq("provider", "whatsapp").eq("external_id", m.id);
      inbound++;
    }
  }
  return { statuses, inbound };
}

const waSend = z.object({ leadId: z.string().uuid(), template: z.string().trim().max(120).optional(), lang: z.string().max(10).default("ca"), params: z.array(z.string().max(300)).max(10).default([]), text: z.string().trim().max(1000).optional() });
/** Enviament a un lead: consentiment de WhatsApp vigent o conversa iniciada pel client; text lliure només dins la finestra de 24 h. */
export async function sendWhatsapp(u: U, raw: unknown) {
  const p = waSend.parse(raw);
  const { data: lead } = await u.sb.from("crm_leads").select("id,phone,name").eq("id", p.leadId).maybeSingle();
  if (!lead) throw new HttpError(404, "Lead no trobat o sense permís");
  const canEdit = (await u.sb.rpc("crm_can_edit_lead", { p_lead: p.leadId })).data;
  if (!canEdit) throw new HttpError(403, "No tens permís per contactar aquest lead");
  if (!integrations().whatsappCloud) throw new HttpError(400, "WhatsApp Business no està configurat (pendent de credencials). Pots fer servir l'enllaç wa.me i registrar el contacte.");
  const phone = normalizePhone(lead.phone);
  if (!phone) throw new HttpError(400, "El lead no té un telèfon vàlid");
  const sb = adminClient();
  const consent = (await sb.from("cap_consents").select("id").eq("lead_id", p.leadId).eq("kind", "whatsapp").eq("granted", true).is("withdrawn_at", null).limit(1)).data?.length;
  const lastIn = (await sb.from("cap_whatsapp_messages").select("created_at").eq("phone", phone).eq("direction", "entrant").order("created_at", { ascending: false }).limit(1)).data?.[0]?.created_at as string | undefined;
  const windowOpen = waWindowOpen(lastIn ?? null);
  if (!consent && !lastIn) throw new HttpError(409, "Aquest lead no ha donat consentiment per WhatsApp ni ha iniciat cap conversa.");
  if (p.text && !windowOpen) throw new HttpError(409, "Fora de la finestra de 24 h: cal una plantilla aprovada per Meta.");
  if (!p.text && !p.template) throw new HttpError(400, "Indica una plantilla aprovada o un text (dins la finestra de 24 h)");
  const payload = p.text ? { messaging_product: "whatsapp", to: phone.replace("+", ""), type: "text", text: { body: p.text } } : { messaging_product: "whatsapp", to: phone.replace("+", ""), type: "template", template: { name: p.template, language: { code: p.lang }, components: p.params.length ? [{ type: "body", parameters: p.params.map((text) => ({ type: "text", text })) }] : [] } };
  const r = await fetch(`https://graph.facebook.com/v21.0/${env.waPhoneId}/messages`, { method: "POST", headers: { authorization: `Bearer ${env.waToken}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  const waId = j.messages?.[0]?.id ?? null;
  await sb.from("cap_whatsapp_messages").insert({ lead_id: p.leadId, direction: "sortint", wa_message_id: waId ?? `local-${randomUUID()}`, phone, template: p.template ?? null, body: p.text ?? `[plantilla ${p.template}] ${p.params.join(" · ")}`.slice(0, 4096), status: r.ok ? "acceptat" : "fallit", status_at: nowIso(), error: r.ok ? null : (j.error?.message ?? `Error ${r.status}`).slice(0, 200), created_by: u.user.id });
  await sb.from("crm_activities").insert({ lead_id: p.leadId, type: "whatsapp", title: r.ok ? "WhatsApp acceptat per Meta (pendent de confirmació de lliurament)" : "WhatsApp no enviat", delivery: r.ok ? "intent" : "error", user_id: u.user.id, user_name: u.profile.name, meta: { waId, template: p.template ?? null } });
  if (!r.ok) throw new HttpError(502, j.error?.message ?? "WhatsApp ha rebutjat el missatge");
  return { accepted: true, waId, status: "acceptat" };
}

/* ======================================================================= fitxa de captació del lead */

export async function captureLead(u: U, leadId: string) {
  const { data: lead } = await u.sb.from("crm_leads").select("*").eq("id", leadId).maybeSingle();
  if (!lead) throw new HttpError(404, "Lead no trobat o sense permís");
  const collab = u.profile.role === "colaborador";
  const [sub, consents, docs, readings, attrs, assigns, wa, partner, campaign] = await Promise.all([
    lead.capture_submission_id && !collab ? u.sb.from("cap_submissions").select("id,channel,status,received_at,ref_code,utm,click_ids,attempts,error").eq("id", lead.capture_submission_id).maybeSingle() : Promise.resolve({ data: null }),
    u.sb.from("cap_consents").select("id,kind,granted,text_version,created_at,withdrawn_at,channel").eq("lead_id", leadId).order("created_at"),
    u.sb.from("cap_lead_documents").select("id,kind,original_name,mime,size_bytes,status,created_at,client_document_id").eq("lead_id", leadId).order("created_at", { ascending: false }),
    collab ? Promise.resolve({ data: [] }) : u.sb.from("cap_invoice_readings").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
    u.sb.from("cap_attributions").select("id,partner_id,status,source,ref_code,reason,created_at,cap_partners(name,company)").eq("lead_id", leadId).order("created_at"),
    u.sb.from("cap_assignments").select("id,user_id,method,reason,created_at").eq("lead_id", leadId).order("created_at", { ascending: false }),
    u.sb.from("cap_whatsapp_messages").select("id,direction,body,status,status_at,created_at,template,error").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(50),
    lead.capture_partner_id ? u.sb.from("cap_partners").select("name,company").eq("id", lead.capture_partner_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.capture_campaign_id && !collab ? u.sb.from("cap_campaigns").select("name,platform").eq("id", lead.capture_campaign_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const names = new Map((((await u.sb.from("profiles").select("id,name")).data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return {
    lead: { ...lead, owner_name: lead.owner_id ? names.get(lead.owner_id) ?? null : null }, submission: sub.data, consents: consents.data ?? [], documents: docs.data ?? [], readings: readings.data ?? [],
    attributions: attrs.data ?? [], assignments: ((assigns.data ?? []) as { user_id: string | null }[]).map((a) => ({ ...a, user_name: a.user_id ? names.get(a.user_id) ?? null : null })), whatsapp: wa.data ?? [],
    partner: partner.data, campaign: campaign.data, users: [...names.entries()].map(([id, name]) => ({ id, name })),
    can: { review: !collab, assign: u.profile.role === "admin", attribution: u.profile.role === "admin", whatsapp: !collab, waConfigured: integrations().whatsappCloud },
  };
}

export async function assignManual(u: U, leadId: string, userId: string, reason: string) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció reassigna leads manualment");
  if (!reason?.trim()) throw new HttpError(400, "Cal indicar el motiu de l'assignació manual");
  const sb = adminClient();
  const { data: prev } = await sb.from("crm_leads").select("owner_id,name").eq("id", leadId).maybeSingle();
  if (!prev) throw new HttpError(404, "Lead no trobat");
  if (prev.owner_id === userId) return { ok: true, unchanged: true };
  await sb.from("crm_leads").update({ owner_id: userId }).eq("id", leadId);
  await sb.from("cap_assignments").insert({ lead_id: leadId, user_id: userId, method: "manual", reason: reason.trim().slice(0, 300), assigned_by: u.user.id });
  await sb.from("cap_audit").insert({ entity: "crm_leads", entity_id: leadId, action: "assignacio_manual", detail: { from: prev.owner_id, to: userId, reason }, user_id: u.user.id });
  await sb.from("crm_notifications").upsert({ user_id: userId, kind: "assignacio", title: `Lead assignat: ${prev.name}`.slice(0, 200), body: reason.slice(0, 200), link: { view: "captacio-lead", params: { id: leadId } }, rule_key: `cap:assign:${leadId}:${userId}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
  await sb.from("crm_tasks").upsert({ rule_key: `cap:lead:${leadId}:${userId}`, lead_id: leadId, title: `Primer contacte: ${prev.name}`.slice(0, 200), due_at: new Date(Date.now() + 4 * 3600_000).toISOString(), assigned_to: userId, kind: "trucada", source: "automatica", status: "pendent", created_by: null }, { onConflict: "rule_key", ignoreDuplicates: true });
  return { ok: true };
}

export async function setDuplicateStatus(u: U, leadId: string, status: "duplicat_confirmat" | "revisat_no_duplicat") {
  if (u.profile.role === "colaborador") throw new HttpError(403, "No tens permís");
  const r = await u.sb.from("crm_leads").update({ duplicate_status: status }).eq("id", leadId).select("id");
  if (!r.data?.length) throw new HttpError(403, "No tens permís per modificar aquest lead");
  await adminClient().from("cap_audit").insert({ entity: "crm_leads", entity_id: leadId, action: status, detail: null, user_id: u.user.id });
  return { ok: true };
}

const ruleSchema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(2).max(120), priority: z.coerce.number().int().min(1).max(10000), active: z.boolean(), strategy: z.enum(["usuari", "rotatiu", "menys_carrega"]), user_ids: z.array(z.string().uuid()).min(1).max(30), max_open_leads: z.coerce.number().int().min(1).max(10000).nullable().optional(), conditions: z.object({ provinces: z.array(z.string().max(60)).max(60).optional(), cities: z.array(z.string().max(80)).max(200).optional(), energy: z.array(z.enum(["luz", "gas"])).optional(), customer_kinds: z.array(z.enum(["particular", "empresa"])).optional(), channels: z.array(z.enum(CHANNELS)).optional(), partner_ids: z.array(z.string().uuid()).optional(), min_kwh: z.number().nullable().optional(), max_kwh: z.number().nullable().optional() }) });
export async function listRules(u: U) {
  staffOnly(u);
  const [r, users] = await Promise.all([u.sb.from("cap_assignment_rules").select("*").order("priority"), u.sb.from("profiles").select("id,name,role").in("role", ["admin", "comercial", "cap_administrativa", "administrativa"])]);
  return { rules: r.data ?? [], users: users.data ?? [], canEdit: u.profile.role === "admin" };
}
export async function saveRule(u: U, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció configura l'assignació");
  const { id, ...r } = ruleSchema.parse(raw);
  const res = id ? await u.sb.from("cap_assignment_rules").update({ ...r, updated_at: nowIso() }).eq("id", id).select("id") : await u.sb.from("cap_assignment_rules").insert({ ...r, created_by: u.user.id }).select("id");
  if (res.error) throw new HttpError(400, "No s'ha pogut desar la regla");
  return { id: res.data?.[0]?.id };
}

/* ======================================================================= automatitzacions (motor existent) */

type Rule = { key: string; enabled: boolean; params: Record<string, unknown> };
type Note = { user_id: string; kind: string; title: string; body: string | null; link: { view: string; params: Record<string, string> }; rule_key: string };
/** Avisos interns de captació. Cada avís té `rule_key` única: repetir l'execució no duplica res. Mai s'escriu a clients. */
export async function captureAutomations(sb: SB, now: Date, active: Rule[], staffIds: string[]): Promise<Note[]> {
  const on = (k: string) => active.find((r) => r.key === k);
  const out: Note[] = [];
  try {
    const r1 = on("cap_lead_sense_assignar");
    if (r1) {
      const hours = Number(r1.params.hours ?? 2);
      const { data, error } = await sb.from("crm_leads").select("id,name,created_at").not("capture_channel", "is", null).is("owner_id", null).eq("status", "nou").lt("created_at", new Date(now.getTime() - hours * 3600_000).toISOString()).limit(200);
      if (error) throw error;
      for (const l of (data ?? []) as { id: string; name: string }[]) for (const s of staffIds) out.push({ user_id: s, kind: "lead", title: `Lead sense assignar: ${l.name}`.slice(0, 200), body: `Porta més de ${hours} h sense responsable.`, link: { view: "captacio-lead", params: { id: l.id } }, rule_key: `cap:sense_assignar:${l.id}` });
    }
    const r2 = on("cap_proposta_revisio");
    if (r2) {
      const days = Number(r2.params.days ?? 2);
      const { data } = await sb.from("cap_invoice_readings").select("id,lead_id,crm_leads(name,owner_id)").eq("sufficient", true).eq("status", "per_revisar").lt("updated_at", new Date(now.getTime() - days * 86_400_000).toISOString()).limit(200);
      for (const r of (data ?? []) as unknown as { id: string; lead_id: string; crm_leads: { name: string; owner_id: string | null } | null }[]) if (r.crm_leads?.owner_id) out.push({ user_id: r.crm_leads.owner_id, kind: "lead", title: `Comparativa preliminar pendent de revisió: ${r.crm_leads.name}`.slice(0, 200), body: `Fa més de ${days} dies que espera revisió.`, link: { view: "captacio-lead", params: { id: r.lead_id } }, rule_key: `cap:revisio_pendent:${r.id}` });
    }
    const r3 = on("cap_contracte_activat");
    if (r3) {
      const { data: leads } = await sb.from("crm_leads").select("id,name,owner_id,converted_client_id,capture_partner_id,cap_partners(user_id)").not("capture_channel", "is", null).not("converted_client_id", "is", null).limit(5000);
      const L = (leads ?? []) as unknown as { id: string; name: string; owner_id: string | null; converted_client_id: string; cap_partners: { user_id: string | null } | null }[];
      const ids = L.map((l) => l.converted_client_id);
      for (let i = 0; i < ids.length; i += 300) {
        const { data: ks } = await sb.from("crm_contracts").select("id,client_id,retailer").in("client_id", ids.slice(i, i + 300)).eq("status", "actiu").gte("created_at", new Date(now.getTime() - 14 * 86_400_000).toISOString());
        for (const k of (ks ?? []) as { id: string; client_id: string; retailer: string }[]) {
          const l = L.find((x) => x.converted_client_id === k.client_id)!;
          for (const user of [l.owner_id, l.cap_partners?.user_id].filter((x): x is string => !!x)) out.push({ user_id: user, kind: "captacio", title: `Contracte activat: ${l.name} · ${k.retailer}`.slice(0, 200), body: null, link: user === l.cap_partners?.user_id ? { view: "portal", params: {} } : { view: "client", params: { id: k.client_id } }, rule_key: `cap:activat:${k.id}` });
        }
      }
    }
    const partnersR = await sb.from("cap_partners").select("user_id").not("user_id", "is", null).eq("status", "actiu");
    const partnerUsers = ((partnersR.data ?? []) as { user_id: string }[]).map((p) => p.user_id);
    if (partnerUsers.length && on("cap_comissio_meritable")) {
      const { data } = await sb.from("fin_ledger").select("id,beneficiary_id,amount,description").eq("layer", "collaborador").eq("kind", "meritacio").in("beneficiary_id", partnerUsers).gte("created_at", new Date(now.getTime() - 14 * 86_400_000).toISOString()).limit(1000);
      for (const l of (data ?? []) as { id: string; beneficiary_id: string; amount: string; description: string }[]) out.push({ user_id: l.beneficiary_id, kind: "economia", title: `Comissió meritada: ${Number(l.amount).toLocaleString("ca-ES", { style: "currency", currency: "EUR" })}`, body: l.description?.slice(0, 200) ?? null, link: { view: "portal", params: {} }, rule_key: `cap:meritada:${l.id}` });
    }
    if (partnerUsers.length && on("cap_liquidacio_disponible")) {
      const { data } = await sb.from("fin_settlements").select("id,code,status,beneficiary_id").eq("kind", "collaborador").in("status", ["aprovada", "pagada"]).in("beneficiary_id", partnerUsers).limit(1000);
      for (const s of (data ?? []) as { id: string; code: string; status: string; beneficiary_id: string }[]) out.push({ user_id: s.beneficiary_id, kind: "economia", title: `Liquidació ${s.code} ${s.status === "pagada" ? "pagada" : "aprovada"}: ja la pots descarregar`, body: null, link: { view: "portal", params: {} }, rule_key: `cap:liquidacio:${s.id}:${s.status}` });
    }
  } catch (e) {
    const m = (e as Error).message ?? "";
    if (!/does not exist|schema cache|capture_channel/i.test(m)) throw e; // migració 013 pendent → sense avisos
  }
  return out;
}
