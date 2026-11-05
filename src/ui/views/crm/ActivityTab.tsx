"use client";
/** Pestanya ACTIVITAT: registre de notes, trucades, reunions…, tasques de seguiment i historial de canvis. */
import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Circle, FileText, History, ListTodo, Loader2, Mail, MessageCircle, MessagesSquare, Pencil, Phone, Plus, RotateCcw, Sparkles, StickyNote, Users, X } from "lucide-react";
import { ACTIVITY_LABEL, DELIVERY_LABEL, MANUAL_ACTIVITY_TYPES, type ActivityType, type CrmActivity, type CrmAuditEvent, type CrmTask } from "@/core/crm";
import { fmtDateTime } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, cn } from "../../components/ui";
import { crmApi } from "./api";
import { Section, type Ctx } from "./ClientDetail";

const ICON: Record<ActivityType, typeof Phone> = { nota: StickyNote, trucada: Phone, reunio: Users, email: Mail, whatsapp: MessageCircle, tasca: ListTodo, seguiment: CalendarClock, proposta: Sparkles, canvi: History, document: FileText };
const FIELD: Record<string, string> = {
  name: "nom", trade_name: "nom comercial", tax_id: "NIF/CIF", kind: "tipus", status: "estat", phone: "telèfon", phone2: "telèfon 2", email: "correu", address: "adreça", postal_code: "codi postal", city: "municipi", province: "província",
  owner_id: "comercial", collaborator_id: "col·laborador", tags: "etiquetes", priority: "prioritat", next_follow_up: "proper seguiment", notes: "observacions", sector: "sector", origin: "origen", contact_name: "contacte",
  end_date: "data de finalització", start_date: "data d'inici", signed_at: "data de signatura", retailer: "comercialitzadora", product: "producte", category: "categoria", title: "títol", archived_at: "arxiu", current_contract_id: "contracte actual", version: "versió",
};
const ENTITY: Record<string, string> = { clients: "Client", contacts: "Contacte", supplies: "Subministrament", contracts: "Contracte", documents: "Document", client_assignments: "Accés compartit", incidents: "Incidència" };
const ACTION: Record<string, string> = { insert: "creat", update: "modificat", delete: "eliminat", download: "descarregat", view: "consultat", upload: "pujat", "upload-version": "versió nova", reclassify: "reclassificat" };
const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

type Item = { kind: "act"; at: string; a: CrmActivity } | { kind: "audit"; at: string; e: CrmAuditEvent };

