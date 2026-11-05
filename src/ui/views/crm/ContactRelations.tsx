"use client";
/**
 * Clients 360° · «Altres contractes del mateix contacte» i persones de contacte compartides amb altres clients.
 * Una mateixa persona (p. ex. un administrador de finques) es pot relacionar amb diversos clients SENSE fusionar-ne
 * les fitxes: cada client conserva la seva identitat fiscal. Es distingeixen les relacions confirmades de les
 * coincidències detectades automàticament, i qualsevol relació es pot desfer (queda registrat qui i quan).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Loader2, ShieldCheck, Split, Users } from "lucide-react";
import type { CrmClientDetail } from "@/core/crm";
import { useApp } from "@/data/store";
import { groupsApi, type ClientRelations } from "@/data/groupsApi";
import { RelatedIndicator } from "../../components/groups/RelatedPanel";
import { Badge, Button, Notice } from "../../components/ui";
import { Section } from "./ClientDetail";

const cups20 = (c: string | null | undefined) => (c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);

/** Objectiu per a l'indicador: les persones de contacte del client i els seus propis contractes (que s'exclouen). */
export function useClientTarget(d: CrmClientDetail) {
  const contracts = useApp((s) => s.contracts);
  return useMemo(() => {
    const mine = new Set(d.supplies.map((s) => cups20(s.cups)));
    const legacy = new Set(d.contracts.map((k) => k.legacy_contract_id).filter(Boolean));
    const own = contracts.filter((k) => legacy.has(k.id) || (k.cups && mine.has(cups20(k.cups)))).map((k) => k.id);
    const people = [...d.contacts.map((p) => ({ id: p.id, name: p.name, phone: p.phone, email: p.email })), { name: d.client.contact_name, phone: d.client.phone, email: d.client.email }];
    return { client: { id: d.client.id, name: d.client.name, contacts: people, ownContractIds: own } };
  }, [d, contracts]);
}

export function ClientRelatedIndicator({ d }: { d: CrmClientDetail }) {
  const target = useClientTarget(d);
  return <RelatedIndicator target={target} />;
}

const BASIS: Record<string, string> = { representacio: "Representació", consentiment: "Consentiment", execucio_contracte: "Execució del contracte", interes_legitim: "Interès legítim", altre: "Altre" };

export function SharedContactsSection({ d }: { d: CrmClientDetail }) {
  const [r, setR] = useState<ClientRelations | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ contactId: string; clientId: string; label: string } | null>(null);
  const load = useCallback(() => groupsApi.clientRelations(d.client.id).then((x) => { setR(x); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), [d.client.id]);
  useEffect(() => { if (useApp.getState().repo?.mode === "supabase") void load(); }, [load]);
  if (err) return null; // sense la migració 029 o sense permisos: la fitxa continua igual
  if (!r || (!r.links.length && !r.detected.length)) return null;
  const unlink = async (id: string) => {
    try { await groupsApi.contactUnlink(id); await load(); } catch (e) { useApp.getState().toast({ title: "No s'ha pogut separar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  return (
    <Section title="Persones de contacte compartides">
      {r.migrationMissing && <Notice>Cal aplicar la migració 029 a Supabase per relacionar persones amb diversos clients.</Notice>}
      {r.links.length > 0 && (
        <ul className="space-y-1.5 text-[12.5px]">
          {r.links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
              <Users size={13} className="text-muted" />
              <span className="min-w-0 flex-1"><b>{l.contact_name}</b> {l.own ? "també gestiona" : "(contacte d'un altre client) gestiona"} <button className="text-brand hover:underline" onClick={() => useApp.getState().navigate("client", { id: l.client_id })}>{l.own ? l.client_name : d.client.name}</button>{!l.own && <> · fitxa original: <button className="text-brand hover:underline" onClick={() => useApp.getState().navigate("client", { id: l.client_id })}>{l.client_name}</button></>}</span>
              <Badge tone="green">Confirmada</Badge>
              {l.authorized ? <Badge tone="blue"><ShieldCheck size={11} /> Autoritzada · {BASIS[l.basis ?? ""] ?? l.basis}</Badge> : <Badge>Sense autorització d&apos;informació</Badge>}
              {d.permissions.canEdit && <Button size="sm" variant="ghost" onClick={() => void unlink(l.id)}><Split size={12} /> Separa</Button>}
            </li>
          ))}
        </ul>
      )}
      {r.detected.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Coincidències detectades automàticament</p>
          <ul className="space-y-1.5 text-[12.5px]">
            {r.detected.map((x) => (
              <li key={`${x.contactId}|${x.clientId}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2">
                <span className="min-w-0 flex-1"><b>{x.contactName}</b> té el mateix {x.reason === "telefon" ? "telèfon" : "correu"} que <b>{x.otherContactName}</b>, contacte de <button className="text-brand hover:underline" onClick={() => useApp.getState().navigate("client", { id: x.clientId })}>{x.clientName}</button></span>
                <Badge tone="amber">Detectada</Badge>
                {d.permissions.canEdit && <Button size="sm" onClick={() => setForm({ contactId: x.contactId, clientId: x.clientId, label: `${x.contactName} → ${x.clientName}` })}><Link2 size={12} /> Confirma la relació</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {form && <ConfirmForm {...form} onClose={() => setForm(null)} onDone={() => { setForm(null); void load(); }} />}
    </Section>
  );
}

function ConfirmForm({ contactId, clientId, label, onClose, onDone }: { contactId: string; clientId: string; label: string; onClose: () => void; onDone: () => void }) {
  const [authorized, setAuthorized] = useState(false);
  const [basis, setBasis] = useState("representacio");
  const [role, setRole] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await groupsApi.contactLink({ contactId, clientId, role: role || null, authorized, basis: authorized ? basis : null, note: note || null }); useApp.getState().toast({ title: "Relació confirmada", body: label, tone: "ok" }); onDone(); }
    catch (e) { useApp.getState().toast({ title: "No s'ha pogut confirmar", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-line p-3 text-[12.5px]">
      <p className="font-medium">Confirma la relació: {label}</p>
      <p className="text-[11.5px] text-muted">Les fitxes dels clients NO es fusionen: cadascun conserva el seu NIF i les seves dades.</p>
      <input className="input" placeholder="Funció (p. ex. administrador de finques)" value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} />
      <label className="flex items-center gap-2"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} /> Està autoritzada a rebre informació i propostes d&apos;aquest client</label>
      {authorized && <select className="input" value={basis} onChange={(e) => setBasis(e.target.value)}>{Object.entries(BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
      <input className="input" placeholder="Nota (com s'ha verificat)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onClose}>Cancel·la</Button><Button size="sm" variant="primary" disabled={busy} onClick={save}>{busy && <Loader2 size={13} className="animate-spin" />} Confirma</Button></div>
    </div>
  );
}
