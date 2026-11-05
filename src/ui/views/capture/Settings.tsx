"use client";
/** Campanyes (registre i costos), regles d'assignació de leads i estat de les integracions. */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Copy, Loader2, Plus, RefreshCw } from "lucide-react";
import { useApp } from "@/data/store";
import { CHANNEL_LABEL, CHANNELS } from "@/core/capture";
import { Badge, Button, Empty, Field, Modal, Notice } from "../../components/ui";
import { capApi, eur } from "./api";
import type { Integration } from "./Dashboard";

const useToast = () => useApp((s) => s.toast);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ======================================================================= campanyes */

type Camp = { id: string; name: string; platform: string; status: string; utm_campaign: string | null; visits: number; leads: number; contracts: number; cost: number | null; costSource: string | null };
export function CampaignsTab() {
  const toast = useToast();
  const [rows, setRows] = useState<Camp[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [edit, setEdit] = useState<Partial<Camp> | null>(null);
  const [costs, setCosts] = useState<Camp | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const d = await capApi.get<{ byCampaign: Camp[]; canEdit: boolean }>("dashboard", { from: new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10) }); setRows(d.byCampaign); setCanEdit(d.canEdit); }
    catch (e) { toast({ title: "Error", body: errMsg(e), tone: "err" }); setRows([]); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);
  const sync = async () => {
    setBusy(true);
    try { const r = await capApi.act<{ status: string; imported: number; error?: string }>("google_sync"); toast({ title: r.status === "ok" ? `Google Ads: ${r.imported} registres importats` : r.status === "pendent_credencials" ? "Google Ads pendent de credencials" : "Error de Google Ads", body: r.error, tone: r.status === "ok" ? "ok" : "info" }); await load(); }
    catch (e) { toast({ title: "Error", body: errMsg(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <Notice tone="blue">Aquí es registren les campanyes per relacionar UTM, leads i costos. <b>No es creen ni es modifiquen campanyes ni pressupostos a Google ni a Meta.</b> Els costos arriben de l&apos;API (lectura) o els registra Direcció a mà.</Notice>
      <div className="flex flex-wrap gap-2">{canEdit && <><Button variant="primary" size="sm" onClick={() => setEdit({ platform: "google_ads", status: "activa" })}><Plus size={13} /> Nova campanya</Button><Button size="sm" onClick={sync} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sincronitza costos de Google Ads</Button></>}</div>
      {!rows ? <div className="h-40 animate-pulse rounded-2xl bg-elevated" /> : !rows.length ? <Empty icon={<Plus size={20} />} title="Cap campanya registrada" body="Registra la campanya amb el mateix utm_campaign que fas servir als anuncis." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface"><table className="w-full text-[12.5px]"><thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr>{["Campanya", "Plataforma", "UTM", "Estat (intern)", "Leads 90 d", "Cost 90 d", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{rows.map((c) => <tr key={c.id}><td className="px-3 py-2 font-medium">{c.name}</td><td className="px-3">{c.platform === "google_ads" ? "Google Ads" : c.platform === "meta_ads" ? "Meta Ads" : "Altres"}</td><td className="px-3 font-mono text-[11.5px]">{c.utm_campaign ?? "—"}</td><td className="px-3"><Badge tone={c.status === "activa" ? "green" : "zinc"}>{c.status}</Badge></td><td className="px-3 tnum">{c.leads}</td><td className="px-3 tnum">{c.cost == null ? <span className="text-muted">No disponible</span> : eur(c.cost, 0)}</td><td className="px-3 text-right">{canEdit && <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edita</Button><Button size="sm" variant="ghost" onClick={() => setCosts(c)}>Costos</Button></span>}</td></tr>)}</tbody></table></div>
      )}
      {edit && <CampaignDialog c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
      {costs && <CostsDialog c={costs} onClose={() => setCosts(null)} onSaved={() => { setCosts(null); void load(); }} />}
    </div>
  );
}

function CampaignDialog({ c, onClose, onSaved }: { c: Partial<Camp> & { external_id?: string | null; utm_source?: string | null }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ id: c.id, name: c.name ?? "", platform: c.platform ?? "google_ads", utm_campaign: c.utm_campaign ?? "", external_id: c.external_id ?? "", status: c.status ?? "activa" });
  const save = async () => { try { await capApi.act("campaign_save", { data: { ...f, utm_campaign: f.utm_campaign || null, external_id: f.external_id || null } }); toast({ title: "Campanya desada", tone: "ok" }); onSaved(); } catch (e) { toast({ title: "No s'ha desat", body: errMsg(e), tone: "err" }); } };
  return (
    <Modal open onClose={onClose} title={f.id ? "Edita la campanya" : "Nova campanya"} footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!f.name.trim()} onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom"><input className="input h-9" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Plataforma"><select className="input h-9" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}><option value="google_ads">Google Ads</option><option value="meta_ads">Meta Ads</option><option value="altres">Altres</option></select></Field>
        <Field label="utm_campaign" hint="El mateix valor que porten els enllaços dels anuncis"><input className="input h-9 font-mono" value={f.utm_campaign} onChange={(e) => setF({ ...f, utm_campaign: e.target.value })} /></Field>
        <Field label="Identificador a la plataforma (opcional)"><input className="input h-9 font-mono" value={f.external_id} onChange={(e) => setF({ ...f, external_id: e.target.value })} /></Field>
        <Field label="Estat (registre intern)"><select className="input h-9" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="activa">Activa</option><option value="pausada">Pausada</option><option value="finalitzada">Finalitzada</option></select></Field>
      </div>
    </Modal>
  );
}

