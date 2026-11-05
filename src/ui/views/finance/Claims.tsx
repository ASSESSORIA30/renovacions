"use client";
/**
 * RECLAMACIONS A COMERCIALITZADORES (Fase 8.2).
 * Panell d'indicadors → taula de discrepàncies (selecció individual o de totes les elegibles) → «Generar reclamació»
 * (PDF + esborrany de correu) → expedient de seguiment (enviament confirmat, respostes, justificants, recordatoris,
 * tasques, regularitzacions i imports recuperats). Les hipòtesis de motiu són sempre hipòtesis, mai fets.
 */
import { DropArea } from "../../components/DropZone";
import { CupsLink } from "../../components/Navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Bell, Bot, CheckCircle2, ShieldCheck, ClipboardList, Download, FileText, Inbox, Loader2, Mail, Paperclip, Plus, RefreshCw, Scale, Send, Sparkles, Trash2, Undo2, Users, XCircle,
} from "lucide-react";
import { CLAIM_STATUS_LABEL, DISC_LABEL, ELIG_LABEL, ITEM_KIND_LABEL, type ClaimStatus, type DiscKind, type DiscRow, type Eligibility, type Hypothesis, type ItemKind } from "@/core/claims";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, Tabs, cn } from "../../components/ui";
import { ApiError } from "../crm/api";
import { eur, fmtD } from "./api";
import { ExportButton } from "../../components/ExportButton";

/* ------------------------------------------------------------------ API */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new ApiError(0, "No hi ha connexió amb el servidor."); }
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
const cApi = {
  get: <T,>(r: string, p: Record<string, string | undefined> = {}) => call<T>(`/api/claims?${new URLSearchParams({ r, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string> })}`),
  act: <T = { ok?: boolean; id?: string },>(action: string, b: { id?: string; ref?: string; data?: unknown } = {}) => call<T>("/api/claims", { method: "POST", body: JSON.stringify({ action, ...b }) }),
  pdf: (id: string, lang?: string, inline = false) => `/api/claims?r=pdf&id=${encodeURIComponent(id)}${lang ? `&lang=${lang}` : ""}${inline ? "&inline=1" : ""}`,
};
const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STONE: Record<ClaimStatus, "zinc" | "amber" | "green" | "blue" | "red"> = { esborrany: "zinc", pendent_enviament: "amber", enviada: "blue", pendent_resposta: "blue", en_revisio: "amber", acceptada_total: "green", acceptada_parcial: "green", rebutjada: "red", resolta: "zinc" };
const ETONE: Record<Eligibility, "green" | "amber" | "zinc"> = { reclamable: "green", revisio: "amber", no_reclamable: "zinc" };
const KTONE: Record<DiscKind, "zinc" | "amber" | "green" | "blue" | "red"> = { correcte: "green", inferior: "red", superior: "blue", pendent_liquidacio: "amber", retrocessio: "amber", duplicat: "zinc", no_identificat: "zinc", sense_regla: "zinc" };
const RSTATUS = { pendent: "Pendent", reclamada: "Reclamada", resolta: "Resolta" } as const;

type Claim = { id: string; code: string; retailer: string; period_from: string; period_to: string; status: ClaimStatus; total_claimed: string; total_recognized: string; total_recovered: string; items_count: number; assigned_to: string | null; sent_at: string | null; response_due: string | null; created_at: string };
type Overview = { scope: "staff" | "assignee"; retailers: string[]; from: string | null; to: string | null; retailer: string | null; rows: DiscRow[]; kpis: null | { discrepancies: string; claimable: string; claimed: string; recovered: string; awaiting: string; contracts: number; open: number; resolved: number; counts: Record<DiscKind, number> }; claims: Claim[]; terms: null | { paymentDays: number | null; claimDays: number | null; paymentRef?: { label: string } | null }; people: { id: string; name: string; role: string }[]; canEdit: boolean };

export function ClaimsView() {
  const id = useApp((s) => s.params.id);
  return id ? <ClaimDetail key={id} id={id} /> : <ClaimsHome />;
}

/* ================================================================== panell + discrepàncies */
const iso = (d: Date) => d.toISOString().slice(0, 10);
function prevMonth() { const d = new Date(); return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))) }; }

