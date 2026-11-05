"use client";
/** Pas 3 · Selecció de fins a tres ofertes del catàleg (elegibles primer, amb motius d'exclusió). */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { runComparison } from "@/comparator/ranking";
import { loadCatalog, serverMode, type CatalogItem } from "@/comparator/client";
import { normalizeTariff } from "@/comparator/engine";
import { selectableForNew } from "@/comparator/catalog";
import { CONTRACT_TYPE_LABEL, POWER_UNIT_LABEL } from "@/comparator/types";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { Badge, Button, Empty, Notice, SupplierMark, cn } from "../../components/ui";
import { useWizard } from "./state";
import { applyOfferFilters } from "@/comparator/filters";
import { OfferFilterBar, useOfferFilters } from "./OfferFilters";

const eur = (n: number) => n.toLocaleString("ca-ES", { style: "currency", currency: "EUR" });

/** Es pot proposar en una comparativa nova (catàleg: activa, vigent i completa). */
const pickable = (o: Parameters<typeof selectableForNew>[0]) => selectableForNew(o, undefined, { demo: !serverMode() }).ok;

export function StepSelect() {
  const w = useWizard();
  const staff = useApp((s) => !!s.snap && isStaff(s.snap.me.role));
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [f, setF] = useOfferFilters("seleccio");
  useEffect(() => {
    loadCatalog().then((r) => { setItems(r.items); useWizard.getState().set({ catalog: r.items }); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const { supply, current } = w;
  const run = useMemo(() => (items ? runComparison({ supply, current, offers: items }) : null), [items, supply, current]);
  const rows = useMemo(() => {
    if (!run) return [];
    const t = normalizeTariff(w.supply.accessTariff);
    const keep = new Set(applyOfferFilters(run.evaluations.map((e) => e.offer), showAll ? f : { ...f, tariff: "", energyType: "" }).map((o) => o.id));
    return run.evaluations
      .filter((e) => keep.has(e.offer.id))
      // per defecte només les tarifes que es poden proposar (actives, vigents i completes) i compatibles
      .filter((e) => showAll || (pickable(e.offer) && e.offer.energyType === w.supply.energyType && normalizeTariff(e.offer.accessTariff) === t))
      .sort((a, b) => Number(b.eligibility.eligible && b.cost.ok) - Number(a.eligibility.eligible && a.cost.ok) || (a.cost.ok ? a.cost.total : 1e12) - (b.cost.ok ? b.cost.total : 1e12));
  }, [run, showAll, f, w.supply.energyType, w.supply.accessTariff]);
  const compatible = useMemo(() => {
    const t = normalizeTariff(w.supply.accessTariff);
    return (items ?? []).filter((o) => showAll || (pickable(o) && o.energyType === w.supply.energyType && normalizeTariff(o.accessTariff) === t));
  }, [items, showAll, w.supply.energyType, w.supply.accessTariff]);

  const toggle = (id: string) => w.set({ selected: w.selected.includes(id) ? w.selected.filter((x) => x !== id) : w.selected.length >= 3 ? w.selected : [...w.selected, id], savedSnapshot: null });
  const visible = new Set(rows.map((e) => e.offer.id));
  const auto = () => w.set({ selected: (run?.ranked ?? []).filter((e) => visible.has(e.offer.id) && pickable(e.offer)).slice(0, 3).map((e) => e.offer.id), savedSnapshot: null });

  if (error) return <Notice tone="red">No s&apos;ha pogut carregar el catàleg: {error}</Notice>;
  if (!items) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" /> Carregant el catàleg de tarifes…</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {rows.filter((e) => e.eligibility.eligible && e.cost.ok).length} ofertes elegibles i calculables per a {w.supply.accessTariff}. Seleccionades: <b className="text-ink">{w.selected.length}/3</b>
        </p>
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Mostra també les incompatibles, caducades o arxivades (no seleccionables)</label>
          <Button size="sm" onClick={auto} disabled={!run?.ranked.some((e) => visible.has(e.offer.id))}><Sparkles size={14} /> Tria les 3 millors</Button>
        </div>
      </div>
      {compatible.length > 0 && <OfferFilterBar items={compatible} value={f} onChange={setF} hide={showAll ? ["status", "sort"] : ["status", "sort", "tariff", "energyType"]} shown={rows.length} />}
      {rows.length === 0 && compatible.length > 0 ? (
        <Empty icon={<Sparkles size={22} />} title="Cap oferta amb aquests filtres" body="Canvia o neteja els filtres per veure'n més." />
      ) : rows.length === 0 ? (
        <Empty icon={<Sparkles size={22} />} title={`El Catàleg de tarifes no té cap tarifa vigent i compatible per a ${w.supply.energyType === "gas" ? "gas" : "electricitat"} ${w.supply.accessTariff}`} body="Les comparatives només fan servir el Catàleg de tarifes (no es fan servir ofertes antigues com a alternativa). Dona d'alta o activa tarifes al catàleg (manual, Excel, lector IA o API)." action={staff ? <Button variant="primary" size="sm" onClick={() => useApp.getState().navigate("tarifes")}>Obre el catàleg</Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 text-left">Oferta</th>
                <th className="px-3 py-2 text-left">Tipus</th>
                <th className="px-3 py-2 text-left">Preus</th>
                <th className="px-3 py-2 text-right">Cost amb impostos</th>
                <th className="px-3 py-2 text-right">Estalvi</th>
                <th className="px-3 py-2 text-left">Estat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const ok = e.eligibility.eligible && e.cost.ok;
                const on = w.selected.includes(e.offer.id);
                return (
                  <tr key={e.offer.id} className={cn("border-t border-line", on && "bg-brand/[0.05]", !e.eligibility.eligible && "opacity-60")}>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Selecciona ${e.offer.productName}`} checked={on} disabled={!e.eligibility.eligible || !e.cost.ok || !pickable(e.offer) || (!on && w.selected.length >= 3)} onChange={() => toggle(e.offer.id)} /></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <SupplierMark name={e.offer.supplierName} size={22} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{e.offer.supplierName} · {e.offer.productName}</p>
                          <p className="text-[11px] text-muted">v{e.offer.version} · {e.offer.origin === "crm" ? "Oferta de demostració" : e.offer.source ?? "Catàleg de tarifes"}{e.offer.validTo ? ` · fins al ${new Date(e.offer.validTo).toLocaleDateString("ca-ES")}` : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{CONTRACT_TYPE_LABEL[e.offer.contractType]}{e.offer.permanenceMonths ? ` · ${e.offer.permanenceMonths} m perm.` : ""}</td>
                    <td className="px-3 py-2 text-[11.5px] text-muted tnum">
                      {e.offer.energy24h != null ? `${e.offer.energy24h} €/kWh` : e.offer.energy.filter((x) => x != null).join(" / ") + " €/kWh"}
                      {e.offer.power.some((x) => x != null) && <><br />{e.offer.power.filter((x) => x != null).join(" / ")} {POWER_UNIT_LABEL[e.offer.powerUnit]}</>}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tnum">{e.cost.ok ? eur(e.cost.total) : "—"}{e.cost.quality === "estimat" && <span className="ml-1 text-[10px] text-pend">est.</span>}</td>
                    <td className={cn("px-3 py-2 text-right tnum", (e.saving ?? 0) > 0 ? "text-ren" : "text-lost")}>{e.saving == null ? "—" : `${eur(e.saving)} (${e.savingPct?.toLocaleString("ca-ES", { maximumFractionDigits: 1 })} %)`}</td>
                    <td className="px-3 py-2">
                      {ok ? (
                        <div className="flex flex-wrap gap-1">{e.tags.map((t) => <Badge key={t} tone="green">{t}</Badge>)}{!e.tags.length && <Badge tone="zinc">Elegible</Badge>}</div>
                      ) : !e.eligibility.eligible ? (
                        <span className="text-[11px] text-lost">{e.eligibility.reasons.join(" · ")}</span>
                      ) : (
                        <span className="text-[11px] text-pend" title={e.cost.missing.join(", ")}>Falten dades: {e.cost.missing.slice(0, 2).join(", ")}{e.cost.missing.length > 2 ? "…" : ""}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => w.set({ step: 2 })}>Enrere</Button>
        <Button variant="primary" disabled={!w.selected.length} onClick={() => w.set({ step: 4 })}>Veure la comparativa</Button>
      </div>
    </div>
  );
}

