import "server-only";
/**
 * COL·LABORADORS (servidor): alta, enllaços i QR (Direcció) i portal privat del col·laborador.
 * El portal llegeix amb la sessió del col·laborador (RLS): només els seus leads, clients, documents i comissions.
 * Mai es mostren marges ni dades d'altres col·laboradors.
 */
import QRCode from "qrcode";
import { z } from "zod";
import { CHANNEL_LABEL, PARTNER_KINDS, REF_RE, refCodeFrom, referralUrl, type Channel } from "@/core/capture";
import { captureEnv } from "./env";
import { issueAccessLink } from "./access-link";
import { adminClient, HttpError, type requireUser } from "./supabase";

type U = Awaited<ReturnType<typeof requireUser>>;
const STAFF = ["admin", "cap_administrativa", "administrativa"];
const audit = (u: U | null, entity: string, id: string | null, action: string, detail: unknown) => adminClient().from("cap_audit").insert({ entity, entity_id: id, action, detail, user_id: u?.user.id ?? null });

export const partnerInput = z.object({
  name: z.string().trim().min(2).max(160),
  company: z.string().trim().max(160).optional().nullable(),
  public_name: z.string().trim().max(80).optional().nullable(),
  kind: z.enum(Object.keys(PARTNER_KINDS) as [keyof typeof PARTNER_KINDS, ...(keyof typeof PARTNER_KINDS)[]]),
  email: z.string().trim().toLowerCase().email().max(160).optional().nullable().or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(30).optional().nullable(),
  province: z.string().trim().max(60).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  tax_id: z.string().trim().toUpperCase().max(20).optional().nullable(),
  legal_name: z.string().trim().max(160).optional().nullable(),
  invite: z.boolean().optional().default(false),
  code: z.string().trim().toUpperCase().optional().nullable().refine((v) => !v || REF_RE.test(v), "Codi de 4 a 16 lletres o xifres"),
});

async function uniqueCode(base: string): Promise<string> {
  const sb = adminClient();
  for (let i = 0; i < 8; i++) {
    const code = i === 0 && REF_RE.test(base) ? base : refCodeFrom(base);
    const { data } = await sb.from("cap_referral_links").select("id").eq("code", code).maybeSingle();
    if (!data) return code;
  }
  throw new HttpError(409, "No s'ha pogut generar un codi únic");
}

/** Alta de col·laborador (Direcció). Amb `invite`, es crea l'accés al portal (rol col·laborador) i s'envia la invitació. */
export async function createPartner(u: U, raw: unknown, origin: string) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció dona d'alta col·laboradors");
  const p = partnerInput.parse(raw);
  const sb = adminClient();
  let userId: string | null = null;
  let access: Awaited<ReturnType<typeof issueAccessLink>> | null = null;
  if (p.invite) {
    if (!p.email) throw new HttpError(400, "Per donar accés al portal cal el correu del col·laborador");
    access = await issueAccessLink({ email: p.email, name: p.name, kind: "invite", next: "/collaboradors", origin, portal: true, sender: { email: u.profile.email, name: u.profile.name } });
    userId = access.userId;
    if (!userId) throw new HttpError(500, "No s'ha pogut crear l'accés");
    const pr = await sb.from("profiles").upsert({ id: userId, name: p.name, email: p.email, role: "colaborador", code: null });
    if (pr.error) throw pr.error;
  }
  const ins = await sb.from("cap_partners").insert({ user_id: userId, kind: p.kind, name: p.name, company: p.company ?? null, public_name: p.public_name ?? null, email: p.email ?? null, phone: p.phone ?? null, province: p.province ?? null, city: p.city ?? null, notes: p.notes ?? null, status: "actiu", created_by: u.user.id }).select("id").single();
  if (ins.error) throw new HttpError(400, "No s'ha pogut crear el col·laborador");
  const partnerId = ins.data.id as string;
  if (userId) await sb.from("fin_collaborator_terms").upsert({ user_id: userId, legal_name: p.legal_name ?? p.company ?? p.name, tax_id: p.tax_id ?? null, billing_email: p.email ?? null, active: true, updated_by: u.user.id });
  const code = await uniqueCode(p.code || p.company || p.name);
  await sb.from("cap_referral_links").insert({ partner_id: partnerId, code, label: "Enllaç principal", channel: "recomanacio", created_by: u.user.id });
  await audit(u, "cap_partners", partnerId, "alta", { kind: p.kind, invited: !!userId, code });
  return { id: partnerId, code, userId, invited: !!userId, link: access?.link ?? null, emailSent: access?.emailSent ?? false, emailError: access?.emailError ?? null };
}

