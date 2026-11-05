"use client";
/**
 * PREVISUALITZACIÓ DE L'ANNEX DE NUFRI (lector local, sense IA). Mostra el resultat abans d'importar, separat en
 * Electricitat 2.0TD · 3.0TD · indexada · Gas fix · Gas indexat, amb les taules de preus, els marges de potència,
 * les comissions (només amb accés econòmic) i les condicions. Distingeix errors de lectura, dades no informades
 * i dades que necessiten aprovació. Importa al Catàleg de tarifes existent (versions, sense duplicats).
 */
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, ShieldAlert } from "lucide-react";
import { tariffsApi } from "@/comparator/client";
import { nufriGasIndexedPrice, type NufriDoc } from "@/comparator/nufri-reader";
import { GAS_FIXED_UNIT_LABEL, NUFRI_GROUP_LABEL, nufriItems, nufriRuleProposals, type GasFixedUnit, type NufriGroup, type NufriItem } from "@/comparator/nufri-mapping";
import type { OfferVersion } from "@/comparator/types";
import { useApp } from "@/data/store";
import { Badge, Button, Notice, cn } from "../../components/ui";
import { fApi } from "../finance/api";

const f6 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { minimumFractionDigits: 6, maximumFractionDigits: 6 }));
const fx = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? "—" : v.toLocaleString("ca-ES", { maximumFractionDigits: d }));
const STATUS: Record<string, { label: string; tone: "green" | "zinc" | "amber" | "red" | "blue" }> = {
  nova: { label: "Nova", tone: "green" }, modificada: { label: "Preus nous", tone: "blue" }, revisio: { label: "Revisar", tone: "amber" },
  incompleta: { label: "No importable", tone: "red" }, sense_canvis: { label: "Sense canvis", tone: "zinc" }, duplicada: { label: "Duplicada", tone: "zinc" },
};
const GROUPS: NufriGroup[] = ["2.0TD", "3.0TD", "indexada", "gas_fix", "gas_indexat"];

