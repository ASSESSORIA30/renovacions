"use client";
/** Pestanya SUBMINISTRAMENTS: punts (CUPS) del client, llum i gas, amb alta manual o a partir del SIPS. */
import { CupsLink } from "../../components/Navigation";
import { useState } from "react";
import { Archive, DatabaseZap, FileSignature, Flame, Gauge, Loader2, MapPin, Pencil, Plus, RotateCcw, Sparkles, Zap } from "lucide-react";
import {
  CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, DATA_SOURCE_LABEL, SUPPLY_STATUSES, SUPPLY_STATUS_LABEL, normalizeCupsFull, supplyInput, validCupsFull,
  type CrmSupply, type DataSource,
} from "@/core/crm";
import { normalizeTariff, periodsOf } from "@/comparator/engine";
import { fmtDate } from "@/core/dates";
import { energyApi } from "@/energy/api";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, SupplierMark, cn } from "../../components/ui";
import { crmApi } from "./api";
import type { Ctx } from "./ClientDetail";
import { ContractForm } from "./ContractsTab";
import { ExportButton } from "../../components/ExportButton";

const TARIFFS = ["2.0TD", "3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD"];
const GAS_TARIFFS = Array.from({ length: 11 }, (_, i) => `RL.${i + 1}`);
const nf = (n: number | null | undefined, d = 0) => (n == null ? "—" : n.toLocaleString("ca-ES", { maximumFractionDigits: d }));

