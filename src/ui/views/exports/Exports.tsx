"use client";
/** EXPORTACIONS A EXCEL: tria el conjunt, filtra per estat, dates, cerca i camps, tria columnes i descarrega. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Columns3, Download, FileSpreadsheet, Loader2, RotateCcw, Search } from "lucide-react";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Field, Notice, cn } from "../../components/ui";
import { ApiError, crmApi } from "../crm/api";

type SetInfo = { id: string; label: string; group: string; statusCol: string | null; statusLabel: string; dates: { col: string; label: string }[]; retailer: boolean; owner: boolean; collaborator: boolean; facets: { col: string; label: string }[]; columns: { key: string; header: string }[]; archivable: boolean; expandJson: boolean };
type F = { status: string[]; dateCol: string; from: string; to: string; q: string; retailer: string; owner: string; collaborator: string; facets: Record<string, string>; columns: string[]; archived: boolean };

async function get<T>(qs: Record<string, string>): Promise<T> {
  const r = await fetch(`/api/export?${new URLSearchParams(qs)}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error ?? `Error ${r.status}`);
  return j as T;
}
const blank = (s: SetInfo | null): F => ({ status: [], dateCol: s?.dates[0]?.col ?? "", from: "", to: "", q: "", retailer: "", owner: "", collaborator: "", facets: {}, columns: s?.columns.map((c) => c.key) ?? [], archived: false });
const PRESETS: { label: string; from: () => string; to: () => string }[] = [
  { label: "Aquest mes", from: () => new Date().toISOString().slice(0, 8) + "01", to: () => new Date().toISOString().slice(0, 10) },
  { label: "Mes passat", from: () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); }, to: () => { const d = new Date(); d.setUTCDate(0); return d.toISOString().slice(0, 10); } },
  { label: "Aquest any", from: () => `${new Date().getFullYear()}-01-01`, to: () => `${new Date().getFullYear()}-12-31` },
  { label: "Any passat", from: () => `${new Date().getFullYear() - 1}-01-01`, to: () => `${new Date().getFullYear() - 1}-12-31` },
];

export function ExportsView() {
  const params = useApp((s) => s.params);
  const [sets, setSets] = useState<SetInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string>(params.set ?? "");
  const [f, setF] = useState<F>(blank(null));
  const [meta, setMeta] = useState<Record<string, string[]>>({});
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string; role: string }[]>([]);
  const [showCols, setShowCols] = useState(false);
  useEffect(() => { get<{ sets: SetInfo[] }>({ r: "catalog" }).then((r) => { setSets(r.sets); if (!sel && r.sets[0]) setSel(r.sets[0].id); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, [sel]);
  useEffect(() => { crmApi.facets().then((x) => setPeople(x.users)).catch(() => undefined); }, []);
  const set = sets?.find((s) => s.id === sel) ?? null;
  useEffect(() => { setF(blank(set)); setMeta({}); if (set) get<{ values: Record<string, string[]> }>({ r: "meta", entity: set.id }).then((r) => setMeta(r.values)).catch(() => undefined); }, [set]);
  const qs = useMemo(() => {
    if (!set) return null;
    const p: Record<string, string> = { entity: set.id };
    if (f.status.length) p.status = f.status.join(",");
    if (f.dateCol && (f.from || f.to)) { p.dateCol = f.dateCol; if (f.from) p.from = f.from; if (f.to) p.to = f.to; }
    if (f.q) p.q = f.q; if (f.retailer) p.retailer = f.retailer; if (f.owner) p.owner = f.owner; if (f.collaborator) p.collaborator = f.collaborator;
    for (const [k, v] of Object.entries(f.facets)) if (v) p[`f_${k}`] = v;
    if (f.archived) p.archived = "1";
    if (f.columns.length && f.columns.length < set.columns.length) p.columns = f.columns.join(",");
    return p;
  }, [set, f]);
  const doCount = useCallback(async () => {
    if (!qs) return;
    setCounting(true);
    try { setCount((await get<{ count: number }>({ r: "count", ...qs })).count); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setCount(null); } finally { setCounting(false); }
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void doCount(), 350); return () => clearTimeout(t); }, [doCount]);
  const groups = useMemo(() => [...new Set((sets ?? []).map((s) => s.group))], [sets]);
  const toggleStatus = (v: string) => setF((x) => ({ ...x, status: x.status.includes(v) ? x.status.filter((s) => s !== v) : [...x.status, v] }));
  if (err && !sets) return <div className="mx-auto max-w-[1200px] px-4 py-6"><Notice tone="red">{err}</Notice></div>;
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><FileSpreadsheet size={20} className="text-ren" /> Exportacions a Excel</h2>
        <p className="text-[13px] text-muted">Tria què vols exportar, filtra-ho i descarrega l&apos;Excel. Només hi surten les dades que tens permís per veure, i cada exportació queda registrada.</p>
      </div>
      {!sets ? <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-muted" /></div> : !sets.length ? <Empty icon={<FileSpreadsheet size={24} />} title="No tens cap conjunt de dades per exportar" /> : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <nav className="space-y-3 rounded-2xl border border-line bg-surface p-3">{groups.map((g) => (
            <div key={g}><div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{g}</div>
              {sets.filter((s) => s.group === g).map((s) => <button key={s.id} onClick={() => setSel(s.id)} className={cn("mt-0.5 block w-full rounded-lg px-2 py-1.5 text-left text-[13px]", sel === s.id ? "bg-ren/10 font-medium text-ren" : "hover:bg-ink/5")}>{s.label}</button>)}
            </div>
          ))}</nav>
          {set && (
            <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold">{set.label}</h3><Button size="sm" variant="ghost" onClick={() => setF(blank(set))}><RotateCcw size={13} /> Treu els filtres</Button></div>
              {set.statusCol && (meta[set.statusCol]?.length ?? 0) > 0 && (
                <div><span className="label">{set.statusLabel}</span><div className="flex flex-wrap gap-1.5">{meta[set.statusCol].map((v) => <button key={v} onClick={() => toggleStatus(v)} className={cn("rounded-full border px-2.5 py-1 text-[12px]", f.status.includes(v) ? "border-ren bg-ren/10 text-ren" : "border-line hover:bg-ink/5")}>{v.replace(/_/g, " ")}</button>)}</div><p className="mt-1 text-[11px] text-muted">{f.status.length ? `${f.status.length} seleccionats` : "Cap seleccionat = tots els estats"}</p></div>
              )}
              {set.dates.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-[200px_1fr_1fr]">
                  <Field label="Data per filtrar"><select className="input h-9" value={f.dateCol} onChange={(e) => setF({ ...f, dateCol: e.target.value })}>{set.dates.map((d) => <option key={d.col} value={d.col}>{d.label}</option>)}</select></Field>
                  <Field label="Des de"><input type="date" className="input h-9" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
                  <Field label="Fins a"><input type="date" className="input h-9" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
                  <div className="flex flex-wrap gap-1.5 sm:col-span-3">{PRESETS.map((p) => <button key={p.label} className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] hover:bg-ink/5" onClick={() => setF({ ...f, from: p.from(), to: p.to() })}>{p.label}</button>)}</div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Cerca"><div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-muted" /><input className="input h-9 pl-8" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Nom, CIF, CUPS, referència…" /></div></Field>
                {set.retailer && <Field label="Comercialitzadora"><input className="input h-9" value={f.retailer} onChange={(e) => setF({ ...f, retailer: e.target.value })} placeholder="p. ex. Naturgy" /></Field>}
                {set.owner && <Field label="Responsable / comercial"><select className="input h-9" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}><option value="">Tots</option>{people.filter((p) => p.role !== "colaborador").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
                {set.collaborator && <Field label="Col·laborador / beneficiari"><select className="input h-9" value={f.collaborator} onChange={(e) => setF({ ...f, collaborator: e.target.value })}><option value="">Tots</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
                {set.facets.map((x) => (meta[x.col]?.length ?? 0) > 0 && <Field key={x.col} label={x.label}><select className="input h-9" value={f.facets[x.col] ?? ""} onChange={(e) => setF({ ...f, facets: { ...f.facets, [x.col]: e.target.value } })}><option value="">Tots</option>{meta[x.col].map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</select></Field>)}
              </div>
              {set.archivable && <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} /> Inclou també els arxivats</label>}
              <div>
                <button className="flex items-center gap-1.5 text-[12.5px] font-medium" onClick={() => setShowCols(!showCols)}><Columns3 size={14} /> Columnes ({f.columns.length} de {set.columns.length}){set.expandJson ? " + les dades detallades" : ""}</button>
                {showCols && <div className="mt-2 rounded-xl border border-line p-3">
                  <div className="mb-2 flex gap-3 text-[12px]"><button className="underline" onClick={() => setF({ ...f, columns: set.columns.map((c) => c.key) })}>Totes</button><button className="underline" onClick={() => setF({ ...f, columns: [] })}>Cap</button></div>
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{set.columns.map((c) => <label key={c.key} className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={f.columns.includes(c.key)} onChange={() => setF({ ...f, columns: f.columns.includes(c.key) ? f.columns.filter((k) => k !== c.key) : [...f.columns, c.key] })} /> {c.header}</label>)}</div>
                </div>}
              </div>
              {err && <Notice tone={/migració/.test(err) ? "amber" : "red"}>{err}</Notice>}
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                <span className="text-[13px]">{counting ? <Loader2 size={14} className="inline animate-spin" /> : count != null ? <><b>{count.toLocaleString("ca-ES")}</b> files{count > 50000 && <Badge tone="amber" className="ml-2">S&apos;exportaran les primeres 50.000</Badge>}</> : "—"}</span>
                <a className="ml-auto" href={qs && f.columns.length ? `/api/export?${new URLSearchParams({ r: "xlsx", ...qs })}` : undefined} aria-disabled={!count || !f.columns.length}>
                  <Button variant="primary" disabled={!count || !f.columns.length}><Download size={15} /> Descarrega l&apos;Excel</Button>
                </a>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
