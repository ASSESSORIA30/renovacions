"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseConfigured } from "@/data/browserSupabase";
import { AlarmClock, Bell, Check, FileText, Mail, MessageCircle, PanelRight, PhoneCall, ShieldAlert, Sunrise } from "lucide-react";
import { daysUntil, fmtDate, relDays, today } from "@/core/dates";
import { expiry } from "@/core/insights";
import { LEVEL_META, lastContactDays } from "@/core/priority";
import { titleCase } from "@/core/templates";
import type { Contract, Task } from "@/core/types";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, SupplierMark, cn } from "../components/ui";
import { useTheme } from "../components/Ambient";
import { assigneeKey, canAssignTasks, isStaff } from "@/core/roles";
import { addDays } from "@/core/dates";
import { matchesSearch } from "../selectors";

export function HoyView() {
  const { contracts, priority, snap, set, open, toggleTask } = useApp();
  const me = snap!.me;
  const staff = isStaff(me.role);
  const myKey = assigneeKey(me);
  const [who, setWho] = useState<string>(staff ? "" : myKey);
  const comerciales = useMemo(() => [...new Set(contracts.map((c) => c.comercial))].sort(), [contracts]);
  const plan = useMemo(() => {
    const ref = today();
    const mine = contracts.filter((c) => !who || !staff || c.comercial === who);
    const isOpen = (c: Contract) => c.crm.status === "pendiente" || c.crm.status === "contactado";
    const byScore = (a: Contract, b: Contract) => (priority[b.id]?.score ?? 0) - (priority[a.id]?.score ?? 0);
    const contactar = mine.filter((c) => c.crm.status === "pendiente" && !c.crm.ultimoContacto && (daysUntil(expiry(c), ref) ?? 999) <= 15).sort(byScore);
    const docsBy = new Set(snap!.docs.map((d) => d.contractId));
    const propuestas = mine.filter((c) => c.crm.status === "contactado" && !c.crm.propuestaEnviada && !docsBy.has(c.id)).sort(byScore);
    const tareas: (Task & { c?: Contract })[] = snap!.tasks
      .filter((t) => !t.done && t.due <= ref && (!who || t.assignee === who || (!staff && t.assignee === me.email.toLowerCase())))
      .map((t) => ({ ...t, c: t.contractId ? contracts.find((c) => c.id === t.contractId) : undefined }))
      .sort((a, b) => a.due.localeCompare(b.due));
    const esperando = mine.filter((c) => c.crm.status === "contactado" && c.crm.propuestaEnviada && (lastContactDays(c, ref) ?? 0) >= snap!.settings.seguimientoDias && !snap!.tasks.some((t) => t.contractId === c.id && !t.done)).sort(byScore);
    const riesgo = mine.filter((c) => isOpen(c) && (priority[c.id]?.factors.find((f) => f.key === "riesgo")?.value ?? 0) >= 0.5).sort(byScore);
    const alerts = snap!.settings.alertas.map((n) => ({ n, items: mine.filter((c) => isOpen(c) && daysUntil(expiry(c), ref) === n) }));
    return { contactar, propuestas, tareas, esperando, riesgo, alerts };
  }, [contracts, priority, snap, who]);

  const total = Math.min(plan.contactar.length, 5) + Math.min(plan.propuestas.length, 3) + plan.tareas.length + Math.min(plan.esperando.length, 4) + Math.min(plan.riesgo.length, 3);
  const theme = useTheme();
  const assigneeName = useAssigneeName();
  const ambient = useApp((s) => s.ambient);
  const hour = new Date().getHours();
  const hi = hour < 13 ? "Bon dia" : hour < 20 ? "Bona tarda" : "Bona nit";

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Sunrise className="text-pend" size={24} /> {hi}, {me.name}</h2>
          {ambient && <p className="mt-1 text-sm font-medium" style={{ color: theme.accent[0] }}>{theme.icon} {theme.greeting}</p>}
          <p className="mt-1 text-sm text-muted">{total ? `Avui tens ${total} accions recomanades, ordenades per prioritat.` : "Avui no hi ha accions urgents."}</p>
        </div>
        {staff && (
          <select className="input h-9 w-auto" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Comercial">
            <option value="">Tot l'equip</option>
            {comerciales.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </select>
        )}
      </div>
      <CrmTasksToday />

      {plan.alerts.some((a) => a.items.length) && (
        <div className="mt-5 flex flex-wrap gap-2">
          {plan.alerts.filter((a) => a.items.length).map((a) => (
            <button key={a.n} onClick={() => open(a.items[0].id)} className="pressable inline-flex items-center gap-2 rounded-full border border-pend/30 bg-pend/10 px-3 py-1.5 text-[12.5px] font-medium text-pend">
              <Bell size={13} /> {a.items.length} contracte(s) arriben avui a {a.n} dies del venciment
            </button>
          ))}
        </div>
      )}

      {canAssignTasks(me.role) && <AssignPanel />}
      <MyAssigned myKey={myKey} email={me.email.toLowerCase()} code={me.code} />

      <div className="mt-6 space-y-5">
        <Block icon={<PhoneCall size={16} />} tone="text-lost" title={`Contacta ${Math.min(plan.contactar.length, 5)} clients amb venciment imminent`} sub="Vencen en 15 dies o menys i ningú no els ha contactat des del CRM." empty="Tots els venciments imminents ja estan contactats.">
          {plan.contactar.slice(0, 5).map((c) => (
            <Row key={c.id} c={c} score={priority[c.id]?.score} level={priority[c.id]?.level}>
              <Button size="sm" variant="success" disabled={!c.telefono} onClick={() => set("composer", { contractId: c.id, channel: "whatsapp", templateId: (daysUntil(expiry(c)) ?? 99) <= 7 ? "t3" : "t1" })}><MessageCircle size={13} /> WhatsApp</Button>
              {c.telefono && <a href={`tel:${c.telefono}`} onClick={() => open(c.id, "comunicaciones")} className="pressable inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium hover:bg-elevated"><PhoneCall size={13} /> Truca</a>}
            </Row>
          ))}
        </Block>

        <Block icon={<FileText size={16} />} tone="text-brand" title={`Envia ${Math.min(plan.propuestas.length, 3)} propostes pendents`} sub="Clients contactats que encara no tenen proposta." empty="No hi ha propostes pendents.">
          {plan.propuestas.slice(0, 3).map((c) => (
            <Row key={c.id} c={c} score={priority[c.id]?.score} level={priority[c.id]?.level}>
              <Button size="sm" variant="primary" onClick={() => set("proposalFor", c.id)}><FileText size={13} /> Genera la proposta</Button>
            </Row>
          ))}
        </Block>

        <Block icon={<AlarmClock size={16} />} tone="text-violet-600 dark:text-violet-300" title={`Fes ${plan.tareas.length} seguiments`} sub="Tasques programades per a avui o endarrerides." empty="Avui no hi ha seguiments.">
          {plan.tareas.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
              <button aria-label="Completa" onClick={() => toggleTask(t.id)} className="pressable flex h-5 w-5 items-center justify-center rounded border border-ink/30 hover:border-ren hover:bg-ren/10"><Check size={12} className="text-ren opacity-0 hover:opacity-100" /></button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{t.title}</p>
                <p className="text-[11.5px] text-muted">{t.c ? titleCase(t.c.cliente) : "Sense contracte"} · <span className={cn(t.due < today() && "font-semibold text-lost")}>{t.due < today() ? `Endarrerida des del ${fmtDate(t.due)}` : "Avui"}</span> · {assigneeName(t.assignee)}</p>
              </div>
              {t.c && <Button size="sm" onClick={() => open(t.c!.id, "seguimiento")}><PanelRight size={13} /> Obre</Button>}
            </div>
          ))}
        </Block>

        <Block icon={<Mail size={16} />} tone="text-cont" title={`Fes ${Math.min(plan.esperando.length, 4)} seguiments de propostes sense resposta`} sub={`Proposta enviada fa ${snap!.settings.seguimientoDias} dies o més, sense tasca programada.`} empty="Cap proposta no espera resposta.">
          {plan.esperando.slice(0, 4).map((c) => (
            <Row key={c.id} c={c} score={priority[c.id]?.score} level={priority[c.id]?.level}>
              <Button size="sm" onClick={() => set("composer", { contractId: c.id, channel: "whatsapp", templateId: "t4" })}><MessageCircle size={13} /> Seguiment</Button>
            </Row>
          ))}
        </Block>

        <Block icon={<ShieldAlert size={16} />} tone="text-pend" title={`Revisa ${Math.min(plan.riesgo.length, 3)} renovacions amb risc de pèrdua`} sub="Senyals: venç aviat sense contacte, seguiment endarrerit o objeccions a les notes." empty="Cap renovació en risc.">
          {plan.riesgo.slice(0, 3).map((c) => (
            <Row key={c.id} c={c} score={priority[c.id]?.score} level={priority[c.id]?.level}>
              <Button size="sm" onClick={() => open(c.id)}><PanelRight size={13} /> Mostra l'anàlisi</Button>
            </Row>
          ))}
        </Block>
      </div>
    </div>
  );
}

