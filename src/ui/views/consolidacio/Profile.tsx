"use client";
/** Fase 8 · EL MEU PERFIL → COMUNICACIONS → EMAIL / WHATSAPP. Cada usuari configura només els seus comptes. */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, Loader2, Mail, MessageCircle, Plug, ShieldOff, UserCircle } from "lucide-react";
import { useApp } from "@/data/store";
import { Button, Notice, Tabs, cn } from "../../components/ui";
import { PageHead, Panel, fdt } from "./shared";
import { SecurityPanel } from "../../account";

type Mine = {
  mail: { provider: string; from_name: string; from_email: string; reply_to: string | null; signature: string | null; host: string | null; port: number | null; security: string | null; username: string | null; hasPassword: boolean; enabled: boolean; last_test_at: string | null; last_test_ok: boolean | null; last_test_error: string | null; revoked_at: string | null } | null;
  whatsapp: { mode: "enllac" | "cloud"; phone_e164: string | null; display_name: string | null; default_number_id: string | null } | null;
  numbers: { id: string; display_phone: string; label: string }[]; cloudConfigured: boolean; oauth: { note: string };
};
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
}
const act = <T = { ok: boolean },>(action: string, data?: unknown) => call<T>("/api/comms", { method: "POST", body: JSON.stringify({ action, data }) });
const PRESETS: Record<string, { host: string; port: number; security: string; help: string }> = {
  "Microsoft 365 / Outlook": { host: "smtp.office365.com", port: 587, security: "starttls", help: "Cal tenir activat l'SMTP autenticat al compte." },
  "Gmail / Google Workspace": { host: "smtp.gmail.com", port: 465, security: "ssl", help: "Fes servir una contrasenya d'aplicació (verificació en dos passos activada)." },
  "Altres (SMTP del teu proveïdor)": { host: "", port: 587, security: "starttls", help: "Demana les dades SMTP al teu proveïdor de correu." },
};

export function ProfileView() {
  const me = useApp((s) => s.snap?.me);
  const params = useApp((s) => s.params);
  const [tab, setTab] = useState<"email" | "whatsapp" | "seguretat">((params.tab as "email") ?? "email");
  useEffect(() => { if (params.tab === "seguretat" || params.tab === "email" || params.tab === "whatsapp") setTab(params.tab); }, [params.tab]);
  const [d, setD] = useState<Mine | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => call<Mine>("/api/comms").then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="mx-auto max-w-[1000px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<UserCircle size={16} />} title="El meu perfil" sub={me ? `${me.name} · ${me.email}. Comunicacions: el correu i el WhatsApp des dels quals envies als clients.` : undefined} tone="from-slate-700 to-slate-500" />
      <Tabs value={tab} onChange={setTab} items={[{ id: "email", label: "Comunicacions · Email" }, { id: "whatsapp", label: "Comunicacions · WhatsApp" }, { id: "seguretat", label: "Seguretat" }]} />
      {tab === "seguretat" ? <SecurityPanel /> : <>
      {err && <Notice tone={/015/.test(err) ? "amber" : "red"}>{err}</Notice>}
      {!d ? (!err && <div className="h-60 animate-pulse rounded-2xl bg-elevated" />) : tab === "email" ? <EmailForm d={d} reload={load} /> : <WhatsappForm d={d} reload={load} />}
      {tab === "whatsapp" && me?.role === "admin" && <BusinessNumbers />}
      </>}
    </div>
  );
}

