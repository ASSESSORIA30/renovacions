import "server-only";
/**
 * INFORMES AUTOMÀTICS (Fase 7) · servidor.
 * Cada informe es construeix amb la sessió de qui el demana (RLS) i dins del seu abast:
 *   Direcció → global · Cap administrativa → administratiu · Comercial → els seus resultats · Col·laborador → les seves operacions.
 * Enviament programat: només a destinataris interns configurats per Direcció i només si hi ha SMTP; si no, queda
 * registrat com a «pendent_smtp» (no es marca mai com a enviat sense confirmació del servidor de correu).
 */
import { z } from "zod";
import { KPI, periodRange, type PeriodKey } from "@/core/control";
import { buildReportPdf, type ReportSection } from "@/core/report-pdf";
import { HttpError, adminClient } from "./supabase";
import { finStaff, hasPerm } from "./permissions";
import type { U } from "./crm";

export const REPORT_KINDS = { diari: { label: "Informe diari", period: "avui" }, setmanal: { label: "Informe setmanal", period: "setmana" }, mensual: { label: "Informe mensual", period: "mes" } } as const;
export type ReportKind = keyof typeof REPORT_KINDS;
const n = (v: number | null | undefined, unit = "n") => (v == null ? "sense dades" : unit === "eur" ? v.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }) : unit === "pct" ? `${v.toLocaleString("ca-ES")} %` : unit === "mwh" ? `${v.toLocaleString("ca-ES")} MWh` : v.toLocaleString("ca-ES"));
const kpi = (k: Record<string, unknown>, id: string) => ({ label: KPI[id]?.label ?? id, value: n(k[id] as number | null, KPI[id]?.unit) });
const INC: Record<string, string> = { oberta: "Oberta", en_curs: "En curs", esperant_tercers: "Esperant tercers", resolta: "Resolta", tancada: "Tancada" };
const PRIO: Record<string, string> = { urgent: "Urgent", alta: "Alta", mitjana: "Mitjana", baixa: "Baixa" };
const KST: Record<string, string> = { actiu: "Actiu", renovacio_pendent: "Renovació pendent" };
const dmy = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("ca-ES", { day: "2-digit", month: "long", year: "numeric" });

