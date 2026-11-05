"use client";
/** CATÀLEG DE TARIFES (equip d'administració): manual, importació Excel/CSV i connectors API autoritzats. */
import { INDEXES, emptyFormula, formulaMissing, type IndexedFormula } from "@/comparator/market";
import { SimulateDiscountsButton, simSourceFromOffer } from "./DiscountSimulator";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Archive, Calculator, CheckCircle2, Copy, FileSpreadsheet, Loader2, Pencil, Plug, Plus, RefreshCw, Sparkles, Upload } from "lucide-react";
import { legacyApi, loadCatalog, serverMode, tariffsApi, type CatalogItem } from "@/comparator/client";
import { LEGACY_LABEL, checkVersion, fromCrmOffer, newVersionFrom, priceChanged, productKey, type LegacyClass, type LegacyRow } from "@/comparator/catalog";
import { parseOffersTemplate } from "@/core/offersTemplate";
import { autoMap, detectHeaderRow, IMPORT_FIELDS, parseCsv, previewImport, type Cell, type ImportField, type ImportPreview, type Mapping } from "@/comparator/tariff-import";
import { ENERGY_INPUT_UNITS, GAS_FIXED_INPUT_UNITS, fromInternal, normalizeOfferUnits, toInternal } from "@/comparator/units";
import { CONTRACT_TYPE_LABEL, CONTRACT_TYPES, POWER_UNIT_LABEL, SAS_LABEL, SAS_MODES, SEGMENTS, emptySheet, type ContractType, type OfferVersion, type PowerUnit, type SasMode, type Segment, type TariffStatus } from "@/comparator/types";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { Badge, Button, Empty, Modal, Notice, SupplierMark, Tabs, cn } from "../../components/ui";
import { applyOfferFilters } from "@/comparator/filters";
import { finalPrices } from "@/comparator/final-prices";
import { OfferFilterBar, useOfferFilters } from "./OfferFilters";
import { TariffAiReader } from "./TariffAiReader";
import { MarginSimulator } from "./MarginSimulator";
import { DropZone, DropArea } from "../../components/DropZone";
import { ExportButton } from "../../components/ExportButton";
import { PermanenceEditor, PermanenceRuleCard, SurplusEditor, usePermanenceRule } from "./CatalogSurplus";
import { permanenceIssues } from "@/comparator/permanence";

const STATUS_TONE: Record<TariffStatus, "green" | "zinc" | "amber" | "red"> = { activa: "green", esborrany: "zinc", caducada: "amber", arxivada: "red" };
const TARIFFS = ["2.0TD", "3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD", ...Array.from({ length: 11 }, (_, i) => `RL.${i + 1}`)];

export function blankOffer(): OfferVersion {
  return {
    ...emptySheet(),
    id: "",
    supplierId: "",
    supplierName: "",
    productId: "",
    productName: "",
    version: 1,
    energyType: "luz",
    accessTariff: "2.0TD",
    segments: ["residencial", "pyme"],
    permanenceMonths: null,
    penalty: null,
    durationMonths: 12,
    priceGuaranteeMonths: 12,
    eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: null,
    source: null,
    publishedAt: new Date().toISOString().slice(0, 10),
    status: "esborrany",
    conditions: null,
    origin: "manual",
  };
}

export function TariffCatalogView() {
  const staff = useApp((s) => !!s.snap && isStaff(s.snap.me.role));
  const initialTab = useApp((s) => s.params.tab);
  const [tab, setTab] = useState<"tarifes" | "ia" | "importar" | "connectors" | "propostes">(initialTab === "propostes" ? "propostes" : "tarifes");
  const [reload, setReload] = useState(0);
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div>
        <div className="float-right"><ExportButton set="tarifes" /></div>
        <h2 className="text-xl font-semibold tracking-tight">Catàleg de tarifes</h2>
        <p className="text-[13px] text-muted">Comercialitzadores, productes i versions de preus. Cada canvi crea una versió nova; les usades en propostes emeses són immutables.</p>
      </div>
      {!staff && <Notice tone="blue">Només l&apos;equip d&apos;administració pot modificar el catàleg. Pots consultar les tarifes actives.</Notice>}
      {!serverMode() && <Notice tone="blue">Mode local: només es mostren les ofertes verificades del CRM (lectura).</Notice>}
      <Tabs value={tab} onChange={setTab} items={[{ id: "tarifes", label: "Tarifes" }, ...(staff && serverMode() ? [{ id: "ia" as const, label: "Llegir fitxer de tarifes (IA · Tarifa Open)" }, { id: "importar" as const, label: "Importar Excel / CSV (columnes)" }, { id: "connectors" as const, label: "Connectors API" }, { id: "propostes" as const, label: "Migració de «Propostes»" }] : [])]} />
      {tab === "tarifes" && staff && <PermanenceRuleCard />}
      {tab === "tarifes" && <Tariffs key={reload} staff={staff && serverMode()} onRead={staff && serverMode() ? () => setTab("ia") : undefined} />}
      {tab === "ia" && <TariffAiReader Editor={TariffEditor} onDone={() => setReload((r) => r + 1)} />}
      {tab === "importar" && <ImportWizard />}
      {tab === "connectors" && <Connectors />}
      {tab === "propostes" && <LegacyMigration onDone={() => setReload((r) => r + 1)} />}
    </div>
  );
}