function CostsDialog({ c, onClose, onSaved }: { c: Camp; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [txt, setTxt] = useState("");
  const rows = txt.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => { const [day, cost, clicks, impressions] = l.split(/[;,\t]/).map((x) => x.trim()); return { day, cost_eur: cost?.replace(",", "."), clicks: clicks || null, impressions: impressions || null }; });
  const valid = rows.length > 0 && rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && Number.isFinite(Number(r.cost_eur)));
  const save = async () => { try { const r = await capApi.act<{ imported: number }>("costs_import", { campaignId: c.id, rows }); toast({ title: `${r.imported} dies de cost registrats`, tone: "ok" }); onSaved(); } catch (e) { toast({ title: "No s'han desat", body: errMsg(e), tone: "err" }); } };
  return (
    <Modal open onClose={onClose} title={`Costos · ${c.name}`} footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!valid} onClick={save}>Registra {rows.length || ""}</Button></>}>
      <p className="text-[12.5px] text-muted">Copia els costos de l&apos;informe de la plataforma: una línia per dia, <span className="font-mono">AAAA-MM-DD;cost;clics;impressions</span>. Es registren com a font «manual».</p>
      <textarea className="input mt-2 min-h-[160px] py-2 font-mono text-[12px]" placeholder={"2026-10-01;34,20;51;2300\n2026-10-02;29,80;44;2105"} value={txt} onChange={(e) => setTxt(e.target.value)} />
      {txt && !valid && <p className="mt-1 text-[12px] text-red-600">Revisa el format de les dates i els imports.</p>}
    </Modal>
  );
}

/* ======================================================================= regles d'assignació */

