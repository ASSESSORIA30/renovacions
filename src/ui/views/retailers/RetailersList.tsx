"use client";
/**
 * COMERCIALITZADORES (Fase 8.1): llistat de fitxes, panell econòmic de Direcció i garanties per enviar contractes a la IA.
 */
import { TemplateStatusPill } from "./ReadingTemplates";
import { tplApi, type TemplateRow } from "./templates-api";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Building2, CheckCircle2, CircleDashed, Loader2, Plus, RefreshCw, ShieldCheck, Stethoscope, XCircle } from "lucide-react";
import { useApp } from "@/data/store";
import { Button, Modal, Notice, SupplierMark, Tabs, cn } from "../../components/ui";
import { Panel, PageHead, Pill, Skeleton, Stat, eur, num } from "../consolidacio/shared";
import { inFilter, rApi, SERVICES, STATUS_LABEL, STATUS_TONE, type AiInfo, type Retailer, type StatusFilter } from "./api";
import { useViewState } from "../../useViewState";
import { ExportButton } from "../../components/ExportButton";

type Row = Retailer & { documents: number; vigents: number; venciments: number; pendents: number };
type List = { rows: Row[]; ai: AiInfo; canEdit: boolean; canApprove: boolean; economic: boolean };

export function RetailersView() {
  const go = useApp((s) => s.navigate);
  const params = useApp((s) => s.params);
  const [tab, setTab] = useState<"fitxes" | "panell">(params.tab === "panell" ? "panell" : "fitxes");
  const [d, setD] = useState<List | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [policy, setPolicy] = useState(false);
  const [check, setCheck] = useState(false);
  const [sf, setSf] = useViewState<StatusFilter>("retailers.status", "actives");
  const [tpl, setTpl] = useState<Record<string, TemplateRow[]>>({});
  const load = useCallback(async () => { try { setD(await rApi.get<List>("list")); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="red">{err}</Notice></div>;
  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:px-6">
      <TemplatesLoader onLoad={setTpl} enabled={!!d?.canEdit} />
      <PageHead icon={<Building2 size={16} />} title="Comercialitzadores" sub="Fitxes, contractes de col·laboració, lectura intel·ligent de les condicions i regles de remuneració i retrocessió. Res s'activa sense l'aprovació de Direcció." tone="from-emerald-600 to-teal-500">
        {d?.canEdit && <Button size="sm" variant="primary" onClick={() => setCreate(true)}><Plus size={13} /> Nova comercialitzadora</Button>}
        {d?.canApprove && <Button size="sm" onClick={() => setPolicy(true)}><ShieldCheck size={13} /> Garanties IA</Button>}
        {d?.canApprove && <Button size="sm" onClick={() => setCheck(true)}><Stethoscope size={13} /> Diagnòstic del lector IA</Button>}
        <ExportButton set="comercialitzadores" />
        <Button size="sm" onClick={() => void load()}><RefreshCw size={13} /></Button>
      </PageHead>
      {d && <AiBanner ai={d.ai} />}
      {useApp.getState().params.lector === "1" && <Notice tone="blue"><b>Lector IA de condicions comercials.</b> Tria la comercialitzadora i prem «PUJAR CONTRACTE I ANALITZAR AMB IA». Un sol document es llegeix sencer: comissions, decomissions i retrocessions relacionades per producte, amb una comprovació de coherència i una única importació.</Notice>}
      <Tabs value={tab} onChange={setTab} items={[{ id: "fitxes", label: "Fitxes", count: d?.rows.length }, ...(d?.economic ? [{ id: "panell" as const, label: "Panell econòmic" }] : [])]} />
      {d && tab === "fitxes" && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtra per estat">
          {([["actives", "Actives"], ["desactivades", "Desactivades"], ["arxivades", "Arxivades"], ["totes", "Totes"]] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={sf === k} onClick={() => setSf(k)} className={cn("pressable rounded-full border px-3 py-1 text-[12px] font-medium", sf === k ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:text-ink")}>
              {l} <span className="tnum opacity-70">{d.rows.filter((r) => inFilter(r.status, k)).length}</span>
            </button>
          ))}
        </div>
      )}
      {!d ? <Skeleton rows={2} /> : tab === "panell" ? <EconomicPanel /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {d.rows.filter((r) => inFilter(r.status, sf)).map((r) => (
            <button key={r.id} onClick={() => go("comercialitzadora", { id: r.id })} className="pressable flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-left hover:border-ink/20">
              <div className="flex items-center gap-2.5"><SupplierMark name={r.trade_name} size={30} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{r.trade_name}</p><p className="truncate text-[12px] text-muted">{r.legal_name ?? "—"}{r.tax_id ? ` · ${r.tax_id}` : ""}</p></div><Pill className={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill></div>
              <p className="text-[12px] text-muted">{r.services.map((s) => SERVICES[s]).join(" · ") || "Serveis per definir"}</p>
              <div className="flex flex-wrap gap-1.5 text-[11.5px]">
                <Pill className="bg-ink/[0.05]">{r.vigents} contractes vigents</Pill>
                {r.venciments > 0 && <Pill className="bg-amber-500/14 text-amber-800 dark:text-amber-300">{r.venciments} a prop de vèncer</Pill>}
                {r.pendents > 0 && <Pill className="bg-sky-500/12 text-sky-700 dark:text-sky-300">{r.pendents} condicions per revisar</Pill>}
                {tpl[r.id]?.length ? <span className="inline-flex items-center gap-1" title="Plantilles de lectura IA">Plantilles IA: {tpl[r.id].map((t) => <TemplateStatusPill key={t.id} status={t.status} />)}</span> : null}
              </div>
            </button>
          ))}
          {!d.rows.length && <Panel title="Encara no hi ha comercialitzadores" empty="Crea la primera fitxa i puja-hi el contracte de col·laboració." />}
          {d.rows.length > 0 && !d.rows.some((r) => inFilter(r.status, sf)) && <Panel title="Cap comercialitzadora en aquest estat" empty="Canvia el filtre per veure-les totes." />}
        </div>
      )}
      <CreateModal open={create} onClose={() => setCreate(false)} onDone={(id) => go("comercialitzadora", { id })} />
      {check && <AiCheckModal onClose={() => setCheck(false)} />}
      {d && <PolicyModal open={policy} onClose={() => setPolicy(false)} ai={d.ai} onDone={() => void load()} />}
    </div>
  );
}

export function AiBanner({ ai }: { ai: AiInfo }) {
  if (!ai.configured) return <Notice tone="blue">Lectura amb el <b>lector local</b> (sense IA): no hi ha cap proveïdor d&apos;IA configurat al servidor. Els contractes no surten de la plataforma. Els documents escanejats s&apos;hauran d&apos;introduir a mà.</Notice>;
  if (!ai.policy.enabled) return <Notice tone="amber">La IA està <b>desactivada per als contractes</b> fins que Direcció confirmi les garanties de confidencialitat (acord de tractament de dades amb el proveïdor). Mentrestant s&apos;usa el lector local i res no s&apos;envia fora.</Notice>;
  return <Notice tone="green">Lectura amb IA activada amb garanties (DPA: {ai.policy.dpa_reference}{ai.policy.zero_retention ? " · retenció zero" : ""}) confirmades per {ai.policy.confirmed_by}. Cada enviament queda a l&apos;auditoria.</Notice>;
}

function CreateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    try {
      const r = await rApi.act<{ id: string }>("save", { trade_name: String(f.get("trade_name")), legal_name: String(f.get("legal_name") || "") || null, tax_id: String(f.get("tax_id") || "") || null, services: f.getAll("services").map(String), status: "pendent" });
      onClose(); onDone(r.id);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Nova comercialitzadora">
      <form onSubmit={submit} className="space-y-3 text-[13px]">
        <label className="block">Nom comercial *<input name="trade_name" required maxLength={120} className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" placeholder="Ha de coincidir amb el nom dels contractes del CRM" /></label>
        <label className="block">Raó social<input name="legal_name" maxLength={200} className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
        <label className="block">CIF<input name="tax_id" maxLength={20} className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" /></label>
        <fieldset><legend className="mb-1">Serveis</legend><div className="flex flex-wrap gap-3">{Object.entries(SERVICES).map(([k, v]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="services" value={k} />{v}</label>)}</div></fieldset>
        {err && <Notice tone="red">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button type="button" onClick={onClose}>Cancel·la</Button><Button type="submit" variant="primary" disabled={busy}>Crea</Button></div>
      </form>
    </Modal>
  );
}

function PolicyModal({ open, onClose, ai, onDone }: { open: boolean; onClose: () => void; ai: AiInfo; onDone: () => void }) {
  const [p, setP] = useState({ enabled: ai.policy.enabled, dpa_reference: ai.policy.dpa_reference ?? "", zero_retention: ai.policy.zero_retention, no_training: ai.policy.no_training, note: ai.policy.note ?? "" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setP({ enabled: ai.policy.enabled, dpa_reference: ai.policy.dpa_reference ?? "", zero_retention: ai.policy.zero_retention, no_training: ai.policy.no_training, note: ai.policy.note ?? "" }); }, [open, ai]);
  const save = async () => { setErr(null); try { await rApi.act("ai_policy", { ...p, dpa_reference: p.dpa_reference || null, note: p.note || null }); onDone(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <Modal open={open} onClose={onClose} title="Garanties per enviar contractes a la IA" width="max-w-xl" footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" onClick={() => void save()}>Desa</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Els contractes amb comercialitzadores són confidencials. Només s&apos;enviaran al proveïdor d&apos;IA si Direcció confirma que hi ha un acord de tractament de dades vigent. Sense aquesta confirmació, s&apos;usa el lector local i res no surt de la plataforma.</p>
        {!ai.configured && <Notice tone="amber">El servidor no té cap clau de proveïdor d&apos;IA (ANTHROPIC_API_KEY). Encara que ho activis, s&apos;usarà el lector local.</Notice>}
        <label className="block">Referència de l&apos;acord de tractament de dades (DPA) *<input className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" value={p.dpa_reference} onChange={(e) => setP({ ...p, dpa_reference: e.target.value })} placeholder="p. ex. DPA signat el … (enllaç o número)" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={p.no_training} onChange={(e) => setP({ ...p, no_training: e.target.checked })} /> Confirmo que, segons l&apos;acord, el proveïdor no fa servir les dades per entrenar models.</label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={p.zero_retention} onChange={(e) => setP({ ...p, zero_retention: e.target.checked })} /> L&apos;acord inclou retenció zero de les dades (opcional, si s&apos;ha contractat).</label>
        <label className="block">Notes<textarea className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" rows={2} value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} /></label>
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} /> Activar la lectura de contractes amb IA</label>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

type Dash = {
  from: string; totals: Record<string, number>; unmatchedContracts: number; alerts: { kind: string; retailerId: string; text: string }[];
  perRetailer: { id: string; name: string; esperades: number; meritades: number; facturades: number; cobrades: number; pendents: number; retrocessionsPotencials: number; retrocessionsAplicades: number; contractesActivats: number; contractesActius: number; mwh: number; renovacions: number; diferencies: number; infrapagaments: { gap: number }[]; productes: { producte: string; contractes: number; mwh: number; esperat: number }[]; evolucio: { month: string; cobrat: number; contractes: number }[] }[];
};
function EconomicPanel() {
  const go = useApp((s) => s.navigate);
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string>("");
  useEffect(() => { rApi.get<Dash>("dashboard").then((x) => { setD(x); setSel(x.perRetailer.find((r) => r.cobrades || r.esperades)?.id ?? x.perRetailer[0]?.id ?? ""); }, (e) => setErr(e instanceof Error ? e.message : String(e))); }, []);
  if (err) return <Notice tone="red">{err}</Notice>;
  if (!d) return <Skeleton rows={2} />;
  const t = d.totals;
  const cur = d.perRetailer.find((r) => r.id === sel);
  const axis = { fontSize: 11, stroke: "rgb(var(--muted))", tickLine: false, axisLine: false } as const;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Comissions esperades" value={eur(t.esperades)} hint="Càlcul vigent de la capa proveïdor amb les regles aprovades" />
        <Stat label="Meritades" value={eur(t.meritades)} />
        <Stat label="Facturades" value={eur(t.facturades)} />
        <Stat label="Cobrades" value={eur(t.cobrades)} tone="green" hint="Només cobraments confirmats amb referència bancària" />
        <Stat label="Pendents de cobrar" value={eur(t.pendents)} tone={t.pendents ? "amber" : undefined} hint="max(meritades, facturades) − cobrades" />
        <Stat label="Retrocessions potencials" value={eur(t.retrocessionsPotencials)} tone={t.retrocessionsPotencials ? "amber" : undefined} hint="Si els contractes dins del període de risc es donessin de baixa avui (regles aprovades)" />
        <Stat label="Retrocessions aplicades" value={eur(t.retrocessionsAplicades)} tone={t.retrocessionsAplicades ? "red" : undefined} hint="Només les registrades amb evidència" />
      </div>
      {d.alerts.length > 0 && <Panel title={<span className="flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-500" /> Alertes</span>}><ul className="space-y-1 text-[12.5px]">{d.alerts.map((a, i) => <li key={i}><button className="text-left hover:text-brand" onClick={() => go("comercialitzadora", { id: a.retailerId })}>{a.kind === "infrapagament" ? "💶 " : "📅 "}{a.text}</button></li>)}</ul></Panel>}
      <Panel title="Per comercialitzadora">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead className="text-left text-[11.5px] text-muted"><tr><th className="py-1.5">Comercialitzadora</th><th className="text-right">Esperades</th><th className="text-right">Facturades</th><th className="text-right">Cobrades</th><th className="text-right">Pendents</th><th className="text-right">Retroc. potencials</th><th className="text-right">Retroc. aplicades</th><th className="text-right">Activats</th><th className="text-right">MWh actius</th><th className="text-right">Renov. 90 d</th><th className="text-right">Diferències</th></tr></thead>
            <tbody className="divide-y divide-line">{d.perRetailer.map((r) => (
              <tr key={r.id} className={cn("cursor-pointer hover:bg-ink/[0.03]", sel === r.id && "bg-ink/[0.04]")} onClick={() => setSel(r.id)}>
                <td className="py-2 font-medium">{r.name}</td><td className="text-right tnum">{eur(r.esperades)}</td><td className="text-right tnum">{eur(r.facturades)}</td><td className="text-right tnum">{eur(r.cobrades)}</td><td className="text-right tnum">{eur(r.pendents)}</td>
                <td className="text-right tnum">{eur(r.retrocessionsPotencials)}</td><td className="text-right tnum">{eur(r.retrocessionsAplicades)}</td><td className="text-right tnum">{r.contractesActivats}</td><td className="text-right tnum">{num(r.mwh, 1)}</td><td className="text-right tnum">{r.renovacions}</td>
                <td className={cn("text-right tnum", r.infrapagaments.length && "font-semibold text-red-600")}>{r.diferencies}{r.infrapagaments.length ? ` (${r.infrapagaments.length} per sota)` : ""}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {d.unmatchedContracts > 0 && <p className="mt-2 text-[11.5px] text-muted">{d.unmatchedContracts} contractes del CRM tenen un nom de comercialitzadora que no coincideix amb cap fitxa. Afegeix-lo com a àlies a la fitxa corresponent.</p>}
      </Panel>
      {cur && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title={`Cobrat per mes · ${cur.name}`}>
            <div className="h-52"><ResponsiveContainer><BarChart data={cur.evolucio} margin={{ left: 0, right: 4, top: 4 }}><CartesianGrid stroke="rgb(var(--line))" vertical={false} /><XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} {...axis} /><YAxis {...axis} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} /><Tooltip cursor={{ fill: "rgb(var(--ink) / 0.05)" }} formatter={(v) => [eur(Number(v)), "Cobrat"]} /><Bar dataKey="cobrat" fill="rgb(var(--brand))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          </Panel>
          <Panel title={`Rendiment per producte · ${cur.name}`} empty={!cur.productes.length && "Sense contractes"}>
            <table className="w-full text-[12.5px]"><thead className="text-left text-[11.5px] text-muted"><tr><th className="py-1">Producte</th><th className="text-right">Contractes</th><th className="text-right">MWh</th><th className="text-right">Esperat</th></tr></thead>
              <tbody className="divide-y divide-line">{cur.productes.map((p) => <tr key={p.producte}><td className="py-1.5">{p.producte}</td><td className="text-right tnum">{p.contractes}</td><td className="text-right tnum">{num(p.mwh, 1)}</td><td className="text-right tnum">{eur(p.esperat)}</td></tr>)}</tbody></table>
          </Panel>
        </div>
      )}
    </div>
  );
}

/* ======================================================================= diagnòstic real del lector IA */

type CStep = { id: string; label: string; ok: boolean | null; detail: string };
type ReadRes = { ms: number; diag: string; mode: string; truncated: boolean; tokens: { in: number; out: number }; pages: number; products: string[]; terms: number; rejected: number; warnings: string[]; checks: CStep[]; passed: number; reader: unknown };
type VerRes = { ms: number; diag: string; mode: string; truncated: boolean; missing: string[]; issues: string[]; contradictions: string[] };
const Mark = ({ ok }: { ok: boolean | null }) => (ok == null ? <CircleDashed size={15} className="mt-0.5 shrink-0 text-muted" /> : ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-red-600" />);

function AiCheckModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<{ steps: CStep[]; ready: boolean } | null>(null);
  const [read, setRead] = useState<ReadRes | null>(null);
  const [ver, setVer] = useState<VerRes | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async <T,>(step: string, label: string, data: Record<string, unknown>, set: (v: T) => void) => {
    setBusy(label); setErr(null);
    try { set(await rApi.act<T>("ai_check", { step, ...data })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  useEffect(() => { void run("config", "Comprovant la configuració…", {}, setCfg); }, []);
  return (
    <Modal open onClose={() => !busy && onClose()} title="Diagnòstic del lector IA (proveïdor real)" width="max-w-3xl" footer={<Button onClick={onClose} disabled={!!busy}>Tanca</Button>}>
      <div className="space-y-4 text-[13px]">
        <p className="text-muted">Prova el lector contra el proveïdor d&apos;IA <b>real</b> amb un contracte de prova fictici de 24 pàgines (comissions a la pàg. 3, retrocessions a la 18 i excepcions a la 21). No desa res ni envia cap document de clients.</p>
        <section className="space-y-1.5">
          <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted">1. Configuració</h4>
          {!cfg ? <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Comprovant…</p> : cfg.steps.map((s) => <p key={s.id} className="flex items-start gap-2"><Mark ok={s.ok} /><span><b>{s.label}</b><span className="block text-[12px] text-muted">{s.detail}</span></span></p>)}
        </section>
        <section className="space-y-1.5">
          <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted">2. Lectura real del contracte de prova</h4>
          {!read && <Button variant="primary" disabled={!cfg?.ready || !!busy} onClick={() => void run("read", "La IA llegeix les 24 pàgines… (1-3 minuts)", {}, setRead)}>Fes la lectura real</Button>}
          {read && (
            <div className="space-y-1.5">
              <p className={read.passed === read.checks.length ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium text-amber-700 dark:text-amber-400"}>{read.passed} de {read.checks.length} comprovacions correctes · {read.terms} condicions · {read.pages} pàgines · {Math.round(read.ms / 1000)} s · {read.tokens.in.toLocaleString("ca-ES")} + {read.tokens.out.toLocaleString("ca-ES")} tokens · resposta per {read.mode === "tool" ? "eina estructurada" : "JSON"}{read.truncated ? " · TALLADA" : ""} · diagnòstic {read.diag}</p>
              <p className="text-[12px] text-muted">Productes: {read.products.join(" · ") || "cap"}{read.rejected ? ` · ${read.rejected} condicions descartades per format` : ""}</p>
              {read.checks.map((c) => <p key={c.id} className="flex items-start gap-2"><Mark ok={c.ok} /><span>{c.label}<span className="block text-[11.5px] text-muted">{c.detail}</span></span></p>)}
              {read.warnings.length > 0 && <p className="text-[11.5px] text-amber-700 dark:text-amber-400">{read.warnings.join(" · ")}</p>}
            </div>
          )}
        </section>
        <section className="space-y-1.5">
          <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted">3. Segona passada (comprovació de coherència)</h4>
          {!ver && <Button disabled={!read || !!busy} onClick={() => void run("verify", "La IA revisa la coherència… (1-2 minuts)", { reader: read?.reader }, setVer)}>Fes la comprovació</Button>}
          {ver && <div className="space-y-1 text-[12.5px]"><p className="font-medium text-emerald-700 dark:text-emerald-400">Feta en {Math.round(ver.ms / 1000)} s · diagnòstic {ver.diag}{ver.truncated ? " · TALLADA" : ""}</p><p>Condicions que faltaven: {ver.missing.length ? ver.missing.join(" · ") : "cap"}</p><p>Observacions: {ver.issues.length ? ver.issues.join(" · ") : "cap"}</p>{ver.contradictions.length > 0 && <p>Contradiccions: {ver.contradictions.join(" · ")}</p>}</div>}
        </section>
        {busy && <p className="flex items-center gap-2 rounded-lg bg-ink/[0.04] p-2.5"><Loader2 size={14} className="animate-spin" />{busy}</p>}
        {err && <Notice tone="red">{err}</Notice>}
        <p className="text-[11.5px] text-muted">Després d&apos;aquest diagnòstic, la prova completa (desar i aprovar a Supabase) es fa pujant <i>contracte_prova_comissions_retrocessions.pdf</i> a una comercialitzadora de prova i prement «APROVAR I IMPORTAR CONDICIONS COMERCIALS»; les regles apareixen a «Regles aprovades» i a Economia → Comissions.</p>
      </div>
    </Modal>
  );
}

/** Estat de les plantilles de lectura IA per comercialitzadora (indicador visual de les fitxes). */
function TemplatesLoader({ onLoad, enabled }: { onLoad: (m: Record<string, TemplateRow[]>) => void; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    tplApi.list().then((r) => { const m: Record<string, TemplateRow[]> = {}; for (const t of r.templates) if (t.retailer_id) (m[t.retailer_id] ??= []).push(t); onLoad(m); }).catch(() => undefined);
  }, [enabled, onLoad]);
  return null;
}
