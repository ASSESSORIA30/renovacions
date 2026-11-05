"use client";
import { useMemo, useState } from "react";
import { Bookmark, BookmarkCheck, ClipboardList, FileDown, MessageSquarePlus, PhoneCall, Sun, Target, User, Waves, Gauge, ShieldAlert, Store, Stethoscope } from "lucide-react";
import { toast } from "@/energy/compat/toast";
import type { CrmCall, OppStatus, Supply } from "@/energy/lib/types";
import { emptyOpp, useStore } from "@/energy/lib/store";
import { supplyAlerts } from "@/energy/lib/alerts";
import { scoreSupply } from "@/energy/lib/scoring";
import { analyzeReactive } from "@/energy/lib/reactive";
import { runOptimizer } from "@/energy/lib/optimizer";
import { regulatedPowerPrice } from "@/energy/lib/tariffs";
import { annualActive } from "@/energy/lib/parse";
import { cn, fmt } from "@/energy/lib/format";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, Field, Input, Select, Textarea } from "../ui";
import { HBarScores } from "../charts";

const STATUS: { k: OppStatus; l: string }[] = [
  { k: "nueva", l: "Nueva" },
  { k: "contactada", l: "Contactada" },
  { k: "propuesta", l: "Propuesta" },
  { k: "negociacion", l: "Negociación" },
  { k: "ganada", l: "Ganada" },
  { k: "perdida", l: "Perdida" },
];
const CALL_RES: Record<CrmCall["result"], string> = { contactado: "Contactado", no_contesta: "No contesta", rellamar: "Volver a llamar", interesado: "Interesado", no_interesado: "No interesado" };

export function useInsights(s: Supply) {
  const settings = useStore((st) => st.settings);
  return useMemo(() => {
    const alerts = supplyAlerts(s, settings.alerts);
    const score = scoreSupply(s, settings.scoring);
    const reactive = analyzeReactive(s, { shareOutsideP6: settings.reactiveShareOutsideP6, table: settings.regulated.reactive });
    const opt = s.tarifa ? runOptimizer({ supply: s, tariff: s.tarifa, prices: regulatedPowerPrice(settings.regulated, s.tarifa).map((v) => v + (v > 0 ? settings.marginPowerEurKWyr : 0)), excess45: settings.regulated.excess45[s.tarifa], modCosts: settings.modCosts }) : null;
    const best = opt?.ok ? opt.scenarios.find((x) => x.def.key === "equilibrado") : undefined;
    const annual = annualActive(s).value ?? 0;
    const ac = (s.autoconsumo ?? "").trim();
    const hasAuto = !!ac && !/^(no|0|sin|00)/i.test(ac);
    const actions: { icon: React.ReactNode; text: string; prio: "alta" | "media" | "baja" }[] = [];
    if (s.contratable === false) actions.push({ icon: <ShieldAlert />, text: `No ofertar hasta resolver: ${s.motivoNoContratable ?? "suministro no contratable"}.`, prio: "alta" });
    if (alerts.some((a) => a.rule === "impagos")) actions.push({ icon: <ShieldAlert />, text: "Revisar riesgo de impago antes de presentar oferta.", prio: "alta" });
    if (alerts.some((a) => a.rule.startsWith("bie-") || a.rule.startsWith("apm-"))) actions.push({ icon: <ShieldAlert />, text: "Gestionar renovación de BIE/APM antes de solicitar modificaciones de potencia.", prio: "alta" });
    if (best && best.netSavingLB > 100) actions.push({ icon: <Gauge />, text: `Proponer ajuste de potencia (escenario Equilibrado): ahorro mínimo ${fmt.eur(best.netSavingLB)}/año, validar con facturas.`, prio: "alta" });
    if (reactive.risk === "alto" || reactive.risk === "medio") actions.push({ icon: <Waves />, text: "Ofrecer estudio de compensación de energía reactiva (solicitar datos por periodo).", prio: "media" });
    if (!hasAuto && annual > 20000) actions.push({ icon: <Sun />, text: "Proponer estudio de autoconsumo: solicitar curva horaria para dimensionar.", prio: "media" });
    actions.push({ icon: <Store />, text: "Preparar comparativa de ofertas con facturas recientes (kWh por periodo).", prio: "media" });
    if (opt && opt.dm.basis !== "medida_periodo") actions.push({ icon: <ClipboardList />, text: "Solicitar últimas 12 facturas o curva cuartohoraria para pasar de diagnóstico preliminar a propuesta firme.", prio: "baja" });
    return { alerts, score, reactive, opt, best, annual, hasAuto, actions };
  }, [s, settings]);
}