type Rule = { id: string; name: string; priority: number; active: boolean; strategy: "usuari" | "rotatiu" | "menys_carrega"; user_ids: string[]; max_open_leads: number | null; conditions: { provinces?: string[]; energy?: string[]; customer_kinds?: string[]; channels?: string[] } };
const STRAT = { usuari: "Usuari fix", rotatiu: "Rotació", menys_carrega: "Menys càrrega de treball" };
export function RulesTab() {
  const toast = useToast();
  const [d, setD] = useState<{ rules: Rule[]; users: { id: string; name: string }[]; canEdit: boolean } | null>(null);
  const [edit, setEdit] = useState<Partial<Rule> | null>(null);
  const load = useCallback(async () => { try { setD(await capApi.get("rules")); } catch (e) { toast({ title: "Error", body: errMsg(e), tone: "err" }); } }, [toast]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <div className="h-40 animate-pulse rounded-2xl bg-elevated" />;
  const name = (id: string) => d.users.find((u) => u.id === id)?.name ?? "—";
  return (
    <div className="space-y-3">
      <Notice tone="blue">Cada lead captat s&apos;assigna amb la primera regla activa que hi encaixa (per prioritat). Si cap no hi encaixa, queda pendent i s&apos;avisa Direcció. Totes les assignacions queden a l&apos;historial del lead; Direcció pot reassignar-les a mà amb un motiu.</Notice>
      {d.canEdit && <Button variant="primary" size="sm" onClick={() => setEdit({ name: "", priority: 100, active: true, strategy: "menys_carrega", user_ids: [], conditions: {} })}><Plus size={13} /> Nova regla</Button>}
      {!d.rules.length ? <Empty icon={<Plus size={20} />} title="Cap regla d'assignació" body="Sense regles, els leads captats queden pendents d'assignar." /> : (
        <ul className="space-y-2">{d.rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[12.5px]">
            <span className="w-10 text-muted tnum">#{r.priority}</span><span className="font-medium">{r.name}</span><Badge tone={r.active ? "green" : "zinc"}>{r.active ? "Activa" : "Inactiva"}</Badge>
            <span className="text-muted">{[r.conditions.provinces?.length ? `Províncies: ${r.conditions.provinces.join(", ")}` : null, r.conditions.energy?.length ? `Energia: ${r.conditions.energy.join(", ")}` : null, r.conditions.customer_kinds?.length ? `Client: ${r.conditions.customer_kinds.join(", ")}` : null, r.conditions.channels?.length ? `Canals: ${r.conditions.channels.map((c) => CHANNEL_LABEL[c as keyof typeof CHANNEL_LABEL] ?? c).join(", ")}` : null].filter(Boolean).join(" · ") || "Tots els leads"}</span>
            <span className="ml-auto text-muted">{STRAT[r.strategy]} → {r.user_ids.map(name).join(", ")}{r.max_open_leads ? ` (màx. ${r.max_open_leads} oberts)` : ""}</span>
            {d.canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edita</Button>}
          </li>
        ))}</ul>
      )}
      {edit && <RuleDialog r={edit} users={d.users} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </div>
  );
}

