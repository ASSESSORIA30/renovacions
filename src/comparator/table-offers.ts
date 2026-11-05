/**
 * Lectura de taula (Fase 12) → versions del catàleg de tarifes. Sempre ESBORRANY.
 *  · Preus d'energia i potència FINALS (descompte base de la columna de condicions ja aplicat, una sola vegada);
 *    els originals i el text del descompte viatgen amb l'oferta per al simulador.
 *  · Indexades (Plan OMIE): mai es posa el marge com a preu. Es crea la fórmula amb el marge (€/MWh) i la resta de
 *    components queden buits → el comparador la marca INCOMPLETA fins que s'hi afegeix la fórmula contractual.
 *  · Productes amb horari promocionat: l'horari contractual viatja a `open` (càlcul hora a hora amb corba horària).
 *  · Cada oferta conserva l'arxiu, la pestanya, la fila i les cel·les d'origen.
 */
import { slug } from "./catalog";
import { normalizeOfferUnits } from "./units";
import { emptyFormula } from "./market";
import { CLASSIFICATION_LABEL, type Product, type ReadResult, type TemplateDef } from "./xlsx-template";
import { INTERP_LABEL } from "./tariff-table";
import { applyPct } from "./tariff-discounts";
import { emptySheet, type OfferVersion } from "./types";

const f6 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { minimumFractionDigits: 6, maximumFractionDigits: 6 }));

