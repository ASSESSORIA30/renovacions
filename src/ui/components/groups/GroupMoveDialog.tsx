"use client";
/**
 * Confirmació en arrossegar un grup (o en canviar l'estat des del panell): es trien els contractes als quals s'aplica.
 * Cada contracte conserva el seu estat i el seu historial; per tancar (renovat / no renova) cadascun passa per la seva
 * validació habitual, un darrere l'altre. Els contractes no seleccionats no es toquen.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fmtDate } from "@/core/dates";
import { expiry } from "@/core/insights";
import { titleCase } from "@/core/templates";
import type { Contract } from "@/core/types";
import { useApp } from "@/data/store";
import { STATUS_META } from "../../selectors";
import { Button, Modal, Notice } from "../ui";

export function GroupMoveDialog() {
  const gm = useApp((s) => s.groupMove);
  const byId = useApp((s) => s.byId);
  const contracts = useMemo(() => (gm?.contractIds ?? []).map((id) => byId[id]).filter(Boolean) as Contract[], [gm, byId]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSel(new Set((gm?.preselected ?? []).filter((id) => byId[id] && byId[id].crm.status !== gm?.to))); }, [gm]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!gm) return <Modal open={false} onClose={() => {}} title="">{null}</Modal>;
  const close = () => useApp.getState().set("groupMove", null);
  const to = gm.to;
  const closing = to === "renovado" || to === "no_renueva";
  const chosen = contracts.filter((c) => sel.has(c.id) && c.crm.status !== to);
  const apply = async () => {
    const st = useApp.getState();
    if (closing) {
      // cada tancament exigeix les seves dades (nou venciment o motiu): es demanen un per un
      st.set("closeQueue", chosen.map((c) => ({ contractId: c.id, to: to as "renovado" | "no_renueva" })));
      close();
      st.nextClose();
      return;
    }
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const c of chosen) {
      try { await st.move(c.id, to, {}, `Canvi d'estat conjunt (${chosen.length} contractes del mateix contacte)`, { silent: true }); ok++; }
      catch { failed.push(titleCase(c.cliente)); }
    }
    setBusy(false);
    close();
    st.toast({ title: failed.length ? `${ok} mogut${ok === 1 ? "" : "s"}, ${failed.length} amb error` : `${ok} contracte${ok === 1 ? "" : "s"} mogut${ok === 1 ? "" : "s"} a ${STATUS_META[to].label}`, body: failed.length ? `No s'han pogut moure: ${failed.join(", ")}` : undefined, tone: failed.length ? "err" : "ok" });
  };
  return (
    <Modal open onClose={close} width="max-w-xl" title={`Moure a «${STATUS_META[to].label}»`}
      footer={<><Button variant="ghost" onClick={close}>Cancel·la el moviment</Button><Button variant={to === "no_renueva" ? "danger" : "primary"} disabled={busy || !chosen.length} onClick={apply}>{busy && <Loader2 size={14} className="animate-spin" />} {closing ? `Continua amb ${chosen.length}` : `Mou ${chosen.length}`}</Button></>}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">Tria a quins contractes del grup s'aplica. Els que no marquis es queden on són.</p>
        {closing && <Notice tone="blue">Per a cada contracte es demanarà {to === "renovado" ? "el nou venciment i les condicions" : "el motiu"}, com sempre.</Notice>}
        <div className="flex gap-2 text-[12px]"><button className="text-brand hover:underline" onClick={() => setSel(new Set(contracts.filter((c) => c.crm.status !== to).map((c) => c.id)))}>Marca'ls tots</button><button className="text-brand hover:underline" onClick={() => setSel(new Set())}>Desmarca'ls</button></div>
        <ul className="divide-y divide-line rounded-xl border border-line text-[12.5px]">
          {contracts.map((c) => {
            const same = c.crm.status === to;
            return (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <input type="checkbox" aria-label={`Inclou ${c.cliente}`} disabled={same} checked={sel.has(c.id) && !same} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                <span className="min-w-0 flex-1 truncate">{titleCase(c.cliente)} <span className="text-muted">· {c.cups ? `…${c.cups.slice(-6)}` : "sense CUPS"} · {fmtDate(expiry(c))}</span></span>
                <span className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium" style={{ background: STATUS_META[c.crm.status].soft, color: STATUS_META[c.crm.status].color }}>{same ? "ja hi és" : STATUS_META[c.crm.status].label}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
