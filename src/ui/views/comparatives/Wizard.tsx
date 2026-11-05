"use client";
/**
 * COMPARATIVES IA · assistent de 5 passos:
 * 1 Origen de dades · 2 Validació · 3 Selecció d'ofertes · 4 Comparativa · 5 Entrega
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, FileText, Keyboard, Loader2, ScanLine, Search, Zap } from "lucide-react";
import { normalizedCups, isValidCups } from "@/core/sips";
import { consumption } from "@/core/priority";
import { titleCase } from "@/core/templates";
import { periodsOf, normalizeTariff } from "@/comparator/engine";
import { invoiceStatus, serverMode, uploadAndExtract, ACCEPTED_INVOICE } from "@/comparator/client";
import { invoiceSurplus, type InvoiceData } from "@/comparator/invoice";
import { emptySheet } from "@/comparator/types";
import { energyApi } from "@/energy/api";
import { useApp } from "@/data/store";
import type { CrmClientDetail } from "@/core/crm";
import { Button, EASE_OUT, Notice, cn } from "../../components/ui";
import { DropZone } from "../../components/DropZone";
import { useWizard, type Mode } from "./state";
import { StepValidate } from "./StepValidate";
import { StepSelect } from "./StepSelect";
import { StepResults } from "./StepResults";
import { StepDeliver } from "./StepDeliver";
import { DraftBanners, DraftStatus, SipsImportButton, closeDraft, useDraft, useDraftAutosave, useDraftOffer } from "./Continuity";
import { useCrumb, useUnsavedChanges } from "../../components/Navigation";

const STEPS = ["Origen de dades", "Validació", "Selecció d'ofertes", "Comparativa", "Entrega"];

export function ComparativaWizardView() {
  const w = useWizard();
  const params = useApp((s) => s.params);
  const byId = useApp((s) => s.byId);

  // Obrir des d'un contracte (Kanban / fitxa): es reinicia amb les seves dades.
  useEffect(() => {
    const id = params.contract;
    if (id && byId[id] && w.contractId !== id) {
      useWizard.getState().reset();
      applyContract(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.contract]);

  // Obrir des de la fitxa d'un client del CRM (Clients 360°): dades del client i, si s'indica, del subministrament.
  useEffect(() => {
    const id = params.client;
    const opp = params.opportunity ?? null;
    if (!id) {
      // oportunitat d'un lead (encara sense client): només es vincula l'oportunitat
      if (opp && w.crmOpportunityId !== opp) { useWizard.getState().reset(); useWizard.getState().set({ crmOpportunityId: opp, client: { ...useWizard.getState().client, name: params.name ?? null } }); }
      return;
    }
    if (w.crmClientId === id && (w.crmSupplyId ?? "") === (params.supply ?? "") && (w.crmOpportunityId ?? null) === opp) return;
    fetch(`/api/crm/clients/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CrmClientDetail | null) => { if (d) { useWizard.getState().reset(); applyCrmClient(d, params.supply ?? null); useWizard.getState().set({ crmOpportunityId: opp }); } })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.client, params.supply, params.opportunity]);

  // Fase 9: esborrany desat automàticament, i oferta de reprendre'n un d'obert per al mateix contracte/client
  const autosave = useDraftAutosave();
  useDraftOffer(params.draft ? { draft: params.draft } : params.contract ? { contract: params.contract } : params.client ? { client: params.client, ...(params.supply ? { supply: params.supply } : {}) } : null);
  const draftStatus = useDraft((s) => s.status);
  useUnsavedChanges("Comparativa", draftStatus === "error" || draftStatus === "conflict", autosave.flush);
  useCrumb(w.client.name ? `Comparativa · ${w.client.name}` : null);

  return (
    <div className="mx-auto max-w-[1300px] space-y-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><SparkIcon /> Nova comparativa</h2>
          <p className="text-[13px] text-muted">Situació actual del client davant de tres alternatives, amb càlcul auditable i proposta en PDF.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DraftStatus />
          {w.step > 1 && <SipsImportButton />}
          {w.step > 1 && <Button variant="ghost" size="sm" onClick={() => { void closeDraft("descartat"); useWizard.getState().reset(); }}>Comença de nou</Button>}
        </div>
      </div>
      <DraftBanners onRetry={() => void autosave.flush()} />
      {w.crmOpportunityId && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[12.5px]">
          Comparativa per a una oportunitat comercial: quedarà vinculada i, quan l&apos;enviïs per correu des de la plataforma, l&apos;oportunitat passarà a «Proposta enviada».
          <button className="ml-auto text-brand underline-offset-2 hover:underline" onClick={() => useApp.getState().navigate("oportunitat", { id: w.crmOpportunityId! })}>Obre l&apos;oportunitat</button>
        </p>
      )}
      {w.crmClientId && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/[0.04] px-3 py-2 text-[12.5px]">
          Vinculada al client <b>{w.crmClientName}</b>{w.crmSupplyId && w.cups ? <> · CUPS <span className="font-mono">{w.cups}</span></> : null}. Quedarà a la seva fitxa, amb els PDF a Documents.
          <button className="ml-auto text-brand underline-offset-2 hover:underline" onClick={() => useApp.getState().navigate("client", { id: w.crmClientId!, tab: "comparatives" })}>Obre la fitxa</button>
        </p>
      )}
      <ol className="grid grid-cols-5 gap-1.5 text-[12px]" aria-label="Passos">
        {STEPS.map((s, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4 | 5;
          const done = w.step > n;
          return (
            <li key={s}>
              <button
                disabled={n > w.step && !(n === 2 && w.mode)}
                onClick={() => w.set({ step: n })}
                className={cn("flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left disabled:opacity-50", w.step === n ? "border-brand bg-brand/5 font-medium text-brand" : done ? "border-line text-ink" : "border-line text-muted")}
                aria-current={w.step === n ? "step" : undefined}
              >
                {done ? <CheckCircle2 size={14} className="shrink-0 text-ren" /> : <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-[11px] tnum">{n}</span>}
                <span className="truncate">{s}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <AnimatePresence mode="wait">
        <motion.div key={w.step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: EASE_OUT }}>
          {w.step === 1 && <StepOrigin />}
          {w.step === 2 && <StepValidate />}
          {w.step === 3 && <StepSelect />}
          {w.step === 4 && <StepResults />}
          {w.step === 5 && <StepDeliver />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export const SparkIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand" aria-hidden>
    <path d="M12 2l1.8 5.6L19.5 9l-5.7 1.5L12 16l-1.8-5.5L4.5 9l5.7-1.4L12 2zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z" fill="currentColor" />
  </svg>
);

/** Omple les dades a partir d'un client del CRM (Clients 360°) i, opcionalment, d'un dels seus subministraments. */
export function applyCrmClient(d: CrmClientDetail, supplyId: string | null) {
  const c = d.client;
  const s = supplyId ? d.supplies.find((x) => x.id === supplyId) ?? null : d.supplies.filter((x) => !x.archived_at).length === 1 ? d.supplies.find((x) => !x.archived_at)! : null;
  const w = useWizard.getState();
  const base = {
    crmClientId: c.id,
    crmClientName: c.name,
    crmSupplyId: s?.id ?? null,
    client: { name: c.name, taxId: c.tax_id, address: [c.address, c.postal_code, c.city].filter(Boolean).join(", ") || null, email: c.email, phone: c.phone },
  };
  if (!s) { w.set(base); return; }
  const gas = s.energy_type === "gas";
  const tariff = normalizeTariff(s.access_tariff) ?? (gas ? "RL.1" : "2.0TD");
  const per = periodsOf(tariff, gas ? "gas" : "luz");
  const kw = Array.from({ length: 6 }, (_, i) => (i < per.power ? s.power_kw?.[i] ?? null : null));
  const kwh = Array.from({ length: 6 }, (_, i) => (i < per.energy ? s.period_kwh?.[i] ?? null : null));
  w.set({
    ...base,
    cups: s.cups,
    currentRetailer: s.current_retailer ?? "",
    supply: { ...w.supply, energyType: gas ? "gas" : "luz", accessTariff: tariff, kw, kwh, kwhTotal: s.annual_kwh, basis: "anual", days: 365, periodFrom: null, periodTo: null },
    sources: { kw: kw.some((x) => x != null) ? (s.data_source === "sips" ? "sips" : "manual") : null, kwhTotal: s.annual_kwh != null ? (s.data_source === "sips" ? "sips" : "manual") : null },
    dataNotes: s.annual_kwh != null ? [`Consum anual de la fitxa del subministrament (${Math.round(s.annual_kwh).toLocaleString("ca-ES")} kWh, font: ${s.data_source}).`] : [],
  });
}