function Tariffs({ staff, onRead }: { staff: boolean; onRead?: () => void }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [all, setAll] = useState(false);
  const [f, setF] = useOfferFilters("cataleg");
  const [edit, setEdit] = useState<OfferVersion | null>(null);
  const [sim, setSim] = useState<OfferVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useApp((s) => s.toast);
  const load = () => loadCatalog(all).then((r) => { setItems(r.items); if (!r.migrated && serverMode()) setError("Falta executar la migració 006_comparatives_ia.sql: es mostren només les ofertes del CRM."); }).catch((e) => setError(String(e)));
  useEffect(() => { void load(); }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => applyOfferFilters(items ?? [], f), [items, f]);
  const status = async (o: CatalogItem, s: TariffStatus) => {
    try {
      await tariffsApi.status(o.id, s);
      toast({ title: s === "activa" ? "Tarifa activada" : "Estat actualitzat", tone: "ok" });
      void load();
    } catch (e) {
      toast({ title: "No s'ha pogut canviar l'estat", body: e instanceof Error ? e.message : String(e), tone: "err" });
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Totes les versions</label>
        <div className="ml-auto flex gap-2">
          {onRead && <Button onClick={onRead}><Sparkles size={15} /> Llegeix un fitxer amb IA</Button>}
          {staff && <Button variant="primary" onClick={() => setEdit(blankOffer())}><Plus size={15} /> Nova tarifa</Button>}
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {items && items.length > 0 && <OfferFilterBar items={items} value={f} onChange={setF} shown={shown.length} />}
      {!items ? <Loader2 className="animate-spin text-muted" /> : items.length === 0 ? <Empty icon={<FileSpreadsheet size={22} />} title="El catàleg és buit" body="Dona d'alta tarifes manualment, puja el fitxer de la comercialitzadora o connecta una API autoritzada." /> : shown.length === 0 ? <Empty icon={<FileSpreadsheet size={22} />} title="Cap oferta amb aquests filtres" body="Canvia o neteja els filtres per veure-les." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[960px] text-[12.5px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-2 text-left">Oferta</th><th className="px-3 py-2 text-left">Peatge</th><th className="px-3 py-2 text-left">Tipus</th><th className="px-3 py-2 text-left">Energia €/kWh (preu final)</th><th className="px-3 py-2 text-left">Potència</th><th className="px-3 py-2 text-left">Vigència</th><th className="px-3 py-2 text-left">Estat</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><SupplierMark name={o.supplierName} size={22} /><div><p className="font-medium">{o.supplierName} · {o.productName}</p><p className="text-[11px] text-muted">v{o.version} · {o.origin === "crm" ? "Ofertes del CRM" : o.origin}{o.usedAt ? " · usada en propostes" : ""}{o.createdByName ? ` · ${o.createdByName}` : ""}</p></div></div></td>
                  <td className="px-3 py-2">{o.accessTariff}</td>
                  <td className="px-3 py-2">{CONTRACT_TYPE_LABEL[o.contractType]}</td>
                  <PriceCells o={o} />
                  <td className="px-3 py-2 text-muted">{o.validFrom ?? "—"} → {o.validTo ?? "—"}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {(() => { const src = simSourceFromOffer(o); return src ? <SimulateDiscountsButton source={src} /> : null; })()}
                    {o.commercial && o.commercial.margins.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSim(o)}><Calculator size={13} /> Marges</Button>}
                    {staff && o.origin === "crm" && <Button size="sm" variant="ghost" onClick={() => setEdit({ ...o, id: "", origin: "manual", status: "esborrany", source: "Copiada de les ofertes del CRM" })}><Copy size={13} /> Copia al catàleg</Button>}
                    {staff && o.origin !== "crm" && (
                      <>
                        {o.status === "esborrany" && !o.usedAt ? <Button size="sm" variant="ghost" onClick={() => setEdit(o)}><Pencil size={13} /> Edita</Button> : <Button size="sm" variant="ghost" onClick={() => setEdit(newVersionFrom(o))}><Copy size={13} /> Nova versió</Button>}
                        {o.status !== "activa" && <Button size="sm" variant="ghost" onClick={() => status(o, "activa")}><CheckCircle2 size={13} /> Activa</Button>}
                        {o.status !== "arxivada" && <Button size="sm" variant="ghost" onClick={() => status(o, "arxivada")}><Archive size={13} /></Button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <TariffEditor offer={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
      {sim && <Modal open onClose={() => setSim(null)} width="max-w-6xl" title={`Simulador de marges · ${sim.supplierName} · ${sim.productName} (v${sim.version})`}><MarginSimulator offer={sim} /></Modal>}
    </div>
  );
}

const join = (a: (number | null)[]) => a.filter((x) => x != null).join(" / ");
const pctTxt = (p: number) => `−${p.toLocaleString("ca-ES", { maximumFractionDigits: 2 })} %`;
/** Cel·les d'energia i potència del catàleg: preu FINAL amb el descompte base aplicat i, a sota, l'original. */
export function PriceCells({ o }: { o: OfferVersion }) {
  const fp = finalPrices(o);
  const e = fp.energy24h ?? join(fp.energy);
  const eo = fp.original ? fp.original.energy24h ?? join(fp.original.energy) : null;
  const p = fp.power.some((x) => x != null) ? `${join(fp.power)} ${POWER_UNIT_LABEL[o.powerUnit]}` : o.gasFixedEurDay != null ? `${o.gasFixedEurDay} €/client·dia` : "—";
  const po = fp.original && fp.powerPct ? join(fp.original.power) : null;
  return (
    <>
      <td className="px-3 py-2 tnum" data-testid="preu-final-energia" title={fp.label ? `Descompte: ${fp.label}${fp.notes.length ? ` · ${fp.notes.join(" · ")}` : ""}` : fp.notes.join(" · ") || undefined}>
        <span className={fp.energyPct ? "font-medium" : "text-muted"}>{e === "" ? "—" : e}</span>
        {fp.energyPct > 0 && eo !== "" && <p className="text-[11px] text-muted">sense dte. <s>{eo}</s> <Badge tone="green">{pctTxt(fp.energyPct)}</Badge></p>}
        {fp.notes.length > 0 && !fp.energyPct && <p className="text-[11px] text-pend">dte. al total, no per kWh</p>}
      </td>
      <td className="px-3 py-2 tnum">
        <span className={fp.powerPct ? "font-medium" : "text-muted"}>{p}</span>
        {po && <p className="text-[11px] text-muted">sense dte. <s>{po}</s> <Badge tone="green">{pctTxt(fp.powerPct)}</Badge></p>}
      </td>
    </>
  );
}

const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
export function TariffEditor({ offer, onClose, onSaved, onApply }: { offer: OfferVersion; onClose: () => void; onSaved: () => void; onApply?: (o: OfferVersion) => void }) {
  const [o, setO] = useState<OfferVersion>(offer);
  const [busy, setBusy] = useState(false);
  const toast = useApp((s) => s.toast);
  const check = checkVersion({ ...o, id: o.id || "new", supplierId: o.supplierId || "x", productId: o.productId || "x" });
  const gas = o.energyType === "gas";
  const set = (p: Partial<OfferVersion>) => setO({ ...o, ...p });
  const rule = usePermanenceRule();
  const permBlock = permanenceIssues(o, rule).length > 0;
  const arr = (a: (number | null)[], i: number, v: string) => a.map((x, j) => (j === i ? n(v) : x));
  // Fase 14.1: unitats d'entrada. Els valors es desen SEMPRE en unitats internes (€/kWh i €/client·dia); el selector
  // només canvia com s'escriuen i es mostren, de manera que mai no es converteix dues vegades.
  const [eUnit, setEUnit] = useState<keyof typeof ENERGY_INPUT_UNITS>("eur_kwh");
  const [gUnit, setGUnit] = useState<keyof typeof GAS_FIXED_INPUT_UNITS>("dia");
  const eShow = (v: number | null) => fromInternal(v, ENERGY_INPUT_UNITS[eUnit].unit, "energia");
  const eSet = (v: string) => toInternal(n(v), ENERGY_INPUT_UNITS[eUnit].unit, "energia").value;
  const earr = (a: (number | null)[], i: number, v: string) => a.map((x, j) => (j === i ? eSet(v) : x));
  const gShow = (v: number | null) => fromInternal(v, GAS_FIXED_INPUT_UNITS[gUnit].unit, "terme_fix_gas");
  const powerDay = o.powerUnit !== "eur_kw_dia" ? o.power.map((x) => toInternal(x, o.powerUnit === "eur_kw_any" ? "€/kW/any" : "€/kW/mes", "potencia").value) : null;
  const save = async (status: TariffStatus) => {
    setBusy(true);
    try {
      const r = await tariffsApi.save({ ...o, id: o.id || crypto.randomUUID(), supplierId: o.supplierId || "new", productId: o.productId || "new", status });
      toast({ title: r.status === "activa" ? "Tarifa desada i activada" : "Tarifa desada com a esborrany", body: `Versió ${r.version}`, tone: "ok" });
      onSaved();
    } catch (e) {
      toast({ title: "No s'ha pogut desar", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally {
      setBusy(false);
    }
  };
  const In = ({ label, value, onChange, className }: { label: string; value: string | number | null; onChange: (v: string) => void; className?: string }) => (
    <label className={cn("block", className)}><span className="label">{label}</span><input className="input" defaultValue={value ?? ""} onBlur={(e) => onChange(e.target.value)} /></label>
  );
  return (
    <Modal open onClose={onClose} width="max-w-4xl" title={o.id ? `${o.supplierName} · ${o.productName} (v${o.version})` : "Nova tarifa"}
      footer={onApply ? <><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" onClick={() => onApply(o)}>Aplica els canvis</Button></> : <><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button disabled={busy} onClick={() => save("esborrany")}>Desa esborrany</Button><Button variant="primary" disabled={busy || !check.ok || permBlock} onClick={() => save("activa")}>Desa i activa</Button></>}>
      <div className="space-y-3 text-[13px]">
        <div className="grid gap-3 sm:grid-cols-4">
          <In label="Comercialitzadora" value={o.supplierName} onChange={(v) => set({ supplierName: v })} />
          <In label="Nom de l'oferta" value={o.productName} onChange={(v) => set({ productName: v })} className="sm:col-span-2" />
          <DropArea accept="image/png,image/jpeg,.png,.jpg,.jpeg" label="Logotip" onFiles={([f]) => { if (f.size > 200_000) return; const r = new FileReader(); r.onload = () => set({ supplierLogo: String(r.result) }); r.readAsDataURL(f); }}><label className="block"><span className="label">Logotip (PNG/JPG)</span><input type="file" accept="image/png,image/jpeg" className="input" onChange={(e) => { const f = e.target.files?.[0]; if (!f || f.size > 200_000) return; const r = new FileReader(); r.onload = () => set({ supplierLogo: String(r.result) }); r.readAsDataURL(f); }} /></label></DropArea>
          <label className="block"><span className="label">Energia</span><select className="input" value={o.energyType} onChange={(e) => set({ energyType: e.target.value as "luz" | "gas", accessTariff: e.target.value === "gas" ? "RL.1" : "2.0TD", contractType: e.target.value === "gas" ? "fix24h" : o.contractType })}><option value="luz">Llum</option><option value="gas">Gas</option></select></label>
          <label className="block"><span className="label">Peatge d&apos;accés</span><select className="input" value={o.accessTariff} onChange={(e) => set({ accessTariff: e.target.value })}>{TARIFFS.filter((t) => (gas ? t.startsWith("RL") : !t.startsWith("RL"))).map((t) => <option key={t}>{t}</option>)}</select></label>
          {!gas && <label className="block"><span className="label">Tipus de contracte</span><select className="input" value={o.contractType} onChange={(e) => set({ contractType: e.target.value as ContractType })}>{CONTRACT_TYPES.map((t) => <option key={t} value={t}>{CONTRACT_TYPE_LABEL[t]}</option>)}</select></label>}
          <fieldset className="block"><span className="label">Segment</span><div className="flex gap-2 pt-2">{SEGMENTS.map((sg) => <label key={sg} className="flex items-center gap-1"><input type="checkbox" checked={o.segments.includes(sg)} onChange={(e) => set({ segments: e.target.checked ? [...o.segments, sg] : o.segments.filter((x) => x !== sg) as Segment[] })} />{sg}</label>)}</div></fieldset>
        </div>
        <div className="grid gap-3 sm:grid-cols-7">
          {gas || o.contractType === "fix24h" ? <In key={`e24-${eUnit}`} label={`Energia ${ENERGY_INPUT_UNITS[eUnit].label} (preu únic)`} value={eShow(o.energy24h)} onChange={(v) => set({ energy24h: eSet(v) })} /> : Array.from({ length: 6 }, (_, i) => <In key={`e${i}-${eUnit}`} label={`${o.contractType === "indexat" ? "Ref. " : ""}Energia P${i + 1}`} value={eShow(o.contractType === "indexat" ? o.indexedReference?.energy[i] ?? null : o.energy[i])} onChange={(v) => o.contractType === "indexat" ? set({ indexedReference: { energy: earr(o.indexedReference?.energy ?? Array(6).fill(null), i, v), note: o.indexedReference?.note ?? "Preus de referència", asOf: o.indexedReference?.asOf ?? null } }) : set({ energy: earr(o.energy, i, v) })} />)}
          <label className="block"><span className="label">Unitat d&apos;energia</span><select className="input" aria-label="Unitat d'energia" value={eUnit} onChange={(e) => setEUnit(e.target.value as keyof typeof ENERGY_INPUT_UNITS)}>{(Object.keys(ENERGY_INPUT_UNITS) as (keyof typeof ENERGY_INPUT_UNITS)[]).map((u) => <option key={u} value={u}>{ENERGY_INPUT_UNITS[u].label}</option>)}</select></label>
          {gas && <In key={`gf-${gUnit}`} label={`Terme fix (${GAS_FIXED_INPUT_UNITS[gUnit].label})`} value={gShow(o.gasFixedEurDay)} onChange={(v) => set({ gasFixedEurDay: toInternal(n(v), GAS_FIXED_INPUT_UNITS[gUnit].unit, "terme_fix_gas").value })} />}
          {gas && <label className="block"><span className="label">Unitat del terme fix</span><select className="input" aria-label="Unitat del terme fix" value={gUnit} onChange={(e) => setGUnit(e.target.value as keyof typeof GAS_FIXED_INPUT_UNITS)}>{(Object.keys(GAS_FIXED_INPUT_UNITS) as (keyof typeof GAS_FIXED_INPUT_UNITS)[]).map((u) => <option key={u} value={u}>{GAS_FIXED_INPUT_UNITS[u].label}</option>)}</select></label>}
        </div>
        {(eUnit !== "eur_kwh" || (gas && gUnit !== "dia")) && (
          <p className="text-[11.5px] text-muted" data-testid="valors-normalitzats">Es desa en unitats internes: energia {(gas || o.contractType === "fix24h" ? [o.energy24h] : o.energy).filter((x) => x != null).map((x) => `${x} €/kWh`).join(" · ") || "—"}{gas ? ` · terme fix ${o.gasFixedEurDay ?? "—"} €/client·dia (365 dies; mes = ×12÷365)` : ""}.</p>
        )}
        {o.template?.classification === "pendent" && (
          <label className="flex flex-wrap items-center gap-2 rounded-xl border border-pend/40 bg-pend/[0.06] p-2 text-[12.5px]"><span>Classificació pendent del document: confirma si és</span>
            <select className="input h-8 w-auto py-0" aria-label="Confirma la classificació" value="" onChange={(e) => { const c = e.target.value as "fixa" | "indexada"; if (!c) return; set({ template: { ...o.template!, classification: c }, ...(c === "indexada" && !gas ? { contractType: "indexat" as ContractType } : {}) }); }}>
              <option value="">tria…</option><option value="fixa">fixa (preu revisable)</option><option value="indexada">indexada</option>
            </select></label>
        )}
        {o.units?.formulas?.length ? <p className="text-[11.5px] text-brand">Conversió del document: {o.units.formulas.join(" · ")}</p> : null}
        {!gas && (
          <div className="grid gap-3 sm:grid-cols-7">
            {Array.from({ length: 6 }, (_, i) => <In key={i} label={`Potència P${i + 1}`} value={o.power[i]} onChange={(v) => set({ power: arr(o.power, i, v) })} />)}
            <label className="block"><span className="label">Unitat</span><select className="input" value={o.powerUnit} onChange={(e) => set({ powerUnit: e.target.value as PowerUnit })}>{(Object.keys(POWER_UNIT_LABEL) as PowerUnit[]).map((u) => <option key={u} value={u}>{POWER_UNIT_LABEL[u]}</option>)}</select></label>
          </div>
        )}
        {!gas && powerDay && o.power.some((x) => x != null) && (
          <p className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">Equivalent en €/kW·dia (÷365{o.powerUnit === "eur_kw_mes" ? " ×12" : ""}): {powerDay.map((x, i) => (x != null ? `P${i + 1} ${x.toLocaleString("ca-ES", { maximumFractionDigits: 10 })}` : null)).filter(Boolean).join(" · ")}
            <Button size="sm" variant="ghost" onClick={() => { const r = normalizeOfferUnits(o); setO(r.offer); }}>Converteix a €/kW·dia</Button></p>
        )}
        {(o.contractType === "indexat" || o.contractType === "mixt") && <FormulaEditor o={o} set={set} />}
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block"><span className="label">Impostos als preus</span><select className="input" value={o.taxTreatment} onChange={(e) => set({ taxTreatment: e.target.value as OfferVersion["taxTreatment"] })}><option value="sense_impostos">Sense impostos</option><option value="amb_iee">Amb impost elèctric</option><option value="amb_iee_iva">Amb IEE i IVA</option></select></label>
          <label className="block"><span className="label">SAS</span><select className="input" value={o.sas.mode} onChange={(e) => set({ sas: { ...o.sas, mode: e.target.value as SasMode } })}>{SAS_MODES.map((m) => <option key={m} value={m}>{SAS_LABEL[m]}</option>)}</select></label>
          {o.sas.mode === "variable" && <In label="SAS estimat (€/kWh)" value={o.sas.eurKwh} onChange={(v) => set({ sas: { ...o.sas, eurKwh: n(v) } })} />}
          <In label="Quota fixa (€/mes)" value={o.fees[0]?.eurMonth ?? null} onChange={(v) => set({ fees: n(v) ? [{ concept: "Quota fixa", eurMonth: n(v)! }] : [] })} />
          <In label={gas ? "Descompte terme variable (%)" : "Descompte energia (%)"} value={o.discounts[0]?.pct ?? null} onChange={(v) => set({ discounts: n(v) ? [{ concept: "Descompte", pct: n(v), eurYear: null, base: "energia" }] : [] })} />
          <In label="Durada (mesos)" value={o.durationMonths} onChange={(v) => set({ durationMonths: n(v) })} />
          <In label="Garantia de preu (mesos)" value={o.priceGuaranteeMonths} onChange={(v) => set({ priceGuaranteeMonths: n(v) })} />
          <In label="Consum mínim (kWh/any)" value={o.eligibility.minKwh} onChange={(v) => set({ eligibility: { ...o.eligibility, minKwh: n(v) } })} />
          <In label="Consum màxim (kWh/any)" value={o.eligibility.maxKwh} onChange={(v) => set({ eligibility: { ...o.eligibility, maxKwh: n(v) } })} />
          <In label="Potència mínima (kW)" value={o.eligibility.minKw} onChange={(v) => set({ eligibility: { ...o.eligibility, minKw: n(v) } })} />
          <In label="Potència màxima (kW)" value={o.eligibility.maxKw} onChange={(v) => set({ eligibility: { ...o.eligibility, maxKw: n(v) } })} />
          <label className="block"><span className="label">Vigent des de</span><input type="date" className="input" value={o.validFrom ?? ""} onChange={(e) => set({ validFrom: e.target.value || null })} /></label>
          <label className="block"><span className="label">Vigent fins a</span><input type="date" className="input" value={o.validTo ?? ""} onChange={(e) => set({ validTo: e.target.value || null })} /></label>
          <In label="Font" value={o.source} onChange={(v) => set({ source: v || null })} />
          <label className="block"><span className="label">Data de publicació</span><input type="date" className="input" value={o.publishedAt ?? ""} onChange={(e) => set({ publishedAt: e.target.value || null })} /></label>
        </div>
        {(() => {
          const fp = finalPrices(o);
          if (!fp.original || !fp.energyPct) return null;
          const fin = fp.energy24h != null ? [fp.energy24h] : fp.energy;
          const orig = fp.original.energy24h != null ? [fp.original.energy24h] : fp.original.energy;
          return (
            <Notice tone="green">
              <span data-testid="editor-preu-final">Preu final amb descompte ({pctTxt(fp.energyPct)}): <b>{join(fin)} €/kWh</b> · sense descompte {join(orig)} €/kWh.{fp.powerPct ? ` Potència: ${join(fp.power)} (${pctTxt(fp.powerPct)}).` : ""} És el preu que es mostra al catàleg; el comparador aplica el mateix descompte al cost.</span>
            </Notice>
          );
        })()}
        <PermanenceEditor o={o} set={set} rule={rule} />
        <SurplusEditor o={o} set={set} />
        <label className="block"><span className="label">Condicions i elegibilitat</span><textarea className="input min-h-[70px]" defaultValue={o.conditions ?? ""} onBlur={(e) => set({ conditions: e.target.value || null })} /></label>
        {check.errors.length > 0 && <Notice tone="red">No es pot activar: {check.errors.join(" · ")}</Notice>}
        {check.warnings.length > 0 && <Notice>{check.warnings.join(" · ")}</Notice>}
      </div>
    </Modal>
  );
}

function ImportWizard() {
  const toast = useApp((s) => s.toast);
  const [file, setFile] = useState<{ name: string; sheets: Record<string, Cell[][]> } | null>(null);
  const [sheet, setSheet] = useState("");
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [supplier, setSupplier] = useState("");
  const [unit, setUnit] = useState<PowerUnit | "">("");
  const [existing, setExisting] = useState<CatalogItem[]>([]);
  const [activate, setActivate] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof tariffsApi.templates>>["templates"]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadCatalog().then((r) => setExisting(r.items.filter((x) => x.origin !== "crm"))).catch(() => undefined);
    tariffsApi.templates().then((r) => setTemplates(r.templates)).catch(() => undefined);
  }, []);
  const rows = file && sheet ? file.sheets[sheet] : null;
  const headers = rows ? (rows[headerRow] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean) : [];
  const preview: ImportPreview | null = useMemo(() => (rows ? previewImport(rows, headerRow, mapping, { defaultSupplier: supplier || undefined, defaultPowerUnit: unit || undefined, source: `Excel · ${file!.name}`, existing }) : null), [rows, headerRow, mapping, supplier, unit, existing, file]);

  const onFile = async (f: File) => {
    const buf = await f.arrayBuffer();
    let sheets: Record<string, Cell[][]> = {};
    if (/\.csv$/i.test(f.name)) sheets = { CSV: parseCsv(new TextDecoder().decode(buf)) };
    else {
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[n], { header: 1, defval: null, raw: true });
    }
    const first = Object.keys(sheets)[0];
    const hr = detectHeaderRow(sheets[first]);
    setFile({ name: f.name, sheets });
    setSheet(first);
    setHeaderRow(hr);
    setMapping(autoMap((sheets[first][hr] ?? []).map((h) => String(h ?? ""))));
    setResult(null);
  };
  const confirm = async (dryRun: boolean) => {
    if (!preview || !file) return;
    setBusy(true);
    try {
      const offers = preview.rows.filter((r) => r.offer && r.status !== "sense_canvis").map((r) => r.offer);
      const r = await tariffsApi.importConfirm({ fileName: file.name, supplierName: supplier || null, mapping, counts: preview.counts, report: preview.rows.map(({ row, status, errors, warnings }) => ({ row, status, errors, warnings })), offers, activateComplete: activate, dryRun });
      setResult(dryRun ? "Simulació registrada: no s'ha desat cap tarifa." : `Importació completada: ${r.saved} desades (${r.activated} activades, la resta en esborrany)${r.rejected ? ` · ${r.rejected} rebutjades pel servidor` : ""}.`);
      toast({ title: dryRun ? "Simulació registrada" : "Importació completada", tone: "ok" });
    } catch (e) {
      toast({ title: "Error en la importació", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally {
      setBusy(false);
    }
  };
  const STATUS_LABEL: Record<string, string> = { nova: "Nova", modificada: "Modificada", sense_canvis: "Sense canvis", rebutjada: "Rebutjada", revisio: "Revisar", duplicada: "Duplicada" };
  return (
    <div className="space-y-3">
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="block min-w-[260px]"><span className="label">1 · Fitxer Excel o CSV</span><DropZone accept=".xlsx,.xls,.csv" className="p-3" onFiles={([f]) => void onFile(f)}><span className="text-[12.5px]">{file ? file.name : "Arrossega'l aquí o fes clic"}</span></DropZone></div>
        {file && (
          <>
            <label className="block"><span className="label">2 · Full</span><select className="input" value={sheet} onChange={(e) => { setSheet(e.target.value); const hr = detectHeaderRow(file.sheets[e.target.value]); setHeaderRow(hr); setMapping(autoMap((file.sheets[e.target.value][hr] ?? []).map((h) => String(h ?? "")))); }}>{Object.keys(file.sheets).map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="block"><span className="label">Fila de capçaleres</span><input type="number" min={1} className="input w-24" value={headerRow + 1} onChange={(e) => { const hr = Math.max(0, Number(e.target.value) - 1); setHeaderRow(hr); setMapping(autoMap((rows?.[hr] ?? []).map((h) => String(h ?? "")))); }} /></label>
            <label className="block"><span className="label">Comercialitzadora per defecte</span><input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="si el fitxer no la porta" /></label>
            <label className="block"><span className="label">Unitat de potència per defecte</span><select className="input" value={unit} onChange={(e) => setUnit(e.target.value as PowerUnit | "")}><option value="">Detecta-la</option>{(Object.keys(POWER_UNIT_LABEL) as PowerUnit[]).map((u) => <option key={u} value={u}>{POWER_UNIT_LABEL[u]}</option>)}</select></label>
            {templates.length > 0 && <label className="block"><span className="label">Plantilla</span><select className="input" defaultValue="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) { setMapping(t.mapping as Mapping); setHeaderRow(t.header_row); setSupplier(t.supplier_name ?? ""); setUnit((t.default_power_unit as PowerUnit) ?? ""); } }}><option value="">—</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
          </>
        )}
      </section>
      {file && <LegacyTemplateImport fileName={file.name} sheets={file.sheets} existing={existing} />}
      {file && rows && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-2 text-[14px] font-semibold">3 · Mapatge de columnes</h3>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {(Object.keys(IMPORT_FIELDS) as ImportField[]).map((f) => (
              <label key={f} className="block"><span className="text-[11px] text-muted">{IMPORT_FIELDS[f]}</span>
                <select className={cn("input h-8 py-1 text-[12px]", mapping[f] && "border-brand/50")} value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })}>
                  <option value="">—</option>{headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <Button className="mt-3" size="sm" variant="ghost" onClick={async () => { const name = prompt("Nom de la plantilla", supplier || file.name); if (!name) return; await tariffsApi.saveTemplate({ name, supplierName: supplier || null, headerRow, mapping, defaultPowerUnit: unit || null }); toast({ title: "Plantilla desada", tone: "ok" }); }}>Desa com a plantilla</Button>
        </section>
      )}
      {preview && (
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-[14px] font-semibold">4 · Validació i previsualització</h3>
          <div className="flex flex-wrap gap-2 text-[12px]">{Object.entries(preview.counts).map(([k, v]) => <Badge key={k} tone={k === "rebutjada" || k === "duplicada" ? "red" : k === "revisio" ? "amber" : k === "nova" || k === "modificada" ? "green" : "zinc"}>{STATUS_LABEL[k]}: {v}</Badge>)}</div>
          <div className="max-h-[360px] overflow-auto rounded-lg border border-line">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-elevated text-[11px] text-muted"><tr><th className="px-2 py-1.5 text-left">Fila</th><th className="px-2 py-1.5 text-left">Oferta</th><th className="px-2 py-1.5 text-left">Estat</th><th className="px-2 py-1.5 text-left">Errors i avisos</th></tr></thead>
              <tbody>{preview.rows.map((r) => <tr key={r.row} className="border-t border-line"><td className="px-2 py-1">{r.row}</td><td className="px-2 py-1">{r.offer ? `${r.offer.supplierName} · ${r.offer.productName} · ${r.offer.accessTariff}` : "—"}</td><td className="px-2 py-1">{STATUS_LABEL[r.status]}</td><td className="px-2 py-1"><span className="text-lost">{r.errors.join(" · ")}</span>{r.errors.length && r.warnings.length ? " · " : ""}<span className="text-pend">{r.warnings.join(" · ")}</span></td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted">Corregeix el fitxer o el mapatge i torna a carregar-lo per resoldre les files rebutjades. Les tarifes noves entren com a esborrany.</p>
          <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Activa directament les tarifes completes i sense avisos (la resta queden en esborrany)</label>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => confirm(true)}>5 · Simula (no desa res)</Button>
            <Button variant="primary" disabled={busy || !preview.rows.some((r) => r.offer && r.status !== "sense_canvis")} onClick={() => confirm(false)}><Upload size={14} /> Confirma la importació</Button>
          </div>
          {result && <Notice tone="green">{result}</Notice>}
        </section>
      )}
    </div>
  );
}

/**
 * MIGRACIÓ DE L'ANTIC APARTAT «PROPOSTES»: informe de les ofertes antigues comparades amb el catàleg i incorporació de
 * les que continuen sent vàlides. No esborra res i no sobreescriu cap tarifa del catàleg.
 */
function LegacyMigration({ onDone }: { onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  const [d, setD] = useState<Awaited<ReturnType<typeof legacyApi.report>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = () => legacyApi.report().then((r) => { setD(r); setSel(new Set(r.rows.filter((x) => x.importable).map((x) => x.id))); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);
  const TONE: Record<LegacyClass, "green" | "blue" | "amber" | "red" | "zinc"> = { ja_al_cataleg: "green", vigent: "blue", caducada: "amber", incompleta: "red", duplicada: "zinc" };
  const run = async () => {
    setBusy(true);
    try {
      const r = await legacyApi.import([...sel]);
      toast({ title: `${r.imported.length} ofertes incorporades al catàleg`, body: r.skipped.length ? `${r.skipped.length} no s'han incorporat (${[...new Set(r.skipped.map((x) => x.reason))].join(", ")})` : undefined, tone: "ok" });
      await load(); onDone();
    } catch (e) { toast({ title: "No s'ha pogut incorporar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  if (err) return <Notice tone="red">{err}</Notice>;
  if (!d) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" /> Analitzant les ofertes antigues…</p>;
  return (
    <div className="space-y-3">
      <Notice tone="blue">L&apos;antic apartat «Propostes» ja no es fa servir per triar ofertes: les comparatives, els PDF i les renovacions llegeixen només aquest catàleg. Aquí pots revisar les ofertes antigues i incorporar les que encara són vàlides. No s&apos;esborra res: les comparatives històriques conserven les ofertes amb què es van fer.</Notice>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <Badge>Total: {d.total}</Badge>
        {(Object.keys(LEGACY_LABEL) as LegacyClass[]).map((k) => <Badge key={k} tone={TONE[k]}>{LEGACY_LABEL[k]}: {d.counts[k] ?? 0}</Badge>)}
        <Badge tone="violet">Usades en comparatives històriques: {d.usedInHistory}</Badge>
      </div>
      {d.total === 0 ? <Empty icon={<CheckCircle2 size={22} />} title="No hi ha ofertes antigues" body="Tot ja és al catàleg." /> : (
        <div className="max-h-[480px] overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-elevated text-[11px] uppercase tracking-wide text-muted"><tr><th className="w-8 px-2 py-2" /><th className="px-2 py-2 text-left">Oferta antiga</th><th className="px-2 py-2 text-left">Classificació</th><th className="px-2 py-2 text-right">Comparatives</th><th className="px-2 py-2 text-left">Observacions</th></tr></thead>
            <tbody>{d.rows.map((r: LegacyRow) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Incorpora ${r.label}`} disabled={!r.importable} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                <td className="px-2 py-1.5">{r.label}</td>
                <td className="px-2 py-1.5"><Badge tone={TONE[r.cls]}>{LEGACY_LABEL[r.cls]}</Badge></td>
                <td className="px-2 py-1.5 text-right tnum">{r.usedInHistory || "—"}</td>
                <td className="px-2 py-1.5 text-[11.5px] text-muted">{r.issues.join(" · ") || (r.cls === "ja_al_cataleg" ? "Es manté la versió del catàleg (no se sobreescriu)" : "")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {d.rows.some((r) => r.importable) && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-muted">Només es poden incorporar les ofertes vigents, completes i que no existeixen al catàleg. Entren actives com a versió nova del catàleg, amb l&apos;origen anotat.</p>
          <Button variant="primary" disabled={busy || !sel.size} onClick={() => void run()}>{busy && <Loader2 size={14} className="animate-spin" />} Incorpora {sel.size} al catàleg</Button>
        </div>
      )}
    </div>
  );
}

/** Plantilla de comercialitzadores (format «ZocoProductos», l'antiga importació de «Propostes») → versions del catàleg. */
function LegacyTemplateImport({ fileName, sheets, existing }: { fileName: string; sheets: Record<string, Cell[][]>; existing: CatalogItem[] }) {
  const toast = useApp((s) => s.toast);
  const me = useApp((s) => s.snap?.me.name ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const parsed = useMemo(() => {
    const rows = (sheets.Productos ?? sheets[Object.keys(sheets)[0]]) as unknown[][];
    try { return parseOffersTemplate(rows as never, { validaHasta: "9999-12-31", verificadaPor: me }); } catch { return null; }
  }, [sheets, me]);
  if (!parsed || !parsed.offers.length) return null;
  const byKey = new Map(existing.map((x) => [productKey(x), x]));
  const versions = parsed.offers.map((o) => ({ ...fromCrmOffer(o), id: crypto.randomUUID(), origin: "excel" as const, status: "esborrany" as const, source: `Plantilla de comercialitzadores · ${fileName}` }));
  const changed = versions.filter((v) => { const ex = byKey.get(productKey(v)); return !ex || priceChanged(ex, v); });
  const go = async () => {
    setBusy(true);
    try {
      const r = await tariffsApi.importConfirm({ fileName, supplierName: null, mapping: { format: "plantilla_comercialitzadores" }, counts: { ofertes: versions.length, noves_o_modificades: changed.length }, report: [], offers: changed, activateComplete: false, dryRun: false });
      setDone(`${r.saved} tarifes desades com a esborrany${r.rejected ? ` · ${r.rejected} rebutjades` : ""}. Revisa-les i activa-les des de «Tarifes».`);
      toast({ title: "Plantilla importada al catàleg", tone: "ok" });
    } catch (e) { toast({ title: "Error en la importació", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  return (
    <section className="space-y-2 rounded-2xl border border-brand/30 bg-brand/[0.04] p-4">
      <h3 className="text-[14px] font-semibold">Plantilla de comercialitzadores detectada</h3>
      <p className="text-[12.5px] text-muted">{parsed.offers.length} ofertes ({changed.length} noves o amb preus canviats; {versions.length - changed.length} sense canvis respecte al catàleg). {parsed.skipped.length ? `${parsed.skipped.length} files no comparables s'ometen.` : ""} Entraran al catàleg com a ESBORRANY per revisar-les; mai se sobreescriu una tarifa existent: es crea una versió nova.</p>
      {done ? <Notice tone="green">{done}</Notice> : <Button variant="primary" disabled={busy || !changed.length} onClick={() => void go()}>{busy && <Loader2 size={14} className="animate-spin" />} Importa {changed.length} al catàleg</Button>}
    </section>
  );
}

function Connectors() {
  const [d, setD] = useState<Awaited<ReturnType<typeof tariffsApi.connectors>> | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useApp((s) => s.toast);
  const load = () => tariffsApi.connectors().then(setD).catch((e) => toast({ title: "Error", body: String(e), tone: "err" }));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <Notice tone="blue">Només es connecten APIs oficials o accessos autoritzats per contracte (variable TARIFF_CONNECTORS al servidor). Si una comercialitzadora no té API, fes servir la importació Excel o l&apos;alta manual. No es fa scraping.</Notice>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><Plug size={15} /> Connectors configurats</h3>
          <Button disabled={busy || !d?.connectors.length} onClick={async () => { setBusy(true); try { await tariffsApi.sync(); toast({ title: "Sincronització completada", body: "Les ofertes noves o modificades entren com a esborrany.", tone: "ok" }); void load(); } catch (e) { toast({ title: "Error de sincronització", body: String(e), tone: "err" }); } finally { setBusy(false); } }}><RefreshCw size={14} className={cn(busy && "animate-spin")} /> Sincronitza ara</Button>
        </div>
        {!d ? <Loader2 className="animate-spin" /> : d.connectors.length === 0 ? <p className="mt-2 text-[13px] text-muted">Cap connector configurat.</p> : <ul className="mt-2 text-[13px]">{d.connectors.map((c) => <li key={c.providerId}>{c.name} <span className="text-muted">({c.providerId})</span></li>)}</ul>}
      </section>
      {d && d.runs.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
          <h3 className="mb-2 text-[14px] font-semibold">Execucions</h3>
          {d.runs.map((r) => <p key={r.id} className={cn(r.ok === false ? "text-lost" : "text-muted")}>{new Date(r.started_at).toLocaleString("ca-ES")} · {r.provider_id} · {r.ok === false ? `error: ${r.error}` : `${r.fetched ?? 0} rebudes · ${r.created ?? 0} noves · ${r.changed ?? 0} canvis de preu · ${r.retired ?? 0} retirades · ${r.rejected ?? 0} rebutjades`}</p>)}
        </section>
      )}
    </div>
  );
}

/** Fórmula contractual d'una oferta indexada (pròpia de cada comercialitzadora; Fase 11). */
function FormulaEditor({ o, set }: { o: OfferVersion; set: (p: Partial<OfferVersion>) => void }) {
  const f = o.formula ?? emptyFormula();
  const up = (p: Partial<IndexedFormula>) => set({ formula: { ...f, ...p } });
  const num = (v: string) => { const x = Number(v.replace(",", ".")); return v.trim() === "" || !Number.isFinite(x) ? null : x; };
  const missing = formulaMissing(o.formula, 6);
  return (
    <fieldset className="space-y-2 rounded-xl border border-line p-3" data-testid="formula-editor">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Fórmula indexada del contracte</legend>
      <p className="text-[11.5px] text-muted">Preu P = ((índex + serveis d&apos;ajust + altres) × (1 + pèrdues P) + marge) / 1000 + peatges i càrrecs P. Copia els valors del contracte d&apos;aquesta comercialitzadora: no hi ha una fórmula comuna.</p>
      <div className="grid gap-2 sm:grid-cols-5">
        <label className="block"><span className="label">Índex</span><select className="input" value={f.index} onChange={(e) => up({ index: e.target.value as IndexedFormula["index"] })}>{INDEXES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="block"><span className="label">Aplicació</span><select className="input" value={f.granularity} onChange={(e) => up({ granularity: e.target.value as IndexedFormula["granularity"] })}><option value="horari">Preu horari</option><option value="periodes">Mitjana per període</option><option value="mensual">Mitjana mensual</option></select></label>
        <label className="block"><span className="label">Marge (€/MWh)</span><input className="input" defaultValue={f.marginEurMWh ?? ""} onBlur={(e) => up({ marginEurMWh: num(e.target.value) })} /></label>
        <label className="block"><span className="label">Serveis d&apos;ajust (€/MWh)</span><input className="input" defaultValue={f.ssaaEurMWh ?? ""} onBlur={(e) => up({ ssaaEurMWh: num(e.target.value) })} /></label>
        <label className="block"><span className="label">Altres (€/MWh)</span><input className="input" defaultValue={f.otherEurMWh ?? ""} onBlur={(e) => up({ otherEurMWh: num(e.target.value) })} /></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <label key={i} className="block"><span className="label">Pèrdues P{i + 1} (%)</span><input className="input" defaultValue={f.lossesPct?.[i] ?? ""} onBlur={(e) => { const a = [...(f.lossesPct ?? Array(6).fill(null))]; a[i] = num(e.target.value); up({ lossesPct: a }); }} /></label>)}</div>
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={f.regulatedIncluded} onChange={(e) => up({ regulatedIncluded: e.target.checked })} /> Els peatges i càrrecs ja estan inclosos a la fórmula</label>
      {!f.regulatedIncluded && <div className="grid gap-2 sm:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <label key={i} className="block"><span className="label">Peatges+càrrecs P{i + 1} (€/kWh)</span><input className="input" defaultValue={f.regulatedEurKwh?.[i] ?? ""} onBlur={(e) => { const a = [...(f.regulatedEurKwh ?? Array(6).fill(null))]; a[i] = num(e.target.value); up({ regulatedEurKwh: a }); }} /></label>)}</div>}
      <label className="block"><span className="label">Text literal de la fórmula al contracte</span><textarea className="input min-h-[50px]" defaultValue={f.contractText ?? ""} onBlur={(e) => up({ contractText: e.target.value.trim() || null })} /></label>
      {missing.length > 0 && <p className="text-[11.5px] text-amber-700 dark:text-amber-300">Incompleta: falta {missing.join(", ")}. El comparador la mostrarà com a INCOMPLETA.</p>}
    </fieldset>
  );
}