function Block({ icon, title, sub, children, empty, tone }: { icon: React.ReactNode; title: string; sub: string; children: React.ReactNode; empty: string; tone: string }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section className="rounded-2xl border border-line bg-elevated/50 p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <span className={cn("mt-0.5", tone)}>{icon}</span>
        <div><h3 className="text-[15px] font-semibold">{title}</h3><p className="text-[12px] text-muted">{sub}</p></div>
      </div>
      <div className="space-y-2">{has ? children : <Empty icon={<Check size={18} />} title={empty} />}</div>
    </section>
  );
}

function Row({ c, children, score, level }: { c: Contract; children: React.ReactNode; score?: number; level?: keyof typeof LEVEL_META }) {
  const { open } = useApp();
  const d = daysUntil(expiry(c));
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
      <SupplierMark name={c.comercializadora} size={26} />
      <button className="min-w-0 flex-1 text-left" onClick={() => open(c.id)}>
        <p className="truncate text-[13px] font-medium hover:underline">{titleCase(c.cliente)}</p>
        <p className="truncate text-[11.5px] text-muted">{c.poblacion} · {c.tarifa} · {titleCase(c.comercial)}</p>
      </button>
      <Badge tone={d !== null && d <= 7 ? "red" : d !== null && d <= 30 ? "orange" : "zinc"}>{relDays(d)}</Badge>
      {score !== undefined && level && level !== "cerrado" && <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset tnum", LEVEL_META[level].cls)}>{score}</span>}
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}

function useAssigneeName() {
  const users = useApp((s) => s.snap!.users);
  return (k: string) => users.find((u) => assigneeKey(u) === k || u.code === k || u.email.toLowerCase() === k.toLowerCase())?.name ?? titleCase(k);
}

/** Tasks other people assigned to me (any date). */
function MyAssigned({ myKey, email, code }: { myKey: string; email: string; code: string | null }) {
  const { snap, toggleTask, open, contracts } = useApp();
  const me = snap!.me;
  const list = snap!.tasks
    .filter((t) => !t.done && (t.assignee === myKey || t.assignee === email || (!!code && t.assignee === code)) && t.createdBy !== me.name && t.due > today())
    .sort((a, b) => a.due.localeCompare(b.due));
  if (!list.length) return null;
  return (
    <section className="mt-5 rounded-2xl border border-cont/30 bg-cont/[0.05] p-4">
      <h3 className="text-[15px] font-semibold">Tasques que t'han assignat</h3>
      <p className="mb-3 text-[12px] text-muted">Pendents per als propers dies.</p>
      <div className="space-y-2">
        {list.map((t) => {
          const c = t.contractId ? contracts.find((x) => x.id === t.contractId) : undefined;
          return (
            <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
              <button aria-label="Completa" onClick={() => toggleTask(t.id)} className="pressable flex h-5 w-5 items-center justify-center rounded border border-ink/30 hover:border-ren hover:bg-ren/10"><Check size={12} className="text-ren opacity-0 hover:opacity-100" /></button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{t.title}</p>
                <p className="text-[11.5px] text-muted">{c ? titleCase(c.cliente) : "Tasca general"} · per al {fmtDate(t.due)} · assignada per {t.createdBy}</p>
              </div>
              {c && <Button size="sm" onClick={() => open(c.id, "seguimiento")}><PanelRight size={13} /> Obre</Button>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Admin and cap administrativa: assign tasks to anyone. */
function AssignPanel() {
  const { snap, saveTask, toggleTask, contracts, toast } = useApp();
  const name = useAssigneeName();
  const users = snap!.users;
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(users.find((u) => u.id !== snap!.me.id) ? assigneeKey(users.find((u) => u.id !== snap!.me.id)!) : assigneeKey(snap!.me));
  const [due, setDue] = useState(addDays(today(), 1));
  const [q, setQ] = useState("");
  const [contractId, setContractId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const results = useMemo(() => (q.length >= 2 && !contractId ? contracts.filter((c) => matchesSearch(c, q)).slice(0, 6) : []), [q, contracts, contractId]);
  const picked = contractId ? contracts.find((c) => c.id === contractId) : null;
  const assigned = snap!.tasks.filter((t) => !t.done && t.assignee !== assigneeKey(snap!.me)).sort((a, b) => a.due.localeCompare(b.due));
  const submit = async () => {
    await saveTask({ title: title.trim(), due, assignee, contractId, kind: "otro" });
    toast({ title: "Tasca assignada", body: `${title.trim()} → ${name(assignee)} (${fmtDate(due)})`, tone: "ok" });
    setTitle(""); setQ(""); setContractId(null);
  };
  return (
    <section className="mt-5 rounded-2xl border border-brand/30 bg-brand/[0.04] p-4">
      <h3 className="text-[15px] font-semibold">Assigna una tasca</h3>
      <p className="mb-3 text-[12px] text-muted">La persona la veurà a «El teu pla d'avui».</p>
      <div className="grid gap-2 sm:grid-cols-[2fr_1.2fr_1fr]">
        <input className="input" placeholder="Què cal fer? (p. ex. Trucar per revisar la tarifa)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignar a">
          {users.map((u) => <option key={u.id} value={assigneeKey(u)}>{u.name}{u.code ? ` (${u.code})` : ""}</option>)}
        </select>
        <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Data" />
      </div>
      <div className="relative mt-2 flex flex-wrap items-center gap-2">
        {picked ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12px]">Client: <b>{titleCase(picked.cliente)}</b><button className="text-muted hover:text-ink" onClick={() => { setContractId(null); setQ(""); }}>✕</button></span>
        ) : (
          <div className="relative w-full max-w-sm">
            <input className="input" placeholder="Client (opcional): cerca per nom, CUPS o NIF" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.length > 0 && (
              <ul className="absolute left-0 right-0 top-10 z-20 rounded-xl border border-line bg-surface p-1 shadow-lift">
                {results.map((c) => <li key={c.id}><button className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-ink/5" onClick={() => setContractId(c.id)}>{titleCase(c.cliente)} <span className="text-muted">· {c.poblacion}</span></button></li>)}
              </ul>
            )}
          </div>
        )}
        <Button className="ml-auto" variant="primary" disabled={!title.trim() || !assignee} onClick={submit}>Assigna</Button>
      </div>
      {assigned.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[12px] font-medium text-muted">Tasques obertes de l'equip ({assigned.length})</p>
          <ul className="space-y-1">
            {(showAll ? assigned : assigned.slice(0, 6)).map((t) => {
              const c = t.contractId ? contracts.find((x) => x.id === t.contractId) : undefined;
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px]">
                  <button aria-label="Completa" onClick={() => toggleTask(t.id)} className="pressable h-4 w-4 rounded border border-ink/30 hover:border-ren" />
                  <span className="min-w-0 flex-1 truncate">{t.title}{c ? <span className="text-muted"> · {titleCase(c.cliente)}</span> : null}</span>
                  <span className="text-[11.5px] text-muted">{name(t.assignee)}</span>
                  <span className={cn("text-[11.5px] tnum", t.due < today() ? "font-semibold text-lost" : "text-muted")}>{fmtDate(t.due)}</span>
                </li>
              );
            })}
          </ul>
          {assigned.length > 6 && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setShowAll(!showAll)}>{showAll ? "Mostra'n menys" : `Mostra-les totes (${assigned.length})`}</Button>}
        </div>
      )}
    </section>
  );
}

/** Tasques de seguiment dels clients del CRM (Clients 360°) assignades a l'usuari: vençudes i dels propers 7 dies. */
function CrmTasksToday() {
  const [tasks, setTasks] = useState<{ id: string; title: string; due_at: string | null; client_id: string | null; crm_clients: { name: string } | null }[] | null>(null);
  const load = () => fetch("/api/crm/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { tasks: [] })).then((j) => setTasks(j.tasks ?? [])).catch(() => setTasks([]));
  useEffect(() => { if (supabaseConfigured) void load(); }, []);
  const limit = new Date(Date.now() + 7 * 86400000).toISOString();
  const list = (tasks ?? []).filter((t) => !t.due_at || t.due_at <= limit).slice(0, 8);
  if (!list.length) return null;
  const done = async (id: string) => {
    await fetch("/api/crm/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity: "task", action: "complete", id }) });
    void load();
  };
  const now = new Date().toISOString();
  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
      <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><AlarmClock size={16} className="text-brand" /> Tasques de clients</h3>
      <ul className="divide-y divide-line">
        {list.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2 text-[13px]">
            <button aria-label={`Marca «${t.title}» com a feta`} onClick={() => done(t.id)} className="grid h-5 w-5 place-items-center rounded-full border border-line text-transparent hover:border-ren hover:text-ren"><Check size={12} /></button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.title}</p>
              {t.crm_clients?.name && t.client_id && <button className="text-[12px] text-brand hover:underline" onClick={() => useApp.getState().navigate("client", { id: t.client_id!, tab: "activitat" })}>{t.crm_clients.name}</button>}
            </div>
            <span className={cn("text-[12px]", t.due_at && t.due_at < now ? "font-medium text-lost" : "text-muted")}>{t.due_at ? new Date(t.due_at).toLocaleString("ca-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sense data"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
