"use client";
/**
 * Col·laboradors · eines afegides a la pantalla existent: importació (amb previsualització i desfer),
 * nivells de comissió, accions massives i fitxa de comissions (percentatge general, excepcions i històric).
 * Els percentatges són regles del motor de comissions existent (capa col·laborador, % sobre la comissió rebuda).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { CheckCircle2, History, Loader2, Lock, Plus, Undo2, X } from "lucide-react";
import { DEFAULT_LEVELS, LEVEL_KEYS, rowsFromGrid, splitCommission, validPct, type LevelKey, type Levels } from "@/core/collaborators";
import { useApp } from "@/data/store";
import { Badge, Button, Field, Modal, Notice, cn } from "../../components/ui";
import { capApi, eur, fdate } from "./api";

const toast = (title: string, body?: string, tone: "ok" | "err" | "info" = "ok") => useApp.getState().toast({ title, body, tone });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const today = () => new Date().toISOString().slice(0, 10);
export const levelName = (lv: Levels, k: string) => (k in lv ? `${lv[k as LevelKey].label} (${lv[k as LevelKey].pct} %)` : "Personalitzat");

export type Overview = { allowed: boolean; rows: Record<string, { pct?: string; level?: string; validFrom?: string; status?: string; next?: { pct: string; validFrom: string; status: string } | null; exceptions: number }>; levels: Levels; canManage: boolean; canApprove: boolean };

/* ======================================================================= importació */

type PreviewItem = { row: { index: number; fullName: string; taxId: string | null; taxIdValid: boolean; personKind: string | null; email: string | null; phone: string | null; city: string | null; label: string | null; classification: string; warnings: string[]; errors: string[] }; proposal: { action: Action; target: string | null; matches: { kind: string; id: string; name: string }[]; reason: string } };
type Action = "crear" | "actualitzar" | "ignorar" | "revisar";
type Preview = { items: PreviewItem[]; summary: { total: number; collaborators: number; pending: number; crear: number; actualitzar: number; revisar: number; ignorar: number; withoutRepresentative: number }; unknownColumns: string[]; alreadyImported: { file_name: string; created_at: string } | null };
const ACTION_LABEL: Record<Action, string> = { crear: "Crear", actualitzar: "Completar l'existent", ignorar: "Ignorar", revisar: "Deixar per revisar" };

