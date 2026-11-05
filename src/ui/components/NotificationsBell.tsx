"use client";
/** Avisos interns del CRM (automatitzacions, assignacions, tasques). Temps real amb reserva d'actualització periòdica. */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, CheckCheck } from "lucide-react";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";
import { useApp, type View } from "@/data/store";
import { EASE_OUT, cn } from "./ui";

type N = { id: string; kind: string; title: string; body: string | null; link: { view: string; params: Record<string, string> } | null; read_at: string | null; created_at: string };

export function NotificationsBell() {
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(() => fetch("/api/crm/sales?r=notifications", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { setItems(j.items); setUnread(j.unread); } }).catch(() => undefined), []);
  useEffect(() => {
    if (!supabaseConfigured) return;
    void load();
    const ch = browserSupabase().channel("crm-notifs").on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_notifications" }, () => void load()).subscribe();
    const iv = setInterval(load, 120_000);
    // Fase 10: amb el CRM obert, cada minut es generen els recordatoris de l'agenda que ja toquen (sense duplicats)
    const tick = () => fetch("/api/agenda", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "tick" }) })
      .then((r) => (r.ok ? r.json() : null)).then((j: { sent?: number } | null) => { if (j?.sent) void load(); }).catch(() => undefined);
    void tick();
    const it = setInterval(tick, 60_000);
    return () => { clearInterval(iv); clearInterval(it); void browserSupabase().removeChannel(ch); };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const read = async (ids: string[] | "all") => {
    await fetch("/api/crm/sales", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity: "notifications", ids }) }).catch(() => undefined);
    void load();
  };
  if (!supabaseConfigured) return null;
  return (
    <div ref={box} className="relative">
      <button aria-label={`Avisos${unread ? ` (${unread} sense llegir)` : ""}`} onClick={() => setOpen(!open)} className="pressable relative rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink">
        <Bell size={17} />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-lost px-1 text-[9.5px] font-bold text-white tnum">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: EASE_OUT }} className="absolute right-0 top-11 z-40 w-[360px] origin-top-right overflow-hidden rounded-xl border border-line bg-surface shadow-lift">
            <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="text-[13px] font-semibold">Avisos</span>{unread > 0 && <button className="flex items-center gap-1 text-[12px] text-brand hover:underline" onClick={() => read("all")}><CheckCheck size={13} /> Marca-ho tot com a llegit</button>}</div>
            <ul className="max-h-[420px] overflow-y-auto">
              {items.length === 0 ? <li className="px-3 py-8 text-center text-[12.5px] text-muted">No tens cap avís.</li> : items.map((n) => (
                <li key={n.id}>
                  <button className={cn("flex w-full gap-2 border-b border-line/60 px-3 py-2.5 text-left hover:bg-ink/[0.03]", !n.read_at && "bg-brand/[0.04]")} onClick={() => { void read([n.id]); setOpen(false); if (n.link) useApp.getState().navigate(n.link.view as View, n.link.params); }}>
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand")} />
                    <span className="min-w-0"><span className="block text-[12.5px] font-medium">{n.title}</span>{n.body && <span className="block text-[11.5px] text-muted">{n.body}</span>}<span className="block text-[10.5px] text-muted">{new Date(n.created_at).toLocaleString("ca-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
