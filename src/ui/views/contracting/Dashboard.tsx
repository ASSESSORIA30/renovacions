"use client";
/** PANELL DE CONTRACTACIÓ: què cal fer avui a Administració i com va el flux de tramitació. */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSignature, FileStack, FileWarning, KanbanSquare, Plus, RefreshCw, Send, ShieldAlert, Timer } from "lucide-react";
import { EXP_STATUSES, EXP_STATUS_COLOR, EXP_STATUS_LABEL, SIGNATURE_STATUS_LABEL, type SignatureStatus } from "@/core/contracting";
import { useApp } from "@/data/store";
import { supabaseConfigured } from "@/data/browserSupabase";
import { Button, Empty, Notice, cn } from "../../components/ui";
import { ServiceChip } from "../sales/shared";
import { cApi, fmtDate, type Dashboard, type MiniRow } from "./api";
import { DocMeter, NewExpedientWizard, StatusPill } from "./shared";

export function ContractingDashboardView() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => { try { setD(await cApi.dashboard()); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { if (supabaseConfigured) void load(); }, [load]);
  const go = useApp((s) => s.navigate);
  if (!supabaseConfigured) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty icon={<FileStack size={26} />} title="La contractació necessita la base de dades" body="Aquest desplegament no té Supabase configurat." /></div>;
  const k = d?.kpis;
  const flow = EXP_STATUSES.filter((s) => s !== "rebutjat");
  const maxFlow = Math.max(1, ...flow.map((s) => k?.byStatus[s] ?? 0));
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Contractació</h2>
          <p className="text-[13px] text-muted">Expedients, documentació, signatures i activacions en un sol lloc</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void load()}><RefreshCw size={14} /> Actualitza</Button>
          <Button onClick={() => go("tramitacions")}><KanbanSquare size={14} /> Tramitacions</Button>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> Nou expedient</Button>
        </div>
      </div>
      {err && <Notice tone="red">{err}</Notice>}
      {d && !d.signature.configured && (
        <Notice tone="amber">Signatura electrònica: <b>integració pendent</b>{d.signature.missing.length ? ` (falta ${d.signature.missing.join(", ")})` : ""}. Es poden preparar sol·licituds, però no s&apos;envien fins que es configuri un proveïdor autoritzat. Mentrestant, Administració pot registrar signatures manuscrites amb el document signat.</Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile icon={<FileStack size={15} />} label="Expedients oberts" value={k?.open} />
        <Tile icon={<FileWarning size={15} />} label="Documents pendents" value={k?.docsPending} tone={k?.docsPending ? "text-pend" : undefined} />
        <Tile icon={<FileSignature size={15} />} label="Pendents de signatura" value={k?.byStatus.pendent_signatura} />
        <Tile icon={<AlertTriangle size={15} />} label="Incidències" value={k?.byStatus.incidencia} tone={k?.byStatus.incidencia ? "text-lost" : undefined} />
        <Tile icon={<CheckCircle2 size={15} />} label="Activats aquest mes" value={k?.activatedMonth} tone="text-ren" />
        <Tile icon={<Timer size={15} />} label="Dies fins a l'activació" value={k?.avgDaysToActivate ?? "—"} sub="mitjana" />
      </div>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-3 text-[13px] font-semibold">Flux de tramitació</h3>
        <div className="grid gap-1.5">
          {flow.map((s) => (
            <button key={s} onClick={() => go("tramitacions")} className="grid grid-cols-[180px_1fr_40px] items-center gap-3 rounded-lg px-1 py-0.5 text-left text-[12.5px] hover:bg-ink/[0.03]">
              <span className="text-muted">{EXP_STATUS_LABEL[s]}</span>
              <span className="h-2.5 rounded-full bg-ink/[0.05]"><span className="block h-full rounded-full" style={{ width: `${((k?.byStatus[s] ?? 0) / maxFlow) * 100}%`, background: EXP_STATUS_COLOR[s] }} /></span>
              <span className="text-right tnum">{k?.byStatus[s] ?? 0}</span>
            </button>
          ))}
        </div>
        {!!d?.unassigned && <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-pend"><ShieldAlert size={13} /> {d.unassigned} expedient(s) sense responsable</p>}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <List title="Documentació pendent" icon={<FileWarning size={15} />} rows={d?.docsPending} empty="Cap expedient amb documentació pendent." extra={(r) => <DocMeter p={r.docs} compact />} />
        <List title="Signatures pendents" icon={<FileSignature size={15} />} rows={d?.signaturePending} empty="Cap signatura pendent." extra={(r) => <span className="text-[11px] text-muted">{r.signature ? SIGNATURE_STATUS_LABEL[r.signature as SignatureStatus] : "Sense sol·licitud"}</span>} />
        <List title="Signats, per enviar a la comercialitzadora" icon={<Send size={15} />} rows={d?.readyToSend} empty="No n'hi ha cap per enviar." />
        <List title="Activació prevista vençuda" icon={<Timer size={15} />} rows={d?.overdue} empty="Cap tramitació endarrerida." extra={(r) => <span className="text-[11px] text-lost">{fmtDate(r.expected_activation_date)}</span>} />
        <List title="Incidències" icon={<AlertTriangle size={15} />} rows={d?.incidents} empty="Cap incidència oberta." />
        <List title="Activats recentment" icon={<CheckCircle2 size={15} />} rows={d?.activated} empty="Encara no se n'ha activat cap." extra={(r) => <span className="text-[11px] text-ren">{fmtDate(r.activated_at ?? null)}</span>} />
      </div>
      {creating && <NewExpedientWizard onClose={() => setCreating(false)} />}
    </div>
  );
}

function Tile({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number | string | undefined; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <p className="flex items-center gap-1.5 text-[12px] text-muted">{icon}{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tnum", tone)}>{value ?? <span className="inline-block h-6 w-8 animate-pulse rounded bg-ink/[0.06]" />}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function List({ title, icon, rows, empty, extra }: { title: string; icon: React.ReactNode; rows: MiniRow[] | undefined; empty: string; extra?: (r: MiniRow) => React.ReactNode }) {
  const go = useApp((s) => s.navigate);
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <h3 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold">{icon}{title}<span className="ml-auto rounded-full bg-ink/[0.06] px-1.5 text-[11px] font-normal text-muted tnum">{rows?.length ?? "…"}</span></h3>
      {!rows ? <div className="m-4 h-16 animate-pulse rounded-xl bg-ink/[0.04]" /> : !rows.length ? <p className="px-4 py-5 text-[12.5px] text-muted">{empty}</p> : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => go("expedient", { id: r.id })} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-ink/[0.03]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{r.client_name ?? "—"}</p>
                  <p className="truncate text-[11.5px] text-muted"><span className="font-mono">{r.code}</span> · {r.retailer} · {r.owner_name ?? "sense responsable"}</p>
                </div>
                <ServiceChip s={r.service} short />
                {extra ? extra(r) : <StatusPill s={r.status} />}
                <span className="w-9 text-right text-[11px] text-muted tnum" title="Dies en aquest estat">{r.days_in_status} d</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
