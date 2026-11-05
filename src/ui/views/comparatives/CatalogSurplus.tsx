"use client";
/** Fase 2 · Catàleg: compensació d'excedents, permanència i regla de permanència obligatòria (Direcció). */
import { useEffect, useState } from "react";
import { serverMode, tariffsApi } from "@/comparator/client";
import { permanenceIssues, permanenceOf, permanenceRequired } from "@/comparator/permanence";
import {
  CONTRACT_TYPE_LABEL, CONTRACT_TYPES, DEFAULT_PERMANENCE_RULE, SURPLUS_MECHANISM_LABEL, SURPLUS_MECHANISMS, SURPLUS_MODE_LABEL, SURPLUS_MODES, emptySurplus,
  type ContractType, type OfferVersion, type PermanenceInfo, type PermanenceRule, type SurplusConfig, type SurplusMechanism, type SurplusMode,
} from "@/comparator/types";
import { useApp } from "@/data/store";
import { Button, Notice, cn } from "../../components/ui";

const num = (s: string): number | null => {
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const txt = (s: string) => (s.trim() ? s.trim() : null);

function F({ label, value, onChange, className }: { label: string; value: string | number | null; onChange: (v: string) => void; className?: string }) {
  return <label className={cn("block", className)}><span className="label">{label}</span><input className="input" defaultValue={value ?? ""} key={String(value ?? "")} onBlur={(e) => onChange(e.target.value)} /></label>;
}

export function usePermanenceRule(): PermanenceRule {
  const [rule, setRule] = useState<PermanenceRule>(DEFAULT_PERMANENCE_RULE);
  useEffect(() => { if (serverMode()) tariffsApi.rule().then(setRule).catch(() => undefined); }, []);
  return rule;
}

/** Secció «COMPENSACIÓ D'EXCEDENTS» de la tarifa. Mai s'assumeix un preu: sense dades queda «no informada». */
export function SurplusEditor({ o, set }: { o: OfferVersion; set: (p: Partial<OfferVersion>) => void }) {
  if (o.energyType === "gas") return null;
  const s: SurplusConfig = o.surplus ?? emptySurplus("no_informada");
  const up = (p: Partial<SurplusConfig>) => set({ surplus: { ...s, ...p, source: p.source ?? (s.source ?? "manual") } });
  const has = s.mode !== "no_informada" && s.mode !== "sense";
  return (
    <fieldset className="space-y-2 rounded-xl border border-line p-3">
      <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide">Compensació d&apos;excedents</legend>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block"><span className="label">Compensa excedents?</span>
          <select className="input" value={s.mode} onChange={(e) => { const m = e.target.value as SurplusMode; set({ surplus: { ...emptySurplus(m), ...(m === s.mode ? s : {}), mode: m, source: s.source ?? "manual" } }); }}>
            {SURPLUS_MODES.map((m) => <option key={m} value={m}>{m === "no_informada" ? "No informat" : m === "sense" ? "No" : `Sí · ${SURPLUS_MODE_LABEL[m]}`}</option>)}
          </select></label>
        {has && (
          <label className="block"><span className="label">Mecanisme</span>
            <select className="input" value={s.mechanism ?? ""} onChange={(e) => up({ mechanism: (e.target.value || null) as SurplusMechanism | null })}>
              <option value="">Sense indicar</option>
              {SURPLUS_MECHANISMS.map((m) => <option key={m} value={m}>{SURPLUS_MECHANISM_LABEL[m]}</option>)}
            </select></label>
        )}
        {has && s.mode !== "periodes" && <F label={s.mode === "indexat" ? "Preu de referència (€/kWh)" : "Preu excedents (€/kWh)"} value={s.eurKwh} onChange={(v) => up({ eurKwh: num(v) })} />}
        {has && <label className="block"><span className="label">Vigent des de</span><input type="date" className="input" value={s.validFrom ?? ""} onChange={(e) => up({ validFrom: e.target.value || null })} /></label>}
        {has && <label className="block"><span className="label">Vigent fins a</span><input type="date" className="input" value={s.validTo ?? ""} onChange={(e) => up({ validTo: e.target.value || null })} /></label>}
      </div>
      {s.mode === "periodes" && (
        <div className="grid gap-3 sm:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => <F key={i} label={`Excedents P${i + 1} (€/kWh)`} value={s.periodEurKwh[i] ?? null} onChange={(v) => up({ periodEurKwh: s.periodEurKwh.map((x, j) => (j === i ? num(v) : x)) })} />)}
        </div>
      )}
      {s.mode === "indexat" && <F label="Fórmula o referència del preu (tal com consta al contracte)" value={s.formula} onChange={(v) => up({ formula: txt(v) })} />}
      {has && (
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="flex items-end gap-2 pb-2 text-[12.5px]"><input type="checkbox" checked={!!s.battery?.enabled} onChange={(e) => up({ battery: e.target.checked ? { enabled: true, feeEurMonth: s.battery?.feeEurMonth ?? null, accumulation: s.battery?.accumulation ?? null, usage: s.battery?.usage ?? null, expiry: s.battery?.expiry ?? null } : null })} /> Bateria virtual</label>
          {s.battery?.enabled && <>
            <F label="Cost bateria (€/mes)" value={s.battery.feeEurMonth} onChange={(v) => up({ battery: { ...s.battery!, feeEurMonth: num(v) } })} />
            <F label="Acumulació" value={s.battery.accumulation} onChange={(v) => up({ battery: { ...s.battery!, accumulation: txt(v) } })} />
            <F label="Condicions d'ús" value={s.battery.usage} onChange={(v) => up({ battery: { ...s.battery!, usage: txt(v) } })} />
            <F label="Caducitat del saldo" value={s.battery.expiry} onChange={(v) => up({ battery: { ...s.battery!, expiry: txt(v) } })} />
          </>}
          <F label="Límits contractuals" value={s.limits} onChange={(v) => up({ limits: txt(v) })} className="sm:col-span-2" />
          <F label="Observacions" value={s.notes} onChange={(v) => up({ notes: txt(v) })} className="sm:col-span-2" />
        </div>
      )}
      {s.mode === "no_informada" && <p className="text-[11.5px] text-muted">Compensació no informada: el comparador no calcularà cap compensació amb aquesta tarifa fins que es completi.</p>}
      {has && s.mode !== "periodes" && s.mode !== "indexat" && s.eurKwh == null && <p className="text-[11.5px] text-amber-700 dark:text-amber-300">Falta el preu dels excedents: la compensació quedarà pendent.</p>}
    </fieldset>
  );
}

/** Permanència detallada. L'excepció a la regla obligatòria només la pot documentar Direcció. */
export function PermanenceEditor({ o, set, rule }: { o: OfferVersion; set: (p: Partial<OfferVersion>) => void; rule: PermanenceRule }) {
  const admin = useApp((s) => s.snap?.me.role === "admin");
  const p: PermanenceInfo = permanenceOf(o);
  const up = (patch: Partial<PermanenceInfo>) => {
    const next = { ...p, ...patch };
    set({ permanence: next, permanenceMonths: next.status === "amb" ? next.months : next.status === "sense" ? null : o.permanenceMonths, penalty: next.penalty });
  };
  const required = permanenceRequired(o, rule);
  const issues = permanenceIssues(o, rule);
  return (
    <fieldset className="space-y-2 rounded-xl border border-line p-3">
      <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide">Permanència{required ? " (obligatòria per a aquesta tarifa)" : ""}</legend>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block"><span className="label">Permanència</span>
          <select className="input" value={p.status} onChange={(e) => up({ status: e.target.value as PermanenceInfo["status"], months: e.target.value === "amb" ? p.months : null })}>
            <option value="amb">Sí, amb permanència</option>
            <option value="sense">No (consta expressament)</option>
            <option value="no_informada">No informada</option>
          </select></label>
        {p.status === "amb" && <F label="Durada (mesos)" value={p.months} onChange={(v) => up({ months: num(v) == null ? null : Math.round(num(v)!) })} />}
        {p.status === "amb" && <F label="Inici" value={p.startNote} onChange={(v) => up({ startNote: txt(v) })} />}
        <F label="Font (document, clàusula…)" value={p.source} onChange={(v) => up({ source: txt(v) })} />
        {p.status === "amb" && <F label="Condicions de cancel·lació" value={p.cancellation} onChange={(v) => up({ cancellation: txt(v) })} className="sm:col-span-2" />}
        {p.status === "amb" && <F label="Penalització" value={p.penalty} onChange={(v) => up({ penalty: txt(v) })} className="sm:col-span-2" />}
        {required && (admin
          ? <F label="Excepció documentada (només Direcció)" value={p.exception} onChange={(v) => up({ exception: txt(v) })} className="sm:col-span-4" />
          : p.exception ? <p className="text-[11.5px] text-muted sm:col-span-4">Excepció de Direcció: {p.exception}</p> : null)}
      </div>
      {issues.length > 0 && <Notice>{issues.join(" · ")}. La tarifa quedarà com a esborrany i no es podrà emetre cap proposta definitiva amb ella.</Notice>}
    </fieldset>
  );
}

/** Configuració de la regla (Direcció). */
export function PermanenceRuleCard() {
  const admin = useApp((s) => s.snap?.me.role === "admin");
  const toast = useApp((s) => s.toast);
  const loaded = usePermanenceRule();
  const [r, setR] = useState<PermanenceRule | null>(null);
  const rule = r ?? loaded;
  if (!admin || !serverMode()) return null;
  const save = async () => {
    try { setR(await tariffsApi.saveRule(rule)); toast({ title: "Regla de permanència desada", tone: "ok" }); }
    catch (e) { toast({ title: "No s'ha pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  return (
    <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-[13px]">
      <h3 className="text-[14px] font-semibold">Regla de permanència obligatòria (Direcció)</h3>
      <label className="flex items-center gap-2"><input type="checkbox" checked={rule.enabled} onChange={(e) => setR({ ...rule, enabled: e.target.checked })} /> Activa</label>
      <div className="flex flex-wrap gap-3">
        <span className="text-muted">Tarifes:</span>
        {["2.0TD", "3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD"].map((t) => (
          <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={rule.tariffs.includes(t)} onChange={(e) => setR({ ...rule, tariffs: e.target.checked ? [...rule.tariffs, t] : rule.tariffs.filter((x) => x !== t) })} />{t}</label>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <span className="text-muted">Tipus de preu:</span>
        {CONTRACT_TYPES.map((t) => (
          <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={rule.contractTypes.includes(t)} onChange={(e) => setR({ ...rule, contractTypes: e.target.checked ? [...rule.contractTypes, t] : rule.contractTypes.filter((x) => x !== t) as ContractType[] })} />{CONTRACT_TYPE_LABEL[t]}</label>
        ))}
      </div>
      <p className="text-[11.5px] text-muted">Les tarifes afectades sense durada de permanència no es poden activar ni fer servir en una proposta definitiva. No canvia cap proposta ja emesa.</p>
      <Button size="sm" variant="primary" onClick={save}>Desa la regla</Button>
    </section>
  );
}
