"use client";
/** Formulari de la landing: dades bàsiques, factura (fitxer o càmera), privacitat i consentiments separats. */
import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, FileText, Loader2, Lock, Paperclip, X } from "lucide-react";
import { CONSENT_TEXTS, MAX_UPLOAD_BYTES } from "@/core/capture";

type Errs = Record<string, string>;
const uuid = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const b = (globalThis.crypto as Crypto).getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const [PRIV_A, PRIV_B] = CONSENT_TEXTS.privacitat_servei.split("informació de privacitat");
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

function session(): string {
  try {
    let s = sessionStorage.getItem("a30:s");
    if (!s) { s = uuid(); sessionStorage.setItem("a30:s", s); }
    return s;
  } catch { return uuid(); }
}
function urlInfo() {
  const q = new URLSearchParams(location.search);
  const utm = Object.fromEntries(["source", "medium", "campaign", "content", "term"].map((k) => [k, q.get(`utm_${k}`)]).filter(([, v]) => v));
  return { utm, gclid: q.get("gclid") ?? "", fbclid: q.get("fbclid") ?? "" };
}
const track = (event: string, extra: Record<string, unknown> = {}) => {
  try { void fetch("/api/capture/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event, session: session(), path: location.pathname, ...extra }), keepalive: true }); } catch { /* sense mètriques */ }
};

export function LandingForm({ refCode }: { refCode: string }) {
  const [key, setKey] = useState("");
  const [started, setStarted] = useState<number | null>(null);
  const [kind, setKind] = useState<"particular" | "empresa">("particular");
  const [energy, setEnergy] = useState<"luz" | "gas">("luz");
  const [file, setFile] = useState<File | null>(null);
  const [errs, setErrs] = useState<Errs>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setKey(uuid()); const { utm } = urlInfo(); track("visita", { ref: refCode || undefined, utm }); }, [refCode]);
  const touch = () => { if (!started) { setStarted(Date.now()); track("formulari_iniciat"); } };
  const pick = (f: File | null | undefined) => {
    touch();
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) { setErrs((e) => ({ ...e, file: "El fitxer supera els 10 MB" })); return; }
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(f.type) && !/\.(pdf|jpe?g|png|webp)$/i.test(f.name)) { setErrs((e) => ({ ...e, file: "Format no admès: PDF, JPG, PNG o WebP" })); return; }
    setErrs((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "file"))); setFile(f);
  };
  const send = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    const local: Errs = {};
    if (String(fd.get("name") ?? "").trim().length < 2) local.name = "Indica el teu nom";
    if (String(fd.get("phone") ?? "").replace(/\D/g, "").length < 9) local.phone = "Telèfon no vàlid";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(fd.get("email") ?? "").trim())) local.email = "Correu no vàlid";
    if (fd.get("acceptPrivacy") !== "on") local.acceptPrivacy = "Cal acceptar la informació de privacitat per poder estudiar la factura";
    if (Object.keys(local).length) { setErrs(local); return; }
    const { utm, gclid, fbclid } = urlInfo();
    const out = new FormData();
    for (const k of ["name", "phone", "email", "notes", "province", "website"]) out.set(k, String(fd.get(k) ?? ""));
    out.set("customerKind", kind); out.set("energyType", energy); out.set("idempotencyKey", key); out.set("ref", refCode);
    out.set("acceptPrivacy", "true"); out.set("acceptCommercial", fd.get("acceptCommercial") === "on" ? "true" : "false"); out.set("acceptWhatsapp", fd.get("acceptWhatsapp") === "on" ? "true" : "false");
    out.set("utm", JSON.stringify(utm)); out.set("gclid", gclid); out.set("fbclid", fbclid); out.set("startedAt", String(started ?? Date.now() - 60_000));
    if (file) out.set("factura", file, file.name);
    setBusy(true); setErrs({});
    try {
      const r = await fetch("/api/capture/submit", { method: "POST", body: out });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; reference?: string; error?: string; fieldErrors?: Errs };
      if (!r.ok || !j.ok) { setErrs({ ...(j.fieldErrors ?? {}), form: j.error ?? "No s'ha pogut enviar" }); return; }
      track("formulari_enviat");
      setDone(j.reference ?? "");
      form.reset(); setFile(null); setKey(uuid());
    } catch { setErrs({ form: "No hi ha connexió. Torna-ho a provar." }); }
    finally { setBusy(false); }
  };
  if (done !== null) {
    return (
      <div className="rounded-[28px] border border-emerald-200 bg-white p-7 shadow-xl shadow-emerald-900/5" role="status">
        <CheckCircle2 size={40} className="text-emerald-600" />
        <h2 className="mt-4 text-[22px] font-bold">Hem rebut la teva sol·licitud</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">Gràcies. Una persona de l&apos;equip revisarà la factura i et trucarà o t&apos;escriurà aviat amb el resultat. Si necessites res, truca&apos;ns.</p>
        {done && <p className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-[13.5px] text-zinc-600">Referència de la sol·licitud: <b className="font-mono text-zinc-900">{done}</b></p>}
        <button onClick={() => setDone(null)} className="mt-5 text-[14px] font-medium text-emerald-700 hover:underline">Enviar una altra factura</button>
      </div>
    );
  }
  const err = (k: string) => errs[k] ? <p className="mt-1 text-[12.5px] text-red-600" id={`${k}-err`}>{errs[k]}</p> : null;
  const input = "mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-3 text-[15px] outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100";
  return (
    <form onSubmit={send} onFocus={touch} noValidate className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-xl shadow-emerald-900/5 sm:p-7" aria-label="Formulari d'estudi de factura">
      <h2 className="text-[21px] font-bold tracking-tight">Estudi gratuït de la teva factura</h2>
      <p className="mt-1 text-[13.5px] text-zinc-500">Menys d&apos;un minut. Et contactem nosaltres.</p>
      <div className="mt-5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipus de client">
        {(["particular", "empresa"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { touch(); setKind(k); }} className={`rounded-xl border px-3 py-2.5 text-[14px] font-medium transition ${kind === k ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-zinc-300 text-zinc-600"}`}>{k === "particular" ? "Particular" : "Empresa o autònom"}</button>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Subministrament">
        {(["luz", "gas"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={energy === k} onClick={() => { touch(); setEnergy(k); }} className={`rounded-xl border px-3 py-2.5 text-[14px] font-medium transition ${energy === k ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-zinc-300 text-zinc-600"}`}>{k === "luz" ? "Llum" : "Gas"}</button>)}
      </div>
      <label className="mt-4 block text-[13.5px] font-medium">Nom i cognoms{kind === "empresa" ? " o empresa" : ""}<input name="name" autoComplete="name" className={input} aria-invalid={!!errs.name} aria-describedby={errs.name ? "name-err" : undefined} /></label>{err("name")}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><label className="block text-[13.5px] font-medium">Telèfon<input name="phone" type="tel" inputMode="tel" autoComplete="tel" className={input} aria-invalid={!!errs.phone} /></label>{err("phone")}</div>
        <div><label className="block text-[13.5px] font-medium">Correu electrònic<input name="email" type="email" inputMode="email" autoComplete="email" className={input} aria-invalid={!!errs.email} /></label>{err("email")}</div>
      </div>
      {/* camp parany antispam: invisible per a persones */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"><label>Web<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <div
        className={`mt-4 rounded-2xl border-2 border-dashed p-4 text-center transition ${drag ? "border-emerald-500 bg-emerald-50" : file ? "border-emerald-300 bg-emerald-50/50" : "border-zinc-300"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
      >
        {file ? (
          <div className="flex items-center gap-3 text-left"><FileText size={22} className="shrink-0 text-emerald-700" /><span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{file.name}</span><span className="text-[12px] text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB</span></span><button type="button" aria-label="Treu la factura" onClick={() => setFile(null)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100"><X size={16} /></button></div>
        ) : (
          <>
            <p className="text-[14px] font-medium">Adjunta la factura <span className="font-normal text-zinc-500">(recomanat)</span></p>
            <p className="mt-0.5 text-[12px] text-zinc-500">PDF, JPG, PNG o WebP · màxim 10 MB</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-2 text-[13.5px] font-medium text-white"><Paperclip size={15} /> Tria un fitxer</button>
              <button type="button" onClick={() => camRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3.5 py-2 text-[13.5px] font-medium sm:hidden"><Camera size={15} /> Fes una foto</button>
            </div>
          </>
        )}
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" aria-label="Fitxer de la factura" onChange={(e) => pick(e.target.files?.[0])} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Foto de la factura" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {err("file")}
      <label className="mt-3 block text-[13.5px] font-medium">Comentaris <span className="font-normal text-zinc-500">(opcional)</span><textarea name="notes" rows={2} maxLength={1000} className={`${input} resize-none`} /></label>
      <div className="mt-4 space-y-2.5 text-[12.8px] leading-snug text-zinc-600">
        <label className="flex gap-2.5"><input type="checkbox" name="acceptPrivacy" className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700" aria-invalid={!!errs.acceptPrivacy} /><span>{PRIV_A}<a href="/privacitat" target="_blank" className="font-medium text-emerald-700 underline">informació de privacitat</a>{PRIV_B} <span className="text-red-600">*</span></span></label>
        {err("acceptPrivacy")}
        <label className="flex gap-2.5"><input type="checkbox" name="acceptWhatsapp" className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700" /><span>{CONSENT_TEXTS.whatsapp} <span className="text-zinc-400">(opcional)</span></span></label>
        <label className="flex gap-2.5"><input type="checkbox" name="acceptCommercial" className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700" /><span>{CONSENT_TEXTS.comercial}</span></label>
      </div>
      {errs.form && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700" role="alert">{errs.form}</p>}
      <button type="submit" disabled={busy || !key} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-3.5 text-[16px] font-semibold text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-800 disabled:opacity-60">{busy ? <><Loader2 size={18} className="animate-spin" /> Enviant…</> : "Vull que estudieu la meva factura"}</button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-zinc-500"><Lock size={12} /> Connexió xifrada · la factura es desa de manera privada</p>
    </form>
  );
}
