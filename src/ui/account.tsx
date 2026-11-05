"use client";
/**
 * Compte de l'usuari: tancar sessió, menú d'usuari i apartat SEGURETAT del perfil (canvi i recuperació de contrasenya).
 * No es desa cap contrasenya: el canvi el fa Supabase Auth al servidor després de verificar l'actual.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, LogOut, MailCheck, ShieldCheck, UserCircle } from "lucide-react";
import { checkPassword, SCORE_LABEL } from "@/core/password";
import { ROLE_LABEL } from "@/core/roles";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";
import { useApp } from "@/data/store";
import { Button, Notice, cn } from "./components/ui";

/** Esborra l'estat sensible del navegador (memòria de pantalles, recents, esborranys locals). Conserva tema i preferències visuals. */
export function clearSensitiveState() {
  try { sessionStorage.clear(); } catch { /* ignore */ }
  try {
    for (const k of Object.keys(localStorage)) if (/^a30[:.]|^rip:(contracts|snap|data)|^crm[:.]/.test(k)) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

/** Tanca la sessió de Supabase Auth (aquest dispositiu o tots), neteja l'estat i torna a l'inici de sessió. */
export async function signOut(scope: "local" | "global" = "local") {
  if (supabaseConfigured) { try { await browserSupabase().auth.signOut({ scope }); } catch { /* es continua igualment */ } }
  clearSensitiveState();
  location.replace(supabaseConfigured ? "/login" : "/");
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export function UserMenu() {
  const me = useApp((s) => s.snap?.me);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  if (!me) return null;
  const go = (tab?: string) => { setOpen(false); useApp.getState().navigate("perfil", tab ? { tab } : {}); };
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Menú d'usuari" aria-expanded={open} aria-haspopup="menu" title={me.name} onClick={() => setOpen((x) => !x)}
        className="pressable grid h-8 w-8 place-items-center rounded-full bg-brand/15 text-[11.5px] font-semibold text-brand ring-1 ring-brand/20 hover:bg-brand/25">{initials(me.name)}</button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lift">
          <div className="border-b border-line px-2.5 pb-2 pt-1.5">
            <p className="truncate text-[13px] font-semibold">{me.name}</p>
            <p className="truncate text-[11.5px] text-muted">{me.email}</p>
            <p className="text-[11px] text-muted">{ROLE_LABEL[me.role] ?? me.role}</p>
          </div>
          <button role="menuitem" onClick={() => go()} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-ink/[0.05]"><UserCircle size={15} className="text-muted" /> El meu perfil</button>
          <button role="menuitem" onClick={() => go("seguretat")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-ink/[0.05]"><ShieldCheck size={15} className="text-muted" /> Seguretat i contrasenya</button>
          <button role="menuitem" disabled={busy} onClick={() => { setBusy(true); void signOut(); }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-2.5 py-2 text-left text-[13px] font-medium text-lost hover:bg-lost/[0.06]">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />} Tanca la sessió
          </button>
          {!supabaseConfigured && <p className="px-2.5 pb-1 text-[11px] text-muted">Mode local: no hi ha cap sessió oberta al servidor.</p>}
        </div>
      )}
    </div>
  );
}

/* ======================================================================= SEGURETAT (perfil) */

export function PasswordStrength({ pw, email, name }: { pw: string; email?: string | null; name?: string | null }) {
  if (!pw) return null;
  const c = checkPassword(pw, { email, name });
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < c.score ? (c.score >= 3 ? "bg-ren" : c.score === 2 ? "bg-amber-500" : "bg-lost") : "bg-ink/10")} />)}</div>
      <p className="text-[11.5px] text-muted">Seguretat: {SCORE_LABEL[c.score]}</p>
      {c.errors.length > 0 && <ul className="list-disc pl-4 text-[11.5px] text-lost">{c.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
  );
}

export function SecurityPanel() {
  const me = useApp((s) => s.snap?.me);
  const [f, setF] = useState({ current: "", next: "", repeat: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "blue"; text: string } | null>(null);
  const check = checkPassword(f.next, { email: me?.email, name: me?.name, current: f.current });
  const mismatch = !!f.repeat && f.repeat !== f.next;
  const canSave = !!f.current && check.ok && f.next === f.repeat && !busy;
  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy("change"); setMsg(null);
    try {
      const r = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "password", current: f.current, next: f.next }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setF({ current: "", next: "", repeat: "" });
      setMsg({ tone: "green", text: "Contrasenya canviada. La propera vegada que entris, fes servir la nova." });
    } catch (err) { setMsg({ tone: "red", text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(null); }
  };
  const recover = async () => {
    if (!me?.email) return;
    setBusy("recover"); setMsg(null);
    const { error } = await browserSupabase().auth.resetPasswordForEmail(me.email, { redirectTo: `${location.origin}/login?reset=1` });
    setBusy(null);
    setMsg(error ? { tone: "red", text: /rate|seconds/i.test(error.message) ? "Ja s'ha enviat un correu fa poc. Espera uns minuts abans de tornar-ho a demanar." : "No s'ha pogut enviar el correu de recuperació." } : { tone: "blue", text: `T'hem enviat un enllaç a ${me.email} per triar una contrasenya nova.` });
  };
  if (!supabaseConfigured) return <Notice tone="blue">En mode local no hi ha comptes d&apos;usuari: la seguretat del compte s&apos;activa amb Supabase.</Notice>;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <form onSubmit={change} className="space-y-3 rounded-2xl border border-line bg-surface p-4 lg:col-span-2" aria-label="Canvi de contrasenya">
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><KeyRound size={15} /> Canviar la contrasenya</h3>
        <input type="email" autoComplete="username" value={me?.email ?? ""} readOnly hidden />
        <label className="block"><span className="label">Contrasenya actual</span><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Contrasenya nova</span><input className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></label>
          <label className="block"><span className="label">Repeteix la nova</span><input className={cn("input", mismatch && "border-lost/60")} type="password" autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} />{mismatch && <span className="mt-1 block text-[11px] text-lost">No coincideix amb la nova.</span>}</label>
        </div>
        <PasswordStrength pw={f.next} email={me?.email} name={me?.name} />
        <p className="text-[11.5px] text-muted">Mínim 10 caràcters, amb lletres i números, sense el teu nom ni el teu correu. Per seguretat es comprova primer la contrasenya actual.</p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="flex justify-end"><Button variant="primary" disabled={!canSave}>{busy === "change" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Desa la contrasenya nova</Button></div>
      </form>
      <div className="space-y-3">
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><MailCheck size={15} /> No recordes l&apos;actual?</h3>
          <p className="text-muted">T&apos;enviem un enllaç al teu correu per triar-ne una de nova sense la contrasenya actual.</p>
          <Button size="sm" disabled={!!busy} onClick={() => void recover()}>{busy === "recover" && <Loader2 size={13} className="animate-spin" />} Envia&apos;m l&apos;enllaç</Button>
        </section>
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><LogOut size={15} /> Sessions</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void signOut("local")}>Tanca la sessió</Button>
            <Button size="sm" variant="ghost" onClick={() => void signOut("global")}>Tanca-la a tots els dispositius</Button>
          </div>
          <p className="text-muted">La verificació en dos passos (MFA) es manté igual; la gestiona Direcció a Administració → Seguretat.</p>
        </section>
      </div>
    </div>
  );
}