function EmailForm({ d, reload }: { d: Mine; reload: () => void }) {
  const toast = useApp((s) => s.toast);
  const m = d.mail;
  const [f, setF] = useState({ from_name: m?.from_name ?? "", from_email: m?.from_email ?? "", reply_to: m?.reply_to ?? "", signature: m?.signature ?? "", host: m?.host ?? "", port: String(m?.port ?? 587), security: m?.security ?? "starttls", username: m?.username ?? "", password: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); setRes(null); try { await fn(); } catch (e) { setRes({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(null); } };
  const save = () => run("save", async () => { await act("mail_save", { provider: "smtp", ...f, port: Number(f.port), reply_to: f.reply_to || null, password: f.password || undefined }); setF({ ...f, password: "" }); toast({ title: "Configuració de correu desada", tone: "ok" }); reload(); setRes({ ok: true, text: "Desat al servidor. Ara prova la connexió." }); });
  const test = () => run("test", async () => { const r = await act<{ ok: boolean; error: string | null }>("mail_test"); setRes(r.ok ? { ok: true, text: "Connexió correcta: el servidor SMTP accepta les credencials." } : { ok: false, text: r.error ?? "Error" }); reload(); });
  const revoke = () => { if (confirm("Vols revocar la connexió? S'esborrarà la credencial desada.")) void run("revoke", async () => { await act("mail_revoke"); reload(); setRes({ ok: true, text: "Connexió revocada i credencial esborrada." }); }); };
  const input = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label className="block space-y-1"><span className="text-[11.5px] text-muted">{label}</span><input className="input h-9" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></label>;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel title={<span className="flex items-center gap-1.5"><Mail size={14} /> El meu correu</span>} className="lg:col-span-2">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {input("from_name", "Nom del remitent", { placeholder: "Patricia · Assessoria 3.0" })}
          {input("from_email", "Adreça de correu", { type: "email", placeholder: "nom@assessoria30.com" })}
          {input("reply_to", "Correu de resposta (opcional)", { type: "email" })}
          <label className="block space-y-1"><span className="text-[11.5px] text-muted">Proveïdor</span><select className="input h-9" defaultValue="" onChange={(e) => { const p = PRESETS[e.target.value]; if (p) setF({ ...f, host: p.host, port: String(p.port), security: p.security }); }}><option value="">Tria per omplir el servidor…</option>{Object.keys(PRESETS).map((k) => <option key={k}>{k}</option>)}</select></label>
          {input("host", "Servidor SMTP", { placeholder: "smtp.office365.com" })}
          <div className="grid grid-cols-2 gap-2">{input("port", "Port", { inputMode: "numeric" })}<label className="block space-y-1"><span className="text-[11.5px] text-muted">Connexió segura</span><select className="input h-9" value={f.security} onChange={(e) => setF({ ...f, security: e.target.value })}><option value="starttls">STARTTLS (587)</option><option value="ssl">SSL/TLS (465)</option><option value="none">Sense xifrat (no recomanat)</option></select></label></div>
          {input("username", "Usuari SMTP", { autoComplete: "off" })}
          {input("password", m?.hasPassword ? "Credencial (deixa-ho en blanc per conservar la desada)" : "Credencial / contrasenya d'aplicació", { type: "password", autoComplete: "new-password", placeholder: m?.hasPassword ? "••••••••  (desada i xifrada)" : "" })}
          <label className="block space-y-1 sm:col-span-2"><span className="text-[11.5px] text-muted">Signatura personal</span><textarea className="input min-h-[80px]" value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} /></label>
        </div>
        {res && <div className="mt-2"><Notice tone={res.ok ? "green" : "red"}>{res.text}</Notice></div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={save} disabled={!!busy}>{busy === "save" && <Loader2 size={13} className="animate-spin" />} Desa</Button>
          <Button onClick={test} disabled={!!busy || !m}>{busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Prova la connexió</Button>
          {m && !m.revoked_at && <Button variant="ghost" onClick={revoke} disabled={!!busy}><ShieldOff size={13} /> Revoca</Button>}
        </div>
      </Panel>
      <Panel title="Estat">
        <ul className="space-y-2 text-[12.5px]">
          <li className="flex items-start gap-2">{m?.enabled ? <CheckCircle2 size={15} className="shrink-0 text-emerald-500" /> : <CircleAlert size={15} className="shrink-0 text-amber-500" />}<span>{m?.enabled ? `Configurat: ${m.from_email}` : m?.revoked_at ? `Revocat el ${fdt(m.revoked_at)}` : "Encara no configurat"}</span></li>
          <li className="flex items-start gap-2">{m?.last_test_ok ? <CheckCircle2 size={15} className="shrink-0 text-emerald-500" /> : <CircleAlert size={15} className="shrink-0 text-amber-500" />}<span>{m?.last_test_at ? (m.last_test_ok ? `Connexió provada el ${fdt(m.last_test_at)}` : `Última prova fallida: ${m.last_test_error}`) : "Connexió no provada"}</span></li>
          <li className="flex items-start gap-2"><KeyRound size={15} className="shrink-0 text-muted" /><span>La credencial es desa xifrada al servidor i no es torna a mostrar mai.</span></li>
        </ul>
        <p className="mt-3 text-[11.5px] text-muted">OAuth (Google, Microsoft): {d.oauth.note}.</p>
      </Panel>
    </div>
  );
}

function WhatsappForm({ d, reload }: { d: Mine; reload: () => void }) {
  const toast = useApp((s) => s.toast);
  const w = d.whatsapp;
  const [mode, setMode] = useState<"enllac" | "cloud">(w?.mode ?? "enllac");
  const [phone, setPhone] = useState(w?.phone_e164 ?? "");
  const [name, setName] = useState(w?.display_name ?? "");
  const [num, setNum] = useState(w?.default_number_id ?? "");
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); setRes(null); try { await act("wa_save", { mode, phone: phone || null, display_name: name || null, default_number_id: mode === "cloud" ? num || null : null }); toast({ title: "WhatsApp desat", tone: "ok" }); setRes({ ok: true, text: "Desat." }); reload(); } catch (e) { setRes({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); } };
  return (
    <Panel title={<span className="flex items-center gap-1.5"><MessageCircle size={14} /> El meu WhatsApp</span>}>
      <div className="grid gap-3 md:grid-cols-2">
        {(["enllac", "cloud"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cn("rounded-2xl border p-3 text-left", mode === m ? "border-brand bg-brand/[0.05]" : "border-line")}>
            <p className="text-[13px] font-semibold">{m === "enllac" ? "A · WhatsApp o WhatsApp Business (aplicació)" : "B · WhatsApp Business Cloud API"}</p>
            <p className="mt-1 text-[12px] text-muted">{m === "enllac" ? "Des de la fitxa s'obre la conversa amb el client i el missatge preparat. El compte emissor el tria el teu mòbil o ordinador; el CRM no pot confirmar l'enviament ni llegir respostes." : "Envia des d'un número empresarial autoritzat per Direcció, amb estats d'enviament i lliurament i respostes al CRM. Fora de les 24 h només es poden enviar plantilles aprovades per Meta."}</p>
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <label className="block space-y-1"><span className="text-[11.5px] text-muted">El meu número professional</span><input className="input h-9" value={phone} placeholder="+34 600 000 000" onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="block space-y-1"><span className="text-[11.5px] text-muted">Nom que veuen els clients</span><input className="input h-9" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {mode === "cloud" && <label className="block space-y-1 sm:col-span-2"><span className="text-[11.5px] text-muted">Número empresarial autoritzat</span>
          <select className="input h-9" value={num} onChange={(e) => setNum(e.target.value)}><option value="">{d.numbers.length ? "Tria un número…" : "Direcció encara no t'ha autoritzat cap número"}</option>{d.numbers.map((n) => <option key={n.id} value={n.id}>{n.label} · {n.display_phone}</option>)}</select>
          {!d.cloudConfigured && <span className="text-[11.5px] text-amber-600">La connexió amb Meta (WHATSAPP_TOKEN) està pendent de configurar al servidor.</span>}
        </label>}
      </div>
      {res && <div className="mt-2"><Notice tone={res.ok ? "green" : "red"}>{res.text}</Notice></div>}
      <Button className="mt-3" variant="primary" onClick={() => void save()} disabled={busy}>{busy && <Loader2 size={13} className="animate-spin" />} Desa</Button>
    </Panel>
  );
}

function BusinessNumbers() {
  const [d, setD] = useState<{ numbers: { id: string; phone_number_id: string; display_phone: string; label: string; active: boolean }[]; access: { number_id: string; user_id: string }[]; people: { id: string; name: string; role: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => call<typeof d>("/api/comms?r=numbers").then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const op = async (data: unknown) => { try { setD(await act<typeof d>("wa_numbers", data)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <Panel title="Direcció · números empresarials de WhatsApp i autoritzacions">
      {err && <Notice tone="red">{err}</Notice>}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void op({ op: "add", phone_number_id: String(f.get("id")), display_phone: String(f.get("phone")), label: String(f.get("label")) }); e.currentTarget.reset(); }}>
        <input name="label" required className="input h-9 w-44" placeholder="Nom (p. ex. Comercial)" aria-label="Nom del número" />
        <input name="phone" required className="input h-9 w-40" placeholder="+34 973 …" aria-label="Telèfon" />
        <input name="id" required className="input h-9 w-48" placeholder="Phone number ID (Meta)" aria-label="Identificador del número" />
        <Button type="submit">Afegeix</Button>
      </form>
      <div className="mt-3 space-y-2">{(d?.numbers ?? []).map((n) => (
        <div key={n.id} className="rounded-xl border border-line p-2.5 text-[12.5px]">
          <div className="flex items-center gap-2"><b>{n.label}</b><span className="text-muted">{n.display_phone}</span><label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={n.active} onChange={(e) => void op({ op: "active", number_id: n.id, active: e.target.checked })} /> Actiu</label></div>
          <div className="mt-1.5 flex flex-wrap gap-3">{d!.people.map((p) => <label key={p.id} className="flex items-center gap-1"><input type="checkbox" checked={d!.access.some((a) => a.number_id === n.id && a.user_id === p.id)} onChange={(e) => void op({ op: "grant", number_id: n.id, user_id: p.id, on: e.target.checked })} />{p.name}</label>)}</div>
        </div>
      ))}{d && !d.numbers.length && <p className="text-[12.5px] text-muted">Encara no hi ha cap número empresarial. Cal donar-lo d&apos;alta a Meta (WhatsApp Business Platform) i copiar-ne el «Phone number ID».</p>}</div>
    </Panel>
  );
}
