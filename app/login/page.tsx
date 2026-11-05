"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { checkPassword } from "@/core/password";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";
import { Logo } from "@/ui/components/Shell";
import { PasswordStrength } from "@/ui/account";
import { Button, Field, Notice } from "@/ui/components/ui";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  // Recuperació de contrasenya: s'hi arriba des de l'enllaç del correu (?reset=1)
  const [reset, setReset] = useState<"no" | "waiting" | "ready">("no");
  const [next, setNext] = useState({ a: "", b: "" });

  useEffect(() => {
    if (!supabaseConfigured) return;
    const wants = new URLSearchParams(location.search).get("reset") === "1";
    if (wants) setReset("waiting");
    const sb = browserSupabase();
    const { data } = sb.auth.onAuthStateChange((ev, session) => {
      if (ev === "PASSWORD_RECOVERY" || (wants && session)) setReset("ready");
    });
    if (wants) void sb.auth.getSession().then(({ data: s }) => { if (s.session) setReset("ready"); });
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await browserSupabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setMsg({ tone: "red", text: "Correu o contrasenya incorrectes." }); return; }
    // destinació: només rutes internes; els col·laboradors van al seu portal
    const nextUrl = new URLSearchParams(location.search).get("next");
    const { data: u } = await browserSupabase().auth.getUser();
    const role = u.user ? (await browserSupabase().from("profiles").select("role").eq("id", u.user.id).maybeSingle()).data?.role : null;
    router.replace(nextUrl && /^\/[a-z]/.test(nextUrl) && !nextUrl.startsWith("//") ? nextUrl : role === "colaborador" ? "/collaboradors" : "/");
  };
  const magic = async () => {
    if (!email) return setMsg({ tone: "red", text: "Escriu primer el teu correu." });
    setBusy(true);
    const { error } = await browserSupabase().auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin, shouldCreateUser: false } });
    setBusy(false);
    setMsg(error ? { tone: "red", text: error.message } : { tone: "green", text: "T'hem enviat un enllaç d'accés." });
  };
  const forgot = async () => {
    if (!email) return setMsg({ tone: "red", text: "Escriu primer el teu correu i torna a prémer «He oblidat la contrasenya»." });
    setBusy(true);
    const { error } = await browserSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/login?reset=1` });
    setBusy(false);
    // mateix missatge tant si el correu existeix com si no (no es revela quins usuaris hi ha)
    setMsg(error && /rate|seconds/i.test(error.message) ? { tone: "red", text: "Ja s'ha enviat un correu fa poc. Espera uns minuts." } : { tone: "green", text: "Si el correu és d'un usuari del CRM, rebràs un enllaç per triar una contrasenya nova." });
  };
  const saveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = browserSupabase();
    const { data: u } = await sb.auth.getUser();
    const c = checkPassword(next.a, { email: u.user?.email });
    if (!c.ok) return setMsg({ tone: "red", text: c.errors.join(" ") });
    if (next.a !== next.b) return setMsg({ tone: "red", text: "Les dues contrasenyes no coincideixen." });
    setBusy(true); setMsg(null);
    const { error } = await sb.auth.updateUser({ password: next.a });
    setBusy(false);
    if (error) return setMsg({ tone: "red", text: /weak|pwned|leaked/i.test(error.message) ? "Contrasenya massa feble o filtrada. Tria'n una altra." : "L'enllaç ha caducat o ja s'ha fet servir. Demana'n un de nou." });
    setMsg({ tone: "green", text: "Contrasenya canviada. Ja pots fer servir el CRM." });
    setTimeout(() => router.replace("/"), 1200);
  };

  if (reset !== "no") {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg p-6">
        <form onSubmit={saveNew} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card" aria-label="Contrasenya nova">
          <Logo />
          <h1 className="pt-2 text-lg font-semibold">Tria una contrasenya nova</h1>
          {reset === "waiting" ? <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Validant l&apos;enllaç…</p> : <>
            <Field label="Contrasenya nova"><input className="input" type="password" autoComplete="new-password" value={next.a} onChange={(e) => setNext({ ...next, a: e.target.value })} /></Field>
            <PasswordStrength pw={next.a} />
            <Field label="Repeteix-la"><input className="input" type="password" autoComplete="new-password" value={next.b} onChange={(e) => setNext({ ...next, b: e.target.value })} /></Field>
            <Button variant="primary" size="lg" className="w-full" disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />} Desa la contrasenya</Button>
          </>}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {reset === "waiting" && <button type="button" onClick={() => setReset("no")} className="w-full text-center text-xs text-muted hover:text-ink">Torna a l&apos;inici de sessió</button>}
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <form onSubmit={signIn} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card">
        <Logo />
        <h1 className="pt-2 text-lg font-semibold">Accedeix a les teves renovacions</h1>
        {!supabaseConfigured && <Notice>Supabase no està configurat en aquest desplegament.</Notice>}
        <Field label="Correu electrònic"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Contrasenya"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Button variant="primary" size="lg" className="w-full" disabled={busy || !supabaseConfigured}>{busy && <Loader2 size={15} className="animate-spin" />} Entra</Button>
        <div className="flex justify-between gap-2 text-xs">
          <button type="button" onClick={forgot} className="text-muted hover:text-ink">He oblidat la contrasenya</button>
          <button type="button" onClick={magic} className="text-muted hover:text-ink">Envia&apos;m un enllaç d&apos;accés</button>
        </div>
      </form>
    </div>
  );
}