/** Omple les dades a partir d'un contracte del CRM (només camps coneguts; la resta queda buida). */
export function applyContract(id: string) {
  const c = useApp.getState().byId[id];
  if (!c) return;
  const w = useWizard.getState();
  const gas = c.tipo === "gas";
  const tariff = normalizeTariff(c.tarifa) ?? (gas ? "RL.1" : "2.0TD");
  const per = periodsOf(tariff, gas ? "gas" : "luz");
  const kw = Array.from({ length: 6 }, (_, i) => (i < per.power ? (c.potencias?.[i] ?? (i < 2 ? c.potencia : null)) ?? null : null));
  const kwh = consumption(c);
  w.set({
    contractId: id,
    cups: c.cups ?? "",
    client: { name: titleCase(c.cliente), taxId: c.cif, address: [c.direccion, c.cp, c.poblacion].filter(Boolean).join(", ") || null, email: c.crm.emailOverride ?? c.email, phone: c.crm.telefonoOverride ?? c.telefono },
    currentRetailer: c.comercializadora ?? "",
    supply: { ...w.supply, energyType: gas ? "gas" : "luz", accessTariff: tariff, kw, kwhTotal: kwh, basis: "anual", days: 365, periodFrom: null, periodTo: null },
    sources: { kw: kw.some((x) => x != null) ? "crm" : null, kwhTotal: kwh != null ? (c.crm.consumoOverride != null ? "manual" : "crm") : null },
    dataNotes: kwh != null ? [`Consum anual del CRM (${Math.round(kwh).toLocaleString("ca-ES")} kWh): no inclou repartiment per períodes.`] : [],
  });
}

