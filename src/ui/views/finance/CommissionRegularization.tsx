"use client";
/**
 * REGULARITZACIÓ DE COMISSIONS (059) · només Direcció.
 * 1) «Revisa (simulació)»: recorre tots els contractes d'energia sense càlcul, per lots, i els classifica sense escriure res.
 * 2) «Aplica un lot»: a partir de la darrera revisió completada, calcula (només estimacions) els elegibles no protegits.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { useApp } from "@/data/store";
import { Badge, Button, Notice } from "../../components/ui";
import { fApi, fmtD } from "./api";

type Counts = Record<string, number>;
interface Run { id: string; mode: "dry_run" | "apply"; status: string; based_on: string | null; started_by_name: string | null; started_at: string; finished_at: string | null; cursor: string | null; counts: Counts }
interface Item { contract_id: string; category: string; reasons: string[]; provider_status: string | null; provider_amount: string | null; action: string; crm_contracts?: { retailer: string | null; product: string | null; service: string | null; crm_clients?: { name: string } | null } | null }
interface Page { runId: string; done: boolean; nextCursor: string | null; counts: Counts }

const CAT: Record<string, { label: string; tone: "green" | "amber" | "red" | "zinc" | "blue" }> = {
  calculable: { label: "Calculable", tone: "green" }, pendent_dades: { label: "Pendent de dades", tone: "amber" }, pendent_regla: { label: "Pendent de regla", tone: "amber" },
  protegit: { label: "Protegit", tone: "blue" }, conflicte: { label: "Conflicte", tone: "red" },
};
const ACTION: Record<string, string> = { revisat: "Revisat", regularitzat: "Regularitzat", marcat_pendent: "Marcat pendent", omes_protegit: "Omès (protegit)", omes_ja_calculat: "Omès (ja calculat)", error: "Error" };
const COUNT_ORDER = ["revisats", "ja_calculats", "calculable", "pendent_dades", "pendent_regla", "protegit", "conflicte", "regularitzat", "marcat_pendent", "omes_protegit", "omes_ja_calculat", "error"];
const COUNT_LABEL: Record<string, string> = { revisats: "Revisats", ja_calculats: "Ja tenien càlcul", ...Object.fromEntries(Object.entries(CAT).map(([k, v]) => [k, v.label])), ...ACTION };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CommissionRegularizationPanel() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [items, setItems] = useState<{ runId: string; rows: Item[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setRuns((await fApi.get<{ runs: Run[] }>("regularization")).runs); setErr(null); } catch (e) { setErr(errMsg(e)); } }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const show = async (runId: string) => { try { setItems({ runId, rows: (await fApi.get<{ items: Item[] }>("regularization", { id: runId })).items }); } catch (e) { setErr(errMsg(e)); } };

  const dryRun = async () => {
    setBusy("dry"); setErr(null);
    try {
      let runId: string | undefined, after: string | null = null, p: Page;
      do { p = await fApi.act<Page>("regularize", { data: { mode: "dry_run", runId, after, limit: 50 } }); runId = p.runId; after = p.nextCursor; } while (!p.done);
      useApp.getState().toast({ title: "Revisió completada (sense canvis)", body: `${p.counts.revisats ?? 0} contractes revisats · ${p.counts.calculable ?? 0} calculables`, tone: "ok" });
      await load(); await show(p.runId);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };
  const lastDry = runs?.find((r) => r.mode === "dry_run" && r.status === "completat") ?? null;
  const openApply = runs?.find((r) => r.mode === "apply" && r.status === "en_curs" && r.based_on === lastDry?.id) ?? null;
  const applyBatch = async () => {
    if (!lastDry) return;
    setBusy("apply"); setErr(null);
    try {
      const p = await fApi.act<Page & { counts: Counts }>("regularize", { data: { mode: "apply", dryRunId: lastDry.id, runId: openApply?.id, after: openApply?.cursor ?? null, limit: 25 } });
      useApp.getState().toast({ title: p.done ? "Regularització completada" : "Lot aplicat", body: `${p.counts.regularitzat ?? 0} regularitzats · ${p.counts.marcat_pendent ?? 0} pendents · ${p.counts.omes_protegit ?? 0} protegits omesos`, tone: "ok" });
      await load(); await show(p.runId);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <section className="rounded-2xl border border-line">
      <button className="flex w-full items-center gap-2 p-3 text-left text-[13px] font-semibold" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<ShieldCheck size={14} /> Regularització de comissions (contractes sense càlcul)
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3 text-[12.5px]">
          <Notice tone="blue">Primer cal fer la <b>revisió en simulació</b>: no escriu res. Després, «Aplica un lot» calcula només estimacions (mai meritacions, liquidacions, factures ni pagaments) per als contractes elegibles no protegits, 25 cada vegada. Els contractes amb moviments, liquidacions, cobraments, pagaments o imports històrics no es toquen mai.</Notice>
          {err && <Notice tone="red">{err}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!!busy} onClick={dryRun}>{busy === "dry" && <Loader2 size={13} className="animate-spin" />} Revisa (simulació)</Button>
            <Button size="sm" variant="primary" disabled={!!busy || !lastDry} onClick={applyBatch} title={lastDry ? "" : "Cal una revisió completada"}>{busy === "apply" && <Loader2 size={13} className="animate-spin" />} {openApply ? "Aplica el lot següent" : "Aplica un lot (25)"}</Button>
          </div>
          {runs && runs.length > 0 && (
            <table className="w-full text-[12px]"><thead><tr className="text-left text-muted"><th>Execució</th><th>Inici</th><th>Estat</th><th>Resultat</th><th /></tr></thead>
              <tbody>{runs.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="py-1">{r.mode === "dry_run" ? "Revisió (simulació)" : "Aplicació"}<div className="text-muted">{r.started_by_name ?? ""}</div></td>
                  <td>{fmtD(r.started_at)}</td>
                  <td><Badge tone={r.status === "completat" ? "green" : "amber"}>{r.status === "completat" ? "Completada" : "En curs"}</Badge></td>
                  <td>{COUNT_ORDER.filter((k) => r.counts[k]).map((k) => `${COUNT_LABEL[k] ?? k}: ${r.counts[k]}`).join(" · ") || "—"}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => show(r.id)}>Detall</Button></td>
                </tr>))}</tbody></table>
          )}
          {items && (
            <div className="max-h-96 overflow-auto rounded-xl border border-line">
              <table className="w-full text-[12px]"><thead className="sticky top-0 bg-surface"><tr className="text-left text-muted"><th className="p-1.5">Client · contracte</th><th>Categoria</th><th>Acció</th><th>Motiu</th></tr></thead>
                <tbody>{items.rows.map((i) => (
                  <tr key={i.contract_id} className="border-t border-line align-top">
                    <td className="p-1.5">{i.crm_contracts?.crm_clients?.name ?? "—"}<div className="text-muted">{[i.crm_contracts?.retailer, i.crm_contracts?.product, i.crm_contracts?.service].filter(Boolean).join(" · ")}</div></td>
                    <td><Badge tone={CAT[i.category]?.tone ?? "zinc"}>{CAT[i.category]?.label ?? i.category}</Badge></td>
                    <td>{ACTION[i.action] ?? i.action}</td>
                    <td className="text-muted">{i.reasons.join(" · ")}</td>
                  </tr>))}</tbody></table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
