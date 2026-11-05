"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Mail, MessageCircle, Paperclip, Send, Sparkles } from "lucide-react";
import { mailtoLink, render, templateVars, titleCase, whatsappLink } from "@/core/templates";
import { useApp } from "@/data/store";
import { Button, Field, Modal, Notice, cn } from "./ui";

const TONES = ["Professional", "Proper", "Directe", "Persuasiu", "Urgent"];
const GOALS = ["Primer contacte", "Proposta de renovació", "Recordatori", "Resposta a una objecció", "Arguments de renovació", "Recuperar el client"];

export function Composer() {
  const { composer, set, byId, snap, integrations, repo, log, patchCrm, move, toast } = useApp();
  const c = composer ? byId[composer.contractId] : null;
  const channel = composer?.channel ?? "whatsapp";
  const templates = useMemo(() => (snap?.templates ?? []).filter((t) => t.channel === channel), [snap?.templates, channel]);
  const [tplId, setTplId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("Professional");
  const [lang, setLang] = useState<"ca" | "es">("ca");
  const [goal, setGoal] = useState(GOALS[0]);
  const [busy, setBusy] = useState(false);
  const [moveToContacted, setMoveToContacted] = useState(true);
  const [approved, setApproved] = useState(false);
  const doc = composer?.attachDocId ? snap?.docs.find((d) => d.id === composer.attachDocId) : null;

  const comercial = snap?.me.code ?? snap?.me.name ?? "";
  const vars = useMemo(() => (c && snap ? templateVars(c, snap.settings, c.comercial !== "SIN ASIGNAR" ? c.comercial : comercial) : {}), [c, snap, comercial]);

  useEffect(() => {
    if (!composer) return;
    const first = composer.templateId ?? (channel === "whatsapp" ? "t1" : "t2");
    const t = templates.find((x) => x.id === first) ?? templates[0];
    setTplId(t?.id ?? "");
    setSubject(t?.subject ? render(t.subject, vars) : "");
    setBody(t ? render(t.body, vars) : "");
    setApproved(false);
    setMoveToContacted(c?.crm.status === "pendiente");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer?.contractId, composer?.channel]);

  if (!c || !snap) return <Modal open={false} onClose={() => {}} title="">{null}</Modal>;
  const phone = c.crm.telefonoOverride ?? c.telefono;
  const email = c.crm.emailOverride ?? c.email;
  const close = () => set("composer", null);

  const pickTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    setTplId(id);
    if (t) { setBody(render(t.body, vars)); setSubject(t.subject ? render(t.subject, vars) : subject); setApproved(false); }
  };

  const generate = async () => {
    if (!repo?.ai) return;
    setBusy(true);
    try {
      const text = await repo.ai({ kind: "message", contractId: c.id, tone, channel, goal, lang, context: { vars } });
      const m = text.match(/^(?:Assumpte|Asunto):\s*(.+)\n+/i);
      if (m && channel === "email") { setSubject(m[1].trim()); setBody(text.slice(m[0].length)); } else setBody(text);
      setApproved(false);
    } catch (e) {
      toast({ title: "La IA no ha respost", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally { setBusy(false); }
  };

  const after = async () => {
    await patchCrm(c.id, { ultimoContacto: new Date().toISOString(), ...(doc ? { propuestaEnviada: new Date().toISOString() } : {}) });
    if (moveToContacted && c.crm.status === "pendiente") await move(c.id, "contactado", {}, `Contactat per ${channel === "whatsapp" ? "WhatsApp" : "correu"}`);
    close();
  };

  const openWhatsApp = async () => {
    window.open(whatsappLink(phone!, body), "_blank", "noopener");
    await log({ contractId: c.id, type: "whatsapp", title: `WhatsApp preparat (${templates.find((t) => t.id === tplId)?.name ?? "personalitzat"})`, body, delivery: "preparado", meta: { to: phone } });
    toast({ title: "WhatsApp obert amb el missatge", body: "Queda com a «Preparat». Marca'l com a enviat a Comunicacions quan l'enviïs.", tone: "info" });
    await after();
  };

  const sendEmail = async () => {
    if (!repo?.sendEmail) return;
    setBusy(true);
    try {
      let attachment: { fileName: string; base64: string } | undefined;
      if (doc) {
        const url = await repo.getDocUrl(doc);
        if (url) {
          const blob = await (await fetch(url)).blob();
          attachment = { fileName: doc.fileName, base64: await blobToBase64(blob) };
        }
      }
      const r = await repo.sendEmail({ to: email!, subject, body, contractId: c.id, attachment });
      await log({ contractId: c.id, type: "email", title: `Correu enviat: ${subject}`, body, delivery: r.accepted ? "enviado" : "error", meta: { to: email, messageId: r.id, attachment: doc?.fileName } });
      toast({ title: r.accepted ? "Correu enviat" : "El servidor ha rebutjat el correu", body: email!, tone: r.accepted ? "ok" : "err" });
      if (r.accepted) await after();
    } catch (e) {
      toast({ title: "No s'ha pogut enviar el correu", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally { setBusy(false); }
  };

  const openMail = async () => {
    window.location.href = mailtoLink(email!, subject, body);
    await log({ contractId: c.id, type: "email", title: `Correu preparat: ${subject}`, body, delivery: "preparado", meta: { to: email, attachment: doc?.fileName } });
    await after();
  };

  return (
    <Modal
      open={!!composer}
      onClose={close}
      width="max-w-2xl"
      title={<span className="flex items-center gap-2">{channel === "whatsapp" ? <MessageCircle size={16} className="text-ren" /> : <Mail size={16} className="text-cont" />}{channel === "whatsapp" ? "WhatsApp" : "Correu"} per a {titleCase(c.cliente)}</span>}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> He revisat el missatge
          </label>
          {c.crm.status === "pendiente" && (
            <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={moveToContacted} onChange={(e) => setMoveToContacted(e.target.checked)} /> Mou a Contactats</label>
          )}
          {channel === "whatsapp" ? (
            <Button variant="success" disabled={!approved || !phone || !body.trim()} onClick={openWhatsApp}><ExternalLink size={14} /> Obre a WhatsApp</Button>
          ) : integrations.smtp ? (
            <Button variant="primary" disabled={!approved || !email || busy || !subject.trim()} onClick={sendEmail}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Envia el correu</Button>
          ) : (
            <Button variant="primary" disabled={!approved || !email} onClick={openMail}><ExternalLink size={14} /> Obre al meu correu</Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Plantilla">
            <select className="input" value={tplId} onChange={(e) => pickTemplate(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Per a"><input className="input" readOnly value={(channel === "whatsapp" ? phone : email) ?? "Sense dada de contacte"} /></Field>
        </div>

        <div className="rounded-xl border border-line bg-elevated p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Objectiu"><select className="input h-8 py-1" value={goal} onChange={(e) => setGoal(e.target.value)}>{GOALS.map((g) => <option key={g}>{g}</option>)}</select></Field>
            <div>
              <span className="label">To</span>
              <div className="flex flex-wrap gap-1">
                {TONES.map((t) => <button key={t} onClick={() => setTone(t)} className={cn("pressable rounded-full border px-2.5 py-1 text-[11.5px]", tone === t ? "border-brand bg-brand/10 font-medium text-brand" : "border-line hover:border-ink/25")}>{t}</button>)}
              </div>
            </div>
            <div>
              <span className="label">Idioma</span>
              <div className="flex gap-1">
                {(["ca", "es"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={cn("pressable rounded-full border px-2.5 py-1 text-[11.5px]", lang === l ? "border-brand bg-brand/10 font-medium text-brand" : "border-line hover:border-ink/25")}>{l === "ca" ? "Català" : "Castellano"}</button>)}
              </div>
            </div>
            <Button className="ml-auto" variant="primary" size="sm" disabled={!integrations.ai || busy} onClick={generate}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Genera el missatge amb IA
            </Button>
          </div>
          {!integrations.ai && <p className="mt-2 text-[11px] text-muted">La IA no està activa en aquesta sessió: necessita Supabase (inici de sessió) i <code>ANTHROPIC_API_KEY</code> a Vercel. Mira què falta a Configuració → Integracions. Les plantilles ja funcionen.</p>}
        </div>

        {channel === "email" && <Field label="Assumpte"><input className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setApproved(false); }} /></Field>}
        <Field label="Missatge (previsualització editable)">
          <textarea className="input min-h-[190px] leading-relaxed" value={body} onChange={(e) => { setBody(e.target.value); setApproved(false); }} />
        </Field>
        {/\{\{.+?\}\}/.test(body + subject) && <Notice tone="red">Hi ha variables sense omplir al missatge (entre claus). Revisa-les abans d'enviar.</Notice>}

        {doc && (
          <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px]">
            <Paperclip size={14} className="text-muted" /> {doc.fileName}
            {!integrations.smtp && channel === "email" && <span className="ml-auto text-[11px] text-muted">Amb «Obre al meu correu» l'has d'adjuntar a mà (descarrega'l des de Documents).</span>}
          </div>
        )}
        {channel === "email" && !integrations.smtp && (
          <Notice tone="blue">L'enviament directe des de la plataforma està desactivat fins que es configuri l'SMTP corporatiu (IONOS) al servidor. Ara s'obrirà el teu programa de correu i quedarà registrat com a «Preparat».</Notice>
        )}
        {channel === "whatsapp" && <p className="text-[11px] text-muted">S'obrirà WhatsApp amb el missatge escrit; tu decideixes quan l'envies. Queda registrat com a «Preparat» fins que el marquis com a enviat.</p>}
      </div>
    </Modal>
  );
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}
