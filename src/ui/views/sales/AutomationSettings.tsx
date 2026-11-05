"use client";
/** Configuració → Automatitzacions: regles configurables per Direcció i registre d'execucions. */
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Play, XCircle, Zap } from "lucide-react";
import { fmtDateTime } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Notice, cn } from "../../components/ui";
import { salesApi } from "./api";

type Data = Awaited<ReturnType<typeof salesApi.rules>>;
const PARAM_LABEL: Record<string, string> = { days: "Dies", hours: "Hores", due_days: "Dies per fer-la", days_before: "Dies abans del venciment" };

export function AutomationSettings() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { enabled: boolean; params: Record<string, string> }>>({});
  const toast = useApp((s) => s.toast);
  const load = () => salesApi.rules().then((r) => {
    setD(r);
    setDraft(Object.fromEntries(r.rules.map((x) => [x.key, { enabled: x.enabled, params: Object.fromEntries(Object.entries(x.params).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)])) }])));
  }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);
  const save = async (key: string) => {
    const r = draft[key];
    const params: Record<string, number | number[]> = {};
    for (const [k, v] of Object.entries(r.params)) {
      const parts = v.split(/[,\s]+/).filter(Boolean).map(Number);
      if (parts.some((n) => !Number.isFinite(n) || n < 0)) { toast({ title: "Valor no vàlid", body: `${PARAM_LABEL[k] ?? k}: ${v}`, tone: "err" }); return; }
      params[k] = k === "days" && (d?.rules.find((x) => x.key === key)?.params.days instanceof Array) ? parts : parts[0];
    }
    setBusy(key);
    try { await salesApi.saveRule({ key, enabled: r.enabled, params }); toast({ title: "Regla desada", tone: "ok" }); await load(); }
    catch (e) { toast({ title: "No s'ha pogut desar", body: String(e instanceof Error ? e.message : e), tone: "err" }); } finally { setBusy(null); }
  };
  const run = async () => {
    setBusy("run");
    try { const r = await salesApi.runRules(); toast({ title: "Automatitzacions executades", body: `${r.tasks} tasques i ${r.notifications} avisos nous (els repetits no es dupliquen).`, tone: "ok" }); await load(); }
    catch (e) { toast({ title: "Error", body: String(e instanceof Error ? e.message : e), tone: "err" }); } finally { setBusy(null); }
  };
  if (error) return <Notice tone="red">{error}</Notice>;
  if (!d) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" /> Carregant…</p>;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Zap size={16} className="text-brand" /> Automatitzacions comercials</h3>
            <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">Generen tasques i avisos interns. S&apos;executen cada dia amb el cron de Vercel, quan algú obre «La meva jornada» (com a màxim cada 30 minuts) i en guanyar una oportunitat. Cada tasca o avís té una clau única: repetir l&apos;execució no crea duplicats. No envien correus ni WhatsApp als clients.</p>
          </div>
          {d.canEdit && <Button variant="primary" disabled={busy === "run"} onClick={run}>{busy === "run" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Executa ara</Button>}
        </div>
        {!d.canEdit && <p className="mt-2 text-[12px] text-muted">Només Direcció (administrador) pot modificar les regles.</p>}
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        {d.rules.map((r) => {
          const dr = draft[r.key];
          if (!dr) return null;
          return (
            <section key={r.key} className={cn("rounded-2xl border bg-surface p-4", dr.enabled ? "border-line" : "border-dashed border-line opacity-70")}>
              <div className="flex items-start gap-3">
                <label className="mt-0.5 inline-flex cursor-pointer items-center"><input type="checkbox" className="h-4 w-4" disabled={!d.canEdit} checked={dr.enabled} onChange={(e) => setDraft({ ...draft, [r.key]: { ...dr, enabled: e.target.checked } })} aria-label={`Activa ${r.name}`} /></label>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold">{r.name}</p>
                  <p className="text-[12px] text-muted">{r.description}</p>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {Object.entries(dr.params).map(([k, v]) => (
                      <label key={k} className="block"><span className="text-[11px] text-muted">{PARAM_LABEL[k] ?? k}</span><input className="input h-8 w-36 tnum" disabled={!d.canEdit} value={v} onChange={(e) => setDraft({ ...draft, [r.key]: { ...dr, params: { ...dr.params, [k]: e.target.value } } })} /></label>
                    ))}
                    {d.canEdit && <Button size="sm" disabled={busy === r.key} onClick={() => save(r.key)}>Desa</Button>}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-2 text-[14px] font-semibold">Últimes execucions</h3>
        {d.runs.length === 0 ? <p className="text-[12.5px] text-muted">Encara no s&apos;ha executat cap vegada.</p> : (
          <ul className="divide-y divide-line text-[12.5px]">
            {d.runs.map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-1.5">
                {x.ok === false ? <XCircle size={14} className="text-lost" /> : x.ok ? <CheckCircle2 size={14} className="text-ren" /> : <Loader2 size={14} className="animate-spin text-muted" />}
                <span className="w-40 text-muted">{fmtDateTime(x.started_at)}</span>
                <Badge>{x.trigger === "cron" ? "Cron diari" : x.trigger === "manual" ? "Manual" : x.trigger === "jornada" ? "La meva jornada" : "Esdeveniment"}</Badge>
                <span>{x.ok === false ? <span className="text-lost">{x.error}</span> : `${x.tasks_created} tasques · ${x.notifications_created} avisos`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
