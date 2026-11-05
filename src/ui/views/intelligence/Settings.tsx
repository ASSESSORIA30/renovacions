"use client";
/** Configuració de la intel·ligència (només Direcció): motor, puntuació, escenari SAS, esborranys i retenció. */
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { useApp } from "@/data/store";
import { Badge, Button, Field, Notice, cn } from "../../components/ui";
import { aiApi } from "./api";

type Rule = { key: string; name: string; description: string | null; enabled: boolean; params: Record<string, unknown>; updated_at: string };
const W_LABEL: Record<string, string> = { venciment: "Proximitat del venciment", estalvi: "Estalvi potencial", volum: "Volum energètic", qualitat_dades: "Qualitat de les dades", conversio: "Probabilitat de conversió (evidència)", antiguitat_proposta: "Antiguitat de la proposta", ultima_activitat: "Última activitat", seguiment: "Necessitat de seguiment" };

export function IntelligenceSettings() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { aiApi.get<{ rules: Rule[] }>("settings").then((r) => setRules(r.rules), (e) => setErr(e.message)); }, []);
  if (err) return <Notice tone="red">{err}</Notice>;
  if (!rules) return <div className="h-60 animate-pulse rounded-2xl bg-elevated" />;
  const by = (k: string) => rules.find((r) => r.key === k);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {by("ai_motor") && <MotorCard rule={by("ai_motor")!} />}
      {by("ai_puntuacio") && <ScoreCard rule={by("ai_puntuacio")!} />}
      {by("ai_sas_escenari") && <SasCard rule={by("ai_sas_escenari")!} />}
      <div className="space-y-4">
        {by("ai_esborranys_auto") && <SimpleCard rule={by("ai_esborranys_auto")!} fields={[["min_score", "Puntuació mínima"], ["max_per_run", "Màxim per execució"]]} />}
        {by("ai_retencio") && <SimpleCard rule={by("ai_retencio")!} fields={[["conversation_days", "Dies de conservació de converses"], ["tool_days", "Dies de conservació del registre d'eines"]]} />}
      </div>
    </div>
  );
}

function useSave(key: string) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const save = async (b: { enabled?: boolean; params?: unknown }) => {
    setBusy(true);
    try { await aiApi.act("setting", { key, ...b }); toast({ title: "Configuració desada", tone: "ok" }); return true; }
    catch (e) { toast({ title: "No s'ha desat", body: e instanceof Error ? e.message : String(e), tone: "err" }); return false; }
    finally { setBusy(false); }
  };
  return { busy, save };
}

function Card({ rule, children, enabled, setEnabled, onSave, busy }: { rule: Rule; children: React.ReactNode; enabled: boolean; setEnabled: (v: boolean) => void; onSave: () => void; busy: boolean }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div><h3 className="text-[14px] font-semibold">{rule.name}</h3>{rule.description && <p className="mt-0.5 text-[12px] text-muted">{rule.description}</p>}</div>
        <label className="flex shrink-0 items-center gap-2 text-[12px]"><input type="checkbox" className="h-4 w-4 accent-[var(--brand,#16a34a)]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label={`Activa ${rule.name}`} />{enabled ? <Badge tone="green">Activa</Badge> : <Badge tone="zinc">Desactivada</Badge>}</label>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
      <div className="mt-3 flex justify-end"><Button size="sm" variant="primary" onClick={onSave} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Desa</Button></div>
    </section>
  );
}
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")));

function MotorCard({ rule }: { rule: Rule }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [p, setP] = useState(rule.params as Record<string, number | number[]>);
  const { busy, save } = useSave(rule.key);
  const f = (k: string, l: string, hint?: string) => <Field label={l} hint={hint}><input className="input h-9" inputMode="decimal" value={String(p[k] ?? "")} onChange={(e) => setP({ ...p, [k]: num(e.target.value) })} /></Field>;
  return (
    <Card rule={rule} enabled={enabled} setEnabled={setEnabled} busy={busy} onSave={() => void save({ enabled, params: p })}>
      <Field label="Avisos de renovació (dies abans del venciment)"><input className="input h-9" value={(p.renewal_days as number[]).join(", ")} onChange={(e) => setP({ ...p, renewal_days: e.target.value.split(/[,\s]+/).map(Number).filter((x) => x > 0) })} /></Field>
      <div className="grid gap-2 sm:grid-cols-3">{f("min_saving_eur", "Estalvi mínim (€)")}{f("min_saving_pct", "Estalvi mínim (%)")}{f("expensive_pct", "Contracte car si estalvi ≥ (%)")}</div>
      <div className="grid gap-2 sm:grid-cols-3">{f("inactive_days", "Client inactiu (dies)")}{f("proposal_days", "Proposta sense resposta (dies)")}{f("min_power_saving_eur", "Estalvi mínim de potència (€)")}</div>
      <div className="grid gap-2 sm:grid-cols-2">{f("max_comparisons", "Màxim de comparatives per execució", "Control de cost i temps")}{f("max_attempts", "Errors consecutius abans d'aturar el cron")}</div>
    </Card>
  );
}

