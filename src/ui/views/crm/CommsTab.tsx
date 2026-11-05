"use client";
/**
 * Fase 8 · Comunicacions de la fitxa del client:
 * - SOL·LICITAR RESSENYA (Google) i SOL·LICITAR AUTORITZACIÓ DE DADES (fdigital.es), en català o castellà.
 * - Correu des del compte personal de l'usuari, WhatsApp per enllaç o per Cloud API (número autoritzat).
 * - Historial de comunicacions i de sol·licituds. Res es marca com a enviat sense confirmació.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Mail, MessageCircle, Send, ShieldCheck, Star } from "lucide-react";
import { DATA_MESSAGE, DATA_STATUS_LABEL, DATA_URL, EMAIL_BODY, LEGAL_BASIS_LABEL, REVIEW_MESSAGE, REVIEW_URL, SUBJECT, mailtoLink, waDigits, waLink, type Lang } from "@/core/messages";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, cn } from "../../components/ui";
import { fmtDateTime } from "@/core/dates";

type Req = { id: string; kind: "ressenya" | "proteccio_dades"; language: Lang; channel: string; status: string; delivery: string | null; legal_basis: string | null; recipient: string | null; requested_at: string; requested_by_name: string | null; confirmed_at: string | null; evidence_document_id: string | null; note: string | null; expires_at: string | null };
type Comms = {
  client: { id: string; name: string; email: string | null; phone: string | null; contact_preference: string | null; commercial_opt_out: boolean };
  requests: Req[]; history: { id: string; type: string; title: string; body: string | null; at: string; delivery: string | null; user_name: string | null }[];
  review: { last: string | null; status: string | null }; dataProtection: { status: string; at: string | null };
  sender: { mail: { from: string; tested: boolean | null } | null; whatsapp: { mode: string; phone_e164: string | null; default_number_id: string | null } | null; cloudConfigured: boolean } | null;
};
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
}
const act = <T,>(action: string, data: unknown, id?: string) => call<T>("/api/comms", { method: "POST", body: JSON.stringify({ action, data, id }) });
export const loadComms = (id: string) => call<Comms>(`/api/comms?r=client&id=${id}`);
const DELIVERY: Record<string, string> = { intent: "aplicació oberta", registrat: "enviament confirmat per l'usuari", enviat: "acceptat pel proveïdor", error: "error" };

export function CommsButtons({ clientId, canEdit, onChange }: { clientId: string; canEdit: boolean; onChange?: () => void }) {
  const [open, setOpen] = useState<null | "ressenya" | "proteccio_dades">(null);
  if (!canEdit) return null;
  return (
    <>
      <Button onClick={() => setOpen("ressenya")} className="border-amber-300/70 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-200"><Star size={14} /> Sol·licitar ressenya</Button>
      <Button onClick={() => setOpen("proteccio_dades")} className="border-sky-300/70 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-200"><ShieldCheck size={14} /> Sol·licitar autorització de dades</Button>
      {open && <RequestModal kind={open} clientId={clientId} onClose={() => { setOpen(null); onChange?.(); }} />}
    </>
  );
}

function RequestModal({ kind, clientId, onClose }: { kind: "ressenya" | "proteccio_dades"; clientId: string; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const [d, setD] = useState<Comms | null>(null);
  const [lang, setLang] = useState<Lang>("ca");
  const [msg, setMsg] = useState(kind === "ressenya" ? REVIEW_MESSAGE.ca : DATA_MESSAGE.ca);
  const [edited, setEdited] = useState(false);
  const [basis, setBasis] = useState("consentiment");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);   // sol·licitud oberta per WhatsApp pendent de confirmar
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { loadComms(clientId).then(setD).catch((e) => setErr(e.message)); }, [clientId]);
  const switchLang = (l: Lang) => { setLang(l); if (!edited || confirm("Vols substituir el text editat pel missatge en l'altre idioma?")) { setMsg(kind === "ressenya" ? REVIEW_MESSAGE[l] : DATA_MESSAGE[l]); setEdited(false); } };
  const register = async (channel: string, extra: Record<string, unknown> = {}) => act<{ id: string; status: string }>("request", { clientId, kind, language: lang, channel, message: msg, legal_basis: kind === "proteccio_dades" ? basis : null, ...extra });
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } };
  const c = d?.client;
  const phone = c?.phone && waDigits(c.phone) ? c.phone : null;
  const url = kind === "ressenya" ? REVIEW_URL : DATA_URL;
  const title = kind === "ressenya" ? "Sol·licitar ressenya a Google" : "Sol·licitar autorització de dades";
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2">{kind === "ressenya" ? <Star size={16} className="text-amber-500" /> : <ShieldCheck size={16} className="text-sky-600" />}{title}</span>} width="max-w-2xl">
      {!d ? (err ? <Notice tone="red">{err}</Notice> : <Loader2 className="mx-auto animate-spin text-muted" />) : (
        <div className="space-y-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Idioma:</span>
            {(["ca", "es"] as const).map((l) => <button key={l} aria-pressed={lang === l} onClick={() => switchLang(l)} className={cn("rounded-lg border px-3 py-1 font-medium", lang === l ? "border-brand bg-brand/10 text-brand" : "border-line text-muted")}>{l === "ca" ? "Català" : "Castellano"}</button>)}
            <span className="ml-auto text-[12px] text-muted">{kind === "ressenya" ? (d.review.last ? `Última sol·licitud: ${fmtDateTime(d.review.last)}` : "Encara no se n'ha demanat cap") : `Estat actual: ${DATA_STATUS_LABEL[d.dataProtection.status] ?? d.dataProtection.status}`}</span>
          </div>
          {d.client.contact_preference === "cap" && <Notice tone="red">El client ha demanat no ser contactat.</Notice>}
          {kind === "ressenya" && d.client.commercial_opt_out && <Notice tone="amber">El client s&apos;ha donat de baixa de les comunicacions comercials: no s&apos;hi pot enviar la petició de ressenya.</Notice>}
          {kind === "proteccio_dades" && (
            <label className="block space-y-1"><span className="text-[11.5px] text-muted">Base jurídica del tractament (no tots els tractaments requereixen consentiment)</span>
              <select className="input h-9" value={basis} onChange={(e) => setBasis(e.target.value)}>{Object.entries(LEGAL_BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
          )}
          <textarea aria-label="Missatge" className="input min-h-[220px] font-[inherit] text-[13px] leading-relaxed" value={msg} onChange={(e) => { setMsg(e.target.value); setEdited(true); }} />
          {err && <Notice tone="red">{err}</Notice>}
          {done && <Notice tone="green">{done}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run("copy", async () => { await navigator.clipboard.writeText(msg); await register("copiat"); setDone("Missatge copiat i sol·licitud registrada."); })} disabled={!!busy}>{busy === "copy" ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />} Copia el missatge</Button>
            {phone && <Button onClick={() => run("wa", async () => {
              // la finestra s'obre dins del clic (si no, Safari i alguns navegadors la bloquegen) i es dirigeix a WhatsApp quan el registre s'ha desat
              const w = window.open("", "_blank");
              if (w) w.opener = null;
              let r: { id: string };
              try { r = await register("whatsapp", { recipient: phone }); } catch (e) { w?.close(); throw e; }
              if (w) w.location.href = waLink(phone, msg); else window.open(waLink(phone, msg), "_blank", "noopener");
              setPending(r.id); setDone("S'ha obert WhatsApp amb el missatge preparat. Quan l'hagis enviat, confirma-ho."); })} disabled={!!busy}><MessageCircle size={13} /> Obre WhatsApp</Button>}
            {phone && d.sender?.whatsapp?.mode === "cloud" && <Button onClick={() => run("cloud", async () => { await act("send_whatsapp", { clientId, to: phone, body: msg, kind, language: lang }); setDone("Missatge acceptat per WhatsApp Business (pendent de lliurament)."); toast({ title: "WhatsApp acceptat", tone: "ok" }); })} disabled={!!busy}><Send size={13} /> Envia per WhatsApp Business</Button>}
            {c?.email && (d.sender?.mail
              ? <Button variant="primary" onClick={() => run("mail", async () => { const r = await act<{ from: string }>("send_email", { clientId, to: c.email, subject: SUBJECT[kind][lang], body: msg, kind, language: lang, legal_basis: kind === "proteccio_dades" ? basis : null }); setDone(`Correu acceptat pel servidor (remitent ${r.from}).`); toast({ title: "Correu enviat", tone: "ok" }); })} disabled={!!busy}>{busy === "mail" ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Envia per correu</Button>
              : <a className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3" href={mailtoLink(c.email, SUBJECT[kind][lang], msg)} onClick={() => void register("email", { recipient: c.email })}><Mail size={13} /> Prepara el correu</a>)}
            <a className="pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> {kind === "ressenya" ? "Obre Google Reviews" : "Obre el formulari"}</a>
          </div>
          {pending && kind === "ressenya" && <Button size="sm" onClick={() => run("confirm", async () => { await act("request_confirm", null, pending); setPending(null); setDone("Enviament confirmat i registrat."); })}><Check size={13} /> L&apos;he enviat</Button>}
          <p className="text-[11.5px] text-muted">
            Remitent: {d.sender?.mail ? d.sender.mail.from : "sense correu propi configurat (s'obrirà la teva aplicació de correu)"} · WhatsApp: {d.sender?.whatsapp?.mode === "cloud" ? "número empresarial autoritzat" : "enllaç (obre la conversa amb el client; el compte emissor el tria el teu dispositiu)"}.
            {kind === "ressenya" ? " El CRM no pot saber si el client publica la ressenya: només es registra la sol·licitud." : " Obrir l'enllaç no marca l'autorització com a signada: la confirmació es registra a la pestanya Comunicacions, amb evidència."}
          </p>
        </div>
      )}
    </Modal>
  );
}

export function CommsTab({ clientId, canEdit, documents, onChange }: { clientId: string; canEdit: boolean; documents: { id: string; title: string; category: string; status: string }[]; onChange: () => void }) {
  const toast = useApp((s) => s.toast);
  const [d, setD] = useState<Comms | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [compose, setCompose] = useState<null | "proposta" | "documentacio" | "recordatori">(null);
  const [upd, setUpd] = useState<Req | null>(null);
  const load = useCallback(() => loadComms(clientId).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), [clientId]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <Notice tone={/015/.test(err) ? "amber" : "red"}>{err}</Notice>;
  if (!d) return <div className="h-40 animate-pulse rounded-2xl bg-elevated" />;
  const data = d.requests.filter((r) => r.kind === "proteccio_dades");
  const reviews = d.requests.filter((r) => r.kind === "ressenya");
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
        <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="text-[13.5px] font-semibold">Historial de comunicacions</h3>
          {canEdit && <div className="ml-auto flex flex-wrap gap-1.5">{(["proposta", "documentacio", "recordatori"] as const).map((k) => <Button key={k} size="sm" onClick={() => setCompose(k)}><Mail size={12} /> {k === "proposta" ? "Envia proposta" : k === "documentacio" ? "Demana documentació" : "Recordatori"}</Button>)}</div>}
        </div>
        {!d.history.length ? <p className="py-6 text-center text-[12.5px] text-muted">Encara no hi ha cap correu ni WhatsApp registrat.</p> : (
          <ul className="divide-y divide-line">{d.history.map((h) => <li key={h.id} className="py-2 text-[12.5px]"><div className="flex items-center gap-2">{h.type === "email" ? <Mail size={13} className="text-muted" /> : <MessageCircle size={13} className="text-muted" />}<span className="min-w-0 flex-1 truncate font-medium">{h.title}</span>{h.delivery && <Badge tone={h.delivery === "enviat" ? "green" : h.delivery === "error" ? "red" : "zinc"}>{DELIVERY[h.delivery] ?? h.delivery}</Badge>}</div><p className="text-[11.5px] text-muted">{fmtDateTime(h.at)}{h.user_name ? ` · ${h.user_name}` : ""}</p></li>)}</ul>
        )}
      </section>
      <div className="space-y-3">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-1 flex items-center gap-1.5 text-[13.5px] font-semibold"><ShieldCheck size={14} className="text-sky-600" /> Protecció de dades</h3>
          <p className="text-[12.5px]">Estat: <b>{DATA_STATUS_LABEL[d.dataProtection.status] ?? d.dataProtection.status}</b>{d.dataProtection.at ? <span className="text-muted"> · {fmtDateTime(d.dataProtection.at)}</span> : null}</p>
          <ul className="mt-2 space-y-1.5">{data.map((r) => <li key={r.id} className="rounded-lg border border-line px-2.5 py-1.5 text-[12px]"><div className="flex items-center justify-between gap-2"><span>{DATA_STATUS_LABEL[r.status]} · {r.language === "ca" ? "CA" : "ES"} · {r.channel}</span>{canEdit && <button className="text-brand hover:underline" onClick={() => setUpd(r)}>Actualitza</button>}</div><p className="text-[11px] text-muted">{fmtDateTime(r.requested_at)} · {r.requested_by_name}{r.legal_basis ? ` · ${LEGAL_BASIS_LABEL[r.legal_basis]?.split(" (")[0]}` : ""}{r.evidence_document_id ? " · amb evidència" : ""}</p></li>)}</ul>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-1 flex items-center gap-1.5 text-[13.5px] font-semibold"><Star size={14} className="text-amber-500" /> Ressenyes sol·licitades</h3>
          <p className="text-[12.5px]">Última: {d.review.last ? fmtDateTime(d.review.last) : "cap"}</p>
          <ul className="mt-2 space-y-1">{reviews.slice(0, 6).map((r) => <li key={r.id} className="text-[11.5px] text-muted">{fmtDateTime(r.requested_at)} · {r.channel} · {r.status === "enviada" ? "enviada" : "preparada"}{r.delivery ? ` (${DELIVERY[r.delivery] ?? r.delivery})` : ""} · {r.requested_by_name}</li>)}</ul>
        </section>
      </div>
      {compose && d.client.email && <Compose kind={compose} clientId={clientId} to={d.client.email} name={d.client.name} hasMail={!!d.sender?.mail} from={d.sender?.mail?.from ?? null} onClose={() => { setCompose(null); void load(); }} />}
      {compose && !d.client.email && <Modal open onClose={() => setCompose(null)} title="Sense correu"><Notice tone="amber">Aquest client no té correu electrònic. Afegeix-lo a la fitxa.</Notice></Modal>}
      {upd && <UpdateData req={upd} documents={documents} onClose={() => { setUpd(null); void load(); onChange(); }} onSaved={() => toast({ title: "Estat desat", tone: "ok" })} />}
    </div>
  );
}

function Compose({ kind, clientId, to, name, hasMail, from, onClose }: { kind: "proposta" | "documentacio" | "recordatori"; clientId: string; to: string; name: string; hasMail: boolean; from: string | null; onClose: () => void }) {
  const [lang, setLang] = useState<Lang>("ca");
  const [subject, setSubject] = useState(SUBJECT[kind].ca);
  const [body, setBody] = useState(EMAIL_BODY[kind].ca(name));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => { setBusy(true); setErr(null); try { await act("send_email", { clientId, to, subject, body, kind, language: lang }); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title="Correu al client" width="max-w-xl">
      <div className="space-y-2 text-[13px]">
        <div className="flex gap-2">{(["ca", "es"] as const).map((l) => <button key={l} onClick={() => { setLang(l); setSubject(SUBJECT[kind][l]); setBody(EMAIL_BODY[kind][l](name)); }} className={cn("rounded-lg border px-3 py-1", lang === l ? "border-brand bg-brand/10 text-brand" : "border-line text-muted")}>{l === "ca" ? "Català" : "Castellano"}</button>)}</div>
        <p className="text-[12px] text-muted">De: <b>{from ?? "—"}</b> · Per a: <b>{to}</b></p>
        <input className="input" aria-label="Assumpte" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="input min-h-[200px]" aria-label="Cos del correu" value={body} onChange={(e) => setBody(e.target.value)} />
        {err && <Notice tone="red">{err}</Notice>}
        {!hasMail ? <Notice tone="amber">Configura el teu correu a «El meu perfil → Comunicacions» per enviar-lo des del CRM. Mentrestant pots <a className="underline" href={mailtoLink(to, subject, body)}>obrir-lo a la teva aplicació de correu</a>.</Notice>
          : <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" onClick={() => void send()} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Envia</Button></div>}
      </div>
    </Modal>
  );
}

function UpdateData({ req, documents, onClose, onSaved }: { req: Req; documents: { id: string; title: string; category: string; status: string }[]; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(req.status === "pendent" ? "sollicitada" : req.status);
  const [doc, setDoc] = useState(req.evidence_document_id ?? "");
  const [note, setNote] = useState(req.note ?? "");
  const [basis, setBasis] = useState(req.legal_basis ?? "consentiment");
  const [exp, setExp] = useState(req.expires_at ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const docs = documents.filter((d) => d.status === "actiu");
  const save = async () => { setBusy(true); setErr(null); try { await act("request_update", { status, evidence_document_id: doc || null, note: note || undefined, legal_basis: basis, expires_at: exp || null }, req.id); onSaved(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title="Autorització de dades · estat">
      <div className="space-y-2.5 text-[13px]">
        <label className="block space-y-1"><span className="text-[11.5px] text-muted">Estat</span><select className="input h-9" value={status} onChange={(e) => setStatus(e.target.value)}>{["sollicitada", "formulari_enviat", "completada", "rebutjada", "caducada"].map((s) => <option key={s} value={s}>{DATA_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="block space-y-1"><span className="text-[11.5px] text-muted">Base jurídica</span><select className="input h-9" value={basis} onChange={(e) => setBasis(e.target.value)}>{Object.entries(LEGAL_BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block space-y-1"><span className="text-[11.5px] text-muted">Evidència (document del client; puja-la a Documents amb la categoria «Protecció de dades»)</span><select className="input h-9" value={doc} onChange={(e) => setDoc(e.target.value)}><option value="">Sense evidència</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.title}{d.category === "proteccio_dades" ? " · protecció de dades" : ""}</option>)}</select></label>
        <label className="block space-y-1"><span className="text-[11.5px] text-muted">Com s&apos;ha confirmat (obligatori si no hi ha evidència)</span><textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="block space-y-1"><span className="text-[11.5px] text-muted">Caduca el (si aplica)</span><input type="date" className="input h-9" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
        {err && <Notice tone="red">{err}</Notice>}
        <p className="text-[11.5px] text-muted">fdigital.es no ofereix cap API ni webhook públic documentat: la confirmació es registra manualment amb evidència i queda auditada.</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" onClick={() => void save()} disabled={busy}>{busy && <Loader2 size={13} className="animate-spin" />} Desa</Button></div>
      </div>
    </Modal>
  );
}