/** Contingut de l'informe segons el rol (dades reals; res inventat). */
export async function reportData(u: U, kind: ReportKind, now = new Date()) {
  const period = REPORT_KINDS[kind].period as PeriodKey;
  const range = periodRange(period, now);
  const role = u.profile.role;
  const sections: ReportSection[] = [];
  let scope = "";
  if (role === "colaborador") {
    const { portalData } = await import("./partners");
    const p = await portalData(u);
    scope = `Col·laborador · ${p.partner.name}`;
    sections.push({ type: "kpis", title: "Les teves operacions", items: [
      { label: "Clients aportats", value: n(p.kpis.clients) }, { label: "Leads pendents", value: n(p.kpis.leadsPending) }, { label: "En tramitació", value: n(p.kpis.inProgress) }, { label: "Contractes activats", value: n(p.kpis.activated) },
      { label: "Comissions estimades (previsió)", value: n(p.kpis.commissionsEstimated, "eur") }, { label: "Comissions meritades", value: n(p.kpis.commissionsAccrued, "eur") }, { label: "Liquidat (aprovat)", value: n(p.kpis.commissionsSettled, "eur") }, { label: "Pagament pendent", value: n(p.kpis.paymentsPending, "eur") },
    ] });
    sections.push({ type: "table", title: "Clients i estat", head: ["Client", "Data", "Estat"], rows: p.leads.slice(0, 60).map((l) => [l.name, l.created_at.slice(0, 10), l.stage]) });
    return { title: `${REPORT_KINDS[kind].label} · col·laborador`, range, scope, sections };
  }
  if (role === "comercial") {
    const { commercialPanel } = await import("./control");
    const c = await commercialPanel(u, now);
    scope = `Comercial · ${u.profile.name} (només dades pròpies)`;
    sections.push({ type: "kpis", title: "Resultats comercials propis", items: [
      { label: "Leads assignats", value: n(c.kpis.leads) }, { label: "Oportunitats obertes", value: n(c.kpis.oportunitats) }, { label: "Propostes pendents", value: n(c.kpis.propostesPendents) }, { label: "Tasques obertes", value: n(c.kpis.tasques) },
      { label: "Contractes del mes", value: n(c.kpis.contractesMes) }, { label: "MWh del mes", value: n(c.kpis.mwhMes, "mwh") }, { label: "Comissions meritades (mes)", value: n(c.commissions?.accrued ?? null, "eur") }, { label: "Comissions pendents de liquidar", value: n(c.commissions?.pending ?? null, "eur") },
    ] });
    sections.push({ type: "table", title: "Objectius del mes", head: ["Objectiu", "Fet", "Meta"], rows: c.targets.map((t) => [t.metric, String(t.actual ?? "—"), String(t.target)]), empty: "Sense objectius definits per a aquest mes." });
    sections.push({ type: "table", title: "Evolució (12 mesos)", head: ["Mes", "Contractes", "Guanyades", "MWh"], rows: c.series.map((s) => [s.month, s.contractes, s.guanyades, s.mwh]), align: ["left", "right", "right", "right"] });
    return { title: `${REPORT_KINDS[kind].label} · comercial`, range, scope, sections };
  }
  if (!(await hasPerm(u, "informes"))) throw new HttpError(403, "No tens accés als informes");
  const { loadOps, productivityReport } = await import("./control");
  const { operationalKpis, commercialSeries } = await import("@/core/control");
  const o = await loadOps(u, now);
  const k = operationalKpis({ now, range, ...o }) as unknown as Record<string, unknown>;
  const global = role === "admin";
  scope = global ? "Direcció · informe global" : `${role === "cap_administrativa" ? "Cap administrativa" : "Administració"} · informe administratiu`;
  if (global || kind !== "mensual") {
    sections.push({ type: "kpis", title: kind === "diari" ? "Contractes i activitat del dia" : "Resultats del període", items: ["contractes_periode", "activats", "anullats", "mwh", "leads", "propostes", "conversio", "oportunitats"].filter((id) => global || !["conversio", "oportunitats"].includes(id)).map((id) => kpi(k, id)) });
  }
  sections.push({ type: "kpis", title: "Administració", items: ["expedients_pendents", "tramitacio", "documentacio_incompleta", "bloquejats", "renovacions_urgents", "renovacions_120", "incidencies_obertes", "incidencies_urgents", "tasques_pendents", "tasques_vencudes", "tasques_bloquejades", "contractes_introduits_avui"].map((id) => kpi(k, id)) });
  const t0 = now.toISOString().slice(0, 10), in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  sections.push({ type: "table", title: "Renovacions dels propers 30 dies", head: ["Comercialitzadora", "Venciment", "Estat"], rows: o.contracts.filter((c) => ["actiu", "renovacio_pendent"].includes(c.status) && c.end_date && c.end_date >= t0 && c.end_date <= in30).sort((a, b) => a.end_date!.localeCompare(b.end_date!)).slice(0, 40).map((c) => [c.retailer, c.end_date!, KST[c.status] ?? c.status]), empty: "Cap renovació en els propers 30 dies." });
  sections.push({ type: "table", title: "Incidències obertes", head: ["Incidència", "Prioritat", "Estat", "Oberta"], rows: o.incidents.filter((i) => !["resolta", "tancada"].includes(i.status)).slice(0, 40).map((i) => [i.title ?? "—", PRIO[i.priority] ?? i.priority, INC[i.status] ?? i.status, i.opened_at.slice(0, 10)]), empty: "Cap incidència oberta." });
  const prod = await productivityReport(u, { period, from: range.from, to: range.to }, now).catch(() => null);
  if (prod?.rows.length) sections.push({ type: "table", title: global ? "Activitat de l'equip" : "Activitat de l'equip administratiu", head: ["Persona", "Contractes", "Activats", "Expedients", "Tasques fetes", "Pendents", "Incidències", "Leads", "Propostes"], rows: prod.rows.map((r) => [r.name, r.contractes_introduits, r.contractes_activats, r.expedients_tramitats, r.tasques_finalitzades, r.tasques_pendents, r.incidencies_resoltes, r.leads_treballats, r.propostes_enviades]), align: ["left", "right", "right", "right", "right", "right", "right", "right", "right"] });
  if (kind !== "diari" && global) sections.push({ type: "table", title: "Evolució de la cartera (12 mesos)", head: ["Mes", "Contractes", "MWh", "Leads", "Propostes"], rows: commercialSeries(now, o.contracts, o.leads, o.opps).map((s) => [s.month, s.contractes, s.mwh, s.leads, s.propostes]), align: ["left", "right", "right", "right", "right"] });
  if (kind === "mensual" && (await finStaff(u))) {
    const fin = await import("./finance");
    const d = await fin.dashboard(u, { from: range.from, to: range.to }).catch(() => null);
    if (d) {
      const e = d.kpis;
      sections.push({ type: "kpis", title: "Comissions, liquidacions i rendibilitat", items: [
        { label: "Comissions previstes", value: n(Number(e.estimated), "eur"), note: "previsió" }, { label: "Comissions meritades", value: n(Number(e.accrued), "eur") }, { label: "Comissions confirmades", value: n(Number(e.confirmed), "eur") }, { label: "Comissions cobrades", value: n(Number(e.collected), "eur") },
        { label: "Pendent de cobrar", value: n(Number(e.pending), "eur") }, { label: "Pagaments a l'equip", value: n(Number(e.payoutsComercial) + Number(e.payoutsCollab), "eur") }, { label: "Marge realitzat", value: n(Number(e.marginRealized), "eur") }, { label: "Costos", value: n(Number(e.costs), "eur") },
      ] });
      sections.push({ type: "table", title: "Comissions pendents de liquidar per persona", head: ["Persona", "Tipus", "Moviments", "Import"], rows: d.unsettled.slice(0, 30).map((g) => [g.name ?? "—", g.layer === "collaborador" ? "Col·laborador" : "Comercial", g.count, n(Number(g.amount), "eur")]), align: ["left", "left", "right", "right"], empty: "No hi ha comissions pendents de liquidar." });
    }
  }
  return { title: `${REPORT_KINDS[kind].label}${global ? "" : " · administració"}`, range, scope, sections };
}

