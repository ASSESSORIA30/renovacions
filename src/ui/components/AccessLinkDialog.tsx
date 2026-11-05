"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Modal, Notice } from "./ui";

export interface AccessLinkInfo { email: string; link: string | null; emailSent: boolean; emailError: string | null }

/** Mostra el resultat de donar accés: si el correu ha sortit i l'enllaç per si es vol enviar des del correu propi. */
export function AccessLinkDialog({ info, onClose }: { info: AccessLinkInfo | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!info?.link) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(info.link!); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* el navegador no deixa copiar: es pot seleccionar a mà */ } };
  return (
    <Modal open onClose={onClose} title="Enllaç d'accés" footer={<Button variant="primary" onClick={onClose}>Fet</Button>}>
      <div className="space-y-3 text-[13px]">
        {info.emailSent
          ? <Notice tone="green">S&apos;ha enviat el correu a {info.email} des del correu corporatiu d&apos;Assessoria 3.0.</Notice>
          : <Notice tone="amber">No s&apos;ha enviat cap correu. {info.emailError}</Notice>}
        <p className="text-muted">Si ho prefereixes, copia l&apos;enllaç i envia&apos;l tu mateix des del teu correu a {info.email}. És personal: no el comparteixis amb ningú més. Si caduca, torna a prémer «Donar accés».</p>
        <div className="flex gap-2">
          <input readOnly className="input flex-1 font-mono text-[11.5px]" value={info.link} onFocus={(e) => e.currentTarget.select()} aria-label="Enllaç d'accés" />
          <Button onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiat" : "Copia"}</Button>
        </div>
      </div>
    </Modal>
  );
}
