"use client";
/**
 * Fitxa d'una oportunitat detectada: per què s'ha detectat (evidències i fonts), puntuació explicada, comparador integrat
 * (preu actual vs 3 alternatives), escenari SAS, costos únics, hipòtesis, economia estimada i generador de propostes.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, BadgeCheck, Ban, BrainCircuit, Building2, Check, CheckCircle2, ExternalLink, FileDown, FileSignature, Handshake, Info, Loader2, Mail, RefreshCw, Send, ShieldOff, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert, Wallet,
} from "lucide-react";
import { useApp } from "@/data/store";
import { AI_KIND_LABEL, AI_STATUS_LABEL, DRAFT_STATUS_LABEL, PENDING_PRICE, PROPOSAL_MESSAGE, type Alternative } from "@/core/intelligence";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { aiApi, eur, fdate, type Detail, type Draft, type Econ } from "./api";
import { KIND_ICON, KIND_TONE, ScoreDot } from "./Center";

export function IaOpportunityView() {
  const id = useApp((s) => s.params.id);
  const go = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [sendDraft, setSendDraft] = useState<Draft | null>(null);
  const load = useCallback(async () => { if (!id) return; try { setD(await aiApi.get<Detail>("opportunity", { id })); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { const r = await fn(); toast({ title: ok, tone: "ok" }); await load(); return r; }
    catch (e) { toast({ title: "No s'ha pogut completar", body: e instanceof Error ? e.message : String(e), tone: "err" }); return null; }
    finally { setBusy(null); }
  };
  if (err) return <div className="mx-auto max-w-4xl px-4 py-6"><Notice tone="red">{err}</Notice></div>;
  if (!d) return <div className="mx-auto max-w-[1300px] space-y-3 px-4 py-6">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-elevated" />)}</div>;
  const o = d.opportunity;
  const rec = d.recommendation;
  const Icon = KIND_ICON[o.kind];
  const closed = ["descartada", "guanyada", "caducada"].includes(o.status);
  const openDraft = d.drafts.find((x) => ["esborrany", "aprovada", "enviada"].includes(x.status));
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <button className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" onClick={() => go("ia", {})}><ArrowLeft size={14} /> Intel·ligència IA</button>
      <header className="flex flex-wrap items-start gap-4 rounded-2xl border border-line bg-surface p-4">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", KIND_TONE[o.kind])}><Icon size={21} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5"><Badge tone="zinc">{AI_KIND_LABEL[o.kind]}</Badge><Badge tone={o.status === "nova" ? "blue" : closed ? "zinc" : "green"}>{AI_STATUS_LABEL[o.status as keyof typeof AI_STATUS_LABEL] ?? o.status}</Badge>{!o.contact_allowed && <Badge tone="red"><ShieldOff size={10} /> Oposició comercial / no contactar</Badge>}</div>
          <h2 className="mt-1 text-[19px] font-semibold tracking-tight">{o.title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{o.summary}</p>
          {o.status_reason && <p className="mt-1 text-[12px] text-muted">Motiu: {o.status_reason}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            {o.crm_clients && <button className="inline-flex items-center gap-1 hover:text-brand" onClick={() => go("client", { id: o.crm_clients!.id })}><Building2 size={12} /> {o.crm_clients.name}</button>}
            {o.crm_supplies && <span className="font-mono">{o.crm_supplies.cups}</span>}
            {o.crm_supplies?.access_tariff && <span>{o.crm_supplies.access_tariff}</span>}
            {o.crm_contracts && <span>{o.crm_contracts.retailer}{o.crm_contracts.end_date ? ` · venç ${fdate(o.crm_contracts.end_date)}` : ""}</span>}
            {o.crm_opportunity_id && <button className="inline-flex items-center gap-1 text-brand" onClick={() => go("oportunitat", { id: o.crm_opportunity_id! })}><Handshake size={12} /> Oportunitat comercial</button>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ScoreDot score={o.score} size={52} />
          <span className="text-[10.5px] text-muted">Prioritat de servei</span>
        </div>
      </header>

      {d.canEdit && !closed && (
        <div className="flex flex-wrap gap-2">
          {o.client_id && !o.crm_opportunity_id && <Button variant="primary" size="sm" disabled={!!busy} onClick={() => void act("accept", async () => { const r = await aiApi.act<{ crmOpportunityId: string }>("accept", { id: o.id }); go("oportunitat", { id: r.crmOpportunityId }); }, "Oportunitat comercial creada")}>{busy === "accept" ? <Loader2 size={13} className="animate-spin" /> : <Handshake size={13} />} Accepta i crea l&apos;oportunitat comercial</Button>}
          {rec?.alternatives.length ? <Button size="sm" disabled={!!busy || !!(openDraft && openDraft.status === "esborrany")} onClick={() => void act("prepare", () => aiApi.act("prepare", { id: o.id }), "Esborrany de proposta desat a la fitxa del client")}>{busy === "prepare" ? <Loader2 size={13} className="animate-spin" /> : <FileSignature size={13} />} Prepara la proposta (PDF)</Button> : null}
          {o.client_id && <Button size="sm" disabled={!!busy} onClick={() => void act("analyse", () => aiApi.act("analyse", { clientId: o.client_id }), "Client tornat a analitzar")}>{busy === "analyse" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Torna a analitzar</Button>}
          {o.status === "nova" && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act("rev", () => aiApi.act("status", { id: o.id, status: "revisada" }), "Marcada com a revisada")}><Check size={13} /> Marca com a revisada</Button>}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setDiscard(true)}><Ban size={13} /> Descarta</Button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Comparator d={d} />
          <Drafts d={d} busy={busy} act={act} onSend={setSendDraft} />
        </div>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="text-[13px] font-semibold">Per què s&apos;ha detectat</h3>
            <ul className="mt-2 space-y-2">{o.evidence.map((e, i) => (
              <li key={i} className="text-[12.5px]"><p className="text-muted">{e.label}</p><p className="font-medium">{e.value}</p><p className="text-[11px] text-muted">Font: {e.source}{e.date ? ` · ${fdate(e.date)}` : ""}</p></li>
            ))}</ul>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="flex items-center justify-between text-[13px] font-semibold">Puntuació explicada <span className="text-[18px] tnum">{o.score}<span className="text-[11px] text-muted">/100</span></span></h3>
            <ul className="mt-2 space-y-2">{o.score_factors.map((f) => (
              <li key={f.key} className="text-[12px]">
                <div className="flex items-center justify-between"><span>{f.label}</span><span className="tnum text-muted">{f.points.toFixed(1)} pts</span></div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]"><div className="h-full rounded-full bg-brand" style={{ width: `${f.value * 100}%` }} /></div>
                <p className="mt-0.5 text-[11px] text-muted">{f.explanation} · pes {f.weight}</p>
              </li>
            ))}</ul>
          </section>
          <Economics econ={d.economics} saving={o.saving_status === "estimat" ? o.potential_saving_eur : null} internal={d.canSeeInternal} bv={o.business_value} />
          {d.tariffSnapshot && <p className="px-1 text-[11px] text-muted">Catàleg usat: instantània del {fdate(d.tariffSnapshot.as_of)} ({d.tariffSnapshot.offer_count} tarifes, {d.tariffSnapshot.sha256.slice(0, 10)}…). L&apos;anàlisi és reproduïble.</p>}
        </aside>
      </div>
      <DiscardDialog open={discard} onClose={() => setDiscard(false)} onConfirm={(reason) => void act("discard", () => aiApi.act("status", { id: o.id, status: "descartada", reason }), "Oportunitat descartada").then(() => setDiscard(false))} />
      {sendDraft && <SendDialog draft={sendDraft} clientName={o.crm_clients?.name ?? ""} optOut={!o.contact_allowed} onClose={() => setSendDraft(null)} onSent={() => { setSendDraft(null); void load(); }} />}
    </div>
  );
}

function Comparator({ d }: { d: Detail }) {
  const rec = d.recommendation;
  if (!rec) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-[14px] font-semibold">Comparador</h3>
        <p className="mt-1 text-[12.5px] text-muted">{d.opportunity.kind === "dades_incompletes" ? "Completa les dades del subministrament per poder comparar." : "Aquest tipus d'oportunitat no requereix comparativa o encara no hi ha dades suficients."}</p>
      </section>
    );
  }
  const cur = rec.current_cost;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Sparkles size={15} className="text-brand" /> Comparador · 3 alternatives per cost anual</h3>
        <span className="text-[11px] text-muted">Calculat el {fdate(rec.created_at)} · motor {rec.engine_version}</span>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-dashed border-line p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Situació actual</p>
          <p className="mt-1 text-[13px] font-semibold">{rec.inputs.currentRetailer ?? "Comercialitzadora desconeguda"}</p>
          {cur?.known ? <>
            <p className="mt-2 text-[20px] font-semibold tnum">{eur(cur.annualCost, 0)}<span className="text-[11px] font-normal text-muted">/any</span></p>
            <p className="mt-1 text-[11px] text-muted">Font: {cur.source}{cur.date ? ` · ${fdate(cur.date)}` : ""}</p>
          </> : <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-[12px] font-medium text-amber-800 dark:text-amber-200">{PENDING_PRICE}</p>}
          {rec.inputs.supply && <p className="mt-2 text-[11px] text-muted">{Math.round(rec.inputs.supply.kwhTotal ?? 0).toLocaleString("ca-ES")} kWh/any · {rec.inputs.supply.accessTariff}</p>}
        </div>
        {rec.alternatives.map((a) => <AltCard key={a.offerId} a={a} />)}
      </div>
      {rec.sas_scenario?.length ? (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-[12px]">
          <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200"><TriangleAlert size={13} /> Escenari de sensibilitat SAS · no és un cost regulat confirmat</p>
          {rec.sas_scenario.map((s) => <p key={s.offerId} className="mt-1">{s.retailer}: +{s.minEurKwh}–{s.maxEurKwh} €/kWh → +{eur(s.extraMinEur)} a +{eur(s.extraMaxEur)}/any · cost anual {eur(s.totalMinEur, 0)}–{eur(s.totalMaxEur, 0)}. <span className="text-muted">{s.justification} Font: {s.source} ({fdate(s.asOf)}).</span></p>)}
        </div>
      ) : null}
      {rec.one_off_costs.length > 0 && (
        <div className="mt-3 rounded-xl bg-elevated p-3 text-[12px]"><p className="font-semibold">Costos únics (no recurrents)</p>{rec.one_off_costs.map((c, i) => <p key={i} className="mt-0.5">{c.concept}: <b>{c.amount != null ? eur(c.amount) : "pendent"}</b> · <span className="text-muted">{c.note}</span></p>)}</div>
      )}
      <details className="mt-3 text-[12px]">
        <summary className="cursor-pointer font-medium">Hipòtesis i dades que falten</summary>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted">{rec.hypotheses.map((h, i) => <li key={i}>{h}</li>)}</ul>
        {rec.missing.length > 0 && <p className="mt-1.5 text-amber-700">Falta: {rec.missing.join(", ")}</p>}
      </details>
      {rec.narrative && <p className="mt-3 rounded-xl bg-brand/[0.06] p-3 text-[12.5px]"><BrainCircuit size={13} className="mr-1 inline text-brand" />{rec.narrative} <span className="text-[11px] text-muted">({rec.narrative_source === "ia" ? "redactat per IA amb números verificats" : "text generat amb plantilla"})</span></p>}
    </section>
  );
}

function AltCard({ a }: { a: Alternative }) {
  return (
    <div className={cn("rounded-xl border p-3", a.rank === 1 ? "border-brand/50 bg-brand/[0.04]" : "border-line")}>
      <div className="flex items-center justify-between"><span className="text-[11px] font-medium uppercase tracking-wide text-muted">Opció {a.rank}</span>{a.rank === 1 && <Badge tone="green"><BadgeCheck size={10} /> Més econòmica</Badge>}</div>
      <p className="mt-1 truncate text-[13px] font-semibold" title={`${a.supplier} · ${a.product}`}>{a.supplier}</p>
      <p className="truncate text-[11.5px] text-muted">{a.product} · v{a.version}</p>
      <p className="mt-2 text-[20px] font-semibold tnum">{eur(a.annualCost, 0)}<span className="text-[11px] font-normal text-muted">/any</span></p>
      <p className={cn("text-[12px] font-medium tnum", a.saving != null && a.saving > 0 ? "text-ren" : "text-muted")}>{a.saving != null ? `${a.saving > 0 ? "Estalvi estimat" : "Sense estalvi"}: ${eur(Math.abs(a.saving), 0)}${a.savingPct != null ? ` (${a.savingPct} %)` : ""}` : PENDING_PRICE}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 text-[11px] text-muted">
        <dt>Energia</dt><dd className="text-right tnum">{eur(a.recurring.energy, 0)}</dd>
        <dt>Potència</dt><dd className="text-right tnum">{eur(a.recurring.power, 0)}</dd>
        {a.recurring.sas > 0 && <><dt>SAS (estimat)</dt><dd className="text-right tnum">{eur(a.recurring.sas, 0)}</dd></>}
        {a.recurring.fixed > 0 && <><dt>Quotes</dt><dd className="text-right tnum">{eur(a.recurring.fixed, 0)}</dd></>}
        {a.recurring.discounts > 0 && <><dt>Descomptes</dt><dd className="text-right tnum">−{eur(a.recurring.discounts, 0)}</dd></>}
        <dt>Impostos</dt><dd className="text-right tnum">{eur(a.recurring.taxes, 0)}</dd>
      </dl>
      <p className="mt-1.5 text-[11px]"><span className="text-muted">SAS:</span> {a.sas.label}</p>
      <ul className="mt-1.5 space-y-0.5 text-[11px]">{a.reasons.slice(0, 4).map((r, i) => <li key={i} className="flex gap-1"><CheckCircle2 size={11} className="mt-[2px] shrink-0 text-brand" />{r}</li>)}</ul>
      <p className="mt-1.5 text-[10.5px] text-muted">Vàlida {a.validTo ? `fins al ${fdate(a.validTo)}` : "sense data de fi"} · {a.source ?? "Catàleg"}</p>
    </div>
  );
}

function Economics({ econ, saving, internal, bv }: { econ: Econ[]; saving: string | null; internal: boolean; bv: number | null }) {
  const by = (l: Econ["layer"]) => econ.find((e) => e.layer === l);
  const ST: Record<string, string> = { estimat: "Estimat", simulacio: "Simulació (regla no aprovada)", pendent_configuracio: "Pendent de configuració", pendent_dades: "Pendent de dades", sense_regla: "Sense regla" };
  const row = (label: string, e: Econ | undefined, hint?: string) => e ? (
    <li className="flex items-start justify-between gap-2 text-[12px]" title={e.formula ?? undefined}><span>{label}{hint && <span className="block text-[10.5px] text-muted">{hint}</span>}<span className="block text-[10.5px] text-muted">{ST[e.status] ?? e.status}{e.rule_ref ? ` · ${e.rule_ref.rule_key} v${e.rule_ref.version}` : ""}</span></span><span className="font-medium tnum">{e.amount != null ? eur(e.amount) : "—"}</span></li>
  ) : null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold"><Wallet size={14} /> Benefici i economia</h3>
      <ul className="mt-2 space-y-2">
        <li className="flex items-start justify-between text-[12px]"><span>Estalvi per al client<span className="block text-[10.5px] text-muted">Estimat, no garantit</span></span><span className="font-semibold text-ren tnum">{saving != null ? eur(saving) : "—"}</span></li>
        {row("Comissió potencial Assessoria 3.0", by("proveidor"))}
        {row("Comissió comercial", by("comercial"))}
        {row("Marge previst", by("marge"), "Sense costos ni col·laboradors")}
      </ul>
      {econ.length > 0 && <p className="mt-2 flex items-center gap-1 text-[11px] text-muted"><Info size={11} /> Estat de cobrament: no meritat. Res d&apos;això és un ingrés confirmat.</p>}
      {internal && bv != null && <p className="mt-1 text-[11px] text-muted">Rendibilitat interna: {bv}/100 (indicador separat; no altera la prioritat ni l&apos;ordre de les alternatives).</p>}
      {!econ.length && <p className="mt-2 text-[11.5px] text-muted">Sense dades econòmiques visibles per al teu rol.</p>}
    </section>
  );
}

function Drafts({ d, busy, act, onSend }: { d: Detail; busy: string | null; act: (k: string, fn: () => Promise<unknown>, ok: string) => Promise<unknown>; onSend: (x: Draft) => void }) {
  const go = useApp((s) => s.navigate);
  const open = async (id: string) => { try { const r = await aiApi.get<{ url: string }>("pdf", { id }); window.open(r.url, "_blank", "noopener"); } catch (e) { alertErr(e); } };
  const alertErr = (e: unknown) => useApp.getState().toast({ title: "No s'ha pogut obrir", body: e instanceof Error ? e.message : String(e), tone: "err" });
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold"><FileSignature size={15} /> Generador de propostes</h3>
      <p className="mt-0.5 text-[12px] text-muted">El PDF es desa a la fitxa documental del client com a <b>esborrany</b>. Cal aprovar-lo abans d&apos;enviar-lo; l&apos;enviament només consta si el servidor de correu el confirma.</p>
      <p className="mt-1 text-[11.5px] italic text-muted">«{PROPOSAL_MESSAGE}»</p>
      {!d.drafts.length ? <Empty icon={<FileSignature size={20} />} title="Encara no hi ha cap proposta" body={d.recommendation?.alternatives.length ? "Prepara-la amb el botó «Prepara la proposta (PDF)»." : "Cal una comparativa amb alternatives vigents."} />
        : <ul className="mt-3 divide-y divide-line">{d.drafts.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <Badge tone={x.status === "esborrany" ? "amber" : x.status === "aprovada" ? "blue" : x.status === "enviada" || x.status === "acceptada" ? "green" : "zinc"}>{DRAFT_STATUS_LABEL[x.status as keyof typeof DRAFT_STATUS_LABEL] ?? x.status}</Badge>
            <span className="text-[12.5px]">Proposta del {fdate(x.created_at)} · vàlida fins al {fdate(x.valid_until)}{x.sent_at ? ` · enviada ${fdate(x.sent_at)}` : ""}</span>
            <span className="ml-auto flex flex-wrap gap-1.5">
              {x.document_id && <Button size="sm" variant="ghost" onClick={() => void open(x.id)}><FileDown size={13} /> PDF</Button>}
              {x.comparison_id && <Button size="sm" variant="ghost" onClick={() => go("comparatives", { id: x.comparison_id! })}><ExternalLink size={13} /> Comparativa</Button>}
              {d.canEdit && x.status === "esborrany" && <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void act("approve", () => aiApi.act("draft", { id: x.id, decision: "aprova" }), "Proposta aprovada")}><BadgeCheck size={13} /> Aprova</Button>}
              {d.canEdit && x.status === "aprovada" && <Button size="sm" variant="primary" disabled={!!busy} onClick={() => onSend(x)}><Mail size={13} /> Envia per correu</Button>}
              {d.canEdit && (x.status === "aprovada" || x.status === "enviada") && <>
                <Button size="sm" variant="success" disabled={!!busy} onClick={() => void act("acc", async () => { const r = await aiApi.act<{ crmOpportunityId?: string }>("draft", { id: x.id, decision: "acceptada" }); if (r.crmOpportunityId) go("oportunitat", { id: r.crmOpportunityId }); }, "Proposta acceptada: continua a l'oportunitat i obre l'expedient")}><ThumbsUp size={13} /> Acceptada</Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act("rej", () => aiApi.act("draft", { id: x.id, decision: "rebutjada" }), "Resposta registrada")}><ThumbsDown size={13} /> Rebutjada</Button>
              </>}
              {d.canEdit && x.status === "esborrany" && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act("anul", () => aiApi.act("draft", { id: x.id, decision: "anulla" }), "Esborrany anul·lat")}>Anul·la</Button>}
            </span>
          </li>
        ))}</ul>}
    </section>
  );
}

function DiscardDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Descartar l'oportunitat" footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>Descarta</Button></>}>
      <label className="block text-[12.5px]">Motiu (obligatori)<textarea className="input mt-1 min-h-[80px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="P. ex. el client ha renovat directament, no li interessa…" /></label>
    </Modal>
  );
}

function SendDialog({ draft, clientName, optOut, onClose, onSent }: { draft: Draft; clientName: string; optOut: boolean; onClose: () => void; onSent: () => void }) {
  const toast = useApp((s) => s.toast);
  const me = useApp((s) => s.snap!.me);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(`Proposta de subministrament · ${clientName}`);
  const [body, setBody] = useState(`Bon dia,\n\nUs adjuntem la proposta amb les tres alternatives que hem calculat amb les tarifes vigents. Els imports són estimats segons les hipòtesis indicades al document.\n\n${PROPOSAL_MESSAGE}\n\nCordialment,\n${me.name}\nAssessoria 3.0`);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await aiApi.act("send", { id: draft.id, to, subject, body, confirmed: true }); toast({ title: "Proposta enviada", body: "El servidor de correu ha confirmat l'enviament.", tone: "ok" }); onSent(); }
    catch (e) { toast({ title: "No s'ha enviat", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Enviar la proposta per correu" width="max-w-xl" footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!ok || busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)} onClick={send}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Envia</Button></>}>
      <div className="space-y-2">
        {optOut && <Notice tone="red">Aquest client té registrada una oposició comercial o «no contactar». Envia-la només si te l&apos;ha demanat expressament.</Notice>}
        <label className="block text-[12.5px]">Destinatari<input className="input mt-1 h-9" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="correu@client.cat" /></label>
        <label className="block text-[12.5px]">Assumpte<input className="input mt-1 h-9" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label className="block text-[12.5px]">Missatge<textarea className="input mt-1 min-h-[160px] py-2" value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> He revisat la proposta i el destinatari</label>
      </div>
    </Modal>
  );
}
