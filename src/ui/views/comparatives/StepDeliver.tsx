"use client";
/** Pas 5 · Entrega: previsualització PDF, emissió, correu amb confirmació, WhatsApp i enllaç privat. */
import { useEffect, useMemo, useState } from "react";
const DEFAULT_COMPANY = { nombre: "Assessoria 3.0", telefono: "", email: "", web: "", direccion: "" };
import { CheckCircle2, Copy, Download, Eye, Link2, Loader2, Mail, MessageCircle, Send, ShieldCheck } from "lucide-react";
import { renderComparisonPdf, whatsappSummary } from "@/comparator/pdf";
import { blobToBase64, comparisonsApi, serverMode } from "@/comparator/client";
import { useApp } from "@/data/store";
import { Button, Notice, cn } from "../../components/ui";
import { useWizard } from "./state";
import { permanenceIssues } from "@/comparator/permanence";
import { saveDraft, useSnapshot } from "./StepResults";

export function StepDeliver() {
  const w = useWizard();
  const s = useSnapshot();
  const { snap, toast, integrations } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [doc, setDoc] = useState<{ id: string } | null>(null);
  const [mail, setMail] = useState({ to: w.client.email ?? "", subject: "", body: "", confirmed: false });
  const [share, setShare] = useState<{ url: string; shareId: string; expiresAt: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const issued = w.savedStatus === "emesa" || w.savedStatus === "enviada";
  const company = snap?.settings.empresa ?? DEFAULT_COMPANY;
  const best = s.result.ranked[0];

  useEffect(() => {
    const es = w.lang === "es";
    setMail((m) => ({
      ...m,
      subject: es ? `Propuesta de ahorro energético${w.client.name ? ` · ${w.client.name}` : ""}` : `Proposta d'estalvi energètic${w.client.name ? ` · ${w.client.name}` : ""}`,
      body: es
        ? `Buenos días${w.client.name ? ` ${w.client.name}` : ""},\n\nLe adjuntamos la propuesta que hemos preparado${best ? `. La alternativa recomendada es ${best.offer.supplierName} (${best.offer.productName})` : ""}${best?.saving != null && best.saving > 0 ? `, con un ahorro estimado de ${best.saving.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} al año` : ""}.\n\nQuedamos a su disposición para cualquier aclaración.\n\n${snap?.me.name ?? ""}\n${company.nombre} · ${company.telefono}`
        : `Bon dia${w.client.name ? ` ${w.client.name}` : ""},\n\nUs adjuntem la proposta que hem preparat${best ? `. L'alternativa recomanada és ${best.offer.supplierName} (${best.offer.productName})` : ""}${best?.saving != null && best.saving > 0 ? `, amb un estalvi estimat de ${best.saving.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })} l'any` : ""}.\n\nRestem a la vostra disposició per a qualsevol aclariment.\n\n${snap?.me.name ?? ""}\n${company.nombre} · ${company.telefono}`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.lang]);

  const pdf = useMemo(() => () => renderComparisonPdf(s, { kind: w.kind, lang: w.lang, recommendation: w.recommendation || null, company, salesperson: snap?.me.name ?? null, logo: snap?.settings.logo ?? null }), [s, w.kind, w.lang, w.recommendation, company, snap]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast({ title: "No s'ha pogut completar", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };
  const preview = () => {
    const { blob } = pdf();
    if (url) URL.revokeObjectURL(url);
    setUrl(URL.createObjectURL(blob));
  };
  const download = () => {
    const { blob, fileName } = pdf();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
  };
  const issue = () =>
    run("Emetent la proposta…", async () => {
      if (!w.savedId) await saveDraft();
      if (w.recommendation && useWizard.getState().savedId) await comparisonsApi.action({ action: "recommendation", id: useWizard.getState().savedId, text: w.recommendation });
      await saveDraft(true);
      toast({ title: "Proposta emesa", body: "Els càlculs queden congelats i la proposta s'ha registrat al CRM.", tone: "ok" });
    });
  const attach = () =>
    run("Generant i desant el PDF…", async () => {
      const { blob } = pdf();
      const r = await comparisonsApi.action<{ document: { id: string }; url: string | null }>({ action: "pdf", id: w.savedId, kind: w.kind, lang: w.lang, base64: await blobToBase64(blob) });
      setDoc(r.document);
    });
  const send = () =>
    run("Enviant el correu…", async () => {
      const r = await comparisonsApi.action<{ accepted: boolean }>({ action: "send", id: w.savedId, to: mail.to, subject: mail.subject, body: mail.body, documentId: doc!.id, confirmed: mail.confirmed });
      setSent(r.accepted ? "El servidor de correu ha acceptat el missatge." : "El servidor de correu no ha confirmat l'acceptació.");
      w.set({ savedStatus: r.accepted ? "enviada" : w.savedStatus });
    });
  const createLink = () =>
    run("Creant l'enllaç privat…", async () => {
      const r = await comparisonsApi.action<{ url: string; shareId: string; expiresAt: string }>({ action: "share", id: w.savedId, days: 15 });
      setShare(r);
    });
  const wa = whatsappSummary(s, w.lang, share?.url ?? null);
  const phone = (w.client.phone ?? "").replace(/[^\d]/g, "");

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4">
        <label className="block"><span className="label">Idioma</span>
          <select className="input w-40" value={w.lang} onChange={(e) => w.set({ lang: e.target.value as "ca" | "es" })}><option value="ca">Català</option><option value="es">Castellano</option></select>
        </label>
        <label className="block"><span className="label">Estil</span>
          <select className="input w-56" value={w.kind} onChange={(e) => w.set({ kind: e.target.value as "resum" | "detallada" })}><option value="resum">Resum executiu (1 pàgina)</option><option value="detallada">Proposta detallada</option></select>
        </label>
        <Button onClick={preview}><Eye size={15} /> Previsualitza</Button>
        <Button onClick={download}><Download size={15} /> Descarrega</Button>
        {serverMode() && !issued && s.offers.some((o) => permanenceIssues(o).length > 0) && <Notice>Hi ha una tarifa amb la permanència pendent de confirmar: es pot desar l&apos;esborrany i generar el PDF de treball, però no emetre la proposta definitiva.</Notice>}
        {serverMode() && !issued && <Button variant="primary" disabled={!!busy || s.offers.some((o) => permanenceIssues(o).length > 0)} onClick={issue}><ShieldCheck size={15} /> Emet la proposta</Button>}
        {issued && <span className="flex items-center gap-1.5 text-[13px] font-medium text-ren"><CheckCircle2 size={15} /> Proposta {w.savedStatus === "enviada" ? "enviada" : "emesa"} · càlculs congelats</span>}
      </section>
      {!serverMode() && <Notice tone="blue">Mode local: pots previsualitzar i descarregar el PDF. Per desar, emetre i enviar cal el servidor de la plataforma.</Notice>}
      {url && <object data={url} type="application/pdf" className="h-[720px] w-full rounded-2xl border border-line bg-surface" aria-label="Previsualització del PDF"><a href={url}>Obre el PDF</a></object>}

      {serverMode() && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={cn("space-y-2 rounded-2xl border border-line bg-surface p-4", !issued && "opacity-60")}>
            <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><Mail size={15} /> Enviament per correu</h3>
            {!issued && <p className="text-[12px] text-muted">Primer emet la proposta: el PDF enviat ha de correspondre a un càlcul congelat.</p>}
            {!integrations.smtp && <Notice>El correu (SMTP) no està configurat en aquest desplegament.</Notice>}
            <input className="input" placeholder="Destinatari" value={mail.to} disabled={!issued} onChange={(e) => setMail({ ...mail, to: e.target.value, confirmed: false })} />
            <input className="input" placeholder="Assumpte" value={mail.subject} disabled={!issued} onChange={(e) => setMail({ ...mail, subject: e.target.value, confirmed: false })} />
            <textarea className="input min-h-[150px]" value={mail.body} disabled={!issued} onChange={(e) => setMail({ ...mail, body: e.target.value, confirmed: false })} />
            {!doc ? (
              <Button disabled={!issued || !!busy} onClick={attach}>Genera i adjunta el PDF</Button>
            ) : (
              <p className="text-[12.5px] text-ren">PDF adjuntat ({w.kind === "resum" ? "resum" : "detallat"}, {w.lang}).</p>
            )}
            <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={mail.confirmed} disabled={!doc} onChange={(e) => setMail({ ...mail, confirmed: e.target.checked })} /> He revisat el destinatari, el text i el PDF. Vull enviar-lo.</label>
            <Button variant="primary" disabled={!issued || !doc || !mail.confirmed || !integrations.smtp || !!busy} onClick={send}><Send size={14} /> Envia</Button>
            {sent && <Notice tone="green">{sent} L&apos;enviament queda registrat{w.contractId ? " a l'historial del contracte" : ""}.</Notice>}
          </section>
          <section className={cn("space-y-2 rounded-2xl border border-line bg-surface p-4", !issued && "opacity-60")}>
            <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><MessageCircle size={15} /> WhatsApp i enllaç privat</h3>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!issued || !!busy} onClick={createLink}><Link2 size={14} /> Crea un enllaç privat (15 dies)</Button>
              {share && <Button variant="ghost" onClick={() => navigator.clipboard.writeText(share.url)}><Copy size={14} /> Copia l&apos;enllaç</Button>}
            </div>
            {share && <p className="break-all text-[12px] text-muted">{share.url}<br />Caduca el {new Date(share.expiresAt).toLocaleDateString("ca-ES")}. Es pot revocar des de Comparatives.</p>}
            <textarea className="input min-h-[120px]" value={wa} readOnly aria-label="Missatge de WhatsApp" />
            <a
              className={cn("pressable inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#25D366] px-3.5 text-sm font-medium text-white", !issued && "pointer-events-none opacity-50")}
              href={`https://wa.me/${phone}?text=${encodeURIComponent(wa)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => w.savedId && comparisonsApi.action({ action: "whatsapp", id: w.savedId, phone: phone || null }).catch(() => undefined)}
            >
              <MessageCircle size={14} /> Obre a WhatsApp
            </a>
            <p className="text-[11px] text-muted">S&apos;obre el missatge preparat; no s&apos;envia automàticament i queda registrat com a «preparat».</p>
          </section>
        </div>
      )}
      {busy && <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> {busy}</p>}
      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => w.set({ step: 4 })}>Enrere</Button>
        <Button onClick={() => useApp.getState().navigate("comparatives")}>Totes les comparatives</Button>
      </div>
    </div>
  );
}
