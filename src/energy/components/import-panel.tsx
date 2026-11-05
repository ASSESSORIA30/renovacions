"use client";
import { useRef, useState } from "react";
import { FileSpreadsheet, FlaskConical, Loader2, UploadCloud } from "lucide-react";
import { toast } from "@/energy/compat/toast";
import { useRouter } from "@/energy/compat/navigation";
import { useStore } from "@/energy/lib/store";
import type { ImportReport } from "@/energy/lib/types";
import { Badge, Button, Callout, Collapse } from "./ui";
import { cn, fmt } from "@/energy/lib/format";
import { energyApi, serverEnabled } from "@/energy/api";
import { useApp } from "@/data/store";
import { isStaff } from "@/core/roles";

export function ImportPanel({ onDone, big }: { onDone?: () => void; big?: boolean }) {
  const importRows = useStore((s) => s.importRows);
  const loadDemo = useStore((s) => s.loadDemo);
  const hasReal = useStore((s) => s.supplies.some((x) => !x.source.demo));
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const staff = useApp((s) => !!s.snap && isStaff(s.snap.me.role));
  const [toServer, setToServer] = useState(true);
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handle(file: File) {
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error("Formato no admitido: selecciona un fichero .xlsx");
      return;
    }
    setBusy(true);
    try {
      const { readWorkbook } = await import("@/energy/lib/xlsx");
      const { rows, sheet } = await readWorkbook(await file.arrayBuffer());
      const r = importRows(rows, { file: file.name, sheet, origin: "excel" }, mode);
      setReport(r);
      if (r.imported > 0) toast.success(`${fmt.n(r.imported)} subministraments importats`);
      else toast.warning("El fitxer no conté subministraments");
      if (r.imported > 0 && serverEnabled() && staff && toServer) {
        const plain = rows.map((row) => row.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)));
        let saved = 0, skipped = 0;
        for (let i = 1; i < plain.length; i += 500) {
          const res = await energyApi.importRows(file.name, [plain[0], ...plain.slice(i, i + 500)]);
          saved += res.saved;
          skipped += res.skipped;
        }
        toast.success(`Desat a Supabase: ${fmt.n(saved)} CUPS`, { description: skipped ? `${fmt.n(skipped)} no s'han substituït perquè tenen dades del portal més recents.` : undefined });
      }
    } catch (e) {
      toast.error(`No se pudo leer el Excel: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handle(f);
        }}
        onClick={() => ref.current?.click()}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed border-border-strong bg-surface/50 text-center transition hover:border-accent",
          big ? "p-12" : "p-8",
          drag && "border-accent bg-accent/5",
        )}
      >
        <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-accent/20 to-accent-2/20 text-accent">
          {busy ? <Loader2 className="size-7 animate-spin" /> : <UploadCloud className="size-7" />}
        </div>
        <div>
          <div className="font-medium">Arrastra aquí el Excel SIPS o haz clic</div>
          <div className="mt-1 text-xs text-fg-3">PuntoSuministro_*.xlsx · se procesa en tu navegador, sin enviarse a terceros</div>
        </div>
        <input ref={ref} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-border p-0.5 text-xs">
          {(["replace", "merge"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1.5", mode === m ? "bg-surface-2 text-fg" : "text-fg-3")}>
              {m === "replace" ? "Sustituir cartera" : "Añadir / actualizar por CUPS"}
            </button>
          ))}
        </div>
        {serverEnabled() && staff && (
          <label className="flex items-center gap-2 text-xs text-fg-2">
            <input type="checkbox" checked={toServer} onChange={(e) => setToServer(e.target.checked)} /> Desa també a Supabase (compartit amb l&apos;equip)
          </label>
        )}
        {!hasReal && !serverEnabled() && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const r = loadDemo();
              setReport(r);
              toast.success("Datos sintéticos de demostración cargados");
              onDone?.();
              router.push("/");
            }}
          >
            <FlaskConical /> Cargar datos de demostración
          </Button>
        )}
      </div>
      {report && <ImportReportView r={report} onOpen={onDone} />}
    </div>
  );
}

export function ImportReportView({ r, onOpen }: { r: ImportReport; onOpen?: () => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Filas", r.totalRows],
          ["Importados", r.imported],
          ["Columnas reconocidas", `${r.recognized.length}/97`],
          ["CUPS no válidos", r.invalidCups.length],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border border-border bg-surface-2/50 p-3">
            <div className="text-[11px] text-fg-3">{k}</div>
            <div className="num text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {r.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}
      <Collapse
        title={
          <>
            <FileSpreadsheet className="size-4 text-accent" /> Detalle de columnas · {r.file}
          </>
        }
        right={r.demo ? <Badge tone="warning">DEMO</Badge> : undefined}
      >
        <div className="space-y-2 text-xs text-fg-2">
          <p>
            Hoja <b>{r.sheet}</b> · {r.headerCount} cabeceras · importado {fmt.dateTime(r.importedAt)}
          </p>
          {r.missing.length > 0 && <p>Columnas esperadas ausentes: {r.missing.join(", ")}</p>}
          {r.extra.length > 0 && <p>Columnas adicionales conservadas en la ficha técnica: {r.extra.join(", ")}</p>}
          {r.duplicates.length > 0 && <p>CUPS repetidos (se conserva la última fila): {r.duplicates.join(", ")}</p>}
          {r.missing.length === 0 && r.extra.length === 0 && <p className="text-good">Estructura idéntica a la exportación SIPS de referencia (97 columnas).</p>}
        </div>
      </Collapse>
      {r.imported > 0 && onOpen && (
        <Button className="w-full" onClick={onOpen}>
          Ver cartera
        </Button>
      )}
    </div>
  );
}