export async function listPartners(u: U) {
  if (!STAFF.includes(u.profile.role)) throw new HttpError(403, "Només per a l'equip d'administració");
  const [ps, links, leads, attr] = await Promise.all([
    u.sb.from("cap_partners").select("*").order("created_at", { ascending: false }),
    u.sb.from("cap_referral_links").select("*").order("created_at"),
    u.sb.from("crm_leads").select("capture_partner_id,status,converted_client_id").not("capture_partner_id", "is", null).limit(10000),
    u.sb.from("cap_attributions").select("id,lead_id,partner_id,status,reason,created_at,crm_leads(name)").eq("status", "en_disputa"),
  ]);
  const base = captureEnv().publicUrl;
  const stats = new Map<string, { leads: number; converted: number }>();
  for (const l of (leads.data ?? []) as { capture_partner_id: string; converted_client_id: string | null }[]) { const s = stats.get(l.capture_partner_id) ?? { leads: 0, converted: 0 }; s.leads++; if (l.converted_client_id) s.converted++; stats.set(l.capture_partner_id, s); }
  return {
    partners: (ps.data ?? []).map((p) => ({ ...p, links: (links.data ?? []).filter((l) => l.partner_id === p.id).map((l) => ({ ...l, url: base ? referralUrl(base, l.code) : `/estudi?ref=${l.code}` })), stats: stats.get(p.id) ?? { leads: 0, converted: 0 } })),
    disputes: attr.data ?? [], kinds: PARTNER_KINDS, canEdit: u.profile.role === "admin",
  };
}

const partnerPatch = partnerInput.partial().extend({ status: z.enum(["pendent", "actiu", "suspes", "baixa"]).optional() });
export async function updatePartner(u: U, id: string, raw: unknown) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció modifica col·laboradors");
  const p = partnerPatch.parse(raw);
  const rest = Object.fromEntries(Object.entries(p).filter(([k]) => !["invite", "code", "tax_id", "legal_name"].includes(k)));
  const { error } = await adminClient().from("cap_partners").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new HttpError(400, "No s'ha pogut desar");
  await audit(u, "cap_partners", id, "modificat", { camps: Object.keys(rest) });
  return { ok: true };
}

export async function addLink(u: U, partnerId: string, b: { label?: string; channel?: "recomanacio" | "qr"; code?: string }) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció crea enllaços");
  const { data: p } = await adminClient().from("cap_partners").select("name").eq("id", partnerId).maybeSingle();
  if (!p) throw new HttpError(404, "Col·laborador no trobat");
  if (b.code && !REF_RE.test(b.code.toUpperCase())) throw new HttpError(400, "Codi de 4 a 16 lletres o xifres");
  const code = await uniqueCode((b.code || p.name).toUpperCase());
  const { error } = await adminClient().from("cap_referral_links").insert({ partner_id: partnerId, code, label: b.label?.slice(0, 80) ?? null, channel: b.channel === "qr" ? "qr" : "recomanacio", created_by: u.user.id });
  if (error) throw new HttpError(400, "No s'ha pogut crear l'enllaç");
  await audit(u, "cap_referral_links", code, "creat", { partnerId });
  return { code };
}
export async function setLinkActive(u: U, linkId: string, active: boolean) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció");
  await adminClient().from("cap_referral_links").update({ active }).eq("id", linkId);
  await audit(u, "cap_referral_links", linkId, active ? "activat" : "desactivat", null);
  return { ok: true };
}

