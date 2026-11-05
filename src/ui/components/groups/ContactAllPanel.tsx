"use client";
/**
 * «CONTACTAR TOTS»: una sola comunicació (WhatsApp o correu) a una persona de contacte sobre diversos contractes.
 * - Reutilitza les plantilles del CRM, els PDF de proposta, el correu SMTP i WhatsApp (enllaç o Cloud API).
 * - Abans d'enviar: permisos sobre tots els contractes, autorització del destinatari per a cada titular, preferències
 *   de contacte, avís de duplicat i confirmació explícita. Identificador d'operació únic contra clics repetits.
 * - Res es marca com a contactat automàticament: després d'un enviament confirmat es pot fer, individualment o en bloc.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ExternalLink, Loader2, Mail, MessageCircle, Paperclip, Send, ShieldCheck, XCircle } from "lucide-react";
import { buildGroupMessage, contractLine, normEmail, normPhone } from "@/core/contact-groups";
import { fmtDateTime } from "@/core/dates";
import { render, templateVars, titleCase } from "@/core/templates";
import type { Contract } from "@/core/types";
import { useApp } from "@/data/store";
import { groupsApi, type Preflight, type SendResult } from "@/data/groupsApi";
import { STATUS_META } from "../../selectors";
import { Badge, Button, Field, Notice, cn } from "../ui";
import { SidePanel, contactOf } from "./shared";

const GROUP_TPL = "__conjunt__";
const BASIS: Record<string, string> = { representacio: "Representació (administrador, gestor…)", consentiment: "Consentiment del titular", execucio_contracte: "Execució del contracte", interes_legitim: "Interès legítim", altre: "Altre" };

export function ContactAllPanel() {
  const ca = useApp((s) => s.contactAll);
  const close = () => useApp.getState().set("contactAll", null);
  return (
    <SidePanel open={!!ca} onClose={close} z={56} width="sm:w-[680px]" label="Contactar tots" title={<span className="flex items-center gap-2"><Send size={16} className="text-brand" /> Contactar tots</span>}>
      {ca && <Body key={ca.contractIds.join(",")} ids={ca.contractIds} pre={ca.preselected ?? ca.contractIds} onClose={close} />}
    </SidePanel>
  );
}

function Body({ ids, pre, onClose }: { ids: string[]; pre: string[]; onClose: () => void }) {
  const byId = useApp((s) => s.byId);
  const snap = useApp((s) => s.snap!);
  const contracts = useMemo(() => ids.map((id) => byId[id]).filter(Boolean) as Contract[], [ids, byId]);
  const contact = useMemo(() => contactOf(contracts), [contracts]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(pre.filter((id) => byId[id])));
  const chosen = contracts.filter((c) => sel.has(c.id));
  const [channel, setChannel] = useState<"whatsapp" | "email">(contact.phone ? "whatsapp" : "email");
  const phones = useMemo(() => [...new Map(contracts.map((c) => c.crm.telefonoOverride ?? c.telefono).filter(Boolean).map((p) => [normPhone(p), p!])).values()], [contracts]);
  const emails = useMemo(() => [...new Map(contracts.map((c) => c.crm.emailOverride ?? c.email).filter(Boolean).map((e) => [normEmail(e), e!])).values()], [contracts]);
  const [recipient, setRecipient] = useState<string>(channel === "whatsapp" ? phones[0] ?? "" : emails[0] ?? "");
  const [lang, setLang] = useState<"ca" | "es">("ca");
  const templates = useMemo(() => snap.templates.filter((t) => t.channel === channel), [snap.templates, channel]);
  const [tplId, setTplId] = useState(GROUP_TPL);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [pf, setPf] = useState<Preflight | null>(null);
  const [pfErr, setPfErr] = useState<string | null>(null);
  const [attach, setAttach] = useState<Set<string>>(new Set());
  const [resend, setResend] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const opId = useRef(groupsApi.newOpId());
  const sender = snap.me.name;

  // canvi de canal: el destinatari passa a la dada corresponent
  useEffect(() => { setRecipient(channel === "whatsapp" ? phones[0] ?? "" : emails[0] ?? ""); setTplId(GROUP_TPL); }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps

  // comprovacions al servidor (permisos, titulars, autoritzacions, preferències, duplicats, propostes)
  const pfKey = `${channel}|${recipient}|${chosen.map((c) => c.id).join(",")}`;
  useEffect(() => {
    if (!chosen.length || !recipient.trim()) { setPf(null); return; }
    let live = true;
    const t = setTimeout(() => {
      groupsApi.preflight({ contractIds: chosen.map((c) => c.id), channel, recipient }).then((r) => { if (!live) return; setPf(r); setPfErr(null); setAttach((a) => { const ok = new Set(r.docs.map((d) => d.id)); const n = new Set([...a].filter((x) => ok.has(x))); if (!a.size) r.docs.forEach((d) => n.add(d.id)); return n; }); })
        .catch((e) => { if (live) { setPf(null); setPfErr(e instanceof Error ? e.message : String(e)); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [pfKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // missatge únic (es regenera mentre no s'hagi editat a mà)
  const docsBy = useMemo(() => new Map((pf?.docs ?? []).map((d) => [d.contract_id, d])), [pf]);
  const withProposals = chosen.some((c) => { const d = docsBy.get(c.id); return d && attach.has(d.id); });
  useEffect(() => {
    if (edited) return;
    if (tplId === GROUP_TPL) {
      const m = buildGroupMessage({ contactName: contact.name, contracts: chosen, lang, channel, company: snap.settings.empresa.nombre, sender, withProposals, extras: Object.fromEntries(chosen.map((c) => [c.id, { ahorro: docsBy.get(c.id)?.ahorro_anual ?? null }])) });
      setSubject(m.subject); setBody(m.body);
    } else {
      const t = templates.find((x) => x.id === tplId);
      if (t && chosen[0]) {
        const vars = { ...templateVars(chosen[0], snap.settings, chosen[0].comercial !== "SIN ASIGNAR" ? chosen[0].comercial : sender), nombre: titleCase(contact.name ?? chosen[0].cliente), contractes: chosen.map((c) => contractLine(c, lang)).join("\n"), num_contractes: String(chosen.length) };
        const list = chosen.length > 1 && !/\{\{\s*contractes\s*\}\}/.test(t.body) ? `\n\n${chosen.map((c) => contractLine(c, lang)).join("\n")}` : "";
        setBody(render(t.body, vars) + list); setSubject(t.subject ? render(t.subject, vars) : subject);
      }
    }
    setConfirmed(false);
  }, [tplId, lang, channel, chosen.map((c) => c.id).join(","), withProposals, docsBy, edited]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocking = pf?.blocking ?? [];
  const holdersPending = (pf?.holders ?? []).filter((h) => !h.authorized);
  const canSend = !!chosen.length && !!recipient && !!body.trim() && (channel === "whatsapp" || !!subject.trim()) && !!pf && !blocking.length && confirmed && (!pf.lastSent || resend) && !busy && !result;
  const attachIds = chosen.map((c) => docsBy.get(c.id)).filter((d) => d && attach.has(d.id)).map((d) => d!.id);
  const linkMode = channel === "whatsapp" && pf?.sender.whatsappMode !== "cloud";

  const send = async () => {
    setBusy(true); setErr(null);
    // la finestra de WhatsApp s'obre dins del clic (si no, el navegador la bloqueja) i es dirigeix quan el registre s'ha desat
    const w = linkMode ? window.open("", "_blank") : null;
    if (w) w.opener = null;
    try {
      const r = await groupsApi.send({ opId: opId.current, contractIds: chosen.map((c) => c.id), channel, recipient, contactName: contact.name, subject: channel === "email" ? subject : undefined, body, templateId: tplId === GROUP_TPL ? null : tplId, attachDocIds: attachIds, confirmed: true, confirmResend: resend || undefined });
      useApp.getState().mergeActivities(r.activities);
      if (r.waLink) { if (w) w.location.href = r.waLink; else window.open(r.waLink, "_blank", "noopener"); } else w?.close();
      setResult(r);
      if (r.status === "error") opId.current = groupsApi.newOpId(); // un reintent és un enviament nou (i conscient)
    } catch (e) {
      w?.close();
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const confirmWa = async () => {
    setBusy(true);
    try { const r = await groupsApi.confirmWhatsapp(result!.id); useApp.getState().mergeActivities(r.activities); setResult({ ...result!, status: "registrat" }); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (result && (result.status === "enviat" || result.status === "registrat")) return <AfterSend contracts={chosen} channel={channel} hadProposals={attachIds.length > 0} onClose={onClose} />;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line p-3 text-[12.5px]">
        <p className="font-semibold">{contact.name ? titleCase(contact.name) : "Persona de contacte"}</p>
        <p className="mt-0.5 text-muted">{[...phones, ...emails].join(" · ") || "Sense telèfon ni correu"}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="label">Canal</span>
          <div className="flex gap-1.5">
            <button onClick={() => setChannel("whatsapp")} disabled={!phones.length} className={cn("pressable inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] disabled:opacity-40", channel === "whatsapp" ? "border-brand bg-brand/10 font-medium text-brand" : "border-line")}><MessageCircle size={14} /> WhatsApp</button>
            <button onClick={() => setChannel("email")} disabled={!emails.length} className={cn("pressable inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] disabled:opacity-40", channel === "email" ? "border-brand bg-brand/10 font-medium text-brand" : "border-line")}><Mail size={14} /> Correu</button>
          </div>
        </div>
        <Field label="Destinatari">
          <select className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            {(channel === "whatsapp" ? phones : emails).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
      </div>

      <section>
        <div className="mb-1 flex items-center justify-between"><span className="label !mb-0">Contractes inclosos</span><Badge tone="violet">S'inclouran {chosen.length} de {contracts.length}</Badge></div>
        <ul className="divide-y divide-line rounded-xl border border-line text-[12.5px]">
          {contracts.map((c) => {
            const d = docsBy.get(c.id);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <input type="checkbox" aria-label={`Inclou ${c.cliente}`} checked={sel.has(c.id)} onChange={() => { setSel((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; }); setConfirmed(false); }} />
                <span className="min-w-0 flex-1 truncate">{titleCase(c.cliente)} <span className="text-muted">· {c.cups ? `…${c.cups.slice(-6)}` : "sense CUPS"}</span></span>
                <span className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium" style={{ background: STATUS_META[c.crm.status].soft, color: STATUS_META[c.crm.status].color }}>{STATUS_META[c.crm.status].label}</span>
                {sel.has(c.id) && d && (
                  <label className="inline-flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={attach.has(d.id)} onChange={() => { setAttach((a) => { const n = new Set(a); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; }); setConfirmed(false); }} /><Paperclip size={11} /> {d.file_name}</label>
                )}
                {sel.has(c.id) && !d && <span className="text-[11px] text-muted">sense proposta</span>}
              </li>
            );
          })}
        </ul>
        {channel === "whatsapp" && attachIds.length > 0 && <p className="mt-1 text-[11px] text-muted">Per WhatsApp s'afegeixen enllaços segurs i temporals (7 dies) a les propostes, no els fitxers.</p>}
      </section>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Plantilla">
          <select className="input" value={tplId} onChange={(e) => { setTplId(e.target.value); setEdited(false); }}>
            <option value={GROUP_TPL}>Missatge conjunt amb tots els contractes (recomanat)</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div><span className="label">Idioma</span><div className="flex gap-1">{(["ca", "es"] as const).map((l) => <button key={l} onClick={() => { if (!edited || confirmDiscard()) { setLang(l); setEdited(false); } }} className={cn("pressable rounded-full border px-2.5 py-1 text-[11.5px]", lang === l ? "border-brand bg-brand/10 font-medium text-brand" : "border-line")}>{l === "ca" ? "Català" : "Castellano"}</button>)}</div></div>
      </div>
      {channel === "email" && <Field label="Assumpte"><input className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); setConfirmed(false); }} maxLength={300} /></Field>}
      <Field label="Missatge (editable)"><textarea className="input min-h-[220px] leading-relaxed" value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); setConfirmed(false); }} maxLength={20000} /></Field>
      {/\{\{.+?\}\}/.test(body + subject) && <Notice tone="red">Hi ha variables sense omplir (entre claus). Revisa-les abans d'enviar.</Notice>}

      {pfErr && <Notice tone="red">{pfErr}</Notice>}
      {pf && (
        <section className="space-y-2">
          {pf.holders.length > 0 && (
            <div className="rounded-xl border border-line p-3 text-[12.5px]">
              <p className="mb-1.5 flex items-center gap-1.5 font-medium"><ShieldCheck size={14} /> Titulars i autorització del destinatari</p>
              <ul className="space-y-1">
                {pf.holders.map((h) => (
                  <li key={h.key} className="flex flex-wrap items-center gap-2">
                    {h.authorized ? <CheckCircle2 size={14} className="text-ren" /> : <XCircle size={14} className="text-lost" />}
                    <span className="min-w-0 flex-1">{titleCase(h.name)} <span className="text-muted">({h.contracts.length} {h.contracts.length === 1 ? "contracte" : "contractes"})</span></span>
                    {h.authorized ? <span className="text-[11px] text-muted">{h.via === "propi" ? "dada de contacte del contracte" : h.via === "clients360" ? "relació autoritzada a Clients 360°" : "autorització registrada"}</span> : null}
                  </li>
                ))}
              </ul>
              {holdersPending.length > 0 && pf.recipientKey && <AuthorizeForm contactKey={pf.recipientKey} holders={holdersPending.map((h) => ({ key: h.key, name: h.name }))} refresh={() => groupsApi.preflight({ contractIds: chosen.map((c) => c.id), channel, recipient }).then(setPf)} />}
            </div>
          )}
          {blocking.map((b) => <Notice key={b} tone="red">{b}</Notice>)}
          {pf.warnings.map((w) => <Notice key={w} tone="amber">{w}</Notice>)}
          {pf.lastSent && (
            <Notice tone="amber">
              <span className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Ja es va enviar aquesta comunicació a aquest contacte sobre els mateixos contractes el <b>{fmtDateTime(pf.lastSent.at)}</b>{pf.lastSent.by ? ` (${pf.lastSent.by})` : ""}.</span>
              <label className="mt-1.5 flex items-center gap-1.5"><input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} /> Vull tornar-la a enviar</label>
            </Notice>
          )}
          <p className="text-[11px] text-muted">
            {channel === "email" ? (pf.sender.corporateMail ? "S'enviarà amb el correu corporatiu (SMTP)." : "S'enviarà amb el teu correu configurat a «El meu perfil».") : pf.sender.whatsappMode === "cloud" ? "S'enviarà amb el número empresarial de WhatsApp autoritzat." : "S'obrirà WhatsApp amb el missatge escrit: tu l'envies i després ho confirmes aquí."}
          </p>
        </section>
      )}

      {result?.status === "intent" && (
        <Notice tone="blue">
          S'ha obert WhatsApp amb el missatge. Encara <b>no consta com a enviat</b>: quan l'hagis enviat, confirma-ho.
          <div className="mt-2 flex gap-2"><Button size="sm" variant="success" disabled={busy} onClick={confirmWa}><Check size={13} /> L&apos;he enviat</Button>{result.waLink && <a className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline" href={result.waLink} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Torna a obrir WhatsApp</a>}</div>
        </Notice>
      )}
      {result?.status === "error" && <Notice tone="red">No s&apos;ha enviat: {result.error}. Queda registrat com a error; cap contracte s&apos;ha marcat com a contactat. Pots revisar-ho i tornar-ho a provar.</Notice>}
      {err && <Notice tone="red">{err}</Notice>}

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-2 border-t border-line bg-elevated px-5 py-3">
        <label className="mr-auto flex items-center gap-2 text-[12px]"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!!result && result.status !== "error"} /> He revisat el destinatari, el missatge, els {chosen.length} contractes i els adjunts</label>
        <Button variant="ghost" onClick={onClose}>Tanca</Button>
        <Button variant="primary" disabled={!canSend && !(result?.status === "error" && confirmed && !blocking.length)} onClick={() => { if (result?.status === "error") setResult(null); void send(); }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : channel === "whatsapp" ? <MessageCircle size={14} /> : <Send size={14} />}
          {channel === "whatsapp" ? (linkMode ? "Obre WhatsApp" : "Envia per WhatsApp") : "Envia el correu"} ({chosen.length})
        </Button>
      </div>
    </div>
  );
}

function confirmDiscard() {
  // mateix patró que la resta de comunicacions del CRM (CommsTab)
  return confirm("Vols substituir el text editat pel missatge en l'altre idioma?");
}

/** Registre de l'autorització del destinatari per a titulars diferents (base jurídica i com s'ha verificat). */
function AuthorizeForm({ contactKey, holders, refresh }: { contactKey: string; holders: { key: string; name: string }[]; refresh: () => Promise<unknown> }) {
  const [basis, setBasis] = useState("representacio");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      for (const h of holders) await groupsApi.authorize({ contactKey, holderKey: h.key, basis, note });
      useApp.getState().toast({ title: "Autorització registrada", body: holders.map((h) => titleCase(h.name)).join(", "), tone: "ok" });
      await refresh();
    } catch (e) { useApp.getState().toast({ title: "No s'ha pogut registrar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      <p className="text-[11.5px] text-muted">Registra que el destinatari pot rebre informació de: <b>{holders.map((h) => titleCase(h.name)).join(", ")}</b>. Queda constància de qui ho ha verificat i quan.</p>
      <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
        <select className="input" value={basis} onChange={(e) => setBasis(e.target.value)}>{Object.entries(BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input className="input" placeholder="Com s'ha verificat (p. ex. «Administrador de la comunitat, acta del 2026»)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        <Button size="sm" disabled={busy || note.trim().length < 3} onClick={save}>{busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Registra</Button>
      </div>
    </div>
  );
}

/** Després d'un enviament confirmat: opció de marcar com a contactats (mai automàticament, mai «renovat»). */
function AfterSend({ contracts, channel, hadProposals, onClose }: { contracts: Contract[]; channel: "whatsapp" | "email"; hadProposals: boolean; onClose: () => void }) {
  const pending = contracts.filter((c) => c.crm.status === "pendiente");
  const [sel, setSel] = useState<Set<string>>(new Set(pending.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    // la data de l'últim contacte (i de la proposta, si se n'han adjuntat) es desa a cada contracte: no canvia l'estat
    const st = useApp.getState();
    const now = new Date().toISOString();
    for (const c of contracts) void st.patchCrm(c.id, { ultimoContacto: now, ...(hadProposals ? { propuestaEnviada: now } : {}) }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = async () => {
    setBusy(true);
    const st = useApp.getState();
    let ok = 0;
    for (const c of pending.filter((x) => sel.has(x.id))) { try { await st.move(c.id, "contactado", {}, `Contactat amb una comunicació conjunta per ${channel === "whatsapp" ? "WhatsApp" : "correu"}`, { silent: true }); ok++; } catch { /* comptat */ } }
    st.toast({ title: `${ok} contracte${ok === 1 ? "" : "s"} marcat${ok === 1 ? "" : "s"} com a contactat${ok === 1 ? "" : "s"}`, tone: "ok" });
    setBusy(false); setDone(true);
  };
  return (
    <div className="space-y-4">
      <Notice tone="green"><span className="flex items-center gap-1.5"><CheckCircle2 size={14} /> Comunicació {channel === "email" ? "enviada" : "registrada"}. S&apos;ha desat una sola operació vinculada als {contracts.length} contractes; es pot consultar des de qualsevol d&apos;ells.</span></Notice>
      {pending.length > 0 && !done ? (
        <section className="rounded-xl border border-line p-3">
          <p className="text-[13px] font-semibold">Marcar els contractes seleccionats com a contactats</p>
          <p className="mb-2 text-[11.5px] text-muted">Opcional. Pots desmarcar els que no vulguis moure. Cap contracte es marca com a renovat.</p>
          <ul className="space-y-1 text-[12.5px]">
            {pending.map((c) => <li key={c.id}><label className="flex items-center gap-2"><input type="checkbox" checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} /> {titleCase(c.cliente)} <span className="text-muted">· {c.cups ? `…${c.cups.slice(-6)}` : ""}</span></label></li>)}
          </ul>
          <div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onClose}>Ara no</Button><Button size="sm" variant="primary" disabled={busy || !sel.size} onClick={mark}>{busy && <Loader2 size={13} className="animate-spin" />} Marca {sel.size} com a contactats</Button></div>
        </section>
      ) : <div className="flex justify-end"><Button variant="primary" onClick={onClose}>Fet</Button></div>}
    </div>
  );
}

