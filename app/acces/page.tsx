"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { parseAccessParams, type AccessKind } from "@/core/access-link";
import { checkPassword } from "@/core/password";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";
import { Logo } from "@/ui/components/Shell";
import { PasswordStrength } from "@/ui/account";
import { Button, Field, Notice } from "@/ui/components/ui";

/**
 * Pàgina d'activació de l'accés (enllaç del correu d'invitació o de «Donar accés al portal»).
 * L'enllaç NO s'activa en obrir la pàgina: cal prémer el botó. Així els antivirus de correu que obren
 * els enllaços automàticament no el gasten abans que hi arribi la persona.
 */
export default function Acces() {
  const router = useRouter();
  const [p, setP] = useState<{ tokenHash: string; kind: AccessKind; next: string } | null | undefined>(undefined);
  const [step, setStep] = useState<"intro" | "password">("intro");
  const [pw, setPw] = useState({ a: "", b: "" });
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);

  useEffect(() => { setP(parseAccessParams(location.search)); }, []);

  const activate = async () => {
    if (!p) return;
    setBusy(true); setMsg(null);
    const sb = browserSupabase();
    await sb.auth.signOut({ scope: "local" }).catch(() => undefined); // si hi havia una altra sessió oberta en aquest navegador
    const { data, error } = await sb.auth.verifyOtp({ token_hash: p.tokenHash, type: p.kind });
    setBusy(false);
    if (error || !data.session) return setMsg({ tone: "red", text: "Aquest enllaç ha caducat o ja s'ha fet servir. Demana a Assessoria 3.0 que te n'enviï un de nou." });
    setEmail(data.user?.email ?? null);
    if (p.kind === "email") { // enllaç d'accés sense contrasenya: entra directament
      const role = data.user ? (await sb.from("profiles").select("role").eq("id", data.user.id).maybeSingle()).data?.role : null;
      return router.replace(role === "colaborador" ? "/collaboradors" : p.next);
    }
    setStep("password");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = checkPassword(pw.a, { email });
    if (!c.ok) return setMsg({ tone: "red", text: c.errors.join(" ") });
    if (pw.a !== pw.b) return setMsg({ tone: "red", text: "Les dues contrasenyes no coincideixen." });
    setBusy(true); setMsg(null);
    const sb = browserSupabase();
    const { error } = await sb.auth.updateUser({ password: pw.a });
    if (error) { setBusy(false); return setMsg({ tone: "red", text: /weak|pwned|leaked/i.test(error.message) ? "Contrasenya massa feble o filtrada. Tria'n una altra." : "No s'ha pogut desar la contrasenya. Torna-ho a provar." }); }
    const { data: u } = await sb.auth.getUser();
    const role = u.user ? (await sb.from("profiles").select("role").eq("id", u.user.id).maybeSingle()).data?.role : null;
    setMsg({ tone: "green", text: "Contrasenya desada. Ja pots entrar." });
    setTimeout(() => router.replace(role === "colaborador" ? "/collaboradors" : p!.next), 900);
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card">
        <Logo />
        {!supabaseConfigured ? <Notice>Supabase no està configurat en aquest desplegament.</Notice>
          : p === undefined ? <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Carregant…</p>
          : p === null ? <>
            <h1 className="pt-2 text-lg font-semibold">Enllaç no vàlid</h1>
            <p className="text-[13px] text-muted">L&apos;enllaç està incomplet. Obre&apos;l directament des del correu o demana&apos;n un de nou.</p>
          </>
          : step === "intro" ? <>
            <h1 className="pt-2 text-lg font-semibold">{p.kind === "invite" ? "Benvingut/da a Assessoria 3.0" : p.kind === "email" ? "Entra a Assessoria 3.0" : "Activa el teu accés"}</h1>
            <p className="text-[13px] text-muted">{p.kind === "email" ? "Prem el botó per entrar." : "Prem el botó per activar l'accés. Després triaràs la teva contrasenya."}</p>
            <Button variant="primary" size="lg" className="w-full" disabled={busy} onClick={activate}>{busy && <Loader2 size={15} className="animate-spin" />} {p.kind === "email" ? "Entra" : "Activa l'accés"}</Button>
          </>
          : <form onSubmit={save} className="space-y-4" aria-label="Contrasenya nova">
            <h1 className="pt-2 text-lg font-semibold">Tria la teva contrasenya</h1>
            {email && <p className="text-[13px] text-muted">Usuari: {email}</p>}
            <Field label="Contrasenya nova"><input className="input" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></Field>
            <PasswordStrength pw={pw.a} email={email} />
            <Field label="Repeteix-la"><input className="input" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></Field>
            <Button variant="primary" size="lg" className="w-full" disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />} Desa la contrasenya</Button>
          </form>}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {step === "intro" && <a href="/login" className="block text-center text-xs text-muted hover:text-ink">Ja tinc contrasenya: vés a l&apos;inici de sessió</a>}
      </div>
    </div>
  );
}
