"use client";
/**
 * Client de l'API d'agrupació per contacte (/api/renewals/groups). En mode demostració (sense servidor) les decisions
 * es guarden en memòria i les comunicacions només es preparen (enllaç de WhatsApp o del programa de correu).
 */
import type { C360Index, ManualLink } from "@/core/contact-groups";
import type { Activity } from "@/core/types";
import { useApp } from "./store";
import { uid } from "./defaults";

export interface GroupAuthorization { contact_key: string; holder_key: string; basis: string; granted_by_name: string | null; granted_at: string }
export interface GroupData { links: ManualLink[]; authorizations: GroupAuthorization[]; c360: C360Index; migrationMissing: boolean }
export interface GroupOp { id: string; kind: string; channel: string | null; contact_name: string | null; recipient: string | null; contract_ids: string[]; subject: string | null; body: string | null; attachments: { id: string; contractId: string; fileName: string }[]; status: string; error: string | null; outcome: string | null; notes: string | null; at: string; created_by_name: string | null; confirmed_at: string | null }
export interface Holder { key: string; name: string; contracts: string[]; authorized: boolean; via: "propi" | "autoritzacio" | "clients360" | null }
export interface Preflight { ok: boolean; blocking: string[]; warnings: string[]; holders: Holder[]; lastSent: { at: string; by: string | null; status: string } | null; fingerprint: string | null; recipientKey: string | null; docs: { id: string; contract_id: string; version: number; file_name: string; ahorro_anual: number | null }[]; sender: { corporateMail: boolean; whatsappMode: "cloud" | "enllac" } }
export interface SendResult { id: string; status: "enviat" | "intent" | "error" | "preparat" | "registrat"; error?: string | null; existed: boolean; waLink?: string | null; activities: Activity[] }
export interface ClientRelations {
  contacts: { id: string; name: string; phone: string | null; email: string | null; is_primary: boolean }[];
  links: { id: string; contact_id: string; client_id: string; client_name: string; contact_name: string; role: string | null; status: string; authorized: boolean; basis: string | null; note: string | null; created_by_name: string | null; created_at: string; own: boolean }[];
  detected: { contactId: string; contactName: string; otherContactId: string; otherContactName: string; clientId: string; clientName: string; reason: "telefon" | "email" }[];
  migrationMissing: boolean;
}

export class GroupApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const live = () => useApp.getState().repo?.mode === "supabase";

