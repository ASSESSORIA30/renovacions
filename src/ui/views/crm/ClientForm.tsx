"use client";
/** Alta i edició de clients: formulari en tres blocs (identificació, contacte, gestió comercial) amb validació i control de duplicats. */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Check, ChevronLeft, ChevronRight, Loader2, Store, User, X } from "lucide-react";
import {
  CLIENT_KINDS, CLIENT_KIND_LABEL, CLIENT_STATUSES, CLIENT_STATUS_LABEL, ORIGINS, PRIORITIES, PRIORITY_LABEL,
  LEGAL_REP_ROLES, LEGAL_REP_ROLE_LABEL, MASKED, checkTaxId, clientInput, provinceFromPostalCode, type ClientKind, type CrmClient,
} from "@/core/crm";
import { useUnsavedChanges } from "../../components/Navigation";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { Button, Modal, cn } from "../../components/ui";
import { crmApi, type Facets } from "./api";

type Form = {
  kind: ClientKind; name: string; trade_name: string; tax_id: string; sector: string; status: string; registered_at: string;
  contact_name: string; contact_role: string; legal_rep_name: string; legal_rep_tax_id: string; legal_rep_role: string; contact_is_legal_rep: boolean;
  phone: string; phone2: string; email: string; address: string; postal_code: string; city: string; province: string; notes: string;
  owner_id: string; collaborator_id: string; origin: string; tags: string[]; priority: string; next_follow_up: string;
};
const STEPS = [
  { id: "id", label: "Identificació" },
  { id: "contacte", label: "Contacte" },
  { id: "gestio", label: "Gestió comercial" },
] as const;
const FIELDS_BY_STEP: Record<(typeof STEPS)[number]["id"], (keyof Form)[]> = {
  id: ["kind", "name", "trade_name", "tax_id", "sector", "status", "registered_at"],
  contacte: ["contact_name", "contact_role", "legal_rep_name", "legal_rep_tax_id", "legal_rep_role", "contact_is_legal_rep", "phone", "phone2", "email", "address", "postal_code", "city", "province", "notes"],
  gestio: ["owner_id", "collaborator_id", "origin", "tags", "priority", "next_follow_up"],
};

const fromClient = (c: Partial<CrmClient> | null, meId: string, role: string): Form => ({
  kind: c?.kind ?? "empresa", name: c?.name ?? "", trade_name: c?.trade_name ?? "", tax_id: c?.tax_id ?? "", sector: c?.sector ?? "", status: c?.status ?? "potencial",
  registered_at: c?.registered_at ?? new Date().toISOString().slice(0, 10), contact_name: c?.contact_name ?? "",
  contact_role: c?.contact_role ?? "", legal_rep_name: c?.legal_rep_name ?? "", legal_rep_tax_id: c?.legal_rep_tax_id === MASKED ? "********" : c?.legal_rep_tax_id ?? "",
  legal_rep_role: c?.legal_rep_role ?? "", contact_is_legal_rep: c?.contact_is_legal_rep ?? false, phone: c?.phone ?? "", phone2: c?.phone2 ?? "", email: c?.email ?? "",
  address: c?.address ?? "", postal_code: c?.postal_code ?? "", city: c?.city ?? "", province: c?.province ?? "", notes: c?.notes ?? "",
  owner_id: c ? c.owner_id ?? "" : role === "comercial" ? meId : "", collaborator_id: c?.collaborator_id ?? "", origin: c?.origin ?? "", tags: c?.tags ?? [],
  priority: c?.priority ?? "mitjana", next_follow_up: c?.next_follow_up ?? "",
});

