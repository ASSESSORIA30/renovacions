"use client";
/**
 * «ALTRES CONTRACTES DEL MATEIX CONTACTE» (relació general, independent de la data de venciment).
 * Es pot obrir des de la fitxa d'un contracte o des de Clients 360°. Només es calcula amb els contractes que l'usuari
 * pot veure (el magatzem ja ve filtrat per la RLS): cap comptador ni avís revela contractes inaccessibles.
 */
import { useEffect, useMemo, useState } from "react";
import { BellRing, Layers, ListTodo, PhoneCall, Send, Split, Users, X } from "lucide-react";
import { holderKey, relatedAlert, relatedContracts, relatedToContacts, type RelatedMatch } from "@/core/contact-groups";
import { daysUntil, fmtDateTime } from "@/core/dates";
import { expiry } from "@/core/insights";
import { titleCase } from "@/core/templates";
import type { Contract } from "@/core/types";
import { useApp, type RelatedState } from "@/data/store";
import { groupsApi, loadGroupData, type GroupOp } from "@/data/groupsApi";
import { useContactGraph, useGroupWindow } from "../../selectors";
import { Badge, Button, Notice, cn } from "../ui";
import { ActivityForm, ContractTable, SidePanel, TaskForm, contactOf } from "./shared";

/** Coincidències per a un contracte o per a un client (sense el propi contracte o els del client). */
export function useRelated(target: RelatedState | null): RelatedMatch[] {
  const graph = useContactGraph();
  const links = useApp((s) => s.groups.links);
  return useMemo(() => {
    if (!target) return [];
    if (target.contractId) return relatedContracts(graph, target.contractId, links);
    if (target.client) return relatedToContacts(graph, target.client.contacts, new Set(target.client.ownContractIds));
    return [];
  }, [graph, links, target]);
}

/** Indicador «Altres contractes del mateix contacte (X)». No es mostra si no n'hi ha cap. */
export function RelatedIndicator({ target, className }: { target: RelatedState; className?: string }) {
  const related = useRelated(target);
  const n = related.filter((r) => r.level !== "ambigua").length;
  const groupsLoaded = useApp((s) => s.groups.loaded);
  useEffect(() => { if (!groupsLoaded) void loadGroupData(); }, [groupsLoaded]);
  if (!n) return null;
  return (
    <button type="button" data-testid="related-indicator" onClick={() => useApp.getState().set("related", target)}
      className={cn("pressable inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/[0.06] px-2.5 py-1 text-[12px] font-medium text-brand hover:bg-brand/10", className)}>
      <Users size={13} /> Altres contractes del mateix contacte ({n})
    </button>
  );
}

const DISMISSED = "a30:grp:avisos";
const dismissed = (): Set<string> => { try { return new Set(JSON.parse(sessionStorage.getItem(DISMISSED) ?? "[]")); } catch { return new Set(); } };

/** Avís discret en obrir un contracte: només si hi ha renovacions pròximes del mateix contacte; es pot amagar. */
export function RelatedAlert({ contractId }: { contractId: string }) {
  const related = useRelated(useMemo(() => ({ contractId }), [contractId]));
  const graph = useContactGraph();
  const window = useGroupWindow();
  const [hidden, setHidden] = useState(() => dismissed().has(contractId));
  useEffect(() => setHidden(dismissed().has(contractId)), [contractId]);
  const al = useMemo(() => relatedAlert(related, graph.byId, Math.max(30, window)), [related, graph, window]);
  if (!al || hidden) return null;
  const hide = () => { const s = dismissed(); s.add(contractId); try { sessionStorage.setItem(DISMISSED, JSON.stringify([...s].slice(-500))); } catch { /* ignore */ } setHidden(true); };
  return (
    <div role="status" className="mt-2 flex items-start gap-2 rounded-lg border border-blue-500/25 bg-blue-500/[0.06] px-2.5 py-1.5 text-[12px] text-blue-900 dark:text-blue-200">
      <BellRing size={13} className="mt-0.5 shrink-0" />
      <span className="flex-1">{al.text} <button className="font-medium underline" onClick={() => useApp.getState().set("related", { contractId })}>Veure-ho</button></span>
      <button aria-label="Amaga l'avís" onClick={hide} className="text-current/70 hover:text-current"><X size={13} /></button>
    </div>
  );
}