export function NufriPreview({ doc, fileName, existing, onDone, onCancel }: { doc: NufriDoc & { commissionsHidden?: boolean }; fileName: string; existing: OfferVersion[]; onDone: () => void; onCancel: () => void }) {
  const toast = useApp((s) => s.toast);
  const isAdmin = useApp((s) => s.snap?.me.role === "admin");
  const [unit, setUnit] = useState<GasFixedUnit | null>(null);
  const items = useMemo(() => nufriItems(doc, { fileName, existing, gasFixedUnit: unit }), [doc, fileName, existing, unit]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(items.filter((i) => i.status !== "incompleta" && i.status !== "sense_canvis" && i.group !== "indexada" && i.group !== "gas_indexat").map((i) => i.offer.productName)));
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pvb, setPvb] = useState<number | null>(null);
  const showCom = !doc.commissionsHidden;
  const chosen = items.filter((i) => sel.has(i.offer.productName) && i.status !== "incompleta");
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const importNow = async () => {
    setBusy("Important al catàleg…");
    try {
      const r = await tariffsApi.importConfirm({
        fileName, supplierName: "Nufri", mapping: { lector: `local:nufri ${doc.version ?? ""}`.trim() },
        counts: Object.fromEntries(Object.keys(STATUS).map((k) => [k, items.filter((i) => i.status === k).length])),
        report: items.map((i, k) => ({ row: k + 1, status: i.status, errors: i.errors, warnings: [...i.warnings, ...i.approvals] })),
        offers: chosen.map((i) => i.offer), activateComplete: false, keepDraftIds: chosen.map((i) => i.offer.id), keepIncompleteAsDraft: true, dryRun: false,
      }) as { saved: number; rejected?: number; reasons?: string[] };
      setDone(`${r.saved} tarifes desades com a esborrany al catàleg${r.rejected ? ` · ${r.rejected} rebutjades: ${(r.reasons ?? []).join(" · ")}` : ""}. Revisa-les i activa-les des del catàleg.`);
      toast({ title: "Annex de Nufri importat", body: `${r.saved} tarifes en esborrany`, tone: "ok" });
      onDone();
    } catch (e) {
      toast({ title: "No s'ha pogut importar", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally { setBusy(null); }
  };
  const propose = async () => {
    setBusy("Proposant les comissions a Direcció…");
    try {
      const r = await fApi.act<{ created: number; versioned: number; unchanged: number }>("rules_propose", { data: nufriRuleProposals(doc) });
      toast({ title: "Comissions proposades", body: `${r.created} regles noves i ${r.versioned} versions noves pendents d'aprovació de Direcció · ${r.unchanged} sense canvis`, tone: "ok" });
    } catch (e) {
      toast({ title: "No s'han pogut proposar", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally { setBusy(null); }
  };

  const c = doc.conditions;
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" data-testid="nufri-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold">Annex d&apos;Energía Nufri · {doc.kind === "gas" ? "Gas natural" : "Electricitat"} · {doc.version ?? "versió no trobada"}</h3>
          <p className="text-[12px] text-muted">Lector local (sense IA). Annex del {doc.annexDate ?? "—"}{doc.conditionsVersion ? ` · ${doc.conditionsVersion}` : ""} · {fileName}</p>
        </div>
        <Badge tone="green"><CheckCircle2 size={12} /> Llegit en local</Badge>
      </div>

      {doc.warnings.length > 0 && <Notice tone="red"><b>Errors o dubtes de lectura:</b> {doc.warnings.join(" · ")}</Notice>}
      {doc.approvals.length > 0 && <Notice><ShieldAlert size={14} className="mr-1 inline" /><b>Necessiten aprovació:</b> {doc.approvals.join(" · ")}</Notice>}
      {doc.commissionsHidden && <Notice tone="blue">Les comissions de l&apos;annex només les veu Direcció o l&apos;Administració autoritzada.</Notice>}

      <details className="rounded-xl border border-line p-3 text-[12.5px]">
        <summary className="cursor-pointer font-semibold">Condicions comercials</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Validesa: activacions des del {c.validFrom ?? "—"} · {c.validUntilNote ?? "data de fi no indicada"}</li>
          {c.maxAnnualKwh != null && <li>Contractes fins a {fx(c.maxAnnualKwh / 1000, 0)} MWh de consum anual</li>}
          {c.newClientsOnly && <li>Només clients sense contracte vigent amb Energía Nufri</li>}
          {c.nonTelemeteredOnly && <li>Només punts NO telemesurats</li>}
          {c.customOffer && <li>{c.customOffer}</li>}
          {c.sasIncluded === false && <li>Els preus no inclouen el mecanisme d&apos;ajust (es factura a part)</li>}
          {c.reserveVirtual.note && <li>{c.reserveVirtual.note}</li>}
          {doc.elec.map((t) => <li key={t.tariff}>{t.tariff}: {t.greenIncluded === true ? "inclou energia 100 % renovable (GdO)" : t.greenIncluded === false ? "els preus NO inclouen energia verda" : "energia verda no indicada"}</li>)}
          {c.powerCommissionNote && <li>{c.powerCommissionNote}</li>}
          {c.texts.map((x) => <li key={x.slice(0, 40)} className="text-muted">{x}</li>)}
        </ul>
      </details>

      {GROUPS.map((g) => {
        const its = items.filter((i) => i.group === g);
        if (!its.length) return null;
        return (
          <details key={g} open className="rounded-xl border border-line p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] font-semibold"><ChevronDown size={14} /> {NUFRI_GROUP_LABEL[g]} <span className="font-normal text-muted">· {its.length} tarifes</span></summary>
            <div className="mt-2 space-y-3">
              {g === "gas_fix" && doc.gas.some((x) => !x.fixedTerm.unit) && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/[0.08] p-2 text-[12.5px]">
                  Unitat del terme fix (el document no la indica):
                  {isAdmin ? (
                    <select className="input h-8 w-auto py-0" value={unit ?? ""} onChange={(e) => setUnit((e.target.value || null) as GasFixedUnit | null)} aria-label="Unitat del terme fix">
                      <option value="">sense confirmar</option>
                      {(Object.keys(GAS_FIXED_UNIT_LABEL) as GasFixedUnit[]).map((u) => <option key={u} value={u}>{GAS_FIXED_UNIT_LABEL[u]}</option>)}
                    </select>
                  ) : <b>pendent que Direcció la confirmi</b>}
                  <span className="text-muted">Sense confirmar, les tarifes de gas queden incompletes (esborrany).</span>
                </div>
              )}
              {its.map((i) => <ItemCard key={i.offer.productName} i={i} doc={doc} showCom={showCom} checked={sel.has(i.offer.productName)} onToggle={() => toggle(i.offer.productName)} />)}
              {g === "indexada" && doc.indexed && (
                <div className="grid gap-3 text-[12px] lg:grid-cols-[220px_1fr]">
                  <table className="w-full"><thead className="text-muted"><tr><th className="text-left">CO €/MWh</th>{showCom && <th className="text-right">Comissió €/MWh</th>}</tr></thead>
                    <tbody>{doc.indexed.rows.map((r) => <tr key={r.coEurMwh} className="border-t border-line"><td>{r.coEurMwh}</td>{showCom && <td className="text-right tnum">{fx(r.commissionEurMwh)}</td>}</tr>)}</tbody></table>
                  <div className="space-y-1">
                    <p><b>Fórmula:</b> <span className="font-mono">{doc.indexed.formula ?? "no llegida"}</span></p>
                    <p><b>K</b> = {doc.indexed.k ?? "—"} (coeficient d&apos;altres costos; no és un import en €/kWh)</p>
                    <ul className="list-disc pl-5 text-muted">{doc.indexed.components.map((x) => <li key={x.code}><b>{x.code}</b>: {x.description}</li>)}</ul>
                    {doc.indexed.greenNotes.map((x) => <p key={x}>{x}</p>)}
                    <p className="text-amber-700 dark:text-amber-300">Sense dades de mercat (OMIE, serveis, peatges…) no es calcula cap preu: a la comparativa seria una simulació.</p>
                  </div>
                </div>
              )}
              {g === "gas_indexat" && doc.gasIndexedFormula && (
                <div className="space-y-2 text-[12px]">
                  <p><b>Fórmula:</b> {doc.gasIndexedFormula.text} · PVB = índex MIBGAS · {doc.gasIndexedFormula.multiplier.toLocaleString("ca-ES")} = coeficient · C = constant de cada RL i nivell (no és una comissió).</p>
                  {doc.gasIndexedFormula.pvbDefinition && <p className="text-muted">PVB: {doc.gasIndexedFormula.pvbDefinition}</p>}
                  <label className="flex items-center gap-2">Simula amb un PVB de referència (€/MWh): <input className="input h-8 w-28" inputMode="decimal" onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); setPvb(e.target.value.trim() && Number.isFinite(v) ? v : null); }} /></label>
                  <table className="w-full"><thead className="text-muted"><tr><th className="text-left">Peatge</th>{doc.gas[0]?.levels.map((l) => <th key={l.id} className="text-right">{l.label}: C{pvb != null ? " → €/kWh (estimat)" : ""}</th>)}</tr></thead>
                    <tbody>{doc.gas.map((r) => <tr key={r.tariff} className="border-t border-line"><td>{r.tariff}</td>{r.levels.map((l) => <td key={l.id} className="text-right tnum">{f6(l.c)}{pvb != null && l.c != null ? ` → ${f6(nufriGasIndexedPrice(l.c, pvb, doc.gasIndexedFormula!.multiplier))} *` : ""}{showCom && l.indexedCommission != null ? <span className="block text-muted">{fx(l.indexedCommission)} €/MWh</span> : null}</td>)}</tr>)}</tbody></table>
                  {pvb != null && <p className="text-amber-700 dark:text-amber-300">* Preus estimats amb un PVB de {pvb} €/MWh: no són preus contractuals.</p>}
                </div>
              )}
            </div>
          </details>
        );
      })}

      {done && <Notice tone="green">{done}</Notice>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onCancel}>Tanca</Button>
        <div className="flex flex-wrap gap-2">
          {showCom && <Button disabled={!!busy} onClick={propose}>Proposa les comissions a Direcció</Button>}
          <Button variant="primary" disabled={!!busy || !chosen.length} onClick={importNow}>{busy ? <Loader2 size={14} className="animate-spin" /> : null} Importa {chosen.length} tarifes com a esborrany</Button>
        </div>
      </div>
      <p className="text-[11px] text-muted">Les tarifes entren en esborrany: s&apos;activen des del catàleg quan s&apos;hagin revisat (permanència de les fixes 3.0TD, unitat del terme fix del gas, condicions del descompte). Les comissions no es guarden a la tarifa: van a Regles de comissió, pendents d&apos;aprovació de Direcció.</p>
    </section>
  );
}