export function ImportPartnersModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null);
  const [p, setP] = useState<Preview | null>(null);
  const [dec, setDec] = useState<Record<number, Action>>({});
  const [enable, setEnable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ created: number; updated: number; skipped: number; pending: number; enabled: { enabled: number; skipped: { name: string; reason: string }[] } | null } | null>(null);
  useEffect(() => { if (open) { setFile(null); setP(null); setDec({}); setRes(null); setErr(null); setEnable(false); } }, [open]);
  const read = async (f: File) => {
    setErr(null); setP(null);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      // la fila de capçaleres pot no ser la primera (files buides o títols a dalt): es busca a totes les pestanyes
      let rows: Record<string, unknown>[] = [];
      for (const name of wb.SheetNames) {
        const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: true, blankrows: true });
        const g = rowsFromGrid(grid);
        if (g.rows.length) { rows = g.rows; break; }
      }
      if (!rows.length) throw new Error("No s'ha trobat cap fila de capçaleres amb el nom i el correu (p. ex. «Nombre» i «Email») a les primeres 20 files.");
      setFile({ name: f.name, rows });
      setBusy(true);
      const pr = await capApi.act<Preview>("collab_preview", { data: { fileName: f.name, rows } });
      setP(pr); setDec(Object.fromEntries(pr.items.map((i) => [i.row.index, i.proposal.action])));
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!file || !p) return;
    setBusy(true); setErr(null);
    try {
      const r = await capApi.act<NonNullable<typeof res>>("collab_import", { data: { fileName: file.name, rows: file.rows, decisions: Object.entries(dec).map(([index, action]) => ({ index: Number(index), action })), enable } });
      setRes(r); toast("Importació feta", `${r.created} creats · ${r.updated} completats · ${r.skipped} omesos`);
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const counts = useMemo(() => { const c: Record<Action, number> = { crear: 0, actualitzar: 0, ignorar: 0, revisar: 0 }; for (const v of Object.values(dec)) c[v]++; return c; }, [dec]);
  return (
    <Modal open={open} onClose={res ? onDone : onClose} width="max-w-5xl" title="Importar col·laboradors"
      footer={res ? <Button variant="primary" onClick={onDone}>Fet</Button> : <><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!p || busy || counts.crear + counts.actualitzar === 0} onClick={() => void run()}>{busy && <Loader2 size={13} className="animate-spin" />} Confirmar importació ({counts.crear} nous · {counts.actualitzar} a completar)</Button></>}>
      <div className="space-y-3 text-[12.5px]">
        {!res && <>
          <p className="text-muted">Excel (XLSX, XLS) o CSV amb les columnes <b>Nombre, Apellidos, DNI, Email, Teléfono, Dirección, Localidad, Provincia, Código Postal, Etiqueta, Creado En</b>. Res no es desa fins que confirmis. No es crea cap accés ni s&apos;envia cap invitació.</p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
        </>}
        {busy && !p && <div className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Llegint i comprovant duplicats…</div>}
        {err && <Notice tone="red">{err}</Notice>}
        {p && !res && <>
          {p.alreadyImported && <Notice tone="amber">Aquest mateix fitxer ja es va importar el {fdate(p.alreadyImported.created_at)}. Les coincidències per DNI no es tornaran a crear.</Notice>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {[["Files", p.summary.total], ["Col·laboradors", p.summary.collaborators], ["Per classificar", p.summary.pending], ["Nous", counts.crear], ["A completar", counts.actualitzar], ["Per revisar / ignorats", counts.revisar + counts.ignorar]].map(([k, v]) => <div key={k as string} className="rounded-xl border border-line p-2"><div className="text-[11px] text-muted">{k}</div><div className="text-lg font-semibold">{v}</div></div>)}
          </div>
          {p.summary.withoutRepresentative === p.summary.total && <p className="text-muted">La columna «Representante» és buida: no s&apos;assigna cap responsable. Ho pots fer després.</p>}
          {p.unknownColumns.length > 0 && <p className="text-muted">Columnes no utilitzades: {p.unknownColumns.join(", ")}</p>}
          <div className="max-h-[48vh] overflow-auto rounded-xl border border-line">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase text-muted"><tr><th className="px-2 py-1.5">#</th><th>Nom</th><th>DNI/CIF</th><th>Correu</th><th>Etiqueta</th><th>Coincidències i avisos</th><th className="px-2">Acció</th></tr></thead>
              <tbody>{p.items.map(({ row: r, proposal: x }) => (
                <tr key={r.index} className="border-t border-line align-top">
                  <td className="px-2 py-1.5 text-muted">{r.index + 2}</td>
                  <td className="font-medium">{r.fullName}<div className="text-[11px] font-normal text-muted">{r.personKind === "juridica" ? "Persona jurídica" : r.personKind === "fisica" ? "Persona física" : "—"}{r.city ? ` · ${r.city}` : ""}</div></td>
                  <td className="font-mono">{r.taxId ?? "—"}{r.taxId && !r.taxIdValid && <span className="ml-1 text-lost">✗</span>}</td>
                  <td className="max-w-[180px] truncate">{r.email ?? "—"}</td>
                  <td><Badge tone={r.classification === "collaborador" ? "green" : "amber"}>{r.label ?? "—"}</Badge></td>
                  <td className="max-w-[300px] text-[11.5px]">{x.matches.map((m, i) => <div key={i} className="text-amber-700 dark:text-amber-300">Coincideix ({m.kind}) amb {m.name}</div>)}<div className="text-muted">{x.reason}</div>{r.warnings.map((w, i) => <div key={i} className="text-muted">⚠ {w}</div>)}</td>
                  <td className="px-2"><select className="input h-8 text-[12px]" value={dec[r.index]} onChange={(e) => setDec({ ...dec, [r.index]: e.target.value as Action })}>
                    {(["crear", "actualitzar", "revisar", "ignorar"] as Action[]).filter((a) => a === dec[r.index] || a === "ignorar" || a === "revisar" || (a === "crear" && !x.matches.length && !r.errors.length) || (a === "actualitzar" && x.action === "actualitzar")).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                  </select></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <label className="flex items-start gap-2 rounded-xl border border-line p-3"><input type="checkbox" className="mt-0.5" checked={enable} onChange={(e) => setEnable(e.target.checked)} />
            <span><b>Habilitar ara els col·laboradors nous per a comissions.</b> Es crea el seu compte <b>bloquejat</b>: sense contrasenya, sense invitació i sense poder entrar al portal. Serveix perquè se&apos;ls puguin assignar contractes i percentatges. Ho pots fer també més tard.</span></label>
        </>}
        {res && <div className="space-y-2">
          <Notice tone="green">{res.created} col·laboradors creats · {res.updated} fitxes completades · {res.skipped} omesos o per revisar{res.pending ? ` · ${res.pending} pendents de classificar` : ""}.</Notice>
          {res.enabled && <Notice tone="blue">{res.enabled.enabled} habilitats per a comissions (compte bloquejat).{res.enabled.skipped.length ? ` No habilitats: ${res.enabled.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` : ""}</Notice>}
          <p className="text-muted">Ara pots seleccionar-los al llistat i assignar-los el nivell de comissió. Si cal, la importació es pot desfer des de «Importacions».</p>
        </div>}
      </div>
    </Modal>
  );
}

export function ImportsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  type Imp = { id: string; file_name: string; rows_total: number; created_count: number; updated_count: number; skipped_count: number; created_at: string; undone_at: string | null; undo_report: { removed: string[]; kept: { name: string; reason: string }[] } | null };
  const [list, setList] = useState<Imp[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { capApi.get<{ imports: Imp[] }>("collab_imports").then((r) => setList(r.imports)).catch((e) => toast("No s'ha pogut carregar", msg(e), "err")); }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  const undo = async (i: Imp) => {
    if (!confirm(`Desfer la importació «${i.file_name}»? Només s'eliminaran les fitxes creades que no s'hagin fet servir ni modificat.`)) return;
    setBusy(i.id);
    try { const r = await capApi.act<{ removed: string[]; kept: { name: string; reason: string }[] }>("collab_undo", { id: i.id }); toast("Importació desfeta", `${r.removed.length} eliminats · ${r.kept.length} conservats`); load(); onDone(); }
    catch (e) { toast("No s'ha pogut desfer", msg(e), "err"); } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title="Importacions de col·laboradors">
      {!list ? <Loader2 className="animate-spin text-muted" /> : !list.length ? <p className="text-[12.5px] text-muted">Encara no hi ha cap importació.</p> : (
        <ul className="space-y-2 text-[12.5px]">{list.map((i) => (
          <li key={i.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2"><b>{i.file_name}</b><span className="text-muted">{fdate(i.created_at)} · {i.rows_total} files · {i.created_count} creats · {i.updated_count} completats · {i.skipped_count} omesos</span>
              {i.undone_at ? <Badge tone="zinc" className="ml-auto">Desfeta {fdate(i.undone_at)}</Badge> : <Button size="sm" className="ml-auto" disabled={busy === i.id} onClick={() => void undo(i)}>{busy === i.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Desfer</Button>}</div>
            {i.undo_report?.kept.length ? <div className="mt-1 text-[11.5px] text-muted">Conservats: {i.undo_report.kept.map((k) => `${k.name} (${k.reason})`).join("; ")}</div> : null}
          </li>
        ))}</ul>
      )}
    </Modal>
  );
}

/* ======================================================================= nivells per defecte */

export function LevelsModal({ open, onClose, levels, onDone }: { open: boolean; onClose: () => void; levels: Levels; onDone: () => void }) {
  const [f, setF] = useState<Levels>(levels);
  const [applyFrom, setApplyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(levels); setApplyFrom(""); } }, [open, levels]);
  const ok = LEVEL_KEYS.every((k) => validPct(f[k].pct) && f[k].label.trim());
  const run = async () => {
    setBusy(true);
    try { const r = await capApi.act<{ applied: number }>("collab_levels", { data: { levels: f, applyFrom: applyFrom || null } }); toast("Nivells desats", applyFrom ? `${r.applied} col·laboradors actualitzats des del ${fdate(applyFrom)}` : "Els col·laboradors actuals conserven el seu percentatge."); onDone(); }
    catch (e) { toast("No s'ha pogut desar", msg(e), "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Nivells de comissió per defecte" footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!ok || busy} onClick={() => void run()}>{busy && <Loader2 size={13} className="animate-spin" />} Desa</Button></>}>
      <div className="space-y-3 text-[12.5px]">
        <p className="text-muted">Són valors inicials, no límits. Cada col·laborador pot tenir un percentatge personalitzat i excepcions per producte.</p>
        {LEVEL_KEYS.map((k) => (
          <div key={k} className="grid grid-cols-2 gap-2">
            <Field label="Nom"><input className="input" value={f[k].label} onChange={(e) => setF({ ...f, [k]: { ...f[k], label: e.target.value } })} /></Field>
            <Field label="Percentatge sobre la comissió d'Assessoria (%)"><input className="input text-right" inputMode="decimal" value={String(f[k].pct)} onChange={(e) => setF({ ...f, [k]: { ...f[k], pct: e.target.value as unknown as number } })} /></Field>
          </div>
        ))}
        <Field label="Aplicar també als col·laboradors d'aquests nivells a partir del (opcional)" hint="Buit: només afecta les assignacions noves. Mai es recalculen comissions ja meritades."><input type="date" min={today()} className="input" value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ======================================================================= assignació de percentatge (individual o massiva) */

export function AssignPctModal({ open, onClose, userIds, names, levels, preset, onDone }: { open: boolean; onClose: () => void; userIds: string[]; names: string[]; levels: Levels; preset?: LevelKey | "personalitzat"; onDone: () => void }) {
  const [level, setLevel] = useState<LevelKey | "personalitzat">(preset ?? "n1");
  const [pct, setPct] = useState("");
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setLevel(preset ?? "n1"); setPct(""); setFrom(today()); setReason(""); } }, [open, preset]);
  const value = level === "personalitzat" ? pct.replace(",", ".") : String(levels[level].pct);
  const ok = validPct(value) && from >= today();
  const ex = ok ? splitCommission(100, value) : null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await capApi.act<{ changed: number; skipped: { name: string; reason: string }[]; status: string }>("collab_general", { data: { userIds, level, pct: level === "personalitzat" ? value : null, validFrom: from, reason: reason || null } });
      toast(`${r.changed} col·laborador(s) actualitzats`, [r.status === "pendent_aprovacio" ? "Queda pendent d'aprovació de Direcció." : null, r.skipped.length ? `Sense canvis: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` : null].filter(Boolean).join(" ") || undefined, r.skipped.length ? "info" : "ok");
      onDone();
    } catch (e) { toast("No s'ha pogut desar", msg(e), "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={userIds.length === 1 ? `Percentatge de ${names[0]}` : `Percentatge de ${userIds.length} col·laboradors`}
      footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!ok || busy || !userIds.length} onClick={() => void run()}>{busy && <Loader2 size={13} className="animate-spin" />} Aplica a {userIds.length}</Button></>}>
      <div className="space-y-3 text-[12.5px]">
        {userIds.length > 1 && <p className="text-muted">Afectats: {names.slice(0, 12).join(", ")}{names.length > 12 ? ` i ${names.length - 12} més` : ""}.</p>}
        <div className="flex flex-wrap gap-2">
          {LEVEL_KEYS.map((k) => <button key={k} type="button" onClick={() => setLevel(k)} className={cn("rounded-xl border px-3 py-2 text-left", level === k ? "border-ren bg-ren/10" : "border-line")}><div className="font-semibold">{levels[k].label}</div><div className="text-muted">{levels[k].pct} %</div></button>)}
          <button type="button" onClick={() => setLevel("personalitzat")} className={cn("rounded-xl border px-3 py-2 text-left", level === "personalitzat" ? "border-ren bg-ren/10" : "border-line")}><div className="font-semibold">Personalitzat</div><div className="text-muted">0–100 %</div></button>
        </div>
        {level === "personalitzat" && <Field label="Percentatge (%)" hint="Admet decimals: 35, 45, 62,5…"><input className="input w-32 text-right" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} autoFocus /></Field>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Data d'efecte" hint="No pot ser anterior a avui"><input type="date" min={today()} className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Motiu (opcional)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        {ex && <div className="rounded-xl bg-ren/5 p-3">Exemple: si Assessoria 3.0 cobra <b>100 €</b> de comissió d&apos;un contracte, el col·laborador en rep <b>{eur(ex.collaborator)}</b> i en queden <b>{eur(ex.remainder)}</b> per a Assessoria.</div>}
        <p className="text-[11.5px] text-muted">S&apos;aplica sobre la comissió que cobra Assessoria 3.0 segons les regles de la comercialitzadora (no sobre el consum ni l&apos;import de la factura). Les comissions ja calculades o meritades conserven el percentatge que tenien.</p>
      </div>
    </Modal>
  );
}

/* ======================================================================= fitxa de comissions del col·laborador */

type Rule = { id: string; version: number; pct: string; level: string; validFrom: string; validTo: string | null; status: string; reason: string | null; previous: string | null; by: string | null; at: string; retailer: string | null; product: string | null; service: string | null; segment: string | null; tariff: string | null; appliesTo: string | null };
type Profile = { partner: { id: string; name: string; user_id: string | null; manager_id: string | null; classification: string; status: string }; enabled: boolean; levels: Levels; canManage: boolean; canApprove?: boolean; current: { pct: string; level: string; validFrom: string; status: string; next: { pct: string; validFrom: string; status: string } | null } | null; history: Rule[]; exceptions: Rule[]; stats: { forecast: string; accrued: string; retrocessions: string; settled: string } | null };

export function CommissionPanel({ partnerId, isAdmin, onChanged }: { partnerId: string; isAdmin: boolean; onChanged: () => void }) {
  const [d, setD] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [assign, setAssign] = useState(false);
  const [exc, setExc] = useState(false);
  const load = useCallback(() => { capApi.get<Profile>("collab_profile", { id: partnerId }).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(msg(e))); }, [partnerId]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); load(); onChanged(); } catch (e) { toast("No s'ha pogut fer", msg(e), "err"); } };
  if (err) return <Notice tone={/migració/.test(err) ? "amber" : "blue"}>{err}</Notice>;
  if (!d) return <Loader2 className="animate-spin text-muted" size={16} />;
  const lv = d.levels ?? DEFAULT_LEVELS;
  if (!d.enabled) return (
    <div className="space-y-2 text-[12.5px]">
      <Notice tone="blue">Encara no està habilitat per a comissions. Cal un compte (que es crea <b>bloquejat</b>, sense accés) perquè se li puguin assignar contractes i percentatges.</Notice>
      {isAdmin && d.partner.classification === "collaborador" && <Button size="sm" onClick={() => void act(() => capApi.act("collab_enable", { data: { partnerIds: [partnerId] } }), "Habilitat per a comissions")}><Lock size={13} /> Habilitar per a comissions</Button>}
      {d.partner.classification !== "collaborador" && <p className="text-muted">Primer cal classificar-lo com a col·laborador.</p>}
    </div>
  );
  const what = (r: Rule) => [r.retailer, r.product, r.service, r.segment, r.tariff, r.appliesTo === "alta_nova" ? "alta nova" : r.appliesTo].filter(Boolean).join(" · ");
  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
        <div><div className="text-[11px] uppercase text-muted">Percentatge general vigent</div>
          <div className="text-2xl font-semibold">{d.current ? `${Number(d.current.pct).toLocaleString("ca-ES")} %` : "Sense configurar"}</div>
          {d.current && <div className="text-muted">{levelName(lv, d.current.level)} · des del {fdate(d.current.validFrom)}{d.current.status === "pendent_aprovacio" && <Badge tone="amber" className="ml-1">Pendent d&apos;aprovació</Badge>}</div>}
          {d.current?.next && <div className="text-muted">Canvi previst: {Number(d.current.next.pct).toLocaleString("ca-ES")} % des del {fdate(d.current.next.validFrom)}</div>}
        </div>
        {d.canManage && <div className="ml-auto flex gap-2"><Button size="sm" variant="primary" onClick={() => setAssign(true)}>Canvia el percentatge</Button><Button size="sm" onClick={() => setExc(true)}><Plus size={13} /> Excepció</Button></div>}
      </div>
      {d.stats && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Previstes", d.stats.forecast], ["Meritades", d.stats.accrued], ["Liquidades", d.stats.settled], ["Retrocessions", d.stats.retrocessions]].map(([k, v]) => <div key={k} className="rounded-xl border border-line p-2"><div className="text-[11px] text-muted">{k}</div><div className="font-semibold tabular-nums">{eur(v)}</div></div>)}</div>}
      <section>
        <h4 className="font-semibold">Excepcions (tenen prioritat sobre el general)</h4>
        <ul className="mt-1 space-y-1">{d.exceptions.filter((r) => r.status !== "retirada").map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2 py-1.5"><b>{Number(r.pct).toLocaleString("ca-ES")} %</b><span>{what(r)}</span><span className="text-muted">{fdate(r.validFrom)}{r.validTo ? ` – ${fdate(r.validTo)}` : ""}</span>{r.status === "pendent_aprovacio" && <Badge tone="amber">Pendent</Badge>}
            <span className="ml-auto flex gap-1">{d.canApprove && r.status === "pendent_aprovacio" && <Button size="sm" onClick={() => void act(() => capApi.act("collab_approve", { id: r.id }), "Excepció aprovada")}><CheckCircle2 size={12} /> Aprova</Button>}{d.canManage && <Button size="sm" variant="ghost" onClick={() => void act(() => capApi.act("collab_retire", { id: r.id }), "Excepció retirada")}><X size={12} /> Retira</Button>}</span></li>
        ))}{!d.exceptions.filter((r) => r.status !== "retirada").length && <li className="text-muted">Cap excepció.</li>}</ul>
      </section>
      <section>
        <h4 className="flex items-center gap-1 font-semibold"><History size={13} /> Històric del percentatge general</h4>
        <ul className="mt-1 space-y-1">{d.history.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 text-[12px]"><span className="font-mono text-muted">v{r.version}</span>{r.previous != null && <span className="text-muted">{Number(r.previous).toLocaleString("ca-ES")} % →</span>}<b>{Number(r.pct).toLocaleString("ca-ES")} %</b><span className="text-muted">des del {fdate(r.validFrom)}{r.validTo ? ` fins al ${fdate(r.validTo)}` : ""} · {r.by ?? "—"} · {fdate(r.at)}{r.reason ? ` · ${r.reason}` : ""}</span>
            <Badge tone={r.status === "aprovada" ? "green" : r.status === "pendent_aprovacio" ? "amber" : "zinc"}>{r.status === "aprovada" ? "Aprovada" : r.status === "pendent_aprovacio" ? "Pendent" : "Retirada"}</Badge>
            {d.canApprove && r.status === "pendent_aprovacio" && <Button size="sm" onClick={() => void act(() => capApi.act("collab_approve", { id: r.id }), "Percentatge aprovat")}>Aprova</Button>}</li>
        ))}{!d.history.length && <li className="text-muted">Sense historial.</li>}</ul>
      </section>
      <AssignPctModal open={assign} onClose={() => setAssign(false)} userIds={[d.partner.user_id!]} names={[d.partner.name]} levels={lv} preset={d.current ? (d.current.level as LevelKey) : "n1"} onDone={() => { setAssign(false); load(); onChanged(); }} />
      <ExceptionModal open={exc} onClose={() => setExc(false)} userId={d.partner.user_id!} onDone={() => { setExc(false); load(); onChanged(); }} />
    </div>
  );
}

