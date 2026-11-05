"use client";
import { AgendaQuickActions, CONTRACT_ACTIONS, LinkedAgenda } from "../views/agenda/Linked";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot, CalendarPlus, Check, CheckCircle2, Copy, FileText, Mail, MessageCircle, NotebookPen, Phone, PhoneCall, Send, Sparkles, X,
} from "lucide-react";
import { addDays, daysUntil, fmtDate, fmtDateTime, relDays, today } from "@/core/dates";
import { expiry, ruleAnalysis } from "@/core/insights";
import { LEVEL_META, consumption } from "@/core/priority";
import { titleCase } from "@/core/templates";
import type { Activity, Contract, Status } from "@/core/types";
import { useApp } from "@/data/store";
import { Badge, Button, EASE_DRAWER, EASE_OUT, Empty, Field, Notice, SupplierMark, Tabs, cn } from "./ui";
import { STATUS_META } from "../selectors";
import { useSips, useSipsIndex } from "../useSips";
import { fmtMWh, hasSipsCups } from "@/core/sips";
import { Activity as ActivityIcon, FileSignature, Zap as ZapIcon } from "lucide-react";
import { assigneeKey, canAssignTasks } from "@/core/roles";
import { ErrorBoundary } from "./ErrorBoundary";
import { RenewalDocuments } from "./RenewalDocuments";
import { CupsLink, RenewalClientLink, recordRecent } from "./Navigation";
import { RelatedAlert, RelatedIndicator } from "./groups/RelatedPanel";

