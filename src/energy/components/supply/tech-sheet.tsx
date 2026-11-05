"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Supply } from "@/energy/lib/types";
import { COLUMN_BY_NORM, GROUP_LABELS, normHeader, type ColumnGroup } from "@/energy/lib/columns";
import { Collapse, Input, Badge } from "../ui";
import { Provenance } from "./common";

export function TechSheet({ s }: { s: Supply }) {
  const [q, setQ] = useState("");
  const [empty, setEmpty] = useState(true);
  const groups = useMemo(() => {
    const g = new Map<ColumnGroup, { h: string; v: unknown; unit?: string; help?: string }[]>();
    for (const [h, v] of Object.entries(s.raw)) {
      const def = COLUMN_BY_NORM.get(normHeader(h));
      const grp = def?.group ?? "otros";
      if (q && !`${h} ${v ?? ""}`.toLowerCase().includes(q.toLowerCase())) continue;
      if (!empty && (v == null || v === "")) continue;
      if (!g.has(grp)) g.set(grp, []);
      g.get(grp)!.push({ h, v, unit: def?.unit, help: def?.help });
    }
    return g;
  }, [s, q, empty]);
  const total = Object.keys(s.raw).length;
  const filled = Object.values(s.raw).filter((v) => v != null && v !== "").length;
  return (
    <div className="space-y-4">
      <Provenance s={s} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-fg-3" />
          <Input className="pl-9" placeholder="Buscar columna o valor…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-xs text-fg-2">
          <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Mostrar columnas vacías
        </label>
        <Badge tone="accent">
          {filled}/{total} columnas con dato
        </Badge>
      </div>
      <div className="space-y-3">
        {(Object.keys(GROUP_LABELS) as ColumnGroup[])
          .filter((g) => groups.has(g))
          .map((g, i) => (
            <Collapse key={g} defaultOpen={i < 3 || !!q} title={GROUP_LABELS[g]} right={<Badge>{groups.get(g)!.length}</Badge>}>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
                {groups.get(g)!.map((r) => (
                  <div key={r.h} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm" title={r.help}>
                    <dt className="text-xs text-fg-3">{r.h}</dt>
                    <dd className="num truncate text-right text-fg">{r.v == null || r.v === "" ? <span className="text-fg-3">—</span> : String(r.v)}</dd>
                  </div>
                ))}
              </dl>
            </Collapse>
          ))}
      </div>
    </div>
  );
}
