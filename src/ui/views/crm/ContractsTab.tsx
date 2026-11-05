"use client";
/** Pestanya CONTRACTES: vigents, renovació pendent, en tramitació i anteriors; historial per subministrament i renovacions. */
import { AgendaQuickActions, CONTRACT_ACTIONS } from "../agenda/Linked";
import { RetailerInput } from "../retailers/options";
import { CupsLink } from "../../components/Navigation";
import { useState } from "react";
import { ArrowRight, Calculator, Euro, FileSignature, History, KanbanSquare, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import {
  CONTRACT_GROUP, CONTRACT_STATUSES, CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, PRICE_TYPES, PRICE_TYPE_LABEL, contractInput,
  type ContractStatus, type CrmContract,
} from "@/core/crm";
import { daysUntil, fmtDate } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, SupplierMark, cn } from "../../components/ui";
import { crmApi } from "./api";
import type { Ctx } from "./ClientDetail";
import { ContractEconomicsDialog } from "../finance/ContractEconomics";
import { ExportButton } from "../../components/ExportButton";

const GROUPS = [
  { id: "vigent", label: "Vigents" },
  { id: "renovacio", label: "Renovació pendent" },
  { id: "tramitacio", label: "En tramitació" },
  { id: "anterior", label: "Anteriors" },
] as const;