/** Factura extreta → dades del formulari (amb procedència de cada valor). */
export function applyInvoice(d: InvoiceData, meta: { warnings: string[]; method: string; pages: number }) {
  const w = useWizard.getState();
  const gas = d.energyType.value === "gas" || /^RL/i.test(d.accessTariff.value ?? "");
  const kwh = d.kwh.map((f) => f.value);
  const n = periodsOf(d.accessTariff.value, gas ? "gas" : "luz");
  const sum = kwh.slice(0, n.energy).every((x) => x != null) ? kwh.slice(0, n.energy).reduce<number>((a, x) => a + (x as number), 0) : null;
  const ep = d.energyPrice.map((f) => f.value);
  const pp = d.powerPrice.map((f) => f.value);
  const { surplus, currentSurplus } = invoiceSurplus(d);
  w.set({
    invoice: { data: d, ...meta },
    cups: d.cups.value ?? w.cups,
    client: { ...w.client, name: d.holder.value ?? w.client.name, taxId: d.taxId.value ?? w.client.taxId, address: d.address.value ?? w.client.address },
    currentRetailer: d.retailer.value ?? w.currentRetailer,
    supply: {
      ...w.supply,
      energyType: gas ? "gas" : "luz",
      accessTariff: d.accessTariff.value ?? w.supply.accessTariff,
      days: d.days.value ?? w.supply.days,
      basis: "periode_facturat",
      kwh,
      kwhTotal: gas ? (kwh[0] ?? sum) : sum,
      kw: d.kw.map((f) => f.value),
      meterRentEurMonth: d.meterRentEur.value != null && d.days.value ? Math.round(((d.meterRentEur.value * 30.4167) / d.days.value) * 100) / 100 : w.supply.meterRentEurMonth,
      surplus,
      periodFrom: d.periodFrom.value ?? null,
      periodTo: d.periodTo.value ?? null,
    },
    current: {
      ...emptySheet(),
      contractType: ep.filter((x) => x != null).length === 1 && !gas ? "fix24h" : "periodes",
      energy: gas ? Array(6).fill(null) : ep,
      energy24h: gas ? ep[0] : ep.filter((x) => x != null).length === 1 ? ep.find((x) => x != null)! : null,
      power: pp,
      powerUnit: "eur_kw_dia",
      gasFixedEurDay: d.gasFixedEurDay.value,
      sas: { mode: d.sasEurKwh.value != null ? "variable" : "inclos", eurKwh: d.sasEurKwh.value },
      surplus: currentSurplus,
    },
    sources: { kwh: "factura", kw: "factura", prices: "factura" },
    dataNotes: [`Dades de la factura (${meta.pages} pàg., lectura ${meta.method === "text" ? "del text" : meta.method === "ia" ? "visual amb IA" : "text + IA"}), període de ${d.days.value ?? "?"} dies.`, ...meta.warnings],
  });
}

