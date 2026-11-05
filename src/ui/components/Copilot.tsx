"use client";
/**
 * Assistent conversacional lateral (Copilot IA). Les respostes surten d'eines autoritzades del servidor (amb els permisos
 * de l'usuari). Les accions sensibles arriben com a targetes que cal confirmar; mai s'executen soles.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, Loader2, MessageSquarePlus, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { useApp } from "@/data/store";
import { aiApi } from "../views/intelligence/api";
import { Button, cn, EASE_DRAWER } from "./ui";

type Source = { label: string; date: string | null };
type Pending = { id: string; token: string; tool: string; label: string };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[]; pending?: Pending[]; mode?: "ia" | "rules"; notice?: string | null };
type ChatRes = { conversationId: string; text: string; sources: Source[]; pending: Pending[]; mode: "ia" | "rules"; notice: string | null };

const EXAMPLES = ["Quins clients em toca trucar avui?", "Quins contractes vencen aquest mes?", "Mostra'm els 20 clients amb més consum anual", "Quines propostes estan pendents de resposta?", "Quins clients podrien estalviar més?", "Quants MWh he contractat aquest mes?", "Quines comissions tinc pendents de liquidar?", "Resumeix l'activitat comercial de la setmana"];

export function CopilotButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((v) => !v); } };
    const o = () => setOpen(true);
    window.addEventListener("keydown", h);
    window.addEventListener("a30:open-copilot", o);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("a30:open-copilot", o); };
  }, []);
  return (
    <>
      <button onClick={() => setOpen(true)} className="pressable flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink hover:border-brand/50 hover:text-brand" aria-label="Obre el Copilot IA" title="Copilot IA (Ctrl+J)">
        <Sparkles size={14} className="text-brand" /><span className="hidden md:inline">Copilot</span>
      </button>
      {/* portal: la capçalera té backdrop-filter i faria de contenidor dels elements «fixed» */}
      {typeof document !== "undefined" && createPortal(<AnimatePresence>{open && <CopilotPanel onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)}
    </>
  );
}

function CopilotPanel({ onClose }: { onClose: () => void }) {
  const { view, params, navigate, toast } = useApp();
  const [conv, setConv] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<Record<string, string>>({});
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  const context = view === "ia-oportunitat" && params.id ? { opportunityId: params.id } : view === "client" && params.id ? { clientId: params.id } : {};
  const ask = async (q: string) => {
    const m = q.trim();
    if (!m || busy) return;
    setText("");
    setMsgs((x) => [...x, { role: "user", content: m }]);
    setBusy(true);
    try {
      const r = await aiApi.copilot<ChatRes>({ action: "chat", conversationId: conv, message: m, context });
      setConv(r.conversationId);
      setMsgs((x) => [...x, { role: "assistant", content: r.text, sources: r.sources, pending: r.pending, mode: r.mode, notice: r.notice }]);
    } catch (e) {
      setMsgs((x) => [...x, { role: "assistant", content: e instanceof Error ? e.message : String(e), mode: "rules" }]);
    } finally { setBusy(false); }
  };
  const decide = async (p: Pending, decision: "confirmar" | "rebutjar") => {
    try {
      const r = await aiApi.copilot<{ status: string; summary?: string; link?: { view: string; params: Record<string, string> } | null }>({ action: "confirm", id: p.id, token: p.token, decision });
      setDecided((d) => ({ ...d, [p.id]: r.status === "executada" ? `Fet: ${r.summary ?? ""}` : "Rebutjada" }));
      if (r.status === "executada") { toast({ title: "Acció confirmada", body: r.summary, tone: "ok" }); if (r.link) navigate(r.link.view as never, r.link.params); }
    } catch (e) { toast({ title: "No s'ha pogut executar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-black/20 lg:bg-transparent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside role="dialog" aria-label="Copilot IA" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-line bg-surface shadow-2xl" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.32, ease: EASE_DRAWER }}>
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand to-emerald-500 text-white"><Bot size={16} /></span>
          <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">Copilot IA</p><p className="flex items-center gap-1 text-[11px] text-muted"><ShieldCheck size={11} /> Només dades que pots veure · cita fonts i dates</p></div>
          <button className="rounded-lg p-1.5 text-muted hover:bg-ink/5" aria-label="Conversa nova" onClick={() => { setConv(null); setMsgs([]); setDecided({}); }}><MessageSquarePlus size={16} /></button>
          <button className="rounded-lg p-1.5 text-muted hover:bg-ink/5" aria-label="Tanca el Copilot" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {!msgs.length && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-muted">Pregunta sobre la teva cartera. Les dades surten del CRM; els estalvis i comissions són estimacions.</p>
              <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} className="rounded-full border border-line px-2.5 py-1 text-left text-[11.5px] hover:border-brand/50 hover:text-brand" onClick={() => void ask(e)}>{e}</button>)}
                {context.opportunityId && <button className="rounded-full border border-brand/40 px-2.5 py-1 text-[11.5px] text-brand" onClick={() => void ask("Prepara una proposta per a aquest client")}>Prepara una proposta per a aquest client</button>}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[92%] rounded-2xl px-3 py-2 text-[12.8px]", m.role === "user" ? "bg-brand text-white dark:text-zinc-950" : "bg-elevated")}>
                {m.notice && <p className="mb-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">{m.notice}</p>}
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.pending?.map((p) => (
                  <div key={p.id} className="mt-2 rounded-xl border border-line bg-surface p-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Acció pendent de confirmació</p>
                    <p className="mt-0.5 text-[12.5px]">{p.label}</p>
                    {decided[p.id] ? <p className="mt-1.5 text-[12px] font-medium text-brand">{decided[p.id]}</p> : (
                      <div className="mt-2 flex gap-1.5"><Button size="sm" variant="primary" onClick={() => void decide(p, "confirmar")}><Check size={12} /> Confirma</Button><Button size="sm" onClick={() => void decide(p, "rebutjar")}>Rebutja</Button></div>
                    )}
                  </div>
                ))}
                {m.sources && m.sources.length > 0 && <p className="mt-1.5 text-[10.5px] text-muted">Fonts: {m.sources.map((s) => `${s.label}${s.date ? ` (${s.date})` : ""}`).join(" · ")}</p>}
                {m.role === "assistant" && m.mode && <p className="mt-1 text-[10px] uppercase tracking-wide text-muted/80">{m.mode === "ia" ? "Resposta IA amb eines del CRM" : "Mode sense IA · regles"}</p>}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-[12px] text-muted"><Loader2 size={13} className="animate-spin" /> Consultant el CRM…</div>}
          <div ref={end} />
        </div>
        <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
          <textarea className="input max-h-32 min-h-[40px] flex-1 resize-none py-2 text-[13px]" rows={1} maxLength={2000} placeholder="Escriu la pregunta…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(text); } }} aria-label="Pregunta al Copilot" />
          <Button variant="primary" type="submit" disabled={busy || !text.trim()} aria-label="Envia"><Send size={14} /></Button>
        </form>
      </motion.aside>
    </>
  );
}
