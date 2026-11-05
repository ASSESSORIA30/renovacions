"use client";
/** CLIENTS · pantalla general: cerca, filtres, ordenació, taula o targetes, paginació al servidor i accions massives. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useViewState } from "../../useViewState";
import { Archive, Building2, CalendarClock, Filter, Flame, LayoutGrid, Loader2, Plus, Rows3, Search, Store, Upload, User, Users, X, Zap } from "lucide-react";
import {
  CLIENT_KIND_LABEL, CLIENT_STATUSES, CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE, LIST_SORTS, LIST_SORT_LABEL, formatPhone,
  type ClientStatus, type ListSort,
} from "@/core/crm";
import { daysUntil, fmtDate } from "@/core/dates";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";
import { Badge, Button, Empty, Modal, Notice, cn } from "../../components/ui";
import { crmApi, crmReady, type Facets, type ListResult } from "./api";
import { ClientForm } from "./ClientForm";
import { ExportButton } from "../../components/ExportButton";

type Filters = { q: string; status: "" | ClientStatus; owner: string; collaborator: string; province: string; city: string; sector: string; service: "" | "luz" | "gas" | "cap"; sort: ListSort; size: number };
const EMPTY: Filters = { q: "", status: "", owner: "", collaborator: "", province: "", city: "", sector: "", service: "", sort: "nom", size: 25 };
const KEY = "a30.crm.clients.filters";

function loadFilters(): Filters {
  try { return { ...EMPTY, ...(JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Partial<Filters>) }; } catch { return EMPTY; }
}

/** Temps des de l'última activitat (passat): «avui», «ahir», «fa 5 dies» o la data. */
function ago(iso: string | null) {
  if (!iso) return "—";
  const d = -(daysUntil(iso.slice(0, 10)) ?? 0);
  return d <= 0 ? "Avui" : d === 1 ? "Ahir" : d < 60 ? `Fa ${d} dies` : fmtDate(iso.slice(0, 10));
}
const initials = (n: string) => n.replace(/\b(S\.?L\.?U?|S\.?A\.?)\b/gi, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const KindIcon = ({ kind }: { kind: string }) => (kind === "empresa" ? <Building2 size={13} /> : kind === "autonom" ? <Store size={13} /> : <User size={13} />);

export function ClientsView() {
  const me = useApp((s) => s.snap!.me);
  const staff = isStaff(me.role);
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useViewState("clients.page", 1);
  const [data, setData] = useState<ListResult | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"taula" | "targetes">("taula");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  useEffect(() => { const q = useApp.getState().params.q; setF(q ? { ...loadFilters(), q } : loadFilters()); try { setMode((localStorage.getItem("a30.crm.mode") as "taula" | "targetes") || "taula"); } catch { /* */ } }, []);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(f)); } catch { /* */ } }, [f]);

  const load = useCallback(async (fl: Filters, pg: number) => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const r = await crmApi.list({ ...fl, page: pg });
      if (n !== seq.current) return;
      setData(r);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);
  // la cerca espera que s'acabi d'escriure; els filtres s'apliquen a l'instant
  useEffect(() => {
    if (!crmReady()) return;
    const t = setTimeout(() => load(f, page), f.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [f, page, load]);
  useEffect(() => { if (crmReady()) crmApi.facets().then(setFacets).catch(() => undefined); }, []);

  const setFilter = (p: Partial<Filters>) => { setF((x) => ({ ...x, ...p })); setPage(1); setSelected(new Set()); };
  const active = (Object.keys(EMPTY) as (keyof Filters)[]).filter((k) => !["sort", "size", "q"].includes(k) && f[k] !== EMPTY[k]).length;
  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  // si els filtres redueixen el total i la pàgina desada queda fora de rang, es torna a l'última vàlida
  useEffect(() => { if (data && page > pages) setPage(pages); else if (!(page >= 1)) setPage(1); }, [data, page, pages, setPage]);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const owners = useMemo(() => (facets?.users ?? []).filter((u) => u.role === "comercial" || isStaff(u.role as never)), [facets]);
  const open = (id: string) => useApp.getState().navigate("client", { id });

  if (!crmReady()) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Empty icon={<Users size={26} />} title="El mòdul Clients necessita la base de dades" body="Aquest desplegament no té Supabase configurat. Els clients, documents i contractes es desen només a Supabase (no al navegador ni a l'Excel)." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Clients</h2>
          <p className="text-[13px] text-muted">Particulars i empreses, amb els seus subministraments, contractes, documents i activitat.</p>
        </div>
        <div className="flex gap-2">
          <ExportButton size="md" set="clients" params={{ q: f.q, status: f.status, owner: f.owner, x_city: f.city, x_province: f.province, x_sector: f.sector, x_service: f.service }} label="Exporta a Excel" />
          {staff && <Button onClick={() => setImporting(true)}><Upload size={15} /> Importa la cartera</Button>}
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={15} /> Nou client</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {([["actiu", "Actius", "text-ren"], ["potencial", "Potencials", "text-blue-600 dark:text-blue-400"], ["inactiu", "Inactius", "text-muted"]] as const).map(([k, label, tone]) => (
          <button key={k} onClick={() => setFilter({ status: f.status === k ? "" : k })} className={cn("pressable rounded-2xl border bg-surface p-3.5 text-left shadow-card", f.status === k ? "border-brand ring-2 ring-brand/15" : "border-line hover:border-ink/20")}>
            <p className="text-[12px] text-muted">{label}</p>
            <p className={cn("text-2xl font-semibold tnum", tone)}>{data ? data.counters[k].toLocaleString("ca-ES") : "—"}</p>
          </button>
        ))}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-card">
          <p className="text-[12px] text-muted">{active || f.q ? "Resultats amb els filtres" : "Total (sense arxivats)"}</p>
          <p className="text-2xl font-semibold tnum">{data ? data.total.toLocaleString("ca-ES") : "—"}</p>
        </div>
      </div>

      <section className="space-y-2 rounded-2xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Cerca per nom, NIF/CIF, telèfon, correu, població o CUPS…" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} aria-label="Cerca clients" />
            {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          <select className="input h-10 w-auto" aria-label="Estat" value={f.status} onChange={(e) => setFilter({ status: e.target.value as Filters["status"] })}>
            <option value="">Tots els estats</option>
            {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{CLIENT_STATUS_LABEL[s]}</option>)}
          </select>
          {owners.length > 1 && (
            <select className="input h-10 w-auto" aria-label="Comercial" value={f.owner} onChange={(e) => setFilter({ owner: e.target.value })}>
              <option value="">Tots els comercials</option>
              {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              <option value="cap">Sense assignar</option>
            </select>
          )}
          <select className="input h-10 w-auto" aria-label="Col·laborador / Propietari" value={f.collaborator} onChange={(e) => setFilter({ collaborator: e.target.value })}>
            <option value="">Tots els col·laboradors / propietaris</option>
            {(facets?.collaborators ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input h-10 w-auto" aria-label="Ordena per" value={f.sort} onChange={(e) => setFilter({ sort: e.target.value as ListSort })}>
            {LIST_SORTS.map((s) => <option key={s} value={s}>{LIST_SORT_LABEL[s]}</option>)}
          </select>
          <button onClick={() => setMore(!more)} className={cn("pressable flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[13px]", more || active > (f.status ? 1 : 0) + (f.owner ? 1 : 0) ? "border-brand/60 text-brand" : "border-line text-muted")}><Filter size={14} /> Més filtres</button>
          {(active > 0 || f.q) && <button onClick={() => setFilter({ ...EMPTY, sort: f.sort, size: f.size })} className="pressable flex h-10 items-center gap-1 px-2 text-[13px] text-muted hover:text-ink"><X size={14} /> Neteja</button>}
          <div className="ml-auto flex rounded-xl border border-line p-0.5" role="group" aria-label="Vista">
            {([["taula", Rows3, "Taula"], ["targetes", LayoutGrid, "Targetes"]] as const).map(([m, Icon, label]) => (
              <button key={m} aria-pressed={mode === m} title={label} onClick={() => { setMode(m); try { localStorage.setItem("a30.crm.mode", m); } catch { /* */ } }} className={cn("rounded-lg px-2.5 py-1.5", mode === m ? "bg-ink/[0.07] text-ink" : "text-muted")}><Icon size={15} /></button>
            ))}
          </div>
        </div>
        {more && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-2">
            <select className="input h-9 w-auto text-[12.5px]" aria-label="Província" value={f.province} onChange={(e) => setFilter({ province: e.target.value })}>
              <option value="">Totes les províncies</option>{(facets?.provinces ?? []).map((p) => <option key={p}>{p}</option>)}
            </select>
            <input className="input h-9 w-48 text-[12.5px]" list="crm-cities" aria-label="Municipi" placeholder="Municipi" value={f.city} onChange={(e) => setFilter({ city: e.target.value })} />
            <datalist id="crm-cities">{(facets?.cities ?? []).map((c) => <option key={c} value={c} />)}</datalist>
            <select className="input h-9 w-auto text-[12.5px]" aria-label="Sector" value={f.sector} onChange={(e) => setFilter({ sector: e.target.value })}>
              <option value="">Tots els sectors</option>{(facets?.sectors ?? []).map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="input h-9 w-auto text-[12.5px]" aria-label="Serveis contractats" value={f.service} onChange={(e) => setFilter({ service: e.target.value as Filters["service"] })}>
              <option value="">Tots els serveis</option><option value="luz">Amb electricitat</option><option value="gas">Amb gas</option><option value="cap">Sense subministraments</option>
            </select>
          </div>
        )}
      </section>

      {selected.size > 0 && <BulkBar ids={[...selected]} staff={staff} owners={owners} onDone={() => { setSelected(new Set()); void load(f, page); }} onClear={() => setSelected(new Set())} />}
      {error && <Notice tone="red">{error}</Notice>}

      {!data && !error ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-elevated" />)}</div>
      ) : data && data.total === 0 ? (
        active || f.q ? (
          <Empty icon={<Search size={24} />} title="Cap client amb aquests criteris" body="Prova una altra cerca o neteja els filtres." action={<Button size="sm" onClick={() => setFilter({ ...EMPTY, sort: f.sort })}>Neteja els filtres</Button>} />
        ) : (
          <Empty icon={<Users size={26} />} title="Encara no hi ha clients" body={staff ? "Crea'n un o importa la cartera actual (els contractes que ja tens sincronitzats) per començar." : "Crea el teu primer client. Els que t'assigni Administració també apareixeran aquí."}
            action={<div className="flex gap-2">{staff && <Button size="sm" onClick={() => setImporting(true)}><Upload size={13} /> Importa la cartera</Button>}<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={13} /> Nou client</Button></div>} />
        )
      ) : mode === "taula" ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[1200px] text-[12.5px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Selecciona tota la pàgina" checked={allOnPage} onChange={(e) => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} /></th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Contacte</th>
                <th className="px-3 py-2 text-left">Població</th>
                <th className="px-3 py-2 text-left">Comercial</th>
                <th className="px-3 py-2 text-left">Col·laborador / Propietari</th>
                <th className="px-3 py-2 text-left">Serveis</th>
                <th className="px-3 py-2 text-left">Propera renovació</th>
                <th className="px-3 py-2 text-left">Última activitat</th>
                <th className="px-3 py-2 text-left">Estat</th>
              </tr>
            </thead>
            <tbody className={cn(loading && "opacity-60")}>
              {rows.map((r) => (
                <tr key={r.id} className={cn("cursor-pointer border-t border-line hover:bg-ink/[0.025]", selected.has(r.id) && "bg-brand/[0.04]")} onClick={() => open(r.id)}>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Selecciona ${r.name}`} checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-[11px] font-semibold text-brand">{initials(r.name)}</span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.name}</p>
                        <p className="flex items-center gap-1 text-[11px] text-muted"><KindIcon kind={r.kind} /> {CLIENT_KIND_LABEL[r.kind]}{r.tax_id ? ` · ${r.tax_id}` : ""}{r.priority === "alta" ? " · ⬆ prioritat alta" : ""}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted"><p>{formatPhone(r.phone) || "—"}</p><p className="max-w-[200px] truncate text-[11px]">{r.email}</p></td>
                  <td className="px-3 py-2.5">{r.city ?? "—"}<p className="text-[11px] text-muted">{r.province}</p></td>
                  <td className="px-3 py-2.5">{r.owner_name ?? <span className="text-muted">Sense assignar</span>}</td>
                  <td className="px-3 py-2.5">{r.owner_labels?.length ? r.owner_labels.join(" · ") : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[12px]">
                      {r.luz_count > 0 && <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400" title="Electricitat"><Zap size={13} />{r.luz_count}</span>}
                      {r.gas_count > 0 && <span className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400" title="Gas"><Flame size={13} />{r.gas_count}</span>}
                      {!r.supplies_count && <span className="text-muted">—</span>}
                      {r.active_contracts > 0 && <span className="text-muted">· {r.active_contracts} contr.</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><RenewalCell date={r.next_renewal} /></td>
                  <td className="px-3 py-2.5 text-muted">{ago(r.last_activity_at)}</td>
                  <td className="px-3 py-2.5"><Badge tone={CLIENT_STATUS_TONE[r.status]}>{CLIENT_STATUS_LABEL[r.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", loading && "opacity-60")}>
          {rows.map((r) => (
            <div key={r.id} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(r.id)} onClick={() => open(r.id)} className={cn("pressable relative cursor-pointer rounded-2xl border bg-surface p-4 shadow-card hover:border-ink/20", selected.has(r.id) ? "border-brand ring-2 ring-brand/15" : "border-line")}>
              <input type="checkbox" className="absolute right-3 top-3" aria-label={`Selecciona ${r.name}`} checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
              <div className="flex items-start gap-3 pr-6">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-[13px] font-semibold text-brand">{initials(r.name)}</span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.name}</p>
                  <p className="flex items-center gap-1 text-[11.5px] text-muted"><KindIcon kind={r.kind} /> {CLIENT_KIND_LABEL[r.kind]}{r.city ? ` · ${r.city}` : ""}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge tone={CLIENT_STATUS_TONE[r.status]}>{CLIENT_STATUS_LABEL[r.status]}</Badge>
                {r.luz_count > 0 && <Badge tone="amber"><Zap size={11} /> {r.luz_count} llum</Badge>}
                {r.gas_count > 0 && <Badge tone="blue"><Flame size={11} /> {r.gas_count} gas</Badge>}
                {r.tags.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-2.5 text-[11.5px]">
                <div><p className="text-muted">Comercial</p><p className="truncate">{r.owner_name ?? "—"}</p></div>
                <div><p className="text-muted">Col·laborador / Propietari</p><p className="truncate">{r.owner_labels?.join(" · ") || "—"}</p></div>
                <div><p className="text-muted">Propera renovació</p><RenewalCell date={r.next_renewal} /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
          <span>{((page - 1) * data.size + 1).toLocaleString("ca-ES")}–{Math.min(page * data.size, data.total).toLocaleString("ca-ES")} de {data.total.toLocaleString("ca-ES")} clients</span>
          <div className="flex items-center gap-2">
            <select className="input h-8 w-auto py-0 text-[12px]" aria-label="Clients per pàgina" value={f.size} onChange={(e) => setFilter({ size: Number(e.target.value) })}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n} per pàgina</option>)}</select>
            <Button size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Anterior</Button>
            <span className="tnum">{page} / {pages}</span>
            <Button size="sm" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Següent</Button>
          </div>
        </div>
      )}

      {creating && <ClientForm client={null} facets={facets} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); useApp.getState().navigate("client", { id }); }} />}
      {importing && <ImportPortfolio onClose={() => setImporting(false)} onDone={() => { void load(f, 1); crmApi.facets().then(setFacets).catch(() => undefined); }} />}
    </div>
  );
}

function RenewalCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted">—</span>;
  const d = daysUntil(date) ?? 0;
  return <span className={cn("inline-flex items-center gap-1", d <= 30 ? "font-medium text-lost" : d <= 90 ? "text-pend" : "")}><CalendarClock size={13} /> {fmtDate(date)}</span>;
}

function BulkBar({ ids, staff, owners, onDone, onClear }: { ids: string[]; staff: boolean; owners: { id: string; name: string }[]; onDone: () => void; onClear: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useApp((s) => s.toast);
  const run = async (action: "assign" | "status" | "archive", value?: string | null) => {
    if (action === "archive" && !confirm(`Segur que vols arxivar ${ids.length} clients? Deixaran de sortir als llistats (no s'esborra res).`)) return;
    setBusy(true);
    try {
      const r = await crmApi.action<{ updated: number; skipped: number }>({ entity: "bulk", action, ids, value: value ?? null });
      toast({ title: `${r.updated} clients actualitzats`, body: r.skipped ? `${r.skipped} sense permís per modificar-los` : undefined, tone: "ok" });
      onDone();
    } catch (e) {
      toast({ title: "No s'ha pogut fer l'acció", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-brand/40 bg-surface px-3 py-2 shadow-lift">
      <span className="text-[13px] font-medium">{ids.length} seleccionats</span>
      <select className="input h-8 w-auto py-0 text-[12.5px]" disabled={busy} value="" aria-label="Canvia l'estat" onChange={(e) => e.target.value && run("status", e.target.value)}>
        <option value="">Canvia l&apos;estat…</option>{CLIENT_STATUSES.map((s) => <option key={s} value={s}>{CLIENT_STATUS_LABEL[s]}</option>)}
      </select>
      {staff && (
        <select className="input h-8 w-auto py-0 text-[12.5px]" disabled={busy} value="" aria-label="Assigna comercial" onChange={(e) => e.target.value && run("assign", e.target.value === "cap" ? null : e.target.value)}>
          <option value="">Assigna a…</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}<option value="cap">Sense assignar</option>
        </select>
      )}
      <ExportButton set="clients" ids={ids} />
      {staff && <Button size="sm" variant="ghost" className="text-lost" disabled={busy} onClick={() => run("archive")}><Archive size={13} /> Arxiva</Button>}
      {busy && <Loader2 size={14} className="animate-spin text-muted" />}
      <button className="ml-auto text-[12.5px] text-muted hover:text-ink" onClick={onClear}>Desselecciona</button>
    </div>
  );
}

function ImportPortfolio({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<Record<string, number> | null>(null);
  const [result, setResult] = useState<{ clients: number; supplies: number; contracts: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { crmApi.importPortfolio(true).then((r) => setPlan(r.stats)).catch((e) => setError(String(e instanceof Error ? e.message : e))); }, []);
  const run = async () => {
    setBusy(true);
    setError(null);
    try { const r = await crmApi.importPortfolio(false); setResult(r.created ?? null); onDone(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const L: Record<string, string> = { newClients: "Clients nous", existingClients: "Clients que ja existeixen (s'hi afegeixen dades)", supplies: "Subministraments (CUPS)", contracts: "Contractes", skippedContracts: "Contractes ja importats (s'ometen)", skippedSupplies: "CUPS repetits (s'ometen)", withoutTaxId: "Registres sense NIF/CIF (s'agrupen per nom i telèfon)", invalidTaxId: "NIF/CIF no vàlids (es conserven a observacions)", noCups: "Registres sense CUPS vàlid" };
  return (
    <Modal open onClose={onClose} width="max-w-xl" title="Importa la cartera al CRM"
      footer={result ? <Button variant="primary" onClick={onClose}>Fet</Button> : <><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={!plan || busy || !plan.contracts} onClick={run}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Importa</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Crea els clients, subministraments i contractes a partir dels contractes que ja hi ha a Renovacions (sincronitzats de l&apos;Excel). No modifica Renovacions ni l&apos;Excel. Es pot repetir: el que ja s&apos;ha importat s&apos;omet.</p>
        {error && <Notice tone="red">{error}</Notice>}
        {!plan && !error && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Analitzant la cartera…</p>}
        {plan && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {Object.entries(L).filter(([k]) => plan[k] != null).map(([k, label]) => <li key={k} className="flex justify-between px-3 py-1.5"><span>{label}</span><b className="tnum">{plan[k].toLocaleString("ca-ES")}</b></li>)}
          </ul>
        )}
        {busy && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Important… pot trigar un parell de minuts.</p>}
        {result && <Notice tone="green">Importació feta: {result.clients} clients, {result.supplies} subministraments i {result.contracts} contractes.</Notice>}
      </div>
    </Modal>
  );
}
