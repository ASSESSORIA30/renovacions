"use client";
/**
 * Fitxa de captació d'un lead: origen i atribució, factura i lectura (revisió humana), comparativa preliminar,
 * proposta en esborrany, duplicats, assignació, consentiments i WhatsApp.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BadgeCheck, CircleAlert, Copy, FileDown, FileText, Handshake, Loader2, MessageCircle, Phone, Save, Send, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import { useApp } from "@/data/store";
import { CHANNEL_LABEL, type ReadField } from "@/core/capture";
import { PENDING_PRICE, type Alternative } from "@/core/intelligence";
import { Badge, Button, Notice, cn } from "../../components/ui";
import { capApi, eur, fdate, fdt } from "./api";
import { useAsk } from "./Ask";

type Reading = { id: string; status: string; method: string | null; fields: ReadField[]; warnings: string[]; missing: string[]; sufficient: boolean; comparison_id: string | null; preliminary: { ok: boolean; reason: string | null; current: { known: boolean; annualCost: number | null; label: string }; alternatives: Alternative[]; hypotheses: string[]; doubtful: string[]; evaluated: number } | null; error: string | null; attempts: number; updated_at: string };
type D = {
  lead: Record<string, unknown> & { id: string; name: string; phone: string | null; email: string | null; kind: string; status: string; owner_id: string | null; owner_name: string | null; capture_channel: string | null; duplicate_status: string; duplicate_refs: { kind: string; id: string; name: string | null; by: string[]; strength: string; client_id: string | null }[]; cups: string | null; tax_id: string | null; converted_client_id: string | null; created_at: string; notes: string | null };
  submission: { received_at: string; ref_code: string | null; utm: Record<string, string> | null; status: string; error: string | null } | null;
  consents: { id: string; kind: string; granted: boolean; text_version: string; created_at: string; withdrawn_at: string | null }[];
  documents: { id: string; kind: string; original_name: string; mime: string; size_bytes: number; status: string; created_at: string; client_document_id: string | null }[];
  readings: Reading[]; attributions: { id: string; status: string; source: string; ref_code: string | null; reason: string | null; created_at: string; cap_partners: { name: string; company: string | null } | null }[];
  assignments: { id: number; user_name: string | null; method: string; reason: string | null; created_at: string }[];
  whatsapp: { id: string; direction: string; body: string | null; status: string; created_at: string; error: string | null }[];
  partner: { name: string; company: string | null } | null; campaign: { name: string; platform: string } | null; users: { id: string; name: string }[];
  can: { review: boolean; assign: boolean; attribution: boolean; whatsapp: boolean; waConfigured: boolean };
};
const ST: Record<string, { l: string; t: "green" | "amber" | "zinc" | "blue" | "red" }> = { llegit: { l: "Llegit", t: "green" }, per_revisar: { l: "Per revisar", t: "amber" }, pendent: { l: "Pendent", t: "zinc" }, revisat: { l: "Revisat", t: "blue" } };
const CONSENT: Record<string, string> = { privacitat_servei: "Privacitat i estudi de la sol·licitud", comercial: "Comunicacions comercials", whatsapp: "Contacte per WhatsApp" };
const WA: Record<string, string> = { preparat: "Preparat", acceptat: "Acceptat per Meta (pendent de lliurament)", enviat: "Enviat", lliurat: "Lliurat", llegit: "Llegit", fallit: "Fallit", rebut: "Rebut" };

export function CaptureLeadView() {
  const id = useApp((s) => s.params.id);
  const go = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { ask, dialog } = useAsk();
  const load = useCallback(async () => { if (!id) return; try { setD(await capApi.get<D>("lead", { id })); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast({ title: ok, tone: "ok" }); await load(); } catch (e) { toast({ title: "No s'ha pogut completar", body: e instanceof Error ? e.message : String(e), tone: "err" }); } finally { setBusy(null); } };
  if (err) return <div className="mx-auto max-w-4xl px-4 py-6"><Notice tone="red">{err}</Notice></div>;
  if (!d) return <div className="mx-auto max-w-[1300px] space-y-3 px-4 py-6">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-elevated" />)}</div>;
  const l = d.lead;
  const reading = d.readings[0];
  const vigent = d.attributions.find((a) => a.status === "vigent");
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <button className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" onClick={() => go("captacio", {})}><ArrowLeft size={14} /> Captació i màrqueting</button>
      <header className="flex flex-wrap items-start gap-4 rounded-2xl border border-line bg-surface p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5"><Badge tone="zinc">{l.capture_channel ? CHANNEL_LABEL[l.capture_channel as keyof typeof CHANNEL_LABEL] : "Lead"}</Badge><Badge tone={l.status === "nou" ? "blue" : l.status === "descartat" ? "zinc" : "green"}>{l.status}</Badge>{l.duplicate_status === "possible_duplicat" && <Badge tone="amber"><CircleAlert size={10} /> Possible duplicat</Badge>}{l.duplicate_status === "duplicat_confirmat" && <Badge tone="red">Duplicat confirmat</Badge>}{l.converted_client_id && <Badge tone="green">Client</Badge>}</div>
          <h2 className="mt-1 text-[19px] font-semibold tracking-tight">{l.name}</h2>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">{l.phone && <a className="inline-flex items-center gap-1 hover:text-brand" href={`tel:${l.phone}`}><Phone size={12} /> {l.phone}</a>}{l.email && <span>{l.email}</span>}<span>{l.kind === "empresa" ? "Empresa" : "Particular"}</span>{l.cups && <span className="font-mono">{l.cups}</span>}<span>Rebut el {fdt(l.created_at)}</span></p>
          <p className="mt-1 flex flex-wrap gap-x-4 text-[12.5px]">{d.partner && <span className="inline-flex items-center gap-1"><Handshake size={12} className="text-brand" /> {d.partner.company || d.partner.name}{vigent ? "" : " (atribució pendent)"}</span>}{d.campaign && <span>Campanya: {d.campaign.name}</span>}{d.submission?.utm?.source && <span className="text-muted">utm: {Object.values(d.submission.utm).filter(Boolean).join(" · ")}</span>}<span>Responsable: <b>{l.owner_name ?? "sense assignar"}</b></span></p>
          {l.notes && <p className="mt-2 rounded-xl bg-elevated/70 px-3 py-2 text-[12.5px]">{l.notes}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="primary" onClick={() => go("leads", { id: l.id })}><UserCheck size={13} /> Obre el lead (convertir en client)</Button>
          {l.converted_client_id && <Button size="sm" onClick={() => go("client", { id: l.converted_client_id! })}>Fitxa del client</Button>}
        </div>
      </header>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Documents d={d} />
          {reading ? <ReadingCard r={reading} canReview={d.can.review} busy={busy} act={act} /> : <section className="rounded-2xl border border-line bg-surface p-4 text-[12.5px] text-muted">Aquest lead no té cap factura. Demana-la per poder fer la comparativa.</section>}
          {reading?.preliminary && <Preliminary r={reading} canReview={d.can.review} busy={busy} act={act} />}
        </div>
        <aside className="space-y-4">
          {d.lead.duplicate_refs?.length > 0 && (
            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-4">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><CircleAlert size={14} className="text-amber-600" /> Coincidències</h3>
              <p className="text-[11.5px] text-muted">No s&apos;ha fusionat res. Revisa-ho abans de convertir el lead.</p>
              <ul className="mt-2 space-y-1.5">{d.lead.duplicate_refs.map((r) => <li key={r.kind + r.id} className="text-[12.5px]"><button className="font-medium hover:text-brand" onClick={() => go(r.kind === "lead" ? "captacio-lead" : "client", { id: r.kind === "subministrament" ? r.client_id! : r.id })}>{r.kind === "lead" ? "Lead" : r.kind === "client" ? "Client" : "Subministrament"}: {r.name ?? r.id.slice(0, 8)}</button> <Badge tone={r.strength === "fort" ? "red" : "amber"}>{r.by.join(", ")}</Badge></li>)}</ul>
              {d.can.review && l.duplicate_status === "possible_duplicat" && <div className="mt-2 flex gap-1.5"><Button size="sm" onClick={() => void act("dup", () => capApi.act("duplicate", { leadId: l.id, status: "duplicat_confirmat" }), "Marcat com a duplicat")}>És duplicat</Button><Button size="sm" variant="ghost" onClick={() => void act("dup", () => capApi.act("duplicate", { leadId: l.id, status: "revisat_no_duplicat" }), "Revisat: no és duplicat")}>No ho és</Button></div>}
            </section>
          )}
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="text-[13px] font-semibold">Assignació</h3>
            <ul className="mt-2 space-y-1.5">{d.assignments.map((a) => <li key={a.id} className="text-[12px]"><b className="font-medium">{a.user_name ?? "Sense assignar"}</b> <span className="text-muted">· {a.method} · {fdt(a.created_at)}</span>{a.reason && <span className="block text-[11px] text-muted">{a.reason}</span>}</li>)}</ul>
            {d.can.assign && <AssignForm users={d.users} onAssign={async (userId) => { const reason = await ask("Assignació manual", "Motiu (queda a l'historial)"); if (reason) await act("assign", () => capApi.act("assign", { leadId: l.id, userId, reason }), "Lead assignat"); }} />}
          </section>
          {d.attributions.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="text-[13px] font-semibold">Atribució a col·laboradors</h3>
              <ul className="mt-2 space-y-1.5">{d.attributions.map((a) => <li key={a.id} className="text-[12px]"><b className="font-medium">{a.cap_partners?.company || a.cap_partners?.name}</b> <Badge tone={a.status === "vigent" ? "green" : a.status === "en_disputa" ? "amber" : "zinc"}>{a.status}</Badge><span className="block text-[11px] text-muted">{a.source}{a.ref_code ? ` · ${a.ref_code}` : ""} · {fdate(a.created_at)}{a.reason ? ` · ${a.reason}` : ""}</span>
                {d.can.attribution && a.status === "en_disputa" && <span className="mt-1 flex gap-1.5"><Button size="sm" onClick={async () => { const r = await ask("Donar l'atribució a aquest col·laborador", "Motiu (queda auditat)"); if (r) await act("attr", () => capApi.act("attribution", { id: a.id, decision: "vigent", reason: r }), "Atribució actualitzada"); }}>Assigna-li</Button><Button size="sm" variant="ghost" onClick={async () => { const r = await ask("Rebutjar l'atribució", "Motiu (queda auditat)"); if (r) await act("attr", () => capApi.act("attribution", { id: a.id, decision: "rebutjada", reason: r }), "Atribució rebutjada"); }}>Rebutja</Button></span>}
              </li>)}</ul>
            </section>
          )}
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><ShieldCheck size={14} /> Consentiments</h3>
            <ul className="mt-2 space-y-1.5">{d.consents.map((c) => <li key={c.id} className="flex items-start justify-between gap-2 text-[12px]"><span>{CONSENT[c.kind] ?? c.kind}<span className="block text-[10.5px] text-muted">v{c.text_version} · {fdate(c.created_at)}{c.withdrawn_at ? ` · retirat ${fdate(c.withdrawn_at)}` : ""}</span></span>{c.withdrawn_at ? <Badge tone="zinc">Retirat</Badge> : c.granted ? <span className="flex items-center gap-1"><Badge tone="green">Sí</Badge>{d.can.review && c.kind !== "privacitat_servei" && <button className="text-[11px] text-muted underline" onClick={() => void act("cons", () => capApi.act("consent_withdraw", { id: c.id }), "Consentiment retirat")}>Retira</button>}</span> : <Badge tone="zinc">No</Badge>}</li>)}</ul>
          </section>
          <WhatsAppCard d={d} act={act} busy={busy} />
        </aside>
      </div>
      {dialog}
    </div>
  );
}

function AssignForm({ users, onAssign }: { users: { id: string; name: string }[]; onAssign: (id: string) => Promise<void> }) {
  const [u, setU] = useState("");
  return <div className="mt-2 flex gap-1.5"><select className="input h-8 flex-1 text-[12px]" aria-label="Assigna a" value={u} onChange={(e) => setU(e.target.value)}><option value="">Reassigna a…</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><Button size="sm" disabled={!u} onClick={() => void onAssign(u)}>Assigna</Button></div>;
}

function Documents({ d }: { d: D }) {
  const toast = useApp((s) => s.toast);
  if (!d.documents.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-[13px] font-semibold">Documents (emmagatzematge privat)</h3>
      <ul className="mt-2 divide-y divide-line">{d.documents.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]"><FileText size={14} className="text-muted" /><span className="min-w-0 flex-1 truncate">{x.kind === "proposta_preliminar" ? "Proposta preliminar (esborrany) · " : ""}{x.original_name}</span><span className="text-[11px] text-muted">{(x.size_bytes / 1024).toFixed(0)} kB · {fdt(x.created_at)}</span>{x.client_document_id && <Badge tone="green">A la fitxa del client</Badge>}<Button size="sm" variant="ghost" onClick={() => capApi.openDoc(x.id).catch((e) => toast({ title: "No s'ha pogut obrir", body: String(e?.message ?? e), tone: "err" }))}><FileDown size={13} /> Obre</Button></li>)}</ul>
    </section>
  );
}

function ReadingCard({ r, canReview, busy, act }: { r: Reading; canReview: boolean; busy: string | null; act: (k: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => {
    const f = r.fields ?? [];
    return showAll ? f : f.filter((x) => x.value != null || x.status !== "pendent" || /^(cups|accessTariff|days|kwh\.P1|kw\.P1|retailer|holder)$/.test(x.key));
  }, [r.fields, showAll]);
  const dirty = Object.keys(edit).length > 0;
  const save = () => {
    const patch = Object.fromEntries(Object.entries(edit).map(([k, v]) => { const f = r.fields.find((x) => x.key === k)!; const num = f.unit && /kWh|kW|€|dies/.test(f.unit) && !/data/.test(f.unit); return [k, v.trim() === "" ? null : num ? Number(v.replace(",", ".")) : v.trim()]; }));
    void act("review", () => capApi.act("review", { id: r.id, patch }), "Revisió desada").then(() => setEdit({}));
  };
  const stTone = { pendent: "zinc", processant: "blue", llegida: "green", per_revisar: "amber", revisada: "blue", error: "red" } as const;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-[14px] font-semibold">Lectura de la factura</h3><Badge tone={stTone[r.status as keyof typeof stTone] ?? "zinc"}>{r.status === "per_revisar" ? "Dades per revisar" : r.status}</Badge>{r.method && <span className="text-[11px] text-muted">mètode: {r.method === "text" ? "text del PDF" : r.method === "ia" ? "lectura visual amb IA" : r.method === "mixt" ? "text + IA" : r.method}</span>}<span className="ml-auto text-[11px] text-muted">{fdt(r.updated_at)}</span></div>
      {r.status === "error" && <Notice tone="red">No s&apos;ha pogut llegir ({r.error}). El lead i la factura estan desats; es reintentarà automàticament ({r.attempts} intents) o pots introduir les dades a mà.</Notice>}
      {r.warnings?.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11.5px] text-amber-700">{r.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {r.missing?.length > 0 && <p className="mt-1 text-[12px] text-muted">Falten per comparar: <b>{r.missing.join(", ")}</b></p>}
      <div className="mt-3 overflow-x-auto"><table className="w-full text-[12.5px]"><thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="py-1.5 pr-2 font-medium">Dada</th><th className="pr-2 font-medium">Valor</th><th className="pr-2 font-medium">Unitat</th><th className="pr-2 font-medium">Pàg.</th><th className="pr-2 font-medium">Estat</th></tr></thead>
        <tbody className="divide-y divide-line">{groups.map((f) => (
          <tr key={f.key} className={cn(f.status === "per_revisar" && "bg-amber-500/[0.05]")}>
            <td className="py-1.5 pr-2">{f.label}{f.note && <span className="block text-[10.5px] text-amber-700">{f.note}</span>}</td>
            <td className="pr-2">{canReview ? <input className="input h-7 w-full min-w-[120px] py-0 text-[12.5px]" aria-label={f.label} value={edit[f.key] ?? (f.value == null ? "" : String(f.value))} placeholder="Pendent" onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} /> : (f.value ?? <span className="text-muted">Pendent</span>)}</td>
            <td className="pr-2 text-[11px] text-muted">{f.unit ?? ""}</td><td className="pr-2 text-[11px] text-muted">{f.page ?? "—"}</td>
            <td className="pr-2"><Badge tone={ST[f.status]?.t ?? "zinc"}>{ST[f.status]?.l ?? f.status}</Badge></td>
          </tr>
        ))}</tbody></table></div>
      <div className="mt-2 flex flex-wrap items-center gap-2"><button className="text-[12px] text-muted underline" onClick={() => setShowAll(!showAll)}>{showAll ? "Mostra només les dades rellevants" : "Mostra tots els camps"}</button>{canReview && <Button size="sm" variant="primary" className="ml-auto" disabled={!!busy} onClick={dirty ? save : () => void act("review", () => capApi.act("review", { id: r.id, patch: Object.fromEntries(r.fields.filter((f) => f.status === "per_revisar").map((f) => [f.key, f.value])) }), "Dades confirmades")}>{busy === "review" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {dirty ? "Desa la revisió" : "Confirma les dades"}</Button>}</div>
      <p className="mt-1 text-[11px] text-muted">Imports «amb impostos» i «sense impostos» es mostren per separat. Res que no surti a la factura s&apos;omple: queda pendent.</p>
    </section>
  );
}

function Preliminary({ r, canReview, busy, act }: { r: Reading; canReview: boolean; busy: string | null; act: (k: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const p = r.preliminary!;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2"><h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><Sparkles size={15} className="text-brand" /> Comparativa preliminar</h3><span className="text-[11px] text-muted">Tarifes vigents · {p.evaluated} calculades</span>{canReview && p.ok && <Button size="sm" variant="primary" className="ml-auto" disabled={!!busy} onClick={() => void act("pre", () => capApi.act("preliminary", { id: r.id }), "Proposta preliminar desada com a esborrany (no s'ha enviat)")}>{busy === "pre" ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} Genera la proposta (PDF esborrany)</Button>}</div>
      {!p.ok ? <p className="mt-2 text-[12.5px] text-muted">{p.reason}</p> : <>
        {p.doubtful?.length > 0 && r.status !== "revisada" && <Notice tone="amber">Abans de preparar una oferta, revisa: {p.doubtful.join(", ")}.</Notice>}
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-dashed border-line p-3"><p className="text-[10.5px] uppercase tracking-wide text-muted">Actual (anualitzat)</p><p className="mt-1 text-[18px] font-semibold tnum">{p.current.known ? eur(p.current.annualCost, 0) : "—"}</p>{!p.current.known && <p className="text-[11px] text-amber-700">{PENDING_PRICE}</p>}</div>
          {p.alternatives.map((a) => <div key={a.offerId} className={cn("rounded-xl border p-3", a.rank === 1 ? "border-brand/50 bg-brand/[0.04]" : "border-line")}><p className="text-[10.5px] uppercase tracking-wide text-muted">Opció {a.rank}</p><p className="truncate text-[13px] font-semibold">{a.supplier}</p><p className="truncate text-[11px] text-muted">{a.product}</p><p className="mt-1 text-[17px] font-semibold tnum">{eur(a.annualCost, 0)}</p><p className={cn("text-[11.5px]", a.saving != null && a.saving > 0 ? "text-ren" : "text-muted")}>{a.saving != null ? `${a.saving > 0 ? "Estalvi estimat" : "Sense estalvi"} ${eur(Math.abs(a.saving), 0)}` : PENDING_PRICE}</p><p className="mt-1 text-[10.5px] text-muted">Vàlida fins al {fdate(a.validTo)}</p></div>)}
        </div>
        <details className="mt-2 text-[12px]"><summary className="cursor-pointer font-medium">Hipòtesis i limitacions</summary><ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{p.hypotheses.map((h, i) => <li key={i}>{h}</li>)}</ul></details>
      </>}
    </section>
  );
}

function WhatsAppCard({ d, act, busy }: { d: D; act: (k: string, fn: () => Promise<unknown>, ok: string) => Promise<void>; busy: string | null }) {
  const [text, setText] = useState("");
  const [tpl, setTpl] = useState("");
  const consent = d.consents.some((c) => c.kind === "whatsapp" && c.granted && !c.withdrawn_at);
  const phone = (d.lead.phone ?? "").replace(/\D/g, "");
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><MessageCircle size={14} className="text-[#25D366]" /> WhatsApp</h3>
      {!consent && <p className="mt-1 text-[11.5px] text-muted">Sense consentiment de WhatsApp: només es pot respondre si la persona ha escrit primer.</p>}
      <ul className="mt-2 max-h-56 space-y-1.5 overflow-auto">{d.whatsapp.map((m) => <li key={m.id} className={cn("rounded-xl px-2.5 py-1.5 text-[12px]", m.direction === "entrant" ? "bg-elevated" : "bg-green-500/[0.08]")}><p className="whitespace-pre-wrap">{m.body}</p><p className="mt-0.5 text-[10.5px] text-muted">{fdt(m.created_at)} · {WA[m.status] ?? m.status}{m.error ? ` · ${m.error}` : ""}</p></li>)}{!d.whatsapp.length && <li className="text-[12px] text-muted">Cap missatge.</li>}</ul>
      {d.can.whatsapp && (d.can.waConfigured ? (
        <div className="mt-2 space-y-1.5">
          <input className="input h-8 text-[12px]" placeholder="Plantilla aprovada (nom)" value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Plantilla aprovada" />
          <textarea className="input min-h-[60px] py-1.5 text-[12px]" placeholder="Text lliure (només dins les 24 h després del seu missatge)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Text del missatge" />
          <Button size="sm" disabled={!!busy || (!tpl && !text.trim())} onClick={() => void act("wa", () => capApi.act("wa_send", { data: { leadId: d.lead.id, template: tpl || undefined, text: text.trim() || undefined } }), "Missatge acceptat per Meta (el lliurament es confirmarà pel webhook)").then(() => { setText(""); })}><Send size={13} /> Envia</Button>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5"><p className="text-[11.5px] text-muted">WhatsApp Business no està configurat (pendent de credencials).</p>{phone && <a className="inline-flex items-center gap-1 text-[12.5px] text-brand hover:underline" href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer"><Copy size={12} /> Obre wa.me (es registra a mà)</a>}</div>
      ))}
      <p className="mt-2 flex items-center gap-1 text-[10.5px] text-muted"><BadgeCheck size={11} /> «Lliurat» només quan Meta ho confirma pel webhook.</p>
    </section>
  );
}
