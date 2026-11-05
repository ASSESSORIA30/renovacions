"use client";
/**
 * Fase 7 · Informes i productivitat, qualitat de dades, centre d'alertes i automatitzacions, i usuaris i permisos.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, CircleAlert, Download, EyeOff, FileBarChart, KeyRound, Loader2, Play, RefreshCw, RotateCw, SearchCheck, ShieldCheck, Users, XCircle } from "lucide-react";
import { useApp } from "@/data/store";
import { MODULES, ROLE_CODE } from "@/core/permissions";
import { PERIOD_LABEL, QUALITY_LABEL } from "@/core/control";
import { ROLE_LABEL } from "@/core/roles";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";
import type { Role } from "@/core/types";
import { Button, Notice, Tabs, cn } from "../../components/ui";
import { Panel, PageHead, Pill, Skeleton, api, fdate, fdt, num } from "./shared";

/* ======================================================================= INFORMES I PRODUCTIVITAT */

type Prod = { range: { from: string; to: string }; scope: string; note: string; rows: { id: string; name: string; role: string; contractes_introduits: number; contractes_activats: number; expedients_tramitats: number; tasques_finalitzades: number; tasques_pendents: number; renovacions_gestionades: number; incidencies_resoltes: number; leads_treballats: number; propostes_enviades: number; hores_mitjanes_tasca: number | null; tasques_amb_temps: number }[] };
export function ReportsView() {
  const role = useApp((s) => s.snap?.me.role);
  const [period, setPeriod] = useState("mes");
  const [person, setPerson] = useState("");
  const [p, setP] = useState<Prod | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dl, setDl] = useState<string | null>(null);
  const load = useCallback(async () => { try { setP(await api.control<Prod>("productivitat", { period, person })); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, [period, person]);
  useEffect(() => { void load(); }, [load]);
  const download = async (kind: string) => {
    setDl(kind);
    try {
      const r = await fetch(`/api/reports?kind=${kind}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "No s'ha pogut generar l'informe");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = `assessoria30-informe-${kind}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setDl(null); }
  };
  const people = useMemo(() => p?.rows ?? [], [p]);
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<FileBarChart size={16} />} title="Informes i productivitat" sub={role === "admin" ? "Informes globals en PDF i activitat de tot l'equip." : role === "comercial" ? "Els teus informes i resultats propis." : "Informes administratius i activitat de l'equip administratiu."} tone="from-teal-600 to-emerald-500" />
      {err && <Notice tone="red">{err}</Notice>}
      <div className="grid gap-3 md:grid-cols-3">
        {[["diari", "Informe diari", "Contractes, activitat, renovacions, incidències i tasques d'avui."], ["setmanal", "Informe setmanal", "Resultats comercials i administratius, MWh, leads, propostes i incidències."], ["mensual", "Informe mensual", role === "admin" ? "Comissions, liquidacions, rendibilitat, objectius, col·laboradors i cartera." : "Resultats del mes dins del teu abast."]].map(([k, t, s]) => (
          <div key={k} className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-4">
            <div><p className="font-semibold">{t}</p><p className="mt-1 text-[12.5px] text-muted">{s}</p></div>
            <Button className="mt-3 self-start" size="sm" variant="primary" disabled={!!dl} onClick={() => void download(k)}>{dl === k ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Descarrega el PDF</Button>
          </div>
        ))}
      </div>
      <Panel title="Productivitat (activitat registrada)" action={
        <div className="flex flex-wrap gap-2">
          <select className="input h-8 w-auto text-[12px]" aria-label="Període" value={period} onChange={(e) => setPeriod(e.target.value)}>{(["avui", "setmana", "mes", "trimestre", "any"] as const).map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}</select>
          {p && p.scope !== "propi" && <select className="input h-8 w-auto text-[12px]" aria-label="Persona" value={person} onChange={(e) => setPerson(e.target.value)}><option value="">Tothom</option>{people.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
        </div>
      }>
        {!p ? <div className="h-40 animate-pulse rounded-xl bg-elevated" /> : !p.rows.length ? <p className="py-6 text-center text-[12.5px] text-muted">Sense persones dins del teu abast.</p> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11px] text-muted"><tr>{["Persona", "Contractes introduïts", "Activats", "Expedients tramitats", "Tasques finalitzades", "Pendents", "Renovacions", "Incidències resoltes", "Leads treballats", "Propostes", "Temps mitjà / tasca"].map((h, i) => <th key={h} className={cn("px-1.5 py-1 font-medium", i && "text-right")}>{h}</th>)}</tr></thead>
              <tbody>{p.rows.map((r) => <tr key={r.id} className="border-t border-line"><td className="px-1.5 py-2"><b>{r.name}</b> <span className="text-muted">· {ROLE_LABEL[r.role as Role] ?? r.role}</span></td>{[r.contractes_introduits, r.contractes_activats, r.expedients_tramitats, r.tasques_finalitzades, r.tasques_pendents, r.renovacions_gestionades, r.incidencies_resoltes, r.leads_treballats, r.propostes_enviades].map((v, i) => <td key={i} className="px-1.5 text-right tnum">{v}</td>)}<td className="px-1.5 text-right tnum text-muted" title={r.hores_mitjanes_tasca == null ? "Cal un mínim de 3 tasques amb inici i final registrats" : `${r.tasques_amb_temps} tasques amb temps registrat`}>{r.hores_mitjanes_tasca == null ? "—" : `${num(r.hores_mitjanes_tasca, 1)} h`}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {p && <p className="mt-2 text-[11.5px] text-muted">{p.note} Període: {fdate(p.range.from)} – {fdate(p.range.to)}.</p>}
      </Panel>
    </div>
  );
}

/* ======================================================================= QUALITAT DE DADES */

type Issue = { kind: string; severity: "alta" | "mitjana" | "baixa"; title: string; detail: string; entity: string; ids: string[]; link?: { view: string; params: Record<string, string> }; signature: string; review: { status: string; note: string | null; reviewed_at: string; auto?: boolean } | null };
export function QualityView() {
  const go = useApp((s) => s.navigate);
  const [d, setD] = useState<{ issues: Issue[]; open: number; economicChecks: boolean; canReview: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [show, setShow] = useState<"pendents" | "revisats">("pendents");
  const load = useCallback(() => api.control<typeof d>("qualitat").then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const review = async (i: Issue, status: string | null) => {
    const note = status === "ignorat" ? prompt("Motiu (opcional)") ?? undefined : undefined;
    try { await api.controlAct("quality_review", { data: { signature: i.signature, kind: i.kind, status, note } }); void load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const rows = (d?.issues ?? []).filter((i) => (show === "pendents" ? !i.review : !!i.review) && (!kind || i.kind === kind));
  const [bulk, setBulk] = useState(false);
  const ignoreAll = async () => {
    const items = rows.filter((i) => !i.review).map((i) => ({ signature: i.signature, kind: i.kind }));
    if (!items.length) return;
    if (!confirm(`Vols ignorar ${items.length} ${items.length === 1 ? "cas pendent" : "casos pendents"}${kind ? ` de «${QUALITY_LABEL[kind]}»` : ""}? Quedaran a «Revisats» i els podràs reobrir un per un.`)) return;
    const note = prompt("Motiu (opcional)") ?? undefined;
    setBulk(true);
    try { await api.controlAct("quality_review_bulk", { data: { items, status: "ignorat", note: note || undefined } }); void load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBulk(false); }
  };
  const counts: Record<string, number> = {};
  for (const i of d?.issues ?? []) if (!i.review) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<SearchCheck size={16} />} title="Qualitat i integritat de dades" sub="Detecció de duplicats, dades incoherents i registres orfes. El sistema no fusiona ni esborra res: cada cas el revisa una persona." tone="from-slate-600 to-zinc-500">
        <Button size="sm" onClick={() => void load()}><RefreshCw size={13} /> Torna a analitzar</Button>
      </PageHead>
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <Skeleton rows={1} /> : (
        <>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setKind("")} className={cn("rounded-xl border px-3 py-1.5 text-[12.5px]", !kind ? "border-ink bg-ink text-surface" : "border-line bg-surface")}>Tots <b className="tnum">{d.open}</b></button>
            {Object.entries(QUALITY_LABEL).map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={cn("rounded-xl border px-3 py-1.5 text-[12.5px]", kind === k ? "border-ink bg-ink text-surface" : "border-line bg-surface", !counts[k] && "opacity-50")}>{l} <b className="tnum">{counts[k] ?? 0}</b></button>)}
          </div>
          {!d.economicChecks && <p className="text-[11.5px] text-muted">Les comprovacions de comissions duplicades i liquidacions incoherents només es fan amb accés a dades econòmiques.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={show} onChange={setShow} items={[{ id: "pendents", label: "Pendents de revisar" }, { id: "revisats", label: "Revisats" }]} />
            {d.canReview && show === "pendents" && rows.length > 0 && <Button size="sm" onClick={() => void ignoreAll()} disabled={bulk}>{bulk ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />} Ignora tots ({rows.length})</Button>}
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {!rows.length ? <p className="flex items-center justify-center gap-2 py-12 text-[13px] text-muted"><CheckCircle2 size={16} className="text-emerald-500" /> {show === "pendents" ? "Cap problema pendent amb aquest filtre." : "Encara no s'ha revisat cap cas."}</p> : (
              <ul className="divide-y divide-line">
                {rows.slice(0, 300).map((i) => (
                  <li key={i.signature} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <Pill className={i.severity === "alta" ? "bg-red-500/12 text-red-700" : i.severity === "mitjana" ? "bg-amber-500/14 text-amber-800" : "bg-ink/[0.05] text-muted"}>{i.severity}</Pill>
                    <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{i.title}</p><p className="truncate text-[12px] text-muted">{QUALITY_LABEL[i.kind]} · {i.detail}</p>{i.review && <p className="text-[11.5px] text-muted">{i.review.auto ? i.review.note : <>{i.review.status} el {fdt(i.review.reviewed_at)}{i.review.note ? ` · ${i.review.note}` : ""}</>}</p>}</div>
                    {i.link && <Button size="sm" variant="ghost" onClick={() => go(i.link!.view as never, i.link!.params)}>Obre</Button>}
                    {d.canReview && (i.review ? (i.review.auto ? <Pill className="bg-ink/[0.05] text-muted">automàtic</Pill> : <Button size="sm" variant="ghost" onClick={() => void review(i, null)}><RotateCw size={12} /> Reobre</Button>) : <><Button size="sm" onClick={() => void review(i, "corregit")}>Corregit</Button><Button size="sm" variant="ghost" onClick={() => void review(i, "revisat")}>Correcte</Button><Button size="sm" variant="ghost" onClick={() => void review(i, "ignorat")}>Ignora</Button></>)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ======================================================================= CENTRE D'ALERTES I AUTOMATITZACIONS */

type Alerts = {
  rules: { key: string; name: string; description: string; enabled: boolean; params: Record<string, unknown>; updated_at: string }[];
  runs: { id: number; started_at: string; finished_at: string | null; trigger: string; tasks_created: number; notifications_created: number; ok: boolean | null; error: string | null }[];
  lastRun: { started_at: string; ok: boolean | null } | null; stats: { errors7d: number; tasks7d: number; notifications7d: number; byKind: Record<string, number> };
  retries: { submissions: { id: string; channel: string; attempts: number; error: string | null; received_at: string }[]; readings: { id: string; attempts: number; error: string | null; updated_at: string }[]; webhooks: { id: number; provider: string; status: string; error: string | null; received_at: string }[] };
  syncs: { id: number; at: string; origin: string; ok: boolean; error: string | null }[]; ai: { id: string; started_at: string; status: string; attempts: number }[]; reports: { kind: string; period_key: string; status: string; error: string | null; at: string }[];
  integrations: { id: string; label: string; ok: boolean; note: string }[]; canRun: boolean;
};
export function AlertsCenterView() {
  const toast = useApp((s) => s.toast);
  const [d, setD] = useState<Alerts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api.control<Alerts>("alertes").then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const act = async (op: string) => {
    setBusy(op);
    try { const r = await api.controlAct<Record<string, unknown>>("alerts", { op }); toast({ title: op === "run" ? "Automatitzacions executades" : "Reintents processats", body: JSON.stringify(r).slice(0, 140), tone: "ok" }); void load(); }
    catch (e) { toast({ title: "Error", body: e instanceof Error ? e.message : String(e), tone: "err" }); } finally { setBusy(null); }
  };
  const toggle = async (key: string, enabled: boolean, params: Record<string, unknown>) => {
    try { const r = await fetch("/api/crm/automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update", key, enabled, params }) }); if (!r.ok) throw new Error((await r.json()).error); void load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<BellRing size={16} />} title="Alertes i automatitzacions" sub="Totes les automatitzacions del CRM en un sol lloc: regles, execucions, errors, reintents i estat real de les integracions." tone="from-amber-600 to-yellow-500">
        {d?.canRun && <Button size="sm" onClick={() => void act("retry_capture")} disabled={!!busy}>{busy === "retry_capture" ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} Reintenta captació</Button>}
        {d?.canRun && <Button size="sm" variant="primary" onClick={() => void act("run")} disabled={!!busy}>{busy === "run" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Executa ara</Button>}
      </PageHead>
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <Skeleton /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="rounded-2xl border border-line bg-surface p-3.5"><p className="text-[12px] text-muted">Última execució</p><p className="mt-1 text-[15px] font-semibold">{d.lastRun ? fdt(d.lastRun.started_at) : "Mai"}</p>{d.lastRun && <p className={cn("text-[12px]", d.lastRun.ok === false ? "text-red-600" : "text-emerald-600")}>{d.lastRun.ok === false ? "Amb errors" : "Correcta"}</p>}</div>
            <div className="rounded-2xl border border-line bg-surface p-3.5"><p className="text-[12px] text-muted">Regles actives</p><p className="mt-1 text-[22px] font-semibold tnum">{d.rules.filter((r) => r.enabled).length}<span className="text-[13px] font-normal text-muted"> / {d.rules.length}</span></p></div>
            <div className="rounded-2xl border border-line bg-surface p-3.5"><p className="text-[12px] text-muted">Errors (7 dies)</p><p className={cn("mt-1 text-[22px] font-semibold tnum", d.stats.errors7d && "text-red-600")}>{d.stats.errors7d}</p></div>
            <div className="rounded-2xl border border-line bg-surface p-3.5"><p className="text-[12px] text-muted">Tasques generades (7 dies)</p><p className="mt-1 text-[22px] font-semibold tnum">{d.stats.tasks7d}</p></div>
            <div className="rounded-2xl border border-line bg-surface p-3.5"><p className="text-[12px] text-muted">Alertes enviades (7 dies)</p><p className="mt-1 text-[22px] font-semibold tnum">{d.stats.notifications7d}</p></div>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Regles d'automatització" className="lg:col-span-2">
              <ul className="divide-y divide-line">{d.rules.map((r) => (
                <li key={r.key} className="flex items-start gap-3 py-2.5">
                  <label className="mt-0.5 inline-flex cursor-pointer items-center"><input type="checkbox" className="sr-only" checked={r.enabled} disabled={!d.canRun} onChange={(e) => void toggle(r.key, e.target.checked, r.params)} aria-label={`Activa ${r.name}`} /><span className={cn("relative h-5 w-9 rounded-full transition-colors", r.enabled ? "bg-brand" : "bg-ink/15")}><span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", r.enabled ? "left-[18px]" : "left-0.5")} /></span></label>
                  <div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{r.name} <span className="font-mono text-[10.5px] text-muted">{r.key}</span></p><p className="text-[12px] text-muted">{r.description}</p>{Object.keys(r.params ?? {}).length > 0 && <p className="mt-0.5 font-mono text-[11px] text-muted">{JSON.stringify(r.params)}</p>}</div>
                </li>
              ))}</ul>
            </Panel>
            <Panel title="Estat de les integracions">
              <ul className="space-y-2">{d.integrations.map((i) => <li key={i.id} className="flex items-start gap-2 text-[12.5px]">{i.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-500" />}<div><p className="font-medium">{i.label}</p><p className="text-[11.5px] text-muted">{i.note}</p></div></li>)}</ul>
            </Panel>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Historial d'execucions" empty={!d.runs.length && "Encara no s'ha executat cap automatització"}>
              <div className="max-h-80 overflow-y-auto"><table className="w-full text-[12px]"><thead className="text-left text-[11px] text-muted"><tr><th className="py-1 font-medium">Inici</th><th className="font-medium">Origen</th><th className="text-right font-medium">Tasques</th><th className="text-right font-medium">Avisos</th><th className="text-right font-medium">Estat</th></tr></thead>
                <tbody>{d.runs.map((r) => <tr key={r.id} className="border-t border-line"><td className="py-1.5">{fdt(r.started_at)}</td><td className="text-muted">{r.trigger}</td><td className="text-right tnum">{r.tasks_created}</td><td className="text-right tnum">{r.notifications_created}</td><td className="text-right">{r.ok === false ? <span title={r.error ?? ""} className="inline-flex items-center gap-1 text-red-600"><XCircle size={12} /> Error</span> : r.ok ? <span className="text-emerald-600">OK</span> : <span className="text-muted">En curs</span>}</td></tr>)}</tbody></table></div>
            </Panel>
            <Panel title="Errors i reintents">
              <div className="space-y-3 text-[12px]">
                <div><p className="mb-1 font-medium">Sol·licituds de captació amb error</p>{!d.retries.submissions.length ? <p className="text-muted">Cap</p> : d.retries.submissions.map((s) => <p key={s.id} className="truncate text-muted">{fdt(s.received_at)} · {s.channel} · {s.attempts} intents · {s.error}</p>)}</div>
                <div><p className="mb-1 font-medium">Lectures de factura amb error</p>{!d.retries.readings.length ? <p className="text-muted">Cap</p> : d.retries.readings.map((s) => <p key={s.id} className="truncate text-muted">{fdt(s.updated_at)} · {s.attempts} intents · {s.error}</p>)}</div>
                <div><p className="mb-1 font-medium">Webhooks</p>{!d.retries.webhooks.length ? <p className="text-muted">Cap error</p> : d.retries.webhooks.map((s) => <p key={s.id} className="truncate text-muted">{fdt(s.received_at)} · {s.provider} · {s.status}{s.error ? ` · ${s.error}` : ""}</p>)}</div>
                <div><p className="mb-1 font-medium">Sincronitzacions</p>{!d.syncs.length ? <p className="text-muted">Cap (no és necessària: el CRM treballa directament a Supabase)</p> : d.syncs.slice(0, 5).map((s) => <p key={s.id} className={cn("truncate", s.ok ? "text-muted" : "text-red-600")}>{fdt(s.at)} · {s.origin} · {s.ok ? "OK" : s.error}</p>)}</div>
                <div><p className="mb-1 font-medium">Informes automàtics</p>{!d.reports.length ? <p className="text-muted">Encara no se n'ha enviat cap</p> : d.reports.slice(0, 6).map((s, i) => <p key={i} className="truncate text-muted">{fdt(s.at)} · {s.kind} {s.period_key} · {s.status === "pendent_smtp" ? "pendent (sense SMTP)" : s.status}</p>)}</div>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/* ======================================================================= USUARIS, ROLS I PERMISOS */

type Matrix = { migrated: boolean; modules: typeof MODULES; roles: { role: string; module: string; can_read: boolean; can_edit: boolean; can_approve: boolean }[]; overrides: { user_id: string; module: string; can_read: boolean; can_edit: boolean; can_approve: boolean; note: string | null }[]; people: { id: string; name: string; email: string; role: string; code: string | null }[]; mfa: { enforced: boolean; roles: string[] } | null; reports: { diari: string[]; setmanal: string[]; mensual: string[] } | null; me: { current: string; next: string } };
const ROLES_EDITABLE = ["cap_administrativa", "cap_equip", "administrativa", "comercial", "colaborador"] as const;
export function PermissionsView() {
  const ptab = useApp((s) => s.params.tab);
  const [tab, setTab] = useState<"rols" | "persones" | "seguretat" | "auditoria">(["rols", "persones", "seguretat", "auditoria"].includes(ptab ?? "") ? (ptab as "rols") : "rols");
  useEffect(() => { if (ptab && ["rols", "persones", "seguretat", "auditoria"].includes(ptab)) setTab(ptab as "rols"); }, [ptab]);
  const [d, setD] = useState<Matrix | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.perms<Matrix>().then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<ShieldCheck size={16} />} title="Usuaris i permisos" sub="Permisos per rol i per persona (lectura, edició i aprovació). Direcció té sempre tots els permisos. Cada canvi queda auditat." tone="from-zinc-700 to-zinc-500" />
      <Tabs value={tab} onChange={setTab} items={[{ id: "rols", label: "Permisos per rol" }, { id: "persones", label: "Persones" }, { id: "seguretat", label: "Seguretat i informes" }, { id: "auditoria", label: "Auditoria" }]} />
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <Skeleton rows={1} /> : !d.migrated ? <Notice tone="amber">Falta aplicar la migració <b>014_consolidacio.sql</b> a Supabase. Mentrestant es manté el comportament de la Fase 6.</Notice> : (
        <>
          {tab === "rols" && <RoleMatrix d={d} reload={load} />}
          {tab === "persones" && <People d={d} reload={load} />}
          {tab === "seguretat" && <Security d={d} reload={load} />}
          {tab === "auditoria" && <Audit />}
        </>
      )}
    </div>
  );
}

const Cell = ({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) => (
  <button aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick} className={cn("h-6 w-6 rounded-md border text-[11px] font-bold", on ? "border-brand bg-brand text-white" : "border-line text-transparent hover:border-brand/60", disabled && "opacity-40")}>✓</button>
);
function RoleMatrix({ d, reload }: { d: Matrix; reload: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const get = (role: string, m: string) => d.roles.find((r) => r.role === role && r.module === m) ?? { can_read: false, can_edit: false, can_approve: false };
  const set = async (role: string, m: string, k: "read" | "edit" | "approve") => {
    const c = get(role, m);
    const next = { read: c.can_read, edit: c.can_edit, approve: c.can_approve, [k]: !(k === "read" ? c.can_read : k === "edit" ? c.can_edit : c.can_approve) };
    if (k === "read" && !next.read) { next.edit = false; next.approve = false; }
    if ((m === "economia" || m === "comissions") && (next.edit || next.approve) && !confirm("Estàs donant permís per MODIFICAR dades econòmiques a tot un rol. Ho confirmes?")) return;
    try { await api.permsAct("role", { role, module: m, ...next }); reload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="space-y-2">
      {err && <Notice tone="red">{err}</Notice>}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead className="border-b border-line text-[11px] text-muted"><tr><th className="px-3 py-2 text-left font-medium">Mòdul</th>{ROLES_EDITABLE.map((r) => <th key={r} className="px-2 text-center font-medium">{ROLE_LABEL[r]}<span className="block font-mono text-[9.5px]">{ROLE_CODE[r]}</span><span className="block text-[10px]">L · E · A</span></th>)}</tr></thead>
          <tbody>{d.modules.map((m) => (
            <tr key={m.id} className="border-b border-line last:border-0">
              <td className="px-3 py-2"><p className="font-medium">{m.label}{m.sensitive && <KeyRound size={11} className="ml-1 inline text-amber-500" aria-label="Sensible" />}</p><p className="text-[11px] text-muted">{m.help}</p></td>
              {ROLES_EDITABLE.map((r) => { const c = get(r, m.id); const lockC = r === "colaborador" && !["portal", "tasques", "informes", "comissions"].includes(m.id); return <td key={r} className="px-2 text-center"><div className="inline-flex gap-1"><Cell label={`${ROLE_LABEL[r]} ${m.label} lectura`} on={c.can_read} disabled={lockC} onClick={() => void set(r, m.id, "read")} /><Cell label={`${ROLE_LABEL[r]} ${m.label} edició`} on={c.can_edit} disabled={lockC} onClick={() => void set(r, m.id, "edit")} /><Cell label={`${ROLE_LABEL[r]} ${m.label} aprovació`} on={c.can_approve} disabled={lockC} onClick={() => void set(r, m.id, "approve")} /></div></td>; })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-muted">L = lectura · E = edició · A = aprovació. Direcció (DIRECCIO) té sempre tots els permisos i no es pot restringir per evitar quedar sense accés. Els col·laboradors només poden tenir el portal.</p>
    </div>
  );
}

function People({ d, reload }: { d: Matrix; reload: () => void }) {
  const go = useApp((s) => s.navigate);
  const [who, setWho] = useState<string>(d.people.find((p) => p.role !== "admin")?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const person = d.people.find((p) => p.id === who);
  const roleRow = (m: string) => d.roles.find((r) => r.role === person?.role && r.module === m);
  const ov = (m: string) => d.overrides.find((o) => o.user_id === who && o.module === m);
  const setOv = async (m: string, value: { read: boolean; edit: boolean; approve: boolean } | null) => {
    if (value && (m === "economia" || m === "comissions") && value.read && !confirm(`Autoritzes ${person?.name} a veure dades econòmiques restringides?`)) return;
    try { await api.permsAct("user", { userId: who, module: m, value }); reload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <div className="space-y-1 rounded-2xl border border-line bg-surface p-2">
        {d.people.map((p) => <button key={p.id} onClick={() => setWho(p.id)} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12.5px]", who === p.id ? "bg-ink/[0.07]" : "hover:bg-ink/[0.04]")}><span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-[11px] text-muted">{p.email}</span></span><Pill className="bg-ink/[0.05] text-muted">{ROLE_LABEL[p.role as Role]}</Pill></button>)}
        <Button size="sm" variant="ghost" className="w-full" onClick={() => go("ajustes", { tab: "usuarios" })}><Users size={13} /> Alta, rol i contrasenya</Button>
      </div>
      <div className="space-y-2">
        {err && <Notice tone="red">{err}</Notice>}
        {!person ? <Notice tone="blue">Tria una persona.</Notice> : person.role === "admin" ? <Notice tone="blue"><b>{person.name}</b> té el rol Direcció: mateixos permisos que la resta de Direcció (tots). Les seves preferències de panell són pròpies.</Notice> : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="border-b border-line px-4 py-2.5 text-[12.5px]"><b>{person.name}</b> · rol {ROLE_LABEL[person.role as Role]} ({ROLE_CODE[person.role as Role]}). Les excepcions individuals tenen prioritat sobre el rol.</div>
            <table className="w-full text-[12.5px]"><thead className="text-[11px] text-muted"><tr><th className="px-4 py-1.5 text-left font-medium">Mòdul</th><th className="font-medium">Pel rol</th><th className="font-medium">Excepció per a aquesta persona</th><th /></tr></thead>
              <tbody>{d.modules.map((m) => { const r = roleRow(m.id); const o = ov(m.id); const cur = o ? { read: o.can_read, edit: o.can_edit, approve: o.can_approve } : { read: !!r?.can_read, edit: !!r?.can_edit, approve: !!r?.can_approve }; return (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-4 py-1.5 font-medium">{m.label}{m.sensitive && <KeyRound size={11} className="ml-1 inline text-amber-500" />}</td>
                  <td className="text-center text-[11px] text-muted">{[r?.can_read && "L", r?.can_edit && "E", r?.can_approve && "A"].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="text-center"><div className={cn("inline-flex gap-1 rounded-lg p-0.5", o && "bg-amber-500/10")}>{(["read", "edit", "approve"] as const).map((k) => <Cell key={k} label={`${m.label} ${k}`} on={cur[k]} onClick={() => { const n = { ...cur, [k]: !cur[k] }; if (k === "read" && !n.read) { n.edit = false; n.approve = false; } void setOv(m.id, n); }} />)}</div></td>
                  <td className="pr-3 text-right">{o && <button className="text-[11.5px] text-muted hover:text-red-600" onClick={() => void setOv(m.id, null)}>Treu l&apos;excepció</button>}</td>
                </tr>); })}</tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}

function Security({ d, reload }: { d: Matrix; reload: () => void }) {
  const toast = useApp((s) => s.toast);
  const [mfa, setMfa] = useState(d.mfa ?? { enforced: false, roles: ["admin", "cap_administrativa"] });
  const [rep, setRep] = useState(d.reports ?? { diari: [], setmanal: [], mensual: [] });
  const [err, setErr] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const save = async (data: unknown) => { try { await api.permsAct("security", data); toast({ title: "Desat", tone: "ok" }); reload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const startEnroll = async () => {
    if (!supabaseConfigured) { setErr("MFA requereix Supabase configurat"); return; }
    const sb = browserSupabase();
    const r = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Assessoria 3.0 ${new Date().toISOString().slice(0, 10)}` });
    if (r.error) { setErr(r.error.message); return; }
    setEnroll({ id: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret });
  };
  const verify = async () => {
    const sb = browserSupabase();
    const c = await sb.auth.mfa.challenge({ factorId: enroll!.id });
    if (c.error) { setErr(c.error.message); return; }
    const v = await sb.auth.mfa.verify({ factorId: enroll!.id, challengeId: c.data.id, code });
    if (v.error) { setErr("Codi incorrecte"); return; }
    setEnroll(null); setCode(""); toast({ title: "Verificació en dos passos activada", tone: "ok" }); reload();
  };
  const internal = d.people.filter((p) => ["admin", "cap_administrativa", "administrativa"].includes(p.role));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {err && <div className="lg:col-span-2"><Notice tone="red">{err}</Notice></div>}
      <Panel title="Verificació en dos passos (MFA)">
        <p className="mb-2 text-[12.5px] text-muted">El teu nivell actual: <b>{d.me.current === "aal2" ? "verificat amb segon factor" : "només contrasenya"}</b>. Configura el teu segon factor abans d&apos;exigir-lo als altres.</p>
        {enroll ? (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <p className="text-[12.5px]">Escaneja el codi QR amb una aplicació d&apos;autenticació (Google Authenticator, Microsoft Authenticator, 1Password…) i escriu el codi de 6 xifres.</p>
            <img src={enroll.qr} alt="Codi QR per configurar el segon factor" className="h-40 w-40 rounded-lg bg-white p-2" />
            <p className="font-mono text-[11px] text-muted">Clau: {enroll.secret}</p>
            <div className="flex gap-2"><input className="input h-9 w-32 font-mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Codi de verificació" /><Button size="sm" variant="primary" onClick={() => void verify()} disabled={code.length !== 6}>Verifica</Button></div>
          </div>
        ) : <Button size="sm" onClick={() => void startEnroll()}><KeyRound size={13} /> Configura el meu segon factor</Button>}
        <div className="mt-4 space-y-2 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={mfa.enforced} onChange={(e) => setMfa({ ...mfa, enforced: e.target.checked })} /> Exigir MFA per accedir al CRM intern als rols:</label>
          <div className="flex flex-wrap gap-3 pl-6 text-[12.5px]">{(["admin", "cap_administrativa", "cap_equip", "administrativa", "comercial"] as const).map((r) => <label key={r} className="flex items-center gap-1.5"><input type="checkbox" checked={mfa.roles.includes(r)} onChange={(e) => setMfa({ ...mfa, roles: e.target.checked ? [...mfa.roles, r] : mfa.roles.filter((x) => x !== r) })} />{ROLE_LABEL[r]}</label>)}</div>
          <Button size="sm" variant="primary" onClick={() => void save({ mfa })}>Desa la política</Button>
          <p className="text-[11.5px] text-muted">Quan s&apos;exigeix, el servidor rebutja les peticions internes d&apos;aquests rols sense el segon factor verificat (nivell aal2 de Supabase Auth).</p>
        </div>
      </Panel>
      <Panel title="Informes automàtics · destinataris interns">
        <p className="mb-2 text-[12.5px] text-muted">Només Direcció i l&apos;equip d&apos;administració. Cada informe es genera amb els permisos de qui el rep i s&apos;envia per SMTP (si no hi ha SMTP, queda pendent).</p>
        <table className="w-full text-[12.5px]"><thead className="text-[11px] text-muted"><tr><th className="py-1 text-left font-medium">Persona</th>{(["diari", "setmanal", "mensual"] as const).map((k) => <th key={k} className="font-medium">{k}</th>)}</tr></thead>
          <tbody>{internal.map((p) => <tr key={p.id} className="border-t border-line"><td className="py-1.5">{p.name} <span className="text-muted">· {ROLE_LABEL[p.role as Role]}</span></td>{(["diari", "setmanal", "mensual"] as const).map((k) => <td key={k} className="text-center"><input type="checkbox" aria-label={`${p.name} ${k}`} checked={rep[k].includes(p.id)} onChange={(e) => setRep({ ...rep, [k]: e.target.checked ? [...rep[k], p.id] : rep[k].filter((x) => x !== p.id) })} /></td>)}</tr>)}</tbody></table>
        <Button size="sm" variant="primary" className="mt-2" onClick={() => void save({ reports: rep })}>Desa els destinataris</Button>
      </Panel>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState<{ id: number; at: string; actor_name: string | null; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown> | null }[] | null>(null);
  const [action, setAction] = useState("");
  useEffect(() => { api.perms<{ rows: typeof rows }>("audit", action ? { action } : {}).then((r) => setRows(r.rows)).catch(() => setRows([])); }, [action]);
  return (
    <Panel title="Auditoria de seguretat (només afegir)" action={<select className="input h-8 w-auto text-[12px]" aria-label="Acció" value={action} onChange={(e) => setAction(e.target.value)}><option value="">Totes les accions</option>{["permis_rol", "permis_usuari", "canvi_rol", "alta_usuari", "baixa_usuari", "acces_suspes", "acces_reactivat", "esborrat", "liquidacio_aprovada", "liquidacio_pagada", "mfa_politica", "destinataris_informes"].map((a) => <option key={a} value={a}>{a}</option>)}</select>}>
      {!rows ? <Loader2 className="mx-auto animate-spin text-muted" /> : !rows.length ? <p className="py-6 text-center text-[12.5px] text-muted">Sense registres.</p> : (
        <div className="max-h-[60vh] overflow-y-auto"><table className="w-full text-[12px]"><thead className="sticky top-0 bg-surface text-left text-[11px] text-muted"><tr><th className="py-1 font-medium">Quan</th><th className="font-medium">Qui</th><th className="font-medium">Acció</th><th className="font-medium">Element</th><th className="font-medium">Detall</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-line align-top"><td className="py-1.5 pr-2 whitespace-nowrap">{fdt(r.at)}</td><td className="pr-2">{r.actor_name ?? "Sistema"}</td><td className="pr-2 font-mono text-[11px]">{r.action}</td><td className="pr-2 text-muted">{r.entity}{r.entity_id ? ` · ${r.entity_id.slice(0, 40)}` : ""}</td><td className="font-mono text-[10.5px] text-muted">{r.detail ? JSON.stringify(r.detail).slice(0, 140) : ""}</td></tr>)}</tbody></table></div>
      )}
    </Panel>
  );
}