function ItemCard({ i, doc, showCom, checked, onToggle }: { i: NufriItem; doc: NufriDoc; showCom: boolean; checked: boolean; onToggle: () => void }) {
  const o = i.offer;
  const m = o.commercial;
  const t = doc.elec.find((x) => x.tariff === o.accessTariff);
  const variant = t?.variants.find((v) => `Nufri ${t.tariff} · ${v.label}` === o.productName);
  const gasRow = doc.gas.find((g) => g.tariff === o.accessTariff);
  const nE = o.energyType === "gas" || o.contractType === "fix24h" ? 1 : o.accessTariff === "2.0TD" ? 3 : 6;
  const nP = o.accessTariff === "2.0TD" ? 2 : 6;
  const st = STATUS[i.status] ?? STATUS.revisio;
  return (
    <div className={cn("rounded-lg border border-line p-2.5", checked && "border-brand/50 bg-brand/[0.03]")}>
      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        <input type="checkbox" checked={checked} disabled={i.status === "incompleta"} onChange={onToggle} />
        <b>{o.productName}</b>
        <Badge tone={st.tone}>{st.label}</Badge>
        {i.page && <span className="text-[11px] text-muted">pàg. {i.page}</span>}
        {m?.discountPct ? <Badge tone="blue">{m.discountPct} % ja descomptat</Badge> : null}
      </label>
      {i.errors.length > 0 && <p className="mt-1 text-[11.5px] text-red-600">{i.errors.join(" · ")}</p>}
      {i.approvals.length > 0 && <p className="mt-1 text-[11.5px] text-amber-700 dark:text-amber-300">Aprovació: {i.approvals.join(" · ")}</p>}
      {i.warnings.length > 0 && <p className="mt-1 text-[11.5px] text-muted">{i.warnings.join(" · ")}</p>}
      {m && m.levels.some((l) => l.energy24h != null || l.energy.some((x) => x != null)) && (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer text-brand">Preus d&apos;energia per nivell{showCom ? " i comissió" : ""}</summary>
          <table className="mt-1 w-full tnum">
            <thead className="text-muted"><tr><th className="text-left">Nivell</th>{showCom && <th className="text-right">€/MWh</th>}{Array.from({ length: nE }, (_, k) => <th key={k} className="text-right">{nE === 1 ? "Preu €/kWh" : `P${k + 1}`}</th>)}{m.discountPct ? <th className="text-right">Original</th> : null}</tr></thead>
            <tbody>{m.levels.map((l) => {
              const lv = variant?.levels.find((x) => x.id === l.id);
              const gl = gasRow?.levels.find((x) => x.id === l.id);
              const com = lv?.eurMwh ?? gl?.fixedCommission ?? null;
              const ps = nE === 1 ? [l.energy24h ?? l.energy[0]] : l.energy.slice(0, nE);
              return <tr key={l.id} className="border-t border-line"><td>{l.label}</td>{showCom && <td className="text-right">{fx(com)}</td>}{ps.map((p, k) => <td key={k} className="text-right">{f6(p)}</td>)}{m.discountPct ? <td className="text-right text-muted">{(nE === 1 ? [l.original?.energy24h] : l.original?.energy.slice(0, nE) ?? []).map((x) => f6(x)).join(" / ")}</td> : null}</tr>;
            })}</tbody>
          </table>
        </details>
      )}
      {m && m.margins.length > 0 && (
        <details className="mt-1 text-[12px]">
          <summary className="cursor-pointer text-brand">Marges de potència ({m.margins.map((x) => x.label).join(", ")})</summary>
          <table className="mt-1 w-full tnum">
            <thead className="text-muted"><tr><th className="text-left">Modalitat</th><th className="text-right">€/kW·any</th>{Array.from({ length: nP }, (_, k) => <th key={k} className="text-right">P{k + 1} €/kW·dia</th>)}</tr></thead>
            <tbody>{m.margins.map((x) => <tr key={x.id} className="border-t border-line"><td>{x.label}</td><td className="text-right">{fx(x.eurKwYear)}</td>{x.power.slice(0, nP).map((p, k) => <td key={k} className="text-right">{f6(p)}</td>)}</tr>)}</tbody>
          </table>
        </details>
      )}
      {o.energyType === "gas" && gasRow && (
        <p className="mt-1 text-[12px] text-muted">Consum {fx(gasRow.minKwh / 1000, 0)}–{fx(gasRow.maxKwh / 1000, 0)} MWh/any · terme fix {fx(gasRow.fixedTerm.value)} {gasRow.fixedTerm.unit ?? "(unitat no indicada)"}{o.gasFixedEurDay != null ? ` → ${f6(o.gasFixedEurDay)} €/client·dia` : ""}</p>
      )}
      {o.surplus && o.surplus.mode !== "no_informada" && o.energyType !== "gas" && (
        <p className="mt-1 text-[12px] text-muted">Excedents: {o.surplus.eurKwh != null ? `${f6(o.surplus.eurKwh)} €/kWh (fix)` : o.surplus.formula ?? "indexat"}{o.surplus.limits ? ` · ${o.surplus.limits}` : ""}{o.surplus.notes ? ` · ${o.surplus.notes}` : ""}</p>
      )}
    </div>
  );
}
