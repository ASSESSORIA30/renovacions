"use client";
/** Pestanya CONTRACTES: vigents, renovació pendent, en tramitació i anteriors; historial per subministrament i renovacions. */
import { AgendaQuickActions, CONTRACT_ACTIONS } from "../agenda/Linked";
import { useRetailerOptions } from "../retailers/options";
import { Combobox, type ComboOption } from "../../components/Combobox";
import { AVAILABILITY_LABEL, PENDING_CONDITIONS, provinceCodeOf, provinceName, retailerServes, type Availability } from "@/core/contract-availability";
import { matchesRetailer } from "@/core/retailers";
import { ConditionsCard, ConditionsEditor, useContractCatalog, type CascadeProduct, type EditorValue } from "./ContractConditions";
import { CurrentPricesCard } from "../renewals-auto/CurrentPrices";
import { emptyConditions, finalPrices } from "@/core/contract-conditions";
import { CupsLink } from "../../components/Navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, BellRing, Calculator, Euro, FileSignature, FolderOpen, History, KanbanSquare, Loader2, Pencil, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  FAMILY_LABEL, LINE_STATUS_LABEL, SERVICE_CARDS, SERVICE_FAMILY, STATUS_FLOW, contractAlerts, isEnergyService, serviceOf, serviceTotals, statusLabelFor, type ServiceFamily,
} from "@/core/multiservice";
import { COMMISSION_STATUS_LABEL, type CommissionStatus } from "@/core/service-commissions";
import { FamilyIcon } from "./multiservice/icons";
import { NewContractPicker, ServiceContractForm } from "./multiservice/ServiceForm";
import { CommissionStatusDialog, ContractDocsDialog } from "./multiservice/ContractDialogs";
import {
  CONTRACT_GROUP, CONTRACT_STATUSES, CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, PRICE_TYPES, PRICE_TYPE_LABEL, contractInput,
  type ContractLineRow, type ContractStatus, type CrmContract,
} from "@/core/crm";
import { daysUntil, fmtDate } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, SupplierMark, cn } from "../../components/ui";
import { crmApi } from "./api";
import type { Ctx } from "./ClientDetail";
import { ContractEconomicsDialog } from "../finance/ContractEconomics";
import { ExportButton } from "../../components/ExportButton";
import { GanaEntryButton, useGanaContracts } from "../gana/GanaButtons";
import { GanaQuickDialog } from "../gana/GanaQuick";
import { IberdrolaFlow } from "../iberdrola/IberdrolaFlow";
import { TramitacioBlock, emptyTram, type TramValue } from "../tramitacio/TramitacioBlock";
import { tramApi, type CheckView } from "../tramitacio/api";
import { procedureAction, type Procedure } from "@/core/tramitacio";

const GROUPS = [
  { id: "vigent", label: "Vigents" },
  { id: "renovacio", label: "Renovació pendent" },
  { id: "tramitacio", label: "En tramitació" },
  { id: "anterior", label: "Anteriors" },
] as const;

