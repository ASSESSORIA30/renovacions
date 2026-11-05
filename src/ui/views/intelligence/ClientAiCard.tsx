"use client";
/** Fitxa del client: oportunitats detectades per la IA i preferències de contacte (oposició comercial). */
import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, Loader2, RefreshCw, ShieldOff } from "lucide-react";
import { useApp } from "@/data/store";
import { AI_KIND_LABEL } from "@/core/intelligence";
import { Badge, Button, cn } from "../../components/ui";
import { aiApi, eur, type OppItem } from "./api";
import { ScoreDot } from "./Center";

const PREFS: [string, string][] = [["qualsevol", "Qualsevol canal"], ["telefon", "Telèfon"], ["email", "Correu"], ["whatsapp", "WhatsApp"], ["presencial", "Presencial"], ["cap", "No contactar"]];

export function ClientAiCard({ client, canEdit }: { client: { id: string; commercial_opt_out?: boolean; contact_preference?: string }; canEdit: boolean }) {
  const go = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [items, setItems] = useState<OppItem[] | null>(null);
  const [migrated, setMigrated] = useState(true);
  const [optOut, setOptOut] = useState(!!client.commercial_opt_out);
  const [pref, setPref] = useState(client.contact_preference ?? "qualsevol");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await aiApi.get<{ migrated: boolean; items: OppItem[] }>("list", { clientId: client.id, status: "obertes" }); setItems(r.items); setMigrated(r.migrated); }
    catch { setItems([]); }
  }, [client.id]);
  useEffect(() => { void load(); }, [load]);
  if (!migrated) return null;
  const savePrefs = async (o: boolean, p: string) => {
    const prev = { optOut, pref };
    setBusy("prefs"); setOptOut(o); setPref(p);
    try { await aiApi.act("contact", { clientId: client.id, optOut: o, preference: p }); toast({ title: "Preferències de contacte desades", tone: "ok" }); await load(); }
    catch (e) { setOptOut(prev.optOut); setPref(prev.pref); toast({ title: "No s'han desat", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  const analyse = async () => {
    setBusy("an");
    try { await aiApi.act("analyse", { clientId: client.id }); await load(); toast({ title: "Client analitzat", tone: "ok" }); }
    catch (e) { toast({ title: "No s'ha pogut analitzar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(null); }
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><BrainCircuit size={14} className="text-brand" /> Intel·ligència IA</h3>
        {canEdit && <Button size="sm" variant="ghost" onClick={analyse} disabled={!!busy}>{busy === "an" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Analitza</Button>}
      </div>
      {items === null ? <div className="h-10 animate-pulse rounded-xl bg-elevated" /> : !items.length ? <p className="text-[12px] text-muted">Cap oportunitat detectada oberta.</p> : (
        <ul className="divide-y divide-line">{items.slice(0, 6).map((o) => (
          <li key={o.id}><button className="flex w-full items-center gap-2 py-1.5 text-left text-[12.5px] hover:bg-ink/[0.02]" onClick={() => go("ia-oportunitat", { id: o.id })}>
            <ScoreDot score={o.score} size={28} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{AI_KIND_LABEL[o.kind]}</span><span className="block truncate text-[11px] text-muted">{o.summary}</span></span>
            {o.saving_status === "estimat" && o.potential_saving_eur && <span className="text-[11.5px] text-ren tnum">{eur(o.potential_saving_eur, 0)}</span>}
          </button></li>
        ))}</ul>
      )}
      <div className="mt-3 rounded-xl bg-elevated/70 p-2.5">
        <p className="flex items-center gap-1.5 text-[12px] font-medium">Preferències de contacte {(optOut || pref === "cap") && <Badge tone="red"><ShieldOff size={10} /> Sense accions comercials</Badge>}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <select className={cn("input h-8 w-auto text-[12px]")} aria-label="Canal preferit" disabled={!canEdit || !!busy} value={pref} onChange={(e) => void savePrefs(optOut, e.target.value)}>{PREFS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" disabled={!canEdit || !!busy} checked={optOut} onChange={(e) => void savePrefs(e.target.checked, pref)} /> S&apos;oposa a comunicacions comercials</label>
        </div>
        <p className="mt-1 text-[10.5px] text-muted">El motor no proposa recuperacions ni vendes creuades a clients amb oposició o «no contactar».</p>
      </div>
    </section>
  );
}