const TABS = [
  { id: "resumen", label: "Resum" },
  { id: "energia", label: "Energia" },
  { id: "renovacion", label: "Renovació" },
  { id: "comunicaciones", label: "Comunicacions" },
  { id: "documentos", label: "Documents" },
  { id: "seguimiento", label: "Seguiment" },
  { id: "historial", label: "Historial" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function ContractDrawer() {
  const { openId, byId, open, drawerTab, set } = useApp();
  const c = openId ? byId[openId] : null;
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && !useApp.getState().composer && !useApp.getState().proposalFor && open(null);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
  return (
    <AnimatePresence>
      {c && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-40 bg-black/20 lg:bg-black/10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={() => open(null)} />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-label={`Fitxa de ${c.cliente}`}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-lift sm:w-[560px]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.38, ease: EASE_DRAWER }}
          >
            <ErrorBoundary label="Fitxa del client" resetKey={c.id}><DrawerBody c={c} tab={drawerTab as TabId} setTab={(t) => set("drawerTab", t)} /></ErrorBoundary>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerBody({ c, tab, setTab }: { c: Contract; tab: TabId; setTab: (t: TabId) => void }) {
  const { open, set, priority } = useApp();
  const acts = useApp((s) => s.snap!.activities);
  const tasks = useApp((s) => s.snap!.tasks);
  const docs = useApp((s) => s.snap!.docs);
  const own = useMemo(() => ({ acts: acts.filter((a) => a.contractId === c.id), tasks: tasks.filter((t) => t.contractId === c.id), docs: docs.filter((d) => d.contractId === c.id) }), [acts, tasks, docs, c.id]);
  const pr = priority[c.id];
  const d = daysUntil(expiry(c));
  const meta = STATUS_META[c.crm.status];
  const phone = c.crm.telefonoOverride ?? c.telefono;
  const email = c.crm.emailOverride ?? c.email;
  useEffect(() => { recordRecent({ kind: "contracte", ref: c.id, label: titleCase(c.cliente), sub: [c.comercializadora, c.poblacion].filter(Boolean).join(" · ") || null }); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header className="border-b border-line px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <SupplierMark name={c.comercializadora} size={36} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold leading-tight"><RenewalClientLink renewalId={c.id} cups={c.cups} name={titleCase(c.cliente)} /></h2>
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted">{c.cif && <span className="shrink-0">{c.cif}{c.cups ? " ·" : ""}</span>}{c.cups && <CupsLink cups={c.cups} className="min-w-0" />}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-medium" style={{ background: meta.soft, color: meta.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />{meta.label}
              </span>
              {pr && pr.level !== "cerrado" && <span className={cn("rounded-md px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset", LEVEL_META[pr.level].cls)}>Prioritat {LEVEL_META[pr.level].label.toLowerCase()} · {pr.score}</span>}
              <Badge tone={d !== null && d <= 7 ? "red" : d !== null && d <= 30 ? "orange" : "zinc"}>{relDays(d)}</Badge>
              <RelatedIndicator target={{ contractId: c.id }} className="py-0.5 text-[11.5px]" />
            </div>
            <RelatedAlert contractId={c.id} />
          </div>
          <button aria-label="Tanca la fitxa" onClick={() => open(null)} className="pressable rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink"><X size={18} /></button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <QuickAction icon={<MessageCircle size={15} />} label="WhatsApp" disabled={!phone} onClick={() => set("composer", { contractId: c.id, channel: "whatsapp" })} />
          <QuickAction icon={<Mail size={15} />} label="Correu" disabled={!email} onClick={() => set("composer", { contractId: c.id, channel: "email" })} />
          <QuickAction icon={<PhoneCall size={15} />} label="Trucada" disabled={!phone} onClick={() => setTab("comunicaciones")} />
          <QuickAction icon={<FileText size={15} />} label="Proposta" onClick={() => set("proposalFor", c.id)} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Accions ràpides">
          {c.cups && <Chip onClick={() => useApp.getState().openSupply(c.cups)}>Punt de subministrament</Chip>}
          {c.cups && c.tipo !== "gas" && <Chip onClick={() => useApp.getState().analyzeCups(c.cups!, c.id)}>Consultar SIPS</Chip>}
          <Chip onClick={() => useApp.getState().navigate("comparativa", { contract: c.id })}>Fer comparativa</Chip>
          <Chip onClick={() => setTab("seguimiento")}>Crear tasca</Chip>
          <Chip onClick={() => setTab("documentos")}>Documents</Chip>
        </div>
        <div className="mt-1.5"><AgendaQuickActions compact actions={CONTRACT_ACTIONS(titleCase(c.cliente))} base={{ renewal_id: c.id, location: [c.direccion, c.poblacion].filter(Boolean).join(", "), context: titleCase(c.cliente) }} /></div>
        <div className="mt-3"><Tabs value={tab} onChange={setTab} items={TABS.map((t) => ({ ...t, count: t.id === "comunicaciones" ? own.acts.filter((a) => ["whatsapp", "email", "call", "note"].includes(a.type)).length || undefined : t.id === "seguimiento" ? own.tasks.filter((x) => !x.done).length || undefined : t.id === "documentos" ? own.docs.length || undefined : undefined }))} /></div>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: EASE_OUT }}>
            {/* Cada pestanya va protegida: un error en una pestanya no fa caure la fitxa ni el CRM. */}
            <ErrorBoundary label={TABS.find((t) => t.id === tab)?.label ?? "Pestanya"} resetKey={`${c.id}:${tab}`}>
              {tab === "resumen" && <Resumen c={c} {...own} />}
              {tab === "energia" && <Energia c={c} />}
              {tab === "renovacion" && <Renovacion c={c} />}
              {tab === "comunicaciones" && <Comunicaciones c={c} acts={own.acts} />}
              {tab === "documentos" && <Documentos c={c} />}
              {tab === "seguimiento" && <Seguimiento c={c} />}
              {tab === "historial" && <Historial acts={own.acts} c={c} />}
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </div>
      <StatusBar c={c} />
    </>
  );
}

function QuickAction({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} title={disabled ? "Falta la dada de contacte" : label}
      className="pressable flex flex-col items-center gap-1 rounded-lg border border-line bg-elevated py-2 text-[11.5px] font-medium text-ink/80 hover:border-ink/20 hover:text-ink disabled:opacity-35">
      {icon}{label}
    </button>
  );
}

function StatusBar({ c }: { c: Contract }) {
  const { move, set } = useApp();
  const opts: Status[] = ["pendiente", "contactado", "renovado", "no_renueva"];
  return (
    <div className="flex gap-1.5 border-t border-line bg-elevated px-5 py-3">
      {opts.map((s) => {
        const active = c.crm.status === s;
        return (
          <button key={s} disabled={active}
            onClick={() => (s === "renovado" || s === "no_renueva" ? set("closeDialog", { contractId: c.id, to: s }) : move(c.id, s))}
            className={cn("pressable flex-1 rounded-lg border px-2 py-2 text-[12px] font-medium", active ? "cursor-default border-transparent text-white" : "border-line bg-surface text-ink/80 hover:border-ink/25")}
            style={active ? { background: STATUS_META[s].color } : {}}>
            {active && <Check size={12} className="-mt-0.5 mr-1 inline" />}{STATUS_META[s].label.replace(" de renovar", "")}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Resumen (AI analysis)
function Resumen({ c, acts, tasks, docs }: { c: Contract; acts: Activity[]; tasks: import("@/core/types").Task[]; docs: import("@/core/types").ProposalDoc[] }) {
  const { priority, integrations, repo, snap } = useApp();
  const pr = priority[c.id];
  const a = useMemo(() => ruleAnalysis(c, pr, acts, tasks, docs, snap!.offers), [c, pr, acts, tasks, docs, snap]);
  const phone = c.crm.telefonoOverride ?? c.telefono;
  const email = c.crm.emailOverride ?? c.email;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-brand/25 bg-brand/[0.05] p-3.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-brand"><Sparkles size={14} /> Anàlisi del contracte</div>
        <p className="text-[13.5px] leading-relaxed">{a.summary}</p>
        <ul className="mt-2.5 space-y-1 text-[12.5px] text-ink/80">
          {a.facts.map((f, i) => <li key={i} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink/40" />{f}</li>)}
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-surface px-2.5 py-2"><div className="text-muted">Risc de pèrdua</div><div className="font-semibold">{a.risk}</div></div>
          <div className="rounded-lg bg-surface px-2.5 py-2"><div className="text-muted">Propera acció</div><div className="font-semibold leading-snug">{a.next}</div></div>
        </div>
        <p className="mt-2 text-[11px] text-muted">Generat a partir de les dades registrades, sense IA.</p>
      </section>

      {pr && pr.level !== "cerrado" && (
        <details className="group rounded-xl border border-line p-3">
          <summary className="cursor-pointer list-none text-[13px] font-medium">Per què té prioritat {pr.score}/100 <span className="text-muted">· veure el detall</span></summary>
          <div className="mt-2 space-y-1.5">
            {pr.factors.map((f) => (
              <div key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-[12px]">
                <div><span className="font-medium">{f.label}</span> <span className="text-muted">— {f.reason}</span></div>
                <span className="tnum font-semibold">+{f.points.toFixed(0)}</span>
                <div className="col-span-2 h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand" style={{ width: `${f.value * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </details>
      )}

      <AiAssistant c={c} enabled={integrations.ai} ask={repo?.ai} context={{ analysis: a, priority: pr }} />

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Recordatoris i cites del contracte</h3>
        <LinkedAgenda filter={{ renewal: c.id }} empty="Cap recordatori ni cita programats per a aquest contracte." />
      </section>
      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Informació general</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
          <Item k="Titular" v={c.cliente} node={<RenewalClientLink renewalId={c.id} cups={c.cups} name={c.cliente} />} />
          <Item k="NIF/CIF" v={c.cif} copy />
          <Item k="Adreça" v={[c.direccion, c.cp, c.poblacion, c.provincia].filter(Boolean).join(", ")} wide />
          <Item k="CUPS" v={c.cups} node={c.cups ? <CupsLink cups={c.cups} /> : undefined} copy wide mono />
          <ContactEdit c={c} field="telefono" value={phone} />
          <ContactEdit c={c} field="email" value={email} />
          <Item k="Comercial" v={titleCase(c.comercial)} />
          <Item k="Captat per" v={c.captador ? titleCase(c.captador) : c.colaborador} />
          {c.colaborador && <Item k="Propietari de l’Excel" v={c.colaborador} />}
          {c.colaborador && <Item k="Col·laborador vinculat" v={c.colaboradorLinkStatus === "vinculat"
            ? c.colaboradorPartnerName ?? "Vinculat"
            : c.colaboradorLinkStatus === "ambigu" ? "Pendent: correu duplicat"
            : "Pendent de vincular per email"} />}

          {c.representante && <Item k="Representant" v={titleCase(c.representante)} />}
        </dl>
      </section>
      {(c.comentarioLlamada || c.observaciones || c.comentario) && (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold">Notes de l'origen</h3>
          <div className="space-y-1.5 text-[12.5px]">
            {c.comentarioLlamada && <p className="rounded-lg bg-elevated px-3 py-2"><span className="text-muted">Trucada: </span>{c.comentarioLlamada}</p>}
            {c.observaciones && <p className="rounded-lg bg-elevated px-3 py-2"><span className="text-muted">Observacions: </span>{c.observaciones}</p>}
            {c.comentario && <p className="rounded-lg bg-elevated px-3 py-2"><span className="text-muted">Comentari: </span>{c.comentario}</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="pressable rounded-full border border-line px-2.5 py-1 text-[11.5px] font-medium text-muted hover:border-brand/40 hover:text-brand">{children}</button>;
}

function Item({ k, v, wide, copy, mono, node }: { k: string; v?: string | number | null; wide?: boolean; copy?: boolean; mono?: boolean; node?: React.ReactNode }) {
  const [ok, setOk] = useState(false);
  return (
    <div className={cn(wide && "col-span-2")}>
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className={cn("flex items-center gap-1 break-words font-medium", mono && "font-mono text-[12px]")}>
        {node ?? v ?? <span className="font-normal text-muted">—</span>}
        {copy && v && (
          <button aria-label={`Copia ${k}`} className="pressable rounded p-0.5 text-muted hover:text-ink" onClick={() => { navigator.clipboard?.writeText(String(v)); setOk(true); setTimeout(() => setOk(false), 1200); }}>
            {ok ? <Check size={12} className="text-ren" /> : <Copy size={12} />}
          </button>
        )}
      </dd>
    </div>
  );
}

function ContactEdit({ c, field, value }: { c: Contract; field: "telefono" | "email"; value: string | null }) {
  const { patchCrm } = useApp();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value ?? "");
  const save = async () => {
    setEdit(false);
    if ((v || null) === value) return;
    await patchCrm(c.id, field === "telefono" ? { telefonoOverride: v || null } : { emailOverride: v || null }, { type: "note", title: `${field === "telefono" ? "Telèfon" : "Correu"} actualitzat`, body: `${value ?? "—"} → ${v || "—"}` });
  };
  return (
    <div>
      <dt className="text-[11px] text-muted">{field === "telefono" ? "Telèfon" : "Correu"}</dt>
      {edit ? (
        <input autoFocus className="input mt-0.5 h-8 py-1" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} />
      ) : (
        <dd className="flex items-center gap-1 font-medium">
          {value ? (field === "telefono" ? <a className="hover:underline" href={`tel:${value}`}>{value}</a> : <a className="truncate hover:underline" href={`mailto:${value}`}>{value}</a>) : <span className="font-normal text-muted">—</span>}
          <button className="text-[11px] font-normal text-muted hover:text-ink" onClick={() => setEdit(true)}>edita</button>
        </dd>
      )}
    </div>
  );
}

function AiAssistant({ c, enabled, ask, context }: { c: Contract; enabled: boolean; ask?: (p: import("@/data/repo").AiPayload) => Promise<string>; context: unknown }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const SUGGESTIONS = ["Què li hauria d'oferir a aquest client?", "Quan l'hauria de contactar?", "Quin estalvi li podem presentar?", "Quins arguments puc fer servir?", "Per què podria rebutjar la renovació?", "Quin missatge li envio per recuperar-lo?"];
  const send = async (question: string) => {
    if (!ask || !question.trim()) return;
    setBusy(true);
    setQ("");
    try {
      const a = await ask({ kind: "chat", contractId: c.id, question, context });
      setLog((l) => [...l, { q: question, a }]);
    } catch (e) {
      setLog((l) => [...l, { q: question, a: `No s'ha pogut obtenir resposta: ${e instanceof Error ? e.message : e}` }]);
    } finally { setBusy(false); }
  };
  return (
    <section className="rounded-xl border border-line">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium">
        <Bot size={15} className="text-brand" /> Assistent comercial IA
        <span className="ml-auto text-[11px] font-normal text-muted">{enabled ? "Pregunta" : "No configurat"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          {!enabled && <Notice>L'assistent no està actiu: necessita Supabase (inici de sessió) i <code>ANTHROPIC_API_KEY</code> a Vercel. Mira què falta a Configuració → Integracions. Mentrestant, l'anàlisi de dalt es calcula amb regles a partir de les dades reals.</Notice>}
          {log.map((m, i) => (
            <div key={i} className="space-y-1 text-[12.5px]">
              <p className="font-medium">{m.q}</p>
              <p className="whitespace-pre-wrap rounded-lg bg-elevated px-3 py-2 leading-relaxed">{m.a}</p>
            </div>
          ))}
          <div className="flex flex-wrap gap-1">
            {SUGGESTIONS.map((s) => <button key={s} disabled={!enabled || busy} onClick={() => send(s)} className="pressable rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink/80 hover:border-ink/25 disabled:opacity-40">{s}</button>)}
          </div>
          <div className="flex gap-2">
            <input className="input" placeholder="Pregunta sobre aquest client…" disabled={!enabled || busy} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(q)} />
            <Button variant="primary" disabled={!enabled || busy || !q.trim()} onClick={() => send(q)}><Send size={14} /></Button>
          </div>
          <p className="text-[11px] text-muted">La IA només fa servir les dades de la fitxa i les ofertes registrades. No s'inventa preus ni estalvis.</p>
        </div>
      )}
    </section>
  );
}

// ---------- Energía
function Energia({ c }: { c: Contract }) {
  const { patchCrm, set, toast } = useApp();
  const kwh = consumption(c);
  const [v, setV] = useState(kwh ? String(Math.round(kwh)) : "");
  const electric = hasSipsCups(c); // llum, gas o dual
  const sips = useSips(electric ? c.cups : null);
  const busy = useSipsIndex((s) => !!s.busy[(c.cups ?? "").toUpperCase().replace(/[\s.-]/g, "").slice(0, 20)]);
  const refresh = async () => {
    try {
      const e = await useSipsIndex.getState().refresh(c.cups!);
      toast({ title: e.status === "found" ? "Dades SIPS actualitzades" : e.status === "not_found" ? "El SIPS no retorna aquest CUPS" : "Error del portal SIPS", body: e.error ?? undefined, tone: e.status === "error" ? "err" : "ok" });
    } catch (err) {
      toast({ title: "No s'ha pogut consultar el SIPS", body: err instanceof Error ? err.message : String(err), tone: "err" });
    }
  };
  const months = sips?.monthly_kwh ?? null;
  const maxM = months ? Math.max(1, ...months.map((x) => x ?? 0)) : 1;
  return (
    <div className="space-y-4">
      {electric && (
        <div className="rounded-xl border border-accent/25 bg-accent/[0.04] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold"><ZapIcon size={14} className="text-accent" /> Dades SIPS{sips?.energy_type === "gas" ? " · gas" : sips?.energy_type === "luz" ? " · llum" : ""}</div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" disabled={busy} onClick={refresh}>{busy ? "Consultant…" : "Actualitza"}</Button>
              <Button size="sm" onClick={() => useApp.getState().analyzeCups(c.cups!, c.id)}><ActivityIcon size={13} /> Analitzar CUPS</Button>
            </div>
          </div>
          {!sips ? (
            <p className="mt-1.5 text-[12px] text-muted">Encara no hi ha dades SIPS desades per a aquest CUPS. Prem «Actualitza» o obre l&apos;anàlisi.</p>
          ) : sips.status !== "found" ? (
            <p className={cn("mt-1.5 text-[12px]", sips.status === "error" ? "text-lost" : "text-muted")}>{sips.status === "error" ? `Error en la darrera consulta: ${sips.error ?? ""}` : "El portal SIPS no retorna cap punt de llum ni de gas amb aquest CUPS."}</p>
          ) : (
            <>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3">
                <Item k="Consum anual (SIPS)" v={sips.annual_kwh != null ? `${Math.round(sips.annual_kwh).toLocaleString("ca-ES")} kWh · ${fmtMWh(sips.annual_kwh, 2)}` : null} />
                <Item k="Tarifa (SIPS)" v={sips.tariff} />
                <Item k="Comercialitzadora (SIPS)" v={sips.retailer ?? null} />
                <Item k="Distribuïdora" v={sips.distributor ?? null} />
                <Item k="Potència màx. anual" v={sips.max_power_year_kw != null ? `${sips.max_power_year_kw} kW` : null} />
                <Item k="Consultat" v={`${fmtDateTime(sips.consulted_at)}${sips.source === "excel" ? " · Excel" : ""}`} />
              </dl>
              {sips.contracted_power_kw?.some((x) => x != null) && (
                <div className="mt-2 grid grid-cols-6 gap-1">
                  {sips.contracted_power_kw.map((p, i) => <div key={i} className="rounded-md bg-surface px-1.5 py-1 text-center text-[11px]"><div className="text-[10px] text-muted">P{i + 1}</div><div className="font-semibold tnum">{p ?? "—"}</div></div>)}
                </div>
              )}
              {months && months.some((x) => x != null) && (
                <div className="mt-2">
                  <div className="flex h-14 items-end gap-[3px]" aria-label="Consum mensual SIPS">
                    {months.map((m, i) => <div key={i} title={`${["Gen","Feb","Mar","Abr","Mai","Jun","Jul","Ago","Set","Oct","Nov","Des"][i]}: ${m == null ? "sense dada" : `${Math.round(m).toLocaleString("ca-ES")} kWh`}`} className={cn("flex-1 rounded-t-sm", m == null ? "bg-line/60" : "bg-accent/70")} style={{ height: `${m == null ? 6 : Math.max(6, (m / maxM) * 100)}%` }} />)}
                  </div>
                  <p className="mt-1 text-[10.5px] text-muted">Consum mensual (kWh). Els mesos en gris no tenen dada. El SIPS no desglossa P1–P6.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
        <Item k="Comercialitzadora actual" v={c.comercializadora} />
        <Item k="Comercialitzadora anterior" v={c.comercializadoraAnterior} />
        <Item k="Tarifa" v={c.tarifa} />
        <Item k="Producte" v={c.producto} />
        <Item k="Preu contractat" v={c.precioContratado} wide />
        <Item k="Potència" v={c.potencia ? `${c.potencia} kW` : null} />
        <Item k="Excedents / autoconsum" v={c.excedentes} />
      </dl>
      {c.potencias && (
        <div>
          <h4 className="mb-1.5 text-[12px] font-medium text-muted">Potències contractades per període (kW) · CRM</h4>
          <div className="grid grid-cols-6 gap-1.5">
            {c.potencias.map((p, i) => <div key={i} className="rounded-lg bg-elevated px-2 py-1.5 text-center text-[12px]"><div className="text-[10.5px] text-muted">P{i + 1}</div><div className="font-semibold tnum">{p ?? "—"}</div></div>)}
          </div>
        </div>
      )}
      <Field label="Consum anual (kWh) · valor manual" hint={c.consumoAnual ? `Valor de l'origen (CRM): ${c.consumoAnual.toLocaleString("ca-ES")} kWh. El valor manual té prioritat i el SIPS no el sobreescriu.` : "No consta a l'origen. Si no l'introdueixes, es farà servir el del SIPS quan n'hi hagi."}>
        <div className="flex gap-2">
          <input className="input tnum" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))} />
          <Button onClick={() => patchCrm(c.id, { consumoOverride: v ? Number(v) : null }, { type: "note", title: "Consum anual actualitzat", body: `${v || "—"} kWh` })}>Desa</Button>
        </div>
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="primary" className="w-full" onClick={() => set("proposalFor", c.id)}><FileSignature size={15} /> Prepara l&apos;oferta amb aquestes dades</Button>
        <Button className="w-full" onClick={() => { useApp.getState().open(null); useApp.getState().navigate("comparativa", { contract: c.id }); }}><FileSignature size={15} /> Comparativa IA (3 alternatives)</Button>
      </div>
    </div>
  );
}

// ---------- Renovación
function Renovacion({ c }: { c: Contract }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
        <Item k="Data d'inici" v={`${fmtDate(c.fechaInicio)}`} />
        <Item k="Origen de la data" v={{ activacion: "Data d'activació", tramitacion: "Data de tramitació", registro_diario: "Registre diari (DATA)", importacion_crm: "Importació CRM — revisar", null: "—" }[String(c.fechaInicioFuente)]} />
        <Item k="Venciment" v={fmtDate(expiry(c))} />
        <Item k="Venciment original" v={fmtDate(c.vencimientoOriginal)} />
        <Item k="Estat a l'origen" v={[c.estadoOrigen, c.estadoAlta].filter(Boolean).join(" · ")} />
        <Item k="Tipus d'alta" v={c.tipoAlta} />
        <Item k="Responsable" v={titleCase(c.comercial)} />
        <Item k="Contractes previs (mateix CUPS)" v={c.contratosPrevios} />
        {c.crm.condicionesRenovacion && <Item k="Condicions de renovació" v={c.crm.condicionesRenovacion} wide />}
        {c.crm.motivoRechazo && <Item k="Motiu de rebuig" v={c.crm.motivoRechazo} wide />}
      </dl>
      {c.renovacionTacita && <Notice tone="blue">El primer venciment ({fmtDate(c.vencimientoOriginal)}) ja va passar sense cap gestió registrada, així que es calcula el següent aniversari.</Notice>}
      {c.fechaInicioFuente === "importacion_crm" && <Notice>La data d'inici és la d'importació al CRM, no la real del contracte. Confirma-la amb el client o la comercialitzadora.</Notice>}
    </div>
  );
}

// ---------- Comunicaciones
function Comunicaciones({ c, acts }: { c: Contract; acts: Activity[] }) {
  const { log, patchCrm, updateActivity } = useApp();
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"call" | "note">("call");
  const comms = acts.filter((a) => ["whatsapp", "email", "call", "note"].includes(a.type));
  const phone = c.crm.telefonoOverride ?? c.telefono;
  const save = async () => {
    if (!note.trim()) return;
    if (kind === "call") await patchCrm(c.id, { ultimoContacto: new Date().toISOString() }, { type: "call", title: "Trucada registrada", body: note, delivery: "enviado" });
    else await log({ contractId: c.id, type: "note", title: "Anotació", body: note });
    setNote("");
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line p-3">
        <div className="mb-2 flex items-center gap-2">
          <Tabs value={kind} onChange={setKind} items={[{ id: "call", label: "Registra una trucada" }, { id: "note", label: "Anotació" }]} />
          {phone && kind === "call" && <a href={`tel:${phone}`} className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"><Phone size={13} /> Truca al {phone}</a>}
        </div>
        <textarea className="input min-h-[72px]" placeholder={kind === "call" ? "Resultat de la trucada…" : "Escriu una nota…"} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="mt-2 flex justify-end"><Button variant="primary" size="sm" disabled={!note.trim()} onClick={save}><NotebookPen size={13} /> Desa</Button></div>
      </div>
      {comms.length === 0 ? <Empty icon={<MessageCircle size={20} />} title="Cap comunicació registrada" body="Aquí sortiran els WhatsApp, correus, trucades i notes." /> : (
        <ol className="space-y-2">
          {comms.map((a) => (
            <li key={a.id} className="rounded-xl border border-line p-3 text-[12.5px]">
              <div className="flex items-center gap-2">
                <ActIcon t={a.type} />
                <span className="font-medium">{a.title}</span>
                {a.delivery && <DeliveryBadge d={a.delivery} />}
                <span className="ml-auto text-[11px] text-muted">{fmtDateTime(a.at)} · {a.by}</span>
              </div>
              {a.body && <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-ink/80">{a.body}</p>}
              {a.type === "whatsapp" && a.delivery === "preparado" && (
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" onClick={() => updateActivity({ ...a, delivery: "enviado" })}><Check size={12} /> Marca com a enviat</Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function DeliveryBadge({ d }: { d: NonNullable<Activity["delivery"]> }) {
  const m = { preparado: ["zinc", "Preparat"], enviado: ["blue", "Enviat"], entregado: ["green", "Lliurat"], error: ["red", "Error"] } as const;
  return <Badge tone={m[d][0]}>{m[d][1]}</Badge>;
}

function ActIcon({ t }: { t: Activity["type"] }) {
  const I = { whatsapp: MessageCircle, email: Mail, call: PhoneCall, note: NotebookPen, pdf: FileText, status: CheckCircle2, task: CalendarPlus, renewal: CheckCircle2, sync: CheckCircle2 }[t];
  return <I size={14} className="shrink-0 text-muted" />;
}

// ---------- Documentos
/** Pestanya Documents: propostes + documents del client (Clients 360°). Vegeu RenewalDocuments.tsx. */
function Documentos({ c }: { c: Contract }) {
  return <RenewalDocuments c={c} />;
}

// ---------- Seguimiento
function Seguimiento({ c }: { c: Contract }) {
  const { saveTask, toggleTask, snap } = useApp();
  const tasks = snap!.tasks.filter((t) => t.contractId === c.id);
  const [title, setTitle] = useState("Trucar per fer el seguiment");
  const [due, setDue] = useState(addDays(today(), snap!.settings.seguimientoDias));
  const me = snap!.me;
  const assignable = canAssignTasks(me.role) ? snap!.users : [me];
  const responsible = snap!.users.find((u) => u.code === c.comercial);
  const [assignee, setAssignee] = useState(canAssignTasks(me.role) && responsible ? assigneeKey(responsible) : assigneeKey(me));
  const nameOf = (k: string) => snap!.users.find((u) => assigneeKey(u) === k || u.code === k)?.name ?? titleCase(k);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><Field label="Tasca"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field></div>
          <Field label="Data"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Assignada a">
            <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={assignable.length < 2}>
              {assignable.map((u) => <option key={u.id} value={assigneeKey(u)}>{u.name}{u.code ? ` (${u.code})` : ""}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {[1, 3, 7, 14].map((n) => <button key={n} onClick={() => setDue(addDays(today(), n))} className="pressable rounded-full border border-line px-2.5 py-1 text-[11.5px] hover:border-ink/25">+{n} d</button>)}
          <Button className="ml-auto" variant="primary" size="sm" disabled={!title.trim()} onClick={() => saveTask({ contractId: c.id, title, due, assignee, kind: "seguimiento" })}><CalendarPlus size={13} /> Programa</Button>
        </div>
      </div>
      {tasks.length === 0 ? <Empty icon={<CalendarPlus size={20} />} title="Cap tasca" body="Programa la propera trucada o seguiment." /> : (
        <ul className="space-y-1.5">
          {tasks.sort((a, b) => Number(a.done) - Number(b.done) || a.due.localeCompare(b.due)).map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-[12.5px]">
              <button aria-label="Completa" onClick={() => toggleTask(t.id)} className={cn("pressable flex h-4 w-4 items-center justify-center rounded border", t.done ? "border-ren bg-ren text-white" : "border-ink/30")}>{t.done && <Check size={11} />}</button>
              <span className={cn("flex-1", t.done && "text-muted line-through")}>{t.title}</span>
              <span className={cn("text-[11px] tnum", !t.done && t.due < today() ? "font-semibold text-lost" : "text-muted")}>{fmtDate(t.due)}</span>
              <span className="text-[11px] text-muted">{nameOf(t.assignee)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Historial
function Historial({ acts, c }: { acts: Activity[]; c: Contract }) {
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {acts.map((a) => (
        <li key={a.id} className="relative text-[12.5px]">
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand" />
          <div className="flex items-center gap-2"><span className="font-medium">{a.title}</span>{a.delivery && <DeliveryBadge d={a.delivery} />}</div>
          <p className="text-[11px] text-muted">{fmtDateTime(a.at)} · {a.by}</p>
          {a.body && <p className="mt-0.5 line-clamp-2 text-ink/70">{a.body}</p>}
        </li>
      ))}
      <li className="relative text-[12.5px]">
        <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ink/30" />
        <span className="font-medium">Importat des del full de contractes</span>
        <p className="text-[11px] text-muted">Inici {fmtDate(c.fechaInicio)} · {c.registrosDiarios} registre(s) al diari · {c.contratosPrevios} contracte(s) previ(s)</p>
      </li>
    </ol>
  );
}

