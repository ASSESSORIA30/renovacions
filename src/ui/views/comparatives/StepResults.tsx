"use client";
/** Pas 4 · Comparativa: contracte actual + 3 alternatives, desglossament, P1–P6, gràfic i recomanació. */
import { MarketPanel } from "./MarketPanel";
import { CommercialPicker } from "./MarginSimulator";
import { SimulateDiscountsButton, simSourceFromOffer } from "./DiscountSimulator";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Bot, Loader2, Save, Sparkles } from "lucide-react";
import { buildSnapshot, presentationOrder, type Snapshot } from "@/comparator/snapshot";
import { periodsOf } from "@/comparator/engine";
import { ruleRecommendation } from "@/comparator/recommend";
import { comparisonsApi, serverMode } from "@/comparator/client";
import { discountKeys, type OfferAdjustment } from "@/comparator/catalog";
import { CONTRACT_TYPE_LABEL, POWER_UNIT_LABEL, SAS_LABEL, type CostResult, type OfferEvaluation } from "@/comparator/types";
import { useApp } from "@/data/store";
import { permanenceIssues, snapshotPermanenceLabel } from "@/comparator/permanence";
import { surplusKwh } from "@/comparator/engine";
import { surplusView } from "@/comparator/surplus-view";
import { Badge, Button, Notice, SupplierMark, cn } from "../../components/ui";
import { selectedOffers, useWizard, type WizardState } from "./state";

const up = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { maximumFractionDigits: 6 }));
const eur = (n: number | null | undefined) => (n == null ? "—" : (Object.is(n, -0) ? 0 : n).toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));
const COLORS = ["rgb(var(--muted))", "rgb(var(--brand))", "rgb(var(--cont))", "rgb(var(--pend))"];

export function payloadFrom(w: WizardState, issue = false) {
  return {
    id: w.savedId ?? undefined,
    mode: w.mode ?? "manual",
    contractId: w.contractId,
    crmClientId: w.crmClientId,
    crmSupplyId: w.crmSupplyId,
    crmOpportunityId: w.crmOpportunityId,
    cups: w.cups || null,
    client: { name: w.client.name, taxId: w.client.taxId, address: w.client.address, email: w.client.email, phone: w.client.phone },
    supply: w.supply,
    current: w.current,
    currentRetailer: w.currentRetailer || null,
    offers: selectedOffers(w),
    observations: w.observations || null,
    dataNotes: w.dataNotes,
    market: w.market,
    adjustments: w.adjustments,
    issue,
  };
}

/** Snapshot que es mostra: el desat al servidor si n'hi ha; si no, el calculat aquí amb el mateix motor. */
export function useSnapshot(): Snapshot {
  const w = useWizard();
  const issued = w.savedStatus === "emesa" || w.savedStatus === "enviada";
  // Emesa: sempre el resultat congelat del servidor. Esborrany: el mateix motor amb les dades actuals.
  return useMemo(() => (issued && w.savedSnapshot ? w.savedSnapshot : buildSnapshot({ ...payloadFrom(w), mode: w.mode ?? "manual" })), [w, issued]);
}

export async function saveDraft(issue = false) {
  const w = useWizard.getState();
  const r = await comparisonsApi.save(payloadFrom(w, issue));
  useWizard.getState().set({ savedId: r.comparison.id, savedStatus: r.comparison.status, savedSnapshot: r.comparison.snapshot });
  return r.comparison;
}

/**
 * Ajustos d'aquesta comparativa: activar/desactivar cada descompte de la tarifa i afegir o treure el SAS quan la tarifa
 * NO el porta inclòs (amb valor i justificació). No modifiquen la tarifa del catàleg; queden desats a la comparativa.
 */
