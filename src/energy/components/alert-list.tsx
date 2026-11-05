"use client";
import Link from "@/energy/compat/link";
import { useMemo, useState } from "react";
import { BellOff, ArrowUpDown } from "lucide-react";
import { SEVERITY_ORDER, SEVERITY_LABEL, sortAlerts, type Alert, type Severity, type AlertCategory } from "@/energy/lib/alerts";
import { cn } from "@/energy/lib/format";
import { Badge, Empty, Input, Select, SeverityBadge } from "./ui";

const CAT: Record<AlertCategory, string> = { administrativa: "Administrativa", tecnica: "Técnica", consumo: "Consumo", potencia: "Potencia", datos: "Calidad de datos", oportunidad: "Oportunidad" };

export function AlertList({ alerts, showCups, initialSeverities }: { alerts: Alert[]; showCups?: boolean; initialSeverities?: Severity[] }) {
  const [sev, setSev] = useState<Severity[]>(initialSeverities ?? SEVERITY_ORDER);
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [asc, setAsc] = useState(false);
  const counts = useMemo(() => Object.fromEntries(SEVERITY_ORDER.map((s) => [s, alerts.filter((a) => a.severity === s).length])), [alerts]);
  const list = useMemo(() => {
    let l = sortAlerts(alerts.filter((a) => sev.includes(a.severity) && (!cat || a.category === cat) && (!q || `${a.cups} ${a.title} ${a.reason}`.toLowerCase().includes(q.toLowerCase()))));
    if (asc) l = l.reverse();
    return l;
  }, [alerts, sev, cat, q, asc]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {SEVERITY_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setSev(sev.includes(s) ? sev.filter((x) => x !== s) : [...sev, s])}
            className={cn("rounded-lg border px-2.5 py-1 text-xs transition", sev.includes(s) ? "border-border-strong bg-surface-2 text-fg" : "border-border text-fg-3 opacity-60")}
          >
            {SEVERITY_LABEL[s]} <span className="num ml-1 text-fg-3">{counts[s]}</span>
          </button>
        ))}
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="h-8 text-xs">
          <option value="">Todas las categorías</option>
          {Object.entries(CAT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Input placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 max-w-xs text-xs" />
        <button onClick={() => setAsc(!asc)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-fg-2">
          <ArrowUpDown className="size-3" /> Prioridad {asc ? "ascendente" : "descendente"}
        </button>
      </div>
      {!list.length ? (
        <Empty icon={<BellOff />} title="Sin alertas con estos filtros" />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {list.map((a) => (
            <div key={a.id} className="grid gap-2 bg-surface/50 p-4 sm:grid-cols-[110px_1fr_auto] sm:items-start">
              <div className="flex flex-col gap-1">
                <SeverityBadge s={a.severity} />
                <span className="text-[10px] text-fg-3">{CAT[a.category]}</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{a.title}</div>
                <div className="mt-0.5 text-xs text-fg-2">{a.reason}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {a.columns.map((c) => (
                    <Badge key={c} tone="neutral" className="text-[10px]">
                      {c}
                    </Badge>
                  ))}
                  <span className="text-[10px] text-fg-3">Fuente: {a.origin}</span>
                </div>
              </div>
              {showCups && (
                <Link href={`/suministro/?cups=${encodeURIComponent(a.cups)}`} className="num text-[11px] text-accent hover:underline">
                  {a.cups}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
