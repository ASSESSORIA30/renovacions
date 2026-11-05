"use client";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { daysBetween } from "@/core/dates";
import { consumption } from "@/core/priority";
import { titleCase } from "@/core/templates";
import { useApp } from "@/data/store";
import { Button, Empty } from "../components/ui";
import { downloadCsv } from "./csv";

const tip = { background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 10, fontSize: 12 };
const axis = { fontSize: 11, fill: "rgb(var(--muted))" };

export function EstadisticasView() {
  const { contracts, snap } = useApp();
  const [tipo, setTipo] = useState("");
  const acts = snap!.activities;
  const stats = useMemo(() => {
    const cs = contracts.filter((c) => !tipo || c.tipo === tipo);
    const ids = new Set(cs.map((c) => c.id));
    const firstAct = new Map<string, string>();
    for (const a of [...acts].reverse()) if (ids.has(a.contractId) && !firstAct.has(a.contractId)) firstAct.set(a.contractId, a.at);
    const proposals = new Set(acts.filter((a) => a.type === "pdf" && ids.has(a.contractId)).map((a) => a.contractId));
    const by = new Map<string, { comercial: string; renovados: number; perdidos: number; pendientes: number; contactados: number; mwh: number; valor: number; propuestas: number; cierres: number[] }>();
    const motivos = new Map<string, number>();
    const monthly = new Map<string, { mes: string; renovados: number; perdidos: number }>();
    for (const c of cs) {
      const k = c.comercial;
      if (!by.has(k)) by.set(k, { comercial: titleCase(k), renovados: 0, perdidos: 0, pendientes: 0, contactados: 0, mwh: 0, valor: 0, propuestas: 0, cierres: [] });
      const r = by.get(k)!;
      const kwh = consumption(c) ?? 0;
      r.valor += kwh / 1000;
      if (proposals.has(c.id)) r.propuestas++;
      if (c.crm.status === "pendiente") r.pendientes++;
      if (c.crm.status === "contactado") r.contactados++;
      if (c.crm.status === "renovado" || c.crm.status === "no_renueva") {
        if (c.crm.status === "renovado") { r.renovados++; r.mwh += kwh / 1000; }
        else { r.perdidos++; const m = (c.crm.motivoRechazo ?? "Sense motiu").split(":")[0]; motivos.set(m, (motivos.get(m) ?? 0) + 1); }
        const f = firstAct.get(c.id);
        if (f && c.crm.statusChangedBy !== "importació") r.cierres.push(Math.max(0, daysBetween(f.slice(0, 10), c.crm.statusChangedAt.slice(0, 10))));
        const mk = c.crm.statusChangedAt.slice(0, 7);
        if (c.crm.statusChangedBy === "importació") continue; // only closures made in the CRM
        if (!monthly.has(mk)) monthly.set(mk, { mes: mk, renovados: 0, perdidos: 0 });
        monthly.get(mk)![c.crm.status === "renovado" ? "renovados" : "perdidos"]++;
      }
    }
    const rows = [...by.values()].map((r) => ({ ...r, exito: r.renovados + r.perdidos ? Math.round((r.renovados / (r.renovados + r.perdidos)) * 100) : null, tiempoMedio: r.cierres.length ? Math.round(r.cierres.reduce((a, b) => a + b, 0) / r.cierres.length) : null })).sort((a, b) => b.renovados - a.renovados || b.pendientes - a.pendientes);
    const tot = rows.reduce((a, r) => ({ renovados: a.renovados + r.renovados, perdidos: a.perdidos + r.perdidos, pendientes: a.pendientes + r.pendientes + r.contactados, mwh: a.mwh + r.mwh, valor: a.valor + r.valor, propuestas: a.propuestas + r.propuestas }), { renovados: 0, perdidos: 0, pendientes: 0, mwh: 0, valor: 0, propuestas: 0 });
    const allC = rows.flatMap((r) => r.cierres);
    return {
      rows, tot, exito: tot.renovados + tot.perdidos ? Math.round((tot.renovados / (tot.renovados + tot.perdidos)) * 100) : null,
      tiempo: allC.length ? Math.round(allC.reduce((a, b) => a + b, 0) / allC.length) : null,
      motivos: [...motivos.entries()].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
      monthly: [...monthly.values()].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-12),
    };
  }, [contracts, acts, tipo]);

  const exportCsv = () => downloadCsv("estadistiques_comercials.csv", stats.rows.map((r) => ({ Comercial: r.comercial, Renovats: r.renovados, Perduts: r.perdidos, Pendents: r.pendientes, Contactats: r.contactados, TaxaExit: r.exito, MWhRenovats: r.mwh.toFixed(1), MWhGestionats: r.valor.toFixed(1), Propostes: r.propuestas, DiesMitjansTancament: r.tiempoMedio })));
  const fmt = (n: number, d = 0) => n.toLocaleString("ca-ES", { maximumFractionDigits: d });

  return (
    <div className="space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input h-9 w-auto" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Tots els subministraments</option><option value="luz">Llum</option><option value="gas">Gas</option><option value="telefonia">Telefonia</option></select>
        <Button size="sm" className="ml-auto" onClick={exportCsv}><Download size={13} /> Exporta</Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {[["Renovacions", fmt(stats.tot.renovados)], ["Pendents", fmt(stats.tot.pendientes)], ["Perduts", fmt(stats.tot.perdidos)], ["Taxa d'èxit", stats.exito === null ? "—" : `${stats.exito}%`], ["MWh renovats", fmt(stats.tot.mwh, 1)], ["Propostes", fmt(stats.tot.propuestas)], ["Dies mitjans de tancament", stats.tiempo === null ? "—" : String(stats.tiempo)]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-line bg-surface px-3 py-2.5"><div className="text-[22px] font-semibold tnum">{v}</div><div className="text-[11.5px] text-muted">{l}</div></div>
        ))}
      </div>
      <p className="text-[11.5px] text-muted">Valor comercial gestionat: {fmt(stats.tot.valor, 0)} MWh/any de consum registrat a la cartera visible. Els tancaments importats de l'origen no compten per al temps mitjà.</p>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Comparació entre comercials">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stats.rows.slice(0, 8)} margin={{ left: -16 }}>
              <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
              <XAxis dataKey="comercial" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tip} cursor={{ fill: "rgb(var(--ink) / 0.04)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="pendientes" name="Pendents" fill="rgb(var(--pend))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="contactados" name="Contactats" fill="rgb(var(--cont))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="renovados" name="Renovats" fill="rgb(var(--ren))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="perdidos" name="Perduts" fill="rgb(var(--lost))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Evolució mensual de tancaments (gestionats al CRM)">
          {stats.monthly.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={stats.monthly} margin={{ left: -16, right: 8 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                <XAxis dataKey="mes" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tip} />
                <Line dataKey="renovados" name="Renovats" stroke="rgb(var(--ren))" strokeWidth={2} dot={false} />
                <Line dataKey="perdidos" name="Perduts" stroke="rgb(var(--lost))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty icon={null} title="Encara no hi ha tancaments registrats al CRM" body="Els renovats i perduts que vénen del full no tenen una data de tancament fiable." />}
        </Card>
        <Card title="Motius de rebuig">
          {stats.motivos.length ? (
            <ResponsiveContainer width="100%" height={Math.max(120, stats.motivos.length * 34)}>
              <BarChart data={stats.motivos} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="motivo" tick={axis} tickLine={false} axisLine={false} width={170} />
                <Tooltip contentStyle={tip} cursor={{ fill: "rgb(var(--ink) / 0.04)" }} />
                <Bar dataKey="n" name="Contractes" fill="rgb(var(--lost))" maxBarSize={26} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: "rgb(var(--ink))" }} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty icon={null} title="Cap rebuig registrat" />}
        </Card>
        <Card title="Detall per comercial">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-muted">{["Comercial", "Renov.", "Perd.", "Èxit", "MWh renov.", "Propostes", "Dies tancament"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{stats.rows.map((r) => (
                <tr key={r.comercial} className="border-t border-line/60 tnum">
                  <td className="px-2 py-1.5 font-medium">{r.comercial}</td><td className="px-2">{r.renovados}</td><td className="px-2">{r.perdidos}</td><td className="px-2">{r.exito === null ? "—" : `${r.exito}%`}</td><td className="px-2">{fmt(r.mwh, 1)}</td><td className="px-2">{r.propuestas}</td><td className="px-2">{r.tiempoMedio ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-line bg-surface p-4"><h3 className="mb-3 text-[13px] font-semibold">{title}</h3>{children}</section>;
}