async function call<T>(init?: { method?: string; body?: unknown; qs?: string }): Promise<T> {
  const r = await fetch(`/api/renewals/groups${init?.qs ?? ""}`, { method: init?.method ?? "GET", cache: "no-store", headers: { "content-type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new GroupApiError(r.status, (j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}
const post = <T,>(action: string, data?: unknown, id?: string) => call<T>({ method: "POST", body: { action, data, id } });

/* ---------------------------------------------------------------- mode demostració (en memòria) */
const demo = { links: [] as ManualLink[], ops: [] as GroupOp[] };

export const groupsApi = {
  newOpId: () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid()),
  async data(): Promise<GroupData> {
    if (!live()) return { links: demo.links.slice(), authorizations: [], c360: {}, migrationMissing: false };
    return call<GroupData>();
  },
  async link(kind: "unir" | "separar", a: string, b: string, reason?: string | null): Promise<void> {
    if (!live()) {
      const [x, y] = a < b ? [a, b] : [b, a];
      demo.links = demo.links.filter((l) => !(l.contract_a === x && l.contract_b === y));
      demo.links.push({ id: uid(), kind, contract_a: x, contract_b: y, reason: reason ?? null, created_by_name: useApp.getState().snap?.me.name ?? null, created_at: new Date().toISOString() });
      return;
    }
    await post("link", { kind, a, b, reason: reason ?? null });
  },
  async unlink(id: string): Promise<void> {
    if (!live()) { demo.links = demo.links.filter((l) => l.id !== id); return; }
    await post("unlink", null, id);
  },
  async activity(d: { opId: string; kind: "trucada" | "visita" | "reunio" | "nota" | "comunicacio"; channel?: string | null; contractIds: string[]; contactName?: string | null; recipient?: string | null; notes?: string | null; outcome?: string | null; at?: string }): Promise<{ activities: Activity[]; existed: boolean }> {
    if (!live()) {
      const st = useApp.getState();
      const acts: Activity[] = [];
      for (const id of d.contractIds) acts.push(await st.log({ contractId: id, type: d.kind === "trucada" ? "call" : "note", title: `${d.kind} conjunta (${d.contractIds.length} contractes)${d.outcome ? ` · ${d.outcome}` : ""}`, body: d.notes ?? undefined, meta: { groupOpId: d.opId } }));
      demo.ops.unshift({ id: d.opId, kind: d.kind, channel: d.channel ?? null, contact_name: d.contactName ?? null, recipient: d.recipient ?? null, contract_ids: d.contractIds, subject: null, body: null, attachments: [], status: "registrat", error: null, outcome: d.outcome ?? null, notes: d.notes ?? null, at: new Date().toISOString(), created_by_name: st.snap?.me.name ?? null, confirmed_at: null });
      return { activities: [], existed: false }; // ja s'han afegit amb log()
    }
    return post("activity", d);
  },
  async ops(contractId: string): Promise<{ ops: GroupOp[]; migrationMissing: boolean }> {
    if (!live()) return { ops: demo.ops.filter((o) => o.contract_ids.includes(contractId)), migrationMissing: false };
    return call({ qs: `?r=ops&contract=${encodeURIComponent(contractId)}` });
  },
  async preflight(d: { contractIds: string[]; channel: "whatsapp" | "email"; recipient: string }): Promise<Preflight> {
    if (!live()) {
      const docs = (useApp.getState().snap?.docs ?? []).filter((x) => d.contractIds.includes(x.contractId)).sort((a, b) => b.version - a.version);
      const latest = new Map<string, Preflight["docs"][number]>();
      for (const x of docs) if (!latest.has(x.contractId)) latest.set(x.contractId, { id: x.id, contract_id: x.contractId, version: x.version, file_name: x.fileName, ahorro_anual: x.ahorroAnual });
      return { ok: true, blocking: [], warnings: ["Mode demostració: no s'envia res, només es prepara el missatge"], holders: [], lastSent: null, fingerprint: null, recipientKey: null, docs: [...latest.values()], sender: { corporateMail: false, whatsappMode: "enllac" } };
    }
    return post("preflight", d);
  },
  async send(d: { opId: string; contractIds: string[]; channel: "whatsapp" | "email"; recipient: string; contactName?: string | null; subject?: string; body: string; templateId?: string | null; attachDocIds: string[]; confirmed: true; confirmResend?: boolean }): Promise<SendResult> {
    if (!live()) {
      const st = useApp.getState();
      const link = d.channel === "whatsapp" ? `https://wa.me/${d.recipient.replace(/\D/g, "")}?text=${encodeURIComponent(d.body)}` : `mailto:${encodeURIComponent(d.recipient)}?subject=${encodeURIComponent(d.subject ?? "")}&body=${encodeURIComponent(d.body)}`;
      for (const id of d.contractIds) await st.log({ contractId: id, type: d.channel, title: `Comunicació conjunta preparada (${d.contractIds.length} contractes)`, body: d.body, delivery: "preparado", meta: { groupOpId: d.opId, to: d.recipient } });
      return { id: d.opId, status: "intent", existed: false, waLink: link, activities: [] };
    }
    return post("send", d);
  },
  async confirmWhatsapp(opId: string): Promise<SendResult> {
    if (!live()) return { id: opId, status: "registrat", existed: false, activities: [] };
    return post("confirm_wa", null, opId);
  },
  async authorize(d: { contactKey: string; holderKey: string; basis: string; note: string }): Promise<void> {
    if (!live()) return;
    await post("authorize", d);
  },
  async clientRelations(clientId: string): Promise<ClientRelations> {
    if (!live()) return { contacts: [], links: [], detected: [], migrationMissing: false };
    return call({ qs: `?r=client&id=${encodeURIComponent(clientId)}` });
  },
  async contactLink(d: { contactId: string; clientId: string; role?: string | null; authorized: boolean; basis?: string | null; note?: string | null }): Promise<void> { await post("contact_link", d); },
  async contactUnlink(id: string): Promise<void> { await post("contact_unlink", null, id); },
};

/** Carrega (o recarrega) les decisions d'agrupació i els vincles de Clients 360° per calcular els grups. */
export async function loadGroupData() {
  try {
    const d = await groupsApi.data();
    useApp.setState({ groups: { links: d.links, c360: d.c360, authorizations: d.authorizations, loaded: true, migrationMissing: d.migrationMissing, error: null } });
  } catch (e) {
    // sense la migració 029 o sense connexió: el Kanban continua funcionant amb les coincidències automàtiques
    useApp.setState((s) => ({ groups: { ...s.groups, loaded: true, error: e instanceof Error ? e.message : String(e) } }));
  }
}