function Adjustments() {
  const w = useWizard();
  const offers = selectedOffers(w);
  const setAdj = (id: string, a: OfferAdjustment) => w.set({ adjustments: { ...w.adjustments, [id]: a }, savedSnapshot: null });
  if (!offers.some((o) => discountKeys(o).length || o.sas.mode !== "inclos" || o.commercial)) return null;
  return (
    <div className="border-t border-line p-3" data-testid="ajustos-comparativa">
      <p className="text-[12.5px] font-semibold">Ajustos d&apos;aquesta comparativa</p>
      <p className="mb-2 text-[11.5px] text-muted">Només afecten aquesta comparativa i el seu PDF. La tarifa del catàleg no canvia.</p>
      <div className="grid gap-2 md:grid-cols-3">
        {offers.map((o) => {
          const a = w.adjustments[o.id] ?? {};
          const off = new Set(a.discountsOff ?? []);
          const keys = discountKeys(o);
          return (
            <div key={o.id} className="rounded-xl border border-line p-2.5 text-[12px]">
              <p className="mb-1 truncate font-medium">{o.supplierName} · {o.productName} <span className="text-muted">v{o.version}</span></p>
              {o.commercial && <div className="mb-1.5"><CommercialPicker offer={o} value={a.commercial} onChange={(c) => setAdj(o.id, { ...a, commercial: c })} /><p className="mt-0.5 text-[11px] text-muted">Preus publicats de la combinació triada (es recalcula a l&apos;instant).</p></div>}
              {keys.length === 0 ? <p className="text-muted">Sense descomptes</p> : keys.map((k) => (
                <label key={String(k.key)} className="flex items-start gap-1.5"><input type="checkbox" className="mt-0.5" checked={!off.has(k.key)} onChange={() => { const n = new Set(off); if (n.has(k.key)) n.delete(k.key); else n.add(k.key); setAdj(o.id, { ...a, discountsOff: [...n] }); }} /> {k.label}</label>
              ))}
              {o.sas.mode === "inclos" ? <p className="mt-1 text-muted">SAS inclòs al preu: no s&apos;afegeix de nou.</p> : (
                <div className="mt-1.5 space-y-1">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={a.sas ? a.sas.enabled : o.sas.mode === "variable"} onChange={(e) => setAdj(o.id, { ...a, sas: { enabled: e.target.checked, eurKwh: a.sas?.eurKwh ?? o.sas.eurKwh ?? null, justification: a.sas?.justification ?? "" } })} /> Aplica el SAS (a part del preu)</label>
                  {a.sas?.enabled && <>
                    <input className="input h-7 py-0 text-[12px]" placeholder="€/kWh (p. ex. 0,012)" defaultValue={a.sas.eurKwh ?? ""} onBlur={(e) => { const v = Number(e.target.value.replace(",", ".")); setAdj(o.id, { ...a, sas: { ...a.sas!, eurKwh: e.target.value.trim() && Number.isFinite(v) ? v : null } }); }} aria-label="Valor del SAS" />
                    <input className="input h-7 py-0 text-[12px]" placeholder="Justificació (font del valor)" defaultValue={a.sas.justification} onBlur={(e) => setAdj(o.id, { ...a, sas: { ...a.sas!, justification: e.target.value.trim() } })} aria-label="Justificació del SAS" />
                  </>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StepResults() {
  const w = useWizard();
  const s = useSnapshot();
  const toast = useApp((x) => x.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const alts = presentationOrder(s);
  const cur = s.result.current;
  const per = periodsOf(s.supply.accessTariff, s.supply.energyType);
  const reco = w.recommendation || ruleRecommendation(s, w.lang);
  const issued = w.savedStatus === "emesa" || w.savedStatus === "enviada";

  const hasSurplus = (surplusKwh(s.supply) ?? 0) > 0;
  const permIssues = issued ? [] : alts.flatMap((e) => permanenceIssues(e.offer).map((m) => `${e.offer.supplierName} · ${e.offer.productName}: ${m}`));
  const periodWord = s.supply.basis === "anual" || s.supply.basis === "anualitzat" ? "anual" : "del període";
  const chart = [{ name: s.currentRetailer ?? "Actual", v: cur?.ok ? cur.total : null }, ...alts.map((e) => ({ name: e.offer.supplierName, v: e.cost.ok ? e.cost.total : null }))];

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
  const ai = () =>
    run("Generant la recomanació…", async () => {
      if (!w.savedId) await saveDraft();
      const r = await comparisonsApi.action<{ recommendation: { ai: { sections: Record<string, string> } } }>({ action: "explain", id: useWizard.getState().savedId, lang: w.lang });
      const sx = r.recommendation.ai.sections;
      const text = [sx.principal, sx.justificacio, sx.riscos && `Riscos: ${sx.riscos}`, sx.revisar && `A revisar: ${sx.revisar}`].filter(Boolean).join("\n\n");
      w.set({ recommendation: text });
      toast({ title: "Recomanació generada", body: "Revisa-la abans d'enviar-la. Les xifres provenen del càlcul.", tone: "ok" });
    });

  return (
    <div className="space-y-4">
      {!cur && <Notice tone="blue">Sense preus actuals: es comparen les ofertes entre elles i no es mostra estalvi respecte del contracte vigent.</Notice>}
      {cur && !cur.ok && <Notice>El cost actual no es pot calcular. Falta: {cur.missing.join(", ")}.</Notice>}
      {permIssues.length > 0 && <Notice>Incidència de permanència: no es podrà emetre la proposta definitiva fins que es confirmi a la tarifa del catàleg. {permIssues.join(" · ")}</Notice>}
      {s.supply.basis !== "anual" && <Notice tone="blue">{s.supply.basis === "anualitzat" ? "Imports anualitzats a partir del període facturat (estimació)." : `Imports del període facturat (${s.supply.days} dies), no anuals.`}</Notice>}

      <div className="grid gap-3 lg:grid-cols-4">
        <Column title="Contracte actual" name={s.currentRetailer ?? "—"} sub={s.current ? CONTRACT_TYPE_LABEL[s.current.contractType] : "Sense preus"} cost={cur} highlight={false} />
        {alts.map((e, i) => (
          <Column key={e.offer.id} title={i === 0 && e.cost.ok && e.eligibility.eligible ? "Millor alternativa" : `${["Primera", "Segona", "Tercera"][i]} alternativa`} name={e.offer.supplierName} sub={e.offer.productName} cost={e.cost} ev={e} highlight={i === 0 && e.cost.ok} engine={s.engineVersion} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <section className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Concepte</th>
                <th className="px-3 py-2 text-right">Actual</th>
                {alts.map((e) => <th key={e.offer.id} className="px-3 py-2 text-right">{e.offer.supplierName}</th>)}
              </tr>
            </thead>
            <tbody className="tnum">
              {([
                ["Energia", (c: CostResult) => c.energy],
                ["Mecanisme d'ajust (SAS)", (c: CostResult) => c.sas],
                ["Potència", (c: CostResult) => c.power],
                ["Termes fixos, quotes i serveis", (c: CostResult) => c.fixed],
                ["Descomptes", (c: CostResult) => (c.discounts ? -c.discounts : 0)],
                ...(hasSurplus ? ([["Compensació d'excedents", (c: CostResult) => (c.surplus?.compensationEur ? -c.surplus.compensationEur : 0)]] as const) : []),
                ["Impost elèctric / hidrocarburs", (c: CostResult) => c.iee],
                ["Lloguer d'equips", (c: CostResult) => c.rent],
                ["Total sense impostos", (c: CostResult) => c.totalExTax],
                ["IVA / IGIC / IPSI", (c: CostResult) => c.vat],
                ["Total amb impostos", (c: CostResult) => c.total],
              ] as const).map(([label, f]) => (
                <tr key={label} className={cn("border-t border-line", label.startsWith("Total amb") && "bg-brand/[0.05] font-semibold")}>
                  <td className="px-3 py-1.5">{label}</td>
                  <td className="px-3 py-1.5 text-right">{cur?.ok ? eur(f(cur)) : "—"}</td>
                  {alts.map((e) => <td key={e.offer.id} className="px-3 py-1.5 text-right">{e.cost.ok ? eur(f(e.cost)) : "—"}</td>)}
                </tr>
              ))}
              <tr className="border-t border-line"><td className="px-3 py-1.5">Estalvi {periodWord}</td><td /> {alts.map((e) => <td key={e.offer.id} className={cn("px-3 py-1.5 text-right font-semibold", (e.saving ?? 0) > 0 ? "text-ren" : "text-lost")}>{e.saving == null ? "—" : <><span className="whitespace-nowrap">{eur(e.saving)}</span><br /><span className="whitespace-nowrap text-xs">{e.savingPct?.toLocaleString("ca-ES", { maximumFractionDigits: 1 })} %</span></>}</td>)}</tr>
              {Array.from({ length: per.energy }, (_, i) => (
                <tr key={`e${i}`} className="border-t border-line text-muted">
                  <td className="px-3 py-1.5">{per.energy === 1 ? "Preu energia €/kWh" : `Energia P${i + 1} €/kWh`}</td>
                  <td className="px-3 py-1.5 text-right">{s.current ? up(s.current.contractType === "fix24h" || per.energy === 1 ? s.current.energy24h : s.current.energy[i]) : "—"}</td>
                  {alts.map((e) => <td key={e.offer.id} className="px-3 py-1.5 text-right">{up(e.offer.contractType === "fix24h" || per.energy === 1 ? e.offer.energy24h : e.offer.contractType === "indexat" ? e.offer.indexedReference?.energy[i] : e.offer.energy[i])}</td>)}
                </tr>
              ))}
              {Array.from({ length: per.power }, (_, i) => (
                <tr key={`p${i}`} className="border-t border-line text-muted">
                  <td className="px-3 py-1.5">Potència P{i + 1}</td>
                  <td className="px-3 py-1.5 text-right">{s.current?.power[i] != null ? `${up(s.current.power[i])} ${POWER_UNIT_LABEL[s.current.powerUnit]}` : "—"}</td>
                  {alts.map((e) => <td key={e.offer.id} className="px-3 py-1.5 text-right">{e.offer.power[i] != null ? `${up(e.offer.power[i])} ${POWER_UNIT_LABEL[e.offer.powerUnit]}` : "—"}</td>)}
                </tr>
              ))}
              <tr className="border-t border-line"><td className="px-3 py-1.5">SAS</td><td className="px-3 py-1.5 text-right">{s.current ? SAS_LABEL[s.current.sas.mode] : "—"}</td>{alts.map((e) => <td key={e.offer.id} className="px-3 py-1.5 text-right">{SAS_LABEL[e.offer.sas.mode]}</td>)}</tr>
              {alts.some((e) => simSourceFromOffer(e.offer)) && <tr className="border-t border-line"><td className="px-3 py-1.5">Descomptes del document</td><td />{alts.map((e) => { const src = simSourceFromOffer(e.offer, { kwh: s.supply.kwh, kw: s.supply.kw }); return <td key={e.offer.id} className="px-3 py-1.5 text-right">{src ? <SimulateDiscountsButton source={src} /> : "—"}</td>; })}</tr>}
              <tr className="border-t border-line"><td className="px-3 py-1.5">Permanència</td><td />{alts.map((e) => <td key={e.offer.id} className={cn("px-3 py-1.5 text-right", permanenceIssues(e.offer).length > 0 && "text-amber-700 dark:text-amber-300")}>{snapshotPermanenceLabel(e.offer, s.engineVersion).replace(/^Permanència: /, "")}</td>)}</tr>
              <tr className="border-t border-line"><td className="px-3 py-1.5">Vigència</td><td />{alts.map((e) => <td key={e.offer.id} className="px-3 py-1.5 text-right">{e.offer.validTo ? new Date(e.offer.validTo).toLocaleDateString("ca-ES") : "—"}</td>)}</tr>
            </tbody>
          </table>
          {hasSurplus && <SurplusTable s={s} />}
          {!issued && <Adjustments />}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-2 text-[14px] font-semibold">Cost amb impostos</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="rgb(var(--line))" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} tickFormatter={(v) => `${Math.round(Number(v) / 100) / 10}k €`} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "rgb(var(--ink))" }} />
                <Tooltip formatter={(v) => eur(Number(v))} contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="v" name="Cost amb impostos" radius={[0, 6, 6, 0]}>{chart.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <MarketPanel analysis={s.marketAnalysis} periods={per.energy} indexedSelected={s.offers.some((o) => o.contractType === "indexat" || o.contractType === "mixt")} readOnly={issued} />

      <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><Sparkles size={15} className="text-brand" /> Recomanació</h3>
          <div className="flex gap-2">
            {serverMode() && <Button size="sm" disabled={!!busy || issued} onClick={ai}><Bot size={14} /> Redacta amb IA</Button>}
            {w.savedId && !issued && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("Desant…", async () => { await comparisonsApi.action({ action: "recommendation", id: w.savedId, text: reco }); toast({ title: "Recomanació desada", body: "El canvi queda registrat a l'historial.", tone: "ok" }); })}>Desa el text</Button>}
          </div>
        </div>
        <textarea className="input min-h-[120px]" value={reco} disabled={issued} onChange={(e) => w.set({ recommendation: e.target.value })} aria-label="Text de la recomanació" />
        <p className="text-[11px] text-muted">Text base generat a partir del càlcul. La IA només redacta amb els resultats validats (sense dades personals) i no modifica cap xifra. Les edicions queden registrades. El rànquing no té en compte cap comissió.</p>
      </section>

      {busy && <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> {busy}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={() => w.set({ step: 3 })}>Enrere</Button>
        <div className="flex gap-2">
          {serverMode() && !issued && <Button disabled={!!busy} onClick={() => run("Desant l'esborrany…", async () => { await saveDraft(); toast({ title: "Esborrany desat", tone: "ok" }); })}><Save size={14} /> Desa l&apos;esborrany</Button>}
          <Button variant="primary" onClick={() => w.set({ step: 5, recommendation: reco })}>Continua: PDF i enviament</Button>
        </div>
      </div>
    </div>
  );
}

function Column({ title, name, sub, cost, ev, highlight, engine = "1.1.0" }: { title: string; name: string; sub: string; cost: CostResult | null; ev?: OfferEvaluation; highlight: boolean; engine?: string }) {
  return (
    <div className={cn("rounded-2xl border bg-surface p-4 shadow-card", highlight ? "border-brand ring-2 ring-brand/15" : "border-line")}>
      <p className={cn("text-[11px] font-semibold uppercase tracking-wide", highlight ? "text-brand" : "text-muted")}>{title}</p>
      <div className="mt-2 flex items-center gap-2">
        <SupplierMark name={name} size={26} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-[12px] text-muted">{sub}</p>
        </div>
      </div>
      <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight tnum">{cost?.ok ? eur(cost.total) : "—"}</p>
      <p className="mt-1 text-[11.5px] text-muted">{cost?.ok ? `${eur(cost.totalExTax)} sense impostos` : cost ? `Falta: ${cost.missing.slice(0, 2).join(", ")}` : "Sense preus actuals"}</p>
      {ev?.saving != null && <p className={cn("mt-2 text-[13px] font-semibold", ev.saving > 0 ? "text-ren" : "text-lost")}>{ev.saving > 0 ? "Estalvi" : "Més car"} {eur(Math.abs(ev.saving))} · {Math.abs(ev.savingPct ?? 0).toLocaleString("ca-ES", { maximumFractionDigits: 1 })} %</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {cost?.quality === "estimat" && <Badge tone="amber">Estimat</Badge>}
        {cost && !cost.ok && <Badge tone="red"><AlertTriangle size={11} /> Dades incompletes</Badge>}
        {ev && !ev.eligibility.eligible && <Badge tone="red">No elegible</Badge>}
        {ev?.tags.map((t) => <Badge key={t} tone="green">{t}</Badge>)}
      </div>
      {ev && <p className="mt-2 text-[11px] text-muted">{SAS_LABEL[ev.offer.sas.mode]} · {snapshotPermanenceLabel(ev.offer, engine)}</p>}
    </div>
  );
}

/** Excedents fotovoltaics: només es mostra quan el subministrament té excedents. Mateixa taula que el PDF (surplusView). */
function SurplusTable({ s }: { s: Snapshot }) {
  const v = surplusView(s, "ca");
  if (!v) return null;
  return (
    <div className="border-t border-line p-3" data-testid="taula-excedents">
      <h4 className="mb-1 text-[13px] font-semibold">{v.title}</h4>
      {v.balance && <p className="mb-1 text-[11.5px] text-muted">{v.balance} (el saldo acumulat no és el mateix que l&apos;import aplicat a la factura).</p>}
      <table className="w-full text-[12px] tnum">
        <thead className="text-[11px] text-muted"><tr><th /> {v.columns.map((c, i) => <th key={i} className="px-2 py-1 text-right">{c}</th>)}</tr></thead>
        <tbody>
          {v.rows.map((r) => (
            <tr key={r.label} className="border-t border-line">
              <td className="px-2 py-1">{r.label}</td>
              {r.cells.map((c, i) => <td key={i} className="px-2 py-1 text-right">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {v.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-[11px] text-muted">{v.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </div>
  );
}
