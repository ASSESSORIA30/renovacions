"use client";
/**
 * PANELL LATERAL DEL GRUP: tots els contractes d'un contacte amb renovacions pròximes. Selecció individual o total i
 * accions que NOMÉS afecten els contractes seleccionats (contactar, propostes, trucades, tasques, estats).
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, FileSignature, ListTodo, Mail, Phone, PhoneCall, Send, Split, Undo2, Users } from "lucide-react";
import { holderKey, relatedContracts, summarize } from "@/core/contact-groups";
import { fmtDate } from "@/core/dates";
import { titleCase } from "@/core/templates";
import type { Contract, Status } from "@/core/types";
import { useApp } from "@/data/store";
import { groupsApi, loadGroupData } from "@/data/groupsApi";
import { STATUSES, STATUS_META, useContactGraph } from "../../selectors";
import { Badge, Button, Notice, cn } from "../ui";
import { ActivityForm, ContractTable, SidePanel, TaskForm } from "./shared";

type Tool = null | "activitat" | "tasca" | "estat" | "propostes";

export function GroupPanel() {
  const panel = useApp((s) => s.groupPanel);
  const close = () => useApp.getState().set("groupPanel", null);
  return (
    <SidePanel open={!!panel} onClose={close} label="Contractes del grup" title={<GroupTitle />} sub={<GroupSub />}>
      {panel && <GroupBody key={panel.contractIds.join(",")} ids={panel.contractIds} focus={panel.focusStatus ?? null} />}
    </SidePanel>
  );
}

function useGroupContracts() {
  const panel = useApp((s) => s.groupPanel);
  const byId = useApp((s) => s.byId);
  return useMemo(() => (panel?.contractIds ?? []).map((id) => byId[id]).filter(Boolean) as Contract[], [panel, byId]);
}
function GroupTitle() {
  const cs = useGroupContracts();
  const s = summarize(cs);
  return <span className="flex items-center gap-2"><Users size={16} className="text-brand" /> {s.contactName ? titleCase(s.contactName) : "Contractes del mateix contacte"}</span>;
}
function GroupSub() {
  const cs = useGroupContracts();
  const s = summarize(cs);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {s.phone && <span className="inline-flex items-center gap-1"><Phone size={12} /> {s.phone}</span>}
      {s.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {s.email}</span>}
      <span>{s.total} contractes · {s.luz} llum · {s.gas} gas · {s.holders} {s.holders === 1 ? "titular" : "titulars"}</span>
      <span className="tnum">{fmtDate(s.first)} → {fmtDate(s.last)}</span>
    </span>
  );
}

function GroupBody({ ids, focus }: { ids: string[]; focus: Status | null }) {
  const contracts = useGroupContracts();
  const graph = useContactGraph();
  const links = useApp((s) => s.groups.links);
  const migrationMissing = useApp((s) => s.groups.migrationMissing);
  const docs = useApp((s) => s.snap!.docs);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(contracts.filter((c) => !focus || c.crm.status === focus).map((c) => c.id)));
  const [tool, setTool] = useState<Tool>(null);
  const [moveTo, setMoveTo] = useState<Status>("contactado");
  // els contractes que ja no són al grup (p. ex. separats) surten de la selecció
  useEffect(() => { setSelected((s) => new Set([...s].filter((id) => contracts.some((c) => c.id === id)))); }, [contracts]);
  const sel = contracts.filter((c) => selected.has(c.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const s = summarize(contracts);
  const ambiguous = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of contracts) for (const r of relatedContracts(graph, c.id, links)) if (r.level === "ambigua" && !ids.includes(r.contractId) && !seen.has(r.contractId)) seen.set(r.contractId, c.id);
    return [...seen.entries()].map(([other, anchor]) => ({ other: graph.byId.get(other)!, anchor })).filter((x) => x.other);
  }, [contracts, graph, links, ids]);
  const manual = links.filter((l) => ids.includes(l.contract_a) || ids.includes(l.contract_b));

  const separate = async (c: Contract) => {
    const st = useApp.getState();
    try {
      for (const o of contracts) if (o.id !== c.id) await groupsApi.link("separar", c.id, o.id, "Separat manualment des del panell del grup");
      await loadGroupData();
      st.set("groupPanel", { contractIds: ids.filter((x) => x !== c.id), focusStatus: focus });
      st.toast({ title: "Contracte separat del grup", body: titleCase(c.cliente), tone: "ok" });
    } catch (e) { st.toast({ title: "No s'ha pogut separar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const join = async (other: Contract, anchor: string) => {
    const st = useApp.getState();
    try {
      await groupsApi.link("unir", anchor, other.id, "Coincidència revisada i confirmada");
      await loadGroupData();
      st.set("groupPanel", { contractIds: [...ids, other.id], focusStatus: focus });
    } catch (e) { st.toast({ title: "No s'ha pogut unir", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const undo = async (id: string) => {
    try { await groupsApi.unlink(id); await loadGroupData(); } catch (e) { useApp.getState().toast({ title: "No s'ha pogut desfer", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };

  return (
    <div className="space-y-4">
      {s.holders > 1 && <Notice tone="blue">Aquest contacte gestiona contractes de <b>{s.holders} titulars diferents</b>. La persona de contacte no és el titular legal: abans d'enviar documents d'un titular a aquesta persona, el CRM comprova que hi està autoritzada.</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-medium">{sel.length} de {contracts.length} seleccionats</span>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(contracts.map((c) => c.id)))}>Tots</Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Cap</Button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" disabled={!sel.length} onClick={() => useApp.getState().set("contactAll", { contractIds: contracts.map((c) => c.id), preselected: sel.map((c) => c.id) })}><Send size={13} /> Contactar tots</Button>
          <Button size="sm" disabled={!sel.length} onClick={() => setTool(tool === "propostes" ? null : "propostes")}><FileSignature size={13} /> Generar proposta agrupada</Button>
          <Button size="sm" disabled={!sel.length} onClick={() => setTool(tool === "activitat" ? null : "activitat")}><PhoneCall size={13} /> Registrar trucada</Button>
          <Button size="sm" disabled={!sel.length} onClick={() => setTool(tool === "tasca" ? null : "tasca")}><ListTodo size={13} /> Crear tasques</Button>
          <Button size="sm" disabled={!sel.length} onClick={() => setTool(tool === "estat" ? null : "estat")}><ArrowRightLeft size={13} /> Canviar estat</Button>
        </div>
      </div>

      {tool === "activitat" && <ActivityForm ids={sel.map((c) => c.id)} contactName={s.contactName} onDone={() => setTool(null)} />}
      {tool === "tasca" && <TaskForm ids={sel.map((c) => c.id)} onDone={() => setTool(null)} />}
      {tool === "estat" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-[12.5px]">
          Mou els {sel.length} seleccionats a
          <select className="input h-8 w-auto py-0" value={moveTo} onChange={(e) => setMoveTo(e.target.value as Status)}>{STATUSES.map((x) => <option key={x} value={x}>{STATUS_META[x].label}</option>)}</select>
          <Button size="sm" variant="primary" onClick={() => { useApp.getState().set("groupMove", { contractIds: contracts.map((c) => c.id), preselected: sel.map((c) => c.id), to: moveTo }); setTool(null); }}>Continua</Button>
          <span className="text-[11px] text-muted">Es demanarà confirmació i cada contracte conservarà les seves validacions.</span>
        </div>
      )}
      {tool === "propostes" && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-[12px] text-muted">Cada contracte té la seva proposta amb les seves condicions (mòdul de propostes existent). Quan estiguin preparades, «Contactar tots» les adjunta en una sola comunicació.</p>
          <ul className="divide-y divide-line text-[12.5px]">
            {sel.map((c) => {
              const last = docs.filter((d) => d.contractId === c.id).sort((a, b) => b.version - a.version)[0];
              return (
                <li key={c.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{titleCase(c.cliente)} <span className="text-muted">· {c.cups ? `…${c.cups.slice(-6)}` : "sense CUPS"}</span></span>
                  {last ? <Badge tone="green">Proposta v{last.version}{last.ahorroAnual ? ` · ${Math.round(last.ahorroAnual)} €/any` : ""}</Badge> : <Badge tone="amber">Sense proposta</Badge>}
                  <Button size="sm" variant={last ? "ghost" : "secondary"} onClick={() => useApp.getState().set("proposalFor", c.id)}>{last ? "Nova versió" : "Genera"}</Button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end"><Button size="sm" variant="primary" onClick={() => useApp.getState().set("contactAll", { contractIds: contracts.map((c) => c.id), preselected: sel.map((c) => c.id) })}><Send size={13} /> Prepara la comunicació amb les propostes</Button></div>
        </div>
      )}

      <ContractTable contracts={contracts} selected={selected} onToggle={toggle} onToggleAll={(on) => setSelected(on ? new Set(contracts.map((c) => c.id)) : new Set())}
        baseHolder={contracts.length ? holderKey(contracts[0]) : null}
        extra={(c) => <button className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-muted hover:text-lost" disabled={migrationMissing} title={migrationMissing ? "Cal aplicar la migració 029" : "No és la mateixa persona de contacte"} onClick={() => void separate(c)}><Split size={11} /> Separa del grup</button>} />

      {ambiguous.length > 0 && (
        <section className="rounded-xl border border-dashed border-line p-3">
          <h3 className="text-[12.5px] font-semibold">Coincidències per revisar ({ambiguous.length})</h3>
          <p className="mb-2 text-[11.5px] text-muted">Comparteixen un telèfon o correu genèric, o només el nom. No s'agrupen sense la teva confirmació.</p>
          <ul className="divide-y divide-line text-[12.5px]">
            {ambiguous.map(({ other, anchor }) => (
              <li key={other.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{titleCase(other.cliente)} <span className="text-muted">· {other.representante ?? "sense persona de contacte"} · {fmtDate(other.vencimiento)}</span></span>
                <Button size="sm" disabled={migrationMissing} onClick={() => void join(other, anchor)}>És la mateixa persona: uneix</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {manual.length > 0 && (
        <section>
          <h3 className="mb-1 text-[12.5px] font-semibold">Decisions manuals</h3>
          <ul className="space-y-1 text-[12px]">
            {manual.map((l) => (
              <li key={l.id} className={cn("flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5")}>
                <Badge tone={l.kind === "unir" ? "green" : "zinc"}>{l.kind === "unir" ? "Units" : "Separats"}</Badge>
                <span className="min-w-0 flex-1 truncate">{[l.contract_a, l.contract_b].map((id) => graph.byId.get(id)?.cliente ?? "contracte").map(titleCase).join(" ↔ ")}{l.created_by_name ? ` · ${l.created_by_name}` : ""}</span>
                <Button size="sm" variant="ghost" onClick={() => void undo(l.id)}><Undo2 size={12} /> Desfés</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
