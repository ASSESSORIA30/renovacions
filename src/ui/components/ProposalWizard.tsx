"use client";
import { useSips, useSipsIndex } from "../useSips";
import { energyApi, serverEnabled } from "@/energy/api";
import { fmtMWh, hasSipsCups } from "@/core/sips";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, CheckCircle2, Download, FileText, Mail, MessageCircle, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { compare, fmtEUR, fmtN, periodsFor, type PriceSet } from "@/core/compare";
import { today } from "@/core/dates";
import { sameTariff } from "@/core/insights";
import { buildProposalPdf } from "@/core/pdf";
import { consumption } from "@/core/priority";
import { titleCase } from "@/core/templates";
import type { Offer, ProposalDoc } from "@/core/types";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, SupplierMark, cn } from "./ui";

const BRANDS = ["Naturgy", "Iberdrola", "NIBA", "Gana Energía", "Repsol"];

export function ProposalWizard() {
  const { proposalFor, set, byId, snap, addDoc, repo, toast, integrations } = useApp();
  const c = proposalFor ? byId[proposalFor] : null;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [brand, setBrand] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [kwh, setKwh] = useState<string[]>([]);
  const [kw, setKw] = useState<string[]>([]);
  const [actual, setActual] = useState<{ e: string[]; p: string[]; fijo: string }>({ e: [], p: [], fijo: "" });
  const [doc, setDoc] = useState<ProposalDoc | null>(null);

  const electric = !!c && hasSipsCups(c); // llum, gas o dual
  const availableSips = useSips(electric ? c!.cups : null);
  const sipsBusy = useSipsIndex((s) => Object.keys(s.busy).length > 0);
  const refreshSips = (cups: string) => useSipsIndex.getState().refresh(cups);
  const [sources, setSources] = useState<{ kwh: string | null; kw: string | null }>({ kwh: null, kw: null });
  const [ajuste, setAjuste] = useState<{ incluir: boolean; actual: string; propuesta: string }>({ incluir: false, actual: "", propuesta: "" });
  // si el contracte no té tarifa al CRM, es fa servir la del SIPS
  const tarifa = c?.tarifa ?? (availableSips?.status === "found" ? availableSips.tariff : null);
  const per = periodsFor(tarifa);
  useEffect(() => {
    if (!c) return;
    setStep(1); setBrand(null); setOfferId(null); setDoc(null);
    const total = consumption(c);
    setKwh(Array.from({ length: per.energy }, (_, i) => (per.energy === 1 && i === 0 && total ? String(Math.round(total)) : "")));
    setKw(Array.from({ length: per.power }, (_, i) => (c.potencias?.[i] ?? (i < 2 ? c.potencia : null))?.toString() ?? ""));
    setActual({ e: Array(per.energy).fill(""), p: Array(per.power).fill(""), fijo: "" });
    setAjuste({ incluir: false, actual: "", propuesta: "" });
    setSources({ kwh: per.energy === 1 && total ? "CRM" : null, kw: c.potencias?.some((x) => x != null) || c.potencia ? "CRM" : null });
    // Consums per període introduïts de factures (energy_inputs): tenen prioritat i no es dedueixen del SIPS.
    if (serverEnabled() && electric && per.energy > 1) {
      energyApi.getInputs(c.cups!).then((r) => {
        const inv = r.inputs?.invoice_kwh;
        if (inv && inv.slice(0, per.energy).every((x) => x != null)) {
          setKwh((prev) => (prev.some((x) => x) ? prev : inv.slice(0, per.energy).map((x) => String(Math.round(x!)))));
          setSources((x) => ({ ...x, kwh: `factura (${r.inputs!.updated_by_name ?? "Supabase"}, ${new Date(r.inputs!.updated_at).toLocaleDateString("ca-ES")})` }));
        }
      }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalFor]);

  // Potències P1–P6 del SIPS quan el CRM no en té.
  useEffect(() => {
    if (!c || !availableSips || availableSips.status !== "found" || !availableSips.contracted_power_kw) return;
    const p = availableSips.contracted_power_kw;
    setKw((prev) => {
      if (prev.some((x) => x.trim() !== "")) return prev;
      const next = Array.from({ length: per.power }, (_, i) => (p[i] != null ? String(p[i]) : ""));
      if (next.some((x) => x)) setSources((x) => ({ ...x, kw: "SIPS" }));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- només quan canvia el contracte o arriben dades SIPS
  }, [c?.id, availableSips, per.power]);

  useEffect(()=>{
    if(!c || per.energy!==1 || consumption(c)!=null || !availableSips || availableSips.status!=="found" || availableSips.annual_kwh==null)return;
    setKwh(prev=>prev[0] ? prev : [String(Math.round(availableSips.annual_kwh!))]);
    setSources((x) => ({ ...x, kwh: x.kwh ?? "SIPS" }));
  },[c?.id,availableSips,per.energy]);

  const offers = useMemo(() => (snap?.offers ?? []).filter((o) => o.verificada && o.validaHasta >= today()), [snap?.offers]);
  const [lang, setLang] = useState<"ca" | "es">("ca");
  const matching = offers.filter((o) => sameTariff(o.tarifa, tarifa));
  const shown = matching.filter((o) => !brand || (brand === "Altres" ? !BRANDS.some((b) => o.comercializadora.toLowerCase().startsWith(b.toLowerCase().split(" ")[0])) : o.comercializadora.toLowerCase().startsWith(brand.toLowerCase().split(" ")[0])));
  const offer = offers.find((o) => o.id === offerId) ?? null;

  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  const actualSet: PriceSet = per.gas ? { energia: actual.e.map(n), potencia: [], fijoDia: n(actual.fijo) } : { energia: actual.e.map(n), potencia: actual.p.map(n), cuotaFijaMes: n(actual.fijo) };
  const result = useMemo(() => (c && offer && snap ? compare({ tarifa, kwhPorPeriodo: kwh.map(n), kwPorPeriodo: kw.map(n), actual: actualSet, propuesta: offer, settings: snap.settings, lang, ajuste: per.gas ? undefined : { incluir: ajuste.incluir, actual: n(ajuste.actual), propuesta: n(ajuste.propuesta) } }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, offer, kwh, kw, actual, snap?.settings, lang, ajuste, tarifa]);

  if (!c || !snap) return <Modal open={false} onClose={() => {}} title="">{null}</Modal>;
  const close = () => set("proposalFor", null);
  const version = snap.docs.filter((d) => d.contractId === c.id).length + 1;

  const generate = async () => {
    if (!offer || !result?.ok) return;
    const { blob, fileName } = buildProposalPdf({ contract: c, offer, result, actualPrices: actualSet, settings: snap.settings, comercial: titleCase(c.comercial !== "SIN ASIGNAR" ? c.comercial : snap.me.name), version, logoDataUrl: snap.settings.logo ?? null, lang });
    const saved = await addDoc({ contractId: c.id, version, offerId: offer.id, fileName, ahorroAnual: Math.round(result.ahorro * 100) / 100 }, blob);
    setDoc(saved);
    setStep(3);
    toast({ title: "Proposta generada", body: `${fileName} desada a la fitxa`, tone: "ok" });
  };
  const download = async () => {
    if (!doc) return;
    const url = await repo!.getDocUrl(doc);
    if (!url) return;
    const a = document.createElement("a"); a.href = url; a.download = doc.fileName; a.click();
  };

  return (
    <Modal open={!!proposalFor} onClose={close} width="max-w-3xl" title={<span className="flex items-center gap-2"><FileText size={16} className="text-brand" />Proposta de renovació · {titleCase(c.cliente)}</span>}
      footer={
        step === 1 ? <Button variant="primary" disabled={!offer} onClick={() => setStep(2)}>Continua</Button> :
        step === 2 ? <><Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft size={14} /> Oferta</Button><Button variant="primary" disabled={!result?.ok} onClick={generate}><FileText size={14} /> Genera el PDF</Button></> :
        <><Button variant="ghost" onClick={() => { setStep(2); setDoc(null); }}><RefreshCw size={14} /> Modifica i regenera</Button><Button onClick={download}><Download size={14} /> Descarrega</Button>
          <Button variant="primary" disabled={!c.email && !c.crm.emailOverride} onClick={() => { close(); set("composer", { contractId: c.id, channel: "email", templateId: "t2", attachDocId: doc!.id }); }}><Mail size={14} /> Envia per correu</Button></>
      }>
      <ol className="mb-4 flex gap-2 text-[12px]">
        {["Comercialitzadora i oferta", "Dades i comparació", "PDF i enviament"].map((s, i) => (
          <li key={s} className={cn("flex flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5", step === i + 1 ? "border-brand bg-brand/5 font-medium text-brand" : step > i + 1 ? "border-line text-ink" : "border-line text-muted")}>
            {step > i + 1 ? <CheckCircle2 size={14} className="text-ren" /> : <span className="tnum">{i + 1}</span>} {s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {[null, ...BRANDS, "Altres"].map((b) => (
              <button key={b ?? "all"} onClick={() => setBrand(b)} className={cn("pressable flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]", brand === b ? "border-brand bg-brand/10 font-medium text-brand" : "border-line hover:border-ink/25")}>
                {b && b !== "Altres" && <SupplierMark name={b} size={16} />}{b ?? "Totes"}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted">Tarifa del client: <b className="text-ink">{tarifa ?? "sense tarifa"}</b>{!c.tarifa && tarifa ? " (SIPS)" : ""} · Comercialitzadora actual: <b className="text-ink">{c.comercializadora ?? "—"}</b></p>
          {matching.length === 0 ? (
            <Empty icon={<ShieldCheck size={22} />} title={`No hi ha ofertes disponibles per a ${c.tarifa ?? "aquesta tarifa"}`}
              body="Els preus de les propostes surten del Catàleg de tarifes (tarifes actives, vigents i completes). Dona d'alta o activa la tarifa al catàleg."
              action={<Button variant="primary" size="sm" onClick={() => { close(); useApp.getState().open(null); set("view", "tarifes"); }}>Obre el Catàleg de tarifes</Button>} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {shown.map((o) => <OfferCard key={o.id} o={o} selected={o.id === offerId} onClick={() => setOfferId(o.id)} />)}
              {shown.length === 0 && <p className="text-xs text-muted">No hi ha ofertes d'aquesta comercialitzadora per a aquesta tarifa.</p>}
            </div>
          )}
        </div>
      )}

      {step === 2 && offer && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-muted">Idioma del PDF:</span>
            {(["ca", "es"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={cn("pressable rounded-full border px-2.5 py-1", lang === l ? "border-brand bg-brand/10 font-medium text-brand" : "border-line hover:border-ink/25")}>{l === "ca" ? "Català" : "Castellano"}</button>)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {electric && <SipsPanel c={c} sips={availableSips} busy={sipsBusy} onRefresh={() => void refreshSips(c.cups!).catch((e) => toast({ title: "Error SIPS", body: e instanceof Error ? e.message : String(e), tone: "err" }))} multi={per.energy > 1} />}
            <PeriodInputs title="Consum anual per període (kWh)" values={kwh} onChange={(v) => { setKwh(v); setSources((x) => ({ ...x, kwh: "manual" })); }} source={sources.kwh} hint={per.energy > 1 ? (consumption(c) ?? availableSips?.annual_kwh) ? `Total anual conegut: ${fmtN((consumption(c) ?? availableSips?.annual_kwh)!)} kWh. Cal el repartiment per períodes de la factura: no es dedueix del total.` : "Copia els consums per període de la factura." : consumption(c) ? `Total registrat: ${fmtN(consumption(c)!)} kWh.` : "No hi ha consum registrat: copia'l de la factura."} />
            {per.power > 0 && <PeriodInputs title="Potència contractada (kW)" values={kw} onChange={(v) => { setKw(v); setSources((x) => ({ ...x, kw: "manual" })); }} source={sources.kw} />}
            <PeriodInputs title="Preu energia actual (€/kWh)" values={actual.e} onChange={(e) => setActual({ ...actual, e })} hint="Copia'l de l'última factura del client." step="0.000001" />
            {per.power > 0 && <PeriodInputs title="Preu potència actual (€/kW·dia)" values={actual.p} onChange={(p) => setActual({ ...actual, p })} step="0.000001" />}
            {per.gas ? <PeriodInputs title="Terme fix actual (€/dia)" values={[actual.fijo]} onChange={([fijo]) => setActual({ ...actual, fijo })} step="0.000001" />
              : offer.cuotaFijaMes ? <PeriodInputs title="Quota fixa actual (€/mes)" values={[actual.fijo]} onChange={([fijo]) => setActual({ ...actual, fijo })} /> : null}
          </div>
          {!per.gas && (
            <div className="rounded-lg border border-line p-3">
              <label className="flex items-center gap-2 text-[12.5px] font-medium">
                <input type="checkbox" checked={ajuste.incluir} onChange={(e) => setAjuste({ ...ajuste, incluir: e.target.checked })} />
                Inclou el mecanisme d&apos;ajust (SAS) al càlcul
              </label>
              {ajuste.incluir && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <PeriodInputs title="Ajust actual (€/kWh)" values={[ajuste.actual]} onChange={([v]) => setAjuste({ ...ajuste, actual: v })} step="0.000001" hint="De la factura del client (0 si no en paga)." />
                  <PeriodInputs title="Ajust de l'oferta (€/kWh)" values={[ajuste.propuesta]} onChange={([v]) => setAjuste({ ...ajuste, propuesta: v })} step="0.000001" hint="Segons les condicions de l'oferta." />
                </div>
              )}
            </div>
          )}
          {rangeWarnings(offer, c).map((w) => <Notice key={w} tone="blue">{w}</Notice>)}
          {result && !result.ok && <Notice>Encara no es pot fer una comparació fiable. Falten: {result.faltan.join(", ")}.</Notice>}
          {result?.ok && (
            <div className="rounded-xl border border-line">
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-t-xl bg-line text-[12.5px]">
                <Cell h="" /><Cell h={`Actual · ${c.comercializadora ?? ""}`} /><Cell h={`Proposta · ${offer.comercializadora}`} />
                {([["Energia", "energia"], ["Potència", "potencia"], ["Terme fix", "fijo"], ["Impost elèctric", "iee"], ["Lloguer d'equips", "alquiler"], ["Total sense impostos", "sinImpuestos"], ["IVA", "iva"], ["Total anual amb impostos", "total"]] as const).map(([l, k]) => (
                  <Row key={k} l={l} a={result.actual[k]} b={result.nuevo[k]} strong={k === "total"} />
                ))}
              </div>
              <div className={cn("flex items-center justify-between rounded-b-xl px-4 py-3", result.ahorro > 0 ? "bg-ren/10" : "bg-amber-500/10")}>
                <span className="text-[13px] font-medium">{result.ahorro > 0 ? "Estalvi anual estimat" : "L'oferta surt més cara"}</span>
                <span className="text-xl font-semibold tnum">{fmtEUR(Math.abs(result.ahorro))} <span className="text-sm text-muted">({fmtN(Math.abs(result.ahorroPct), 1)} %)</span></span>
              </div>
              <details className="border-t border-line px-4 py-2 text-[11.5px] text-muted"><summary className="cursor-pointer">Hipòtesis del càlcul</summary><ul className="mt-1 list-disc space-y-0.5 pl-4">{result.hipotesis.map((h) => <li key={h}>{h}</li>)}</ul></details>
            </div>
          )}
        </div>
      )}

      {step === 3 && doc && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-ren/30 bg-ren/[0.06] p-4">
            <CheckCircle2 className="text-ren" />
            <div><p className="text-sm font-medium">{doc.fileName}</p><p className="text-xs text-muted">Versió {doc.version} desada a Documents i a l'Historial.</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!c.telefono && !c.crm.telefonoOverride} onClick={() => { close(); set("composer", { contractId: c.id, channel: "whatsapp", attachDocId: doc.id }); }}><MessageCircle size={14} /> Prepara el WhatsApp</Button>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px]">
            <MessageCircle size={14} className="text-muted" />
            {integrations.supabase ? "Comparteix l'enllaç segur des de Documents." : "L'enllaç segur per a WhatsApp necessita l'emmagatzematge del servidor (Supabase). Mentrestant, descarrega el PDF i adjunta'l a WhatsApp."}
          </div>
        </div>
      )}
    </Modal>
  );
}

function OfferCard({ o, selected, onClick }: { o: Offer; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("pressable flex items-start gap-3 rounded-xl border p-3 text-left", selected ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-line hover:border-ink/25")}>
      <SupplierMark name={o.comercializadora} size={30} />
      <div className="min-w-0 flex-1 text-[12.5px]">
        <p className="font-semibold">{o.comercializadora} · {o.nombre}</p>
        <p className="text-muted">Energia {o.energia.filter((v) => v != null).map((v) => fmtN(v!, 4)).join(" / ")} €/kWh</p>
        <div className="mt-1 flex gap-1">{o.meta?.tipoPrecio && <Badge tone="blue">{o.meta.tipoPrecio}</Badge>}{o.validaHasta < "9999" && <Badge>Fins {o.validaHasta}</Badge>}</div>
      </div>
    </button>
  );
}

function PeriodInputs({ title, values, onChange, hint, step = "any", source }: { title: string; values: string[]; onChange: (v: string[]) => void; hint?: string; step?: string; source?: string | null }) {
  return (
    <div>
      <span className="label flex items-center gap-1.5">{title}{source && <span className="rounded bg-ink/[0.06] px-1 text-[10px] font-semibold uppercase text-muted">Font: {source}</span>}</span>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(values.length, 3)}, minmax(0,1fr))` }}>
        {values.map((v, i) => (
          <label key={i} className="relative">
            {values.length > 1 && <span className="absolute left-2 top-2 text-[10.5px] text-muted">P{i + 1}</span>}
            <input className={cn("input tnum", values.length > 1 && "pl-8")} inputMode="decimal" step={step} value={v} onChange={(e) => { const n = [...values]; n[i] = e.target.value; onChange(n); }} />
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
const Cell = ({ h }: { h: string }) => <div className="truncate bg-elevated px-3 py-2 text-[11.5px] font-medium text-muted">{h}</div>;
function Row({ l, a, b, strong }: { l: string; a: number; b: number; strong?: boolean }) {
  return (<>
    <div className={cn("bg-surface px-3 py-1.5", strong && "font-semibold")}>{l}</div>
    <div className={cn("bg-surface px-3 py-1.5 text-right tnum", strong && "font-semibold")}>{fmtEUR(a)}</div>
    <div className={cn("bg-surface px-3 py-1.5 text-right tnum", strong && "font-semibold")}>{fmtEUR(b)}</div>
  </>);
}

function rangeWarnings(o: Offer, c: import("@/core/types").Contract): string[] {
  const m = o.meta;
  if (!m) return [];
  const out: string[] = [];
  const kwh = consumption(c);
  if (kwh != null && m.consumoMin != null && m.consumoMax != null && m.consumoMax > 0 && (kwh < m.consumoMin || kwh > m.consumoMax)) out.push(`El consum del client (${fmtN(kwh)} kWh) és fora del rang de l'oferta (${fmtN(m.consumoMin)}–${fmtN(m.consumoMax)} kWh).`);
  const kw = c.potencia;
  if (kw != null && m.potenciaMin != null && m.potenciaMax != null && m.potenciaMax > 0 && (kw < m.potenciaMin || kw > m.potenciaMax)) out.push(`La potència del client (${kw} kW) és fora del rang de l'oferta (${m.potenciaMin}–${m.potenciaMax} kW).`);
  if (m.ambito && !/total|pen[ií]nsula/i.test(m.ambito)) out.push(`Oferta només per a ${m.ambito}.`);
  const empresa = /\b(S\.?L\.?U?|S\.?A\.?|SCP|SCCL|CB|SAT)\b/i.test(c.cliente) || /^[A-HJ-NP-SUVW]/i.test(c.cif ?? "");
  if (empresa && m.pyme === false) out.push("L'oferta no està disponible per a pimes i aquest client sembla una empresa.");
  if (!empresa && m.residencial === false) out.push("L'oferta no està disponible per a clients residencials.");
  return out;
}

const MES = ["G", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
function SipsPanel({ c, sips, busy, onRefresh, multi }: { c: import("@/core/types").Contract; sips: import("@/core/sips").SipsEntry | null; busy: boolean; onRefresh: () => void; multi: boolean }) {
  const crm = consumption(c);
  const months = sips?.status === "found" ? sips.monthly_kwh ?? null : null;
  const max = months ? Math.max(1, ...months.map((x) => x ?? 0)) : 1;
  return (
    <div className="rounded-lg border border-accent/25 bg-accent/[0.04] p-3 text-xs sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="flex items-center gap-1.5"><Zap size={13} className="text-accent" /> Dades energètiques disponibles</strong>
        <div className="flex gap-2">
          <button type="button" className="text-brand underline disabled:opacity-40" disabled={busy} onClick={onRefresh}>{busy ? "Consultant…" : "Actualitza SIPS"}</button>
          <button type="button" className="flex items-center gap-1 text-brand underline" onClick={() => { useApp.getState().set("proposalFor", null); useApp.getState().analyzeCups(c.cups!, c.id); }}><Activity size={12} /> Fitxa energètica</button>
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-surface p-2"><div className="text-[10.5px] text-muted">Consum anual · {c.crm.consumoOverride != null ? "Manual" : "CRM"}</div><div className="font-semibold tnum">{crm != null ? `${fmtN(crm)} kWh` : "—"}</div></div>
        <div className="rounded-md bg-surface p-2"><div className="text-[10.5px] text-muted">Consum anual · SIPS{sips?.status === "found" ? ` (${new Date(sips.consulted_at).toLocaleDateString("ca-ES")})` : ""}</div><div className="font-semibold tnum">{sips?.status === "found" && sips.annual_kwh != null ? `${fmtN(sips.annual_kwh)} kWh · ${fmtMWh(sips.annual_kwh, 2)}` : sips?.status === "error" ? "Error de consulta" : "Sense dades"}</div></div>
        <div className="rounded-md bg-surface p-2"><div className="text-[10.5px] text-muted">Tarifa · CRM / SIPS</div><div className="font-semibold">{c.tarifa ?? "—"} / {sips?.status === "found" ? sips.tariff ?? "—" : "—"}</div></div>
      </div>
      {crm != null && sips?.status === "found" && sips.annual_kwh != null && Math.abs(crm - sips.annual_kwh) / Math.max(crm, sips.annual_kwh) > 0.15 && (
        <p className="mt-2 text-amber-700 dark:text-amber-300">Hi ha una diferència superior al 15 % entre el consum del CRM i el del SIPS. Revisa quin valor vols fer servir (pots editar els camps de sota).</p>
      )}
      {months && months.some((x) => x != null) && (
        <div className="mt-2 flex h-12 items-end gap-[3px]" aria-label="Consum mensual SIPS">
          {months.map((m, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-0.5" title={m == null ? "sense dada" : `${fmtN(m)} kWh`}>
              <div className={cn("w-full rounded-t-sm", m == null ? "bg-line/60" : "bg-accent/70")} style={{ height: `${m == null ? 4 : Math.max(4, (m / max) * 36)}px` }} />
              <span className="text-[9px] text-muted">{MES[i]}</span>
            </div>
          ))}
        </div>
      )}
      {multi && <p className="mt-2 text-amber-700 dark:text-amber-300">El SIPS dona el total anual i els totals mensuals, no el repartiment P1–P6. Introdueix els períodes de la factura (o desa&apos;ls a la fitxa energètica → Energy Market) per calcular l&apos;estalvi.</p>}
    </div>
  );
}