export function ContractsTab({ ctx }: { ctx: Ctx }) {
  const { d, reload } = ctx;
  const [edit, setEdit] = useState<{ contract: CrmContract | null; renewOf?: CrmContract } | null>(null);
  const tramFocus = useRef(false);   // obert des de «Enviar a Iberdrola per signar»: el formulari baixa al bloc de tramitació
  const [picker, setPicker] = useState(false);
  const [finance, setFinance] = useState<CrmContract | null>(null);
  const [econ, setEcon] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CrmContract | null>(null);
  const [docsOf, setDocsOf] = useState<CrmContract | null>(null);
  const [commission, setCommission] = useState<CrmContract | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const gana = useGanaContracts(d.client.id, d);   // 050: botó «Enviar contracte a Gana Energía» quan la tarifa és del catàleg de Gana
  const [flt, setFlt] = useState<{ family: ServiceFamily | ""; provider: string; status: ContractStatus | ""; expiry: "" | "30" | "60" | "90" }>({ family: "", provider: "", status: "", expiry: "" });
  const cupsOf = (id: string | null) => d.supplies.find((s) => s.id === id)?.cups ?? null;
  const energyOf = (id: string | null) => d.supplies.find((s) => s.id === id)?.energy_type ?? null;
  const byId = new Map(d.contracts.map((k) => [k.id, k]));
  const svc = (k: CrmContract) => serviceOf(k, energyOf(k.supply_id) as "luz" | "gas" | null, d.client.kind);
  const today = new Date().toISOString().slice(0, 10);
  const families = SERVICE_CARDS.map((c) => c.family).filter((f) => d.contracts.some((k) => SERVICE_FAMILY[svc(k)] === f));
  const keyDate = (k: CrmContract) => [k.end_date, k.permanence_end].filter(Boolean).sort()[0] ?? null;
  const shown = d.contracts.filter((k) => {
    if (flt.family && SERVICE_FAMILY[svc(k)] !== flt.family) return false;
    if (flt.provider && !k.retailer.toLowerCase().includes(flt.provider.toLowerCase())) return false;
    if (flt.status && k.status !== flt.status) return false;
    if (flt.expiry) { const kd = keyDate(k); const n = kd ? daysUntil(kd) : null; if (n == null || n < 0 || n > Number(flt.expiry)) return false; }
    return true;
  });
  const openEdit = (k: CrmContract | null, renewOf?: CrmContract) => {
    const ref = k ?? renewOf;
    if (!ref) { setPicker(true); return; }
    setEdit({ contract: k, renewOf });
  };
  const filtered = flt.family || flt.provider || flt.status || flt.expiry;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Cada servei és un contracte propi i cada renovació en crea un de nou enllaçat amb l&apos;anterior: l&apos;historial no es sobreescriu mai.</p>
        <div className="flex gap-2">
          {d.contracts.length > 0 && <ExportButton size="md" set="contractes" params={{ l_client_id: d.client.id }} label="Contractes a Excel" />}
          {d.permissions.canEdit && <Button variant="primary" onClick={() => setPicker(true)}><Plus size={15} /> Nou contracte</Button>}
        </div>
      </div>
      {families.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {families.map((f) => {
            const n = d.contracts.filter((k) => SERVICE_FAMILY[svc(k)] === f && CONTRACT_GROUP[k.status] !== "anterior").length;
            return (
              <button key={f} type="button" onClick={() => setFlt({ ...flt, family: flt.family === f ? "" : f })}
                className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]", flt.family === f ? "border-accent bg-accent/10 font-semibold" : "border-line")}>
                <FamilyIcon family={f} size={13} /> {FAMILY_LABEL[f]} · {n}
              </button>
            );
          })}
        </div>
      )}
      {d.contracts.length > 2 && (
        <div className="grid gap-2 text-[12.5px] sm:grid-cols-4">
          <select className="input" aria-label="Servei" value={flt.family} onChange={(e) => setFlt({ ...flt, family: e.target.value as ServiceFamily | "" })}><option value="">Tots els serveis</option>{SERVICE_CARDS.map((c) => <option key={c.family} value={c.family}>{FAMILY_LABEL[c.family]}</option>)}</select>
          <input className="input" aria-label="Proveïdor" placeholder="Proveïdor…" value={flt.provider} onChange={(e) => setFlt({ ...flt, provider: e.target.value })} />
          <select className="input" aria-label="Estat" value={flt.status} onChange={(e) => setFlt({ ...flt, status: e.target.value as ContractStatus | "" })}><option value="">Tots els estats</option>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>)}</select>
          <select className="input" aria-label="Venciment" value={flt.expiry} onChange={(e) => setFlt({ ...flt, expiry: e.target.value as "" })}><option value="">Qualsevol venciment</option><option value="30">Venç o acaba permanència en 30 dies</option><option value="60">… en 60 dies</option><option value="90">… en 90 dies</option></select>
        </div>
      )}
      {d.contracts.length === 0 ? (
        <Empty icon={<FileSignature size={24} />} title="Encara no hi ha contractes" body="Tria el servei: electricitat, gas, fibra, mòbil, assegurances, alarmes, plaques solars… Els d'energia actius amb data de renovació apareixen també a Renovacions." action={d.permissions.canEdit ? <Button variant="primary" size="sm" onClick={() => setPicker(true)}><Plus size={13} /> Nou contracte</Button> : undefined} />
      ) : shown.length === 0 && filtered ? (
        <p className="text-[13px] text-muted">Cap contracte amb aquests filtres. <button className="underline" onClick={() => setFlt({ family: "", provider: "", status: "", expiry: "" })}>Treu els filtres</button></p>
      ) : GROUPS.map((g) => {
        const list = shown.filter((k) => CONTRACT_GROUP[k.status] === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id}>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{g.label} · {list.length}</h3>
            <div className="space-y-2">
              {list.map((k) => {
                const service = svc(k);
                const fam = SERVICE_FAMILY[service];
                const energy = isEnergyService(service);
                const days = k.end_date ? daysUntil(k.end_date) : null;
                const prev = k.previous_contract_id ? byId.get(k.previous_contract_id) : null;
                const docs = d.documents.filter((x) => x.contract_id === k.id).length;
                const lines = (k.lines ?? []) as ContractLineRow[];
                const totals = energy ? null : serviceTotals(service, (k.details ?? {}) as Record<string, unknown>, lines);
                const alerts = energy ? [] : contractAlerts({ service, status: k.status, start_date: k.start_date, end_date: k.end_date, permanence_end: k.permanence_end, details: k.details as Record<string, unknown>, lines }, today);
                const events = (d.contractEvents ?? []).filter((e) => e.contract_id === k.id);
                const live = g.id === "vigent" || g.id === "renovacio";
                return (
                  <article key={k.id} className="rounded-2xl border border-line bg-surface p-3.5">
                    <div className="flex flex-wrap items-start gap-3">
                      {energy ? <SupplierMark name={k.retailer} size={34} /> : <span className="grid h-[34px] w-[34px] place-items-center rounded-xl bg-zinc-100"><FamilyIcon family={fam} size={18} /></span>}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold"><span className="mr-1.5 inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 align-middle text-[11px] font-medium text-muted">{energy && <FamilyIcon family={fam} size={11} />}{FAMILY_LABEL[fam]}</span>{k.retailer}{k.product ? <span className="font-normal text-muted"> · {k.product}</span> : null}</p>
                        <p className="text-[12px] text-muted">
                          {energy
                            ? <>{cupsOf(k.supply_id) ? <CupsLink cups={cupsOf(k.supply_id)} /> : "Sense subministrament"}{k.access_tariff ? ` · ${k.access_tariff}` : ""}{k.price_type ? ` · ${PRICE_TYPE_LABEL[k.price_type]}` : ""}</>
                            : <>{k.provider_ref ? `Ref. ${k.provider_ref}` : "Sense referència"}{totals && totals.monthly_eur > 0 ? ` · ${eur(totals.monthly_eur)}/mes` : ""}{totals && totals.one_off_eur > 0 ? ` · ${fam === "plaques_solars" ? "pressupost" : "pagament únic"} ${eur(totals.one_off_eur)}` : ""}{totals && totals.active_lines ? ` · ${totals.active_lines} línies` : ""}</>}
                        </p>
                      </div>
                      <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{statusLabelFor(service, k.status, CONTRACT_STATUS_LABEL)}</Badge>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
                      <div><p className="text-[11px] text-muted">Signatura</p><p>{fmtDate(k.signed_at)}</p></div>
                      <div><p className="text-[11px] text-muted">Inici</p><p>{fmtDate(k.start_date)}</p></div>
                      {energy || k.end_date ? (
                        <div><p className="text-[11px] text-muted">{fam === "assegurances" ? "Venciment de la pòlissa" : "Finalització / renovació"}</p><p className={cn(days != null && days <= 30 && live && "font-medium text-lost")}>{fmtDate(k.end_date)}{days != null && days >= 0 && live ? ` · ${days} dies` : ""}</p></div>
                      ) : (
                        <div><p className="text-[11px] text-muted">Fi de permanència</p><p>{k.permanence_end ? fmtDate(k.permanence_end) : fam === "plaques_solars" ? "No aplica" : "—"}</p></div>
                      )}
                      <div><p className="text-[11px] text-muted">Documents</p><p>{docs}</p></div>
                    </div>
                    {lines.length > 0 && (
                      <div className="mt-2.5 overflow-x-auto">
                        <table className="w-full text-[12px]"><thead><tr className="text-left text-[11px] text-muted"><th className="pr-2 font-normal">Línia</th><th className="pr-2 font-normal">Número</th><th className="pr-2 font-normal">Tarifa</th><th className="pr-2 font-normal">Preu</th><th className="font-normal">Estat</th></tr></thead>
                          <tbody>{lines.map((l) => (
                            <tr key={l.id} className={cn(l.status === "baixa" && "text-muted line-through")}>
                              <td className="pr-2">{l.position}{l.line_type === "portabilitat" ? " · porta" : ""}</td><td className="pr-2 tnum">{l.phone_number ?? "nou"}</td><td className="pr-2">{l.tariff ?? "—"}</td>
                              <td className="pr-2 tnum">{l.included_in_package ? "inclosa" : eur(l.price_monthly_eur)}</td><td>{LINE_STATUS_LABEL[l.status as keyof typeof LINE_STATUS_LABEL] ?? l.status}</td>
                            </tr>
                          ))}</tbody></table>
                        {totals?.package_saving_eur != null && <p className="mt-1 text-[11.5px] text-muted">Paquet: {eur(totals.monthly_eur)}/mes · per separat serien {eur(totals.individual_sum_eur)}</p>}
                      </div>
                    )}
                    {alerts.length > 0 && <ul className="mt-2 space-y-0.5">{alerts.map((a, i) => <li key={i} className={cn("flex items-center gap-1 text-[12px]", a.level === "urgent" ? "text-lost" : "text-amber-700")}><BellRing size={12} /> {a.message}</li>)}</ul>}
                    {k.notes && <p className="mt-2 whitespace-pre-wrap text-[12px] text-muted">{k.notes}</p>}
                    {prev && <p className="mt-2 flex items-center gap-1 text-[11.5px] text-muted"><History size={12} /> Renovació de: {prev.retailer}{prev.product ? ` · ${prev.product}` : ""} ({fmtDate(prev.start_date ?? prev.signed_at)} <ArrowRight size={10} /> {fmtDate(prev.end_date)})</p>}
                    {k.finance && (
                      <p className="mt-2 flex flex-wrap items-center gap-1 text-[11.5px] text-muted"><Euro size={12} />
                        {!energy && k.finance.commission_status ? <Badge tone={k.finance.commission_status === "cobrada" ? "green" : k.finance.commission_status === "retrocedida" ? "red" : "zinc"}>{COMMISSION_STATUS_LABEL[k.finance.commission_status as CommissionStatus] ?? k.finance.commission_status}</Badge> : null}
                        {!energy && k.finance.commission_expected_eur != null ? ` Prevista ${eur(k.finance.commission_expected_eur)}` : ""}
                        {!energy && k.finance.collaborator_eur ? ` · col·laborador ${eur(k.finance.collaborator_eur)}` : ""}
                        {k.finance.commission_eur != null ? ` · Comissió ${eur(k.finance.commission_eur)}` : ""}{k.finance.commission_pct != null ? ` · ${k.finance.commission_pct} %` : ""}{k.finance.annual_amount_eur != null ? ` · Import anual ${eur(k.finance.annual_amount_eur)}` : ""}
                        {k.finance.settlement_ref ? ` · Liquidació ${k.finance.settlement_ref}` : ""}{k.finance.commission_paid_at ? ` · Cobrada el ${fmtDate(k.finance.commission_paid_at)}` : ""}
                      </p>
                    )}
                    {energy && d.client && <ConditionsCard rows={k.conditions ?? []} migrated={d.conditionsMigrated !== false} isStaff={d.permissions.isStaff} open={live && (k.conditions?.length ?? 0) > 0 && k.conditions![0].status !== "confirmada"} />}
                    {energy && d.client && live && <CurrentPricesCard contractId={k.id} />}
                    <div className="mt-2"><AgendaQuickActions compact actions={CONTRACT_ACTIONS(`${d.client.name} · ${k.retailer}`)} base={{ client: { id: d.client.id, name: d.client.name }, contract_id: k.id, renewal_id: k.legacy_contract_id ?? null, context: `${k.retailer}${k.product ? ` · ${k.product}` : ""}` }} /></div>
                    {energy && gana[k.id] && <div className="mt-2.5 flex flex-wrap items-center gap-2"><GanaEntryButton entry={gana[k.id]} size="md" onChanged={() => void reload()} /></div>}
                    {energy && d.permissions.canEdit && /iberdrola/i.test(k.retailer) && !["actiu", "finalitzat", "anullat", "renovacio_pendent"].includes(k.status) && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Button size="md" variant="primary" onClick={() => { tramFocus.current = true; openEdit(k); }}><Send size={14} /> {k.status === "enviat_comercialitzadora" ? "Veure enviament a Iberdrola" : "Enviar a Iberdrola per signar"}</Button>
                        <span className="text-[12px] text-muted">Obre el contracte amb la modalitat de firma, la documentació i «Guardar i tramitar».</span>
                      </div>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {d.permissions.canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(k)}><Pencil size={13} /> Edita</Button>}
                      {d.permissions.canEdit && live && fam !== "plaques_solars" && <Button size="sm" onClick={() => openEdit(null, k)}><RefreshCw size={13} /> Renova</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setDocsOf(k)}><FolderOpen size={13} /> Documents</Button>
                      {d.permissions.canEdit && <Button size="sm" variant="ghost" onClick={() => useApp.getState().navigate("client", { id: d.client.id, tab: "incidencies" })}><AlertTriangle size={13} /> Incidència</Button>}
                      {events.length > 0 && <Button size="sm" variant="ghost" onClick={() => setHistoryOf(historyOf === k.id ? null : k.id)}><History size={13} /> Historial ({events.length})</Button>}
                      {d.permissions.isStaff && <Button size="sm" variant="ghost" onClick={() => setFinance(k)}><Euro size={13} /> Dades econòmiques</Button>}
                      {d.permissions.isStaff && !energy && <Button size="sm" variant="ghost" onClick={() => setCommission(k)}><Euro size={13} /> Estat de la comissió</Button>}
                      {energy && (d.permissions.isStaff || d.permissions.canEdit) && <Button size="sm" variant="ghost" onClick={() => setEcon(k.id)}><Calculator size={13} /> Economia i comissions</Button>}
                      {energy && (k.legacy_contract_id || (live && k.end_date)) && (
                        <Button size="sm" variant="ghost" onClick={() => { const id = k.legacy_contract_id ?? `crm:${k.id}`; if (useApp.getState().byId[id]) { useApp.getState().navigate("kanban"); useApp.getState().open(id); } else useApp.getState().toast({ title: "Encara no és a Renovacions", body: "Apareixerà després de la propera càrrega de dades (recarrega la pàgina).", tone: "info" }); }}><KanbanSquare size={13} /> Veure a Renovacions</Button>
                      )}
                      {(d.permissions.isStaff || (d.permissions.canEdit && k.status === "esborrany")) && (
                        <Button size="sm" variant="ghost" className="ml-auto text-lost" onClick={() => setToDelete(k)}><Trash2 size={13} /> Elimina</Button>
                      )}
                    </div>
                    {historyOf === k.id && (
                      <ol className="mt-2 space-y-0.5 border-l border-line pl-3 text-[12px] text-muted">
                        {events.map((e) => <li key={e.id}>{fmtDate(e.at.slice(0, 10))} · {e.kind === "creacio" ? `Creat (${CONTRACT_STATUS_LABEL[e.to_status as ContractStatus] ?? e.to_status})` : e.kind === "linia" ? `Línia ${e.note}: ${e.from_status} → ${e.to_status}` : `${CONTRACT_STATUS_LABEL[e.from_status as ContractStatus] ?? e.from_status} → ${CONTRACT_STATUS_LABEL[e.to_status as ContractStatus] ?? e.to_status}`}{e.by_name ? ` · ${e.by_name}` : ""}</li>)}
                      </ol>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {picker && <NewContractPicker ctx={ctx} onClose={() => setPicker(false)} onSaved={() => { setPicker(false); void reload(); }} />}
      {edit && (() => {
        const ref = (edit.contract ?? edit.renewOf)!;
        const service = svc(ref);
        return isEnergyService(service)
          ? <ContractForm ctx={ctx} contract={edit.contract} renewOf={edit.renewOf} focusTram={tramFocus.current} onClose={() => { tramFocus.current = false; setEdit(null); }} onSaved={() => { tramFocus.current = false; setEdit(null); void reload(); }} />
          : <ServiceContractForm ctx={ctx} service={service} contract={edit.contract} renewOf={edit.renewOf} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />;
      })()}
      {docsOf && <ContractDocsDialog ctx={ctx} contract={docsOf} onClose={() => { setDocsOf(null); void reload(); }} />}
      {commission && <CommissionStatusDialog ctx={ctx} contract={commission} onClose={() => setCommission(null)} onSaved={() => { setCommission(null); void reload(); }} />}
      {econ && <ContractEconomicsDialog contractId={econ} onClose={() => { setEcon(null); void reload(); }} />}
      {finance && <FinanceForm ctx={ctx} contract={finance} onClose={() => setFinance(null)} onSaved={() => { setFinance(null); void reload(); }} />}
      {toDelete && <DeleteContractDialog ctx={ctx} contract={toDelete} onClose={() => setToDelete(null)} onDeleted={() => { setToDelete(null); void reload(); }} />}
    </div>
  );
}
const eur = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));

const AV_TONE: Record<Availability, "green" | "red" | "amber"> = { disponible: "green", no_disponible: "red", pendent: "amber" };
const AV_ORDER: Record<Availability, number> = { disponible: 0, pendent: 1, no_disponible: 2 };

export function ContractForm({ ctx, contract, renewOf, supplyId, energy, initial, focusTram, onClose, onSaved }: { ctx: Ctx; contract: CrmContract | null; focusTram?: boolean; renewOf?: CrmContract; supplyId?: string; /** Servei triat a «Nou contracte» (electricitat o gas): mana encara que el client no tingui cap CUPS d'aquest tipus. */ energy?: "luz" | "gas"; initial?: { status?: ContractStatus; notes?: string; retailer?: string; product?: string }; onClose: () => void; onSaved: (id?: string) => void }) {
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
  const tramRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusTram) { const t = setTimeout(() => tramRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 350); return () => clearTimeout(t); } }, [focusTram]);
  const closed = contract && (contract.status === "finalitzat" || contract.status === "anullat") && !d.permissions.isStaff;
  // ---- 052 · «Guardar i tramitar»: un cop desat, els clics següents actualitzen el MATEIX contracte (mai un duplicat)
  const [savedId, setSavedId] = useState<string | null>(contract?.id ?? null);
  const [condSaved, setCondSaved] = useState(false);
  const [tram, setTram] = useState<TramValue>(emptyTram());
  const [tramState, setTramState] = useState<{ check: CheckView | null; complete: boolean }>({ check: null, complete: false });
  const [flow, setFlow] = useState<null | { kind: "iberdrola"; batchId: string; tab: "dades" | "revisio" } | { kind: "gana"; contractId: string } | { kind: "manual"; procedure: Procedure; code: string }>(null);
  const action = procedureAction(tramState.check?.procedure ?? null);
  // ---- condicions econòmiques contractades: selecció en cascada sobre el catàleg existent
  const formSupply = d.supplies.find((s) => s.id === f.supply_id);
  const energyType = (formSupply?.energy_type ?? energy ?? supply?.energy_type ?? "luz") as "luz" | "gas";
  const family = energyType === "gas" ? "gas" : "electricitat";
  const cat = useContractCatalog(f.supply_id || null, energyType);
  const { options: registry, blocked: blockedRegistry } = useRetailerOptions();
  const existing = contract?.conditions?.find((r) => r.is_current) ?? null;
  const [ed, setEd] = useState<EditorValue | null>(existing ? { conditions: existing.conditions, confirm: existing.status === "confirmada", reason: "" } : null);
  const [dirty, setDirty] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  const tar = (t: string | null | undefined) => (t ?? "").toUpperCase().replace(/\s/g, "");
  // ---- servei → comercialitzadora: només empreses amb aquest servei a la fitxa o amb productes d'aquest servei al catàleg
  const retailerList = cat.retailers.length
    ? cat.retailers
    : registry.filter((o) => retailerServes(o.services, family)).map((o) => ({ name: o.name, inRegistry: true, products: 0, blocked: [] as { reason: string; count: number }[] }));
  // el nom desat pot ser un àlies («Iberdrola Clientes, S.A.U.»): es reconeix la mateixa empresa sense reescriure'l
  const canonical = (name: string) => {
    if (!name.trim()) return "";
    const exact = retailerList.find((r) => same(r.name, name));
    if (exact) return exact.name;
    const reg = registry.find((o) => matchesRetailer(name, { trade_name: o.name, aliases: o.aliases }));
    return (reg && retailerList.find((r) => same(r.name, reg.name))?.name) || name;
  };
  const retailerName = canonical(f.retailer);
  const retailerEntry = retailerList.find((r) => same(r.name, retailerName)) ?? null;
  const blockedHit = f.retailer ? blockedRegistry.find((b) => matchesRetailer(f.retailer, { trade_name: b.name, aliases: b.aliases })) : null;
  const svcLabel = energyType === "gas" ? "gas" : "electricitat";
  const retailerOptions: ComboOption[] = retailerList.map((r) => ({
    value: r.name, label: r.name,
    hint: cat.loading ? undefined : r.products ? `${r.products} ${r.products === 1 ? "tarifa contractable" : "tarifes contractables"}` : r.blocked.length ? `Cap tarifa contractable avui · ${r.blocked[0].reason}` : `Sense tarifes de ${svcLabel} al catàleg`,
  }));
  // ---- comercialitzadora → tarifa d'accés → producte compatible
  const ofRetailer = cat.products.filter((p) => same(p.supplier, retailerName));
  const tariffs = [...new Set([...ofRetailer.map((p) => p.accessTariff), formSupply?.access_tariff ?? "", f.access_tariff].filter(Boolean))].sort();
  const productOptions = ofRetailer.filter((p) => !f.access_tariff || tar(p.accessTariff) === tar(f.access_tariff)).sort((x, y) => AV_ORDER[x.availability] - AV_ORDER[y.availability] || x.product.localeCompare(y.product, "ca"));
  const picked = ed?.conditions.tariffVersionId ? cat.products.find((p) => p.id === ed.conditions.tariffVersionId) ?? null : null;
  const [ack, setAck] = useState({ verified: false, note: "" });
  const [cleared, setCleared] = useState<string | null>(null);
  const live = f.status === "actiu" || f.status === "renovacio_pendent";
  const priceTypeOf = (c: EditorValue["conditions"]) => (c.model === "indexat" ? "indexat" : c.model === "mixt" ? "mixt" : finalPrices(c).single ? "fix" : "periodes");
  const dropProduct = (why: string | null) => { setEd(null); setDirty(false); setAck({ verified: false, note: "" }); setCleared(why); set({ product: "" }); };
  const pickProduct = (p: CascadeProduct) => {
    if (p.availability === "no_disponible") return;
    setEd({ conditions: p.conditions, confirm: false, reason: "" }); setDirty(true); setEpoch((x) => x + 1); setAck({ verified: false, note: "" }); setCleared(null);
    set({ product: p.product, access_tariff: p.accessTariff, price_type: priceTypeOf(p.conditions) });
  };
  const manualProduct = () => { setEd({ conditions: emptyConditions({ energyType, supplier: f.retailer, accessTariff: f.access_tariff || null }), confirm: false, reason: "" }); setDirty(true); setEpoch((x) => x + 1); setCleared(null); };
  // canvi de comercialitzadora: només es neteja la tarifa del catàleg que ja no hi correspon; la resta del contracte es conserva
  const changeRetailer = (v: string) => {
    set({ retailer: v });
    if (ed?.conditions.tariffVersionId && !same(canonical(v), canonical(ed.conditions.supplier))) { dropProduct(v ? `S'ha tret «${ed.conditions.product ?? "la tarifa"}» perquè no és de ${v}.` : null); set({ retailer: v, product: "" }); }
  };
  // canvi de tarifa d'accés: les opcions s'actualitzen soles; si la tarifa triada era d'un altre peatge, es treu només aquella selecció
  const changeTariff = (v: string) => {
    set({ access_tariff: v });
    if (dirty && ed?.conditions.tariffVersionId && v && tar(ed.conditions.accessTariff) !== tar(v)) { dropProduct(`S'ha tret «${ed.conditions.product ?? "la tarifa"}» perquè no és de la tarifa d'accés ${v}.`); set({ access_tariff: v, product: "" }); }
  };
  // canvi de subministrament (o de servei): si la tarifa triada en aquesta sessió deixa de ser contractable, es treu només aquella selecció
  const pickedId = ed?.conditions.tariffVersionId ?? null;
  useEffect(() => {
    if (cat.loading || cat.error || !dirty || !pickedId) return;
    const p = cat.products.find((x) => x.id === pickedId);
    if (!p) dropProduct(`S'ha tret «${ed?.conditions.product ?? "la tarifa"}» perquè no és contractable per a ${svcLabel} amb aquest subministrament.`);
    else if (p.availability === "no_disponible") dropProduct(`S'ha tret «${p.product}» perquè no és compatible amb el subministrament triat: ${p.blocking[0]}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.loading, cat.error, cat.products, pickedId, dirty]);
  const save = async (mode: "desar" | "tramitar" = "desar") => {
    // tarifa amb condicions comercials pendents: la nota de verificació és obligatòria (mínim 3 caràcters) · avís clar abans d'enviar
    if (picked?.availability === "pendent" && ack.verified && ack.note.trim().length < 3) { setErr("Falta explicar què has verificat: a la casella «He verificat les condicions comercials…» (a dalt, al bloc de condicions) escriu què has comprovat i amb quin document o persona (mínim 3 caràcters)."); return; }
    // contractes nous: el nom de l'empresa es desa tal com consta al registre (una sola manera d'escriure'l); en editar no es reescriu
    const data: Record<string, unknown> = { ...f, retailer: contract ? f.retailer : retailerName || f.retailer, supply_id: f.supply_id || null, price_type: f.price_type || null, owner_id: f.owner_id || null, signed_at: f.signed_at || null, start_date: f.start_date || null, end_date: f.end_date || null };
    if (mode === "tramitar") {
      if (!f.supply_id) { setErr("Per tramitar cal triar el subministrament (CUPS)."); return; }
      if (!f.retailer.trim() || !(f.product.trim() || ed)) { setErr("Per tramitar cal triar la comercialitzadora i la tarifa."); return; }
      if (f.status === "esborrany") data.status = "pendent_documentacio";   // es comença a tramitar: deixa de ser un esborrany
    }
    const v = contractInput.safeParse(data);
    if (!v.success) { setErr([...new Set(v.error.issues.map((i) => i.message))].join(" · ")); return; }
    // les condicions només s'envien si s'han tocat (o si encara no s'havien confirmat): un contracte antic no canvia
    if (ed && (dirty || (!condSaved && existing?.status !== "confirmada"))) {
      data.conditions_payload = {
        conditions: { ...ed.conditions, supplier: (contract ? f.retailer : retailerName || f.retailer).trim(), product: f.product.trim() || null, accessTariff: f.access_tariff.trim() || null, signedAt: f.signed_at || null, activatedAt: f.start_date || null },
        confirm: ed.confirm, origin: ed.conditions.tariffVersionId ? "cataleg" : "manual", reason: ed.reason.trim() || null,
        ...(picked?.availability === "pendent" && ack.verified && ack.note.trim() ? { availabilityAck: { verified: true, note: ack.note.trim() } } : {}),
      };
    }
    setBusy(true); setErr(null);
    try {
      const r = await crmApi.action<{ id?: string; commission?: { state: string; message: string } }>({ entity: "contract", action: savedId ? "update" : renewOf ? "renew" : "create", clientId: d.client.id, id: savedId ?? renewOf?.id, data });
      const id = (r.id as string | undefined) ?? savedId ?? undefined;
      // resultat del càlcul automàtic de la comissió (059): es mostra sempre, també si ha quedat pendent o ha fallat
      if (r.commission && r.commission.state !== "no_aplica") useApp.getState().toast({ title: r.commission.state === "calculat" ? "Comissió calculada" : r.commission.state === "protegit" ? "Comissió protegida" : "Comissió pendent", body: r.commission.message, tone: r.commission.state === "calculat" || r.commission.state === "protegit" ? "ok" : "err" });
      if (id) setSavedId(id);
      if (data.conditions_payload) setCondSaved(true);   // en tornar a desar el mateix contracte no es crea una versió nova de les condicions
      if (data.status && data.status !== f.status) set({ status: data.status as ContractStatus });
      setDirty(false);
      if (mode === "desar") {
        useApp.getState().toast({ title: savedId ? "Contracte actualitzat" : renewOf ? "Renovació registrada" : "Contracte creat", body: (f.status === "actiu" || f.status === "renovacio_pendent") && f.end_date ? "Apareixerà a Renovacions amb la data de venciment." : undefined, tone: "ok" });
        onSaved(id);
        return;
      }
      if (!id) throw new Error("No s'ha pogut identificar el contracte desat.");
      const proc = tramState.check?.procedure ?? null;
      if (proc?.integration === "iberdrola") {
        const t = await tramApi.start({ contractId: id, firma: tram.firma, correo: tram.correo, movil: tram.movil, signerDni: tram.signerDni || undefined, signerName: tram.signerName || undefined, selection: tram.selection });
        if (!t.prepared && !t.sent) useApp.getState().toast({ title: "Contracte desat · falten dades per tramitar", body: t.issues.slice(0, 3).join(" · "), tone: "err" });
        setFlow({ kind: "iberdrola", batchId: t.batchId, tab: t.prepared || t.sent ? "revisio" : "dades" });
      } else if (proc?.integration === "gana") setFlow({ kind: "gana", contractId: id });
      else if (proc) { const m = await tramApi.manual(id); setFlow({ kind: "manual", procedure: m.procedure, code: m.code }); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const finish = () => { setFlow(null); onSaved(savedId ?? undefined); };
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || ["admin", "cap_administrativa", "administrativa"].includes(u.role));
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={contract ? `Contracte · ${contract.retailer}` : renewOf ? `Renovació de ${renewOf.retailer}` : `Nou contracte · ${energyType === "gas" ? "Gas natural" : "Electricitat"}`}
      footer={<><Button variant="ghost" onClick={() => (savedId && !contract ? onSaved(savedId) : onClose())}>{savedId && !contract ? "Tanca" : "Cancel·la"}</Button>
        <Button variant={action ? "secondary" : "primary"} disabled={busy || !!closed} onClick={() => void save("desar")} title="Desa el contracte sense tramitar-lo">{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button>
        {action && !closed && <Button variant="primary" disabled={busy || !f.supply_id} onClick={() => void save("tramitar")} title={action.note}>{busy && <Loader2 size={14} className="animate-spin" />} <ArrowRight size={14} /> {action.label}</Button>}</>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        {renewOf && <div className="sm:col-span-2"><Notice tone="blue">Es crearà un contracte nou. L&apos;anterior ({renewOf.retailer}, fins al {fmtDate(renewOf.end_date)}) passarà a «Finalitzat» si el nou és actiu, i es conserva a l&apos;historial.</Notice></div>}
        {closed && <div className="sm:col-span-2"><Notice>Contracte tancat: només Administració o Direcció el poden corregir. Per a una renovació, crea&apos;n un de nou.</Notice></div>}
        <label className="block sm:col-span-2"><span className="label">Subministrament</span>
          <select className="input" value={f.supply_id} onChange={(e) => { const s = d.supplies.find((x) => x.id === e.target.value); set({ supply_id: e.target.value, access_tariff: f.access_tariff || s?.access_tariff || "" }); }}>
            <option value="">Sense subministrament</option>
            {d.supplies.filter((s) => !s.archived_at && (!energy || s.energy_type === energy || s.id === f.supply_id)).map((s) => <option key={s.id} value={s.id}>{s.cups} · {s.energy_type === "gas" ? "Gas" : "Llum"}{s.address ? ` · ${s.address}` : ""}</option>)}
          </select>
          {energy && !d.supplies.some((s) => !s.archived_at && s.energy_type === energy) && <span className="mt-1 block text-[11.5px] text-muted">Aquest client no té cap CUPS de {svcLabel}. Pots crear el contracte sense subministrament, però no es podran comprovar els límits de les tarifes.</span>}
        </label>
        {f.supply_id && <SupplyFactsLine cat={cat} />}
        <div className="block"><span className="label" id="a30-contracte-comercialitzadora">Comercialitzadora *</span>
          <Combobox ariaLabel="Comercialitzadora" value={retailerName} onChange={changeRetailer} options={retailerOptions} loading={cat.loading && !retailerOptions.length}
            placeholder="— Tria la comercialitzadora —" emptyText={`Cap empresa de ${svcLabel} amb aquest nom`} allowCustom customLabel={(t) => `Una altra empresa: «${t}»`} clearLabel="Neteja la comercialitzadora" />
          <span className="mt-1 block text-[11px] text-muted">Només empreses amb {svcLabel} a la seva fitxa o amb tarifes de {svcLabel} al catàleg.</span>
          {blockedHit && <span className="mt-1 block text-[11.5px] text-lost">«{blockedHit.name}» està {blockedHit.status === "arxivada" ? "arxivada" : "desactivada"}: no es pot fer servir per a contractes nous.</span>}
          {f.retailer && !cat.loading && !retailerEntry && !blockedHit && <span className="mt-1 block text-[11.5px] text-amber-700">«{f.retailer}» no consta com a empresa de {svcLabel}: no té tarifes al catàleg i caldrà la introducció manual de les condicions.</span>}
        </div>
        <label className="block"><span className="label">Tarifa d&apos;accés</span>
          {tariffs.length > 0
            ? <select className="input" value={tariffs.find((t) => tar(t) === tar(f.access_tariff)) ?? ""} onChange={(e) => changeTariff(e.target.value)}><option value="">— Totes —</option>{tariffs.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            : <input className="input" value={f.access_tariff} onChange={(e) => changeTariff(e.target.value)} placeholder={energyType === "gas" ? "RL.1" : "2.0TD"} />}
        </label>
        <div className="block sm:col-span-2"><span className="label">Producte o tarifa comercial</span>
          <Combobox ariaLabel="Producte o tarifa comercial" disabled={!f.retailer} loading={cat.loading}
            value={ed?.conditions.tariffVersionId ?? (ed ? "__manual" : "")}
            onChange={(v) => { const p = productOptions.find((x) => x.id === v); if (p) pickProduct(p); else if (v === "__manual") manualProduct(); else if (!v) dropProduct(null); }}
            placeholder={!f.retailer ? "Tria primer la comercialitzadora" : cat.loading ? "Consultant les tarifes…" : productOptions.length ? "— Tria el producte del catàleg —" : "Cap tarifa contractable per a aquesta selecció"}
            emptyText="Cap tarifa amb aquest nom" clearLabel="Neteja la tarifa"
            options={[
              ...(ed?.conditions.tariffVersionId && !productOptions.some((p) => p.id === ed.conditions.tariffVersionId) ? [{ value: ed.conditions.tariffVersionId, label: `${ed.conditions.product ?? "Producte"} (versió ${ed.conditions.productVersion ?? "—"} · desat al contracte)` }] : []),
              ...productOptions.map((p): ComboOption => ({
                value: p.id, label: `${p.product} · ${p.accessTariff} · v${p.version}`, disabled: p.availability === "no_disponible",
                hint: p.availability === "no_disponible" ? p.blocking.join(" · ") : p.availability === "pendent" ? p.pending.join(" · ") : p.notes.join(" · ") || undefined,
                badge: <Badge tone={AV_TONE[p.availability]} className="shrink-0">{AVAILABILITY_LABEL[p.availability]}</Badge>,
              })),
              { value: "__manual", label: "No és al catàleg: introducció manual de les condicions" },
            ]} />
          {cat.loading && f.retailer && <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted" role="status"><Loader2 size={12} className="animate-spin" /> Consultant les tarifes del catàleg…</span>}
          {cat.error && <span className="mt-1 block text-[11.5px] text-lost">No s&apos;ha pogut carregar el catàleg: {cat.error}</span>}
          {cleared && <span className="mt-1 block text-[11.5px] text-amber-700" role="status">{cleared} La resta de dades del contracte es conserven.</span>}
          {!cat.loading && !cat.error && f.retailer && productOptions.length === 0 && (
            <Notice tone="amber">
              <b>Cap tarifa contractable de {retailerName} per a {svcLabel}{f.access_tariff ? ` ${f.access_tariff}` : ""}.</b>{" "}
              {ofRetailer.length > 0
                ? <>Sí que en té per a {[...new Set(ofRetailer.map((p) => p.accessTariff))].sort().join(", ")}: canvia la tarifa d&apos;accés si correspon.</>
                : retailerEntry?.blocked.length
                  ? <>Té tarifes actives al catàleg, però avui no es poden contractar: {retailerEntry.blocked.map((x) => `${x.reason} (${x.count})`).join(" · ")}. Les ha de revisar Administració al Catàleg de tarifes; no s&apos;activen soles.</>
                  : <>Aquesta empresa no té cap tarifa activa de {svcLabel} al Catàleg de tarifes. Si el producte existeix, Administració l&apos;ha de donar d&apos;alta i activar; mentrestant pots fer la introducció manual de les condicions.</>}
            </Notice>
          )}
          {productOptions.some((p) => p.availability !== "disponible") && <span className="mt-1 block text-[11px] text-muted">Cada tarifa indica si és contractable per a aquest subministrament. Les «no disponibles» es poden consultar però no triar; les «pendents de verificació» necessiten la validació d&apos;Administració abans de formalitzar el contracte.</span>}
          {picked && (
            <div className={cn("mt-2 rounded-xl border px-3 py-2 text-[12.5px]", picked.availability === "disponible" ? "border-line" : "border-amber-300 bg-amber-50/60")}>
              <p className="flex flex-wrap items-center gap-1.5"><Badge tone={AV_TONE[picked.availability]}>{AVAILABILITY_LABEL[picked.availability]}</Badge> <b>{picked.product}</b>{picked.powerBasis ? <span className="text-muted">· {picked.powerBasis}</span> : null}</p>
              {picked.availability === "disponible" && <p className="mt-1 text-muted">Compleix totes les condicions conegudes i validades per a aquest subministrament.</p>}
              {picked.blocking.length > 0 && <ul className="mt-1 list-disc pl-5">{picked.blocking.map((x) => <li key={x}>{x}</li>)}</ul>}
              {picked.pending.length > 0 && <><p className="mt-1 font-medium">{PENDING_CONDITIONS}</p><ul className="list-disc pl-5">{picked.pending.map((x) => <li key={x}>{x.replace(`${PENDING_CONDITIONS}: `, "")}</li>)}</ul></>}
              {picked.notes.length > 0 && <p className="mt-1 text-muted">Requisits del producte: {picked.notes.join(" · ")}</p>}
              {picked.availability === "pendent" && (d.permissions.isStaff ? (
                <div className="mt-2 space-y-1.5">
                  <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={ack.verified} onChange={(e) => setAck({ ...ack, verified: e.target.checked })} /> <span>He verificat les condicions comercials d&apos;aquesta tarifa per a aquest subministrament i en valido la contractació.</span></label>
                  {ack.verified && <input className="input h-9" aria-label="Què s'ha verificat" placeholder="Què has verificat i amb quin document o persona (obligatori)" value={ack.note} onChange={(e) => setAck({ ...ack, note: e.target.value })} />}
                  <p className="text-[11.5px] text-muted">La validació queda desada al contracte amb el teu nom i la data. Sense validar, només es pot desar com a esborrany.</p>
                </div>
              ) : <p className="mt-1.5 text-[11.5px] text-muted">Pots desar el contracte com a <b>esborrany</b>. Per formalitzar-lo, Administració ha de validar expressament aquesta tarifa.</p>)}
            </div>
          )}
        </div>
        {(!ed || !ed.conditions.tariffVersionId) && <label className="block"><span className="label">Nom del producte</span><input className="input" value={f.product} onChange={(e) => set({ product: e.target.value })} /></label>}
        <label className="block"><span className="label">Tipus de tarifa</span><select className="input" value={f.price_type} onChange={(e) => set({ price_type: e.target.value })}><option value="">—</option>{PRICE_TYPES.map((p) => <option key={p} value={p}>{PRICE_TYPE_LABEL[p]}</option>)}</select></label>
        {ed
          ? <div className="sm:col-span-2"><ConditionsEditor value={ed} epoch={epoch} bump={() => setEpoch((x) => x + 1)} wasConfirmed={existing?.status === "confirmada"} liveStatus={live} onChange={(v) => { setEd(v); setDirty(true); }} /></div>
          : contract && <div className="sm:col-span-2"><Notice tone="amber"><b>Condicions pendents de completar.</b> Aquest contracte no té desats els preus pactats; no es dedueixen del catàleg actual. Tria el producte o la introducció manual per completar-les.</Notice></div>}
        {!closed && f.retailer.trim() && <div ref={tramRef} />}
        {!closed && f.retailer.trim() && <TramitacioBlock clientId={d.client.id} supplyId={f.supply_id || null} retailer={retailerName || f.retailer} contractId={savedId} value={tram} onChange={setTram} onState={setTramState} />}
        <label className="block"><span className="label">Data de signatura</span><input type="date" className="input" value={f.signed_at} onChange={(e) => set({ signed_at: e.target.value })} /></label>
        <label className="block"><span className="label">Inici del subministrament</span><input type="date" className="input" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} /></label>
        <label className="block"><span className="label">Finalització o renovació{f.status === "actiu" || f.status === "renovacio_pendent" ? " *" : ""}</span><input type="date" className="input" value={f.end_date} onChange={(e) => set({ end_date: e.target.value })} /></label>
        <label className="block"><span className="label">Estat</span><select className="input" value={f.status} onChange={(e) => set({ status: e.target.value as ContractStatus })}>{STATUS_FLOW.electricitat.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="block"><span className="label">Comercial responsable</span>
          {d.permissions.isStaff ? <select className="input" value={f.owner_id} onChange={(e) => set({ owner_id: e.target.value })}><option value="">—</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            : <input className="input" disabled value={owners.find((u) => u.id === f.owner_id)?.name ?? "—"} />}
        </label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><textarea className="input min-h-[70px]" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        {err && <p className="rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
      {flow?.kind === "iberdrola" && <IberdrolaFlow batchId={flow.batchId} initialTab={flow.tab} onClose={finish} />}
      {flow?.kind === "gana" && <GanaQuickDialog gref={{ contractId: flow.contractId }} onClose={finish} />}
      {flow?.kind === "manual" && (
        <Modal open onClose={finish} title={`Documentació preparada · ${flow.procedure.retailerName}`} footer={<Button variant="primary" onClick={finish}>Entesos</Button>}>
          <div className="space-y-2 text-[13px]">
            <Notice tone="amber">{flow.procedure.retailerName} no té enviament automàtic configurat. El contracte està desat i la documentació preparada (expedient intern {flow.code}), però <b>no s&apos;ha enviat res</b>: cal fer-ho seguint el procediment.</Notice>
            {flow.procedure.instructions && <p><b>Procediment:</b> {flow.procedure.instructions}</p>}
            {flow.procedure.platformUrl && <p><b>Plataforma:</b> <a className="text-brand" href={flow.procedure.platformUrl} target="_blank" rel="noopener noreferrer">{flow.procedure.platformUrl}</a></p>}
            {flow.procedure.recipients.length > 0 && <p><b>Destinataris:</b> {flow.procedure.recipients.join(", ")}</p>}
            {tramState.check && <p className="text-muted">Documents identificats a la fitxa: {[...tramState.check.docs.dni, ...tramState.check.docs.cif, ...tramState.check.docs.invoices.filter((x) => x.supplyId === f.supply_id)].map((x) => x.title).join(", ") || "cap"}.</p>}
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** Dades del subministrament que es contrasten amb les condicions de cada tarifa (fitxa del CRM i última consulta SIPS desada). */
function SupplyFactsLine({ cat }: { cat: ReturnType<typeof useContractCatalog> }) {
  const f = cat.facts;
  if (cat.loading) return <p className="flex items-center gap-1.5 text-[11.5px] text-muted sm:col-span-2" role="status"><Loader2 size={12} className="animate-spin" /> Recuperant les dades del subministrament…</p>;
  if (!f) return null;
  const tag = (k: keyof typeof f.sources) => (f.sources[k] === "sips" ? " (SIPS)" : "");
  const n = (v: number) => v.toLocaleString("ca-ES", { maximumFractionDigits: 3 });
  const code = provinceCodeOf(f);
  const kw = f.kw.map((v, i) => (v == null ? null : `P${i + 1} ${n(v)}`)).filter(Boolean);
  const have = [
    f.accessTariff ? `Tarifa d'accés ${f.accessTariff}${tag("accessTariff")}` : null,
    f.energyType === "luz" && kw.length ? `Potències ${kw.join(" · ")} kW${tag("kw")}` : null,
    f.annualKwh != null ? `Consum anual ${n(Math.round(f.annualKwh))} kWh${tag("annualKwh")}` : null,
    code ? `${provinceName(code)}${f.postalCode ? ` (${f.postalCode})` : ""}${tag(f.postalCode ? "postalCode" : "province")}` : null,
  ].filter(Boolean);
  const miss = [!f.accessTariff && "tarifa d'accés", f.energyType === "luz" && !kw.length && "potències contractades", f.annualKwh == null && "consum anual", !code && "codi postal o província"].filter(Boolean);
  return (
    <div className="rounded-xl bg-ink/[0.04] px-3 py-2 text-[11.5px] text-muted sm:col-span-2">
      <p><b className="font-medium text-ink">Dades del subministrament per validar les tarifes:</b> {have.length ? have.join(" · ") : "cap dada disponible"}.{f.address ? ` ${f.address}.` : ""}</p>
      {miss.length > 0 && <p className="text-amber-700">Falta: {miss.join(", ")}. Les tarifes que en depenguin quedaran «pendents de verificació»; completa-ho a la pestanya Subministraments o consulta el SIPS.</p>}
    </div>
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

/**
 * ELIMINAR UN CONTRACTE creat per error (definitiu, amb confirmació). Administració/Direcció poden eliminar-ne
 * qualsevol; un comercial, només els seus esborranys. Si té moviments econòmics, el servidor ho impedeix i cal
 * anul·lar-lo. Els documents enllaçats es conserven a la pestanya Documents.
 */
function DeleteContractDialog({ ctx, contract: k, onClose, onDeleted }: { ctx: Ctx; contract: CrmContract; onClose: () => void; onDeleted: () => void }) {
  const { d } = ctx;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const docs = d.documents.filter((x) => x.contract_id === k.id).length;
  const renews = d.contracts.filter((x) => x.previous_contract_id === k.id).length;
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      await crmApi.action({ entity: "contract", action: "delete", clientId: d.client.id, id: k.id });
      useApp.getState().toast({ title: "Contracte eliminat", body: "Queda registrat a l'activitat del client.", tone: "ok" });
      onDeleted();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Eliminar el contracte?"
      footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel·la</Button><Button variant="danger" disabled={busy} onClick={run}>{busy && <Loader2 size={14} className="animate-spin" />} <Trash2 size={14} /> Elimina definitivament</Button></>}>
      <div className="space-y-2.5 text-[13px]">
        <p><b>{k.retailer}{k.product ? ` · ${k.product}` : ""}</b> · {CONTRACT_STATUS_LABEL[k.status]}{k.start_date ? ` · inici ${fmtDate(k.start_date)}` : ""}</p>
        <p>Aquesta acció és <b>definitiva</b> i és per a contractes creats per error o proves. Si el contracte és real però ja no ha de comptar, edita&apos;l i canvia&apos;l a «Anul·lat»: així es conserva l&apos;historial.</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Desapareix de la fitxa del client i del Kanban de renovacions.</li>
          <li>{docs ? `Els ${docs} document${docs === 1 ? "" : "s"} enllaçats es conserven` : "Els documents enllaçats es conserven"} a la pestanya Documents (per retenció legal), però queden desvinculats.</li>
          {renews > 0 && <li>{renews === 1 ? "Hi ha un contracte que n'és la renovació" : `Hi ha ${renews} contractes que en són renovacions`}: es conserva{renews === 1 ? "" : "n"}, però sense l&apos;enllaç amb aquest.</li>}
          <li>Si té moviments econòmics o liquidacions, no es podrà eliminar: caldrà anul·lar-lo.</li>
        </ul>
        {err && <p className="flex items-start gap-1.5 rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}</p>}
      </div>
    </Modal>
  );
}
