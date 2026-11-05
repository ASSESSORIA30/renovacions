"use client";
/** FITXA D'OPORTUNITAT: etapes, dades comercials, accions (client, CUPS, comparativa, factures, enviament, contracte) i historial. */
import { DropArea } from "../../components/DropZone";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Building2, Check, CheckCircle2, Circle, ClipboardList, FilePlus2, FileSignature, FileStack, Gauge, Loader2, Lock, Pencil, Send, Sparkles, Trophy, UserCheck, Zap } from "lucide-react";
import { CONTRACT_STATUS_LABEL, PRIORITY_LABEL } from "@/core/crm";
import { EXP_STATUS_LABEL, type ExpStatus } from "@/core/contracting";
import { CALL_OUTCOME_LABEL, ENERGY_SERVICES, LOST_REASONS, STAGES, STAGE_COLOR, STAGE_LABEL, TASK_KIND_LABEL, daysSince, type Stage } from "@/core/sales";
import { fmtDateTime } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { ApiError, crmApi, uploadDocument } from "../crm/api";
import { NewExpedientWizard } from "../contracting/shared";
import { salesApi, eur, mwh, type OppDetail } from "./api";
import { Avatar, LogActivity, OppForm, ServiceChip, StagePill, TaskForm } from "./shared";