function RuleDialog({ r, users, onClose, onSaved }: { r: Partial<Rule>; users: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ ...r, conditions: r.conditions ?? {} } as Rule);
  const toggle = <T extends string>(list: T[] | undefined, v: T) => (list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v];
  const save = async () => { try { await capApi.act("rule_save", { data: { ...f, max_open_leads: f.max_open_leads || null } }); toast({ title: "Regla desada", tone: "ok" }); onSaved(); } catch (e) { toast({ title: "No s'ha desat", body: errMsg(e), tone: "err" }); } };
  return (
    <Modal open onClose={onClose} title={f.id ? "Edita la regla" : "Nova regla d'assignació"} width="max-w-2xl" footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!f.name?.trim() || !f.user_ids.length} onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <Field label="Nom"><input className="input h-9" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Prioritat"><input className="input h-9" inputMode="numeric" value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value.replace(/\D/g, "")) || 1 })} /></Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Províncies (separades per comes)"><input className="input h-9" value={(f.conditions.provinces ?? []).join(", ")} onChange={(e) => setF({ ...f, conditions: { ...f.conditions, provinces: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} /></Field>
        <Field label="Màxim de leads oberts per comercial (opcional)"><input className="input h-9" inputMode="numeric" value={f.max_open_leads ?? ""} onChange={(e) => setF({ ...f, max_open_leads: Number(e.target.value) || null })} /></Field>
      </div>
      <div className="mt-3 space-y-2 text-[12.5px]">
        <p className="font-medium">Energia i client</p>
        <div className="flex flex-wrap gap-2">{(["luz", "gas"] as const).map((x) => <label key={x} className="flex items-center gap-1.5"><input type="checkbox" checked={(f.conditions.energy ?? []).includes(x)} onChange={() => setF({ ...f, conditions: { ...f.conditions, energy: toggle(f.conditions.energy, x) } })} />{x === "luz" ? "Llum" : "Gas"}</label>)}{(["particular", "empresa"] as const).map((x) => <label key={x} className="flex items-center gap-1.5"><input type="checkbox" checked={(f.conditions.customer_kinds ?? []).includes(x)} onChange={() => setF({ ...f, conditions: { ...f.conditions, customer_kinds: toggle(f.conditions.customer_kinds, x) } })} />{x === "particular" ? "Particular" : "Empresa"}</label>)}</div>
        <p className="font-medium">Canals (cap = tots)</p>
        <div className="flex flex-wrap gap-2">{CHANNELS.map((c) => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={(f.conditions.channels ?? []).includes(c)} onChange={() => setF({ ...f, conditions: { ...f.conditions, channels: toggle(f.conditions.channels, c) } })} />{CHANNEL_LABEL[c]}</label>)}</div>
        <p className="font-medium">Estratègia</p>
        <div className="flex flex-wrap gap-3">{(Object.keys(STRAT) as (keyof typeof STRAT)[]).map((k) => <label key={k} className="flex items-center gap-1.5"><input type="radio" name="strat" checked={f.strategy === k} onChange={() => setF({ ...f, strategy: k })} />{STRAT[k]}</label>)}</div>
        <p className="font-medium">Comercials</p>
        <div className="flex flex-wrap gap-2">{users.map((u) => <label key={u.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1"><input type="checkbox" checked={f.user_ids.includes(u.id)} onChange={() => setF({ ...f, user_ids: toggle(f.user_ids, u.id) })} />{u.name}</label>)}</div>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activa</label>
      </div>
    </Modal>
  );
}

/* ======================================================================= integracions */

export function IntegrationsTab() {
  const [d, setD] = useState<Record<string, Integration> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { capApi.get<Record<string, Integration>>("integrations").then(setD, () => setD({})); }, []);
  const origin = typeof location !== "undefined" ? location.origin : "";
  const hooks = [["Meta Lead Ads", `${origin}/api/webhooks/meta`], ["WhatsApp Business", `${origin}/api/webhooks/whatsapp`]];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-[13px] font-semibold">Estat</h3>
        <ul className="mt-2 space-y-2.5">{Object.entries(d ?? {}).map(([k, i]) => <li key={k} className="flex items-start gap-2 text-[12.5px]">{i.ok ? <CheckCircle2 size={15} className="mt-0.5 text-green-600" /> : <CircleDashed size={15} className="mt-0.5 text-muted" />}<span><b className="font-medium">{i.label}</b><span className="block text-[11.5px] text-muted">{i.note}</span></span></li>)}</ul>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-[13px] font-semibold">Webhooks (per configurar a Meta)</h3>
        <ul className="mt-2 space-y-2">{hooks.map(([l, u]) => <li key={l} className="text-[12px]"><p className="font-medium">{l}</p><p className="flex items-center gap-1.5"><span className="truncate font-mono text-[11.5px] text-muted">{u}</span><button onClick={async () => { await navigator.clipboard.writeText(u).catch(() => undefined); setCopied(l); setTimeout(() => setCopied(null), 1200); }} aria-label={`Copia ${l}`}>{copied === l ? <CheckCircle2 size={13} /> : <Copy size={13} />}</button></p></li>)}</ul>
        <p className="mt-3 text-[11.5px] text-muted">Token de verificació: META_WEBHOOK_VERIFY_TOKEN · signatura: META_APP_SECRET. Sense aquestes variables, els webhooks responen 401/403 i no es processa res.</p>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
        <h3 className="text-[13px] font-semibold">Privacitat i publicitat</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-muted">
          <li>Les conversions es registren internament. No s&apos;envien dades personals (correu, telèfon) a Google ni a Meta: cal una base jurídica i la configuració de privacitat corresponent abans d&apos;activar-ho.</li>
          <li>Les dades de les factures no s&apos;utilitzen per crear audiències publicitàries.</li>
          <li>Els gclid/fbclid i les UTM es guarden amb la sol·licitud per atribuir el canal; la landing no fa servir cookies de tercers.</li>
        </ul>
      </section>
    </div>
  );
}
