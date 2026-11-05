"use client";
/**
 * Botó «Exporta a Excel» de cada pantalla.
 *  - Amb `set`: el servidor exporta amb els MATEIXOS filtres que la pantalla (i només la selecció, si n'hi ha).
 *  - Amb `rows`: per a pantalles que ja tenen totes les dades carregades, l'Excel es fa al navegador amb les files visibles.
 */
import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useApp } from "@/data/store";
import { Button } from "./ui";

type Params = Record<string, string | number | boolean | null | undefined | string[]>;

function toQuery(set: string, params: Params, ids?: string[]) {
  const q = new URLSearchParams({ r: "xlsx", entity: set });
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : v === true ? "1" : String(v));
  }
  if (ids?.length) q.set("ids", ids.join(","));
  return q.toString();
}

async function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ExportButton({ set, params = {}, ids, rows, fileName, label, size = "sm", className, visible }: {
  set?: string; params?: Params; ids?: string[];
  /** files que mostra la pantalla (quan la pantalla filtra al navegador): s'exporten exactament aquestes */
  visible?: string[];
  rows?: () => Record<string, unknown>[]; fileName?: string;
  label?: string; size?: "sm" | "md"; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useApp((s) => s.toast);
  const text = label ?? (ids?.length ? `Exporta ${ids.length} a Excel` : "Exporta a Excel");
  const run = async () => {
    setBusy(true);
    try {
      if (rows) {
        const data = rows();
        if (!data.length) { toast({ title: "No hi ha cap fila per exportar", tone: "info" }); return; }
        const XLSX = await import("xlsx");
        const ws = XLSX.utils.json_to_sheet(data);
        ws["!cols"] = Object.keys(data[0]).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2, ...data.slice(0, 200).map((r) => String(r[k] ?? "").length))) }));
        ws["!autofilter"] = { ref: ws["!ref"] ?? "A1" };
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Dades");
        const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
        await saveBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${fileName ?? "exportacio"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        toast({ title: `Excel descarregat (${data.length} files)`, tone: "ok" });
        return;
      }
      if (!set) return;
      const sel = ids?.length ? ids : visible;
      if (visible && !sel?.length) { toast({ title: "No hi ha cap fila per exportar", tone: "info" }); return; }
      // amb molts identificadors l'adreça seria massa llarga: s'envien al cos (POST)
      const r = sel && sel.length > 40
        ? await fetch("/api/export", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: set, params: Object.fromEntries(new URLSearchParams(toQuery(set, params))), ids: sel }) })
        : await fetch(`/api/export?${toQuery(set, params, sel)}`, { cache: "no-store" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error ?? `Error ${r.status}`); }
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `${set}.xlsx`;
      await saveBlob(await r.blob(), name);
      toast({ title: "Excel descarregat", body: sel?.length ? `${sel.length} files` : "Amb els filtres de la pantalla", tone: "ok" });
    } catch (e) {
      toast({ title: "No s'ha pogut exportar", body: e instanceof Error ? e.message : String(e), tone: "err" });
    } finally { setBusy(false); }
  };
  return <Button size={size} className={className} disabled={busy} onClick={() => void run()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} {text}</Button>;
}
