"use client";
/**
 * MARGES I COMISSIONS (només administradors).
 * Separat del rànquing de conveniència del client: aquí es veu la remuneració, però el motor no la fa servir.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { commissionsApi, comparisonsApi, loadCatalog, type CatalogItem } from "@/comparator/client";
import type { Snapshot } from "@/comparator/snapshot";
import { useApp } from "@/data/store";
import { Button, Notice } from "../../components/ui";

type Row = { product_id: string; company_eur_mwh: number | null; company_fixed_eur: number | null; salesperson_pct: number | null; notes: string | null };
const eur = (n: number) => n.toLocaleString("ca-ES", { style: "currency", currency: "EUR" });

export function CommissionsView() {
  const admin = useApp((s) => s.snap?.me.role === "admin");
  const toast = useApp((s) => s.toast);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [issued, setIssued] = useState<{ id: string; client: string | null; snapshot?: Snapshot }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!admin) return;
    loadCatalog().then((r) => setItems(r.items.filter((x) => x.origin !== "crm"))).catch((e) => setError(String(e)));
    commissionsApi.list().then((r) => setRows(Object.fromEntries(r.rows.map((x) => [x.product_id, x])))).catch((e) => setError(String(e)));
    comparisonsApi.list().then(async (r) => {
      const list = r.rows.filter((x) => x.status !== "esborrany").slice(0, 40);
      const full = await Promise.all(list.map((x) => comparisonsApi.action<{ comparison: { snapshot: Snapshot } }>({ action: "get", id: x.id }).then((d) => ({ id: x.id, client: x.client_name, snapshot: d.comparison.snapshot })).catch(() => ({ id: x.id, client: x.client_name }))));
      setIssued(full);
    }).catch(() => undefined);
  }, [admin]);

  // Rendibilitat estimada de les propostes emeses (segons l'oferta recomanada pel motor, no per la comissió).
  const profit = useMemo(() => issued.map((c) => {
    const best = c.snapshot?.result.ranked[0];
    const r = best ? rows[best.offer.productId] : undefined;
    const kwh = c.snapshot?.supply.kwhTotal ?? (c.snapshot?.supply.kwh.every((x) => x != null) ? c.snapshot.supply.kwh.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
    const company = r && kwh != null ? (r.company_eur_mwh ?? 0) * (kwh / 1000) + (r.company_fixed_eur ?? 0) : null;
    return { c, best, company, salesperson: company != null && r?.salesperson_pct != null ? (company * r.salesperson_pct) / 100 : null };
  }), [issued, rows]);

  if (!admin) return <div className="p-6"><Notice tone="red">Aquesta vista és exclusiva dels administradors.</Notice></div>;
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><ShieldAlert size={19} className="text-lost" /> Marges i comissions</h2>
        <p className="text-[13px] text-muted">Només administradors. Aquestes dades no apareixen al PDF del client ni intervenen en el rànquing de conveniència.</p>
      </div>
      {error && <Notice tone="red">{error.includes("offer_commissions") ? "Falta executar la migració 006." : error}</Notice>}
      <section className="overflow-x-auto rounded-2xl border border-line bg-surface">
        {!items ? <Loader2 className="m-4 animate-spin" /> : (
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2 text-left">Producte</th><th className="px-3 py-2 text-left">Assessoria 3.0 (€/MWh)</th><th className="px-3 py-2 text-left">Fix per contracte (€)</th><th className="px-3 py-2 text-left">Comercial (%)</th><th className="px-3 py-2 text-left">Notes</th><th /></tr></thead>
            <tbody>
              {items.map((o) => {
                const r = rows[o.productId] ?? { product_id: o.productId, company_eur_mwh: null, company_fixed_eur: null, salesperson_pct: null, notes: null };
                const upd = (p: Partial<Row>) => setRows({ ...rows, [o.productId]: { ...r, ...p } });
                const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v.replace(",", "."))));
                return (
                  <tr key={o.id} className="border-t border-line">
                    <td className="px-3 py-1.5">{o.supplierName} · {o.productName} <span className="text-muted">({o.accessTariff})</span></td>
                    <td className="px-3 py-1.5"><input className="input h-8 w-28" defaultValue={r.company_eur_mwh ?? ""} onBlur={(e) => upd({ company_eur_mwh: num(e.target.value) })} /></td>
                    <td className="px-3 py-1.5"><input className="input h-8 w-28" defaultValue={r.company_fixed_eur ?? ""} onBlur={(e) => upd({ company_fixed_eur: num(e.target.value) })} /></td>
                    <td className="px-3 py-1.5"><input className="input h-8 w-20" defaultValue={r.salesperson_pct ?? ""} onBlur={(e) => upd({ salesperson_pct: Math.min(100, num(e.target.value) ?? 0) || null })} /></td>
                    <td className="px-3 py-1.5"><input className="input h-8" defaultValue={r.notes ?? ""} onBlur={(e) => upd({ notes: e.target.value || null })} /></td>
                    <td className="px-3 py-1.5"><Button size="sm" onClick={async () => { try { await commissionsApi.save({ productId: o.productId, companyEurMwh: r.company_eur_mwh, companyFixedEur: r.company_fixed_eur, salespersonPct: r.salesperson_pct, notes: r.notes }); toast({ title: "Desat", tone: "ok" }); } catch (e) { toast({ title: "Error", body: String(e), tone: "err" }); } }}>Desa</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-2 text-[14px] font-semibold">Rendibilitat de les propostes emeses (anàlisi separada)</h3>
        <table className="w-full text-[12.5px]">
          <thead className="text-[11px] uppercase text-muted"><tr><th className="py-1 text-left">Client</th><th className="py-1 text-left">Oferta recomanada (per conveniència)</th><th className="py-1 text-right">Estalvi client</th><th className="py-1 text-right">Assessoria 3.0</th><th className="py-1 text-right">Comercial</th></tr></thead>
          <tbody>{profit.map(({ c, best, company, salesperson }) => <tr key={c.id} className="border-t border-line"><td className="py-1">{c.client ?? "—"}</td><td className="py-1">{best ? `${best.offer.supplierName} · ${best.offer.productName}` : "—"}</td><td className="py-1 text-right tnum">{best?.saving != null ? eur(best.saving) : "—"}</td><td className="py-1 text-right tnum">{company != null ? eur(company) : "—"}</td><td className="py-1 text-right tnum">{salesperson != null ? eur(salesperson) : "—"}</td></tr>)}</tbody>
        </table>
        {!profit.length && <p className="text-[12.5px] text-muted">Encara no hi ha propostes emeses.</p>}
      </section>
    </div>
  );
}
