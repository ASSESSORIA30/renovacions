"use client";
/** Peces compartides pels panells d'agrupació: panell lateral, taula de contractes i accions sobre els seleccionats. */
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, Loader2, PhoneCall, X } from "lucide-react";
import { REASON_LABEL, MATCH_LABEL, effectiveEmail, effectivePhone, holderKey, type RelatedMatch } from "@/core/contact-groups";
import { addDays, daysUntil, fmtDate, today } from "@/core/dates";
import { expiry } from "@/core/insights";
import { titleCase } from "@/core/templates";
import type { Contract } from "@/core/types";
import { useApp } from "@/data/store";
import { groupsApi } from "@/data/groupsApi";
import { STATUS_META } from "../../selectors";
import { Badge, Button, EASE_DRAWER, Field, cn } from "../ui";
import { CupsLink, RenewalClientLink } from "../Navigation";

const SUPPLY: Record<string, string> = { luz: "Llum", gas: "Gas", dual: "Llum i gas", telefonia: "Telefonia" };

export function SidePanel({ open, onClose, title, sub, children, footer, z = 45, width = "sm:w-[880px]", label }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; z?: number; width?: string; label: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="fixed inset-0 bg-black/20" style={{ zIndex: z - 1 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.aside key="panel" role="dialog" aria-label={label} style={{ zIndex: z }}
            className={cn("fixed inset-y-0 right-0 flex w-full max-w-full flex-col border-l border-line bg-surface shadow-lift", width)}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.34, ease: EASE_DRAWER }}>
            <header className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
              <div className="min-w-0 flex-1"><h2 className="truncate text-[16px] font-semibold leading-tight">{title}</h2>{sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}</div>
              <button aria-label="Tanca" onClick={onClose} className="pressable rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink"><X size={18} /></button>
            </header>
            <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-elevated px-5 py-3">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Taula de contractes amb selecció. Distingeix el titular legal de la persona de contacte. */
export function ContractTable({ contracts, selected, onToggle, onToggleAll, matches, baseHolder, extra }: {
  contracts: Contract[]; selected: Set<string>; onToggle: (id: string) => void; onToggleAll: (on: boolean) => void;
  matches?: Map<string, RelatedMatch>; baseHolder?: string | null; extra?: (c: Contract) => ReactNode;
}) {
  const all = contracts.length > 0 && contracts.every((c) => selected.has(c.id));
  const holders = new Set(contracts.map(holderKey));
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[680px] text-left text-[12px]">
        <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="w-8 px-2 py-2"><input type="checkbox" aria-label="Selecciona'ls tots" checked={all} onChange={(e) => onToggleAll(e.target.checked)} /></th>
            <th className="px-2 py-2">Titular</th><th className="px-2 py-2">CUPS</th><th className="px-2 py-2">Comercialitzadora</th>
            <th className="px-2 py-2">Subm. · Tarifa</th><th className="px-2 py-2">Venciment</th><th className="px-2 py-2">Estat</th><th className="px-2 py-2">Responsable</th>
            {matches && <th className="px-2 py-2">Relació</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {contracts.map((c) => {
            const d = daysUntil(expiry(c));
            const m = matches?.get(c.id);
            const otherHolder = (baseHolder && holderKey(c) !== baseHolder) || (!baseHolder && holders.size > 1);
            return (
              <tr key={c.id} className={cn("align-top", selected.has(c.id) && "bg-brand/[0.04]")}>
                <td className="px-2 py-2"><input type="checkbox" aria-label={`Selecciona ${c.cliente}`} checked={selected.has(c.id)} onChange={() => onToggle(c.id)} /></td>
                <td className="max-w-[180px] px-2 py-2">
                  <button className="block max-w-full truncate text-left font-medium hover:text-brand hover:underline" onClick={() => { const st = useApp.getState(); st.set("related", null); st.open(c.id); }} title="Obre la fitxa del contracte">{titleCase(c.cliente)}</button>
                  <span className="flex flex-wrap items-center gap-1 text-[10.5px] text-muted">
                    {c.cif ?? "sense NIF"}{otherHolder && <Badge tone="blue">titular diferent</Badge>}
                  </span>
                  <span className="text-[10.5px]"><RenewalClientLink renewalId={c.id} cups={c.cups} name={titleCase(c.cliente)} className="text-brand" /></span>
                  {extra?.(c)}
                </td>
                <td className="max-w-[130px] px-2 py-2 text-[11px]"><CupsLink cups={c.cups} short /></td>
                <td className="px-2 py-2">{c.comercializadora ?? "—"}</td>
                <td className="px-2 py-2">{SUPPLY[c.tipo] ?? c.tipo}{c.tarifa ? ` · ${c.tarifa}` : ""}</td>
                <td className={cn("px-2 py-2 tnum", d !== null && d <= 30 && (c.crm.status === "pendiente" || c.crm.status === "contactado") ? "font-medium text-pend" : "")}>{fmtDate(expiry(c))}</td>
                <td className="px-2 py-2"><span className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-medium" style={{ background: STATUS_META[c.crm.status].soft, color: STATUS_META[c.crm.status].color }}>{STATUS_META[c.crm.status].label}</span></td>
                <td className="px-2 py-2">{titleCase(c.comercial)}</td>
                {matches && <td className="px-2 py-2">{m && <><Badge tone={m.level === "confirmada" ? "green" : m.level === "probable" ? "amber" : "zinc"}>{MATCH_LABEL[m.level]}</Badge><p className="mt-0.5 text-[10.5px] text-muted">{m.reasons.map((r) => REASON_LABEL[r]).join(", ")}</p></>}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const contactOf = (cs: Contract[]) => ({
  name: cs.map((c) => c.representante).find(Boolean) ?? null,
  phone: cs.map(effectivePhone).find(Boolean) ?? null,
  email: cs.map(effectiveEmail).find(Boolean) ?? null,
});

/** Una sola trucada, visita o comunicació registrada a tots els contractes seleccionats (sistema d'activitats). */
export function ActivityForm({ ids, contactName, onDone }: { ids: string[]; contactName: string | null; onDone?: () => void }) {
  const [kind, setKind] = useState<"trucada" | "visita" | "reunio" | "comunicacio" | "nota">("trucada");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [opId, setOpId] = useState(groupsApi.newOpId);
  const save = async () => {
    setBusy(true);
    const st = useApp.getState();
    try {
      const r = await groupsApi.activity({ opId, kind, channel: kind === "trucada" ? "telefon" : kind === "visita" || kind === "reunio" ? "presencial" : null, contractIds: ids, contactName, notes: notes || null, outcome: outcome || null });
      st.mergeActivities(r.activities);
      if (kind === "trucada" || kind === "visita" || kind === "reunio") for (const id of ids) await st.patchCrm(id, { ultimoContacto: new Date().toISOString() }).catch(() => undefined);
      st.toast({ title: r.existed ? "Ja estava registrat" : "Activitat registrada", body: `${ids.length} ${ids.length === 1 ? "contracte" : "contractes"} · una sola operació`, tone: "ok" });
      setNotes(""); setOutcome(""); setOpId(groupsApi.newOpId());
      onDone?.();
    } catch (e) { st.toast({ title: "No s'ha pogut registrar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipus">
        {(["trucada", "visita", "reunio", "comunicacio", "nota"] as const).map((k) => (
          <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("pressable rounded-full border px-2.5 py-1 text-[12px]", kind === k ? "border-brand bg-brand/10 font-medium text-brand" : "border-line text-muted")}>
            {{ trucada: "Trucada", visita: "Visita", reunio: "Reunió", comunicacio: "Comunicació (fora del CRM)", nota: "Nota" }[k]}
          </button>
        ))}
      </div>
      <input className="input" placeholder="Resultat (p. ex. «Vol revisar-ho la setmana vinent»)" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={500} />
      <textarea className="input min-h-[70px]" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted">Es registra una sola vegada i queda vinculada als {ids.length} contractes seleccionats.</p>
        <Button size="sm" variant="primary" disabled={busy || !ids.length || (!outcome.trim() && !notes.trim())} onClick={save}>{busy ? <Loader2 size={13} className="animate-spin" /> : <PhoneCall size={13} />} Registra</Button>
      </div>
    </div>
  );
}

/** Crea la mateixa tasca a cada contracte seleccionat (sistema de tasques existent). */
export function TaskForm({ ids, onDone }: { ids: string[]; onDone?: () => void }) {
  const [title, setTitle] = useState("Trucar per la renovació conjunta");
  const [due, setDue] = useState(addDays(today(), 2));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const st = useApp.getState();
    let ok = 0;
    for (const id of ids) { try { await st.saveTask({ contractId: id, title, due, kind: "seguimiento" }); ok++; } catch { /* es compta a sota */ } }
    st.toast({ title: ok === ids.length ? "Tasques creades" : "Algunes tasques no s'han pogut crear", body: `${ok} de ${ids.length}`, tone: ok === ids.length ? "ok" : "err" });
    setBusy(false);
    onDone?.();
  };
  return (
    <div className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
      <Field label="Tasca"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
      <Field label="Data"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <Button size="sm" variant="primary" disabled={busy || !ids.length || !title.trim() || !due} onClick={save}>{busy ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />} Crea {ids.length > 1 ? `${ids.length} tasques` : "la tasca"}</Button>
    </div>
  );
}