export function OpportunityModule({ s, goTo }: { s: Supply; goTo: (tab: string) => void }) {
  const ins = useInsights(s);
  const opp = useStore((st) => st.crm[s.cups]) ?? emptyOpp(s.cups);
  const updateOpp = useStore((st) => st.updateOpp);
  const settings = useStore((st) => st.settings);
  const [note, setNote] = useState("");
  const [callOpen, setCallOpen] = useState(false);
  const [call, setCall] = useState<{ result: CrmCall["result"]; notes: string }>({ result: "contactado", notes: "" });

  async function exportReport() {
    const { supplyReportPdf } = await import("@/energy/lib/pdf");
    await supplyReportPdf({ s, ins, opp, logo: settings.logoDataUrl, author: settings.userName });
    updateOpp(s.cups, (o) => ({ ...o, proposals: [{ id: crypto.randomUUID(), date: new Date().toISOString(), author: settings.userName, kind: "informe", summary: "Informe de oportunidades exportado", estSavingEur: ins.best?.netSavingLB ?? null }, ...o.proposals] }));
    toast.success("Informe exportado");
  }

  const blocks = [
    { icon: <Stethoscope />, title: "Diagnóstico energético", body: `${fmt.n(ins.annual / 1000, 1)} MWh/año · ${s.tarifa ?? "tarifa ?"} · máx. registrada ${fmt.kw(s.potAnual)} · utilización máx. ${ins.score.util != null ? fmt.pct(ins.score.util) : "—"}`, tab: "radiografia" },
    { icon: <Gauge />, title: "Optimización de potencia", body: ins.best ? `Escenario Equilibrado: ${ins.best.pc.map((v) => fmt.n(v, 1)).join(" / ")} kW · ahorro mínimo ${fmt.eur(ins.best.netSavingLB)}/año (${ins.opt?.confidence.level})` : ins.opt?.reason ?? "No disponible", tab: "optimizer" },
    { icon: <Store />, title: "Comparativa de ofertas", body: "Compara ofertas registradas con rango garantizado o con kWh de facturas.", tab: "mercado" },
    { icon: <Waves />, title: "Energía reactiva", body: `R/A anual ${fmt.pct(ins.reactive.annualRatio)} · ${ins.reactive.applies.applies === false ? "no se factura" : `riesgo ${ins.reactive.risk.replace("_", " ")}`}`, tab: "reactiva" },
    { icon: <ShieldAlert />, title: "Estado técnico", body: `BIE ${fmt.kw(s.potMaxBIE)} (cad. ${fmt.date(s.fCaducidadBIE)}) · APM ${fmt.kw(s.potMaxAPM)} · ${s.telegestion ?? "telegestión s/d"} · control ${s.ctrlPotencia ?? "s/d"} · tensión ${fmt.n(s.tension)} V`, tab: "ficha" },
    { icon: <Sun />, title: "Autoconsumo", body: ins.hasAuto ? `Con autoconsumo: ${s.autoconsumo}` : ins.annual > 20000 ? "Sin autoconsumo y consumo relevante: oportunidad a estudiar con curva horaria (no se dimensiona sin datos horarios)." : "Sin autoconsumo; consumo reducido.", tab: "radiografia" },
    { icon: <ShieldAlert />, title: "Alertas administrativas", body: `${ins.alerts.filter((a) => a.category === "administrativa").length} administrativas · ${ins.alerts.filter((a) => a.severity === "critica").length} críticas`, tab: "alertas" },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        <Card>
          <CardHeader icon={<Target />} title="Ficha de oportunidades" subtitle="Resumen accionable del suministro" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {blocks.map((b) => (
              <button key={b.title} onClick={() => goTo(b.tab)} className="rounded-xl border border-border bg-surface-2/40 p-4 text-left transition hover:border-accent/50">
                <div className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-accent">
                  {b.icon}
                  {b.title}
                </div>
                <p className="mt-1.5 text-xs text-fg-3">{b.body}</p>
              </button>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<ClipboardList />} title="Acciones comerciales recomendadas" subtitle="Reglas transparentes sobre los datos del suministro" />
          <CardBody className="space-y-2">
            {ins.actions.map((a) => (
              <div key={a.text} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm [&_svg]:size-4">
                <span className="mt-0.5 text-accent">{a.icon}</span>
                <span className="flex-1">{a.text}</span>
                <Badge tone={a.prio === "alta" ? "serious" : a.prio === "media" ? "warning" : "neutral"}>{a.prio}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={`Puntuación comercial: ${ins.score.score}/100`} subtitle="Prioridad comercial según criterios configurables. No es un ahorro demostrado." />
          <CardBody>
            <HBarScores items={ins.score.items.map((i) => ({ label: `${i.label} (${i.why})`, value: Math.round(i.points * 10) / 10 }))} />
          </CardBody>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader icon={<User />} title="Gestión de la oportunidad" subtitle={`Actualizado ${fmt.dateTime(opp.updatedAt)}`} />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant={opp.marked ? "default" : "outline"} onClick={() => updateOpp(s.cups, (o) => ({ ...o, marked: !o.marked }))}>
                {opp.marked ? <BookmarkCheck /> : <Bookmark />} {opp.marked ? "Oportunidad marcada" : "Marcar oportunidad"}
              </Button>
              <Button variant="outline" onClick={() => setCallOpen(true)}>
                <PhoneCall /> Registrar llamada
              </Button>
              <Button variant="outline" onClick={() => goTo("optimizer")}>
                <Gauge /> Preparar propuesta
              </Button>
              <Button variant="secondary" onClick={exportReport}>
                <FileDown /> Exportar informe
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Responsable">
                <Input value={opp.owner} placeholder="Asignar comercial" onChange={(e) => updateOpp(s.cups, (o) => ({ ...o, owner: e.target.value }))} />
              </Field>
              <Field label="Estado">
                <Select value={opp.status} onChange={(e) => updateOpp(s.cups, (o) => ({ ...o, status: e.target.value as OppStatus }))}>
                  {STATUS.map((x) => (
                    <option key={x.k} value={x.k}>
                      {x.l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex gap-1">
              {STATUS.slice(0, 5).map((x, i) => (
                <div key={x.k} className={cn("h-1.5 flex-1 rounded-full", STATUS.findIndex((y) => y.k === opp.status) >= i && opp.status !== "perdida" ? "bg-accent" : "bg-surface-2")} />
              ))}
            </div>
            <Field label="Observaciones">
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Añadir una observación…" />
            </Field>
            <Button
              size="sm"
              disabled={!note.trim()}
              onClick={() => {
                updateOpp(s.cups, (o) => ({ ...o, notes: [{ id: crypto.randomUUID(), date: new Date().toISOString(), author: settings.userName, text: note.trim() }, ...o.notes] }));
                setNote("");
              }}
            >
              <MessageSquarePlus /> Añadir observación
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Historial" subtitle={`${opp.notes.length} notas · ${opp.calls.length} llamadas · ${opp.proposals.length} propuestas`} />
          <CardBody className="max-h-[420px] space-y-2 overflow-y-auto">
            {[
              ...opp.notes.map((n) => ({ d: n.date, k: "Nota", t: n.text, a: n.author })),
              ...opp.calls.map((c) => ({ d: c.date, k: `Llamada · ${CALL_RES[c.result]}`, t: c.notes, a: c.author })),
              ...opp.proposals.map((p) => ({ d: p.date, k: `Propuesta · ${p.kind}`, t: `${p.summary}${p.estSavingEur != null ? ` · ${fmt.eur(p.estSavingEur)}/año` : ""}`, a: p.author })),
            ]
              .sort((a, b) => b.d.localeCompare(a.d))
              .map((e, i) => (
                <div key={i} className="rounded-lg border border-border p-3 text-xs">
                  <div className="flex justify-between text-fg-3">
                    <span className="font-medium text-fg-2">{e.k}</span>
                    <span>{fmt.dateTime(e.d)}</span>
                  </div>
                  <p className="mt-1 text-fg-2">{e.t || "—"}</p>
                  <p className="mt-1 text-[10px] text-fg-3">{e.a}</p>
                </div>
              ))}
            {!opp.notes.length && !opp.calls.length && !opp.proposals.length && <p className="text-xs text-fg-3">Sin actividad registrada.</p>}
          </CardBody>
        </Card>
      </div>
      <Dialog open={callOpen} onOpenChange={setCallOpen} title="Registrar llamada">
        <div className="space-y-3">
          <Field label="Resultado">
            <Select value={call.result} onChange={(e) => setCall({ ...call, result: e.target.value as CrmCall["result"] })}>
              {Object.entries(CALL_RES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notas">
            <Textarea rows={3} value={call.notes} onChange={(e) => setCall({ ...call, notes: e.target.value })} />
          </Field>
          <Button
            className="w-full"
            onClick={() => {
              updateOpp(s.cups, (o) => ({ ...o, status: o.status === "nueva" ? "contactada" : o.status, calls: [{ id: crypto.randomUUID(), date: new Date().toISOString(), author: settings.userName, ...call }, ...o.calls] }));
              setCallOpen(false);
              setCall({ result: "contactado", notes: "" });
              toast.success("Llamada registrada");
            }}
          >
            Guardar
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
