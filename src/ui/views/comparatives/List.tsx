"use client";
/** Llista de comparatives i detall (documents, enviaments, enllaços privats i historial de la recomanació). */
import { CupsLink } from "../../components/Navigation";
import { useEffect, useState } from "react";
import { FileText, Link2, Loader2, Plus, RefreshCw } from "lucide-react";
import { comparisonsApi, serverMode, type ComparisonRow } from "@/comparator/client";
import type { Snapshot } from "@/comparator/snapshot";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice } from "../../components/ui";
import { useWizard } from "./state";

const STATUS: Record<string, { label: string; tone: "zinc" | "blue" | "green" | "amber" }> = { esborrany: { label: "Esborrany", tone: "zinc" }, emesa: { label: "Emesa", tone: "blue" }, enviada: { label: "Enviada", tone: "green" }, arxivada: { label: "Arxivada", tone: "amber" } };
const MODE: Record<string, string> = { factura: "Factura", cups: "Només CUPS", cups_preus: "CUPS + preus", manual: "Manual", massiva: "Massiva" };
const eur = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));

export function ComparativesListView() {
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(() => useApp.getState().params.open ?? null);
  const load = () => comparisonsApi.list().then((r) => setRows(r.rows)).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    if (serverMode()) void load();
  }, []);
  const nova = () => {
    useWizard.getState().reset();
    useApp.getState().navigate("comparativa");
  };
  return (
    <div className="mx-auto max-w-[1300px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Comparatives</h2>
          <p className="text-[13px] text-muted">Propostes desades, emeses i enviades. Les emeses conserven sempre els preus amb què es van calcular.</p>
        </div>
        <div className="flex gap-2">
          {serverMode() && <Button onClick={load}><RefreshCw size={14} /> Actualitza</Button>}
          <Button variant="primary" onClick={nova}><Plus size={15} /> Nova comparativa</Button>
        </div>
      </div>
      {!serverMode() && <Notice tone="blue">Mode local: les comparatives no es desen. Pots crear-ne i descarregar-ne el PDF.</Notice>}
      {error && <Notice tone="red">{error.includes("comparisons") ? "Falta executar la migració 006_comparatives_ia.sql." : error}</Notice>}
      {serverMode() && !rows && !error && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Carregant…</p>}
      {rows && rows.length === 0 && <Empty icon={<FileText size={22} />} title="Encara no hi ha comparatives" body="Crea'n una a partir d'una factura, d'un CUPS o de dades manuals." action={<Button variant="primary" size="sm" onClick={nova}>Nova comparativa</Button>} />}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-2 text-left">Client</th><th className="px-3 py-2 text-left">CUPS</th><th className="px-3 py-2 text-left">Origen</th><th className="px-3 py-2 text-left">Recomanada</th><th className="px-3 py-2 text-right">Estalvi</th><th className="px-3 py-2 text-left">Estat</th><th className="px-3 py-2 text-left">Data</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-ink/[0.03]" onClick={() => setOpen(r.id)}>
                  <td className="px-3 py-2 font-medium">{r.client_name ?? "—"}</td>
                  <td className="px-3 py-2 text-[11.5px]">{r.cups ? <CupsLink cups={r.cups} /> : "—"}</td>
                  <td className="px-3 py-2">{MODE[r.mode] ?? r.mode}</td>
                  <td className="px-3 py-2">{r.supplierName ?? "—"}</td>
                  <td className="px-3 py-2 text-right tnum">{eur(r.saving)}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS[r.status]?.tone ?? "zinc"}>{STATUS[r.status]?.label ?? r.status}</Badge></td>
                  <td className="px-3 py-2 text-muted">{new Date(r.created_at).toLocaleDateString("ca-ES")} · {r.created_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

type DetailData = {
  comparison: { id: string; status: string; contract_id: string | null; client_name: string | null; snapshot: Snapshot; recommendation: { edited?: { text: string; by: string; at: string } | null; history: { at: string; by: string; action: string }[] } | null };
  documents: { id: string; kind: string; lang: string; created_at: string }[];
  deliveries: { id: string; channel: string; recipient: string | null; status: string; subject: string | null; created_at: string; error: string | null }[];
  shares: { id: string; expires_at: string; revoked_at: string | null; views: number; last_view_at: string | null }[];
};

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<DetailData | null>(null);
  const toast = useApp((s) => s.toast);
  const load = () => comparisonsApi.action<DetailData>({ action: "get", id }).then(setD).catch((e) => toast({ title: "Error", body: String(e), tone: "err" }));
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const reopen = () => {
    if (!d) return;
    const s = d.comparison.snapshot;
    const w = useWizard.getState();
    w.reset({
      mode: s.mode === "massiva" ? "cups" : s.mode,
      contractId: d.comparison.contract_id,
      client: s.client,
      cups: s.cups ?? "",
      supply: s.supply,
      current: s.current,
      currentRetailer: s.currentRetailer ?? "",
      // versions sense ajustos + els ajustos desats (no s'apliquen dues vegades)
      catalog: s.baseOffers ?? s.offers,
      selected: s.offers.map((o) => o.id),
      adjustments: s.adjustments ?? {},
      dataNotes: s.dataNotes,
      observations: s.observations ?? "",
      recommendation: d.comparison.recommendation?.edited?.text ?? "",
      savedId: d.comparison.status === "esborrany" ? d.comparison.id : null,
      savedStatus: d.comparison.status === "esborrany" ? "esborrany" : null,
      step: 4,
    });
    useApp.getState().navigate("comparativa");
  };
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={d?.comparison.client_name ?? "Comparativa"} footer={d && <Button variant="primary" onClick={reopen}>{d.comparison.status === "esborrany" ? "Continua editant" : "Duplica com a nova"}</Button>}>
      {!d ? <Loader2 className="animate-spin" /> : (
        <div className="space-y-3 text-[13px]">
          <p className="text-muted">Motor {d.comparison.snapshot.engineVersion} · calculada el {new Date(d.comparison.snapshot.computedAt).toLocaleString("ca-ES")} · {d.comparison.snapshot.offers.length} ofertes (còpia dels preus d&apos;aquell moment)</p>
          <section><h4 className="font-semibold">Documents</h4>{d.documents.length ? d.documents.map((x) => <p key={x.id} className="text-muted">{x.kind} · {x.lang} · {new Date(x.created_at).toLocaleString("ca-ES")}</p>) : <p className="text-muted">Cap PDF desat.</p>}</section>
          <section><h4 className="font-semibold">Enviaments</h4>{d.deliveries.length ? d.deliveries.map((x) => <p key={x.id} className="text-muted">{x.channel} · {x.recipient ?? "—"} · <b className={x.status === "error" ? "text-lost" : "text-ink"}>{x.status}</b> · {new Date(x.created_at).toLocaleString("ca-ES")}{x.error ? ` · ${x.error}` : ""}</p>) : <p className="text-muted">Cap enviament.</p>}</section>
          <section>
            <h4 className="font-semibold">Enllaços privats</h4>
            {d.shares.length ? d.shares.map((x) => (
              <div key={x.id} className="flex items-center justify-between gap-2 text-muted">
                <span><Link2 size={12} className="mr-1 inline" />fins al {new Date(x.expires_at).toLocaleDateString("ca-ES")} · {x.views} visites{x.revoked_at ? " · revocat" : ""}</span>
                {!x.revoked_at && <Button size="sm" variant="ghost" onClick={async () => { await comparisonsApi.action({ action: "revoke", shareId: x.id }); void load(); }}>Revoca</Button>}
              </div>
            )) : <p className="text-muted">Cap enllaç.</p>}
          </section>
          {d.comparison.recommendation?.history?.length ? <section><h4 className="font-semibold">Traçabilitat de la recomanació</h4>{d.comparison.recommendation.history.map((h, i) => <p key={i} className="text-muted">{new Date(h.at).toLocaleString("ca-ES")} · {h.by} · {h.action}</p>)}</section> : null}
        </div>
      )}
    </Modal>
  );
}