export function tableProductsToOffers(read: ReadResult, def: TemplateDef, meta: { templateId: string | null; version: number; fileName: string; today?: string }): { offer: OfferVersion; product: Product; warnings: string[] }[] {
  const out: { offer: OfferVersion; product: Product; warnings: string[] }[] = [];
  for (const p of read.products) {
    const it = p.interp;
    if (!it || it.status === "fallida") continue;
    const w = [...it.reasons];
    const gas = p.energyType === "gas";
    const idx = it.classification === "indexada";
    const single = !idx && !gas && it.priceCount === 1 && !it.estimate && !it.manual;
    const periods = it.periods;
    const energy = idx || gas || single ? Array(6).fill(null) : Array.from({ length: 6 }, (_, i) => (i < periods ? it.energyFinal[i] ?? null : null));
    const cells = [...p.power, ...p.energy, ...(p.fixedTerm ? [p.fixedTerm] : [])].filter((x) => x.v != null).map((x) => x.cell.replace(/^.*!/, ""));
    const sched = it.schedule;
    const open = sched && !idx && periods === 6
      ? {
        supplier: def.supplier.slice(0, 80), product: p.name.slice(0, 80), modality: "dia" as const, docVersion: read.validity.from,
        openPrice: it.source.find((s) => s.letter === sched.promoted)?.v ?? 0, noOpenPrice: it.source.find((s) => s.letter === sched.notPromoted)?.v ?? 0,
        bracket: { label: p.block.slice(0, 60) || "—", minKw: null, maxKw: null },
        rule: { mode: "horari" as const, windows: sched.windows },
        ruleSource: "direccio" as const, approved: it.rules.every((r) => r.approved),
        reference: it.estimate?.reference ?? { from: "", to: "" },
        periods: it.estimate?.periods ?? [],
        estimated: true as const, label: p.name.slice(0, 120), kind: it.estimate ? ("ponderada" as const) : ("comercial" as const),
      }
      : null;
    // el motor aplica els preus de l'oferta tal com són: el descompte d'energia ja hi és; els preus open també han de ser finals
    if (open) { open.openPrice = applyPct(open.openPrice, it.energyPct) ?? 0; open.noOpenPrice = applyPct(open.noOpenPrice, it.energyPct) ?? 0; }
    const dur = (it.extra["Durada"] ?? "").match(/^\s*(\d+)\s*m\s*$/i);
    const offer: OfferVersion = {
      ...emptySheet(),
      id: crypto.randomUUID(),
      supplierId: `sup:${slug(def.supplier)}`,
      supplierName: def.supplier,
      productId: "",
      productName: p.name.slice(0, 160),
      version: 1,
      energyType: gas ? "gas" : "luz",
      accessTariff: p.tariff ?? p.tariffRaw ?? "",
      segments: ["pyme"],
      contractType: idx ? "indexat" : gas || single ? "fix24h" : "periodes",
      energy,
      energy24h: !idx && (gas || single) ? it.energyFinal.find((x) => x != null) ?? null : null,
      power: gas ? Array(6).fill(null) : Array.from({ length: 6 }, (_, i) => it.powerFinal[i] ?? null),
      powerUnit: it.powerUnit ?? "eur_kw_any",
      // gas: el terme fix només s'usa si algú n'ha confirmat la unitat (l'Excel no la indica)
      gasFixedEurDay: gas && it.gasFixedUnit && it.powerFinal[0] != null ? Number((it.powerFinal[0] / (it.gasFixedUnit === "eur_any" ? 365 : it.gasFixedUnit === "eur_mes" ? 365 / 12 : 1)).toFixed(6)) : null,
      taxTreatment: "sense_impostos",
      sas: { mode: "inclos", eurKwh: null },
      fees: [], discounts: [],
      permanenceMonths: null, penalty: null, durationMonths: dur ? Number(dur[1]) : null, priceGuaranteeMonths: null,
      eligibility: { minKwh: null, maxKwh: null, minKw: it.eligibility.minKw, maxKw: it.eligibility.maxKw, territories: null, notes: it.section },
      validFrom: read.validity.from, validTo: read.validity.logEntry && /^\d{4}-\d{2}-\d{2}$/.test(read.validity.logEntry) ? read.validity.logEntry : null,
      source: `Plantilla «${def.name}» v${meta.version} · ${meta.fileName.slice(0, 120)} · ${read.sheet} fila ${p.row}`.slice(0, 300),
      publishedAt: meta.today ?? new Date().toISOString().slice(0, 10),
      status: "esborrany",
      formula: idx ? { ...emptyFormula(), index: "OMIE", marginEurMWh: it.margin?.eurMWh ?? null, contractText: it.margin ? `Marge ${def.supplier}: ${it.margin.eurKwh} €/kWh = ${it.margin.eurMWh} €/MWh (${it.margin.cell}). Fórmula contractual completa pendent de documentació.` : null } : null,
      open,
      conditions: [
        `Tipus: ${CLASSIFICATION_LABEL[it.classification]} · estat de la lectura: ${INTERP_LABEL[it.status]}.`,
        idx ? `Marge indexat: ${f6(it.margin?.eurKwh)} €/kWh (${it.margin?.eurMWh ?? "—"} €/MWh). NO és un preu final.` : `Energia original: ${it.source.map((s) => `${s.header.split(" · ").slice(-2).join(" ")} ${f6(s.v)}`).join(" · ")} €/kWh.`,
        !idx ? `Energia final P1–P${periods}: ${it.energyFinal.slice(0, periods).map(f6).join(" · ")} €/kWh${it.estimate ? " (PREU ESTIMAT PER PONDERACIÓ HORÀRIA)" : ""}.` : null,
        p.discountLabel ? `Condicions / descompte (document): ${p.discountLabel}. Aplicat: ${it.energyPct ? `${it.energyPct} % energia` : "cap sobre energia"}${it.powerPct ? ` · ${it.powerPct} % potència` : ""}. Els descomptes condicionats NO s'han aplicat.` : null,
        it.energyPctYear2 != null ? `2n any: ${it.energyPctYear2} % sobre energia → ${it.energyFinalYear2?.slice(0, periods).map(f6).join(" · ")} €/kWh.` : null,
        gas && p.fixedTerm?.v != null ? `Terme fix (${p.fixedTerm.cell.replace(/^.*!/, "")}): ${p.fixedTerm.v} · final ${it.powerFinal[0] ?? "—"} (unitat per confirmar: no es fa servir al càlcul fins que es confirmi).` : null,
        sched ? `Horari promocionat contractual: ${sched.text}.` : null,
        `Regles aplicades: ${it.rules.map((r) => r.title).join(" · ") || "cap"}.`,
        `Origen: ${meta.fileName} · ${read.sheet} · fila ${p.row} · cel·les ${cells.join(", ")}.`,
        ...w.map((x) => `Avís: ${x}`),
      ].filter(Boolean).join("\n").slice(0, 4000),
      origin: "excel",
      template: {
        templateId: meta.templateId, name: def.name.slice(0, 120), version: meta.version, classification: it.classification, variant: null, code: null,
        origin: { file: meta.fileName.slice(0, 300), sheet: read.sheet, row: p.row, cells: cells.slice(0, 40) },
        original: { energy: Array.from({ length: 6 }, (_, i) => it.energyOriginal[i] ?? null), power: gas ? Array(6).fill(null) : Array.from({ length: 6 }, (_, i) => it.powerOriginal[i] ?? null), powerUnit: it.powerUnit },
        discountText: p.discountLabel?.slice(0, 500) ?? null, interpStatus: it.status, rules: it.rules.map((r) => r.title.slice(0, 160)).slice(0, 20),
      },
    };
    // Potència en €/kW·any o €/kW·mes → €/kW·dia per període (conserva l'original a `units`; mai dues conversions)
    const n = normalizeOfferUnits(offer);
    w.push(...n.problems);
    out.push({ offer: n.offer, product: p, warnings: w });
  }
  return out;
}