export async function reportPdf(u: U, kindRaw: string, now = new Date()) {
  const kind = z.enum(["diari", "setmanal", "mensual"]).parse(kindRaw);
  const r = await reportData(u, kind, now);
  const bytes = buildReportPdf({
    title: r.title, subtitle: r.range.from === r.range.to ? dmy(r.range.from) : `${dmy(r.range.from)} – ${dmy(r.range.to)}`, scope: r.scope, sections: r.sections,
    generatedBy: u.profile.name, generatedAt: now,
    footnote: "Indicadors calculats amb les definicions documentades del Centre de Control. Les comissions «previstes» són estimacions; només les cobrades són ingressos reals. Informe generat amb els permisos de qui el descarrega.",
  });
  return { bytes, filename: `assessoria30-${kind}-${r.range.from}.pdf` };
}

const periodKey = (kind: ReportKind, now: Date) => {
  if (kind === "diari") return now.toISOString().slice(0, 10);
  if (kind === "mensual") return now.toISOString().slice(0, 7);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
  const w1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round(((d.getTime() - w1.getTime()) / 86_400_000 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`;
};

/**
 * Enviament programat (cron diari). Genera cada informe amb els permisos del destinatari (mai més abast del que té)
 * i l'envia per SMTP. Idempotent per destinatari i període (report_runs).
 */
export async function sendScheduledReports(now = new Date()) {
  const sb = adminClient();
  const cfg = await sb.from("sec_settings").select("value").eq("key", "reports").maybeSingle();
  if (cfg.error) return { skipped: "Falta la migració 014" };
  const v = (cfg.data?.value ?? {}) as Partial<Record<ReportKind, string[]>>;
  const due: ReportKind[] = ["diari", ...(now.getUTCDay() === 1 ? ["setmanal" as const] : []), ...(now.getUTCDate() === 1 ? ["mensual" as const] : [])];
  const { smtpReady, sendCorporateMail } = await import("./mailer");
  const smtp = await smtpReady().catch(() => false);
  const out: { kind: string; recipient: string; status: string }[] = [];
  for (const kind of due) {
    // l'informe setmanal i mensual es refereixen al període tancat anterior
    const ref = kind === "diari" ? new Date(now.getTime() - 86_400_000) : kind === "setmanal" ? new Date(now.getTime() - 7 * 86_400_000) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const key = periodKey(kind, ref);
    for (const id of v[kind] ?? []) {
      const prev = await sb.from("report_runs").select("status").eq("kind", kind).eq("period_key", key).eq("recipient_id", id).maybeSingle();
      if (prev.data?.status === "enviat") continue;
      const { data: p } = await sb.from("profiles").select("id,name,email,role").eq("id", id).maybeSingle();
      if (!p || ["colaborador", "comercial"].includes(p.role)) continue;
      let status = "pendent_smtp", error: string | null = null;
      if (smtp) {
        try {
          // es construeix amb un client de servei limitat a l'abast del destinatari: Direcció → global; la resta → informe administratiu
          const fake = { sb, user: { id: p.id }, profile: { id: p.id, name: p.name, email: p.email, role: p.role, code: null } } as unknown as U;
          const r = await reportPdf(fake, kind, ref);
          await sendCorporateMail({ to: p.email, subject: `${REPORT_KINDS[kind].label} · Assessoria 3.0 (${key})`, text: "Adjuntem l'informe intern generat automàticament pel CRM.", attachments: [{ filename: r.filename, content: Buffer.from(r.bytes) }] });
          status = "enviat";
        } catch (e) { status = "error"; error = (e instanceof Error ? e.message : String(e)).slice(0, 300); }
      }
      await sb.from("report_runs").upsert({ kind, period_key: key, recipient_id: id, status, error, at: new Date().toISOString() }, { onConflict: "kind,period_key,recipient_id" });
      out.push({ kind, recipient: p.name, status });
    }
  }
  return { sent: out.filter((x) => x.status === "enviat").length, pending: out.filter((x) => x.status !== "enviat").length, detail: out };
}