export function ContractsTab({ ctx }: { ctx: Ctx }) {
  const { d, reload } = ctx;
  const [edit, setEdit] = useState<{ contract: CrmContract | null; renewOf?: CrmContract } | null>(null);
  const [finance, setFinance] = useState<CrmContract | null>(null);
  const [econ, setEcon] = useState<string | null>(null);
  const cupsOf = (id: string | null) => d.supplies.find((s) => s.id === id)?.cups ?? null;
  const byId = new Map(d.contracts.map((k) => [k.id, k]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Cada renovació crea un contracte nou enllaçat amb l&apos;anterior: l&apos;historial no es sobreescriu mai.</p>
        <div className="flex gap-2">
          {d.contracts.length > 0 && <ExportButton size="md" set="contractes" params={{ l_client_id: d.client.id }} label="Contractes a Excel" />}
          {d.permissions.canEdit && <Button variant="primary" onClick={() => setEdit({ contract: null })}><Plus size={15} /> Nou contracte</Button>}
        </div>
      </div>
      {d.contracts.length === 0 ? (
        <Empty icon={<FileSignature size={24} />} title="Encara no hi ha contractes" body="Crea'n un i enllaça'l amb un subministrament. Si és actiu i té data de renovació, apareixerà també a Renovacions." action={d.permissions.canEdit ? <Button variant="primary" size="sm" onClick={() => setEdit({ contract: null })}><Plus size={13} /> Nou contracte</Button> : undefined} />
      ) : GROUPS.map((g) => {
        const list = d.contracts.filter((k) => CONTRACT_GROUP[k.status] === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id}>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{g.label} · {list.length}</h3>
            <div className="space-y-2">
              {list.map((k) => {
                const days = k.end_date ? daysUntil(k.end_date) : null;
                const prev = k.previous_contract_id ? byId.get(k.previous_contract_id) : null;
                const docs = d.documents.filter((x) => x.contract_id === k.id).length;
                return (
                  <article key={k.id} className="rounded-2xl border border-line bg-surface p-3.5">
                    <div className="flex flex-wrap items-start gap-3">
                      <SupplierMark name={k.retailer} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{k.retailer}{k.product ? <span className="font-normal text-muted"> · {k.product}</span> : null}</p>
                        <p className="text-[12px] text-muted">
                          {cupsOf(k.supply_id) ? <CupsLink cups={cupsOf(k.supply_id)} /> : "Sense subministrament"}{k.access_tariff ? ` · ${k.access_tariff}` : ""}{k.price_type ? ` · ${PRICE_TYPE_LABEL[k.price_type]}` : ""}
                        </p>
                      </div>
                      <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{CONTRACT_STATUS_LABEL[k.status]}</Badge>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
                      <div><p className="text-[11px] text-muted">Signatura</p><p>{fmtDate(k.signed_at)}</p></div>
                      <div><p className="text-[11px] text-muted">Inici</p><p>{fmtDate(k.start_date)}</p></div>
                      <div><p className="text-[11px] text-muted">Finalització / renovació</p><p className={cn(days != null && days <= 30 && (g.id === "vigent" || g.id === "renovacio") && "font-medium text-lost")}>{fmtDate(k.end_date)}{days != null && days >= 0 && (g.id === "vigent" || g.id === "renovacio") ? ` · ${days} dies` : ""}</p></div>
                      <div><p className="text-[11px] text-muted">Documents</p><p>{docs}</p></div>
                    </div>
                    {k.notes && <p className="mt-2 whitespace-pre-wrap text-[12px] text-muted">{k.notes}</p>}
                    {prev && <p className="mt-2 flex items-center gap-1 text-[11.5px] text-muted"><History size={12} /> Renovació de: {prev.retailer}{prev.product ? ` · ${prev.product}` : ""} ({fmtDate(prev.start_date ?? prev.signed_at)} <ArrowRight size={10} /> {fmtDate(prev.end_date)})</p>}
                    {k.finance && (
                      <p className="mt-2 flex items-center gap-1 text-[11.5px] text-muted"><Euro size={12} /> {k.finance.commission_eur != null ? `Comissió ${k.finance.commission_eur.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })}` : ""}{k.finance.commission_pct != null ? ` · ${k.finance.commission_pct} %` : ""}{k.finance.annual_amount_eur != null ? ` · Import anual ${k.finance.annual_amount_eur.toLocaleString("ca-ES", { style: "currency", currency: "EUR" })}` : ""}{k.finance.commission_paid_at ? ` · Pagada el ${fmtDate(k.finance.commission_paid_at)}` : ""}</p>
                    )}
                    <div className="mt-2"><AgendaQuickActions compact actions={CONTRACT_ACTIONS(`${d.client.name} · ${k.retailer}`)} base={{ client: { id: d.client.id, name: d.client.name }, contract_id: k.id, renewal_id: k.legacy_contract_id ?? null, context: `${k.retailer}${k.product ? ` · ${k.product}` : ""}` }} /></div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {d.permissions.canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit({ contract: k })}><Pencil size={13} /> Edita</Button>}
                      {d.permissions.canEdit && (g.id === "vigent" || g.id === "renovacio") && <Button size="sm" onClick={() => setEdit({ contract: null, renewOf: k })}><RefreshCw size={13} /> Renova</Button>}
                      {d.permissions.isStaff && <Button size="sm" variant="ghost" onClick={() => setFinance(k)}><Euro size={13} /> Dades econòmiques</Button>}
                      {(d.permissions.isStaff || d.permissions.canEdit) && <Button size="sm" variant="ghost" onClick={() => setEcon(k.id)}><Calculator size={13} /> Economia i comissions</Button>}
                      {(k.legacy_contract_id || ((g.id === "vigent" || g.id === "renovacio") && k.end_date)) && (
                        <Button size="sm" variant="ghost" onClick={() => { const id = k.legacy_contract_id ?? `crm:${k.id}`; if (useApp.getState().byId[id]) { useApp.getState().navigate("kanban"); useApp.getState().open(id); } else useApp.getState().toast({ title: "Encara no és a Renovacions", body: "Apareixerà després de la propera càrrega de dades (recarrega la pàgina).", tone: "info" }); }}><KanbanSquare size={13} /> Veure a Renovacions</Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {edit && <ContractForm ctx={ctx} contract={edit.contract} renewOf={edit.renewOf} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
      {econ && <ContractEconomicsDialog contractId={econ} onClose={() => { setEcon(null); void reload(); }} />}
      {finance && <FinanceForm ctx={ctx} contract={finance} onClose={() => setFinance(null)} onSaved={() => { setFinance(null); void reload(); }} />}
    </div>
  );
}

export function ContractForm({ ctx, contract, renewOf, supplyId, initial, onClose, onSaved }: { ctx: Ctx; contract: CrmContract | null; renewOf?: CrmContract; supplyId?: string; initial?: { status?: ContractStatus; notes?: string; retailer?: string; product?: string }; onClose: () => void; onSaved: (id?: string) => void }) {
  const { d, facets } = ctx;
  const base = contract ?? renewOf ?? null;
  const supply = d.supplies.find((s) => s.id === (supplyId ?? base?.supply_id));
  const [f, setF] = useState({
    supply_id: supplyId ?? base?.supply_id ?? "",
    retailer: contract?.retailer ?? renewOf?.retailer ?? initial?.retailer ?? supply?.current_retailer ?? "",
    product: contract?.product ?? initial?.product ?? "",
    price_type: contract?.price_type ?? "",
    access_tariff: contract?.access_tariff ?? renewOf?.access_tariff ?? supply?.access_tariff ?? "",
    signed_at: contract?.signed_at ?? "",
    start_date: contract?.start_date ?? (renewOf?.end_date ?? ""),
    end_date: contract?.end_date ?? "",
    status: (contract?.status ?? initial?.status ?? (renewOf ? "actiu" : "esborrany")) as ContractStatus,
    owner_id: contract?.owner_id ?? renewOf?.owner_id ?? d.client.owner_id ?? "",
    notes: contract?.notes ?? initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const closed = contract && (contract.status === "finalitzat" || contract.status === "anullat") && !d.permissions.isStaff;
  const save = async () => {
    const data = { ...f, supply_id: f.supply_id || null, price_type: f.price_type || null, owner_id: f.owner_id || null, signed_at: f.signed_at || null, start_date: f.start_date || null, end_date: f.end_date || null };
    const v = contractInput.safeParse(data);
    if (!v.success) { setErr([...new Set(v.error.issues.map((i) => i.message))].join(" · ")); return; }
    setBusy(true); setErr(null);
    try {
      const r = await crmApi.action({ entity: "contract", action: contract ? "update" : renewOf ? "renew" : "create", clientId: d.client.id, id: contract?.id ?? renewOf?.id, data });
      useApp.getState().toast({ title: contract ? "Contracte actualitzat" : renewOf ? "Renovació registrada" : "Contracte creat", body: (f.status === "actiu" || f.status === "renovacio_pendent") && f.end_date ? "Apareixerà a Renovacions amb la data de venciment." : undefined, tone: "ok" });
      onSaved(r.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || ["admin", "cap_administrativa", "administrativa"].includes(u.role));
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={contract ? `Contracte · ${contract.retailer}` : renewOf ? `Renovació de ${renewOf.retailer}` : "Nou contracte"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !!closed} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        {renewOf && <div className="sm:col-span-2"><Notice tone="blue">Es crearà un contracte nou. L&apos;anterior ({renewOf.retailer}, fins al {fmtDate(renewOf.end_date)}) passarà a «Finalitzat» si el nou és actiu, i es conserva a l&apos;historial.</Notice></div>}
        {closed && <div className="sm:col-span-2"><Notice>Contracte tancat: només Administració o Direcció el poden corregir. Per a una renovació, crea&apos;n un de nou.</Notice></div>}
        <label className="block sm:col-span-2"><span className="label">Subministrament</span>
          <select className="input" value={f.supply_id} onChange={(e) => { const s = d.supplies.find((x) => x.id === e.target.value); set({ supply_id: e.target.value, access_tariff: f.access_tariff || s?.access_tariff || "" }); }}>
            <option value="">Sense subministrament</option>
            {d.supplies.filter((s) => !s.archived_at).map((s) => <option key={s.id} value={s.id}>{s.cups} · {s.energy_type === "gas" ? "Gas" : "Llum"}{s.address ? ` · ${s.address}` : ""}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Comercialitzadora *</span><RetailerInput value={f.retailer} onChange={(v) => set({ retailer: v })} /></label>
        <label className="block"><span className="label">Producte</span><input className="input" value={f.product} onChange={(e) => set({ product: e.target.value })} /></label>
        <label className="block"><span className="label">Tipus de tarifa</span><select className="input" value={f.price_type} onChange={(e) => set({ price_type: e.target.value })}><option value="">—</option>{PRICE_TYPES.map((p) => <option key={p} value={p}>{PRICE_TYPE_LABEL[p]}</option>)}</select></label>
        <label className="block"><span className="label">Tarifa d&apos;accés</span><input className="input" value={f.access_tariff} onChange={(e) => set({ access_tariff: e.target.value })} placeholder="2.0TD" /></label>
        <label className="block"><span className="label">Data de signatura</span><input type="date" className="input" value={f.signed_at} onChange={(e) => set({ signed_at: e.target.value })} /></label>
        <label className="block"><span className="label">Inici del subministrament</span><input type="date" className="input" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} /></label>
        <label className="block"><span className="label">Finalització o renovació{f.status === "actiu" || f.status === "renovacio_pendent" ? " *" : ""}</span><input type="date" className="input" value={f.end_date} onChange={(e) => set({ end_date: e.target.value })} /></label>
        <label className="block"><span className="label">Estat</span><select className="input" value={f.status} onChange={(e) => set({ status: e.target.value as ContractStatus })}>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="block"><span className="label">Comercial responsable</span>
          {d.permissions.isStaff ? <select className="input" value={f.owner_id} onChange={(e) => set({ owner_id: e.target.value })}><option value="">—</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            : <input className="input" disabled value={owners.find((u) => u.id === f.owner_id)?.name ?? "—"} />}
        </label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><textarea className="input min-h-[70px]" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        {err && <p className="rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
    </Modal>
  );
}

function FinanceForm({ ctx, contract, onClose, onSaved }: { ctx: Ctx; contract: CrmContract; onClose: () => void; onSaved: () => void }) {
  const fin = contract.finance;
  const [f, setF] = useState({ annual_amount_eur: fin?.annual_amount_eur?.toString() ?? "", commission_eur: fin?.commission_eur?.toString() ?? "", commission_pct: fin?.commission_pct?.toString() ?? "", commission_paid_at: fin?.commission_paid_at ?? "", notes: fin?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await crmApi.action({ entity: "contract", action: "finance", clientId: ctx.d.client.id, id: contract.id, data: { ...f, commission_paid_at: f.commission_paid_at || null } }); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Dades econòmiques · ${contract.retailer}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <p className="text-[12px] text-muted sm:col-span-2">Només ho veuen Administració, Direcció i el comercial responsable del contracte. No surt mai a les propostes del client.</p>
        <label className="block"><span className="label">Import anual estimat (€)</span><input className="input tnum" inputMode="decimal" value={f.annual_amount_eur} onChange={(e) => setF({ ...f, annual_amount_eur: e.target.value })} /></label>
        <label className="block"><span className="label">Comissió (€)</span><input className="input tnum" inputMode="decimal" value={f.commission_eur} onChange={(e) => setF({ ...f, commission_eur: e.target.value })} /></label>
        <label className="block"><span className="label">Comissió (%)</span><input className="input tnum" inputMode="decimal" value={f.commission_pct} onChange={(e) => setF({ ...f, commission_pct: e.target.value })} /></label>
        <label className="block"><span className="label">Data de cobrament</span><input type="date" className="input" value={f.commission_paid_at} onChange={(e) => setF({ ...f, commission_paid_at: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {err && <p className="text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
    </Modal>
  );
}
