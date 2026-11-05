"use client";
/** Col·laboradors: alta (Direcció), enllaços i QR, estat i atribucions en disputa. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, FileUp, History, Link2, Loader2, Pencil, Percent, Plus, Search, ShieldAlert, SlidersHorizontal, UserPlus } from "lucide-react";
import { DEFAULT_LEVELS, LEVEL_KEYS, type LevelKey } from "@/core/collaborators";
import { crmApi } from "../crm/api";
import { ExportButton } from "../../components/ExportButton";
import { AssignPctModal, CommissionPanel, ImportPartnersModal, ImportsModal, LevelsModal, levelName, type Overview } from "./PartnerTools";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Field, Modal, Notice, cn } from "../../components/ui";
import { capApi, fdate } from "./api";
import { useAsk } from "./Ask";
import { AccessLinkDialog, type AccessLinkInfo } from "../../components/AccessLinkDialog";

type Link = { id: string; code: string; label: string | null; channel: string; active: boolean; url: string; created_at: string };
type Partner = { id: string; name: string; company: string | null; public_name: string | null; kind: string; email: string | null; phone: string | null; city: string | null; province: string | null; status: string; user_id: string | null; created_at: string; links: Link[]; stats: { leads: number; converted: number };
  notes?: string | null; tax_id?: string | null; person_kind?: string | null; address?: string | null; postal_code?: string | null; source_label?: string | null; classification?: string; manager_id?: string | null; import_id?: string | null };
type Dispute = { id: string; lead_id: string; partner_id: string; status: string; reason: string | null; created_at: string; crm_leads: { name: string } | null };
type Res = { partners: Partner[]; disputes: Dispute[]; kinds: Record<string, string>; canEdit: boolean };

export function PartnersTab() {
  const [d, setD] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [imp, setImp] = useState<"" | "file" | "list">("");
  const toast = useApp((s) => s.toast);
  const go = useApp((s) => s.navigate);
  const { ask, dialog } = useAsk();
  const load = useCallback(async () => { try { setD(await capApi.get<Res>("partners")); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast({ title: ok, tone: "ok" }); await load(); } catch (e) { toast({ title: "No s'ha pogut completar", body: e instanceof Error ? e.message : String(e), tone: "err" }); } };
  if (err) return <Notice tone="red">{err}</Notice>;
  if (!d) return <div className="h-60 animate-pulse rounded-2xl bg-elevated" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2"><p className="text-[13px] text-muted">{d.partners.length} col·laboradors · fitxa, enllaços i QR, accés al portal i percentatge de comissió.</p>{d.canEdit && <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setImp("file")}><FileUp size={14} /> Importar col·laboradors</Button><Button size="sm" variant="ghost" onClick={() => setImp("list")}><History size={14} /> Importacions</Button><Button variant="primary" size="sm" onClick={() => setCreate(true)}><UserPlus size={14} /> Nou col·laborador</Button></div>}</div>
      {d.disputes.length > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-4">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold"><ShieldAlert size={15} className="text-amber-600" /> Atribucions en disputa ({d.disputes.length})</h3>
          <p className="text-[12px] text-muted">La mateixa persona l&apos;han aportat dos col·laboradors. Només Direcció ho decideix (queda auditat).</p>
          <ul className="mt-2 divide-y divide-line">{d.disputes.map((x) => {
            const p = d.partners.find((q) => q.id === x.partner_id);
            return <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]"><button className="font-medium hover:text-brand" onClick={() => go("captacio-lead", { id: x.lead_id })}>{x.crm_leads?.name ?? "Lead"}</button><span className="text-muted">· aportat per {p?.company || p?.name} el {fdate(x.created_at)}</span>{d.canEdit && <span className="ml-auto flex gap-1.5"><Button size="sm" onClick={async () => { const r = await ask("Donar-li l'atribució", "Motiu (queda auditat)"); if (r) void act(() => capApi.act("attribution", { id: x.id, decision: "vigent", reason: r }), "Atribució actualitzada"); }}>Assigna-li</Button><Button size="sm" variant="ghost" onClick={async () => { const r = await ask("Rebutjar l'atribució", "Motiu (queda auditat)"); if (r) void act(() => capApi.act("attribution", { id: x.id, decision: "rebutjada", reason: r }), "Atribució rebutjada"); }}>Rebutja</Button></span>}</li>;
          })}</ul>
        </section>
      )}
      {!d.partners.length ? <Empty icon={<UserPlus size={22} />} title="Encara no hi ha col·laboradors" body="Dona d'alta electricistes, instal·ladors, immobiliàries, administradors de finques, gestories o corredories, o importa'ls des d'Excel." /> : (
        <PartnerList d={d} act={act} ask={ask} reload={load} />
      )}
      {dialog}
      <ImportPartnersModal open={imp === "file"} onClose={() => setImp("")} onDone={() => { setImp(""); void load(); }} />
      <ImportsModal open={imp === "list"} onClose={() => setImp("")} onDone={() => void load()} />
      {create && <CreatePartner kinds={d.kinds} onClose={() => setCreate(false)} onSaved={() => { setCreate(false); void load(); }} />}
    </div>
  );
}

const CLASS_LABEL: Record<string, string> = { collaborador: "Col·laborador", pendent_classificacio: "Pendent de classificar", descartat: "Descartat" };
type Bulk = "" | LevelKey | "personalitzat" | "habilitar" | "activar" | "desactivar" | "classificar_collaborador" | "descartar";

function PartnerList({ d, act, ask, reload }: { d: Res; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; ask: ReturnType<typeof useAsk>["ask"]; reload: () => Promise<void> }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [q, setQ] = useState("");
  const [fClass, setFClass] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessLinkInfo | null>(null);
  const [bulk, setBulk] = useState<Bulk>("");
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [edit, setEdit] = useState<Partner | null>(null);
  const loadOv = useCallback(() => { capApi.get<Overview>("collab_overview").then(setOv).catch(() => setOv(null)); }, []);
  useEffect(() => { loadOv(); }, [loadOv]);
  const levels = ov?.levels ?? DEFAULT_LEVELS;
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const rows = useMemo(() => d.partners.filter((p) => (!fClass || (p.classification ?? "collaborador") === fClass) && (!q || norm([p.name, p.company, p.email, p.tax_id, p.city, p.phone].filter(Boolean).join(" ")).includes(norm(q)))), [d.partners, q, fClass]);
  const selRows = d.partners.filter((p) => sel.has(p.id));
  const enabledSel = selRows.filter((p) => p.user_id);
  const allSel = rows.length > 0 && rows.every((p) => sel.has(p.id));
  const pct = (p: Partner) => (p.user_id && ov?.allowed ? ov.rows[p.user_id] : undefined);
  const refresh = () => { setBulk(""); setSel(new Set()); void reload(); loadOv(); };
  const runSimple = async (action: Exclude<Bulk, "" | LevelKey | "personalitzat">) => {
    if (action === "habilitar") return act(() => capApi.act("collab_enable", { data: { partnerIds: selRows.map((p) => p.id) } }).then((r) => { const x = r as unknown as { enabled: number; skipped: { name: string; reason: string }[] }; if (x.skipped.length) useApp.getState().toast({ title: `${x.enabled} habilitats`, body: `No habilitats: ${x.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`, tone: "info" }); }), "Habilitats per a comissions (compte bloquejat)").then(refresh);
    return act(() => capApi.act("collab_bulk", { data: { partnerIds: selRows.map((p) => p.id), action } }), "Canvis aplicats").then(refresh);
  };
  const BULK_LABEL: Record<string, string> = { habilitar: "Habilitar per a comissions", activar: "Activar", desactivar: "Desactivar", classificar_collaborador: "Classificar com a col·laborador", descartar: "Descartar" };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-muted" /><input className="input h-9 w-64 pl-8 text-[12.5px]" placeholder="Nom, DNI, correu, telèfon o població" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input h-9 w-auto text-[12.5px]" aria-label="Classificació" value={fClass} onChange={(e) => setFClass(e.target.value)}><option value="">Totes les classificacions</option><option value="collaborador">Col·laboradors</option><option value="pendent_classificacio">Pendents de classificar</option><option value="descartat">Descartats</option></select>
        {ov?.allowed && <span className="text-[12px] text-muted">Nivells: {LEVEL_KEYS.map((k) => `${levels[k].label} ${levels[k].pct} %`).join(" · ")}</span>}
        {ov?.allowed && d.canEdit && <Button size="sm" variant="ghost" onClick={() => setLevelsOpen(true)}><SlidersHorizontal size={13} /> Nivells</Button>}
        {d.canEdit && <span className="ml-auto"><ExportButton set="collaboradors" visible={rows.map((p) => p.id)} /></span>}
      </div>
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ren/30 bg-ren/5 p-2 text-[12.5px]">
          <b>{sel.size} seleccionats</b>{selRows.length !== enabledSel.length && <span className="text-muted">({selRows.length - enabledSel.length} sense habilitar per a comissions)</span>}
          {ov?.canManage && <>{LEVEL_KEYS.map((k) => <Button key={k} size="sm" disabled={!enabledSel.length} onClick={() => setBulk(k)}><Percent size={12} /> {levels[k].pct} %</Button>)}<Button size="sm" disabled={!enabledSel.length} onClick={() => setBulk("personalitzat")}>Personalitzat</Button></>}
          {d.canEdit && <>
            <Button size="sm" variant="ghost" onClick={() => setBulk("habilitar")}>Habilitar</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulk("activar")}>Activar</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulk("desactivar")}>Desactivar</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulk("classificar_collaborador")}>Classificar</Button>
            <ExportButton set="collaboradors" ids={[...sel]} />
          </>}
          <button className="ml-auto text-muted underline" onClick={() => setSel(new Set())}>Treu la selecció</button>
        </div>
      )}
      <div className="overflow-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr>
            <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Selecciona tots" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((p) => p.id)))} /></th>
            <th>Nom</th><th className="hidden md:table-cell">DNI/CIF</th><th className="hidden lg:table-cell">Contacte</th><th>Classificació</th><th>Estat</th>{ov?.allowed && <th className="text-right">% comissió</th>}<th className="hidden text-right sm:table-cell">Leads</th>
          </tr></thead>
          <tbody>{rows.map((p) => { const c = pct(p); return (
            <tr key={p.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.02]" onClick={() => setOpen(p.id)}>
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Selecciona ${p.name}`} checked={sel.has(p.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} /></td>
              <td className="font-medium">{p.company || p.name}<div className="text-[11px] font-normal text-muted">{p.company ? `${p.name} · ` : ""}{p.person_kind === "juridica" ? "Empresa" : p.person_kind === "fisica" ? "Persona física" : d.kinds[p.kind] ?? p.kind}{p.city ? ` · ${p.city}` : ""}{p.source_label ? ` · origen: ${p.source_label}` : ""}</div></td>
              <td className="hidden font-mono md:table-cell">{p.tax_id ?? "—"}</td>
              <td className="hidden max-w-[220px] truncate lg:table-cell">{p.email ?? "—"}{p.phone ? <div className="text-[11px] text-muted">{p.phone}</div> : null}</td>
              <td><Badge tone={(p.classification ?? "collaborador") === "collaborador" ? "green" : p.classification === "descartat" ? "zinc" : "amber"}>{CLASS_LABEL[p.classification ?? "collaborador"]}</Badge></td>
              <td><Badge tone={p.status === "actiu" ? "green" : p.status === "suspes" ? "amber" : "zinc"}>{p.status}</Badge>{!p.user_id && <div className="text-[11px] text-muted">Sense habilitar</div>}</td>
              {ov?.allowed && <td className="text-right tabular-nums">{c?.pct ? <><b>{Number(c.pct).toLocaleString("ca-ES")} %</b>{c.status === "pendent_aprovacio" && <span className="ml-1 text-amber-600" title="Pendent d'aprovació">●</span>}{c.exceptions ? <div className="text-[11px] text-muted">+{c.exceptions} excepcions</div> : null}</> : <span className="text-muted">—</span>}</td>}
              <td className="hidden text-right tabular-nums sm:table-cell">{p.stats.leads}</td>
            </tr>
          ); })}</tbody>
        </table>
      </div>
      {open && (() => { const p = d.partners.find((x) => x.id === open); if (!p) return null; return (
        <Modal open onClose={() => setOpen(null)} width="max-w-3xl" title={p.company || p.name}>
          <div className="space-y-4">
            {d.canEdit && <div className="-mt-1 flex justify-end"><Button size="sm" onClick={() => setEdit(p)}><Pencil size={13} /> Edita les dades</Button></div>}
            <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
              <div><span className="text-muted">DNI/CIF:</span> <span className="font-mono">{p.tax_id ?? "—"}</span></div><div><span className="text-muted">Correu:</span> {p.email ?? "—"}</div>
              <div><span className="text-muted">Telèfon:</span> {p.phone ?? "—"}</div><div><span className="text-muted">Adreça:</span> {[p.address, p.postal_code, p.city, p.province].filter(Boolean).join(", ") || "—"}</div>
              <div><span className="text-muted">Classificació:</span> {CLASS_LABEL[p.classification ?? "collaborador"]}{p.source_label ? ` (etiqueta d'origen «${p.source_label}»)` : ""}</div>
              <div><span className="text-muted">Responsable:</span> <ManagerSelect partnerId={p.id} value={p.manager_id ?? null} canEdit={d.canEdit} onSaved={() => void reload()} /></div>
            </div>
            {p.classification === "pendent_classificacio" && d.canEdit && <Notice tone="amber">Pendent de classificar: no té cap rol ni permís. <button className="underline" onClick={() => void act(() => capApi.act("collab_bulk", { data: { partnerIds: [p.id], action: "classificar_collaborador" } }), "Classificat com a col·laborador").then(refresh)}>Classificar com a col·laborador</button> · <button className="underline" onClick={() => void act(() => capApi.act("collab_bulk", { data: { partnerIds: [p.id], action: "descartar" } }), "Descartat").then(refresh)}>Descartar</button></Notice>}
            <section><h3 className="mb-2 text-[13px] font-semibold">Comissió</h3>{ov?.allowed ? <CommissionPanel partnerId={p.id} isAdmin={d.canEdit} onChanged={() => { void reload(); loadOv(); }} /> : <p className="text-[12.5px] text-muted">Les condicions econòmiques només les veuen Direcció i l&apos;Administració autoritzada.</p>}</section>
            {p.user_id && d.canEdit && <section className="text-[12.5px]"><h3 className="mb-1 text-[13px] font-semibold">Accés al portal</h3><p className="text-muted">Donar-li accés desbloqueja el compte i li envia, des del correu d&apos;Assessoria 3.0, un enllaç per crear la contrasenya. També podràs copiar l&apos;enllaç per enviar-l&apos;hi des del teu correu. Si l&apos;enllaç caduca, torna a prémer el botó.</p><Button size="sm" className="mt-1" onClick={async () => { if (!confirm(`Donar accés al portal a ${p.name} (${p.email})?`)) return; await act(async () => { const r = await capApi.act<{ link: string | null; emailSent: boolean; emailError: string | null }>("collab_portal", { id: p.id }); setAccess({ email: p.email ?? "", ...r }); }, "Accés donat"); }}>Donar accés al portal</Button></section>}
            <section><h3 className="mb-2 text-[13px] font-semibold">Enllaços i QR</h3><PartnerCard p={p} kinds={d.kinds} canEdit={d.canEdit} act={act} ask={ask} /></section>
          </div>
        </Modal>
      ); })()}
      {(bulk === "n1" || bulk === "n2" || bulk === "n3" || bulk === "personalitzat") && <AssignPctModal open onClose={() => setBulk("")} userIds={enabledSel.map((p) => p.user_id!)} names={enabledSel.map((p) => p.company || p.name)} levels={levels} preset={bulk} onDone={() => { refresh(); loadOv(); }} />}
      {bulk && !["n1", "n2", "n3", "personalitzat"].includes(bulk) && (
        <Modal open onClose={() => setBulk("")} title={BULK_LABEL[bulk]} footer={<><Button onClick={() => setBulk("")}>Cancel·la</Button><Button variant="primary" onClick={() => void runSimple(bulk as Exclude<Bulk, "" | LevelKey | "personalitzat">)}>Confirma ({selRows.length})</Button></>}>
          <div className="space-y-2 text-[12.5px]">
            <p>Afectats: <b>{selRows.length}</b> col·laboradors.</p>
            <ul className="max-h-40 overflow-auto text-muted">{selRows.map((p) => <li key={p.id}>{p.company || p.name}</li>)}</ul>
            {bulk === "habilitar" && <Notice tone="blue">Es crea el compte de cadascun <b>bloquejat</b> (sense contrasenya, sense invitació i sense poder entrar). Només s&apos;habiliten els classificats com a col·laboradors, amb correu i que no siguin ja usuaris del CRM.</Notice>}
            {bulk === "desactivar" && <p className="text-muted">No s&apos;esborra res: les comissions i l&apos;historial es conserven.</p>}
          </div>
        </Modal>
      )}
      <AccessLinkDialog info={access} onClose={() => setAccess(null)} />
      {edit && <EditPartnerModal p={edit} kinds={d.kinds} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
      {ov?.allowed && <LevelsModal open={levelsOpen} onClose={() => setLevelsOpen(false)} levels={levels} onDone={() => { setLevelsOpen(false); loadOv(); }} />}
      {ov?.allowed && <p className="text-[11.5px] text-muted">El percentatge s&apos;aplica sobre la comissió que cobra Assessoria 3.0 de cada contracte. {levelName(levels, "n1")} per defecte per als nous; es pot canviar individualment o en bloc.</p>}
    </div>
  );
}

function EditPartnerModal({ p, kinds, onClose, onSaved }: { p: Partner; kinds: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const toast = useApp((s) => s.toast);
  const [f, setF] = useState({ name: p.name ?? "", company: p.company ?? "", public_name: p.public_name ?? "", kind: p.kind ?? "altres", tax_id: p.tax_id ?? "", email: p.email ?? "", phone: p.phone ?? "", address: p.address ?? "", postal_code: p.postal_code ?? "", city: p.city ?? "", province: p.province ?? "", notes: p.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await capApi.act<{ changed: string[]; warning: string | null }>("collab_edit", { id: p.id, data: f });
      toast({ title: r.changed.length ? "Dades desades" : "No hi havia cap canvi", body: r.warning ?? undefined, tone: r.warning ? "info" : "ok" });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const t = (k: keyof typeof f, label: string, hint?: string) => <Field label={label} hint={hint}><input className="input h-9" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={`Editar · ${p.company || p.name}`} footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || f.name.trim().length < 2} onClick={() => void save()}>{busy && <Loader2 size={13} className="animate-spin" />} Desa</Button></>}>
      <div className="space-y-3">
        {err && <Notice tone="red">{err}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          {t("name", "Nom i cognoms")}{t("company", "Empresa (opcional)")}
          {t("tax_id", "DNI/CIF", "Es comprova la lletra de control i que no el tingui un altre col·laborador")}
          <Field label="Tipus"><select className="input h-9" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {t("email", "Correu", p.user_id ? "Si el canvies, el correu d'inici de sessió del compte no canvia" : undefined)}{t("phone", "Telèfon")}
          {t("address", "Adreça")}{t("postal_code", "Codi postal")}{t("city", "Població")}{t("province", "Província")}
          {t("public_name", "Nom a la seva landing (opcional)")}
        </div>
        <Field label="Notes"><textarea className="input" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p className="text-[11.5px] text-muted">Només Direcció pot editar aquestes dades. Queda registrat qui ha canviat quins camps.</p>
      </div>
    </Modal>
  );
}

function ManagerSelect({ partnerId, value, canEdit, onSaved }: { partnerId: string; value: string | null; canEdit: boolean; onSaved: () => void }) {
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const toast = useApp((s) => s.toast);
  useEffect(() => { if (canEdit) crmApi.facets().then((f) => setUsers(f.users.filter((x) => ["admin", "cap_administrativa", "cap_equip", "comercial"].includes(x.role)))).catch(() => undefined); }, [canEdit]);
  if (!canEdit) return <span>{value ? "Assignat" : "—"}</span>;
  return (
    <select className="input h-8 w-auto text-[12px]" value={value ?? ""} onChange={async (e) => { try { await capApi.act("collab_manager", { data: { partnerIds: [partnerId], managerId: e.target.value || null } }); toast({ title: "Responsable desat", tone: "ok" }); onSaved(); } catch (err) { toast({ title: "No s'ha pogut desar", body: err instanceof Error ? err.message : String(err), tone: "err" }); } }}>
      <option value="">Sense responsable</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );
}

function PartnerCard({ p, kinds, canEdit, act, ask }: { p: Partner; kinds: Record<string, string>; canEdit: boolean; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; ask: ReturnType<typeof useAsk>["ask"] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const abs = (u: string) => (u.startsWith("http") ? u : `${location.origin}${u}`);
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="truncate text-[14px] font-semibold">{p.company || p.name}</p><p className="text-[12px] text-muted">{kinds[p.kind] ?? p.kind}{p.company ? ` · ${p.name}` : ""}{p.city ? ` · ${p.city}` : ""}</p></div>
        <div className="flex shrink-0 items-center gap-1.5">{p.user_id ? <Badge tone="blue">Accés al portal</Badge> : <Badge tone="zinc">Sense accés</Badge>}<Badge tone={p.status === "actiu" ? "green" : p.status === "suspes" ? "amber" : "zinc"}>{p.status}</Badge></div>
      </div>
      <p className="mt-2 text-[12px] text-muted">{p.stats.leads} leads aportats · {p.stats.converted} convertits en client{p.public_name ? ` · nom a la landing: «${p.public_name}»` : ""}</p>
      <ul className="mt-3 space-y-2">{p.links.map((l) => (
        <li key={l.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-line px-2.5 py-2 text-[12px]", !l.active && "opacity-50")}>
          <Link2 size={13} className="text-brand" /><span className="font-mono font-medium">{l.code}</span><span className="text-muted">{l.label ?? ""}{l.channel === "qr" ? " · QR" : ""}</span>
          <span className="ml-auto flex items-center gap-1">
            <button className="rounded px-1.5 py-0.5 hover:bg-ink/5" aria-label={`Copia l'enllaç ${l.code}`} onClick={async () => { await navigator.clipboard.writeText(abs(l.url)).catch(() => undefined); setCopied(l.id); setTimeout(() => setCopied(null), 1500); }}>{copied === l.id ? <Check size={13} /> : <Copy size={13} />}</button>
            <a className="rounded px-1.5 py-0.5 hover:bg-ink/5" aria-label={`QR ${l.code}`} href={`/api/capture/qr?code=${l.code}&format=png`}><Download size={13} /></a>
            {canEdit && <button className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-ink/5" onClick={() => void act(() => capApi.act("link_toggle", { id: l.id, active: !l.active }), l.active ? "Enllaç desactivat" : "Enllaç activat")}>{l.active ? "Desactiva" : "Activa"}</button>}
          </span>
        </li>
      ))}</ul>
      {canEdit && <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={async () => { const label = await ask("Nou enllaç de referència", "Nom de l'enllaç (p. ex. «Botiga» o «Flyer QR»)"); if (label) void act(() => capApi.act("link_add", { partnerId: p.id, label, channel: /qr/i.test(label) ? "qr" : "recomanacio" }), "Enllaç creat"); }}><Plus size={13} /> Enllaç</Button>
        {p.status === "actiu" ? <Button size="sm" variant="ghost" onClick={() => void act(() => capApi.act("partner_update", { id: p.id, data: { status: "suspes" } }), "Col·laborador suspès")}>Suspèn</Button> : <Button size="sm" variant="ghost" onClick={() => void act(() => capApi.act("partner_update", { id: p.id, data: { status: "actiu" } }), "Col·laborador activat")}>Activa</Button>}
      </div>}
    </section>
  );
}

function CreatePartner({ kinds, onClose, onSaved }: { kinds: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const toast = useApp((s) => s.toast);
  const [f, setF] = useState({ name: "", company: "", public_name: "", kind: "electricista", email: "", phone: "", city: "", province: "", tax_id: "", legal_name: "", code: "", invite: true });
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<AccessLinkInfo | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      const r = await capApi.act<{ code: string; invited: boolean; link: string | null; emailSent: boolean; emailError: string | null }>("partner_create", { data: { ...f, code: f.code || null, company: f.company || null, public_name: f.public_name || null, email: f.email || null } });
      toast({ title: "Col·laborador creat", body: `Codi ${r.code}${r.invited ? (r.emailSent ? " · enllaç d'accés enviat al seu correu" : " · copia l'enllaç d'accés per enviar-l'hi") : ""}`, tone: "ok" });
      if (r.invited && r.link) setAccess({ email: f.email, link: r.link, emailSent: r.emailSent, emailError: r.emailError }); else onSaved();
    } catch (e) { toast({ title: "No s'ha pogut crear", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
    finally { setBusy(false); }
  };
  if (access) return <AccessLinkDialog info={access} onClose={() => { setAccess(null); onSaved(); }} />;
  const t = (k: keyof typeof f, label: string, hint?: string) => <Field label={label} hint={hint}><input className="input h-9" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <Modal open onClose={onClose} title="Nou col·laborador" width="max-w-2xl" footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || f.name.trim().length < 2 || (f.invite && !f.email)} onClick={save}>{busy && <Loader2 size={13} className="animate-spin" />} Crea</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {t("name", "Nom de la persona de contacte")}{t("company", "Empresa (opcional)")}
        <Field label="Tipus"><select className="input h-9" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {t("public_name", "Nom a la seva landing (opcional)", "Si està buit, la landing no mostra cap nom")}
        {t("email", "Correu")}{t("phone", "Telèfon")}{t("city", "Població")}{t("province", "Província")}
        {t("legal_name", "Raó social (liquidacions)")}{t("tax_id", "NIF/CIF (liquidacions)")}
        {t("code", "Codi de referència (opcional)", "4-16 lletres o xifres; si està buit, es genera")}
        <label className="flex items-center gap-2 self-end text-[12.5px]"><input type="checkbox" checked={f.invite} onChange={(e) => setF({ ...f, invite: e.target.checked })} /> Donar accés al portal (envia l&apos;enllaç per crear la contrasenya)</label>
      </div>
      <p className="mt-3 text-[11.5px] text-muted">Les condicions econòmiques del col·laborador es configuren a Control econòmic → Regles (capa col·laborador).</p>
    </Modal>
  );
}