function StepOrigin() {
  const w = useWizard();
  const contracts = useApp((s) => s.contracts);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (serverMode()) invoiceStatus().then((r) => setAi(r.ai)).catch(() => setAi(false));
  }, []);
  const matches = useMemo(() => (q.length < 2 ? [] : contracts.filter((c) => `${c.cliente} ${c.cups ?? ""} ${c.cif ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6)), [q, contracts]);

  const cards: { id: Mode; title: string; body: string; icon: React.ReactNode }[] = [
    { id: "factura", title: "Adjuntar factura", body: "PDF digital o escanejat, JPG, PNG, HEIC o TIFF. S'extreuen titular, CUPS, consums, potències i preus.", icon: <ScanLine size={20} /> },
    { id: "cups", title: "Només el CUPS", body: "Dades del SIPS (consum anual i mensual, tarifa, potències). Compara les ofertes entre elles: sense preus actuals no hi ha estalvi.", icon: <Search size={20} /> },
    { id: "cups_preus", title: "CUPS + preus manuals", body: "Dades tècniques del SIPS i preus actuals introduïts pel comercial per calcular l'estalvi.", icon: <Zap size={20} /> },
    { id: "manual", title: "Completament manual", body: "Formulari complet, sense factura ni SIPS.", icon: <Keyboard size={20} /> },
  ];

  const loadCups = async (mode: Mode) => {
    const cups = normalizedCups(w.cups);
    if (!isValidCups(cups)) return setError("CUPS no vàlid: calen 20 o 22 caràcters (ES + 16 xifres + 2 lletres).");
    if (!serverMode()) return setError("La consulta SIPS necessita el servidor de la plataforma.");
    setBusy("Consultant el SIPS…");
    setError(null);
    try {
      let { entry } = await energyApi.supply(cups);
      if (!entry || entry.status !== "found") entry = (await energyApi.refresh(w.cups, false)).entry;
      if (entry.status !== "found") throw new Error(entry.error ?? "El SIPS no retorna dades per a aquest CUPS.");
      const gas = entry.energy_type === "gas" || /^RL/i.test(entry.tariff ?? "");
      const tariff = normalizeTariff(entry.tariff) ?? (gas ? "RL.1" : "2.0TD");
      w.set({
        cups: entry.returned_cups ?? cups,
        client: { ...w.client, address: w.client.address ?? entry.address ?? null },
        currentRetailer: w.currentRetailer || entry.retailer || "",
        supply: { ...w.supply, energyType: gas ? "gas" : "luz", accessTariff: tariff, basis: "anual", days: 365, periodFrom: null, periodTo: null, kwhTotal: entry.annual_kwh ?? null, kwh: Array(6).fill(null), kw: entry.contracted_power_kw ?? Array(6).fill(null) },
        sources: { kwhTotal: "sips", kw: "sips" },
        current: mode === "cups" ? null : (w.current ?? emptySheet()),
        dataNotes: [
          `Dades del SIPS consultades el ${new Date(entry.consulted_at).toLocaleDateString("ca-ES")}: consum anual ${entry.annual_kwh != null ? `${Math.round(entry.annual_kwh).toLocaleString("ca-ES")} kWh` : "no informat"}.`,
          "El SIPS no desglossa el consum per períodes P1–P6: les ofertes per períodes necessiten el repartiment (factura) o queden com a no calculables.",
        ],
        step: 2,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <label className="label" htmlFor="cmp-contract">Vincula-la a un contracte del CRM (opcional)</label>
        <div className="relative max-w-xl">
          <input id="cmp-contract" className="input" placeholder="Cerca client, CUPS o NIF…" value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.length > 0 && (
            <ul className="absolute left-0 right-0 top-11 z-20 rounded-xl border border-line bg-surface p-1 shadow-lift">
              {matches.map((c) => (
                <li key={c.id}>
                  <button className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-ink/[0.05]" onClick={() => { applyContract(c.id); setQ(""); }}>
                    <b>{titleCase(c.cliente)}</b> <span className="text-muted">· {c.cups ?? c.cif} · {c.tarifa}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {w.contractId && <p className="mt-2 text-[12.5px] text-ren">Vinculada a {w.client.name}. La proposta quedarà registrada al seu historial.</p>}
      </section>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <button key={c.id} onClick={() => { w.set({ mode: c.id }); if (c.id === "manual") w.set({ step: 2, current: w.current ?? emptySheet() }); }} className={cn("pressable flex h-full flex-col gap-2 rounded-2xl border bg-surface p-4 text-left shadow-card", w.mode === c.id ? "border-brand ring-2 ring-brand/20" : "border-line hover:border-ink/25")}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">{c.icon}</span>
            <span className="font-semibold">{c.title}</span>
            <span className="text-[12.5px] text-muted">{c.body}</span>
          </button>
        ))}
      </div>
      {w.mode === "factura" && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          {!serverMode() && <Notice>La lectura de factures necessita el servidor de la plataforma. Fes servir el mode manual.</Notice>}
          {serverMode() && ai === false && <Notice tone="blue">La lectura amb IA no està activada: es llegeix el text dels PDF digitals. Per a factures escanejades o fotos, l&apos;administrador ha d&apos;activar INVOICE_AI_ENABLED.</Notice>}
          <DropZone
            className="mt-3"
            accept={ACCEPTED_INVOICE}
            disabled={!!busy || !serverMode()}
            onReject={setError}
            onFiles={async ([f]) => {
              setError(null);
              try {
                const r = await uploadAndExtract(f, setBusy);
                applyInvoice(r.data, r);
                w.set({ step: 2 });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(null);
              }
            }}
          >
            <FileText className="text-brand" />
            <span className="font-medium">Arrossega la factura aquí o fes clic per seleccionar-la</span>
            <span className="text-[12px] text-muted">PDF, JPG, PNG, HEIC o TIFF · màx. 10 MB · es desa de manera privada i s&apos;esborra al cap de 90 dies</span>
          </DropZone>
        </section>
      )}
      {(w.mode === "cups" || w.mode === "cups_preus") && (
        <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4">
          <div className="min-w-[280px] flex-1">
            <label className="label" htmlFor="cmp-cups">CUPS (llum o gas, amb o sense sufix)</label>
            <input id="cmp-cups" className="input font-mono" value={w.cups} onChange={(e) => w.set({ cups: e.target.value })} placeholder="ES0021…" />
          </div>
          <Button variant="primary" disabled={!!busy} onClick={() => loadCups(w.mode!)}><Search size={15} /> Consulta el SIPS</Button>
          <Button variant="ghost" onClick={() => useApp.getState().navigate("sips")}>Cerca per adreça</Button>
        </section>
      )}
      {busy && <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> {busy}</p>}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}