function ExceptionModal({ open, onClose, userId, onDone }: { open: boolean; onClose: () => void; userId: string; onDone: () => void }) {
  const [f, setF] = useState({ pct: "", retailer: "", product: "", service: "", segment: "", tariff: "", appliesTo: "", validFrom: today(), validTo: "", reason: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ pct: "", retailer: "", product: "", service: "", segment: "", tariff: "", appliesTo: "", validFrom: today(), validTo: "", reason: "" }); }, [open]);
  const run = async () => {
    setBusy(true);
    try { await capApi.act("collab_exception", { data: { userId, pct: f.pct.replace(",", "."), retailer: f.retailer || null, product: f.product || null, service: f.service || null, segment: f.segment || null, tariff: f.tariff || null, appliesTo: f.appliesTo || null, validFrom: f.validFrom, validTo: f.validTo || null, reason: f.reason || null } }); toast("Excepció creada"); onDone(); }
    catch (e) { toast("No s'ha pogut crear", msg(e), "err"); } finally { setBusy(false); }
  };
  const t = (k: keyof typeof f, label: string, ph?: string) => <Field label={label}><input className="input" placeholder={ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title="Excepció de percentatge" footer={<><Button onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !validPct(f.pct.replace(",", ".") || "x")} onClick={() => void run()}>Desa</Button></>}>
      <div className="grid gap-3 text-[12.5px] sm:grid-cols-2">
        {t("pct", "Percentatge (%)", "p. ex. 50")}
        {t("retailer", "Comercialitzadora", "Igual que a les regles (p. ex. Naturgy)")}
        {t("product", "Producte", "Nom o part del nom del producte")}
        <Field label="Servei"><select className="input" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">Qualsevol</option><option value="llum_residencial">Llum residencial</option><option value="llum_empresa">Llum empresa</option><option value="gas">Gas</option><option value="fibra_telefonia">Fibra i telefonia</option><option value="assegurances">Assegurances</option><option value="alarmes">Alarmes</option></select></Field>
        <Field label="Segment"><select className="input" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })}><option value="">Qualsevol</option><option value="residencial">Residencial</option><option value="pime">Pime</option><option value="gran_consum">Gran consum</option></select></Field>
        {t("tariff", "Tarifa d'accés", "2.0TD, 3.0TD…")}
        <Field label="Tipus de contracte"><select className="input" value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })}><option value="">Qualsevol</option><option value="alta_nova">Alta nova</option><option value="renovacio">Renovació</option></select></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Des del"><input type="date" className="input" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field><Field label="Fins al (opcional)"><input type="date" className="input" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field></div>
        <div className="sm:col-span-2">{t("reason", "Motiu (opcional)")}</div>
        <p className="text-[11.5px] text-muted sm:col-span-2">Prioritat: excepció per producte &gt; per comercialitzadora &gt; per segment &gt; per servei &gt; percentatge general del col·laborador &gt; regla general sense col·laborador.</p>
      </div>
    </Modal>
  );
}

