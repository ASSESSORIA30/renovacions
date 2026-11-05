"use client";
/**
 * PORTAL DE COL·LABORADORS. Senzill i ràpid: aportar clients, seguir-ne l'estat, comissions i liquidacions, enllaç i QR.
 * Totes les dades surten de /api/portal amb la sessió del col·laborador (RLS): mai dades d'altres ni marges.
 */
import { DropArea } from "@/ui/components/DropZone";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, FileText, Handshake, Hourglass, Link2, Loader2, LogOut, Paperclip, QrCode, Send, UserPlus, Users, Wallet, Zap, BadgeCheck, CircleDollarSign, Clock, MessageSquare, Search, XCircle, Inbox, FileBarChart } from "lucide-react";
import { browserSupabase, supabaseConfigured } from "@/data/browserSupabase";

type Data = {
  partner: { name: string; company: string | null; kind: string; email: string | null; phone: string | null; city: string | null; province: string | null; status: string };
  links: { id: string; code: string; label: string | null; channel: string; active: boolean; url: string }[];
  kpis: { clients: number; leadsPending: number; inProgress: number; activated: number; commissionsEstimated: number | null; commissionsAccrued: number | null; commissionsSettled: number; paymentsPending: number; pendingToSettle: number | null; leadsTotal: number; inStudy: number; proposals: number; rejected: number; commissionsPaid: number; settlementsPending: number };
  requests: { id: string; title: string; notes: string | null; status: string; due_at: string | null; created_at: string; completed_at: string | null; mine: boolean }[];
  timeline: { at: string; text: string }[];
  leads: { id: string; name: string; created_at: string; services: string[]; channel: string | null; stage: string }[];
  documents: { id: string; original_name: string; created_at: string; status: string }[];
  settlements: { id: string; code: string; status: string; period_from: string; period_to: string; total_gross: string; approved_amount: string | null; paid_amount: string }[];
  history: { id: string; kind: string; amount: string; period: string; description: string; settled: boolean }[];
};
const eur = (v: number | string | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));
const d = (s: string) => new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("ca-ES", { day: "2-digit", month: "short", year: "numeric" });
const STAGE_TONE: Record<string, string> = { Rebut: "bg-zinc-100 text-zinc-700", "En estudi": "bg-blue-50 text-blue-700", Client: "bg-violet-50 text-violet-700", "En tramitació": "bg-amber-50 text-amber-800", "Contracte activat": "bg-emerald-50 text-emerald-800", Descartat: "bg-zinc-100 text-zinc-500" };
const SET_LABEL: Record<string, string> = { esborrany: "Esborrany", revisio: "En revisió", aprovada: "Aprovada", pagada: "Pagada" };
const SERVICES: [string, string][] = [["luz", "Llum"], ["gas", "Gas"]];
const EXTRA: [string, string][] = [["fibra_telefonia", "Fibra i telefonia"], ["assegurances", "Assegurances"], ["alarmes", "Alarmes"]];
const REQ_LABEL: Record<string, string> = { pendent: "Pendent", en_curs: "En curs", bloquejada: "En espera", feta: "Resolta", cancellada: "Cancel·lada" };
const uuid = () => globalThis.crypto.randomUUID();