/** QR (SVG o PNG) de l'enllaç: només per a l'equip o per al col·laborador propietari. */
export async function qrFor(u: U, code: string, format: "svg" | "png", origin: string) {
  const { data: l } = await u.sb.from("cap_referral_links").select("code,active").eq("code", code.toUpperCase()).maybeSingle();
  if (!l) throw new HttpError(404, "Enllaç no trobat");
  const url = referralUrl(captureEnv().publicUrl || origin, l.code);
  if (format === "png") return { body: await QRCode.toBuffer(url, { type: "png", width: 720, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0f3d2e", light: "#ffffff" } }), type: "image/png", url };
  return { body: Buffer.from(await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#0f3d2e", light: "#ffffff" } })), type: "image/svg+xml", url };
}

/** Decisió de Direcció sobre una atribució (en disputa → vigent/rebutjada). Mai sense motiu; queda auditat (trigger). */
export async function decideAttribution(u: U, id: string, decision: "vigent" | "rebutjada", reason: string) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció decideix les atribucions");
  if (!reason?.trim()) throw new HttpError(400, "Cal indicar el motiu");
  const { data: a } = await u.sb.from("cap_attributions").select("id,lead_id,status").eq("id", id).maybeSingle();
  if (!a) throw new HttpError(404, "Atribució no trobada");
  if (decision === "vigent") {
    const cur = await u.sb.from("cap_attributions").update({ status: "substituida", reason: `Substituïda per decisió de Direcció: ${reason}` }).eq("lead_id", a.lead_id).eq("status", "vigent").neq("id", id);
    if (cur.error) throw new HttpError(400, cur.error.message);
  }
  const r = await u.sb.from("cap_attributions").update({ status: decision, reason }).eq("id", id).select("id");
  if (r.error) throw new HttpError(400, r.error.message.replace(/^.*?: /, ""));
  return { ok: true };
}

/* ======================================================================= portal del col·laborador */

async function myPartner(u: U) {
  if (u.profile.role !== "colaborador") throw new HttpError(403, "El portal és per a col·laboradors");
  const { data } = await u.sb.from("cap_partners").select("*").eq("user_id", u.user.id).maybeSingle();
  if (!data) throw new HttpError(403, "El teu usuari no té cap perfil de col·laborador associat. Contacta amb Assessoria 3.0.");
  return data as { id: string; name: string; company: string | null; status: string; email: string | null; phone: string | null; city: string | null; province: string | null; kind: keyof typeof PARTNER_KINDS; public_name: string | null };
}

const LEAD_STAGE = (l: { status: string; converted_client_id: string | null }, hasActive: boolean, inProgress: boolean) =>
  hasActive ? "Contracte activat" : inProgress ? "En tramitació" : l.converted_client_id ? "Client" : l.status === "descartat" ? "Descartat" : l.status === "nou" ? "Rebut" : "En estudi";

export async function portalData(u: U) {
  const me = await myPartner(u);
  const [links, leads, clients, docs, settlements] = await Promise.all([
    u.sb.from("cap_referral_links").select("id,code,label,channel,active,created_at").eq("partner_id", me.id).order("created_at"),
    u.sb.from("crm_leads").select("id,name,status,created_at,converted_client_id,services,capture_channel").eq("collaborator_id", u.user.id).order("created_at", { ascending: false }).limit(500),
    u.sb.from("crm_clients").select("id,name,status,created_at").eq("collaborator_id", u.user.id).is("archived_at", null).limit(1000),
    u.sb.from("cap_lead_documents").select("id,lead_id,original_name,kind,created_at,status").eq("uploaded_by", u.user.id).eq("kind", "factura").order("created_at", { ascending: false }).limit(200),
    u.sb.from("fin_settlements").select("id,code,status,period_from,period_to,total_gross,approved_amount,paid_amount").eq("beneficiary_id", u.user.id).eq("kind", "collaborador").neq("status", "anullada").order("period_to", { ascending: false }).limit(100),
  ]);
  const clientIds = (clients.data ?? []).map((c) => c.id as string);
  const [contracts, exps] = await Promise.all([
    clientIds.length ? u.sb.from("crm_contracts").select("id,client_id,status,retailer").in("client_id", clientIds).limit(2000) : Promise.resolve({ data: [] as { id: string; client_id: string; status: string; retailer: string }[] }),
    clientIds.length ? u.sb.from("crm_expedients").select("id,client_id,status").in("client_id", clientIds).limit(2000) : Promise.resolve({ data: [] as { id: string; client_id: string; status: string }[] }),
  ]);
  // Fase 7: estudis (oportunitats obertes dels seus leads/clients), rebutjats, sol·licituds externes i historial
  const leadIds = ((leads.data ?? []) as { id: string }[]).map((l) => l.id);
  const [oppsL, oppsC, ext] = await Promise.all([
    leadIds.length ? u.sb.from("crm_opportunities").select("id,stage,lead_id,client_id,created_at,proposal_sent_at,won_at,lost_at").in("lead_id", leadIds.slice(0, 500)) : Promise.resolve({ data: [] as { id: string; stage: string; lead_id: string | null; client_id: string | null; created_at: string; proposal_sent_at: string | null; won_at: string | null; lost_at: string | null }[] }),
    clientIds.length ? u.sb.from("crm_opportunities").select("id,stage,lead_id,client_id,created_at,proposal_sent_at,won_at,lost_at").in("client_id", clientIds.slice(0, 500)) : Promise.resolve({ data: [] as { id: string; stage: string; lead_id: string | null; client_id: string | null; created_at: string; proposal_sent_at: string | null; won_at: string | null; lost_at: string | null }[] }),
    u.sb.from("crm_tasks").select("id,title,notes,status,due_at,created_at,completed_at,created_by").eq("partner_visible", true).order("created_at", { ascending: false }).limit(50).then((r) => r, () => ({ data: [] })),
  ]);
  const oppMap = new Map([...((oppsL.data ?? []) as { id: string }[]), ...((oppsC.data ?? []) as { id: string }[])].map((o) => [o.id, o as { id: string; stage: string; created_at: string; proposal_sent_at: string | null; won_at: string | null; lost_at: string | null }]));
  const opps = [...oppMap.values()];
  const rejected = ((exps.data ?? []) as { status: string }[]).filter((e) => e.status === "rebutjat").length;
  const active = new Set(((contracts.data ?? []) as { client_id: string; status: string }[]).filter((k) => ["actiu", "renovacio_pendent"].includes(k.status)).map((k) => k.client_id));
  const inProg = new Set(((exps.data ?? []) as { client_id: string; status: string }[]).filter((e) => !["activat", "rebutjat", "cancellat", "tancat"].includes(e.status)).map((e) => e.client_id));
  // comissions pròpies (Fase 4): estimades (càlculs), meritades (llibre), liquidades i pagaments pendents (liquidacions)
  const { myCommissions } = await import("./finance");
  const com = await myCommissions(u).catch(() => null);
  const n = (v: unknown) => Number(v ?? 0);
  const estimated = com ? com.calculations.filter((c) => c.status === "calculat" || c.status === "simulacio").reduce((a, c) => a + n(c.amount), 0) : null;
  const accrued = com ? (com.ledger as { kind: string; amount: string }[]).filter((l) => l.kind === "meritacio").reduce((a, l) => a + n(l.amount), 0) : null;
  const sets = (settlements.data ?? []) as { status: string; approved_amount: string | null; total_gross: string; paid_amount: string }[];
  const settled = sets.filter((s) => s.status === "aprovada" || s.status === "pagada").reduce((a, s) => a + n(s.approved_amount ?? s.total_gross), 0);
  const pendingPay = sets.filter((s) => s.status === "aprovada" || s.status === "pagada").reduce((a, s) => a + Math.max(0, n(s.approved_amount ?? s.total_gross) - n(s.paid_amount)), 0);
  const base = captureEnv().publicUrl;
  const L = (leads.data ?? []) as { id: string; name: string; status: string; created_at: string; converted_client_id: string | null; services: string[]; capture_channel: Channel | null }[];
  return {
    partner: { name: me.name, company: me.company, kind: PARTNER_KINDS[me.kind], email: me.email, phone: me.phone, city: me.city, province: me.province, status: me.status },
    links: (links.data ?? []).map((l) => ({ ...l, url: base ? referralUrl(base, l.code as string) : `/estudi?ref=${l.code}` })),
    kpis: {
      clients: clientIds.length, leadsPending: L.filter((l) => ["nou", "contactat", "qualificat"].includes(l.status) && !l.converted_client_id).length,
      inProgress: clientIds.filter((c) => inProg.has(c) && !active.has(c)).length, activated: active.size,
      commissionsEstimated: estimated, commissionsAccrued: accrued, commissionsSettled: settled, paymentsPending: Math.round(pendingPay * 100) / 100, pendingToSettle: com ? n(com.pending) : null,
      leadsTotal: L.length, inStudy: opps.filter((o) => !["guanyat", "perdut"].includes(o.stage)).length, proposals: opps.filter((o) => o.stage === "proposta_enviada").length, rejected,
      commissionsPaid: sets.reduce((a, s) => a + n(s.paid_amount), 0), settlementsPending: sets.filter((s) => s.status === "esborrany" || s.status === "revisio" || (s.status === "aprovada" && n(s.paid_amount) < n(s.approved_amount ?? s.total_gross))).length,
    },
    requests: ((ext.data ?? []) as { id: string; title: string; notes: string | null; status: string; due_at: string | null; created_at: string; completed_at: string | null; created_by: string | null }[]).map((t) => ({ ...t, mine: t.created_by === u.user.id })),
    timeline: [
      ...L.map((l) => ({ at: l.created_at, text: `Client aportat: ${l.name}` })),
      ...opps.filter((o) => o.proposal_sent_at).map((o) => ({ at: o.proposal_sent_at!, text: "Proposta enviada a un client teu" })),
      ...opps.filter((o) => o.won_at).map((o) => ({ at: o.won_at!, text: "Un client teu ha acceptat la proposta" })),
      ...sets.filter((s) => s.status === "pagada").map((s) => ({ at: (s as { period_to?: string }).period_to ?? "", text: "Liquidació pagada" })),
    ].filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40),
    leads: L.map((l) => ({ id: l.id, name: l.name, created_at: l.created_at, services: l.services, channel: l.capture_channel ? CHANNEL_LABEL[l.capture_channel] : null, stage: LEAD_STAGE(l, !!l.converted_client_id && active.has(l.converted_client_id), !!l.converted_client_id && inProg.has(l.converted_client_id)) })),
    documents: docs.data ?? [],
    settlements: settlements.data ?? [],
    history: com ? (com.ledger as { id: string; kind: string; amount: string; period: string; description: string; settlement_id: string | null }[]).slice(0, 100).map((l) => ({ id: l.id, kind: l.kind, amount: l.amount, period: l.period, description: l.description, settled: !!l.settlement_id })) : [],
  };
}

const contactSchema = z.object({ phone: z.string().trim().max(30).nullable().optional(), email: z.string().trim().toLowerCase().email().max(160).nullable().optional(), city: z.string().trim().max(80).nullable().optional(), province: z.string().trim().max(60).nullable().optional(), company: z.string().trim().max(160).nullable().optional() });
export async function portalUpdateContact(u: U, raw: unknown) {
  const me = await myPartner(u);
  const p = contactSchema.parse(raw);
  await adminClient().from("cap_partners").update({ ...p, updated_at: new Date().toISOString() }).eq("id", me.id);
  await audit(u, "cap_partners", me.id, "contacte_actualitzat", { camps: Object.keys(p) });
  return { ok: true };
}

/**
 * Fase 7: el col·laborador escriu a Assessoria 3.0. Es crea una sol·licitud externa (tasca visible per a ell) assignada a
 * la Cap administrativa (o Direcció si no n'hi ha) i un avís intern. No s'envia cap correu extern.
 */
export async function portalMessage(u: U, raw: unknown) {
  const me = await myPartner(u);
  const b = z.object({ subject: z.string().trim().min(3, "Escriu l'assumpte").max(120), message: z.string().trim().min(5, "Escriu el missatge").max(2000) }).parse(raw);
  const sb = adminClient();
  const { data: staff } = await sb.from("profiles").select("id,name,role").in("role", ["cap_administrativa", "admin"]);
  const to = ((staff ?? []) as { id: string; name: string; role: string }[]).sort((a, c) => (a.role === "cap_administrativa" ? -1 : 0) - (c.role === "cap_administrativa" ? -1 : 0))[0];
  const ins = await sb.from("crm_tasks").insert({ title: `Col·laborador ${me.name}: ${b.subject}`, notes: b.message, kind: "sollicitud_externa", area: "externa", partner_visible: true, priority: "normal", assigned_to: to?.id ?? null, assigned_name: to?.name ?? null, created_by: u.user.id, source: "manual", status: "pendent", due_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }).select("id").single();
  if (ins.error) throw new HttpError(ins.error.code === "42703" ? 503 : 400, ins.error.code === "42703" ? "Falta aplicar la migració 014" : "No s'ha pogut enviar el missatge");
  if (to) await sb.from("crm_notifications").upsert({ user_id: to.id, kind: "collaborador", title: `Missatge del col·laborador ${me.name}`, body: b.subject, link: { view: "tasques", params: { id: ins.data.id } }, rule_key: `portal_msg:${ins.data.id}` }, { onConflict: "user_id,rule_key", ignoreDuplicates: true });
  await audit(u, "cap_partners", me.id, "missatge_portal", { tasca: ins.data.id });
  return { ok: true };
}

export const PORTAL_CONSENT = "El col·laborador declara que el client l'ha autoritzat a facilitar les seves dades i la factura a Assessoria 3.0 per estudiar el subministrament, i que l'ha informat de la política de privacitat.";
