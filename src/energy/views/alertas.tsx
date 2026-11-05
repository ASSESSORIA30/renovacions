"use client";
import { Bell } from "lucide-react";
import { usePortfolio } from "@/energy/lib/portfolio";
import { SEVERITY_ORDER, SEVERITY_LABEL } from "@/energy/lib/alerts";
import { AlertList } from "@/energy/components/alert-list";
import { PageTitle } from "@/energy/components/shell";
import { Empty, Kpi } from "@/energy/components/ui";
import { fmt } from "@/energy/lib/format";

export function AlertsView() {
  const rows = usePortfolio();
  const alerts = rows.flatMap((r) => r.alerts);
  if (!rows.length) return <Empty icon={<Bell />} title="Sin suministros">Importa un Excel SIPS para generar alertas.</Empty>;
  return (
    <div className="space-y-5">
      <PageTitle icon={<Bell />} title="Centro de alertas" subtitle={`${fmt.n(alerts.length)} avisos en ${fmt.n(rows.length)} suministros · reglas configurables en Ajustes`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {SEVERITY_ORDER.map((s) => (
          <Kpi key={s} label={SEVERITY_LABEL[s]} value={fmt.n(alerts.filter((a) => a.severity === s).length)} />
        ))}
      </div>
      <AlertList alerts={alerts} showCups initialSeverities={["critica", "alta", "media"]} />
    </div>
  );
}
