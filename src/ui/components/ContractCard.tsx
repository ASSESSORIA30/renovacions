"use client";
import { useSips } from "../useSips";
import { memo } from "react";
import { Mail, MessageCircle, PanelRight, MapPin, Zap, Flame, Wifi, Activity, FileSignature } from "lucide-react";
import { consumptionSource, fmtMWh, hasSipsCups } from "@/core/sips";
import { AVAILABILITY_META } from "@/energy/lib/sips-record";
import { daysUntil, fmtDateShort, relDays } from "@/core/dates";
import { badges, expiry } from "@/core/insights";
import { LEVEL_META, consumption } from "@/core/priority";
import { titleCase } from "@/core/templates";
import type { Contract } from "@/core/types";
import { useApp } from "@/data/store";
import { Badge, ExpiryGauge, SupplierMark, cn } from "./ui";
import { STATUS_META } from "../selectors";

const KIND_ICON = { luz: Zap, gas: Flame, telefonia: Wifi, dual: Zap };

export const ContractCard = memo(function ContractCard({ c, dragging, overlay }: { c: Contract; dragging?: boolean; overlay?: boolean }) {
  const pr = useApp((s) => s.priority[c.id]);
  const tasks = useApp((s) => s.snap!.tasks);
  const settings = useApp((s) => s.snap!.settings);
  const lastAct = useApp((s) => s.snap!.activities.find((a) => a.contractId === c.id));
  const { open, set } = useApp.getState();
  const d = daysUntil(expiry(c));
  const tone = STATUS_META[c.crm.status].color;
  const gaugeTone = d !== null && d <= 7 ? "rgb(var(--lost))" : d !== null && d <= 30 ? "rgb(var(--pend))" : "rgb(var(--muted) / 0.7)";
  const bs = badges(c, tasks, settings).slice(0, 3);
  const Icon = KIND_ICON[c.tipo];
  const electric = hasSipsCups(c); // llum, gas o dual amb CUPS vàlid
  const sips = useSips(electric ? c.cups : null);
  const { kwh, source } = consumptionSource(consumption(c), c.crm.consumoOverride != null, sips);
  const avail = sips?.status === "found" && sips.data_availability ? AVAILABILITY_META[sips.data_availability.level] : null;
  const SRC = { crm: "CRM", manual: "Manual", sips: "SIPS" } as const;
  const isOpen = c.crm.status === "pendiente" || c.crm.status === "contactado";

  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <article
      onClick={() => open(c.id)}
      className={cn(
        "card-hover group relative cursor-pointer select-none rounded-xl border border-line bg-surface p-3 shadow-card transition-[border-color,opacity,box-shadow] duration-150",
        dragging && "opacity-30",
        overlay && "rotate-[1.5deg] cursor-grabbing shadow-lift ring-1 ring-ink/10"
      )}
    >
      <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: tone }} aria-hidden />
      <header className="flex items-start gap-2 pl-1">
        <SupplierMark name={c.comercializadora} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold leading-tight">{titleCase(c.cliente)}</h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-muted">
            <MapPin size={11} className="shrink-0" />
            <span className="truncate">{[c.direccion, c.poblacion].filter(Boolean).join(", ") || "Sense adreça"}</span>
          </p>
        </div>
        {pr && pr.level !== "cerrado" && (
          <span title={`Prioritat ${LEVEL_META[pr.level].label.toLowerCase()}: ${LEVEL_META[pr.level].hint}`} className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset tnum", LEVEL_META[pr.level].cls)}>
            {pr.score}
          </span>
        )}
      </header>

      <div className="mt-2.5 flex items-center justify-between gap-2 pl-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
          <Icon size={12} className="shrink-0" />
          <span className="font-medium text-ink/80">{c.tarifa ?? "—"}</span>
          <span className="truncate font-mono text-[10.5px]">{c.cups ? `…${c.cups.slice(-8)}` : "sense CUPS"}</span>
        </div>
      </div>

      {(kwh != null || electric) && (
        <div className="mt-1.5 flex items-center gap-1.5 pl-1 text-[11px]">
          {kwh != null ? (
            <span className="tnum font-medium text-ink/80" title={`${Math.round(kwh).toLocaleString("ca-ES")} kWh/any`}>{fmtMWh(kwh, kwh < 10_000 ? 2 : 1)}</span>
          ) : (
            <span className="text-muted">Consum desconegut</span>
          )}
          {source && <span className={cn("rounded px-1 py-px text-[10px] font-semibold", source === "sips" ? "bg-accent/10 text-accent" : source === "manual" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-ink/[0.06] text-muted")} title={`Font del consum: ${SRC[source]}`}>{SRC[source]}</span>}
          {electric && sips && (
            <span
              className={cn("ml-auto flex items-center gap-1 text-[10.5px]", sips.status === "error" ? "text-lost" : "text-muted")}
              title={sips.status === "found" ? `SIPS consultat el ${new Date(sips.consulted_at).toLocaleDateString("ca-ES")}${avail ? ` · ${avail.label}: ${avail.hint}` : ""}` : sips.status === "not_found" ? "El SIPS no retorna aquest CUPS" : `Error SIPS: ${sips.error ?? ""}`}
            >
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", sips.status === "error" ? "bg-lost" : sips.status === "not_found" ? "bg-muted" : avail?.tone === "green" ? "bg-ren" : avail?.tone === "amber" ? "bg-pend" : "bg-cont")} />
              SIPS {sips.status === "found" ? new Date(sips.consulted_at).toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit" }) : sips.status === "not_found" ? "no trobat" : "error"}
            </span>
          )}
          {electric && !sips && <span className="ml-auto text-[10.5px] text-muted/80">Sense SIPS</span>}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 pl-1">
        <div className="flex items-center gap-2">
          {isOpen && <ExpiryGauge days={d} tone={gaugeTone} />}
          <span className={cn("text-[12px] font-medium tnum", isOpen && d !== null && d <= 7 ? "text-lost" : isOpen && d !== null && d <= 30 ? "text-pend" : "text-ink/80")}>
            {isOpen ? relDays(d) : c.crm.status === "renovado" ? `Renovat · prox. ${fmtDateShort(expiry(c))}` : "Perdut"}
          </span>
        </div>
        <span className="text-[11px] text-muted tnum">{fmtDateShort(expiry(c))}</span>
      </div>

      {bs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 pl-1">
          {bs.map((b) => <Badge key={b.key} tone={b.tone}>{b.label}</Badge>)}
        </div>
      )}

      <footer className="mt-2.5 flex items-center justify-between border-t border-line/70 pl-1 pt-2">
        <p className="min-w-0 flex-1 truncate pr-1 text-[11px] text-muted">
          <span className="font-medium text-ink/70">{titleCase(c.comercial)}</span> · {lastAct ? lastAct.title.toLowerCase() : c.crm.ultimoContacto ? "contactat" : "sense gestions"}
        </p>
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-60 sm:group-hover:opacity-100">
          <IconBtn label="WhatsApp" disabled={!c.telefono} onClick={stop(() => set("composer", { contractId: c.id, channel: "whatsapp" }))}><MessageCircle size={14} /></IconBtn>
          <IconBtn label="Correu" disabled={!c.email} onClick={stop(() => set("composer", { contractId: c.id, channel: "email" }))}><Mail size={14} /></IconBtn>
          {electric && <IconBtn label="Analitzar CUPS" onClick={stop(() => useApp.getState().analyzeCups(c.cups!, c.id))}><Activity size={14} /></IconBtn>}
          <IconBtn label="Preparar oferta" onClick={stop(() => set("proposalFor", c.id))}><FileSignature size={14} /></IconBtn>
          <IconBtn label="Veure fitxa" onClick={stop(() => open(c.id))}><PanelRight size={14} /></IconBtn>
        </div>
      </footer>
    </article>
  );
});

function IconBtn({ label, children, onClick, disabled }: { label: string; children: React.ReactNode; onClick: (e: React.MouseEvent) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={disabled ? `${label}: falta la dada de contacte` : label}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="pressable rounded-md p-1.5 text-muted hover:bg-ink/[0.06] hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}
