"use client";
import { useMemo, useState } from "react";
import { Mail, MessageCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { DEFAULT_TEMPLATES, render, templateVars } from "@/core/templates";
import type { Template } from "@/core/types";
import { uid } from "@/data/defaults";
import { isStaff } from "@/core/roles";
import { useApp } from "@/data/store";
import { Button, Field, cn } from "../components/ui";

const VARS = ["nombre", "cups_corto", "vencimiento", "dias", "comercializadora", "tarifa", "suministro", "comercial", "empresa", "telefono_empresa"];

export function PlantillasView() {
  const { snap, saveTemplates, contracts, toast } = useApp();
  const isAdmin = isStaff(snap!.me.role);
  const [list, setList] = useState<Template[]>(snap!.templates);
  const [sel, setSel] = useState(list[0]?.id);
  const t = list.find((x) => x.id === sel);
  const sample = contracts.find((c) => c.crm.status === "pendiente" && c.telefono) ?? contracts[0];
  const preview = useMemo(() => (t && sample ? { s: render(t.subject ?? "", templateVars(sample, snap!.settings, sample.comercial)), b: render(t.body, templateVars(sample, snap!.settings, sample.comercial)) } : null), [t, sample, snap]);
  const upd = (patch: Partial<Template>) => setList(list.map((x) => (x.id === sel ? { ...x, ...patch } : x)));
  const dirty = JSON.stringify(list) !== JSON.stringify(snap!.templates);

  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-1">
        {list.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]", sel === x.id ? "bg-ink/[0.07] font-medium" : "text-ink/80 hover:bg-ink/[0.04]")}>
            {x.channel === "whatsapp" ? <MessageCircle size={14} className="text-ren" /> : <Mail size={14} className="text-cont" />}<span className="truncate">{x.name}</span>
          </button>
        ))}
        {isAdmin && (
          <div className="flex gap-1.5 pt-2">
            <Button size="sm" onClick={() => { const n: Template = { id: uid(), name: "Nova plantilla", channel: "whatsapp", body: "Hola {{nombre}}, " }; setList([...list, n]); setSel(n.id); }}><Plus size={13} /> Nova</Button>
            <Button size="sm" variant="ghost" onClick={() => { setList(DEFAULT_TEMPLATES); setSel(DEFAULT_TEMPLATES[0].id); }}><RotateCcw size={13} /> Originals</Button>
          </div>
        )}
      </aside>
      {t && (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
            <Field label="Nom"><input className="input" disabled={!isAdmin} value={t.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
            <Field label="Canal"><select className="input" disabled={!isAdmin} value={t.channel} onChange={(e) => upd({ channel: e.target.value as Template["channel"] })}><option value="whatsapp">WhatsApp</option><option value="email">Correu</option></select></Field>
          </div>
          {t.channel === "email" && <Field label="Assumpte"><input className="input" disabled={!isAdmin} value={t.subject ?? ""} onChange={(e) => upd({ subject: e.target.value })} /></Field>}
          <Field label="Text"><textarea className="input min-h-[170px] font-mono text-[12.5px] leading-relaxed" disabled={!isAdmin} value={t.body} onChange={(e) => upd({ body: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-1">
            {VARS.map((v) => <button key={v} disabled={!isAdmin} onClick={() => upd({ body: t.body + `{{${v}}}` })} className="pressable rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-muted hover:text-ink">{`{{${v}}}`}</button>)}
          </div>
          {preview && (
            <div className="rounded-xl bg-elevated p-3">
              <p className="mb-1 text-[11px] text-muted">Previsualització amb {sample.cliente}</p>
              {t.channel === "email" && <p className="mb-1 text-[13px] font-semibold">{preview.s}</p>}
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{preview.b}</p>
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center gap-2">
              {!t.builtIn && <Button size="sm" variant="ghost" onClick={() => { const n = list.filter((x) => x.id !== t.id); setList(n); setSel(n[0]?.id); }}><Trash2 size={13} /> Elimina</Button>}
              <Button className="ml-auto" variant="primary" disabled={!dirty} onClick={async () => { await saveTemplates(list); toast({ title: "Plantilles desades", tone: "ok" }); }}>Desa els canvis</Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