function ScoreCard({ rule }: { rule: Rule }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const params = rule.params as { weights: Record<string, number>; business_weights: { comissio: number; marge: number } };
  const [w, setW] = useState(params.weights);
  const [bw, setBw] = useState(params.business_weights);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const { busy, save } = useSave(rule.key);
  return (
    <Card rule={rule} enabled={enabled} setEnabled={setEnabled} busy={busy} onSave={() => void save({ enabled, params: { weights: w, business_weights: bw } })}>
      <p className="text-[12px] text-muted">Pes de cada factor de la <b>prioritat de servei al client</b> (es normalitza sobre {total}). La comissió no hi intervé.</p>
      <div className="space-y-1.5">{Object.keys(W_LABEL).map((k) => (
        <label key={k} className="grid grid-cols-[1fr_120px_36px] items-center gap-2 text-[12.5px]"><span>{W_LABEL[k]}</span><input type="range" min={0} max={50} value={w[k] ?? 0} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} aria-label={W_LABEL[k]} /><span className="text-right tnum">{w[k] ?? 0}</span></label>
      ))}</div>
      <div className="rounded-xl bg-elevated p-2.5 text-[12px]">
        <p className="font-medium">Rendibilitat interna (indicador separat)</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2">Comissió <input className="input h-8 w-20" inputMode="numeric" value={bw.comissio} onChange={(e) => setBw({ ...bw, comissio: num(e.target.value) })} /></label>
          <label className="flex items-center gap-2">Marge <input className="input h-8 w-20" inputMode="numeric" value={bw.marge} onChange={(e) => setBw({ ...bw, marge: num(e.target.value) })} /></label>
        </div>
      </div>
    </Card>
  );
}

function SasCard({ rule }: { rule: Rule }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [p, setP] = useState(rule.params as { min_eur_kwh: number; max_eur_kwh: number; retailers: string[]; justification: string; source: string; as_of: string | null });
  const { busy, save } = useSave(rule.key);
  const missing = enabled && (!p.source.trim() || !p.as_of || !p.justification.trim() || !p.retailers.length);
  return (
    <Card rule={rule} enabled={enabled} setEnabled={setEnabled} busy={busy} onSave={() => void save({ enabled, params: p })}>
      <Notice tone="amber">No s&apos;aplica universalment ni com a cost regulat confirmat: només a ofertes de les comercialitzadores indicades que facturen el SAS a part <b>sense valor publicat</b>. Es mostra sempre com a escenari, amb la font i la data.</Notice>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Mínim (€/kWh)"><input className="input h-9" inputMode="decimal" value={p.min_eur_kwh} onChange={(e) => setP({ ...p, min_eur_kwh: num(e.target.value) })} /></Field>
        <Field label="Màxim (€/kWh)"><input className="input h-9" inputMode="decimal" value={p.max_eur_kwh} onChange={(e) => setP({ ...p, max_eur_kwh: num(e.target.value) })} /></Field>
      </div>
      <Field label="Comercialitzadores (separades per comes)"><input className="input h-9" value={p.retailers.join(", ")} onChange={(e) => setP({ ...p, retailers: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>
      <Field label="Justificació"><textarea className="input min-h-[60px] py-2" value={p.justification} onChange={(e) => setP({ ...p, justification: e.target.value })} /></Field>
      <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
        <Field label="Font dels valors" hint="Document, condicions o comunicació de la comercialitzadora"><input className={cn("input h-9", missing && !p.source.trim() && "border-red-500")} value={p.source} onChange={(e) => setP({ ...p, source: e.target.value })} /></Field>
        <Field label="Data dels valors"><input type="date" className={cn("input h-9", missing && !p.as_of && "border-red-500")} value={p.as_of ?? ""} onChange={(e) => setP({ ...p, as_of: e.target.value || null })} /></Field>
      </div>
      {missing && <p className="text-[12px] text-red-600">Per activar-lo cal indicar comercialitzadores, justificació, font i data.</p>}
    </Card>
  );
}

function SimpleCard({ rule, fields }: { rule: Rule; fields: [string, string][] }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [p, setP] = useState(rule.params as Record<string, number>);
  const { busy, save } = useSave(rule.key);
  return (
    <Card rule={rule} enabled={enabled} setEnabled={setEnabled} busy={busy} onSave={() => void save({ enabled, params: p })}>
      <div className="grid gap-2 sm:grid-cols-2">{fields.map(([k, l]) => <Field key={k} label={l}><input className="input h-9" inputMode="numeric" value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: num(e.target.value) })} /></Field>)}</div>
    </Card>
  );
}