export function RelatedPanel() {
  const target = useApp((s) => s.related);
  const close = () => useApp.getState().set("related", null);
  return (
    <SidePanel open={!!target} onClose={close} z={52} label="Altres contractes del mateix contacte" title={<span className="flex items-center gap-2"><Users size={16} className="text-brand" /> Altres contractes del mateix contacte</span>} sub={<Sub target={target} />}>
      {target && <Body key={target.contractId ?? target.client?.id} target={target} />}
    </SidePanel>
  );
}

function Sub({ target }: { target: RelatedState | null }) {
  const byId = useApp((s) => s.byId);
  if (!target) return null;
  if (target.client) return <>Persones de contacte de <b>{target.client.name}</b>: {target.client.contacts.map((c) => c.name).filter(Boolean).join(", ") || "sense nom"}</>;
  const c = target.contractId ? byId[target.contractId] : null;
  return c ? <>Des del contracte de <b>{titleCase(c.cliente)}</b>{c.representante ? <> · contacte: <b>{c.representante}</b></> : null}</> : null;
}

function Body({ target }: { target: RelatedState }) {
  const related = useRelated(target);
  const byId = useApp((s) => s.byId);
  const window = useGroupWindow();
  const migrationMissing = useApp((s) => s.groups.migrationMissing);
  const [onlySoon, setOnlySoon] = useState(false);
  const [showAmb, setShowAmb] = useState(false);
  const [tool, setTool] = useState<null | "activitat" | "tasca">(null);
  const matches = useMemo(() => new Map(related.map((r) => [r.contractId, r])), [related]);
  const base = target.contractId ? byId[target.contractId] : null;
  const soon = (c: Contract) => { const d = daysUntil(expiry(c)); return (c.crm.status === "pendiente" || c.crm.status === "contactado") && d !== null && d <= window; };
  const sure = related.filter((r) => r.level !== "ambigua").map((r) => byId[r.contractId]).filter(Boolean) as Contract[];
  const amb = related.filter((r) => r.level === "ambigua").map((r) => byId[r.contractId]).filter(Boolean) as Contract[];
  const list = (onlySoon ? sure.filter(soon) : sure);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const chosen = list.filter((c) => sel.has(c.id));
  const withBase = base ? [base, ...chosen] : chosen;
  const contact = contactOf(base ? [base, ...sure] : sure);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const decide = async (kind: "unir" | "separar", other: string) => {
    if (!target.contractId) return;
    try { await groupsApi.link(kind, target.contractId, other, kind === "unir" ? "Coincidència revisada i confirmada" : "No és la mateixa persona de contacte"); await loadGroupData(); }
    catch (e) { useApp.getState().toast({ title: "No s'ha pogut desar la decisió", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const holders = new Set(sure.map(holderKey));
  if (base) holders.add(holderKey(base));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Badge tone="violet">{sure.length} relacionats</Badge>
        <Badge tone="amber">{sure.filter(soon).length} vencen en {window} dies</Badge>
        {holders.size > 1 && <Badge tone="blue">{holders.size} titulars</Badge>}
        <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={onlySoon} onChange={(e) => setOnlySoon(e.target.checked)} /> Només renovacions pròximes</label>
      </div>
      {holders.size > 1 && <Notice tone="blue">La persona de contacte no és el titular legal. Els contractes de titulars diferents es mostren separats i no es comparteix informació entre titulars sense una autorització registrada.</Notice>}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-auto text-[12px] text-muted">{chosen.length} seleccionats{base ? " (+ aquest contracte)" : ""}</span>
        <Button size="sm" variant="primary" disabled={!chosen.length} onClick={() => useApp.getState().set("contactAll", { contractIds: withBase.map((c) => c.id), preselected: withBase.map((c) => c.id) })}><Send size={13} /> Contactar tots</Button>
        <Button size="sm" disabled={!chosen.length} onClick={() => { const st = useApp.getState(); st.set("related", null); st.set("groupPanel", { contractIds: withBase.map((c) => c.id) }); }}><Layers size={13} /> Gestió conjunta</Button>
        <Button size="sm" disabled={!chosen.length} onClick={() => setTool(tool === "activitat" ? null : "activitat")}><PhoneCall size={13} /> Registrar trucada</Button>
        <Button size="sm" disabled={!chosen.length} onClick={() => setTool(tool === "tasca" ? null : "tasca")}><ListTodo size={13} /> Crear tasques</Button>
      </div>
      {tool === "activitat" && <ActivityForm ids={withBase.map((c) => c.id)} contactName={contact.name} onDone={() => setTool(null)} />}
      {tool === "tasca" && <TaskForm ids={chosen.map((c) => c.id)} onDone={() => setTool(null)} />}

      {list.length ? (
        <ContractTable contracts={list} selected={sel} onToggle={toggle} onToggleAll={(on) => setSel(on ? new Set(list.map((c) => c.id)) : new Set())} matches={matches} baseHolder={base ? holderKey(base) : null}
          extra={target.contractId ? (c) => <button className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-muted hover:text-lost disabled:opacity-40" disabled={migrationMissing} onClick={() => void decide("separar", c.id)}><Split size={11} /> No és el mateix contacte</button> : undefined} />
      ) : <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-muted">{onlySoon ? `Cap renovació pròxima (${window} dies) entre els contractes relacionats.` : "No hi ha altres contractes relacionats que puguis veure."}</p>}

      {amb.length > 0 && (
        <section className="rounded-xl border border-dashed border-line p-3">
          <button className="text-[12.5px] font-semibold" onClick={() => setShowAmb(!showAmb)}>Coincidències per revisar ({amb.length}) {showAmb ? "▴" : "▾"}</button>
          <p className="text-[11.5px] text-muted">Telèfon o correu compartit per persones diferents, o només el mateix nom. No es compten com a relacionats.</p>
          {showAmb && (
            <ul className="mt-2 divide-y divide-line text-[12.5px]">
              {amb.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{titleCase(c.cliente)} <span className="text-muted">· {c.representante ?? "sense persona de contacte"} · {matches.get(c.id)?.reasons.join(", ")}</span></span>
                  {target.contractId && <><Button size="sm" disabled={migrationMissing} onClick={() => void decide("unir", c.id)}>És la mateixa persona</Button><Button size="sm" variant="ghost" disabled={migrationMissing} onClick={() => void decide("separar", c.id)}>No ho és</Button></>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {target.contractId && <GroupOpsHistory contractId={target.contractId} />}
    </div>
  );
}

/** Comunicacions i activitats conjuntes on participa el contracte (consultables des de qualsevol contracte del grup). */
export function GroupOpsHistory({ contractId }: { contractId: string }) {
  const [ops, setOps] = useState<GroupOp[] | null>(null);
  const byId = useApp((s) => s.byId);
  useEffect(() => { let live = true; groupsApi.ops(contractId).then((r) => live && setOps(r.ops)).catch(() => live && setOps([])); return () => { live = false; }; }, [contractId]);
  if (!ops?.length) return null;
  const ST: Record<string, { label: string; tone: "green" | "red" | "amber" | "zinc" }> = { enviat: { label: "Enviat", tone: "green" }, registrat: { label: "Registrat", tone: "green" }, intent: { label: "Pendent de confirmar", tone: "amber" }, error: { label: "Error", tone: "red" }, preparat: { label: "Preparat", tone: "zinc" } };
  return (
    <section>
      <h3 className="mb-1 text-[12.5px] font-semibold">Comunicacions i gestions conjuntes</h3>
      <ul className="space-y-1.5 text-[12px]">
        {ops.map((o) => (
          <li key={o.id} className="rounded-lg border border-line px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{o.kind === "comunicacio" ? `Comunicació per ${o.channel === "email" ? "correu" : o.channel === "whatsapp" ? "WhatsApp" : o.channel ?? "—"}` : o.kind.charAt(0).toUpperCase() + o.kind.slice(1)}</span>
              <Badge tone={ST[o.status]?.tone ?? "zinc"}>{ST[o.status]?.label ?? o.status}</Badge>
              <span className="ml-auto text-muted">{fmtDateTime(o.at)}{o.created_by_name ? ` · ${o.created_by_name}` : ""}</span>
            </div>
            <p className="mt-0.5 text-muted">{o.contact_name ?? o.recipient ?? ""}{o.recipient && o.contact_name ? ` (${o.recipient})` : ""} · {o.contract_ids.length} contractes: {o.contract_ids.map((id) => titleCase(byId[id]?.cliente ?? "")).filter(Boolean).join(", ")}</p>
            {o.subject && <p className="mt-0.5">«{o.subject}»</p>}
            {o.attachments?.length > 0 && <p className="text-muted">Adjunts: {o.attachments.map((a) => a.fileName).join(", ")}</p>}
            {o.outcome && <p>Resultat: {o.outcome}</p>}
            {o.error && <p className="text-lost">{o.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
