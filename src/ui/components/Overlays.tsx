"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, Undo2, XCircle } from "lucide-react";
import { addMonths, today } from "@/core/dates";
import { expiry } from "@/core/insights";
import { titleCase } from "@/core/templates";
import { useApp } from "@/data/store";
import { Button, EASE_OUT, Field, Modal, cn } from "./ui";

const MOTIVOS = ["Preu", "Es queda amb la seva comercialitzadora", "Ha canviat amb una altra assessoria", "Tancament o baixa del subministrament", "No respon", "Mala experiència prèvia", "Altres"];

export function CloseDialog() {
  const { closeDialog, byId, move, nextClose, closeQueue } = useApp();
  const c = closeDialog ? byId[closeDialog.contractId] : null;
  const [fecha, setFecha] = useState("");
  const [cond, setCond] = useState("");
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [detalle, setDetalle] = useState("");
  useEffect(() => {
    if (!c) return;
    const base = expiry(c) ?? today();
    setFecha(addMonths(base > today() ? base : today(), 12));
    setCond(""); setMotivo(MOTIVOS[0]); setDetalle("");
  }, [closeDialog?.contractId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c || !closeDialog) return <Modal open={false} onClose={() => {}} title="">{null}</Modal>;
  const renew = closeDialog.to === "renovado";
  // si ve d'un moviment de grup, en tancar (o cancel·lar) aquest es passa al següent contracte seleccionat
  const close = () => nextClose();
  const confirm = async () => {
    if (renew) await move(c.id, "renovado", { nuevaFechaVencimiento: fecha, condicionesRenovacion: cond || null }, `Nou venciment ${fecha}${cond ? ` · ${cond}` : ""}`);
    else await move(c.id, "no_renueva", { motivoRechazo: detalle ? `${motivo}: ${detalle}` : motivo });
    close();
  };
  return (
    <Modal open onClose={close} title={<>{renew ? `Renovació de ${titleCase(c.cliente)}` : `${titleCase(c.cliente)} no vol renovar`}{closeQueue.length > 0 && <span className="ml-2 text-[12px] font-normal text-muted">(en queden {closeQueue.length} més del grup)</span>}</>}
      footer={<><Button variant="ghost" onClick={close}>{closeQueue.length ? "Salta aquest" : "Cancel·la"}</Button><Button variant={renew ? "success" : "danger"} onClick={confirm} disabled={renew && !fecha}>{renew ? "Marca com a renovat" : "Marca com a perdut"}</Button></>}>
      {renew ? (
        <div className="space-y-3">
          <Field label="Nou venciment" hint="Es farà servir per a la propera renovació. Per defecte, 12 mesos."><input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
          <Field label="Condicions acordades (opcional)"><textarea className="input min-h-[80px]" placeholder="Comercialitzadora, producte, preus…" value={cond} onChange={(e) => setCond(e.target.value)} /></Field>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <span className="label">Motiu</span>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS.map((m) => <button key={m} onClick={() => setMotivo(m)} className={cn("pressable rounded-full border px-2.5 py-1 text-[12px]", motivo === m ? "border-lost bg-lost/10 font-medium text-lost" : "border-line hover:border-ink/25")}>{m}</button>)}
            </div>
          </div>
          <Field label="Detall (opcional)"><textarea className="input min-h-[70px]" value={detalle} onChange={(e) => setDetalle(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex w-[min(92vw,380px)] -translate-x-1/2 flex-col gap-2 sm:left-4 sm:translate-x-0" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }} transition={{ duration: 0.25, ease: EASE_OUT }}
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-lift">
            {t.tone === "err" ? <XCircle size={17} className="mt-px shrink-0 text-lost" /> : t.tone === "info" ? <Info size={17} className="mt-px shrink-0 text-cont" /> : <CheckCircle2 size={17} className="mt-px shrink-0 text-ren" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[12px] text-muted">{t.body}</p>}
            </div>
            {t.undo && <button onClick={() => { t.undo!(); dismiss(t.id); }} className="pressable inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand/10"><Undo2 size={13} /> Desfés</button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