function ClaimsHome() {
  const [f, setF] = useState(() => ({ retailer: "", ...prevMonth() }));
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"discrepancies" | "claims">("discrepancies");
  const [only, setOnly] = useState<"" | Eligibility>("");
  const [kind, setKind] = useState<"" | DiscKind>("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [explain, setExplain] = useState<DiscRow | null>(null);
  const [gen, setGen] = useState(false);
  const [contacts, setContacts] = useState(false);
  const go = useApp((s) => s.navigate);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await cApi.get<Overview>("overview", f); setD(r); setErr(null); setSel(new Set()); }
    catch (e) { setErr(errMsg(e)); } finally { setLoading(false); }
  }, [f]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (d?.rows ?? []).filter((r) => (!only || r.eligibility === only) && (!kind || r.kind === kind)), [d, only, kind]);
  const eligible = useMemo(() => (d?.rows ?? []).filter((r) => r.selectable), [d]);
  const chosen = useMemo(() => (d?.rows ?? []).filter((r) => sel.has(r.key)), [d, sel]);
  const chosenTotal = chosen.reduce((s, r) => s + Number(r.claimable), 0);
  const k = d?.kpis;

  if (d?.scope === "assignee") return <AssigneeList claims={d.claims} />;
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-semibold tracking-tight">Reclamacions a comercialitzadores</h2><p className="text-[13px] text-muted">Compara el que han liquidat amb les regles aprovades, selecciona les diferències reclamables i genera una sola reclamació amb PDF i correu.</p></div>
        <div className="flex gap-2">
          <ExportButton set="reclamacions" params={{ retailer: f.retailer }} />
          {f.retailer && <Button size="sm" onClick={() => setContacts(true)}><Users size={13} /> Contactes de liquidacions</Button>}
          <Button size="sm" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Actualitza</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Comercialitzadora" value={f.retailer} onChange={(e) => setF({ ...f, retailer: e.target.value })}><option value="">Totes les comercialitzadores</option>{(d?.retailers ?? []).map((r) => <option key={r}>{r}</option>)}</select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">Període <input type="date" className="input h-9 w-auto" aria-label="Des de" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /> – <input type="date" className="input h-9 w-auto" aria-label="Fins a" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        {d?.terms && <span className="text-[12px] text-muted">{d.terms.paymentDays != null ? `Termini de pagament aprovat: ${d.terms.paymentDays} dies${d.terms.paymentRef ? ` (${d.terms.paymentRef.label})` : ""}` : "Sense termini de pagament aprovat: els contractes no liquidats queden «a revisar»"}</span>}
      </div>
      {err && <Notice tone="red">{err}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Discrepàncies detectades" value={k ? eur(k.discrepancies) : null} hint="Suma de diferències (comissió inferior, pendents i retrocessions) del període." />
        <Kpi label="Potencialment reclamable" value={k ? eur(k.claimable) : null} hint="Només el que compleix regla aprovada, termini vençut i cap excepció." tone="text-ren" />
        <Kpi label="Import reclamat" value={k ? eur(k.claimed) : null} hint="Reclamacions ja enviades." />
        <Kpi label="Import recuperat" value={k ? eur(k.recovered) : null} hint="Regularitzacions confirmades." tone="text-ren" />
        <Kpi label="Pendent de resposta" value={k ? eur(k.awaiting) : null} hint="Reclamat i encara no recuperat en reclamacions que esperen resposta." tone="text-pend" />
        <Kpi label="Contractes afectats" value={k ? String(k.contracts) : null} />
        <Kpi label="Reclamacions obertes" value={k ? String(k.open) : null} />
        <Kpi label="Reclamacions resoltes" value={k ? String(k.resolved) : null} />
      </div>

      <Tabs value={tab} onChange={setTab} items={[{ id: "discrepancies", label: "Discrepàncies", count: d?.rows.length || undefined }, { id: "claims", label: "Reclamacions", count: d?.claims.length || undefined }]} />
      {tab === "claims" ? <ClaimsTable claims={d?.claims ?? []} onOpen={(id) => go("reclamacions", { id })} /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input h-9 w-auto text-[12.5px]" aria-label="Elegibilitat" value={only} onChange={(e) => setOnly(e.target.value as "" | Eligibility)}><option value="">Totes</option>{(Object.keys(ELIG_LABEL) as Eligibility[]).map((x) => <option key={x} value={x}>{ELIG_LABEL[x]}</option>)}</select>
            <select className="input h-9 w-auto text-[12.5px]" aria-label="Tipus" value={kind} onChange={(e) => setKind(e.target.value as "" | DiscKind)}><option value="">Tots els tipus</option>{(Object.keys(DISC_LABEL) as DiscKind[]).map((x) => <option key={x} value={x}>{DISC_LABEL[x]}{k ? ` (${k.counts[x] ?? 0})` : ""}</option>)}</select>
            <Button size="sm" disabled={!eligible.length || !d?.canEdit} onClick={() => setSel(new Set(eligible.map((r) => r.key)))}><CheckCircle2 size={13} /> Selecciona totes les elegibles ({eligible.length})</Button>
            {sel.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Treu la selecció</Button>}
          </div>
          {!d ? <div className="h-40 animate-pulse rounded-2xl bg-elevated" /> : !rows.length ? (
            <Empty icon={<Scale size={24} />} title={d.rows.length ? "Cap discrepància amb aquests filtres" : "No hi ha liquidacions d'aquest període"} body={d.rows.length ? undefined : "Registra la liquidació mensual a «Conciliació» (Excel o CSV) i torna aquí."} action={!d.rows.length ? <Button size="sm" onClick={() => go("conciliacio")}>Ves a Conciliació</Button> : undefined} />
          ) : <DiscTable rows={rows} sel={sel} setSel={setSel} onExplain={setExplain} showRetailer={!f.retailer} canEdit={d.canEdit} />}
          {sel.size > 0 && (
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lift">
              <span className="text-[13px]"><b>{sel.size}</b> diferència(es) seleccionada(es) · <b className="tnum">{eur(chosenTotal)}</b>{new Set(chosen.map((r) => r.retailer)).size > 1 ? ` · ${new Set(chosen.map((r) => r.retailer)).size} comercialitzadores (es crearà una reclamació per a cadascuna)` : ""}</span>
              <Button variant="primary" className="ml-auto" onClick={() => setGen(true)}><FileText size={14} /> GENERAR RECLAMACIÓ</Button>
            </div>
          )}
        </>
      )}
      {explain && d && <ExplainModal row={explain} from={d.from!} to={d.to!} onClose={() => setExplain(null)} />}
      {gen && d && <GenerateModal rows={chosen} people={d.people} from={d.from!} to={d.to!} onClose={() => setGen(false)} onDone={(id) => { setGen(false); if (id) go("reclamacions", { id }); else void load(); }} />}
      {contacts && f.retailer && <ContactsModal retailer={f.retailer} onClose={() => setContacts(false)} />}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string | null; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5" title={hint}>
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</p>
      {value == null ? <div className="mt-2 h-6 w-24 animate-pulse rounded bg-elevated" /> : <p className={cn("mt-1 text-xl font-semibold tnum", tone)}>{value}</p>}
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function DiscTable({ rows, sel, setSel, onExplain, showRetailer, canEdit }: { rows: DiscRow[]; sel: Set<string>; setSel: (s: Set<string>) => void; onExplain: (r: DiscRow) => void; showRetailer: boolean; canEdit: boolean }) {
  const toggle = (k: string) => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n); };
  return (
    <div className="overflow-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[1250px] text-[12px]">
        <thead className="sticky top-0 bg-elevated text-left text-[10.5px] uppercase tracking-wide text-muted">
          <tr>
            <th className="w-8 px-2 py-2"><span className="sr-only">Selecció</span></th>
            {showRetailer && <th className="px-2">Comercialitzadora</th>}
            <th className="px-2">Empresa / titular</th><th className="px-2">CUPS</th><th className="px-2">Referència</th><th className="px-2">Núm. contracte</th>
            <th className="px-2 text-right">Prevista</th><th className="px-2 text-right">Liquidada</th><th className="px-2 text-right">Diferència</th><th className="px-2 text-right">Pendent de justificar</th>
            <th className="px-2">Discrepància</th><th className="px-2">Motiu</th><th className="px-2">Estat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn("border-t border-line align-top", sel.has(r.key) && "bg-brand/[0.04]")}>
              <td className="px-2 py-2"><input type="checkbox" aria-label={`Selecciona ${r.client ?? r.cups ?? r.key}`} disabled={!r.selectable || !canEdit} checked={sel.has(r.key)} onChange={() => toggle(r.key)} title={r.selectable ? "" : r.status !== "pendent" ? `Ja és a ${r.claim?.code}` : ELIG_LABEL[r.eligibility]} /></td>
              {showRetailer && <td className="px-2 py-2 font-medium">{r.retailer}</td>}
              <td className="max-w-[180px] px-2 py-2"><span className="line-clamp-2">{r.client ?? "—"}</span></td>
              <td className="px-2 py-2 text-[11px]">{r.supply ?? r.cups ? <CupsLink cups={r.supply ?? r.cups} short /> : "—"}</td>
              <td className="px-2 py-2 font-mono text-[11px]">{r.reference ?? r.statementRef ?? "—"}</td>
              <td className="px-2 py-2 font-mono text-[11px]">{r.contractRef ?? "—"}</td>
              <td className="px-2 py-2 text-right tnum">{eur(r.expected)}</td>
              <td className="px-2 py-2 text-right tnum">{eur(r.settled)}</td>
              <td className={cn("px-2 py-2 text-right tnum", r.difference && Number(r.difference) < 0 && "text-lost")}>{eur(r.difference)}</td>
              <td className="px-2 py-2 text-right tnum">{Number(r.pendingJustify) ? eur(r.pendingJustify) : "—"}</td>
              <td className="px-2 py-2"><Badge tone={KTONE[r.kind]}>{DISC_LABEL[r.kind]}</Badge><div className="mt-1"><Badge tone={ETONE[r.eligibility]}>{ELIG_LABEL[r.eligibility]}</Badge></div></td>
              <td className="max-w-[300px] px-2 py-2 text-[11.5px] text-muted">
                <span className="line-clamp-3">{r.reason}</span>
                {!["correcte", "duplicat"].includes(r.kind) && <button className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-brand hover:underline" onClick={() => onExplain(r)}><Sparkles size={11} /> Per què?</button>}
              </td>
              <td className="px-2 py-2">{r.claim ? <button className="text-left" onClick={() => useApp.getState().navigate("reclamacions", { id: r.claim!.claim_id })}><Badge tone={r.status === "resolta" ? "zinc" : "blue"}>{RSTATUS[r.status]}</Badge><span className="block text-[10.5px] text-brand hover:underline">{r.claim.code}</span></button> : <Badge tone="zinc">{RSTATUS[r.status]}</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClaimsTable({ claims, onOpen }: { claims: Claim[]; onOpen: (id: string) => void }) {
  if (!claims.length) return <Empty icon={<Inbox size={24} />} title="Encara no hi ha reclamacions" body="Selecciona diferències reclamables a la pestanya «Discrepàncies» i prem «Generar reclamació»." />;
  return (
    <div className="overflow-auto rounded-2xl border border-line bg-surface">
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Codi</th><th>Comercialitzadora</th><th>Període</th><th>Estat</th><th className="text-right">Contractes</th><th className="text-right">Reclamat</th><th className="text-right">Reconegut</th><th className="text-right">Recuperat</th><th className="px-3">Resposta abans de</th></tr></thead>
        <tbody>{claims.map((c) => (
          <tr key={c.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.02]" onClick={() => onOpen(c.id)}>
            <td className="px-3 py-2 font-mono font-medium">{c.code}</td><td>{c.retailer}</td><td>{fmtD(c.period_from)} – {fmtD(c.period_to)}</td>
            <td><Badge tone={STONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</Badge></td>
            <td className="text-right tnum">{c.items_count}</td><td className="text-right tnum">{eur(c.total_claimed)}</td><td className="text-right tnum">{eur(c.total_recognized)}</td><td className="text-right text-ren tnum">{eur(c.total_recovered)}</td>
            <td className={cn("px-3", c.response_due && c.response_due < new Date().toISOString().slice(0, 10) && ["enviada", "pendent_resposta"].includes(c.status) && "font-medium text-lost")}>{fmtD(c.response_due)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function AssigneeList({ claims }: { claims: Claim[] }) {
  const go = useApp((s) => s.navigate);
  return (
    <div className="mx-auto max-w-[1100px] space-y-4 px-4 py-5 sm:px-6">
      <div><h2 className="text-xl font-semibold tracking-tight">Les meves reclamacions</h2><p className="text-[13px] text-muted">Reclamacions a comercialitzadores que Direcció t&apos;ha assignat.</p></div>
      <ClaimsTable claims={claims} onOpen={(id) => go("reclamacions", { id })} />
    </div>
  );
}

/* ------------------------------------------------------------------ explicació (hipòtesis) */
function ExplainModal({ row, from, to, onClose }: { row: DiscRow; from: string; to: string; onClose: () => void }) {
  const [d, setD] = useState<{ local: { hypotheses: Hypothesis[]; top: Hypothesis; needsReview: boolean }; ai: { text: string; model: string } | null; aiAvailable: boolean; aiReason: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (ai: boolean) => {
    setBusy(true);
    try { setD(await cApi.act("explain", { data: { retailer: row.retailer, from, to, key: row.key, ai } })); setErr(null); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }, [row, from, to]);
  useEffect(() => { void run(false); }, [run]);
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={`Per què hi ha aquesta diferència? · ${row.client ?? row.cups ?? ""}`}
      footer={<><span className="mr-auto text-[11.5px] text-muted">Són hipòtesis per orientar la revisió: no s&apos;han de presentar com a fets.</span>{d?.aiAvailable && <Button disabled={busy} onClick={() => void run(true)}><Bot size={14} /> Analitza amb IA</Button>}<Button onClick={onClose}>Tanca</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">{row.reason}</p>
        {err && <Notice tone="red">{err}</Notice>}
        {!d ? <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Analitzant…</p> : (
          <>
            {d.local.needsReview && <Notice tone="amber"><b>Motiu pendent de revisió.</b> No hi ha prou informació per explicar-la amb seguretat.</Notice>}
            <ul className="space-y-2">
              {d.local.hypotheses.filter((h) => h.code !== "pendent_revisio").map((h, i) => (
                <li key={i} className="rounded-xl border border-line p-3">
                  <div className="flex items-center gap-2"><Badge tone="amber">Hipòtesi</Badge><span className="font-medium">{h.label}</span><span className="ml-auto text-[11px] text-muted">confiança {Math.round(h.confidence * 100)} %</span></div>
                  <p className="mt-1 text-[12.5px] text-muted">{h.detail}</p>
                  {h.refs.length > 0 && <ul className="mt-1.5 space-y-1">{h.refs.map((r, j) => <li key={j} className="text-[11.5px]"><FileText size={11} className="mr-1 inline text-muted" />{r.label}{r.excerpt && <span className="block pl-4 italic text-muted">«{r.excerpt.slice(0, 300)}»</span>}</li>)}</ul>}
                </li>
              ))}
            </ul>
            {d.ai && <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.05] p-3"><p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium"><Bot size={13} /> Hipòtesi de la IA ({d.ai.model}) · no és un fet confirmat</p><p className="whitespace-pre-wrap text-[12.5px]">{d.ai.text}</p></div>}
            {!d.aiAvailable && d.aiReason && <p className="text-[11.5px] text-muted">IA no disponible: {d.aiReason} S&apos;ha fet servir l&apos;anàlisi local (sense enviar dades fora).</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ generar reclamació */
function GenerateModal({ rows, people, from, to, onClose, onDone }: { rows: DiscRow[]; people: { id: string; name: string }[]; from: string; to: string; onClose: () => void; onDone: (id: string | null) => void }) {
  const [lang, setLang] = useState<"es" | "ca">("es");
  const [assignedTo, setAssigned] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const groups = useMemo(() => [...new Set(rows.map((r) => r.retailer))].map((r) => ({ retailer: r, rows: rows.filter((x) => x.retailer === r) })), [rows]);
  const go = async () => {
    setBusy(true); setErr(null);
    const made: { id: string; code: string }[] = [];
    try {
      for (const g of groups) made.push(await cApi.act<{ id: string; code: string }>("create", { data: { retailer: g.retailer, from, to, keys: g.rows.map((r) => r.key), assignedTo: assignedTo || null, lang, responseDays: days } }));
      toast(made.length === 1 ? `Reclamació ${made[0].code} creada` : `${made.length} reclamacions creades`, "Revisa el correu i el PDF abans d'enviar-la.");
      onDone(made.length === 1 ? made[0].id : null);
    } catch (e) { setErr(errMsg(e)); if (made.length) toast(`${made.length} reclamació(ns) creada(es) abans de l'error`, undefined, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Generar reclamació" width="max-w-xl" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={go}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Generar</Button></>}>
      <div className="space-y-3 text-[13px]">
        {groups.map((g) => <p key={g.retailer}><b>{g.retailer}</b>: {g.rows.length} contracte(s) · <b className="tnum">{eur(g.rows.reduce((s, r) => s + Number(r.claimable), 0))}</b></p>)}
        <p className="text-muted">Es generarà l&apos;informe PDF i un esborrany de correu editable. <b>No s&apos;envia res</b> fins que ho confirmis a l&apos;expedient.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="label">Idioma del PDF i del correu</span><select className="input" value={lang} onChange={(e) => setLang(e.target.value as "es" | "ca")}><option value="es">Castellà</option><option value="ca">Català</option></select></label>
          <label className="block"><span className="label">Termini de resposta</span><select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[15, 30, 45, 60].map((n) => <option key={n} value={n}>{n} dies</option>)}</select></label>
          <label className="block"><span className="label">Responsable</span><select className="input" value={assignedTo} onChange={(e) => setAssigned(e.target.value)}><option value="">Jo mateix</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        </div>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ contactes */
type Contact = { id: string; name: string; email: string | null; phone: string | null; role: string; is_default: boolean; notes: string | null };
function ContactsModal({ retailer, onClose }: { retailer: string; onClose: () => void }) {
  const [d, setD] = useState<{ retailer: { id: string; name: string } | null; contacts: Contact[] } | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", is_default: true });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => cApi.get<typeof d & object>("contacts", { retailer }).then(setD).catch((e) => setErr(errMsg(e))), [retailer]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!d?.retailer) return;
    try { await cApi.act("contact_save", { data: { retailer_id: d.retailer.id, name: f.name, email: f.email, phone: f.phone || null, role: "liquidacions", is_default: f.is_default } }); setF({ name: "", email: "", phone: "", is_default: false }); await load(); }
    catch (e) { setErr(errMsg(e)); }
  };
  const del = async (id: string) => { try { await cApi.act("contact_delete", { id }); await load(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal open onClose={onClose} title={`Contactes de liquidacions · ${retailer}`} width="max-w-xl" footer={<Button onClick={onClose}>Tanca</Button>}>
      <div className="space-y-3 text-[13px]">
        {err && <Notice tone="red">{err}</Notice>}
        {d && !d.retailer && <Notice tone="amber">«{retailer}» no té fitxa a Comercialitzadores. Crea-la (o afegeix aquest nom com a àlies) per desar-hi contactes.</Notice>}
        {d?.retailer && (
          <>
            {!d.contacts.length ? <p className="text-muted">Encara no hi ha contactes.</p> : (
              <ul className="divide-y divide-line">{d.contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2"><span className="flex-1"><b>{c.name}</b> {c.is_default && <Badge tone="green">Per defecte</Badge>}<span className="block text-[12px] text-muted">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</span></span><Button size="sm" variant="ghost" aria-label={`Elimina ${c.name}`} onClick={() => del(c.id)}><Trash2 size={13} /></Button></li>
              ))}</ul>
            )}
            <div className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-3">
              <input className="input" placeholder="Nom o departament" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <input className="input" placeholder="correu@comercialitzadora.es" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              <input className="input" placeholder="Telèfon (opcional)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              <label className="flex items-center gap-1.5 text-[12px] sm:col-span-2"><input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} /> Contacte per defecte per a reclamacions</label>
              <Button size="sm" variant="primary" disabled={!f.name.trim()} onClick={save}><Plus size={13} /> Afegeix</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ================================================================== expedient */
type Item = { id: string; kind: ItemKind; client_name: string | null; cups: string | null; external_ref: string | null; contract_ref: string | null; client_id: string | null; expected_amount: string; settled_amount: string; claimed_amount: string; recognized_amount: string; recovered_amount: string; reason_text: string; reason_source: string; status: string; rule_ref: { label: string; excerpt?: string | null } | null };
type Ev = { id: string; at: string; kind: string; status_from: string | null; status_to: string | null; amount: string | null; body: string | null; attachment_path: boolean | null; attachment_name: string | null; user_name: string | null };
type Detail = {
  claim: Claim & { contact_id: string | null; contact_name: string | null; contact_email: string | null; email_subject: string | null; email_body: string | null; sent_channel: string | null; lang: "ca" | "es"; parent_id: string | null; retailer_id: string | null; created_by?: string | null; authorized_at?: string | null; authorized_by?: string | null; authorization_note?: string | null };
  items: Item[]; events: Ev[]; reminders: { id: string; remind_at: string; user_id: string; note: string | null; done_at: string | null; notified_at: string | null }[];
  recoveries: { id: string; amount: string; received_at: string; reference: string | null; note: string | null; item_id: string | null }[];
  links: { id: string; item_id: string | null; amount: string; confidence: number; reason: string; status: string; fin_statement_lines: { amount: string; concept: string | null; cups: string | null; fin_provider_statements: { reference: string; received_at: string } | null } | null }[];
  contacts: Contact[]; people: { id: string; name: string; role: string }[]; parent: { id: string; code: string } | null; children: { id: string; code: string; status: ClaimStatus }[];
  permissions: { role: "staff" | "assignee"; canEdit: boolean; canManage: boolean; transitions: ClaimStatus[] };
};

function ClaimDetail({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "send" | "external" | "response" | "recovery" | "reminder" | "task" | "authorize">(null);
  const go = useApp((s) => s.navigate);
  const load = useCallback(() => cApi.get<Detail>("claim", { id }).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(errMsg(e))), [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (action: string, data?: unknown, ref?: string, ok?: string) => {
    try { await cApi.act(action, { id, data, ref }); if (ok) toast(ok); await load(); return true; } catch (e) { toast("No s'ha pogut fer", errMsg(e), "err"); return false; }
  };
  if (err) return <div className="mx-auto max-w-[1200px] px-4 py-5"><Button size="sm" variant="ghost" onClick={() => go("reclamacions")}><ArrowLeft size={14} /> Reclamacions</Button><div className="mt-3"><Notice tone="red">{err}</Notice></div></div>;
  if (!d) return <div className="mx-auto max-w-[1200px] px-4 py-5"><div className="h-60 animate-pulse rounded-2xl bg-elevated" /></div>;
  const c = d.claim;
  const draft = ["esborrany", "pendent_enviament"].includes(c.status);
  const live = d.items.filter((i) => !["retirada", "traspassada"].includes(i.status));
  const pendingRecovery = Number(c.total_claimed) - Number(c.total_recovered);
  const authorized = !!c.authorized_at;
  const who = (id?: string | null) => d.people.find((p) => p.id === id)?.name ?? "—";
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <Button size="sm" variant="ghost" onClick={() => go("reclamacions")}><ArrowLeft size={14} /> Reclamacions</Button>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
        <div>
          <p className="font-mono text-[12px] text-muted">{c.code}{d.parent && <> · seguiment de <button className="text-brand hover:underline" onClick={() => go("reclamacions", { id: d.parent!.id })}>{d.parent.code}</button></>}</p>
          <h2 className="text-xl font-semibold">{c.retailer} <Badge tone={STONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</Badge></h2>
          <p className="text-[13px] text-muted">Període {fmtD(c.period_from)} – {fmtD(c.period_to)} · {live.length} contracte(s){c.sent_at ? ` · enviada el ${fmtD(c.sent_at)}${c.sent_channel === "extern" ? " (fora del CRM)" : ""}` : ""}{c.response_due ? ` · resposta abans del ${fmtD(c.response_due)}` : ""}</p>
          {d.children.length > 0 && <p className="text-[12px] text-muted">Seguiments: {d.children.map((x) => <button key={x.id} className="mr-2 text-brand hover:underline" onClick={() => go("reclamacions", { id: x.id })}>{x.code}</button>)}</p>}
        </div>
        <div className="grid grid-cols-3 gap-4 text-right">
          <div><p className="text-[11px] uppercase text-muted">Reclamat</p><p className="text-lg font-semibold tnum">{eur(c.total_claimed)}</p></div>
          <div><p className="text-[11px] uppercase text-muted">Reconegut</p><p className="text-lg font-semibold tnum">{eur(c.total_recognized)}</p></div>
          <div><p className="text-[11px] uppercase text-muted">Recuperat</p><p className="text-lg font-semibold text-ren tnum">{eur(c.total_recovered)}</p></div>
        </div>
      </div>
      {draft && (
        <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-3 text-[13px]", authorized ? "border-ren/40 bg-ren/[0.06]" : "border-pend/40 bg-pend/[0.06]")} data-testid="autoritzacio">
          <ShieldCheck size={18} className={authorized ? "text-ren" : "text-pend"} />
          <div className="min-w-0 flex-1">
            {authorized
              ? <p><b>Revisada i autoritzada</b> per {who(c.authorized_by)} el {fmtD(c.authorized_at)}{c.authorization_note ? ` · ${c.authorization_note}` : ""}. Si canvies el correu, el destinatari o les diferències, caldrà tornar-la a autoritzar.</p>
              : <p><b>Pendent de revisió i autorització.</b> Cap reclamació no s&apos;envia sense que Direcció (o qui tingui permís d&apos;aprovació a Economia, diferent de qui l&apos;ha preparada) revisi el PDF, els imports i el correu i l&apos;autoritzi.{!c.contact_email ? " Abans, desa el correu del destinatari." : ""}</p>}
          </div>
          {d.permissions.canEdit && (authorized
            ? <Button size="sm" variant="ghost" onClick={() => void act("authorize", { authorize: false }, undefined, "Autorització retirada")}>Retira l&apos;autorització</Button>
            : <Button size="sm" variant="primary" disabled={!c.contact_email} onClick={() => setModal("authorize")}><ShieldCheck size={13} /> Autoritza l&apos;enviament</Button>)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <a className="inline-flex" href={cApi.pdf(id, undefined, true)} target="_blank" rel="noopener"><Button size="sm"><FileText size={13} /> Veure PDF</Button></a>
        <a className="inline-flex" href={cApi.pdf(id)}><Button size="sm"><Download size={13} /> Descarrega PDF</Button></a>
        {draft && d.permissions.canEdit && <Button size="sm" variant="primary" disabled={!authorized} title={authorized ? undefined : "Cal autoritzar-la abans d'enviar-la"} onClick={() => setModal("send")}><Send size={13} /> Enviar…</Button>}
        {draft && d.permissions.canEdit && <Button size="sm" disabled={!authorized} title={authorized ? undefined : "Cal autoritzar-la abans d'enviar-la"} onClick={() => setModal("external")}>Registrar enviament extern</Button>}
        {!draft && d.permissions.canEdit && c.status !== "resolta" && <Button size="sm" onClick={() => setModal("response")}><Inbox size={13} /> Registrar resposta</Button>}
        {!draft && d.permissions.canEdit && pendingRecovery > 0 && <Button size="sm" onClick={() => setModal("recovery")}><CheckCircle2 size={13} /> Import recuperat</Button>}
        {d.permissions.canEdit && <Button size="sm" onClick={() => setModal("reminder")}><Bell size={13} /> Recordatori</Button>}
        {d.permissions.canEdit && <Button size="sm" onClick={() => setModal("task")}><ClipboardList size={13} /> Tasca</Button>}
        {d.permissions.canEdit && <AttachButton onFile={(name, base64) => act("attachment", { name, base64 }, undefined, "Justificant adjuntat")} />}
        {d.permissions.transitions.filter((s) => !["enviada", "acceptada_total", "acceptada_parcial", "rebutjada"].includes(s)).map((s) => <Button key={s} size="sm" variant="ghost" onClick={() => act("status", { status: s }, undefined, `Estat: ${CLAIM_STATUS_LABEL[s]}`)}>→ {CLAIM_STATUS_LABEL[s]}</Button>)}
        {d.permissions.canManage && !draft && pendingRecovery > 0 && <Button size="sm" variant="ghost" onClick={async () => { try { const r = await cApi.act<{ id: string; code: string }>("follow_up", { id }); toast(`Seguiment ${r.code} creat`); go("reclamacions", { id: r.id }); } catch (e) { toast("No s'ha pogut crear", errMsg(e), "err"); } }}><Undo2 size={13} /> Crear seguiment</Button>}
        {d.permissions.canManage && c.status === "esborrany" && <Button size="sm" variant="ghost" className="text-lost" onClick={async () => { if (confirm(`Eliminar l'esborrany ${c.code}?`)) { if (await act("delete")) go("reclamacions"); } }}><Trash2 size={13} /> Elimina l&apos;esborrany</Button>}
      </div>

      {d.links.some((l) => l.status === "proposada") && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><AlertTriangle size={14} /> Possibles regularitzacions detectades (cal revisió)</h3>
          <ul className="space-y-2 text-[12.5px]">{d.links.filter((l) => l.status === "proposada").map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-2.5">
              <span className="flex-1">Liquidació <b>{l.fin_statement_lines?.fin_provider_statements?.reference ?? "—"}</b> ({fmtD(l.fin_statement_lines?.fin_provider_statements?.received_at)}) · {l.fin_statement_lines?.concept ?? "—"} · <b className="tnum">{eur(l.amount)}</b><span className="block text-[11.5px] text-muted">{l.reason} · confiança {Math.round(l.confidence * 100)} %</span></span>
              <Button size="sm" variant="primary" onClick={() => act("link", { linkId: l.id, accept: true }, undefined, "Regularització registrada")}>Confirmar</Button>
              <Button size="sm" variant="ghost" onClick={() => act("link", { linkId: l.id, accept: false }, undefined, "Proposta descartada")}>Descartar</Button>
            </li>
          ))}</ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section className="overflow-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[900px] text-[12px]">
              <thead className="bg-elevated text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="px-2 py-2">Client / CUPS</th><th className="px-2">Tipus</th><th className="px-2 text-right">Prevista</th><th className="px-2 text-right">Liquidada</th><th className="px-2 text-right">Reclamat</th><th className="px-2 text-right">Reconegut</th><th className="px-2 text-right">Recuperat</th><th className="px-2">Motiu i referència</th><th className="px-2">Estat</th><th /></tr></thead>
              <tbody>{d.items.map((i) => (
                <tr key={i.id} className={cn("border-t border-line align-top", ["retirada", "traspassada"].includes(i.status) && "opacity-50")}>
                  <td className="px-2 py-2"><span className="block font-medium">{i.client_name ?? "—"}</span><span className="text-[10.5px] text-muted">{i.cups ? <CupsLink cups={i.cups} short /> : null}{i.external_ref ? ` · ${i.external_ref}` : ""}</span></td>
                  <td className="px-2 py-2">{ITEM_KIND_LABEL[i.kind]}</td>
                  <td className="px-2 py-2 text-right tnum">{eur(i.expected_amount)}</td><td className="px-2 py-2 text-right tnum">{eur(i.settled_amount)}</td>
                  <td className="px-2 py-2 text-right font-medium tnum">{eur(i.claimed_amount)}</td><td className="px-2 py-2 text-right tnum">{eur(i.recognized_amount)}</td><td className="px-2 py-2 text-right text-ren tnum">{eur(i.recovered_amount)}</td>
                  <td className="max-w-[280px] px-2 py-2 text-[11.5px] text-muted">{i.reason_text}{i.reason_source === "pendent_revisio" && <Badge tone="amber" className="ml-1">Motiu pendent de revisió</Badge>}{i.rule_ref && <span className="mt-0.5 block text-[10.5px]"><FileText size={10} className="mr-0.5 inline" />{i.rule_ref.label}</span>}</td>
                  <td className="px-2 py-2"><Badge tone={i.status === "acceptada" ? "green" : i.status === "rebutjada" ? "red" : i.status === "parcial" ? "amber" : "zinc"}>{i.status}</Badge></td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {draft && d.permissions.canManage && <Button size="sm" variant="ghost" aria-label="Treu de la reclamació" title="Treu de la reclamació" onClick={() => act("remove_item", undefined, i.id, "Línia retirada")}><XCircle size={13} /></Button>}
                    {i.client_id && d.permissions.canEdit && <Button size="sm" variant="ghost" title="Obre una incidència al client" aria-label="Obre una incidència" onClick={() => act("incident", undefined, i.id, "Incidència creada al client")}><AlertTriangle size={13} /></Button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </section>
          <EmailSection d={d} onSave={(data) => act("update", data, undefined, "Desat")} />
        </div>
        <aside className="min-w-0 space-y-4">
          <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Responsable</h3>
            {d.permissions.canManage ? (
              <select className="input" aria-label="Responsable" value={c.assigned_to ?? ""} onChange={(e) => act("update", { assigned_to: e.target.value || null }, undefined, "Responsable actualitzat")}><option value="">Sense assignar</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            ) : <p>{d.people.find((p) => p.id === c.assigned_to)?.name ?? "—"}</p>}
          </section>
          {d.reminders.length > 0 && (
            <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Recordatoris</h3>
              <ul className="space-y-1.5">{d.reminders.map((r) => <li key={r.id} className={cn("flex items-center gap-2", r.done_at && "opacity-50")}><Bell size={12} className="text-muted" /><span className="flex-1">{fmtD(r.remind_at)} · {d.people.find((p) => p.id === r.user_id)?.name ?? "—"}{r.note ? ` · ${r.note}` : ""}</span>{!r.done_at && <Button size="sm" variant="ghost" onClick={() => act("reminder_done", undefined, r.id)}>Fet</Button>}</li>)}</ul>
            </section>
          )}
          <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Historial</h3>
            <ol className="space-y-2">{d.events.map((e) => (
              <li key={e.id} className="border-l-2 border-line pl-2.5">
                <p className="text-[11px] text-muted">{new Date(e.at).toLocaleString("ca-ES")} · {e.user_name ?? "Sistema"}</p>
                <p>{e.kind === "estat" ? `${e.status_from ? CLAIM_STATUS_LABEL[e.status_from as ClaimStatus] ?? e.status_from : "—"} → ${CLAIM_STATUS_LABEL[e.status_to as ClaimStatus] ?? e.status_to}` : e.body ?? e.kind}{e.amount ? ` · ${eur(e.amount)}` : ""}</p>
                {e.attachment_path && <button className="inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline" onClick={async () => { try { const r = await cApi.get<{ url: string }>("attachment", { id: e.id }); window.open(r.url, "_blank", "noopener"); } catch (x) { toast("No s'ha pogut obrir", errMsg(x), "err"); } }}><Paperclip size={11} /> {e.attachment_name ?? "Document"}</button>}
              </li>
            ))}</ol>
          </section>
        </aside>
      </div>

      {modal === "authorize" && <FormModal title={`Autoritzar l'enviament de ${c.code}`} fields={[{ k: "note", label: "He revisat el PDF, els imports i el correu. Comentari (opcional)" }]} onClose={() => setModal(null)} onSubmit={(v) => act("authorize", { authorize: true, note: v.note || undefined }, undefined, "Reclamació autoritzada")} />}
      {modal === "send" && <SendModal d={d} onClose={() => setModal(null)} onSent={() => { setModal(null); void load(); }} />}
      {modal === "external" && <FormModal title="Registrar enviament fet fora del CRM" fields={[{ k: "sent_at", label: "Data d'enviament", type: "date" }, { k: "channel", label: "Canal (portal, correu propi…)" }, { k: "note", label: "Nota (opcional)" }]} onClose={() => setModal(null)} onSubmit={(v) => act("sent_external", v, undefined, "Enviament registrat")} />}
      {modal === "response" && <ResponseModal items={live} onClose={() => setModal(null)} onSubmit={(v) => act("response", v, undefined, "Resposta registrada")} />}
      {modal === "recovery" && <FormModal title="Registrar import recuperat" fields={[{ k: "amount", label: "Import (€)", placeholder: "0.00" }, { k: "received_at", label: "Data", type: "date" }, { k: "itemId", label: "Contracte", options: [{ v: "", l: "General (sense línia concreta)" }, ...live.map((i) => ({ v: i.id, l: `${i.client_name ?? i.cups ?? "—"} · ${eur(Number(i.claimed_amount) - Number(i.recovered_amount))} pendents` }))] }, { k: "reference", label: "Referència (liquidació o banc)" }, { k: "note", label: "Nota" }]} onClose={() => setModal(null)} onSubmit={(v) => act("recovery", { ...v, itemId: v.itemId || null, amount: v.amount.replace(",", ".") }, undefined, "Import recuperat registrat")} />}
      {modal === "reminder" && <FormModal title="Programar un recordatori" fields={[{ k: "at", label: "Data", type: "date" }, { k: "userId", label: "Per a", options: d.people.map((p) => ({ v: p.id, l: p.name })) }, { k: "note", label: "Nota" }]} onClose={() => setModal(null)} onSubmit={(v) => act("reminder", { ...v, userId: v.userId || undefined }, undefined, "Recordatori programat")} />}
      {modal === "task" && <FormModal title="Crear una tasca de seguiment" fields={[{ k: "title", label: "Tasca", placeholder: "Trucar al departament de liquidacions" }, { k: "due", label: "Data límit", type: "date" }, { k: "assignedTo", label: "Responsable", options: d.people.map((p) => ({ v: p.id, l: p.name })) }]} onClose={() => setModal(null)} onSubmit={(v) => act("task", { ...v, due: v.due || undefined, assignedTo: v.assignedTo || undefined }, undefined, "Tasca creada")} />}
    </div>
  );
}

function AttachButton({ onFile }: { onFile: (name: string, base64: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const ACCEPT = ".pdf,.jpg,.jpeg,.png,.xlsx,.docx,.csv,.eml,.txt";
  const take = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast("El fitxer supera 3 MB", undefined, "err"); return; }
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
    onFile(f.name, b64);
  };
  return (
    <DropArea className="inline-block" accept={ACCEPT} label="Justificant" onFiles={([f]) => void take(f)} onReject={(m) => toast(m, undefined, "err")}>
      <Button size="sm" onClick={() => ref.current?.click()}><Paperclip size={13} /> Justificant</Button>
      <input ref={ref} type="file" className="hidden" accept={ACCEPT} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; await take(f); }} />
    </DropArea>
  );
}

function EmailSection({ d, onSave }: { d: Detail; onSave: (data: Record<string, unknown>) => Promise<boolean> }) {
  const c = d.claim;
  const [f, setF] = useState({ subject: c.email_subject ?? "", body: c.email_body ?? "", contact_email: c.contact_email ?? "" });
  const dirty = f.subject !== (c.email_subject ?? "") || f.body !== (c.email_body ?? "") || f.contact_email !== (c.contact_email ?? "");
  const editable = ["esborrany", "pendent_enviament"].includes(c.status) && d.permissions.canEdit;
  return (
    <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-[13px]">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted"><Mail size={13} /> Correu de reclamació</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className="label">Contacte de liquidacions</span>
          <select className="input" disabled={!editable} value={c.contact_id ?? ""} onChange={(e) => void onSave({ contact_id: e.target.value || null })}><option value="">— Escriu el correu a mà —</option>{d.contacts.map((x) => <option key={x.id} value={x.id}>{x.name}{x.email ? ` · ${x.email}` : ""}</option>)}</select>
        </label>
        <label className="block"><span className="label">Per a</span><input className="input" disabled={!editable} value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} placeholder="liquidacions@comercialitzadora.es" /></label>
      </div>
      {!d.contacts.length && <p className="text-[11.5px] text-muted">Pots desar el contacte de liquidacions d&apos;aquesta comercialitzadora a «Reclamacions → Contactes de liquidacions».</p>}
      <label className="block"><span className="label">Assumpte</span><input className="input" disabled={!editable} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
      <label className="block"><span className="label">Missatge</span><textarea className="input min-h-[280px] font-[inherit]" disabled={!editable} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <div className="flex items-center gap-2"><span className="text-[11.5px] text-muted">S&apos;adjuntarà el PDF {c.code}. No s&apos;envia res fins que premis «Enviar…» i ho confirmis.</span>{editable && <Button size="sm" className="ml-auto" disabled={!dirty} onClick={() => void onSave({ email_subject: f.subject, email_body: f.body, contact_email: f.contact_email })}>Desa l&apos;esborrany</Button>}</div>
    </section>
  );
}

function SendModal({ d, onClose, onSent }: { d: Detail; onClose: () => void; onSent: () => void }) {
  const c = d.claim;
  const to = c.contact_email ?? "";
  const [cc, setCc] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await cApi.act<{ from: string; responseDue: string }>("send", { id: c.id, data: { confirm: true, to, cc: cc.split(/[,;\s]+/).filter(Boolean), subject: c.email_subject ?? "", body: c.email_body ?? "", lang: c.lang } });
      toast("Reclamació enviada", `Des de ${r.from}. Resposta esperada abans del ${r.responseDue}.`);
      onSent();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Enviar ${c.code}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!ok || busy || !to} onClick={send}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Envia ara</Button></>}>
      <div className="space-y-3 text-[13px]">
        <label className="block"><span className="label">Per a (destinatari autoritzat)</span><input className="input" value={to} readOnly /></label>
        <label className="block"><span className="label">CC (opcional)</span><input className="input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="separats per comes" /></label>
        <p><b>Assumpte:</b> {c.email_subject}</p>
        <p className="text-muted">S&apos;enviarà amb el teu compte de correu (El meu perfil → Comunicacions) i s&apos;adjuntarà el PDF de {d.items.filter((i) => !["retirada", "traspassada"].includes(i.status)).length} contracte(s) per {eur(c.total_claimed)}.</p>
        <label className="flex items-start gap-2 rounded-xl border border-line p-3"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>He revisat el PDF, els imports i el correu, i confirmo que vull enviar aquesta reclamació a <b>{to || "—"}</b>.</span></label>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

function ResponseModal({ items, onClose, onSubmit }: { items: Item[]; onClose: () => void; onSubmit: (v: unknown) => Promise<boolean> }) {
  const [status, setStatus] = useState<"en_revisio" | "acceptada_total" | "acceptada_parcial" | "rebutjada">("acceptada_parcial");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.recognized_amount])));
  const [busy, setBusy] = useState(false);
  const detail = status === "acceptada_parcial";
  const submit = async () => {
    setBusy(true);
    const its = detail ? items.map((i) => { const v = (vals[i.id] ?? "0").replace(",", ".") || "0"; const n = Number(v); return { id: i.id, recognized: Number.isFinite(n) ? n.toFixed(2) : "0.00", status: n <= 0 ? "rebutjada" : n >= Number(i.claimed_amount) ? "acceptada" : "parcial" }; })
      : status === "rebutjada" ? items.map((i) => ({ id: i.id, recognized: "0.00", status: "rebutjada" })) : [];
    if (await onSubmit({ status, received_at: date, text, items: its })) onClose();
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Registrar la resposta de la comercialitzadora" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || text.trim().length < 3} onClick={submit}>Desa</Button></>}>
      <div className="space-y-3 text-[13px]">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="label">Resultat</span><select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="en_revisio">La comercialitzadora ho està revisant</option><option value="acceptada_total">Acceptada totalment</option><option value="acceptada_parcial">Acceptada parcialment</option><option value="rebutjada">Rebutjada</option></select></label>
          <label className="block"><span className="label">Data de la resposta</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <label className="block"><span className="label">Resum de la resposta</span><textarea className="input min-h-[90px]" value={text} onChange={(e) => setText(e.target.value)} /></label>
        {detail && (
          <div className="max-h-64 overflow-auto rounded-xl border border-line">
            <table className="w-full text-[12px]"><thead className="bg-elevated text-left text-[10.5px] uppercase text-muted"><tr><th className="px-2 py-1.5">Contracte</th><th className="px-2 text-right">Reclamat</th><th className="px-2 text-right">Reconegut</th></tr></thead>
              <tbody>{items.map((i) => <tr key={i.id} className="border-t border-line"><td className="px-2 py-1.5">{i.client_name ?? i.cups ?? "—"}</td><td className="px-2 text-right tnum">{eur(i.claimed_amount)}</td><td className="px-2 py-1 text-right"><input className="input h-8 w-24 text-right" inputMode="decimal" aria-label={`Reconegut ${i.client_name ?? ""}`} value={vals[i.id] ?? ""} onChange={(e) => setVals({ ...vals, [i.id]: e.target.value })} /></td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="text-[11.5px] text-muted">Reconegut no és cobrat: registra l&apos;import recuperat quan arribi la regularització (o confirma la proposta automàtica quan es carregui la liquidació).</p>
      </div>
    </Modal>
  );
}

type FieldDef = { k: string; label: string; type?: string; placeholder?: string; options?: { v: string; l: string }[] };
function FormModal({ title, fields, onClose, onSubmit }: { title: string; fields: FieldDef[]; onClose: () => void; onSubmit: (v: Record<string, string>) => Promise<boolean> }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.k, f.type === "date" ? new Date().toISOString().slice(0, 10) : f.options?.[0]?.v ?? ""])));
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "")); if (await onSubmit({ ...Object.fromEntries(fields.map((f) => [f.k, ""])), ...clean })) onClose(); setBusy(false); }}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px]">
        {fields.map((f) => (
          <label key={f.k} className="block"><span className="label">{f.label}</span>
            {f.options ? <select className="input" value={v[f.k]} onChange={(e) => setV({ ...v, [f.k]: e.target.value })}>{f.options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
              : <input className="input" type={f.type ?? "text"} placeholder={f.placeholder} value={v[f.k]} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} />}
          </label>
        ))}
      </div>
    </Modal>
  );
}