export function ClientForm({ client, facets, onClose, onSaved }: { client: (CrmClient & { owner_name?: string | null }) | null; facets: Facets | null; onClose: () => void; onSaved: (id: string) => void }) {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const editing = !!client;
  const [f, setF] = useState<Form>(() => fromClient(client, me.id, me.role));
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [dup, setDup] = useState<Awaited<ReturnType<typeof crmApi.check>> | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  const payload = () => ({ ...f, legal_rep_role: f.legal_rep_role || null, owner_id: f.owner_id || null, collaborator_id: f.collaborator_id || null, registered_at: f.registered_at || null, next_follow_up: f.next_follow_up || null });
  const parsed = useMemo(() => clientInput.safeParse(payload()), [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) { const k = String(i.path[0] ?? ""); if (!e[k]) e[k] = i.message; }
    return e;
  }, [parsed]);
  const tax = checkTaxId(f.tax_id);
  const err = (k: keyof Form) => (touched.has(k) ? errors[k] : undefined);
  const touch = (...k: (keyof Form)[]) => setTouched((t) => new Set([...t, ...k]));

  // control de duplicats (NIF/CIF a tota la base de dades; telèfon i correu entre els clients que veus)
  useEffect(() => {
    const t = setTimeout(() => {
      const taxOk = tax.valid && tax.value ? tax.value : null;
      if (!taxOk && !f.phone && !f.email) { setDup(null); return; }
      crmApi.check({ taxId: taxOk, phone: f.phone || null, email: f.email || null, exclude: client?.id ?? null }).then(setDup).catch(() => setDup(null));
    }, 450);
    return () => clearTimeout(t);
  }, [f.tax_id, f.phone, f.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepErrors = (i: number) => FIELDS_BY_STEP[STEPS[i].id].filter((k) => errors[k]);
  const next = () => {
    touch(...FIELDS_BY_STEP[STEPS[step].id]);
    if (stepErrors(step).length) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const save = async (): Promise<boolean> => {
    touch(...(Object.keys(f) as (keyof Form)[]));
    if (!parsed.success) { setStep(STEPS.findIndex((_, i) => stepErrors(i).length > 0)); return false; }
    if (dup?.taxId) { setStep(0); return false; }
    setBusy(true);
    setServerError(null);
    try {
      const r = editing ? await crmApi.update(client!.id, payload()) : await crmApi.create(payload());
      useApp.getState().toast({ title: editing ? "Client actualitzat" : "Client creat", body: f.name, tone: "ok" });
      setInitial(JSON.stringify(f));
      onSaved(r.id);
      return true;
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Fase 9: canvis sense desar → avís en sortir de la pantalla i en tancar el formulari
  const [initial, setInitial] = useState(() => JSON.stringify(fromClient(client, me.id, me.role)));
  const dirty = JSON.stringify(f) !== initial;
  useUnsavedChanges(editing ? `Edició de ${client!.name}` : "Nou client", dirty, save);
  const [askClose, setAskClose] = useState(false);
  const tryClose = () => (dirty ? setAskClose(true) : onClose());

  const users = facets?.users ?? [];
  const comercials = users.filter((u) => u.role === "comercial" || isStaff(u.role as never));
  const collaborators = users.filter((u) => u.role === "colaborador");
  const sectors = facets?.sectors ?? [];
  const origins = [...new Set([...ORIGINS, ...(facets?.origins ?? [])])];
  const last = step === STEPS.length - 1;

  // funció (no component) perquè els camps no es tornin a muntar a cada tecla
  const input = ({ k, label, type = "text", placeholder, className, list, autoComplete, onBlurExtra }: { k: keyof Form; label: string; type?: string; placeholder?: string; className?: string; list?: string; autoComplete?: string; onBlurExtra?: () => void }) => (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      <input
        className={cn("input", err(k) && "border-lost/60 bg-lost/[0.03]")}
        type={type}
        value={f[k] as string}
        placeholder={placeholder}
        list={list}
        autoComplete={autoComplete ?? "off"}
        aria-invalid={!!err(k)}
        onChange={(e) => set({ [k]: e.target.value } as Partial<Form>)}
        onBlur={() => { touch(k); onBlurExtra?.(); }}
      />
      {err(k) && <span className="mt-1 block text-[11px] text-lost">{err(k)}</span>}
    </label>
  );

  return (
    <Modal
      open
      onClose={tryClose}
      width="max-w-3xl"
      title={editing ? `Edita · ${client!.name}` : "Nou client"}
      footer={
        askClose ? (
          <div className="flex w-full flex-wrap items-center gap-2" role="alertdialog" aria-label="Canvis sense desar">
            <span className="text-[12.5px] font-medium">Tens canvis sense desar.</span>
            <Button variant="ghost" className="ml-auto" onClick={() => setAskClose(false)}>Cancel·la</Button>
            <Button onClick={() => { setAskClose(false); onClose(); }}>Surt sense desar</Button>
            <Button variant="primary" disabled={busy} onClick={() => { setAskClose(false); void save(); }}>Desa i surt</Button>
          </div>
        ) : <div className="flex w-full items-center gap-2">
          {!editing && step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}><ChevronLeft size={15} /> Enrere</Button>}
          <Button variant="ghost" className="ml-auto" onClick={tryClose}>Cancel·la</Button>
          {!editing && !last ? <Button variant="primary" onClick={next}>Següent <ChevronRight size={15} /></Button>
            : <Button variant="primary" disabled={busy || !!dup?.taxId} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {editing ? "Desa els canvis" : "Crea el client"}</Button>}
        </div>}
    >
      <div className="space-y-4 text-[13px]">
        <ol className="grid grid-cols-3 gap-1.5" aria-label="Blocs del formulari">
          {STEPS.map((s, i) => {
            const bad = stepErrors(i).some((k) => touched.has(k));
            return (
              <li key={s.id}>
                <button type="button" disabled={!editing && i > step} onClick={() => setStep(i)}
                  className={cn("flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] disabled:opacity-50", step === i ? "border-brand bg-brand/5 font-medium text-brand" : "border-line text-muted", bad && "border-lost/50 text-lost")}>
                  <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px]", step > i && !bad ? "bg-ren text-white" : "bg-ink/[0.06]")}>{step > i && !bad ? <Check size={12} /> : i + 1}</span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>

        {step === 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipus de client">
              {CLIENT_KINDS.map((k) => {
                const Icon = k === "empresa" ? Building2 : k === "autonom" ? Store : User;
                return (
                  <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => set({ kind: k })}
                    className={cn("pressable flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left", f.kind === k ? "border-brand bg-brand/[0.06] text-brand ring-2 ring-brand/15" : "border-line hover:border-ink/25")}>
                    <Icon size={17} /> <span className="font-medium">{CLIENT_KIND_LABEL[k]}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {input({ k: "name", label: f.kind === "empresa" ? "Raó social *" : "Nom i cognoms *", placeholder: f.kind === "empresa" ? "Forn Sant Jordi SL" : "Maria Puig Soler" })}
              {f.kind !== "particular" ? input({ k: "trade_name", label: "Nom comercial", placeholder: "Opcional" }) : <div className="hidden sm:block" />}
              <label className="block">
                <span className="label">{f.kind === "empresa" ? "CIF" : "NIF / NIE"}</span>
                <input className={cn("input font-mono uppercase", (err("tax_id") || dup?.taxId) && "border-lost/60")} value={f.tax_id} onChange={(e) => set({ tax_id: e.target.value })} onBlur={() => touch("tax_id")} placeholder={f.kind === "empresa" ? "B12345678" : "12345678Z"} autoComplete="off" />
                {err("tax_id") ? <span className="mt-1 block text-[11px] text-lost">{err("tax_id")}</span>
                  : f.tax_id && tax.valid && tax.type ? <span className="mt-1 block text-[11px] text-ren">{tax.type === "altre" ? tax.message : `${tax.type.toUpperCase()} vàlid: ${tax.value}`}</span> : null}
              </label>
              <label className="block">
                <span className="label">Activitat o sector</span>
                <input className="input" list="crm-sectors" value={f.sector} onChange={(e) => set({ sector: e.target.value })} placeholder="Hostaleria, alimentació, oficines…" />
                <datalist id="crm-sectors">{sectors.map((s) => <option key={s} value={s} />)}</datalist>
              </label>
              {input({ k: "registered_at", label: "Data d'alta", type: "date" })}
              <label className="block">
                <span className="label">Estat comercial</span>
                <select className="input" value={f.status} disabled={me.role === "colaborador"} onChange={(e) => set({ status: e.target.value })}>{CLIENT_STATUSES.map((s) => <option key={s} value={s}>{CLIENT_STATUS_LABEL[s]}</option>)}</select>
              </label>
            </div>
            {dup?.taxId && (
              <div className="flex items-start gap-2 rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                {dup.taxId.visible ? (
                  <span>Ja existeix el client <b>{dup.taxId.name}</b> amb aquest identificador. <button className="underline" onClick={() => { onClose(); useApp.getState().navigate("client", { id: dup.taxId!.id! }); }}>Obre la seva fitxa</button></span>
                ) : <span>Ja hi ha un client amb aquest NIF/CIF assignat a un altre usuari. Demana a Administració que te&apos;l comparteixi.</span>}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {input({ k: "contact_name", label: f.kind === "empresa" ? "Persona de contacte habitual" : "Persona de contacte principal", placeholder: f.kind === "particular" ? "Si és diferent del titular" : "Nom i cognoms" })}
            {f.kind === "empresa" ? input({ k: "contact_role", label: "Càrrec del contacte", placeholder: "Gerència, administració…" }) : <div className="hidden sm:block" />}
            {f.kind === "empresa" && (
              <fieldset className="space-y-3 rounded-xl border border-line p-3 sm:col-span-2" data-testid="legal-rep">
                <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Representant legal</legend>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={f.contact_is_legal_rep} onChange={(e) => set({ contact_is_legal_rep: e.target.checked, ...(e.target.checked ? { legal_rep_name: f.contact_name } : {}) })} />
                  El contacte habitual també és el representant legal
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="label">Nom i cognoms</span>
                    <input className="input" value={f.contact_is_legal_rep ? f.contact_name : f.legal_rep_name} disabled={f.contact_is_legal_rep} onChange={(e) => set({ legal_rep_name: e.target.value })} autoComplete="off" />
                  </label>
                  <label className="block">
                    <span className="label">DNI / NIE</span>
                    <input className={cn("input font-mono uppercase", err("legal_rep_tax_id") && "border-lost/60")} value={f.legal_rep_tax_id} onFocus={() => { if (f.legal_rep_tax_id.includes("*")) set({ legal_rep_tax_id: "" }); }} onChange={(e) => set({ legal_rep_tax_id: e.target.value })} onBlur={() => { touch("legal_rep_tax_id"); if (!f.legal_rep_tax_id.trim() && client?.legal_rep_tax_id === MASKED) set({ legal_rep_tax_id: "********" }); }} placeholder={client?.legal_rep_tax_id === MASKED ? "Ocult: escriu-ne un de nou per canviar-lo" : "12345678Z"} autoComplete="off" />
                    {err("legal_rep_tax_id") && <span className="mt-1 block text-[11px] text-lost">{err("legal_rep_tax_id")}</span>}
                  </label>
                  <label className="block">
                    <span className="label">Càrrec</span>
                    <select className="input" value={f.legal_rep_role} onChange={(e) => set({ legal_rep_role: e.target.value })}>
                      <option value="">—</option>
                      {LEGAL_REP_ROLES.map((r) => <option key={r} value={r}>{LEGAL_REP_ROLE_LABEL[r]}</option>)}
                    </select>
                  </label>
                </div>
              </fieldset>
            )}
            {input({ k: "phone", label: "Telèfon", type: "tel", placeholder: "600 11 22 33" })}
            {input({ k: "phone2", label: "Telèfon secundari", type: "tel" })}
            {input({ k: "email", label: "Correu electrònic", type: "email", placeholder: "nom@empresa.cat", className: "sm:col-span-2" })}
            {input({ k: "address", label: "Adreça", placeholder: "Carrer, número, pis", className: "sm:col-span-2" })}
            <div className="grid grid-cols-[110px_1fr] gap-2 sm:col-span-2 sm:grid-cols-[110px_1fr_1fr]">
              {input({ k: "postal_code", label: "Codi postal", placeholder: "25001", onBlurExtra: () => { const p = provinceFromPostalCode(f.postal_code.trim()); if (p && !f.province) set({ province: p }); } })}
              {input({ k: "city", label: "Municipi" })}
              {input({ k: "province", label: "Província", className: "col-span-2 sm:col-span-1" })}
            </div>
            <label className="block sm:col-span-2">
              <span className="label">Observacions</span>
              <textarea className="input min-h-[80px]" value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Horari de contacte, persona que decideix, context…" />
            </label>
            {dup && dup.similar.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-pend/40 bg-pend/[0.06] px-3 py-2 text-[12.5px] sm:col-span-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-pend" />
                <span>Possible duplicat: {dup.similar.map((s, i) => <span key={s.id}>{i > 0 && ", "}<b>{s.name}</b> ({s.reason})</span>)}. Pots continuar si és un client diferent.</span>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Comercial assignat</span>
              {staff ? (
                <select className="input" value={f.owner_id} onChange={(e) => set({ owner_id: e.target.value })}>
                  <option value="">Sense assignar</option>
                  {comercials.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : <input className="input" disabled value={editing ? client?.owner_name ?? "—" : me.role === "comercial" ? me.name : "L'assignarà Administració"} />}
            </label>
            <label className="block">
              <span className="label">Col·laborador que l&apos;ha aportat</span>
              {staff ? (
                <select className="input" value={f.collaborator_id} onChange={(e) => set({ collaborator_id: e.target.value })}>
                  <option value="">Cap</option>
                  {collaborators.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : <input className="input" disabled value={me.role === "colaborador" && !editing ? me.name : "—"} />}
            </label>
            <label className="block">
              <span className="label">Origen del client</span>
              <select className="input" value={f.origin} onChange={(e) => set({ origin: e.target.value })}>
                <option value="">—</option>
                {origins.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Prioritat</span>
              <div className="flex gap-1.5">
                {PRIORITIES.map((p) => (
                  <button key={p} type="button" onClick={() => set({ priority: p })} className={cn("pressable flex-1 rounded-lg border px-2 py-2 text-[12.5px]", f.priority === p ? "border-brand bg-brand/[0.06] font-medium text-brand" : "border-line text-muted")}>{PRIORITY_LABEL[p]}</button>
                ))}
              </div>
            </label>
            <div className="sm:col-span-2">
              <span className="label">Etiquetes</span>
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-1.5">
                {f.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-[12px] text-brand">
                    {t}<button type="button" aria-label={`Treu ${t}`} onClick={() => set({ tags: f.tags.filter((x) => x !== t) })}><X size={12} /></button>
                  </span>
                ))}
                <input
                  className="min-w-[140px] flex-1 bg-transparent py-1 text-[13px] outline-none"
                  placeholder={f.tags.length ? "" : "Escriu i prem Enter (p. ex. hostaleria, multi-punt)"}
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && tagDraft.trim()) { e.preventDefault(); const t = tagDraft.trim().toLowerCase().slice(0, 40); if (!f.tags.includes(t) && f.tags.length < 20) set({ tags: [...f.tags, t] }); setTagDraft(""); }
                    if (e.key === "Backspace" && !tagDraft && f.tags.length) set({ tags: f.tags.slice(0, -1) });
                  }}
                />
              </div>
            </div>
            {input({ k: "next_follow_up", label: "Proper seguiment", type: "date" })}
          </div>
        )}
        {serverError && <p className="rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost">{serverError}</p>}
      </div>
    </Modal>
  );
}