export function OpportunityView() {
  const id = useApp((s) => s.params.id) ?? "";
  const [d, setD] = useState<OppDetail | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [edit, setEdit] = useState(false);
  const [task, setTask] = useState<null | { title?: string; kind?: "trucada" | "seguiment" | "tramitacio" | "reunio" }>(null);
  const [convert, setConvert] = useState(false);
  const [lose, setLose] = useState(false);
  const [sent, setSent] = useState(false);
  const [expedient, setExpedient] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useApp((s) => s.toast);

  const load = useCallback(async () => {
    try { setD(await salesApi.opp(id)); setError(null); } catch (e) { setError({ status: e instanceof ApiError ? e.status : 500, message: e instanceof Error ? e.message : String(e) }); }
  }, [id]);
  useEffect(() => { setD(null); if (id) void load(); }, [id, load]);

  if (error) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<Lock size={26} />} title="No pots veure aquesta oportunitat" body={error.message} action={<Button size="sm" onClick={() => useApp.getState().navigate("pipeline")}><ArrowLeft size={13} /> Oportunitats</Button>} /></div>;
  if (!d) return <div className="mx-auto max-w-[1300px] space-y-3 px-4 py-5 sm:px-6"><div className="h-40 animate-pulse rounded-2xl bg-elevated" /><div className="h-72 animate-pulse rounded-2xl bg-elevated" /></div>;

  const o = d.opportunity;
  const closed = o.stage === "guanyat" || o.stage === "perdut";
  const idle = daysSince(o.last_activity_at) ?? 0;
  const go = (view: Parameters<ReturnType<typeof useApp.getState>["navigate"]>[0], params: Record<string, string> = {}) => useApp.getState().navigate(view, params);

  const move = async (stage: Stage, lost_reason?: string) => {
    if (stage === o.stage) return;
    if (stage === "perdut" && !lost_reason) { setLose(true); return; }
    setBusy("Movent…");
    try { await salesApi.opp_("move", { id: o.id, data: { stage, version: o.version, lost_reason: lost_reason ?? null } }); toast({ title: `Etapa: ${STAGE_LABEL[stage]}`, tone: "ok" }); await load(); }
    catch (e) { toast({ title: "No s'ha pogut canviar l'etapa", body: e instanceof Error ? e.message : String(e), tone: "err" }); await load(); } finally { setBusy(null); }
  };
  const ensureClient = (): string | null => {
    if (o.client_id) return o.client_id;
    setConvert(true);
    return null;
  };
  const attach = async (files: FileList | null) => {
    const clientId = ensureClient();
    if (!clientId || !files?.length) return;
    setBusy("Pujant la factura…");
    try {
      for (const file of Array.from(files)) await uploadDocument(file, { clientId, category: o.service === "gas" ? "factura_gas" : "factura_llum", supplyId: o.supply_id }, () => undefined);
      await salesApi.activity({ opportunityId: o.id, data: { type: "document", title: `Factura adjuntada (${files.length})` } });
      if (o.stage === "nou_lead" || o.stage === "contactat" || o.stage === "factura_sollicitada") await salesApi.opp_("move", { id: o.id, data: { stage: "estudi", version: o.version } }).catch(() => undefined);
      toast({ title: "Factura desada a la fitxa del client", body: "L'oportunitat passa a «Estudi en curs».", tone: "ok" });
      await load();
    } catch (e) { toast({ title: "No s'ha pogut pujar", body: e instanceof Error ? e.message : String(e), tone: "err" }); } finally { setBusy(null); }
  };
  const openExpedient = () => {
    if (!ensureClient()) return;
    setExpedient(true);
  };
  const best = d.comparisons.find((k) => k.status !== "esborrany") ?? d.comparisons[0];

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <button onClick={() => go("pipeline")} className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft size={14} /> Oportunitats</button>
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{o.title}</h2>
              <StagePill s={o.stage} />
              <ServiceChip s={o.service} />
              {o.priority === "alta" && <Badge tone="red">Prioritat alta</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              {d.client ? <button className="inline-flex items-center gap-1 font-medium text-brand hover:underline" onClick={() => go("client", { id: d.client!.id })}><Building2 size={14} /> {d.client.name}</button>
                : d.lead ? <span className="inline-flex items-center gap-1"><Badge tone="blue">Lead</Badge> <b>{d.lead.company || d.lead.name}</b> <button className="text-brand hover:underline" onClick={() => go("leads", { id: d.lead!.id })}>Obre el lead</button></span> : null}
              <span className="inline-flex items-center gap-1.5 text-muted"><Avatar name={o.owner_name} size={18} /> {o.owner_name ?? "Sense assignar"}</span>
              <span className={cn("text-muted", idle >= 7 && !closed && "font-medium text-pend")}>{idle} dies sense activitat</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {d.canEdit && <Button onClick={() => setEdit(true)}><Pencil size={14} /> Edita</Button>}
            {d.canEdit && !closed && <Button variant="primary" onClick={() => move("guanyat")}><Trophy size={14} /> Guanyada</Button>}
            {d.canEdit && !closed && <Button variant="ghost" className="text-lost" onClick={() => setLose(true)}>Perduda</Button>}
          </div>
        </div>
        <ol className="mt-4 grid grid-cols-4 gap-1 sm:grid-cols-8" aria-label="Etapes">
          {STAGES.map((s) => {
            const idx = STAGES.indexOf(s), cur = STAGES.indexOf(o.stage);
            const done = o.stage !== "perdut" && idx < cur && s !== "perdut";
            return (
              <li key={s}>
                <button disabled={!d.canEdit || !!busy} onClick={() => move(s)} title={STAGE_LABEL[s]} className={cn("w-full rounded-lg border px-2 py-1.5 text-left text-[11.5px] disabled:cursor-default", o.stage === s ? "font-semibold text-white" : done ? "border-transparent bg-ink/[0.05] text-ink" : "border-line text-muted hover:border-ink/25")} style={o.stage === s ? { background: STAGE_COLOR[s], borderColor: STAGE_COLOR[s] } : undefined}>
                  <span className="flex items-center gap-1">{done ? <Check size={11} /> : null}<span className="truncate">{STAGE_LABEL[s]}</span></span>
                </button>
              </li>
            );
          })}
        </ol>
        <dl className="mt-4 grid grid-cols-2 gap-2.5 border-t border-line pt-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Consum estimat", ENERGY_SERVICES.includes(o.service) ? (o.annual_kwh != null ? `${o.annual_kwh.toLocaleString("ca-ES")} kWh` : "—") : "No aplica"],
            ["Volum", ENERGY_SERVICES.includes(o.service) ? mwh(o.mwh) : "—"],
            ["Comissió potencial", eur(o.commission_eur)],
            ["Probabilitat", o.probability != null ? `${o.probability} %` : "—"],
            ["Pròxima acció", o.next_action ? `${o.next_action}${o.next_action_at ? ` · ${fmtDateTime(o.next_action_at)}` : ""}` : "—"],
            ["Prioritat / tancament", `${PRIORITY_LABEL[o.priority]}${o.expected_close ? ` · ${new Date(o.expected_close).toLocaleDateString("ca-ES")}` : ""}`],
          ].map(([k, v]) => <div key={k} className="min-w-0 rounded-xl bg-elevated/60 px-3 py-2"><dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt><dd className="truncate text-[13px] font-medium" title={v}>{v}</dd></div>)}
        </dl>
        {o.stage === "perdut" && o.lost_reason && <p className="mt-3 text-[12.5px] text-lost">Motiu de la pèrdua: {o.lost_reason}</p>}
        {busy && <p className="mt-2 flex items-center gap-2 text-[12.5px] text-muted"><Loader2 size={13} className="animate-spin" /> {busy}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-[14px] font-semibold">Accions</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Action icon={<Building2 size={16} />} title={d.client ? "Fitxa del client" : "Converteix en client"} sub={d.client ? d.client.name : "Sense duplicar: es busquen coincidències"} onClick={() => (d.client ? go("client", { id: d.client.id }) : setConvert(true))} />
              <Action icon={<Zap size={16} />} title="CUPS del client" sub={d.client ? `${d.supplies.length} subministraments` : "Primer cal el client"} onClick={() => (d.client ? go("client", { id: d.client.id, tab: "subministraments" }) : setConvert(true))} />
              <Action icon={<Sparkles size={16} />} title="Comparativa" sub={best ? `Vinculada: ${best.best ?? "en curs"}` : "Obre el comparador energètic"} onClick={() => go("comparativa", { opportunity: o.id, ...(o.client_id ? { client: o.client_id } : { name: d.lead?.company || d.lead?.name || "" }), ...(o.supply_id ? { supply: o.supply_id } : {}) })} />
              <DropArea accept=".pdf,.jpg,.jpeg,.png,.webp" multiple onFiles={(fs) => { const dt = new DataTransfer(); fs.forEach((f) => dt.items.add(f)); void attach(dt.files); }}>
                <Action icon={<FilePlus2 size={16} />} title="Adjunta factures" sub="Es desen a Documents del client (o arrossega-les aquí)" onClick={() => (o.client_id ? fileInput.current?.click() : setConvert(true))} />
              </DropArea>
              <Action icon={<Send size={16} />} title="Registra l'enviament" sub="Proposta enviada fora de la plataforma" onClick={() => setSent(true)} />
              <Action icon={d.expedient ? <FileStack size={16} /> : <FileSignature size={16} />} title={d.expedient ? `Expedient ${d.expedient.code}` : d.contract ? "Contracte creat" : "Obre l'expedient de contractació"}
                sub={d.expedient ? EXP_STATUS_LABEL[d.expedient.status as ExpStatus] ?? d.expedient.status : d.contract ? `${d.contract.retailer} · ${CONTRACT_STATUS_LABEL[d.contract.status as keyof typeof CONTRACT_STATUS_LABEL] ?? d.contract.status}` : o.stage === "guanyat" ? "Documentació, signatura i tramitació" : "Quan estigui guanyada"}
                onClick={() => (d.expedient ? go("expedient", { id: d.expedient.id }) : d.contract ? go("client", { id: o.client_id!, tab: "contractes" }) : openExpedient())} disabled={!d.expedient && !d.contract && o.stage !== "guanyat"} />
            </div>
            <input ref={fileInput} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-[14px] font-semibold">Registra una interacció</h3>
            <LogActivity target={{ opportunityId: o.id }} onDone={load} />
          </section>

          <section>
            <h3 className="mb-2 text-[14px] font-semibold">Historial</h3>
            {d.activities.length === 0 ? <Empty icon={<ClipboardList size={22} />} title="Encara no hi ha activitat" /> : (
              <ol className="space-y-2">
                {d.activities.map((a) => (
                  <li key={a.id} className="rounded-xl border border-line bg-surface px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <span className="font-medium">{a.title}</span>
                      {(a as { outcome?: string | null }).outcome && <Badge>{CALL_OUTCOME_LABEL[(a as { outcome?: string }).outcome as keyof typeof CALL_OUTCOME_LABEL] ?? (a as { outcome?: string }).outcome}</Badge>}
                      {a.delivery && <Badge tone={a.delivery === "enviat" ? "green" : a.delivery === "intent" ? "amber" : "zinc"}>{a.delivery === "enviat" ? "Enviament confirmat" : a.delivery === "registrat" ? "Registrat a mà" : a.delivery === "intent" ? "Només s'ha obert l'aplicació" : "Error"}</Badge>}
                    </div>
                    {a.body && <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-muted">{a.body}</p>}
                    <p className="mt-0.5 text-[11px] text-muted">{fmtDateTime(a.at)}{a.user_name ? ` · ${a.user_name}` : ""}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-[14px] font-semibold">Tasques</h3><Button size="sm" onClick={() => setTask({})}>+ Tasca</Button></div>
            {d.tasks.length === 0 ? <p className="text-[12.5px] text-muted">Cap tasca.</p> : (
              <ul className="space-y-1.5">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-[12.5px]">
                    <button aria-label={t.status === "pendent" ? `Marca «${t.title}» com a feta` : "Feta"} disabled={t.status !== "pendent"} onClick={async () => { await crmApi.action({ entity: "task", action: "complete", id: t.id }); await load(); }} className="mt-0.5 text-muted hover:text-ren">{t.status === "pendent" ? <Circle size={15} /> : <CheckCircle2 size={15} className="text-ren" />}</button>
                    <div className="min-w-0">
                      <p className={cn("font-medium", t.status !== "pendent" && "text-muted line-through")}>{t.title}</p>
                      <p className={cn("text-[11px]", t.status === "pendent" && t.due_at && t.due_at < new Date().toISOString() ? "font-medium text-lost" : "text-muted")}>
                        {t.kind ? `${TASK_KIND_LABEL[t.kind as keyof typeof TASK_KIND_LABEL] ?? t.kind} · ` : ""}{t.due_at ? fmtDateTime(t.due_at) : "Sense data"}{t.assigned_name ? ` · ${t.assigned_name}` : ""}{t.source === "automatica" ? " · automàtica" : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="mb-2 text-[14px] font-semibold">Comparatives</h3>
            {d.comparisons.length === 0 ? <p className="text-[12.5px] text-muted">Encara no n&apos;hi ha cap de vinculada.</p> : (
              <ul className="space-y-1.5">
                {d.comparisons.map((k) => (
                  <li key={k.id}><button className="w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-ink/[0.04]" onClick={() => go("comparatives", { open: k.id })}>
                    <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{k.best ?? "Comparativa"}</span><Badge tone={k.status === "enviada" ? "green" : k.status === "emesa" ? "blue" : "zinc"}>{k.status}</Badge></span>
                    <span className="text-[11px] text-muted">{fmtDateTime(k.created_at)}{k.saving != null ? ` · estalvi ${eur(k.saving)}` : ""}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </section>
          {d.client && (
            <section className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
              <h3 className="mb-2 text-[14px] font-semibold">Subministraments</h3>
              {d.supplies.length === 0 ? <p className="text-muted">Cap CUPS donat d&apos;alta.</p> : d.supplies.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="truncate font-mono text-[11.5px]">{s.cups}</span>
                  <span className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" title="Anàlisi energètica" aria-label="Anàlisi energètica" onClick={() => useApp.getState().analyzeCups(s.cups.slice(0, 20))}><Gauge size={13} /></Button>
                    <Button size="sm" variant="ghost" title="Comparativa d'aquest CUPS" aria-label="Comparativa d'aquest CUPS" onClick={() => go("comparativa", { opportunity: o.id, client: o.client_id!, supply: s.id })}><Sparkles size={13} /></Button>
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>

      {edit && <OppForm opp={o} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void load(); }} />}
      {task && <TaskForm link={{ opportunity_id: o.id }} defaultTitle={task.title} defaultKind={task.kind} onClose={() => setTask(null)} onSaved={() => { setTask(null); void load(); }} />}
      {convert && d.lead && <ConvertLead leadId={d.lead.id} name={d.lead.company || d.lead.name} onClose={() => setConvert(false)} onDone={() => { setConvert(false); void load(); }} />}
      {convert && !d.lead && !d.client && <Modal open onClose={() => setConvert(false)} title="Sense client"><p className="text-[13px]">Aquesta oportunitat no té client ni lead vinculat.</p></Modal>}
      {lose && <LoseModal onClose={() => setLose(false)} onConfirm={(r) => { setLose(false); void move("perdut", r); }} />}
      {sent && <SentModal oppId={o.id} onClose={() => setSent(false)} onDone={() => { setSent(false); void load(); }} />}
      {expedient && o.client_id && (
        <NewExpedientWizard onClose={() => { setExpedient(false); void load(); }}
          initial={{ clientId: o.client_id, clientName: d.client?.name, opportunityId: o.id, supplyId: o.supply_id, service: o.service, comparisonId: o.comparison_id, retailer: best?.best?.split(" · ")[0], product: best?.best?.split(" · ")[1] ?? null }} />
      )}
    </div>
  );
}

function Action({ icon, title, sub, onClick, disabled }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className="pressable flex items-start gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:border-ink/25 disabled:cursor-not-allowed disabled:opacity-50">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">{icon}</span>
      <span className="min-w-0"><span className="block text-[13px] font-medium">{title}</span><span className="block truncate text-[11.5px] text-muted">{sub}</span></span>
    </button>
  );
}

export function ConvertLead({ leadId, name, onClose, onDone }: { leadId: string; name: string; onClose: () => void; onDone: (clientId: string) => void }) {
  const [matches, setMatches] = useState<{ id: string; name: string; reason: string; visible: boolean }[] | null>(null);
  const [choice, setChoice] = useState<string>("nou");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { salesApi.matches(leadId).then((r) => { setMatches(r.matches); const v = r.matches.find((m) => m.visible); if (v) setChoice(v.id); }).catch(() => setMatches([])); }, [leadId]);
  const blocked = matches?.some((m) => !m.visible && m.reason === "mateix NIF/CIF");
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await salesApi.convert(leadId, choice === "nou" ? null : choice);
      useApp.getState().toast({ title: r.created ? "Client creat" : "Lead vinculat al client existent", body: "Les oportunitats i l'historial del lead ja són a la fitxa del client.", tone: "ok" });
      onDone(r.clientId);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Converteix en client · ${name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !matches || blocked} onClick={run}>{busy ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />} {choice === "nou" ? "Crea el client" : "Vincula al client"}</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Per no duplicar dades, es busquen clients amb el mateix NIF/CIF, telèfon o correu.</p>
        {!matches ? <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Buscant coincidències…</p> : (
          <div className="space-y-1.5" role="radiogroup">
            {matches.filter((m) => m.visible).map((m) => (
              <label key={m.id} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2", choice === m.id ? "border-brand bg-brand/[0.05]" : "border-line")}>
                <input type="radio" checked={choice === m.id} onChange={() => setChoice(m.id)} /> Vincula a <b>{m.name}</b> <span className="text-[11.5px] text-muted">({m.reason})</span>
              </label>
            ))}
            {!blocked && <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2", choice === "nou" ? "border-brand bg-brand/[0.05]" : "border-line")}><input type="radio" checked={choice === "nou"} onChange={() => setChoice("nou")} /> Crea un client nou amb les dades del lead</label>}
            {blocked && <Notice tone="red">Ja hi ha un client amb aquest NIF/CIF assignat a un altre usuari. Demana a Administració que te&apos;l comparteixi o que faci la conversió.</Notice>}
          </div>
        )}
        {err && <p className="text-[12.5px] text-lost">{err}</p>}
      </div>
    </Modal>
  );
}

function LoseModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (r: string) => void }) {
  const [r, setR] = useState("");
  const [other, setOther] = useState("");
  const final = r === "Altres" ? other.trim() : r;
  return (
    <Modal open onClose={onClose} title="Motiu de la pèrdua" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!final} onClick={() => onConfirm(final)}>Marca com a perduda</Button></>}>
      <div className="flex flex-wrap gap-1.5">{LOST_REASONS.map((x) => <button key={x} onClick={() => setR(x)} className={cn("rounded-full border px-3 py-1 text-[12.5px]", r === x ? "border-lost bg-lost/[0.06] text-lost" : "border-line text-muted")}>{x}</button>)}</div>
      {r === "Altres" && <input className="input mt-3" autoFocus placeholder="Explica el motiu" value={other} onChange={(e) => setOther(e.target.value)} />}
    </Modal>
  );
}

function SentModal({ oppId, onClose, onDone }: { oppId: string; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState<"email" | "whatsapp" | "presencial">("email");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Registra l'enviament de la proposta" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await salesApi.opp_("register_sent", { id: oppId, channel, note: note || null }); onDone(); } catch (e) { useApp.getState().toast({ title: "Error", body: String(e instanceof Error ? e.message : e), tone: "err" }); } finally { setBusy(false); } }}>Registra</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Per a propostes enviades fora de la plataforma. Queden com a «registrat a mà», no com a enviament confirmat. Si l&apos;envies per correu des de la comparativa, es registra sol.</p>
        <div className="flex gap-1.5">{(["email", "whatsapp", "presencial"] as const).map((c) => <button key={c} onClick={() => setChannel(c)} className={cn("rounded-lg border px-3 py-1.5 text-[12.5px]", channel === c ? "border-brand bg-brand/[0.06] text-brand" : "border-line text-muted")}>{c === "email" ? "Correu" : c === "whatsapp" ? "WhatsApp" : "En mà"}</button>)}</div>
        <textarea className="input min-h-[60px]" placeholder="Notes (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

