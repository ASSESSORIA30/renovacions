"use client";
/**
 * EQUIPS COMERCIALS · gestió per a Direcció (Fase 8.1): crear equips, assignar el Cap d'equip, incorporar i retirar
 * comercials (amb historial), i assignar una cartera de clients a l'equip. Tot queda auditat al servidor (sec_audit).
 * Les excepcions de permisos (p. ex. «Comissions de l'equip») es concedeixen a «Usuaris i permisos».
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Plus, RefreshCw, ShieldCheck, UsersRound, X } from "lucide-react";
import { useApp } from "@/data/store";
import { Button, Modal, Notice, cn } from "../../components/ui";
import { Panel, PageHead, Skeleton, fdate } from "../consolidacio/shared";
import { teamsApi } from "./TeamPanel";

type L = {
  teams: { id: string; name: string; lead_id: string | null; active: boolean; notes: string | null }[];
  members: { id: string; team_id: string; user_id: string; joined_at: string; left_at: string | null; note: string | null }[];
  portfolio: { team_id: string; client_id: string; name: string; assigned_at: string }[];
  people: { id: string; name: string; role: string }[]; canEdit: boolean;
};

export function TeamsAdminView() {
  const go = useApp((s) => s.navigate);
  const [d, setD] = useState<L | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: string; name: string; lead_id: string | null; active: boolean; notes: string | null } | null>(null);
  const [hist, setHist] = useState(false);
  const load = useCallback(async () => { try { setD(await teamsApi.get<L>("list")); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async (action: string, data: unknown, ok: string) => {
    try { await teamsApi.act(action, data); setMsg(ok); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const name = useMemo(() => new Map((d?.people ?? []).map((p) => [p.id, p.name])), [d]);
  if (err) return <div className="mx-auto max-w-3xl px-4 py-8"><Notice tone="red">{err}</Notice></div>;
  const leads = (d?.people ?? []).filter((p) => p.role === "cap_equip");
  const sales = (d?.people ?? []).filter((p) => p.role === "comercial");
  const active = (d?.members ?? []).filter((m) => !m.left_at);
  const teamOf = (uid: string) => active.find((m) => m.user_id === uid)?.team_id ?? "";
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead icon={<UsersRound size={16} />} title="Equips comercials" sub="Cada equip té un Cap d'equip, que només veu els clients, contractes, leads, oportunitats i tasques dels seus comercials. Els canvis d'equip conserven l'historial i queden a l'auditoria." tone="from-indigo-600 to-sky-500">
        {d?.canEdit && <Button size="sm" variant="primary" onClick={() => setEdit({ name: "", lead_id: null, active: true, notes: null })}><Plus size={13} /> Nou equip</Button>}
        <Button size="sm" onClick={() => setHist(true)}><History size={13} /> Historial</Button>
        <Button size="sm" onClick={() => go("permisos")}><ShieldCheck size={13} /> Excepcions de permisos</Button>
        <Button size="sm" onClick={() => void load()}><RefreshCw size={13} /></Button>
      </PageHead>
      {msg && <Notice tone="blue">{msg}</Notice>}
      {!d ? <Skeleton rows={2} /> : (
        <>
          {!leads.length && <Notice tone="amber">Encara no hi ha cap usuari amb el rol «Cap d&apos;equip». Canvia el rol d&apos;una persona a «Accés i invitacions» i torna aquí.</Notice>}
          <div className="grid gap-3 lg:grid-cols-2">
            {d.teams.map((t) => {
              const mem = active.filter((m) => m.team_id === t.id);
              const port = d.portfolio.filter((p) => p.team_id === t.id);
              return (
                <Panel key={t.id} title={<span className={cn(!t.active && "text-muted line-through")}>{t.name}</span>} action={d.canEdit && <button className="text-[12px] text-brand" onClick={() => setEdit({ id: t.id, name: t.name, lead_id: t.lead_id, active: t.active, notes: t.notes })}>Edita</button>}>
                  <p className="text-[12.5px]"><span className="text-muted">Cap d&apos;equip:</span> <b>{t.lead_id ? name.get(t.lead_id) ?? "—" : "Sense assignar"}</b></p>
                  <p className="mt-2 text-[11.5px] font-medium uppercase tracking-wide text-muted">Comercials ({mem.length})</p>
                  <ul className="mt-1 divide-y divide-line">
                    {mem.map((m) => (
                      <li key={m.id} className="flex items-center justify-between py-1.5 text-[12.5px]">
                        <span>{name.get(m.user_id) ?? "—"} <span className="text-[11px] text-muted">des del {fdate(m.joined_at)}</span></span>
                        {d.canEdit && <button title="Retirar de l'equip" className="text-muted hover:text-red-600" onClick={() => void run("member_move", { userId: m.user_id, teamId: null }, "Comercial retirat de l'equip (historial conservat)")}><X size={14} /></button>}
                      </li>
                    ))}
                    {!mem.length && <li className="py-2 text-[12px] text-muted">Cap comercial</li>}
                  </ul>
                  <p className="mt-3 text-[11.5px] font-medium uppercase tracking-wide text-muted">Cartera assignada a l&apos;equip ({port.length})</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">{port.map((p) => <li key={p.client_id} className="flex items-center gap-1 rounded-full bg-ink/[0.05] px-2 py-0.5 text-[11.5px]"><button onClick={() => go("client", { id: p.client_id })}>{p.name}</button>{d.canEdit && <button aria-label="Retirar" onClick={() => void run("portfolio", { teamId: t.id, clientId: p.client_id, op: "remove" }, "Client retirat de la cartera")}><X size={11} /></button>}</li>)}</ul>
                  {d.canEdit && <ClientPicker onPick={(id) => void run("portfolio", { teamId: t.id, clientId: id, op: "add" }, "Client afegit a la cartera de l'equip")} />}
                </Panel>
              );
            })}
            {!d.teams.length && <Panel title="Cap equip" empty="Crea el primer equip comercial." />}
          </div>
          <Panel title="Assignació de comercials" action={<span className="text-[11.5px] text-muted">Un comercial només pot ser a un equip</span>}>
            <ul className="divide-y divide-line">
              {sales.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                  <span>{p.name}</span>
                  <select disabled={!d.canEdit} aria-label={`Equip de ${p.name}`} className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px]" value={teamOf(p.id)} onChange={(e) => void run("member_move", { userId: p.id, teamId: e.target.value || null }, "Canvi d'equip registrat")}>
                    <option value="">Sense equip</option>
                    {d.teams.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Editar equip" : "Nou equip"} footer={<><Button onClick={() => setEdit(null)}>Cancel·la</Button><Button variant="primary" disabled={!edit?.name.trim()} onClick={async () => { if (edit) { await run("team_save", edit, "Equip desat"); setEdit(null); } }}>Desa</Button></>}>
        {edit && (
          <div className="space-y-3 text-[13px]">
            <label className="block">Nom<input className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={120} /></label>
            <label className="block">Cap d&apos;equip<select className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" value={edit.lead_id ?? ""} onChange={(e) => setEdit({ ...edit, lead_id: e.target.value || null })}><option value="">Sense assignar</option>{leads.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Equip actiu</label>
            <label className="block">Notes<textarea className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5" rows={2} value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value || null })} /></label>
          </div>
        )}
      </Modal>
      <Modal open={hist} onClose={() => setHist(false)} title="Historial d'equips" width="max-w-2xl">
        <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto text-[12.5px]">
          {(d?.members ?? []).map((m) => <li key={m.id} className="flex justify-between gap-2 py-1.5"><span>{name.get(m.user_id) ?? "—"} → <b>{d?.teams.find((t) => t.id === m.team_id)?.name ?? "—"}</b>{m.note ? <span className="text-muted"> · {m.note}</span> : null}</span><span className="text-muted tnum">{fdate(m.joined_at)} – {m.left_at ? fdate(m.left_at) : "actual"}</span></li>)}
        </ul>
      </Modal>
    </div>
  );
}

function ClientPicker({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 3) { setRows([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/crm/search?q=${encodeURIComponent(q.trim())}&limit=8`, { cache: "no-store" });
        const j = (await r.json()) as { results?: { kind: string; id: string; title: string }[] };
        setRows((j.results ?? []).filter((x) => x.kind === "client").map((x) => ({ id: x.id, name: x.title })).slice(0, 8));
      } catch { setRows([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative mt-2">
      <input className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-[12px]" placeholder="Afegir client a la cartera (cerca per nom o NIF)…" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length > 0 && <ul className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">{rows.map((r) => <li key={r.id}><button className="w-full px-2 py-1.5 text-left text-[12px] hover:bg-ink/[0.04]" onClick={() => { onPick(r.id); setQ(""); setRows([]); }}>{r.name}</button></li>)}</ul>}
    </div>
  );
}