export function ActivityTab({ ctx }: { ctx: Ctx }) {
  const { d, reload } = ctx;
  const [type, setType] = useState<ActivityType>("trucada");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [at, setAt] = useState(localInput());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"tot" | "activitat" | "canvis">("activitat");
  const [taskForm, setTaskForm] = useState(false);
  const [editAct, setEditAct] = useState<CrmActivity | null>(null);
  const me = useApp((s) => s.snap!.me);
  const toast = useApp((s) => s.toast);

  const add = async () => {
    setBusy(true); setErr(null);
    try {
      await crmApi.action({ entity: "activity", action: "create", clientId: d.client.id, data: { type, title: title.trim() || `${ACTIVITY_LABEL[type]}`, body: body || null, at: new Date(at).toISOString(), delivery: type === "email" || type === "whatsapp" ? "registrat" : null } });
      setTitle(""); setBody(""); setAt(localInput());
      toast({ title: `${ACTIVITY_LABEL[type]} registrada`, tone: "ok" });
      await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const taskAct = async (t: CrmTask, action: "complete" | "reopen" | "cancel") => {
    try { await crmApi.action({ entity: "task", action, clientId: d.client.id, id: t.id }); await reload(); } catch (e) { toast({ title: "No s'ha pogut fer", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };

  const items = useMemo<Item[]>(() => {
    const acts: Item[] = d.activities.map((a) => ({ kind: "act", at: a.at, a }));
    const audit: Item[] = d.audit.filter((e) => !(e.entity === "clients" && e.action === "insert")).map((e) => ({ kind: "audit", at: e.at, e }));
    const list = filter === "activitat" ? acts : filter === "canvis" ? audit : [...acts, ...audit];
    return list.sort((x, y) => y.at.localeCompare(x.at));
  }, [d.activities, d.audit, filter]);
  const pending = d.tasks.filter((t) => t.status === "pendent");
  const done = d.tasks.filter((t) => t.status !== "pendent").slice(0, 10);
  const now = new Date().toISOString();

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section title="Registra una activitat">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipus d'activitat">
            {MANUAL_ACTIVITY_TYPES.map((t) => {
              const Icon = ICON[t];
              return <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn("pressable inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px]", type === t ? "border-brand bg-brand/[0.06] text-brand" : "border-line text-muted hover:text-ink")}><Icon size={13} /> {ACTIVITY_LABEL[t]}</button>;
            })}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_200px]">
            <input className="input" placeholder={type === "trucada" ? "Resum: p. ex. «Interessat en revisar potència»" : "Títol"} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Títol" />
            <input className="input" type="datetime-local" value={at} max={localInput(new Date(Date.now() + 86400000 * 365))} onChange={(e) => setAt(e.target.value)} aria-label="Data i hora" />
          </div>
          <textarea className="input mt-2 min-h-[80px]" placeholder="Detalls (opcional)" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Detalls" />
          {(type === "email" || type === "whatsapp") && <p className="mt-1.5 text-[11.5px] text-muted">Es registra com a <b>enviat a mà</b>. Només els correus enviats per la plataforma consten com a «enviament confirmat».</p>}
          {err && <p className="mt-2 text-[12.5px] text-lost">{err}</p>}
          <div className="mt-2 flex justify-end"><Button variant="primary" disabled={busy || (!title.trim() && !body.trim())} onClick={add}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Registra</Button></div>
        </Section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Historial</h3>
            <div className="flex rounded-xl border border-line p-0.5 text-[12px]">
              {(["activitat", "canvis", "tot"] as const).map((k) => <button key={k} onClick={() => setFilter(k)} className={cn("rounded-lg px-2.5 py-1", filter === k ? "bg-ink/[0.07] font-medium" : "text-muted")}>{k === "activitat" ? "Activitat" : k === "canvis" ? "Canvis i accessos" : "Tot"}</button>)}
            </div>
          </div>
          {items.length === 0 ? <Empty icon={<MessagesSquare size={22} />} title="Encara no hi ha res a l'historial" /> : (
            <ol className="relative space-y-0 border-l border-line pl-5">
              {items.map((it) => it.kind === "act" ? (
                <li key={`a-${it.a.id}`} className="relative pb-4">
                  <span className="absolute -left-[29px] grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-muted">{(() => { const I = ICON[it.a.type]; return <I size={12} />; })()}</span>
                  <div className="rounded-xl border border-line bg-surface px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <span className="font-medium">{it.a.title}</span>
                      <Badge>{ACTIVITY_LABEL[it.a.type]}</Badge>
                      {it.a.delivery && <Badge tone={it.a.delivery === "enviat" ? "green" : it.a.delivery === "error" ? "red" : it.a.delivery === "intent" ? "amber" : "zinc"}>{DELIVERY_LABEL[it.a.delivery]}</Badge>}
                      {it.a.user_id === me.id && !["canvi", "document", "tasca"].includes(it.a.type) && <button aria-label="Edita" className="ml-auto text-muted hover:text-ink" onClick={() => setEditAct(it.a)}><Pencil size={12} /></button>}
                    </div>
                    {it.a.body && <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-muted">{it.a.body}</p>}
                    <p className="mt-1 text-[11px] text-muted">{fmtDateTime(it.a.at)}{it.a.user_name ? ` · ${it.a.user_name}` : ""}</p>
                  </div>
                </li>
              ) : (
                <li key={`e-${it.e.id}`} className="relative pb-3">
                  <span className="absolute -left-[25px] top-1 h-3.5 w-3.5 rounded-full border border-line bg-elevated" />
                  <p className="text-[12px] text-muted">
                    <b className="font-medium text-ink">{ENTITY[it.e.entity] ?? it.e.entity}</b> {ACTION[it.e.action] ?? it.e.action}
                    {it.e.fields?.length ? `: ${it.e.fields.map((f) => FIELD[f] ?? f).join(", ")}` : ""}
                    {" · "}{fmtDateTime(it.e.at)}{it.e.user_name ? ` · ${it.e.user_name}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <Section title={`Tasques pendents (${pending.length})`} action={<Button size="sm" onClick={() => setTaskForm(true)}><Plus size={13} /> Tasca</Button>}>
          {pending.length === 0 ? <p className="text-[12.5px] text-muted">Cap tasca pendent.</p> : (
            <ul className="space-y-1.5">
              {pending.map((t) => (
                <li key={t.id} className="flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-ink/[0.03]">
                  <button aria-label={`Marca «${t.title}» com a feta`} onClick={() => taskAct(t, "complete")} className="mt-0.5 text-muted hover:text-ren"><Circle size={16} /></button>
                  <div className="min-w-0 flex-1 text-[12.5px]">
                    <p className="font-medium">{t.title}</p>
                    <p className={cn("text-[11px]", t.due_at && t.due_at < now ? "font-medium text-lost" : "text-muted")}>{t.due_at ? fmtDateTime(t.due_at) : "Sense data"}{t.assigned_name ? ` · ${t.assigned_name}` : ""}</p>
                    {t.notes && <p className="text-[11.5px] text-muted">{t.notes}</p>}
                  </div>
                  <button aria-label="Cancel·la la tasca" title="Cancel·la" onClick={() => taskAct(t, "cancel")} className="text-muted hover:text-lost"><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <details className="mt-3 border-t border-line pt-2 text-[12px]">
              <summary className="cursor-pointer text-muted">Fetes o cancel·lades ({done.length})</summary>
              <ul className="mt-1.5 space-y-1">
                {done.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-muted">
                    <CheckCircle2 size={13} className={t.status === "feta" ? "text-ren" : ""} /> <span className={cn("flex-1 truncate", t.status === "cancellada" && "line-through")}>{t.title}</span>
                    <button aria-label="Reobre" onClick={() => taskAct(t, "reopen")} className="hover:text-ink"><RotateCcw size={12} /></button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>
      </div>
      {taskForm && <TaskForm ctx={ctx} onClose={() => setTaskForm(false)} onSaved={() => { setTaskForm(false); void reload(); }} />}
      {editAct && <ActivityEdit ctx={ctx} a={editAct} onClose={() => setEditAct(null)} onSaved={() => { setEditAct(null); void reload(); }} />}
    </div>
  );
}

function TaskForm({ ctx, onClose, onSaved }: { ctx: Ctx; onClose: () => void; onSaved: () => void }) {
  const { d, facets } = ctx;
  const me = useApp((s) => s.snap!.me);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
  const [f, setF] = useState({ title: "", notes: "", due: localInput(tomorrow), assigned_to: me.id, contract_id: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const people = (facets?.users ?? []).filter((u) => u.id === me.id || d.permissions.isStaff || d.permissions.canEdit);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await crmApi.action({ entity: "task", action: "create", clientId: d.client.id, data: { title: f.title, notes: f.notes || null, due_at: f.due ? new Date(f.due).toISOString() : null, assigned_to: f.assigned_to || null, contract_id: f.contract_id || null } }); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Nova tasca de seguiment" footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !f.title.trim()} onClick={save}>Crea la tasca</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Què cal fer? *</span><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Trucar per confirmar la proposta" /></label>
        <label className="block"><span className="label">Venciment</span><input type="datetime-local" className="input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
        <label className="block"><span className="label">Responsable</span><select className="input" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}>{people.length ? people.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? " (jo)" : ""}</option>) : <option value={me.id}>{me.name}</option>}</select></label>
        <label className="block sm:col-span-2"><span className="label">Contracte relacionat</span><select className="input" value={f.contract_id} onChange={(e) => setF({ ...f, contract_id: e.target.value })}><option value="">—</option>{d.contracts.map((k) => <option key={k.id} value={k.id}>{k.retailer}{k.product ? ` · ${k.product}` : ""}</option>)}</select></label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><textarea className="input min-h-[60px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <p className="text-[11.5px] text-muted sm:col-span-2">El proper seguiment del client s&apos;actualitza amb la data més pròxima.</p>
        {err && <p className="text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
    </Modal>
  );
}

function ActivityEdit({ ctx, a, onClose, onSaved }: { ctx: Ctx; a: CrmActivity; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(a.title);
  const [body, setBody] = useState(a.body ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await crmApi.action({ entity: "activity", action: "update", clientId: ctx.d.client.id, id: a.id, data: { type: a.type, title, body: body || null, at: a.at, delivery: a.delivery === "enviat" ? null : a.delivery } }); onSaved(); }
    catch (e) { useApp.getState().toast({ title: "No s'ha pogut desar", body: String(e instanceof Error ? e.message : e), tone: "err" }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Edita · ${ACTIVITY_LABEL[a.type]}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !title.trim()} onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px]">
        <label className="block"><span className="label">Títol</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block"><span className="label">Detalls</span><textarea className="input min-h-[90px]" value={body} onChange={(e) => setBody(e.target.value)} /></label>
      </div>
    </Modal>
  );
}