export function SuppliesTab({ ctx }: { ctx: Ctx }) {
  const { d, reload } = ctx;
  const [edit, setEdit] = useState<CrmSupply | "new" | null>(null);
  const [newContract, setNewContract] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = d.supplies.filter((s) => showArchived || !s.archived_at);
  const archivedCount = d.supplies.filter((s) => s.archived_at).length;
  const toggleArchive = async (s: CrmSupply) => {
    if (!s.archived_at && !confirm(`Arxivar el subministrament ${s.cups}? Es conserva l'historial i es pot restaurar.`)) return;
    try { await crmApi.action({ entity: "supply", action: s.archived_at ? "restore" : "archive", clientId: d.client.id, id: s.id }); await reload(); }
    catch (e) { useApp.getState().toast({ title: "No s'ha pogut fer", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">El CUPS identifica el punt de subministrament; els contractes s&apos;hi enllacen al llarg del temps.</p>
        <div className="flex items-center gap-3">
          {archivedCount > 0 && <label className="flex items-center gap-1.5 text-[12.5px] text-muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostra arxivats ({archivedCount})</label>}
          {list.length > 0 && <ExportButton size="md" set="subministraments" params={{ l_client_id: d.client.id, archived: showArchived }} label="Subministraments a Excel" />}
          {d.permissions.canEdit && <Button variant="primary" onClick={() => setEdit("new")}><Plus size={15} /> Nou subministrament</Button>}
        </div>
      </div>
      {list.length === 0 ? (
        <Empty icon={<Zap size={24} />} title="Aquest client encara no té subministraments" body="Afegeix els seus punts de llum o gas. Pots omplir les dades a partir del SIPS o introduir-les a mà." action={d.permissions.canEdit ? <Button variant="primary" size="sm" onClick={() => setEdit("new")}><Plus size={13} /> Afegeix el primer</Button> : undefined} />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {list.map((s) => {
            const gas = s.energy_type === "gas";
            const current = d.contracts.find((k) => k.id === s.current_contract_id);
            const per = periodsOf(s.access_tariff, s.energy_type);
            const powers = (s.power_kw ?? []).slice(0, per.power);
            return (
              <article key={s.id} className={cn("rounded-2xl border border-line bg-surface p-4", s.archived_at && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", gas ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}>{gas ? <Flame size={19} /> : <Zap size={19} />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold tracking-tight"><CupsLink cups={s.cups} /></p>
                    <p className="flex items-center gap-1 truncate text-[12px] text-muted"><MapPin size={12} /> {[s.address, s.postal_code, s.city].filter(Boolean).join(", ") || "Sense adreça"}</p>
                  </div>
                  <Badge tone={s.status === "actiu" ? "green" : s.status === "pendent_alta" ? "amber" : "zinc"}>{SUPPLY_STATUS_LABEL[s.status]}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
                  <div><dt className="text-[11px] text-muted">Tarifa</dt><dd className="font-medium">{s.access_tariff ?? "—"}</dd></div>
                  <div><dt className="text-[11px] text-muted">Comercialitzadora</dt><dd className="flex items-center gap-1 truncate">{s.current_retailer ? <><SupplierMark name={s.current_retailer} size={16} /> {s.current_retailer}</> : "—"}</dd></div>
                  <div><dt className="text-[11px] text-muted">Consum anual</dt><dd className="font-medium tnum">{s.annual_kwh != null ? `${nf(s.annual_kwh)} kWh` : "—"}</dd></div>
                  <div><dt className="text-[11px] text-muted">{gas ? "Titular" : "Potències (kW)"}</dt><dd className="truncate tnum">{gas ? s.holder_name ?? "—" : powers.some((p) => p != null) ? powers.map((p, i) => `P${i + 1} ${nf(p, 3)}`).join(" · ") : "—"}</dd></div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5 text-[12px]">
                  {current ? <span className="inline-flex items-center gap-1.5"><FileSignature size={13} className="text-muted" /> {current.retailer}{current.product ? ` · ${current.product}` : ""} <Badge tone={CONTRACT_STATUS_TONE[current.status]}>{CONTRACT_STATUS_LABEL[current.status]}</Badge>{current.end_date && <span className="text-muted">fins al {fmtDate(current.end_date)}</span>}</span> : <span className="text-muted">Sense contracte vigent al CRM</span>}
                  <span className="ml-auto text-[11px] text-muted">Dades: {DATA_SOURCE_LABEL[s.data_source]} · {fmtDate(s.data_updated_at.slice(0, 10))}</span>
                </div>
                {!s.archived_at && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => useApp.getState().analyzeCups(s.cups.slice(0, 20))}><Gauge size={13} /> Anàlisi energètica</Button>
                    <Button size="sm" onClick={() => useApp.getState().navigate("comparativa", { client: d.client.id, supply: s.id })}><Sparkles size={13} /> Comparativa</Button>
                    {d.permissions.canEdit && <Button size="sm" onClick={() => setNewContract(s.id)}><FileSignature size={13} /> Contracte</Button>}
                    {d.permissions.canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit(s)}><Pencil size={13} /> Edita</Button>}
                    {d.permissions.canEdit && <Button size="sm" variant="ghost" className="ml-auto text-muted" onClick={() => toggleArchive(s)}><Archive size={13} /> Arxiva</Button>}
                  </div>
                )}
                {s.archived_at && d.permissions.canEdit && <Button size="sm" variant="ghost" className="mt-2" onClick={() => toggleArchive(s)}><RotateCcw size={13} /> Restaura</Button>}
              </article>
            );
          })}
        </div>
      )}
      {edit && <SupplyForm ctx={ctx} supply={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
      {newContract && <ContractForm ctx={ctx} contract={null} supplyId={newContract} onClose={() => setNewContract(null)} onSaved={() => { setNewContract(null); void reload(); }} />}
    </div>
  );
}

type F = { cups: string; energy_type: "luz" | "gas"; address: string; postal_code: string; city: string; province: string; holder_name: string; current_retailer: string; access_tariff: string; power_kw: string[]; annual_kwh: string; period_kwh: string[]; status: string; data_source: DataSource; notes: string };
const toF = (s: CrmSupply | null, clientName: string, addr: { address: string | null; postal_code: string | null; city: string | null; province: string | null }): F => ({
  cups: s?.cups ?? "", energy_type: s?.energy_type ?? "luz", address: s?.address ?? addr.address ?? "", postal_code: s?.postal_code ?? addr.postal_code ?? "", city: s?.city ?? addr.city ?? "", province: s?.province ?? addr.province ?? "",
  holder_name: s?.holder_name ?? clientName, current_retailer: s?.current_retailer ?? "", access_tariff: s?.access_tariff ?? "2.0TD",
  power_kw: Array.from({ length: 6 }, (_, i) => (s?.power_kw?.[i] != null ? String(s.power_kw[i]) : "")), annual_kwh: s?.annual_kwh != null ? String(s.annual_kwh) : "",
  period_kwh: Array.from({ length: 6 }, (_, i) => (s?.period_kwh?.[i] != null ? String(s.period_kwh[i]) : "")), status: s?.status ?? "actiu", data_source: s?.data_source ?? "manual", notes: s?.notes ?? "",
});

function SupplyForm({ ctx, supply, onClose, onSaved }: { ctx: Ctx; supply: CrmSupply | null; onClose: () => void; onSaved: () => void }) {
  const c = ctx.d.client;
  const [f, setF] = useState<F>(() => toF(supply, c.name, c));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sipsNote, setSipsNote] = useState<string | null>(null);
  const set = (p: Partial<F>) => setF((x) => ({ ...x, ...p }));
  const gas = f.energy_type === "gas";
  const per = periodsOf(f.access_tariff, f.energy_type);
  const cupsOk = validCupsFull(f.cups);

  const fromSips = async () => {
    setBusy("Consultant el SIPS…"); setErr(null);
    try {
      const cups = normalizeCupsFull(f.cups).slice(0, 20);
      let { entry } = await energyApi.supply(cups);
      if (!entry || entry.status !== "found") entry = (await energyApi.refresh(cups, false)).entry;
      if (!entry || entry.status !== "found") throw new Error(entry?.error ?? "El SIPS no retorna dades per a aquest CUPS");
      const isGas = entry.energy_type === "gas" || /^RL/i.test(entry.tariff ?? "");
      const tariff = normalizeTariff(entry.tariff) ?? (isGas ? "RL.1" : "2.0TD");
      set({
        cups: entry.returned_cups ?? f.cups, energy_type: isGas ? "gas" : "luz", access_tariff: tariff, current_retailer: entry.retailer ?? f.current_retailer,
        address: entry.address ?? f.address, annual_kwh: entry.annual_kwh != null ? String(Math.round(entry.annual_kwh)) : f.annual_kwh,
        power_kw: Array.from({ length: 6 }, (_, i) => (entry!.contracted_power_kw?.[i] != null ? String(entry!.contracted_power_kw[i]) : "")), data_source: "sips",
      });
      setSipsNote(`Dades del SIPS consultades el ${new Date(entry.consulted_at).toLocaleDateString("ca-ES")}. Revisa-les abans de desar.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    const data = { ...f, power_kw: gas ? null : f.power_kw.slice(0, per.power).map((x) => x.trim() || null), period_kwh: f.period_kwh.slice(0, per.energy).map((x) => x.trim() || null), annual_kwh: f.annual_kwh || null };
    const v = supplyInput.safeParse(data);
    if (!v.success) { setErr([...new Set(v.error.issues.map((i) => i.message))].join(" · ")); return; }
    setBusy("Desant…"); setErr(null);
    try { await crmApi.action({ entity: "supply", action: supply ? "update" : "create", clientId: c.id, id: supply?.id, data }); useApp.getState().toast({ title: supply ? "Subministrament actualitzat" : "Subministrament afegit", tone: "ok" }); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={supply ? `Subministrament · ${supply.cups}` : "Nou subministrament"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!!busy} onClick={save}>{busy === "Desant…" && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="space-y-4 text-[13px]">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="block"><span className="label">CUPS *</span>
            <input className={cn("input font-mono uppercase", f.cups && !cupsOk && "border-lost/60")} value={f.cups} onChange={(e) => set({ cups: e.target.value })} placeholder="ES0021000000000000AA" autoComplete="off" />
            {f.cups && !cupsOk && <span className="mt-1 block text-[11px] text-lost">Format: ES + 16 xifres + 2 lletres (sufix opcional de 2 caràcters)</span>}
          </label>
          <div className="flex rounded-xl border border-line p-0.5" role="radiogroup" aria-label="Tipus de servei">
            {(["luz", "gas"] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={f.energy_type === t} onClick={() => set({ energy_type: t, access_tariff: t === "gas" ? "RL.1" : "2.0TD" })} className={cn("flex items-center gap-1 rounded-lg px-3 py-1.5", f.energy_type === t ? "bg-ink/[0.07] font-medium" : "text-muted")}>{t === "gas" ? <Flame size={14} /> : <Zap size={14} />} {t === "gas" ? "Gas" : "Llum"}</button>)}
          </div>
          <Button disabled={!cupsOk || !!busy} onClick={fromSips} title="Opcional: omple les dades amb el SIPS">{busy === "Consultant el SIPS…" ? <Loader2 size={14} className="animate-spin" /> : <DatabaseZap size={14} />} Omple amb el SIPS</Button>
        </div>
        {sipsNote && <p className="rounded-lg bg-brand/[0.06] px-3 py-1.5 text-[12px] text-brand">{sipsNote}</p>}
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block sm:col-span-4"><span className="label">Adreça del punt</span><input className="input" value={f.address} onChange={(e) => set({ address: e.target.value })} /></label>
          <label className="block"><span className="label">Codi postal</span><input className="input" value={f.postal_code} onChange={(e) => set({ postal_code: e.target.value })} /></label>
          <label className="block"><span className="label">Municipi</span><input className="input" value={f.city} onChange={(e) => set({ city: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="label">Titular</span><input className="input" value={f.holder_name} onChange={(e) => set({ holder_name: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="label">Comercialitzadora actual</span><input className="input" value={f.current_retailer} onChange={(e) => set({ current_retailer: e.target.value })} /></label>
          <label className="block"><span className="label">Tarifa d&apos;accés</span><select className="input" value={f.access_tariff} onChange={(e) => set({ access_tariff: e.target.value })}>{(gas ? GAS_TARIFFS : TARIFFS).map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="block"><span className="label">Estat</span><select className="input" value={f.status} onChange={(e) => set({ status: e.target.value })}>{SUPPLY_STATUSES.map((s) => <option key={s} value={s}>{SUPPLY_STATUS_LABEL[s]}</option>)}</select></label>
        </div>
        {!gas && (
          <div>
            <span className="label">Potències contractades (kW)</span>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{Array.from({ length: per.power }, (_, i) => <input key={i} className="input tnum" inputMode="decimal" placeholder={`P${i + 1}`} aria-label={`Potència P${i + 1}`} value={f.power_kw[i]} onChange={(e) => set({ power_kw: f.power_kw.map((x, j) => (j === i ? e.target.value : x)) })} />)}</div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <label className="block"><span className="label">Consum anual (kWh)</span><input className="input tnum" inputMode="decimal" value={f.annual_kwh} onChange={(e) => set({ annual_kwh: e.target.value })} /></label>
          {!gas && per.energy > 1 && (
            <div>
              <span className="label">Consum per període (kWh, si es coneix)</span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{Array.from({ length: per.energy }, (_, i) => <input key={i} className="input tnum" inputMode="decimal" placeholder={`P${i + 1}`} aria-label={`Consum P${i + 1}`} value={f.period_kwh[i]} onChange={(e) => set({ period_kwh: f.period_kwh.map((x, j) => (j === i ? e.target.value : x)) })} />)}</div>
            </div>
          )}
        </div>
        <label className="block"><span className="label">Notes</span><input className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        <p className="text-[11.5px] text-muted">Font de les dades: <b>{DATA_SOURCE_LABEL[f.data_source]}</b>. Totes es poden introduir a mà; el SIPS és opcional.</p>
        {err && <p className="rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost">{err}</p>}
      </div>
    </Modal>
  );
}
