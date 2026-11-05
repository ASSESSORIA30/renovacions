"use client";
/** Configuració → Correu: compte SMTP corporatiu configurable des del CRM (només administradors). */
import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, Mail, Save, Send, Trash2, XCircle } from "lucide-react";
import { MAIL_PRESETS, MAIL_SECURITY, REPLY_TO_LABEL, REPLY_TO_MODES, SECURITY_LABEL, mailSettingsInput, type MailSecurity, type MailSettingsView, type ReplyToMode } from "@/core/mail";
import { fmtDateTime } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Field, Notice, cn } from "../components/ui";

async function call<T>(body?: unknown): Promise<T> {
  const r = await fetch("/api/settings/mail", { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}

type Form = { host: string; port: string; security: MailSecurity; username: string; password: string; fromName: string; fromEmail: string; replyToMode: ReplyToMode; replyTo: string; bccSender: boolean; enabled: boolean };
const toForm = (v: MailSettingsView): Form => ({ host: v.host, port: String(v.port || 587), security: v.security, username: v.username, password: "", fromName: v.fromName ?? "", fromEmail: v.fromEmail, replyToMode: v.replyToMode, replyTo: v.replyTo ?? "", bccSender: v.bccSender, enabled: v.enabled });
const presetFor = (host: string) => MAIL_PRESETS.find((p) => p.host && p.host === host.trim().toLowerCase())?.id ?? (host ? "altre" : "");

export function MailSettings() {
  const { repo, toast, snap } = useApp();
  const [v, setV] = useState<MailSettingsView | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [preset, setPreset] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const local = repo?.variant === "demo" || typeof location === "undefined" || !location.protocol.startsWith("http");

  const apply = (nv: MailSettingsView) => { setV(nv); setF(toForm(nv)); setPreset(presetFor(nv.host)); };
  useEffect(() => {
    if (local) return;
    call<MailSettingsView>().then(apply).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [local]);

  const refreshIntegrations = async () => { try { if (repo) useApp.setState({ integrations: await repo.integrations() }); } catch { /* sense canvis */ } };
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x));
  const payload = () => f && { ...f, port: Number(f.port), fromName: f.fromName || null, replyTo: f.replyTo || null };
  const check = () => {
    const r = mailSettingsInput.safeParse(payload());
    if (!r.success) { toast({ title: "Revisa les dades", body: r.error.issues.map((i) => i.message).join(" · "), tone: "err" }); return false; }
    if (!f!.password && !v?.hasPassword) { toast({ title: "Falta la contrasenya", tone: "err" }); return false; }
    return true;
  };

  const runTest = async (saved: boolean) => {
    setBusy(saved ? "Enviant el correu de prova…" : "Provant la connexió…");
    try {
      const r = await call<{ ok: boolean; to: string; error?: string }>(saved ? { action: "test" } : { action: "test", settings: payload() });
      setTest(r.ok ? { ok: true, text: `Correu de prova enviat a ${r.to}. Comprova la safata d'entrada (i la de correu brossa).` } : { ok: false, text: r.error ?? "Error desconegut" });
      if (saved) apply(await call<MailSettingsView>());
    } catch (e) {
      setTest({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!check()) return;
    setBusy("Desant…");
    try {
      apply(await call<MailSettingsView>({ action: "save", settings: payload() }));
      setShow(false);
      toast({ title: "Configuració del correu desada", body: "La contrasenya s'ha desat xifrada.", tone: "ok" });
      await refreshIntegrations();
      await runTest(true);
    } catch (e) {
      toast({ title: "No s'ha pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" });
      setBusy(null);
    }
  };

  if (local) return <Notice tone="blue">El correu corporatiu es configura a la plataforma desplegada (amb Supabase). En aquest mode local no es pot enviar correu.</Notice>;
  if (loadError) return <Notice tone="red">{loadError}</Notice>;
  if (!v || !f) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" /> Carregant…</p>;

  const p = MAIL_PRESETS.find((x) => x.id === preset);
  const status = v.source === "crm" ? { tone: "green" as const, text: "Actiu · configurat aquí" } : v.source === "entorn" ? { tone: "blue" as const, text: "Actiu · variables SMTP de Vercel" } : { tone: "red" as const, text: "Sense configurar" };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Mail size={16} className="text-brand" /> Correu corporatiu</h3>
            <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">El compte amb què el CRM envia propostes, comparatives i correus als clients. La contrasenya es desa xifrada al servidor i no es torna a mostrar mai.</p>
          </div>
          <Badge tone={status.tone}>{status.text}</Badge>
        </div>
        {v.passwordUnreadable && <div className="mt-3"><Notice tone="red">La contrasenya desada no es pot llegir (ha canviat la clau del servidor). Torna-la a escriure i desa.</Notice></div>}
        {v.source === "entorn" && !v.hasPassword && <div className="mt-3"><Notice tone="blue">Ara s&apos;utilitzen les variables SMTP_* de Vercel. Si deses una configuració aquí, passarà a tenir prioritat.</Notice></div>}
        {v.lastTest && (
          <p className={cn("mt-3 flex items-center gap-1.5 text-[12.5px]", v.lastTest.ok ? "text-ren" : "text-lost")}>
            {v.lastTest.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            Última prova {fmtDateTime(v.lastTest.at)}: {v.lastTest.ok ? "correcta" : v.lastTest.error}
          </p>
        )}
        {v.updatedAt && v.source === "crm" && <p className="mt-1 text-[11.5px] text-muted">Desat per {v.updatedByName ?? "—"} el {fmtDateTime(v.updatedAt)}</p>}
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Proveïdor">
            <select className="input" value={preset} onChange={(e) => { const x = MAIL_PRESETS.find((m) => m.id === e.target.value); setPreset(e.target.value); if (x && x.host) set({ host: x.host, port: String(x.port), security: x.security }); }}>
              <option value="">Tria'l…</option>
              {MAIL_PRESETS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Servidor SMTP"><input className="input" value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.ionos.es" autoComplete="off" /></Field>
          <div className="grid grid-cols-[90px_1fr] gap-2">
            <Field label="Port"><input className="input tnum" inputMode="numeric" value={f.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="Seguretat"><select className="input" value={f.security} onChange={(e) => { const s = e.target.value as MailSecurity; set({ security: s, port: s === "ssl" ? "465" : s === "starttls" && f.port === "465" ? "587" : f.port }); }}>{MAIL_SECURITY.map((s) => <option key={s} value={s}>{SECURITY_LABEL[s]}</option>)}</select></Field>
          </div>
        </div>
        {p && <p className="rounded-xl bg-elevated px-3 py-2 text-[12px] text-muted">{p.note}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Usuari (normalment l'adreça de correu)"><input className="input" value={f.username} onChange={(e) => set({ username: e.target.value, ...(!f.fromEmail || f.fromEmail === f.username ? { fromEmail: e.target.value.includes("@") ? e.target.value : f.fromEmail } : {}) })} placeholder="propostes@assessoria30.com" autoComplete="off" /></Field>
          <Field label="Contrasenya">
            <div className="relative">
              <input className="input pr-9" type={show ? "text" : "password"} value={f.password} onChange={(e) => set({ password: e.target.value })} placeholder={v.hasPassword ? "Desada · deixa-ho en blanc per mantenir-la" : "Contrasenya del compte o d'aplicació"} autoComplete="new-password" />
              <button type="button" aria-label={show ? "Amaga la contrasenya" : "Mostra la contrasenya"} onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </Field>
          <Field label="Nom del remitent (el que veu el client)"><input className="input" value={f.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="Assessoria 3.0" /></Field>
          <Field label="Adreça del remitent"><input className="input" value={f.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} placeholder="propostes@assessoria30.com" /></Field>
          <Field label="Quan el client respon, la resposta va…">
            <select className="input" value={f.replyToMode} onChange={(e) => set({ replyToMode: e.target.value as ReplyToMode })}>{REPLY_TO_MODES.map((m) => <option key={m} value={m}>{REPLY_TO_LABEL[m]}</option>)}</select>
          </Field>
          {f.replyToMode === "fixa" ? <Field label="Adreça de resposta"><input className="input" value={f.replyTo} onChange={(e) => set({ replyTo: e.target.value })} placeholder="comercial@assessoria30.com" /></Field> : <p className="self-end pb-2 text-[12px] text-muted">{f.replyToMode === "usuari" ? "Cada comercial rep les respostes dels seus clients al seu correu." : "Les respostes arriben a l'adreça del remitent."}</p>}
        </div>
        <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={f.bccSender} onChange={(e) => set({ bccSender: e.target.checked })} /> Desa una còpia oculta de cada correu enviat a l&apos;adreça del remitent</label>
        {v.hasPassword && <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Fes servir aquesta configuració (si la desactives, s&apos;usaran les variables de Vercel, si n&apos;hi ha)</label>}
        <p className="text-[11.5px] text-muted">El remitent ha de ser l&apos;adreça del compte o un àlies autoritzat; si no, molts servidors rebutgen el correu. La prova s&apos;envia a {snap?.me.email ?? "la teva adreça"}.</p>

        {test && <Notice tone={test.ok ? "green" : "red"}>{test.text}</Notice>}
        {busy && <p className="flex items-center gap-2 text-[12.5px] text-muted"><Loader2 size={14} className="animate-spin" /> {busy}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!!busy} onClick={save}><Save size={14} /> Desa i envia una prova</Button>
          <Button disabled={!!busy} onClick={() => { if (check()) void runTest(false); }}><Send size={14} /> Prova sense desar</Button>
          {v.hasPassword && (
            <Button variant="ghost" className="ml-auto text-lost" disabled={!!busy} onClick={async () => {
              if (!confirm("Segur que vols eliminar la configuració del correu? El CRM deixarà d'enviar correus (llevat que hi hagi variables SMTP a Vercel).")) return;
              setBusy("Eliminant…");
              try { apply(await call<MailSettingsView>({ action: "delete" })); setTest(null); await refreshIntegrations(); toast({ title: "Configuració eliminada", tone: "ok" }); } catch (e) { toast({ title: "Error", body: String(e), tone: "err" }); } finally { setBusy(null); }
            }}><Trash2 size={14} /> Elimina</Button>
          )}
        </div>
      </section>
    </div>
  );
}
