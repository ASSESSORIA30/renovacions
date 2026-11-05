"use client";
/**
 * COMPARATIVES MASSIVES: un Excel amb desenes o centenars de CUPS.
 * Cua amb concurrència 2 contra el servidor (memòria cau SIPS primer, portal només si cal),
 * reintents amb espera si el servidor limita (429). No es disparen centenars de consultes alhora.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { Download, FileDown, Loader2, Pause, Play, Upload } from "lucide-react";
import { loadCatalog, serverMode, type CatalogItem } from "@/comparator/client";
import { normalizeTariff } from "@/comparator/engine";
import { renderComparisonPdf } from "@/comparator/pdf";
import { ruleRecommendation } from "@/comparator/recommend";
import { buildSnapshot, type Snapshot } from "@/comparator/snapshot";
import { emptySheet, type SupplyInput } from "@/comparator/types";
import { isValidCups, normalizedCups } from "@/core/sips";
import { energyApi } from "@/energy/api";
import { useApp } from "@/data/store";
import { Badge, Button, Notice } from "../../components/ui";
import { DropZone } from "../../components/DropZone";

interface Item {
  row: number;
  client: string | null;
  cups: string;
  currentPrice: number | null; // preu actual únic €/kWh (opcional al fitxer)
  status: "pendent" | "consultant" | "fet" | "sense_dades" | "error" | "invalid";
  message?: string;
  snapshot?: Snapshot;
}

const eur = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function MassComparisonView() {
  const { snap, toast } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  useEffect(() => {
    loadCatalog().then((r) => setCatalog(r.items)).catch(() => undefined);
  }, []);

  const onFile = async (f: File) => {
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
    const head = (rows[0] ?? []).map((h) => String(h ?? "").toLowerCase());
    const ci = head.findIndex((h) => h.includes("cups"));
    const ni = head.findIndex((h) => /client|titular|nombre|nom/.test(h));
    const pi = head.findIndex((h) => /precio|preu|price/.test(h));
    if (ci < 0) return toast({ title: "El fitxer ha de tenir una columna «CUPS»", tone: "err" });
    const seen = new Set<string>();
    const list: Item[] = [];
    rows.slice(1, 1001).forEach((r, i) => {
      const raw = String(r[ci] ?? "").trim();
      if (!raw) return;
      const key = normalizedCups(raw);
      if (seen.has(key)) return; // deduplicació
      seen.add(key);
      const price = pi >= 0 && r[pi] != null ? Number(String(r[pi]).replace(",", ".")) : null;
      list.push({ row: i + 2, client: ni >= 0 ? String(r[ni] ?? "") || null : null, cups: raw.toUpperCase().replace(/[\s.-]/g, ""), currentPrice: price != null && Number.isFinite(price) && price > 0 && price < 1 ? price : null, status: isValidCups(raw) ? "pendent" : "invalid", message: isValidCups(raw) ? undefined : "CUPS no vàlid" });
    });
    setItems(list);
  };

  const process = async (it: Item): Promise<Item> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        let { entry } = await energyApi.supply(it.cups);
        if (!entry || entry.status !== "found") entry = (await energyApi.refresh(it.cups, false)).entry;
        if (entry.status !== "found" || entry.annual_kwh == null) return { ...it, status: "sense_dades", message: entry.error ?? "Sense consum anual al SIPS" };
        const gas = entry.energy_type === "gas" || /^RL/i.test(entry.tariff ?? "");
        const supply: SupplyInput = { energyType: gas ? "gas" : "luz", accessTariff: normalizeTariff(entry.tariff) ?? null, territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: Array(6).fill(null), kwhTotal: entry.annual_kwh, kw: entry.contracted_power_kw ?? Array(6).fill(null), meterRentEurMonth: null };
        const offers = catalog.filter((o) => o.energyType === supply.energyType && normalizeTariff(o.accessTariff) === supply.accessTariff);
        const first = buildSnapshot({ mode: "massiva", supply, current: null, offers });
        const top = first.result.ranked.slice(0, 3).map((e) => e.offer);
        // El preu actual (si el fitxer el porta) només es pot aplicar a un preu únic d'energia; la potència es deixa sense preu → cost actual incomplet si cal.
        const current = it.currentPrice != null ? { ...emptySheet(), contractType: "fix24h" as const, energy24h: it.currentPrice } : null;
        const s = buildSnapshot({ mode: "massiva", client: { name: it.client, taxId: null, address: entry.address ?? null, email: null, phone: null }, cups: entry.returned_cups ?? it.cups, supply, current, currentRetailer: entry.retailer ?? null, offers: top.length ? top : offers.slice(0, 3), dataNotes: ["Comparativa massiva amb el consum anual del SIPS (sense repartiment per períodes)."] });
        return { ...it, status: "fet", snapshot: s, message: !top.length ? "Cap oferta elegible i calculable amb el consum anual" : undefined };
      } catch (e) {
        const st = (e as { status?: number }).status;
        if (st === 429 && attempt < 3) {
          await sleep(15_000 * (attempt + 1)); // límit per minut del servidor: s'espera i es reintenta
          continue;
        }
        return { ...it, status: "error", message: e instanceof Error ? e.message : String(e) };
      }
    }
    return { ...it, status: "error", message: "Massa reintents" };
  };

  const start = async () => {
    if (!serverMode()) return toast({ title: "Les comparatives massives necessiten el servidor (SIPS)", tone: "err" });
    stop.current = false;
    setRunning(true);
    const queue = items.filter((x) => x.status === "pendent" || x.status === "error");
    const worker = async () => {
      while (queue.length && !stop.current) {
        const it = queue.shift()!;
        setItems((xs) => xs.map((x) => (x.row === it.row ? { ...x, status: "consultant" } : x)));
        const done = await process(it);
        setItems((xs) => xs.map((x) => (x.row === it.row ? done : x)));
        await sleep(400);
      }
    };
    await Promise.all([worker(), worker()]); // concurrència 2
    setRunning(false);
  };

  const rows = useMemo(() => items.map((it) => {
    const s = it.snapshot;
    const best = s?.result.ranked[0];
    return { it, s, best, mwh: s?.supply.kwhTotal != null ? s.supply.kwhTotal / 1000 : null };
  }), [items]);
  const counts = useMemo(() => items.reduce<Record<string, number>>((a, x) => ((a[x.status] = (a[x.status] ?? 0) + 1), a), {}), [items]);

  const exportXlsx = () => {
    const data = rows.map(({ it, s, best, mwh }) => ({ Fila: it.row, Client: it.client ?? "", CUPS: s?.cups ?? it.cups, Tarifa: s?.supply.accessTariff ?? "", MWh: mwh != null ? Math.round(mwh * 100) / 100 : "", "Cost actual (€)": s?.result.current?.ok ? s.result.current.total : "", "Millor oferta": best ? `${best.offer.supplierName} · ${best.offer.productName}` : "", "Cost millor (€)": best?.cost.total ?? "", "Estalvi anual (€)": best?.saving ?? "", Estat: it.status, Observacions: it.message ?? (s && !s.result.current ? "Sense preus actuals: no es calcula estalvi" : "") }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Comparatives");
    XLSX.writeFile(wb, `comparatives-massives-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const company = snap?.settings.empresa ?? { nombre: "Assessoria 3.0", telefono: "", email: "", web: "", direccion: "" };
  const pdfFor = (s: Snapshot) => renderComparisonPdf(s, { kind: "resum", lang: "ca", recommendation: ruleRecommendation(s, "ca"), company, salesperson: snap?.me.name ?? null, logo: snap?.settings.logo ?? null });
  const zipAll = async () => {
    const zip = new JSZip();
    for (const { s } of rows) if (s && s.result.ranked.length) { const p = pdfFor(s); zip.file(`${s.cups ?? "cups"}-${p.fileName}`, p.bytes); }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `propostes-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
  };

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Comparatives massives</h2>
        <p className="text-[13px] text-muted">Carrega un Excel amb una columna «CUPS» (i opcionalment «Client» i «Preu actual €/kWh»). Es fan servir les dades SIPS desades i, si cal, es consulta el portal amb una cua controlada.</p>
      </div>
      {!serverMode() && <Notice tone="blue">Mode local: cal el servidor de la plataforma per consultar el SIPS.</Notice>}
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="block min-w-[260px]"><span className="label">Fitxer Excel / CSV</span><DropZone accept=".xlsx,.xls,.csv" className="p-3" onFiles={([f]) => void onFile(f)}><span className="text-[12.5px]">Arrossega'l aquí o fes clic</span></DropZone></div>
        {items.length > 0 && (
          <>
            {!running ? <Button variant="primary" onClick={start}><Play size={14} /> Processa ({items.filter((x) => x.status === "pendent" || x.status === "error").length})</Button> : <Button onClick={() => (stop.current = true)}><Pause size={14} /> Atura</Button>}
            <Button onClick={exportXlsx}><Download size={14} /> Exporta a Excel</Button>
            <Button onClick={zipAll} disabled={!rows.some((r) => r.s?.result.ranked.length)}><FileDown size={14} /> PDFs (ZIP)</Button>
            <div className="flex flex-wrap gap-1.5 text-[12px]">{Object.entries(counts).map(([k, v]) => <Badge key={k} tone={k === "fet" ? "green" : k === "error" || k === "invalid" ? "red" : k === "sense_dades" ? "amber" : "zinc"}>{k}: {v}</Badge>)}</div>
          </>
        )}
      </section>
      {items.length === 0 ? <Notice tone="blue"><Upload size={14} className="mr-1 inline" /> Sense preus actuals al fitxer no es calcula estalvi: només es classifiquen les ofertes. Les ofertes per períodes necessiten el repartiment P1–P6, que el SIPS no dona.</Notice> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2 text-left">Client</th><th className="px-3 py-2 text-left">CUPS</th><th className="px-3 py-2 text-left">Tarifa</th><th className="px-3 py-2 text-right">MWh</th><th className="px-3 py-2 text-right">Cost actual</th><th className="px-3 py-2 text-left">Millor oferta</th><th className="px-3 py-2 text-right">Estalvi anual</th><th className="px-3 py-2 text-left">Validació</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {rows.map(({ it, s, best, mwh }) => (
                <tr key={it.row} className="border-t border-line">
                  <td className="px-3 py-1.5">{it.client ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{s?.cups ?? it.cups}</td>
                  <td className="px-3 py-1.5">{s?.supply.accessTariff ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tnum">{mwh != null ? mwh.toLocaleString("ca-ES", { maximumFractionDigits: 2 }) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tnum">{s?.result.current?.ok ? eur(s.result.current.total) : "—"}</td>
                  <td className="px-3 py-1.5">{best ? `${best.offer.supplierName} · ${eur(best.cost.total)}` : "—"}</td>
                  <td className="px-3 py-1.5 text-right tnum">{best?.saving != null ? eur(best.saving) : "—"}</td>
                  <td className="px-3 py-1.5">{it.status === "consultant" ? <Loader2 size={13} className="animate-spin" /> : <span className={it.status === "fet" ? "text-ren" : it.status === "pendent" ? "text-muted" : "text-lost"}>{it.status}{it.message ? ` · ${it.message}` : ""}</span>}</td>
                  <td className="px-3 py-1.5 text-right">{s && best && <Button size="sm" variant="ghost" onClick={() => { const p = pdfFor(s); const a = document.createElement("a"); a.href = URL.createObjectURL(p.blob); a.download = p.fileName; a.click(); }}>PDF</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