export default function Portal() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"aportar" | "operacions" | "comissions" | "enllac" | "contacte" | "dades">("aportar");
  const load = useCallback(async () => {
    const r = await fetch("/api/portal", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { router.replace("/login?next=/collaboradors"); return; }
    if (!r.ok) { setErr(j.error ?? "No s'ha pogut carregar el portal"); return; }
    setData(j as Data); setErr(null);
  }, [router]);
  useEffect(() => {
    if (!supabaseConfigured) { void load(); return; }
    browserSupabase().auth.getUser().then(({ data: u }) => (u.user ? load() : router.replace("/login?next=/collaboradors")));
  }, [load, router]);
  const logout = async () => { if (supabaseConfigured) await browserSupabase().auth.signOut(); router.replace("/login"); };
  if (err) return <Shell onLogout={logout}><div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-[14px] text-red-800">{err}</div></Shell>;
  if (!data) return <Shell onLogout={logout}><div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-zinc-100" />)}</div></Shell>;
  const k = data.kpis;
  return (
    <Shell onLogout={logout} name={data.partner.company || data.partner.name} kind={data.partner.kind}>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 lg:grid-cols-6">
        <Kpi icon={<UserPlus size={15} />} label="Leads aportats" value={String(k.leadsTotal ?? k.clients)} />
        <Kpi icon={<Users size={15} />} label="Clients captats" value={String(k.clients)} />
        <Kpi icon={<Search size={15} />} label="En estudi" value={String(k.inStudy ?? 0)} hint={k.proposals ? `${k.proposals} amb proposta enviada` : undefined} />
        <Kpi icon={<Clock size={15} />} label="En tramitació" value={String(k.inProgress)} />
        <Kpi icon={<BadgeCheck size={15} />} label="Activats" value={String(k.activated)} tone="text-emerald-700" />
        <Kpi icon={<XCircle size={15} />} label="Rebutjats" value={String(k.rejected ?? 0)} muted />
      </div>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi icon={<Wallet size={15} />} label="Comissions estimades" value={eur(k.commissionsEstimated)} hint="Previsió: encara no és cap import a cobrar" muted />
        <Kpi icon={<CircleDollarSign size={15} />} label="Comissions meritades" value={eur(k.commissionsAccrued)} hint="Reconegudes, pendents de liquidar" />
        <Kpi icon={<Check size={15} />} label="Comissions cobrades" value={eur(k.commissionsPaid ?? 0)} tone="text-emerald-700" hint="Pagaments rebuts" />
        <Kpi icon={<Hourglass size={15} />} label="Liquidacions pendents" value={String(k.settlementsPending ?? 0)} tone={k.paymentsPending > 0 ? "text-amber-700" : undefined} hint={k.paymentsPending > 0 ? `${eur(k.paymentsPending)} per cobrar` : undefined} />
      </div>
      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
        {([["aportar", "Aportar client", UserPlus], ["operacions", "Les meves operacions", Zap], ["comissions", "Comissions i liquidacions", Wallet], ["enllac", "Enllaç i QR", QrCode], ["contacte", "Contactar", MessageSquare], ["dades", "Les meves dades", Handshake]] as const).map(([id, label, I]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13.5px] font-medium ${tab === id ? "bg-emerald-700 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:text-zinc-900"}`}><I size={15} />{label}</button>
        ))}
      </nav>
      {tab === "aportar" && <NewLead onDone={() => { void load(); setTab("operacions"); }} />}
      {tab === "operacions" && <Operations data={data} />}
      {tab === "comissions" && <Commissions data={data} />}
      {tab === "enllac" && <Links data={data} />}
      {tab === "contacte" && <Contact data={data} onSent={load} />}
      {tab === "dades" && <MyData data={data} onSaved={load} />}
    </Shell>
  );
}

function Shell({ children, onLogout, name, kind }: { children: React.ReactNode; onLogout: () => void; name?: string; kind?: string }) {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900 [color-scheme:light]">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <img src="/logo-assessoria30.png" alt="Assessoria 3.0" width={36} height={36} />
          <div className="min-w-0 flex-1 leading-tight"><p className="text-[14.5px] font-bold">Portal de col·laboradors</p><p className="truncate text-[12px] text-zinc-500">{name ? `${name}${kind ? ` · ${kind}` : ""}` : "Assessoria 3.0"}</p></div>
          <button onClick={onLogout} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-zinc-600 hover:bg-zinc-100"><LogOut size={15} /> Surt</button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">{children}</main>
    </div>
  );
}
function Kpi({ icon, label, value, hint, tone, muted }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: string; muted?: boolean }) {
  return <div className="rounded-2xl bg-white p-3.5 ring-1 ring-zinc-200" title={hint}><p className="flex items-center gap-1.5 text-[12px] text-zinc-500">{icon}{label}</p><p className={`mt-1 text-[21px] font-semibold tabular-nums ${tone ?? (muted ? "text-zinc-500" : "")}`}>{value}</p>{hint && <p className="text-[10.5px] text-zinc-400">{hint}</p>}</div>;
}
const card = "rounded-2xl bg-white p-4 ring-1 ring-zinc-200 sm:p-5";
const input = "mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-[14.5px] outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100";

function NewLead({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState(uuid());
  const [kind, setKind] = useState<"particular" | "empresa">("empresa");
  const [energy, setEnergy] = useState("luz");
  const [extra, setExtra] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const out = new FormData();
    for (const x of ["name", "phone", "email", "notes", "province"]) out.set(x, String(f.get(x) ?? ""));
    out.set("customerKind", kind); out.set("energyType", energy); out.set("extraServices", extra.join(",")); out.set("idempotencyKey", key); out.set("clientAuthorized", f.get("clientAuthorized") === "on" ? "true" : "false");
    if (file) out.set("factura", file, file.name);
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/portal", { method: "POST", body: out });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? "No s'ha pogut enviar" }); return; }
      setMsg({ ok: true, text: j.duplicate ? "Aquesta sol·licitud ja s'havia rebut." : "Client aportat correctament. L'equip d'Assessoria 3.0 el contactarà." });
      (e.target as HTMLFormElement).reset(); setFile(null); setKey(uuid()); setExtra([]);
      setTimeout(onDone, 1200);
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={send} className={card} aria-label="Aportar un client">
      <h2 className="text-[17px] font-semibold">Aportar un client</h2>
      <p className="text-[13px] text-zinc-500">Introdueix les dades i, si la tens, adjunta la factura. Queda registrat al teu nom automàticament.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-2">{(["empresa", "particular"] as const).map((x) => <button type="button" key={x} onClick={() => setKind(x)} aria-pressed={kind === x} className={`rounded-xl border px-3 py-2 text-[13.5px] font-medium ${kind === x ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-zinc-300 text-zinc-600"}`}>{x === "empresa" ? "Empresa" : "Particular"}</button>)}</div>
        <div className="grid grid-cols-2 gap-2">{SERVICES.map(([x, l]) => <button type="button" key={x} onClick={() => setEnergy(x)} aria-pressed={energy === x} className={`rounded-xl border px-3 py-2 text-[13.5px] font-medium ${energy === x ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-zinc-300 text-zinc-600"}`}>{l}</button>)}</div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] sm:col-span-2"><span className="text-zinc-500">També li interessa:</span>{EXTRA.map(([x, l]) => <button type="button" key={x} aria-pressed={extra.includes(x)} onClick={() => setExtra(extra.includes(x) ? extra.filter((y) => y !== x) : [...extra, x])} className={`rounded-full border px-3 py-1 font-medium ${extra.includes(x) ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-zinc-300 text-zinc-600"}`}>{l}</button>)}</div>
        <label className="text-[13px] font-medium sm:col-span-2">Nom del client<input name="name" required minLength={2} className={input} /></label>
        <label className="text-[13px] font-medium">Telèfon<input name="phone" type="tel" required className={input} /></label>
        <label className="text-[13px] font-medium">Correu<input name="email" type="email" required className={input} /></label>
        <label className="text-[13px] font-medium">Província<input name="province" className={input} /></label>
        <div className="text-[13px] font-medium">Factura <span className="font-normal text-zinc-500">(PDF, JPG, PNG o WebP)</span>
          <DropArea accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" label="Deixa anar la factura" onFiles={([f]) => setFile(f)}>
          <button type="button" onClick={() => fileRef.current?.click()} className="mt-1 flex w-full items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-3 py-2.5 text-left text-[14px] text-zinc-600 hover:border-emerald-500"><Paperclip size={15} />{file ? file.name : "Adjunta la factura o arrossega-la aquí"}</button>
          </DropArea>
          <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" aria-label="Factura" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <label className="text-[13px] font-medium sm:col-span-2">Observacions<textarea name="notes" rows={2} maxLength={1000} className={input} /></label>
        <label className="flex gap-2 text-[12.8px] text-zinc-600 sm:col-span-2"><input type="checkbox" name="clientAuthorized" required className="mt-0.5 h-4 w-4 accent-emerald-700" /> El client m&apos;ha autoritzat a facilitar les seves dades i la factura a Assessoria 3.0 i l&apos;he informat de la política de privacitat.</label>
      </div>
      {msg && <p className={`mt-3 rounded-xl px-3 py-2 text-[13.5px] ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="status">{msg.text}</p>}
      <button disabled={busy} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-[14.5px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Envia</button>
    </form>
  );
}

function Operations({ data }: { data: Data }) {
  return (
    <section className={card}>
      <h2 className="text-[17px] font-semibold">Les meves operacions</h2>
      {!data.leads.length ? <p className="mt-2 text-[14px] text-zinc-500">Encara no has aportat cap client.</p> : (
        <ul className="mt-3 divide-y divide-zinc-100">{data.leads.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5"><span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-medium">{l.name}</span><span className="text-[12px] text-zinc-500">{d(l.created_at)}{l.channel ? ` · ${l.channel}` : ""}</span></span><span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${STAGE_TONE[l.stage] ?? "bg-zinc-100"}`}>{l.stage}</span></li>
        ))}</ul>
      )}
      {(data.requests ?? []).length > 0 && <>
        <h3 className="mt-5 flex items-center gap-1.5 text-[14px] font-semibold"><Inbox size={15} /> Sol·licituds amb Assessoria 3.0</h3>
        <ul className="mt-2 divide-y divide-zinc-100">{data.requests.map((r) => <li key={r.id} className="py-2 text-[13.5px]"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{r.title}</span><span className={`rounded-full px-2 py-0.5 text-[11.5px] ${r.status === "feta" ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}>{REQ_LABEL[r.status] ?? r.status}</span></div>{r.notes && <p className="truncate text-[12.5px] text-zinc-500">{r.notes}</p>}<p className="text-[11.5px] text-zinc-400">{d(r.created_at)}{r.mine ? " · enviada per tu" : " · de l'equip d'Assessoria 3.0"}</p></li>)}</ul>
      </>}
      {(data.timeline ?? []).length > 0 && <>
        <h3 className="mt-5 text-[14px] font-semibold">Historial d&apos;operacions</h3>
        <ol className="mt-2 space-y-1.5 border-l border-zinc-200 pl-3">{data.timeline.slice(0, 20).map((t, i) => <li key={i} className="text-[13px]"><span className="text-zinc-400">{d(t.at)}</span> · {t.text}</li>)}</ol>
      </>}
      <a href="/api/reports?kind=mensual" className="mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-emerald-700 hover:underline"><FileBarChart size={15} /> Descarrega el resum de les meves operacions (PDF)</a>
      {data.documents.length > 0 && <>
        <h3 className="mt-5 text-[14px] font-semibold">Factures aportades</h3>
        <ul className="mt-2 space-y-1.5">{data.documents.map((x) => <li key={x.id}><a href={`/api/capture?r=doc&id=${x.id}`} onClick={async (e) => { e.preventDefault(); const r = await fetch(`/api/capture?r=doc&id=${x.id}`); const j = await r.json(); if (j.url) window.open(j.url, "_blank", "noopener"); }} className="flex items-center gap-2 text-[13.5px] text-zinc-700 hover:text-emerald-700"><FileText size={14} />{x.original_name} <span className="text-zinc-400">· {d(x.created_at)}</span></a></li>)}</ul>
      </>}
    </section>
  );
}

function Commissions({ data }: { data: Data }) {
  const k = data.kpis;
  return (
    <section className={card}>
      <h2 className="text-[17px] font-semibold">Comissions i liquidacions</h2>
      <p className="text-[13px] text-zinc-500">Estimades = previsió; meritades = reconegudes; liquidades = incloses en una liquidació aprovada. {k.pendingToSettle != null ? `Pendent d'incloure en una liquidació: ${eur(k.pendingToSettle)}.` : ""}</p>
      {!data.settlements.length ? <p className="mt-3 text-[14px] text-zinc-500">Encara no tens cap liquidació.</p> : (
        <div className="mt-3 overflow-x-auto"><table className="w-full text-[13.5px]"><thead className="text-left text-[11.5px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2 pr-3 font-medium">Liquidació</th><th className="pr-3 font-medium">Període</th><th className="pr-3 font-medium">Estat</th><th className="pr-3 text-right font-medium">Import</th><th className="pr-3 text-right font-medium">Pagat</th><th /></tr></thead>
          <tbody className="divide-y divide-zinc-100">{data.settlements.map((s) => <tr key={s.id}><td className="py-2 pr-3 font-mono text-[12.5px]">{s.code}</td><td className="pr-3">{d(s.period_from)} – {d(s.period_to)}</td><td className="pr-3">{SET_LABEL[s.status] ?? s.status}</td><td className="pr-3 text-right tabular-nums">{eur(s.approved_amount ?? s.total_gross)}</td><td className="pr-3 text-right tabular-nums">{eur(s.paid_amount)}</td><td>{["aprovada", "pagada"].includes(s.status) && <a href={`/api/finance?r=pdf&id=${s.id}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><Download size={13} /> PDF</a>}</td></tr>)}</tbody></table></div>
      )}
      {data.history.length > 0 && <><h3 className="mt-5 text-[14px] font-semibold">Històric</h3><ul className="mt-2 divide-y divide-zinc-100">{data.history.map((h) => <li key={h.id} className="flex items-center gap-2 py-2 text-[13px]"><span className="w-20 shrink-0 text-zinc-500">{h.period}</span><span className="min-w-0 flex-1 truncate">{h.description}</span><span className="tabular-nums">{eur(h.amount)}</span><span className="w-20 text-right text-[11.5px] text-zinc-500">{h.settled ? "Liquidat" : "Pendent"}</span></li>)}</ul></>}
    </section>
  );
}

function Links({ data }: { data: Data }) {
  const [copied, setCopied] = useState<string | null>(null);
  const abs = (u: string) => (u.startsWith("http") ? u : `${location.origin}${u}`);
  return (
    <section className={card}>
      <h2 className="text-[17px] font-semibold">El teu enllaç i el codi QR</h2>
      <p className="text-[13px] text-zinc-500">Comparteix-lo: les sol·licituds que arribin per aquí quedaran registrades al teu nom. El codi no dona accés a cap dada.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{data.links.filter((l) => l.active).map((l) => (
        <div key={l.id} className="rounded-2xl border border-zinc-200 p-4">
          <p className="text-[12px] text-zinc-500">{l.label ?? "Enllaç"} · codi <b className="font-mono text-zinc-800">{l.code}</b></p>
          <div className="mt-2 flex items-center gap-2"><Link2 size={14} className="shrink-0 text-emerald-700" /><span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{abs(l.url)}</span><button onClick={async () => { await navigator.clipboard.writeText(abs(l.url)).catch(() => undefined); setCopied(l.id); setTimeout(() => setCopied(null), 1500); }} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] text-emerald-700 hover:bg-emerald-50">{copied === l.id ? <Check size={13} /> : <Copy size={13} />}{copied === l.id ? "Copiat" : "Copia"}</button></div>
          <img src={`/api/capture/qr?code=${l.code}&format=svg`} alt={`QR del codi ${l.code}`} className="mx-auto mt-3 h-44 w-44" />
          <div className="mt-2 flex justify-center gap-3 text-[13px]"><a href={`/api/capture/qr?code=${l.code}&format=png`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><Download size={13} /> PNG</a><a href={`/api/capture/qr?code=${l.code}&format=svg`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><Download size={13} /> SVG</a></div>
        </div>
      ))}</div>
    </section>
  );
}

function Contact({ data, onSent }: { data: Data; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setMsg(null);
    const r = await fetch("/api/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "message", data: { subject: String(f.get("subject") ?? ""), message: String(f.get("message") ?? "") } }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Missatge enviat. L'equip d'Assessoria 3.0 et respondrà aviat." } : { ok: false, text: j.error ?? "No s'ha pogut enviar" });
    if (r.ok) { form.reset(); onSent(); }
  };
  return (
    <form onSubmit={send} className={card} aria-label="Contactar amb Assessoria 3.0">
      <h2 className="text-[17px] font-semibold">Contactar amb Assessoria 3.0</h2>
      <p className="text-[13px] text-zinc-500">Consultes sobre un client, una liquidació o el portal. El missatge arriba directament a l&apos;equip d&apos;administració i en pots seguir l&apos;estat a «Les meves operacions».</p>
      <div className="mt-3 grid gap-3">
        <label className="text-[13px] font-medium">Assumpte<input name="subject" required minLength={3} maxLength={120} className={input} /></label>
        <label className="text-[13px] font-medium">Missatge<textarea name="message" required minLength={5} maxLength={2000} rows={4} className={input} /></label>
      </div>
      {msg && <p className={`mt-3 rounded-xl px-3 py-2 text-[13.5px] ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="status">{msg.text}</p>}
      <button disabled={busy} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-[14.5px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Envia el missatge</button>
      <p className="mt-3 text-[12px] text-zinc-500">{data.partner.email ? `Et respondrem a ${data.partner.email}.` : "Afegeix el teu correu a «Les meves dades» per rebre resposta."}</p>
    </form>
  );
}

function MyData({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const p = data.partner;
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const r = await fetch("/api/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "contact", data: { phone: String(f.get("phone") ?? "") || null, email: String(f.get("email") ?? "") || null, city: String(f.get("city") ?? "") || null, province: String(f.get("province") ?? "") || null } }) });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    setOk(r.ok ? "Dades desades" : j.error ?? "No s'han pogut desar");
    if (r.ok) onSaved();
  };
  return (
    <form onSubmit={save} className={card}>
      <h2 className="text-[17px] font-semibold">Les meves dades de contacte</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-[13px] font-medium">Telèfon<input name="phone" defaultValue={p.phone ?? ""} className={input} /></label>
        <label className="text-[13px] font-medium">Correu<input name="email" type="email" defaultValue={p.email ?? ""} className={input} /></label>
        <label className="text-[13px] font-medium">Població<input name="city" defaultValue={p.city ?? ""} className={input} /></label>
        <label className="text-[13px] font-medium">Província<input name="province" defaultValue={p.province ?? ""} className={input} /></label>
      </div>
      <p className="mt-2 text-[12px] text-zinc-500">Les dades fiscals i les condicions de col·laboració les gestiona Assessoria 3.0.</p>
      {ok && <p className="mt-2 text-[13px] text-emerald-700">{ok}</p>}
      <button disabled={busy} className="mt-3 rounded-xl bg-emerald-700 px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-60">Desa</button>
    </form>
  );
}
